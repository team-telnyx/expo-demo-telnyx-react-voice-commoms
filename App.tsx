import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Image,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  TelnyxVoiceApp,
  TelnyxVoipClient,
  createTelnyxVoipClient,
  createCredentialConfig,
  createTokenConfig,
  TelnyxConnectionState,
  TelnyxCallState,
  type Call,
} from '@telnyx/react-voice-commons-sdk';
import { Subscription } from 'rxjs';
import VoipPushNotification from 'react-native-voip-push-notification';

// ── Authentication ──
// Set these in your .env file (see .env.example)
const SIP_USER = process.env.EXPO_PUBLIC_SIP_USER || '';
const SIP_PASS = process.env.EXPO_PUBLIC_SIP_PASS || '';
const SIP_TOKEN = process.env.EXPO_PUBLIC_SIP_TOKEN || '';

const getLoginConfig = (pushToken?: string) => {
  if (SIP_TOKEN) {
    return createTokenConfig(SIP_TOKEN, { debug: true, pushNotificationDeviceToken: pushToken });
  }
  return createCredentialConfig(SIP_USER, SIP_PASS, { debug: true, pushNotificationDeviceToken: pushToken });
};

// Create VoIP client at module scope (singleton, fast init)
const voipClient = createTelnyxVoipClient({
  enableAppStateManagement: true,
  debug: true,
});

function VoiceApp() {
  // Connection state
  const [connectionState, setConnectionState] = useState<TelnyxConnectionState>(
    TelnyxConnectionState.DISCONNECTED
  );

  // Call state
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callState, setCallState] = useState<TelnyxCallState | null>(null);
  const [callerName, setCallerName] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isHeld, setIsHeld] = useState(false);

  // Dialer
  const [destination, setDestination] = useState('');

  // Subscriptions ref
  const subsRef = useRef<Subscription[]>([]);

  // Register for VoIP push and auto-connect
  useEffect(() => {
    if (Platform.OS === 'ios') {
      let didLogin = false;

      VoipPushNotification.addEventListener('register', (token: string) => {
        console.log('VoIP push token:', token || '(empty)');

        // Skip login if app was launched from a push notification (SDK handles it)
        TelnyxVoipClient.isLaunchedFromPushNotification().then((isFromPush) => {
          if (isFromPush) {
            console.log('Launched from push — skipping login to avoid double login');
            return;
          }
          if (didLogin) return;
          didLogin = true;

          if (token) {
            voipClient.login(getLoginConfig(token));
          } else {
            console.warn(
              'VoIP push token is empty — logging in without push support. ' +
              'Incoming calls via push will not work. ' +
              'Ensure you have a VoIP Push Certificate and are running on a physical device.'
            );
            voipClient.login(getLoginConfig());
          }
        });
      });

      VoipPushNotification.addEventListener('notification', (notification: any) => {
        console.log('VoIP push notification received:', notification);
        VoipPushNotification.onVoipNotificationCompleted(notification.uuid);
      });

      VoipPushNotification.registerVoipToken();
    } else {
      // Android: login directly (FCM token is handled by the SDK)
      voipClient.login(getLoginConfig());
    }

    return () => {
      if (Platform.OS === 'ios') {
        VoipPushNotification.removeEventListener('register');
        VoipPushNotification.removeEventListener('notification');
      }
    };
  }, []);

  // Subscribe to connection state
  useEffect(() => {
    const sub = voipClient.connectionState$.subscribe((state) => {
      setConnectionState(state);
    });
    subsRef.current.push(sub);
    return () => sub.unsubscribe();
  }, []);

  // Subscribe to active call
  useEffect(() => {
    const sub = voipClient.activeCall$.subscribe((call) => {
      setActiveCall(call);
      if (!call) {
        setCallState(null);
        setCallerName('');
        setIsMuted(false);
        setIsHeld(false);
      }
    });
    subsRef.current.push(sub);
    return () => sub.unsubscribe();
  }, []);

  // Subscribe to call state changes
  useEffect(() => {
    if (!activeCall) return;

    const sub = activeCall.callState$.subscribe((state) => {
      setCallState(state);
    });

    // Get caller info
    if (activeCall.isIncoming) {
      setCallerName(
        activeCall._originalCallerName || activeCall._originalCallerNumber || 'Unknown'
      );
    }

    return () => sub.unsubscribe();
  }, [activeCall]);

  // Reconnect
  const handleReconnect = useCallback(() => {
    voipClient.login(getLoginConfig());
  }, []);

  // Disconnect
  const handleDisconnect = useCallback(() => {
    voipClient.disconnect();
  }, []);

  // Make call
  const handleCall = useCallback(async () => {
    if (!destination) return;
    await voipClient.newCall(destination);
    setDestination('');
  }, [destination]);

  // Answer
  const handleAnswer = useCallback(async () => {
    if (activeCall) await activeCall.answer();
  }, [activeCall]);

  // Hangup
  const handleHangup = useCallback(async () => {
    if (activeCall) await activeCall.hangup();
  }, [activeCall]);

  // Mute toggle
  const handleMute = useCallback(async () => {
    if (activeCall) {
      await activeCall.mute();
      setIsMuted((prev) => !prev);
    }
  }, [activeCall]);

  // Hold toggle
  const handleHold = useCallback(async () => {
    if (activeCall) {
      await activeCall.hold();
      setIsHeld((prev) => !prev);
    }
  }, [activeCall]);

  const isConnected = connectionState === TelnyxConnectionState.CONNECTED;
  const hasActiveCall = activeCall && callState && callState !== TelnyxCallState.ENDED;
  const isRinging = callState === TelnyxCallState.RINGING && activeCall?.isIncoming;
  const isCallActive =
    callState === TelnyxCallState.ACTIVE || callState === TelnyxCallState.HELD;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {/* Header */}
          <Image
            source={require('./assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Voice Lite</Text>

          {/* Connection State */}
          <View style={styles.stateCard}>
            <Text style={styles.stateLabel}>Connection</Text>
            <View style={styles.stateRow}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: isConnected
                      ? '#34C759'
                      : connectionState === TelnyxConnectionState.CONNECTING ||
                          connectionState === TelnyxConnectionState.RECONNECTING
                        ? '#FF9500'
                        : connectionState === TelnyxConnectionState.ERROR
                          ? '#FF3B30'
                          : '#8E8E93',
                  },
                ]}
              />
              <Text style={styles.stateValue}>{connectionState}</Text>
            </View>
          </View>

          {/* Call State */}
          {hasActiveCall && (
            <View style={styles.stateCard}>
              <Text style={styles.stateLabel}>Call</Text>
              {callerName ? (
                <Text style={styles.callerName}>{callerName}</Text>
              ) : null}
              <View style={styles.stateRow}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        callState === TelnyxCallState.ACTIVE
                          ? '#34C759'
                          : callState === TelnyxCallState.RINGING
                            ? '#FF9500'
                            : callState === TelnyxCallState.CONNECTING
                              ? '#FFD60A'
                              : callState === TelnyxCallState.HELD
                                ? '#5856D6'
                                : '#FF3B30',
                    },
                  ]}
                />
                <Text style={styles.stateValue}>{callState}</Text>
              </View>

              {/* Call Controls */}
              <View style={styles.callControls}>
                {isRinging && (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGreen]}
                    onPress={handleAnswer}
                  >
                    <Text style={styles.btnText}>Answer</Text>
                  </TouchableOpacity>
                )}
                {isCallActive && (
                  <>
                    <TouchableOpacity
                      style={[styles.btn, isMuted ? styles.btnActive : styles.btnGray]}
                      onPress={handleMute}
                    >
                      <Text style={styles.btnText}>
                        {isMuted ? 'Unmute' : 'Mute'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, isHeld ? styles.btnActive : styles.btnGray]}
                      onPress={handleHold}
                    >
                      <Text style={styles.btnText}>
                        {isHeld ? 'Resume' : 'Hold'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity
                  style={[styles.btn, styles.btnRed]}
                  onPress={handleHangup}
                >
                  <Text style={styles.btnText}>Hangup</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Reconnect when disconnected */}
          {connectionState === TelnyxConnectionState.DISCONNECTED && (
            <TouchableOpacity
              style={[styles.btn, styles.btnGreen, { marginBottom: 16 }]}
              onPress={handleReconnect}
            >
              <Text style={styles.btnText}>Reconnect</Text>
            </TouchableOpacity>
          )}

          {/* Dialer */}
          {isConnected && !hasActiveCall && (
            <View style={styles.stateCard}>
              <Text style={styles.stateLabel}>Dial</Text>
              <TextInput
                style={styles.input}
                placeholder="Phone number or SIP URI"
                value={destination}
                onChangeText={setDestination}
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.btn, styles.btnGreen]}
                onPress={handleCall}
              >
                <Text style={styles.btnText}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnGray, { marginTop: 8 }]}
                onPress={handleDisconnect}
              >
                <Text style={styles.btnText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <TelnyxVoiceApp voipClient={voipClient} enableAutoReconnect={false} debug>
      <VoiceApp />
    </TelnyxVoiceApp>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  content: {
    padding: 20,
    paddingTop: 40,
  },
  logo: {
    width: 140,
    height: 40,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 20,
  },
  stateCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  stateLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stateValue: {
    fontSize: 17,
    fontWeight: '500',
    color: '#000',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  callerName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  callControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 10,
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    minWidth: 80,
  },
  btnGreen: { backgroundColor: '#34C759' },
  btnRed: { backgroundColor: '#FF3B30' },
  btnGray: { backgroundColor: '#E5E5EA' },
  btnActive: { backgroundColor: '#5856D6' },
  btnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
});
