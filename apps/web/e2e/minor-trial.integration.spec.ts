import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { buildApp } from '../../api/src/app'

const STUDENT_ID_KEY = 'lingoquest.student.id'
const LEGACY_TRIAL_KEY = 'lingoquest.trial.redeemed.v1'
let expiryClock = new Date('2026-08-27T00:00:00.000Z')
let expiryApi: ReturnType<typeof buildApp>
let expiryApiOrigin = ''

test.beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.ALLOW_LEGACY_TEST_HEADERS = 'true'
  process.env.CORS_ORIGIN = 'http://127.0.0.1:4173'
  expiryApi = buildApp({ now: () => expiryClock })
  expiryApiOrigin = await expiryApi.listen({ host: '127.0.0.1', port: 0 })
})

test.afterAll(async () => {
  await expiryApi.close()
})

test.beforeEach(() => {
  expiryClock = new Date('2026-08-27T00:00:00.000Z')
})

test('static viewport and footer styles preserve the iOS safe-area contract', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

  expect(html).toMatch(/name="viewport" content="[^"]*viewport-fit=cover[^"]*"/)
  expect(styles).toContain('--safe-bottom: env(safe-area-inset-bottom, 0px)')
  expect(styles).toMatch(/footer \{[^}]*padding:[^;}]*calc\(20px \+ var\(--safe-bottom\)\)/)
  expect(styles).not.toMatch(/\.app-shell \{[^}]*safe-bottom/)
})

test('mobile WebKit keeps primary navigation and footer content inside safe bounds', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-webkit', 'mobile WebKit gate')
  await page.goto('/')

  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewport).toContain('viewport-fit=cover')

  const homeBox = await page.getByRole('link', { name: 'LingoQuest JP ホーム' }).boundingBox()
  expect(homeBox).not.toBeNull()
  expect(homeBox!.width).toBeGreaterThanOrEqual(44)
  expect(homeBox!.height).toBeGreaterThanOrEqual(44)

  const footer = page.locator('footer')
  await footer.scrollIntoViewIfNeeded()
  const footerBounds = await footer.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const styles = getComputedStyle(element)
    return {
      bottom: rect.bottom,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      paddingBottom: Number.parseFloat(styles.paddingBottom),
    }
  })
  expect(footerBounds.bottom).toBeLessThanOrEqual(footerBounds.viewportHeight + 1)
  expect(footerBounds.paddingBottom).toBeGreaterThanOrEqual(20)
})

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

test('real API 410 expiry returns to GuardianWait and never starts a second trial', async ({ page }) => {
  let trialStarts = 0
  await page.route('**/v1/**', async (route) => {
    const requestUrl = new URL(route.request().url())
    const response = await route.fetch({
      url: `${expiryApiOrigin}${requestUrl.pathname}${requestUrl.search}`,
    })
    await route.fulfill({ response })
  })
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname === '/v1/trial-attempts') trialStarts += 1
  })

  await page.goto('/')
  await page.getByTestId('birth-month').fill('2012-04')
  await page.getByTestId('onboarding-submit').click()
  await page.getByTestId('start-trial').click()
  await expect(page.getByText('TRIAL QUEST')).toBeVisible()
  expiryClock = new Date('2026-08-27T00:31:00.000Z')
  await page.getByRole('radio').first().check()
  const expiredResponse = page.waitForResponse((response) =>
    response.url().includes('/answers') && response.status() === 410)
  await page.getByTestId('submit-answer').click()
  expect(await (await expiredResponse).json()).toEqual({ code: 'TRIAL_ATTEMPT_EXPIRED' })

  await expect(page.getByRole('heading', { name: /保護者の方との/ })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('有効期限が切れました')
  await expect(page.getByText(/新しいおためしは開始せず、保護者の方に連携/)).toBeVisible()
  await expect(page.getByTestId('start-trial')).toBeDisabled()
  await expect(page.getByText('TRIAL QUEST')).toHaveCount(0)
  expect(trialStarts).toBe(1)
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
