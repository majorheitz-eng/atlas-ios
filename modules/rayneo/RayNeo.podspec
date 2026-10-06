Pod::Spec.new do |s|
  s.name           = 'RayNeo'
  s.version        = '1.0.0'
  s.summary        = 'RayNeo iO BLE transport for Atlas'
  s.description    = 'Native CoreBluetooth module for RayNeo iO glasses'
  s.license        = 'MIT'
  s.author         = 'Atlas'
  s.homepage       = 'https://github.com/majorheitz-eng/atlas-ios'
  s.source         = { path: '.' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source_files   = "ios/*.{h,m,swift}"
  s.frameworks     = 'ExternalAccessory'
  s.dependency     'ExpoModulesCore'
end
