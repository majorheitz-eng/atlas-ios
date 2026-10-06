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

  # Main module source (the Expo module + BLE fallback)
  s.source_files   = "ios/*.{h,m,swift}"

  # ABI bridge sources (use @_silgen_name to call into RayneoNet.framework)
  s.subspec 'ABI' do |abi|
    abi.source_files = "ios/ABI/*.{swift,h,m}"
  end

  # Embed all 7 binary frameworks from Turbo-IO
  s.vendored_frameworks =
    'ios/Frameworks/RayneoNet.framework',
    'ios/Frameworks/CocoaAsyncSocket.framework',
    'ios/Frameworks/OpenSSL.framework',
    'ios/Frameworks/RayneoLog.framework',
    'ios/Frameworks/SwiftProtobuf.framework',
    'ios/Frameworks/CocoaLumberjack.framework',
    'ios/Frameworks/SSZipArchive.framework'

  s.frameworks     = 'CoreBluetooth', 'ExternalAccessory'

  # Add the declaration-only swiftmodule path so `import RayneoNet` resolves
  s.pod_target_xcconfig = {
    'SWIFT_INCLUDE_PATHS' => '"$(inherited) $(PODS_ROOT)/RayNeo/ios/ABI/build"',
    'LD_RUNPATH_SEARCH_PATHS' => '"$(inherited) @executable_path/Frameworks',
    'SWIFT_OBJC_BRIDGING_HEADER' => '"$(PODS_ROOT)/RayNeo/ios/ABI/ProbeBridge.h"'
  }

  s.dependency     'ExpoModulesCore'
end
