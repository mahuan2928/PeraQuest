/* global process, console */
// web のビルド前に VITE_API_BASE_URL を確かめます。
// 未設定のままビルドすると、API 呼び出しが同一オリジンに飛び、
// Workers の SPA フォールバックが index.html を 200 で返します。
// 画面は「呼べたのに中身が空」に見え、原因が API 不在だと分かりません。
const url = process.env.VITE_API_BASE_URL?.trim()

if (!url) {
  console.error([
    'VITE_API_BASE_URL is not set.',
    '',
    'Without it the built app calls its own origin, the SPA fallback answers',
    'with index.html, and every screen that needs the API renders empty.',
    '',
    '  VITE_API_BASE_URL=https://peraquest-api.fly.dev npm run deploy',
  ].join('\n'))
  process.exit(1)
}

if (!/^https:\/\//.test(url) && !url.startsWith('http://localhost')) {
  console.error(`VITE_API_BASE_URL must be https (or http://localhost for development): ${url}`)
  process.exit(1)
}

console.log(`web will call the API at ${url}`)
