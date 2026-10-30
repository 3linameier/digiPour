// GLSL for the paint simulation.
//
// Units: positions and velocities are in sim texels; velocity is texels per sim step.
// State texture (RGBA32F): r = paint thickness h, gb = velocity, a = silicone.
// Pigment textures (RGBA16F): weights of paints 0-3 (pigA) and 4-7 (pigB), summing to 1.

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
uniform vec2 uRes;

// Texel fetch that returns empty canvas outside the edges, so paint drips off.
vec4 fetch(sampler2D t, ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= int(uRes.x) || p.y >= int(uRes.y)) return vec4(0.0);
  return texelFetch(t, p, 0);
}

// Manual bilinear sampling, since 32-bit float textures aren't always filterable.
vec4 bilerp(sampler2D t, vec2 pos) {
  vec2 q = pos - 0.5;
  vec2 i = floor(q);
  vec2 f = q - i;
  ivec2 p = ivec2(i);
  ivec2 m = ivec2(uRes) - 1;
  vec4 a = texelFetch(t, clamp(p, ivec2(0), m), 0);
  vec4 b = texelFetch(t, clamp(p + ivec2(1, 0), ivec2(0), m), 0);
  vec4 c = texelFetch(t, clamp(p + ivec2(0, 1), ivec2(0), m), 0);
  vec4 d = texelFetch(t, clamp(p + ivec2(1, 1), ivec2(0), m), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
`;

// Velocity update: self-advection, spreading, tilt gravity, silicone push, viscosity.
export const VELOCITY = COMMON + `
uniform sampler2D uState;
uniform vec2 uGravity;
uniform float uPressure;
uniform float uVisc;
uniform float uCellForce;
uniform float uSilDiff;
uniform float uSilDecay;
out vec4 outState;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = fetch(uState, p);
  float h = s.r;
  vec4 l = fetch(uState, p + ivec2(-1, 0));
  vec4 r = fetch(uState, p + ivec2(1, 0));
  vec4 b = fetch(uState, p + ivec2(0, -1));
  vec4 t = fetch(uState, p + ivec2(0, 1));

  vec4 back = bilerp(uState, gl_FragCoord.xy - s.gb);
  float sil = mix(back.a, 0.25 * (l.a + r.a + b.a + t.a), uSilDiff) * uSilDecay;

  vec2 v;
  if (h < 1e-3) {
    // Dry canvas borrows the velocity of wet neighbours so a front can advance.
    float w = l.r + r.r + b.r + t.r;
    v = w > 0.0 ? (l.gb * l.r + r.gb * r.r + b.gb * b.r + t.gb * t.r) / w : vec2(0.0);
  } else {
    v = back.gb;
    v -= uPressure * 0.5 * vec2(r.r - l.r, t.r - b.r);
    v += uGravity;
    // Silicone lowers surface tension, so paint is pulled away from it: cells open up.
    float sl = fetch(uState, p + ivec2(-2, 0)).a, sr = fetch(uState, p + ivec2(2, 0)).a;
    float sb = fetch(uState, p + ivec2(0, -2)).a, st = fetch(uState, p + ivec2(0, 2)).a;
    v -= uCellForce * 0.25 * vec2(sr - sl, st - sb) * min(h, 1.0);
    // Thin paint is held back hard by the canvas, thick paint flows. The canvas grips
    // unevenly, which tears fronts into streaks and fingers.
    vec2 q = gl_FragCoord.xy;
    float grip = 0.45 + 0.7 * vnoise(q * 0.07) + 0.5 * vnoise(q * 0.31);
    v /= 1.08 + uVisc * grip / (h * h + 1e-4);
    float speed = length(v);
    if (speed > 0.45) v *= 0.45 / speed;
  }
  outState = vec4(h, v, sil);
}
`;

// Thickness update: conservative upwind flux across the four cell faces.
export const FLUX = COMMON + `
uniform sampler2D uState;
out vec4 outState;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = fetch(uState, p);
  vec4 l = fetch(uState, p + ivec2(-1, 0));
  vec4 r = fetch(uState, p + ivec2(1, 0));
  vec4 b = fetch(uState, p + ivec2(0, -1));
  vec4 t = fetch(uState, p + ivec2(0, 1));

  float uR = 0.5 * (s.g + r.g), uL = 0.5 * (s.g + l.g);
  float vT = 0.5 * (s.b + t.b), vB = 0.5 * (s.b + b.b);
  float fR = uR > 0.0 ? uR * s.r : uR * r.r;
  float fL = uL > 0.0 ? uL * l.r : uL * s.r;
  float fT = vT > 0.0 ? vT * s.r : vT * t.r;
  float fB = vB > 0.0 ? vB * b.r : vB * s.r;

  float h = s.r - (fR - fL) - (fT - fB);
  outState = vec4(max(h, 0.0), s.gba);
}
`;

// MacCormack step 1: plain semi-Lagrangian advection of the pigment weights.
export const ADVECT = COMMON + `
uniform sampler2D uState;
uniform sampler2D uPigA;
uniform sampler2D uPigB;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

void main() {
  vec2 v = texelFetch(uState, ivec2(gl_FragCoord.xy), 0).gb;
  vec2 uv = (gl_FragCoord.xy - v) / uRes;
  outA = texture(uPigA, uv);
  outB = texture(uPigB, uv);
}
`;

// MacCormack step 2: error correction and clamping, so colour edges stay crisp.
export const CORRECT = COMMON + `
uniform sampler2D uState;
uniform sampler2D uPigA;
uniform sampler2D uPigB;
uniform sampler2D uHatA;
uniform sampler2D uHatB;
uniform float uSharpen;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  vec2 v = s.gb;

  vec2 fwd = (gl_FragCoord.xy + v) / uRes;
  vec4 a = texelFetch(uHatA, p, 0) + 0.5 * (texelFetch(uPigA, p, 0) - texture(uHatA, fwd));
  vec4 b = texelFetch(uHatB, p, 0) + 0.5 * (texelFetch(uPigB, p, 0) - texture(uHatB, fwd));

  ivec2 i = ivec2(floor(gl_FragCoord.xy - v - 0.5));
  ivec2 m = ivec2(uRes) - 1;
  vec4 a0 = texelFetch(uPigA, clamp(i, ivec2(0), m), 0);
  vec4 a1 = texelFetch(uPigA, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
  vec4 a2 = texelFetch(uPigA, clamp(i + ivec2(0, 1), ivec2(0), m), 0);
  vec4 a3 = texelFetch(uPigA, clamp(i + ivec2(1, 1), ivec2(0), m), 0);
  vec4 b0 = texelFetch(uPigB, clamp(i, ivec2(0), m), 0);
  vec4 b1 = texelFetch(uPigB, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
  vec4 b2 = texelFetch(uPigB, clamp(i + ivec2(0, 1), ivec2(0), m), 0);
  vec4 b3 = texelFetch(uPigB, clamp(i + ivec2(1, 1), ivec2(0), m), 0);
  a = clamp(a, min(min(a0, a1), min(a2, a3)), max(max(a0, a1), max(a2, a3)));
  b = clamp(b, min(min(b0, b1), min(b2, b3)), max(max(b0, b1), max(b2, b3)));

  if (s.r < 1e-3) {
    // Dry cells take the colour of the wet paint next to them, ready for when it arrives.
    vec4 sa = vec4(0.0), sb = vec4(0.0);
    float tw = 0.0;
    ivec2 dirs[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));
    for (int k = 0; k < 4; k++) {
      float w = fetch(uState, p + dirs[k]).r;
      sa += w * fetch(uPigA, p + dirs[k]);
      sb += w * fetch(uPigB, p + dirs[k]);
      tw += w;
    }
    if (tw > 1e-5) {
      a = sa / tw;
      b = sb / tw;
    }
  }

  // Acrylics barely mix in a pour: nudge each blend back toward its dominant paint,
  // which also undoes the blurring that resampling causes.
  a = pow(max(a, 0.0), vec4(uSharpen));
  b = pow(max(b, 0.0), vec4(uSharpen));
  float sum = dot(a, vec4(1.0)) + dot(b, vec4(1.0));
  if (sum > 1e-4) {
    a /= sum;
    b /= sum;
  }
  outA = a;
  outB = b;
}
`;

// Brush tools. 0 = pour, 1 = palette knife swipe, 2 = blow, 3 = base coat (whole canvas).
export const TOOL = COMMON + `
uniform sampler2D uState;
uniform sampler2D uPigA;
uniform sampler2D uPigB;
uniform int uMode;
uniform vec2 uPos;
uniform vec2 uPrev;
uniform float uRadius;
uniform float uAmount;
uniform float uDots;
uniform float uSeed;
uniform vec4 uPaintA;
uniform vec4 uPaintB;
uniform vec4 uRevealA;
uniform vec4 uRevealB;
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outA;
layout(location = 2) out vec4 outB;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

void addPaint(inout vec4 s, inout vec4 a, inout vec4 b, float add) {
  float h = s.r + add;
  if (h > 1e-6) {
    a = (a * s.r + uPaintA * add) / h;
    b = (b * s.r + uPaintB * add) / h;
  }
  s.r = h;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 pos = gl_FragCoord.xy;
  vec4 s = texelFetch(uState, p, 0);
  vec4 a = texelFetch(uPigA, p, 0);
  vec4 b = texelFetch(uPigB, p, 0);

  if (uMode == 3) {
    addPaint(s, a, b, uAmount);
  } else {
    float d = segDist(pos, uPrev, uPos);
    float f = exp(-d * d / (uRadius * uRadius));
    vec2 move = uPos - uPrev;

    if (f > 0.003 && uMode == 0) {
      // Fresh paint lands on top and pushes the old paint aside rather than blending into it.
      float disc = smoothstep(uRadius, uRadius * 0.85, d);
      float h0 = s.r;
      // A real stream lands unevenly; the lumps run at different speeds and pull into streaks.
      float lumps = 0.35 + 1.3 * vnoise(pos * 0.12 + uSeed);
      addPaint(s, a, b, uAmount * disc * lumps);
      // Silicone droplets resist being painted over, so cells survive a pour passing across.
      float cover = clamp(uAmount * disc * 8.0 / (h0 + uAmount), 0.0, 1.0) * (1.0 - smoothstep(0.05, 0.3, s.a));
      a = mix(a, uPaintA, cover);
      b = mix(b, uPaintB, cover);
      s.gb += clamp(move * 0.02, -0.2, 0.2) * f;
      if (uDots > 0.0) {
        // Silicone droplets: each one later opens into a cell.
        vec2 cell = floor(pos / 5.0);
        if (hash12(cell + uSeed) < uDots * disc) {
          vec2 c = cell * 5.0 + 2.5 + (hash22(cell + uSeed * 1.37) - 0.5) * 1.5;
          if (distance(pos, c) < 1.2 + 1.2 * hash12(cell + uSeed * 3.1)) {
            s.a += 1.0;
            if (dot(uRevealA + uRevealB, vec4(1.0)) > 0.0) {
              a = uRevealA;
              b = uRevealB;
            }
          }
        }
      }
    } else if (f > 0.003 && uMode == 1) {
      // Palette knife: drag the paint under the blade along with the stroke, scraping it thinner.
      float k = smoothstep(uRadius * 1.1, uRadius * 0.4, d);
      vec2 src = pos - move * k;
      s = bilerp(uState, src);
      a = texture(uPigA, src / uRes);
      b = texture(uPigB, src / uRes);
      s.r *= 1.0 - 0.03 * k;
      s.gb = mix(s.gb, clamp(move * 0.05, -0.45, 0.45), k);
    } else if (f > 0.003 && uMode == 2) {
      // Blow: push paint outward from the nozzle; it spreads thinner as it goes.
      float k = uAmount * f;
      vec2 src = uPos + (pos - uPos) / (1.0 + k);
      s = bilerp(uState, src);
      a = texture(uPigA, src / uRes);
      b = texture(uPigB, src / uRes);
      s.r /= 1.0 + 0.6 * k;
      s.gb += normalize(pos - uPos + 1e-4) * k * 0.3;
    }
  }
  outState = s;
  outA = a;
  outB = b;
}
`;

// Final image: pigment colours, wet gloss, metallic flakes, lacing lines and the bare canvas.
export const RENDER = COMMON + `
uniform sampler2D uState;
uniform sampler2D uPigA;
uniform sampler2D uPigB;
uniform vec3 uColors[8];
uniform vec4 uMetalA;
uniform vec4 uMetalB;
uniform vec3 uGround;
uniform vec2 uTilt;
uniform float uTime;
out vec4 fragColor;

vec3 paintColor(vec2 uv, out float metal) {
  vec4 a = texture(uPigA, uv);
  vec4 b = texture(uPigB, uv);
  float sum = max(dot(a, vec4(1.0)) + dot(b, vec4(1.0)), 1e-4);
  metal = (dot(a, uMetalA) + dot(b, uMetalB)) / sum;
  return (a.x * uColors[0] + a.y * uColors[1] + a.z * uColors[2] + a.w * uColors[3] +
          b.x * uColors[4] + b.y * uColors[5] + b.z * uColors[6] + b.w * uColors[7]) / sum;
}

void main() {
  vec2 pos = vUv * uRes;
  vec2 px = 1.0 / uRes;
  float h = bilerp(uState, pos).r;
  float hx = bilerp(uState, pos + vec2(1, 0)).r - bilerp(uState, pos - vec2(1, 0)).r;
  float hy = bilerp(uState, pos + vec2(0, 1)).r - bilerp(uState, pos - vec2(0, 1)).r;

  float metal, m;
  vec3 col = paintColor(vUv, metal);
  vec3 cx = paintColor(vUv + vec2(px.x, 0.0), m) - paintColor(vUv - vec2(px.x, 0.0), m);
  vec3 cy = paintColor(vUv + vec2(0.0, px.y), m) - paintColor(vUv - vec2(0.0, px.y), m);
  float edge = length(cx) + length(cy);

  // Thin paint lets the darker layers underneath show through.
  col *= 0.72 + 0.36 * smoothstep(0.15, 1.2, h);

  // Surface normal from the thickness, plus a faint skin texture.
  vec2 skin = vec2(vnoise(pos * 0.6) - vnoise(pos * 0.6 + vec2(0.7, 0.0)),
                   vnoise(pos * 0.6) - vnoise(pos * 0.6 + vec2(0.0, 0.7)));
  vec3 n = normalize(vec3(-hx * 4.0 + skin.x * 0.12, -hy * 4.0 + skin.y * 0.12, 1.0));
  vec3 L = normalize(vec3(0.35 - uTilt.x * 0.5 + 0.12 * sin(uTime * 0.4),
                          0.5 - uTilt.y * 0.5 + 0.12 * cos(uTime * 0.31), 0.8));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float shade = 1.0 + 0.8 * (dot(n, L) - L.z);
  float rv = max(dot(reflect(-L, n), V), 0.0);
  float spec = pow(rv, 60.0) + 0.25 * pow(rv, 8.0);

  // Lacing: fine dark lines where two paints meet.
  col *= 1.0 - 0.35 * smoothstep(0.08, 0.5, edge);
  vec3 wet = col * shade + spec * 0.35;

  // Metallic paint: tiny mica flakes that each catch the light at their own angle.
  vec2 r = hash22(floor(pos * 1.7));
  vec3 nf = normalize(n + vec3((r - 0.5) * 1.1, 0.0));
  float sparkle = pow(max(dot(reflect(-L, nf), V), 0.0), 18.0);
  float crinkle = 0.55 * vnoise(pos * 0.45) + 0.45 * vnoise(pos * 1.3);
  vec3 metallic = col * (0.35 + 0.75 * crinkle) * shade
                + mix(col, vec3(1.0, 0.95, 0.85), 0.35) * sparkle * 1.4 + spec * 0.5;
  vec3 paint = mix(wet, metallic, metal);

  float weave = 0.5 + 0.5 * sin(pos.x * 2.2) * sin(pos.y * 2.2);
  vec3 ground = uGround * (0.94 + 0.06 * weave);
  float cover = smoothstep(0.005, 0.05, h);
  fragColor = vec4(mix(ground, paint, cover), 1.0);
}
`;
