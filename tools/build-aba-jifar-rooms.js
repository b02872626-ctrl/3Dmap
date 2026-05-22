#!/usr/bin/env node
// Build the Aba Jifar rooms JSON from the two SVG floor plans.
// Output: app/js/aba-jifar-rooms.json   (imported by data.js)
//
// Run with:  node tools/build-aba-jifar-rooms.js
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCALE = 0.06;
const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), "..") + "/";

// Map (color → roomId) per floor. Derived by inspecting the SVGs:
//   Ground floor (Asset 1) — 11 colours, all unique.
//   First  floor (Asset 2) — 7 colours, with 3 family rooms sharing
//   adjacent colors (the brown U-shape is a single path containing
//   Industry + Agriculture + Trade and needs separate handling).
const groundColorMap = {
  "#e4e0ce": "4",   // Aba Jifar II (cream)
  "#dcc4a2": "2",   // Geda System (tan)
  "#967c5d": "3",   // State Formation (dark olive)
  "#f5e0c5": "1",   // Entrance (cream)
  "#e6c2ae": "5",   // Role of Islam (peach)
  "#d6c7b2": "16",  // Construction Method (light tan)
  "#d8c18f": "18",  // Courtyard (gold)
  "#bab1a0": "17",  // Wrestling (grey)
  "#a4624c": "15",  // Gibe Kingdom (rust)
  "#d3bbae": "19",  // Women's Role (pink)
  "#d6c996": "20",  // Banquet Hall (gold)
};

const firstColorMap = {
  "#bbb49e": "8",   // Administration (top strip)
  "#e1e0d6": "7",   // Military
  "#666452": "6",   // Justice
  "#9fa596": "14",  // Family Room 3 (sage)
  "#aca29b": "13",  // Family Room 2 (grey)
  "#bba37e": "12",  // Family Room 1 (tan)
  // The single big #94877a path is the combined U-shape and is split
  // into 10/9/11 manually below.
};

function parseSvg(path) {
  const json = execSync(`node "${ROOT}tools/parse-svg.js" "${path}"`, {
    encoding: "utf8",
  });
  return JSON.parse(json);
}

function polyByColor(data, color) {
  return data.polygons.find((p) => p.color === color);
}

function toWorld(pts) {
  // SVG x → world x, SVG y → world z, scale 0.06, no offset
  return pts.map(([x, y]) => [x * SCALE, y * SCALE]);
}

const ground = parseSvg(ROOT + "app/assets/aba-jifar-ground.svg");
const first  = parseSvg(ROOT + "app/assets/aba-jifar-first.svg");

const rooms = [];

// Ground floor — straight mapping by colour
for (const [color, id] of Object.entries(groundColorMap)) {
  const p = polyByColor(ground, color);
  if (!p) { console.warn("no polygon for ground color", color); continue; }
  rooms.push({
    id, floor: 1, color,
    bbox:   [p.x * SCALE, p.y * SCALE, p.w * SCALE, p.h * SCALE],
    points: toWorld(p.points),
  });
}

// First floor — straight mapping
for (const [color, id] of Object.entries(firstColorMap)) {
  const p = polyByColor(first, color);
  if (!p) { console.warn("no polygon for first color", color); continue; }
  rooms.push({
    id, floor: 2, color,
    bbox:   [p.x * SCALE, p.y * SCALE, p.w * SCALE, p.h * SCALE],
    points: toWorld(p.points),
  });
}

// Brown U-shape (#94877a) on the first floor — Industry / Agriculture /
// Trade. The SVG <path> for cls-37 contains the main 9-vertex U plus four
// tiny stray segments and a small bottom-left annex; using bbox-based
// rectangles like the parse-svg.js output suggests pulls the wings way
// past the actual building outline.
// Vertices below are the literal corners of the main U, traced from the
// SVG path `M373.1,72.18 l168.41,22.84 l-17.07,119.88 l-28.64,-4.48
// l12.36,-87.52 l-106.52,-14.81 l-11.39,88.67 l-35.47,-3.64
// l18.32,-120.93 Z` — the U is slightly rotated so we split it into the
// three quadrilaterals that make up the top bar and the two wings.
const U = {
  outerTL: [373.10,  72.18],
  outerTR: [541.51,  95.02],
  innerTL: [401.64, 108.09],
  innerTR: [508.16, 122.90],
  innerML: [390.25, 196.76],
  innerMR: [495.80, 210.42],
  outerML: [354.78, 193.12],
  outerMR: [524.44, 214.90],
};
function pushU(id, verts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of verts) {
    if (x < minX) minX = x;  if (x > maxX) maxX = x;
    if (y < minY) minY = y;  if (y > maxY) maxY = y;
  }
  rooms.push({
    id, floor: 2, color: "#94877a",
    bbox:   [minX * SCALE, minY * SCALE, (maxX - minX) * SCALE, (maxY - minY) * SCALE],
    points: verts.map(([x, y]) => [x * SCALE, y * SCALE]),
  });
}
// Top bar (Industry): outerTL → outerTR → innerTR → innerTL
pushU("10", [U.outerTL, U.outerTR, U.innerTR, U.innerTL]);
// Left wing (Agriculture): outerTL → innerTL → innerML → outerML
pushU("9",  [U.outerTL, U.innerTL, U.innerML, U.outerML]);
// Right wing (Trade): outerTR → outerMR → innerMR → innerTR
pushU("11", [U.outerTR, U.outerMR, U.innerMR, U.innerTR]);

// =============================================================
//  Roads: extracted from the dense hatching in the ground-floor SVG.
//  Process:
//   1. Bin every hatch stroke endpoint into a fine grid (8 SVG units
//      ≈ 0.5 world). Cells with ≥ 1 point are "paved".
//   2. Dilate once so adjacent cells join through hatch gaps.
//   3. 4-connected components → one per paved area.
//   4. For each component, trace the outer rectilinear boundary
//      → returned as a closed polygon of world coords. This means
//      a road FOLLOWS the actual painted outline of the paving,
//      not just its bbox.
//   Only components whose bbox sits in the bottom band (z > 30)
//   are kept (the user asked for "roads at the bottom").
// =============================================================
function extractBottomRoads(svgText, viewBox) {
  const [, , vbW, vbH] = viewBox;
  const HATCH_CLASSES = new Set(["cls-13", "cls-4", "cls-9", "cls-18", "cls-20"]);
  const tagRe = /<(line|polyline|polygon|path)\s+([^/>]+)\/?>/g;
  const points = [];
  for (const m of svgText.matchAll(tagRe)) {
    const attrs = m[2];
    const cls = /class="(cls-\d+)"/.exec(attrs);
    if (!cls || !HATCH_CLASSES.has(cls[1])) continue;
    const coords = /(?:points|d)="([^"]+)"/.exec(attrs);
    if (!coords) continue;
    const nums = (coords[1].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i], y = nums[i + 1];
      if (x >= 0 && x <= vbW && y >= 0 && y <= vbH) points.push([x, y]);
    }
  }

  // Fine grid — 8 SVG units per cell (~0.48 world units).
  const CELL = 8;
  const GX = Math.ceil(vbW / CELL), GY = Math.ceil(vbH / CELL);
  const filled = new Uint8Array(GX * GY);
  for (const [x, y] of points) {
    const gx = Math.min(GX - 1, (x / CELL) | 0);
    const gy = Math.min(GY - 1, (y / CELL) | 0);
    filled[gy * GX + gx] = 1;
  }
  // One pass of dilation (4-neighbors) so neighbouring hatch strokes
  // separated by 1 empty cell still join into a single polygon.
  const dilated = new Uint8Array(filled);
  for (let gy = 0; gy < GY; gy++) {
    for (let gx = 0; gx < GX; gx++) {
      if (filled[gy * GX + gx]) continue;
      let any = 0;
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
        if (filled[ny * GX + nx]) { any = 1; break; }
      }
      if (any) dilated[gy * GX + gx] = 1;
    }
  }

  // 4-connected components.
  const visited = new Uint8Array(GX * GY);
  const clusters = [];
  for (let i = 0; i < GX * GY; i++) {
    if (!dilated[i] || visited[i]) continue;
    const stack = [i]; const comp = [];
    while (stack.length) {
      const n = stack.pop();
      if (visited[n]) continue;
      visited[n] = 1; comp.push(n);
      const gx = n % GX, gy = (n / GX) | 0;
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
        const nk = ny * GX + nx;
        if (dilated[nk] && !visited[nk]) stack.push(nk);
      }
    }
    clusters.push(comp);
  }

  // For each component, trace its outer rectilinear boundary.
  function traceBoundary(cells) {
    const set = new Set(cells);
    const has = (gx, gy) => gx >= 0 && gy >= 0 && gx < GX && gy < GY && set.has(gy * GX + gx);

    // Collect every cell-edge that has a filled cell on one side and
    // empty on the other. Each edge is keyed by its two corner points.
    const edges = new Map(); // "x1,y1|x2,y2" → [[x1,y1],[x2,y2]]
    const addEdge = (x1, y1, x2, y2) => {
      const k = `${x1},${y1}|${x2},${y2}`;
      edges.set(k, [[x1, y1], [x2, y2]]);
    };
    for (const cell of cells) {
      const gx = cell % GX, gy = (cell / GX) | 0;
      // Top edge
      if (!has(gx, gy - 1)) addEdge(gx, gy, gx + 1, gy);
      // Bottom edge
      if (!has(gx, gy + 1)) addEdge(gx + 1, gy + 1, gx, gy + 1);
      // Left edge
      if (!has(gx - 1, gy)) addEdge(gx, gy + 1, gx, gy);
      // Right edge
      if (!has(gx + 1, gy)) addEdge(gx + 1, gy, gx + 1, gy + 1);
    }

    if (edges.size === 0) return null;

    // Chain edges by walking corner → next-edge-starting-at-this-corner.
    const byStart = new Map(); // "x,y" → [edges starting here]
    for (const [, [a, b]] of edges) {
      const k = `${a[0]},${a[1]}`;
      if (!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push([a, b]);
    }

    // Start at the lowest-y / lowest-x corner — guaranteed to be on the
    // outer ring (not an inner hole).
    const first = [...edges.values()].sort((e1, e2) => {
      const [a1] = e1, [a2] = e2;
      return a1[1] - a2[1] || a1[0] - a2[0];
    })[0];

    const polygon = [first[0]];
    let cur = first[1], prevEdge = first;
    const used = new Set();
    used.add(`${first[0][0]},${first[0][1]}|${first[1][0]},${first[1][1]}`);
    let safety = edges.size + 4;
    while (safety-- > 0) {
      polygon.push(cur);
      const candidates = byStart.get(`${cur[0]},${cur[1]}`) || [];
      // Prefer the candidate that turns LEFT (CCW); fall back to right.
      const [px, py] = prevEdge[0];
      const dirIn = [cur[0] - px, cur[1] - py];
      let pick = null;
      let bestCross = -Infinity;
      for (const cand of candidates) {
        const k = `${cand[0][0]},${cand[0][1]}|${cand[1][0]},${cand[1][1]}`;
        if (used.has(k)) continue;
        const dirOut = [cand[1][0] - cand[0][0], cand[1][1] - cand[0][1]];
        // Cross product Z (dirIn × dirOut). Positive = LEFT turn.
        const cross = dirIn[0] * dirOut[1] - dirIn[1] * dirOut[0];
        if (cross > bestCross) { bestCross = cross; pick = cand; }
      }
      if (!pick) break;
      used.add(`${pick[0][0]},${pick[0][1]}|${pick[1][0]},${pick[1][1]}`);
      prevEdge = pick;
      cur = pick[1];
      if (cur[0] === first[0][0] && cur[1] === first[0][1]) break;
    }
    return polygon;
  }

  const roads = [];
  for (const comp of clusters) {
    if (comp.length < 20) continue;
    const gxs = comp.map((k) => k % GX);
    const gys = comp.map((k) => (k / GX) | 0);
    const minX = Math.min(...gxs) * CELL;
    const minY = Math.min(...gys) * CELL;
    const maxX = (Math.max(...gxs) + 1) * CELL;
    const maxY = (Math.max(...gys) + 1) * CELL;
    if (minY * SCALE < 30) continue;   // bottom band only

    const poly = traceBoundary(comp);
    if (!poly) continue;
    // Convert grid corners → SVG units → world units.
    const points = poly.map(([gx, gy]) => [gx * CELL * SCALE, gy * CELL * SCALE]);

    roads.push({
      id: `road-${roads.length + 1}`,
      bbox: [minX * SCALE, minY * SCALE, (maxX - minX) * SCALE, (maxY - minY) * SCALE],
      points,
      cellCount: comp.length,
    });
  }
  // Sort left → right for stable ids.
  roads.sort((a, b) => a.bbox[0] - b.bbox[0]);
  roads.forEach((r, i) => { r.id = `road-${i + 1}`; });
  return roads;
}

// =============================================================
//  Doors: extracted from the architectural plan's door-swing arcs.
//  Doors are drawn as polylines approximating a curved arc (the
//  swing of the door leaf). Pattern: 5+ points, total length 3–14
//  SVG units, > 40° turn from first to last segment.
//  Arcs come in pairs (the swing + the frame line) — we cluster
//  any arcs within 4 SVG units into a single door position.
// =============================================================
function extractDoors(svgText) {
  function isArc(pts) {
    if (pts.length < 5) return false;
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    if (L < 3 || L > 14) return false;
    const a0 = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]);
    const a1 = Math.atan2(
      pts[pts.length - 1][1] - pts[pts.length - 2][1],
      pts[pts.length - 1][0] - pts[pts.length - 2][0],
    );
    let d = a1 - a0;
    while (d > Math.PI)  d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) > (40 * Math.PI / 180);
  }

  const arcs = [];
  const re = /<(polyline|path)\s+([^/>]+)\/?>/g;
  for (const m of svgText.matchAll(re)) {
    const attrs = m[2];
    const coords = /(?:points|d)="([^"]+)"/.exec(attrs);
    if (!coords) continue;
    const nums = (coords[1].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (nums.length < 8) continue;
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (!isArc(pts)) continue;
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    arcs.push([cx / pts.length, cy / pts.length]);
  }

  // Cluster arc centroids: every arc within CLUSTER_RADIUS of another
  // joins its cluster. Each cluster = 1 door at the cluster centroid.
  // 8 SVG units catches both arcs of a real door swing (which sit ~3-6
  // units apart) but is small enough to avoid merging distinct doors.
  const CLUSTER_RADIUS = 8;
  const assigned = new Array(arcs.length).fill(-1);
  const clusters = [];
  for (let i = 0; i < arcs.length; i++) {
    if (assigned[i] !== -1) continue;
    const c = clusters.length;
    clusters.push([arcs[i]]);
    assigned[i] = c;
    // BFS-style expand the cluster
    const queue = [i];
    while (queue.length) {
      const k = queue.shift();
      for (let j = 0; j < arcs.length; j++) {
        if (assigned[j] !== -1) continue;
        const dx = arcs[j][0] - arcs[k][0], dy = arcs[j][1] - arcs[k][1];
        if (dx * dx + dy * dy < CLUSTER_RADIUS * CLUSTER_RADIUS) {
          assigned[j] = c;
          clusters[c].push(arcs[j]);
          queue.push(j);
        }
      }
    }
  }
  // A real door is drawn as ≥ 2 arcs (the swing + at least one frame).
  // Single-arc clusters are mostly stray hatching or column outlines.
  const doors = clusters
    .filter((c) => c.length >= 2)
    .map((c, i) => {
      let x = 0, y = 0;
      for (const p of c) { x += p[0]; y += p[1]; }
      return {
        id: `door-${i + 1}`,
        svg: [x / c.length, y / c.length],
        pos: [(x / c.length) * SCALE, (y / c.length) * SCALE],
        arcCount: c.length,
      };
    });
  return doors;
}

const groundSvg = readFileSync(ROOT + "app/assets/aba-jifar-ground.svg", "utf8");
const roads = extractBottomRoads(groundSvg, ground.viewBox);
const doorsRaw = extractDoors(groundSvg);

// Associate each door with the closest room on floor 1, and a secondary
// room if one is on the other side of the door's edge. Pure distance
// from door position to room bbox; rooms further than DOOR_MAX_DIST are
// not associated (an unattached door = building edge facing outdoors).
const DOOR_MAX_DIST = 1.4;  // world units
function nearestRooms(door) {
  const [dx, dz] = door.pos;
  const candidates = rooms
    .filter((r) => r.floor === 1)
    .map((r) => {
      const [rx, rz, rw, rh] = r.bbox;
      const cx = Math.max(rx, Math.min(rx + rw, dx));
      const cz = Math.max(rz, Math.min(rz + rh, dz));
      return { id: r.id, dist: Math.hypot(cx - dx, cz - dz) };
    })
    .sort((a, b) => a.dist - b.dist)
    .filter((c) => c.dist <= DOOR_MAX_DIST);
  return candidates.slice(0, 2).map((c) => c.id);
}
const doors = doorsRaw
  .map((d) => ({ ...d, rooms: nearestRooms(d) }))
  .filter((d) => d.rooms.length > 0);   // drop arcs not attached to any room

const out = {
  scale: SCALE,
  svgViewBox: ground.viewBox,
  rooms,
  roads,
  doors,
};

const outPath = ROOT + "app/js/aba-jifar-rooms.json";
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${rooms.length} rooms + ${roads.length} roads + ${doors.length}/${doorsRaw.length} doors → ${outPath}`);
for (const d of doors) {
  console.log(`  ${d.id}: world (${d.pos[0].toFixed(2)}, ${d.pos[1].toFixed(2)})  attached: [${d.rooms.join(", ")}]`);
}
