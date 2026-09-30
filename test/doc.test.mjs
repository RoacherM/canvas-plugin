import assert from 'node:assert/strict';
import test from 'node:test';
import * as D from '../src/shared/doc.js';

const img = (id, x = 0, y = 0, extra = {}) => ({ id, type: 'image', x, y, w: 100, h: 100, data: { path: `assets/${id}.png` }, ...extra });

test('normalize repairs broken input and orders parents first', () => {
  const doc = D.normalizeDoc({
    nodes: [img('a', 1, 2, { parentId: 'f' }), { id: 'f', type: 'frame', x: 0, y: 0 }, { id: 'bad', type: 'nope' }, img('a'), null, img('orphan', 0, 0, { parentId: 'missing' })],
    edges: [{ id: 'e1', source: 'a', target: 'f' }, { id: 'e2', source: 'a', target: 'ghost' }],
    removed: { old: 1, fresh: Date.now() },
  });
  assert.deepEqual(doc.nodes.map((n) => n.id), ['f', 'orphan', 'a']);
  assert.equal(doc.nodes.find((n) => n.id === 'orphan').parentId, undefined);
  assert.deepEqual(doc.edges.map((e) => [e.id, e.role]), [['e1', 'reference']]);
  assert.deepEqual(Object.keys(doc.removed), ['fresh']);
  assert.equal(D.normalizeDoc('garbage').nodes.length, 0);
});

test('merge keeps both sides\' newer work and honours deletions', () => {
  let base = D.addNodes(D.emptyDoc(0), [img('a'), img('b')], 100);
  const user = D.updateNode(base, 'a', { x: 500 }, 200);              // user moves a
  let agent = D.addNodes(base, [img('c')], 150);                        // agent adds c
  agent = D.removeNodes(agent, ['b'], 160);                             // and deletes b
  const merged = D.mergeDocs(agent, user, 300);
  assert.deepEqual(merged.nodes.map((n) => n.id).sort(), ['a', 'c']);
  assert.equal(merged.nodes.find((n) => n.id === 'a').x, 500);
  // An edit made after the deletion keeps the node.
  const lateEdit = D.updateNode(base, 'b', { x: 9 }, 170);
  assert.ok(D.mergeDocs(agent, lateEdit, 400).nodes.some((n) => n.id === 'b'));
});

test('removing a frame removes its children and edges', () => {
  let doc = D.addNodes(D.emptyDoc(0), [{ id: 'f', type: 'frame', x: 0, y: 0 }, img('a', 10, 10, { parentId: 'f' }), img('b', 400, 0)], 1);
  doc = D.addEdge(doc, 'a', 'b', 'reference', 2);
  doc = D.removeNodes(doc, ['f'], 3);
  assert.deepEqual(doc.nodes.map((n) => n.id), ['b']);
  assert.equal(doc.edges.length, 0);
  assert.equal(Object.keys(doc.removed).length, 3);
});

test('layout helpers', () => {
  assert.deepEqual(D.fitSize(2048, 1024, 320), { w: 320, h: 160 });
  assert.deepEqual(D.gridLayout([{ w: 10, h: 10 }, { w: 10, h: 20 }, { w: 10, h: 10 }], { columns: 2, gap: 5 }), [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 0, y: 25 }]);
  const doc = D.addNodes(D.emptyDoc(0), [img('a', 0, 50), img('b', 200, 10)], 1);
  assert.deepEqual(D.freeSpot(doc, 80), { x: 380, y: 10 });
  const framed = D.addNodes(D.emptyDoc(0), [{ id: 'f', type: 'frame', x: 100, y: 100 }, img('a', 10, 20, { parentId: 'f' })], 1);
  assert.deepEqual(D.absolutePosition(framed, framed.nodes[1]), { x: 110, y: 120 });
});

test('generator inputs by role and a compact summary', () => {
  let doc = D.addNodes(D.emptyDoc(0), [img('r2', 0, 200), img('r1', 0, 0), img('ff', 0, 400), { id: 'g', type: 'generator', x: 300, y: 0, data: { mode: 'video', prompt: 'a cat' } }], 1);
  doc = D.addEdge(doc, 'r2', 'g', 'reference', 2);
  doc = D.addEdge(doc, 'r1', 'g', 'reference', 3);
  doc = D.addEdge(doc, 'ff', 'g', 'first_frame', 4);
  const inputs = D.generatorInputs(doc, 'g');
  assert.deepEqual(inputs.reference.map((n) => n.id), ['r1', 'r2']);
  assert.equal(inputs.first_frame.id, 'ff');
  const summary = D.summarize(doc, ['g']);
  assert.deepEqual(summary.nodes.find((n) => n.id === 'g'), { id: 'g', type: 'generator', x: 300, y: 0, w: 340, h: 300, selected: true, mode: 'video', prompt: 'a cat', status: 'idle' });
  assert.equal(summary.edges.length, 3);
});

test('run state merges apart from node content: a stale prompt edit cannot undo a finished run', () => {
  let doc = D.addNodes(D.emptyDoc(0), [{ id: 'g', type: 'generator', x: 0, y: 0, data: { prompt: 'a' } }], 1);
  const browser = D.updateNode(doc, 'g', { data: { prompt: 'b' } }, 50);        // user edits, knows nothing of the run
  const host = D.setRun(D.setRun(doc, 'g', { status: 'running' }, 10), 'g', { status: 'done' }, 40);
  const merged = D.mergeDocs(host, browser, 60);
  assert.equal(merged.nodes[0].data.prompt, 'b');
  assert.equal(D.runOf(merged, 'g').status, 'done');
  assert.equal(D.summarize(merged).nodes[0].status, 'done');
  assert.deepEqual(D.removeNodes(merged, ['g'], 70).runs, {});
  assert.equal(D.runOf(D.emptyDoc(), 'x').status, 'idle');
});

test('media versions: append shows the new one, select switches, a stale copy cannot drop a result', () => {
  let doc = D.addNodes(D.emptyDoc(), [{ id: 'm', type: 'image', x: 0, y: 0, w: 200, h: 200, data: { gen: { prompt: 'cat' } } }], 1);
  const stale = doc;
  doc = D.appendVersions(doc, 'm', [{ path: 'assets/a.png', naturalWidth: 400, naturalHeight: 200 }], 10);
  let node = doc.nodes[0];
  assert.equal(node.data.path, 'assets/a.png');
  assert.equal(node.h, 100, 'box follows the aspect ratio, keeping the width');
  doc = D.appendVersions(doc, 'm', [{ path: 'assets/b.png', naturalWidth: 200, naturalHeight: 200 }], 20);
  assert.equal(D.versionsOf(doc.nodes[0]).length, 2);
  assert.equal(D.shownIndex(doc.nodes[0]), 1);
  doc = D.selectVersion(doc, 'm', 0, 30);
  assert.equal(doc.nodes[0].data.path, 'assets/a.png');

  // The browser commits a prompt edit on its old copy, later than the Host's writes.
  const late = D.updateNode(stale, 'm', { data: { gen: { prompt: 'cat on a sill' } } }, 40);
  const merged = D.mergeDocs(doc, late, 41);
  node = merged.nodes[0];
  assert.equal(node.data.gen.prompt, 'cat on a sill');
  assert.deepEqual(D.versionsOf(node).map((v) => v.path), ['assets/a.png', 'assets/b.png']);
  assert.equal(node.data.path, 'assets/a.png', 'the newer `shown` wins');
  assert.equal(D.mergeDocs(late, doc, 42).nodes[0].data.path, 'assets/a.png', 'either merge order');

  // A plain imported image is a single version; appending keeps it as version 1.
  let imported = D.addNodes(D.emptyDoc(), [img('p')], 1);
  imported = D.appendVersions(imported, 'p', [{ path: 'assets/edit.png' }], 2);
  assert.deepEqual(D.versionsOf(imported.nodes[0]).map((v) => v.path), ['assets/p.png', 'assets/edit.png']);
});

test('script nodes and shot edges survive normalize; summary shows rows, versions and gen prompts', () => {
  let doc = D.addNodes(D.emptyDoc(), [
    { id: 's', type: 'script', x: 0, y: 0, data: { title: '雨夜', rows: [{ id: 'r1', description: '路口', prompt: '低机位', duration: 3, imageId: 'm' }] } },
    { id: 'm', type: 'image', x: 900, y: 0, data: { gen: { prompt: '低机位' } } },
  ]);
  doc = D.addEdge(doc, 's', 'm', 'shot');
  doc = D.normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(doc.nodes[0].w, 760);
  assert.equal(doc.edges[0].role, 'shot');
  assert.deepEqual(D.generatorInputs(doc, 'm').reference, [], 'a shot edge is not a reference');
  const summary = D.summarize(doc);
  assert.equal(summary.nodes[0].rows[0].image, 'm');
  assert.equal(summary.nodes[1].gen_prompt, '低机位');
  assert.equal(summary.nodes[1].empty, true);
});

test('library links merge on their own clocks: a stale browser copy keeps the Host binding and asset', () => {
  const base = D.addNodes(D.emptyDoc(), [{ id: 'm', type: 'image', x: 0, y: 0, data: { gen: { prompt: 'cat' } } }], 1);
  const host = D.updateNode(base, 'm', { data: { asset: 'i_abc123', gen: { prompt: 'cat', bind: { id: 'p_abc123', v: 2, text: 'cat', at: 10 } } } }, 1);
  const browser = D.updateNode(base, 'm', { data: { gen: { prompt: 'cat on a sill' } } }, 20);
  const merged = D.mergeDocs(host, browser, 30).nodes[0];
  assert.equal(merged.data.gen.prompt, 'cat on a sill');
  assert.deepEqual(merged.data.gen.bind, { id: 'p_abc123', v: 2, text: 'cat', at: 10 });
  assert.equal(merged.data.asset, 'i_abc123');
  assert.equal(D.promptRefOf(merged), 'p_abc123@2');
  // An unbind (a newer entry without id) wins over the older binding.
  const unbound = D.updateNode(host, 'm', { data: { gen: { prompt: 'x', bind: { at: 40 } } } }, 40);
  assert.equal(D.promptRefOf(D.mergeDocs(host, unbound, 50).nodes[0]), undefined);
});

test('asset categories: known ones survive normalize and summary; unknown ones drop; old docs stay valid', () => {
  assert.deepEqual(D.ASSET_CATEGORIES, ['character', 'scene', 'prop', 'style', 'audio']);
  assert.equal(D.categoryOf('scene'), 'scene');
  assert.equal(D.categoryOf('Scene'), undefined);
  assert.equal(D.categoryOf(3), undefined);
  const doc = D.normalizeDoc({ nodes: [
    img('c', 0, 0, { data: { path: 'assets/c.png', category: 'character' } }),
    img('x', 0, 0, { data: { path: 'assets/x.png', category: 'monster' } }),
    img('old'),
  ] });
  assert.equal(doc.nodes[0].data.category, 'character');
  assert.equal('category' in doc.nodes[1].data, false, 'an unknown category is dropped, the node is kept');
  assert.equal('category' in doc.nodes[2].data, false, 'documents from before categories load unchanged');
  const summary = D.summarize(doc);
  assert.equal(summary.nodes[0].category, 'character');
  assert.equal(summary.nodes[2].category, undefined);
  // A newer category edit wins a merge like any other node edit.
  const retagged = D.updateNode(doc, 'c', { data: { category: 'style' } }, Date.now() + 10);
  assert.equal(D.mergeDocs(doc, retagged).nodes[0].data.category, 'style');
  // Filtering.
  const items = [{ category: 'prop' }, { category: 'audio' }, {}, { category: 'bogus' }];
  assert.equal(items.filter((i) => D.matchesCategory(i, 'all')).length, 4);
  assert.deepEqual(items.filter((i) => D.matchesCategory(i, 'prop')), [{ category: 'prop' }]);
  assert.deepEqual(items.filter((i) => D.matchesCategory(i, 'none')), [{}, { category: 'bogus' }]);
  // Counts per filter chip agree with the filter itself.
  const counts = D.categoryCounts(items);
  assert.deepEqual(counts, { all: 4, character: 0, scene: 0, prop: 1, style: 0, audio: 1, none: 2 });
  for (const key of Object.keys(counts)) assert.equal(counts[key], items.filter((i) => D.matchesCategory(i, key)).length, key);
  assert.deepEqual(D.categoryCounts(), { all: 0, character: 0, scene: 0, prop: 0, style: 0, audio: 0, none: 0 });
  assert.equal(D.categoryCounts([null, 'x']).none, 2, 'junk entries count as uncategorised');
});

test('re-filing an asset moves every node bound to it into the new category, and only those', () => {
  const t0 = Date.now();
  const doc = D.normalizeDoc({ nodes: [
    img('a', 0, 0, { data: { path: 'assets/a.png', asset: 'i_one', category: 'character' } }),
    img('b', 0, 0, { data: { path: 'assets/b.png', asset: 'i_one' } }),
    { id: 'v', type: 'video', x: 0, y: 0, w: 400, h: 225, data: { path: 'assets/v.mp4', asset: 'i_one', category: 'prop' } },
    img('other', 0, 0, { data: { path: 'assets/o.png', asset: 'i_two', category: 'prop' } }),
    { id: 't', type: 'text', x: 0, y: 0, w: 100, h: 50, data: { text: 'x', asset: 'i_one' } },
  ] }, t0);
  const next = D.setAssetCategory(doc, 'i_one', 'scene', t0 + 10);
  const cat = (d, id) => d.nodes.find((n) => n.id === id).data.category;
  assert.deepEqual(['a', 'b', 'v', 'other', 't'].map((id) => cat(next, id)), ['scene', 'scene', 'scene', 'prop', undefined]);
  assert.equal(next.nodes.find((n) => n.id === 'other').updatedAt, doc.nodes.find((n) => n.id === 'other').updatedAt, 'unrelated nodes are untouched');
  // Nothing to change: the very same document comes back (no save is scheduled).
  assert.equal(D.setAssetCategory(next, 'i_one', 'scene'), next);
  assert.equal(D.setAssetCategory(next, 'i_missing', 'scene'), next);
  // Clearing (null or an unknown value) removes the key; the edit wins a merge against the older copy.
  const cleared = D.setAssetCategory(next, 'i_one', null, t0 + 20);
  assert.equal('category' in cleared.nodes.find((n) => n.id === 'a').data, false);
  assert.equal(cat(D.setAssetCategory(next, 'i_one', 'monster', t0 + 20), 'a'), undefined);
  assert.equal(cat(D.mergeDocs(next, cleared), 'b'), undefined);
});
