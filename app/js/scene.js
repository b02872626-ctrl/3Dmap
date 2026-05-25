// =============================================================
//  Three.js scene: PERSPECTIVE camera. Starts at an isometric
//  direction but free to orbit — pan, dolly (zoom), and rotate are
//  all enabled.
// =============================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader }     from "three/addons/loaders/FBXLoader.js";

// Direction from target to camera, normalized. ~35° tilt above horizon
// with a 45° yaw — classic isometric.
export const ISO_DIR = new THREE.Vector3(1, 0.82, 1).normalize();
// Default camera distance from the orbit target. OrbitControls dollies
// this in / out via mouse wheel; minDistance / maxDistance bound it.
export const ISO_DISTANCE = 75;
// Vertical field of view in degrees. Narrower FOV gives a more
// "near-orthographic" feel; wider FOV is more dramatic perspective.
export const FOV = 35;
// Helper for distance calculations in main.js. distance such that a
// world span of N metres fills the full vertical view height:
//   distance = N / (2 * tan(FOV/2))
export const FOV_HALF_TAN = Math.tan((FOV * Math.PI / 180) / 2);

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
  renderer.toneMappingExposure = 1.35;
  // Force a cream clear-color even if scene.background fails to apply
  // — keeps the canvas from showing the dark body gradient through a
  // transparent buffer.
  renderer.setClearColor(0xf4ede0, 1);

  // ---------------- Scene ----------------
  // Soft cream backdrop — matches the "studio render" look of the
  // architectural reference instead of the previous dark void.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4ede0);
  // Fog kept extremely subtle and tinted to match the backdrop so
  // distant geometry blends rather than greying out.
  scene.fog = new THREE.Fog(0xf4ede0, 220, 420);

  // ---------------- Perspective camera ----------------
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 600);
  const initialTarget = new THREE.Vector3(0, 4, 0);
  camera.position.copy(initialTarget).add(
    ISO_DIR.clone().multiplyScalar(ISO_DISTANCE),
  );
  camera.lookAt(initialTarget);
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
  controls.minDistance = 15;                 // closest dolly
  controls.maxDistance = 250;                // furthest dolly
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
  // Studio-render lighting: warm-tinted ambient + bright hemi for fill,
  // and a stronger directional sun for crisp shadows across the platforms.
  const ambient = new THREE.AmbientLight(0xfff5e4, 0.65);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xfff3dc, 0xb8a880, 1.05);
  hemi.position.set(0, 30, 0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d0, 1.10);
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
  sun.shadow.radius     = 12;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // ---------------- Ground + halo + grid ----------------
  // Dark ground disc removed — with the grass plane lowered to match
  // the raised plaza bottom, this 220 m disc at Y=-0.05 was visible as
  // a "floating" dark layer between the plaza side and the grass below.
  // The lawn (added at scene level in floors.js) is the only ground
  // plane now.

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

  // ---------------- Post-processing (disabled) ----------------
  // SSAO pipeline temporarily removed — it was rendering the scene
  // black on this Three.js version. The lighting + texture changes
  // stay; we just go back to direct renderer.render() until we
  // re-introduce post-processing safely.

  // ---------------- Resize ----------------
  window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // ---------------- Render loop ----------------
  let _renderErrorLogged = false;
  function start(onFrame) {
    renderer.setAnimationLoop(() => {
      try {
        controls.update();
        if (onFrame) onFrame();
        renderer.render(scene, camera);
      } catch (err) {
        if (!_renderErrorLogged) {
          console.error("Render loop error (first occurrence):", err);
          _renderErrorLogged = true;
        }
      }
    });
  }

  return { renderer, scene, camera, controls, start, fbxLoader: new FBXLoader() };
}
