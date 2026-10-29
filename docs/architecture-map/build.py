#!/usr/bin/env python3
"""Validate architecture data and build a self-contained offline HTML viewer."""
import argparse
import html
import json
import math
from datetime import datetime
from pathlib import Path
import sys

ASSETS = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def string(value, where, empty=False):
    require(isinstance(value, str) and (empty or bool(value.strip())), f"{where}: expected string")


def strings(value, where):
    require(isinstance(value, list), f"{where}: expected array")
    for item in value:
        string(item, where)


def index(items, where):
    require(isinstance(items, list), f"{where}: expected array")
    found = {}
    for item in items:
        require(isinstance(item, dict), f"{where}: expected object")
        string(item.get("id"), f"{where}.id")
        require(item["id"] not in found, f"{where}: duplicate id {item['id']}")
        found[item["id"]] = item
    return found


def refs(values, known, where):
    strings(values, where)
    for value in values:
        require(value in known, f"{where}: missing reference {value}")


def conclusion(item, sources, where):
    require(item.get("status") in ("fact", "inference", "unknown"), f"{where}: invalid status")
    refs(item.get("sourceIds"), sources, f"{where}.sourceIds")
    string(item.get("note"), f"{where}.note", empty=item["status"] == "fact")
    require(item["status"] == "unknown" or item["sourceIds"], f"{where}: evidence required")


def validate(data, source_root=None):
    require(isinstance(data, dict) and type(data.get("version")) is int and data["version"] == 1,
            "expected version 1 map object")
    meta = data.get("meta")
    require(isinstance(meta, dict), "meta: expected object")
    for key in ("title", "summary", "project", "generatedAt", "scope"):
        string(meta.get(key), f"meta.{key}")
    timestamp = datetime.fromisoformat(meta["generatedAt"].replace("Z", "+00:00"))
    require(timestamp.tzinfo is not None, "meta.generatedAt: timezone required")
    require(meta.get("commit") is None or isinstance(meta["commit"], str), "meta.commit: string or null")
    require("dirty" in meta and (meta["dirty"] is None or type(meta["dirty"]) is bool),
            "meta.dirty: boolean or null required")
    require(type(meta.get("demo")) is bool, "meta.demo: boolean required")
    strings(meta.get("limitations"), "meta.limitations")
    strings(data.get("changes"), "changes")
    sources = index(data.get("sources"), "sources")
    for key, source in sources.items():
        require(source.get("kind") in ("static", "config", "docs", "test", "runtime"),
                f"source {key}: invalid kind")
        for field in ("path", "locator", "note"):
            string(source.get(field), f"source {key}.{field}", empty=field == "note")
        path = Path(source["path"])
        require(not path.is_absolute() and ".." not in path.parts, f"source {key}: use project-relative path")
        if "line" in source:
            require(type(source["line"]) is int and source["line"] > 0, f"source {key}: invalid line")
        if source_root and source["kind"] != "runtime":
            resolved = (source_root / path).resolve()
            require(resolved.is_relative_to(source_root) and resolved.is_file(),
                    f"source {key}: file missing or outside source root: {path}")
    nodes = index(data.get("nodes"), "nodes")
    require(nodes, "nodes: at least one node required")
    for key, node in nodes.items():
        for field in ("label", "summary"):
            string(node.get(field), f"node {key}.{field}")
        require(node.get("kind") in ("entry", "module", "store", "service", "job", "object"),
                f"node {key}: invalid kind")
        conclusion(node, sources, f"node {key}")
        for field in ("details", "objects", "lifecycle"):
            strings(node.get(field, []), f"node {key}.{field}")
        if "position" in node:
            position = node["position"]
            require(isinstance(position, dict), f"node {key}: invalid position")
            for axis in ("x", "y"):
                v = position.get(axis)
                require(type(v) in (int, float) and math.isfinite(v) and abs(v) < 1e7,
                        f"node {key}: invalid position.{axis}")
        if node.get("parentId"):
            refs([node["parentId"]], nodes, f"node {key}.parentId")
            require((node["kind"] == "object") == (nodes[node["parentId"]]["kind"] == "object"),
                    f"node {key}: parent belongs to other view")
    for key in nodes:
        seen, current = set(), key
        while current:
            require(current not in seen, f"node {key}: parent cycle")
            seen.add(current)
            current = nodes[current].get("parentId")
    edges = index(data.get("edges"), "edges")
    for key, edge in edges.items():
        refs([edge.get("from"), edge.get("to")], nodes, f"edge {key}")
        string(edge.get("label"), f"edge {key}.label")
        require(edge.get("type") in ("sync", "async", "data"), f"edge {key}: invalid type")
        require((nodes[edge["from"]]["kind"] == "object") == (nodes[edge["to"]]["kind"] == "object"),
                f"edge {key}: endpoints belong to different views")
        conclusion(edge, sources, f"edge {key}")
    scenarios = index(data.get("scenarios"), "scenarios")
    for key, scenario in scenarios.items():
        for field in ("label", "trigger", "outcome"):
            string(scenario.get(field), f"scenario {key}.{field}")
        steps = index(scenario.get("steps"), f"scenario {key}.steps")
        require(steps, f"scenario {key}: at least one step required")
        for sid, step in steps.items():
            for field in ("title", "description"):
                string(step.get(field), f"step {sid}.{field}")
            conclusion(step, sources, f"step {sid}")
            refs(step.get("nodeIds"), nodes, f"step {sid}.nodeIds")
            require(step["nodeIds"], f"step {sid}: at least one node required")
            require(len({nodes[n]["kind"] == "object" for n in step["nodeIds"]}) == 1,
                    f"step {sid}: mixed views")
            refs(step.get("edgeIds"), edges, f"step {sid}.edgeIds")
            for eid in step["edgeIds"]:
                require({edges[eid]["from"], edges[eid]["to"]}.issubset(step["nodeIds"]),
                        f"step {sid}: edge endpoints absent from nodeIds")
            if step.get("nextStepId") is not None:
                refs([step["nextStepId"]], steps, f"step {sid}.nextStepId")
            branches = step.get("branches", [])
            require(isinstance(branches, list), f"step {sid}.branches: expected array")
            for branch in branches:
                require(isinstance(branch, dict), f"step {sid}: invalid branch")
                string(branch.get("label"), f"step {sid}.branch.label")
                refs([branch.get("targetStepId")], steps, f"step {sid}.branch")
    questions = index(data.get("questions"), "questions")
    for key, question in questions.items():
        for field in ("title", "detail", "neededEvidence"):
            string(question.get(field), f"question {key}.{field}")
        refs(question.get("nodeIds"), nodes, f"question {key}.nodeIds")
    return data


def build(data):
    template = (ASSETS / "template.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, allow_nan=False)
    # Escape HTML delimiters before embedding untrusted repository descriptions.
    for char, escaped in (("&", "\\u0026"), ("<", "\\u003c"), (">", "\\u003e"),
                          ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        payload = payload.replace(char, escaped)
    values = {
        "TITLE": html.escape(data["meta"]["title"]),
        "STYLE": (ASSETS / "map.css").read_text(encoding="utf-8"),
        "SCRIPT": (ASSETS / "map.js").read_text(encoding="utf-8"),
        "DATA": payload,
    }
    # One pass: user strings containing template tokens remain literal data.
    import re
    return re.sub(r"@@(TITLE|STYLE|SCRIPT|DATA)@@", lambda m: values[m[1]], template)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path, help="architecture-data.json")
    parser.add_argument("--output", type=Path, help="standalone .html destination")
    parser.add_argument("--check", action="store_true", help="validate without writing")
    parser.add_argument("--source-root", type=Path, help="also check static source paths")
    args = parser.parse_args()
    if not args.check and args.output is None:
        parser.error("--output required unless --check is used")
    try:
        source_root = args.source_root.resolve() if args.source_root else None
        data = validate(json.loads(args.data.read_text(encoding="utf-8")), source_root)
        if not args.check:
            require(args.output.suffix.lower() == ".html", "output must end in .html")
            require(args.output.resolve() != args.data.resolve(), "output cannot overwrite source data")
            result = build(data)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(result, encoding="utf-8")
        print(f"OK: {len(data['nodes'])} nodes, {len(data['edges'])} edges, "
              f"{len(data['scenarios'])} scenarios" + (f" → {args.output}" if not args.check else ""))
    except (ValueError, OSError, TypeError, KeyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
