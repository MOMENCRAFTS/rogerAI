#include "tft_display.h"
#include "config.h"
#include <TFT_eSPI.h>
#include <qrcode.h>

// ── Display instance ──────────────────────────────────────────────────
static TFT_eSPI tft = TFT_eSPI();
static TFT_eSprite spr = TFT_eSprite(&tft);       // double-buffer sprite

// ── Color palette (RGB565) ────────────────────────────────────────────
#define COL_BG_DARK     0x0841    // #0a0e1a — dark navy
#define COL_AMBER       0xFD20    // #FFB000 — Roger amber
#define COL_AMBER_DIM   0x7A80    // dim amber for pulse
#define COL_RED         0xF800    // recording red
#define COL_RED_DARK    0x3000    // dark red background
#define COL_BLUE        0x34DF    // upload blue
#define COL_BLUE_DARK   0x0013    // dark blue background
#define COL_PURPLE      0x780F    // thinking purple
#define COL_PURPLE_DARK 0x2004    // dark purple background
#define COL_GREEN       0x07E0    // playing green
#define COL_GREEN_DARK  0x0320    // dark green background
#define COL_CYAN        0x07FF    // WiFi cyan
#define COL_CYAN_DARK   0x0333    // dark cyan background
#define COL_WHITE       0xFFFF
#define COL_GREY        0x7BEF
#define COL_BLACK       0x0000

// ── Animation state ───────────────────────────────────────────────────
static DeviceState displayState = STATE_WIFI_SETUP;
static unsigned long lastAnimTick = 0;
static uint8_t animFrame = 0;
static int CENTER_X = 120;
static int CENTER_Y = 120;
static int RADIUS   = 118;       // slightly inside the 120px bezel

// ── Helpers ───────────────────────────────────────────────────────────

// Draw centered text at a given Y position
static void drawCenteredText(const char* text, int y, uint8_t font, uint16_t color) {
  spr.setTextColor(color, COL_BG_DARK);
  spr.setTextDatum(TC_DATUM);
  spr.drawString(text, CENTER_X, y, font);
}

// Fill sprite with a solid background and draw outer ring
static void clearScreen(uint16_t bgColor, uint16_t ringColor) {
  spr.fillSprite(bgColor);
  spr.drawCircle(CENTER_X, CENTER_Y, RADIUS, ringColor);
  spr.drawCircle(CENTER_X, CENTER_Y, RADIUS - 1, ringColor);
}

// Draw a pulsing ring animation (sine-based alpha)
static void drawPulseRing(uint16_t color, int baseRadius) {
  float phase = (float)(millis() % 2000) / 2000.0f * 2.0f * PI;
  int r = baseRadius + (int)(4.0f * sin(phase));
  spr.drawCircle(CENTER_X, CENTER_Y, r, color);
  spr.drawCircle(CENTER_X, CENTER_Y, r - 1, color);
}

// Draw a rotating arc (spinner)
static void drawSpinner(uint16_t color, int radius) {
  float angle = (float)(millis() % 1500) / 1500.0f * 2.0f * PI;
  for (int i = 0; i < 60; i++) {
    float a = angle + (float)i * 0.02f;
    int x = CENTER_X + (int)(radius * cos(a));
    int y = CENTER_Y + (int)(radius * sin(a));
    spr.drawPixel(x, y, color);
  }
}

// ── Screen renderers ──────────────────────────────────────────────────

static void renderIdle() {
  clearScreen(COL_BG_DARK, COL_AMBER_DIM);
  drawPulseRing(COL_AMBER, 100);

  // Roger logo text
  spr.setTextColor(COL_AMBER);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("ROGER", CENTER_X, CENTER_Y - 20, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString("AI", CENTER_X, CENTER_Y + 10, 4);

  // Instruction
  spr.setTextColor(COL_GREY);
  spr.drawString("Hold PTT to speak", CENTER_X, CENTER_Y + 50, 2);
}

static void renderRecording() {
  clearScreen(COL_RED_DARK, COL_RED);
  drawPulseRing(COL_RED, 105);

  // Timer
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

  // Red dot indicator
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

  // Simple waveform bars
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
  spr.setTextColor(COL_GREY);
  spr.drawString("No WiFi", CENTER_X, CENTER_Y + 15, 2);
  spr.drawString("PTT disabled", CENTER_X, CENTER_Y + 40, 2);
}

static void renderWiFiSetup() {
  clearScreen(COL_CYAN_DARK, COL_CYAN);
  drawPulseRing(COL_CYAN, 100);

  spr.setTextColor(COL_CYAN);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("WiFi SETUP", CENTER_X, CENTER_Y - 35, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString("Connect to:", CENTER_X, CENTER_Y + 5, 2);
  spr.setTextColor(COL_CYAN);
  spr.drawString(WIFI_AP_NAME, CENTER_X, CENTER_Y + 25, 2);
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

// ── Boot splash ───────────────────────────────────────────────────────
static void renderBootSplash() {
  spr.fillSprite(COL_BLACK);

  // Amber gradient ring
  for (int r = 115; r > 105; r--) {
    spr.drawCircle(CENTER_X, CENTER_Y, r, COL_AMBER);
  }

  spr.setTextColor(COL_AMBER);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("ROGER", CENTER_X, CENTER_Y - 20, 4);
  spr.setTextColor(COL_WHITE);
  spr.drawString("AI", CENTER_X, CENTER_Y + 15, 4);
  spr.setTextColor(COL_GREY);
  spr.drawString("v" FIRMWARE_VERSION, CENTER_X, CENTER_Y + 50, 2);

  spr.pushSprite(0, 0);
  delay(1500);    // hold splash for 1.5 seconds
}

// ── Public API ────────────────────────────────────────────────────────

void tftInit() {
  tft.init();
  tft.setRotation(0);
  tft.fillScreen(COL_BLACK);

  // Create full-screen sprite for double buffering
  spr.createSprite(240, 240);
  spr.setSwapBytes(true);

  Serial.println("[TFT] GC9A01 240x240 initialized");
  renderBootSplash();
}

void tftSetState(DeviceState state) {
  displayState = state;
  animFrame = 0;
  // Force immediate redraw
  lastAnimTick = 0;
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
  // Generate QR code
  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(3)];   // Version 3 = 29x29 modules

  char qrContent[128];
  snprintf(qrContent, sizeof(qrContent), "roger://pair?code=%s", pairingCode);
  qrcode_initText(&qrcode, qrcodeData, 3, ECC_MEDIUM, qrContent);

  // Render QR on sprite
  clearScreen(COL_BG_DARK, COL_BLUE);

  int moduleSize = 5;    // each QR module = 5x5 pixels
  int qrSize = qrcode.size * moduleSize;
  int offsetX = (240 - qrSize) / 2;
  int offsetY = (240 - qrSize) / 2 - 15;   // shift up for text below

  // White background for QR
  spr.fillRect(offsetX - 8, offsetY - 8, qrSize + 16, qrSize + 16, COL_WHITE);

  // Draw QR modules
  for (uint8_t y = 0; y < qrcode.size; y++) {
    for (uint8_t x = 0; x < qrcode.size; x++) {
      if (qrcode_getModule(&qrcode, x, y)) {
        spr.fillRect(offsetX + x * moduleSize,
                     offsetY + y * moduleSize,
                     moduleSize, moduleSize, COL_BLACK);
      }
    }
  }

  // Pairing code text below QR
  spr.setTextColor(COL_CYAN);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("Scan with Roger App", CENTER_X, offsetY + qrSize + 20, 2);

  spr.pushSprite(0, 0);
}

void tftShowWaveform(int amplitude) {
  // Called during recording to show live mic level
  // amplitude: 0-100
  int barH = map(amplitude, 0, 100, 5, 50);
  spr.fillRect(CENTER_X - 3, CENTER_Y - barH, 6, barH * 2, COL_RED);
  // Don't pushSprite here — let tftLoop() handle it
}

void tftShowProgress(int percent) {
  // Upload progress arc
  clearScreen(COL_BLUE_DARK, COL_BLUE);

  // Progress arc
  float endAngle = (float)percent / 100.0f * 360.0f;
  for (float a = 0; a < endAngle; a += 0.5f) {
    float rad = a * PI / 180.0f - PI / 2.0f;   // start from top
    int x = CENTER_X + (int)(95.0f * cos(rad));
    int y = CENTER_Y + (int)(95.0f * sin(rad));
    spr.fillCircle(x, y, 3, COL_BLUE);
  }

  char pctText[8];
  snprintf(pctText, sizeof(pctText), "%d%%", percent);
  spr.setTextColor(COL_WHITE);
  spr.setTextDatum(MC_DATUM);
  spr.drawString(pctText, CENTER_X, CENTER_Y, 4);

  spr.pushSprite(0, 0);
}

void tftShowTranscript(const char* userSaid, const char* rogerSaid) {
  clearScreen(COL_BG_DARK, COL_GREEN);

  spr.setTextColor(COL_GREY);
  spr.setTextDatum(MC_DATUM);
  spr.drawString("YOU:", CENTER_X, 50, 2);

  // Truncate to fit circular display (~18 chars per line)
  char userBuf[20];
  strncpy(userBuf, userSaid, 19); userBuf[19] = '\0';
  spr.setTextColor(COL_WHITE);
  spr.drawString(userBuf, CENTER_X, 70, 2);

  spr.setTextColor(COL_AMBER);
  spr.drawString("ROGER:", CENTER_X, 110, 2);

  char rogerBuf[20];
  strncpy(rogerBuf, rogerSaid, 19); rogerBuf[19] = '\0';
  spr.setTextColor(COL_WHITE);
  spr.drawString(rogerBuf, CENTER_X, 130, 2);

  spr.pushSprite(0, 0);
}

void tftLoop() {
  // Animate at ~30fps
  unsigned long now = millis();
  if (now - lastAnimTick < 33) return;
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
  }

  spr.pushSprite(0, 0);
  animFrame++;
}
