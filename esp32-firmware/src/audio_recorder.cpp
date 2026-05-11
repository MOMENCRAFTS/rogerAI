#include "audio_recorder.h"
#include "config.h"
#include "AudioKitHAL.h"

// ── AudioKit HAL instance (shared with audio_player) ──────────────────
extern AudioKit audioKit;

// ── WAV header builder (reused from original firmware) ────────────────
static void writeWavHeader(uint8_t* buf, uint32_t dataSize) {
  uint32_t sampleRate    = AUDIO_SAMPLE_RATE;
  uint16_t bitsPerSample = AUDIO_BITS;
  uint16_t channels      = AUDIO_CHANNELS;
  uint32_t byteRate      = sampleRate * channels * bitsPerSample / 8;
  uint16_t blockAlign    = channels * bitsPerSample / 8;
  uint32_t chunkSize     = dataSize + 36;

  memcpy(buf,      "RIFF", 4);
  memcpy(buf + 4,  &chunkSize,     4);
  memcpy(buf + 8,  "WAVE", 4);
  memcpy(buf + 12, "fmt ", 4);
  uint32_t fmtSize = 16; memcpy(buf + 16, &fmtSize, 4);
  uint16_t audioFormat = 1; memcpy(buf + 20, &audioFormat, 2);
  memcpy(buf + 22, &channels,      2);
  memcpy(buf + 24, &sampleRate,    4);
  memcpy(buf + 28, &byteRate,      4);
  memcpy(buf + 32, &blockAlign,    2);
  memcpy(buf + 34, &bitsPerSample, 2);
  memcpy(buf + 36, "data", 4);
  memcpy(buf + 40, &dataSize,      4);
}

// ── Audio buffer (44-byte WAV header + PCM data) ──────────────────────
static uint8_t* audioBuf = nullptr;
static size_t   pcmWritten = 0;
static volatile bool recording = false;

void audioRecorderInit() {
  // Allocate audio buffer in PSRAM if available, else heap
  audioBuf = (uint8_t*)ps_malloc(44 + AUDIO_BUFFER_SIZE);
  if (!audioBuf) {
    audioBuf = (uint8_t*)malloc(44 + AUDIO_BUFFER_SIZE);
  }
  if (!audioBuf) {
    Serial.println("[MIC] FATAL: Cannot allocate audio buffer!");
    return;
  }
  Serial.printf("[MIC] Audio buffer allocated: %u bytes\n", 44 + AUDIO_BUFFER_SIZE);
}

void audioRecorderStart() {
  pcmWritten = 0;
  recording  = true;
  memset(audioBuf, 0, 44);   // clear WAV header area

  // Configure AudioKit for input (mic recording)
  auto cfg = audioKit.defaultConfig(KitInput);
  cfg.adc_input       = AUDIO_HAL_ADC_INPUT_LINE2;   // onboard MEMS mic
  cfg.sample_rate     = AUDIO_HAL_16K_SAMPLES;
  cfg.bits_per_sample = AUDIO_HAL_BIT_LENGTH_16BITS;
  cfg.sd_active       = false;   // we don't use SD card
  audioKit.begin(cfg);

  Serial.println("[MIC] Recording started (ES8388 ADC)");

  // Record in a background task to avoid blocking main loop
  xTaskCreate([](void*) {
    while (recording) {
      uint8_t tmp[512];
      size_t bytesRead = audioKit.read(tmp, sizeof(tmp));
      if (bytesRead > 0) {
        size_t space  = AUDIO_BUFFER_SIZE - pcmWritten;
        size_t toCopy = min(bytesRead, space);
        if (toCopy > 0) {
          memcpy(audioBuf + 44 + pcmWritten, tmp, toCopy);
          pcmWritten += toCopy;
        }
        if (pcmWritten >= AUDIO_BUFFER_SIZE) {
          recording = false;   // buffer full — auto stop
          break;
        }
      }
    }
    vTaskDelete(NULL);
  }, "mic_task", 4096, NULL, 1, NULL);
}

void audioRecorderStop() {
  recording = false;
  vTaskDelay(pdMS_TO_TICKS(80));   // let task flush final samples
  audioKit.end();

  // Write real WAV header now we know data size
  writeWavHeader(audioBuf, (uint32_t)pcmWritten);
  Serial.printf("[MIC] Recorded %u PCM bytes → WAV total %u bytes\n",
                pcmWritten, pcmWritten + 44);
}

uint8_t* audioRecorderGetBuffer(size_t* outSize) {
  *outSize = (pcmWritten > 0) ? (pcmWritten + 44) : 0;
  return audioBuf;
}
