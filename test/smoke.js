// Headless smoke test: loads the browser game-logic files in a Node VM and
// exercises worldgen, world edits, meshing, raycasting and the inventory.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PUB = path.join(__dirname, '..', 'public', 'js');

// minimal browser-ish globals so localserver.js runs headless
const fakeStorage = {
  map: new Map(),
  setItem(k, v) { this.map.set(k, String(v)); },
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; },
  removeItem(k) { this.map.delete(k); },
  key(i) { return [...this.map.keys()][i]; },
  get length() { return this.map.size; },
};
const ctx = vm.createContext({
  console, Math, JSON, Date,
  performance: { now: () => Date.now() },
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: fakeStorage,
  window: { addEventListener() {}, removeEventListener() {} },
});

// only logic files — no DOM/WebGL needed for these
for (const f of ['config.js', 'math.js', 'noise.js', 'textures.js', 'blocks.js', 'items.js', 'weather.js', 'worldgen.js', 'world.js', 'mesher.js', 'inventory.js', 'sound.js', 'player.js', 'entities.js', 'mobs.js', 'particles.js', 'localserver.js']) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  vm.runInContext(src, ctx, { filename: f });
}

function run(code) { return vm.runInContext(code, ctx); }

// ---- worldgen determinism ----
run(`
  const gen1 = createWorldGen('test-seed');
  const gen2 = createWorldGen('test-seed');
  const c1 = gen1.genChunk(0, 0);
  const c2 = gen2.genChunk(0, 0);
  globalThis._same = c1.length === c2.length && c1.every((v, i) => v === c2[i]);
  globalThis._diffSeed = createWorldGen('other-seed').genChunk(0, 0).some((v, i) => v !== c1[i]);
`);
assert.strictEqual(run('_same'), true, 'same seed must generate identical chunks');
assert.strictEqual(run('_diffSeed'), true, 'different seeds must differ');
console.log('✓ worldgen is deterministic per seed');

// ---- terrain sanity ----
run(`
  const w = new World('smoke');
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) w.ensureChunk(cx, cz);
  globalThis.w = w;
  globalThis._spawn = w.gen.findSpawn();
`);
const spawn = run('_spawn');
assert.ok(Array.isArray(spawn) && spawn.length === 3, 'findSpawn returns [x,y,z]');
assert.ok(spawn[1] > 0 && spawn[1] < 96, 'spawn height in world bounds: ' + spawn[1]);
assert.strictEqual(run('w.getBlock(0, 0, 0)'), run('BL.BEDROCK'), 'bedrock at y=0');
assert.strictEqual(run('w.getBlock(3, 95, 3)'), run('BL.AIR'), 'air at top of world');
const ground = run('w.findGroundY(0, 0)');
assert.ok(ground > 3 && ground < 90, 'ground level sane: ' + ground);
console.log('✓ terrain generation sane (spawn', spawn.map(v => Math.round(v)).join(','), '— ground', ground + ')');

// ---- edits & persistence overlay ----
run(`
  w.setBlock(5, 50, 5, BL.BRICK, true);
  globalThis._edit1 = w.getBlock(5, 50, 5);
  // edits must survive chunk unload/regen
  w.unloadChunk(0, 0);
  w.ensureChunk(0, 0);
  globalThis._edit2 = w.getBlock(5, 50, 5);
  // edits arriving for ungenerated chunks apply when generated
  w.applyEditsObject({'100,40,100': BL.GLASS});
  w.ensureChunk(6, 6);
  globalThis._edit3 = w.getBlock(100, 40, 100);
`);
assert.strictEqual(run('_edit1'), run('BL.BRICK'), 'setBlock applies');
assert.strictEqual(run('_edit2'), run('BL.BRICK'), 'edit survives regen');
assert.strictEqual(run('_edit3'), run('BL.GLASS'), 'pending edit applied on generation');
console.log('✓ block edits overlay generation correctly');

// ---- meshing ----
run(`
  const mesh = meshChunk(w, 0, 0);
  globalThis._mesh = { s: mesh.solidVerts, w: mesh.waterVerts, len: mesh.solid.length };
`);
const mesh = run('_mesh');
assert.ok(mesh.s > 100, 'solid mesh has faces: ' + mesh.s);
assert.strictEqual(mesh.len, mesh.s * 6, 'vertex stride is 6 floats');
assert.strictEqual(mesh.s % 3, 0, 'vertex count divisible by 3 (triangles)');
console.log(`✓ mesher produced ${mesh.s} solid verts, ${mesh.w} water verts`);

// ---- raycast ----
run(`
  // stand above ground and look straight down
  const gy = w.findGroundY(2, 2);
  const hit = raycastVoxels([2.5, gy + 3, 2.5], [0, -1, 0], 8, (x, y, z) => w.solidAt(x, y, z));
  globalThis._ray = hit ? { y: hit.y, gy, face: hit.face } : null;
`);
const ray = run('JSON.stringify(_ray)');
const rayObj = JSON.parse(ray);
assert.ok(rayObj, 'raycast hits ground');
assert.strictEqual(rayObj.y, rayObj.gy, 'raycast hits the ground block');
assert.deepStrictEqual(rayObj.face, [0, 1, 0], 'hit face points up');
console.log('✓ voxel raycast works');

// ---- collision ----
run(`
  const gy2 = w.findGroundY(2, 2);
  globalThis._col = {
    inGround: w.boxCollides(2.5, gy2 - 0.5, 2.5, 0.3, 1.8),
    above: w.boxCollides(2.5, gy2 + 1.01, 2.5, 0.3, 1.8),
  };
`);
assert.strictEqual(run('_col.inGround'), true, 'box inside ground collides');
assert.strictEqual(run('_col.above'), false, 'box above ground is free');
console.log('✓ AABB collision works');

// ---- inventory ----
run(`
  const inv = new Inventory();
  const left = inv.addItem(BL.DIRT, 70);
  const ser = inv.serialize();
  const inv2 = new Inventory();
  inv2.load(ser);
  globalThis._inv = {
    left,
    s0: inv.slots[0].count, s1: inv.slots[1].count,
    roundtrip: inv2.slots[0].count === 64 && inv2.slots[1].count === 6,
    consumed: (() => { inv.selected = 1; let n = 0; while (inv.consumeSelected()) n++; return n; })(),
  };
`);
const inv = run('JSON.stringify(_inv)');
const invObj = JSON.parse(inv);
assert.strictEqual(invObj.left, 0, 'all items fit');
assert.strictEqual(invObj.s0, 64, 'first stack capped at 64');
assert.strictEqual(invObj.s1, 6, 'overflow goes to next slot');
assert.ok(invObj.roundtrip, 'serialize/load round-trips');
assert.strictEqual(invObj.consumed, 6, 'consumeSelected drains the stack');
console.log('✓ inventory stacking, serialization, consumption');

// ---- player physics: falling, landing, walking ----
run(`
  Sfx.enabled = false; // no AudioContext in Node
  const pl = new Player(w, 'survival');
  const gy3 = w.findGroundY(4, 4);
  pl.teleport([4.5, gy3 + 6, 4.5]);
  const idle = { f: 0, b: 0, l: 0, r: 0, jump: 0, down: 0, sprint: 0, sneak: 0 };
  for (let i = 0; i < 300; i++) pl.tick(1 / 60, idle);
  globalThis._phys = {
    landedY: pl.pos[1], expect: gy3 + 1, onGround: pl.onGround,
    tookFallDamage: pl.health < 20,
  };
  // walk forward (facing -Z) for 2 seconds
  pl.yaw = 0;
  const before = pl.pos[2];
  for (let i = 0; i < 120; i++) pl.tick(1 / 60, { ...idle, f: 1 });
  globalThis._walk = { moved: before - pl.pos[2], stillAboveGround: pl.pos[1] > 0 };
  // jumping gains height
  const jy = pl.pos[1];
  let peak = jy;
  for (let i = 0; i < 30; i++) { pl.tick(1 / 60, { ...idle, jump: 1 }); peak = Math.max(peak, pl.pos[1]); }
  globalThis._jump = peak - jy;
`);
const phys = JSON.parse(run('JSON.stringify(_phys)'));
assert.ok(Math.abs(phys.landedY - phys.expect) < 0.05, `lands on ground (got ${phys.landedY}, want ~${phys.expect})`);
assert.strictEqual(phys.onGround, true, 'onGround after landing');
assert.ok(phys.tookFallDamage, 'fall from 5 blocks causes damage in survival');
const walk = JSON.parse(run('JSON.stringify(_walk)'));
assert.ok(walk.moved > 4, 'walking moves the player: ' + walk.moved.toFixed(2));
assert.ok(walk.stillAboveGround, 'no falling through the world');
const jump = run('_jump');
assert.ok(jump > 0.9 && jump < 1.6, 'jump height ~1.25 blocks: ' + jump.toFixed(2));
console.log(`✓ physics: landing, fall damage, walking (${walk.moved.toFixed(1)}m), jump (${jump.toFixed(2)}m)`);

// ---- player model animation matrices ----
run(`
  const parts = playerPartMatrices({ pos: [1, 2, 3], bodyYaw: 0.5, headYaw: 0.7, pitch: -0.2,
    walkPhase: 1.2, walkAmp: 1, swing: 0.5, time: 4 });
  globalThis._anim = Object.keys(parts).length === 6 &&
    Object.values(parts).every(m => m.length === 16 && [...m].every(Number.isFinite));
`);
assert.strictEqual(run('_anim'), true, 'player part matrices are finite 4x4s');
console.log('✓ player model animation matrices');

// ---- crafting recipes ----
run(`
  const g2 = size => new Array(size * size).fill(0);
  // 1 log anywhere -> 4 planks (shapeless)
  let g = g2(2); g[3] = BL.LOG;
  const r1 = matchRecipe(g, 2);
  // 2 planks vertical -> sticks
  g = g2(2); g[0] = BL.PLANKS; g[2] = BL.PLANKS;
  const r2 = matchRecipe(g, 2);
  // 2x2 planks -> crafting table
  g = g2(2).fill(BL.PLANKS);
  const r3 = matchRecipe(g, 2);
  // wooden pickaxe in 3x3 (planks across the top, sticks down the middle)
  g = g2(3);
  g[0] = BL.PLANKS; g[1] = BL.PLANKS; g[2] = BL.PLANKS; g[4] = IT.STICK; g[7] = IT.STICK;
  const r4 = matchRecipe(g, 3);
  // mirrored axe must also match
  g = g2(3);
  g[0] = BL.PLANKS; g[1] = BL.PLANKS; g[3] = IT.STICK; g[4] = BL.PLANKS; g[6] = IT.STICK;
  const r5 = matchRecipe(g, 3);
  // garbage must NOT match
  g = g2(3); g[0] = BL.DIRT; g[4] = IT.STICK;
  const r6 = matchRecipe(g, 3);
  globalThis._craft = { r1, r2, r3, r4, r5, r6 };
`);
const craft = JSON.parse(run('JSON.stringify(_craft)'));
assert.deepStrictEqual(craft.r1, { id: run('BL.PLANKS'), count: 4 }, 'log -> 4 planks');
assert.deepStrictEqual(craft.r2, { id: run('IT.STICK'), count: 4 }, '2 planks -> 4 sticks');
assert.deepStrictEqual(craft.r3, { id: run('BL.CRAFTING_TABLE'), count: 1 }, '4 planks -> crafting table');
assert.deepStrictEqual(craft.r4, { id: run('IT.PICK_WOOD'), count: 1 }, 'wooden pickaxe recipe');
assert.deepStrictEqual(craft.r5, { id: run('IT.AXE_WOOD'), count: 1 }, 'mirrored axe recipe');
assert.strictEqual(craft.r6, null, 'nonsense grid matches nothing');
console.log('✓ crafting: planks, sticks, table, tools (incl. mirrored shapes)');

// ---- tool break mechanics ----
run(`
  globalThis._tools = {
    stoneHand: breakInfo(BL.STONE, 0),
    stonePick: breakInfo(BL.STONE, IT.PICK_WOOD),
    logHand: breakInfo(BL.LOG, 0),
    logAxe: breakInfo(BL.LOG, IT.AXE_WOOD),
    dirtShovel: breakInfo(BL.DIRT, IT.SHOVEL_STONE),
    diamondWoodPick: breakInfo(BL.DIAMOND_ORE, IT.PICK_WOOD),
    diamondStonePick: breakInfo(BL.DIAMOND_ORE, IT.PICK_STONE),
    bedrock: breakInfo(BL.BEDROCK, IT.PICK_STONE),
  };
`);
const tools = JSON.parse(run('JSON.stringify(_tools)'));
assert.strictEqual(tools.stoneHand.drop, 0, 'stone by hand drops nothing');
assert.ok(tools.stoneHand.seconds > 7, 'stone by hand is very slow');
assert.strictEqual(tools.stonePick.drop, run('BL.COBBLE'), 'stone + pickaxe drops cobble');
assert.ok(tools.stonePick.seconds < 1, 'pickaxe mines stone fast');
assert.ok(tools.logAxe.seconds < tools.logHand.seconds / 2.5, 'axe chops much faster');
assert.strictEqual(tools.logHand.drop, run('BL.LOG'), 'punching a tree still drops the log');
assert.ok(tools.dirtShovel.seconds < 0.2, 'shovel digs dirt fast');
assert.strictEqual(tools.diamondWoodPick.drop, 0, 'diamond ore needs a stone pickaxe');
assert.strictEqual(tools.diamondStonePick.drop, run('BL.DIAMOND_ORE'), 'stone pickaxe mines diamond');
assert.strictEqual(tools.bedrock.seconds, null, 'bedrock unbreakable (Infinity serializes to null)');
console.log('✓ tool mechanics: pickaxe requirement, axe/shovel speed, ore tiers');

// ---- item drops: physics + magnet pickup ----
run(`
  const dr = new Drops();
  const gy4 = w.findGroundY(6, 6);
  dr.spawn(BL.LOG, 6.5, gy4 + 3, 6.5);
  let picked = null;
  // far away: must just fall and land, not be collected
  for (let i = 0; i < 240; i++) dr.tick(1 / 60, w, [50, 50, 50], id => { picked = id; return true; });
  const landedY = dr.list.length ? dr.list[0].y : -1;
  const farOk = picked === null && dr.list.length === 1 && Math.abs(landedY - (gy4 + 1)) < 0.15;
  // walk close: magnet + pickup
  for (let i = 0; i < 240 && picked === null; i++) dr.tick(1 / 60, w, [6.5, gy4 + 1, 6.5], id => { picked = id; return true; });
  globalThis._drops = { farOk, picked, left: dr.list.length, landedY, gy4 };
`);
const dropsRes = JSON.parse(run('JSON.stringify(_drops)'));
assert.ok(dropsRes.farOk, 'drop falls, lands on ground, ignores far players: ' + JSON.stringify(dropsRes));
assert.strictEqual(dropsRes.picked, run('BL.LOG'), 'nearby player collects the drop');
assert.strictEqual(dropsRes.left, 0, 'drop entity removed after pickup');
console.log('✓ item drops: gravity, landing, magnet pickup');

// ---- items respect stack limits ----
run(`
  const inv3 = new Inventory();
  inv3.addItem(IT.PICK_WOOD, 3);
  globalThis._stk = { a: inv3.slots[0], b: inv3.slots[1], c: inv3.slots[2], max: stackMax(IT.PICK_WOOD) };
`);
const stk = JSON.parse(run('JSON.stringify(_stk)'));
assert.strictEqual(stk.max, 1, 'tools do not stack');
assert.strictEqual(stk.a.count, 1, 'each tool occupies its own slot');
assert.strictEqual(stk.c.count, 1, 'third tool in third slot');
console.log('✓ per-item stack limits (tools = 1)');

// ---- new recipes: swords + armor ----
run(`
  const g3 = new Array(9).fill(0);
  g3[1] = BL.PLANKS; g3[4] = BL.PLANKS; g3[7] = IT.STICK; // sword column
  const sw = matchRecipe(g3, 3);
  const gA = new Array(9).fill(0);
  gA[0]=IT.LEATHER; gA[1]=IT.LEATHER; gA[2]=IT.LEATHER; gA[3]=IT.LEATHER; gA[5]=IT.LEATHER; // helmet
  const helm = matchRecipe(gA, 3);
  globalThis._new = { sw, helm, dmgHand: attackDamage(0), dmgSword: attackDamage(IT.SWORD_STONE) };
`);
const nw = JSON.parse(run('JSON.stringify(_new)'));
assert.deepStrictEqual(nw.sw, { id: run('IT.SWORD_WOOD'), count: 1 }, 'wooden sword recipe');
assert.deepStrictEqual(nw.helm, { id: run('IT.HELMET'), count: 1 }, 'leather cap recipe');
assert.strictEqual(nw.dmgHand, 1, 'fist does 1 damage');
assert.strictEqual(nw.dmgSword, 5, 'stone sword does 5 damage');
console.log('✓ sword + armor recipes, attack damage table');

// ---- armor slots + protection ----
run(`
  const ainv = new Inventory();
  ainv.armor[0] = { id: IT.HELMET, count: 1 };
  ainv.armor[1] = { id: IT.CHESTPLATE, count: 1 };
  globalThis._arm = {
    pts: ainv.armorPoints(),
    ser: ainv.serializeArmor(),
    badLoad: (() => { const i2 = new Inventory(); i2.loadArmor([[IT.BOOTS, 1], 0, 0, 0]); return i2.armor[0]; })(),
  };
`);
const arm = JSON.parse(run('JSON.stringify(_arm)'));
assert.strictEqual(arm.pts, 4, 'helmet(1) + chest(3) = 4 armor points');
assert.deepStrictEqual(arm.ser[0], [run('IT.HELMET'), 1], 'armor serializes');
assert.strictEqual(arm.badLoad, null, 'boots cannot load into the helmet slot');
console.log('✓ armor slots, points, serialization');

// ---- weather: deterministic, bounded, varies over time ----
run(`
  const wA = new Weather('seedX');
  const wB = new Weather('seedX');
  let same = true, any = 0, bad = 0;
  for (let t = 0; t < 4000; t += 37) {
    const a = wA.intensity(t), b = wB.intensity(t);
    if (a !== b) same = false;
    if (a > 0) any++;
    if (a < 0 || a > 1) bad++;
  }
  globalThis._wx = { same, any, bad };
`);
const wx = JSON.parse(run('JSON.stringify(_wx)'));
assert.ok(wx.same, 'weather is deterministic per seed');
assert.ok(wx.any > 0, 'it does rain sometimes');
assert.strictEqual(wx.bad, 0, 'intensity stays in [0,1]');
console.log('✓ weather cycle deterministic (rained in', wx.any, 'of 109 samples)');

// ---- mobs: AI chases, attacks, takes damage, dies with drops ----
run(`
  // flat test arena so AI has predictable ground
  const aw = new World('arena');
  aw.gen.genChunk = function (cx, cz) {
    const d = new Uint8Array(CHUNK * CHUNK * WORLD_H);
    for (let z = 0; z < CHUNK; z++)
      for (let x = 0; x < CHUNK; x++) {
        d[chunkIdx(x, 0, z)] = BL.BEDROCK;
        for (let y = 1; y <= 20; y++) d[chunkIdx(x, y, z)] = BL.STONE;
      }
    return d;
  };
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) aw.ensureChunk(cx, cz);
  let hurt = 0; const mobDrops = [];
  const fakeGame = {
    world: aw,
    player: { dead: false, pos: [2.5, 21, 2.5] },
    remotes: { map: new Map() },
    netSend() {},
    hurtPlayer(d) { hurt += d; },
    applyExplosion() {},
    spawnMobDrop(id) { mobDrops.push(id); },
  };
  const mobs = new Mobs(fakeGame);
  mobs.setSim(true);
  const z = mobs.spawn('zombie', 10.5, 21, 10.5);
  const d0 = dist2d(z.pos[0], z.pos[2], 2.5, 2.5);
  for (let i = 0; i < 600; i++) mobs.tick(1 / 60, 0.1); // night
  const d1 = dist2d(z.pos[0], z.pos[2], 2.5, 2.5);
  globalThis._mob = { d0, d1, hurt, alive: mobs.list.has(z.id) };
  // kill a cow -> leather drops assigned to the killer
  const cow = mobs.spawn('cow', 5.5, 21, 5.5);
  mobs.applyHit(cow.id, 10, 0, 0, 'Tester');
  globalThis._mob.cowDead = cow.hp <= 0 && cow.deathT > 0;
  globalThis._mob.drops = mobDrops.slice();
  // serialize/load roundtrip
  const mobSer = mobs.serialize();
  const mobs2 = new Mobs(fakeGame);
  mobs2.load(mobSer);
  globalThis._mob.reload = mobs2.count() === mobSer.length;
`);
const mob = JSON.parse(run('JSON.stringify(_mob)'));
assert.ok(mob.d1 < mob.d0 - 3, `zombie chased the player: ${mob.d0.toFixed(1)} -> ${mob.d1.toFixed(1)}`);
assert.ok(mob.hurt >= 3, 'zombie attacked the player: ' + mob.hurt + ' dmg');
assert.ok(mob.alive, 'zombie still alive');
assert.ok(mob.cowDead, 'cow died from the hit');
assert.ok(mob.drops.length >= 1, 'cow dropped leather: ' + JSON.stringify(mob.drops));
assert.ok(mob.reload, 'mob serialize/load roundtrip');
console.log(`✓ mobs: chase (${mob.d0.toFixed(0)}m → ${mob.d1.toFixed(0)}m), attack (${mob.hurt} dmg), death drops`);

// ---- block registry consistency ----
run(`
  globalThis._blocks = BLOCKS.every((b, i) => !b || (b.id === i && (b.cross ? !b.solid : true)));
  globalThis._creative = CREATIVE_ITEMS.length;
`);
assert.strictEqual(run('_blocks'), true, 'block registry ids consistent');
assert.ok(run('_creative') > 20, 'creative palette has items');
console.log('✓ block registry consistent,', run('_creative'), 'creative items');

// ---- offline LocalServer: full protocol round-trip ----
(async () => {
  run(`
    globalThis._msgs = [];
    globalThis.ls = new LocalServer(m => _msgs.push(m));
    ls.handle({ t: 'hello', name: 'Solo', skin: 'royal' });
    ls.handle({ t: 'create', name: 'Offline World', seed: 'off1', mode: 'creative' });
  `);
  const flush = () => new Promise(r => setTimeout(r, 20));
  const msgs = () => JSON.parse(run('JSON.stringify(_msgs.splice(0))'));

  await flush();
  let got = msgs();
  assert.strictEqual(got[0].t, 'hello');
  assert.strictEqual(got[0].name, 'Solo');
  const created = got.find(m => m.t === 'created');
  assert.ok(created && created.id, 'world created locally');

  run(`ls.handle({ t: 'worlds' }); ls.handle({ t: 'join', id: '${created.id}' });`);
  await flush();
  got = msgs();
  const list = got.find(m => m.t === 'worlds');
  assert.strictEqual(list.list.length, 1, 'local world listed');
  assert.strictEqual(list.list[0].mode, 'creative');
  const world = got.find(m => m.t === 'world');
  assert.strictEqual(world.seed, 'off1', 'join returns world data');

  run(`
    ls.handle({ t: 'set', x: 7, y: 33, z: -2, id: 9 });
    ls.handle({ t: 'pdata', pos: [7, 35, -2], yaw: 1, pitch: 0, inv: [[9, 3], 0], health: 20, gamemode: 'creative' });
    ls.handle({ t: 'chat', text: '/time night' });
    ls.handle({ t: 'leave' });
  `);
  await flush();
  got = msgs();
  assert.ok(got.find(m => m.t === 'time' && m.time > 300), '/time works offline');

  // saved to (fake) localStorage; a fresh LocalServer must see everything
  run(`
    globalThis._msgs2 = [];
    globalThis.ls2 = new LocalServer(m => _msgs2.push(m));
    ls2.handle({ t: 'hello', name: 'Solo', skin: 'royal' });
    ls2.handle({ t: 'join', id: '${created.id}' });
  `);
  await flush();
  const got2 = JSON.parse(run('JSON.stringify(_msgs2)'));
  const rejoin = got2.find(m => m.t === 'world');
  assert.ok(rejoin, 'rejoin works after leave');
  assert.strictEqual(rejoin.edits['7,33,-2'], 9, 'block edit persisted in browser storage');
  assert.ok(rejoin.time > 300, 'time persisted');
  assert.deepStrictEqual(rejoin.you.inv[0], [9, 3], 'inventory persisted');
  assert.strictEqual(rejoin.you.gamemode, 'creative', 'gamemode persisted');
  run('ls.close(); ls2.close();'); // stop world-clock intervals so Node can exit
  console.log('✓ offline mode: create/join/edit/save/rejoin via localStorage');

  console.log('\nAll smoke tests passed.');
})().catch(e => { console.error('✗ FAILED:', e.message); process.exit(1); });
