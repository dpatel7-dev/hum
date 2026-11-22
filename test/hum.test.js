'use strict';
// hum's tests: reading tags from real files (made with ffmpeg when it's
// there, or small hand-made ones), the library, YouTube links, the server
// (pieces of songs, commands for the player) and the command line.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hum-test-'));
process.env.HUM_HOME = path.join(TMP, 'hum');
process.env.HOME = path.join(TMP, 'home');
process.env.APP_NO_WINDOW = '1';
process.env.HUM_NO_SETUP = '1';
fs.mkdirSync(process.env.HOME, { recursive: true });
const MUSIC = path.join(TMP, 'music');
fs.mkdirSync(path.join(MUSIC, 'Album'), { recursive: true });

const Tags = require('../src/tags');
const Lib = require('../src/library');
const Server = require('../src/server');
const Local = require('../src/local');

// a hand-made MP3 with an ID3v2.3 tag (title, artist, album, a picture): the tag is what matters here
function id3frame(id, body) { const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]); }
function syncsafe(n) { return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]); }
const text = (s) => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')]);
const utf16 = (s) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const frames = Buffer.concat([id3frame('TIT2', text('Honey Morning')), id3frame('TPE1', utf16('The Bumbles')), id3frame('TALB', text('Meadow Songs')), id3frame('TRCK', text('3/10')),
  id3frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3]), Buffer.from('cover\0', 'latin1'), jpeg]))]);
const tag = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(frames.length), frames]);
fs.writeFileSync(path.join(MUSIC, 'Album', 'honey.mp3'), Buffer.concat([tag, Buffer.alloc(4000, 0xff)]));
fs.writeFileSync(path.join(MUSIC, '07 - Night Garden - Moths.wav'), Buffer.alloc(3000, 1));
fs.writeFileSync(path.join(MUSIC, 'notes.txt'), 'not music');
const FF = spawnSync('ffmpeg', ['-version']).status === 0;
if (FF) {
  spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=523:duration=3', '-c:a', 'aac', '-metadata', 'title=Lavender Sky', '-metadata', 'artist=Pollen', path.join(MUSIC, 'lavender.m4a')]);
  spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:a', 'flac', '-metadata', 'TITLE=Clover', '-metadata', 'ARTIST=Field Notes', path.join(MUSIC, 'clover.flac')]);
}

test('reads tags: ID3 (with a picture and UTF-16), and the file name when there are none', () => {
  const t = Tags.read(path.join(MUSIC, 'Album', 'honey.mp3'));
  assert.equal(t.title, 'Honey Morning');
  assert.equal(t.artist, 'The Bumbles');
  assert.equal(t.album, 'Meadow Songs');
  assert.equal(t.track, 3);
  assert.equal(t.pic.mime, 'image/jpeg');
  assert.equal(t.pic.data.length, jpeg.length);
  assert.deepEqual(Tags.read(path.join(MUSIC, '07 - Night Garden - Moths.wav')), { title: 'Moths', artist: 'Night Garden' });
  assert.deepEqual(Tags.fromName('01. Song Name.mp3'), { title: 'Song Name' });
});

test('reads tags from M4A and FLAC files', { skip: !FF && 'no ffmpeg here' }, () => {
  const m = Tags.read(path.join(MUSIC, 'lavender.m4a'));
  assert.equal(m.title, 'Lavender Sky');
  assert.equal(m.artist, 'Pollen');
  const f = Tags.read(path.join(MUSIC, 'clover.flac'));
  assert.equal(f.title, 'Clover');
  assert.equal(f.artist, 'Field Notes');
});

test('the library: adds folders once, keeps pictures once, playlists, YouTube links', async () => {
  const lib = Lib.load();
  const r = Lib.addPaths(lib, [MUSIC]);
  assert.equal(r.added.length, FF ? 4 : 2);
  assert.equal(Lib.addPaths(lib, [MUSIC]).added.length, 0, 'not twice');
  const honey = lib.tracks.find((t) => t.title === 'Honey Morning');
  assert.match(honey.art, /^[a-f0-9]{16}\.jpg$/);
  assert.ok(fs.existsSync(path.join(Lib.artDir(), honey.art)));
  assert.equal(Lib.find(lib, 'bumbles honey')[0].id, honey.id);
  const p = Lib.newPlaylist(lib, 'Homework', [honey.id, 'nope']);
  assert.deepEqual(p.tracks, [honey.id]);
  assert.equal(Lib.newPlaylist(lib, 'homework').name, 'homework 2');
  for (const [url, want] of [['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'], ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'], ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'], ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'], ['https://example.com/x', null]]) assert.equal(Lib.youtubeId(url), want);
  const y = await Lib.addYoutube(lib, 'https://youtu.be/dQw4w9WgXcQ', { fetchInfo: false });
  assert.equal(y.track.kind, 'youtube');
  assert.equal((await Lib.addYoutube(lib, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', { fetchInfo: false })).already, true);
  await assert.rejects(Lib.addYoutube(lib, 'not a link'), /YouTube link/);
  Lib.remove(lib, [honey.id]);
  assert.equal(lib.playlists[0].tracks.length, 0, 'gone from playlists too');
  Lib.save(lib);
  assert.ok(Lib.view(Lib.load()).tracks.every((t) => t.path === undefined), 'the window never sees file paths');
});

test("the server: pieces of songs, pictures, commands for the player, playlists", async () => {
  const s = await Server.start({ port: 0, log: () => {} });
  try {
    const ask = (what, body) => Local.ask(s.port, s.secret, what, body, 'x-hum');
    const lib = (await ask('add', { paths: [MUSIC] })).library;
    const honey = lib.tracks.find((t) => t.title === 'Honey Morning');
    const base = `http://127.0.0.1:${s.port}/${s.secret}`;
    const part = await fetch(`${base}/file/${honey.id}`, { headers: { range: 'bytes=0-9' } });
    assert.equal(part.status, 206);
    assert.match(part.headers.get('content-range'), /^bytes 0-9\/\d+$/);
    assert.equal((await part.arrayBuffer()).byteLength, 10);
    assert.equal((await fetch(`${base}/file/${'0'.repeat(12)}`)).status, 404);
    assert.equal((await fetch(`${base}/art/${honey.art}`)).headers.get('content-type'), 'image/jpeg');
    const page = await fetch(base + '/');
    assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', "so YouTube's player works");
    // a player listening for commands
    const ac = new AbortController();
    const ev = await fetch(`${base}/events?s=${s.secret}`, { signal: ac.signal });
    const reader = ev.body.getReader();
    await reader.read();
    assert.equal((await ask('remote', { cmd: 'next' })).players, 1);
    const got = new TextDecoder().decode((await reader.read()).value);
    assert.match(got, /"cmd":"next"/);
    ac.abort();
    const pl = await ask('pl-new', { name: 'Bus ride', ids: [honey.id] });
    const id = pl.playlist;
    const two = lib.tracks.find((t) => t.id !== honey.id);
    assert.equal((await ask('pl-add', { id, ids: [two.id, honey.id] })).added, 1);
    const moved = await ask('pl-move', { id, from: 1, to: 0 });
    assert.deepEqual(moved.library.playlists.find((p) => p.id === id).tracks, [two.id, honey.id]);
    await ask('report', { state: { id: honey.id, title: 'Honey Morning', playing: true, pos: 12, dur: 180 } });
    assert.equal((await ask('now')).now.pos, 12);
    assert.equal((await ask('settings', { volume: 2, repeat: 'one' })).settings.volume, 1);
    await assert.rejects(ask('upload', { name: 'virus.exe', b64: 'AAAA' }), /music files/);
    const up = await ask('upload', { name: 'new song.mp3', b64: fs.readFileSync(path.join(MUSIC, 'Album', 'honey.mp3')).toString('base64') });
    assert.equal(up.added, 1);
    assert.ok(fs.existsSync(path.join(Lib.musicDir(), 'new song.mp3')));
  } finally { await s.close(); }
});

test('the command line', () => {
  const run = (args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'hum.js'), ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, input: '' });
  assert.match(run(['--version']).stdout, /^hum \d+\.\d+\.\d+/);
  assert.match(run(['help']).stdout, /hum add <YouTube link>/);
  assert.match(run(['list']).stdout, /Honey Morning/);
  assert.match(run(['list', 'moths']).stdout, /1 of/);
  assert.match(run(['playlists']).stdout, /Bus ride/);
  assert.match(run(['frobnicate']).stderr, /isn't a hum command/);
});
