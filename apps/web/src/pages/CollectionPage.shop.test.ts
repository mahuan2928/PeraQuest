// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CollectionPage from './CollectionPage.vue'
import { studentExperienceKey } from '../composables/studentExperience'

type ShopItem = {
  code: string; kind: string; displayName: string; price: number
  owned: boolean; equipped: boolean; affordable: boolean
}

const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  code: 'hat_explorer', kind: 'accessory', displayName: 'たんけん帽', price: 40,
  owned: false, equipped: false, affordable: true, ...over,
})

let shop: { activityCoins: number; items: ShopItem[] }

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response
}

const refreshGameState = vi.fn(async () => undefined)

function mountPage() {
  // ページはインジェクトされた体験に依存します。店に関係する部分だけ本物を通します。
  const experience = new Proxy({
    session: { value: { studentToken: 'token', studentId: 's1', guardianToken: 'g' } },
    refreshGameState,
    busy: { value: false }, voiceReady: { value: false }, guardianReady: { value: true },
    learnReady: { value: true }, voiceEnabled: { value: false },
    inventoryItems: { value: [] }, badgeInventoryItems: { value: [] },
    lockedInventoryHints: { value: [] }, inventoryCollectionCount: { value: 0 },
    prepareVoicePractice: () => undefined,
  } as Record<string, unknown>, {
    get: (target, property) => target[property as string] ?? { value: [] },
  })
  return mount(CollectionPage, { global: { provide: { [studentExperienceKey as symbol]: experience } } })
}

beforeEach(() => {
  shop = { activityCoins: 100, items: [item(), item({ code: 'theme_forest', kind: 'theme', displayName: '森のいろ', price: 80, affordable: true })] }
  refreshGameState.mockClear()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/cosmetics/purchases')) {
      const code = JSON.parse(String(init?.body)).code as string
      const target = shop.items.find((entry) => entry.code === code)!
      if (shop.activityCoins < target.price) return jsonResponse({ code: 'INSUFFICIENT_COINS' }, 409)
      shop.activityCoins -= target.price
      target.owned = true
      shop.items.forEach((entry) => { entry.affordable = !entry.owned && shop.activityCoins >= entry.price })
      return jsonResponse({ outcome: 'purchased', shop })
    }
    if (url.includes('/cosmetics/equipped')) {
      const code = JSON.parse(String(init?.body)).code as string
      shop.items.forEach((entry) => { entry.equipped = entry.code === code })
      return jsonResponse({ outcome: 'purchased', shop })
    }
    if (url.includes('/cosmetics')) return jsonResponse(shop)
    return jsonResponse({}, 404)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('the coin sink on the collection page', () => {
  it('shows what the coins are for and what each item costs', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('ひみつの店')
    expect(wrapper.text()).toContain('たんけん帽')
    expect(wrapper.text()).toContain('40 コイン')
    // 見た目だけ、と言い切ることが「学力を金で買える」誤解を防ぎます。
    expect(wrapper.text()).toContain('見た目だけのアイテムです')
  })

  it('spends the coins and lets the learner wear the item', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.shop-list button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('たんけん帽 を手に入れました。')
    expect(wrapper.text()).toContain('もっています')
    expect(refreshGameState).toHaveBeenCalled()

    await wrapper.findAll('.shop-list button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('身につけています')
  })

  it('says how far away an item is instead of offering a dead button', async () => {
    shop = { activityCoins: 10, items: [item({ affordable: false })] }
    const wrapper = mountPage()
    await flushPromises()
    const button = wrapper.get('.shop-list button')
    expect(button.text()).toBe('あと 30 コイン')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('explains a refused purchase instead of doing nothing visible', async () => {
    const wrapper = mountPage()
    await flushPromises()
    shop.activityCoins = 0
    await wrapper.findAll('.shop-list button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('コインが足りません')
  })
})
