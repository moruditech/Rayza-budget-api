const winston = require('winston');
const env = require('./env');

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
  })
);

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.NODE_ENV === 'production' ? winston.format.json() : devFormat
  ),
  transports: [new winston.transports.Console()],
  // Keep test output clean — assertions matter, not log noise.
  silent: env.NODE_ENV === 'test',
});

module.exports = logger;
