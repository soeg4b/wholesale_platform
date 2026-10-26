import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a full-screen wrapper around the deployed web app; point this at the URL the
// device can reach (production HTTPS domain, or http://<pc-ip>:3000 for same-Wi-Fi development).
// PWA realtime (SSE), install prompt and offline shell all work inside the wrapper.
const config: CapacitorConfig = {
  appId: 'test.wnmp.app',
  appName: 'WNMP',
  webDir: 'public',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'http://localhost:3000',
    cleartext: process.env.NODE_ENV !== 'production',
  },
  android: {
    allowMixedContent: process.env.NODE_ENV !== 'production',
  },
};

export default config;
