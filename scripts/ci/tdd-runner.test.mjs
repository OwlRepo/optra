import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { RunnerError, TestRunTimeout, runTestGroups } from "./tdd-runner.mjs";
import { VAT_BUGGY, VAT_FIXED, VAT_SOURCE, VAT_SPEC, VAT_TEST, makeRepo, write } from "./test-repo.mjs";

const groups = (unit = [], scriptTests = []) => ({ unit, scriptTests });

// Minimal apps/api layout: the jest config lives in package.json, like Optra's.
const API_PACKAGE = JSON.stringify({
  name: "@repo/api",
  jest: {
    moduleFileExtensions: ["js", "json", "ts"],
    rootDir: "src",
    testRegex: ".*\\.spec\\.ts$",
    transform: { "^.+\\.(t|j)s$": "@swc/jest" },
    testEnvironment: "node",
  },
});

function processAlive(pattern) {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- error cases

test("error: a hanging vitest run throws TestRunTimeout and leaves no process behind", async (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  const spec = "scripts/seed/__tests__/hang-runner-probe.test.ts";
  write(
    repo.root,
    spec,
    "import { it } from 'vitest'\nit('error: hangs', () => new Promise(() => { setInterval(() => {}, 1000) }), 600_000)\n",
  );
  await assert.rejects(runTestGroups(repo.root, groups([spec]), 4000), TestRunTimeout);
  assert.equal(processAlive("hang-runner-probe"), false);
});

test("error: a missing test binary is a RunnerError, not an empty pass", async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "tdd-nobin-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, VAT_TEST, VAT_SPEC);
  await assert.rejects(runTestGroups(root, groups([VAT_TEST]), 30_000), RunnerError);
});

// ----------------------------------------------------------------- edge cases

test("edge: a spec whose module does not exist yet is a file-level failure under vitest", async (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  write(repo.root, VAT_TEST, VAT_SPEC);
  const res = await runTestGroups(repo.root, groups([VAT_TEST]), 60_000);
  assert.deepEqual(res.testLevel, []);
  assert.deepEqual(res.fileLevel, [VAT_TEST]);
  assert.equal(res.anyFailure, true);
});

test("edge: jest runs in the api package cwd and reports assertion failures", async (t) => {
  const repo = makeRepo({ "apps/api/package.json": API_PACKAGE, "apps/api/src/vat.ts": VAT_BUGGY });
  t.after(() => repo.cleanup());
  const spec = "apps/api/src/vat.spec.ts";
  write(
    repo.root,
    spec,
    "import { vat } from './vat'\nit('error: rejects negatives', () => { expect(() => vat(-1)).toThrow() })\nit('happy: zero', () => { expect(vat(0)).toBe(0) })\n",
  );
  const res = await runTestGroups(repo.root, groups([spec]), 90_000);
  assert.deepEqual(res.testLevel, ["error: rejects negatives"]);
  assert.deepEqual(res.fileLevel, []);
  assert.equal(res.anyFailure, true);
});

// ----------------------------------------------------------- regression cases

test("regression: a parent node --test run does not hide a child script test's failures", async (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  const spec = "scripts/ci/child.test.mjs";
  write(repo.root, spec, 'import test from "node:test";\ntest("error: child fails", () => { throw new Error("boom"); });\n');
  const res = await runTestGroups(repo.root, groups([], [spec]), 60_000);
  assert.deepEqual(res.testLevel, ["error: child fails"]);
});

// ---------------------------------------------------------------- happy paths

test("happy: vitest failures are collected per title and passing runs report no failure", async (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  write(repo.root, VAT_TEST, VAT_SPEC);
  const red = await runTestGroups(repo.root, groups([VAT_TEST]), 60_000);
  assert.deepEqual(red.testLevel.sort(), ["error: rejects negative amounts", "happy: 12% of 100"]);
  assert.equal(red.anyFailure, true);

  write(repo.root, VAT_SOURCE, VAT_FIXED);
  const green = await runTestGroups(repo.root, groups([VAT_TEST]), 60_000);
  assert.deepEqual(green, { testLevel: [], fileLevel: [], anyFailure: false, diagnostics: [] });
});
