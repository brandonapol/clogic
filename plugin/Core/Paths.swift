import Foundation

public enum SocketPathError: Error, Equatable, Sendable {
    case missingAppGroup
    case noContainer(group: String)
    case tooLong(bytes: Int, limit: Int)
}

public enum SocketPath {
    public static let fileName = "c.sock"
    public static let sunPathCapacity = 104
    public static let appGroupInfoKey = "ClogicAppGroupIdentifier"

    public static func make(containerURL: URL) -> Result<String, SocketPathError> {
        let path = containerURL.appendingPathComponent(fileName, isDirectory: false).path
        let bytes = path.utf8.count
        guard bytes < sunPathCapacity else {
            return .failure(.tooLong(bytes: bytes, limit: sunPathCapacity - 1))
        }
        return .success(path)
    }

    public static func appGroup(fromInfo info: [String: Any]?) -> Result<String, SocketPathError> {
        guard let group = info?[appGroupInfoKey] as? String,
              !group.isEmpty,
              !group.hasPrefix("."),
              !group.contains("$(")
        else {
            return .failure(.missingAppGroup)
        }
        return .success(group)
    }
}

public enum NavigationPolicy {
    public static func allows(_ url: URL?, webRoot: URL) -> Bool {
        guard let url, url.isFileURL else { return false }
        let root = webRoot.standardizedFileURL.resolvingSymlinksInPath().path
        let target = url.standardizedFileURL.resolvingSymlinksInPath().path
        return target == root || target.hasPrefix(root.hasSuffix("/") ? root : root + "/")
    }
}
