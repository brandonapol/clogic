import AppKit
import CoreAudioKit

public final class AudioUnitViewController: AUViewController, AUAudioUnitFactory {
    static let defaultSize = NSSize(width: 440, height: 680)

    private var audioUnit: PassthroughAudioUnit?
    private var bridge: ChatBridge?

    public override func loadView() {
        let bridge = ChatBridge(frame: NSRect(origin: .zero, size: Self.defaultSize))
        self.bridge = bridge
        view = bridge.webView
        preferredContentSize = Self.defaultSize
        if let audioUnit {
            bridge.attach(audioUnit)
        }
        bridge.loadInterface()
    }

    public override func viewWillDisappear() {
        super.viewWillDisappear()
        bridge?.releaseKeyboard()
    }

    nonisolated public func createAudioUnit(with componentDescription: AudioComponentDescription) throws -> AUAudioUnit {
        let unit = try PassthroughAudioUnit(componentDescription: componentDescription, options: [])
        DispatchQueue.main.async { [weak self] in
            self?.attach(unit)
        }
        return unit
    }

    private func attach(_ unit: PassthroughAudioUnit) {
        audioUnit = unit
        bridge?.attach(unit)
    }
}
