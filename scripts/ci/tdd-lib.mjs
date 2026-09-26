// Shared rules for the TDD gate (CI), `bun run tdd:red` (local) and the Claude
// PreToolUse guard. Pure functions only; the CLIs own git and process I/O.
// Rules: docs/ai/testing-strategy.md "Strict TDD".

export const PREFIXES = ["error", "edge", "regression", "happy"];
const RED_PREFIXES = new Set(["error", "edge", "regression"]);

// ------------------------------------------------------------ path taxonomy

// Test files are never guarded source, whatever directory they live in.
const TEST_FILE = /\.(spec|test)\.tsx?$|\.e2e-spec\.ts$/;

// Optra's behaviour lives here. packages/types is deliberately absent: it is
// type-only, has no test runner, and `bun run type-check` is its verification.
const GUARDED_ROOTS = [
  /^apps\/api\/src\/.+\.ts$/,
  /^apps\/web\/(?:app|src)\/.+\.tsx?$/,
  /^apps\/web\/middleware\.ts$/,
  /^packages\/(?:ai|db|ui)\/src\/.+\.tsx?$/,
  /^scripts\/seed\/.+\.ts$/,
];

export function isGuardedSource(rel) {
  if (TEST_FILE.test(rel) || rel.endsWith(".d.ts")) return false;
  if (/(^|\/)__tests__\//.test(rel)) return false;
  return GUARDED_ROOTS.some((re) => re.test(rel));
}

// Unit specs and the runner + package cwd that owns each, mirroring the
// per-workspace `bun run test` scripts and the root `db:seed:test`.
const UNIT_RULES = [
  [/^apps\/api\/src\/.+\.spec\.ts$/, () => ({ runner: "jest", cwd: "apps/api" })],
  [/^apps\/web\/(?:(?:app|src)\/.+|[^/]+)\.spec\.tsx?$/, () => ({ runner: "vitest", cwd: "apps/web" })],
  [/^packages\/(ai|db|ui)\/src\/.+\.spec\.tsx?$/, (m) => ({ runner: "vitest", cwd: `packages/${m[1]}` })],
  [/^scripts\/seed\/.+\.test\.ts$/, () => ({ runner: "vitest", cwd: "." })],
];
const SCRIPT_TEST = /^scripts\/.+\.test\.mjs$/;
const E2E = /^apps\/api\/test\/.+\.e2e-spec\.ts$/;
const MIGRATION = /^packages\/db\/drizzle\//;
const DB_SPEC = /^packages\/db\/src\/.+\.spec\.ts$/;

function unitRunnerFor(rel) {
  for (const [re, make] of UNIT_RULES) {
    const m = re.exec(rel);
    if (m) return make(m);
  }
  return null;
}

export function runnerFor(rel) {
  const unit = unitRunnerFor(rel);
  if (unit) return unit;
  if (SCRIPT_TEST.test(rel)) return { runner: "node", cwd: "." };
  return null;
}

// A file can carry several kinds: a db spec is both a runnable unit test and a
// migration test; an api e2e spec is both e2e and a migration test.
function kindsOf(rel) {
  const kinds = [];
  if (unitRunnerFor(rel)) kinds.push("unit");
  else if (SCRIPT_TEST.test(rel)) kinds.push("scriptTests");
  if (E2E.test(rel)) kinds.push("e2e");
  if (MIGRATION.test(rel)) kinds.push("migrations");
  if (DB_SPEC.test(rel) || E2E.test(rel)) kinds.push("migrationTests");
  if (isGuardedSource(rel)) kinds.push(rel.endsWith(".tsx") ? "ui" : "logic");
  return kinds;
}

// entries: [{ status: "A"|"M"|"D"|"R087"..., path }] as from `git diff --name-status`.
// Deleted files and pure renames (R100) carry no new behaviour to test.
export function classifyChanges(entries) {
  const groups = {
    logic: [],
    ui: [],
    unit: [],
    scriptTests: [],
    e2e: [],
    migrations: [],
    migrationTests: [],
  };
  for (const { status, path } of entries) {
    if (status.startsWith("D") || status === "R100") continue;
    for (const kind of kindsOf(path)) groups[kind].push(path);
  }
  return groups;
}

// Only these run for RED. e2e needs the full stack and is never a RED proof.
export const RUNNABLE_KINDS = ["unit", "scriptTests"];

const RUNNER_RANK = { jest: 0, vitest: 1, node: 2 };

// One run per (runner, cwd), jest first, then vitest, then node --test; within a
// runner, cwds keep the order they first appear in.
export function planRuns(groups) {
  const runs = new Map();
  for (const kind of RUNNABLE_KINDS) {
    for (const file of groups[kind] ?? []) {
      const owner = runnerFor(file);
      if (!owner) continue;
      const key = `${owner.runner}\0${owner.cwd}`;
      if (!runs.has(key)) runs.set(key, { runner: owner.runner, cwd: owner.cwd, files: [] });
      runs.get(key).files.push(file);
    }
  }
  return [...runs.values()].sort((a, b) => RUNNER_RANK[a.runner] - RUNNER_RANK[b.runner]);
}

// files are relative to the run's cwd. jest and vitest write a JSON report to
// outputFile; node --test keeps TAP on stdout (parsed by parseTapFailures).
export function runnerArgs(runner, files, outputFile) {
  switch (runner) {
    case "jest":
      return { bin: "jest", args: ["--ci", "--json", `--outputFile=${outputFile}`, "--runTestsByPath", ...files] };
    case "vitest":
      return { bin: "vitest", args: ["run", "--reporter=json", `--outputFile=${outputFile}`, ...files] };
    case "node":
      return { bin: null, args: ["--test", "--test-reporter=tap", ...files] };
    default:
      throw new Error(`unknown runner: ${runner}`);
  }
}

// How tdd-gate prepares the throwaway base worktree. A real Optra checkout (it
// has bun.lock) gets its own install + build: symlinking the head's node_modules
// would make Bun's @repo/* workspace links resolve to HEAD code, so the PR's
// tests would run against the new implementation and "RED" would be a lie.
// Scratch fixtures without a lockfile borrow node_modules through a symlink.
export function planBaseSetup({ hasBunLock }) {
  if (!hasBunLock) return { mode: "symlink", commands: [] };
  return {
    mode: "install",
    commands: [
      ["bun", ["install", "--frozen-lockfile"]],
      ["bunx", ["turbo", "run", "build", "--filter=@repo/db", "--filter=@repo/ai"]],
    ],
  };
}

// --------------------------------------------------------------- PR waivers

export function parseWaivers(body) {
  const out = { tdd: null, e2e: null, migration: null };
  if (!body) return out;
  const re = /^[ \t]*(tdd|e2e|migration)-waiver:[ \t]*(.*)$/gim;
  for (const m of body.matchAll(re)) {
    const reason = m[2].trim();
    if (reason) out[m[1].toLowerCase()] = reason;
  }
  return out;
}

// -------------------------------------------------------------- test titles

// Blanks string, template and comment contents (newlines kept) so a `test(` inside
// a fixture string is not read as a real case. Quote strings end at a newline, which
// bounds the damage of a regex literal containing a quote to its own line.
function codeMask(source) {
  const out = source.split("");
  let state = "code";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") state = "line";
      else if (c === "/" && next === "*") state = "block";
      else if (c === '"' || c === "'" || c === "`") state = c;
      continue;
    }
    if (c === "\n") {
      if (state === "line" || state === '"' || state === "'") state = "code";
      continue;
    }
    out[i] = " ";
    if (state === "block" && c === "*" && next === "/") {
      out[i + 1] = " ";
      i++;
      state = "code";
    } else if ((state === '"' || state === "'" || state === "`") && c === "\\") {
      if (next !== "\n") out[i + 1] = " ";
      i++;
    } else if (state === c) {
      out[i] = c;
      state = "code";
    }
  }
  return out.join("");
}

// `test(` / `it(` with optional .only/.skip/.todo/.fixme/.fail/.fails/.concurrent;
// describe is a grouping, not a case, so it carries no prefix requirement.
const CALL_RE = /\b(?:test|it)(?:\.(?:only|skip|todo|fixme|fails?|concurrent))?\s*\(\s*(?=["'`])/g;
const LITERAL_RE = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/y;

export function extractTestTitles(source) {
  const titles = [];
  if (!source) return titles;
  const masked = codeMask(source);
  for (const call of masked.matchAll(CALL_RE)) {
    LITERAL_RE.lastIndex = call.index + call[0].length;
    const m = LITERAL_RE.exec(source);
    if (!m) continue;
    const title = m[2];
    const dynamic = m[1] === "`" && title.startsWith("${");
    const pm = /^(error|edge|regression|happy):/.exec(title);
    titles.push({ title, prefix: pm ? pm[1] : null, dynamic });
  }
  return titles;
}

// added: titles introduced by the diff (any file). newFiles: full ordered titles of
// files created by the diff, where declaration order is also enforced. Titles that
// already existed before the diff are grandfathered.
export function checkTitles({ added, newFiles }) {
  const violations = [];
  for (const t of added) {
    if (t.dynamic) {
      violations.push(`${t.file}: "${t.title}" starts with an interpolation; the prefix (error:/edge:/regression:/happy:) must be literal`);
    } else if (!t.prefix) {
      violations.push(`${t.file}: "${t.title}" has no error:/edge:/regression:/happy: prefix`);
    }
  }
  const hasHappy = added.some((t) => t.prefix === "happy");
  const hasErrorOrEdge = added.some((t) => t.prefix === "error" || t.prefix === "edge");
  if (hasHappy && !hasErrorOrEdge) {
    violations.push("the PR adds happy: cases without any error: or edge: case");
  }
  for (const file of newFiles) {
    let seenHappy = false;
    for (const t of file.titles) {
      if (t.prefix === "happy") seenHappy = true;
      else if (seenHappy && (t.prefix === "error" || t.prefix === "edge")) {
        violations.push(`${file.path}: "${t.title}" is declared after a happy: case; error/edge cases come first`);
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------- report parsing

// Reads node:test TAP. A top-level failure named after one of the run files is a
// file-level failure (usually a module that does not exist yet); suites are skipped.
export function parseTapFailures(tap, files) {
  const out = { testLevel: [], fileLevel: [] };
  if (!tap) return out;
  const lines = tap.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)not ok \d+ - (.*)$/.exec(lines[i]);
    if (!m) continue;
    const title = m[2].replace(/\\#/g, "#").trim();
    let type = "test";
    for (let j = i + 1; j < lines.length && j < i + 40; j++) {
      const tm = /^\s*type: '(\w+)'/.exec(lines[j]);
      if (tm) {
        type = tm[1];
        break;
      }
      if (/^\s*\.\.\.\s*$/.test(lines[j])) break;
    }
    if (type === "suite") continue;
    const isFile = m[1] === "" && files.some((f) => title === f || title.endsWith(`/${f}`) || f.endsWith(`/${title}`));
    (isFile ? out.fileLevel : out.testLevel).push(title);
  }
  return out;
}

// Reads a jest `--json` or vitest `--reporter=json` report; both emit
// testResults[] = { name (absolute path), status, message, assertionResults[] =
// { title, status } }. Only the requested repo-relative files count. A file that
// failed with no failed assertion is a file-level failure (it did not load).
export function parseJsonReport(report, files) {
  const out = { testLevel: [], fileLevel: [] };
  let data = report;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return out;
    }
  }
  if (!data || !Array.isArray(data.testResults)) return out;
  for (const result of data.testResults) {
    const name = String(result?.name ?? "").replace(/\\/g, "/");
    const file = files.find((f) => name === f || name.endsWith(`/${f}`));
    if (!file) continue;
    const assertions = Array.isArray(result.assertionResults) ? result.assertionResults : [];
    const failed = assertions.filter((a) => a?.status === "failed").map((a) => String(a.title));
    out.testLevel.push(...failed);
    if (result.status === "failed" && failed.length === 0) out.fileLevel.push(file);
  }
  return out;
}

export function judgeRed({ testLevel, fileLevel }) {
  const redTitles = testLevel.filter((t) => RED_PREFIXES.has(/^(\w+):/.exec(t)?.[1]));
  if (redTitles.length > 0) return { red: true, reason: `failing: ${redTitles.join(", ")}` };
  if (testLevel.length === 0 && fileLevel.length > 0) {
    return { red: true, reason: `do not load (module does not exist yet): ${fileLevel.join(", ")}` };
  }
  if (testLevel.length > 0) {
    return {
      red: false,
      reason: `only cases without an error:/edge:/regression: prefix fail (${testLevel.join(", ")}); RED must start from errors and edges`,
    };
  }
  return { red: false, reason: "no test fails: the tests do not pin the new behaviour" };
}

// ------------------------------------------------------------ Bash targets

// Shell text with quoted contents blanked (quote chars kept) and `#` comments
// dropped, so `-m "a > src/x.ts"` or `# > src/x.ts` never read as redirections.
function shellMask(command) {
  const mask = command.split("");
  const comment = new Array(command.length).fill(false);
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === "\\" && quote === '"') {
        mask[i] = " ";
        if (i + 1 < command.length) mask[++i] = " ";
      } else if (c === quote) quote = null;
      else mask[i] = " ";
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(command[i - 1]))) {
      for (; i < command.length && command[i] !== "\n"; i++) {
        mask[i] = " ";
        comment[i] = true;
      }
      i--;
    }
  }
  return { mask: mask.join(""), comment };
}

function segments(command) {
  const { mask, comment } = shellMask(command);
  const out = [];
  let from = 0;
  for (const m of mask.matchAll(/\|\||&&|;|\||\n/g)) {
    out.push([from, m.index]);
    from = m.index + m[0].length;
  }
  out.push([from, command.length]);
  return out.map(([a, b]) => {
    let clean = "";
    for (let i = a; i < b; i++) if (!comment[i]) clean += command[i];
    return { text: command.slice(a, b), mask: mask.slice(a, b), clean };
  });
}

function tokenize(segment) {
  const tokens = [];
  for (const m of segment.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

const isPathArg = (t) => !t.startsWith("-") && !/^\d*>/.test(t) && !t.startsWith("<") && !t.startsWith(">");
const REDIRECT_RE = /(?<![0-9&<>])>{1,2}(?!&)[ \t]*/g;
const TARGET_RE = /'([^']+)'|"([^"]+)"|([^\s'"<>&;|]+)/y;

// Best-effort: the file paths a shell command would write. Reads (grep, cat,
// sed -n) yield nothing. A heuristic, not a shell parser.
export function findBashWriteTargets(command) {
  const targets = [];
  if (!command) return targets;
  for (const seg of segments(command)) {
    if (!seg.mask.trim()) continue;
    let stripped = "";
    let last = 0;
    for (const m of seg.mask.matchAll(REDIRECT_RE)) {
      TARGET_RE.lastIndex = m.index + m[0].length;
      const t = TARGET_RE.exec(seg.text);
      if (!t || seg.mask[m.index + m[0].length] === undefined) continue;
      targets.push(t[1] ?? t[2] ?? t[3]);
      stripped += seg.text.slice(last, m.index);
      last = TARGET_RE.lastIndex;
    }
    stripped += seg.text.slice(last);
    const withoutComment = segments(stripped)[0]?.clean ?? stripped;
    const tokens = tokenize(withoutComment.replace(/<<-?\s*['"]?\w+['"]?/g, "").trim());
    const [cmd, ...rest] = tokens;
    if (cmd === "tee") {
      targets.push(...rest.filter(isPathArg));
    } else if ((cmd === "sed" || cmd === "perl") && rest.some((t) => /^-[a-z]*i/.test(t))) {
      let skipNext = false;
      const args = [];
      for (const t of rest) {
        if (skipNext) {
          skipNext = false;
          continue;
        }
        if (t === "-e") {
          skipNext = true;
          continue;
        }
        if (t.startsWith("-") || t === "") continue;
        args.push(t);
      }
      // sed: first non-flag arg is the script unless -e was used.
      const files = cmd === "sed" && !rest.includes("-e") ? args.slice(1) : args;
      targets.push(...files.filter((t) => /[./]/.test(t)));
    } else if (["cp", "mv", "install", "rsync"].includes(cmd)) {
      const args = rest.filter(isPathArg);
      if (args.length >= 2) targets.push(args[args.length - 1]);
    }
  }
  return targets.filter((t) => t && !t.startsWith("/dev/"));
}
