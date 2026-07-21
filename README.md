# Pyrocystis prototype — "Burglar Alarm" (Phase 1: the look)

A GPU fluid + bioluminescent particle field you stir with the keyboard. Stir the
water hard and the shear lights up the particles (the *Pyrocystis* flash); drift
slowly and it stays dark. This is Phase 1 of the installation game — the *look*
only. No score, no fish, no fail state yet (that's Phase 2, layered on the same
fluid substrate).

## Run

```bash
cd ~/pyrocystis-prototype
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## Controls

- **Arrow keys / WASD** — steer the invisible stirrer through the water.
- **Drag the mouse** — disturb the water directly (fastest way to see vortices).
- **Control panel (top-right)** — live-tune every look/feel parameter.

Joysticks map onto the same input path later via the Gamepad API — `src/Input.ts`
already normalizes to a `{dir, magnitude}` shape.

## Tuning tips

Everything in the panel is live. Good places to start:

- **Glow › sensitivity** and **flash threshold** — together set how much
  disturbance it takes to flash. Raise sensitivity / lower threshold if stirring
  barely lights anything.
- **Glow › afterglow fade** — how fast a flash dies (its visible tail).
- **Glow › recovery rate** — how fast a flashed particle recharges. Low = long
  refractory period, so re-stirring the same water flashes dimmer (the faithful
  "burglar alarm" depletion). High = particles re-arm quickly.
- **Fluid › flow decay** — lower keeps the water churning longer; higher settles
  faster. The glow stays transient either way now (charge depletion handles it),
  so this is purely how alive the *water* looks.
- **Fluid › vorticity** — higher keeps turbulent filaments crisp.
- **Bloom › strength / threshold** — a gentle halo on top of the sprite glow.
- **Color** — `dim`/`bright` ends of the particle gradient. Real dinoflagellate
  flashes peak at ~470 nm blue, if you want to match the biology.

### The flash model (grounded in the literature)

A particle flashes when local shear crosses the threshold, graded by shear
magnitude but **gated by a charge reserve** that firing depletes (~200 ms flash)
and that recharges slowly. So sustained shear does *not* hold a particle lit — it
flashes once, goes refractory, and re-stirred water flashes dimmer until it
recovers. This matches the excitable-membrane, deplete-and-recharge biology of
dinoflagellate bioluminescence (Latz group; Letendre et al. 2024 review). To
keep a region glowing you have to disturb *fresh* water, not hold one spot.

`copy settings` copies the current parameters as JSON so you can save a look you
like.

## Architecture

Three clean layers so Phase 2 (gameplay) is additive, not a rewrite:

- `src/FluidSim.ts` — GPU stable-fluids sim (ping-pong render targets). Exposes
  `velocityTexture` + `curlTexture` (the shear signal).
- `src/ParticleField.ts` — GPU particles advected by the velocity field; glow
  driven by the curl field. Pure visual.
- `src/Input.ts` — keyboard now / Gamepad-ready. Emits fluid splats.
- `src/main.ts` — orchestrator: input → sim → particles → bloom → screen, plus
  the control panel.

The seam that matters: **the fluid produces velocity + curl textures; everything
else reads from those.** A future entity/game layer (copepod, dinoflagellates,
fish) plugs into the same curl field without touching the sim.

Stack: TypeScript + Vite + Three.js (WebGL2) + lil-gui. Fluid math follows the
permissively-licensed GPU-Gems / Stam stable-fluids lineage (no GPL).
