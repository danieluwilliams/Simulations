// Fully synthesised soundscape: surf and gulls at the surface, muffled depths, whale song,
// diver bubbles, a submersible hum, sonar pings and groaning steel near the wrecks.
import { SEA } from './common.js';

export function createAudio(birds) {
  let ac = null, master = null, muted = false;
  const nodes = {};
  const gullVoices = new Set();
  let nextGull = 2, nextBubble = 3, nextWhale = 20, nextPing = 12, nextCreak = 6, nextKnock = 30;

  function noiseBuffer(type) {
    const len = ac.sampleRate * 4;
    const b = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (type === 'white') d[i] = w * 0.5;
        else { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12; }
      }
    }
    return b;
  }
  function loop(buf) { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; }
  function gain(v = 0) { const g = ac.createGain(); g.gain.value = v; return g; }
  function filt(type, f, q = 0.7) { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }

  function start() {
    if (ac) { ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = gain(muted ? 0 : 0.9);
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    nodes.gulls = gain(0); nodes.gulls.connect(master);
    const pink = noiseBuffer('pink'), brown = noiseBuffer('brown');

    // echo bus for whale song and sonar
    const echo = ac.createDelay(2); echo.delayTime.value = 0.42;
    const fb = gain(0.55), echoLP = filt('lowpass', 1400);
    echo.connect(echoLP); echoLP.connect(fb); fb.connect(echo); echoLP.connect(master);
    nodes.echoIn = echo;

    // surf: low roar with swell-period swells + high fizz of breaking crests
    const surf = gain(0); surf.connect(master);
    const roar = loop(brown), roarLP = filt('lowpass', 700), roarG = gain(0.5);
    roar.connect(roarLP); roarLP.connect(roarG); roarG.connect(surf);
    const fizz = loop(pink), fizzBP = filt('bandpass', 3800, 0.4), fizzG = gain(0.12);
    fizz.connect(fizzBP); fizzBP.connect(fizzG); fizzG.connect(surf);
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.11; const lfoG = gain(0.35);
    lfo.connect(lfoG); lfoG.connect(roarG.gain); lfo.start();
    const lfo2 = ac.createOscillator(); lfo2.frequency.value = 0.17; const lfo2G = gain(0.1);
    lfo2.connect(lfo2G); lfo2G.connect(fizzG.gain); lfo2.start();
    const wind = loop(pink), windBP = filt('bandpass', 520, 0.6), windG = gain(0.08);
    wind.connect(windBP); windBP.connect(windG); windG.connect(surf);
    nodes.surf = surf; nodes.roarLP = roarLP; nodes.fizzG = fizzG; nodes.windG = windG;

    // underwater bed: deep muffled pressure rumble + flow noise that follows swim speed
    const under = gain(0); under.connect(master);
    const rum = loop(brown), rumLP = filt('lowpass', 220), rumG = gain(0.9);
    rum.connect(rumLP); rumLP.connect(rumG); rumG.connect(under);
    const flow = loop(pink), flowBP = filt('bandpass', 420, 0.8), flowG = gain(0);
    flow.connect(flowBP); flowBP.connect(flowG); flowG.connect(under);
    nodes.under = under; nodes.flowG = flowG; nodes.rumLP = rumLP;

    // submersible hum for the deep (thrusters + electrical whine)
    const hum = gain(0); hum.connect(master);
    for (const [f, a] of [[54, 0.22], [108, 0.09], [162, 0.05], [1240, 0.006]]) {
      const o = ac.createOscillator(); o.type = f > 1000 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = gain(a); o.connect(g); g.connect(hum); o.start();
    }
    nodes.hum = hum;

    // vent roar
    const vent = gain(0); vent.connect(master);
    const vn = loop(brown), vnLP = filt('lowpass', 140, 2);
    vn.connect(vnLP); vnLP.connect(vent);
    nodes.vent = vent;

    // the backrooms: a dying fluorescent ballast's buzz, wavering, and the hanging set's static
    const brHum = gain(0); brHum.connect(master);
    const humWob = gain(0.75), humLP = filt('lowpass', 1100, 0.8);
    humLP.connect(humWob); humWob.connect(brHum);
    for (const [f, a] of [[120, 0.07], [240, 0.045], [360, 0.025], [600, 0.01]]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const g = gain(a); o.connect(g); g.connect(humLP); o.start();
    }
    const hl = ac.createOscillator(); hl.frequency.value = 0.23; const hlg = gain(0.25); hl.connect(hlg); hlg.connect(humWob.gain); hl.start();
    const tv = gain(0), tvPan = ac.createStereoPanner(); tv.connect(tvPan); tvPan.connect(master);
    const hiss = loop(noiseBuffer('white')), hissBP = filt('bandpass', 3200, 0.45), hissHP = filt('highpass', 600);
    hiss.connect(hissBP); hissBP.connect(hissHP); hissHP.connect(tv);
    nodes.brHum = brHum; nodes.tv = tv; nodes.tvPan = tvPan;
  }

  // ---------------------------------------------------------------- one-shot voices
  function gull(bird) {
    const t0 = ac.currentTime + 0.05;
    const location = birds.spatial(bird);
    const pan = ac.createStereoPanner(); pan.pan.value = location.pan;
    const out = gain(location.level); out.connect(pan); pan.connect(nodes.gulls);
    const bp = filt('bandpass', 2000 + Math.random() * 600, 1.6), hp = filt('highpass', 700);
    bp.connect(hp); hp.connect(out);
    const notes = 1 + Math.floor(Math.random() * 4);
    const base = 1100 + Math.random() * 500;
    const voice = { bird, pan, out, end: t0 };
    gullVoices.add(voice);
    bird.notes = [];
    let t = t0;
    for (let n = 0; n < notes; n++) {
      const long = n === 0 && Math.random() < 0.6;
      const d = long ? 0.55 + Math.random() * 0.25 : 0.16 + Math.random() * 0.08;
      const o = ac.createOscillator(); o.type = 'sawtooth';
      const vib = ac.createOscillator(); vib.frequency.value = 28 + Math.random() * 10; const vg = gain(40); vib.connect(vg); vg.connect(o.frequency);
      o.frequency.setValueAtTime(base * 1.1, t);
      o.frequency.linearRampToValueAtTime(base * (long ? 1.55 : 1.35), t + d * 0.25);
      o.frequency.exponentialRampToValueAtTime(base * (long ? 0.7 : 0.9), t + d);
      const g = gain(0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.03); g.gain.setTargetAtTime(0, t + d * 0.7, 0.05);
      o.connect(g); g.connect(bp);
      o.start(t); o.stop(t + d + 0.3); vib.start(t); vib.stop(t + d + 0.3);
      bird.notes.push({ start: t, end: t + d });
      voice.end = Math.max(voice.end, t + d + 0.3);
      o.onended = () => { o.disconnect(); vib.disconnect(); vg.disconnect(); g.disconnect(); };
      t += d + 0.05 + Math.random() * 0.08;
    }
    voice.dispose = () => { bp.disconnect(); hp.disconnect(); out.disconnect(); pan.disconnect(); };
  }
  function bubbles(level) {
    const n = 10 + Math.floor(Math.random() * 14);
    for (let i = 0; i < n; i++) {
      const t = ac.currentTime + i * (0.03 + Math.random() * 0.06);
      const o = ac.createOscillator(); o.type = 'sine';
      const f = 300 + Math.random() * 700;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.06);
      const g = gain(0); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      const pan = ac.createStereoPanner(); pan.pan.value = Math.random() * 0.8 - 0.4;
      o.connect(g); g.connect(pan); pan.connect(master); o.start(t); o.stop(t + 0.1);
    }
  }
  function whale(level) {
    const t = ac.currentTime + 0.1;
    const d = 2.5 + Math.random() * 3;
    const f0 = 140 + Math.random() * 200, f1 = f0 * (0.6 + Math.random() * 1.2);
    const lp = filt('lowpass', 900); const out = gain(0);
    lp.connect(out); out.connect(master); out.connect(nodes.echoIn);
    for (const [m, a] of [[1, 0.2], [2, 0.07], [3, 0.03]]) {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0 * m, t); o.frequency.exponentialRampToValueAtTime(f1 * m, t + d * 0.6); o.frequency.exponentialRampToValueAtTime(f0 * 0.8 * m, t + d);
      const g = gain(a); o.connect(g); g.connect(lp); o.start(t); o.stop(t + d + 0.2);
    }
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + d * 0.3); out.gain.linearRampToValueAtTime(0, t + d);
  }
  function ping(level) {
    const t = ac.currentTime + 0.05;
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 1180;
    const g = gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * level, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(master); g.connect(nodes.echoIn); o.start(t); o.stop(t + 1);
  }
  function creak(level) {
    const t = ac.currentTime + 0.05, d = 1.2 + Math.random() * 2.5;
    const o = ac.createOscillator(); o.type = 'sawtooth';
    const f = 38 + Math.random() * 50;
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.8), t + d);
    const bp = filt('bandpass', 300 + Math.random() * 500, 6);
    const g = gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35 * level, t + d * 0.4); g.gain.linearRampToValueAtTime(0, t + d);
    o.connect(bp); bp.connect(g); g.connect(master); g.connect(nodes.echoIn); o.start(t); o.stop(t + d + 0.1);
  }
  // the floodlight switch: a sharp snap as the toggle goes over, a softer second contact, a small thump from the
  // panel; switching on is a touch brighter than switching off
  let clickBuf = null;
  function click(on) {
    if (!ac) return;
    if (!clickBuf) {
      clickBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.03), ac.sampleRate);
      const d = clickBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.0025));
    }
    const t = ac.currentTime + 0.005;
    for (const [dt, f, q, a] of on ? [[0, 3400, 3, 0.9], [0.024, 2100, 2.5, 0.35]] : [[0, 2700, 3, 0.75], [0.019, 1700, 2.5, 0.3]]) {
      const s = ac.createBufferSource(); s.buffer = clickBuf;
      const bp = filt('bandpass', f, q), g = gain(a);
      s.connect(bp); bp.connect(g); g.connect(master);
      s.start(t + dt);
    }
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(on ? 190 : 150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
    const g2 = gain(0); g2.gain.setValueAtTime(0.18, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g2); g2.connect(master); o.start(t); o.stop(t + 0.08);
  }
  // the hatch slamming: a dead weight of steel meeting its seat, ringing on down the corridors
  function clang() {
    if (!ac) return;
    const t = ac.currentTime + 0.02, out = gain(0.9); out.connect(master); out.connect(nodes.echoIn);
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.9);
    const g = gain(0); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.5);
    for (const [f, a, d] of [[187, 0.16, 2.6], [311, 0.12, 2.1], [467, 0.09, 1.8], [733, 0.06, 1.3], [1123, 0.04, 0.9], [1597, 0.025, 0.6]]) {
      const p = ac.createOscillator(); p.type = 'sine'; p.frequency.value = f * (0.97 + Math.random() * 0.06);
      const pg = gain(0); pg.gain.setValueAtTime(a, t); pg.gain.exponentialRampToValueAtTime(0.0005, t + d);
      p.connect(pg); pg.connect(out); p.start(t); p.stop(t + d + 0.05);
    }
    const n = ac.createBufferSource(); n.buffer = noiseBuffer('brown');
    const nb = filt('lowpass', 900), ng = gain(0); ng.gain.setValueAtTime(1.2, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(nb); nb.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.6);
  }
  // and grinding back open, three minutes later
  function grind() {
    if (!ac) return;
    const t = ac.currentTime + 0.02, d = 2.7, out = gain(0); out.connect(master); out.connect(nodes.echoIn);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.5, t + 0.3); out.gain.setValueAtTime(0.5, t + d - 0.4); out.gain.linearRampToValueAtTime(0, t + d);
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(38, t); o.frequency.linearRampToValueAtTime(52, t + d);
    const lfo = ac.createOscillator(); lfo.frequency.value = 13; const lg = gain(9); lfo.connect(lg); lg.connect(o.frequency);
    const ob = filt('bandpass', 260, 3); o.connect(ob); ob.connect(out);
    const n = ac.createBufferSource(); n.buffer = noiseBuffer('pink'); const nb = filt('bandpass', 400, 2.5);
    nb.frequency.setValueAtTime(320, t); nb.frequency.linearRampToValueAtTime(950, t + d);
    const ng = gain(0.7); n.connect(nb); nb.connect(ng); ng.connect(out);
    o.start(t); lfo.start(t); n.start(t); o.stop(t + d); lfo.stop(t + d); n.stop(t + d);
  }
  // the flashlight shorting: a scatter of tiny electrical ticks
  function crackle(level = 1) {
    if (!ac || !clickBuf) { click(true); return; }
    const t0 = ac.currentTime;
    for (let i = 0, n = 5 + Math.floor(Math.random() * 9); i < n; i++) {
      const s = ac.createBufferSource(); s.buffer = clickBuf;
      const bp = filt('bandpass', 2500 + Math.random() * 3500, 2), g = gain(0.25 * level * (0.4 + Math.random() * 0.6));
      s.connect(bp); bp.connect(g); g.connect(master); s.start(t0 + Math.random() * 0.3);
    }
  }
  // something knocking, a long way off down the corridors
  function knock(level = 1) {
    if (!ac) return;
    const t = ac.currentTime + 0.05, out = gain(0.35 * level), lp = filt('lowpass', 420);
    lp.connect(out); out.connect(nodes.echoIn); out.connect(master);
    for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) {
      const tt = t + i * (0.32 + Math.random() * 0.2);
      const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(95, tt); o.frequency.exponentialRampToValueAtTime(48, tt + 0.25);
      const g = gain(0); g.gain.setValueAtTime(0.8, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.35);
      o.connect(g); g.connect(lp); o.start(tt); o.stop(tt + 0.4);
    }
  }
  function splash() {
    if (!ac) return;
    const t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noiseBuffer('pink');
    const bp = filt('bandpass', 1400, 0.5); const g = gain(0);
    g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 1);
  }

  let clock = 0;
  function update(info, speed) {
    if (!ac) return;
    const t = ac.currentTime;
    clock += info.dt;
    const d = Math.max(info.depth, 0);
    const surfAmt = info.under ? Math.exp(-d / 3) * 0.25 : 1;
    const underAmt = info.under ? 1 : 0;
    // a calm night: the swell slaps softly, no breaking crests hissing, the wind has gone
    const calm = SEA.calm;
    nodes.surf.gain.setTargetAtTime(surfAmt * 0.9 * (1 - 0.6 * calm), t, 0.15);
    nodes.roarLP.frequency.setTargetAtTime(700 - 350 * calm, t, 0.5);
    nodes.fizzG.gain.setTargetAtTime(0.12 * (1 - 0.85 * calm), t, 0.5);
    nodes.windG.gain.setTargetAtTime(0.08 * (1 - 0.8 * calm), t, 0.5);
    nodes.under.gain.setTargetAtTime(underAmt * 0.55, t, 0.2);
    nodes.rumLP.frequency.setTargetAtTime(info.under ? 140 + 160 * Math.exp(-d / 300) : 300, t, 0.3);
    nodes.flowG.gain.setTargetAtTime(underAmt * Math.min(speed / 12, 1) * 0.5, t, 0.2);
    const br = info.backrooms;
    nodes.hum.gain.setTargetAtTime(info.under && d > 250 ? Math.min((d - 250) / 600, 1) * 0.35 * (br?.inside ? 0.25 : 1) : 0, t, 0.5);
    nodes.brHum.gain.setTargetAtTime(br?.inside ? 0.14 : br?.near ? 0.015 : 0, t, 0.4);
    nodes.tv.gain.setTargetAtTime(br ? Math.min(br.tv, 1) * 0.55 : 0, t, 0.05);
    nodes.tvPan.pan.setTargetAtTime(br?.tvPan ?? 0, t, 0.05);
    if (br?.inside && clock > nextKnock) { nextKnock = clock + 25 + Math.random() * 45; knock(0.5 + Math.random() * 0.5); }
    const vs = window.__ocean?.mods?.seafloor?.ventSite;
    const cam = window.__ocean?.camera?.position;
    let ventAmt = 0, wreckNear = false;
    if (vs && cam && d > 3000) {
      const vd = Math.hypot(cam.x - vs.x, cam.z - vs.y);
      ventAmt = Math.max(0, 1 - vd / 160);
      wreckNear = Math.hypot(cam.x - 40, cam.z + 30) < 400;
    }
    nodes.vent.gain.setTargetAtTime(ventAmt * 0.9, t, 0.5);

    // Every call belongs to an on-screen gull. Beak notes use the same audio timestamps;
    // stereo placement keeps tracking the bird when the listener moves or turns.
    const daylight = birds?.daylight ?? 0;
    const audible = !info.under && birds?.root.visible && daylight > 0.03;
    nodes.gulls.gain.setTargetAtTime(audible ? daylight : 0, t, 0.04);
    for (const voice of gullVoices) {
      if (t >= voice.end) { voice.dispose(); gullVoices.delete(voice); continue; }
      const location = birds.spatial(voice.bird);
      voice.pan.pan.setTargetAtTime(location.pan, t, 0.05);
      voice.out.gain.setTargetAtTime(location.level, t, 0.05);
    }
    if (audible && ac.state === 'running' && t > nextGull) {
      const bird = birds.pickCaller();
      nextGull = t + (bird ? (2.5 + Math.random() * 7) / Math.max(daylight, 0.15) : 0.5);
      if (bird) gull(bird);
    }
    if (info.under && d < 400 && clock > nextBubble) { nextBubble = clock + 4.5 + Math.random() * 2; bubbles(1); }
    if (info.under && d > 10 && d < 1800 && clock > nextWhale) { nextWhale = clock + 22 + Math.random() * 40; whale(0.5); }
    if (info.under && d > 600 && clock > nextPing) { nextPing = clock + 9 + Math.random() * 10; ping(0.6); }
    if (wreckNear && clock > nextCreak) { nextCreak = clock + 5 + Math.random() * 9; creak(0.8); }
  }

  return {
    start, update, splash, click, clang, grind, crackle, knock,
    toggleMute() { muted = !muted; if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.05); },
    get muted() { return muted; },
    get currentTime() { return ac?.currentTime ?? 0; },
  };
}
