'use strict';
// The `hum` command.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const A = require('./ansi');
const Sprite = require('./sprite');
const Bee = require('./bee');
const Lib = require('./library');
const pkg = require('../package.json');

const out = (s = '') => process.stdout.write(s + '\n');
const honey = (s) => A.paint(s, { fg: '#f5c431', bold: true });
const lav = (s) => A.paint(s, { fg: '#b1a5ff' });
const dim = (s) => A.paint(s, { fg: '#8a909c' });
const ok = (s) => A.paint(s, { fg: '#8fd4a0' });
const bad = (s) => A.paint(s, { fg: '#ff9a8a' });
const bold = (s) => A.paint(s, { bold: true });
const MAC = process.platform === 'darwin';

const HELP = `
  hum: your music, in a little panel at the side of the screen.

  hum                     open the panel, with play/pause/next right here in Terminal
  hum on                  set it up: a bee in the menu bar, ⌃⌥M for the panel, ready at login
  hum add <files/folders> add your music (mp3, m4a, wav, flac, aiff)    hum add ~/Music
  hum add <YouTube link>  a song from YouTube (it plays in YouTube's own player, in the panel)
  hum play [words]        play (or find a song and play it)      hum pause · next · prev
  hum now                 what's playing
  hum list [words]        your songs            hum playlists     your playlists
  hum app                 hum in a window instead of the panel
  hum doctor              check every part, if something doesn't work
  hum off · update · uninstall · help · --version
`;

function intro(lines) {
  const art = Sprite.picture(Bee.BIG, Bee.MINI, Bee.INK_NIGHT);
  const w = A.vwidth(art[0] || '');
  out('');
  for (let i = 0; i < Math.max(art.length, lines.length); i++) out('  ' + (art[i] || ' '.repeat(w)) + '   ' + (lines[i] || ''));
  out('');
}
const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The background part: running? → { port, secret } or null */
async function running() {
  const Server = require('./server');
  const Local = require('./local');
  const port = Server.runningPort();
  if (port && (await Local.alive(port))) return { port, secret: Server.secret() };
  return null;
}
async function ensure() {
  let r = await running();
  if (r) return r;
  if (MAC && require('./mac').agentState().installed) {
    require('./mac').startAgent({ args: ['serve'], script: require('./mac').SCRIPT });
    for (let i = 0; i < 25 && !r; i++) { await new Promise((res) => setTimeout(res, 200)); r = await running(); }
  }
  return r;
}
async function ask(what, body) {
  const r = await ensure();
  if (!r) throw new Error('hum isn\'t running. Start it with: hum on   (or open it once: hum)');
  return require('./local').ask(r.port, r.secret, what, body, 'x-hum');
}

/** Open the player: the side panel if it's set up, otherwise a narrow window. */
async function openPlayer({ window: win = false } = {}) {
  let r = await ensure();
  let here = null;
  if (!r) { here = await require('./server').start({ log: () => {} }); r = { port: here.port, secret: here.secret }; }
  const url = `http://127.0.0.1:${r.port}/${r.secret}/`;
  if (!win && MAC && (await require('./mac').panel.show())) return { how: 'panel', here };
  if (win) require('./open').openWindow(url, { width: 460, height: 800 });
  else require('./mac').panel.openSide(url);
  return { how: 'window', here };
}

/** A little remote control in Terminal: what's playing, and keys to control it. */
async function remote(here) {
  if (!process.stdin.isTTY) return;
  let drawn = 0, note = '';
  const draw = async () => {
    let n = null;
    try { n = await ask('now'); } catch (e) { note = bad(e.message); }
    const t = n && n.now;
    const lines = [];
    if (t && t.id) {
      const f = t.dur ? Math.min(1, t.pos / t.dur) : 0;
      const w = 26, k = Math.round(f * w);
      lines.push(`  ${t.playing ? honey('▶') : dim('❚❚')}  ${bold(String(t.title || '').slice(0, 48))}${t.artist ? dim('  ' + String(t.artist).slice(0, 30)) : ''}`);
      lines.push(`     ${dim(mmss(t.pos))} ${A.paint('━'.repeat(k), { fg: '#f5c431' })}${dim('─'.repeat(w - k))} ${dim(mmss(t.dur))}${t.queue > 0 ? dim(`   ${t.queue} up next`) : ''}${t.shuffle ? dim('  shuffle') : ''}`);
    } else lines.push(dim(n && n.players ? '  Nothing playing yet: pick a song in the panel.' : '  The player is opening…'));
    lines.push('', dim('  space play/pause · n next · p previous · + − volume · s shuffle · q leave (the music keeps playing)') + (note ? '\n  ' + note : ''));
    const text = lines.join('\n') + '\n';
    process.stdout.write((drawn ? `\x1b[${drawn}A` : '') + '\r\x1b[J' + text);
    drawn = text.split('\n').length - 1;
  };
  out('');
  await draw();
  const timer = setInterval(draw, 1000);
  await new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onKey = async (str, k = {}) => {
      note = '';
      const send = (cmd, arg) => ask('remote', { cmd, arg }).catch((e) => { note = bad(e.message); });
      if ((k.ctrl && k.name === 'c') || k.name === 'q' || k.name === 'escape') {
        process.stdin.removeListener('keypress', onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        clearInterval(timer);
        resolve();
        return;
      }
      if (k.name === 'space' || k.name === 'return') await send('toggle');
      else if (k.name === 'n' || k.name === 'right') await send('next');
      else if (k.name === 'p' || k.name === 'left') await send('prev');
      else if (str === '+' || str === '=' || k.name === 'up') await send('vol', 0.1);
      else if (str === '-' || k.name === 'down') await send('vol', -0.1);
      else if (k.name === 's') await send('shuffle');
      setTimeout(draw, 250);
    };
    process.stdin.on('keypress', onKey);
  });
  if (here) {
    out(dim('\n  hum was running from this window, so the music stops now. To keep it playing when you close Terminal: hum on\n'));
    await here.close();
    process.exit(0);
  }
  out(dim('\n  The music keeps playing in the panel. Click the bee in the menu bar (or ⌃⌥M) to open it.\n'));
}

/** After an update: restart the background part with the new code. */
function ensureCurrent() {
  if (!MAC || process.env.HUM_NO_SETUP) return;
  const stamp = path.join(Lib.home(), 'set-up-version');
  let was = '';
  try { was = fs.readFileSync(stamp, 'utf8').trim(); } catch { /* never */ }
  if (was === pkg.version) return;
  try {
    const Mac = require('./mac');
    if (!Mac.agentState().installed) return;
    Mac.setUp(pkg.version, Lib.load().settings.key);
    fs.writeFileSync(stamp, pkg.version);
  } catch { /* next time */ }
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!['serve', 'uninstall', 'off', '--version', '-v', 'version', 'help', '--help', '-h'].includes(cmd)) ensureCurrent();
  switch (cmd) {
    case undefined: case 'open': case 'panel': {
      const lib = Lib.load();
      if (cmd === undefined) intro(['', `${honey('hum')} ${dim('v' + pkg.version)}`, '', 'Your music, in a little panel', 'at the side of the screen.', '', dim(`${lib.tracks.length} songs, ${lib.playlists.length} playlists`)]);
      const r = await openPlayer();
      if (cmd === 'panel' || cmd === 'open') return;
      if (r.how === 'panel') out(`  ${ok('✓')} The panel is open at the right of the screen.`);
      else out(`  ${ok('✓')} hum is open in a window at the side. ${dim(MAC ? 'For the panel, the menu bar bee and ⌃⌥M: hum on' : '')}`);
      if (!lib.tracks.length) out(`  ${dim('Add music in it with + (or here: hum add ~/Music)')}`);
      return remote(r.here);
    }
    case 'app': case 'window': { const r = await openPlayer({ window: true }); if (r.here) { out(`  hum is running in this window. ${dim('Keep it open while you listen (Ctrl+C stops it).')}`); await new Promise(() => {}); } return; }
    case 'serve': { await require('./server').start({}); await new Promise(() => {}); return; }
    case 'on': case 'setup': case 'start': {
      intro(['', `${honey('hum')} ${dim('v' + pkg.version)}`, '', 'Setting up…']);
      if (!MAC) { out('  On this computer hum runs in a window: hum app'); return; }
      const Mac = require('./mac');
      const s = Lib.load().settings;
      const r = Mac.setUp(pkg.version, s.key);
      if (!r.ok) throw new Error(`macOS didn't start hum (${r.why}). You can still use it: hum app`);
      fs.writeFileSync(path.join(Lib.home(), 'set-up-version'), pkg.version);
      let p = Mac.panel.status();
      for (let i = 0; i < 15 && !p.running; i++) { await new Promise((res) => setTimeout(res, 300)); p = Mac.panel.status(); }
      out(`  ${ok('✓')} hum is ready every time you log in.`);
      out(p.running ? `  ${ok('✓')} There's a bee in your menu bar (top right of the screen): click it for the panel.` : `  ${dim('·')} The menu bar bee is starting. If it doesn't appear: hum doctor`);
      if (p.hotkey === 'carbon') out(`  ${ok('✓')} Or press ${honey('⌃⌥M')} (control + option + M) anywhere.`);
      out(`\n  ${dim('Add music: hum add ~/Music   or the + in the panel')}\n`);
      return;
    }
    case 'off': case 'stop': { if (MAC) require('./mac').tearDown(); out('  hum is off (your music and playlists stay). hum on starts it again.'); return; }
    case 'add': case 'import': {
      if (!rest.length) throw new Error('What should hum add? A folder (hum add ~/Music), files, or a YouTube link.');
      const links = rest.filter((x) => Lib.youtubeId(x) && !fs.existsSync(x));
      const paths = rest.filter((x) => !links.includes(x));
      const r = await running();
      let added = 0;
      if (paths.length) {
        const missing = paths.filter((p) => !fs.existsSync(p.replace(/^~(?=$|\/)/, os.homedir())));
        if (missing.length) out(`  ${bad('!')} Can't find ${missing.join(', ')}`);
        out(`  Looking for music in ${paths.length === 1 ? paths[0] : paths.length + ' places'}…`);
        if (r) added += (await require('./local').ask(r.port, r.secret, 'add', { paths: paths.map((p) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()))) }, 'x-hum')).added;
        else { const lib = Lib.load(); const x = Lib.addPaths(lib, paths); Lib.save(lib); added += x.added.length; }
      }
      for (const u of links) {
        if (r) { const x = await require('./local').ask(r.port, r.secret, 'youtube', { url: u }, 'x-hum'); if (!x.already) added++; }
        else { const lib = Lib.load(); const x = await Lib.addYoutube(lib, u); Lib.save(lib); if (!x.already) added++; out(`  ${ok('✓')} ${x.track.title}${x.track.artist ? dim(' · ' + x.track.artist) : ''}`); }
      }
      if (r) await require('./local').ask(r.port, r.secret, 'remote', { cmd: 'reload' }, 'x-hum').catch(() => {});
      out(`  ${ok('✓')} ${added ? `Added ${added} song${added === 1 ? '' : 's'}.` : 'Nothing new to add.'}${links.length ? dim(' (YouTube songs play in YouTube\'s own player, in the panel.)') : ''}`);
      return;
    }
    case 'play': {
      if (!rest.length) { await ask('remote', { cmd: 'play' }); out(`  ${honey('▶')} Playing.`); return; }
      const lib = Lib.load();
      const pl = Lib.playlist(lib, rest.join(' '));
      const found = pl ? pl.tracks.map((id) => Lib.track(lib, id)).filter(Boolean) : Lib.find(lib, rest.join(' '));
      if (!found.length) throw new Error(`Nothing called "${rest.join(' ')}". See your songs: hum list`);
      const r = await ask('remote', pl ? { cmd: 'play', arg: { ids: found.map((t) => t.id) } } : { cmd: 'play', arg: found[0].id });
      if (!r.players) { await openPlayer(); await new Promise((res) => setTimeout(res, 2500)); await ask('remote', pl ? { cmd: 'play', arg: { ids: found.map((t) => t.id) } } : { cmd: 'play', arg: found[0].id }); }
      out(`  ${honey('▶')} ${pl ? `The playlist ${bold(pl.name)} (${found.length} songs)` : bold(found[0].title) + (found[0].artist ? dim(' · ' + found[0].artist) : '')}`);
      return;
    }
    case 'pause': case 'next': case 'prev': case 'previous': case 'toggle': {
      const r = await ask('remote', { cmd: cmd === 'previous' ? 'prev' : cmd });
      if (!r.players) out(dim('  The player isn\'t open: hum'));
      return;
    }
    case 'now': case 'status': {
      const n = await ask('now');
      if (!n.now || !n.now.id) { out(dim('  Nothing playing.')); return; }
      out(`  ${n.now.playing ? honey('▶') : dim('❚❚')} ${bold(n.now.title)}${n.now.artist ? dim(' · ' + n.now.artist) : ''}  ${dim(mmss(n.now.pos) + ' / ' + mmss(n.now.dur))}`);
      return;
    }
    case 'list': case 'ls': case 'songs': {
      const lib = Lib.load();
      const list = rest.length ? Lib.find(lib, rest.join(' ')) : lib.tracks.slice().sort((a, b) => b.added - a.added);
      out('');
      if (!list.length) out(dim(rest.length ? '  Nothing matches.' : '  No music yet: hum add ~/Music'));
      list.slice(0, 60).forEach((t, i) => out(`  ${dim(String(i + 1).padStart(3))}  ${t.kind === 'youtube' ? A.paint('▶', { fg: '#ff6b6b' }) : dim('♪')}  ${t.title.slice(0, 50)}${t.artist ? dim('  ' + t.artist.slice(0, 30)) : ''}${t.liked ? A.paint(' ♥', { fg: '#ff8fab' }) : ''}`));
      if (list.length > 60) out(dim(`  …and ${list.length - 60} more`));
      out(dim(`\n  ${list.length} of ${lib.tracks.length}. Play one: hum play <words>\n`));
      return;
    }
    case 'playlists': case 'lists': {
      const lib = Lib.load();
      out('');
      if (!lib.playlists.length) out(dim('  No playlists yet. Make them in the panel (Playlists › New playlist).'));
      lib.playlists.forEach((p) => out(`  ${lav('♫')} ${bold(p.name)}  ${dim(p.tracks.length + ' songs')}`));
      out(dim('\n  Play one: hum play <playlist name>\n'));
      return;
    }
    case 'doctor': case 'check': return doctor();
    case '--version': case '-v': case 'version': out(`hum ${pkg.version}`); return;
    case 'help': case '--help': case '-h': out(HELP); return;
    case 'update': return update();
    case 'uninstall': return uninstall();
    default: throw new Error(`"${cmd}" isn't a hum command. Try: hum help`);
  }
}

async function doctor() {
  const yes = (s) => out(`  ${ok('✓')} ${s}`);
  const no = (s, fix) => out(`  ${bad('!')} ${s}${fix ? `\n      ${dim(fix)}` : ''}`);
  const lib = Lib.load();
  out(`\n  ${honey('hum')} ${dim('v' + pkg.version)}: checking every part\n`);
  yes(`${lib.tracks.length} songs (${lib.tracks.filter((t) => t.kind === 'youtube').length} from YouTube), ${lib.playlists.length} playlists.`);
  const missing = lib.tracks.filter((t) => t.kind === 'file' && !fs.existsSync(t.path)).length;
  if (missing) no(`${missing} song file${missing === 1 ? ' was' : 's were'} moved or deleted.`, 'They show greyed out; remove them in the panel (⋯ › Remove from hum), or add the new place: hum add <folder>');
  const r = await running();
  if (r) yes(`The background part is running (port ${r.port}).`); else no('The background part isn\'t running.', MAC ? 'hum on starts it (and keeps it running).' : 'hum app runs it in a window.');
  if (MAC) {
    const p = require('./mac').panel.status();
    if (p.running) yes('The side panel is running: the bee in the menu bar opens it.'); else no('The side panel isn\'t running.', `${p.err ? 'It said: ' + p.err + '. ' : ''}hum on starts it. Until then hum opens a window at the side.`);
    if (p.running && p.hotkey === 'carbon') yes('⌃⌥M opens the panel.'); else if (p.running) no(`⌃⌥M isn't hum's${p.hotkeyWhy ? ` (${p.hotkeyWhy})` : ''}.`, 'The menu bar bee always works.');
  }
  // can hum reach YouTube from here? (a school network may block it, or need a proxy)
  try {
    const y = await fetch('https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw', { signal: AbortSignal.timeout(8000) });
    if (y.ok && /json/.test(y.headers.get('content-type') || '')) yes('YouTube answers, so YouTube songs get their names straight away.');
    else no(`YouTube answered ${y.status} here (a network filter?).`, 'YouTube songs still get added; they get their names when they first play. If they won\'t play either, this network blocks YouTube.');
  } catch (e) { no("hum's background part can't reach YouTube from this network.", 'YouTube songs still get added, and get their names when they first play (the player uses your Mac\'s own network settings). If they won\'t play, this network blocks YouTube.'); }
  if (r) { const n = await require('./local').ask(r.port, r.secret, 'now', {}, 'x-hum').catch(() => null); out(`  ${n && n.players ? ok('✓') : dim('·')} ${n && n.players ? 'The player is open.' : 'The player isn\'t open right now (hum opens it).'}`); }
  for (const [name, f] of [['background part', 'hum.log'], ['side panel', 'panel.log']]) {
    let text = '';
    try { text = fs.readFileSync(path.join(Lib.home(), f), 'utf8'); } catch { continue; }
    const tail = text.trim().split('\n').slice(-4).filter(Boolean);
    if (tail.length) { out(dim(`\n  The ${name}'s last notes (${path.join(Lib.home(), f)}):`)); tail.forEach((l) => out(dim('    ' + l.slice(0, 160)))); }
  }
  out('');
}

function installUrl(kind) {
  let hub = '';
  try { hub = fs.readFileSync(path.join(Lib.home(), 'hub'), 'utf8').trim(); } catch { /* from GitHub */ }
  if (/^https?:\/\//.test(hub)) return `${hub.replace(/\/+$/, '')}/install.${kind}`;
  return `https://raw.githubusercontent.com/dpatel7-dev/hum/main/install.${kind}`;
}
function update() {
  const { spawnSync } = require('child_process');
  const win = process.platform === 'win32';
  const url = installUrl(win ? 'ps1' : 'sh');
  out(`  Updating from ${url}`);
  const r = win ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${url} | iex`], { stdio: 'inherit' }) : spawnSync('sh', ['-c', `curl -fsSL "${url}" | sh`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('The update did not finish. Your current version still works.');
}
async function uninstall() {
  if (MAC) require('./mac').tearDown();
  const root = Lib.home();
  let launcher = '';
  try { launcher = fs.readFileSync(path.join(root, 'launcher'), 'utf8').trim(); } catch { /* not from the installer */ }
  fs.rmSync(path.join(root, 'app'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'node'), { recursive: true, force: true });
  if (launcher && /hum(\.cmd)?$/.test(launcher)) fs.rmSync(launcher, { force: true });
  out(`  hum is uninstalled. ${dim(`Your library and playlists are still in ${root} (your music files were never moved).`)}`);
}

module.exports = { main, HELP };
