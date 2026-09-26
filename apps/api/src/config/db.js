const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Connect to MongoDB with retry-with-backoff.
 * @param {string} [uri] - defaults to env.MONGO_URI; tests pass an in-memory URI instead.
 * @param {number} [retries] - remaining retry attempts.
 */
async function connectDB(uri = env.MONGO_URI, retries = MAX_RETRIES) {
  try {
    await mongoose.connect(uri);
    logger.info(`MongoDB connected: ${mongoose.connection.name}`);
  } catch (err) {
    if (retries > 0) {
      logger.warn(
        `MongoDB connection failed, retrying in ${RETRY_DELAY_MS}ms... (${retries} retries left)`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return connectDB(uri, retries - 1);
    }
    logger.error('MongoDB connection failed after max retries', err);
    throw err;
  }
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
