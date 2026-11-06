/* Starbase: the Starship theme's own photo is the wallpaper, with a few quiet effects over it.
   - the flame in the photo glows with your CPU: brighter and wider as it works, a slow flicker only under load
   - the photo follows the real sun: dimmer and cooler at night, warmer at sunrise and sunset, flatter when overcast
   - rain, snow and fog from the real weather; an alert tints the scene and the banner says HOLD HOLD HOLD
   - the engine ring (engine-ring.js): every core is an engine, propellant = RAM
   - with WebGL (photo-gl.js) the photo itself moves a little: the smoke billows, hot air shimmers over the flame,
     streaks run down the plume and pressure ripples roll out through the smoke, faster with the load
   The photo is the current Omarchy background (the next-background key keeps working), served by the hub at /bg
   and shown at full resolution; the light effects are drawn on the scene canvas, screened over it.
   ?dbg=mask shows the masks (red: smoke that billows, green: plume, blue: rigid parts that never move).
   ?tour=1 plays a 2-minute show (idle, throttle up, an alert, the four photos, rain, night) once the desktop is
   visible, pausing while windows cover it, then goes back to the live data.
   Preview overrides: ?cpu=80&ram=60&tod=21&wx=rain   ?demo=1 ramps the load (?demo=20: every 20 s). MIT, like Pulse. */
(function () {
  "use strict";
  var SC = window.PulseScenes = window.PulseScenes || {};

  // what is where in each Starship photo, in fractions of the image (radii in image heights):
  //   flame: centre, r: its radius; plume: x, top, bottom of the exhaust; fire: the photo shows the engines running
  //   wash: the smoke the fire lights up (half width, half height); smoke: centre x, y and radii of the smoke that
  //   billows; keep: boxes x0, y0, x1, y1 that never move (rocket, tower, engines)
  var SPOTS = {
    "1-starbase": { flame: [0.5, 0.69], r: 0.075, plume: [0.488, 0.47, 0.69], fire: true, wash: [0.6, 0.13],
      smoke: [0.5, 0.64, 0.85, 0.3], keep: [[0.452, 0.22, 0.512, 0.715]] },
    "2-flight14-dawn": { flame: [0.525, 0.8], r: 0.085, plume: [0.497, 0.6, 0.78], fire: true, wash: [0.55, 0.15],
      smoke: [0.5, 0.6, 0.9, 0.36], keep: [[0.455, 0.12, 0.556, 0.8]] },
    "3-engine-cluster": { flame: [0.49, 0.5], r: 0.2, plume: [0.49, 0.62, 0.98], fire: true, wide: true, gain: 0.4,
      smoke: [0.5, 0.2, 0.55, 0.26], keep: [[0.2, 0.2, 0.75, 0.66]] },
    "4-morning-pad": { flame: [0.505, 0.655], r: 0.045, fire: false, wash: [0.25, 0.06],
      smoke: [0.2, 0.6, 0.36, 0.15], keep: [[0.43, 0.27, 0.566, 0.72]] }
  };

  var X = null, g = null, W = 0, H = 0;
  var photo = null, scrim = null, imgV = null, iw = 0, ih = 0, spot = null;
  var eng = [], T = 0, ramS = -1, last = 0, need = true, drawnT = -1, gradeKey = "";
  var alertEnv = 0, alertCol = null, flash = 0, drops = [];
  var glc = null, pgl = null, gradeM = [1, 0, 0, 0, 1, 0, 0, 0, 1], ripples = [], ripT = 0;

  // ------------------------------------------------------------------ the tour (?tour=1)
  var TOUR = [
    { d: 12, bg: "1-starbase", tod: 13, cpu: 4, t: "idle", s: "the theme's own photo · the smoke breathes slowly" },
    { d: 18, bg: "1-starbase", tod: 13, cpu: [4, 96], t: "throttle up", s: "every core is an engine · glow, heat shimmer and ripples follow the load" },
    { d: 12, bg: "1-starbase", tod: 13, cpu: 96, t: "full throttle", s: "pressure ripples twice a second", alert: 3 },
    { d: 13, bg: "2-flight14-dawn", tod: 7.3, cpu: 75, t: "dawn", s: "next background · the colour follows your real sunrise" },
    { d: 13, bg: "3-engine-cluster", tod: 12, cpu: 88, t: "engine cluster", s: "hot air shimmers under the engines" },
    { d: 13, bg: "4-morning-pad", tod: 7, cpu: [15, 85], t: "morning pad", s: "no fire in this photo · the pad lights up instead" },
    { d: 13, bg: "1-starbase", tod: 15, cpu: 45, wx: "rain", t: "rain", s: "your real weather, over the photo" },
    { d: 14, bg: "1-starbase", tod: 22, cpu: 60, t: "night", s: "after sunset the photo dims and cools" },
    { d: 12, live: true, t: "live", s: "back to live data · it follows your PC from here" }
  ];
  var tour = null;
  function tourTick(dt) {
    if (!tour) {
      if (X.Q.get("tour") == null) return;
      tour = { i: -1, el: 0, total: 0, cap: document.createElement("div"), alerted: false };
      TOUR.forEach(function (st) { tour.total += st.d; if (st.bg) { var im = new Image(); im.src = bgUrl(st.bg); } });   // warm the cache
      tour.cap.id = "sb-tour"; tour.cap.innerHTML = '<div class="t"></div><div class="s"></div><div class="bar"><i></i></div>';
      document.body.appendChild(tour.cap);
    }
    if (tour.done || !X.state || !X.state.sys || !iw) return;   // (waits for the data and the photo)   // (no data yet: we do not know about windows either)
    if (X.busy && tour.i < 0) return;   // waits for an empty workspace
    if (!X.busy) tour.el += dt;          // and pauses while windows cover the desktop
    var acc = 0, i = 0;
    while (i < TOUR.length && tour.el >= acc + TOUR[i].d) { acc += TOUR[i].d; i++; }
    if (i >= TOUR.length) return endTour();
    var st = TOUR[i], k = (tour.el - acc) / st.d;
    if (i !== tour.i) {
      tour.i = i; tour.alerted = false;
      ["bg", "tod", "wx", "cpu"].forEach(function (n) { X.Q.delete(n); });
      if (st.bg) X.Q.set("bg", st.bg);
      if (st.tod != null) X.Q.set("tod", st.tod);
      if (st.wx) X.Q.set("wx", st.wx);
      tour.cap.querySelector(".t").textContent = (i + 1) + "/" + TOUR.length + " · " + st.t;
      tour.cap.querySelector(".s").textContent = st.s;
      tour.cap.className = "on";
      SC.starbase.fps = Math.max(20, +X.Q.get("fps") || 0);
    }
    if (st.cpu != null) X.Q.set("cpu", (Array.isArray(st.cpu) ? st.cpu[0] + (st.cpu[1] - st.cpu[0]) * Math.min(1, k * 1.15) : st.cpu).toFixed(1));
    if (st.alert && !tour.alerted && tour.el - acc > st.alert) { tour.alerted = true; demoAlert(); }
    tour.cap.querySelector(".bar i").style.width = (tour.el / tour.total * 100).toFixed(1) + "%";
  }
  function endTour() {
    tour.done = true;
    ["bg", "tod", "wx", "cpu", "tour"].forEach(function (n) { X.Q.delete(n); });
    tour.cap.className = "";
    SC.starbase.fps = 12;
    try { history.replaceState(null, "", location.pathname + "?" + X.Q.toString()); } catch (e) { /* a reload will not replay it */ }
  }
  function demoAlert() {   // what a real alert looks like (nothing is sent anywhere)
    var box = document.getElementById("incoming");
    alertEnv = 1; alertCol = X.COL.crit;
    if (!box) return;
    box.className = "crit"; box.hidden = false;
    box.querySelector(".tag").textContent = SC.starbase.tag;
    box.querySelector(".title").textContent = "CPU temperature";
    box.querySelector(".text").textContent = "97 °C";
    setTimeout(function () { box.hidden = true; }, 6000);
  }
  function fakeCores(cpu, n) {
    var t = performance.now() / 1000, out = [];
    for (var i = 0; i < n; i++) out.push(clamp(cpu + 22 * Math.sin(t * 0.6 + i * 1.9) + 9 * Math.sin(t * 2.3 + i), 0, 100));
    return out;
  }
  // preview overrides reach the panels too (the system panel shows the same CPU as the engines, the weather the rain)
  function prepare(st) {
    if (!X) return;
    var s = st.sys, c = q("cpu");
    if (s && c != null) {
      s.cpu = Math.round(c); s.cores = fakeCores(c, (s.cores || []).length || 16); s.temp = Math.round(48 + c * 0.42);
      if (st.hist && st.hist.cpu) { var h = st.hist.cpu; h.splice(0, h.length - 1); for (var k = 0; k < 60; k++) h.push(Math.round(c)); }
    }
    var wx = X.Q.get("wx"), w = st.weather;
    if (w && wx) { w.code = { rain: 63, storm: 95, snow: 73, fog: 45, cloud: 3, part: 2, clear: 0 }[wx]; if (wx === "rain") { w.rain = 2.1; w.temp = Math.min(w.temp, 19.4); } }
    if (w && q("tod") != null) w.day = q("tod") > 7 && q("tod") < 18.3 ? 1 : 0;
  }
  // during the tour the clock shows the hour it is playing (night at night)
  window.PulseNow = function () {
    var d = new Date(), h = tour && !tour.done ? q("tod") : null;
    if (h != null) d.setHours(Math.floor(h), Math.round((h % 1) * 60));
    return d;
  };
  function bgUrl(name) {
    return "/bg?token=" + encodeURIComponent(X.Q.get("token") || "") + "&v=" + encodeURIComponent("preview:" + name) + "&name=" + encodeURIComponent(name);
  }

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function hm(s) { var m = /(\d+):(\d+)/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; }
  function q(name) { var v = X.Q.get(name); return v == null || v === "" ? null : parseFloat(v); }
  function rgba(c, a) { return X.rgba(c, clamp(a, 0, 1)); }
  function mix(a, b, t) { return X.mix(a, b, clamp(t, 0, 1)); }

  // ------------------------------------------------------------------ the photo
  function ensurePhoto() {
    if (!photo) {
      photo = document.createElement("div"); photo.id = "sb-photo";
      scrim = document.createElement("div"); scrim.id = "sb-scrim";
      document.body.insertBefore(scrim, document.body.firstChild);
      document.body.insertBefore(photo, document.body.firstChild);
      if (window.PhotoGL && X.Q.get("gl") !== "0") {
        glc = document.createElement("canvas"); glc.id = "sb-gl";
        document.body.insertBefore(glc, scrim);
        try { pgl = window.PhotoGL.create(glc); } catch (e) { pgl = null; }
        if (!pgl) { glc.remove(); glc = null; }   // no WebGL: the plain photo
      }
    }
    var bg = X.state && X.state.bg, v = bg ? bg.v : "", force = X.Q.get("bg");
    if (force) { bg = { name: force, v: "preview:" + force }; v = bg.v; }   // ?bg=2-flight14-dawn: preview another photo
    if (v === imgV) return;
    imgV = v;
    if (!bg) { photo.style.backgroundImage = ""; spot = null; iw = 0; need = true; return; }
    var url = "/bg?token=" + encodeURIComponent(X.Q.get("token") || "") + "&v=" + encodeURIComponent(v) + (force ? "&name=" + encodeURIComponent(force) : "");
    var im = new Image();
    im.onload = function () {
      if (imgV !== v) return;
      iw = im.naturalWidth; ih = im.naturalHeight;
      if (pgl) { pgl.setImage(im); photo.style.display = "none"; }
      else photo.style.backgroundImage = 'url("' + url + '")';
      spot = SPOTS[bg.name.replace(/\.[^.]+$/, "")] || null;   // another photo: no flame, the rest still works
      need = true;
    };
    im.src = url;
  }

  // a point of the photo (fractions) on the canvas, as background-size: cover puts it; [x, y, shown image height]
  function at(fx, fy) {
    var s = Math.max(W / iw, H / ih);
    return [(W - iw * s) / 2 + fx * iw * s, (H - ih * s) / 2 + fy * ih * s, ih * s];
  }

  // ------------------------------------------------------------------ the real sun, as a colour grade
  function light() {
    var w = X.weather || {}, d = new Date();
    var now = d.getHours() * 60 + d.getMinutes();
    if (q("tod") != null) now = (q("tod") % 24) * 60;
    var sr = hm(w.sunrise), ss = hm(w.sunset);
    if (sr == null || ss == null || ss <= sr) { sr = 390; ss = 1110; }
    var f = (now - sr) / (ss - sr), alt = f >= 0 && f <= 1 ? Math.sin(Math.PI * f) : -Math.min(1, (f < 0 ? sr - now : now - ss) / 150);
    var wx = X.wx, oc = wx === "cloud" || wx === "fog" ? 0.6 : wx === "rain" || wx === "snow" ? 0.7 : wx === "storm" ? 0.8 : wx === "part" ? 0.2 : 0;
    return { gold: Math.exp(-Math.pow(alt / 0.26, 2)) * (1 - oc * 0.75), night: 1 - sstep(-0.5, -0.02, alt), oc: oc };
  }
  function grade() {
    var lt = light();
    var b = 1 - 0.46 * lt.night - 0.1 * lt.oc, sat = 1 - 0.32 * lt.night - 0.3 * lt.oc + 0.1 * lt.gold, sep = 0.14 * lt.gold * (1 - lt.night);
    var hue = lt.night > 0.3 ? -12 * lt.night : 0;
    var f = "brightness(" + b.toFixed(2) + ") saturate(" + sat.toFixed(2) + ") sepia(" + sep.toFixed(2) + ")";
    if (hue) f += " hue-rotate(" + hue.toFixed(0) + "deg)";
    if (f === gradeKey) return;   // a handful of changes a day
    gradeKey = f;
    if (pgl) gradeM = gradeMatrix(+b.toFixed(2), +sat.toFixed(2), +sep.toFixed(2), +hue.toFixed(0));
    else photo.style.filter = f;
  }
  // the CSS filter maths (brightness, saturate, sepia, hue-rotate, in that order) as one matrix for the shader
  function gradeMatrix(b, s, sp, hue) {
    function mul(A, B) { var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) for (var k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j]; return C; }
    var Bm = [[b, 0, 0], [0, b, 0], [0, 0, b]];
    var Sm = [[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]];
    var P0 = [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]], Pm = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) Pm[i][j] = (i === j ? 1 - sp : 0) + P0[i][j] * sp;
    var a = hue * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
    var Hm = [[0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928],
      [0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.14, 0.072 - c * 0.072 - n * 0.283],
      [0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072]];
    var M = mul(Hm, mul(Pm, mul(Sm, Bm)));
    return [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]];   // column-major
  }

  // ------------------------------------------------------------------ the frame
  function draw(api) {
    X = api; g = api.g;
    if (api.W !== W || api.H !== H) { W = api.W; H = api.H; seed(); need = true; }
    var now = api.now, t = api.t, dt = last ? Math.min(0.5, (now - last) / 1000) : 0.1, i;
    last = now;
    tourTick(dt);
    ensurePhoto(); grade();

    var cores = api.cores || [], cpu = api.cpu || 0, ram = api.ram || 0;
    if (q("demo") != null) X.Q.set("cpu", (48 - 46 * Math.cos(t * Math.PI * 2 / (q("demo") >= 5 ? q("demo") : 40))).toFixed(1));
    if (q("cpu") != null) { cpu = q("cpu"); cores = fakeCores(cpu, cores.length || 16); }
    if (q("ram") != null) ram = q("ram");
    var tgt = window.EngineRing.engines(cores, cpu), kf = 1 - Math.exp(-dt * 2);
    if (eng.length !== tgt.length) eng = tgt.slice();
    var sum = 0;
    for (i = 0; i < tgt.length; i++) { eng[i] += (tgt[i] - eng[i]) * kf; sum += eng[i]; }
    T += (sum / Math.max(1, eng.length) / 100 - T) * kf;
    ramS = ramS < 0 ? ram : ramS + (ram - ramS) * kf;
    window.EngineRing.update(now, eng, T, ramS);

    // the moving photo: pressure ripples leave the engines like heartbeats (rare and faint at idle)
    if (pgl && iw) {
      ripT += dt;
      if (ripT > 60 / (14 + 100 * T)) { ripT = 0; ripples.unshift([0, 0.15 + 0.85 * T]); }
      ripples = ripples.filter(function (r) { r[0] += dt * (0.26 + 0.2 * T); r[1] *= Math.exp(-dt * 0.8); return r[0] < 1.3 && r[1] > 0.01; }).slice(0, 4);
      pgl.draw({ time: t, thr: T, spot: spot, billow: 0.35 + 0.65 * T, ripples: ripples, grade: gradeM, dbg: X.Q.get("dbg") === "mask" });
    }

    alertEnv *= Math.exp(-dt / 2.5);
    var wx = X.wx, falling = wx === "rain" || wx === "storm" || wx === "snow";
    var moving = T > 0.05 || falling || alertEnv > 0.02 || flash > 0.02;
    if (!moving && !need && Math.abs(T - drawnT) < 0.004) return;   // nothing changed: the canvas stays as it is
    need = false; drawnT = T;
    g.clearRect(0, 0, W, H);
    if (spot && iw) fire(t);
    weather(t, dt);
    if (alertEnv > 0.02 && alertCol) { g.fillStyle = rgba(alertCol, 0.2 * alertEnv * (0.75 + 0.25 * Math.sin(t * 9))); g.fillRect(0, 0, W, H); }
  }

  // the photo's own flame, brighter with the load (the canvas is screened over the photo: it can only add light).
  // Idle adds nothing: the photo as it is.
  function fire(t) {
    var C = X.COL, p = at(spot.flame[0], spot.flame[1]), shown = p[2];
    var I = Math.pow(T, spot.fire ? 0.85 : 1.2) * (spot.gain || 1);
    I *= 1 + Math.min(1, T * 1.5) * (0.06 * Math.sin(t * 7.3) + 0.035 * Math.sin(t * 19.1 + 1.3));   // slow flicker
    if (I < 0.01) return;
    var warm = mix(C.accent, C.orange, 0.3), hot = [255, 236, 206];
    var r = spot.r * shown * (0.8 + 0.9 * T), R = r * 4.5;
    if (spot.wash) {   // the smoke around the pad catches the light
      var rx = spot.wash[0] * shown, ry = spot.wash[1] * shown;
      g.save(); g.translate(p[0], p[1] + r * 0.2); g.scale(rx / ry, 1);
      var wg = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      wg.addColorStop(0, rgba(warm, 0.3 * I)); wg.addColorStop(0.6, rgba(warm, 0.1 * I)); wg.addColorStop(1, rgba(warm, 0));
      g.fillStyle = wg; g.fillRect(-ry, -ry, ry * 2, ry * 2); g.restore();
    }
    var bl = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
    bl.addColorStop(0, rgba(warm, 0.45 * I)); bl.addColorStop(0.45, rgba(warm, 0.14 * I)); bl.addColorStop(1, rgba(warm, 0));
    g.fillStyle = bl; g.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
    var cg = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    cg.addColorStop(0, rgba(hot, 0.8 * I)); cg.addColorStop(0.45, rgba(warm, 0.4 * I)); cg.addColorStop(1, rgba(warm, 0));
    g.fillStyle = cg; g.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
    if (spot.plume) {
      var a = at(spot.plume[0], spot.plume[1]), b = at(spot.plume[0], spot.plume[2]);
      var w = shown * (spot.wide ? 0.12 : 0.016) * (0.8 + 0.8 * T), cy = (a[1] + b[1]) / 2;
      var pg = g.createLinearGradient(0, a[1], 0, b[1]);
      pg.addColorStop(0, rgba(hot, 0.5 * I)); pg.addColorStop(1, rgba(warm, 0.22 * I));
      g.fillStyle = pg; g.beginPath(); g.ellipse(a[0], cy, w, (b[1] - a[1]) / 2, 0, 0, Math.PI * 2); g.fill();
    }
  }

  function seed() {
    var R = X.rnd(77);
    drops = []; for (var i = 0; i < 160; i++) drops.push([R() * W, R() * H, 0.6 + R() * 0.8]);
  }
  function weather(t, dt) {
    var C = X.COL, wx = X.wx, i;
    if (wx === "rain" || wx === "storm") {
      g.strokeStyle = rgba(C.fg, 0.16); g.lineWidth = 1; g.beginPath();
      for (i = 0; i < drops.length; i++) {
        var dr = drops[i]; dr[1] += H * 1.3 * dr[2] * dt; dr[0] -= H * 0.24 * dr[2] * dt;
        if (dr[1] > H) { dr[1] = -10; dr[0] = Math.random() * W * 1.1; }
        g.moveTo(dr[0], dr[1]); g.lineTo(dr[0] + H * 0.004, dr[1] - H * 0.018 * dr[2]);
      }
      g.stroke();
    } else if (wx === "snow") {
      g.fillStyle = rgba(C.fg, 0.5);
      for (i = 0; i < drops.length; i++) {
        var sn = drops[i]; sn[1] += H * 0.1 * sn[2] * dt; sn[0] += Math.sin(t + i) * 0.3;
        if (sn[1] > H) { sn[1] = -5; sn[0] = Math.random() * W; }
        g.fillRect(sn[0], sn[1], 1.6, 1.6);
      }
    } else if (wx === "fog") {
      var fz = g.createLinearGradient(0, H * 0.35, 0, H);
      fz.addColorStop(0, rgba(C.fg, 0)); fz.addColorStop(0.5, rgba(C.fg, 0.1)); fz.addColorStop(1, rgba(C.fg, 0.04));
      g.fillStyle = fz; g.fillRect(0, H * 0.35, W, H * 0.65);
    }
    if (wx === "storm" && Math.random() < 0.004) flash = 1;
    if (flash > 0.02) { g.fillStyle = rgba(C.fg, flash * 0.14); g.fillRect(0, 0, W, H); flash *= 0.8; }
  }

  function missionClock(s) {
    s = Math.max(0, Math.floor(s || 0));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return "T+ " + (d ? d + "d " : "") + p(h) + ":" + p(m) + ":" + p(sec);
  }

  SC.starbase = {
    resize: function (api) { X = api; g = api.g; W = api.W; H = api.H; seed(); need = true; },
    draw: draw,
    alert: function (level, col) { alertEnv = 1; alertCol = col; },
    tag: "▲ HOLD HOLD HOLD",
    uptime: missionClock,
    fps: 12,
    prepare: prepare
  };
})();
