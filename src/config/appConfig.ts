const remoteContentUrl =
  process.env.EXPO_PUBLIC_REMOTE_CONTENT_URL ??
  'https://soaek-bank-content.onrender.com/api/content';
const appApiBaseUrl =
  process.env.EXPO_PUBLIC_APP_API_BASE_URL ??
  remoteContentUrl.replace(/\/api\/content\/?$/, '');

export const APP_CONFIG = {
  remoteContentUrl,
  appApiBaseUrl,
  contentSchemaVersion: 1,
  contentCacheKey: '@soaek-bank/remote-content-v1',
  contentRequestTimeoutMs: 6000,
  activityRequestTimeoutMs: 5000,
} as const;
