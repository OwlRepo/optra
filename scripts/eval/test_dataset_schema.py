import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent
DATASET_PATH = ROOT / "eval-dataset.json"
EVALUATE_PATH = ROOT / "evaluate.py"


class EvalHarnessSchemaTest(unittest.TestCase):
    def test_dataset_rows_have_required_fields(self):
        rows = json.loads(DATASET_PATH.read_text())

        self.assertIsInstance(rows, list)
        self.assertGreater(len(rows), 0)

        for row in rows:
            self.assertIsInstance(row, dict)
            self.assertIsInstance(row["question"], str)
            self.assertIsInstance(row["answer"], str)
            self.assertIsInstance(row["contexts"], list)
            self.assertTrue(all(isinstance(context, str) for context in row["contexts"]))
            self.assertIsInstance(row["ground_truth"], str)

    def test_evaluate_module_exports_expected_metrics(self):
        spec = importlib.util.spec_from_file_location("evaluate", EVALUATE_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        self.assertEqual(
            module.METRICS,
            [
                "faithfulness",
                "answer_relevancy",
                "context_precision",
                "context_recall",
            ],
        )


if __name__ == "__main__":
    unittest.main()
