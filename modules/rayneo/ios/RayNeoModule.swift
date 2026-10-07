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

// MARK: - Business envelope encoder

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

  /// Speedometer / navigation speed display (business 15, type 2 "cmd" format).
  /// Uses the same launcher/settings envelope as brightness_change.
  static func speedometer(speed: Int, unit: String = "km/h") throws -> Data {
    let inner: [String: Any] = ["speed": speed, "unit": unit]
    let innerData = try encodeJSONSorted(inner)
    let innerString = String(data: innerData, encoding: .utf8) ?? ""
    let body: [String: Any] = [
      "cmd": "speedometer_update",
      "payload": ["value": 0, "mode": 0, "data": innerString] as [String: Any],
    ]
    let bodyData = try encodeJSONSorted(body)
    return BusinessEnvelope.encode(type: 2, body: bodyData)
  }

  /// Lyrics display (business 20, teleprompter type 2 "prepare").
  /// Reuses the teleprompter envelope with lyric-specific fields.
  static func lyrics(did: String, text: String, speed: Int) throws -> Data {
    let utf8 = Data(text.utf8)
    var body: [String: Any] = [
      "did": did, "action": 1,
      "total": utf8.count,
      "scroll": 2, "speed": speed,
      "pageOffset": 0, "highLightOffset": 0,
    ]
    body["checksum"] = Self.teleprompterChecksum(utf8)
    return try teleprompter(type: 2, body: body)
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

  static func teleprompterChecksum(_ bytes: Data) -> String {
    var hash: UInt32 = 2_166_136_261
    for byte in bytes {
      hash ^= UInt32(byte)
      hash = hash &* 16_777_619
    }
    let hex = String(hash, radix: 16, uppercase: false)
    if hex.count >= 8 { return hex }
    return String(repeating: "0", count: 8 - hex.count) + hex
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
  case sdkNotLoaded
  case noAuthenticatedDevice

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
    case .sdkNotLoaded: return "RayneoNet framework not loaded or version mismatch"
    case .noAuthenticatedDevice: return "No authenticated glasses (BLE state 9) found"
    }
  }
}

// MARK: - BLE Delegate (fallback scan only)

private final class RayNeoDelegate: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
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
}

// MARK: - Module

public class RayNeoModule: Module {
  private let delegate = RayNeoDelegate()
  private var central: CBCentralManager?

  // SDK framework handles (via dlsym bridge)
  private var core: CoreHandle?

  // Cached discovered peripherals (for BLE fallback + SDK conversion)
  private var discoveredPeripherals: [UUID: CBPeripheral] = [:]

  // EASession transport (MFi fallback if SDK is unavailable)
  private var eaSession: EASession?
  private var eaInput: InputStream?
  private var eaOutput: OutputStream?
  private var eaAccessory: EAAccessory?
  private var eaConnected = false

  // Notification mirroring
  private var notificationMirrorEnabled = false
  private var notificationObserver: NSObjectProtocol?

  // Connection state polling
  private var connectionPollTimer: Timer?

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
      self.loadCore()
    }

    AsyncFunction("getScanStatus") { () -> String in
      if self.isAuthenticated { return "authenticated" }
      if self.eaConnected { return "connected" }
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
      try self.sendBusiness(.voiceAssistant, payload: try AssistantEncoders.asrText(text, isFinal: isFinal))
    }

    AsyncFunction("sendAnswer") {
      (text: String, isFinal: Bool, roundID: String, query: String, timestampMs: Int64) -> Void in
      let payload = try AssistantEncoders.chatAnswer(
        text: text, isFinal: isFinal, roundID: roundID, query: query, timestampMs: timestampMs)
      try self.sendBusiness(.voiceAssistant, payload: payload)
    }

    AsyncFunction("sendResponseComplete") { () -> Void in
      try self.sendBusiness(.voiceAssistant, payload: AssistantEncoders.responseComplete())
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
      body["checksum"] = AssistantEncoders.teleprompterChecksum(utf8)
      let payload = try AssistantEncoders.teleprompter(type: 2, body: body)
      try self.sendBusiness(.teleprompter, payload: payload)
    }

    AsyncFunction("sendLyrics") {
      (did: String, text: String, speed: Int) -> Void in
      let payload = try AssistantEncoders.lyrics(did: did, text: text, speed: speed)
      try self.sendBusiness(.teleprompter, payload: payload)
    }

    AsyncFunction("sendSpeedometer") {
      (speed: Int, unit: String?) -> Void in
      let payload = try AssistantEncoders.speedometer(speed: speed, unit: unit ?? "km/h")
      try self.sendBusiness(.launcher, payload: payload)
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
      try self.sendBusiness(.notification, payload: payload)
    }

    AsyncFunction("setBrightness") { (value: Int) -> Void in
      guard value == 7 || value == 8 else { throw RayNeoError.invalidInput }
      let body: [String: Any] = [
        "cmd": "brightness_change",
        "payload": ["value": value, "mode": 0, "data": ""] as [String: Any],
      ]
      let bodyData = try AssistantEncoders.encodeSettingsJSON(body)
      let envelope = BusinessEnvelope.encode(type: 2, body: bodyData)
      try self.sendBusiness(.launcher, payload: envelope)
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
      try self.sendBusiness(.launcher, payload: envelope)
    }

    AsyncFunction("refreshSettings") { () -> Void in
      let statusBody: [String: Any] = [
        "cmd": "request_general_status",
        "payload": ["value": 0, "mode": 0, "data": ""] as [String: Any],
      ]
      let statusData = try AssistantEncoders.encodeSettingsJSON(statusBody)
      try self.sendBusiness(.launcher, payload: BusinessEnvelope.encode(type: 1, body: statusData))

      let settingsBody: [String: Any] = [
        "cmd": "request_general_settings",
        "payload": ["value": 0, "mode": 0, "data": ""] as [String: Any],
      ]
      let settingsData = try AssistantEncoders.encodeSettingsJSON(settingsBody)
      try self.sendBusiness(.launcher, payload: BusinessEnvelope.encode(type: 4, body: settingsData))
    }

    AsyncFunction("startNotificationMirror") { () -> Void in
      self.startNotificationMirror()
    }

    AsyncFunction("stopNotificationMirror") { () -> Void in
      self.stopNotificationMirror()
    }

    AsyncFunction("pushTextToGlasses") { (title: String, content: String) -> Void in
      try self.sendNotificationToGlasses(title: title, content: content, appName: "Atlas")
    }

    AsyncFunction("getSDKVersion") { () -> String in
      return self.core?.sdkVersion ?? "not loaded"
    }

    AsyncFunction("getDeviceState") { () -> [String: Any] in
      return self.getDeviceState()
    }

    AsyncFunction("reconnectBonded") { () -> Void in
      try self.reconnectBonded()
    }
  }

  // MARK: - Core loading (dlsym bridge)

  private func loadCore() {
    guard RayneoBridgeImageMatches() else {
      sendEvent("error", ["kind": "sdk", "message": "RayneoNet framework version mismatch"])
      return
    }
    if core == nil {
      core = CoreHandle.shared()
      if let core = core {
        sendEvent("connectionState", ["state": "sdkLoaded", "version": core.sdkVersion ?? "unknown"])
        startConnectionPolling()
      } else {
        sendEvent("error", ["kind": "sdk", "message": "Failed to get RNCoreConnect.shared()"])
      }
    }
  }

  // MARK: - Connection state polling

  private func startConnectionPolling() {
    connectionPollTimer?.invalidate()
    let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
      self?.pollConnectionState()
    }
    connectionPollTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func pollConnectionState() {
    guard let core = core else { return }
    let linked = core.linkedDevices
    if linked.count == 1, let device = linked.first {
      let connected = device.isConnected
      let bleState = device.bleStateByte
      if connected && bleState == 9 {
        sendEvent("connectionState", [
          "state": "authenticated",
          "deviceID": device.deviceID,
          "name": device.name,
          "bleState": Int(bleState)
        ])
      } else if connected {
        sendEvent("connectionState", [
          "state": "connected",
          "deviceID": device.deviceID,
          "bleState": Int(bleState)
        ])
      }
    } else if linked.count == 0 && core.bondedDeviceCount > 0 {
      sendEvent("connectionState", ["state": "bonded", "bondedCount": core.bondedDeviceCount])
    }
  }

  private var isAuthenticated: Bool {
    guard let core = core else { return false }
    let linked = core.linkedDevices
    return linked.count == 1 && linked[0].isConnected && linked[0].bleStateByte == 9
  }

  private var authenticatedDeviceID: String? {
    guard let core = core else { return nil }
    let linked = core.linkedDevices
    guard linked.count == 1, linked[0].isConnected, linked[0].bleStateByte == 9 else { return nil }
    return linked[0].deviceID
  }

  // MARK: - Central lifecycle

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

  // MARK: - Scan

  private func startScan(timeoutMs: Double?) throws -> [String: Any] {
    ensureCentral()
    loadCore()

    // 1. Check SDK bonded/linked devices first (primary path)
    if let core = core {
      let bonded = core.bondedDevices
      for device in bonded {
        sendEvent("scanResult", [
          "id": "sdk-\(device.deviceID)",
          "name": device.name,
          "rssi": 0,
          "bonded": true,
          "connected": device.isConnected,
          "bleState": Int(device.bleStateByte),
        ])
      }
      let linked = core.linkedDevices
      for device in linked {
        sendEvent("scanResult", [
          "id": "sdk-\(device.deviceID)",
          "name": device.name,
          "rssi": 0,
          "linked": true,
          "connected": device.isConnected,
          "bleState": Int(device.bleStateByte),
        ])
      }
    }

    // 2. Check EAAccessoryManager for MFi-connected glasses
    let eaAccessories = EAAccessoryManager.shared().connectedAccessories
    for accessory in eaAccessories where accessory.protocolStrings.contains(RayNeoIOProfile.accessoryProtocol) {
      sendEvent("scanResult", [
        "id": "ea-\(accessory.connectionID)",
        "name": accessory.name,
        "rssi": 0,
      ])
    }

    // 3. Also scan via BLE as fallback
    guard let central, central.state == .poweredOn else {
      return ["scanning": false, "sdkLoaded": core != nil]
    }

    let connected = central.retrieveConnectedPeripherals(withServices: [RayNeoIOProfile.service])
    for p in connected {
      discoveredPeripherals[p.identifier] = p
      sendEvent("scanResult", [
        "id": p.identifier.uuidString,
        "name": p.name ?? "RayNeo iO",
        "rssi": 0,
      ])
    }

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
    return ["scanning": true, "sdkLoaded": core != nil]
  }

  // MARK: Connect

  private func connect(to identifier: String) throws {
    // SDK path: "sdk-<deviceID>"
    if identifier.hasPrefix("sdk-") {
      let deviceID = String(identifier.dropFirst(4))
      try connectSDK(deviceID: deviceID)
      return
    }

    // EA path: "ea-<connectionID>"
    if identifier.hasPrefix("ea-") {
      try connectEA(identifier: identifier)
      return
    }

    // BLE fallback: UUID
    guard let central, central.state == .poweredOn else {
      throw RayNeoError.bluetoothUnavailable
    }
    let peripherals = central.retrievePeripherals(withIdentifiers: [UUID(uuidString: identifier) ?? UUID()])
    guard let target = peripherals.first else {
      throw RayNeoError.connectFailed("Peripheral \(identifier) not found")
    }
    discoveredPeripherals[target.identifier] = target
    // For BLE, we need the SDK to convert and connect
    if let core = core {
      if let device = core.findDevice(identifier) {
        try core.connectBLE(device)
        sendEvent("connectionState", ["state": "connecting", "id": identifier])
      } else {
        throw RayNeoError.connectFailed("SDK could not find device \(identifier)")
      }
    } else {
      throw RayNeoError.sdkNotLoaded
    }
  }

  private func connectSDK(deviceID: String) throws {
    guard let core = core else { throw RayNeoError.sdkNotLoaded }

    // Try findDevice first (cached by UUID string)
    if let device = core.findDevice(deviceID) {
      try core.connectBLE(device)
      sendEvent("connectionState", ["state": "connecting", "deviceID": deviceID])
      return
    }

    // Try bonded devices
    for device in core.bondedDevices where device.deviceID == deviceID {
      try core.connectBLE(device)
      sendEvent("connectionState", ["state": "connecting", "deviceID": deviceID])
      return
    }

    throw RayNeoError.connectFailed("Device \(deviceID) not found in SDK cache or bonded list")
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
      throw RayNeoError.connectFailed("Glasses not found in connected accessories")
    }

    guard let session = EASession(accessory: accessory, forProtocol: RayNeoIOProfile.accessoryProtocol) else {
      throw RayNeoError.connectFailed("Failed to create EASession")
    }

    eaSession = session
    eaAccessory = accessory
    eaInput = session.inputStream
    eaOutput = session.outputStream

    for stream in [eaInput as Stream?, eaOutput as Stream?].compactMap({ $0 }) {
      stream.schedule(in: .main, forMode: .common)
      stream.open()
    }

    eaConnected = true
    sendEvent("connectionState", ["state": "connected", "id": identifier])
  }

  // MARK: Reconnect bonded

  private func reconnectBonded() throws {
    guard let core = core else { throw RayNeoError.sdkNotLoaded }
    let bonded = core.bondedDevices
    guard bonded.count == 1 else {
      throw RayNeoError.connectFailed("Expected exactly 1 bonded device, found \(bonded.count)")
    }
    try core.connectBLE(bonded[0])
    sendEvent("connectionState", ["state": "reconnecting", "deviceID": bonded[0].deviceID])
  }

  // MARK: Disconnect

  private func disconnect() {
    if let input = eaInput, let output = eaOutput {
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

    // SDK disconnect: unbind the linked device if authenticated
    if let core = core, let device = core.linkedDevices.first {
      try? core.unbind(device)
    }

    sendEvent("connectionState", ["state": "disconnected"])
  }

  // MARK: - Send (SDK authenticated path)

  private func sendBusiness(_ business: MessageBusinessIndex, payload: Data) throws {
    // Primary: SDK authenticated path
    if let core = core {
      let linked = core.linkedDevices
      guard linked.count >= 1 else { throw RayNeoError.noAuthenticatedDevice }
      let device = linked[0]
      guard device.isConnected, device.bleStateByte == 9 else {
        throw RayNeoError.noAuthenticatedDevice
      }
      let message = try MessageFactory.make(
        payload: payload, deviceID: device.deviceID,
        business: business, messageID: UUID().uuidString
      )
      try core.sendMessage(message)
      return
    }

    // Fallback: EASession raw write (no MFi auth, may not reach HUD)
    if eaConnected, let output = eaOutput {
      // Wrap in transport frame for EA path
      let frame = TransportFrame(
        messageNumber: 1, flags: 0,
        wireBusinessID: business.rawValue, payload: payload
      ).encoded()
      let written = frame.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
        guard let base = ptr.baseAddress else { return 0 }
        return output.write(UnsafeRawPointer(base).assumingMemoryBound(to: UInt8.self), maxLength: frame.count)
      }
      if written < 0 {
        throw RayNeoError.writeFailed("EASession output stream write failed")
      }
      return
    }

    throw RayNeoError.sdkNotLoaded
  }

  // MARK: - Device state query

  private func getDeviceState() -> [String: Any] {
    guard let core = core else { return ["loaded": false] }
    let linked = core.linkedDevices
    let bonded = core.bondedDevices
    var result: [String: Any] = [
      "loaded": true,
      "sdkVersion": core.sdkVersion ?? "unknown",
      "bondedCount": bonded.count,
      "linkedCount": linked.count,
    ]
    if let device = linked.first {
      result["deviceID"] = device.deviceID
      result["name"] = device.name
      result["connected"] = device.isConnected
      result["bleState"] = Int(device.bleStateByte)
      result["authenticated"] = device.isConnected && device.bleStateByte == 9
      if let transport = device.transport {
        result["transportState"] = Int(transport.transportState)
        if let peripheral = transport.peripheral {
          result["peripheralState"] = peripheral.state.rawValue
        }
      }
    }
    return result
  }

  // MARK: - Notification mirror

  private func startNotificationMirror() {
    guard !notificationMirrorEnabled else { return }
    notificationMirrorEnabled = true

    notificationObserver = NotificationCenter.default.addObserver(
      forName: NSNotification.Name("EXNotificationReceived"),
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self else { return }
      let title = (notification.userInfo?["title"] as? String) ?? "Notification"
      let body = (notification.userInfo?["body"] as? String) ?? ""
      let app = (notification.userInfo?["appId"] as? String) ?? ""
      if !body.isEmpty {
        try? self.sendNotificationToGlasses(title: title, content: body, appName: app)
      }
    }
  }

  private func stopNotificationMirror() {
    notificationMirrorEnabled = false
    if let observer = notificationObserver {
      NotificationCenter.default.removeObserver(observer)
      notificationObserver = nil
    }
  }

  private func sendNotificationToGlasses(title: String, content: String, appName: String?) throws {
    let uid = String(Int.random(in: 1...2_147_483_646))
    let ts = Self.currentISO8601()
    let body: [String: Any] = [
      "notificationUID": uid,
      "appId": "com.kendrickhome.atlas",
      "appName": appName ?? "Atlas",
      "title": title, "subtitle": "",
      "content": content, "timestamp": ts,
      "category": 0, "reply": false, "type": 1,
    ]
    let payload = try AssistantEncoders.notification(type: 2, body: body)
    try sendBusiness(.notification, payload: payload)
  }

  // MARK: - BLE delegate callbacks

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
  }

  fileprivate func handleDiscovered(_ peripheral: CBPeripheral) {
    let id = peripheral.identifier.uuidString
    let name = peripheral.name ?? "RayNeo iO"
    discoveredPeripherals[peripheral.identifier] = peripheral
    sendEvent("scanResult", ["id": id, "name": name, "rssi": 0])
  }

  // MARK: - Transport frame (EA fallback only)

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

  // MARK: - Utilities

  private static func currentISO8601() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
  }
}
