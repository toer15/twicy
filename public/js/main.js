// Game orchestration: boot, menus<->game state machine, the game loop itself.
'use strict';

/* global Menu, Net, World, Player, RemotePlayers, Renderer, HUD, Inventory, InventoryUI */

const App = {
  net: new Net(),
  netAddress: null,      // address we're currently connected to (null = none)
  renderer: null,
  playerMeshes: null,
  skinTextures: new Map(),
  heldMeshCache: new Map(),
  menu: null,
  game: null,
  pending: new Map(),    // request type -> {resolve, reject, timer}

  settings: loadJSON('twicy.settings', { ...DEFAULT_SETTINGS }),
  profile: loadJSON('twicy.profile', { name: 'Player' + ((Math.random() * 900 + 100) | 0), skin: 'explorer' }),
};
if (typeof window !== 'undefined') window.App = App; // console debugging

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? Object.assign({}, fallback, v) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

// ---------- networking helpers ----------

async function ensureConnected(address) {
  const addr = address || '';
  if (App.net.connected && App.netAddress === addr) return;
  // '' means "this game's own server" — when there is none (static hosting,
  // GitHub Pages, file://), fall back to offline mode transparently
  if (addr === '' && App.net.connected && App.netAddress === '@local') return;
  App.net.close();
  if (addr === '') {
    const httpPage = location.protocol === 'http:' || location.protocol === 'https:';
    if (httpPage) {
      try {
        await App.net.connect('', 3500);
        App.netAddress = '';
        await sayHello();
        return;
      } catch (e) { App.net.close(); }
    }
    await App.net.connect('@local');
    App.netAddress = '@local';
    await sayHello();
    return;
  }
  await App.net.connect(addr);
  App.netAddress = addr;
  await sayHello();
}

async function sayHello() {
  App.net.send({ t: 'hello', name: App.profile.name, skin: App.profile.skin, v: GAME_VERSION });
  await waitFor('hello', 5000);
}

function waitFor(type, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const old = App.pending.get(type);
    if (old) { clearTimeout(old.timer); old.reject(new Error('superseded')); }
    const timer = setTimeout(() => {
      App.pending.delete(type);
      reject(new Error('Server did not respond'));
    }, timeoutMs);
    App.pending.set(type, { resolve, reject, timer });
  });
}

function resolvePending(type, msg) {
  const p = App.pending.get(type);
  if (!p) return false;
  App.pending.delete(type);
  clearTimeout(p.timer);
  p.resolve(msg);
  return true;
}

function setupNetHandlers() {
  const n = App.net;
  n.on('hello', m => resolvePending('hello', m));
  n.on('worlds', m => resolvePending('worlds', m.list || []));
  n.on('created', m => resolvePending('created', m.id));
  n.on('deleted', m => resolvePending('deleted', m.id));
  n.on('world', m => resolvePending('world', m));
  n.on('err', m => {
    const p = m.for && App.pending.get(m.for);
    if (p) {
      App.pending.delete(m.for);
      clearTimeout(p.timer);
      p.reject(new Error(m.msg || 'Server error'));
    } else if (App.game) {
      HUD.addChat(null, '⚠ ' + (m.msg || 'Server error'), true);
    }
  });
  n.on('disconnect', () => {
    App.netAddress = null;
    if (App.game) {
      endGame();
      App.menu.toast('Disconnected from server');
    }
  });
  // in-game messages
  n.on('set', m => App.game && App.game.onBlockSet(m));
  n.on('state', m => App.game && App.game.remotes.onState(m, performance.now() / 1000));
  n.on('join', m => App.game && App.game.onPlayerJoin(m));
  n.on('leave', m => App.game && App.game.onPlayerLeave(m));
  n.on('chat', m => App.game && HUD.addChat(m.from, m.text, !!m.sys));
  n.on('time', m => App.game && App.game.syncTime(m.time));
  n.on('gamemode', m => App.game && App.game.setGamemode(m.mode));
}

// ---------- boot ----------

window.addEventListener('DOMContentLoaded', () => {
  setupNetHandlers();
  HUD.init();
  Sfx.enabled = App.settings.sound;
  // make the auto-generated name stable so per-player world data survives reloads
  saveJSON('twicy.profile', App.profile);

  App.menu = new Menu({
    isOffline: () => App.netAddress === '@local',
    getProfile: () => App.profile,
    setProfile: p => {
      App.profile = p;
      saveJSON('twicy.profile', p);
      App.net.close(); // reconnect with new identity on next action
      App.netAddress = null;
    },
    listWorlds: async addr => {
      await ensureConnected(addr !== undefined ? addr : App.menu.address);
      App.net.send({ t: 'worlds' });
      return waitFor('worlds', 5000);
    },
    createWorld: async o => {
      await ensureConnected(App.menu.address);
      App.net.send({ t: 'create', name: o.name, seed: o.seed, mode: o.mode });
      return waitFor('created', 5000);
    },
    deleteWorld: async id => {
      await ensureConnected(App.menu.address);
      App.net.send({ t: 'delete', id });
      return waitFor('deleted', 5000);
    },
    joinWorld: async id => {
      await ensureConnected(App.menu.address);
      showLoading('Loading world…');
      try {
        App.net.send({ t: 'join', id });
        const msg = await waitFor('world', 10000);
        await startGame(msg);
      } catch (e) {
        hideLoading();
        throw e;
      }
    },
  });

  document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });
  App.menu.show('title');
});

function showLoading(text, pct) {
  const el = document.getElementById('loading');
  el.classList.remove('hidden');
  el.querySelector('.loading-text').textContent = text + (pct !== undefined ? ` ${pct | 0}%` : '');
}
function hideLoading() { document.getElementById('loading').classList.add('hidden'); }

function getSkinTexture(skinId) {
  let tex = App.skinTextures.get(skinId);
  if (!tex) {
    tex = App.renderer.textureFromCanvas(buildSkinCanvas(skinId), true, false);
    App.skinTextures.set(skinId, tex);
  }
  return tex;
}

// mesh for the block held in hand (cached per block id)
function getHeldMesh(id) {
  let m = App.heldMeshCache.get(id);
  if (!m) {
    const def = BLOCKS[id];
    const verts = def.cross
      ? makeCubeVerts(1, 1, 0.02, f => (f === 4 || f === 5) ? tileUV(blockTile(id, 0)) : null, 1)
      : makeCubeVerts(1, 1, 1, f => tileUV(blockTile(id, f)), 1);
    m = App.renderer.makeMesh(verts);
    App.heldMeshCache.set(id, m);
  }
  return m;
}

// ---------- game ----------

async function startGame(worldMsg) {
  if (!App.renderer) {
    App.renderer = new Renderer(document.getElementById('game'));
    App.playerMeshes = buildPlayerMeshes(App.renderer);
  }
  App.game = new Game(worldMsg);
  await App.game.prepareSpawn();
  App.menu.hide();
  HUD.show();
  App.game.running = true;
  hideLoading();
  App.game.showLockOverlay(true);
  requestAnimationFrame(ts => App.game && App.game.frame(ts));
}

function endGame(silent) {
  const g = App.game;
  if (!g) return;
  App.game = null;
  g.shutdown(silent);
  HUD.hide();
  hideLoading();
  document.exitPointerLock && document.exitPointerLock();
  for (const key of [...App.renderer.chunkMeshes.keys()]) App.renderer.dropChunk(key);
  App.menu.show('title');
}

class Game {
  constructor(msg) {
    this.worldId = msg.id;
    this.worldName = msg.name;
    this.worldMode = msg.mode;
    this.world = new World(String(msg.seed));
    if (msg.edits) this.world.applyEditsObject(msg.edits);
    this.time = msg.time || 90; // morning
    this.running = false;

    this.player = new Player(this.world, msg.mode);
    this.inv = new Inventory();
    this.remotes = new RemotePlayers();
    for (const p of msg.players || []) this.remotes.add(p);

    // restore per-player data saved on the server
    const you = msg.you;
    if (you) {
      if (Array.isArray(you.inv)) this.inv.load(you.inv);
      if (you.gamemode && (you.gamemode === 'survival' || you.gamemode === 'creative')) {
        this.player.mode = you.gamemode;
      }
      if (typeof you.health === 'number') this.player.health = clamp(you.health, 1, 20);
      if (Array.isArray(you.pos)) this.savedPos = you.pos;
      if (typeof you.yaw === 'number') { this.player.yaw = you.yaw; this.player.pitch = you.pitch || 0; }
    }

    this.invUI = new InventoryUI(this.inv, () => {
      HUD.updateHotbar(this.inv);
      this.invDirty = true;
    });
    this.invUI.setCreative(this.player.mode === 'creative');

    this.input = { f: 0, b: 0, l: 0, r: 0, jump: 0, down: 0, sprint: 0, sneak: 0 };
    this.mouse = { left: false, right: false };
    this.breaking = null;     // {x,y,z,progress,hardness}
    this.placeTimer = 0;
    this.breakTimer = 0;
    this.swingAnim = -1;      // first-person swing progress 0..1
    this.swingFlag = false;   // send to server with next state
    this.thirdPerson = false;
    this.debugOn = false;
    this.paused = false;
    this.lastSent = {};
    this.sendTimer = 0;
    this.pdataTimer = 0;
    this.lastKey = { space: 0, w: 0 };
    this.fpsSmooth = 60;
    this.lastTs = 0;
    this.unloadTimer = 0;
    this.ownTag = null;

    this._bindEvents();
    HUD.updateHotbar(this.inv);
    HUD.setHealth(this.player.health);
    HUD.setHealthVisible(this.player.mode === 'survival');
    HUD.addChat(null, `Joined "${this.worldName}" (${this.worldMode})`, true);
    HUD.addChat(null, 'Press T to chat, /help for commands', true);

    this.player.onDamage = () => {
      HUD.flash();
      HUD.setHealth(this.player.health);
      this.invDirty = true;
    };
    this.player.onDeath = () => this.showDeath(true);
  }

  // generate spawn area before dropping the player in
  async prepareSpawn() {
    const spawn = this.world.gen.findSpawn();
    this.player.spawn = spawn;
    const start = this.savedPos && this.savedPos.length === 3 ? this.savedPos.slice() : spawn.slice();
    const cx = Math.floor(start[0] / CHUNK), cz = Math.floor(start[2] / CHUNK);
    let done = 0;
    const total = 25;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.world.ensureChunk(cx + dx, cz + dz);
        done++;
        if (done % 5 === 0) {
          showLoading('Generating terrain…', (done / total) * 100);
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }
    if (!this.savedPos) {
      const gy = this.world.findGroundY(start[0], start[2]);
      if (gy > 0) start[1] = gy + 1;
      this.player.spawn = start.slice();
    }
    this.player.teleport(start);
    this.player._unstick();
  }

  // ---------- events ----------

  _bindEvents() {
    this._handlers = [];
    const on = (target, ev, fn, opts) => {
      target.addEventListener(ev, fn, opts);
      this._handlers.push([target, ev, fn]);
    };
    const canvas = document.getElementById('game');

    on(document, 'keydown', e => this._keydown(e));
    on(document, 'keyup', e => this._keyup(e));
    on(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.running && !this.invUI.openState && !HUD.chatOpen && !this.player.dead && !this._quitting) {
        this.setPaused(true);
      }
      if (locked) this.showLockOverlay(false);
    });
    on(document, 'mousemove', e => {
      if (document.pointerLockElement !== canvas) return;
      const s = 0.0023 * App.settings.sensitivity;
      this.player.yaw -= e.movementX * s;
      this.player.pitch = clamp(this.player.pitch - e.movementY * s, -1.567, 1.567);
    });
    on(canvas, 'mousedown', e => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) { this.mouse.left = true; this.onLeftDown(); }
      else if (e.button === 2) { this.mouse.right = true; this.placeTimer = 0; this.tryPlace(); }
      else if (e.button === 1) { e.preventDefault(); this.pickBlock(); }
    });
    on(document, 'mouseup', e => {
      if (e.button === 0) { this.mouse.left = false; this.breaking = null; }
      if (e.button === 2) this.mouse.right = false;
    });
    on(document, 'wheel', e => {
      if (document.pointerLockElement !== canvas) return;
      const d = e.deltaY > 0 ? 1 : -1;
      this.inv.selected = (this.inv.selected + d + 9) % 9;
      this.onHotbarChange();
    }, { passive: true });
    on(window, 'contextmenu', e => {
      if (this.running) e.preventDefault();
    });
    on(document.getElementById('lock-overlay'), 'click', () => this.lockPointer());
    on(document.getElementById('chat-input'), 'keydown', e => this._chatKey(e));

    // pause menu buttons
    on(document.getElementById('pause-resume'), 'click', () => { Sfx.click(); this.setPaused(false); this.lockPointer(); });
    on(document.getElementById('pause-quit'), 'click', () => { Sfx.click(); this.quitToTitle(); });
    on(document.getElementById('death-respawn'), 'click', () => {
      Sfx.click();
      this.player.respawn();
      HUD.setHealth(this.player.health);
      this.showDeath(false);
      this.lockPointer();
    });
    on(document.getElementById('death-quit'), 'click', () => { Sfx.click(); this.quitToTitle(); });
    this._bindOptions();
  }

  _bindOptions() {
    const bind = (id, key, fmt) => {
      const el = document.getElementById(id);
      const lab = document.getElementById(id + '-val');
      el.value = App.settings[key];
      if (lab) lab.textContent = fmt ? fmt(App.settings[key]) : App.settings[key];
      const fn = () => {
        App.settings[key] = parseFloat(el.value);
        if (lab) lab.textContent = fmt ? fmt(App.settings[key]) : App.settings[key];
        saveJSON('twicy.settings', App.settings);
      };
      el.addEventListener('input', fn);
      this._handlers.push([el, 'input', fn]);
    };
    bind('opt-dist', 'renderDist');
    bind('opt-fov', 'fov');
    bind('opt-sens', 'sensitivity', v => v.toFixed(1));
    const bob = document.getElementById('opt-bob');
    const snd = document.getElementById('opt-sound');
    bob.checked = App.settings.viewBob;
    snd.checked = App.settings.sound;
    const bobFn = () => { App.settings.viewBob = bob.checked; saveJSON('twicy.settings', App.settings); };
    const sndFn = () => { App.settings.sound = snd.checked; Sfx.enabled = snd.checked; saveJSON('twicy.settings', App.settings); };
    bob.addEventListener('change', bobFn);
    snd.addEventListener('change', sndFn);
    this._handlers.push([bob, 'change', bobFn], [snd, 'change', sndFn]);
  }

  _unbindEvents() {
    for (const [t, ev, fn] of this._handlers) t.removeEventListener(ev, fn);
    this._handlers = [];
  }

  lockPointer() {
    const canvas = document.getElementById('game');
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  }

  showLockOverlay(show) {
    document.getElementById('lock-overlay').classList.toggle('hidden', !show);
  }

  _keydown(e) {
    if (!this.running) return;
    if (HUD.chatOpen) return; // chat input handles its own keys
    const k = e.code;

    if (k === 'Escape') {
      if (this.invUI.openState) { this.invUI.close(); this.lockPointer(); }
      else {
        const p = !this.paused;
        this.setPaused(p);
        if (!p) this.lockPointer();
      }
      return;
    }
    if (this.paused || this.player.dead) return;

    if (k === 'KeyE') {
      e.preventDefault();
      this.invUI.toggle();
      if (this.invUI.openState) document.exitPointerLock();
      else this.lockPointer();
      return;
    }
    if (this.invUI.openState) return;

    switch (k) {
      case 'KeyW': {
        const now = performance.now();
        if (now - this.lastKey.w < 280 && !this.input.f) this.input.sprint = 1;
        this.lastKey.w = now;
        this.input.f = 1;
        break;
      }
      case 'KeyS': this.input.b = 1; break;
      case 'KeyA': this.input.l = 1; break;
      case 'KeyD': this.input.r = 1; break;
      case 'Space': {
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastKey.space < 280 && this.player.mode === 'creative') {
          this.player.toggleFly();
          Sfx.pop();
          this.lastKey.space = 0;
        } else {
          this.lastKey.space = now;
        }
        this.input.jump = 1;
        break;
      }
      case 'ShiftLeft': case 'ShiftRight': this.input.sneak = 1; this.input.down = 1; break;
      case 'ControlLeft': this.input.sprint = 1; break;
      case 'KeyT': e.preventDefault(); document.exitPointerLock(); HUD.openChat(); break;
      case 'Slash': e.preventDefault(); document.exitPointerLock(); HUD.openChat('/'); break;
      case 'Tab': e.preventDefault(); this._updateTablist(true); break;
      case 'F3': e.preventDefault(); this.debugOn = !this.debugOn; if (!this.debugOn) HUD.setDebug(null); break;
      case 'F5': e.preventDefault(); this.thirdPerson = !this.thirdPerson; break;
      default:
        if (/^Digit[1-9]$/.test(k)) {
          this.inv.selected = parseInt(k.slice(5)) - 1;
          this.onHotbarChange();
        }
    }
  }

  _keyup(e) {
    switch (e.code) {
      case 'KeyW': this.input.f = 0; this.input.sprint = 0; break;
      case 'KeyS': this.input.b = 0; break;
      case 'KeyA': this.input.l = 0; break;
      case 'KeyD': this.input.r = 0; break;
      case 'Space': this.input.jump = 0; break;
      case 'ShiftLeft': case 'ShiftRight': this.input.sneak = 0; this.input.down = 0; break;
      case 'ControlLeft': if (!this.input.f) this.input.sprint = 0; break;
      case 'Tab': this._updateTablist(false); break;
    }
  }

  _chatKey(e) {
    e.stopPropagation();
    if (e.code === 'Enter') {
      const inp = document.getElementById('chat-input');
      const text = inp.value.trim();
      if (text) App.net.send({ t: 'chat', text: text.slice(0, 200) });
      HUD.closeChat();
      this.lockPointer();
    } else if (e.code === 'Escape') {
      HUD.closeChat();
      this.lockPointer();
    }
  }

  _updateTablist(show) {
    if (!show) { HUD.setTablist(null); return; }
    const names = [App.profile.name + ' (you)'];
    for (const rp of this.remotes.map.values()) names.push(rp.name);
    HUD.setTablist(names);
  }

  onHotbarChange() {
    HUD.updateHotbar(this.inv);
    const s = this.inv.getSelected();
    if (s) HUD.showItemName(BLOCKS[s.id].name);
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) {
      document.exitPointerLock();
      this.input = { f: 0, b: 0, l: 0, r: 0, jump: 0, down: 0, sprint: 0, sneak: 0 };
      this.mouse.left = this.mouse.right = false;
      this.breaking = null;
      this.sendPData();
    }
  }

  showDeath(show) {
    document.getElementById('death').classList.toggle('hidden', !show);
    if (show) document.exitPointerLock();
  }

  setGamemode(mode) {
    this.player.setMode(mode);
    this.invUI.setCreative(mode === 'creative');
    if (this.invUI.openState) this.invUI.open(); // rebuild
    HUD.setHealthVisible(mode === 'survival');
    HUD.setHealth(this.player.health);
    HUD.addChat(null, 'Gamemode set to ' + mode, true);
    this.invDirty = true;
  }

  syncTime(t) {
    if (Math.abs(t - this.time) > 3) this.time = t;
  }

  // ---------- net events ----------

  onBlockSet(m) {
    this.world.setBlock(m.x, m.y, m.z, m.id, true);
    if (m.id === BL.AIR) Sfx.dig(); else Sfx.place();
    // cancel local breaking if someone else broke it
    if (this.breaking && this.breaking.x === m.x && this.breaking.y === m.y && this.breaking.z === m.z) {
      this.breaking = null;
    }
  }

  onPlayerJoin(m) {
    this.remotes.add(m);
    HUD.addChat(null, `${m.name} joined the world`, true);
    Sfx.pop();
  }

  onPlayerLeave(m) {
    const rp = this.remotes.get(m.id);
    if (rp) HUD.addChat(null, `${rp.name} left the world`, true);
    this.remotes.remove(m.id);
  }

  // ---------- block interaction ----------

  rayTarget() {
    const cam = this.player.camera(false);
    const dir = dirFromAngles(this.player.yaw, this.player.pitch);
    return raycastVoxels(cam.pos, dir, REACH, (x, y, z) => {
      const id = this.world.getBlock(x, y, z);
      const d = BLOCKS[id];
      return id !== BL.AIR && d && !d.fluid;
    });
  }

  onLeftDown() {
    this.startSwing();
    const t = this.rayTarget();
    if (!t) return;
    if (this.player.mode === 'creative') {
      this.breakBlockAt(t.x, t.y, t.z);
      this.breakTimer = 0.24;
    } else {
      this.breaking = null; // tickBreaking picks it up
    }
  }

  breakBlockAt(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (id === BL.AIR) return;
    const def = BLOCKS[id];
    if (def.hardness < 0) return; // bedrock
    this.world.setBlock(x, y, z, BL.AIR, true);
    App.net.send({ t: 'set', x, y, z, id: BL.AIR });
    Sfx.breakBlock();
    if (this.player.mode === 'survival') {
      const drop = blockDrop(id);
      if (drop) {
        this.inv.addItem(drop, 1);
        this.invDirty = true;
        HUD.updateHotbar(this.inv);
        Sfx.pop();
      }
    }
    // breaking the support under a cross plant pops the plant too
    const above = this.world.getBlock(x, y + 1, z);
    if (BLOCKS[above] && BLOCKS[above].cross) {
      this.world.setBlock(x, y + 1, z, BL.AIR, true);
      App.net.send({ t: 'set', x, y: y + 1, z, id: BL.AIR });
    }
  }

  tickBreaking(dt) {
    if (this.player.dead || this.paused) return;
    if (!this.mouse.left) { this.breaking = null; return; }

    if (this.player.mode === 'creative') {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) {
        const t = this.rayTarget();
        if (t) { this.breakBlockAt(t.x, t.y, t.z); this.startSwing(); }
        this.breakTimer = 0.24;
      }
      return;
    }

    const t = this.rayTarget();
    if (!t) { this.breaking = null; return; }
    const id = this.world.getBlock(t.x, t.y, t.z);
    const def = BLOCKS[id];
    if (def.hardness < 0) { this.breaking = null; return; }
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z) {
      this.breaking = { x: t.x, y: t.y, z: t.z, progress: 0, hardness: def.hardness };
    }
    this.breaking.progress += dt / this.breaking.hardness;
    this._digSfxT = (this._digSfxT || 0) + dt;
    if (this._digSfxT > 0.25) { this._digSfxT = 0; Sfx.dig(); this.startSwing(); }
    if (this.breaking.progress >= 1) {
      this.breakBlockAt(t.x, t.y, t.z);
      this.breaking = null;
    }
  }

  tryPlace() {
    if (this.player.dead || this.paused) return;
    const sel = this.inv.getSelected();
    if (!sel) return;
    const id = sel.id;
    const t = this.rayTarget();
    if (!t) return;
    const x = t.x + t.face[0], y = t.y + t.face[1], z = t.z + t.face[2];
    if (y < 0 || y >= WORLD_H) return;
    const cur = this.world.getBlock(x, y, z);
    const curDef = BLOCKS[cur];
    const replaceable = cur === BL.AIR || (curDef && (curDef.fluid || curDef.cross));
    if (!replaceable) return;
    const def = BLOCKS[id];
    // don't place a solid block inside yourself or another player
    if (def.solid) {
      if (this.player.intersectsBlock(x, y, z)) return;
      for (const rp of this.remotes.map.values()) {
        if (x + 1 > rp.pos[0] - 0.3 && x < rp.pos[0] + 0.3 &&
            z + 1 > rp.pos[2] - 0.3 && z < rp.pos[2] + 0.3 &&
            y + 1 > rp.pos[1] && y < rp.pos[1] + 1.8) return;
      }
    }
    // flowers need soil
    if (def.cross) {
      const below = this.world.getBlock(x, y - 1, z);
      if (below !== BL.GRASS && below !== BL.DIRT && below !== BL.SNOW) return;
    }
    if (this.player.mode === 'survival') {
      if (!this.inv.consumeSelected()) return;
      this.invDirty = true;
      HUD.updateHotbar(this.inv);
    }
    this.world.setBlock(x, y, z, id, true);
    App.net.send({ t: 'set', x, y, z, id });
    Sfx.place();
    this.startSwing();
  }

  pickBlock() {
    const t = this.rayTarget();
    if (!t) return;
    const id = this.world.getBlock(t.x, t.y, t.z);
    if (!id) return;
    if (this.player.mode === 'creative') {
      this.inv.slots[this.inv.selected] = { id, count: STACK_MAX };
    } else {
      const i = this.inv.findItem(id);
      if (i < 0) return;
      if (i < 9) this.inv.selected = i;
      else { // swap into current hotbar slot
        const tmp = this.inv.slots[this.inv.selected];
        this.inv.slots[this.inv.selected] = this.inv.slots[i];
        this.inv.slots[i] = tmp;
      }
    }
    this.onHotbarChange();
  }

  startSwing() {
    this.swingAnim = 0;
    this.swingFlag = true;
  }

  // ---------- chunk pipeline ----------

  tickChunks() {
    const dist = App.settings.renderDist;
    const pcx = Math.floor(this.player.pos[0] / CHUNK);
    const pcz = Math.floor(this.player.pos[2] / CHUNK);

    // generate: nearest missing chunk within dist+1
    let genBudget = 2;
    outer:
    for (let r = 0; r <= dist + 1 && genBudget > 0; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (dx * dx + dz * dz > (dist + 1) * (dist + 1) + 2) continue;
          if (!this.world.hasChunk(pcx + dx, pcz + dz)) {
            this.world.ensureChunk(pcx + dx, pcz + dz);
            // remesh already-meshed neighbors that bordered the frontier
            for (const [ndx, ndz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nk = chunkKey(pcx + dx + ndx, pcz + dz + ndz);
              if (App.renderer.chunkMeshes.has(nk)) this.world.dirty.add(nk);
            }
            if (--genBudget <= 0) break outer;
          }
        }
      }
    }

    // mesh: dirty chunks first, then unmeshed within render distance
    let meshBudget = 2;
    for (const key of [...this.world.dirty]) {
      if (meshBudget <= 0) break;
      this.world.dirty.delete(key);
      const [cx, cz] = key.split(',').map(Number);
      if (!this.world.hasChunk(cx, cz)) continue;
      const mesh = meshChunk(this.world, cx, cz);
      if (mesh) { App.renderer.uploadChunk(key, cx, cz, mesh); meshBudget--; }
    }
    if (meshBudget > 0) {
      outer2:
      for (let r = 0; r <= dist && meshBudget > 0; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const cx = pcx + dx, cz = pcz + dz;
            const key = chunkKey(cx, cz);
            if (App.renderer.chunkMeshes.has(key)) continue;
            if (!this.world.hasChunk(cx, cz)) continue;
            // all 8 neighbors must exist so border faces cull correctly
            let ok = true;
            for (let nz = -1; nz <= 1 && ok; nz++)
              for (let nx = -1; nx <= 1 && ok; nx++)
                if (!this.world.hasChunk(cx + nx, cz + nz)) ok = false;
            if (!ok) continue;
            const mesh = meshChunk(this.world, cx, cz);
            if (mesh) {
              App.renderer.uploadChunk(key, cx, cz, mesh);
              if (--meshBudget <= 0) break outer2;
            }
          }
        }
      }
    }

    // unload far chunks occasionally
    this.unloadTimer += 1;
    if (this.unloadTimer > 120) {
      this.unloadTimer = 0;
      const lim = (dist + 3) * (dist + 3);
      for (const key of [...this.world.chunks.keys()]) {
        const [cx, cz] = key.split(',').map(Number);
        const dx = cx - pcx, dz = cz - pcz;
        if (dx * dx + dz * dz > lim) {
          this.world.unloadChunk(cx, cz);
          App.renderer.dropChunk(key);
        }
      }
    }
  }

  // ---------- networking ----------

  sendState(dt) {
    this.sendTimer += dt;
    if (this.sendTimer < 0.1) return;
    this.sendTimer = 0;
    const p = this.player;
    const st = {
      t: 'state',
      p: [round2(p.pos[0]), round2(p.pos[1]), round2(p.pos[2])],
      yaw: round2(p.yaw), pitch: round2(p.pitch),
    };
    if (this.swingFlag) { st.swing = 1; this.swingFlag = false; }
    const sig = st.p.join(',') + st.yaw + ',' + st.pitch + (st.swing || 0);
    if (sig !== this.lastSent.sig || st.swing) {
      this.lastSent.sig = sig;
      App.net.send(st);
    }
  }

  sendPData() {
    if (!App.net.connected) return;
    const p = this.player;
    App.net.send({
      t: 'pdata',
      pos: [round2(p.pos[0]), round2(p.pos[1]), round2(p.pos[2])],
      yaw: round2(p.yaw), pitch: round2(p.pitch),
      inv: this.inv.serialize(),
      health: p.health,
      gamemode: p.mode,
    });
    this.invDirty = false;
  }

  quitToTitle() {
    this._quitting = true;
    this.sendPData();
    App.net.send({ t: 'leave' });
    endGame();
  }

  shutdown() {
    this.running = false;
    this._unbindEvents();
    this.setPausedSilent();
    this.remotes.clear();
  }

  setPausedSilent() {
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('death').classList.add('hidden');
    document.getElementById('inv-screen').classList.add('hidden');
    document.getElementById('lock-overlay').classList.add('hidden');
    HUD.closeChat();
  }

  // ---------- environment ----------

  env() {
    const dayFrac = (this.time % DAY_LENGTH) / DAY_LENGTH;
    const sunAngle = dayFrac * Math.PI * 2; // 0 = sunrise at the east horizon
    const e = Math.sin(sunAngle);
    const B = clamp((e + 0.14) * 3.2, 0, 1);
    const dayLight = 0.22 + 0.78 * B;
    const day = [0.47, 0.66, 0.99], night = [0.012, 0.02, 0.06];
    let sky = [lerp(night[0], day[0], B), lerp(night[1], day[1], B), lerp(night[2], day[2], B)];
    // sunset/sunrise tint
    const sunset = clamp(1 - Math.abs(e) / 0.22, 0, 1) * 0.55;
    sky = [lerp(sky[0], 0.95, sunset * B), lerp(sky[1], 0.45, sunset * B), lerp(sky[2], 0.28, sunset * B)];

    const dist = App.settings.renderDist * CHUNK;
    let env = {
      skyColor: sky,
      fogColor: sky.slice(),
      fogNear: dist * 0.55,
      fogFar: dist * 0.98,
      dayLight,
      sunAngle: sunAngle - Math.PI / 2, // renderer: 0 = overhead
      starAlpha: clamp(-e * 2.4, 0, 1) * 0.95,
    };
    if (this.player.eyesInWater) {
      env.skyColor = [0.06 * dayLight, 0.14 * dayLight, 0.38 * dayLight];
      env.fogColor = env.skyColor.slice();
      env.fogNear = 1;
      env.fogFar = 16;
    }
    return env;
  }

  // ---------- per-frame ----------

  frame(ts) {
    if (!this.running) return;
    const dt = Math.min(0.05, this.lastTs ? (ts - this.lastTs) / 1000 : 0.016);
    this.lastTs = ts;
    this.fpsSmooth = lerp(this.fpsSmooth, 1 / Math.max(dt, 1e-4), 0.05);
    this.time += dt;

    const uiOpen = this.paused || this.invUI.openState || HUD.chatOpen || this.player.dead;
    const input = uiOpen ? { f: 0, b: 0, l: 0, r: 0, jump: 0, down: 0, sprint: 0, sneak: 0 } : this.input;

    this.player.tick(dt, input);
    if (!uiOpen) {
      this.tickBreaking(dt);
      if (this.mouse.right) {
        this.placeTimer -= dt;
        if (this.placeTimer <= 0) { this.tryPlace(); this.placeTimer = 0.22; }
      }
    }
    if (this.swingAnim >= 0) {
      this.swingAnim += dt / 0.27;
      if (this.swingAnim >= 1) this.swingAnim = -1;
    }
    this.remotes.tick(dt, this.time);
    this.tickChunks();
    this.sendState(dt);
    this.pdataTimer += dt;
    if (this.pdataTimer > 4) {
      this.pdataTimer = 0;
      if (this.invDirty || this.player.mode === 'survival') this.sendPData();
    }

    this.render(dt);
    if (this.debugOn) this.updateDebug();
    HUD.setUnderwater(this.player.eyesInWater);
    if (this.player.mode === 'survival') {
      HUD.setHealth(this.player.health);
      HUD.setAir(this.player.air);
    }

    requestAnimationFrame(t2 => App.game === this && this.frame(t2));
  }

  render() {
    const r = App.renderer;
    const env = this.env();
    let cam = this.player.camera(App.settings.viewBob && !this.thirdPerson);

    if (this.thirdPerson) {
      const dir = dirFromAngles(this.player.yaw, this.player.pitch);
      let back = 4;
      const hit = raycastVoxels(cam.pos, [-dir[0], -dir[1], -dir[2]], 4, (x, y, z) => this.world.solidAt(x, y, z));
      if (hit) back = Math.max(0.5, hit.dist - 0.4);
      cam = { pos: [cam.pos[0] - dir[0] * back, cam.pos[1] - dir[1] * back, cam.pos[2] - dir[2] * back], yaw: cam.yaw, pitch: cam.pitch, roll: 0 };
    }

    const fov = App.settings.fov + (this.player.sprinting ? 8 : 0);
    r.beginFrame(cam, fov, env);
    r.drawSky(env.sunAngle, env.starAlpha);
    r.drawChunksSolid(App.settings.renderDist);

    // players
    this.remotes.draw(r, App.playerMeshes, getSkinTexture, this.time);
    if (this.thirdPerson && !this.player.dead) {
      const p = this.player;
      const hSpeed = Math.hypot(p.vel[0], p.vel[2]);
      const parts = playerPartMatrices({
        pos: p.pos, bodyYaw: p.yaw, headYaw: p.yaw, pitch: p.pitch,
        walkPhase: p.bobPhase * 1.15, walkAmp: clamp(hSpeed / 4.3, 0, 1.3),
        swing: this.swingAnim, time: this.time,
      });
      for (const name in parts) r.drawBox(App.playerMeshes[name], parts[name], getSkinTexture(App.profile.skin));
    }

    // selection + crack overlay
    if (!this.player.dead) {
      const t = this.rayTarget();
      if (t) {
        r.drawSelection(t.x, t.y, t.z);
        if (this.breaking && this.breaking.progress > 0.02) {
          r.drawCrack(this.breaking.x, this.breaking.y, this.breaking.z, this.breaking.progress * 10);
        }
      }
    }

    r.drawChunksWater(App.settings.renderDist);
    r.drawClouds(this.time * 0.0006);
    this.remotes.drawNametags(r);
    if (this.thirdPerson) {
      if (!this.ownTag) this.ownTag = r.makeTextTexture(App.profile.name);
      r.drawNametag(this.ownTag, this.player.pos[0], this.player.pos[1] + 2.25, this.player.pos[2]);
    }

    if (!this.thirdPerson && !this.player.dead) this.renderFirstPerson(r);
  }

  renderFirstPerson(r) {
    r.beginViewSpace();
    const sw = this.swingAnim >= 0 ? Math.sin(this.swingAnim * Math.PI) : 0;
    const bob = this.player.bobAmp;
    const bx = Math.cos(this.player.bobPhase) * 0.012 * bob;
    const by = -Math.abs(Math.sin(this.player.bobPhase)) * 0.018 * bob;
    const sel = this.inv.getSelected();

    if (sel) {
      let m = M4.translate(0.42 + bx - sw * 0.1, -0.54 + by - sw * 0.22, -0.78 + sw * 0.06);
      m = M4.mul(m, M4.rotY(Math.PI / 4 + 0.15 + sw * 0.5));
      m = M4.mul(m, M4.rotX(0.1 - sw * 0.9));
      m = M4.mul(m, M4.scale(0.3, 0.3, 0.3));
      r.drawBox(getHeldMesh(sel.id), m, r.atlasTex, { alphaTest: true });
    } else {
      let m = M4.translate(0.5 + bx - sw * 0.12, -0.62 + by - sw * 0.18, -0.7 + sw * 0.05);
      m = M4.mul(m, M4.rotX(1.35 - sw * 1.1));
      m = M4.mul(m, M4.rotY(-0.25 + sw * 0.4));
      m = M4.mul(m, M4.rotZ(0.1));
      // armR mesh is built around its pivot offset
      m = M4.mul(m, M4.translate(-0.1125, -0.6, -0.1125));
      r.drawBox(App.playerMeshes.armR, m, getSkinTexture(App.profile.skin));
    }
    r.endViewSpace();
  }

  updateDebug() {
    const p = this.player;
    const t = this.rayTarget();
    const compass = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'][((Math.round(p.yaw / (Math.PI / 4)) % 8) + 8) % 8];
    const mins = Math.floor((this.time % DAY_LENGTH) / DAY_LENGTH * 24 * 60);
    const clock = `${String(Math.floor(mins / 60) + 6).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`.replace(/^(2[4-9]|3\d)/, m => String(m - 24).padStart(2, '0'));
    HUD.setDebug([
      `${GAME_NAME} ${GAME_VERSION} — ${Math.round(this.fpsSmooth)} fps`,
      `XYZ: ${p.pos[0].toFixed(2)} / ${p.pos[1].toFixed(2)} / ${p.pos[2].toFixed(2)}`,
      `Chunk: ${Math.floor(p.pos[0] / CHUNK)}, ${Math.floor(p.pos[2] / CHUNK)}  Facing: ${compass}`,
      `Biome: ${this.world.gen.biomeAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]))}  Time: ${clock}`,
      `Mode: ${p.mode}${p.flying ? ' (flying)' : ''}${p.onGround ? ' (ground)' : ''}`,
      `Target: ${t ? `${BLOCKS[this.world.getBlock(t.x, t.y, t.z)].name} @ ${t.x},${t.y},${t.z}` : '—'}`,
      `Chunks: ${this.world.chunks.size} loaded, ${App.renderer.chunkMeshes.size} meshed`,
      `Players online: ${this.remotes.count + 1}`,
    ]);
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
