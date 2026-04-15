// watercolor_edge_soften.frag  —  gradient-weighted post-Kuwahara softener
// Runs once after the N_PRE_BLUR Kuwahara chain. Kuwahara is edge-preserving
// by design (it picks the sector with lowest variance), so high-contrast
// silhouettes come out with a ~1-pixel hard transition even when the source
// was pre-softened. This pass undoes that locally: it detects high-gradient
// pixels and mixes in a wider Gaussian only there, leaving flat pigment
// interiors untouched.
//
// 13-tap cross-pattern Gaussian (σ ≈ 1.8 RT px) + luma-gradient gate.

precision highp float;

varying vec2 vUv;

uniform sampler2D uColor;
uniform vec2      uResolution;

const float GRAD_LO = 0.04;
const float GRAD_HI = 0.22;

// Precomputed Gaussian weights for σ = 1.8 at offsets 1, 2, 3 px
const float W1 = 0.857;
const float W2 = 0.540;
const float W3 = 0.249;

void main() {
    vec2 px = 1.0 / uResolution;

    vec3 c0 = texture2D(uColor, vUv).rgb;

    vec3 l1 = texture2D(uColor, vUv + vec2(-px.x,       0.0)).rgb;
    vec3 r1 = texture2D(uColor, vUv + vec2( px.x,       0.0)).rgb;
    vec3 d1 = texture2D(uColor, vUv + vec2( 0.0,       -px.y)).rgb;
    vec3 u1 = texture2D(uColor, vUv + vec2( 0.0,        px.y)).rgb;

    vec3 l2 = texture2D(uColor, vUv + vec2(-2.0 * px.x, 0.0)).rgb;
    vec3 r2 = texture2D(uColor, vUv + vec2( 2.0 * px.x, 0.0)).rgb;
    vec3 d2 = texture2D(uColor, vUv + vec2( 0.0,       -2.0 * px.y)).rgb;
    vec3 u2 = texture2D(uColor, vUv + vec2( 0.0,        2.0 * px.y)).rgb;

    vec3 l3 = texture2D(uColor, vUv + vec2(-3.0 * px.x, 0.0)).rgb;
    vec3 r3 = texture2D(uColor, vUv + vec2( 3.0 * px.x, 0.0)).rgb;
    vec3 d3 = texture2D(uColor, vUv + vec2( 0.0,       -3.0 * px.y)).rgb;
    vec3 u3 = texture2D(uColor, vUv + vec2( 0.0,        3.0 * px.y)).rgb;

    float wSum = 1.0 + 4.0 * (W1 + W2 + W3);
    vec3 soft = (c0
        + W1 * (l1 + r1 + d1 + u1)
        + W2 * (l2 + r2 + d2 + u2)
        + W3 * (l3 + r3 + d3 + u3)) / wSum;

    const vec3 luma = vec3(0.299, 0.587, 0.114);
    float g = abs(dot(l1, luma) - dot(r1, luma))
            + abs(dot(d1, luma) - dot(u1, luma));

    float softAmount = smoothstep(GRAD_LO, GRAD_HI, g);

    gl_FragColor = vec4(mix(c0, soft, softAmount), 1.0);
}
