import * as THREE from 'three';
import type { Splat } from './Input';

/**
 * The subset of parameters a sequence is allowed to drive. Structural knobs
 * (particle count, sim resolution, pressure iterations) are deliberately absent:
 * changing them reallocates render targets and reseeds the field, which reads as
 * a hitch mid-show. Those stay show-level config, set once at load.
 */
export interface Look {
  velocityDissipation: number;
  velocityFloor: number;
  curl: number;
  splatRadius: number;
  particleSpeed: number;
  pointSize: number;
  lifespan: number;
  shearScale: number;
  glowThreshold: number;
  glowGain: number;
  glowDecay: number;
  recharge: number;
  baseAlpha: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  colorDim: string;
  colorBright: string;
  background: string;
}

/** Numeric fields of Look, in one place so the crossfade can walk them. */
export const LOOK_NUMBERS = [
  'velocityDissipation',
  'velocityFloor',
  'curl',
  'splatRadius',
  'particleSpeed',
  'pointSize',
  'lifespan',
  'shearScale',
  'glowThreshold',
  'glowGain',
  'glowDecay',
  'recharge',
  'baseAlpha',
  'bloomStrength',
  'bloomRadius',
  'bloomThreshold',
] as const;

export type LookNumber = (typeof LOOK_NUMBERS)[number];

/** What the render loop actually consumes: colors resolved to THREE.Color. */
export type ResolvedLook = Record<LookNumber, number> & {
  colorDim: THREE.Color;
  colorBright: THREE.Color;
  background: THREE.Color;
};

export interface EmitContext {
  /** Seconds since this sequence became active. */
  t: number;
  dt: number;
  /** Crossfade weight, 0..1. Scale impulses by it so motion fades with the look. */
  weight: number;
}

export interface Sequence {
  id: string;
  name: string;
  description: string;
  /** Crossfaded over the base look while this sequence is active. */
  look: Partial<Look>;
  /** Push this frame's splats. Leave empty for a sequence that only sets a look. */
  emit(ctx: EmitContext, out: Splat[]): void;
}

/**
 * Impulse magnitudes are in the same units as human input: a held arrow key
 * contributes splatForce * dt, about 100 per frame at the default 6000. Scripted
 * emitters run every frame across many points at once, so they sit well below
 * that per emitter. The Show panel's intensity multiplier scales all of them.
 */

/** Deterministic hash in 0..1 — used instead of Math.random so a sequence looks
 *  the same on every machine driving the same wall. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export const SEQUENCES: Sequence[] = [
  {
    id: 'curtains',
    name: 'Curtains',
    description:
      'Vertical light columns that pinch into waists and release. The wall-projection look.',
    look: {
      velocityDissipation: 0.55,
      velocityFloor: 0.2,
      curl: 2,
      splatRadius: 0.42,
      particleSpeed: 0.7,
      pointSize: 2.4,
      lifespan: 14,
      shearScale: 0.85,
      glowThreshold: 0.14,
      glowGain: 0.9,
      glowDecay: 1.4,
      recharge: 0.9,
      baseAlpha: 0.05,
      bloomStrength: 0.62,
      bloomRadius: 0.95,
      colorDim: '#0a2f6b',
      colorBright: '#4fe7f8',
    },
    emit({ t, weight }, out) {
      const cols = 14;
      const rise = 34 * weight;
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) / cols;
        // Upward jet at the base of every column.
        out.push({ x, y: 0.04, dx: 0, dy: rise });
        // Neighbouring columns squeeze toward each other and release. The
        // convergence node travels up the wall, which is what pinches each
        // band into an hourglass waist.
        const sign = i % 2 === 0 ? 1 : -1;
        const phase = t * 0.33 + i * 0.55;
        const y = 0.5 + 0.44 * Math.sin(phase);
        out.push({
          x,
          y,
          dx: sign * 26 * weight * Math.cos(phase * 1.27),
          dy: rise * 0.4,
        });
      }
    },
  },
  {
    id: 'drift',
    name: 'Drift',
    description: 'Calm ambient wander. Long dark stretches with occasional soft flashes.',
    look: {
      velocityDissipation: 1.6,
      velocityFloor: 0.6,
      curl: 6,
      splatRadius: 0.5,
      particleSpeed: 0.32,
      pointSize: 1.1,
      lifespan: 12,
      shearScale: 0.42,
      glowThreshold: 0.3,
      glowGain: 0.55,
      glowDecay: 3.2,
      recharge: 0.35,
      baseAlpha: 0.03,
      bloomStrength: 0.34,
      colorDim: '#08243f',
      colorBright: '#4fe7f8',
    },
    emit({ t, weight }, out) {
      // Three slow Lissajous wanderers, each pushing along its own tangent.
      for (let i = 0; i < 3; i++) {
        const p = t * 0.11 + i * 2.1;
        const a = 1 + i * 0.4;
        const b = 1.3 + i * 0.27;
        const x = 0.5 + 0.36 * Math.sin(p * a);
        const y = 0.5 + 0.32 * Math.cos(p * b);
        out.push({
          x,
          y,
          dx: 15 * weight * Math.cos(p * a),
          dy: -13 * weight * Math.sin(p * b),
        });
      }
    },
  },
  {
    id: 'swell',
    name: 'Swell',
    description: 'A wide pulse rises up the wall every few seconds, lighting a full band.',
    look: {
      velocityDissipation: 0.9,
      velocityFloor: 0.35,
      curl: 4,
      splatRadius: 0.6,
      particleSpeed: 0.6,
      pointSize: 1.9,
      lifespan: 10,
      shearScale: 0.7,
      glowThreshold: 0.18,
      glowGain: 1.1,
      glowDecay: 2.2,
      recharge: 0.7,
      baseAlpha: 0.04,
      bloomStrength: 0.7,
      bloomRadius: 1.0,
      colorDim: '#0b3d5c',
      colorBright: '#7ef0ff',
    },
    emit({ t, weight }, out) {
      const period = 7;
      const phase = (t % period) / period;
      // The band sweeps bottom to top over the first 60% of each period, then rests.
      if (phase > 0.62) return;
      const y = phase / 0.62;
      const points = 18;
      const push = 30 * weight * Math.sin(Math.PI * (phase / 0.62));
      for (let i = 0; i < points; i++) {
        const x = (i + 0.5) / points;
        out.push({ x, y, dx: 6 * weight * Math.sin(x * 9 + t), dy: push });
      }
    },
  },
  {
    id: 'gyre',
    name: 'Gyre',
    description: 'Two slow counter-rotating vortices braid filaments across the middle.',
    look: {
      velocityDissipation: 0.5,
      velocityFloor: 0.25,
      curl: 11,
      splatRadius: 0.3,
      particleSpeed: 0.75,
      pointSize: 1.3,
      lifespan: 16,
      shearScale: 0.6,
      glowThreshold: 0.2,
      glowGain: 0.8,
      glowDecay: 1.9,
      recharge: 0.6,
      baseAlpha: 0.035,
      bloomStrength: 0.5,
      colorDim: '#0a2f6b',
      colorBright: '#4fe7f8',
    },
    emit({ t, weight }, out) {
      const centers = [
        { cx: 0.33, cy: 0.5, spin: 1 },
        { cx: 0.67, cy: 0.5, spin: -1 },
      ];
      const arms = 6;
      for (const { cx, cy, spin } of centers) {
        for (let i = 0; i < arms; i++) {
          const a = t * 0.5 * spin + (i / arms) * Math.PI * 2;
          const r = 0.17;
          out.push({
            x: cx + r * Math.cos(a),
            y: cy + r * Math.sin(a),
            // Tangent to the circle: rotate the radius by 90 degrees.
            dx: -Math.sin(a) * 22 * weight * spin,
            dy: Math.cos(a) * 22 * weight * spin,
          });
        }
      }
    },
  },
  {
    id: 'rain',
    name: 'Rain',
    description: 'Sparse downward streaks that spark where they shear past each other.',
    look: {
      velocityDissipation: 1.9,
      velocityFloor: 0.8,
      curl: 7,
      splatRadius: 0.16,
      particleSpeed: 0.5,
      pointSize: 1.0,
      lifespan: 7,
      shearScale: 0.9,
      glowThreshold: 0.22,
      glowGain: 0.75,
      glowDecay: 4.5,
      recharge: 1.6,
      baseAlpha: 0.025,
      bloomStrength: 0.45,
      colorDim: '#08243f',
      colorBright: '#a8f6ff',
    },
    emit({ t, weight }, out) {
      // Six drops in flight at staggered phases, each on its own column.
      const drops = 6;
      for (let i = 0; i < drops; i++) {
        const speed = 0.22 + hash(i) * 0.2;
        const phase = (t * speed + hash(i + 90)) % 1;
        out.push({
          x: hash(i * 7 + Math.floor(t * speed + hash(i + 90)) * 13),
          y: 1 - phase,
          dx: 0,
          dy: -26 * weight,
        });
      }
    },
  },
];

export function sequenceById(id: string): Sequence | undefined {
  return SEQUENCES.find((s) => s.id === id);
}
