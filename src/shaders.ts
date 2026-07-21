// GLSL1 shader sources. Fluid passes follow the classic GPU-Gems / Stam
// "stable fluids" formulation (permissively-licensed lineage, cf. PavelDoGreat).
// The fluid produces two textures the rest of the app reads: velocity and curl.

// Fullscreen-quad vertex shader. PlaneGeometry(2,2) gives position in clip space
// directly, so we ignore the camera and write gl_Position from position.xy.
export const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Inject a soft Gaussian blob of velocity (color = vec3(dx, dy, 0)) at a point.
export const splatFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float uAspect;
  uniform vec3 uColor;
  uniform vec2 uPoint;
  uniform float uRadius;
  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`;

// Curl (z-component of the velocity field's curl) = our "shear" signal.
export const curlFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  void main() {
    float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
    float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
    float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
    float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`;

// Vorticity confinement — pushes energy back into the small vortices so the
// turbulent filaments stay crisp instead of smearing out.
export const vorticityFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexel;
  uniform float uCurlStrength;
  uniform float uDt;
  void main() {
    float L = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
    float T = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x;
    float B = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= uCurlStrength * C;
    force.y *= -1.0;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vel += force * uDt;
    vel = clamp(vel, -1000.0, 1000.0);
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

export const divergenceFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  void main() {
    float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
    float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
    float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

export const clearFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uValue;
  void main() {
    gl_FragColor = uValue * texture2D(uTexture, vUv);
  }
`;

// One Jacobi iteration of the pressure solve.
export const pressureFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexel;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

// Subtract the pressure gradient to make the velocity field divergence-free.
export const gradientSubtractFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

// Semi-Lagrangian advection: trace back along velocity and resample.
export const advectionFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 uTexel;
  uniform float uDt;
  uniform float uDissipation;
  uniform float uFloor;
  void main() {
    vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexel;
    vec2 v = uDissipation * texture2D(uSource, coord).xy;
    // linear friction floor: subtract a small constant magnitude each frame so
    // the water actually comes to REST instead of creeping forever (exponential
    // decay never reaches zero). This ends the residual "blips".
    float m = length(v);
    v = m > uFloor ? v * (1.0 - uFloor / m) : vec2(0.0);
    gl_FragColor = vec4(v, 0.0, 1.0);
  }
`;

// ---- particles ----

// Scatter particles randomly. RG = position 0..1, B = emission (glow),
// A = charge (luciferin reserve, starts full at 1.0).
export const particleInitFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float x = hash(vUv);
    float y = hash(vUv + 3.17);
    gl_FragColor = vec4(x, y, 0.0, 1.0);
  }
`;

// Fire-and-recharge flash, faithful to the biology (Latz group; Letendre et al.
// 2024 review): a cell fires when local shear crosses a species threshold, the
// flash is graded by shear magnitude but gated by the cell's remaining luciferin
// CHARGE, firing DEPLETES that charge (a ~200 ms flash for Pyrocystis), and the
// charge recharges slowly — so sustained shear does NOT hold a cell lit. It
// flashes once, goes refractory, and re-stirred water flashes dimmer until it
// recovers. Keeping a region glowing requires fresh, still-charged particles.
// Channels: RG = position, B = emission (visible glow), A = charge (0..1).
export const particleUpdateFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uParticles;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexel;
  uniform float uDt;
  uniform float uSpeed;
  uniform float uShearScale;
  uniform float uGlowThreshold;
  uniform float uGlowGain;
  uniform float uGlowDecay;
  uniform float uRecharge;
  uniform float uSeed;
  uniform float uLifespan;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec4 p = texture2D(uParticles, vUv);
    vec2 pos = p.xy;
    float emission = p.z;
    float charge = p.a;

    // drift gently with the flow
    vec2 vel = texture2D(uVelocity, pos).xy;
    pos = fract(pos + vel * uTexel * uDt * uSpeed);

    // random recycling: each particle has a small per-frame chance to respawn
    // at a fresh spot, so the field stays evenly suspended instead of clumping
    // into bright knots at flow convergence zones. Avg lifetime = uLifespan.
    if (hash(vUv + uSeed) < uDt / uLifespan) {
      pos = vec2(hash(vUv * 1.7 + uSeed), hash(vUv * 2.3 + uSeed + 5.0));
      emission = 0.0;
      charge = 1.0;
    }

    // shear -> stimulus: hard threshold, graded rise, saturating (matches the
    // "threshold, then graded, then plateau" dose-response in the literature)
    float raw = abs(texture2D(uCurl, pos).x);
    float shear = 1.0 - exp(-raw * uShearScale);
    float stim = smoothstep(uGlowThreshold, uGlowThreshold + 0.2, shear);

    // fire: flash intensity is graded by shear but gated by remaining charge;
    // firing burns the reserve (~200 ms to deplete), which then recharges slowly
    float fire = stim * charge;
    emission = max(emission * exp(-uDt * uGlowDecay), fire * uGlowGain);
    charge = clamp(charge - fire * 6.0 * uDt + uRecharge * uDt, 0.0, 1.0);

    gl_FragColor = vec4(pos, min(emission, 1.0), charge);
  }
`;

// Read particle position + brightness from the data texture, draw as a soft
// additive point. Aspect-corrected so points stay round on any screen.
export const particleRenderVert = /* glsl */ `
  precision highp float;
  attribute vec2 ref;
  uniform sampler2D uParticles;
  uniform float uPointSize;
  uniform float uPixelRatio;
  varying float vBright;
  void main() {
    vec4 p = texture2D(uParticles, ref);
    vBright = p.z;
    vec2 clip = p.xy * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
    // dim particles stay tiny star-points; lit ones swell into big soft glow discs
    gl_PointSize = uPointSize * uPixelRatio * (1.0 + 20.0 * vBright * vBright);
  }
`;

export const particleRenderFrag = /* glsl */ `
  precision highp float;
  varying float vBright;
  uniform vec3 uColorDim;
  uniform vec3 uColorBright;
  uniform float uBaseAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;                       // hard round cutoff, no square
    float g = 1.0 - d * 2.0;                     // 1 at center -> 0 at edge
    // soft round glow: a small bright core inside a wide gaussian-ish halo, so
    // the sprite itself IS the glow (no reliance on boxy post-process bloom)
    float halo = pow(g, 2.2);
    float core = pow(g, 8.0) * 0.6;
    float mask = halo + core;
    vec3 col = mix(uColorDim, uColorBright, vBright);
    float intensity = uBaseAlpha + vBright * (1.0 - uBaseAlpha);
    gl_FragColor = vec4(col * intensity * mask, 1.0);
  }
`;
