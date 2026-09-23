#!/usr/bin/env node
// Generates the Claude Code persona files `.claude/agents/<prefix>-<name>.md`
// from their single source, `agents/src/*.agent.mjs` (+ `agents/src/prompts/*.md`).
//
//   bun run agents:generate   write the generated files
//   bun run agents:lint       --check: fail on missing/drifted/orphan files and
//                             on two personas claiming the same ownedGlobs entry
//
// Claude only: Codex is retired in this repo, so nothing is generated under .codex/.
// Rules and ownership: docs/ai/agent-orchestration.md.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "agents", "src");
const CLAUDE_DIR = join(ROOT, ".claude", "agents");

function escapeDoubleQuoted(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

// Appended to every persona so repo-wide policy cannot drift per persona.
export const GLOBAL_POLICY = `
# Global Policy (applies to every persona)

- Reply in caveman ultra per /Users/romeoangelesjr/.agents/skills/caveman/SKILL.md (load it first). Code, tests, commit messages, PR text, file paths, commands and error strings stay normal and exact.
- Persona: Senior Staff Full Stack AI Engineer specialising in self-hosted Next.js, NestJS, PostgreSQL/pgvector (Drizzle), Redis/Bull and Docker on a dedicated VPS. Simplest durable solution; name a band-aid as one and propose the durable fix.
- Discovery order: Graphify first (/graphify query|path|explain on graphify-out/graph.json), then docs/ai/file-index/repository-map.md, grep last; when you fall back, say which query failed.
- Follow AGENTS.md (Canonical Task Flow) strictly; load docs/ai/planning.md at the planning nodes and docs/ai/execution.md before writing any code.
- Read .ai-engineering/core/operating-model.md before acting.
- Strict TDD: failing tests first (error: > edge: > regression: > happy:), then \`bun run tdd:red\` records the RED; the tdd-red-guard hook blocks guarded source edits until it has.
- Workspace isolation is the trust boundary: every tenant query filters by workspaceId and every handler checks the caller's membership.
- Drizzle migrations (packages/db/drizzle/) are additive and backward compatible; never hand-edit an applied migration; destructive changes (drop, rename, type narrowing) need explicit owner approval. Canonical rule: docs/ai/planning.md.
`;

export function claudeFilePath(persona) {
  return join(CLAUDE_DIR, `${persona.filePrefix}-${persona.name}.md`);
}

export function renderClaudeMarkdown(persona) {
  const frontmatter = [
    "---",
    `name: ${persona.name}`,
    `description: "${escapeDoubleQuoted(persona.description)}"`,
    `tools: ${persona.claude.tools.join(", ")}`,
    `model: ${persona.claude.model}`,
    "---",
    "",
    "",
  ].join("\n");
  return frontmatter + persona.systemPrompt + GLOBAL_POLICY;
}

async function loadPersonas() {
  const files = readdirSync(SRC_DIR)
    .filter((file) => file.endsWith(".agent.mjs"))
    .sort();
  const personas = [];
  for (const file of files) {
    const personaModule = await import(pathToFileURL(join(SRC_DIR, file)).href);
    personas.push(personaModule.default);
  }
  return personas;
}

function computeTargets(personas) {
  const targets = new Map();
  for (const persona of personas) targets.set(claudeFilePath(persona), renderClaudeMarkdown(persona));
  return targets;
}

function listExistingGenerated() {
  if (!existsSync(CLAUDE_DIR)) return [];
  return readdirSync(CLAUDE_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(CLAUDE_DIR, file));
}

// Exact-string collision only, not full glob overlap: catches the common
// copy-paste-glob mistake without needing a glob-matching library.
function findDuplicateOwnedGlobs(personas) {
  const seen = new Map();
  const failures = [];
  for (const persona of personas) {
    for (const glob of persona.ownedGlobs ?? []) {
      const owner = seen.get(glob);
      if (owner && owner !== persona.name) {
        failures.push(`ownedGlobs conflict: "${glob}" claimed by both "${owner}" and "${persona.name}"`);
      } else {
        seen.set(glob, persona.name);
      }
    }
  }
  return failures;
}

async function generate() {
  const personas = await loadPersonas();
  const targets = computeTargets(personas);
  mkdirSync(CLAUDE_DIR, { recursive: true });
  for (const [path, content] of targets) {
    writeFileSync(path, content, "utf8");
    console.log(`Wrote ${path}`);
  }
  console.log(`Generated ${personas.length} Claude agent definitions from agents/src/*.agent.mjs.`);
}

async function check() {
  const personas = await loadPersonas();
  const targets = computeTargets(personas);
  const failures = [];

  for (const [path, expected] of targets) {
    if (!existsSync(path)) {
      failures.push(`${path}: file does not exist — run 'bun run agents:generate' (node scripts/generate-agent-defs.mjs)`);
      continue;
    }
    if (readFileSync(path, "utf8") !== expected) {
      failures.push(
        `${path}: generated content does not match agents/src/*.agent.mjs — run 'bun run agents:generate' (node scripts/generate-agent-defs.mjs); never hand-edit .claude/agents`,
      );
    }
  }

  for (const existingPath of listExistingGenerated()) {
    if (!targets.has(existingPath)) {
      failures.push(`${existingPath}: no matching agents/src/*.agent.mjs source — delete this file or add its source`);
    }
  }

  failures.push(...findDuplicateOwnedGlobs(personas));

  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  const noun = personas.length === 1 ? "persona" : "personas";
  console.log(`Agent definitions lint passed (${personas.length} ${noun}, ${personas.length} generated files).`);
}

async function main() {
  if (process.argv.includes("--check")) await check();
  else await generate();
}

function isDirectlyInvoked() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectlyInvoked()) await main();
