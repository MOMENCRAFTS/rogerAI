#include "oled_display.h"
#include "config.h"
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>

static Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);

void oledInit() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println("[OLED] Init FAILED — display not found");
    return;
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Boot splash
  display.setTextSize(1);
  display.setCursor(20, 10);
  display.println("ROGER AI DEVICE");
  display.setCursor(28, 30);
  display.println("Initializing...");
  display.display();
  Serial.println("[OLED] Initialized");
}

void oledShow(const char* line1, const char* line2,
              const char* line3, const char* line4) {
  display.clearDisplay();

  // Line 1 — bold header
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(line1);

  // Horizontal rule
  display.drawLine(0, 10, OLED_WIDTH - 1, 10, SSD1306_WHITE);

  // Lines 2–4
  display.setCursor(0, 14);
  display.println(line2);
  display.setCursor(0, 30);
  display.println(line3);
  display.setCursor(0, 46);
  display.println(line4);

  display.display();
}
