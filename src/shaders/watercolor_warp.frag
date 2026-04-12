// watercolor_warp.frag  —  Pass A (half-resolution domain warp)
// Runs at 0.5× screen resolution into an RGBA16F render target.
// Output:  r = r.x  (first warp layer x-component)
//          g = r.y  (first warp layer y-component)
//          b = f    (final scalar domain-warp value, domain-warped fBm)
//          a = q.x  (first noise layer x-component, for coloring in Pass B)
//
// Domain warp recipe: Inigo Quilez — "Painting a Landscape with Maths" (2019)
//   vec2 form verified; NOT the scalar fbm(p+fbm(p+fbm(p))) shorthand.
// fBm: 5 octaves, gain 0.55, lacunarity 2.02 (avoids axial banding on even ratios).
// Noise: Ashima Arts simplex noise (snoise, public domain MIT).
// Temporal drift applied as signed offsets so forward/backward cancel over time.

precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uResolution; // full-res; Pass A runs at 0.5× so actual RT is half this

// ---------------------------------------------------------------------------
// Simplex noise — Ashima Arts / Ian McEwan
// Source: https://github.com/ashima/webgl-noise (MIT licence)
// ---------------------------------------------------------------------------
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857; // 1/7
    vec3  ns  = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ---------------------------------------------------------------------------
// fBm — 5 octaves
// gain 0.55, lacunarity 2.02.
// Closed-form amplitude sum: 0.5*(1 - 0.55^5)/(1 - 0.55) = 1.0552  (v1.1.1 corrected)
// Normalised output range ≈ [-1, 1].
// ---------------------------------------------------------------------------
const float FBM_GAIN       = 0.55;
const float FBM_LACUNARITY = 2.02;
const float FBM_AMPLITUDE_SUM = 1.0552; // corrected from erroneous 0.9651 in v1.1

float fbm(vec3 p) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
        val  += amp * snoise(p * freq);
        amp  *= FBM_GAIN;
        freq *= FBM_LACUNARITY;
    }
    return val / FBM_AMPLITUDE_SUM; // normalise to [-1, 1]
}

// ---------------------------------------------------------------------------
// Quilez vec2 domain warp — full form, verified
// Returns vec4(r.x, r.y, f, q.x) for packing into RGBA16F RT.
// ---------------------------------------------------------------------------
vec4 warpedFbmPack(vec2 p, float t) {
    // Layer 1 — q moves slowly forward on one axis, backward on the other
    vec2 q = vec2(
        fbm(vec3(p + vec2(0.00, 0.00),  0.15 * t)),
        fbm(vec3(p + vec2(5.20, 1.30), -0.15 * t))
    );
    // Layer 2 — r uses q as warp input, slower drift
    vec2 r = vec2(
        fbm(vec3(p + 4.0*q + vec2(1.70, 9.20),  0.20 * t)),
        fbm(vec3(p + 4.0*q + vec2(8.30, 2.80), -0.20 * t))
    );
    // Final scalar — domain warped by r
    float f = fbm(vec3(p + 4.0*r, 0.0));

    return vec4(r, f, q.x);
}

void main() {
    // Aspect-corrected UV so domain warp is isotropic regardless of screen shape
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2(vUv.x * aspect, vUv.y);

    gl_FragColor = warpedFbmPack(p, uTime);
}
