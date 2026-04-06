export const APP_CONFIG = {
  remoteContentUrl:
    process.env.EXPO_PUBLIC_REMOTE_CONTENT_URL ??
    'https://soaek-bank-content.onrender.com/api/content',
  contentSchemaVersion: 1,
  contentCacheKey: '@soaek-bank/remote-content-v1',
  contentRequestTimeoutMs: 6000,
} as const;
