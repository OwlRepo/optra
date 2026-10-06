import http from 'http'

// dotenv (used by @nestjs/config) never overrides a var already present in
// process.env, so setting this here — before any spec's AppModule boots —
// forces every e2e test onto the console-log OTP/invite fallback instead of
// the real Resend account configured in the developer's local `.env`. Without
// this, every e2e spec that registers a user (all of them) makes a live call
// to Resend and fails if the configured sending domain isn't verified there.
process.env.EMAIL_OTP_ENABLED = 'false'

// Namespace this worker's Bull queues. Every e2e spec boots the full AppModule,
// which registers real Bull consumers - so without this, parallel jest workers
// and a running `optra-api` dev container all compete for the same jobs. A job
// stolen by another consumer is processed against a DIFFERENT in-memory
// StorageService stub (or the real S3), and the file it needs is not there, so
// the enqueueing spec times out waiting for status='done' and the thief logs
// "The specified key does not exist". Per-pid keeps each worker isolated.
process.env.BULL_PREFIX = `bull-e2e-${process.pid}`

// Timestamps are stored without a zone and Postgres runs in UTC; production
// runs in UTC. A non-UTC host would read fresh rows as hours old and let the
// services' stale-job sweeps act on them.
process.env.TZ = 'UTC'

// supertest listens on a fresh ephemeral port per request and closes the
// server after it. Node 19+'s global agent keeps sockets alive, so when a later
// request drew a port an earlier, already-closed server had used, the pooled
// socket was reused and the request died as "socket hang up" (about one full
// run in six). A fresh connection per request removes the stale pool.
http.globalAgent = new http.Agent({ keepAlive: false })

// Every supertest request comes from 127.0.0.1, so a whole spec file shares
// one global-throttler bucket (60/min by default) and long suites such as
// procurement trip 429s unrelated to the behaviour under test. Same reason
// and value as the browser suite (apps/e2e/support/env.ts). The per-route
// auth limits (`@Throttle`) are not configurable and keep their own e2e
// coverage in auth-rate-limit.e2e-spec.ts.
process.env.THROTTLE_DEFAULT_LIMIT ??= '100000'
