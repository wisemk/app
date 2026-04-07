import type {
  ActivityStore,
  PendingPushReceipt,
  PushSendTarget,
} from './activityStore';
import type { PushCampaignSummary, SendPushCampaignResponse, SyncPushReceiptsResponse } from '../src/types/engagement';
import type { ExpoPushGateway, ExpoPushReceipt, ExpoPushTicket } from './expoPushGateway';

type PushCampaignServiceOptions = {
  activityStore: ActivityStore;
  pushGateway: ExpoPushGateway;
  sendBatchSize?: number;
  receiptSweepIntervalMs?: number;
  receiptReadyDelayMs?: number;
  autoReceiptSync?: boolean;
};

type SyncPushReceiptOptions = {
  force?: boolean;
};

const DEFAULT_SEND_BATCH_SIZE = 100;
const DEFAULT_RECEIPT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RECEIPT_READY_DELAY_MS = 20 * 60 * 1000;

export class PushCampaignServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PushCampaignServiceError';
  }
}

function dedupeIds(values: string[]) {
  return [...new Set(values)];
}

function normalizeTicketToUpdate(
  delivery: PushSendTarget,
  ticket: ExpoPushTicket,
  sentAt: string,
) {
  if (ticket.status === 'ok' && ticket.id) {
    return {
      deliveryId: delivery.deliveryId,
      expoPushToken: delivery.expoPushToken,
      status: 'ticketed' as const,
      ticketId: ticket.id,
      errorCode: null,
      errorMessage: null,
      sentAt,
    };
  }

  return {
    deliveryId: delivery.deliveryId,
    expoPushToken: delivery.expoPushToken,
    status: 'failed' as const,
    ticketId: null,
    errorCode: ticket.details?.error ?? 'SendFailed',
    errorMessage: ticket.message ?? 'Expo push send failed.',
    sentAt,
  };
}

function normalizeReceiptToUpdate(
  delivery: PendingPushReceipt,
  receipt: ExpoPushReceipt,
) {
  const receiptCheckedAt = new Date().toISOString();

  if (receipt.status === 'ok') {
    return {
      deliveryId: delivery.deliveryId,
      campaignId: delivery.campaignId,
      deviceId: delivery.deviceId,
      expoPushToken: delivery.expoPushToken,
      status: 'receipt_ok' as const,
      receiptStatus: 'ok' as const,
      errorCode: null,
      errorMessage: null,
      receiptCheckedAt,
    };
  }

  return {
    deliveryId: delivery.deliveryId,
    campaignId: delivery.campaignId,
    deviceId: delivery.deviceId,
    expoPushToken: delivery.expoPushToken,
    status:
      receipt.details?.error === 'DeviceNotRegistered'
        ? ('token_invalid' as const)
        : ('receipt_error' as const),
    receiptStatus: 'error' as const,
    errorCode: receipt.details?.error ?? 'ReceiptError',
    errorMessage: receipt.message ?? 'Expo push receipt returned an error.',
    receiptCheckedAt,
  };
}

function finalizeCampaignStatus(summary: PushCampaignSummary): PushCampaignSummary['status'] {
  if (summary.deliveryStats.total === 0) {
    return 'failed';
  }

  if (summary.deliveryStats.pending > 0) {
    return 'queued';
  }

  return summary.deliveryStats.success > 0 ? 'completed' : 'failed';
}

export class PushCampaignService {
  private readonly sendBatchSize: number;
  private readonly receiptReadyDelayMs: number;
  private readonly autoReceiptSync: boolean;
  private readonly receiptSweepIntervalMs: number;
  private readonly activeCampaigns = new Set<string>();
  private isSyncingReceipts = false;
  private receiptTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: PushCampaignServiceOptions) {
    this.sendBatchSize = Math.max(1, Math.min(options.sendBatchSize ?? DEFAULT_SEND_BATCH_SIZE, 100));
    this.receiptSweepIntervalMs = Math.max(
      30_000,
      options.receiptSweepIntervalMs ?? DEFAULT_RECEIPT_SWEEP_INTERVAL_MS,
    );
    this.receiptReadyDelayMs = Math.max(
      60_000,
      options.receiptReadyDelayMs ?? DEFAULT_RECEIPT_READY_DELAY_MS,
    );
    this.autoReceiptSync = options.autoReceiptSync ?? true;

    if (this.autoReceiptSync) {
      this.receiptTimer = setInterval(() => {
        void this.syncReceipts().catch((error) => {
          console.error('Automatic Expo receipt sync failed.', error);
        });
      }, this.receiptSweepIntervalMs);
      this.receiptTimer.unref();
    }
  }

  async sendCampaign(campaignId: string): Promise<SendPushCampaignResponse> {
    if (this.activeCampaigns.has(campaignId)) {
      throw new PushCampaignServiceError('This campaign is already sending.', 409);
    }

    this.activeCampaigns.add(campaignId);

    try {
      const startedCampaign = await this.options.activityStore.tryStartPushCampaignSend(campaignId);

      if (!startedCampaign) {
        throw new PushCampaignServiceError(
          'Campaign could not enter sending state. Create a new campaign to resend.',
          409,
        );
      }

      const insertedCount = await this.options.activityStore.preparePushCampaignDeliveries(campaignId);

      if (insertedCount === 0) {
        const failedCampaign = await this.options.activityStore.setPushCampaignStatus(campaignId, 'failed');
        return {
          campaign: failedCampaign ?? startedCampaign,
          targetedCount: 0,
          ticketedCount: 0,
          failedCount: 0,
          storageMode: this.options.activityStore.mode,
        };
      }

      let ticketedCount = 0;
      let failedCount = 0;

      while (true) {
        const queuedDeliveries = await this.options.activityStore.listQueuedPushDeliveries(
          campaignId,
          this.sendBatchSize,
        );

        if (!queuedDeliveries.length) {
          break;
        }

        const validDeliveries = queuedDeliveries.filter((delivery) =>
          this.options.pushGateway.isExpoPushToken(delivery.expoPushToken),
        );
        const invalidDeliveries = queuedDeliveries.filter(
          (delivery) => !this.options.pushGateway.isExpoPushToken(delivery.expoPushToken),
        );
        const sentAt = new Date().toISOString();

        if (invalidDeliveries.length) {
          failedCount += invalidDeliveries.length;
          await this.options.activityStore.applyPushTicketResults(
            invalidDeliveries.map((delivery) => ({
              deliveryId: delivery.deliveryId,
              expoPushToken: delivery.expoPushToken,
              status: 'failed',
              ticketId: null,
              errorCode: 'InvalidExpoPushToken',
              errorMessage: 'Stored push token is not a valid Expo push token.',
              sentAt,
            })),
          );
        }

        if (!validDeliveries.length) {
          continue;
        }

        const tickets = await this.options.pushGateway.send(
          validDeliveries.map((delivery) => ({
            to: delivery.expoPushToken,
            title: startedCampaign.title,
            body: startedCampaign.message,
            data: {
              campaignId,
              audienceLabel: startedCampaign.audienceLabel,
            },
            channelId: 'marketing',
            priority: 'high',
            sound: 'default',
          })),
        );

        const ticketUpdates = validDeliveries.map((delivery, index) =>
          normalizeTicketToUpdate(delivery, tickets[index], sentAt),
        );

        ticketedCount += ticketUpdates.filter((update) => update.status === 'ticketed').length;
        failedCount += ticketUpdates.filter((update) => update.status === 'failed').length;
        await this.options.activityStore.applyPushTicketResults(ticketUpdates);
      }

      const latestSummary = await this.options.activityStore.getPushCampaignById(campaignId);

      if (!latestSummary) {
        throw new PushCampaignServiceError('Campaign disappeared after sending.', 500);
      }

      const finalCampaign = await this.options.activityStore.setPushCampaignStatus(
        campaignId,
        finalizeCampaignStatus(latestSummary),
      );

      return {
        campaign: finalCampaign ?? latestSummary,
        targetedCount: insertedCount,
        ticketedCount,
        failedCount,
        storageMode: this.options.activityStore.mode,
      };
    } finally {
      this.activeCampaigns.delete(campaignId);
    }
  }

  async syncReceipts(options: SyncPushReceiptOptions = {}): Promise<SyncPushReceiptsResponse> {
    if (this.isSyncingReceipts) {
      return {
        checkedCount: 0,
        updatedCount: 0,
        unresolvedCount: 0,
        storageMode: this.options.activityStore.mode,
      };
    }

    this.isSyncingReceipts = true;

    try {
      const readyBefore = options.force
        ? null
        : new Date(Date.now() - this.receiptReadyDelayMs).toISOString();
      const pending = await this.options.activityStore.listPendingPushReceipts(1000, readyBefore);

      if (!pending.length) {
        return {
          checkedCount: 0,
          updatedCount: 0,
          unresolvedCount: 0,
          storageMode: this.options.activityStore.mode,
        };
      }

      const receipts = await this.options.pushGateway.getReceipts(
        pending.map((delivery) => delivery.expoTicketId),
      );
      const updates = pending
        .map((delivery) => {
          const receipt = receipts[delivery.expoTicketId];
          return receipt ? normalizeReceiptToUpdate(delivery, receipt) : null;
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value));

      if (updates.length) {
        await this.options.activityStore.applyPushReceiptResults(updates);
        const affectedCampaignIds = dedupeIds(updates.map((update) => update.campaignId));

        await Promise.all(
          affectedCampaignIds.map(async (campaignId) => {
            const summary = await this.options.activityStore.getPushCampaignById(campaignId);

            if (!summary) {
              return;
            }

            await this.options.activityStore.setPushCampaignStatus(
              campaignId,
              finalizeCampaignStatus(summary),
            );
          }),
        );
      }

      return {
        checkedCount: pending.length,
        updatedCount: updates.length,
        unresolvedCount: pending.length - updates.length,
        storageMode: this.options.activityStore.mode,
      };
    } finally {
      this.isSyncingReceipts = false;
    }
  }

  async close() {
    if (this.receiptTimer) {
      clearInterval(this.receiptTimer);
      this.receiptTimer = null;
    }
  }
}
