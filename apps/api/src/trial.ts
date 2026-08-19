import type { TrialQuestion } from '@peraquest/contracts'

interface TrialQuestionInternal extends TrialQuestion {
  answer: string
  explanation: string
}

export const trialQuestions: TrialQuestionInternal[] = [
  { id: 'q1', ability: 'grammar', prompt: 'I ___ soccer after school.', support: '放課後にサッカーをします。', choices: ['play', 'plays', 'playing'], answer: 'play', explanation: '主語が I のとき、現在形の動詞は play のままです。' },
  { id: 'q2', ability: 'vocabulary', prompt: '「図書館」に合う英語は？', support: '場所を表す単語です。', choices: ['library', 'hospital', 'station'], answer: 'library', explanation: 'library は「図書館」です。' },
  { id: 'q3', ability: 'grammar', prompt: 'She ___ a new bag.', support: '彼女は新しいかばんを持っています。', choices: ['have', 'has', 'having'], answer: 'has', explanation: '三人称単数の She には has を使います。' },
  { id: 'q4', ability: 'vocabulary', prompt: 'What time do you ___ up?', support: '何時に起きますか？', choices: ['get', 'take', 'make'], answer: 'get', explanation: 'get up で「起きる」という表現になります。' },
  { id: 'q5', ability: 'grammar', prompt: 'There ___ two cats in the room.', support: '部屋には猫が2匹います。', choices: ['is', 'are', 'be'], answer: 'are', explanation: '後ろが複数の two cats なので are を使います。' },
  { id: 'q6', ability: 'vocabulary', prompt: '「宿題を終える」に合う動詞は？', support: '___ my homework', choices: ['finish', 'visit', 'teach'], answer: 'finish', explanation: 'finish my homework で「宿題を終える」です。' },
  { id: 'q7', ability: 'grammar', prompt: 'We went to Kyoto ___ train.', support: '私たちは電車で京都へ行きました。', choices: ['by', 'on', 'at'], answer: 'by', explanation: '交通手段は by train の形で表します。' },
  { id: 'q8', ability: 'vocabulary', prompt: '「空腹の」に合う英語は？', support: 'I am ___.', choices: ['hungry', 'busy', 'kind'], answer: 'hungry', explanation: 'hungry は「空腹の」という意味です。' },
  { id: 'q9', ability: 'grammar', prompt: 'Ken can ___ very fast.', support: 'ケンはとても速く走れます。', choices: ['run', 'runs', 'ran'], answer: 'run', explanation: '助動詞 can の後ろには動詞の原形 run を置きます。' },
  { id: 'q10', ability: 'vocabulary', prompt: 'Please ___ the window.', support: '窓を開けてください。', choices: ['open', 'read', 'wash'], answer: 'open', explanation: 'open the window で「窓を開ける」です。' },
  { id: 'q11', ability: 'grammar', prompt: 'My birthday is ___ May.', support: '私の誕生日は5月です。', choices: ['in', 'on', 'at'], answer: 'in', explanation: '月の前には前置詞 in を使います。' },
  { id: 'q12', ability: 'vocabulary', prompt: '「〜を探す」に合う表現は？', support: '___ my key', choices: ['look for', 'listen to', 'wait for'], answer: 'look for', explanation: 'look for は「〜を探す」という表現です。' },
]

export const publicTrialQuestion = (question: TrialQuestionInternal): TrialQuestion => ({
  id: question.id,
  ability: question.ability,
  prompt: question.prompt,
  support: question.support,
  choices: question.choices,
})
