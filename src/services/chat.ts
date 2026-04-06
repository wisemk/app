import { Alert, Linking } from 'react-native';

function isPlaceholder(url: string) {
  return url.includes('example.com');
}

async function openUrl(url: string, label: string) {
  if (isPlaceholder(url)) {
    Alert.alert('설정 필요', `${label} 주소를 실제 운영 주소로 교체해야 합니다.`);
    return;
  }

  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    Alert.alert('열 수 없음', `${label} 링크를 여는 데 실패했습니다.`);
    return;
  }

  await Linking.openURL(url);
}

export async function openChat(chatUrl: string) {
  await openUrl(chatUrl, '채팅');
}

export async function openWebsite(websiteUrl: string) {
  await openUrl(websiteUrl, '상세페이지');
}

export async function openPhoneDialer(phoneNumber: string) {
  const phoneUrl = `tel:${phoneNumber.replace(/[^0-9+]/g, '')}`;
  const supported = await Linking.canOpenURL(phoneUrl);

  if (!supported) {
    Alert.alert('전화 연결 불가', '이 기기에서 전화 앱을 열 수 없습니다.');
    return;
  }

  await Linking.openURL(phoneUrl);
}
