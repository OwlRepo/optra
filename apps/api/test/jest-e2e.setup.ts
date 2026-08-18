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
