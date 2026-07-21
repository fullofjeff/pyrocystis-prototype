import * as THREE from 'three';
import {
  quadVert,
  splatFrag,
  curlFrag,
  vorticityFrag,
  divergenceFrag,
  clearFrag,
  pressureFrag,
  gradientSubtractFrag,
  advectionFrag,
} from './shaders';

export interface FluidStepParams {
  velocityDissipation: number;
  velocityFloor: number;
  pressureIterations: number;
  curl: number;
}

interface DoubleFBO {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  swap(): void;
}

function makeRT(size: number, wrap: boolean): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const w = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  rt.texture.wrapS = w;
  rt.texture.wrapT = w;
  return rt;
}

function makeDoubleFBO(size: number, wrap: boolean): DoubleFBO {
  const fbo: DoubleFBO = {
    read: makeRT(size, wrap),
    write: makeRT(size, wrap),
    swap() {
      const t = this.read;
      this.read = this.write;
      this.write = t;
    },
  };
  return fbo;
}

/**
 * GPU stable-fluids simulation. Exposes a divergence-free `velocityTexture`
 * and a `curlTexture` (the shear signal) for downstream consumers.
 */
export class FluidSim {
  readonly texelSize: THREE.Vector2;

  private renderer: THREE.WebGLRenderer;
  private size: number;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;

  private velocity: DoubleFBO;
  private pressure: DoubleFBO;
  private divergence: THREE.WebGLRenderTarget;
  private curl: THREE.WebGLRenderTarget;

  private mSplat: THREE.ShaderMaterial;
  private mCurl: THREE.ShaderMaterial;
  private mVorticity: THREE.ShaderMaterial;
  private mDivergence: THREE.ShaderMaterial;
  private mClear: THREE.ShaderMaterial;
  private mPressure: THREE.ShaderMaterial;
  private mGradient: THREE.ShaderMaterial;
  private mAdvection: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, simResolution: number) {
    this.renderer = renderer;
    this.size = simResolution;
    this.texelSize = new THREE.Vector2(1 / this.size, 1 / this.size);

    this.velocity = makeDoubleFBO(this.size, true);
    this.pressure = makeDoubleFBO(this.size, true);
    this.divergence = makeRT(this.size, true);
    this.curl = makeRT(this.size, true);

    const uTexel = { value: this.texelSize };

    this.mSplat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: splatFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTarget: { value: null },
        uAspect: { value: 1 },
        uColor: { value: new THREE.Vector3() },
        uPoint: { value: new THREE.Vector2() },
        uRadius: { value: 0.0025 },
      },
    });
    this.mCurl = this.mat(curlFrag, { uVelocity: { value: null }, uTexel });
    this.mVorticity = this.mat(vorticityFrag, {
      uVelocity: { value: null },
      uCurl: { value: null },
      uTexel,
      uCurlStrength: { value: 30 },
      uDt: { value: 0.016 },
    });
    this.mDivergence = this.mat(divergenceFrag, { uVelocity: { value: null }, uTexel });
    this.mClear = this.mat(clearFrag, { uTexture: { value: null }, uValue: { value: 0.8 } });
    this.mPressure = this.mat(pressureFrag, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexel,
    });
    this.mGradient = this.mat(gradientSubtractFrag, {
      uPressure: { value: null },
      uVelocity: { value: null },
      uTexel,
    });
    this.mAdvection = this.mat(advectionFrag, {
      uVelocity: { value: null },
      uSource: { value: null },
      uTexel,
      uDt: { value: 0.016 },
      uDissipation: { value: 0.99 },
      uFloor: { value: 1 },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mCurl);
    this.scene.add(this.quad);
  }

  get velocityTexture(): THREE.Texture {
    return this.velocity.read.texture;
  }
  get curlTexture(): THREE.Texture {
    return this.curl.texture;
  }

  private mat(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
  }

  private blit(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  /** Inject velocity (dx, dy) at UV point (x, y). */
  splat(x: number, y: number, dx: number, dy: number, radius: number, aspect: number): void {
    this.mSplat.uniforms.uTarget.value = this.velocity.read.texture;
    this.mSplat.uniforms.uAspect.value = aspect;
    (this.mSplat.uniforms.uColor.value as THREE.Vector3).set(dx, dy, 0);
    (this.mSplat.uniforms.uPoint.value as THREE.Vector2).set(x, y);
    this.mSplat.uniforms.uRadius.value = radius;
    this.blit(this.mSplat, this.velocity.write);
    this.velocity.swap();
  }

  step(dt: number, params: FluidStepParams): void {
    // curl
    this.mCurl.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.mCurl, this.curl);

    // vorticity confinement -> velocity
    this.mVorticity.uniforms.uVelocity.value = this.velocity.read.texture;
    this.mVorticity.uniforms.uCurl.value = this.curl.texture;
    this.mVorticity.uniforms.uCurlStrength.value = params.curl;
    this.mVorticity.uniforms.uDt.value = dt;
    this.blit(this.mVorticity, this.velocity.write);
    this.velocity.swap();

    // divergence
    this.mDivergence.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.mDivergence, this.divergence);

    // decay + solve pressure
    this.mClear.uniforms.uTexture.value = this.pressure.read.texture;
    this.mClear.uniforms.uValue.value = 0.8;
    this.blit(this.mClear, this.pressure.write);
    this.pressure.swap();

    this.mPressure.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < params.pressureIterations; i++) {
      this.mPressure.uniforms.uPressure.value = this.pressure.read.texture;
      this.blit(this.mPressure, this.pressure.write);
      this.pressure.swap();
    }

    // subtract pressure gradient
    this.mGradient.uniforms.uPressure.value = this.pressure.read.texture;
    this.mGradient.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.mGradient, this.velocity.write);
    this.velocity.swap();

    // advect velocity by itself
    this.mAdvection.uniforms.uVelocity.value = this.velocity.read.texture;
    this.mAdvection.uniforms.uSource.value = this.velocity.read.texture;
    this.mAdvection.uniforms.uDt.value = dt;
    this.mAdvection.uniforms.uDissipation.value = 1 / (1 + params.velocityDissipation * dt);
    this.mAdvection.uniforms.uFloor.value = params.velocityFloor;
    this.blit(this.mAdvection, this.velocity.write);
    this.velocity.swap();
  }

  reset(): void {
    this.renderer.setRenderTarget(this.velocity.read);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.velocity.write);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.pressure.read);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.pressure.write);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
  }

  dispose(): void {
    this.velocity.read.dispose();
    this.velocity.write.dispose();
    this.pressure.read.dispose();
    this.pressure.write.dispose();
    this.divergence.dispose();
    this.curl.dispose();
    this.quad.geometry.dispose();
  }
}
