// audio_player.h
#pragma once
#include <Arduino.h>
void audioPlayerInit();
void audioPlayerPlay(const String& url);
void audioPlayerStop();
void audioPlayerLoop();   // call in main loop
bool audioPlayerBusy();
