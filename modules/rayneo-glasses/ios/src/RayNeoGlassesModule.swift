import ExpoModulesCore
import CoreBluetooth
import ExternalAccessory
import Foundation

// MARK: - GATT Profile

enum RayNeoIOProfile {
  static let serviceUUID     = CBUUID(string: "0000B81D-0000-1000-8000-00805F9B34FB")
  static let outboundUUID    = CBUUID(string: "EA8B70D5-2BD3-49AB-9C31-9C38B2C3C4F9")
  static let inboundUUID     = CBUUID(string: "7DB3E235-3608-41F3-A03C-955FCBD2EA4B")
  static let accessoryProtocol = "com.rayneo.venus.pub"
}

// MARK: - Protocol Encoder

enum GlassesProtocol {
  static func asrText(_ text: String) throws -> Data {
    guard text.utf8.count <= 1024 else { throw GlassesError.textTooLong }
    let body: [String: Any] = ["text": text, "final": true]
    let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    var packet = Data([8, 1, 16, 5, 26])
    appendVarInt(UInt64(bodyData.count), to: &packet)
    packet.append(bodyData)
    return packet
  }

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
      "notificationUID": uid, "appId": "com.kendrickhome.atlas",
      "appName": "Atlas", "title": title, "subtitle": "", "content": content,
      "timestamp": formatter.string(from: Date()), "category": 0, "reply": false, "type": 1
    ]
    let bodyData = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    var packet = Data([8, 1, 16, 2, 26])
    appendVarInt(UInt64(bodyData.count), to: &packet)
    packet.append(bodyData)
    return packet
  }

  static func frame(businessID: UInt8, payload: Data, messageNumber: UInt16) throws -> Data {
    let length = 4 + payload.count
    var frame = Data([0xaa, 0x55, UInt8(length >> 8), UInt8(length & 0xff),
                      UInt8(messageNumber >> 8), UInt8(messageNumber & 0xff), 0x00, businessID])
    frame.append(payload)
    let crc = crc16Xmodem(frame.dropFirst(4))
    frame.append(UInt8(crc >> 8))
    frame.append(UInt8(crc & 0xff))
    return frame
  }

  private static func appendVarInt(_ value: UInt64, to data: inout Data) {
    var n = value
    while n >= 128 { data.append(UInt8(n & 127) | 128); n >>= 7 }
    data.append(UInt8(n))
  }

  private static func crc16Xmodem(_ data: Data.SubSequence) -> UInt16 {
    var crc: UInt16 = 0
    for byte in data {
      crc ^= UInt16(byte) << 8
      for _ in 0..<8 { crc = (crc & 0x8000 != 0) ? (crc << 1) ^ 0x1021 : crc << 1 }
    }
    return crc
  }
}

// MARK: - Errors

enum GlassesError: Error, LocalizedError {
  case textTooLong, invalidNotification, notConnected, bluetoothOff, timeout
  var errorDescription: String? {
    switch self {
    case .textTooLong: return "Text exceeds 1024 bytes."
    case .invalidNotification: return "Invalid notification."
    case .notConnected: return "Glasses not connected."
    case .bluetoothOff: return "Bluetooth is off."
    case .timeout: return "Connection timed out."
    }
  }
}

// MARK: - BLE Manager

final class GlassesBLEManager: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  static let shared = GlassesBLEManager()
  private var central: CBCentralManager!
  private var peripheral: CBPeripheral?
  private var outboundChar: CBCharacteristic?
  private var inboundChar: CBCharacteristic?
  private var msgNum: UInt16 = 0
  private var nextUID: Int64 = 1
  private var completion: ((Result<Void, Error>) -> Void)?
  private var timeout: DispatchWorkItem?
  private var receivedData = false
  var onStateChange: ((String, String?) -> Void)?
  var isConnected: Bool { peripheral?.state == .connected && outboundChar != nil }

  private override init() {
    super.init()
    central = CBCentralManager(delegate: self, queue: DispatchQueue(label: "atlas.rayneo", qos: .utility))
  }

  func connect(completion: @escaping (Result<Void, Error>) -> Void) {
    self.completion = completion
    let t = DispatchWorkItem { [weak self] in self?.fail(GlassesError.timeout) }
    timeout = t
    DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: t)
    if central.state == .poweredOn { startScan() }
  }

  func disconnect() {
    if let p = peripheral { central.cancelPeripheralConnection(p) }
    timeout?.cancel(); timeout = nil
    peripheral = nil; outboundChar = nil; inboundChar = nil; receivedData = false
    emit("disconnected", nil)
  }

  func pushText(_ text: String) throws {
    guard let p = peripheral, p.state == .connected, let c = outboundChar else { throw GlassesError.notConnected }
    let payload = try GlassesProtocol.asrText(text)
    let frame = try GlassesProtocol.frame(businessID: 13, payload: payload, messageNumber: nextMsg())
    p.writeValue(frame, for: c, type: .withResponse)
  }

  func pushNotification(title: String, content: String) throws -> String {
    guard let p = peripheral, p.state == .connected, let c = outboundChar else { throw GlassesError.notConnected }
    let uid = String(nextUID); nextUID = nextUID >= Int32.max ? 1 : nextUID + 1
    let payload = try GlassesProtocol.notification(uid: uid, title: title, content: content)
    let frame = try GlassesProtocol.frame(businessID: 21, payload: payload, messageNumber: nextMsg())
    p.writeValue(frame, for: c, type: .withResponse)
    return uid
  }

  private func nextMsg() -> UInt16 { msgNum &+= 1; return msgNum }

  private func startScan() {
    emit("scanning", "Searching for RayNeo iO glasses…")
    let connected = central.retrieveConnectedPeripherals(withServices: [RayNeoIOProfile.serviceUUID])
    if let p = connected.first {
      central.stopScan(); self.peripheral = p; p.delegate = self
      p.discoverServices([RayNeoIOProfile.serviceUUID])
      emit("connecting", "Found bonded glasses…")
      return
    }
    central.scanForPeripherals(withServices: [RayNeoIOProfile.serviceUUID], options: nil)
  }

  private func emit(_ s: String, _ m: String?) {
    DispatchQueue.main.async { [weak self] in self?.onStateChange?(s, m) }
  }
  private func ok() { timeout?.cancel(); timeout = nil; completion?(.success(())); completion = nil }
  private func fail(_ e: Error) { timeout?.cancel(); timeout = nil; completion?(.failure(e)); completion = nil }

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    if c.state == .poweredOn && completion != nil { startScan() }
    else if c.state == .poweredOff { emit("disconnected", "Bluetooth off"); fail(GlassesError.bluetoothOff) }
  }
  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
    c.stopScan(); peripheral = p; p.delegate = self
    emit("connecting", "Connecting to \(p.name ?? "RayNeo iO")…")
    c.connect(p, options: nil)
  }
  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
    emit("connecting", "Discovering services…")
    p.discoverServices([RayNeoIOProfile.serviceUUID])
  }
  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { fail(error ?? GlassesError.notConnected) }
  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    peripheral = nil; outboundChar = nil; inboundChar = nil; receivedData = false
    emit("disconnected", "Glasses disconnected")
  }
  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    guard let svc = p.services?.first(where: { $0.uuid == RayNeoIOProfile.serviceUUID }) else { fail(GlassesError.notConnected); return }
    p.discoverCharacteristics([RayNeoIOProfile.outboundUUID, RayNeoIOProfile.inboundUUID], for: svc)
  }
  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor svc: CBService, error: Error?) {
    guard let chars = svc.characteristics else { fail(GlassesError.notConnected); return }
    for c in chars {
      if c.uuid == RayNeoIOProfile.outboundUUID { outboundChar = c }
      if c.uuid == RayNeoIOProfile.inboundUUID { inboundChar = c; p.setNotifyValue(true, for: c) }
    }
    guard outboundChar != nil else { fail(GlassesError.notConnected); return }
    emit("connected", "GATT connected — HUD ready")
    ok()
    // Enable notifications (best effort)
    if let c = outboundChar {
      let payload = try? GlassesProtocol.frame(businessID: 21,
        payload: try! JSONSerialization.data(withJSONObject: ["notification": true], options: [.sortedKeys]),
        messageNumber: nextMsg())
      if let f = payload { p.writeValue(f, for: c, type: .withResponse) }
    }
  }
  func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
    if c.uuid == RayNeoIOProfile.inboundUUID && c.value != nil && !receivedData {
      receivedData = true; emit("authenticated", "Glasses authenticated")
    }
  }
}

// MARK: - Expo Module

public final class RayNeoGlassesModule: Module {
  private var ble = GlassesBLEManager.shared
  private var listeners = 0

  public func definition() -> ModuleDefinition {
    Name("ExpoRayNeoGlasses")
    Events("onGlassesState")

    AsyncFunction("connect") { (promise: Promise) in
      self.ble.onStateChange = { [weak self] state, msg in
        self?.sendEvent("onGlassesState", ["state": state, "message": msg ?? NSNull()])
      }
      self.ble.connect { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let e): promise.reject("ERR_CONNECT", e.localizedDescription)
        }
      }
    }
    AsyncFunction("disconnect") { () in self.ble.disconnect() }
    AsyncFunction("getState") { () in self.ble.isConnected ? "connected" : "disconnected" }
    AsyncFunction("pushText") { (text: String, promise: Promise) in
      do { try self.ble.pushText(text); promise.resolve(nil) }
      catch { promise.reject("ERR_WRITE", error.localizedDescription) }
    }
    AsyncFunction("pushNotification") { (title: String, content: String, promise: Promise) in
      do { let uid = try self.ble.pushNotification(title: title, content: content); promise.resolve(uid) }
      catch { promise.reject("ERR_NOTIFY", error.localizedDescription) }
    }
    Function("addListener") { (_: String) in self.listeners += 1 }
    Function("removeListeners") { (_: Int) in }
  }
}
