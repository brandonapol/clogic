import AudioToolbox
import AVFoundation
import Foundation

final class PassthroughAudioUnit: AUAudioUnit {
    static let instanceIdStateKey = "clogicInstanceId"

    var onInstanceIdChange: ((String) -> Void)?

    private(set) var instanceId = UUID().uuidString.lowercased()

    private let inputBus: AUAudioUnitBus
    private let outputBus: AUAudioUnitBus
    private let kernel = PassthroughKernel()
    private var inputBusArray: AUAudioUnitBusArray?
    private var outputBusArray: AUAudioUnitBusArray?

    override init(
        componentDescription: AudioComponentDescription,
        options: AudioComponentInstantiationOptions = []
    ) throws {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2) else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(kAudioUnitErr_FormatNotSupported))
        }
        inputBus = try AUAudioUnitBus(format: format)
        outputBus = try AUAudioUnitBus(format: format)
        try super.init(componentDescription: componentDescription, options: options)
        inputBusArray = AUAudioUnitBusArray(audioUnit: self, busType: .input, busses: [inputBus])
        outputBusArray = AUAudioUnitBusArray(audioUnit: self, busType: .output, busses: [outputBus])
    }

    override var inputBusses: AUAudioUnitBusArray {
        inputBusArray ?? super.inputBusses
    }

    override var outputBusses: AUAudioUnitBusArray {
        outputBusArray ?? super.outputBusses
    }

    override var canProcessInPlace: Bool { true }

    override var channelCapabilities: [NSNumber]? { [-1, -1] }

    override var latency: TimeInterval { 0 }

    override var tailTime: TimeInterval { 0 }

    var sampleRate: Double { outputBus.format.sampleRate }

    override func supportedViewConfigurations(_ availableViewConfigurations: [AUAudioUnitViewConfiguration]) -> IndexSet {
        IndexSet()
    }

    override func allocateRenderResources() throws {
        let input = inputBus.format
        let output = outputBus.format
        guard input.channelCount == output.channelCount,
              input.commonFormat == .pcmFormatFloat32,
              !input.isInterleaved
        else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(kAudioUnitErr_FormatNotSupported))
        }
        try super.allocateRenderResources()
        try kernel.allocate(format: input, maximumFrames: maximumFramesToRender)
    }

    override func deallocateRenderResources() {
        kernel.deallocate()
        super.deallocateRenderResources()
    }

    override var internalRenderBlock: AUInternalRenderBlock {
        let kernel = self.kernel
        return { [unowned(unsafe) kernel] actionFlags, timestamp, frameCount, _, outputData, _, pullInputBlock in
            kernel.render(
                actionFlags: actionFlags,
                timestamp: timestamp,
                frameCount: frameCount,
                outputData: outputData,
                pullInput: pullInputBlock
            )
        }
    }

    override var fullState: [String: Any]? {
        get {
            var state = super.fullState ?? [:]
            state[Self.instanceIdStateKey] = instanceId
            return state
        }
        set {
            super.fullState = newValue
            guard let restored = newValue?[Self.instanceIdStateKey] as? String,
                  !restored.isEmpty,
                  restored != instanceId
            else { return }
            instanceId = restored
            onInstanceIdChange?(restored)
        }
    }
}

final class PassthroughKernel {
    private var buffer: AVAudioPCMBuffer?
    private var bufferList: UnsafeMutablePointer<AudioBufferList>?
    private var channelData: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
    private var channelCount = 0
    private var bytesPerFrame: UInt32 = 0
    private var maximumFrames: AUAudioFrameCount = 0

    func allocate(format: AVAudioFormat, maximumFrames: AUAudioFrameCount) throws {
        deallocate()
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: maximumFrames) else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(kAudioUnitErr_FailedInitialization))
        }
        let list = buffer.mutableAudioBufferList
        let buffers = UnsafeMutableAudioBufferListPointer(list)
        let data = UnsafeMutablePointer<UnsafeMutableRawPointer?>.allocate(capacity: buffers.count)
        for index in 0..<buffers.count {
            data[index] = buffers[index].mData
        }
        self.buffer = buffer
        bufferList = list
        channelData = data
        channelCount = buffers.count
        bytesPerFrame = format.streamDescription.pointee.mBytesPerFrame
        self.maximumFrames = maximumFrames
    }

    func deallocate() {
        channelData?.deallocate()
        channelData = nil
        bufferList = nil
        buffer = nil
        channelCount = 0
        maximumFrames = 0
    }

    func render(
        actionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
        timestamp: UnsafePointer<AudioTimeStamp>,
        frameCount: AUAudioFrameCount,
        outputData: UnsafeMutablePointer<AudioBufferList>,
        pullInput: AURenderPullInputBlock?
    ) -> AUAudioUnitStatus {
        guard let pullInput else { return kAudioUnitErr_NoConnection }
        guard let list = bufferList, let data = channelData, frameCount <= maximumFrames else {
            return kAudioUnitErr_TooManyFramesToProcess
        }
        let input = UnsafeMutableAudioBufferListPointer(list)
        let byteSize = frameCount * bytesPerFrame
        for index in 0..<channelCount {
            input[index].mData = data[index]
            input[index].mDataByteSize = byteSize
        }
        let status = pullInput(actionFlags, timestamp, frameCount, 0, list)
        guard status == noErr else { return status }

        let output = UnsafeMutableAudioBufferListPointer(outputData)
        for index in 0..<min(channelCount, output.count) {
            let source = input[index]
            if output[index].mData == nil {
                output[index].mData = source.mData
            } else if let destination = output[index].mData,
                      let sourceData = source.mData,
                      destination != sourceData {
                memcpy(destination, sourceData, Int(source.mDataByteSize))
            }
            output[index].mDataByteSize = source.mDataByteSize
        }
        return noErr
    }
}
