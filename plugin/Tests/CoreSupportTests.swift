import XCTest

final class CoreSupportTests: XCTestCase {
    func testSocketPathIsInsideTheGroupContainer() {
        let container = URL(fileURLWithPath: "/Users/someone/Library/Group Containers/ABCDE12345.clogic", isDirectory: true)
        XCTAssertEqual(
            SocketPath.make(containerURL: container),
            .success("/Users/someone/Library/Group Containers/ABCDE12345.clogic/c.sock")
        )
    }

    func testSocketPathRejectsPathsOverTheSunPathLimit() {
        let container = URL(fileURLWithPath: "/" + String(repeating: "x", count: 120), isDirectory: true)
        guard case .failure(.tooLong(_, let limit)) = SocketPath.make(containerURL: container) else {
            return XCTFail("expected tooLong")
        }
        XCTAssertEqual(limit, 103)
    }

    func testAppGroupMustBeExpandedWithATeamId() {
        XCTAssertEqual(SocketPath.appGroup(fromInfo: ["ClogicAppGroupIdentifier": "ABCDE12345.clogic"]), .success("ABCDE12345.clogic"))
        XCTAssertEqual(SocketPath.appGroup(fromInfo: ["ClogicAppGroupIdentifier": ".clogic"]), .failure(.missingAppGroup))
        XCTAssertEqual(SocketPath.appGroup(fromInfo: ["ClogicAppGroupIdentifier": "$(DEVELOPMENT_TEAM).clogic"]), .failure(.missingAppGroup))
        XCTAssertEqual(SocketPath.appGroup(fromInfo: [:]), .failure(.missingAppGroup))
        XCTAssertEqual(SocketPath.appGroup(fromInfo: nil), .failure(.missingAppGroup))
    }

    func testNavigationIsLimitedToTheBundledWebFolder() {
        let root = URL(fileURLWithPath: "/Applications/clogic.app/Contents/PlugIns/clogic.appex/Contents/Resources/Web", isDirectory: true)
        XCTAssertTrue(NavigationPolicy.allows(root.appendingPathComponent("index.html"), webRoot: root))
        XCTAssertFalse(NavigationPolicy.allows(root.appendingPathComponent("../Info.plist"), webRoot: root))
        XCTAssertFalse(NavigationPolicy.allows(URL(fileURLWithPath: "/etc/hosts"), webRoot: root))
        XCTAssertFalse(NavigationPolicy.allows(URL(fileURLWithPath: root.path + "Evil/index.html"), webRoot: root))
        XCTAssertFalse(NavigationPolicy.allows(URL(string: "https://example.com/"), webRoot: root))
        XCTAssertFalse(NavigationPolicy.allows(nil, webRoot: root))
    }

    func testHelloCarriesTheCurrentProtocolVersionAndDropsInvalidSampleRates() {
        let hello = Handshake.hello(instanceId: "i-1", contextName: "Vox", sampleRate: .nan, client: "clogic.appex 0.0.1")
        XCTAssertEqual(hello.protocolVersion, ProtocolInfo.version)
        XCTAssertNil(hello.sampleRate)
        XCTAssertEqual(Handshake.hello(instanceId: "i-1", contextName: nil, sampleRate: 48_000, client: "c").sampleRate, 48_000)
    }

    func testHelloOutcomes() {
        XCTAssertEqual(
            Handshake.evaluate(.success(SessionHelloResult(protocolVersion: 1, companion: "clogic-companion 0.1.0"))),
            HelloOutcome(state: .ready, detail: nil, companion: "clogic-companion 0.1.0")
        )
        XCTAssertEqual(Handshake.evaluate(.success(SessionHelloResult(protocolVersion: 2, companion: "c"))).state, .incompatible)
        XCTAssertEqual(
            Handshake.evaluate(.failure(RpcErrorObject(code: RpcErrorCode.unsupportedProtocolVersion, message: "Unsupported protocol version 1"))).state,
            .incompatible
        )
        XCTAssertEqual(Handshake.evaluate(.failure(.connectionClosed())).state, .offline)
    }
}
