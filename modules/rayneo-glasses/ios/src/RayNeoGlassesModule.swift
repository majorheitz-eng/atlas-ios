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

// MARK: - Protocol Encoder (notification payload only; text uses AssistantTextPrototype)

enum GlassesProtocol {
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
    var n = UInt64(bodyData.count)
    while n >= 128 { packet.append(UInt8(n & 127) | 128); n >>= 7 }
    packet.append(UInt8(n))
    packet.append(bodyData)
    return packet
  }
}

// MARK: - Errors

enum GlassesError: Error, LocalizedError {
  case textTooLong, invalidNotification, notConnected, notAuthenticated, bluetoothOff, scanFailed, connectFailed, timeout, frameworkNotLoaded

  var errorDescription: String? {
    switch self {
    case .textTooLong: return "Text exceeds 1024 UTF-8 bytes."
    case .invalidNotification: return "Notification title or content is invalid."
    case .notConnected: return "Glasses are not connected."
    case .notAuthenticated: return "Glasses are not MFi-authenticated (BLE state != 9)."
    case .bluetoothOff: return "Bluetooth is powered off."
    case .scanFailed: return "Failed to scan for RayNeo glasses."
    case .connectFailed: return "Failed to connect to the glasses."
    case .timeout: return "Connection timed out."
    case .frameworkNotLoaded: return "RayneoNet framework not loaded or version mismatch."
    }
  }
}

// MARK: - RayneoNet-Powered Glasses Manager

/// Uses the proprietary RayneoNet.framework for full MFi authentication,
/// BLE connection, and message sending. Handles ECDH key exchange, SHA256
/// proof, session key derivation, and encrypted transport automatically.
final class GlassesSDKManager: NSObject {

  static let shared = GlassesSDKManager()

  private var core: CoreHandle?
  private var receiver: CoreMessageReceiver?
  private var central: CBCentralManager?
  private var sdkPeripherals: [UUID: NSObject] = [:]
  private var connectCompletion: ((Result<Void, Error>) -> Void)?
  private var connectTimeout: DispatchWorkItem?
  private var nextNotificationUID: Int64 = 1

  var onStateChange: ((String, String?) -> Void)?
  var isConnected: Bool {
    guard let device = core?.linkedDevices()?.first else { return false }
    return device.isConnected() && device.bleStateByte() == 9
  }

  private override init() { super.init() }

  func connect(completion: @escaping (Result<Void, Error>) -> Void) {
    guard RNProbeMessageImageMatches() else {
      completion(.failure(GlassesError.frameworkNotLoaded))
      return
    }
    core = coreShared()
    setupMessageReceiver()
    central = CBCentralManager(delegate: self, queue: .main)
    connectCompletion = completion

    let timeout = DispatchWorkItem { [weak self] in self?.failConnect(GlassesError.timeout) }
    connectTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)

    do {
      try core?.discover()
      emitState("scanning", "Searching for RayNeo iO glasses via SDK…")
    } catch { failConnect(error) }
  }

  func disconnect() {
    connectTimeout?.cancel()
    connectTimeout = nil
    emitState("disconnected", nil)
  }

  func pushText(_ text: String) throws {
    guard let core, let device = core.linkedDevices()?.first,
          device.isConnected(), device.bleStateByte() == 9 else {
      throw GlassesError.notAuthenticated
    }
    let truncated = text.utf8.count > 1024 ? String(text.prefix(1024)) : text
    let payload = try AssistantTextPrototype.asrText(truncated)
    let message = try MessageFactory.make(
      payload: payload, deviceID: device.deviceID(),
      business: .voiceAssistant, messageID: UUID().uuidString)
    try core.sendMessage(message)
  }

  func pushNotification(title: String, content: String) throws -> String {
    guard let core, let device = core.linkedDevices()?.first,
          device.isConnected(), device.bleStateByte() == 9 else {
      throw GlassesError.notAuthenticated
    }
    let uid = nextUID()
    let payload = try GlassesProtocol.notification(uid: uid, title: title, content: content)
    let message = try MessageFactory.make(
      payload: payload, deviceID: device.deviceID(),
      business: .notification, messageID: UUID().uuidString)
    try core.sendMessage(message)
    return uid
  }

  func nextUID() -> String {
    let uid = String(nextNotificationUID)
    nextNotificationUID = nextNotificationUID >= Int32.max ? 1 : nextNotificationUID + 1
    return uid
  }

  private func setupMessageReceiver() {
    guard let core else { return }
    let r = CoreMessageReceiver()
    r.onMetadata = { [weak self] text in
      NSLog("[RayNeoGlasses] %@", text)
      self?.checkConnectionState()
    }
    r.onBusinessEnvelope = { [weak self] _, _, _ in self?.checkConnectionState() }
    r.onBusinessLoss = { [weak self] in self?.emitState("connected", "Message delivery interrupted") }
    core.addMessageDelegate(r)
    receiver = r
  }

  private func checkConnectionState() {
    guard let core else { return }
    if let device = core.linkedDevices()?.first {
      if device.isConnected() && device.bleStateByte() == 9 {
        emitState("authenticated", "Glasses authenticated — HUD ready")
        successConnect()
      } else if device.isConnected() {
        emitState("connected", "Glasses connected — waiting for auth")
      }
    }
  }

  private func successConnect() {
    connectTimeout?.cancel(); connectTimeout = nil
    connectCompletion?(.success(())); connectCompletion = nil
  }

  private func failConnect(_ error: Error) {
    connectTimeout?.cancel(); connectTimeout = nil
    connectCompletion?(.failure(error)); connectCompletion = nil
  }

  private func emitState(_ state: String, _ message: String?) {
    DispatchQueue.main.async { [weak self] in self?.onStateChange?(state, message) }
  }
}

// MARK: - CBCentralManagerDelegate

extension GlassesSDKManager: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      central.scanForPeripherals(withServices: [RayNeoIOProfile.serviceUUID],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
      emitState("scanning", "Bluetooth ready — scanning for glasses…")
    } else if central.state == .poweredOff {
      emitState("disconnected", "Bluetooth powered off")
      failConnect(GlassesError.bluetoothOff)
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    if let mfgData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data,
       let id = RNProbeIdentifier(mfgData, (advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue ?? false) {
      NSLog("[RayNeoGlasses] Discovered: %@", id)
    }
    if let sdkPeripheral = RNProbeSDKPeripheral(peripheral.identifier) {
      let catalog = sdkModelCatalog() ?? [:]
      if let mfgData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data,
         let parsed = RNProbePeripheral(mfgData, sdkPeripheral, advertisementData, catalog) {
        sdkPeripherals[peripheral.identifier] = parsed
        central.stopScan()
        emitState("connecting", "Connecting to \(peripheral.name ?? "RayNeo iO")…")
        if let core, let device = core.findDevice(peripheral.identifier.uuidString) ?? convertPeripheral(parsed) {
          do {
            try core.connectBLE(device)
            emitState("connecting", "SDK BLE connection requested — waiting for auth…")
          } catch {
            emitState("disconnected", "SDK connection failed: \(error.localizedDescription)")
            failConnect(error)
          }
        }
      }
    }
  }
}

// MARK: - Expo Module


public final class RayNeoGlassesModule: Module {
  private var sdk = GlassesSDKManager.shared
  private var stateListeners = 0

  public func definition() -> ModuleDefinition {
    Name("ExpoRayNeoGlasses")
    Events("onGlassesState")

    AsyncFunction("connect") { (promise: Promise) in
      self.sdk.onStateChange = { [weak self] state, message in
        self?.sendEvent("onGlassesState", ["state": state, "message": message ?? NSNull()])
      }
      self.sdk.connect { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let e): promise.reject("ERR_GLASSES_CONNECT", e.localizedDescription)
        }
      }
    }

    AsyncFunction("disconnect") { () in self.sdk.disconnect() }
    AsyncFunction("getState") { () in self.sdk.isConnected ? "authenticated" : "disconnected" }

    AsyncFunction("pushText") { (text: String, promise: Promise) in
      do { try self.sdk.pushText(text); promise.resolve(nil) }
      catch { promise.reject("ERR_GLASSES_WRITE", error.localizedDescription) }
    }

    AsyncFunction("pushNotification") { (title: String, content: String, promise: Promise) in
      do { let uid = try self.sdk.pushNotification(title: title, content: content); promise.resolve(uid) }
      catch { promise.reject("ERR_GLASSES_NOTIFY", error.localizedDescription) }
    }

    Function("addListener") { (eventName: String) in self.stateListeners += 1 }
    Function("removeListeners") { (count: Int) in self.stateListeners = max(0, self.stateListeners - count) }
  }
}
