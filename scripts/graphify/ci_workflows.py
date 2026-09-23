#!/usr/bin/env python3
"""Deterministic graphify fragment for GitHub Actions workflows.

Graphify's semantic pass represents `.github/workflows/*.yml` only as prose (Optra's
deploy.yml is a single "Production Deploy Pipeline" document node), so the CI quality
gate and the VPS deploy have no structural shape in the graph. This module parses the
YAML itself and emits workflow / job / step / trigger / secret nodes, plus `calls`
edges from a CI step to the repository script it actually runs — directly, or through
a `bun run <script>` / `npm run <script>` entry in the package.json of the step's
`working-directory`.

Ported from the Tarraula reference (scripts/graphify/ci_workflows.py): the YAML subset
parser is unchanged except that plain scalar list items (`- '**/*.md'`) now parse
instead of looping forever; the Modal-worker section is dropped (Optra has none); bun is
recognised; `contains` edges are emitted parent -> child, matching the AST extractor.

Used two ways:
  * in-process by scripts/graphify-complete.py (`extract(root, ast_node_ids)`), so every
    full graph rebuild carries the CI structure;
  * standalone: `python3 scripts/graphify/ci_workflows.py` prints what it would add
    against the committed graphify-out/graph.json.

No third-party dependencies (PyYAML is not assumed on graphify's interpreter).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

SCRIPT_EXTS = ("mjs", "cjs", "js", "jsx", "ts", "tsx", "py", "sh")

# Requires at least one directory separator: a bare `app.py` in prose is not a repo path.
PATH_RE = re.compile(
    r"(?<![\w/.\-])((?:[\w.\-]+/)+[\w.\-]+\.(?:" + "|".join(SCRIPT_EXTS) + r"))(?![\w.])"
)
# `bun run x`, `npm run x`, and the lifecycle alias `npm test`.
RUN_SCRIPT_RE = re.compile(r"\b(?:bun|npm)\s+(?:run\s+([A-Za-z0-9:_.\-]+)(?![\w/.])|(test)\b)")
PKG_CMD_RE = re.compile(r"\b(?:bun|bunx|npm|npx)\b")
SECRET_RE = re.compile(r"\b(secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)")


# --------------------------------------------------------------------------------------
# Minimal YAML subset parser (line-number preserving), from the reference
# --------------------------------------------------------------------------------------


class Y:
    """A parsed YAML value plus the 1-based line it started on."""

    __slots__ = ("v", "line", "end_line")

    def __init__(self, v, line, end_line=None):
        self.v = v
        self.line = line
        self.end_line = end_line if end_line is not None else line

    def __repr__(self):  # pragma: no cover - debugging aid
        return f"Y({self.v!r}@L{self.line})"


BLOCK_SCALAR_MARKERS = {"|", "|-", "|+", ">", ">-", ">+"}
KEY_RE = re.compile(r"^([A-Za-z_][\w.\-]*|\"[^\"]+\"|'[^']+')\s*:(\s|$)")


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _is_skippable(line: str) -> bool:
    s = line.strip()
    return (not s) or s.startswith("#")


def _next_content(lines: list[str], i: int) -> int:
    while i < len(lines) and _is_skippable(lines[i]):
        i += 1
    return i


def _last_content_line(lines: list[str], end_exclusive: int, floor: int) -> int:
    """1-based line number of the last real content line in [floor, end_exclusive).

    Without this, a block's span runs up to the next parsed line and swallows the
    comment paragraph that documents the FOLLOWING step -- deploy.yml has several.
    """
    j = min(end_exclusive, len(lines)) - 1
    while j >= floor and _is_skippable(lines[j]):
        j -= 1
    return max(j + 1, floor + 1)


def _strip_inline_comment(text: str) -> str:
    out = []
    quote = None
    prev = ""
    for idx, ch in enumerate(text):
        if quote:
            out.append(ch)
            if ch == quote and prev != "\\":
                quote = None
        elif ch in "\"'":
            quote = ch
            out.append(ch)
        elif ch == "#" and (idx == 0 or text[idx - 1] in " \t"):
            break
        else:
            out.append(ch)
        prev = ch
    return "".join(out).rstrip()


def _scalar(raw: str):
    s = _strip_inline_comment(raw).strip()
    if not s:
        return None
    if s.startswith("[") and s.endswith("]"):
        inner = s[1:-1].strip()
        if not inner:
            return []
        return [_unquote(part.strip()) for part in inner.split(",")]
    return _unquote(s)


def _unquote(s: str) -> str:
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def _split_key(content: str):
    m = KEY_RE.match(content)
    if not m:
        return None, None
    key = _unquote(m.group(1))
    rest = content[m.end(1) + content[m.end(1):].index(":") + 1:]
    return key, rest


def _read_block_scalar(lines: list[str], i: int, parent_indent: int):
    """Consume an indented block scalar body starting at line index i."""
    body: list[str] = []
    end = i - 1
    while i < len(lines):
        line = lines[i]
        if line.strip() == "":
            body.append("")
            i += 1
            continue
        if _indent(line) <= parent_indent:
            break
        body.append(line)
        end = i
        i += 1
    # Drop trailing blanks captured past the real end of the block.
    while body and body[-1] == "":
        body.pop()
    if not body:
        return "", i, end
    base = min(_indent(b) for b in body if b.strip())
    return "\n".join(b[base:] if b.strip() else "" for b in body), i, end


def _parse_node(lines: list[str], i: int, indent: int):
    i = _next_content(lines, i)
    if i >= len(lines):
        return None, i
    if _indent(lines[i]) < indent:
        return None, i
    content = lines[i].strip()
    if content.startswith("- ") or content == "-":
        return _parse_sequence(lines, i, _indent(lines[i]))
    return _parse_mapping(lines, i, _indent(lines[i]))


def _parse_mapping(lines: list[str], i: int, indent: int):
    result: dict[str, Y] = {}
    while True:
        i = _next_content(lines, i)
        if i >= len(lines):
            break
        cur = _indent(lines[i])
        if cur < indent:
            break
        if cur > indent:
            # Malformed for our subset; refuse to guess.
            break
        content = lines[i].strip()
        if content.startswith("- "):
            break
        key, rest = _split_key(content)
        if key is None:
            break
        line_no = i + 1
        rest_stripped = _strip_inline_comment(rest).strip()
        if rest_stripped in BLOCK_SCALAR_MARKERS:
            text, i, end = _read_block_scalar(lines, i + 1, indent)
            result[key] = Y(text, line_no, end + 1)
            continue
        if rest_stripped:
            result[key] = Y(_scalar(rest), line_no, line_no)
            i += 1
            continue
        # Empty value: look ahead for a nested block.
        j = _next_content(lines, i + 1)
        if j < len(lines):
            child_indent = _indent(lines[j])
            child = lines[j].strip()
            if child_indent > indent or (
                child_indent == indent and child.startswith("- ")
            ):
                start_idx = i
                value, i = _parse_node(lines, i + 1, child_indent)
                end = _last_content_line(lines, i, start_idx)
                result[key] = Y(value, line_no, max(line_no, end))
                continue
        result[key] = Y(None, line_no, line_no)
        i += 1
    return result, i


def _parse_sequence(lines: list[str], i: int, indent: int):
    items: list[Y] = []
    while True:
        i = _next_content(lines, i)
        if i >= len(lines) or _indent(lines[i]) != indent:
            break
        content = lines[i].strip()
        if not (content.startswith("- ") or content == "-"):
            break
        line_no = i + 1
        if content == "-":
            start_idx = i
            value, i = _parse_node(lines, i + 1, indent + 1)
            items.append(Y(value, line_no, max(line_no, _last_content_line(lines, i, start_idx))))
            continue
        # Rewrite `- foo: bar` into `  foo: bar` at the item's own indent so the
        # generic mapping parser handles a dash-introduced block uniformly.
        raw = lines[i]
        offset = raw.index("-", indent) + 1
        while offset < len(raw) and raw[offset] == " ":
            offset += 1
        # `- '**/*.md'` is a plain scalar item, not a mapping. The reference parser sent
        # it to the mapping parser, which consumed nothing, so this loop never advanced
        # (Optra's deploy.yml `paths-ignore:` lists hit it).
        if _split_key(raw[offset:])[0] is None:
            items.append(Y(_scalar(raw[offset:]), line_no, line_no))
            i += 1
            continue
        patched = list(lines)
        patched[i] = " " * offset + raw[offset:]
        value, next_i = _parse_node(patched, i, offset)
        end = _last_content_line(lines, next_i, i)
        items.append(Y(value, line_no, max(line_no, end)))
        i = next_i
    return items, i


def parse_yaml(text: str):
    lines = text.replace("\t", "    ").split("\n")
    value, _ = _parse_node(lines, 0, 0)
    return value


# --------------------------------------------------------------------------------------
# Graph helpers
# --------------------------------------------------------------------------------------




# --------------------------------------------------------------------------------------
# Graph helpers
# --------------------------------------------------------------------------------------


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "_", text.lower())


def file_node_id(repo_path: str) -> str:
    """Graphify's AST id for a file: the path without extension, slugged."""
    return slug(re.sub(r"\.[^./]+$", "", repo_path))


def node(nid, label, file_type, source_file, source_location):
    return {
        "id": nid,
        "label": label,
        "file_type": file_type,
        "source_file": source_file,
        "source_location": source_location,
        "source_url": None,
        "captured_at": None,
        "author": None,
        "contributor": None,
    }


def edge(source, target, relation, source_file, source_location):
    return {
        "source": source,
        "target": target,
        "relation": relation,
        "confidence": "EXTRACTED",
        "confidence_score": 1.0,
        "source_file": source_file,
        "source_location": source_location,
        "weight": 1.0,
    }


def loc(line, end=None):
    if end is None or end <= line:
        return f"L{line}"
    return f"L{line}-L{end}"


# --------------------------------------------------------------------------------------
# package.json script resolution
# --------------------------------------------------------------------------------------


def load_scripts(root: Path, workdir: str) -> dict[str, str]:
    pkg = root / workdir / "package.json"
    if not pkg.is_file():
        return {}
    return json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {})


def strip_shell_comments(text: str) -> str:
    return "\n".join(l for l in text.split("\n") if not l.strip().startswith("#"))


def extract_repo_paths(text: str, workdir: str, root: Path) -> list[str]:
    found = []
    for m in PATH_RE.finditer(text):
        p = m.group(1)
        p = p[2:] if p.startswith("./") else p
        # A path in a `working-directory:` step is relative to that directory; fall back
        # to the repo root only when it does not exist there.
        if workdir not in ("", ".") and (root / workdir / p).is_file():
            p = f"{workdir}/{p}"
        if p not in found:
            found.append(p)
    return found


def resolve_command(command: str, scripts: dict[str, str], workdir: str, root: Path, seen: set[str]):
    """Return (repo paths referenced, script names invoked) for a shell command."""
    text = strip_shell_comments(command)
    paths = extract_repo_paths(text, workdir, root)
    names: list[str] = []
    for m in RUN_SCRIPT_RE.finditer(text):
        name = m.group(1) or m.group(2)
        if name not in names:
            names.append(name)
        if name in scripts and name not in seen:
            seen.add(name)
            sub_paths, sub_names = resolve_command(scripts[name], scripts, workdir, root, seen)
            paths += [p for p in sub_paths if p not in paths]
            names += [n for n in sub_names if n not in names]
    return paths, names


def text_of(step: dict, key: str) -> str:
    y = step.get(key)
    return y.v if y is not None and isinstance(y.v, str) else ""


def step_texts(step: dict) -> str:
    """Shell a step executes: `run:`, plus a `with: script:` block (SSH deploy actions)."""
    parts = [text_of(step, "run")]
    with_ = step.get("with")
    if with_ is not None and isinstance(with_.v, dict):
        parts.append(text_of(with_.v, "script"))
    return "\n".join(p for p in parts if p)


def step_label(step: dict) -> str:
    if text_of(step, "name"):
        return text_of(step, "name")
    if text_of(step, "uses"):
        return f"uses: {text_of(step, 'uses')}"
    first = next((l.strip() for l in text_of(step, "run").split("\n") if l.strip()), "")
    return f"run: {first[:70]}" if first else "step"


def is_identifiable(step: dict, paths, names) -> bool:
    """Keep `uses:` actions and steps that do something nameable."""
    if "uses" in step or paths or names or text_of(step, "name"):
        return True
    return bool(PKG_CMD_RE.search(text_of(step, "run")))


def trigger_label(event: str, cfg) -> str:
    if event == "schedule" and isinstance(cfg, list):
        crons = [str(i.v["cron"].v) for i in cfg if isinstance(i, Y) and isinstance(i.v, dict) and "cron" in i.v]
        return f"schedule: {', '.join(crons)}" if crons else "schedule"
    if event == "push" and isinstance(cfg, dict) and "branches" in cfg and isinstance(cfg["branches"].v, list):
        return f"push: {', '.join(str(x) for x in cfg['branches'].v)}"
    return event


# --------------------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------------------


def extract(root: Path, ast_node_ids: set[str]) -> dict:
    """Fragment for every `.github/workflows/*.yml` under root.

    ast_node_ids: ids already in the graph; a `calls` edge is only emitted to a script
    that exists on disk AND has a graph node, so the fragment never leaves dangling
    endpoints. Unresolved links are reported in stats instead of guessed.
    """
    nodes: list[dict] = []
    edges: list[dict] = []
    new_ids: set[str] = set()
    seen_edges: set[tuple] = set()
    stats = {"workflows": 0, "jobs": 0, "steps_kept": 0, "steps_total": 0,
             "links_resolved": [], "links_unresolved": []}

    def add_node(n):
        if n["id"] not in new_ids and n["id"] not in ast_node_ids:
            new_ids.add(n["id"])
            nodes.append(n)

    def add_edge(e):
        key = (e["source"], e["target"], e["relation"])
        if key not in seen_edges:
            seen_edges.add(key)
            edges.append(e)

    wf_dir = root / ".github" / "workflows"
    for wf_path in sorted(wf_dir.glob("*.yml")) if wf_dir.is_dir() else []:
        rel = wf_path.relative_to(root).as_posix()
        text = wf_path.read_text(encoding="utf-8")
        doc = parse_yaml(text)
        if not isinstance(doc, dict):
            print(f"SKIP (unparsed): {rel}", file=sys.stderr)
            continue
        stats["workflows"] += 1
        wf_slug = slug(wf_path.stem)
        wf_id = file_node_id(rel)
        wf_name = text_of(doc, "name") or wf_path.name
        add_node(node(wf_id, wf_path.name, "code", rel, "L1"))

        on = doc.get("on")
        if on is not None and isinstance(on.v, dict):
            for event, cfg in on.v.items():
                tid = f"ci_trigger_{wf_slug}_{slug(event)}"
                add_node(node(tid, trigger_label(event, cfg.v), "code", rel, loc(cfg.line, cfg.end_line)))
                add_edge(edge(tid, wf_id, "triggers", rel, loc(cfg.line, cfg.end_line)))

        jobs = doc.get("jobs")
        job_entries = list(jobs.v.items()) if jobs is not None and isinstance(jobs.v, dict) else []
        spans = []
        for idx, (job_id, job_y) in enumerate(job_entries):
            end = job_entries[idx + 1][1].line - 1 if idx + 1 < len(job_entries) else len(text.split("\n"))
            spans.append((job_y.line, end, f"ci_job_{wf_slug}_{slug(job_id)}"))

        for job_id, job_y in job_entries:
            job_nid = f"ci_job_{wf_slug}_{slug(job_id)}"
            job = job_y.v if isinstance(job_y.v, dict) else {}
            add_node(node(job_nid, f"{wf_name}: {text_of(job, 'name') or job_id}", "code", rel,
                          loc(job_y.line, job_y.end_line)))
            add_edge(edge(wf_id, job_nid, "contains", rel, loc(job_y.line)))
            stats["jobs"] += 1

            needs = job.get("needs")
            if needs is not None:
                for t in needs.v if isinstance(needs.v, list) else [needs.v]:
                    if t:
                        add_edge(edge(job_nid, f"ci_job_{wf_slug}_{slug(str(t))}", "references", rel, loc(needs.line)))

            steps = job.get("steps")
            for n_idx, step_y in enumerate(steps.v if steps is not None and isinstance(steps.v, list) else [], start=1):
                stats["steps_total"] += 1
                step = step_y.v if isinstance(step_y.v, dict) else {}
                workdir = text_of(step, "working-directory") or "."
                shell = step_texts(step)
                scripts = load_scripts(root, workdir)
                paths, names = resolve_command(shell, scripts, workdir, root, set()) if shell else ([], [])
                if not is_identifiable(step, paths, names):
                    continue
                step_nid = f"ci_step_{wf_slug}_{slug(job_id)}_{n_idx}"
                add_node(node(step_nid, step_label(step), "code", rel, loc(step_y.line, step_y.end_line)))
                add_edge(edge(job_nid, step_nid, "contains", rel, loc(step_y.line)))
                stats["steps_kept"] += 1
                for p in paths:
                    target = file_node_id(p)
                    if (root / p).is_file() and target in ast_node_ids:
                        add_edge(edge(step_nid, target, "calls", rel, loc(step_y.line)))
                        stats["links_resolved"].append((step_nid, p))
                    else:
                        why = "missing file" if not (root / p).is_file() else "no graph node"
                        stats["links_unresolved"].append((step_nid, p, why))
                for name in names:
                    if name not in scripts:
                        stats["links_unresolved"].append((step_nid, f"run {name}", f"not in {workdir}/package.json"))

        for line_no, line in enumerate(text.split("\n"), start=1):
            if line.strip().startswith("#"):
                continue
            for _kind, name in SECRET_RE.findall(line):
                sid = f"ci_secret_{name.lower()}"
                add_node(node(sid, name, "concept", rel, loc(line_no)))
                owner = next((jid for start, end, jid in spans if start <= line_no <= end), wf_id)
                add_edge(edge(owner, sid, "references", rel, loc(line_no)))

    # Job `needs:` may name a job that does not exist; drop such edges rather than dangle.
    known = new_ids | ast_node_ids
    edges = [e for e in edges if e["source"] in known and e["target"] in known]
    return {"nodes": nodes, "edges": edges, "stats": stats}


def main() -> int:
    graph = json.loads((REPO_ROOT / "graphify-out" / "graph.json").read_text(encoding="utf-8"))
    frag = extract(REPO_ROOT, {n["id"] for n in graph["nodes"]})
    s = frag["stats"]
    print(f"nodes: {len(frag['nodes'])}   edges: {len(frag['edges'])}")
    print(f"workflows: {s['workflows']}   jobs: {s['jobs']}   steps: {s['steps_kept']} kept / {s['steps_total']} total")
    print(f"script links resolved: {len(s['links_resolved'])}")
    for step, p in s["links_resolved"]:
        print(f"  {step} -> {p}")
    print(f"script links unresolved: {len(s['links_unresolved'])}")
    for item in s["links_unresolved"]:
        print(f"  {item[0]} -> {item[1]}   [{item[2]}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
