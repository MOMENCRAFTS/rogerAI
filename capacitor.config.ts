import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rogerai.app',
  appName: 'Roger AI',
  webDir: 'dist',

  // ── Live reload (DEV ONLY) — uncomment when testing on-device with Vite running ──
  // server: {
  //   url: 'http://172.20.10.4:5173',
  //   cleartext: true,
  //   allowNavigation: ['*.supabase.co', 'api.openai.com'],
  // },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,      // Show for 1.5s then auto-hide
      launchAutoHide: true,          // Always auto-hide — prevents permanent black screen
      backgroundColor: '#0d0d0a',   // Matches --bg-primary dark background
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      splashFullScreen: true,
      splashImmersive: true,
    },

    CapacitorHttp: {
      // DISABLED: CapacitorHttp patches both fetch() and XMLHttpRequest at the
      // JS bridge level. For binary responses (audio/mpeg from OpenAI TTS),
      // it returns xhr.response = undefined, breaking decodeAudioData.
      // All external APIs (Supabase, OpenAI) have proper CORS headers and
      // work correctly with the WebView's native networking stack.
      enabled: false,
    },
  },

  android: {
    // Allow cleartext for local dev server if needed
    allowMixedContent: true,
    captureInput: false, // true breaks space key in inputs on Android WebView
    webContentsDebuggingEnabled: true, // Enable Chrome DevTools debugging on device
  },

  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
    // NOTE: Do NOT set scheme here — it conflicts with our
    // com.rogerai.app:// OAuth deep-link URL scheme in Info.plist.
    // Capacitor serves the app via capacitor:// by default on iOS.
    allowNavigation: [
      '*.supabase.co',
      'accounts.google.com',
      '*.googleapis.com',
    ],
  },
};

export default config;
