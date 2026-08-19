import { expect, test } from '@playwright/test'

test('minor reaches guardian wait and completes one real trial', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()

  await expect(page.getByRole('heading', { name: /保護者の方との/ })).toBeVisible()
  await expect(page.getByText(/音声アップロード・購入・長期学習記録は利用できません/)).toBeVisible()
  await page.getByTestId('start-trial').click()

  for (let question = 0; question < 12; question += 1) {
    await page.getByRole('radio').first().check()
    await page.getByTestId('submit-answer').click()
    await expect(page.getByRole('status')).toBeVisible()
    await page.getByTestId('next-question').click()
  }

  await expect(page.getByRole('heading', { name: /はじめての冒険/ })).toBeVisible()
  await expect(page.getByText(/この結果は保存されません/)).toBeVisible()

  const studentId = await page.evaluate(() => sessionStorage.getItem('lingoquest.student.id'))
  const repeated = await page.request.post('/v1/me/trial-sessions', { headers: { 'x-student-id': studentId! } })
  expect(repeated.status()).toBe(409)
  expect(await repeated.json()).toEqual({ code: 'TRIAL_ALREADY_REDEEMED' })
})

test('guardian service failure keeps restricted UI closed', async ({ page }) => {
  await page.route('**/v1/me/guardian-link', (route) => route.abort('failed'))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()
  await expect(page.getByRole('alert')).toContainText('安全設定を確認できませんでした')
  await expect(page.getByTestId('start-trial')).toHaveCount(0)
})
