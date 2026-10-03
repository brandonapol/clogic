import Foundation

public enum UiCommand: Equatable, Sendable {
    case ready
    case chatSend(text: String)
    case chatCancel(turnId: String?)
    case changeDecide(proposalId: String, acceptedRowIds: [String])
    case keysStatus
    case keysSet(provider: ProviderId, key: String)
    case providerSelect(provider: ProviderId)
    case keyboardFocus(owned: Bool)
    case reconnect

    public static let typeNames = [
        "ready", "chat.send", "chat.cancel", "change.decide", "keys.status", "keys.set",
        "provider.select", "keyboard.focus", "reconnect",
    ]

    public static func decode(scriptBody: Any) -> UiCommand? {
        guard JSONSerialization.isValidJSONObject(scriptBody),
              let data = try? JSONSerialization.data(withJSONObject: scriptBody),
              let value = try? JSONDecoder().decode([String: JSONValue].self, from: data),
              case .string(let type)? = value["type"]
        else {
            return nil
        }
        return decode(type: type, fields: value)
    }

    static func decode(type: String, fields: [String: JSONValue]) -> UiCommand? {
        switch type {
        case "ready":
            return .ready
        case "chat.send":
            guard case .string(let text)? = fields["text"],
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return nil }
            return .chatSend(text: text)
        case "chat.cancel":
            switch fields["turnId"] {
            case .string(let turnId)?: return .chatCancel(turnId: turnId)
            case .null?, nil: return .chatCancel(turnId: nil)
            default: return nil
            }
        case "change.decide":
            guard case .string(let proposalId)? = fields["proposalId"],
                  case .array(let rows)? = fields["acceptedRowIds"]
            else { return nil }
            let ids = rows.compactMap { row -> String? in
                if case .string(let id) = row { return id }
                return nil
            }
            guard ids.count == rows.count else { return nil }
            return .changeDecide(proposalId: proposalId, acceptedRowIds: ids)
        case "keys.status":
            return .keysStatus
        case "keys.set":
            guard case .string(let raw)? = fields["provider"],
                  let provider = ProviderId(rawValue: raw),
                  case .string(let key)? = fields["key"]
            else { return nil }
            let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return .keysSet(provider: provider, key: trimmed)
        case "provider.select":
            guard case .string(let raw)? = fields["provider"],
                  let provider = ProviderId(rawValue: raw)
            else { return nil }
            return .providerSelect(provider: provider)
        case "keyboard.focus":
            guard case .bool(let owned)? = fields["owned"] else { return nil }
            return .keyboardFocus(owned: owned)
        case "reconnect":
            return .reconnect
        default:
            return nil
        }
    }
}

extension UiCommand: CustomStringConvertible, CustomDebugStringConvertible {
    public var description: String {
        switch self {
        case .keysSet(let provider, _): return "keysSet(provider: \(provider.rawValue), key: <redacted>)"
        case .chatSend(let text): return "chatSend(characters: \(text.count))"
        default: return UiCommand.caseName(self)
        }
    }

    public var debugDescription: String { description }

    static func caseName(_ command: UiCommand) -> String {
        switch command {
        case .ready: return "ready"
        case .chatSend: return "chatSend"
        case .chatCancel: return "chatCancel"
        case .changeDecide: return "changeDecide"
        case .keysStatus: return "keysStatus"
        case .keysSet: return "keysSet"
        case .providerSelect: return "providerSelect"
        case .keyboardFocus: return "keyboardFocus"
        case .reconnect: return "reconnect"
        }
    }
}

public enum ConnectionState: String, Codable, Sendable {
    case connecting
    case ready
    case offline
    case incompatible
}

public enum UiEvent: Equatable, Sendable {
    case connection(state: ConnectionState, detail: String?, companion: String?)
    case context(contextName: String?)
    case notification(CompanionNotification)
    case response(request: RequestMethod, outcome: Result<JSONValue, RpcErrorObject>)
    case problem(message: String)

    public static let typeNames = ["connection", "context", "notification", "response", "problem"]

    public func json() throws -> String {
        let data = try JSONCoding.encoder().encode(try value())
        return String(decoding: data, as: UTF8.self)
    }

    public func value() throws -> JSONValue {
        switch self {
        case .connection(let state, let detail, let companion):
            return .object([
                "type": .string("connection"),
                "state": .string(state.rawValue),
                "detail": detail.map(JSONValue.string) ?? .null,
                "companion": companion.map(JSONValue.string) ?? .null,
            ])
        case .context(let contextName):
            return .object([
                "type": .string("context"),
                "contextName": contextName.map(JSONValue.string) ?? .null,
            ])
        case .notification(let notification):
            return .object([
                "type": .string("notification"),
                "method": .string(notification.method.rawValue),
                "params": try notification.params(),
            ])
        case .response(let request, .success(let result)):
            return .object([
                "type": .string("response"),
                "request": .string(request.rawValue),
                "ok": .bool(true),
                "result": result,
            ])
        case .response(let request, .failure(let error)):
            return .object([
                "type": .string("response"),
                "request": .string(request.rawValue),
                "ok": .bool(false),
                "error": .object(["code": .number(Double(error.code)), "message": .string(error.message)]),
            ])
        case .problem(let message):
            return .object(["type": .string("problem"), "message": .string(message)])
        }
    }
}
