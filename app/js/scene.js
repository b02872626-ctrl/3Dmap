// =============================================================
//  Three.js scene: ORTHOGRAPHIC camera. Starts at an isometric
//  direction but free to orbit — pan, zoom, and rotate are all
//  enabled.
// =============================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader }     from "three/addons/loaders/FBXLoader.js";

// Direction from target to camera, normalized. ~35° tilt above horizon
// with a 45° yaw — classic isometric.
export const ISO_DIR = new THREE.Vector3(1, 0.82, 1).normalize();
// How far the camera sits behind that direction. In an orthographic
// projection this distance doesn't affect "zoom" — it only matters for
// shadow / depth precision — so we pick a comfortable mid-range value.
export const ISO_DISTANCE = 100;
// Vertical extent of the visible world frustum at zoom = 1.
export const FRUSTUM_SIZE = 60;

export function createScene(canvas) {
  // ---------------- Renderer ----------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // ---------------- Scene ----------------
  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(0x0c1116, 80, 320);

  // ---------------- Orthographic camera ----------------
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    -FRUSTUM_SIZE * aspect / 2,
     FRUSTUM_SIZE * aspect / 2,
     FRUSTUM_SIZE / 2,
    -FRUSTUM_SIZE / 2,
    0.1, 600,
  );
  const initialTarget = new THREE.Vector3(0, 4, 0);
  camera.position.copy(initialTarget).add(
    ISO_DIR.clone().multiplyScalar(ISO_DISTANCE),
  );
  camera.lookAt(initialTarget);
  camera.zoom = 1;
  camera.updateProjectionMatrix();

  // ---------------- Orbit controls: pan + zoom + rotate ----------------
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(initialTarget);
  controls.enableRotate = true;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan  = true;
  controls.enableZoom = true;
  controls.zoomSpeed  = 1.1;
  controls.panSpeed   = 0.8;
  controls.rotateSpeed = 0.9;
  controls.minZoom    = 0.45;                // can't zoom out further than ~half size
  controls.maxZoom    = 4.5;                 // can't zoom in further than ~4.5×
  controls.screenSpacePanning = true;        // map-style panning
  // Left-drag rotates the orbit (default 3D-viewer behaviour). Right-drag
  // pans the map. Wheel / pinch zooms.
  controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  THREE.MOUSE.PAN,
  };
  // Touch: one-finger rotates, two-finger pinch zoom + pan.
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  // ---------------- Lighting ----------------
  // Slightly warmer ambient + hemi keep the cream walls from going flat
  // in shadow. The sun gets ~2× the previous intensity so the new roofs
  // throw a clear directional shadow across the platforms.
  const ambient = new THREE.AmbientLight(0xf5efe2, 0.50);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xfff3dc, 0x2a2f38, 0.85);
  hemi.position.set(0, 30, 0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe9c8, 0.75);
  sun.position.set(40, 80, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -80;
  sun.shadow.camera.right  =  80;
  sun.shadow.camera.top    =  80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 240;
  sun.shadow.bias       = -0.0002;
  sun.shadow.normalBias = 0.35;
  sun.shadow.radius     = 8;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // ---------------- Ground + halo + grid ----------------
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(220, 64),
    new THREE.MeshStandardMaterial({ color: 0x0e1217, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // Faux-ambient halo disabled — the radial gradient drew a dark
  // shadow ring around the buildings on top of the SVG floor. The
  // architectural drawing already conveys depth; restore by
  // uncommenting if you need the vignette back.
  // const haloCanvas = document.createElement("canvas");
  // haloCanvas.width = haloCanvas.height = 256;
  // const hctx = haloCanvas.getContext("2d");
  // const grad = hctx.createRadialGradient(128, 128, 30, 128, 128, 128);
  // grad.addColorStop(0,   "rgba(0,0,0,0.55)");
  // grad.addColorStop(0.6, "rgba(0,0,0,0.15)");
  // grad.addColorStop(1,   "rgba(0,0,0,0)");
  // hctx.fillStyle = grad;
  // hctx.fillRect(0, 0, 256, 256);
  // const haloTex = new THREE.CanvasTexture(haloCanvas);
  // haloTex.colorSpace = THREE.SRGBColorSpace;
  // const halo = new THREE.Mesh(
  //   new THREE.PlaneGeometry(160, 160),
  //   new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false }),
  // );
  // halo.rotation.x = -Math.PI / 2;
  // halo.position.set(0, 0.005, 0);
  // scene.add(halo);

  // Debug grid disabled — it sits at Y=0 (same plane as the SVG floor
  // texture) and shows through as vertical/horizontal stripes. Restore
  // by uncommenting if you need a measurement grid back.
  // const grid = new THREE.GridHelper(260, 130, 0x1c2330, 0x141a22);
  // grid.position.set(0, -0.01, 0);
  // grid.material.transparent = true;
  // grid.material.opacity = 0.18;
  // scene.add(grid);

  // ---------------- Resize ----------------
  window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const a = w / h;
    camera.left   = -FRUSTUM_SIZE * a / 2;
    camera.right  =  FRUSTUM_SIZE * a / 2;
    camera.top    =  FRUSTUM_SIZE / 2;
    camera.bottom = -FRUSTUM_SIZE / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // ---------------- Render loop ----------------
  function start(onFrame) {
    renderer.setAnimationLoop(() => {
      controls.update();
      if (onFrame) onFrame();
      renderer.render(scene, camera);
    });
  }

  return { renderer, scene, camera, controls, start, fbxLoader: new FBXLoader() };
}
