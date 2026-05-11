#pragma once
#include <Arduino.h>

void audioPlayerInit();
void audioPlayerPlay(const String& url);
void audioPlayerStop();
void audioPlayerLoop();
bool audioPlayerBusy();
