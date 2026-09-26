const { createClient } = require('redis');
const env = require('./env');
const logger = require('./logger');

const redisClient = createClient({ url: env.REDIS_URL });

redisClient.on('error', (err) => logger.error('Redis client error', err));
redisClient.on('connect', () => logger.info('Redis connected'));
redisClient.on('reconnecting', () => logger.warn('Redis reconnecting...'));

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
}

async function disconnectRedis() {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}

module.exports = { redisClient, connectRedis, disconnectRedis };
