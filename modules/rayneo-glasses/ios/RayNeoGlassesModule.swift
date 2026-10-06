import Expo
import CoreBluetooth
import ExternalAccessory
import Foundation

// MARK: - GATT Profile

/// RayNeo iO BLE profile — recovered from the open-source Turbo-IO transport layer.
enum RayNeoIOProfile {
  static let serviceUUID     = CBUUID(string: "0000B81D-0000-1000-8000-00805F9B34FB")
  static let outboundUUID    = CBUUID(string: "EA8B70D5-2BD3-49AB-9C31-9C38B2C3C4F9") // phone → glasses
  static let inboundUUID     = CBUUID(string: "7DB3E235-3608-41F3-A03C-955FCBD2EA4B") // glasses → phone
  static let accessoryProtocol = "com.rayneo.venus.pub"
}

// MARK: - Protocol Encoder

/// Encodes business messages for the RayNeo iO glasses using the protobuf-like
/// wire format recovered from Turbo-IO's DeviceBusinessWire.
enum GlassesProtocol {
  /// Business 13 (voiceAssistant), type 5 = app_asr_text.
  /// Displays text on the HUD as if the assistant spoke it.
  static func asrText(_ text: String, isFinal: Bool = true) throws -> Data {
    guard text.utf8.count <= 1024 else { throw GlassesError.textTooLong }
    let body: [String: Any] = ["text": text, "final": isFinal]
    let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    // Protobuf wire: field 1 (varint, value 1), field 2 (varint, type 5),
    // field 3 (length-delimited, JSON body).
    var packet = Data([8, 1, 16, 5, 26]) // field1=1, field2=5, field3 tag
    appendVarInt(UInt64(bodyData.count), to: &packet)
    packet.append(bodyData)
    return packet
  }

  /// Business 21 (notifications), type 2 = push notification.
  /// Displays a title + content notification card on the HUD.
  static func notification(uid: String, title: String, content: String) throws -> Data {
    guard let uidValue = Int64(uid), uidValue > 0, uidValue <= Int32.max,
          !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          title.count <= 80, content.count <= 500 else {
      throw GlassesError.invalidNotification
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS"
    let body: [String: Any] = [
      "notificationUID": uid,
      "appId": "com.kendrickhome.atlas",
      "appName": "Atlas",
      "title": title,
      "subtitle": "",
      "content": content,
      "timestamp": formatter.string(from: Date()),
      "category": 0,
      "reply": false,
      "type": 1
    ]
    let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    var packet = Data([8, 1, 16, 2, 26])
    appendVarInt(UInt64(bodyData.count), to: &packet)
    packet.append(bodyData)
    return packet
  }

  /// Business 21, type 18 = enable/disable notification master switch.
  static func enableNotifications(_ enabled: Bool) throws -> Data {
    let body: [String: Any] = ["notification": enabled]
    let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    var packet = Data([8, 1, 16, 18, 26])
    appendVarInt(UInt64(bodyData.count), to: &packet)
    packet.append(bodyData)
    return packet
  }

  /// Business 21, type 17 = full notification settings (sources + display time).
  static func notificationSettings(enabled: Bool, displayTime: Int = 10) throws -> Data {
    let body: [String: Any] = [
      "notification": enabled,
      "callNotification": true,
      "avoidDuplicate": false,
      "displayTime": displayTime,
      "intervalTime": 2,
      "filterUID": [String]()
    ]
    let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    var packet = Data([8, 1, 16, 17, 26])
    appendVarInt(UInt64(bodyData.count), to: &packet)
    packet.append(bodyData)
    return packet
  }

  // MARK: - Wire helpers

  /// Wraps a business payload in a TransportFrame for BLE transmission.
  /// The frame format: AA55 + length(2) + msgNum(2) + packetType(1) + [addr] +
  /// sliceMeta + businessID + payload + CRC16-XMODEM(2).
  static func frame(businessID: UInt8, payload: Data, messageNumber: UInt16) throws -> Data {
    let limits = TransportLimits()
    let frameLength = 10 + payload.count
    guard frameLength <= limits.maxFrameBytes else { throw GlassesError.frameTooLarge }
    let lengthField = frameLength - 6
    var frame = Data([
      0xaa, 0x55,
      UInt8(lengthField >> 8), UInt8(lengthField & 0xff),
      UInt8(messageNumber >> 8), UInt8(messageNumber & 0xff),
      0x00, // flags: no address, no slice
      businessID
    ])
    frame.append(payload)
    let crc = CRC16.xmodem(frame.dropFirst(4))
    frame.append(UInt8(crc >> 8))
    frame.append(UInt8(crc & 0xff))
    return frame
  }

  private static func appendVarInt(_ value: UInt64, to data: inout Data) {
    var n = value
    while n >= 128 { data.append(UInt8(n & 127) | 128); n >>= 7 }
    data.append(UInt8(n))
  }
}

struct TransportLimits {
  let maxFrameBytes: Int
  let maxPayloadBytes: Int
  init(maxFrameBytes: Int = 65_541, maxPayloadBytes: Int = 65_524) {
    self.maxFrameBytes = maxFrameBytes
    self.maxPayloadBytes = maxPayloadBytes
  }
}

enum GlassesError: Error, LocalizedError {
  case textTooLong, invalidNotification, frameTooLarge, notConnected, bluetoothOff, scanFailed, connectFailed, characteristicMissing, writeFailed, timeout

  var errorDescription: String? {
    switch self {
    case .textTooLong: return "Text exceeds 1024 UTF-8 bytes."
    case .invalidNotification: return "Notification title or content is invalid."
    case .frameTooLarge: return "BLE frame exceeds 65541 bytes."
    case .notConnected: return "Glasses are not connected."
    case .bluetoothOff: return "Bluetooth is powered off."
    case .scanFailed: return "Failed to scan for RayNeo glasses."
    case .connectFailed: return "Failed to connect to the glasses."
    case .characteristicMissing: return "Required GATT characteristic not found."
    case .writeFailed: return "Failed to write to the glasses."
    case .timeout: return "Operation timed out."
    }
  }
}

// MARK: - CRC16 XMODEM

enum CRC16 {
  static func xmodem(_ data: DataSlice) -> UInt16 {
    var crc: UInt16 = 0
    for byte in data {
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

typealias DataSlice = Data.SubSequence

// MARK: - BLE Manager

/// CoreBluetooth manager for the RayNeo iO glasses.
/// Handles scanning, connecting, characteristic discovery, and message writing.
final class GlassesBLEManager: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {

  // Singleton — one glasses connection per app.
  static let shared = GlassesBLEManager()

  private let centralQueue = DispatchQueue(label: "com.kendrickhome.atlas.rayneo-ble", qos: .utility)
  private var central: CBCentralManager!
  private var peripheral: CBPeripheral?
  private var outboundChar: CBCharacteristic?
  private var inboundChar: CBCharacteristic?
  private var messageNumber: UInt16 = 0
  private var nextNotificationUID: Int64 = 1

  // State callback — invoked on every state change.
  var onStateChange: ((String, String?) -> Void)?

  // Connection promise — resolved when GATT is fully set up.
  private var connectPromise: ((Result<Void, Error>) -> Void)?
  private var connectTimeout: DispatchWorkItem?

  // Whether we've received data on the inbound characteristic (= authenticated).
  private var receivedData = false

  private override init() {
    super.init()
    central = CBCentralManager(delegate: self, queue: centralQueue)
  }

  // MARK: - Public API

  func connect(completion: @escaping (Result<Void, Error>) -> Void) {
    guard central.state == .poweredOn else {
      if central.state == .unknown {
        // Wait for state update, then scan.
        connectPromise = completion
        return
      }
      completion(.failure(GlassesError.bluetoothOff))
      return
    }
    connectPromise = completion
    startScan()

    // Timeout after 15 seconds.
    let timeout = DispatchWorkItem { [weak self] in
      guard let self else { return }
      if self.peripheral == nil {
        self.central.stopScan()
        self.emitState("disconnected", "Scan timed out — glasses not found")
        self.failConnect(GlassesError.timeout)
      }
    }
    connectTimeout = timeout
    centralQueue.asyncAfter(deadline: .now() + 15, execute: timeout)
  }

  func disconnect() {
    if let p = peripheral {
      central.cancelPeripheralConnection(p)
    }
    peripheral = nil
    outboundChar = nil
    inboundChar = nil
    receivedData = false
    emitState("disconnected", nil)
  }

  func writeFrame(_ frame: Data) throws {
    guard let p = peripheral, p.state == .connected,
          let char = outboundChar else {
      throw GlassesError.notConnected
    }
    peripheral?.writeValue(frame, for: char, type: .withResponse)
  }

  func nextUID() -> String {
    let uid = String(nextNotificationUID)
    nextNotificationUID = nextNotificationUID >= Int32.max ? 1 : nextNotificationUID + 1
    return uid
  }

  func incrementMessageNumber() -> UInt16 {
    messageNumber &+= 1
    return messageNumber
  }

  var isConnected: Bool {
    peripheral?.state == .connected && outboundChar != nil
  }

  // MARK: - Private

  private func startScan() {
    emitState("scanning", "Searching for RayNeo iO glasses…")
    // First, check if the system already has the peripheral connected.
    let connected = central.retrieveConnectedPeripherals(withServices: [RayNeoIOProfile.serviceUUID])
    if let already = connected.first {
      central.stopScan()
      self.peripheral = already
      already.delegate = self
      already.discoverServices([RayNeoIOProfile.serviceUUID])
      emitState("connecting", "Found bonded glasses — discovering services…")
      return
    }
    central.scanForPeripherals(
      withServices: [RayNeoIOProfile.serviceUUID],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
    )
  }

  private func failConnect(_ error: Error) {
    connectTimeout?.cancel()
    connectTimeout = nil
    let promise = connectPromise
    connectPromise = nil
    promise?(.failure(error))
  }

  private func successConnect() {
    connectTimeout?.cancel()
    connectTimeout = nil
    let promise = connectPromise
    connectPromise = nil
    promise?(.success(()))
  }

  private func emitState(_ state: String, _ message: String?) {
    DispatchQueue.main.async { [weak self] in
      self?.onStateChange?(state, message)
    }
  }

  // MARK: - CBCentralManagerDelegate

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      // If a connect was queued while Bluetooth was initializing, start now.
      if connectPromise != nil && peripheral == nil {
        startScan()
      }
    } else if central.state == .poweredOff {
      emitState("disconnected", "Bluetooth powered off")
      failConnect(GlassesError.bluetoothOff)
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    // Only connect to the first RayNeo iO we find (it's already bonded).
    central.stopScan()
    self.peripheral = peripheral
    peripheral.delegate = self
    emitState("connecting", "Connecting to \(peripheral.name ?? "RayNeo iO")…")
    central.connect(peripheral, options: nil)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    emitState("connecting", "Connected — discovering GATT services…")
    peripheral.discoverServices([RayNeoIOProfile.serviceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    emitState("disconnected", "Connection failed: \(error?.localizedDescription ?? "unknown")")
    failConnect(error ?? GlassesError.connectFailed)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    self.peripheral = nil
    self.outboundChar = nil
    self.inboundChar = nil
    self.receivedData = false
    emitState("disconnected", "Glasses disconnected")
  }

  // MARK: - CBPeripheralDelegate

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil else {
      failConnect(GlassesError.connectFailed)
      return
    }
    guard let services = peripheral.services,
          let svc = services.first(where: { $0.uuid == RayNeoIOProfile.serviceUUID }) else {
      failConnect(GlassesError.characteristicMissing)
      return
    }
    peripheral.discoverCharacteristics([RayNeoIOProfile.outboundUUID, RayNeoIOProfile.inboundUUID], for: svc)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard error == nil, let characteristics = service.characteristics else {
      failConnect(GlassesError.characteristicMissing)
      return
    }
    for char in characteristics {
      if char.uuid == RayNeoIOProfile.outboundUUID {
        outboundChar = char
      } else if char.uuid == RayNeoIOProfile.inboundUUID {
        inboundChar = char
        // Enable notifications on the inbound characteristic to receive glasses → phone data.
        peripheral.setNotifyValue(true, for: char)
      }
    }
    guard outboundChar != nil else {
      failConnect(GlassesError.characteristicMissing)
      return
    }
    // GATT is set up. We're connected (not yet authenticated, but the transport is ready).
    emitState("connected", "GATT connected — glasses HUD ready")
    successConnect()

    // Attempt to enable notifications on the glasses (business 21, type 18).
    // This lets us push notification cards. Best-effort — may fail if the
    // glasses require MFi auth first, but the text push path (business 13)
    // often works without it.
    do {
      let payload = try GlassesProtocol.enableNotifications(true)
      let frame = try GlassesProtocol.frame(businessID: 21, payload: payload, messageNumber: incrementMessageNumber())
      try writeFrame(frame)
    } catch {
      // Non-fatal — text push may still work.
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    // Notification enable/disable result — we don't need to act on it.
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    // Data received from the glasses on the inbound characteristic.
    if characteristic.uuid == RayNeoIOProfile.inboundUUID, characteristic.value != nil {
      if !receivedData {
        receivedData = true
        emitState("authenticated", "Glasses authenticated")
      }
      // We could parse inbound frames here for state callbacks (type 3 = display state).
      // For now, we just mark as authenticated.
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    if let error = error {
      NSLog("[RayNeoGlasses] Write failed: \(error.localizedDescription)")
    }
  }
}

// MARK: - Expo Module

/// Expo native module that exposes the RayNeo iO glasses bridge to React Native.
@objc(RayNeoGlassesModule)
public final class RayNeoGlassesModule: ExpoModule {

  private var ble = GlassesBLEManager.shared
  private var stateListeners = 0

  public override func definition() -> ModuleDefinition {
    Name("ExpoRayNeoGlasses")

    Events("onGlassesState")

    // Set up the BLE state callback to emit events to JS.
    AsyncFunction("connect") { (promise: Promise) in
      self.ble.onStateChange = { [weak self] state, message in
        self?.sendEvent("onGlassesState", ["state": state, "message": message ?? NSNull()])
      }
      self.ble.connect { result in
        switch result {
        case .success:
          promise.resolve(nil)
        case .failure(let error):
          promise.reject("ERR_GLASSES_CONNECT", error.localizedDescription)
        }
      }
    }

    AsyncFunction("disconnect") { () in
      self.ble.disconnect()
    }

    AsyncFunction("getState") { () in
      return "disconnected" // Simplified — JS tracks state via events
    }

    AsyncFunction("pushText") { (text: String, promise: Promise) in
      do {
        let payload = try GlassesProtocol.asrText(text)
        let frame = try GlassesProtocol.frame(
          businessID: 13, // voiceAssistant
          payload: payload,
          messageNumber: self.ble.incrementMessageNumber()
        )
        try self.ble.writeFrame(frame)
        promise.resolve(nil)
      } catch {
        promise.reject("ERR_GLASSES_WRITE", error.localizedDescription)
      }
    }

    AsyncFunction("pushNotification") { (title: String, content: String, promise: Promise) in
      let uid = self.ble.nextUID()
      do {
        let payload = try GlassesProtocol.notification(uid: uid, title: title, content: content)
        let frame = try GlassesProtocol.frame(
          businessID: 21, // notifications
          payload: payload,
          messageNumber: self.ble.incrementMessageNumber()
        )
        try self.ble.writeFrame(frame)
        promise.resolve(uid)
      } catch {
        promise.reject("ERR_GLASSES_NOTIFY", error.localizedDescription)
      }
    }

    Function("addListener") { (eventName: String) in
      self.stateListeners += 1
    }

    Function("removeListeners") { (count: Int) in
      self.stateListeners = max(0, self.stateListeners - count)
    }
  }
}
