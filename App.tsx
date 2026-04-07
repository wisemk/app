import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
  openAppNotificationSettings,
  requestPushPermissionStatus,
} from './src/services/notifications';
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

type HomeActionCardProps = {
  label: string;
  caption: string;
  onPress: () => void;
  tone: 'primary' | 'secondary' | 'ghost';
  featured?: boolean;
};

type LandingSectionHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  inverse?: boolean;
};

function formatSyncTime(value: string | null) {
  if (!value) {
    return '방금 설치했거나 아직 동기화 기록이 없습니다.';
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
      return '실시간 최신 내용';
    case 'cache':
      return '최근 저장된 내용';
    default:
      return '기본 내용';
  }
}

function HomeActionCard({
  label,
  caption,
  onPress,
  tone,
  featured = false,
}: HomeActionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionCard,
        tone === 'primary' && styles.actionPrimary,
        tone === 'secondary' && styles.actionSecondary,
        tone === 'ghost' && styles.actionGhost,
        featured && styles.actionFeatured,
        pressed && styles.actionPressed,
      ]}
    >
      <View style={styles.actionTextGroup}>
        <Text
          style={[
            styles.actionLabel,
            tone === 'primary' && styles.actionLabelPrimary,
            tone !== 'primary' && styles.actionLabelDark,
          ]}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.actionCaption,
            tone === 'primary' && styles.actionCaptionPrimary,
            tone !== 'primary' && styles.actionCaptionDark,
          ]}
        >
          {caption}
        </Text>
      </View>
      <View
        style={[
          styles.actionArrow,
          tone === 'primary' ? styles.actionArrowPrimary : styles.actionArrowLight,
        ]}
      >
        <Text
          style={[
            styles.actionArrowLabel,
            tone === 'primary' ? styles.actionArrowLabelPrimary : styles.actionArrowLabelDark,
          ]}
        >
          →
        </Text>
      </View>
    </Pressable>
  );
}

function LandingSectionHeader({
  eyebrow,
  title,
  description,
  inverse = false,
}: LandingSectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionEyebrow, inverse && styles.sectionEyebrowInverse]}>
        {eyebrow}
      </Text>
      <Text style={[styles.sectionTitle, inverse && styles.sectionTitleInverse]}>{title}</Text>
      <Text
        style={[styles.sectionDescription, inverse && styles.sectionDescriptionInverse]}
      >
        {description}
      </Text>
    </View>
  );
}

const FOREGROUND_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export default function App() {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [contentState, setContentState] = useState<ContentState>(() =>
    getDefaultContentState(),
  );
  const [pushStatusMessage, setPushStatusMessage] = useState(
    '알림 권한은 아직 확인하지 않았습니다.',
  );
  const [notificationGate, setNotificationGate] = useState<NotificationGateState>({
    status: 'checking',
    message: '알림 권한을 확인하는 중입니다.',
    requiresSettings: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const lastRemoteCheckAtRef = useRef(0);
  const hasBootstrappedContentRef = useRef(false);

  const content = contentState.content ?? DEFAULT_APP_CONTENT;

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

  useEffect(() => {
    let isMounted = true;

    const applyState = (nextState: ContentState) => {
      if (!isMounted) {
        return;
      }

      setContentState(nextState);
    };

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
          return;
        }

        const nextContentState = await runRemoteRefresh(false);
        if (nextContentState) {
          applyState(nextContentState);
        }
      })();
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const lastCampaign = useMemo(
    () => content.pushCampaigns[content.pushCampaigns.length - 1]?.message ?? '',
    [content.pushCampaigns],
  );

  const handleChatPress = async () => {
    await openChat(content.business.channelTalkUrl);
  };

  const handleWebsitePress = async () => {
    await openWebsite(content.business.detailPageUrl);
  };

  const handleCallPress = async () => {
    await openPhoneDialer(content.business.phoneNumber);
  };

  const handlePushPress = async () => {
    const result = await requestPushPermissionStatus();
    setPushStatusMessage(result);
    Alert.alert('알림 상태 확인', result);
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
        <View style={styles.permissionGateScreen}>
          <LinearGradient
            colors={['#FFFFFF', '#F5F9FF', '#EAF2FF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.permissionGateCard}
          >
            <View style={styles.permissionGateBadge}>
              <Text style={styles.permissionGateBadgeText}>Push Required</Text>
            </View>
            <Text style={styles.permissionGateTitle}>알림 허용이 필요합니다</Text>
            <Text style={styles.permissionGateBody}>{notificationGate.message}</Text>

            <View style={styles.permissionGatePanel}>
              <Text style={styles.permissionGatePanelTitle}>왜 필요한가요?</Text>
              <Text style={styles.permissionGatePanelBody}>
                월말/월초 재방문 알림을 보내려면 최초 1회 알림 권한 허용이 필요합니다.
              </Text>
            </View>

            {isCheckingPermission ? (
              <View style={styles.permissionGateActions}>
                <View style={styles.permissionGateDisabledButton}>
                  <Text style={styles.permissionGateDisabledLabel}>권한 확인 중...</Text>
                </View>
              </View>
            ) : (
              <View style={styles.permissionGateActions}>
                <Pressable
                  style={styles.permissionGatePrimaryButton}
                  onPress={
                    notificationGate.requiresSettings
                      ? handleNotificationGateSettings
                      : handleNotificationGateRequest
                  }
                >
                  <Text style={styles.permissionGatePrimaryLabel}>
                    {notificationGate.requiresSettings ? '설정 열기' : '권한 요청'}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.permissionGateSecondaryButton}
                  onPress={handleNotificationGateCheck}
                >
                  <Text style={styles.permissionGateSecondaryLabel}>다시 확인</Text>
                </Pressable>
              </View>
            )}
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#2563EB"
          />
        }
      >
        <LinearGradient
          colors={['#FFFFFF', '#F5F9FF', '#EAF2FF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroGlowPrimary} />
          <View style={styles.heroGlowSecondary} />

          <View style={styles.heroUtilityRow}>
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>
                {getSourceLabel(contentState.source)} · {formatSyncTime(contentState.syncedAt)}
              </Text>
            </View>
            <Pressable style={styles.refreshChip} onPress={handleRefresh}>
              <Text style={styles.refreshChipLabel}>당겨서 새로고침</Text>
            </Pressable>
          </View>

          <View style={styles.heroBadgeRow}>
            {content.home.badges.map((badge) => (
              <Text key={badge} style={styles.heroBadge}>
                {badge}
              </Text>
            ))}
          </View>

          <Text style={styles.heroEyebrow}>모바일 상품권 매입 전문</Text>
          <Text style={styles.heroTitle}>{content.home.title}</Text>
          <Text style={styles.heroSubtitle}>{content.home.subtitle}</Text>

          <View style={[styles.heroInfoRow, isWide && styles.heroInfoRowWide]}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>전화 문의</Text>
              <Text style={styles.infoValue}>{content.business.phoneNumber}</Text>
            </View>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>운영 시간</Text>
              <Text style={styles.infoValue}>{content.business.businessHours}</Text>
            </View>
          </View>

          <View style={styles.heroActionStack}>
            <HomeActionCard
              label={content.primaryActions.chat.label}
              caption={content.primaryActions.chat.caption}
              onPress={handleChatPress}
              tone="primary"
              featured
            />
            <View style={[styles.secondaryActionRow, isWide && styles.secondaryActionRowWide]}>
              <HomeActionCard
                label={content.primaryActions.detail.label}
                caption={content.primaryActions.detail.caption}
                onPress={handleWebsitePress}
                tone="secondary"
              />
              <HomeActionCard
                label={content.primaryActions.call.label}
                caption={content.business.phoneNumber}
                onPress={handleCallPress}
                tone="ghost"
              />
            </View>
          </View>
        </LinearGradient>

        <View style={[styles.benefitGrid, isWide && styles.benefitGridWide]}>
          {content.benefits.map((item) => (
            <View key={item.title} style={[styles.benefitCard, isWide && styles.benefitCardWide]}>
              <Text style={styles.benefitHighlight}>{item.highlight}</Text>
              <Text style={styles.benefitTitle}>{item.title}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <LandingSectionHeader
            eyebrow={content.sections.detail.eyebrow}
            title={content.sections.detail.title}
            description={content.sections.detail.description}
          />

          <View style={styles.detailLeadCard}>
            <View style={styles.detailLeadText}>
              <Text style={styles.detailLeadTitle}>처음 보는 고객도 바로 이해할 수 있게</Text>
              <Text style={styles.detailLeadBody}>
                복잡한 설명보다 상세 이미지와 바로 문의 버튼을 먼저 보여주는 구조로
                바꿨습니다. 보고 바로 문의하고, 다시 들어와도 앱 하나로 끝나는 흐름에
                집중했습니다.
              </Text>
            </View>
            <View style={styles.detailLeadActions}>
              <Pressable style={styles.inlineActionPrimary} onPress={handleWebsitePress}>
                <Text style={styles.inlineActionPrimaryLabel}>상세 페이지 열기</Text>
              </Pressable>
              <Pressable style={styles.inlineActionGhost} onPress={handleChatPress}>
                <Text style={styles.inlineActionGhostLabel}>상담으로 바로 이동</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.storyColumn}>
            {content.detailPanels.map((panel, index) => (
              <ImageBackground
                key={panel.title}
                source={{ uri: panel.imageUrl }}
                imageStyle={styles.storyImage}
                style={[styles.storyCard, index === 0 && styles.storyCardFeatured]}
              >
                <LinearGradient
                  colors={['rgba(37, 99, 235, 0.10)', 'rgba(15, 23, 42, 0.88)']}
                  style={styles.storyOverlay}
                >
                  <Text style={styles.storyEyebrow}>{panel.eyebrow}</Text>
                  <Text style={styles.storyTitle}>{panel.title}</Text>
                  <Text style={styles.storyBody}>{panel.description}</Text>
                </LinearGradient>
              </ImageBackground>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <LandingSectionHeader
            eyebrow={content.sections.retention.eyebrow}
            title={content.sections.retention.title}
            description={content.sections.retention.description}
          />

          <View style={styles.flowColumn}>
            {content.reminderFlow.map((item, index) => (
              <View key={item.title} style={styles.flowCard}>
                <View style={styles.flowLine} />
                <View style={styles.flowIndex}>
                  <Text style={styles.flowIndexText}>{index + 1}</Text>
                </View>
                <View style={styles.flowTextArea}>
                  <Text style={styles.flowTitle}>{item.title}</Text>
                  <Text style={styles.flowBody}>{item.description}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <LinearGradient
          colors={['#1E3A8A', '#172554']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pushSection}
        >
          <LandingSectionHeader
            eyebrow={content.sections.push.eyebrow}
            title={content.sections.push.title}
            description={content.sections.push.description}
            inverse
          />

          <View style={styles.pushList}>
            {content.pushCampaigns.map((campaign) => (
              <View key={campaign.title} style={styles.pushRow}>
                <View style={styles.pushDot} />
                <View style={styles.pushTextArea}>
                  <Text style={styles.pushTitle}>{campaign.title}</Text>
                  <Text style={styles.pushBody}>{campaign.message}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.pushFooter}>
            <Pressable style={styles.permissionButton} onPress={handlePushPress}>
              <Text style={styles.permissionButtonText}>알림 상태 확인</Text>
            </Pressable>
            <Text style={styles.permissionHelper}>{pushStatusMessage}</Text>
            <Text style={styles.permissionHint}>최근 제안 문구: {lastCampaign}</Text>
          </View>
        </LinearGradient>

        <View style={styles.section}>
          <LandingSectionHeader
            eyebrow={content.sections.support.eyebrow}
            title={content.sections.support.title}
            description={content.sections.support.description}
          />

          <View style={[styles.supportGrid, isWide && styles.supportGridWide]}>
            <View style={styles.supportCardLarge}>
              <Text style={styles.supportBrand}>{content.business.brandName}</Text>
              <Text style={styles.supportHours}>운영시간 {content.business.businessHours}</Text>
              <Text style={styles.supportBody}>{content.support.body}</Text>
              <View style={styles.supportButtonStack}>
                <Pressable style={styles.inlineActionPrimary} onPress={handleChatPress}>
                  <Text style={styles.inlineActionPrimaryLabel}>
                    {content.support.chatButtonLabel}
                  </Text>
                </Pressable>
                <Pressable style={styles.inlineActionGhost} onPress={handleCallPress}>
                  <Text style={styles.inlineActionGhostLabel}>
                    {content.support.phoneButtonLabel}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.supportCardCompact}>
              <Text style={styles.supportCompactEyebrow}>Quick Contact</Text>
              <Text style={styles.supportCompactTitle}>앱으로 다시 오면 바로 이어집니다</Text>
              <Text style={styles.supportCompactBody}>
                상세 페이지 확인, 상담 연결, 전화 문의까지 한 화면에서 빠르게 이어지게
                잡아둔 구조입니다.
              </Text>
              <Text style={styles.supportCompactMeta}>
                현재 반영 상태 · {getSourceLabel(contentState.source)}
              </Text>
              <Text style={styles.supportCompactMeta}>
                최근 동기화 · {formatSyncTime(contentState.syncedAt)}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <Pressable style={styles.floatingChatButton} onPress={handleChatPress}>
        <Text style={styles.floatingChatOverline}>바로 상담</Text>
        <Text style={styles.floatingChatLabel}>채팅</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 132,
    gap: 26,
  },
  heroCard: {
    overflow: 'hidden',
    borderRadius: 32,
    paddingHorizontal: 20,
    paddingVertical: 22,
    gap: 18,
    borderWidth: 1,
    borderColor: '#D7E6FF',
    position: 'relative',
  },
  heroGlowPrimary: {
    position: 'absolute',
    top: -48,
    right: -24,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(96, 165, 250, 0.18)',
  },
  heroGlowSecondary: {
    position: 'absolute',
    bottom: -32,
    left: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(147, 197, 253, 0.18)',
  },
  heroUtilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  liveBadge: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#D7E6FF',
  },
  liveBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  refreshChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  refreshChipLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '800',
  },
  heroEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#2563EB',
  },
  heroTitle: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '900',
    color: '#0F172A',
  },
  heroSubtitle: {
    maxWidth: 540,
    fontSize: 15,
    lineHeight: 24,
    color: '#475569',
  },
  heroInfoRow: {
    gap: 12,
  },
  heroInfoRowWide: {
    flexDirection: 'row',
  },
  infoCard: {
    flex: 1,
    minHeight: 92,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E6FF',
    justifyContent: 'space-between',
    gap: 8,
  },
  infoLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#2563EB',
  },
  infoValue: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    color: '#0F172A',
  },
  heroActionStack: {
    gap: 12,
  },
  secondaryActionRow: {
    gap: 12,
  },
  secondaryActionRowWide: {
    flexDirection: 'row',
  },
  actionCard: {
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    minHeight: 108,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  actionFeatured: {
    minHeight: 124,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  actionPrimary: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  actionSecondary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D7E6FF',
  },
  actionGhost: {
    backgroundColor: '#F8FBFF',
    borderColor: '#D7E6FF',
  },
  actionPressed: {
    opacity: 0.88,
  },
  actionTextGroup: {
    flex: 1,
    gap: 5,
  },
  actionLabel: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },
  actionLabelPrimary: {
    color: '#FFFFFF',
  },
  actionLabelDark: {
    color: '#0F172A',
  },
  actionCaption: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  actionCaptionPrimary: {
    color: '#DBEAFE',
  },
  actionCaptionDark: {
    color: '#475569',
  },
  actionArrow: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionArrowPrimary: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  actionArrowLight: {
    backgroundColor: '#DBEAFE',
  },
  actionArrowLabel: {
    fontSize: 18,
    fontWeight: '900',
  },
  actionArrowLabelPrimary: {
    color: '#FFFFFF',
  },
  actionArrowLabelDark: {
    color: '#1D4ED8',
  },
  benefitGrid: {
    gap: 12,
  },
  benefitGridWide: {
    flexDirection: 'row',
  },
  benefitCard: {
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E6FF',
    gap: 8,
  },
  benefitCardWide: {
    flex: 1,
  },
  benefitHighlight: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    color: '#0F172A',
  },
  benefitTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
  section: {
    gap: 16,
  },
  sectionHeader: {
    gap: 6,
  },
  sectionEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#2563EB',
  },
  sectionEyebrowInverse: {
    color: '#93C5FD',
  },
  sectionTitle: {
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '900',
    color: '#0F172A',
  },
  sectionTitleInverse: {
    color: '#FFFFFF',
  },
  sectionDescription: {
    fontSize: 15,
    lineHeight: 23,
    color: '#475569',
  },
  sectionDescriptionInverse: {
    color: '#CBD5E1',
  },
  detailLeadCard: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E6FF',
    gap: 16,
  },
  detailLeadText: {
    gap: 8,
  },
  detailLeadTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    color: '#0F172A',
  },
  detailLeadBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  detailLeadActions: {
    gap: 10,
  },
  inlineActionPrimary: {
    borderRadius: 18,
    backgroundColor: '#2563EB',
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  inlineActionPrimaryLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  inlineActionGhost: {
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  inlineActionGhostLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: '#1D4ED8',
  },
  storyColumn: {
    gap: 14,
  },
  storyCard: {
    height: 240,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#DBEAFE',
  },
  storyCardFeatured: {
    height: 290,
  },
  storyImage: {
    borderRadius: 30,
  },
  storyOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  storyEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#BFDBFE',
    marginBottom: 6,
  },
  storyTitle: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  storyBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#E2E8F0',
  },
  flowColumn: {
    gap: 12,
  },
  flowCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E6FF',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  flowLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 6,
    backgroundColor: '#2563EB',
  },
  flowIndex: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2563EB',
  },
  flowIndexText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  flowTextArea: {
    flex: 1,
    gap: 4,
  },
  flowTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
    color: '#0F172A',
  },
  flowBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  pushSection: {
    borderRadius: 32,
    paddingHorizontal: 20,
    paddingVertical: 22,
    gap: 18,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  pushList: {
    gap: 12,
  },
  pushRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pushDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#93C5FD',
    marginTop: 7,
  },
  pushTextArea: {
    flex: 1,
    gap: 3,
  },
  pushTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  pushBody: {
    fontSize: 13,
    lineHeight: 20,
    color: '#CBD5E1',
  },
  pushFooter: {
    gap: 10,
  },
  permissionButton: {
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
  },
  permissionButtonText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#1D4ED8',
  },
  permissionHelper: {
    fontSize: 13,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  permissionHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#BFDBFE',
  },
  permissionGateScreen: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    justifyContent: 'center',
  },
  permissionGateCard: {
    borderRadius: 32,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: '#D7E6FF',
    gap: 18,
    overflow: 'hidden',
  },
  permissionGateBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  permissionGateBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  permissionGateTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    color: '#0F172A',
  },
  permissionGateBody: {
    fontSize: 15,
    lineHeight: 24,
    color: '#475569',
  },
  permissionGatePanel: {
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E6FF',
    gap: 8,
  },
  permissionGatePanelTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  permissionGatePanelBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  permissionGateActions: {
    gap: 10,
  },
  permissionGateDisabledButton: {
    borderRadius: 20,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FBFF',
    borderWidth: 1,
    borderColor: '#D7E6FF',
  },
  permissionGateDisabledLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#475569',
  },
  permissionGatePrimaryButton: {
    borderRadius: 20,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2563EB',
  },
  permissionGatePrimaryLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  permissionGateSecondaryButton: {
    borderRadius: 20,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  permissionGateSecondaryLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#1D4ED8',
  },
  supportGrid: {
    gap: 14,
  },
  supportGridWide: {
    flexDirection: 'row',
  },
  supportCardLarge: {
    flex: 1.15,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E6FF',
    gap: 10,
  },
  supportBrand: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    color: '#0F172A',
  },
  supportHours: {
    fontSize: 13,
    lineHeight: 18,
    color: '#475569',
  },
  supportBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  supportButtonStack: {
    marginTop: 4,
    gap: 10,
  },
  supportCardCompact: {
    flex: 0.85,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    gap: 10,
  },
  supportCompactEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#2563EB',
  },
  supportCompactTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
    color: '#0F172A',
  },
  supportCompactBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#475569',
  },
  supportCompactMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748B',
  },
  floatingChatButton: {
    position: 'absolute',
    right: 18,
    bottom: 26,
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    shadowColor: '#1D4ED8',
    shadowOpacity: 0.26,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 18,
    elevation: 7,
  },
  floatingChatOverline: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
    color: '#DBEAFE',
  },
  floatingChatLabel: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
    color: '#FFFFFF',
  },
});
