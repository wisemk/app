import type { z } from 'zod';

import type {
  activityStorageModeSchema,
  appOpenSourceSchema,
  clientPlatformSchema,
  createPushCampaignRequestSchema,
  pushCampaignDeliveryStatsSchema,
  pushCampaignSummarySchema,
  recordAppOpenRequestSchema,
  recordAppOpenResponseSchema,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
  sendPushCampaignResponseSchema,
  syncPushReceiptsResponseSchema,
} from '../shared/engagementSchema';

export type ActivityStorageMode = z.infer<typeof activityStorageModeSchema>;
export type ClientPlatform = z.infer<typeof clientPlatformSchema>;
export type AppOpenSource = z.infer<typeof appOpenSourceSchema>;
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;
export type RegisterDeviceResponse = z.infer<typeof registerDeviceResponseSchema>;
export type RecordAppOpenRequest = z.infer<typeof recordAppOpenRequestSchema>;
export type RecordAppOpenResponse = z.infer<typeof recordAppOpenResponseSchema>;
export type CreatePushCampaignRequest = z.infer<typeof createPushCampaignRequestSchema>;
export type PushCampaignDeliveryStats = z.infer<typeof pushCampaignDeliveryStatsSchema>;
export type PushCampaignSummary = z.infer<typeof pushCampaignSummarySchema>;
export type SendPushCampaignResponse = z.infer<typeof sendPushCampaignResponseSchema>;
export type SyncPushReceiptsResponse = z.infer<typeof syncPushReceiptsResponseSchema>;
