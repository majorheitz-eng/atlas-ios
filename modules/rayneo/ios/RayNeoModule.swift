import CoreBluetooth
import ExpoModulesCore
import ExternalAccessory

// MARK: - RayNeo iO profile

private enum RayNeoIOProfile {
  static let service = CBUUID(string: "B81D")
  static let serviceFull = CBUUID(string: "0000B81D-0000-1000-8000-00805F9B34FB")
  static let outbound = CBUUID(string: "EA8B70D5-2BD3-49AB-9C31-9C38B2C3C4F9")
  static let inbound = CBUUID(string: "7DB3E235-3608-41F3-A03C-955FCBD2EA4B")
  static let accessoryProtocol = "com.rayneo.venus.pub"
}

// MARK: - CRC-16/XMODEM

private enum CRC16XMODEM {
  static func checksum(_ bytes: Data) -> UInt16 {
    var crc: UInt16 = 0
    for byte in bytes {
      crc ^= UInt16(byte) << 8
      for _ in 0..<8 {
        if crc & 0x8000 != 0 {
          crc = (crc << 1) ^ 0x1021
        } else {
          crc <<= 1
        }
      }
    }
    return crc
  }
}

// MARK: - Business envelope

private enum BusinessEnvelope {
  static func encode(type: UInt8, body: Data, sequence: UInt32 = 0) -> Data {
    var out = Data([8, 1, 16, type, 26])
    appendVarint(UInt64(body.count), to: &out)
    out.append(body)
    if sequence != 0 {
      out.append(40)
      appendVarint(UInt64(sequence), to: &out)
    }
    return out
  }

  private static func appendVarint(_ value: UInt64, to out: inout Data) {
    var v = value
    repeat {
      let b = UInt8(v & 0x7F)
      v >>= 7
      out.append(v > 0 ? (b | 0x80) : b)
    } while v > 0
  }
}

// MARK: - Transport frame

private struct TransportFrame {
  let messageNumber: UInt16
  let flags: UInt8
  let wireBusinessID: UInt8
  let payload: Data

  func encoded() -> Data {
    let length = 10 + payload.count - 6
    var result = Data([
      0xAA, 0x55,
      UInt8(truncatingIfNeeded: length >> 8),
      UInt8(truncatingIfNeeded: length & 0xFF),
      UInt8(truncatingIfNeeded: messageNumber >> 8),
      UInt8(truncatingIfNeeded: messageNumber & 0xFF),
      flags
    ])
    result.append(wireBusinessID)
    result.append(payload)
    let crc = CRC16XMODEM.checksum(result.dropFirst(4))
    result.append(UInt8(crc >> 8))
    result.append(UInt8(crc & 0xFF))
    return result
  }
}

// MARK: - Assistant payload encoders

private enum AssistantEncoders {
  static func asrText(_ text: String, isFinal: Bool) throws -> Data {
    guard text.utf8.count <= 1024 else { throw RayNeoError.textTooLong }
    let body = try encodeJSONSorted(["text": text, "final": isFinal] as [String: Any])
    var packet = Data([8, 1, 16, 5, 26])
    appendVarint(UInt64(body.count), to: &packet)
    packet.append(body)
    return packet
  }

  static func chatAnswer(
    text: String, isFinal: Bool, roundID: String,
    query: String, timestampMs: Int64
  ) throws -> Data {
    guard (!text.isEmpty || isFinal),
          text.utf8.count <= 512,
          query.utf8.count <= 512,
          timestampMs >= 0
    else { throw RayNeoError.invalidInput }
    let body: [String: Any] = [
      "sub": "workflow", "vendor": "deepseek",
      "uuid": roundID, "sid": roundID,
      "round": -1, "timestamp": timestampMs,
      "query": query, "domain": "chat", "intent": "chat",
      "payload": [String: String](), "offline": false,
      "answer": ["text": text, "isFinal": isFinal] as [String: Any],
    ]
    let bodyData = try encodeJSONSorted(body)
    guard bodyData.count <= 8192 else { throw RayNeoError.invalidInput }
    var packet = Data([8, 1, 16, 32, 26])
    appendVarint(UInt64(bodyData.count), to: &packet)
    packet.append(bodyData)
    return packet
  }

  static func responseComplete() -> Data {
    Data([8, 1, 16, 12, 26, 2, 123, 125, 34, 0])
  }

  static func teleprompter(type: UInt8, body: [String: Any]) throws -> Data {
    var json = body
    json["action"] = 1
    let bodyData = try encodeJSONSorted(json)
    return BusinessEnvelope.encode(type: type, body: bodyData)
  }

  static func notification(type: UInt8, body: [String: Any]) throws -> Data {
    let bodyData = try encodeJSONSorted(body)
    return BusinessEnvelope.encode(type: type, body: bodyData)
  }

  static func encodeSettingsJSON(_ value: [String: Any]) throws -> Data {
    return try JSONSerialization.data(
      withJSONObject: value,
      options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]
    )
  }

  private static func encodeJSONSorted(_ value: [String: Any]) throws -> Data {
    return try JSONSerialization.data(
      withJSONObject: value,
      options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]
    )
  }

  private static func appendVarint(_ value: UInt64, to out: inout Data) {
    var v = value
    repeat {
      let b = UInt8(v & 0x7F)
      v >>= 7
      out.append(v > 0 ? (b | 0x80) : b)
    } while v > 0
  }
}

// MARK: - Errors

enum RayNeoError: Error, LocalizedError {
  case bluetoothUnavailable
  case notConnected
  case scanFailed(String)
  case connectFailed(String)
  case writeFailed(String)
  case textTooLong
  case invalidInput
  case characteristicMissing

  var errorDescription: String? {
    switch self {
    case .bluetoothUnavailable: return "Bluetooth is unavailable or powered off"
    case .notConnected: return "RayNeo glasses are not connected"
    case .scanFailed(let m): return "Scan failed: \(m)"
    case .connectFailed(let m): return "Connect failed: \(m)"
    case .writeFailed(let m): return "Write failed: \(m)"
    case .textTooLong: return "Text payload exceeds the 1024-byte limit"
    case .invalidInput: return "Invalid input for the requested assistant message"
    case .characteristicMissing: return "Required BLE characteristic was not discovered"
    }
  }
}

// MARK: - Delegate (BLE + EASession Stream)

private final class RayNeoDelegate: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate, StreamDelegate {
  weak var owner: RayNeoModule?

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    owner?.handleCentralState(central.state)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    owner?.handleDiscovered(peripheral)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.delegate = self
    peripheral.discoverServices([RayNeoIOProfile.service, RayNeoIOProfile.serviceFull])
    owner?.handleConnected(peripheral)
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    owner?.handleConnectFailed(peripheral, error: error)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    owner?.handleDisconnected(peripheral, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil else { owner?.handleDiscoveryError(error!); return }
    guard let services = peripheral.services else { return }
    for service in services where service.uuid == RayNeoIOProfile.service || service.uuid == RayNeoIOProfile.serviceFull {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    guard error == nil else { owner?.handleDiscoveryError(error!); return }
    guard let characteristics = service.characteristics else { return }
    owner?.handleCharacteristics(characteristics)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    owner?.handleSubscriptionStatus(characteristic, error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard error == nil else { return }
    owner?.handleInboundData(characteristic.value)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    owner?.handleWriteAck(error: error)
  }

  // EASession stream events
  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    owner?.handleStreamEvent(aStream, event: eventCode)
  }
}

// MARK: - Module

public class RayNeoModule: Module {
  private let delegate = RayNeoDelegate()
  private var central: CBCentralManager?
  private var peripheral: CBPeripheral?
  private var outboundCharacteristic: CBCharacteristic?
  private var inboundCharacteristic: CBCharacteristic?
  private var messageNumber: UInt16 = 0

  // EASession transport (primary for MFi glasses)
  private var eaSession: EASession?
  private var eaInput: InputStream?
  private var eaOutput: OutputStream?
  private var eaAccessory: EAAccessory?
  private var eaConnected = false
  private var pendingEaWriteData = Data()

  public func definition() -> ModuleDefinition {
    Name("RayNeo")

    Events(
      "connectionState",
      "scanResult",
      "messageReceived",
      "error",
      "settings"
    )

    AsyncFunction("startCentral") { () -> Void in
      self.ensureCentral()
    }

    AsyncFunction("getScanStatus") { () -> String in
      if self.eaConnected { return "connected" }
      if self.peripheral?.state == .connected { return "connected" }
      if self.central?.isScanning == true { return "scanning" }
      if self.central?.state == .poweredOn { return "idle" }
      return "disconnected"
    }

    AsyncFunction("startScan") { (timeoutMs: Double?) -> [String: Any] in
      try self.startScan(timeoutMs: timeoutMs)
    }

    AsyncFunction("stopScan") { () -> Void in
      self.central?.stopScan()
    }

    AsyncFunction("connect") { (identifier: String) -> Void in
      try self.connect(to: identifier)
    }

    AsyncFunction("disconnect") { () -> Void in
      self.disconnect()
    }

    AsyncFunction("sendText") { (text: String, isFinal: Bool) -> Void in
      try self.sendBusiness(13, payload: try AssistantEncoders.asrText(text, isFinal: isFinal))
    }

    AsyncFunction("sendAnswer") {
      (text: String, isFinal: Bool, roundID: String, query: String, timestampMs: Int64) -> Void in
      let payload = try AssistantEncoders.chatAnswer(
        text: text, isFinal: isFinal, roundID: roundID, query: query, timestampMs: timestampMs)
      try self.sendBusiness(13, payload: payload)
    }

    AsyncFunction("sendResponseComplete") { () -> Void in
      try self.sendBusiness(13, payload: AssistantEncoders.responseComplete())
    }

    AsyncFunction("sendTeleprompterText") {
      (did: String, text: String, speed: Int, total: Int?) -> Void in
      let utf8 = Data(text.utf8)
      var body: [String: Any] = [
        "did": did, "action": 1,
        "total": total ?? utf8.count,
        "scroll": 2, "speed": speed,
        "pageOffset": 0, "highLightOffset": 0,
      ]
      body["checksum"] = Self.teleprompterChecksum(utf8)
      let payload = try AssistantEncoders.teleprompter(type: 2, body: body)
      try self.sendBusiness(20, payload: payload)
    }

    AsyncFunction("sendNotification") {
      (title: String, content: String, appName: String?, timestamp: String?) -> Void in
      let uid = String(Int.random(in: 1...2_147_483_646))
      let ts = timestamp ?? Self.currentISO8601()
      let body: [String: Any] = [
        "notificationUID": uid,
        "appId": "com.kendrickhome.atlas",
        "appName": appName ?? "Atlas",
        "title": title, "subtitle": "",
        "content": content, "timestamp": ts,
        "category": 0, "reply": false, "type": 1,
      ]
      let payload = try AssistantEncoders.notification(type: 2, body: body)
      try self.sendBusiness(21, payload: payload)
    }

    AsyncFunction("setBrightness") { (value: Int) -> Void in
      guard value == 7 || value == 8 else { throw RayNeoError.invalidInput }
      let body: [String: Any] = [
        "cmd": "brightness_change",
        "payload": ["value": value, "mode": 0, "data": ""] as [String: Any],
      ]
      let bodyData = try AssistantEncoders.encodeSettingsJSON(body)
      let envelope = BusinessEnvelope.encode(type: 2, body: bodyData)
      try self.sendBusiness(15, payload: envelope)
    }

    AsyncFunction("setDisplay") { (height: Int, distance: Int) -> Void in
      guard [1, 3, 5].contains(height) else { throw RayNeoError.invalidInput }
      guard distance == 1 || distance == 2 else { throw RayNeoError.invalidInput }
      let inner: [String: Any] = ["height": height, "distance": distance]
      let innerData = try AssistantEncoders.encodeSettingsJSON(inner)
      let innerString = String(data: innerData, encoding: .utf8) ?? ""
      let body: [String: Any] = [
        "cmd": "display_config",
        "payload": ["value": 0, "mode": 0, "data": innerString] as [String: Any],
      ]
      let bodyData = try AssistantEncoders.encodeSettingsJSON(body)
      let envelope = BusinessEnvelope.encode(type: 5, body: bodyData)
      try self.sendBusiness(15, payload: envelope)
    }

    AsyncFunction("refreshSettings") { () -> Void in
      let statusBody: [String: Any] = [
        "cmd": "request_general_status",
        "payload": ["value": 0, "mode": 0, "data": ""] as [String: Any],
      ]
      let statusData = try AssistantEncoders.encodeSettingsJSON(statusBody)
      try self.sendBusiness(15, payload: BusinessEnvelope.encode(type: 1, body: statusData))

      let settingsBody: [String: Any] = [
        "cmd": "request_general_settings",
        "payload": ["value": 0, "mode": 0, "data": ""] as [String: Any],
      ]
      let settingsData = try AssistantEncoders.encodeSettingsJSON(settingsBody)
      try self.sendBusiness(15, payload: BusinessEnvelope.encode(type: 4, body: settingsData))
    }
  }

  // MARK: Central lifecycle

  private func ensureCentral() {
    if central == nil {
      delegate.owner = self
      central = CBCentralManager(
        delegate: delegate,
        queue: .main,
        options: [CBCentralManagerOptionShowPowerAlertKey: false]
      )
    }
  }

  // MARK: Scan

  private func startScan(timeoutMs: Double?) throws -> [String: Any] {
    ensureCentral()

    // 1. Check EAAccessoryManager for MFi-connected glasses (PRIMARY path).
    // The RayNeo iO connects via MFi using the com.rayneo.venus.pub protocol.
    // These glasses do NOT appear in BLE scans — they use Apple's
    // ExternalAccessory framework, not BLE advertising.
    let eaAccessories = EAAccessoryManager.shared().connectedAccessories
    for accessory in eaAccessories where accessory.protocolStrings.contains(RayNeoIOProfile.accessoryProtocol) {
      sendEvent("scanResult", [
        "id": "ea-\(accessory.connectionID)",
        "name": accessory.name,
        "rssi": 0,
      ])
    }

    // 2. Also scan via BLE as a fallback (some firmware versions may advertise).
    guard let central, central.state == .poweredOn else {
      return ["scanning": eaAccessories.count > 0]
    }

    let connected = central.retrieveConnectedPeripherals(withServices: [RayNeoIOProfile.service])
    for p in connected {
      sendEvent("scanResult", [
        "id": p.identifier.uuidString,
        "name": p.name ?? "RayNeo iO",
        "rssi": 0,
      ])
    }

    let connectedPeripheral = self.peripheral
    self.peripheral = nil
    connectedPeripheral?.delegate = nil
    outboundCharacteristic = nil
    inboundCharacteristic = nil
    central.scanForPeripherals(
      withServices: [RayNeoIOProfile.service],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
    )
    if let timeoutMs, timeoutMs > 0 {
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(timeoutMs) / 1000.0) { [weak self] in
        guard let self, self.central?.isScanning == true else { return }
        self.central?.stopScan()
      }
    }
    return ["scanning": true]
  }

  // MARK: Connect

  private func connect(to identifier: String) throws {
    if identifier.hasPrefix("ea-") {
      try connectEA(identifier: identifier)
      return
    }

    guard let central, central.state == .poweredOn else {
      throw RayNeoError.bluetoothUnavailable
    }
    let peripherals = central.retrievePeripherals(withIdentifiers: [UUID(uuidString: identifier) ?? UUID()])
    guard let target = peripherals.first else {
      throw RayNeoError.connectFailed("Peripheral \(identifier) not found")
    }
    self.peripheral = target
    target.delegate = delegate
    central.connect(target, options: nil)
  }

  private func connectEA(identifier: String) throws {
    let parts = identifier.split(separator: "-", maxSplits: 1)
    guard parts.count == 2 else {
      throw RayNeoError.connectFailed("Invalid EA identifier: \(identifier)")
    }
    let connectionID = Int(parts[1]) ?? 0

    let accessories = EAAccessoryManager.shared().connectedAccessories
    guard let accessory = accessories.first(where: { $0.connectionID == connectionID }),
          accessory.protocolStrings.contains(RayNeoIOProfile.accessoryProtocol) else {
      throw RayNeoError.connectFailed("Glasses not found in connected accessories. Make sure the RayNeo app is closed.")
    }

    guard let session = EASession(accessory: accessory, forProtocol: RayNeoIOProfile.accessoryProtocol) else {
      throw RayNeoError.connectFailed("Failed to create EASession. The RayNeo app may still be holding the connection.")
    }

    eaSession = session
    eaAccessory = accessory
    eaInput = session.inputStream
    eaOutput = session.outputStream

    for stream in [eaInput as Stream?, eaOutput as Stream?].compactMap({ $0 }) {
      stream.delegate = delegate
      stream.schedule(in: .main, forMode: .common)
      stream.open()
    }

    if let input = eaInput, input.streamStatus == .open,
       let output = eaOutput, output.streamStatus == .open {
      eaConnected = true
      sendEvent("connectionState", ["state": "connected", "id": identifier])
    }
  }

  // MARK: Disconnect

  private func disconnect() {
    if let input = eaInput, let output = eaOutput {
      input.delegate = nil
      output.delegate = nil
      input.close()
      output.close()
      input.remove(from: .main, forMode: .common)
      output.remove(from: .main, forMode: .common)
    }
    eaSession = nil
    eaInput = nil
    eaOutput = nil
    eaAccessory = nil
    eaConnected = false

    if let p = peripheral {
      central?.cancelPeripheralConnection(p)
    }
    peripheral = nil
    outboundCharacteristic = nil
    inboundCharacteristic = nil

    sendEvent("connectionState", ["state": "disconnected"])
  }

  // MARK: Send

  private func sendBusiness(_ business: UInt8, payload: Data) throws {
    messageNumber &+= 1
    let frame = TransportFrame(
      messageNumber: messageNumber,
      flags: 0,
      wireBusinessID: business,
      payload: payload
    ).encoded()

    // EASession path (primary)
    if eaConnected, let output = eaOutput {
      let written = frame.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
        guard let base = ptr.baseAddress else { return 0 }
        return output.write(base.assumingMemoryBound(to: UInt8.self), maxLength: frame.count)
      }
      if written < 0 {
        throw RayNeoError.writeFailed("EASession output stream write failed")
      } else if written < frame.count {
        pendingEaWriteData = frame.subdata(in: written..<frame.count)
      }
      return
    }

    // BLE path (fallback)
    guard let peripheral, peripheral.state == .connected,
          let characteristic = outboundCharacteristic
    else {
      throw RayNeoError.notConnected
    }
    peripheral.writeValue(frame, for: characteristic, type: .withResponse)
  }

  // MARK: Stream delegate handling

  fileprivate func handleStreamEvent(_ aStream: Stream, event: Stream.Event) {
    if event.contains(.errorOccurred) {
      sendEvent("error", ["kind": "stream", "message": "EASession stream error"])
      eaConnected = false
      sendEvent("connectionState", ["state": "disconnected"])
      return
    }

    if event.contains(.endEncountered) {
      eaConnected = false
      sendEvent("connectionState", ["state": "disconnected"])
      return
    }

    if event.contains(.openCompleted) {
      if let input = eaInput, input.streamStatus == .open,
           let output = eaOutput, output.streamStatus == .open {
        eaConnected = true
        sendEvent("connectionState", ["state": "connected", "id": "ea-\(eaAccessory?.connectionID ?? 0)"])
      }
    }

    if event.contains(.hasBytesAvailable), aStream === eaInput {
      readEAStream()
    }

    if event.contains(.hasSpaceAvailable), aStream === eaOutput {
      flushPendingEAWrite()
    }
  }

  private func readEAStream() {
    guard let input = eaInput else { return }
    let bufferSize = 1024
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    let bytesRead = input.read(&buffer, maxLength: bufferSize)
    if bytesRead > 0 {
      let data = Data(buffer[0..<bytesRead])
      handleInboundData(data)
    }
  }

  private func flushPendingEAWrite() {
    guard !pendingEaWriteData.isEmpty, let output = eaOutput else { return }
    let written = pendingEaWriteData.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
      guard let base = ptr.baseAddress else { return 0 }
      return output.write(base.assumingMemoryBound(to: UInt8.self), maxLength: pendingEaWriteData.count)
    }
    if written > 0 {
      pendingEaWriteData = pendingEaWriteData.subdata(in: written..<pendingEaWriteData.count)
    }
  }

  // MARK: BLE delegate callbacks

  fileprivate func handleCentralState(_ state: CBManagerState) {
    let stateName: String
    switch state {
    case .unknown: stateName = "unknown"
    case .resetting: stateName = "resetting"
    case .unsupported: stateName = "unsupported"
    case .unauthorized: stateName = "unauthorized"
    case .poweredOff: stateName = "poweredOff"
    case .poweredOn: stateName = "poweredOn"
    @unknown default: stateName = "unknown"
    }
    sendEvent("connectionState", ["state": stateName])
    if state != .poweredOn && !eaConnected {
      sendEvent("connectionState", ["state": "disconnected"])
    }
  }

  fileprivate func handleDiscovered(_ peripheral: CBPeripheral) {
    let id = peripheral.identifier.uuidString
    let name = peripheral.name ?? "RayNeo iO"
    sendEvent("scanResult", ["id": id, "name": name, "rssi": 0])
  }

  fileprivate func handleConnected(_ peripheral: CBPeripheral) {
    sendEvent("connectionState", ["state": "connected", "id": peripheral.identifier.uuidString])
  }

  fileprivate func handleConnectFailed(_ peripheral: CBPeripheral, error: Error?) {
    let message = error?.localizedDescription ?? "Connection failed"
    sendEvent("error", ["kind": "connect", "message": message])
  }

  fileprivate func handleDisconnected(_ peripheral: CBPeripheral, error: Error?) {
    outboundCharacteristic = nil
    inboundCharacteristic = nil
    self.peripheral = nil
    sendEvent("connectionState", ["state": "disconnected"])
  }

  fileprivate func handleDiscoveryError(_ error: Error) {
    sendEvent("error", ["kind": "discovery", "message": error.localizedDescription])
  }

  fileprivate func handleCharacteristics(_ characteristics: [CBCharacteristic]) {
    for c in characteristics {
      if c.uuid == RayNeoIOProfile.outbound { outboundCharacteristic = c }
      if c.uuid == RayNeoIOProfile.inbound {
        inboundCharacteristic = c
        peripheral?.setNotifyValue(true, for: c)
      }
    }
    if outboundCharacteristic == nil || inboundCharacteristic == nil {
      sendEvent("error", ["kind": "characteristics", "message": "Required characteristics not found"])
    }
  }

  fileprivate func handleSubscriptionStatus(_ characteristic: CBCharacteristic, error: Error?) {
    if let error {
      sendEvent("error", ["kind": "subscribe", "message": error.localizedDescription])
    }
  }

  fileprivate func handleInboundData(_ data: Data?) {
    guard let data else { return }
    sendEvent("messageReceived", ["data": data.base64EncodedString()])
    if let parsed = Self.parseBusiness15(data) {
      sendEvent("settings", parsed)
    }
  }

  fileprivate func handleWriteAck(error: Error?) {
    if let error {
      sendEvent("error", ["kind": "write", "message": error.localizedDescription])
    }
  }

  // MARK: Inbound parsing

  private static func parseBusiness15(_ data: Data) -> [String: Any]? {
    guard data.count >= 9 else { return nil }
    guard data[0] == 0xAA, data[1] == 0x55 else { return nil }
    let wireBusinessID = data[7]
    guard wireBusinessID == 15 else { return nil }

    let payloadStart = 8
    guard payloadStart < data.count - 2 else { return nil }
    let payloadEnd = data.count - 2
    let payload = data.subdata(in: payloadStart..<payloadEnd)

    guard payload.count >= 6 else { return nil }
    guard payload[0] == 8, payload[1] == 1 else { return nil }
    guard payload[2] == 16 else { return nil }
    let messageType = payload[3]
    guard payload[4] == 26 else { return nil }

    var length: UInt64 = 0
    var shift: UInt64 = 0
    var pos = 5
    while pos < payload.count {
      let b = payload[pos]
      length |= UInt64(b & 0x7F) << shift
      pos += 1
      if b & 0x80 == 0 { break }
      shift += 7
      if shift > 35 { return nil }
    }

    let bodyStart = pos
    let bodyEnd = bodyStart + Int(length)
    guard bodyEnd <= payload.count else { return nil }
    let jsonData = payload.subdata(in: bodyStart..<bodyEnd)

    guard let json = try? JSONSerialization.jsonObject(
      with: jsonData, options: [.allowFragments]
    ) as? [String: Any] else { return nil }

    var result: [String: Any] = ["type": Int(messageType)]

    switch messageType {
    case 1:
      result["cmd"] = json["cmd"] ?? "general_status"
      if let payload = json["payload"] as? [String: Any] {
        if let brightness = payload["brightness"] { result["brightness"] = brightness }
        if let battery = payload["battery"] { result["battery"] = battery }
      }
    case 3:
      result["cmd"] = json["cmd"] ?? ""
      if let payload = json["payload"] as? [String: Any] {
        if let cmd = json["cmd"] as? String, cmd == "brightness_change" {
          if let value = payload["value"] { result["brightness"] = value }
        }
      }
    case 4:
      result["cmd"] = json["cmd"] ?? "general_settings"
      if let payload = json["payload"] as? [String: Any] {
        if let displayConfig = payload["displayConfig"] as? [String: Any] {
          if let height = displayConfig["height"] { result["displayHeight"] = height }
          if let distance = displayConfig["distance"] { result["displayDistance"] = distance }
        }
        if let dataStr = payload["data"] as? String, !dataStr.isEmpty,
           let dataBytes = dataStr.data(using: .utf8),
           let nested = try? JSONSerialization.jsonObject(
             with: dataBytes, options: [.allowFragments]
           ) as? [String: Any] {
          if let height = nested["height"] { result["displayHeight"] = height }
          if let distance = nested["distance"] { result["displayDistance"] = distance }
        }
      }
    default:
      result["cmd"] = json["cmd"] ?? ""
    }

    return result
  }

  // MARK: Utilities

  private static func teleprompterChecksum(_ bytes: Data) -> String {
    var hash: UInt32 = 2_166_136_261
    for byte in bytes {
      hash ^= UInt32(byte)
      hash = hash &* 16_777_619
    }
    let hex = String(hash, radix: 16, uppercase: false)
    if hex.count >= 8 { return hex }
    return String(repeating: "0", count: 8 - hex.count) + hex
  }

  private static func currentISO8601() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
  }
}
