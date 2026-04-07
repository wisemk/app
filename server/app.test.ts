import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_APP_CONTENT } from '../src/data/content';
import { createContentServer } from './app';

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'test-pass-123';

const tempRoots: string[] = [];

type TestAppOptions = {
  seedContent?: typeof DEFAULT_APP_CONTENT;
  separateLiveContentFile?: boolean;
};

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
  });

  it('returns content JSON', async () => {
    const { app } = await createTestApp();

    const response = await request(app).get('/api/content');

    expect(response.status).toBe(200);
    expect(response.body.business.brandName).toBe(DEFAULT_APP_CONTENT.business.brandName);
    expect(response.body.schemaVersion).toBe(1);
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
