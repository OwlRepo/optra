import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const persona = {
  name: "ui-ux-designer",
  filePrefix: "04",
  description:
    "Use proactively to review UI copy (English), empty/loading/error states, density and responsive behaviour against DESIGN.md \"Calm Utility\" and the tokens in packages/ui/src/globals.css.",
  claude: {
    tools: ["Read", "Grep", "Glob", "Edit", "Write"],
    model: "sonnet",
  },
  ownedGlobs: [],
  systemPrompt: readFileSync(join(dir, "prompts", "ui-ux-designer.md"), "utf8").trimEnd() + "\n",
};

export default persona;
