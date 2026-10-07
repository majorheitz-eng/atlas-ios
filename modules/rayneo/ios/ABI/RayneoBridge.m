#import "RayneoBridge.h"
#import "ProbeBridge.h"
#import <dlfcn.h>

// MARK: - Swift calling convention helpers

// Swift's swiftcall passes self in a dedicated context register (x20 on arm64).
// clang maps `__attribute__((swift_context))` to that register.
// Swift throws via `__attribute__((swift_error))` which puts the error in x0
// (clang uses a separate register for the error return).

// MARK: - Address resolution

void *RayneoBridgeGetAddress(const char *name) {
    return dlsym(RTLD_DEFAULT, name);
}

void *RayneoBridgeCoreSharedAddress(void) {
    return dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC5shareACvgZ");
}

void *RayneoBridgeCoreVersionAddress(void) {
    return dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC10SDKVersionSSSgvgZ");
}

void *RayneoBridgeCreateMessageAddress(void) {
    return dlsym(RTLD_DEFAULT, "$s9RayneoNet9RNMessageC7payload8deviceId08businessF003msgF012appUniteCodeAC10Foundation4DataVSg_SSAA10BusinessIDOS2StcfC");
}

BOOL RayneoBridgeImageMatches(void) {
    return RNProbeMessageImageMatches();
}

// MARK: - Singleton and free function dispatchers

// RNCoreConnect.share() -> CoreHandle (opaque pointer)
// Static getter, returns a retained reference type in x0.
void *RayneoBridgeGetCoreShared(void) {
    void *address = RayneoBridgeCoreSharedAddress();
    if (!address) return NULL;
    typedef void *(*Getter)(void) __attribute__((swiftcall));
    return ((Getter)address)();
}

// RNCoreConnect.SDKVersion() -> String?
// Static getter, returns Swift String in x0/x1 (or nil via spare bit).
RayneoSwiftString RayneoBridgeGetCoreVersion(void) {
    void *address = RayneoBridgeCoreVersionAddress();
    if (!address) return (RayneoSwiftString){0, 0};
    typedef RayneoSwiftString (*Getter)(void) __attribute__((swiftcall));
    return ((Getter)address)();
}

// RNMessage.__allocating_init(payload:deviceID:businessIndex:msgID:appUniteCode:)
// Takes __owned Data?, String, UInt8, String, String -> RNMessage
// Data? is passed as (buffer, count) in first two args, with nil = (NULL, 0).
void *RayneoBridgeCreateMessage(void *payloadBuffer, uint64_t payloadCount,
                                RayneoSwiftString deviceID, uint8_t businessIndex,
                                RayneoSwiftString appUniteCode) {
    void *address = RayneoBridgeCreateMessageAddress();
    if (!address) return NULL;
    typedef void *(*Initializer)(void *payloadBuffer, uint64_t payloadCount,
                                 RayneoSwiftString deviceID, uint8_t businessIndex,
                                 RayneoSwiftString msgID,
                                 RayneoSwiftString appUniteCode)
                 __attribute__((swiftcall));
    // The init discards msgID and appUniteCode, but they're still consumed.
    RayneoSwiftString emptyString = {0, 0};
    return ((Initializer)address)(payloadBuffer, payloadCount, deviceID,
                                   businessIndex, emptyString, appUniteCode);
}

// MARK: - RNCoreConnect instance methods

// bondedDevices() -> [RNDevice]?
// Returns optional array. nil = storage is NULL.
// We read count from the array struct.
RayneoSwiftArray RayneoBridgeBondedDevicesRaw(void *core) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC13bondedDevicesSayAA8RNDeviceCGSgvg");
    if (!address) return (RayneoSwiftArray){NULL, 0, 0};
    typedef RayneoSwiftArray (*Getter)(void *self) __attribute__((swiftcall))
                        __attribute__((swift_context));
    return ((Getter)address)(core);
}

uint64_t RayneoBridgeBondedDeviceCount(void *core) {
    RayneoSwiftArray array = RayneoBridgeBondedDevicesRaw(core);
    return array.count;
}

void *RayneoBridgeBondedDeviceAt(void *core, uint64_t index) {
    RayneoSwiftArray array = RayneoBridgeBondedDevicesRaw(core);
    if (!array.storage || index >= array.count) return NULL;
    // Swift Array<ReferenceType> stores pointers to the objects.
    void **elements = (void **)array.storage;
    return elements[index];
}

// linkedDevices() -> [RNDevice]?
RayneoSwiftArray RayneoBridgeLinkedDevicesRaw(void *core) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC20currentLinkedDevicesSayAA8RNDeviceCGSgvg");
    if (!address) return (RayneoSwiftArray){NULL, 0, 0};
    typedef RayneoSwiftArray (*Getter)(void *self) __attribute__((swiftcall))
                        __attribute__((swift_context));
    return ((Getter)address)(core);
}

uint64_t RayneoBridgeLinkedDeviceCount(void *core) {
    RayneoSwiftArray array = RayneoBridgeLinkedDevicesRaw(core);
    return array.count;
}

void *RayneoBridgeLinkedDeviceAt(void *core, uint64_t index) {
    RayneoSwiftArray array = RayneoBridgeLinkedDevicesRaw(core);
    if (!array.storage || index >= array.count) return NULL;
    void **elements = (void **)array.storage;
    return elements[index];
}

// findDevice(_ id: String) -> RNDevice?
void *RayneoBridgeFindDevice(void *core, RayneoSwiftString deviceID) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC10findDeviceyAA8RNDeviceCSgSSF");
    if (!address) return NULL;
    typedef void *(*Finder)(RayneoSwiftString deviceID, void *self)
                 __attribute__((swiftcall))
                 __attribute__((swift_context));
    return ((Finder)address)(deviceID, core);
}

// discover() throws
BOOL RayneoBridgeDiscover(void *core, NSError **error) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC13discoverStart7filters11retrieveIdsySayAA15RNDiscoveryTypeOGSg_SaySSGSgtKF");
    if (!address) { return NO; }
    // discoverStart(filters: [RNDiscoveryType]?, retrieveIDs: [String]?) throws
    // [RNDiscoveryType]? nil = (NULL, 0, 0); [String]? nil = (NULL, 0, 0)
    typedef void (*Discoverer)(RayneoSwiftArray filters, RayneoSwiftArray retrieveIDs,
                                void *self, NSError **error)
                 __attribute__((swiftcall))
                 __attribute__((swift_context))

    RayneoSwiftArray nilArray = {NULL, 0, 0};
    ((Discoverer)address)(nilArray, nilArray, core, error);
    return *error == nil;
}

// connect(_ device: RNDevice, userID: String, type: RNDeviceConnectType) throws
BOOL RayneoBridgeConnectBLE(void *core, void *device,
                             RayneoSwiftString userID, uint8_t type,
                             NSError **error) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC3cmd7connect6userId_yAA8RNDeviceC_SSAA0iD4TypeOtKF");
    if (!address) { return NO; }
    typedef void (*Connector)(void *device, RayneoSwiftString userID, uint8_t type,
                              void *self, NSError **error)
                 __attribute__((swiftcall))
                 __attribute__((swift_context))

    ((Connector)address)(device, userID, type, core, error);
    return *error == nil;
}

// unbind(_ device: RNDevice) throws
BOOL RayneoBridgeUnbind(void *core, void *device, NSError **error) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC3cmd7unboundyAA8RNDeviceC_tKF");
    if (!address) { return NO; }
    typedef void (*Unbinder)(void *device, void *self, NSError **error)
                 __attribute__((swiftcall))
                 __attribute__((swift_context))

    ((Unbinder)address)(device, core, error);
    return *error == nil;
}

// sendMessage(_ message: RNMessage) throws
BOOL RayneoBridgeSendMessage(void *core, void *message, NSError **error) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC4send7messageyAA9RNMessageC_tKF");
    if (!address) { return NO; }
    typedef void (*Sender)(void *message, void *self, NSError **error)
                 __attribute__((swiftcall))
                 __attribute__((swift_context))

    ((Sender)address)(message, core, error);
    return *error == nil;
}

// setAccountID(_ value: String)
void RayneoBridgeSetAccountID(void *core, RayneoSwiftString accountID) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC12setAccountIdyySSF");
    if (!address) return;
    typedef void (*Setter)(RayneoSwiftString accountID, void *self)
                 __attribute__((swiftcall))
                 __attribute__((swift_context));
    ((Setter)address)(accountID, core);
}

// shareFile(_ url: URL, _ device: String, _ target: UInt8, _ extra: String) -> String?
RayneoSwiftString RayneoBridgeShareFile(void *core, NSURL *url,
                                         RayneoSwiftString deviceID, uint8_t target,
                                         RayneoSwiftString extra) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC9fileShare4send8deviceId6target5extraSSSg10Foundation3URLV_SSAA13RNShareTargetOSStF");
    if (!address) return (RayneoSwiftString){0, 0};
    typedef RayneoSwiftString (*Sharer)(NSURL *url, RayneoSwiftString deviceID,
                                          uint8_t target, RayneoSwiftString extra,
                                          void *self)
                 __attribute__((swiftcall))
                 __attribute__((swift_context));
    return ((Sharer)address)(url, deviceID, target, extra, core);
}

// cancelShare(_ device: String, _ task: String)
void RayneoBridgeCancelShare(void *core, RayneoSwiftString deviceID, RayneoSwiftString taskID) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet13RNCoreConnectC9fileShare10cancelSend6taskIdySS_SStF");
    if (!address) return;
    typedef void (*Canceller)(RayneoSwiftString deviceID, RayneoSwiftString taskID,
                               void *self)
                 __attribute__((swiftcall))
                 __attribute__((swift_context));
    ((Canceller)address)(deviceID, taskID, core);
}

// MARK: - RNDevice instance methods

// deviceID -> String
RayneoSwiftString RayneoBridgeDeviceID(void *device) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet8RNDeviceC2idSSvg");
    if (!address) return (RayneoSwiftString){0, 0};
    typedef RayneoSwiftString (*Getter)(void *self) __attribute__((swiftcall))
                        __attribute__((swift_context));
    return ((Getter)address)(device);
}

// name -> String
RayneoSwiftString RayneoBridgeDeviceName(void *device) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet8RNDeviceC4nameSSvg");
    if (!address) return (RayneoSwiftString){0, 0};
    typedef RayneoSwiftString (*Getter)(void *self) __attribute__((swiftcall))
                        __attribute__((swift_context));
    return ((Getter)address)(device);
}

// isConnected -> Bool
BOOL RayneoBridgeDeviceConnected(void *device) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet8RNDeviceC11isConnectedSbvg");
    if (!address) return NO;
    // Swift Bool is returned in x0 as a byte (0 or 1).
    typedef uint8_t (*Getter)(void *self) __attribute__((swiftcall))
                    __attribute__((swift_context));
    return ((Getter)address)(device) != 0;
}

// bleState -> BleState (enum, returned as UInt8)
uint8_t RayneoBridgeDeviceBleState(void *device) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet8RNDeviceC8bleStateAA03BleE0Ovg");
    if (!address) return 255;
    typedef uint8_t (*Getter)(void *self) __attribute__((swiftcall))
                    __attribute__((swift_context));
    return ((Getter)address)(device);
}

// transport (rnPer) -> RNPeripheral
void *RayneoBridgeDeviceTransport(void *device) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet8RNDeviceC5rnPerAA12RNPeripheralCvg");
    if (!address) return NULL;
    typedef void *(*Getter)(void *self) __attribute__((swiftcall))
                  __attribute__((swift_context));
    return ((Getter)address)(device);
}

// MARK: - RNPeripheral instance methods

// peripheral -> CBPeripheral?
CBPeripheral *RayneoBridgeTransportPeripheral(void *transport) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet12RNPeripheralC10peripheralSo12CBPeripheralCSgvg");
    if (!address) return nil;
    // Swift Optional<CBPeripheral> as a reference type: returned as a pointer
    // (nil = NULL pointer). The spare bit is in the pointer itself.
    typedef void *(*Getter)(void *self) __attribute__((swiftcall))
                  __attribute__((swift_context));
    void *result = ((Getter)address)(transport);
    if (!result) return nil;
    return (__bridge CBPeripheral *)result;
}

// bleState -> BLEConnectState (enum, returned as UInt8)
uint8_t RayneoBridgeTransportState(void *transport) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet12RNPeripheralC8bleStateAA010BLEConnectE0Ovg");
    if (!address) return 255;
    typedef uint8_t (*Getter)(void *self) __attribute__((swiftcall))
                    __attribute__((swift_context));
    return ((Getter)address)(transport);
}

// MARK: - RNMessage instance methods

// setMessageID(_ value: String)
void RayneoBridgeSetMessageID(void *message, RayneoSwiftString msgID) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet9RNMessageC5msgIdSSvs");
    if (!address) return;
    typedef void (*Setter)(RayneoSwiftString msgID, void *self)
                 __attribute__((swiftcall))
                 __attribute__((swift_context));
    ((Setter)address)(msgID, message);
}

// deviceID -> String
RayneoSwiftString RayneoBridgeMessageDeviceID(void *message) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet9RNMessageC8deviceIdSSvg");
    if (!address) return (RayneoSwiftString){0, 0};
    typedef RayneoSwiftString (*Getter)(void *self) __attribute__((swiftcall))
                        __attribute__((swift_context));
    return ((Getter)address)(message);
}

// businessID -> BusinessID (enum, returned as UInt8)
uint8_t RayneoBridgeMessageBusinessIndex(void *message) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet9RNMessageC10businessIDAA08BusinessE0Ovg");
    if (!address) return 255;
    typedef uint8_t (*Getter)(void *self) __attribute__((swiftcall))
                    __attribute__((swift_context));
    return ((Getter)address)(message);
}

// msgID -> String
RayneoSwiftString RayneoBridgeMessageID(void *message) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet9RNMessageC5msgIdSSvg");
    if (!address) return (RayneoSwiftString){0, 0};
    typedef RayneoSwiftString (*Getter)(void *self) __attribute__((swiftcall))
                        __attribute__((swift_context));
    return ((Getter)address)(message);
}

// payload -> Data?
// Data? is returned as (buffer, count) in x0/x1, with nil = (NULL, 0).
// We return the buffer pointer and count via separate accessor functions.
typedef struct { void *buffer; uint64_t count; } RayneoSwiftData;

static RayneoSwiftData RayneoBridgeMessagePayloadRaw(void *message) {
    void *address = dlsym(RTLD_DEFAULT, "$s9RayneoNet9RNMessageC7payload10Foundation4DataVSgvg");
    if (!address) return (RayneoSwiftData){NULL, 0};
    typedef RayneoSwiftData (*Getter)(void *self) __attribute__((swiftcall))
                            __attribute__((swift_context));
    return ((Getter)address)(message);
}

void *RayneoBridgeMessagePayloadBuffer(void *message) {
    return RayneoBridgeMessagePayloadRaw(message).buffer;
}

uint64_t RayneoBridgeMessagePayloadCount(void *message) {
    return RayneoBridgeMessagePayloadRaw(message).count;
}
