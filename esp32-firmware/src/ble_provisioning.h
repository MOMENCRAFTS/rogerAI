// ble_provisioning.h — Production BLE WiFi provisioning via wifi_prov_mgr
#pragma once
#include <Arduino.h>

// ── Public API ────────────────────────────────────────────────────────

// Start BLE provisioning (call once from setup if device is not yet provisioned)
// Returns true if WiFi credentials were already stored and connection succeeded.
// Returns false if provisioning mode was started (loop must call bleProvLoop).
bool bleProvStart(bool forceReset = false);

// Non-blocking loop tick — call from loop().
// Handles provisioning timeout and restart.
void bleProvLoop();

// Check if provisioning is complete and WiFi is connected.
bool bleProvIsConnected();

// Get the PoP string (for display on screen or QR code)
const char* bleProvGetPoP();

// Get the BLE service name (e.g. "ROGER_A4CF")
const char* bleProvGetServiceName();

// Stop BLE and free resources after provisioning is complete.
// Called automatically by the event handler, but can be called manually.
void bleProvStop();
