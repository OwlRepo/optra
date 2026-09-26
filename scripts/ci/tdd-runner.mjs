// Runs changed test files per (runner, package cwd) and collects failures.
// Shared by tdd-gate (against the base) and tdd-red (now).
//
// jest and vitest report through their JSON reporters (parseJsonReport);
// node --test keeps TAP on stdout (parseTapFailures).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseJsonReport, parseTapFailures, planRuns, runnerArgs } from "./tdd-lib.mjs";

export class TestRunTimeout extends Error {}
export class RunnerError extends Error {}

const MAX_OUTPUT = 64 * 1024 * 1024;

// A parent node:test run leaks NODE_TEST_CONTEXT, which switches a child
// `node --test` to the parent's internal protocol and suppresses the TAP parsed
// below.
function childTestEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// The binary's own JS entry, found the way `bunx` finds a local bin (walk up
// node_modules/.bin) but executed with this Node directly. Unlike `bunx`, a
// missing binary is an error here instead of a silent registry download.
function resolveBin(cwd, bin) {
  let dir = cwd;
  for (;;) {
    const candidate = path.join(dir, "node_modules", ".bin", bin);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new RunnerError(`cannot find ${bin} in node_modules/.bin above ${cwd}; run bun install --frozen-lockfile`);
}

// Every child runs detached as its own process group so a timeout (or Ctrl-C)
// can kill the whole tree: vitest and jest fork workers that would otherwise
// outlive a SIGKILL of the parent and keep the output pipes open.
const liveGroups = new Set();
let signalsHooked = false;

function killGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

function hookSignals() {
  if (signalsHooked) return;
  signalsHooked = true;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      for (const pid of liveGroups) killGroup(pid);
      process.exit(130);
    });
  }
}

export function runProcess(cmd, args, { cwd, timeoutMs, env = childTestEnv() }) {
  hookSignals();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(new RunnerError(`${cmd} could not start: ${err.message}`));
      return;
    }
    const out = { stdout: "", stderr: "" };
    const collect = (key) => (chunk) => {
      if (out[key].length < MAX_OUTPUT) out[key] += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", collect("stdout"));
    child.stderr.setEncoding("utf8").on("data", collect("stderr"));
    if (child.pid) liveGroups.add(child.pid);

    let timedOut = false;
    let settled = false;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveGroups.delete(child.pid);
      resolve({ status, signal, timedOut, ...out });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
      // Do not wait for 'close': a stray descendant could still hold a pipe.
      child.stdout.destroy();
      child.stderr.destroy();
    }, timeoutMs);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveGroups.delete(child.pid);
      reject(new RunnerError(`${cmd} could not start: ${err.message}`));
    });
    child.on("exit", (status, signal) => {
      if (timedOut) finish(status, signal);
    });
    child.on("close", finish);
  });
}

const tail = (text, lines = 15) => text.trim().split("\n").slice(-lines).join("\n");

export async function runTestGroups(root, groups, timeoutMs) {
  const results = { testLevel: [], fileLevel: [], anyFailure: false, diagnostics: [] };
  for (const run of planRuns(groups)) {
    const cwd = path.join(root, run.cwd);
    const relFiles = run.files.map((f) => path.relative(run.cwd, f).split(path.sep).join("/"));
    const reportDir = run.runner === "node" ? null : mkdtempSync(path.join(tmpdir(), "tdd-report-"));
    const reportFile = reportDir ? path.join(reportDir, "report.json") : null;
    try {
      const { bin, args } = runnerArgs(run.runner, relFiles, reportFile);
      const argv = bin ? [resolveBin(cwd, bin), ...args] : args;
      const res = await runProcess(process.execPath, argv, { cwd, timeoutMs });
      if (res.timedOut) {
        throw new TestRunTimeout(`timeout: ${run.runner} tests in ${run.cwd} did not finish within ${timeoutMs} ms`);
      }
      if (res.status !== 0) results.anyFailure = true;

      let parsed;
      if (run.runner === "node") {
        parsed = parseTapFailures(res.stdout, run.files);
      } else {
        const report = existsSync(reportFile) ? readFileSync(reportFile, "utf8") : "";
        parsed = parseJsonReport(report, run.files);
        if (!report && res.status !== 0) {
          results.diagnostics.push(`${run.runner} in ${run.cwd} exited ${res.status} without a report:\n${tail(res.stderr || res.stdout)}`);
        }
      }
      results.testLevel.push(...parsed.testLevel);
      results.fileLevel.push(...parsed.fileLevel);
    } finally {
      if (reportDir) rmSync(reportDir, { recursive: true, force: true });
    }
  }
  return results;
}
