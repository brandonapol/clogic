import Foundation

public struct HelloOutcome: Equatable, Sendable {
    public let state: ConnectionState
    public let detail: String?
    public let companion: String?
}

public enum Handshake {
    public static func hello(
        instanceId: String,
        contextName: String?,
        sampleRate: Double?,
        client: String
    ) -> SessionHelloParams {
        SessionHelloParams(
            instanceId: instanceId,
            contextName: contextName,
            sampleRate: sampleRate.flatMap { $0.isFinite && $0 > 0 ? $0 : nil },
            protocolVersion: ProtocolInfo.version,
            client: client
        )
    }

    public static func evaluate(_ outcome: Result<SessionHelloResult, RpcErrorObject>) -> HelloOutcome {
        switch outcome {
        case .success(let result) where result.protocolVersion == ProtocolInfo.version:
            return HelloOutcome(state: .ready, detail: nil, companion: result.companion)
        case .success(let result):
            return HelloOutcome(
                state: .incompatible,
                detail: "Companion answered with protocol \(result.protocolVersion); this plugin speaks \(ProtocolInfo.version)",
                companion: result.companion
            )
        case .failure(let error) where error.code == RpcErrorCode.unsupportedProtocolVersion:
            return HelloOutcome(state: .incompatible, detail: error.message, companion: nil)
        case .failure(let error):
            return HelloOutcome(state: .offline, detail: error.message, companion: nil)
        }
    }
}
