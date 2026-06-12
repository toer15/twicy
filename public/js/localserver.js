// Offline mode: an in-browser "server" speaking the exact same protocol as
// server/server.js, with worlds persisted to localStorage. Used automatically
// when no real server is reachable (static hosting, GitHub Pages, file://).
'use strict';

const LocalStore = {
  mem: new Map(),
  usable: (() => {
    try {
      localStorage.setItem('twicy.probe', '1');
      localStorage.removeItem('twicy.probe');
      return true;
    } catch (e) { return false; }
  })(),
  get(k) {
    if (!this.usable) return this.mem.get(k) || null;
    return localStorage.getItem(k);
  },
  set(k, v) {
    if (!this.usable) { this.mem.set(k, v); return true; }
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  },
  remove(k) {
    if (!this.usable) { this.mem.delete(k); return; }
    try { localStorage.removeItem(k); } catch (e) {}
  },
  keys() {
    if (!this.usable) return [...this.mem.keys()];
    const out = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
    return out;
  },
};

const LS_WORLD_PREFIX = 'twicy.world.';

class LocalServer {
  constructor(emit) {
    // async delivery mirrors real network timing (handlers register after send)
    this.emit = msg => setTimeout(() => emit(msg), 0);
    this.name = 'Player';
    this.skin = 'explorer';
    this.world = null;        // loaded world object (the save format itself)
    this.dirty = false;
    this.tickTimer = null;
    this.flushTimer = null;
    this.warnedQuota = false;
    this._beforeUnload = () => this.flush();
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this._beforeUnload);
  }

  handle(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    const h = this['_' + msg.t];
    if (h) {
      try { h.call(this, msg); } catch (e) {
        if (typeof console !== 'undefined') console.error('local server error', msg.t, e);
      }
    }
  }

  close() {
    this.flush();
    this._stopTimers();
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this._beforeUnload);
  }

  _stopTimers() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
  }

  // ---- persistence ----

  _read(id) {
    try {
      const raw = LocalStore.get(LS_WORLD_PREFIX + id);
      const w = raw ? JSON.parse(raw) : null;
      return w && w.id === id ? w : null;
    } catch (e) { return null; }
  }

  flush() {
    if (!this.world || !this.dirty) return;
    const ok = LocalStore.set(LS_WORLD_PREFIX + this.world.id, JSON.stringify(this.world));
    if (ok) this.dirty = false;
    else if (!this.warnedQuota) {
      this.warnedQuota = true;
      this.emit({ t: 'chat', sys: true, text: '⚠ Browser storage is full — this world can no longer be saved!' });
    }
  }

  _markDirty() {
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 2000);
    }
  }

  // ---- protocol handlers (same wire format as server/server.js) ----

  _hello(m) {
    this.name = String(m.name || 'Player').replace(/[^\w\- ]/g, '').slice(0, 16) || 'Player';
    this.skin = String(m.skin || 'explorer').slice(0, 24);
    this.emit({ t: 'hello', ok: true, name: this.name, motd: 'Offline mode — worlds are saved in this browser' });
  }

  _worlds() {
    const list = [];
    for (const k of LocalStore.keys()) {
      if (!k || !k.startsWith(LS_WORLD_PREFIX)) continue;
      const w = this._read(k.slice(LS_WORLD_PREFIX.length));
      if (w) {
        list.push({ id: w.id, name: w.name, seed: w.seed, mode: w.mode,
          lastPlayed: w.lastPlayed, players: this.world && this.world.id === w.id ? 1 : 0 });
      }
    }
    list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    this.emit({ t: 'worlds', list });
  }

  _create(m) {
    const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const w = {
      id,
      name: String(m.name || 'New World').slice(0, 28).trim() || 'New World',
      seed: String(m.seed || Date.now()).slice(0, 28),
      mode: m.mode === 'creative' ? 'creative' : 'survival',
      created: Date.now(), lastPlayed: Date.now(),
      time: 90, edits: {}, players: {},
    };
    if (!LocalStore.set(LS_WORLD_PREFIX + id, JSON.stringify(w))) {
      this.emit({ t: 'err', for: 'created', msg: 'Browser storage is full' });
      return;
    }
    this.emit({ t: 'created', id });
  }

  _delete(m) {
    const id = String(m.id || '');
    if (this.world && this.world.id === id) {
      this._stopTimers();
      this.world = null;
    }
    LocalStore.remove(LS_WORLD_PREFIX + id);
    this.emit({ t: 'deleted', id });
  }

  _join(m) {
    const w = this._read(String(m.id || ''));
    if (!w) return this.emit({ t: 'err', for: 'world', msg: 'World not found' });
    if (this.world) this._leave();
    this.world = w;
    w.edits = w.edits || {};
    w.players = w.players || {};
    if (typeof w.time !== 'number') w.time = 90;
    w.lastPlayed = Date.now();
    this._markDirty();
    this.emit({
      t: 'world',
      id: w.id, name: w.name, seed: w.seed, mode: w.mode,
      time: w.time, edits: w.edits, players: [],
      you: w.players[this.name] || null,
    });
    // world clock keeps running like on the real server
    this.tickTimer = setInterval(() => {
      if (!this.world) return;
      this.world.time = (this.world.time + 1) % 600;
      this._tickCount = (this._tickCount || 0) + 1;
      if (this._tickCount % 10 === 0) this.emit({ t: 'time', time: this.world.time });
      if (this._tickCount % 15 === 0) this.flush();
      this.dirty = true;
    }, 1000);
  }

  _leave() {
    this._stopTimers();
    this.flush();
    this.world = null;
  }

  _set(m) {
    const w = this.world;
    if (!w) return;
    const x = m.x | 0, y = m.y | 0, z = m.z | 0, id = m.id | 0;
    if (y < 0 || y >= WORLD_H || Math.abs(x) > 1e6 || Math.abs(z) > 1e6) return;
    w.edits[`${x},${y},${z}`] = id;
    this._markDirty();
  }

  _state() { /* nobody else to relay to */ }

  _pdata(m) {
    const w = this.world;
    if (!w) return;
    const pd = w.players[this.name] || {};
    if (Array.isArray(m.pos) && m.pos.length === 3) pd.pos = m.pos.map(Number);
    if (typeof m.yaw === 'number') pd.yaw = m.yaw;
    if (typeof m.pitch === 'number') pd.pitch = m.pitch;
    if (Array.isArray(m.inv) && m.inv.length <= 40) pd.inv = m.inv;
    if (typeof m.health === 'number') pd.health = Math.max(0, Math.min(20, m.health));
    if (m.gamemode === 'survival' || m.gamemode === 'creative') pd.gamemode = m.gamemode;
    w.players[this.name] = pd;
    this._markDirty();
  }

  _chat(m) {
    const w = this.world;
    if (!w) return;
    const text = String(m.text || '').slice(0, 200).trim();
    if (!text) return;
    if (!text.startsWith('/')) {
      this.emit({ t: 'chat', from: this.name, text });
      return;
    }
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'gamemode': case 'gm': {
        let mode = (args[0] || '').toLowerCase();
        if (mode === 'c' || mode === '1') mode = 'creative';
        if (mode === 's' || mode === '0') mode = 'survival';
        if (mode !== 'survival' && mode !== 'creative') {
          return this.emit({ t: 'chat', sys: true, text: 'Usage: /gamemode survival|creative' });
        }
        const pd = w.players[this.name] || {};
        pd.gamemode = mode;
        w.players[this.name] = pd;
        this._markDirty();
        this.emit({ t: 'gamemode', mode });
        break;
      }
      case 'time': {
        const arg = (args[0] || '').toLowerCase();
        if (arg === 'day') w.time = 90;
        else if (arg === 'night') w.time = 340;
        else if (!isNaN(parseFloat(arg))) w.time = Math.abs(parseFloat(arg)) % 600;
        else return this.emit({ t: 'chat', sys: true, text: 'Usage: /time day|night|<0-600>' });
        this._markDirty();
        this.emit({ t: 'time', time: w.time });
        break;
      }
      case 'players': case 'list':
        this.emit({ t: 'chat', sys: true, text: `Online (1): ${this.name} — offline mode, run the server for multiplayer` });
        break;
      case 'help':
        this.emit({ t: 'chat', sys: true, text: 'Commands: /gamemode survival|creative, /time day|night, /players' });
        break;
      default:
        this.emit({ t: 'chat', sys: true, text: `Unknown command: /${cmd}` });
    }
  }
}
