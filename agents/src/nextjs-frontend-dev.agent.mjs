import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const persona = {
  name: "nextjs-frontend-dev",
  filePrefix: "03",
  description:
    "Use proactively for Next.js 14 App Router pages, components, hooks, the apps/web BFF route handlers (app/api/**) and shared packages/ui components. Consumes the locked packages/types contract; never edits NestJS, packages/ai, schema or migration files.",
  claude: {
    tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    model: "sonnet",
  },
  ownedGlobs: ["apps/web/app/**", "apps/web/src/**", "packages/ui/src/**"],
  systemPrompt: readFileSync(join(dir, "prompts", "nextjs-frontend-dev.md"), "utf8").trimEnd() + "\n",
};

export default persona;
