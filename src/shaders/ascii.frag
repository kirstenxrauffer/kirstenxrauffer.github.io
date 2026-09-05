// ---------------------------------------------------------------------------
// ASCII / Typewriter Art Post-Process Shader  (v3 — edge-priority)
// ---------------------------------------------------------------------------
// Edge rendering is separated from fill and given absolute priority:
//   • Edges always render at full ink regardless of tolerance
//   • Multiple edge characters are concentrated along contours
//   • Directional characters (/ \ - | = [ ] ( ) !) trace the edge precisely
//   • Fill characters only appear in non-edge regions for tonal mass
// ---------------------------------------------------------------------------

precision highp float;

varying vec2 vUv;

uniform sampler2D uImage;
uniform sampler2D uAtlas;
uniform sampler2D uWordTex;
uniform vec2      uResolution;
uniform float     uTime;
uniform float     uCellSize;
uniform float     uTolerance;
uniform float     uScrambleDuration;
uniform vec2      uAtlasGrid;
uniform float     uRampSize;       // density ramp character count
uniform float     uEdgeOffset;     // first edge char atlas index
uniform float     uTextureOffset;  // first texture char atlas index
uniform float     uEdgeThreshold;  // min edge magnitude to trigger edge path
uniform float     uEdgeMult;       // multiplier for edge strength display
uniform float     uInkDarkness;    // 0..1 how dark the ink is
uniform float     uTonalStrength;  // tonal base layer strength (0 = off, 1 = normal, 2 = heavy)
uniform float     uFillMaxLayers;  // max fill overstrike layers (1-12)
uniform float     uFillLayerAlpha; // opacity per fill layer (0.05-0.5)
uniform float     uDebugEdges;     // >0.5 = show raw edge magnitude as red
uniform float     uTypeDebug;      // >0.5 = show reveal order (green=outline, red=filler)
uniform float     uTransparent;    // >0.5 = output ink-only over transparent bg (overlay mode)
uniform float     uWordCount;
uniform float     uWordMaxLen;
uniform float     uWordTexWidth;
uniform float     uImageAspect;    // hero image width / height — for cover-fit UV (matches watercolor)
uniform vec2      uBloomOrigin;    // normalised [0,1] clear-zone origin (matches watercolor default 0.5,0.5)
uniform float     uClearProgress;  // center clear-zone fade [0,1] — animated by AsciiCanvas in lock-step with watercolor

// ── Semantic (content-aware) character selection ──────────────────────────
// Classifies each cell by HSV + variance into one of 6 categories (grass,
// water, sky, tree, rock, neutral) and picks a character from a
// category-specific ramp instead of the variance-only pickTextureChar.
// Rooted in the Nelson 1939 / Neill 1982 / Stark slope-grammar traditions.
uniform sampler2D uSemanticPalette;   // 1D lookup: cat*5+stop → atlas index
uniform float     uSemanticTexWidth;  // texture width (30 for MVP: 6 cats × 5 stops)
uniform float     uSemanticMode;      // 0 = variance-only (existing), >0.5 = HSV semantic
uniform float     uNeillOverstrike;   // >0.5 = restrike 'M' at darkness>0.85 per Neill (1982)
uniform float     uNeillCharIdx;      // atlas index of 'M' (resolved JS-side)
uniform float     uCategoryDebug;     // >0.5 = color-code cells by assigned category

#define CELL_ASPECT 1.0
#define PI 3.14159265

// ── Density ramp indices (matching constants.ts DENSITY_CHARS) ────────────
// " .',:;-~!+*=cxzoLTJ0Okd#MW&@$BN%Q"
//  0         1         2         3
//  0123456789012345678901234567890123
#define IDX_SPACE  0
#define IDX_DOT    1
#define IDX_o     14
#define IDX_O     20
#define IDX_ZERO  19
#define IDX_AT    27
#define IDX_HASH  22

// ── Edge character indices (EDGE_OFFSET + local index) ────────────────────
// EDGE_CHARS = '/\\|-=[]()!7'
//               0  1 2 3 4 56 78 9 10
#define EDGE_SLASH   0
#define EDGE_BSLASH  1
#define EDGE_PIPE    2
#define EDGE_DASH    3
#define EDGE_EQUAL   4
#define EDGE_LBRACK  5
#define EDGE_RBRACK  6
#define EDGE_LPAREN  7
#define EDGE_RPAREN  8
#define EDGE_BANG    9
#define EDGE_SEVEN  10

// Luminance — Rec. 709
#define LUM(c) dot((c).rgb, vec3(0.299, 0.587, 0.114))

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------
float hash21(vec2 p) {
    p  = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

// ---------------------------------------------------------------------------
// Sobel edge detection — returns (magnitude, angle)
// ---------------------------------------------------------------------------
vec2 sobelEdge(vec2 uv, vec2 step) {
    float tl = LUM(texture2D(uImage, uv + vec2(-1, -1) * step));
    float t  = LUM(texture2D(uImage, uv + vec2( 0, -1) * step));
    float tr = LUM(texture2D(uImage, uv + vec2( 1, -1) * step));
    float ml = LUM(texture2D(uImage, uv + vec2(-1,  0) * step));
    float mr = LUM(texture2D(uImage, uv + vec2( 1,  0) * step));
    float bl = LUM(texture2D(uImage, uv + vec2(-1,  1) * step));
    float b  = LUM(texture2D(uImage, uv + vec2( 0,  1) * step));
    float br = LUM(texture2D(uImage, uv + vec2( 1,  1) * step));

    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * t  - tr + bl + 2.0 * b  + br;

    return vec2(length(vec2(gx, gy)), atan(gy, gx));
}

// Local variance for blob detection
float localVariance(vec2 uv, vec2 step) {
    float sum = 0.0, sum2 = 0.0;
    for (float dy = -1.0; dy <= 1.0; dy += 1.0) {
        for (float dx = -1.0; dx <= 1.0; dx += 1.0) {
            float l = LUM(texture2D(uImage, uv + vec2(dx, dy) * step));
            sum  += l;
            sum2 += l * l;
        }
    }
    float mean = sum / 9.0;
    return sum2 / 9.0 - mean * mean;
}

// Multi-scale edge: sample at THREE scales — pixel, mid, and cell level.
// Pixel-level catches fine detail.  Cell-level catches broad shape boundaries
// (the sharp contrasts between dark rocks and bright water, etc).
float multiScaleEdge(vec2 uv, vec2 pixStep, vec2 cellStep, out float angle) {
    vec2 e1 = sobelEdge(uv, pixStep);          // fine detail (~1.5px)
    vec2 e2 = sobelEdge(uv, pixStep * 2.5);    // medium (~4px)
    vec2 e3 = sobelEdge(uv, cellStep * 0.5);   // broad shape boundaries

    // Take the strongest edge at any scale
    float best = e1.x;
    angle = e1.y;
    if (e2.x > best) { best = e2.x; angle = e2.y; }
    if (e3.x > best) { best = e3.x; angle = e3.y; }
    return best;
}

// ---------------------------------------------------------------------------
// Sample a character glyph from the atlas
// ---------------------------------------------------------------------------
float sampleChar(float charIdx, vec2 localUv) {
    vec2 cellSize = 1.0 / uAtlasGrid;
    float col = mod(charIdx, uAtlasGrid.x);
    float row = floor(charIdx / uAtlasGrid.x);
    vec2 origin = vec2(col, row) * cellSize;
    // flipY is disabled on the atlas texture, so canvas y=0 (top) maps
    // to v=0 (bottom in GL).  Flip localUv.y so characters aren't upside down.
    vec2 safeLocal = clamp(localUv, 0.04, 0.96);
    safeLocal.y = 1.0 - safeLocal.y;
    return texture2D(uAtlas, origin + safeLocal * cellSize).r;
}

// ---------------------------------------------------------------------------
// Pick edge character — uses gradient angle to select the best directional
// character.  Returns atlas index (uEdgeOffset + local).
// Uses multiple character options per direction for variety.
// ---------------------------------------------------------------------------
float pickEdgeChar(float angle) {
    // Edge direction is perpendicular to gradient.
    // Quantise to 4 directions — one definitive character per direction,
    // no random variation, so contour lines read clearly.
    float a = mod(angle + PI, PI);

    //   [0,   π/4)  → gradient ~horizontal → edge is VERTICAL   → |
    //   [π/4, π/2)  → gradient ~45°        → edge is DIAGONAL   → /
    //   [π/2, 3π/4) → gradient ~vertical   → edge is HORIZONTAL → -
    //   [3π/4, π)   → gradient ~135°       → edge is DIAGONAL   → backslash
    if (a < 0.7854 || a > 2.3562) return uEdgeOffset + float(EDGE_PIPE);
    if (a < 1.5708)               return uEdgeOffset + float(EDGE_SLASH);
    if (a < 2.3562)               return uEdgeOffset + float(EDGE_DASH);
    return uEdgeOffset + float(EDGE_BSLASH);
}

// ---------------------------------------------------------------------------
// Pick round character by darkness
// ---------------------------------------------------------------------------
float pickRoundIdx(float darkness) {
    if (darkness < 0.25) return float(IDX_DOT);
    if (darkness < 0.40) return float(IDX_o);
    if (darkness < 0.55) return float(IDX_ZERO);
    if (darkness < 0.70) return float(IDX_O);
    return float(IDX_AT);
}

// ---------------------------------------------------------------------------
// Texture-aware character selection.
//
// Atlas layout (relative to uTextureOffset, which sits at TEXTURE_OFFSET=44):
//
//   TEXTURE_CHARS  (0–14)    — original variance-classified set
//     0–4   D  Q  b  p  G    ← round, solid fill (smooth)
//     5–9   m  n  v  w  r    ← angular, multi-stroke (bumpy)
//    10–14  s  e  g  a  u    ← curved, flowing (organic)
//
//   SEMANTIC_CHARS (15–21)   — content-aware additions
//    15  `   low/grassy mark      → smooth (faint flat)
//    16  _   ground / waterline   → smooth (horizontal flat)
//    17  ^   peak / spike         → bumpy (sharp top)
//    18  <   left scale / beak    → bumpy (directional)
//    19  >   right scale / beak   → bumpy (directional)
//    20  {   curly brace open     → organic (curved)
//    21  }   curly brace close    → organic (curved)
//
// Categories now span the full 22-char block. Indices within each category
// aren't contiguous in the atlas, so we map a local idx → relative atlas
// index with explicit branches. GLSL ES 1.0 forbids variable-indexed arrays,
// hence the ternary chains.
// ---------------------------------------------------------------------------
#define SMOOTH_COUNT  7   // D Q b p G _ `
#define BUMPY_COUNT   8   // m n v w r ^ < >
#define ORGANIC_COUNT 7   // s e g a u { }

float pickTextureChar(float variance, float darkness, vec2 cellId) {
    float h = hash21(cellId + 88.0);

    // Classify texture.
    // At pixelStep * 2.5 (~4px), typical variance ranges:
    //   flat sky/water:  0.0001 - 0.001
    //   gentle gradient: 0.001  - 0.004
    //   foliage/texture: 0.004  - 0.02+
    float smoothness = smoothstep(0.002, 0.0005, variance);  // 1.0 for very smooth
    float bumpiness  = smoothstep(0.003, 0.008, variance);   // 1.0 for bumpy

    // Mix darkness + hash so darker cells skew toward later (denser) chars
    // in the category, with hash variety to avoid grid-aligned patterns.
    float pick = darkness * 6.0 + h * 3.0;

    if (smoothness > 0.5) {
        // Smooth (7 chars): D Q b p G _ ` — round/solid + flat low marks.
        // Atlas relative indices: 0,1,2,3,4,16,15
        int idx = int(mod(floor(pick), float(SMOOTH_COUNT)));
        if (idx < 5)    return uTextureOffset + float(idx);
        if (idx == 5)   return uTextureOffset + 16.0;  // _
        return uTextureOffset + 15.0;                  // `
    } else if (bumpiness > 0.5) {
        // Bumpy (8 chars): m n v w r ^ < > — angular + sharp + directional.
        // Atlas relative indices: 5,6,7,8,9,17,18,19
        int idx = int(mod(floor(pick), float(BUMPY_COUNT)));
        if (idx < 5)    return uTextureOffset + 5.0 + float(idx);
        if (idx == 5)   return uTextureOffset + 17.0;  // ^
        if (idx == 6)   return uTextureOffset + 18.0;  // <
        return uTextureOffset + 19.0;                  // >
    } else {
        // Organic (7 chars): s e g a u { } — curved + flowing + curly.
        // Atlas relative indices: 10,11,12,13,14,20,21
        int idx = int(mod(floor(pick), float(ORGANIC_COUNT)));
        if (idx < 5)    return uTextureOffset + 10.0 + float(idx);
        if (idx == 5)   return uTextureOffset + 20.0;  // {
        return uTextureOffset + 21.0;                  // }
    }
}

// ---------------------------------------------------------------------------
// Semantic (content-aware) character selection
// ---------------------------------------------------------------------------
// Classifies the source RGB into one of 15 categories by HSV and picks a
// character from a category-specific 5-stop ramp.  Replaces pickTextureChar
// when uSemanticMode > 0.5.
//
// Category IDs — must match semanticPalette.ts CAT_* constants:
//    0 = GRASS    bright green,    H 75–165°, V > 0.45
//    1 = WATER    blue mid/dark,   H 180–260°, not sky
//    2 = SKY      pale blue,       H 180–260°, V > 0.70, S < 0.40
//    3 = TREE     dark green,      H 75–165°, V ≤ 0.45
//    4 = ROCK     desat warm mid,  H 0–55° or ≥340°, V 0.35–0.60, S < 0.35
//    5 = NEUTRAL  fallback (Nelson 1939 luma ramp)
//    6 = SAND     light warm,      H 20–55°, V > 0.65, S 0.15–0.50
//    7 = DIRT     dark warm,       H 15–50°, V 0.15–0.40, S 0.15–0.55
//    8 = FIRE     saturated warm,  H ≤35° or ≥345°, S > 0.55, V > 0.50
//    9 = SMOKE    light near-grey (also light clouds/snow)
//   10 = SKIN     warm mid,        H 10–50°, V 0.45–0.85, S 0.18–0.55
//   11 = HAIR     dark saturated warm, V < 0.30, S > 0.25
//   12 = FABRIC   purple/pink or warm fallback
//   13 = FUR      dark near-grey
//   14 = METAL    cool low-sat mid-V
// ---------------------------------------------------------------------------

// Sam Hocevar's branch-free RGB→HSV.
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Returns category ID 0–14.
int classifyCell(vec3 rgb) {
    vec3 hsv = rgb2hsv(rgb);
    float h = hsv.x * 360.0;
    float s = hsv.y;
    float v = hsv.z;

    // ── Truly greyscale (s < 0.06) ───────────────────────────────────────
    // Only catches cells with essentially no hue.  Tighter than before so
    // pastel warms (cream, peach, dusty rose) can reach the warm band and
    // classify as SAND / SKIN / FABRIC rather than getting swallowed here.
    if (s < 0.06) {
        if (v > 0.88) return 9;          // SMOKE / snow / cloud
        if (v < 0.25) return 13;         // FUR
        return 5;                         // NEUTRAL
    }

    // ── Green band ───────────────────────────────────────────────────────
    if (h >= 75.0 && h <= 165.0) {
        return v > 0.45 ? 0 : 3;         // GRASS vs TREE
    }

    // ── Blue / cyan band ─────────────────────────────────────────────────
    if (h >= 180.0 && h <= 260.0) {
        return (v > 0.70 && s < 0.40) ? 2 : 1;  // SKY vs WATER
    }

    // ── Warm band (reds, oranges, yellows, browns) ───────────────────────
    // h 0–55 or ≥340 is the "warm" wrap. Most specific branches first.
    if ((h >= 0.0 && h <= 55.0) || h >= 340.0) {
        // Saturated warm red/orange → FIRE (ember / flame)
        if (s > 0.55 && v > 0.50 && (h <= 35.0 || h >= 345.0)) return 8;

        // Bright warm → SAND (includes pastel cream: s as low as 0.06)
        if (h >= 15.0 && h <= 60.0 && v > 0.65) return 6;

        // Dark saturated warm → HAIR
        if (v < 0.30 && s > 0.25) return 11;

        // Dark warm → DIRT
        if (v >= 0.15 && v < 0.40) return 7;

        // Warm mid-V mid-sat → SKIN
        if (h >= 10.0 && h <= 50.0 && v >= 0.40 && v <= 0.85 && s <= 0.55) return 10;

        // Desaturated mid-V warm → ROCK
        if (v >= 0.35 && v < 0.65 && s < 0.30) return 4;

        // Fallback warm (mustard, rust, wine, peachy-violet) → FABRIC
        return 12;
    }

    // ── Purple / pink / magenta band → FABRIC ────────────────────────────
    if (h > 260.0 && h < 340.0) return 12;

    // ── Edge-case low-sat fallback ───────────────────────────────────────
    // Cells with hue outside any named band AND sat ≥ 0.06 land here.
    if (v > 0.65) return 9;   // SMOKE
    if (v > 0.35) return 14;  // METAL
    return 5;                  // NEUTRAL
}

// Atlas index lookup from the semantic palette data texture.
float pickSemanticChar(vec3 rgb, float darkness, vec2 cellId) {
    int cat = classifyCell(rgb);
    float jitter = hash21(cellId * 7.9 + 13.0);
    // Map darkness [0,1] to 5 stops, with mild hash jitter for variety.
    float stop = floor(darkness * 5.0 + (jitter - 0.5) * 0.6);
    stop = clamp(stop, 0.0, 4.0);
    float texX = (float(cat) * 5.0 + stop + 0.5) / uSemanticTexWidth;
    float atlasIdx = texture2D(uSemanticPalette, vec2(texX, 0.5)).r * 255.0;
    return floor(atlasIdx + 0.5);
}

// Debug palette — matches classifyCell category IDs 0–14.
// Each colour is distinct and roughly evocative of its category.
vec3 categoryColor(int cat) {
    if (cat ==  0) return vec3(0.40, 0.85, 0.35);  // GRASS   — bright green
    if (cat ==  1) return vec3(0.20, 0.45, 0.95);  // WATER   — mid blue
    if (cat ==  2) return vec3(0.80, 0.90, 1.00);  // SKY     — pale blue
    if (cat ==  3) return vec3(0.12, 0.42, 0.20);  // TREE    — forest green
    if (cat ==  4) return vec3(0.60, 0.50, 0.42);  // ROCK    — stone brown
    if (cat ==  5) return vec3(0.95, 0.92, 0.85);  // NEUTRAL — cream
    if (cat ==  6) return vec3(0.95, 0.85, 0.55);  // SAND    — tan
    if (cat ==  7) return vec3(0.45, 0.30, 0.18);  // DIRT    — dark brown
    if (cat ==  8) return vec3(1.00, 0.45, 0.15);  // FIRE    — orange
    if (cat ==  9) return vec3(0.85, 0.85, 0.90);  // SMOKE   — silver
    if (cat == 10) return vec3(0.95, 0.75, 0.65);  // SKIN    — peach
    if (cat == 11) return vec3(0.30, 0.18, 0.10);  // HAIR    — dark warm
    if (cat == 12) return vec3(0.70, 0.40, 0.75);  // FABRIC  — violet
    if (cat == 13) return vec3(0.35, 0.30, 0.28);  // FUR     — dark taupe
    return              vec3(0.55, 0.60, 0.65);    // METAL   — steel grey
}

// ---------------------------------------------------------------------------
// Easter-egg word lookup
// ---------------------------------------------------------------------------
float wordLookup(vec2 cellId, float edgeMag) {
    vec2 zoneSize = vec2(max(uWordMaxLen + 4.0, 14.0), 8.0);
    vec2 zoneId   = floor(cellId / zoneSize);
    vec2 cellInZone = cellId - zoneId * zoneSize;

    float zh = hash21(zoneId * 7.31);
    if (zh > 0.22) return -1.0;
    if (edgeMag < 0.06) return -1.0;

    float wordIdx = floor(hash21(zoneId + 100.0) * uWordCount);
    wordIdx = clamp(wordIdx, 0.0, uWordCount - 1.0);

    float startCol = floor(hash21(zoneId + 200.0) * (zoneSize.x - uWordMaxLen));
    float wordRow  = floor(hash21(zoneId + 300.0) * zoneSize.y);

    float charOffset = cellInZone.x - startCol;
    if (abs(cellInZone.y - wordRow) > 0.5) return -1.0;
    if (charOffset < 0.0 || charOffset >= uWordMaxLen) return -1.0;

    float texIdx = wordIdx * uWordMaxLen + charOffset;
    float texCoord = (texIdx + 0.5) / uWordTexWidth;
    float atlasIdx = texture2D(uWordTex, vec2(texCoord, 0.5)).r * 255.0;

    if (atlasIdx < 0.5) return -1.0;
    return floor(atlasIdx + 0.5);
}

// ---------------------------------------------------------------------------
// Clear-zone visibility (overlay mode only).
//
// Returns 1.0 outside the center text-protection zone, 0.0 inside, with a
// smooth fade across the boundary. Multiplied into the overlay alpha so the
// watercolor's paper-white legibility blotch shows through unobstructed.
//
// Geometry mirrors watercolor.frag's clearZoneMask: same WHITE_PROGRESS/
// CLEAR_FADE radii, same origin offset, same landscape squeeze + portrait
// stretch. The fBm warp + grain displacement that gives the watercolor its
// organic edge are intentionally omitted — the watercolor already paints the
// organic white shape underneath, the ASCII just needs to clear matching area.
// ---------------------------------------------------------------------------
float clearZoneVisibility(vec2 uv) {
    const float WHITE_PROGRESS = 0.27;
    const float CLEAR_FADE     = 0.18;

    vec2 origin = vec2(uBloomOrigin.x - 0.02, uBloomOrigin.y);

    float viewAspect      = uResolution.x / uResolution.y;
    float portraitStretch = clamp(1.0 / viewAspect, 1.0, 2.0);
    float desktopSqueeze  = 1.0 - 25.0 / (uResolution.x * WHITE_PROGRESS);
    float xStretch        = viewAspect > 1.0 ? desktopSqueeze : portraitStretch;
    float mobileYStretch  = viewAspect < 1.0 ? 1.0 + 7.5 / (uResolution.y * WHITE_PROGRESS) : 1.0;

    float portraitFactor = clamp(1.0 / viewAspect - 1.0, 0.0, 1.0);
    origin.y -= portraitFactor * 0.036;
    origin.x += portraitFactor * 0.085;

    vec2 diff = uv - origin;
    diff.x /= xStretch;
    diff.y /= mobileYStretch;
    float front = length(diff);

    float animatedWhiteProg = WHITE_PROGRESS * uClearProgress;
    return smoothstep(animatedWhiteProg - CLEAR_FADE, animatedWhiteProg, front);
}

// ---------------------------------------------------------------------------
// Typewriter reveal order
// ---------------------------------------------------------------------------
// Returns 0..1 — how far into a typing pass this cell gets struck. Cells type
// left-to-right, then top-to-bottom.
//
// The catch is speed. Strict per-cell-row reading order puts one full row in
// the pass-0 window divided by the row count: ~102 rows in ~4.2 s is 41 ms
// per row, under three frames at 60 fps, with the carriage crossing 1500 px
// in that time. No viewer resolves that as horizontal motion — all you see is
// rows dropping in, i.e. a top-to-bottom wipe.
//
// So rows are grouped into *type lines* rowsPerLine cells tall, and one line
// is one sweep of the carriage. main() sizes the lines off the pass duration
// (LINE_SECONDS) so a sweep lasts ~20 frames instead of ~2, which is what
// makes the left-to-right motion legible.
//
// RAGGED_CELLS of per-cell slop keeps the sweep edge from reading as a hard
// vertical wipe — struck ink lands unevenly.
#define RAGGED_CELLS 4.0
float typeFrac(vec2 id, vec2 gridDims, float rowsPerLine, float numLines) {
    float rowIdx  = gridDims.y - 1.0 - id.y;      // 0 = top row of the screen
    float line    = floor(rowIdx / rowsPerLine);
    float colFrac = id.x / max(gridDims.x, 1.0);  // 0 = left edge, 1 = right
    colFrac += (hash21(id + 4.0) - 0.5) * (RAGGED_CELLS / max(gridDims.x, 1.0));
    return clamp((line + colFrac) / numLines, 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// Main — edge-priority multi-strike rendering
// ---------------------------------------------------------------------------
void main() {
    vec2 cellPx = vec2(uCellSize, uCellSize * CELL_ASPECT);
    vec2 cellUv = cellPx / uResolution;
    vec2 cellId = floor(vUv / cellUv);

    // Pixel-level step for edge detection — NOT cell-level.
    // The Sobel must sample at image resolution to find real edges.
    vec2 pixelStep = 1.5 / uResolution;

    // Cover-fit UV mapping — must match watercolor.frag exactly so ASCII
    // edges trace the same image the watercolor displays. The cell grid
    // stays in screen-UV space (so glyphs lay out on a regular on-screen
    // grid); only positions/steps fed into uImage samples are transformed.
    float viewAspect = uResolution.x / uResolution.y;
    vec2 coverScale = viewAspect > uImageAspect
        ? vec2(1.0, uImageAspect / viewAspect)   // wide viewport: fill width
        : vec2(viewAspect / uImageAspect, 1.0);  // narrow viewport: fill height
    vec2 imagePixelStep = pixelStep * coverScale;
    vec2 imageCellStep  = cellUv    * coverScale;

    float scrambleT = clamp(uTime / uScrambleDuration, 0.0, 1.0);

    // ── Typewriter timing ────────────────────────────────────────────────
    // ONE carriage sweep inks a cell completely: its edge glyph, every fill
    // overstrike and every tonal layer land as the head passes over, the
    // extra strikes trailing just behind so ink density ramps up in a short
    // tail rather than arriving all at once.
    //
    // This was previously structured as separate full-screen passes — pass
    // s+1 starting only once pass s had typed every cell. That reads as a
    // top-to-bottom wipe however carefully pass 0 is paced, because the
    // fill's visible mass comes from strikes 1..N, and those passes each had
    // to cross the entire screen in a fraction of the budget (~78 ms per
    // line) — far too fast to resolve as horizontal motion. Folding every
    // strike into the cell's own sweep is what makes the texture layer type
    // left-to-right instead of fading in top-to-bottom.
    vec2 gridDims = max(ceil(uResolution / cellPx), vec2(1.0));

    // Type-line height balances two goals pulling in opposite directions:
    //   • short lines — a tall line reveals a chunky slab of image at once
    //   • slow sweeps — a carriage pass has to last enough frames to read as
    //     horizontal motion; strict one-cell-row reading order is ~40 ms per
    //     line, under three frames at 60 fps, which is what made the reveal
    //     look top-to-bottom in the first place.
    // Aim for TARGET_LINE_ROWS and only lengthen the lines when that would
    // push a sweep below MIN_LINE_SECONDS.
    const float TARGET_LINE_ROWS = 3.0;
    const float MIN_LINE_SECONDS = 0.18;
    float wantLines   = ceil(gridDims.y / TARGET_LINE_ROWS);
    float maxLines    = max(floor(uScrambleDuration / MIN_LINE_SECONDS), 1.0);
    float rowsPerLine = max(ceil(gridDims.y / min(wantLines, maxLines)), 1.0);
    float numLines    = ceil(gridDims.y / rowsPerLine);

    // ── What actually makes the sweep read as horizontal ─────────────────
    // A hard-edged reveal only reads as left-to-right when the line is tall
    // enough for the newly-inked sliver to register — which is why the first
    // version of this needed 9-row (76 px) lines, and read as slabs. At 3
    // rows the sliver is 26 px and the eye goes back to seeing nothing but
    // the image growing downward. Line height cannot serve both goals.
    //
    // So the horizontal cue comes from ink SETTLING instead: a cell fades in
    // over FADE_SWEEPS of carriage travel, and its overstrikes trail by
    // STRIKE_LAG each, leaving a long density ramp behind the head. Measured
    // in sweeps, that ramp lies ALONG the line — so every active line carries
    // a dark-left / faint-right gradient that visibly slides rightward, no
    // matter how few rows tall the line is.
    //
    // Widening the fade was a trap under the old strict reading order, where
    // it smeared across rows and collapsed back into a top-to-bottom wipe.
    // Inside a line sweep it stays horizontal, which is what makes it safe.
    const float FADE_SWEEPS = 0.35;   // per-cell fade-in, in carriage sweeps
    const float STRIKE_LAG  = 0.10;   // per-overstrike trail, in sweeps
    float TYPE_FADE = FADE_SWEEPS / numLines;
    float strikeLag = STRIKE_LAG  / numLines;

    // ── Two carriages ────────────────────────────────────────────────────
    // The outline layer (edge contour glyphs) types first; the filler layer
    // (density/texture glyphs and the tonal @ base) follows FILL_DELAY_S
    // seconds behind on the same path. Two heads at different points on the
    // page is the strongest read of "left-to-right, then down" the reveal
    // has: at any moment there is a live band of bare outlines that the
    // filler has not caught up to yet, and that band is bounded left and
    // right by the two carriage positions.
    const float FILL_DELAY_S = 1.0;
    float fillDelay = FILL_DELAY_S / max(uScrambleDuration, 0.001);

    // Reserve room at both ends: the first cell fades in from t=0 instead of
    // popping in at full ink, and the trailing filler carriage — delay plus
    // overstrike tail — still finishes before scrambleT clamps at 1. Tonal
    // runs 5 layers and fill runs up to uFillMaxLayers, so the tail has to
    // cover whichever is deeper.
    float sweepStart = TYPE_FADE;
    float sweepSpan  = max(1.0 - sweepStart - fillDelay
                             - strikeLag * max(uFillMaxLayers - 1.0, 4.0), 0.05);

    // ── Accumulate ink across neighboring cells ───────────────────────────
    float edgeInk = 0.0;      // edge contour characters (full priority)
    float fillInk = 0.0;      // density fill characters
    float wordInk = 0.0;      // easter-egg words
    vec3  edgeColor = vec3(0.0);
    vec3  fillColor = vec3(0.0);

    for (float dy = -1.0; dy <= 1.0; dy += 1.0) {
        for (float dx = -1.0; dx <= 1.0; dx += 1.0) {
            vec2 nId = cellId + vec2(dx, dy);
            vec2 nCenter = (nId + 0.5) * cellUv;
            // Same cell center in image-UV (cover-fit) for uImage sampling.
            vec2 imageNCenter = (nCenter - 0.5) * coverScale + 0.5;

            // ── Per-cell jitter (fully per-cell, no row-coherent offset) ──
            vec2 jit = (hash22(nId * 1.73 + 31.0) - 0.5) * cellUv * vec2(1.1, 0.95);
            vec2 charPos = nCenter + jit;

            float scaleVar = 0.85 + hash21(nId + 77.0) * 0.35;
            vec2 scaledCell = cellUv * scaleVar;

            // ── Local UV ──────────────────────────────────────────────
            vec2 localUv = (vUv - charPos) / scaledCell + 0.5;
            if (localUv.x < -0.08 || localUv.x > 1.08 ||
                localUv.y < -0.08 || localUv.y > 1.08) continue;
            localUv = clamp(localUv, 0.0, 1.0);

            // ── Source image analysis ─────────────────────────────────
            vec3 src = texture2D(uImage, imageNCenter).rgb;
            float luma = LUM(src);
            // Apply contrast curve: push mid-tones apart so light areas
            // are lighter and dark areas are darker.  S-curve via smoothstep.
            float contrastLuma = smoothstep(0.0, 1.0, luma);  // S-curve
            float darkness = 1.0 - contrastLuma;

            if (darkness < 0.03) continue;

            // Ink colour — uniform near-black. Darkness comes from character
            // DENSITY (how many overlap), not from lighter/darker ink.
            float inkVal = mix(0.30, 0.04, uInkDarkness);
            vec3 cellInk = vec3(inkVal);

            // Edge ink — even darker for clear contour lines
            vec3 edgeCellInk = vec3(inkVal * 0.5);

            // ── Typewriter timing for this cell ───────────────────────
            // Two settle times: cellBaseSettle is when the leading outline
            // carriage reaches this cell, cellFillSettle when the trailing
            // filler carriage does. Fill overstrikes trail the latter by
            // strikeLag each.
            float cellFrac    = typeFrac(nId, gridDims, rowsPerLine, numLines);
            float cellBaseSettle = sweepStart + cellFrac * sweepSpan;
            float cellFillSettle = cellBaseSettle + fillDelay;
            float cellBaseAlpha  = smoothstep(cellBaseSettle - TYPE_FADE, cellBaseSettle, scrambleT);
            float cellFillAlpha  = smoothstep(cellFillSettle - TYPE_FADE, cellFillSettle, scrambleT);

            // ── Edge detection (dilated: sample at centre + 4 offsets) ────
            // Dilating the edge detection ensures edges that pass BETWEEN
            // cells still get caught — forming continuous contour lines.
            float edgeAngle;
            float edgeMag = multiScaleEdge(imageNCenter, imagePixelStep, imageCellStep, edgeAngle);

            // Sample 4 diagonal offsets for edge dilation
            float tmpAngle;
            vec2 dilateStep = imageCellStep * 0.4;
            for (int di = 0; di < 4; di++) {
                vec2 dOff = vec2(
                    di < 2 ? dilateStep.x : -dilateStep.x,
                    di == 0 || di == 3 ? dilateStep.y : -dilateStep.y
                );
                float dMag = multiScaleEdge(imageNCenter + dOff, imagePixelStep, imageCellStep, tmpAngle);
                if (dMag > edgeMag) {
                    edgeMag = dMag;
                    edgeAngle = tmpAngle;
                }
            }

            bool hasEdge = edgeMag > uEdgeThreshold;

            // ════════════════════════════════════════════════════════════
            // FILL: texture-aware density characters (ALWAYS computed)
            // ════════════════════════════════════════════════════════════
            {
                // Tolerance gate — suppress mid-tones in flat regions.
                float darkCutoff = mix(0.95, 0.30, uTolerance);
                float gate = smoothstep(darkCutoff, darkCutoff - 0.25, luma);
                gate *= smoothstep(0.97, 0.85, luma);

                if (gate > 0.01) {
                    // ── Typewriter overstrike model ───────────────────
                    // Each character is FAINT. Darkness = more layers piled up.
                    float charAlpha = uFillLayerAlpha;

                    // How many strikes: scales with darkness up to uFillMaxLayers
                    int maxStrikes = 1 + int(floor(darkness * (uFillMaxLayers - 1.0)));

                    float fineVar = localVariance(imageNCenter, imagePixelStep * 2.5);

                    for (int s = 0; s < 12; s++) {
                        if (float(s) >= uFillMaxLayers) break;
                        if (s >= maxStrikes) break;

                        float fs = float(s);

                        // Strike s lands while the filler carriage is still
                        // near this cell, trailing the first strike by
                        // s * lag — the cell darkens as the head moves on,
                        // instead of waiting for its own full-screen pass.
                        float strikeSettle = cellFillSettle + fs * strikeLag;
                        if (scrambleT < strikeSettle - TYPE_FADE) break;
                        float strikeAlpha = smoothstep(strikeSettle - TYPE_FADE, strikeSettle, scrambleT);

                        // Each strike gets its own jitter offset
                        vec2 sJit = (hash22(nId + fs * 137.0 + 600.0) - 0.5) * cellUv * 0.8;
                        float sScale = 0.88 + hash21(nId + fs * 53.0 + 77.0) * 0.28;
                        vec2 sCell = cellUv * sScale;
                        vec2 sLUv = (vUv - charPos - sJit) / sCell + 0.5;

                        if (sLUv.x < -0.05 || sLUv.x > 1.05 ||
                            sLUv.y < -0.05 || sLUv.y > 1.05) continue;
                        sLUv = clamp(sLUv, 0.0, 1.0);

                        // Pick character: semantic (HSV-classified) or texture-variance
                        // depending on uSemanticMode.
                        // Threshold dropped from 0.12 → 0.04 so texture chars
                        // (D Q b p G m n v w r s e g a u) take over for almost
                        // every non-paper cell — the previous threshold gated
                        // most mid-tones into invisible '.' / "'" / ',' specks
                        // from the density ramp.
                        float sIdx;
                        if (darkness > 0.04) {
                            if (uSemanticMode > 0.5) {
                                sIdx = pickSemanticChar(src, darkness, nId + fs * 99.0);
                            } else {
                                sIdx = pickTextureChar(fineVar, darkness, nId + fs * 99.0);
                            }
                        } else {
                            sIdx = floor(darkness * (uRampSize - 1.0) + 0.5);
                            sIdx = clamp(sIdx, 0.0, uRampSize - 1.0);
                        }

                        float g = sampleChar(sIdx, sLUv);
                        float a = g * charAlpha * gate * strikeAlpha;
                        fillInk += a;
                        fillColor += cellInk * a;
                    }

                    // Neill (1982) overstrike: at high darkness, restrike the cell
                    // with 'M'. Persian Cat Head p.82 note: "overtype with letter M
                    // to darken". A single extra strike with heavier alpha pushes
                    // deep shadows toward the authentic built-up-ink feel.
                    // Neill's 'M' restrike is a darkening pass over the fill,
                    // so it rides the trailing filler carriage, not the
                    // leading outline one.
                    if (uNeillOverstrike > 0.5 && darkness > 0.85 &&
                        scrambleT >= cellFillSettle - TYPE_FADE) {
                        vec2 nJit = (hash22(nId + 999.0) - 0.5) * cellUv * 0.5;
                        float nScale = 0.92 + hash21(nId + 888.0) * 0.16;
                        vec2 nCell = cellUv * nScale;
                        vec2 nLUv = (vUv - charPos - nJit) / nCell + 0.5;
                        if (nLUv.x >= -0.05 && nLUv.x <= 1.05 &&
                            nLUv.y >= -0.05 && nLUv.y <= 1.05) {
                            nLUv = clamp(nLUv, 0.0, 1.0);
                            float g  = sampleChar(uNeillCharIdx, nLUv);
                            float a  = g * uFillLayerAlpha * 1.3 * gate * cellFillAlpha;
                            fillInk   += a;
                            fillColor += cellInk * a;
                        }
                    }
                }
            }

            // ════════════════════════════════════════════════════════════
            // EDGE: directional contour characters anchored to the cell
            // grid. No jitter, no scale variation, no fixed pixel size —
            // adjacent edge cells MUST tile seamlessly so / \ | - form
            // continuous contour strokes instead of scattered specks.
            // 3× overstrike at near-black ink builds dense, visible edges.
            // ════════════════════════════════════════════════════════════
            if (hasEdge && scrambleT >= cellBaseSettle - TYPE_FADE) {
                // Edges ride pass 0 (the base typewriter sweep), so they
                // appear at the same moment the cell types its first fill char.
                float edgeIdx = pickEdgeChar(edgeAngle);

                // Edge cell is oversized 1.5× so the glyph spills past the
                // base cell boundary and overlaps neighbors. Courier glyphs
                // only fill ~70% of their atlas cell vertically, leaving a
                // 30% gap between stacked |s at native cell size; 1.5× scale
                // pushes glyph extent to ~105% of cellUv, closing the gap.
                // The 3×3 neighbor loop below ensures up to 9 overlapping
                // edge cells can contribute ink to any fragment.
                vec2 edgeCell = cellUv * 1.5;
                vec2 eLUv = (vUv - nCenter) / edgeCell + 0.5;

                if (eLUv.x >= 0.0 && eLUv.x <= 1.0 &&
                    eLUv.y >= 0.0 && eLUv.y <= 1.0) {
                    float g = sampleChar(edgeIdx, eLUv);
                    float edgeStrength = smoothstep(uEdgeThreshold, uEdgeThreshold + 0.10, edgeMag);
                    float a = g * clamp(edgeStrength * uEdgeMult, 0.0, 1.0) * cellBaseAlpha * 3.0;
                    edgeInk += a;
                    edgeColor += vec3(0.02) * a;
                }
            }

            // ── Easter-egg words ──────────────────────────────────────
            // Words render with CLEAN, non-jittered, non-scaled UVs so each
            // letter sits dead-centre in its cell at uniform size. Using the
            // fill chars' jittered `localUv` stretched each letter by a
            // per-cell scaleVar (0.85×–1.20×), which read as different
            // letter orientations when placed side-by-side in a word.
            if (scrambleT >= 1.0) {
                float wIdx = wordLookup(nId, edgeMag);
                if (wIdx > -0.5) {
                    vec2 wordLocalUv = (vUv - nCenter) / cellUv + 0.5;
                    if (wordLocalUv.x >= 0.0 && wordLocalUv.x <= 1.0 &&
                        wordLocalUv.y >= 0.0 && wordLocalUv.y <= 1.0) {
                        float gw = sampleChar(wIdx, wordLocalUv);
                        wordInk += gw * 0.75;
                    }
                }
            }
        }
    }

    // ── Per-cell source sampling for compositing ───────────────────────
    vec2 ownCenter = (cellId + 0.5) * cellUv;
    vec2 imageOwnCenter = (ownCenter - 0.5) * coverScale + 0.5;
    vec3 ownSrc = texture2D(uImage, imageOwnCenter).rgb;
    float ownLuma = LUM(ownSrc);
    // Apply the same S-curve contrast as the fill/edge paths
    float ownDark = 1.0 - smoothstep(0.0, 1.0, ownLuma);

    // ── Composite ─────────────────────────────────────────────────────────
    vec3 paper = vec3(0.96, 0.94, 0.91);
    vec3 wordColor = vec3(0.20, 0.14, 0.08);

    vec3 color = paper;

    // Parallel accumulator for overlay mode — ink-only over transparent bg.
    // Premultiplied "over": preColor/preAlpha is updated as each ink layer
    // composites on top. Using mix() matches the opaque path exactly when
    // the initial value is 0 (RGB) or 0 (alpha), so the two paths stay in
    // sync layer-for-layer.
    vec3  preColor = vec3(0.0);
    float preAlpha = 0.0;

    // ── Layer 0: TONAL BASE (overlapping @ at same cell scale) ─────────
    // Uses the SAME cell grid as everything else.  Multiple @ at low
    // opacity overlap with jittered offsets — more layers in darker
    // regions so accumulation builds tonal mass, identical in spirit
    // to how the fill/edge system works.
    //
    // Each tonal layer i rides the same typewriter pass as fill strike i,
    // typing in left-to-right top-to-bottom across its own offset grid.

    if (uTonalStrength > 0.01) {
        float perLayer = 0.25 * uTonalStrength;
        float tonalInkVal = mix(0.30, 0.04, uInkDarkness);
        vec3 tonalInk = vec3(tonalInkVal);

        float tonalCoverage = 0.0;

        // 5 offset grids of @ at the normal cell size.
        // Progressively activate based on darkness.
        for (int i = 0; i < 5; i++) {
            // Layer 0 requires ownDark > 0.04 (~luma < 0.89) so near-white
            // paper stays clean; each later layer requires +0.10 more.
            float darkGate = 0.04 + float(i) * 0.10;
            if (ownDark <= darkGate) break;

            // Offset this layer's grid so @ overlap rather than stack
            float fi = float(i);
            vec2 off = cellUv * vec2(
                fract(fi * 0.618 + 0.1) * 2.0 - 1.0,
                fract(fi * 0.437 + 0.2) * 2.0 - 1.0
            ) * 0.9;

            vec2 tId = floor((vUv + off) / cellUv);
            // tCenter must live inside the fragment's shifted-grid cell,
            // else the glyph is clipped to a thin sliver (partial @).
            vec2 tCenter = (tId + 0.5) * cellUv - off;

            // The tonal @ base is part of the filler, so it rides the
            // trailing carriage across its offset grid, on the same lag as
            // fill strike i. `continue` on a not-yet-typed cell — different
            // i's use different grids, so breaking would be unsafe (later
            // i's tId may have lower order).
            float tCellFrac = typeFrac(tId, gridDims, rowsPerLine, numLines);
            float tStrikeSettle = sweepStart + tCellFrac * sweepSpan
                                + fillDelay + fi * strikeLag;
            if (scrambleT < tStrikeSettle - TYPE_FADE) continue;
            float tStrikeAlpha = smoothstep(tStrikeSettle - TYPE_FADE, tStrikeSettle, scrambleT);

            // Small jitter only — any larger would push the glyph outside
            // the cell and reintroduce cell-edge clipping.
            vec2 tJit = (hash22(tId * 1.73 + fi * 100.0 + 31.0) - 0.5) * cellUv * 0.1;
            // Scale + jitter must stay under 1.0 so the full glyph fits
            // in the cell (max half-extent = tScale/2 + jitter = 0.45 + 0.05).
            float tScale = 0.78 + hash21(tId + fi * 50.0 + 77.0) * 0.12;
            vec2 tCharPos = tCenter + tJit;
            vec2 tScaledCell = cellUv * tScale;

            vec2 tLocalUv = (vUv - tCharPos) / tScaledCell + 0.5;
            if (tLocalUv.x < 0.0 || tLocalUv.x > 1.0 ||
                tLocalUv.y < 0.0 || tLocalUv.y > 1.0) continue;

            float g = sampleChar(float(IDX_AT), tLocalUv);
            tonalCoverage += g * perLayer * tStrikeAlpha;
        }

        tonalCoverage = clamp(tonalCoverage, 0.0, 1.0);
        color    = mix(color,    tonalInk, tonalCoverage);
        preColor = mix(preColor, tonalInk, tonalCoverage);
        preAlpha = mix(preAlpha, 1.0,      tonalCoverage);
    }

    // ── Layer 1: density fill characters ─────────────────────────────────
    float fAmt = clamp(fillInk, 0.0, 1.0);
    vec3 avgFill = fillInk > 0.001 ? fillColor / fillInk : vec3(0.06);
    color    = mix(color,    avgFill, fAmt);
    preColor = mix(preColor, avgFill, fAmt);
    preAlpha = mix(preAlpha, 1.0,     fAmt);

    // ── Layer 2: edge contour characters (ON TOP) ──────────────────────
    float eAmt = clamp(edgeInk, 0.0, 1.0);
    vec3 avgEdge = edgeInk > 0.001 ? edgeColor / edgeInk : vec3(0.04);
    color    = mix(color,    avgEdge, eAmt);
    preColor = mix(preColor, avgEdge, eAmt);
    preAlpha = mix(preAlpha, 1.0,     eAmt);

    // ── Layer 3: easter-egg words ────────────────────────────────────────
    float wAmt = clamp(wordInk, 0.0, 0.85);
    color    = mix(color,    wordColor, wAmt);
    preColor = mix(preColor, wordColor, wAmt);
    preAlpha = mix(preAlpha, 1.0,       wAmt);

    // Paper grain — only applied to the opaque paper path
    float grain = hash21(vUv * uResolution * 0.5 + uTime * 0.05) * 0.012;
    color += grain - 0.006;

    // ── Debug: visualise the typewriter reveal order ──────────────────
    // Content-independent view of the two carriages: GREEN once the outline
    // layer has typed a cell, RED once the filler layer has, yellow where
    // both have landed. Checking the sweep against the artwork itself is
    // unreliable — wherever the picture is blank no ink appears, so the
    // front looks like it jumps around. This shows the schedule alone.
    if (uTypeDebug > 0.5) {
        float dFrac     = typeFrac(cellId, gridDims, rowsPerLine, numLines);
        float dBase     = sweepStart + dFrac * sweepSpan;
        float outlineOn = smoothstep(dBase - TYPE_FADE, dBase, scrambleT);
        float fillerOn  = smoothstep(dBase + fillDelay - TYPE_FADE,
                                     dBase + fillDelay, scrambleT);
        color    = vec3(fillerOn, outlineOn, 0.15);
        preColor = color;
        preAlpha = 1.0;
    }

    // ── Debug: visualise raw edge magnitude ───────────────────────────
    if (uDebugEdges > 0.5) {
        vec2 debugCenter = (cellId + 0.5) * cellUv;
        vec2 imageDebugCenter = (debugCenter - 0.5) * coverScale + 0.5;
        float debugAngle;
        float debugEdge = multiScaleEdge(imageDebugCenter, imagePixelStep, imageCellStep, debugAngle);
        // Show edge magnitude as red intensity; threshold line as green
        float r = debugEdge * uEdgeMult * 3.0;
        float g2 = step(uEdgeThreshold, debugEdge);  // binary: above threshold = green
        color = vec3(r, g2 * 0.5, 0.0);
    }

    // ── Debug: visualise semantic classification ──────────────────────
    // Tints each cell by the category classifyCell() assigns. Lets us
    // verify HSV thresholds against real hero images before committing.
    if (uCategoryDebug > 0.5) {
        int dbgCat = classifyCell(ownSrc);
        color = mix(color, categoryColor(dbgCat), 0.55);
    }

    if (uTransparent > 0.5) {
        // Straight-alpha output: de-premultiply to get the un-coverage-weighted
        // ink color, pair with the accumulated coverage as alpha. Three.js
        // default NormalBlending (SrcAlpha, OneMinusSrcAlpha) then composites
        // correctly over whatever sits behind this canvas.
        // Clear-zone mask suppresses ASCII alpha over the center text area so
        // the watercolor's paper-white legibility blotch shows through cleanly.
        vec3 outRGB = preAlpha > 0.001 ? preColor / preAlpha : vec3(0.0);
        float overlayAlpha = preAlpha * clearZoneVisibility(vUv);
        gl_FragColor = vec4(outRGB, overlayAlpha);
    } else {
        gl_FragColor = vec4(color, 1.0);
    }
}
