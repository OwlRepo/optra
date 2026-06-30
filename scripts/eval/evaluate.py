from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


METRICS = [
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
]

ROOT = Path(__file__).resolve().parent
DATASET_PATH = ROOT / "eval-dataset.json"
RESULTS_DIR = ROOT / "results"


def load_dataset_rows() -> list[dict[str, Any]]:
    rows = json.loads(DATASET_PATH.read_text())
    if not isinstance(rows, list):
      raise ValueError("eval-dataset.json must be a JSON array")
    return rows


def build_ragas_dataset(rows: list[dict[str, Any]]):
    from datasets import Dataset

    normalized = {
        "question": [row["question"] for row in rows],
        "answer": [row["answer"] for row in rows],
        "contexts": [row["contexts"] for row in rows],
        "ground_truth": [row["ground_truth"] for row in rows],
    }
    return Dataset.from_dict(normalized)


def evaluate_rows(rows: list[dict[str, Any]], judge_model: str) -> dict[str, Any]:
    from ragas import evaluate
    from ragas.metrics import (
        answer_relevancy,
        context_precision,
        context_recall,
        faithfulness,
    )
    from langchain_openai import ChatOpenAI

    dataset = build_ragas_dataset(rows)
    llm = ChatOpenAI(model=judge_model)
    result = evaluate(
        dataset=dataset,
        metrics=[
            faithfulness,
            answer_relevancy,
            context_precision,
            context_recall,
        ],
        llm=llm,
    )
    return result.to_pandas().mean(numeric_only=True).to_dict()


def write_results(judge_model: str, scores: dict[str, Any], row_count: int) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"{timestamp}.json"
    payload = {
        "generatedAt": timestamp,
        "judgeModel": judge_model,
        "rowCount": row_count,
        "scores": scores,
        "lowestMetric": lowest_metric(scores),
    }
    path.write_text(json.dumps(payload, indent=2))
    return path


def lowest_metric(scores: dict[str, Any]) -> dict[str, Any]:
    metric, value = min(scores.items(), key=lambda item: float(item[1]))
    return {"name": metric, "value": float(value)}


def print_summary(scores: dict[str, Any]) -> None:
    print("Metric                 Score")
    print("---------------------  ------")
    for metric in METRICS:
        value = float(scores.get(metric, 0.0))
        print(f"{metric:<21}  {value:.4f}")

    lowest = lowest_metric(scores)
    print(
        f"\nLowest metric: {lowest['name']} ({lowest['value']:.4f})",
        flush=True,
    )


def main() -> int:
    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None

    if load_dotenv is not None:
        load_dotenv()

    judge_model = __import__("os").environ.get("RAGAS_JUDGE_MODEL", "gpt-4-turbo")

    try:
        rows = load_dataset_rows()
        scores = evaluate_rows(rows, judge_model)
        result_path = write_results(judge_model, scores, len(rows))
        print_summary(scores)
        print(f"Results JSON: {result_path}")
        return 0
    except Exception as error:  # hard error only
        print(f"Evaluation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
