// dotenv (used by @nestjs/config) never overrides a var already present in
// process.env, so setting this here — before any spec's AppModule boots —
// forces every e2e test onto the console-log OTP/invite fallback instead of
// the real Resend account configured in the developer's local `.env`. Without
// this, every e2e spec that registers a user (all of them) makes a live call
// to Resend and fails if the configured sending domain isn't verified there.
process.env.EMAIL_OTP_ENABLED = 'false'
