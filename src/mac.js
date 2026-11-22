'use strict';
// hum on a Mac: starting at login, the side panel with a bee in the menu bar,
// the ⌃⌥M key combo, and a little "hum" app for Spotlight.

const path = require('path');
const { home } = require('./library');
const Bee = require('./bee');
const Mac = require('./macos')({ app: 'hum', label: 'dev.dpatel7.hum', home });

const SCRIPT = path.join(__dirname, '..', 'bin', 'hum.js');
const panel = require('./panel')({
  app: 'hum', home, title: 'hum', width: 380, height: 680, tooltip: 'hum: your music',
  icon: { grid: Bee.MINI, ink: Bee.INK_NIGHT },
});

function setUp(version, combo = '^~m') {
  const icon = path.join(__dirname, '..', 'assets', 'hum.icns');
  Mac.makeApp({ name: 'hum', id: 'dev.dpatel7.hum.app', args: ['panel'], icon, script: SCRIPT, version });
  const r = Mac.startAgent({ args: ['serve'], script: SCRIPT });
  const p = panel.setUp({ combo });
  return { ...r, panel: p };
}

function tearDown() {
  panel.tearDown();
  Mac.stopAgent();
  Mac.removeApp('hum');
}

module.exports = { ...Mac, panel, setUp, tearDown, SCRIPT };

/**
 * The Mac's own "choose files" box (the side panel can't show one itself).
 * kind: 'files' or 'folder'. Resolves the picked paths ([] if cancelled).
 */
function chooseMusic(kind = 'files') {
  const { execFile } = require('child_process');
  const script = kind === 'folder'
    ? ['activate', 'try', 'set f to choose folder with prompt "Pick a folder of music for hum"', 'return POSIX path of f', 'on error number -128', 'return ""', 'end try']
    : ['activate', 'try', 'set picked to choose file with prompt "Pick songs for hum (hold ⌘ to pick several)" of type {"public.audio"} with multiple selections allowed', 'set out to ""', 'repeat with f in picked', 'set out to out & POSIX path of f & linefeed', 'end repeat', 'return out', 'on error number -128', 'return ""', 'end try'];
  return new Promise((resolve, reject) => {
    execFile('osascript', script.flatMap((l) => ['-e', l]), { timeout: 10 * 60 * 1000, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`The Mac's file box didn't open (${String(stderr || err.message).trim().slice(0, 120)}).`));
      resolve(String(stdout).split('\n').map((x) => x.trim()).filter(Boolean));
    });
  });
}

module.exports.chooseMusic = chooseMusic;
