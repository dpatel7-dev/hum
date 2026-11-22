'use strict';
// Your music: the songs hum knows about (files on this computer, and YouTube
// links that play in YouTube's own player), your playlists, and what you've
// played. Kept in ~/.hum/library.json. Music files stay where they are; hum
// only remembers where. Files dropped into the window are copied to
// ~/.hum/music.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Tags = require('./tags');

const home = () => process.env.HUM_HOME || path.join(os.homedir(), '.hum');
const file = () => path.join(home(), 'library.json');
const artDir = () => path.join(home(), 'art');
const musicDir = () => path.join(home(), 'music');
const id = () => crypto.randomBytes(6).toString('hex');
const DEFAULTS = { volume: 0.8, shuffle: false, repeat: 'off', eq: { bass: 0, mid: 0, treble: 0 }, port: 8721, key: '^~m' };

function load() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* new */ }
  return { tracks: Array.isArray(d.tracks) ? d.tracks : [], playlists: Array.isArray(d.playlists) ? d.playlists : [], settings: { ...DEFAULTS, ...(d.settings || {}), eq: { ...DEFAULTS.eq, ...((d.settings || {}).eq || {}) } } };
}
function save(lib) {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lib, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file());
  return lib;
}

/** Keep a song's cover picture (once per picture: the same album shares one file). */
function keepArt(pic) {
  if (!pic || !pic.data) return '';
  const h = crypto.createHash('sha1').update(pic.data).digest('hex').slice(0, 16);
  const name = `${h}.${/png/.test(pic.mime) ? 'png' : 'jpg'}`;
  fs.mkdirSync(artDir(), { recursive: true });
  const f = path.join(artDir(), name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, pic.data);
  return name;
}

/** How long a song is, from macOS's own afinfo (0 if it can't tell, or not on a Mac). */
function duration(p) {
  if (process.platform !== 'darwin') return 0;
  const r = require('child_process').spawnSync('/usr/bin/afinfo', [p], { encoding: 'utf8', timeout: 4000 });
  const m = /estimated duration:\s*([\d.]+)/i.exec(r.stdout || '');
  return m ? Math.round(Number(m[1])) : 0;
}

/** A song from a file. */
function fromFile(p) {
  const t = Tags.read(p);
  const st = fs.statSync(p);
  return { id: id(), kind: 'file', path: p, title: t.title, artist: t.artist || '', album: t.album || '', track: t.track || null, year: t.year || '', art: keepArt(t.pic), size: st.size, added: Date.now(), plays: 0, last: 0, liked: false, dur: duration(p) };
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'Library', '.Trash', 'Photos Library.photoslibrary', 'Music Library.musiclibrary', 'iTunes Library.itl']);
/** Music files in folders (and inside their folders), up to `max`. */
function scan(paths, { max = 20000 } = {}) {
  const found = [];
  const walk = (p, depth) => {
    if (found.length >= max || depth > 12) return;
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isFile()) { if (Tags.isAudio(p) && st.size > 1024) found.push(p); return; }
    if (!st.isDirectory()) return;
    const base = path.basename(p);
    if (depth > 0 && (base.startsWith('.') || SKIP_DIRS.has(base))) return;
    let names = [];
    try { names = fs.readdirSync(p); } catch { return; }
    for (const n of names.sort()) walk(path.join(p, n), depth + 1);
  };
  for (const p of paths) walk(path.resolve(String(p).replace(/^~(?=$|\/)/, os.homedir())), 0);
  return found;
}

/** The usual places music is kept on this computer. */
function usualPlaces() {
  const h = os.homedir();
  return [path.join(h, 'Music'), path.join(h, 'Downloads'), path.join(h, 'Desktop'), path.join(h, 'Documents'), musicDir()].filter((p) => fs.existsSync(p));
}

/** Add files and folders. Songs already in the library are skipped. → { added: [tracks], skipped } */
function addPaths(lib, paths) {
  const have = new Set(lib.tracks.filter((t) => t.kind === 'file').map((t) => t.path));
  const added = [];
  let skipped = 0;
  for (const p of scan(paths)) {
    if (have.has(p)) { skipped++; continue; }
    if (/\.m4p$/i.test(p)) { skipped++; continue; } // Apple Music downloads are locked to the Music app
    try { const t = fromFile(p); lib.tracks.push(t); added.push(t); have.add(p); } catch { skipped++; }
  }
  return { added, skipped };
}

/** A song from a YouTube link. It plays in YouTube's own player, which stays visible while it plays. */
function youtubeId(url) {
  const s = String(url || '').trim();
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/.exec(s);
  return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}
async function addYoutube(lib, url, { fetchInfo = true } = {}) {
  const yt = youtubeId(url);
  if (!yt) throw new Error("That doesn't look like a YouTube link.");
  const had = lib.tracks.find((t) => t.kind === 'youtube' && t.yt === yt);
  if (had) return { track: had, already: true };
  let title = 'YouTube video', artist = '';
  if (fetchInfo) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + yt)}`, { signal: ac.signal });
      clearTimeout(timer);
      if (r.status === 401 || r.status === 403) throw new Error("That video can't be played outside YouTube (its owner turned that off).");
      if (r.ok) { const j = await r.json(); title = j.title || title; artist = (j.author_name || '').replace(/\s*-\s*Topic$/, ''); }
    } catch (e) { if (/outside YouTube/.test(e.message)) throw e; /* offline: a plain name will do */ }
  }
  // "Artist - Song (Official Video)" → artist and song
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
  let song = title;
  if (m) { artist = artist && !m[1].toLowerCase().includes(artist.toLowerCase().slice(0, 4)) ? artist : m[1]; song = m[2]; }
  song = song.replace(/\s*[([](official|lyrics?|audio|video|music video|hd|4k|visuali[sz]er)[^)\]]*[)\]]/gi, '').trim() || title;
  const t = { id: id(), kind: 'youtube', yt, title: song, artist, album: '', added: Date.now(), plays: 0, last: 0, liked: false, dur: 0 };
  lib.tracks.push(t);
  return { track: t, already: false };
}

function find(lib, q) {
  const s = String(q || '').toLowerCase().trim();
  if (!s) return [];
  const words = s.split(/\s+/);
  return lib.tracks.filter((t) => { const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}
function track(lib, tid) { return lib.tracks.find((t) => t.id === tid) || null; }

function remove(lib, ids) {
  const gone = new Set(ids);
  lib.tracks = lib.tracks.filter((t) => !gone.has(t.id));
  for (const p of lib.playlists) p.tracks = p.tracks.filter((x) => !gone.has(x));
}

// ── playlists ──
function playlist(lib, pid) { return lib.playlists.find((p) => p.id === pid || p.name.toLowerCase() === String(pid).toLowerCase()) || null; }
function newPlaylist(lib, name, ids = []) {
  name = String(name || '').trim().slice(0, 60) || 'New playlist';
  let n = name, k = 2;
  while (lib.playlists.some((p) => p.name.toLowerCase() === n.toLowerCase())) n = `${name} ${k++}`;
  const p = { id: id(), name: n, tracks: ids.filter((x) => track(lib, x)), made: Date.now() };
  lib.playlists.push(p);
  return p;
}

/** Played (for "most played" and "recently played"). */
function played(lib, tid) { const t = track(lib, tid); if (t) { t.plays = (t.plays || 0) + 1; t.last = Date.now(); } return t; }

/** The library as the window sees it: no file paths, just what it needs. */
function view(lib) {
  return {
    tracks: lib.tracks.map((t) => ({ id: t.id, kind: t.kind, title: t.title, artist: t.artist, album: t.album, track: t.track, art: t.art || '', yt: t.yt || '', added: t.added, plays: t.plays || 0, last: t.last || 0, liked: !!t.liked, dur: t.dur || 0, missing: t.kind === 'file' && !fs.existsSync(t.path) })),
    playlists: lib.playlists,
    settings: lib.settings,
  };
}

module.exports = { home, musicDir, artDir, load, save, fromFile, scan, usualPlaces, addPaths, youtubeId, addYoutube, find, track, remove, playlist, newPlaylist, played, view, DEFAULTS };
