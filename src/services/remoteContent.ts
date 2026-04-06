import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { APP_CONFIG } from '../config/appConfig';
import { DEFAULT_APP_CONTENT } from '../data/content';
import { appContentSchema, textSchema } from '../shared/contentSchema';
import type { AppContent, ContentState } from '../types/content';

const cacheRecordSchema = z.object({
  cachedAt: textSchema,
  content: appContentSchema,
});

let inFlightRefresh: Promise<ContentState> | null = null;

function isPlaceholderUrl(url: string) {
  return url.includes('example.com');
}

function buildContentState(
  content: AppContent,
  source: ContentState['source'],
  statusMessage: string,
  syncedAt: string | null,
): ContentState {
  return {
    content,
    source,
    statusMessage,
    syncedAt,
  };
}

function getFallbackState(statusMessage: string) {
  return buildContentState(DEFAULT_APP_CONTENT, 'fallback', statusMessage, null);
}

async function getCachedContentState(statusMessage: string) {
  const rawValue = await AsyncStorage.getItem(APP_CONFIG.contentCacheKey);
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    const validation = cacheRecordSchema.safeParse(parsedValue);

    if (!validation.success) {
      await AsyncStorage.removeItem(APP_CONFIG.contentCacheKey);
      return null;
    }

    return buildContentState(
      validation.data.content,
      'cache',
      statusMessage,
      validation.data.cachedAt,
    );
  } catch {
    await AsyncStorage.removeItem(APP_CONFIG.contentCacheKey);
    return null;
  }
}

async function fetchRemoteContent() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, APP_CONFIG.contentRequestTimeoutMs);

  try {
    const response = await fetch(APP_CONFIG.remoteContentUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawContent = await response.json();
    const validation = appContentSchema.safeParse(rawContent);

    if (!validation.success) {
      throw new Error('원격 JSON 스키마가 앱 버전과 맞지 않습니다.');
    }

    const cachedAt = new Date().toISOString();
    await AsyncStorage.setItem(
      APP_CONFIG.contentCacheKey,
      JSON.stringify({
        cachedAt,
        content: validation.data,
      }),
    );

    return buildContentState(
      validation.data,
      'remote',
      '서버 최신 내용을 반영했습니다.',
      cachedAt,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getDefaultContentState() {
  return getFallbackState(
    '앱 기본 콘텐츠를 먼저 표시하고 있습니다. 서버 내용은 백그라운드에서 확인됩니다.',
  );
}

export async function getStartupContentState() {
  const cachedState = await getCachedContentState(
    '이전에 받아 둔 캐시 내용을 먼저 표시하고 있습니다.',
  );

  return (
    cachedState ??
    getFallbackState(
      '저장된 캐시가 없어 앱 기본 콘텐츠를 표시하고 있습니다.',
    )
  );
}

export async function refreshRemoteContent(): Promise<ContentState> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = (async () => {
    if (isPlaceholderUrl(APP_CONFIG.remoteContentUrl)) {
      const cachedState = await getCachedContentState(
        '원격 콘텐츠 주소가 아직 설정되지 않아 저장된 내용을 표시하고 있습니다.',
      );

      return (
        cachedState ??
        getFallbackState(
          '원격 콘텐츠 주소가 아직 설정되지 않아 앱 기본 콘텐츠를 표시하고 있습니다.',
        )
      );
    }

    try {
      return await fetchRemoteContent();
    } catch (error) {
      console.error('Failed to refresh remote content', error);
      const cachedState = await getCachedContentState(
        '서버 연결에 실패해 저장된 캐시 내용을 표시하고 있습니다.',
      );

      return (
        cachedState ??
        getFallbackState(
          '서버 연결에 실패해 앱 기본 콘텐츠를 표시하고 있습니다.',
        )
      );
    }
  })();

  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

export async function clearCachedContent() {
  await AsyncStorage.removeItem(APP_CONFIG.contentCacheKey);

  return getFallbackState(
    '캐시를 비워서 앱 기본 콘텐츠만 남겨 둔 상태입니다.',
  );
}
