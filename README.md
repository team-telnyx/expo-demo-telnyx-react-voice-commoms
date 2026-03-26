# Telnyx Voice Lite

A minimal Expo sample app demonstrating the [@telnyx/react-voice-commons-sdk](https://github.com/team-telnyx/react-native-voice-commons) for making and receiving VoIP calls with push notification support.

This project uses **Expo with the old architecture** (`newArchEnabled: false`) for faster cold starts and more reliable push notification handling.

## Features

- SIP credential or token-based authentication
- Outbound calls to phone numbers or SIP URIs
- Incoming call handling with CallKit (iOS) and foreground service (Android)
- VoIP push notifications (iOS via PushKit, Android via Firebase)
- Call controls: answer, hangup, mute, hold
- Real-time connection and call state display
- Expo config plugin for automatic native setup

## Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- Xcode 15+ (iOS)
- Android Studio (Android)
- A [Telnyx account](https://portal.telnyx.com) with a SIP connection or token

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Add your credentials

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

**Option A — SIP Credentials:**
```env
EXPO_PUBLIC_SIP_USER=your_sip_username
EXPO_PUBLIC_SIP_PASS=your_sip_password
```

**Option B — Token-based login:**
```env
EXPO_PUBLIC_SIP_TOKEN=your_jwt_token
```

> **Note:** The `.env` file is git-ignored to keep your credentials safe.

### 3. Generate native projects

```bash
npx expo prebuild --clean
```

This runs the included config plugin (`plugins/withTelnyxVoice.js`) which automatically configures:

**iOS:**
- `aps-environment` entitlement for push notifications (required for PushKit VoIP token registration)
- PushKit VoIP push registration in `AppDelegate.swift`
- `PKPushRegistryDelegate` methods for handling incoming VoIP pushes
- CallKit integration (handled by the SDK)
- Xcode 26 compatibility fix (suppresses `jsi.h` const-correctness build error)

**Android:**
- `MainActivity` extends `TelnyxMainActivity` for push notification intent handling
- `VoicePnBridgePackage` registered in `MainApplication`
- `AppFirebaseMessagingService` for Firebase Cloud Messaging
- `AppNotificationActionReceiver` for notification answer/reject actions

### 4. Run

Start the Metro bundler, then build and run on your target platform:

```bash
# Start Metro
npx expo start

# iOS (in a separate terminal)
npx expo run:ios

# Android (in a separate terminal)
npx expo run:android
```

## Push Notifications Setup

### iOS (VoIP Push via PushKit)

1. Enable **Push Notifications** capability in Xcode
2. Enable **Background Modes** > Voice over IP in Xcode
3. Upload your VoIP push certificate to the [Telnyx Portal](https://portal.telnyx.com)

The config plugin handles all the native code — no manual `AppDelegate` edits needed.

### Android (Firebase Cloud Messaging)

1. Create a Firebase project and add your Android app
2. Download `google-services.json` and place it in `android/app/`
3. Upload your FCM server key to the [Telnyx Portal](https://portal.telnyx.com)

The config plugin generates the `AppFirebaseMessagingService` and registers it in the manifest automatically.

## Project Structure

```
telnyx-voice-lite/
  App.tsx                  # Single-file app: UI, VoIP client, call handling
  index.ts                 # Expo entry point
  app.json                 # Expo config (old arch, background modes, permissions)
  .env.example             # Environment variable template
  .env                     # Your local credentials (git-ignored)
  plugins/
    withTelnyxVoice.js     # Config plugin for native VoIP/push setup
  assets/
    logo.png               # Telnyx logo
    icon.png               # App icon
    splash-icon.png        # Splash screen
```

## How It Works

The app is intentionally a single file (`App.tsx`) to make it easy to follow:

1. **Client creation** — `createTelnyxVoipClient()` is called at module scope (singleton pattern)
2. **Auto-connect** — On mount, the app checks if it was launched from a push notification. If not, it logs in with the credentials from environment variables
3. **Reactive state** — Connection and call states are observed via RxJS subscriptions (`connectionState$`, `activeCall$`, `callState$`)
4. **Push notifications** — Native push handling is wired up by the config plugin. The SDK's `TelnyxVoiceApp` wrapper coordinates between native push events and the JS VoIP client

## Architecture Note

This app uses Expo's **old architecture** (bridge-based) rather than the new architecture (Fabric/TurboModules). For VoIP apps with push notifications, the old architecture provides:

- Faster cold start from push notification taps
- More predictable native module initialization order
- Better compatibility with PushKit and CallKit lifecycle requirements

Set in `app.json`:
```json
"newArchEnabled": false
```

## Troubleshooting

### iOS: Empty VoIP push token / app stays disconnected

On iOS the app waits for a VoIP push token from PushKit before logging in. If the token is empty, the app will still connect but without push notification support for incoming calls. Check the Metro logs for `VoIP push token:` to see if a token was issued.

**Common causes of an empty token:**

- **Running on a simulator** — PushKit only issues tokens on physical devices. You must use a real device.
- **Missing VoIP Push Certificate** — Create a VoIP Services Certificate in the [Apple Developer Portal](https://developer.apple.com/account/resources/certificates/list) for your bundle ID (`com.telnyx.voicelite`) and install it in your Keychain.
- **Stale native build** — If you changed entitlements or the config plugin, you must run `npx expo prebuild --clean` and rebuild with `npx expo run:ios`. A stale build will not pick up new entitlements, causing PushKit to return an empty token.
- **Missing entitlements** — The config plugin adds the `aps-environment` entitlement automatically. If you still have issues, open the `.xcworkspace` in Xcode and verify that **Push Notifications** appears under Signing & Capabilities. You may also need to toggle "Automatically manage signing" off and back on to regenerate the provisioning profile.

### iOS: Double login on push notification launch

When the app is launched from a VoIP push notification, the SDK handles login internally. The app uses `TelnyxVoipClient.isLaunchedFromPushNotification()` to detect this and skip its own login call. If you customize the login flow, preserve this check to avoid a double login.

### Xcode 26: `jsi.h` build error

If you see:
```
Cannot initialize a parameter of type 'char *' with an rvalue of type 'const value_type *' (aka 'const char *')
```
This is a known Xcode 26 issue with stricter C++ const-correctness in React Native's JSI headers. The config plugin automatically patches the Podfile to suppress this. Make sure you run `npx expo prebuild --clean` to apply the fix.

### Android: Push notifications not received

- Ensure `google-services.json` is placed in `android/app/` **before** running `npx expo prebuild --clean`
- Verify your FCM server key is uploaded to the [Telnyx Portal](https://portal.telnyx.com)
- Check that `AppFirebaseMessagingService` appears in `AndroidManifest.xml` (the config plugin generates this automatically)

### General: Changes not taking effect

If you modify `app.json`, the config plugin, or any native configuration:
1. Delete the generated native folders: `rm -rf ios android`
2. Regenerate: `npx expo prebuild --clean`
3. Rebuild: `npx expo run:ios` or `npx expo run:android`

Simply reloading Metro is not enough for native-level changes.

## Links

- [react-native-voice-commons SDK](https://github.com/team-telnyx/react-native-voice-commons)
- [Telnyx Portal](https://portal.telnyx.com)
- [Telnyx RTC Documentation](https://developers.telnyx.com/docs/voice/webrtc)
