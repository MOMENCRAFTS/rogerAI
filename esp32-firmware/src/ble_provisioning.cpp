// ble_provisioning.cpp — Production BLE WiFi provisioning
// Uses Arduino-ESP32's WiFiProv wrapper around ESP-IDF's wifi_prov_mgr.
// Security1 (X25519 + PoP) — encrypted channel, per-device secret.
//
// Flow:
//   1. Check NVS for saved WiFi creds → if valid, connect directly
//   2. If not provisioned → start BLE advertising "ROGER_XXXX"
//   3. Phone app connects, verifies PoP, sends WiFi creds over encrypted BLE
//   4. Device connects to WiFi, confirms, BLE stack shuts down (frees ~110KB)

#include "ble_provisioning.h"
#include "config.h"
#include "globals.h"
#include "tft_display.h"
#include <WiFi.h>
#include <WiFiProv.h>
#include <Preferences.h>
#include <mbedtls/md.h>

// ── State ─────────────────────────────────────────────────────────────
static bool     provActive    = false;
static bool     wifiConnected = false;
static unsigned long provStartMs = 0;
static char     popStr[9]     = "";       // 8-char PoP + null
static char     serviceName[20] = "";     // "ROGER_XXXX"
static bool     provSuccess   = false;

// ── Generate per-device PoP from MAC via HMAC-SHA256 ──────────────────
static void generatePoP() {
  uint8_t mac[6];
  WiFi.macAddress(mac);

  // HMAC-SHA256(master_secret, mac) → first 4 bytes → 8 hex chars
  uint8_t hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx,
    (const unsigned char*)POP_MASTER_SECRET, strlen(POP_MASTER_SECRET));
  mbedtls_md_hmac_update(&ctx, mac, 6);
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  // Convert first 4 bytes to uppercase hex → 8-char PoP
  const char hex[] = "0123456789ABCDEF";
  for (int i = 0; i < 4; i++) {
    popStr[i * 2]     = hex[(hmacResult[i] >> 4) & 0x0F];
    popStr[i * 2 + 1] = hex[hmacResult[i] & 0x0F];
  }
  popStr[8] = '\0';

  Serial.printf("[BLE] Per-device PoP: %s\n", popStr);
}

// ── Build service name from MAC suffix ────────────────────────────────
static void buildServiceName() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(serviceName, sizeof(serviceName), "%s_%02X%02X",
           PROV_SERVICE_PREFIX, mac[4], mac[5]);
  Serial.printf("[BLE] Service name: %s\n", serviceName);
}

// ── WiFi + Provisioning Event Handler ─────────────────────────────────
static void onProvEvent(arduino_event_t* event) {
  switch (event->event_id) {

    case ARDUINO_EVENT_PROV_START:
      Serial.println("[BLE] Provisioning started — waiting for app connection");
      break;

    case ARDUINO_EVENT_PROV_CRED_RECV: {
      Serial.println("[BLE] WiFi credentials received from app");
      // Credentials are handled internally by wifi_prov_mgr
      break;
    }

    case ARDUINO_EVENT_PROV_CRED_FAIL:
      Serial.println("[BLE] WiFi credentials failed — bad password or SSID?");
      // wifi_prov_mgr will retry or the app will re-send
      break;

    case ARDUINO_EVENT_PROV_CRED_SUCCESS:
      Serial.println("[BLE] Provisioning successful — WiFi credentials verified");
      provSuccess = true;
      break;

    case ARDUINO_EVENT_PROV_END:
      Serial.println("[BLE] Provisioning ended — BLE stack will be freed");
      provActive = false;
      break;

    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("[WIFI] Connected! IP: %s\n",
                    WiFi.localIP().toString().c_str());
      wifiConnected = true;

      // Save WiFi creds to NVS for direct reconnect on next boot
      if (provSuccess) {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putString(NVS_KEY_WIFI_SSID, WiFi.SSID());
        prefs.putString(NVS_KEY_WIFI_PASS, WiFi.psk());
        prefs.end();
        Serial.printf("[NVS] Saved WiFi creds: SSID=%s\n", WiFi.SSID().c_str());
      }
      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      Serial.println("[WIFI] Disconnected");
      wifiConnected = false;
      break;

    default:
      break;
  }
}

// ── Try connecting with saved credentials (fast boot path) ────────────
static bool tryStoredWiFi() {
  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, true);  // read-only
  String ssid = prefs.getString(NVS_KEY_WIFI_SSID, "");
  String pass = prefs.getString(NVS_KEY_WIFI_PASS, "");
  prefs.end();

  if (ssid.length() == 0) {
    Serial.println("[WIFI] No stored WiFi credentials");
    return false;
  }

  Serial.printf("[WIFI] Attempting stored WiFi: %s\n", ssid.c_str());
  tftShowText("Connecting", ssid.c_str(), "Please wait...", "");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  // Wait up to 10 seconds for connection
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(100);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] Fast-connected to %s (IP: %s)\n",
                  ssid.c_str(), WiFi.localIP().toString().c_str());
    wifiConnected = true;
    return true;
  }

  Serial.println("[WIFI] Stored WiFi failed — falling through to provisioning");
  WiFi.disconnect();
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════════

bool bleProvStart(bool forceReset) {
  generatePoP();
  buildServiceName();

  WiFi.onEvent(onProvEvent);

  // If not force-resetting, try stored creds first
  if (!forceReset && tryStoredWiFi()) {
    return true;   // Already connected — no provisioning needed
  }

  // ── Start BLE Provisioning ──────────────────────────────────────────
  Serial.println("[BLE] Starting BLE provisioning...");

  provActive   = true;
  provStartMs  = millis();
  provSuccess  = false;
  wifiConnected = false;

  // Set display to provisioning mode
  currentState = STATE_PROVISIONING;
  tftSetState(STATE_PROVISIONING);

  // Custom UUID for the GATT service
  uint8_t uuid[16] = PROV_SERVICE_UUID;

  WiFiProv.beginProvision(
    WIFI_PROV_SCHEME_BLE,
    WIFI_PROV_SCHEME_HANDLER_FREE_BLE,    // frees BLE stack after success
    WIFI_PROV_SECURITY_1,                 // X25519 + PoP
    popStr,
    serviceName,
    NULL,                                 // no service key
    uuid,
    forceReset || PROV_RESET_ON_BOOT
  );

  // Note: WiFiProv.printQR() removed — depends on esp_qrcode not linked in this SDK.
  // PoP is displayed on the TFT screen instead.

  Serial.printf("[BLE] Broadcasting as '%s' — PoP: %s\n", serviceName, popStr);
  Serial.println("[BLE] Waiting for app to connect and provision WiFi...");

  return false;   // Not connected yet — loop must be called
}

void bleProvLoop() {
  if (!provActive) return;

  // Check timeout
  if (millis() - provStartMs > PROV_TIMEOUT_MS) {
    Serial.println("[BLE] Provisioning timeout — restarting device...");
    provActive = false;
    delay(500);
    ESP.restart();  // Clean restart triggers fresh provisioning cycle
  }
}

bool bleProvIsConnected() {
  return wifiConnected && WiFi.status() == WL_CONNECTED;
}

const char* bleProvGetPoP() {
  return popStr;
}

const char* bleProvGetServiceName() {
  return serviceName;
}

void bleProvStop() {
  if (provActive) {
    provActive = false;
    // WiFiProv doesn't expose endProvision — BLE stack freed by HANDLER_FREE_BLE on success
    // For forced stop, a full restart is cleaner than partial teardown
  }
  Serial.println("[BLE] BLE provisioning stopped");
}
