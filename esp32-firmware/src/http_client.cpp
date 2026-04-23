#include "http_client.h"
#include "config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>

// ── Build multipart/form-data body ────────────────────────────────────
static String BOUNDARY = "RogerBoundary7x3k9";

static size_t buildMultipart(uint8_t* outBuf, size_t outMax,
                              const String& deviceId, const String& userId,
                              uint8_t* wavBuf, size_t wavSize) {
  String header =
    "--" + BOUNDARY + "\r\n"
    "Content-Disposition: form-data; name=\"device_id\"\r\n\r\n" + deviceId + "\r\n"
    "--" + BOUNDARY + "\r\n"
    "Content-Disposition: form-data; name=\"user_id\"\r\n\r\n" + userId + "\r\n"
    "--" + BOUNDARY + "\r\n"
    "Content-Disposition: form-data; name=\"audio\"; filename=\"ptt.wav\"\r\n"
    "Content-Type: audio/wav\r\n\r\n";

  String footer = "\r\n--" + BOUNDARY + "--\r\n";

  size_t total = header.length() + wavSize + footer.length();
  if (total > outMax) return 0;

  size_t pos = 0;
  memcpy(outBuf + pos, header.c_str(), header.length()); pos += header.length();
  memcpy(outBuf + pos, wavBuf, wavSize);                 pos += wavSize;
  memcpy(outBuf + pos, footer.c_str(), footer.length()); pos += footer.length();
  return pos;
}

DeviceRelayResponse httpPostAudio(uint8_t* wavBuf, size_t wavSize,
                                   const String& deviceId, const String& userId) {
  DeviceRelayResponse resp;

  if (WiFi.status() != WL_CONNECTED) {
    resp.error = "No WiFi";
    return resp;
  }

  // Build multipart body in heap — WAV can be up to ~960KB
  size_t bodyMax = wavSize + 512;
  uint8_t* body = (uint8_t*)malloc(bodyMax);
  if (!body) { resp.error = "OOM"; return resp; }

  size_t bodySize = buildMultipart(body, bodyMax, deviceId, userId, wavBuf, wavSize);
  if (bodySize == 0) { free(body); resp.error = "Body build failed"; return resp; }

  WiFiClientSecure client;
  client.setInsecure();   // for prototype — add cert pinning in prod

  HTTPClient http;
  http.begin(client, DEVICE_RELAY_URL);
  http.addHeader("Content-Type",
                 "multipart/form-data; boundary=" + BOUNDARY);
  http.addHeader("Authorization", "Bearer " SUPABASE_ANON_KEY);
  http.setTimeout(30000);   // 30s — Whisper + GPT-4o can be slow

  Serial.printf("[HTTP] POST %u bytes to %s\n", bodySize, DEVICE_RELAY_URL);
  int code = http.POST(body, bodySize);
  free(body);

  if (code != 200) {
    resp.error = "HTTP " + String(code);
    http.end();
    return resp;
  }

  String payload = http.getString();
  http.end();
  Serial.printf("[HTTP] Response: %s\n", payload.c_str());

  // Parse JSON response
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) { resp.error = "JSON parse error"; return resp; }

  resp.success       = true;
  resp.transcript    = doc["transcript"]    | "";
  resp.rogerResponse = doc["roger_response"]| "";
  resp.ttsUrl        = doc["tts_url"]       | "";
  resp.intent        = doc["intent"]        | "";

  return resp;
}

void httpRegisterDevice(const String& deviceId, const String& userId) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String url = String(SUPABASE_URL) + "/functions/v1/device-relay/register";
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " SUPABASE_ANON_KEY);

  JsonDocument doc;
  doc["device_id"]        = deviceId;
  doc["user_id"]          = userId;
  doc["firmware_version"] = FIRMWARE_VERSION;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  Serial.printf("[HTTP] Device registration: %d\n", code);
  http.end();
}
