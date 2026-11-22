(function () {
  'use strict';
  var C = JSON.parse(document.getElementById('config').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var inPanel = /[?&]panel=1/.test(location.search);
  if (!inPanel) document.body.classList.add('window');
  var dark = matchMedia('(prefers-color-scheme: dark)');

  // ── state ──
  var L = { tracks: [], playlists: [], settings: { volume: 0.8, shuffle: false, repeat: 'off', eq: { bass: 0, mid: 0, treble: 0 } } };
  var byId = {};
  var S = { tab: 'songs', sort: 'added', q: '', list: null, queue: [], qi: -1, cur: null, playing: false, sleepAt: 0, sleepEnd: false, lastReport: 0, shownAt: Date.now() };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function mmss(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'hum had a problem (' + r.status + ').'); return j; }); }
  function api(what, body) {
    return fetch(C.base + '/api/' + what, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hum': C.secret }, body: JSON.stringify(body || {}) })
      .then(answer, gone);
  }
  // hum's background part stopped (or this page outlived it): say so plainly, and carry on when it's back
  var downT = 0;
  function gone() {
    if (!downT) downT = setInterval(function () {
      fetch(C.base + '/api/library', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hum': C.secret }, body: '{}' }).then(answer).then(function (r) { clearInterval(downT); downT = 0; setLib(r); toast('hum is back.'); }).catch(function () {});
    }, 3000);
    throw new Error(C.mac ? 'hum\'s background part isn\'t running. In Terminal, type: hum on' : 'hum isn\'t running any more. In Terminal, type: hum');
  }
  var toastT = 0;
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 2600); }
  function fail(e) { toast(e.message || 'Something went wrong.'); }
  function setLib(lib) {
    L = lib; byId = {};
    L.tracks.forEach(function (t) { byId[t.id] = t; });
    S.queue = S.queue.filter(function (id) { return byId[id]; });
    if (S.cur && !byId[S.cur.id]) { S.qi = Math.min(S.qi, S.queue.length - 1); }
    render();
  }

  var garden = null; // the dancing flowers (started at the end)

  // ── Bumble ──
  var BEE = ['............', '...ww.ww....', '...wWwWw..a.', '..YYKYYKkka.', '.yYYKYYKkEk.', 'KyYYKYYKkkk.', '..yyKyyKkk..', '....l.l.....', '............'];
  var BEE_UP = ['...w...w....', '..wWw.wWw...', '...ww.ww..a.', '..YYKYYKkka.', '.yYYKYYKkEk.', 'KyYYKYYKkkk.', '..yyKyyKkk..', '....l.l.....', '............'];
  var INK = { Y: '#f5c431', y: '#d99e17', K: '#2b2520', k: '#3d342c', E: '#ffffff', W: '#eef6fc', w: '#a9c7df', a: '#2b2520', l: '#2b2520' };
  var INK_NIGHT = Object.assign({}, INK, { K: '#4a4038', k: '#5c5046', a: '#6e6153', l: '#6e6153' });
  function paintBee(cv, rows) {
    var g = cv.getContext('2d'); g.clearRect(0, 0, 12, 9);
    var ink = dark.matches ? INK_NIGHT : INK;
    rows.forEach(function (row, y) { row.split('').forEach(function (ch, x) { if (ink[ch]) { g.fillStyle = ink[ch]; g.fillRect(x, y, 1, 1); } }); });
  }
  paintBee($('bee'), BEE);
  dark.addEventListener('change', function () { paintBee($('bee'), BEE); });

  // ── the sound: your files through <audio> (with an equalizer), YouTube in its own player ──
  var audio = new Audio();
  audio.preload = 'auto';
  var actx = null, nodes = null, analyser = null, levelBuf = null;
  function wireAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var src = actx.createMediaElementSource(audio);
      var bass = actx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 120;
      var mid = actx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.9;
      var treble = actx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 6000;
      analyser = actx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.55; levelBuf = new Uint8Array(analyser.frequencyBinCount);
      src.connect(bass); bass.connect(mid); mid.connect(treble); treble.connect(analyser); analyser.connect(actx.destination);
      nodes = { bass: bass, mid: mid, treble: treble };
      applyEq();
    } catch (e) { actx = null; }
  }
  function applyEq() { if (!nodes) return; var q = L.settings.eq || {}; nodes.bass.gain.value = q.bass || 0; nodes.mid.gain.value = q.mid || 0; nodes.treble.gain.value = q.treble || 0; }
  // ── the ear: what the music is doing, for the dancing garden ──
  // For your own files hum can hear the music: how loud, the bass, the middle and the treble,
  // and the beat (the bass jumping above what it's been doing). YouTube's player keeps its
  // sound to itself, so for YouTube songs the garden keeps its own easy time.
  var E = { level: 0, bass: 0, mid: 0, high: 0, beat: false, drop: false, bpm: 0, hears: false, playing: false, song: '', last: 0, prev: 0, hist: [], gaps: [], lastDrop: 0 };
  function hit(now) {
    var gap = now - E.last;
    if (E.last && gap > 300 && gap < 1500) {
      E.gaps.push(gap); if (E.gaps.length > 8) E.gaps.shift();
      var g = E.gaps.slice().sort(function (a, b) { return a - b; });
      E.bpm = Math.round(60000 / g[g.length >> 1]);
    }
    E.last = now; E.beat = true;
    var th = $('thumb'); th.style.marginTop = '-2px'; setTimeout(function () { th.style.marginTop = ''; }, 110); // Bumble bobs too
  }
  function ear() {
    var now = performance.now(), id = S.cur ? S.cur.id : '';
    E.beat = false; E.drop = false; E.playing = !!S.playing;
    if (id !== E.song) { E.song = id; E.hist = []; E.gaps = []; E.bpm = 0; }
    E.hears = !!(analyser && S.cur && S.cur.kind === 'file' && !audio.paused);
    if (E.hears) {
      analyser.getByteFrequencyData(levelBuf);
      var bin = actx.sampleRate / analyser.fftSize; // about 45 Hz
      var band = function (lo, hi) { var a = Math.max(1, Math.round(lo / bin)), b = Math.max(a + 1, Math.round(hi / bin)), sum = 0; for (var i = a; i < b; i++) sum += levelBuf[i]; return sum / ((b - a) * 255); };
      E.bass = band(40, 160); E.mid = band(300, 2000); E.high = band(4000, 12000);
      E.level = Math.min(1, E.bass * 0.45 + E.mid * 0.9 + E.high * 0.5);
      var h = E.hist, mean = 0, sd = 0, i;
      for (i = 0; i < h.length; i++) mean += h[i];
      mean /= h.length || 1;
      for (i = 0; i < h.length; i++) sd += (h[i] - mean) * (h[i] - mean);
      sd = Math.sqrt(sd / (h.length || 1));
      if (h.length > 10 && E.bass > E.prev && E.bass > mean + Math.max(0.035, sd * 1.1) && now - E.last > 270) hit(now);
      if (h.length > 30 && E.bass > mean * 1.6 + 0.12 && E.level > 0.45 && now - E.lastDrop > 8000) { E.drop = true; E.lastDrop = now; }
      E.prev = E.bass; h.push(E.bass); if (h.length > 60) h.shift();
    } else {
      E.bass *= 0.9; E.mid *= 0.9; E.high *= 0.9;
      E.level = E.playing ? 0.3 : E.level * 0.9;
      if (E.playing && now - E.last >= 60000 / 92) hit(now);
    }
    return E;
  }

  var yt = null, ytReady = false, ytWant = null, ytTimer = 0;
  function loadYouTube(cb) {
    if (ytReady) return cb();
    ytWant = cb;
    if (window.YT && window.YT.Player) return makeYt();
    window.onYouTubeIframeAPIReady = makeYt;
    var s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = function () { toast('YouTube didn\'t load. Is the internet on?'); };
    document.head.appendChild(s);
  }
  function makeYt() {
    if (yt) return;
    yt = new YT.Player('yt', {
      width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
      events: {
        onReady: function () { ytReady = true; yt.setVolume(Math.round(L.settings.volume * 100)); if (ytWant) { var f = ytWant; ytWant = null; f(); } },
        onStateChange: function (e) {
          if (!S.cur || S.cur.kind !== 'youtube') return;
          if (e.data === 1) {
            S.playing = true;
            if (!S.cur.dur) { var d = yt.getDuration(); if (d > 0) api('dur', { id: S.cur.id, sec: d }); }
            if (S.cur.unnamed) { var v = yt.getVideoData ? yt.getVideoData() : null; if (v && v.title) { var who = S.cur.id; api('yt-name', { id: who, title: v.title, author: v.author }).then(function (x) { if (x.library) { setLib(x.library); if (S.cur && S.cur.id === who) { S.cur = byId[who]; nowCard(); } } }).catch(function () {}); } }
          }
          else if (e.data === 2) S.playing = false;
          else if (e.data === 0) { S.playing = false; ended(); }
          playIcon(); report();
        },
        onError: function () { toast('That video won\'t play outside YouTube. Skipping it.'); setTimeout(next, 1200); },
      },
    });
  }

  function pos() { if (!S.cur) return 0; if (S.cur.kind === 'youtube') return yt && ytReady && yt.getCurrentTime ? yt.getCurrentTime() || 0 : 0; return audio.currentTime || 0; }
  function dur() { if (!S.cur) return 0; if (S.cur.kind === 'youtube') return (yt && ytReady && yt.getDuration ? yt.getDuration() : 0) || S.cur.dur || 0; return isFinite(audio.duration) ? audio.duration : S.cur.dur || 0; }
  function seek(t) { if (!S.cur) return; t = Math.max(0, Math.min(dur() || 0, t)); if (S.cur.kind === 'youtube') { if (ytReady) yt.seekTo(t, true); } else audio.currentTime = t; tick(); }
  function setVol(v) {
    v = Math.max(0, Math.min(1, v));
    L.settings.volume = v; audio.volume = v; if (ytReady) yt.setVolume(Math.round(v * 100));
    $('vol').value = v;
    clearTimeout(setVol.t); setVol.t = setTimeout(function () { api('settings', { volume: v }); }, 400);
  }

  function playTrack(t, { at = 0 } = {}) {
    if (!t) return;
    S.cur = t;
    $('videoBox').hidden = t.kind !== 'youtube';
    fitPanel();
    if (t.kind === 'youtube') {
      audio.pause();
      loadYouTube(function () { yt.loadVideoById({ videoId: t.yt, startSeconds: at }); });
    } else {
      if (ytReady) try { yt.stopVideo(); } catch (e) { /* fine */ }
      if (t.missing) { toast('"' + t.title + '" isn\'t where it was (it was moved or deleted). Skipping it.'); setTimeout(next, 900); return; }
      wireAudio(); if (actx && actx.state === 'suspended') actx.resume();
      audio.src = C.base + '/file/' + t.id;
      audio.volume = L.settings.volume;
      if (at) audio.currentTime = at;
      audio.play().catch(function () { S.playing = false; playIcon(); });
    }
    S.playing = true;
    api('played', { id: t.id }).catch(function () {});
    nowCard(); playIcon(); renderRows(); mediaSession(); report(true);
  }
  function toggle() {
    if (!S.cur) { var first = S.queue[0] || (visible()[0] && visible()[0].id); if (first) { if (!S.queue.length) setQueue(visible().map(function (x) { return x.id; }), 0); else S.qi = 0; playTrack(byId[S.queue[S.qi]]); } return; }
    if (S.cur.kind === 'youtube') { if (!ytReady) return; if (S.playing) yt.pauseVideo(); else yt.playVideo(); S.playing = !S.playing; }
    else { if (audio.paused) { wireAudio(); if (actx && actx.state === 'suspended') actx.resume(); audio.play(); S.playing = true; } else { audio.pause(); S.playing = false; } }
    playIcon(); report(true);
  }
  function pause() { if (S.playing) toggle(); }
  function setQueue(ids, i) { S.queue = ids.slice(); S.qi = i; if (L.settings.shuffle) shuffleRest(); }
  function shuffleRest() {
    var rest = S.queue.slice(S.qi + 1);
    for (var i = rest.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = rest[i]; rest[i] = rest[j]; rest[j] = x; }
    S.queue = S.queue.slice(0, S.qi + 1).concat(rest);
  }
  function next(fromEnd) {
    if (!S.queue.length) return;
    if (S.qi + 1 >= S.queue.length) {
      if (L.settings.repeat === 'all' || !fromEnd) { S.qi = 0; if (L.settings.shuffle) shuffleRest(); }
      else { S.playing = false; playIcon(); report(true); return; }
    } else S.qi++;
    playTrack(byId[S.queue[S.qi]]);
  }
  function prev() {
    if (pos() > 4 || S.qi <= 0) { seek(0); return; }
    S.qi--; playTrack(byId[S.queue[S.qi]]);
  }
  function ended() {
    if (garden) garden.bow(); // the flowers take a bow
    if (S.sleepEnd) { S.sleepEnd = false; S.playing = false; playIcon(); toast('Sleep timer: stopped.'); sleepChip(); return; }
    if (L.settings.repeat === 'one') { seek(0); if (S.cur.kind === 'youtube') yt.playVideo(); else audio.play(); return; }
    next(true);
  }
  audio.addEventListener('ended', ended);
  audio.addEventListener('loadedmetadata', function () { if (S.cur && S.cur.kind === 'file' && isFinite(audio.duration) && Math.abs((S.cur.dur || 0) - audio.duration) > 1) { S.cur.dur = Math.round(audio.duration); api('dur', { id: S.cur.id, sec: audio.duration }); } });
  audio.addEventListener('error', function () { if (S.cur && S.cur.kind === 'file') { toast('This Mac can\'t play "' + S.cur.title + '" (that kind of file isn\'t supported here). Skipping it.'); setTimeout(next, 1200); } });
  audio.addEventListener('pause', function () { if (S.cur && S.cur.kind === 'file') { S.playing = false; playIcon(); } });
  audio.addEventListener('play', function () { if (S.cur && S.cur.kind === 'file') { S.playing = true; playIcon(); } });

  // ── now playing ──
  function art(t) { return t && t.art ? C.base + '/art/' + t.art : t && t.yt ? 'https://i.ytimg.com/vi/' + t.yt + '/mqdefault.jpg' : ''; }
  function nowCard() {
    var t = S.cur;
    $('npTitle').textContent = t ? t.title : 'Nothing playing';
    $('npBy').textContent = t ? [t.artist, t.album].filter(Boolean).join(' · ') || (t.kind === 'youtube' ? 'YouTube' : '') : L.tracks.length ? 'Pick a song below' : 'Add some music to start';
    var a = $('art'), src = art(t);
    a.style.backgroundImage = src ? 'url("' + src + '")' : '';
    a.classList.toggle('none', !src);
    a.innerHTML = src ? '' : '<canvas width="12" height="9"></canvas>';
    if (!src) paintBee(a.querySelector('canvas'), BEE);
    $('likeBtn').setAttribute('aria-pressed', String(!!(t && t.liked)));
    document.title = t ? t.title + ' · hum' : 'hum';
  }
  function playIcon() {
    $('playIcon').innerHTML = S.playing ? '<path d="M6 5h3v10H6zM11 5h3v10h-3z"/>' : '<path d="M7 5l9 5-9 5z"/>';
    $('playBtn').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    if (navigator.mediaSession) navigator.mediaSession.playbackState = S.playing ? 'playing' : 'paused';
  }
  var flap = 0;
  function tick() {
    var p = pos(), d = dur();
    $('tNow').textContent = mmss(p); $('tAll').textContent = mmss(d);
    var f = d ? Math.min(1, p / d) : 0;
    $('fill').style.width = (f * 100) + '%';
    $('thumb').style.left = (f * 100) + '%';
    $('bar').setAttribute('aria-valuenow', String(Math.round(f * 100)));
    flap++;
    paintBee($('thumb'), S.playing && flap % 2 ? BEE_UP : BEE);
    if (S.sleepAt && Date.now() >= S.sleepAt) { S.sleepAt = 0; pause(); toast('Sleep timer: stopped.'); sleepChip(); }
    if (Date.now() - S.lastReport > 4000) report();
  }
  setInterval(tick, 250);
  function barSeek(e) { var r = $('bar').getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur()); }
  $('bar').addEventListener('mousedown', function (e) {
    barSeek(e);
    function mv(ev) { barSeek(ev); }
    function up() { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  $('bar').addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') { e.preventDefault(); seek(pos() - 5); } if (e.key === 'ArrowRight') { e.preventDefault(); seek(pos() + 5); } });
  $('playBtn').onclick = toggle;
  $('nextBtn').onclick = function () { next(false); };
  $('prevBtn').onclick = prev;
  $('vol').oninput = function () { setVol(+this.value); };
  $('likeBtn').onclick = function () { if (S.cur) like(S.cur); };
  $('shufBtn').onclick = function () { L.settings.shuffle = !L.settings.shuffle; if (L.settings.shuffle) shuffleRest(); modeIcons(); api('settings', { shuffle: L.settings.shuffle }); toast(L.settings.shuffle ? 'Shuffle on' : 'Shuffle off'); renderRows(); };
  $('repBtn').onclick = function () { var r = { off: 'all', all: 'one', one: 'off' }[L.settings.repeat] || 'off'; L.settings.repeat = r; modeIcons(); api('settings', { repeat: r }); toast(r === 'off' ? 'Repeat off' : r === 'all' ? 'Repeat all' : 'Repeat this song'); };
  function modeIcons() {
    $('shufBtn').setAttribute('aria-pressed', String(!!L.settings.shuffle));
    $('repBtn').dataset.r = L.settings.repeat; $('repOne').hidden = L.settings.repeat !== 'one';
    $('repBtn').setAttribute('aria-label', 'Repeat: ' + L.settings.repeat);
  }
  function like(t) { api('like', { id: t.id, on: !t.liked }).then(function (r) { var was = t.liked; setLib(r.library); if (!was && garden) garden.heart(); if (S.cur && S.cur.id === t.id) S.cur = byId[t.id] || S.cur; nowCard(); toast(was ? 'Removed from Liked' : 'Added to Liked'); }).catch(fail); }

  function mediaSession() {
    if (!navigator.mediaSession || !S.cur) return;
    try {
      var src = art(S.cur);
      navigator.mediaSession.metadata = new MediaMetadata({ title: S.cur.title, artist: S.cur.artist || '', album: S.cur.album || '', artwork: src ? [{ src: new URL(src, location.href).href, sizes: '512x512' }] : [] });
      navigator.mediaSession.setActionHandler('play', function () { if (!S.playing) toggle(); });
      navigator.mediaSession.setActionHandler('pause', function () { if (S.playing) toggle(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { next(false); });
      navigator.mediaSession.setActionHandler('previoustrack', prev);
    } catch (e) { /* not here */ }
  }
  function report(now) {
    S.lastReport = Date.now();
    api('report', { state: { id: S.cur ? S.cur.id : null, title: S.cur ? S.cur.title : '', artist: S.cur ? S.cur.artist : '', playing: S.playing, pos: Math.round(pos()), dur: Math.round(dur()), queue: S.queue.length - S.qi - 1, shuffle: L.settings.shuffle, repeat: L.settings.repeat, volume: L.settings.volume, queueIds: S.queue, qi: S.qi } }).catch(function () {});
  }

  // ── the lists ──
  function visible() {
    var q = S.q.trim().toLowerCase(), words = q ? q.split(/\s+/) : [];
    var match = function (t) { if (!words.length) return true; var h = (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase(); return words.every(function (w) { return h.indexOf(w) >= 0; }); };
    var list;
    if (S.tab === 'liked') list = L.tracks.filter(function (t) { return t.liked; });
    else if (S.tab === 'list' && S.list) { var p = L.playlists.find(function (x) { return x.id === S.list; }); list = p ? p.tracks.map(function (id) { return byId[id]; }).filter(Boolean) : []; }
    else list = L.tracks.slice();
    list = list.filter(match);
    if (S.tab === 'songs' || S.tab === 'liked') {
      var cmp = { added: function (a, b) { return b.added - a.added; }, title: function (a, b) { return a.title.localeCompare(b.title); }, artist: function (a, b) { return (a.artist || '~').localeCompare(b.artist || '~') || (a.album || '').localeCompare(b.album || '') || (a.track || 0) - (b.track || 0); }, plays: function (a, b) { return (b.plays || 0) - (a.plays || 0) || b.last - a.last; } }[S.sort];
      list.sort(cmp);
    }
    return list;
  }
  function row(t, i, extra) {
    var on = S.cur && S.cur.id === t.id;
    var th = t.art ? '<span class="th" style="background-image:url(&quot;' + esc(C.base + '/art/' + t.art) + '&quot;)"></span>' : t.kind === 'youtube' ? '<span class="th yt" style="background-image:url(&quot;https://i.ytimg.com/vi/' + esc(t.yt) + '/default.jpg&quot;)"></span>' : '<span class="th">♪</span>';
    return '<li class="row' + (on ? ' on' : '') + (t.missing ? ' gone' : '') + '" data-id="' + t.id + '" data-i="' + i + '"' + (extra || '') + '>' + th +
      '<span style="min-width:0"><div class="tt">' + esc(t.title) + '</div><div class="ta">' + esc([t.artist, t.kind === 'youtube' ? 'YouTube' : '', t.missing ? 'file missing' : ''].filter(Boolean).join(' · ') || ' ') + '</div></span>' +
      '<span class="dur">' + (t.dur ? mmss(t.dur) : '') + '</span><button class="dots" data-menu="' + t.id + '" aria-label="More for ' + esc(t.title) + '">⋯</button></li>';
  }
  function emptyLib() {
    return '<li class="empty"><b>Add your music</b>Music files on this Mac (mp3, m4a, wav, flac, aiff), or songs from YouTube, which play in YouTube\'s own player.' +
      '<div class="acts"><button class="btn main" data-do="scan">Find music on this Mac</button><button class="btn" data-do="files">Choose files…</button>' + (C.mac ? '<button class="btn" data-do="folder">Choose a folder…</button>' : '') +
      '<form class="ytrow" data-do="yt" novalidate><input type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste a YouTube link" aria-label="A YouTube link"><button class="btn">Add</button></form>' +
      '<span class="small" style="font-size:12px">Or drop music files anywhere here.</span></div></li>';
  }
  function renderRows() {
    var h = '', head = '';
    if (S.tab === 'queue') {
      var up = S.queue.slice(S.qi + 1).map(function (id) { return byId[id]; }).filter(Boolean);
      head = up.length ? '<b>Up next</b><span>' + plural(up.length, 'song') + (L.settings.shuffle ? ', shuffled' : '') + '</span><span class="sp"></span><button class="link" data-do="clearq">Clear</button>' : '';
      h = up.length ? up.map(function (t, k) { return row(t, S.qi + 1 + k, ' draggable="true"'); }).join('') : '<li class="empty"><b>Nothing up next</b>Play a song from Songs or a playlist, or choose "Play next" on any song.</li>';
    } else if (S.tab === 'lists') {
      head = '<b>Playlists</b><span class="sp"></span><button class="link" data-do="newlist">New playlist</button>';
      h = L.playlists.length ? L.playlists.map(function (p) { return '<li class="pl" data-list="' + p.id + '"><span class="th">♫</span><span style="min-width:0"><div class="tt">' + esc(p.name) + '</div><div class="ta">' + plural(p.tracks.length, 'song') + '</div></span><button class="dots" data-lmenu="' + p.id + '" aria-label="More for ' + esc(p.name) + '">⋯</button></li>'; }).join('')
        : '<li class="empty"><b>No playlists yet</b>Make one here, or choose "Add to a playlist" on any song.<div class="acts"><button class="btn main" data-do="newlist">New playlist</button></div></li>';
    } else {
      var list = visible();
      if (S.tab === 'list') {
        var p = L.playlists.find(function (x) { return x.id === S.list; });
        head = '<button class="link" data-do="backlists">‹</button><b>' + esc(p ? p.name : '') + '</b><span>' + plural(list.length, 'song') + '</span><span class="sp"></span>' + (list.length ? '<button class="link" data-do="playall">Play</button><button class="link" data-do="shuffleall">Shuffle</button>' : '');
        h = list.length ? list.map(function (t, i) { return row(t, i, ' draggable="true"'); }).join('') : '<li class="empty"><b>This playlist is empty</b>On any song, choose ⋯ › Add to a playlist.</li>';
      } else {
        head = (S.tab === 'liked' ? '<b>Liked</b>' : '<b>Songs</b>') + '<span>' + plural(list.length, 'song') + '</span><span class="sp"></span>' + (list.length ? '<button class="link" data-do="shuffleall">Shuffle</button><select id="sortSel" aria-label="Sort"><option value="added">Newest</option><option value="title">Title</option><option value="artist">Artist</option><option value="plays">Most played</option></select>' : '');
        h = list.length ? list.map(row).join('') : S.q ? '<li class="empty"><b>Nothing matches "' + esc(S.q) + '"</b></li>' : S.tab === 'liked' ? '<li class="empty"><b>Nothing liked yet</b>Press ♥ on what\'s playing, or L.</li>' : emptyLib();
      }
    }
    $('listHead').innerHTML = head;
    $('rows').innerHTML = h;
    var ss = $('sortSel'); if (ss) { ss.value = S.sort; ss.onchange = function () { S.sort = this.value; renderRows(); }; }
    Array.prototype.forEach.call($('tabs').children, function (b) { b.setAttribute('aria-selected', String(b.dataset.t === S.tab || (S.tab === 'list' && b.dataset.t === 'lists'))); });
  }
  function render() { modeIcons(); $('vol').value = L.settings.volume; renderRows(); nowCard(); }

  $('tabs').onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; S.tab = b.dataset.t; S.list = null; renderRows(); };
  $('q').addEventListener('input', function () { S.q = this.value; if (S.tab === 'queue' || S.tab === 'lists') S.tab = 'songs'; renderRows(); });
  $('rows').addEventListener('click', function (e) {
    var m = e.target.closest('[data-menu]'); if (m) { e.stopPropagation(); return songMenu(byId[m.dataset.menu], m); }
    var lm = e.target.closest('[data-lmenu]'); if (lm) { e.stopPropagation(); return listMenu(lm.dataset.lmenu, lm); }
    var d = e.target.closest('[data-do]'); if (d && d.tagName !== 'FORM') return act(d.dataset.do);
    var pl = e.target.closest('[data-list]'); if (pl) { S.tab = 'list'; S.list = pl.dataset.list; renderRows(); return; }
    var r = e.target.closest('.row'); if (!r) return;
    var t = byId[r.dataset.id]; if (!t) return;
    if (S.tab === 'queue') { S.qi = +r.dataset.i; playTrack(t); renderRows(); return; }
    var ids = visible().map(function (x) { return x.id; });
    setQueue(ids, ids.indexOf(t.id));
    if (L.settings.shuffle) { S.queue.splice(S.queue.indexOf(t.id), 1); S.queue.splice(S.qi, 0, t.id); }
    playTrack(t);
  });
  $('listHead').addEventListener('click', function (e) { var d = e.target.closest('[data-do]'); if (d) act(d.dataset.do); });
  $('rows').addEventListener('submit', function (e) { e.preventDefault(); var i = e.target.querySelector('input'); addYoutube(i.value); i.value = ''; });
  // drag to reorder: up next, and a playlist
  var dragFrom = -1;
  $('rows').addEventListener('dragstart', function (e) { var r = e.target.closest('.row'); if (!r) return; dragFrom = +r.dataset.i; r.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'hum'); });
  $('rows').addEventListener('dragover', function (e) { var r = e.target.closest('.row'); if (dragFrom < 0 || !r) return; e.preventDefault(); Array.prototype.forEach.call($('rows').children, function (x) { x.classList.toggle('over', x === r); }); });
  $('rows').addEventListener('dragend', function () { dragFrom = -1; Array.prototype.forEach.call($('rows').children, function (x) { x.classList.remove('over', 'drag'); }); });
  $('rows').addEventListener('drop', function (e) {
    var r = e.target.closest('.row'); if (dragFrom < 0 || !r) return;
    e.preventDefault(); e.stopPropagation();
    var to = +r.dataset.i, from = dragFrom; dragFrom = -1;
    if (S.tab === 'queue') { var x = S.queue.splice(from, 1)[0]; S.queue.splice(to > from ? to : to, 0, x); renderRows(); }
    else if (S.tab === 'list') api('pl-move', { id: S.list, from: from, to: to }).then(function (r2) { setLib(r2.library); }).catch(fail);
  });

  function act(what) {
    if (what === 'scan') { toast('Looking in Music, Downloads, Desktop and Documents…'); return api('scan').then(function (r) { setLib(r.library); toast(r.added ? 'Found ' + plural(r.added, 'song') + '.' : 'No new music there. Try Choose files, or drop some here.'); }).catch(fail); }
    if (what === 'files' || what === 'folder') {
      if (!C.mac) return $('files').click();
      toast(what === 'folder' ? 'Pick a folder in the box that opened…' : 'Pick songs in the box that opened (⌘-click for several)…');
      return api('choose', { what: what }).then(function (r) {
        setLib(r.library);
        if (r.cancelled) { toast('Nothing added.'); return; }
        toast(r.added ? 'Added ' + plural(r.added, 'song') + '.' : r.skipped ? 'Those are already here (or aren\'t songs hum can play).' : 'No music files there.');
      }).catch(fail);
    }
    if (what === 'clearq') { S.queue = S.queue.slice(0, S.qi + 1); renderRows(); return; }
    if (what === 'newlist') return askText('A new playlist', 'Name', '', 'Make it').then(function (n) { if (n) return api('pl-new', { name: n }).then(function (r) { setLib(r.library); S.tab = 'list'; S.list = r.playlist; renderRows(); }); }).catch(fail);
    if (what === 'backlists') { S.tab = 'lists'; S.list = null; renderRows(); return; }
    if (what === 'playall' || what === 'shuffleall') {
      var ids = visible().map(function (x) { return x.id; }); if (!ids.length) return;
      var was = L.settings.shuffle;
      if (what === 'shuffleall' && !was) { L.settings.shuffle = true; modeIcons(); api('settings', { shuffle: true }); }
      setQueue(ids, 0);
      if (L.settings.shuffle) { S.qi = -1; shuffleRest(); S.qi = 0; }
      playTrack(byId[S.queue[0]]);
    }
  }

  // ── menus and sheets ──
  function menu(html, near) {
    var m = $('menu');
    m.innerHTML = html; m.hidden = false;
    var r = near.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    m.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
    return m;
  }
  function closeMenu() { $('menu').hidden = true; }
  addEventListener('mousedown', function (e) { if (!$('menu').hidden && !e.target.closest('#menu') && !e.target.closest('[data-menu],[data-lmenu],#addBtn,#moreBtn')) closeMenu(); });
  function songMenu(t, near) {
    if (!t) return;
    var inList = S.tab === 'list';
    var lists = L.playlists.filter(function (p) { return p.id !== S.list; });
    var m = menu('<button data-m="next">Play next</button><button data-m="queue">Add to up next</button><hr>' +
      '<div class="lbl">Add to a playlist</div>' + lists.map(function (p) { return '<button data-m="pl:' + p.id + '">' + esc(p.name) + '</button>'; }).join('') + '<button data-m="newpl">New playlist…</button><hr>' +
      '<button data-m="like">' + (t.liked ? 'Remove from Liked' : 'Like') + '</button><button data-m="edit">Edit the name…</button>' +
      (t.kind === 'youtube' ? '<button data-m="open">Open on YouTube</button>' : '') +
      (inList ? '<button data-m="take" class="danger">Take out of this playlist</button>' : '<button data-m="remove" class="danger">Remove from hum</button>'), near);
    m.onclick = function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      closeMenu();
      var w = b.dataset.m;
      if (w === 'next') { if (S.qi < 0) setQueue([t.id], -1); else S.queue.splice(S.qi + 1, 0, t.id); toast('Plays next'); renderRows(); }
      else if (w === 'queue') { S.queue.push(t.id); toast('Added to up next'); renderRows(); }
      else if (w.indexOf('pl:') === 0) api('pl-add', { id: w.slice(3), ids: [t.id] }).then(function (r) { setLib(r.library); toast(r.added ? 'Added' : 'It\'s already there'); }).catch(fail);
      else if (w === 'newpl') askText('A new playlist', 'Name', '', 'Make it').then(function (n) { if (n) return api('pl-new', { name: n, ids: [t.id] }).then(function (r) { setLib(r.library); toast('Made "' + n + '"'); }); }).catch(fail);
      else if (w === 'like') like(t);
      else if (w === 'edit') editSong(t);
      else if (w === 'open') window.open('https://www.youtube.com/watch?v=' + t.yt, '_blank');
      else if (w === 'take') { var p = L.playlists.find(function (x) { return x.id === S.list; }); api('pl-take', { id: S.list, index: p.tracks.indexOf(t.id) }).then(function (r) { setLib(r.library); }).catch(fail); }
      else if (w === 'remove') sheet({ title: 'Remove "' + t.title + '"?', html: '<p style="margin:0;color:var(--muted)">' + (t.kind === 'file' ? 'It comes out of hum and your playlists. The music file itself stays where it is.' : 'It comes out of hum and your playlists.') + '</p>', actions: [{ label: 'Cancel', value: '' }, { label: 'Remove', value: 'ok', main: true }] }).then(function (r) { if (r.v === 'ok') return api('remove', { ids: [t.id] }).then(function (x) { setLib(x.library); }); }).catch(fail);
    };
  }
  function listMenu(pid, near) {
    var p = L.playlists.find(function (x) { return x.id === pid; }); if (!p) return;
    var m = menu('<button data-m="play">Play</button><button data-m="shuffle">Shuffle</button><hr><button data-m="rename">Rename…</button><button data-m="delete" class="danger">Delete the playlist</button>', near);
    m.onclick = function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      closeMenu();
      var w = b.dataset.m;
      if (w === 'play' || w === 'shuffle') { S.tab = 'list'; S.list = pid; renderRows(); act(w === 'play' ? 'playall' : 'shuffleall'); }
      else if (w === 'rename') askText('Rename the playlist', 'Name', p.name, 'Rename').then(function (n) { if (n) return api('pl-rename', { id: pid, name: n }).then(function (r) { setLib(r.library); }); }).catch(fail);
      else if (w === 'delete') sheet({ title: 'Delete "' + p.name + '"?', html: '<p style="margin:0;color:var(--muted)">Only the playlist goes; the songs stay in hum.</p>', actions: [{ label: 'Cancel', value: '' }, { label: 'Delete', value: 'ok', main: true }] }).then(function (r) { if (r.v === 'ok') return api('pl-delete', { id: pid }).then(function (x) { setLib(x.library); }); }).catch(fail);
    };
  }
  $('addBtn').onclick = function () {
    var m = menu('<button data-a="scan">Find music on this Mac</button><button data-a="files">Choose music files…</button>' + (C.mac ? '<button data-a="folder">Choose a folder of music…</button>' : '') + '<button data-a="yt">Add a YouTube link…</button>', $('addBtn'));
    m.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return; closeMenu();
      if (b.dataset.a === 'yt') askText('A song from YouTube', 'Paste the link (it plays in YouTube\'s own player, here)', '', 'Add').then(function (u) { if (u) addYoutube(u); });
      else act(b.dataset.a);
    };
  };
  $('moreBtn').onclick = function () {
    var m = menu((inPanel ? '<button data-a="window">Open hum in a window</button><button data-a="close">Close the panel</button><hr>' : '') + '<button data-a="eq">Bass, middle and treble…</button><button data-a="sleep">Sleep timer…</button><hr><button data-a="about">About hum</button>', $('moreBtn'));
    m.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return; closeMenu();
      var a = b.dataset.a;
      if (a === 'window') api('window'); else if (a === 'close') hidePanel(); else if (a === 'eq') eqSheet(); else if (a === 'sleep') sleepSheet();
      else sheet({ title: 'hum ' + C.version, html: '<p style="margin:0;color:var(--muted)">Your music in a panel at the side. Bumble the bumblebee hums along. Songs from YouTube play in YouTube\'s own player (hum never downloads them), so the video shows while they play, and they pause when the panel is closed.</p>' });
    };
  };

  function sheet(o) {
    return new Promise(function (resolve) {
      var d = $('sheet');
      $('shTitle').textContent = o.title;
      $('shBody').innerHTML = o.html || '';
      var acts = o.actions || [{ label: 'Done', value: 'ok', main: true }];
      $('shActs').innerHTML = acts.map(function (a, i) { return '<button type="button" class="btn' + (a.main ? ' main' : '') + (a.left ? ' left quiet' : '') + '" data-i="' + i + '">' + esc(a.label) + '</button>'; }).join('');
      var done = false;
      function finish(v) { if (done) return; done = true; var vals = {}; d.querySelectorAll('[data-k]').forEach(function (el) { vals[el.dataset.k] = el.value; }); d.close(); resolve({ v: v, vals: vals }); }
      $('shActs').onclick = function (e) { var b = e.target.closest('[data-i]'); if (b) { var a = acts[+b.dataset.i]; if (a.keep) a.keep(); else finish(a.value); } };
      $('sheetForm').onsubmit = function (e) { e.preventDefault(); var m = acts.find(function (a) { return a.main; }); finish(m ? m.value : ''); };
      d.onclose = function () { finish(''); };
      d.showModal();
      var f = d.querySelector('input[type=text]'); if (f) { f.focus(); f.select(); }
      if (o.onOpen) o.onOpen(d);
    });
  }
  function askText(title, label, value, ok) {
    return sheet({ title: title, html: '<label>' + esc(label) + '<input type="text" data-k="v" value="' + esc(value || '') + '"></label>', actions: [{ label: 'Cancel', value: '' }, { label: ok, value: 'ok', main: true }] })
      .then(function (r) { return r.v === 'ok' ? r.vals.v.trim() : ''; });
  }
  function editSong(t) {
    sheet({ title: 'Edit the name', html: '<label>Song<input type="text" data-k="title" value="' + esc(t.title) + '"></label><label>Artist<input type="text" data-k="artist" value="' + esc(t.artist) + '"></label><label>Album<input type="text" data-k="album" value="' + esc(t.album) + '"></label>', actions: [{ label: 'Cancel', value: '' }, { label: 'Save', value: 'ok', main: true }] })
      .then(function (r) { if (r.v === 'ok') return api('edit', { id: t.id, title: r.vals.title, artist: r.vals.artist, album: r.vals.album }).then(function (x) { setLib(x.library); if (S.cur && S.cur.id === t.id) { S.cur = byId[t.id]; nowCard(); } }); }).catch(fail);
  }
  function eqSheet() {
    var q = L.settings.eq;
    var line = function (k, label) { return '<div class="eq"><span>' + label + '</span><input type="range" min="-12" max="12" step="1" data-eq="' + k + '" value="' + (q[k] || 0) + '"><span data-v="' + k + '">' + (q[k] > 0 ? '+' : '') + (q[k] || 0) + ' dB</span></div>'; };
    sheet({
      title: 'Bass, middle and treble',
      html: line('bass', 'Bass') + line('mid', 'Middle') + line('treble', 'Treble') + '<p style="margin:8px 0 0;color:var(--muted);font-size:12px">For your own music files. YouTube\'s player keeps its sound to itself.</p>',
      actions: [{ label: 'Flat', keep: function () { set({ bass: 0, mid: 0, treble: 0 }); } }, { label: 'More bass', keep: function () { set({ bass: 6, mid: 0, treble: 1 }); } }, { label: 'Clear voices', keep: function () { set({ bass: -2, mid: 4, treble: 2 }); } }, { label: 'Done', value: 'ok', main: true }],
      onOpen: function (d) { d.querySelectorAll('[data-eq]').forEach(function (s) { s.oninput = function () { var o = {}; o[s.dataset.eq] = +s.value; set(o); }; }); },
    });
    function set(o) {
      Object.keys(o).forEach(function (k) { L.settings.eq[k] = o[k]; var s = document.querySelector('[data-eq="' + k + '"]'); if (s) s.value = o[k]; var v = document.querySelector('[data-v="' + k + '"]'); if (v) v.textContent = (o[k] > 0 ? '+' : '') + o[k] + ' dB'; });
      applyEq();
      clearTimeout(set.t); set.t = setTimeout(function () { api('settings', { eq: L.settings.eq }); }, 300);
      $('eqBtn').classList.toggle('on', !!(L.settings.eq.bass || L.settings.eq.mid || L.settings.eq.treble));
    }
  }
  function sleepChip() { $('sleepBtn').classList.toggle('on', !!(S.sleepAt || S.sleepEnd)); $('sleepBtn').textContent = S.sleepAt ? 'Sleep ' + Math.max(1, Math.round((S.sleepAt - Date.now()) / 60000)) + ' min' : S.sleepEnd ? 'Sleep: end of song' : 'Sleep'; }
  function sleepSheet() {
    sheet({
      title: 'Stop playing…',
      html: '<div class="picks">' + [[15, 'In 15 minutes'], [30, 'In 30 minutes'], [45, 'In 45 minutes'], [60, 'In an hour'], ['end', 'At the end of this song']].map(function (x) { return '<button type="button" class="btn quiet" data-sl="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>',
      actions: (S.sleepAt || S.sleepEnd ? [{ label: 'Turn it off', value: 'off', left: true }] : []).concat([{ label: 'Cancel', value: '' }]),
      onOpen: function (d) { d.querySelectorAll('[data-sl]').forEach(function (b) { b.onclick = function () { var v = b.dataset.sl; S.sleepEnd = v === 'end'; S.sleepAt = v === 'end' ? 0 : Date.now() + Number(v) * 60000; sleepChip(); toast(v === 'end' ? 'Stops at the end of this song.' : 'Stops in ' + v + ' minutes.'); d.close(); }; }); },
    }).then(function (r) { if (r.v === 'off') { S.sleepAt = 0; S.sleepEnd = false; sleepChip(); toast('Sleep timer off.'); } });
  }
  $('sleepBtn').onclick = sleepSheet;
  $('eqBtn').onclick = eqSheet;
  setInterval(sleepChip, 30000);

  // ── adding music ──
  function addYoutube(url) {
    if (!url || !url.trim()) return;
    toast('Adding…');
    api('youtube', { url: url.trim() }).then(function (r) {
      setLib(r.library);
      var t = byId[r.track] || {};
      toast(r.already ? 'That one is already here.' : t.unnamed ? 'Added. It gets its name when it plays.' : 'Added "' + t.title + '"');
      if (t.unnamed) nameFromYouTube(t);
    }).catch(fail);
  }
  // when hum's background part couldn't ask YouTube for the name, this page tries (it goes through the Mac's own network settings)
  function nameFromYouTube(t) {
    fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + t.yt))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.title) return api('yt-name', { id: t.id, title: j.title, author: j.author_name }).then(function (x) { if (x.library) setLib(x.library); }); })
      .catch(function () { /* it gets its name when it plays */ });
  }
  function upload(files) {
    files = Array.prototype.filter.call(files, function (f) { return /\.(mp3|m4a|wav|flac|aiff?|ogg|oga|opus|aac)$/i.test(f.name); });
    if (!files.length) { toast('Those aren\'t music files hum can play (mp3, m4a, wav, flac, aiff).'); return; }
    var n = 0;
    toast('Adding ' + plural(files.length, 'song') + '…');
    files.reduce(function (p, f) {
      return p.then(function () {
        if (f.size > 300 * 1024 * 1024) { toast(f.name + ' is too big.'); return; }
        return fetch(C.base + '/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'x-hum': C.secret, 'content-type': 'application/octet-stream' }, body: f })
          .then(answer, gone).then(function (r) { n += r.added; setLib(r.library); });
      });
    }, Promise.resolve()).then(function () { toast(n ? 'Added ' + plural(n, 'song') + '.' : 'Nothing new to add.'); }).catch(fail);
  }
  $('files').onchange = function () { upload(this.files); this.value = ''; };
  var dragDepth = 0;
  addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { dragDepth++; $('drop').hidden = false; } });
  addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) e.preventDefault(); });
  addEventListener('drop', function (e) { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); dragDepth = 0; $('drop').hidden = true; upload(e.dataTransfer.files); });

  // ── keys ──
  document.addEventListener('keydown', function (e) {
    if ($('sheet').open) return;
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
    if (e.key === 'Escape') { if (!$('menu').hidden) closeMenu(); else if (typing) { e.target.blur(); } else if (inPanel) hidePanel(); return; }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey || e.metaKey) next(false); else seek(pos() + 5); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey || e.metaKey) prev(); else seek(pos() - 5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setVol(L.settings.volume + 0.05); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setVol(L.settings.volume - 0.05); }
    else if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'f')) { e.preventDefault(); $('q').focus(); }
    else if (e.key === 'l' || e.key === 'L') { if (S.cur) like(S.cur); }
    else if (e.key === 's' || e.key === 'S') $('shufBtn').click();
    else if (e.key === 'r' || e.key === 'R') $('repBtn').click();
    else if ((e.key === 'm' || e.key === 'M') && inPanel) setMini(!mini);
  });

  // ── small: a little player tucked in the corner, or the full panel ──
  var mini = false, sent = '';
  function setMini(on, quiet) {
    if (!inPanel) return;
    mini = !!on;
    document.documentElement.classList.toggle('mini', mini);
    closeMenu();
    if (garden) garden.redraw();
    fitPanel(true);
    if (!quiet) toast(mini ? 'Small. Press M, or the arrows button, to make it big again.' : 'Full size.');
  }
  // tell the panel how big to be: small fits what's showing, and is taller while a YouTube video plays
  function fitPanel(force) {
    if (!inPanel) return;
    requestAnimationFrame(function () {
      var video = !!(S.cur && S.cur.kind === 'youtube');
      var h = mini ? Math.ceil($('now').getBoundingClientRect().bottom + $('garden').offsetHeight + 8) : 0;
      var key = mini + ':' + video + ':' + h;
      if (key === sent && !force) return;
      sent = key;
      api('size', { mini: mini, video: video, height: h }).catch(function () {});
    });
  }
  $('smallBtn').onclick = function () { setMini(true); };
  $('bigBtn').onclick = function () { setMini(false); };

  // ── the panel, and the command line ──
  function hidePanel() { api('panel', { do: 'hide' }).catch(function () {}); }
  // YouTube's rules: its videos play where you can see them. Closing the panel pauses them (your own files keep playing).
  window.panelHidden = function () { if (S.cur && S.cur.kind === 'youtube' && S.playing) { try { yt.pauseVideo(); } catch (e) { /* fine */ } S.playing = false; playIcon(); report(true); } closeMenu(); };
  window.panelShown = function () { api('library').then(function (r) { setLib(r); }).catch(function () {}); };
  function listen() {
    var es = new EventSource(C.base + '/events?s=' + encodeURIComponent(C.secret));
    es.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.cmd === 'toggle') toggle();
      else if (m.cmd === 'pause') pause();
      else if (m.cmd === 'play') {
        if (m.arg && byId[m.arg]) { var ids = visible().map(function (x) { return x.id; }); if (ids.indexOf(m.arg) < 0) ids = [m.arg]; setQueue(ids, ids.indexOf(m.arg)); playTrack(byId[m.arg]); }
        else if (m.arg && m.arg.ids) { setQueue(m.arg.ids, 0); playTrack(byId[m.arg.ids[0]]); }
        else if (!S.playing) toggle();
      }
      else if (m.cmd === 'next') next(false);
      else if (m.cmd === 'prev') prev();
      else if (m.cmd === 'vol') setVol(L.settings.volume + (Number(m.arg) || 0));
      else if (m.cmd === 'shuffle') $('shufBtn').click();
      else if (m.cmd === 'reload') api('library').then(setLib);
      else if (m.cmd === 'size') setMini(m.arg === 'small', true);
    };
  }

  // ── off we go ──
  api('library').then(function (r) {
    setLib(r);
    if (r.now && r.now.queueIds && r.now.queueIds.length) { S.queue = r.now.queueIds.filter(function (id) { return byId[id]; }); S.qi = Math.min(r.now.qi, S.queue.length - 1); S.cur = byId[S.queue[S.qi]] || null; nowCard(); }
    S.tab = r.tracks.length ? (S.queue.length > S.qi + 1 ? 'queue' : 'songs') : 'songs';
    renderRows();
    if (inPanel) { $('smallBtn').hidden = false; setMini(!!L.settings.mini, true); }
    listen();
  }).catch(fail);
  garden = window.Garden ? window.Garden.start($('garden'), { night: function () { return dark.matches; }, ear: ear, px: function () { return mini ? 2 : 3; } }) : null;
})();
