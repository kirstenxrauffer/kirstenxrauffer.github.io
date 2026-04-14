// PetalScene — Three.js scene that renders falling petals into a RGBA render
// target.  The watercolor composite shader samples this RT and composites the
// petals with the same paper grain, Bousseau density, and wet-front reveal
// treatment applied to the hero image.
//
// Usage in the outer render loop:
//   petalScene.update(elapsed, renderer);   // renders to this.rt
//   passUniforms.uPetals.value = petalScene.texture;  // always the live RT

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import petalVert from '../../shaders/petal.vert';
import petalFrag from '../../shaders/petal.frag';
import { buildPetalData, PETAL_PALETTE, MAX_PETALS } from './petal.data';

// Camera — y=22; petals spawn at left edge and drift right, spanning y ∈ [10, 90]
const CAM_FOV  = 50;
const CAM_Z    = 100;
const CAM_Y    = 22;

// Petals wait this many seconds before appearing, then fade in over FADE_IN seconds
const PETAL_DELAY   = 3.5;
const PETAL_FADE_IN = 2.5;

export class PetalScene {
  private scene:          THREE.Scene;
  private camera:         THREE.PerspectiveCamera;
  private mesh:           THREE.InstancedMesh | null = null;
  private paletteTexture: THREE.DataTexture;
  private disposed = false;
  private loaded   = false;

  // Render target — sampled by the watercolor composite as uPetals
  readonly rt: THREE.WebGLRenderTarget;

  // Transparent 1×1 fallback returned by .texture before the GLB is ready
  private readonly fallback: THREE.DataTexture;

  private readonly uniforms: {
    uTime:            { value: number };
    uGlobalAlpha:     { value: number };
    uPalette:         { value: THREE.DataTexture };
    uWindDir:         { value: THREE.Vector2 };
    uWindSpeed:       { value: number };
    uWindGustStrength:{ value: number };
    uWindGustFreq:    { value: number };
    uDespawnX:        { value: number };
    uSpawnX:          { value: number };
  };

  constructor(w: number, h: number) {
    // ── Scene + camera ────────────────────────────────────────────────────────
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, w / h, 1, 500);
    this.camera.position.set(0, CAM_Y, CAM_Z);

    // ── Render target (RGBA, no depth buffer needed for transparent particles) -
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type:          THREE.HalfFloatType,
      format:        THREE.RGBAFormat,
      minFilter:     THREE.LinearFilter,
      magFilter:     THREE.LinearFilter,
      depthBuffer:   false,
      stencilBuffer: false,
      samples:       4,
    });

    // ── 1×1 transparent fallback until GLB loads ──────────────────────────────
    this.fallback = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat,
    );
    this.fallback.needsUpdate = true;

    // ── 8×1 palette DataTexture ───────────────────────────────────────────────
    const palData = new Uint8Array(PETAL_PALETTE.length * 4);
    PETAL_PALETTE.forEach(([r, g, b], i) => {
      palData[i * 4]     = r;
      palData[i * 4 + 1] = g;
      palData[i * 4 + 2] = b;
      palData[i * 4 + 3] = 255;
    });
    this.paletteTexture = new THREE.DataTexture(
      palData, PETAL_PALETTE.length, 1, THREE.RGBAFormat,
    );
    this.paletteTexture.magFilter = THREE.NearestFilter;
    this.paletteTexture.minFilter = THREE.NearestFilter;
    this.paletteTexture.needsUpdate = true;

    // ── Shader uniforms ───────────────────────────────────────────────────────
    this.uniforms = {
      uTime:             { value: 0 },
      uGlobalAlpha:      { value: 0 },
      uPalette:          { value: this.paletteTexture },
      uWindDir:          { value: new THREE.Vector2(1.0, -0.05) },   // rightward, nearly level
      uWindSpeed:        { value: 4.0 },                              // 4.0 × 16s = 64 units; from spawnX≈−32 petals reach right viewport edge (~21.6) at age≈0.84
      uWindGustStrength: { value: 0.3 },
      uWindGustFreq:     { value: 0.1 },
      uDespawnX:         { value: 100 },
      uSpawnX:           { value: -100 },
    };
    this.updateViewport(w, h);

    // ── Load petal GLB (async — mesh added to scene once ready) ───────────────
    const loader = new GLTFLoader();
    loader.loadAsync('/models/petal.glb').then((gltf) => {
      if (this.disposed) return;

      // Find first mesh in the GLB (node name is PetalV2)
      let geometry: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((obj) => {
        if (geometry !== null) return;
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) geometry = mesh.geometry;
      });
      if (!geometry) return;

      const data   = buildPetalData(MAX_PETALS, 137);
      const geo    = (geometry as THREE.BufferGeometry).clone();
      geo.setAttribute('aSpawnPos',
        new THREE.InstancedBufferAttribute(data.spawnPositions, 3));
      geo.setAttribute('aBirthLifeSeedScale',
        new THREE.InstancedBufferAttribute(data.birthLifeSeedScale, 4));
      geo.setAttribute('aColorIndex',
        new THREE.InstancedBufferAttribute(data.colorIndices, 1));

      const mat = new THREE.ShaderMaterial({
        vertexShader:   petalVert,
        fragmentShader: petalFrag,
        uniforms:       this.uniforms,
        transparent:    true,
        depthWrite:     false,
        // CustomBlending with separate alpha factors fixes the RT premultiplied-alpha
        // bug in NormalBlending.  NormalBlending applies blendFunc(SRC_ALPHA,
        // ONE_MINUS_SRC_ALPHA) to all channels, so alpha accumulates as α² instead
        // of α.  blendFuncSeparate here gives:
        //   RGB:   SRC_ALPHA × src + (1-SRC_ALPHA) × dst  → premultiplied color
        //   Alpha: ONE       × src + (1-SRC_ALPHA) × dst  → correct α
        // The composite shader uses the premultiplied formula: C = rgb + (1-a)*C.
        blending:       THREE.CustomBlending,
        blendSrc:       THREE.SrcAlphaFactor,
        blendDst:       THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha:  THREE.OneFactor,
        blendDstAlpha:  THREE.OneMinusSrcAlphaFactor,
        side:           THREE.DoubleSide,
      });

      this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PETALS);
      this.mesh.frustumCulled = false;

      // Identity matrices — all positioning handled in vertex shader
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < MAX_PETALS; i++) {
        this.mesh.setMatrixAt(i, m4.identity());
      }
      this.mesh.instanceMatrix.needsUpdate = true;

      this.scene.add(this.mesh);
      this.loaded = true;
    }).catch(() => {
      // GLB load failed — petals silently absent
    });
  }

  // Compute uSpawnX / uDespawnX from the perspective camera's FOV.
  // Uses midpoint z=74 (dist=26) for z ∈ [72,76]. At 16:9: half-width ≈ 21.6 units.
  // spawnX = 1.5× → −32.4; windSpeed=4.0 travels 64 units over 16s → right edge at age≈0.84.
  // uDespawnX = 1.0× (exact viewport edge) so edgeFade fires at the screen boundary.
  // cycleFade at age 0.97 is a pure safety net for petals that stall (e.g. heavy turbulence).
  private updateViewport(w: number, h: number) {
    const fovRad    = (CAM_FOV * Math.PI) / 180;
    const petalDist = CAM_Z - 74;           // midpoint petal z=74 → 26 units from camera
    const height    = 2 * Math.tan(fovRad / 2) * petalDist;
    const width     = height * (w / h);
    this.uniforms.uSpawnX.value   = -width / 2 * 1.5; // 50% off-screen left
    this.uniforms.uDespawnX.value =  width / 2;        // exactly at right viewport edge — edgeFade starts here
  }

  // Current texture to bind as uPetals in the composite shader
  get texture(): THREE.Texture {
    return this.loaded ? this.rt.texture : this.fallback;
  }

  // Call once per frame before the composite pass
  update(elapsed: number, renderer: THREE.WebGLRenderer): void {
    if (!this.loaded || this.disposed) return;

    // Hold until PETAL_DELAY seconds have passed, then fade in over PETAL_FADE_IN seconds
    const shaderTime = elapsed - PETAL_DELAY;
    if (shaderTime < 0) return;

    // uTime starts at 0 when petals first appear so birth-time offsets are correct
    this.uniforms.uTime.value        = shaderTime;
    this.uniforms.uGlobalAlpha.value = Math.min(1.0, shaderTime / PETAL_FADE_IN);

    // Save and restore clear state so we don't clobber the main canvas's setup
    const savedColor = new THREE.Color();
    renderer.getClearColor(savedColor);
    const savedAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, false, false); // color only — no depth buffer on this RT
    renderer.render(this.scene, this.camera);

    renderer.setClearColor(savedColor, savedAlpha);
    renderer.setRenderTarget(null);
  }

  resize(w: number, h: number): void {
    this.rt.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateViewport(w, h);
  }

  dispose(): void {
    this.disposed = true;
    this.rt.dispose();
    this.fallback.dispose();
    this.paletteTexture.dispose();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }
  }
}
