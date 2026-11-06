/* Omarchy Pulse: the wallpaper page. Reads /api/state from the local hub once a second and draws:
   a scene that is the data (the skyline is your CPU cores, the horizon beats with your load, the aurora is your
   network, the weather falls from the sky) and Omarchy-style panels for every source.
   (c) 2026 Marco Porro (x.com/MarcoPorro), MIT. */
(function () {
  "use strict";
  var Q = new URLSearchParams(location.search);
  var TOKEN = Q.get("token") || "";
  var MONKEY = (Q.get("mx") || "0") + "," + (Q.get("my") || "0");
  var PRIMARY = Q.get("primary") !== "0";
  var S = null;               // last state
  var seenAlert = -1;         // alerts already shown
  var themeKey = "";
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // ------------------------------------------------------------------ colours from the Omarchy theme
  var COL = {};
  function hexRgb(h) {
    h = String(h || "").replace("#", "");
    if (h.length === 3) h = h.replace(/(.)/g, "$1$1");
    var n = parseInt(h.slice(0, 6), 16);
    return isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function applyTheme(t) {
    var c = (t && t.colors) || {};
    var key = JSON.stringify(c);
    if (key === themeKey) return;
    themeKey = key;
    // colorN (terminal palette themes) or the named keys of Omarchy's stock colors.toml (red, cyan, muted...)
    var map = { bg: c.background, fg: c.foreground, accent: c.accent || c.color6, accent2: c.color5 || c.color13 || c.magenta,
      ok: c.color2 || c.green, warn: c.color3 || c.yellow, crit: c.color1 || c.red, dim: c.color8 || c.muted,
      cool: c.cyan || c.color6, blue: c.blue || c.color4, orange: c.orange || c.bright_yellow || c.color11 };
    var root = document.documentElement.style;
    Object.keys(map).forEach(function (k) {
      var rgb = hexRgb(map[k]);
      if (!rgb) { root.removeProperty("--" + k); root.removeProperty("--" + k + "-rgb"); return; }
      root.setProperty("--" + k, map[k]);
      root.setProperty("--" + k + "-rgb", rgb.join(","));
    });
    var cs = getComputedStyle(document.documentElement);
    ["bg", "fg", "accent", "accent2", "ok", "warn", "crit", "dim", "cool", "blue", "orange"].forEach(function (k) {
      COL[k] = (cs.getPropertyValue("--" + k + "-rgb") || "0,0,0").trim().split(",").map(Number);
    });
    COL.light = lum(COL.bg) > 0.5;
    Scene.reset();
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t | 0, a[1] + (b[1] - a[1]) * t | 0, a[2] + (b[2] - a[2]) * t | 0]; }

  // ------------------------------------------------------------------ formatting
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function bytes(n, rate) {
    var u = rate ? ["B/s", "KB/s", "MB/s", "GB/s"] : ["B", "KB", "MB", "GB", "TB"], i = 0;
    n = +n || 0;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return (n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)) + " " + u[i];
  }
  function ago(t) {
    if (!t) return "";
    var s = Math.max(0, Date.now() / 1000 - t);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  function upt(s) {
    s = +s || 0;
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return (d ? d + "d " : "") + (d || h ? h + "h " : "") + m + "m";
  }
  function num(v) {
    if (typeof v !== "number") return esc(v);
    var a = Math.abs(v);
    return a >= 10000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, "") || "0";
  }

  // ------------------------------------------------------------------ sparklines
  function spark(cv, series, opts) {
    opts = opts || {};
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== (w * dpr | 0)) { cv.width = w * dpr | 0; cv.height = h * dpr | 0; }
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var max = opts.max || 0;
    series.forEach(function (s) { (s.v || []).forEach(function (x) { if (x > max) max = x; }); });
    if (!max) max = 1;
    g.strokeStyle = rgba(COL.dim, 0.35); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.stroke();
    series.forEach(function (s) {
      var v = s.v || [];
      if (v.length < 2) return;
      var n = Math.max(v.length, opts.n || 60);
      var step = w / (n - 1), x0 = w - (v.length - 1) * step;
      g.beginPath();
      v.forEach(function (x, i) { var y = h - 2 - (x / max) * (h - 5); if (i) g.lineTo(x0 + i * step, y); else g.moveTo(x0, y); });
      var grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(s.c, 0.35)); grad.addColorStop(1, rgba(s.c, 0));
      g.lineWidth = 1.6; g.strokeStyle = rgba(s.c, 0.95); g.stroke();
      g.lineTo(w, h); g.lineTo(x0, h); g.closePath(); g.fillStyle = grad; g.fill();
    });
  }

  // ------------------------------------------------------------------ weather icons (drawn, so every font works)
  var WX = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "drizzle", 53: "drizzle", 55: "drizzle",
    56: "freezing drizzle", 57: "freezing drizzle", 61: "rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "showers", 81: "showers", 82: "violent showers",
    85: "snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm" };
  function wxKind(c) {
    c = +c;
    if (c >= 95) return "storm";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 51) return "rain";
    if (c === 45 || c === 48) return "fog";
    if (c === 3) return "cloud";
    if (c === 1 || c === 2) return "part";
    return "clear";
  }
  function wxSvg(code, day) {
    var k = wxKind(code), a = "var(--accent)", b = "var(--accent2)", f = "var(--fg)";
    var sun = day ? '<circle cx="34" cy="30" r="11" fill="none" stroke="' + b + '" stroke-width="2.5"/>' +
      [0, 45, 90, 135, 180, 225, 270, 315].map(function (d) { var r = d * Math.PI / 180; return '<line x1="' + (34 + Math.cos(r) * 15) + '" y1="' + (30 + Math.sin(r) * 15) + '" x2="' + (34 + Math.cos(r) * 19) + '" y2="' + (30 + Math.sin(r) * 19) + '" stroke="' + b + '" stroke-width="2.5" stroke-linecap="round"/>'; }).join("")
      : '<path d="M42 18a13 13 0 1 0 8 22a11 11 0 1 1 -8 -22z" fill="none" stroke="' + b + '" stroke-width="2.5"/>';
    var cloud = '<path d="M22 58h34a11 11 0 0 0 0-22a15 15 0 0 0-28-4a10 10 0 0 0-6 26z" fill="rgba(var(--bg-rgb),.9)" stroke="' + a + '" stroke-width="2.5" stroke-linejoin="round"/>';
    var drops = function (n, sym) {
      var o = "";
      for (var i = 0; i < n; i++) {
        var x = 28 + i * 9;
        o += sym === "snow" ? '<text x="' + (x - 3) + '" y="76" font-size="11" fill="' + f + '">*</text>'
          : '<line x1="' + x + '" y1="64" x2="' + (x - 4) + '" y2="74" stroke="' + a + '" stroke-width="2.5" stroke-linecap="round"/>';
      }
      return o;
    };
    var body = { clear: sun, part: sun + cloud, cloud: cloud, fog: cloud + '<line x1="18" y1="66" x2="66" y2="66" stroke="' + f + '" stroke-width="2" opacity=".6"/><line x1="24" y1="73" x2="60" y2="73" stroke="' + f + '" stroke-width="2" opacity=".4"/>',
      rain: cloud + drops(4), snow: cloud + drops(4, "snow"),
      storm: cloud + '<path d="M44 60l-7 10h7l-5 9" fill="none" stroke="var(--warn)" stroke-width="2.8" stroke-linejoin="round"/>' + drops(2) }[k];
    return '<svg viewBox="0 0 84 84">' + body + "</svg>";
  }

  // ------------------------------------------------------------------ panels
  var panels = {};   // id -> element
  function panel(id, title, icon) {
    var el = panels[id];
    if (!el) {
      el = document.createElement("div");
      el.className = "panel";
      el.innerHTML = '<div class="legend"></div><div class="corner"></div><div class="body"></div><div class="err"></div><div class="cover">PRIVATE</div>';
      panels[id] = el;
    }
    var lg = (icon ? '<span class="ic">' + esc(icon) + "</span>" : "") + esc(title);
    if (el._lg !== lg) { el.querySelector(".legend").innerHTML = lg; el._lg = lg; }
    return el;
  }
  function setHTML(el, html) { if (el._h !== html) { el.innerHTML = html; el._h = html; } }
  function bodyOf(el) { return el.querySelector(".body"); }

  function sysPanel(s, h) {
    var el = panel("sys", "system", "󰍛");
    var b = bodyOf(el);
    if (!b._built) {
      b.innerHTML = '<div class="cpuhead"><div class="big"><span class="cpu">0</span><small>% cpu</small></div><div class="side"></div></div>' +
        '<canvas class="spark"></canvas><div class="cores"></div><div class="meters"></div>';
      b._built = true;
    }
    $(".cpu", b).textContent = Math.round(s.cpu || 0);
    setHTML($(".side", b), "load " + esc((s.load || []).join(" ")) + "<br>up " + upt(s.uptime));
    var cores = s.cores || [];
    var cb = $(".cores", b);
    if (cb.children.length !== Math.min(cores.length, 32)) { cb.innerHTML = cores.slice(0, 32).map(function () { return "<i></i>"; }).join(""); }
    cores.slice(0, 32).forEach(function (v, i) { cb.children[i].style.height = Math.max(4, v) + "%"; });
    spark($(".spark", b), [{ v: h.cpu, c: COL.accent }], { max: 100, n: 90 });
    var gb = function (n) { return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1); };
    var m = [["ram", s.ram, gb(s.ramUsed) + "/" + gb(s.ramTotal) + "G"]];
    if (s.gpu != null) m.push(["gpu", s.gpu, Math.round(s.gpu) + "%"]);
    if (s.temp != null) m.push(["temp", Math.min(100, s.temp), Math.round(s.temp) + "°C", s.temp >= 85 ? "var(--crit)" : s.temp >= 75 ? "var(--warn)" : null]);
    m.push(["disk", s.disk, Math.round(s.disk) + "%", s.disk >= 90 ? "var(--warn)" : null]);
    if (s.bat) m.push(["bat", s.bat.pct, s.bat.pct + "%" + (s.bat.status === "Charging" ? " ⚡" : ""), s.bat.pct < 15 ? "var(--crit)" : null]);
    setHTML($(".meters", b), m.map(function (r) {
      return '<div class="meter"><span class="k">' + r[0] + '</span><div class="seg"><i style="width:' + Math.max(0, Math.min(100, r[1] || 0)).toFixed(1) + "%" + (r[3] ? ";--c:" + r[3] : "") + '"></i></div><span class="v">' + esc(r[2]) + "</span></div>";
    }).join(""));
    return el;
  }

  function netPanel(s, h) {
    var el = panel("net", "network", "󰛳");
    var b = bodyOf(el);
    if (!b._built) {
      b.innerHTML = '<div class="row"><span class="k">↓ down</span><span class="v rx"></span></div><div class="row"><span class="k">↑ up</span><span class="v tx"></span></div>' +
        '<canvas class="spark"></canvas><div class="row"><span class="k">' + esc(s.user || "") + "@" + esc(s.host || "") + '</span><span class="v ip"></span></div>';
      b._built = true;
    }
    $(".rx", b).textContent = bytes(s.rx, true);
    $(".tx", b).textContent = bytes(s.tx, true);
    $(".ip", b).textContent = s.ip || "offline";
    spark($(".spark", b), [{ v: h.rx, c: COL.accent }, { v: h.tx, c: COL.accent2 }], { n: 90 });
    return el;
  }

  function weatherPanel(w) {
    var el = panel("weather", "weather" + (w && w.city ? " · " + w.city : ""), "󰖐");
    var b = bodyOf(el);
    if (!w || w.error) { setHTML(b, '<div class="note">' + esc(w ? w.error : "") + "</div>"); return el; }
    var hrs = (w.hours || []).slice(0, 12);
    var tmin = Math.min.apply(null, hrs.map(function (x) { return x.t; }).concat([w.lo])), tmax = Math.max.apply(null, hrs.map(function (x) { return x.t; }).concat([w.hi]));
    setHTML(b, '<div class="wx">' + wxSvg(w.code, w.day) + '<div><div class="big">' + Math.round(w.temp) + "<small>" + esc(w.unit) + '</small></div><div class="cond">' + esc(WX[w.code] || "") + "</div></div></div>" +
      '<div class="wxrow"><span>feels ' + Math.round(w.feels) + "°</span><span>↑" + Math.round(w.hi) + "° ↓" + Math.round(w.lo) + "°</span><span>" + Math.round(w.wind) + " " + esc(w.windUnit) + "</span><span>" + w.hum + "%</span></div>" +
      '<div class="hours">' + hrs.map(function (x) {
        var hh = 12 + 78 * (x.t - tmin) / Math.max(1, tmax - tmin);
        return '<div title="' + x.t + '"><b style="height:' + hh.toFixed(0) + "%;" + (x.p >= 40 ? "background:rgba(var(--accent2-rgb)," + (0.35 + x.p / 160).toFixed(2) + ")" : "") + '"></b><span>' + x.h + "</span></div>";
      }).join("") + '</div><div class="wxrow"><span>☀ ' + esc(w.sunrise) + "</span><span>" + (w.stale ? "offline" : "rain " + Math.max.apply(null, hrs.map(function (x) { return x.p; }).concat([0])) + "% next 12h") + "</span><span>☾ " + esc(w.sunset) + "</span></div>");
    return el;
  }

  var typed = {};   // id -> {full, shown}
  function generic(w) {
    var el = panel(w.id, w.title || w.id, w.icon);
    var d = w.data || {}, b = bodyOf(el), t = w.type, html = "";
    var unit = d.unit || w.unit_override || "";
    if (t === "stat") {
      html = '<div class="big">' + num(d.value) + (unit ? "<small>" + esc(unit) + "</small>" : "") + "</div>" +
        (d.note ? '<div class="note">' + esc(d.note) + "</div>" : "") + ((d.history || []).length > 2 ? '<canvas class="spark"></canvas>' : "");
    } else if (t === "gauge") {
      var max = d.max || 100, min = d.min || 0, pct = Math.max(0, Math.min(100, 100 * ((+d.value || 0) - min) / (max - min || 1)));
      html = '<div class="row"><span class="big" style="font-size:2.2rem">' + num(d.value) + "<small>" + esc(unit) + '</small></span></div><div class="seg" style="height:.8rem"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        (d.note ? '<div class="note">' + esc(d.note) + "</div>" : "");
    } else if (t === "list") {
      html = '<ul class="items">' + (d.items || []).slice(0, w.slot === "center" ? 4 : 6).map(function (it) {
        return '<li><span class="dot ' + (it.level ? "lv-" + it.level : "") + '"></span><div style="min-width:0"><div class="t">' + esc(it.title) + "</div>" +
          (it.text ? '<div class="s">' + esc(it.text) + "</div>" : "") + '</div><span class="r">' + esc(it.right || ago(it.t) || (it.value != null ? it.value + (it.unit || "") : "")) + "</span></li>";
      }).join("") + "</ul>" + (d.note ? '<div class="note">' + esc(d.note) + "</div>" : "");
    } else if (t === "status") {
      // long names (problems, alerts) get one tile per line instead of being cut in two columns
      var wide = (d.items || []).some(function (it) { return String(it.title || "").length > 15; });
      html = '<div class="tiles' + (wide ? " one" : "") + '">' + (d.items || []).slice(0, wide ? 6 : 12).map(function (it) {
        return '<div class="tile ' + (it.level || "") + '"><span class="dot ' + (it.level ? "lv-" + it.level : "") + '"></span><span class="n">' + esc(it.title) + '</span><span class="m">' + esc(it.note || "") + "</span></div>";
      }).join("") + "</div>";
    } else if (t === "kv") {
      html = '<table class="kv">' + (d.rows || []).slice(0, 8).map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</table>";
    } else if (t === "image") {
      if (!b._cam) {
        b.innerHTML = '<div class="cam"><span class="rec"></span><img alt=""><span class="ts"></span></div>';
        b._cam = true;
      }
      $(".rec", b).textContent = (d.live ? "LIVE · " : "") + (w.title || w.id);
      $(".ts", b).textContent = d.frame ? new Date(d.frame * 1000).toLocaleTimeString([], { hour12: false }) : "";
      if (d.frame && d.frame !== b._frame && !document.body.classList.contains("private")) {
        b._frame = d.frame;
        var img = new Image();
        img.onload = function () { var cur = $("img", b); if (cur) cur.src = img.src; };
        img.src = d.src + "?token=" + encodeURIComponent(TOKEN) + "&f=" + d.frame;
      }
      return finish(el, w);
    } else if (t === "media") {
      el.classList.toggle("media", true); el.classList.toggle("paused", d.status !== "Playing");
      html = '<div class="eq"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="ti">' + esc(d.title) + '</div><div class="ar">' + esc(d.artist || d.player) + '</div><div class="bar"><i style="width:' + (d.len ? (100 * d.pos / d.len).toFixed(1) : 0) + '%"></i></div>';
    } else if (t === "chart") {
      html = '<canvas class="spark" style="height:5rem"></canvas>';
    } else {   // text, typed out when it changes
      var full = String(d.text || "");
      var ty = typed[w.id] || (typed[w.id] = { full: "", shown: 0 });
      if (ty.full !== full) { ty.full = full; ty.shown = 0; }
      if (!b._text) { b.innerHTML = '<div class="text"></div>'; b._text = true; }
      return finish(el, w);
    }
    setHTML(b, html);
    var cv = $("canvas.spark", b);
    if (cv && t === "stat") spark(cv, [{ v: d.history, c: COL.accent }], { n: 90 });
    if (cv && t === "chart") spark(cv, (d.series || []).map(function (s, i) { return { v: s.values || s.v || s, c: [COL.accent, COL.accent2, COL.ok, COL.warn][i % 4] }; }), {});
    return finish(el, w);
  }
  function finish(el, w) {
    el.classList.toggle("warn", w.level === "warn");
    el.classList.toggle("crit", w.level === "crit");
    el.classList.toggle("private", !!w.private);
    setHTML(el.querySelector(".corner"), w.updated && w.type !== "image" ? ago(w.updated) === "now" ? "" : ago(w.updated) : "");
    setHTML(el.querySelector(".err"), w.error ? "⚠ " + esc(w.error) : "");
    return el;
  }
  // typing animation for text panels
  setInterval(function () {
    Object.keys(typed).forEach(function (id) {
      var ty = typed[id], el = panels[id];
      if (!el) return;
      var box = el.querySelector(".text");
      if (!box) return;
      if (ty.shown >= ty.full.length && box._h) return;
      if (ty.shown < ty.full.length) { ty.shown = Math.min(ty.full.length, ty.shown + 3); }
      var html = esc(ty.full.slice(0, ty.shown)) + '<span class="cur"></span>';
      if (box._h !== html) { box.innerHTML = html; box._h = html; }
    });
  }, 40);

  function place(col, list) {
    var want = list.filter(Boolean);
    var cur = Array.prototype.slice.call(col.children);
    var same = cur.length === want.length && cur.every(function (e, i) { return e === want[i]; });
    if (!same) want.forEach(function (e) { col.appendChild(e); });
    cur.forEach(function (e) { if (want.indexOf(e) < 0) col.removeChild(e); });
  }

  // a panel that does not fit in its column is hidden, never cut in half
  function fit(col) {
    var bottom = col.getBoundingClientRect().bottom, hid = false;
    Array.prototype.forEach.call(col.children, function (e) {
      e.style.visibility = "";
      if (hid || e.getBoundingClientRect().bottom > bottom + 1) { e.style.visibility = "hidden"; hid = true; }
    });
  }
  function render() {
    if (!S) return;
    var s = S.sys || {}, h = S.hist || {};
    applyTheme(S.theme);
    var fnt = (S.ui && S.ui.font) || "";
    if (fnt !== document.body._font) { document.body._font = fnt; if (fnt) document.documentElement.style.setProperty("--font", "'" + fnt.replace(/'/g, "") + "', var(--font-base)"); else document.documentElement.style.removeProperty("--font"); }
    document.body.classList.toggle("private", !!S.privacy);
    $("#badge").textContent = "◉ PRIVACY" + (S.screencast ? " · screen shared" : "");
    var left = [], right = [], center = [], ticker = [];
    var ui = S.ui || {};
    if (s.cpu != null && ui.system !== false) left.push(sysPanel(s, h));
    if (s.cpu != null && ui.network !== false) left.push(netPanel(s, h));
    if (S.weather) right.push(weatherPanel(S.weather));
    var ws = (S.widgets || []).slice().sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
    var nl = 2, nr = 1;
    ws.forEach(function (w) {
      if (w.slot === "ticker") { ticker.push(w); return; }
      var slot = w.slot;
      if (!slot || slot === "auto") {
        slot = w.type === "image" || w.type === "status" ? "right" : w.type === "text" ? "center" : nl <= nr ? "left" : "right";
      }
      var el = generic(w);
      if (slot === "left") { left.push(el); nl++; } else if (slot === "center") center.push(el); else { right.push(el); nr++; }
    });
    place($("#left"), left); place($("#right"), right); place($("#center-w"), center);
    fit($("#left")); fit($("#right")); fit($("#center-w"));
    clock();
    document.body.classList.toggle("blink");
    Array.prototype.forEach.call(document.querySelectorAll(".media .eq i"), function (i) { i.style.height = (15 + Math.random() * 85).toFixed(0) + "%"; });
    tickerUpdate(ticker);
    alerts();
    var m = (S.mons || {})[MONKEY] || null;
    Scene.mode(m, S);
  }

  // ------------------------------------------------------------------ clock
  var DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function week(d) { var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); var y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); }
  function clock() {
    var d = window.PulseNow ? window.PulseNow() : new Date(), h = d.getHours(), ui = (S && S.ui) || {};
    if (ui.clock === "12h") h = h % 12 || 12;
    var hm = (h < 10 ? "0" : "") + h + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
    var hme = $("#clock .hm"); if (hme.textContent !== hm) hme.textContent = hm;
    $("#clock .ss").textContent = (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
    $("#clock .secbar i").style.width = (d.getSeconds() / 59 * 100).toFixed(1) + "%";
    setHTML($("#clock .date"), DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() + " · W" + week(d));
    if (S && S.sys) {
      var t = S.theme && S.theme.name ? S.theme.name : "omarchy", e = Scene.ext();
      setHTML($("#clock .who"), esc(S.sys.user || "") + "@" + esc(S.sys.host || "") + " · <b>" + esc(t) + "</b> · " +
        (e && e.uptime ? esc(e.uptime(S.sys.uptime)) : "up " + upt(S.sys.uptime)) +
        (ui.title ? '<span class="title">' + esc(ui.title) + "</span>" : ""));
    }
  }
  setInterval(function () { if (fails) clock(); }, 1000);   // render() ticks the clock while the hub answers

  // ------------------------------------------------------------------ ticker
  function tickerUpdate(ws) {
    var items = [];
    ws.forEach(function (w) {
      var d = w.data || {};
      if (d.items) d.items.forEach(function (it) { items.push({ t: (w.title && w.title !== w.id && w.id !== "ticker" ? w.title + " · " : "") + it.title + (it.text ? " · " + it.text : ""), l: it.level }); });
      else if (d.text) items.push({ t: (w.title || w.id) + " · " + String(d.text).split("\n")[0], l: w.level });
      else if (d.value != null) items.push({ t: (w.title || w.id) + " " + num(d.value) + " " + (d.unit || ""), l: w.level });
    });
    (S.alerts || []).slice(-3).forEach(function (a) { if (Date.now() / 1000 - a.t < 3600) items.push({ t: a.title + " · " + a.text + " · " + ago(a.t), l: a.level }); });
    var w = S.weather;
    if (w && !w.error) items.push({ t: (w.city || "") + " " + Math.round(w.temp) + w.unit + " " + (WX[w.code] || "") + " · sunset " + w.sunset });
    if (S.sys && S.sys.host) items.push({ t: "omarchy pulse · " + (S.widgets || []).length + " live sources" });
    tickItems = items;
  }
  // one headline at a time, every 6 seconds (a scrolling marquee would repaint the screen 60 times a second)
  var tickItems = [], tickIdx = -1;
  setInterval(function () {
    if (!tickItems.length) return;
    var tr = $("#ticker .track");
    tickIdx = (tickIdx + 1) % tickItems.length;
    var it = tickItems[tickIdx];
    tr.innerHTML = '<span class="it ' + (it.l || "") + '">' + esc(it.t) + '</span><span class="count">' + (tickIdx + 1) + "/" + tickItems.length + "</span>";
  }, 6000);

  // ------------------------------------------------------------------ INCOMING
  var incT = null;
  function alerts() {
    var list = S.alerts || [];
    if (seenAlert < 0) { seenAlert = list.length ? list[list.length - 1].seq : 0; return; }   // not the old ones at start
    var fresh = list.filter(function (a) { return a.seq > seenAlert; });
    if (!fresh.length) return;
    var a = fresh[fresh.length - 1];
    seenAlert = a.seq;
    Scene.alert(a.level);
    if (!PRIMARY) return;
    var box = $("#incoming"), e = Scene.ext();
    $(".tag", box).textContent = (e && e.tag) || "▲ INCOMING";
    box.className = a.level;
    box.hidden = false;
    $(".frame", box).style.animation = "none"; void box.offsetWidth; $(".frame", box).style.animation = "";
    decrypt($(".title", box), a.title || "");
    $(".text", box).textContent = S.privacy ? "" : (a.text || "");
    clearTimeout(incT);
    incT = setTimeout(function () { box.hidden = true; }, 7000);
  }
  function decrypt(el, txt) {
    var glyph = "█▓▒░<>/\\|#$%&*+=?01", n = 0;
    var iv = setInterval(function () {
      n += 1;
      var out = "";
      for (var i = 0; i < txt.length; i++) out += i < n / 1.6 || txt[i] === " " ? txt[i] : glyph[Math.random() * glyph.length | 0];
      el.textContent = out;
      if (n / 1.6 >= txt.length) clearInterval(iv);
    }, 28);
  }

  // ------------------------------------------------------------------ the scene
  var Scene = (function () {
    var cv = $("#scene"), g = cv.getContext("2d");
    var W = 0, H = 0, SC = +Q.get("q") || 0.5, last = 0, t0 = performance.now();
    var stars = [], drops = [], spikes = [], far = [], heights = [], rings = [], ridge = [];
    var beatAt = 0, beatEnv = 0, flash = 0, alertEnv = 0, alertCol = null;
    var fps = 30, paused = false, kind = "skyline", wx = "clear", day = 0;
    var cpu = 10, cores = [], ram = 40, net = 0, band = [0, 0], wobj = null, sysobj = {}, stobj = {}, busyNow = false;
    var rnd = function (s) { return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
    // scenes from other files: window.PulseScenes[name] = { resize(api), draw(api), alert(level, col), tag, uptime(s) }
    var X = { g: g, cv: cv, COL: COL, rgba: rgba, mix: mix, rnd: rnd, Q: Q };
    function ext() { return window.PulseScenes && window.PulseScenes[kind]; }
    function api(now) {
      X.W = W; X.H = H; X.now = now; X.t = (now - t0) / 1000; X.cpu = cpu; X.cores = cores; X.ram = ram; X.net = net;
      X.wx = wx; X.day = day; X.weather = wobj; X.sys = sysobj; X.state = stobj; X.busy = busyNow; X.band = band; X.fps = fps; X.paused = paused;
      return X;
    }

    function resize() {
      var r = (Q.get("q") ? (window.devicePixelRatio || 1) : Math.min(1, window.devicePixelRatio || 1)) * SC;
      W = Math.max(320, innerWidth * r | 0); H = Math.max(200, innerHeight * r | 0);
      cv.width = W; cv.height = H;
      var R = rnd(42);
      stars = []; for (var i = 0; i < 130; i++) stars.push([R() * W, R() * H * 0.62, R(), 0.3 + R() * 1.1]);
      far = []; var x = 0; while (x < W) { var bw = W * (0.012 + R() * 0.03); far.push([x, bw, H * (0.03 + R() * 0.12)]); x += bw + W * 0.002; }
      drops = []; for (i = 0; i < 180; i++) drops.push([R() * W, R() * H, 0.6 + R() * 0.8]);
      ridge = []; var a1 = R() * 6, a2r = R() * 6;
      for (i = 0; i <= 64; i++) { var u = i / 64; ridge.push(0.5 + 0.28 * Math.sin(u * 7.1 + a1) + 0.16 * Math.sin(u * 17.3 + a2r) + 0.08 * Math.sin(u * 41 + a1 * 2)); }
      // the free band between the side columns, where the skyline stands
      var l = $("#left").getBoundingClientRect(), rr = $("#right").getBoundingClientRect();
      band = [(l.right + 30) * r, (rr.left - 30) * r];
      if (!(band[1] - band[0] > W * 0.25)) band = [W * 0.08, W * 0.92];
      paintStatic();
      var e = ext(); if (e && e.resize && COL.bg) e.resize(api(performance.now()));
    }
    // what never moves is painted once: sky, floor, the far ridge and the far city
    var bgc = document.createElement("canvas");
    function paintStatic() {
      if (!COL.bg) return;
      bgc.width = W; bgc.height = H;
      var b = bgc.getContext("2d"), hz = H * 0.745, cx = W / 2, bg = COL.bg, a2 = COL.accent2, i;
      var sky = b.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, rgba(mix(bg, [0, 0, 0], 0.35), 1));
      sky.addColorStop(0.7, rgba(mix(bg, a2, 0.10), 1));
      sky.addColorStop(1, rgba(mix(bg, a2, 0.28), 1));
      b.fillStyle = sky; b.fillRect(0, 0, W, hz + 1);
      var fl = b.createLinearGradient(0, hz, 0, H);
      fl.addColorStop(0, rgba(mix(bg, a2, 0.2), 1)); fl.addColorStop(1, rgba(mix(bg, [0, 0, 0], 0.5), 1));
      b.fillStyle = fl; b.fillRect(0, hz, W, H - hz);
      b.beginPath(); b.moveTo(0, hz);
      for (i = 0; i < ridge.length; i++) b.lineTo(i / (ridge.length - 1) * W, hz - H * (0.025 + 0.085 * ridge[i]) * (0.55 + 0.45 * Math.abs(i / (ridge.length - 1) - 0.5) * 2));
      b.lineTo(W, hz); b.closePath();
      b.fillStyle = rgba(mix(bg, a2, 0.13), 1); b.fill();
      b.strokeStyle = rgba(a2, 0.35); b.lineWidth = Math.max(1, H / 900); b.stroke();
      var R = H * 0.15;
      b.fillStyle = rgba(mix(bg, a2, 0.18), 1);
      for (i = 0; i < far.length; i++) { var f = far[i]; if (f[0] + f[1] > cx - R * 1.1 && f[0] < cx + R * 1.1) continue; b.fillRect(f[0], hz - f[2], f[1], f[2]); }
    }
    function reset() { resize(); }

    function beat(now) {
      var bpm = 46 + cpu * 0.95;
      if ((now - beatAt) / 1000 > 60 / bpm) {
        beatAt = now;
        spikes.push({ born: now, col: null, amp: 0.6 + cpu / 140 });
      }
      beatEnv = Math.exp(-(now - beatAt) / 160);
    }
    function gauss(u, s) { return Math.exp(-(u * u) / (2 * s * s)); }
    function ecg(u) {   // one heartbeat, u in "beat widths" from the spike centre
      return -0.12 * gauss(u + 0.075, 0.018) + 1.0 * gauss(u, 0.011) - 0.32 * gauss(u - 0.024, 0.012) + 0.18 * gauss(u - 0.12, 0.035);
    }

    function draw(now) {
      var e = ext(); if (e) { e.draw(api(now)); return; }
      var t = (now - t0) / 1000;
      var hz = H * 0.745, cx = W / 2;
      var bg = COL.bg, ac = COL.accent, a2 = COL.accent2;
      g.drawImage(bgc, 0, 0);
      // stars (fewer when it is cloudy, none by day)
      var starA = day ? 0.15 : wx === "clear" || wx === "part" ? 1 : 0.35;
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i], tw = 0.5 + 0.5 * Math.sin(t * st[3] * 2 + st[2] * 40);
        g.fillStyle = rgba(COL.fg, (0.15 + 0.6 * tw * st[2]) * starA);
        var ss = Math.max(1, H / 1080 * (st[2] > 0.9 ? 2.4 : 1.3));
        g.fillRect(st[0], st[1], ss, ss);
      }
      // aurora = network traffic
      var na = Math.min(1, Math.log10(1 + net) / 7.5);
      g.globalCompositeOperation = "lighter";
      for (var k = 0; k < 2; k++) {
        var col = k ? a2 : ac, base = H * (0.16 + k * 0.09);
        g.beginPath();
        for (var x = 0; x <= W; x += 14) {
          var y = base + Math.sin(x * 0.004 + t * (0.25 + k * 0.1) + k * 2) * H * 0.04 + Math.sin(x * 0.011 - t * 0.4) * H * 0.015;
          if (x) g.lineTo(x, y); else g.moveTo(x, y);
        }
        for (x = W; x >= 0; x -= 14) {
          var y2 = base + H * (0.07 + 0.05 * na) + Math.sin(x * 0.003 + t * 0.2 + k) * H * 0.03;
          g.lineTo(x, y2);
        }
        g.closePath();
        var ag = g.createLinearGradient(0, base - H * 0.05, 0, base + H * 0.14);
        ag.addColorStop(0, rgba(col, 0)); ag.addColorStop(0.45, rgba(col, 0.05 + 0.13 * na)); ag.addColorStop(1, rgba(col, 0));
        g.fillStyle = ag; g.fill();
      }
      g.globalCompositeOperation = "source-over";

      // the core: a wireframe sphere rising on the horizon, beating with the load
      var R = H * (kind === "orbit" ? 0.15 : 0.135) * (1 + 0.035 * beatEnv);
      var cy = kind === "orbit" ? hz - R * 1.02 : hz;
      var glow = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.4);
      glow.addColorStop(0, rgba(alertEnv > 0.05 && alertCol ? alertCol : a2, 0.30 + 0.25 * beatEnv));
      glow.addColorStop(1, rgba(a2, 0));
      g.fillStyle = glow; g.fillRect(cx - R * 2.5, cy - R * 2.5, R * 5, R * 2.5 + (kind === "orbit" ? R * 2.5 : 1));
      g.save();
      g.beginPath(); g.rect(0, 0, W, kind === "orbit" ? H : hz); g.clip();
      var body = g.createLinearGradient(0, cy - R, 0, cy + R);
      body.addColorStop(0, rgba(mix(bg, a2, 0.55), 1)); body.addColorStop(1, rgba(mix(bg, ac, 0.25), 1));
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = body; g.fill();
      g.lineWidth = Math.max(1, H / 700);
      g.strokeStyle = rgba(ac, 0.55);
      for (var la = -3; la <= 3; la++) {   // latitudes
        var yy = cy + (la / 4) * R, rx = Math.sqrt(Math.max(0, R * R - (yy - cy) * (yy - cy)));
        g.beginPath(); g.ellipse(cx, yy, rx, rx * 0.08, 0, 0, Math.PI * 2); g.stroke();
      }
      for (var mer = 0; mer < 6; mer++) {   // turning meridians
        var ph = (mer / 6) * Math.PI + t * (0.12 + cpu / 600);
        var ex = Math.abs(Math.cos(ph)) * R;
        g.beginPath(); g.ellipse(cx, cy, ex, R, 0, 0, Math.PI * 2); g.strokeStyle = rgba(ac, 0.18 + 0.4 * Math.abs(Math.sin(ph))); g.stroke();
      }
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = rgba(ac, 0.9); g.lineWidth = Math.max(1.5, H / 420); g.stroke();
      g.restore();

      if (kind === "orbit") {
        // every core is a moon on its ring
        var n = Math.min(cores.length, 16);
        for (i = 0; i < n; i++) {
          var rr = R * (1.25 + i * 0.09), sp = 0.1 + (cores[i] || 0) / 160;
          rings[i] = (rings[i] || i * 1.7) + sp / Math.max(1, fps);
          g.beginPath(); g.ellipse(cx, cy, rr, rr * 0.28, -0.25, 0, Math.PI * 2); g.strokeStyle = rgba(ac, 0.12 + (cores[i] || 0) / 400); g.lineWidth = Math.max(1, H / 1080); g.stroke();
          var ang = rings[i], px = cx + Math.cos(ang) * rr * Math.cos(-0.25) - Math.sin(ang) * rr * 0.28 * Math.sin(-0.25),
            py = cy + Math.cos(ang) * rr * Math.sin(-0.25) + Math.sin(ang) * rr * 0.28 * Math.cos(-0.25);
          var front = Math.sin(ang) > 0;
          g.fillStyle = rgba((cores[i] || 0) > 85 ? COL.crit : front ? ac : a2, front ? 0.95 : 0.4);
          g.beginPath(); g.arc(px, py, Math.max(1.5, H / 300) * (front ? 1.4 : 0.9), 0, Math.PI * 2); g.fill();
        }
      } else {
        // far city (still), then the skyline: one tower per CPU core, its lit windows follow the RAM
        var nc = Math.min(Math.max(cores.length, 8), 32), side = Math.ceil(nc / 2);
        var inner = R * 1.18, outer = Math.min(cx - band[0], band[1] - cx);
        var slot = Math.max(4, (outer - inner) / side), bw = slot * 0.74;
        for (i = 0; i < nc; i++) {
          var load = cores.length ? cores[i % cores.length] || 0 : cpu;
          heights[i] = (heights[i] == null ? load : heights[i] + (load - heights[i]) * 0.06);
          var hh = H * 0.035 + (heights[i] / 100) * H * 0.2 + ((i * 37) % 11) / 11 * H * 0.03;
          var s2 = i % 2 ? 1 : -1, idx = (i / 2) | 0;
          var bx = s2 > 0 ? cx + inner + idx * slot : cx - inner - idx * slot - bw;
          var tg = g.createLinearGradient(0, hz - hh, 0, hz);
          tg.addColorStop(0, rgba(mix(bg, ac, 0.16), 1)); tg.addColorStop(1, rgba(mix(bg, [0, 0, 0], 0.3), 1));
          g.fillStyle = tg; g.fillRect(bx, hz - hh, bw, hh);
          g.fillStyle = rgba(heights[i] > 90 ? COL.crit : ac, 0.85); g.fillRect(bx, hz - hh, bw, Math.max(1, H / 600));
          // windows
          var cw = Math.max(2, bw / 5), chh = Math.max(2, H / 140), cols = Math.max(1, Math.floor((bw - cw) / (cw * 1.7))), rows = Math.floor((hh - chh * 2) / (chh * 2.2));
          for (var ry = 0; ry < rows; ry++) for (var cxi = 0; cxi < cols; cxi++) {
            var hsh = ((i * 7919 + ry * 104729 + cxi * 1299709) % 1000) / 1000;
            if (hsh < ram / 100 * 0.75) {
              var flick = ((t * 0.07 + hsh * 13) % 1) > 0.985 ? 0.2 : 1;
              g.fillStyle = rgba(hsh < 0.12 ? a2 : hsh < 0.5 ? ac : COL.warn, (0.35 + hsh * 0.5) * flick);
              g.fillRect(bx + cw * 0.7 + cxi * cw * 1.7, hz - hh + chh * 2 + ry * chh * 2.2, cw, chh);
            }
          }
          if (heights[i] > 90 && (t * 2 % 1) < 0.5) { g.fillStyle = rgba(COL.crit, 1); g.fillRect(bx + bw / 2 - 1, hz - hh - H / 90, 2, 2); }
        }
      }

      // floor: the grid runs toward you as fast as the CPU works
      var speed = paused || kind === "calm" ? 0 : 0.08 + cpu / 160;
      var off = (t * speed) % 1;
      g.lineWidth = Math.max(1, H / 1080);
      for (k = 0; k < 18; k++) {
        var p = (k + off) / 18, yh = hz + (H - hz) * Math.pow(p, 2.2);
        g.strokeStyle = rgba(ac, 0.05 + 0.45 * p); g.beginPath(); g.moveTo(0, yh); g.lineTo(W, yh); g.stroke();
      }
      for (k = -24; k <= 24; k++) {
        g.strokeStyle = rgba(ac, 0.18 - Math.abs(k) * 0.005);
        g.beginPath(); g.moveTo(cx + k * W * 0.012, hz); g.lineTo(cx + k * W * 0.11, H); g.stroke();
      }
      // reflection of the core on the floor
      var rf = g.createRadialGradient(cx, hz, 0, cx, hz, R * 1.6);
      rf.addColorStop(0, rgba(a2, 0.22 + 0.2 * beatEnv)); rf.addColorStop(1, rgba(a2, 0));
      g.fillStyle = rf; g.fillRect(cx - R * 1.6, hz, R * 3.2, R * 1.2);

      // the horizon is your pulse: every beat leaves the core and runs to both edges
      var alive = [];
      var path = [];
      for (x = 0; x <= W; x += 3) {
        var dx = Math.abs(x - cx) / W, yv = 0;
        for (var si = 0; si < spikes.length; si++) {
          var sp2 = spikes[si], age = (now - sp2.born) / 1000, d = age * 0.32;
          var fade = Math.max(0, 1 - age / 1.8);
          if (fade <= 0) continue;
          yv += ecg(dx - d) * sp2.amp * fade;
        }
        path.push(hz - 1 - yv * H * 0.06);
      }
      for (i = 0; i < spikes.length; i++) if ((now - spikes[i].born) / 1000 < 1.8) alive.push(spikes[i]);
      spikes = alive;
      var lc = alertEnv > 0.05 && alertCol ? mix(ac, alertCol, Math.min(1, alertEnv * 1.5)) : ac;
      [[7, 0.06], [3.5, 0.16], [1.6, 0.95]].forEach(function (pass) {
        g.beginPath();
        for (var j = 0; j < path.length; j++) { if (j) g.lineTo(j * 3, path[j]); else g.moveTo(0, path[j]); }
        g.lineWidth = pass[0] * H / 1080 * 1.6; g.strokeStyle = rgba(lc, pass[1]); g.stroke();
      });

      // weather from the real sky
      if (wx === "rain" || wx === "storm") {
        g.strokeStyle = rgba(COL.fg, 0.22); g.lineWidth = 1; g.beginPath();
        for (i = 0; i < drops.length; i++) {
          var dr = drops[i]; dr[1] += H * 0.022 * dr[2]; dr[0] -= H * 0.004 * dr[2];
          if (dr[1] > H) { dr[1] = -10; dr[0] = Math.random() * W * 1.1; }
          g.moveTo(dr[0], dr[1]); g.lineTo(dr[0] + H * 0.004, dr[1] - H * 0.018 * dr[2]);
        }
        g.stroke();
      } else if (wx === "snow") {
        g.fillStyle = rgba(COL.fg, 0.6);
        for (i = 0; i < drops.length; i++) {
          var sn = drops[i]; sn[1] += H * 0.0018 * sn[2]; sn[0] += Math.sin(t + i) * 0.3;
          if (sn[1] > H) { sn[1] = -5; sn[0] = Math.random() * W; }
          g.fillRect(sn[0], sn[1], 2, 2);
        }
      } else if (wx === "fog") {
        var fgz = g.createLinearGradient(0, hz - H * 0.15, 0, hz + H * 0.1);
        fgz.addColorStop(0, rgba(COL.fg, 0)); fgz.addColorStop(0.6, rgba(COL.fg, 0.08)); fgz.addColorStop(1, rgba(COL.fg, 0));
        g.fillStyle = fgz; g.fillRect(0, hz - H * 0.15, W, H * 0.25);
      }
      if (wx === "storm" && Math.random() < 0.004) flash = 1;
      if (flash > 0.02) { g.fillStyle = rgba(COL.fg, flash * 0.16); g.fillRect(0, 0, W, H); flash *= 0.8; }
      // an alert: a shockwave from the core
      if (alertEnv > 0.02 && alertCol) {
        var ar = R * (1 + (1 - alertEnv) * 6);
        g.beginPath(); g.ellipse(cx, hz, ar, ar * 0.3, 0, 0, Math.PI * 2); g.strokeStyle = rgba(alertCol, alertEnv * 0.8); g.lineWidth = 2; g.stroke();
        alertEnv *= 0.975;
      }
    }

    // a PC that cannot keep up (no GPU, software rendering) gets fewer frames instead of a busy CPU
    var cap = 60, slow = 0, gap = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (paused && last) return;
      var want = Math.min(fps, cap);
      if (now - last < 1000 / want - 2) return;
      if (last) gap = gap * 0.9 + (now - last) * 0.1;
      last = now;
      beat(now);
      var a = performance.now();
      try { draw(now); } catch (e) { /* never stop the wallpaper for one bad frame */ if (!frame.err) { frame.err = 1; console.error("scene: " + (e && e.stack || e)); document.body.dataset.sceneError = String(e && e.stack || e).slice(0, 300); } }
      var cost = performance.now() - a;
      if ((cost > 22 || gap > 1.7 * 1000 / want) && want > 6) { if (++slow > 60) { cap = Math.max(6, Math.round(want * 0.7)); slow = 0; gap = 0; } }
      else slow = Math.max(0, slow - 1);
    }

    return {
      start: function () { if (!COL.bg) applyTheme(null); resize(); addEventListener("resize", resize); requestAnimationFrame(frame); },
      reset: reset,
      mode: function (m, st) {
        var ui = st.ui || {};
        var was = kind;
        var tn = st.theme && st.theme.name, per = (ui.scenes || {})[tn];   // [pulse] scenes = { starship = "starbase" }
        kind = Q.get("scene") || window.PULSE_SCENE || (per && (per === "skyline" || per === "orbit" || per === "calm" || (window.PulseScenes || {})[per]) ? per : "") || ui.scene || "skyline";
        var sys = st.sys || {};
        sysobj = sys; wobj = st.weather || null; stobj = st;
        document.body.dataset.scene = kind;
        if (kind !== was) resize();
        cpu = sys.cpu || 0; cores = sys.cores || []; ram = sys.ram || 0; net = (sys.rx || 0) + (sys.tx || 0);
        var w = st.weather;
        wx = Q.get("wx") || (w && !w.error ? wxKind(w.code) : "clear"); day = w ? w.day : 0;
        var full = !!(m && m.fullscreen), busy = !!(m && m.windows > 0 && ui.dim_with_windows !== false);
        var bat = sys.bat && sys.bat.status === "Discharging";
        fps = full ? 1 : busy ? 8 : Math.min(+Q.get("fps") || +ui.fps || 20, bat ? 12 : 60);
        if (kind === "calm") fps = Math.min(fps, 10);
        var ef = ext(); if (ef && ef.fps) fps = Math.min(fps, ef.fps);   // a scene may need fewer frames
        paused = full; busyNow = busy || full;
        document.body.classList.toggle("busy", busy);
        document.body.classList.toggle("calm", kind === "calm");
      },
      alert: function (level) {
        alertEnv = 1; alertCol = level === "crit" ? COL.crit : COL.warn; spikes.push({ born: performance.now(), amp: 1.6, col: alertCol });
        var e = ext(); if (e && e.alert) e.alert(level, alertCol);
      },
      ext: ext
    };
  })();

  // ------------------------------------------------------------------ data loop
  var fails = 0;
  function poll() {
    fetch("/api/state?token=" + encodeURIComponent(TOKEN), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      S = j; fails = 0;
      var e = Scene.ext(); if (e && e.prepare) e.prepare(S);   // e.g. preview overrides, so the panels agree with the scene
      try { render(); } catch (e) { console.error(e); }
    }).catch(function () { fails++; }).then(function () { setTimeout(poll, fails ? Math.min(10000, 1000 * fails) : 1000); });
  }
  if (Q.get("only") === "scene") document.body.classList.add("sceneonly");
  if (Q.get("dbg")) document.body.classList.add("dbg-" + Q.get("dbg"));
  applyTheme(null);
  Scene.start();
  clock();
  poll();
})();
