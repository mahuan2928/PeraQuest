import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const defaultSource = resolve(import.meta.dirname, '../../web/dist')
const defaultTarget = resolve(import.meta.dirname, '../dist/renderer')

export async function syncDirectory(from, to) {
  await mkdir(to, { recursive: true })

  for (const entry of await readdir(from, { withFileTypes: true })) {
    const sourcePath = resolve(from, entry.name)
    const targetPath = resolve(to, entry.name)

    if (entry.isDirectory()) {
      await syncDirectory(sourcePath, targetPath)
      continue
    }

    // Renderer assets must be regular files. Symlinks and other special entries
    // are rejected deliberately so a build cannot copy outside the source tree.
    if (!entry.isFile()) {
      throw new Error(`Unsupported renderer entry: ${sourcePath}`)
    }

    // Avoid fs.cp/copyFile here: on macOS they can return EPERM for files
    // carrying filesystem metadata even when the directory is writable.
    await writeFile(targetPath, await readFile(sourcePath))
    const { mode } = await lstat(sourcePath)
    await chmod(targetPath, mode)
  }
}

export async function syncRenderer({ source = defaultSource, target = defaultTarget } = {}) {
  await rm(target, { recursive: true, force: true })
  await syncDirectory(source, target)
}

if (import.meta.main) {
  await syncRenderer()
}
