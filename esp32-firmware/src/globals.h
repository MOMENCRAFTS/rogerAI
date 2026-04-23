#pragma once
#include <Arduino.h>
#include <FastLED.h>
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
  STATE_WIFI_SETUP
};

// ── Global state ──────────────────────────────────────────────────────
extern DeviceState currentState;
extern CRGB leds[LED_COUNT];
extern String deviceId;       // MAC-based e.g. "device_a4cf127b3ef1"
extern String userId;         // linked Roger AI user
