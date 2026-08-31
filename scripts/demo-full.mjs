/* global process, URL, setTimeout */
import { spawn } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/peraquest_demo'
const useManagedPostgres = !process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...options.env },
  })
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)))
  child.on('error', reject)
})

if (useManagedPostgres) {
  await run('docker', [
    'run',
    '--name', 'peraquest-demo-postgres',
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_DB=peraquest_demo',
    '-p', '54329:5432',
    '-d',
    'postgres:16-alpine',
  ]).catch(async () => {
    await run('docker', ['start', 'peraquest-demo-postgres'])
  })
  await new Promise((resolve) => setTimeout(resolve, 2500))
}

await run('npm', ['run', 'migrate', '-w', '@peraquest/api'], { env: { DATABASE_URL: databaseUrl } })
await run('npm', ['run', 'seed:demo', '-w', '@peraquest/api'], { env: { DATABASE_URL: databaseUrl } })

const sharedEnv = {
  DATABASE_URL: databaseUrl,
  DEMO_API_ENABLED: 'true',
  DEMO_SESSION_SECRET: 'local-demo-session-secret',
  CONSENT_VERSION_REQUIRED: 'v1',
  VOICE_FEATURE_PUBLIC_ENABLED: 'true',
  AI_VENDOR_APPROVED: 'true',
  VOICE_UPLOAD_BUCKET: 'peraquest-demo-voice',
  VOICE_UPLOAD_REGION: 'ap-northeast-1',
  VOICE_UPLOAD_ENDPOINT: 'https://storage.demo.test',
  VOICE_UPLOAD_ACCESS_KEY_ID: 'DEMO_ACCESS_KEY',
  VOICE_UPLOAD_SECRET_ACCESS_KEY: 'demo-secret-only-used-for-local-signing',
}

const api = spawn('npm', ['run', 'dev', '-w', '@peraquest/api'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...sharedEnv },
})
const web = spawn('npm', ['run', 'dev', '-w', '@peraquest/web'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_API_BASE_URL: 'http://localhost:3000',
    VITE_API_DEMO_MODE: 'live',
    VITE_DEMO_STAGE_EXAM_ID: '11111111-1111-4111-8111-111111111111',
  },
})

const shutdown = () => {
  api.kill('SIGTERM')
  web.kill('SIGTERM')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
