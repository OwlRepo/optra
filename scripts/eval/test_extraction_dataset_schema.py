import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent
DATASET_PATH = ROOT / "extraction-eval-dataset.json"
EVALUATE_PATH = ROOT / "evaluate_extraction.py"
EXPECTED_FIELDS = [
    "title",
    "issueSummary",
    "reproSteps",
    "severity",
    "productArea",
    "hypothesizedRootCause",
    "nextAction",
]


class ExtractionEvalHarnessSchemaTest(unittest.TestCase):
    def test_dataset_rows_have_required_fields(self):
        rows = json.loads(DATASET_PATH.read_text())

        self.assertIsInstance(rows, list)
        self.assertGreater(len(rows), 0)

        for row in rows:
            self.assertIsInstance(row, dict)
            self.assertIsInstance(row["transcript"], str)
            self.assertIsInstance(row["expected"], dict)
            self.assertIsInstance(row["should_create_ticket"], bool)

            for field in EXPECTED_FIELDS:
                if row["should_create_ticket"]:
                    self.assertIsInstance(row["expected"][field], str)

    def test_evaluate_module_exports_expected_fields(self):
        spec = importlib.util.spec_from_file_location("evaluate_extraction", EVALUATE_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        self.assertEqual(module.FIELDS, EXPECTED_FIELDS)


if __name__ == "__main__":
    unittest.main()
