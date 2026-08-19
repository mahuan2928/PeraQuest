import { expect, test } from '@playwright/test'

const STUDENT_ID_KEY = 'lingoquest.student.id'
const TRIAL_REDEEMED_KEY = 'lingoquest.trial.redeemed.v1'

test('real API keeps a minor gated and allows only one non-persistent trial', async ({ page }) => {
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/v1/')) apiCalls.push(new URL(request.url()).pathname)
  })

  await page.goto('/')
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()

  await expect(page.getByRole('heading', { name: /保護者の方との/ })).toBeVisible()
  await expect(page.getByText(/音声アップロード・購入・長期学習記録は利用できません/)).toBeVisible()

  const studentId = await page.evaluate((key) => sessionStorage.getItem(key), STUDENT_ID_KEY)
  expect(studentId).toBeTruthy()

  const guardian = await page.request.get('/v1/me/guardian-link', {
    headers: { 'x-student-id': studentId! },
  })
  expect(guardian.status()).toBe(200)
  expect(await guardian.json()).toMatchObject({ status: 'pending', purchaseAllowed: false })

  const capabilities = await page.request.get('/v1/me/capabilities', {
    headers: { 'x-student-id': studentId!, 'x-client-platform': 'pc' },
  })
  expect(capabilities.status()).toBe(200)
  expect(await capabilities.json()).toMatchObject({
    guardianLinkStatus: 'pending',
    canLearn: false,
    canUploadVoice: false,
    voiceUploadMode: 'disabled',
    canPurchase: false,
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
  expect(await page.evaluate((key) => localStorage.getItem(key), TRIAL_REDEEMED_KEY)).toBe('true')
  expect(apiCalls.filter((path) => path.includes('lesson') || path.includes('progress') || path.includes('result'))).toEqual([])

  await page.reload()
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()
  await expect(page.getByTestId('start-trial')).toBeDisabled()
})

test('fails closed when the onboarding API is unavailable', async ({ page }) => {
  await page.route('**/v1/students/onboarding', (route) => route.abort('failed'))
  await page.goto('/')
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()

  await expect(page.getByRole('alert')).toContainText('安全設定を確認できませんでした')
  await expect(page.getByTestId('start-trial')).toHaveCount(0)
  await expect(page.getByText(/音声アップロード・購入・長期学習記録は利用できません/)).toHaveCount(0)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STUDENT_ID_KEY)).toBeNull()
})
