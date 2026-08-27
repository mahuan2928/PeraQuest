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
  ALLOW_LEGACY_TEST_HEADERS: booleanFlag.default(false),
  AUTH_ISSUER: z.string().url().default('https://issuer.example.test'),
  AUTH_AUDIENCE: z.string().min(1).default('peraquest-api'),
  AUTH_JWKS_URL: z.string().url().default('https://issuer.example.test/.well-known/jwks.json'),
  AUTH_CLOCK_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(60),
})

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env) => {
  const config = schema.parse(environment)
  return { ...config, ALLOW_LEGACY_TEST_HEADERS: config.NODE_ENV !== 'production' && config.ALLOW_LEGACY_TEST_HEADERS }
}
