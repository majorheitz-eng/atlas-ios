require 'json'

package = JSON.parse(File.read(File.join(File.dirname(__FILE__), 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'rayneo-glasses'
  s.version        = package['version']
  s.summary        = 'RayNeo iO glasses BLE module for Atlas'
  s.description    = 'Native BLE module for RayNeo iO glasses with MFi authentication via RayneoNet.framework'
  s.author         = 'Major Heitz'
  s.homepage       = 'https://kendrickhome.com'
  s.license        = 'MIT'
  s.platform       = :ios, '15.0'
  s.source         = { path: '.' }

  s.source_files   = 'ios/src/**/*.{swift,h,m}'
  s.vendored_frameworks = 'ios/RayneoNet.framework'
  s.frameworks     = 'CoreBluetooth', 'ExternalAccessory'
  s.pod_target_xcconfig = {
    'OTHER_LDFLAGS' => '-framework RayneoNet',
    'FRAMEWORK_SEARCH_PATHS' => '"$(inherited)" "$(PODS_ROOT)/rayneo-glasses/ios"'
  }
  s.dependency     'ExpoModulesCore'
end
