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

  # Main module source (Expo module Swift + ObjC bridging header/source)
  s.source_files   = "ios/*.{h,m,swift}", "ios/ABI/ProbeBridge.h", "ios/ABI/ProbeBridge.m"
  # All other ABI Swift files contain @_silgen_name declarations that cause
  # linker errors — RayneoNet.framework has no .swiftmodule so Swift-mangled
  # symbols can't resolve at link time. RayNeoModule.swift uses plain
  # CoreBluetooth instead. RayneoNet.swift is used only for swiftmodule emission.
  s.exclude_files  = "ios/ABI/*.swift"

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
    'SWIFT_INCLUDE_PATHS' => '$(inherited) $(PODS_ROOT)/RayNeo/ios/ABI/build',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks',
    'SWIFT_OBJC_BRIDGING_HEADER' => '$(PODS_ROOT)/RayNeo/ios/ABI/ProbeBridge.h'
  }

  s.dependency     'ExpoModulesCore'
end
