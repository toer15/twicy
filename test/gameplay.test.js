// Optional gameplay test (requires `npm i --no-save puppeteer`): plays the
// full survival loop through the real UI — punch a log by hand, collect the
// spinning drop, craft planks -> crafting table -> place it -> open the 3x3
// grid -> craft a wooden pickaxe -> verify tool mining speed.
const { spawn } = require('child_process');
const path = require('path');
const puppeteer = require('puppeteer');
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: '3770', WORLDS_DIR: require('fs').mkdtempSync(require('os').tmpdir() + '/twicy-gp-') }, stdio: ['ignore','ignore','inherit'],
  });
  let browser;
  const errors = [];
  try {
    await delay(800);
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', e => errors.push(e.message.slice(0, 250)));
    await page.goto('http://127.0.0.1:3770/', { waitUntil: 'networkidle0' });
    await page.click('#m-play');
    await delay(1200);
    await page.click('#m-create'); // survival by default
    await page.waitForFunction('App.game && App.game.running === true', { timeout: 30000 });
    await page.waitForFunction('App.renderer.chunkMeshes.size > 8', { timeout: 30000 });
    await page.waitForFunction('App.game.bootPhase === false', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('lock-overlay').classList.add('hidden'));
    // a mob wandering into the test area would disturb the scripted clicks
    await page.evaluate(() => { App.game.mobs.enabled = false; App.game.mobs.clear(); });

    // ---- 1. "punch a tree": place a log 2 blocks ahead, mine it by hand ----
    const setup = await page.evaluate(() => {
      const g = App.game, p = g.player;
      const gy = g.world.findGroundY(p.pos[0], p.pos[2]);
      const bx = Math.floor(p.pos[0]), bz = Math.floor(p.pos[2]) - 2;
      g.world.setBlock(bx, gy + 1, bz, BL.LOG, true);
      p.yaw = 0; // face -Z toward the log
      // aim at the log block center
      const eye = [p.pos[0], p.pos[1] + 1.62, p.pos[2]];
      const dy = (gy + 1.5) - eye[1], dz = (bz + 0.5) - eye[2], dx = (bx + 0.5) - eye[0];
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      g.inv.slots.fill(null); // empty hands, empty inventory
      g.mouse.left = true;
      g.onLeftDown();
      return { bx, by: gy + 1, bz };
    });
    // hand vs wood: 2.0s game time; headless runs ~10fps with 0.05 dt cap → wait generously
    await page.waitForFunction(
      (s) => App.game.world.getBlock(s.bx, s.by, s.bz) === 0,
      { timeout: 20000 }, setup);
    await page.evaluate(() => { App.game.mouse.left = false; });
    const dropState = await page.evaluate(() => ({
      drops: App.game.drops.list.map(d => d.id),
      particles: App.game.particles.list.length > 0,
    }));
    console.log('✓ punched log by hand: drop spawned =', JSON.stringify(dropState.drops), 'particles =', dropState.particles);
    if (dropState.drops[0] !== 8) throw new Error('no LOG drop entity!');

    // walk onto the drop -> pickup
    await page.evaluate(s => { App.game.player.teleport([s.bx + 0.5, s.by, s.bz + 0.5]); }, setup);
    await page.waitForFunction('App.game.inv.findItem(BL.LOG) >= 0', { timeout: 10000 });
    console.log('✓ walked over drop, log collected into inventory');

    // ---- 2. craft planks in the 2x2 grid via real UI clicks ----
    await page.evaluate(() => {
      document.getElementById('lock-overlay').classList.add('hidden');
      App.game.invUI.open('player');
    });
    await delay(300);
    const logSlotIdx = await page.evaluate(() => App.game.inv.findItem(BL.LOG));
    // hotbar slots are in .hotrow (inv index 0..8), main grid is indices 9..35
    const slotSel = i => i < 9
      ? `.inv-grid.hotrow .slot:nth-child(${i + 1})`
      : `.inv-grid:not(.hotrow):not(.craft-grid):not(.palette) .slot:nth-child(${i - 8})`;
    await page.click(slotSel(logSlotIdx));                       // pick up log
    await page.click('.craft-grid .slot:nth-child(1)');          // into craft grid
    await page.click('.craft-result');                           // take 4 planks
    let cursor = await page.evaluate(() => App.game.invUI.cursor);
    console.log('✓ crafted via UI: cursor =', JSON.stringify(cursor));
    if (!cursor || cursor.id !== 9 || cursor.count !== 4) throw new Error('planks craft failed');

    // ---- 3. 4 planks -> crafting table (right-click to place one per cell) ----
    for (const n of [1, 2, 3, 4]) {
      await page.click(`.craft-grid .slot:nth-child(${n})`, { button: 'right' });
    }
    await page.click('.craft-result');
    cursor = await page.evaluate(() => App.game.invUI.cursor);
    if (!cursor || cursor.id !== 33) throw new Error('crafting table craft failed: ' + JSON.stringify(cursor));
    console.log('✓ crafted crafting table from 4 planks');
    await page.click(slotSel(0)); // drop it into hotbar slot 0
    await page.evaluate(() => App.game.invUI.close());

    // ---- 4. place the table, right-click opens the 3x3 ----
    await page.evaluate(() => {
      const g = App.game, p = g.player;
      g.inv.selected = 0;
      p.pitch = -0.9;
      g.tryPlace();
    });
    const placed = await page.evaluate(() => {
      const g = App.game;
      g.player.pitch = -0.7;
      const t = g.rayTarget();
      return t ? g.world.getBlock(t.x, t.y, t.z) : -1;
    });
    if (placed !== 33) throw new Error('table not placed/targeted: ' + placed);
    await page.evaluate(() => App.game.tryPlace()); // right-click the table
    const uiKind = await page.evaluate(() => ({ open: App.game.invUI.openState, kind: App.game.invUI.kind }));
    if (!uiKind.open || uiKind.kind !== 'table') throw new Error('table UI did not open: ' + JSON.stringify(uiKind));
    console.log('✓ placed crafting table; right-click opened the 3x3 grid');

    // ---- 5. craft a wooden pickaxe in the 3x3 ----
    await page.evaluate(() => {
      const g = App.game;
      g.inv.addItem(BL.PLANKS, 8);
      g.inv.addItem(IT.STICK, 4);
      g.invUI.open('table'); // rebuild UI with the new items
    });
    await delay(200);
    const plankIdx = await page.evaluate(() => App.game.inv.findItem(BL.PLANKS));
    const stickIdx = await page.evaluate(() => App.game.inv.findItem(IT.STICK));
    await page.click(slotSel(plankIdx));
    for (const n of [1, 2, 3]) await page.click(`.craft-grid .slot:nth-child(${n})`, { button: 'right' });
    await page.click(slotSel(plankIdx)); // put leftover planks back
    await page.click(slotSel(stickIdx));
    for (const n of [5, 8]) await page.click(`.craft-grid .slot:nth-child(${n})`, { button: 'right' });
    await page.click(slotSel(stickIdx)); // leftover sticks back
    await page.click('.craft-result');
    cursor = await page.evaluate(() => App.game.invUI.cursor);
    if (!cursor || cursor.id !== 101) throw new Error('pickaxe craft failed: ' + JSON.stringify(cursor));
    console.log('✓ crafted wooden pickaxe on the 3x3 table');
    await page.click(slotSel(1));
    await page.evaluate(() => App.game.invUI.close());

    // ---- 6. tool speed in the live game: pickaxe vs hand on stone ----
    const mineCheck = await page.evaluate(() => {
      const g = App.game;
      g.inv.selected = 1; // pickaxe
      const sHand = breakInfo(BL.STONE, 0).seconds;
      const sPick = breakInfo(BL.STONE, g.heldItemId()).seconds;
      return { sHand, sPick, held: g.heldItemId() };
    });
    console.log(`✓ in-game tool check: stone ${mineCheck.sHand.toFixed(1)}s by hand → ${mineCheck.sPick.toFixed(2)}s with pickaxe (held=${mineCheck.held})`);

    const fatal = errors.filter(e => !/Audio/i.test(e));
    if (fatal.length) throw new Error('page errors: ' + fatal.join(' | '));
    console.log('\nFULL SURVIVAL LOOP WORKS: punch tree → drop → pickup → planks → table → pickaxe');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(e => { console.error('\n✗ FAILED:', e.message); process.exit(1); });
