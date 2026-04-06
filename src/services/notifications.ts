import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

const NOTIFICATION_AUTO_PROMPT_KEY = 'notification-auto-prompt-v1';

let hasEnsuredMarketingChannel = false;

export type NotificationAccessState = {
  granted: boolean;
  message: string;
  requiresSettings: boolean;
};

type NotificationAccessOptions = {
  autoPromptOnce?: boolean;
  requestIfPossible?: boolean;
};

function getExpoProjectId() {
  return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
}

async function ensureMarketingChannel() {
  if (Platform.OS !== 'android' || hasEnsuredMarketingChannel) {
    return;
  }

  await Notifications.setNotificationChannelAsync('marketing', {
    name: 'marketing',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 200],
    lightColor: '#D96C3B',
  });

  hasEnsuredMarketingChannel = true;
}

function getDeniedMessage(requiresSettings: boolean) {
  if (requiresSettings) {
    return '알림 권한을 허용해야 앱을 사용할 수 있습니다. 설정에서 알림을 켠 뒤 다시 돌아와 주세요.';
  }

  return '알림 권한을 허용해야 앱을 사용할 수 있습니다. 권한 요청을 다시 진행해 주세요.';
}

function getPermissionErrorMessage() {
  return '알림 권한 확인 중 문제가 생겼습니다. 다시 확인해 주세요.';
}

async function requestNotificationPermissions() {
  return await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      allowProvisional: false,
    },
  });
}

async function buildGrantedStatusMessage() {
  const projectId = getExpoProjectId();

  if (!projectId) {
    return '알림 권한은 허용됐지만 Expo 푸시 토큰 발급에는 projectId 설정이 더 필요합니다.';
  }

  const expoPushToken = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return `알림 권한이 허용됐고 Expo 푸시 토큰까지 발급됐습니다.\n테스트용 토큰: ${expoPushToken.data}`;
}

export async function getNotificationAccessState(
  options?: NotificationAccessOptions,
): Promise<NotificationAccessState> {
  try {
    if (!Device.isDevice) {
      return {
        granted: true,
        requiresSettings: false,
        message: '개발 미리보기에서는 실제 기기 알림 권한 없이도 화면 확인이 가능합니다.',
      };
    }

    let permissions = await Notifications.getPermissionsAsync();

    if (options?.autoPromptOnce) {
      const autoPromptSeen = await AsyncStorage.getItem(NOTIFICATION_AUTO_PROMPT_KEY);
      if (!autoPromptSeen) {
        if (permissions.status !== 'granted' && permissions.canAskAgain) {
          permissions = await requestNotificationPermissions();
        }

        await AsyncStorage.setItem(NOTIFICATION_AUTO_PROMPT_KEY, '1');
      }
    } else if (
      options?.requestIfPossible &&
      permissions.status !== 'granted' &&
      permissions.canAskAgain
    ) {
      permissions = await requestNotificationPermissions();
    }

    if (permissions.granted || permissions.status === 'granted') {
      try {
        await ensureMarketingChannel();
      } catch {
        // Channel creation is best-effort and must not block app entry.
      }

      return {
        granted: true,
        requiresSettings: false,
        message: '알림 권한이 허용됐습니다.',
      };
    }

    const requiresSettings = !permissions.canAskAgain;

    return {
      granted: false,
      requiresSettings,
      message: getDeniedMessage(requiresSettings),
    };
  } catch {
    return {
      granted: false,
      requiresSettings: false,
      message: getPermissionErrorMessage(),
    };
  }
}

export async function requestPushPermissionStatus() {
  const accessState = await getNotificationAccessState({
    requestIfPossible: true,
  });

  if (!accessState.granted) {
    return accessState.message;
  }

  try {
    return await buildGrantedStatusMessage();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';

    if (message.includes('projectId')) {
      return '알림 권한은 허용됐지만 Expo 푸시 토큰 발급에는 projectId 설정이 더 필요합니다.';
    }

    return `알림 권한은 허용됐지만 푸시 토큰 발급은 아직 완료되지 않았습니다. 원인: ${message}`;
  }
}

export async function openAppNotificationSettings() {
  await Linking.openSettings();
}
