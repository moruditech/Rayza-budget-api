# Rayza Budget

Pot-based zero-intent budget manager. Monorepo built with npm workspaces + Turborepo.

## Status

**Phase 5 complete — the backend is now feature-complete against Scope & Requirements.**
`alerts` (all 5 FR-13 conditions, evaluated on demand) and `reports` (all 5 FR-14
aggregation endpoints) are built, plus an audit pass across every module already in place.

### New in Phase 5
- `alerts` module — no request body or query params (matches its listing in the Backend
  Architecture doc, which gives it no `.validation.js` file, unlike every other module).
  New `ALERT_TYPES` shared constant (`POT_APPROACHING_LIMIT`, `POT_OVER_BUDGET`,
  `SINKING_FUND_READY`, `UNALLOCATED_INCOME`, `STALE_BUDGET`) — flagged since it isn't an
  enum defined in any of the five reference docs, but the frontend needs a stable string
  per alert type the same way it does for every other `*_TYPES` constant.
- `reports` module — all 5 endpoints, each validated via `validateQuery` (added in Phase 4).
- `dateUtils.js` gained `formatMonthLabel` ("Apr 2025" style, matching the report examples).

### Judgment calls in Phase 5 (flagged in code comments at the point they're made)
1. **"The current month" for `GET /alerts`** — the endpoint has no query params in the API
   Contract, and there's no server-side "active month" concept in the data model (that's
   client-only state in the frontend's `monthStore.js`). Resolved from the real calendar
   date (UTC) instead: if the user hasn't created a Month for the current year/month, the
   endpoint returns `[]`.
2. **"Total Spend" in the income-vs-spend report sums both `SpendLog` types**
   (`INSTANT_SPEND` and `SINKING_FUND_USED`), not just the narrower `Pot.spentAmount`
   definition used everywhere else — a sinking fund payout is real money leaving too, and
   this report is meant to be the whole-picture cash-flow view.
3. **Sinking-fund-progress groups by line item `name`** across months, since a clone
   creates a brand-new `LineItem` document (fresh `_id`) every time and the schema has no
   persistent "series id" linking the same ongoing goal across months. Name is the closest
   available proxy.
4. **Health-history only includes locked months** (`healthScore !== null`), per the Backend
   Architecture doc's report description ("Budget Health Score per locked month") — an
   unlocked month is omitted rather than shown as a 0.
5. Alert type strings (`POT_OVER_BUDGET`, `STALE_BUDGET`) aren't given explicit names
   anywhere in the docs, only descriptions in the FR-13 table — named for symmetry with
   the ones the API Contract's example *does* give explicit names to.

### Audit pass — findings
- **`MONTH_LOCKED` guard**: verified every write function across `income`, `pots`,
  `lineItems`, `transactions`, and `month.service.js`'s `submitRollover` calls
  `assertMonthUnlocked`; every read-only function correctly doesn't. `cloneMonth` doesn't
  need it (it creates a new month); `lockMonth` checks `ALREADY_LOCKED` instead, since
  locking is the write that creates the locked state.
- **`userId` scoping**: grepped every `.find`/`.findOne`/`.aggregate`/`.exists`/
  `.deleteMany`/`.updateOne` call site in `modules/` and `services/`. Found and fixed one
  gap: `month.service.js`'s clone-time rollover `Pot.updateOne` was missing a `userId`
  filter. Not actually exploitable (the target `_id` is derived from pots created earlier
  in the same function, never from user input), but fixed for defense-in-depth consistency
  with NFR-04 having no exceptions. `auth.service.js`'s `User.findOne({ email })` is the one
  correct place `userId` doesn't apply — login has no authenticated user yet.
- **Computed fields never stored**: confirmed `spentAmount` and `surplus` are not schema
  fields on `Pot`/`LineItem` (grepped both schemas directly) — always computed at read time
  from `SpendLog`. **One flagged discrepancy**: the original Phase 5 brief grouped
  `isReadyToUse` in with `spentAmount`/`surplus` as fields that must never be stored, but
  the Data Models & API Contract doc explicitly defines `isReadyToUse` as a **persisted**
  `LineItem` field maintained by a pre-save hook ("Pre-save hook on LineItem"). Since that
  doc is one of the five authoritative references and this was informal review guidance,
  `isReadyToUse` stays stored, matching the Data Models doc, the pre-save hook built back in
  Phase 2, and its use in indexing (`{ userId, isReadyToUse }`) and the alerts query.
- **NFR-01 (500ms), NFR-06 (env vars), NFR-07 (graceful shutdown)**: unchanged from Phase 1
  — `config/env.js` (Zod-validated), `server.js` (`SIGTERM`/`SIGINT` handling), and the
  indexes defined on every model since Phase 2 are what NFR-01 leans on; there's no
  additional code to add for these, only to confirm they're still in place, which they are.

### Verification performed this phase
- Full syntax sweep (`node --check`) across every `.js` file in `apps/api/src`, `apps/api/tests`,
  and `packages/shared`.
- A require-graph script walking every relative `require()` in `apps/api/src`: **zero broken
  paths and zero circular requires** across the whole codebase (the Phase 3/4 stub comments
  for `alerts`/`reports` are gone now that they're real).
- `tests/integration/alertsAndReports.test.js` — covers all 5 alert conditions (using a
  `targetAmount: 0` sinking fund to make `SINKING_FUND_READY` reachable without touching the
  database, and checking `UNALLOCATED_INCOME` against the same `isAfterDayOfMonth` helper
  the implementation uses, so the assertion is correct regardless of which day tests
  actually run on) and all 5 reports (including sinking-fund-progress tracked across a real
  clone). Same Redis requirement as every other integration test file.

The backend is complete through Phase 5. Remaining work is frontend integration (see the
Frontend Architecture & Monorepo Setup doc) and any operational hardening (load testing
against NFR-01, deployment config) outside this project's five phases.

## Security audit

A follow-up audit pass, done by actually reading the security-sensitive code rather than
re-asserting earlier claims: grepping every DB query call site by hand, reading
`env.js`/`rateLimiter.js`/`errorHandler.js`/CORS config fresh, and checking for the usual
suspects (prototype pollution, dynamic code execution, mass assignment, NoSQL injection).

### Fixed

1. **Timing side-channel in login (`auth.service.js`)** — previously returned immediately
   when no user matched the email, skipping `bcrypt.compare` entirely. That made "no such
   email" measurably faster than "wrong password" even though both returned the identical
   `401 INVALID_CREDENTIALS` — an attacker could enumerate registered emails purely from
   response latency. Fixed by always running `bcrypt.compare`, against the user's real
   hash if found or a fixed dummy hash (precomputed once at module load) if not, so both
   paths cost the same.
2. **No rate limiting on `/auth/register` or `PATCH /auth/password`** — only `/auth/login`
   had `authRateLimiter` applied. `/register` was open to spam-account creation and to
   running up the server's `bcrypt.hash` cost (12 rounds) repeatedly; `/password` was open
   to brute-forcing `currentPassword` at the much more permissive global 100/15min limit,
   by anyone holding a valid (or stolen) access token. Added two more limiters in
   `rateLimiter.js`:
   - `registerRateLimiter` — deliberately does **not** skip successful requests (unlike
     login/password-guessing, registration abuse looks like many *successful* requests).
   - `passwordChangeRateLimiter` — its own instance, not a reuse of `authRateLimiter`.
     express-rate-limit's default in-memory store keys by IP only, not by route, so reusing
     one `rateLimit()` call across two routes would have shared a single counter between
     login attempts and password-change attempts from the same IP.
3. **JWT secrets only required `.min(1)` in `env.js`** — a one-character secret, or the
   unedited `.env.example` placeholder itself, would have passed validation and booted the
   server with a trivially weak signing key. Now requires `.min(32)`. `.env.example`'s
   placeholders are deliberately left *short* on purpose (with a comment explaining why) —
   copying the file to `.env` without generating a real secret now fails to boot with a
   clear error, instead of silently running with a well-known value straight from this
   repo. `.env.test`'s dummy secrets were lengthened to match (no security value there,
   just needed to satisfy the schema).
4. **No upper bound on password/email length** — `express.json({ limit: '10kb' })` already
   bounded this at the transport layer, but added explicit `.max(128)` on all three password
   fields (register, login, change-password's `currentPassword`) and `.max(254)` on email
   (RFC 5321's practical limit) for predictable behavior independent of the body-size limit.

### Regression this introduced, and how it was fixed

Adding `registerRateLimiter` without `skipSuccessfulRequests` meant any test file
registering more than 10 users — `auth.test.js` (13 cases), `budgetStructure.test.js` (14),
`spendingLifecycle.test.js` (11), all via a `beforeEach` that registers a fresh user per
test case — would start failing with spurious `429`s partway through. Fixed the standard
way: all four limiters now `skip` entirely when `NODE_ENV === 'test'`. Integration tests
legitimately generate many requests from one loopback address in quick succession, which is
indistinguishable in shape from abuse to a rate limiter but isn't abuse; production and
development behavior are unaffected. This does mean rate-limiter *wiring* has no automated
test coverage — worth a manual/staging check before deploying (e.g. `for i in {1..15}; do
curl -s -o /dev/null -w '%{http_code}\n' -X POST .../auth/login -d '...'; done` should show
`429`s appear after the 10th).

### Checked, no issue found
- **Mass assignment via `Object.assign(doc, updates)`** (used in `pots`/`lineItems`/
  `income`/`transactions` update paths) — safe in practice: every Zod update schema uses
  the library's default "strip" mode (unrecognized keys silently dropped), and even if one
  slipped through, Mongoose's schemas default to `strict: true`, which drops any property
  not defined in the schema on save. Neither `_id`, `userId`, nor computed/hook-managed
  fields (`isReadyToUse`, `accumulatedBalance` on line items) appear in any update schema.
- **NoSQL injection via query params** — every filter in `spendLog.service.js` is built by
  explicitly copying named fields off the *validated* (post-Zod) query object, never via
  `{ ...req.query }` spread, so there's no path for an unexpected key (e.g. a `$where`
  operator) to reach a Mongo filter. `login`'s `email` field must satisfy `z.string()`
  before it ever reaches `User.findOne`, which alone rules out object-shaped injection
  payloads like `{ "$gt": "" }` (Zod rejects non-string input outright).
- **Cross-user data leakage via aggregation `$lookup`** — the nested `$lookup` pipelines in
  `months.service.js`'s `listMonths` match sub-collections by `monthId` alone (no `userId`
  in the inner pipeline), but this is safe because the outer `Month` query is already
  scoped to `userId`, and every `Income`/`Pot` document's `monthId` is only ever set by our
  own code from an already-`userId`-verified month — never from user input.
- **Prototype pollution / dynamic code execution** — grepped the whole `src/` tree for
  `eval(`, `new Function(`, `child_process`, computed-property assignment patterns
  (`obj[userInput] = `), and `__proto__`/`prototype[` access. No matches.
- **Stack trace / internal error leakage** — `errorHandler.js` never includes `err.stack`
  in the HTTP response (only in the server-side `logger.error` call); unhandled errors
  always return the generic `"Something went wrong"` message regardless of `NODE_ENV`.
- **CORS** — single origin from `CLIENT_URL` with `credentials: true`; not a wildcard
  (`origin: '*'` + `credentials: true` is the classic misconfiguration — not present here).
- **Password/PII logging** — `morgan('combined')` logs only standard access-log fields
  (IP, method, URL, status, size, referrer, user-agent), never the request body; grepped
  for any logger call touching `req.body` or `password` — none found.
- **Email enumeration via `409 DUPLICATE` on register** — this one's real but not a bug:
  the API Contract explicitly mandates `409 DUPLICATE — email already registered` as
  `/auth/register`'s documented response, so silently returning `201` for a duplicate email
  would violate the spec you asked me to match exactly. Flagging it as an accepted,
  spec-mandated tradeoff rather than "fixing" it against the documented contract.

### One thing worth a decision from you
Nothing else outstanding — the four fixes above (findings 1–4) are the concrete gaps found.
If you want `registerRateLimiter`/`passwordChangeRateLimiter`'s specific thresholds (10 per
15 min, same as login) tuned differently, they're isolated constants in `rateLimiter.js`.

## Getting started

```bash
# from the repo root
npm install

cp apps/api/.env.example apps/api/.env
# then fill in real values for MONGO_URI, JWT secrets, REDIS_URL, etc.

npm run dev     # starts apps/api on http://localhost:5000
npm test        # runs the api test suite
npm run lint    # lints all workspaces
```

`apps/api/.env.test` is already filled in with safe dummy values — `npm test` doesn't
need a running MongoDB or Redis for Phase 1's own tests. Starting in Phase 2, integration
tests spin up a real, temporary MongoDB via `mongodb-memory-server-core`
(see `apps/api/tests/helpers/db.js`); the first time that runs it needs network access to
download a `mongod` binary, which is then cached locally.

## Workspaces

| Path | What it is |
|---|---|
| `apps/api` | Node.js/Express backend |
| `apps/web` | React frontend — added in a later phase |
| `packages/shared` | Constants shared between api and web (`POT_TYPES`, `LINE_ITEM_TYPES`, `PAYMENT_METHODS`, `SPEND_LOG_TYPES`, `ALERT_TYPES`, `ERROR_CODES`) |
| `packages/eslint-config` | Shared ESLint rules extended by every app |

See the project's reference docs (proposal, scope & requirements, backend architecture,
data models & API contract, frontend architecture) for the full spec.
