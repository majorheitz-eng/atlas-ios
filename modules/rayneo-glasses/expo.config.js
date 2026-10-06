const { withInfoPlist } = require('expo/config-plugins');

/**
 * Expo config plugin for the RayNeo iO glasses native module.
 * Adds the required Info.plist keys for Bluetooth and MFi accessory access.
 */
module.exports = function withRayNeoGlasses(config) {
  return withInfoPlist(config, (mod) => {
    // CoreBluetooth — required to scan for and connect to BLE peripherals.
    mod.modResults.NSBluetoothAlwaysUsageDescription =
      'Atlas uses Bluetooth to connect to your RayNeo iO glasses and display responses on the HUD.';

    // Older iOS (pre-13) — harmless on modern iOS, avoids rejection if deployed back.
    mod.modResults.NSBluetoothPeripheralUsageDescription =
      'Atlas uses Bluetooth to connect to your RayNeo iO glasses.';

    // MFi accessory protocols — ExternalAccessory framework.
    // The RayNeo iO exposes this protocol string when paired via the official app.
    if (!mod.modResults.UISupportedExternalAccessoryProtocols) {
      mod.modResults.UISupportedExternalAccessoryProtocols = [];
    }
    if (!mod.modResults.UISupportedExternalAccessoryProtocols.includes('com.rayneo.venus.pub')) {
      mod.modResults.UISupportedExternalAccessoryProtocols.push('com.rayneo.venus.pub');
    }

    // Background mode for sustained BLE connection while the app is backgrounded.
    if (!mod.modResults.UIBackgroundModes) {
      mod.modResults.UIBackgroundModes = [];
    }
    if (!mod.modResults.UIBackgroundModes.includes('bluetooth-central')) {
      mod.modResults.UIBackgroundModes.push('bluetooth-central');
    }

    return mod;
  });
};
