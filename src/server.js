'use strict';
// hum's background part (`hum serve`, started at login): it serves the player
// (the side panel and the window), your music files and cover pictures, on
// this computer only (127.0.0.1, behind a secret address). The music itself
// plays in the player page; the command line talks to it through here.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Lib = require('./library');
const Local = require('./local');
const pkg = require('../package.json');

const WEB = path.join(__dirname, '..', 'web');
const secret = () => Local.secretIn(path.join(Lib.home(), 'secret'));
const portFile = () => path.join(Lib.home(), 'port');
const runningPort = () => { try { return Number(fs.readFileSync(portFile(), 'utf8')) || 0; } catch { return 0; } };
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.alac': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff', '.aif': 'audio/aiff' };

/** Send part of a file (players ask for pieces, to start quickly and to jump around). */
function sendFile(req, res, file, type) {
  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end(); }
  const size = st.size;
  const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'content-length': size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const MAX_UPLOAD = 600 * 1024 * 1024;
/** Save a dropped music file into hum's music folder. Resolves where it went. */
function saveUpload(req, name) {
  return new Promise((resolve, reject) => {
    name = path.basename(String(name || 'song.mp3')).replace(/[/\\:\0]/g, '_').slice(0, 200);
    if (!require('./tags').isAudio(name)) { req.resume(); return reject(new Error(`hum plays music files (mp3, m4a, wav, flac, aiff). "${name}" isn't one.`)); }
    fs.mkdirSync(Lib.musicDir(), { recursive: true });
    let f = path.join(Lib.musicDir(), name);
    for (let k = 2; fs.existsSync(f); k++) f = path.join(Lib.musicDir(), name.replace(/(\.[^.]+)$/, ` ${k}$1`));
    const tmp = f + '.part';
    const out = fs.createWriteStream(tmp);
    let size = 0, failed = false;
    const bail = (e) => { if (failed) return; failed = true; out.destroy(); fs.rmSync(tmp, { force: true }); reject(e); };
    req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { bail(Object.assign(new Error(`${name} is too big.`), { status: 413 })); req.destroy(); } });
    req.on('error', bail);
    out.on('error', bail);
    out.on('finish', () => { if (failed) return; if (!size) { fs.rmSync(tmp, { force: true }); return reject(new Error(`${name} came through empty.`)); } fs.renameSync(tmp, f); resolve(f); });
    req.pipe(out);
  });
}

async function start({ port, log = (s) => process.stdout.write(`${new Date().toLocaleTimeString()}  ${s}\n`) } = {}) {
  let lib = Lib.load();
  const sec = secret();
  let now = null; // what the player says it's playing
  const listeners = new Set(); // players waiting for commands (from the command line)
  const push = (o) => { for (const res of listeners) { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch { /* gone */ } } return listeners.size; };
  let server;
  const tries = port != null ? [port] : [lib.settings.port, lib.settings.port + 10, lib.settings.port + 20, 0];
  for (const p of tries) {
    try {
      server = await Local.serve({
        port: p, secret: sec, web: WEB, header: 'x-hum', referrer: 'strict-origin-when-cross-origin',
        config: (req, url) => ({ version: pkg.version, mac: process.platform === 'darwin', panel: url.searchParams.get('panel') === '1' }),
        api: (what, body) => api(what, body || {}),
        raw: (req, res, rest, url, send) => {
          let m = /^\/file\/([a-f0-9]{12})$/.exec(rest);
          if (m) {
            const t = Lib.track(lib, m[1]);
            if (!t || t.kind !== 'file') { send(404, { error: 'gone' }); return true; }
            sendFile(req, res, t.path, AUDIO_TYPES[path.extname(t.path).toLowerCase()] || 'application/octet-stream');
            return true;
          }
          m = /^\/art\/([a-f0-9]{16}\.(?:png|jpg))$/.exec(rest);
          if (m) { sendFile(req, res, path.join(Lib.artDir(), m[1]), m[1].endsWith('.png') ? 'image/png' : 'image/jpeg'); return true; }
          if (rest === '/upload' && req.method === 'POST') {
            // a dropped music file, sent as it is (not squeezed into JSON)
            if (req.headers['x-hum'] !== sec) { send(403, { error: 'not allowed' }); return true; }
            saveUpload(req, url.searchParams.get('name')).then((f) => {
              lib = Lib.load();
              const r = Lib.addPaths(lib, [f]);
              Lib.save(lib);
              send(200, { added: r.added.length, library: Lib.view(lib) });
            }, (e) => send(e.status || 400, { error: e.message }));
            return true;
          }
          if (rest === '/events') {
            // commands from the command line arrive here (the player listens)
            if (url.searchParams.get('s') !== sec) { send(403, { error: 'not allowed' }); return true; }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
            res.write(': hello\n\n');
            listeners.add(res);
            const ping = setInterval(() => { try { res.write(': still here\n\n'); } catch { /* gone */ } }, 20000);
            req.on('close', () => { clearInterval(ping); listeners.delete(res); });
            return true;
          }
          return false;
        },
      });
      break;
    } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  if (!server) throw new Error("hum couldn't find a free port.");
  fs.writeFileSync(portFile(), String(server.port));
  try {
    const P = require('./mac').panel;
    P.setUrl(`${server.url}?panel=1`);
    if (P.upgrade()) log('side panel: swapped in the newer panel program'); // after an update
    else if (P.status().running) P.reload();
  } catch (e) { log(`side panel: ${e.message}`); }

  const saved = () => { Lib.save(lib); return Lib.view(lib); };
  const need = (tid) => { const t = Lib.track(lib, tid); if (!t) throw Object.assign(new Error("That song isn't in hum any more."), { status: 404 }); return t; };
  const needList = (pid) => { const p = Lib.playlist(lib, pid); if (!p) throw Object.assign(new Error("That playlist isn't there any more."), { status: 404 }); return p; };

  async function api(what, b) {
    lib = Lib.load();
    switch (what) {
      case 'library': return { ...Lib.view(lib), now, version: pkg.version };
      case 'add': {
        const r = Lib.addPaths(lib, (b.paths || []).map(String));
        return { added: r.added.length, skipped: r.skipped, library: saved() };
      }
      case 'scan': {
        const r = Lib.addPaths(lib, Lib.usualPlaces());
        return { added: r.added.length, skipped: r.skipped, where: Lib.usualPlaces().map((p) => p.replace(os.homedir(), '~')), library: saved() };
      }
      case 'choose': {
        // the Mac's own file box (the side panel can't open one itself)
        if (process.platform !== 'darwin') throw new Error('Drop music files here instead.');
        const paths = await require('./mac').chooseMusic(b.what === 'folder' ? 'folder' : 'files');
        if (!paths.length) return { added: 0, skipped: 0, cancelled: true, library: Lib.view(lib) };
        lib = Lib.load();
        const r = Lib.addPaths(lib, paths);
        return { added: r.added.length, skipped: r.skipped, library: saved() };
      }
      case 'yt-name': { const changed = Lib.nameYoutube(lib, b.id, b.title, b.author); return changed ? { library: saved() } : { ok: true }; }
      case 'youtube': {
        const r = await Lib.addYoutube(lib, b.url);
        return { track: r.track.id, already: r.already, library: saved() };
      }
      case 'played': Lib.played(lib, b.id); saved(); return { ok: true };
      case 'dur': { const t = Lib.track(lib, b.id); if (t && b.sec > 0 && Math.abs((t.dur || 0) - b.sec) > 1) { t.dur = Math.round(b.sec); Lib.save(lib); } return { ok: true }; }
      case 'like': need(b.id).liked = b.on !== false; return { library: saved() };
      case 'edit': {
        const t = need(b.id);
        for (const k of ['title', 'artist', 'album']) if (typeof b[k] === 'string') t[k] = b[k].trim().slice(0, 300) || (k === 'title' ? t.title : '');
        return { library: saved() };
      }
      case 'remove': Lib.remove(lib, b.ids || [b.id]); return { library: saved() };
      case 'pl-new': { const p = Lib.newPlaylist(lib, b.name, b.ids || []); return { playlist: p.id, library: saved() }; }
      case 'pl-add': { const p = needList(b.id); const ids = (b.ids || []).filter((x) => Lib.track(lib, x) && !p.tracks.includes(x)); p.tracks.push(...ids); return { added: ids.length, library: saved() }; }
      case 'pl-take': { const p = needList(b.id); p.tracks.splice(Number(b.index), 1); return { library: saved() }; }
      case 'pl-move': { const p = needList(b.id); const [x] = p.tracks.splice(Number(b.from), 1); if (x) p.tracks.splice(Math.max(0, Math.min(p.tracks.length, Number(b.to))), 0, x); return { library: saved() }; }
      case 'pl-rename': { const p = needList(b.id); p.name = String(b.name || '').trim().slice(0, 60) || p.name; return { library: saved() }; }
      case 'pl-delete': lib.playlists = lib.playlists.filter((p) => p.id !== b.id); return { library: saved() };
      case 'settings': {
        const s = lib.settings;
        if (Number.isFinite(b.volume)) s.volume = Math.max(0, Math.min(1, b.volume));
        if (typeof b.shuffle === 'boolean') s.shuffle = b.shuffle;
        if (['off', 'all', 'one'].includes(b.repeat)) s.repeat = b.repeat;
        if (b.eq && typeof b.eq === 'object') for (const k of ['bass', 'mid', 'treble']) if (Number.isFinite(b.eq[k])) s.eq[k] = Math.max(-12, Math.min(12, b.eq[k]));
        Lib.save(lib);
        return { settings: s };
      }
      case 'size': {
        // small or full, from the panel itself; small fits what's showing (taller while a YouTube video plays)
        if (lib.settings.mini !== !!b.mini) { lib.settings.mini = !!b.mini; Lib.save(lib); }
        const M = require('./mac');
        const size = M.sizeFor({ mini: !!b.mini, video: !!b.video, height: b.height });
        M.panel.resize(size);
        return { size };
      }
      case 'report': now = { ...(b.state || {}), at: Date.now() }; return { ok: true };
      case 'now': return { now: now && Date.now() - now.at < 15000 ? now : null, track: now && now.id ? Lib.view(lib).tracks.find((t) => t.id === now.id) || null : null, players: listeners.size };
      case 'remote': {
        const n = push({ cmd: String(b.cmd || ''), arg: b.arg == null ? null : b.arg });
        return { players: n };
      }
      case 'panel': {
        const P = require('./mac').panel;
        if (b.do === 'hide') P.hide(); else if (b.do === 'show') await P.show(); else P.toggle();
        return { ok: true };
      }
      case 'window': require('./open').openWindow(server.url, { width: 460, height: 800 }); return { ok: true };
      default: throw Object.assign(new Error(`hum doesn't know "${what}".`), { status: 404 });
    }
  }

  log(`hum ${pkg.version} is ready: ${server.url}`);
  return {
    url: server.url, port: server.port, secret: sec, api,
    close: async () => { for (const r of listeners) try { r.end(); } catch { /* fine */ } await server.close(); try { fs.rmSync(portFile()); } catch { /* fine */ } },
  };
}

module.exports = { start, runningPort, secret, sendFile };
