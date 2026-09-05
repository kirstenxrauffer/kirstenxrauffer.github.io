// watercolor.frag  —  Pass B2 (per-frame composite)
// Compile variant: MODE_PORTFOLIO (default)
//
// Implements the animated half of the Bousseau 2006 watercolor post-process:
//   - Wet-front reveal mask: SDF + fBm warp, driven by uProgress
//   - Bleeding fibers: paper-grain-driven tendrils past the reveal front
//   - Clear zone: permanent paper-white legibility area, driven by uClearProgress
//   - Petal layer composite
//
// The *static* half — painterly Kuwahara abstraction, wet-on-wet CMYK bleed,
// pigment density and paper grain — lives in watercolor_base.frag and is baked
// once into uBase. It used to run here, per frame, at 289 texture taps per
// pixel to produce a bit-identical result every time. Everything this shader
// still computes per frame genuinely varies with uProgress / uClearProgress /
// uPetals.
//
// Paper texture: ambientCG Paper006 displacement map (CC0)
//   Credit: ambientcg.com/view?id=Paper006

precision highp float;

#define MODE_PORTFOLIO

varying vec2 vUv;

// --- Uniforms ---------------------------------------------------------------
uniform sampler2D uBase;       // watercolor_base.frag output — static painted image
uniform sampler2D uWarp;       // Pass A RGBA16F render target (half-res)
uniform sampler2D uPaper;      // CC0 cold-pressed paper displacement (paper.webp)
uniform sampler2D uPetals;     // Petal render target (RGBA) — transparent where no petal
uniform float     uProgress;   // 0→1.2, GSAP-driven, Power0 (no easing)
uniform vec2      uResolution; // full-res framebuffer size in pixels
uniform float     uBloomSeed;  // per-route slug hash → unique bloom origin offset
uniform vec2      uBloomOrigin;// normalised [0,1] bloom origin (default 0.5,0.5)

// --- Tuneable uniforms (adjustable via debug panel) -------------------------
uniform float     uWarpInfluence;  // how much warp perturbs reveal front (default 0.25)
uniform float     uRevealSpread;   // smoothstep transition width (default 0.30)
uniform float     uRingHalfwidth;  // ring edge thickness (default 0.025)
uniform float     uRingStrength;   // ring brightness (default 0.35)
uniform vec4      uDensityWeights; // (paper, flow, disp, edge) weights — .x drives grain here
uniform float     uFiberStrength;  // bleed fiber tendril visibility (default 0.12)
uniform float     uFiberScale;     // bleed fiber detail frequency (default 8.0)
uniform float     uClearProgress;  // center clear-zone fade [0,1] — animates ahead of uProgress so ring + white blotch bloom before image reveal

// --- Constants (not worth exposing as uniforms) -----------------------------
const float PAPER_TILE           = 3.0;
const vec3  PAPER_COLOR          = vec3(0.97, 0.95, 0.90);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

float samplePaper(vec2 uv) {
    return texture2D(uPaper, fract(uv * PAPER_TILE)).r;
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
// Direction noise (±10% paper RG jitter) breaks perfect parallelism and
// matches the slight meandering of real paper cellulose fibers.
// ---------------------------------------------------------------------------
float computeDirectionalFibers(vec2 uv, vec2 flowRg) {
    vec2 dirNoise = (texture2D(uPaper, fract(uv * 2.3)).rg * 2.0 - 1.0) * 0.10;
    vec2 F        = normalize(flowRg + dirNoise + vec2(1e-4, 1e-4)); // fiber run direction
    vec2 P        = vec2(-F.y, F.x);                                  // perpendicular axis

    float u_F = dot(uv, F);
    float u_P = dot(uv, P);

    const float FIBER_ALONG  = 0.6;   // lower = longer continuity along each tendril
    const float FIBER_ACROSS = 1.8;   // lower = fewer, more distinct tendrils
    vec2 anisoUV = F * (u_F * FIBER_ALONG  * PAPER_TILE)
                 + P * (u_P * FIBER_ACROSS * PAPER_TILE);

    float raw = texture2D(uPaper, fract(anisoUV)).r;

    // Narrow ridge: peak at 0.65 ± 0.10 → thin lines at paper grain crests
    return smoothstep(0.55, 0.65, raw) * (1.0 - smoothstep(0.65, 0.75, raw));
}

// ---------------------------------------------------------------------------
// Wet-front reveal mask
// warpField: q.x from Pass A — single fBm, organic blob shape
//
// uFiberStrength: displaces the reveal front SDF by paper grain, making the
//   boundary itself ragged and organic rather than a smooth circle.
//   Higher = more jagged, tooth-like edge.
//
// uFiberScale: controls how far bleeding tendrils reach past the front in UV
//   space. Range 1–20 → reach 0.025–0.5 (≈ 25–500 px at 1080p).
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
// ---------------------------------------------------------------------------
float clearZoneMask(vec2 uv, float warpField, vec2 warpRg, out vec3 clearRingColor) {
    const float CLEAR_PROGRESS = 0.16;  // ring radius
    const float WHITE_PROGRESS = 0.27;  // white fade radius (larger than ring)
    const float CLEAR_FADE     = 0.18;

    // Portrait/mobile enlargement. Text columns are proportionally much wider
    // relative to the viewport on a phone, so the desktop-tuned zone leaves too
    // little white behind the copy. MOBILE_GROW scales the whole zone; the extra
    // MOBILE_WIDEN factor applies on X only, pushing the horizontal fade past the
    // screen edges so the full text measure sits on paper-white rather than in
    // the falloff. Mirrored in ascii.frag clearZoneVisibility().
    const float MOBILE_GROW  = 1.15;
    const float MOBILE_WIDEN = 1.25;

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
    //
    // On landscape/desktop: squeeze x by 25 px per side so the legibility blotch
    // is a touch narrower horizontally (feels too wide on wide viewports).
    float viewAspect     = uResolution.x / uResolution.y;
    float portraitStretch = clamp(1.0 / viewAspect, 1.0, 2.0);
    float desktopSqueeze  = 1.0 - 25.0 / (uResolution.x * WHITE_PROGRESS);
    float xStretch        = viewAspect > 1.0
                          ? desktopSqueeze
                          : portraitStretch * MOBILE_GROW * MOBILE_WIDEN;
    // Mobile/portrait only: extend vertical extent by 15 px total (7.5 px per side),
    // then scale by MOBILE_GROW so the zone grows on both axes, not just width.
    float mobileYStretch  = viewAspect < 1.0
                          ? (1.0 + 7.5 / (uResolution.y * WHITE_PROGRESS)) * MOBILE_GROW
                          : 1.0;
    // On portrait/mobile: shift the clear zone so it sits better under the main
    // content. portraitFactor is 0 on landscape, ~1 on a tall phone (390×844).
    // Y: 0.036 UV × 844 px ≈ 30 px down.
    // X: 0.085 UV × 390 px ≈ 33 px right.
    float portraitFactor = clamp(1.0 / viewAspect - 1.0, 0.0, 1.0);
    origin.y -= portraitFactor * 0.036;
    origin.x += portraitFactor * 0.085;

    // Damped warp: full influence (±0.26) can triple the zone size on negative warpField.
    // Cap at 30% of uWarpInfluence so the boundary stays organic but compact.
    vec2 diff = uv - origin;
    diff.x /= xStretch;
    diff.y /= mobileYStretch;
    float front = length(diff) + uWarpInfluence * 0.3 * warpField + grainDisplace;

    // Animate the clear zone radius so the white fade and ring grow together.
    // clearRingFade drives both: the white zone expands from 0 → CLEAR_PROGRESS
    // while the ring tracks that same animated boundary — they appear and grow simultaneously.
    // Driven by uClearProgress (independent of uProgress) so the clear zone blooms
    // on page load before the image reveal starts.
    float clearRingFade     = uClearProgress;
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
    // Extra 10% horizontal squeeze on desktop — the ring's stronger warp (1.0 vs
    // 0.3) makes it wobble wider than the white fade, so pinch it in further.
    vec2 ringDiff = uv - origin;
    float ringXStretch = viewAspect > 1.0 ? xStretch * 0.90 : xStretch;
    ringDiff.x /= ringXStretch;
    ringDiff.y /= mobileYStretch;
    float ringFront     = length(ringDiff) + uWarpInfluence * 1.0 * warpField + grainDisplace * 3.0;
    float ringRadius    = animatedClearProg;
    float ring          = 1.0 - smoothstep(0.0, 0.010, abs(ringFront - ringRadius));
    clearRingColor = vec3(ring * uRingStrength * 0.25 * clearRingFade);

    return max(coreMask, fibers);
}

// ---------------------------------------------------------------------------
// main — steps 8 through 10 of the original composite
// ---------------------------------------------------------------------------
void main() {
    // Pass A warp field. Only .a (fBm blob) and .rg (flow direction) are needed
    // here; the cover-fit / wobble use of .rg lives in the base pass.
    vec4 warpPacked = texture2D(uWarp, vUv);

    // Steps 1–7, baked once by watercolor_base.frag.
    vec3 C = texture2D(uBase, vUv).rgb;

    float paperVal = samplePaper(vUv);

    // ---- 8. Reveal mask + ring + fibers -----------------------------------
    float W;
    vec3 ringColor = revealMask(vUv, warpPacked.a, warpPacked.rg, W);

    // Preserve the center text area as paper-white.
    vec3 clearRingColor;
    W *= clearZoneMask(vUv, warpPacked.a, warpPacked.rg, clearRingColor);

    // Apply the same paper grain to the paper-white base so the clear zone and
    // unrevealed area match the off-white texture visible in the revealed region.
    // Without this, W=0 areas get flat PAPER_COLOR (the grain from the base pass
    // is lost in the mix) and appear as bright white against the grained surroundings.
    vec3 grainedPaperColor = PAPER_COLOR * mix(1.0, paperVal, uDensityWeights.x * 0.4);
    C = mix(grainedPaperColor, C, W);

    // ---- 9. Edge desaturation — watercolor wash character ------------------
    float lum = dot(C, vec3(0.299, 0.587, 0.114));
    C = mix(mix(vec3(lum), C, 0.7), C, smoothstep(0.0, 0.4, W));

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
    // Sample petals 1:1 with screen pixels so MSAA edges stay crisp.
    // Any per-pixel UV warp here (paper-grain, fBm displace) would crawl as
    // the petal translates through the static screen-space noise field.
    vec4 petalPx = texture2D(uPetals, vUv);

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
