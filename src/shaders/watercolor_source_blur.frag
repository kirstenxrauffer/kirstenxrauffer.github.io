// watercolor_source_blur.frag  —  small Gaussian source softener
// Runs once before the N_PRE_BLUR Kuwahara passes. Smears the hard edges
// of the 1200 px source image so the Kuwahara sector means don't latch
// onto source-pixel quantization on high-DPI displays (which would produce
// stair-stepped plateaus on high-contrast silhouettes like bird vs sky).
//
// 9-tap 3×3 kernel, offsets at ±2 RT pixels, weights (1,2,1;2,4,2;1,2,1)/16.

precision highp float;

varying vec2 vUv;

uniform sampler2D uColor;
uniform vec2      uResolution;

const float RADIUS = 2.0; // offset in RT pixels

void main() {
    vec2 px = RADIUS / uResolution;

    vec3 c = vec3(0.0);
    c += texture2D(uColor, vUv).rgb                                  * 4.0;
    c += texture2D(uColor, vUv + vec2( px.x, 0.0 )).rgb              * 2.0;
    c += texture2D(uColor, vUv + vec2(-px.x, 0.0 )).rgb              * 2.0;
    c += texture2D(uColor, vUv + vec2( 0.0,  px.y)).rgb              * 2.0;
    c += texture2D(uColor, vUv + vec2( 0.0, -px.y)).rgb              * 2.0;
    c += texture2D(uColor, vUv + vec2( px.x,  px.y)).rgb             * 1.0;
    c += texture2D(uColor, vUv + vec2(-px.x,  px.y)).rgb             * 1.0;
    c += texture2D(uColor, vUv + vec2( px.x, -px.y)).rgb             * 1.0;
    c += texture2D(uColor, vUv + vec2(-px.x, -px.y)).rgb             * 1.0;

    gl_FragColor = vec4(c / 16.0, 1.0);
}
