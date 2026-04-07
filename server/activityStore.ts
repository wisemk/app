import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import type {
  ActivityStorageMode,
  CreatePushCampaignRequest,
  PushCampaignDeliveryStats,
  PushCampaignSummary,
  RecordAppOpenRequest,
  RecordAppOpenResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
} from '../src/types/engagement';

type CustomerRecord = {
  id: string;
  externalId: string;
};

type DeviceRecord = {
  id: string;
  installationId: string;
  customerId: string | null;
  expoPushToken: string | null;
  pushPermissionGranted: boolean;
  lastRegisteredAt: string;
  lastOpenedAt: string | null;
};

type PushCampaignRecord = {
  id: string;
  title: string;
  message: string;
  audienceLabel: string;
  scheduledFor: string | null;
  status: PushCampaignSummary['status'];
  createdBy: string;
  createdAt: string;
};

type PushDeliveryRecord = {
  id: string;
  campaignId: string;
  deviceId: string;
  expoPushToken: string;
  status: 'queued' | 'ticketed' | 'receipt_ok' | 'receipt_error' | 'token_invalid' | 'failed';
  expoTicketId: string | null;
  expoReceiptId: string | null;
  receiptStatus: 'ok' | 'error' | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  receiptCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PushCampaignAggregateInput = PushCampaignRecord & {
  deliveryStats: PushCampaignDeliveryStats;
  lastSentAt: string | null;
  lastReceiptCheckedAt: string | null;
};

export type PushSendTarget = {
  deliveryId: string;
  campaignId: string;
  deviceId: string;
  expoPushToken: string;
};

export type PendingPushReceipt = {
  deliveryId: string;
  campaignId: string;
  deviceId: string;
  expoPushToken: string;
  expoTicketId: string;
  sentAt: string;
};

export type PushTicketUpdate = {
  deliveryId: string;
  expoPushToken: string;
  status: 'ticketed' | 'failed';
  ticketId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
};

export type PushReceiptUpdate = {
  deliveryId: string;
  campaignId: string;
  deviceId: string;
  expoPushToken: string;
  status: 'receipt_ok' | 'receipt_error' | 'token_invalid';
  receiptStatus: 'ok' | 'error';
  errorCode: string | null;
  errorMessage: string | null;
  receiptCheckedAt: string;
};

export type ActivityStore = {
  mode: ActivityStorageMode;
  isPersistent: boolean;
  registerDevice(input: RegisterDeviceRequest): Promise<RegisterDeviceResponse>;
  recordAppOpen(input: RecordAppOpenRequest): Promise<RecordAppOpenResponse>;
  createPushCampaign(input: CreatePushCampaignRequest): Promise<PushCampaignSummary>;
  listPushCampaigns(limit: number): Promise<PushCampaignSummary[]>;
  getPushCampaignById(campaignId: string): Promise<PushCampaignSummary | null>;
  tryStartPushCampaignSend(campaignId: string): Promise<PushCampaignSummary | null>;
  setPushCampaignStatus(
    campaignId: string,
    status: PushCampaignSummary['status'],
  ): Promise<PushCampaignSummary | null>;
  preparePushCampaignDeliveries(campaignId: string): Promise<number>;
  listQueuedPushDeliveries(campaignId: string, limit: number): Promise<PushSendTarget[]>;
  applyPushTicketResults(updates: PushTicketUpdate[]): Promise<void>;
  listPendingPushReceipts(limit: number, readyBefore: string | null): Promise<PendingPushReceipt[]>;
  applyPushReceiptResults(updates: PushReceiptUpdate[]): Promise<void>;
  close(): Promise<void>;
};

type ActivityStoreOptions = {
  databaseUrl?: string;
  appOpenRetentionDays?: number;
};

type CampaignAggregateRow = {
  id: string;
  title: string;
  message: string;
  audience_label: string;
  scheduled_for: Date | null;
  status: PushCampaignSummary['status'];
  created_by: string;
  created_at: Date;
  delivery_total: number | string;
  delivery_pending: number | string;
  delivery_success: number | string;
  delivery_failed: number | string;
  delivery_invalid: number | string;
  last_sent_at: Date | null;
  last_receipt_checked_at: Date | null;
};

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildRegisterDeviceResponse(
  mode: ActivityStorageMode,
  input: {
    installationId: string;
    customerExternalId: string | null;
    expoPushToken: string | null;
    pushPermissionGranted: boolean;
    lastRegisteredAt: string;
    lastOpenedAt: string | null;
  },
): RegisterDeviceResponse {
  return {
    installationId: input.installationId,
    customerExternalId: input.customerExternalId,
    expoPushToken: input.expoPushToken,
    pushPermissionGranted: input.pushPermissionGranted,
    lastRegisteredAt: input.lastRegisteredAt,
    lastOpenedAt: input.lastOpenedAt,
    storageMode: mode,
  };
}

function buildAppOpenResponse(
  mode: ActivityStorageMode,
  input: {
    id: string;
    installationId: string;
    customerExternalId: string | null;
    openedAt: string;
    source: RecordAppOpenRequest['source'];
  },
): RecordAppOpenResponse {
  return {
    id: input.id,
    installationId: input.installationId,
    customerExternalId: input.customerExternalId,
    openedAt: input.openedAt,
    source: input.source,
    storageMode: mode,
  };
}

function buildEmptyDeliveryStats(): PushCampaignDeliveryStats {
  return {
    total: 0,
    pending: 0,
    success: 0,
    failed: 0,
    invalid: 0,
  };
}

function derivePushCampaignStatus(
  baseStatus: PushCampaignSummary['status'],
  stats: PushCampaignDeliveryStats,
): PushCampaignSummary['status'] {
  if (stats.total === 0) {
    return baseStatus;
  }

  if (stats.pending > 0) {
    return baseStatus === 'sending' ? 'sending' : 'queued';
  }

  return stats.success > 0 ? 'completed' : 'failed';
}

function buildPushCampaignSummary(
  mode: ActivityStorageMode,
  input: PushCampaignAggregateInput,
): PushCampaignSummary {
  return {
    id: input.id,
    title: input.title,
    message: input.message,
    audienceLabel: input.audienceLabel,
    scheduledFor: input.scheduledFor,
    status: derivePushCampaignStatus(input.status, input.deliveryStats),
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    deliveryStats: input.deliveryStats,
    lastSentAt: input.lastSentAt,
    lastReceiptCheckedAt: input.lastReceiptCheckedAt,
    storageMode: mode,
  };
}

function summarizeDeliveryStats(deliveries: PushDeliveryRecord[]): PushCampaignDeliveryStats {
  return deliveries.reduce<PushCampaignDeliveryStats>(
    (stats, delivery) => {
      stats.total += 1;

      if (delivery.status === 'queued' || delivery.status === 'ticketed') {
        stats.pending += 1;
      } else if (delivery.status === 'receipt_ok') {
        stats.success += 1;
      } else if (delivery.status === 'token_invalid') {
        stats.invalid += 1;
      } else {
        stats.failed += 1;
      }

      return stats;
    },
    buildEmptyDeliveryStats(),
  );
}

function buildAggregateFromRecord(
  record: PushCampaignRecord,
  deliveries: PushDeliveryRecord[],
): PushCampaignAggregateInput {
  const deliveryStats = summarizeDeliveryStats(deliveries);
  const lastSentAt = deliveries.reduce<string | null>((value, delivery) => {
    if (!delivery.sentAt) {
      return value;
    }

    return !value || delivery.sentAt > value ? delivery.sentAt : value;
  }, null);
  const lastReceiptCheckedAt = deliveries.reduce<string | null>((value, delivery) => {
    if (!delivery.receiptCheckedAt) {
      return value;
    }

    return !value || delivery.receiptCheckedAt > value ? delivery.receiptCheckedAt : value;
  }, null);

  return {
    ...record,
    deliveryStats,
    lastSentAt,
    lastReceiptCheckedAt,
  };
}

class MemoryActivityStore implements ActivityStore {
  readonly mode = 'memory' as const;
  readonly isPersistent = false;
  private readonly appOpenRetentionSweepIntervalMs = 60 * 60 * 1000;
  private lastAppOpenPrunedAt = 0;

  constructor(private readonly appOpenRetentionDays: number) {}

  private customersByExternalId = new Map<string, CustomerRecord>();
  private devicesByInstallationId = new Map<string, DeviceRecord>();
  private appOpenResponses: RecordAppOpenResponse[] = [];
  private pushCampaigns = new Map<string, PushCampaignRecord>();
  private pushCampaignOrder: string[] = [];
  private pushDeliveries = new Map<string, PushDeliveryRecord>();

  async registerDevice(input: RegisterDeviceRequest) {
    const customerExternalId = normalizeNullableText(input.customerExternalId);
    const expoPushToken = normalizeNullableText(input.expoPushToken);
    const lastRegisteredAt = new Date().toISOString();
    let customerId: string | null = null;

    if (customerExternalId) {
      const existingCustomer = this.customersByExternalId.get(customerExternalId);
      const customer =
        existingCustomer ??
        {
          id: `cus_${randomUUID()}`,
          externalId: customerExternalId,
        };

      this.customersByExternalId.set(customerExternalId, customer);
      customerId = customer.id;
    }

    const existingDevice = this.devicesByInstallationId.get(input.installationId);
    const nextDevice: DeviceRecord = {
      id: existingDevice?.id ?? `dev_${randomUUID()}`,
      installationId: input.installationId,
      customerId: customerId ?? existingDevice?.customerId ?? null,
      expoPushToken,
      pushPermissionGranted: input.pushPermissionGranted,
      lastRegisteredAt,
      lastOpenedAt: existingDevice?.lastOpenedAt ?? null,
    };

    this.devicesByInstallationId.set(input.installationId, nextDevice);

    return buildRegisterDeviceResponse(this.mode, {
      installationId: nextDevice.installationId,
      customerExternalId,
      expoPushToken: nextDevice.expoPushToken,
      pushPermissionGranted: nextDevice.pushPermissionGranted,
      lastRegisteredAt: nextDevice.lastRegisteredAt,
      lastOpenedAt: nextDevice.lastOpenedAt,
    });
  }

  async recordAppOpen(input: RecordAppOpenRequest) {
    const customerExternalId = normalizeNullableText(input.customerExternalId);
    let customerId: string | null = null;

    if (customerExternalId) {
      const existingCustomer = this.customersByExternalId.get(customerExternalId);
      const customer =
        existingCustomer ??
        {
          id: `cus_${randomUUID()}`,
          externalId: customerExternalId,
        };

      this.customersByExternalId.set(customerExternalId, customer);
      customerId = customer.id;
    }

    const existingDevice = this.devicesByInstallationId.get(input.installationId);
    const nextDevice: DeviceRecord = {
      id: existingDevice?.id ?? `dev_${randomUUID()}`,
      installationId: input.installationId,
      customerId: customerId ?? existingDevice?.customerId ?? null,
      expoPushToken: existingDevice?.expoPushToken ?? null,
      pushPermissionGranted: existingDevice?.pushPermissionGranted ?? false,
      lastRegisteredAt: existingDevice?.lastRegisteredAt ?? input.openedAt,
      lastOpenedAt: input.openedAt,
    };

    this.devicesByInstallationId.set(input.installationId, nextDevice);

    const appOpen = buildAppOpenResponse(this.mode, {
      id: `open_${randomUUID()}`,
      installationId: input.installationId,
      customerExternalId,
      openedAt: input.openedAt,
      source: input.source,
    });

    this.appOpenResponses.push(appOpen);
    this.pruneExpiredAppOpensIfNeeded();

    return appOpen;
  }

  async createPushCampaign(input: CreatePushCampaignRequest) {
    const record: PushCampaignRecord = {
      id: `campaign_${randomUUID()}`,
      title: input.title,
      message: input.message,
      audienceLabel: input.audienceLabel,
      scheduledFor: normalizeNullableText(input.scheduledFor),
      status: input.scheduledFor ? 'scheduled' : 'draft',
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };

    this.pushCampaigns.set(record.id, record);
    this.pushCampaignOrder.unshift(record.id);

    return this.summarizeCampaign(record.id)!;
  }

  async listPushCampaigns(limit: number) {
    return this.pushCampaignOrder
      .slice(0, limit)
      .map((campaignId) => this.summarizeCampaign(campaignId))
      .filter((campaign): campaign is PushCampaignSummary => Boolean(campaign));
  }

  async getPushCampaignById(campaignId: string) {
    return this.summarizeCampaign(campaignId);
  }

  async tryStartPushCampaignSend(campaignId: string) {
    const campaign = this.pushCampaigns.get(campaignId);

    if (!campaign || !['draft', 'scheduled', 'failed'].includes(campaign.status)) {
      return null;
    }

    if (this.getCampaignDeliveries(campaignId).length > 0) {
      return null;
    }

    campaign.status = 'sending';
    return this.summarizeCampaign(campaignId);
  }

  async setPushCampaignStatus(campaignId: string, status: PushCampaignSummary['status']) {
    const campaign = this.pushCampaigns.get(campaignId);

    if (!campaign) {
      return null;
    }

    campaign.status = status;
    return this.summarizeCampaign(campaignId);
  }

  async preparePushCampaignDeliveries(campaignId: string) {
    let insertedCount = 0;

    this.devicesByInstallationId.forEach((device) => {
      if (!device.pushPermissionGranted || !device.expoPushToken) {
        return;
      }

      const existingDelivery = this.getCampaignDeliveries(campaignId).find(
        (delivery) => delivery.deviceId === device.id,
      );

      if (existingDelivery) {
        return;
      }

      const now = new Date().toISOString();
      const deliveryId = `delivery_${randomUUID()}`;
      this.pushDeliveries.set(deliveryId, {
        id: deliveryId,
        campaignId,
        deviceId: device.id,
        expoPushToken: device.expoPushToken,
        status: 'queued',
        expoTicketId: null,
        expoReceiptId: null,
        receiptStatus: null,
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        receiptCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      insertedCount += 1;
    });

    return insertedCount;
  }

  async listQueuedPushDeliveries(campaignId: string, limit: number) {
    return this.getCampaignDeliveries(campaignId)
      .filter((delivery) => delivery.status === 'queued')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit)
      .map((delivery) => ({
        deliveryId: delivery.id,
        campaignId: delivery.campaignId,
        deviceId: delivery.deviceId,
        expoPushToken: delivery.expoPushToken,
      }));
  }

  async applyPushTicketResults(updates: PushTicketUpdate[]) {
    const now = new Date().toISOString();

    updates.forEach((update) => {
      const delivery = this.pushDeliveries.get(update.deliveryId);

      if (!delivery) {
        return;
      }

      delivery.status = update.status;
      delivery.expoTicketId = update.ticketId;
      delivery.expoReceiptId = update.ticketId;
      delivery.receiptStatus = null;
      delivery.errorCode = update.errorCode;
      delivery.errorMessage = update.errorMessage;
      delivery.sentAt = update.sentAt ?? delivery.sentAt;
      delivery.updatedAt = now;
    });
  }

  async listPendingPushReceipts(limit: number, readyBefore: string | null) {
    return this.pushCampaignOrder
      .flatMap((campaignId) => this.getCampaignDeliveries(campaignId))
      .filter(
        (delivery) =>
          delivery.status === 'ticketed' &&
          Boolean(delivery.expoTicketId) &&
          (!readyBefore || Boolean(delivery.sentAt && delivery.sentAt <= readyBefore)),
      )
      .sort((left, right) => (left.sentAt ?? '').localeCompare(right.sentAt ?? ''))
      .slice(0, limit)
      .map((delivery) => ({
        deliveryId: delivery.id,
        campaignId: delivery.campaignId,
        deviceId: delivery.deviceId,
        expoPushToken: delivery.expoPushToken,
        expoTicketId: delivery.expoTicketId!,
        sentAt: delivery.sentAt!,
      }));
  }

  async applyPushReceiptResults(updates: PushReceiptUpdate[]) {
    updates.forEach((update) => {
      const delivery = this.pushDeliveries.get(update.deliveryId);

      if (!delivery) {
        return;
      }

      delivery.status = update.status;
      delivery.receiptStatus = update.receiptStatus;
      delivery.errorCode = update.errorCode;
      delivery.errorMessage = update.errorMessage;
      delivery.receiptCheckedAt = update.receiptCheckedAt;
      delivery.updatedAt = update.receiptCheckedAt;

      if (update.status === 'token_invalid') {
        const device = [...this.devicesByInstallationId.values()].find(
          (item) => item.id === update.deviceId,
        );

        if (device && device.expoPushToken === update.expoPushToken) {
          device.expoPushToken = null;
        }
      }
    });
  }

  async close() {
    return;
  }

  private summarizeCampaign(campaignId: string) {
    const campaign = this.pushCampaigns.get(campaignId);

    if (!campaign) {
      return null;
    }

    return buildPushCampaignSummary(
      this.mode,
      buildAggregateFromRecord(campaign, this.getCampaignDeliveries(campaignId)),
    );
  }

  private getCampaignDeliveries(campaignId: string) {
    return [...this.pushDeliveries.values()].filter((delivery) => delivery.campaignId === campaignId);
  }

  private pruneExpiredAppOpensIfNeeded() {
    const now = Date.now();

    if (now - this.lastAppOpenPrunedAt < this.appOpenRetentionSweepIntervalMs) {
      return;
    }

    const retentionCutoff = now - this.appOpenRetentionDays * 24 * 60 * 60 * 1000;
    this.appOpenResponses = this.appOpenResponses.filter(
      (item) => new Date(item.openedAt).getTime() >= retentionCutoff,
    );
    this.lastAppOpenPrunedAt = now;
  }
}

class PostgresActivityStore implements ActivityStore {
  readonly mode = 'postgres' as const;
  readonly isPersistent = true;
  private readonly appOpenRetentionSweepIntervalMs = 60 * 60 * 1000;
  private lastAppOpenPrunedAt = 0;
  private isPruningExpiredAppOpens = false;

  constructor(
    private readonly pool: Pool,
    private readonly appOpenRetentionDays: number,
  ) {}

  private async getOrCreateCustomer(
    client: { query: Pool['query'] },
    customerExternalId: string | null,
  ): Promise<CustomerRecord | null> {
    if (!customerExternalId) {
      return null;
    }

    const customerId = `cus_${randomUUID()}`;
    const result = await client.query<{
      id: string;
      external_id: string;
    }>(
      `
        INSERT INTO customers (id, external_id, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (external_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING id, external_id
      `,
      [customerId, customerExternalId],
    );

    return {
      id: result.rows[0].id,
      externalId: result.rows[0].external_id,
    };
  }

  async registerDevice(input: RegisterDeviceRequest) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const customerExternalId = normalizeNullableText(input.customerExternalId);
      const customer = await this.getOrCreateCustomer(client, customerExternalId);
      const expoPushToken = normalizeNullableText(input.expoPushToken);
      const registeredAt = new Date().toISOString();
      const deviceId = `dev_${randomUUID()}`;

      const result = await client.query<{
        installation_id: string;
        expo_push_token: string | null;
        push_permission_granted: boolean;
        last_registered_at: Date;
        last_opened_at: Date | null;
      }>(
        `
          INSERT INTO devices (
            id,
            installation_id,
            customer_id,
            platform,
            app_version,
            expo_push_token,
            push_permission_granted,
            device_label,
            device_os_version,
            last_registered_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
          ON CONFLICT (installation_id)
          DO UPDATE SET
            customer_id = COALESCE(EXCLUDED.customer_id, devices.customer_id),
            platform = EXCLUDED.platform,
            app_version = EXCLUDED.app_version,
            expo_push_token = CASE
              WHEN EXCLUDED.expo_push_token IS NULL THEN devices.expo_push_token
              ELSE EXCLUDED.expo_push_token
            END,
            push_permission_granted = EXCLUDED.push_permission_granted,
            device_label = EXCLUDED.device_label,
            device_os_version = EXCLUDED.device_os_version,
            last_registered_at = EXCLUDED.last_registered_at,
            updated_at = NOW()
          RETURNING installation_id, expo_push_token, push_permission_granted, last_registered_at, last_opened_at
        `,
        [
          deviceId,
          input.installationId,
          customer?.id ?? null,
          input.platform,
          normalizeNullableText(input.appVersion),
          expoPushToken,
          input.pushPermissionGranted,
          normalizeNullableText(input.deviceLabel),
          normalizeNullableText(input.deviceOsVersion),
          registeredAt,
        ],
      );

      await client.query('COMMIT');

      return buildRegisterDeviceResponse(this.mode, {
        installationId: result.rows[0].installation_id,
        customerExternalId,
        expoPushToken: result.rows[0].expo_push_token,
        pushPermissionGranted: result.rows[0].push_permission_granted,
        lastRegisteredAt: result.rows[0].last_registered_at.toISOString(),
        lastOpenedAt: result.rows[0].last_opened_at?.toISOString() ?? null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAppOpen(input: RecordAppOpenRequest) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const customerExternalId = normalizeNullableText(input.customerExternalId);
      const customer = await this.getOrCreateCustomer(client, customerExternalId);
      const deviceId = `dev_${randomUUID()}`;
      const result = await client.query<{ id: string }>(
        `
          INSERT INTO devices (
            id,
            installation_id,
            customer_id,
            platform,
            app_version,
            push_permission_granted,
            last_registered_at,
            last_opened_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'unknown', $4, FALSE, $5, $5, NOW(), NOW())
          ON CONFLICT (installation_id)
          DO UPDATE SET
            customer_id = COALESCE(EXCLUDED.customer_id, devices.customer_id),
            app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
            last_opened_at = EXCLUDED.last_opened_at,
            updated_at = NOW()
          RETURNING id
        `,
        [
          deviceId,
          input.installationId,
          customer?.id ?? null,
          normalizeNullableText(input.appVersion),
          input.openedAt,
        ],
      );

      const openId = `open_${randomUUID()}`;
      await client.query(
        `
          INSERT INTO app_opens (
            id,
            device_id,
            customer_id,
            opened_at,
            source,
            app_version,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [
          openId,
          result.rows[0].id,
          customer?.id ?? null,
          input.openedAt,
          input.source,
          normalizeNullableText(input.appVersion),
        ],
      );

      await client.query('COMMIT');
      void this.pruneExpiredAppOpensIfNeeded();

      return buildAppOpenResponse(this.mode, {
        id: openId,
        installationId: input.installationId,
        customerExternalId,
        openedAt: input.openedAt,
        source: input.source,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createPushCampaign(input: CreatePushCampaignRequest) {
    const campaignId = `campaign_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    await this.pool.query(
      `
        INSERT INTO push_campaigns (
          id,
          title,
          message,
          audience_label,
          scheduled_for,
          status,
          created_by,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        campaignId,
        input.title,
        input.message,
        input.audienceLabel,
        normalizeNullableText(input.scheduledFor),
        input.scheduledFor ? 'scheduled' : 'draft',
        input.createdBy,
        createdAt,
      ],
    );

    return (await this.getPushCampaignById(campaignId))!;
  }

  async listPushCampaigns(limit: number) {
    const result = await this.pool.query<CampaignAggregateRow>(
      `
        SELECT
          c.id,
          c.title,
          c.message,
          c.audience_label,
          c.scheduled_for,
          c.status,
          c.created_by,
          c.created_at,
          COUNT(d.id)::int AS delivery_total,
          COUNT(*) FILTER (WHERE d.status IN ('queued', 'ticketed'))::int AS delivery_pending,
          COUNT(*) FILTER (WHERE d.status = 'receipt_ok')::int AS delivery_success,
          COUNT(*) FILTER (WHERE d.status IN ('failed', 'receipt_error'))::int AS delivery_failed,
          COUNT(*) FILTER (WHERE d.status = 'token_invalid')::int AS delivery_invalid,
          MAX(d.sent_at) AS last_sent_at,
          MAX(d.receipt_checked_at) AS last_receipt_checked_at
        FROM push_campaigns c
        LEFT JOIN push_deliveries d ON d.campaign_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => this.mapCampaignAggregate(row));
  }

  async getPushCampaignById(campaignId: string) {
    const result = await this.pool.query<CampaignAggregateRow>(
      `
        SELECT
          c.id,
          c.title,
          c.message,
          c.audience_label,
          c.scheduled_for,
          c.status,
          c.created_by,
          c.created_at,
          COUNT(d.id)::int AS delivery_total,
          COUNT(*) FILTER (WHERE d.status IN ('queued', 'ticketed'))::int AS delivery_pending,
          COUNT(*) FILTER (WHERE d.status = 'receipt_ok')::int AS delivery_success,
          COUNT(*) FILTER (WHERE d.status IN ('failed', 'receipt_error'))::int AS delivery_failed,
          COUNT(*) FILTER (WHERE d.status = 'token_invalid')::int AS delivery_invalid,
          MAX(d.sent_at) AS last_sent_at,
          MAX(d.receipt_checked_at) AS last_receipt_checked_at
        FROM push_campaigns c
        LEFT JOIN push_deliveries d ON d.campaign_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
      `,
      [campaignId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.mapCampaignAggregate(result.rows[0]);
  }

  async tryStartPushCampaignSend(campaignId: string) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const lockedCampaign = await client.query<{ id: string }>(
        `
          SELECT id
          FROM push_campaigns
          WHERE id = $1
          FOR UPDATE
        `,
        [campaignId],
      );

      if (!lockedCampaign.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const existingDeliveries = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM push_deliveries
          WHERE campaign_id = $1
        `,
        [campaignId],
      );

      if (Number(existingDeliveries.rows[0]?.count ?? '0') > 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const result = await client.query<{ id: string }>(
        `
          UPDATE push_campaigns
          SET status = 'sending'
          WHERE id = $1 AND status IN ('draft', 'scheduled', 'failed')
          RETURNING id
        `,
        [campaignId],
      );

      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query('COMMIT');
      return await this.getPushCampaignById(campaignId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setPushCampaignStatus(campaignId: string, status: PushCampaignSummary['status']) {
    const result = await this.pool.query<{ id: string }>(
      `
        UPDATE push_campaigns
        SET status = $2
        WHERE id = $1
        RETURNING id
      `,
      [campaignId, status],
    );

    if (!result.rows[0]) {
      return null;
    }

    return await this.getPushCampaignById(campaignId);
  }

  async preparePushCampaignDeliveries(campaignId: string) {
    const eligibleDevices = await this.pool.query<{
      id: string;
      expo_push_token: string;
    }>(
      `
        SELECT d.id, d.expo_push_token
        FROM devices d
        WHERE d.push_permission_granted = TRUE
          AND d.expo_push_token IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM push_deliveries pd
            WHERE pd.campaign_id = $1 AND pd.device_id = d.id
          )
      `,
      [campaignId],
    );

    if (eligibleDevices.rowCount === 0) {
      return 0;
    }

    let insertedCount = 0;
    const now = new Date().toISOString();

    for (let index = 0; index < eligibleDevices.rows.length; index += 200) {
      const chunk = eligibleDevices.rows.slice(index, index + 200);
      const values: unknown[] = [];
      const placeholders = chunk.map((row, chunkIndex) => {
        const offset = chunkIndex * 7;
        const deliveryId = `delivery_${randomUUID()}`;
        values.push(
          deliveryId,
          campaignId,
          row.id,
          row.expo_push_token,
          'queued',
          now,
          now,
        );

        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
      });

      await this.pool.query(
        `
          INSERT INTO push_deliveries (
            id,
            campaign_id,
            device_id,
            expo_push_token,
            status,
            created_at,
            updated_at
          )
          VALUES ${placeholders.join(', ')}
        `,
        values,
      );
      insertedCount += chunk.length;
    }

    return insertedCount;
  }

  async listQueuedPushDeliveries(campaignId: string, limit: number) {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      device_id: string;
      expo_push_token: string;
    }>(
      `
        SELECT id, campaign_id, device_id, expo_push_token
        FROM push_deliveries
        WHERE campaign_id = $1 AND status = 'queued'
        ORDER BY created_at ASC
        LIMIT $2
      `,
      [campaignId, limit],
    );

    return result.rows.map((row) => ({
      deliveryId: row.id,
      campaignId: row.campaign_id,
      deviceId: row.device_id,
      expoPushToken: row.expo_push_token,
    }));
  }

  async applyPushTicketResults(updates: PushTicketUpdate[]) {
    if (!updates.length) {
      return;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      for (const update of updates) {
        await client.query(
          `
            UPDATE push_deliveries
            SET
              status = $2,
              expo_ticket_id = $3,
              expo_receipt_id = $4,
              receipt_status = NULL,
              error_code = $5,
              error_message = $6,
              sent_at = COALESCE($7, sent_at),
              updated_at = NOW()
            WHERE id = $1
          `,
          [
            update.deliveryId,
            update.status,
            update.ticketId,
            update.ticketId,
            update.errorCode,
            update.errorMessage,
            update.sentAt,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listPendingPushReceipts(limit: number, readyBefore: string | null) {
    const result = await this.pool.query<{
      id: string;
      campaign_id: string;
      device_id: string;
      expo_push_token: string;
      expo_ticket_id: string;
      sent_at: Date;
    }>(
      `
        SELECT id, campaign_id, device_id, expo_push_token, expo_ticket_id, sent_at
        FROM push_deliveries
        WHERE status = 'ticketed'
          AND expo_ticket_id IS NOT NULL
          AND ($2::timestamptz IS NULL OR sent_at <= $2::timestamptz)
        ORDER BY sent_at ASC
        LIMIT $1
      `,
      [limit, readyBefore],
    );

    return result.rows.map((row) => ({
      deliveryId: row.id,
      campaignId: row.campaign_id,
      deviceId: row.device_id,
      expoPushToken: row.expo_push_token,
      expoTicketId: row.expo_ticket_id,
      sentAt: row.sent_at.toISOString(),
    }));
  }

  async applyPushReceiptResults(updates: PushReceiptUpdate[]) {
    if (!updates.length) {
      return;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      for (const update of updates) {
        await client.query(
          `
            UPDATE push_deliveries
            SET
              status = $2,
              receipt_status = $3,
              error_code = $4,
              error_message = $5,
              receipt_checked_at = $6,
              updated_at = NOW()
            WHERE id = $1
          `,
          [
            update.deliveryId,
            update.status,
            update.receiptStatus,
            update.errorCode,
            update.errorMessage,
            update.receiptCheckedAt,
          ],
        );

        if (update.status === 'token_invalid') {
          await client.query(
            `
              UPDATE devices
              SET expo_push_token = NULL, updated_at = NOW()
              WHERE id = $1 AND expo_push_token = $2
            `,
            [update.deviceId, update.expoPushToken],
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }

  private mapCampaignAggregate(row: CampaignAggregateRow) {
    return buildPushCampaignSummary(this.mode, {
      id: row.id,
      title: row.title,
      message: row.message,
      audienceLabel: row.audience_label,
      scheduledFor: row.scheduled_for?.toISOString() ?? null,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      deliveryStats: {
        total: Number(row.delivery_total),
        pending: Number(row.delivery_pending),
        success: Number(row.delivery_success),
        failed: Number(row.delivery_failed),
        invalid: Number(row.delivery_invalid),
      },
      lastSentAt: row.last_sent_at?.toISOString() ?? null,
      lastReceiptCheckedAt: row.last_receipt_checked_at?.toISOString() ?? null,
    });
  }

  private async pruneExpiredAppOpensIfNeeded() {
    const now = Date.now();

    if (
      this.isPruningExpiredAppOpens ||
      now - this.lastAppOpenPrunedAt < this.appOpenRetentionSweepIntervalMs
    ) {
      return;
    }

    this.isPruningExpiredAppOpens = true;

    try {
      const retentionCutoff = new Date(
        now - this.appOpenRetentionDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      await this.pool.query(
        `
          DELETE FROM app_opens
          WHERE opened_at < $1
        `,
        [retentionCutoff],
      );
      this.lastAppOpenPrunedAt = now;
    } catch (error) {
      console.error('Failed to prune expired app opens', error);
    } finally {
      this.isPruningExpiredAppOpens = false;
    }
  }
}

function buildPool(databaseUrl: string) {
  const shouldUseSsl =
    process.env.DATABASE_SSL === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'false');
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';

  return new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl ? { rejectUnauthorized } : undefined,
  });
}

export function createActivityStore(options: ActivityStoreOptions = {}): ActivityStore {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const appOpenRetentionDays = Math.max(
    1,
    Number(options.appOpenRetentionDays ?? process.env.APP_OPEN_RETENTION_DAYS ?? 90),
  );

  if (databaseUrl) {
    return new PostgresActivityStore(buildPool(databaseUrl), appOpenRetentionDays);
  }

  return new MemoryActivityStore(appOpenRetentionDays);
}
