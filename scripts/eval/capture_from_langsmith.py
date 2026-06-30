from __future__ import annotations

import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT_PATH = ROOT / "langsmith-capture.json"


def main() -> int:
    try:
        from dotenv import load_dotenv
        from langsmith import Client
    except ImportError as error:
        print(f"Missing dependency: {error}")
        return 1

    load_dotenv()
    project = os.environ.get("LANGSMITH_PROJECT")
    if not project:
        print("LANGSMITH_PROJECT missing")
        return 1

    client = Client()
    runs = client.list_runs(project_name=project, limit=20)
    rows = []

    for run in runs:
        question = getattr(run, "inputs", {}).get("question")
        answer = getattr(run, "outputs", {}).get("answer")
        contexts = getattr(run, "outputs", {}).get("contexts", [])

        if not question or not answer:
            continue

        rows.append(
            {
                "question": question,
                "answer": answer,
                "contexts": contexts if isinstance(contexts, list) else [],
                "ground_truth": "",
            }
        )

    OUTPUT_PATH.write_text(json.dumps(rows, indent=2))
    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
