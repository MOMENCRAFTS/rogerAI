#pragma once
#include <Arduino.h>

// ── BLE Provisioning ──────────────────────────────────────────────────
//    Replaces WiFiManager captive portal (192.168.4.1) with production
//    BLE provisioning via ESP-IDF's wifi_prov_mgr (Arduino WiFiProv wrapper).
#define PROV_SERVICE_PREFIX "ROGER"                // BLE device name prefix → "ROGER_XXXX"
#define PROV_TIMEOUT_MS     300000                 // 5 min timeout → restart provisioning
#define PROV_RESET_ON_BOOT  false                  // set true during development to force re-provision

// Master secret for per-device PoP derivation (HMAC-SHA256 of this + MAC)
// In production, this should be burned into eFuse or read from secure storage.
#define POP_MASTER_SECRET   "roger-ai-pop-2026"

// Custom 128-bit UUID for the provisioning BLE service
#define PROV_SERVICE_UUID   { 0xb4, 0xdf, 0x5a, 0x1c, 0x3f, 0x6b, 0xf4, 0xbf, \
                              0xea, 0x4a, 0x82, 0x03, 0x04, 0x90, 0x1a, 0x02 }

// ── Supabase / Server ─────────────────────────────────────────────────
#define SUPABASE_URL        "https://krbfhiupcquddguorowe.supabase.co"
#define DEVICE_RELAY_URL    SUPABASE_URL "/functions/v1/device-relay"
#define PAIR_DEVICE_URL     SUPABASE_URL "/functions/v1/pair-device"
#define SUPABASE_ANON_KEY   "YOUR_SUPABASE_ANON_KEY"

// ── User binding ──────────────────────────────────────────────────────
// Empty until device is paired via QR code. Stored in NVS after pairing.
#define DEFAULT_USER_ID     ""

// ── Audio — ES8388 Codec (ESP32-A1S Audio Kit) ────────────────────────
//    I2C control: SDA=33, SCL=32   (configured by AudioKit HAL)
//    I2S data:    BCK=27, WS=25, DOUT=26, DIN=35
//    These are handled internally by AUDIOKIT_BOARD=5
#define AMP_ENABLE_PIN      GPIO_NUM_21           // PA enable — HIGH = speaker on
#define AUDIO_SAMPLE_RATE   16000                 // 16kHz — Whisper optimal
#define AUDIO_BITS          16
#define AUDIO_CHANNELS      1                     // mono
#define MAX_RECORD_SECONDS  30
#define AUDIO_BUFFER_SIZE   (AUDIO_SAMPLE_RATE * (AUDIO_BITS / 8) * MAX_RECORD_SECONDS)

// ── PTT Button (KEY1 on Audio Kit) ───────────────────────────────────
//    GPIO 36 is input-only, no internal pullup — board has external 10K
#define PTT_BUTTON_PIN      GPIO_NUM_36
#define PTT_DEBOUNCE_MS     50
#define PTT_MIN_HOLD_MS     300                   // < 300ms = too brief

// ── Round TFT Display (GC9A01 240×240, SPI) ──────────────────────────
//    Pin assignments configured via build_flags in platformio.ini:
//    SCK=18, MOSI=23, CS=5, DC=22, RST=4
#define TFT_BL_PIN          GPIO_NUM_2            // backlight PWM (optional)

// ── NVS Keys (persistent storage) ────────────────────────────────────
#define NVS_NAMESPACE       "roger"
#define NVS_KEY_USER_ID     "user_id"
#define NVS_KEY_TOKEN       "device_token"
#define NVS_KEY_PAIRED      "is_paired"
#define NVS_KEY_WIFI_SSID   "wifi_ssid"
#define NVS_KEY_WIFI_PASS   "wifi_pass"

// ── Firmware ──────────────────────────────────────────────────────────
#define FIRMWARE_VERSION    "3.0.0"
