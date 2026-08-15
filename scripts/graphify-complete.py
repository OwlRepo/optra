#!/usr/bin/env python3
"""Complete a Graphify graph without inventing relationships.

Graphify's structural extractor intentionally emits no nodes for data-only JSON
files and may emit edges to references that do not have local definitions. Its
default undirected Graph also collapses parallel edge variants. This script
keeps those facts visible by adding explicit artifact/reference nodes and by
writing a ledger for every collapsed edge variant.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.cli import _stamped_manifest_files
from graphify.detect import detect, save_manifest
from graphify.diagnostics import diagnose_extraction
from graphify.export import to_json
from graphify.extract import collect_files, extract
from graphify.report import generate


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--out", type=Path, default=Path("graphify-out"))
    parser.add_argument(
        "--parallel",
        action="store_true",
        help="Use Graphify multiprocessing for AST extraction.",
    )
    return parser.parse_args()


def normalize_source(root: Path, source: str | None) -> str | None:
    if not source:
        return None
    path = Path(source)
    resolved = path.resolve() if path.is_absolute() else (root / path).resolve()
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError:
        return resolved.as_posix()


def exclude_output_tree(detection: dict[str, Any], out: Path) -> dict[str, Any]:
    """Keep generated graph memory/cache out of application coverage."""
    removed: list[str] = []
    for category, sources in detection.get("files", {}).items():
        removed.extend(
            source for source in sources if Path(source).resolve().is_relative_to(out)
        )
        detection["files"][category] = [
            source
            for source in sources
            if not Path(source).resolve().is_relative_to(out)
        ]
    detection["total_files"] = sum(
        len(sources) for sources in detection.get("files", {}).values()
    )
    for source in removed:
        try:
            text = Path(source).read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        detection["total_words"] = max(
            0,
            detection.get("total_words", 0) - len(re.findall(r"\b\w+\b", text)),
        )
    return detection


def semantic_cache(out: Path) -> tuple[list[dict], list[dict], list[dict], Path]:
    namespaces = [path for path in (out / "cache" / "semantic").glob("*") if path.is_dir()]
    if not namespaces:
        raise RuntimeError("No Graphify semantic cache found. Run /graphify first.")

    namespace = max(
        namespaces,
        key=lambda path: (len(list(path.glob("*.json"))), path.stat().st_mtime),
    )
    nodes: list[dict] = []
    edges: list[dict] = []
    hyperedges: list[dict] = []
    for cache_file in sorted(namespace.glob("*.json")):
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        nodes.extend(data.get("nodes", []))
        edges.extend(data.get("edges", []))
        hyperedges.extend(data.get("hyperedges", []))
    return nodes, edges, hyperedges, namespace


def merge_nodes(*groups: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for group in groups:
        for node in group:
            node_id = node.get("id")
            if node_id and node_id not in seen:
                merged.append(node)
                seen.add(node_id)
    return merged


def artifact_id(source_file: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "_", source_file.lower()).strip("_")
    return f"coverage_artifact_{stem}"


def unresolved_label(node_id: str) -> str:
    tail = node_id.rsplit("_", 1)[-1]
    return tail or node_id


def add_coverage_nodes(
    root: Path,
    detection: dict[str, Any],
    nodes: list[dict],
    edges: list[dict],
) -> tuple[list[dict], list[str], list[str]]:
    ids = {node["id"] for node in nodes}
    first_edge: dict[str, dict] = {}
    unresolved: list[str] = []
    for edge in edges:
        for endpoint in (edge.get("source"), edge.get("target")):
            if isinstance(endpoint, str) and endpoint not in ids:
                first_edge.setdefault(endpoint, edge)

    for endpoint, edge in sorted(first_edge.items()):
        nodes.append(
            {
                "id": endpoint,
                "label": unresolved_label(endpoint),
                "file_type": "code",
                "source_file": edge.get("source_file"),
                "source_location": edge.get("source_location"),
                "metadata": {
                    "kind": "unresolved_reference",
                    "coverage_note": "Referenced by extracted edge; local definition absent.",
                },
                "_origin": "coverage_placeholder",
            }
        )
        ids.add(endpoint)
        unresolved.append(endpoint)

    represented = {
        normalize_source(root, node.get("source_file"))
        for node in nodes
        if node.get("source_file")
    }
    detected_files = {
        normalize_source(root, source)
        for sources in detection.get("files", {}).values()
        for source in sources
    }
    zero_node_files = sorted(source for source in detected_files - represented if source)
    for source_file in zero_node_files:
        node_id = artifact_id(source_file)
        if node_id in ids:
            continue
        nodes.append(
            {
                "id": node_id,
                "label": Path(source_file).name,
                "file_type": "code",
                "source_file": source_file,
                "source_location": None,
                "metadata": {
                    "kind": "file_artifact",
                    "coverage_note": "Detected source produced no structural or semantic symbols.",
                },
                "_origin": "coverage_artifact",
            }
        )
        ids.add(node_id)

    return nodes, zero_node_files, unresolved


def label_words(value: str) -> list[str]:
    value = re.sub(r"\.(tsx?|jsx?|mts|cts|json|md|ya?ml|sql|py|sh)$", "", value, flags=re.I)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value)
    ignored = {"src", "app", "index", "spec", "test", "tests"}
    return [
        token
        for token in re.split(r"[^A-Za-z0-9]+", value)
        if token and token.lower() not in ignored
    ]


def community_name(graph: Any, members: list[str]) -> str:
    ranked = sorted(
        members,
        key=lambda node_id: (
            graph.degree(node_id),
            graph.nodes[node_id].get("source_location") == "L1",
        ),
        reverse=True,
    )
    attrs = graph.nodes[ranked[0]]
    source = attrs.get("source_file", "")
    parts = Path(source).parts
    words: list[str]
    if len(parts) >= 4 and parts[:3] == ("apps", "api", "src"):
        words = ["API", *label_words(parts[3]), *label_words(parts[-1])]
    elif len(parts) >= 3 and parts[:2] == ("apps", "web"):
        middle = [
            part
            for part in parts[2:-1]
            if part not in {"app", "src", "components", "lib", "api"}
            and not part.startswith("(")
        ]
        words = ["Web"]
        if middle:
            words.extend(label_words(middle[-1]))
        words.extend(label_words(parts[-1]))
    elif len(parts) >= 2 and parts[0] == "packages":
        words = [*label_words(parts[1]), "Package", *label_words(parts[-1])]
    elif parts and parts[0] == "docs":
        words = ["Docs", *label_words(parts[-1])]
    elif parts and parts[0] == "scripts":
        words = ["Scripts", *label_words(parts[-1])]
    else:
        words = label_words(attrs.get("label") or Path(source).name)

    unique: list[str] = []
    for word in words:
        formatted = word if word.isupper() else word.title()
        if formatted.lower() not in {item.lower() for item in unique}:
            unique.append(formatted)
    unique = unique[:5]
    if len(unique) < 2:
        unique.append("Module")
    return " ".join(unique)


def collapsed_variants(edges: list[dict]) -> list[dict]:
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if isinstance(source, str) and isinstance(target, str):
            groups[tuple(sorted((source, target)))].append(edge)
    return [
        {"endpoints": list(endpoints), "variants": variants}
        for endpoints, variants in sorted(groups.items())
        if len(variants) > 1
    ]


def write_coverage_report(
    root: Path,
    out: Path,
    detection: dict[str, Any],
    graph: Any,
    raw_edges: list[dict],
    zero_node_files: list[str],
    unresolved: list[str],
    variants: list[dict],
    diagnostic: dict[str, Any],
    semantic_file_count: int,
) -> None:
    skipped = detection.get("skipped_sensitive", [])
    lines = [
        "# Graph Coverage Report",
        "",
        "## Coverage",
        "",
        f"- Detected source files: {detection.get('total_files', 0)}",
        f"- Source files represented by graph nodes: {detection.get('total_files', 0)}",
        f"- Semantic files represented: {semantic_file_count}",
        f"- Raw extracted relationships retained: {len(raw_edges)}",
        f"- Interactive unique endpoint-pair edges: {graph.number_of_edges()}",
        f"- Collapsed edge groups preserved in ledger: {len(variants)}",
        f"- Zero-symbol files materialized as artifacts: {len(zero_node_files)}",
        f"- Unresolved endpoint IDs materialized as placeholders: {len(unresolved)}",
        "",
        "## Integrity",
        "",
        f"- Missing endpoint edges: {diagnostic.get('missing_endpoint_edges', 0)}",
        f"- Dangling endpoint edges: {diagnostic.get('dangling_endpoint_edges', 0)}",
        f"- Self-loop edges: {diagnostic.get('self_loop_edges', 0)}",
        f"- Undirected collapsed variants: {diagnostic.get('undirected_same_endpoint_collapsed_edges', 0)}",
        "",
        "Parallel variants are retained in `collapsed-edge-variants.json`; the interactive graph remains an undirected simple graph.",
        "",
        "## Zero-symbol Files",
        "",
    ]
    lines.extend(f"- `{source}`" for source in zero_node_files)
    lines.extend(
        [
            "",
            "## Excluded External Symlinks",
            "",
            f"{len(skipped)} paths were excluded because their symlink targets are outside the scan root. They are tooling links, not application corpus files.",
            "",
        ]
    )
    root_prefix = root.as_posix().rstrip("/") + "/"
    lines.extend(f"- `{item.replace(root_prefix, '')}`" for item in skipped)
    out.joinpath("COVERAGE_REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    out = (root / args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    detection = exclude_output_tree(detect(root), out)
    code_files: list[Path] = []
    for source in detection.get("files", {}).get("code", []):
        path = Path(source)
        code_files.extend(collect_files(path) if path.is_dir() else [path])
    ast = extract(code_files, cache_root=root, parallel=args.parallel)

    semantic_nodes, semantic_edges, hyperedges, cache_namespace = semantic_cache(out)
    expected_semantic = {
        normalize_source(root, source)
        for category in ("document", "paper", "image")
        for source in detection.get("files", {}).get(category, [])
    }
    covered_semantic = {
        normalize_source(root, node.get("source_file"))
        for node in semantic_nodes
        if node.get("source_file")
    }
    missing_semantic = sorted(source for source in expected_semantic - covered_semantic if source)
    if missing_semantic:
        raise RuntimeError(f"Semantic cache misses {len(missing_semantic)} files: {missing_semantic}")

    nodes = merge_nodes(ast.get("nodes", []), semantic_nodes)
    edges = [*ast.get("edges", []), *semantic_edges]
    nodes, zero_node_files, unresolved = add_coverage_nodes(root, detection, nodes, edges)

    extraction = {
        "nodes": nodes,
        "edges": edges,
        "hyperedges": hyperedges,
        "input_tokens": 0,
        "output_tokens": 0,
    }
    manifest_files = _stamped_manifest_files(detection["files"], extraction, root)
    scan_corpus = {
        source
        for sources in detection["files"].values()
        for source in sources
    }
    save_manifest(manifest_files, root=root, scan_corpus=scan_corpus)
    diagnostic = diagnose_extraction(extraction, directed=False, root=root)
    if diagnostic.get("missing_endpoint_edges") or diagnostic.get("dangling_endpoint_edges"):
        raise RuntimeError("Coverage completion left unresolved graph endpoints.")

    graph = build_from_json(extraction, root=root, directed=False)
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    labels = {community_id: community_name(graph, members) for community_id, members in communities.items()}
    questions = suggest_questions(graph, communities, labels)
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)

    report = generate(
        graph,
        communities,
        cohesion,
        labels,
        gods,
        surprises,
        detection,
        {"input": 0, "output": 0},
        ".",
        suggested_questions=questions,
    )
    report = report.replace(
        "- Token cost: 0 input · 0 output",
        "- Token cost: unavailable (Codex worker usage was not exposed; zero placeholders excluded)",
    )
    report = re.sub(
        r"(- Large corpus: )\d+( files)",
        rf"\g<1>{detection.get('total_files', 0)}\g<2>",
        report,
        count=1,
    )
    out.joinpath("GRAPH_REPORT.md").write_text(report, encoding="utf-8")

    # This is a full deterministic rebuild, not an incremental merge. Legitimate
    # source edits may reduce node count, so the incremental shrink guard does not
    # apply after endpoint and source coverage have been validated above.
    if not to_json(
        graph,
        communities,
        str(out / "graph.json"),
        force=True,
        community_labels=labels,
    ):
        raise RuntimeError("Graphify shrink guard refused the completed graph.")
    graph_data = json.loads(out.joinpath("graph.json").read_text(encoding="utf-8"))
    graph_data["coverage"] = {
        "detected_files": detection.get("total_files", 0),
        "represented_files": detection.get("total_files", 0),
        "zero_symbol_artifacts": len(zero_node_files),
        "unresolved_reference_placeholders": len(unresolved),
        "raw_edges": len(edges),
        "interactive_edges": graph.number_of_edges(),
        "semantic_cache_namespace": cache_namespace.name,
    }
    out.joinpath("graph.json").write_text(
        json.dumps(graph_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    variants = collapsed_variants(edges)
    out.joinpath("collapsed-edge-variants.json").write_text(
        json.dumps(
            {
                "description": "Raw edge variants collapsed by the undirected simple graph export.",
                "groups": variants,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    write_coverage_report(
        root,
        out,
        detection,
        graph,
        edges,
        zero_node_files,
        unresolved,
        variants,
        diagnostic,
        len(expected_semantic),
    )

    subprocess.run(["graphify", "export", "html"], cwd=root, check=True)
    out.joinpath(".graphify_health.json").write_text(
        json.dumps(diagnostic, indent=2), encoding="utf-8"
    )
    out.joinpath(".coverage_ast.json").unlink(missing_ok=True)
    print(
        f"Coverage complete: {detection.get('total_files', 0)}/{detection.get('total_files', 0)} files, "
        f"{len(edges)} raw edges, {graph.number_of_edges()} interactive edges, "
        f"{len(unresolved)} unresolved references materialized."
    )


if __name__ == "__main__":
    main()
