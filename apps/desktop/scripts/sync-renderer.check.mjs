import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'
import test from 'node:test'
import { syncRenderer } from './sync-renderer.mjs'

const execFileAsync = promisify(execFile)

async function fixture() {
  const root = await mkdtemp(`${process.cwd()}/.tmp-sync-`)
  return { root, source: `${root}/source`, target: `${root}/target` }
}

test('copies regular files, nested directories, modes, and removes stale output', async () => {
  const { root, source, target } = await fixture()
  try {
    await mkdir(`${source}/assets/icons`, { recursive: true })
    await writeFile(`${source}/index.html`, '<!doctype html>')
    await writeFile(`${source}/assets/icons/app.svg`, '<svg />')
    await chmod(`${source}/assets/icons/app.svg`, 0o754)
    await mkdir(target, { recursive: true })
    await writeFile(`${target}/stale.txt`, 'must disappear')

    await syncRenderer({ source, target })

    assert.equal(await readFile(`${target}/index.html`, 'utf8'), '<!doctype html>')
    assert.equal(await readFile(`${target}/assets/icons/app.svg`, 'utf8'), '<svg />')
    assert.equal((await lstat(`${target}/assets/icons/app.svg`)).mode & 0o777, 0o754)
    await assert.rejects(() => lstat(`${target}/stale.txt`), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects symlinks instead of following them', async () => {
  const { root, source, target } = await fixture()
  try {
    await mkdir(source, { recursive: true })
    await writeFile(`${root}/outside.txt`, 'outside source tree')
    await symlink(`${root}/outside.txt`, `${source}/linked.txt`)

    await assert.rejects(() => syncRenderer({ source, target }), /Unsupported renderer entry:.*linked\.txt/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a FIFO as a special file', { skip: process.platform === 'win32' }, async () => {
  const { root, source, target } = await fixture()
  try {
    await mkdir(source, { recursive: true })
    await execFileAsync('mkfifo', [`${source}/stream`])

    await assert.rejects(() => syncRenderer({ source, target }), /Unsupported renderer entry:.*stream/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
