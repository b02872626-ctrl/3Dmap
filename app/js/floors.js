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
import { CATEGORIES, FLOORS, ROOMS, PLAN_BOUNDS, ROADS, BUILDING_STYLE } from "./data.js";

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

  for (const floor of FLOORS) {
    const group = new THREE.Group();
    group.name = `floor-${floor.id}`;
    group.userData = { floorId: floor.id, baseY: floor.y };
    group.position.y = floor.y;

    // -----------------------------------------------------------------
    //  Situm-style branch: SVG texture as the floor + extruded room
    //  blocks. Skips the procedural slab / tiles / walls completely.
    // -----------------------------------------------------------------
    if (isSitum && floor.mapTexture) {
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
  // Floor plane sized to the full SVG viewBox (PLAN_BOUNDS).
  const planW = PLAN_BOUNDS.maxX - PLAN_BOUNDS.minX;
  const planD = PLAN_BOUNDS.maxZ - PLAN_BOUNDS.minZ;

  // Create a placeholder texture; we'll fill it in once the SVG is
  // fetched, rasterised to a canvas with a white background, and
  // copied onto the texture. Rendering an SVG through <img> directly
  // can run into alpha / sizing issues — canvas gives us a clean
  // fully-opaque bitmap regardless of how the SVG declares its size.
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  loadSvgAsCanvasTexture(floor.mapTexture, tex);

  const floorMat = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  });
  const floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(planW, planD),
    floorMat,
  );
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.set(0, 0, 0);
  floorPlane.receiveShadow = true;
  group.add(floorPlane);

  // Render each room on this floor as an extruded block sitting above
  // the floor texture. Solid 3D blocks — no walls, tile, props.
  const roomsHere = ROOMS.filter((r) => r.floor === floor.id);
  for (const room of roomsHere) {
    const rg = buildSitumRoomBlock(room);
    group.add(rg);
    roomGroups.push(rg);
  }
}

const SITUM_BLOCK_HEIGHT = 1.6;   // height of each room's 3D block
const SITUM_BLOCK_LIFT   = 0.05;  // sit just above the floor plane

function buildSitumRoomBlock(room) {
  const group = new THREE.Group();
  const cat = CATEGORIES[room.category] || CATEGORIES.amenity;
  const baseColor = new THREE.Color(cat.color);
  const { x, z, w, d } = room.footprint;
  const cx = offsetX(x + w / 2);
  const cz = offsetZ(z + d / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.55,
    metalness: 0.08,
    emissive: baseColor.clone().multiplyScalar(0.08),
  });

  let block;
  if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
    // Build a THREE.Shape from the SVG polygon vertices, then extrude.
    // SVG points are in WORLD coords (X, Y_svg) — Y_svg maps to world Z.
    // ExtrudeGeometry extrudes in +Z of the shape's local frame, so we
    // build the shape in XY, then rotate it -π/2 around X so it lies
    // flat with extrusion going up (+Y world).
    const shape = new THREE.Shape();
    for (let i = 0; i < room.polygon.length; i++) {
      const [px, py] = room.polygon[i];
      // Convert world coords → plan-centered local coords
      const lx = px - planCenter.x;
      const lz = py - planCenter.z;
      if (i === 0) shape.moveTo(lx, lz);
      else         shape.lineTo(lx, lz);
    }
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: SITUM_BLOCK_HEIGHT,
      bevelEnabled: false,
    });
    // Shape was authored in XZ (treating shape's Y as world Z). Rotate
    // -π/2 around X so the extrusion axis becomes +Y (up).
    geo.rotateX(-Math.PI / 2);
    block = new THREE.Mesh(geo, mat);
    block.position.y = SITUM_BLOCK_LIFT + SITUM_BLOCK_HEIGHT;
  } else {
    // Fallback: axis-aligned box if no polygon attached
    const inset = 0.06;
    const blockW = Math.max(w - inset * 2, 0.3);
    const blockD = Math.max(d - inset * 2, 0.3);
    block = new THREE.Mesh(
      new THREE.BoxGeometry(blockW, SITUM_BLOCK_HEIGHT, blockD),
      mat,
    );
    block.position.set(cx, SITUM_BLOCK_HEIGHT / 2 + SITUM_BLOCK_LIFT, cz);
  }
  block.castShadow = true;
  block.receiveShadow = true;
  group.add(block);

  // Subtle dark outline tracing the block's silhouette
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(block.geometry, 1),
    new THREE.LineBasicMaterial({
      color: 0x2a241e,
      transparent: true,
      opacity: 0.45,
    }),
  );
  edges.position.copy(block.position);
  group.add(edges);

  group.userData = {
    kind: "room",
    roomId: room.id,
    room,
    baseColor: baseColor.clone(),
    originalEmissive: baseColor.clone().multiplyScalar(0.08),
    tile: block,
    highlightTargets: [block],
  };
  return group;
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
