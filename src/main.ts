import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import GUI from 'lil-gui';
import { FluidSim } from './FluidSim';
import { ParticleField } from './ParticleField';
import { Input } from './Input';
import type { Splat } from './Input';
import { Conductor } from './Conductor';
import { SEQUENCES } from './sequences';

const params = {
  // simulation
  simResolution: 128,
  velocityDissipation: 1.2,
  velocityFloor: 0.5,
  pressureIterations: 20,
  curl: 5,
  splatRadius: 0.25,
  // particles
  particleCount: 262144,
  particleSpeed: 0.4,
  pointSize: 0.8,
  lifespan: 8.0,
  // glow
  shearScale: 0.5,
  glowThreshold: 0.25,
  glowGain: 0.61,
  glowDecay: 5.5,
  recharge: 1.56,
  baseAlpha: 0.075,
  // color
  colorDim: '#0b3d5c',
  colorBright: '#4fe7f8',
  background: '#01030a',
  // bloom
  bloomStrength: 0.46,
  bloomRadius: 0.93,
  bloomThreshold: 0.0,
  // control
  stirrerSpeed: 0.35,
  splatForce: 6000,
};

/**
 * Touch overrides. The field always fills UV space, so a phone packs the same
 * particle count into roughly a quarter of the screen area — additive rest glow
 * stacks up that much brighter, and a finger drag covers far more UV per event
 * than a mouse does. Thinning the field and easing the stir restores the desktop
 * feel on a phone. The desktop path keeps the values above untouched.
 */
const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
if (isTouch) {
  params.particleCount = 65536;
  params.pointSize = 0.7;
  params.baseAlpha = 0.035;
  params.splatForce = 2200;
}

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
if (isTouch) input.maxSplatDelta = 0.05;

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

/**
 * Show wiring. `?show=1` strips the panel, hint and fps readout for projection;
 * `?seq=<id>` boots straight into one sequence (handy when aiming a projector);
 * `?solo=1` holds that sequence instead of cycling the playlist.
 */
const query = new URLSearchParams(window.location.search);
const showMode = query.has('show');
const conductor = new Conductor(query.get('seq') ?? undefined);
if (query.has('solo')) conductor.autoplay = false;

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

const seqNames: Record<string, string> = {};
for (const s of SEQUENCES) seqNames[s.name] = s.id;
const showProxy = { sequence: conductor.activeId, next: () => conductor.advance() };

const fShow = gui.addFolder('Show');
const seqController = d(
  fShow.add(showProxy, 'sequence', seqNames).name('sequence').onChange((id: string) => conductor.goTo(id)),
  'Which sequence is playing. Switching here crossfades, same as the playlist does.');
d(fShow.add(showProxy, 'next').name('next sequence'),
  'Advance the playlist now. Keyboard: N for next, P for previous.');
d(fShow.add(conductor, 'autoplay').name('autoplay'),
  'Cycle the playlist automatically. Off holds the current sequence indefinitely.');
d(fShow.add(conductor, 'dwell', 5, 300, 1).name('dwell (s)'),
  'How long a sequence holds before the playlist advances.');
d(fShow.add(conductor, 'crossfade', 0, 30, 0.5).name('crossfade (s)'),
  'Transition length. Both look and motion crossfade, so the water reorganizes rather than cutting.');
d(fShow.add(conductor, 'intensity', 0, 2, 0.01).name('intensity'),
  'Global multiplier on scripted stir strength. Raise it if a wall reads too calm from a distance.');

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

gui.close();

// Projection mode: nothing on screen but the water.
if (showMode) {
  gui.hide();
  hint.style.display = 'none';
  fpsEl.style.display = 'none';
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyN') conductor.advance(1);
  else if (e.code === 'KeyP') conductor.advance(-1);
});

// ---- loop ----
const clock = new THREE.Clock();
let hintFaded = false;
let fpsAccum = 0;
let fpsFrames = 0;

const splatBuf: Splat[] = [];

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (!hintFaded && input.active) {
    hint.classList.add('faded');
    hintFaded = true;
  }

  conductor.update(dt);
  const look = conductor.resolve(params);
  if (showProxy.sequence !== conductor.activeId) {
    showProxy.sequence = conductor.activeId;
    seqController.updateDisplay();
  }

  const aspect = window.innerWidth / window.innerHeight;
  const radius = look.splatRadius / 100;
  splatBuf.length = 0;
  conductor.emit(dt, splatBuf);
  // Human input rides on top of the show — a passer-by can always stir.
  for (const s of input.getSplats(dt)) splatBuf.push(s);
  for (const s of splatBuf) {
    fluid.splat(s.x, s.y, s.dx, s.dy, radius, aspect);
  }

  fluid.step(dt, {
    velocityDissipation: look.velocityDissipation,
    velocityFloor: look.velocityFloor,
    pressureIterations: params.pressureIterations,
    curl: look.curl,
  });

  particles.update(dt, fluid, {
    speed: look.particleSpeed,
    pointSize: look.pointSize,
    lifespan: look.lifespan,
    recharge: look.recharge,
    shearScale: look.shearScale,
    glowThreshold: look.glowThreshold,
    glowGain: look.glowGain,
    glowDecay: look.glowDecay,
    baseAlpha: look.baseAlpha,
    colorDim: look.colorDim,
    colorBright: look.colorBright,
  });

  bloomPass.strength = look.bloomStrength;
  bloomPass.radius = look.bloomRadius;
  bloomPass.threshold = look.bloomThreshold;
  renderer.setClearColor(look.background, 1);

  renderer.setRenderTarget(null);
  renderer.clear();
  composer.render();

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = `${Math.round(fpsFrames / fpsAccum)} fps · ${conductor.activeName}`;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
