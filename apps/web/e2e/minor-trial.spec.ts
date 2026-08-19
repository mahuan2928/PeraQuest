import { expect, test } from '@playwright/test'

test('minor reaches guardian wait and completes the one-time trial', async ({ page }) => {
  await page.route('**/v1/students/onboarding', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        studentId: 'student-e2e',
        isMinor: true,
        guardianLinkStatus: 'pending',
        onboardingStatus: 'pending_guardian',
      }),
    })
  })
  await page.goto('/')
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

  await page.reload()
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()
  await expect(page.getByTestId('start-trial')).toBeDisabled()
})
