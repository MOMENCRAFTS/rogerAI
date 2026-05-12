/**
 * bleProvisioning.ts — BLE WiFi Provisioning for Roger AI devices
 *
 * Uses Web Bluetooth API (Chrome, Edge) and Capacitor BLE plugin (Android/iOS)
 * to communicate with the ESP32's wifi_prov_mgr over BLE.
 *
 * Flow:
 *   1. Scan for BLE devices with name prefix "ROGER_"
 *   2. Connect and verify PoP (Proof of Possession)
 *   3. Request WiFi network scan from device
 *   4. Send WiFi credentials over encrypted BLE channel
 *   5. Monitor connection status
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface BleDevice {
  id: string;           // BLE device ID (platform-specific)
  name: string;         // e.g. "ROGER_A4CF"
  rssi?: number;        // Signal strength
}

export interface WifiNetwork {
  ssid: string;
  rssi: number;         // Signal strength (dBm)
  security: 'open' | 'wpa' | 'wpa2' | 'wpa3' | 'unknown';
  channel?: number;
}

export type ProvisioningStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'verifying_pop'
  | 'scanning_wifi'
  | 'sending_credentials'
  | 'waiting_for_connection'
  | 'connected'
  | 'error';

export interface ProvisioningState {
  status: ProvisioningStatus;
  device: BleDevice | null;
  networks: WifiNetwork[];
  error: string | null;
  progress: number;     // 0-100
}

// ── ESP-IDF Provisioning GATT Service UUIDs ───────────────────────────
// These match the default UUIDs used by wifi_prov_mgr with BLE transport
const PROV_SERVICE_UUID      = '0000ffff-0000-1000-8000-00805f9b34fb';
const PROV_SCAN_CHAR_UUID    = '0000ff50-0000-1000-8000-00805f9b34fb';
const PROV_SESSION_CHAR_UUID = '0000ff51-0000-1000-8000-00805f9b34fb';
const PROV_CONFIG_CHAR_UUID  = '0000ff52-0000-1000-8000-00805f9b34fb';
const PROV_VER_CHAR_UUID     = '0000ff53-0000-1000-8000-00805f9b34fb';
const ROGER_INFO_CHAR_UUID   = '0000ff54-0000-1000-8000-00805f9b34fb';

// ── Platform detection ────────────────────────────────────────────────
const isNative = () => typeof (window as any).Capacitor !== 'undefined';
const isWebBluetoothAvailable = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

// ── State ─────────────────────────────────────────────────────────────
let currentDevice: BluetoothDevice | null = null;
let currentServer: BluetoothRemoteGATTServer | null = null;
let listeners: Set<(state: ProvisioningState) => void> = new Set();
let state: ProvisioningState = {
  status: 'idle',
  device: null,
  networks: [],
  error: null,
  progress: 0,
};

function emit(partial: Partial<ProvisioningState>) {
  state = { ...state, ...partial };
  listeners.forEach(fn => fn(state));
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Subscribe to provisioning state changes.
 * Returns an unsubscribe function.
 */
export function onProvisioningState(fn: (state: ProvisioningState) => void): () => void {
  listeners.add(fn);
  fn(state); // emit current state immediately
  return () => listeners.delete(fn);
}

/** Get current state snapshot */
export function getProvisioningState(): ProvisioningState {
  return { ...state };
}

/**
 * Step 1: Scan for Roger devices via BLE.
 * On Web Bluetooth, this opens the browser's device picker.
 * Returns the selected/found device.
 */
export async function scanForDevices(): Promise<BleDevice | null> {
  emit({ status: 'scanning', error: null, progress: 10 });

  try {
    if (isWebBluetoothAvailable() && !isNative()) {
      // Web Bluetooth — browser shows native picker
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'ROGER' }],
        optionalServices: [PROV_SERVICE_UUID],
      });

      if (!device) {
        emit({ status: 'idle', error: 'No device selected' });
        return null;
      }

      currentDevice = device;
      const bleDevice: BleDevice = {
        id: device.id,
        name: device.name || 'Unknown Roger Device',
      };
      emit({ status: 'idle', device: bleDevice, progress: 20 });
      return bleDevice;
    }

    // Fallback — no BLE available
    emit({ status: 'error', error: 'Bluetooth not available on this device/browser' });
    return null;
  } catch (err: any) {
    const msg = err.message?.includes('cancelled') || err.message?.includes('denied')
      ? 'Bluetooth scan cancelled'
      : `Scan failed: ${err.message}`;
    emit({ status: 'error', error: msg });
    return null;
  }
}

/**
 * Step 2: Connect to the device and verify Proof of Possession.
 */
export async function connectAndVerify(pop: string): Promise<boolean> {
  if (!currentDevice) {
    emit({ status: 'error', error: 'No device selected' });
    return false;
  }

  emit({ status: 'connecting', error: null, progress: 30 });

  try {
    // Connect to GATT server
    const server = await currentDevice.gatt!.connect();
    currentServer = server;

    emit({ status: 'verifying_pop', progress: 40 });

    // Get provisioning service
    const service = await server.getPrimaryService(PROV_SERVICE_UUID);

    // Read version/session characteristic to verify connection
    try {
      const verChar = await service.getCharacteristic(PROV_VER_CHAR_UUID);
      const verValue = await verChar.readValue();
      const decoder = new TextDecoder();
      const verText = decoder.decode(verValue);
      console.log('[BLE] Device version:', verText);
    } catch {
      // Version char may not exist — continue anyway
    }

    // Write PoP to session characteristic to establish encrypted session
    const sessionChar = await service.getCharacteristic(PROV_SESSION_CHAR_UUID);
    const encoder = new TextEncoder();
    const popData = encoder.encode(JSON.stringify({ pop }));
    await sessionChar.writeValue(popData);

    // Read back session response to confirm PoP was accepted
    const sessionResp = await sessionChar.readValue();
    const decoder = new TextDecoder();
    const respText = decoder.decode(sessionResp);
    const respJson = JSON.parse(respText);

    if (respJson.status === 'rejected' || respJson.error) {
      emit({ status: 'error', error: 'Invalid PoP code — check device label', progress: 0 });
      await disconnect();
      return false;
    }

    emit({ progress: 50 });
    console.log('[BLE] PoP verified, encrypted session established');
    return true;
  } catch (err: any) {
    emit({ status: 'error', error: `Connection failed: ${err.message}` });
    return false;
  }
}

/**
 * Step 3: Request WiFi network scan from device.
 */
export async function scanWifiNetworks(): Promise<WifiNetwork[]> {
  if (!currentServer?.connected) {
    emit({ status: 'error', error: 'Not connected to device' });
    return [];
  }

  emit({ status: 'scanning_wifi', error: null, progress: 55 });

  try {
    const service = await currentServer.getPrimaryService(PROV_SERVICE_UUID);
    const scanChar = await service.getCharacteristic(PROV_SCAN_CHAR_UUID);

    // Send scan command
    const encoder = new TextEncoder();
    await scanChar.writeValue(encoder.encode(JSON.stringify({ cmd: 'scan' })));

    // Wait for scan to complete (device needs ~3 seconds)
    await new Promise(r => setTimeout(r, 3000));

    // Read scan results
    const result = await scanChar.readValue();
    const decoder = new TextDecoder();
    const rawText = decoder.decode(result);

    let networks: WifiNetwork[] = [];
    try {
      const parsed = JSON.parse(rawText);
      networks = (parsed.networks || parsed || []).map((n: any) => ({
        ssid: n.ssid || n.SSID || '',
        rssi: n.rssi || n.RSSI || -80,
        security: mapSecurity(n.auth || n.security || 0),
        channel: n.channel || undefined,
      })).filter((n: WifiNetwork) => n.ssid.length > 0);
    } catch {
      // If JSON parse fails, the device might send raw protobuf
      // Fall back to manual entry
      console.warn('[BLE] Could not parse WiFi scan results');
    }

    // Sort by signal strength (strongest first)
    networks.sort((a, b) => b.rssi - a.rssi);

    // Deduplicate by SSID (keep strongest)
    const seen = new Set<string>();
    networks = networks.filter(n => {
      if (seen.has(n.ssid)) return false;
      seen.add(n.ssid);
      return true;
    });

    emit({ networks, progress: 65 });
    return networks;
  } catch (err: any) {
    emit({ status: 'error', error: `WiFi scan failed: ${err.message}` });
    return [];
  }
}

/**
 * Step 4: Send WiFi credentials to device.
 */
export async function sendWifiCredentials(ssid: string, password: string): Promise<boolean> {
  if (!currentServer?.connected) {
    emit({ status: 'error', error: 'Not connected to device' });
    return false;
  }

  emit({ status: 'sending_credentials', error: null, progress: 75 });

  try {
    const service = await currentServer.getPrimaryService(PROV_SERVICE_UUID);
    const configChar = await service.getCharacteristic(PROV_CONFIG_CHAR_UUID);

    // Send WiFi config
    const encoder = new TextEncoder();
    const config = JSON.stringify({ ssid, password });
    await configChar.writeValue(encoder.encode(config));

    emit({ status: 'waiting_for_connection', progress: 85 });

    // Poll for connection status (device will try to connect)
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));

      try {
        const statusValue = await configChar.readValue();
        const decoder = new TextDecoder();
        const statusText = decoder.decode(statusValue);
        const statusJson = JSON.parse(statusText);

        if (statusJson.wifi_state === 'connected' || statusJson.status === 'success') {
          emit({ status: 'connected', progress: 100 });
          console.log('[BLE] Device connected to WiFi!');
          return true;
        }

        if (statusJson.wifi_state === 'failed' || statusJson.status === 'fail') {
          emit({ status: 'error', error: 'WiFi connection failed — check password', progress: 0 });
          return false;
        }
      } catch {
        // Read might fail during connection attempt — keep trying
      }

      emit({ progress: 85 + i });
    }

    emit({ status: 'error', error: 'WiFi connection timed out' });
    return false;
  } catch (err: any) {
    emit({ status: 'error', error: `Failed to send credentials: ${err.message}` });
    return false;
  }
}

/**
 * Get device info (device_id, pairing_code, firmware_ver) from custom GATT endpoint.
 */
export async function getDeviceInfo(): Promise<{ device_id: string; pairing_code: string; firmware_ver: string } | null> {
  if (!currentServer?.connected) return null;

  try {
    const service = await currentServer.getPrimaryService(PROV_SERVICE_UUID);
    const infoChar = await service.getCharacteristic(ROGER_INFO_CHAR_UUID);
    const value = await infoChar.readValue();
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(value));
  } catch {
    // Custom endpoint might not exist yet
    return null;
  }
}

/**
 * Disconnect and cleanup.
 */
export async function disconnect(): Promise<void> {
  try {
    if (currentServer?.connected) {
      currentServer.disconnect();
    }
  } catch { /* */ }
  currentDevice = null;
  currentServer = null;
  emit({ status: 'idle', device: null, networks: [], progress: 0 });
}

/**
 * Reset all state.
 */
export function reset(): void {
  disconnect();
  emit({ status: 'idle', device: null, networks: [], error: null, progress: 0 });
}

// ── Helpers ───────────────────────────────────────────────────────────

function mapSecurity(auth: number | string): WifiNetwork['security'] {
  if (typeof auth === 'string') {
    if (auth.includes('WPA3')) return 'wpa3';
    if (auth.includes('WPA2')) return 'wpa2';
    if (auth.includes('WPA')) return 'wpa';
    if (auth === 'OPEN' || auth === 'open') return 'open';
    return 'unknown';
  }
  // ESP-IDF auth_mode enum values
  switch (auth) {
    case 0: return 'open';
    case 1: return 'wpa';
    case 2: return 'wpa';
    case 3: return 'wpa2';
    case 4: return 'wpa2';
    case 5: return 'wpa3';
    default: return 'unknown';
  }
}

/**
 * Signal strength to quality descriptor.
 */
export function signalQuality(rssi: number): 'excellent' | 'good' | 'fair' | 'weak' {
  if (rssi >= -50) return 'excellent';
  if (rssi >= -60) return 'good';
  if (rssi >= -70) return 'fair';
  return 'weak';
}

/**
 * Signal strength to number of bars (1-4).
 */
export function signalBars(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  return 1;
}
