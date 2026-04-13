// watercolor.frag  —  Pass B (full-resolution composite)
// Compile variant: MODE_PORTFOLIO (default)
// Implements Bousseau 2006 watercolor post-process:
//   - Painterly abstraction: generalized Kuwahara filter in CMYK space
//   - Pigment density: Eq. 1  C' = C - (C - C²)(d - 1)
//   - Edge darkening: L1 central-difference gradient → soft shoulder
//   - Paper wobble: UV offset from paper texture gradient (Perlin & Neyret 2001)
//   - Wet-front reveal mask: SDF + fBm warp, driven by uProgress
//   - Bleeding fibers: paper-grain-driven tendrils past the reveal front
//   - Steady-state: frozen static image once uProgress ≥ 1
//
// Paper texture: ambientCG Paper006 displacement map (CC0)
//   Credit: ambientcg.com/view?id=Paper006

precision highp float;

#define MODE_PORTFOLIO

const float PI = 3.14159265;

varying vec2 vUv;

// --- Uniforms ---------------------------------------------------------------
uniform sampler2D uColor;      // hero image (random from /assets/images/)
uniform sampler2D uWarp;       // Pass A RGBA16F render target (half-res)
uniform sampler2D uPaper;      // CC0 cold-pressed paper displacement (paper.jpg)
uniform float     uTime;       // seconds since mount (frozen after reveal)
uniform float     uProgress;   // 0→1.2, GSAP-driven, Power0 (no easing)
uniform vec2      uResolution; // full-res framebuffer size in pixels
uniform float     uBloomSeed;  // per-route slug hash → unique bloom origin offset
uniform vec2      uBloomOrigin;// normalised [0,1] bloom origin (default 0.5,0.5)
uniform float     uImageAspect; // hero image width / height — used for cover-fit UV

// --- Tuneable uniforms (adjustable via debug panel) -------------------------
uniform float     uWarpInfluence;  // how much warp perturbs reveal front (default 0.25)
uniform float     uRevealSpread;   // smoothstep transition width (default 0.30)
uniform float     uRingHalfwidth;  // ring edge thickness (default 0.025)
uniform float     uRingStrength;   // ring brightness (default 0.35)
uniform vec4      uDensityWeights; // (paper, flow, disp, edge) weights
uniform float     uBeta;          // Bousseau pigment density β (default 0.35)
uniform float     uFiberStrength;  // bleed fiber tendril visibility (default 0.12)
uniform float     uFiberScale;     // bleed fiber detail frequency (default 8.0)
uniform float     uAbstraction;    // painterly blur radius in pixels (default 5.0)
uniform float     uBlotchiness;    // Kuwahara sector sharpness — lower = flatter distinct pools (default 0.12)
uniform float     uWobbleStrength; // paper-gradient UV wobble amplitude — higher = wavier lines (default 0.02)
uniform float     uWarpDisplace;   // fBm warp UV offset — adds large-scale organic noise/spread (default 0.0)
uniform sampler2D uPetals;         // Petal render target (RGBA) — transparent where no petal is drawn

// --- Constants (not worth exposing as uniforms) -----------------------------
const float EDGE_EXP             = 6.0;
const float PAPER_TILE           = 3.0;
const vec3  PAPER_COLOR          = vec3(0.97, 0.95, 0.90);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

float samplePaper(vec2 uv) {
    return texture2D(uPaper, fract(uv * PAPER_TILE)).r;
}

vec2 paperGradient(vec2 uv) {
    vec2 px = 1.0 / uResolution;
    float L = samplePaper(uv - vec2(px.x, 0.0));
    float R = samplePaper(uv + vec2(px.x, 0.0));
    float D = samplePaper(uv - vec2(0.0, px.y));
    float U = samplePaper(uv + vec2(0.0, px.y));
    return vec2(R - L, U - D) * 0.5;
}

// ---------------------------------------------------------------------------
// Directional fiber texture — continuous cellulose-grain-aligned streaks
//
// Physical basis: cold-pressed paper has cellulose fibers running along a
// grain direction. Pigment wicks preferentially along these channels, producing
// elongated dark streaks rather than isotropic blobs. Simulated by sampling the
// paper heightmap with an anisotropic kernel stretched along the local fBm flow
// direction (Pass A warpPacked.rg).
//
// Anisotropy 6:1 (FIBER_ACROSS / FIBER_ALONG), both × PAPER_TILE (3.0):
//   FIBER_ALONG  = 2.5  → effective 7.5 tiles — fibers span ~13% of screen
//   FIBER_ACROSS = 15.0 → effective 45 tiles  — fibers ~2% screen wide (~20 px)
// Ridge detection narrows those features to ~6 px visible lines.
//
// Direction noise (±10% paper RG jitter) breaks perfect parallelism and
// matches the slight meandering of real paper cellulose fibers.
// ---------------------------------------------------------------------------
float computeDirectionalFibers(vec2 uv, vec2 flowRg) {
    vec2 dirNoise = (texture2D(uPaper, fract(uv * 2.3)).rg * 2.0 - 1.0) * 0.10;
    vec2 F        = normalize(flowRg + dirNoise + vec2(1e-4, 1e-4)); // fiber run direction
    vec2 P        = vec2(-F.y, F.x);                                  // perpendicular axis

    float u_F = dot(uv, F);
    float u_P = dot(uv, P);

    const float FIBER_ALONG  = 0.6;   // was 2.5 — lower = longer continuity along each tendril
    const float FIBER_ACROSS = 1.8;   // was 15 — lower = fewer, more distinct tendrils (~17 per boundary)
    vec2 anisoUV = F * (u_F * FIBER_ALONG  * PAPER_TILE)
                 + P * (u_P * FIBER_ACROSS * PAPER_TILE);

    float raw = texture2D(uPaper, fract(anisoUV)).r;

    // Narrow ridge: peak at 0.65 ± 0.10 → thin lines at paper grain crests
    return smoothstep(0.55, 0.65, raw) * (1.0 - smoothstep(0.65, 0.75, raw));
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
// Bousseau 2006 Eq. 1 — verified from full paper
// ---------------------------------------------------------------------------
vec3 bousseau_density(vec3 C, float T) {
    float d = 1.0 + uBeta * max(T - 0.5, 0.0) * 2.0;
    return C - (C - C * C) * (d - 1.0);
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
// Wet-front reveal mask
// warpField: q.x from Pass A — single fBm, organic blob shape
//
// uFiberStrength: displaces the reveal front SDF by paper grain, making the
//   boundary itself ragged and organic rather than a smooth circle.
//   Higher = more jagged, tooth-like edge. (Was: opacity modulation — now
//   it deforms the actual boundary geometry.)
//
// uFiberScale: controls how far bleeding tendrils reach past the front in UV
//   space. Range 1–20 → reach 0.025–0.5 (≈ 25–500 px at 1080p). (Was:
//   paper texture tile frequency, which had no visible effect.)
// ---------------------------------------------------------------------------
vec3 revealMask(vec2 uv, float warpField, vec2 warpRg, out float W) {
    // X-only seed offset: cos(0)=1 for empty slug would push origin.y to 0.62,
    // making top reveal 40% earlier than bottom. Lock Y to the bloom origin.
    vec2 origin = vec2(
        uBloomOrigin.x + 0.12 * sin(uBloomSeed * 7.391),
        uBloomOrigin.y
    );

    // Two-frequency paper grain for organic boundary displacement.
    // Low freq gives large undulations; high freq gives fine tooth.
    float grain0 = samplePaper(uv * 1.8);  // large undulations (5.4× tile)
    float grain1 = samplePaper(uv * 5.5);  // fine tooth (16.5× tile)
    float edgeGrain = grain0 * 0.65 + grain1 * 0.35; // [0, 1]

    // Displace the reveal front by paper grain — the boundary geometry becomes
    // ragged, matching how watercolor paper absorbs ink unevenly.
    float grainDisplace = (edgeGrain * 2.0 - 1.0) * uFiberStrength * 0.12;

    float front = distance(uv, origin) + uWarpInfluence * warpField + grainDisplace;

    // Core reveal
    float reveal = 1.0 - smoothstep(uProgress - uRevealSpread, uProgress, front);

    // Bleeding fibers past the reveal front.
    // uFiberScale controls reach: 1 → 0.025 UV, 20 → 0.5 UV (~500 px at 1080p).
    float distFromFront = front - uProgress;
    float fiberReach    = uFiberScale * 0.025;
    // Directional tendrils — run along warp flow for continuous elongated streaks.
    // Blended with coarse grain (25%) to preserve natural thickness variation.
    float dirFiber    = computeDirectionalFibers(uv, warpRg);
    float coarseGrain = samplePaper(uv * 1.5);
    float fiberNoise  = dirFiber * 0.75 + smoothstep(0.6, 0.85, coarseGrain) * 0.25;
    float fiberFade   = 1.0 - smoothstep(0.0, fiberReach, distFromFront);
    float fiberZone   = fiberFade * step(0.0, distFromFront);
    float fibers      = fiberZone * fiberNoise * uFiberStrength * 0.5; // restore original reveal-front strength
    reveal = max(reveal, fibers);

    // No Phase B saturation — the organic fBm-warped reveal front freezes in
    // place at the edges, leaving a permanent watercolor tide-mark boundary.
    W = reveal;

    // Pigment ring at drying front — fades in over the animation so it's barely
    // visible while sweeping and at full strength once the front has settled.
    float ring     = 1.0 - smoothstep(0.0, uRingHalfwidth, abs(front - uProgress + 0.06));
    float ringFade = smoothstep(0.0, 0.15, uProgress);
    return vec3(ring * uRingStrength * ringFade);
}

// ---------------------------------------------------------------------------
// Clear zone — permanent paper-white area protecting the center text.
//
// Uses the IDENTICAL `front` SDF as revealMask (same origin, same fBm warp
// field, same grain displacement) with a fixed CLEAR_PROGRESS threshold
// instead of the animated uProgress. This makes the clear zone boundary
// visually indistinguishable from the reveal front — same organic fBm shape,
// same fiber tendrils, same pigment ring.
//
// CLEAR_PROGRESS = 0.28 in `front` UV space.
// CLEAR_FADE     = 0.12 (narrower than uRevealSpread so center is fully white).
// ---------------------------------------------------------------------------
float clearZoneMask(vec2 uv, float warpField, vec2 warpRg, out vec3 clearRingColor) {
    const float CLEAR_PROGRESS = 0.18;  // ring radius
    const float WHITE_PROGRESS = 0.30;  // white fade radius (larger than ring)
    const float CLEAR_FADE     = 0.18;

    // Identical origin to revealMask — same fBm-offset bloom point.
    vec2 origin = vec2(
        uBloomOrigin.x + 0.12 * sin(uBloomSeed * 7.391) - 0.02,
        uBloomOrigin.y
    );

    // Identical two-frequency grain displacement to revealMask.
    float grain0 = samplePaper(uv * 1.8);
    float grain1 = samplePaper(uv * 5.5);
    float edgeGrain    = grain0 * 0.65 + grain1 * 0.35;
    float grainDisplace = (edgeGrain * 2.0 - 1.0) * uFiberStrength * 0.12;

    // Horizontal stretch on portrait viewports (mobile): widens the clear zone
    // without changing its vertical extent. In UV space, distance(uv, origin) maps
    // to a shape that is taller than wide on narrow screens — a UV distance of 0.30
    // spans only 117 px horizontally but 253 px vertically on a 390×844 device.
    // Dividing diff.x by 1/aspect restores a screen-space circle on portrait.
    // Clamped to [1, 2]: no effect on landscape/desktop, activates only on portrait.
    float viewAspect = uResolution.x / uResolution.y;
    float xStretch = clamp(1.0 / viewAspect, 1.0, 2.0);

    // Damped warp: full influence (±0.26) can triple the zone size on negative warpField.
    // Cap at 30% of uWarpInfluence so the boundary stays organic but compact.
    vec2 diff = uv - origin;
    diff.x /= xStretch;
    float front = length(diff) + uWarpInfluence * 0.3 * warpField + grainDisplace;

    // Animate the clear zone radius so the white fade and ring grow together.
    // clearRingFade drives both: the white zone expands from 0 → CLEAR_PROGRESS
    // while the ring tracks that same animated boundary — they appear and grow simultaneously.
    float clearRingFade     = clamp(uProgress / 0.5, 0.0, 1.0);
    float animatedClearProg = CLEAR_PROGRESS * clearRingFade;  // ring boundary
    float animatedWhiteProg = WHITE_PROGRESS * clearRingFade;  // white zone boundary

    // Core mask: 0 inside zone (paper-white), capped at 0.82 outside so a soft
    // white halo lingers at the edges rather than fully resolving to the image.
    float coreMask = min(smoothstep(animatedWhiteProg - CLEAR_FADE, animatedWhiteProg, front), 0.82);

    // Directional fibers past the clear zone boundary — same technique as revealMask.
    float distFromFront = front - animatedWhiteProg;
    float fiberReach    = 0.045; // fixed short reach — keeps tendrils close to the content edge
    float dirFiber      = computeDirectionalFibers(uv + vec2(0.41, 0.83) * 0.1, warpRg);
    float coarseGrain   = samplePaper(uv * 1.8 + vec2(0.41, 0.83));
    float fiberNoise    = dirFiber * 0.70 + smoothstep(0.55, 0.80, coarseGrain) * 0.30;
    float fiberFade     = 1.0 - smoothstep(0.0, fiberReach, distFromFront);
    float fiberZone     = fiberFade * step(0.0, distFromFront);
    float fibers        = fiberZone * fiberNoise * uFiberStrength * 0.85;

    // Tide-mark ring — tracks the animated clear zone boundary so it and the
    // white fade always grow together. Uses a more-warped front for extra wobble.
    // Same x-stretch as `front` above so the ring traces the white zone edge.
    vec2 ringDiff = uv - origin;
    ringDiff.x /= xStretch;
    float ringFront     = length(ringDiff) + uWarpInfluence * 1.0 * warpField + grainDisplace * 3.0;
    float ringRadius    = animatedClearProg;
    float ring          = 1.0 - smoothstep(0.0, 0.010, abs(ringFront - ringRadius));
    clearRingColor = vec3(ring * uRingStrength * 0.25 * clearRingFade);

    return max(coreMask, fibers);
}

// ---------------------------------------------------------------------------
// main
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
    //   Samples paper RG channels as a 2D warp field (remapped [-1,1]).
    //   Using a direct texture sample (not the 1-pixel gradient) gives a
    //   properly-scaled offset — at medium tile freq the field spans the full
    //   [-uWobbleStrength, +uWobbleStrength] range in UV coords.
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
    //   Default 0.45 → mix factor 0.18, matching the old hardcoded value.
    C *= mix(1.0, paperVal, uDensityWeights.x * 0.4);

    // ---- 8. Reveal mask + ring + fibers -----------------------------------
    float W;
    vec3 ringColor = revealMask(vUv, warpPacked.a, warpPacked.rg, W);

    // Preserve the center text area as paper-white.
    vec3 clearRingColor;
    W *= clearZoneMask(vUv, warpPacked.a, warpPacked.rg, clearRingColor);

    // Apply the same paper grain to the paper-white base so the clear zone and
    // unrevealed area match the off-white texture visible in the revealed region.
    // Without this, W=0 areas get flat PAPER_COLOR (the grain from step 7 is lost
    // in the mix) and appear as bright white against the grained surroundings.
    vec3 grainedPaperColor = PAPER_COLOR * mix(1.0, paperVal, uDensityWeights.x * 0.4);
    C = mix(grainedPaperColor, C, W);

    // ---- 9. Edge desaturation — watercolor wash character ------------------
    float lum = dot(C, vec3(0.299, 0.587, 0.114));
    C = mix(mix(vec3(lum), C, 0.7), C, smoothstep(0.0, 0.4, W));

    // ---- 9c. Canvas-wide directional fiber texture --------------------------
    // Paper cellulose fibers run along the local fBm flow direction: continuous
    // elongated ridges rather than the isotropic grain blobs from step 7.
    // Strategic masking — fibers only appear where they're physically present:
    //   midtoneMask : invisible in white (no pigment) and black (pigment too dense)
    //   fiberBoost  : amplified in fBm pigment-pool zones (T_flow peaks)
    //   W           : only in the revealed area
    float dirFibers   = computeDirectionalFibers(vUv, warpPacked.rg);
    float lumForFiber = dot(C, vec3(0.299, 0.587, 0.114));
    // Widened midtone range (centre 0.55, width ≈ 0.6 on each side) so fibers
    // fire visibly in bright areas (L≈0.8 → 72% mask) not just at L=0.5.
    float midtoneMask = clamp(1.0 - abs(lumForFiber - 0.55) * 1.6, 0.0, 1.0);
    float fiberBoost  = 1.0 + T_flow * 0.65;
    float fiberApply  = dirFibers * midtoneMask * fiberBoost * W * uFiberStrength;
    C *= 1.0 - fiberApply * 0.0;

    // Reveal ring — darkens at the drying front (subtractive = pigment concentration).
    C = clamp(C - ringColor * W, 0.0, 1.0);
    // Clear zone ring — permanent tide-mark at the content boundary, ungated so it
    // shows on both the paper side and the painted side of the edge.
    C = clamp(C - clearRingColor, 0.0, 1.0);

    // ---- 10. Petal layer composite (drawn over the revealed watercolor) ----
    // Composited after the reveal mask so petal opacity is not attenuated by W.
    // With REVEAL_PROGRESS_TARGET=0.65 the left edge has W≈0.29, which would
    // wash fully-opaque petals 71% back toward PAPER_COLOR if they were
    // composited before the reveal.  Paper grain still applies; Bousseau density
    // is skipped because dTotal is derived from image-space data (see below).
    vec2 petalGrainWarp = (texture2D(uPaper, fract(vUv * 2.3 + vec2(0.37, 0.62))).rg * 2.0 - 1.0) * 0.01;
    vec2 petalUV    = vUv + warpPacked.rg * uWarpDisplace * 0.5 + petalGrainWarp;
    vec4 petalPx    = texture2D(uPetals, petalUV);

    if (petalPx.a > 0.005) {
        // Paper grain through petals — same weight as the background
        petalPx.rgb *= mix(1.0, paperVal, uDensityWeights.x * 0.4);

        // NOTE: Bousseau density (dTotal) is intentionally NOT applied here.
        // dTotal is derived from image-space T_flow (fBm blotches), T_disp, and
        // T_edge (image pixel edges) — all properties of the background photo.
        // Applying dTotal to petals stamps the image's blotch pattern onto them.
        // Petals already have their own fBm blotch character from petal.frag.

        // Un-premultiply to get plain color, then re-composite at 1.5× the RT
        // alpha so fade-in/fade-out transitions look solid faster.  Clamped to
        // 1.0 so fully-opaque petals are unaffected.
        float petalA     = min(petalPx.a * 1.5, 1.0);
        vec3  petalColor = petalPx.rgb / max(petalPx.a, 0.001);
        C = clamp(petalColor, 0.0, 1.0) * petalA + (1.0 - petalA) * C;
    }

    gl_FragColor = vec4(C, 1.0);
}
