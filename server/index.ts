import { createContentServer } from './app';

const server = createContentServer();
const shutdownTimeoutMs = 10_000;

if (process.env.NODE_ENV === 'production' && server.adminPassword === 'change-me') {
  console.error(
    'CONTENT_SERVER_ADMIN_PASSWORD must be set before starting the content server in production.',
  );
  process.exit(1);
}

const listener = server.app.listen(server.port, async () => {
  await server.ensureContentFile();

  if (process.env.NODE_ENV !== 'production' && server.adminPassword === 'change-me') {
    console.warn(
      'Content server is using the default admin password. Change CONTENT_SERVER_ADMIN_PASSWORD before exposing this server.',
    );
  }

  console.log(`Content server listening on http://localhost:${server.port}`);
  console.log(`Admin page: http://localhost:${server.port}/admin`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received. Shutting down content server...`);

  const forceExitTimer = setTimeout(() => {
    console.error('Content server did not shut down in time. Forcing exit.');
    process.exit(1);
  }, shutdownTimeoutMs);

  forceExitTimer.unref();

  listener.close(() => {
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
