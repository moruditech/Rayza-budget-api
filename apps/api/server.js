const app = require('./src/app');
const env = require('./src/config/env');
const logger = require('./src/config/logger');
const { connectDB, disconnectDB } = require('./src/config/db');
const { connectRedis, disconnectRedis } = require('./src/config/redis');

let server;

async function start() {
  await connectDB();
  await connectRedis();

  server = app.listen(env.PORT, () => {
    logger.info(`Rayza Budget API listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);

  if (!server) {
    process.exit(0);
    return;
  }

  server.close(async () => {
    logger.info('HTTP server closed');
    await disconnectDB();
    await disconnectRedis();
    logger.info('MongoDB and Redis connections closed');
    process.exit(0);
  });

  // Force-exit if shutdown hangs on a stuck connection
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

module.exports = server;
