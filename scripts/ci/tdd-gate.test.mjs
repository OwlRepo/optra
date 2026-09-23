import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { VAT_BUGGY, VAT_FIXED, VAT_SOURCE, VAT_SPEC, VAT_TEST, git, makeRepo } from "./test-repo.mjs";

const GATE = new URL("./tdd-gate.mjs", import.meta.url).pathname;

function gate(root, env = {}) {
  const summary = path.join(mkdtempSync(path.join(tmpdir(), "tdd-summary-")), "summary.md");
  const fullEnv = {
    ...process.env,
    TDD_GATE_BASE: "origin/main",
    TDD_GATE_HEAD_REF: "infra/no-ticket-x",
    PR_BODY: "",
    GITHUB_STEP_SUMMARY: summary,
    ...env,
  };
  for (const [k, v] of Object.entries(fullEnv)) if (v === undefined) delete fullEnv[k];
  const res = spawnSync(process.execPath, [GATE], { cwd: root, encoding: "utf8", env: fullEnv });
  let summaryText = "";
  try {
    summaryText = readFileSync(summary, "utf8");
  } catch {
    summaryText = "";
  }
  return { ...res, summary: summaryText };
}

const worktreeCount = (root) => git(root, "worktree", "list").split("\n").length;

// ---------------------------------------------------------------- error cases

test("error: without TDD_GATE_BASE it exits 2 and says so", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  const res = gate(repo.root, { TDD_GATE_BASE: "" });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /TDD_GATE_BASE/);
});

test("error: a base that does not exist is a git failure (2), not a pass", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  assert.equal(gate(repo.root, { TDD_GATE_BASE: "origin/does-not-exist" }).status, 2);
});

test("error: logic changed without any test blocks", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_SOURCE]: VAT_FIXED });
  const res = gate(repo.root);
  assert.equal(res.status, 1);
  assert.match(res.stdout + res.stderr, /scripts\/seed\/vat\.ts/);
});

test("error: a test hanging against the base times out, exits 2 and removes the worktree", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({
    [VAT_SOURCE]: VAT_FIXED,
    [VAT_TEST]: "import { it } from 'vitest'\nit('error: hangs', () => new Promise(() => { setInterval(() => {}, 1000) }), 600_000)\n",
  });
  const res = gate(repo.root, { TDD_GATE_TIMEOUT_MS: "4000" });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /timeout/i);
  assert.equal(worktreeCount(repo.root), 1);
});

// ----------------------------------------------------------------- edge cases

test("edge: a docs-only PR passes", (t) => {
  const repo = makeRepo({ "docs/a.md": "a\n" });
  t.after(() => repo.cleanup());
  repo.commit({ "docs/a.md": "b\n" });
  assert.equal(gate(repo.root).status, 0);
});

test("edge: a tests-only PR needs no RED but does need prefixes", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_FIXED });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_TEST]: VAT_SPEC });
  assert.equal(gate(repo.root).status, 0);

  repo.commit({ "scripts/ci/other.test.mjs": 'import test from "node:test";\ntest("no prefix", () => {});\n' });
  assert.equal(gate(repo.root).status, 1);
});

test("edge: a promotion PR from main skips the gate", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_SOURCE]: VAT_FIXED });
  const res = gate(repo.root, { TDD_GATE_HEAD_REF: "main" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /skip/i);
  // dev and stg do not exist in Optra, so they get no free pass.
  assert.equal(gate(repo.root, { TDD_GATE_HEAD_REF: "dev" }).status, 1);
});

test("edge: a missing PR_BODY means no waiver", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_SOURCE]: VAT_FIXED });
  assert.equal(gate(repo.root, { PR_BODY: undefined }).status, 1);
});

test("edge: a TDD-Waiver with a reason passes and lands in the summary", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_SOURCE]: VAT_FIXED });
  const res = gate(repo.root, { PR_BODY: "TDD-Waiver: hotfix agreed with Romeo" });
  assert.equal(res.status, 0);
  assert.match(res.summary, /hotfix agreed with Romeo/);
});

test("edge: a ui (.tsx) change is satisfied by a unit spec; with no test at all it blocks", (t) => {
  const repo = makeRepo({ "packages/ui/src/badge.tsx": "export const Badge = () => null;\n" });
  t.after(() => repo.cleanup());
  repo.commit({ "packages/ui/src/badge.tsx": "export const Badge = () => 1;\n" });
  const res = gate(repo.root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /packages\/ui\/src\/badge\.tsx/);
  // No e2e spec and no E2E-Waiver: a ui change is not asked for one in Optra.
  assert.doesNotMatch(res.stdout, /e2e/i);
});

test("edge: a migration without a migration test blocks; a db spec satisfies it", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  repo.commit({ "packages/db/drizzle/0042_x.sql": "select 1;\n" });
  assert.equal(gate(repo.root).status, 1);
  repo.commit({ "packages/db/src/x.spec.ts": "import { it } from 'vitest'\nit('error: x', () => {})\n" });
  assert.equal(gate(repo.root).status, 0);
});

test("edge: a new module that does not exist in the base counts as RED", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_SOURCE]: VAT_FIXED, [VAT_TEST]: VAT_SPEC });
  const res = gate(repo.root);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

// ----------------------------------------------------------- regression cases

test("regression: tests that already pass against the old code prove nothing and block", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_FIXED });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_SOURCE]: VAT_FIXED + "// comment\n", [VAT_TEST]: VAT_SPEC });
  const res = gate(repo.root);
  assert.equal(res.status, 1);
  assert.match(res.stdout + res.stderr, /RED/);
});

test("regression: a refactor TDD-Waiver inverts the proof: tests must pass against the base", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_FIXED });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_SOURCE]: VAT_FIXED + "// refactor\n", [VAT_TEST]: VAT_SPEC });
  assert.equal(gate(repo.root, { PR_BODY: "TDD-Waiver: refactor with no change" }).status, 0);

  const buggy = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => buggy.cleanup());
  buggy.commit({ [VAT_SOURCE]: VAT_FIXED, [VAT_TEST]: VAT_SPEC });
  assert.equal(gate(buggy.root, { PR_BODY: "TDD-Waiver: refactor with no change" }).status, 1);
});

// ---------------------------------------------------------------- happy paths

test("happy: a fix whose tests fail on the base and pass now is approved", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_TEST]: VAT_SPEC }, "test(vat): RED");
  repo.commit({ [VAT_SOURCE]: VAT_FIXED }, "fix(vat): 12%");
  const res = gate(repo.root);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.summary, /TDD gate/);
  assert.equal(worktreeCount(repo.root), 1);
});
