import Foundation

public enum RpcErrorCode {
    public static let parseError = -32700
    public static let invalidRequest = -32600
    public static let methodNotFound = -32601
    public static let invalidParams = -32602
    public static let internalError = -32603
    public static let unsupportedProtocolVersion = -32000
    public static let handshakeRequired = -32001
    public static let messageTooLarge = -32002
    public static let connectionClosed = -32003
}

public struct RpcErrorObject: Codable, Equatable, Error, Sendable {
    public let code: Int
    public let message: String

    public init(code: Int, message: String) {
        self.code = code
        self.message = message
    }

    public static func connectionClosed(_ message: String = "Connection closed") -> RpcErrorObject {
        RpcErrorObject(code: RpcErrorCode.connectionClosed, message: message)
    }
}

public enum RpcId: Equatable, Hashable, Sendable {
    case number(Int)
    case string(String)
}

extension RpcId: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Int.self) {
            self = .number(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        }
    }
}

public enum Incoming: Equatable, Sendable {
    case response(id: RpcId?, outcome: Result<JSONValue, RpcErrorObject>)
    case notification(CompanionNotification)
}

private struct RequestEnvelope<Params: Encodable>: Encodable {
    let jsonrpc = ProtocolInfo.jsonrpc
    let id: RpcId
    let method: String
    let params: Params
}

private struct NotificationEnvelope<Params: Encodable>: Encodable {
    let jsonrpc = ProtocolInfo.jsonrpc
    let method: String
    let params: Params
}

private struct IncomingEnvelope: Decodable {
    let jsonrpc: String?
    let id: RpcId?
    let hasId: Bool
    let method: String?
    let params: JSONValue?
    let result: JSONValue?
    let hasResult: Bool
    let error: RpcErrorObject?
    let hasError: Bool

    enum CodingKeys: String, CodingKey {
        case jsonrpc, id, method, params, result, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        jsonrpc = try? container.decodeIfPresent(String.self, forKey: .jsonrpc)
        hasId = container.contains(.id)
        id = try? container.decodeIfPresent(RpcId.self, forKey: .id)
        method = try? container.decodeIfPresent(String.self, forKey: .method)
        params = try? container.decodeIfPresent(JSONValue.self, forKey: .params)
        hasResult = container.contains(.result)
        result = hasResult ? (try container.decode(JSONValue.self, forKey: .result)) : nil
        hasError = container.contains(.error)
        error = try? container.decodeIfPresent(RpcErrorObject.self, forKey: .error)
    }
}

public enum RpcCodec {
    public static func encodeRequest<Params: RpcRequestParams>(id: Int, _ params: Params) throws -> Data {
        try line(RequestEnvelope(id: .number(id), method: Params.method.rawValue, params: params))
    }

    public static func encodeNotification<Params: PluginNotificationParams>(_ params: Params) throws -> Data {
        try line(NotificationEnvelope(method: Params.method.rawValue, params: params))
    }

    public static func decode(line: String) -> Result<Incoming, RpcErrorObject> {
        guard let data = line.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else {
            return .failure(RpcErrorObject(code: RpcErrorCode.parseError, message: "Parse error: invalid JSON"))
        }
        guard raw is [String: Any] else {
            return .failure(RpcErrorObject(code: RpcErrorCode.invalidRequest, message: "Message must be a JSON object"))
        }
        guard let envelope = try? JSONDecoder().decode(IncomingEnvelope.self, from: data) else {
            return .failure(RpcErrorObject(code: RpcErrorCode.invalidRequest, message: "Malformed message"))
        }
        guard envelope.jsonrpc == ProtocolInfo.jsonrpc else {
            return .failure(RpcErrorObject(code: RpcErrorCode.invalidRequest, message: "jsonrpc must be \"2.0\""))
        }
        if let method = envelope.method {
            return decodeNotification(method: method, envelope: envelope)
        }
        if envelope.hasResult == envelope.hasError || (envelope.hasError && envelope.error == nil) {
            return .failure(RpcErrorObject(code: RpcErrorCode.invalidRequest, message: "Response needs exactly one of result or error"))
        }
        if let error = envelope.error {
            return .success(.response(id: envelope.id, outcome: .failure(error)))
        }
        return .success(.response(id: envelope.id, outcome: .success(envelope.result ?? .null)))
    }

    public static func decodeResult<Params: RpcRequestParams>(
        _ type: Params.Type,
        from outcome: Result<JSONValue, RpcErrorObject>
    ) -> Result<Params.Response, RpcErrorObject> {
        switch outcome {
        case .failure(let error):
            return .failure(error)
        case .success(let value):
            guard let decoded = try? JSONCoding.convert(value, to: Params.Response.self) else {
                return .failure(RpcErrorObject(code: RpcErrorCode.invalidParams, message: "Invalid result for \(Params.method.rawValue)"))
            }
            return .success(decoded)
        }
    }

    private static func decodeNotification(method: String, envelope: IncomingEnvelope) -> Result<Incoming, RpcErrorObject> {
        if envelope.hasId {
            return .failure(RpcErrorObject(code: RpcErrorCode.invalidRequest, message: "The plugin does not accept requests"))
        }
        guard let known = CompanionNotificationMethod(rawValue: method) else {
            return .failure(RpcErrorObject(code: RpcErrorCode.methodNotFound, message: "Method not found: \(method)"))
        }
        let params = envelope.params ?? .object([:])
        guard case .object = params else {
            return .failure(RpcErrorObject(code: RpcErrorCode.invalidParams, message: "params must be an object"))
        }
        guard let notification = try? CompanionNotification.decode(method: known, params: params) else {
            return .failure(RpcErrorObject(code: RpcErrorCode.invalidParams, message: "Invalid params for \(method)"))
        }
        return .success(.notification(notification))
    }

    private static func line<Envelope: Encodable>(_ envelope: Envelope) throws -> Data {
        var data = try JSONCoding.encoder().encode(envelope)
        data.append(0x0A)
        return data
    }
}
