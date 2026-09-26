"""Tests for scripts/graphify-complete.py semantic_cache (stdlib unittest).

The completer imports graphify, so run with graphify's interpreter:
  $(cat graphify-out/.graphify_python) -m unittest discover -s scripts/graphify -p 'test_*.py'
"""

from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

from graphify.cache import file_hash

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("graphify_complete", HERE.parent / "graphify-complete.py")
gc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gc)

DOC = "docs/a.md"


class SemanticCacheTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.out = self.root / "graphify-out"
        (self.root / "docs").mkdir()
        self.doc = self.root / DOC
        self.doc.write_text("# A\n\ncurrent body\n", encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def entry(self, namespace: str, digest: str, label: str, mtime: int | None = None) -> Path:
        ns = self.out / "cache" / "semantic" / namespace
        ns.mkdir(parents=True, exist_ok=True)
        path = ns / f"{digest}.json"
        path.write_text(
            json.dumps(
                {
                    "nodes": [{"id": label, "label": label, "source_file": DOC}],
                    "edges": [{"source": label, "target": f"{label}_t"}],
                    "hyperedges": [],
                }
            ),
            encoding="utf-8",
        )
        if mtime is not None:
            os.utime(path, (mtime, mtime))
        return path

    def live(self) -> str:
        return file_hash(self.doc, self.root)

    def test_error_no_namespace_raises(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "No Graphify semantic cache"):
            gc.semantic_cache(self.root, self.out, {DOC})

    def test_error_live_doc_without_entry_is_named(self) -> None:
        self.entry("pold", "0" * 64, "stale")
        with self.assertRaisesRegex(RuntimeError, r"misses 1 files: \['docs/a.md'\]"):
            gc.semantic_cache(self.root, self.out, {DOC})

    def test_edge_stale_entry_of_edited_doc_is_ignored(self) -> None:
        self.entry("pnew", "f" * 64, "stale")
        self.entry("pnew", self.live(), "current")
        nodes, _, _, _ = gc.semantic_cache(self.root, self.out, {DOC})
        self.assertEqual([n["id"] for n in nodes], ["current"])

    def test_edge_doc_cached_only_under_older_prompt_is_served(self) -> None:
        self.entry("pnew", "f" * 64, "other")
        self.entry("pold", self.live(), "legacy")
        nodes, _, _, used = gc.semantic_cache(self.root, self.out, {DOC})
        self.assertEqual([n["id"] for n in nodes], ["legacy"])
        self.assertEqual(used, ["pold"])

    def test_regression_same_hash_in_two_namespaces_loads_newest_once(self) -> None:
        self.entry("pold", self.live(), "older", mtime=1_000_000)
        self.entry("pnew", self.live(), "newer", mtime=2_000_000)
        nodes, edges, _, used = gc.semantic_cache(self.root, self.out, {DOC})
        self.assertEqual([n["id"] for n in nodes], ["newer"])
        self.assertEqual(len(edges), 1)
        self.assertEqual(used, ["pnew"])

    def test_happy_returns_live_nodes_edges_and_namespaces(self) -> None:
        self.entry("pnew", self.live(), "current")
        nodes, edges, hyperedges, used = gc.semantic_cache(self.root, self.out, {DOC})
        self.assertEqual(len(nodes), 1)
        self.assertEqual(edges, [{"source": "current", "target": "current_t"}])
        self.assertEqual(hyperedges, [])
        self.assertEqual(used, ["pnew"])


if __name__ == "__main__":
    unittest.main()
