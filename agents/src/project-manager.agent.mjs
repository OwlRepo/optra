import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const persona = {
  name: "project-manager",
  filePrefix: "01",
  description:
    "Use proactively when a task needs a spec, a locked contract or multi-persona dispatch. Turns the approved plan into testable acceptance criteria, locks the packages/types + API contract, and runs the dispatch rounds in docs/ai/agent-orchestration.md.",
  claude: {
    tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "TodoWrite"],
    model: "sonnet",
  },
  ownedGlobs: [],
  systemPrompt: readFileSync(join(dir, "prompts", "project-manager.md"), "utf8").trimEnd() + "\n",
};

export default persona;
