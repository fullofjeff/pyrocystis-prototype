import * as THREE from 'three';

export interface Splat {
  x: number; // UV 0..1
  y: number; // UV 0..1 (origin bottom-left)
  dx: number;
  dy: number;
}

/**
 * Normalizes control input into fluid splats. Keyboard-backed now; the same
 * {dir, magnitude} shape maps straight onto the Gamepad API for joysticks
 * later (analog magnitude = the "speed is stealth" lever from the brief).
 */
export class Input {
  /** Invisible stirrer position in UV space, moved by the keys. */
  readonly stirrer = new THREE.Vector2(0.5, 0.5);
  stirrerSpeed = 0.35;
  splatForce = 6000;
  mouseForce = 6000;
  /** Largest UV distance one pointer event may contribute. Touch drags cover far
   *  more UV per event than a mouse; capping keeps a flick from dumping one huge
   *  impulse. Infinity leaves the mouse path exactly as it was. */
  maxSplatDelta = Infinity;

  private keys = new Set<string>();
  private mouseSplats: Splat[] = [];
  /** Last position per active pointer id — a second finger must not measure its
   *  delta from the first finger's position. */
  private pointers = new Map<number, THREE.Vector2>();
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  /** True while a movement key is held (used to fade the on-screen hint). */
  get active(): boolean {
    return this.keys.size > 0 || this.pointers.size > 0;
  }

  private dir(): THREE.Vector2 {
    const d = new THREE.Vector2(0, 0);
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) d.x -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) d.x += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) d.y += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) d.y -= 1;
    if (d.lengthSq() > 0) d.normalize();
    return d;
  }

  /** Advance the stirrer and return this frame's splats. */
  getSplats(dt: number): Splat[] {
    const splats: Splat[] = [];
    const d = this.dir();
    if (d.lengthSq() > 0) {
      this.stirrer.x = (this.stirrer.x + d.x * this.stirrerSpeed * dt + 1) % 1;
      this.stirrer.y = (this.stirrer.y + d.y * this.stirrerSpeed * dt + 1) % 1;
      splats.push({
        x: this.stirrer.x,
        y: this.stirrer.y,
        dx: d.x * this.splatForce * dt,
        dy: d.y * this.splatForce * dt,
      });
    }
    if (this.mouseSplats.length) {
      splats.push(...this.mouseSplats);
      this.mouseSplats = [];
    }
    return splats;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(
        e.code,
      )
    ) {
      this.keys.add(e.code);
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private toUV(e: PointerEvent): THREE.Vector2 {
    return new THREE.Vector2(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, this.toUV(e));
  };

  private onPointerMove = (e: PointerEvent) => {
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const uv = this.toUV(e);
    let dx = uv.x - last.x;
    let dy = uv.y - last.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.maxSplatDelta) {
      const k = this.maxSplatDelta / dist;
      dx *= k;
      dy *= k;
    }
    this.mouseSplats.push({
      x: uv.x,
      y: uv.y,
      dx: dx * this.mouseForce,
      dy: dy * this.mouseForce,
    });
    last.copy(uv);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
  };
}
