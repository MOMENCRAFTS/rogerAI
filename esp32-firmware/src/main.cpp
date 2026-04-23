#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <FastLED.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "globals.h"
#include "led_controller.h"
#include "oled_display.h"
#include "ptt_handler.h"
#include "audio_recorder.h"
#include "audio_player.h"
#include "http_client.h"

// ── Global definitions ────────────────────────────────────────────────
DeviceState currentState = STATE_WIFI_SETUP;
CRGB leds[LED_COUNT];
String deviceId;
String userId = DEFAULT_USER_ID;

// ── Build device ID from MAC address ─────────────────────────────────
void buildDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[32];
  snprintf(buf, sizeof(buf), "device_%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  deviceId = String(buf);
  Serial.printf("[BOOT] Device ID: %s\n", deviceId.c_str());
}

// ── WiFiManager setup with captive portal ─────────────────────────────
void setupWiFi() {
  ledSetState(STATE_WIFI_SETUP);
  oledShow("ROGER DEVICE", "Connect to:", WIFI_AP_NAME, "to configure WiFi");

  WiFiManager wm;
  wm.setConfigPortalTimeout(300);          // 5 min portal timeout
  wm.setConnectTimeout(20);

  // Custom parameter: user_id binding
  WiFiManagerParameter param_user("userid", "Roger User ID", DEFAULT_USER_ID, 64);
  wm.addParameter(&param_user);

  bool connected = wm.autoConnect(WIFI_AP_NAME, WIFI_AP_PASSWORD);

  if (!connected) {
    Serial.println("[WIFI] Failed to connect — entering offline mode");
    currentState = STATE_OFFLINE;
    ledSetState(STATE_OFFLINE);
    oledShow("ROGER DEVICE", "OFFLINE", "No WiFi", "PTT disabled");
    return;
  }

  userId = String(param_user.getValue());
  if (userId.length() == 0) userId = DEFAULT_USER_ID;

  Serial.printf("[WIFI] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("[WIFI] User ID: %s\n", userId.c_str());

  currentState = STATE_IDLE;
  ledSetState(STATE_IDLE);
  oledShow("ROGER AI", deviceId.c_str(), "READY", "Hold PTT to speak");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ROGER AI DEVICE BOOT ===");

  // LED ring
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, LED_COUNT);
  FastLED.setBrightness(LED_BRIGHTNESS);
  FastLED.clear();
  FastLED.show();

  // OLED
  Wire.begin(OLED_SDA, OLED_SCL);
  oledInit();

  // PTT button
  pttInit();

  // Audio
  audioRecorderInit();
  audioPlayerInit();

  // Device ID from MAC
  buildDeviceId();

  // WiFi + portal
  setupWiFi();

  // Self-register with server (fire-and-forget)
  if (currentState != STATE_OFFLINE) {
    httpRegisterDevice(deviceId, userId);
  }
}

void loop() {
  pttLoop();          // PTT state machine
  ledLoop();          // LED animations
  audioPlayerLoop();  // non-blocking MP3 playback
}
