import CoreBluetooth
import ExpoModulesCore
import Foundation

// MARK: - RayNeo iO BLE profile

private enum RayNeoIOProfile {
  static let service = CBUUID(string: "B81D")
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

// MARK: - BLE Delegate

private final class RayNeoBLEDelegate: NSObject, CBCentralManagerDelegate {
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
    owner?.handleDiscovered(peripheral, advertisementData: advertisementData, rssi: RSSI)
  }
}

// MARK: - Module

public class RayNeoModule: Module {
  private let bleDelegate = RayNeoBLEDelegate()
  private var central: CBCentralManager?

  // SDK handle from coreShared() — opaque RNCoreConnect singleton
  private var core: CoreHandle?
  private var messageReceiver: CoreMessageReceiver?
  private var modelCatalog: [String: Any]?

  // Discovered BLE peripherals (by UUID) for scan/connect
  private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
  // SDK-parsed peripheral objects (RNPeripheral NSObject by UUID) for connect
  private var sdkPeripherals: [UUID: NSObject] = [:]
  private var parsedAdvertisements = Set<UUID>()

  // Notification master switch (business 21, type 18) — sent once per session
  private var notificationMasterEnabled = false

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
      let payload = try AssistantTextPrototype.asrText(text, isFinal: isFinal)
      try self.sendBusiness(.voiceAssistant, payload: payload)
    }

    AsyncFunction("sendAnswer") {
      (text: String, isFinal: Bool, roundID: String, query: String, timestampMs: Int64) -> Void in
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
      let payload = try DeviceBusinessWire.encode(type: 32, json: body)
      try self.sendBusiness(.voiceAssistant, payload: payload)
    }

    AsyncFunction("sendResponseComplete") { () -> Void in
      let payload = try DeviceBusinessWire.encode(type: 12, json: [:])
      try self.sendBusiness(.voiceAssistant, payload: payload)
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
      let payload = try DeviceBusinessWire.encode(type: 2, json: body)
      try self.sendBusiness(.teleprompter, payload: payload)
    }

    AsyncFunction("sendLyrics") {
      (did: String, text: String, speed: Int) -> Void in
      let utf8 = Data(text.utf8)
      var body: [String: Any] = [
        "did": did, "action": 1,
        "total": utf8.count,
        "scroll": 2, "speed": speed,
        "pageOffset": 0, "highLightOffset": 0,
      ]
      body["checksum"] = Self.teleprompterChecksum(utf8)
      let payload = try DeviceBusinessWire.encode(type: 2, json: body)
      try self.sendBusiness(.teleprompter, payload: payload)
    }

    AsyncFunction("sendSpeedometer") {
      (speed: Int, unit: String?) -> Void in
      let inner: [String: Any] = ["speed": speed, "unit": unit ?? "km/h"]
      let innerData = try JSONSerialization.data(withJSONObject: inner, options: [.sortedKeys])
      let innerString = String(data: innerData, encoding: .utf8) ?? ""
      let body: [String: Any] = [
        "cmd": "speedometer_update",
        "payload": ["value": 0, "mode": 0, "data": innerString] as [String: Any],
      ]
      let payload = try DeviceBusinessWire.encode(type: 2, json: body)
      try self.sendBusiness(.launcher, payload: payload)
    }

    AsyncFunction("sendNotification") {
      (title: String, content: String, appName: String?, timestamp: String?) -> Void in
      try self.ensureNotificationMasterSwitch()
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
      let payload = try DeviceBusinessWire.encode(type: 2, json: body)
      try self.sendBusiness(.notification, payload: payload)
    }

    AsyncFunction("setBrightness") { (value: Int) -> Void in
      guard value == 7 || value == 8 else { throw RayNeoError.invalidInput }
      let body: [String: Any] = [
        "cmd": "brightness_change",
        "payload": ["value": value, "mode": 0, "data": ""] as [String: Any],
      ]
      let payload = try DeviceBusinessWire.encode(type: 2, json: body)
      try self.sendBusiness(.launcher, payload: payload)
    }

    AsyncFunction("setDisplay") { (height: Int, distance: Int) -> Void in
      guard [1, 3, 5].contains(height) else { throw RayNeoError.invalidInput }
      guard distance == 1 || distance == 2 else { throw RayNeoError.invalidInput }
      let inner: [String: Any] = ["height": height, "distance": distance]
      let innerData = try JSONSerialization.data(withJSONObject: inner, options: [.sortedKeys])
      let innerString = String(data: innerData, encoding: .utf8) ?? ""
      let body: [String: Any] = [
        "cmd": "display_config",
        "payload": ["value": 0, "mode": 0, "data": innerString] as [String: Any],
      ]
      let payload = try DeviceBusinessWire.encode(type: 5, json: body)
      try self.sendBusiness(.launcher, payload: payload)
    }

    AsyncFunction("refreshSettings") { () -> Void in
      let statusBody: [String: Any] = [
        "cmd": "request_general_status",
        "payload": ["value": 0, "mode": 0, "data": ""] as [String: Any],
      ]
      let statusPayload = try DeviceBusinessWire.encode(type: 1, json: statusBody)
      try self.sendBusiness(.launcher, payload: statusPayload)

      let settingsBody: [String: Any] = [
        "cmd": "request_general_settings",
        "payload": ["value": 0, "mode": 0, "data": ""] as [String: Any],
      ]
      let settingsPayload = try DeviceBusinessWire.encode(type: 4, json: settingsBody)
      try self.sendBusiness(.launcher, payload: settingsPayload)
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
      return coreVersion() ?? "not loaded"
    }

    AsyncFunction("getDeviceState") { () -> [String: Any] in
      return self.getDeviceState()
    }

    AsyncFunction("reconnectBonded") { () -> Void in
      try self.reconnectBonded()
    }
  }

  // MARK: - Core loading (Turbo-IO architecture)

  private func loadCore() {
    // Verify the RayneoNet framework image matches the expected v1.2.35 UUID
    guard RNProbeMessageImageMatches() else {
      sendEvent("error", ["kind": "sdk", "message": "RayneoNet framework version mismatch"])
      return
    }
    if core == nil {
      // coreShared() calls the real RNCoreConnect.shared() via @_silgen_name
      core = coreShared()
      if let core = core {
        sendEvent("connectionState", ["state": "sdkLoaded", "version": coreVersion() ?? "unknown"])
        if modelCatalog == nil { modelCatalog = sdkModelCatalog() }
        setupMessageReceiver()
        startConnectionPolling()
      } else {
        sendEvent("error", ["kind": "sdk", "message": "Failed to get RNCoreConnect.shared()"])
      }
    }
  }

  // MARK: - Message receiver (Turbo-IO CoreMessageReceiver)

  private func setupMessageReceiver() {
    guard let core = core, messageReceiver == nil else { return }
    let receiver = CoreMessageReceiver()
    receiver.onBusinessEnvelope = { [weak self] _, business, payload in
      guard let self else { return }
      self.sendEvent("messageReceived", [
        "data": payload.base64EncodedString(),
        "business": Int(business),
      ])
      if business == 15 {
        self.parseSettingsEvent(payload: payload)
      }
    }
    receiver.onVoiceEnvelope = { [weak self] _, metadata, audio, _ in
      guard let self else { return }
      let data = audio ?? Data()
      self.sendEvent("messageReceived", [
        "data": data.base64EncodedString(),
        "business": 13,
        "type": Int(metadata.messageType ?? 0),
      ])
    }
    receiver.onBusinessLoss = { [weak self] in
      self?.sendEvent("error", ["kind": "businessLoss", "message": "Business receive queue overflow"])
    }
    messageReceiver = receiver
    // Register our native delegate with the SDK's RNCoreConnect singleton
    core.addMessageDelegate(receiver)
  }

  // MARK: - Settings event parsing (business 15)

  private func parseSettingsEvent(payload: Data) {
    do {
      let wire = try DeviceBusinessWire(payload)
      var event: [String: Any] = ["type": Int(wire.type)]
      if let cmd = wire.json["cmd"] as? String { event["cmd"] = cmd }

      // Type 1: generalStatus — battery + brightness
      if wire.type == 1 {
        let status = wire.json["generalStatus"] as? [String: Any] ?? wire.json
        if let battery = DeviceBusinessWire.integer(status, "battery") {
          event["battery"] = Int(battery)
        }
        if let brightness = DeviceBusinessWire.integer(status, "brightness") {
          event["brightness"] = Int(brightness)
        }
      }

      // Type 4: generalSettings — display config
      if wire.type == 4 {
        let settings = wire.json["generalSettings"] as? [String: Any] ?? wire.json
        if let config = settings["displayConfig"] as? [String: Any]
          ?? settings["display_config"] as? [String: Any] {
          if let height = DeviceBusinessWire.integer(config, "height") {
            event["displayHeight"] = Int(height)
          }
          if let distance = DeviceBusinessWire.integer(config, "distance") {
            event["displayDistance"] = Int(distance)
          }
        }
      }

      // Type 3/6/17/19: cmd response — extract brightness_change value
      if [3, 6, 17, 19].contains(wire.type),
         let p = wire.json["payload"] as? [String: Any],
         let value = DeviceBusinessWire.integer(p, "value"),
         let cmd = wire.json["cmd"] as? String,
         cmd == "brightness_change" {
        event["brightness"] = Int(value)
      }

      sendEvent("settings", event)
    } catch {
      // Not a parseable business envelope — skip
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
    guard let linked = core.linkedDevices() else { return }
    if linked.count == 1, let device = linked.first {
      let connected = device.isConnected()
      let bleState = device.bleStateByte()
      if connected && bleState == 9 {
        sendEvent("connectionState", [
          "state": "authenticated",
          "deviceID": device.deviceID(),
          "name": device.name(),
          "bleState": Int(bleState),
        ])
      } else if connected {
        // Connected but not yet authenticated — reset notification switch
        notificationMasterEnabled = false
        sendEvent("connectionState", [
          "state": "connected",
          "deviceID": device.deviceID(),
          "bleState": Int(bleState),
        ])
      } else {
        notificationMasterEnabled = false
      }
    } else if linked.count == 0 {
      notificationMasterEnabled = false
      let bondedCount = core.bondedDevices()?.count ?? 0
      if bondedCount > 0 {
        sendEvent("connectionState", ["state": "bonded", "bondedCount": bondedCount])
      }
    }
  }

  private var isAuthenticated: Bool {
    guard let core = core else { return false }
    guard let linked = core.linkedDevices() else { return false }
    return linked.count == 1 && linked[0].isConnected() && linked[0].bleStateByte() == 9
  }

  // MARK: - Central lifecycle

  private func ensureCentral() {
    if central == nil {
      bleDelegate.owner = self
      central = CBCentralManager(
        delegate: bleDelegate,
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
      if let bonded = core.bondedDevices() {
        for device in bonded {
          sendEvent("scanResult", [
            "id": "sdk-\(device.deviceID())",
            "name": device.name(),
            "rssi": 0,
            "bonded": true,
            "connected": device.isConnected(),
            "bleState": Int(device.bleStateByte()),
          ])
        }
      }
      if let linked = core.linkedDevices() {
        for device in linked {
          sendEvent("scanResult", [
            "id": "sdk-\(device.deviceID())",
            "name": device.name(),
            "rssi": 0,
            "linked": true,
            "connected": device.isConnected(),
            "bleState": Int(device.bleStateByte()),
          ])
        }
      }
    }

    // 2. Also scan via BLE for new/unbonded devices
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

  // MARK: - Connect

  private func connect(to identifier: String) throws {
    guard let core = core else { throw RayNeoError.sdkNotLoaded }

    // SDK path: "sdk-<deviceID>"
    if identifier.hasPrefix("sdk-") {
      let deviceID = String(identifier.dropFirst(4))
      try connectSDK(deviceID: deviceID)
      return
    }

    // BLE path: UUID string from scanResult
    let uuid = UUID(uuidString: identifier) ?? UUID()

    // Try findDevice by UUID string (SDK cache — compares CBPeripheral.identifier.uuidString)
    if let device = core.findDevice(identifier) {
      try core.connectBLE(device)
      sendEvent("connectionState", ["state": "connecting", "id": identifier])
      return
    }

    // Try converting a stored SDK peripheral object (from scan)
    if let sdkPeripheral = sdkPeripherals[uuid] {
      if let device = convertPeripheral(sdkPeripheral) {
        try core.connectBLE(device)
        sendEvent("connectionState", ["state": "connecting", "id": identifier])
        return
      }
    }

    // Try getting SDK-owned CBPeripheral, then findDevice again
    if RNProbeSDKPeripheral(uuid) != nil {
      if let device = core.findDevice(identifier) {
        try core.connectBLE(device)
        sendEvent("connectionState", ["state": "connecting", "id": identifier])
        return
      }
    }

    throw RayNeoError.connectFailed("Device \(identifier) not found in SDK cache or scan results")
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
    if let bonded = core.bondedDevices() {
      for device in bonded where device.deviceID() == deviceID {
        try core.connectBLE(device)
        sendEvent("connectionState", ["state": "connecting", "deviceID": deviceID])
        return
      }
    }

    throw RayNeoError.connectFailed("Device \(deviceID) not found in SDK cache or bonded list")
  }

  // MARK: - Reconnect bonded

  private func reconnectBonded() throws {
    guard let core = core else { throw RayNeoError.sdkNotLoaded }
    guard let bonded = core.bondedDevices() else {
      throw RayNeoError.connectFailed("No bonded devices")
    }
    guard bonded.count == 1 else {
      throw RayNeoError.connectFailed("Expected exactly 1 bonded device, found \(bonded.count)")
    }
    // connectBLE sends type 0 (BLE), empty userID — standard SDK auth path
    try core.connectBLE(bonded[0])
    sendEvent("connectionState", ["state": "reconnecting", "deviceID": bonded[0].deviceID()])
  }

  // MARK: - Disconnect (no unbind — just emit state)

  private func disconnect() {
    notificationMasterEnabled = false
    sendEvent("connectionState", ["state": "disconnected"])
  }

  // MARK: - Send (SDK authenticated path)

  private func sendBusiness(_ business: MessageBusinessIndex, payload: Data) throws {
    guard let core = core else { throw RayNeoError.sdkNotLoaded }
    guard let linked = core.linkedDevices(), let device = linked.first else {
      throw RayNeoError.noAuthenticatedDevice
    }
    // bleStateByte() == 9 means authSuccess
    guard device.isConnected(), device.bleStateByte() == 9 else {
      throw RayNeoError.noAuthenticatedDevice
    }
    // MessageFactory.make verifies the framework image, creates RNMessage, sets msgID
    let message = try MessageFactory.make(
      payload: payload, deviceID: device.deviceID(),
      business: business, messageID: UUID().uuidString
    )
    try core.sendMessage(message)
  }

  // MARK: - Notification master switch (business 21, type 18)

  private func ensureNotificationMasterSwitch() throws {
    guard !notificationMasterEnabled else { return }
    let payload = try DeviceBusinessWire.encode(type: 18, json: ["action": 1])
    try sendBusiness(.notification, payload: payload)
    notificationMasterEnabled = true
  }

  // MARK: - Device state query

  private func getDeviceState() -> [String: Any] {
    guard let core = core else { return ["loaded": false] }
    let bonded = core.bondedDevices() ?? []
    let linked = core.linkedDevices() ?? []
    var result: [String: Any] = [
      "loaded": true,
      "sdkVersion": coreVersion() ?? "unknown",
      "bondedCount": bonded.count,
      "linkedCount": linked.count,
    ]
    if let device = linked.first {
      result["deviceID"] = device.deviceID()
      result["name"] = device.name()
      result["connected"] = device.isConnected()
      result["bleState"] = Int(device.bleStateByte())
      result["authenticated"] = device.isConnected() && device.bleStateByte() == 9
      // transport() returns the real RNPeripheral NSObject from the SDK
      let transport = device.transport()
      result["transportState"] = Int(transport.rnSDKTransportState())
      if let peripheral = transport.rnSDKPeripheral() {
        result["peripheralState"] = peripheral.state.rawValue
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
    try ensureNotificationMasterSwitch()
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
    let payload = try DeviceBusinessWire.encode(type: 2, json: body)
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

  fileprivate func handleDiscovered(
    _ peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi: NSNumber
  ) {
    let id = peripheral.identifier.uuidString
    let name = peripheral.name ?? "RayNeo iO"
    discoveredPeripherals[peripheral.identifier] = peripheral
    sendEvent("scanResult", ["id": id, "name": name, "rssi": rssi.intValue])

    // Parse manufacturer advertisement data with the SDK's RNProbeIdentifier
    if !parsedAdvertisements.contains(peripheral.identifier),
       let data = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
      parsedAdvertisements.insert(peripheral.identifier)
      let connectable = (advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue ?? false
      // RNProbeIdentifier parses the ad data and returns the SDK device ID
      if RNProbeIdentifier(data, connectable) != nil,
         let sdkCBPeripheral = RNProbeSDKPeripheral(peripheral.identifier),
         let catalog = modelCatalog {
        // RNProbePeripheral creates the SDK's RNPeripheral NSObject from the ad data
        // and the SDK's own CBPeripheral (not our scanner's)
        sdkPeripherals[peripheral.identifier] = RNProbePeripheral(
          data, sdkCBPeripheral, advertisementData, catalog
        )
      }
    }
  }

  // MARK: - Utilities

  private static func currentISO8601() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
  }

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
}
