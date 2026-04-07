import { z } from 'zod';

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const nullableTextSchema = z.string().min(1).nullable();

export const activityStorageModeSchema = z.enum(['memory', 'postgres']);
export const clientPlatformSchema = z.enum(['android', 'ios', 'web', 'unknown']);
export const appOpenSourceSchema = z.enum(['launch', 'foreground', 'manual']);
export const pushCampaignStatusSchema = z.enum([
  'draft',
  'scheduled',
  'queued',
  'sending',
  'completed',
  'failed',
]);
export const pushDeliveryStatusSchema = z.enum([
  'queued',
  'ticketed',
  'receipt_ok',
  'receipt_error',
  'token_invalid',
  'failed',
]);

export const registerDeviceRequestSchema = z.object({
  installationId: z.string().min(1),
  customerExternalId: nullableTextSchema,
  platform: clientPlatformSchema,
  appVersion: nullableTextSchema,
  expoPushToken: nullableTextSchema,
  pushPermissionGranted: z.boolean(),
  deviceLabel: nullableTextSchema,
  deviceOsVersion: nullableTextSchema,
});

export const registerDeviceResponseSchema = z.object({
  installationId: z.string().min(1),
  customerExternalId: nullableTextSchema,
  expoPushToken: nullableTextSchema,
  pushPermissionGranted: z.boolean(),
  lastRegisteredAt: isoDateTimeSchema,
  lastOpenedAt: isoDateTimeSchema.nullable(),
  storageMode: activityStorageModeSchema,
});

export const recordAppOpenRequestSchema = z.object({
  installationId: z.string().min(1),
  customerExternalId: nullableTextSchema,
  openedAt: isoDateTimeSchema,
  source: appOpenSourceSchema,
  appVersion: nullableTextSchema,
});

export const recordAppOpenResponseSchema = z.object({
  id: z.string().min(1),
  installationId: z.string().min(1),
  customerExternalId: nullableTextSchema,
  openedAt: isoDateTimeSchema,
  source: appOpenSourceSchema,
  storageMode: activityStorageModeSchema,
});

export const createPushCampaignRequestSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  audienceLabel: z.string().min(1),
  scheduledFor: isoDateTimeSchema.nullable(),
  createdBy: z.string().min(1),
});

export const pushCampaignSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  audienceLabel: z.string().min(1),
  scheduledFor: isoDateTimeSchema.nullable(),
  status: pushCampaignStatusSchema,
  createdBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
  storageMode: activityStorageModeSchema,
});
