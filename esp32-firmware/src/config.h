#pragma once

// ── WiFi ──────────────────────────────────────────────────────────────
#define WIFI_AP_NAME        "RogerDevice-Setup"
#define WIFI_AP_PASSWORD    ""                    // open hotspot
#define WIFI_TIMEOUT_MS     30000

// ── Supabase / Server ─────────────────────────────────────────────────
#define SUPABASE_URL        "https://krbfhiupcquddguorowe.supabase.co"
#define DEVICE_RELAY_URL    SUPABASE_URL "/functions/v1/device-relay"
#define SUPABASE_ANON_KEY   "YOUR_SUPABASE_ANON_KEY"

// ── User binding ──────────────────────────────────────────────────────
// Stored in NVS flash after first pairing. Default = empty.
#define DEFAULT_USER_ID     "ADMIN-TEST"          // change after auth is real

// ── Audio — I2S MEMS Microphone (INMP441) ─────────────────────────────
#define I2S_MIC_PORT        I2S_NUM_0
#define I2S_MIC_WS          GPIO_NUM_12
#define I2S_MIC_SCK         GPIO_NUM_13
#define I2S_MIC_SD          GPIO_NUM_11
#define I2S_SAMPLE_RATE     16000                 // 16kHz — Whisper optimal
#define I2S_SAMPLE_BITS     16
#define I2S_CHANNELS        1                     // mono
#define MAX_RECORD_SECONDS  30
#define AUDIO_BUFFER_SIZE   (I2S_SAMPLE_RATE * I2S_SAMPLE_BITS/8 * MAX_RECORD_SECONDS)

// ── Audio — I2S DAC Speaker (MAX98357A) ───────────────────────────────
#define I2S_SPK_PORT        I2S_NUM_1
#define I2S_SPK_BCLK        GPIO_NUM_26
#define I2S_SPK_LRC         GPIO_NUM_27
#define I2S_SPK_DOUT        GPIO_NUM_25

// ── PTT Button ────────────────────────────────────────────────────────
#define PTT_BUTTON_PIN      GPIO_NUM_4
#define PTT_DEBOUNCE_MS     50
#define PTT_MIN_HOLD_MS     300                   // < 300ms = too brief

// ── LED Ring (WS2812B × 8) ────────────────────────────────────────────
#define LED_PIN             GPIO_NUM_5
#define LED_COUNT           8
#define LED_BRIGHTNESS      80                    // 0–255

// ── OLED Display (SSD1306 128×64, I2C) ───────────────────────────────
#define OLED_SDA            GPIO_NUM_21
#define OLED_SCL            GPIO_NUM_22
#define OLED_WIDTH          128
#define OLED_HEIGHT         64
#define OLED_I2C_ADDR       0x3C

// ── Firmware ──────────────────────────────────────────────────────────
#define FIRMWARE_VERSION    "1.0.0"
