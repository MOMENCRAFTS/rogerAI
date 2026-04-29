import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rogerai.app',
  appName: 'Roger AI',
  webDir: 'dist',

  // Allow loading from local dev server during development
  server: {
    // Live reload — points Android WebView to the Vite dev server on this machine
    url: 'http://172.20.10.4:5173',
    cleartext: true,
    allowNavigation: ['*.supabase.co', 'api.openai.com'],
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 0,        // We control splash from the web layer
      launchAutoHide: false,        // Don't auto-hide — web SplashScreen component controls dismissal
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
    // Custom URL scheme for Supabase OAuth callback
    scheme: 'com.rogerai.app',
  },
};

export default config;
