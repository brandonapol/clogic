import XCTest

final class RpcCodecTests: XCTestCase {
    func testDecodesASuccessfulResponse() {
        XCTAssertEqual(
            RpcCodec.decode(line: #"{"jsonrpc":"2.0","id":3,"result":{"turnId":"turn-1"}}"#),
            .success(.response(id: .number(3), outcome: .success(.object(["turnId": .string("turn-1")]))))
        )
    }

    func testDecodesAnErrorResponse() {
        XCTAssertEqual(
            RpcCodec.decode(line: #"{"jsonrpc":"2.0","id":"a","error":{"code":-32001,"message":"Send session.hello before other messages"}}"#),
            .success(.response(
                id: .string("a"),
                outcome: .failure(RpcErrorObject(code: RpcErrorCode.handshakeRequired, message: "Send session.hello before other messages"))
            ))
        )
    }

    func testDecodesAnErrorResponseWithANullId() {
        guard case .success(.response(let id, .failure(let error))) =
            RpcCodec.decode(line: #"{"jsonrpc":"2.0","id":null,"error":{"code":-32002,"message":"too large"}}"#)
        else {
            return XCTFail("expected an error response")
        }
        XCTAssertNil(id)
        XCTAssertEqual(error.code, RpcErrorCode.messageTooLarge)
    }

    func testRejectsInvalidJSON() {
        XCTAssertEqual(errorCode(#"{"jsonrpc":"#), RpcErrorCode.parseError)
    }

    func testRejectsNonObjects() {
        XCTAssertEqual(errorCode(#"[{"jsonrpc":"2.0"}]"#), RpcErrorCode.invalidRequest)
        XCTAssertEqual(errorCode("42"), RpcErrorCode.invalidRequest)
    }

    func testRejectsAWrongJsonrpcVersion() {
        XCTAssertEqual(errorCode(#"{"jsonrpc":"1.0","id":1,"result":{}}"#), RpcErrorCode.invalidRequest)
        XCTAssertEqual(errorCode(#"{"id":1,"result":{}}"#), RpcErrorCode.invalidRequest)
    }

    func testRejectsResponsesWithBothOrNeitherResultAndError() {
        XCTAssertEqual(errorCode(#"{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":1,"message":"x"}}"#), RpcErrorCode.invalidRequest)
        XCTAssertEqual(errorCode(#"{"jsonrpc":"2.0","id":1}"#), RpcErrorCode.invalidRequest)
    }

    func testRejectsUnknownNotifications() {
        XCTAssertEqual(errorCode(#"{"jsonrpc":"2.0","method":"chat.explode","params":{}}"#), RpcErrorCode.methodNotFound)
    }

    func testRejectsRequestsFromTheCompanion() {
        XCTAssertEqual(errorCode(#"{"jsonrpc":"2.0","id":1,"method":"chat.message","params":{}}"#), RpcErrorCode.invalidRequest)
    }

    func testRejectsNotificationsWithInvalidParams() {
        let line = #"{"jsonrpc":"2.0","method":"chat.done","params":{"instanceId":"i","turnId":"t","reason":"bored"}}"#
        XCTAssertEqual(errorCode(line), RpcErrorCode.invalidParams)
    }

    func testRejectsResultsThatDoNotMatchTheMethod() {
        let outcome = RpcCodec.decodeResult(ChatSendParams.self, from: .success(.object(["cancelled": .bool(true)])))
        XCTAssertEqual(outcome.failureCode, RpcErrorCode.invalidParams)
    }

    func testPassesErrorResultsThrough() {
        let error = RpcErrorObject.connectionClosed()
        XCTAssertEqual(RpcCodec.decodeResult(KeysStatusParams.self, from: .failure(error)).failureCode, RpcErrorCode.connectionClosed)
    }

    func testEncodedLinesNeverContainARawNewline() throws {
        let line = try RpcCodec.encodeRequest(id: 1, ChatSendParams(instanceId: "i", text: "two\nlines\r\n"))
        XCTAssertEqual(line.filter { $0 == 0x0A }.count, 1)
        XCTAssertEqual(line.last, 0x0A)
        var framer = LineFramer()
        guard case .line(let framed)? = framer.push(line).first else {
            return XCTFail("the framer did not return the encoded line")
        }
        guard case .success(.object(let message)) = Result(catching: { try JSONDecoder().decode(JSONValue.self, from: Data(framed.utf8)) }),
              case .object(let params)? = message["params"]
        else {
            return XCTFail("the framed line is not a JSON object")
        }
        XCTAssertEqual(params["text"], .string("two\nlines\r\n"))
    }

    func testKeysSetParamsNeverPrintTheKey() {
        let params = KeysSetParams(provider: .anthropic, key: "sk-ant-test")
        XCTAssertFalse(String(describing: params).contains("sk-ant-test"))
        XCTAssertFalse(String(reflecting: params).contains("sk-ant-test"))
    }

    private func errorCode(_ line: String) -> Int? {
        if case .failure(let error) = RpcCodec.decode(line: line) { return error.code }
        return nil
    }
}

private extension Result where Failure == RpcErrorObject {
    var failureCode: Int? {
        if case .failure(let error) = self { return error.code }
        return nil
    }
}
