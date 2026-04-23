#include "led_controller.h"
#include "config.h"
#include <FastLED.h>

static DeviceState ledState   = STATE_IDLE;
static unsigned long lastTick = 0;
static uint8_t       phase    = 0;

// ── Color palette ─────────────────────────────────────────────────────
//  STATE_IDLE       → amber pulse
//  STATE_RECORDING  → red fast strobe
//  STATE_UPLOADING  → blue spinner
//  STATE_WAITING    → purple breathe
//  STATE_PLAYING    → green solid
//  STATE_ERROR      → red 3× flash
//  STATE_OFFLINE    → white slow blink
//  STATE_WIFI_SETUP → cyan chase

static CRGB stateColor(DeviceState s) {
  switch(s) {
    case STATE_IDLE:       return CRGB(255, 140, 0);     // amber
    case STATE_RECORDING:  return CRGB(255, 0, 0);       // red
    case STATE_UPLOADING:  return CRGB(0, 100, 255);     // blue
    case STATE_WAITING:    return CRGB(140, 0, 255);     // purple
    case STATE_PLAYING:    return CRGB(0, 220, 80);      // green
    case STATE_ERROR:      return CRGB(255, 0, 0);       // red
    case STATE_OFFLINE:    return CRGB(180, 180, 180);   // white-grey
    case STATE_WIFI_SETUP: return CRGB(0, 220, 220);     // cyan
    default:               return CRGB::Black;
  }
}

void ledSetState(DeviceState state) {
  ledState = state;
  phase    = 0;
}

void ledLoop() {
  unsigned long now = millis();
  uint8_t interval  = 30;   // ms per tick

  if (now - lastTick < interval) return;
  lastTick = now;
  phase++;

  CRGB col = stateColor(ledState);

  switch (ledState) {
    case STATE_IDLE: {
      // Slow amber pulse — all LEDs same brightness
      uint8_t br = beatsin8(10, 20, 90);
      fill_solid(leds, LED_COUNT, col);
      FastLED.setBrightness(br);
      break;
    }
    case STATE_RECORDING: {
      // Fast red strobe
      bool on = (phase % 6) < 3;
      fill_solid(leds, LED_COUNT, on ? col : CRGB::Black);
      FastLED.setBrightness(LED_BRIGHTNESS);
      break;
    }
    case STATE_UPLOADING: {
      // Blue spinner — one bright LED chases around ring
      FastLED.clear();
      FastLED.setBrightness(LED_BRIGHTNESS);
      int pos = (phase / 3) % LED_COUNT;
      leds[pos] = col;
      leds[(pos + 1) % LED_COUNT] = col.fadeToBlackBy(150);
      break;
    }
    case STATE_WAITING: {
      // Purple breathe
      uint8_t br = beatsin8(15, 10, LED_BRIGHTNESS);
      fill_solid(leds, LED_COUNT, col);
      FastLED.setBrightness(br);
      break;
    }
    case STATE_PLAYING: {
      // Solid green
      fill_solid(leds, LED_COUNT, col);
      FastLED.setBrightness(LED_BRIGHTNESS);
      break;
    }
    case STATE_ERROR: {
      // 3× red flash then off
      bool on = phase < 60 && ((phase / 10) % 2 == 0);
      fill_solid(leds, LED_COUNT, on ? col : CRGB::Black);
      FastLED.setBrightness(LED_BRIGHTNESS);
      break;
    }
    case STATE_OFFLINE: {
      // Slow white blink
      bool on = (phase % 60) < 30;
      fill_solid(leds, LED_COUNT, on ? col : CRGB::Black);
      FastLED.setBrightness(50);
      break;
    }
    case STATE_WIFI_SETUP: {
      // Cyan chase
      FastLED.clear();
      FastLED.setBrightness(LED_BRIGHTNESS);
      int pos = (phase / 2) % LED_COUNT;
      for (int i = 0; i < 3; i++)
        leds[(pos + i) % LED_COUNT] = col;
      break;
    }
  }

  FastLED.show();
}
