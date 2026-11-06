/* Engine ring: every CPU core is an engine, drawn crisp in the page under the pad (throttle = CPU, propellant = RAM).
   Shared by the starbase (photo) and launchpad (drawn) scenes. Updates 4 times a second, no CSS transitions
   (a transition repaints at 60 fps whatever the wallpaper's own frame rate). MIT, like Pulse. */
(function () {
  "use strict";
  var hud = null, at = 0;

  // up to 33 engines; with more cores than that, each engine shows the average of its cores
  function engines(cores, cpu) {
    var n = cores.length || 8, E = Math.min(n, 33), out = [], cnt = [];
    for (var e = 0; e < E; e++) { out.push(0); cnt.push(0); }
    for (var i = 0; i < n; i++) { var k = Math.floor(i * E / n); out[k] += cores.length ? cores[i] || 0 : cpu; cnt[k]++; }
    return out.map(function (v, k) { return v / Math.max(1, cnt[k]); });
  }

  // inner, middle and outer rings in about the 3 : 10 : 20 proportion of a 33-engine booster
  function layout(n) {
    var inner = n >= 12 ? 3 : n >= 6 ? 2 : 1, middle = Math.round((n - inner) / 3), outer = n - inner - middle;
    return [[inner, inner === 1 ? 0 : 8.6, 5.2], [middle, 23.5, 5.4], [outer, 39.5, outer > 14 ? 4.9 : 5.3]];
  }

  function build(n) {
    if (!hud) {
      hud = document.getElementById("sb-hud") || document.createElement("div");
      hud.id = "sb-hud";
      hud.innerHTML = '<div class="sb-stat sb-l"><span class="k">throttle</span><span class="v">--</span></div>' +
        '<div class="sb-ring"><svg viewBox="-50 -50 100 100"></svg><span class="cap"></span></div>' +
        '<div class="sb-stat sb-r"><span class="k">propellant</span><span class="v">--</span></div>';
      if (!hud.parentNode) document.body.appendChild(hud);
    }
    var html = '<circle class="rim" r="47.5"/>';
    layout(n).forEach(function (rg, ri) {
      for (var k = 0; k < rg[0]; k++) {
        var a = (k / rg[0]) * Math.PI * 2 - Math.PI / 2 + (ri === 1 ? Math.PI / rg[0] : 0);
        html += '<circle class="e" cx="' + (Math.cos(a) * rg[1]).toFixed(2) + '" cy="' + (Math.sin(a) * rg[1]).toFixed(2) + '" r="' + rg[2] + '"/>';
      }
    });
    hud.querySelector("svg").innerHTML = html;
    hud._n = n;
    hud.querySelector(".cap").textContent = n + " engines";
  }

  // eng: per-engine load 0-100 (smoothed by the scene), T: throttle 0-1, ram: 0-100
  function update(now, eng, T, ram) {
    if (now - at < 250) return;
    at = now;
    if (!hud || hud._n !== eng.length) build(eng.length);
    var es = hud.querySelectorAll("circle.e");
    for (var i = 0; i < es.length; i++) {
      var v = eng[i] || 0, cls = "e" + (v > 90 ? " crit" : v > 60 ? " hot" : v < 4 ? " idle" : "");
      if (es[i].getAttribute("class") !== cls) es[i].setAttribute("class", cls);
      var op = (Math.round((0.1 + 0.9 * Math.pow(v / 100, 0.6)) * 20) / 20).toFixed(2);
      if (es[i]._op !== op) { es[i]._op = op; es[i].style.fillOpacity = op; }
    }
    var l = hud.querySelector(".sb-l .v"), r = hud.querySelector(".sb-r .v");
    var tv = Math.round(T * 100) + "%", rv = Math.round(ram) + "%";
    if (l.textContent !== tv) l.textContent = tv;
    if (r.textContent !== rv) r.textContent = rv;
  }

  window.EngineRing = { engines: engines, update: update };
})();
