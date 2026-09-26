const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { connectDB, disconnectDB } = require('../../src/config/db');

let mongoServer;

/** Start an in-memory Mongo instance and connect Mongoose to it. Call in beforeAll(). */
async function connectTestDB() {
  mongoServer = await MongoMemoryServer.create();
  await connectDB(mongoServer.getUri(), 0);
}

/** Wipe all collections between tests. Call in afterEach(). */
async function clearTestDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

/** Disconnect and stop the in-memory instance. Call in afterAll(). */
async function closeTestDB() {
  await disconnectDB();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

module.exports = { connectTestDB, clearTestDB, closeTestDB };
