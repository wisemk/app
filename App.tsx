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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { ActionButton } from './src/components/ActionButton';
import { SectionHeader } from './src/components/SectionHeader';
import { DEFAULT_APP_CONTENT } from './src/data/content';
import { openChat, openPhoneDialer, openWebsite } from './src/services/chat';
import {
  clearCachedContent,
  getDefaultContentState,
  getStartupContentState,
  refreshRemoteContent,
} from './src/services/remoteContent';
import { requestPushPermissionStatus } from './src/services/notifications';
import type { ContentState } from './src/types/content';

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
      return '서버 최신 내용';
    case 'cache':
      return '저장된 캐시 내용';
    default:
      return '앱 기본 내용';
  }
}

const FOREGROUND_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export default function App() {
  const [contentState, setContentState] = useState<ContentState>(() =>
    getDefaultContentState(),
  );
  const [pushStatusMessage, setPushStatusMessage] = useState(
    '아직 푸시 권한을 확인하지 않았습니다.',
  );
  const [refreshing, setRefreshing] = useState(false);
  const lastRemoteCheckAtRef = useRef(0);

  const content = contentState.content ?? DEFAULT_APP_CONTENT;

  const runRemoteRefresh = async (force: boolean) => {
    const now = Date.now();

    if (!force && now - lastRemoteCheckAtRef.current < FOREGROUND_REFRESH_COOLDOWN_MS) {
      return null;
    }

    lastRemoteCheckAtRef.current = now;
    return await refreshRemoteContent();
  };

  useEffect(() => {
    let isMounted = true;

    const applyState = (nextState: ContentState) => {
      if (!isMounted) {
        return;
      }

      setContentState(nextState);
    };

    const bootstrap = async () => {
      const startupState = await getStartupContentState();
      applyState(startupState);

      const refreshedState = await runRemoteRefresh(true);
      if (refreshedState) {
        applyState(refreshedState);
      }
    };

    void bootstrap();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      void runRemoteRefresh(false).then((nextContentState) => {
        if (nextContentState) {
          applyState(nextContentState);
        }
      });
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
    Alert.alert('알림 준비 상태', result);
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

  const handleResetCache = async () => {
    const resetState = await clearCachedContent();
    setContentState(resetState);
    Alert.alert('캐시 초기화', '저장된 내용을 지우고 기본 콘텐츠로 되돌렸습니다.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <LinearGradient
          colors={['#F5EEE0', '#FDF8F1']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroBadgeRow}>
            {content.home.badges.map((badge) => (
              <Text key={badge} style={styles.heroBadge}>
                {badge}
              </Text>
            ))}
          </View>

          <View style={styles.syncCard}>
            <Text style={styles.syncEyebrow}>Content Sync</Text>
            <Text style={styles.syncTitle}>{getSourceLabel(contentState.source)}</Text>
            <Text style={styles.syncMessage}>{contentState.statusMessage}</Text>
            <Text style={styles.syncMeta}>
              마지막 반영: {formatSyncTime(contentState.syncedAt)}
            </Text>
            <Text style={styles.syncMeta}>서버 기준 수정 시각: {content.updatedAt}</Text>
            <View style={styles.syncActions}>
              <Pressable style={styles.syncActionButton} onPress={handleRefresh}>
                <Text style={styles.syncActionLabel}>지금 새로고침</Text>
              </Pressable>
              <Pressable
                style={styles.syncActionButtonSecondary}
                onPress={handleResetCache}
              >
                <Text style={styles.syncActionLabelSecondary}>캐시 초기화</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.heroTitle}>{content.home.title}</Text>
          <Text style={styles.heroSubtitle}>{content.home.subtitle}</Text>

          <View style={styles.metricRow}>
            {content.benefits.map((item) => (
              <View key={item.title} style={styles.metricCard}>
                <Text style={styles.metricValue}>{item.highlight}</Text>
                <Text style={styles.metricLabel}>{item.title}</Text>
              </View>
            ))}
          </View>

          <View style={styles.primaryActions}>
            <ActionButton
              label={content.primaryActions.chat.label}
              caption={content.primaryActions.chat.caption}
              variant="primary"
              onPress={handleChatPress}
            />
            <ActionButton
              label={content.primaryActions.detail.label}
              caption={content.primaryActions.detail.caption}
              variant="secondary"
              onPress={handleWebsitePress}
            />
            <ActionButton
              label={content.primaryActions.call.label}
              caption={content.business.phoneNumber}
              variant="ghost"
              onPress={handleCallPress}
            />
          </View>
        </LinearGradient>

        <View style={styles.section}>
          <SectionHeader
            eyebrow={content.sections.detail.eyebrow}
            title={content.sections.detail.title}
            description={content.sections.detail.description}
          />
          {content.detailPanels.map((panel) => (
            <ImageBackground
              key={panel.title}
              source={{ uri: panel.imageUrl }}
              imageStyle={styles.storyImage}
              style={styles.storyCard}
            >
              <LinearGradient
                colors={['rgba(7, 22, 18, 0.08)', 'rgba(7, 22, 18, 0.84)']}
                style={styles.storyOverlay}
              >
                <Text style={styles.storyEyebrow}>{panel.eyebrow}</Text>
                <Text style={styles.storyTitle}>{panel.title}</Text>
                <Text style={styles.storyBody}>{panel.description}</Text>
              </LinearGradient>
            </ImageBackground>
          ))}
        </View>

        <View style={styles.section}>
          <SectionHeader
            eyebrow={content.sections.retention.eyebrow}
            title={content.sections.retention.title}
            description={content.sections.retention.description}
          />
          <View style={styles.flowColumn}>
            {content.reminderFlow.map((item, index) => (
              <View key={item.title} style={styles.flowCard}>
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

        <View style={styles.section}>
          <SectionHeader
            eyebrow={content.sections.push.eyebrow}
            title={content.sections.push.title}
            description={content.sections.push.description}
          />
          <View style={styles.pushCard}>
            {content.pushCampaigns.map((campaign) => (
              <View key={campaign.title} style={styles.pushRow}>
                <View style={styles.pushBullet} />
                <View style={styles.pushTextArea}>
                  <Text style={styles.pushTitle}>{campaign.title}</Text>
                  <Text style={styles.pushBody}>{campaign.message}</Text>
                </View>
              </View>
            ))}

            <Pressable style={styles.permissionButton} onPress={handlePushPress}>
              <Text style={styles.permissionButtonText}>푸시 권한 상태 확인</Text>
            </Pressable>
            <Text style={styles.permissionHelper}>{pushStatusMessage}</Text>
            <Text style={styles.permissionHint}>최근 제안 문구: {lastCampaign}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader
            eyebrow={content.sections.support.eyebrow}
            title={content.sections.support.title}
            description={content.sections.support.description}
          />
          <View style={styles.supportCard}>
            <Text style={styles.supportName}>{content.business.brandName}</Text>
            <Text style={styles.supportHours}>
              운영시간 {content.business.businessHours}
            </Text>
            <Text style={styles.supportCopy}>{content.support.body}</Text>
            <View style={styles.supportActions}>
              <ActionButton
                label={content.support.chatButtonLabel}
                caption={content.support.chatButtonCaption}
                variant="primary"
                onPress={handleChatPress}
              />
              <ActionButton
                label={content.support.phoneButtonLabel}
                caption={content.business.phoneNumber}
                variant="secondary"
                onPress={handleCallPress}
              />
            </View>
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
    backgroundColor: '#FAF7F2',
  },
  screen: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 120,
    gap: 28,
  },
  heroCard: {
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 18,
    borderWidth: 1,
    borderColor: '#E7DEC9',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E2EAD8',
    color: '#264233',
    fontSize: 12,
    fontWeight: '700',
  },
  syncCard: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.68)',
    gap: 6,
  },
  syncEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: '#A1542E',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  syncTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#153027',
  },
  syncMessage: {
    fontSize: 13,
    lineHeight: 20,
    color: '#4A6058',
  },
  syncMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: '#60736B',
  },
  syncActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  syncActionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#16372E',
  },
  syncActionButtonSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#FFF8EC',
    borderWidth: 1,
    borderColor: '#E7D9C1',
  },
  syncActionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  syncActionLabelSecondary: {
    fontSize: 13,
    fontWeight: '800',
    color: '#18352D',
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    color: '#14261F',
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 24,
    color: '#3C5148',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.72)',
    minHeight: 92,
    justifyContent: 'space-between',
  },
  metricValue: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    color: '#133B2C',
  },
  metricLabel: {
    fontSize: 13,
    lineHeight: 18,
    color: '#4D655C',
  },
  primaryActions: {
    gap: 12,
  },
  section: {
    gap: 16,
  },
  storyCard: {
    height: 220,
    borderRadius: 28,
    overflow: 'hidden',
    marginBottom: 14,
    backgroundColor: '#E7DEC9',
  },
  storyImage: {
    borderRadius: 28,
  },
  storyOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  storyEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DDEBDE',
    marginBottom: 6,
  },
  storyTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  storyBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#F1F4EF',
  },
  flowColumn: {
    gap: 12,
  },
  flowCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#ECE2D2',
  },
  flowIndex: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#133B2C',
  },
  flowIndexText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  flowTextArea: {
    flex: 1,
    gap: 4,
  },
  flowTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#1D2F28',
  },
  flowBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#566962',
  },
  pushCard: {
    backgroundColor: '#1B3B31',
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
  },
  pushRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  pushBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F5C77A',
    marginTop: 7,
  },
  pushTextArea: {
    flex: 1,
    gap: 2,
  },
  pushTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pushBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#D5E2DB',
  },
  permissionButton: {
    marginTop: 4,
    borderRadius: 18,
    backgroundColor: '#F3E3C0',
    paddingVertical: 14,
    alignItems: 'center',
  },
  permissionButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1B3B31',
  },
  permissionHelper: {
    fontSize: 13,
    lineHeight: 19,
    color: '#FFFFFF',
  },
  permissionHint: {
    fontSize: 12,
    lineHeight: 17,
    color: '#C7D9D0',
  },
  supportCard: {
    borderRadius: 28,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#E8DFCF',
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 10,
  },
  supportName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#152823',
  },
  supportHours: {
    fontSize: 13,
    lineHeight: 18,
    color: '#587065',
  },
  supportCopy: {
    fontSize: 14,
    lineHeight: 22,
    color: '#4C5F58',
  },
  supportActions: {
    gap: 12,
    marginTop: 6,
  },
  floatingChatButton: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#D96C3B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#8D3B1A',
    shadowOpacity: 0.26,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 6,
  },
  floatingChatLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
