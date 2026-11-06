/* Photo GL: draws the wallpaper photo through a small WebGL shader so parts of it can move like the real thing:
   - billow: the smoke slowly swells and rolls outward from its source (a 3D feel, the photo stays a photo)
   - shimmer: hot air above the flame and along the plume refracts what is behind it
   - flow: bright streaks run down the exhaust column
   - ripples: pressure rings roll out from the engines through the smoke (each one is a "beat")
   - the colour grade of the time of day (one 3x3 matrix, same maths as CSS brightness/saturate/sepia/hue-rotate)
   Rigid parts (rocket, tower) are masked out of billow and ripples. Everything is in image coordinates (0-1),
   so the masks follow the photo whatever the screen size. If WebGL is missing the scene keeps the plain photo.
   window.PhotoGL.create(canvas) -> { setImage(img), draw(params) } or null. MIT, like Pulse. */
(function () {
  "use strict";

  var VS = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";
  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform sampler2D img;",
    "uniform vec2 res;          // canvas pixels",
    "uniform vec4 cover;        // shown image size (xy) and offset (zw), canvas pixels: background-size: cover",
    "uniform float asp;         // image width / height",
    "uniform float time, thr;   // seconds, throttle 0-1",
    "uniform vec3 flame;        // x, y, radius (radius in image heights)",
    "uniform vec3 plume;        // x, top, bottom (0 bottom = none); plumeW: half width in image heights",
    "uniform float plumeW;",
    "uniform vec4 smoke;        // centre x, y, radius x, y (image heights)",
    "uniform float billow;      // billow strength",
    "uniform vec4 keep0, keep1, keep2;   // rigid boxes x0, y0, x1, y1 (image fractions)",
    "uniform vec4 rip[4];       // ripples: radius (image heights), strength",
    "uniform mat3 grade;",
    "uniform float dbg;",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }",
    "vec2 noise2(vec2 p){ return vec2(noise(p), noise(p + vec2(17.3, 9.1))) - 0.5; }",
    "float box(vec2 uv, vec4 b){ vec2 e = vec2(0.012);",
    "  return smoothstep(b.x - e.x, b.x, uv.x) * (1.0 - smoothstep(b.z, b.z + e.x, uv.x)) * smoothstep(b.y - e.y, b.y, uv.y) * (1.0 - smoothstep(b.w, b.w + e.y, uv.y)); }",
    "void main(){",
    "  vec2 fc = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);",
    "  vec2 uv = (fc - cover.zw) / cover.xy;",
    "  vec2 p = vec2(uv.x * asp, uv.y);                       // image heights, square",
    "  vec2 disp = vec2(0.0);",
    "  float keep = 1.0 - clamp(box(uv, keep0) + box(uv, keep1) + box(uv, keep2), 0.0, 1.0);",
    "  // billow: slow swelling and rolling of the smoke, outward from its source",
    "  vec2 sc = vec2(smoke.x * asp, smoke.y), sd = p - sc;",
    "  float se = length(sd / smoke.zw);",
    "  float bm = (1.0 - smoothstep(0.35, 1.0, se)) * keep * step(0.0001, billow);",
    "  if (bm > 0.001) {",
    "    vec2 dir = sd / (length(sd) + 0.02);",
    "    float n = noise(p * 5.0 + vec2(time * 0.07, -time * 0.05)) - 0.5;",
    "    disp += dir * n * 0.012 * billow * bm;",
    "    disp += noise2(p * 11.0 + vec2(time * 0.03, -time * 0.09)) * 0.006 * billow * bm;",
    "    for (int i = 0; i < 4; i++) {   // ripples through the smoke",
    "      if (rip[i].y > 0.001) {",
    "        vec2 rd = p - vec2(flame.x * asp, flame.y);",
    "        float er = length(vec2(rd.x, rd.y * 1.7));",
    "        float k = (er - rip[i].x) / 0.035;",
    "        disp += rd / (length(rd) + 0.01) * exp(-k * k) * sin(k * 2.2) * 0.0045 * rip[i].y * bm;",
    "      }",
    "    }",
    "  }",
    "  // shimmer: hot air over the flame and along the plume",
    "  vec2 fd = p - vec2(flame.x * asp, flame.y);",
    "  float hm = exp(-dot(fd, fd) / (flame.z * flame.z * 2.2));",
    "  float pm = 0.0;",
    "  if (plume.z > plume.y) {",
    "    float px = abs(p.x - plume.x * asp);",
    "    pm = (1.0 - smoothstep(plumeW * 0.6, plumeW * 1.6, px)) * smoothstep(plume.y, plume.y + 0.04, uv.y) * (1.0 - smoothstep(plume.z, plume.z + 0.05, uv.y));",
    "  }",
    "  float sm = max(hm, pm * 0.8);",
    "  if (sm > 0.001) disp += noise2(p * 70.0 + vec2(0.0, time * 2.2)) * (0.0004 + 0.0016 * thr) * sm;",
    "  vec3 c = texture2D(img, clamp(uv + vec2(disp.x / asp, disp.y), 0.0, 1.0)).rgb;",
    "  // flow: streaks running down the exhaust",
    "  if (pm > 0.001) {",
    "    float px2 = (p.x - plume.x * asp) / plumeW;",
    "    float st = noise(vec2(px2 * 6.0, p.y * 18.0 - time * (3.0 + 6.0 * thr)));",
    "    c *= 1.0 + (st - 0.5) * (0.1 + 0.3 * thr) * pm;",
    "  }",
    "  c = grade * c;",
    "  if (dbg > 0.5) c = mix(c, vec3(bm, pm, 1.0 - keep), 0.55);",
    "  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);",
    "}"
  ].join("\n");

  function create(canvas) {
    var gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    if (!gl) return null;
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("photo-gl: " + gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.error("photo-gl: " + gl.getProgramInfoLog(pr)); return null; }
    gl.useProgram(pr);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var al = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ["img", "res", "cover", "asp", "time", "thr", "flame", "plume", "plumeW", "smoke", "billow", "keep0", "keep1", "keep2", "rip", "grade", "dbg"].forEach(function (n) {
      U[n] = gl.getUniformLocation(pr, n);
    });
    var tex = gl.createTexture(), iw = 0, ih = 0;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]].forEach(function (p) {
      gl.texParameteri(gl.TEXTURE_2D, p[0], p[1]);
    });
    gl.uniform1i(U.img, 0);
    var NONE = [-1, -1, -1, -1];

    return {
      setImage: function (im) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
        iw = im.naturalWidth; ih = im.naturalHeight;
      },
      // o: { time, thr, spot (see starbase.js), ripples [[radius, strength]...], grade (9 numbers, column-major), dbg }
      draw: function (o) {
        if (!iw) return;
        var dpr = window.devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        var s = Math.max(w / iw, h / ih), sp = o.spot || {};
        gl.uniform2f(U.res, w, h);
        gl.uniform4f(U.cover, iw * s, ih * s, (w - iw * s) / 2, (h - ih * s) / 2);
        gl.uniform1f(U.asp, iw / ih);
        gl.uniform1f(U.time, o.time); gl.uniform1f(U.thr, o.thr);
        var fl = sp.flame || [-9, -9], pl = sp.plume || [0, 0, 0], sm = sp.smoke || [0, 0, 1, 1], kp = sp.keep || [];
        gl.uniform3f(U.flame, fl[0], fl[1], sp.r || 0.05);
        gl.uniform3f(U.plume, pl[0], pl[1], pl[2]);
        gl.uniform1f(U.plumeW, sp.wide ? 0.12 : 0.016);
        gl.uniform4f(U.smoke, sm[0], sm[1], sm[2], sm[3]);
        gl.uniform1f(U.billow, sp.smoke ? o.billow : 0);
        gl.uniform4fv(U.keep0, kp[0] || NONE); gl.uniform4fv(U.keep1, kp[1] || NONE); gl.uniform4fv(U.keep2, kp[2] || NONE);
        var r = new Float32Array(16);
        (o.ripples || []).slice(0, 4).forEach(function (q, i) { r[i * 4] = q[0]; r[i * 4 + 1] = q[1]; });
        gl.uniform4fv(U.rip, r);
        gl.uniformMatrix3fv(U.grade, false, new Float32Array(o.grade));
        gl.uniform1f(U.dbg, o.dbg ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  }

  window.PhotoGL = { create: create };
})();
