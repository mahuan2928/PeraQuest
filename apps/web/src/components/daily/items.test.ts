// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WordOrderItem from './WordOrderItem.vue'
import ArticleSensorItem from './ArticleSensorItem.vue'
import KatakanaHunterItem from './KatakanaHunterItem.vue'

const wordOrderPrompt = {
  japanese: 'きのう宿題を終えました。',
  blocks: ['I', 'finished', 'my', 'homework', 'yesterday'],
}

describe('語順ブロック', () => {
  it('builds a sentence by pressing blocks, with no drag needed', async () => {
    const wrapper = mount(WordOrderItem, { props: { prompt: wordOrderPrompt, disabled: false } })
    const bank = () => wrapper.findAll('.word-order-bank button')
    expect(bank()).toHaveLength(5)

    for (const word of wordOrderPrompt.blocks) {
      await bank().find((button) => button.text() === word)!.trigger('click')
    }
    expect(wrapper.findAll('.word-order-bank button')).toHaveLength(0)

    const submit = wrapper.get('.primary-action')
    expect(submit.attributes('disabled')).toBeUndefined()
    await submit.trigger('click')
    expect(wrapper.emitted('answer')?.[0]?.[0]).toEqual(wordOrderPrompt.blocks)
  })

  it('is fully operable from the keyboard, since every control is a button', async () => {
    const wrapper = mount(WordOrderItem, { props: { prompt: wordOrderPrompt, disabled: false } })
    // ドラッグ専用の要素がないことを確認します（キーボードだけで届く）。
    expect(wrapper.findAll('[draggable="true"]')).toHaveLength(0)
    const controls = wrapper.findAll('button')
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(control.element.tagName).toBe('BUTTON')
    }
  })

  it('reorders placed words with the move controls', async () => {
    const wrapper = mount(WordOrderItem, { props: { prompt: { ...wordOrderPrompt, blocks: ['A', 'B'] }, disabled: false } })
    const bank = () => wrapper.findAll('.word-order-bank button')
    await bank().find((button) => button.text() === 'A')!.trigger('click')
    await bank().find((button) => button.text() === 'B')!.trigger('click')

    const moveBack = wrapper.findAll('.word-chip-move button').find((button) => button.attributes('aria-label')?.includes('B を前へ'))!
    await moveBack.trigger('click')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('answer')?.[0]?.[0]).toEqual(['B', 'A'])
  })

  it('takes a word back out of the sentence', async () => {
    const wrapper = mount(WordOrderItem, { props: { prompt: { ...wordOrderPrompt, blocks: ['A', 'B'] }, disabled: false } })
    await wrapper.findAll('.word-order-bank button')[0]!.trigger('click')
    expect(wrapper.findAll('.word-chip.placed')).toHaveLength(1)
    await wrapper.get('.word-chip.placed > button').trigger('click')
    expect(wrapper.findAll('.word-chip.placed')).toHaveLength(0)
  })
})

describe('冠詞センサー', () => {
  const prompt = { sentence: 'I have ___ apple.', choices: ['a', 'an', 'the', '(なし)'], timeLimitSeconds: 3 }

  it('emits the chosen article', async () => {
    const wrapper = mount(ArticleSensorItem, { props: { prompt, disabled: false } })
    await wrapper.findAll('.article-choices button').find((button) => button.text() === 'an')!.trigger('click')
    expect(wrapper.emitted('answer')?.[0]?.[0]).toBe('an')
    wrapper.unmount()
  })

  it('emits a timeout rather than a wrong answer when the clock runs out', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ArticleSensorItem, { props: { prompt, disabled: false } })
    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()
    // 時間切れは「誤答」ではなく専用のイベントとして出します（生命値を減らさないため）。
    expect(wrapper.emitted('timeout')).toBeTruthy()
    expect(wrapper.emitted('answer')).toBeUndefined()
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('stops the clock once the item is answered', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ArticleSensorItem, { props: { prompt, disabled: true } })
    vi.advanceTimersByTime(10_000)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('timeout')).toBeUndefined()
    wrapper.unmount()
    vi.useRealTimers()
  })
})

describe('和製英語ハンター', () => {
  it('shows the katakana word and emits the chosen English', async () => {
    const wrapper = mount(KatakanaHunterItem, {
      props: { prompt: { katakana: 'ノートパソコン', choices: ['note personal computer', 'laptop', 'notebook'] }, disabled: false },
    })
    expect(wrapper.get('.katakana-word').text()).toBe('ノートパソコン')
    await wrapper.findAll('.katakana-choices button').find((button) => button.text() === 'laptop')!.trigger('click')
    expect(wrapper.emitted('answer')?.[0]?.[0]).toBe('laptop')
  })

  it('never reveals whether the word is natural English before answering', () => {
    const wrapper = mount(KatakanaHunterItem, {
      props: { prompt: { katakana: 'テーブル', choices: ['table', 'desk', 'board'] }, disabled: false },
    })
    expect(wrapper.html()).not.toContain('naturalEnglish')
    expect(wrapper.html()).not.toContain('answer"')
  })
})
