import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'

// One place for every address and name the harness uses, so the config, the
// seeding helpers and CI cannot drift apart.

export const REPO_ROOT = join(__dirname, '..', '..', '..')

export const WEB_PORT = 3100
export const API_PORT = 3101
export const OPENAI_STUB_PORT = 4010

// 127.0.0.1, not localhost: the servers bind loopback IPv4 only, and
// `localhost` can resolve to ::1 first. Chrome treats 127.0.0.1 as a secure
// context, so the BFF's Secure cookies still stick over plain http.
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`
export const API_URL = `http://127.0.0.1:${API_PORT}`

export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54322/optra_pw'

export const REDIS_HOST = process.env.E2E_REDIS_HOST ?? 'localhost'
export const REDIS_PORT = process.env.E2E_REDIS_PORT ?? '6380'

// A bucket of its own, so a run can never touch the objects a developer's
// local stack is using in `optra-documents`.
export const S3_ENDPOINT = process.env.E2E_S3_ENDPOINT ?? 'http://localhost:8433'
export const S3_REGION = 'us-east-1'
export const S3_BUCKET = 'optra-pw'

/**
 * The run id namespaces everything a run creates: users, queue keys, objects.
 * Set once by the runner process; workers inherit the environment, so a
 * worker re-evaluating the config does not mint a second id.
 */
export function runId(): string {
  if (!process.env.E2E_RUN) {
    process.env.E2E_RUN = `pw-${process.env.GITHUB_RUN_ID ?? Date.now().toString(36)}`
  }
  return process.env.E2E_RUN
}

/** The local SeaweedFS identity - dev-only, the same pair CI already uses. */
export function s3Credentials(): { accessKeyId: string; secretAccessKey: string } {
  const config = JSON.parse(readFileSync(join(REPO_ROOT, 'docker/seaweedfs/s3.json'), 'utf8'))
  const credentials = config.identities[0].credentials[0]
  return { accessKeyId: credentials.accessKey, secretAccessKey: credentials.secretKey }
}

/**
 * The API's environment, built from the committed `.env.example` rather than a
 * developer's own `.env`, so a run behaves the same on every machine and in CI.
 * Everything that must differ from local development is overridden below.
 */
export function apiEnv(): Record<string, string> {
  const base = parse(readFileSync(join(REPO_ROOT, '.env.example')))
  const { accessKeyId, secretAccessKey } = s3Credentials()
  return {
    ...base,
    NODE_ENV: 'test',
    PORT: String(API_PORT),
    DATABASE_URL,
    REDIS_HOST,
    REDIS_PORT,
    BULL_PREFIX: `bull-${runId()}`,
    S3_ENDPOINT,
    S3_REGION,
    S3_BUCKET,
    S3_FORCE_PATH_STYLE: 'true',
    S3_ACCESS_KEY: accessKeyId,
    S3_SECRET_KEY: secretAccessKey,
    // Every model call goes to the local stub. If this line is ever dropped,
    // the placeholder key is refused by real OpenAI and the tests fail loudly.
    OPENAI_BASE_URL: `http://127.0.0.1:${OPENAI_STUB_PORT}/v1`,
    OPENAI_API_KEY: 'sk-e2e-stub',
    LANGSMITH_API_KEY: '',
    LANGCHAIN_TRACING_V2: 'false',
    EMAIL_OTP_ENABLED: 'false',
    CATALOG_ENABLED: 'true',
    PROCUREMENT_AUTO_COMPARE_ENABLED: 'false',
    MAX_UPLOAD_MB: '1',
    THROTTLE_DEFAULT_LIMIT: '100000',
    WEB_URL,
  }
}
