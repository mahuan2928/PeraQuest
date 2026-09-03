import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000c1'

const asMigrationDatabase = (database: PGlite): MigrationDatabase => ({
  query: async <Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
    if (parameters === undefined && sql.split(';').filter((statement) => statement.trim().length > 0).length > 1) {
      const results = await database.exec(sql)
      return { rows: (results.at(-1)?.rows ?? []) as Row[] }
    }
    const result = await database.query<Row>(sql, parameters)
    return { rows: result.rows }
  },
})

const setup = async (coins = 0) => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  await database.query(
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)",
    [STUDENT],
  )
  await database.query(
    'INSERT INTO student_game_state (student_id, activity_coins) VALUES ($1, $2)', [STUDENT, coins],
  )
  const client = { query: database.query.bind(database), release: () => undefined }
  const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
  return { database, repository: new PostgresStudentRepository(pool) }
}

const balance = async (database: PGlite) => {
  const result = await database.query<{ activity_coins: number }>(
    'SELECT activity_coins FROM student_game_state WHERE student_id = $1', [STUDENT],
  )
  return Number(result.rows[0]!.activity_coins)
}

describe('cosmetic shop', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('offers the cheapest item within four days of daily sessions', async () => {
    const { repository } = await setup(0)
    const shop = await repository.getCosmeticShop(STUDENT)
    expect(shop.items.length).toBeGreaterThanOrEqual(3)
    // 毎日の関卡は 10 枚。いちばん安いものが 4 日で届かないと、出口があると伝わりません。
    expect(Math.min(...shop.items.map((item) => item.price))).toBeLessThanOrEqual(40)
  })

  it('spends the coins and records the purchase in the ledger', async () => {
    const { database, repository } = await setup(100)
    const result = await repository.purchaseCosmetic(STUDENT, 'hat_explorer')
    expect(result.outcome).toBe('purchased')
    expect(await balance(database)).toBe(60)
    const ledger = await database.query<{ activity_coin_delta: number; reason: string }>(
      "SELECT activity_coin_delta, reason FROM game_reward_ledger WHERE source_type = 'shop_purchase'",
    )
    expect(ledger.rows).toEqual([{ activity_coin_delta: -40, reason: 'cosmetic_purchased' }])
    expect(result.shop.items.find((item) => item.code === 'hat_explorer')).toMatchObject({ owned: true })
  })

  it('refuses to overdraw and leaves the balance untouched', async () => {
    const { database, repository } = await setup(39)
    const result = await repository.purchaseCosmetic(STUDENT, 'hat_explorer')
    expect(result.outcome).toBe('insufficient_coins')
    expect(await balance(database)).toBe(39)
    const owned = await database.query('SELECT 1 FROM student_cosmetics WHERE student_id = $1', [STUDENT])
    expect(owned.rows).toEqual([])
  })

  it('charges once when the same purchase is retried', async () => {
    const { database, repository } = await setup(100)
    await repository.purchaseCosmetic(STUDENT, 'hat_explorer')
    const second = await repository.purchaseCosmetic(STUDENT, 'hat_explorer')
    // 静かに 200 を返して何も起きないのがいちばん困るので、結果を名前で返します。
    expect(second.outcome).toBe('already_owned')
    expect(await balance(database)).toBe(60)
  })

  it('reports an unknown code instead of charging for it', async () => {
    const { database, repository } = await setup(100)
    expect((await repository.purchaseCosmetic(STUDENT, 'no_such_item')).outcome).toBe('unknown_item')
    expect(await balance(database)).toBe(100)
  })

  it('equips one item per kind and swaps within a kind', async () => {
    const { repository } = await setup(300)
    await repository.purchaseCosmetic(STUDENT, 'hat_explorer')
    await repository.purchaseCosmetic(STUDENT, 'cape_star')
    await repository.purchaseCosmetic(STUDENT, 'theme_forest')
    await repository.equipCosmetic(STUDENT, 'hat_explorer')
    await repository.equipCosmetic(STUDENT, 'theme_forest')
    const afterSwap = await repository.equipCosmetic(STUDENT, 'cape_star')
    const equipped = afterSwap!.shop.items.filter((item) => item.equipped).map((item) => item.code)
    // 種類が違うテーマは外れず、同じ種類の帽子だけが外れます。
    expect(equipped.sort()).toEqual(['cape_star', 'theme_forest'])
  })

  it('refuses to equip something the learner does not own', async () => {
    const { repository } = await setup(0)
    expect(await repository.equipCosmetic(STUDENT, 'frame_gold')).toBeNull()
  })

  it('will not let a reward row hand out negative coins', async () => {
    const { database } = await setup(0)
    await expect(database.query(`
      INSERT INTO game_reward_ledger (id, student_id, source_type, source_ref, reason, xp_delta, activity_coin_delta)
      VALUES (gen_random_uuid(), $1, 'daily_session', 'x', 'daily_session_completed', 0, -10)
    `, [STUDENT])).rejects.toThrow(/purchase_spends_only_coins/)
  })

  it('will not let a purchase row hand out XP or badges', async () => {
    const { database } = await setup(0)
    await expect(database.query(`
      INSERT INTO game_reward_ledger (id, student_id, source_type, source_ref, reason, xp_delta, activity_coin_delta, badge_codes)
      VALUES (gen_random_uuid(), $1, 'shop_purchase', 'hat_explorer', 'cosmetic_purchased', 50, -40, '{sneaky}')
    `, [STUDENT])).rejects.toThrow(/purchase_spends_only_coins/)
  })
})
