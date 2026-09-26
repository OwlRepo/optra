import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const persona = {
  name: "security-auditor",
  filePrefix: "06",
  description:
    "Use proactively to audit workspace isolation (workspaceId + membership guards), JWT/OTP auth, rate limits and token budgets, S3 object paths, SSRF, uploads and secrets. Read-only validator.",
  claude: {
    tools: ["Read", "Grep", "Glob", "Bash"],
    model: "sonnet",
  },
  ownedGlobs: [],
  systemPrompt: readFileSync(join(dir, "prompts", "security-auditor.md"), "utf8").trimEnd() + "\n",
};

export default persona;
