// http_client.h
#pragma once
#include <Arduino.h>

struct DeviceRelayResponse {
  bool    success = false;
  String  transcript;
  String  rogerResponse;
  String  ttsUrl;
  String  intent;
  String  error;
};

DeviceRelayResponse httpPostAudio(uint8_t* wavBuf, size_t wavSize,
                                   const String& deviceId, const String& userId);
void                httpRegisterDevice(const String& deviceId, const String& userId);
