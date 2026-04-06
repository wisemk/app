import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

function getExpoProjectId() {
  return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
}

export async function requestPushPermissionStatus() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('marketing', {
      name: 'marketing',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 200],
      lightColor: '#D96C3B',
    });
  }

  if (!Device.isDevice) {
    return '실기기에서만 푸시 권한과 토큰을 확인할 수 있습니다. 에뮬레이터나 웹 미리보기에서는 실제 발송 테스트가 불가능합니다.';
  }

  const currentSettings = await Notifications.getPermissionsAsync();
  let finalStatus = currentSettings.status;

  if (finalStatus !== 'granted') {
    const nextSettings = await Notifications.requestPermissionsAsync();
    finalStatus = nextSettings.status;
  }

  if (finalStatus !== 'granted') {
    return '푸시 권한이 허용되지 않았습니다. 운영 전환 시에는 고객이 첫 실행에서 권한을 허용하도록 안내 문구를 넣는 것이 좋습니다.';
  }

  try {
    const projectId = getExpoProjectId();

    if (!projectId) {
      return '푸시 권한은 허용되었지만 Expo 푸시 토큰 발급에는 `projectId` 설정이 더 필요합니다. EAS 프로젝트를 연결한 뒤 다시 시도하세요.';
    }

    const expoPushToken = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return `푸시 권한이 허용되었고 Expo 푸시 토큰도 발급되었습니다.\n테스트 토큰: ${expoPushToken.data}\n이 토큰을 서버 또는 관리자 발송 도구에 저장하면 월말/월초 푸시 테스트까지 이어갈 수 있습니다.`;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';

    if (message.includes('projectId')) {
      return '푸시 권한은 허용되었지만 Expo 푸시 토큰 발급에는 `projectId` 설정이 더 필요합니다. EAS 프로젝트를 연결하거나 app config의 extra.eas.projectId를 넣은 뒤 다시 시도하세요.';
    }

    return `푸시 권한은 허용되었지만 토큰 발급은 아직 완료되지 않았습니다. 원인: ${message}`;
  }
}
