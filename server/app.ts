import cors, { type CorsRequest } from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_APP_CONTENT } from '../src/data/content';
import { appContentSchema } from '../src/shared/contentSchema';
import type { AppContent } from '../src/types/content';

type ContentServerOptions = {
  port?: number;
  adminUser?: string;
  adminPassword?: string;
  allowedOrigins?: string[];
  projectRoot?: string;
  contentFilePath?: string;
  contentSeedFilePath?: string;
};

export function createContentServer(options: ContentServerOptions = {}) {
  const app = express();

  const port = options.port ?? Number(process.env.PORT ?? process.env.CONTENT_SERVER_PORT ?? 4000);
  const adminUser = options.adminUser ?? process.env.CONTENT_SERVER_ADMIN_USER ?? 'admin';
  const adminPassword =
    options.adminPassword ?? process.env.CONTENT_SERVER_ADMIN_PASSWORD ?? 'change-me';
  const adminRateLimitWindowMs = 60 * 1000;
  const adminRateLimitMax = 30;
  const allowedOrigins = new Set(
    (
      options.allowedOrigins ??
      (process.env.CONTENT_SERVER_ALLOWED_ORIGINS ??
        'http://localhost:8081,http://localhost:19006,http://localhost:3000')
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean)
    ),
  );

  const projectRoot = options.projectRoot ?? process.cwd();
  const contentFilePath =
    options.contentFilePath ??
    process.env.CONTENT_FILE_PATH ??
    path.resolve(projectRoot, 'content', 'app-content.json');
  const contentSeedFilePath =
    options.contentSeedFilePath ?? path.resolve(projectRoot, 'content', 'app-content.json');
  const adminPagePath = path.resolve(projectRoot, 'server', 'public', 'admin.html');
  const contentPathsAreShared =
    path.resolve(contentSeedFilePath) === path.resolve(contentFilePath);

  let writeInProgress = false;

  const rateLimitState = new Map<
    string,
    {
      count: number;
      resetAt: number;
    }
  >();

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  function getSingleHeaderValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }

  function isSameOriginRequest(req: CorsRequest, origin: string) {
    const host = getSingleHeaderValue(req.headers['x-forwarded-host']) ?? req.headers.host;

    if (!host) {
      return false;
    }

    const protocol =
      getSingleHeaderValue(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() ?? 'http';
    return origin === `${protocol}://${host}`;
  }

  app.use(
    '/api/content',
    cors((req, callback) => {
      const origin = getSingleHeaderValue(req.headers.origin);

      const corsOptions = {
        origin: true,
        methods: ['GET', 'PUT', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      };

      if (!origin) {
        callback(null, corsOptions);
        return;
      }

      if (allowedOrigins.has(origin) || isSameOriginRequest(req, origin)) {
        callback(null, corsOptions);
        return;
      }

      callback(new Error('Origin not allowed'));
    }),
  );

  app.use('/api/content', (error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (error.message === 'Origin not allowed') {
      res.status(403).json({
        message: 'This origin is not allowed to access the content API.',
      });
      return;
    }

    next(error);
  });

  function getAdminRateLimitKey(req: Request) {
    return `${req.ip}:${req.path}`;
  }

  function adminRateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = getAdminRateLimitKey(req);
    const existing = rateLimitState.get(key);

    if (!existing || existing.resetAt < now) {
      rateLimitState.set(key, {
        count: 1,
        resetAt: now + adminRateLimitWindowMs,
      });
      next();
      return;
    }

    if (existing.count >= adminRateLimitMax) {
      res.status(429).json({
        message: 'Too many admin requests. Try again in a minute.',
      });
      return;
    }

    existing.count += 1;
    next();
  }

  function parseBasicAuthHeader(headerValue: string | undefined) {
    if (!headerValue || !headerValue.startsWith('Basic ')) {
      return null;
    }

    const encoded = headerValue.slice('Basic '.length);
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');

    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  }

  function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
    const credentials = parseBasicAuthHeader(req.header('authorization'));

    if (
      !credentials ||
      credentials.username !== adminUser ||
      credentials.password !== adminPassword
    ) {
      res.setHeader('WWW-Authenticate', 'Basic realm="soaek-bank-admin"');
      res.status(401).send('Authentication required.');
      return;
    }

    next();
  }

  function withFreshUpdatedAt(content: AppContent): AppContent {
    return {
      ...content,
      updatedAt: new Date().toISOString(),
    };
  }

  async function writeContentFile(content: AppContent) {
    if (writeInProgress) {
      const error = new Error('Content file is being updated.');
      error.name = 'ContentWriteInProgress';
      throw error;
    }

    writeInProgress = true;

    try {
      const validatedContent = appContentSchema.parse(withFreshUpdatedAt(content));
      const tempFilePath = `${contentFilePath}.tmp`;

      await fs.writeFile(tempFilePath, `${JSON.stringify(validatedContent, null, 2)}\n`, 'utf8');
      await fs.rename(tempFilePath, contentFilePath);

      return validatedContent;
    } finally {
      writeInProgress = false;
    }
  }

  async function ensureContentFile() {
    await fs.mkdir(path.dirname(contentFilePath), { recursive: true });

    try {
      await fs.access(contentFilePath);
    } catch {
      await writeContentFile(DEFAULT_APP_CONTENT);
    }
  }

  async function readSeedContentFile() {
    const rawValue = await fs.readFile(contentSeedFilePath, 'utf8');
    const parsedValue = JSON.parse(rawValue);
    return appContentSchema.parse(parsedValue);
  }

  async function readContentFile() {
    await ensureContentFile();

    try {
      const rawValue = await fs.readFile(contentFilePath, 'utf8');
      const parsedValue = JSON.parse(rawValue);
      return appContentSchema.parse(parsedValue);
    } catch (error) {
      const brokenCopyPath = `${contentFilePath}.broken-${Date.now()}`;

      await fs.copyFile(contentFilePath, brokenCopyPath).catch(() => undefined);
      console.error('Content file was invalid. Restoring defaults.', error);

      return await writeContentFile(DEFAULT_APP_CONTENT);
    }
  }

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      port,
    });
  });

  app.get('/api/content', async (_req, res) => {
    try {
      const content = await readContentFile();
      res.json(content);
    } catch (error) {
      console.error('Failed to read content file', error);
      res.status(500).json({
        message: 'Failed to read content file.',
      });
    }
  });

  app.put('/api/content', adminRateLimit, requireAdminAuth, async (req, res) => {
    const validation = appContentSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        message: 'Invalid content payload.',
        issues: validation.error.issues,
      });
      return;
    }

    try {
      const savedContent = await writeContentFile(validation.data);
      res.json(savedContent);
    } catch (error) {
      if (error instanceof Error && error.name === 'ContentWriteInProgress') {
        res.status(409).json({
          message: 'Another content save is already in progress.',
        });
        return;
      }

      console.error('Failed to write content file', error);
      res.status(500).json({
        message: 'Failed to save content file.',
      });
    }
  });

  app.post('/api/content/sync-from-repo', adminRateLimit, requireAdminAuth, async (_req, res) => {
    if (contentPathsAreShared) {
      res.status(409).json({
        message:
          'Seed file and live content file are the same path. Set CONTENT_FILE_PATH to use this action.',
      });
      return;
    }

    try {
      const repoContent = await readSeedContentFile();
      const savedContent = await writeContentFile(repoContent);
      res.json(savedContent);
    } catch (error) {
      if (error instanceof Error && error.name === 'ContentWriteInProgress') {
        res.status(409).json({
          message: 'Another content save is already in progress.',
        });
        return;
      }

      console.error('Failed to sync content from repo', error);
      let detail = 'Unknown failure.';

      if (error instanceof SyntaxError) {
        detail = 'The deployed seed file contains invalid JSON.';
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        detail = 'The deployed seed file could not be found.';
      } else if (error instanceof Error && error.name === 'ZodError') {
        detail = 'The deployed seed file failed content schema validation.';
      }

      res.status(500).json({
        message: `Failed to sync content from repo. ${detail}`,
      });
    }
  });

  app.get('/admin', adminRateLimit, requireAdminAuth, (_req, res) => {
    res.sendFile(adminPagePath);
  });

  app.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  return {
    app,
    port,
    adminPassword,
    ensureContentFile,
  };
}
