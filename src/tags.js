'use strict';
// What's written inside a music file: title, artist, album, track number and
// the cover picture. MP3 (ID3 tags), M4A/AAC (iTunes-style atoms) and FLAC
// (Vorbis comments). Only the start of the file (or the few boxes needed) is
// read, never the music itself. When a file says nothing, the file name is
// used ("Artist - Title.mp3").

const fs = require('fs');
const path = require('path');

const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.wav', '.aiff', '.aif', '.flac', '.ogg', '.oga', '.opus', '.alac', '.mp4']);

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n < len ? b.subarray(0, n) : b;
}

// ── ID3 (MP3) ──
const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
function id3Text(buf) {
  if (!buf.length) return '';
  const enc = buf[0];
  let body = buf.subarray(1);
  let s;
  if (enc === 1 || enc === 2) {
    // UTF-16 with (1) or without (2, big-endian) a byte-order mark
    let le = true;
    if (body[0] === 0xff && body[1] === 0xfe) body = body.subarray(2);
    else if (body[0] === 0xfe && body[1] === 0xff) { body = body.subarray(2); le = false; } else if (enc === 2) le = false;
    if (!le) { const sw = Buffer.from(body); for (let i = 0; i + 1 < sw.length; i += 2) { const t = sw[i]; sw[i] = sw[i + 1]; sw[i + 1] = t; } body = sw; }
    s = body.subarray(0, body.length - (body.length % 2)).toString('utf16le');
  } else if (enc === 3) s = body.toString('utf8');
  else s = body.toString('latin1');
  return s.replace(/\u0000[\s\S]*$/, '').trim();
}
function id3Picture(buf, v) {
  // [enc][mime\0 | 3-char format][type][description\0][data]
  const enc = buf[0];
  let i = 1, mime;
  if (v === 2) { mime = buf.subarray(1, 4).toString('latin1').toLowerCase() === 'png' ? 'image/png' : 'image/jpeg'; i = 4; } else {
    const z = buf.indexOf(0, 1);
    mime = buf.subarray(1, z).toString('latin1') || 'image/jpeg';
    i = z + 1;
  }
  i += 1; // picture type
  if (enc === 1 || enc === 2) { while (i + 1 < buf.length && !(buf[i] === 0 && buf[i + 1] === 0)) i += 2; i += 2; } else { while (i < buf.length && buf[i] !== 0) i++; i += 1; }
  if (!/image\//.test(mime)) mime = /png/i.test(mime) ? 'image/png' : 'image/jpeg';
  return { mime, data: buf.subarray(i) };
}
function id3(fd, size) {
  const head = readAt(fd, 0, 10);
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null;
  const v = head[3];
  const len = Math.min(syncsafe(head, 6), 16 * 1024 * 1024, size - 10);
  const tag = readAt(fd, 10, len);
  const out = {};
  let i = 0;
  if (head[5] & 0x40 && v >= 3) { const ext = v === 4 ? syncsafe(tag, 0) : tag.readUInt32BE(0) + 4; i = ext; } // extended header
  const W = v === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album', TRK: 'track', TYE: 'year', PIC: 'pic' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album', TRCK: 'track', TYER: 'year', TDRC: 'year', APIC: 'pic', TPE2: 'albumArtist' };
  while (i + (v === 2 ? 6 : 10) <= tag.length) {
    const idLen = v === 2 ? 3 : 4;
    const id = tag.toString('latin1', i, i + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const fsize = v === 2 ? tag.readUIntBE(i + 3, 3) : v === 4 ? syncsafe(tag, i + 4) : tag.readUInt32BE(i + 4);
    const start = i + (v === 2 ? 6 : 10);
    if (fsize <= 0 || start + fsize > tag.length) break;
    const key = W[id];
    const body = tag.subarray(start, start + fsize);
    if (key === 'pic') { if (!out.pic) out.pic = id3Picture(body, v); } else if (key && !out[key]) out[key] = id3Text(body);
    i = start + fsize;
  }
  return out;
}
function id3v1(fd, size) {
  if (size < 128) return null;
  const b = readAt(fd, size - 128, 128);
  if (b.toString('latin1', 0, 3) !== 'TAG') return null;
  const t = (a, z) => b.toString('latin1', a, z).replace(/\u0000[\s\S]*$/, '').trim();
  return { title: t(3, 33), artist: t(33, 63), album: t(63, 93), year: t(93, 97) };
}

// ── MP4 / M4A ──
function atoms(fd, start, end, want, depth = 0) {
  const found = {};
  let pos = start;
  while (pos + 8 <= end && depth < 8) {
    const h = readAt(fd, pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let hdr = 8;
    if (size === 1) { size = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (size === 0) size = end - pos;
    if (size < hdr) break;
    if (want(type)) found[type] = found[type] || { start: pos + hdr, end: pos + size };
    pos += size;
  }
  return found;
}
function mp4(fd, size) {
  const h = readAt(fd, 4, 4).toString('latin1');
  if (h !== 'ftyp') return null;
  const top = atoms(fd, 0, size, (t) => t === 'moov');
  if (!top.moov) return null;
  const moov = atoms(fd, top.moov.start, top.moov.end, (t) => t === 'udta');
  if (!moov.udta) return {};
  const udta = atoms(fd, moov.udta.start, moov.udta.end, (t) => t === 'meta');
  if (!udta.meta) return {};
  const meta = atoms(fd, udta.meta.start + 4, udta.meta.end, (t) => t === 'ilst'); // meta has 4 bytes of version/flags
  if (!meta.ilst) return {};
  const len = Math.min(meta.ilst.end - meta.ilst.start, 16 * 1024 * 1024);
  const ilst = readAt(fd, meta.ilst.start, len);
  const out = {};
  const KEYS = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', aART: 'albumArtist', '©day': 'year', trkn: 'track', covr: 'pic' };
  let i = 0;
  while (i + 8 <= ilst.length) {
    const sz = ilst.readUInt32BE(i);
    if (sz < 8 || i + sz > ilst.length) break;
    const type = ilst.toString('latin1', i + 4, i + 8);
    const key = KEYS[type];
    // inside: a 'data' box: [size][data][type 4][locale 4][value]
    const d = i + 8;
    if (key && d + 16 <= i + sz && ilst.toString('latin1', d + 4, d + 8) === 'data') {
      const dsz = ilst.readUInt32BE(d);
      const kind = ilst.readUInt32BE(d + 8) & 0xffffff;
      const val = ilst.subarray(d + 16, d + dsz);
      if (key === 'pic') out.pic = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: val };
      else if (key === 'track') { if (val.length >= 4) out.track = String(val.readUInt16BE(2)); } else out[key] = val.toString('utf8').trim();
    }
    i += sz;
  }
  return out;
}

// ── FLAC ──
function flac(fd) {
  if (readAt(fd, 0, 4).toString('latin1') !== 'fLaC') return null;
  const out = {};
  let pos = 4;
  for (let n = 0; n < 64; n++) {
    const h = readAt(fd, pos, 4);
    if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = h.readUIntBE(1, 3);
    if (type === 4) {
      const b = readAt(fd, pos + 4, Math.min(len, 1024 * 1024));
      let i = 0;
      const vlen = b.readUInt32LE(i); i += 4 + vlen;
      const count = b.readUInt32LE(i); i += 4;
      for (let k = 0; k < count && i + 4 <= b.length; k++) {
        const l = b.readUInt32LE(i); i += 4;
        const kv = b.toString('utf8', i, i + l); i += l;
        const eq = kv.indexOf('=');
        if (eq < 0) continue;
        const key = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', TRACKNUMBER: 'track', DATE: 'year', ALBUMARTIST: 'albumArtist' }[kv.slice(0, eq).toUpperCase()];
        if (key && !out[key]) out[key] = kv.slice(eq + 1).trim();
      }
    } else if (type === 6 && !out.pic) {
      const b = readAt(fd, pos + 4, Math.min(len, 16 * 1024 * 1024));
      let i = 4;
      const ml = b.readUInt32BE(i); i += 4;
      const mime = b.toString('latin1', i, i + ml); i += ml;
      const dl = b.readUInt32BE(i); i += 4 + dl + 16;
      const pl = b.readUInt32BE(i); i += 4;
      out.pic = { mime: mime || 'image/jpeg', data: b.subarray(i, i + pl) };
    }
    pos += 4 + len;
    if (last) break;
  }
  return out;
}

/** "Artist - Title", "01 Title", "01. Artist - Title" → { artist, title } */
function fromName(file) {
  let base = path.basename(file, path.extname(file)).replace(/_/g, ' ').trim();
  base = base.replace(/^\d{1,3}[\s.\-)]+/, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base };
}

/** Everything hum can learn about a music file. → { title, artist, album, track, year, pic? } */
function read(file) {
  let fd;
  const out = {};
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const ext = path.extname(file).toLowerCase();
    let t = null;
    try {
      if (ext === '.flac') t = flac(fd);
      else if (['.m4a', '.mp4', '.aac', '.alac'].includes(ext)) t = mp4(fd, size);
      if (!t) t = id3(fd, size) || mp4(fd, size) || flac(fd);
      if (!t || (!t.title && !t.artist)) t = { ...(id3v1(fd, size) || {}), ...(t || {}) };
    } catch { t = t || {}; }
    Object.assign(out, t || {});
  } catch { /* unreadable: the name will do */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* fine */ } }
  const n = fromName(file);
  if (!out.title) { out.title = n.title; if (!out.artist && n.artist) out.artist = n.artist; }
  for (const k of ['title', 'artist', 'album', 'albumArtist', 'year', 'track']) if (out[k] != null) out[k] = String(out[k]).slice(0, 300);
  if (out.track) out.track = Number(String(out.track).split('/')[0]) || undefined;
  if (out.pic && (!out.pic.data || out.pic.data.length < 64 || out.pic.data.length > 12 * 1024 * 1024)) delete out.pic;
  return out;
}

const isAudio = (file) => AUDIO.has(path.extname(file).toLowerCase());

module.exports = { read, fromName, isAudio, AUDIO };
