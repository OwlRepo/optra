import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { git, makeRepo } from "../ci/test-repo.mjs";

const GUARD = new URL("./tdd-red-guard.mjs", import.meta.url).pathname;

const guard = (input, cwd = process.cwd()) =>
  spawnSync(process.execPath, [GUARD], {
    cwd,
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });

const edit = (root, rel) => ({ tool_name: "Edit", cwd: root, tool_input: { file_path: path.join(root, rel) } });
const bash = (root, command) => ({ tool_name: "Bash", cwd: root, tool_input: { command } });

function writeMarker(root, marker) {
  const gitDir = git(root, "rev-parse", "--absolute-git-dir");
  writeFileSync(path.join(gitDir, "tdd-red.json"), typeof marker === "string" ? marker : JSON.stringify(marker));
}

const VALID = (branch = "feature") => ({
  branch,
  testFiles: ["packages/ai/src/vat.spec.ts"],
  failedTitles: ["error: rejects negatives"],
  loadFailures: [],
  at: "2026-09-23T20:00:00.000Z",
});

const SOURCE = "packages/ai/src/vat.ts";

// ---------------------------------------------------------------- error cases

test("error: stdin that is not JSON does not block (fail-open) but warns", () => {
  const res = guard("this is not json");
  assert.equal(res.status, 0);
  assert.match(res.stderr, /tdd-red-guard/);
});

test("error: an edit without file_path does not block", () => {
  assert.equal(guard({ tool_name: "Edit", tool_input: {} }).status, 0);
});

test("error: a corrupt marker blocks with a clear message", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  writeMarker(repo.root, "{broken");
  const res = guard(edit(repo.root, SOURCE));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /tdd:red/);
});

test("error: editing guarded source without a marker blocks", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  const res = guard(edit(repo.root, SOURCE));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /RED first/);
  assert.match(res.stderr, /bun run tdd:red/);
});

// ----------------------------------------------------------------- edge cases

test("edge: a marker from another branch does not count", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  writeMarker(repo.root, VALID("other-branch"));
  assert.equal(guard(edit(repo.root, SOURCE)).status, 2);
});

test("edge: every guarded Optra source root blocks without a marker", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  for (const rel of [
    "apps/api/src/auth/auth.service.ts",
    "apps/web/app/page.tsx",
    "apps/web/src/lib/api.ts",
    "apps/web/middleware.ts",
    "packages/db/src/schema/documents.ts",
    "packages/ui/src/components/button.tsx",
    "scripts/seed/index.ts",
  ]) {
    assert.equal(guard(edit(repo.root, rel)).status, 2, rel);
  }
});

test("edge: tests, docs, scripts, migrations and packages/types never block", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  for (const rel of [
    "packages/ai/src/vat.spec.ts",
    "apps/web/app/page.spec.tsx",
    "apps/api/test/auth.e2e-spec.ts",
    "scripts/seed/__tests__/data.test.ts",
    "docs/a.md",
    "scripts/ci/x.mjs",
    "packages/db/drizzle/0042_x.sql",
    "packages/types/src/index.ts",
    "packages/ai/src/global.d.ts",
  ]) {
    assert.equal(guard(edit(repo.root, rel)).status, 0, rel);
  }
});

test("edge: a file outside any git repo does not block", () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "no-git-")));
  assert.equal(guard({ tool_name: "Write", cwd: dir, tool_input: { file_path: path.join(dir, SOURCE) } }).status, 0);
});

test("edge: a read-only Bash command that mentions source does not block", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  assert.equal(guard(bash(repo.root, `grep -n vat ${SOURCE} > /tmp/x.txt`)).status, 0);
  assert.equal(guard(bash(repo.root, `sed -n 1,5p ${SOURCE}`)).status, 0);
});

test("edge: Bash sed -i on a spec does not block; on source it does", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  assert.equal(guard(bash(repo.root, "sed -i '' 's/a/b/' packages/ai/src/vat.spec.ts")).status, 0);
  assert.equal(guard(bash(repo.root, `sed -i '' 's/a/b/' ${SOURCE}`)).status, 2);
});

test("edge: relative Bash paths resolve against the tool's cwd", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  const cmd = { tool_name: "Bash", cwd: path.join(repo.root, "packages/ai"), tool_input: { command: "echo x > src/vat.ts" } };
  assert.equal(guard(cmd).status, 2);
});

test("edge: on main without a marker it also blocks", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  git(repo.root, "checkout", "-q", "main");
  assert.equal(guard(edit(repo.root, SOURCE)).status, 2);
});

test("edge: a waiver marker with a reason allows editing", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  writeMarker(repo.root, { branch: "feature", waiver: "copy only", at: "2026-09-23T20:00:00.000Z" });
  assert.equal(guard(edit(repo.root, SOURCE)).status, 0);
});

test("edge: NotebookEdit targets are read from notebook_path", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  const input = { tool_name: "NotebookEdit", cwd: repo.root, tool_input: { notebook_path: path.join(repo.root, SOURCE) } };
  assert.equal(guard(input).status, 2);
});

// ----------------------------------------------------------- regression cases

test("regression: a marker where only happy cases failed does not allow editing", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  writeMarker(repo.root, { ...VALID(), failedTitles: ["happy: saves"] });
  assert.equal(guard(edit(repo.root, SOURCE)).status, 2);
});

// ---------------------------------------------------------------- happy paths

test("happy: with a valid RED marker the edit goes through", (t) => {
  const repo = makeRepo();
  t.after(() => repo.cleanup());
  writeMarker(repo.root, VALID());
  assert.equal(guard(edit(repo.root, SOURCE)).status, 0);
  assert.equal(guard(bash(repo.root, `sed -i '' 's/a/b/' ${SOURCE}`)).status, 0);
});
