// Visual test (optional, requires `npm i --no-save puppeteer`):
// boots the server, loads the game in headless Chrome with software WebGL,
// drives the menus into a real world and captures screenshots to docs/.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const PORT = 3777;
const WORLDS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'twicy-vis-'));
const DOCS = path.join(__dirname, '..', 'docs');
fs.mkdirSync(DOCS, { recursive: true });

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const puppeteer = require('puppeteer');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), WORLDS_DIR },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;
  const errors = [];
  try {
    await delay(800);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push('console: ' + m.text());
    });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#menu .logo', { timeout: 8000 });
    await delay(400);
    await page.screenshot({ path: path.join(DOCS, 'menu.png') });
    console.log('✓ title menu rendered');

    // skins screen
    await page.click('#m-skins');
    await page.waitForSelector('.skin-grid');
    await delay(300);
    await page.screenshot({ path: path.join(DOCS, 'skins.png') });
    await page.click('#m-back');
    console.log('✓ skins screen rendered');

    // create a creative world
    await page.click('#m-play');
    await page.waitForSelector('#m-create', { timeout: 8000 });
    await page.type('#m-wname', 'Demo Valley');
    await page.type('#m-wseed', 'showcase');
    await page.click('#m-mode-c');
    await page.click('#m-create');

    // wait until the game is actually running
    await page.waitForFunction('window.App && App.game && App.game.running === true', { timeout: 30000 });
    console.log('✓ world created and joined');

    // let chunks generate & mesh, then take over the camera for a nice shot
    await delay(1000);
    await page.waitForFunction('App.renderer && App.renderer.chunkMeshes.size > 20', { timeout: 30000 });
    await page.evaluate(() => {
      document.getElementById('lock-overlay').classList.add('hidden');
      const g = App.game;
      g.time = 140; // late morning light
      g.player.flying = true;
      const s = g.player.spawn;
      g.player.teleport([s[0], Math.max(s[1] + 12, 52), s[2] + 14]);
      g.player.yaw = Math.PI; // look back toward spawn (+Z behind us… face -(+Z))
      g.player.pitch = -0.35;
    });
    await delay(2500); // more meshes + a few frames
    const stats = await page.evaluate(() => ({
      meshes: App.renderer.chunkMeshes.size,
      chunks: App.game.world.chunks.size,
      mode: App.game.player.mode,
    }));
    console.log(`✓ in game: ${stats.chunks} chunks, ${stats.meshes} meshed, mode=${stats.mode}`);
    assert.ok(stats.meshes > 20, 'chunks meshed');
    await page.screenshot({ path: path.join(DOCS, 'gameplay.png') });

    // third person + a remote-style pose (shows the player model + animations)
    await page.evaluate(() => {
      App.game.thirdPerson = true;
      App.game.player.pitch = -0.15;
    });
    await delay(400);
    await page.screenshot({ path: path.join(DOCS, 'thirdperson.png') });
    console.log('✓ third-person view rendered');

    // inventory UI
    await page.evaluate(() => { App.game.thirdPerson = false; App.game.invUI.open(); });
    await delay(400);
    await page.screenshot({ path: path.join(DOCS, 'inventory.png') });
    await page.evaluate(() => App.game.invUI.close());
    console.log('✓ creative inventory rendered');

    // sanity on screenshot sizes (a black/blank frame compresses to almost nothing)
    for (const f of ['menu.png', 'gameplay.png', 'thirdperson.png', 'inventory.png']) {
      const size = fs.statSync(path.join(DOCS, f)).size;
      assert.ok(size > 20000, `${f} looks blank (${size} bytes)`);
      console.log(`  ${f}: ${(size / 1024).toFixed(0)} KB`);
    }

    const fatal = errors.filter(e => !/Audio|favicon|SwiftShader|GPU|WebGL.*fallback/i.test(e));
    if (fatal.length) {
      console.error('Page errors:\n' + fatal.join('\n'));
      throw new Error('page reported errors');
    }
    console.log('\nVisual test passed — screenshots in docs/');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    try { fs.rmSync(WORLDS_DIR, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch(e => {
  console.error('\n✗ VISUAL TEST FAILED:', e.message);
  process.exit(1);
});
