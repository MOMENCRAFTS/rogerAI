#include "ptt_handler.h"
#include "config.h"
#include "globals.h"
#include "audio_recorder.h"
#include "audio_player.h"
#include "http_client.h"
#include "tft_display.h"

// ── PTT State Machine ─────────────────────────────────────────────────
//   IDLE → RECORDING → UPLOADING → WAITING → PLAYING → IDLE

static bool     buttonDown       = false;
static bool     lastButtonState  = HIGH;
static unsigned long pressStart  = 0;
static unsigned long debounceTs  = 0;
static unsigned long errorTs     = 0;       // non-blocking error timeout
static bool     errorRecovery    = false;
static unsigned long briefTs     = 0;       // non-blocking "too brief" timeout
static bool     briefRecovery   = false;

void pttInit() {
  // GPIO 36 is input-only — no internal pullup available
  // The Audio Kit has an external 10K pullup on KEY1
  pinMode(PTT_BUTTON_PIN, INPUT);
  Serial.println("[PTT] KEY1 (GPIO 36) initialized");
}

// Called when user presses PTT
static void onPTTDown() {
  if (currentState != STATE_IDLE) return;   // ignore if busy

  // Stop any ongoing playback
  audioPlayerStop();

  pressStart = millis();
  currentState = STATE_RECORDING;
  tftSetState(STATE_RECORDING);

  audioRecorderStart();
  Serial.println("[PTT] Recording started");
}

// Called when user releases PTT
static void onPTTUp() {
  unsigned long holdMs = millis() - pressStart;

  audioRecorderStop();

  if (holdMs < PTT_MIN_HOLD_MS) {
    // Too brief — show message, recover after 1.5s (non-blocking)
    Serial.println("[PTT] Too brief — ignored");
    currentState = STATE_IDLE;
    tftShowText("TOO BRIEF", "Hold longer", "Try again", "");
    briefTs = millis();
    briefRecovery = true;
    return;
  }

  Serial.printf("[PTT] Recording stopped — held %lums\n", holdMs);

  // Get audio buffer
  size_t audioSize = 0;
  uint8_t* audioBuf = audioRecorderGetBuffer(&audioSize);

  if (audioSize == 0) {
    Serial.println("[PTT] Empty audio buffer — aborting");
    currentState = STATE_IDLE;
    tftSetState(STATE_IDLE);
    return;
  }

  // Upload to server
  currentState = STATE_UPLOADING;
  tftSetState(STATE_UPLOADING);

  DeviceRelayResponse resp = httpPostAudio(audioBuf, audioSize, deviceId, userId);

  if (!resp.success) {
    Serial.printf("[PTT] Upload failed: %s\n", resp.error.c_str());
    currentState = STATE_ERROR;
    tftSetState(STATE_ERROR);
    tftShowText("ERROR", resp.error.c_str(), "Try again", "");
    errorTs = millis();
    errorRecovery = true;
    return;
  }

  Serial.printf("[PTT] Transcript: %s\n", resp.transcript.c_str());
  Serial.printf("[PTT] Roger says: %s\n", resp.rogerResponse.c_str());

  // Show transcript on display
  tftShowTranscript(resp.transcript.c_str(), resp.rogerResponse.c_str());

  // Play TTS response
  if (resp.ttsUrl.length() > 0) {
    currentState = STATE_PLAYING;
    tftSetState(STATE_PLAYING);
    audioPlayerPlay(resp.ttsUrl);
    // audioPlayerLoop() in main loop handles completion
  } else {
    currentState = STATE_IDLE;
    tftSetState(STATE_IDLE);
  }
}

void pttLoop() {
  if (currentState == STATE_OFFLINE ||
      currentState == STATE_WIFI_SETUP ||
      currentState == STATE_PAIRING) return;

  unsigned long now = millis();

  // Non-blocking error recovery (replaces delay(3000))
  if (errorRecovery && (now - errorTs > 3000)) {
    errorRecovery = false;
    currentState = STATE_IDLE;
    tftSetState(STATE_IDLE);
    return;
  }

  // Non-blocking "too brief" recovery (replaces delay(1500))
  if (briefRecovery && (now - briefTs > 1500)) {
    briefRecovery = false;
    currentState = STATE_IDLE;
    tftSetState(STATE_IDLE);
    return;
  }

  // Don't process button during recovery
  if (errorRecovery || briefRecovery) return;

  bool reading = digitalRead(PTT_BUTTON_PIN);

  // Debounce
  if (reading != lastButtonState) debounceTs = now;
  lastButtonState = reading;

  if ((now - debounceTs) < PTT_DEBOUNCE_MS) return;

  bool pressed = (reading == LOW);   // active-low (external pullup)

  if (pressed && !buttonDown) {
    buttonDown = true;
    onPTTDown();
  } else if (!pressed && buttonDown) {
    buttonDown = false;
    onPTTUp();
  }
}
