#!/usr/bin/env node
// Parse Aba Jifar SVG floor plans and print each colored polygon's
// bounding box. Used to generate room coords from the original drawings.
//
// Usage:  node tools/parse-svg.js path/to/floor.svg
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node parse-svg.js <file.svg>");
  process.exit(1);
}
const svg = readFileSync(path, "utf8");

// 1. Build a map of cls-NN → fill color from the <style> block.
const classToColor = new Map();
const classRe = /\.cls-(\d+)\s*\{\s*fill:\s*(#[0-9a-fA-F]+)/g;
for (const m of svg.matchAll(classRe)) {
  classToColor.set(`cls-${m[1]}`, m[2].toLowerCase());
}

// 2. Walk every <polygon> AND every <path> that has a filled class.
const found = [];

function addBBox(cls, coords) {
  const color = classToColor.get(cls);
  if (!color || color === "#fff" || color === "#ffffff") return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pts = [];
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i], y = coords[i + 1];
    if (!isFinite(x) || !isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    pts.push([+x.toFixed(2), +y.toFixed(2)]);
  }
  if (!isFinite(minX) || !isFinite(minY)) return;
  found.push({
    class: cls, color,
    x: minX, y: minY,
    w: maxX - minX, h: maxY - minY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    area: (maxX - minX) * (maxY - minY),
    points: pts,
  });
}

// Polygons: points are absolute coords.
const polyRe = /<polygon[^>]*class="(cls-\d+)"[^>]*points="([^"]+)"/g;
for (const m of svg.matchAll(polyRe)) {
  const coords = m[2].trim().split(/[\s,]+/).map(Number);
  addBBox(m[1], coords);
}

// Paths: parse 'd' attribute. We only need the bbox so iterate through
// every M/m/L/l/H/h/V/v command and keep a running absolute pen position.
const pathRe = /<path[^>]*class="(cls-\d+)"[^>]*d="([^"]+)"/g;
for (const m of svg.matchAll(pathRe)) {
  const cls = m[1];
  if (!classToColor.has(cls)) continue;
  const d = m[2];
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let x = 0, y = 0;
  let cmd = "";
  const coords = [];
  const flush = () => coords.push(x, y);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) { cmd = t; i++; continue; }
    // Otherwise t is a number — apply current command.
    const n = parseFloat(t);
    const n2 = (i + 1 < tokens.length && !isNaN(parseFloat(tokens[i + 1]))) ? parseFloat(tokens[i + 1]) : null;
    switch (cmd) {
      case "M":  x = n;  y = n2; flush(); i += 2; cmd = "L"; break;
      case "m":  x += n; y += n2; flush(); i += 2; cmd = "l"; break;
      case "L":  x = n;  y = n2; flush(); i += 2; break;
      case "l":  x += n; y += n2; flush(); i += 2; break;
      case "H":  x = n; flush(); i += 1; break;
      case "h":  x += n; flush(); i += 1; break;
      case "V":  y = n; flush(); i += 1; break;
      case "v":  y += n; flush(); i += 1; break;
      // Curves/arcs: skip to the endpoint coords only (good enough for bbox)
      case "C":  x = parseFloat(tokens[i + 4]); y = parseFloat(tokens[i + 5]); flush(); i += 6; break;
      case "c":  x += parseFloat(tokens[i + 4]); y += parseFloat(tokens[i + 5]); flush(); i += 6; break;
      case "S": case "Q": x = parseFloat(tokens[i + 2]); y = parseFloat(tokens[i + 3]); flush(); i += 4; break;
      case "s": case "q": x += parseFloat(tokens[i + 2]); y += parseFloat(tokens[i + 3]); flush(); i += 4; break;
      case "T":  x = n;  y = n2; flush(); i += 2; break;
      case "t":  x += n; y += n2; flush(); i += 2; break;
      case "A":  x = parseFloat(tokens[i + 5]); y = parseFloat(tokens[i + 6]); flush(); i += 7; break;
      case "a":  x += parseFloat(tokens[i + 5]); y += parseFloat(tokens[i + 6]); flush(); i += 7; break;
      default:   i++; break;
    }
  }
  addBBox(cls, coords);
}

// 3. Pull viewBox so caller knows the SVG coordinate range.
const vbMatch = svg.match(/viewBox="([^"]+)"/);
const viewBox = vbMatch ? vbMatch[1].split(/\s+/).map(Number) : null;

// 4. Group by color (rooms sharing a colour likely share a category).
const byColor = new Map();
for (const f of found) {
  if (!byColor.has(f.color)) byColor.set(f.color, []);
  byColor.get(f.color).push(f);
}
const colorSummary = [...byColor.entries()]
  .map(([c, arr]) => ({ color: c, count: arr.length, totalArea: Math.round(arr.reduce((s, f) => s + f.area, 0)) }))
  .sort((a, b) => b.totalArea - a.totalArea);

console.log(JSON.stringify({
  viewBox,
  polygons: found.sort((a, b) => b.area - a.area),
  colorSummary,
}, null, 2));
