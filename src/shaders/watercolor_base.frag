// watercolor_base.frag  —  Pass B1 (static painterly bake)
//
// Split out of watercolor.frag. Every input this shader reads is frozen once
// the hero image has finished its pre-blur chain:
//
//   uColor  — final pre-blur RT, written once on load / resize
//   uWarp   — Pass A warp RT, frozen at image load (see WatercolorCanvas:
//             frozenTime is set in the texture onLoad callback, after which
//             the render loop skips the warp pass entirely)
//   uPaper  — static texture
//
// and every uniform below is a constant from UNIFORM_DEFAULTS. Nothing here
// depends on uProgress, uClearProgress or elapsed time, so the result is
// identical on every frame.
//
// It used to run per-frame as steps 1–7 of the composite's main(), which meant
// re-evaluating a 289-tap generalized Kuwahara filter (samplePainterly) for
// every pixel, 60 times a second, to produce the same image each time. It now
// renders once into a render target that the composite samples in a single tap.
//
// Output: the painted colour C as it stood at the end of the old step 7.
//
// Paper texture: ambientCG Paper006 displacement map (CC0)
//   Credit: ambientcg.com/view?id=Paper006

precision highp float;

varying vec2 vUv;

// --- Uniforms ---------------------------------------------------------------
uniform sampler2D uColor;      // pre-blurred hero image
uniform sampler2D uWarp;       // Pass A RGBA16F render target (half-res)
uniform sampler2D uPaper;      // CC0 cold-pressed paper displacement
// CSS-pixel viewport size — deliberately NOT the render-target size. The
// Kuwahara radius and the edge-darkening step are both expressed as
// `coverScale / uResolution`, so feeding the CSS size keeps those offsets in
// CSS pixels exactly as the old per-frame version computed them. The target
// itself is allocated at the canvas drawing-buffer size so the bake carries
// full device-pixel detail.
uniform vec2      uResolution;
uniform float     uImageAspect;    // hero image width / height — cover-fit UV

uniform vec4      uDensityWeights; // (paper, flow, disp, edge) weights
uniform float     uAbstraction;    // painterly blur radius in pixels
uniform float     uBlotchiness;    // Kuwahara sector sharpness
uniform float     uWobbleStrength; // paper-gradient UV wobble amplitude
uniform float     uWarpDisplace;   // fBm warp UV offset

// --- Constants --------------------------------------------------------------
const float EDGE_EXP   = 6.0;
const float PAPER_TILE = 3.0;

// ---------------------------------------------------------------------------
// CMYK ↔ RGB conversion
// From "Graphics Shaders" via mattdesl / Shadertoy mdlXW2.
// Blurring in CMYK gives better saturation bleed — colors spread like real
// ink instead of washing out to grey as they would in RGB.
// ---------------------------------------------------------------------------
vec4 RGBtoCMYK(vec3 rgb) {
    float k = min(1.0 - rgb.r, min(1.0 - rgb.g, 1.0 - rgb.b));
    vec3 cmy = vec3(0.0);
    float invK = 1.0 - k;
    if (invK > 0.001) {
        cmy = (1.0 - rgb - k) / invK;
    }
    return clamp(vec4(cmy, k), 0.0, 1.0);
}

vec3 CMYKtoRGB(vec4 cmyk) {
    float invK = 1.0 - cmyk.w;
    float r = 1.0 - min(1.0, cmyk.x * invK + cmyk.w);
    float g = 1.0 - min(1.0, cmyk.y * invK + cmyk.w);
    float b = 1.0 - min(1.0, cmyk.z * invK + cmyk.w);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

float samplePaper(vec2 uv) {
    return texture2D(uPaper, fract(uv * PAPER_TILE)).r;
}

// ---------------------------------------------------------------------------
// Painterly abstraction — Generalized Kuwahara filter (Papari et al.)
//
// Divides the pixel neighbourhood into 8 sectors (45° each). Each sector
// accumulates a mean (in CMYK for ink-like subtractive blending) and a
// variance (in RGB luminance for perceptual accuracy). The final colour is
// a soft-max blend where low-variance (flat, uniform) sectors dominate.
//
// Why this beats bilateral for a painterly look:
//   Bilateral produces a *softened* image — edges preserved, but no flat
//   colour pools. Kuwahara produces *flat fill regions with sharp boundaries*
//   because it always outputs the mean of the uniformest local neighbourhood,
//   regardless of what the other sectors look like.
//
// uAbstraction : filter radius in pixels
// uBlotchiness : sector blend sharpness — 0 = very sharp (hard flat pools),
//                1 = very soft (all sectors equally weighted, like a blur)
//
// Sample count: 1 center + 8 sectors × 12 radial × 3 angular = 289 taps.
// This is why the pass is baked rather than run per frame.
// ---------------------------------------------------------------------------
vec3 samplePainterly(vec2 uv, vec2 cvSc) {
    // cvSc = effectiveCoverScale: scales screen-pixel offsets into image UV space
    // so the Kuwahara radius is isotropic in screen pixels, not image UV units.
    vec2 px = cvSc / uResolution;
    float radius = uAbstraction;

    // Paper-grain directional bias — ink spreads along the grain
    vec2 bias = (texture2D(uPaper, fract(uv * 5.3)).rg * 2.0 - 1.0) * 0.25;

    // Per-pixel sector rotation driven by the domain-warp field from Pass A.
    // atan(ry, rx) gives the local fBm flow angle. Rotating the entire sector
    // wheel by this angle means flat colour pools follow organic fBm curves
    // instead of the screen-aligned 0°/45°/90°/135° grid.
    vec2  localWarp = texture2D(uWarp, uv).rg;
    float flowAngle = atan(localWarp.y, localWarp.x);

    vec3 centerRGB  = texture2D(uColor, uv).rgb;
    vec4 centerCMYK = RGBtoCMYK(centerRGB);

    // Sharpness of sector selection.
    // uBlotchiness=0 → sharpness=800 (near-hard selection, very flat pools)
    // uBlotchiness=1 → sharpness=40  (soft blend across sectors)
    float sharpness = mix(800.0, 40.0, uBlotchiness);

    vec3  weightedColor = vec3(0.0);
    float weightSum     = 0.0;
    vec3  bleedSum      = vec3(0.0); // sum of all sector means — used for cross-pool bleed

    // 8 sectors, PI/4 (45°) each — rotated per-pixel by flowAngle
    for (int s = 0; s < 8; s++) {
        // Per-pixel per-sector angle jitter — breaks the regular 45° octagonal
        // boundary grid so pool edges meander organically rather than running
        // as predictable hard arcs. ±0.3 rad ≈ ±17° wobble per sector.
        float sectorJitter = (texture2D(uPaper, fract(uv * 5.7 + vec2(float(s) * 0.31, float(s) * 0.19))).r - 0.5) * 0.3;
        float baseAngle = flowAngle + float(s) * 0.785398 + sectorJitter; // rotated + jittered

        // Accumulators — CMYK for mean, RGB for variance
        vec4 cmykAcc  = centerCMYK;
        vec3 rgbAcc   = centerRGB;
        vec3 rgbSqAcc = centerRGB * centerRGB;
        float n       = 1.0;

        // 12 radial steps × 3 angular samples per step
        for (int ri = 1; ri <= 12; ri++) {
            float r   = float(ri) / 12.0;      // 0.083 → 1.0
            float rPx = r * radius;
            float sw  = exp(-2.0 * r * r);      // Gaussian spatial falloff

            for (int ai = 0; ai < 3; ai++) {
                // Angular spread: centre ray ± PI/12 (15°)
                float a = (float(ai) - 1.0) * 0.2618;
                vec2 dir    = vec2(cos(baseAngle + a), sin(baseAngle + a));
                // Paper bias scales with radius so outer samples follow grain more
                vec2 offset = (dir + bias * r) * rPx * px;

                vec3 sRGB  = texture2D(uColor, uv + offset).rgb;
                vec4 sCMYK = RGBtoCMYK(sRGB);

                cmykAcc  += sCMYK * sw;
                rgbAcc   += sRGB  * sw;
                rgbSqAcc += sRGB  * sRGB * sw;
                n        += sw;
            }
        }

        // Sector mean in CMYK → back to RGB for ink-like subtractive blending
        vec3 mean = CMYKtoRGB(cmykAcc / n);
        bleedSum += mean; // accumulate for cross-pool bleed

        // Luminance-weighted variance in RGB for perceptual sector selection
        vec3 rgbMean  = rgbAcc / n;
        vec3 variance = max(rgbSqAcc / n - rgbMean * rgbMean, vec3(0.0));
        float v       = dot(variance, vec3(0.299, 0.587, 0.114));

        // Soft-max: sectors with low variance (flat regions) dominate
        float w = exp(-v * sharpness);
        weightedColor += mean * w;
        weightSum     += w;
    }

    vec3 poolColor = weightedColor / weightSum;
    // Cross-pool bleed: mix 13% of the unweighted sector-mean average into the
    // hard Kuwahara result. Simulates wet pigment seeping across pool boundaries
    // — adjacent colors bleed into each other without fully washing the pools flat.
    return mix(poolColor, bleedSum / 8.0, 0.13);
}

// ---------------------------------------------------------------------------
// Bousseau 2006 edge darkening — L1 central-difference, soft shoulder
// ---------------------------------------------------------------------------
float edgeDarkening(vec2 uv, vec2 cvSc) {
    vec2 px = cvSc / uResolution;
    vec3 L = texture2D(uColor, uv - vec2(px.x, 0.0)).rgb;
    vec3 R = texture2D(uColor, uv + vec2(px.x, 0.0)).rgb;
    vec3 D = texture2D(uColor, uv - vec2(0.0, px.y)).rgb;
    vec3 U = texture2D(uColor, uv + vec2(0.0, px.y)).rgb;
    vec3 delta = abs(L - R) + abs(D - U);
    float Dp = (delta.r + delta.g + delta.b) / 3.0;
    return 1.0 - exp(-EDGE_EXP * Dp);
}

// ---------------------------------------------------------------------------
// main — steps 1 through 7 of the original composite
// ---------------------------------------------------------------------------
void main() {
    // ---- 1. Sample warp RT (Pass A) ----------------------------------------
    vec4 warpPacked = texture2D(uWarp, vUv);
    float rx = warpPacked.r;
    float ry = warpPacked.g;
    float f  = warpPacked.b;

    // ---- 2. Cover-fit UV — no stretch, centered crop, no ZOOM_OUT factor ----
    // Standard background-size:cover with no extra scale modifier.
    // Narrow viewport: image fills height, sides center-cropped (centered horizontally).
    // Wide viewport: image fills width, top/bottom center-cropped.
    // UV always stays in [0,1] — avoids the clamped-edge artifact that causes
    // the edgeDarkening pass to detect an artificial hard seam and darken it.
    float viewAspect = uResolution.x / uResolution.y;
    vec2 effectiveCoverScale = viewAspect > uImageAspect
        ? vec2(1.0, uImageAspect / viewAspect)   // wider viewport: fill width, crop top/bottom
        : vec2(viewAspect / uImageAspect, 1.0);  // narrower viewport: fill height, crop sides
    vec2 imageUV = (vUv - 0.5) * effectiveCoverScale + 0.5;

    // ---- 3. Paper wobble + fBm warp displacement (applied in image UV space) --
    // uWobbleStrength: paper-surface warp amplitude — controls how wavy lines become.
    // uWarpDisplace:   fBm domain-warp offset — adds large-scale organic noise/spread.
    //
    // warpPacked.rg is safe to use without gating because the warp field is
    // frozen before the reveal starts (frozenTime set in onLoad callback).
    vec2 paperWarp = (texture2D(uPaper, fract(vUv * 1.5)).rg * 2.0 - 1.0);
    vec2 wobbledUV = imageUV + paperWarp * uWobbleStrength + warpPacked.rg * uWarpDisplace;

    // ---- 4. Kuwahara painterly filter — flat colour pools, sharp boundaries --
    vec3 C = samplePainterly(wobbledUV, effectiveCoverScale);

    // ---- 4b. Wet-on-wet color bleed ----------------------------------------
    // Sample the raw image in CMYK at 4 positions offset ±7px along the local
    // fBm flow direction and its perpendicular. Averaging in CMYK gives
    // subtractive (ink-like) mixing instead of RGB wash-out to grey.
    // 12% mix softens Kuwahara pool boundaries — colors from adjacent regions
    // seep across without destroying the painterly pool structure.
    {
        vec2 bleedPx  = effectiveCoverScale / uResolution;
        vec2 fDir     = normalize(warpPacked.rg + vec2(1e-4));
        vec2 fPerp    = vec2(-fDir.y, fDir.x);
        const float BLEED_R = 7.0;
        vec4 bC0 = RGBtoCMYK(texture2D(uColor, wobbledUV + fDir  * BLEED_R * bleedPx).rgb);
        vec4 bC1 = RGBtoCMYK(texture2D(uColor, wobbledUV - fDir  * BLEED_R * bleedPx).rgb);
        vec4 bC2 = RGBtoCMYK(texture2D(uColor, wobbledUV + fPerp * BLEED_R * bleedPx).rgb);
        vec4 bC3 = RGBtoCMYK(texture2D(uColor, wobbledUV - fPerp * BLEED_R * bleedPx).rgb);
        vec3 bleedColor = CMYKtoRGB((bC0 + bC1 + bC2 + bC3) * 0.25);
        C = mix(C, bleedColor, 0.12);
    }

    // ---- 5. Paper texture ---------------------------------------------------
    float paperVal = samplePaper(vUv);

    // ---- 6. Fused Bousseau density layers (Eq. 1) -------------------------
    // T_flow: granulation — only fires at fBm peaks, not as a constant wash.
    //   smoothstep activates above fBm midpoint so negative/neutral values
    //   contribute nothing; only the positive peaks create isolated dark pools.
    float T_flow  = smoothstep(0.5, 0.9, f * 0.5 + 0.5);
    float T_disp  = (rx * 0.5 + 0.5) * 0.6 + (ry * 0.5 + 0.5) * 0.4;
    float T_edge  = edgeDarkening(wobbledUV, effectiveCoverScale);
    // Randomly suppress ~40% of hard lines using paper grain at a different
    // UV frequency — prevents edges from being uniformly present everywhere.
    float edgeMask = texture2D(uPaper, fract(wobbledUV * 9.3 + vec2(0.51, 0.27))).r;
    T_edge *= smoothstep(0.38, 0.62, edgeMask);

    // Paper (uDensityWeights.x) is removed from the density sum — it now
    // controls the paper grain multiply below, which is far more visible.
    float dTotal = uDensityWeights.y * T_flow
                 + uDensityWeights.z * T_disp
                 + uDensityWeights.w * T_edge;

    C = max(C - (C - C * C) * dTotal, vec3(0.0));

    // ---- 7. Paper grain multiply -------------------------------------------
    // uDensityWeights.x directly controls grain visibility:
    //   0 = no grain (flat colour), 1 = strong grain (≈ 40% texture multiply).
    C *= mix(1.0, paperVal, uDensityWeights.x * 0.4);

    gl_FragColor = vec4(C, 1.0);
}
