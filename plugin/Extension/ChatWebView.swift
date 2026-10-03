import AppKit
import WebKit

final class ChatWebView: WKWebView {
    var ownsKeyboard = false

    override var acceptsFirstResponder: Bool { true }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func keyDown(with event: NSEvent) {
        if ownsKeyboard {
            super.keyDown(with: event)
        } else {
            nextResponder?.keyDown(with: event)
        }
    }

    override func keyUp(with event: NSEvent) {
        if ownsKeyboard {
            super.keyUp(with: event)
        } else {
            nextResponder?.keyUp(with: event)
        }
    }
}
