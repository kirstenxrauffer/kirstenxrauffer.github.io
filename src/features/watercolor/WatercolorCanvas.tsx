import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import passthroughVert from '../../shaders/passthrough.vert';
import warpFrag from '../../shaders/watercolor_warp.frag';
import watercolorFrag from '../../shaders/watercolor.frag';
import blurFrag from '../../shaders/watercolor_blur.frag';
import { N_PRE_BLUR, REVEAL_DURATION, REVEAL_PROGRESS_TARGET, UNIFORM_DEFAULTS } from './constants';
import { pickHeroImage, slugToSeed } from './utils';
import type { WatercolorCanvasProps } from './types';
import { PetalScene } from '../petals/petal.scene';
import styles from './WatercolorCanvas.module.scss';

export default function WatercolorCanvas({
  slug = '',
  bloomOrigin = [0.5, 0.5],
  image,
}: WatercolorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animFrameId = 0;
    let disposed = false;
    const progressObj = { value: 0 };
    let frozenTime: number | null = null;

    // ---- Renderer ---------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    // ---- Shared fullscreen quad + ortho camera ----------------------------
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const camera  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const w = window.innerWidth;
    const h = window.innerHeight;

    // ---- Petal scene (renders to its own RGBA RT, composited in Pass B) ---
    const petalScene = new PetalScene(w, h);

    // ---- Pass A — half-res warp RT ----------------------------------------
    const warpRT = new THREE.WebGLRenderTarget(Math.floor(w / 2), Math.floor(h / 2), {
      type:          THREE.HalfFloatType,
      format:        THREE.RGBAFormat,
      minFilter:     THREE.LinearFilter,
      magFilter:     THREE.LinearFilter,
      depthBuffer:   false,
      stencilBuffer: false,
    });

    const warpUniforms = {
      uTime:       { value: 0 },
      uResolution: { value: new THREE.Vector2(w, h) },
    };
    const warpMat = new THREE.ShaderMaterial({
      vertexShader:   passthroughVert,
      fragmentShader: warpFrag,
      uniforms:       warpUniforms,
      depthWrite:     false,
      depthTest:      false,
    });
    const warpScene = new THREE.Scene();
    warpScene.add(new THREE.Mesh(quadGeo, warpMat));

    // ---- Textures ---------------------------------------------------------
    const texLoader = new THREE.TextureLoader();

    // Paper texture — ambientCG Paper006 displacement (CC0, tileable)
    const paperTex = texLoader.load('/textures/paper.jpg');
    paperTex.wrapS     = THREE.RepeatWrapping;
    paperTex.wrapT     = THREE.RepeatWrapping;
    paperTex.minFilter = THREE.LinearMipmapLinearFilter;
    paperTex.magFilter = THREE.LinearFilter;

    // ---- Pre-blur ping-pong RTs -------------------------------------------
    // Two full-res HalfFloat RTs. The hero image is ping-ponged through the
    // Kuwahara blur shader N_PRE_BLUR times before the reveal starts.
    const rtSpec = {
      type:          THREE.HalfFloatType as THREE.TextureDataType,
      format:        THREE.RGBAFormat,
      minFilter:     THREE.LinearFilter as THREE.MinificationTextureFilter,
      magFilter:     THREE.LinearFilter as THREE.MagnificationTextureFilter,
      depthBuffer:   false,
      stencilBuffer: false,
    };
    const preBlurRTs = [
      new THREE.WebGLRenderTarget(w, h, rtSpec),
      new THREE.WebGLRenderTarget(w, h, rtSpec),
    ];

    const blurUniforms = {
      uColor:      { value: paperTex as THREE.Texture },
      uPaper:      { value: paperTex },
      uResolution: { value: new THREE.Vector2(w, h) },
    };
    const blurMat = new THREE.ShaderMaterial({
      vertexShader:   passthroughVert,
      fragmentShader: blurFrag,
      uniforms:       blurUniforms,
      depthWrite:     false,
      depthTest:      false,
    });
    const blurScene = new THREE.Scene();
    blurScene.add(new THREE.Mesh(quadGeo, blurMat));

    // ---- Pass B — composite uniforms --------------------------------------
    const D = UNIFORM_DEFAULTS;
    const passUniforms = {
      uColor:          { value: paperTex as THREE.Texture },
      uWarp:           { value: warpRT.texture },
      uPaper:          { value: paperTex },
      uTime:           { value: 0 },
      uProgress:       { value: 0 },
      uResolution:     { value: new THREE.Vector2(w, h) },
      uBloomSeed:      { value: slugToSeed(slug) },
      uBloomOrigin:    { value: new THREE.Vector2(...bloomOrigin) },
      uImageAspect:    { value: 1.0 },
      uWarpInfluence:  { value: D.warpInfluence },
      uRevealSpread:   { value: D.revealSpread },
      uRingHalfwidth:  { value: D.ringHalfwidth },
      uRingStrength:   { value: D.ringStrength },
      uDensityWeights: { value: new THREE.Vector4(...D.densityWeights) },
      uBeta:           { value: D.beta },
      uFiberStrength:  { value: D.fiberStrength },
      uFiberScale:     { value: D.fiberScale },
      uAbstraction:    { value: D.abstraction },
      uBlotchiness:    { value: D.blotchiness },
      uWobbleStrength: { value: D.wobbleStrength },
      uWarpDisplace:   { value: D.warpDisplace },
      uPetals:         { value: petalScene.texture },
    };

    const passMat = new THREE.ShaderMaterial({
      vertexShader:   passthroughVert,
      fragmentShader: watercolorFrag,
      uniforms:       passUniforms,
      depthWrite:     false,
      depthTest:      false,
    });
    const passScene = new THREE.Scene();
    passScene.add(new THREE.Mesh(quadGeo, passMat));

    // ---- Elapsed time — declared before hero load so the onLoad callback can use it
    const startTime = performance.now();
    const getElapsed = () => (performance.now() - startTime) / 1000;

    // ---- GSAP reveal tween ------------------------------------------------
    let tweenStarted = false;
    const startRevealTween = () => {
      if (tweenStarted || disposed) return;
      tweenStarted = true;
      gsap.to(progressObj, {
        value: REVEAL_PROGRESS_TARGET,
        duration: REVEAL_DURATION,
        ease: 'power2.out',
        onUpdate: () => { passUniforms.uProgress.value = progressObj.value; },
      });
    };

    // ---- Hero image load --------------------------------------------------
    // 1. Snapshot and freeze the warp field — no animated swimming during reveal.
    // 2. Run N_PRE_BLUR Kuwahara passes (sync GPU commands) into ping-pong RTs.
    // 3. Plug the final blurred texture into passUniforms.uColor.
    // 4. Start the reveal tween.
    const colorTex = texLoader.load(
      image ?? pickHeroImage(),
      (tex) => {
        if (disposed) return;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        passUniforms.uImageAspect.value = tex.image.width / tex.image.height;

        const snapTime = getElapsed();
        warpUniforms.uTime.value = snapTime;
        renderer.setRenderTarget(warpRT);
        renderer.render(warpScene, camera);
        renderer.setRenderTarget(null);
        frozenTime = snapTime;

        let src: THREE.Texture = tex;
        for (let i = 0; i < N_PRE_BLUR; i++) {
          const dst = preBlurRTs[i % 2];
          blurUniforms.uColor.value = src;
          renderer.setRenderTarget(dst);
          renderer.render(blurScene, camera);
          src = dst.texture;
        }
        renderer.setRenderTarget(null);

        passUniforms.uColor.value = src;
        startRevealTween();
      },
    );

    // ---- Render loop -------------------------------------------------------
    let warpFrozen = false;

    const render = () => {
      if (disposed) return;
      animFrameId = requestAnimationFrame(render);

      const elapsed = getElapsed();
      if (progressObj.value >= 1.0 && frozenTime === null) frozenTime = elapsed;
      const t = frozenTime ?? elapsed;

      warpUniforms.uTime.value = t;
      passUniforms.uTime.value = t;

      // Warp pass — skip once frozen (output is static from this point on)
      if (!warpFrozen) {
        renderer.setRenderTarget(warpRT);
        renderer.render(warpScene, camera);
        if (frozenTime !== null) warpFrozen = true;
      }

      // Petal pass — renders to petalScene.rt; continues animating after freeze
      petalScene.update(elapsed, renderer);
      passUniforms.uPetals.value = petalScene.texture;

      renderer.setRenderTarget(null);
      renderer.render(passScene, camera);
    };
    render();

    // ---- Resize -----------------------------------------------------------
    const onResize = () => {
      if (disposed) return;
      const rw = window.innerWidth;
      const rh = window.innerHeight;
      renderer.setSize(rw, rh, false);
      warpRT.setSize(Math.floor(rw / 2), Math.floor(rh / 2));
      warpUniforms.uResolution.value.set(rw, rh);
      passUniforms.uResolution.value.set(rw, rh);
      blurUniforms.uResolution.value.set(rw, rh);
      petalScene.resize(rw, rh);
    };
    window.addEventListener('resize', onResize);

    // ---- Cleanup ----------------------------------------------------------
    return () => {
      disposed = true;
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', onResize);
      gsap.killTweensOf(progressObj);

      warpRT.dispose();
      preBlurRTs[0].dispose();
      preBlurRTs[1].dispose();
      warpMat.dispose();
      blurMat.dispose();
      passMat.dispose();
      quadGeo.dispose();
      colorTex.dispose();
      paperTex.dispose();
      petalScene.dispose();
      renderer.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles['watercolor-wrapper']} aria-hidden="true">
      <canvas
        ref={canvasRef}
        className={styles['watercolor-canvas']}
      />
    </div>
  );
}
