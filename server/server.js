#!/usr/bin/env node
// Twicycraft server: static files + multiplayer world hosting + persistence.
// Zero dependencies — run with `node server/server.js` (or `npm start`).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { attachWebSocketServer } = require('./ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = path.join(__dirname, '..', 'public');
const WORLDS_DIR = process.env.WORLDS_DIR || path.join(__dirname, '..', 'worlds');
const MAX_NAME = 16;
const VALID_MODES = new Set(['survival', 'creative']);

fs.mkdirSync(WORLDS_DIR, { recursive: true });

// ---------------- static file serving ----------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const httpServer = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------------- world storage ----------------

// in-memory loaded worlds: id -> {meta, edits, playersData, time, sessions:Set, dirty}
const loaded = new Map();

function worldFile(id) {
  return path.join(WORLDS_DIR, id.replace(/[^a-z0-9_-]/gi, '') + '.json');
}

function listWorldFiles() {
  try {
    return fs.readdirSync(WORLDS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  } catch (e) { return []; }
}

function readWorldMeta(file) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, file), 'utf8'));
    if (!data || !data.id) return null;
    return data;
  } catch (e) { return null; }
}

function canSee(meta, invitedSet, name) {
  if ((meta.visibility || 'private') === 'public') return true;
  if (!meta.owner) return true; // legacy worlds without an owner stay visible
  const k = userKey(name);
  if (userKey(meta.owner) === k) return true;
  return invitedSet && invitedSet.has(k);
}

function listWorlds(forName) {
  const out = [];
  const seen = new Set();
  const push = (meta, players, invitedSet) => {
    if (!canSee(meta, invitedSet, forName)) return;
    out.push({ id: meta.id, name: meta.name, seed: meta.seed, mode: meta.mode,
      lastPlayed: meta.lastPlayed, players,
      owner: meta.owner || '', visibility: meta.visibility || 'private',
      mobs: meta.mobs !== false,
      yours: userKey(meta.owner) === userKey(forName) });
  };
  for (const [id, w] of loaded) {
    push(w.meta, w.sessions.size, w.invited);
    seen.add(id);
  }
  for (const f of listWorldFiles()) {
    const data = readWorldMeta(f);
    if (!data || seen.has(data.id)) continue;
    push({ ...data, mobs: data.mobs !== false, visibility: data.visibility || 'private' },
      0, new Set((data.invited || []).map(userKey)));
  }
  out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return out;
}

function loadWorld(id) {
  if (loaded.has(id)) return loaded.get(id);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(worldFile(id), 'utf8'));
  } catch (e) { return null; }
  if (!data || data.id !== id) return null;
  const w = {
    meta: { id: data.id, name: data.name, seed: data.seed, mode: data.mode,
      created: data.created, lastPlayed: data.lastPlayed,
      owner: data.owner || '', visibility: data.visibility || 'private',
      mobs: data.mobs !== false },
    edits: data.edits || {},
    playersData: data.players || {},
    mobsData: data.mobsData || [],
    invited: new Set((data.invited || []).map(userKey)),
    time: typeof data.time === 'number' ? data.time : 90,
    sessions: new Set(),
    simId: 0,
    dirty: false,
  };
  loaded.set(id, w);
  return w;
}

function saveWorld(w) {
  const out = {
    id: w.meta.id, name: w.meta.name, seed: w.meta.seed, mode: w.meta.mode,
    created: w.meta.created, lastPlayed: w.meta.lastPlayed,
    owner: w.meta.owner, visibility: w.meta.visibility, mobs: w.meta.mobs,
    invited: [...(w.invited || [])],
    mobsData: w.mobsData || [],
    time: Math.round(w.time * 10) / 10,
    edits: w.edits,
    players: w.playersData,
  };
  const file = worldFile(w.meta.id);
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, file);
    w.dirty = false;
  } catch (e) {
    console.error('Failed to save world', w.meta.id, e.message);
  }
}

function unloadIfEmpty(w) {
  if (w.sessions.size === 0) {
    saveWorld(w);
    loaded.delete(w.meta.id);
  }
}

// ---------------- friends (persistent, name-based) ----------------

const FRIENDS_FILE = path.join(WORLDS_DIR, '_friends.json');
let friendsDB = { users: {} };
try { friendsDB = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8')) || { users: {} }; } catch (e) {}
if (!friendsDB.users) friendsDB.users = {};

let friendsSaveTimer = null;
function saveFriends() {
  if (friendsSaveTimer) return;
  friendsSaveTimer = setTimeout(() => {
    friendsSaveTimer = null;
    try { fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friendsDB)); } catch (e) {}
  }, 1500);
}

function userKey(name) { return String(name || '').toLowerCase(); }

function userRec(name, create) {
  const k = userKey(name);
  if (!friendsDB.users[k] && create) {
    friendsDB.users[k] = { name: String(name), friends: [], requests: [] };
    saveFriends();
  }
  return friendsDB.users[k] || null;
}

function findSessionByName(name) {
  const k = userKey(name);
  for (const s of sessions.values()) {
    if (s.helloDone && userKey(s.name) === k) return s;
  }
  return null;
}

function friendInfo(sess) {
  const rec = userRec(sess.name, true);
  const friends = rec.friends.map(k => {
    const r = friendsDB.users[k];
    const online = findSessionByName(k);
    const w = online && online.world;
    return {
      name: r ? r.name : k,
      online: !!online,
      world: w ? (w.meta.visibility === 'public' || (w.invited && w.invited.has(userKey(sess.name))) || userKey(w.meta.owner) === userKey(sess.name)
        ? { id: w.meta.id, name: w.meta.name } : { name: 'a private world' }) : null,
    };
  });
  return { t: 'flist', friends, requests: rec.requests.map(k => (friendsDB.users[k] ? friendsDB.users[k].name : k)) };
}

function pushFriendUpdate(name) {
  const s = findSessionByName(name);
  if (s) send(s, friendInfo(s));
}

function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
    }
  }
  return out;
}

// ---------------- sessions & protocol ----------------

let nextId = 1;
const sessions = new Map(); // id -> session

function send(sess, obj) {
  sess.conn.send(JSON.stringify(obj));
}

function sendErr(sess, forType, msg) {
  send(sess, { t: 'err', for: forType, msg });
}

function broadcast(w, obj, exceptId) {
  const str = JSON.stringify(obj);
  for (const sid of w.sessions) {
    const s = sessions.get(sid);
    if (s && s.id !== exceptId) s.conn.send(str);
  }
}

function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
function clamp01(v, lo, hi) { v = num(v); return v < lo ? lo : v > hi ? hi : v; }

function sanitizeName(name) {
  const clean = String(name || '').replace(/[^\w\- ]/g, '').trim().slice(0, MAX_NAME);
  return clean || 'Player' + ((Math.random() * 900 + 100) | 0);
}

function uniqueName(w, base, selfId) {
  let name = base, n = 2;
  const taken = () => {
    for (const sid of w.sessions) {
      const s = sessions.get(sid);
      if (s && sid !== selfId && s.name === name) return true;
    }
    return false;
  };
  while (taken()) name = `${base.slice(0, MAX_NAME - 3)}(${n++})`;
  return name;
}

function leaveWorld(sess, notify = true) {
  const w = sess.world;
  if (!w) return;
  // persist last known state
  if (sess.lastState && sess.lastState.p) {
    const pd = w.playersData[sess.name] || {};
    pd.pos = sess.lastState.p;
    pd.yaw = sess.lastState.yaw;
    pd.pitch = sess.lastState.pitch;
    w.playersData[sess.name] = pd;
  }
  w.sessions.delete(sess.id);
  w.dirty = true;
  sess.world = null;
  if (notify) {
    broadcast(w, { t: 'leave', id: sess.id });
    broadcast(w, { t: 'chat', sys: true, text: `${sess.name} left the world` });
  }
  // hand the mob simulation to the longest-connected remaining player
  if (w.simId === sess.id && w.sessions.size > 0) {
    w.simId = Math.min(...w.sessions);
    const ns = sessions.get(w.simId);
    if (ns) send(ns, { t: 'sim', you: true });
  }
  unloadIfEmpty(w);
}

const handlers = {
  hello(sess, m) {
    sess.name = sanitizeName(m.name);
    sess.skin = String(m.skin || 'explorer').slice(0, 24);
    sess.helloDone = true;
    userRec(sess.name, true);
    send(sess, { t: 'hello', ok: true, name: sess.name, motd: 'Welcome to Twicycraft!',
      addrs: lanAddresses(), port: PORT });
  },

  worlds(sess) {
    send(sess, { t: 'worlds', list: listWorlds(sess.name) });
  },

  create(sess, m) {
    const name = String(m.name || 'New World').slice(0, 28).trim() || 'New World';
    const seed = String(m.seed || Date.now()).slice(0, 28);
    const mode = VALID_MODES.has(m.mode) ? m.mode : 'survival';
    if (listWorldFiles().length > 200) return sendErr(sess, 'created', 'Too many worlds on this server');
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const w = {
      meta: { id, name, seed, mode, created: Date.now(), lastPlayed: Date.now(),
        owner: sess.name, visibility: m.visibility === 'private' ? 'private' : 'public',
        mobs: m.mobs !== false },
      edits: {},
      playersData: {},
      mobsData: [],
      invited: new Set(),
      time: 90,
      sessions: new Set(),
      simId: 0,
      dirty: true,
    };
    loaded.set(id, w);
    saveWorld(w);
    console.log(`[world] created "${name}" (${mode}, seed ${seed}) by ${sess.name}`);
    send(sess, { t: 'created', id });
  },

  delete(sess, m) {
    const id = String(m.id || '');
    const w = loaded.get(id) || loadWorld(id);
    if (w && w.meta.owner && userKey(w.meta.owner) !== userKey(sess.name)) {
      return sendErr(sess, 'deleted', 'Only the owner can delete this world');
    }
    if (w && w.sessions.size > 0) return sendErr(sess, 'deleted', 'World is in use');
    loaded.delete(id);
    try { fs.unlinkSync(worldFile(id)); } catch (e) {}
    console.log(`[world] deleted ${id} by ${sess.name}`);
    send(sess, { t: 'deleted', id });
  },

  join(sess, m) {
    if (!sess.helloDone) return sendErr(sess, 'world', 'Say hello first');
    const id = String(m.id || '');
    const w = loadWorld(id);
    if (!w) return sendErr(sess, 'world', 'World not found');
    if (!canSee(w.meta, w.invited, sess.name)) return sendErr(sess, 'world', 'This world is private — ask the owner for an invite');
    if (sess.world) leaveWorld(sess);
    if (w.sessions.size >= 32) return sendErr(sess, 'world', 'World is full');

    sess.name = uniqueName(w, sess.name, sess.id);
    sess.world = w;
    sess.lastState = null;
    w.sessions.add(sess.id);
    if (!w.simId || !sessions.has(w.simId) || !w.sessions.has(w.simId)) w.simId = sess.id;
    w.meta.lastPlayed = Date.now();
    w.dirty = true;

    const roster = [];
    for (const sid of w.sessions) {
      if (sid === sess.id) continue;
      const s = sessions.get(sid);
      if (s) roster.push({ id: s.id, name: s.name, skin: s.skin, state: s.lastState });
    }
    send(sess, {
      t: 'world',
      id, name: w.meta.name, seed: w.meta.seed, mode: w.meta.mode,
      owner: w.meta.owner, visibility: w.meta.visibility, mobs: w.meta.mobs,
      sim: w.simId === sess.id,
      mobsData: w.simId === sess.id ? (w.mobsData || []) : [],
      time: w.time,
      edits: w.edits,
      players: roster,
      you: w.playersData[sess.name] || null,
    });
    broadcast(w, { t: 'join', id: sess.id, name: sess.name, skin: sess.skin, state: null }, sess.id);
    broadcast(w, { t: 'chat', sys: true, text: `${sess.name} joined the world` }, sess.id);
    console.log(`[world] ${sess.name} joined "${w.meta.name}" (${w.sessions.size} online)`);
  },

  leave(sess) {
    leaveWorld(sess);
  },

  set(sess, m) {
    const w = sess.world;
    if (!w) return;
    const x = m.x | 0, y = m.y | 0, z = m.z | 0, id = m.id | 0;
    if (y < 0 || y >= 96 || Math.abs(x) > 1e6 || Math.abs(z) > 1e6) return;
    if (id < 0 || id > 64) return;
    // simple rate limit
    const now = Date.now();
    if (now - (sess.setWindow || 0) > 1000) { sess.setWindow = now; sess.setCount = 0; }
    if (++sess.setCount > 80) return;
    w.edits[`${x},${y},${z}`] = id;
    w.dirty = true;
    broadcast(w, { t: 'set', x, y, z, id, by: sess.id }, sess.id);
  },

  state(sess, m) {
    const w = sess.world;
    if (!w) return;
    const st = { t: 'state', id: sess.id };
    if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(v => typeof v === 'number' && isFinite(v))) st.p = m.p;
    if (typeof m.yaw === 'number') st.yaw = m.yaw;
    if (typeof m.pitch === 'number') st.pitch = m.pitch;
    if (m.sn) st.sn = 1;
    if (m.swing) st.swing = 1;
    sess.lastState = { p: st.p, yaw: st.yaw, pitch: st.pitch, sn: st.sn };
    broadcast(w, st, sess.id);
  },

  pdata(sess, m) {
    const w = sess.world;
    if (!w) return;
    const pd = w.playersData[sess.name] || {};
    if (Array.isArray(m.pos) && m.pos.length === 3) pd.pos = m.pos.map(Number);
    if (typeof m.yaw === 'number') pd.yaw = m.yaw;
    if (typeof m.pitch === 'number') pd.pitch = m.pitch;
    if (Array.isArray(m.inv) && m.inv.length <= 40) pd.inv = m.inv;
    if (typeof m.health === 'number') pd.health = Math.max(0, Math.min(20, m.health));
    if (VALID_MODES.has(m.gamemode)) pd.gamemode = m.gamemode;
    w.playersData[sess.name] = pd;
    w.dirty = true;
  },

  // owner toggles world visibility from the pause menu
  setvis(sess, m) {
    const w = sess.world;
    if (!w) return;
    if (userKey(w.meta.owner) !== userKey(sess.name)) return;
    w.meta.visibility = m.vis === 'public' ? 'public' : 'private';
    w.dirty = true;
    broadcast(w, { t: 'vis', vis: w.meta.visibility });
    broadcast(w, { t: 'chat', sys: true, text: `${sess.name} made the world ${w.meta.visibility}` });
  },

  // ---- mob sync: the sim host broadcasts, others send hits back ----
  mobs(sess, m) {
    const w = sess.world;
    if (!w || w.simId !== sess.id || !Array.isArray(m.list)) return;
    if (m.list.length > 64) return;
    const out = { t: 'mobs', list: m.list };
    if (Array.isArray(m.arrows) && m.arrows.length <= 24) out.arrows = m.arrows;
    broadcast(w, out, sess.id);
  },

  mobhit(sess, m) {
    const w = sess.world;
    if (!w) return;
    const sim = sessions.get(w.simId);
    if (sim && sim.id !== sess.id) {
      send(sim, { t: 'mobhit', id: m.id | 0, dmg: clamp01(m.dmg, 0, 10), kx: num(m.kx), kz: num(m.kz), by: sess.name });
    }
  },

  mobatk(sess, m) {
    const w = sess.world;
    if (!w || w.simId !== sess.id) return;
    const target = sessions.get(m.target | 0);
    if (target && target.world === w) {
      send(target, { t: 'mobatk', dmg: clamp01(m.dmg, 0, 10), kx: num(m.kx), kz: num(m.kz) });
    }
  },

  mobdrop(sess, m) {
    const w = sess.world;
    if (!w || w.simId !== sess.id) return;
    const target = findSessionByName(m.owner);
    if (target && target.world === w) {
      send(target, { t: 'mobdrop', id: m.id | 0, x: num(m.x), y: num(m.y), z: num(m.z) });
    }
  },

  mobsave(sess, m) {
    const w = sess.world;
    if (!w || w.simId !== sess.id || !Array.isArray(m.list)) return;
    w.mobsData = m.list.slice(0, 40);
    w.dirty = true;
  },

  // batched block changes (explosions)
  setMany(sess, m) {
    const w = sess.world;
    if (!w || !Array.isArray(m.blocks) || m.blocks.length > 300) return;
    for (const b of m.blocks) {
      if (!Array.isArray(b) || b.length < 4) continue;
      const [x, y, z, id] = b.map(v => v | 0);
      if (y < 0 || y >= 96 || Math.abs(x) > 1e6 || Math.abs(z) > 1e6) continue;
      w.edits[`${x},${y},${z}`] = id;
    }
    w.dirty = true;
    broadcast(w, { t: 'setMany', blocks: m.blocks, boom: m.boom }, sess.id);
  },

  // ---- friends ----
  fsearch(sess, m) {
    const q = userKey(m.q).trim();
    const out = [];
    if (q.length >= 2) {
      const me = userRec(sess.name, true);
      const myKey = userKey(sess.name);
      for (const [k, r] of Object.entries(friendsDB.users)) {
        if (k === myKey || !k.includes(q)) continue;
        out.push({ name: r.name, online: !!findSessionByName(k),
          friend: me.friends.includes(k), requested: (friendsDB.users[k].requests || []).includes(myKey) });
        if (out.length >= 12) break;
      }
    }
    send(sess, { t: 'fsearch', list: out });
  },

  frequest(sess, m) {
    const me = userRec(sess.name, true);
    const target = userRec(m.to, false);
    if (!target) return sendErr(sess, 'fsearch', 'No player with that name has been here');
    const myKey = userKey(sess.name), toKey = userKey(m.to);
    if (toKey === myKey || me.friends.includes(toKey)) return;
    if (!target.requests.includes(myKey)) {
      target.requests.push(myKey);
      saveFriends();
      pushFriendUpdate(toKey);
    }
    send(sess, friendInfo(sess));
  },

  faccept(sess, m) {
    const me = userRec(sess.name, true);
    const fromKey = userKey(m.from);
    if (!me.requests.includes(fromKey)) return;
    me.requests = me.requests.filter(k => k !== fromKey);
    const other = userRec(fromKey, true);
    if (!me.friends.includes(fromKey)) me.friends.push(fromKey);
    if (!other.friends.includes(userKey(sess.name))) other.friends.push(userKey(sess.name));
    saveFriends();
    send(sess, friendInfo(sess));
    pushFriendUpdate(fromKey);
  },

  fdecline(sess, m) {
    const me = userRec(sess.name, true);
    me.requests = me.requests.filter(k => k !== userKey(m.from));
    saveFriends();
    send(sess, friendInfo(sess));
  },

  fremove(sess, m) {
    const me = userRec(sess.name, true);
    const k = userKey(m.name);
    me.friends = me.friends.filter(f => f !== k);
    const other = userRec(k, false);
    if (other) other.friends = other.friends.filter(f => f !== userKey(sess.name));
    saveFriends();
    send(sess, friendInfo(sess));
    pushFriendUpdate(k);
  },

  flist(sess) {
    send(sess, friendInfo(sess));
  },

  // invite a friend to your current world (works for private worlds)
  invite(sess, m) {
    const w = sess.world;
    if (!w) return;
    const me = userRec(sess.name, true);
    const k = userKey(m.to);
    if (!me.friends.includes(k)) return;
    w.invited.add(k);
    w.dirty = true;
    const target = findSessionByName(k);
    if (target) {
      send(target, { t: 'invited', from: sess.name, worldId: w.meta.id, worldName: w.meta.name });
      send(sess, { t: 'chat', sys: true, text: `Invite sent to ${m.to}` });
    } else {
      send(sess, { t: 'chat', sys: true, text: `${m.to} is offline — they can join when they're back (invite saved)` });
    }
  },

  chat(sess, m) {
    const w = sess.world;
    if (!w) return;
    const text = String(m.text || '').slice(0, 200).trim();
    if (!text) return;
    if (text.startsWith('/')) return command(sess, w, text);
    broadcast(w, { t: 'chat', from: sess.name, text });
    console.log(`[chat:${w.meta.name}] <${sess.name}> ${text}`);
  },
};

function command(sess, w, text) {
  const [cmd, ...args] = text.slice(1).split(/\s+/);
  switch (cmd.toLowerCase()) {
    case 'gamemode': case 'gm': {
      let mode = (args[0] || '').toLowerCase();
      if (mode === 'c' || mode === '1') mode = 'creative';
      if (mode === 's' || mode === '0') mode = 'survival';
      if (!VALID_MODES.has(mode)) return send(sess, { t: 'chat', sys: true, text: 'Usage: /gamemode survival|creative' });
      const pd = w.playersData[sess.name] || {};
      pd.gamemode = mode;
      w.playersData[sess.name] = pd;
      w.dirty = true;
      send(sess, { t: 'gamemode', mode });
      break;
    }
    case 'time': {
      const arg = (args[0] || '').toLowerCase();
      if (arg === 'day') w.time = 90;
      else if (arg === 'night') w.time = 340;
      else if (!isNaN(parseFloat(arg))) w.time = Math.abs(parseFloat(arg)) % 600;
      else return send(sess, { t: 'chat', sys: true, text: 'Usage: /time day|night|<0-600>' });
      w.dirty = true;
      broadcast(w, { t: 'time', time: w.time });
      broadcast(w, { t: 'chat', sys: true, text: `${sess.name} set the time` });
      break;
    }
    case 'players': case 'list': {
      const names = [...w.sessions].map(sid => sessions.get(sid)).filter(Boolean).map(s => s.name);
      send(sess, { t: 'chat', sys: true, text: `Online (${names.length}): ${names.join(', ')}` });
      break;
    }
    case 'help':
      send(sess, { t: 'chat', sys: true, text: 'Commands: /gamemode survival|creative, /time day|night, /players' });
      break;
    default:
      send(sess, { t: 'chat', sys: true, text: `Unknown command: /${cmd}` });
  }
}

// ---------------- wire it together ----------------

attachWebSocketServer(httpServer, '/ws', conn => {
  const sess = { id: nextId++, conn, name: 'Player', skin: 'explorer', world: null, helloDone: false, lastState: null };
  sessions.set(sess.id, sess);

  conn.onmessage = str => {
    if (str.length > 256 * 1024) return;
    let msg;
    try { msg = JSON.parse(str); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const h = handlers[msg.t];
    if (h) {
      try { h(sess, msg); } catch (e) { console.error('handler error', msg.t, e); }
    }
  };
  conn.onclose = () => {
    leaveWorld(sess);
    sessions.delete(sess.id);
    // let online friends see this player go offline
    const rec = sess.helloDone && userRec(sess.name, false);
    if (rec) for (const f of rec.friends) pushFriendUpdate(f);
  };
});

// world clock + autosave
setInterval(() => {
  for (const w of loaded.values()) {
    w.time = (w.time + 1) % 600;
  }
}, 1000).unref();

let saveTick = 0;
setInterval(() => {
  saveTick++;
  for (const w of loaded.values()) {
    if (saveTick % 10 === 0) broadcast(w, { t: 'time', time: w.time });
    if (saveTick % 20 === 0 && w.dirty) saveWorld(w);
  }
}, 1000).unref();

function shutdown() {
  console.log('\nSaving worlds…');
  for (const w of loaded.values()) saveWorld(w);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

httpServer.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║          TWICYCRAFT SERVER  v1.0.0           ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  LAN:     http://${a.address}:${PORT}  (${name})`);
      }
    }
  }
  console.log(`  Worlds:  ${WORLDS_DIR}`);
  console.log('  Friends on your network can join via the LAN URL.');
});

module.exports = { httpServer };
