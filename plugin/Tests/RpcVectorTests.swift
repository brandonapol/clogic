import XCTest

final class RpcVectorTests: XCTestCase {
    func testProtocolVersionMatchesTheCompanion() throws {
        XCTAssertEqual(try Vectors.load()["protocolVersion"], .number(Double(ProtocolInfo.version)))
    }

    func testErrorCodesMatchTheCompanion() throws {
        let codes = try Vectors.section("errorCodes")
        let expected: [String: Int] = [
            "parseError": RpcErrorCode.parseError,
            "invalidRequest": RpcErrorCode.invalidRequest,
            "methodNotFound": RpcErrorCode.methodNotFound,
            "invalidParams": RpcErrorCode.invalidParams,
            "internalError": RpcErrorCode.internalError,
            "unsupportedProtocolVersion": RpcErrorCode.unsupportedProtocolVersion,
            "handshakeRequired": RpcErrorCode.handshakeRequired,
            "messageTooLarge": RpcErrorCode.messageTooLarge,
            "connectionClosed": RpcErrorCode.connectionClosed,
        ]
        XCTAssertEqual(codes, expected.mapValues { JSONValue.number(Double($0)) })
    }

    func testEveryRequestMethodHasAVector() throws {
        let methods = Set(try Vectors.section("requests").keys)
        XCTAssertEqual(methods, Set(RequestMethod.allCases.map(\.rawValue)))
    }

    func testEveryCompanionNotificationHasAVector() throws {
        let methods = Set(try Vectors.section("companionNotifications").keys)
        XCTAssertEqual(methods, Set(CompanionNotificationMethod.allCases.map(\.rawValue)))
    }

    func testEveryPluginNotificationHasAVector() throws {
        let methods = Set(try Vectors.section("pluginNotifications").keys)
        XCTAssertEqual(methods, Set(PluginNotificationMethod.allCases.map(\.rawValue)))
    }

    func testRequestsEncodeExactlyLikeTheVectorsAndResultsDecode() throws {
        for method in RequestMethod.allCases {
            switch method {
            case .sessionHello: try assertRequest(SessionHelloParams.self)
            case .chatSend: try assertRequest(ChatSendParams.self)
            case .chatCancel: try assertRequest(ChatCancelParams.self)
            case .changeDecide: try assertRequest(ChangeDecideParams.self)
            case .keysSet: try assertRequest(KeysSetParams.self)
            case .keysStatus: try assertRequest(KeysStatusParams.self)
            case .providerSelect: try assertRequest(ProviderSelectParams.self)
            }
        }
    }

    func testCompanionNotificationsDecodeFromTheVectors() throws {
        let vectors = try Vectors.section("companionNotifications")
        for method in CompanionNotificationMethod.allCases {
            let params = try XCTUnwrap(vectors[method.rawValue])
            let line = try JSONCoding.encoder().encode(JSONValue.object([
                "jsonrpc": .string("2.0"),
                "method": .string(method.rawValue),
                "params": params,
            ]))
            let decoded = RpcCodec.decode(line: String(decoding: line, as: UTF8.self))
            guard case .success(.notification(let notification)) = decoded else {
                XCTFail("\(method.rawValue) did not decode: \(decoded)")
                continue
            }
            XCTAssertEqual(notification.method, method)
            XCTAssertEqual(try notification.params(), params, method.rawValue)
        }
    }

    func testPluginNotificationsEncodeExactlyLikeTheVectors() throws {
        let vectors = try Vectors.section("pluginNotifications")
        try assertNotification(MeterParams.self, vector: try XCTUnwrap(vectors["meter"]))
        try assertNotification(ContextChangedParams.self, vector: try XCTUnwrap(vectors["context.changed"]))
    }

    func testNullableFieldsAreSentAsExplicitNulls() throws {
        let hello = Handshake.hello(instanceId: "i-1", contextName: nil, sampleRate: nil, client: "test")
        let helloParams = try paramsOf(RpcCodec.encodeRequest(id: 1, hello))
        XCTAssertEqual(helloParams["contextName"], .null)
        XCTAssertEqual(helloParams["sampleRate"], .null)

        let cancel = try paramsOf(RpcCodec.encodeRequest(id: 2, ChatCancelParams(instanceId: "i-1", turnId: nil)))
        XCTAssertEqual(cancel["turnId"], .null)

        let meter = try paramsOf(RpcCodec.encodeNotification(MeterParams(instanceId: "i-1", momentaryLufs: nil, bands: [])))
        XCTAssertEqual(meter["momentaryLufs"], .null)

        let context = try paramsOf(RpcCodec.encodeNotification(ContextChangedParams(instanceId: "i-1", contextName: nil)))
        XCTAssertEqual(context["contextName"], .null)
    }

    private func assertRequest<Params: RpcRequestParams & Decodable>(_ type: Params.Type) throws where Params.Response: Encodable {
        let vector = try Vectors.request(Params.method)
        let params = try JSONCoding.convert(vector.params, to: Params.self)
        let line = try Vectors.decodeLine(try RpcCodec.encodeRequest(id: 7, params))
        XCTAssertEqual(
            line,
            .object([
                "jsonrpc": .string("2.0"),
                "id": .number(7),
                "method": .string(Params.method.rawValue),
                "params": vector.params,
            ]),
            Params.method.rawValue
        )
        let response = try RpcCodec.decodeResult(Params.self, from: .success(vector.result)).get()
        XCTAssertEqual(try JSONCoding.value(of: response), vector.result, Params.method.rawValue)
    }

    private func assertNotification<Params: PluginNotificationParams & Decodable>(_ type: Params.Type, vector: JSONValue) throws {
        let params = try JSONCoding.convert(vector, to: Params.self)
        let line = try Vectors.decodeLine(try RpcCodec.encodeNotification(params))
        XCTAssertEqual(
            line,
            .object([
                "jsonrpc": .string("2.0"),
                "method": .string(Params.method.rawValue),
                "params": vector,
            ])
        )
    }

    private func paramsOf(_ data: Data) throws -> [String: JSONValue] {
        guard case .object(let message) = try Vectors.decodeLine(data),
              case .object(let params)? = message["params"]
        else {
            throw VectorError(message: "message has no params object")
        }
        return params
    }
}
