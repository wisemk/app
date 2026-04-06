import { z } from 'zod';

import { APP_CONFIG } from '../config/appConfig';

export const textSchema = z.string().min(1);
export const urlSchema = z.string().url();
export const phoneNumberSchema = z.string().regex(/^[0-9+()\-\s]+$/);

export const appContentSchema = z.object({
  schemaVersion: z.literal(APP_CONFIG.contentSchemaVersion),
  updatedAt: textSchema,
  business: z.object({
    brandName: textSchema,
    businessHours: textSchema,
    phoneNumber: phoneNumberSchema,
    detailPageUrl: urlSchema,
    channelTalkUrl: urlSchema,
  }),
  home: z.object({
    badges: z.array(textSchema).min(1),
    title: textSchema,
    subtitle: textSchema,
  }),
  primaryActions: z.object({
    chat: z.object({
      label: textSchema,
      caption: textSchema,
    }),
    detail: z.object({
      label: textSchema,
      caption: textSchema,
    }),
    call: z.object({
      label: textSchema,
      caption: textSchema,
    }),
  }),
  sections: z.object({
    detail: z.object({
      eyebrow: textSchema,
      title: textSchema,
      description: textSchema,
    }),
    retention: z.object({
      eyebrow: textSchema,
      title: textSchema,
      description: textSchema,
    }),
    push: z.object({
      eyebrow: textSchema,
      title: textSchema,
      description: textSchema,
    }),
    support: z.object({
      eyebrow: textSchema,
      title: textSchema,
      description: textSchema,
    }),
  }),
  benefits: z
    .array(
      z.object({
        title: textSchema,
        highlight: textSchema,
      }),
    )
    .min(1),
  detailPanels: z
    .array(
      z.object({
        eyebrow: textSchema,
        title: textSchema,
        description: textSchema,
        imageUrl: urlSchema,
      }),
    )
    .min(1),
  reminderFlow: z
    .array(
      z.object({
        title: textSchema,
        description: textSchema,
      }),
    )
    .min(1),
  pushCampaigns: z
    .array(
      z.object({
        title: textSchema,
        message: textSchema,
      }),
    )
    .min(1),
  support: z.object({
    body: textSchema,
    chatButtonLabel: textSchema,
    chatButtonCaption: textSchema,
    phoneButtonLabel: textSchema,
  }),
});
