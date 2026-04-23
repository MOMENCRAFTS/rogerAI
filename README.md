# Roger AI 🎙️

> Your intelligent, voice-first Chief of Staff — always on, always aware.

Roger AI is a push-to-talk voice assistant built on **React + Vite + Capacitor** (iOS / Android), powered by **OpenAI GPT-4o + Whisper + TTS** and backed by a **Supabase** backend. It features persistent memory, real-time location intelligence, proactive briefings, and a custom ESP32 hardware PTT device.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎙️ Push-to-Talk | Voice input via mic button or physical ESP32 device |
| 🧠 Persistent Memory | Memories stored in Supabase, injected into every AI call |
| 📍 Location Awareness | Geo-fence reminders, weather briefings, commute ETA |
| 📋 Morning Briefings | Scheduled proactive AI briefings via Supabase Edge Functions |
| 🔔 Push Notifications | Web Push with VAPID for reminders & alerts |
| 🤖 ESP32 Hardware PTT | Custom radio-style PTT device with I2S audio over WiFi |
| 📱 Mobile-first | Capacitor-wrapped iOS & Android native apps |

---

## 🏗️ Tech Stack

- **Frontend** — React 18, TypeScript, Vite, Capacitor
- **AI** — OpenAI GPT-4o, Whisper (STT), TTS
- **Backend** — Supabase (Auth, Postgres, Edge Functions, Realtime)
- **Maps** — Google Maps Distance Matrix API, Open-Meteo weather
- **Hardware** — ESP32 (Arduino / PlatformIO), I2S audio, WiFiManager

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Supabase CLI
- OpenAI API key
- Google Maps API key (for commute intelligence)

### Install

```bash
git clone https://github.com/MOMENCRAFTS/rogerAI.git
cd rogerAI
npm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

### Run

```bash
npm run dev
```

### Mobile (Capacitor)

```bash
npm run build
npx cap sync
npx cap open android   # or ios
```

---

## 📂 Project Structure

```
rogerAI/
├── src/                    # React source
│   ├── components/         # UI components (PTT, Memory, Locate, etc.)
│   ├── lib/                # Supabase client, helpers
│   └── main.tsx
├── supabase/
│   └── functions/          # Edge Functions (ai-intake, briefings, reminders, device-relay)
├── esp32-firmware/         # PlatformIO ESP32 PTT firmware
├── android/                # Capacitor Android project
├── ios/                    # Capacitor iOS project
└── public/
```

---

## 🔧 ESP32 Hardware

The `esp32-firmware/` directory contains the PlatformIO firmware for the custom PTT device:

- **WiFiManager** for captive-portal WiFi setup
- **I2S** audio capture (INMP441 mic) and playback (MAX98357A amp)
- **WebSocket** relay to Supabase `device-relay` edge function
- Self-registration via MAC address

See [`esp32-firmware/README.md`](esp32-firmware/README.md) for wiring diagrams and flash instructions.

---

## ☁️ Supabase Edge Functions

| Function | Purpose |
|---|---|
| `ai-intake` | Main voice → Whisper → GPT-4o → TTS pipeline |
| `device-relay` | Bridge for ESP32 audio relay |
| `morning-briefing` | Scheduled proactive briefings (cron) |
| `reminders` | Geo-triggered and time-based reminder delivery |

Deploy:

```bash
supabase functions deploy --no-verify-jwt
```

---

## 📄 License

MIT © MOMENCRAFTS
