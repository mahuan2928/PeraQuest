import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const postgresTest = readFileSync(new URL('../../apps/api/test/learning-p1-1-postgres.test.ts', import.meta.url), 'utf8');
const qualityJob = workflow.split(/^ {2}build:/m)[0];

test('quality job provisions an isolated PostgreSQL 16 test database', () => {
  assert.match(qualityJob, /^ {4}services:\n {6}postgres:\n {8}image: postgres:16$/m);
  assert.match(qualityJob, /--health-cmd "pg_isready -U postgres -d postgres"/);
  assert.match(qualityJob, /^ {6}TEST_DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/peraquest_ci$/m);
  assert.match(qualityJob, /docker exec "\$\{\{ job\.services\.postgres\.id \}\}" createdb -U postgres peraquest_ci/);

  const createDatabase = qualityJob.indexOf('Create isolated PostgreSQL test database');
  const runTests = qualityJob.indexOf('run: npm test');
  assert.ok(createDatabase >= 0 && createDatabase < runTests, 'the isolated database must exist before tests run');
});

test('PostgreSQL tests fail fast in CI when TEST_DATABASE_URL is absent', () => {
  const guard = postgresTest.indexOf("if (process.env.CI && !connectionString)");
  const conditionalSuite = postgresTest.indexOf('const describePostgres = connectionString ? describe : describe.skip');
  assert.ok(guard >= 0 && guard < conditionalSuite, 'the CI guard must run before the suite can be skipped');
  assert.match(postgresTest, /throw new Error\('TEST_DATABASE_URL is required in CI for PostgreSQL concurrency tests'\)/);
});

test('pull request CI does not use production secrets or deployment commands', () => {
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.doesNotMatch(workflow, /^\s+(?:run: )?.*\bdeploy\b/im);
  assert.doesNotMatch(qualityJob, /render\.com|postgres(?:ql)?:\/\/(?!postgres:postgres@127\.0\.0\.1:5432\/peraquest_ci)/i);
});
