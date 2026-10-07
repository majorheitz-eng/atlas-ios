#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>

NS_ASSUME_NONNULL_BEGIN

// MARK: - Swift ABI structs

// Swift String on arm64 is 16 bytes (two words).
// Returned in x0/x1 from swiftcall functions.
typedef struct { uint64_t word0; uint64_t word1; } RayneoSwiftString;

// Swift Array<T> for reference types is 24 bytes (three words):
//   storage pointer, count, capacity.
// Optional<Array<T>> uses spare bits; nil = zero storage.
typedef struct { void *storage; uint64_t count; uint64_t capacity; } RayneoSwiftArray;

// MARK: - Free function addresses (called from Swift via @convention(thin))

// Returns the dlsym-resolved address of the named symbol, or NULL.
FOUNDATION_EXPORT void * _Nullable RayneoBridgeGetAddress(const char * _Nonnull name);

// Convenience: address of RNCoreConnect.share() static getter
FOUNDATION_EXPORT void * _Nullable RayneoBridgeCoreSharedAddress(void);
// Convenience: address of RNCoreConnect.SDKVersion() static getter
FOUNDATION_EXPORT void * _Nullable RayneoBridgeCoreVersionAddress(void);
// Convenience: address of RNMessage.__allocating_init(payload:...)
FOUNDATION_EXPORT void * _Nullable RayneoBridgeCreateMessageAddress(void);

// MARK: - Instance method wrappers (self in swift_context register)

// RNCoreConnect instance methods
FOUNDATION_EXPORT uint64_t RayneoBridgeBondedDeviceCount(void * _Nonnull core);
FOUNDATION_EXPORT void * _Nullable RayneoBridgeBondedDeviceAt(void * _Nonnull core, uint64_t index);
FOUNDATION_EXPORT uint64_t RayneoBridgeLinkedDeviceCount(void * _Nonnull core);
FOUNDATION_EXPORT void * _Nullable RayneoBridgeLinkedDeviceAt(void * _Nonnull core, uint64_t index);
FOUNDATION_EXPORT void * _Nullable RayneoBridgeFindDevice(void * _Nonnull core, RayneoSwiftString deviceID);
FOUNDATION_EXPORT BOOL RayneoBridgeDiscover(void * _Nonnull core);
FOUNDATION_EXPORT BOOL RayneoBridgeConnectBLE(void * _Nonnull core, void * _Nonnull device,
                                              RayneoSwiftString userID, uint8_t type);
FOUNDATION_EXPORT BOOL RayneoBridgeUnbind(void * _Nonnull core, void * _Nonnull device);
FOUNDATION_EXPORT BOOL RayneoBridgeSendMessage(void * _Nonnull core, void * _Nonnull message);
FOUNDATION_EXPORT void RayneoBridgeSetAccountID(void * _Nonnull core, RayneoSwiftString accountID);
FOUNDATION_EXPORT RayneoSwiftString RayneoBridgeShareFile(void * _Nonnull core, NSURL * _Nonnull url,
                                                            RayneoSwiftString deviceID, uint8_t target,
                                                            RayneoSwiftString extra);
FOUNDATION_EXPORT void RayneoBridgeCancelShare(void * _Nonnull core, RayneoSwiftString deviceID,
                                                RayneoSwiftString taskID);

// RNDevice instance methods
FOUNDATION_EXPORT RayneoSwiftString RayneoBridgeDeviceID(void * _Nonnull device);
FOUNDATION_EXPORT RayneoSwiftString RayneoBridgeDeviceName(void * _Nonnull device);
FOUNDATION_EXPORT BOOL RayneoBridgeDeviceConnected(void * _Nonnull device);
FOUNDATION_EXPORT uint8_t RayneoBridgeDeviceBleState(void * _Nonnull device);
FOUNDATION_EXPORT void * _Nullable RayneoBridgeDeviceTransport(void * _Nonnull device);

// RNPeripheral instance methods
FOUNDATION_EXPORT CBPeripheral * _Nullable RayneoBridgeTransportPeripheral(void * _Nonnull transport);
FOUNDATION_EXPORT uint8_t RayneoBridgeTransportState(void * _Nonnull transport);

// RNMessage instance methods
FOUNDATION_EXPORT void RayneoBridgeSetMessageID(void * _Nonnull message, RayneoSwiftString msgID);
FOUNDATION_EXPORT RayneoSwiftString RayneoBridgeMessageDeviceID(void * _Nonnull message);
FOUNDATION_EXPORT uint8_t RayneoBridgeMessageBusinessIndex(void * _Nonnull message);
FOUNDATION_EXPORT RayneoSwiftString RayneoBridgeMessageID(void * _Nonnull message);
FOUNDATION_EXPORT void * _Nullable RayneoBridgeMessagePayloadBuffer(void * _Nonnull message);
FOUNDATION_EXPORT uint64_t RayneoBridgeMessagePayloadCount(void * _Nonnull message);

// MARK: - Diagnostics (reuse ProbeBridge)
FOUNDATION_EXPORT BOOL RayneoBridgeImageMatches(void);

NS_ASSUME_NONNULL_END
