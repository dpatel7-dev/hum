/* garden.js: a strip of garden along the bottom of hum, that dances to your music.
 *
 * hum listens to your own music files (YouTube's player keeps its sound to
 * itself, so for YouTube songs the flowers keep their own easy time):
 *   - they rock from side to side on the beat, further when the music is busy
 *   - some bob on every beat, some hop, some open and close their petals;
 *     each new song (and each change of pace) they pick new moves to suit it
 *   - high notes send up little sparkles: pollen by day, glints at night
 *   - a big drop makes them all jump at once and throw their petals
 *   - when the music stops they droop and doze off; when it starts again
 *     they wake up one after another
 *   - at the end of a song they take a bow, and liking a song floats a heart up
 * By day: bright flowers and a butterfly. By night: pale flowers that glow on
 * the beat, a few stars, and a moth.
 *
 *   var g = Garden.start(canvas, { night: () => bool, ear: () => sound, px: () => 3 })
 *   sound: { level, bass, mid, high (0..1), beat, drop (this frame), bpm, hears, playing, song }
 *   g.heart()   g.bow()   g.redraw()
 */
(function (root) {
  'use strict';
  var PS = root.PixelScene;
  var DAY = { grass: ['#7cb86a', '#69a65b', '#8fc77b'], stem: '#4f8a4a', heads: [['#b59cf0', '#8e74d9'], ['#f29bb8', '#d9708f'], ['#ffffff', '#e8e2d2'], ['#f5c431', '#d99e17'], ['#ff9f6b', '#e57a45']], eye: ['#f5c431', '#6b4f2a'], fly: ['#f29b4b', '#2b2520'], spark: '#fff1a0', heart: '#e0607f' };
  var NIGHT = { grass: ['#18331d', '#14291a', '#1d3d22'], stem: '#1f4026', heads: [['#d9d2ff', '#9f93d9'], ['#e9f3ff', '#a9bfd9'], ['#fff4d6', '#d9c79f'], ['#c9f0ff', '#8fbfd9']], eye: ['#fff6b0', '#c9b46a'], star: '#e8edff', moth: ['#cfc6b8', '#8f8678'], spark: '#eaf2ff', heart: '#ff8fab' };
  var BUTTERFLY = [['x.x', '.b.', 'x.x'], ['.x.', '.b.', '.x.']];
  var HEART = ['.r.r.', 'rrrrr', 'rrrrr', '.rrr.', '..r..'];
  // the moves each pace of music brings out
  var MOVES = { slow: ['rock', 'rock', 'rock', 'bob'], mid: ['rock', 'bob', 'petal', 'bob', 'rock'], fast: ['bob', 'hop', 'petal', 'hop', 'rock'] };
  var QUIET = { level: 0, bass: 0, mid: 0, high: 0, beat: false, drop: false, bpm: 0, hears: false, playing: false, song: '' };

  function start(cv, opts) {
    opts = opts || {};
    var ear = opts.ear || function () { return QUIET; };
    var asks = []; // hearts and bows, picked up by the next frame
    var awake = 0; // kept across redraws, so a new size doesn't wake everyone up again

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
        flowers.push({ x: x0, h: Math.max(3, Math.min(h, ground - 4)), head: P.heads[Math.floor(rnd() * P.heads.length)], kind: rnd() < 0.5 ? 'daisy' : 'cup', ph: rnd() * 6,
          base: ground + Math.round(Math.sin(x0 / 9) * 0.8), move: 'rock', pop: 0, react: 0.7 + rnd() * 0.6, order: x0 / W + rnd() * 0.15 });
        x0 += 5 + Math.floor(rnd() * 9);
      }
      var stars = [];
      if (o.night) for (var s = 0; s < W / 14; s++) stars.push({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * Math.max(2, H - 14)), ph: rnd() * 6 });
      var flier = { x: rnd() * W, y: 3, tx: rnd() * W, ty: 3 + rnd() * Math.max(1, H - 10), rest: 0 };
      return { P: P, back: back, flowers: flowers, stars: stars, flier: flier, rnd: rnd, lean: 0, side: 1, kick: 0, bow: 0, song: null, pace: '', bits: [], hearts: [] };
    }

    // a new song, or the music changes pace: everyone picks a move to suit it
    function pickMoves(S, e) {
      var pace = e.bpm >= 124 ? 'fast' : e.bpm && e.bpm < 92 ? 'slow' : 'mid';
      if (S.song === e.song && S.pace === pace) return;
      S.song = e.song; S.pace = pace;
      var list = MOVES[pace];
      S.flowers.forEach(function (f) { f.move = list[Math.floor(S.rnd() * list.length)]; });
    }
    function burst(S) { // the drop: petals everywhere
      for (var i = 0; i < 26; i++) {
        var f = S.flowers[Math.floor(S.rnd() * S.flowers.length)];
        if (!f) return;
        S.bits.push({ x: f.x, y: f.base - f.h - 1, vx: (S.rnd() - 0.5) * 22, vy: -10 - S.rnd() * 12, fall: 26, life: 1 + S.rnd() * 0.6, c: f.head[S.rnd() < 0.5 ? 0 : 1] });
      }
    }
    function heart(S) {
      var f = S.flowers[Math.floor(S.rnd() * S.flowers.length)];
      if (f) S.hearts.push({ x: f.x - 2, y: f.base - f.h - 7, life: 2.4, ph: S.rnd() * 6 });
    }

    function draw(g, S, t, dt) {
      var P = S.P, e = ear() || QUIET;
      pickMoves(S, e);
      // awake while the music plays: wake up quickly, doze off slowly
      awake += ((e.playing ? 1 : 0) - awake) * Math.min(1, dt * (e.playing ? 2.2 : 0.45));
      if (e.beat) {
        S.kick = 1; S.side = -S.side;
        S.flowers.forEach(function (f) { if (f.move === 'hop' || f.move === 'petal') f.pop = 1; });
      }
      if (e.drop) { S.flowers.forEach(function (f) { f.pop = 1.7; }); burst(S); }
      S.kick = Math.max(0, S.kick - dt * 5);
      while (asks.length) { if (asks.shift() === 'bow') S.bow = 1; else heart(S); }
      S.bow = Math.max(0, S.bow - dt * 0.7);
      // rock towards this beat's side, arriving in about a third of a beat; further when the music is busy
      var reach = awake * (0.45 + e.mid * 2.6 + e.level * 0.9);
      S.lean += (S.side * reach - S.lean) * Math.min(1, dt * (e.bpm ? e.bpm / 60 * 3.2 : 3));

      if (S.night) S.stars.forEach(function (s) { g.globalAlpha = 0.35 + 0.5 * Math.max(0, Math.sin(t * 1.3 + s.ph)); g.fillStyle = P.star; g.fillRect(s.x, s.y, 1, 1); });
      g.globalAlpha = 1;
      g.drawImage(S.back, 0, 0);

      var bow = Math.sin(S.bow * Math.PI);
      S.flowers.forEach(function (f) {
        f.pop = Math.max(0, f.pop - dt * 3.5);
        var up = Math.max(0, Math.min(1, awake * 1.6 - f.order * 0.6)); // they wake one after another, left to right
        var doze = 1 - up;
        var idle = Math.sin(t * 1.2 + f.ph) * (0.35 + 0.25 * doze);
        var lean = S.lean * f.react * (f.move === 'hop' ? 0.5 : 1) + idle + doze * 1.8 + bow * 2.4;
        var lift = 0;
        if (f.move === 'bob') lift = Math.round(S.kick * 2 * f.react * up);
        else if (f.move === 'hop') lift = Math.round(Math.sin(Math.min(1, f.pop) * Math.PI) * 3 * up);
        if (f.pop > 1) lift = Math.max(lift, Math.round((f.pop - 1) * 6));
        var top = Math.max(2, Math.round(f.h * (1 - doze * 0.35 - bow * 0.3)) + lift);
        g.fillStyle = P.stem;
        for (var k = 0; k < top; k++) { var q = k / top; g.fillRect(Math.round(f.x + lean * q * q), f.base - k, 1, 1); }
        var hx = Math.round(f.x + lean), hy = f.base - top;
        if (S.night) { // a round glow, brighter on the beat
          g.globalAlpha = 0.12 + e.level * 0.2 + S.kick * 0.28 * up; g.fillStyle = f.head[0];
          g.fillRect(hx - 1, hy - 2, 3, 5); g.fillRect(hx - 2, hy - 1, 5, 3);
          g.globalAlpha = 1;
        }
        if (doze > 0.7) { g.fillStyle = f.head[1]; g.fillRect(hx, hy, 1, 2); return; } // asleep: a closed bud
        var open = f.move === 'petal' && f.pop > 0.25;
        if (f.kind === 'daisy') {
          g.fillStyle = f.head[1];
          if (open) { g.fillRect(hx - 2, hy, 5, 1); g.fillRect(hx, hy - 2, 1, 5); g.fillRect(hx - 1, hy - 1, 3, 3); }
          else { g.fillRect(hx - 1, hy, 3, 1); g.fillRect(hx, hy - 1, 1, 3); }
          g.fillStyle = P.eye[0]; g.fillRect(hx, hy, 1, 1);
        } else {
          g.fillStyle = f.head[0]; g.fillRect(hx - 1 - (open ? 1 : 0), hy - 1, 3 + (open ? 2 : 0), 2);
          g.fillStyle = f.head[1]; g.fillRect(hx - 1, hy + 1, 3, 1);
        }
        // high notes: a sparkle now and then
        if (e.hears && up > 0.5 && S.rnd() < e.high * dt * 7) S.bits.push({ x: hx, y: hy - 2, vx: (S.rnd() - 0.5) * 3, vy: -3 - S.rnd() * 4, fall: 0, life: 0.7, c: P.spark });
      });

      // sparkles and petals
      S.bits = S.bits.filter(function (b) { b.life -= dt; return b.life > 0 && b.y < S.H; });
      S.bits.forEach(function (b) {
        b.vy += b.fall * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        g.globalAlpha = Math.min(1, b.life * 1.6); g.fillStyle = b.c; g.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
      });
      g.globalAlpha = 1;
      // hearts, when you like a song
      S.hearts = S.hearts.filter(function (h) { h.life -= dt; return h.life > 0; });
      S.hearts.forEach(function (h) {
        h.y -= dt * 5;
        g.globalAlpha = Math.min(1, h.life);
        PS.sprite(g, HEART, h.x + Math.sin(t * 3 + h.ph) * 1.2, h.y, { r: P.heart }, false);
      });
      g.globalAlpha = 1;

      // a butterfly by day, a moth by night: flaps faster when the music's loud
      var b = S.flier;
      if (b.rest > 0) b.rest -= dt;
      else {
        var dx = b.tx - b.x, dy = b.ty - b.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1.5) { b.rest = S.rnd() * 2.5 * (1 - e.level); b.tx = S.rnd() * S.W; b.ty = 2 + S.rnd() * Math.max(1, S.H - 10); }
        else { var sp = (9 + e.level * 10) * dt; b.x += dx / d * Math.min(sp, d); b.y += dy / d * Math.min(sp, d) + Math.sin(t * 8) * 0.15; }
      }
      var wing = S.night ? P.moth : P.fly;
      PS.sprite(g, BUTTERFLY[b.rest > 0 ? 1 : Math.abs(Math.floor(t * (8 + e.level * 10))) % 2], b.x, b.y, { x: wing[0], b: wing[1] }, false);
    }

    var scene = PS.start(cv, { night: opts.night, build: build, draw: draw, fps: 30, px: opts.px || function () { return 3; } });
    scene.heart = function () { asks.push('heart'); };
    scene.bow = function () { asks.push('bow'); };
    return scene;
  }

  root.Garden = { start: start };
})(window);
