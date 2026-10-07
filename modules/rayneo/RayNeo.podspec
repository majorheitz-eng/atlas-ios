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

  # Main module source — Expo module Swift + ObjC bridging header and source
  s.source_files   = "ios/RayNeoModule.swift", "ios/ABI/ProbeBridge.h", "ios/ABI/ProbeBridge.m"
  # ABI Swift files with @_silgen_name are excluded from compilation (they cause
  # linker errors since RayneoNet.framework has no .swiftmodule). They're kept
  # in the repo for reference and future swiftmodule emission.
  s.preserve_paths = "ios/ABI/**/*"

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
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks'
  }

  s.dependency     'ExpoModulesCore'
end
