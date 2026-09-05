import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import passthroughVert from '../../shaders/passthrough.vert';
import warpFrag from '../../shaders/watercolor_warp.frag';
import watercolorBaseFrag from '../../shaders/watercolor_base.frag';
import watercolorFrag from '../../shaders/watercolor.frag';
import blurFrag from '../../shaders/watercolor_blur.frag';
import sourceBlurFrag from '../../shaders/watercolor_source_blur.frag';
import edgeSoftenFrag from '../../shaders/watercolor_edge_soften.frag';
import { N_PRE_BLUR, REVEAL_DURATION, REVEAL_PROGRESS_TARGET, UNIFORM_DEFAULTS } from './constants';
import { pickHeroImage, slugToSeed, extractPalette } from './utils';
import type { WatercolorCanvasProps } from './types';
import { PetalScene } from '../petals/petal.scene';
import styles from './WatercolorCanvas.module.scss';

export default function WatercolorCanvas({
  slug = '',
  bloomOrigin = [0.5, 0.5],
  image,
  onRevealStart,
  onPalette,
}: WatercolorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onRevealStartRef = useRef(onRevealStart);
  onRevealStartRef.current = onRevealStart;
  const onPaletteRef = useRef(onPalette);
  onPaletteRef.current = onPalette;

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    // Paper texture — ambientCG Paper006 displacement (CC0, tileable).
    // WebP re-encode of the original 2.6 MB JPEG; see index.html preload.
    const paperTex = texLoader.load('/textures/paper.webp');
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

    // Gaussian source softener — one-shot pass before the Kuwahara chain.
    // Smooths source-pixel quantization so Kuwahara sector means don't
    // stair-step on high-contrast silhouettes on high-DPI displays.
    const sourceBlurUniforms = {
      uColor:      { value: paperTex as THREE.Texture },
      uResolution: { value: new THREE.Vector2(w, h) },
    };
    const sourceBlurMat = new THREE.ShaderMaterial({
      vertexShader:   passthroughVert,
      fragmentShader: sourceBlurFrag,
      uniforms:       sourceBlurUniforms,
      depthWrite:     false,
      depthTest:      false,
    });
    const sourceBlurScene = new THREE.Scene();
    sourceBlurScene.add(new THREE.Mesh(quadGeo, sourceBlurMat));

    // Post-Kuwahara edge softener — gradient-gated Gaussian that runs once
    // after the Kuwahara chain, specifically to undo the hard-edge snap the
    // variance-weighted sector filter produces on high-contrast silhouettes.
    const edgeSoftenUniforms = {
      uColor:      { value: paperTex as THREE.Texture },
      uResolution: { value: new THREE.Vector2(w, h) },
    };
    const edgeSoftenMat = new THREE.ShaderMaterial({
      vertexShader:   passthroughVert,
      fragmentShader: edgeSoftenFrag,
      uniforms:       edgeSoftenUniforms,
      depthWrite:     false,
      depthTest:      false,
    });
    const edgeSoftenScene = new THREE.Scene();
    edgeSoftenScene.add(new THREE.Mesh(quadGeo, edgeSoftenMat));

    const D = UNIFORM_DEFAULTS;

    // ---- Pass B1 — static painterly bake ----------------------------------
    // Everything watercolor_base.frag reads is frozen once the pre-blur chain
    // has run, so this renders on image load and on resize instead of every
    // frame. It carries the 289-tap Kuwahara filter that used to dominate the
    // per-frame cost.
    //
    // Sized to the canvas drawing buffer (device pixels), not the CSS viewport,
    // so the bake keeps the same detail the per-frame version produced and the
    // composite reads it 1:1 with no resampling. uResolution stays in CSS
    // pixels — the shader uses it purely as the scale that puts the Kuwahara
    // radius in CSS-pixel units.
    const dbSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    const baseRT = new THREE.WebGLRenderTarget(dbSize.x, dbSize.y, rtSpec);

    const baseUniforms = {
      uColor:          { value: paperTex as THREE.Texture },
      uWarp:           { value: warpRT.texture },
      uPaper:          { value: paperTex },
      uResolution:     { value: new THREE.Vector2(w, h) },
      uImageAspect:    { value: 1.0 },
      uDensityWeights: { value: new THREE.Vector4(...D.densityWeights) },
      uAbstraction:    { value: D.abstraction },
      uBlotchiness:    { value: D.blotchiness },
      uWobbleStrength: { value: D.wobbleStrength },
      uWarpDisplace:   { value: D.warpDisplace },
    };
    const baseMat = new THREE.ShaderMaterial({
      vertexShader:   passthroughVert,
      fragmentShader: watercolorBaseFrag,
      uniforms:       baseUniforms,
      depthWrite:     false,
      depthTest:      false,
    });
    const baseScene = new THREE.Scene();
    baseScene.add(new THREE.Mesh(quadGeo, baseMat));

    const renderBase = () => {
      renderer.setRenderTarget(baseRT);
      renderer.render(baseScene, camera);
      renderer.setRenderTarget(null);
    };

    // ---- Pass B2 — per-frame composite uniforms ---------------------------
    const passUniforms = {
      uBase:           { value: baseRT.texture },
      uWarp:           { value: warpRT.texture },
      uPaper:          { value: paperTex },
      uProgress:       { value: 0 },
      uResolution:     { value: new THREE.Vector2(w, h) },
      uBloomSeed:      { value: slugToSeed(slug) },
      uBloomOrigin:    { value: new THREE.Vector2(...bloomOrigin) },
      uWarpInfluence:  { value: D.warpInfluence },
      uRevealSpread:   { value: D.revealSpread },
      uRingHalfwidth:  { value: D.ringHalfwidth },
      uRingStrength:   { value: D.ringStrength },
      uDensityWeights: { value: new THREE.Vector4(...D.densityWeights) },
      uFiberStrength:  { value: D.fiberStrength },
      uFiberScale:     { value: D.fiberScale },
      uClearProgress:  { value: 0 },
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

    // Notify immediately so the section animation starts on page paint,
    // not after the potentially slow hero image load.
    onRevealStartRef.current?.();

    // ---- GSAP reveal tween ------------------------------------------------
    let tweenStarted = false;
    const startRevealTween = () => {
      if (tweenStarted || disposed) return;
      tweenStarted = true;
      gsap.to(progressObj, {
        value: REVEAL_PROGRESS_TARGET,
        duration: REVEAL_DURATION,
        delay: 0.5,  // brief beat after page paint before the reveal begins
        ease: 'power2.out',
        onUpdate: () => { passUniforms.uProgress.value = progressObj.value; },
        // Petals begin only after the full reveal animation lands. Triggering
        // from onComplete (rather than a hard-coded offset) means future tuning
        // of REVEAL_DURATION / clear-bloom timing automatically carries through.
        onComplete: () => { if (!disposed) petalScene.start(getElapsed()); },
      });
    };

    // ---- Clear-zone bloom -------------------------------------------------
    // The center white blotch + pigment ring bloom on page load. Runs in
    // parallel with the reveal tween — the legibility area still establishes
    // over 4s while the image reveal starts immediately, so the page doesn't
    // sit blank for the full pre-reveal window. Reveal duration is unchanged.
    const clearObj = { value: 0 };
    gsap.to(clearObj, {
      value: 1.0,
      duration: 4,
      ease: 'power2.out',
      onUpdate: () => { passUniforms.uClearProgress.value = clearObj.value; },
    });
    startRevealTween();

    const colorTex = texLoader.load(
      image ?? pickHeroImage(),
      (tex) => {
        if (disposed) return;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        baseUniforms.uImageAspect.value = tex.image.width / tex.image.height;

        const snapTime = getElapsed();
        warpUniforms.uTime.value = snapTime;
        renderer.setRenderTarget(warpRT);
        renderer.render(warpScene, camera);
        renderer.setRenderTarget(null);
        frozenTime = snapTime;

        // Pass 0: Gaussian softener → preBlurRTs[0]
        sourceBlurUniforms.uColor.value = tex;
        renderer.setRenderTarget(preBlurRTs[0]);
        renderer.render(sourceBlurScene, camera);
        let src: THREE.Texture = preBlurRTs[0].texture;

        // Passes 1..N_PRE_BLUR: Kuwahara ping-pong, offset so first write
        // lands in slot 1 (not the Gaussian output we're reading from).
        for (let i = 0; i < N_PRE_BLUR; i++) {
          const dst = preBlurRTs[(i + 1) % 2];
          blurUniforms.uColor.value = src;
          renderer.setRenderTarget(dst);
          renderer.render(blurScene, camera);
          src = dst.texture;
        }

        // Final pass: gradient-gated edge softener. Writes to the opposite
        // preBlur slot from the one we just read.
        const softenDst = preBlurRTs[(N_PRE_BLUR + 1) % 2];
        edgeSoftenUniforms.uColor.value = src;
        renderer.setRenderTarget(softenDst);
        renderer.render(edgeSoftenScene, camera);
        src = softenDst.texture;

        renderer.setRenderTarget(null);

        // Hand the pre-blurred image to the bake and queue it. The bake runs
        // from the render loop rather than here so it is guaranteed to happen
        // after the warp pass above has landed in warpRT.
        baseUniforms.uColor.value = src;
        baseNeedsBake = true;

        // Extract palette from the raw image and surface it to the parent
        const palette = extractPalette(tex.image as HTMLImageElement | ImageBitmap, 4);
        if (palette.length) onPaletteRef.current?.(palette);
      },
    );

    // ---- Render loop -------------------------------------------------------
    let warpFrozen = false;
    let paused = document.hidden;
    // Drives the static bake. Set on the first frame, when the hero image is
    // ready, and after a resize — never per frame.
    let baseNeedsBake = true;

    const render = () => {
      if (disposed) return;
      if (paused) return;
      animFrameId = requestAnimationFrame(render);

      const elapsed = getElapsed();
      if (progressObj.value >= 1.0 && frozenTime === null) frozenTime = elapsed;
      const t = frozenTime ?? elapsed;

      warpUniforms.uTime.value = t;

      // Warp pass — skip once frozen (output is static from this point on)
      if (!warpFrozen) {
        renderer.setRenderTarget(warpRT);
        renderer.render(warpScene, camera);
        if (frozenTime !== null) warpFrozen = true;
      }

      // Static painterly bake (Pass B1) — runs only when its inputs change.
      // Between the first frame and the hero image landing, the bake is one
      // frame's warp field behind. That window is invisible: the reveal tween
      // has a 0.5 s delay and eases to 0.65 over 15 s, so the revealed disc is
      // under ~0.05 in UV radius for the first second, and the clear zone masks
      // its centre — almost none of the baked colour is on screen yet. Once the
      // image loads the warp freezes and the bake is exact from then on.
      if (baseNeedsBake) {
        renderBase();
        baseNeedsBake = false;
      }

      // Petal pass — renders to petalScene.rt; continues animating after freeze
      petalScene.update(elapsed, renderer);
      passUniforms.uPetals.value = petalScene.texture;

      renderer.setRenderTarget(null);
      renderer.render(passScene, camera);
    };
    render();

    // ---- Resize -----------------------------------------------------------
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        if (disposed) return;
        const rw = window.innerWidth;
        const rh = window.innerHeight;

        // Resize renderer and all render targets
        renderer.setSize(rw, rh, false);
        warpRT.setSize(Math.floor(rw / 2), Math.floor(rh / 2));
        preBlurRTs[0].setSize(rw, rh);
        preBlurRTs[1].setSize(rw, rh);

        // The bake target tracks the canvas drawing buffer, so re-read it after
        // setSize rather than assuming a pixel ratio.
        renderer.getDrawingBufferSize(dbSize);
        baseRT.setSize(dbSize.x, dbSize.y);

        // Update resolution uniforms
        warpUniforms.uResolution.value.set(rw, rh);
        passUniforms.uResolution.value.set(rw, rh);
        baseUniforms.uResolution.value.set(rw, rh);
        blurUniforms.uResolution.value.set(rw, rh);
        sourceBlurUniforms.uResolution.value.set(rw, rh);
        edgeSoftenUniforms.uResolution.value.set(rw, rh);
        petalScene.resize(rw, rh);

        // warpRT was cleared by setSize — re-render it at the same frozen time.
        // When warpFrozen is true the render loop skips this pass, so we must
        // do a one-shot render here.
        const t = frozenTime ?? getElapsed();
        warpUniforms.uTime.value = t;
        renderer.setRenderTarget(warpRT);
        renderer.render(warpScene, camera);
        renderer.setRenderTarget(null);

        // If the hero image has already loaded, re-run the blur pre-pass at the
        // new resolution and update the composite pass source texture.
        if (colorTex.image) {
          sourceBlurUniforms.uColor.value = colorTex;
          renderer.setRenderTarget(preBlurRTs[0]);
          renderer.render(sourceBlurScene, camera);
          let src: THREE.Texture = preBlurRTs[0].texture;

          for (let i = 0; i < N_PRE_BLUR; i++) {
            const dst = preBlurRTs[(i + 1) % 2];
            blurUniforms.uColor.value = src;
            renderer.setRenderTarget(dst);
            renderer.render(blurScene, camera);
            src = dst.texture;
          }

          const softenDst = preBlurRTs[(N_PRE_BLUR + 1) % 2];
          edgeSoftenUniforms.uColor.value = src;
          renderer.setRenderTarget(softenDst);
          renderer.render(edgeSoftenScene, camera);
          src = softenDst.texture;

          renderer.setRenderTarget(null);
          baseUniforms.uColor.value = src;
        }

        // Re-bake unconditionally: warpRT and baseRT were both reallocated
        // above, so the existing bake is stale (and baseRT's contents are
        // undefined) whether or not the hero image has loaded yet.
        baseNeedsBake = true;
      }, 150);
    };
    window.addEventListener('resize', onResize);

    // Pause the render loop when the tab is backgrounded — saves GPU/CPU
    // on inactive tabs. Resume by kicking off a fresh rAF on return.
    const onVisibility = () => {
      if (disposed) return;
      if (document.hidden) {
        paused = true;
        cancelAnimationFrame(animFrameId);
      } else if (paused) {
        paused = false;
        render();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---- Cleanup ----------------------------------------------------------
    return () => {
      disposed = true;
      cancelAnimationFrame(animFrameId);
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      gsap.killTweensOf(progressObj);
      gsap.killTweensOf(clearObj);

      warpRT.dispose();
      baseRT.dispose();
      preBlurRTs[0].dispose();
      preBlurRTs[1].dispose();
      warpMat.dispose();
      blurMat.dispose();
      sourceBlurMat.dispose();
      edgeSoftenMat.dispose();
      baseMat.dispose();
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
