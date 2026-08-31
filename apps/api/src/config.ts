import { z } from 'zod'

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true')
const corsOrigin = z.string().min(1).refine((value) => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === value
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}, 'CORS_ORIGIN must be an exact http(s) origin without a path, credentials, or trailing slash')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: corsOrigin.default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).optional(),
  VOICE_FEATURE_PUBLIC_ENABLED: booleanFlag.default(false),
  AI_VENDOR_APPROVED: booleanFlag.default(false),
  CONSENT_VERSION_REQUIRED: z.string().min(1).default('v0'),
  VOICE_UPLOAD_BUCKET: z.string().min(1).optional(),
  VOICE_UPLOAD_REGION: z.string().min(1).optional(),
  VOICE_UPLOAD_ENDPOINT: z.string().url().optional(),
  VOICE_UPLOAD_ACCESS_KEY_ID: z.string().min(1).optional(),
  VOICE_UPLOAD_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  VOICE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  VOICE_UPLOAD_MAX_DURATION_SECONDS: z.coerce.number().int().positive().max(30 * 60).default(5 * 60),
  VOICE_UPLOAD_TICKET_TTL_SECONDS: z.coerce.number().int().positive().max(15 * 60).default(5 * 60),
  ALLOW_LEGACY_TEST_HEADERS: booleanFlag.default(false),
  AUTH_PROVIDER: z.enum(['apple', 'google', 'email_magic_link']).default('email_magic_link'),
  AUTH_ISSUER: z.string().url().default('https://issuer.example.test'),
  AUTH_AUDIENCE: z.string().min(1).default('peraquest-api'),
  AUTH_JWKS_URL: z.string().url().default('https://issuer.example.test/.well-known/jwks.json'),
  AUTH_CLOCK_SKEW_SECONDS: z.coerce.number().int().nonnegative().max(300).default(60),
  AUTH_MAX_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(3600),
  AUTH_JWKS_CACHE_MAX_AGE_MS: z.coerce.number().int().positive().default(600_000),
  AUTH_JWKS_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(30_000),
  AUTH_JWKS_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5_000),
})

const productionAuthKeys = ['AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_JWKS_URL', 'AUTH_PROVIDER'] as const

export type RuntimeConfig = z.infer<typeof schema>

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): RuntimeConfig => {
  const config = schema.parse(environment)
  if (config.NODE_ENV === 'production') {
    for (const key of productionAuthKeys) {
      if (!environment[key]?.trim()) throw new Error(`${key} is required in production`)
    }
    if (new URL(config.AUTH_ISSUER).protocol !== 'https:' || new URL(config.AUTH_JWKS_URL).protocol !== 'https:') {
      throw new Error('AUTH_ISSUER and AUTH_JWKS_URL must use HTTPS in production')
    }
  }
  return { ...config, ALLOW_LEGACY_TEST_HEADERS: config.NODE_ENV !== 'production' && config.ALLOW_LEGACY_TEST_HEADERS }
}
