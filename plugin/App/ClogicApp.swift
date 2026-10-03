import SwiftUI

@main
struct ClogicApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(alignment: .leading, spacing: 12) {
                Text("clogic")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text("This app contains the clogic Audio Unit extension. Opening it once registers the extension with macOS.")
                Text("This is an unverified development build. The clogic companion is not bundled yet, so the plugin window shows the companion as offline until one is running.")
                    .foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(width: 440, alignment: .leading)
        }
        .windowResizability(.contentSize)
    }
}
