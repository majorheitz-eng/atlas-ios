Pod::Spec.new do |s|
  s.name           = 'RayNeo'
  s.version        = '1.0.0'
  s.summary        = 'RayNeo iO BLE + MFi transport for Atlas'
  s.description    = 'Native CoreBluetooth + MFi EASession module with RayneoNet.framework'
  s.license        = 'MIT'
  s.author         = 'Atlas'
  s.homepage       = 'https://github.com/majorheitz-eng/atlas-ios'
  s.source         = { path: '.' }
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.0'

  # Turbo-IO architecture: @_silgen_name + RecoveredInterface swiftmodule.
  # CoreABI/MessageABI/CoreMessageReceiver use @_silgen_name to call RayneoNet.framework.
  # RayneoNet.swift is NOT compiled here — it's compiled to a swiftmodule by the
  # pre-install script (eas-build-post-install) so `import RayneoNet` resolves.
  # ProbeBridge.h/.m handles dlsym for image verification, ad parsing, SDK singleton.
  s.source_files   = "ios/RayNeoModule.swift",
                     "ios/ABI/CoreABI.swift",
                     "ios/ABI/MessageABI.swift",
                     "ios/ABI/CoreMessageReceiver.swift",
                     "ios/ABI/DeviceBusinessWire.swift",
                     "ios/ABI/BusinessEnvelopeMetadata.swift",
                     "ios/ABI/AssistantTextPrototype.swift",
                     "ios/ABI/ProtocolError.swift",
                     "ios/ABI/TLV.swift",
                     "ios/ABI/CRC16XMODEM.swift",
                     "ios/ABI/LauncherStructure.swift",
                     "ios/ABI/ProbeBridge.h", "ios/ABI/ProbeBridge.m"
  # RayneoNet.swift is declaration-only, compiled to swiftmodule by pre-install script
  s.exclude_files  = "ios/ABI/RayneoNet.swift"
  s.preserve_paths = "ios/ABI/RayneoNet.swift", "ios/ABI/build/**/*"

  s.vendored_frameworks = [
    'ios/Frameworks/RayneoNet.framework',
    'ios/Frameworks/CocoaAsyncSocket.framework',
    'ios/Frameworks/OpenSSL.framework',
    'ios/Frameworks/RayneoLog.framework',
    'ios/Frameworks/SwiftProtobuf.framework',
    'ios/Frameworks/CocoaLumberjack.framework',
    'ios/Frameworks/SSZipArchive.framework'
  ]

  s.frameworks     = 'CoreBluetooth', 'ExternalAccessory'

  # Add the declaration-only swiftmodule path so `import RayneoNet` resolves
  s.pod_target_xcconfig = {
    'SWIFT_INCLUDE_PATHS' => '$(inherited) ${PODS_ROOT}/../../modules/rayneo/ios/ABI/build',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks'
  }

  s.dependency     'ExpoModulesCore'
end
