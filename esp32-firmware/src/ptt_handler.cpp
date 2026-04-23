#include "ptt_handler.h"
#include "config.h"
#include "globals.h"
#include "audio_recorder.h"
#include "audio_player.h"
#include "http_client.h"
#include "led_controller.h"
#include "oled_display.h"

// ── PTT State Machine ─────────────────────────────────────────────────
//   IDLE → RECORDING → UPLOADING → WAITING → PLAYING → IDLE

static bool     buttonDown       = false;
static bool     lastButtonState  = HIGH;
static unsigned long pressStart  = 0;
static unsigned long debounceTs  = 0;

void pttInit() {
  pinMode(PTT_BUTTON_PIN, INPUT_PULLUP);
  Serial.println("[PTT] Initialized");
}

// Called when user presses PTT
static void onPTTDown() {
  if (currentState != STATE_IDLE) return;   // ignore if busy

  // Stop any ongoing playback
  audioPlayerStop();

  pressStart = millis();
  currentState = STATE_RECORDING;
  ledSetState(STATE_RECORDING);
  oledShow("ROGER AI", "● RECORDING", "Speak now...", "Release to send");

  audioRecorderStart();
  Serial.println("[PTT] Recording started");
}

// Called when user releases PTT
static void onPTTUp() {
  unsigned long holdMs = millis() - pressStart;

  audioRecorderStop();

  if (holdMs < PTT_MIN_HOLD_MS) {
    // Too brief — ignore
    Serial.println("[PTT] Too brief — ignored");
    currentState = STATE_IDLE;
    ledSetState(STATE_IDLE);
    oledShow("ROGER AI", "TOO BRIEF", "Hold longer", "Try again");
    delay(1500);
    oledShow("ROGER AI", deviceId.c_str(), "READY", "Hold PTT to speak");
    return;
  }

  Serial.printf("[PTT] Recording stopped — held %lums\n", holdMs);

  // Get audio buffer
  size_t audioSize = 0;
  uint8_t* audioBuf = audioRecorderGetBuffer(&audioSize);

  if (audioSize == 0) {
    Serial.println("[PTT] Empty audio buffer — aborting");
    currentState = STATE_IDLE;
    ledSetState(STATE_IDLE);
    return;
  }

  // Upload to server
  currentState = STATE_UPLOADING;
  ledSetState(STATE_UPLOADING);
  oledShow("ROGER AI", "UPLOADING", "Sending to Roger...", "");

  DeviceRelayResponse resp = httpPostAudio(audioBuf, audioSize, deviceId, userId);

  if (!resp.success) {
    Serial.printf("[PTT] Upload failed: %s\n", resp.error.c_str());
    currentState = STATE_ERROR;
    ledSetState(STATE_ERROR);
    oledShow("ROGER AI", "ERROR", resp.error.c_str(), "Try again");
    delay(3000);
    currentState = STATE_IDLE;
    ledSetState(STATE_IDLE);
    oledShow("ROGER AI", deviceId.c_str(), "READY", "Hold PTT to speak");
    return;
  }

  Serial.printf("[PTT] Transcript: %s\n", resp.transcript.c_str());
  Serial.printf("[PTT] Roger says: %s\n", resp.rogerResponse.c_str());

  // Show transcript on OLED
  oledShow("YOU SAID:", resp.transcript.substring(0, 20).c_str(),
           "ROGER:", resp.rogerResponse.substring(0, 20).c_str());

  // Play TTS response
  if (resp.ttsUrl.length() > 0) {
    currentState = STATE_PLAYING;
    ledSetState(STATE_PLAYING);
    audioPlayerPlay(resp.ttsUrl);
    // audioPlayerLoop() in main loop handles completion
  } else {
    currentState = STATE_IDLE;
    ledSetState(STATE_IDLE);
    oledShow("ROGER AI", deviceId.c_str(), "READY", "Hold PTT to speak");
  }
}

void pttLoop() {
  if (currentState == STATE_OFFLINE || currentState == STATE_WIFI_SETUP) return;

  unsigned long now = millis();
  bool reading = digitalRead(PTT_BUTTON_PIN);

  // Debounce
  if (reading != lastButtonState) debounceTs = now;
  lastButtonState = reading;

  if ((now - debounceTs) < PTT_DEBOUNCE_MS) return;

  bool pressed = (reading == LOW);   // active-low (INPUT_PULLUP)

  if (pressed && !buttonDown) {
    buttonDown = true;
    onPTTDown();
  } else if (!pressed && buttonDown) {
    buttonDown = false;
    onPTTUp();
  }
}
