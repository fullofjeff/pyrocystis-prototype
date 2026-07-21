import * as THREE from 'three';
import type { Splat } from './Input';
import {
  LOOK_NUMBERS,
  SEQUENCES,
  sequenceById,
  type EmitContext,
  type Look,
  type ResolvedLook,
  type Sequence,
} from './sequences';

/**
 * Runs the sequence playlist: holds one sequence, crossfades to the next, and
 * resolves the look the render loop should use this frame.
 *
 * Both the look and the motion crossfade together — during a transition the
 * outgoing and incoming sequences both emit, scaled by their weight, so the
 * water reorganizes rather than cutting.
 *
 * Note that a transition is not a seek: the velocity field and the per-particle
 * charge reserve are history-dependent state living in textures, so a sequence
 * never plays back identically. That is by design for an installation, but it
 * means no frame-exact cueing.
 */
export class Conductor {
  autoplay = true;
  /** Seconds a sequence holds before the playlist advances. */
  dwell = 45;
  /** Seconds to crossfade between sequences. */
  crossfade = 8;
  /** Global multiplier on scripted impulse strength. */
  intensity = 1;

  private current: Sequence;
  private previous: Sequence | null = null;
  private tCurrent = 0;
  private tPrevious = 0;
  /** Weight of the current sequence, 0..1. Reaches 1 when the fade completes. */
  private fade = 1;

  private out: ResolvedLook;
  private cDim = new THREE.Color();
  private cBright = new THREE.Color();
  private cBackground = new THREE.Color();
  private tmp = new THREE.Color();
  private ctx: EmitContext = { t: 0, dt: 0, weight: 1 };

  constructor(startId?: string) {
    this.current = (startId && sequenceById(startId)) || SEQUENCES[0];
    this.out = {
      colorDim: this.cDim,
      colorBright: this.cBright,
      background: this.cBackground,
    } as ResolvedLook;
  }

  get activeName(): string {
    return this.current.name;
  }

  get activeId(): string {
    return this.current.id;
  }

  /** Fraction of the dwell elapsed, 0..1 — drives the progress readout. */
  get progress(): number {
    return this.autoplay ? Math.min(this.tCurrent / this.dwell, 1) : 0;
  }

  goTo(id: string): void {
    const next = sequenceById(id);
    if (!next || next === this.current) return;
    this.previous = this.current;
    this.tPrevious = this.tCurrent;
    this.current = next;
    this.tCurrent = 0;
    this.fade = 0;
  }

  advance(step = 1): void {
    const i = SEQUENCES.indexOf(this.current);
    const n = SEQUENCES.length;
    this.goTo(SEQUENCES[(i + step + n) % n].id);
  }

  update(dt: number): void {
    this.tCurrent += dt;
    this.tPrevious += dt;
    if (this.fade < 1) {
      this.fade = this.crossfade > 0 ? Math.min(this.fade + dt / this.crossfade, 1) : 1;
      if (this.fade >= 1) this.previous = null;
    }
    if (this.autoplay && this.fade >= 1 && this.tCurrent >= this.dwell) this.advance();
  }

  /** Push this frame's scripted splats. Human input is added separately, so a
   *  passer-by can always stir on top of whatever the show is doing. */
  emit(dt: number, out: Splat[]): void {
    const push = (seq: Sequence, t: number, weight: number) => {
      if (weight <= 0.001) return;
      this.ctx.t = t;
      this.ctx.dt = dt;
      this.ctx.weight = weight * this.intensity;
      seq.emit(this.ctx, out);
    };
    push(this.current, this.tCurrent, this.fade);
    if (this.previous) push(this.previous, this.tPrevious, 1 - this.fade);
  }

  /** Base look (the tuned defaults, live-editable in the panel) with the active
   *  sequence's overrides crossfaded on top. The returned object is reused. */
  resolve(base: Look): ResolvedLook {
    const cur = { ...base, ...this.current.look };
    const prev = this.previous ? { ...base, ...this.previous.look } : cur;
    const k = this.fade;

    for (const key of LOOK_NUMBERS) {
      this.out[key] = prev[key] + (cur[key] - prev[key]) * k;
    }
    this.cDim.set(prev.colorDim).lerp(this.tmp.set(cur.colorDim), k);
    this.cBright.set(prev.colorBright).lerp(this.tmp.set(cur.colorBright), k);
    this.cBackground.set(prev.background).lerp(this.tmp.set(cur.background), k);
    return this.out;
  }
}
