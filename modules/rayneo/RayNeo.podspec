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

  # Main module source — Expo module Swift + ObjC dlsym bridge files.
  # RayneoBridge.h/.m and RayneoBridge.swift replace the @_silgen_name ABI files,
  # using dlsym to call RayneoNet.framework functions at runtime without a swiftmodule.
  # ProbeBridge.h/.m provide the framework image verification (UUID check via dladdr).
  s.source_files   = "ios/RayNeoModule.swift",
                     "ios/ABI/RayneoBridge.h", "ios/ABI/RayneoBridge.m",
                     "ios/ABI/RayneoBridge.swift",
                     "ios/ABI/ProbeBridge.h", "ios/ABI/ProbeBridge.m"
  # Old ABI Swift files with @_silgen_name are excluded from compilation (they
  # require a .swiftmodule that doesn't exist). Kept for reference only.
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
