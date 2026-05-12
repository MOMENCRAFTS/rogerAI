#include "audio_player.h"
#include "config.h"
#include "globals.h"
#include "tft_display.h"
#include "AudioKitHAL.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ── AudioKit HAL instance (shared with audio_recorder) ────────────────
extern AudioKit audioKit;

// ── Playback state ────────────────────────────────────────────────────
static bool     playing     = false;
static uint8_t* audioBuf    = nullptr;
static size_t   audioSize   = 0;
static size_t   audioPos    = 0;
static bool     isWavFormat = false;

// ── Minimp3 single-header decoder ─────────────────────────────────────
// We use a minimal approach: download full MP3, decode frame-by-frame
// to PCM, and write PCM to AudioKit.
//
// libhelix via arduino-libhelix:
#define HELIX_PRINT
#include "MP3DecoderHelix.h"

static libhelix::MP3DecoderHelix* mp3Decoder = nullptr;
static bool decoderDone = false;

// Callback: receives decoded PCM from libhelix
static void mp3DataCallback(MP3FrameInfo &info, short *pcm_buffer, size_t len, void* ref) {
  if (len > 0 && playing) {
    // Write decoded PCM to AudioKit (ES8388)
    audioKit.write((uint8_t*)pcm_buffer, len * sizeof(int16_t));
  }
}

void audioPlayerInit() {
  // Enable speaker amplifier
  pinMode(AMP_ENABLE_PIN, OUTPUT);
  digitalWrite(AMP_ENABLE_PIN, HIGH);
  Serial.println("[PLAYER] Speaker amplifier enabled (GPIO 21)");
}

void audioPlayerPlay(const String& url) {
  Serial.printf("[PLAYER] Downloading: %s\n", url.c_str());
  playing = true;
  decoderDone = false;

  // Download audio into memory
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

  // Read audio data
  int contentLen = http.getSize();
  if (contentLen <= 0) contentLen = 128000;   // fallback max for TTS

  audioBuf = (uint8_t*)ps_malloc(contentLen);
  if (!audioBuf) audioBuf = (uint8_t*)malloc(contentLen);
  if (!audioBuf) {
    Serial.println("[PLAYER] OOM for audio buffer");
    http.end();
    playing = false;
    return;
  }

  WiFiClient* stream = http.getStreamPtr();
  audioSize = 0;
  while (http.connected() && audioSize < (size_t)contentLen) {
    size_t avail = stream->available();
    if (avail > 0) {
      size_t toRead = min(avail, (size_t)(contentLen - audioSize));
      stream->readBytes(audioBuf + audioSize, toRead);
      audioSize += toRead;
    }
  }
  http.end();
  audioPos = 0;

  Serial.printf("[PLAYER] Downloaded %u bytes\n", audioSize);

  // ── Detect format: WAV or MP3? ──────────────────────────────────
  isWavFormat = (audioSize > 44 &&
                 audioBuf[0] == 'R' && audioBuf[1] == 'I' &&
                 audioBuf[2] == 'F' && audioBuf[3] == 'F');

  // Configure AudioKit for output
  auto cfg = audioKit.defaultConfig(KitOutput);
  cfg.dac_output      = AUDIO_HAL_DAC_OUTPUT_ALL;   // speaker + headphone
  cfg.bits_per_sample = AUDIO_HAL_BIT_LENGTH_16BITS;
  cfg.sd_active       = false;

  if (isWavFormat) {
    // ── WAV: parse header, feed raw PCM ────────────────────────────
    uint32_t wavSampleRate = *(uint32_t*)(audioBuf + 24);
    if (wavSampleRate == 22050)      cfg.sample_rate = AUDIO_HAL_22K_SAMPLES;
    else if (wavSampleRate == 44100) cfg.sample_rate = AUDIO_HAL_44K_SAMPLES;
    else if (wavSampleRate == 24000) cfg.sample_rate = AUDIO_HAL_24K_SAMPLES;
    else                             cfg.sample_rate = AUDIO_HAL_16K_SAMPLES;

    audioPos = 44;  // skip WAV header
    Serial.printf("[PLAYER] WAV: %dHz — raw PCM playback\n", wavSampleRate);

    audioKit.begin(cfg);
    audioKit.setVolume(80);

  } else {
    // ── MP3: decode via libhelix ───────────────────────────────────
    // Default to 24kHz (OpenAI TTS default), decoder will auto-adjust
    cfg.sample_rate = AUDIO_HAL_24K_SAMPLES;
    audioKit.begin(cfg);
    audioKit.setVolume(80);

    // Init decoder
    if (mp3Decoder) { delete mp3Decoder; mp3Decoder = nullptr; }
    mp3Decoder = new libhelix::MP3DecoderHelix();
    mp3Decoder->setDataCallback(mp3DataCallback);
    mp3Decoder->begin();

    Serial.println("[PLAYER] MP3 decoder initialized — starting decode");
  }
}

void audioPlayerStop() {
  if (playing) {
    audioKit.end();
    playing = false;
    if (audioBuf)    { free(audioBuf); audioBuf = nullptr; }
    if (mp3Decoder)  { mp3Decoder->end(); delete mp3Decoder; mp3Decoder = nullptr; }
    audioSize   = 0;
    audioPos    = 0;
    decoderDone = false;
    Serial.println("[PLAYER] Playback stopped");
  }
}

void audioPlayerLoop() {
  if (!playing || !audioBuf) return;

  if (isWavFormat) {
    // ── WAV / raw PCM path ─────────────────────────────────────────
    size_t remaining = audioSize - audioPos;
    if (remaining == 0) {
      Serial.println("[PLAYER] WAV playback finished");
      audioPlayerStop();
      currentState = STATE_IDLE;
      tftSetState(STATE_IDLE);
      return;
    }
    size_t chunkSize = min(remaining, (size_t)512);
    size_t written = audioKit.write(audioBuf + audioPos, chunkSize);
    audioPos += written;

  } else if (mp3Decoder && !decoderDone) {
    // ── MP3 decode path — feed chunks to libhelix ──────────────────
    size_t remaining = audioSize - audioPos;
    if (remaining == 0) {
      // All data fed — flush decoder
      decoderDone = true;
      Serial.println("[PLAYER] MP3 data fully fed to decoder");
      // Give a small delay for last frame to process
      delay(50);
      Serial.println("[PLAYER] MP3 playback finished");
      audioPlayerStop();
      currentState = STATE_IDLE;
      tftSetState(STATE_IDLE);
      return;
    }

    // Feed MP3 data in chunks (decoder calls mp3DataCallback with PCM)
    size_t chunkSize = min(remaining, (size_t)1024);
    size_t consumed = mp3Decoder->write(audioBuf + audioPos, chunkSize);
    audioPos += consumed > 0 ? consumed : chunkSize;

  } else {
    // Decoder done or unknown state
    audioPlayerStop();
    currentState = STATE_IDLE;
    tftSetState(STATE_IDLE);
  }
}

bool audioPlayerBusy() { return playing; }
