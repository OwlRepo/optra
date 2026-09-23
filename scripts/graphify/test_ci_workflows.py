"""Tests for scripts/graphify/ci_workflows.py (stdlib unittest, no third-party deps).

Run: python3 -m unittest discover -s scripts/graphify -p 'test_*.py'
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ci_workflows", HERE / "ci_workflows.py")
ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci)

WORKFLOW = textwrap.dedent(
    """\
    name: CI and Deploy
    on:
      push:
        paths-ignore:
          - '**/*.md'
      pull_request:
    jobs:
      ci:
        name: Quality gate
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
            with:
              fetch-depth: 0
          # a comment between steps
          - name: TDD gate
            if: github.event_name == 'pull_request'
            run: bun run tdd:gate
          - name: Unit tests — apps/api
            run: bun run test
            working-directory: apps/api
          - run: echo hi
      deploy:
        needs: ci
        runs-on: ubuntu-latest
        steps:
          - name: Deploy over SSH
            uses: appleboy/ssh-action@v1.0.3
            with:
              host: ${{ secrets.VPS_HOST }}
              script: |
                sh scripts/ensure-seaweedfs-s3-config.sh
    """
)


def make_repo() -> Path:
    root = Path(tempfile.mkdtemp())
    (root / ".github" / "workflows").mkdir(parents=True)
    (root / ".github" / "workflows" / "deploy.yml").write_text(WORKFLOW, encoding="utf-8")
    (root / "scripts" / "ci").mkdir(parents=True)
    (root / "scripts" / "ci" / "tdd-gate.mjs").write_text("// gate\n", encoding="utf-8")
    (root / "scripts" / "ensure-seaweedfs-s3-config.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (root / "package.json").write_text(
        json.dumps({"scripts": {"tdd:gate": "node scripts/ci/tdd-gate.mjs"}}), encoding="utf-8"
    )
    (root / "apps" / "api").mkdir(parents=True)
    (root / "apps" / "api" / "package.json").write_text(
        json.dumps({"scripts": {"test": "jest"}}), encoding="utf-8"
    )
    return root


AST_IDS = {"scripts_ci_tdd_gate", "scripts_ensure_seaweedfs_s3_config"}


class CiWorkflowsFragment(unittest.TestCase):
    def setUp(self) -> None:
        self.root = make_repo()
        self.frag = ci.extract(self.root, AST_IDS)
        self.ids = {n["id"] for n in self.frag["nodes"]}

    def test_error_no_workflow_dir_yields_empty_fragment(self) -> None:
        empty = Path(tempfile.mkdtemp())
        frag = ci.extract(empty, set())
        self.assertEqual(frag["nodes"], [])
        self.assertEqual(frag["edges"], [])

    def test_error_no_dangling_edge_endpoints(self) -> None:
        known = self.ids | AST_IDS
        for e in self.frag["edges"]:
            self.assertIn(e["source"], known, e)
            self.assertIn(e["target"], known, e)

    def test_edge_bun_script_resolves_through_package_json_to_repo_file(self) -> None:
        calls = {(e["source"], e["target"]) for e in self.frag["edges"] if e["relation"] == "calls"}
        self.assertIn(("ci_step_deploy_ci_2", "scripts_ci_tdd_gate"), calls)

    def test_edge_path_inside_with_script_block_links_to_shell_script(self) -> None:
        calls = {(e["source"], e["target"]) for e in self.frag["edges"] if e["relation"] == "calls"}
        self.assertIn(("ci_step_deploy_deploy_1", "scripts_ensure_seaweedfs_s3_config"), calls)

    def test_edge_contains_is_parent_to_child(self) -> None:
        contains = {(e["source"], e["target"]) for e in self.frag["edges"] if e["relation"] == "contains"}
        self.assertIn(("_github_workflows_deploy", "ci_job_deploy_ci"), contains)
        self.assertIn(("ci_job_deploy_ci", "ci_step_deploy_ci_2"), contains)

    def test_edge_unnamed_trivial_run_step_is_dropped(self) -> None:
        self.assertNotIn("ci_step_deploy_ci_4", self.ids)

    def test_regression_scalar_sequence_items_do_not_hang_the_parser(self) -> None:
        doc = ci.parse_yaml("on:\n  push:\n    paths-ignore:\n      - '**/*.md'\n      - 'docs/**'\n")
        items = doc["on"].v["push"].v["paths-ignore"].v
        self.assertEqual([y.v for y in items], ["**/*.md", "docs/**"])

    def test_edge_json_file_is_not_read_as_a_js_script(self) -> None:
        paths = ci.extract_repo_paths("node -e \"require('./docker/seaweedfs/s3.json')\"", ".", self.root)
        self.assertEqual(paths, [])

    def test_edge_working_directory_script_path_resolves_inside_the_package(self) -> None:
        (self.root / "packages" / "db" / "scripts").mkdir(parents=True)
        (self.root / "packages" / "db" / "scripts" / "migrate.ts").write_text("", encoding="utf-8")
        scripts = {"db:migrate": "bun run scripts/migrate.ts"}
        paths, names = ci.resolve_command("bun run db:migrate", scripts, "packages/db", self.root, set())
        self.assertEqual(paths, ["packages/db/scripts/migrate.ts"])
        self.assertEqual(names, ["db:migrate"])

    def test_happy_triggers_jobs_needs_and_secrets(self) -> None:
        self.assertIn("ci_trigger_deploy_push", self.ids)
        self.assertIn("ci_trigger_deploy_pull_request", self.ids)
        self.assertIn("ci_secret_vps_host", self.ids)
        refs = {(e["source"], e["target"]) for e in self.frag["edges"] if e["relation"] == "references"}
        self.assertIn(("ci_job_deploy_deploy", "ci_job_deploy_ci"), refs)
        self.assertIn(("ci_job_deploy_deploy", "ci_secret_vps_host"), refs)


if __name__ == "__main__":
    unittest.main()
