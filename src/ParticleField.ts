import * as THREE from 'three';
import {
  quadVert,
  particleInitFrag,
  particleUpdateFrag,
  particleRenderVert,
  particleRenderFrag,
} from './shaders';
import type { FluidSim } from './FluidSim';

export interface ParticleParams {
  speed: number;
  pointSize: number;
  lifespan: number;
  recharge: number;
  shearScale: number;
  glowThreshold: number;
  glowGain: number;
  glowDecay: number;
  baseAlpha: number;
  colorDim: THREE.Color;
  colorBright: THREE.Color;
}

function makeDataRT(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

/**
 * GPU particle field. Positions live in a ping-pong data texture, advected by
 * the fluid velocity each frame; brightness is driven by the fluid's curl
 * (shear) texture. Rendered as soft additive points — the visual is the glow.
 */
export class ParticleField {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private renderer: THREE.WebGLRenderer;
  private texSize: number;

  private simScene = new THREE.Scene();
  private simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private simQuad: THREE.Mesh;

  private read: THREE.WebGLRenderTarget;
  private write: THREE.WebGLRenderTarget;

  private updateMat: THREE.ShaderMaterial;
  private renderMat: THREE.ShaderMaterial;
  private points: THREE.Points;

  constructor(renderer: THREE.WebGLRenderer, count: number, pixelRatio: number) {
    this.renderer = renderer;
    this.texSize = Math.ceil(Math.sqrt(count));

    this.read = makeDataRT(this.texSize);
    this.write = makeDataRT(this.texSize);

    this.updateMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: particleUpdateFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uParticles: { value: null },
        uVelocity: { value: null },
        uCurl: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uDt: { value: 0.016 },
        uSpeed: { value: 1 },
        uShearScale: { value: 0.5 },
        uGlowThreshold: { value: 0.25 },
        uGlowGain: { value: 1 },
        uGlowDecay: { value: 3 },
        uRecharge: { value: 0.2 },
        uSeed: { value: 0 },
        uLifespan: { value: 8 },
      },
    });

    this.simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.updateMat);
    this.simScene.add(this.simQuad);

    // Seed particle positions.
    const initMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: particleInitFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.simQuad.material = initMat;
    for (const rt of [this.read, this.write]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.simScene, this.simCamera);
    }
    this.renderer.setRenderTarget(null);
    initMat.dispose();
    this.simQuad.material = this.updateMat;

    // One vertex per particle, each pointing at its texel in the data texture.
    const total = this.texSize * this.texSize;
    const refs = new Float32Array(total * 2);
    for (let i = 0; i < total; i++) {
      refs[i * 2 + 0] = ((i % this.texSize) + 0.5) / this.texSize;
      refs[i * 2 + 1] = (Math.floor(i / this.texSize) + 0.5) / this.texSize;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    geo.setAttribute('ref', new THREE.BufferAttribute(refs, 2));

    this.renderMat = new THREE.ShaderMaterial({
      vertexShader: particleRenderVert,
      fragmentShader: particleRenderFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uParticles: { value: this.read.texture },
        uPointSize: { value: 2 },
        uPixelRatio: { value: pixelRatio },
        uColorDim: { value: new THREE.Color('#0b3d5c') },
        uColorBright: { value: new THREE.Color('#a8f6ff') },
        uBaseAlpha: { value: 0.12 },
      },
    });

    this.points = new THREE.Points(geo, this.renderMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  setPixelRatio(pr: number): void {
    this.renderMat.uniforms.uPixelRatio.value = pr;
  }

  update(dt: number, fluid: FluidSim, params: ParticleParams): void {
    const u = this.updateMat.uniforms;
    u.uParticles.value = this.read.texture;
    u.uVelocity.value = fluid.velocityTexture;
    u.uCurl.value = fluid.curlTexture;
    (u.uTexel.value as THREE.Vector2).copy(fluid.texelSize);
    u.uDt.value = dt;
    u.uSpeed.value = params.speed;
    u.uShearScale.value = params.shearScale;
    u.uGlowThreshold.value = params.glowThreshold;
    u.uGlowGain.value = params.glowGain;
    u.uGlowDecay.value = params.glowDecay;
    u.uRecharge.value = params.recharge;
    u.uLifespan.value = params.lifespan;
    u.uSeed.value = Math.random();

    this.simQuad.material = this.updateMat;
    this.renderer.setRenderTarget(this.write);
    this.renderer.render(this.simScene, this.simCamera);
    this.renderer.setRenderTarget(null);

    const t = this.read;
    this.read = this.write;
    this.write = t;

    const r = this.renderMat.uniforms;
    r.uParticles.value = this.read.texture;
    r.uPointSize.value = params.pointSize;
    r.uBaseAlpha.value = params.baseAlpha;
    (r.uColorDim.value as THREE.Color).copy(params.colorDim);
    (r.uColorBright.value as THREE.Color).copy(params.colorBright);
  }

  dispose(): void {
    this.read.dispose();
    this.write.dispose();
    this.points.geometry.dispose();
    this.renderMat.dispose();
    this.updateMat.dispose();
    this.simQuad.geometry.dispose();
  }
}
