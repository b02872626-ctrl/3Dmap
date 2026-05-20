// =============================================================
//  Three.js scene: isometric orbital camera, lighting, helpers
// =============================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader }     from "three/addons/loaders/FBXLoader.js";
import { PLAN_BOUNDS }   from "./data.js";

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
  scene.background = null; // CSS gradient shows through
  scene.fog = new THREE.Fog(0x0c1116, 80, 220);

  // ---------------- Camera (perspective with isometric framing) ----------------
  const aspect = window.innerWidth / window.innerHeight;
  // Wider near plane than the default 0.1 — the camera never gets closer
  // than ~7 units anyway (OrbitControls.minDistance), so raising near to
  // 0.5 gives the depth buffer a lot more precision and eliminates the
  // z-fighting "shimmer" you can see on big flat surfaces like the slab.
  const camera = new THREE.PerspectiveCamera(38, aspect, 0.5, 500);
  // The model is rendered plan-centered, so world origin is the slab center.
  // main.js overrides this with a precise frameInitialView() once the floors
  // are built, but we set a reasonable default so the canvas isn't empty
  // before that runs.
  const cx = 0;
  const cz = 0;
  camera.position.set(cx + 50, 55, cz + 50);
  camera.lookAt(cx, 6, cz);

  // ---------------- Orbit controls (Situm-style: free orbit, clamped) ----------------
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(cx, 6, cz);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;     // allow real close-up focus on small rooms
  controls.maxDistance = 140;
  // Keep the camera in the isometric range: never less than ~22° above
  // the horizon, never less than ~16° from straight overhead.
  controls.maxPolarAngle = Math.PI * 0.38;  // ~68° from vertical = 22° above horizon
  controls.minPolarAngle = Math.PI * 0.10;  // ~18° from vertical
  controls.screenSpacePanning = false;
  controls.panSpeed = 0.7;
  controls.rotateSpeed = 0.6;

  // ---------------- Lighting ----------------
  // Mostly ambient: omni-directional fill so interiors are evenly lit,
  // with just a whisper of directionality to keep walls from going flat.
  const ambient = new THREE.AmbientLight(0xf5efe2, 0.55);
  scene.add(ambient);

  // Hemisphere — warm sky, cool floor bounce
  const hemi = new THREE.HemisphereLight(0xfff3dc, 0x2a2f38, 0.95);
  hemi.position.set(cx, 30, cz);
  scene.add(hemi);

  // Very soft directional light for gentle shadows only
  const sun = new THREE.DirectionalLight(0xffe9c8, 0.35);
  sun.position.set(cx + 40, 80, cz - 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -60;
  sun.shadow.camera.right  =  60;
  sun.shadow.camera.top    =  60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 6;        // softer penumbra
  sun.target.position.set(cx, 0, cz);
  scene.add(sun);
  scene.add(sun.target);

  // ---------------- Ground ----------------
  const groundGeo = new THREE.CircleGeometry(160, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0e1217,
    roughness: 1,
    metalness: 0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.05, cz);
  ground.receiveShadow = true;
  scene.add(ground);

  // Soft contact-shadow halo under building
  const haloCanvas = document.createElement("canvas");
  haloCanvas.width = haloCanvas.height = 256;
  const hctx = haloCanvas.getContext("2d");
  const grad = hctx.createRadialGradient(128, 128, 30, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.15)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  hctx.fillStyle = grad;
  hctx.fillRect(0, 0, 256, 256);
  const haloTex = new THREE.CanvasTexture(haloCanvas);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(cx, 0.005, cz);
  scene.add(halo);

  // Subtle grid (very faint)
  const grid = new THREE.GridHelper(220, 110, 0x1c2330, 0x141a22);
  grid.position.set(cx, 0, cz);
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  scene.add(grid);

  // ---------------- Resize ----------------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
