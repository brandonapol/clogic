import XCTest

final class BridgeMessagesTests: XCTestCase {
    func testDecodesEveryUiCommand() {
        let cases: [([String: Any], UiCommand)] = [
            (["type": "ready"], .ready),
            (["type": "chat.send", "text": "How loud is my mix?"], .chatSend(text: "How loud is my mix?")),
            (["type": "chat.cancel", "turnId": "turn-1"], .chatCancel(turnId: "turn-1")),
            (["type": "chat.cancel", "turnId": NSNull()], .chatCancel(turnId: nil)),
            (["type": "change.decide", "proposalId": "p-1", "acceptedRowIds": ["r-1"]], .changeDecide(proposalId: "p-1", acceptedRowIds: ["r-1"])),
            (["type": "change.decide", "proposalId": "p-1", "acceptedRowIds": [String]()], .changeDecide(proposalId: "p-1", acceptedRowIds: [])),
            (["type": "keys.status"], .keysStatus),
            (["type": "keys.set", "provider": "openai", "key": "  sk-test  "], .keysSet(provider: .openai, key: "sk-test")),
            (["type": "provider.select", "provider": "xai"], .providerSelect(provider: .xai)),
            (["type": "keyboard.focus", "owned": true], .keyboardFocus(owned: true)),
            (["type": "reconnect"], .reconnect),
        ]
        for (body, expected) in cases {
            XCTAssertEqual(UiCommand.decode(scriptBody: body), expected, "\(body["type"] ?? "")")
        }
    }

    func testTypeNamesCoverEveryDecodableCommand() {
        let decodable = UiCommand.typeNames.filter { name in
            UiCommand.decode(type: name, fields: [
                "text": .string("x"), "turnId": .null, "proposalId": .string("p"), "acceptedRowIds": .array([]),
                "provider": .string("anthropic"), "key": .string("k"), "owned": .bool(false),
            ]) != nil
        }
        XCTAssertEqual(decodable, UiCommand.typeNames)
    }

    func testRejectsMalformedCommands() {
        let bodies: [Any] = [
            "ready",
            ["kind": "ready"],
            ["type": "launch.missiles"],
            ["type": "chat.send", "text": "   "],
            ["type": "chat.send"],
            ["type": "change.decide", "proposalId": "p-1", "acceptedRowIds": [1]] as [String: Any],
            ["type": "keys.set", "provider": "mistral", "key": "k"],
            ["type": "keys.set", "provider": "anthropic", "key": ""],
            ["type": "keyboard.focus", "owned": "yes"] as [String: Any],
        ]
        for body in bodies {
            XCTAssertNil(UiCommand.decode(scriptBody: body), "\(body)")
        }
    }

    func testDescriptionsRedactKeysAndMessageText() {
        let key = UiCommand.keysSet(provider: .anthropic, key: "sk-ant-test")
        XCTAssertFalse(String(describing: key).contains("sk-ant-test"))
        XCTAssertFalse(String(reflecting: key).contains("sk-ant-test"))
        XCTAssertFalse(String(describing: UiCommand.chatSend(text: "secret mix notes")).contains("secret"))
    }

    func testEncodesConnectionEvents() throws {
        XCTAssertEqual(
            try UiEvent.connection(state: .offline, detail: "Companion not reachable", companion: nil).value(),
            .object([
                "type": .string("connection"),
                "state": .string("offline"),
                "detail": .string("Companion not reachable"),
                "companion": .null,
            ])
        )
    }

    func testEncodesNotificationsWithTheirWireParams() throws {
        let params = try JSONCoding.convert(
            .object([
                "instanceId": .string("i"), "turnId": .string("t"), "messageId": .string("m"),
                "index": .number(0), "text": .string("Your "),
            ]),
            to: ChatDeltaParams.self
        )
        guard case .object(let event) = try UiEvent.notification(.chatDelta(params)).value() else {
            return XCTFail("not an object")
        }
        XCTAssertEqual(event["type"], .string("notification"))
        XCTAssertEqual(event["method"], .string("chat.delta"))
        XCTAssertEqual(event["params"], try JSONCoding.value(of: params))
    }

    func testEncodesResponses() throws {
        XCTAssertEqual(
            try UiEvent.response(request: .chatSend, outcome: .success(.object(["turnId": .string("turn-1")]))).value(),
            .object([
                "type": .string("response"), "request": .string("chat.send"), "ok": .bool(true),
                "result": .object(["turnId": .string("turn-1")]),
            ])
        )
        XCTAssertEqual(
            try UiEvent.response(request: .keysSet, outcome: .failure(.connectionClosed())).value(),
            .object([
                "type": .string("response"), "request": .string("keys.set"), "ok": .bool(false),
                "error": .object(["code": .number(-32003), "message": .string("Connection closed")]),
            ])
        )
    }

    func testEventJSONIsASingleLine() throws {
        let json = try UiEvent.problem(message: "line one\nline two").json()
        XCTAssertFalse(json.contains("\n"))
    }
}
