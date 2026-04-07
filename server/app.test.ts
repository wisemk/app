import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_APP_CONTENT } from '../src/data/content';
import { createActivityStore } from './activityStore';
import { createContentServer } from './app';
import type { ExpoPushGateway, ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from './expoPushGateway';

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'test-pass-123';

const tempRoots: string[] = [];

type TestAppOptions = {
  seedContent?: typeof DEFAULT_APP_CONTENT;
  separateLiveContentFile?: boolean;
  pushGateway?: ExpoPushGateway;
};

function createFakePushGateway(options?: {
  tickets?: ExpoPushTicket[];
  receipts?: Record<string, ExpoPushReceipt>;
}): ExpoPushGateway {
  return {
    async send(messages: ExpoPushMessage[]) {
      return (
        options?.tickets ??
        messages.map((_, index) => ({
          status: 'ok',
          id: `ticket-${index + 1}`,
        }))
      );
    },
    async getReceipts(ids: string[]) {
      if (options?.receipts) {
        return options.receipts;
      }

      return Object.fromEntries(
        ids.map((id) => [
          id,
          {
            status: 'ok',
          } satisfies ExpoPushReceipt,
        ]),
      );
    },
    isExpoPushToken(token: string) {
      return /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(token);
    },
  };
}

async function createFixtureRoot(seedContent = DEFAULT_APP_CONTENT) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soaek-bank-server-'));
  tempRoots.push(root);

  await fs.mkdir(path.join(root, 'server', 'public'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'server', 'public', 'admin.html'),
    '<html><body>admin</body></html>\n',
    'utf8',
  );
  await fs.mkdir(path.join(root, 'content'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'content', 'app-content.json'),
    `${JSON.stringify(seedContent, null, 2)}\n`,
    'utf8',
  );

  return root;
}

async function createTestApp(options: TestAppOptions = {}) {
  const projectRoot = await createFixtureRoot(options.seedContent);
  const contentFilePath = options.separateLiveContentFile
    ? path.join(projectRoot, 'var', 'data', 'app-content.json')
    : undefined;
  const server = createContentServer({
    port: 4100,
    projectRoot,
    contentFilePath,
    activityStore: createActivityStore({
      databaseUrl: '',
    }),
    pushGateway: options.pushGateway ?? createFakePushGateway(),
    autoPushReceiptSync: false,
    adminUser: ADMIN_USER,
    adminPassword: ADMIN_PASSWORD,
    allowedOrigins: ['http://allowed.example'],
  });

  await server.ensureContentFile();

  return {
    projectRoot,
    contentFilePath: contentFilePath ?? path.join(projectRoot, 'content', 'app-content.json'),
    app: server.app,
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('content server', () => {
  it('returns health status', async () => {
    const { app } = await createTestApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.activityStoreMode).toBe('memory');
  });

  it('returns content JSON', async () => {
    const { app } = await createTestApp();

    const response = await request(app).get('/api/content');

    expect(response.status).toBe(200);
    expect(response.body.business.brandName).toBe(DEFAULT_APP_CONTENT.business.brandName);
    expect(response.body.schemaVersion).toBe(1);
  });

  it('registers a device activity payload', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .post('/api/device/register')
      .send({
        installationId: 'install_test_1',
        customerExternalId: 'customer-001',
        platform: 'android',
        appVersion: '1.0.0',
        expoPushToken: 'ExponentPushToken[test-token]',
        pushPermissionGranted: true,
        deviceLabel: 'Galaxy S24',
        deviceOsVersion: '14',
      });

    expect(response.status).toBe(201);
    expect(response.body.installationId).toBe('install_test_1');
    expect(response.body.customerExternalId).toBe('customer-001');
    expect(response.body.storageMode).toBe('memory');
  });

  it('records an app open event', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .post('/api/app-open')
      .send({
        installationId: 'install_test_2',
        customerExternalId: 'customer-002',
        openedAt: new Date().toISOString(),
        source: 'launch',
        appVersion: '1.0.0',
      });

    expect(response.status).toBe(201);
    expect(response.body.installationId).toBe('install_test_2');
    expect(response.body.source).toBe('launch');
    expect(response.body.storageMode).toBe('memory');
  });

  it('rejects admin page without auth', async () => {
    const { app } = await createTestApp();

    const response = await request(app).get('/admin');

    expect(response.status).toBe(401);
  });

  it('serves admin page with auth', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .get('/admin')
      .auth(ADMIN_USER, ADMIN_PASSWORD);

    expect(response.status).toBe(200);
    expect(response.text).toContain('admin');
  });

  it('rejects content save without auth', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .put('/api/content')
      .send(DEFAULT_APP_CONTENT);

    expect(response.status).toBe(401);
  });

  it('creates and lists push campaigns with auth', async () => {
    const { app } = await createTestApp();

    const createResponse = await request(app)
      .post('/api/push/campaigns')
      .auth(ADMIN_USER, ADMIN_PASSWORD)
      .send({
        title: '월말 리마인드',
        message: '이번 달 마감 전에 다시 확인해보세요.',
        audienceLabel: '휴면 고객',
        scheduledFor: null,
        createdBy: 'admin',
      });
    const listResponse = await request(app)
      .get('/api/push/campaigns')
      .auth(ADMIN_USER, ADMIN_PASSWORD);

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.title).toBe('월말 리마인드');
    expect(createResponse.body.storageMode).toBe('memory');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].title).toBe('월말 리마인드');
  });

  it('sends a push campaign and resolves Expo receipts', async () => {
    const { app } = await createTestApp({
      pushGateway: createFakePushGateway({
        tickets: [
          {
            status: 'ok',
            id: 'ticket-success-1',
          },
        ],
        receipts: {
          'ticket-success-1': {
            status: 'ok',
          },
        },
      }),
    });

    await request(app)
      .post('/api/device/register')
      .send({
        installationId: 'push-device-1',
        customerExternalId: 'push-customer-1',
        platform: 'android',
        appVersion: '1.0.0',
        expoPushToken: 'ExpoPushToken[push-device-1]',
        pushPermissionGranted: true,
        deviceLabel: 'Galaxy S25',
        deviceOsVersion: '15',
      })
      .expect(201);

    const sendResponse = await request(app)
      .post('/api/push/campaigns/send')
      .auth(ADMIN_USER, ADMIN_PASSWORD)
      .send({
        title: '월말 알림',
        message: '앱에서 다시 확인해보세요.',
        audienceLabel: '푸시 허용 고객',
        scheduledFor: null,
        createdBy: 'admin',
      });

    expect(sendResponse.status).toBe(201);
    expect(sendResponse.body.targetedCount).toBe(1);
    expect(sendResponse.body.ticketedCount).toBe(1);
    expect(sendResponse.body.campaign.status).toBe('queued');
    expect(sendResponse.body.campaign.deliveryStats.pending).toBe(1);

    const syncResponse = await request(app)
      .post('/api/push/receipts/sync')
      .auth(ADMIN_USER, ADMIN_PASSWORD)
      .send({
        force: true,
      });

    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.checkedCount).toBe(1);
    expect(syncResponse.body.updatedCount).toBe(1);

    const campaignsResponse = await request(app)
      .get('/api/push/campaigns')
      .auth(ADMIN_USER, ADMIN_PASSWORD);

    expect(campaignsResponse.status).toBe(200);
    expect(campaignsResponse.body[0].status).toBe('completed');
    expect(campaignsResponse.body[0].deliveryStats.success).toBe(1);
    expect(campaignsResponse.body[0].deliveryStats.pending).toBe(0);
  });

  it('saves valid content with auth', async () => {
    const { app } = await createTestApp();
    const nextContent = {
      ...DEFAULT_APP_CONTENT,
      home: {
        ...DEFAULT_APP_CONTENT.home,
        title: '테스트 제목',
      },
    };

    const response = await request(app)
      .put('/api/content')
      .auth(ADMIN_USER, ADMIN_PASSWORD)
      .send(nextContent);

    expect(response.status).toBe(200);
    expect(response.body.home.title).toBe('테스트 제목');
    expect(response.body.updatedAt).not.toBe(DEFAULT_APP_CONTENT.updatedAt);
  });

  it('rejects invalid content payload', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .put('/api/content')
      .auth(ADMIN_USER, ADMIN_PASSWORD)
      .send({
        schemaVersion: 1,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid content payload.');
  });

  it('rejects disallowed cors origins', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .get('/api/content')
      .set('Origin', 'http://evil.example');

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      'This origin is not allowed to access the content API.',
    );
  });

  it('allows same-origin admin saves from the hosted admin page', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .put('/api/content')
      .set('Host', 'localhost:4100')
      .set('Origin', 'http://localhost:4100')
      .auth(ADMIN_USER, ADMIN_PASSWORD)
      .send(DEFAULT_APP_CONTENT);

    expect(response.status).toBe(200);
  });

  it('limits repeated admin requests', async () => {
    const { app } = await createTestApp();

    for (let index = 0; index < 30; index += 1) {
      const response = await request(app)
        .get('/admin')
        .auth(ADMIN_USER, ADMIN_PASSWORD);

      expect(response.status).toBe(200);
    }

    const throttledResponse = await request(app)
      .get('/admin')
      .auth(ADMIN_USER, ADMIN_PASSWORD);

    expect(throttledResponse.status).toBe(429);
  });

  it('recovers from an invalid content file', async () => {
    const { app, projectRoot } = await createTestApp();
    const contentFilePath = path.join(projectRoot, 'content', 'app-content.json');

    await fs.writeFile(contentFilePath, '{broken json', 'utf8');

    const response = await request(app).get('/api/content');
    const contentDirEntries = await fs.readdir(path.join(projectRoot, 'content'));

    expect(response.status).toBe(200);
    expect(response.body.business.brandName).toBe(DEFAULT_APP_CONTENT.business.brandName);
    expect(contentDirEntries.some((entry) => entry.includes('.broken-'))).toBe(true);
  });

  it('syncs live content from the repo seed file', async () => {
    const repoSeedContent = {
      ...DEFAULT_APP_CONTENT,
      home: {
        ...DEFAULT_APP_CONTENT.home,
        badges: ['빠른 상담', '월말 리마인드'],
      },
    };
    const { app, contentFilePath } = await createTestApp({
      seedContent: repoSeedContent,
      separateLiveContentFile: true,
    });
    const staleContent = {
      ...DEFAULT_APP_CONTENT,
      home: {
        ...DEFAULT_APP_CONTENT.home,
        badges: ['Galaxy Android MVP', 'Server Driven'],
      },
    };

    await fs.writeFile(contentFilePath, `${JSON.stringify(staleContent, null, 2)}\n`, 'utf8');

    const syncResponse = await request(app)
      .post('/api/content/sync-from-repo')
      .auth(ADMIN_USER, ADMIN_PASSWORD);
    const savedLiveContent = JSON.parse(await fs.readFile(contentFilePath, 'utf8'));

    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.home.badges).toEqual(repoSeedContent.home.badges);
    expect(savedLiveContent.home.badges).toEqual(repoSeedContent.home.badges);
  });

  it('rejects repo sync when the live file and seed file share the same path', async () => {
    const { app } = await createTestApp();

    const response = await request(app)
      .post('/api/content/sync-from-repo')
      .auth(ADMIN_USER, ADMIN_PASSWORD);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('same path');
  });
});
