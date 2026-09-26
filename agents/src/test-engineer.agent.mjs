import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const persona = {
  name: "test-engineer",
  filePrefix: "07",
  description:
    "Use proactively for the RED round before implementers run and for the post-implementation test review. Writes Jest specs in apps/api and Vitest specs elsewhere, error: > edge: > regression: > happy:, and records RED with bun run tdd:red.",
  claude: {
    tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    model: "sonnet",
  },
  ownedGlobs: [],
  systemPrompt: readFileSync(join(dir, "prompts", "test-engineer.md"), "utf8").trimEnd() + "\n",
};

export default persona;
