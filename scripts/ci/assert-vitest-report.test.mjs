import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVitestReport } from './assert-vitest-report.mjs';

const report = (overrides = {}) => ({
  numTotalTests: 9,
  numPassedTests: 9,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  success: true,
  testResults: [{ name: 'apps/api/test/learning-p1-1-postgres.test.ts', status: 'passed' }],
  ...overrides,
});

test('accepts dynamic PostgreSQL test counts with zero skipped tests', () => {
  assert.deepEqual(assertVitestReport(report()), {
    files: 1,
    tests: 9,
    passed: 9,
    failed: 0,
    skipped: 0,
    todo: 0,
  });
  assert.equal(assertVitestReport(report({ numTotalTests: 10, numPassedTests: 10 })).tests, 10);
});

test('fails when any test is skipped', () => {
  assert.throws(() => assertVitestReport(report({ numPendingTests: 1 })), /skipped tests: 1/);
});

test('fails when any test fails', () => {
  assert.throws(() => assertVitestReport(report({ numFailedTests: 1, success: false })), /failed tests: 1/);
});

test('fails when no tests ran', () => {
  assert.throws(() => assertVitestReport(report({ numTotalTests: 0, numPassedTests: 0 })), /zero tests/);
});

test('fails when passed tests do not equal total tests', () => {
  assert.throws(() => assertVitestReport(report({ numPassedTests: 8 })), /does not equal total tests/);
});

test('fails when required JSON report fields are missing', () => {
  const incomplete = report();
  delete incomplete.numPendingTests;
  assert.throws(() => assertVitestReport(incomplete), /numPendingTests/);
});

test('fails unless exactly one PostgreSQL test file ran', () => {
  assert.throws(() => assertVitestReport(report({ testResults: [] })), /Expected 1 Vitest test file/);
  assert.throws(
    () => assertVitestReport(report({ testResults: [{ name: 'a.test.ts' }, { name: 'b.test.ts' }] })),
    /Expected 1 Vitest test file/,
  );
});
