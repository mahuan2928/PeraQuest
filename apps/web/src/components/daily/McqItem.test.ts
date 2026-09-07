// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import McqItem from './McqItem.vue'

// 出題時のペイロードは deployed API が返す形そのものです（answer と explanation は含みません）。
const prompt = {
  sentence: 'It started to rain, so I opened my ___.',
  choices: ['umbrella', 'window', 'letter', 'bottle'],
}

describe('McqItem', () => {
  it('renders the sentence and one button per choice', () => {
    const wrapper = mount(McqItem, { props: { prompt, disabled: false } })
    expect(wrapper.text()).toContain('It started to rain, so I opened my ___.')
    expect(wrapper.findAll('.mcq-choices button').map((b) => b.text())).toEqual(prompt.choices)
  })

  it('emits the chosen text, which is what the server grades against', async () => {
    const wrapper = mount(McqItem, { props: { prompt, disabled: false } })
    await wrapper.findAll('.mcq-choices button')[0]!.trigger('click')
    expect(wrapper.emitted('answer')).toEqual([['umbrella']])
  })

  it('stops accepting answers while the result is showing', async () => {
    const wrapper = mount(McqItem, { props: { prompt, disabled: true } })
    const buttons = wrapper.findAll('.mcq-choices button')
    expect(buttons.every((b) => b.attributes('disabled') !== undefined)).toBe(true)
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('answer')).toBeUndefined()
  })

  it('does not invent a timer, which would turn hesitation into a wrong answer', () => {
    const wrapper = mount(McqItem, { props: { prompt, disabled: false } })
    // 冠詞センサーの制限時間は反射を鍛えるための仕掛けです。語彙の四択に付けると、
    // 知っているのに選べなかった回が誤答として窓に入り、測るものがぶれます。
    expect(wrapper.find('[role="timer"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('のこり')
  })
})
