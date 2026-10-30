import { createContext } from './gl.js';
import { PourSim } from './sim.js';
import { DEFAULT_PAINTS, setupUI, selectPaint } from './ui.js';

// Sim grid, portrait like a stretched canvas.
const SIM_W = 432;
const SIM_H = 512;

const app = {
  paints: DEFAULT_PAINTS.map((p) => ({ ...p })),
  selected: [2],
  tool: 'pour',
  ground: '#ece7dd',
  tilt: [0, 0],
  tiltTarget: [0, 0],
  params: {
    brush: 18,
    flow: 0.1,
    thickness: 0.4,
    gravity: 0.2,
    cells: 0.4,
    cellSize: 0.5,
    speed: 5,
  },
};

const canvas = document.getElementById('canvas');
const frame = document.getElementById('frame');
const brush = document.getElementById('brush');
const status = document.getElementById('status');

let sim;
try {
  sim = new PourSim(createContext(canvas), SIM_W, SIM_H);
} catch (err) {
  const msg = document.createElement('pre');
  msg.className = 'error';
  msg.textContent = err.message;
  frame.replaceWith(msg);
  throw err;
}

const ui = setupUI(app, {
  baseCoat: () => sim.applyTool({ mode: 'base', amount: 0.4, paint: oneHot(app.selected[0]) }),
  clear: () => sim.reset(),
  save,
});

// ---- helpers ---------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function oneHot(i) {
  const v = new Array(8).fill(0);
  if (i >= 0) v[i] = 1;
  return [v.slice(0, 4), v.slice(4)];
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// With several paints in the cup, the stream switches between them in irregular bands.
const cup = { index: 0, switchAt: 0 };
function pourPaint(now) {
  const sel = app.selected;
  if (sel.length === 1) return sel[0];
  if (now > cup.switchAt || cup.index >= sel.length) {
    cup.index = (cup.index + 1 + Math.floor(Math.random() * (sel.length - 1))) % sel.length;
    cup.switchAt = now + 120 + Math.random() * 260;
  }
  return sel[cup.index];
}

// Cells show a different "cells" paint coming up through the one being poured.
function revealPaint(poured) {
  const flagged = app.paints.map((p, i) => (p.cells && i !== poured ? i : -1)).filter((i) => i >= 0);
  return flagged.length ? pick(flagged) : -1;
}

function viewUniforms(time) {
  const colors = new Float32Array(24);
  app.paints.forEach((p, i) => colors.set(hexToRgb(p.color), i * 3));
  const metal = app.paints.map((p) => (p.metallic ? 1 : 0));
  return {
    colors,
    metalA: metal.slice(0, 4),
    metalB: metal.slice(4),
    ground: hexToRgb(app.ground),
    tilt: app.tilt,
    time,
  };
}

function save() {
  // Render and read back in the same task, before the drawing buffer is cleared.
  sim.render(viewUniforms(performance.now() / 1000));
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `digipour-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  a.click();
}

// ---- layout ----------------------------------------------------------------

function resize() {
  const stage = frame.parentElement;
  const availW = stage.clientWidth - 48;
  const availH = stage.clientHeight - 48;
  const cssH = Math.max(200, Math.min(availH, (availW * SIM_H) / SIM_W));
  const cssW = (cssH * SIM_W) / SIM_H;
  // The sim is only ~500 texels tall, so full retina resolution buys little and costs a lot.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  frame.style.width = canvas.style.width = `${cssW}px`;
  frame.style.height = canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---- pointer ---------------------------------------------------------------

const pointer = { down: false, pos: null, applied: null, start: null };

function toSim(e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * SIM_W, (1 - (e.clientY - r.top) / r.height) * SIM_H];
}

function moveBrush(e) {
  const r = canvas.getBoundingClientRect();
  const size = app.tool === 'tilt' ? 24 : app.params.brush * 2.4 * (r.width / SIM_W);
  brush.style.display = 'block';
  brush.style.left = `${e.clientX - r.left}px`;
  brush.style.top = `${e.clientY - r.top}px`;
  brush.style.width = brush.style.height = `${size}px`;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer.down = true;
  pointer.pos = pointer.applied = toSim(e);
  pointer.start = [e.clientX, e.clientY];
});
canvas.addEventListener('pointermove', (e) => {
  moveBrush(e);
  if (!pointer.down) return;
  pointer.pos = toSim(e);
  if (app.tool === 'tilt') {
    // Grabbing the canvas: the further you drag, the steeper the tilt.
    let x = (e.clientX - pointer.start[0]) / 120;
    let y = -(e.clientY - pointer.start[1]) / 120;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    app.tiltTarget = [x, y];
  }
});
const release = () => {
  pointer.down = false;
  if (app.tool === 'tilt') app.tiltTarget = [0, 0];
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => { brush.style.display = 'none'; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- keyboard --------------------------------------------------------------

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const TOOL_KEYS = { KeyP: 'pour', KeyS: 'swipe', KeyB: 'blow', KeyT: 'tilt' };
const held = new Set();

function tiltFromKeys() {
  let x = 0, y = 0;
  for (const k of held) { x += ARROWS[k][0]; y += ARROWS[k][1]; }
  const len = Math.hypot(x, y);
  app.tiltTarget = len ? [x / len, y / len] : [0, 0];
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (ARROWS[e.code]) {
    held.add(e.code);
    tiltFromKeys();
    e.preventDefault();
  } else if (e.code === 'Space') {
    app.tiltTarget = [0, 0];
    e.preventDefault();
  } else if (TOOL_KEYS[e.code]) {
    app.tool = TOOL_KEYS[e.code];
    ui.renderTools();
  } else if (/^Digit[1-8]$/.test(e.code)) {
    selectPaint(app, +e.code.slice(5) - 1, e.shiftKey);
    ui.renderPalette();
  }
});
window.addEventListener('keyup', (e) => {
  if (ARROWS[e.code] && held.delete(e.code)) tiltFromKeys();
});
window.addEventListener('blur', () => { held.clear(); });

// ---- main loop -------------------------------------------------------------

function applyPointerTool(now) {
  const { params } = app;
  const tool = { pos: pointer.pos, prev: pointer.applied, radius: params.brush };
  if (app.tool === 'pour') {
    const poured = pourPaint(now);
    Object.assign(tool, {
      mode: 'pour',
      amount: params.flow,
      paint: oneHot(poured),
      reveal: oneHot(revealPaint(poured)),
      dots: params.cells * 0.03,
    });
  } else if (app.tool === 'swipe') {
    Object.assign(tool, { mode: 'swipe', amount: 1 });
  } else if (app.tool === 'blow') {
    Object.assign(tool, { mode: 'blow', amount: 0.05, prev: pointer.pos });
  } else {
    return;
  }
  sim.applyTool(tool);
  pointer.applied = pointer.pos;
}

let frames = 0;
let fpsTime = performance.now();
let lastLog = fpsTime;

function stepParams() {
  const { params } = app;
  return {
    gravity: app.tilt.map((t) => t * params.gravity),
    pressure: 0.2,
    visc: 0.15 + params.thickness * 1.2,
    cellForce: params.cells * 2,
    silDiff: 0.05 + params.cellSize * 0.15,
    silDecay: 0.996 + params.cellSize * 0.0035,
    sharpen: 1.01,
  };
}

function tick(now) {
  app.tilt = app.tilt.map((t, i) => t + (app.tiltTarget[i] - t) * 0.08);

  if (pointer.down) applyPointerTool(now);

  const step = stepParams();
  for (let i = 0; i < app.params.speed; i++) sim.step(step);
  sim.render(viewUniforms(now / 1000));

  frames++;
  if (now - fpsTime > 500) {
    const fps = (frames * 1000) / (now - fpsTime);
    status.textContent = `${fps.toFixed(0)} fps`;
    if (now - lastLog > 5000) {
      console.log(`[digiPour] ${fps.toFixed(1)} fps, ${(1000 / fps).toFixed(1)} ms/frame`);
      lastLog = now;
    }
    frames = 0;
    fpsTime = now;
  }
}

function loop(now) {
  tick(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Handy for poking at things from the console (and for driving frames in tests).
window.digiPour = { app, sim, stepParams, oneHot, tick };
