const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');

const env = require('./config/env');
const logger = require('./config/logger');
const { globalRateLimiter } = require('./config/rateLimiter');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const ApiResponse = require('./utils/ApiResponse');
const routes = require('./routes');

const app = express();

// 1. Security headers (CSP, HSTS, etc.)
app.use(helmet());

// 2. CORS — single allowed origin from env, credentials on for the refresh cookie
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));

// 3. gzip all responses over 1KB
app.use(compression());

// 4. Parse JSON request bodies
app.use(express.json({ limit: '10kb' }));

// 4b. Parse cookies — needed from Phase 2 onward to read the HttpOnly
//     refreshToken cookie on /auth/refresh and /auth/logout. Not part of
//     the original documented 1-12 middleware order (written before the
//     auth module existed); inserted here, right after body parsing and
//     before sanitization, rather than reordering anything documented.
app.use(cookieParser());

// 5. Strip `$` and `.` from input — prevents NoSQL injection
app.use(mongoSanitize());

// 6. Global rate limiter — 100 requests per 15 minutes per IP.
//    (Exempts /api/v1/health via its own `skip` config — see rateLimiter.js.)
app.use(globalRateLimiter);

// 7. Request ID — attach a UUID to every request as X-Request-ID
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// 8. HTTP access logging piped through Winston
app.use(
  morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// 9. Health check — no auth, not rate-limited
app.get('/api/v1/health', (req, res) => {
  return ApiResponse.success(
    res,
    { status: 'ok', timestamp: new Date().toISOString() },
    'Rayza Budget API is healthy'
  );
});

// 10. All domain module routes
app.use('/api/v1', routes);

// 11. 404 handler for unknown routes
app.use(notFound);

// 12. Global error handler — must always be last
app.use(errorHandler);

module.exports = app;
