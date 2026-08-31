import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import passthroughVert from '../../shaders/passthrough.vert';
import asciiFrag from '../../shaders/ascii.frag';
import { buildFontAtlas, buildWordTexture } from './fontAtlas';
import { buildSemanticPaletteTexture, NEILL_OVERSTRIKE_CHAR_IDX } from './semanticPalette';
import { pickHeroImage } from '../watercolor/utils';
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  DENSITY_SIZE,
  EDGE_OFFSET,
  TEXTURE_OFFSET,
  EASTER_EGG_WORDS,
  WORD_MAX_LEN,
  ASCII_DEFAULTS,
} from './constants';
import type { AsciiCanvasProps } from './types';

// ── Semantic-mode URL params ──────────────────────────────────────────────
// ?semantic=1       enables HSV content-aware character selection
// ?neill=1          enables Neill (1982) 'M' overstrike at darkness > 0.85
// ?categoryDebug=1  tints each cell by its assigned HSV category
// All default OFF — no regression for users loading the page normally.
function readUrlFlags() {
  if (typeof window === 'undefined') {
    return { semantic: false, neill: false, categoryDebug: false };
  }
  const p = new URLSearchParams(window.location.search);
  return {
    semantic:      p.get('semantic')      === '1',
    neill:         p.get('neill')         === '1',
    categoryDebug: p.get('categoryDebug') === '1',
  };
}

// Slider config: [label, uniform key, min, max, step, default]
const SLIDERS: [string, string, number, number, number, number][] = [
  ['Cell Size',       'uCellSize',        2,   20,  0.5, ASCII_DEFAULTS.cellSize],
  ['Tolerance',       'uTolerance',       0,    1,  0.01, ASCII_DEFAULTS.tolerance],
  ['Edge Threshold',  'uEdgeThreshold',   0.001, 2.0, 0.001, 1.0],
  ['Edge Multiplier', 'uEdgeMult',        0.5,  5,  0.1, 1.5],
  ['Ink Darkness',    'uInkDarkness',     0,    1,  0.01, 0.85],
  ['Tonal Base',      'uTonalStrength',   0,    2,  0.01, 0.4],
  ['Fill Layers',     'uFillMaxLayers',   1,   12,  1,   4],
  ['Layer Opacity',   'uFillLayerAlpha',  0.05, 0.5, 0.01, 0.30],
  ['Scramble Dur.',   'uScrambleDuration', 0.5, 8,  0.5, ASCII_DEFAULTS.scrambleDuration],
];

export default function AsciiCanvas({
  image,
  cellSize         = ASCII_DEFAULTS.cellSize,
  tolerance        = ASCII_DEFAULTS.tolerance,
  scrambleDuration = ASCII_DEFAULTS.scrambleDuration,
  overlay          = false,
}: AsciiCanvasProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const uniformsRef = useRef<Record<string, { value: unknown }> | null>(null);

  const [imageName, setImageName] = useState('');
  const [debugEdges, setDebugEdges] = useState(false);
  const urlFlagsRef = useRef(readUrlFlags());
  const [semanticMode,  setSemanticMode]  = useState(urlFlagsRef.current.semantic);
  const [neillMode,     setNeillMode]     = useState(urlFlagsRef.current.neill);
  const [categoryDebug, setCategoryDebug] = useState(urlFlagsRef.current.categoryDebug);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {};
    for (const [, key, , , , def] of SLIDERS) v[key] = def;
    // Override with props
    v.uCellSize = cellSize;
    v.uTolerance = tolerance;
    v.uScrambleDuration = scrambleDuration;
    return v;
  });

  // Push slider changes to uniforms without re-creating the GL context
  const handleSlider = useCallback((key: string, val: number) => {
    setSliderValues(prev => ({ ...prev, [key]: val }));
    const u = uniformsRef.current;
    if (u && u[key]) u[key].value = val;
  }, []);

  // Push debug toggle
  useEffect(() => {
    const u = uniformsRef.current;
    if (u && u.uDebugEdges) u.uDebugEdges.value = debugEdges ? 1.0 : 0.0;
  }, [debugEdges]);

  // Push semantic-pipeline toggles (hot-swap; no GL rebuild needed)
  useEffect(() => {
    const u = uniformsRef.current;
    if (!u) return;
    if (u.uSemanticMode)    u.uSemanticMode.value    = semanticMode  ? 1.0 : 0.0;
    if (u.uNeillOverstrike) u.uNeillOverstrike.value = neillMode     ? 1.0 : 0.0;
    if (u.uCategoryDebug)   u.uCategoryDebug.value   = categoryDebug ? 1.0 : 0.0;
  }, [semanticMode, neillMode, categoryDebug]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animFrameId = 0;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({
      canvas, alpha: overlay, antialias: false, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (overlay) {
      // Clear to fully transparent so the watercolor (or whatever is behind
      // this canvas) shows through in regions the shader emits alpha 0.
      renderer.setClearColor(0x000000, 0);
    }

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const camera  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const atlasTex = buildFontAtlas();
    const { texture: wordTex,     width: wordTexWidth     } = buildWordTexture();
    const { texture: semanticTex, width: semanticTexWidth } = buildSemanticPaletteTexture();

    const w = window.innerWidth;
    const h = window.innerHeight;

    const placeholderData = new Uint8Array([255, 255, 255, 255]);
    const placeholderTex = new THREE.DataTexture(placeholderData, 1, 1, THREE.RGBAFormat);
    placeholderTex.needsUpdate = true;

    let imageLoaded = false;
    const uniforms: Record<string, { value: unknown }> = {
      uImage:           { value: placeholderTex },
      uAtlas:           { value: atlasTex },
      uWordTex:         { value: wordTex },
      uResolution:      { value: new THREE.Vector2(w, h) },
      uTime:            { value: 0 },
      uCellSize:        { value: sliderValues.uCellSize },
      uTolerance:       { value: sliderValues.uTolerance },
      uScrambleDuration:{ value: sliderValues.uScrambleDuration },
      uAtlasGrid:       { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      uRampSize:        { value: DENSITY_SIZE },
      uEdgeOffset:      { value: EDGE_OFFSET },
      uTextureOffset:   { value: TEXTURE_OFFSET },
      uEdgeThreshold:   { value: sliderValues.uEdgeThreshold },
      uEdgeMult:        { value: sliderValues.uEdgeMult },
      uInkDarkness:     { value: sliderValues.uInkDarkness },
      uTonalStrength:   { value: sliderValues.uTonalStrength },
      uFillMaxLayers:   { value: sliderValues.uFillMaxLayers },
      uFillLayerAlpha:  { value: sliderValues.uFillLayerAlpha },
      uDebugEdges:      { value: debugEdges ? 1.0 : 0.0 },
      uTransparent:     { value: overlay ? 1.0 : 0.0 },
      uWordCount:       { value: EASTER_EGG_WORDS.length },
      uWordMaxLen:      { value: WORD_MAX_LEN },
      uWordTexWidth:    { value: wordTexWidth },
      // Hero-image aspect — drives cover-fit UV sampling so ASCII edges
      // align with the watercolor underneath. Updated when the texture loads.
      uImageAspect:     { value: 1.0 },
      // Center clear-zone (matches WatercolorCanvas defaults so the ASCII
      // alpha gate sits on top of the watercolor's paper-white blotch).
      uBloomOrigin:     { value: new THREE.Vector2(0.5, 0.5) },
      uClearProgress:   { value: 0 },
      // Semantic (content-aware) character selection — MVP 6 categories.
      uSemanticPalette:  { value: semanticTex },
      uSemanticTexWidth: { value: semanticTexWidth },
      uSemanticMode:     { value: urlFlagsRef.current.semantic      ? 1.0 : 0.0 },
      uNeillOverstrike:  { value: urlFlagsRef.current.neill         ? 1.0 : 0.0 },
      uNeillCharIdx:     { value: NEILL_OVERSTRIKE_CHAR_IDX },
      uCategoryDebug:    { value: urlFlagsRef.current.categoryDebug ? 1.0 : 0.0 },
    };
    uniformsRef.current = uniforms;

    const material = new THREE.ShaderMaterial({
      vertexShader: passthroughVert,
      fragmentShader: asciiFrag,
      uniforms: uniforms as THREE.ShaderMaterial['uniforms'],
      depthWrite: false,
      depthTest: false,
      transparent: overlay,
    });

    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(quadGeo, material));

    const texLoader = new THREE.TextureLoader();
    const chosenImage = image ?? pickHeroImage();
    setImageName(chosenImage);
    texLoader.load(chosenImage, (tex) => {
      if (disposed) return;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      uniforms.uImage.value = tex;
      uniforms.uImageAspect.value = tex.image.width / tex.image.height;
      imageLoaded = true;
    });

    // Clear-zone bloom — animated 0→1 over 4s with power2.out, matching
    // WatercolorCanvas exactly so the ASCII alpha gate appears in lock-step
    // with the watercolor's center paper-white legibility blotch.
    const clearObj = { value: 0 };
    gsap.to(clearObj, {
      value: 1.0,
      duration: 4,
      ease: 'power2.out',
      onUpdate: () => { uniforms.uClearProgress.value = clearObj.value; },
    });

    const startTime = performance.now();
    let paused = document.hidden;

    const render = () => {
      if (disposed) return;
      if (paused) { animFrameId = requestAnimationFrame(render); return; }
      animFrameId = requestAnimationFrame(render);
      if (!imageLoaded) return;
      uniforms.uTime.value = (performance.now() - startTime) / 1000;
      renderer.render(scene, camera);
    };
    render();

    const onVisibility = () => { paused = document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        if (disposed) return;
        const rw = window.innerWidth;
        const rh = window.innerHeight;
        renderer.setSize(rw, rh, false);
        (uniforms.uResolution.value as THREE.Vector2).set(rw, rh);
      }, 100);
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      uniformsRef.current = null;
      cancelAnimationFrame(animFrameId);
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      gsap.killTweensOf(clearObj);
      renderer.dispose();
      quadGeo.dispose();
      material.dispose();
      atlasTex.dispose();
      wordTex.dispose();
      semanticTex.dispose();
      placeholderTex.dispose();
    };
  // Only rebuild GL context on image change — sliders mutate uniforms directly
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          display: 'block',
          zIndex: 0,
          pointerEvents: overlay ? 'none' : 'auto',
        }}
      />

      {/* Debug panel + image label are dev/standalone affordances and are
          suppressed in overlay mode so the homepage stays clean. */}
      {!overlay && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 12,
              right: 12,
              background: 'rgba(0,0,0,0.85)',
              color: '#fff',
              padding: '12px 16px',
              fontFamily: 'monospace',
              fontSize: 12,
              borderRadius: 6,
              zIndex: 2,
              minWidth: 240,
              userSelect: 'none',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>ASCII Debug</div>

            {SLIDERS.map(([label, key, min, max, step]) => (
              <div key={key} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{label}</span>
                  <span style={{ color: '#ffa' }}>{sliderValues[key]?.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 1)}</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={sliderValues[key] ?? min}
                  onChange={e => handleSlider(key, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#f44' }}
                />
              </div>
            ))}

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={debugEdges}
                onChange={e => setDebugEdges(e.target.checked)}
              />
              Show raw edge map
            </label>

            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #444' }}>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12 }}>Semantic (v2)</div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={semanticMode}
                  onChange={e => setSemanticMode(e.target.checked)}
                />
                HSV semantic mode
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={neillMode}
                  onChange={e => setNeillMode(e.target.checked)}
                />
                Neill 'M' overstrike
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={categoryDebug}
                  onChange={e => setCategoryDebug(e.target.checked)}
                />
                Category debug tint
              </label>
            </div>
          </div>

          {imageName && (
            <div
              style={{
                position: 'fixed',
                bottom: 12,
                left: 12,
                background: '#cc0000',
                color: '#fff',
                padding: '4px 10px',
                fontFamily: 'monospace',
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 3,
                zIndex: 2,
                pointerEvents: 'none',
              }}
            >
              {imageName}
            </div>
          )}
        </>
      )}
    </>
  );
}
