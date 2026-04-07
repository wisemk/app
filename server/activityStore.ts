import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import type {
  ActivityStorageMode,
  CreatePushCampaignRequest,
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

export type ActivityStore = {
  mode: ActivityStorageMode;
  isPersistent: boolean;
  registerDevice(input: RegisterDeviceRequest): Promise<RegisterDeviceResponse>;
  recordAppOpen(input: RecordAppOpenRequest): Promise<RecordAppOpenResponse>;
  createPushCampaign(input: CreatePushCampaignRequest): Promise<PushCampaignSummary>;
  listPushCampaigns(limit: number): Promise<PushCampaignSummary[]>;
  close(): Promise<void>;
};

type ActivityStoreOptions = {
  databaseUrl?: string;
  appOpenRetentionDays?: number;
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

function buildPushCampaignSummary(
  mode: ActivityStorageMode,
  input: {
    id: string;
    title: string;
    message: string;
    audienceLabel: string;
    scheduledFor: string | null;
    status: PushCampaignSummary['status'];
    createdBy: string;
    createdAt: string;
  },
): PushCampaignSummary {
  return {
    id: input.id,
    title: input.title,
    message: input.message,
    audienceLabel: input.audienceLabel,
    scheduledFor: input.scheduledFor,
    status: input.status,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    storageMode: mode,
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
  private pushCampaigns: PushCampaignSummary[] = [];

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
    const createdAt = new Date().toISOString();
    const campaign = buildPushCampaignSummary(this.mode, {
      id: `campaign_${randomUUID()}`,
      title: input.title,
      message: input.message,
      audienceLabel: input.audienceLabel,
      scheduledFor: normalizeNullableText(input.scheduledFor),
      status: input.scheduledFor ? 'scheduled' : 'draft',
      createdBy: input.createdBy,
      createdAt,
    });

    this.pushCampaigns.unshift(campaign);
    return campaign;
  }

  async listPushCampaigns(limit: number) {
    return this.pushCampaigns.slice(0, limit);
  }

  async close() {
    return;
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
    const result = await this.pool.query<{
      id: string;
      title: string;
      message: string;
      audience_label: string;
      scheduled_for: Date | null;
      status: PushCampaignSummary['status'];
      created_by: string;
      created_at: Date;
    }>(
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
        RETURNING id, title, message, audience_label, scheduled_for, status, created_by, created_at
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

    return buildPushCampaignSummary(this.mode, {
      id: result.rows[0].id,
      title: result.rows[0].title,
      message: result.rows[0].message,
      audienceLabel: result.rows[0].audience_label,
      scheduledFor: result.rows[0].scheduled_for?.toISOString() ?? null,
      status: result.rows[0].status,
      createdBy: result.rows[0].created_by,
      createdAt: result.rows[0].created_at.toISOString(),
    });
  }

  async listPushCampaigns(limit: number) {
    const result = await this.pool.query<{
      id: string;
      title: string;
      message: string;
      audience_label: string;
      scheduled_for: Date | null;
      status: PushCampaignSummary['status'];
      created_by: string;
      created_at: Date;
    }>(
      `
        SELECT id, title, message, audience_label, scheduled_for, status, created_by, created_at
        FROM push_campaigns
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) =>
      buildPushCampaignSummary(this.mode, {
        id: row.id,
        title: row.title,
        message: row.message,
        audienceLabel: row.audience_label,
        scheduledFor: row.scheduled_for?.toISOString() ?? null,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
      }),
    );
  }

  async close() {
    await this.pool.end();
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
