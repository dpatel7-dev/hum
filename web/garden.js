/* garden.js: a strip of garden along the bottom of hum's panel.
 *
 * Flowers on a bank of grass that sway, and sway more when the music is loud
 * (for your own music files hum can hear the music; YouTube's player keeps
 * its sound to itself, so then they just sway gently). By day: bright
 * flowers and a butterfly. By night: pale flowers that glow a little, a few
 * stars, and moths.
 *
 *   Garden.start(canvas, { night: () => bool, level: () => 0..1 })
 */
(function (root) {
  'use strict';
  var PS = root.PixelScene;
  var DAY = { grass: ['#7cb86a', '#69a65b', '#8fc77b'], stem: '#4f8a4a', heads: [['#b59cf0', '#8e74d9'], ['#f29bb8', '#d9708f'], ['#ffffff', '#e8e2d2'], ['#f5c431', '#d99e17'], ['#ff9f6b', '#e57a45']], eye: ['#f5c431', '#6b4f2a'], fly: ['#f29b4b', '#2b2520'] };
  var NIGHT = { grass: ['#18331d', '#14291a', '#1d3d22'], stem: '#1f4026', heads: [['#d9d2ff', '#9f93d9'], ['#e9f3ff', '#a9bfd9'], ['#fff4d6', '#d9c79f'], ['#c9f0ff', '#8fbfd9']], eye: ['#fff6b0', '#c9b46a'], star: '#e8edff', moth: ['#cfc6b8', '#8f8678'] };
  var BUTTERFLY = [['x.x', '.b.', 'x.x'], ['.x.', '.b.', '.x.']];

  function start(cv, opts) {
    opts = opts || {};
    var level = opts.level || function () { return 0; };
    function build(o) {
      var W = o.W, H = o.H, rnd = o.rnd, P = o.night ? NIGHT : DAY;
      var ground = H - 4;
      var back = PS.canvas(W, H), g = back.getContext('2d');
      for (var x = 0; x < W; x++) {
        var top = ground + Math.round(Math.sin(x / 9) * 0.8);
        for (var y = top; y < H; y++) { g.fillStyle = P.grass[(x * 5 + y * 3) % 7 === 0 ? 1 : (x + y) % 11 === 0 ? 2 : 0]; g.fillRect(x, y, 1, 1); }
        if (rnd() < 0.45) { g.fillStyle = P.grass[2]; g.fillRect(x, top - 1 - Math.floor(rnd() * 2), 1, 1 + Math.floor(rnd() * 2)); }
      }
      var flowers = [];
      var x0 = 3;
      while (x0 < W - 3) {
        var h = 5 + Math.floor(rnd() * Math.max(3, H - 10));
        flowers.push({ x: x0, h: Math.min(h, ground - 3), head: P.heads[Math.floor(rnd() * P.heads.length)], kind: rnd() < 0.5 ? 'daisy' : 'cup', ph: rnd() * 6, base: ground + Math.round(Math.sin(x0 / 9) * 0.8) });
        x0 += 5 + Math.floor(rnd() * 9);
      }
      var stars = [];
      if (o.night) for (var s = 0; s < W / 14; s++) stars.push({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * Math.max(2, H - 14)), ph: rnd() * 6 });
      var flier = { x: rnd() * W, y: 3, tx: rnd() * W, ty: 3 + rnd() * (H - 10), rest: 0 };
      return { P: P, back: back, flowers: flowers, stars: stars, flier: flier, rnd: rnd, smooth: 0 };
    }
    function draw(g, S, t, dt) {
      var P = S.P;
      S.smooth += ((level() || 0) - S.smooth) * Math.min(1, dt * 6);
      var loud = S.smooth;
      if (S.night) S.stars.forEach(function (s) { g.globalAlpha = 0.35 + 0.5 * Math.max(0, Math.sin(t * 1.3 + s.ph)); g.fillStyle = P.star; g.fillRect(s.x, s.y, 1, 1); });
      g.globalAlpha = 1;
      g.drawImage(S.back, 0, 0);
      S.flowers.forEach(function (f, i) {
        var sway = Math.sin(t * (1.1 + loud * 2.5) + f.ph) * (0.6 + loud * 2.4);
        var bob = loud > 0.15 ? Math.round(Math.abs(Math.sin(t * 6 + i)) * loud * 1.5) : 0;
        for (var k = 0; k < f.h; k++) { g.fillStyle = P.stem; g.fillRect(Math.round(f.x + sway * (k / f.h) * (k / f.h)), f.base - k, 1, 1); }
        var hx = Math.round(f.x + sway), hy = f.base - f.h - bob;
        if (S.night) { g.globalAlpha = 0.18 + loud * 0.25; g.fillStyle = f.head[0]; g.fillRect(hx - 2, hy - 2, 5, 5); g.globalAlpha = 1; }
        g.fillStyle = f.head[1];
        if (f.kind === 'daisy') { g.fillRect(hx - 1, hy, 3, 1); g.fillRect(hx, hy - 1, 1, 3); g.fillStyle = P.eye[0]; g.fillRect(hx, hy, 1, 1); }
        else { g.fillStyle = f.head[0]; g.fillRect(hx - 1, hy - 1, 3, 2); g.fillStyle = f.head[1]; g.fillRect(hx - 1, hy + 1, 3, 1); }
      });
      // a butterfly by day, a moth by night
      var b = S.flier;
      if (b.rest > 0) b.rest -= dt;
      else {
        var dx = b.tx - b.x, dy = b.ty - b.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1.5) { b.rest = S.rnd() * 2.5; b.tx = S.rnd() * S.W; b.ty = 2 + S.rnd() * (S.H - 10); }
        else { var sp = 9 * dt; b.x += dx / d * Math.min(sp, d); b.y += dy / d * Math.min(sp, d) + Math.sin(t * 8) * 0.15; }
      }
      var wing = S.night ? P.moth : P.fly;
      PS.sprite(g, BUTTERFLY[b.rest > 0 ? 1 : Math.abs(Math.floor(t * 8)) % 2], b.x, b.y, { x: wing[0], b: wing[1] }, false);
    }
    return PS.start(cv, { night: opts.night, build: build, draw: draw, fps: 20, px: function () { return 3; } });
  }

  root.Garden = { start: start };
})(window);
