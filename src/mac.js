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
