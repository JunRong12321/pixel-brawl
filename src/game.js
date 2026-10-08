// Pure game logic. No DOM, no canvas: it can run (and be tested) in Node.
import { W, GY, ROUND_TIME, ROUNDS_TO_WIN, CHARS, COMBOS, THEMES, themeCardRect, PORT, selButtons, randomBoxRect, ROLL_FRAMES, SELECT_FRAMES, PAUSE_ITEMS, pauseRect, exitChoiceRect, INTRO_END_AT, DIFFICULTIES, MATCH_ITEMS, matchButtonRect, MATCH_DIFF, THEME_START, LOADING_MIN, LOADING_MAX, LOAD_TIPS, dojoChoiceRect, MODE_CARDS, EXTREME_MODS, CHAOS, RUN_FIGHTS, RUN_CONTINUES, runEndRect, defaultRecords } from './config.js';
import { createFighter, resetFighter, updateFighter } from './fighter.js';
import { hurtbox, applyHit, canHit } from './combat.js';
import { cpuInput } from './ai.js';

export function createWorld(sfx = () => {}) {
  return { mode: 'menu', fighters: [], fireballs: [], t: 0, tick: 0, time: ROUND_TIME, round: 0,
           winner: -1, shake: 0, hitstop: 0, fx: [], banner: null, twoP: false, picks: [0, 1], sel: null,
           back: 'fight', pm: 0, menuIndex: 0, difficulty: 1, tutorialPage: 0, settingsBack: 'menu', settingsIndex: 0,
           audio: { music: 100, ui: 100, effects: 100, voice: 100, muted: false }, reducedMotion: false,
           dojo: null, exitConfirm: false, exitChoice: 0, theme: 0, endIndex: 0, load: null, preload: null,
           modeIndex: 0, xi: 0, run: null, pendingRun: null, roundsToWin: ROUNDS_TO_WIN, cpuLevel: null, xbPick: null, xb: null, records: defaultRecords(), sfx };
}
// ----- character select: both players choose at the same time -----
const rnd = n => Math.random() * n | 0;
// ----- difficulty: chosen when you start a 1-player game, changeable from the pause menu and the match-over screen -----
export function openDifficulty(w) { Object.assign(w, { mode: 'difficulty', twoP: false, fighters: [], fireballs: [] }); }
export function cycleDifficulty(w, d) { w.difficulty = (w.difficulty + d + DIFFICULTIES.length) % DIFFICULTIES.length; w.sfx('select'); }
export function difficultyConfirm(w) { w.sfx('confirm'); openSelect(w, false); }
export const pauseItems = w => (w.run ? ['RESUME', 'RESTART RUN', 'EXIT RUN', 'SETTINGS'] : w.back === 'dojo' ? ['RESUME', 'EXIT', 'SETTINGS'] : w.twoP ? PAUSE_ITEMS : [...PAUSE_ITEMS, 'DIFFICULTY']);

export function openSelect(w, twoP) {
  Object.assign(w, { mode: 'select', twoP, fighters: [], fireballs: [] });
  w.sel = { cur: [0, twoP ? 1 : null], lock: [false, false], roll: [null, null], slot: 0, go: 0, timeLeft: SELECT_FRAMES, timedOut: false };
}
const free = (w, n) => !w.sel.roll[n] && !w.sel.lock[n] && (w.twoP || n === 0);
export function selPick(w, n, i) {
  if (free(w, n) && i >= 0 && i < CHARS.length && w.sel.cur[n] !== i) {
    w.sel.cur[n] = i; w.sfx('select');
  }
}
export function selMove(w, n, d) {
  if (free(w, n)) { w.sel.cur[n] = (w.sel.cur[n] + d + CHARS.length) % CHARS.length; w.sfx('select'); }
}
function beginRoll(w, n, autoLock = false) {
  const s = w.sel, N = CHARS.length, target = rnd(N), H = 20, seq = [], times = []; let t = 0;
  for (let k = 0; k < H; k++) { seq.push(((target - (H - 1 - k)) % N + N) % N); times.push(t); t += Math.round(3 + k * .45); }
  s.roll[n] = { f: 0, seq, times, autoLock }; s.lock[n] = false; s.go = 0;
  w.sfx('rollStart');
}
export function selLock(w, n) {
  const s = w.sel; if (s.roll[n] || (!w.twoP && n === 1)) return;
  s.lock[n] = !s.lock[n]; w.sfx(s.lock[n] ? 'confirm' : 'select');
  if (!w.twoP && n === 0 && !s.lock[0]) { s.cur[1] = null; s.lock[1] = false; s.roll[1] = null; }
}
// Random is an animated highlight only: after it stops, the player still chooses whether to lock in.
export function selRandom(w, n) {
  if (!w.twoP && n === 1) return;
  if (w.sel.roll[n]) return;
  beginRoll(w, n, false);
}
function tickSelect(w) {
  const s = w.sel;
  if (!s.timedOut) s.timeLeft = Math.max(0, s.timeLeft - 1);
  if (!s.timedOut && s.timeLeft > 0 && s.timeLeft <= 600 && s.timeLeft % 60 === 0) {
    w.sfx(s.timeLeft <= 180 ? 'countdownFinal' : 'countdown');
  }
  if (!s.timedOut && s.timeLeft <= 0) {
    s.timeLeft = 0; s.timedOut = true;
    for (const n of (w.twoP ? [0, 1] : [0])) {
      if (s.roll[n]) s.roll[n].autoLock = true;
      else if (!s.lock[n]) beginRoll(w, n, true);
    }
  }
  if (!w.twoP && s.lock[0] && s.cur[1] === null && !s.roll[1] && !w.pendingRun) beginRoll(w, 1, true);
  [0, 1].forEach(n => {
    const r = s.roll[n]; if (!r) return;
    r.f++;
    let k = 0; while (k + 1 < r.times.length && r.times[k + 1] <= r.f) k++;
    if (s.cur[n] !== r.seq[k]) { s.cur[n] = r.seq[k]; w.sfx('roll'); }
    if (r.f >= ROLL_FRAMES) { s.roll[n] = null; s.lock[n] = !!r.autoLock; w.sfx('confirm'); }
  });
  if (w.pendingRun) {                                                // ladder / survival / time attack: opponents are chosen for you, no stage screen
    if (s.lock[0] && !s.roll[0]) { if (++s.go >= 50) startRun(w, s.cur[0]); } else s.go = 0;
    return;
  }
  if (s.lock[0] && s.lock[1] && !s.roll[0] && !s.roll[1]) { if (++s.go >= 70) openTheme(w, [...s.cur]); }
  else s.go = 0;
}
const inBox = (x, y, b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
export function selectClick(w, x, y) {
  const s = w.sel;
  if (inBox(x, y, randomBoxRect)) { selRandom(w, s.slot); return; }
  for (let i = 0; i < CHARS.length; i++) if (inBox(x, y, { x: PORT.x0 + i * (PORT.w + PORT.gap), y: PORT.y, w: PORT.w, h: PORT.h })) return selPick(w, s.slot, i);
  for (const n of [0, 1]) {
    const b = selButtons(n);
    if (inBox(x, y, b.lock)) { s.slot = n; return selLock(w, n); }
  }
  if (y >= 160) s.slot = x < W / 2 ? 0 : 1;
}
// ----- stage theme: picked after both fighters lock in -----
export function openTheme(w, picks = w.picks) { w.picks = picks; w.mode = 'theme'; w.sfx('confirm'); }
export function themeMove(w, d) {
  if (w.mode !== 'theme') return;
  w.theme = (w.theme + d + THEMES.length) % THEMES.length; w.sfx('select');
}
export function themePick(w, i) {
  if (w.mode !== 'theme' || i < 0 || i >= THEMES.length) return;
  if (w.theme !== i) { w.theme = i; w.sfx('select'); }
}
export function themeRandom(w) { if (w.mode === 'theme') themePick(w, rnd(THEMES.length)); }
export function themeConfirm(w) { if (w.mode === 'theme') beginLoading(w, 'match'); }          // confirm -> loading screen -> fight
export function themeClick(w, x, y) {
  if (inBox(x, y, THEME_START)) return themeConfirm(w);
  for (let i = 0; i < THEMES.length; i++) if (inBox(x, y, themeCardRect(i))) return themePick(w, i);     // a click only selects; START FIGHT confirms
}
// ----- loading screen: shown between choosing a stage / starting the Dojo / a rematch and the first frame of play -----
// main.js sets world.preload(load, world) to fetch sprites and music; it flips load.ready when done. Without it (tests) the screen
// is purely timed. A hard timeout means a slow or failed download can never leave the game stuck.
export function loadingFighters(w) {
  if (w.load && w.load.kind === 'dojo' && w.dojo) return [w.dojo.fighter, (w.dojo.fighter + 1) % CHARS.length];
  return w.picks;
}
export function beginLoading(w, kind) {
  w.load = { kind, from: w.mode, t: 0, bar: 0, progress: 0, ready: !w.preload, tip: rnd(LOAD_TIPS.length) };
  w.mode = 'loading'; w.sfx('confirm');
  if (w.preload) { try { w.preload(w.load, w); } catch { w.load.ready = true; } }
}
export function cancelLoading(w) { if (w.mode === 'loading') { if (w.run) return toMenu(w); w.mode = w.load.from === 'theme' || w.load.from === 'dojoSelect' ? w.load.from : 'menu'; w.load = null; } }
function tickLoading(w) {
  const L = w.load; if (!L) { w.mode = 'menu'; return; }
  L.t++;
  if (L.t >= LOADING_MAX) L.ready = true;
  L.bar = Math.min(L.t / LOADING_MIN, L.ready ? 1 : .92);
  if (L.ready && L.t >= LOADING_MIN) {
    const kind = L.kind; w.load = null;
    if (kind === 'dojo') startDojo(w);
    else {
      startMatch(w, w.twoP, w.picks);
      if (kind === 'run' && w.run.carry != null) { const p = w.fighters[0]; p.hp = p.show = Math.min(p.maxHp, w.run.carry); }       // survival: keep your health
    }
  }
}
export function launchDojo(w) { beginLoading(w, 'dojo'); }

// ----- match-over screen: REMATCH / CHANGE FIGHTERS / EXIT -----
export function matchMove(w, d) { w.endIndex = (w.endIndex + d + MATCH_ITEMS.length) % MATCH_ITEMS.length; w.sfx('select'); }
export function matchChoose(w, i) {
  if (w.mode !== 'match') return;
  if (i === 0) beginLoading(w, 'match');
  else if (i === 1) openSelect(w, w.twoP);
  else toMenu(w);
}
export function matchClick(w, x, y) {
  const inside = b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  for (let i = 0; i < MATCH_ITEMS.length; i++) if (inside(matchButtonRect(i))) { w.endIndex = i; return matchChoose(w, i); }
  if (!w.twoP && inside(MATCH_DIFF)) cycleDifficulty(w, 1);
}

// ----- arcade modes -----
// A "run" is a series of CPU fights: ARCADE LADDER (5 fights, best of 3, 2 continues), TIME ATTACK (5 single-round fights, timed),
// SURVIVAL (endless single-round fights, recover a little after each win). EXTREME BATTLE is a normal match with a rule change.
export function openModes(w) {
  Object.assign(w, { mode: 'modes', fighters: [], fireballs: [], run: null, pendingRun: null, xbPick: null, xb: null, cpuLevel: null, roundsToWin: ROUNDS_TO_WIN });
}
export function modeMove(w, d) { w.modeIndex = (w.modeIndex + d + MODE_CARDS.length) % MODE_CARDS.length; w.sfx('select'); }
export function modeChoose(w, i) {
  const id = MODE_CARDS[i].id; w.modeIndex = i; w.sfx('confirm');
  if (id === 'extreme') { w.mode = 'extremePick'; w.xi = 0; } else { w.pendingRun = id; openDifficulty(w); }       // difficulty -> fighter select -> run
}
export const EXTREME_CHOICES = EXTREME_MODS.length + 1;             // five rules + CHAOS
export function extremeMove(w, d) { w.xi = (w.xi + d + EXTREME_CHOICES) % EXTREME_CHOICES; w.sfx('select'); }
export function extremePick(w, i) { if (w.mode === 'extremePick' && i >= 0 && i < EXTREME_CHOICES && w.xi !== i) { w.xi = i; w.sfx('select'); } }
export function extremeConfirm(w) { if (w.mode === 'extremePick') { w.xbPick = w.xi; w.pendingRun = null; w.sfx('confirm'); openSelect(w, false); } }
export const rampLevel = (kind, base, i) => Math.min(2, base + (kind === 'survival' ? Math.floor(i / 3) : (i >= 2 ? 1 : 0) + (i >= 4 ? 1 : 0)));   // CPU level for fight i
export function startRun(w, player) {
  const kind = w.pendingRun, others = CHARS.map((_, i) => i).filter(i => i !== player).sort(() => Math.random() - .5);
  w.run = { kind, player, i: 0, total: kind === 'survival' ? Infinity : RUN_FIGHTS, others, frames: 0, credits: kind === 'arcade' ? RUN_CONTINUES : 0,
            base: w.difficulty, carry: null, result: null, state: 'fight', newBest: false, theme0: rnd(THEMES.length) };
  w.roundsToWin = kind === 'arcade' ? ROUNDS_TO_WIN : 1; w.xbPick = null;
  runBeginFight(w);
}
function runBeginFight(w) {
  const r = w.run;
  w.twoP = false; w.picks = [r.player, r.others[r.i % r.others.length]];
  w.theme = (r.theme0 + r.i) % THEMES.length; w.cpuLevel = rampLevel(r.kind, r.base, r.i); r.state = 'fight';
  beginLoading(w, 'run');
}
function recordRun(w) {
  const r = w.run, R = w.records;
  if (r.kind === 'survival') { r.newBest = r.i > R.survival.best; if (r.newBest) R.survival.best = r.i; return; }
  if (r.result !== 'clear') return;
  const slot = r.kind === 'arcade' ? R.arcade : R.time;
  if (r.kind === 'arcade') R.arcade.clears++;
  r.newBest = slot.best == null || r.frames < slot.best; if (r.newBest) slot.best = r.frames;
}
function runEnd(w, result) { const r = w.run; r.result = result; r.state = 'end'; w.mode = 'runEnd'; w.endIndex = 0; recordRun(w); w.sfx(result === 'clear' ? 'confirm' : 'ko'); }
function runFinishFight(w) {
  const r = w.run, won = w.fighters[0].wins >= w.roundsToWin;
  if (won) {
    r.i++;
    if (r.kind === 'survival') { const p = w.fighters[0]; r.carry = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * .3)); }
    if (r.i >= r.total) runEnd(w, 'clear'); else runBeginFight(w);
  } else if (r.credits > 0) { r.state = 'continue'; w.mode = 'runEnd'; w.endIndex = 0; }
  else runEnd(w, 'over');
}
export const runEndItems = w => (w.run.state === 'continue' ? ['CONTINUE', 'GIVE UP'] : ['PLAY AGAIN', 'CHANGE FIGHTER', 'EXIT']);
export function runEndMove(w, d) { const n = runEndItems(w).length; w.endIndex = (w.endIndex + d + n) % n; w.sfx('select'); }
export function runEndChoose(w, i) {
  const r = w.run; if (w.mode !== 'runEnd' || !r) return;
  const label = runEndItems(w)[i];
  if (label === 'CONTINUE') { r.credits--; runBeginFight(w); }
  else if (label === 'GIVE UP') runEnd(w, 'over');
  else if (label === 'PLAY AGAIN') startRun(w, r.player);
  else if (label === 'CHANGE FIGHTER') { w.run = null; openSelect(w, false); }                 // pendingRun stays, so the ladder starts again after picking
  else toMenu(w);
}
export function runEndClick(w, x, y) {
  runEndItems(w).forEach((_, i) => { const b = runEndRect(i); if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) { w.endIndex = i; runEndChoose(w, i); } });
}

// ----- pause, exit confirmation, settings and tutorial -----
export function pause(w) {
  if (['intro', 'fight', 'end', 'dojo'].includes(w.mode)) { w.back = w.mode; w.mode = 'pause'; w.pm = 0; w.exitConfirm = false; w.shake = 0; }
}
export function resume(w) { if (w.mode === 'pause') w.mode = w.back; }
export function openSettings(w) { w.settingsBack = w.mode; w.settingsIndex = 0; w.mode = 'settings'; }
export function closeSettings(w) { if (w.mode === 'settings') w.mode = w.settingsBack; }
export function settingsChoose(w, i, delta = 10) {
  const channel = ['music', 'ui', 'effects', 'voice'][i];
  if (channel) w.audio[channel] = Math.max(0, Math.min(100, w.audio[channel] + delta));
  else if (i === 4) w.difficulty = (w.difficulty + (delta < 0 ? -1 : 1) + DIFFICULTIES.length) % DIFFICULTIES.length;
  else if (i === 5) w.audio.muted = !w.audio.muted;
  else if (i === 6) w.reducedMotion = !w.reducedMotion;
  else closeSettings(w);
}
export function openTutorial(w) { w.mode = 'tutorial'; w.tutorialPage = 0; }
export function tutorialChoose(w, i) {
  if (i === 0) w.tutorialPage ^= 1;
  else toMenu(w);
}
export function pauseChoose(w, i, delta = 1) {
  if (w.exitConfirm) {
    if (i === 0) toMenu(w); else { w.exitConfirm = false; w.pm = 0; }
    return;
  }
  const label = pauseItems(w)[i];
  if (label === 'RESUME') resume(w);
  else if (label === 'REMATCH') startMatch(w, w.twoP, w.picks);
  else if (label === 'RESTART RUN') startRun(w, w.run.player);
  else if (label === 'EXIT MATCH' || label === 'EXIT' || label === 'EXIT RUN') { w.exitConfirm = true; w.exitChoice = 1; }
  else if (label === 'SETTINGS') openSettings(w);
  else if (label === 'DIFFICULTY') cycleDifficulty(w, delta);        // the CPU reads w.difficulty every frame, so it applies at once
}
export function pauseClick(w, x, y) {
  if (w.exitConfirm) {
    exitChoiceRect(0).x <= x && x < exitChoiceRect(0).x + exitChoiceRect(0).w && y >= exitChoiceRect(0).y && y < exitChoiceRect(0).y + exitChoiceRect(0).h && pauseChoose(w, 0);
    exitChoiceRect(1).x <= x && x < exitChoiceRect(1).x + exitChoiceRect(1).w && y >= exitChoiceRect(1).y && y < exitChoiceRect(1).y + exitChoiceRect(1).h && pauseChoose(w, 1);
    return;
  }
  pauseItems(w).forEach((_, i) => { const b = pauseRect(i); if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) pauseChoose(w, i, x < b.x + b.w / 2 ? -1 : 1); });
}
export function startMatch(w, twoP, picks = w.picks) {
  w.twoP = twoP; w.picks = picks;
  if (!w.run) { w.roundsToWin = ROUNDS_TO_WIN; w.cpuLevel = null; }
  const [i, j] = picks;
  w.fighters = [createFighter(CHARS[i], false, false), createFighter(CHARS[j], !twoP, i === j)];
  w.round = 0; newRound(w);
}
export function openDojo(w) {
  w.dojo = { fighter: 0, combo: 0, progress: 0, completed: false, successT: 0, cleared: COMBOS.map(() => false) };
  w.mode = 'dojoSelect';
}
export function dojoChangeFighter(w, delta) {
  if (w.mode !== 'dojoSelect' || !w.dojo) return;
  w.dojo.fighter = (w.dojo.fighter + delta + CHARS.length) % CHARS.length; w.sfx('select');
}
export function dojoChangeCombo(w, delta) {
  if (!w.dojo || !['dojoSelect', 'dojo'].includes(w.mode)) return;
  w.dojo.combo = (w.dojo.combo + delta + COMBOS.length) % COMBOS.length;
  if (w.mode === 'dojo') resetDojo(w); else w.sfx('select');
}
export function startDojo(w) {
  if (!w.dojo) openDojo(w);
  const playerIndex = w.dojo.fighter, dummyIndex = (playerIndex + 1) % CHARS.length;
  w.twoP = false; w.picks = [playerIndex, dummyIndex];
  w.fighters = [createFighter(CHARS[playerIndex], false, false), createFighter(CHARS[dummyIndex], false, false)];
  w.round = 1; resetDojo(w);
}
export function resetDojo(w) {
  if (!w.dojo || w.fighters.length !== 2) return;
  resetFighter(w.fighters[0], 300, 1); resetFighter(w.fighters[1], 660, -1);
  Object.assign(w, { mode: 'dojo', fireballs: [], fx: [], banner: null, t: 0, tick: 0, time: ROUND_TIME, hitstop: 0, shake: 0 });
  Object.assign(w.dojo, { progress: 0, completed: false, successT: 0, choice: null });
  w.sfx('confirm');
}
export function newRound(w) {
  w.fighters.forEach((f, i) => resetFighter(f, i ? 660 : 300, i ? -1 : 1));
  Object.assign(w, { fireballs: [], fx: [], banner: null, mode: 'intro', t: 0, tick: 0, time: ROUND_TIME, hitstop: 0 });
  w.round++;
  w.xb = w.xbPick == null ? null : EXTREME_MODS[w.xbPick === CHAOS ? rnd(EXTREME_MODS.length) : w.xbPick];     // Extreme Battle rule for this round
  if (w.xb) { if (w.xb.startMeter) w.fighters.forEach(f => { f.meter = w.xb.startMeter; }); w.banner = { text: 'RULE: ' + w.xb.name, t: INTRO_END_AT - 20 }; }
}
export function toMenu(w) {
  if (w.run && w.run.kind === 'survival' && !w.run.result) { w.run.result = 'over'; recordRun(w); }     // leaving mid-run still counts your survival streak
  Object.assign(w, { run: null, pendingRun: null, xbPick: null, xb: null, cpuLevel: null, roundsToWin: ROUNDS_TO_WIN, mode: 'menu', fighters: [], fireballs: [], fx: [], banner: null, shake: 0, hitstop: 0, menuIndex: 0 });
}

function physics(w, readInput, live) {
  w.fighters.forEach((f, n) => {
    const o = w.fighters[1 - n];
    const input = w.mode === 'dojo' && n === 1 ? {} : live ? (f.ai ? cpuInput(w, f, o) : readInput(n)) : {};
    updateFighter(w, f, o, input);
  });
  const [a, b] = w.fighters, d = b.x - a.x;
  if (Math.abs(d) < 55 && Math.abs(a.y - b.y) < 60) {          // keep fighters from overlapping
    const push = (55 - Math.abs(d)) / 2, s = d >= 0 ? 1 : -1;
    a.x -= s * push; b.x += s * push;
    w.fighters.forEach(f => { f.x = Math.max(40, Math.min(W - 40, f.x)); });
  }
  w.fireballs = w.fireballs.filter(fb => {
    fb.x += fb.v;
    const target = fb.owner === a ? b : a, h = hurtbox(target), m = 14 * (fb.size || 1);
    if (canHit(target) && fb.x > h.x1 - m && fb.x < h.x2 + m && fb.y > h.y1 && fb.y < h.y2) {
      applyHit(w, fb, target, { key: 's', dmg: fb.dmg, st: fb.st, kb: fb.kb, kd: fb.kd, chip: fb.chip, g: 'mid', x: fb.x, y: fb.y }); return false;
    }
    return fb.x > -50 && fb.x < W + 50;
  });
}
function checkRoundEnd(w) {
  const [a, b] = w.fighters;
  if (a.hp > 0 && b.hp > 0 && w.time > 0) return;
  w.winner = a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1;
  if (w.winner >= 0) w.fighters[w.winner].wins++;
  w.mode = 'end'; w.t = 0;
}
export const DOJO_NEXT_DELAY = 70;                                    // frames of "COMBO CLEARED!" before the choice appears
// After a clear: challenges 1-7 offer NEXT CHALLENGE / EXIT, the last one offers RESTART CHALLENGES / EXIT.
export const dojoChoiceLabels = w => (w.dojo.combo === COMBOS.length - 1 ? ['RESTART CHALLENGES', 'EXIT'] : ['NEXT CHALLENGE', 'EXIT']);
export function dojoChoiceMove(w, d) { if (w.dojo && w.dojo.choice) { w.dojo.choice.i = (w.dojo.choice.i + d + 2) % 2; w.sfx('select'); } }
export function dojoChoose(w, i) {
  const d = w.dojo; if (!d || !d.choice || w.mode !== 'dojo') return;
  if (i === 1) { toMenu(w); return; }
  if (d.combo === COMBOS.length - 1) { d.combo = 0; d.cleared = COMBOS.map(() => false); } else d.combo++;
  resetDojo(w);
}
export function dojoChoiceClick(w, x, y) {
  [0, 1].forEach(i => { const b = dojoChoiceRect(i); if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) { w.dojo.choice.i = i; dojoChoose(w, i); } });
}
function advanceDojo(w, readInput) {
  if (w.dojo.choice) return;                                       // the practice is frozen while the player decides
  const [player, dummy] = w.fighters, anchor = dummy.x, goal = COMBOS[w.dojo.combo].seq;
  physics(w, readInput, true);
  if (dummy.kd <= 0 && dummy.y >= GY) {                            // the training dummy stands its ground so long chains stay in reach
    dummy.x = anchor; dummy.vx = 0;
    const gap = player.x - dummy.x;
    if (Math.abs(gap) < 55) player.x = Math.max(40, Math.min(W - 40, dummy.x + (gap < 0 ? -55 : 55)));
  }
  if (!w.dojo.completed) {
    let matched = 0;
    if (dummy.cmbT > 0) for (let n = Math.min(goal.length, dummy.seq.length); n > 0; n--) {
      if (dummy.seq.slice(-n).every((move, i) => move === goal[i])) { matched = n; break; }
    }
    w.dojo.progress = matched;
    if (matched === goal.length) {
      w.dojo.completed = true; w.dojo.successT = DOJO_NEXT_DELAY; (w.dojo.cleared ||= COMBOS.map(() => false))[w.dojo.combo] = true; w.sfx('confirm');
    }
  }
  if (w.dojo.successT > 0 && --w.dojo.successT === 0 && w.dojo.completed) {
    w.dojo.choice = { i: 0 }; w.sfx('select');                   // ask: next challenge / restart, or exit
    return;
  }
  dummy.hp = dummy.maxHp; dummy.show = dummy.maxHp;
}
// Advance the game by exactly one frame. readInput(n) -> {l,r,u,d,p,k,s} for human player n.
export function step(w, readInput) {
  if (w.mode === 'pause') return;                                  // game is frozen while paused
  if (w.mode === 'select') tickSelect(w);
  else if (w.mode === 'loading') tickLoading(w);
  else if (w.mode === 'dojo') advanceDojo(w, readInput);
  else if (w.mode === 'intro') { if (++w.t >= INTRO_END_AT) { w.mode = 'fight'; w.t = 0; } }
  else if (w.mode === 'fight') {
    if (w.hitstop > 0) w.hitstop--;
    else {
      physics(w, readInput, true); if (++w.tick % 60 === 0) w.time--;
      if (w.run) w.run.frames++;                                                  // the run clock only ticks while fighting
      if (w.xb?.drain && w.tick % 40 === 0) w.fighters.forEach(f => { if (f.hp > 1) f.hp -= w.xb.drain; });
      checkRoundEnd(w);
    }
  } else if (w.mode === 'end') {
    w.t++;
    if (w.hitstop > 0) w.hitstop--; else physics(w, readInput, false);
    if (w.t > 180) {
      if (w.fighters.some(f => f.wins >= w.roundsToWin)) { if (w.run) runFinishFight(w); else { w.mode = 'match'; w.endIndex = 0; } } else newRound(w);
    }
  }
  if (!w.reducedMotion) w.shake *= 0.85; else w.shake = 0;
  w.fx.forEach(e => e.t++); w.fx = w.fx.filter(e => e.t < 14);
  if (w.banner && --w.banner.t <= 0) w.banner = null;
  w.fighters.forEach(f => { if (f.flash > 0) f.flash--; if (f.show > f.hp) f.show = Math.max(f.hp, f.show - 0.35); });
}
