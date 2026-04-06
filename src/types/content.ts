import type { z } from 'zod';

import type { appContentSchema } from '../shared/contentSchema';

export type Benefit = {
  title: string;
  highlight: string;
};

export type DetailPanel = {
  eyebrow: string;
  title: string;
  description: string;
  imageUrl: string;
};

export type FlowStep = {
  title: string;
  description: string;
};

export type PushCampaign = {
  title: string;
  message: string;
};

export type SectionCopy = {
  eyebrow: string;
  title: string;
  description: string;
};

export type BusinessContent = {
  brandName: string;
  businessHours: string;
  phoneNumber: string;
  detailPageUrl: string;
  channelTalkUrl: string;
};

export type HomeContent = {
  badges: string[];
  title: string;
  subtitle: string;
};

export type PrimaryActionCopy = {
  label: string;
  caption: string;
};

export type SupportContent = {
  body: string;
  chatButtonLabel: string;
  chatButtonCaption: string;
  phoneButtonLabel: string;
};

export type AppContent = z.infer<typeof appContentSchema>;

export type ContentSource = 'remote' | 'cache' | 'fallback';

export type ContentState = {
  content: AppContent;
  source: ContentSource;
  syncedAt: string | null;
  statusMessage: string;
};
