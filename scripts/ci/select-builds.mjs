#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import process from 'node:process';

/* global console */

const targetOrder = ['web', 'api', 'desktop', 'mobile'];
const targets = {
  web: { name: 'web', workspace: '@peraquest/web' },
  api: { name: 'api', workspace: '@peraquest/api' },
  desktop: { name: 'desktop', workspace: '@peraquest/desktop' },
  mobile: { name: 'mobile', workspace: '@peraquest/mobile' },
};

const allTargets = () => targetOrder.map((name) => targets[name]);
const isDocumentation = (path) => path === 'README.md' || path.startsWith('docs/');

export const DIFF_FILTER = 'ACDMRTUXB';

export function selectChecks(paths) {
  if (paths.length === 0 || paths.every(isDocumentation)) {
    return { builds: [], trialE2E: false };
  }

  const selected = new Set();
  let trialE2E = false;
  let unknown = false;
  const add = (...names) => names.forEach((name) => selected.add(name));

  for (const path of paths) {
    if (isDocumentation(path)) continue;

    if (
      path === 'package.json' ||
      path === 'package-lock.json' ||
      path === 'tsconfig.base.json' ||
      path === 'eslint.config.mjs' ||
      path.startsWith('.github/workflows/') ||
      path.startsWith('scripts/ci/')
    ) {
      add(...targetOrder);
      trialE2E = true;
    } else if (path.startsWith('packages/contracts/')) {
      add(...targetOrder);
      trialE2E = true;
    } else if (path.startsWith('packages/platform/')) {
      add('web', 'desktop', 'mobile');
      trialE2E = true;
    } else if (path.startsWith('apps/web/')) {
      add('web', 'desktop', 'mobile');
      trialE2E = true;
    } else if (path === 'wrangler.jsonc') {
      add('web');
      trialE2E = true;
    } else if (path.startsWith('apps/api/')) {
      add('api');
      trialE2E = true;
    } else if (path.startsWith('apps/desktop/')) {
      add('desktop');
    } else if (path.startsWith('apps/mobile/')) {
      add('mobile');
    } else {
      unknown = true;
    }
  }

  return {
    builds: unknown ? allTargets() : targetOrder.filter((name) => selected.has(name)).map((name) => targets[name]),
    trialE2E: unknown || trialE2E,
  };
}

export function selectBuilds(paths) {
  return selectChecks(paths).builds;
}

export function changedPaths(base, head, cwd = process.cwd()) {
  return execFileSync(
    'git',
    ['diff', '--no-renames', '--name-only', `--diff-filter=${DIFF_FILTER}`, `${base}...${head}`],
    { cwd, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('Usage: node scripts/ci/select-builds.mjs <base-sha> <head-sha>');
    process.exit(2);
  }

  const checks = selectChecks(changedPaths(base, head));
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const fs = await import('node:fs');
    fs.appendFileSync(
      output,
      `matrix=${JSON.stringify({ include: checks.builds })}\nhas-builds=${checks.builds.length > 0}\ntrial-e2e=${checks.trialE2E}\n`,
    );
  } else {
    console.log(JSON.stringify(checks, null, 2));
  }
}
