export const APP_CONFIG = {
  remoteContentUrl:
    process.env.EXPO_PUBLIC_REMOTE_CONTENT_URL ??
    'https://example.com/soaek-bank-content.json',
  contentSchemaVersion: 1,
  contentCacheKey: '@soaek-bank/remote-content-v1',
  contentRequestTimeoutMs: 6000,
} as const;
