import Foundation
import CoreBluetooth

// MARK: - Swift String <-> RayneoSwiftString bridging

// On arm64, Swift String is 16 bytes: two 64-bit words.
// We use `withUnsafeBytes` to get the raw representation and pass it
// to/from the ObjC bridge. On return, we reconstruct a Swift String.

@inline(__always)
private func swiftStringToRayneo(_ s: String) -> RayneoSwiftString {
    // Swift String is exactly 16 bytes (two 64-bit words) on arm64.
    // We copy the raw bit pattern directly, preserving the small/large
    // discriminator and all flags. This is the same representation the
    // framework's Swift functions expect.
    var copy = s
    return withUnsafeBytes(of: &copy) { buffer -> RayneoSwiftString in
        let w0 = buffer.load(fromByteOffset: 0, as: UInt64.self)
        let w1 = buffer.load(fromByteOffset: 8, as: UInt64.self)
        return RayneoSwiftString(word0: w0, word1: w1)
    }
}

@inline(__always)
private func rayneoToSwiftString(_ rs: RayneoSwiftString) -> String {
    // Reconstruct a Swift String from its raw two-word representation.
    // We write the words into memory and use String's unsafe initializer.
    // On arm64, Swift String is exactly 16 bytes with the small/large
    // discriminator in bit 63 of word1 (the "isFlag" / discriminator bit).
    var words = (rs.word0, rs.word1)
    return withUnsafeBytes(of: &words) { buffer -> String in
        // Use the unsafe initializer that reads 16 raw bytes as a String.
        // This preserves the exact bit pattern, including small-string
        // discriminator and flags.
        let raw = buffer.baseAddress!.assumingMemoryBound(to: String.self)
        return raw.pointee
    }
}

// MARK: - Opaque handles

/// Opaque handle to RNCoreConnect. Never allocate this — only obtained from the framework.
final class CoreHandle {
    private let pointer: UnsafeMutableRawPointer

    private init(_ pointer: UnsafeMutableRawPointer) {
        self.pointer = pointer
    }

    static func shared() -> CoreHandle? {
        guard let address = RayneoBridgeCoreSharedAddress() else { return nil }
        typealias Getter = @convention(thin) () -> UnsafeMutableRawPointer
        let ptr = unsafeBitCast(address, to: Getter.self)()
        return CoreHandle(ptr)
    }

    var sdkVersion: String? {
        guard let address = RayneoBridgeCoreVersionAddress() else { return nil }
        // SDKVersion() returns String? (Optional<String>).
        // On arm64, Swift's Optional<String> uses a spare bit in word1 to
        // distinguish .some from .none. The framework function returns the
        // optional directly in x0/x1. We call it as a function returning
        // a RayneoSwiftString, then check the nil discriminator.
        // For Optional<String>, .none has word1 == 0 (both words zero).
        // A non-nil empty string would have a non-zero discriminator.
        typealias Getter = @convention(thin) () -> RayneoSwiftString
        let rs = unsafeBitCast(address, to: Getter.self)()
        // Check for nil: in Swift's Optional<String> ABI, .none is represented
        // by the entire 16-byte payload being zero (both words = 0).
        if rs.word0 == 0 && rs.word1 == 0 { return nil }
        let result = rayneoToSwiftString(rs)
        return result
    }

    // MARK: Device queries

    var bondedDeviceCount: Int {
        Int(RayneoBridgeBondedDeviceCount(pointer))
    }

    var linkedDeviceCount: Int {
        Int(RayneoBridgeLinkedDeviceCount(pointer))
    }

    func bondedDevice(at index: Int) -> DeviceHandle? {
        guard let ptr = RayneoBridgeBondedDeviceAt(pointer, UInt64(index)) else { return nil }
        return DeviceHandle(ptr)
    }

    func linkedDevice(at index: Int) -> DeviceHandle? {
        guard let ptr = RayneoBridgeLinkedDeviceAt(pointer, UInt64(index)) else { return nil }
        return DeviceHandle(ptr)
    }

    var bondedDevices: [DeviceHandle] {
        let count = bondedDeviceCount
        return (0..<count).compactMap { bondedDevice(at: $0) }
    }

    var linkedDevices: [DeviceHandle] {
        let count = linkedDeviceCount
        return (0..<count).compactMap { linkedDevice(at: $0) }
    }

    func findDevice(_ id: String) -> DeviceHandle? {
        let rs = swiftStringToRayneo(id)
        guard let ptr = RayneoBridgeFindDevice(pointer, rs) else { return nil }
        return DeviceHandle(ptr)
    }

    // MARK: Connection

    func discover() throws {
        var error: NSError?
        _ = RayneoBridgeDiscover(pointer, &error)
        if let error = error { throw error }
    }

    func connectBLE(_ device: DeviceHandle) throws {
        var error: NSError?
        let userID = swiftStringToRayneo("")
        _ = RayneoBridgeConnectBLE(pointer, device.pointer, userID, 0, &error)
        if let error = error { throw error }
    }

    func unbind(_ device: DeviceHandle) throws {
        var error: NSError?
        _ = RayneoBridgeUnbind(pointer, device.pointer, &error)
        if let error = error { throw error }
    }

    // MARK: Messaging

    func sendMessage(_ message: MessageHandle) throws {
        var error: NSError?
        _ = RayneoBridgeSendMessage(pointer, message.pointer, &error)
        if let error = error { throw error }
    }

    // MARK: Account

    func setAccountID(_ value: String) {
        RayneoBridgeSetAccountID(pointer, swiftStringToRayneo(value))
    }

    // MARK: File sharing

    func shareFile(_ url: URL, device: String, target: UInt8, extra: String) -> String? {
        let rs = RayneoBridgeShareFile(pointer, url,
                                        swiftStringToRayneo(device), target,
                                        swiftStringToRayneo(extra))
        // shareFile returns String? — .none is both words zero.
        if rs.word0 == 0 && rs.word1 == 0 { return nil }
        return rayneoToSwiftString(rs)
    }

    func cancelShare(device: String, task: String) {
        RayneoBridgeCancelShare(pointer, swiftStringToRayneo(device), swiftStringToRayneo(task))
    }
}

/// Opaque handle to RNDevice. Never allocate this — only obtained from the framework.
final class DeviceHandle {
    let pointer: UnsafeMutableRawPointer

    init(_ pointer: UnsafeMutableRawPointer) {
        self.pointer = pointer
    }

    var deviceID: String {
        rayneoToSwiftString(RayneoBridgeDeviceID(pointer))
    }

    var name: String {
        rayneoToSwiftString(RayneoBridgeDeviceName(pointer))
    }

    var isConnected: Bool {
        RayneoBridgeDeviceConnected(pointer)
    }

    var bleStateByte: UInt8 {
        RayneoBridgeDeviceBleState(pointer)
    }

    var transport: TransportHandle? {
        guard let ptr = RayneoBridgeDeviceTransport(pointer) else { return nil }
        return TransportHandle(ptr)
    }
}

/// Opaque handle to RNPeripheral. Never allocate this.
final class TransportHandle {
    let pointer: UnsafeMutableRawPointer

    init(_ pointer: UnsafeMutableRawPointer) {
        self.pointer = pointer
    }

    var peripheral: CBPeripheral? {
        RayneoBridgeTransportPeripheral(pointer)
    }

    var transportState: UInt8 {
        RayneoBridgeTransportState(pointer)
    }
}

/// Opaque handle to RNMessage. Never allocate this — only from MessageFactory.
final class MessageHandle {
    let pointer: UnsafeMutableRawPointer

    init(_ pointer: UnsafeMutableRawPointer) {
        self.pointer = pointer
    }

    var deviceID: String {
        rayneoToSwiftString(RayneoBridgeMessageDeviceID(pointer))
    }

    var businessIndex: UInt8 {
        RayneoBridgeMessageBusinessIndex(pointer)
    }

    var messageID: String {
        rayneoToSwiftString(RayneoBridgeMessageID(pointer))
    }

    // NOTE: payload getter requires the same Data? ABI handling as the initializer.
    // The ObjC bridge provides RayneoBridgeMessagePayloadBuffer/Count for future
    // use when message receiving (addMessageDelegate) is implemented.

    func setMessageID(_ id: String) {
        RayneoBridgeSetMessageID(pointer, swiftStringToRayneo(id))
    }
}

// MARK: - Message Factory

/// Enum indices in RayneoNet v1.2.35, NOT transport raw IDs or assistant types.
enum MessageBusinessIndex: UInt8, CaseIterable {
    case voiceAssistant = 13
    case recordingService = 14
    case launcher = 15
    case aiSubtitle = 19
    case teleprompter = 20
    case notification = 21
    case scheduleTodo = 22
}

enum MessageFactoryError: Error { case unverifiedImage, creationFailed }

enum MessageFactory {
    /// Creates an RNMessage via the framework's allocating initializer.
    static func make(payload: Data?, deviceID: String, business: MessageBusinessIndex,
                     messageID: String) throws -> MessageHandle {
        guard RayneoBridgeImageMatches() else { throw MessageFactoryError.unverifiedImage }
        guard let address = RayneoBridgeCreateMessageAddress() else {
            throw MessageFactoryError.creationFailed
        }
        // RNMessage.__allocating_init(payload: Data?, deviceID: String,
        //   businessIndex: UInt8, msgID: String, appUniteCode: String)
        // The init discards msgID and appUniteCode (verified disassembly).
        // We type the function pointer with Data? directly so Swift handles
        // the Data ABI (inline vs heap storage) correctly.
        let rsDeviceID = swiftStringToRayneo(deviceID)
        let rsEmpty = RayneoSwiftString(word0: 0, word1: 0)

        // Data? is 16 bytes. When passed via @convention(thin), Swift handles
        // the internal representation. We define the function type with Data?
        // as the first parameter.
        typealias Initializer = @convention(thin) (
            Data?,                      // payload
            RayneoSwiftString,          // deviceID
            UInt8,                      // businessIndex
            RayneoSwiftString,          // msgID (discarded by init)
            RayneoSwiftString           // appUniteCode (discarded by init)
        ) -> UnsafeMutableRawPointer?

        let ptr = unsafeBitCast(address, to: Initializer.self)(
            payload, rsDeviceID, business.rawValue, rsEmpty, rsEmpty
        )

        guard let p = ptr else { throw MessageFactoryError.creationFailed }
        let message = MessageHandle(p)
        message.setMessageID(messageID)
        return message
    }
}
