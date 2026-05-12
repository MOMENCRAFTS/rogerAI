// Stub header — satisfies WiFiProv.cpp's `esp_qrcode_generate` call.
// The real esp_qrcode lives in esp-idf's component system which
// isn't linked in Arduino-ESP32 @ 7.x PlatformIO builds.

#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int qrcode_ecc_level;
} esp_qrcode_config_t;

#define ESP_QRCODE_CONFIG_DEFAULT() { .qrcode_ecc_level = 0 }

static inline void esp_qrcode_generate(esp_qrcode_config_t *cfg, const char *text) {
    (void)cfg; (void)text;  // no-op
}

#ifdef __cplusplus
}
#endif
