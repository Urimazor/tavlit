/* Ready-made designs + filament palette */
(function (root) {
  const PRINT = { bedW: 250, bedH: 210, bedZ: 220, margin: 5, spacing: 3, overhang: 50 };
  const FRAME = { t: 3, rib: 2.4, clr: 0.07, gap: 0.4, color: '#85898c', jointClr: 0.2, clampEvery: 40, clampLen: 6, clampClr: 0.1, hang: { on: true, head: 8.5, shank: 4.5, headH: 3, slot: 9 } };
  const PIECE = { curve: 0, twist: 0, spiral: 0, profile: 1, layers: 10, smooth: 0, truncate: 0, dome: 0, cutTilt: 0, cutBy: 'field', cutAngle: 0, cutVary: 0, cutOn: false };
  // pattern settings beyond the lattice (section 2, "תבנית - דוגמה"); see tessellate() in engine.js
  const TESS = { rot: 0, ratio: 2, fill: 'full', motif: 'quarter', arr: 'random', orient: 0, inner: 0.92, vary: 'none', varyAmt: 0.5, varyFreq: 2, varyAngle: 0,
    mod: { type: 'none', amount: 0.6, freq: 2, angle: 0, both: false, cx: 0, cy: 0 }, warp: { amp: 0, len: 180, angle: 0, both: false } };
  const P = (o) => { const s = JSON.parse(JSON.stringify(Object.assign({ print: PRINT, frame: FRAME, piece: PIECE }, o))); s.tess = Object.assign(JSON.parse(JSON.stringify(TESS)), s.tess); return s; };
  const presets = [
    {
      key: 'test', label: 'פאנל בדיקה 15×15 (להתחיל מכאן)',
      state: P({
        name: 'פאנל בדיקה',
        shape: { type: 'rect', w: 150, h: 150, rim: 6 },
        tess: { type: 'hex', size: 34, relax: 3, seed: 1, twist: 0, center: 8, minFrac: 0.35 },
        surface: { type: 'dome', minH: 8, depth: 14, freq: 2, angle: 0, seed: 1, ring: 0.6 },
        move: { lean: 0.8, pull: 0, points: [{ type: 'vortex', x: 0, y: 0, strength: 1, radius: 50, fade: 80, opening: -0.2, angle: 0 }] },
        color: { by: 'height', bands: ['#23409a', '#2f7fd8', '#f4f4f1'], angle: 0, seed: 1, reverse: false }
      })
    },
    {
      key: 'swirl', label: 'מערבולת וורונוי',
      state: P({
        name: 'מערבולת וורונוי',
        piece: { curve: 0.8, twist: 20, spiral: 35, profile: 1.1, layers: 12 },
        shape: { type: 'rect', w: 240, h: 240, rim: 6 },
        tess: { type: 'voronoi', size: 40, relax: 3, seed: 7, twist: 0, center: 8, minFrac: 0.35 },
        surface: { type: 'dome', minH: 10, depth: 24, freq: 2, angle: 0, seed: 3, ring: 0.6 },
        move: { lean: 0.7, pull: 0.3, points: [{ type: 'vortex', x: 0, y: 0, strength: 1.1, radius: 90, fade: 140, opening: -0.35, angle: 0 }] },
        color: { by: 'height', bands: ['#7c1626', '#cc1f2f', '#f2711c', '#f4f4f1'], angle: 0, seed: 1, reverse: false }
      })
    },
    {
      key: 'eye', label: 'עין גדולה (אליפסה)',
      state: P({
        name: 'עין',
        piece: { curve: 0.4, twist: 0, spiral: 0, profile: 1, layers: 8 },
        shape: { type: 'ellipse', w: 700, h: 520, rim: 8 },
        tess: { type: 'hex', size: 30, relax: 3, seed: 1, twist: 0, center: 8, minFrac: 0.4 },
        surface: { type: 'ring', minH: 6, depth: 34, freq: 2, angle: 0, seed: 1, ring: 0.55 },
        move: { lean: 0.9, pull: 0, points: [{ type: 'magnet', x: 0, y: 0, strength: -1, radius: 120, fade: 260, opening: 0, angle: 0 }] },
        color: { by: 'radial', bands: ['#1c1c1e', '#f4f4f1', '#1c1c1e', '#cc1f2f', '#cc1f2f'], angle: 0, seed: 1, reverse: false }
      })
    },
    {
      key: 'sun', label: 'חמנייה בנחושת',
      state: P({
        name: 'חמנייה',
        piece: { curve: 0.6, twist: 0, spiral: 25, profile: 1.2, layers: 10 },
        shape: { type: 'circle', w: 520, h: 520, rim: 8 },
        tess: { type: 'sunflower', size: 30, relax: 0, seed: 1, twist: 0, center: 8, minFrac: 0.35 },
        surface: { type: 'dome', minH: 8, depth: 30, freq: 2, angle: 0, seed: 1, ring: 0.6 },
        move: { lean: 0.75, pull: 0.2, points: [{ type: 'magnet', x: 0, y: 0, strength: 1, radius: 40, fade: 260, opening: 0, angle: 0 }, { type: 'vortex', x: 0, y: 0, strength: 0.5, radius: 120, fade: 200, opening: 0, angle: 0 }] },
        color: { by: 'radial', bands: ['#efe6d2', '#f4a383', '#b5653b', '#7a4b2a'], angle: 0, seed: 1, reverse: false }
      })
    },
    {
      key: 'wave', label: 'גל אלכסוני',
      state: P({
        name: 'גל אלכסוני',
        shape: { type: 'ellipse', w: 600, h: 400, rim: 8 },
        tess: { type: 'hex', size: 30, relax: 3, seed: 1, twist: 0, center: 8, minFrac: 0.4 },
        surface: { type: 'wave', minH: 6, depth: 18, freq: 3, angle: 35, seed: 1, ring: 0.6 },
        move: { lean: 0.9, pull: 0, points: [{ type: 'current', x: 0, y: 0, strength: 1, radius: 400, fade: 200, opening: 0, angle: 35 }] },
        color: { by: 'gradient', bands: ['#23409a', '#f4f4f1', '#1aa6a0', '#f4f4f1', '#23409a', '#7cc4e8'], angle: 35, seed: 1, reverse: false }
      })
    },
    {
      key: 'hex', label: 'משושה טורקיז',
      state: P({
        name: 'משושה',
        shape: { type: 'hexagon', w: 480, h: 420, rim: 8 },
        tess: { type: 'triangle', size: 28, relax: 3, seed: 1, twist: 0, center: 8, minFrac: 0.4 },
        surface: { type: 'bowl', minH: 8, depth: 22, freq: 2, angle: 0, seed: 1, ring: 0.6 },
        move: { lean: 0.7, pull: 0, points: [{ type: 'vortex', x: 0, y: 0, strength: 1, radius: 100, fade: 180, opening: 0.3, angle: 0 }] },
        color: { by: 'radial', bands: ['#b9bbb8', '#f4a383', '#1aa6a0'], angle: 0, seed: 1, reverse: false }
      })
    },
    {
      key: 'radial', label: 'פרח רדיאלי',
      state: P({
        name: 'פרח רדיאלי',
        piece: { curve: 0.5, twist: 45, spiral: 0, profile: 0.8, layers: 20, smooth: 0.6, truncate: 0.35, dome: 0.8 },
        shape: { type: 'circle', w: 360, h: 360, rim: 7 },
        tess: { type: 'radial', size: 32, relax: 0, seed: 1, twist: 1, center: 8, minFrac: 0.35 },
        surface: { type: 'cone', minH: 8, depth: 26, freq: 2, angle: 0, seed: 1, ring: 0.6 },
        move: { lean: 1.0, pull: 0, points: [{ type: 'vortex', x: 0, y: 0, strength: 1, radius: 60, fade: 160, opening: 0.2, angle: 0 }] },
        color: { by: 'radial', bands: ['#f4f4f1', '#3f8f4f', '#7b7f3a'], angle: 0, seed: 1, reverse: false }
      })
    }
  ];
  // ready-made patterns for section 2: the six original lattices to start from, then new ones. Applying one
  // changes only the pattern (state.tess), nothing else of the design
  const patterns = [
    { key: 'hex', label: 'משושים', orig: true, tess: { type: 'hex', size: 30 } },
    { key: 'square', label: 'ריבועים', orig: true, tess: { type: 'square', size: 30 } },
    { key: 'triangle', label: 'משולשים', orig: true, tess: { type: 'triangle', size: 28 } },
    { key: 'radial', label: 'רדיאלי', orig: true, tess: { type: 'radial', size: 32, twist: 1, center: 8 } },
    { key: 'voronoi', label: 'וורונוי', orig: true, tess: { type: 'voronoi', size: 40, relax: 3, seed: 7 } },
    { key: 'sunflower', label: 'חמנייה', orig: true, tess: { type: 'sunflower', size: 30 } },
    { key: 'waves', label: 'רשת גלית', tess: { type: 'square', size: 22, warp: { amp: 14, len: 180, angle: 10, both: true } } },
    { key: 'lens', label: 'עדשה: גדול במרכז', tess: { type: 'square', size: 22, mod: { type: 'radial', amount: -0.9 } } },
    { key: 'hexwave', label: 'משושים בגלי גודל', tess: { type: 'hex', size: 24, mod: { type: 'wave', amount: 0.6, freq: 1.5, angle: 0 } } },
    { key: 'growth', label: 'מעבר מקטן לגדול', tess: { type: 'hex', size: 24, mod: { type: 'linear', amount: 0.9, angle: 0 } } },
    { key: 'ripple', label: 'טבעות גליות', tess: { type: 'radial', size: 24, twist: 0.5, mod: { type: 'ripple', amount: 0.6, freq: 2 } } },
    { key: 'brick', label: 'לבנים', tess: { type: 'brick', size: 18, ratio: 2 } },
    { key: 'basket', label: 'קליעה', tess: { type: 'basket', size: 18 } },
    { key: 'cubes', label: 'קוביות', tess: { type: 'rhombille', size: 24 } },
    { key: 'trihex', label: 'משושים ומשולשים', tess: { type: 'trihex', size: 28 } },
    { key: 'octsquare', label: 'מתומנים וריבועים', tess: { type: 'octsquare', size: 30 } },
    { key: 'halves', label: 'חצאי עיגול', tess: { type: 'square', size: 36, fill: 'motif', motif: 'half', arr: 'random', inner: 0.95 } },
    { key: 'flowers', label: 'פרחים מרבעי עיגול', tess: { type: 'square', size: 36, fill: 'motif', motif: 'quarter', arr: 'block', inner: 0.97 } },
    { key: 'quarters', label: 'רבעי עיגול אקראיים', tess: { type: 'square', size: 36, fill: 'motif', motif: 'quarter', arr: 'random', inner: 0.97, seed: 3 } },
    { key: 'leaves', label: 'עלים', tess: { type: 'square', size: 36, fill: 'motif', motif: 'leaf', arr: 'checker', inner: 0.95 } },
    { key: 'dots', label: 'נקודות: חצי־טון', tess: { type: 'hex', size: 26, fill: 'motif', motif: 'circle', inner: 0.95, vary: 'center', varyAmt: 0.6 } },
    { key: 'diamonds', label: 'יהלומים מתרחבים', tess: { type: 'square', size: 26, fill: 'motif', motif: 'mid', inner: 0.95, mod: { type: 'radial', amount: -0.7 } } }
  ];
  const palette = [
    ['לבן', '#f4f4f1'], ['שמנת', '#efe6d2'], ['אפור בהיר', '#b9bbb8'], ['אפור', '#85898c'], ['אפור כהה', '#4d5154'], ['שחור', '#1c1c1e'],
    ['צהוב', '#f6c81b'], ['חרדל', '#d9a21b'], ['כתום', '#f2711c'], ['אפרסק', '#f4a383'], ['אדום', '#cc1f2f'], ['בורדו', '#7c1626'],
    ['ורוד', '#e86f9c'], ['סגול', '#5e4b8b'], ['כחול כהה', '#23409a'], ['כחול', '#2f7fd8'], ['תכלת', '#7cc4e8'], ['טורקיז', '#1aa6a0'],
    ['ירוק', '#3f8f4f'], ['זית', '#7b7f3a'], ['חום', '#7a4b2a'], ['נחושת', '#b5653b'], ['זהב', '#c9a24a'], ['כסף', '#a8abad']
  ];
  root.WallPresets = { presets, palette, patterns, PRINT, FRAME, TESS };
})(typeof window !== 'undefined' ? window : globalThis);
