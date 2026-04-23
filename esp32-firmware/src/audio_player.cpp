#include "audio_player.h"
#include "config.h"
#include "globals.h"
#include "led_controller.h"
#include "oled_display.h"
#include <Audio.h>    // ESP32-audioI2S library

static Audio audio;
static bool  playing = false;

// Callback from ESP32-audioI2S when track ends
void audio_eof_mp3(const char* info) {
  Serial.printf("[PLAYER] Playback finished: %s\n", info);
  playing = false;
  currentState = STATE_IDLE;
  ledSetState(STATE_IDLE);
  oledShow("ROGER AI", deviceId.c_str(), "READY", "Hold PTT to speak");
}

void audioPlayerInit() {
  audio.setPinout(I2S_SPK_BCLK, I2S_SPK_LRC, I2S_SPK_DOUT);
  audio.setVolume(18);   // 0–21
  Serial.println("[PLAYER] I2S speaker initialized");
}

void audioPlayerPlay(const String& url) {
  Serial.printf("[PLAYER] Playing URL: %s\n", url.c_str());
  playing = true;
  audio.connecttohost(url.c_str());
}

void audioPlayerStop() {
  if (playing) {
    audio.stopSong();
    playing = false;
  }
}

void audioPlayerLoop() {
  if (playing) audio.loop();
}

bool audioPlayerBusy() { return playing; }
