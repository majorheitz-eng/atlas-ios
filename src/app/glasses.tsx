import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { resolveGateway } from '@/lib/bridge/gateway-resolver';
import {
  rayNeoStatusColor,
  rayNeoStatusLabel,
  useRayNeo,
  type RayNeoDevice,
  type RayNeoScanStatus,
} from '@/lib/rayneo/connection';
import { palette } from '@/theme/palette';

/**
 * Atlas → RayNeo live connection screen
 * --------------------------------------
 * Replaces the static setup card with a live BLE console: shows scan status,
 * discovered devices, a connect/disconnect button, and a live activity log.
 * All motion is useState + setInterval (no Animated API) per the EAS build
 * constraint. The BLE lifecycle itself is owned by `useRayNeo`.
 */

type LogEntry = {
  id: string;
  text: string;
  at: string;
};

const SETUP_HINTS: { title: string; body: string }[] = [
  {
    title: 'PAIR OVER BLUETOOTH',
    body: 'RayNeo iO glasses pair to your iPhone via Bluetooth — no Wi-Fi needed. The glasses are a display-only HUD: no camera, no speakers, no internet of their own.',
  },
  {
    title: 'OPEN ATLAS ON THE GLASSES',
    body: 'Once paired, the glasses run the same Atlas brain as your phone over the Bluetooth tether — shared memory, shared conversation history.',
  },
];

export default function GlassesScreen() {
  const [gateway, setGateway] = useState<{ url: string; source: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<LogEntry[]>([]);

  const rayneo = useRayNeo();

  // Keep the activity log in a ref so the logging helper always sees the
  // latest entries without re-creating callbacks on every render.
  const pushLog = useCallback((text: string) => {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    logRef.current = [entry, ...logRef.current].slice(0, 30);
    setLog(logRef.current);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      resolveGateway()
        .then((r) => {
          if (active) setGateway({ url: r.config.baseUrl, source: r.source });
        })
        .catch(() => {
          if (active) setGateway(null);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  // Log status transitions so the user can see what the BLE layer is doing.
  const prevStatusRef = useRef<RayNeoScanStatus>(rayneo.status);
  useEffect(() => {
    if (prevStatusRef.current === rayneo.status) return;
    const from = rayNeoStatusLabel[prevStatusRef.current];
    const to = rayNeoStatusLabel[rayneo.status];
    pushLog(`${from} → ${to}`);
    prevStatusRef.current = rayneo.status;
  }, [rayneo.status, pushLog]);

  // Listen for native module errors and log them so the user can see what's failing
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../lib/rayneo/connection');
    try {
      const rayneoMod = require('../../../modules/rayneo/src/RayNeoModule');
      if (rayneoMod && typeof rayneoMod.onError === 'function') {
        const unsub = rayneoMod.onError((event: { kind: string; message: string }) => {
          pushLog(`SDK ${event.kind}: ${event.message}`);
        });
        return unsub;
      }
    } catch { /* module not available */ }
  }, [pushLog]);

  const handleScan = useCallback(async () => {
    if (rayneo.status === 'scanning') {
      pushLog('stopping scan');
      await rayneo.stopScan();
      return;
    }
    pushLog('starting scan');
    await rayneo.scan();
  }, [rayneo, pushLog]);

  const handleConnect = useCallback(
    async (device: RayNeoDevice) => {
      pushLog(`connecting ${device.name}`);
      await rayneo.stopScan();
      await rayneo.connect(device.id);
    },
    [rayneo, pushLog],
  );

  const handleDisconnect = useCallback(async () => {
    pushLog('disconnecting');
    await rayneo.disconnect();
  }, [rayneo, pushLog]);

  const statusColor = rayNeoStatusColor[rayneo.status];
  const statusText = rayNeoStatusLabel[rayneo.status];
  const isBusy = rayneo.status === 'scanning' || rayneo.status === 'connecting';

  return (
    <LinearGradient colors={['#06131C', palette.canvas]} style={styles.fill}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>RAYNEO iO</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badge}>
          <Text style={styles.badgeText}>BLUETOOTH HUD</Text>
        </View>
        <Text style={styles.heading}>Glasses link</Text>
        <Text style={styles.copy}>
          Live BLE console for the RayNeo iO glasses. Atlas mirrors replies,
          lyrics, and speed to the HUD whenever a pair is connected.
        </Text>

        {/* Live status card */}
        <View style={[styles.statusCard, { borderColor: statusColor }]}>
          <View style={styles.statusHeader}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {statusText}
            </Text>
            {isBusy && <ActivityIndicator color={statusColor} size="small" />}
          </View>
          <Text style={styles.statusDetail}>
            {rayneo.unavailable
              ? 'Native RayNeo module not linked in this build — screens run normally without the glasses.'
              : rayneo.connected
                ? 'Glasses connected. Atlas will push content to the HUD.'
                : rayneo.status === 'scanning'
                  ? 'Searching for RayNeo glasses nearby…'
                  : rayneo.status === 'connecting'
                    ? 'Establishing BLE link…'
                    : 'No glasses linked. Scan to discover nearby RayNeo iO devices.'}
          </Text>
        </View>

        {/* Primary action button: scan or disconnect depending on state. */}
        {rayneo.connected ? (
          <Pressable onPress={() => void handleDisconnect()} style={styles.disconnectButton}>
            <Text style={styles.disconnectText}>DISCONNECT GLASSES</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void handleScan()}
            disabled={rayneo.unavailable || isBusy}
            style={[
              styles.scanButton,
              (rayneo.unavailable || isBusy) && styles.scanButtonDisabled,
              { borderColor: rayneo.status === 'scanning' ? palette.danger : palette.cyan },
            ]}
          >
            {rayneo.status === 'scanning' ? (
              <Text style={styles.scanText}>STOP SCAN</Text>
            ) : (
              <Text style={styles.scanText}>SCAN FOR GLASSES</Text>
            )}
          </Pressable>
        )}

        {/* HUD settings — visible only while connected. Lets the user adjust
            brightness, display height, display distance, and view battery.
            Stock green monochrome look is preserved; these only adjust HUD
            size/position/brightness, not color. */}
        {rayneo.connected && (
          <View style={styles.settingsWrap}>
            <Text style={styles.settingsTitle}>HUD SETTINGS</Text>

            {/* Brightness: Low (7) or High (8) */}
            <Text style={styles.settingsLabel}>BRIGHTNESS</Text>
            <View style={styles.settingsRow}>
              {([
                { label: 'LOW', value: 7 },
                { label: 'HIGH', value: 8 },
              ] as const).map((opt) => {
                const selected = rayneo.brightness === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => void rayneo.setBrightness(opt.value)}
                    style={[
                      styles.settingsChip,
                      selected && styles.settingsChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.settingsChipText,
                        selected && styles.settingsChipTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Display height: Low (1), Med (3), High (5) */}
            <Text style={styles.settingsLabel}>DISPLAY HEIGHT</Text>
            <View style={styles.settingsRow}>
              {([
                { label: 'LOW', value: 1 },
                { label: 'MED', value: 3 },
                { label: 'HIGH', value: 5 },
              ] as const).map((opt) => {
                const selected = rayneo.displayHeight === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() =>
                      void rayneo.setDisplay(
                        opt.value,
                        rayneo.displayDistance ?? 1,
                      )
                    }
                    style={[
                      styles.settingsChip,
                      selected && styles.settingsChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.settingsChipText,
                        selected && styles.settingsChipTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Display distance: Near (1) or Far (2) */}
            <Text style={styles.settingsLabel}>DISPLAY DISTANCE</Text>
            <View style={styles.settingsRow}>
              {([
                { label: 'NEAR', value: 1 },
                { label: 'FAR', value: 2 },
              ] as const).map((opt) => {
                const selected = rayneo.displayDistance === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() =>
                      void rayneo.setDisplay(
                        rayneo.displayHeight ?? 1,
                        opt.value,
                      )
                    }
                    style={[
                      styles.settingsChip,
                      selected && styles.settingsChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.settingsChipText,
                        selected && styles.settingsChipTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Battery + refresh row */}
            <View style={styles.settingsFooter}>
              <Text style={styles.settingsBattery}>
                {rayneo.battery != null ? `BATTERY ${rayneo.battery}%` : 'BATTERY —'}
              </Text>
              <Pressable
                onPress={() => void rayneo.refreshSettings()}
                style={styles.refreshButton}
              >
                <Text style={styles.refreshText}>↻ REFRESH</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Discovered devices list while scanning / idle. */}
        {rayneo.devices.length > 0 && !rayneo.connected && (
          <View style={styles.devicesWrap}>
            <Text style={styles.devicesTitle}>DISCOVERED DEVICES</Text>
            {rayneo.devices.map((device) => (
              <Pressable
                key={device.id}
                onPress={() => void handleConnect(device)}
                style={styles.deviceRow}
                disabled={isBusy}
              >
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName} numberOfLines={1}>
                    {device.name}
                  </Text>
                  {device.rssi != null && (
                    <Text style={styles.deviceRssi}>RSSI {device.rssi} dBm</Text>
                  )}
                </View>
                <Text style={styles.connectGlyph}>＋</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Activity log */}
        {log.length > 0 && (
          <View style={styles.logWrap}>
            <Text style={styles.logTitle}>ACTIVITY</Text>
            {log.map((entry) => (
              <View key={entry.id} style={styles.logRow}>
                <Text style={styles.logTime}>{entry.at}</Text>
                <Text style={styles.logText} numberOfLines={2}>
                  {entry.text}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Gateway box kept from the static screen — still useful context. */}
        <View style={styles.gatewayBox}>
          <Text style={styles.gatewayLabel}>GATEWAY IN USE</Text>
          <Text style={styles.gatewayUrl} numberOfLines={1}>
            {gateway ? gateway.url : 'not connected'}
          </Text>
          <Text style={styles.gatewaySrc}>
            {gateway ? `via ${gateway.source}` : 'connect Atlas first'}
          </Text>
        </View>

        {/* Setup hints (compressed from the old multi-step list). */}
        <Text style={styles.sectionTitle}>SETUP</Text>
        {SETUP_HINTS.map((step, i) => (
          <View key={i} style={styles.stepCard}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepBody}>{step.body}</Text>
          </View>
        ))}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingTop: 62, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: palette.cyan, fontSize: 38, fontWeight: '200', lineHeight: 38 },
  title: { color: palette.cyanSoft, letterSpacing: 3, fontSize: 12, fontWeight: '800' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 25, paddingTop: 20, paddingBottom: 50 },
  badge: { alignSelf: 'flex-start', borderColor: 'rgba(85,241,202,0.35)', borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, marginBottom: 16 },
  badgeText: { color: palette.success, fontSize: 9, letterSpacing: 1.5, fontWeight: '800' },
  heading: { color: palette.text, fontSize: 30, fontWeight: '300', letterSpacing: -0.5 },
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 22 },
  statusCard: {
    borderWidth: 2,
    borderRadius: 16,
    backgroundColor: 'rgba(8,33,43,0.58)',
    padding: 16,
    marginBottom: 16,
  },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  statusDot: { width: 9, height: 9, borderRadius: 4.5 },
  statusText: { fontSize: 13, letterSpacing: 1.5, fontWeight: '900', flex: 1 },
  statusDetail: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  scanButton: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 14,
    marginBottom: 18,
  },
  scanButtonDisabled: { opacity: 0.4 },
  scanText: { color: palette.text, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  disconnectButton: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.danger,
    borderRadius: 14,
    marginBottom: 18,
    backgroundColor: 'rgba(79,18,29,0.36)',
  },
  disconnectText: { color: palette.danger, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  settingsWrap: {
    backgroundColor: 'rgba(8,33,43,0.58)',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
  },
  settingsTitle: { color: palette.cyan, fontSize: 10, letterSpacing: 1.8, fontWeight: '900', marginBottom: 14 },
  settingsLabel: { color: palette.muted, fontSize: 10, letterSpacing: 1.3, fontWeight: '800', marginBottom: 8, marginTop: 8 },
  settingsRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  settingsChip: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    backgroundColor: 'rgba(3,8,13,0.5)',
  },
  settingsChipSelected: {
    borderColor: palette.cyan,
    backgroundColor: 'rgba(35,230,255,0.12)',
  },
  settingsChipText: { color: palette.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  settingsChipTextSelected: { color: palette.cyan },
  settingsFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: palette.line },
  settingsBattery: { color: palette.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  refreshButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.cyan,
    borderRadius: 8,
    backgroundColor: 'rgba(35,230,255,0.08)',
  },
  refreshText: { color: palette.cyan, fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  devicesWrap: { marginBottom: 18 },
  devicesTitle: { color: palette.cyan, fontSize: 10, letterSpacing: 1.8, fontWeight: '900', marginBottom: 10 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(8,33,43,0.58)',
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  deviceInfo: { flex: 1 },
  deviceName: { color: palette.text, fontSize: 14, fontWeight: '600' },
  deviceRssi: { color: palette.muted, fontSize: 11, marginTop: 3 },
  connectGlyph: { color: palette.cyan, fontSize: 22, fontWeight: '700' },
  logWrap: {
    backgroundColor: 'rgba(3,8,13,0.7)',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: 12,
    marginBottom: 22,
  },
  logTitle: { color: palette.cyan, fontSize: 9, letterSpacing: 1.6, fontWeight: '900', marginBottom: 8 },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 5 },
  logTime: { color: '#5E7D88', fontSize: 10, fontFamily: 'monospace', minWidth: 56 },
  logText: { color: '#B9CCD3', fontSize: 11, flex: 1, lineHeight: 15 },
  gatewayBox: { padding: 14, backgroundColor: 'rgba(8,33,43,0.58)', borderColor: palette.line, borderWidth: 1, borderRadius: 12, marginBottom: 24 },
  gatewayLabel: { color: palette.cyan, fontSize: 9, letterSpacing: 1.4, fontWeight: '900', marginBottom: 5 },
  gatewayUrl: { color: palette.text, fontSize: 13, fontWeight: '600' },
  gatewaySrc: { color: palette.muted, fontSize: 10, marginTop: 4 },
  sectionTitle: { color: palette.cyan, fontSize: 10, letterSpacing: 1.8, fontWeight: '900', marginBottom: 12 },
  stepCard: { borderLeftWidth: 2, borderLeftColor: palette.cyan, backgroundColor: 'rgba(8,33,43,0.58)', padding: 14, marginBottom: 12, borderRadius: 10 },
  stepTitle: { color: palette.cyan, fontSize: 10, letterSpacing: 1.5, fontWeight: '900', marginBottom: 6 },
  stepBody: { color: '#B9CCD3', fontSize: 12.5, lineHeight: 19 },
});
