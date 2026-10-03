// Atlas Gateway Configuration
// Generated: 2026-10-02

export const GATEWAY_CONFIG = {
  // Your Hermes backend is exposed via Cloudflare Tunnel
  url: "https://lyrics-mechanisms-careers-parliamentary.trycloudflare.com",
  
  // Temporary token - replace with actual token from Hermes
  // Run: hermes gateway token create --name "Atlas iPhone"
  token: "temp_atlas_token",
  
  // Connection settings
  wsUrl: "wss://lyrics-mechanisms-careers-parliamentary.trycloudflare.com/api/ws",
  
  // Auto-reconnect settings
  reconnectInterval: 3000,
  maxReconnectAttempts: 5,
};

export default GATEWAY_CONFIG;
