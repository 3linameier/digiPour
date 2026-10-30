// Side panel: tools, palette, sliders and the tilt pad. All of it reads and writes `app`.

export const DEFAULT_PAINTS = [
  { name: 'Aubergine', color: '#1c0719', metallic: false, cells: false },
  { name: 'Plum', color: '#3d0f4d', metallic: false, cells: false },
  { name: 'Ultramarine', color: '#4335c4', metallic: false, cells: false },
  { name: 'Periwinkle', color: '#6e66ee', metallic: false, cells: false },
  { name: 'Gold', color: '#d8a64c', metallic: true, cells: true },
  { name: 'Copper', color: '#b5583c', metallic: true, cells: false },
  { name: 'Titanium white', color: '#f3efe6', metallic: false, cells: true },
  { name: 'Black', color: '#0c0a0e', metallic: false, cells: false },
];

export const SLIDERS = [
  { key: 'brush', label: 'Brush size', min: 4, max: 60, step: 1 },
  { key: 'flow', label: 'Pour rate', min: 0.01, max: 0.2, step: 0.005 },
  { key: 'thickness', label: 'Paint thickness', min: 0, max: 1, step: 0.01 },
  { key: 'gravity', label: 'Tilt strength', min: 0.02, max: 0.45, step: 0.005 },
  { key: 'cells', label: 'Cells (silicone)', min: 0, max: 1, step: 0.01 },
  { key: 'cellSize', label: 'Cell size', min: 0, max: 1, step: 0.01 },
  { key: 'speed', label: 'Simulation speed', min: 1, max: 14, step: 1 },
];

export function setupUI(app, actions) {
  const tools = document.getElementById('tools');
  const renderTools = () => {
    for (const btn of tools.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tool === app.tool);
    }
  };
  tools.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    app.tool = btn.dataset.tool;
    renderTools();
  });

  const palette = document.getElementById('palette');
  const renderPalette = () => {
    palette.replaceChildren(...app.paints.map((paint, i) => paintSlot(app, paint, i, renderPalette)));
  };

  const sliders = document.getElementById('sliders');
  for (const s of SLIDERS) {
    const label = document.createElement('label');
    const value = document.createElement('span');
    const input = Object.assign(document.createElement('input'), {
      type: 'range', min: s.min, max: s.max, step: s.step, value: app.params[s.key],
    });
    const row = document.createElement('span');
    row.className = 'row';
    row.append(s.label, value);
    const show = () => { value.textContent = String(+(+input.value).toFixed(3)); };
    input.addEventListener('input', () => {
      app.params[s.key] = +input.value;
      show();
    });
    show();
    label.append(row, input);
    sliders.append(label);
  }

  setupTiltPad(app);

  document.getElementById('base').addEventListener('click', actions.baseCoat);
  document.getElementById('save').addEventListener('click', actions.save);
  document.getElementById('clear').addEventListener('click', actions.clear);
  const ground = document.getElementById('ground');
  ground.value = app.ground;
  ground.addEventListener('input', () => { app.ground = ground.value; });

  renderTools();
  renderPalette();
  return { renderTools, renderPalette };
}

// Choose paint i; with `add`, toggle it in the multi-paint cup instead.
export function selectPaint(app, i, add) {
  if (!add) {
    app.selected = [i];
  } else if (app.selected.includes(i)) {
    if (app.selected.length > 1) app.selected = app.selected.filter((s) => s !== i);
  } else {
    app.selected = [...app.selected, i];
  }
}

function paintSlot(app, paint, i, rerender) {
  const slot = document.createElement('div');
  slot.className = 'slot' + (app.selected.includes(i) ? ' selected' : '');

  const swatch = document.createElement('button');
  swatch.className = 'swatch';
  swatch.style.background = paint.color;
  swatch.title = `${paint.name} (${i + 1})`;
  swatch.innerHTML = `<span class="num">${i + 1}</span>`;
  swatch.addEventListener('click', (e) => {
    selectPaint(app, i, e.shiftKey);
    rerender();
  });

  const picker = Object.assign(document.createElement('input'), { type: 'color', value: paint.color });
  picker.title = 'Change colour';
  picker.addEventListener('input', () => {
    paint.color = picker.value;
    swatch.style.background = paint.color;
  });

  const toggle = (key, text, title) => {
    const btn = document.createElement('button');
    btn.className = 'toggle' + (paint[key] ? ' on' : '');
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener('click', () => {
      paint[key] = !paint[key];
      btn.classList.toggle('on', paint[key]);
    });
    return btn;
  };

  slot.append(
    swatch,
    picker,
    toggle('metallic', 'metallic', 'Metallic paint that sparkles'),
    toggle('cells', 'cells', 'This paint pops up through other paint as cells'),
  );
  return slot;
}

function setupTiltPad(app) {
  const pad = document.getElementById('tiltpad');
  const dot = pad.querySelector('.tiltdot');
  const setFromEvent = (e) => {
    const r = pad.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    app.tiltTarget = [x, y];
  };
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    setFromEvent(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (pad.hasPointerCapture(e.pointerId)) setFromEvent(e);
  });
  pad.addEventListener('dblclick', () => { app.tiltTarget = [0, 0]; });

  // Keep the dot in sync with the eased tilt, whatever is driving it.
  const follow = () => {
    dot.style.left = `${50 + app.tilt[0] * 50}%`;
    dot.style.top = `${50 - app.tilt[1] * 50}%`;
    requestAnimationFrame(follow);
  };
  follow();
}
