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

// Brown U-shape (#94877a) on the first floor: split into 9/10/11 by
// using the bounding box of its points. The path traces the U outline
// — top bar + two wings — which we partition by Y range.
const u = polyByColor(first, "#94877a");
if (u) {
  // Top bar spans full width over the upper part; wings extend down on
  // the left and right. Split by Y around the middle of the top bar.
  const topBarBottom = u.y + 36;  // ~ SVG units, where the top bar ends
  rooms.push({
    id: "10", floor: 2, color: "#94877a",
    bbox: [u.x * SCALE, u.y * SCALE, u.w * SCALE, 36 * SCALE],
    points: [
      [u.x, u.y], [u.x + u.w, u.y],
      [u.x + u.w, topBarBottom], [u.x, topBarBottom],
    ].map(([x, y]) => [x * SCALE, y * SCALE]),
  });
  // Left wing (Agriculture)
  const wingW = 35;
  rooms.push({
    id: "9", floor: 2, color: "#94877a",
    bbox: [u.x * SCALE, topBarBottom * SCALE, wingW * SCALE, (u.h - 36) * SCALE],
    points: [
      [u.x, topBarBottom], [u.x + wingW, topBarBottom],
      [u.x + wingW, u.y + u.h], [u.x, u.y + u.h],
    ].map(([x, y]) => [x * SCALE, y * SCALE]),
  });
  // Right wing (Trade)
  rooms.push({
    id: "11", floor: 2, color: "#94877a",
    bbox: [(u.x + u.w - wingW) * SCALE, topBarBottom * SCALE, wingW * SCALE, (u.h - 36) * SCALE],
    points: [
      [u.x + u.w - wingW, topBarBottom], [u.x + u.w, topBarBottom],
      [u.x + u.w, u.y + u.h], [u.x + u.w - wingW, u.y + u.h],
    ].map(([x, y]) => [x * SCALE, y * SCALE]),
  });
}

const out = {
  scale: SCALE,
  svgViewBox: ground.viewBox,
  rooms,
};

const outPath = ROOT + "app/js/aba-jifar-rooms.json";
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${rooms.length} rooms → ${outPath}`);
