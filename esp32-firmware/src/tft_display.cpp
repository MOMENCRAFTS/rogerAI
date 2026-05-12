#include "tft_display.h"
#include "config.h"
#include "ble_provisioning.h"
#include <TFT_eSPI.h>
#include <qrcode.h>
#include <time.h>

// ── Display instance ──────────────────────────────────────────────────
static TFT_eSPI tft = TFT_eSPI();
static TFT_eSprite spr = TFT_eSprite(&tft);

// ── Color palette (RGB565) ────────────────────────────────────────────
#define COL_BG_DARK     0x0841
#define COL_AMBER       0xFD20
#define COL_AMBER_DIM   0x7A80
#define COL_RED         0xF800
#define COL_RED_DARK    0x3000
#define COL_BLUE        0x34DF
#define COL_BLUE_DARK   0x0013
#define COL_PURPLE      0x780F
#define COL_PURPLE_DARK 0x2004
#define COL_GREEN       0x07E0
#define COL_GREEN_DARK  0x0320
#define COL_CYAN        0x07FF
#define COL_CYAN_DARK   0x0333
#define COL_WHITE       0xFFFF
#define COL_GREY        0x7BEF
#define COL_BLACK       0x0000
#define COL_EMERALD     0x0F86
#define COL_EMERALD_DK  0x0342

// ── Animation state ───────────────────────────────────────────────────
static DeviceState displayState = STATE_WIFI_SETUP;
static unsigned long lastAnimTick = 0;
static uint8_t animFrame = 0;
static int CENTER_X = 120;
static int CENTER_Y = 120;
static int RADIUS   = 118;

// ── Helpers ───────────────────────────────────────────────────────────
static void drawCenteredText(const char* text, int y, uint8_t font, uint16_t color) {
  spr.setTextColor(color, COL_BG_DARK);
  spr.setTextDatum(TC_DATUM);
  spr.drawString(text, CENTER_X, y, font);
}

static void clearScreen(uint16_t bgColor, uint16_t ringColor) {
  spr.fillSprite(bgColor);
  spr.drawCircle(CENTER_X, CENTER_Y, RADIUS, ringColor);
  spr.drawCircle(CENTER_X, CENTER_Y, RADIUS - 1, ringColor);
}

static void drawPulseRing(uint16_t color, int baseRadius) {
  float phase = (float)(millis() % 2000) / 2000.0f * 2.0f * PI;
  int r = baseRadius + (int)(4.0f * sin(phase));
  spr.drawCircle(CENTER_X, CENTER_Y, r, color);
  spr.drawCircle(CENTER_X, CENTER_Y, r - 1, color);
}

static void drawSpinner(uint16_t color, int radius) {
  float angle = (float)(millis() % 1500) / 1500.0f * 2.0f * PI;
  for (int i = 0; i < 60; i++) {
    float a = angle + (float)i * 0.02f;
    int x = CENTER_X + (int)(radius * cos(a));
    int y = CENTER_Y + (int)(radius * sin(a));
    spr.drawPixel(x, y, color);
  }
}

// ── Original screen renderers (unchanged) ─────────────────────────────

static void renderIdle() {
  clearScreen(COL_BG_DARK, COL_AMBER_DIM);
  drawPulseRing(COL_AMBER, 100);
  spr.setTextColor(COL_AMBER);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("ROGER", CENTER_X, CENTER_Y - 20, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString("AI", CENTER_X, CENTER_Y + 10, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("Hold PTT to speak", CENTER_X, CENTER_Y + 45, 2);
  spr.setTextColor(COL_AMBER_DIM);
  spr.drawString("MOMENCRAFTS", CENTER_X, CENTER_Y + 75, 1);
}

static void renderRecording() {
  clearScreen(COL_RED_DARK, COL_RED);
  drawPulseRing(COL_RED, 105);
  unsigned long elapsed = millis() / 1000;
  char timer[16];
  snprintf(timer, sizeof(timer), "%02lu:%02lu", elapsed / 60, elapsed % 60);
  spr.setTextColor(COL_RED);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("REC", CENTER_X, CENTER_Y - 30, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString(timer, CENTER_X, CENTER_Y + 10, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("Release to send", CENTER_X, CENTER_Y + 50, 2);
  spr.fillCircle(CENTER_X - 40, CENTER_Y - 28, 6, COL_RED);
}

static void renderUploading() {
  clearScreen(COL_BLUE_DARK, COL_BLUE);
  drawSpinner(COL_BLUE, 90);
  spr.setTextColor(COL_BLUE);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("SENDING", CENTER_X, CENTER_Y - 15, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("Please wait...", CENTER_X, CENTER_Y + 25, 2);
}

static void renderWaiting() {
  clearScreen(COL_PURPLE_DARK, COL_PURPLE);
  drawSpinner(COL_PURPLE, 85);
  drawPulseRing(COL_PURPLE, 95);
  spr.setTextColor(COL_PURPLE);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("THINKING", CENTER_X, CENTER_Y - 15, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("Roger is processing...", CENTER_X, CENTER_Y + 25, 2);
}

static void renderPlaying() {
  clearScreen(COL_GREEN_DARK, COL_GREEN);
  drawPulseRing(COL_GREEN, 100);
  for (int i = -4; i <= 4; i++) {
    int barH = 10 + (int)(15.0f * sin((float)(millis() % 800) / 800.0f * PI + i * 0.5f));
    int x = CENTER_X + i * 12;
    spr.fillRect(x - 3, CENTER_Y - barH, 6, barH * 2, COL_GREEN);
  }
  spr.setTextColor(COL_WHITE);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("ROGER SAYS", CENTER_X, CENTER_Y + 55, 2);
}

static void renderError() {
  clearScreen(COL_RED_DARK, COL_RED);
  spr.setTextColor(COL_RED);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("ERROR", CENTER_X, CENTER_Y - 20, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("Try again", CENTER_X, CENTER_Y + 20, 2);
}

static void renderOffline() {
  clearScreen(COL_BG_DARK, COL_GREY);
  spr.setTextColor(COL_GREY);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("OFFLINE", CENTER_X, CENTER_Y - 20, 4);
  spr.drawString("No WiFi", CENTER_X, CENTER_Y + 15, 2);
  spr.drawString("PTT disabled", CENTER_X, CENTER_Y + 40, 2);
}

static void renderWiFiSetup() {
  // Legacy WiFi setup screen — now shows BLE provisioning name
  clearScreen(COL_CYAN_DARK, COL_CYAN);
  drawPulseRing(COL_CYAN, 100);
  spr.setTextColor(COL_CYAN);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("WiFi SETUP", CENTER_X, CENTER_Y - 35, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString("Open Roger App", CENTER_X, CENTER_Y + 5, 2);
  spr.setTextColor(COL_CYAN);
  spr.drawString(bleProvGetServiceName(), CENTER_X, CENTER_Y + 25, 2);
  spr.setTextColor(COL_GREY);
  spr.drawString("to configure WiFi", CENTER_X, CENTER_Y + 50, 2);
}

static void renderPairing() {
  clearScreen(COL_BG_DARK, COL_BLUE);
  drawPulseRing(COL_BLUE, 105);
  spr.setTextColor(COL_BLUE);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("PAIR DEVICE", CENTER_X, CENTER_Y - 35, 2);
  spr.setTextColor(COL_GREY);
  spr.drawString("Scan QR in", CENTER_X, CENTER_Y + 5, 2);
  spr.drawString("Roger App", CENTER_X, CENTER_Y + 25, 2);
}

// ── BLE Provisioning — spinning ring + PoP + "Open Roger App" ────────
static void renderProvisioning() {
  clearScreen(COL_BG_DARK, COL_AMBER_DIM);

  // Outer sweeping arc — spinning gold "comet tail"
  float sweepAngle = (float)(millis() % 2000) / 2000.0f * 360.0f;
  for (int i = 0; i < 60; i++) {
    float a = (sweepAngle - i * 1.5f) * PI / 180.0f - PI / 2.0f;
    // Fade tail from bright to dim
    uint16_t col = (i < 15) ? COL_AMBER : COL_AMBER_DIM;
    int r = 108;
    int x = CENTER_X + (int)(r * cos(a));
    int y = CENTER_Y + (int)(r * sin(a));
    spr.fillCircle(x, y, 2, col);
  }

  // Inner pulse ring
  drawPulseRing(COL_AMBER, 90);

  // "ROGER AI" brand
  spr.setTextColor(COL_AMBER);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("ROGER", CENTER_X, CENTER_Y - 40, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString("AI", CENTER_X, CENTER_Y - 10, 4);

  // PoP code — large and prominent
  const char* pop = bleProvGetPoP();
  if (pop && pop[0]) {
    spr.setTextColor(COL_CYAN);
    spr.drawString(pop, CENTER_X, CENTER_Y + 25, 4);
  }

  // Instructions
  spr.setTextColor(COL_GREY);
  spr.drawString("Open Roger App", CENTER_X, CENTER_Y + 60, 2);

  // Blinking "searching" dot
  if ((millis() / 500) % 2 == 0) {
    spr.fillCircle(CENTER_X, CENTER_Y + 80, 3, COL_AMBER);
  }
}

// ── NEW: Extended LCD state renderers ─────────────────────────────────

static void renderClock() {
  clearScreen(COL_BG_DARK, COL_AMBER_DIM);
  // Analog clock face
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    // Fallback — just show digital millis counter
    unsigned long s = millis() / 1000;
    char buf[8]; snprintf(buf, 8, "%02lu:%02lu", (s / 60) % 24, s % 60);
    spr.setTextColor(COL_AMBER); spr.setTextDatum(MC_DATUM);
    spr.drawString(buf, CENTER_X, CENTER_Y, 4);
    return;
  }
  // Hour markers
  for (int i = 0; i < 12; i++) {
    float a = i * 30.0f * PI / 180.0f - PI / 2.0f;
    int x1 = CENTER_X + (int)(100 * cos(a));
    int y1 = CENTER_Y + (int)(100 * sin(a));
    int x2 = CENTER_X + (int)(110 * cos(a));
    int y2 = CENTER_Y + (int)(110 * sin(a));
    spr.drawLine(x1, y1, x2, y2, COL_AMBER_DIM);
  }
  // Hour hand
  float hAngle = ((timeinfo.tm_hour % 12) * 30.0f + timeinfo.tm_min * 0.5f) * PI / 180.0f - PI / 2.0f;
  spr.drawLine(CENTER_X, CENTER_Y,
    CENTER_X + (int)(55 * cos(hAngle)), CENTER_Y + (int)(55 * sin(hAngle)), COL_AMBER);
  // Minute hand
  float mAngle = timeinfo.tm_min * 6.0f * PI / 180.0f - PI / 2.0f;
  spr.drawLine(CENTER_X, CENTER_Y,
    CENTER_X + (int)(80 * cos(mAngle)), CENTER_Y + (int)(80 * sin(mAngle)), COL_WHITE);
  // Second hand
  float sAngle = timeinfo.tm_sec * 6.0f * PI / 180.0f - PI / 2.0f;
  spr.drawLine(CENTER_X, CENTER_Y,
    CENTER_X + (int)(85 * cos(sAngle)), CENTER_Y + (int)(85 * sin(sAngle)), COL_RED);
  // Center dot
  spr.fillCircle(CENTER_X, CENTER_Y, 4, COL_AMBER);
  // Digital overlay
  char digital[8];
  snprintf(digital, 8, "%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min);
  spr.setTextColor(COL_GREY); spr.setTextDatum(MC_DATUM);
  spr.drawString(digital, CENTER_X, CENTER_Y + 40, 2);
}

static void renderListening() {
  clearScreen(COL_GREEN_DARK, COL_GREEN);
  drawPulseRing(COL_GREEN, 95);
  // Animated ear/wave icon — concentric arcs
  for (int i = 0; i < 3; i++) {
    float phase = (float)((millis() + i * 200) % 1200) / 1200.0f;
    int r = 30 + i * 18;
    uint16_t col = (phase > 0.5f) ? COL_GREEN : COL_GREEN_DARK;
    spr.drawCircle(CENTER_X, CENTER_Y - 10, r, col);
  }
  spr.setTextColor(COL_WHITE); spr.setTextDatum(MC_DATUM);
  spr.drawString("LISTENING", CENTER_X, CENTER_Y + 50, 2);
  spr.setTextColor(COL_GREY);
  spr.drawString("Roger is speaking", CENTER_X, CENTER_Y + 70, 2);
}

static void renderPrayer() {
  clearScreen(COL_EMERALD_DK, COL_EMERALD);
  drawPulseRing(COL_EMERALD, 100);
  // Crescent symbol (two overlapping circles)
  spr.fillCircle(CENTER_X, CENTER_Y - 25, 25, COL_EMERALD);
  spr.fillCircle(CENTER_X + 10, CENTER_Y - 25, 22, COL_EMERALD_DK);
  // Prayer name from payload
  spr.setTextColor(COL_WHITE); spr.setTextDatum(MC_DATUM);
  spr.drawString(displayData.line1, CENTER_X, CENTER_Y + 15, 4);
  // Countdown
  if (displayData.value > 0) {
    char countdown[16];
    snprintf(countdown, 16, "in %d min", displayData.value);
    spr.setTextColor(COL_EMERALD);
    spr.drawString(countdown, CENTER_X, CENTER_Y + 45, 2);
  } else {
    spr.setTextColor(COL_EMERALD);
    spr.drawString("Time to pray", CENTER_X, CENTER_Y + 45, 2);
  }
  if (displayData.line2[0]) {
    spr.setTextColor(COL_GREY);
    spr.drawString(displayData.line2, CENTER_X, CENTER_Y + 70, 2);
  }
}

static void renderReminder() {
  clearScreen(COL_BG_DARK, COL_AMBER);
  drawPulseRing(COL_AMBER, 100);
  // Bell icon (triangle + circle)
  spr.fillTriangle(CENTER_X - 15, CENTER_Y - 10,
                   CENTER_X + 15, CENTER_Y - 10,
                   CENTER_X, CENTER_Y - 40, COL_AMBER);
  spr.fillCircle(CENTER_X, CENTER_Y - 10, 16, COL_AMBER);
  spr.fillCircle(CENTER_X, CENTER_Y + 5, 5, COL_AMBER);
  // Reminder text
  spr.setTextColor(COL_WHITE); spr.setTextDatum(MC_DATUM);
  spr.drawString("REMINDER", CENTER_X, CENTER_Y + 25, 2);
  spr.setTextColor(COL_AMBER);
  spr.drawString(displayData.line1, CENTER_X, CENTER_Y + 48, 2);
  if (displayData.line2[0]) {
    spr.setTextColor(COL_GREY);
    spr.drawString(displayData.line2, CENTER_X, CENTER_Y + 68, 2);
  }
}

static void renderLocked() {
  clearScreen(COL_RED_DARK, COL_RED);
  // Lock icon (rectangle + arch)
  spr.fillRect(CENTER_X - 20, CENTER_Y - 10, 40, 30, COL_RED);
  spr.drawCircle(CENTER_X, CENTER_Y - 15, 15, COL_RED);
  spr.drawCircle(CENTER_X, CENTER_Y - 15, 14, COL_RED);
  // Keyhole
  spr.fillCircle(CENTER_X, CENTER_Y, 4, COL_RED_DARK);
  spr.fillRect(CENTER_X - 2, CENTER_Y, 4, 10, COL_RED_DARK);

  spr.setTextColor(COL_WHITE); spr.setTextDatum(MC_DATUM);
  spr.drawString("REVOKED", CENTER_X, CENTER_Y + 40, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("Device locked", CENTER_X, CENTER_Y + 70, 2);
  spr.drawString("Contact owner", CENTER_X, CENTER_Y + 90, 2);
}

static void renderRelay() {
  clearScreen(COL_CYAN_DARK, COL_CYAN);
  drawPulseRing(COL_CYAN, 100);
  drawSpinner(COL_CYAN, 85);
  // Satellite icon — diamond + signal arcs
  spr.fillRect(CENTER_X - 6, CENTER_Y - 30, 12, 12, COL_CYAN);
  for (int i = 1; i <= 3; i++) {
    float phase = (float)((millis() + i * 300) % 1500) / 1500.0f;
    uint16_t col = (phase < 0.6f) ? COL_CYAN : COL_CYAN_DARK;
    spr.drawCircle(CENTER_X + 10, CENTER_Y - 35, 8 + i * 6, col);
  }
  spr.setTextColor(COL_WHITE); spr.setTextDatum(MC_DATUM);
  spr.drawString("RELAY", CENTER_X, CENTER_Y + 10, 4);
  spr.setTextColor(COL_CYAN);
  spr.drawString(displayData.line1[0] ? displayData.line1 : "C2C Active", CENTER_X, CENTER_Y + 45, 2);
}

static void renderBriefing() {
  clearScreen(COL_PURPLE_DARK, COL_PURPLE);
  // Radar sweep
  float sweepAngle = (float)(millis() % 3000) / 3000.0f * 2.0f * PI;
  for (int r = 20; r < 90; r += 25) {
    spr.drawCircle(CENTER_X, CENTER_Y - 5, r, COL_PURPLE);
  }
  // Sweep line
  int sx = CENTER_X + (int)(85 * cos(sweepAngle - PI / 2.0f));
  int sy = CENTER_Y - 5 + (int)(85 * sin(sweepAngle - PI / 2.0f));
  spr.drawLine(CENTER_X, CENTER_Y - 5, sx, sy, COL_PURPLE);
  // Blips
  for (int i = 0; i < 4; i++) {
    float ba = sweepAngle - 0.3f - i * 0.15f;
    int br = 30 + i * 15;
    int bx = CENTER_X + (int)(br * cos(ba - PI / 2.0f));
    int by = CENTER_Y - 5 + (int)(br * sin(ba - PI / 2.0f));
    spr.fillCircle(bx, by, 2, COL_WHITE);
  }
  spr.setTextColor(COL_WHITE); spr.setTextDatum(MC_DATUM);
  spr.drawString("BRIEFING", CENTER_X, CENTER_Y + 60, 2);
  spr.setTextColor(COL_PURPLE);
  spr.drawString("Morning Intel", CENTER_X, CENTER_Y + 80, 2);
}

// ── Proactive — Roger wants to say something ──────────────────────────
static void renderProactive() {
  clearScreen(COL_BG_DARK, COL_AMBER_DIM);

  // Radiating circles (expanding outward like a ping)
  unsigned long t = millis();
  for (int i = 0; i < 3; i++) {
    float phase = (float)((t + i * 700) % 2100) / 2100.0f;
    int r = 30 + (int)(75.0f * phase);
    uint8_t alpha = (uint8_t)(255.0f * (1.0f - phase));
    uint16_t col = (alpha > 128) ? COL_AMBER : COL_AMBER_DIM;
    spr.drawCircle(CENTER_X, CENTER_Y - 10, r, col);
  }

  // Brain/thought icon — small amber dot cluster
  spr.fillCircle(CENTER_X, CENTER_Y - 50, 8, COL_AMBER);
  spr.fillCircle(CENTER_X - 10, CENTER_Y - 42, 5, COL_AMBER);
  spr.fillCircle(CENTER_X + 8, CENTER_Y - 40, 4, COL_AMBER);

  // "ROGER" brand
  spr.setTextColor(COL_AMBER);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("ROGER", CENTER_X, CENTER_Y + 10, 4);

  // Subtitle
  spr.setTextColor(COL_WHITE);
  spr.drawString("has something", CENTER_X, CENTER_Y + 40, 2);
  spr.drawString("to tell you", CENTER_X, CENTER_Y + 58, 2);

  // Message preview (first line from displayData)
  if (displayData.line1[0]) {
    spr.setTextColor(COL_GREY);
    // Truncate for display
    char preview[24];
    strncpy(preview, displayData.line1, 23);
    preview[23] = '\0';
    if (strlen(displayData.line1) > 23) {
      preview[20] = '.'; preview[21] = '.'; preview[22] = '.';
    }
    spr.drawString(preview, CENTER_X, CENTER_Y + 82, 2);
  }

  // Blinking "press PTT" indicator
  if ((t / 600) % 2 == 0) {
    spr.setTextColor(COL_AMBER_DIM);
    spr.drawString("Press PTT", CENTER_X, CENTER_Y + 102, 1);
  }
}

// ── Boot splash (animated) ────────────────────────────────────────────
static void renderBootSplash() {
  // Phase 1: Ring sweep animation (1 second)
  unsigned long start = millis();
  while (millis() - start < 1000) {
    spr.fillSprite(COL_BLACK);
    float progress = (float)(millis() - start) / 1000.0f;
    float endAngle = progress * 360.0f;

    // Draw sweeping ring
    for (float a = 0; a < endAngle; a += 1.5f) {
      float rad = a * PI / 180.0f - PI / 2.0f;
      for (int r = 106; r <= 115; r++) {
        int x = CENTER_X + (int)(r * cos(rad));
        int y = CENTER_Y + (int)(r * sin(rad));
        spr.drawPixel(x, y, COL_AMBER);
      }
    }

    // Fade in text based on progress
    if (progress > 0.3f) {
      spr.setTextColor(COL_AMBER); spr.setTextDatum(MC_DATUM);
      spr.drawString("ROGER", CENTER_X, CENTER_Y - 20, 4);
    }
    if (progress > 0.5f) {
      spr.setTextColor(COL_WHITE);
      spr.drawString("AI", CENTER_X, CENTER_Y + 15, 4);
    }
    if (progress > 0.7f) {
      spr.setTextColor(COL_GREY);
      spr.drawString("v" FIRMWARE_VERSION, CENTER_X, CENTER_Y + 50, 2);
    }

    spr.pushSprite(0, 0);
    delay(16);  // ~60fps
  }

  // Phase 2: Hold complete splash (1 second)
  spr.fillSprite(COL_BLACK);
  for (int r = 115; r > 105; r--) {
    spr.drawCircle(CENTER_X, CENTER_Y, r, COL_AMBER);
  }
  spr.setTextColor(COL_AMBER); spr.setTextDatum(MC_DATUM);
  spr.drawString("ROGER", CENTER_X, CENTER_Y - 25, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString("AI", CENTER_X, CENTER_Y + 10, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("v" FIRMWARE_VERSION, CENTER_X, CENTER_Y + 45, 2);
  spr.setTextColor(COL_AMBER_DIM);
  spr.drawString("MOMENCRAFTS", CENTER_X, CENTER_Y + 70, 1);
  spr.pushSprite(0, 0);
  delay(1000);
}

// ── Public API ────────────────────────────────────────────────────────

void tftInit() {
  tft.init();
  tft.setRotation(0);
  tft.fillScreen(COL_BLACK);
  spr.createSprite(240, 240);
  spr.setSwapBytes(true);
  Serial.println("[TFT] GC9A01 240x240 initialized");
  renderBootSplash();
}

void tftSetState(DeviceState state) {
  displayState = state;
  animFrame = 0;
  lastAnimTick = 0;
}

void tftSetStateWithData(DeviceState state, const DisplayPayload& data) {
  displayData = data;
  tftSetState(state);
}

void tftShowText(const char* line1, const char* line2,
                 const char* line3, const char* line4) {
  clearScreen(COL_BG_DARK, COL_AMBER_DIM);
  if (line1[0]) drawCenteredText(line1, 60,  4, COL_AMBER);
  if (line2[0]) drawCenteredText(line2, 95,  2, COL_WHITE);
  if (line3[0]) drawCenteredText(line3, 125, 2, COL_WHITE);
  if (line4[0]) drawCenteredText(line4, 155, 2, COL_GREY);
  spr.pushSprite(0, 0);
}

void tftShowPairing(const char* pairingCode) {
  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(3)];
  char qrContent[128];
  snprintf(qrContent, sizeof(qrContent), "roger://pair?code=%s", pairingCode);
  qrcode_initText(&qrcode, qrcodeData, 3, ECC_MEDIUM, qrContent);
  clearScreen(COL_BG_DARK, COL_BLUE);
  int moduleSize = 5;
  int qrSize = qrcode.size * moduleSize;
  int offsetX = (240 - qrSize) / 2;
  int offsetY = (240 - qrSize) / 2 - 15;
  spr.fillRect(offsetX - 8, offsetY - 8, qrSize + 16, qrSize + 16, COL_WHITE);
  for (uint8_t y = 0; y < qrcode.size; y++) {
    for (uint8_t x = 0; x < qrcode.size; x++) {
      if (qrcode_getModule(&qrcode, x, y)) {
        spr.fillRect(offsetX + x * moduleSize, offsetY + y * moduleSize,
                     moduleSize, moduleSize, COL_BLACK);
      }
    }
  }
  spr.setTextColor(COL_CYAN); spr.setTextDatum(MC_DATUM);
  spr.drawString("Scan with Roger App", CENTER_X, offsetY + qrSize + 20, 2);
  spr.pushSprite(0, 0);
}

void tftShowWaveform(int amplitude) {
  int barH = map(amplitude, 0, 100, 5, 50);
  spr.fillRect(CENTER_X - 3, CENTER_Y - barH, 6, barH * 2, COL_RED);
}

void tftShowProgress(int percent) {
  clearScreen(COL_BLUE_DARK, COL_BLUE);
  float endAngle = (float)percent / 100.0f * 360.0f;
  for (float a = 0; a < endAngle; a += 0.5f) {
    float rad = a * PI / 180.0f - PI / 2.0f;
    int x = CENTER_X + (int)(95.0f * cos(rad));
    int y = CENTER_Y + (int)(95.0f * sin(rad));
    spr.fillCircle(x, y, 3, COL_BLUE);
  }
  char pctText[8]; snprintf(pctText, sizeof(pctText), "%d%%", percent);
  spr.setTextColor(COL_WHITE); spr.setTextDatum(MC_DATUM);
  spr.drawString(pctText, CENTER_X, CENTER_Y, 4);
  spr.pushSprite(0, 0);
}

void tftShowTranscript(const char* userSaid, const char* rogerSaid) {
  clearScreen(COL_BG_DARK, COL_GREEN);
  spr.setTextColor(COL_GREY); spr.setTextDatum(MC_DATUM);
  spr.drawString("YOU:", CENTER_X, 50, 2);
  char userBuf[20]; strncpy(userBuf, userSaid, 19); userBuf[19] = '\0';
  spr.setTextColor(COL_WHITE); spr.drawString(userBuf, CENTER_X, 70, 2);
  spr.setTextColor(COL_AMBER); spr.drawString("ROGER:", CENTER_X, 110, 2);
  char rogerBuf[20]; strncpy(rogerBuf, rogerSaid, 19); rogerBuf[19] = '\0';
  spr.setTextColor(COL_WHITE); spr.drawString(rogerBuf, CENTER_X, 130, 2);
  spr.pushSprite(0, 0);
}

void tftLoop() {
  unsigned long now = millis();
  if (now - lastAnimTick < 33) return;  // ~30fps
  lastAnimTick = now;

  switch (displayState) {
    case STATE_IDLE:       renderIdle();       break;
    case STATE_RECORDING:  renderRecording();  break;
    case STATE_UPLOADING:  renderUploading();  break;
    case STATE_WAITING:    renderWaiting();    break;
    case STATE_PLAYING:    renderPlaying();    break;
    case STATE_ERROR:      renderError();      break;
    case STATE_OFFLINE:    renderOffline();    break;
    case STATE_WIFI_SETUP: renderWiFiSetup();  break;
    case STATE_PAIRING:    renderPairing();    break;
    case STATE_PROVISIONING: renderProvisioning(); break;
    case STATE_CLOCK:      renderClock();      break;
    case STATE_LISTENING:  renderListening();  break;
    case STATE_PRAYER:     renderPrayer();     break;
    case STATE_REMINDER:   renderReminder();   break;
    case STATE_LOCKED:     renderLocked();     break;
    case STATE_RELAY:      renderRelay();      break;
    case STATE_BRIEFING:   renderBriefing();   break;
    case STATE_PROACTIVE:  renderProactive();  break;
  }

  spr.pushSprite(0, 0);
  animFrame++;
}
