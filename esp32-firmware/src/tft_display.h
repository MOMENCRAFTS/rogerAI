#pragma once
#include "globals.h"

// ── Display lifecycle ─────────────────────────────────────────────────
void tftInit();
void tftLoop();                                   // animation tick — call in loop()

// ── State-driven screens ──────────────────────────────────────────────
void tftSetState(DeviceState state);

// ── Content screens ───────────────────────────────────────────────────
void tftShowText(const char* line1, const char* line2 = "",
                 const char* line3 = "", const char* line4 = "");
void tftShowPairing(const char* pairingCode);     // QR code for device pairing
void tftShowWaveform(int amplitude);              // live mic level during recording
void tftShowProgress(int percent);                // upload progress bar
void tftShowTranscript(const char* userSaid, const char* rogerSaid);
