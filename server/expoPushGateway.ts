const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const EXPO_PUSH_MAX_MESSAGES_PER_REQUEST = 100;
const EXPO_PUSH_MAX_RECEIPTS_PER_REQUEST = 1000;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  sound?: 'default';
};

export type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
};

export type ExpoPushReceipt = {
  status: 'ok' | 'error';
  message?: string;
  details?: {
    error?: string;
  };
};

export type ExpoPushGateway = {
  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  getReceipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>>;
  isExpoPushToken(token: string): boolean;
};

type FetchLike = typeof fetch;

type ExpoPushGatewayOptions = {
  accessToken?: string;
  fetchImpl?: FetchLike;
};

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

function normalizeExpoPushTicket(value: unknown): ExpoPushTicket {
  if (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'ok' || value.status === 'error')
  ) {
    const record = value as Record<string, unknown>;
    const details =
      typeof record.details === 'object' && record.details !== null
        ? (record.details as Record<string, unknown>)
        : undefined;

    return {
      status: record.status as 'ok' | 'error',
      id: typeof record.id === 'string' ? record.id : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
      details:
        details && typeof details.error === 'string'
          ? {
              error: details.error,
            }
          : undefined,
    };
  }

  return {
    status: 'error',
    message: 'Expo push API returned an unexpected ticket payload.',
    details: {
      error: 'MalformedTicketResponse',
    },
  };
}

function normalizeExpoPushReceipt(value: unknown): ExpoPushReceipt | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'ok' || value.status === 'error')
  ) {
    const record = value as Record<string, unknown>;
    const details =
      typeof record.details === 'object' && record.details !== null
        ? (record.details as Record<string, unknown>)
        : undefined;

    return {
      status: record.status as 'ok' | 'error',
      message: typeof record.message === 'string' ? record.message : undefined,
      details:
        details && typeof details.error === 'string'
          ? {
              error: details.error,
            }
          : undefined,
    };
  }

  return null;
}

function createChunkFailureTickets(length: number, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown Expo push send error.';

  return Array.from({ length }, () => ({
    status: 'error' as const,
    message,
    details: {
      error: 'SendRequestFailed',
    },
  }));
}

function parseExpoSendPayload(payload: unknown, expectedLength: number) {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'data' in payload &&
    Array.isArray((payload as { data: unknown }).data)
  ) {
    const data = (payload as { data: unknown[] }).data.map(normalizeExpoPushTicket);

    if (data.length === expectedLength) {
      return data;
    }
  }

  return Array.from({ length: expectedLength }, () => ({
    status: 'error' as const,
    message: 'Expo push API returned an unexpected ticket array length.',
    details: {
      error: 'MalformedTicketResponse',
    },
  }));
}

function parseExpoReceiptPayload(payload: unknown) {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'data' in payload &&
    typeof (payload as { data: unknown }).data === 'object' &&
    (payload as { data: unknown }).data !== null
  ) {
    const mapped: Record<string, ExpoPushReceipt> = {};

    Object.entries((payload as { data: Record<string, unknown> }).data).forEach(([key, value]) => {
      const receipt = normalizeExpoPushReceipt(value);

      if (receipt) {
        mapped[key] = receipt;
      }
    });

    return mapped;
  }

  throw new Error('Expo push API returned an unexpected receipts payload.');
}

export function createExpoPushGateway(options: ExpoPushGatewayOptions = {}): ExpoPushGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = options.accessToken ?? process.env.EXPO_PUSH_ACCESS_TOKEN;

  return {
    async send(messages) {
      const tickets: ExpoPushTicket[] = [];

      for (const chunk of chunkArray(messages, EXPO_PUSH_MAX_MESSAGES_PER_REQUEST)) {
        try {
          const response = await fetchImpl(EXPO_PUSH_SEND_URL, {
            method: 'POST',
            headers: buildHeaders(accessToken),
            body: JSON.stringify(chunk),
          });

          if (!response.ok) {
            throw new Error(`Expo push send failed with HTTP ${response.status}.`);
          }

          const payload = await response.json();
          tickets.push(...parseExpoSendPayload(payload, chunk.length));
        } catch (error) {
          tickets.push(...createChunkFailureTickets(chunk.length, error));
        }
      }

      return tickets;
    },

    async getReceipts(ids) {
      const receipts: Record<string, ExpoPushReceipt> = {};

      for (const chunk of chunkArray(ids, EXPO_PUSH_MAX_RECEIPTS_PER_REQUEST)) {
        try {
          const response = await fetchImpl(EXPO_PUSH_RECEIPTS_URL, {
            method: 'POST',
            headers: buildHeaders(accessToken),
            body: JSON.stringify({
              ids: chunk,
            }),
          });

          if (!response.ok) {
            throw new Error(`Expo receipt sync failed with HTTP ${response.status}.`);
          }

          const payload = await response.json();
          Object.assign(receipts, parseExpoReceiptPayload(payload));
        } catch (error) {
          console.error('Expo receipt chunk sync failed.', error);
        }
      }

      return receipts;
    },

    isExpoPushToken(token) {
      return /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(token);
    },
  };
}
