import Foundation
import XCTest

enum Vectors {
    static func load(file: StaticString = #filePath, line: UInt = #line) throws -> [String: JSONValue] {
        let bundle = Bundle(for: BundleMarker.self)
        let beside = URL(fileURLWithPath: "\(file)").deletingLastPathComponent().appendingPathComponent("Vectors/rpc-vectors.json")
        let url = try XCTUnwrap(
            bundle.url(forResource: "rpc-vectors", withExtension: "json", subdirectory: "Vectors")
                ?? bundle.url(forResource: "rpc-vectors", withExtension: "json")
                ?? (FileManager.default.fileExists(atPath: beside.path) ? beside : nil),
            "rpc-vectors.json is missing from the test bundle",
            file: file,
            line: line
        )
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        guard case .object(let root) = value else {
            throw VectorError(message: "rpc-vectors.json is not an object")
        }
        return root
    }

    static func section(_ name: String) throws -> [String: JSONValue] {
        guard case .object(let section)? = try load()[name] else {
            throw VectorError(message: "rpc-vectors.json has no \(name) section")
        }
        return section
    }

    static func request(_ method: RequestMethod) throws -> (params: JSONValue, result: JSONValue) {
        guard case .object(let entry)? = try section("requests")[method.rawValue],
              let params = entry["params"],
              let result = entry["result"]
        else {
            throw VectorError(message: "rpc-vectors.json has no request \(method.rawValue)")
        }
        return (params, result)
    }

    static func decodeLine(_ data: Data) throws -> JSONValue {
        XCTAssertEqual(data.last, 0x0A)
        XCTAssertEqual(data.filter { $0 == 0x0A }.count, 1)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}

final class BundleMarker {}

struct VectorError: Error {
    let message: String
}
