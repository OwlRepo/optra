# RAGAS Eval Harness

Weekly offline check for chat answer quality.

## Setup

```bash
python3 -m venv scripts/eval/.venv
source scripts/eval/.venv/bin/activate
pip install -r scripts/eval/requirements.txt
```

Env:

- `OPENAI_API_KEY` required for judge calls
- `RAGAS_JUDGE_MODEL` optional, default `gpt-4-turbo`
- `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT` optional for capture helper

## Run

```bash
python scripts/eval/test_dataset_schema.py
python scripts/eval/evaluate.py
```

`evaluate.py` writes `scripts/eval/results/<UTC-timestamp>.json`, prints all four metrics, then prints lowest metric first.

## Dataset

Start with template/support-like rows in `eval-dataset.json`. Expand toward 20-50 rows using real production questions. `capture_from_langsmith.py` can pull recent runs into a merge file; add `ground_truth` manually before scoring.

## How To Read Scores

- Low `faithfulness`: tighten answer prompt, reduce unsupported synthesis.
- Low `answer_relevancy`: improve prompt focus and answer format.
- Low `context_precision`: smaller chunks, lower retrieval limit, better rewrite logic.
- Low `context_recall`: larger chunks, more overlap, higher retrieval limit.
- Complex multi-hop failures after decent RAG scores: justify conditional LangGraph path.

Fix lowest metric first. Re-run weekly and after major retrieval/prompt changes.
