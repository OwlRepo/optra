import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GLOBAL_POLICY, renderClaudeMarkdown } from "./generate-agent-defs.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const GENERATOR = join(SCRIPT_DIR, "generate-agent-defs.mjs");

function fixturePersona(overrides = {}) {
  return {
    name: "fixture-agent",
    filePrefix: "99",
    description: "Fixture persona for generator tests.",
    claude: { tools: ["Read", "Grep"], model: "sonnet" },
    ownedGlobs: [],
    systemPrompt: "You are a fixture persona.\n\n# Section\n- one\n- two\n",
    ...overrides,
  };
}

function scratchRepo(personas = [fixturePersona()]) {
  const tmp = mkdtempSync(join(tmpdir(), "agent-defs-"));
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  mkdirSync(join(tmp, "agents", "src"), { recursive: true });
  cpSync(GENERATOR, join(tmp, "scripts", "generate-agent-defs.mjs"));
  for (const persona of personas) {
    writeFileSync(
      join(tmp, "agents", "src", `${persona.name}.agent.mjs`),
      `export default ${JSON.stringify(persona, null, 2)};\n`,
    );
  }
  return tmp;
}

const generate = (tmp, args = []) =>
  spawnSync(process.execPath, [join(tmp, "scripts", "generate-agent-defs.mjs"), ...args], { encoding: "utf8" });

async function realPersonas() {
  const srcDir = join(REPO_ROOT, "agents", "src");
  const files = readdirSync(srcDir).filter((file) => file.endsWith(".agent.mjs")).sort();
  const personas = [];
  for (const file of files) personas.push((await import(pathToFileURL(join(srcDir, file)).href)).default);
  return personas;
}

// ---------------------------------------------------------------- error cases

test("error: --check fails when a generated file is hand-edited", (t) => {
  const tmp = scratchRepo();
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  assert.equal(generate(tmp).status, 0);
  const drifted = join(tmp, ".claude", "agents", "99-fixture-agent.md");
  writeFileSync(drifted, readFileSync(drifted, "utf8") + "x");
  const res = generate(tmp, ["--check"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /99-fixture-agent\.md/);
  assert.match(res.stderr, /agents:generate|generate-agent-defs/);
});

test("error: --check fails when a generated file is missing", (t) => {
  const tmp = scratchRepo();
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  assert.equal(generate(tmp).status, 0);
  unlinkSync(join(tmp, ".claude", "agents", "99-fixture-agent.md"));
  const res = generate(tmp, ["--check"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /does not exist/);
});

test("error: --check fails on an orphan .claude/agents file with no source", (t) => {
  const tmp = scratchRepo();
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  assert.equal(generate(tmp).status, 0);
  writeFileSync(join(tmp, ".claude", "agents", "42-orphan.md"), "---\nname: orphan\n---\n");
  const res = generate(tmp, ["--check"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /42-orphan\.md/);
  assert.match(res.stderr, /delete this file or add its source/);
});

test("error: --check fails when two personas claim the same ownedGlobs entry", (t) => {
  const tmp = scratchRepo([
    fixturePersona({ name: "alpha", filePrefix: "97", ownedGlobs: ["apps/api/src/**"] }),
    fixturePersona({ name: "beta", filePrefix: "98", ownedGlobs: ["apps/api/src/**"] }),
  ]);
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  assert.equal(generate(tmp).status, 0);
  const res = generate(tmp, ["--check"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /ownedGlobs conflict: "apps\/api\/src\/\*\*" claimed by both "alpha" and "beta"/);
});

// ----------------------------------------------------------------- edge cases

test("edge: GLOBAL_POLICY carries Optra's rules and nothing about Codex", () => {
  assert.doesNotMatch(GLOBAL_POLICY, /codex/i);
  assert.doesNotMatch(GLOBAL_POLICY, /supabase|juanfer|RLS/i);
  assert.match(GLOBAL_POLICY, /caveman ultra/);
  assert.match(GLOBAL_POLICY, /\/Users\/romeoangelesjr\/\.agents\/skills\/caveman\/SKILL\.md/);
  assert.match(GLOBAL_POLICY, /Senior Staff Full Stack AI Engineer/);
  assert.match(GLOBAL_POLICY, /NestJS/);
  assert.match(GLOBAL_POLICY, /pgvector/);
  assert.match(GLOBAL_POLICY, /graphify-out\/graph\.json/);
  assert.match(GLOBAL_POLICY, /docs\/ai\/file-index\/repository-map\.md/);
  assert.match(GLOBAL_POLICY, /AGENTS\.md/);
  assert.match(GLOBAL_POLICY, /docs\/ai\/planning\.md/);
  assert.match(GLOBAL_POLICY, /docs\/ai\/execution\.md/);
  assert.match(GLOBAL_POLICY, /\.ai-engineering\/core\/operating-model\.md/);
  assert.match(GLOBAL_POLICY, /bun run tdd:red/);
  assert.match(GLOBAL_POLICY, /Drizzle/);
  assert.match(GLOBAL_POLICY, /never hand-edit/i);
});

test("edge: generation writes only .claude/agents and never a .codex directory", (t) => {
  const tmp = scratchRepo();
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const res = generate(tmp);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readdirSync(join(tmp, ".claude", "agents")), ["99-fixture-agent.md"]);
  assert.equal(existsSync(join(tmp, ".codex")), false);
});

test("edge: importing the module does not run the generator", (t) => {
  const tmp = scratchRepo();
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const url = pathToFileURL(join(tmp, "scripts", "generate-agent-defs.mjs")).href;
  execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`], { encoding: "utf8" });
  assert.equal(existsSync(join(tmp, ".claude", "agents")), false);
});

test("edge: quotes and backslashes in a description are escaped in the frontmatter", () => {
  const output = renderClaudeMarkdown(fixturePersona({ description: 'Says "hi" \\ bye' }));
  assert.match(output, /^description: "Says \\"hi\\" \\\\ bye"$/m);
});

// ----------------------------------------------------------- regression cases

test("regression: real repo --check passes against agents/src and .claude/agents", () => {
  const res = spawnSync(process.execPath, [GENERATOR, "--check"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
});

test("regression: real repo ships the nine Optra personas, and validators cannot write", async () => {
  const personas = await realPersonas();
  assert.deepEqual(
    personas.map((p) => `${p.filePrefix}-${p.name}`).sort(),
    [
      "01-project-manager",
      "02-db-architect",
      "03-nextjs-frontend-dev",
      "04-ui-ux-designer",
      "05-code-reviewer",
      "06-security-auditor",
      "07-test-engineer",
      "08-accessibility-auditor",
      "09-nestjs-backend-dev",
    ],
  );
  for (const p of personas) {
    assert.equal(p.claude.model, "sonnet", p.name);
    assert.equal("codex" in p, false, p.name);
  }
  for (const name of ["code-reviewer", "security-auditor", "accessibility-auditor"]) {
    const p = personas.find((x) => x.name === name);
    assert.deepEqual(p.claude.tools, ["Read", "Grep", "Glob", "Bash"], name);
  }
});

test("regression: no persona prompt carries a Tarraula-only fact", async () => {
  for (const p of await realPersonas()) {
    assert.doesNotMatch(p.systemPrompt, /tarraula|supabase|juanfer|es\.json|espa[nñ]ol|server actions?|node:test|\bRLS\b/i, p.name);
  }
});

test("regression: every declared ownedGlobs entry is documented in docs/ai/agent-orchestration.md", async () => {
  const docPath = join(REPO_ROOT, "docs", "ai", "agent-orchestration.md");
  assert.ok(existsSync(docPath), "docs/ai/agent-orchestration.md must exist");
  const doc = readFileSync(docPath, "utf8");
  for (const persona of await realPersonas()) {
    for (const glob of persona.ownedGlobs ?? []) {
      assert.ok(doc.includes(glob), `${persona.name}: ownedGlobs entry "${glob}" is not documented in docs/ai/agent-orchestration.md`);
    }
  }
});

// ---------------------------------------------------------------- happy paths

test("happy: renderClaudeMarkdown produces exact frontmatter, body and policy", () => {
  const persona = fixturePersona();
  assert.equal(
    renderClaudeMarkdown(persona),
    [
      "---",
      "name: fixture-agent",
      'description: "Fixture persona for generator tests."',
      "tools: Read, Grep",
      "model: sonnet",
      "---",
      "",
      "",
    ].join("\n") +
      persona.systemPrompt +
      GLOBAL_POLICY,
  );
});

test("happy: --check passes right after a fresh generation", (t) => {
  const tmp = scratchRepo();
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  assert.equal(generate(tmp).status, 0);
  const res = generate(tmp, ["--check"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /1 persona/);
});
