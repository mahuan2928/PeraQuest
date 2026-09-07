import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { MemoryStudentRepository } from '../src/repository.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * `/api/v1/me/` は 1 つ残らず認証が要ります。
 * 以前は保護対象を手書きの一覧で持っていたため、あとから足したルートが
 * どの分岐にも入らず認証フックを素通りしました。足し忘れが「認証なし」に
 * 倒れる設計だったので、ここでルート定義そのものを突き合わせます。
 */
describe('every /api/v1/me/ route is authenticated', () => {
  it('refuses each registered route without a token', async () => {
    const source = await readFile(resolve(here, '../src/app.ts'), 'utf8')
    const routes = [...source.matchAll(/app\.(get|post|put)(?:<[^>]*>)?\('(\/api\/v1\/me\/[^']*)'/g)]
      .map((match) => ({ method: match[1]!.toUpperCase(), url: match[2]! }))
    expect(routes.length).toBeGreaterThan(5)

    const app = buildApp({
      repository: new MemoryStudentRepository(),
      config: loadConfig({ NODE_ENV: 'test' }),
    })
    try {
      for (const route of routes) {
        const url = route.url.replace(/:([A-Za-z]+)/g, '00000000-0000-0000-0000-000000000001')
        const response = await app.inject({ method: route.method as 'GET', url })
        expect(
          [401, 403],
          `${route.method} ${url} answered ${response.statusCode} without a token`,
        ).toContain(response.statusCode)
      }
    } finally {
      await app.close()
    }
  })
})
