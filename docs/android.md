# Android app

The platform ships as an **installable PWA** plus a **native Android wrapper** (Capacitor). Both give realtime monitoring (Server-Sent Events notification stream, live badge + toast), an offline shell, and "Add to Home screen".

## Fastest path: the PWA (no build needed)

1. Open the web app in Chrome on the Android phone (`http://<pc-ip>:3000` on the same Wi-Fi, or the production URL).
2. Chrome shows "Add to Home screen" (or use the in-app install banner). The app then runs full-screen like a native app, keeps the last data when offline, and receives in-app realtime notifications.

## Native APK (Capacitor)

Prerequisites: **Android Studio** (SDK + a device or emulator) and JDK 17+.

```powershell
cd apps\web
npm install                       # includes @capacitor/*
# point the wrapper at a reachable server (default: http://localhost:3000)
$env:CAPACITOR_SERVER_URL = 'http://192.168.1.10:3000'   # your PC's LAN IP for a physical phone
npx cap sync android
npx cap open android              # opens Android Studio
```

In Android Studio: **Run ▶ 'app'** on a device/emulator, or **Build > Build APK(s)** for an installable APK. For a release build, sign it in Android Studio and set `CAPACITOR_SERVER_URL` to the HTTPS production domain (cleartext HTTP is only allowed in development).

The wrapper loads the web app from the server, so fixes deploy without a new APK. If you later want a fully offline bundle, switch `webDir` to a static export.

## Realtime monitoring

- `GET /api/notifications/stream?token=<JWT>` — SSE stream of `{ unread, latest }`, polled server-side every 5 s, heartbeats every 25 s. The navbar bell and `/notifications` update instantly; a toast appears for each new item.
- When the stream is unavailable, the app falls back to 30 s polling.
- Pages that need live data (tickets, operator dashboard) poll every 5–10 s already.

## Known limits

- Push notifications with the app closed are not included (needs FCM + VAPID; in-app notifications work while the app is open).
- The APK was scaffolded (`apps/web/android/`) but not built here — no Android SDK on this machine.
- JWT expiry is 8 h; reopening the app after that requires signing in again.
