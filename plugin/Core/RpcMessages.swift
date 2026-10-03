import Foundation

public enum ProtocolInfo {
    public static let version = 1
    public static let jsonrpc = "2.0"
}

public enum RequestMethod: String, CaseIterable, Sendable {
    case sessionHello = "session.hello"
    case chatSend = "chat.send"
    case chatCancel = "chat.cancel"
    case changeDecide = "change.decide"
    case keysSet = "keys.set"
    case keysStatus = "keys.status"
    case providerSelect = "provider.select"
    case diagnosticsExport = "diagnostics.export"
}

public enum PluginNotificationMethod: String, CaseIterable, Sendable {
    case meter = "meter"
    case contextChanged = "context.changed"
}

public enum CompanionNotificationMethod: String, CaseIterable, Sendable {
    case chatMessage = "chat.message"
    case chatDelta = "chat.delta"
    case chatDone = "chat.done"
    case toolStarted = "tool.started"
    case toolFinished = "tool.finished"
    case changeProposed = "change.proposed"
    case changeApplied = "change.applied"
    case analysisResult = "analysis.result"
    case usage = "usage"
    case error = "error"
}

public enum ProviderId: String, Codable, CaseIterable, Sendable {
    case anthropic
    case openai
    case xai
}

public enum TurnEndReason: String, Codable, CaseIterable, Sendable {
    case endTurn = "end_turn"
    case toolUse = "tool_use"
    case maxTokens = "max_tokens"
    case refusal = "refusal"
    case other = "other"
    case iterationLimit = "iteration_limit"
    case llmError = "llm_error"
    case cancelled = "cancelled"
    case budgetExceeded = "budget_exceeded"
}

public enum ToolKind: String, Codable, CaseIterable, Sendable {
    case read
    case change
}

public enum ToolStatus: String, Codable, CaseIterable, Sendable {
    case ok
    case error
    case proposed
}

public enum ChangeStatus: String, Codable, CaseIterable, Sendable {
    case applied
    case declined
    case expired
    case noChanges = "no_changes"
}

public enum DecideOutcome: String, Codable, CaseIterable, Sendable {
    case applying
    case declined
}

public protocol RpcRequestParams: Encodable, Sendable {
    associatedtype Response: Decodable & Sendable
    static var method: RequestMethod { get }
}

public protocol PluginNotificationParams: Encodable, Sendable {
    static var method: PluginNotificationMethod { get }
}

public struct SessionHelloParams: Codable, Equatable, RpcRequestParams {
    public typealias Response = SessionHelloResult
    public static let method = RequestMethod.sessionHello

    public let instanceId: String
    public let contextName: String?
    public let sampleRate: Double?
    public let protocolVersion: Int
    public let client: String

    public init(instanceId: String, contextName: String?, sampleRate: Double?, protocolVersion: Int = ProtocolInfo.version, client: String) {
        self.instanceId = instanceId
        self.contextName = contextName
        self.sampleRate = sampleRate
        self.protocolVersion = protocolVersion
        self.client = client
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(instanceId, forKey: .instanceId)
        try container.encode(contextName, forKey: .contextName)
        try container.encode(sampleRate, forKey: .sampleRate)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(client, forKey: .client)
    }
}

public struct SessionHelloResult: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let companion: String
}

public struct ChatSendParams: Codable, Equatable, RpcRequestParams {
    public typealias Response = ChatSendResult
    public static let method = RequestMethod.chatSend

    public let instanceId: String
    public let text: String

    public init(instanceId: String, text: String) {
        self.instanceId = instanceId
        self.text = text
    }
}

public struct ChatSendResult: Codable, Equatable, Sendable {
    public let turnId: String
}

public struct ChatCancelParams: Codable, Equatable, RpcRequestParams {
    public typealias Response = ChatCancelResult
    public static let method = RequestMethod.chatCancel

    public let instanceId: String
    public let turnId: String?

    public init(instanceId: String, turnId: String?) {
        self.instanceId = instanceId
        self.turnId = turnId
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(instanceId, forKey: .instanceId)
        try container.encode(turnId, forKey: .turnId)
    }
}

public struct ChatCancelResult: Codable, Equatable, Sendable {
    public let cancelled: Bool
}

public struct ChangeDecideParams: Codable, Equatable, RpcRequestParams {
    public typealias Response = ChangeDecideResult
    public static let method = RequestMethod.changeDecide

    public let instanceId: String
    public let proposalId: String
    public let acceptedRowIds: [String]

    public init(instanceId: String, proposalId: String, acceptedRowIds: [String]) {
        self.instanceId = instanceId
        self.proposalId = proposalId
        self.acceptedRowIds = acceptedRowIds
    }
}

public struct ChangeDecideResult: Codable, Equatable, Sendable {
    public let proposalId: String
    public let outcome: DecideOutcome
}

public struct KeysSetParams: Codable, Equatable, RpcRequestParams, CustomStringConvertible, CustomDebugStringConvertible {
    public typealias Response = KeyStatus
    public static let method = RequestMethod.keysSet

    public let provider: ProviderId
    public let key: String

    public init(provider: ProviderId, key: String) {
        self.provider = provider
        self.key = key
    }

    public var description: String { "KeysSetParams(provider: \(provider.rawValue), key: <redacted>)" }
    public var debugDescription: String { description }
}

public struct KeyStatus: Codable, Equatable, Sendable {
    public let provider: ProviderId
    public let configured: Bool
}

public typealias KeysSetResult = KeyStatus

public struct KeysStatusParams: Codable, Equatable, RpcRequestParams {
    public typealias Response = KeysStatusResult
    public static let method = RequestMethod.keysStatus

    public init() {}
}

public struct KeysStatusResult: Codable, Equatable, Sendable {
    public let providers: [KeyStatus]
    public let activeProvider: ProviderId?
}

public struct ProviderSelectParams: Codable, Equatable, RpcRequestParams {
    public typealias Response = ProviderSelectResult
    public static let method = RequestMethod.providerSelect

    public let provider: ProviderId

    public init(provider: ProviderId) {
        self.provider = provider
    }
}

public struct ProviderSelectResult: Codable, Equatable, Sendable {
    public let activeProvider: ProviderId
}

public struct DiagnosticsExportParams: Codable, Equatable, RpcRequestParams {
    public typealias Response = DiagnosticsExportResult
    public static let method = RequestMethod.diagnosticsExport

    public let includeContent: Bool?

    public init(includeContent: Bool? = nil) {
        self.includeContent = includeContent
    }
}

public struct DiagnosticsExportResult: Codable, Equatable, Sendable {
    public let includesContent: Bool
    public let json: String
    public let text: String
}

public struct MeterParams: Codable, Equatable, PluginNotificationParams {
    public static let method = PluginNotificationMethod.meter

    public let instanceId: String
    public let momentaryLufs: Double?
    public let bands: [Double]

    public init(instanceId: String, momentaryLufs: Double?, bands: [Double]) {
        self.instanceId = instanceId
        self.momentaryLufs = momentaryLufs
        self.bands = bands
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(instanceId, forKey: .instanceId)
        try container.encode(momentaryLufs, forKey: .momentaryLufs)
        try container.encode(bands, forKey: .bands)
    }
}

public struct ContextChangedParams: Codable, Equatable, PluginNotificationParams {
    public static let method = PluginNotificationMethod.contextChanged

    public let instanceId: String
    public let contextName: String?

    public init(instanceId: String, contextName: String?) {
        self.instanceId = instanceId
        self.contextName = contextName
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(instanceId, forKey: .instanceId)
        try container.encode(contextName, forKey: .contextName)
    }
}

public struct ChatMessageParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let turnId: String
    public let messageId: String
    public let text: String
}

public struct ChatDeltaParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let turnId: String
    public let messageId: String
    public let index: Int
    public let text: String
}

public struct ChatDoneParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let turnId: String
    public let reason: TurnEndReason
}

public struct ToolStartedParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let turnId: String
    public let callId: String
    public let name: String
    public let kind: ToolKind
    public let input: [String: JSONValue]
}

public struct ToolFinishedParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let turnId: String
    public let callId: String
    public let name: String
    public let status: ToolStatus
    public let summary: String
}

public struct ChangeRow: Codable, Equatable, Sendable {
    public let id: String
    public let control: String
    public let location: String
    public let before: JSONValue
    public let after: JSONValue
}

public struct ChangeProposedParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let proposalId: String
    public let reason: String
    public let rows: [ChangeRow]
    public let expiresAt: String
}

public struct FailedRow: Codable, Equatable, Sendable {
    public let id: String
    public let message: String
}

public struct ChangeAppliedParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let proposalId: String
    public let status: ChangeStatus
    public let applied: [String]
    public let declined: [String]
    public let failed: [FailedRow]
}

public struct AnalysisResultParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let turnId: String?
    public let callId: String?
    public let analysis: String
    public let summary: String
    public let data: [String: JSONValue]

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(instanceId, forKey: .instanceId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(callId, forKey: .callId)
        try container.encode(analysis, forKey: .analysis)
        try container.encode(summary, forKey: .summary)
        try container.encode(data, forKey: .data)
    }
}

public struct UsageParams: Codable, Equatable, Sendable {
    public let instanceId: String
    public let turnId: String
    public let inputTokens: Int
    public let outputTokens: Int
}

public struct ErrorParams: Codable, Equatable, Sendable {
    public let instanceId: String?
    public let turnId: String?
    public let code: String
    public let message: String

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(instanceId, forKey: .instanceId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(code, forKey: .code)
        try container.encode(message, forKey: .message)
    }
}

public enum CompanionNotification: Equatable, Sendable {
    case chatMessage(ChatMessageParams)
    case chatDelta(ChatDeltaParams)
    case chatDone(ChatDoneParams)
    case toolStarted(ToolStartedParams)
    case toolFinished(ToolFinishedParams)
    case changeProposed(ChangeProposedParams)
    case changeApplied(ChangeAppliedParams)
    case analysisResult(AnalysisResultParams)
    case usage(UsageParams)
    case error(ErrorParams)

    public var method: CompanionNotificationMethod {
        switch self {
        case .chatMessage: return .chatMessage
        case .chatDelta: return .chatDelta
        case .chatDone: return .chatDone
        case .toolStarted: return .toolStarted
        case .toolFinished: return .toolFinished
        case .changeProposed: return .changeProposed
        case .changeApplied: return .changeApplied
        case .analysisResult: return .analysisResult
        case .usage: return .usage
        case .error: return .error
        }
    }

    public static func decode(method: CompanionNotificationMethod, params: JSONValue) throws -> CompanionNotification {
        switch method {
        case .chatMessage: return .chatMessage(try JSONCoding.convert(params, to: ChatMessageParams.self))
        case .chatDelta: return .chatDelta(try JSONCoding.convert(params, to: ChatDeltaParams.self))
        case .chatDone: return .chatDone(try JSONCoding.convert(params, to: ChatDoneParams.self))
        case .toolStarted: return .toolStarted(try JSONCoding.convert(params, to: ToolStartedParams.self))
        case .toolFinished: return .toolFinished(try JSONCoding.convert(params, to: ToolFinishedParams.self))
        case .changeProposed: return .changeProposed(try JSONCoding.convert(params, to: ChangeProposedParams.self))
        case .changeApplied: return .changeApplied(try JSONCoding.convert(params, to: ChangeAppliedParams.self))
        case .analysisResult: return .analysisResult(try JSONCoding.convert(params, to: AnalysisResultParams.self))
        case .usage: return .usage(try JSONCoding.convert(params, to: UsageParams.self))
        case .error: return .error(try JSONCoding.convert(params, to: ErrorParams.self))
        }
    }

    public func params() throws -> JSONValue {
        switch self {
        case .chatMessage(let params): return try JSONCoding.value(of: params)
        case .chatDelta(let params): return try JSONCoding.value(of: params)
        case .chatDone(let params): return try JSONCoding.value(of: params)
        case .toolStarted(let params): return try JSONCoding.value(of: params)
        case .toolFinished(let params): return try JSONCoding.value(of: params)
        case .changeProposed(let params): return try JSONCoding.value(of: params)
        case .changeApplied(let params): return try JSONCoding.value(of: params)
        case .analysisResult(let params): return try JSONCoding.value(of: params)
        case .usage(let params): return try JSONCoding.value(of: params)
        case .error(let params): return try JSONCoding.value(of: params)
        }
    }
}
