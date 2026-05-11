#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "AudioKitHAL.h"
#include "config.h"
#include "globals.h"
#include "tft_display.h"
#include "ptt_handler.h"
#include "audio_recorder.h"
#include "audio_player.h"
#include "http_client.h"

// ── AudioKit HAL instance (shared by recorder + player) ───────────────
AudioKit audioKit;

// ── Global definitions ────────────────────────────────────────────────
DeviceState currentState = STATE_WIFI_SETUP;
String deviceId;
String userId;
String deviceToken;
bool   isPaired = false;
DisplayPayload displayData = {"", "", "", 0};

// ── Clock idle timeout (switch to clock face after 2 min idle) ────────
static unsigned long lastActivityMs = 0;
static const unsigned long CLOCK_IDLE_TIMEOUT = 120000;  // 2 minutes

// ── NVS persistent storage ───────────────────────────────────────────
static Preferences prefs;

static void loadPairingFromNVS() {
  prefs.begin(NVS_NAMESPACE, true);   // read-only
  isPaired    = prefs.getBool(NVS_KEY_PAIRED, false);
  userId      = prefs.getString(NVS_KEY_USER_ID, "");
  deviceToken = prefs.getString(NVS_KEY_TOKEN, "");
  prefs.end();

  if (isPaired && userId.length() > 0 && deviceToken.length() > 0) {
    Serial.printf("[NVS] Loaded pairing: user=%s token=%s...%s\n",
                  userId.c_str(),
                  deviceToken.substring(0, 8).c_str(),
                  deviceToken.substring(deviceToken.length() - 4).c_str());
  } else {
    Serial.println("[NVS] No pairing data found — device needs pairing");
    isPaired = false;
  }
}

// ── Build device ID from MAC address ─────────────────────────────────
static void buildDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[32];
  snprintf(buf, sizeof(buf), "device_%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  deviceId = String(buf);
  Serial.printf("[BOOT] Device ID: %s\n", deviceId.c_str());
}

// ── WiFiManager setup with captive portal ─────────────────────────────
static void setupWiFi() {
  currentState = STATE_WIFI_SETUP;
  tftSetState(STATE_WIFI_SETUP);

  WiFiManager wm;
  wm.setConfigPortalTimeout(300);          // 5 min portal timeout
  wm.setConnectTimeout(20);

  bool connected = wm.autoConnect(WIFI_AP_NAME, WIFI_AP_PASSWORD);

  if (!connected) {
    Serial.println("[WIFI] Failed to connect — entering offline mode");
    currentState = STATE_OFFLINE;
    tftSetState(STATE_OFFLINE);
    return;
  }

  Serial.printf("[WIFI] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── Generate 6-char pairing code ──────────────────────────────────────
static String generatePairingCode() {
  const char charset[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I/O/0/1
  char code[7];
  for (int i = 0; i < 6; i++) {
    code[i] = charset[random(0, sizeof(charset) - 1)];
  }
  code[6] = '\0';
  return String(code);
}

// ── Enter pairing mode ───────────────────────────────────────────────
static String activePairingCode = "";
static unsigned long lastPollMs  = 0;
static const unsigned long PAIR_POLL_INTERVAL = 3000;   // poll every 3s

static void enterPairingMode() {
  currentState = STATE_PAIRING;
  activePairingCode = generatePairingCode();

  Serial.printf("[PAIR] Pairing code: %s\n", activePairingCode.c_str());
  Serial.printf("[PAIR] QR content: roger://pair?device_id=%s&code=%s\n",
                deviceId.c_str(), activePairingCode.c_str());

  tftShowPairing(activePairingCode.c_str());
  lastPollMs = 0;   // force immediate first poll
  Serial.println("[PAIR] Waiting for app to scan QR code...");
}

// ── Poll server for pairing confirmation ─────────────────────────────
static void savePairingToNVS(const String& token, const String& uid) {
  prefs.begin(NVS_NAMESPACE, false);   // read-write
  prefs.putBool(NVS_KEY_PAIRED, true);
  prefs.putString(NVS_KEY_USER_ID, uid);
  prefs.putString(NVS_KEY_TOKEN, token);
  prefs.end();
  Serial.printf("[NVS] Saved pairing: user=%s token=%s...%s\n",
                uid.c_str(),
                token.substring(0, 8).c_str(),
                token.substring(token.length() - 4).c_str());
}

static void pollPairingStatus() {
  if (currentState != STATE_PAIRING) return;
  unsigned long now = millis();
  if (now - lastPollMs < PAIR_POLL_INTERVAL) return;
  lastPollMs = now;

  // Build poll URL: GET /pair-device?device_id=X&pairing_code=Y
  String url = String(PAIR_DEVICE_URL) +
               "?device_id=" + deviceId +
               "&pairing_code=" + activePairingCode;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, url);
  http.addHeader("Authorization", "Bearer " SUPABASE_ANON_KEY);
  http.setTimeout(8000);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("[PAIR] Poll HTTP %d — retrying...\n", code);
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  // Parse JSON response
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("[PAIR] JSON parse error: %s\n", err.c_str());
    return;
  }

  bool paired = doc["paired"] | false;
  if (!paired) {
    // Not yet — keep polling (dot animation on serial)
    Serial.print(".");
    return;
  }

  // ── PAIRED! ────────────────────────────────────────────────────────
  const char* token = doc["device_token"] | "";
  const char* uid   = doc["user_id"]      | "";

  if (strlen(token) == 0 || strlen(uid) == 0) {
    Serial.println("[PAIR] Paired but missing token/user_id — retrying...");
    return;
  }

  Serial.printf("\n[PAIR] ✓ Paired successfully!\n");
  Serial.printf("[PAIR] User: %s\n", uid);
  Serial.printf("[PAIR] Token: %s...%s\n",
                String(token).substring(0, 8).c_str(),
                String(token).substring(strlen(token) - 4).c_str());

  // Save to globals
  deviceToken = String(token);
  userId      = String(uid);
  isPaired    = true;

  // Persist to NVS flash
  savePairingToNVS(deviceToken, userId);

  // Show success on display
  tftShowText("PAIRED!", "Connected to", "your account", "");
  delay(2000);

  // Register with server
  httpRegisterDevice(deviceId, userId);

  // Transition to ready state
  currentState = STATE_IDLE;
  tftSetState(STATE_IDLE);
  Serial.println("[BOOT] Device ready — hold KEY1 to talk to Roger");
}

// ══════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ROGER AI DEVICE v" FIRMWARE_VERSION " ===");
  Serial.println("=== ESP32-A1S Audio Kit + GC9A01 Display ===\n");

  // ── Step 1: Display (first, for visual boot feedback) ──────────────
  tftInit();

  // ── Step 2: Speaker amplifier ──────────────────────────────────────
  audioPlayerInit();

  // ── Step 3: PTT button ─────────────────────────────────────────────
  pttInit();

  // ── Step 4: Audio recorder (buffer allocation) ─────────────────────
  audioRecorderInit();

  // ── Step 5: Load pairing data from NVS ─────────────────────────────
  loadPairingFromNVS();

  // ── Step 6: Device ID from MAC ─────────────────────────────────────
  buildDeviceId();

  // ── Step 7: WiFi + portal ──────────────────────────────────────────
  setupWiFi();

  if (currentState == STATE_OFFLINE) return;   // no WiFi — stop here

  // ── Step 8: Check pairing status ───────────────────────────────────
  if (!isPaired) {
    enterPairingMode();
    return;   // loop() will handle polling
  }

  // ── Step 9: Self-register with server ──────────────────────────────
  httpRegisterDevice(deviceId, userId);

  // ── Ready ──────────────────────────────────────────────────────────
  currentState = STATE_IDLE;
  tftSetState(STATE_IDLE);
  Serial.println("[BOOT] Device ready — hold KEY1 to talk to Roger");
}

// ── Backend display state polling ─────────────────────────────────────
static unsigned long lastDisplayPollMs = 0;
static const unsigned long DISPLAY_POLL_INTERVAL = 3000;

static void pollDisplayState() {
  if (!isPaired || currentState == STATE_RECORDING ||
      currentState == STATE_UPLOADING || currentState == STATE_WAITING) return;

  unsigned long now = millis();
  if (now - lastDisplayPollMs < DISPLAY_POLL_INTERVAL) return;
  lastDisplayPollMs = now;

  // Piggyback on the device-relay heartbeat (GET with device token)
  String url = String(SUPABASE_URL) + "/functions/v1/device-relay/heartbeat"
               "?device_id=" + deviceId;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, url);
  http.addHeader("Authorization", "Bearer " SUPABASE_ANON_KEY);
  if (deviceToken.length() > 0) http.addHeader("X-Device-Token", deviceToken);
  http.setTimeout(5000);

  int code = http.GET();
  if (code != 200) { http.end(); return; }

  String body = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  // Check for revoked status
  if (doc["revoked"] | false) {
    currentState = STATE_LOCKED;
    tftSetState(STATE_LOCKED);
    isPaired = false;
    return;
  }

  const char* dState = doc["display_state"] | "";
  if (strlen(dState) == 0) return;

  // Map backend display_state string to enum
  DisplayPayload dp = {"", "", "", 0};
  strncpy(dp.line1, doc["display_line1"] | "", 31);
  strncpy(dp.line2, doc["display_line2"] | "", 31);
  strncpy(dp.line3, doc["display_line3"] | "", 31);
  dp.value = doc["display_value"] | 0;

  if (strcmp(dState, "prayer") == 0)        { tftSetStateWithData(STATE_PRAYER, dp); currentState = STATE_PRAYER; }
  else if (strcmp(dState, "reminder") == 0)  { tftSetStateWithData(STATE_REMINDER, dp); currentState = STATE_REMINDER; }
  else if (strcmp(dState, "briefing") == 0)  { tftSetStateWithData(STATE_BRIEFING, dp); currentState = STATE_BRIEFING; }
  else if (strcmp(dState, "relay") == 0)     { tftSetStateWithData(STATE_RELAY, dp); currentState = STATE_RELAY; }
  else if (strcmp(dState, "idle") == 0)      { currentState = STATE_IDLE; tftSetState(STATE_IDLE); }
}

void loop() {
  pollPairingStatus();     // non-blocking — returns immediately if not pairing
  pttLoop();               // PTT state machine
  tftLoop();               // display animations (30fps)
  audioPlayerLoop();       // non-blocking audio playback
  pollDisplayState();      // backend-pushed LCD states

  // Auto-switch to clock face after idle timeout
  if (currentState == STATE_IDLE) {
    if (millis() - lastActivityMs > CLOCK_IDLE_TIMEOUT) {
      currentState = STATE_CLOCK;
      tftSetState(STATE_CLOCK);
      // NTP time sync (once)
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    }
  }

  // Reset activity timer on any state change away from clock
  if (currentState != STATE_IDLE && currentState != STATE_CLOCK) {
    lastActivityMs = millis();
  }
}
