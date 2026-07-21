import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import GUI from 'lil-gui';
import { FluidSim } from './FluidSim';
import { ParticleField } from './ParticleField';
import { Input } from './Input';

const params = {
  // simulation
  simResolution: 128,
  velocityDissipation: 1.2,
  velocityFloor: 0.5,
  pressureIterations: 20,
  curl: 5,
  splatRadius: 0.25,
  // particles
  particleCount: 65536,
  particleSpeed: 0.4,
  pointSize: 2.5,
  lifespan: 8.0,
  // glow
  shearScale: 0.5,
  glowThreshold: 0.25,
  glowGain: 1.0,
  glowDecay: 3.0,
  recharge: 0.2,
  baseAlpha: 0.06,
  // color
  colorDim: '#0b3d5c',
  colorBright: '#a8f6ff',
  background: '#01030a',
  // bloom
  bloomStrength: 0.3,
  bloomRadius: 0.9,
  bloomThreshold: 0.0,
  // control
  stirrerSpeed: 0.35,
  splatForce: 6000,
};

// debug hook for live tuning from the console
(window as unknown as { __params: typeof params }).__params = params;

const app = document.getElementById('app')!;
const hint = document.getElementById('hint')!;
const fpsEl = document.getElementById('fps')!;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
app.appendChild(renderer.domElement);

const input = new Input(renderer.domElement);
input.stirrerSpeed = params.stirrerSpeed;
input.splatForce = params.splatForce;
input.mouseForce = params.splatForce;

let fluid = new FluidSim(renderer, params.simResolution);
let particles = new ParticleField(renderer, params.particleCount, renderer.getPixelRatio());

// Post-processing: render the particle scene, then bloom, then output.
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
const renderPass = new RenderPass(particles.scene, particles.camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  params.bloomStrength,
  params.bloomRadius,
  params.bloomThreshold,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

renderer.setClearColor(new THREE.Color(params.background), 1);

function rebuildFluid() {
  fluid.dispose();
  fluid = new FluidSim(renderer, params.simResolution);
}

function rebuildParticles() {
  particles.dispose();
  particles = new ParticleField(renderer, params.particleCount, renderer.getPixelRatio());
  renderPass.scene = particles.scene;
  renderPass.camera = particles.camera;
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
  particles.setPixelRatio(renderer.getPixelRatio());
}
window.addEventListener('resize', onResize);

// ---- control panel ----
const gui = new GUI({ title: 'Pyrocystis' });
gui.domElement.style.setProperty('--name-width', '46%');

// A small ⓘ next to each field; hovering it shows what the field does.
const tip = document.createElement('div');
tip.style.cssText =
  'position:fixed;z-index:99999;max-width:250px;padding:7px 10px;' +
  'background:rgba(6,14,26,0.97);color:#c8ecff;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;' +
  'border:1px solid rgba(90,150,200,0.4);border-radius:7px;pointer-events:none;opacity:0;' +
  'transition:opacity .1s ease;box-shadow:0 6px 20px rgba(0,0,0,0.55)';
document.body.appendChild(tip);

function d<T extends { domElement: HTMLElement }>(controller: T, text: string): T {
  const name = (controller.domElement.querySelector('.name') as HTMLElement | null) ?? controller.domElement;
  const marker = document.createElement('span');
  marker.textContent = ' ⓘ';
  marker.style.cssText = 'opacity:0.4;cursor:help;flex:none';
  const move = (e: MouseEvent) => {
    tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 262) + 'px';
    tip.style.top = Math.min(e.clientY + 14, window.innerHeight - 70) + 'px';
  };
  marker.addEventListener('mouseenter', (e) => {
    tip.textContent = text;
    tip.style.opacity = '1';
    move(e);
  });
  marker.addEventListener('mousemove', move);
  marker.addEventListener('mouseleave', () => (tip.style.opacity = '0'));
  name.appendChild(marker);
  controller.domElement.setAttribute('title', text); // native fallback on the whole row
  return controller;
}

const fSim = gui.addFolder('Fluid');
d(fSim.add(params, 'simResolution', [64, 128, 256]).name('sim resolution').onChange(rebuildFluid),
  'Grid resolution of the fluid simulation. Higher = finer swirls and detail, but slower. This is the main framerate dial.');
d(fSim.add(params, 'velocityDissipation', 0, 4, 0.01).name('flow decay'),
  'How fast the water loses energy after you stir. Higher = calms sooner; lower = keeps churning longer.');
d(fSim.add(params, 'velocityFloor', 0, 5, 0.05).name('settle floor'),
  'Friction that brings the water fully to REST so faint eddies stop instead of drifting forever. This is what kills the leftover "blips". Higher = settles sooner.');
d(fSim.add(params, 'pressureIterations', 1, 50, 1).name('pressure iters'),
  'Accuracy of the incompressibility solve. Higher = more stable, cleaner swirls, but slower.');
d(fSim.add(params, 'curl', 0, 20, 0.5).name('vorticity'),
  'Re-injects spin to keep turbulent filaments crisp. Too high and the water self-sustains and never settles (capped low for that reason).');
d(fSim.add(params, 'splatRadius', 0.05, 1, 0.01).name('stir radius'),
  'Size of the disturbance each stir pushes into the water.');

const fPar = gui.addFolder('Particles');
d(fPar.add(params, 'particleCount', { '16k': 16384, '65k': 65536, '260k': 262144 }).name('count').onChange(rebuildParticles),
  'Number of glowing plankton particles. Higher = denser field, but slower.');
d(fPar.add(params, 'particleSpeed', 0, 2, 0.01).name('flow follow'),
  'How strongly particles drift along the water. Low = they mostly stay suspended and light up in place.');
d(fPar.add(params, 'pointSize', 0.5, 8, 0.1).name('point size'),
  'Base size of a resting particle dot. Lit particles swell into large soft glow discs.');
d(fPar.add(params, 'lifespan', 2, 30, 0.5).name('lifespan (s)'),
  'Average seconds before a particle respawns at a fresh spot. Keeps the field evenly suspended instead of clumping into bright knots.');

const fGlow = gui.addFolder('Glow');
d(fGlow.add(params, 'shearScale', 0.05, 3, 0.01).name('sensitivity'),
  'How readily shear registers as a disturbance. Higher = fainter stirs light things up.');
d(fGlow.add(params, 'glowThreshold', 0.02, 0.8, 0.01).name('flash threshold'),
  'How sharp a disturbance must be to flash at all. Higher = only hard stirs glow; lower = a more generous wake.');
d(fGlow.add(params, 'glowGain', 0.2, 2, 0.01).name('flash gain'),
  'Peak brightness of a flash.');
d(fGlow.add(params, 'glowDecay', 0.5, 8, 0.05).name('afterglow fade'),
  'How fast a flash fades once triggered. Higher = shorter, snappier flashes; lower = long lingering tails.');
d(fGlow.add(params, 'recharge', 0.02, 2, 0.01).name('recovery rate'),
  'How fast a flashed particle recharges its light. Low = long refractory period, so re-stirring the same water flashes dimmer (the faithful depletion). High = re-arms quickly.');
d(fGlow.add(params, 'baseAlpha', 0, 0.6, 0.005).name('rest brightness'),
  'Faint glow of un-flashed particles, so the field is a dim starfield rather than pure black.');

const fColor = gui.addFolder('Color');
d(fColor.addColor(params, 'colorDim').name('dim'), 'Color of a particle at rest.');
d(fColor.addColor(params, 'colorBright').name('bright'), 'Color at peak flash. Real dinoflagellate flashes are ~470 nm blue.');
d(fColor.addColor(params, 'background').name('background').onChange((v: string) => {
  renderer.setClearColor(new THREE.Color(v), 1);
  document.body.style.background = v;
}), 'Canvas background color (kept near-black for contrast).');

const fBloom = gui.addFolder('Bloom');
d(fBloom.add(params, 'bloomStrength', 0, 3, 0.01).name('strength').onChange((v: number) => (bloomPass.strength = v)),
  'Intensity of the soft halo bleed added around bright particles. Kept gentle — most of the glow comes from the sprites themselves.');
d(fBloom.add(params, 'bloomRadius', 0, 1.5, 0.01).name('radius').onChange((v: number) => (bloomPass.radius = v)),
  'How far the bloom halo spreads.');
d(fBloom.add(params, 'bloomThreshold', 0, 1, 0.01).name('threshold').onChange((v: number) => (bloomPass.threshold = v)),
  'Brightness a particle must exceed to bloom. 0 = everything blooms a little; higher = only the brightest flashes.');

const fCtl = gui.addFolder('Control');
d(fCtl.add(params, 'stirrerSpeed', 0.05, 1.5, 0.01).name('stir speed').onChange((v: number) => (input.stirrerSpeed = v)),
  'How fast the keyboard stirrer (arrow keys / WASD) glides through the water.');
d(fCtl.add(params, 'splatForce', 500, 20000, 100).name('stir force').onChange((v: number) => {
  input.splatForce = v;
  input.mouseForce = v;
}), 'How hard a stir pushes the water — bigger wake, brighter response.');

d(gui.add({ reset: () => fluid.reset() }, 'reset').name('reset water'),
  'Instantly stills the water (clears all velocity).');
d(gui.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(params, null, 2)) }, 'copy').name('copy settings'),
  'Copies the current settings as JSON so you can save a look you like.');

// ---- loop ----
const clock = new THREE.Clock();
let hintFaded = false;
let fpsAccum = 0;
let fpsFrames = 0;

const colorDim = new THREE.Color();
const colorBright = new THREE.Color();

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (!hintFaded && input.active) {
    hint.classList.add('faded');
    hintFaded = true;
  }

  const aspect = window.innerWidth / window.innerHeight;
  const radius = params.splatRadius / 100;
  for (const s of input.getSplats(dt)) {
    fluid.splat(s.x, s.y, s.dx, s.dy, radius, aspect);
  }

  fluid.step(dt, {
    velocityDissipation: params.velocityDissipation,
    velocityFloor: params.velocityFloor,
    pressureIterations: params.pressureIterations,
    curl: params.curl,
  });

  particles.update(dt, fluid, {
    speed: params.particleSpeed,
    pointSize: params.pointSize,
    lifespan: params.lifespan,
    recharge: params.recharge,
    shearScale: params.shearScale,
    glowThreshold: params.glowThreshold,
    glowGain: params.glowGain,
    glowDecay: params.glowDecay,
    baseAlpha: params.baseAlpha,
    colorDim: colorDim.set(params.colorDim),
    colorBright: colorBright.set(params.colorBright),
  });

  renderer.setRenderTarget(null);
  renderer.clear();
  composer.render();

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = `${Math.round(fpsFrames / fpsAccum)} fps`;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
