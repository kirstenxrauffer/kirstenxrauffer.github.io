// watercolor_blur.frag  —  Kuwahara pre-blur pass
// Run N times into ping-pong render targets before the main watercolor pass.
// Each iteration feeds its own output back as uColor, compounding abstraction.
// After N passes, straight photographic lines are dissolved into organic blobs.
//
// Hardcoded params (not exposed as uniforms — these are baked-in pre-blur):
//   BLUR_RADIUS   12.0 px   — per-pass kernel radius
//   BLUR_SHARP    540.0     — sector selection sharpness (blotchiness ≈ 0.18)
//
// Sample count: 1 center + 8 sectors × 12 radial × 3 angular = 289 taps.

precision highp float;

const float PI = 3.14159265;

varying vec2 vUv;

uniform sampler2D uColor;      // source (hero image on pass 0, RT on subsequent passes)
uniform sampler2D uPaper;      // paper grain — drives directional bias
uniform vec2      uResolution; // full-res pixel dimensions

// Hardcoded blur parameters — tune N_PRE_BLUR in WatercolorCanvas.tsx for strength
const float BLUR_RADIUS = 12.0;   // kernel radius in pixels
const float BLUR_SHARP  = 540.0;  // sector selection sharpness
                                   // mix(800,40,0.18)=540 → moderately distinct pools

// ---------------------------------------------------------------------------
// CMYK ↔ RGB — subtractive blending gives ink-like colour spreading
// ---------------------------------------------------------------------------
vec4 RGBtoCMYK(vec3 rgb) {
    float k = min(1.0 - rgb.r, min(1.0 - rgb.g, 1.0 - rgb.b));
    vec3 cmy = vec3(0.0);
    float invK = 1.0 - k;
    if (invK > 0.001) cmy = (1.0 - rgb - k) / invK;
    return clamp(vec4(cmy, k), 0.0, 1.0);
}

vec3 CMYKtoRGB(vec4 cmyk) {
    float invK = 1.0 - cmyk.w;
    return clamp(vec3(
        1.0 - min(1.0, cmyk.x * invK + cmyk.w),
        1.0 - min(1.0, cmyk.y * invK + cmyk.w),
        1.0 - min(1.0, cmyk.z * invK + cmyk.w)
    ), 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// Generalised Kuwahara filter — identical algorithm to watercolor.frag
// but with hardcoded radius/sharpness so the pre-blur is self-contained.
// ---------------------------------------------------------------------------
vec3 kuwahara(vec2 uv) {
    vec2 px = 1.0 / uResolution;

    // Paper-grain directional bias
    vec2 bias = (texture2D(uPaper, fract(uv * vec2(5.3) * 3.0)).rg * 2.0 - 1.0) * 0.25;

    vec3 centerRGB  = texture2D(uColor, uv).rgb;
    vec4 centerCMYK = RGBtoCMYK(centerRGB);

    vec3  weightedColor = vec3(0.0);
    float weightSum     = 0.0;

    // 8 sectors, PI/4 (45°) each
    for (int s = 0; s < 8; s++) {
        float baseAngle = float(s) * 0.785398; // s * PI/4

        vec4 cmykAcc  = centerCMYK;
        vec3 rgbAcc   = centerRGB;
        vec3 rgbSqAcc = centerRGB * centerRGB;
        float n       = 1.0;

        // 12 radial steps × 3 angular samples per step
        for (int ri = 1; ri <= 12; ri++) {
            float r   = float(ri) / 12.0;            // 0.083 → 1.0
            float rPx = r * BLUR_RADIUS;
            float sw  = exp(-2.0 * r * r);            // Gaussian spatial falloff

            for (int ai = 0; ai < 3; ai++) {
                float a   = (float(ai) - 1.0) * 0.2618; // ±PI/12
                vec2 dir    = vec2(cos(baseAngle + a), sin(baseAngle + a));
                vec2 offset = (dir + bias * r) * rPx * px;

                vec3 sRGB  = texture2D(uColor, uv + offset).rgb;
                vec4 sCMYK = RGBtoCMYK(sRGB);

                cmykAcc  += sCMYK * sw;
                rgbAcc   += sRGB  * sw;
                rgbSqAcc += sRGB  * sRGB * sw;
                n        += sw;
            }
        }

        vec3 mean     = CMYKtoRGB(cmykAcc / n);
        vec3 rgbMean  = rgbAcc / n;
        vec3 variance = max(rgbSqAcc / n - rgbMean * rgbMean, vec3(0.0));
        float v       = dot(variance, vec3(0.299, 0.587, 0.114));

        float w = exp(-v * BLUR_SHARP);
        weightedColor += mean * w;
        weightSum     += w;
    }

    return weightedColor / weightSum;
}

void main() {
    gl_FragColor = vec4(kuwahara(vUv), 1.0);
}
