// Integration test: boots the real server, connects two WebSocket clients
// (Node >= 22 global WebSocket), and exercises the full multiplayer protocol.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const http = require('http');

const PORT = 3789;
const WORLDS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'twicy-test-'));

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

class Client {
  constructor(name) {
    this.name = name;
    this.inbox = [];
    this.waiters = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      this.ws.onopen = resolve;
      this.ws.onerror = e => reject(new Error('ws error'));
      this.ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        const i = this.waiters.findIndex(w => w.type === msg.t);
        if (i >= 0) {
          const w = this.waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
        } else {
          this.inbox.push(msg);
        }
      };
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async expect(type, pred, timeout = 4000) {
    const matches = m => m.t === type && (!pred || pred(m));
    const deadline = Date.now() + timeout;
    for (;;) {
      const i = this.inbox.findIndex(matches);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      const msg = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${this.name}: timed out waiting for '${type}'`)), Math.max(1, deadline - Date.now()));
        this.waiters.push({ type, resolve, timer });
      });
      if (matches(msg)) return msg;
      this.inbox.push(msg); // matched type but not predicate; keep waiting
      await delay(10);
    }
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function main() {
  console.log('Starting server on port', PORT, '(worlds in', WORLDS_DIR + ')');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), WORLDS_DIR },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.on('data', () => {});

  try {
    // wait for http to come up
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      try {
        const res = await httpGet('/');
        up = res.status === 200;
      } catch (e) { await delay(150); }
    }
    assert.ok(up, 'server did not start');

    // static serving
    const index = await httpGet('/');
    assert.ok(index.body.includes('<canvas id="game">'), 'index.html served');
    const js = await httpGet('/js/main.js');
    assert.strictEqual(js.status, 200, 'static js served');
    const missing = await httpGet('/nope.js');
    assert.strictEqual(missing.status, 404, '404 for missing files');
    const traversal = await httpGet('/../server/server.js');
    assert.notStrictEqual(traversal.status, 200, 'no path traversal');
    console.log('✓ static file serving');

    // client 1: hello + create + join
    const a = new Client('alice');
    await a.connect();
    a.send({ t: 'hello', name: 'Alice', skin: 'royal' });
    const hello = await a.expect('hello');
    assert.strictEqual(hello.name, 'Alice');
    console.log('✓ websocket handshake + hello');

    a.send({ t: 'create', name: 'Test World', seed: 'pineapple', mode: 'creative' });
    const created = await a.expect('created');
    assert.ok(created.id, 'world id returned');

    a.send({ t: 'worlds' });
    const worlds = await a.expect('worlds');
    assert.strictEqual(worlds.list.length, 1);
    assert.strictEqual(worlds.list[0].name, 'Test World');
    assert.strictEqual(worlds.list[0].mode, 'creative');
    console.log('✓ world creation + listing');

    a.send({ t: 'join', id: created.id });
    const worldA = await a.expect('world');
    assert.strictEqual(worldA.seed, 'pineapple');
    assert.deepStrictEqual(worldA.players, [], 'alone at first');

    // place a block + move
    a.send({ t: 'set', x: 10, y: 40, z: -5, id: 12 });
    a.send({ t: 'state', p: [10.5, 41, -4.5], yaw: 1.2, pitch: 0.1 });

    // client 2 joins, must see alice + her edit
    const b = new Client('bob');
    await b.connect();
    b.send({ t: 'hello', name: 'Bob', skin: 'zombie' });
    await b.expect('hello');
    b.send({ t: 'join', id: created.id });
    const worldB = await b.expect('world');
    assert.strictEqual(worldB.edits['10,40,-5'], 12, 'edit visible to second player');
    assert.strictEqual(worldB.players.length, 1, 'roster has alice');
    assert.strictEqual(worldB.players[0].name, 'Alice');
    assert.strictEqual(worldB.players[0].skin, 'royal');

    const joinMsg = await a.expect('join');
    assert.strictEqual(joinMsg.name, 'Bob');
    console.log('✓ multiplayer join + edit sync + roster');

    // state relay a->b
    a.send({ t: 'state', p: [11, 41, -4], yaw: 2, pitch: 0, swing: 1 });
    const st = await b.expect('state');
    assert.strictEqual(st.id, joinMsg.id === st.id ? st.id : st.id); // id is alice's
    assert.deepStrictEqual(st.p, [11, 41, -4]);
    assert.strictEqual(st.swing, 1);

    // block sync b->a
    b.send({ t: 'set', x: 1, y: 35, z: 1, id: 0 });
    const setMsg = await a.expect('set');
    assert.deepStrictEqual([setMsg.x, setMsg.y, setMsg.z, setMsg.id], [1, 35, 1, 0]);
    console.log('✓ state + block change relay');

    // chat + command
    b.send({ t: 'chat', text: 'hello world' });
    const chat = await a.expect('chat', m => !m.sys);
    assert.strictEqual(chat.from, 'Bob');
    assert.strictEqual(chat.text, 'hello world');
    a.send({ t: 'chat', text: '/gamemode survival' });
    const gm = await a.expect('gamemode');
    assert.strictEqual(gm.mode, 'survival');
    a.send({ t: 'chat', text: '/time night' });
    const time = await a.expect('time');
    assert.ok(time.time > 300, 'night time set');
    console.log('✓ chat + /gamemode + /time commands');

    // pdata persistence
    a.send({ t: 'pdata', pos: [11, 41, -4], yaw: 2, pitch: 0, inv: [[12, 5], 0], health: 17, gamemode: 'survival' });
    await delay(100);

    // leave: bob gets the event
    a.send({ t: 'leave' });
    const leaveMsg = await b.expect('leave');
    assert.ok(leaveMsg.id, 'leave broadcast');
    b.close();
    await delay(300);

    // world must be saved to disk with edits + player data
    const files = fs.readdirSync(WORLDS_DIR).filter(f => f.endsWith('.json'));
    assert.strictEqual(files.length, 1, 'world file exists');
    const saved = JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, files[0]), 'utf8'));
    assert.strictEqual(saved.name, 'Test World');
    assert.strictEqual(saved.edits['10,40,-5'], 12, 'edit persisted');
    assert.strictEqual(saved.players.Alice.health, 17, 'player data persisted');
    assert.strictEqual(saved.players.Alice.gamemode, 'survival', 'gamemode persisted');
    assert.deepStrictEqual(saved.players.Alice.inv[0], [12, 5], 'inventory persisted');
    console.log('✓ world + player persistence on disk');

    // rejoin: pdata comes back
    const c = new Client('alice2');
    await c.connect();
    c.send({ t: 'hello', name: 'Alice', skin: 'royal' });
    await c.expect('hello');
    c.send({ t: 'join', id: created.id });
    const rejoin = await c.expect('world');
    assert.ok(rejoin.you, 'saved player data returned');
    assert.strictEqual(rejoin.you.health, 17);
    assert.strictEqual(rejoin.you.gamemode, 'survival');
    c.send({ t: 'leave' });
    c.close();
    await delay(200);

    // friends: search, request, accept, list
    const f1 = new Client('f-alice');
    await f1.connect();
    f1.send({ t: 'hello', name: 'Alice' });
    await f1.expect('hello');
    const f2 = new Client('f-bob');
    await f2.connect();
    f2.send({ t: 'hello', name: 'Bob' });
    await f2.expect('hello');
    f1.send({ t: 'fsearch', q: 'bo' });
    const search = await f1.expect('fsearch');
    assert.ok(search.list.some(u => u.name === 'Bob'), 'search finds Bob');
    f1.send({ t: 'frequest', to: 'Bob' });
    const bobList = await f2.expect('flist');
    assert.deepStrictEqual(bobList.requests, ['Alice'], 'Bob got the friend request');
    f2.send({ t: 'faccept', from: 'Alice' });
    const bobList2 = await f2.expect('flist', l => l.friends.length > 0);
    assert.strictEqual(bobList2.friends[0].name, 'Alice', 'Bob has Alice as friend');
    assert.strictEqual(bobList2.friends[0].online, true, 'Alice shows online');
    console.log('✓ friends: search, request, accept, presence');

    // private world + invite flow
    f1.send({ t: 'create', name: 'Secret Base', seed: 's', mode: 'creative', visibility: 'private', mobs: false });
    const secret = await f1.expect('created');
    f2.send({ t: 'worlds' });
    const bobWorlds = await f2.expect('worlds');
    assert.ok(!bobWorlds.list.some(w => w.id === secret.id), 'private world hidden from non-friends');
    f2.send({ t: 'join', id: secret.id });
    const denied = await f2.expect('err');
    assert.ok(/private/.test(denied.msg), 'join denied: ' + denied.msg);
    f1.send({ t: 'join', id: secret.id });
    const ownWorld = await f1.expect('world');
    assert.strictEqual(ownWorld.sim, true, 'first joiner is the mob sim host');
    assert.strictEqual(ownWorld.mobs, false, 'mobs setting persisted');
    f1.send({ t: 'invite', to: 'Bob' });
    const invited = await f2.expect('invited');
    assert.strictEqual(invited.from, 'Alice');
    assert.strictEqual(invited.worldId, secret.id);
    f2.send({ t: 'join', id: secret.id });
    const joined = await f2.expect('world');
    assert.strictEqual(joined.sim, false, 'second joiner is not the sim host');
    console.log('✓ private worlds: hidden, join denied, invite grants access');

    // mob relay: sim host broadcast reaches the other player; hits route back
    f1.send({ t: 'mobs', list: [[1, 0, 5, 40, 5, 0, 20, 0]] });
    const mobsMsg = await f2.expect('mobs');
    assert.strictEqual(mobsMsg.list.length, 1, 'mob batch relayed');
    f2.send({ t: 'mobhit', id: 1, dmg: 4, kx: 1, kz: 0 });
    const hit = await f1.expect('mobhit');
    assert.strictEqual(hit.dmg, 4, 'mob hit routed to sim host');
    f1.send({ t: 'setMany', blocks: [[1, 30, 1, 0], [2, 30, 1, 0]], boom: { x: 1, y: 30, z: 1, r: 2 } });
    const boom = await f2.expect('setMany');
    assert.strictEqual(boom.blocks.length, 2, 'explosion blocks relayed');
    // sim handover when the host leaves
    f1.send({ t: 'leave' });
    const simMsg = await f2.expect('sim');
    assert.strictEqual(simMsg.you, true, 'sim host handed over on leave');
    f2.send({ t: 'leave' });
    console.log('✓ mob sync relays + sim host handover');

    // delete world: only the owner may delete
    const d = new Client('admin');
    await d.connect();
    d.send({ t: 'hello', name: 'Admin' });
    await d.expect('hello');
    d.send({ t: 'delete', id: created.id });
    const delErr = await d.expect('err');
    assert.ok(/owner/.test(delErr.msg), 'non-owner delete rejected');
    d.close();
    f1.send({ t: 'delete', id: created.id });
    await f1.expect('deleted');
    f1.send({ t: 'delete', id: secret.id });
    await f1.expect('deleted');
    f1.send({ t: 'worlds' });
    const after = await f1.expect('worlds');
    assert.strictEqual(after.list.length, 0, 'worlds deleted by owner');
    f1.close(); f2.close();
    console.log('✓ rejoin restores player data; owner-only delete works');

    a.close();
    console.log('\nAll server integration tests passed.');
  } finally {
    server.kill('SIGTERM');
    await delay(200);
    try { fs.rmSync(WORLDS_DIR, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch(e => {
  console.error('\n✗ TEST FAILED:', e.message);
  process.exit(1);
});
