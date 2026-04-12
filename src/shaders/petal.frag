// petal.frag — Petal color with blotchy watercolor variation
//
// Each petal has organic patches of lighter and darker color driven by 2-octave
// fBm noise on the mesh UVs.  vSeed offsets the noise lookup per-instance so
// no two petals share the same blotch pattern.

precision highp float;

uniform sampler2D uPalette;
uniform float     uGlobalAlpha;

varying float vAlpha;
varying float vColorIndex;
varying vec3  vNormal;
varying vec2  vUv;
varying float vSeed;

// ── Value noise + 2-octave fBm ───────────────────────────────────────────────

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i),                hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

float fbm(vec2 p) {
    return 0.6 * vnoise(p) + 0.4 * vnoise(p * 2.3);
}

// ── Main ─────────────────────────────────────────────────────────────────────

void main() {
    // Base palette color
    float u = (floor(vColorIndex) + 0.5) / 8.0;
    vec3 color = texture2D(uPalette, vec2(u, 0.5)).rgb;

    // 30 % desaturation
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(lum), color, 0.7);

    // ── Blotchy variation — fuchsia pigment blotches ─────────────────────────
    vec2 noiseUV   = vUv * 1.2 + vec2(vSeed * 6.17, vSeed * 3.91);
    // Threshold so only noise peaks become blotches — wide smoothstep range = soft edges
    float blotch   = smoothstep(0.42, 0.92, fbm(noiseUV));
    vec3 deepPurple = vec3(0.38, 0.0, 0.68);                          // deep purple
    color = mix(color, deepPurple, blotch * 0.75);
    // ─────────────────────────────────────────────────────────────────────────

    // Two-sided diffuse — keeps petals shaded correctly while spinning
    vec3 lightDir   = normalize(vec3(1.0, 1.0, 0.5));
    vec3 faceNormal = gl_FrontFacing ? vNormal : -vNormal;
    float diffuse   = max(dot(faceNormal, lightDir), 0.0);
    color *= 0.68 + diffuse * 0.32;

    float alpha = clamp(vAlpha * 2.25, 0.0, 1.0) * uGlobalAlpha;
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
}
