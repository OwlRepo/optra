import assert from "node:assert/strict";
import test from "node:test";

import {
  checkTitles,
  classifyChanges,
  extractTestTitles,
  findBashWriteTargets,
  isGuardedSource,
  judgeRed,
  parseJsonReport,
  parseTapFailures,
  parseWaivers,
  planBaseSetup,
  planRuns,
  runnerArgs,
  runnerFor,
} from "./tdd-lib.mjs";

const ABS = "/work/optra";

// ---------------------------------------------------------------- error cases

test("error: a title without a prefix is a violation", () => {
  const violations = checkTitles({
    added: [{ file: "packages/ai/src/a.spec.ts", title: "computes VAT", prefix: null, dynamic: false }],
    newFiles: [],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /packages\/ai\/src\/a\.spec\.ts/);
  assert.match(violations[0], /computes VAT/);
});

test("error: a happy case with no error or edge case in the PR is a violation", () => {
  const violations = checkTitles({
    added: [{ file: "packages/ai/src/a.spec.ts", title: "happy: ok", prefix: "happy", dynamic: false }],
    newFiles: [],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /error:|edge:/);
});

test("error: in a new file, an edge case declared after a happy case is a violation", () => {
  const violations = checkTitles({
    added: [],
    newFiles: [
      {
        path: "packages/ai/src/b.spec.ts",
        titles: [
          { title: "error: x", prefix: "error", dynamic: false },
          { title: "happy: y", prefix: "happy", dynamic: false },
          { title: "edge: z", prefix: "edge", dynamic: false },
        ],
      },
    ],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /edge: z/);
});

test("error: a title that starts with an interpolation cannot be classified", () => {
  const titles = extractTestTitles("it(`${name} fails`, () => {});");
  assert.equal(titles.length, 1);
  assert.equal(titles[0].dynamic, true);
  const violations = checkTitles({ added: titles.map((t) => ({ ...t, file: "x.spec.ts" })), newFiles: [] });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /interpolation/i);
});

test("error: only happy cases failing is not a valid RED", () => {
  const verdict = judgeRed({ testLevel: ["happy: saves"], fileLevel: [] });
  assert.equal(verdict.red, false);
  assert.match(verdict.reason, /error:|edge:|regression:/);
});

test("error: no failure at all is not RED", () => {
  const verdict = judgeRed({ testLevel: [], fileLevel: [] });
  assert.equal(verdict.red, false);
});

test("error: parsers survive empty or garbage output", () => {
  const empty = { testLevel: [], fileLevel: [] };
  assert.deepEqual(parseTapFailures("", []), empty);
  assert.deepEqual(parseTapFailures(undefined, []), empty);
  assert.deepEqual(parseJsonReport(undefined, ["a.spec.ts"]), empty);
  assert.deepEqual(parseJsonReport("", ["a.spec.ts"]), empty);
  assert.deepEqual(parseJsonReport("{not json", ["a.spec.ts"]), empty);
  assert.deepEqual(parseJsonReport({ testResults: "nope" }, ["a.spec.ts"]), empty);
});

test("error: runnerFor refuses files that no runner owns", () => {
  for (const p of ["apps/api/test/auth.e2e-spec.ts", "packages/types/src/a.spec.ts", "docs/a.md", "apps/api/src/a.ts"]) {
    assert.equal(runnerFor(p), null, p);
  }
});

// ----------------------------------------------------------------- edge cases

test("edge: parseWaivers with a null or empty body grants no waiver", () => {
  for (const body of [null, undefined, "", "   "]) {
    assert.deepEqual(parseWaivers(body), { tdd: null, e2e: null, migration: null });
  }
});

test("edge: parseWaivers accepts any case and position but requires a reason", () => {
  const body = "Summary\n\n  tdd-waiver: refactor with no behaviour change\nE2E-WAIVER:   backend only\nMigration-Waiver:\n";
  const w = parseWaivers(body);
  assert.equal(w.tdd, "refactor with no behaviour change");
  assert.equal(w.e2e, "backend only");
  assert.equal(w.migration, null);
});

test("edge: classifyChanges ignores deletions and pure renames", () => {
  const groups = classifyChanges([
    { status: "D", path: "apps/api/src/old.ts" },
    { status: "R100", path: "apps/api/src/moved.ts" },
    { status: "R087", path: "apps/api/src/edited-move.ts" },
  ]);
  assert.deepEqual(groups.logic, ["apps/api/src/edited-move.ts"]);
});

test("edge: isGuardedSource covers every Optra source root and nothing else", () => {
  for (const p of [
    "apps/api/src/auth/auth.service.ts",
    "apps/web/app/(dashboard)/page.tsx",
    "apps/web/app/api/chat/route.ts",
    "apps/web/src/lib/api.ts",
    "apps/web/middleware.ts",
    "packages/ai/src/chains/refine.ts",
    "packages/db/src/schema/documents.ts",
    "packages/ui/src/components/button.tsx",
    "scripts/seed/index.ts",
    "scripts/seed/data/documents.ts",
  ]) {
    assert.equal(isGuardedSource(p), true, p);
  }
  for (const p of [
    "apps/api/src/auth/auth.service.spec.ts",
    "apps/web/app/page.spec.tsx",
    "apps/web/middleware.spec.ts",
    "apps/api/test/auth.e2e-spec.ts",
    "apps/api/test/helpers.ts",
    "packages/ai/src/chains/refine.test.ts",
    "packages/ai/src/global.d.ts",
    "packages/ai/src/__tests__/helper.ts",
    "packages/types/src/index.ts",
    "packages/db/drizzle/0001_init.sql",
    "scripts/seed/__tests__/data.test.ts",
    "scripts/seed/__tests__/fixtures.ts",
    "scripts/ci/tdd-lib.mjs",
    "apps/web/next.config.js",
    "docs/a.md",
  ]) {
    assert.equal(isGuardedSource(p), false, p);
  }
});

test("edge: a .tsx counts as ui and a .ts as logic", () => {
  const groups = classifyChanges([
    { status: "M", path: "apps/web/src/components/use-thing.tsx" },
    { status: "M", path: "apps/web/src/hooks/use-other.ts" },
  ]);
  assert.deepEqual(groups.ui, ["apps/web/src/components/use-thing.tsx"]);
  assert.deepEqual(groups.logic, ["apps/web/src/hooks/use-other.ts"]);
});

test("edge: every test kind lands in its group, and db specs and api e2e also count as migration tests", () => {
  const groups = classifyChanges([
    { status: "A", path: "apps/api/src/a.spec.ts" },
    { status: "A", path: "apps/web/app/page.spec.tsx" },
    { status: "A", path: "apps/web/middleware.spec.ts" },
    { status: "A", path: "packages/ai/src/b.spec.ts" },
    { status: "A", path: "packages/db/src/c.spec.ts" },
    { status: "A", path: "scripts/seed/__tests__/d.test.ts" },
    { status: "A", path: "scripts/ci/x.test.mjs" },
    { status: "A", path: "apps/api/test/flow.e2e-spec.ts" },
    { status: "A", path: "packages/db/drizzle/0042_x.sql" },
    { status: "M", path: "packages/db/drizzle/meta/_journal.json" },
    { status: "M", path: "docs/ai/planning.md" },
  ]);
  assert.deepEqual(groups.unit, [
    "apps/api/src/a.spec.ts",
    "apps/web/app/page.spec.tsx",
    "apps/web/middleware.spec.ts",
    "packages/ai/src/b.spec.ts",
    "packages/db/src/c.spec.ts",
    "scripts/seed/__tests__/d.test.ts",
  ]);
  assert.deepEqual(groups.scriptTests, ["scripts/ci/x.test.mjs"]);
  assert.deepEqual(groups.e2e, ["apps/api/test/flow.e2e-spec.ts"]);
  assert.deepEqual(groups.migrations, ["packages/db/drizzle/0042_x.sql", "packages/db/drizzle/meta/_journal.json"]);
  assert.deepEqual(groups.migrationTests, ["packages/db/src/c.spec.ts", "apps/api/test/flow.e2e-spec.ts"]);
  assert.deepEqual(groups.logic, []);
  assert.deepEqual(groups.ui, []);
});

test("edge: runnerFor maps each unit spec to its runner and package cwd", () => {
  assert.deepEqual(runnerFor("apps/api/src/auth/a.spec.ts"), { runner: "jest", cwd: "apps/api" });
  assert.deepEqual(runnerFor("apps/web/app/page.spec.tsx"), { runner: "vitest", cwd: "apps/web" });
  assert.deepEqual(runnerFor("apps/web/middleware.spec.ts"), { runner: "vitest", cwd: "apps/web" });
  assert.deepEqual(runnerFor("packages/ai/src/x.spec.ts"), { runner: "vitest", cwd: "packages/ai" });
  assert.deepEqual(runnerFor("packages/db/src/x.spec.ts"), { runner: "vitest", cwd: "packages/db" });
  assert.deepEqual(runnerFor("packages/ui/src/x.spec.tsx"), { runner: "vitest", cwd: "packages/ui" });
  assert.deepEqual(runnerFor("scripts/seed/__tests__/x.test.ts"), { runner: "vitest", cwd: "." });
  assert.deepEqual(runnerFor("scripts/ci/x.test.mjs"), { runner: "node", cwd: "." });
});

test("edge: planRuns groups files per runner and cwd in a stable order", () => {
  const runs = planRuns({
    unit: ["packages/ai/src/a.spec.ts", "apps/api/src/b.spec.ts", "packages/ai/src/c.spec.ts", "scripts/seed/__tests__/d.test.ts"],
    scriptTests: ["scripts/ci/e.test.mjs"],
  });
  assert.deepEqual(runs, [
    { runner: "jest", cwd: "apps/api", files: ["apps/api/src/b.spec.ts"] },
    { runner: "vitest", cwd: "packages/ai", files: ["packages/ai/src/a.spec.ts", "packages/ai/src/c.spec.ts"] },
    { runner: "vitest", cwd: ".", files: ["scripts/seed/__tests__/d.test.ts"] },
    { runner: "node", cwd: ".", files: ["scripts/ci/e.test.mjs"] },
  ]);
});

test("edge: runnerArgs emits JSON reporters for jest and vitest and TAP for node --test", () => {
  assert.deepEqual(runnerArgs("jest", ["src/a.spec.ts"], "/tmp/o.json"), {
    bin: "jest",
    args: ["--ci", "--json", "--outputFile=/tmp/o.json", "--runTestsByPath", "src/a.spec.ts"],
  });
  assert.deepEqual(runnerArgs("vitest", ["src/a.spec.ts"], "/tmp/o.json"), {
    bin: "vitest",
    args: ["run", "--reporter=json", "--outputFile=/tmp/o.json", "src/a.spec.ts"],
  });
  assert.deepEqual(runnerArgs("node", ["scripts/ci/x.test.mjs"], null), {
    bin: null,
    args: ["--test", "--test-reporter=tap", "scripts/ci/x.test.mjs"],
  });
});

test("edge: planBaseSetup installs and builds when the base has a bun.lock, else symlinks", () => {
  assert.deepEqual(planBaseSetup({ hasBunLock: true }), {
    mode: "install",
    commands: [
      ["bun", ["install", "--frozen-lockfile"]],
      ["bunx", ["turbo", "run", "build", "--filter=@repo/db", "--filter=@repo/ai"]],
    ],
  });
  assert.deepEqual(planBaseSetup({ hasBunLock: false }), { mode: "symlink", commands: [] });
});

test("edge: extractTestTitles reads multi-line titles, it, only/skip/concurrent/fails and single quotes", () => {
  const src = [
    "test(",
    '  "error: multi-line",',
    "  () => {},",
    ");",
    "it('edge: with it', () => {});",
    'test.skip("happy: skipped", () => {});',
    "it.concurrent('edge: concurrent', async () => {});",
    "it.fails('regression: known bug', () => {});",
    'describe("group without prefix", () => {});',
    'describe.each([1])("group %s", () => {});',
  ].join("\n");
  assert.deepEqual(
    extractTestTitles(src).map((t) => [t.title, t.prefix]),
    [
      ["error: multi-line", "error"],
      ["edge: with it", "edge"],
      ["happy: skipped", "happy"],
      ["edge: concurrent", "edge"],
      ["regression: known bug", "regression"],
    ],
  );
});

test("edge: a template literal with a literal prefix is classified", () => {
  const [t] = extractTestTitles("it(`edge: ${n} rows`, () => {});");
  assert.equal(t.prefix, "edge");
  assert.equal(t.dynamic, false);
});

test("edge: parseTapFailures separates a file load failure and skips suites", () => {
  const tap = [
    "TAP version 13",
    "# Subtest: group",
    "    # Subtest: edge: inside",
    "    not ok 1 - edge: inside",
    "      ---",
    "      type: 'test'",
    "      ...",
    "not ok 1 - group",
    "  ---",
    "  type: 'suite'",
    "  ...",
    "# Subtest: scripts/ci/b.test.mjs",
    "not ok 2 - scripts/ci/b.test.mjs",
    "  ---",
    "  type: 'test'",
    "  ...",
  ].join("\n");
  assert.deepEqual(parseTapFailures(tap, ["scripts/ci/a.test.mjs", "scripts/ci/b.test.mjs"]), {
    testLevel: ["edge: inside"],
    fileLevel: ["scripts/ci/b.test.mjs"],
  });
});

test("edge: parseJsonReport reads jest and vitest reports, file failures and only the requested files", () => {
  const report = {
    testResults: [
      {
        name: `${ABS}/packages/ai/src/a.spec.ts`,
        status: "failed",
        message: "",
        assertionResults: [
          { title: "error: rejects", status: "failed" },
          { title: "happy: accepts", status: "passed" },
        ],
      },
      {
        name: `${ABS}/packages/ai/src/b.spec.ts`,
        status: "failed",
        message: "Cannot find module './missing'",
        assertionResults: [],
      },
      {
        name: `${ABS}/packages/ai/src/other/a.spec.ts`,
        status: "failed",
        message: "",
        assertionResults: [{ title: "error: not requested", status: "failed" }],
      },
      {
        name: `${ABS}/packages/ai/src/c.spec.ts`,
        status: "passed",
        message: "",
        assertionResults: [{ title: "edge: fine", status: "passed" }],
      },
    ],
  };
  const files = ["packages/ai/src/a.spec.ts", "packages/ai/src/b.spec.ts", "packages/ai/src/c.spec.ts"];
  const expected = { testLevel: ["error: rejects"], fileLevel: ["packages/ai/src/b.spec.ts"] };
  assert.deepEqual(parseJsonReport(report, files), expected);
  assert.deepEqual(parseJsonReport(JSON.stringify(report), files), expected);
});

test("edge: a load failure with no failing test counts as RED (module does not exist yet)", () => {
  const verdict = judgeRed({ testLevel: [], fileLevel: ["packages/ai/src/new.spec.ts"] });
  assert.equal(verdict.red, true);
});

test("edge: findBashWriteTargets ignores reads that merely mention source paths", () => {
  assert.deepEqual(findBashWriteTargets("grep -n foo apps/api/src/a.ts > /tmp/out.txt"), ["/tmp/out.txt"]);
  assert.deepEqual(findBashWriteTargets("cat apps/api/src/a.ts | head"), []);
  assert.deepEqual(findBashWriteTargets("sed -n 1,20p apps/api/src/a.ts"), []);
});

test("edge: findBashWriteTargets detects sed -i, perl -i, tee, redirection and cp/mv", () => {
  assert.deepEqual(findBashWriteTargets("sed -i '' 's/a/b/' apps/api/src/a.ts"), ["apps/api/src/a.ts"]);
  assert.deepEqual(findBashWriteTargets("perl -pi -e 's/a/b/' apps/api/src/a.ts apps/api/src/b.ts"), [
    "apps/api/src/a.ts",
    "apps/api/src/b.ts",
  ]);
  assert.deepEqual(findBashWriteTargets("echo x | tee -a apps/api/src/a.ts"), ["apps/api/src/a.ts"]);
  assert.deepEqual(findBashWriteTargets("cat > 'apps/api/src/a.ts' <<'EOF'"), ["apps/api/src/a.ts"]);
  assert.deepEqual(findBashWriteTargets("cp /tmp/x.ts apps/api/src/a.ts && mv a b"), ["apps/api/src/a.ts", "b"]);
});

// ----------------------------------------------------------- regression cases

test("regression: a test( inside a string or comment (fixture) is not a case", () => {
  const src = [
    'const fixture = "test(\\"happy: fake\\", () => {})";',
    "const tpl = `it('happy: also fake', () => {})`;",
    '// test("happy: commented")',
    "/* it('happy: block') */",
    'const arr = ["test(", \'  "x",\'];',
    'test("error: the only real one", () => {});',
  ].join("\n");
  assert.deepEqual(
    extractTestTitles(src).map((t) => t.title),
    ["error: the only real one"],
  );
});

test("regression: a > inside quotes or a comment is not a redirection", () => {
  assert.deepEqual(findBashWriteTargets('git commit -m "note: > apps/api/src/foo.ts needs work"'), []);
  assert.deepEqual(findBashWriteTargets("git commit -m 'a; b | c > apps/api/src/foo.ts'"), []);
  assert.deepEqual(findBashWriteTargets("echo hi # > apps/api/src/foo.ts"), []);
  assert.deepEqual(findBashWriteTargets('echo "x" > "apps/api/src/a.ts" # comment'), ["apps/api/src/a.ts"]);
});

test("regression: 2>&1 is not a file write", () => {
  assert.deepEqual(findBashWriteTargets("bun run test 2>&1 | tail"), []);
});

test("regression: a vitest report path that only shares a suffix with a requested file is ignored", () => {
  const report = {
    testResults: [
      {
        name: `${ABS}/apps/web/app/(dash)/app/page.spec.ts`,
        status: "failed",
        assertionResults: [{ title: "error: wrong file", status: "failed" }],
      },
    ],
  };
  assert.deepEqual(parseJsonReport(report, ["apps/web/app/page.spec.ts"]), { testLevel: [], fileLevel: [] });
});

// ---------------------------------------------------------------- happy paths

test("happy: a PR with error, edge and happy in order has no violations", () => {
  const src = 'test("error: a", () => {});\ntest("edge: b", () => {});\ntest("happy: c", () => {});';
  const titles = extractTestTitles(src);
  assert.deepEqual(
    checkTitles({
      added: titles.map((t) => ({ ...t, file: "packages/ai/src/n.spec.ts" })),
      newFiles: [{ path: "packages/ai/src/n.spec.ts", titles }],
    }),
    [],
  );
});

test("happy: a failing error or regression case is a valid RED", () => {
  assert.equal(judgeRed({ testLevel: ["error: rejects"], fileLevel: [] }).red, true);
  assert.equal(judgeRed({ testLevel: ["regression: bug 12"], fileLevel: [] }).red, true);
});
