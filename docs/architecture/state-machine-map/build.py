#!/usr/bin/env python3
"""Build the state-machine map with the repository's existing offline viewer."""
import json
from pathlib import Path
import runpy

folder = Path(__file__).resolve().parent
repository = folder.parents[2]
viewer = runpy.run_path(str(repository / 'docs/architecture-map/build.py'))
data = json.loads((folder / 'architecture-data.json').read_text())
viewer['validate'](data, repository)
html = viewer['build'](data)
# Dense inventories keep a global layout. Each scenario uses a compact, stable grid.
original = '''  function position(node) {
    const list = data.nodes.filter(n => (n.kind === 'object') === (node.kind === 'object'));'''
replacement = '''  function position(node) {
    const scenario = currentScenario();
    if (scenario) {
      const scope = new Set(scenario.steps.flatMap(step => step.nodeIds));
      for (const id of [...scope]) {
        let parent = nodes.get(id)?.parentId;
        while (parent) { scope.add(parent); parent = nodes.get(parent)?.parentId; }
      }
      const list = data.nodes.filter(n => matchesView(n));
      const ordered = [...list.filter(n => scope.has(n.id)), ...list.filter(n => !scope.has(n.id))];
      const index = ordered.indexOf(node);
      return {x: (index % 3) * 290, y: Math.floor(index / 3) * 190};
    }
    const list = data.nodes.filter(n => (n.kind === 'object') === (node.kind === 'object'));'''
assert html.count(original) == 1, 'Viewer positioning changed; review the scenario layout adapter.'
(folder / 'index.html').write_text(html.replace(original, replacement))
print(f'OK: {len(data["nodes"])} nodes, {len(data["scenarios"])} scenarios')
