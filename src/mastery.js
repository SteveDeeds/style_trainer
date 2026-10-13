const STORAGE_KEY = 'style-trainer-mastery-v2';
const LEGACY_STORAGE_KEY = 'style-trainer-mastery-v1';

const emptyStats = () => ({
  total100Loops: 0,
  consecutiveOver80: 0,
  speedLadderGraduated: false,
  randomHarmonyQualified: false,
  highVelocity: false,
});

const detailedHero = detailed => {
  const keys = Object.keys(detailed?.catalog || {});
  return keys.length > 0 && keys.every(key => detailed.progress?.[key]?.mastered);
};

const styleIsMastered = (state, name, style) => {
  const detailed = state.detailedStyles?.[name];
  return detailed && Object.keys(detailed.catalog || {}).length
    ? detailedHero(detailed)
    : Boolean(style?.mastered);
};

const masteredStyleCount = state => Object.entries(state.styles || {})
  .filter(([name, style]) => styleIsMastered(state, name, style)).length;

export const TROPHIES = [
  {
    id: 'first-loop',
    title: 'First Step',
    icon: '🎵',
    category: 'Milestone',
    description: 'Complete your first recorded loop.',
    isUnlocked: state => Object.values(state.styles || {}).some(s => s.bestScore > 0),
  },
  {
    id: 'first-style-mastered',
    title: 'First Groove',
    icon: '🥇',
    category: 'Milestone',
    description: 'Master every playable part in your first style.',
    isUnlocked: state => masteredStyleCount(state) >= 1,
  },
  {
    id: 'style-hero',
    title: 'Style Hero',
    icon: '🏆',
    category: 'Milestone',
    description: 'Master every playable section and instrument in a style.',
    isUnlocked: state => Object.values(state.detailedStyles || {}).some(detailedHero),
  },
  {
    id: 'three-styles-mastered',
    title: 'Stylist',
    icon: '🥉',
    category: 'Milestone',
    description: 'Master 3 different musical styles.',
    isUnlocked: state => masteredStyleCount(state) >= 3,
  },
  {
    id: 'five-styles-mastered',
    title: 'Groove Master',
    icon: '🥈',
    category: 'Milestone',
    description: 'Master 5 different musical styles.',
    isUnlocked: state => masteredStyleCount(state) >= 5,
  },
  {
    id: 'virtuoso-10',
    title: 'Virtuoso',
    icon: '👑',
    category: 'Milestone',
    description: 'Master 10 different musical styles.',
    isUnlocked: state => masteredStyleCount(state) >= 10,
  },
  {
    id: 'century-club',
    title: 'Century Club',
    icon: '⭐',
    category: 'Skill',
    description: 'Achieve a perfect 100% accuracy score on any recorded loop.',
    isUnlocked: state => (state.stats?.total100Loops || 0) >= 1,
  },
  {
    id: 'flawless-master',
    title: 'Flawless Master',
    icon: '👑',
    category: 'Skill',
    description: 'Score 100% on the maximum level of a mastered style.',
    isUnlocked: state => Object.entries(state.styles || {})
      .some(([name, style]) => styleIsMastered(state, name, style) && style.has100OnHighest),
  },
  {
    id: 'speed-demon',
    title: 'Speed Demon',
    icon: '⚡',
    category: 'Skill',
    description: 'Conquer the tempo ladder or score 90%+ at 140+ BPM.',
    isUnlocked: (state, ctx) => Boolean(ctx?.speedLadderGraduated || state.stats?.speedLadderGraduated || (ctx?.bpm >= 140 && ctx?.score >= 90) || state.stats?.highVelocity),
  },
  {
    id: 'harmonic-adventurer',
    title: 'Harmonic Adventurer',
    icon: '🎼',
    category: 'Skill',
    description: 'Level up while practicing a randomized chord progression.',
    isUnlocked: (state, ctx) => Boolean(ctx?.randomHarmonyQualified || state.stats?.randomHarmonyQualified),
  },
  {
    id: 'secret-midnight-pocket',
    title: 'Midnight Master',
    icon: '🌙',
    category: 'Secret',
    description: 'Score 95%+ on the Midnight Pocket demo style.',
    secretHint: 'Find the groove on the Midnight Pocket demo...',
    isUnlocked: state => (state.styles?.['Midnight Pocket']?.bestScore ?? 0) >= 95,
  },
  {
    id: 'iron-focus',
    title: 'Iron Focus',
    icon: '🛡️',
    category: 'Secret',
    description: 'Complete 5 consecutive loops with 80%+ accuracy without stopping.',
    secretHint: 'Maintain steady focus across consecutive loops...',
    isUnlocked: state => (state.stats?.consecutiveOver80 || 0) >= 5,
  },
];

export function initialMasteryState() {
  return {
    version: 2,
    styles: {},
    detailedStyles: {},
    legacyStyles: {},
    trophies: {},
    stats: emptyStats(),
  };
}

const normalizeState = parsed => ({
  version: 2,
  styles: parsed?.styles || {},
  detailedStyles: parsed?.detailedStyles || {},
  legacyStyles: parsed?.legacyStyles || {},
  trophies: parsed?.trophies || {},
  stats: { ...emptyStats(), ...(parsed?.stats || {}) },
});

export function loadMastery(storage = globalThis.localStorage) {
  try {
    const current = storage?.getItem ? storage.getItem(STORAGE_KEY) : null;
    if (current) return normalizeState(JSON.parse(current));
    const legacy = storage?.getItem ? storage.getItem(LEGACY_STORAGE_KEY) : null;
    if (!legacy) return initialMasteryState();
    const parsed = JSON.parse(legacy);
    return normalizeState({
      ...parsed,
      legacyStyles: Object.fromEntries(Object.keys(parsed.styles || {}).map(name => [name, true])),
    });
  } catch {
    return initialMasteryState();
  }
}

export function saveMastery(state, storage = globalThis.localStorage) {
  try {
    if (!storage?.setItem) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    return true;
  } catch {
    return false;
  }
}

export const leafKey = ({ sectionIndex, sectionName, trackId }) =>
  `${Number(sectionIndex)}:${encodeURIComponent(sectionName || '')}:${trackId || ''}`;

const normalizeLeaf = leaf => ({
  sectionIndex: Number(leaf.sectionIndex),
  sectionName: String(leaf.sectionName || `Section ${Number(leaf.sectionIndex) + 1}`),
  trackId: String(leaf.trackId || ''),
  trackName: String(leaf.trackName || leaf.trackId || 'Instrument'),
  family: ['drums', 'bass', 'chords'].includes(leaf.family) ? leaf.family : 'chords',
  maxLevel: Math.max(1, Number(leaf.maxLevel) || 4),
});

export function registerStyleCatalog(state, { styleName, category = 'Style', leaves = [] }) {
  if (!state || !styleName) return null;
  state.detailedStyles ||= {};
  const previous = state.detailedStyles[styleName] || { progress: {} };
  const catalog = {};
  for (const candidate of leaves) {
    const leaf = normalizeLeaf(candidate);
    if (!Number.isInteger(leaf.sectionIndex) || !leaf.trackId) continue;
    catalog[leafKey(leaf)] = leaf;
  }
  const progress = Object.fromEntries(Object.entries(previous.progress || {}).filter(([key]) => catalog[key]));
  state.detailedStyles[styleName] = { name: styleName, category, catalog, progress };
  return state.detailedStyles[styleName];
}

const aggregateStyle = (state, styleName, category, maxLevel) => {
  state.styles ||= {};
  if (!state.styles[styleName]) {
    state.styles[styleName] = {
      name: styleName,
      category,
      highestLevel: 0,
      maxLevel,
      mastered: false,
      has100OnHighest: false,
      hasEver100: false,
      bestScore: 0,
      bestBpm: 0,
      levels: {},
    };
  }
  return state.styles[styleName];
};

const detailedLeaf = (state, context) => {
  const detailed = state.detailedStyles?.[context.styleName];
  if (!detailed) return null;
  const key = leafKey(context);
  if (!detailed.catalog?.[key]) return null;
  detailed.progress ||= {};
  detailed.progress[key] ||= {
    highestLevel: 0,
    mastered: false,
    bestScore: 0,
    bestBpm: 0,
    has100: false,
  };
  return { detailed, key, progress: detailed.progress[key] };
};

export function leafProgress(state, context) {
  const detailed = state?.detailedStyles?.[context?.styleName];
  const progress = detailed?.progress?.[leafKey(context || {})];
  return progress ? { ...progress } : {
    highestLevel: 0, mastered: false, bestScore: 0, bestBpm: 0, has100: false,
  };
}

export function recordLoopToMastery(state, {
  styleName,
  category = 'Local Style',
  level = 1,
  maxLevel = 4,
  score = 0,
  bpm = 96,
  ...context
}) {
  if (!styleName || !state) return { mastery: state, unlocked: [] };
  state.stats ||= emptyStats();
  const style = aggregateStyle(state, styleName, category, maxLevel);
  style.maxLevel = Math.max(style.maxLevel || 0, maxLevel);
  style.highestLevel = Math.max(style.highestLevel || 0, level);
  if (score > style.bestScore) {
    style.bestScore = Math.round(score);
    style.bestBpm = Math.round(bpm);
  }
  style.levels[level] ||= { bestScore: 0, has100: false };
  style.levels[level].bestScore = Math.max(style.levels[level].bestScore, Math.round(score));
  if (score >= 100) {
    style.levels[level].has100 = true;
    style.hasEver100 = true;
    state.stats.total100Loops = (state.stats.total100Loops || 0) + 1;
  }
  state.stats.consecutiveOver80 = score >= 80 ? (state.stats.consecutiveOver80 || 0) + 1 : 0;
  if (bpm >= 140 && score >= 90) state.stats.highVelocity = true;
  style.has100OnHighest = Boolean(style.highestLevel && style.levels[style.highestLevel]?.has100);

  const detail = detailedLeaf(state, { styleName, ...context });
  if (detail) {
    detail.progress.highestLevel = Math.max(detail.progress.highestLevel, level);
    if (score > detail.progress.bestScore) {
      detail.progress.bestScore = Math.round(score);
      detail.progress.bestBpm = Math.round(bpm);
    }
    if (score >= 100) detail.progress.has100 = true;
  }

  return { mastery: state, unlocked: evaluateTrophies(state, { score, bpm, styleName, level }) };
}

export function recordAdvancementToMastery(state, {
  styleName,
  category = 'Local Style',
  completedLevel = null,
  newLevel = null,
  maxLevel = 4,
  isMastered = false,
  speedLadderGraduated = false,
  randomHarmonyQualified = false,
  score = 0,
  bpm = 96,
  ...context
}) {
  if (!styleName || !state) return { mastery: state, unlocked: [] };
  state.stats ||= emptyStats();
  const style = aggregateStyle(state, styleName, category, maxLevel);
  if (score > style.bestScore) {
    style.bestScore = Math.round(score);
    style.bestBpm = Math.round(bpm);
  }
  const targetLevel = newLevel ?? (completedLevel != null ? Math.min(maxLevel, completedLevel + 1) : 1);
  style.highestLevel = Math.max(style.highestLevel || 0, targetLevel);
  style.levels[targetLevel] ||= { bestScore: 0, has100: false };
  style.levels[targetLevel].bestScore = Math.max(style.levels[targetLevel].bestScore, Math.round(score));
  if (score >= 100) {
    style.levels[targetLevel].has100 = true;
    style.hasEver100 = true;
  }
  if (speedLadderGraduated) state.stats.speedLadderGraduated = true;
  if (randomHarmonyQualified) state.stats.randomHarmonyQualified = true;

  const detail = detailedLeaf(state, { styleName, ...context });
  if (detail) {
    detail.progress.highestLevel = Math.max(detail.progress.highestLevel, targetLevel);
    if (score > detail.progress.bestScore) {
      detail.progress.bestScore = Math.round(score);
      detail.progress.bestBpm = Math.round(bpm);
    }
    if (score >= 100) detail.progress.has100 = true;
    if (isMastered) {
      detail.progress.mastered = true;
      detail.progress.highestLevel = maxLevel;
    }
    style.mastered = detailedHero(detail.detailed);
    if (style.mastered) style.highestLevel = maxLevel;
  } else if (isMastered || style.highestLevel >= maxLevel || (completedLevel != null && completedLevel >= maxLevel)) {
    style.mastered = true;
    style.highestLevel = maxLevel;
  }
  style.has100OnHighest = Boolean(style.highestLevel && style.levels[style.highestLevel]?.has100);

  return {
    mastery: state,
    unlocked: evaluateTrophies(state, {
      score, bpm, styleName, speedLadderGraduated, randomHarmonyQualified,
    }),
  };
}

const familySummary = (tracks, family) => {
  const matching = tracks.filter(track => track.family === family);
  const completed = matching.filter(track => track.mastered).length;
  return {
    applicable: matching.length > 0,
    mastered: matching.length > 0 && completed === matching.length,
    completed,
    total: matching.length,
  };
};

export function buildMasteryView(state, currentCatalog = null) {
  const detailedStyles = { ...(state?.detailedStyles || {}) };
  if (currentCatalog?.styleName) {
    const temporary = normalizeState(state);
    temporary.detailedStyles = structuredClone(detailedStyles);
    registerStyleCatalog(temporary, currentCatalog);
    detailedStyles[currentCatalog.styleName] = temporary.detailedStyles[currentCatalog.styleName];
  }
  const names = new Set([
    ...Object.keys(state?.styles || {}),
    ...Object.keys(detailedStyles),
  ]);
  const styles = [...names].map(name => {
    const aggregate = state?.styles?.[name] || {};
    const detailed = detailedStyles[name];
    const allTracks = Object.entries(detailed?.catalog || {}).map(([key, leaf]) => {
      const progress = detailed.progress?.[key] || {};
      return {
        key,
        id: leaf.trackId,
        name: leaf.trackName,
        family: leaf.family,
        highestLevel: progress.highestLevel || 0,
        maxLevel: leaf.maxLevel || 4,
        bestScore: progress.bestScore || 0,
        bestBpm: progress.bestBpm || 0,
        mastered: Boolean(progress.mastered),
        sectionIndex: leaf.sectionIndex,
        sectionName: leaf.sectionName,
      };
    });
    const sections = [...new Map(allTracks.map(track => [
      `${track.sectionIndex}:${track.sectionName}`,
      { index: track.sectionIndex, name: track.sectionName },
    ])).values()]
      .sort((a, b) => a.index - b.index)
      .map(section => {
        const tracks = allTracks.filter(track =>
          track.sectionIndex === section.index && track.sectionName === section.name);
        return {
          ...section,
          tracks,
          completed: tracks.filter(track => track.mastered).length,
          total: tracks.length,
          mastered: tracks.length > 0 && tracks.every(track => track.mastered),
        };
      });
    const completed = allTracks.filter(track => track.mastered).length;
    return {
      name,
      category: detailed?.category || aggregate.category || 'Style',
      bestScore: aggregate.bestScore || 0,
      bestBpm: aggregate.bestBpm || 0,
      legacy: Boolean(state?.legacyStyles?.[name]),
      sections,
      completedTracks: completed,
      totalTracks: allTracks.length,
      hero: allTracks.length > 0 && completed === allTracks.length,
      families: {
        bass: familySummary(allTracks, 'bass'),
        drums: familySummary(allTracks, 'drums'),
      },
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { styles };
}

export function evaluateTrophies(state, context = {}) {
  state.trophies ||= {};
  const newlyUnlocked = [];
  for (const trophy of TROPHIES) {
    if (state.trophies[trophy.id]) continue;
    try {
      if (trophy.isUnlocked(state, context)) {
        state.trophies[trophy.id] = { unlockedAt: Date.now() };
        newlyUnlocked.push(trophy);
      }
    } catch {
      // A malformed imported record must not block scoring or other trophy evaluators.
    }
  }
  return newlyUnlocked;
}
