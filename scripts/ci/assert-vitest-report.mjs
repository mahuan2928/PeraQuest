import { readFileSync } from 'node:fs';
import process from 'node:process';

/* global console */

const requiredIntegerFields = [
  'numTotalTests',
  'numPassedTests',
  'numFailedTests',
  'numPendingTests',
];

const readReport = (reportPath) => JSON.parse(readFileSync(reportPath, 'utf8'));

const assertIntegerField = (report, field) => {
  const value = report[field];
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Vitest JSON report is missing non-negative integer field: ${field}`);
  }
  return value;
};

export const assertVitestReport = (report, options = {}) => {
  const expectedFiles = options.expectedFiles ?? 1;
  if (!Array.isArray(report.testResults)) {
    throw new Error('Vitest JSON report is missing testResults array');
  }
  if (report.testResults.length !== expectedFiles) {
    throw new Error(`Expected ${expectedFiles} Vitest test file(s), got ${report.testResults.length}`);
  }

  const totals = Object.fromEntries(requiredIntegerFields.map((field) => [field, assertIntegerField(report, field)]));
  const todoTests = report.numTodoTests === undefined ? 0 : assertIntegerField(report, 'numTodoTests');

  if (totals.numTotalTests === 0) {
    throw new Error('Vitest JSON report contains zero tests');
  }
  if (totals.numFailedTests !== 0) {
    throw new Error(`Vitest JSON report contains failed tests: ${totals.numFailedTests}`);
  }
  if (totals.numPendingTests !== 0) {
    throw new Error(`Vitest JSON report contains skipped tests: ${totals.numPendingTests}`);
  }
  if (todoTests !== 0) {
    throw new Error(`Vitest JSON report contains todo tests: ${todoTests}`);
  }
  if (totals.numPassedTests !== totals.numTotalTests) {
    throw new Error(`Vitest passed count (${totals.numPassedTests}) does not equal total tests (${totals.numTotalTests})`);
  }
  if (report.success !== true) {
    throw new Error('Vitest JSON report did not finish successfully');
  }

  return {
    files: report.testResults.length,
    tests: totals.numTotalTests,
    passed: totals.numPassedTests,
    failed: totals.numFailedTests,
    skipped: totals.numPendingTests,
    todo: todoTests,
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error('Usage: node scripts/ci/assert-vitest-report.mjs <vitest-json-report>');
  }
  const summary = assertVitestReport(readReport(reportPath));
  console.log(
    `Vitest PostgreSQL gate passed: files=${summary.files} tests=${summary.tests} passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped}`,
  );
}
