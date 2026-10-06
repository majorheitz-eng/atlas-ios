const { withInfoPlist } = require('expo/config-plugins');

/**
 * Expo config plugin for the RayNeo iO glasses native module.
 * Adds Info.plist keys for Bluetooth and MFi accessory access.
 * The RayneoNet.framework is linked via the podspec's vendored_frameworks.
 */
module.exports = function withRayNeoGlasses(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSBluetoothAlwaysUsageDescription =
      'Atlas uses Bluetooth to connect to your RayNeo iO glasses and display responses on the HUD.';
    mod.modResults.NSBluetoothPeripheralUsageDescription =
      'Atlas uses Bluetooth to connect to your RayNeo iO glasses.';
    if (!mod.modResults.UISupportedExternalAccessoryProtocols) {
      mod.modResults.UISupportedExternalAccessoryProtocols = [];
    }
    if (!mod.modResults.UISupportedExternalAccessoryProtocols.includes('com.rayneo.venus.pub')) {
      mod.modResults.UISupportedExternalAccessoryProtocols.push('com.rayneo.venus.pub');
    }
    if (!mod.modResults.UIBackgroundModes) {
      mod.modResults.UIBackgroundModes = [];
    }
    if (!mod.modResults.UIBackgroundModes.includes('bluetooth-central')) {
      mod.modResults.UIBackgroundModes.push('bluetooth-central');
    }
    return mod;
  });
};
