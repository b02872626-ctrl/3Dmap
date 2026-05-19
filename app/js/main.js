// =============================================================
//  Bootstrap + UI wiring for the CAM 3D Visitor Guide
// =============================================================
import * as THREE from "three";
import { createScene } from "./scene.js";
import { buildFloors, tryReplaceWithFBX } from "./floors.js";
import { CATEGORIES, FLOORS, ROOMS, PLAN_BOUNDS } from "./data.js";

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

function flyToRoom(group) {
  const room = group.userData.room;
  const fp = room.footprint;

  // The room GROUP has no offset of its own — every child is positioned in
  // floor-local plan-centered coords. So we compute the room's actual
  // center from its footprint, then add the live floor-group Y so explode
  // / floor-switch animations are respected.
  const localX = (fp.x + fp.w / 2) - PLAN_CENTER.x;
  const localZ = (fp.z + fp.d / 2) - PLAN_CENTER.z;
  const floorGroup = group.parent;
  const floorY = floorGroup ? floorGroup.position.y : 0;
  const target = new THREE.Vector3(localX, floorY + 1.6, localZ);

  // Tight focus distance — camera moves CLOSE to the selected room so it
  // fills the frame.
  const span = Math.max(fp.w, fp.d);
  let dist = THREE.MathUtils.clamp(span * 1.35, 8.5, 20);
  // Preserve the camera's current orbital orientation so the user doesn't
  // get teleported to a different angle every click — only the focus point
  // and distance change.
  const dir = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();
  // Floor on the polar angle so we don't drop near horizon when the user
  // had previously tilted very low.
  if (dir.y < 0.45) {
    dir.y = 0.45;
    dir.normalize();
  }
  // If we're being asked to fly to the same room twice (the destination is
  // very close to where the camera already is), dolly in by ~25% so the
  // user gets a visible response to their click.
  const tentativeCameraPt = target.clone().add(dir.clone().multiplyScalar(dist));
  if (tentativeCameraPt.distanceTo(camera.position) < 1.5) {
    dist = Math.max(controls.minDistance + 0.5, dist * 0.72);
  }
  const cameraPt = target.clone().add(dir.multiplyScalar(dist));
  flyTo(target, cameraPt, 55);
}

// Camera position used to be jittery during fly because OrbitControls'
// damping was still applying smoothing on top of our manual lerp. We
// temporarily disable damping for the fly, then restore.
let _origDamping = null;

function flyTo(targetPoint, cameraPoint, dur = 55) {
  if (!flyAnim) _origDamping = controls.enableDamping;
  controls.enableDamping = false;
  flyAnim = {
    posFrom: camera.position.clone(),
    posTo: cameraPoint.clone(),
    tgtFrom: controls.target.clone(),
    tgtTo: targetPoint.clone(),
    t: 0, dur,
  };
  cameraLerp = null;
}

function updateFly() {
  if (!flyAnim) return;
  flyAnim.t++;
  const k = Math.min(1, flyAnim.t / flyAnim.dur);
  // Cosine ease-in-out — smoother accel and decel than cubic
  const ease = 0.5 - 0.5 * Math.cos(k * Math.PI);
  camera.position.lerpVectors(flyAnim.posFrom, flyAnim.posTo, ease);
  controls.target.lerpVectors(flyAnim.tgtFrom, flyAnim.tgtTo, ease);
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
  flyTo(new THREE.Vector3(0, 6, 0), new THREE.Vector3(50, 55, 50), 60);
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

  // Distance proportional to span; clamped for sensible framing
  const dist = THREE.MathUtils.clamp(span * 1.55, 36, 90);
  const floorGroup = activeFloor === "all"
    ? floorGroups.get(FLOORS[0].id)
    : floorGroups.get(activeFloor);
  const floorY = floorGroup ? floorGroup.position.y : 0;

  const targetVec = new THREE.Vector3(cx, floorY + 3, cz);
  const camVec    = new THREE.Vector3(
    cx + dist * 0.62,
    floorY + dist * 0.78,
    cz + dist * 0.62,
  );
  if (animate) {
    flyTo(targetVec, camVec, 55);
  } else {
    camera.position.copy(camVec);
    controls.target.copy(targetVec);
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

  // Fly camera tight on that arrow, keeping the user's current orbital angle
  const floorGroup = floorGroups.get(step.floor);
  const floorY = floorGroup ? floorGroup.position.y : 0;
  const target = new THREE.Vector3(step.startX, floorY + 1.6, step.startZ);
  const dir = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();
  if (dir.y < 0.45) { dir.y = 0.45; dir.normalize(); }
  const dist = 11;
  const cameraPt = target.clone().add(dir.multiplyScalar(dist));
  flyTo(target, cameraPt, 50);
}

function flyToRoutePoints(pathNodes) {
  // Average XZ across all nodes, target Y = centroid of visible floors
  const sx = pathNodes.reduce((a, n) => a + n.x, 0) / pathNodes.length;
  const sz = pathNodes.reduce((a, n) => a + n.z, 0) / pathNodes.length;
  const ys = [...new Set(pathNodes.map((n) => n.floor))].map(
    (f) => floorGroups.get(f).userData.targetY ?? floorGroups.get(f).position.y
  );
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2 + 4;
  const target = new THREE.Vector3(sx, cy, sz);
  const camPt  = new THREE.Vector3(sx + 30, cy + 28, sz + 30);
  flyTo(target, camPt, 65);
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
const XRAY_LATERAL_NEAR = 1.6;  // <= this many units from view ray → fully transparent
const XRAY_LATERAL_FAR  = 3.5;  // >= this many units → fully opaque
const XRAY_MIN          = 0.05; // minimum opacity for "in the way" meshes
const ZOOM_FADE_NEAR    = 22;   // camera→target distance for full fade
const ZOOM_FADE_FAR     = 42;   // distance beyond which fade is off entirely

const _xrayVec  = new THREE.Vector3();
const _camDir   = new THREE.Vector3();
const _toOcc    = new THREE.Vector3();
const _projPt   = new THREE.Vector3();
const _xrayRay  = new THREE.Ray();
const _xrayHit  = new THREE.Vector3();
const _xrayBox  = new THREE.Box3();
const _worldPos = new THREE.Vector3();

function updateXray() {
  const camPos = camera.position;
  _camDir.copy(controls.target).sub(camPos);
  const focusDist = _camDir.length();
  if (focusDist < 0.01) return;
  _camDir.divideScalar(focusDist); // normalize

  // ---- Zoom-aware fade strength: 1 when zoomed in, 0 when zoomed out ----
  const fadeStrength = 1 - THREE.MathUtils.smoothstep(focusDist, ZOOM_FADE_NEAR, ZOOM_FADE_FAR);

  // Fast exit when zoomed out — make sure everything is opaque
  if (fadeStrength < 0.01) {
    for (const m of occluders) {
      if (m.material.opacity < 0.999) m.material.opacity = 1;
    }
    return;
  }

  _xrayRay.origin.copy(camPos);
  _xrayRay.direction.copy(_camDir);

  for (const m of occluders) {
    if (!m.visible) continue;
    if (!m.parent || !m.parent.visible) continue;

    // Rebuild the mesh's world bbox each frame. Meshes have translation only
    // (no rotation/scale), so world bbox = world-position + local bbox.
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const lbb = m.geometry.boundingBox;
    m.getWorldPosition(_worldPos);
    _xrayBox.min.set(
      _worldPos.x + lbb.min.x,
      _worldPos.y + lbb.min.y,
      _worldPos.z + lbb.min.z,
    );
    _xrayBox.max.set(
      _worldPos.x + lbb.max.x,
      _worldPos.y + lbb.max.y,
      _worldPos.z + lbb.max.z,
    );

    let losOpacity;

    // (1) Ray-AABB intersection: does the view ray actually pierce this
    //     mesh between camera and target? Catches slabs/floor tiles that
    //     the center-based test missed (large meshes whose center sits
    //     well off-axis from the ray).
    const hit = _xrayRay.intersectBox(_xrayBox, _xrayHit);
    if (hit && _xrayHit.distanceTo(camPos) < focusDist - 0.5) {
      losOpacity = XRAY_MIN;
    } else {
      // (2) Center-based lateral falloff — smooth halo around the ray for
      //     walls that JUST graze the line of sight without piercing it.
      _toOcc.copy(_worldPos).sub(camPos);
      const along = _toOcc.dot(_camDir);
      if (along <= 0.5 || along >= focusDist + 0.5) {
        losOpacity = 1;
      } else {
        _projPt.copy(_camDir).multiplyScalar(along);
        const lateral = _toOcc.distanceTo(_projPt);
        let t;
        if (lateral <= XRAY_LATERAL_NEAR) t = 0;
        else if (lateral >= XRAY_LATERAL_FAR) t = 1;
        else t = (lateral - XRAY_LATERAL_NEAR) / (XRAY_LATERAL_FAR - XRAY_LATERAL_NEAR);
        t = t * t * (3 - 2 * t);
        losOpacity = XRAY_MIN + (1 - XRAY_MIN) * t;
      }
    }

    const target = 1 - (1 - losOpacity) * fadeStrength;
    if (Math.abs(m.material.opacity - target) > 0.005) m.material.opacity = target;
  }
}

start(() => {
  updateCameraLerp();
  animateFloorY();
  updateFly();
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
