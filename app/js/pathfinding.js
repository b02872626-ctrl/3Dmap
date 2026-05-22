// =============================================================
//  Pathfinding: build a navigation graph from the room data
//  and run Dijkstra. Graph nodes:
//   · room      — one per room, positioned at its center
//   · doorway   — midpoint of each shared edge between two rooms
//   · (elevator nodes are just room nodes whose .room.icon is set)
//  Elevators with the same letter (A/B/C/D) are linked across
//  floors with a fixed ride cost so multi-floor routes pick the
//  best vertical-circulation point automatically.
//
//  Coordinates are in plan-space, centered on the building (same
//  as the rendered floor groups), so a path can be drawn directly
//  inside each floor group without transforms.
// =============================================================
import { ROOMS, FLOORS, PLAN_BOUNDS, DOORS } from "./data.js";

const PLAN_CENTER = {
  x: (PLAN_BOUNDS.minX + PLAN_BOUNDS.maxX) / 2,
  z: (PLAN_BOUNDS.minZ + PLAN_BOUNDS.maxZ) / 2,
};

const TOL = 0.05;          // edge-touching tolerance (units)
const MIN_DOOR_OVERLAP = 0.7;
const ELEVATOR_RIDE_COST = 18;  // "feels like" 18m of walking per floor change
const BRIDGE_COST_FACTOR = 1.6; // penalty for synthesized corridor bridges
const VIS_PAD = 0.05;           // segment-vs-box test pad (so a door's own wall doesn't block)

const offsetX = (x) => x - PLAN_CENTER.x;
const offsetZ = (z) => z - PLAN_CENTER.z;

export function buildGraph() {
  /** @type {Map<string, {id, x, z, floor, kind, room?}>} */
  const nodes = new Map();
  /** @type {Map<string, Array<{to, cost}>>} */
  const edges = new Map();

  const addNode = (n) => { nodes.set(n.id, n); edges.set(n.id, []); };
  const addEdge = (a, b, cost) => {
    edges.get(a).push({ to: b, cost });
    edges.get(b).push({ to: a, cost });
  };
  const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // --- 1. Add a node per room (center) ---
  for (const room of ROOMS) {
    const { x, z, w, d } = room.footprint;
    addNode({
      id: room.id,
      x: offsetX(x + w / 2),
      z: offsetZ(z + d / 2),
      floor: room.floor,
      kind: room.icon ? "elevator" : "room",
      room,
    });
  }

  // --- 2. For each adjacent pair on the same floor, add a doorway node
  //        at the midpoint of the shared edge, edges room↔doorway↔room. ---
  const byFloor = new Map();
  for (const r of ROOMS) {
    if (!byFloor.has(r.floor)) byFloor.set(r.floor, []);
    byFloor.get(r.floor).push(r);
  }

  for (const [floorId, rooms] of byFloor) {
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const door = findSharedDoorway(a, b);
        if (!door) continue;
        const doorId = `door-${a.id}-${b.id}-f${floorId}`;
        addNode({
          id: doorId,
          x: offsetX(door.x),
          z: offsetZ(door.z),
          floor: floorId,
          kind: "doorway",
        });
        const aNode = nodes.get(a.id), bNode = nodes.get(b.id), dNode = nodes.get(doorId);
        addEdge(a.id, doorId, dist2D(aNode, dNode));
        addEdge(b.id, doorId, dist2D(bNode, dNode));
      }
    }
  }

  // --- 3. Link elevators with the same letter across floors ---
  const byLetter = new Map();
  for (const n of nodes.values()) {
    if (n.kind === "elevator" && n.room?.icon) {
      const letter = n.room.icon;
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter).push(n);
    }
  }
  for (const stops of byLetter.values()) {
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const floors = Math.abs(stops[i].floor - stops[j].floor);
        addEdge(stops[i].id, stops[j].id, ELEVATOR_RIDE_COST * floors);
      }
    }
  }

  // --- 4. Doors + outdoor visibility paths (ground floor only).
  //        Each extracted door becomes a node. Doors link to their
  //        attached room(s) via short edges (room → door midpoint).
  //        Door-to-door edges exist whenever a straight line between
  //        them doesn't cross any other room's bbox — i.e. the path
  //        goes AROUND the buildings, never through them. These are
  //        "the roads around the blocks". ---
  if (DOORS && DOORS.length) {
    const floor1RoomBoxes = ROOMS
      .filter((r) => r.floor === 1)
      .map((r) => ({
        id: r.id,
        x1: r.footprint.x,
        z1: r.footprint.z,
        x2: r.footprint.x + r.footprint.w,
        z2: r.footprint.z + r.footprint.d,
      }));

    for (const door of DOORS) {
      addNode({
        id:   door.id,
        x:    offsetX(door.x),
        z:    offsetZ(door.z),
        floor: 1,
        kind:  "door",
        door,
      });
      // door ↔ attached room edge
      for (const roomId of door.rooms) {
        const roomN = nodes.get(roomId);
        if (!roomN) continue;
        const doorN = nodes.get(door.id);
        addEdge(roomId, door.id, dist2D(roomN, doorN));
      }
    }

    // door ↔ door visibility paths
    for (let i = 0; i < DOORS.length; i++) {
      for (let j = i + 1; j < DOORS.length; j++) {
        const a = DOORS[i], b = DOORS[j];
        // Same-room door pairs always connect (intra-room movement).
        const sharedRoom = a.rooms.some((r) => b.rooms.includes(r));
        if (sharedRoom) {
          const aN = nodes.get(a.id), bN = nodes.get(b.id);
          addEdge(a.id, b.id, dist2D(aN, bN));
          continue;
        }
        // Otherwise check line-of-sight against rooms that aren't
        // hosting either door.
        const ownRooms = new Set([...a.rooms, ...b.rooms]);
        let blocked = false;
        for (const box of floor1RoomBoxes) {
          if (ownRooms.has(box.id)) continue;
          if (segmentIntersectsBox(a.x, a.z, b.x, b.z, box)) {
            blocked = true; break;
          }
        }
        if (!blocked) {
          const aN = nodes.get(a.id), bN = nodes.get(b.id);
          addEdge(a.id, b.id, dist2D(aN, bN));
        }
      }
    }
  }

  // --- 5. Connectivity pass: per floor, find disconnected components and
  //        bridge them with a single short edge to the largest component.
  //        This handles isolated amenities (entrance, café row…). ---
  ensureFloorConnectivity({ nodes, edges });

  return { nodes, edges };
}

// True if segment (x1,z1)→(x2,z2) crosses the axis-aligned box. Padded
// inward so segments that just graze a wall (a door's own room) don't
// count as crossings.
function segmentIntersectsBox(x1, z1, x2, z2, box) {
  const bx1 = box.x1 + VIS_PAD, bx2 = box.x2 - VIS_PAD;
  const bz1 = box.z1 + VIS_PAD, bz2 = box.z2 - VIS_PAD;
  const dx = x2 - x1, dz = z2 - z1;
  let tEnter = 0, tExit = 1;
  for (const [p, q] of [[-dx, x1 - bx1], [dx, bx2 - x1], [-dz, z1 - bz1], [dz, bz2 - z1]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > tExit) return false;
        if (t > tEnter) tEnter = t;
      } else {
        if (t < tEnter) return false;
        if (t < tExit) tExit = t;
      }
    }
  }
  return tEnter < tExit;
}

function findSharedDoorway(a, b) {
  const ax1 = a.footprint.x, az1 = a.footprint.z;
  const ax2 = ax1 + a.footprint.w, az2 = az1 + a.footprint.d;
  const bx1 = b.footprint.x, bz1 = b.footprint.z;
  const bx2 = bx1 + b.footprint.w, bz2 = bz1 + b.footprint.d;

  // North/South shared edge?
  if (Math.abs(az1 - bz2) < TOL || Math.abs(az2 - bz1) < TOL) {
    const x1 = Math.max(ax1, bx1), x2 = Math.min(ax2, bx2);
    if (x2 - x1 < MIN_DOOR_OVERLAP) return null;
    const z = Math.abs(az1 - bz2) < TOL ? az1 : az2;
    return { x: (x1 + x2) / 2, z };
  }
  // East/West shared edge?
  if (Math.abs(ax1 - bx2) < TOL || Math.abs(ax2 - bx1) < TOL) {
    const z1 = Math.max(az1, bz1), z2 = Math.min(az2, bz2);
    if (z2 - z1 < MIN_DOOR_OVERLAP) return null;
    const x = Math.abs(ax1 - bx2) < TOL ? ax1 : ax2;
    return { x, z: (z1 + z2) / 2 };
  }
  return null;
}

function ensureFloorConnectivity({ nodes, edges }) {
  const floors = new Map();
  for (const n of nodes.values()) {
    if (!floors.has(n.floor)) floors.set(n.floor, []);
    floors.get(n.floor).push(n);
  }
  const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  for (const [floorId, list] of floors) {
    const visited = new Set();
    const components = [];
    for (const start of list) {
      if (visited.has(start.id)) continue;
      const comp = [];
      const queue = [start];
      while (queue.length) {
        const n = queue.shift();
        if (visited.has(n.id)) continue;
        visited.add(n.id);
        comp.push(n);
        for (const e of edges.get(n.id) || []) {
          const m = nodes.get(e.to);
          if (m.floor !== floorId) continue;
          if (!visited.has(m.id)) queue.push(m);
        }
      }
      components.push(comp);
    }
    if (components.length <= 1) continue;
    components.sort((a, b) => b.length - a.length);
    const main = new Set(components[0].map((n) => n.id));
    for (let i = 1; i < components.length; i++) {
      const sub = components[i];
      let best = null;
      for (const a of sub) {
        for (const bId of main) {
          const b = nodes.get(bId);
          const d = dist2D(a, b);
          if (!best || d < best.d) best = { a: a.id, b: bId, d };
        }
      }
      if (best) {
        const cost = best.d * BRIDGE_COST_FACTOR;
        edges.get(best.a).push({ to: best.b, cost });
        edges.get(best.b).push({ to: best.a, cost });
        for (const n of sub) main.add(n.id);
      }
    }
  }
}

// =============================================================
//  Dijkstra
// =============================================================
export function findPath(graph, startId, endId) {
  const { nodes, edges } = graph;
  if (!nodes.has(startId) || !nodes.has(endId)) return null;
  if (startId === endId) return { nodes: [nodes.get(startId)], totalCost: 0 };

  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  for (const id of nodes.keys()) dist.set(id, Infinity);
  dist.set(startId, 0);

  while (true) {
    // linear scan PQ — graph is small (a few hundred nodes max)
    let current = null, currentDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        current = id; currentDist = d;
      }
    }
    if (current === null) break;
    if (current === endId) break;
    visited.add(current);
    for (const { to, cost } of edges.get(current)) {
      if (visited.has(to)) continue;
      const alt = currentDist + cost;
      if (alt < dist.get(to)) {
        dist.set(to, alt);
        prev.set(to, current);
      }
    }
  }

  if (!prev.has(endId)) return null;

  const path = [];
  let cur = endId;
  while (cur !== undefined) {
    path.unshift(nodes.get(cur));
    if (cur === startId) break;
    cur = prev.get(cur);
  }
  return { nodes: path, totalCost: dist.get(endId) };
}

// =============================================================
//  describePath: turn a list of path nodes into a Situm-style
//  step list (verb + distance) plus total distance + walking time.
// =============================================================
const WALK_SPEED_MPS = 1.25;
const MIN_TURN_DEG     = 12;
const SLIGHT_TURN_DEG  = 38;
const SHARP_TURN_DEG   = 130;

export function describePath(pathNodes) {
  if (!pathNodes || pathNodes.length < 2) {
    return { sections: [], steps: [], totalDistance: 0, totalTime: 0, elevators: [] };
  }

  // Slice into per-floor segments (each elevator hop bumps the floor)
  const segments = [];
  let cur = { floor: pathNodes[0].floor, nodes: [pathNodes[0]] };
  for (let i = 1; i < pathNodes.length; i++) {
    const n = pathNodes[i];
    if (n.floor !== cur.floor) {
      segments.push(cur);
      cur = { floor: n.floor, nodes: [n] };
    } else {
      cur.nodes.push(n);
    }
  }
  segments.push(cur);

  const sections = [];
  const flatSteps = [];
  const elevators = [];
  let totalDistance = 0;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const isLastSegment = s === segments.length - 1;

    // Section header
    const headerLabel = isLastSegment
      ? `Navigate to ${pathNodes[pathNodes.length - 1].room?.name ?? "destination"}`
      : `Advance to Elevator ${seg.nodes[seg.nodes.length - 1]?.room?.icon ?? ""}`.trim();
    const section = { title: headerLabel, floor: seg.floor, steps: [] };

    const segSteps = describeFloorSegment(seg.nodes, seg.floor);
    totalDistance += segSteps.distance;
    section.steps.push(...segSteps.steps);
    flatSteps.push(...segSteps.steps);

    // Elevator transition between segments
    if (!isLastSegment) {
      const elevatorNode = seg.nodes[seg.nodes.length - 1];
      const nextFloor = segments[s + 1].floor;
      const letter = elevatorNode?.room?.icon ?? "?";
      const elevatorStep = {
        kind: "elevator",
        icon: letter,
        text: `Take Elevator ${letter} to Floor ${nextFloor}`,
        fromFloor: seg.floor,
        toFloor: nextFloor,
        floor: seg.floor,
        startX: elevatorNode?.x ?? 0,
        startZ: elevatorNode?.z ?? 0,
        endX: elevatorNode?.x ?? 0,
        endZ: elevatorNode?.z ?? 0,
      };
      section.steps.push(elevatorStep);
      flatSteps.push(elevatorStep);
      elevators.push(letter);
    }
    sections.push(section);
  }

  // Final "arrive" tag inside the last section
  const last = pathNodes[pathNodes.length - 1];
  const arrive = {
    kind: "arrive",
    icon: "✓",
    text: `Finally, reach ${last.room?.name ?? "destination"}`,
    floor: last.floor,
    floorLabel: `On floor ${last.floor}`,
    startX: last.x,
    startZ: last.z,
    endX: last.x,
    endZ: last.z,
  };
  sections[sections.length - 1].steps.push(arrive);
  flatSteps.push(arrive);

  return {
    sections,
    steps: flatSteps,
    totalDistance: Math.round(totalDistance),
    totalTime: Math.max(1, Math.round(totalDistance / WALK_SPEED_MPS / 60)),
    elevators: [...new Set(elevators)],
  };
}

function describeFloorSegment(nodes, floor) {
  if (nodes.length < 2) return { steps: [], distance: 0 };

  // 1. Simplify consecutive collinear points (kills tiny zig-zags from
  //    doorway midpoints sitting on the path).
  const simplified = simplifyPolyline(nodes, 0.09); // ~5° tolerance

  // 2. Walk the polyline, emit "(turn) and go ahead for X m" steps.
  //    Each step records the start position + bearing of the straight
  //    segment it represents, so the UI can fly to it on click.
  const steps = [];
  let distance = 0;
  let lastBearing = null;
  let pendingTurn = null;
  let runningDist = 0;
  let segmentStart = simplified[0];
  let stepIndex = 0;

  for (let i = 0; i < simplified.length - 1; i++) {
    const a = simplified[i];
    const b = simplified[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) continue;
    const bearing = Math.atan2(dx, dz);

    if (lastBearing !== null) {
      let diff = bearing - lastBearing;
      while (diff >  Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const turn = classifyTurn(diff);
      if (turn) {
        if (runningDist > 0) {
          steps.push(formatStep(pendingTurn, runningDist, stepIndex++, {
            startX: segmentStart.x, startZ: segmentStart.z,
            endX:   a.x,            endZ:   a.z,
            bearing: lastBearing,
            floor,
          }));
          distance += runningDist;
          runningDist = 0;
        }
        pendingTurn = turn;
        segmentStart = a;
      }
    }
    runningDist += d;
    lastBearing = bearing;
  }
  if (runningDist > 0) {
    const tail = simplified[simplified.length - 1];
    steps.push(formatStep(pendingTurn, runningDist, stepIndex++, {
      startX: segmentStart.x, startZ: segmentStart.z,
      endX:   tail.x,         endZ:   tail.z,
      bearing: lastBearing,
      floor,
    }));
    distance += runningDist;
  }
  return { steps, distance };
}

function simplifyPolyline(nodes, angleTol) {
  if (nodes.length <= 2) return nodes.slice();
  const out = [nodes[0]];
  for (let i = 1; i < nodes.length - 1; i++) {
    const p = nodes[i - 1], c = nodes[i], n = nodes[i + 1];
    const a1 = Math.atan2(c.x - p.x, c.z - p.z);
    const a2 = Math.atan2(n.x - c.x, n.z - c.z);
    let diff = a2 - a1;
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > angleTol) out.push(c);
  }
  out.push(nodes[nodes.length - 1]);
  return out;
}

function classifyTurn(diffRad) {
  // In our coordinate system: +X = east, +Z = south. atan2(dx, dz) gives
  // a bearing CCW from south. For a walker, positive Δ bearing = LEFT.
  const deg = Math.abs(diffRad) * 180 / Math.PI;
  if (deg < MIN_TURN_DEG) return null;
  const dir = diffRad > 0 ? "left" : "right";
  let intensity = "normal";
  if (deg < SLIGHT_TURN_DEG)      intensity = "slight";
  else if (deg > SHARP_TURN_DEG)  intensity = "sharp";
  return { dir, intensity, deg };
}

function formatStep(turn, dist, index, pos) {
  const dStr = `${dist.toFixed(0)} m`;
  const base = pos ? { ...pos } : {};
  if (!turn) {
    return { kind: "walk", icon: "↑", text: `Go forward ${dStr}`, ...base };
  }
  const slight = turn.intensity === "slight";
  const sharp  = turn.intensity === "sharp";
  const icon = slight
    ? (turn.dir === "right" ? "↗" : "↖")
    : (turn.dir === "right" ? "→" : "←");
  const prefix = index === 0 ? "" : (index === 1 ? "Then, " : "Straight after, ");
  const verb = sharp ? "turn sharply"
                     : slight ? "turn slightly"
                              : "turn";
  return {
    kind: "turn",
    icon,
    direction: turn.dir,
    text: `${prefix}${prefix ? verb : capitalize(verb)} ${turn.dir} and go ahead for ${dStr}`,
    ...base,
  };
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
