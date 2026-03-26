const {
  withAppDelegate,
  withEntitlementsPlist,
  withMainActivity,
  withMainApplication,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── iOS: Add push notification entitlements ───
function withTelnyxEntitlements(config) {
  return withEntitlementsPlist(config, (mod) => {
    // Enable push notifications (required for PushKit VoIP token registration)
    mod.modResults['aps-environment'] = 'development';
    return mod;
  });
}

// ─── iOS: Modify AppDelegate.swift ───
function withTelnyxAppDelegate(config) {
  return withAppDelegate(config, (mod) => {
    let contents = mod.modResults.contents;

    // Add PushKit and TelnyxVoiceCommons imports
    if (!contents.includes('import PushKit')) {
      contents = contents.replace(
        'import React',
        'import React\nimport PushKit\nimport TelnyxVoiceCommons'
      );
    }

    // Add PKPushRegistryDelegate conformance
    if (!contents.includes('PKPushRegistryDelegate')) {
      contents = contents.replace(
        'class AppDelegate: ExpoAppDelegate {',
        'class AppDelegate: ExpoAppDelegate, PKPushRegistryDelegate {'
      );
    }

    // Add VoIP push initialization in didFinishLaunchingWithOptions
    if (!contents.includes('TelnyxVoipPushHandler.initializeVoipRegistration')) {
      contents = contents.replace(
        'let delegate = ReactNativeDelegate()',
        `TelnyxVoipPushHandler.initializeVoipRegistration()

    let delegate = ReactNativeDelegate()`
      );
    }

    // Add push registry delegate methods before the closing brace of AppDelegate
    if (!contents.includes('didUpdate pushCredentials')) {
      const delegateMethods = `
  // ── Telnyx VoIP Push ──

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    TelnyxVoipPushHandler.shared.handleVoipTokenUpdate(pushCredentials, type: type)
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    TelnyxVoipPushHandler.shared.handleVoipPush(payload, type: type, completion: completion)
  }
`;
      // Insert methods before the closing `}` of AppDelegate
      // The file has: `}\n\nclass ReactNativeDelegate` — insert before that `}`
      contents = contents.replace(
        '}\n\nclass ReactNativeDelegate',
        `${delegateMethods}}\n\nclass ReactNativeDelegate`
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
}

// ─── Android: Modify MainActivity.kt ───
function withTelnyxMainActivity(config) {
  return withMainActivity(config, (mod) => {
    let contents = mod.modResults.contents;

    // Replace ReactActivity import with TelnyxMainActivity
    if (!contents.includes('TelnyxMainActivity')) {
      contents = contents.replace(
        'import com.facebook.react.ReactActivity',
        'import com.facebook.react.ReactActivity\nimport com.telnyx.react_voice_commons.TelnyxMainActivity'
      );

      // Extend TelnyxMainActivity instead of ReactActivity
      contents = contents.replace(
        'class MainActivity : ReactActivity()',
        'class MainActivity : TelnyxMainActivity()'
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
}

// ─── Android: Modify MainApplication.kt ───
function withTelnyxMainApplication(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;

    // Add VoicePnBridgePackage import
    if (!contents.includes('VoicePnBridgePackage')) {
      contents = contents.replace(
        'import com.facebook.react.ReactPackage',
        'import com.facebook.react.ReactPackage\nimport com.telnyx.react_voice_commons.VoicePnBridgePackage'
      );

      // Add the package to the packages list
      contents = contents.replace(
        '// Packages that cannot be autolinked yet can be added manually here, for example:\n          // add(MyReactNativePackage())',
        '// Packages that cannot be autolinked yet can be added manually here, for example:\n          // add(MyReactNativePackage())\n          add(VoicePnBridgePackage())'
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
}

// ─── Android: Modify AndroidManifest.xml ───
function withTelnyxAndroidManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const app = manifest.manifest.application?.[0];
    if (!app) return mod;

    // Add Firebase messaging service
    const hasService = app.service?.some((s) =>
      s.$?.['android:name']?.includes('FirebaseMessagingService')
    );

    if (!hasService) {
      if (!app.service) app.service = [];
      app.service.push({
        $: {
          'android:name': '.AppFirebaseMessagingService',
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [
              {
                $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' },
              },
            ],
          },
        ],
      });
    }

    // Add notification action receiver
    const hasReceiver = app.receiver?.some((r) =>
      r.$?.['android:name']?.includes('NotificationActionReceiver')
    );

    if (!hasReceiver) {
      if (!app.receiver) app.receiver = [];
      app.receiver.push({
        $: {
          'android:name': '.AppNotificationActionReceiver',
          'android:exported': 'false',
        },
      });
    }

    mod.modResults = manifest;
    return mod;
  });
}

// ─── iOS: Patch Podfile for Xcode 26 compatibility ───
// Xcode 26 enforces stricter C++ const correctness, causing build errors
// in React Native's jsi.h. This adds a post_install hook to suppress the warning.
function withXcode26Fix(config) {
  return withDangerousMod(config, [
    'ios',
    (mod) => {
      const podfilePath = path.join(
        mod.modRequest.platformProjectRoot,
        'Podfile'
      );
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      const patch = `
  # ── Xcode 26 const-correctness fix for jsi.h ──
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['OTHER_CPLUSPLUSFLAGS'] ||= ['$(inherited)']
      config.build_settings['OTHER_CPLUSPLUSFLAGS'] << '-Wno-incompatible-pointer-types-discards-qualifiers'
    end
  end`;

      if (!podfile.includes('Wno-incompatible-pointer-types-discards-qualifiers')) {
        if (podfile.includes('post_install do |installer|')) {
          // Append inside existing post_install block
          podfile = podfile.replace(
            'post_install do |installer|',
            `post_install do |installer|${patch}`
          );
        } else {
          // Add a new post_install block at the end
          podfile += `\npost_install do |installer|${patch}\nend\n`;
        }
        fs.writeFileSync(podfilePath, podfile);
      }

      return mod;
    },
  ]);
}

// ─── Android: Generate required Kotlin stub files ───
function withTelnyxAndroidFiles(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const packageName =
        config.android?.package ??
        mod.config?.android?.package ??
        'com.telnyx.voicelite';
      const packagePath = packageName.replace(/\./g, '/');
      const srcDir = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        packagePath
      );

      // AppFirebaseMessagingService.kt
      const fcmFile = path.join(srcDir, 'AppFirebaseMessagingService.kt');
      if (!fs.existsSync(fcmFile)) {
        fs.writeFileSync(
          fcmFile,
          `package ${packageName}

import com.telnyx.react_voice_commons.TelnyxFirebaseMessagingService

class AppFirebaseMessagingService : TelnyxFirebaseMessagingService()
`
        );
      }

      // AppNotificationActionReceiver.kt
      const receiverFile = path.join(srcDir, 'AppNotificationActionReceiver.kt');
      if (!fs.existsSync(receiverFile)) {
        fs.writeFileSync(
          receiverFile,
          `package ${packageName}

import com.telnyx.react_voice_commons.TelnyxNotificationActionReceiver

class AppNotificationActionReceiver : TelnyxNotificationActionReceiver()
`
        );
      }

      return mod;
    },
  ]);
}

// ─── Combined plugin ───
function withTelnyxVoice(config) {
  config = withTelnyxEntitlements(config);
  config = withXcode26Fix(config);
  config = withTelnyxAppDelegate(config);
  config = withTelnyxMainActivity(config);
  config = withTelnyxMainApplication(config);
  config = withTelnyxAndroidManifest(config);
  config = withTelnyxAndroidFiles(config);
  return config;
}

module.exports = withTelnyxVoice;
