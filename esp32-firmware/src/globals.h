#pragma once
#include <Arduino.h>
#include "config.h"

// ── Device States (mirrors the app PTT state machine) ────────────────
enum DeviceState {
  STATE_IDLE,
  STATE_RECORDING,
  STATE_UPLOADING,
  STATE_WAITING,
  STATE_PLAYING,
  STATE_ERROR,
  STATE_OFFLINE,
  STATE_WIFI_SETUP,
  STATE_PAIRING           // QR code displayed, waiting for app scan
};

// ── Global state ──────────────────────────────────────────────────────
extern DeviceState currentState;
extern String deviceId;           // MAC-based e.g. "device_a4cf127b3ef1"
extern String userId;             // linked Roger AI user (from NVS)
extern String deviceToken;        // persistent auth token (from NVS)
extern bool   isPaired;           // true after successful QR pairing
