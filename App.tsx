import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  ImageBackground,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { DEFAULT_APP_CONTENT } from './src/data/content';
import {
  getNotificationAccessState,
  getPushRegistrationSnapshot,
  openAppNotificationSettings,
} from './src/services/notifications';
import {
  recordCurrentAppOpen,
  registerCurrentDevice,
} from './src/services/customerActivity';
import {
  getDefaultContentState,
  getStartupContentState,
  refreshRemoteContent,
} from './src/services/remoteContent';
import { openChat, openPhoneDialer, openWebsite } from './src/services/chat';
import type { ContentState } from './src/types/content';

type NotificationGateState = {
  status: 'checking' | 'granted' | 'blocked';
  message: string;
  requiresSettings: boolean;
};

type PrimaryActionButtonProps = {
  label: string;
  caption: string;
  onPress: () => void;
  primary?: boolean;
};

const FOREGROUND_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const APP_OPEN_COOLDOWN_MS = 60 * 1000;
const DEVICE_REGISTRATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function PrimaryActionButton({
  label,
  caption,
  onPress,
  primary = false,
}: PrimaryActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary ? styles.actionButtonPrimary : styles.actionButtonSecondary,
        pressed && styles.actionButtonPressed,
      ]}
    >
      <Text
        style={[
          styles.actionButtonLabel,
          primary ? styles.actionButtonLabelPrimary : styles.actionButtonLabelSecondary,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.actionButtonCaption,
          primary ? styles.actionButtonCaptionPrimary : styles.actionButtonCaptionSecondary,
        ]}
      >
        {caption}
      </Text>
    </Pressable>
  );
}

function formatSyncTime(value: string | null) {
  if (!value) {
    return '아직 동기화 기록이 없습니다.';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getSourceLabel(source: ContentState['source']) {
  switch (source) {
    case 'remote':
      return '실시간 내용';
    case 'cache':
      return '최근 저장본';
    default:
      return '기본 내용';
  }
}

export default function App() {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [contentState, setContentState] = useState<ContentState>(() =>
    getDefaultContentState(),
  );
  const [notificationGate, setNotificationGate] = useState<NotificationGateState>({
    status: 'checking',
    message: '알림 권한을 확인하는 중입니다.',
    requiresSettings: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const lastRemoteCheckAtRef = useRef(0);
  const lastAppOpenTrackedAtRef = useRef(0);
  const lastDeviceRegistrationAtRef = useRef(0);
  const hasBootstrappedContentRef = useRef(false);

  const content = contentState.content ?? DEFAULT_APP_CONTENT;
  const latestPushTemplate = content.pushCampaigns[0] ?? null;

  const runRemoteRefresh = async (force: boolean) => {
    const now = Date.now();

    if (!force && now - lastRemoteCheckAtRef.current < FOREGROUND_REFRESH_COOLDOWN_MS) {
      return null;
    }

    lastRemoteCheckAtRef.current = now;
    return await refreshRemoteContent();
  };

  const bootstrapContent = async () => {
    if (hasBootstrappedContentRef.current) {
      return;
    }

    hasBootstrappedContentRef.current = true;

    const startupState = await getStartupContentState();
    setContentState(startupState);

    const refreshedState = await runRemoteRefresh(true);
    if (refreshedState) {
      setContentState(refreshedState);
    }
  };

  const syncCustomerActivity = async (source: 'launch' | 'foreground') => {
    const now = Date.now();
    const shouldRegisterDevice =
      now - lastDeviceRegistrationAtRef.current >= DEVICE_REGISTRATION_COOLDOWN_MS;
    const shouldRecordAppOpen =
      source === 'launch' || now - lastAppOpenTrackedAtRef.current >= APP_OPEN_COOLDOWN_MS;

    if (!shouldRegisterDevice && !shouldRecordAppOpen) {
      return;
    }

    try {
      if (shouldRegisterDevice) {
        const pushRegistration = await getPushRegistrationSnapshot().catch(() => ({
          expoPushToken: null,
          projectId: null,
          permissionGranted: false,
        }));

        if (pushRegistration.projectId) {
          await registerCurrentDevice();
          lastDeviceRegistrationAtRef.current = now;
        }
      }

      if (shouldRecordAppOpen) {
        await recordCurrentAppOpen(source);
        lastAppOpenTrackedAtRef.current = now;
      }
    } catch (error) {
      console.error('Failed to sync customer activity', error);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const applyNotificationGate = async (options?: {
      autoPromptOnce?: boolean;
      requestIfPossible?: boolean;
    }) => {
      const accessState = await getNotificationAccessState({
        autoPromptOnce: options?.autoPromptOnce,
        requestIfPossible: options?.requestIfPossible,
      });

      if (!isMounted) {
        return accessState;
      }

      setNotificationGate({
        status: accessState.granted ? 'granted' : 'blocked',
        message: accessState.message,
        requiresSettings: accessState.requiresSettings,
      });

      return accessState;
    };

    const bootstrap = async () => {
      const accessState = await applyNotificationGate({
        autoPromptOnce: true,
      });

      if (!accessState?.granted) {
        return;
      }

      await bootstrapContent();
      await syncCustomerActivity('launch');
    };

    void bootstrap();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      void (async () => {
        const accessState = await applyNotificationGate();

        if (!accessState?.granted) {
          return;
        }

        if (!hasBootstrappedContentRef.current) {
          await bootstrapContent();
          await syncCustomerActivity('launch');
          return;
        }

        const nextContentState = await runRemoteRefresh(false);
        if (nextContentState) {
          setContentState(nextContentState);
        }

        await syncCustomerActivity('foreground');
      })();
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const handleChatPress = async () => {
    await openChat(content.business.channelTalkUrl);
  };

  const handleWebsitePress = async () => {
    await openWebsite(content.business.detailPageUrl);
  };

  const handleCallPress = async () => {
    await openPhoneDialer(content.business.phoneNumber);
  };

  const handleNotificationGateRequest = async () => {
    const accessState = await getNotificationAccessState({
      requestIfPossible: true,
    });

    setNotificationGate({
      status: accessState.granted ? 'granted' : 'blocked',
      message: accessState.message,
      requiresSettings: accessState.requiresSettings,
    });

    if (accessState.granted) {
      await bootstrapContent();
    }
  };

  const handleNotificationGateCheck = async () => {
    const accessState = await getNotificationAccessState();

    setNotificationGate({
      status: accessState.granted ? 'granted' : 'blocked',
      message: accessState.message,
      requiresSettings: accessState.requiresSettings,
    });

    if (accessState.granted) {
      await bootstrapContent();
    }
  };

  const handleNotificationGateSettings = async () => {
    await openAppNotificationSettings();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const refreshedState = await runRemoteRefresh(true);
      if (refreshedState) {
        setContentState(refreshedState);
      }
    } finally {
      setRefreshing(false);
    }
  };

  if (notificationGate.status !== 'granted') {
    const isCheckingPermission = notificationGate.status === 'checking';

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.permissionScreen}>
          <LinearGradient
            colors={['#FFFFFF', '#F6FAFF', '#E9F1FF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.permissionCard}
          >
            <Text style={styles.permissionEyebrow}>Push Required</Text>
            <Text style={styles.permissionTitle}>알림 허용 후 이용 가능합니다</Text>
            <Text style={styles.permissionBody}>{notificationGate.message}</Text>

            <View style={styles.permissionButtonStack}>
              {!isCheckingPermission && !notificationGate.requiresSettings ? (
                <Pressable
                  style={[styles.permissionButton, styles.permissionButtonPrimary]}
                  onPress={handleNotificationGateRequest}
                >
                  <Text style={styles.permissionButtonPrimaryLabel}>알림 허용하기</Text>
                </Pressable>
              ) : null}

              {!isCheckingPermission && notificationGate.requiresSettings ? (
                <Pressable
                  style={[styles.permissionButton, styles.permissionButtonPrimary]}
                  onPress={handleNotificationGateSettings}
                >
                  <Text style={styles.permissionButtonPrimaryLabel}>설정 열기</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={[styles.permissionButton, styles.permissionButtonGhost]}
                onPress={handleNotificationGateCheck}
              >
                <Text style={styles.permissionButtonGhostLabel}>
                  {isCheckingPermission ? '권한 확인 중...' : '다시 확인'}
                </Text>
              </Pressable>
            </View>
          </LinearGradient>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#2563EB" />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroBadge}>SOAEK BANK</Text>
            <Text style={styles.heroMeta}>
              {getSourceLabel(contentState.source)} · {formatSyncTime(contentState.syncedAt)}
            </Text>
          </View>
          <Text style={styles.heroTitle}>{content.business.brandName}</Text>
          <Text style={styles.heroBody}>
            상세 이미지를 보고 바로 상담으로 이어지는 단순한 구조로 구성했습니다.
          </Text>

          <View style={[styles.actionGrid, isWide && styles.actionGridWide]}>
            <PrimaryActionButton
              label="상담하기"
              caption="채널톡 바로 연결"
              onPress={handleChatPress}
              primary
            />
            <PrimaryActionButton
              label="상세 보기"
              caption="안내 링크 열기"
              onPress={handleWebsitePress}
            />
            <PrimaryActionButton
              label="전화 문의"
              caption={content.business.phoneNumber}
              onPress={handleCallPress}
            />
          </View>
        </View>

        {latestPushTemplate ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeEyebrow}>알림 예시</Text>
            <Text style={styles.noticeTitle}>{latestPushTemplate.title}</Text>
            <Text style={styles.noticeBody}>{latestPushTemplate.message}</Text>
          </View>
        ) : null}

        <View style={styles.storySection}>
          {content.detailPanels.map((panel, index) => (
            <ImageBackground
              key={`${panel.title}-${index}`}
              source={{ uri: panel.imageUrl }}
              imageStyle={styles.storyImage}
              style={styles.storyCard}
            >
              <LinearGradient
                colors={['rgba(15, 23, 42, 0.08)', 'rgba(15, 23, 42, 0.82)']}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.storyOverlay}
              >
                <Text style={styles.storyEyebrow}>{panel.eyebrow}</Text>
                <Text style={styles.storyTitle}>{panel.title}</Text>
                <Text style={styles.storyBody}>{panel.description}</Text>
              </LinearGradient>
            </ImageBackground>
          ))}
        </View>

        <View style={styles.contactCard}>
          <Text style={styles.contactEyebrow}>Quick Contact</Text>
          <Text style={styles.contactTitle}>바로 연결</Text>
          <Text style={styles.contactPhone}>{content.business.phoneNumber}</Text>
          <Text style={styles.contactBody}>
            링크 확인 후 바로 상담하거나 전화로 이어질 수 있게 구성했습니다.
          </Text>

          <View style={styles.contactButtonRow}>
            <Pressable style={styles.inlinePrimaryButton} onPress={handleChatPress}>
              <Text style={styles.inlinePrimaryButtonLabel}>상담 열기</Text>
            </Pressable>
            <Pressable style={styles.inlineGhostButton} onPress={handleWebsitePress}>
              <Text style={styles.inlineGhostButtonLabel}>상세 링크</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Pressable style={styles.floatingChatButton} onPress={handleChatPress}>
        <Text style={styles.floatingChatLabel}>상담</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFF',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F7FAFF',
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 104,
    gap: 14,
  },
  permissionScreen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  permissionCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#D7E6FF',
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 12,
  },
  permissionEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#2563EB',
  },
  permissionTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    color: '#0F172A',
  },
  permissionBody: {
    fontSize: 15,
    lineHeight: 24,
    color: '#475569',
  },
  permissionButtonStack: {
    marginTop: 8,
    gap: 10,
  },
  permissionButton: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionButtonPrimary: {
    backgroundColor: '#2563EB',
  },
  permissionButtonPrimaryLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  permissionButtonGhost: {
    borderWidth: 1,
    borderColor: '#C7D9F7',
    backgroundColor: '#FFFFFF',
  },
  permissionButtonGhostLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  heroCard: {
    borderRadius: 32,
    paddingHorizontal: 20,
    paddingVertical: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9E8FF',
    gap: 14,
  },
  heroTopRow: {
    gap: 6,
  },
  heroBadge: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#2563EB',
  },
  heroMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748B',
  },
  heroTitle: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '900',
    color: '#0F172A',
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 24,
    color: '#475569',
  },
  actionGrid: {
    gap: 10,
  },
  actionGridWide: {
    flexDirection: 'row',
  },
  actionButton: {
    flex: 1,
    minHeight: 94,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    justifyContent: 'space-between',
  },
  actionButtonPrimary: {
    backgroundColor: '#2563EB',
  },
  actionButtonSecondary: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#CFE1FF',
  },
  actionButtonPressed: {
    opacity: 0.88,
  },
  actionButtonLabel: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },
  actionButtonLabelPrimary: {
    color: '#FFFFFF',
  },
  actionButtonLabelSecondary: {
    color: '#0F172A',
  },
  actionButtonCaption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  actionButtonCaptionPrimary: {
    color: 'rgba(255,255,255,0.84)',
  },
  actionButtonCaptionSecondary: {
    color: '#475569',
  },
  noticeCard: {
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#EEF5FF',
    borderWidth: 1,
    borderColor: '#CFE0FF',
    gap: 8,
  },
  noticeEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#2563EB',
  },
  noticeTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
    color: '#0F172A',
  },
  noticeBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  storySection: {
    gap: 14,
  },
  storyCard: {
    minHeight: 330,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#DCEBFF',
  },
  storyImage: {
    borderRadius: 30,
  },
  storyOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 22,
    gap: 8,
  },
  storyEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: '#E2E8F0',
  },
  storyTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  storyBody: {
    fontSize: 15,
    lineHeight: 23,
    color: 'rgba(255,255,255,0.88)',
  },
  contactCard: {
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9E8FF',
    gap: 10,
  },
  contactEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: '#2563EB',
  },
  contactTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '900',
    color: '#0F172A',
  },
  contactPhone: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    color: '#1D4ED8',
  },
  contactBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  contactButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  inlinePrimaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlinePrimaryButtonLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  inlineGhostButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CFE1FF',
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineGhostButtonLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: '#1E3A8A',
  },
  floatingChatButton: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    minWidth: 74,
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 10,
    },
    elevation: 8,
  },
  floatingChatLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
});
