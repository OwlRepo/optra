#!/usr/bin/env node
// CI TDD gate for task PRs. Rules: docs/ai/testing-strategy.md "Strict TDD".
// Exit 0 = pass, 1 = TDD violation, 2 = could not evaluate (git/setup/timeout/usage).
//
// Env: TDD_GATE_BASE (required, e.g. origin/main), TDD_GATE_HEAD (default HEAD),
// TDD_GATE_HEAD_REF (the PR's head branch), PR_BODY (waivers),
// TDD_GATE_TIMEOUT_MS (test run, default 5 min), TDD_GATE_SETUP_TIMEOUT_MS
// (base install + build, default 10 min).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  RUNNABLE_KINDS,
  checkTitles,
  classifyChanges,
  extractTestTitles,
  judgeRed,
  parseWaivers,
  planBaseSetup,
} from "./tdd-lib.mjs";
import { RunnerError, TestRunTimeout, runProcess, runTestGroups } from "./tdd-runner.mjs";

// Optra ships one PR into main; a PR whose head IS main is a sync, not new code.
const PROMOTION_REFS = new Set(["main"]);

class GateError extends Error {}

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new GateError(`git ${args.join(" ")} failed: ${String(err.stderr || err.message).trim()}`);
  }
};

function changedEntries(mergeBase, head) {
  return git("diff", "--name-status", "-M", mergeBase, head)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return { status: parts[0], path: parts[parts.length - 1] };
    });
}

function collectTitles(mergeBase, head, entries, testPaths) {
  const statusOf = new Map(entries.map((e) => [e.path, e.status]));
  const added = [];
  const newFiles = [];
  for (const file of testPaths) {
    if (statusOf.get(file) === "A") {
      const titles = extractTestTitles(git("show", `${head}:${file}`));
      newFiles.push({ path: file, titles });
      added.push(...titles.map((t) => ({ ...t, file })));
    } else {
      const addedLines = git("diff", "-U0", mergeBase, head, "--", file)
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1))
        .join("\n");
      added.push(...extractTestTitles(addedLines).map((t) => ({ ...t, file })));
    }
  }
  return { added, newFiles };
}

const tail = (text, lines = 20) => String(text).trim().split("\n").slice(-lines).join("\n");

// Makes the base worktree runnable. See planBaseSetup for why a real checkout
// gets its own install instead of borrowing the head's node_modules.
async function prepareBase(dir, repoRoot) {
  const setup = planBaseSetup({ hasBunLock: existsSync(path.join(dir, "bun.lock")) });
  if (setup.mode === "symlink") {
    const nodeModules = path.join(repoRoot, "node_modules");
    if (existsSync(nodeModules)) symlinkSync(nodeModules, path.join(dir, "node_modules"));
    return;
  }
  const timeoutMs = Number(process.env.TDD_GATE_SETUP_TIMEOUT_MS) || 10 * 60 * 1000;
  for (const [cmd, args] of setup.commands) {
    let res;
    try {
      res = await runProcess(cmd, args, { cwd: dir, timeoutMs, env: { ...process.env } });
    } catch (err) {
      throw new GateError(`base setup: ${err.message}`);
    }
    if (res.timedOut) throw new GateError(`base setup: timeout: ${cmd} ${args.join(" ")} did not finish within ${timeoutMs} ms`);
    if (res.status !== 0) {
      throw new GateError(`base setup: ${cmd} ${args.join(" ")} exited ${res.status}\n${tail(res.stderr || res.stdout)}`);
    }
  }
}

// Runs the PR's test files against the merge-base source in a throwaway worktree.
async function runAgainstBase(mergeBase, head, groups, timeoutMs) {
  const repoRoot = git("rev-parse", "--show-toplevel").trim();
  const dir = mkdtempSync(path.join(tmpdir(), "tdd-gate-base-"));
  try {
    git("worktree", "add", "--detach", "--quiet", dir, mergeBase);
    await prepareBase(dir, repoRoot);
    for (const file of RUNNABLE_KINDS.flatMap((k) => groups[k])) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), git("show", `${head}:${file}`));
    }
    try {
      return await runTestGroups(dir, groups, timeoutMs);
    } catch (err) {
      if (err instanceof TestRunTimeout || err instanceof RunnerError) throw new GateError(`${err.message} against the base`);
      throw err;
    }
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", dir], { stdio: "ignore" });
    } catch {
      // Already gone; prune below covers a half-created worktree.
    }
    rmSync(dir, { recursive: true, force: true });
    execFileSync("git", ["worktree", "prune"], { stdio: "ignore" });
  }
}

async function main() {
  const base = process.env.TDD_GATE_BASE;
  if (!base) throw new GateError("TDD_GATE_BASE is not set (e.g. origin/main)");
  const headRef = process.env.TDD_GATE_HEAD_REF ?? "";
  if (PROMOTION_REFS.has(headRef)) {
    console.log(`skip: PR from ${headRef}; its code already passed the gate`);
    return 0;
  }
  const head = process.env.TDD_GATE_HEAD || "HEAD";
  const timeoutMs = Number(process.env.TDD_GATE_TIMEOUT_MS) || 5 * 60 * 1000;

  const mergeBase = git("merge-base", base, head).trim();
  const entries = changedEntries(mergeBase, head);
  const groups = classifyChanges(entries);
  const waivers = parseWaivers(process.env.PR_BODY);
  const violations = [];
  const notes = [];

  const runnableTests = RUNNABLE_KINDS.flatMap((k) => groups[k]);
  // Optra's UI layer is tested with vitest (+ jsdom where needed) and has no
  // Playwright, so a ui (.tsx) change is held to the same rule as logic: any
  // runnable test. E2E-Waiver is still parsed for PR-body compatibility.
  const behaviour = [...groups.logic, ...groups.ui];

  if (behaviour.length > 0 && runnableTests.length === 0) {
    if (waivers.tdd) notes.push(`TDD-Waiver: ${waivers.tdd}`);
    else violations.push(`behaviour changed without any runnable test: ${behaviour.join(", ")}`);
  }
  if (groups.migrations.length > 0 && groups.migrationTests.length === 0) {
    if (waivers.migration) notes.push(`Migration-Waiver: ${waivers.migration}`);
    else violations.push(`migration without a migration test (packages/db/src/**/*.spec.ts or apps/api/test/**/*.e2e-spec.ts): ${groups.migrations.join(", ")}`);
  }

  violations.push(...checkTitles(collectTitles(mergeBase, head, entries, [...new Set([...runnableTests, ...groups.e2e])])));

  const refactor = waivers.tdd ? /^refactor\b/i.test(waivers.tdd) : false;
  if (behaviour.length > 0 && runnableTests.length > 0) {
    if (waivers.tdd && !refactor) {
      if (!notes.some((n) => n.startsWith("TDD-Waiver"))) notes.push(`TDD-Waiver: ${waivers.tdd} (RED proof skipped)`);
    } else {
      const run = await runAgainstBase(mergeBase, head, groups, timeoutMs);
      if (refactor) {
        notes.push(`TDD-Waiver: ${waivers.tdd} (tests must pass against the base)`);
        if (run.anyFailure) {
          violations.push(
            `refactor: the tests fail against the old code, so behaviour changed: ${[...run.testLevel, ...run.fileLevel].join(", ") || tail(run.diagnostics.join("\n"))}`,
          );
        }
      } else {
        const verdict = judgeRed(run);
        if (verdict.red) notes.push(`RED against the base: ${verdict.reason}`);
        else {
          violations.push(`RED: ${verdict.reason}`);
          for (const d of run.diagnostics) notes.push(d);
        }
      }
    }
  }

  report(violations, notes);
  return violations.length > 0 ? 1 : 0;
}

function report(violations, notes) {
  for (const n of notes) console.log(`note: ${n}`);
  for (const v of violations) console.log(`TDD: ${v}`);
  if (violations.length === 0) console.log("ok: TDD gate passed");
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  const lines = ["## TDD gate", ""];
  if (violations.length === 0) lines.push("Passed.");
  for (const v of violations) lines.push(`- FAIL: ${v}`);
  for (const n of notes) lines.push(`- ${n}`);
  appendFileSync(summaryFile, `${lines.join("\n")}\n`);
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`tdd-gate: ${err instanceof GateError ? err.message : err.stack}`);
  process.exitCode = 2;
}
