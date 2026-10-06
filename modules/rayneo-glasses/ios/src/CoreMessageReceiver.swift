import Foundation

extension CoreHandle {
    @_silgen_name("$s9RayneoNet13RNCoreConnectC3add15messageDelegateyAA09RNMessageG0_p_tF")
    func addMessageDelegate(_ delegate: any RNMessageDelegate)
    @_silgen_name("$s9RayneoNet13RNCoreConnectC6remove15messageDelegateyAA09RNMessageG0_p_tF")
    func removeMessageDelegate(_ delegate: any RNMessageDelegate)
    @_silgen_name("$s9RayneoNet13RNCoreConnectC4send7messageyAA9RNMessageC_tKF")
    func sendMessage(_ message: MessageHandle) throws
}

/// Simplified message receiver — tracks connection state and send results.
/// Voice/audio envelope parsing removed to avoid RayNeoProtocol dependency.
final class CoreMessageReceiver: RNMessageDelegate {
    var onMetadata: ((String) -> Void)?
    var onBusinessEnvelope: ((String, UInt8, Data) -> Void)?
    var onBusinessLoss: (() -> Void)?
    private func emit(_ text: String) {
        DispatchQueue.main.async { [weak self] in self?.onMetadata?(text) }
    }
    func message(_ core: RNCoreConnect, receive: RNMessage) {
        let handle = unsafeBitCast(receive, to: MessageHandle.self)
        let business = handle.businessIndex()
        let payload = handle.payload() ?? Data()
        let id = handle.deviceID()
        if [14, 15, 20, 21, 22].contains(business), let cb = onBusinessEnvelope {
            DispatchQueue.main.async { cb(id, business, payload) }
        }
        emit("glasses→app business=\(business) bytes=\(payload.count)")
    }
    func message(_ core: RNCoreConnect, deviceListChanged: [RNDevice], _ reason: String) {
        emit("device list changed count=\(deviceListChanged.count)")
    }
    func message(_ core: RNCoreConnect, sendSuccess: RNMessage) {
        emit("SDK sendSuccess")
    }
    func message(_ core: RNCoreConnect, sendError: RNMessage, _ code: Int, _ reason: String) {
        emit("SDK sendError code=\(code)")
    }
    func messageDecryptFail(_ core: RNCoreConnect, device: RNDevice, sourceData: Data, sourceLen: Int, destLen: Int) {
        emit("SDK decrypt fail sourceLen=\(sourceLen) destLen=\(destLen)")
    }
}
