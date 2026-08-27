import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import { buildApp } from './app.js'
import { loadConfig, type RuntimeConfig } from './config.js'
import { MemoryStudentRepository, PostgresAuthUserResolver, PostgresStudentRepository } from './repository.js'

export const buildServerApp = (config: RuntimeConfig, pool: Pool | null) => {
  const repository = pool ? new PostgresStudentRepository(pool) : new MemoryStudentRepository()
  const authUserResolver = pool ? new PostgresAuthUserResolver(pool, config.AUTH_PROVIDER) : undefined
  const app = buildApp({ repository, config, ...(authUserResolver ? { authUserResolver } : {}) })
  if (pool) app.addHook('onClose', async () => pool.end())
  return app
}

export const startServer = async () => {
  const config = loadConfig()
  if (config.NODE_ENV === 'production' && !config.DATABASE_URL) throw new Error('DATABASE_URL is required in production')
  const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null
  const app = buildServerApp(config, pool)
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  return app
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await startServer()
