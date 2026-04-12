// petal.vert — Per-instance petal animation
//
// All petal positioning, spin, wind, and lifecycle are computed entirely in
// the vertex shader. The CPU only provides spawn positions and birth metadata
// as InstancedBufferAttributes; the InstancedMesh matrices are all identity.
//
// Three.js ShaderMaterial auto-injects:
//   projectionMatrix (mat4), viewMatrix (mat4), modelMatrix (mat4),
//   position (vec3), normal (vec3), uv (vec2)

// Per-instance attributes
attribute vec3  aSpawnPos;            // World spawn position [x ∈ [-100,-95] left edge, y ∈ [14,30], z ∈ [72,76]]
attribute vec4  aBirthLifeSeedScale;  // [birthTime, lifeDuration, seed [0,1], scale]
attribute float aColorIndex;          // Palette index 0–7

uniform float uTime;
uniform vec2  uWindDir;
uniform float uWindSpeed;
uniform float uWindGustStrength;
uniform float uWindGustFreq;
uniform float uDespawnX;
uniform float uSpawnX;

varying float vAlpha;
varying float vColorIndex;
varying vec3  vNormal;
varying vec2  vUv;
varying float vSeed;

mat3 rotateX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0,
                0.0, c,   s,
                0.0, -s,  c);
}

mat3 rotateY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,   0.0, -s,
                0.0, 1.0, 0.0,
                s,   0.0, c);
}

mat3 rotateZ(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,  s,   0.0,
                -s, c,   0.0,
                0.0, 0.0, 1.0);
}

float ss(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

void main() {
    vColorIndex = aColorIndex;
    vUv         = uv;

    float birthTime    = aBirthLifeSeedScale.x;
    float lifeDuration = aBirthLifeSeedScale.y;
    float seed         = aBirthLifeSeedScale.z;
    float scale        = aBirthLifeSeedScale.w;
    vSeed = seed;

    // Age [0,1) — wraps so petals recycle automatically
    float age = fract((uTime - birthTime) / lifeDuration);

    float wrappedTime = mod(uTime, 10000.0);

    float fadeIn = ss(0.0, 0.05, age);

    vec3 pos  = position;
    vec3 norm = normal;

    // Tip bend — UV.y weights toward petal tip
    float bendAngle  = 1.0 * sin(age * 6.2832 + seed * 6.2832);
    float bendWeight = pow(max(uv.y, 0.0), 3.0);
    mat3 bendRot = rotateX(bendAngle * bendWeight);
    pos  = bendRot * pos;
    norm = bendRot * norm;

    // 3D spin — seed-offset phases, keyed to petal age
    float ry = seed * 6.2832 + age * 2.0;
    float rx = (seed + 0.3) * 6.2832 + age * 2.5;
    float rz = (seed + 0.7) * 6.2832 + age * 1.5;
    mat3 spinRot = rotateZ(rz) * rotateX(rx) * rotateY(ry);
    pos  = spinRot * pos;
    norm = spinRot * norm;

    // Wind displacement
    float windTime  = age * lifeDuration;
    vec2 windDisp   = uWindDir * uWindSpeed * windTime;

    // Subtle initial gust at birth
    float gustFade  = 1.0 - ss(0.0, 1.0, age);
    windDisp += uWindDir * (gustFade * 1.5);

    // Gentle periodic gust modulation
    float gustPhase = wrappedTime * uWindGustFreq * 6.2832 + seed * 3.14159;
    windDisp *= (0.9 + (0.5 + 0.5 * sin(gustPhase)) * 0.15);

    // Turbulent swirl
    float turbX = sin(age * 3.5 + seed * 6.2832 + wrappedTime * 0.12) * 0.5
                + sin(age * 6.8 + seed * 3.7   + wrappedTime * 0.28) * 0.2;
    float turbY = cos(age * 2.8 + seed * 5.1   + wrappedTime * 0.10) * 0.35
                + cos(age * 5.6 + seed * 2.8   + wrappedTime * 0.22) * 0.15;
    windDisp += vec2(turbX, turbY);

    pos      *= scale;
    // sqrt(scale) dampens wind for large petals so they don't zoom off-screen prematurely
    windDisp *= sqrt(scale);

    // Remap aSpawnPos.x from [-100,0] to [uSpawnX, uDespawnX]
    float spawnT     = (aSpawnPos.x + 100.0) / 100.0;
    float remappedX  = uSpawnX + spawnT * (uDespawnX - uSpawnX);

    vec3 worldPos = vec3(remappedX, aSpawnPos.y, aSpawnPos.z)
                  + vec3(windDisp.x, windDisp.y, 0.0)
                  + pos;

    // Gentle floating bob
    worldPos.y += sin(age * 3.5 + seed * 6.2832) * 0.8;

    // Upward birth burst
    worldPos.y += 0.6 * ss(0.0, 0.15, age) * (1.0 - ss(0.1, 0.3, age));

    // Edge fade — primary fade mechanism. uDespawnX is exactly the right viewport edge,
    // so petals fade as they cross it, fully transparent 20% past it.
    // At windSpeed=4.0 petals reach uDespawnX at age≈0.84 and are fully gone by age≈0.91.
    float edgeFade = 1.0 - ss(uDespawnX, uDespawnX * 1.2, worldPos.x);

    // Cycle fade — safety net only. Fires over the last 3% of lifecycle (age 0.97→1.0)
    // to prevent a snap-recycle if a petal stalls short of uDespawnX due to turbulence.
    float cycleFade = 1.0 - ss(0.97, 1.0, age);

    vAlpha = fadeIn * min(cycleFade, edgeFade);

    vNormal = normalize(norm);

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
