/* WallEngine — parametric relief wall panel generator.
   Pure functions, no DOM. Units: millimetres. Panel lies in XY, relief grows toward +Z.
   Requires global d3 (d3-delaunay) for Voronoi tessellations. */
(function (root) {
  'use strict';

  // ---------- random ----------
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 2D polygon utils (polygons are arrays of [x,y], CCW) ----------
  function area(p) {
    let s = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }
  function centroid(p) {
    let cx = 0, cy = 0, s = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const f = a[0] * b[1] - b[0] * a[1];
      s += f; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f;
    }
    if (Math.abs(s) < 1e-9) {
      let x = 0, y = 0; p.forEach(q => { x += q[0]; y += q[1]; });
      return [x / p.length, y / p.length];
    }
    return [cx / (3 * s), cy / (3 * s)];
  }
  function ccw(p) { return area(p) < 0 ? p.slice().reverse() : p; }
  function bbox(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  function inside(p, pt) { // convex or not, ray casting
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i], b = p[j];
      if (((a[1] > pt[1]) !== (b[1] > pt[1])) && (pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c;
    }
    return c;
  }
  // same ray casting as inside(), but the edge crossings of each horizontal line are kept per polygon,
  // so many tests on the same y (the keyhole search samples a grid) cost a couple of compares each
  function insideY(p, x, y) {
    let m = p._yc; if (!m) m = p._yc = new Map();
    let xs = m.get(y);
    if (!xs) {
      xs = [];
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const a = p[i], b = p[j];
        if ((a[1] > y) !== (b[1] > y)) xs.push((b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]);
      }
      m.set(y, xs);
    }
    let c = false;
    for (let k = 0; k < xs.length; k++) if (x < xs[k]) c = !c;
    return c;
  }
  // Sutherland–Hodgman: clip subject by convex CCW clip polygon
  function clipConvex(subject, clip) {
    let out = subject;
    for (let i = 0; i < clip.length && out.length; i++) {
      const A = clip[i], B = clip[(i + 1) % clip.length];
      const inp = out; out = [];
      const side = q => (B[0] - A[0]) * (q[1] - A[1]) - (B[1] - A[1]) * (q[0] - A[0]);
      for (let j = 0; j < inp.length; j++) {
        const P = inp[j], Q = inp[(j + 1) % inp.length];
        const sp = side(P), sq = side(Q);
        if (sp >= 0) out.push(P);
        if ((sp >= 0) !== (sq >= 0)) {
          const t = sp / (sp - sq);
          out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
        }
      }
    }
    return out;
  }
  // remove near-duplicate and collinear vertices, merge short edges
  // rank(v): how many cells share point v (0: only this one). Merging a short edge first tries to carry the two
  // neighbouring edges on, in their own lines, until they meet: those edges are shared with the cells next door,
  // so the gap along them stays even. Otherwise the point shared by more cells stays where it is and the other end
  // goes. Moving both to the middle of the short edge (each cell its own) opened wedge-shaped gaps at the panel's edge
  function simplify(p, minEdge, rank) {
    let q = p.slice();
    let changed = true, guard = 0;
    const rk = v => rank ? rank(v) : 0;
    while (changed && q.length > 3 && guard++ < 200) {
      changed = false;
      for (let i = 0; i < q.length; i++) {
        const j = (i + 1) % q.length, a = q[i], b = q[j];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minEdge) {
          const ra = rk(a), rb = rk(b);
          const pv = q[(i - 1 + q.length) % q.length], nx = q[(j + 1) % q.length];
          const d1 = [a[0] - pv[0], a[1] - pv[1]], d2 = [nx[0] - b[0], nx[1] - b[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
          let X = null;
          if (Math.abs(den) > 1e-9) {
            const t = ((b[0] - pv[0]) * d2[1] - (b[1] - pv[1]) * d2[0]) / den;
            X = [pv[0] + d1[0] * t, pv[1] + d1[1] * t];
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            if (!(t > 0.5) || Math.hypot(X[0] - mid[0], X[1] - mid[1]) > 1.5 * minEdge || Math.hypot(nx[0] - X[0], nx[1] - X[1]) < 1e-6) X = null;
          }
          if (X) { q.splice(i, 1, X); q.splice((i + 1) % q.length, 1); }
          else if (ra > rb) q.splice(j, 1);
          else if (rb > ra) q.splice(i, 1);
          else { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; q.splice(i, 1, m); q.splice((i + 1) % (q.length), 1); }
          changed = true; break;
        }
      }
      if (changed) continue;
      for (let i = 0; i < q.length; i++) {
        const a = q[(i - 1 + q.length) % q.length], b = q[i], c = q[(i + 1) % q.length];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
        if (Math.abs(cr) < 0.02 * l && rk(b) < 1) { q.splice(i, 1); changed = true; break; } // ~1.1°
      }
    }
    return q;
  }
  function isConvexCCW(p) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-6) return false;
    }
    return area(p) > 0;
  }
  // offset convex CCW polygon inward by d, keeping vertex count; null if it collapses
  function inset(p, d, concave) {
    if (d === 0) return p.slice();
    const n = p.length, lines = [];
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-9) return null;
      const nx = -dy / L, ny = dx / L; // left normal = interior
      const di = Array.isArray(d) ? d[i] : d;
      lines.push({ px: a[0] + nx * di, py: a[1] + ny * di, dx: dx / L, dy: dy / L });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
      const den = l1.dx * l2.dy - l1.dy * l2.dx;
      if (Math.abs(den) < 1e-6) { // collinear neighbours: shift the vertex along the shared normal
        if (l1.dx * l2.dx + l1.dy * l2.dy < 0) return null;
        out.push([l2.px, l2.py]); continue;
      }
      const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
      out.push([l1.px + l1.dx * t, l1.py + l1.dy * t]);
    }
    // edges must keep their direction (no flipping)
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n], c = out[i], e = out[(i + 1) % n];
      if ((b[0] - a[0]) * (e[0] - c[0]) + (b[1] - a[1]) * (e[1] - c[1]) <= 0) return null;
    }
    if (concave ? !simpleCCW(out) : !isConvexCCW(out)) return null;
    return out;
  }

  // counter-clockwise and no edge crosses another (for joined, non-convex outlines)
  function simpleCCW(p) {
    if (area(p) <= 0) return false;
    const n = p.length;
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
    }
    return true;
  }
  // ---------- shapes ----------
  function makeShape(s) {
    const W = s.w, H = s.h;
    const pts = [];
    if (s.type === 'rect') {
      pts.push([-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]);
    } else if (s.type === 'circle' || s.type === 'ellipse') {
      const rx = s.type === 'circle' ? Math.min(W, H) / 2 : W / 2;
      const ry = s.type === 'circle' ? rx : H / 2;
      const n = 120;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([rx * Math.cos(a), ry * Math.sin(a)]); }
    } else if (s.type === 'hexagon') {
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; pts.push([W / 2 * Math.cos(a), H / 2 * Math.sin(a) / Math.sin(Math.PI / 3)]); }
      // scale y so that flat-to-flat equals H
      const yb = bbox(pts); const k = H / yb.h; pts.forEach(q => q[1] *= k);
    } else if (s.type === 'octagon') {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; pts.push([Math.cos(a), Math.sin(a)]); }
      const b = bbox(pts); pts.forEach(q => { q[0] *= W / b.w; q[1] *= H / b.h; });
    }
    return densify(ccw(pts), s.seg || 18);
  }
  // split long edges so the rim can be divided between frame tiles
  function densify(p, maxLen) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen));
      for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    return out;
  }

  // ---------- tessellations ----------
  function tessellate(t, region, outer) {
    const b = bbox(region), s = t.size, ob = bbox(outer || region);
    const cells = [];
    const pad = s * 2;
    if (t.type === 'hex') {
      const R = s / Math.sqrt(3);
      const dy = 1.5 * R;
      let row = 0;
      for (let y = b.y0 - pad; y <= b.y1 + pad; y += dy, row++) {
        const off = (row % 2) ? s / 2 : 0;
        for (let x = b.x0 - pad + off; x <= b.x1 + pad; x += s) {
          const c = [];
          for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; c.push([x + R * Math.cos(a), y + R * Math.sin(a)]); }
          cells.push(c);
        }
      }
      return { cells, nominal: (3 * Math.sqrt(3) / 2) * R * R };
    }
    if (t.type === 'square') {
      for (let y = b.y0 - pad; y <= b.y1 + pad; y += s)
        for (let x = b.x0 - pad; x <= b.x1 + pad; x += s)
          cells.push([[x, y], [x + s, y], [x + s, y + s], [x, y + s]]);
      return { cells, nominal: s * s };
    }
    if (t.type === 'triangle') {
      const a = s * 1.5, h = a * Math.sqrt(3) / 2;
      let row = 0;
      for (let y = b.y0 - pad; y <= b.y1 + pad; y += h, row++) {
        const off = (row % 2) ? a / 2 : 0;
        for (let x = b.x0 - pad + off; x <= b.x1 + pad; x += a) {
          cells.push([[x, y], [x + a, y], [x + a / 2, y + h]]);
          cells.push([[x + a, y], [x + a * 1.5, y + h], [x + a / 2, y + h]]);
        }
      }
      return { cells, nominal: a * h / 2 };
    }
    if (t.type === 'radial') {
      // Every ring is cut into straight-sided cells (pieces need convex outlines). Two rings share one boundary: the
      // polygon through the outer ring's corners on that circle. A cell's outer side follows that polygon, so it
      // meets the next ring along the very same line and the gap between rings stays even (with plain chords on
      // both sides, rings with different counts crossed each other: overlaps in some places, wedges in others)
      const maxR = Math.hypot(Math.max(Math.abs(ob.x0), Math.abs(ob.x1)), Math.max(Math.abs(ob.y0), Math.abs(ob.y1))) + s;
      const n0 = Math.max(5, Math.round(t.center || 8));
      const r0 = s * 1.1, TAU = Math.PI * 2;
      const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
      const rings = [];   // { r: inner radius, n, tw }
      for (let r = r0, ring = 0; r < maxR; r += s, ring++) rings.push({ r, n: Math.max(n0, Math.round((TAU * (r + s / 2)) / s)), tw: (t.twist || 0) * ring * 0.15 });
      const md = x => ((x % TAU) + TAU) % TAU;
      // the outer side of a cell spanning angles a0..a1 at radius R, where ring nx starts (null: a plain chord)
      const outerSide = (R, a0, a1, nx) => {
        if (!nx) return [pol(R, a1), pol(R, a0)];
        const st = TAU / nx.n, rho = g => { const j = Math.floor(md(g - nx.tw) / st), mid = nx.tw + (j + 0.5) * st; return R * Math.cos(st / 2) / Math.cos(md(g - mid + Math.PI) - Math.PI); };
        const pts = [pol(rho(a0), a0)];
        const first = Math.ceil((a0 - nx.tw) / st - 1e-9);
        for (let j = first; nx.tw + j * st < a1 - 1e-9; j++) { const g = nx.tw + j * st; if (g > a0 + 1e-9) pts.push(pol(R, g)); }
        pts.push(pol(rho(a1), a1));
        return pts.reverse();
      };
      for (let k = 0; k < n0; k++) {
        const a0 = (k / n0) * TAU, a1 = ((k + 1) / n0) * TAU;
        cells.push([[0, 0]].concat(outerSide(r0, a0, a1, rings[0]).reverse()));
      }
      rings.forEach((g, i) => {
        for (let k = 0; k < g.n; k++) {
          const a0 = (k / g.n) * TAU + g.tw, a1 = ((k + 1) / g.n) * TAU + g.tw;
          cells.push([pol(g.r, a0), pol(g.r, a1)].concat(outerSide(g.r + s, a0, a1, rings[i + 1])));
        }
      });
      return { cells, nominal: s * s };
    }
    if (t.type === 'voronoi' || t.type === 'sunflower') {
      const D = root.d3 && root.d3.Delaunay;
      if (!D) throw new Error('d3-delaunay not loaded');
      const A = Math.abs(area(region));
      const nominal = 0.866 * s * s;
      const N = Math.max(4, Math.round(A / nominal));
      let pts = [];
      if (t.type === 'sunflower') {
        const golden = Math.PI * (3 - Math.sqrt(5));
        const rmax = Math.hypot(b.w, b.h) / 2;
        const c = Math.sqrt(nominal / Math.PI) * 1.0;
        for (let i = 0; ; i++) {
          const r = c * Math.sqrt(i + 0.5);
          if (r > rmax + s) break;
          const a = i * golden;
          const p = [r * Math.cos(a), r * Math.sin(a)];
          if (inside(region, p)) pts.push(p);
        }
      } else {
        const R = rng(t.seed || 1);
        let guard = 0;
        while (pts.length < N && guard++ < N * 200) {
          const p = [b.x0 + R() * b.w, b.y0 + R() * b.h];
          if (inside(region, p)) pts.push(p);
        }
      }
      const box = [ob.x0 - 2, ob.y0 - 2, ob.x1 + 2, ob.y1 + 2];
      const iters = t.type === 'sunflower' ? 0 : Math.round(t.relax ?? 3);
      let polys = null;
      for (let it = 0; it <= iters; it++) {
        const vor = D.from(pts).voronoi(box);
        polys = pts.map((_, i) => {
          const c = vor.cellPolygon(i); if (!c) return null;
          return ccw(c.slice(0, -1).map(v => [v[0], v[1]]));
        });
        if (it < iters) pts = polys.map((pl, i) => { if (!pl) return pts[i]; const q = clipConvex(pl, region); return q.length > 2 ? centroid(q) : pts[i]; });
      }
      return { cells: polys.filter(Boolean), nominal };
    }
    throw new Error('unknown tessellation ' + t.type);
  }

  // ---------- surface ----------
  function surfaceAt(sf, shape, x, y, R) {
    const u = x / (shape.w / 2), v = y / (shape.h / 2);
    const r = Math.min(1.2, Math.hypot(u, v));
    const clamp = z => Math.max(0, Math.min(1, z));
    const ang = (sf.angle || 0) * Math.PI / 180;
    const f = sf.freq || 2;
    switch (sf.type) {
      case 'flat': return 0.5;
      case 'dome': return clamp(1 - r * r);
      case 'bowl': return clamp(r * r);
      case 'cone': return clamp(1 - r);
      case 'ring': { const r0 = sf.ring ?? 0.6; return clamp(Math.exp(-Math.pow((r - r0) / 0.28, 2))); }
      case 'wave': return 0.5 + 0.5 * Math.sin(Math.PI * f * (u * Math.cos(ang) + v * Math.sin(ang)));
      case 'ripple': return 0.5 + 0.5 * Math.cos(Math.PI * f * r);
      case 'tilt': return clamp(0.5 + 0.5 * (u * Math.cos(ang) + v * Math.sin(ang)));
      case 'noise': return valueNoise(u * f, v * f, sf.seed || 1);
    }
    return 0.5;
  }
  function valueNoise(x, y, seed) {
    const h = (i, j) => { let n = i * 374761393 + j * 668265263 + seed * 2147483647; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967296; };
    const sm = t => t * t * (3 - 2 * t);
    let tot = 0, amp = 1, norm = 0;
    for (let o = 0; o < 3; o++) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      tot += amp * (a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf);
      norm += amp; amp *= 0.5; x *= 2; y *= 2;
    }
    return tot / norm;
  }

  // ---------- movement field ----------
  function fieldAt(points, x, y) {
    let vx = 0, vy = 0;
    for (const p of points) {
      const dx = x - p.x, dy = y - p.y, r = Math.hypot(dx, dy);
      const R = p.radius, F = Math.max(1, p.fade);
      let w = r <= R ? 1 : r >= R + F ? 0 : 1 - smooth((r - R) / F);
      if (w <= 0) continue;
      let ux = 0, uy = 0;
      const rx = r > 1e-6 ? dx / r : 0, ry = r > 1e-6 ? dy / r : 0;
      if (p.type === 'vortex') {
        const phi = (p.opening || 0) * Math.PI / 2;
        const tx = -ry, ty = rx;
        ux = tx * Math.cos(phi) + rx * Math.sin(phi);
        uy = ty * Math.cos(phi) + ry * Math.sin(phi);
        // soften the singular centre
        const core = Math.min(1, r / 12); w *= core;
      } else if (p.type === 'magnet') {
        ux = -rx; uy = -ry; const core = Math.min(1, r / 12); w *= core;
      } else if (p.type === 'current') {
        const a = (p.angle || 0) * Math.PI / 180; ux = Math.cos(a); uy = Math.sin(a);
      }
      vx += ux * w * p.strength; vy += uy * w * p.strength;
    }
    const m = Math.hypot(vx, vy);
    if (m > 1.5) { vx *= 1.5 / m; vy *= 1.5 / m; }
    return [vx, vy];
  }
  // per-point additions to curvature and spiral, weighted like the field
  function modsAt(points, x, y) {
    let curve = 0, spiral = 0, cut = 0;
    for (const p of points) {
      if (!p.curve && !p.spiral && !p.cut) continue;
      const r = Math.hypot(x - p.x, y - p.y), R = p.radius, F = Math.max(1, p.fade);
      const w = r <= R ? 1 : r >= R + F ? 0 : 1 - smooth((r - R) / F);
      curve += (p.curve || 0) * w; spiral += (p.spiral || 0) * w; cut += (p.cut || 0) * w;
    }
    return { curve, spiral, cut };
  }
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  // ---------- main build ----------
  // opts.draft: quick preview while a slider is dragged (no keyholes, so no second pass)
  function build(st, noHang, opts) {
    if (opts && opts.draft) noHang = true;
    const warnings = [];
    let fr = st.frame;
    const pr = st.print;
    // Hanging must never change how the pieces look. So first build the panel without keyholes, and only
    // place keyholes under pieces whose unchanged shape has room for the hidden boss.
    let baseShape = null;
    if (noHang) fr = Object.assign({}, fr, { hang: Object.assign({}, fr.hang || {}, { on: false }) });
    else if (!fr.hang || fr.hang.on !== false) {
      const base = build(st, true);
      baseShape = new Map(base.pieces.map(c => [c.id, { collar: c.collar, layers: c.layers || [], z0: c.z0, zApex: c.zApex }]));
    }
    const outer = makeShape(st.shape);
    // hidden outer frame: the pieces along the edge grow out to the panel's edge and drop down to the wall
    // as a thin skirt, so the narrow outer rail of the frame sits hidden inside them
    const hideRim = !!fr.hideRim;
    const skW = 1.6, skClr = fr.clr + 0.15, railW = Math.max(fr.rib, 2.4);
    const rim = hideRim ? skW + skClr + railW - fr.rib / 2 : Math.max(st.shape.rim, fr.rib / 2 + 0.5);
    const frameOuter = hideRim ? inset(outer, skW + skClr) : outer;   // the frame stops short of the skirts
    const skirtIn = hideRim ? inset(outer, skW) : null;
    if (hideRim && (!frameOuter || !skirtIn)) throw new Error('הפאנל קטן מדי להסתרת המסגרת');
    const region = inset(outer, rim);
    if (!region) throw new Error('המסגרת החיצונית רחבה מדי ביחס לגודל');
    const tz = tessellate(st.tess, region, outer);
    const minEdge = Math.max(1.2, fr.rib * 0.6);
    // how many cells share a point: a corner of the region belongs to one cell only (0), a point where a cell edge
    // meets the region's edge to two (1), a corner of the tessellation inside the region to three or more (2)
    const pointRank = v => {
      let on = false;
      for (let k = 0; k < region.length; k++) {
        const a = region[k], b = region[(k + 1) % region.length];
        if (Math.abs(v[0] - a[0]) < 1e-4 && Math.abs(v[1] - a[1]) < 1e-4) return 0;
        const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = ((v[0] - a[0]) * ex + (v[1] - a[1]) * ey) / l2;
        if (t > 0 && t < 1 && Math.abs((v[0] - a[0]) * ey - (v[1] - a[1]) * ex) / Math.sqrt(l2) < 1e-4) on = true;
      }
      return on ? 1 : 2;
    };
    const q3 = p => p.map(v => [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000]);
    const cells = [], rimCells = [];
    for (let ci = 0; ci < tz.cells.length; ci++) {
      const raw = ccw(tz.cells[ci]);
      let tp = clipConvex(tz.tcells ? ccw(tz.tcells[ci]) : raw, outer);
      if (!tp || tp.length < 3 || Math.abs(area(tp)) < 0.5) continue;
      tp = q3(ccw(tp));
      let p = clipConvex(raw, region);
      if (p && p.length >= 3) p = ccw(p);
      if (p && p.length >= 3 && area(p) >= 2) {
        p = simplify(p, minEdge, pointRank);
        if (p.length >= 3 && area(p) > 1) { cells.push({ poly: p, area: area(p), tpoly: tp }); continue; }
      }
      rimCells.push({ tpoly: tp, c: centroid(tp) });
    }
    const minFrac = st.tess.minFrac ?? 0.35;
    const t = fr.t, half = fr.rib / 2, clr = fr.clr, gap = fr.gap;
    const bevel = Math.max(0.6, half + clr - gap / 2);   // 45°: rise = the step from the opening to the visible body
    let maxExt = 0;
    // distance from a point to the inner edge of the outer frame
    const edgeDist = m => { let dd = Infinity; for (let k = 0; k < region.length; k++) { const p1 = region[k], p2 = region[(k + 1) % region.length], ex = p2[0] - p1[0], ey = p2[1] - p1[1], l2 = ex * ex + ey * ey || 1, tt = Math.max(0, Math.min(1, ((m[0] - p1[0]) * ex + (m[1] - p1[1]) * ey) / l2)); dd = Math.min(dd, Math.hypot(m[0] - p1[0] - ex * tt, m[1] - p1[1] - ey * tt)); } return dd; };
    const onEdge = c => c.poly.some(v => edgeDist(v) < 1 || !inside(region, v));
    cells.forEach((c, i) => {
      c.id = i; c.c = centroid(c.poly);
      c.bb = bbox(c.poly); c.tbb = bbox(c.tpoly); maxExt = Math.max(maxExt, c.tbb.w, c.tbb.h);
      c.kind = c.area >= minFrac * tz.nominal ? 'piece' : 'blank';
      // with the outer frame hidden, a small cut-off cell on the edge still gets a piece, or the frame would show there
      if (hideRim && c.kind === 'blank' && onEdge(c)) c.kind = 'piece';
    });
    rimCells.forEach(r => r.tbb = bbox(r.tpoly));

    // ---- frame tiles made of whole cells, sized for the bed ----
    const uw = pr.bedW - 2 * pr.margin, uh = pr.bedH - 2 * pr.margin;
    const ob = bbox(outer);
    const fitsBed = (w, h) => (w <= uw + 0.3 && h <= uh + 0.3) || (w <= uh + 0.3 && h <= uw + 0.3);
    const allT = cells.concat(rimCells);
    function tryGrid(nx, ny) {
      const sx = ob.w / nx, sy = ob.h / ny;
      const tileOf = (x, y) => Math.min(ny - 1, Math.max(0, Math.floor((ob.y1 - y) / sy))) * nx + Math.min(nx - 1, Math.max(0, Math.floor((x - ob.x0) / sx)));
      const bbs = Array.from({ length: nx * ny }, () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
      for (const c of allT) {
        const cc = c.c || centroid(c.tpoly);
        c._t = tileOf(cc[0], cc[1]);
        const B = bbs[c._t]; B.x0 = Math.min(B.x0, c.tbb.x0); B.y0 = Math.min(B.y0, c.tbb.y0); B.x1 = Math.max(B.x1, c.tbb.x1); B.y1 = Math.max(B.y1, c.tbb.y1);
      }
      let okX = true, okY = true;
      for (const B of bbs) if (B.x1 > B.x0) {
        const w = Math.min(ob.w, B.x1 - B.x0 + 3), h = Math.min(ob.h, B.y1 - B.y0 + 3); // +dovetail allowance
        if (!fitsBed(w, h)) { if (w > Math.max(uw, uh) || (w > uw && h > uh && w >= h)) okX = false; else okY = false; if (w <= uw && h > uh) okY = false; if (h <= uh && w > uw) okX = false; }
      }
      return { okX, okY };
    }
    let best = null;
    for (const [tw, th] of [[uw, uh], [uh, uw]]) {
      let nx = Math.max(1, Math.ceil(ob.w / tw)), ny = Math.max(1, Math.ceil(ob.h / th));
      for (let guard = 0; guard < 12; guard++) {
        const r = tryGrid(nx, ny);
        if (r.okX && r.okY) break;
        if (!r.okX) nx++; if (!r.okY) ny++;
      }
      if (!best || nx * ny < best.nx * best.ny) best = { nx, ny };
    }
    const P = best; tryGrid(P.nx, P.ny);
    allT.forEach(c => c.tile = c._t);

    // spatial lookup of tile polygons
    const gsz = Math.max(maxExt, 5), tgrid = new Map(), gk = (i, j) => i + ',' + j;
    allT.forEach(c => {
      for (let i = Math.floor(c.tbb.x0 / gsz); i <= Math.floor(c.tbb.x1 / gsz); i++) for (let j = Math.floor(c.tbb.y0 / gsz); j <= Math.floor(c.tbb.y1 / gsz); j++) {
        const k = gk(i, j); if (!tgrid.has(k)) tgrid.set(k, []); tgrid.get(k).push(c);
      }
    });
    const cellAt = (x, y) => (tgrid.get(gk(Math.floor(x / gsz), Math.floor(y / gsz))) || []).find(c => x >= c.tbb.x0 && x <= c.tbb.x1 && y >= c.tbb.y0 && y <= c.tbb.y1 && inside(c.tpoly, [x, y]));

    // seam edges get a wider rib to hold the puzzle joints
    const seamFlags = c => {
      const P2 = c.poly, out = [];
      for (let i = 0; i < P2.length; i++) {
        const a = P2[i], b = P2[(i + 1) % P2.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L; // outward normal (CCW)
        const m = [(a[0] + b[0]) / 2 + nx * 1.5, (a[1] + b[1]) / 2 + ny * 1.5];
        const o = cellAt(m[0], m[1]);
        out.push(o && o.tile !== c.tile ? o : null);
      }
      return out;
    };
    // outline -> opening in the frame, press-fit collar and visible base of the piece
    function shapeCell(c, orig, concave) {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt) { c.poly = simplify(orig, minEdge * (1 + attempt * 1.2), pointRank); c.seam = seamFlags(c); }
        if (c.poly.length < 3) return false;
        // every edge, tile seams too, gets the normal rib: the visible gap stays the same all over the panel.
        // Only where a dovetail sits does the frame widen, locally, into a notch in the collars on both sides (cutNotch)
        const ds = half;
        const opening = inset(c.poly, ds, concave);
        const collar = opening && inset(opening, clr, concave);
        let bodyDs = gap / 2, outEdge = null;
        if (hideRim) {
          // edges on the panel's edge: the body reaches out to the outline (over the outer rail)
          outEdge = c.poly.map((a, i) => {
            const b = c.poly[(i + 1) % c.poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            // no other cell across this edge: it faces the outer frame
            if (edgeDist(m) > 3) return null;
            const q = [m[0] + nx * 0.6, m[1] + ny * 0.6];
            if (inside(region, q) && cells.some(o => o !== c && o.mergedInto !== c && o.kind !== 'merged' && q[0] >= o.bb.x0 && q[0] <= o.bb.x1 && q[1] >= o.bb.y0 && q[1] <= o.bb.y1 && inside(o.poly, q))) return null;
            return edgeDist(m);   // a simplified edge can cut inside the region: reach the outline anyway
          });
          if (outEdge.some(v => v !== null)) bodyDs = outEdge.map(v => v === null ? gap / 2 : -(rim + v)); else outEdge = null;
        }
        const body = inset(c.poly, bodyDs, concave);
        if (opening && collar && body && area(collar) > 12) {
          c.opening = opening; c.collar = collar; c.body = body; c.wrap = null;
          c.outE = outEdge ? outEdge.map(v => v !== null) : null;   // edges on the panel's edge: the skirt holds them up
          if (outEdge) {
            // the skirt: the band of the body outside the outer rail, from the wall up to the body
            // the clipping library can trip on nearly touching edges: retry on a slightly shifted grid
            for (const sh of [0, 0.0007, -0.0013]) {
              try {
                const rg = q => { const r = q.map(v => [Math.round((v[0] + sh) * 1000) / 1000, Math.round((v[1] - sh) * 1000) / 1000]); r.push(r[0]); return r; };
                let g = root.polygonClipping.intersection([rg(body)], [rg(outer), rg(skirtIn).reverse()]);
                g = g.filter(poly => Math.abs(area(poly[0].slice(0, -1))) > 0.5);
                if (g.length) c.wrap = g;
                break;
              } catch (e) { c.wrap = null; }
            }
          }
          // the same small 45° bevel from the frame on every piece. Next to a tile seam the rib is wider than the
          // bevel reaches, so there the piece's underside rests flat on the rib (c.ledge) and the bevel starts
          // from that ledge; before, those pieces got a 3-6 mm tall bevel and sat higher than their neighbours
          c.chamfer = bevel;
          c.ledge = collar.map((q, i) => { const b = body[i], dx = q[0] - b[0], dy = q[1] - b[1], L = Math.hypot(dx, dy); return L <= bevel ? q : [b[0] + dx * bevel / L, b[1] + dy * bevel / L]; });
          return true;
        }
      }
      return false;
    }
    cells.forEach(c => {
      c.seam = seamFlags(c);
      if (c.kind !== 'piece') return;
      const orig = c.poly;
      if (!shapeCell(c, orig)) { c.kind = 'blank'; c.poly = orig; c.seam = seamFlags(c); }
      c.c = centroid(c.kind === 'piece' && c.wrap ? c.body : c.poly);   // an edge piece rises from the middle of its wider base
    });
    if (hideRim) {
      // a cut-off cell on the edge too small for a piece of its own joins the neighbouring piece (same frame tile),
      // so the pieces still reach the panel's edge there and the frame stays hidden
      const keys = ['poly', 'seam', 'opening', 'collar', 'body', 'wrap', 'outE', 'chamfer', 'ledge', 'c'];
      const grow = p => { const cc = centroid(p); return p.map(v => [cc[0] + (v[0] - cc[0]) * 1.002, cc[1] + (v[1] - cc[1]) * 1.002]); };
      const rg = p => { const r = q3(p); r.push(r[0]); return r; };
      for (const b of cells) {
        if (b.kind !== 'blank' || !onEdge(b)) continue;
        const share = new Map();
        for (let i = 0; i < b.poly.length; i++) {
          const a = b.poly[i], e = b.poly[(i + 1) % b.poly.length], L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
          const pt = [(a[0] + e[0]) / 2 + (e[1] - a[1]) / L * 1.0, (a[1] + e[1]) / 2 - (e[0] - a[0]) / L * 1.0];
          const o = cells.find(c => c.kind === 'piece' && c.tile === b.tile && pt[0] >= c.bb.x0 - 1 && pt[0] <= c.bb.x1 + 1 && pt[1] >= c.bb.y0 - 1 && pt[1] <= c.bb.y1 + 1 && inside(c.poly, pt));
          if (o) share.set(o, (share.get(o) || 0) + L);
        }
        const nbs = [...share.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]);
        for (const o of nbs) {
          let mp;
          try {
            const u = root.polygonClipping.union([rg(grow(o.poly))], [rg(grow(b.poly))]);
            if (u.length !== 1) continue;
            mp = simplify(ccw(u[0][0].slice(0, -1)), minEdge);
          } catch (e) { continue; }
          if (mp.length < 3) continue;
          const save = {}; keys.forEach(k => save[k] = o[k]);
          o.poly = mp; o.seam = seamFlags(o);
          b.kind = 'merged'; b.mergedInto = o;
          if (shapeCell(o, mp, true)) {
            o.joinedRim = (o.joinedRim || 0) + 1;
            o.area = area(o.poly); o.bb = bbox(o.poly);
            o.c = centroid(o.wrap ? o.body : o.poly);
            break;
          }
          keys.forEach(k => o[k] = save[k]);
          b.kind = 'blank'; delete b.mergedInto;
        }
      }
    }
    const pieces = cells.filter(c => c.kind === 'piece');
    if (!pieces.length) throw new Error('אין אף תא שגדול מספיק לחלק. הגדל את גודל התא או את הפאנל.');

    // ---- wall-hanging keyholes in the four corners ----
    // The frame stays its normal thickness everywhere. In a corner cell the frame is solid (no opening) and
    // carries the keyhole; the extra height the keyhole needs rises as a hidden boss inside the cell, and the
    // piece above gets a matching pocket hollowed out of its underside, so from outside nothing looks different.
    const hang = Object.assign({ on: true, head: 8.5, shank: 4.5, headH: 3, slot: 9 }, fr.hang || {});
    // levels (z = 0 is the wall side): lip with the narrow slot, then the chamber for the screw head.
    // Above the frame the chamber continues as a hollow inside the piece; a low ring (boss) on the frame
    // around the chamber locates the piece, which presses onto it.
    const lip = Math.min(2.0, t - 0.6), hd = lip + hang.headH + 0.4, zs = hd, tm = hd;
    const bossH = 1.2, pocketLoTop = t + bossH + 0.2, pocketTop = hd + 0.25, pocketRoof = 0.8;
    const mounts = [];
    if (hang.on) {
      const Rc = hang.head / 2 + 0.5, Rw = hang.head / 2 + 0.4, Rn = hang.shank / 2 + 0.3;
      const bwall = 1.0, pwall = 0.9, pc = clr + 0.05, slot = hang.slot;
      const circ = (c, r, n = 28) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(i / n * 2 * Math.PI), c[1] + r * Math.sin(i / n * 2 * Math.PI)]);
      const capsule = (a, b, r) => ccw(convexHull(circ(a, r, 20).concat(circ(b, r, 20))));
      // arms point out to the edges; each arm may be longer than the minimum slide so the screw rest points line up
      const arms = (E, sx, sy, L1 = slot, L2 = slot) => [[E[0] + sx * L1, E[1]], [E[0], E[1] + sy * L2]];
      const outline = (E, sx, sy, r0, r1, L1, L2) => { const [F1, F2] = arms(E, sx, sy, L1, L2); return [ccw(circ(E, r0)), capsule(E, F1, r1), capsule(E, F2, r1)]; };
      const MAXEXTRA = 6;
      const unionRing = parts => {
        const u = root.polygonClipping.union(...parts.map(p => [p.concat([p[0]])]));
        let best = u[0][0]; u.forEach(poly => { if (Math.abs(area(poly[0])) > Math.abs(area(best))) best = poly[0]; });
        // drop near-duplicate and collinear points so the faces triangulate cleanly
        let q = [];
        for (const pt of best.slice(0, -1)) { const l = q[q.length - 1]; if (!l || Math.hypot(pt[0] - l[0], pt[1] - l[1]) > 0.05) q.push(pt); }
        while (q.length > 3 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) <= 0.05) q.pop();
        for (let changed = true, guard = 0; changed && q.length > 3 && guard < 500; guard++) {
          changed = false;
          for (let i = 0; i < q.length; i++) {
            const a = q[(i - 1 + q.length) % q.length], b = q[i], c = q[(i + 1) % q.length];
            if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < 1e-3 * Math.hypot(c[0] - a[0], c[1] - a[1])) { q.splice(i, 1); changed = true; break; }
          }
        }
        return ccw(q);
      };
      const STEP = 1;
      const corners = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
      // for each corner: the few cells nearest to it, each with the grid points where the whole keyhole
      // (plus boss wall, fit clearance and the piece's own wall) fits inside the piece's footprint
      const buildOpts = withPairs => corners.map(([sx, sy]) => {
        const near = pieces.filter(c => sx * c.c[0] > 0 && sy * c.c[1] > 0).sort((a, b) => (sx * b.c[0] + sy * b.c[1]) - (sx * a.c[0] + sy * a.c[1])).slice(0, 30); // pieces in this quarter, outermost first
        // single pieces first; then two neighbouring pieces joined into one, when one alone is too small
        const cand = near.map(c => ({ members: [c], geo: c }));
        if (withPairs) for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
          const A = near[i], B = near[j];
          if (A.tile !== B.tile) continue;
          try {
            const PCl = root.polygonClipping;
            const U = PCl.union([q3(A.tpoly).concat([q3(A.tpoly)[0]])], [q3(B.tpoly).concat([q3(B.tpoly)[0]])]);
            if (U.length !== 1) continue; // not neighbours
            const R = PCl.intersection(U, [region.concat([region[0]])]);
            if (R.length !== 1 || R[0].length !== 1) continue;
            const mp = simplify(ccw(R[0][0].slice(0, -1)), minEdge);
            const geo = { poly: mp, tile: A.tile, kind: 'piece', tpoly: ccw(U[0][0].slice(0, -1)) };
            geo.seam = seamFlags(geo);
            if (!shapeCell(geo, mp, true)) continue;
            geo.c = centroid(geo.poly); geo.tbb = bbox(geo.tpoly);
            cand.push({ members: [A, B], geo });
          } catch (e) { /* skip this pair */ }
        }
        return cand.map(({ members, geo: c }) => {
          const B = baseShape && baseShape.get(c.id);
          if (!B || B.zApex < pocketTop + pocketRoof + 0.5) return null;
          // sections of the unchanged piece that must enclose each level of the hollow (+ its wall)
          const sectionsUpTo = zTop => { const out = [B.collar]; let prevZ = B.z0; for (const l of B.layers) { if (prevZ >= zTop) break; out.push(l.poly); prevZ = l.zLo ?? l.z; } return out; };
          // highest (smallest) sections first, so a misfit is found after few tests
          // the region every one of those sections covers, as one outline per level (fast to test against)
          const common = list => {
            try {
              const r = root.polygonClipping.intersection(...list.map(pl => [q3(pl).concat([q3(pl)[0]])]));
              if (!r.length) return null;
              let bestP = r[0]; r.forEach(pp => { if (Math.abs(area(pp[0])) > Math.abs(area(bestP[0]))) bestP = pp; });
              return [bestP[0].slice(0, -1)];
            } catch (e) { return list.slice().reverse(); }
          };
          const contLo = common(sectionsUpTo(pocketLoTop + 0.3)), contHi = common(sectionsUpTo(pocketTop + pocketRoof));
          if (!contLo || !contHi) return null;
          const gLo = bwall + pc + pwall, gHi = 0.25 + pwall;
          const test = (x, y, conts) => { for (const cp of conts) if (!insideY(cp, x, y)) return false; return true; };
          const circleOk = (P, r, conts) => { for (let a = 0; a < 16; a++) if (!test(P[0] + r * Math.cos(a * Math.PI / 8), P[1] + r * Math.sin(a * Math.PI / 8), conts)) return false; return true; };
          // arm k (1 = sideways, 2 = up/down) of length L fits at both levels of the hollow
          const armOk = (E, k, L, from = 0) => {
            const F = k === 1 ? [E[0] + sx * L, E[1]] : [E[0], E[1] + sy * L];
            for (const [g, conts] of [[gHi, contHi], [gLo, contLo]]) {
              const r = Rw + g;
              if (!circleOk(F, r, conts)) return false;
              for (let d = Math.max(2, from); d < L; d += 2) {
                const mx = E[0] + (F[0] - E[0]) * d / L, my = E[1] + (F[1] - E[1]) * d / L;
                for (let sg = -1; sg <= 1; sg += 2) if (!(k === 1 ? test(mx, my + sg * r, conts) : test(mx + sg * r, my, conts))) return false;
              }
            }
            return true;
          };
          // the candidates are the screw rest points (arm tips): x of the sideways tip, y of the vertical tip
          const off = [sx * slot / 3, sy * slot / 3];
          const costE = E => Math.hypot(E[0] + off[0] - c.c[0], E[1] + off[1] - c.c[1]);
          // quick limits: the highest section that must hold the chamber bounds where the keyhole can go
          const top = bbox(contHi[0]), need = slot + 2 * (Rw + gHi);
          if (top.w < need || top.h < need) return null;
          const rE = Rc + gHi;
          const bb = { x0: top.x0 + rE, x1: top.x1 - rE, y0: top.y0 + rE, y1: top.y1 - rE };
          const pts = new Set(), rows = new Map(), cols = new Map(), best = new Map();
          // entry points and rest points on a 1 mm grid
          const ES = 1;
          for (let ix = ES * Math.ceil(bb.x0 / ES); ix <= bb.x1; ix += ES) for (let iy = ES * Math.ceil(bb.y0 / ES); iy <= bb.y1; iy += ES) {
            const E = [ix, iy];
            if (!circleOk(E, Rc + gHi, contHi) || !circleOk(E, Rc + gLo, contLo)) continue;
            let m1 = -1, m2 = -1;
            for (let e = 0; e <= MAXEXTRA && armOk(E, 1, slot + e, e ? slot + e - 2 : 0); e++) m1 = e;
            if (m1 < 0) continue;
            for (let e = 0; e <= MAXEXTRA && armOk(E, 2, slot + e, e ? slot + e - 2 : 0); e++) m2 = e;
            if (m2 < 0) continue;
            const ce = costE(E);
            for (let e1 = 0; e1 <= m1; e1++) for (let e2 = 0; e2 <= m2; e2++) {
              const tx = ix + sx * (slot + e1), ty = iy + sy * (slot + e2), key = tx + ',' + ty;
              const sc = ce + 0.3 * (e1 + e2); // prefer the shortest slide
              const old = best.get(key);
              if (!old || sc < old.sc) {
                if (!old) { pts.add(key); if (!rows.has(ty)) rows.set(ty, []); rows.get(ty).push(tx); if (!cols.has(tx)) cols.set(tx, []); cols.get(tx).push(ty); }
                best.set(key, { sc, E, L1: slot + e1, L2: slot + e2 });
              }
            }
          }
          const cost = (tx, ty) => best.get(tx + ',' + ty).sc;
          return pts.size ? { c, members, pts, rows, cols, cost, best } : null;
        }).filter(Boolean);
      });
      // choose one cell per corner and put the four keyholes on a true rectangle (aligned with each other),
      // as close to the middle of their pieces as possible
      // pick one piece per corner and a true rectangle through all four keyholes: as wide and tall as possible
      // (the panel hangs steadier), with each keyhole as central as possible under its piece
      const SPREAD = 1.5;
      const search = opts => {
        if (!opts.every(o => o.length)) return null;
        // the four corners use pieces from four different quarters, so each corner's candidates can be pooled:
        // every rest-point pair keeps the piece where it is cheapest
        const pool = opts.map(o => {
          const pts = new Map(), rows = new Map(), cols = new Map();
          for (const op of o) for (const key of op.pts) {
            const [x, y] = key.split(',').map(Number), sc = op.cost(x, y), old = pts.get(key);
            if (!old) { if (!rows.has(y)) rows.set(y, []); rows.get(y).push(x); if (!cols.has(x)) cols.set(x, []); cols.get(x).push(y); }
            if (!old || sc < old.sc) pts.set(key, { sc, op });
          }
          return { pts, rows, cols };
        });
        const [TL, TR, BL, BR] = pool;
        let sol = null;
        for (const [key, a] of TL.pts) {
          const [xl, yt] = key.split(',').map(Number);
          const rowR = TR.rows.get(yt); if (!rowR) continue;
          const colB = BL.cols.get(xl); if (!colB) continue;
          for (const xr of rowR) {
            if (xr <= xl) continue;
            const b = TR.pts.get(xr + ',' + yt);
            for (const yb of colB) {
              if (yb >= yt) continue;
              const d = BR.pts.get(xr + ',' + yb); if (!d) continue;
              const c3 = BL.pts.get(xl + ',' + yb);
              const sc = a.sc + b.sc + c3.sc + d.sc - SPREAD * STEP * ((xr - xl) + (yt - yb));
              if (!sol || sc < sol.score) sol = { score: sc, picks: [[a.op, xl, yt], [b.op, xr, yt], [c3.op, xl, yb], [d.op, xr, yb]] };
            }
          }
        }
        return sol;
      };
      // pieces are never joined: the keyholes move inward to pieces that are big enough to hide the boss
      let opts = buildOpts(false), sol = search(opts);
      let picks = sol ? sol.picks : null;
      if (!picks) {
        // no aligned set exists: place each corner on its own, as central as possible
        const usedC = new Set();
        picks = opts.map(o => {
          for (const op of o) {
            if (op.members.some(m => usedC.has(m))) continue;
            let best = null;
            for (const key of op.pts) { const [x, y] = key.split(',').map(Number); const s2 = op.cost(x, y); if (!best || s2 < best[0]) best = [s2, x, y]; }
            if (best) { op.members.forEach(m => usedC.add(m)); return [op, best[1], best[2]]; }
          }
          return null;
        });
        if (picks.some(Boolean)) warnings.push({ kind: 'warn', text: 'אין בעיצוב הזה ארבעה חלקים שבהם החורים יוצאים מיושרים, אז כל חור מוקם בנפרד. הפאנל עדיין ייתלה ישר אם קודחים בדיוק לפי הצלבים במפה. כדי לקבל חורים מיושרים: מסגרת עבה יותר, ראש בורג דק יותר, או "גובה מינימלי" גבוה יותר.' });
      }
      picks.forEach((p, i) => {
        if (!p) { warnings.push({ kind: 'warn', text: 'לא נמצא באחת הפינות חלק שיכול להסתיר את חור התלייה בלי לשנות את צורתו. מה שעוזר: תאים גדולים יותר, "גובה מינימלי" גבוה יותר, מסגרת עבה יותר, או ראש בורג דק או קטן יותר.' }); return; }
        const [op, ix, iy] = p, [sx, sy] = corners[i];
        let c = op.c;
        if (op.members.length > 1) {
          // join the two pieces: the first takes the joined outline, the second disappears
          const [A, B] = op.members;
          Object.assign(A, { poly: c.poly, seam: c.seam, opening: c.opening, collar: c.collar, body: c.body, wrap: c.wrap, outE: c.outE, chamfer: c.chamfer, ledge: c.ledge, tpoly: c.tpoly, tbb: c.tbb, c: c.c, joined: B.id });
          B.kind = 'merged'; B.mergedInto = A;
          pieces.splice(pieces.indexOf(B), 1);
          c = A;
        }
        const pick = op.best.get(ix + ',' + iy), E = pick.E, L1 = pick.L1, L2 = pick.L2;
        const [F1, F2] = arms(E, sx, sy, L1, L2);
        const boss = unionRing(outline(E, sx, sy, Rc + bwall, Rw + bwall, L1, L2));
        c.mount = true;
        c.pocketLo = unionRing(outline(E, sx, sy, Rc + bwall + pc, Rw + bwall + pc, L1, L2)); c.pocketLoTop = pocketLoTop; // fits over the boss ring
        c.pocket = unionRing(outline(E, sx, sy, Rc + 0.25, Rw + 0.25, L1, L2)); c.pocketTop = pocketTop;                   // room for the screw head
        mounts.push({ cells: [c], E, F1, F2, sx, sy, tile: c.tile, boss, C: ccw(circ(E, Rc)), N: [capsule(E, F1, Rn), capsule(E, F2, Rn)], W: [capsule(E, F1, Rw), capsule(E, F2, Rw)] });
      });
    }

    // seams that pointed at a piece that was joined into another now point at the joined piece
    cells.forEach(c => { if (c.seam) c.seam = c.seam.map(o => (o && o.mergedInto) || o); });
    // Tile seams are held by clamps: small U-shaped parts printed on their own. At each clamp the seam's frame
    // widens into a short core (both tiles' halves, cg from the seam), the core's top is lowered by the clamp's roof,
    // and its two sides are open slots for the clamp's legs. The pieces beside it get a notch for the legs.
    // The frame keeps the nominal size; all the play is taken off the clamp (fr.clampClr), so only the clamp
    // changes when the printer needs more or less room.
    const clamps = [];
    const jc = fr.jointClr ?? 0.2, CS = clampSpec(fr);
    const { Lc, cD } = CS, cMargin = 1.0;
    const cellIdx = new Map(cells.map((c, i) => [c, i]));
    const openList = pieces.map(c => ({ c, ring: [q3(c.opening).concat([q3(c.opening)[0]])], bb: bbox(c.opening) }));
    // rectangle along the seam: |s| <= hu along u, n0..n1 across it
    const rectAt = (m, u, n, hu, n0, n1) => ccw([[-hu, n0], [hu, n0], [hu, n1], [-hu, n1]].map(([s, d]) => [m[0] + u[0] * s + n[0] * d, m[1] + u[1] * s + n[1] * d]));
    // the clamp and the solid frame round it must stay clear of every other cell's opening
    const clampFits = (m, u, n, c, o) => {
      const big = rectAt(m, u, n, Lc / 2 + cMargin, -(cD + cMargin), cD + cMargin);
      const bb = bbox(big), r = [big.concat([big[0]])];
      for (const op of openList) {
        if (op.c === c || op.c === o) continue;
        if (op.bb.x0 > bb.x1 || op.bb.x1 < bb.x0 || op.bb.y0 > bb.y1 || op.bb.y1 < bb.y0) continue;
        let hit; try { hit = root.polygonClipping.intersection(r, op.ring); } catch (e) { return false; }
        if (hit.some(poly => Math.abs(area(poly[0].slice(0, -1))) > 0.01)) return false;
      }
      // nor run into another clamp
      const reach = 2 * Math.hypot(Lc / 2 + cMargin, cD + cMargin);
      return !clamps.some(k => Math.hypot(k.m[0] - m[0], k.m[1] - m[1]) < reach);
    };
    // the notch a clamp at m needs in cell X: a rectangle W wide, from the seam D deep into X; null when X needs
    // none (no opening there, or the rib already reaches), false when it does not fit. It must leave a printable
    // wall between itself and the rest of the collar, and not touch X's other notches
    // (the frame fills it out to D; the piece's collar makes room out to Dc, for the clamp's leg)
    const notchFor = (X, m, u, D, W, Dc) => {
      if (X.kind !== 'piece' || !X.opening || X.mount) return null;
      if (D <= half + 0.05) return null;
      const P = X.poly, n = P.length;
      let k = -1, bestD = 0.6;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-9) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        if (Math.abs(ux * u[0] + uy * u[1]) < 0.985) continue;
        const t = (m[0] - a[0]) * ux + (m[1] - a[1]) * uy, d = Math.abs((m[0] - a[0]) * -uy + (m[1] - a[1]) * ux);
        if (t < 0 || t > L || d >= bestD) continue;
        bestD = d; k = i;
      }
      if (k < 0) return false;
      const a = P[k], b = P[(k + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), uk = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nIn = [-uk[1], uk[0]];
      const sm = (m[0] - a[0]) * uk[0] + (m[1] - a[1]) * uk[1];
      const sp = { o: a, uk, nIn, s1: sm - W / 2, s2: sm + W / 2, D, Dc: Dc ?? D };
      const list = (notchesOf.get(X) || []).concat([sp]);
      const test = notchCut(X, list, clr);
      if (!test || !simpleCCW(test.collarN) || area(test.collarN) < 12) return false;
      // a printable wall between the notch and every part of the collar it does not cut into
      const run = notchRun(X.collar, sp, sp.s1 - clr, sp.s2 + clr, sp.Dc + clr), C = X.collar, nc = C.length;
      const cutE = new Set(); for (let i = run.ka; ; i = (i + 1) % nc) { cutE.add(i); if (i === run.kb) break; }
      const segs = [];
      for (let i = 0; i < nc; i++) if (!cutE.has(i)) segs.push([C[i], C[(i + 1) % nc]]);
      test.notch.forEach((nt, j) => { if (j < list.length - 1) { const q = [nt.a, ...nt.inner, nt.b]; for (let i = 0; i + 1 < q.length; i++) segs.push([q[i], q[i + 1]]); } });
      for (const q of run.inner) for (const [p1, p2] of segs) {
        const ex = p2[0] - p1[0], ey = p2[1] - p1[1], l2 = ex * ex + ey * ey || 1, tt = Math.max(0, Math.min(1, ((q[0] - p1[0]) * ex + (q[1] - p1[1]) * ey) / l2));
        if (Math.hypot(q[0] - p1[0] - ex * tt, q[1] - p1[1] - ey * tt) < 1.2) return false;
      }
      return sp;
    };
    const notchesOf = new Map();
    // seam edges, grouped by the pair of tiles they join
    const allSeam = new Map();
    cells.forEach(c => c.kind !== 'merged' && c.seam.forEach((o, i) => {
      if (!o) return;
      // each shared edge is seen from both cells: handle it only from the lower-numbered cell
      if (cellIdx.get(c) > cellIdx.get(o)) return;
      const a = c.poly[i], b = c.poly[(i + 1) % c.poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const key = [c.tile, o.tile].sort().join('|');
      if (!allSeam.has(key)) allSeam.set(key, []);
      allSeam.get(key).push({ c, o, a, b, L });
    }));
    // try to put a clamp on edge a-b (c's edge, o across it) at one of the places fs along the edge (0..1)
    const tryPlace = (c, o, a, b, L, fs) => {
      if (c.mount || o.mount || !c.tpoly || !o.tpoly) return false;   // a hanging cell is solid frame round the keyhole
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [u[1], -u[0]];
      for (const f of fs) {
        // the clamp must stay on this edge with room to spare at both ends
        if (Math.min(f, 1 - f) * L < Lc / 2 + cMargin) continue;
        const m = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        if (!clampFits(m, u, n, c, o)) continue;
        const nC = notchFor(c, m, u, CS.cg, Lc, cD), nO = notchFor(o, m, u, CS.cg, Lc, cD);
        if (nC === false || nO === false) continue;
        for (const [X, nt] of [[c, nC], [o, nO]]) if (nt) { if (!notchesOf.has(X)) notchesOf.set(X, []); notchesOf.get(X).push(nt); }
        clamps.push({ tiles: [c.tile, o.tile], m, u, n });
        return true;
      }
      return false;
    };
    const FS = [0, -0.04, 0.04, -0.08, 0.08, -0.12, 0.12, -0.16, 0.16, -0.22, 0.22, -0.3, 0.3].map(d => 0.5 + d);
    const every = Math.max(10, fr.clampEvery ?? 40);
    for (const [key, list] of allSeam) {
      // order the edges along the seam, so the clamps are evenly spaced: one every `every` mm of seam
      const xs = list.map(e => e.a[0] + e.b[0]), ys = list.map(e => e.a[1] + e.b[1]);
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
      list.sort((p, q) => alongX ? (p.a[0] + p.b[0]) - (q.a[0] + q.b[0]) : (p.a[1] + p.b[1]) - (q.a[1] + q.b[1]));
      let acc = 0.5;   // half a share to start, so the first clamp sits about half a spacing in
      for (const { c, o, a, b, L } of list) {
        acc += L / every;
        // a long edge can take more than one clamp, each in its own share of the edge
        const k = Math.min(Math.floor(acc), Math.floor(L / (Lc + 2 * cD + 4)));
        if (k < 1) continue;
        let put = 0;
        for (let j = 0; j < k; j++) {
          const f0 = (j + 0.5) / k, sp = 0.5 / k;
          if (tryPlace(c, o, a, b, L, FS.map(f => f0 + (f - 0.5) * sp / 0.5 * (k > 1 ? 0.6 : 1)))) put++;
        }
        // a clamp that does not fit here moves on to the next edge (its share stays in acc)
        acc -= put;
      }
    }
    // a pair of tiles still without a clamp: try every edge they share, all along the edge
    const FS2 = []; for (let f = 0.5, k = 0; k < 41; k++) { const d = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.02; if (Math.abs(d) <= 0.4) FS2.push(f + d); }
    let skippedKnobs = 0;
    for (const [key, list] of allSeam) {
      if (clamps.some(k => k.tiles.slice().sort().join('|') === key)) continue;
      let ok = false;
      for (const { c, o, a, b, L } of list.slice().sort((p, q) => q.L - p.L)) { if (tryPlace(c, o, a, b, L, FS2)) { ok = true; break; } }
      if (!ok) skippedKnobs++;
    }
    // the frame around each clamp: R (whole clamp, lowered to the core's top) and the two leg slots
    clamps.forEach((k, i) => {
      k.id = i + 1;
      k.R = rectAt(k.m, k.u, k.n, Lc / 2 + 0.05, -cD, cD);   // a hair longer than the core: no edges lie on top of each other
      k.slots = [rectAt(k.m, k.u, k.n, Lc / 2, CS.cg, cD + 0.5), rectAt(k.m, k.u, k.n, Lc / 2, -cD - 0.5, -CS.cg)];
    });
    // put the notches into the pieces beside each tab
    for (const [X, list] of notchesOf) {
      const r = notchCut(X, list, clr);
      X.opening = r.opening; X.collar = r.collar; X.body = r.body; if (r.outE) X.outE = r.outE; X.notch = r.notch;
      X.ledge = X.collar.map((q, i) => { const b = X.body[i], dx = q[0] - b[0], dy = q[1] - b[1], L = Math.hypot(dx, dy); return L <= bevel ? q : [b[0] + dx * bevel / L, b[1] + dy * bevel / L]; });
    }
    const PC = root.polygonClipping;
    if (!PC) throw new Error('polygon-clipping not loaded');
    const ringOf = p => { const r = q3(p); r.push(r[0]); return r; };
    const holesG = pieces.map(c => [ringOf(c.opening)]);
    // hidden outer frame: the frame stops short of the skirts, but reaches the outline where no piece covers the edge
    let frameClip = [ringOf(outer)];
    if (hideRim) {
      // room for each skirt plus its clearance; the frame keeps everything else, out to the outline
      const zones = pieces.filter(c => c.wrap).map(c => [ringOf(inset(c.body, -skClr, true) || c.body)]);
      try { frameClip = PC.difference([ringOf(outer)], PC.difference(PC.union(...zones), [ringOf(frameOuter)])); }
      catch (e) { frameClip = [ringOf(frameOuter)]; }
    }
    const myClamps = id => clamps.filter(k => k.tiles.includes(id));
    const tiles = []; let islandTiles = 0; const islandPolys = [];
    for (let id = 0; id < P.nx * P.ny; id++) {
      const mine = allT.filter(c => c.tile === id);
      if (!mine.length) continue;
      let g;
      try {
        // cells grow ~0.1 mm so rounding slits between neighbours close up
        const grow = c => { const cc = centroid(c.tpoly), k = 1 + 0.1 / Math.max(2, Math.min(c.tbb.w, c.tbb.h) / 2); return c.tpoly.map(v => [cc[0] + (v[0] - cc[0]) * k, cc[1] + (v[1] - cc[1]) * k]); };
        g = PC.union(...mine.map(c => [ringOf(grow(c))]));
        g = g.map(poly => [poly[0]]); // close hairline gaps between neighbouring cells
        // tile seams: each tile stays jointClr/2 back from the cells of the tiles next to it, so two tiles meet
        // with the same play as their dovetails (the growth above used to make them overlap along the seam)
        const tb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        mine.forEach(c => { tb.x0 = Math.min(tb.x0, c.tbb.x0); tb.y0 = Math.min(tb.y0, c.tbb.y0); tb.x1 = Math.max(tb.x1, c.tbb.x1); tb.y1 = Math.max(tb.y1, c.tbb.y1); });
        const nbT = allT.filter(c => c.tile !== id && c.tbb.x0 <= tb.x1 + 1 && c.tbb.x1 >= tb.x0 - 1 && c.tbb.y0 <= tb.y1 + 1 && c.tbb.y1 >= tb.y0 - 1);
        if (nbT.length && jc > 0) g = PC.difference(g, PC.union(...nbT.map(c => [ringOf(inset(c.tpoly, -jc / 2, true) || c.tpoly)])));
        g = PC.intersection(g, frameClip);
        // through the frame: the openings and the slots for the legs of this tile's clamps
        const cut = myClamps(id).flatMap(k => k.slots.map(r => [ringOf(r)])).concat(holesG);
        g = PC.difference(g, ...cut);
      } catch (e) { throw new Error('חישוב המסגרת נכשל: ' + e.message); }
      {
        // a tile must be one connected piece: drop loose slivers instead of printing them
        const areas = g.map(poly => Math.abs(area(poly[0].slice(0, -1))));
        const big = Math.max(0, ...areas);
        const keep = g.filter((poly, i) => areas[i] > Math.max(4, big * 0.05));
        if (g.some((poly, i) => areas[i] > 0.5 && !keep.includes(poly))) { islandTiles++; g.forEach((poly, i) => { if (!keep.includes(poly)) islandPolys.push({ tile: id, ring: poly[0], area: areas[i] }); }); }
        g = keep;
      }
      if (!g.length) continue;
      let slabs = null;
      const myMounts = mounts.filter(mt => mt.tile === id);
      if (myMounts.length) {
        try {
          const ring = p => [ringOf(p)];
          // the corner cell's opening is filled: the frame is solid there and holds the keyhole
          const FB = PC.union(g, ...myMounts.flatMap(mt => mt.cells.map(c => ring(c.opening))));
          const boss = PC.union(...myMounts.map(mt => ring(mt.boss)));
          const vN = PC.union(...myMounts.flatMap(mt => [ring(mt.C), ...mt.N.map(ring)]));
          const vW = PC.union(...myMounts.flatMap(mt => [ring(mt.C), ...mt.W.map(ring)]));
          const clean = G => G.filter(poly => Math.abs(area(poly[0].slice(0, -1))) > 1);
          slabs = [
            { z0: 0, z1: lip, g: clean(PC.difference(FB, vN)) },          // narrow slot: the screw shank slides here
            { z0: lip, z1: t, g: clean(PC.difference(FB, vW)) },          // wide pocket: the screw head sits behind the lip
            { z0: t, z1: t + bossH, g: clean(PC.difference(boss, vW)) }   // low ring hidden inside the piece above
          ];
          g = FB;
        } catch (e) { warnings.push({ kind: 'warn', text: 'חישוב חור התלייה נכשל באריח אחד: ' + e.message }); slabs = null; }
      }
      // the clamps' roofs sit in a recess on top of the frame: the core between the legs is lower by the roof
      const cl = myClamps(id);
      if (cl.length) {
        try {
          const zr = CS.zr, Rg = PC.union(...cl.map(k => [ringOf(k.R)]));
          const clean = G => G.filter(poly => Math.abs(area(poly[0].slice(0, -1))) > 0.05);
          const base = slabs || [{ z0: 0, z1: t, g }], out = [];
          for (const sl of base) {
            if (sl.z1 <= zr + 1e-9 || sl.z0 >= t - 1e-9) { out.push(sl); continue; }
            if (sl.z0 < zr - 1e-9) out.push({ z0: sl.z0, z1: zr, g: sl.g });
            out.push({ z0: Math.max(sl.z0, zr), z1: sl.z1, g: clean(PC.difference(sl.g, Rg)) });
          }
          slabs = out;
        } catch (e) { warnings.push({ kind: 'warn', text: 'חישוב שקע החבק נכשל באריח אחד: ' + e.message }); }
      }
      const pts = []; g.forEach(poly => poly[0].forEach(q => pts.push(q)));
      const iy = Math.floor(id / P.nx), ix = id % P.nx;
      const tl = { id, label: `${iy + 1}-${ix + 1}`, geom: g, slabs, bb: bbox(pts), cells: mine.filter(c => c.poly).length, mounts: myMounts.length };
      if (!fitsBed(tl.bb.w, tl.bb.h)) warnings.push({ kind: 'warn', text: `אריח מסגרת ${tl.label} גדול ממשטח ההדפסה (${tl.bb.w.toFixed(0)}×${tl.bb.h.toFixed(0)} מ"מ).` });
      tiles.push(tl);
    }
    const usedTiles = tiles;

    // heights, lean and piece shape
    const mv = st.move, sf = st.surface, ps = Object.assign({ curve: 0, twist: 0, spiral: 0, profile: 1, layers: 10, smooth: 0, truncate: 0, dome: 0, cutTilt: 0, cutBy: 'field', cutAngle: 0, cutVary: 0 }, st.piece || {});
    // finer outline so the facets can melt into a round section higher up
    if (ps.smooth > 0) pieces.forEach(c => {
      const q = Math.max(1, Math.ceil(36 / c.body.length));
      c.body = subdivide(c.body, q); c.collar = subdivide(c.collar, q); if (c.ledge) c.ledge = subdivide(c.ledge, q);
      if (c.outE) c.outE = c.outE.flatMap(f => new Array(q).fill(f));
    });
    let fmax = 0;
    pieces.forEach(c => {
      c.s = surfaceAt(sf, st.shape, c.c[0], c.c[1]);
      c.f = fieldAt(mv.points, c.c[0], c.c[1]);
      c.fm = Math.hypot(c.f[0], c.f[1]); fmax = Math.max(fmax, c.fm);
      const md = modsAt(mv.points, c.c[0], c.c[1]);
      c.shape = { curve: Math.max(-0.6, Math.min(1.5, ps.curve + md.curve)), twist: ps.twist * Math.PI / 180, spiral: (ps.spiral + md.spiral) * Math.PI / 180, profile: ps.profile, layers: Math.max(2, Math.round(ps.layers)), smooth: ps.smooth, truncate: ps.truncate, dome: ps.dome, cutTilt: 0, cutDir: [1, 0] };
      c.cutAdd = md.cut;
    });
    // angle of the truncation cut: 0 = parallel to the wall; the cut face turns toward a direction
    // given by the lean field, the centre, a spiral, the slope of the surface, or a fixed heading
    if ((ps.truncate || 0) > 0 && (ps.cutOn ?? (ps.cutTilt > 0))) {
      const by = ps.cutBy || 'field', off = (ps.cutAngle || 0) * Math.PI / 180, vary = Math.max(0, Math.min(1, ps.cutVary || 0));
      const W2 = Math.max(1, st.shape.w / 2), H2 = Math.max(1, st.shape.h / 2);
      let gmax = 0;
      pieces.forEach(c => {
        const x = c.c[0], y = c.c[1], rr = Math.min(1, Math.hypot(x / W2, y / H2));
        let a = 0, s = 1;
        if (by === 'field') { a = c.fm > 1e-9 ? Math.atan2(c.f[1], c.f[0]) : 0; s = c.fm; }
        else if (by === 'radial') { a = Math.atan2(y, x); s = rr; }
        else if (by === 'spiral') { a = Math.atan2(y, x) + Math.PI / 2 + 2 * Math.PI * rr; s = rr; }
        else if (by === 'surface') {
          const e = 1, gx = (surfaceAt(sf, st.shape, x + e, y) - surfaceAt(sf, st.shape, x - e, y)) / (2 * e), gy = (surfaceAt(sf, st.shape, x, y + e) - surfaceAt(sf, st.shape, x, y - e)) / (2 * e);
          s = Math.hypot(gx, gy); a = s > 1e-12 ? Math.atan2(-gy, -gx) : 0; gmax = Math.max(gmax, s);
        }
        c.cutRaw = [a, s];
      });
      pieces.forEach(c => {
        let [a, s] = c.cutRaw;
        if (by === 'field') s = s / Math.max(1e-6, fmax); else if (by === 'surface') s = s / Math.max(1e-12, gmax); else if (by === 'fixed') s = 1;
        const deg = Math.max(-75, Math.min(75, ((ps.cutTilt || 0) + (c.cutAdd || 0)) * ((1 - vary) + vary * s)));
        c.shape.cutTilt = deg * Math.PI / 180; c.shape.cutDir = [Math.cos(a + off), Math.sin(a + off)];
        delete c.cutRaw;
      });
    }
    const maxOv = (pr.overhang ?? 45) * Math.PI / 180;
    pieces.forEach(c => {
      // a little steeper than the limit, so the bevel's uneven corners stay under it too
      c.bv = { t, tan: Math.tan(Math.max(0.2, maxOv - 3 * Math.PI / 180)), out: c.outE || null };
      splitBase(c);
      let h = sf.minH + sf.depth * c.s;
      if (mv.pull) h *= (1 + mv.pull * (c.fm / Math.max(1e-6, fmax) - 0.5));
      c.zr = 0; c.h = h; c.skirt = 0;
      c.hb = Math.max(2, h);
      c.z0 = t + c.chamfer;
      c.lean = [c.f[0] * mv.lean * c.hb, c.f[1] * mv.lean * c.hb];
      c.scale = 1;
      setApex(c);
    });
    const cellSize = Math.max(maxExt, 1);
    const grid = new Map();
    const key = (i, j) => i + ',' + j;
    pieces.forEach(c => { const k = key(Math.floor(c.c[0] / cellSize), Math.floor(c.c[1] / cellSize)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); });
    pieces.forEach(c => {
      const gi = Math.floor(c.c[0] / cellSize), gj = Math.floor(c.c[1] / cellSize);
      c.nb = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) (grid.get(key(gi + i, gj + j)) || []).forEach(o => { if (o !== c) c.nb.push(o); });
    });
    // hidden outer frame: no piece may lean or bulge out past the panel's edge, or the edge line breaks there
    const lineOut = hideRim ? (inset(outer, -0.05) || outer) : null;
    const pokesOut = c => !!lineOut && (!inside(lineOut, c.apex) || c.layers.some(l => l.poly.some(q => !inside(lineOut, q))));
    for (let pass = 0; pass < 3; pass++) {
      for (const c of pieces) {
        let guard = 0;
        while (guard++ < 12 && (overhangBad(c, maxOv) || collides(c, gap) || pokesOut(c))) {
          c.scale = Math.max(0, c.scale - 0.1);
          if (c.scale === 0 && c.shape.twist) c.shape.twist *= 0.5;
          setApex(c);
          if (c.scale === 0 && Math.abs(c.shape.twist) < 0.05) break;
        }
      }
    }
    // hidden outer frame: the outer sloped faces of an edge piece carry on down, in the same plane, toward the wall.
    // They all stop at one line around the panel: the outline pushed out by the shortest reach of any face, so the
    // edge stays one clean line; a face that would reach further is cut upright there and drops straight to the wall
    if (hideRim) {
      const shiftFor = (B, out) => d => B.map((v, i) => {
        const n = B.length, ip = (i - 1 + n) % n, a = B[ip], b2 = B[(i + 1) % n];
        const e1 = [v[0] - a[0], v[1] - a[1]], e2 = [b2[0] - v[0], b2[1] - v[1]];
        const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
        const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2];   // outward normals of the edge before / after
        const d1 = out[ip] ? d[ip] : 0, d2 = out[i] ? d[i] : 0;
        if (!d1 && !d2) return v.slice();
        const cr = n1[0] * n2[1] - n1[1] * n2[0];
        if (Math.abs(cr) < 0.05) { const k = (d1 + d2) / 2; return [v[0] + (n1[0] + n2[0]) / 2 * k, v[1] + (n1[1] + n2[1]) / 2 * k]; }
        return [v[0] + (d1 * n2[1] - d2 * n1[1]) / cr, v[1] + (n1[0] * d2 - n2[0] * d1) / cr];   // p·n1 = v·n1 + d1, p·n2 = v·n2 + d2
      });
      const info = [];
      let dmin = Infinity;
      pieces.forEach(c => {
        c.flare = null;
        const L1 = c.layers && c.layers[0];
        if (!c.wrap || !L1) return;
        const R1 = L1.raw || L1, B = c.body, n = B.length, zl = i => R1.zv ? R1.zv[i] : R1.z;
        const reach = new Array(n).fill(null), out = new Array(n).fill(false);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, P = B[i], Q = B[j], L = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1;
          const nx = (Q[1] - P[1]) / L, ny = -(Q[0] - P[0]) / L, m = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
          if (inside(outer, [m[0] + nx * 0.8, m[1] + ny * 0.8]) || inside(skirtIn, m)) continue;
          out[i] = true;
          const p1 = R1.poly[i], q1 = R1.poly[j];
          const h = ((P[0] - p1[0]) * nx + (P[1] - p1[1]) * ny + (Q[0] - q1[0]) * nx + (Q[1] - q1[1]) * ny) / 2, dz = (zl(i) + zl(j)) / 2 - c.z0;
          // only faces that slope inward going up have a reach; an upright or outward-leaning face gets a plain chamfer to the line
          if (h > 0.01 && dz > 0.01) { reach[i] = Math.min(c.z0 * h / dz, 4 * c.z0); if (L > 1) dmin = Math.min(dmin, reach[i]); }
        }
        if (out.some(Boolean)) info.push({ c, out, reach });
      });
      if (info.length && isFinite(dmin)) {
        dmin = Math.max(0.3, dmin);
        const edgeLine = inset(outer, -dmin) || outer;
        // distance along a ray from a point inside a convex outline to where it leaves it
        const rayExit = (poly, p, u) => {
          let best = null;
          for (let k = 0; k < poly.length; k++) {
            const a = poly[k], b = poly[(k + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1];
            const den = u[0] * ey - u[1] * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den, w = ((a[0] - p[0]) * u[1] - (a[1] - p[1]) * u[0]) / den;
            if (t > 0 && w >= -1e-9 && w <= 1 + 1e-9 && (best === null || t < best)) best = t;
          }
          return best;
        };
        info.forEach(({ c, out, reach }) => {
          const B = c.body, shift = shiftFor(B, out), zt = c.z0 - 0.01;
          const Bn = shift(reach.map(r => r === null ? dmin : Math.max(r, dmin))), Bc = shift(out.map(() => dmin)), Ci = shift(out.map(() => -0.3));
          // the body's outer edges sit only roughly on the outline, so slide each moved vertex along its own path
          // until it lands exactly on the one edge line (also at the panel's corners)
          Bc.forEach((q, i) => {
            const v = B[i], ux = q[0] - v[0], uy = q[1] - v[1], L = Math.hypot(ux, uy);
            if (L < 1e-6) return;
            const hit = rayExit(edgeLine, v, [ux / L, uy / L]);
            if (hit !== null && hit < L + 3 * c.z0) { Bc[i] = [v[0] + ux / L * hit, v[1] + uy / L * hit]; }
          });
          if (Bc.some((q, i) => Math.hypot(q[0] - B[i][0], q[1] - B[i][1]) > 6 * c.z0)) return;   // a very sharp corner: keep the plain skirt
          // height where each vertex's sloped edge meets the line; below it the piece drops upright to the wall
          const zc = B.map((v, i) => { const ln = Math.hypot(Bn[i][0] - v[0], Bn[i][1] - v[1]), lc = Math.hypot(Bc[i][0] - v[0], Bc[i][1] - v[1]); return ln < 1e-6 ? 0.2 : Math.min(zt - 0.2, Math.max(0.2, zt * (1 - lc / ln))); });
          c.flare = { out, B: Bc, C: Ci, zc };
          for (const q of Bc) { if (q[0] < c.fp.x0) c.fp.x0 = q[0]; if (q[0] > c.fp.x1) c.fp.x1 = q[0]; if (q[1] < c.fp.y0) c.fp.y0 = q[1]; if (q[1] > c.fp.y1) c.fp.y1 = q[1]; }
          c.fp.w = c.fp.x1 - c.fp.x0; c.fp.h = c.fp.y1 - c.fp.y0;
        });
      }
    }
    const shortened = pieces.filter(c => c.scale < 0.999).length;
    if (islandTiles) warnings.push({ kind: 'warn', text: `ב-${islandTiles} אריחים נשארו שאריות מסגרת קטנות ומנותקות, והן הוסרו. כדאי להגדיל את "רוחב צלע".` });
    {
      // every pair of tiles that share a real stretch of seam needs at least one clamp (two tiles that only touch
      // at a corner, over a few mm, are held through their other neighbours)
      const pairs = new Map();
      for (const [key, list] of allSeam) if (list.reduce((sum, e) => sum + e.L, 0) >= Lc + 2 * cMargin + 2) pairs.set(key, 0);
      clamps.forEach(k => { const key = k.tiles.slice().sort().join('|'); if (pairs.has(key)) pairs.set(key, pairs.get(key) + 1); });
      const bare = [...pairs.values()].filter(v => v === 0).length;
      if (bare) warnings.push({ kind: 'warn', text: `${bare} חיבורים בין אריחים נשארו בלי חבק, כי לא היה מקום בטוח לשים אותו. אפשר לקצר את "אורך החבק" או להגדיל את גודל התא.` });
    }
    if (hideRim) {
      const openEdge = cells.filter(c => c.kind === 'blank' && onEdge(c)).length + rimCells.filter(r => Math.abs(area(r.tpoly)) > 4).length;
      if (openEdge) warnings.push({ kind: 'info', text: `המסגרת ההיקפית מוסתרת, אבל ${openEdge} מקומות בשוליים קטנים מדי לחלק, ושם המסגרת נראית. אפשר לשנות מעט את גודל התא או את גודל הפאנל.` });
    }
    if (shortened) warnings.push({ kind: 'info', text: `${shortened} קודקודים קוצרו כדי שלא ייכנסו בשכנים או כדי שיודפסו בלי תמיכות. אפשר להוריד את ה"הטיה" או את ה"קימור", או להעלות את "גובה מינימלי".` });

    // colours
    const col = st.color, nb = col.bands.length;
    const R = rng(col.seed || 1);
    const vals = pieces.map(c => {
      switch (col.by) {
        case 'height': return c.zApex;
        case 'gradient': { const a = (col.angle || 0) * Math.PI / 180; return c.c[0] * Math.cos(a) + c.c[1] * Math.sin(a); }
        case 'radial': return Math.hypot(c.c[0] / st.shape.w, c.c[1] / st.shape.h);
        case 'field': return c.fm;
        case 'random': return R();
      }
      return 0;
    });
    let vmin = Math.min(...vals), vmax = Math.max(...vals);
    if (col.reverse) vals.forEach((v, i) => vals[i] = vmax + vmin - v);
    pieces.forEach((c, i) => {
      let k = vmax - vmin < 1e-9 ? 0 : Math.floor(((vals[i] - vmin) / (vmax - vmin)) * nb);
      if (col.by === 'random') k = Math.floor(vals[i] * nb);
      c.band = Math.max(0, Math.min(nb - 1, k));
    });

    const rowH = Math.max(4, st.tess.size * 0.6);
    pieces.sort((a, b) => {
      const ra = Math.round(-a.c[1] / rowH), rb = Math.round(-b.c[1] / rowH);
      return ra - rb || a.c[0] - b.c[0];
    });
    pieces.forEach((c, i) => c.num = i + 1);
    const seams = { clamps: clamps.length };

    // piece height check vs printer
    const maxZ = Math.max(...pieces.map(c => c.zMax ?? c.zApex));
    if (maxZ > (pr.bedZ || 220)) warnings.push({ kind: 'warn', text: 'יש חלקים גבוהים מגובה ההדפסה של המדפסת.' });
    const big = pieces.filter(c => !fitsBed(c.fp.w + 2, c.fp.h + 2));
    if (big.length) warnings.push({ kind: 'warn', text: `${big.length} חלקים רחבים ממשטח ההדפסה.` });

    return {
      outer, region, frameOuter, hideRim, cells: cells.filter(c => c.kind !== 'merged'), pieces, blanks: cells.filter(c => c.kind === 'blank'), seams,
      tiles: usedTiles, tileGrid: P, islandPolys, clamps, clampSpec: CS, mounts, hangLevels: { lip, hd, zs, tm }, warnings, maxZ, maxExt, nominal: tz.nominal,
      bounds: ob
    };
  }

  // Dovetail notches. A notch is given in the frame of the seam edge it sits on: origin o on that edge, uk along it,
  // nIn into the cell; it spans s1..s2 along the edge and reaches D deep (measured from the edge). Where a notch is
  // longer than the collar's edge it simply runs round the corner. The collar keeps its outline at the top of the
  // frame, where the bevel starts (two points mark each notch on it); the notch is cut from the collar's column
  // inside the frame, and its roof is a short flat bridge between its side walls (pieceMesh).
  // run of a convex outline's boundary inside the notch rectangle: entry point pa on edge ka, exit pb on edge kb, and
  // the rectangle's inner corners met on the way; null when the outline does not reach the rectangle, false when the
  // boundary meets it in some other way (several runs, or a corner sitting exactly on its edge)
  function notchRun(P, sp, s1, s2, D) {
    const n = P.length, S = q => (q[0] - sp.o[0]) * sp.uk[0] + (q[1] - sp.o[1]) * sp.uk[1], Dd = q => (q[0] - sp.o[0]) * sp.nIn[0] + (q[1] - sp.o[1]) * sp.nIn[1];
    const ivs = [];
    for (let i = 0; i < n; i++) {
      const A = P[i], B = P[(i + 1) % n], sa = S(A), sb = S(B), da = Dd(A), db = Dd(B);
      let t0 = 0, t1 = 1;
      for (const [v0, v1, lim, up] of [[sa, sb, s1, true], [sa, sb, s2, false], [da, db, D, false]]) {
        const dv = v1 - v0;
        if (Math.abs(dv) < 1e-12) { if (up ? v0 <= lim : v0 >= lim) { t0 = 1; t1 = 0; } continue; }
        const t = (lim - v0) / dv;
        if ((dv > 0) === up) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      }
      ivs.push(t1 > t0 + 1e-9 ? [t0, t1] : null);
    }
    if (!ivs.some(Boolean)) return null;
    const ent = [], ext = [];
    ivs.forEach((v, i) => { if (!v) return; if (v[0] > 1e-9) ent.push(i); if (v[1] < 1 - 1e-9) ext.push(i); });
    if (ent.length !== 1 || ext.length !== 1) return false;
    const ka = ent[0], kb = ext[0], lp = (i, t) => { const A = P[i], B = P[(i + 1) % n]; return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; };
    const pt = (sv, dv) => [sp.o[0] + sp.uk[0] * sv + sp.nIn[0] * dv, sp.o[1] + sp.uk[1] * sv + sp.nIn[1] * dv];
    const inner = [pt(s1, D), pt(s2, D)].filter(q => inside(P, q));
    return { ka, kb, ta: ivs[ka][0], tb: ivs[kb][1], pa: lp(ka, ivs[ka][0]), pb: lp(kb, ivs[kb][1]), inner };
  }
  // X: { poly, opening, collar, body, outE? } with all rings parallel to poly. Returns the notched opening (a hole in
  // the frame), the collar and body with each notch's two points put in, outE to match, the notches
  // ({ a, b, inner }) and the collar's notched column (collarN, for checks); null when a notch does not fit
  function notchCut(X, specs, clr) {
    const n = X.collar.length, runsC = [], runsO = [];
    for (const sp of specs) {
      const rc = notchRun(X.collar, sp, sp.s1 - clr, sp.s2 + clr, (sp.Dc ?? sp.D) + clr), ro = notchRun(X.opening, sp, sp.s1, sp.s2, sp.D);
      if (!rc || !ro) return null;
      runsC.push(rc); runsO.push(ro);
    }
    // a ring with the runs cut out (cut) or only their end points put in
    const walk = (P, runs, cut, extra) => {
      const m = P.length, gone = new Set(), ins = new Map(), out = [];
      runs.forEach((r, ri) => {
        if (cut) for (let i = (r.ka + 1) % m; i !== (r.kb + 1) % m; i = (i + 1) % m) gone.add(i);
        if (!ins.has(r.ka)) ins.set(r.ka, []); if (!ins.has(r.kb)) ins.set(r.kb, []);
        ins.get(r.ka).push({ t: r.ta, p: r.pa, inner: cut ? r.inner : [], ri, end: 'a' });
        ins.get(r.kb).push({ t: r.tb, p: r.pb, inner: [], ri, end: 'b' });
      });
      for (let i = 0; i < m; i++) {
        if (!gone.has(i)) out.push(extra ? extra(i, null) : P[i]);
        for (const e of (ins.get(i) || []).sort((x, y) => x.t - y.t)) { out.push(extra ? extra(i, e) : e.p); e.inner.forEach(q => out.push(q)); }
      }
      return out;
    };
    // the runs must not touch each other
    const per = r => [r.ka + r.ta, r.kb + r.tb + (r.kb < r.ka || (r.kb === r.ka && r.tb < r.ta) ? n : 0)];
    for (let i = 0; i < runsC.length; i++) for (let j = i + 1; j < runsC.length; j++) {
      const [a0, a1] = per(runsC[i]), [b0, b1] = per(runsC[j]);
      for (const sh of [-n, 0, n]) if (a0 < b1 + sh + 0.05 && b0 + sh < a1 + 0.05) return null;
    }
    const opening = walk(X.opening, runsO, true);
    const collar = walk(X.collar, runsC, false);
    const collarN = walk(X.collar, runsC, true);
    // body points across from the collar's new points (same place along the edge)
    const onBody = (i, p) => { const C0 = X.collar[i], C1 = X.collar[(i + 1) % n], L = Math.hypot(C1[0] - C0[0], C1[1] - C0[1]) || 1, ux = (C1[0] - C0[0]) / L, uy = (C1[1] - C0[1]) / L, t = (p[0] - C0[0]) * ux + (p[1] - C0[1]) * uy, B0 = X.body[i]; return [B0[0] + ux * t, B0[1] + uy * t]; };
    const body = walk(X.collar, runsC, false, (i, e) => e ? onBody(i, e.p) : X.body[i]);
    const outE = X.outE ? walk(X.collar, runsC, false, i => X.outE[i]) : null;
    const notch = runsC.map(r => ({ a: r.pa, b: r.pb, inner: r.inner }));
    return { opening, collar, body, outE, notch, collarN };
  }
  // curved, twisted loft: sections shrink toward the tip while their centre follows a bending,
  // optionally spiralling path
  function setApex(c) {
    const sh = c.shape, N = sh.layers;
    const lx = c.lean[0] * c.scale, ly = c.lean[1] * c.scale;
    const e = sh.curve >= 0 ? 1 + 2.5 * sh.curve : 1 / (1 - 1.2 * sh.curve);
    const cx = c.c[0], cy = c.c[1];
    const at = (tt) => {
      const a = sh.spiral * tt, ca = Math.cos(a), sa = Math.sin(a), f = Math.pow(tt, e);
      return [cx + (lx * ca - ly * sa) * f, cy + (lx * sa + ly * ca) * f];
    };
    const rm = Math.sqrt(Math.max(1, area(c.body)) / Math.PI);
    // 0..1 keeps the original range (cut at 45% height at 1); up to 1.5 cuts lower still
    const trunc = Math.max(0, Math.min(1.5, sh.truncate || 0)), tEnd = Math.max(0.15, 1 - 0.55 * trunc);
    const blendAt = tt => sh.smooth > 0 ? Math.pow(Math.min(1, tt / Math.max(0.05, 1.05 - sh.smooth)), 1.5) : 0;
    const xf = (v, tt, ctr, sc, cr, sr, bl) => {
      let dx = v[0] - cx, dy = v[1] - cy;
      if (bl > 0) { const L = Math.hypot(dx, dy) || 1; dx += (dx / L * rm - dx) * bl; dy += (dy / L * rm - dy) * bl; }
      dx *= sc; dy *= sc;
      return [ctr[0] + dx * cr - dy * sr, ctr[1] + dx * sr + dy * cr];
    };
    const section = (tt) => {
      const ctr = at(tt), sc = Math.pow(1 - tt, sh.profile), r = sh.twist * tt, cr = Math.cos(r), sr = Math.sin(r), bl = blendAt(tt);
      return { ctr, sc, poly: c.body.map(v => xf(v, tt, ctr, sc, cr, sr, bl)) };
    };
    const vAt = (v, tt) => { const r = sh.twist * tt; return xf(v, tt, at(tt), Math.pow(1 - tt, sh.profile), Math.cos(r), Math.sin(r), blendAt(tt)); };
    const tilt = sh.cutTilt || 0;
    c.layers = []; c.tipFlat = false; c.zMax = undefined;
    c.tip = at(1);   // where the uncut tip would be: the plan arrows show this, so lean stays visible when cut
    if (trunc > 0 && Math.abs(tilt) > 1e-4) {
      // tilted cut: a plane through the centre line at the cut height; every vertex column runs up
      // until it meets that plane, so the layers lean with it and the top face is flat on the plane
      // the plane is hinged at the low edge of the cut section, so it only rises from the truncation height
      // and never dives into the base (that folded the walls and made pieces shrink)
      const ctr = at(tEnd), zC = c.z0 + c.hb * tEnd, tn = Math.tan(Math.abs(tilt)), d0 = sh.cutDir || [1, 0], d = tilt < 0 ? [-d0[0], -d0[1]] : d0;
      const proj = (x, y) => (x - ctr[0]) * d[0] + (y - ctr[1]) * d[1];
      const pMax = Math.max(...section(tEnd).poly.map(q => proj(q[0], q[1])));
      const zp = (x, y) => zC + tn * (pMax - proj(x, y));
      const T = c.body.map(v => {
        const f = tt => { const q = vAt(v, tt); return c.z0 + c.hb * tt - zp(q[0], q[1]); };
        if (f(0.97) <= 0) return 0.97;
        if (f(0.06) >= 0) return 0.06;
        let lo = 0.06, hi = 0.97;
        for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
        return (lo + hi) / 2;
      });
      // wv: rough section width at each vertex, so the overhang check can skip the thin tip like it does for flat layers
      const push = (poly, zv, wv) => c.layers.push({ z: Math.max(...zv), zLo: Math.min(...zv), zv, wv, poly });
      const bodyW = Math.sqrt(Math.max(1, Math.abs(area(c.body))));
      for (let k = 1; k <= N; k++) {
        const ts = T.map(t => t * k / N);
        push(c.body.map((v, i) => vAt(v, ts[i])), ts.map(t => c.z0 + c.hb * t), ts.map(t => bodyW * Math.pow(1 - t, sh.profile)));
      }
      const last = c.layers[c.layers.length - 1];
      if ((sh.dome || 0) > 0) {
        const rL = rm * Math.pow(1 - tEnd, sh.profile), h = sh.dome * rL * 0.9, M = 6;
        for (let j = 1; j < M; j++) {
          const th = j / M * Math.PI / 2, k = Math.cos(th);
          const poly = last.poly.map(v => [ctr[0] + (v[0] - ctr[0]) * k, ctr[1] + (v[1] - ctr[1]) * k]);
          // follow the plane from the real top ring (it can sit above the plane where a column was clamped)
          push(poly, poly.map((q, i) => last.zv[i] + zp(q[0], q[1]) - zp(last.poly[i][0], last.poly[i][1]) + h * Math.sin(th)), last.wv.map(w => w * k));
        }
        c.apex = ctr; c.zApex = zp(ctr[0], ctr[1]) + h;
      } else { c.apex = ctr; c.zApex = zp(ctr[0], ctr[1]); c.tipFlat = true; }
      c.zMax = Math.max(c.zApex, ...c.layers.map(l => l.z));
    } else if (trunc > 0) {
      let last = null;
      for (let k = 1; k <= N; k++) { const tt = tEnd * k / N; last = section(tt); c.layers.push({ z: c.z0 + c.hb * tt, poly: last.poly }); }
      const zTop = c.z0 + c.hb * tEnd;
      if ((sh.dome || 0) > 0) {
        const rL = rm * last.sc, h = sh.dome * rL * 0.9, M = 6, ctr = last.ctr;
        for (let j = 1; j < M; j++) {
          const th = j / M * Math.PI / 2, k = Math.cos(th);
          c.layers.push({ z: zTop + h * Math.sin(th), poly: last.poly.map(v => [ctr[0] + (v[0] - ctr[0]) * k, ctr[1] + (v[1] - ctr[1]) * k]) });
        }
        c.apex = ctr; c.zApex = zTop + h;
      } else { c.apex = last.ctr; c.zApex = zTop; c.tipFlat = true; }
    } else {
      for (let k = 1; k < N; k++) { const tt = k / N; c.layers.push({ z: c.z0 + c.hb * tt, poly: section(tt).poly }); }
      c.apex = at(1); c.zApex = c.z0 + c.hb;
    }
    clampBase(c);
    let x0 = c.apex[0], x1 = x0, y0 = c.apex[1], y1 = y0;
    const grow = poly => { for (const q of poly) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; } };
    grow(c.body); for (const l of c.layers) grow(l.poly);
    c.fp = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  // Where a piece leaves its socket nothing may hang out further than the print angle allows (print.overhang).
  // Every point of the piece stays inside the slope that rises from the socket's top edge at that angle. On a
  // narrow rib the plain bevel already does; next to a wide rib (tile seams, corners of the outline) the base used to
  // rest flat on the rib, a level overhang in the air when the piece is printed on its own. There the slope now
  // rises from the socket edge and meets the piece's own wall a little higher up: each vertex column is followed up
  // to where it enters the slope, and the base ring (and any layer below that point) moves there.
  // Edges on the panel's edge (hidden frame) are held up by the skirt and keep their flat underside.
  function clampBase(c) {
    c.base = null;
    const bv = c.bv, C = c.collar, n = C.length, Ls = c.layers;
    if (!bv || !C || c.body.length !== n) return;
    const N = [];
    for (let e = 0; e < n; e++) {
      const a = C[e], b = C[(e + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if ((bv.out && bv.out[e]) || L < 1e-9) { N.push(null); continue; }
      const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;   // outward normal (CCW)
      N.push([nx, ny, nx * a[0] + ny * a[1]]);
    }
    // > 0: this point hangs out past the slope that rises from collar edge e
    const g = (e, p) => { const q = N[e]; return q ? q[0] * p[0] + q[1] * p[1] - q[2] - (p[2] - bv.t) * bv.tan : -Infinity; };
    const pt = (k, i) => { if (k === 0) return [c.body[i][0], c.body[i][1], c.z0]; const l = Ls[k - 1]; return [l.poly[i][0], l.poly[i][1], l.zv ? l.zv[i] : l.z]; };
    const hit = new Array(n).fill(null);
    let any = false;
    for (let i = 0; i < n; i++) {
      const E2 = [(i - 1 + n) % n, i];
      let p = pt(0, i);
      if (Math.max(g(E2[0], p), g(E2[1], p)) <= 1e-6) continue;
      any = true;
      let h = null;
      for (let k = 1; k <= Ls.length; k++) {
        const q = pt(k, i);
        if (Math.max(g(E2[0], q), g(E2[1], q)) <= 0) {
          let s = 0;   // both limits are linear along the segment: the point where the last one is met
          for (const e of E2) { const ga = g(e, p), gb = g(e, q); if (ga > 0) s = Math.max(s, ga / (ga - gb)); }
          h = { p: [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s], k };
          break;
        }
        p = q;
      }
      hit[i] = h || { p, k: Ls.length + 1 };   // the whole column hangs out: the overhang check shrinks the lean
    }
    if (!any) return;
    const base = { poly: c.body.map((v, i) => hit[i] ? [hit[i].p[0], hit[i].p[1]] : v), zv: c.body.map((v, i) => hit[i] ? hit[i].p[2] : c.z0), k: hit.map(h => h ? h.k : 0) };
    c.base = base;
    // layers under the meeting point collapse onto it (the mesh joins those points, so no sliver faces)
    Ls.forEach((l, k0) => {
      const k = k0 + 1;
      if (!hit.some(h => h && h.k > k)) return;
      l.raw = { poly: l.poly, zv: l.zv, z: l.z };
      const zv = l.poly.map((q, i) => l.zv ? l.zv[i] : l.z);
      l.poly = l.poly.map((q, i) => hit[i] && hit[i].k > k ? [hit[i].p[0], hit[i].p[1]] : q);
      hit.forEach((h, i) => { if (h && h.k > k) zv[i] = h.p[2]; });
      l.zv = zv; l.z = Math.max(...zv); l.zLo = Math.min(...zv);
    });
  }
  // A corner next to a wide rib is lifted onto the base slope (clampBase). Without help that lift would tilt the
  // whole bottom edge of the neighbouring face, from the corner to the next one. So each face beside a wide rib gets
  // an extra point where the slope from that rib crosses it at the base height: the face's bottom stays level up to
  // there and only rises over the last stretch toward the rib.
  function splitBase(c) {
    const bv = c.bv, C = c.collar, B = c.body, n = C.length;
    if (!bv || B.length !== n) return;
    const reach = c.chamfer * bv.tan, out = bv.out;   // the base sits one bevel above the frame (z0 = t + chamfer)
    const edge = [];
    for (let e = 0; e < n; e++) {
      const a = C[e], b = C[(e + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9 || (out && out[e])) { edge.push(null); continue; }
      const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L, d = nx * a[0] + ny * a[1];
      const step = Math.max(nx * B[e][0] + ny * B[e][1], nx * B[(e + 1) % n][0] + ny * B[(e + 1) % n][1]) - d;
      edge.push({ nx, ny, d, wide: step > reach + 1e-6 });
    }
    const wide = e => !!(edge[e] && edge[e].wide);
    if (!edge.some(Boolean) || ![...Array(n).keys()].some(wide)) return;
    const nC = [], nB = [], nL = c.ledge ? [] : null, nO = out ? [] : null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      nC.push(C[i]); nB.push(B[i]); if (nL) nL.push(c.ledge[i]); if (nO) nO.push(out[i]);
      if (wide(i)) continue;
      const cuts = [];
      for (const e of [(i - 1 + n) % n, j]) {
        if (!wide(e)) continue;
        const E2 = edge[e], f = q => E2.nx * q[0] + E2.ny * q[1], fa = f(B[i]), fb = f(B[j]), target = E2.d + reach;
        if (Math.abs(fb - fa) < 1e-9) continue;
        const u = (target - fa) / (fb - fa);
        if (u > 0.02 && u < 0.98) cuts.push(u);
      }
      cuts.sort((a, b) => a - b).forEach(u => {
        const lp = (P, Q) => [P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u];
        nC.push(lp(C[i], C[j])); nB.push(lp(B[i], B[j])); if (nL) nL.push(lp(c.ledge[i], c.ledge[j])); if (nO) nO.push(out[i]);
      });
    }
    if (nC.length === n) return;
    c.collar = nC; c.body = nB; if (nL) c.ledge = nL; if (nO) { c.outE = nO; bv.out = nO; }
  }
  function subdivide(p, q) {
    if (q <= 1) return p;
    const out = [];
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; for (let k = 0; k < q; k++) out.push([a[0] + (b[0] - a[0]) * k / q, a[1] + (b[1] - a[1]) * k / q]); }
    return out;
  }
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function triBadXYZ(px, py, pz, qx, qy, qz, rx, ry, rz, lim) {
    const ex = qx - px, ey = qy - py, ez = qz - pz, ax = rx - px, ay = ry - py, az = rz - pz;
    const nx = ey * az - ez * ay, ny = ez * ax - ex * az, nz = ex * ay - ey * ax;
    const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return L > 1e-9 && nz < lim * L;
  }
  function rings3(c) {
    const R = [c.body.map(v => [v[0], v[1], c.z0])];
    c.layers.forEach(l => R.push(l.poly.map((v, i) => [v[0], v[1], l.zv ? l.zv[i] : l.z])));
    return R;
  }
  function triBad(p, q, r, lim) {
    const e = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], a = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [e[1] * a[2] - e[2] * a[1], e[2] * a[0] - e[0] * a[2], e[0] * a[1] - e[1] * a[0]];
    const L = Math.hypot(n[0], n[1], n[2]);
    return L > 1e-9 && n[2] / L < lim;
  }
  // the pocket under a corner piece (plus a wall around it) must stay inside the piece up to above its roof
  function pocketFits(c) {
    if (!c.pocketWall) return true;
    const zNeed = c.pocketTop + 1.0;
    if (c.zApex < zNeed + 0.5) return false;
    if (!c.pocketWall.every(q => inside(c.body, q))) return false;
    let prevZ = c.z0;
    for (const l of (c.layers || [])) {
      if (prevZ >= zNeed) break;
      if (!c.pocketWall.every(q => inside(l.poly, q))) return false;
      prevZ = l.zLo ?? l.z;
    }
    return true;
  }
  // side faces must not overhang more than maxOv from vertical
  function overhangBad(c, maxOv) {
    // reads the rings in place (no copies): this runs for every piece on every shrink step
    const lim = -Math.sin(maxOv), Ls = c.layers, n = c.body.length, z0 = c.z0, B0 = c.base;
    const P = k => k === 0 ? (B0 ? B0.poly : c.body) : Ls[k - 1].poly;
    const Z = (k, i) => { if (k === 0) return B0 ? B0.zv[i] : z0; const l = Ls[k - 1]; return l.zv ? l.zv[i] : l.z; };
    // the last few millimetres of a tip are too small to droop; only check sections wider than ~3 mm
    let kmax = Ls.length;
    while (kmax > 1 && Math.sqrt(Math.abs(area(P(kmax)))) < 3) kmax--;
    for (let k = 0; k < kmax; k++) {
      const A = P(k), B = P(k + 1), wv = Ls[k] && Ls[k].wv;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (wv && Math.min(wv[i], wv[j]) < 3) continue;   // tilted cut: thin tip part of this column
        const ai = A[i], aj = A[j], bi = B[i], bj = B[j], zai = Z(k, i), zaj = Z(k, j), zbi = Z(k + 1, i), zbj = Z(k + 1, j);
        if (triBadXYZ(ai[0], ai[1], zai, aj[0], aj[1], zaj, bj[0], bj[1], zbj, lim) || triBadXYZ(ai[0], ai[1], zai, bj[0], bj[1], zbj, bi[0], bi[1], zbi, lim)) return true;
      }
    }
    if (kmax === Ls.length && !c.tipFlat) {
      const T = P(kmax), ax = c.apex[0], ay = c.apex[1], az = c.zApex;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (triBadXYZ(T[i][0], T[i][1], Z(kmax, i), T[j][0], T[j][1], Z(kmax, j), ax, ay, az, lim)) return true; }
    }
    return false;
  }
  // approximate top of piece o above (x,y): highest section containing the point
  function topAt(o, x, y) {
    for (let k = o.layers.length - 1; k >= 0; k--) { const l = o.layers[k]; if (inside(l.poly, [x, y])) return l.z + o.hb / o.shape.layers; }
    if (inside(o.body, [x, y])) return o.z0 + o.hb / o.shape.layers;
    return -Infinity;
  }
  function collides(c, gap) {
    const N = c.layers.length, samples = [[c.apex[0], c.apex[1], c.zApex]];
    for (const k of [Math.floor(N / 3), Math.floor(2 * N / 3), N - 1]) { const l = c.layers[k]; if (l) l.poly.forEach((v, i) => samples.push([v[0], v[1], l.zv ? l.zv[i] : l.z])); }
    const clearance = Math.max(0.6, gap);
    for (const s of samples) {
      if (inside(c.body, s)) continue;
      for (const o of c.nb) {
        if (s[0] < o.fp.x0 || s[0] > o.fp.x1 || s[1] < o.fp.y0 || s[1] > o.fp.y1) continue;
        const h = topAt(o, s[0], s[1]);
        if (h > -Infinity && s[2] < h + clearance) return true;
      }
    }
    return false;
  }

  // ---------- meshes ----------
  // mesh = {v:[x,y,z,...], f:[a,b,c,...]}
  function Mesh() { this.v = []; this.f = []; }
  Mesh.prototype.pt = function (x, y, z) { this.v.push(x, y, z); return this.v.length / 3 - 1; };
  Mesh.prototype.ring = function (poly, z) { return poly.map(p => this.pt(p[0], p[1], z)); };
  Mesh.prototype.tri = function (a, b, c) { this.f.push(a, b, c); };
  Mesh.prototype.quad = function (a, b, c, d) { this.f.push(a, b, c, a, c, d); };
  Mesh.prototype.capUp = function (r) { for (let i = 1; i < r.length - 1; i++) this.tri(r[0], r[i], r[i + 1]); };
  Mesh.prototype.capDown = function (r) { for (let i = 1; i < r.length - 1; i++) this.tri(r[0], r[i + 1], r[i]); };
  Mesh.prototype.wall = function (lo, up) { const n = lo.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(lo[i], lo[j], up[j], up[i]); } };
  // like wall, for rings that share some points (same index): the collapsed triangles are left out, and each
  // side is split along the diagonal that leaves it standing steeper (less overhang where the rings are uneven)
  Mesh.prototype.wallJ = function (lo, up) {
    const n = lo.length, V = this.v;
    const nz = (a, b, c) => {
      if (a === b || b === c || a === c) return 1;
      const ex = V[3 * b] - V[3 * a], ey = V[3 * b + 1] - V[3 * a + 1], ez = V[3 * b + 2] - V[3 * a + 2];
      const gx = V[3 * c] - V[3 * a], gy = V[3 * c + 1] - V[3 * a + 1], gz = V[3 * c + 2] - V[3 * a + 2];
      const x = ey * gz - ez * gy, y = ez * gx - ex * gz, z = ex * gy - ey * gx, L = Math.sqrt(x * x + y * y + z * z);
      return L < 1e-12 ? 1 : z / L;
    };
    const put = (a, b, c) => { if (a !== b && b !== c && a !== c) this.f.push(a, b, c); };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = lo[i], b = lo[j], c = up[j], d = up[i];
      if (Math.min(nz(a, b, d), nz(b, c, d)) > Math.min(nz(a, b, c), nz(a, c, d)) + 1e-9) { put(a, b, d); put(b, c, d); }
      else { put(a, b, c); put(a, c, d); }
    }
  };
  Mesh.prototype.wallIn = function (lo, up) { const n = lo.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(lo[j], lo[i], up[i], up[j]); } };
  Mesh.prototype.append = function (m, dx = 0, dy = 0, dz = 0) {
    const o = this.v.length / 3;
    for (let i = 0; i < m.v.length; i += 3) this.v.push(m.v[i] + dx, m.v[i + 1] + dy, m.v[i + 2] + dz);
    for (const k of m.f) this.f.push(k + o);
    return this;
  };

  // flat face from earcut over an outline with holes, made of existing vertex rings; up = normal +z
  function capRings(m, rings, up) {
    const flat = [], idx = [], holes = [];
    rings.forEach((r, k) => { if (k) holes.push(idx.length); r.forEach(i => { idx.push(i); flat.push(m.v[i * 3], m.v[i * 3 + 1]); }); });
    const tr = root.earcut(flat, holes.length ? holes : null, 2);
    // earcut gives every triangle the same winding; decide the flip once from the largest triangle, so the
    // zero-area slivers it makes along straight runs of points get the same winding as their neighbours
    let flip = null, bestA = 0;
    for (let i = 0; i < tr.length; i += 3) {
      const a = idx[tr[i]], b = idx[tr[i + 1]], c = idx[tr[i + 2]];
      const cr = (m.v[b * 3] - m.v[a * 3]) * (m.v[c * 3 + 1] - m.v[a * 3 + 1]) - (m.v[b * 3 + 1] - m.v[a * 3 + 1]) * (m.v[c * 3] - m.v[a * 3]);
      if (Math.abs(cr) > bestA) { bestA = Math.abs(cr); flip = (cr > 0) !== up; }
    }
    for (let i = 0; i < tr.length; i += 3) {
      const a = idx[tr[i]], b = idx[tr[i + 1]], c = idx[tr[i + 2]];
      if (flip) m.tri(a, c, b); else m.tri(a, b, c);
    }
  }
  // ---------- part numbers engraved under each piece ----------
  // seven-segment digits: simple, bold and printable at 3 to 6 mm with a 0.4 mm nozzle
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  function textGlyphs(text, H, stroke) {
    const W = 0.58 * H, gapX = 0.32 * H, s2 = stroke, rects = [];
    String(text).split('').forEach((ch, k) => {
      const x0 = k * (W + gapX), segs = SEG[ch] || '';
      const R = (a, b, c, d) => rects.push([[x0 + a, b], [x0 + c, b], [x0 + c, d], [x0 + a, d], [x0 + a, b]]);
      for (const g of segs) {
        if (g === 'a') R(0, H - s2, W, H);
        if (g === 'd') R(0, 0, W, s2);
        if (g === 'g') R(0, (H - s2) / 2, W, (H + s2) / 2);
        if (g === 'f') R(0, H / 2 - s2 / 2, s2, H);
        if (g === 'b') R(W - s2, H / 2 - s2 / 2, W, H);
        if (g === 'e') R(0, 0, s2, H / 2 + s2 / 2);
        if (g === 'c') R(W - s2, 0, W, H / 2 + s2 / 2);
      }
    });
    const n = String(text).length;
    return { geom: rects.length ? root.polygonClipping.union(...rects.map(r => [r])) : [], w: n * W + (n - 1) * gapX, h: H };
  }
  // find a spot and size for the number on the underside; the text is mirrored so it reads right
  // when the piece is turned over. avoid: a ring the text must stay clear of (the pocket of a corner piece)
  function placeLabel(text, outline, avoid) {
    const PCl = root.polygonClipping, stroke = 0.8;
    const ringC = q => q.concat([q[0]]);
    const cc = centroid(avoid ? outline : outline), bb = bbox(outline);
    const centres = [cc];
    for (let x = Math.ceil(bb.x0); x <= bb.x1; x += 1.5) for (let y = Math.ceil(bb.y0); y <= bb.y1; y += 1.5) centres.push([x, y]);
    centres.sort((a, b) => Math.hypot(a[0] - cc[0], a[1] - cc[1]) - Math.hypot(b[0] - cc[0], b[1] - cc[1]));
    for (let H = 6; H >= 2.5; H -= 0.5) {
      const tg = textGlyphs(text, H, stroke), margin = H > 3 ? 1.0 : 0.6;
      for (const c0 of centres.slice(0, avoid ? 400 : 60)) {
        const x0 = c0[0] - tg.w / 2 - margin, x1 = c0[0] + tg.w / 2 + margin, y0 = c0[1] - tg.h / 2 - margin, y1 = c0[1] + tg.h / 2 + margin;
        const box = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        if (!box.every(q => inside(outline, q))) continue;
        const boxG = [ringC(box)];
        try {
          if (PCl.difference(boxG, [ringC(outline)]).some(pp => Math.abs(area(pp[0].slice(0, -1))) > 1e-4)) continue;
          if (avoid && PCl.intersection(boxG, [ringC(avoid)]).length) continue;
        } catch (e) { continue; }
        // mirror in x and move into place
        return tg.geom.map(poly => poly.map(r => r.map(([x, y]) => [c0[0] + tg.w / 2 - x, c0[1] - tg.h / 2 + y])));
      }
    }
    return null;
  }
  // flat underside at height z with recessed text: rings = outline index rings for the face (outer first)
  function engraveFace(m, rings, glyphs, z, depth) {
    const faceHoles = [];
    // a few microns of deterministic jitter: digits share straight baselines, and points lined up across
    // separate holes make the triangulation emit broken slivers
    let k = 0;
    const jt = r => r.map(([x, y]) => { k++; return [x + 0.004 * jit(k * 3.1), y + 0.004 * jit(k * 7.7 + 1)]; });
    for (const poly of glyphs) {
      const outer = ccw(jt(poly[0].slice(0, -1))), holes = poly.slice(1).map(r => ccw(jt(r.slice(0, -1))));
      const o0 = m.ring(outer, z), o1 = m.ring(outer, z + depth);
      m.wallIn(o0, o1); faceHoles.push(o0);
      const tops = holes.map(h => { const h0 = m.ring(h, z), h1 = m.ring(h, z + depth); m.wall(h0, h1); capRings(m, [h0], false); return h1; });
      capRings(m, [o1, ...tops], false);   // floor of the recess (faces down)
    }
    capRings(m, [...rings, ...faceHoles], false);
  }
  function pieceMesh(c, fr, opts) {
    const m = new Mesh();
    let prev;
    if (c.mount && c.pocket) {
      // corner piece: sits on the solid corner of the frame, hollowed underneath around the hidden boss
      // nudge points that sit on a straight edge a hair inward, so the flat underside triangulates cleanly
      const cc = centroid(c.collar), nudge = (ring, k0) => ring.map((p, i) => { const d = 0.002 * (1 + ((i * 7 + k0) % 5)); const dx = cc[0] - p[0], dy = cc[1] - p[1], L = Math.hypot(dx, dy) || 1; return [p[0] + dx / L * d, p[1] + dy / L * d]; });
      const zb = fr.t, r0 = m.ring(nudge(c.collar, 0), zb);
      prev = baseRing(m, c, r0, zb);   // same bevel as every other piece
      const l0 = m.ring(c.pocketLo, zb), l1 = m.ring(c.pocketLo, c.pocketLoTop);
      const p0 = m.ring(c.pocket, c.pocketLoTop), p1 = m.ring(c.pocket, c.pocketTop);
      const lab = opts && opts.label && c.num ? placeLabel(c.num, c.collar, c.pocketLo) : null;
      if (lab) engraveFace(m, [r0, l0], lab, zb, 0.4);
      else capRings(m, [r0, l0], false);  // underside: between the outline and the recess for the boss ring
      m.wallIn(l0, l1);                   // recess walls face inwards
      capRings(m, [l1, p0], false);       // step down to the head chamber
      m.wallIn(p0, p1);
      capRings(m, [p1], false);           // chamber ceiling
    } else {
      const zr = c.zr || 0, col = collarColumn(c);
      const r1 = m.ring(c.collar, zr + fr.t);
      if (!col) {
        const r0 = m.ring(c.collar, zr);
        const lab = opts && opts.label && c.num ? placeLabel(c.num, c.collar, null) : null;
        if (lab) engraveFace(m, [r0], lab, zr, 0.4); else m.capDown(r0);
        m.wall(r0, r1);
      } else {
        // notches for the frame's dovetails: the column inside the frame follows the notched outline (top ring
        // shares the collar's points), and each notch's roof is a flat bridge from one side wall to the other
        const top = col.ring.map(q => typeof q === 'number' ? r1[q] : m.pt(q[0], q[1], zr + fr.t));
        const bot = col.ring.map(q => typeof q === 'number' ? m.pt(c.collar[q][0], c.collar[q][1], zr) : m.pt(q[0], q[1], zr));
        const lab = opts && opts.label && c.num ? placeLabel(c.num, col.outline, null) : null;
        if (lab) engraveFace(m, [bot], lab, zr, 0.4); else capRings(m, [bot], false);
        m.wall(bot, top);
        col.roofs.forEach(rf => capRings(m, [rf.map(q => q.pos !== undefined ? top[q.pos] : r1[q.collar])], false));
      }
      prev = baseRing(m, c, r1, zr + fr.t);
    }
    if (c.wrap) extrudeGeom(m, c.wrap, c.zr || 0, c.z0 - 0.01);   // skirt over the hidden outer rail, down to the wall
    if (c.flare) {
      // a wedge under each run of outer faces: the sloped face carried down to the wall (B), closed by an upright
      // face just inside the skirt (C) and end triangles; it overlaps the skirt, and the slicer joins them
      const { out, B: Bo, C: Ci, zc } = c.flare, n = c.body.length, z0 = c.zr || 0, zt = c.z0 - 0.01;
      let start = out.findIndex((o, i) => o && !out[(i - 1 + n) % n]);
      if (start < 0) start = 0;   // every edge faces out
      for (let k = 0, i = start; k < n; k++, i = (i + 1) % n) {
        if (!out[i] || (out[(i - 1 + n) % n] && i !== start)) continue;
        const run = [i]; let j = (i + 1) % n;
        while (out[(j - 1 + n) % n] && j !== i && run.length <= n) { run.push(j); if (!out[j]) break; j = (j + 1) % n; }
        if (run.length < 2) continue;
        const b = run.map(v => m.pt(Bo[v][0], Bo[v][1], z0)), kk = run.map(v => m.pt(Bo[v][0], Bo[v][1], z0 + zc[v]));
        const cc = run.map(v => m.pt(Ci[v][0], Ci[v][1], z0));
        const a = run.map(v => m.pt(Ci[v][0], Ci[v][1], zt)), t = run.map(v => m.pt(c.body[v][0], c.body[v][1], zt));
        for (let r = 0; r < run.length - 1; r++) {
          m.quad(b[r + 1], b[r], cc[r], cc[r + 1]);     // bottom, on the wall
          m.quad(b[r + 1], kk[r + 1], kk[r], b[r]);     // upright cut along the panel's outer line
          m.quad(kk[r + 1], t[r + 1], t[r], kk[r]);     // the sloped outer face, carried down to the cut
          m.quad(t[r + 1], a[r + 1], a[r], t[r]);       // narrow top strip at the body's base
          m.quad(a[r + 1], cc[r + 1], cc[r], a[r]);     // upright inner face, inside the skirt
        }
        const e = run.length - 1;
        m.tri(b[0], kk[0], t[0]); m.tri(b[0], t[0], a[0]); m.tri(b[0], a[0], cc[0]);   // ends
        m.tri(cc[e], a[e], t[e]); m.tri(cc[e], t[e], kk[e]); m.tri(cc[e], kk[e], b[e]);
      }
    }
    const K = c.base && c.base.k;
    (c.layers || []).forEach((l, k0) => {
      // a point pulled down onto the base slope is the same point as the one below it
      const r = l.poly.map((p, i) => K && K[i] > k0 + 1 ? prev[i] : m.pt(p[0], p[1], l.zv ? l.zv[i] : l.z));
      m.wallJ(prev, r); prev = r;
    });
    if (c.tipFlat) { m.capUp(prev); return m; }
    const a = m.pt(c.apex[0], c.apex[1], c.zApex);
    for (let i = 0; i < prev.length; i++) m.tri(prev[i], prev[(i + 1) % prev.length], a);
    return m;
  }
  // the collar's column inside the frame when the piece has dovetail notches. ring: collar indices (numbers) and
  // the notches' inner corners (points); roofs: for each notch its outline, as {pos} (place in ring) or {collar}
  // (a collar point over the notch, only on the top ring); outline: the column's outline
  function collarColumn(c) {
    if (!c.notch || !c.notch.length) return null;
    const C = c.collar, n = C.length, near = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
    const ns = [], skip = new Set();
    for (const nt of c.notch) {
      const ia = C.findIndex(p => near(p, nt.a)), ib = C.findIndex(p => near(p, nt.b));
      if (ia < 0 || ib < 0 || ia === ib) return null;
      const mid = [];
      for (let j = (ia + 1) % n; j !== ib; j = (j + 1) % n) { mid.push(j); skip.add(j); }
      ns.push({ ia, ib, mid, nt });
    }
    const ring = [], pos = new Map();
    for (let i = 0; i < n; i++) {
      if (skip.has(i)) continue;
      pos.set(i, ring.length); ring.push(i);
      const st = ns.find(q => q.ia === i);
      if (st) { st.inPos = st.nt.inner.map((q, k) => ring.length + k); st.nt.inner.forEach(q => ring.push(q)); }
    }
    if (ns.some(q => !pos.has(q.ib) || !q.inPos)) return null;
    const roofs = ns.map(q => [{ pos: pos.get(q.ia) }, ...q.mid.map(j => ({ collar: j })), { pos: pos.get(q.ib) }, ...q.inPos.slice().reverse().map(p => ({ pos: p }))]);   // CCW from above
    return { ring, roofs, outline: ring.map(q => typeof q === 'number' ? C[q] : q) };
  }
  // from the top of the collar (ring rc at height zc) up to the base of the body: the bevel. On the panel's edge
  // (hidden frame) the underside stays flat over the rail up to the ledge, since the skirt holds it there.
  function baseRing(m, c, rc, zc) {
    let lo = rc;
    if (c.ledge && c.outE) {
      const n = c.collar.length, near = i => c.outE[i] || c.outE[(i - 1 + n) % n];
      lo = rc.map((k, i) => near(i) ? m.pt(c.ledge[i][0], c.ledge[i][1], zc) : k);
      m.wallJ(rc, lo);
    }
    const B = c.base, up = B ? B.poly.map((p, i) => m.pt(p[0], p[1], B.zv[i])) : m.ring(c.body, c.z0);
    m.wallJ(lo, up);
    return up;
  }
  function prism(m, poly, z0, z1) { const lo = m.ring(poly, z0), up = m.ring(poly, z1); m.capDown(lo); m.capUp(up); m.wall(lo, up); }
  function annulus(m, out, inn, z0, z1) {
    const ol = m.ring(out, z0), ou = m.ring(out, z1), il = m.ring(inn, z0), iu = m.ring(inn, z1);
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      m.quad(ou[i], ou[j], iu[j], iu[i]);   // top
      m.quad(ol[j], ol[i], il[i], il[j]);   // bottom
    }
    m.wall(ol, ou); m.wallIn(il, iu);
  }
  function jit(n) { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; }
  // extrude a polygon-clipping MultiPolygon between z0 and z1 into one closed mesh
  function extrudeGeom(m, geom, z0, z1) {
    const ec = root.earcut;
    for (const poly of geom) {
      const rings = poly.map((r, k) => {
        let q = [];
        for (const p of r.slice(0, -1)) { const l = q[q.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.005) q.push(p); }
        while (q.length > 1 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) <= 0.005) q.pop();
        // drop collinear points: they make earcut emit sliver triangles and T-junctions
        for (let guard = 0, changed = true; changed && q.length > 3 && guard < 1000; guard++) {
          changed = false;
          for (let i = 0; i < q.length; i++) {
            const a = q[(i - 1 + q.length) % q.length], b = q[i], c = q[(i + 1) % q.length];
            const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            if (Math.abs(cr) < 1e-4 * Math.max(1e-9, Math.hypot(c[0] - a[0], c[1] - a[1]))) { q.splice(i, 1); changed = true; break; }
          }
        }
        // outer ring CCW, holes CW
        if ((k === 0) !== (area(q) > 0)) q = q.reverse();
        // tiny deterministic jitter (≤2 µm) so edges of different rings are never exactly collinear,
        // which otherwise makes earcut produce zero-area triangles and T-junctions
        return q.map((p, i) => [p[0] + jit(k * 7919 + i) * 0.002, p[1] + jit(k * 104729 + i + 13) * 0.002]);
      }).filter(q => q.length >= 3);
      if (!rings.length) continue;
      // split pinch points (a ring touching itself or another ring): move each copy 20 µm into
      // the material along its own corner bisector so the copies separate cleanly
      const seenPt = new Map();
      rings.forEach(r => r.forEach(p => { const k = Math.round(p[0] * 2e3) + ',' + Math.round(p[1] * 2e3); seenPt.set(k, (seenPt.get(k) || 0) + 1); }));
      rings.forEach((r, k) => {
        const moved = r.map((p, i) => {
          const key = Math.round(p[0] * 2e3) + ',' + Math.round(p[1] * 2e3);
          if (seenPt.get(key) < 2) return p;
          const a = r[(i - 1 + r.length) % r.length], b = r[(i + 1) % r.length];
          const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
          const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
          let nx = -e1[1] / l1 - e2[1] / l2, ny = e1[0] / l1 + e2[0] / l2;
          const L = Math.hypot(nx, ny);
          if (L < 1e-6) { nx = -e1[1] / l1; ny = e1[0] / l1; } else { nx /= L; ny /= L; }
          return [p[0] + nx * 0.02, p[1] + ny * 0.02];
        });
        rings[k] = moved;
      });
      const flat = [], holes = [], lo = [], up = [];
      rings.forEach((r, k) => { if (k) holes.push(flat.length / 2); r.forEach(p => flat.push(p[0], p[1])); });
      rings.forEach(r => { lo.push(m.ring(r, z0)); });
      rings.forEach(r => { up.push(m.ring(r, z1)); });
      const L = lo.flat(), U = up.flat();
      const tri = ec(flat, holes, 2);
      for (let i = 0; i < tri.length; i += 3) {
        let a = tri[i], b = tri[i + 1], c = tri[i + 2];
        const sa = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
        if (sa < 0) { const t = b; b = c; c = t; }
        m.tri(U[a], U[b], U[c]); m.tri(L[a], L[c], L[b]);
      }
      rings.forEach((r, k) => m.wall(lo[k], up[k]));
    }
    return m;
  }
  // ---------- clamps between frame tiles ----------
  // Sizes in the frame of a seam: n across the seam (0 on the seam), u along it, z up from the wall. The frame
  // gets the nominal shape (core |n| <= cg, slots out to cD, core top at zr); the clamp is smaller by clampClr
  // on every face that meets the frame, so the printing play is set on the clamp alone.
  function clampSpec(fr) {
    const t = fr.t, half = fr.rib / 2, jc = fr.jointClr ?? 0.2, cc = Math.max(0, fr.clampClr ?? 0.1);
    const Lc = Math.max(3, fr.clampLen ?? 6);
    const cg = Math.max(half + 0.4, 2.0), lt = 1.6, cD = cg + lt;   // core half-width, leg, outer face of the slot
    const rT = Math.min(1.4, t * 0.45), zr = t - rT;              // roof thickness, top of the core under the roof
    return { t, jc, cc, Lc, cg, lt, cD, rT, zr };
  }
  // the clamp's U-shaped section (x = n, y = z): its legs grip the core of both tiles, sized so the tiles are held
  // at their nominal seam gap; it ends 0.2 mm off the wall and 0.1 mm under the top of the frame. marks: small
  // grooves on the roof (fit test only), to tell the clearances apart
  function clampProfile(S, cc, marks) {
    cc = cc ?? S.cc;
    const gi = S.cg - S.jc / 2 + cc, Do = S.cD - cc, zb = 0.2, zrc = S.zr + 0.05 + cc, zt = S.t - 0.1;
    const top = [[Do, zt]];
    for (let i = 0; i < (marks || 0); i++) {
      const x = Do - 1.0 - i * 1.3;
      top.push([x, zt], [x, zt - 0.4], [x - 0.6, zt - 0.4], [x - 0.6, zt]);
    }
    top.push([-Do, zt]);
    return ccw([[-Do, zb], [-gi, zb], [-gi, zrc], [gi, zrc], [gi, zb], [Do, zb], ...top]);
  }
  // print-ready clamp: the U section flat on the bed, standing Lc - 2cc tall (no overhangs at all, and every
  // layer holds the whole U, so the legs do not break off along a layer line)
  function clampMesh(S, cc, marks) {
    cc = cc ?? S.cc;
    const p = clampProfile(S, cc, marks);
    return extrudeGeom(new Mesh(), [[p.concat([p[0]])]], 0, S.Lc - 2 * cc);
  }
  // the same clamp in place on the panel (for the 3D view)
  function clampPlaced(k, S) {
    const m = clampMesh(S), h = S.Lc / 2 - S.cc, out = new Mesh();
    for (let i = 0; i < m.v.length; i += 3) {
      const x = m.v[i], y = m.v[i + 1], w = m.v[i + 2] - h;
      out.v.push(k.m[0] + k.n[0] * x + k.u[0] * w, k.m[1] + k.n[1] * x + k.u[1] * w, y);
    }
    // (x, y, w) -> (n, z, u) turns the solid inside out when that map mirrors it: flip the triangles then
    const flip = k.u[0] * k.n[1] - k.n[0] * k.u[1] < 0;
    for (let i = 0; i < m.f.length; i += 3) out.f.push(m.f[i], flip ? m.f[i + 2] : m.f[i + 1], flip ? m.f[i + 1] : m.f[i + 2]);
    return out;
  }
  function tileMesh(tl, fr) {
    if (!tl.slabs) return extrudeGeom(new Mesh(), tl.geom, 0, fr.t);
    const m = new Mesh();
    // stacked closed shells that overlap by 0.05 mm, so no two shells share a face; the slicer unions them
    tl.slabs.forEach((sl, i) => { if (sl.g.length) extrudeGeom(m, sl.g, sl.z0, i < tl.slabs.length - 1 ? sl.z1 + 0.05 : sl.z1); });
    return m;
  }
  function meshVolume(m) {
    let s = 0; const v = m.v, f = m.f;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    return s / 6;
  }
  // every edge used exactly twice, in opposite directions
  function checkManifold(m) {
    const E = new Map(); const f = m.f;
    for (let i = 0; i < f.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = f[i + k], b = f[i + (k + 1) % 3];
      const key = a + '_' + b; E.set(key, (E.get(key) || 0) + 1);
    }
    let bad = 0;
    for (const [k, n] of E) { const [a, b] = k.split('_'); if (n !== 1 || E.get(b + '_' + a) !== 1) bad++; }
    return bad;
  }

  // ---------- plate packing (shelf) ----------
  function packPlates(items, pr) {
    // items: {w,h,ref}; returns plates [{items:[{x,y,ref}]}]
    const W = pr.bedW - 2 * pr.margin, H = pr.bedH - 2 * pr.margin, g = pr.spacing;
    const sorted = items.slice().sort((a, b) => b.h - a.h || b.w - a.w);
    const plates = [];
    let cur = null, x = 0, y = 0, rowH = 0;
    const newPlate = () => { cur = { items: [] }; plates.push(cur); x = 0; y = 0; rowH = 0; };
    newPlate();
    for (const it of sorted) {
      let w = it.w, h = it.h, rot = false;
      if (w > W && h <= W && w <= H) { [w, h] = [h, w]; rot = true; }
      if (x + w > W) { x = 0; y += rowH + g; rowH = 0; }
      if (y + h > H) { newPlate(); }
      cur.items.push({ x: pr.margin + x, y: pr.margin + y, w, h, rot, ref: it.ref });
      x += w + g; rowH = Math.max(rowH, h);
    }
    return plates.filter(p => p.items.length);
  }

  // ---------- file writers ----------
  function stlBinary(m, name) {
    const nt = m.f.length / 3;
    const buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
    const hdr = ('relief ' + (name || '')).slice(0, 79);
    for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i) & 0x7f);
    dv.setUint32(80, nt, true);
    let o = 84; const v = m.v, f = m.f;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
      for (const k of [a, b, c]) { dv.setFloat32(o, v[k], true); dv.setFloat32(o + 4, v[k + 1], true); dv.setFloat32(o + 8, v[k + 2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  const esc = s => String(s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  // objects: [{name, mesh, x, y}] mesh in local coords (min corner at 0,0)
  function model3mf(objects, colorHex) {
    const parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<metadata name="Application">Relief Wall Panel</metadata>\n<resources>\n');
    if (colorHex) parts.push(`<basematerials id="1"><base name="filament" displaycolor="${colorHex.toUpperCase()}FF"/></basematerials>\n`);
    objects.forEach((o, i) => {
      const id = i + 2;
      parts.push(`<object id="${id}" type="model" name="${esc(o.name)}"${colorHex ? ' pid="1" pindex="0"' : ''}><mesh><vertices>`);
      const v = o.mesh.v; let s = '';
      for (let k = 0; k < v.length; k += 3) s += `<vertex x="${v[k].toFixed(3)}" y="${v[k + 1].toFixed(3)}" z="${v[k + 2].toFixed(3)}"/>`;
      parts.push(s, '</vertices><triangles>');
      const f = o.mesh.f; s = '';
      for (let k = 0; k < f.length; k += 3) s += `<triangle v1="${f[k]}" v2="${f[k + 1]}" v3="${f[k + 2]}"/>`;
      parts.push(s, '</triangles></mesh></object>\n');
    });
    parts.push('</resources>\n<build>\n');
    objects.forEach((o, i) => parts.push(`<item objectid="${i + 2}" transform="1 0 0 0 1 0 0 0 1 ${o.x.toFixed(3)} ${o.y.toFixed(3)} 0"/>\n`));
    parts.push('</build>\n</model>\n');
    return parts.join('');
  }
  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

  // translate a mesh so its XY bbox min is at origin; optionally rotate 90°
  function localize(m, rot) {
    const out = new Mesh(); out.f = m.f.slice();
    let x0 = Infinity, y0 = Infinity;
    const v = m.v.slice();
    if (rot) for (let i = 0; i < v.length; i += 3) { const x = v[i]; v[i] = -v[i + 1]; v[i + 1] = x; }
    let z0 = Infinity;
    for (let i = 0; i < v.length; i += 3) { x0 = Math.min(x0, v[i]); y0 = Math.min(y0, v[i + 1]); z0 = Math.min(z0, v[i + 2]); }
    for (let i = 0; i < v.length; i += 3) { v[i] -= x0; v[i + 1] -= y0; v[i + 2] -= z0; }
    out.v = v; return out;
  }

  root.WallEngine = {
    rng, area, centroid, ccw, bbox, inside, clipConvex, simplify, inset, isConvexCCW,
    makeShape, tessellate, surfaceAt, fieldAt, modsAt, build, setApex, subdivide, convexHull,
    Mesh, pieceMesh, tileMesh, placeLabel, textGlyphs, prism, annulus, meshVolume, checkManifold,
    packPlates, extrudeGeom, stlBinary, model3mf, CONTENT_TYPES, RELS, localize, esc, collarColumn, notchCut,
    clampSpec, clampProfile, clampMesh, clampPlaced
  };
})(typeof window !== 'undefined' ? window : globalThis);
