/* Launchpad: a drawn Pulse scene for Omarchy's Starship theme (the photo version is starbase.js). The rocket is your PC:
   - every CPU core is an engine: its flame under the booster and its circle in the engine ring at the bottom
   - the more the CPU works, the harder the static fire: plume, deluge smoke and the glow on the pad
   - the frost line on the tanks is your RAM (propellant load); the vents breathe with it
   - Starlink-style satellite trains crossing the sky are your network traffic
   - the sky is your real sun (sunrise/sunset from the weather) and your real weather
   Preview overrides: ?cpu=80&ram=60&net=2e6&tod=6.6&wx=rain   (tod = hour of the day, 0-24)
   ?demo=1 ramps the load from idle to a full static fire and back (?demo=20: every 20 s)
   Registers itself as window.PulseScenes.launchpad (see the small hook in pulse.js). MIT, like Pulse. */
(function () {
  "use strict";
  var SC = window.PulseScenes = window.PulseScenes || {};
  var X = null, g = null, W = 0, H = 0, L = {};
  var sky0 = document.createElement("canvas");   // sky gradient (stars go on top of it)
  var sky1 = document.createElement("canvas");   // everything static in front: sun, clouds, sea, pad, tower
  var comb = document.createElement("canvas");   // sky0 + sky1 in one (day: nothing goes between them)
  var mask = document.createElement("canvas");   // puddles on the flats
  var refl = document.createElement("canvas");   // what the puddles mirror, every frame
  var puffS = document.createElement("canvas"), puffL = document.createElement("canvas"),
    puffG = document.createElement("canvas"), puffV = document.createElement("canvas"), dot = document.createElement("canvas");
  var staticKey = "", LT = null, stars = [], clouds = [], puddles = [], drops = [];
  var smoke = [], vents = [], eng = [], jetL = [], T = 0, ramS = -1, trainX = 0, alertEnv = 0, alertCol = null;
  var last = 0, spawnS = 0, spawnV = 0;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function hm(s) { var m = /(\d+):(\d+)/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; }
  function rgba(c, a) { return X.rgba(c, a); }
  function mix(a, b, t) { return X.mix(a, b, clamp(t, 0, 1)); }
  function q(name) { var v = X.Q.get(name); return v == null || v === "" ? null : parseFloat(v); }

  // ------------------------------------------------------------------ light: the real sun
  function light() {
    var C = X.COL, w = X.weather || {}, d = new Date();
    var now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    if (q("tod") != null) now = (q("tod") % 24) * 60;
    var sr = hm(w.sunrise), ss = hm(w.sunset);
    if (sr == null || ss == null || ss <= sr) { sr = 390; ss = 1110; }
    var f = (now - sr) / (ss - sr), alt;
    if (f >= 0 && f <= 1) alt = Math.sin(Math.PI * f);
    else alt = -Math.min(1, (f < 0 ? sr - now : now - ss) / 150);
    var wx = X.wx;
    var oc = wx === "cloud" || wx === "fog" ? 0.65 : wx === "rain" || wx === "snow" ? 0.75 : wx === "storm" ? 0.85 : wx === "part" ? 0.22 : 0;
    var day = sstep(0.02, 0.42, alt), gold = Math.exp(-Math.pow(alt / 0.26, 2)) * (1 - oc * 0.75), night = 1 - sstep(-0.5, -0.02, alt);
    var bg = C.bg, blue = C.blue, cool = C.cool, ac = C.accent, or = C.orange, blk = [0, 0, 0];
    var top = mix(mix(bg, blk, 0.5), mix(bg, blue, 0.40), day);
    var mid = mix(mix(bg, mix(blue, blk, 0.4), 0.2), mix(bg, mix(blue, cool, 0.5), 0.52), day);
    var hzc = mix(mix(bg, blue, 0.15), mix(bg, cool, 0.62), day);
    // golden hour: teal above, peach to orange at the horizon (the Starship theme's dawn photos)
    top = mix(top, mix(bg, mix(blue, cool, 0.6), 0.30), gold * 0.6);
    mid = mix(mid, mix(bg, mix(cool, [236, 168, 130], 0.55), 0.50), gold * 0.8);
    hzc = mix(hzc, mix(bg, mix(ac, or, 0.3), 0.86), gold * 0.92);
    var grey = mix(bg, mix(C.fg, blue, 0.3), 0.2 + 0.28 * day);
    top = mix(top, grey, oc * 0.45); mid = mix(mid, grey, oc * 0.6); hzc = mix(hzc, grey, oc * 0.65);
    var sunC = mix(mix(ac, or, 0.25), [255, 240, 214], 0.15 + 0.65 * day);
    var lit = Math.max(day, gold * 0.75);
    return {
      f: f, alt: alt, day: day, gold: gold, night: night, oc: oc, lit: lit, top: top, mid: mid, hzc: hzc, sunC: sunC,
      amb: mix(mid, hzc, 0.5), sx: W * (0.14 + 0.72 * clamp(f, -0.04, 1.04)), sy: L.hz - L.hz * 0.52 * alt,
      key: [Math.round(now / 2), wx].join()
    };
  }

  // ------------------------------------------------------------------ layout (canvas pixels)
  function layout() {
    var cx = W / 2;
    L.cx = cx; L.hz = H * 0.646; L.shore = H * 0.676; L.gy = H * 0.757;
    L.Hs = H * 0.375; L.D = L.Hs / 11.2; L.mountH = L.D * 1.95;
    L.by = L.gy - L.mountH; L.bH = L.Hs * 0.585; L.sH = L.Hs - L.bH;
    L.bTop = L.by - L.bH; L.top = L.by - L.Hs; L.ringH = L.bH * 0.035;
    L.tw = L.D * 1.06; L.tx = cx - L.D * 2.55 - L.tw / 2; L.tTop = L.top + L.D * 0.9;
    L.qdY = L.bTop - L.sH * 0.34; L.armY = L.bTop + L.ringH * 2.2;
    L.lw = Math.max(0.7, H / 880);
  }

  function seed() {
    var R = X.rnd(1717), i;
    stars = []; for (i = 0; i < 150; i++) stars.push([R() * W, R() * L.hz * 0.92, R(), 0.3 + R() * 1.2]);
    drops = []; for (i = 0; i < 180; i++) drops.push([R() * W, R() * H, 0.6 + R() * 0.8]);
    clouds = [];
    for (i = 0; i < 14; i++) {
      var bank = { x: R() * W, y: L.hz - H * (0.012 + 0.2 * Math.pow(R(), 1.6)), w: W * (0.06 + R() * 0.2), puffs: [], rank: R() };
      var n = 22 + (R() * 20 | 0), far = 1 - (L.hz - bank.y) / L.hz * 0.5;
      for (var k = 0; k < n; k++) {
        var u = R() * 2 - 1, hgt = Math.pow(1 - Math.abs(u), 0.7);
        bank.puffs.push([bank.x + u * bank.w / 2, bank.y - H * 0.004 - R() * H * 0.055 * hgt * far, H * (0.006 + 0.022 * hgt * (0.4 + R())) * far]);
      }
      bank.puffs.sort(function (a, b) { return a[1] - b[1]; });
      clouds.push(bank);
    }
    puddles = [];
    for (i = 0; i < 18; i++) {
      var p = Math.pow(R(), 0.8), y = L.gy + H * 0.012 + p * (H - L.gy - H * 0.02);
      var pw = H * (0.03 + 0.22 * p) * (0.4 + R()), x = R() * W;
      if (Math.abs(x - L.cx) < H * 0.09 && y < L.gy + H * 0.04) x += H * 0.2;   // keep the apron dry
      puddles.push([x, y, pw, pw * (0.03 + R() * 0.045), R() * 0.25 - 0.12]);
    }
  }

  function sprite(c, col, s, soft, body) {
    c.width = c.height = s;
    var b = c.getContext("2d"), gr = b.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, rgba(col, 1));
    if (body) { gr.addColorStop(0.45, rgba(col, 0.92)); gr.addColorStop(0.75, rgba(col, 0.45)); }
    else gr.addColorStop(soft, rgba(col, 0.5));
    gr.addColorStop(1, rgba(col, 0));
    b.fillStyle = gr; b.fillRect(0, 0, s, s);
  }

  // ------------------------------------------------------------------ the static layers
  function paintStatic(lt) {
    var C = X.COL, i, k;
    sky0.width = sky1.width = W; sky0.height = sky1.height = H;
    var a = sky0.getContext("2d"), b = sky1.getContext("2d");
    var sk = a.createLinearGradient(0, 0, 0, L.hz);
    sk.addColorStop(0, rgba(lt.top, 1)); sk.addColorStop(0.6, rgba(lt.mid, 1)); sk.addColorStop(1, rgba(lt.hzc, 1));
    a.fillStyle = sk; a.fillRect(0, 0, W, L.hz + 1);

    // the sun: a glow on the horizon at dawn and dusk, a disc when it is up
    b.save(); b.beginPath(); b.rect(0, 0, W, L.hz); b.clip();
    var sg = (0.34 * lt.gold + 0.12 * lt.day) * (1 - lt.oc * 0.7);
    if (sg > 0.01) {
      var sy = Math.max(lt.sy, L.hz - H * 0.02), gr = b.createRadialGradient(lt.sx, sy, 0, lt.sx, sy, H * (0.22 + 0.35 * lt.gold));
      gr.addColorStop(0, rgba(lt.sunC, sg * 1.6)); gr.addColorStop(0.25, rgba(lt.sunC, sg * 0.55)); gr.addColorStop(1, rgba(lt.sunC, 0));
      b.globalCompositeOperation = "lighter"; b.fillStyle = gr; b.fillRect(0, 0, W, L.hz);
      b.globalCompositeOperation = "source-over";
    }
    if (lt.alt > -0.03 && lt.oc < 0.6) {
      var sr = H * 0.016;
      var hg = b.createRadialGradient(lt.sx, lt.sy, sr * 0.8, lt.sx, lt.sy, sr * 5);
      hg.addColorStop(0, rgba(lt.sunC, 0.55 * (1 - lt.oc))); hg.addColorStop(1, rgba(lt.sunC, 0));
      b.globalCompositeOperation = "lighter"; b.fillStyle = hg; b.fillRect(lt.sx - sr * 5, lt.sy - sr * 5, sr * 10, sr * 10);
      b.globalCompositeOperation = "source-over";
      b.fillStyle = rgba(mix(lt.sunC, [255, 255, 255], 0.6), 0.95 * (1 - lt.oc));
      b.beginPath(); b.arc(lt.sx, lt.sy, sr, 0, Math.PI * 2); b.fill();
    }
    b.restore();

    // clouds: a few banks on a clear day, a deck when it is grey
    var nb = { clear: 2, part: 7, cloud: 12, fog: 10, rain: 13, snow: 12, storm: 14 }[X.wx] || 4;
    var cSh = mix(mix(lt.top, lt.mid, 0.5), [0, 0, 0], 0.15 + 0.2 * lt.night);
    var cLit = mix(mix(lt.hzc, [255, 255, 255], 0.12 + 0.32 * lt.day), lt.sunC, lt.gold * 0.45);
    if (lt.night > 0.5) cLit = mix(lt.mid, C.fg, 0.07);
    for (i = 0; i < Math.min(nb, clouds.length); i++) {
      var cb = clouds[i];
      b.save(); b.beginPath(); b.rect(0, 0, W, cb.y + H * 0.003); b.clip();   // cumulus have flat bases
      for (k = 0; k < cb.puffs.length; k++) {
        var p = cb.puffs[k], sg0 = b.createRadialGradient(0, 0, p[2] * 0.2, 0, 0, p[2] * 1.15);
        sg0.addColorStop(0, rgba(cSh, 0.9)); sg0.addColorStop(0.65, rgba(cSh, 0.7)); sg0.addColorStop(1, rgba(cSh, 0));
        b.save(); b.translate(p[0], p[1]); b.scale(1.7, 1);
        b.fillStyle = sg0; b.fillRect(-p[2] * 1.2, -p[2] * 1.2, p[2] * 2.4, p[2] * 2.4); b.restore();
      }
      for (k = 0; k < cb.puffs.length; k++) {
        var pp = cb.puffs[k], sideL = lt.sx < pp[0] ? -1 : 1, lx = pp[0] + sideL * pp[2] * 0.35, ly = pp[1] - pp[2] * 0.5;
        var lg = b.createRadialGradient(0, 0, 0, 0, 0, pp[2] * 0.95);
        lg.addColorStop(0, rgba(cLit, 0.7)); lg.addColorStop(0.55, rgba(cLit, 0.28)); lg.addColorStop(1, rgba(cLit, 0));
        b.save(); b.translate(lx, ly); b.scale(1.7, 1);
        b.fillStyle = lg; b.fillRect(-pp[2], -pp[2], pp[2] * 2, pp[2] * 2); b.restore();
      }
      b.restore();
    }
    if (lt.oc > 0.3) { b.fillStyle = rgba(mix(lt.mid, C.fg, 0.1), lt.oc * 0.35); b.fillRect(0, 0, W, L.hz); }

    // the sea, and the sun on it
    var se = b.createLinearGradient(0, L.hz, 0, L.shore);
    se.addColorStop(0, rgba(mix(lt.hzc, lt.top, 0.4), 1)); se.addColorStop(1, rgba(mix(lt.top, [0, 0, 0], 0.4), 1));
    b.fillStyle = se; b.fillRect(0, L.hz, W, L.shore - L.hz + 1);
    if (sg > 0.02) {
      var R = X.rnd(99);
      b.fillStyle = rgba(mix(lt.sunC, [255, 255, 255], 0.3), Math.min(0.8, sg * 1.8));
      for (i = 0; i < 70; i++) {
        var gy2 = L.hz + 1 + R() * (L.shore - L.hz - 2), spread = (gy2 - L.hz) / (L.shore - L.hz);
        b.fillRect(lt.sx + (R() - 0.5) * H * (0.03 + 0.12 * spread), gy2, H * (0.004 + R() * 0.012), Math.max(0.6, H / 1300));
      }
    }
    b.fillStyle = rgba(mix(lt.hzc, [255, 255, 255], 0.2), 0.35); b.fillRect(0, L.hz, W, Math.max(0.6, H / 1400));

    // the far side: other launch tower, the tank farm, the bays on the shore
    var far = mix(mix(lt.hzc, lt.top, 0.55), [0, 0, 0], 0.32 + 0.3 * lt.night), far2 = mix(far, lt.hzc, 0.25);
    tower(b, L.cx + H * 0.215, L.gy - H * 0.035, L.gy - H * 0.035 - L.Hs * 0.74, L.tw * 0.7, far, L.lw * 0.8, true);
    b.fillStyle = rgba(mix(steelCol(lt), far, 0.5), 1);
    var tf = L.gy - H * 0.012;
    [[-0.3, 0.012, 0.055], [-0.282, 0.012, 0.06], [-0.264, 0.012, 0.05], [-0.243, 0.016, 0.042], [-0.222, 0.01, 0.066],
      [-0.206, 0.012, 0.05], [0.31, 0.012, 0.045], [0.326, 0.012, 0.052]].forEach(function (t) {
      var x = L.cx + H * t[0], w = H * t[1], h = H * t[2];
      b.fillRect(x, tf - h, w, h); b.beginPath(); b.ellipse(x + w / 2, tf - h, w / 2, w * 0.35, 0, Math.PI, 0); b.fill();
    });
    [[-0.17, 0.018], [-0.15, 0.015], [0.27, 0.017]].forEach(function (s) {   // spheres
      b.beginPath(); b.arc(L.cx + H * s[0], tf - H * s[1], H * s[1], 0, Math.PI * 2); b.fill();
    });

    // the flats: dark ground and puddles that hold the sky
    var gc0 = mix(mix(lt.amb, [0, 0, 0], 0.52 + 0.28 * lt.night), C.bg, 0.25), gc1 = mix(C.bg, [0, 0, 0], 0.55);
    var gr2 = b.createLinearGradient(0, L.shore, 0, H);
    gr2.addColorStop(0, rgba(gc0, 1)); gr2.addColorStop(1, rgba(gc1, 1));
    b.fillStyle = gr2; b.fillRect(0, L.shore, W, H - L.shore);
    b.fillStyle = rgba(mix(gc0, lt.hzc, 0.18), 1); b.fillRect(0, L.shore, W, Math.max(1, H / 500));   // the beach line
    mask.width = W; mask.height = H - L.gy;
    var m = mask.getContext("2d");
    m.fillStyle = "#fff";
    puddles.forEach(function (p) {
      m.beginPath(); m.ellipse(p[0], p[1] - L.gy, p[2], p[3], p[4] * 0.2, 0, Math.PI * 2); m.fill();
      m.beginPath(); m.ellipse(p[0] + p[2] * 0.55, p[1] - L.gy + p[3] * 0.4, p[2] * 0.5, p[3] * 0.8, 0, 0, Math.PI * 2); m.fill();
    });
    var tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H - L.gy;
    var tc = tmp.getContext("2d"), pg = tc.createLinearGradient(0, 0, 0, H - L.gy);
    pg.addColorStop(0, rgba(mix(lt.hzc, [0, 0, 0], 0.4), 0.6)); pg.addColorStop(1, rgba(mix(lt.top, [0, 0, 0], 0.35), 0.5));
    tc.fillStyle = pg; tc.fillRect(0, 0, W, H - L.gy);
    tc.globalCompositeOperation = "destination-in"; tc.drawImage(mask, 0, 0);
    b.drawImage(tmp, 0, L.gy);

    // the pad: apron, flame deflector, the launch mount, the tower with its arms
    var steel = steelCol(lt), dark = mix(steel, [0, 0, 0], 0.55);
    b.fillStyle = rgba(mix(gc0, C.fg, 0.07 + 0.05 * lt.lit), 1);
    b.beginPath(); b.moveTo(L.cx - H * 0.13, L.gy - H * 0.004); b.lineTo(L.cx + H * 0.15, L.gy - H * 0.004);
    b.lineTo(L.cx + H * 0.22, L.gy + H * 0.028); b.lineTo(L.cx - H * 0.19, L.gy + H * 0.028); b.closePath(); b.fill();
    var tcol = mix(mix(C.bg, [0, 0, 0], 0.35), lt.amb, 0.12 + 0.25 * lt.lit);
    // arms: behind the rocket
    b.fillStyle = rgba(tcol, 1);
    var ax = L.tx + L.tw;
    poly(b, [[ax, L.armY - L.tw * 0.22], [L.cx + L.D * 1.3, L.armY - L.D * 0.12], [L.cx + L.D * 1.3, L.armY + L.D * 0.02], [ax, L.armY + L.tw * 0.16]]);
    poly(b, [[ax, L.armY + L.tw * 0.32], [L.cx + L.D * 0.95, L.armY + L.D * 0.5], [L.cx + L.D * 0.95, L.armY + L.D * 0.62], [ax, L.armY + L.tw * 0.62]]);
    b.fillRect(L.tx - L.tw * 0.12, L.armY - L.tw * 0.34, L.tw * 1.24, L.tw * 1.05);   // carriage
    tower(b, L.tx, L.gy, L.tTop, L.tw, tcol, L.lw, false);
    // ship quick-disconnect arm
    b.fillStyle = rgba(tcol, 1);
    b.fillRect(ax, L.qdY - L.tw * 0.14, L.cx - L.D / 2 - ax, L.tw * 0.26);
    b.strokeStyle = rgba(mix(tcol, lt.amb, 0.4), 0.8); b.lineWidth = L.lw * 0.7; b.beginPath();
    for (var qx = ax; qx < L.cx - L.D / 2 - L.tw * 0.2; qx += L.tw * 0.3) { b.moveTo(qx, L.qdY + L.tw * 0.12); b.lineTo(qx + L.tw * 0.15, L.qdY - L.tw * 0.12); }
    b.stroke();
    // launch mount: deck on legs, the plume goes through the middle
    var md = L.D * 0.2;
    b.fillStyle = rgba(dark, 1);
    [-1.02, -0.62, 0.62, 1.02].forEach(function (u) { b.fillRect(L.cx + u * L.D - L.D * 0.07, L.by + md, L.D * 0.14, L.mountH - md); });
    b.fillStyle = rgba(mix(steel, [0, 0, 0], 0.35), 1); b.fillRect(L.cx - L.D * 1.12, L.by, L.D * 2.24, md);
    b.fillStyle = rgba(mix(steel, [0, 0, 0], 0.15), 1); b.fillRect(L.cx - L.D * 1.3, L.gy - L.D * 0.09, L.D * 2.6, L.D * 0.09);

    // smoke, vapour and glow sprites in today's light
    var sm = mix(lt.amb, [250, 250, 250], 0.18 + 0.42 * lt.lit);
    sm = mix(sm, lt.sunC, lt.gold * 0.25);
    if (lt.night > 0.5) sm = mix(lt.amb, C.fg, 0.2);
    sprite(puffS, mix(sm, [0, 0, 0], 0.38), 64, 0.35, true);
    sprite(puffL, mix(sm, [255, 255, 255], 0.12), 64, 0.3, true);
    sprite(puffG, mix(C.accent, C.orange, 0.3), 64, 0.25);
    sprite(puffV, mix(sm, [240, 248, 255], 0.4), 48, 0.3);
    sprite(dot, [255, 255, 255], 16, 0.2);
    comb.width = W; comb.height = H;
    var cc = comb.getContext("2d"); cc.drawImage(sky0, 0, 0); cc.drawImage(sky1, 0, 0);
    LT = lt;
  }

  function poly(b, pts) { b.beginPath(); pts.forEach(function (p, i) { if (i) b.lineTo(p[0], p[1]); else b.moveTo(p[0], p[1]); }); b.closePath(); b.fill(); }

  // a lattice tower: two legs, a rung and an X in every bay, a crown and a mast
  function tower(b, x, base, top, w, col, lw, arms) {
    b.fillStyle = rgba(col, 1); b.strokeStyle = rgba(col, 1); b.lineWidth = lw;
    b.fillRect(x, top, lw * 1.8, base - top); b.fillRect(x + w - lw * 1.8, top, lw * 1.8, base - top);
    var cell = w * 1.12, n = Math.floor((base - top) / cell);
    b.beginPath();
    for (var i = 0; i <= n; i++) {
      var y = base - i * cell;
      b.moveTo(x, y); b.lineTo(x + w, y);
      if (i < n) { b.moveTo(x, y); b.lineTo(x + w, y - cell); b.moveTo(x + w, y); b.lineTo(x, y - cell); }
    }
    b.stroke();
    b.fillRect(x - w * 0.12, top - w * 0.3, w * 1.24, w * 0.3);
    b.beginPath(); b.moveTo(x + w * 0.5, top - w * 0.3); b.lineTo(x + w * 0.5, top - w * 1.25); b.stroke();
    if (arms) {
      var ay = top + (base - top) * 0.32;
      poly(b, [[x + w, ay], [x + w * 3.4, ay - w * 0.25], [x + w * 3.4, ay - w * 0.08], [x + w, ay + w * 0.25]]);
      b.fillRect(x - w * 0.1, ay - w * 0.3, w * 1.2, w * 0.8);
    }
  }

  function steelCol(lt) {
    var C = X.COL, base = mix(mix(C.bg, C.fg, 0.56), lt.amb, 0.3);
    var lvl = 0.3 + 0.7 * Math.max(lt.lit, 0.55 * lt.night);   // floodlights at night
    base = mix([0, 0, 0], base, lvl);
    if (lt.night > 0.5) base = mix(base, C.cool, 0.08);
    return base;
  }

  // ------------------------------------------------------------------ the frame
  function draw(api) {
    X = api; g = api.g;
    var t0 = performance.now();
    if (api.W !== W || api.H !== H || !L.D) resize(api);
    var now = api.now, t = api.t, dt = last ? Math.min(0.25, (now - last) / 1000) : 0.05; last = now;
    var C = X.COL, i;
    var lt = light();
    var key = W + "x" + H + "|" + C.bg + C.accent + C.cool + "|" + lt.key;
    if (key !== staticKey) { staticKey = key; paintStatic(lt); }
    lt = LT;

    // the data, smoothed (and the preview overrides)
    var cores = api.cores || [], cpu = api.cpu || 0, ram = api.ram || 0, net = api.net || 0;
    if (q("demo") != null) X.Q.set("cpu", (48 - 46 * Math.cos(t * Math.PI * 2 / (q("demo") >= 5 ? q("demo") : 40))).toFixed(1));
    if (q("cpu") != null) { var nc = cores.length || 16; cpu = q("cpu"); cores = []; for (i = 0; i < nc; i++) cores.push(clamp(cpu + 22 * Math.sin(t * 0.6 + i * 1.9) + 9 * Math.sin(t * 2.3 + i), 0, 100)); }
    if (q("ram") != null) ram = q("ram");
    if (q("net") != null) net = q("net");
    var tgt = window.EngineRing.engines(cores, cpu), kf = 1 - Math.exp(-dt * 2.5);
    if (eng.length !== tgt.length) eng = tgt.slice();
    for (i = 0; i < tgt.length; i++) eng[i] += (tgt[i] - eng[i]) * kf;
    var sum = 0; for (i = 0; i < eng.length; i++) sum += eng[i];
    T += ((sum / Math.max(1, eng.length)) / 100 - T) * kf;
    ramS = ramS < 0 ? ram : ramS + (ram - ramS) * kf * 0.5;
    var ramF = clamp(ramS / 100, 0, 1);

    // stars and the satellite train (network) go between the sky and the scenery
    var starA = lt.night * (1 - lt.oc * 0.85);
    var lg = Math.log10(1 + net), na = sstep(3.3, 7.2, lg);
    var trA = (0.1 + 0.85 * Math.max(lt.night, lt.gold * 0.6)) * (1 - lt.oc * 0.9) * (0.35 + 0.65 * na);
    var between = starA > 0.02 || trA > 0.02;
    g.drawImage(between ? sky0 : comb, 0, 0);
    if (starA > 0.02) {
      for (i = 0; i < stars.length; i++) {
        var st = stars[i], tw = 0.5 + 0.5 * Math.sin(t * st[3] * 2 + st[2] * 40);
        g.fillStyle = rgba(C.fg, (0.12 + 0.6 * tw * st[2]) * starA * (1 - st[1] / L.hz * 0.6));
        var ss = Math.max(0.8, H / 1080 * (st[2] > 0.9 ? 2.2 : 1.2));
        g.fillRect(st[0], st[1], ss, ss);
      }
    }
    var nDots = Math.round(5 + 35 * na), speed = W * (0.008 + 0.05 * na), gap = W * 0.011;
    trainX += speed * dt;
    var span = W * 1.25 + nDots * gap, head = (trainX % span) - W * 0.1;
    if (trA > 0.02) {
      g.globalCompositeOperation = "lighter";
      for (i = 0; i < nDots; i++) {
        var px = head - i * gap; if (px < -10 || px > W + 10) continue;
        var py = H * 0.15 + (px / W) * H * 0.2 + Math.sin(px / W * 3) * H * 0.01;
        var fl = 0.6 + 0.4 * Math.sin(i * 12.9898 + t * 0.8);
        var r = Math.max(1.2, H / 420);
        g.globalAlpha = trA * fl; g.drawImage(dot, px - r, py - r, r * 2, r * 2);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    }
    if (between) g.drawImage(sky1, 0, 0);

    // floodlights at night
    if (lt.night > 0.05) {
      g.globalCompositeOperation = "lighter";
      [[-0.24, 0.02, -0.05], [0.17, 0.03, 0.06], [0.33, 0.012, -0.04]].forEach(function (f, k) {
        var sx = L.cx + H * f[0], sy = L.gy + H * f[1], tx = L.cx + H * f[2] * 0.3, ty = L.by - L.bH * (0.45 + k * 0.2);
        var ang = Math.atan2(ty - sy, tx - sx), len = Math.hypot(tx - sx, ty - sy) * 1.5, wd = 0.045;
        var bgr = g.createLinearGradient(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
        bgr.addColorStop(0, rgba(mix(C.fg, C.cool, 0.3), 0.1 * lt.night)); bgr.addColorStop(1, rgba(C.fg, 0));
        g.fillStyle = bgr;
        poly(g, [[sx, sy], [sx + Math.cos(ang - wd) * len, sy + Math.sin(ang - wd) * len], [sx + Math.cos(ang + wd) * len, sy + Math.sin(ang + wd) * len]]);
        g.fillStyle = rgba(mix(C.fg, C.cool, 0.3), 0.8 * lt.night); g.fillRect(sx - 1, sy - 1, 2.5, 2.5);
      });
      g.globalCompositeOperation = "source-over";
    }

    rocket(lt, ramF);
    jets(t);

    // the pad lights up with the static fire
    if (T > 0.03) {
      g.globalCompositeOperation = "lighter";
      var gc = mix(C.accent, C.orange, 0.3), R1 = H * (0.05 + 0.3 * T);
      var pg = g.createRadialGradient(L.cx, L.gy - L.mountH * 0.3, 0, L.cx, L.gy - L.mountH * 0.3, R1);
      pg.addColorStop(0, rgba([255, 240, 210], Math.min(0.9, 1.4 * T))); pg.addColorStop(0.2, rgba(gc, Math.min(0.7, 0.9 * T))); pg.addColorStop(1, rgba(gc, 0));
      g.fillStyle = pg; g.fillRect(L.cx - R1, L.gy - L.mountH * 0.3 - R1, R1 * 2, R1 * 2);
      var R2 = H * (0.2 + 0.25 * T), pg2 = g.createRadialGradient(L.cx, L.gy, 0, L.cx, L.gy, R2);
      pg2.addColorStop(0, rgba(gc, 0.25 * T)); pg2.addColorStop(1, rgba(gc, 0));
      g.fillStyle = pg2; g.fillRect(L.cx - R2, L.gy - R2, R2 * 2, Math.min(R2 * 2, H - L.gy + R2));
      g.globalCompositeOperation = "source-over";
    }

    // deluge smoke: born where the plume hits the deflector, pushed out both sides
    var wind = clamp(((X.weather && X.weather.wind) || 0) / 40, 0, 1) * H * 0.04;
    spawnS += dt * 52 * Math.pow(sstep(0.04, 0.7, T), 1.1);   // idle: a quiet pad
    while (spawnS >= 1) {
      spawnS -= 1;
      if (smoke.length > 120) smoke.shift();
      var dir = Math.random() < 0.5 ? -1 : 1, v = (0.22 + 0.55 * Math.random()) * H * (0.35 + 1.1 * T);
      smoke.push({ x: L.cx + (Math.random() - 0.5) * L.D * 1.6, y: L.gy - Math.random() * L.D * 0.3, vx: dir * v, vy: -H * (0.01 + 0.05 * Math.random()),
        r: H * (0.01 + 0.01 * Math.random()), gr: H * (0.006 + (0.02 + 0.03 * Math.random()) * Math.min(1, 0.25 + T)), age: 0,
        life: (2.5 + 8 * Math.min(1, T * 1.3)) * (0.7 + 0.6 * Math.random()) });
    }
    var alive = [];
    for (i = 0; i < smoke.length; i++) {
      var s = smoke[i]; s.age += dt; if (s.age > s.life) continue;
      s.vx *= Math.exp(-0.75 * dt); s.vy = s.vy * Math.exp(-0.35 * dt) - H * (0.004 + 0.012 * s.age / s.life) * dt;
      s.x += (s.vx + wind) * dt; s.y += s.vy * dt; s.r += s.gr * dt * Math.max(0.25, 1 - s.age / s.life);
      if (s.y > L.gy - s.r * 0.35) s.y = L.gy - s.r * 0.35;
      alive.push(s);
    }
    smoke = alive;
    var glowR = H * (0.08 + 0.2 * T);
    for (i = 0; i < smoke.length; i++) {
      var p = smoke[i], a = Math.min(1, p.age / 0.5) * Math.pow(1 - p.age / p.life, 1.3);
      g.globalAlpha = a * 0.62; g.drawImage(puffS, p.x - p.r, p.y - p.r * 0.8, p.r * 2, p.r * 2);
      g.globalAlpha = a * 0.55; g.drawImage(puffL, p.x - p.r * 0.72, p.y - p.r * 1.12, p.r * 1.44, p.r * 1.44);
    }
    if (T > 0.01) {
      g.globalCompositeOperation = "lighter";
      for (i = 0; i < smoke.length; i++) {
        var pq = smoke[i], dd = Math.hypot(pq.x - L.cx, (pq.y - L.gy) * 1.6);
        var ga = Math.min(1, pq.age / 0.5) * (1 - pq.age / pq.life) * Math.min(1, 1.2 * T + 0.1) * Math.exp(-dd / glowR) * 0.8;
        if (ga < 0.03) continue;
        g.globalAlpha = ga; g.drawImage(puffG, pq.x - pq.r, pq.y - pq.r * 0.7, pq.r * 2, pq.r * 2);
      }
      g.globalCompositeOperation = "source-over";
    }
    g.globalAlpha = 1;

    // cryogenic venting: the tanks breathe with the propellant load (RAM)
    spawnV += dt * (1.5 + 7 * ramF);
    while (spawnV >= 1) {
      spawnV -= 1;
      var src = Math.random(), vx0, vy0, sx0, sy0;
      if (src < 0.4) { sx0 = L.cx + L.D * 0.5; sy0 = L.bTop + L.ringH * 3 + Math.random() * L.bH * 0.05; vx0 = 1; }
      else if (src < 0.7) { sx0 = L.cx - L.D * 0.5; sy0 = L.qdY; vx0 = -1; }
      else { sx0 = L.cx + (Math.random() < 0.5 ? -1 : 1) * L.D * 0.45; sy0 = L.by - L.D * 0.1; vx0 = sx0 < L.cx ? -1 : 1; }
      if (vents.length > 90) vents.shift();
      vents.push({ x: sx0, y: sy0, vx: vx0 * H * (0.012 + 0.03 * Math.random()), vy: H * (0.004 + 0.012 * Math.random()), r: H * 0.004, age: 0, life: 2.4 + 2 * Math.random() });
    }
    alive = [];
    for (i = 0; i < vents.length; i++) {
      var vp = vents[i]; vp.age += dt; if (vp.age > vp.life) continue;
      vp.vx *= Math.exp(-0.6 * dt); vp.vy += H * 0.006 * dt;
      vp.x += (vp.vx + wind * 0.6) * dt; vp.y += vp.vy * dt; vp.r += H * 0.012 * dt;
      var va = Math.min(1, vp.age / 0.3) * (1 - vp.age / vp.life) * 0.4;
      g.globalAlpha = va; g.drawImage(puffV, vp.x - vp.r, vp.y - vp.r, vp.r * 2, vp.r * 2);
      alive.push(vp);
    }
    vents = alive; g.globalAlpha = 1;

    // beacons on the towers (they strobe in the alert colour)
    alertEnv *= Math.exp(-dt / 2.5);
    var alerting = alertEnv > 0.05 && alertCol;
    g.globalCompositeOperation = "lighter";
    [[L.tx + L.tw * 0.5, L.tTop - L.tw * 1.25, 0], [L.tx - L.tw * 0.05, L.tTop - L.tw * 0.3, 0.3], [L.tx + L.tw * 1.05, L.tTop - L.tw * 0.3, 0.3],
      [L.cx + H * 0.215 + L.tw * 0.35, L.gy - H * 0.035 - L.Hs * 0.74 - L.tw * 0.9, 0.8]].forEach(function (bc) {
      var on = alerting ? (t * 4 + bc[2]) % 1 < 0.5 : (t / 1.7 + bc[2]) % 1 < 0.14;
      if (!on) return;
      var rr = H * (alerting ? 0.02 : 0.012);
      g.globalAlpha = alerting ? 0.95 : 0.8;
      var col = alerting ? alertCol : C.crit;
      var bg2 = g.createRadialGradient(bc[0], bc[1], 0, bc[0], bc[1], rr);
      bg2.addColorStop(0, rgba(mix(col, [255, 255, 255], 0.4), 1)); bg2.addColorStop(0.25, rgba(col, 0.6)); bg2.addColorStop(1, rgba(col, 0));
      g.fillStyle = bg2; g.fillRect(bc[0] - rr, bc[1] - rr, rr * 2, rr * 2);
    });
    g.globalAlpha = 1;
    if (alerting) {
      var ar = H * (0.05 + (1 - alertEnv) * 0.6);
      g.beginPath(); g.ellipse(L.cx, L.gy, ar, ar * 0.12, 0, 0, Math.PI * 2);
      g.strokeStyle = rgba(alertCol, alertEnv * 0.8); g.lineWidth = Math.max(1, H / 500); g.stroke();
    }

    // the flats mirror what is above them
    var rh = H - L.gy, rw2 = Math.ceil(W / 2), rh2 = Math.ceil(rh / 2);
    if (refl.width !== rw2 || refl.height !== rh2) { refl.width = rw2; refl.height = rh2; }
    var rc = refl.getContext("2d");
    rc.globalCompositeOperation = "source-over"; rc.setTransform(1, 0, 0, 1, 0, 0); rc.clearRect(0, 0, rw2, rh2);
    rc.setTransform(1, 0, 0, -1, 0, rh2); rc.drawImage(g.canvas, 0, L.gy - rh, W, rh, 0, 0, rw2, rh2);
    rc.setTransform(1, 0, 0, 1, 0, 0); rc.globalCompositeOperation = "destination-in"; rc.drawImage(mask, 0, 0, rw2, rh2);
    g.globalAlpha = 0.42; g.drawImage(refl, 0, L.gy, W, rh); g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    weather(lt, t, dt);
    window.EngineRing.update(now, eng, T, ramS);
    SC.launchpad.ms = SC.launchpad.ms * 0.95 + (performance.now() - t0) * 0.05;
  }

  // ------------------------------------------------------------------ the vehicle
  function rocket(lt, ramF) {
    var C = X.COL, D = L.D, x0 = L.cx - D / 2, cx = L.cx;
    var steel = steelCol(lt), sunL = lt.sx < cx;
    var hi = mix(steel, mix([255, 255, 255], lt.sunC, lt.gold * 0.6), 0.32 + 0.25 * lt.lit), lo = mix(steel, [0, 0, 0], 0.55);
    function grad(base, h, l) {
      var gr = g.createLinearGradient(x0, 0, x0 + D, 0);
      gr.addColorStop(0, rgba(sunL ? mix(h, base, 0.4) : l, 1)); gr.addColorStop(sunL ? 0.24 : 0.76, rgba(h, 1));
      gr.addColorStop(0.5, rgba(base, 1)); gr.addColorStop(1, rgba(sunL ? mix(l, [0, 0, 0], 0.4) : mix(h, base, 0.4), 1));
      return gr;
    }
    var shipB = L.bTop, noseH = D * 1.3, top = L.top;
    // booster
    g.fillStyle = grad(steel, hi, lo); g.fillRect(x0, L.bTop, D, L.bH);
    // frost: the propellant inside (RAM)
    var skirt = L.bH * 0.06, fz = L.bH * 0.86 * ramF, fy = L.by - skirt - fz;
    var frost = mix(mix(lt.amb, [236, 246, 255], 0.38 + 0.45 * Math.max(lt.lit, 0.5 * lt.night)), C.cool, 0.08);
    if (fz > 1) {
      var fg = g.createLinearGradient(0, fy - L.bH * 0.03, 0, fy + L.bH * 0.04);
      fg.addColorStop(0, rgba(frost, 0)); fg.addColorStop(1, rgba(frost, 0.62));
      g.fillStyle = fg; g.fillRect(x0, fy - L.bH * 0.03, D, L.bH * 0.07);
      g.fillStyle = rgba(frost, 0.62); g.fillRect(x0, fy + L.bH * 0.04, D, Math.max(0, fz - L.bH * 0.04));
      g.fillStyle = grad([0, 0, 0], [0, 0, 0], [0, 0, 0]); g.globalAlpha = 0.18; g.fillRect(x0, fy - L.bH * 0.03, D, fz + L.bH * 0.03); g.globalAlpha = 1;
    }
    // skirt and engine bells
    g.fillStyle = rgba(mix(lo, [0, 0, 0], 0.3), 0.9); g.fillRect(x0, L.by - skirt, D, skirt);
    var nb = clamp(eng.length, 5, 13), bw = D * 0.9 / nb, bell = D * 0.2;
    for (var i = 0; i < nb; i++) {
      var bx = L.cx - D * 0.45 + i * bw, load = (eng[Math.floor(i * eng.length / nb)] || 0) / 100;
      g.fillStyle = rgba(mix(lo, [0, 0, 0], 0.4), 1);
      poly(g, [[bx + bw * 0.25, L.by], [bx + bw * 0.75, L.by], [bx + bw * 0.95, L.by + bell], [bx + bw * 0.05, L.by + bell]]);
      if (load > 0.03) { g.fillStyle = rgba(mix(C.accent, [255, 255, 255], 0.3), Math.min(1, load * 1.4)); g.fillRect(bx + bw * 0.08, L.by + bell - Math.max(0.6, H / 1400), bw * 0.84, Math.max(0.6, H / 1400)); }
    }
    // hot-staging ring and grid fins
    g.fillStyle = rgba(mix(lo, [0, 0, 0], 0.5), 1); g.fillRect(x0, L.bTop, D, L.ringH);
    g.fillStyle = rgba(mix(hi, steel, 0.5), 0.8);
    for (i = 0; i < 6; i++) g.fillRect(x0 + D * (0.08 + i * 0.155), L.bTop + L.ringH * 0.3, D * 0.07, L.ringH * 0.4);
    var fy0 = L.bTop + L.ringH * 1.4, fh = L.bH * 0.045;
    g.fillStyle = rgba(mix(lo, [0, 0, 0], 0.2), 1);
    g.fillRect(x0 - D * 0.3, fy0, D * 0.3, fh); g.fillRect(x0 + D, fy0, D * 0.3, fh);
    g.strokeStyle = rgba(mix(steel, hi, 0.3), 0.5); g.lineWidth = L.lw * 0.6; g.beginPath();
    for (i = 1; i < 3; i++) { g.moveTo(x0 - D * 0.3, fy0 + fh * i / 3); g.lineTo(x0, fy0 + fh * i / 3); g.moveTo(x0 + D, fy0 + fh * i / 3); g.lineTo(x0 + D * 1.3, fy0 + fh * i / 3); }
    g.stroke();

    // ship: steel, with the black heat shield on one side and four flaps
    g.save();
    g.beginPath();
    g.moveTo(x0, shipB); g.lineTo(x0, top + noseH);
    g.bezierCurveTo(x0, top + noseH * 0.42, cx - D * 0.2, top, cx, top);
    g.bezierCurveTo(cx + D * 0.2, top, x0 + D, top + noseH * 0.42, x0 + D, top + noseH);
    g.lineTo(x0 + D, shipB); g.closePath();
    g.fillStyle = grad(steel, hi, lo); g.fill();
    g.clip();
    var fzs = L.sH * 0.55 * ramF;
    if (fzs > 1) { g.fillStyle = rgba(frost, 0.5); g.fillRect(x0, shipB - fzs, D, fzs); }
    var tile = mix(C.bg, [0, 0, 0], 0.55), tg = g.createLinearGradient(x0, 0, x0 + D * 0.5, 0);
    tg.addColorStop(0, rgba(mix(tile, lt.amb, 0.12), 1)); tg.addColorStop(1, rgba(tile, 1));
    g.fillStyle = tg; g.fillRect(x0 - 1, top, D * 0.5 + 1, L.sH);
    g.restore();
    var flapL = rgba(mix(tile, lt.amb, 0.1), 1), flapR = rgba(mix(steel, lo, 0.35), 1);
    var f1 = top + noseH * 0.5, f2 = top + noseH * 1.3, a1 = shipB - L.sH * 0.17, a2 = shipB - L.sH * 0.02;
    g.fillStyle = flapL; poly(g, [[x0, f1], [x0 - D * 0.3, f1 + (f2 - f1) * 0.25], [x0 - D * 0.3, f2], [x0, f2]]);
    poly(g, [[x0, a1], [x0 - D * 0.4, a1 + (a2 - a1) * 0.2], [x0 - D * 0.4, a2], [x0, a2]]);
    g.fillStyle = flapR; poly(g, [[x0 + D, f1], [x0 + D * 1.3, f1 + (f2 - f1) * 0.25], [x0 + D * 1.3, f2], [x0 + D, f2]]);
    poly(g, [[x0 + D, a1], [x0 + D * 1.4, a1 + (a2 - a1) * 0.2], [x0 + D * 1.4, a2], [x0 + D, a2]]);

    // the plume and the floodlights light the steel from below
    var up = Math.max(T * 1.1, 0.3 * lt.night);
    if (up > 0.02) {
      g.globalCompositeOperation = "lighter";
      var lc = T * 1.1 >= 0.3 * lt.night ? mix(C.accent, C.orange, 0.2) : mix(C.fg, C.cool, 0.3);
      var ug = g.createLinearGradient(0, L.by, 0, L.by - L.bH * 0.6);
      ug.addColorStop(0, rgba(lc, Math.min(0.6, up * 0.55))); ug.addColorStop(1, rgba(lc, 0));
      g.fillStyle = ug; g.fillRect(x0, L.by - L.bH * 0.6, D, L.bH * 0.6);
      g.globalCompositeOperation = "source-over";
    }
  }

  // every core is an engine: a jet under the booster as long and bright as its load
  function jets(t) {
    var C = X.COL, n = Math.min(eng.length, 16), D = L.D, span = D * 0.88, w = span / n, y0 = L.by + D * 0.2;
    if (jetL.length !== n) { jetL = []; for (var j = 0; j < n; j++) jetL.push(0); }
    var hot = [255, 246, 226], body = mix(C.accent, C.orange, 0.25), meth = mix(C.blue, C.accent2, 0.5);
    g.globalCompositeOperation = "lighter";
    for (var i = 0; i < n; i++) {
      var li = 0, c0 = Math.floor(i * eng.length / n), c1 = Math.max(c0 + 1, Math.floor((i + 1) * eng.length / n));
      for (var k = c0; k < c1; k++) li += eng[k] || 0;
      li = clamp(li / (c1 - c0) / 100, 0, 1);
      if (li < 0.015) continue;
      var x = L.cx - span / 2 + (i + 0.5) * w;
      var len = (L.mountH * 0.5 + L.mountH * 1.6 * li) * (1 + 0.07 * Math.sin(t * 37 + i * 2.3) + 0.04 * Math.sin(t * 91 + i * 5.1));
      var a = Math.pow(li, 0.7);
      var og = g.createLinearGradient(0, y0, 0, y0 + len * 1.2);
      og.addColorStop(0, rgba(meth, 0.35 * a)); og.addColorStop(1, rgba(meth, 0));
      g.fillStyle = og; g.beginPath(); g.ellipse(x, y0 + len * 0.55, w * 1.05 + len * 0.05, len * 0.62, 0, 0, Math.PI * 2); g.fill();
      var bg = g.createLinearGradient(0, y0, 0, y0 + len);
      bg.addColorStop(0, rgba(body, 0.85 * a)); bg.addColorStop(0.7, rgba(body, 0.35 * a)); bg.addColorStop(1, rgba(body, 0));
      g.fillStyle = bg; g.beginPath(); g.ellipse(x, y0 + len * 0.48, w * 0.5 + len * 0.02, len * 0.5, 0, 0, Math.PI * 2); g.fill();
      var cg = g.createLinearGradient(0, y0, 0, y0 + len * 0.6);
      cg.addColorStop(0, rgba(hot, 0.95 * a)); cg.addColorStop(1, rgba(hot, 0));
      g.fillStyle = cg; g.beginPath(); g.ellipse(x, y0 + len * 0.28, w * 0.24, len * 0.3, 0, 0, Math.PI * 2); g.fill();
      if (li > 0.55) {   // shock diamonds when it works hard
        g.fillStyle = rgba(hot, Math.min(0.9, (li - 0.55) * 2));
        for (var d = 1; d <= 3; d++) { g.beginPath(); g.ellipse(x, y0 + len * (0.12 + d * 0.17), w * 0.2, w * 0.32, 0, 0, Math.PI * 2); g.fill(); }
      }
    }
    g.globalCompositeOperation = "source-over";
  }

  // ------------------------------------------------------------------ weather from the real sky
  var flash = 0;
  function weather(lt, t, dt) {
    var C = X.COL, wx = X.wx, i;
    if (wx === "rain" || wx === "storm") {
      g.strokeStyle = rgba(C.fg, 0.2); g.lineWidth = 1; g.beginPath();
      for (i = 0; i < drops.length; i++) {
        var dr = drops[i]; dr[1] += H * 0.44 * dr[2] * dt * 3; dr[0] -= H * 0.08 * dr[2] * dt * 3;
        if (dr[1] > H) { dr[1] = -10; dr[0] = Math.random() * W * 1.1; }
        g.moveTo(dr[0], dr[1]); g.lineTo(dr[0] + H * 0.004, dr[1] - H * 0.018 * dr[2]);
      }
      g.stroke();
    } else if (wx === "snow") {
      g.fillStyle = rgba(C.fg, 0.6);
      for (i = 0; i < drops.length; i++) {
        var sn = drops[i]; sn[1] += H * 0.036 * sn[2] * dt * 3; sn[0] += Math.sin(t + i) * 0.3;
        if (sn[1] > H) { sn[1] = -5; sn[0] = Math.random() * W; }
        g.fillRect(sn[0], sn[1], 1.6, 1.6);
      }
    } else if (wx === "fog") {
      var fz = g.createLinearGradient(0, L.hz - H * 0.2, 0, L.gy + H * 0.1);
      fz.addColorStop(0, rgba(lt.amb, 0)); fz.addColorStop(0.55, rgba(mix(lt.amb, C.fg, 0.2), 0.35)); fz.addColorStop(1, rgba(lt.amb, 0));
      g.fillStyle = fz; g.fillRect(0, L.hz - H * 0.2, W, H * 0.4);
    }
    if (wx === "storm" && Math.random() < 0.004) flash = 1;
    if (flash > 0.02) { g.fillStyle = rgba(C.fg, flash * 0.16); g.fillRect(0, 0, W, H); flash *= 0.8; }
  }

  function resize(api) {
    X = api; g = api.g; W = api.W; H = api.H;
    layout(); seed(); staticKey = ""; smoke = []; vents = [];
  }

  function missionClock(s) {
    s = Math.max(0, Math.floor(s || 0));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return "T+ " + (d ? d + "d " : "") + p(h) + ":" + p(m) + ":" + p(sec);
  }

  SC.launchpad = {
    resize: resize,
    draw: draw,
    alert: function (level, col) { alertEnv = 1; alertCol = col; },
    tag: "▲ HOLD HOLD HOLD",
    ms: 0,
    uptime: missionClock
  };
})();
