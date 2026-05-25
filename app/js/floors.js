// =============================================================
//  Build floors as architectural spaces, not solid boxes:
//  · per-room colored floor tile
//  · walls only on exterior sides (computed via adjacency)
//  · interior props per category (pedestals, columns, tree…)
//  · room number labels on the floor
//  Each room becomes a THREE.Group with userData.kind === "room".
//  Hovering / clicking walks up from any hit child to that group.
// =============================================================
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { CATEGORIES, FLOORS, ROOMS, PLAN_BOUNDS, ROADS, DOORS, WAYPOINTS, WAYPOINT_EDGES, BUILDING_STYLE } from "./data.js";

const SLAB_PAD       = 1.0;
const SLAB_THICK     = 0.4;
const FLOOR_THICK    = 0.12;
const WALL_HEIGHT    = 1.9;
const WALL_THICK     = 0.18;
const TALL_BOOST     = 2.4;   // extra height for great hall walls
const SLAB_COLOR     = 0xefebdf;  // off-white slab — contrasts with dark env
const WALL_COLOR     = 0xd6cdba;  // warm gray-beige walls (darker than slab)
const TRIM_COLOR     = 0x8d8474;  // contrasting dark trim cap
const STONE_COLOR    = 0xb9af9a;  // columns / capitals / bases

const planCenter = {
  x: (PLAN_BOUNDS.minX + PLAN_BOUNDS.maxX) / 2,
  z: (PLAN_BOUNDS.minZ + PLAN_BOUNDS.maxZ) / 2,
};

const offsetX = (x) => x - planCenter.x;
const offsetZ = (z) => z - planCenter.z;

// Shared materials (reuse for perf)
const wallMat = new THREE.MeshStandardMaterial({
  color: WALL_COLOR, roughness: 0.96, metalness: 0,
});
const wallCapMat = new THREE.MeshStandardMaterial({
  color: TRIM_COLOR, roughness: 0.8, metalness: 0,
});
const pedestalMat = new THREE.MeshStandardMaterial({
  color: 0xf4f1e8, roughness: 0.85, metalness: 0,
});
const woodMat = new THREE.MeshStandardMaterial({
  color: 0x6b4a2b, roughness: 0.75, metalness: 0,
});
const benchMat = new THREE.MeshStandardMaterial({
  color: 0x3a3128, roughness: 0.7, metalness: 0,
});
const stoneMat = new THREE.MeshStandardMaterial({
  color: STONE_COLOR, roughness: 0.8, metalness: 0,
});

// =============================================================
//  Adjacency: for each room, which sides share an edge with
//  another room on the same floor? Walls are placed only on
//  sides that DON'T have a neighbor (i.e. the building exterior).
// =============================================================
function buildAdjacency() {
  const TOL = 0.05;
  const adj = new Map();
  for (const a of ROOMS) {
    const sides = { N: false, S: false, E: false, W: false };
    const ax1 = a.footprint.x, az1 = a.footprint.z;
    const ax2 = ax1 + a.footprint.w, az2 = az1 + a.footprint.d;
    for (const b of ROOMS) {
      if (a === b || a.floor !== b.floor) continue;
      const bx1 = b.footprint.x, bz1 = b.footprint.z;
      const bx2 = bx1 + b.footprint.w, bz2 = bz1 + b.footprint.d;
      const xOverlap = bx1 < ax2 - TOL && bx2 > ax1 + TOL;
      const zOverlap = bz1 < az2 - TOL && bz2 > az1 + TOL;
      if (Math.abs(bz2 - az1) < TOL && xOverlap) sides.N = true; // neighbor to the N
      if (Math.abs(bz1 - az2) < TOL && xOverlap) sides.S = true;
      if (Math.abs(bx2 - ax1) < TOL && zOverlap) sides.W = true;
      if (Math.abs(bx1 - ax2) < TOL && zOverlap) sides.E = true;
    }
    adj.set(a.id, sides);
  }
  return adj;
}

// =============================================================
//  Public: build full museum
// =============================================================
export function buildFloors() {
  const root = new THREE.Group();
  root.name = "museum";
  const floorGroups = new Map();
  const roomGroups = [];
  const adjacency = buildAdjacency();

  const isSitum = BUILDING_STYLE === "situm";

  // Scene-level grass — always rendered regardless of which floor is
  // selected, so the green BG shows under both ground floor and upper
  // floor views. Sits below all floor groups; individual floors layer
  // their own platforms / buildings on top.
  if (isSitum) {
    const grassBG = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      terrainGrassMat,
    );
    grassBG.rotation.x = -Math.PI / 2;
    // Grass sits well below ground so the site plaza reads as a
    // visibly raised stone block above the surrounding lawn. Matches
    // the plaza bottom (PLATFORM_Y + PLATFORM_H − SITE_PLAZA_THICK).
    grassBG.position.set(0, -1.55, 0);
    grassBG.receiveShadow = true;
    grassBG.userData.kind = "grass-bg";
    root.add(grassBG);

    // Sparse landscape decoration (trees) at hand-picked positions in
    // open grass outside the building cluster. Edit LANDSCAPE_DECOR =
    // false (top of file) to turn off, or trim the positions array in
    // addLandscapeDecor() to reduce density.
    if (LANDSCAPE_DECOR) addLandscapeDecor(root);
    // Reference-sheet trees — five types in instanced clusters around
    // the plaza perimeter. Wrapped in try/catch so a tree-builder
    // failure (e.g. BufferGeometryUtils API drift) can't take down
    // the whole render loop.
    try {
      addReferenceTrees(root);
    } catch (err) {
      console.error("addReferenceTrees failed:", err);
    }

    // Subtle low-poly grass color patches for ground variation.
    if (SHOW_GROUND_DETAILS && SHOW_GRASS_VARIATION) addGroundGrassPatches(root);

    // Outer-lawn meandering pavement disabled — re-enable with
    // addOuterLawnPavement(root) once a target location is confirmed.

    // Lamp posts, entrance gate, benches, flagpoles, hedges, flowering
    // shrubs and signage posts — see addExteriorDetails for the
    // breakdown. Wrapped in its own try/catch internally per builder.
    addExteriorDetails(root);
  }

  for (const floor of FLOORS) {
    const group = new THREE.Group();
    group.name = `floor-${floor.id}`;
    group.userData = { floorId: floor.id, baseY: floor.y };
    group.position.y = floor.y;

    // -----------------------------------------------------------------
    //  Situm-style branch: SVG texture as the floor + extruded room
    //  blocks. Skips the procedural slab / tiles / walls completely.
    // -----------------------------------------------------------------
    if (isSitum) {
      buildSitumFloor(group, floor, roomGroups);
      floorGroups.set(floor.id, group);
      root.add(group);
      continue;
    }

    // Slab beneath the floor tiles — sized + positioned to the ACTUAL room
    // cluster on this floor (not the full PLAN_BOUNDS), so each floor's
    // slab tightly hugs its galleries. This puts the slab centroid at the
    // room centroid, which lets the camera framing land truly centered.
    const roomsHere = ROOMS.filter((r) => r.floor === floor.id);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of roomsHere) {
      minX = Math.min(minX, r.footprint.x);
      maxX = Math.max(maxX, r.footprint.x + r.footprint.w);
      minZ = Math.min(minZ, r.footprint.z);
      maxZ = Math.max(maxZ, r.footprint.z + r.footprint.d);
    }
    // Extend ground-floor slab to include road footprints so paved areas
    // aren't sticking off into the void.
    if (floor.id === 1 && ROADS && ROADS.length) {
      for (const r of ROADS) {
        minX = Math.min(minX, r.x);
        maxX = Math.max(maxX, r.x + r.w);
        minZ = Math.min(minZ, r.z);
        maxZ = Math.max(maxZ, r.z + r.d);
      }
    }
    const slabW  = (maxX - minX) + SLAB_PAD * 2;
    const slabD  = (maxZ - minZ) + SLAB_PAD * 2;
    const slabCx = ((minX + maxX) / 2) - planCenter.x;
    const slabCz = ((minZ + maxZ) / 2) - planCenter.z;

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(slabW, SLAB_THICK, slabD),
      new THREE.MeshStandardMaterial({ color: SLAB_COLOR, roughness: 0.92, metalness: 0.02 })
    );
    slab.position.set(slabCx, -SLAB_THICK / 2, slabCz);
    slab.receiveShadow = true;
    group.add(slab);

    // Slab outline — soft ink line to define the building silhouette
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(slab.geometry),
      new THREE.LineBasicMaterial({ color: 0x5a5044, transparent: true, opacity: 0.3 })
    );
    edges.position.copy(slab.position);
    group.add(edges);

    // Roads / paved paths — only on the ground floor (floor.id === 1)
    if (floor.id === 1 && ROADS && ROADS.length) {
      for (const road of ROADS) {
        const rcx = offsetX(road.x + road.w / 2);
        const rcz = offsetZ(road.z + road.d / 2);
        const roadMesh = new THREE.Mesh(
          new THREE.BoxGeometry(road.w, 0.18, road.d),
          new THREE.MeshStandardMaterial({
            color: road.color ?? 0x4a443c,
            roughness: 0.95,
            metalness: 0,
          }),
        );
        // Sit on the slab top with a very small lift to avoid z-fight
        roadMesh.position.set(rcx, 0.03, rcz);
        roadMesh.receiveShadow = true;
        roadMesh.userData.kind = "road";
        group.add(roadMesh);
      }
    }

    // Rooms (roomsHere was already computed above for slab sizing)
    for (const room of roomsHere) {
      const rg = buildRoom(room, adjacency.get(room.id));
      group.add(rg);
      roomGroups.push(rg);
    }

    floorGroups.set(floor.id, group);
    root.add(group);
  }

  // ---- Post-pass: tag occluders that should participate in x-ray ----
  // We iterate every floor group (so slabs are included, not just walls).
  // An occluder is anything that could obscure the camera's view of what
  // the user is focused on. We accept:
  //   · "tall" meshes (walls, columns, elevators, bookshelves, paintings…)
  //   · low but wide planar geometry: slabs and floor tiles
  // Each gets a cloned material with transparent: true so we can vary
  // opacity per mesh without affecting neighbours.
  const occluders = [];
  for (const fg of floorGroups.values()) {
    fg.traverse((m) => {
      if (!m.material) return;                 // skip Groups / non-renderable
      if (m.userData.xrayOccluder) return;     // already tagged

      // Decide whether this object should participate in the x-ray fade.
      let include = false;
      if (m.isMesh && m.geometry) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        const height = bb.max.y - bb.min.y;
        const cy = m.position.y;
        // height threshold dropped to 0.05 so wall CAPS (h ≈ 0.06) and
        // any thin trim also fade with their walls.
        const isTall  = cy > 0.25 && height > 0.05;
        const isFloor = cy >= -0.5 && cy < 0.5 && height >= 0.05;
        include = isTall || isFloor;
      } else if (m.isLineSegments || m.isLine) {
        // Slab edge outlines etc. — always include so the silhouette
        // fades with the floor.
        include = true;
      }
      if (!include) return;

      // Clone material so opacity is per-object.
      m.material = m.material.clone();
      m.material.transparent = true;
      m.material.depthWrite = true;
      m.userData.xrayOccluder = true;
      m.userData.baseOpacity = m.material.opacity ?? 1;
      m.userData.floorGroup = fg;
      occluders.push(m);
    });
  }

  return { root, floorGroups, roomGroups, occluders };
}

// Rasterise an SVG file to a canvas with a white background, then
// copy that canvas into the supplied THREE.Texture. Doing this through
// fetch+Blob+Image+Canvas (instead of <img src="file.svg">) gives us
// a guaranteed-opaque bitmap at a controlled resolution.
function loadSvgAsCanvasTexture(url, texture) {
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status + " loading " + url);
      return r.text();
    })
    .then((svgText) => {
      // Pull the viewBox to compute the aspect ratio.
      const vb = svgText.match(/viewBox="\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*"/);
      const vbW = vb ? parseFloat(vb[3]) : 1190;
      const vbH = vb ? parseFloat(vb[4]) : 830;
      const aspect = vbW / vbH;

      // Inject explicit width/height so the browser doesn't fall back to
      // its default 300×150 intrinsic image size for SVGs that only
      // specify viewBox. Without this, drawImage(img, 0, 0, W, H) ends
      // up scaling content through a letterboxed default-size render
      // and the painted polygons no longer line up with their literal
      // viewBox coordinates.
      let preparedSvg = svgText;
      if (!/<svg[^>]*\swidth=/i.test(preparedSvg)) {
        preparedSvg = preparedSvg.replace(/<svg\b/i, `<svg width="${vbW}" height="${vbH}"`);
      }

      // Use a generous bitmap size so the SVG stays crisp when zoomed.
      const W = 2048;
      const H = Math.round(W / aspect);

      const blobUrl = URL.createObjectURL(
        new Blob([preparedSvg], { type: "image/svg+xml" }),
      );
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f0ece0";   // warm off-white background
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        texture.image = canvas;
        texture.needsUpdate = true;
        URL.revokeObjectURL(blobUrl);
      };
      img.onerror = (e) => {
        console.error("SVG image load failed:", url, e);
        URL.revokeObjectURL(blobUrl);
      };
      img.src = blobUrl;
    })
    .catch((err) => console.error("Failed to fetch SVG:", url, err));
}

// =============================================================
//  Situm-style floor: SVG texture plane + extruded room blocks
// =============================================================
function buildSitumFloor(group, floor, roomGroups) {
  // Per-building paved platforms — floor 1 only. The grass BG is
  // attached at scene level so it's visible under any floor selection.
  if (floor.id === 1) {
    addOutdoorTerrain(group);
  }

  // Roads — only on the ground floor. Each road carries a `points`
  // polygon traced from the SVG's hatched paving outline. We extrude
  // that as a thin slab so the road's outline matches the painted
  // paving, not just its bbox.
  if (floor.id === 1 && ROADS && ROADS.length) {
    for (const road of ROADS) {
      const slab = buildRoadSlab(road);
      if (slab) group.add(slab);
    }
  }

  // Render each room on this floor as an extruded block sitting above
  // the floor texture. Pre-compute shared edges between adjacent room
  // polygons so we can suppress windows on internal walls. Also figure
  // out which ground-floor rooms have a floor-2 room sitting directly
  // on top — those get open-topped walls (no roof) so they stack
  // seamlessly, while the standalone floor-1 buildings (Religion
  // pavilion, Women's Role, …) get a proper roof.
  const roomsHere = ROOMS.filter((r) => r.floor === floor.id);
  const sharedEdges = computeSharedEdges(roomsHere);
  const floor1WithFloor2 = computeFloor1RoomsWithFloor2Above();
  // Map room.id → list of doors that touch it, so each room can stamp
  // a dark door panel on the wall edge closest to its door positions.
  const doorsByRoom = new Map();
  for (const d of (DOORS || [])) {
    for (const rid of (d.rooms || [])) {
      if (!doorsByRoom.has(rid)) doorsByRoom.set(rid, []);
      doorsByRoom.get(rid).push(d);
    }
  }
  for (const room of roomsHere) {
    const rg = buildSitumRoomBlock(
      room, sharedEdges, floor1WithFloor2, doorsByRoom.get(room.id) || [],
    );
    group.add(rg);
    roomGroups.push(rg);
  }

  // Outdoor walking network — ground floor only. Primary spine,
  // secondary connectors, and dashed recommended-return loop.
  if (floor.id === 1 && WAYPOINTS && WAYPOINTS.length) {
    const wpById = new Map(WAYPOINTS.map((w) => [w.id, w]));
    // Beige ground corridors UNDER each path edge — extends the paved
    // ground along the walking routes so paths never appear to float
    // on the grass. Uniform width means L-junctions are clean without
    // any extra pad geometry.
    for (const edge of WAYPOINT_EDGES) {
      const [aId, bId, type = "primary"] = edge;
      const a = wpById.get(aId), b = wpById.get(bId);
      if (!a || !b) continue;
      const corridor = buildPathGroundCorridor(a, b, type);
      if (corridor) group.add(corridor);
    }
    for (const edge of WAYPOINT_EDGES) {
      const [aId, bId, type = "primary"] = edge;
      const a = wpById.get(aId), b = wpById.get(bId);
      if (!a || !b) continue;
      group.add(buildPathStrip(a, b, type));
    }
    // Only render the numbered major stops as disks. The minor yellow
    // junction dots were visual clutter once the path strips read as
    // proper paving — skip them.
    for (const wp of WAYPOINTS) {
      if (!wp.major) continue;
      group.add(buildWaypointDot(wp));
    }
  }

  // Door markers — floor 1 only.
  if (floor.id === 1 && DOORS && DOORS.length) {
    for (const door of DOORS) {
      if (door.floor !== 1) continue;
      group.add(buildDoorMarker(door));
    }
  }

  // Zone-based facade pass (off by default; see SHOW_FACADE_DETAILS /
  // SHOW_FACADE_DEBUG and FACADE_ZONES at the bottom of this file).
  addFacadeFromZones(group, floor);

  // GroundSurfaceDetails — path curbs + stair zones (ground floor only).
  if (SHOW_GROUND_DETAILS && floor.id === 1) {
    if (SHOW_CURBS)         addPathCurbsForFloor(group);
    if (SHOW_STAIR_DETAILS) addStairZonesForFloor(group, floor.id);
  }
}

const PATH_COLOR        = 0xc8b893;   // primary spine — warm flagstone
const PATH_COLOR_LIGHT  = 0xd9cba8;   // secondary connector — paler stone
const PATH_THICK        = 0.10;
const PATH_LIFT         = 1.02;
const PATH_OUTLINE      = 0x6e6249;   // mortar / shadow line between tiles
const WAYPOINT_COLOR    = 0xffd400;
const MAJOR_STOP_COLOR  = 0xff6b3d;   // orange — stands out against stone

// Curb + lamppost styling
const CURB_COLOR        = 0x8c826d;   // darker stone curb
const CURB_HEIGHT       = 0.16;
const CURB_THICK        = 0.10;
const LAMP_POST_COLOR   = 0x232323;
const LAMP_HEAD_COLOR   = 0xfff0c0;
const LAMP_HEAD_GLOW    = 0xffe18a;

// `yOffset` is added to PATH_LIFT so primary > secondary > return at
// intersections, eliminating Z-fight when slabs cross.
const PATH_STYLE = {
  primary:   { width: 1.10, color: PATH_COLOR,       outline: true,  dashed: false, curbs: true,  yOffset: 0.030 },
  secondary: { width: 0.75, color: PATH_COLOR_LIGHT, outline: true,  dashed: false, curbs: true,  yOffset: 0.015 },
  return:    { width: 0.55, color: PATH_COLOR_LIGHT, outline: false, dashed: true,  curbs: false, yOffset: 0.000 },
};

const curbMat = new THREE.MeshStandardMaterial({
  color: CURB_COLOR, roughness: 0.95, metalness: 0, flatShading: true,
});
const lampPostMat = new THREE.MeshStandardMaterial({
  color: LAMP_POST_COLOR, roughness: 0.6, metalness: 0.5, flatShading: true,
});
const lampHeadMat = new THREE.MeshStandardMaterial({
  color: LAMP_HEAD_COLOR, roughness: 0.4, metalness: 0,
  emissive: LAMP_HEAD_GLOW, emissiveIntensity: 0.6, flatShading: true,
});

// Beige ground corridor between two waypoints — sits at the same Y
// level as the building platforms (PLATFORM_Y + PLATFORM_H on top)
// and is slightly wider than the path strip rendered on top of it.
// Visually this extends the paved ground along each walk path so the
// path never appears to spill out onto grass. The slab width is a
// constant across all path styles — when two corridors of the SAME
// width meet at a right angle they form a perfectly clean L-corner,
// so no extra disc / pad is needed at the junction.
const GROUND_CORRIDOR_WIDTH  = 2.20;     // metres — uniform for every edge
const GROUND_CORRIDOR_END    = 1.20;     // metres extra at each end so the
                                         // rectangle fully covers the
                                         // perpendicular corridor at corners
const GROUND_CORRIDOR_THICK  = 0.04;
function buildPathGroundCorridor(a, b /*, type */) {
  const ax = offsetX(a.x), az = offsetZ(a.z);
  const bx = offsetX(b.x), bz = offsetZ(b.z);
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return null;

  // Clamp the per-end overshoot so we never flip the rectangle on a
  // very short edge.
  const overshoot = Math.min(GROUND_CORRIDOR_END, len * 0.6);
  const corridorLen = len + overshoot * 2;

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(corridorLen, GROUND_CORRIDOR_THICK, GROUND_CORRIDOR_WIDTH),
    terrainPlazaMat,
  );
  slab.position.set(
    (ax + bx) / 2,
    PLATFORM_Y + PLATFORM_H - GROUND_CORRIDOR_THICK / 2,
    (az + bz) / 2,
  );
  // Box's long axis is +X; yaw aligns it with the (dx, dz) edge direction.
  slab.rotation.y = Math.atan2(-dz, dx);
  slab.receiveShadow = true;
  return slab;
}

// 3D box slab from waypoint A to waypoint B. Style hierarchy matches the
// reference circulation map (primary spine vs secondary connector vs
// dashed recommended return).
function buildPathStrip(a, b, type = "primary") {
  const style = PATH_STYLE[type] ?? PATH_STYLE.primary;
  const ax = offsetX(a.x), az = offsetZ(a.z);
  const bx = offsetX(b.x), bz = offsetZ(b.z);
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return new THREE.Group();
  const angle = Math.atan2(dx, dz);

  const grp = new THREE.Group();
  grp.userData.kind = "path";
  grp.userData.edgeType = type;

  if (!style.dashed) {
    // Stone-tile path surface (lit flat-shaded material — picks up a
    // little sun shading, so each tile reads as stone rather than paint).
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(style.width, PATH_THICK, len),
      new THREE.MeshStandardMaterial({
        color: style.color, roughness: 0.92, metalness: 0, flatShading: true,
      }),
    );
    const yBase = PATH_LIFT + (style.yOffset ?? 0);
    slab.position.set((ax + bx) / 2, yBase, (az + bz) / 2);
    slab.rotation.y = angle;
    slab.receiveShadow = true;
    grp.add(slab);

    // Mortar lines / outline along the slab silhouette.
    if (style.outline) {
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(slab.geometry),
        new THREE.LineBasicMaterial({ color: PATH_OUTLINE, transparent: true, opacity: 0.85 }),
      );
      edge.position.copy(slab.position);
      edge.rotation.copy(slab.rotation);
      grp.add(edge);
    }

    // Cross "tile joint" lines every ~1.6m, perpendicular to the path —
    // gives the stone surface a paved-tile read without a texture.
    const TILE_SPACING = 1.6;
    const tileCount = Math.floor(len / TILE_SPACING);
    if (tileCount > 0) {
      const lineMat = new THREE.LineBasicMaterial({
        color: PATH_OUTLINE, transparent: true, opacity: 0.55,
      });
      const nxJ = dx / len, nzJ = dz / len;
      const halfW = style.width * 0.5;
      // Perpendicular direction (across the path)
      const perpX = nzJ, perpZ = -nxJ;
      for (let i = 1; i <= tileCount; i++) {
        const t = (i / (tileCount + 1)) * len;
        const px = ax + nxJ * t;
        const pz = az + nzJ * t;
        const yL = yBase + PATH_THICK / 2 + 0.002;
        const lg = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(px + perpX * halfW, yL, pz + perpZ * halfW),
          new THREE.Vector3(px - perpX * halfW, yL, pz - perpZ * halfW),
        ]);
        grp.add(new THREE.Line(lg, lineMat));
      }
    }

    // Painted curb stripes — thin dark lines along each long edge of
    // the slab top. Drawn as lines (zero thickness in world), so they
    // don't collide / Z-fight with crossing paths the way box curbs do.
    if (style.curbs) {
      const halfW = style.width * 0.5;
      const perpX = Math.cos(angle);
      const perpZ = -Math.sin(angle);
      const yL = yBase + PATH_THICK / 2 + 0.003;
      const nx = dx / len, nz = dz / len;
      const stripeMat = new THREE.LineBasicMaterial({
        color: CURB_COLOR, transparent: true, opacity: 0.85,
      });
      for (const side of [-1, 1]) {
        const sx = (ax + bx) / 2 + perpX * halfW * side;
        const sz = (az + bz) / 2 + perpZ * halfW * side;
        const startX = sx - nx * (len / 2), startZ = sz - nz * (len / 2);
        const endX   = sx + nx * (len / 2), endZ   = sz + nz * (len / 2);
        const lg = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(startX, yL, startZ),
          new THREE.Vector3(endX,   yL, endZ),
        ]);
        grp.add(new THREE.Line(lg, stripeMat));
      }
    }
    return grp;
  }

  // Dashed: short box dashes along the segment for the recommended return.
  const DASH = 0.55, GAP = 0.32;
  const stride = DASH + GAP;
  const count = Math.max(1, Math.floor((len + GAP) / stride));
  const nx = dx / len, nz = dz / len;
  const dashGeo = new THREE.BoxGeometry(style.width, PATH_THICK, DASH);
  const dashMat = new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.85 });
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) * stride;
    if (t > len) break;
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(ax + nx * t, PATH_LIFT, az + nz * t);
    dash.rotation.y = angle;
    grp.add(dash);
  }
  return grp;
}

function buildWaypointDot(wp) {
  const grp = new THREE.Group();
  const cx = offsetX(wp.x), cz = offsetZ(wp.z);
  const isMajor = !!wp.major;
  const radius  = isMajor ? 0.78 : 0.26;
  const height  = isMajor ? 0.10 : 0.07;
  const color   = isMajor ? MAJOR_STOP_COLOR : WAYPOINT_COLOR;

  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 28),
    new THREE.MeshBasicMaterial({ color }),
  );
  cyl.position.set(cx, PATH_LIFT + height * 0.5 + 0.01, cz);
  cyl.userData.kind = "waypoint";
  cyl.userData.waypointId = wp.id;
  grp.add(cyl);

  // Thin dark outline ring — keeps the stop readable on the SVG floor.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.02, radius * 1.18, 28),
    new THREE.MeshBasicMaterial({ color: PATH_OUTLINE, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cx, PATH_LIFT + height + 0.012, cz);
  grp.add(ring);

  // Major stops carry a number sprite + a low-poly lamppost so the
  // intersection reads as a real public square / decision plaza.
  if (isMajor && wp.stop !== undefined) {
    const tex = makeLabelTexture(String(wp.stop));
    const aspect = tex.image.width / tex.image.height;
    const h = 0.7;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
    }));
    sprite.scale.set(h * aspect, h, 1);
    sprite.position.set(cx, PATH_LIFT + height + 0.45, cz);
    sprite.renderOrder = 1001;
    grp.add(sprite);

    // Lamppost — black pole + glowing head, 4-sided low-poly look.
    grp.add(buildLamppost(cx, PATH_LIFT, cz));
  }
  return grp;
}

function buildLamppost(cx, cz_y, cz) {
  const baseY = cz_y;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 1.8, 4),
    lampPostMat,
  );
  post.position.set(cx, baseY + 0.9, cz);
  post.castShadow = true;

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 0.22),
    lampHeadMat,
  );
  head.position.set(cx, baseY + 1.9, cz);
  head.castShadow = true;

  const grp = new THREE.Group();
  grp.add(post);
  grp.add(head);
  return grp;
}

const SITUM_BLOCK_HEIGHT = 1.6;   // height of each room's 3D block (fallback path only)
const SITUM_BLOCK_LIFT   = 0.97;  // sit on top of the inner plaza (outer plaza 0.07 + INNER_PLAZA_LIFT 0.90)
const SITUM_TILE_HEIGHT  = 0.12;  // colored floor tile thickness
const SITUM_WALL_HEIGHT  = 1.85;  // beige perimeter walls
const SITUM_WALL_THICK   = 0.22;
const SITUM_CAP_HEIGHT   = 0.10;  // cornice/trim on top of walls
const SITUM_CAP_OVER     = 1.30;  // cap extends past wall thickness for visual cornice
const SITUM_WALL_COLOR   = 0xd6cdba;  // warm beige (matches CAM)
const SITUM_CAP_COLOR    = 0x8d8474;  // darker trim cap

const ROAD_SLAB_HEIGHT = 0.1;
const ROAD_SLAB_LIFT   = 0.06;

const DOOR_MARKER_COLOR = 0x3d2210;   // dark walnut — reads as a door
const DOOR_RADIUS       = 0.26;       // world units
const DOOR_LIFT         = 0.04;       // sit just above the floor texture

// Door visual — small dark disc on the floor at the door position.
// The door is also a graph node in pathfinding via the DOORS export.
function buildDoorMarker(door) {
  const group = new THREE.Group();
  const cx = offsetX(door.x);
  const cz = offsetZ(door.z);
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(DOOR_RADIUS * 0.8, DOOR_RADIUS * 0.8, 0.04, 16),
    new THREE.MeshStandardMaterial({
      color: DOOR_MARKER_COLOR, roughness: 0.85, metalness: 0, flatShading: true,
    }),
  );
  pin.position.set(cx, DOOR_LIFT + 0.02, cz);
  pin.userData.kind = "door";
  pin.userData.doorId = door.id;
  group.add(pin);
  return group;
}


// Build a road slab from its polygon outline. The polygon comes from the
// SVG-hatched paving outline (see tools/build-aba-jifar-rooms.js), so the
// resulting slab follows the actual painted paving instead of a bbox.
function buildRoadSlab(road) {
  if (!Array.isArray(road.points) || road.points.length < 3) {
    // Fallback to bbox box if no polygon — keeps older data working.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(road.w, ROAD_SLAB_HEIGHT, road.d),
      new THREE.MeshStandardMaterial({
        color: road.color ?? 0x4a443c,
        roughness: 0.95, metalness: 0,
        transparent: true, opacity: 0.55,
      }),
    );
    slab.position.set(
      offsetX(road.x + road.w / 2),
      ROAD_SLAB_LIFT,
      offsetZ(road.z + road.d / 2),
    );
    slab.userData.kind = "road";
    slab.userData.roadId = road.id;
    return slab;
  }
  const shape = new THREE.Shape();
  for (let i = 0; i < road.points.length; i++) {
    const [px, py] = road.points[i];
    const lx = px - planCenter.x;
    const lz = py - planCenter.z;
    if (i === 0) shape.moveTo(lx, lz);
    else         shape.lineTo(lx, lz);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: ROAD_SLAB_HEIGHT,
    bevelEnabled: false,
  });
  geo.rotateX(Math.PI / 2);
  const slab = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: road.color ?? 0x4a443c,
      roughness: 0.95, metalness: 0,
      transparent: true, opacity: 0.55,
    }),
  );
  slab.position.y = ROAD_SLAB_LIFT + ROAD_SLAB_HEIGHT;
  slab.receiveShadow = true;
  slab.userData.kind = "road";
  slab.userData.roadId = road.id;
  return slab;
}

// Open-plan low-poly room — short walls so the room interior reads
// from above, no roof, ornament inside that indicates the room's
// function. Stylised after the user's "SITE PLAN – GRASS AREAS"
// reference (cream walls, sandstone plinth, ornament per category).
const LP_WALL_COLOR     = 0xf3ece0;   // cream
const LP_FOUNDATION_COL = 0xb9ad95;   // sandstone plinth
const LP_TRIM_COLOR     = 0x4a3825;   // walnut outline
const LP_WALL_HEIGHT_S  = 0.55;       // short wall height — used when a floor-2 room sits above
const LP_WALL_HEIGHT_T  = 1.60;       // tall wall height — used when a floor-1 room is standalone, with a roof on top
const LP_FOUNDATION_H   = 0.16;       // plinth height
const LP_FOUNDATION_OUT = 0.10;       // plinth outward extension
const LP_BAND_H         = 0.16;       // (unused — band removed; kept so legacy code compiles)
const LP_ROOF_COLOR     = 0xb84432;   // terracotta tile
const LP_ROOF_RISE      = 0.95;       // roof peak above wall top
const LP_ROOF_OVERHANG  = 0.00;       // small offset would spike at acute corners
// Outdoor terrain palette
const TERRAIN_GRASS     = 0x6f8a4d;   // mid-green grass
const TERRAIN_PLAZA     = 0xd9cba8;   // light sand plaza

// Atmosphere — sparse trees in the open landscape around the compound.
// Flip to false to remove all decoration if frame-rate drops or you
// just want a clean diagram.
const LANDSCAPE_DECOR   = false;

// ---------------- Procedural textures ----------------
// Generated once via <canvas>; no asset downloads. Tile freely with
// RepeatWrapping. Each is a single base color + faint detail (mortar
// lines on the roof, speckle on the walls) so the materials read as
// "low-poly with hint of detail" rather than flat colour fills.

function _makeRoofTileTexture() {
  const c = document.createElement("canvas");
  c.width  = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  // Base terracotta
  ctx.fillStyle = "#b84432";
  ctx.fillRect(0, 0, 256, 256);
  // Rows of subtle tile bands — alternating slightly lighter / darker
  // strips suggest barrel tiles without spending polys.
  const rows = 12;
  const h = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const tint = (r % 2 === 0) ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";
    ctx.fillStyle = tint;
    ctx.fillRect(0, y, 256, h);
    // Dark mortar line at the top of each row
    ctx.fillStyle = "rgba(58, 20, 12, 0.45)";
    ctx.fillRect(0, y, 256, 1.6);
  }
  // Light vertical breaks suggesting individual tiles per row
  const tilesPerRow = 16;
  const tw = 256 / tilesPerRow;
  for (let i = 0; i < tilesPerRow; i++) {
    ctx.fillStyle = "rgba(58, 20, 12, 0.25)";
    ctx.fillRect(i * tw, 0, 1.0, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function _makeWallPlasterTexture() {
  const c = document.createElement("canvas");
  c.width  = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  // Base cream
  ctx.fillStyle = "#f3ece0";
  ctx.fillRect(0, 0, 256, 256);
  // Faint speckle — random dark / light pixels at low alpha
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const dark = Math.random() < 0.5;
    ctx.fillStyle = dark ? "rgba(80, 60, 40, 0.10)" : "rgba(255, 245, 230, 0.20)";
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Grey paver texture for the plaza — irregular grid of square /
// rectangular slabs (1×1, 1×2, 2×1, 2×2 unit sizes) with light
// grout lines between, subtle cloud-style tonal variation per slab
// and a fine grain noise. Greedy fill of a 6×6 cell grid keeps the
// tiling tessellated.
function _makePaverTexture() {
  const c = document.createElement("canvas");
  const size = 512;
  c.width = c.height = size;
  const ctx = c.getContext("2d");

  // Grout / cement bed colour — fills the gaps between slabs.
  // Lightened so the visible "floor" of the rooms reads brighter.
  ctx.fillStyle = "#c4c2be";
  ctx.fillRect(0, 0, size, size);

  const GRID    = 6;
  const cellPx  = size / GRID;
  const grout   = 4;          // grout-line width in pixels

  const grid = [];
  for (let r = 0; r < GRID; r++) grid.push(new Array(GRID).fill(false));

  const fits = (col, row, w, h) => {
    if (col + w > GRID || row + h > GRID) return false;
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        if (grid[row + dy][col + dx]) return false;
    return true;
  };
  const mark = (col, row, w, h) => {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        grid[row + dy][col + dx] = true;
  };

  // Weighted size pool: 1×1 most common, 2×2 least.
  const sizePool = [
    [2,2],
    [2,1],[2,1],
    [1,2],[1,2],
    [1,1],[1,1],[1,1],[1,1],
  ];
  const pickSize = (col, row) => {
    const cands = sizePool.filter(([w,h]) => fits(col, row, w, h));
    return cands.length ? cands[Math.floor(Math.random() * cands.length)] : [1,1];
  };

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      if (grid[row][col]) continue;
      const [w, h] = pickSize(col, row);
      mark(col, row, w, h);

      const px = col * cellPx + grout / 2;
      const py = row * cellPx + grout / 2;
      const pw = w * cellPx - grout;
      const ph = h * cellPx - grout;

      // Base slab shade — very tight window around a single light
      // grey. Neighbouring slabs read as the same stone with only
      // the grout lines and rims giving structure.
      const v = 208 + Math.floor(Math.random() * 8);    // 208..215
      ctx.fillStyle = `rgb(${v}, ${v}, ${Math.min(255, v + 2)})`;
      ctx.fillRect(px, py, pw, ph);

      // Very faint cloud blot per slab — nearly imperceptible value
      // shift, just enough to break up flat fills.
      const cx = px + Math.random() * pw;
      const cy = py + Math.random() * ph;
      const radius = Math.max(pw, ph) * (0.35 + Math.random() * 0.30);
      const dark = Math.random() < 0.5;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, dark ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.02)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(px, py, pw, ph);

      // Subtle darker inner rim so each slab still reads as a discrete
      // unit even though its base shade matches its neighbour's.
      ctx.strokeStyle = "rgba(0,0,0,0.05)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ROOF_TILE_TEX     = _makeRoofTileTexture();
const WALL_PLASTER_TEX  = _makeWallPlasterTexture();
const PAVER_TEX         = _makePaverTexture();
// Metres of world space per one full texture repeat. 3 m fits roughly
// six 50 cm slabs per repeat, which reads as a credible paved court.
const PAVER_SCALE       = 3.0;

// World-space repeat lengths — texture tiles every N metres regardless
// of the geometry's UV layout.
const ROOF_TILE_SCALE   = 2.0;   // metres per repeat
const WALL_PLASTER_SCALE = 1.2;

// Pre-set the repeat on the wall texture. Walls use auto-generated UVs
// from ExtrudeGeometry that map across the bbox of the polygon, so a
// fixed repeat looks consistent across rooms of similar size.
WALL_PLASTER_TEX.repeat.set(4, 1.5);

const lpWallMat = new THREE.MeshStandardMaterial({
  color: LP_WALL_COLOR, map: WALL_PLASTER_TEX,
  roughness: 0.85, metalness: 0, flatShading: true,
});
const lpFoundationMat = new THREE.MeshStandardMaterial({
  color: LP_FOUNDATION_COL, roughness: 0.95, metalness: 0, flatShading: true,
});
const lpWallMatOpenTop = new THREE.MeshStandardMaterial({
  color: LP_WALL_COLOR, map: WALL_PLASTER_TEX,
  roughness: 0.85, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});
const lpRoofMat = new THREE.MeshStandardMaterial({
  color: LP_ROOF_COLOR, map: ROOF_TILE_TEX,
  roughness: 0.70, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});
const terrainGrassMat = new THREE.MeshStandardMaterial({
  color: TERRAIN_GRASS, roughness: 1.0, metalness: 0, flatShading: true,
});
// terrainPlazaMat is defined later, once SITE_PLAZA dims are known.

// Build a large grass plane + per-building paved platforms. Matches the
// reference site plan: each building sits on its own paved platform with
// grass landscape filling the spaces between (right-side landscape,
// around the banquet hall, perimeter, etc.). The path strips (rendered
// separately) act as the paved circulation joining the platforms.
const PLATFORM_PAD = 2.4;   // metres of paving around each building polygon
const PLATFORM_H   = 0.05;  // slight raise above grass
const PLATFORM_Y   = 0.02;  // base offset

// Single rectangular site plaza covering the whole compound. Sized
// to match the outline the user drew on the top-down screenshot.
// Bounds are in RAW plan coords (same space as room.footprint /
// waypoint x,z). Tweak any of the four to expand / shrink.
const SITE_PLAZA = {
  minX: 3.0,
  maxX: 48.0,
  minZ: -2.0,
  maxZ: 38.0,
};
// Total vertical thickness of the plaza block. Top stays flush with
// the building-platform top (PLATFORM_Y + PLATFORM_H) so the
// buildings on it don't need to move; the box just extends DOWN to
// the lowered grass level so its sides are visible as a raised step.
const SITE_PLAZA_THICK = 1.60;

// Outer plaza uses a cloned paver texture so its repeat can be set
// independently of the inner plaza. BoxGeometry's top face has UVs
// in 0..1, so we scale repeat by the plaza's world dimensions.
const OUTER_PLAZA_PAVER_TEX = PAVER_TEX.clone();
OUTER_PLAZA_PAVER_TEX.needsUpdate = true;
OUTER_PLAZA_PAVER_TEX.repeat.set(
  (SITE_PLAZA.maxX - SITE_PLAZA.minX) / PAVER_SCALE,
  (SITE_PLAZA.maxZ - SITE_PLAZA.minZ) / PAVER_SCALE,
);
const terrainPlazaMat = new THREE.MeshStandardMaterial({
  color: 0xe6e3df, map: OUTER_PLAZA_PAVER_TEX,
  roughness: 0.92, metalness: 0, flatShading: true,
});

function buildSitePlaza() {
  const w = SITE_PLAZA.maxX - SITE_PLAZA.minX;
  const d = SITE_PLAZA.maxZ - SITE_PLAZA.minZ;
  const cx = offsetX((SITE_PLAZA.minX + SITE_PLAZA.maxX) / 2);
  const cz = offsetZ((SITE_PLAZA.minZ + SITE_PLAZA.maxZ) / 2);
  const topY = PLATFORM_Y + PLATFORM_H;            // 0.07
  const plaza = new THREE.Mesh(
    new THREE.BoxGeometry(w, SITE_PLAZA_THICK, d),
    terrainPlazaMat,
  );
  plaza.position.set(cx, topY - SITE_PLAZA_THICK / 2, cz);
  plaza.castShadow = true;
  plaza.receiveShadow = true;
  return plaza;
}

// Raised "inner plaza" that frames the building section like a
// podium. Footprint is built PROGRAMMATICALLY from the underlying
// data — no hand-traced polygon. It's the merged union of:
//   · every floor-1 non-open room polygon padded outward by
//     INNER_PLAZA_PAD,
//   · a strip INNER_PLAZA_CORRIDOR_W wide along every primary +
//     secondary waypoint edge,
//   · a small disc at every waypoint to fill L-corner gaps where
//     two corridors meet.
// Each piece is extruded by INNER_PLAZA_LIFT, then everything is
// merged with BufferGeometryUtils into one mesh + one material.
const INNER_PLAZA_LIFT      = 0.90;
const INNER_PLAZA_PAD       = 1.4;   // metres around each building polygon
const INNER_PLAZA_CORRIDOR_W = 2.0;  // metres wide for path strips
const INNER_PLAZA_NODE_R    = 1.2;   // metres radius for waypoint discs
const INNER_PLAZA_NODE_SEG  = 16;    // disc tessellation

// Inner plaza uses ExtrudeGeometry, whose top-face UVs equal the
// polygon's local 2D coords in metres. Scale repeat by 1/PAVER_SCALE
// so the texture tiles every PAVER_SCALE metres of world space.
const INNER_PLAZA_PAVER_TEX = PAVER_TEX.clone();
INNER_PLAZA_PAVER_TEX.needsUpdate = true;
INNER_PLAZA_PAVER_TEX.repeat.set(1 / PAVER_SCALE, 1 / PAVER_SCALE);
const innerPlazaMat = new THREE.MeshStandardMaterial({
  color: 0xe8e5e1, map: INNER_PLAZA_PAVER_TEX,
  roughness: 0.90, metalness: 0, flatShading: true,
});

// Build an extruded polygon piece in non-indexed form so all pieces
// can be merged with BufferGeometryUtils.mergeGeometries.
function _innerPlazaPiece(polygonLocal) {
  if (!Array.isArray(polygonLocal) || polygonLocal.length < 3) return null;
  const shape = new THREE.Shape();
  for (let i = 0; i < polygonLocal.length; i++) {
    const [x, z] = polygonLocal[i];
    if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: INNER_PLAZA_LIFT, bevelEnabled: false,
  });
  geo.rotateX(Math.PI / 2);
  // Geometry now spans Y=0 → Y=-depth. Translate so bottom sits at
  // outer-plaza top and top at outer-plaza top + lift.
  geo.translate(0, PLATFORM_Y + PLATFORM_H + INNER_PLAZA_LIFT, 0);
  return geo.toNonIndexed();
}

// Polygon for a single room's contribution to the podium — the room
// polygon (or footprint rect fallback) offset outward by INNER_PLAZA_PAD.
function _innerPlazaRoomPolygon(room) {
  let polygonLocal;
  if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
    polygonLocal = room.polygon.map(([px, py]) => [
      px - planCenter.x, py - planCenter.z,
    ]);
  } else {
    const { x, z, w, d } = room.footprint;
    const inset = 0.06;
    polygonLocal = [
      [offsetX(x + inset),     offsetZ(z + inset)],
      [offsetX(x + w - inset), offsetZ(z + inset)],
      [offsetX(x + w - inset), offsetZ(z + d - inset)],
      [offsetX(x + inset),     offsetZ(z + d - inset)],
    ];
  }
  return offsetPolygonOutward(polygonLocal, INNER_PLAZA_PAD);
}

// Rectangular strip polygon (4 vertices) from waypoint a to b,
// width perpendicular to the path direction.
function _innerPlazaCorridorPolygon(a, b, width) {
  const ax = offsetX(a.x), az = offsetZ(a.z);
  const bx = offsetX(b.x), bz = offsetZ(b.z);
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return null;
  const px = -dz / len, pz = dx / len;  // perpendicular unit vector
  const hw = width / 2;
  return [
    [ax + px * hw, az + pz * hw],
    [ax - px * hw, az - pz * hw],
    [bx - px * hw, bz - pz * hw],
    [bx + px * hw, bz + pz * hw],
  ];
}

// Small disc polygon at a waypoint — fills L-corner gaps where two
// corridors meet at a junction.
function _innerPlazaNodePolygon(wp, radius, segments) {
  const cx = offsetX(wp.x), cz = offsetZ(wp.z);
  const verts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    verts.push([cx + Math.cos(t) * radius, cz + Math.sin(t) * radius]);
  }
  return verts;
}

function buildInnerPlaza() {
  const pieces = [];

  // 1. Every floor-1 non-open room — building zone coverage.
  for (const room of ROOMS) {
    if (room.floor !== 1 || room.open) continue;
    const piece = _innerPlazaPiece(_innerPlazaRoomPolygon(room));
    if (piece) pieces.push(piece);
  }

  // 2. Path corridor strips for the primary + secondary edges.
  if (WAYPOINTS && WAYPOINT_EDGES) {
    const wpById = new Map(WAYPOINTS.map((w) => [w.id, w]));
    for (const edge of WAYPOINT_EDGES) {
      const [aId, bId, type = "primary"] = edge;
      if (type === "return") continue;  // dashed loop doesn't extrude
      const a = wpById.get(aId), b = wpById.get(bId);
      if (!a || !b) continue;
      const poly = _innerPlazaCorridorPolygon(a, b, INNER_PLAZA_CORRIDOR_W);
      const piece = _innerPlazaPiece(poly);
      if (piece) pieces.push(piece);
    }

    // 3. Disc at every waypoint to fill junction L-corners.
    for (const wp of WAYPOINTS) {
      if (wp.floor !== 1) continue;
      const poly = _innerPlazaNodePolygon(wp, INNER_PLAZA_NODE_R, INNER_PLAZA_NODE_SEG);
      const piece = _innerPlazaPiece(poly);
      if (piece) pieces.push(piece);
    }
  }

  if (pieces.length === 0) return null;
  // Merge into one mesh so the whole podium is a single draw call.
  const merged = BufferGeometryUtils.mergeGeometries(pieces);
  if (!merged) {
    // Defensive fallback — emit a Group of separate meshes if merge fails.
    const grp = new THREE.Group();
    for (const g of pieces) grp.add(new THREE.Mesh(g, innerPlazaMat));
    return grp;
  }
  const mesh = new THREE.Mesh(merged, innerPlazaMat);
  // Each piece was already positioned via geo.translate() before
  // merging, so mesh stays at origin.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// -----------------------------------------------------------------
//  Plaza staircases — bridge the outer plaza up to the raised inner
//  plaza podium. Each stair is a stack of equal-rise boxes; the
//  bottom step sits on the outer plaza top, the top step is flush
//  with the inner plaza top. Stairs run south→north: the southmost
//  step is the lowest, the northmost the highest.
// -----------------------------------------------------------------
const STAIR_STEPS  = 5;
const STAIR_BOTTOM_Y = PLATFORM_Y + PLATFORM_H;                        // 0.07
const STAIR_TOP_Y    = PLATFORM_Y + PLATFORM_H + INNER_PLAZA_LIFT;     // 0.97

const stairMat = new THREE.MeshStandardMaterial({
  color: 0xa6a4a1, roughness: 0.88, metalness: 0, flatShading: true,
});

// minX..maxX is the stair width (east-west).
// topZ is the north (upper) edge, bottomZ the south (lower) edge.
function buildStaircase(minX, maxX, topZ, bottomZ, steps = STAIR_STEPS) {
  const grp = new THREE.Group();
  const w = maxX - minX;
  const cx = offsetX((minX + maxX) / 2);
  const totalRun  = bottomZ - topZ;
  const tread     = totalRun / steps;
  const totalRise = STAIR_TOP_Y - STAIR_BOTTOM_Y;
  const rise      = totalRise / steps;
  for (let i = 0; i < steps; i++) {
    // Step i=0 is southmost & lowest.
    const stepTopY = STAIR_BOTTOM_Y + (i + 1) * rise;
    const stepH    = stepTopY - STAIR_BOTTOM_Y;
    const zFront   = bottomZ - i * tread;
    const zBack    = bottomZ - (i + 1) * tread;
    const zCenter  = (zFront + zBack) / 2;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, stepH, tread),
      stairMat,
    );
    box.position.set(cx, STAIR_BOTTOM_Y + stepH / 2, offsetZ(zCenter));
    box.castShadow = true;
    box.receiveShadow = true;
    grp.add(box);
  }
  return grp;
}

// -----------------------------------------------------------------
//  Auto-aligned staircases. Sample the south face of the inner-plaza
//  podium across X, group horizontal stretches of constant south-face
//  Z into segments, and emit one staircase per segment that's wide
//  enough to be worth building. This handles the multi-level south
//  edge (e.g. main-entrance corridor sticking south at z≈34 vs. the
//  central-cluster spine at z≈19) without hand-placement.
// -----------------------------------------------------------------
const AUTO_STAIR_X_STEP     = 0.5;  // metres between south-face samples
const AUTO_STAIR_Z_TOL      = 0.5;  // metres — segment break threshold
const AUTO_STAIR_MIN_WIDTH  = 3.0;  // metres — skip narrower segments
const AUTO_STAIR_RUN_DEPTH  = 2.0;  // metres — south projection of the stair

function _collectInnerPlazaPolygons() {
  const polys = [];
  for (const room of ROOMS) {
    if (room.floor !== 1 || room.open) continue;
    const poly = _innerPlazaRoomPolygon(room);
    if (poly && poly.length >= 3) polys.push(poly);
  }
  if (WAYPOINTS && WAYPOINT_EDGES) {
    const wpById = new Map(WAYPOINTS.map((w) => [w.id, w]));
    for (const edge of WAYPOINT_EDGES) {
      const [aId, bId, type = "primary"] = edge;
      if (type === "return") continue;
      const a = wpById.get(aId), b = wpById.get(bId);
      if (!a || !b) continue;
      const poly = _innerPlazaCorridorPolygon(a, b, INNER_PLAZA_CORRIDOR_W);
      if (poly && poly.length >= 3) polys.push(poly);
    }
    for (const wp of WAYPOINTS) {
      if (wp.floor !== 1) continue;
      const poly = _innerPlazaNodePolygon(wp, INNER_PLAZA_NODE_R, INNER_PLAZA_NODE_SEG);
      if (poly && poly.length >= 3) polys.push(poly);
    }
  }
  return polys;
}

// Largest Z where the vertical line at x is inside `poly`, or null if
// the line doesn't pass through the polygon's interior at all.
function _polyMaxZAtX(poly, x) {
  let maxZ = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    if (Math.abs(bx - ax) < 1e-9) continue;            // skip vertical edges
    if ((ax > x && bx > x) || (ax < x && bx < x)) continue;
    const t = (x - ax) / (bx - ax);
    if (t < 0 || t > 1) continue;
    const z = az + t * (bz - az);
    if (z > maxZ) maxZ = z;
  }
  return maxZ > -Infinity ? maxZ : null;
}

function _innerPlazaSouthFaceZ(x, polys) {
  let southZ = -Infinity;
  for (const poly of polys) {
    const z = _polyMaxZAtX(poly, x);
    if (z != null && z > southZ) southZ = z;
  }
  return southZ > -Infinity ? southZ : null;
}

function addAutoStaircases(group) {
  const polys = _collectInnerPlazaPolygons();  // world (post-offset) coords
  if (polys.length === 0) return;

  // Sample south-face Z across the plaza X range. SITE_PLAZA is in
  // raw plan coords, polygons are in world coords — convert at the
  // query boundary so segments are reported in raw plan coords
  // (the form buildStaircase wants).
  const samples = [];
  for (let x = SITE_PLAZA.minX; x <= SITE_PLAZA.maxX + 1e-6; x += AUTO_STAIR_X_STEP) {
    const worldZ = _innerPlazaSouthFaceZ(offsetX(x), polys);
    if (worldZ != null) samples.push({ x, z: worldZ + planCenter.z });
  }

  // Group consecutive samples whose Z is within tolerance into segments.
  const segments = [];
  let curr = null;
  for (const s of samples) {
    if (!curr || Math.abs(s.z - curr.z) > AUTO_STAIR_Z_TOL) {
      if (curr) segments.push(curr);
      curr = { xStart: s.x, xEnd: s.x, z: s.z };
    } else {
      curr.xEnd = s.x;
      // Take the southmost Z so the stair tops land flush with the
      // furthest-south point of this segment.
      if (s.z > curr.z) curr.z = s.z;
    }
  }
  if (curr) segments.push(curr);

  // Emit one stair per segment wide enough to bother building. Leave
  // a small inset so the stair doesn't fight the plaza rim or curb.
  const INSET = 0.4;
  for (const seg of segments) {
    const width = seg.xEnd - seg.xStart;
    if (width < AUTO_STAIR_MIN_WIDTH) continue;
    // Skip segments whose south face sits at or beyond the plaza's
    // south rim — no room to project a stair south of it.
    if (seg.z + AUTO_STAIR_RUN_DEPTH > SITE_PLAZA.maxZ - 0.2) continue;
    group.add(buildStaircase(
      seg.xStart + INSET,
      seg.xEnd   - INSET,
      seg.z,
      seg.z + AUTO_STAIR_RUN_DEPTH,
    ));
  }
}

// Border kept between every grass patch and the outer edge of the
// plaza, so grass never touches the plaza rim. Bump for a wider beige
// frame.
const PLAZA_GRASS_BORDER = 1.5;
const PLAZA_GRASS_W_MIN = SITE_PLAZA.minX + PLAZA_GRASS_BORDER;  //  4.5
const PLAZA_GRASS_W_MAX = SITE_PLAZA.maxX - PLAZA_GRASS_BORDER;  // 46.5
const PLAZA_GRASS_N_MIN = SITE_PLAZA.minZ + PLAZA_GRASS_BORDER;  // -0.5
const PLAZA_GRASS_N_MAX = SITE_PLAZA.maxZ - PLAZA_GRASS_BORDER;  // 36.5

// Hand-defined grass cut-outs sitting on top of the plaza. Each entry
// is a polygon in RAW plan coords; the patch is extruded slightly
// above the plaza top so it reads as a lawn opening in the paving.
// Adjust / extend this array to add or move patches. All entries
// honour the PLAZA_GRASS_BORDER above so the plaza always has a
// beige rim around the lawn.
const PLAZA_GRASS_PATCHES = [
  // 1. NW open area — north of palace, west of central cluster
  [[ 8.0,  2.0], [21.0,  2.0], [21.0,  9.5],
   [17.5,  9.5], [17.5, 12.5], [ 8.0, 12.5]],

  // 2. East strip — between central cluster east edge and plaza east
  [[34.0, 11.5], [PLAZA_GRASS_W_MAX, 11.5],
   [PLAZA_GRASS_W_MAX, 31.0], [34.0, 31.0]],

  // 3. South strip — well south of the south spine
  [[18.0, PLAZA_GRASS_N_MAX - 2.0], [PLAZA_GRASS_W_MAX, PLAZA_GRASS_N_MAX - 2.0],
   [PLAZA_GRASS_W_MAX, PLAZA_GRASS_N_MAX], [18.0, PLAZA_GRASS_N_MAX]],

  // 4. SW patch — between palace platform and plaza SW corner
  [[PLAZA_GRASS_W_MIN, 28.0], [8.0, 28.0],
   [8.0, PLAZA_GRASS_N_MAX], [PLAZA_GRASS_W_MIN, PLAZA_GRASS_N_MAX]],

  // 5. Node-1 pocket — small hole framed by the main-entrance corridor
  //    (south), the religion vertical corridor (west), the spine
  //    vertical corridor (east), and the religion-pavilion podium
  //    contribution (north). Sits inside that natural U-shaped gap.
  [[14.0, 29.2], [18.0, 29.2], [18.0, 31.8], [14.0, 31.8]],

  // 6. North strip — outer plaza north of the central cluster, between
  //    the cluster's north corridor (z≈3–5) and the plaza's north rim.
  [[22.0, PLAZA_GRASS_N_MIN], [PLAZA_GRASS_W_MAX, PLAZA_GRASS_N_MIN],
   [PLAZA_GRASS_W_MAX,  1.5], [22.0,  1.5]],

  // 7. West strip — narrow outer-plaza band west of the palace block,
  //    between the plaza rim and the palace's western inner-plaza edge.
  [[PLAZA_GRASS_W_MIN,  3.0], [ 7.5,  3.0],
   [ 7.5, 13.5], [PLAZA_GRASS_W_MIN, 13.5]],

  // 8. NE corner pocket — between the NW patch's east edge, the east
  //    strip's north edge, and the cluster's NE inner-plaza extension.
  [[34.0,  6.5], [PLAZA_GRASS_W_MAX,  6.5],
   [PLAZA_GRASS_W_MAX, 10.0], [34.0, 10.0]],
];

// Height of the grass patch above the plaza top. Matches the curb
// height by default so each lawn fills its curb like a planter bed.
const GRASS_PATCH_HEIGHT = 0.06;

function addPlazaGrassPatches(group) {
  const grassMat = new THREE.MeshStandardMaterial({
    color: TERRAIN_GRASS, roughness: 1.0, metalness: 0, flatShading: true,
  });
  // Extrusion thickness equals the raise above plaza, so the patch
  // bottom is flush at plaza top and the patch top sits flush with
  // the curb's top.
  const topY = PLATFORM_Y + PLATFORM_H + GRASS_PATCH_HEIGHT;
  for (const polygon of PLAZA_GRASS_PATCHES) {
    if (!Array.isArray(polygon) || polygon.length < 3) continue;
    const polyLocal = polygon.map(([x, z]) => [
      x - planCenter.x,
      z - planCenter.z,
    ]);
    const patch = buildExtrudedPolygon(polyLocal, GRASS_PATCH_HEIGHT, grassMat);
    patch.position.y = topY;
    patch.receiveShadow = true;
    group.add(patch);
  }
}

// ---------------- Curb around each grass patch ----------------
// A thin stone ring that frames every grass patch — built as the
// difference between the patch polygon offset outward by
// GRASS_CURB_WIDTH and the patch polygon itself (Shape + hole).
const GRASS_CURB_WIDTH  = 0.14;    // metres outward from the patch edge
const GRASS_CURB_HEIGHT = 0.06;    // metres raised above the plaza top
const grassCurbMat = new THREE.MeshStandardMaterial({
  color: 0x9d8e72, roughness: 0.92, metalness: 0, flatShading: true,
});

function _buildGrassPatchCurb(patchPolygonRaw) {
  const polyLocal = patchPolygonRaw.map(([x, z]) => [
    x - planCenter.x,
    z - planCenter.z,
  ]);
  const outerPoly = offsetPolygonOutward(polyLocal, GRASS_CURB_WIDTH);

  const shape = new THREE.Shape();
  for (let i = 0; i < outerPoly.length; i++) {
    const [x, z] = outerPoly[i];
    if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
  }
  const hole = new THREE.Path();
  for (let i = 0; i < polyLocal.length; i++) {
    const [x, z] = polyLocal[i];
    if (i === 0) hole.moveTo(x, z); else hole.lineTo(x, z);
  }
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: GRASS_CURB_HEIGHT, bevelEnabled: false,
  });
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, grassCurbMat);
  // After rotateX(PI/2), geometry spans world Y 0 → -depth. Lift so
  // top sits at plaza-top + GRASS_CURB_HEIGHT and bottom at plaza top.
  mesh.position.y = PLATFORM_Y + PLATFORM_H + GRASS_CURB_HEIGHT;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addGrassPatchCurbs(group) {
  for (const polygon of PLAZA_GRASS_PATCHES) {
    if (!Array.isArray(polygon) || polygon.length < 3) continue;
    const curb = _buildGrassPatchCurb(polygon);
    if (curb) group.add(curb);
  }
}

// Grass blades removed by design — this map uses a clean low-poly style:
// flat terrain surfaces, subtle green color patches (see
// addGroundGrassPatches below), and sparse shrubs/trees. No per-blade
// geometry.

function addOutdoorTerrain(group) {
  // Start with the big site plaza (one rectangle covering the entire
  // compound), then add the raised inner plaza around the buildings,
  // then layer per-building platforms + grass cut-outs + curbs +
  // details on top. No grass-blade geometry — color variation comes
  // from addGroundGrassPatches() at scene level instead.
  group.add(buildSitePlaza());
  group.add(buildInnerPlaza());
  // Stairs bridging the outer plaza up to the raised inner plaza.
  // Computed from the actual south face of the podium geometry —
  // one stair per horizontal stretch of constant south-face Z, so
  // the multi-level southern edge (main-entrance corridor at z≈34,
  // central spine at z≈19, etc.) each gets its own bridge.
  addAutoStaircases(group);
  addPlazaGrassPatches(group);
  addGrassPatchCurbs(group);
  // Grass plane lives at scene level (added in buildFloors), so it
  // shows under every floor regardless of which one is filtered. Here
  // we only add the per-building paved platforms — floor-1 only.
  for (const room of ROOMS) {
    if (room.floor !== 1) continue;
    // Open yards (e.g. Wrestling) are rendered as grass patches in
    // buildSitumRoomBlock, not as raised paved pads.
    if (room.open) continue;
    const platform = buildBuildingPlatform(room);
    if (platform) group.add(platform);

    // GroundSurfaceDetails — platform edge band + tile-grid overlay
    if (SHOW_GROUND_DETAILS) {
      const band = buildGdPlatformEdgeBand(room);
      if (band) group.add(band);
      if (SHOW_PAVING_LINES) {
        const overlay = buildGdPavingOverlay(room);
        if (overlay) group.add(overlay);
      }
    }
  }
}

// ------- Trees / shrubs / rocks: hand-placed in open grass -------
const treeTrunkMat = new THREE.MeshStandardMaterial({
  color: 0x5a3a20, roughness: 0.95, metalness: 0, flatShading: true,
});
const treeFoliageMat = new THREE.MeshStandardMaterial({
  color: 0x466e3a, roughness: 0.95, metalness: 0, flatShading: true,
});
const shrubMat = new THREE.MeshStandardMaterial({
  color: 0x537a3d, roughness: 0.95, metalness: 0, flatShading: true,
});
const rockMat = new THREE.MeshStandardMaterial({
  color: 0x9aa088, roughness: 0.90, metalness: 0, flatShading: true,
});

function buildTree(x, y, z, scale = 1) {
  const g = new THREE.Group();
  const trunkH = 0.7 * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.10 * scale, 0.14 * scale, trunkH, 6),
    treeTrunkMat,
  );
  trunk.position.set(x, y + trunkH / 2, z);
  trunk.castShadow = true;
  g.add(trunk);

  const foliageH = 1.4 * scale;
  const foliage = new THREE.Mesh(
    new THREE.ConeGeometry(0.55 * scale, foliageH, 6),
    treeFoliageMat,
  );
  foliage.position.set(x, y + trunkH + foliageH / 2 - 0.1, z);
  foliage.castShadow = true;
  g.add(foliage);

  return g;
}

function buildShrub(x, y, z, scale = 1) {
  const g = new THREE.Group();
  const r = 0.30 * scale;
  // Three overlapping icosahedron blobs read as a low-poly bush.
  const blobs = [
    [ 0.00, 0.55,  0.00],
    [ 0.40, 0.42, -0.10],
    [-0.30, 0.45,  0.25],
  ];
  for (const [dx, dy, dz] of blobs) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      shrubMat,
    );
    m.position.set(x + dx * scale, y + dy * scale, z + dz * scale);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function buildRock(x, y, z, scale = 1) {
  const r = 0.30 * scale;
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 0),
    rockMat,
  );
  m.position.set(x, y + r * 0.45, z);
  m.scale.set(1.1, 0.55, 1.3);
  m.rotation.y = (x + z) * 0.7;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Hand-picked decoration positions in LOCAL plan-centered coords. The
// building bbox in local coords runs roughly x:[-25, +5], z:[-21, +3],
// so every entry below sits well outside that envelope. Trim freely —
// none of this participates in pathfinding or picking.
function addLandscapeDecor(root) {
  // Trees — taller silhouettes, sparser
  const TREES = [
    [ 14, 0, -10, 1.00],
    [ 17, 0,  -2, 1.10],
    [ 12, 0,   8, 0.90],
    [ 20, 0,   4, 1.00],
    [ -2, 0,  14, 1.00],
    [  6, 0,  17, 0.95],
    [-12, 0,  13, 1.05],
    [-30, 0, -18, 0.90],
    [-28, 0,  -2, 1.00],
    [-22, 0,  16, 0.95],
  ];
  for (const [x, y, z, s] of TREES) root.add(buildTree(x, y, z, s));

  // Shrubs — short ground vegetation, scattered around the trees
  const SHRUBS = [
    [ 10, 0,  -6, 0.95],
    [ 15, 0,   3, 0.85],
    [ 16, 0,  10, 0.90],
    [  3, 0,  12, 1.00],
    [ -8, 0,  16, 0.95],
    [-18, 0,  10, 0.90],
    [-26, 0,  -8, 0.95],
    [-26, 0,  10, 0.90],
    [ -6, 0, -24, 0.85],
    [ 22, 0,  -4, 1.00],
  ];
  for (const [x, y, z, s] of SHRUBS) root.add(buildShrub(x, y, z, s));

  // Rocks — low irregular stones for ground texture
  const ROCKS = [
    [ 13, 0,  -5, 1.10],
    [ 19, 0,   1, 0.90],
    [  1, 0,  16, 1.00],
    [-15, 0,  15, 1.05],
    [-29, 0,  -6, 0.95],
    [-23, 0, -23, 1.00],
    [  9, 0,  20, 0.85],
  ];
  for (const [x, y, z, s] of ROCKS) root.add(buildRock(x, y, z, s));
}

// ====================================================================
//  Reference-sheet trees — five low-poly types, clustered placement,
//  instanced rendering. Spec from ABA JIFAR PALACE – TREES REFERENCE
//  SHEET (low-poly, optimised, consistent style).
//
//  Types:                Height   Use
//    A. Conifer tall      4.5 m   perimeter / background
//    B. Conifer medium    3.0 m   midground / scattered
//    C. Broadleaf round   4.0 m   feature areas / clusters
//    D. Broadleaf small   2.5 m   near buildings / paths (on grass)
//    E. Columnar accent   4.0 m   entrances / corners
//
//  Placement: only on grass outside the SITE_PLAZA, in clusters of
//  2-5, never blocking entrances or route nodes.
// ====================================================================
const TREE_LEAF_COLORS = [
  0x4A7C3E, 0x5CBF4A, 0x6FAE5B, 0x3B6B34, 0x547F43,
];
const TREE_TRUNK_COLOR = 0x5A3A23;
// Global multiplier applied on top of the per-instance scale. The
// reference-sheet heights (A=4.5 m, B=3.0 m, etc.) are tuned for a
// site-scale lawn; inside the small plaza grass patches they need
// to be much smaller. Bump this toward 1.0 for big trees, toward
// 0.2 for tiny ones.
const TREE_GLOBAL_SCALE = 0.45;
// Trees sit on the raised plaza grass patches, not the lower lawn.
// Patch top Y = PLATFORM_Y + PLATFORM_H + GRASS_PATCH_HEIGHT = 0.13.
const TREE_BASE_Y      = PLATFORM_Y + PLATFORM_H + GRASS_PATCH_HEIGHT;

// All positions are inside the four PLAZA_GRASS_PATCHES polygons,
// kept a small margin (~0.6 m) inside each patch's edge so trunks
// don't push into the curb. Each entry: { type, x, z, s, r }.
const TREE_POSITIONS = [
  // ----- Patch 1: NW open area (L-shape, bbox 8-21 × 2-12.5) -----
  { type: "C", x: 10.5, z:  4.0, s: 1.00, r: 0.4 },
  { type: "B", x: 14.0, z:  3.5, s: 0.95, r: 1.6 },
  { type: "D", x: 17.5, z:  4.0, s: 0.95, r: 2.4 },
  { type: "D", x: 19.5, z:  6.0, s: 0.90, r: 0.8 },
  { type: "B", x: 10.0, z:  7.5, s: 0.95, r: 1.1 },
  { type: "C", x: 14.5, z:  7.0, s: 1.00, r: 2.0 },
  { type: "D", x: 19.0, z:  8.5, s: 0.95, r: 0.5 },
  { type: "D", x: 10.5, z: 11.0, s: 0.95, r: 1.8 },
  { type: "B", x: 14.0, z: 11.0, s: 0.95, r: 0.3 },
  { type: "D", x: 16.5, z: 11.5, s: 0.90, r: 2.7 },

  // ----- Patch 2: East strip (34-46.5 × 11.5-31) -----
  { type: "A", x: 37.0, z: 13.5, s: 1.00, r: 0.3 },
  { type: "B", x: 41.5, z: 13.0, s: 0.95, r: 1.5 },
  { type: "C", x: 45.0, z: 14.5, s: 1.00, r: 2.0 },
  { type: "D", x: 36.0, z: 17.0, s: 0.95, r: 1.1 },
  { type: "C", x: 40.5, z: 17.5, s: 1.00, r: 2.3 },
  { type: "B", x: 44.5, z: 18.5, s: 0.95, r: 0.6 },
  { type: "D", x: 37.5, z: 21.0, s: 0.95, r: 1.7 },
  { type: "B", x: 42.0, z: 22.0, s: 0.95, r: 0.4 },
  { type: "A", x: 45.5, z: 23.0, s: 1.00, r: 2.5 },
  { type: "C", x: 37.0, z: 25.5, s: 1.00, r: 1.0 },
  { type: "D", x: 41.0, z: 26.5, s: 0.95, r: 1.9 },
  { type: "B", x: 44.5, z: 27.5, s: 0.95, r: 0.7 },
  { type: "C", x: 38.0, z: 29.0, s: 1.00, r: 2.4 },
  { type: "D", x: 43.0, z: 29.5, s: 0.95, r: 1.3 },

  // ----- Patch 3: South strip (18-46.5 × 34.5-36.5) -----
  // Strip is only ~2 m wide; use the slim columnar (E) type so
  // foliage doesn't overflow the curb.
  { type: "E", x: 21.0, z: 35.5, s: 0.95, r: 0 },
  { type: "E", x: 27.0, z: 35.5, s: 0.95, r: 0 },
  { type: "E", x: 33.0, z: 35.5, s: 0.95, r: 0 },
  { type: "E", x: 39.0, z: 35.5, s: 0.95, r: 0 },
  { type: "E", x: 45.0, z: 35.5, s: 0.95, r: 0 },

  // ----- Patch 4: SW patch (4.5-8 × 28-36.5) -----
  { type: "D", x: 6.0, z: 29.5, s: 0.95, r: 0.6 },
  { type: "B", x: 6.5, z: 32.5, s: 0.95, r: 1.8 },
  { type: "E", x: 6.0, z: 35.0, s: 0.95, r: 0   },
];

// CylinderGeometry / ConeGeometry are indexed; IcosahedronGeometry is
// non-indexed. BufferGeometryUtils.mergeGeometries refuses to mix
// the two, so every primitive that goes into a merge is normalized
// to non-indexed via toNonIndexed() first.
function _ni(geo) { return geo.toNonIndexed(); }

function _buildConiferGeo(totalH) {
  const trunkH    = totalH * 0.22;
  const trunkR    = totalH * 0.045;
  const trunkRTop = totalH * 0.038;
  const trunk = _ni(new THREE.CylinderGeometry(trunkRTop, trunkR, trunkH, 6));
  trunk.translate(0, trunkH / 2, 0);

  const fH    = totalH - trunkH * 0.7;
  const base  = trunkH * 0.65;
  const c1H = fH * 0.42, c1R = totalH * 0.24;
  const c2H = fH * 0.34, c2R = totalH * 0.19;
  const c3H = fH * 0.32, c3R = totalH * 0.13;
  const c1 = _ni(new THREE.ConeGeometry(c1R, c1H, 6)); c1.translate(0, base + c1H / 2, 0);
  const c2 = _ni(new THREE.ConeGeometry(c2R, c2H, 6)); c2.translate(0, base + c1H * 0.7 + c2H / 2, 0);
  const c3 = _ni(new THREE.ConeGeometry(c3R, c3H, 6)); c3.translate(0, base + c1H * 0.7 + c2H * 0.7 + c3H / 2, 0);
  const foliage = BufferGeometryUtils.mergeGeometries([c1, c2, c3]);
  return { trunkGeo: trunk, foliageGeo: foliage };
}

function _buildBroadleafGeo(totalH) {
  const trunkH = totalH * 0.30;
  const trunkR = totalH * 0.035;
  const trunk = _ni(new THREE.CylinderGeometry(trunkR * 0.85, trunkR, trunkH, 6));
  trunk.translate(0, trunkH / 2, 0);

  const foliageR = totalH * 0.35;
  const foliage = new THREE.IcosahedronGeometry(foliageR, 0);  // already non-indexed
  foliage.translate(0, trunkH + foliageR * 0.78, 0);
  return { trunkGeo: trunk, foliageGeo: foliage };
}

function _buildColumnarGeo(totalH) {
  const trunkH = totalH * 0.18;
  const trunkR = totalH * 0.030;
  const trunk = _ni(new THREE.CylinderGeometry(trunkR, trunkR, trunkH, 6));
  trunk.translate(0, trunkH / 2, 0);

  const folH = totalH * 0.70;
  const folR = totalH * 0.10;
  const col = _ni(new THREE.CylinderGeometry(folR * 0.4, folR, folH, 8));
  col.translate(0, trunkH * 0.4 + folH / 2, 0);
  const cap = new THREE.IcosahedronGeometry(folR * 0.55, 0);   // already non-indexed
  cap.translate(0, trunkH * 0.4 + folH + folR * 0.2, 0);
  const foliage = BufferGeometryUtils.mergeGeometries([col, cap]);
  return { trunkGeo: trunk, foliageGeo: foliage };
}

function addReferenceTrees(root) {
  const geos = {
    A: _buildConiferGeo(4.5),
    B: _buildConiferGeo(3.0),
    C: _buildBroadleafGeo(4.0),
    D: _buildBroadleafGeo(2.5),
    E: _buildColumnarGeo(4.0),
  };
  const trunkMat = new THREE.MeshStandardMaterial({
    color: TREE_TRUNK_COLOR, roughness: 0.95, metalness: 0, flatShading: true,
  });
  // Foliage colour is set per instance via setColorAt — base white so
  // the instance tint applies cleanly.
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true,
  });

  // Group trees by type so each type gets ONE pair of InstancedMeshes
  // (trunk + foliage).
  const byType = { A: [], B: [], C: [], D: [], E: [] };
  for (const t of TREE_POSITIONS) {
    if (byType[t.type]) byType[t.type].push(t);
  }

  const matrix = new THREE.Matrix4();
  const pos    = new THREE.Vector3();
  const quat   = new THREE.Quaternion();
  const scl    = new THREE.Vector3();
  const up     = new THREE.Vector3(0, 1, 0);
  const color  = new THREE.Color();

  for (const [typeKey, trees] of Object.entries(byType)) {
    if (!trees.length) continue;
    const { trunkGeo, foliageGeo } = geos[typeKey];

    const trunkInst   = new THREE.InstancedMesh(trunkGeo,   trunkMat,   trees.length);
    const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, trees.length);
    trunkInst.castShadow   = true;
    trunkInst.receiveShadow = false;
    foliageInst.castShadow = true;
    foliageInst.receiveShadow = false;

    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const scaleVar = (t.s ?? 1) * TREE_GLOBAL_SCALE * (0.94 + Math.random() * 0.12);
      const rotVar   = (t.r ?? 0) + (Math.random() - 0.5) * 0.4;
      pos.set(t.x - planCenter.x, TREE_BASE_Y, t.z - planCenter.z);
      quat.setFromAxisAngle(up, rotVar);
      scl.set(scaleVar, scaleVar, scaleVar);
      matrix.compose(pos, quat, scl);
      trunkInst.setMatrixAt(i, matrix);
      foliageInst.setMatrixAt(i, matrix);

      color.set(TREE_LEAF_COLORS[Math.floor(Math.random() * TREE_LEAF_COLORS.length)]);
      foliageInst.setColorAt(i, color);
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    foliageInst.instanceMatrix.needsUpdate = true;
    if (foliageInst.instanceColor) foliageInst.instanceColor.needsUpdate = true;

    root.add(trunkInst);
    root.add(foliageInst);
  }
}

function buildBuildingPlatform(room) {
  let polygonLocal;
  if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
    polygonLocal = room.polygon.map(([px, py]) => [px - planCenter.x, py - planCenter.z]);
  } else {
    const { x, z, w, d } = room.footprint;
    const inset = 0.06;
    polygonLocal = [
      [offsetX(x + inset),      offsetZ(z + inset)],
      [offsetX(x + w - inset),  offsetZ(z + inset)],
      [offsetX(x + w - inset),  offsetZ(z + d - inset)],
      [offsetX(x + inset),      offsetZ(z + d - inset)],
    ];
  }
  const platformPoly = offsetPolygonOutward(polygonLocal, PLATFORM_PAD);
  const platform = buildExtrudedPolygon(platformPoly, PLATFORM_H, terrainPlazaMat);
  platform.position.y = PLATFORM_Y + PLATFORM_H;
  platform.receiveShadow = true;
  return platform;
}

// Windows + doors palette.
const LP_WINDOW_GLASS    = 0x84a6c2;   // lighter slate-blue glass — reads on cream wall
const LP_WINDOW_FRAME    = 0x4a2818;   // dark walnut frame
const LP_DOOR_COLOR      = 0x3d2210;   // very dark walnut door
const LP_WINDOW_W        = 0.55;
const LP_WINDOW_H        = 0.70;
const LP_WINDOW_SPACING  = 1.8;        // metres between window centres
const LP_DOOR_W          = 0.70;
const LP_DOOR_H          = 1.20;
const LP_EDGE_MIN_FOR_WINDOWS = 1.8;   // skip windows on edges shorter than this

const lpWindowGlassMat = new THREE.MeshStandardMaterial({
  color: LP_WINDOW_GLASS, roughness: 0.18, metalness: 0.45,
  // Warm emissive + low alpha so the panes read as illuminated panels
  // letting daylight into the open-topped rooms behind them.
  emissive: 0xfff1c4, emissiveIntensity: 0.85,
  transparent: true, opacity: 0.45,
  flatShading: true, side: THREE.DoubleSide,
  depthWrite: false,
});
const lpWindowFrameMat = new THREE.MeshStandardMaterial({
  color: LP_WINDOW_FRAME, roughness: 0.8, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});
const lpDoorMat = new THREE.MeshStandardMaterial({
  color: LP_DOOR_COLOR, roughness: 0.85, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});

// Warm glowing orb used by the door-side wall sconces.
const sconceOrbMat = new THREE.MeshStandardMaterial({
  color: 0xfff1c0, roughness: 0.4, metalness: 0.05,
  emissive: 0xffc870, emissiveIntensity: 1.6,
  flatShading: true,
});
// Terracotta urn + dark-green shrub used by the door-side planters.
const planterUrnMat = new THREE.MeshStandardMaterial({
  color: 0xa66a48, roughness: 0.92, metalness: 0, flatShading: true,
});
const planterShrubMat = new THREE.MeshStandardMaterial({
  color: 0x4a7634, roughness: 0.90, metalness: 0, flatShading: true,
});

function buildSitumRoomBlock(room, sharedEdges, floor1WithFloor2, doorsForRoom = []) {
  const group = new THREE.Group();
  const cat = CATEGORIES[room.category] || CATEGORIES.amenity;
  const baseColor = new THREE.Color(cat.color);
  const { x, z, w, d } = room.footprint;
  const cx = offsetX(x + w / 2);
  const cz = offsetZ(z + d / 2);

  // Resolve the polygon (local plan-centered coords).
  let polygonLocal;
  if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
    polygonLocal = room.polygon.map(([px, py]) => [px - planCenter.x, py - planCenter.z]);
  } else {
    const inset = 0.06;
    const x1 = offsetX(x + inset),       z1 = offsetZ(z + inset);
    const x2 = offsetX(x + w - inset),   z2 = offsetZ(z + d - inset);
    polygonLocal = [[x1, z1], [x2, z1], [x2, z2], [x1, z2]];
  }

  // Open yards (e.g. Wrestling) — render as a grass patch sitting at
  // the platform-top Y so it reads as a green panel cut out of the
  // paved area. No walls, roof, windows, doors, or foundation.
  if (room.open) {
    const yardMat = new THREE.MeshStandardMaterial({
      color: TERRAIN_GRASS, roughness: 1.0, metalness: 0, flatShading: true,
    });
    const yard = buildExtrudedPolygon(polygonLocal, 0.02, yardMat);
    yard.position.y = PLATFORM_Y + PLATFORM_H + 0.008;
    yard.receiveShadow = true;
    yard.castShadow = false;
    group.add(yard);
    group.userData = {
      kind: "room",
      roomId: room.id,
      room,
      baseColor: new THREE.Color(TERRAIN_GRASS),
      originalEmissive: new THREE.Color(0, 0, 0),
      tile: yard,
      highlightTargets: [yard],
    };
    return group;
  }

  // Cream tall walls. Rooms with another floor stacked on top get a flat
  // top (the upper-storey block sits on them), every other room gets a
  // red hip roof. Footprint polygon is NEVER modified — the roof
  // adapts to whatever shape the room has.
  const isFloor1 = room.floor === 1;
  const hasFloor2Above = isFloor1 && floor1WithFloor2.has(room.id);
  const isStandaloneRoofed = !hasFloor2Above;

  // --- Foundation plinth (slight step at the base) ---
  const foundationPoly = offsetPolygonOutward(polygonLocal, LP_FOUNDATION_OUT);
  const foundation = buildExtrudedPolygon(foundationPoly, LP_FOUNDATION_H, lpFoundationMat);
  foundation.position.y = SITUM_BLOCK_LIFT + LP_FOUNDATION_H;
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  group.add(foundation);

  // --- Walls ---
  // Floor-1 rooms always use open-top walls so there's never a flat
  // cream plane covering the room interior. In All / First-Floor views
  // the closure comes from the roof (standalone rooms) or the floor-2
  // foundation (rooms with a storey above). In Ground-Floor view the
  // roof is LIFTED so you can see straight into the room.
  // Floor-2 rooms keep the standard closed extrusion.
  const wallsBaseY = SITUM_BLOCK_LIFT + LP_FOUNDATION_H;
  const wallHeight = LP_WALL_HEIGHT_T;
  let walls;
  if (isFloor1) {
    walls = buildOpenTopExtrusion(polygonLocal, wallsBaseY, wallHeight, lpWallMatOpenTop);
  } else {
    walls = buildExtrudedPolygon(polygonLocal, wallHeight, lpWallMat);
    walls.position.y = wallsBaseY + wallHeight;
  }
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  // --- Red hip roof on top (skipped for floor-1 rooms that have a
  // floor-2 block stacked on them — the upper storey IS their roof).
  // For floor-1 standalone rooms the whole roof + ridges + finial is
  // wrapped in roofGroup tagged kind:"liftableRoof" so main.js can
  // translate it upward when the user toggles Ground Floor. ---
  let roof = null;
  if (isStandaloneRoofed) {
    const liftableParent = isFloor1 ? new THREE.Group() : group;
    if (isFloor1) {
      liftableParent.userData.kind = "liftableRoof";
      group.add(liftableParent);
    }
    // No outward offset — overhang at acute U-shape corners would spike.
    roof = buildLowPolyRoof(polygonLocal, wallsBaseY + wallHeight, LP_ROOF_RISE);
    if (roof) {
      roof.castShadow = true;
      liftableParent.add(roof);
      // Dark trim line along the eave + hip ridges.
      const ridges = new THREE.LineSegments(
        new THREE.EdgesGeometry(roof.geometry, 12),
        new THREE.LineBasicMaterial({
          color: 0x5a1f10, transparent: true, opacity: 0.7,
        }),
      );
      ridges.position.copy(roof.position);
      liftableParent.add(ridges);

      // --- Decorative finial at the roof apex ---
      let fcx = 0, fcz = 0;
      for (const [x, z] of polygonLocal) { fcx += x; fcz += z; }
      fcx /= polygonLocal.length;
      fcz /= polygonLocal.length;
      const finialBaseY = wallsBaseY + wallHeight + LP_ROOF_RISE;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.32, 8),
        lpOrnamentDark,
      );
      spike.position.set(fcx, finialBaseY + 0.16, fcz);
      spike.castShadow = true;
      liftableParent.add(spike);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 10, 8),
        lpOrnamentGold,
      );
      orb.position.set(fcx, finialBaseY + 0.40, fcz);
      orb.castShadow = true;
      liftableParent.add(orb);

      // --- Eave brackets: small triangular wood corbels at each
      //     polygon vertex, sitting just under the roof and projecting
      //     slightly outward. Carved-look traditional Ethiopian detail.
      const bracketY = wallsBaseY + wallHeight - 0.05;
      for (let bi = 0; bi < polygonLocal.length; bi++) {
        const [vx, vz] = polygonLocal[bi];
        // Outward direction from polygon centroid for this vertex.
        const dx = vx - fcx, dz = vz - fcz;
        const dlen = Math.hypot(dx, dz);
        if (dlen < 0.01) continue;
        const onx = dx / dlen, onz = dz / dlen;
        const bx = vx + onx * 0.08;
        const bz = vz + onz * 0.08;
        const bracket = new THREE.Mesh(
          new THREE.ConeGeometry(0.10, 0.30, 4),
          lpFoundationMat,
        );
        // ConeGeometry's apex points +Y by default. Rotate so the
        // apex points DOWNWARD (looks like a corbel hanging under the
        // eave), then yaw to face outward.
        bracket.rotation.x = Math.PI;
        bracket.rotation.y = Math.atan2(onx, onz);
        bracket.position.set(bx, bracketY, bz);
        bracket.castShadow = true;
        liftableParent.add(bracket);
      }
    }
  }

  // --- Windows on external walls + dark door panels at door positions ---
  buildLowPolyWindows(group, room, polygonLocal, wallsBaseY, wallHeight, sharedEdges, doorsForRoom);
  if (room.floor === 1 && doorsForRoom.length) {
    buildLowPolyDoors(group, polygonLocal, wallsBaseY, doorsForRoom);
  }

  // --- Facade details: veranda, columns, railings, roof trim ---
  addBuildingFacadeDetails(group, {
    room, polygonLocal, wallsBaseY, wallHeight,
    sharedEdges, doorsForRoom, isRoofed: isStandaloneRoofed,
  });

  // --- Balconies (wrap-around verandas) — floor 1 open, floor 2 fenced ---
  addBalconyDetails(group, room, polygonLocal, wallsBaseY, wallHeight,
                    sharedEdges, doorsForRoom);

  // --- Museum-style interiors — wrapped in a group that's only visible
  //     when the user toggles Ground Floor. main.js toggles it via
  //     userData.kind = "groundInterior". ---
  if (isFloor1) {
    const interiorGroup = new THREE.Group();
    interiorGroup.userData.kind = "groundInterior";
    interiorGroup.visible = false;
    addAbaJifarRoomInteriors(interiorGroup, room, polygonLocal, sharedEdges,
                             wallsBaseY, wallHeight);
    group.add(interiorGroup);
  }

  // --- Silhouette outline on the walls. Use a closed-extrusion
  //     geometry as the EdgesGeometry source so we get one clean
  //     line per perpendicular wall corner (open-top extrusion's
  //     non-indexed triangles produce excessive edges). The source
  //     mesh is never added to the scene. ---
  const silhouetteSource = buildExtrudedPolygon(polygonLocal, wallHeight, lpWallMat);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(silhouetteSource.geometry, 1),
    new THREE.LineBasicMaterial({ color: LP_TRIM_COLOR, transparent: true, opacity: 0.55 }),
  );
  edges.position.y = wallsBaseY + wallHeight;
  group.add(edges);

  group.userData = {
    kind: "room",
    roomId: room.id,
    room,
    baseColor: baseColor.clone(),
    originalEmissive: new THREE.Color(0, 0, 0),
    tile: walls,
    highlightTargets: roof ? [walls, roof] : [walls],
  };
  return group;
}

// Per-category ornament — simple low-poly shape inside the room that
// hints at its purpose. Returns null for categories without a glyph.
const lpOrnamentDark  = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85, flatShading: true });
const lpOrnamentWood  = new THREE.MeshStandardMaterial({ color: 0x8a5d35, roughness: 0.85, flatShading: true });
const lpOrnamentStone = new THREE.MeshStandardMaterial({ color: 0xa8a098, roughness: 0.9,  flatShading: true });
const lpOrnamentGold  = new THREE.MeshStandardMaterial({ color: 0xc89a3d, roughness: 0.5,  metalness: 0.5, flatShading: true });
const lpOrnamentRed   = new THREE.MeshStandardMaterial({ color: 0xa83a2a, roughness: 0.75, flatShading: true });
const lpOrnamentBlue  = new THREE.MeshStandardMaterial({ color: 0x3a5a8a, roughness: 0.75, flatShading: true });
const lpOrnamentCloth = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 0.85, flatShading: true });

function buildRoomOrnament(room, cx, cz, baseY) {
  switch (room.category) {
    case "royal":      return ornamentThrone(cx, cz, baseY);
    case "history":    return ornamentScroll(cx, cz, baseY);
    case "religion":   return ornamentAltar(cx, cz, baseY);
    case "kingdom":    return ornamentFlag(cx, cz, baseY);
    case "governance": return ornamentScales(cx, cz, baseY);
    case "economy":    return ornamentBarrel(cx, cz, baseY);
    case "culture":    return ornamentRing(cx, cz, baseY);
    case "ceremonial": return ornamentPodium(cx, cz, baseY);
    case "womens":     return ornamentLoom(cx, cz, baseY);
    case "family":     return ornamentBed(cx, cz, baseY);
    case "entrance":   return ornamentArchway(cx, cz, baseY);
    default:           return null;
  }
}
function ornamentThrone(cx, cz, baseY) {
  const grp = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.30), lpOrnamentGold);
  seat.position.set(cx, baseY + 0.05, cz); grp.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.30, 0.06), lpOrnamentGold);
  back.position.set(cx, baseY + 0.25, cz - 0.12); grp.add(back);
  return grp;
}
function ornamentScroll(cx, cz, baseY) {
  const grp = new THREE.Group();
  const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.20), lpOrnamentCloth);
  tablet.position.set(cx, baseY + 0.02, cz); grp.add(tablet);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.20, 12), lpOrnamentWood);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(cx, baseY + 0.08, cz); grp.add(roll);
  return grp;
}
function ornamentAltar(cx, cz, baseY) {
  const grp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.25), lpOrnamentStone);
  base.position.set(cx, baseY + 0.09, cz); grp.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 8), lpOrnamentGold);
  dome.position.set(cx, baseY + 0.24, cz); grp.add(dome);
  return grp;
}
function ornamentFlag(cx, cz, baseY) {
  const grp = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), lpOrnamentDark);
  pole.position.set(cx, baseY + 0.275, cz); grp.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.02), lpOrnamentRed);
  flag.position.set(cx + 0.13, baseY + 0.42, cz); grp.add(flag);
  return grp;
}
function ornamentScales(cx, cz, baseY) {
  const grp = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8), lpOrnamentGold);
  post.position.set(cx, baseY + 0.175, cz); grp.add(post);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.025, 0.025), lpOrnamentGold);
  beam.position.set(cx, baseY + 0.35, cz); grp.add(beam);
  for (const sgn of [-1, 1]) {
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), lpOrnamentGold);
    tray.position.set(cx + sgn * 0.13, baseY + 0.30, cz); grp.add(tray);
  }
  return grp;
}
function ornamentBarrel(cx, cz, baseY) {
  const grp = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.22, 12), lpOrnamentWood);
  barrel.position.set(cx, baseY + 0.11, cz); grp.add(barrel);
  return grp;
}
function ornamentRing(cx, cz, baseY) {
  // Wrestling — a flat ring with two small figure-cylinders inside.
  const grp = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 16), lpOrnamentDark);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cx, baseY + 0.025, cz); grp.add(ring);
  for (const sgn of [-1, 1]) {
    const fig = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8), lpOrnamentCloth);
    fig.position.set(cx + sgn * 0.06, baseY + 0.10, cz); grp.add(fig);
  }
  return grp;
}
function ornamentPodium(cx, cz, baseY) {
  const grp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.10, 16), lpOrnamentStone);
  base.position.set(cx, baseY + 0.05, cz); grp.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16), lpOrnamentStone);
  top.position.set(cx, baseY + 0.16, cz); grp.add(top);
  return grp;
}
function ornamentLoom(cx, cz, baseY) {
  const grp = new THREE.Group();
  for (const sx of [-0.12, 0.12]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, 0.03), lpOrnamentWood);
    post.position.set(cx + sx, baseY + 0.16, cz); grp.add(post);
  }
  const beamTop = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.03), lpOrnamentWood);
  beamTop.position.set(cx, baseY + 0.30, cz); grp.add(beamTop);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.20, 0.01), lpOrnamentCloth);
  cloth.position.set(cx, baseY + 0.18, cz + 0.02); grp.add(cloth);
  return grp;
}
function ornamentBed(cx, cz, baseY) {
  const grp = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.08, 0.24), lpOrnamentWood);
  bed.position.set(cx, baseY + 0.04, cz); grp.add(bed);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.18), lpOrnamentCloth);
  pillow.position.set(cx - 0.13, baseY + 0.10, cz); grp.add(pillow);
  return grp;
}
function ornamentArchway(cx, cz, baseY) {
  const grp = new THREE.Group();
  for (const sx of [-0.12, 0.12]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, 0.06), lpOrnamentStone);
    post.position.set(cx + sx, baseY + 0.15, cz); grp.add(post);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.06), lpOrnamentStone);
  top.position.set(cx, baseY + 0.33, cz); grp.add(top);
  return grp;
}

// -----------------------------------------------------------------
//  Aba Jifar room interiors — visible when the ground-floor rooms
//  render with open tops (no roof, no wall cap). A small museum-style
//  vignette per room: a category-themed centerpiece ornament, framed
//  artwork on the external walls, and a single bench leaning against
//  the longest external wall.
// -----------------------------------------------------------------
const interiorFrameMat = new THREE.MeshStandardMaterial({
  color: 0x2a1c12, roughness: 0.78, metalness: 0, flatShading: true,
});
const interiorTrimMat  = new THREE.MeshStandardMaterial({
  color: 0xc89a3d, roughness: 0.45, metalness: 0.55, flatShading: true,
});
const interiorBenchMat = new THREE.MeshStandardMaterial({
  color: 0x6b432a, roughness: 0.85, metalness: 0, flatShading: true,
});
const interiorPedestalMat = new THREE.MeshStandardMaterial({
  color: 0xb9af9a, roughness: 0.92, metalness: 0, flatShading: true,
});
const interiorRugMat = new THREE.MeshStandardMaterial({
  color: 0x7d3a2a, roughness: 0.95, metalness: 0, flatShading: true,
});
const interiorPlaqueMat = new THREE.MeshStandardMaterial({
  color: 0x86663a, roughness: 0.6, metalness: 0.35, flatShading: true,
});
const interiorVitrineMat = new THREE.MeshStandardMaterial({
  color: 0xb9d2dd, roughness: 0.18, metalness: 0.4,
  transparent: true, opacity: 0.32,
  flatShading: true, side: THREE.DoubleSide, depthWrite: false,
});
const interiorVitrineBaseMat = new THREE.MeshStandardMaterial({
  color: 0x2d2018, roughness: 0.75, metalness: 0, flatShading: true,
});

// Tiny helper — does `(px, pz)` lie inside the polygon?
function _pointInPoly2D(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if (((zi > pz) !== (zj > pz)) &&
        (px < (xj - xi) * (pz - zi) / (zj - zi + 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function addAbaJifarRoomInteriors(group, room, polygonLocal, sharedEdges,
                                  wallsBaseY, wallHeight) {
  if (!Array.isArray(polygonLocal) || polygonLocal.length < 3) return;
  if (room.open) return;

  // Polygon bbox first — its centre is our preferred "room centre"
  // for placing the rug + centerpiece pedestal, since it reads as
  // visually-centred even when the polygon is a tilted or slightly
  // irregular rectangle (vertex-average centroid drifts off-axis).
  let pminX = Infinity, pmaxX = -Infinity, pminZ = Infinity, pmaxZ = -Infinity;
  for (const [x, z] of polygonLocal) {
    if (x < pminX) pminX = x; if (x > pmaxX) pmaxX = x;
    if (z < pminZ) pminZ = z; if (z > pmaxZ) pmaxZ = z;
  }
  const roomW = pmaxX - pminX;
  const roomD = pmaxZ - pminZ;
  const bboxCx = (pminX + pmaxX) / 2;
  const bboxCz = (pminZ + pmaxZ) / 2;

  // Vertex-average centroid — kept as a fallback when the bbox centre
  // falls outside the polygon (U-shape rooms whose bbox centre lands
  // in the hollow).
  let centroidX = 0, centroidZ = 0;
  for (const [x, z] of polygonLocal) { centroidX += x; centroidZ += z; }
  centroidX /= polygonLocal.length;
  centroidZ /= polygonLocal.length;

  const useBbox = _pointInPoly2D(bboxCx, bboxCz, polygonLocal);
  const cx = useBbox ? bboxCx : centroidX;
  const cz = useBbox ? bboxCz : centroidZ;

  // Bail out entirely if neither candidate centre sits inside the
  // polygon — props would just float outside the walls.
  if (!_pointInPoly2D(cx, cz, polygonLocal)) return;

  // 1. Rust-red rug under the centerpiece. Shrink the rug until all
  //    four corners sit inside the polygon, so it can't poke through
  //    a wall on irregular footprints. Cap by both bbox and absolute
  //    metres so a tiny entrance room doesn't get a wall-to-wall rug.
  const rugMaxW = Math.min(1.4, roomW * 0.45);
  const rugMaxD = Math.min(1.0, roomD * 0.45);
  let rugW = rugMaxW, rugD = rugMaxD;
  const rugFits = () => {
    const hx = rugW / 2, hz = rugD / 2;
    return _pointInPoly2D(cx - hx, cz - hz, polygonLocal) &&
           _pointInPoly2D(cx + hx, cz - hz, polygonLocal) &&
           _pointInPoly2D(cx - hx, cz + hz, polygonLocal) &&
           _pointInPoly2D(cx + hx, cz + hz, polygonLocal);
  };
  while (!rugFits() && rugW > 0.5 && rugD > 0.4) {
    rugW *= 0.85;
    rugD *= 0.85;
  }
  if (rugFits()) {
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(rugW, rugD),
      interiorRugMat,
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(cx, wallsBaseY + 0.01, cz);
    rug.receiveShadow = true;
    group.add(rug);
  }

  // 2. Small stone pedestal at the centroid, with the category-themed
  //    ornament on top.
  const PEDESTAL_W = 0.45;
  const PEDESTAL_H = 0.35;
  const ped = new THREE.Mesh(
    new THREE.BoxGeometry(PEDESTAL_W, PEDESTAL_H, PEDESTAL_W),
    interiorPedestalMat,
  );
  ped.position.set(cx, wallsBaseY + PEDESTAL_H / 2, cz);
  ped.castShadow = true;
  ped.receiveShadow = true;
  group.add(ped);

  const ornament = buildRoomOrnament(room, cx, cz, wallsBaseY + PEDESTAL_H);
  if (ornament) group.add(ornament);

  // 3. Up to two corner display pedestals (smaller, with a tiny cube /
  //    sphere artefact on top) — placed only if they fit inside the
  //    polygon and don't collide with the centerpiece.
  const cornerOffsets = [
    [ 0.85,  0.85],
    [-0.85,  0.85],
    [ 0.85, -0.85],
    [-0.85, -0.85],
  ];
  const usedCorners = [];
  for (const [dx, dz] of cornerOffsets) {
    if (usedCorners.length >= 2) break;
    const cpx = cx + dx;
    const cpz = cz + dz;
    if (!_pointInPoly2D(cpx, cpz, polygonLocal)) continue;
    // Skip if too close to the centerpiece pedestal.
    if (Math.hypot(cpx - cx, cpz - cz) < 1.0) continue;

    const SMALL_W = 0.30;
    const SMALL_H = 0.55;
    const smallPed = new THREE.Mesh(
      new THREE.BoxGeometry(SMALL_W, SMALL_H, SMALL_W),
      interiorPedestalMat,
    );
    smallPed.position.set(cpx, wallsBaseY + SMALL_H / 2, cpz);
    smallPed.castShadow = true;
    smallPed.receiveShadow = true;
    group.add(smallPed);

    // Tiny artefact — alternates sphere ↔ cube per corner.
    const artefact = (usedCorners.length % 2 === 0)
      ? new THREE.Mesh(
          new THREE.SphereGeometry(0.10, 10, 8),
          interiorTrimMat,
        )
      : new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.18, 0.18),
          lpOrnamentStone,
        );
    artefact.position.set(cpx, wallsBaseY + SMALL_H + 0.12, cpz);
    artefact.castShadow = true;
    group.add(artefact);
    usedCorners.push([cpx, cpz]);
  }

  // 4. Walk polygon edges — framed painting + brass plaque on each
  //    non-shared (external) wall, plus one bench against the longest
  //    wall.
  const areaSign = polygonSignedArea2D(polygonLocal) >= 0 ? 1 : -1;
  let benchPlaced = false;

  for (let i = 0; i < polygonLocal.length; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
    const ex = bx - ax, ez = bz - az;
    const edgeLen = Math.hypot(ex, ez);
    if (edgeLen < 1.2) continue;

    // Skip walls shared with another room — those are internal dividers.
    if (sharedEdges && Array.isArray(room.polygon) &&
        sharedEdges.has(edgeKey(
          room.polygon[i],
          room.polygon[(i + 1) % room.polygon.length],
        ))) continue;

    const ux = ex / edgeLen, uz = ez / edgeLen;
    // Inward normal (toward the polygon interior).
    const inwardX = -uz * areaSign;
    const inwardZ =  ux * areaSign;
    const mx = ax + ex / 2;
    const mz = az + ez / 2;
    const paintYaw = Math.atan2(inwardX, inwardZ);

    // --- Framed painting at wall-mid height, slightly inset so the
    //     trim doesn't z-fight the wall face. ---
    const paintW = Math.min(0.7, edgeLen * 0.35);
    const paintH = 0.42;
    const paintY = wallsBaseY + wallHeight * 0.60;
    const paintInset = 0.04;
    const ppx = mx + inwardX * paintInset;
    const ppz = mz + inwardZ * paintInset;

    const trim = new THREE.Mesh(
      new THREE.PlaneGeometry(paintW + 0.08, paintH + 0.08),
      interiorTrimMat,
    );
    trim.position.set(ppx, paintY, ppz);
    trim.rotation.y = paintYaw;
    group.add(trim);

    const canvas = new THREE.Mesh(
      new THREE.PlaneGeometry(paintW, paintH),
      interiorFrameMat,
    );
    canvas.position.set(
      ppx + inwardX * 0.004,
      paintY,
      ppz + inwardZ * 0.004,
    );
    canvas.rotation.y = paintYaw;
    group.add(canvas);

    // --- Small brass plaque just below the painting (museum caption). ---
    const plaqueW = Math.min(0.28, paintW * 0.55);
    const plaqueH = 0.10;
    const plaqueY = paintY - paintH / 2 - 0.10;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(plaqueW, plaqueH),
      interiorPlaqueMat,
    );
    plaque.position.set(
      ppx + inwardX * 0.006,
      plaqueY,
      ppz + inwardZ * 0.006,
    );
    plaque.rotation.y = paintYaw;
    group.add(plaque);

    // --- Bench against the first long external wall ---
    if (!benchPlaced && edgeLen > 1.8) {
      const benchW = Math.min(1.0, edgeLen * 0.55);
      const benchH = 0.10;
      const benchD = 0.30;
      const benchY = wallsBaseY + 0.30;
      const benchInset = 0.40;
      const bcx = mx + inwardX * benchInset;
      const bcz = mz + inwardZ * benchInset;
      // Yaw chosen so the box's +X axis aligns with (ux, uz) — bench
      // sits parallel to the wall.
      const benchYaw = Math.atan2(-uz, ux);

      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(benchW, benchH, benchD),
        interiorBenchMat,
      );
      seat.position.set(bcx, benchY, bcz);
      seat.rotation.y = benchYaw;
      seat.castShadow = true;
      seat.receiveShadow = true;
      group.add(seat);
      benchPlaced = true;
    }
  }

  // 5. One translucent glass vitrine offset from the centerpiece for
  //    rooms that are large enough to fit it without colliding.
  if (roomW > 3.0 && roomD > 3.0) {
    const vcx = cx + 1.2;
    const vcz = cz - 0.2;
    if (_pointInPoly2D(vcx, vcz, polygonLocal)) {
      const VITRINE_W = 0.65;
      const VITRINE_H = 0.85;
      const VITRINE_D = 0.40;
      // Dark wooden base under the glass case.
      const vbase = new THREE.Mesh(
        new THREE.BoxGeometry(VITRINE_W, 0.18, VITRINE_D),
        interiorVitrineBaseMat,
      );
      vbase.position.set(vcx, wallsBaseY + 0.09, vcz);
      vbase.castShadow = true;
      vbase.receiveShadow = true;
      group.add(vbase);
      // Glass cube on top.
      const vglass = new THREE.Mesh(
        new THREE.BoxGeometry(VITRINE_W - 0.04, VITRINE_H, VITRINE_D - 0.04),
        interiorVitrineMat,
      );
      vglass.position.set(vcx, wallsBaseY + 0.18 + VITRINE_H / 2, vcz);
      group.add(vglass);
    }
  }
}

// Push every polygon vertex outward from its centroid by `amount`. Used
// to expand the foundation/roof beyond the wall footprint for an
// overhang.
function offsetPolygonOutward(polygonLocal, amount) {
  let cx = 0, cz = 0;
  for (const [lx, lz] of polygonLocal) { cx += lx; cz += lz; }
  cx /= polygonLocal.length;
  cz /= polygonLocal.length;
  return polygonLocal.map(([lx, lz]) => {
    const dx = lx - cx, dz = lz - cz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return [lx, lz];
    return [lx + (dx / dist) * amount, lz + (dz / dist) * amount];
  });
}

// Extrude a 2D local-coord polygon into a 3D solid of the given height,
// laid flat in the XZ plane. Mesh position should be set to (baseY +
// height) by the caller.
function buildExtrudedPolygon(polygonLocal, height, material) {
  const shape = new THREE.Shape();
  for (let i = 0; i < polygonLocal.length; i++) {
    const [lx, lz] = polygonLocal[i];
    if (i === 0) shape.moveTo(lx, lz);
    else         shape.lineTo(lx, lz);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, material);
}

// Same idea as buildExtrudedPolygon but emits only the side walls of
// the extrusion — no top cap, no bottom cap. Lets the camera see the
// interior of the room from above. Mesh is placed at world origin so
// caller does NOT need to translate it; vertices are already at the
// correct world Y range [baseY, baseY+height].
function buildOpenTopExtrusion(polygonLocal, baseY, height, material) {
  const positions = [];
  const n = polygonLocal.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % n];
    // Quad as 2 triangles: (A,base)-(A,top)-(B,base) and (B,base)-(A,top)-(B,top)
    positions.push(ax, baseY,          az,
                   ax, baseY + height, az,
                   bx, baseY,          bz);
    positions.push(bx, baseY,          bz,
                   ax, baseY + height, az,
                   bx, baseY + height, bz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

// Returns a Set of floor-1 room ids that have at least one floor-2
// room whose footprint overlaps theirs — i.e. a multi-storey building.
// Used to pick "open-topped short walls" vs "tall walls + roof".
function computeFloor1RoomsWithFloor2Above() {
  const out = new Set();
  const f1 = ROOMS.filter((r) => r.floor === 1);
  const f2 = ROOMS.filter((r) => r.floor === 2);
  for (const r1 of f1) {
    const a = r1.footprint;
    for (const r2 of f2) {
      const b = r2.footprint;
      if (a.x < b.x + b.w && a.x + a.w > b.x &&
          a.z < b.z + b.d && a.z + a.d > b.z) {
        out.add(r1.id);
        break;
      }
    }
  }
  return out;
}

// Compute the set of polygon edges that are shared by two rooms on the
// same floor. Used to suppress windows on internal walls (so adjacent
// rooms inside a single building don't all stamp windows on the wall
// they share). Keys are stable across rooms even with vertex-order
// differences and small floating-point jitter.
function computeSharedEdges(rooms) {
  const seen = new Map();
  for (const room of rooms) {
    if (!Array.isArray(room.polygon)) continue;
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % room.polygon.length];
      const key = edgeKey(a, b);
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  const shared = new Set();
  for (const [k, c] of seen) if (c >= 2) shared.add(k);
  return shared;
}
function edgeKey(a, b) {
  const round = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const r1 = `${round(a[0])},${round(a[1])}`;
  const r2 = `${round(b[0])},${round(b[1])}`;
  return r1 < r2 ? `${r1}|${r2}` : `${r2}|${r1}`;
}

// Signed area of a 2D polygon in XZ. Sign indicates winding (positive
// or negative depending on convention) — combined with a +90° edge
// rotation it gives a true edge-perpendicular outward normal, which is
// what window panes need to sit flush against their wall.
function polygonSignedArea2D(poly) {
  let s = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

// Place a row of windows along every external wall edge. The outward
// normal is the edge-perpendicular flipped to point away from the
// polygon centroid, so the window plane is coplanar with the wall
// face on both rectangular and irregular (U-shape) footprints. Edges
// shared with another room's polygon (internal walls inside a single
// building) are skipped.
function buildLowPolyWindows(group, room, polygonLocal, wallsBaseY, wallHeight, sharedEdges, doorsForRoom = []) {
  if (!Array.isArray(room.polygon)) return;
  const windowY = wallsBaseY + wallHeight * 0.58;

  let cx = 0, cz = 0;
  for (const [lx, lz] of polygonLocal) { cx += lx; cz += lz; }
  cx /= polygonLocal.length;
  cz /= polygonLocal.length;

  // Winding sign — used to pick which 90° rotation of the edge points
  // outward. For the room polygons in this project the same sign holds
  // for every edge of a given polygon, so we compute it once.
  const areaSign = polygonSignedArea2D(polygonLocal) >= 0 ? 1 : -1;

  // Door positions on this room — used to suppress windows that would
  // otherwise be stamped behind a door panel on the same wall. Window
  // half-width 0.275 + door half-width 0.35 + small visual gap → ~0.8m
  // centre-to-centre clearance keeps the panels from overlapping.
  const doorPositions = (doorsForRoom || []).map(
    (d) => [offsetX(d.x), offsetZ(d.z)],
  );
  const WINDOW_DOOR_CLEARANCE = 0.80;

  for (let i = 0; i < polygonLocal.length; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
    const ex = bx - ax, ez = bz - az;
    const edgeLen = Math.hypot(ex, ez);
    if (edgeLen < LP_EDGE_MIN_FOR_WINDOWS) continue;
    // Skip internal walls (shared with another room's polygon).
    if (sharedEdges && sharedEdges.has(edgeKey(room.polygon[i], room.polygon[(i + 1) % room.polygon.length]))) continue;

    // Edge-perpendicular outward normal. (ez, -ex) rotated by winding
    // sign so it points away from the polygon interior. This is the
    // TRUE perpendicular of the wall edge — using the radial direction
    // (mid - centroid) tilts the window plane off the wall on
    // irregular footprints like the palace block or U-shape.
    const nx = (ez / edgeLen) * areaSign;
    const nz = (-ex / edgeLen) * areaSign;
    const wallAngle = Math.atan2(nx, nz);

    const margin = 0.5;
    const usable = edgeLen - margin * 2;
    if (usable <= 0) continue;
    const count = Math.max(1, Math.round(usable / LP_WINDOW_SPACING));
    const ux = ex / edgeLen, uz = ez / edgeLen;

    for (let j = 0; j < count; j++) {
      const t = margin + usable * (j + 0.5) / count;
      const wx = ax + ux * t + nx * 0.04;
      const wz = az + uz * t + nz * 0.04;
      // Skip if a door panel sits on this wall at roughly the same
      // position — otherwise the window shows through behind the door.
      let nearDoor = false;
      for (const [dx, dz] of doorPositions) {
        if (Math.hypot(dx - wx, dz - wz) < WINDOW_DOOR_CLEARANCE) {
          nearDoor = true; break;
        }
      }
      if (nearDoor) continue;
      group.add(buildWindowPanel(wx, windowY, wz, wallAngle));

      // --- Dark wooden shutters flanking the window ---
      const SHUTTER_W = 0.14;
      const SHUTTER_H = LP_WINDOW_H + 0.04;
      const shutterOffset = LP_WINDOW_W / 2 + SHUTTER_W / 2 + 0.02;
      for (const side of [-1, 1]) {
        const sx = wx + ux * shutterOffset * side;
        const sz = wz + uz * shutterOffset * side;
        const shutter = new THREE.Mesh(
          new THREE.PlaneGeometry(SHUTTER_W, SHUTTER_H),
          lpWindowFrameMat,
        );
        shutter.position.set(sx, windowY, sz);
        shutter.rotation.y = wallAngle;
        group.add(shutter);
      }
    }
  }
}

// Stamp a dark door panel onto whichever wall edge of the polygon is
// closest to each door's (x,z) world position. The door is a thin
// plane offset slightly outward from the wall plane, with a small
// lintel strip across the top. Walls themselves remain solid (no
// cut-out), which keeps the low-poly look simple.
function buildLowPolyDoors(group, polygonLocal, wallsBaseY, doors) {
  if (!Array.isArray(polygonLocal) || polygonLocal.length < 3) return;
  const doorY = wallsBaseY + LP_DOOR_H / 2;

  // Winding sign — used to pick which 90° rotation of each edge points
  // outward from the polygon interior. See buildLowPolyWindows for the
  // longer explanation.
  const areaSign = polygonSignedArea2D(polygonLocal) >= 0 ? 1 : -1;

  for (const door of doors) {
    const wx = offsetX(door.x);
    const wz = offsetZ(door.z);

    // Find the closest polygon edge to this door's world position.
    let bestI = -1, bestDist = Infinity, bestT = 0;
    for (let i = 0; i < polygonLocal.length; i++) {
      const [ax, az] = polygonLocal[i];
      const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
      const ex = bx - ax, ez = bz - az;
      const len2 = ex * ex + ez * ez;
      if (len2 < 0.001) continue;
      const t = Math.max(0, Math.min(1, ((wx - ax) * ex + (wz - az) * ez) / len2));
      const px = ax + ex * t, pz = az + ez * t;
      const d = Math.hypot(wx - px, wz - pz);
      if (d < bestDist) { bestDist = d; bestI = i; bestT = t; }
    }
    if (bestI < 0) continue;
    // Skip doors whose nearest wall is far — they belong to another room.
    if (bestDist > 1.5) continue;

    const [ax, az] = polygonLocal[bestI];
    const [bx, bz] = polygonLocal[(bestI + 1) % polygonLocal.length];
    const ex = bx - ax, ez = bz - az;
    const edgeLen = Math.hypot(ex, ez);
    if (edgeLen < 0.001) continue;
    const ux = ex / edgeLen, uz = ez / edgeLen;

    // Edge-perpendicular outward normal — same convention as the
    // windows so the door panel sits flush against the wall.
    const nx = (ez / edgeLen) * areaSign;
    const nz = (-ex / edgeLen) * areaSign;
    const wallAngle = Math.atan2(nx, nz);

    // Position the door panel on the wall (small outward offset so the
    // plane sits in front of the wall surface, not z-fighting with it).
    const px = ax + ux * (bestT * edgeLen) + nx * 0.05;
    const pz = az + uz * (bestT * edgeLen) + nz * 0.05;

    const doorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(LP_DOOR_W, LP_DOOR_H),
      lpDoorMat,
    );
    doorMesh.position.set(px, doorY, pz);
    doorMesh.rotation.y = wallAngle;
    group.add(doorMesh);

    // Small lintel across the top — a 7 cm dark wood band.
    const lintel = new THREE.Mesh(
      new THREE.PlaneGeometry(LP_DOOR_W + 0.10, 0.07),
      lpWindowFrameMat,
    );
    lintel.position.set(
      px,
      doorY + LP_DOOR_H / 2 + 0.04,
      pz,
    );
    lintel.rotation.y = wallAngle;
    group.add(lintel);

    // --- Wall sconces flanking the door — small dark mounts with a
    //     warm glowing orb. Project slightly outward so the orb sits
    //     proud of the wall plane.
    const SCONCE_OFFSET = LP_DOOR_W / 2 + 0.18;
    const SCONCE_Y = doorY + LP_DOOR_H / 2 - 0.05;
    for (const side of [-1, 1]) {
      const spx = ax + ux * (bestT * edgeLen) + ux * SCONCE_OFFSET * side + nx * 0.10;
      const spz = az + uz * (bestT * edgeLen) + uz * SCONCE_OFFSET * side + nz * 0.10;
      // Dark wall plate
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.18, 0.05),
        lpFoundationMat,
      );
      plate.position.set(spx, SCONCE_Y, spz);
      plate.rotation.y = wallAngle;
      plate.castShadow = true;
      group.add(plate);
      // Warm glowing orb — small sphere with emissive amber.
      const orbX = spx + nx * 0.08;
      const orbZ = spz + nz * 0.08;
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        sconceOrbMat,
      );
      orb.position.set(orbX, SCONCE_Y, orbZ);
      group.add(orb);
    }

    // --- Stone planters flanking the door — terracotta urn + green
    //     shrub on top, projecting outward from the wall onto the
    //     veranda. Skip if the door sits very close to the polygon
    //     edge endpoints (corner — no room for the planter).
    const PLANTER_OFFSET = LP_DOOR_W / 2 + 0.55;
    if (bestT * edgeLen > 1.0 && (1 - bestT) * edgeLen > 1.0) {
      for (const side of [-1, 1]) {
        const ppx = ax + ux * (bestT * edgeLen) + ux * PLANTER_OFFSET * side + nx * 0.55;
        const ppz = az + uz * (bestT * edgeLen) + uz * PLANTER_OFFSET * side + nz * 0.55;
        const urn = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.14, 0.30, 10),
          planterUrnMat,
        );
        urn.position.set(ppx, wallsBaseY + 0.15, ppz);
        urn.castShadow = true;
        urn.receiveShadow = true;
        group.add(urn);
        const shrub = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.20, 0),
          planterShrubMat,
        );
        shrub.position.set(ppx, wallsBaseY + 0.42, ppz);
        shrub.castShadow = true;
        group.add(shrub);
      }
    }
  }
}

// ============================================================
//  BuildingFacadeDetails
//  ----------------------------------------------------------
//  Pure decoration layer added on top of every room. Reads the
//  existing polygon + wall height, never modifies them. Adds:
//    · A thin veranda / balcony strip extending outward from each
//      eligible external edge.
//    · Dark wooden columns at regular intervals along ground-floor
//      veranda edges (skipped near doors). Drawn as a single
//      InstancedMesh per room so 200+ columns cost one draw call.
//    · Dark thin railings (top rail, bottom rail, balusters) on
//      upper-floor balcony edges.
//    · A wooden trim band running just below the roof eave.
//    · A soft transparent contact-shadow plane under each veranda.
//
//  Knobs (top of section):
//    FACADE_DETAILS        — master on/off
//    FACADE_VERANDA_WIDTH  — outward depth of veranda strip
//    FACADE_COLUMN_SPACING — gap between adjacent columns
//    FACADE_RAILING_HIDDEN — set true to skip the balcony railings
//    FACADE_MIN_EDGE_LEN   — edges shorter than this get no veranda
//    FACADE_DOOR_CLEARANCE — column-position skip radius around doors
// ============================================================
// IMPORTANT: this is the OLD broken auto-layer that derived edges
// from every polygon. It rotated horizontal BoxGeometry pieces with
// Math.atan2(ux, uz), which is 90° off for a box whose long axis is
// +X — so verandas, eave trim and railings ran perpendicular to the
// walls (long beams sticking through roofs and across courtyards).
// Disabled here. The new system lives in addFacadeFromZones below
// and reads explicit zones from FACADE_ZONES.
const FACADE_DETAILS         = false;
const FACADE_RAILING_HIDDEN  = true;
const FACADE_VERANDA_WIDTH   = 0.40;
const FACADE_VERANDA_H       = 0.05;
const FACADE_COLUMN_SPACING  = 1.80;
const FACADE_COLUMN_RADIUS   = 0.085;
const FACADE_COLUMN_HEIGHT   = LP_WALL_HEIGHT_T;        // foundation top → wall top
const FACADE_RAILING_H       = 0.60;
const FACADE_RAILING_THICK   = 0.045;
const FACADE_BALUSTER_GAP    = 0.35;
const FACADE_TRIM_H          = 0.09;
const FACADE_TRIM_PROJ       = 0.08;
const FACADE_MIN_EDGE_LEN    = 3.5;
const FACADE_DOOR_CLEARANCE  = 0.70;

const facadeVerandaMat = new THREE.MeshStandardMaterial({
  color: 0xc7b88f, roughness: 0.95, metalness: 0, flatShading: true,
});
const facadeColumnMat = new THREE.MeshStandardMaterial({
  color: 0x3d2210, roughness: 0.85, metalness: 0, flatShading: true,
});
const facadeRailingMat = new THREE.MeshStandardMaterial({
  color: 0x3d2210, roughness: 0.85, metalness: 0, flatShading: true,
});
const facadeTrimMat = new THREE.MeshStandardMaterial({
  color: 0x4a3220, roughness: 0.90, metalness: 0, flatShading: true,
});
const facadeContactMat = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false,
});

// Shared geometries — InstancedMesh reuses these across rooms.
const facadeColumnGeo = new THREE.CylinderGeometry(
  FACADE_COLUMN_RADIUS, FACADE_COLUMN_RADIUS,
  FACADE_COLUMN_HEIGHT, 6,
);

function addBuildingFacadeDetails(group, opts) {
  if (!FACADE_DETAILS) return;
  const { room, polygonLocal, wallsBaseY, wallHeight, sharedEdges,
          doorsForRoom = [], isRoofed } = opts;
  if (!Array.isArray(polygonLocal) || polygonLocal.length < 3) return;

  const areaSign = polygonSignedArea2D(polygonLocal) >= 0 ? 1 : -1;
  const wallTopY = wallsBaseY + wallHeight;
  const isFloor1 = room.floor === 1;

  // Door positions in local plan-centered coords — used to skip column
  // placements that would block a doorway.
  const doorPositions = doorsForRoom.map((d) => [offsetX(d.x), offsetZ(d.z)]);

  const tmpMat = new THREE.Matrix4();
  const columnMatrices = [];

  for (let i = 0; i < polygonLocal.length; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
    const ex = bx - ax, ez = bz - az;
    const edgeLen = Math.hypot(ex, ez);
    if (edgeLen < FACADE_MIN_EDGE_LEN) continue;
    // Skip internal walls shared with another room.
    if (sharedEdges && Array.isArray(room.polygon) &&
        sharedEdges.has(edgeKey(
          room.polygon[i],
          room.polygon[(i + 1) % room.polygon.length],
        ))) continue;

    const ux = ex / edgeLen, uz = ez / edgeLen;
    const nx = (ez / edgeLen) * areaSign;
    const nz = (-ex / edgeLen) * areaSign;
    const edgeYaw = Math.atan2(ux, uz);

    // Centre of veranda strip — sits along the wall with FACADE_VERANDA_WIDTH
    // pushed outward from the wall plane.
    const verandaCx = ax + ex / 2 + nx * (FACADE_VERANDA_WIDTH / 2);
    const verandaCz = az + ez / 2 + nz * (FACADE_VERANDA_WIDTH / 2);

    // --- Veranda strip ---
    const veranda = new THREE.Mesh(
      new THREE.BoxGeometry(edgeLen, FACADE_VERANDA_H, FACADE_VERANDA_WIDTH),
      facadeVerandaMat,
    );
    veranda.position.set(verandaCx, wallsBaseY + FACADE_VERANDA_H / 2, verandaCz);
    veranda.rotation.y = edgeYaw;
    veranda.castShadow = true;
    veranda.receiveShadow = true;
    group.add(veranda);

    // --- Contact shadow under veranda ---
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(edgeLen + 0.25, FACADE_VERANDA_WIDTH + 0.25),
      facadeContactMat,
    );
    contact.rotation.x = -Math.PI / 2;
    contact.rotation.z = -edgeYaw;
    contact.position.set(verandaCx, wallsBaseY - 0.001, verandaCz);
    group.add(contact);

    // --- Wooden trim band under the roof eave (roofed rooms only) ---
    if (isRoofed) {
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(edgeLen, FACADE_TRIM_H, FACADE_TRIM_PROJ),
        facadeTrimMat,
      );
      const trimCx = ax + ex / 2 + nx * (FACADE_TRIM_PROJ / 2);
      const trimCz = az + ez / 2 + nz * (FACADE_TRIM_PROJ / 2);
      trim.position.set(trimCx, wallTopY - FACADE_TRIM_H / 2, trimCz);
      trim.rotation.y = edgeYaw;
      trim.castShadow = true;
      group.add(trim);
    }

    // --- Ground-floor columns under the veranda's outer edge ---
    if (isFloor1) {
      // Distribute columns at FACADE_COLUMN_SPACING with both ends pinned.
      const count = Math.max(2, Math.round(edgeLen / FACADE_COLUMN_SPACING) + 1);
      const colOutset = FACADE_VERANDA_WIDTH - FACADE_COLUMN_RADIUS - 0.02;
      for (let j = 0; j < count; j++) {
        const t = j / (count - 1);
        const px = ax + ex * t + nx * colOutset;
        const pz = az + ez * t + nz * colOutset;
        // Skip column if it would block a doorway.
        let blocked = false;
        for (const [dx, dz] of doorPositions) {
          if (Math.hypot(dx - px, dz - pz) < FACADE_DOOR_CLEARANCE) {
            blocked = true; break;
          }
        }
        if (blocked) continue;
        tmpMat.makeTranslation(
          px,
          wallsBaseY + FACADE_COLUMN_HEIGHT / 2,
          pz,
        );
        columnMatrices.push(tmpMat.clone());
      }
    }

    // --- Upper-floor balcony railings ---
    if (!isFloor1 && !FACADE_RAILING_HIDDEN) {
      const railOutset = FACADE_VERANDA_WIDTH - 0.04;
      const railCx = ax + ex / 2 + nx * railOutset;
      const railCz = az + ez / 2 + nz * railOutset;

      // Top rail
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(edgeLen, FACADE_RAILING_THICK, FACADE_RAILING_THICK),
        facadeRailingMat,
      );
      top.position.set(railCx, wallsBaseY + FACADE_RAILING_H, railCz);
      top.rotation.y = edgeYaw;
      top.castShadow = true;
      group.add(top);

      // Bottom rail
      const bot = new THREE.Mesh(
        new THREE.BoxGeometry(edgeLen, FACADE_RAILING_THICK, FACADE_RAILING_THICK),
        facadeRailingMat,
      );
      bot.position.set(railCx, wallsBaseY + 0.12, railCz);
      bot.rotation.y = edgeYaw;
      bot.castShadow = true;
      group.add(bot);

      // Balusters (vertical pickets) between the two rails
      const baluCount = Math.max(2, Math.round(edgeLen / FACADE_BALUSTER_GAP));
      const baluH = FACADE_RAILING_H - 0.12;
      const baluThick = FACADE_RAILING_THICK * 0.6;
      for (let j = 0; j <= baluCount; j++) {
        const t = j / baluCount;
        const bxL = ax + ex * t + nx * railOutset;
        const bzL = az + ez * t + nz * railOutset;
        const balu = new THREE.Mesh(
          new THREE.BoxGeometry(baluThick, baluH, baluThick),
          facadeRailingMat,
        );
        balu.position.set(bxL, wallsBaseY + 0.12 + baluH / 2, bzL);
        balu.rotation.y = edgeYaw;
        group.add(balu);
      }
    }
  }

  // --- Emit columns as a single InstancedMesh per room ---
  if (columnMatrices.length > 0) {
    const inst = new THREE.InstancedMesh(
      facadeColumnGeo, facadeColumnMat, columnMatrices.length,
    );
    for (let k = 0; k < columnMatrices.length; k++) {
      inst.setMatrixAt(k, columnMatrices[k]);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
}

// ============================================================
//  FacadeZones — explicit, zone-based facade pass (v2)
//  ----------------------------------------------------------
//  Replaces the broken auto-derived layer above. Nothing renders
//  unless an entry in FACADE_ZONES asks for it. Coords are RAW
//  plan units (the same coordinate system as room.footprint.x/z
//  in data.js), making zones easy to read off the data file.
//
//  Toggles:
//    SHOW_FACADE_DETAILS — render the actual columns/railings
//    SHOW_FACADE_DEBUG   — overlay magenta cubes + a yellow line
//                          on each zone so placement can be
//                          verified before turning details on
//
//  Each zone:
//    {
//      buildingId: "5",
//      type: "columns" | "railings",
//      edgeStart:  [planX, planZ],
//      edgeEnd:    [planX, planZ],
//      outwardDir: [dirX, dirZ],   // unit vec away from building
//      baseY: <floor of element>,
//      topY:  <top of element — must stay below the roof eave>,
//      spacing: <metres>,
//      outset: <metres from wall>,
//      floor: 1 | 2,
//    }
//
//  Sanity checks applied at render time:
//    · column position must lie on the (outset-shifted) edge segment
//    · topY must not pass the roof apex (capped at 2.7)
//    · zero-length edges are skipped
//    · baseY < topY
// ============================================================
const SHOW_FACADE_DETAILS = false;   // master switch for the new layer
const SHOW_FACADE_DEBUG   = false;   // magenta placement markers + edge guides

// Test entry — one zone, on the small Religion pavilion (room 5).
// Verify visually with SHOW_FACADE_DEBUG = true, then flip
// SHOW_FACADE_DETAILS = true to render columns. Expand to other
// buildings only after this one looks correct.
const FACADE_ZONES = [
  {
    buildingId: "5",
    type:       "columns",
    edgeStart:  [13.86, 27.42],   // south-west corner of room 5
    edgeEnd:    [17.70, 27.42],   // south-east corner of room 5
    outwardDir: [0, 1],           // +Z is south on the SVG
    baseY:      0.21,             // top of foundation plinth
    topY:       1.81,             // top of wall, just under the eave
    spacing:    1.20,
    outset:     0.40,
    floor:      1,
  },
];

const facadeDebugDotMat = new THREE.MeshBasicMaterial({
  color: 0xff00ff, depthTest: false, transparent: true, opacity: 0.95,
});
const facadeDebugEdgeMat = new THREE.LineBasicMaterial({
  color: 0xffcc00, depthTest: false, transparent: true, opacity: 0.9,
});

function addFacadeFromZones(floorGroup, floor) {
  if (!SHOW_FACADE_DETAILS && !SHOW_FACADE_DEBUG) return;

  for (const zone of FACADE_ZONES) {
    if (zone.floor !== floor.id) continue;

    // Convert raw plan coords to local plan-centred coords.
    const sx = zone.edgeStart[0] - planCenter.x;
    const sz = zone.edgeStart[1] - planCenter.z;
    const ex = zone.edgeEnd[0]   - planCenter.x;
    const ez = zone.edgeEnd[1]   - planCenter.z;
    const dx = ex - sx, dz = ez - sz;
    const edgeLen = Math.hypot(dx, dz);
    if (edgeLen < 0.1) continue;
    if (zone.topY <= zone.baseY) continue;

    // Normalise outward direction defensively.
    const [nxRaw, nzRaw] = zone.outwardDir;
    const nLen = Math.hypot(nxRaw, nzRaw) || 1;
    const nx = nxRaw / nLen, nz = nzRaw / nLen;

    const colH = zone.topY - zone.baseY;
    const count = Math.max(2, Math.floor(edgeLen / Math.max(0.2, zone.spacing)) + 1);

    // --- Debug visualisation (always-on-top guides) ---
    if (SHOW_FACADE_DEBUG) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(sx + nx * zone.outset, zone.baseY + 0.02, sz + nz * zone.outset),
        new THREE.Vector3(ex + nx * zone.outset, zone.baseY + 0.02, ez + nz * zone.outset),
      ]);
      const line = new THREE.Line(lineGeo, facadeDebugEdgeMat);
      line.renderOrder = 99;
      floorGroup.add(line);

      const dotGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
      for (let i = 0; i < count; i++) {
        const t = (count === 1) ? 0.5 : (i / (count - 1));
        const px = sx + dx * t + nx * zone.outset;
        const pz = sz + dz * t + nz * zone.outset;
        const dot = new THREE.Mesh(dotGeo, facadeDebugDotMat);
        dot.position.set(px, zone.baseY + 0.1, pz);
        dot.renderOrder = 100;
        floorGroup.add(dot);
      }
    }

    if (!SHOW_FACADE_DETAILS) continue;

    // Sanity: never let a column rise past a sensible roof apex.
    if (zone.topY > 2.7) continue;

    if (zone.type === "columns") {
      const geo = new THREE.CylinderGeometry(
        FACADE_COLUMN_RADIUS, FACADE_COLUMN_RADIUS, colH, 6,
      );
      const ux = dx / edgeLen, uz = dz / edgeLen;
      for (let i = 0; i < count; i++) {
        const t = (count === 1) ? 0.5 : (i / (count - 1));
        const px = sx + dx * t + nx * zone.outset;
        const pz = sz + dz * t + nz * zone.outset;

        // Sanity: ensure the position lies on the outset-shifted edge
        // segment (within a 0.5 m tolerance perpendicular to the edge).
        const baseX = sx + nx * zone.outset;
        const baseZ = sz + nz * zone.outset;
        const projT = (px - baseX) * ux + (pz - baseZ) * uz;
        const perpD = Math.abs((px - baseX) * (-uz) + (pz - baseZ) * ux);
        if (projT < -0.05 || projT > edgeLen + 0.05) continue;
        if (perpD > 0.5) continue;

        const col = new THREE.Mesh(geo, facadeColumnMat);
        col.position.set(px, zone.baseY + colH / 2, pz);
        col.castShadow = true;
        col.receiveShadow = true;
        floorGroup.add(col);
      }
    }
    // Railings deliberately deferred until columns are verified per
    // the user's "start small, expand later" instruction.
  }
}

// ============================================================
//  GroundSurfaceDetails — ground & plaza decoration pass
//  ----------------------------------------------------------
//  Pure decoration. Adds on top of the existing platforms, paths,
//  and grass:
//    · Subtle stone-tile grid overlay on each platform.
//    · Slightly darker stone band wrapped around each platform's
//      perimeter so it reads as a raised pad, not a flat polygon.
//    · Thin raised curbs running alongside primary + secondary
//      walk paths (offset outside the path, so the existing painted
//      stripes still mark the path boundary itself).
//    · Optional step blocks at STAIR_ZONES (empty by default — no
//      stair geometry exists in the source data yet).
//    · Scattered subtle low-poly grass-color patches in the open
//      grass area, for ground variation.
//
//  Toggles (all default true):
//    SHOW_GROUND_DETAILS   — master switch
//    SHOW_PAVING_LINES     — tile grid on platforms
//    SHOW_CURBS            — raised stone curbs along paths
//    SHOW_STAIR_DETAILS    — step blocks at STAIR_ZONES
//    SHOW_GRASS_VARIATION  — green color patches
// ============================================================
const SHOW_GROUND_DETAILS   = true;
const SHOW_PAVING_LINES     = true;
const SHOW_CURBS            = true;
const SHOW_STAIR_DETAILS    = true;
const SHOW_GRASS_VARIATION  = false;

// Tile grid on platforms
const GD_TILE_SIZE          = 1.60;   // metres — distance between grout lines
const GD_TILE_OPACITY       = 0.30;   // alpha of the grout line in the overlay
const GD_TILE_LIFT          = 0.003;  // metres above platform surface

// Path curbs
const GD_CURB_HEIGHT        = 0.05;   // metres — how much the curb rises
const GD_CURB_WIDTH         = 0.09;   // metres — perpendicular thickness
const GD_CURB_GAP           = 0.04;   // metres — gap between path edge and curb
const GD_CURB_END_INSET     = 0.40;   // metres — pull-back from each waypoint

// Platform edge band
const GD_EDGE_WIDTH         = 0.20;   // metres — width of the band around platforms
const GD_EDGE_HEIGHT        = 0.025;  // metres — band thickness

// Stair zones — explicit, none defined yet. Add entries like:
// { start: [px, pz], end: [px, pz], stepCount: 3, stepHeight: 0.06,
//   stepDepth: 0.30, width: 1.20, floor: 1 }
const STAIR_ZONES = [];

// Materials
const gdEdgeBandMat = new THREE.MeshStandardMaterial({
  color: 0xb19a78, roughness: 0.95, metalness: 0, flatShading: true,
});
const gdCurbMat = new THREE.MeshStandardMaterial({
  color: 0x8d8474, roughness: 0.92, metalness: 0, flatShading: true,
});
const gdStairMat = new THREE.MeshStandardMaterial({
  color: 0xa89478, roughness: 0.95, metalness: 0, flatShading: true,
});
const gdGrassPatchMats = [
  new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 1.0, metalness: 0, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x7c9852, roughness: 1.0, metalness: 0, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x6c8a40, roughness: 1.0, metalness: 0, flatShading: true }),
];

// Shared paving texture — cloned per platform so each can set its
// own .repeat without affecting the others.
let _gdPavingTex = null;
function gdGetPavingTexture() {
  if (_gdPavingTex) return _gdPavingTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = `rgba(120, 102, 80, ${GD_TILE_OPACITY})`;
  ctx.lineWidth = 2.2;
  // One grout square — gets tiled via texture.repeat.
  ctx.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _gdPavingTex = tex;
  return tex;
}

// Same logic as buildBuildingPlatform — used so the overlay / band
// match the actual platform polygon exactly.
function gdPlatformPolygon(room) {
  let polygonLocal;
  if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
    polygonLocal = room.polygon.map(([px, py]) => [px - planCenter.x, py - planCenter.z]);
  } else {
    const { x, z, w, d } = room.footprint;
    const inset = 0.06;
    polygonLocal = [
      [offsetX(x + inset),      offsetZ(z + inset)],
      [offsetX(x + w - inset),  offsetZ(z + inset)],
      [offsetX(x + w - inset),  offsetZ(z + d - inset)],
      [offsetX(x + inset),      offsetZ(z + d - inset)],
    ];
  }
  return offsetPolygonOutward(polygonLocal, PLATFORM_PAD);
}

// Tile grid overlay for a single platform polygon.
function buildGdPavingOverlay(room) {
  const platformPoly = gdPlatformPolygon(room);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of platformPoly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const bw = maxX - minX, bd = maxZ - minZ;
  if (bw < 0.6 || bd < 0.6) return null;

  const tex = gdGetPavingTexture().clone();
  tex.needsUpdate = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(bw / GD_TILE_SIZE, bd / GD_TILE_SIZE);

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
  });

  // Almost-flat extrusion that follows the platform polygon exactly.
  const overlay = buildExtrudedPolygon(platformPoly, 0.001, mat);
  overlay.position.y = PLATFORM_Y + PLATFORM_H + GD_TILE_LIFT;
  return overlay;
}

// Darker band wrapped around the platform perimeter — sits at
// PLATFORM_Y, sticking out GD_EDGE_WIDTH past the platform so the
// platform reads as a raised pad with a stone border.
function buildGdPlatformEdgeBand(room) {
  const platformPoly = gdPlatformPolygon(room);
  const outerPoly = offsetPolygonOutward(platformPoly, GD_EDGE_WIDTH);

  // Outer shape with the platform polygon as a hole = a polygon ring.
  const shape = new THREE.Shape();
  for (let i = 0; i < outerPoly.length; i++) {
    const [x, z] = outerPoly[i];
    if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
  }
  const hole = new THREE.Path();
  for (let i = 0; i < platformPoly.length; i++) {
    const [x, z] = platformPoly[i];
    if (i === 0) hole.moveTo(x, z); else hole.lineTo(x, z);
  }
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: GD_EDGE_HEIGHT, bevelEnabled: false,
  });
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, gdEdgeBandMat);
  mesh.position.y = PLATFORM_Y + GD_EDGE_HEIGHT;
  mesh.receiveShadow = true;
  return mesh;
}

// Raised stone curbs along each primary / secondary path edge.
// Curbs are offset outward from the path centreline (path style
// half-width + small gap + half curb width) and pulled back at each
// end so they don't pile up on the waypoint disc.
function addPathCurbsForFloor(group) {
  if (!WAYPOINTS || !WAYPOINT_EDGES) return;
  const wpById = new Map(WAYPOINTS.map((w) => [w.id, w]));

  for (const edge of WAYPOINT_EDGES) {
    const [aId, bId, type = "primary"] = edge;
    const style = PATH_STYLE[type] ?? PATH_STYLE.primary;
    if (!style.curbs) continue;

    const a = wpById.get(aId), b = wpById.get(bId);
    if (!a || !b) continue;

    const ax = offsetX(a.x), az = offsetZ(a.z);
    const bx = offsetX(b.x), bz = offsetZ(b.z);
    const dx = bx - ax, dz = bz - az;
    const fullLen = Math.hypot(dx, dz);
    const curbLen = fullLen - 2 * GD_CURB_END_INSET;
    if (curbLen < 0.6) continue;

    const ux = dx / fullLen, uz = dz / fullLen;
    // Perpendicular (in XZ) — 90° clockwise around Y from forward.
    const px = -uz, pz = ux;
    const sideOffset = style.width / 2 + GD_CURB_GAP + GD_CURB_WIDTH / 2;
    const curbY = style.yOffset + GD_CURB_HEIGHT / 2;
    // Box's long axis is +X; rotate so +X aligns with (ux, uz).
    const yaw = Math.atan2(-uz, ux);

    for (const side of [-1, 1]) {
      const cx = (ax + bx) / 2 + px * sideOffset * side;
      const cz = (az + bz) / 2 + pz * sideOffset * side;
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(curbLen, GD_CURB_HEIGHT, GD_CURB_WIDTH),
        gdCurbMat,
      );
      curb.position.set(cx, curbY, cz);
      curb.rotation.y = yaw;
      curb.castShadow = true;
      curb.receiveShadow = true;
      group.add(curb);
    }
  }
}

// Step blocks at explicit STAIR_ZONES entries. Empty by default —
// stair geometry isn't encoded in the source data, so this stays
// dormant until zones are added.
function addStairZonesForFloor(group, floorId) {
  for (const zone of STAIR_ZONES) {
    if (zone.floor !== floorId) continue;
    const sx = offsetX(zone.start[0]), sz = offsetZ(zone.start[1]);
    const ex = offsetX(zone.end[0]),   ez = offsetZ(zone.end[1]);
    const dx = ex - sx, dz = ez - sz;
    const len = Math.hypot(dx, dz);
    if (len < 0.1 || zone.stepCount < 1) continue;
    const ux = dx / len, uz = dz / len;
    const yaw = Math.atan2(-uz, ux);
    const stepLen = len / zone.stepCount;
    for (let i = 0; i < zone.stepCount; i++) {
      const t = (i + 0.5) / zone.stepCount;
      const stepCx = sx + dx * t;
      const stepCz = sz + dz * t;
      const stepY = (i + 0.5) * zone.stepHeight;
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(zone.width, zone.stepHeight, stepLen),
        gdStairMat,
      );
      step.position.set(stepCx, stepY, stepCz);
      step.rotation.y = yaw;
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }
  }
}

// Subtle low-poly grass patches on the outer lawn. Each patch is an
// 8-segment circle (octagon) at the lawn surface, tinted with one of
// three slightly different greens so the lawn reads as soft natural
// variation rather than a uniform flat colour. All positions sit
// OUTSIDE SITE_PLAZA (world x:[-32.7..12.3] z:[-26.9..13.1]) so they
// aren't hidden under the cobblestone block.
function addGroundGrassPatches(root) {
  // Sit 1 cm above the grassBG plane (Y=-1.55) to avoid z-fighting
  // while staying flush at the lawn surface.
  const patchY = -1.54;
  const PATCHES = [
    // [x, z, radius, materialIndex] — mix of big soft pools and
    // smaller accents distributed around the plaza perimeter.

    // East of plaza (x > 12.3)
    [ 18,  -8, 5.5, 0],
    [ 24,   6, 4.0, 1],
    [ 32, -12, 3.0, 2],
    [ 36,   4, 5.0, 1],
    [ 44, -18, 3.5, 0],
    [ 50,  10, 4.2, 2],

    // South of plaza (z > 13.1)
    [ -6,  20, 6.0, 1],
    [  8,  26, 4.5, 0],
    [ -20, 22, 3.5, 2],
    [ 22,  18, 4.0, 1],
    [ -30, 28, 3.0, 0],

    // North of plaza (z < -26.9)
    [-12, -34, 5.0, 2],
    [ 14, -40, 4.0, 0],
    [-28, -32, 3.2, 1],
    [  4, -48, 3.8, 2],

    // West of plaza (x < -32.7)
    [-44, -10, 5.5, 1],
    [-50,  12, 3.5, 0],
    [-58,  -4, 4.0, 2],
  ];
  for (const [x, z, r, mIdx] of PATCHES) {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(r, 8),
      gdGrassPatchMats[mIdx],
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, patchY, z);
    patch.receiveShadow = true;
    root.add(patch);
  }
}

// -----------------------------------------------------------------
//  Outer lawn pavement — a meandering paved path through the east
//  lawn. Smoothed through hand-picked control points (plan coords)
//  with CatmullRomCurve3, ribbonised by offsetting perpendicular to
//  the curve tangent, then extruded flat so it sits on the grass.
// -----------------------------------------------------------------
const OUTER_PAVE_WIDTH      = 1.8;          // metres
const OUTER_PAVE_HEIGHT     = 0.06;         // raise above grass
const OUTER_PAVE_BASE_Y     = -1.55;        // grassBG sits at Y=-1.55
const OUTER_PAVE_COLOR      = 0xeae1ca;     // light limestone / cream

const outerPaveMat = new THREE.MeshStandardMaterial({
  color: OUTER_PAVE_COLOR, roughness: 0.94, metalness: 0, flatShading: true,
});

function buildOuterPavementPath(controlPoints, width = OUTER_PAVE_WIDTH) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) return null;

  // Smooth interpolation through the control points. Catmull-Rom in
  // XZ — Y stays flat.
  const curve = new THREE.CatmullRomCurve3(
    controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false, "catmullrom", 0.5,
  );
  const N = controlPoints.length * 10;       // samples along the curve
  const samples = curve.getPoints(N);

  // Compute ribbon edges via perpendicular offset at each sample.
  const half = width / 2;
  const left = [];
  const right = [];
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    let tx, tz;
    if (i === 0) {
      const n = samples[1];
      tx = n.x - p.x; tz = n.z - p.z;
    } else if (i === samples.length - 1) {
      const prev = samples[i - 1];
      tx = p.x - prev.x; tz = p.z - prev.z;
    } else {
      const prev = samples[i - 1], next = samples[i + 1];
      tx = next.x - prev.x; tz = next.z - prev.z;
    }
    const tlen = Math.hypot(tx, tz) || 1;
    tx /= tlen; tz /= tlen;
    // Perpendicular (XZ plane).
    const nx = -tz, nz = tx;
    left.push([p.x + nx * half, p.z + nz * half]);
    right.push([p.x - nx * half, p.z - nz * half]);
  }

  // Stitch ribbon edges into one closed polygon (plan coords).
  const polyPlan = [];
  for (let i = 0; i < left.length; i++) polyPlan.push(left[i]);
  for (let i = right.length - 1; i >= 0; i--) polyPlan.push(right[i]);

  // Convert to world (post-offset) coords for the Shape.
  const shape = new THREE.Shape();
  const [sx, sz] = polyPlan[0];
  shape.moveTo(offsetX(sx), offsetZ(sz));
  for (let i = 1; i < polyPlan.length; i++) {
    const [x, z] = polyPlan[i];
    shape.lineTo(offsetX(x), offsetZ(z));
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: OUTER_PAVE_HEIGHT, bevelEnabled: false,
  });
  geo.rotateX(Math.PI / 2);
  // After rotation, top face sits at Y=0, bottom at Y=-depth. Lift so
  // bottom rests on the lawn (Y=OUTER_PAVE_BASE_Y) and top is just
  // proud of the grass.
  geo.translate(0, OUTER_PAVE_BASE_Y + OUTER_PAVE_HEIGHT, 0);

  const mesh = new THREE.Mesh(geo, outerPaveMat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

// Hand-picked control points (raw plan coords) for the wavy east-lawn
// pavement the user drew on the screenshot. Smoothed via Catmull-Rom.
const OUTER_PAVE_EAST_PATH = [
  [50.5, 34.0],   // south end (near the SE corner of the lawn)
  [49.5, 28.0],
  [51.5, 22.0],
  [53.0, 17.0],
  [50.5, 12.0],
  [51.5,  6.0],   // north end
];

function addOuterLawnPavement(root) {
  const path = buildOuterPavementPath(OUTER_PAVE_EAST_PATH);
  if (path) root.add(path);
}

// ====================================================================
//  EXTERIOR ARCHITECTURAL DETAILS
//  ------------------------------------------------------------------
//  Scene-level additions that enrich the outdoor environment:
//    1. Lamp posts along the plaza perimeter and main paths
//    2. South-entrance compound gate
//    3. Stone benches along the plaza
//    4. Flagpoles at major buildings (Ethiopian tricolor)
//    6. Hedge strips along the primary corridor
//    8. Flowering shrubs scattered on the outer lawn
//    9. Signage posts at the major waypoint intersections
//  (Planters and roof brackets are added per-room from inside
//   buildLowPolyDoors and the roof block.)
// ====================================================================

// --- Shared materials ---
const extPostMat = new THREE.MeshStandardMaterial({
  color: 0x3b2418, roughness: 0.85, metalness: 0, flatShading: true,
});
const extLampGlobeMat = new THREE.MeshStandardMaterial({
  color: 0xfff1c4, roughness: 0.30, metalness: 0,
  emissive: 0xffc870, emissiveIntensity: 1.6, flatShading: true,
});
const extStoneMat = new THREE.MeshStandardMaterial({
  color: 0xc8c0ad, roughness: 0.95, metalness: 0, flatShading: true,
});
const extHedgeMat = new THREE.MeshStandardMaterial({
  color: 0x3d6a30, roughness: 0.95, metalness: 0, flatShading: true,
});
const extShrubMats = [
  new THREE.MeshStandardMaterial({ color: 0xc94a3e, roughness: 0.85, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0xe0b440, roughness: 0.85, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0xd07e9a, roughness: 0.85, flatShading: true }),
];
const extFlagGreenMat = new THREE.MeshStandardMaterial({
  color: 0x148f3d, roughness: 0.88, flatShading: true, side: THREE.DoubleSide,
});
const extFlagYellowMat = new THREE.MeshStandardMaterial({
  color: 0xf0c00a, roughness: 0.88, flatShading: true, side: THREE.DoubleSide,
});
const extFlagRedMat = new THREE.MeshStandardMaterial({
  color: 0xc4172e, roughness: 0.88, flatShading: true, side: THREE.DoubleSide,
});
const extSignPostMat = new THREE.MeshStandardMaterial({
  color: 0x5a3a22, roughness: 0.90, flatShading: true,
});
const extSignBoardMat = new THREE.MeshStandardMaterial({
  color: 0xf3ece0, roughness: 0.85, flatShading: true, side: THREE.DoubleSide,
});
const extSignTextMat = new THREE.MeshStandardMaterial({
  color: 0x2a1c12, roughness: 0.85, flatShading: true, side: THREE.DoubleSide,
});

// --- Lamp posts ---
// `xy` is in raw plan coords. Lamp sits on the OUTER plaza top.
function _buildLampPost(xPlan, zPlan, baseY) {
  const grp = new THREE.Group();
  const cx = offsetX(xPlan);
  const cz = offsetZ(zPlan);
  // Base block
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.18, 0.22),
    extStoneMat,
  );
  base.position.set(cx, baseY + 0.09, cz);
  base.castShadow = true;
  base.receiveShadow = true;
  grp.add(base);
  // Post
  const POST_H = 2.4;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, POST_H, 8),
    extPostMat,
  );
  post.position.set(cx, baseY + 0.18 + POST_H / 2, cz);
  post.castShadow = true;
  grp.add(post);
  // Cap below globe
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.10, 8),
    extPostMat,
  );
  cap.position.set(cx, baseY + 0.18 + POST_H + 0.05, cz);
  grp.add(cap);
  // Glowing globe on top
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 10),
    extLampGlobeMat,
  );
  globe.position.set(cx, baseY + 0.18 + POST_H + 0.18, cz);
  grp.add(globe);
  return grp;
}

const LAMP_PLAZA_Y = PLATFORM_Y + PLATFORM_H;   // outer plaza top

function addExteriorLampPosts(root) {
  const positions = [
    // North edge of plaza (z ≈ -1.2)
    [ 5, -1.0], [15, -1.0], [25, -1.0], [35, -1.0], [45, -1.0],
    // South edge (skip the south entrance gap around x≈14-17)
    [ 5, 37.0], [25, 37.0], [35, 37.0], [45, 37.0],
    // East edge (x ≈ 47)
    [47.0,  8], [47.0, 16], [47.0, 24], [47.0, 32],
    // West edge (x ≈ 4)
    [ 4.0,  8], [ 4.0, 16], [ 4.0, 24], [ 4.0, 30],
  ];
  for (const [x, z] of positions) {
    root.add(_buildLampPost(x, z, LAMP_PLAZA_Y));
  }
}

// --- South-entrance compound gate ---
function addExteriorEntranceGate(root) {
  // Wp-main-entrance sits at (14.5, 33). Build the gate ~3 m south
  // of it at z ≈ 36 so visitors walk through it onto the plaza.
  const cxPlan = 14.5;
  const czPlan = 36.2;
  const cx = offsetX(cxPlan);
  const cz = offsetZ(czPlan);
  const baseY = LAMP_PLAZA_Y;
  // Two stone piers
  const PIER_W = 0.55;
  const PIER_H = 2.6;
  const PIER_SPACING = 3.4;
  for (const sgn of [-1, 1]) {
    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(PIER_W, PIER_H, PIER_W),
      extStoneMat,
    );
    pier.position.set(cx + sgn * (PIER_SPACING / 2), baseY + PIER_H / 2, cz);
    pier.castShadow = true;
    pier.receiveShadow = true;
    root.add(pier);
    // Cap on top of pier
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(PIER_W + 0.18, 0.14, PIER_W + 0.18),
      lpFoundationMat,
    );
    cap.position.set(cx + sgn * (PIER_SPACING / 2), baseY + PIER_H + 0.07, cz);
    cap.castShadow = true;
    root.add(cap);
  }
  // Crossbeam between piers
  const BEAM_W = PIER_SPACING + PIER_W + 0.20;
  const BEAM_H = 0.45;
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(BEAM_W, BEAM_H, 0.40),
    lpWallMat,
  );
  beam.position.set(cx, baseY + PIER_H + 0.14 + BEAM_H / 2, cz);
  beam.castShadow = true;
  root.add(beam);
  // Decorative dark trim band along the bottom of the beam
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(BEAM_W + 0.02, 0.07, 0.42),
    lpFoundationMat,
  );
  trim.position.set(cx, baseY + PIER_H + 0.14 - 0.035, cz);
  root.add(trim);
  // Small finial on top of the beam (orb)
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    lpOrnamentGold,
  );
  finial.position.set(cx, baseY + PIER_H + 0.14 + BEAM_H + 0.16, cz);
  finial.castShadow = true;
  root.add(finial);
}

// --- Stone benches along the plaza ---
function _buildStoneBench(xPlan, zPlan, yawRad, baseY) {
  const grp = new THREE.Group();
  const cx = offsetX(xPlan);
  const cz = offsetZ(zPlan);
  // Seat slab
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.10, 0.40),
    extStoneMat,
  );
  seat.position.set(cx, baseY + 0.42, cz);
  seat.rotation.y = yawRad;
  seat.castShadow = true;
  seat.receiveShadow = true;
  grp.add(seat);
  // Two stone supports
  for (const sgn of [-1, 1]) {
    const supX = cx + Math.cos(yawRad) * 0.55 * sgn;
    const supZ = cz - Math.sin(yawRad) * 0.55 * sgn;
    const support = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.36, 0.32),
      extStoneMat,
    );
    support.position.set(supX, baseY + 0.18, supZ);
    support.rotation.y = yawRad;
    support.castShadow = true;
    grp.add(support);
  }
  return grp;
}

function addExteriorBenches(root) {
  // Each entry: [x, z, yawRad]. Yaw rotates the bench's long axis.
  const benches = [
    // North side of plaza, facing south
    [10,  0.5,  0],
    [38,  0.5,  0],
    // East side, facing west
    [46,  15,    Math.PI / 2],
    [46,  28,    Math.PI / 2],
    // West side, facing east
    [ 5,  16,   -Math.PI / 2],
    // South side near main entrance, facing north
    [25, 36.5, Math.PI],
    [40, 36.5, Math.PI],
  ];
  for (const [x, z, yaw] of benches) {
    root.add(_buildStoneBench(x, z, yaw, LAMP_PLAZA_Y));
  }
}

// --- Flagpoles at major buildings ---
function _buildFlagpole(xPlan, zPlan, baseY) {
  const grp = new THREE.Group();
  const cx = offsetX(xPlan);
  const cz = offsetZ(zPlan);
  // Stone base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.20, 0.18, 10),
    extStoneMat,
  );
  base.position.set(cx, baseY + 0.09, cz);
  base.castShadow = true;
  grp.add(base);
  // Pole
  const POLE_H = 3.8;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, POLE_H, 8),
    extPostMat,
  );
  pole.position.set(cx, baseY + 0.18 + POLE_H / 2, cz);
  pole.castShadow = true;
  grp.add(pole);
  // Three horizontal flag bands (Ethiopian tricolor: green / yellow / red)
  const FLAG_W = 0.65;
  const BAND_H = 0.20;
  const flagYBase = baseY + 0.18 + POLE_H * 0.62;
  const bands = [
    { mat: extFlagGreenMat,  dy:  BAND_H * 1.0 },
    { mat: extFlagYellowMat, dy:  0 },
    { mat: extFlagRedMat,    dy: -BAND_H * 1.0 },
  ];
  for (const b of bands) {
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(FLAG_W, BAND_H),
      b.mat,
    );
    band.position.set(cx + FLAG_W / 2 + 0.04, flagYBase + b.dy, cz);
    grp.add(band);
  }
  return grp;
}

function addExteriorFlagpoles(root) {
  // Plant flagpoles outside the south face of the main buildings.
  // Coordinates are in raw plan space; the pole stands on the outer
  // plaza (LAMP_PLAZA_Y) just outside the inner-plaza podium.
  const poles = [
    // South of palace block — slightly east of religion-sw corner
    [10.0, 35.5],
    // South of central H-building (left side)
    [22.0, 35.5],
    // South of central H-building (right side)
    [30.0, 35.5],
    // South of the women's room building (east standalone)
    [42.0, 35.5],
  ];
  for (const [x, z] of poles) {
    root.add(_buildFlagpole(x, z, LAMP_PLAZA_Y));
  }
}

// --- Hedge strips along the south spine ---
// One hedge slab is a long thin box rendered along the (x,z) midline
// of the strip, oriented by `yaw`.
function _buildHedgeSlab(x1Plan, z1Plan, x2Plan, z2Plan, baseY) {
  const ax = offsetX(x1Plan), az = offsetZ(z1Plan);
  const bx = offsetX(x2Plan), bz = offsetZ(z2Plan);
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.4) return null;
  const yaw = Math.atan2(-dz, dx);
  const HEDGE_W = 0.45;
  const HEDGE_H = 0.55;
  const hedge = new THREE.Mesh(
    new THREE.BoxGeometry(len, HEDGE_H, HEDGE_W),
    extHedgeMat,
  );
  hedge.position.set((ax + bx) / 2, baseY + HEDGE_H / 2, (az + bz) / 2);
  hedge.rotation.y = yaw;
  hedge.castShadow = true;
  hedge.receiveShadow = true;
  return hedge;
}

function addExteriorHedges(root) {
  // Line the south spine (wp-main-entrance ↔ wp-spine-1 at z=33) with
  // hedges on the OUTER plaza, slightly south of the path so they
  // don't clip the staircases. Y matches outer plaza.
  const baseY = LAMP_PLAZA_Y;
  const hedges = [
    // South strip flanking the south corridor — one band running
    // along the path's south side.
    [ 7.0, 36.0, 13.0, 36.0],
    [21.0, 36.0, 32.0, 36.0],
    [33.5, 36.0, 45.0, 36.0],
    // North strip (just south of the religion-sw → main-entrance edge)
    [ 7.0, -1.2, 14.0, -1.2],
    [16.0, -1.2, 44.0, -1.2],
  ];
  for (const [x1, z1, x2, z2] of hedges) {
    const h = _buildHedgeSlab(x1, z1, x2, z2, baseY);
    if (h) root.add(h);
  }
}

// --- Flowering shrubs scattered on the outer lawn ---
function _buildFloweringShrub(worldX, worldZ, matIndex) {
  const grp = new THREE.Group();
  // Dark wooden stem
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.20, 6),
    extPostMat,
  );
  stem.position.set(worldX, OUTER_PAVE_BASE_Y + 0.10, worldZ);
  grp.add(stem);
  // Colourful low-poly bloom
  const bloom = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.32, 0),
    extShrubMats[matIndex % extShrubMats.length],
  );
  bloom.position.set(worldX, OUTER_PAVE_BASE_Y + 0.36, worldZ);
  bloom.rotation.y = Math.random() * Math.PI;
  bloom.castShadow = true;
  grp.add(bloom);
  return grp;
}

function addExteriorFloweringShrubs(root) {
  // Positions in WORLD coords (post planCenter offset) — scattered on
  // the outer lawn (outside SITE_PLAZA's world bounds of roughly
  // x:[-32.7..12.3] z:[-26.9..13.1]).
  const SHRUBS = [
    // East lawn
    [ 20, -10, 0], [ 26,  -2, 1], [ 30,   8, 2], [ 38, -14, 0],
    [ 42,   2, 1], [ 48,  -8, 2],
    // South lawn
    [-12,  18, 0], [  6,  22, 2], [-22,  19, 1], [ 16,  21, 0],
    // North lawn
    [-14, -30, 1], [ 10, -34, 2], [-26, -34, 0],
    // West lawn
    [-40,  -6, 2], [-46,  10, 0],
  ];
  for (const [x, z, mi] of SHRUBS) {
    root.add(_buildFloweringShrub(x, z, mi));
  }
}

// --- Signage posts at the major waypoint intersections ---
function _buildSignagePost(xPlan, zPlan, baseY, arrowAngles) {
  const grp = new THREE.Group();
  const cx = offsetX(xPlan);
  const cz = offsetZ(zPlan);
  // Wood post
  const POST_H = 1.6;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, POST_H, 8),
    extSignPostMat,
  );
  post.position.set(cx, baseY + POST_H / 2, cz);
  post.castShadow = true;
  grp.add(post);
  // Each arrow board: small flat plank pointing in `angle` direction.
  for (let i = 0; i < arrowAngles.length; i++) {
    const angle = arrowAngles[i];
    const PLANK_W = 0.60;
    const PLANK_H = 0.16;
    const planeY = baseY + POST_H - 0.10 - i * (PLANK_H + 0.06);
    const offX = Math.sin(angle) * (PLANK_W / 2 - 0.04);
    const offZ = Math.cos(angle) * (PLANK_W / 2 - 0.04);
    const plank = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANK_W, PLANK_H),
      extSignBoardMat,
    );
    plank.position.set(cx + offX, planeY, cz + offZ);
    plank.rotation.y = angle + Math.PI / 2;   // face perpendicular to "angle"
    grp.add(plank);
    // Dark "text" strip across the plank
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANK_W * 0.7, PLANK_H * 0.35),
      extSignTextMat,
    );
    strip.position.set(
      cx + offX + Math.sin(angle + Math.PI / 2) * 0.004,
      planeY,
      cz + offZ + Math.cos(angle + Math.PI / 2) * 0.004,
    );
    strip.rotation.y = angle + Math.PI / 2;
    grp.add(strip);
  }
  return grp;
}

function addExteriorSignage(root) {
  const baseY = PLATFORM_Y + PLATFORM_H + INNER_PLAZA_LIFT;   // on the podium
  // [xPlan, zPlan, [arrowDirsRad...]]
  const signs = [
    // Central hub — arrows roughly N (toward cluster) and S (entrance)
    [19.5, 19.5, [0,             Math.PI]],
    // Spine-1 south corner — arrow north (hub) and west (religion)
    [19.5, 33.0, [-Math.PI / 2,  0]],
    // Main entrance — arrow north (into compound) and east (spine-1)
    [14.5, 33.0, [0,             Math.PI / 2]],
  ];
  for (const [x, z, arrows] of signs) {
    root.add(_buildSignagePost(x, z, baseY, arrows));
  }
}

// --- Master entry: call from buildFloors ---
function addExteriorDetails(root) {
  try { addExteriorLampPosts(root); }       catch (e) { console.error("lamp posts:", e); }
  try { addExteriorEntranceGate(root); }    catch (e) { console.error("entrance gate:", e); }
  try { addExteriorBenches(root); }         catch (e) { console.error("benches:", e); }
  // Flagpoles disabled at user request. Re-enable by uncommenting:
  // try { addExteriorFlagpoles(root); }    catch (e) { console.error("flagpoles:", e); }
  try { addExteriorHedges(root); }          catch (e) { console.error("hedges:", e); }
  try { addExteriorFloweringShrubs(root); } catch (e) { console.error("shrubs:", e); }
  try { addExteriorSignage(root); }         catch (e) { console.error("signage:", e); }
}

// One window unit: glass pane + thin wooden frame.
function buildWindowPanel(x, y, z, rotY) {
  const win = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(LP_WINDOW_W, LP_WINDOW_H),
    lpWindowGlassMat,
  );
  glass.position.set(x, y, z);
  glass.rotation.y = rotY;
  win.add(glass);

  // Frame: 4 thin strips around the glass (top, bottom, left, right).
  const frameThick = 0.06;
  const make = (w, h, dx, dy) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      lpWindowFrameMat,
    );
    // Offset along the wall direction (perpendicular to rotY) and vertically.
    m.position.set(x + dx * Math.cos(rotY), y + dy, z - dx * Math.sin(rotY));
    m.rotation.y = rotY;
    return m;
  };
  // Top + bottom horizontals
  win.add(make(LP_WINDOW_W + frameThick * 2, frameThick, 0,  LP_WINDOW_H / 2 + frameThick / 2));
  win.add(make(LP_WINDOW_W + frameThick * 2, frameThick, 0, -LP_WINDOW_H / 2 - frameThick / 2));
  // Left + right verticals
  win.add(make(frameThick, LP_WINDOW_H,  LP_WINDOW_W / 2 + frameThick / 2, 0));
  win.add(make(frameThick, LP_WINDOW_H, -LP_WINDOW_W / 2 - frameThick / 2, 0));
  // Mullions (cross frame) for a nice low-poly window look.
  win.add(make(LP_WINDOW_W, frameThick * 0.7, 0, 0));
  win.add(make(frameThick * 0.7, LP_WINDOW_H, 0, 0));
  return win;
}

// Build a flat-shaded "hip" roof mesh from a closed polygon (local coords)
// + base Y + height. Each polygon edge → one triangle whose apex sits at
// the polygon centroid lifted by `height`.
function buildLowPolyRoof(polygonLocal, baseY, height) {
  if (polygonLocal.length < 3) return null;
  let cx = 0, cz = 0;
  for (const [lx, lz] of polygonLocal) { cx += lx; cz += lz; }
  cx /= polygonLocal.length;
  cz /= polygonLocal.length;
  const peakY = baseY + height;

  const positions = [];
  const uvs = [];
  // Per-vertex UV from world XZ via planar projection from above, so
  // the roof-tile texture tiles in metric world units regardless of
  // each polygon's shape or scale.
  const u = (x) => x / ROOF_TILE_SCALE;
  const v = (z) => z / ROOF_TILE_SCALE;
  for (let i = 0; i < polygonLocal.length; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
    // Triangle: peak → A → B
    positions.push(cx, peakY, cz);
    positions.push(ax, baseY, az);
    positions.push(bx, baseY, bz);
    uvs.push(u(cx), v(cz));
    uvs.push(u(ax), v(az));
    uvs.push(u(bx), v(bz));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, lpRoofMat);
}

// ---- Situm polygon helpers --------------------------------------------------

function polygonShape(polygon) {
  const shape = new THREE.Shape();
  for (let i = 0; i < polygon.length; i++) {
    const [px, py] = polygon[i];
    const lx = px - planCenter.x;
    const lz = py - planCenter.z;
    if (i === 0) shape.moveTo(lx, lz);
    else         shape.lineTo(lx, lz);
  }
  return shape;
}

// Reusable beige wall + dark cap materials for the Situm path.
const situmWallMat = new THREE.MeshStandardMaterial({
  color: SITUM_WALL_COLOR, roughness: 0.95, metalness: 0,
});
const situmCapMat = new THREE.MeshStandardMaterial({
  color: SITUM_CAP_COLOR, roughness: 0.75, metalness: 0,
});

function buildSitumWalls(group, polygon, height, thickness) {
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const lax = ax - planCenter.x, laz = ay - planCenter.z;
    const lbx = bx - planCenter.x, lbz = by - planCenter.z;
    const dx = lbx - lax, dz = lbz - laz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(thickness, height, len),
      situmWallMat,
    );
    wall.position.set(
      (lax + lbx) / 2,
      SITUM_BLOCK_LIFT + height / 2,
      (laz + lbz) / 2,
    );
    wall.rotation.y = Math.atan2(dx, dz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }
}

function buildSitumWallCaps(group, polygon, wallHeight, wallThickness) {
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const lax = ax - planCenter.x, laz = ay - planCenter.z;
    const lbx = bx - planCenter.x, lbz = by - planCenter.z;
    const dx = lbx - lax, dz = lbz - laz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness * SITUM_CAP_OVER, SITUM_CAP_HEIGHT, len),
      situmCapMat,
    );
    cap.position.set(
      (lax + lbx) / 2,
      SITUM_BLOCK_LIFT + wallHeight + SITUM_CAP_HEIGHT / 2,
      (laz + lbz) / 2,
    );
    cap.rotation.y = Math.atan2(dx, dz);
    cap.castShadow = true;
    group.add(cap);
  }
}

// Drop a category-specific prop inside the room, on top of the floor
// tile. Reuses the same prop helpers as the procedural CAM rooms.
function addSitumProp(group, room, cx, cz, y) {
  switch (room.category) {
    case "entrance":   addStairs(group, cx, cz, y, room); break;
    case "royal":      addPedestalWith(group, cx, cz, y, "bust"); break;
    case "history":    addPedestalWith(group, cx, cz, y, "cube"); break;
    case "religion":   addColumn(group, cx, cz, y, SITUM_WALL_HEIGHT * 0.85); break;
    case "kingdom":    addPedestalWith(group, cx, cz, y, "totem"); break;
    case "governance": addDais(group, cx, cz, y); break;
    case "economy":    addPedestalWith(group, cx, cz, y, "vase"); break;
    case "culture":    addPedestalWith(group, cx, cz, y, "knot"); break;
    case "ceremonial": addColumn(group, cx, cz, y, SITUM_WALL_HEIGHT * 0.85); break;
    case "womens":     addPedestalWith(group, cx, cz, y, "vase"); break;
    case "family":     addBench(group, cx, cz, y, 0); break;
    default: break;
  }
}

// =============================================================
//  Build one room (Group)
// =============================================================
function buildRoom(room, adj = { N: false, S: false, E: false, W: false }) {
  const group = new THREE.Group();
  const cat = CATEGORIES[room.category] || CATEGORIES.amenity;
  const baseColor = new THREE.Color(cat.color);
  const { x, z, w, d } = room.footprint;
  const cx = offsetX(x + w / 2);
  const cz = offsetZ(z + d / 2);

  // Elevators are not full rooms — they're embedded inside other rooms
  // (e.g. Elevator B is inside the courtyard). Don't generate a floor tile
  // or walls for them — those would overlap the host room's geometry and
  // produce doubled walls / z-fighting tiles. We render only the elevator
  // structure itself, and keep userData so picking + routing still works.
  if (room.icon) {
    addElevator(group, room, cx, cz, FLOOR_THICK);
    group.userData = {
      kind: "room",
      roomId: room.id,
      room,
      baseColor: baseColor.clone(),
      originalEmissive: new THREE.Color(0, 0, 0),
      tile: null,
      highlightTargets: [],
    };
    return group;
  }

  // -------- Floor tile --------
  const tileInset = 0.04;
  const tileW = Math.max(w - tileInset * 2, 0.3);
  const tileD = Math.max(d - tileInset * 2, 0.3);
  const tileMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.55,
    metalness: 0.08,
    emissive: baseColor.clone().multiplyScalar(0.08),
  });
  const tile = new THREE.Mesh(
    new THREE.BoxGeometry(tileW, FLOOR_THICK, tileD),
    tileMat
  );
  // Lift the tile a small epsilon above the slab top to prevent z-fighting:
  // slab top sits at world Y=0; without this offset the tile's bottom face
  // is coincident with the slab face and they shimmer through each other.
  tile.position.set(cx, FLOOR_THICK / 2 + 0.04, cz);
  tile.receiveShadow = true;
  group.add(tile);

  group.userData = {
    kind: "room",
    roomId: room.id,
    room,
    baseColor: baseColor.clone(),
    originalEmissive: baseColor.clone().multiplyScalar(0.08),
    tile,
    highlightTargets: [tile],
  };

  // -------- Exterior walls (on sides without a neighbor) --------
  const wantWalls = !room.open && !room.entrance;
  const wallH = room.tall ? WALL_HEIGHT + TALL_BOOST : WALL_HEIGHT;

  if (wantWalls) {
    // helper: add a wall segment + trim cap.
    //   The cap overhangs ONLY on the thickness axis (perpendicular to the
    //   wall's length) — for the cornice look — and is exactly the wall's
    //   length on the length axis. Otherwise two rooms whose walls meet
    //   along a shared boundary would have caps that overlap each other,
    //   producing a visibly doubled / thicker wall band.
    const addWall = (geo, posX, posY, posZ) => {
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(posX, posY, posZ);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      // Determine wall orientation: N/S walls run along X (width > depth),
      // E/W walls run along Z (depth > width). Overhang the THICKNESS axis.
      const isNS = geo.parameters.width >= geo.parameters.depth;
      const capW = isNS ? geo.parameters.width        : geo.parameters.width  * 1.06;
      const capD = isNS ? geo.parameters.depth * 1.06 : geo.parameters.depth;
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(capW, 0.06, capD),
        wallCapMat
      );
      cap.position.set(posX, posY + wallH / 2 + 0.03, posZ);
      cap.castShadow = true;
      group.add(cap);
    };
    const yMid = FLOOR_THICK + wallH / 2;
    // North wall (z = z), facing -z
    if (!adj.N) {
      addWall(
        new THREE.BoxGeometry(w, wallH, WALL_THICK),
        cx, yMid, offsetZ(z) - WALL_THICK / 2
      );
    }
    if (!adj.S) {
      addWall(
        new THREE.BoxGeometry(w, wallH, WALL_THICK),
        cx, yMid, offsetZ(z + d) + WALL_THICK / 2
      );
    }
    if (!adj.W) {
      addWall(
        new THREE.BoxGeometry(WALL_THICK, wallH, d),
        offsetX(x) - WALL_THICK / 2, yMid, cz
      );
    }
    if (!adj.E) {
      addWall(
        new THREE.BoxGeometry(WALL_THICK, wallH, d),
        offsetX(x + w) + WALL_THICK / 2, yMid, cz
      );
    }
  }

  // -------- Interior props --------
  addProps(group, room, cx, cz, adj);

  // -------- Floor label (room id) --------
  addRoomLabel(group, room, cx, cz);

  return group;
}

// =============================================================
//  Props
// =============================================================
function addProps(group, room, cx, cz, adj) {
  const y = FLOOR_THICK; // top of floor tile
  const cat = room.category;

  if (room.open || cat === "courtyard") {
    addTree(group, cx, cz, y);
    addBench(group, cx - 2.5, cz, y, 0);
    addBench(group, cx + 2.5, cz, y, 0);
    addPlanter(group, cx, cz - 2, y);
    addPlanter(group, cx, cz + 2, y);
    return;
  }
  if (room.entrance) {
    addStairs(group, cx, cz, y, room);
    return;
  }
  if (room.tall) {
    // Great Hall: 4 columns + central round dais
    const { w, d } = room.footprint;
    const off = Math.min(w, d) * 0.32;
    const colH = WALL_HEIGHT + TALL_BOOST;
    addColumn(group, cx - off, cz - off, y, colH);
    addColumn(group, cx + off, cz - off, y, colH);
    addColumn(group, cx - off, cz + off, y, colH);
    addColumn(group, cx + off, cz + off, y, colH);
    addDais(group, cx, cz, y);
    return;
  }
  if (room.icon) {
    addElevator(group, room, cx, cz, y);
    return;
  }

  switch (cat) {
    case "african":   addPedestalWith(group, cx, cz, y, "totem"); break;
    case "asian":     addPedestalWith(group, cx, cz, y, "vase");  break;
    case "ancient":   addPedestalWith(group, cx, cz, y, "bust");  break;
    case "modern":    addPedestalWith(group, cx, cz, y, "knot");  break;
    case "american":  addPaintings(group, room, adj); addBench(group, cx, cz, y, 0); break;
    case "european":  addPaintings(group, room, adj); addBench(group, cx, cz, y, 0); break;
    case "exhibition":addPedestalWith(group, cx, cz, y, "cube");  break;
    case "library":   addBookshelves(group, room); break;
    case "amenity":   addKiosk(group, cx, cz, y); break;
    default: break;
  }
}

// ---- props library ----
function addPedestalWith(group, cx, cz, y, kind) {
  const ped = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.9, 0.7),
    pedestalMat
  );
  ped.position.set(cx, y + 0.45, cz);
  ped.castShadow = true;
  ped.receiveShadow = true;
  group.add(ped);

  let obj;
  const topY = y + 0.9;
  if (kind === "totem") {
    obj = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 0.85, 8),
      new THREE.MeshStandardMaterial({ color: 0x5b3a25, roughness: 0.75 })
    );
    obj.position.set(cx, topY + 0.42, cz);
  } else if (kind === "vase") {
    obj = new THREE.Mesh(
      new THREE.LatheGeometry(
        [[0.0, 0], [0.18, 0.05], [0.22, 0.2], [0.16, 0.35], [0.08, 0.5]]
          .map(([r, h]) => new THREE.Vector2(r, h)),
        16
      ),
      new THREE.MeshStandardMaterial({ color: 0x7d8b66, roughness: 0.4, metalness: 0.2 })
    );
    obj.position.set(cx, topY, cz);
  } else if (kind === "bust") {
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12),
      stoneMat
    );
    head.position.set(cx, topY + 0.35, cz);
    head.castShadow = true;
    group.add(head);
    obj = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.28, 12),
      stoneMat
    );
    obj.position.set(cx, topY + 0.14, cz);
  } else if (kind === "knot") {
    obj = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.2, 0.06, 64, 8),
      new THREE.MeshStandardMaterial({ color: 0xe04a2b, roughness: 0.3, metalness: 0.5 })
    );
    obj.position.set(cx, topY + 0.28, cz);
  } else if (kind === "cube") {
    obj = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xa9b1bd, roughness: 0.6 })
    );
    obj.position.set(cx, topY + 0.18, cz);
  }
  if (obj) {
    obj.castShadow = true;
    group.add(obj);
  }
}

function addBench(group, cx, cz, y, rotY = 0) {
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.1, 0.4),
    benchMat
  );
  seat.position.set(cx, y + 0.45, cz);
  seat.rotation.y = rotY;
  seat.castShadow = true;
  group.add(seat);
  // legs
  for (const dx of [-0.65, 0.65]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.4, 0.36),
      benchMat
    );
    const ox = Math.cos(rotY) * dx;
    const oz = Math.sin(rotY) * dx;
    leg.position.set(cx + ox, y + 0.2, cz + oz);
    leg.rotation.y = rotY;
    leg.castShadow = true;
    group.add(leg);
  }
}

function addColumn(group, cx, cz, y, height) {
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.34, height, 16),
    stoneMat
  );
  col.position.set(cx, y + height / 2, cz);
  col.castShadow = true;
  col.receiveShadow = true;
  group.add(col);
  // capital
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.18, 0.9),
    wallCapMat
  );
  cap.position.set(cx, y + height - 0.09, cz);
  cap.castShadow = true;
  group.add(cap);
  // base
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.12, 0.8),
    wallCapMat
  );
  base.position.set(cx, y + 0.06, cz);
  group.add(base);
}

function addDais(group, cx, cz, y) {
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 0.12, 32),
    new THREE.MeshStandardMaterial({ color: 0xc7bda8, roughness: 0.8 })
  );
  dais.position.set(cx, y + 0.06, cz);
  dais.receiveShadow = true;
  group.add(dais);
}

function addStairs(group, cx, cz, y, room) {
  const w = room.footprint.w;
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.9, 0.12, 0.45),
      stoneMat
    );
    step.position.set(cx, y + 0.06 + i * 0.12, cz + (i - (steps - 1) / 2) * 0.45);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }
}

function addElevator(group, room, cx, cz, y) {
  const w = Math.max(room.footprint.w * 0.7, 1.6);
  const d = Math.max(room.footprint.d * 0.7, 1.6);
  const h = 2.6;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x4c5562, roughness: 0.6, metalness: 0.2 })
  );
  box.position.set(cx, y + h / 2, cz);
  box.castShadow = true;
  box.receiveShadow = true;
  group.add(box);
  // door panel
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.5, h * 0.7),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.4, metalness: 0.6 })
  );
  door.position.set(cx, y + h * 0.4, cz + d / 2 + 0.01);
  group.add(door);
  // letter label on top
  addTextSprite(group, room.icon || "?", cx, y + h + 0.4, cz, 0.9, 0xffffff);
}

function addPaintings(group, room, adj) {
  // Mount a row of small paintings on whichever exterior wall is longest
  const sides = [
    { name: "N", has: !adj.N, len: room.footprint.w, normal: [0, -1] },
    { name: "S", has: !adj.S, len: room.footprint.w, normal: [0,  1] },
    { name: "W", has: !adj.W, len: room.footprint.d, normal: [-1, 0] },
    { name: "E", has: !adj.E, len: room.footprint.d, normal: [ 1, 0] },
  ].filter((s) => s.has).sort((a, b) => b.len - a.len);

  if (sides.length === 0) return;
  const side = sides[0];
  const { x, z, w, d } = room.footprint;
  const cx = offsetX(x + w / 2);
  const cz = offsetZ(z + d / 2);
  const yMid = FLOOR_THICK + 1.1;

  // Lay 2 small paintings along this wall
  const count = Math.max(2, Math.min(3, Math.floor(side.len / 1.8)));
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count - 0.5; // -0.5..0.5
    const along = t * (side.len - 0.6);
    let px, pz, rot;
    if (side.name === "N") { px = cx + along; pz = offsetZ(z) + 0.02; rot = 0; }
    else if (side.name === "S") { px = cx + along; pz = offsetZ(z + d) - 0.02; rot = Math.PI; }
    else if (side.name === "W") { px = offsetX(x) + 0.02; pz = cz + along; rot = Math.PI / 2; }
    else { px = offsetX(x + w) - 0.02; pz = cz + along; rot = -Math.PI / 2; }

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.5),
      new THREE.MeshStandardMaterial({
        color: 0x000000, roughness: 0.7,
        emissive: 0x1a1a1a,
      })
    );
    frame.position.set(px, yMid, pz);
    frame.rotation.y = rot;
    group.add(frame);
    // gold frame trim
    const trim = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.58),
      new THREE.MeshStandardMaterial({ color: 0xa68a52, roughness: 0.4, metalness: 0.6 })
    );
    trim.position.set(px, yMid, pz);
    trim.rotation.y = rot;
    trim.position.x += Math.sin(rot) * -0.005;
    trim.position.z += Math.cos(rot) * -0.005;
    group.add(trim);
    frame.position.x += Math.sin(rot) * 0.005;
    frame.position.z += Math.cos(rot) * 0.005;
  }
}

function addBookshelves(group, room) {
  const { x, z, w, d } = room.footprint;
  const cx = offsetX(x + w / 2);
  const cz = offsetZ(z + d / 2);
  // ring of shelves around perimeter
  const shelfH = 1.4;
  const shelfThick = 0.3;
  const inset = 0.4;
  const long = new THREE.MeshStandardMaterial({ color: 0x5c3a22, roughness: 0.85 });
  // 4 shelves along the 4 walls
  const a = new THREE.Mesh(new THREE.BoxGeometry(w - inset * 2, shelfH, shelfThick), long);
  a.position.set(cx, FLOOR_THICK + shelfH / 2, offsetZ(z) + inset);
  a.castShadow = true; group.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(w - inset * 2, shelfH, shelfThick), long);
  b.position.set(cx, FLOOR_THICK + shelfH / 2, offsetZ(z + d) - inset);
  b.castShadow = true; group.add(b);
  const c = new THREE.Mesh(new THREE.BoxGeometry(shelfThick, shelfH, d - inset * 2), long);
  c.position.set(offsetX(x) + inset, FLOOR_THICK + shelfH / 2, cz);
  c.castShadow = true; group.add(c);
  const e = new THREE.Mesh(new THREE.BoxGeometry(shelfThick, shelfH, d - inset * 2), long);
  e.position.set(offsetX(x + w) - inset, FLOOR_THICK + shelfH / 2, cz);
  e.castShadow = true; group.add(e);
}

function addKiosk(group, cx, cz, y) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.1, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x2c333d, roughness: 0.6, metalness: 0.3 })
  );
  base.position.set(cx, y + 0.55, cz);
  base.castShadow = true;
  group.add(base);
  // screen
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.35),
    new THREE.MeshStandardMaterial({
      color: 0x67c8ff, emissive: 0x67c8ff, emissiveIntensity: 0.7, roughness: 0.2,
    })
  );
  screen.position.set(cx, y + 1.0, cz + 0.305);
  group.add(screen);
}

function addTree(group, cx, cz, y) {
  // trunk
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 1.2, 8),
    woodMat
  );
  trunk.position.set(cx, y + 0.6, cz);
  trunk.castShadow = true;
  group.add(trunk);
  // foliage (cluster of spheres)
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f8a4f, roughness: 0.8 });
  const positions = [
    [0, 1.4, 0, 0.9],
    [0.5, 1.6, 0.2, 0.6],
    [-0.45, 1.55, -0.15, 0.55],
    [0.1, 1.9, -0.3, 0.5],
  ];
  for (const [dx, dy, dz, r] of positions) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      leafMat
    );
    leaf.position.set(cx + dx, y + dy, cz + dz);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
  }
}

function addPlanter(group, cx, cz, y) {
  const planter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.4, 0.4, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a7560, roughness: 0.9 })
  );
  planter.position.set(cx, y + 0.2, cz);
  planter.castShadow = true;
  group.add(planter);
  const shrub = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x6aa367, roughness: 0.85 })
  );
  shrub.position.set(cx, y + 0.6, cz);
  shrub.castShadow = true;
  group.add(shrub);
}

// =============================================================
//  Pill-style labels — rounded badge with light bg + black text,
//  rendered as billboard sprites so they always face the camera.
// =============================================================
const labelCache = new Map();

// Local polyfill for ctx.roundRect (older Safari)
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function makeLabelTexture(text) {
  if (labelCache.has(text)) return labelCache.get(text);

  const fontSize = 56;
  const paddingX = 30;
  const paddingY = 14;
  const fontSpec = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  // Pre-measure on a throwaway context to size the pill
  const m = document.createElement("canvas").getContext("2d");
  m.font = fontSpec;
  const textWidth = Math.ceil(m.measureText(text).width);

  const canvas = document.createElement("canvas");
  // Min canvas height = ensure full pill curve even for 1-char labels
  canvas.height = fontSize + paddingY * 2;
  canvas.width  = Math.max(textWidth + paddingX * 2, canvas.height);
  const ctx = canvas.getContext("2d");
  const r = canvas.height / 2;

  // Soft drop shadow under the pill
  ctx.shadowColor   = "rgba(0,0,0,0.30)";
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "rgba(234, 234, 234, 0.97)";
  roundRectPath(ctx, 0, 0, canvas.width, canvas.height, r);
  ctx.fill();

  // Reset shadow before stroke + text
  ctx.shadowColor   = "transparent";
  ctx.shadowBlur    = 0;
  ctx.shadowOffsetY = 0;

  // Hairline edge for definition over bright floor tiles
  ctx.lineWidth   = 1.5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.10)";
  roundRectPath(ctx, 0.75, 0.75, canvas.width - 1.5, canvas.height - 1.5, r - 0.75);
  ctx.stroke();

  // Black text
  ctx.fillStyle    = "rgba(18, 18, 18, 0.94)";
  ctx.font         = fontSpec;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  labelCache.set(text, tex);
  return tex;
}

// In-world pill labels (rendered as billboards). Hidden by default —
// main.js shows them on mobile / touch devices where there's no hover
// mechanism for the cursor tooltip.
function addRoomLabel(group, room, cx, cz) {
  if (room.entrance || room.icon) return;
  const { w, d } = room.footprint;
  const min = Math.min(w, d);
  if (min < 1.8) return;
  const tex = makeLabelTexture(room.id);
  const aspect = tex.image.width / tex.image.height;
  const heightWorld = THREE.MathUtils.clamp(min * 0.13, 0.5, 0.78);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  sprite.scale.set(heightWorld * aspect, heightWorld, 1);
  sprite.position.set(cx, FLOOR_THICK + 1.6, cz);
  sprite.renderOrder = 1000;
  sprite.userData.isLabel = true;
  sprite.visible = false;       // toggled by main.js based on viewport
  group.add(sprite);
}

function addTextSprite(group, text, x, y, z, scale) {
  const tex = makeLabelTexture(text);
  const aspect = tex.image.width / tex.image.height;
  const heightWorld = scale * 0.62;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  sprite.scale.set(heightWorld * aspect, heightWorld, 1);
  sprite.position.set(x, y, z);
  sprite.renderOrder = 1000;
  sprite.userData.isLabel = true;
  sprite.visible = false;
  group.add(sprite);
}

// =============================================================
//  FBX swap hook (unchanged contract)
// =============================================================
export function tryReplaceWithFBX(loader, floorId, floorGroups, url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    loader.load(
      url,
      (object) => {
        const group = floorGroups.get(floorId);
        if (!group) return resolve(false);
        while (group.children.length) group.remove(group.children[0]);
        object.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        group.add(object);
        resolve(true);
      },
      undefined,
      (err) => {
        console.warn(`FBX load failed for floor ${floorId}:`, err);
        resolve(false);
      }
    );
  });
}

// ============================================================
//  BalconyDetails — wrap-around veranda on every external wall
//  ----------------------------------------------------------
//  Built per room on both floors. Reuses the existing wall + roof
//  geometry; this layer only adds the four veranda parts:
//    1. Balcony floor   — thin slab projecting out from the wall.
//    2. Support columns — dark cylinders standing on the balcony
//                         floor, drawn as a single InstancedMesh
//                         per room.
//    3. Shade canopy    — thin slab at the wall-top level, slightly
//                         wider than the floor for a small eave.
//    4. Fence rails     — top rail + bottom rail + balusters around
//                         the perimeter, connecting the columns.
//                         FLOOR 2 ONLY — the floor-1 balcony is
//                         intentionally open so doorways aren't
//                         enclosed.
//
//  Edges skipped:
//    · shorter than BALCONY_MIN_EDGE_LEN
//    · shared with another room in the same building (internal walls)
//    · the Wrestling open yard (room.open) skips the whole pass
//  Columns within BALCONY_DOOR_CLEARANCE of a door position are also
//  skipped so doorways stay clear.
//
//  Toggle:
//    SHOW_BALCONIES = false  to drop the whole layer.
// ============================================================
const SHOW_BALCONIES             = true;

const BALCONY_FLOOR_DEPTH        = 0.85;
const BALCONY_FLOOR_H            = 0.05;
const BALCONY_SHADE_DEPTH        = 0.95;
const BALCONY_SHADE_H            = 0.05;
const BALCONY_COLUMN_RADIUS      = 0.08;
const BALCONY_COLUMN_SPACING     = 1.50;
const BALCONY_DOOR_CLEARANCE     = 0.70;
const BALCONY_MIN_EDGE_LEN       = 1.50;
const BALCONY_RAIL_THICK         = 0.045;
const BALCONY_RAIL_TOP_OFFSET    = 0.58;   // metres above balcony floor
const BALCONY_RAIL_BOT_OFFSET    = 0.08;
const BALCONY_BALUSTER_GAP       = 0.30;

const balconyFloorMat = new THREE.MeshStandardMaterial({
  color: 0xc7b88f, roughness: 0.95, metalness: 0, flatShading: true,
});
const balconyShadeMat = new THREE.MeshStandardMaterial({
  color: 0xb59e76, roughness: 0.95, metalness: 0, flatShading: true,
});
const balconyColumnMat = new THREE.MeshStandardMaterial({
  color: 0x3d2210, roughness: 0.85, metalness: 0, flatShading: true,
});
const balconyFenceMat = new THREE.MeshStandardMaterial({
  color: 0x3d2210, roughness: 0.85, metalness: 0, flatShading: true,
});

function addBalconyDetails(group, room, polygonLocal, wallsBaseY, wallHeight,
                           sharedEdges, doorsForRoom = []) {
  if (!SHOW_BALCONIES) return;
  if (!Array.isArray(polygonLocal) || polygonLocal.length < 3) return;
  // Open yards have no walls to wrap a balcony around.
  if (room.open) return;

  const areaSign  = polygonSignedArea2D(polygonLocal) >= 0 ? 1 : -1;
  const isFloor1  = room.floor === 1;
  const wallTopY  = wallsBaseY + wallHeight;
  const colHeight = wallHeight - BALCONY_FLOOR_H - BALCONY_SHADE_H;
  const colCenterY = wallsBaseY + BALCONY_FLOOR_H + colHeight / 2;

  const doorPositions = (doorsForRoom || []).map(
    (d) => [offsetX(d.x), offsetZ(d.z)],
  );

  const columnPositions = [];
  const tmpMat = new THREE.Matrix4();

  for (let i = 0; i < polygonLocal.length; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
    const ex = bx - ax, ez = bz - az;
    const edgeLen = Math.hypot(ex, ez);
    if (edgeLen < BALCONY_MIN_EDGE_LEN) continue;
    // Suppress on shared internal walls (between rooms in the same building).
    if (sharedEdges && Array.isArray(room.polygon) &&
        sharedEdges.has(edgeKey(
          room.polygon[i],
          room.polygon[(i + 1) % room.polygon.length],
        ))) continue;

    const ux = ex / edgeLen, uz = ez / edgeLen;
    const nx = (ez / edgeLen) * areaSign;
    const nz = (-ex / edgeLen) * areaSign;
    // Box's long axis is +X; this yaw maps +X to (ux, uz).
    const boxYaw = Math.atan2(-uz, ux);

    // 1. Balcony floor — thin slab projecting BALCONY_FLOOR_DEPTH outward.
    const floorCx = ax + ex / 2 + nx * (BALCONY_FLOOR_DEPTH / 2);
    const floorCz = az + ez / 2 + nz * (BALCONY_FLOOR_DEPTH / 2);
    const flr = new THREE.Mesh(
      new THREE.BoxGeometry(edgeLen, BALCONY_FLOOR_H, BALCONY_FLOOR_DEPTH),
      balconyFloorMat,
    );
    flr.position.set(floorCx, wallsBaseY + BALCONY_FLOOR_H / 2, floorCz);
    flr.rotation.y = boxYaw;
    flr.castShadow = true;
    flr.receiveShadow = true;
    group.add(flr);

    // 3. Shade canopy at wall-top, slightly wider than the floor (eave).
    const shadeCx = ax + ex / 2 + nx * (BALCONY_SHADE_DEPTH / 2);
    const shadeCz = az + ez / 2 + nz * (BALCONY_SHADE_DEPTH / 2);
    const shade = new THREE.Mesh(
      new THREE.BoxGeometry(edgeLen, BALCONY_SHADE_H, BALCONY_SHADE_DEPTH),
      balconyShadeMat,
    );
    shade.position.set(shadeCx, wallTopY - BALCONY_SHADE_H / 2, shadeCz);
    shade.rotation.y = boxYaw;
    shade.castShadow = true;
    shade.receiveShadow = true;
    group.add(shade);

    // 2. Columns — distributed along the outer edge of the balcony.
    const colOutset = BALCONY_FLOOR_DEPTH - BALCONY_COLUMN_RADIUS - 0.05;
    const colCount  = Math.max(2, Math.round(edgeLen / BALCONY_COLUMN_SPACING) + 1);
    for (let j = 0; j < colCount; j++) {
      const t = j / (colCount - 1);
      const px = ax + ex * t + nx * colOutset;
      const pz = az + ez * t + nz * colOutset;
      // Skip if a doorway sits behind this column.
      let nearDoor = false;
      for (const [dx, dz] of doorPositions) {
        if (Math.hypot(dx - px, dz - pz) < BALCONY_DOOR_CLEARANCE) {
          nearDoor = true; break;
        }
      }
      if (nearDoor) continue;
      columnPositions.push([px, pz]);
    }

    // 4. Fence rails + balusters — FLOOR 2 ONLY so floor-1 doorways
    //    aren't enclosed.
    if (!isFloor1) {
      const railOutset = BALCONY_FLOOR_DEPTH - 0.05;
      const railCx = ax + ex / 2 + nx * railOutset;
      const railCz = az + ez / 2 + nz * railOutset;
      const topY = wallsBaseY + BALCONY_FLOOR_H + BALCONY_RAIL_TOP_OFFSET;
      const botY = wallsBaseY + BALCONY_FLOOR_H + BALCONY_RAIL_BOT_OFFSET;

      const topRail = new THREE.Mesh(
        new THREE.BoxGeometry(edgeLen, BALCONY_RAIL_THICK, BALCONY_RAIL_THICK),
        balconyFenceMat,
      );
      topRail.position.set(railCx, topY, railCz);
      topRail.rotation.y = boxYaw;
      topRail.castShadow = true;
      group.add(topRail);

      const botRail = new THREE.Mesh(
        new THREE.BoxGeometry(edgeLen, BALCONY_RAIL_THICK, BALCONY_RAIL_THICK),
        balconyFenceMat,
      );
      botRail.position.set(railCx, botY, railCz);
      botRail.rotation.y = boxYaw;
      botRail.castShadow = true;
      group.add(botRail);

      const baluCount = Math.max(2, Math.round(edgeLen / BALCONY_BALUSTER_GAP));
      const baluH = BALCONY_RAIL_TOP_OFFSET - BALCONY_RAIL_BOT_OFFSET;
      const baluY = (topY + botY) / 2;
      const baluThick = BALCONY_RAIL_THICK * 0.6;
      for (let j = 0; j <= baluCount; j++) {
        const t = j / baluCount;
        const bx2 = ax + ex * t + nx * railOutset;
        const bz2 = az + ez * t + nz * railOutset;
        const balu = new THREE.Mesh(
          new THREE.BoxGeometry(baluThick, baluH, baluThick),
          balconyFenceMat,
        );
        balu.position.set(bx2, baluY, bz2);
        balu.rotation.y = boxYaw;
        group.add(balu);
      }
    }
  }

  // Emit the room's columns as one InstancedMesh.
  if (columnPositions.length > 0) {
    const colGeo = new THREE.CylinderGeometry(
      BALCONY_COLUMN_RADIUS, BALCONY_COLUMN_RADIUS, colHeight, 8,
    );
    const inst = new THREE.InstancedMesh(
      colGeo, balconyColumnMat, columnPositions.length,
    );
    for (let k = 0; k < columnPositions.length; k++) {
      tmpMat.makeTranslation(columnPositions[k][0], colCenterY, columnPositions[k][1]);
      inst.setMatrixAt(k, tmpMat);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
}
