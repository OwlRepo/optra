#!/usr/bin/env node
// `bun run tdd:red`: run this branch's changed tests BEFORE implementing and record
// that they failed. The Claude PreToolUse guard (scripts/hooks/tdd-red-guard.mjs)
// reads the marker; see docs/ai/testing-strategy.md "Strict TDD".
//
// Base: TDD_RED_BASE, default origin/main. A stacked slice sets it to its parent
// branch (TDD_RED_BASE=feat/<parent> bun run tdd:red) so only its own tests count.
// Exit 0 = RED recorded, 1 = not RED (nothing written), 2 = usage/git error.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { RUNNABLE_KINDS, classifyChanges, judgeRed } from "./tdd-lib.mjs";
import { RunnerError, TestRunTimeout, runTestGroups } from "./tdd-runner.mjs";

export const MARKER_FILE = "tdd-red.json";

class UsageError extends Error {}

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    throw new UsageError(`git ${args.join(" ")} failed: ${String(err.stderr || err.message).trim()}`);
  }
};

function parseArgs(argv) {
  const idx = argv.indexOf("--waiver");
  if (idx === -1) return { waiver: null };
  const reason = (argv[idx + 1] ?? "").trim();
  if (!reason || reason.startsWith("--")) throw new UsageError('--waiver needs a reason: bun run tdd:red -- --waiver "<reason>"');
  return { waiver: reason };
}

// Committed + staged + unstaged changes against the merge-base, plus untracked files:
// RED happens before the tests are necessarily committed.
function changedEntries(mergeBase) {
  const tracked = git("diff", "--name-status", "-M", mergeBase)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return { status: parts[0], path: parts[parts.length - 1] };
    });
  const untracked = git("ls-files", "--others", "--exclude-standard")
    .split("\n")
    .filter(Boolean)
    .map((p) => ({ status: "A", path: p }));
  return [...tracked, ...untracked];
}

async function main() {
  const { waiver } = parseArgs(process.argv.slice(2));
  const root = git("rev-parse", "--show-toplevel");
  const gitDir = git("rev-parse", "--absolute-git-dir");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const marker = path.join(gitDir, MARKER_FILE);
  const at = new Date().toISOString();

  if (waiver) {
    writeFileSync(marker, `${JSON.stringify({ branch, waiver, at }, null, 2)}\n`);
    console.log(`tdd:red: waiver recorded for ${branch}: ${waiver}. Copy it into the PR body as "TDD-Waiver: ${waiver}".`);
    return 0;
  }

  const base = process.env.TDD_RED_BASE || "origin/main";
  const mergeBase = git("merge-base", base, "HEAD");
  const groups = classifyChanges(changedEntries(mergeBase));
  const testFiles = RUNNABLE_KINDS.flatMap((k) => groups[k]);
  if (testFiles.length === 0) {
    console.error(
      `tdd:red: no new or changed runnable tests on this branch since ${base}. Write the error: and edge: cases first.` +
        (process.env.TDD_RED_BASE ? "" : " (Stacked slice? Set TDD_RED_BASE=<parent branch>.)"),
    );
    return 1;
  }

  let run;
  try {
    run = await runTestGroups(root, groups, Number(process.env.TDD_RED_TIMEOUT_MS) || 5 * 60 * 1000);
  } catch (err) {
    if (err instanceof TestRunTimeout || err instanceof RunnerError) throw new UsageError(err.message);
    throw err;
  }
  const verdict = judgeRed(run);
  if (!verdict.red) {
    console.error(`tdd:red: no RED. ${verdict.reason}`);
    for (const d of run.diagnostics) console.error(d);
    return 1;
  }
  const record = { branch, testFiles, failedTitles: run.testLevel, loadFailures: run.fileLevel, at };
  writeFileSync(marker, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`tdd:red: RED recorded for ${branch} (${verdict.reason}). You can implement now.`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`tdd:red: ${err instanceof UsageError ? err.message : err.stack}`);
  process.exitCode = 2;
}
