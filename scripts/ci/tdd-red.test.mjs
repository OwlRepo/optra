import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { VAT_BUGGY, VAT_FIXED, VAT_SOURCE, VAT_SPEC, VAT_TEST, git, makeRepo, write } from "./test-repo.mjs";

const RED = new URL("./tdd-red.mjs", import.meta.url).pathname;

const red = (cwd, args = [], env = {}) =>
  spawnSync(process.execPath, [RED, ...args], { cwd, encoding: "utf8", env: { ...process.env, TDD_RED_BASE: "", ...env } });

const markerPath = (cwd) => path.join(git(cwd, "rev-parse", "--absolute-git-dir"), "tdd-red.json");

// ---------------------------------------------------------------- error cases

test("error: no changed tests on the branch exits 1 and writes no marker", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  const res = red(repo.root);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /error:.*edge:/);
  assert.equal(existsSync(markerPath(repo.root)), false);
});

test("error: a base that does not exist exits 2", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  assert.equal(red(repo.root, [], { TDD_RED_BASE: "origin/does-not-exist" }).status, 2);
});

test("error: if the new tests already pass there is no RED and no marker", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_FIXED });
  t.after(() => repo.cleanup());
  write(repo.root, VAT_TEST, VAT_SPEC);
  const res = red(repo.root);
  assert.equal(res.status, 1);
  assert.match(res.stdout + res.stderr, /RED/);
  assert.equal(existsSync(markerPath(repo.root)), false);
});

// ----------------------------------------------------------------- edge cases

test("edge: an untracked test file (not committed yet) counts", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  write(repo.root, VAT_TEST, VAT_SPEC);
  const res = red(repo.root);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test("edge: TDD_RED_BASE lets a stacked slice diff against its parent branch", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_TEST]: VAT_SPEC }, "test(vat): RED on the parent slice");
  git(repo.root, "checkout", "-q", "-b", "child-slice");
  // Nothing changed since the parent slice, so against it there is no new test.
  assert.equal(red(repo.root, [], { TDD_RED_BASE: "feature" }).status, 1);
  assert.equal(red(repo.root).status, 0);
});

test("edge: --waiver with a reason writes a waiver marker", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  const res = red(repo.root, ["--waiver", "only renames a constant"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /TDD-Waiver: only renames a constant/);
  const marker = JSON.parse(readFileSync(markerPath(repo.root), "utf8"));
  assert.equal(marker.branch, "feature");
  assert.equal(marker.waiver, "only renames a constant");
});

test("edge: --waiver without a reason is rejected", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  assert.equal(red(repo.root, ["--waiver"]).status, 2);
  assert.equal(red(repo.root, ["--waiver", "  "]).status, 2);
});

test("edge: the marker is per worktree, never shared", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  write(repo.root, VAT_TEST, VAT_SPEC);
  assert.equal(red(repo.root).status, 0);
  const other = `${repo.root}-wt`;
  git(repo.root, "worktree", "add", "-q", "-b", "other", other, "main");
  // repo.cleanup (registered first) deletes the main checkout, so drop the sibling dir directly.
  t.after(() => rmSync(other, { recursive: true, force: true }));
  assert.equal(existsSync(markerPath(other)), false);
});

// ----------------------------------------------------------- regression cases

test("regression: if only happy cases fail there is no valid RED", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  write(
    repo.root,
    VAT_TEST,
    "import { expect, it } from 'vitest'\nimport { vat } from '../vat'\nit('edge: zero', () => { expect(vat(0)).toBe(0) })\nit('happy: 12', () => { expect(vat(100)).toBe(12) })\n",
  );
  assert.equal(red(repo.root).status, 1);
});

// ---------------------------------------------------------------- happy paths

test("happy: failing error/edge tests write the marker with branch and titles", (t) => {
  const repo = makeRepo({ [VAT_SOURCE]: VAT_BUGGY });
  t.after(() => repo.cleanup());
  repo.commit({ [VAT_TEST]: VAT_SPEC }, "test(vat): RED");
  const res = red(repo.root);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const marker = JSON.parse(readFileSync(markerPath(repo.root), "utf8"));
  assert.equal(marker.branch, "feature");
  assert.deepEqual(marker.testFiles, [VAT_TEST]);
  assert.ok(marker.failedTitles.includes("error: rejects negative amounts"));
  assert.deepEqual(marker.loadFailures, []);
  assert.match(marker.at, /^\d{4}-\d{2}-\d{2}T/);
});
