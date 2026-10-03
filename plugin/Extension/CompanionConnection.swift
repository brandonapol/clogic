import Darwin
import Foundation

final class CompanionConnection {
    struct Identity: Equatable {
        let instanceId: String
        let contextName: String?
        let sampleRate: Double?
    }

    var onEvent: ((UiEvent) -> Void)?
    var identityProvider: (() -> Identity?)?

    private let socketPath: Result<String, SocketPathError>
    private let client: String
    private let reconnectDelay: TimeInterval = 2
    private let ioQueue = DispatchQueue(label: "clogic.companion.io")

    private var generation = 0
    private var socketOpen = false
    private var stopped = true
    private var state: ConnectionState = .offline
    private var companionName: String?
    private var nextId = 1
    private var pending: [RpcId: (Result<JSONValue, RpcErrorObject>) -> Void] = [:]
    private var reconnectWork: DispatchWorkItem?

    private var descriptor: Int32 = -1
    private var readSource: DispatchSourceRead?
    private var framer = LineFramer()

    init(socketPath: Result<String, SocketPathError>, client: String) {
        self.socketPath = socketPath
        self.client = client
    }

    deinit {
        reconnectWork?.cancel()
        readSource?.cancel()
    }

    static func socketPathFromBundle(_ bundle: Bundle = .main) -> Result<String, SocketPathError> {
        switch SocketPath.appGroup(fromInfo: bundle.infoDictionary) {
        case .failure(let error):
            return .failure(error)
        case .success(let group):
            guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
                return .failure(.noContainer(group: group))
            }
            return SocketPath.make(containerURL: container)
        }
    }

    var currentStatus: UiEvent {
        .connection(state: state, detail: nil, companion: companionName)
    }

    func start() {
        guard stopped else { return }
        stopped = false
        connect()
    }

    func stop() {
        stopped = true
        reconnectWork?.cancel()
        closeSocket(reason: "Plugin closed")
    }

    func restart() {
        reconnectWork?.cancel()
        closeSocket(reason: "Reconnecting")
        stopped = false
        connect()
    }

    func request<Params: RpcRequestParams>(
        _ params: Params,
        completion: @escaping (Result<Params.Response, RpcErrorObject>) -> Void
    ) {
        let admitted = socketOpen && (state == .ready || Params.method == .sessionHello)
        guard admitted else {
            completion(.failure(.connectionClosed("Not connected to the clogic companion")))
            return
        }
        let id = nextId
        nextId += 1
        let line: Data
        do {
            line = try RpcCodec.encodeRequest(id: id, params)
        } catch {
            completion(.failure(RpcErrorObject(code: RpcErrorCode.internalError, message: "Could not encode \(Params.method.rawValue)")))
            return
        }
        pending[.number(id)] = { outcome in
            completion(RpcCodec.decodeResult(Params.self, from: outcome))
        }
        write(line)
    }

    func notify<Params: PluginNotificationParams>(_ params: Params) {
        guard socketOpen, state == .ready, let line = try? RpcCodec.encodeNotification(params) else { return }
        write(line)
    }

    private func connect() {
        guard !stopped else { return }
        generation += 1
        let current = generation
        companionName = nil
        setState(.connecting, detail: nil)
        let path: String
        switch socketPath {
        case .failure(let error):
            setState(.offline, detail: Self.describe(error))
            return
        case .success(let value):
            path = value
        }
        ioQueue.async { [weak self] in
            guard let self else { return }
            switch UnixSocket.connect(path: path) {
            case .failure(let error):
                DispatchQueue.main.async { self.connectFailed(current, detail: "Companion not reachable (\(error.code))") }
            case .success(let descriptor):
                self.startReading(descriptor, generation: current)
                DispatchQueue.main.async { self.connected(current) }
            }
        }
    }

    private func connected(_ current: Int) {
        guard current == generation else { return }
        guard let identity = identityProvider?() else {
            closeSocket(reason: "Waiting for the audio unit")
            scheduleReconnect()
            return
        }
        socketOpen = true
        let hello = Handshake.hello(
            instanceId: identity.instanceId,
            contextName: identity.contextName,
            sampleRate: identity.sampleRate,
            client: client
        )
        request(hello) { [weak self] outcome in
            guard let self, current == self.generation else { return }
            let evaluated = Handshake.evaluate(outcome)
            self.companionName = evaluated.companion
            switch evaluated.state {
            case .ready:
                self.setState(.ready, detail: nil)
            case .incompatible:
                self.closeSocket(reason: evaluated.detail ?? "Incompatible companion")
                self.setState(.incompatible, detail: evaluated.detail)
            case .offline, .connecting:
                self.closeSocket(reason: evaluated.detail ?? "Handshake failed")
                self.setState(.offline, detail: evaluated.detail)
                self.scheduleReconnect()
            }
        }
    }

    private func connectFailed(_ current: Int, detail: String) {
        guard current == generation else { return }
        setState(.offline, detail: detail)
        scheduleReconnect()
    }

    private func disconnected(_ current: Int, detail: String) {
        guard current == generation else { return }
        closeSocket(reason: detail)
        setState(.offline, detail: detail)
        scheduleReconnect()
    }

    private func closeSocket(reason: String) {
        generation += 1
        socketOpen = false
        let failed = pending
        pending = [:]
        failed.values.forEach { $0(.failure(.connectionClosed(reason))) }
        ioQueue.async { [weak self] in
            self?.readSource?.cancel()
            self?.readSource = nil
        }
    }

    private func scheduleReconnect() {
        guard !stopped else { return }
        reconnectWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.connect() }
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + reconnectDelay, execute: work)
    }

    private func setState(_ next: ConnectionState, detail: String?) {
        state = next
        onEvent?(.connection(state: next, detail: detail, companion: companionName))
    }

    private func write(_ line: Data) {
        let current = generation
        ioQueue.async { [weak self] in
            guard let self, self.descriptor >= 0 else { return }
            if !UnixSocket.writeAll(self.descriptor, line) {
                DispatchQueue.main.async { self.disconnected(current, detail: "Write to companion failed") }
            }
        }
    }

    private func startReading(_ socket: Int32, generation current: Int) {
        readSource?.cancel()
        descriptor = socket
        framer = LineFramer()
        let source = DispatchSource.makeReadSource(fileDescriptor: socket, queue: ioQueue)
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        source.setEventHandler { [weak self] in
            guard let self else { return }
            let count = UnixSocket.readAvailable(socket, into: &buffer)
            if count > 0 {
                let events = self.framer.push(buffer[0..<count])
                DispatchQueue.main.async { self.handle(events, generation: current) }
                return
            }
            if count < 0 && (errno == EAGAIN || errno == EINTR) { return }
            let events = self.framer.end()
            source.cancel()
            DispatchQueue.main.async {
                self.handle(events, generation: current)
                self.disconnected(current, detail: "Companion closed the connection")
            }
        }
        source.setCancelHandler { [weak self] in
            close(socket)
            if self?.descriptor == socket { self?.descriptor = -1 }
        }
        readSource = source
        source.resume()
    }

    private func handle(_ events: [FrameEvent], generation current: Int) {
        guard current == generation else { return }
        for event in events {
            switch event {
            case .line(let line):
                handle(line: line)
            case .oversized(let bytes):
                onEvent?(.problem(message: "Dropped a \(bytes)-byte message from the companion (over the line limit)"))
            case .invalidUTF8(let bytes):
                onEvent?(.problem(message: "Dropped a \(bytes)-byte message that was not UTF-8"))
            case .truncated(let bytes):
                onEvent?(.problem(message: "The connection ended inside a \(bytes)-byte message"))
            }
        }
    }

    private func handle(line: String) {
        switch RpcCodec.decode(line: line) {
        case .failure(let error):
            onEvent?(.problem(message: error.message))
        case .success(.notification(let notification)):
            onEvent?(.notification(notification))
        case .success(.response(let id, let outcome)):
            guard let id, let settle = pending.removeValue(forKey: id) else {
                if case .failure(let error) = outcome {
                    onEvent?(.problem(message: error.message))
                }
                return
            }
            settle(outcome)
        }
    }

    private static func describe(_ error: SocketPathError) -> String {
        switch error {
        case .missingAppGroup:
            return "The plugin was built without an app group"
        case .noContainer(let group):
            return "No app group container for \(group)"
        case .tooLong(let bytes, let limit):
            return "Socket path is \(bytes) bytes; the limit is \(limit)"
        }
    }
}
