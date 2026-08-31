import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { changedPaths, DIFF_FILTER, selectChecks } from './select-builds.mjs';

const names = (paths) => selectChecks(paths).builds.map(({ name }) => name);
const all = ['web', 'api', 'desktop', 'mobile'];

const withRename = (from, to, verify) => {
  const directory = mkdtempSync(join(tmpdir(), 'peraquest-ci-rename-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: directory });
    execFileSync('git', ['config', 'user.email', 'ci@example.test'], { cwd: directory });
    execFileSync('git', ['config', 'user.name', 'CI Test'], { cwd: directory });
    mkdirSync(join(directory, from.substring(0, from.lastIndexOf('/'))), { recursive: true });
    writeFileSync(join(directory, from), 'export const renamed = true;\n');
    execFileSync('git', ['add', '.'], { cwd: directory });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: directory });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    mkdirSync(join(directory, to.substring(0, to.lastIndexOf('/'))), { recursive: true });
    renameSync(join(directory, from), join(directory, to));
    execFileSync('git', ['add', '-A'], { cwd: directory });
    execFileSync('git', ['commit', '-qm', 'rename'], { cwd: directory });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    const paths = changedPaths(base, head, directory);
    assert.deepEqual(paths, [from, to]);
    verify(selectChecks(paths));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('web changes fan out to web and its desktop/mobile consumers', () => {
  assert.deepEqual(names(['apps/web/src/App.vue']), ['web', 'desktop', 'mobile']);
});

test('api-only changes build API and run Trial E2E', () => {
  const checks = selectChecks(['apps/api/src/app.ts']);
  assert.deepEqual(checks.builds.map(({ name }) => name), ['api']);
  assert.equal(checks.trialE2E, true);
});

test('contracts fan out to every actual consumer', () => {
  assert.deepEqual(names(['packages/contracts/src/index.ts']), all);
});

test('platform fans out to web, desktop, and mobile consumers', () => {
  assert.deepEqual(names(['packages/platform/src/index.ts']), ['web', 'desktop', 'mobile']);
});

test('the root lockfile fans out to every workspace app and E2E', () => {
  const checks = selectChecks(['package-lock.json']);
  assert.deepEqual(checks.builds.map(({ name }) => name), all);
  assert.equal(checks.trialE2E, true);
});

test('desktop and mobile source changes receive dedicated gates', () => {
  assert.deepEqual(names(['apps/desktop/src/main.ts']), ['desktop']);
  assert.deepEqual(names(['apps/mobile/capacitor.config.ts']), ['mobile']);
});

test('only documentation-only changes skip builds and Trial E2E', () => {
  assert.deepEqual(selectChecks(['README.md', 'docs/architecture.md']), { builds: [], trialE2E: false });
  assert.deepEqual(names(['config/custom.config.json']), all);
  assert.equal(selectChecks(['config/custom.config.json']).trialE2E, true);
});

test('deleted files are included in changed paths', () => {
  assert.match(DIFF_FILTER, /D/);
  const directory = mkdtempSync(join(tmpdir(), 'peraquest-ci-selector-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: directory });
    execFileSync('git', ['config', 'user.email', 'ci@example.test'], { cwd: directory });
    execFileSync('git', ['config', 'user.name', 'CI Test'], { cwd: directory });
    writeFileSync(join(directory, 'deleted.ts'), 'export const value = true;\n');
    execFileSync('git', ['add', '.'], { cwd: directory });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: directory });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    rmSync(join(directory, 'deleted.ts'));
    execFileSync('git', ['add', '-A'], { cwd: directory });
    execFileSync('git', ['commit', '-qm', 'delete'], { cwd: directory });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    assert.deepEqual(changedPaths(base, head, directory), ['deleted.ts']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('API to docs rename keeps the old API scope and is not docs-only', () => {
  withRename('apps/api/src/renamed.ts', 'docs/renamed.ts', (checks) => {
    assert.deepEqual(checks.builds.map(({ name }) => name), ['api']);
    assert.equal(checks.trialE2E, true);
  });
});

test('API to Web rename triggers both old and new scopes', () => {
  withRename('apps/api/src/renamed.ts', 'apps/web/src/renamed.ts', (checks) => {
    assert.deepEqual(checks.builds.map(({ name }) => name), all);
    assert.equal(checks.trialE2E, true);
  });
});

test('Web to docs rename keeps Web and native consumer scopes', () => {
  withRename('apps/web/src/renamed.ts', 'docs/renamed.ts', (checks) => {
    assert.deepEqual(checks.builds.map(({ name }) => name), ['web', 'desktop', 'mobile']);
    assert.equal(checks.trialE2E, true);
  });
});
