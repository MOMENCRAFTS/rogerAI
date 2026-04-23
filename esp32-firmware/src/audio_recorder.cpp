#include "audio_recorder.h"
#include "config.h"
#include <driver/i2s.h>

// ── WAV header builder ────────────────────────────────────────────────
static void writeWavHeader(uint8_t* buf, uint32_t dataSize) {
  uint32_t sampleRate  = I2S_SAMPLE_RATE;
  uint16_t bitsPerSample = I2S_SAMPLE_BITS;
  uint16_t channels    = I2S_CHANNELS;
  uint32_t byteRate    = sampleRate * channels * bitsPerSample / 8;
  uint16_t blockAlign  = channels * bitsPerSample / 8;
  uint32_t chunkSize   = dataSize + 36;

  memcpy(buf,      "RIFF", 4);
  memcpy(buf + 4,  &chunkSize,   4);
  memcpy(buf + 8,  "WAVE", 4);
  memcpy(buf + 12, "fmt ", 4);
  uint32_t fmtSize = 16; memcpy(buf + 16, &fmtSize, 4);
  uint16_t audioFormat = 1; memcpy(buf + 20, &audioFormat, 2);
  memcpy(buf + 22, &channels,    2);
  memcpy(buf + 24, &sampleRate,  4);
  memcpy(buf + 28, &byteRate,    4);
  memcpy(buf + 32, &blockAlign,  2);
  memcpy(buf + 34, &bitsPerSample, 2);
  memcpy(buf + 36, "data", 4);
  memcpy(buf + 40, &dataSize,    4);
}

// ── Static buffer (44 byte WAV header + PCM data) ─────────────────────
static uint8_t  audioBuf[44 + AUDIO_BUFFER_SIZE];
static size_t   pcmWritten = 0;
static bool     recording  = false;

void audioRecorderInit() {
  i2s_config_t cfg = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate          = I2S_SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = 8,
    .dma_buf_len          = 64,
    .use_apll             = false,
    .tx_desc_auto_clear   = false,
    .fixed_mclk           = 0
  };
  i2s_pin_config_t pins = {
    .bck_io_num   = I2S_MIC_SCK,
    .ws_io_num    = I2S_MIC_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = I2S_MIC_SD
  };
  i2s_driver_install(I2S_MIC_PORT, &cfg, 0, NULL);
  i2s_set_pin(I2S_MIC_PORT, &pins);
  Serial.println("[MIC] I2S microphone initialized");
}

void audioRecorderStart() {
  pcmWritten = 0;
  recording  = true;
  memset(audioBuf, 0, sizeof(audioBuf));
  // Write placeholder WAV header — will be filled on stop
  i2s_start(I2S_MIC_PORT);

  // Record in a task to avoid blocking main loop
  xTaskCreate([](void*) {
    while (recording) {
      size_t bytesRead = 0;
      uint8_t tmp[512];
      i2s_read(I2S_MIC_PORT, tmp, sizeof(tmp), &bytesRead, portMAX_DELAY);
      size_t space = AUDIO_BUFFER_SIZE - pcmWritten;
      size_t toCopy = min(bytesRead, space);
      if (toCopy > 0) {
        memcpy(audioBuf + 44 + pcmWritten, tmp, toCopy);
        pcmWritten += toCopy;
      }
      if (pcmWritten >= AUDIO_BUFFER_SIZE) {
        recording = false;   // buffer full → auto stop
        break;
      }
    }
    vTaskDelete(NULL);
  }, "mic_task", 4096, NULL, 1, NULL);
}

void audioRecorderStop() {
  recording = false;
  delay(50);   // allow task to flush
  i2s_stop(I2S_MIC_PORT);
  // Write real WAV header now we know data size
  writeWavHeader(audioBuf, (uint32_t)pcmWritten);
  Serial.printf("[MIC] Recorded %u PCM bytes → WAV total %u bytes\n",
                pcmWritten, pcmWritten + 44);
}

uint8_t* audioRecorderGetBuffer(size_t* outSize) {
  *outSize = (pcmWritten > 0) ? (pcmWritten + 44) : 0;
  return audioBuf;
}
