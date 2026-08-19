import { Pool } from 'pg'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { MemoryStudentRepository, PostgresStudentRepository } from './repository.js'

const config = loadConfig()
if (config.NODE_ENV === 'production' && !config.DATABASE_URL) throw new Error('DATABASE_URL is required in production')

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null
const repository = pool ? new PostgresStudentRepository(pool) : new MemoryStudentRepository()
const app = buildApp({ repository })
if (pool) app.addHook('onClose', async () => pool.end())
await app.listen({ port: config.PORT, host: '0.0.0.0' })
