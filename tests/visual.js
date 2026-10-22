// Local visual/geometry regression harness; only loaded by tests/visual.html.
import { CAVE_SITES, caveSection, caveSurface, caveAt } from '../js/habitats.js';
import { Kit } from '../js/shipkit.js';

const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:100;background:#07121de8;color:#d4e7ec;padding:14px;font:12px monospace;max-width:430px;white-space:pre-wrap;pointer-events:auto';
document.body.appendChild(panel);
const select = document.createElement('select');
select.setAttribute('aria-label', 'Review viewpoint');
for (const value of ['reef', 'cave', 'grotto', 'wreck', 'chair', 'surface', 'night', 'trench']) {
  const option = document.createElement('option'); option.value = option.textContent = value; select.appendChild(option);
}
panel.appendChild(select);
const report = document.createElement('pre'); panel.appendChild(report);
const checks = [], errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ').slice(0, 300)); originalError(...args); };
addEventListener('error', e => errors.push(e.message));
const check = (name, ok) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

async function ready() {
  const deadline = performance.now() + 120000;
  while (document.getElementById('go').disabled) {
    if (performance.now() > deadline) throw new Error('Scene loading timed out');
    await new Promise(r => setTimeout(r, 250));
  }
  const o = window.__ocean, T = o.THREE;
  check('All scene modules loaded', ['seafloor', 'reefs', 'life', 'wrecks', 'trench', 'bubbles', 'birds', 'audio'].every(name => !!o.mods[name]));
  check('12 photographic maps loaded', o.textureStatus.loaded === 12 && !o.textureStatus.failed.length);
  check('Native resolution retained', o.renderer.getPixelRatio() === Math.min(devicePixelRatio, 2));
  check('All five wrecks built', o.mods.wrecks.list.filter(w => w.id !== 'debris').length === 5);
  let finite = true, vertices = 0;
  const unique = new Set();
  o.scene.traverse(mesh => {
    if (!mesh.geometry || unique.has(mesh.geometry)) return;
    unique.add(mesh.geometry);
    const p = mesh.geometry.getAttribute('position');
    if (!p) return;
    vertices += p.count;
    for (const n of p.array) if (!Number.isFinite(n)) finite = false;
  });
  check('All scene vertices finite', finite);
  for (const c of CAVE_SITES) {
    const s = caveSection(c, 0.25);
    check(`${c.id}: clear central route`, !o.mods.reefs.isRock(new T.Vector3(s.x, s.y, s.z), 1.7));
    check(`${c.id}: shell collision matches mesh`, o.mods.reefs.isRock(caveSurface(c, 0.25, 0), 0.1));
    check(`${c.id}: inside detection`, caveAt(new T.Vector3(s.x, s.y, s.z)) === c);
    const p = new T.Vector3(s.x + 60, s.y, s.z), from = new T.Vector3(s.x, s.y, s.z), v = new T.Vector3(100, 0, 0);
    o.mods.reefs.collide(p, v, from);
    check(`${c.id}: fast movement stops at wall`, p.distanceTo(from) < 50 && v.length() === 0);
  }
  const furniture = new Kit('Regression chairs', 511);
  furniture.chair(0, 0, 0, 0);
  const ys = Object.values(furniture.parts).flatMap(b => b.pos.filter((_, i) => i % 3 === 1));
  check('Broken chair rests on floor', Math.min(...ys) >= -0.001 && Math.min(...ys) < 0.04);
  check('Chair includes joinery and fractured wood', furniture.parts.furn.pos.length > 2500 && !!furniture.parts.iron);
  const found = new Set(); o.scene.traverse(m => { if (m.material?.userData?.photographic) found.add(m.material.userData.photographic); });
  check('All four photographic surfaces attached', found.size === 4);
  document.getElementById('go').click();
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM' }));
  const aim = (p, target) => {
    o.camera.position.copy(p);
    const d = target.clone().sub(p);
    o.setView(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
  };
  const view = () => {
    const v = select.value;
    if (v === 'surface' || v === 'night') {
      o.day.seconds = v === 'night' ? 800 : 0;
      aim(new T.Vector3(0, 2.2, 0), new T.Vector3(0, 0, -100)); return;
    }
    if (v === 'trench') { o.jumpTo(10850); return; }
    if (v === 'wreck' || v === 'chair') {
      const w = o.mods.wrecks.list.find(w => w.id === 'liner');
      const room = w.rooms.find(r => /dining/i.test(r.name));
      const floor = room?.min.y ?? 4.8;
      const p = v === 'chair' ? new T.Vector3(47.5, floor + 1.65, 6) : new T.Vector3(43, floor + 2, 5);
      const target = v === 'chair' ? new T.Vector3(48, floor + 0.35, 4.7) : new T.Vector3(56, floor + 0.9, 4);
      aim(p.applyMatrix4(w.mat), target.applyMatrix4(w.mat)); return;
    }
    if (v === 'cave' || v === 'grotto') {
      const c = CAVE_SITES[v === 'grotto' ? 1 : 0], s = caveSection(c, 0.21);
      aim(new T.Vector3(s.x + s.rx * 0.48, s.y - s.ry * 0.56, s.z), caveSurface(c, 0.29, -0.38, 2)); return;
    }
    const b = o.mods.reefs.banks.find(b => b.bank.id === 'reef').bommies[0];
    const floor = o.mods.reefs.floorAt(b.x, -18, b.z);
    aim(new T.Vector3(b.x + 3, floor + 4, b.z + 6), new T.Vector3(b.x, floor + 0.7, b.z));
  };
  select.value = new URLSearchParams(location.search).get('view') || 'cave';
  select.addEventListener('change', view); view();
  const sound = document.createElement('button');
  sound.textContent = 'Enable preview sound';
  sound.addEventListener('click', () => { o.mods.audio.start(); if (o.mods.audio.muted) o.mods.audio.toggleMute(); sound.hidden = true; });
  panel.insertBefore(sound, report);
  let frames = 0, elapsed = 0, last = performance.now();
  function sample(now) {
    const dt = now - last; last = now; frames++; elapsed += dt;
    if (elapsed > 2000) {
      report.textContent = `${checks.join('\n')}\n${vertices.toLocaleString()} unique vertices\n${Math.round(frames * 1000 / elapsed)} fps · ${o.renderer.domElement.width} × ${o.renderer.domElement.height}\n${o.renderer.info.render.calls} draws · ${o.renderer.info.render.triangles.toLocaleString()} triangles\n${document.visibilityState} · GPU programs: ${o.renderer.info.programs.length}\nGulls: ${o.mods.birds.root.visible ? 'visible' : 'hidden'} · calling: ${o.mods.birds.flock.filter(b => b.notes.length).length} · audio: ${o.mods.audio.currentTime.toFixed(1)} s\nRuntime errors: ${errors.length}${errors.length ? '\n' + errors.slice(-2).join('\n') : ''}`;
      frames = elapsed = 0;
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}
ready().catch(e => { report.textContent = e.stack; });
