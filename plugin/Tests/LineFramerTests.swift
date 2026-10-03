import XCTest

final class LineFramerTests: XCTestCase {
    private func bytes(_ text: String) -> [UInt8] {
        Array(text.utf8)
    }

    private func feed(_ chunks: [[UInt8]], into framer: inout LineFramer) -> [FrameEvent] {
        chunks.flatMap { framer.push($0) }
    }

    private func feed(_ chunks: [[UInt8]], maxLineBytes: Int = LineFramer.defaultMaxLineBytes) -> (LineFramer, [FrameEvent]) {
        var framer = LineFramer(maxLineBytes: maxLineBytes)
        let events = feed(chunks, into: &framer)
        return (framer, events)
    }

    private func lines(_ events: [FrameEvent]) -> [String] {
        events.compactMap { event in
            if case .line(let line) = event { return line }
            return nil
        }
    }

    func testEmitsOneLinePerNewlineTerminatedMessage() {
        XCTAssertEqual(feed([bytes("{\"a\":1}\n")]).1, [.line("{\"a\":1}")])
    }

    func testSplitsSeveralMessagesDeliveredInOneChunk() {
        XCTAssertEqual(lines(feed([bytes("{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n")]).1), ["{\"a\":1}", "{\"b\":2}", "{\"c\":3}"])
    }

    func testReassemblesAMessageSplitAcrossChunksHoldingTheTail() {
        var (framer, events) = feed([bytes("{\"a\""), bytes(":1}\n{\"b\""), bytes(":2")])
        XCTAssertEqual(lines(events), ["{\"a\":1}"])
        XCTAssertEqual(lines(framer.push(bytes("}\n"))), ["{\"b\":2}"])
    }

    func testReassemblesAMultiByteCharacterSplitBetweenChunks() {
        let chunks = bytes("{\"t\":\"Ünïcødé 🎚\"}\n").map { [$0] }
        XCTAssertEqual(lines(feed(chunks).1), ["{\"t\":\"Ünïcødé 🎚\"}"])
    }

    func testStripsATrailingCarriageReturnAndSkipsBlankLines() {
        XCTAssertEqual(lines(feed([bytes("\n  \n{\"a\":1}\r\n\r\n")]).1), ["{\"a\":1}"])
    }

    func testReportsInvalidUTF8WithoutStoppingLaterLines() {
        let chunk: [UInt8] = [0xFF, 0xFE, 0x0A] + bytes("{\"ok\":true}\n")
        XCTAssertEqual(feed([chunk]).1, [.invalidUTF8(bytes: 2), .line("{\"ok\":true}")])
    }

    func testHandlesManyLinesInASingleChunk() {
        let count = 50_000
        XCTAssertEqual(feed([bytes(String(repeating: "{}\n", count: count))]).1.count, count)
    }

    func testAcceptsALineExactlyAtTheLimit() {
        XCTAssertEqual(lines(feed([bytes("{\"a\":1}\n")], maxLineBytes: 7).1), ["{\"a\":1}"])
    }

    func testDropsACompleteLineOverTheLimitAndKeepsTheNextOne() {
        XCTAssertEqual(
            feed([bytes("{\"a\":\"too long\"}\n{\"b\":2}\n")], maxLineBytes: 8).1,
            [.oversized(bytes: 16), .line("{\"b\":2}")]
        )
    }

    func testDiscardsAnOversizedLineSpreadOverManyChunksWithoutBufferingIt() {
        var (framer, events) = feed(
            [bytes("{\"a\":\""), bytes(String(repeating: "x", count: 40)), bytes(String(repeating: "x", count: 40))],
            maxLineBytes: 16
        )
        XCTAssertEqual(events, [])
        XCTAssertEqual(framer.pending.count, 0)
        XCTAssertTrue(framer.discarding)
        XCTAssertEqual(framer.push(bytes("\"}\n{\"b\":2}\n")), [.oversized(bytes: 88), .line("{\"b\":2}")])
    }

    func testEndReportsNothingOnALineBoundary() {
        XCTAssertEqual(feed([bytes("{}\n")]).0.end(), [])
    }

    func testEndReportsATruncatedFinalMessage() {
        XCTAssertEqual(feed([bytes("{}\n{\"a\"")]).0.end(), [.truncated(bytes: 4)])
    }

    func testEndReportsAnOversizedMessageCutOffByTheEndOfTheStream() {
        XCTAssertEqual(feed([bytes(String(repeating: "x", count: 10))], maxLineBytes: 4).0.end(), [.oversized(bytes: 10)])
    }
}
