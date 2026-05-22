// =============================================================
//  Bootstrap + UI wiring for the CAM 3D Visitor Guide
// =============================================================
import * as THREE from "three";
import { createScene, ISO_DIR, ISO_DISTANCE, FRUSTUM_SIZE } from "./scene.js";
import { buildFloors, tryReplaceWithFBX } from "./floors.js";
import { CATEGORIES, FLOORS, ROOMS, PLAN_BOUNDS, BUILDINGS, ACTIVE_BUILDING } from "./data.js";

// Plan-center offset used to map footprint coordinates into the
// floor-group's local (centered-on-building) coordinate system.
const PLAN_CENTER = {
  x: (PLAN_BOUNDS.minX + PLAN_BOUNDS.maxX) / 2,
  z: (PLAN_BOUNDS.minZ + PLAN_BOUNDS.maxZ) / 2,
};
import { buildGraph, findPath, describePath } from "./pathfinding.js";
import { createRouteLayer } from "./route.js";

const canvas = document.getElementById("stage");
const { renderer, scene, camera, controls, start, fbxLoader } = createScene(canvas);

// ---------------- Build floors ----------------
const { root, floorGroups, roomGroups, occluders } = buildFloors();
scene.add(root);

// Try FBX swaps (silent if not present)
for (const floor of FLOORS) {
  tryReplaceWithFBX(fbxLoader, floor.id, floorGroups, floor.fbx);
}

// Flatten meshes for raycasting + roomId lookup
const pickables = [];
const groupByRoomId = new Map();
for (const rg of roomGroups) {
  groupByRoomId.set(rg.userData.roomId, rg);
  rg.traverse((c) => { if (c.isMesh) pickables.push(c); });
}

// ---------------- Navigation graph + route layer ----------------
const graph = buildGraph();
const routeLayer = createRouteLayer(scene, floorGroups);

// ---------------- Floor visibility / explode ----------------
const FLOOR_GAP = 7;     // base stack
const EXPLODE_GAP = 13;  // exploded stack

let activeFloor = 1; // default view: ground floor
let exploded = false;

function applyFloorLayout() {
  const gap = exploded ? EXPLODE_GAP : FLOOR_GAP;
  let y = 0;
  for (const floor of FLOORS) {
    const group = floorGroups.get(floor.id);
    const shown = activeFloor === "all" || activeFloor === floor.id;
    group.visible = shown;
    group.userData.targetY = y;
    y += gap;
  }
  reframeCamera();
}

function reframeCamera() {
  const visible = FLOORS.filter((f) => activeFloor === "all" || activeFloor === f.id);
  if (visible.length === 0) return;
  const minY = Math.min(...visible.map((f) => floorGroups.get(f.id).userData.targetY));
  const maxY = Math.max(...visible.map((f) => floorGroups.get(f.id).userData.targetY));
  const centerY = (minY + maxY) / 2 + 2.5;
  cameraLerp = { target: new THREE.Vector3(controls.target.x, centerY, controls.target.z), t: 0 };
}

let cameraLerp = null;
function updateCameraLerp() {
  if (!cameraLerp) return;
  controls.target.lerp(cameraLerp.target, 0.15);
  // Camera must follow target to keep the iso lock
  camera.position.copy(controls.target).add(_viewOffset);
  cameraLerp.t = Math.min(1, cameraLerp.t + 0.06);
  if (cameraLerp.t >= 1) cameraLerp = null;
}

function animateFloorY() {
  for (const floor of FLOORS) {
    const group = floorGroups.get(floor.id);
    const target = group.userData.targetY ?? floor.y;
    group.position.y += (target - group.position.y) * 0.15;
  }
}

// ---------------- Picking (hover + click) ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
let selected = null;

function setPointerFromEvent(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function getRoomGroup(obj) {
  let n = obj;
  while (n) {
    if (n.userData?.kind === "room") return n;
    n = n.parent;
  }
  return null;
}

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  for (const hit of hits) {
    const rg = getRoomGroup(hit.object);
    if (rg && isGroupVisible(rg)) return rg;
  }
  return null;
}

function isGroupVisible(g) {
  let n = g;
  while (n) { if (n.visible === false) return false; n = n.parent; }
  return true;
}

function setHover(group) {
  if (hovered === group) return;
  if (hovered && hovered !== selected) restoreGroup(hovered);
  hovered = group;
  if (group && group !== selected) emphasizeGroup(group, 0.22);

  const tip = document.getElementById("tooltip");
  if (group) {
    const base = group.userData.room.name;
    if (directionsMode) {
      const slot = pickingSlot === "start" ? "as start" :
                   pickingSlot === "end"   ? "as destination" : "to replace destination";
      tip.textContent = `${base} · click ${slot}`;
    } else {
      tip.textContent = base;
    }
    tip.classList.add("visible");
  } else {
    tip.classList.remove("visible");
  }
  document.body.style.cursor = group ? "pointer" : "default";
}

function emphasizeGroup(group, amount) {
  const c = group.userData.baseColor.clone();
  for (const mesh of group.userData.highlightTargets) {
    mesh.material.emissive.copy(c.clone().multiplyScalar(0.18 + amount));
  }
}

function restoreGroup(group) {
  for (const mesh of group.userData.highlightTargets) {
    mesh.material.emissive.copy(group.userData.originalEmissive);
  }
}

function select(group) {
  if (selected && selected !== group) restoreGroup(selected);
  selected = group;
  if (group) {
    emphasizeGroup(group, 0.5);
    showDetails(group.userData.room);
    flyToRoom(group);
  } else {
    hideDetails();
  }
}

canvas.addEventListener("pointermove", (e) => {
  setPointerFromEvent(e);
  const tip = document.getElementById("tooltip");
  tip.style.left = e.clientX + "px";
  tip.style.top  = e.clientY + "px";
  setHover(pick());
});

// Click detection: only fire selection on pointerup AND only if the pointer
// hasn't moved more than a few pixels. Anything beyond that is a drag
// (orbit/pan/zoom) and should NOT trigger a room selection or directions
// slot assignment.
const CLICK_DRAG_THRESHOLD = 14; // pixels — generous enough for natural hand jitter
let pointerDownInfo = null;

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  pointerDownInfo = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  if (!pointerDownInfo) return;
  const dx = e.clientX - pointerDownInfo.x;
  const dy = e.clientY - pointerDownInfo.y;
  pointerDownInfo = null;
  if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) return; // was a drag

  setPointerFromEvent(e);
  const g = pick();
  if (!g) return;
  if (directionsMode) {
    assignDirectionsSlot(g.userData.room);
  } else {
    select(g);
  }
});

canvas.addEventListener("pointercancel", () => { pointerDownInfo = null; });
canvas.addEventListener("pointerleave", () => { pointerDownInfo = null; });

// ---------------- Details panel ----------------
const detailsEl = document.getElementById("details");
const detailsTitle = document.getElementById("details-title");
const detailsSub = document.getElementById("details-sub");
const detailsChip = document.getElementById("details-chip");
const detailsMeta = document.getElementById("details-meta");
document.getElementById("details-close").addEventListener("click", () => {
  if (selected) restoreGroup(selected);
  selected = null;
  hideDetails();
});

// "Get Directions" CTA inside details panel — opens directions with current
// room pre-filled as destination, then prompts the user to pick a start.
document.getElementById("details-directions").addEventListener("click", () => {
  if (!selected) return;
  const destRoom = selected.userData.room;
  openDirections({ destination: destRoom });
});

function showDetails(room) {
  const cat = CATEGORIES[room.category] || CATEGORIES.amenity;
  detailsTitle.textContent = room.name;
  detailsSub.textContent = `Room ${room.id} · Floor ${room.floor}`;
  detailsChip.textContent = cat.label;
  detailsChip.style.background = "#" + cat.color.toString(16).padStart(6, "0");
  detailsChip.style.color = "#fff";

  detailsMeta.innerHTML = "";
  const meta = [
    ["Floor", `${room.floor}`],
    ["Category", cat.label],
    ["Footprint", `${room.footprint.w} × ${room.footprint.d} m`],
  ];
  if (room.feature)  meta.push(["Type", "Special Feature Space"]);
  if (room.entrance) meta.push(["Type", "Public Entrance"]);
  if (room.open)     meta.push(["Type", "Open Courtyard"]);
  if (room.icon)     meta.push(["Marker", room.icon]);

  for (const [k, v] of meta) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    detailsMeta.append(dt, dd);
  }
  detailsEl.classList.add("visible");
}
function hideDetails() { detailsEl.classList.remove("visible"); }

// ---------------- Camera fly-to ----------------
// Single eased animation that moves BOTH camera position and OrbitControls
// target in lockstep, so the focus lands precisely on the clicked room.
let flyAnim = null;

// Camera-direction lock. Camera always sits at target + viewDir*dist;
// flyTo lerps the look-at TARGET and camera.zoom while viewDir stays
// constant, so the angle never changes mid-fly. The user can toggle
// between iso and pure top-down — viewDir AND camera.up morph together
// over ~0.8 s so the plan ends up axis-aligned (north straight up) in
// top view instead of stuck on a 45° tilt from a near-degenerate
// lookAt.
const TOP_DIR = new THREE.Vector3(0, 1, 0);
const ISO_UP  = new THREE.Vector3(0, 1, 0);
const TOP_UP  = new THREE.Vector3(0, 0, -1);   // screen "up" = -Z (north)
const viewDir = ISO_DIR.clone();
const _viewOffset = new THREE.Vector3();
function syncViewOffset() {
  _viewOffset.copy(viewDir).multiplyScalar(ISO_DISTANCE);
  return _viewOffset;
}
syncViewOffset();

let viewMode = "iso";   // "iso" | "top"
let viewMorph = null;

function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;
  const targetDir = mode === "top" ? TOP_DIR : ISO_DIR;
  const targetUp  = mode === "top" ? TOP_UP  : ISO_UP;
  viewMorph = {
    fromDir: viewDir.clone(),
    toDir:   targetDir.clone(),
    fromUp:  camera.up.clone(),
    toUp:    targetUp.clone(),
    t: 0, dur: 55,
  };
}

function updateViewMorph() {
  if (!viewMorph) return;
  viewMorph.t++;
  const k = Math.min(1, viewMorph.t / viewMorph.dur);
  const ease = 0.5 - 0.5 * Math.cos(k * Math.PI);
  viewDir.copy(viewMorph.fromDir).lerp(viewMorph.toDir, ease).normalize();
  camera.up.copy(viewMorph.fromUp).lerp(viewMorph.toUp, ease).normalize();
  syncViewOffset();
  camera.position.copy(controls.target).add(_viewOffset);
  // Re-orient: lookAt rebuilds the camera matrix using the new up.
  camera.lookAt(controls.target);
  if (k >= 1) viewMorph = null;
}

function flyToRoom(group) {
  const room = group.userData.room;
  const fp = room.footprint;
  const localX = (fp.x + fp.w / 2) - PLAN_CENTER.x;
  const localZ = (fp.z + fp.d / 2) - PLAN_CENTER.z;
  const floorGroup = group.parent;
  const floorY = floorGroup ? floorGroup.position.y : 0;
  const target = new THREE.Vector3(localX, floorY + 1.6, localZ);

  // Zoom so the room fills a comfortable portion of the visible frustum —
  // smaller rooms get more zoom, large halls less. Min is generous so
  // clicking a big hall keeps the other floors visible (zoom stays under
  // the x-ray threshold). Small / medium rooms zoom past the threshold
  // and the upper floors snap out for clarity.
  const span = Math.max(fp.w, fp.d);
  let zoom = THREE.MathUtils.clamp(FRUSTUM_SIZE / (span * 3.2), 1.4, 3.2);

  // Dolly in further if we're effectively already at this room
  if (
    controls.target.distanceTo(target) < 1.5 &&
    Math.abs(camera.zoom - zoom) < 0.15
  ) {
    zoom = Math.min(controls.maxZoom, zoom * 1.35);
  }
  flyTo(target, zoom, 55);
}

let _origDamping = null;
function flyTo(targetPoint, zoomLevel, dur = 55) {
  if (!flyAnim) _origDamping = controls.enableDamping;
  controls.enableDamping = false;
  flyAnim = {
    tgtFrom:  controls.target.clone(),
    tgtTo:    targetPoint.clone(),
    zoomFrom: camera.zoom,
    zoomTo:   zoomLevel,
    t: 0, dur,
  };
  cameraLerp = null;
}

function updateFly() {
  if (!flyAnim) return;
  flyAnim.t++;
  const k = Math.min(1, flyAnim.t / flyAnim.dur);
  const ease = 0.5 - 0.5 * Math.cos(k * Math.PI);   // cosine ease in/out
  controls.target.lerpVectors(flyAnim.tgtFrom, flyAnim.tgtTo, ease);
  // Camera position is FIXED relative to target — iso direction, iso distance
  camera.position.copy(controls.target).add(_viewOffset);
  camera.zoom = THREE.MathUtils.lerp(flyAnim.zoomFrom, flyAnim.zoomTo, ease);
  camera.updateProjectionMatrix();
  if (k >= 1) {
    flyAnim = null;
    if (_origDamping !== null) {
      controls.enableDamping = _origDamping;
      _origDamping = null;
    }
  }
}

// ---------------- Floor switcher buttons ----------------
document.querySelectorAll(".floor-switcher [data-floor]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".floor-switcher [data-floor]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const val = btn.dataset.floor;
    activeFloor = val === "all" ? "all" : parseInt(val, 10);
    // Sync the mobile floor buttons too
    document.querySelectorAll("[data-mobile-floor]").forEach((b) =>
      b.classList.toggle("active", b.dataset.mobileFloor === val),
    );
    applyFloorLayout();
    frameInitialView(true);
  });
});

document.getElementById("toggle-explode").addEventListener("click", (e) => {
  exploded = !exploded;
  e.currentTarget.classList.toggle("active", exploded);
  applyFloorLayout();
});

document.getElementById("reset-cam").addEventListener("click", () => {
  flyTo(new THREE.Vector3(0, 4, 0), 1.0, 60);
});

// ---------------- Legend / category filter ----------------
const legendList = document.getElementById("legend-list");
const activeCategories = new Set(Object.keys(CATEGORIES));

for (const [key, cat] of Object.entries(CATEGORIES)) {
  const li = document.createElement("li");
  li.dataset.cat = key;
  li.innerHTML = `
    <span class="swatch" style="background:#${cat.color.toString(16).padStart(6, "0")}"></span>
    <span>${cat.label}</span>
  `;
  li.addEventListener("click", () => {
    if (activeCategories.has(key)) {
      activeCategories.delete(key);
      li.classList.add("muted");
    } else {
      activeCategories.add(key);
      li.classList.remove("muted");
    }
    applyCategoryFilter();
  });
  legendList.appendChild(li);
}

function applyCategoryFilter() {
  for (const rg of roomGroups) {
    rg.visible = activeCategories.has(rg.userData.room.category);
  }
}

// ---------------- Search ----------------
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchResults.classList.remove("open");
    searchResults.innerHTML = "";
    return;
  }
  const matches = ROOMS.filter((r) =>
    r.name.toLowerCase().includes(q) ||
    r.id.toLowerCase().includes(q) ||
    (CATEGORIES[r.category]?.label.toLowerCase().includes(q))
  ).slice(0, 8);

  searchResults.innerHTML = "";
  if (!matches.length) {
    searchResults.classList.remove("open");
    return;
  }
  for (const room of matches) {
    const cat = CATEGORIES[room.category] || CATEGORIES.amenity;
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="swatch" style="background:#${cat.color.toString(16).padStart(6, "0")}"></span>
      <span>${room.name}</span>
      <span class="sub">Floor ${room.floor}</span>
    `;
    li.addEventListener("click", () => {
      activeFloor = "all";
      document.querySelectorAll(".floor-switcher [data-floor]").forEach((b) =>
        b.classList.toggle("active", b.dataset.floor === "all")
      );
      applyFloorLayout();
      const rg = roomGroups.find((g) => g.userData.roomId === room.id);
      if (rg) select(rg);
      searchResults.classList.remove("open");
      searchInput.value = room.name;
    });
    searchResults.appendChild(li);
  }
  searchResults.classList.add("open");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search")) searchResults.classList.remove("open");
});

// ---------------- View toggle (iso ↔ top) ----------------
(function setupViewToggle() {
  const btn = document.getElementById("toggle-view");
  const lbl = document.getElementById("view-label");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = viewMode === "iso" ? "top" : "iso";
    setViewMode(next);
    btn.classList.toggle("active", next === "top");
    btn.setAttribute("aria-pressed", next === "top" ? "true" : "false");
    btn.title = next === "top" ? "Switch back to isometric view" : "Switch to top-down view";
    if (lbl) lbl.textContent = next === "top" ? "Iso View" : "Top View";
  });
})();

// ---------------- Building tabs (top bar) ----------------
(function setupBuildingTabs() {
  const tabsEl = document.getElementById("building-tabs");
  if (!tabsEl) return;

  document.title = `${ACTIVE_BUILDING.name} — 3D Map`;

  tabsEl.innerHTML = "";
  for (const b of BUILDINGS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "building-tab";
    btn.role = "tab";
    btn.dataset.buildingId = b.id;
    if (b.id === ACTIVE_BUILDING.id) {
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
    } else {
      btn.setAttribute("aria-selected", "false");
    }
    if (b.accent) btn.style.setProperty("--tab-accent", b.accent);
    btn.innerHTML = `
      <span class="tab-mark">${b.icon ?? "✻"}</span>
      <span class="tab-text">
        <span class="tab-name">${b.name}</span>
        <span class="tab-sub">${b.subtitle}</span>
      </span>
    `;
    btn.title = `${b.name} — ${b.subtitle}`;
    btn.addEventListener("click", () => {
      if (b.id === ACTIVE_BUILDING.id) return;
      // Switch by URL param — page reload picks up the new building data.
      const url = new URL(window.location.href);
      if (b.id === BUILDINGS[0].id) url.searchParams.delete("building");
      else url.searchParams.set("building", b.id);
      window.location.href = url.toString();
    });
    tabsEl.appendChild(btn);
  }
})();

// Hide floor switcher buttons that don't apply to the active building
(function pruneFloorButtons() {
  const availableIds = new Set(FLOORS.map((f) => String(f.id)));
  document.querySelectorAll("[data-floor]").forEach((btn) => {
    const v = btn.dataset.floor;
    if (v === "all") {
      // Hide "All" if the building only has one floor — no point.
      btn.style.display = FLOORS.length > 1 ? "" : "none";
    } else if (!availableIds.has(v)) {
      btn.style.display = "none";
    }
  });
  document.querySelectorAll("[data-mobile-floor]").forEach((btn) => {
    const v = btn.dataset.mobileFloor;
    if (v === "all") {
      btn.style.display = FLOORS.length > 1 ? "" : "none";
    } else if (!availableIds.has(v)) {
      btn.style.display = "none";
    }
  });
  // If "All" is hidden, default activeFloor to the first available floor
  if (FLOORS.length === 1) activeFloor = FLOORS[0].id;
})();

// ---------------- Init layout, then start ----------------
applyFloorLayout();
applyCategoryFilter();
frameInitialView();

function frameInitialView(animate = false) {
  // Compute the actual room-cluster bounds on the currently-visible floors,
  // not the (much larger) slab. This way the camera lands on the gallery
  // area, not on empty slab padding.
  const floors = activeFloor === "all"
    ? FLOORS.map((f) => f.id)
    : [activeFloor];
  const rooms = ROOMS.filter((r) => floors.includes(r.floor));
  if (!rooms.length) return;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.footprint.x);
    maxX = Math.max(maxX, r.footprint.x + r.footprint.w);
    minZ = Math.min(minZ, r.footprint.z);
    maxZ = Math.max(maxZ, r.footprint.z + r.footprint.d);
  }
  const cx = (minX + maxX) / 2 - PLAN_CENTER.x;
  const cz = (minZ + maxZ) / 2 - PLAN_CENTER.z;
  const span = Math.max(maxX - minX, maxZ - minZ);

  const floorGroup = activeFloor === "all"
    ? floorGroups.get(FLOORS[0].id)
    : floorGroups.get(activeFloor);
  const floorY = floorGroup ? floorGroup.position.y : 0;

  const targetVec = new THREE.Vector3(cx, floorY + 3, cz);
  // We want the cluster (span wide) to fill ~80% of the visible frustum
  const zoom = THREE.MathUtils.clamp(FRUSTUM_SIZE / (span * 1.4), 0.6, 2.0);
  if (animate) {
    flyTo(targetVec, zoom, 55);
  } else {
    controls.target.copy(targetVec);
    camera.position.copy(targetVec).add(_viewOffset);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    controls.update();
  }
}

setTimeout(() => {
  document.getElementById("loader").classList.add("hidden");
}, 400);

// ---------------- Directions mode ----------------
let directionsMode = false;
let pickingSlot = "start";  // 'start' | 'end' | null
let dirStart = null;        // room object
let dirEnd   = null;

const dirEl       = document.getElementById("directions");
const dirOpenBtn  = document.getElementById("open-directions");
const dirCloseBtn = document.getElementById("dir-close");
const dirStartIn  = document.getElementById("dir-start-label");
const dirEndIn    = document.getElementById("dir-end-label");
const dirSummary  = document.getElementById("dir-summary");
const dirHint     = document.getElementById("dir-hint");
const dirStepsEl  = document.getElementById("dir-steps");

dirOpenBtn.addEventListener("click", () => openDirections());
dirCloseBtn.addEventListener("click", () => closeDirections());
document.getElementById("dir-swap").addEventListener("click", () => {
  [dirStart, dirEnd] = [dirEnd, dirStart];
  refreshDirectionsUI();
  recomputeRoute();
});
document.getElementById("dir-clear-all").addEventListener("click", () => {
  dirStart = null; dirEnd = null;
  pickingSlot = "start";
  routeLayer.clear();
  refreshDirectionsUI();
  dirStepsEl.classList.remove("visible");
  dirStepsEl.innerHTML = "";
  dirSummary.classList.remove("visible");
});
document.querySelectorAll(".dir-slot").forEach((slot) => {
  slot.addEventListener("click", (e) => {
    if (e.target.classList.contains("dir-clear")) return;
    pickingSlot = slot.dataset.slot;
    refreshDirectionsUI();
  });
});
document.querySelectorAll(".dir-clear").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const slot = btn.dataset.slot;
    if (slot === "start") dirStart = null;
    if (slot === "end")   dirEnd = null;
    pickingSlot = slot;
    routeLayer.clear();
    refreshDirectionsUI();
  });
});

function openDirections(opts = {}) {
  directionsMode = true;
  dirEl.classList.add("visible");
  dirOpenBtn.classList.add("active");

  // Pre-fill from a details "Get Directions" click
  if (opts.destination) {
    dirEnd = opts.destination;
    if (!dirStart) pickingSlot = "start";
    else if (dirStart.id === opts.destination.id) {
      // user picked the same room as destination as previously selected; clear start
      dirStart = null;
      pickingSlot = "start";
    } else pickingSlot = null;
  } else if (opts.origin) {
    dirStart = opts.origin;
    pickingSlot = dirEnd ? null : "end";
  } else {
    pickingSlot = dirStart ? (dirEnd ? null : "end") : "start";
  }

  // Close details panel and clear selection so it doesn't get in the way
  if (selected) { restoreGroup(selected); selected = null; }
  hideDetails();
  refreshDirectionsUI();
  if (dirStart && dirEnd) recomputeRoute();
}

function closeDirections() {
  directionsMode = false;
  pickingSlot = null;
  dirEl.classList.remove("visible");
  dirOpenBtn.classList.remove("active");
  routeLayer.clear();
  dirStart = null; dirEnd = null;
  refreshDirectionsUI();
  dirStepsEl.classList.remove("visible");
  dirStepsEl.innerHTML = "";
  dirSummary.classList.remove("visible");
}

function assignDirectionsSlot(room) {
  if (pickingSlot === "start" || (!dirStart && !pickingSlot)) {
    dirStart = room;
    pickingSlot = dirEnd ? null : "end";
  } else if (pickingSlot === "end") {
    dirEnd = room;
    pickingSlot = null;
  } else {
    // Both filled and nothing picked — replace destination
    dirEnd = room;
    pickingSlot = null;
  }
  refreshDirectionsUI();
  // Fly the camera to the room we just picked, so it's visually obvious
  // which point on the map was assigned
  const rg = groupByRoomId.get(room.id);
  if (rg) flyToRoom(rg);
  recomputeRoute();
}

function refreshDirectionsUI() {
  dirStartIn.value = dirStart ? `${dirStart.name} · F${dirStart.floor}` : "";
  dirEndIn.value   = dirEnd   ? `${dirEnd.name} · F${dirEnd.floor}`     : "";

  document.querySelectorAll(".dir-slot").forEach((s) =>
    s.classList.toggle("picking", directionsMode && s.dataset.slot === pickingSlot)
  );

  if (dirStart && dirEnd) {
    dirHint.textContent = "";
  } else if (directionsMode) {
    dirHint.textContent = pickingSlot
      ? `Click any room to set the ${pickingSlot === "start" ? "start point" : "destination"}.`
      : "Click a slot to pick again.";
  } else {
    dirHint.textContent = "";
  }
}

function recomputeRoute() {
  routeLayer.clear();
  dirSummary.classList.remove("visible");
  dirStepsEl.classList.remove("visible");
  dirStepsEl.innerHTML = "";
  if (!dirStart || !dirEnd) return;

  const result = findPath(graph, dirStart.id, dirEnd.id);
  if (!result || result.nodes.length < 2) {
    dirSummary.innerHTML = "<span>No route found between these rooms.</span>";
    dirSummary.classList.add("visible");
    return;
  }
  routeLayer.draw(result.nodes);

  // ----- Summary chip (distance · time · via Elevator X) -----
  const description = describePath(result.nodes);
  const elevatorLabel = description.elevators.length
    ? `via Elevator ${description.elevators.join(" + ")}`
    : (new Set(result.nodes.map((n) => n.floor)).size > 1 ? "multi-floor" : "");
  dirSummary.innerHTML = `
    <span class="sum-num">🚶 ${description.totalDistance} m</span>
    <span class="sum-sep">·</span>
    <span class="sum-num">⏱ ${description.totalTime} min</span>
    ${elevatorLabel ? `<span class="sum-via">${elevatorLabel}</span>` : ""}
  `;
  dirSummary.classList.add("visible");
  dirHint.textContent = "";

  // ----- Step list (sections + steps) -----
  for (const section of description.sections) {
    const sectionEl = document.createElement("div");
    sectionEl.className = "dir-section";
    const head = document.createElement("div");
    head.className = "dir-section-header";
    head.innerHTML = `<span class="sect-icon">${section.title.startsWith("Navigate") ? "📍" : "🛗"}</span><span>${section.title}</span>`;
    sectionEl.appendChild(head);
    for (const step of section.steps) {
      const row = document.createElement("div");
      row.className = `dir-step ${step.kind}`;
      const icon = document.createElement("span");
      icon.className = "step-icon";
      icon.textContent = step.icon ?? "↑";
      const text = document.createElement("span");
      text.className = "step-text";
      if (step.kind === "arrive") {
        text.innerHTML = `<strong>${step.text}</strong>${step.floorLabel ? `<span class="step-sub">${step.floorLabel}</span>` : ""}`;
      } else {
        text.textContent = step.text;
      }
      row.append(icon, text);
      row.addEventListener("click", () => {
        document.querySelectorAll(".dir-step").forEach((r) => r.classList.remove("active"));
        row.classList.add("active");
        focusOnStep(step);
      });
      sectionEl.appendChild(row);
    }
    dirStepsEl.appendChild(sectionEl);
  }
  dirStepsEl.classList.add("visible");

  // ----- Auto-frame ----
  const floors = new Set(result.nodes.map((n) => n.floor));
  if (floors.size > 1) {
    activeFloor = "all";
    exploded = true;
    document.querySelectorAll(".floor-switcher [data-floor]").forEach((b) =>
      b.classList.toggle("active", b.dataset.floor === "all")
    );
    document.getElementById("toggle-explode").classList.add("active");
    applyFloorLayout();
  } else {
    const fid = [...floors][0];
    activeFloor = fid;
    document.querySelectorAll(".floor-switcher [data-floor]").forEach((b) =>
      b.classList.toggle("active", b.dataset.floor === String(fid))
    );
    applyFloorLayout();
  }

  flyToRoutePoints(result.nodes);
}

function focusOnStep(step) {
  if (!step || step.startX === undefined) return;
  // Switch to the step's floor if we're focused on a different one
  if (activeFloor !== "all" && activeFloor !== step.floor) {
    activeFloor = step.floor;
    document.querySelectorAll(".floor-switcher [data-floor]").forEach((b) =>
      b.classList.toggle("active", b.dataset.floor === String(step.floor)),
    );
    document.querySelectorAll("[data-mobile-floor]").forEach((b) =>
      b.classList.toggle("active", b.dataset.mobileFloor === String(step.floor)),
    );
    applyFloorLayout();
  }
  // Drop a big arrow/marker on the route at the step's start position
  routeLayer.showStepArrow(step);

  // Fly to step location, tight zoom
  const floorGroup = floorGroups.get(step.floor);
  const floorY = floorGroup ? floorGroup.position.y : 0;
  const target = new THREE.Vector3(step.startX, floorY + 1.6, step.startZ);
  flyTo(target, 2.4, 50);
}

function flyToRoutePoints(pathNodes) {
  const sx = pathNodes.reduce((a, n) => a + n.x, 0) / pathNodes.length;
  const sz = pathNodes.reduce((a, n) => a + n.z, 0) / pathNodes.length;
  const ys = [...new Set(pathNodes.map((n) => n.floor))].map(
    (f) => floorGroups.get(f).userData.targetY ?? floorGroups.get(f).position.y,
  );
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2 + 4;
  // Span of the route in XZ — used to pick a zoom that fits it on screen
  const xs = pathNodes.map((n) => n.x);
  const zs = pathNodes.map((n) => n.z);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const zoom = THREE.MathUtils.clamp(FRUSTUM_SIZE / Math.max(span * 1.4, 12), 0.5, 2.2);
  flyTo(new THREE.Vector3(sx, cy, sz), zoom, 65);
}

// ---------------- X-ray fade for occluders ----------------
// Two principles:
//   A) Only the things actually obscuring the view fade — anything off the
//      camera→target line of sight stays fully opaque.
//   B) Only activate when the camera is zoomed in. At overview distance
//      the museum reads as a normal model with everything visible.
// The lateral band is narrow on purpose: walls directly in front of you
// vanish, but the rooms beside them — even right next to the line of
// sight — stay solid.
// X-ray fade range. Upper floors smoothly fade as the user zooms in —
// no hard cutoff. The fade is per-mesh with a radial mask that starts
// in the centre of the screen and expands outward like an oval, so the
// area directly under what you're looking at clears first and the
// edges of the floor stay visible longest.
const XRAY_ZOOM_START = 1.35;    // start ramping at this zoom
const XRAY_ZOOM_FULL  = 2.40;    // fully faded by this zoom
const XRAY_RADIAL_IN  = 0.20;    // normalized screen distance — fully faded inside this
const XRAY_RADIAL_OUT = 1.10;    // beyond this — no fade (stays solid)
const XRAY_MIN_OPACITY = 0.02;   // floor at the very end of the fade

// Reused scratch objects so updateXray doesn't allocate on every frame
const _xrayTmp    = new THREE.Vector3();
const _xrayRight  = new THREE.Vector3();
const _xrayUp     = new THREE.Vector3();

function updateXray() {
  if (activeFloor !== "all") return;

  // Make sure all floor groups are visible — we control purely via opacity.
  for (const fg of floorGroups.values()) fg.visible = true;

  // Global "how zoomed in" factor: 0 at overview, 1 fully zoomed in.
  const zoomFade = THREE.MathUtils.smoothstep(
    camera.zoom, XRAY_ZOOM_START, XRAY_ZOOM_FULL,
  );

  if (zoomFade < 0.005) {
    // Overview: restore each object to its natural opacity.
    for (const m of occluders) {
      const base = m.userData.baseOpacity ?? 1;
      if (Math.abs(m.material.opacity - base) > 0.005) m.material.opacity = base;
    }
    return;
  }

  // Camera basis vectors (constant under the iso lock, but cheap to read).
  _xrayRight.setFromMatrixColumn(camera.matrix, 0);
  _xrayUp.setFromMatrixColumn(camera.matrix, 1);
  const halfH = FRUSTUM_SIZE / (2 * camera.zoom);
  const halfW = halfH * (window.innerWidth / window.innerHeight);

  const focusY = controls.target.y;

  for (const m of occluders) {
    const base = m.userData.baseOpacity ?? 1;
    const floorY = m.userData.floorGroup?.position.y;
    // Floors at or below the focus stay at their natural opacity.
    if (floorY === undefined || floorY <= focusY + 1.0) {
      if (Math.abs(m.material.opacity - base) > 0.005) m.material.opacity = base;
      continue;
    }

    // Project the mesh's world position into screen-space relative to the
    // OrbitControls target (which sits at the centre of the screen).
    m.getWorldPosition(_xrayTmp).sub(controls.target);
    const sx = _xrayTmp.dot(_xrayRight) / halfW;
    const sy = _xrayTmp.dot(_xrayUp)    / halfH;
    const radial = Math.sqrt(sx * sx + sy * sy);

    // Oval mask: 1 dead-center, 0 past XRAY_RADIAL_OUT. So things at the
    // centre of the view fade much more aggressively than things at the
    // edge of the screen.
    const radialMask = 1 - THREE.MathUtils.smoothstep(
      XRAY_RADIAL_IN, XRAY_RADIAL_OUT, radial,
    );

    const fade = zoomFade * radialMask;
    const target = THREE.MathUtils.lerp(base, XRAY_MIN_OPACITY, fade);
    if (Math.abs(m.material.opacity - target) > 0.005) {
      m.material.opacity = target;
    }
  }
}

start(() => {
  updateCameraLerp();
  animateFloorY();
  updateFly();
  updateViewMorph();
  routeLayer.animate();
  updateXray();
});

// ====================================================================
//  Mobile UI: hamburger drawer, mobile search, floor buttons, legend,
//  explode/reset, and in-world label visibility toggle.
// ====================================================================
const hamburger    = document.getElementById("hamburger");
const drawerEl     = document.getElementById("mobile-drawer");
const scrimEl      = document.getElementById("mobile-scrim");
const mobileClose  = document.getElementById("mobile-close");

function setDrawerOpen(open) {
  if (!drawerEl) return;
  drawerEl.classList.toggle("open", open);
  scrimEl?.classList.toggle("open", open);
  drawerEl.setAttribute("aria-hidden", String(!open));
  hamburger?.setAttribute("aria-expanded", String(open));
}

hamburger?.addEventListener("click", () => setDrawerOpen(true));
mobileClose?.addEventListener("click", () => setDrawerOpen(false));
scrimEl?.addEventListener("click", () => setDrawerOpen(false));

// --- Floor buttons (mobile) ---
document.querySelectorAll("[data-mobile-floor]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-mobile-floor]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const v = btn.dataset.mobileFloor;
    activeFloor = v === "all" ? "all" : parseInt(v, 10);
    // Sync the desktop floor switcher's active state so things stay consistent
    document.querySelectorAll(".floor-switcher [data-floor]").forEach((b) =>
      b.classList.toggle("active", b.dataset.floor === v),
    );
    applyFloorLayout();
    frameInitialView(true);
    setDrawerOpen(false);
  });
});

// --- Directions / explode / reset (mobile) ---
document.getElementById("mobile-directions")?.addEventListener("click", () => {
  setDrawerOpen(false);
  openDirections();
});
document.getElementById("mobile-explode")?.addEventListener("click", () => {
  exploded = !exploded;
  document.getElementById("toggle-explode")?.classList.toggle("active", exploded);
  applyFloorLayout();
});
document.getElementById("mobile-reset")?.addEventListener("click", () => {
  setDrawerOpen(false);
  flyTo(new THREE.Vector3(0, 6, 0), new THREE.Vector3(50, 55, 50), 60);
});

// --- Collections legend (mobile) — populated from CATEGORIES ---
const mobileLegendEl = document.getElementById("mobile-legend");
if (mobileLegendEl) {
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const li = document.createElement("li");
    li.dataset.cat = key;
    li.innerHTML = `<span class="swatch" style="background:#${cat.color.toString(16).padStart(6,"0")}"></span><span>${cat.label}</span>`;
    li.addEventListener("click", () => {
      if (activeCategories.has(key)) activeCategories.delete(key);
      else activeCategories.add(key);
      li.classList.toggle("off", !activeCategories.has(key));
      // mirror to desktop legend
      const dItem = document.querySelector(`#legend-list [data-cat="${key}"]`);
      if (dItem) dItem.classList.toggle("off", !activeCategories.has(key));
      applyCategoryFilter();
    });
    mobileLegendEl.appendChild(li);
  }
}

// --- Mobile search (mirrors desktop search behavior) ---
const mSearchInput   = document.getElementById("mobile-search-input");
const mSearchResults = document.getElementById("mobile-search-results");
mSearchInput?.addEventListener("input", () => {
  const q = mSearchInput.value.trim().toLowerCase();
  mSearchResults.innerHTML = "";
  if (!q) return;
  const matches = ROOMS.filter((r) =>
    r.name.toLowerCase().includes(q) ||
    r.id.toLowerCase().includes(q) ||
    (CATEGORIES[r.category]?.label.toLowerCase().includes(q)),
  ).slice(0, 8);
  for (const room of matches) {
    const cat = CATEGORIES[room.category] || CATEGORIES.amenity;
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="swatch" style="background:#${cat.color.toString(16).padStart(6,"0")}"></span>
      <span>${room.name}</span>
      <span class="sub">F${room.floor}</span>`;
    li.addEventListener("click", () => {
      activeFloor = "all";
      document.querySelectorAll(".floor-switcher [data-floor]").forEach((b) =>
        b.classList.toggle("active", b.dataset.floor === "all"),
      );
      applyFloorLayout();
      const rg = roomGroups.find((g) => g.userData.roomId === room.id);
      if (rg) select(rg);
      setDrawerOpen(false);
      mSearchInput.value = room.name;
    });
    mSearchResults.appendChild(li);
  }
});

// --- In-world labels: visible on mobile / touch, hidden on desktop ---
// We listen to a media query so a window resize (or device rotation) flips
// the labels and hover tooltip behaviour automatically.
const isMobileMQ = window.matchMedia("(max-width: 760px), (pointer: coarse) and (hover: none)");
function applyMobileMode(mobile) {
  root.traverse((o) => {
    if (o.userData?.isLabel) o.visible = mobile;
  });
  document.body.classList.toggle("is-mobile", mobile);
}
applyMobileMode(isMobileMQ.matches);
isMobileMQ.addEventListener?.("change", (e) => applyMobileMode(e.matches));

window.__cam = { scene, camera, controls, floorGroups, roomGroups, graph, routeLayer };
