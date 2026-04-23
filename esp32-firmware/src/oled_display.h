// oled_display.h
#pragma once
#include <Arduino.h>
void oledInit();
void oledShow(const char* line1, const char* line2,
              const char* line3, const char* line4);
