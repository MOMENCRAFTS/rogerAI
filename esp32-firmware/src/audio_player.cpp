#include "audio_player.h"
#include "config.h"
#include "globals.h"
#include "tft_display.h"
#include "AudioKitHAL.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ── AudioKit HAL instance (shared with audio_recorder) ────────────────
extern AudioKit audioKit;

static bool     playing     = false;
static uint8_t* mp3Buf      = nullptr;
static size_t   mp3Size     = 0;
static size_t   mp3Pos      = 0;

void audioPlayerInit() {
  // Enable speaker amplifier
  pinMode(AMP_ENABLE_PIN, OUTPUT);
  digitalWrite(AMP_ENABLE_PIN, HIGH);
  Serial.println("[PLAYER] Speaker amplifier enabled (GPIO 21)");
}

void audioPlayerPlay(const String& url) {
  Serial.printf("[PLAYER] Downloading: %s\n", url.c_str());
  playing = true;

  // Download MP3 into memory
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, url);
  http.setTimeout(15000);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("[PLAYER] Download failed: %d\n", code);
    http.end();
    playing = false;
    return;
  }

  // Read MP3 data
  int contentLen = http.getSize();
  if (contentLen <= 0) contentLen = 64000;   // fallback max

  mp3Buf = (uint8_t*)ps_malloc(contentLen);
  if (!mp3Buf) mp3Buf = (uint8_t*)malloc(contentLen);
  if (!mp3Buf) {
    Serial.println("[PLAYER] OOM for MP3 buffer");
    http.end();
    playing = false;
    return;
  }

  WiFiClient* stream = http.getStreamPtr();
  mp3Size = 0;
  while (http.connected() && mp3Size < (size_t)contentLen) {
    size_t avail = stream->available();
    if (avail > 0) {
      size_t toRead = min(avail, (size_t)(contentLen - mp3Size));
      stream->readBytes(mp3Buf + mp3Size, toRead);
      mp3Size += toRead;
    }
  }
  http.end();
  mp3Pos = 0;

  Serial.printf("[PLAYER] Downloaded %u bytes, starting playback\n", mp3Size);

  // Switch AudioKit to output mode for playback
  auto cfg = audioKit.defaultConfig(KitOutput);
  cfg.dac_output      = AUDIO_HAL_DAC_OUTPUT_ALL;   // speaker + headphone
  cfg.sample_rate     = AUDIO_HAL_16K_SAMPLES;
  cfg.bits_per_sample = AUDIO_HAL_BIT_LENGTH_16BITS;
  cfg.sd_active       = false;   // we don't use SD card
  audioKit.begin(cfg);
  audioKit.setVolume(80);   // 0-100
}

void audioPlayerStop() {
  if (playing) {
    audioKit.end();
    playing = false;
    if (mp3Buf) { free(mp3Buf); mp3Buf = nullptr; }
    mp3Size = 0;
    mp3Pos  = 0;
    Serial.println("[PLAYER] Playback stopped");
  }
}

void audioPlayerLoop() {
  if (!playing || !mp3Buf) return;

  // Feed audio data to codec in chunks
  size_t remaining = mp3Size - mp3Pos;
  if (remaining == 0) {
    // Playback finished
    Serial.println("[PLAYER] Playback finished");
    audioPlayerStop();
    currentState = STATE_IDLE;
    tftSetState(STATE_IDLE);
    return;
  }

  size_t chunkSize = min(remaining, (size_t)512);
  size_t written = audioKit.write(mp3Buf + mp3Pos, chunkSize);
  mp3Pos += written;
}

bool audioPlayerBusy() { return playing; }
