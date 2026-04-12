// Shared vertex passthrough — used by both Pass A and Pass B.
// Designed for Three.js ShaderMaterial with PlaneGeometry(2,2) +
// OrthographicCamera(-1,1,1,-1,0,1), which maps plane coords to clip space.
// Three.js auto-prepends projectionMatrix, modelViewMatrix, position, uv.

varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
