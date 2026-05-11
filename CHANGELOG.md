# Changelog

All notable changes to RogerAI are documented here.

---

## [1.5.0] — 2026-05-11

### 🔧 Hardware — ESP32-A1S Audio Kit Migration
- Migrated firmware from ESP32-DevKitC to **ESP32-A1S Audio Development Kit** (ES8388 codec)
- Replaced OLED display driver with **GC9A01 240×240 round TFT** — 9 animated state screens at 30fps
- Rewrote audio HAL using `arduino-audiokit` for native ES8388 codec support
- Non-blocking PTT state machine — eliminated all `delay()` calls
- PSRAM-backed 30-second audio buffer (960KB) for zero-latency recording

### 🔐 Secure Device Pairing (Phase 5)
- **QR-code pairing flow**: Device displays QR → App scans → Secure token exchanged
- New `device_tokens` table with revocation support
- `pair-device` Edge Function: pair (POST), list devices (GET), unpair (DELETE), device poll (GET with query params)
- `device-relay` now validates `X-Device-Token` header — rejects unauthorized devices
- Device token persisted in **NVS flash** — survives power cycles and reboots
- Legacy form-data auth preserved as fallback during migration period

### 📱 App Updates
- New **"Paired Devices"** section in Settings — view, pair, and unpair ESP32 hardware
- Online/offline status indicators with last-activity timestamps
- Manual pairing form with 6-character code entry
- Three new API functions: `fetchPairedDevices`, `pairDevice`, `unpairDevice`

### 🛡️ Security Improvements
- Device authentication upgraded from trusting form-data `user_id` to cryptographic 64-char token validation
- Token revocation on device unpair
- Automatic re-pairing: old tokens revoked when device pairs to new user

### 🏗️ Infrastructure
- CP2102 USB-to-UART driver support for flashing
- `.pio/` build artifacts excluded from git
- Firmware version: `2.0.0` | App version: `1.5.0` | Android versionCode: `15`

---

## [1.4.0] — Previous Release
- C2C Voice Relay with Echo Test
- Proactive prayer alerts with amber ring animations
- Orientation walkthrough and location pinning
- Progressive user profiler engine
