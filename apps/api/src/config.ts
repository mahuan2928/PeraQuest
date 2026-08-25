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
})

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env) => schema.parse(environment)
