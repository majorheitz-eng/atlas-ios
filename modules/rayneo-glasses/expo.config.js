const { withInfoPlist, withXcodeProject } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Expo config plugin for the RayNeo iO glasses native module.
 * Adds Info.plist keys for Bluetooth/MFi and links the RayneoNet.framework
 * into the Xcode project.
 */
module.exports = function withRayNeoGlasses(config) {
  config = withInfoPlist(config, (mod) => {
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

  // Link the RayneoNet.framework into the Xcode project.
  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = project.getFirstTarget().firstTarget;
    const frameworkPath = path.join(
      mod.modRequest.projectRoot,
      'modules', 'rayneo-glasses', 'ios', 'RayneoNet.framework'
    );

    if (fs.existsSync(frameworkPath)) {
      // Add the framework as a file reference
      const fileRef = project.addFramework(frameworkPath, {
        customFramework: true,
        embed: true,
        sign: true,
      });
      // Add to the target's frameworks build phase
      project.addFramework(frameworkPath, {
        target: target.uuid,
        customFramework: true,
        embed: true,
        sign: true,
      });
      // Ensure FRAMEWORK_SEARCH_PATHS includes the framework directory
      const searchPath = path.dirname(frameworkPath);
      project.addToBuildSettings('FRAMEWORK_SEARCH_PATHS',
        `"$(inherited)" "$(PROJECT_DIR)/../modules/rayneo-glasses/ios"`);
    }

    return mod;
  });

  return config;
};
