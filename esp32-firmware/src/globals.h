#pragma once
#include <Arduino.h>
#include "config.h"

// ── Device States (mirrors the app PTT state machine + LCD modes) ────
enum DeviceState {
  // ── Core PTT states ─────────────────────────────────────────────────
  STATE_IDLE,             // 0  breathing amber ring, "ROGER AI" logo
  STATE_RECORDING,        // 1  red pulsing, REC timer
  STATE_UPLOADING,        // 2  blue spinner, "SENDING"
  STATE_WAITING,          // 3  purple spinner, "THINKING"
  STATE_PLAYING,          // 4  green waveform, "ROGER SAYS"
  STATE_ERROR,            // 5  red X, "ERROR"
  STATE_OFFLINE,          // 6  grey, "NO WIFI"
  STATE_WIFI_SETUP,       // 7  cyan portal instructions
  STATE_PAIRING,          // 8  QR code for app scan (legacy fallback)
  STATE_PROVISIONING,     // 9  spinning ring + "Open Roger App" (BLE prov)
  // ── Extended LCD states (pushed from backend) ───────────────────────
  STATE_CLOCK,            // 10 analog/digital clock face (idle timeout)
  STATE_LISTENING,        // 10 ambient listen mode (Roger TTS playing)
  STATE_PRAYER,           // 11 green crescent, prayer name + countdown
  STATE_REMINDER,         // 12 amber bell, reminder text
  STATE_LOCKED,           // 13 red lock, "DEVICE REVOKED"
  STATE_RELAY,            // 14 cyan satellite, C2C relay active
  STATE_BRIEFING,         // 15 purple radar sweep, morning brief
  STATE_PROACTIVE,        // 16 amber glow, Roger wants to say something
};

// ── Display payload (optional data from backend poll) ─────────────────
struct DisplayPayload {
  char line1[64];         // primary text (e.g. prayer name, thought message)
  char line2[32];         // secondary text (e.g. time, detail)
  char line3[32];         // tertiary text
  int  value;             // numeric (e.g. minutes until prayer)
};

// ── Global state ──────────────────────────────────────────────────────
extern DeviceState currentState;
extern String deviceId;           // MAC-based e.g. "device_a4cf127b3ef1"
extern String userId;             // linked Roger AI user (from NVS)
extern String deviceToken;        // persistent auth token (from NVS)
extern bool   isPaired;           // true after successful QR pairing
extern DisplayPayload displayData;  // payload for extended LCD states
