import Foundation

public enum FrameEvent: Equatable, Sendable {
    case line(String)
    case oversized(bytes: Int)
    case invalidUTF8(bytes: Int)
    case truncated(bytes: Int)
}

public struct LineFramer: Sendable {
    public static let defaultMaxLineBytes = 1024 * 1024

    private static let newline: UInt8 = 0x0A
    private static let carriageReturn: UInt8 = 0x0D

    public let maxLineBytes: Int
    public private(set) var pending: [UInt8] = []
    public private(set) var discarding = false
    public private(set) var discarded = 0

    public init(maxLineBytes: Int = LineFramer.defaultMaxLineBytes) {
        self.maxLineBytes = maxLineBytes
    }

    public mutating func push<Chunk: Collection>(_ chunk: Chunk) -> [FrameEvent]
    where Chunk.Element == UInt8 {
        var events: [FrameEvent] = []
        var start = chunk.startIndex
        while let end = chunk[start...].firstIndex(of: LineFramer.newline) {
            if let event = completeLine(chunk[start..<end]) {
                events.append(event)
            }
            pending = []
            discarding = false
            discarded = 0
            start = chunk.index(after: end)
        }
        holdRemainder(chunk[start...])
        return events
    }

    public func end() -> [FrameEvent] {
        if discarding { return [.oversized(bytes: discarded)] }
        if pending.isEmpty { return [] }
        return [.truncated(bytes: pending.count)]
    }

    private func completeLine<Segment: Collection>(_ segment: Segment) -> FrameEvent?
    where Segment.Element == UInt8 {
        if discarding { return .oversized(bytes: discarded + segment.count) }
        let total = pending.count + segment.count
        if total > maxLineBytes { return .oversized(bytes: total) }
        return LineFramer.decodeLine(pending + segment)
    }

    private mutating func holdRemainder<Rest: Collection>(_ rest: Rest)
    where Rest.Element == UInt8 {
        if discarding {
            discarded += rest.count
            return
        }
        let total = pending.count + rest.count
        if total > maxLineBytes {
            pending = []
            discarding = true
            discarded = total
            return
        }
        pending.append(contentsOf: rest)
    }

    static func decodeLine(_ bytes: [UInt8]) -> FrameEvent? {
        let body = bytes.last == LineFramer.carriageReturn ? bytes.dropLast() : bytes[...]
        guard let line = String(bytes: body, encoding: .utf8) else {
            return .invalidUTF8(bytes: bytes.count)
        }
        return line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .line(line)
    }
}
