// =============================================================
//  Route rendering: turns a list of graph nodes into a glowing
//  animated path with arrow waypoints + start/end markers and
//  a vertical riser at elevator transitions between floors.
//
//  · Per-floor segments are added to that floor's Group so they
//    inherit the explode/switch animation for free.
//  · Vertical risers live in scene-space and re-measure their
//    endpoints each frame (because floor Y is animated).
// =============================================================
import * as THREE from "three";

const PATH_COLOR     = 0xff2d56;   // bold magenta — high contrast vs cream paver
const PATH_ACCENT    = 0xffffff;   // white arrows — pop against the magenta tube + cream paver
const START_COLOR    = 0x22cc55;   // strong green
const END_COLOR      = 0xff2d56;   // matches tube
// Route renders WELL above the lifted plaza so the painted line is
// clearly readable from any iso angle. Plaza top sits at y ≈ 0.97
// and path strips at y ≈ 1.07; lifting the route to ~2.4 m gives it
// daylight from every surface.
const ROUTE_Y_TUBE   = 2.45;
const ROUTE_Y_ARROW  = 2.55;
const ROUTE_Y_DISC   = 2.40;
const ROUTE_Y_MARKER = 2.40;
const ROUTE_Y_STEP   = 2.85;

export function createRouteLayer(scene, floorGroups) {
  const root = new THREE.Group();
  root.name = "route-root";
  scene.add(root);

  const animatedTextures = [];     // dash textures to scroll each frame
  const pulseObjects    = [];      // markers to pulse
  /** @type {{mesh:THREE.Mesh, fromFloor:number, toFloor:number, x:number, z:number, baseHeight:number}[]} */
  const risers          = [];      // vertical elevator visuals
  let   stepArrowRef    = null;    // current "this is your step" focus marker

  function clear() {
    // Remove anything we previously added to floor groups
    for (const fg of floorGroups.values()) {
      const stale = fg.children.filter((c) => c.userData?.isRoute);
      for (const c of stale) {
        fg.remove(c);
        disposeDeep(c);
      }
    }
    while (root.children.length) {
      const c = root.children[0];
      root.remove(c);
      disposeDeep(c);
    }
    animatedTextures.length = 0;
    pulseObjects.length = 0;
    risers.length = 0;
    stepArrowRef = null;
  }

  /**
   * @param {{x:number, z:number, floor:number, kind:string}[]} pathNodes
   */
  function draw(pathNodes) {
    clear();
    if (!pathNodes || pathNodes.length < 2) return;

    // Split into per-floor segments. A floor change between consecutive
    // nodes is an elevator transition.
    const segments = [];
    let cur = { floor: pathNodes[0].floor, points: [] };
    for (let i = 0; i < pathNodes.length; i++) {
      const n = pathNodes[i];
      if (n.floor !== cur.floor) {
        segments.push(cur);
        cur = { floor: n.floor, points: [] };
      }
      cur.points.push(new THREE.Vector3(n.x, ROUTE_Y_TUBE, n.z));
    }
    segments.push(cur);

    // Draw each floor segment
    for (const seg of segments) {
      if (seg.points.length === 1) {
        // Single-point floor segment (e.g. start IS an elevator) — render a
        // small disc at that location so the riser has something to land on.
        drawDisc(seg.floor, seg.points[0]);
        continue;
      }
      drawTube(seg.floor, seg.points);
    }

    // Vertical risers between consecutive segments on different floors
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i];
      const b = segments[i + 1];
      const pA = a.points[a.points.length - 1];
      const pB = b.points[0];
      addRiser(a.floor, b.floor, pA, pB);
    }

    // Start + end markers
    const startNode = pathNodes[0];
    const endNode   = pathNodes[pathNodes.length - 1];
    addMarker(startNode, START_COLOR, "start");
    addMarker(endNode,   END_COLOR,   "end");
  }

  function drawTube(floorId, points) {
    const fg = floorGroups.get(floorId);
    if (!fg) return;

    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.35);
    const segments = Math.max(points.length * 16, 48);

    // Glow halo (wider, semi-transparent) — gives the tube an obvious
    // pink aura so it reads as a navigation guide from far away.
    const haloGeo = new THREE.TubeGeometry(curve, segments, 0.42, 12, false);
    const haloMat = new THREE.MeshBasicMaterial({
      color: PATH_COLOR,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.userData.isRoute = true;
    fg.add(halo);

    // Inner tube with animated dash texture — thicker than before for
    // visibility from iso views, fully opaque magenta core.
    const dashTex = makeDashTexture();
    dashTex.repeat.set(Math.max(curve.getLength() / 1.4, 4), 1);
    const tubeGeo = new THREE.TubeGeometry(curve, segments, 0.17, 14, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      map: dashTex,
      color: PATH_COLOR,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.userData.isRoute = true;
    tube.userData.dashTex = dashTex;
    fg.add(tube);
    animatedTextures.push(dashTex);

    // Arrow waypoints every ~2.5m
    const length = curve.getLength();
    const spacing = 2.5;
    const count = Math.max(1, Math.floor(length / spacing));
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const pos = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const arrow = makeArrow();
      arrow.position.set(pos.x, ROUTE_Y_ARROW, pos.z);
      arrow.rotation.y = Math.atan2(tangent.x, tangent.z);
      arrow.userData.isRoute = true;
      fg.add(arrow);
      pulseObjects.push({ obj: arrow, phase: i * 0.5 });
    }
  }

  function drawDisc(floorId, p) {
    const fg = floorGroups.get(floorId);
    if (!fg) return;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 24),
      new THREE.MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0.5, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x, ROUTE_Y_DISC, p.z);
    disc.userData.isRoute = true;
    fg.add(disc);
  }

  function addRiser(fromFloor, toFloor, pA, pB) {
    // Riser cylinder (lives in scene-space). Initial height 1 — we scale Y
    // each frame based on the live floor positions.
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 1, 14),
      new THREE.MeshBasicMaterial({
        color: PATH_COLOR, transparent: true, opacity: 0.55, depthWrite: false,
      })
    );
    tube.userData.isRoute = true;
    root.add(tube);

    const halo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 1, 16),
      new THREE.MeshBasicMaterial({
        color: PATH_COLOR, transparent: true, opacity: 0.16, depthWrite: false,
      })
    );
    halo.userData.isRoute = true;
    root.add(halo);

    // Floating "▲" sprite at the midpoint to suggest "ride elevator"
    const sprite = makeRiserSprite();
    sprite.userData.isRoute = true;
    root.add(sprite);

    risers.push({
      tube, halo, sprite,
      fromFloor, toFloor,
      // Use the midpoint of the two doorway positions
      x: (pA.x + pB.x) / 2,
      z: (pA.z + pB.z) / 2,
    });
  }

  function addMarker(node, color, kind) {
    const fg = floorGroups.get(node.floor);
    if (!fg) return;
    const m = makeMarker(color);
    m.position.set(node.x, ROUTE_Y_MARKER, node.z);
    m.userData.isRoute = true;
    m.userData.kind = kind;
    fg.add(m);
    pulseObjects.push({ obj: m, phase: kind === "start" ? 0 : Math.PI });
  }

  function animate() {
    // Scroll dash textures (forward flow along the path)
    for (const tex of animatedTextures) tex.offset.x -= 0.018;

    // Pulse markers + arrows
    const t = performance.now() * 0.003;
    for (const { obj, phase } of pulseObjects) {
      const s = 1 + Math.sin(t + phase) * 0.08;
      obj.scale.setScalar(s);
    }

    // Update risers (re-measure floor world Y each frame)
    for (const r of risers) {
      const yA = floorGroups.get(r.fromFloor).position.y + 0.5;
      const yB = floorGroups.get(r.toFloor).position.y + 0.5;
      const h = Math.abs(yB - yA);
      const midY = (yA + yB) / 2;
      r.tube.position.set(r.x, midY, r.z);
      r.tube.scale.y = Math.max(h, 0.001);
      r.halo.position.set(r.x, midY, r.z);
      r.halo.scale.y = Math.max(h, 0.001);
      r.sprite.position.set(r.x, midY, r.z);
    }
  }

  // -----------------------------------------------------------------
  //  Step focus: drop a big glowing arrow at the start of a step so the
  //  user sees exactly where on the route that instruction applies.
  // -----------------------------------------------------------------
  function clearStepArrow() {
    if (!stepArrowRef) return;
    const idx = pulseObjects.findIndex((p) => p.obj === stepArrowRef);
    if (idx >= 0) pulseObjects.splice(idx, 1);
    stepArrowRef.parent?.remove(stepArrowRef);
    disposeDeep(stepArrowRef);
    stepArrowRef = null;
  }

  function showStepArrow(step) {
    clearStepArrow();
    if (!step) return;
    const fg = floorGroups.get(step.floor);
    if (!fg) return;
    if (step.startX === undefined || step.startZ === undefined) return;

    let marker;
    if (step.kind === "arrive") {
      // Destination — pulsing magenta orb on a pole
      marker = makeBigMarker(0xff4d6a);
    } else if (step.kind === "elevator") {
      // Elevator — vertical "▲" sprite (already used in risers)
      marker = makeBigElevatorMarker();
    } else {
      // Walking / turn — big forward-pointing arrow
      marker = makeBigArrow();
      if (step.bearing !== undefined && step.bearing !== null) {
        marker.rotation.y = step.bearing;
      }
    }
    marker.position.set(step.startX, ROUTE_Y_STEP, step.startZ);
    marker.userData.isRoute = true;
    marker.userData.isStepArrow = true;
    fg.add(marker);
    stepArrowRef = marker;
    pulseObjects.push({ obj: marker, phase: 0 });
  }

  return { draw, clear, animate, showStepArrow, clearStepArrow };
}

function makeBigArrow() {
  // Big flat arrow, ~3× the route's per-segment arrows
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.95);
  shape.lineTo(0.72, 0.10);
  shape.lineTo(0.26, 0.10);
  shape.lineTo(0.26, 0.78);
  shape.lineTo(-0.26, 0.78);
  shape.lineTo(-0.26, 0.10);
  shape.lineTo(-0.72, 0.10);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const inner = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: PATH_COLOR,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  inner.rotation.x = -Math.PI / 2;

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 28),
    new THREE.MeshBasicMaterial({
      color: PATH_COLOR,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.01;

  const outer = new THREE.Group();
  outer.add(glow);
  outer.add(inner);
  return outer;
}

function makeBigMarker(color) {
  const group = new THREE.Group();
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 20, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  head.position.y = 1.4;
  group.add(head);
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.02;
  group.add(halo);
  return group;
}

function makeBigElevatorMarker() {
  const canvas = document.createElement("canvas");
  canvas.width = 192; canvas.height = 192;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 192, 192);
  ctx.font = "800 160px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff4b3";
  ctx.fillText("▲", 96, 106);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false,
  }));
  sprite.scale.set(1.6, 1.6, 1);
  const group = new THREE.Group();
  sprite.position.y = 1.1;
  group.add(sprite);

  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 32),
    new THREE.MeshBasicMaterial({ color: 0xff4d6a, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.02;
  group.add(halo);
  return group;
}

// =============================================================
//  Helpers
// =============================================================
function disposeDeep(obj) {
  obj.traverse?.((n) => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) {
      if (n.material.map) n.material.map.dispose?.();
      n.material.dispose();
    }
  });
}

function makeDashTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 8;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 64, 8);
  // Tapered dash for a soft look
  const grd = ctx.createLinearGradient(0, 0, 38, 0);
  grd.addColorStop(0,   "rgba(255,255,255,0)");
  grd.addColorStop(0.2, "rgba(255,255,255,1)");
  grd.addColorStop(0.8, "rgba(255,255,255,1)");
  grd.addColorStop(1,   "rgba(255,255,255,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 38, 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeArrow() {
  // Flat arrow lying on the floor. Tip in -Z direction so we can use
  // rotation.y = atan2(tangent.x, tangent.z) to align with the curve.
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.35);     // tip (forward = -Z)
  shape.lineTo(0.28, 0.05);
  shape.lineTo(0.1, 0.05);
  shape.lineTo(0.1, 0.3);
  shape.lineTo(-0.1, 0.3);
  shape.lineTo(-0.1, 0.05);
  shape.lineTo(-0.28, 0.05);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({
    color: PATH_ACCENT,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // shape is in XY plane; lay it down on the XZ plane
  const inner = new THREE.Mesh(geo, mat);
  inner.rotation.x = -Math.PI / 2;
  // glow under arrow
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 18),
    new THREE.MeshBasicMaterial({
      color: PATH_ACCENT, transparent: true, opacity: 0.18, depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.01;
  const outer = new THREE.Group();
  outer.add(glow);
  outer.add(inner);
  return outer;
}

function makeMarker(color) {
  const group = new THREE.Group();
  const headGeo = new THREE.SphereGeometry(0.32, 18, 14);
  const headMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.4;
  group.add(head);

  const inner = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  );
  inner.position.y = 1.4;
  group.add(inner);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 1.4, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })
  );
  pole.position.y = 0.7;
  group.add(pole);

  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.02;
  group.add(halo);

  // outer pulse ring (subtle)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.85, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  group.add(ring);

  return group;
}

function makeRiserSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = "800 100px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff4b3";
  ctx.fillText("▲", 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 1.2, 1);
  return sprite;
}
