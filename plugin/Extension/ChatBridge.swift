import AppKit
import WebKit

final class ChatBridge: NSObject {
    static let handlerName = "clogic"
    static let webFolder = "Web"

    let webView: ChatWebView

    private let companion: CompanionConnection
    private let webRoot: URL?
    private var pageReady = false
    private var queued: [UiEvent] = []
    private weak var audioUnit: PassthroughAudioUnit?
    private var contextObservation: NSKeyValueObservation?
    private var contextName: String?

    init(frame: NSRect) {
        let configuration = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        configuration.userContentController = contentController
        configuration.websiteDataStore = .nonPersistent()
        webView = ChatWebView(frame: frame, configuration: configuration)
        webRoot = Bundle(for: ChatBridge.self).resourceURL?.appendingPathComponent(Self.webFolder, isDirectory: true)
        let version = Bundle(for: ChatBridge.self).infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        companion = CompanionConnection(
            socketPath: CompanionConnection.socketPathFromBundle(Bundle(for: ChatBridge.self)),
            client: "clogic.appex \(version)"
        )
        super.init()
        contentController.add(WeakScriptMessageHandler(self), name: Self.handlerName)
        webView.navigationDelegate = self
        companion.onEvent = { [weak self] event in self?.send(event) }
        companion.identityProvider = { [weak self] in self?.identity() }
    }

    func loadInterface() {
        guard let webRoot else {
            return
        }
        webView.loadFileURL(webRoot.appendingPathComponent("index.html"), allowingReadAccessTo: webRoot)
    }

    func attach(_ unit: PassthroughAudioUnit) {
        guard audioUnit !== unit else { return }
        audioUnit = unit
        contextName = unit.contextName
        unit.onInstanceIdChange = { [weak self] _ in
            DispatchQueue.main.async { self?.companion.restart() }
        }
        contextObservation = unit.observe(\.contextName, options: [.new]) { [weak self] unit, _ in
            let name = unit.contextName
            DispatchQueue.main.async { self?.contextChanged(name) }
        }
        send(.context(contextName: contextName))
        companion.start()
    }

    func releaseKeyboard() {
        webView.ownsKeyboard = false
    }

    private func identity() -> CompanionConnection.Identity? {
        guard let audioUnit else { return nil }
        return CompanionConnection.Identity(
            instanceId: audioUnit.instanceId,
            contextName: contextName,
            sampleRate: audioUnit.sampleRate
        )
    }

    private func contextChanged(_ name: String?) {
        guard name != contextName, let audioUnit else { return }
        contextName = name
        send(.context(contextName: name))
        companion.notify(ContextChangedParams(instanceId: audioUnit.instanceId, contextName: name))
    }

    private func send(_ event: UiEvent) {
        guard pageReady else {
            queued.append(event)
            return
        }
        guard let json = try? event.json() else { return }
        webView.callAsyncJavaScript(
            "globalThis.clogicReceive(JSON.parse(line))",
            arguments: ["line": json],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func handle(_ command: UiCommand) {
        switch command {
        case .ready:
            pageReady = true
            let backlog = queued
            queued = []
            send(companion.currentStatus)
            send(.context(contextName: contextName))
            backlog.forEach(send)
        case .chatSend(let text):
            withInstance { instanceId in
                self.forward(ChatSendParams(instanceId: instanceId, text: text))
            }
        case .chatCancel(let turnId):
            withInstance { instanceId in
                self.forward(ChatCancelParams(instanceId: instanceId, turnId: turnId))
            }
        case .changeDecide(let proposalId, let acceptedRowIds):
            withInstance { instanceId in
                self.forward(ChangeDecideParams(instanceId: instanceId, proposalId: proposalId, acceptedRowIds: acceptedRowIds))
            }
        case .keysStatus:
            forward(KeysStatusParams())
        case .keysSet(let provider, let key):
            forward(KeysSetParams(provider: provider, key: key))
        case .providerSelect(let provider):
            forward(ProviderSelectParams(provider: provider))
        case .keyboardFocus(let owned):
            webView.ownsKeyboard = owned
        case .reconnect:
            companion.restart()
        }
    }

    private func withInstance(_ body: (String) -> Void) {
        guard let instanceId = audioUnit?.instanceId else {
            send(.problem(message: "The audio unit is not ready yet"))
            return
        }
        body(instanceId)
    }

    private func forward<Params: RpcRequestParams>(_ params: Params) where Params.Response: Encodable {
        companion.request(params) { [weak self] outcome in
            let mapped = outcome.flatMap { response -> Result<JSONValue, RpcErrorObject> in
                guard let value = try? JSONCoding.value(of: response) else {
                    return .failure(RpcErrorObject(code: RpcErrorCode.internalError, message: "Could not forward the result"))
                }
                return .success(value)
            }
            self?.send(.response(request: Params.method, outcome: mapped))
        }
    }
}

extension ChatBridge: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.handlerName,
              message.frameInfo.isMainFrame,
              let command = UiCommand.decode(scriptBody: message.body)
        else { return }
        handle(command)
    }
}

extension ChatBridge: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let webRoot else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(NavigationPolicy.allows(navigationAction.request.url, webRoot: webRoot) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        pageReady = false
    }
}

final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
