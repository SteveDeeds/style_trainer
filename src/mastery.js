const STORAGE_KEY = 'style-trainer-mastery-v1';

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
    description: 'Master your first style at full density (Level 4 completed).',
    isUnlocked: state => Object.values(state.styles || {}).some(s => s.mastered),
  },
  {
    id: 'three-styles-mastered',
    title: 'Stylist',
    icon: '🥉',
    category: 'Milestone',
    description: 'Master 3 different musical styles.',
    isUnlocked: state => Object.values(state.styles || {}).filter(s => s.mastered).length >= 3,
  },
  {
    id: 'five-styles-mastered',
    title: 'Groove Master',
    icon: '🥈',
    category: 'Milestone',
    description: 'Master 5 different musical styles.',
    isUnlocked: state => Object.values(state.styles || {}).filter(s => s.mastered).length >= 5,
  },
  {
    id: 'virtuoso-10',
    title: 'Virtuoso',
    icon: '👑',
    category: 'Milestone',
    description: 'Master 10 different musical styles.',
    isUnlocked: state => Object.values(state.styles || {}).filter(s => s.mastered).length >= 10,
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
    description: 'Score 100% on the maximum level of any style.',
    isUnlocked: state => Object.values(state.styles || {}).some(s => s.mastered && s.has100OnHighest),
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
    styles: {},
    trophies: {},
    stats: {
      total100Loops: 0,
      consecutiveOver80: 0,
      speedLadderGraduated: false,
      randomHarmonyQualified: false,
      highVelocity: false,
    },
  };
}

export function loadMastery(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem ? storage.getItem(STORAGE_KEY) : null;
    if (!raw) return initialMasteryState();
    const parsed = JSON.parse(raw);
    return {
      styles: parsed.styles || {},
      trophies: parsed.trophies || {},
      stats: { ...initialMasteryState().stats, ...(parsed.stats || {}) },
    };
  } catch {
    return initialMasteryState();
  }
}

export function saveMastery(state, storage = globalThis.localStorage) {
  try {
    if (storage?.setItem) storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage may be blocked or unavailable; state remains in memory */
  }
}

export function recordLoopToMastery(state, {
  styleName,
  category = 'Local Style',
  level = 1,
  maxLevel = 4,
  score = 0,
  bpm = 96,
  isPracticeOnly = false,
}) {
  if (!styleName || !state) return { mastery: state, unlocked: [] };
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

  const style = state.styles[styleName];
  if (maxLevel > style.maxLevel) style.maxLevel = maxLevel;
  if (level > style.highestLevel) style.highestLevel = level;
  if (score > style.bestScore) {
    style.bestScore = Math.round(score);
    style.bestBpm = Math.round(bpm);
  }

  if (!style.levels[level]) {
    style.levels[level] = { bestScore: 0, has100: false };
  }
  const levelRecord = style.levels[level];
  if (score > levelRecord.bestScore) levelRecord.bestScore = Math.round(score);
  if (score >= 100) {
    levelRecord.has100 = true;
    style.hasEver100 = true;
    state.stats.total100Loops = (state.stats.total100Loops || 0) + 1;
  }

  if (score >= 80) {
    state.stats.consecutiveOver80 = (state.stats.consecutiveOver80 || 0) + 1;
  } else {
    state.stats.consecutiveOver80 = 0;
  }

  if (bpm >= 140 && score >= 90) {
    state.stats.highVelocity = true;
  }

  // Update has100OnHighest flag
  style.has100OnHighest = Boolean(style.highestLevel && style.levels[style.highestLevel]?.has100);

  const unlocked = evaluateTrophies(state, { score, bpm, styleName, level });
  return { mastery: state, unlocked };
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
}) {
  if (!styleName || !state) return { mastery: state, unlocked: [] };
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

  const style = state.styles[styleName];
  if (score > style.bestScore) {
    style.bestScore = Math.round(score);
    style.bestBpm = Math.round(bpm);
  }
  const targetLevel = newLevel ?? (completedLevel != null ? (completedLevel >= maxLevel ? maxLevel : completedLevel + 1) : 1);
  if (targetLevel > style.highestLevel) {
    style.highestLevel = targetLevel;
  }
  if (!style.levels[targetLevel]) {
    style.levels[targetLevel] = { bestScore: 0, has100: false };
  }
  if (score > style.levels[targetLevel].bestScore) {
    style.levels[targetLevel].bestScore = Math.round(score);
  }
  if (score >= 100) {
    style.levels[targetLevel].has100 = true;
    style.hasEver100 = true;
  }
  if (isMastered || style.highestLevel >= maxLevel || (completedLevel != null && completedLevel >= maxLevel)) {
    style.mastered = true;
    style.highestLevel = maxLevel;
  }
  if (speedLadderGraduated) state.stats.speedLadderGraduated = true;
  if (randomHarmonyQualified) state.stats.randomHarmonyQualified = true;

  style.has100OnHighest = Boolean(style.highestLevel && style.levels[style.highestLevel]?.has100);

  const unlocked = evaluateTrophies(state, {
    score,
    bpm,
    styleName,
    speedLadderGraduated,
    randomHarmonyQualified,
  });
  return { mastery: state, unlocked };
}

export function evaluateTrophies(state, context = {}) {
  const newlyUnlocked = [];
  for (const trophy of TROPHIES) {
    if (state.trophies[trophy.id]) continue;
    try {
      if (trophy.isUnlocked(state, context)) {
        state.trophies[trophy.id] = { unlockedAt: Date.now() };
        newlyUnlocked.push(trophy);
      }
    } catch {
      /* ignore evaluator errors */
    }
  }
  return newlyUnlocked;
}
