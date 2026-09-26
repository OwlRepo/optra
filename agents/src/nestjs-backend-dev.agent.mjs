import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const persona = {
  name: "nestjs-backend-dev",
  filePrefix: "09",
  description:
    "Use proactively to implement NestJS 10 modules, controllers, services, guards and Bull processors, packages/ai LangChain RAG chains, and the shared packages/types contract. Never touches migrations/schema (db-architect) or apps/web and packages/ui files (nextjs-frontend-dev).",
  claude: {
    tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    model: "sonnet",
  },
  ownedGlobs: ["apps/api/src/**", "packages/ai/src/**", "packages/types/src/**"],
  systemPrompt: readFileSync(join(dir, "prompts", "nestjs-backend-dev.md"), "utf8").trimEnd() + "\n",
};

export default persona;
