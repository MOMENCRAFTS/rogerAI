// audio_recorder.h
#pragma once
#include <Arduino.h>
void    audioRecorderInit();
void    audioRecorderStart();
void    audioRecorderStop();
uint8_t* audioRecorderGetBuffer(size_t* outSize);
