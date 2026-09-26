const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

// NODE_ENV must be read directly from process.env here, before the schema
// below has parsed anything, so we know which env file to load.
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(__dirname, '../../', envFile) });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  CLIENT_URL: z.string().url('CLIENT_URL must be a valid URL'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // logger.js itself depends on env.js, so we can't use the shared logger
  // here without creating a circular dependency — a direct console.error
  // is the correct choice for this one failure path.
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables — check your .env file against .env.example');
}

module.exports = parsed.data;
