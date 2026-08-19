import { expect, test } from '@playwright/test'

const STUDENT_ID_KEY = 'lingoquest.student.id'
const LEGACY_TRIAL_KEY = 'lingoquest.trial.redeemed.v1'

test('real API keeps a minor gated and enforces one non-persistent trial on the server', async ({ page }) => {
  const trialRequests: Array<{ url: string; body: unknown }> = []
  page.on('request', (request) => {
    if (request.url().includes('/v1/trial-attempts')) {
      trialRequests.push({ url: request.url(), body: request.postDataJSON() })
    }
  })
  await page.addInitScript((key) => localStorage.setItem(key, 'true'), LEGACY_TRIAL_KEY)

  await page.goto('/')
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()

  await expect(page.getByRole('heading', { name: /保護者の方との/ })).toBeVisible()
  await expect(page.getByText(/音声アップロード・購入・長期学習記録は利用できません/)).toBeVisible()
  await expect(page.getByTestId('start-trial')).toBeEnabled()

  const studentId = await page.evaluate((key) => sessionStorage.getItem(key), STUDENT_ID_KEY)
  expect(studentId).toBeTruthy()

  const guardian = await page.request.get('/v1/me/guardian-link', { headers: { 'x-student-id': studentId! } })
  expect(guardian.status()).toBe(200)
  expect(await guardian.json()).toMatchObject({ status: 'pending', purchaseAllowed: false })

  const capabilities = await page.request.get('/v1/me/capabilities', {
    headers: { 'x-student-id': studentId!, 'x-client-platform': 'pc' },
  })
  expect(capabilities.status()).toBe(200)
  expect(await capabilities.json()).toMatchObject({
    guardianLinkStatus: 'pending', canLearn: false, canUploadVoice: false, voiceUploadMode: 'disabled', canPurchase: false,
  })

  await page.getByTestId('start-trial').click()
  for (let question = 0; question < 12; question += 1) {
    await page.getByRole('radio').first().check()
    await page.getByTestId('submit-answer').click()
    await expect(page.getByRole('status')).toBeVisible()
    await page.getByTestId('next-question').click()
  }

  await expect(page.getByRole('heading', { name: /はじめての冒険/ })).toBeVisible()
  await expect(page.getByText(/この結果は保存されません/)).toBeVisible()
  expect(trialRequests).toHaveLength(13)
  expect(trialRequests[0]!.url).toMatch(/\/v1\/trial-attempts$/)
  expect(trialRequests.slice(1).map(({ body }) => (body as { questionId: string }).questionId))
    .toEqual(Array.from({ length: 12 }, (_, index) => `q${index + 1}`))

  const replay = await page.request.post('/v1/trial-attempts', { headers: { 'x-student-id': studentId! } })
  expect(replay.status()).toBe(409)
})

test('trial API failure keeps the minor on the restricted guardian screen', async ({ page }) => {
  await page.route('**/v1/trial-attempts', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'SERVICE_UNAVAILABLE' }),
    })
  })

  await page.goto('/')
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()
  await expect(page.getByRole('heading', { name: /保護者の方との/ })).toBeVisible()
  await page.getByTestId('start-trial').click()

  await expect(page.getByRole('alert')).toContainText('おためしクエストを開始できませんでした')
  await expect(page.getByRole('heading', { name: /保護者の方との/ })).toBeVisible()
  await expect(page.getByText('TRIAL QUEST')).toHaveCount(0)
})

test('fails closed when the onboarding API is unavailable', async ({ page }) => {
  await page.route('**/v1/students/onboarding', (route) => route.abort('failed'))
  await page.goto('/')
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()
  await expect(page.getByRole('alert')).toContainText('安全設定を確認できませんでした')
  await expect(page.getByTestId('start-trial')).toHaveCount(0)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STUDENT_ID_KEY)).toBeNull()
})
