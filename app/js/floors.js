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
    grassBG.position.set(0, -0.01, 0);
    grassBG.receiveShadow = true;
    grassBG.userData.kind = "grass-bg";
    root.add(grassBG);
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
  for (const room of roomsHere) {
    const rg = buildSitumRoomBlock(room, sharedEdges, floor1WithFloor2);
    group.add(rg);
    roomGroups.push(rg);
  }

  // Outdoor walking network — ground floor only. Primary spine,
  // secondary connectors, and dashed recommended-return loop.
  if (floor.id === 1 && WAYPOINTS && WAYPOINTS.length) {
    const wpById = new Map(WAYPOINTS.map((w) => [w.id, w]));
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
}

const PATH_COLOR        = 0xc8b893;   // primary spine — warm flagstone
const PATH_COLOR_LIGHT  = 0xd9cba8;   // secondary connector — paler stone
const PATH_THICK        = 0.10;
const PATH_LIFT         = 0.12;
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
const SITUM_BLOCK_LIFT   = 0.05;  // sit just above the floor plane
const SITUM_TILE_HEIGHT  = 0.12;  // colored floor tile thickness
const SITUM_WALL_HEIGHT  = 1.85;  // beige perimeter walls
const SITUM_WALL_THICK   = 0.22;
const SITUM_CAP_HEIGHT   = 0.10;  // cornice/trim on top of walls
const SITUM_CAP_OVER     = 1.30;  // cap extends past wall thickness for visual cornice
const SITUM_WALL_COLOR   = 0xd6cdba;  // warm beige (matches CAM)
const SITUM_CAP_COLOR    = 0x8d8474;  // darker trim cap

const ROAD_SLAB_HEIGHT = 0.1;
const ROAD_SLAB_LIFT   = 0.06;

const DOOR_MARKER_COLOR = 0xf0a92b;   // warm gold — matches the brand accent
const DOOR_RADIUS       = 0.22;       // world units
const DOOR_LIFT         = 0.04;       // sit just above the floor texture

// Door visual — just a small gold pin on the floor at the door
// position. The wooden door panels were creating dark rectangles all
// over the walls, so they're disabled. The door is still a graph node
// in pathfinding via the DOORS export.
function buildDoorMarker(door) {
  const group = new THREE.Group();
  const cx = offsetX(door.x);
  const cz = offsetZ(door.z);
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(DOOR_RADIUS * 0.8, DOOR_RADIUS * 0.8, 0.03, 16),
    new THREE.MeshBasicMaterial({
      color: DOOR_MARKER_COLOR, transparent: true, opacity: 0.7, depthWrite: false,
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

const lpWallMat = new THREE.MeshStandardMaterial({
  color: LP_WALL_COLOR, roughness: 0.85, metalness: 0, flatShading: true,
});
const lpFoundationMat = new THREE.MeshStandardMaterial({
  color: LP_FOUNDATION_COL, roughness: 0.95, metalness: 0, flatShading: true,
});
const lpWallMatOpenTop = new THREE.MeshStandardMaterial({
  color: LP_WALL_COLOR, roughness: 0.85, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});
const lpRoofMat = new THREE.MeshStandardMaterial({
  color: LP_ROOF_COLOR, roughness: 0.70, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});
const terrainGrassMat = new THREE.MeshStandardMaterial({
  color: TERRAIN_GRASS, roughness: 1.0, metalness: 0, flatShading: true,
});
const terrainPlazaMat = new THREE.MeshStandardMaterial({
  color: TERRAIN_PLAZA, roughness: 0.95, metalness: 0, flatShading: true,
});

// Build a large grass plane + per-building paved platforms. Matches the
// reference site plan: each building sits on its own paved platform with
// grass landscape filling the spaces between (right-side landscape,
// around the banquet hall, perimeter, etc.). The path strips (rendered
// separately) act as the paved circulation joining the platforms.
const PLATFORM_PAD = 2.4;   // metres of paving around each building polygon
const PLATFORM_H   = 0.05;  // slight raise above grass
const PLATFORM_Y   = 0.02;  // base offset

function addOutdoorTerrain(group) {
  // Grass plane lives at scene level (added in buildFloors), so it
  // shows under every floor regardless of which one is filtered. Here
  // we only add the per-building paved platforms — floor-1 only.
  for (const room of ROOMS) {
    if (room.floor !== 1) continue;
    const platform = buildBuildingPlatform(room);
    if (platform) group.add(platform);
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
  color: LP_WINDOW_GLASS, roughness: 0.3, metalness: 0.4,
  emissive: 0x1a2632, emissiveIntensity: 0.25,
  flatShading: true, side: THREE.DoubleSide,
});
const lpWindowFrameMat = new THREE.MeshStandardMaterial({
  color: LP_WINDOW_FRAME, roughness: 0.8, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});
const lpDoorMat = new THREE.MeshStandardMaterial({
  color: LP_DOOR_COLOR, roughness: 0.85, metalness: 0,
  flatShading: true, side: THREE.DoubleSide,
});

function buildSitumRoomBlock(room, sharedEdges, floor1WithFloor2) {
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

  // Every room — ground and upper floor alike — uses short open-top
  // walls. The colored interior tile is visible from above on both
  // levels and no roofs are drawn, giving the model a clean stacked-
  // box look.
  const hasFloor2Above = true;
  const isStandaloneRoofed = false;

  // --- Foundation plinth (slight step at the base) ---
  const foundationPoly = offsetPolygonOutward(polygonLocal, LP_FOUNDATION_OUT);
  const foundation = buildExtrudedPolygon(foundationPoly, LP_FOUNDATION_H, lpFoundationMat);
  foundation.position.y = SITUM_BLOCK_LIFT + LP_FOUNDATION_H;
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  group.add(foundation);

  // --- Walls ---
  const wallsBaseY = SITUM_BLOCK_LIFT + LP_FOUNDATION_H;
  const wallHeight = isStandaloneRoofed ? LP_WALL_HEIGHT_T : LP_WALL_HEIGHT_S;
  let walls, tile = null, roof = null;
  if (hasFloor2Above) {
    // Open-top extrusion — side faces only, no top cap.
    walls = buildOpenTopExtrusion(polygonLocal, wallsBaseY, wallHeight, lpWallMatOpenTop);
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Colored floor tile + ornament visible from above through the open top.
    tile = buildExtrudedPolygon(polygonLocal, 0.04, new THREE.MeshStandardMaterial({
      color: baseColor, roughness: 0.85, metalness: 0, flatShading: true,
    }));
    tile.position.y = wallsBaseY + 0.04;
    tile.receiveShadow = true;
    group.add(tile);

    let cxL = 0, czL = 0;
    for (const [lx, lz] of polygonLocal) { cxL += lx; czL += lz; }
    cxL /= polygonLocal.length;
    czL /= polygonLocal.length;
    const ornament = buildRoomOrnament(room, cxL, czL, wallsBaseY + 0.08);
    if (ornament) group.add(ornament);
  } else {
    // Tall closed walls — ExtrudeGeometry (has top cap).
    walls = buildExtrudedPolygon(polygonLocal, wallHeight, lpWallMat);
    walls.position.y = wallsBaseY + wallHeight;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Hip roof on top — floor-2 rooms each get their own roof.
    if (isStandaloneRoofed) {
      const roofPoly = LP_ROOF_OVERHANG > 0
        ? offsetPolygonOutward(polygonLocal, LP_ROOF_OVERHANG)
        : polygonLocal;
      roof = buildLowPolyRoof(roofPoly, wallsBaseY + wallHeight, LP_ROOF_RISE);
      if (roof) {
        roof.castShadow = true;
        group.add(roof);
      }
    }
  }

  // --- Silhouette outline on the walls ---
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(walls.geometry, 1),
    new THREE.LineBasicMaterial({ color: LP_TRIM_COLOR, transparent: true, opacity: 0.55 }),
  );
  edges.position.copy(walls.position);
  group.add(edges);

  group.userData = {
    kind: "room",
    roomId: room.id,
    room,
    baseColor: baseColor.clone(),
    originalEmissive: new THREE.Color(0, 0, 0),
    tile: tile || walls,
    highlightTargets: roof ? [walls, roof] : (tile ? [tile, walls] : [walls]),
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

// Place a row of windows along every external wall edge. Windows face
// outward (computed from the polygon centroid → edge midpoint). Edges
// shared with another room's polygon (internal walls inside a single
// building) are skipped.
function buildLowPolyWindows(group, room, polygonLocal, wallsBaseY, wallHeight, sharedEdges) {
  if (!Array.isArray(room.polygon)) return;
  const windowY = wallsBaseY + wallHeight * 0.58;

  let cx = 0, cz = 0;
  for (const [lx, lz] of polygonLocal) { cx += lx; cz += lz; }
  cx /= polygonLocal.length;
  cz /= polygonLocal.length;

  for (let i = 0; i < polygonLocal.length; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
    const ex = bx - ax, ez = bz - az;
    const edgeLen = Math.hypot(ex, ez);
    if (edgeLen < LP_EDGE_MIN_FOR_WINDOWS) continue;
    // Skip internal walls (shared with another room's polygon).
    if (sharedEdges && sharedEdges.has(edgeKey(room.polygon[i], room.polygon[(i + 1) % room.polygon.length]))) continue;

    const midX = (ax + bx) / 2, midZ = (az + bz) / 2;
    const outDx = midX - cx, outDz = midZ - cz;
    const outDist = Math.hypot(outDx, outDz);
    if (outDist < 0.01) continue;
    const nx = outDx / outDist;
    const nz = outDz / outDist;
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
      group.add(buildWindowPanel(wx, windowY, wz, wallAngle));
    }
  }
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
  for (let i = 0; i < polygonLocal.length; i++) {
    const [ax, az] = polygonLocal[i];
    const [bx, bz] = polygonLocal[(i + 1) % polygonLocal.length];
    // Triangle: peak → A → B
    positions.push(cx, peakY, cz);
    positions.push(ax, baseY, az);
    positions.push(bx, baseY, bz);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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
