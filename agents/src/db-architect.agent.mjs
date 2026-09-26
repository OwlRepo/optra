import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const persona = {
  name: "db-architect",
  filePrefix: "02",
  description:
    "Use proactively for any Drizzle schema, migration, index or pgvector change in packages/db. Always runs alone, before the contract is locked. Owns packages/db/src/schema/** and packages/db/drizzle/**.",
  claude: {
    tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    model: "sonnet",
  },
  ownedGlobs: ["packages/db/src/schema/**", "packages/db/drizzle/**"],
  systemPrompt: readFileSync(join(dir, "prompts", "db-architect.md"), "utf8").trimEnd() + "\n",
};

export default persona;
