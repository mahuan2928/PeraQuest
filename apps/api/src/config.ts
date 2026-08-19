import { z } from 'zod'

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true')
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  VOICE_FEATURE_PUBLIC_ENABLED: booleanFlag.default(false),
  AI_VENDOR_APPROVED: booleanFlag.default(false),
  CONSENT_VERSION_REQUIRED: z.string().min(1).default('v0'),
})

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env) => schema.parse(environment)
