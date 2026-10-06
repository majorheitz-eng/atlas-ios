// ============================================================================
// ATLAS GATEWAY CONFIG — the single file you edit to change where Atlas calls
// home. This one config drives iPhone, RayNeo iO glasses (Android) and any
// future ESP32 puck that speaks the same gateway protocol.
//
// Fallback order used by the app at connect time:
//   1. Saved gateway URL + token from device Keychain (set in Settings)
//   2. fallbackUrls below, tried top to bottom — first one that answers wins
//   3. Any URL the user types in Settings (Test & Save promotes it to tier 1)
//
// The winning URL is shown on the main screen banner so you always know which
// transport actually connected.
// ============================================================================

export const ATLAS_GATEWAY_CONFIG = {
  // Same token everywhere (iPhone app, glasses, puck).
  token: 'atlas-iphone-2026',

  // Tried top to bottom when nothing is saved in the Keychain.
  fallbackUrls: [
    // Permanent portable tunnel (ngrok static domain) — works on any network.
    'https://petroleum-multiply-backtalk.ngrok-free.dev',
    // localhost.run free tunnel — free but flaky, kept as secondary.
    'https://86b0cc90b95d10.lhr.life',
    // Home LAN relay (atlas-voice-puck/lan_relay.js on the desktop, 0.0.0.0:9121)
    // — fastest path when phone/glasses are on the home WiFi.
    'http://192.168.4.22:9121',
  ],

  // Per-candidate connect timeout for the fallback walk (ms).
  connectTimeoutMs: 8000,
} as const;


// ============================================================================
// RAYNEO iO GLASSES — paired device info, baked in for zero-setup auto-connect.
// The glasses are a closed BLE device using MFi (ExternalAccessory) + a
// proprietary GATT profile.  They must already be bonded through the official
// RayNeo app; this config lets the native BLE module connect directly without
// re-pairing.
// ============================================================================
export const ATLAS_GLASSES = {
  // From Device Info screen in the RayNeo app.
  deviceName: 'RayNeo iO-A594',
  strixOS: 'Strix OS 1.0.4.12',
  model: 'RayNeo iO',
  deviceNumber: 'ARGF30-2B4FEU11',
  serialNumber: '006A5E5F15EA594',
  macAddress: '00:6A:5E:5F:15:EA',
  // GATT profile (from the open-source Turbo-IO transport layer).
  serviceUUID: '0000B81D-0000-1000-8000-00805F9B34FB',
  outboundUUID: 'EA8B70D5-2BD3-49AB-9C31-9C38B2C3C4F9', // phone → glasses (write)
  inboundUUID: '7DB3E235-3608-41F3-A03C-955FCBD2EA4B', // glasses → phone (notify)
  // MFi accessory protocol string for EASession.
  accessoryProtocol: 'com.rayneo.venus.pub',
} as const;

export const ATLAS_VOICE = {
  // ElevenLabs "Major Atlas" voice clone — embedded so every device speaks
  // with the same voice with zero setup. Override via Settings → Voice if
  // you ever want a different voice on a specific device.
  apiKey: 'sk_27bf6fed6ae796a0c3ca2be6f499aa61038f14bf6c303a13',
  voiceId: '059VWGgvQfSfNZNaRx16',
  modelId: 'eleven_turbo_v2_5',
} as const;

export default ATLAS_GATEWAY_CONFIG;
