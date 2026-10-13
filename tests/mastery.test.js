import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TROPHIES,
  buildMasteryView,
  initialMasteryState,
  leafKey,
  loadMastery,
  recordAdvancementToMastery,
  recordLoopToMastery,
  registerStyleCatalog,
  saveMastery,
} from '../src/mastery.js';

const catalog = {
  styleName: 'Test Style',
  category: 'Test',
  leaves: [
    { sectionIndex: 0, sectionName: 'Main A', trackId: '0:9', trackName: 'Drums', family: 'drums', maxLevel: 4 },
    { sectionIndex: 0, sectionName: 'Main A', trackId: '0:10', trackName: 'Bass', family: 'bass', maxLevel: 4 },
    { sectionIndex: 1, sectionName: 'Main B', trackId: '0:10', trackName: 'Bass', family: 'bass', maxLevel: 4 },
  ],
};

const contextFor = leaf => ({
  styleName: catalog.styleName,
  category: catalog.category,
  ...leaf,
  maxLevel: 4,
  score: 95,
  bpm: 110,
});

test('v1 mastery migrates as legacy history without inventing detailed completion', () => {
  const legacy = {
    styles: {
      'Old Style': {
        name: 'Old Style', highestLevel: 4, maxLevel: 4, mastered: true,
        bestScore: 100, bestBpm: 120, has100OnHighest: true, hasEver100: true, levels: {},
      },
    },
    trophies: { 'first-style-mastered': { unlockedAt: 1 } },
    stats: { total100Loops: 3 },
  };
  const storage = {
    getItem: key => key === 'style-trainer-mastery-v1' ? JSON.stringify(legacy) : null,
  };

  const state = loadMastery(storage);
  const view = buildMasteryView(state);

  assert.equal(state.version, 2);
  assert.equal(state.styles['Old Style'].mastered, true);
  assert.equal(state.legacyStyles['Old Style'], true);
  assert.deepEqual(state.detailedStyles, {});
  assert.equal(view.styles[0].legacy, true);
  assert.equal(view.styles[0].totalTracks, 0);
  assert.equal(view.styles[0].hero, false);
  assert.ok(state.trophies['first-style-mastered']);
});

test('v2 save leaves the v1 key intact and reloads without double-counting', () => {
  const writes = new Map();
  const storage = {
    getItem: key => writes.get(key) ?? null,
    setItem: (key, value) => writes.set(key, value),
  };
  const state = initialMasteryState();
  state.stats.total100Loops = 2;
  saveMastery(state, storage);
  const reloaded = loadMastery(storage);
  saveMastery(reloaded, storage);

  assert.equal(reloaded.stats.total100Loops, 2);
  assert.ok(writes.has('style-trainer-mastery-v2'));
  assert.equal(writes.has('style-trainer-mastery-v1'), false);
});

test('catalog rollups require non-empty playable sets and keep same-family tracks independent', () => {
  const state = initialMasteryState();
  registerStyleCatalog(state, catalog);

  let view = buildMasteryView(state);
  assert.equal(view.styles[0].hero, false);
  assert.deepEqual(view.styles[0].families.drums, { applicable: true, mastered: false, completed: 0, total: 1 });
  assert.deepEqual(view.styles[0].families.bass, { applicable: true, mastered: false, completed: 0, total: 2 });

  const [drums, bassA, bassB] = catalog.leaves;
  recordAdvancementToMastery(state, { ...contextFor(drums), completedLevel: 4, newLevel: 4, isMastered: true });
  recordAdvancementToMastery(state, { ...contextFor(bassA), completedLevel: 4, newLevel: 4, isMastered: true });
  view = buildMasteryView(state);
  assert.equal(view.styles[0].sections[0].mastered, true);
  assert.equal(view.styles[0].families.drums.mastered, true);
  assert.equal(view.styles[0].families.bass.mastered, false);
  assert.equal(view.styles[0].hero, false);

  const result = recordAdvancementToMastery(state, { ...contextFor(bassB), completedLevel: 4, newLevel: 4, isMastered: true });
  view = buildMasteryView(state);
  assert.equal(view.styles[0].families.bass.mastered, true);
  assert.equal(view.styles[0].hero, true);
  assert.ok(result.unlocked.some(trophy => trophy.id === 'style-hero'));
  assert.ok(TROPHIES.some(trophy => trophy.id === 'style-hero'));
});

test('absent families and empty catalogs never complete by vacuous truth', () => {
  const state = initialMasteryState();
  registerStyleCatalog(state, { styleName: 'Empty', category: 'Test', leaves: [] });
  registerStyleCatalog(state, {
    styleName: 'Bass Only',
    category: 'Test',
    leaves: [{ sectionIndex: 0, sectionName: 'Main A', trackId: '1:1', trackName: 'Bass', family: 'bass', maxLevel: 4 }],
  });

  const view = buildMasteryView(state);
  const empty = view.styles.find(style => style.name === 'Empty');
  const bassOnly = view.styles.find(style => style.name === 'Bass Only');
  assert.equal(empty.hero, false);
  assert.equal(empty.families.bass.mastered, false);
  assert.equal(bassOnly.families.drums.applicable, false);
  assert.equal(bassOnly.families.drums.mastered, false);
});

test('only genuine mastered advancement marks a detailed leaf complete', () => {
  const state = initialMasteryState();
  const leaf = catalog.leaves[0];
  registerStyleCatalog(state, catalog);

  recordLoopToMastery(state, { ...contextFor(leaf), level: 4, score: 100, isPracticeOnly: true });
  recordAdvancementToMastery(state, {
    ...contextFor(leaf), completedLevel: 4, newLevel: 4, isMastered: false, score: 100,
  });
  let track = buildMasteryView(state).styles[0].sections[0].tracks[0];
  assert.equal(track.mastered, false);
  assert.equal(track.highestLevel, 4);
  assert.equal(track.bestScore, 100);

  recordAdvancementToMastery(state, {
    ...contextFor(leaf), completedLevel: 4, newLevel: 4, isMastered: true, score: 95,
  });
  track = buildMasteryView(state).styles[0].sections[0].tracks[0];
  assert.equal(track.mastered, true);
});

test('practice-only loop scores do not unlock or replace the saved density level', () => {
  const state = initialMasteryState();
  const leaf = catalog.leaves[0];
  registerStyleCatalog(state, catalog);

  recordLoopToMastery(state, { ...contextFor(leaf), level: 4, score: 99, isPracticeOnly: true });
  let track = buildMasteryView(state).styles[0].sections[0].tracks[0];
  assert.equal(track.highestLevel, 0);
  assert.equal(track.bestScore, 99);

  recordAdvancementToMastery(state, {
    ...contextFor(leaf), completedLevel: 1, newLevel: 2, isMastered: false,
  });
  recordLoopToMastery(state, { ...contextFor(leaf), level: 4, score: 100, isPracticeOnly: true });
  track = buildMasteryView(state).styles[0].sections[0].tracks[0];
  assert.equal(track.highestLevel, 2);
  assert.equal(track.mastered, false);
});

test('unknown detailed context does not create malformed progress', () => {
  const state = initialMasteryState();
  registerStyleCatalog(state, catalog);
  recordLoopToMastery(state, {
    styleName: catalog.styleName,
    sectionIndex: 99,
    sectionName: 'Missing',
    trackId: 'none',
    level: 2,
    score: 90,
  });

  assert.deepEqual(state.detailedStyles[catalog.styleName].progress, {});
});

test('catalog reconciliation retains exact leaf progress and rejects renamed sections', () => {
  const state = initialMasteryState();
  const leaf = catalog.leaves[0];
  registerStyleCatalog(state, catalog);
  recordAdvancementToMastery(state, { ...contextFor(leaf), completedLevel: 2, newLevel: 3, isMastered: false });
  const key = leafKey(leaf);

  registerStyleCatalog(state, {
    ...catalog,
    leaves: [
      { ...leaf, trackName: 'Updated Drum Name' },
      { ...catalog.leaves[1], sectionName: 'Renamed A' },
    ],
  });

  assert.equal(state.detailedStyles[catalog.styleName].progress[key].highestLevel, 3);
  assert.equal(Object.keys(state.detailedStyles[catalog.styleName].progress).length, 1);
  assert.equal(buildMasteryView(state).styles[0].sections[0].tracks[0].name, 'Updated Drum Name');
});
