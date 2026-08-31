// ── Slider panel ───────────────────────────────────────────────────────────

function buildSliders() {
  let container = document.getElementById('sliders');
  for (let key in PARAMS) {
    let p = PARAMS[key];
    let lbl = document.createElement('label');
    lbl.innerHTML = `${p.label} <span class="val" id="v_${key}">${p.val}</span>`;
    let inp = document.createElement('input');
    inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step; inp.value = p.val;
    inp.id = 's_' + key;
    inp.addEventListener('input', () => {
      p.val = parseFloat(inp.value);
      document.getElementById('v_' + key).textContent =
        p.step < 1 ? p.val.toFixed(2) : p.val;
      rebuildFromParams();
      buildHole();
    });
    container.appendChild(lbl);
    container.appendChild(inp);
  }
}

function applyPreset(name) {
  let pre = PRESETS[name];
  for (let k in pre) {
    PARAMS[k].val = pre[k];
    let inp = document.getElementById('s_' + k);
    if (inp) inp.value = pre[k];
    let vEl = document.getElementById('v_' + k);
    if (vEl) vEl.textContent = PARAMS[k].step < 1 ? pre[k].toFixed(2) : pre[k];
  }
  rebuildFromParams();
  buildHole();
  showToast(name);
}

function copyValues() {
  let obj = {};
  for (let k in PARAMS) obj[k] = PARAMS[k].val;
  console.log('Guitar params:', JSON.stringify(obj, null, 2));
  showToast('values copied to console');
}

function showToast(msg) {
  let t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}

// ── Hover HUD ──────────────────────────────────────────────────────────────

function updateHoverHud() {
  const el = document.getElementById('hover');
  if (!el) return;
  const comp = hoveredId ? COMPONENTS.find(c => c.id === hoveredId) : null;
  el.textContent = 'hover: ' + (comp ? comp.label : '—');
  el.style.color = comp ? '#8af' : '#99a';
}
