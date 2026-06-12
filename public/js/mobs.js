// Mobs: types, procedural textures/models, AI (wander/chase/attack/flee),
// combat, and multiplayer sync. One client per world (the "sim host", chosen
// by the server) runs the AI and broadcasts state; everyone else interpolates.
'use strict';

const MOB_KINDS = ['zombie', 'spider', 'creeper', 'pig', 'sheep', 'cow', 'skeleton'];

const MOB_TYPES = {
  zombie: { hostile: true, night: true, burns: true, hp: 20, speed: 2.6, dmg: 3, aggroR: 14, atkR: 1.5,
    w: 0.6, h: 1.9, model: 'humanoid', drops: [{ id: 109 /*leather*/, ch: 0.35, n: 1 }] },
  spider: { hostile: 'night', hp: 16, speed: 3.0, dmg: 2, aggroR: 12, atkR: 1.6,
    w: 1.1, h: 0.9, model: 'spider', drops: [] },
  creeper: { hostile: true, night: false, hp: 20, speed: 2.4, dmg: 0, aggroR: 13, atkR: 2.4,
    fuse: true, w: 0.6, h: 1.6, model: 'creeper', drops: [] },
  pig: { hp: 10, speed: 1.7, w: 0.9, h: 0.9, model: 'quad', drops: [] },
  sheep: { hp: 8, speed: 1.6, w: 0.9, h: 1.1, model: 'quad', drops: [{ id: BL.WOOL_WHITE, ch: 1, n: 1 }] },
  cow: { hp: 10, speed: 1.5, w: 0.95, h: 1.3, model: 'quad', drops: [{ id: 109, ch: 1, n: 2 }] },
  skeleton: { hostile: true, night: true, burns: true, hp: 16, speed: 2.4, dmg: 0, aggroR: 15, atkR: 0,
    ranged: { range: 12, keep: 7, cooldown: 2.2, dmg: 3 },
    w: 0.6, h: 1.9, model: 'humanoid', skin: 'skeleton', drops: [{ id: 100 /*stick*/, ch: 0.6, n: 2 }] },
};

// ---- procedural mob textures: 32x16, left half = body, right half = face ----
function buildMobTexture(kind) {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 16;
  const ctx = cv.getContext('2d');
  let st = Noise.hashSeed(kind);
  const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) | 0; return ((st >>> 9) % 1000) / 1000; };
  const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
  const speck = (x0, cols) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) px(x0 + x, y, cols[(rnd() * cols.length) | 0]);
  };
  const palettes = {
    zombie: ['#6ea25b', '#5f8f4e', '#7cb267'],
    spider: ['#2e2433', '#241c28', '#3a2e40'],
    creeper: ['#58c14f', '#4aad42', '#6bd062', '#3d9636'],
    pig: ['#eda3a3', '#e29595', '#f5b1b1'],
    sheep: ['#e8e4dc', '#dcd7cc', '#f2efe8'],
    cow: ['#5b4332', '#4e3929', '#69503c'],
  };
  speck(0, palettes[kind]); // body
  speck(16, palettes[kind]); // face base
  if (kind === 'cow') { // white patches on body
    for (let i = 0; i < 5; i++) {
      const bx = (rnd() * 12) | 0, by = (rnd() * 12) | 0;
      ctx.fillStyle = '#e8e4dc';
      ctx.fillRect(bx, by, 3 + ((rnd() * 3) | 0), 2 + ((rnd() * 3) | 0));
    }
  }
  // faces (right half, 16x16 region starting at x=16)
  const F = 16;
  if (kind === 'creeper') {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(F + 3, 4, 3, 3); ctx.fillRect(F + 10, 4, 3, 3);         // eyes
    ctx.fillRect(F + 6, 7, 4, 3); ctx.fillRect(F + 5, 9, 2, 4); ctx.fillRect(F + 9, 9, 2, 4); // mouth
  } else if (kind === 'spider') {
    for (const [ex, ey] of [[3, 5], [6, 4], [9, 4], [12, 5]]) {
      px(F + ex, ey, '#d33b3b'); px(F + ex + 1, ey, '#ff6b6b');
    }
    px(F + 7, 8, '#111'); px(F + 8, 8, '#111');
  } else if (kind === 'zombie') {
    ctx.fillStyle = '#1c2b18';
    ctx.fillRect(F + 3, 5, 2, 2); ctx.fillRect(F + 11, 5, 2, 2);
    ctx.fillRect(F + 6, 9, 4, 2);
  } else if (kind === 'pig') {
    px(F + 3, 5, '#fff'); px(F + 4, 5, '#2b2b2b'); px(F + 11, 5, '#2b2b2b'); px(F + 12, 5, '#fff');
    ctx.fillStyle = '#d97d7d';
    ctx.fillRect(F + 5, 8, 6, 4); // snout
    px(F + 6, 9, '#b35b5b'); px(F + 9, 9, '#b35b5b');
  } else { // sheep / cow
    px(F + 3, 5, '#fff'); px(F + 4, 5, '#2b2b2b'); px(F + 11, 5, '#2b2b2b'); px(F + 12, 5, '#fff');
    ctx.fillStyle = kind === 'cow' ? '#cfc4b8' : '#d8d2c6';
    ctx.fillRect(F + 5, 9, 6, 5); // muzzle
    if (kind === 'cow') { px(F + 5, 9, '#9c8b78'); px(F + 10, 9, '#9c8b78'); }
  }
  return cv;
}

// uv helpers: body = left half, face = right half
const MOB_UV_BODY = { u0: 0.01, v0: 0.02, u1: 0.49, v1: 0.98 };
const MOB_UV_FACE = { u0: 0.51, v0: 0.02, u1: 0.99, v1: 0.98 };

function makeMobBox(renderer, w, h, d, faceFront) {
  const S = MODEL_SCALE;
  return renderer.makeMesh(makeCubeVerts(w * S, h * S, d * S,
    f => (faceFront && f === 5) ? MOB_UV_FACE : MOB_UV_BODY, 1));
}

function buildMobMeshes(renderer) {
  return {
    quadBody: makeMobBox(renderer, 10, 9, 16, false),
    quadLeg: makeMobBox(renderer, 4, 7, 4, false),
    quadHead: makeMobBox(renderer, 8, 8, 8, true),
    spiderBody: makeMobBox(renderer, 11, 6, 13, false),
    spiderHead: makeMobBox(renderer, 7, 6, 7, true),
    spiderLeg: makeMobBox(renderer, 14, 1.6, 1.6, false),
    creeperBody: makeMobBox(renderer, 8, 12, 5, false),
    creeperHead: makeMobBox(renderer, 8, 8, 8, true),
    creeperLeg: makeMobBox(renderer, 4, 6, 5, false),
    arrow: makeMobBox(renderer, 1.2, 1.2, 9, false),
  };
}

// ---- per-model pose matrices ----
function mobPartList(m, time) {
  const S = MODEL_SCALE;
  const px = v => v * S;
  const type = MOB_TYPES[m.type];
  const scale = m.type === 'cow' ? 1.18 : m.type === 'pig' ? 0.92 : m.type === 'spider' ? 1.05 : 1;
  let rootY = m.pos[1];
  // death animation: fall over sideways and sink
  const deathRot = m.deathT > 0 ? Math.min(1, m.deathT / 0.5) * (Math.PI / 2) : 0;
  let root = M4.mul(M4.translate(m.pos[0], rootY, m.pos[2]), M4.rotY(m.yaw));
  if (deathRot) root = M4.mul(root, M4.mul(M4.translate(0, px(3), 0), M4.mul(M4.rotZ(deathRot), M4.translate(0, -px(3), 0))));
  if (scale !== 1) root = M4.mul(root, M4.scale(scale, scale, scale));
  const at = (pivot, rot, off) =>
    M4.mul(root, M4.mul(M4.translate(px(pivot[0]), px(pivot[1]), px(pivot[2])),
      M4.mul(rot, M4.translate(px(off[0]), px(off[1]), px(off[2])))));

  const wp = m.walkPhase, amp = Math.min(1, m.walkAmp);
  const sw = Math.cos(wp) * 0.9 * amp;
  const parts = []; // [meshName, matrix]

  if (type.model === 'quad') {
    parts.push(['quadBody', at([0, 7, 0], M4.ident(), [-5, 0, -8])]);
    parts.push(['quadHead', at([0, 12, -8], M4.rotX(m.headPitch || 0), [-4, -3, -8])]);
    parts.push(['quadLeg', at([-3, 7, -5], M4.rotX(sw), [-2, -7, -2])]);
    parts.push(['quadLeg', at([3, 7, -5], M4.rotX(-sw), [-2, -7, -2])]);
    parts.push(['quadLeg', at([-3, 7, 5], M4.rotX(-sw), [-2, -7, -2])]);
    parts.push(['quadLeg', at([3, 7, 5], M4.rotX(sw), [-2, -7, -2])]);
  } else if (type.model === 'spider') {
    parts.push(['spiderBody', at([0, 5, 1], M4.ident(), [-5.5, -3, -6.5])]);
    parts.push(['spiderHead', at([0, 5, -6], M4.ident(), [-3.5, -3, -7])]);
    for (let i = 0; i < 4; i++) {
      const z = -4 + i * 3;
      const wig = Math.sin(wp * 1.6 + i * 1.7) * 0.25 * (amp + 0.15);
      const fan = (i - 1.5) * 0.35;
      parts.push(['spiderLeg', at([-5, 6, z], M4.mul(M4.rotY(-fan + wig), M4.rotZ(0.45)), [-14, -1, -0.8])]);
      parts.push(['spiderLeg', at([5, 6, z], M4.mul(M4.rotY(fan - wig), M4.rotZ(-0.45)), [0, -1, -0.8])]);
    }
  } else if (type.model === 'creeper') {
    // fuse: swell up
    const swell = m.fuseT > 0 ? 1 + Math.min(0.25, m.fuseT * 0.18) : 1;
    if (swell !== 1) root = M4.mul(root, M4.scale(swell, swell, swell));
    const at2 = (pivot, rot, off) =>
      M4.mul(root, M4.mul(M4.translate(px(pivot[0]), px(pivot[1]), px(pivot[2])),
        M4.mul(rot, M4.translate(px(off[0]), px(off[1]), px(off[2])))));
    parts.push(['creeperBody', at2([0, 6, 0], M4.ident(), [-4, 0, -2.5])]);
    parts.push(['creeperHead', at2([0, 18, 0], M4.rotX(-(m.headPitch || 0)), [-4, 0, -4])]);
    parts.push(['creeperLeg', at2([-2, 6, -3], M4.rotX(sw), [-2, -6, -2.5])]);
    parts.push(['creeperLeg', at2([2, 6, -3], M4.rotX(-sw), [-2, -6, -2.5])]);
    parts.push(['creeperLeg', at2([-2, 6, 3], M4.rotX(-sw), [-2, -6, -2.5])]);
    parts.push(['creeperLeg', at2([2, 6, 3], M4.rotX(sw), [-2, -6, -2.5])]);
  }
  return parts;
}

class Mobs {
  // game must expose: world, player, remotes, drops, particles, netSend(obj), isCreative()
  constructor(game) {
    this.game = game;
    this.list = new Map();
    this.arrows = [];   // {pos:[..], vel:[..], age}
    this.nextId = 1;
    this.isSim = false;
    this.enabled = true;
    this.sendTimer = 0;
    this.spawnTimer = 0;
    this.saveTimer = 0;
  }

  setSim(v) { this.isSim = !!v; }

  count(pred) {
    let n = 0;
    for (const m of this.list.values()) if (!pred || pred(m)) n++;
    return n;
  }

  spawn(type, x, y, z) {
    const t = MOB_TYPES[type];
    if (!t) return null;
    const m = {
      id: this.nextId++, type,
      pos: [x, y, z], vel: [0, 0, 0], yaw: Math.random() * Math.PI * 2,
      target: [x, y, z], targetYaw: 0,
      hp: t.hp, walkPhase: Math.random() * 6, walkAmp: 0, headPitch: 0,
      wanderT: 0, wanderDir: null, atkCd: 0, hurtT: 0, deathT: 0, fuseT: 0,
      fleeT: 0, age: 0, onGround: false,
      losT: 0, canSee: false, aggroT: 0, lastSeenPos: null,
      strafeT: 0, strafeDir: 1, grazeT: 0, grazing: 0, headPitch: 0,
      swingT: -1, burnT: 0, burning: false,
    };
    this.list.set(m.id, m);
    return m;
  }

  serialize() {
    const out = [];
    for (const m of this.list.values()) {
      if (m.deathT > 0) continue;
      out.push([MOB_KINDS.indexOf(m.type), Math.round(m.pos[0] * 10) / 10, Math.round(m.pos[1] * 10) / 10, Math.round(m.pos[2] * 10) / 10, m.hp]);
      if (out.length >= 40) break;
    }
    return out;
  }

  load(arr) {
    if (!Array.isArray(arr)) return;
    for (const v of arr) {
      if (!Array.isArray(v) || v.length < 5) continue;
      const kind = MOB_KINDS[v[0]];
      if (!kind) continue;
      const m = this.spawn(kind, v[1], v[2], v[3]);
      if (m) m.hp = clamp(v[4], 1, MOB_TYPES[kind].hp);
    }
  }

  // every player position in the world (for AI + spawning)
  _players() {
    const g = this.game;
    const out = [];
    if (!g.player.dead) out.push({ self: true, id: -1, pos: g.player.pos });
    for (const rp of g.remotes.map.values()) out.push({ self: false, id: rp.id, pos: rp.pos });
    return out;
  }

  tick(dt, dayLight) {
    if (!this.enabled) return;
    for (const m of [...this.list.values()]) {
      m.age += dt;
      if (m.hurtT > 0) m.hurtT -= dt;
      if (m.deathT > 0) {
        m.deathT += dt;
        if (m.deathT > 1.1) this.list.delete(m.id);
        continue;
      }
      if (m.swingT >= 0) {
        m.swingT += dt;
        if (m.swingT > 0.3) m.swingT = -1;
      }
      if (this.isSim) this._ai(m, dt, dayLight);
      else this._interp(m, dt);
    }
    this._tickArrows(dt);
    if (this.isSim) {
      this._spawning(dt, dayLight);
      this.sendTimer += dt;
      if (this.sendTimer > 0.18) { this.sendTimer = 0; this._broadcast(); }
      this.saveTimer += dt;
      if (this.saveTimer > 10) { this.saveTimer = 0; this.game.netSend({ t: 'mobsave', list: this.serialize() }); }
    }
  }

  _tickArrows(dt) {
    const w = this.game.world;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      a.vel[1] -= 8 * dt; // gentle arc
      a.pos[0] += a.vel[0] * dt;
      a.pos[1] += a.vel[1] * dt;
      a.pos[2] += a.vel[2] * dt;
      if (a.age > 4 || w.solidAt(Math.floor(a.pos[0]), Math.floor(a.pos[1]), Math.floor(a.pos[2]))) {
        this.arrows.splice(i, 1);
        continue;
      }
      if (!this.isSim) continue;
      // hit a player?
      for (const p of this._players()) {
        if (Math.abs(a.pos[0] - p.pos[0]) < 0.45 && Math.abs(a.pos[2] - p.pos[2]) < 0.45 &&
            a.pos[1] > p.pos[1] && a.pos[1] < p.pos[1] + 1.9) {
          const dl = Math.hypot(a.vel[0], a.vel[2]) || 1;
          if (p.self) this.game.hurtPlayer(a.dmg, [a.vel[0] / dl * 5, 4, a.vel[2] / dl * 5]);
          else this.game.netSend({ t: 'mobatk', target: p.id, dmg: a.dmg, kx: a.vel[0] / dl * 5, kz: a.vel[2] / dl * 5 });
          this.arrows.splice(i, 1);
          break;
        }
      }
    }
  }

  _shoot(m, target, spec) {
    const sx = m.pos[0], sy = m.pos[1] + 1.4, sz = m.pos[2];
    const dx = target.pos[0] - sx, dy = (target.pos[1] + 1) - sy, dz = target.pos[2] - sz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const sp = 16;
    this.arrows.push({
      pos: [sx + dx / dl * 0.6, sy, sz + dz / dl * 0.6],
      vel: [dx / dl * sp, dy / dl * sp + dl * 0.28, dz / dl * sp], // lead the arc
      dmg: spec.dmg, age: 0,
    });
    Sfx.click();
  }

  // ---------- remote interpolation ----------
  _interp(m, dt) {
    const k = Math.min(1, dt * 14);
    for (let i = 0; i < 3; i++) m.pos[i] = lerp(m.pos[i], m.target[i], k);
    m.yaw = lerpAngle(m.yaw, m.targetYaw, Math.min(1, dt * 12));
    const sp = dist2d(m.target[0], m.target[2], m.pos[0], m.pos[2]);
    m.walkAmp = lerp(m.walkAmp, sp > 0.05 ? 1 : 0, Math.min(1, dt * 8));
    m.walkPhase += dt * (m.walkAmp * 7 + 0.001);
    if (m.fuseT > 0) m.fuseT += dt;
  }

  onBatch(list, arrows) {
    if (this.isSim) return;
    if (Array.isArray(arrows)) {
      this.arrows = arrows.map(a => ({ pos: [a[0], a[1], a[2]], vel: [a[3], a[4], a[5]], age: 0, dmg: 0 }));
    }
    const seen = new Set();
    for (const v of list) {
      const [id, kindIdx, x, y, z, yaw, hp, flags] = v;
      seen.add(id);
      let m = this.list.get(id);
      if (!m) {
        const kind = MOB_KINDS[kindIdx];
        if (!kind) continue;
        m = this.spawn(kind, x, y, z);
        this.list.delete(m.id);
        m.id = id;
        this.list.set(id, m);
      }
      const far = dist2d(x, z, m.pos[0], m.pos[2]) > 8;
      if (far) m.pos = [x, y, z];
      m.target = [x, y, z];
      m.targetYaw = yaw;
      if (hp < m.hp) { m.hurtT = 0.4; Sfx.hit(); }
      m.hp = hp;
      if ((flags & 2) && m.fuseT === 0) { m.fuseT = 0.01; Sfx.fuse(); }
      if (!(flags & 2)) m.fuseT = 0;
      m.burning = !!(flags & 8);
      if ((flags & 4) && m.deathT === 0) this._startDeath(m, false);
    }
    for (const [id, m] of this.list) {
      if (!seen.has(id) && m.deathT === 0) this.list.delete(id);
    }
  }

  _broadcast() {
    const out = [];
    for (const m of this.list.values()) {
      let flags = 0;
      if (m.hurtT > 0) flags |= 1;
      if (m.fuseT > 0) flags |= 2;
      if (m.deathT > 0) flags |= 4;
      if (m.burning) flags |= 8;
      out.push([m.id, MOB_KINDS.indexOf(m.type),
        Math.round(m.pos[0] * 50) / 50, Math.round(m.pos[1] * 50) / 50, Math.round(m.pos[2] * 50) / 50,
        Math.round(m.yaw * 100) / 100, m.hp, flags]);
    }
    const arrows = this.arrows.slice(0, 24).map(a => [
      Math.round(a.pos[0] * 20) / 20, Math.round(a.pos[1] * 20) / 20, Math.round(a.pos[2] * 20) / 20,
      Math.round(a.vel[0] * 10) / 10, Math.round(a.vel[1] * 10) / 10, Math.round(a.vel[2] * 10) / 10,
    ]);
    this.game.netSend({ t: 'mobs', list: out, arrows });
  }

  // ---------- AI (sim host only) ----------

  // can the mob see this player? (cached, checked a few times per second)
  _los(m, p, t) {
    const o = [m.pos[0], m.pos[1] + t.h * 0.85, m.pos[2]];
    const dx = p.pos[0] - o[0], dy = (p.pos[1] + 1.5) - o[1], dz = p.pos[2] - o[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return true;
    const w = this.game.world;
    const hit = raycastVoxels(o, [dx / len, dy / len, dz / len], len,
      (x, y, z) => w.solidAt(x, y, z));
    return !hit;
  }

  _ai(m, dt, dayLight) {
    const t = MOB_TYPES[m.type];
    const w = this.game.world;
    if (!w.isLoaded(m.pos[0], m.pos[2])) return;
    const players = this._players();

    // despawn far away
    let nearest = null, nd = 1e9;
    for (const p of players) {
      const d = dist2d(p.pos[0], p.pos[2], m.pos[0], m.pos[2]);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (!nearest || (nd > 60 && m.age > 20)) { this.list.delete(m.id); return; }

    // undead burn in direct sunlight (like Minecraft at dawn)
    m.burning = false;
    if (t.burns && dayLight > 0.62) {
      const exposed = w.findGroundY(m.pos[0], m.pos[2]) <= Math.floor(m.pos[1] + 0.2);
      if (exposed) {
        m.burning = true;
        m.burnT += dt;
        if (m.burnT >= 0.8) {
          m.burnT = 0;
          m.hp -= 2;
          m.hurtT = 0.3;
          if (this.game.burnFx) this.game.burnFx(m);
          if (m.hp <= 0) { this._startDeath(m, true); return; }
        }
      }
    }

    // vision: cheap cached line-of-sight at 4 Hz + aggro memory
    m.losT -= dt;
    if (m.losT <= 0) {
      m.losT = 0.25;
      m.canSee = nd < t.aggroR * 1.6 && this._los(m, nearest, t);
      if (m.canSee && nd < t.aggroR) {
        m.aggroT = 6; // remember the target for a while
        m.lastSeenPos = nearest.pos.slice();
      }
    }
    if (m.aggroT > 0) m.aggroT -= dt;

    const isHostileNow = t.hostile === true || (t.hostile === 'night' && dayLight < 0.5);
    const hunting = isHostileNow && m.aggroT > 0 && Math.abs(nearest.pos[1] - m.pos[1]) < 10;
    let moveDir = null, moveSpeed = t.speed;
    m.climbing = false;

    if (m.fleeT > 0) {
      // panicked zig-zag run away
      m.fleeT -= dt;
      const dx = m.pos[0] - nearest.pos[0], dz = m.pos[2] - nearest.pos[2];
      const dl = Math.hypot(dx, dz) || 1;
      const zig = Math.sin(m.age * 6) * 0.5;
      moveDir = [dx / dl - dz / dl * zig, dz / dl + dx / dl * zig];
      moveSpeed = t.speed * 1.5;
      m.grazing = 0;
    } else if (hunting) {
      m.grazing = 0;
      // chase what we can see; otherwise search the last known position
      const tgt = m.canSee ? nearest.pos : (m.lastSeenPos || nearest.pos);
      const dx = tgt[0] - m.pos[0], dz = tgt[2] - m.pos[2];
      const dl = Math.hypot(dx, dz) || 1;
      if (!m.canSee && dl < 1.6) m.aggroT = 0; // searched the spot, gave up
      m.headPitch = clamp(Math.atan2(nearest.pos[1] - m.pos[1], nd || 1) * 0.6, -0.5, 0.5);
      m.climbing = m.type === 'spider';

      if (t.ranged) {
        // skeleton: keep distance, strafe side to side, shoot on sight
        m.atkCd -= dt;
        m.strafeT -= dt;
        if (m.strafeT <= 0) { m.strafeT = 1 + Math.random() * 2; m.strafeDir = Math.random() < 0.5 ? -1 : 1; }
        if (!m.canSee) {
          moveDir = [dx / dl, dz / dl]; // move to regain sight
        } else if (nd < t.ranged.keep - 1.5) {
          moveDir = [-dx / dl, -dz / dl];
        } else if (nd > t.ranged.range) {
          moveDir = [dx / dl, dz / dl];
        } else {
          // in the firing band: strafe
          moveDir = [-dz / dl * m.strafeDir, dx / dl * m.strafeDir];
          moveSpeed = t.speed * 0.6;
        }
        if (m.canSee && nd <= t.ranged.range && m.atkCd <= 0) {
          m.atkCd = t.ranged.cooldown;
          m.swingT = 0;
          this._shoot(m, nearest, t.ranged);
        }
      } else if (t.fuse) {
        // creeper: close in silently, then hold still and hiss
        if (m.canSee && nd < t.atkR) {
          if (m.fuseT === 0) Sfx.fuse();
          m.fuseT += dt;
          if (m.fuseT > 1.5) { this._explode(m); return; }
        } else {
          m.fuseT = Math.max(0, m.fuseT - dt * 2);
          moveDir = [dx / dl, dz / dl];
        }
      } else {
        if (dl > t.atkR * 0.8 || !m.canSee) moveDir = [dx / dl, dz / dl];
        m.atkCd -= dt;
        const vDist = Math.abs(nearest.pos[1] + 0.9 - (m.pos[1] + t.h * 0.5));
        if (m.canSee && nd < t.atkR && vDist < 2.2 && m.atkCd <= 0) {
          m.atkCd = 1.1;
          m.swingT = 0;
          if (m.onGround) m.vel[1] = 3.2; // little lunge hop
          this._attackPlayer(m, nearest, t.dmg);
        }
      }
    } else {
      m.fuseT = 0;
      // wander / graze
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        if (m.wanderDir || Math.random() < 0.5) {
          m.wanderDir = null;
          m.wanderT = 1.5 + Math.random() * 4;
          // passive mobs sometimes graze while paused
          if (!t.hostile && Math.random() < 0.5) m.grazeT = 1.2 + Math.random() * 1.5;
        } else {
          const a = Math.random() * Math.PI * 2;
          m.wanderDir = [Math.cos(a), Math.sin(a)];
          m.wanderT = 1 + Math.random() * 2.5;
          m.grazeT = 0;
        }
      }
      if (m.grazeT > 0) m.grazeT -= dt;
      m.grazing = !t.hostile && m.grazeT > 0 ? 1 : 0;
      m.headPitch = lerp(m.headPitch || 0, m.grazing ? 0.55 : 0, Math.min(1, dt * 5));
      if (m.wanderDir) {
        // don't wander into water
        const ax = Math.floor(m.pos[0] + m.wanderDir[0] * 1.2);
        const az = Math.floor(m.pos[2] + m.wanderDir[1] * 1.2);
        if (w.getBlock(ax, Math.floor(m.pos[1]), az) === BL.WATER ||
            w.getBlock(ax, Math.floor(m.pos[1] - 1), az) === BL.WATER) {
          m.wanderDir = [-m.wanderDir[0], -m.wanderDir[1]];
        }
        moveDir = m.wanderDir;
        moveSpeed = t.speed * 0.45;
      }
    }

    // separation: don't stand inside each other
    let sepX = 0, sepZ = 0;
    for (const o of this.list.values()) {
      if (o === m || o.deathT > 0) continue;
      const dx = m.pos[0] - o.pos[0], dz = m.pos[2] - o.pos[2];
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.001 && d2 < 1.1) {
        const d = Math.sqrt(d2);
        sepX += dx / d * (1.05 - d);
        sepZ += dz / d * (1.05 - d);
      }
    }

    // movement + physics
    if (moveDir) {
      m.targetYaw = Math.atan2(-moveDir[0], -moveDir[1]);
      const k = Math.min(1, dt * 8);
      m.vel[0] += (moveDir[0] * moveSpeed - m.vel[0]) * k;
      m.vel[2] += (moveDir[1] * moveSpeed - m.vel[2]) * k;
    } else {
      m.vel[0] *= Math.max(0, 1 - dt * 8);
      m.vel[2] *= Math.max(0, 1 - dt * 8);
    }
    m.vel[0] += sepX * dt * 14;
    m.vel[2] += sepZ * dt * 14;
    m.yaw = lerpAngle(m.yaw, m.targetYaw, Math.min(1, dt * 8));
    m.vel[1] -= 28 * dt;
    if (m.vel[1] < -40) m.vel[1] = -40;
    this._move(m, t, dt);
    // climb (spiders) or hop up single blocks when pushing against a wall
    if (m.blocked && moveDir) {
      if (m.climbing) m.vel[1] = 4.4;
      else if (m.onGround) m.vel[1] = 7.8;
    }

    // swimming: float up
    const feet = w.getBlock(Math.floor(m.pos[0]), Math.floor(m.pos[1] + 0.3), Math.floor(m.pos[2]));
    if (feet === BL.WATER) { m.vel[1] = Math.max(m.vel[1], 2.2); }

    const hsp = Math.hypot(m.vel[0], m.vel[2]);
    m.walkAmp = lerp(m.walkAmp, hsp > 0.2 ? Math.min(1, hsp / 2.5) : 0, Math.min(1, dt * 8));
    m.walkPhase += dt * hsp * 2.6;
    if (m.pos[1] < -20) this.list.delete(m.id);
  }

  _move(m, t, dt) {
    const w = this.game.world;
    const half = t.w / 2;
    m.blocked = false;
    const move = (axis, delta) => {
      if (!delta) return;
      const old = m.pos[axis];
      m.pos[axis] += delta;
      if (w.boxCollides(m.pos[0], m.pos[1], m.pos[2], half, t.h)) {
        m.pos[axis] = old;
        if (axis === 1) {
          if (delta < 0) m.onGround = true;
          m.vel[1] = 0;
        } else {
          m.blocked = true;
          m.vel[axis] = 0;
        }
      } else if (axis === 1) {
        m.onGround = false;
      }
    };
    const sub = Math.max(1, Math.ceil(Math.abs(m.vel[1] * dt) / 0.4));
    for (let i = 0; i < sub; i++) move(1, m.vel[1] * dt / sub);
    move(0, m.vel[0] * dt);
    move(2, m.vel[2] * dt);
  }

  _attackPlayer(m, p, dmg) {
    const dx = p.pos[0] - m.pos[0], dz = p.pos[2] - m.pos[2];
    const dl = Math.hypot(dx, dz) || 1;
    Sfx.hit();
    if (p.self) {
      this.game.hurtPlayer(dmg, [dx / dl * 7, 4.5, dz / dl * 7]);
    } else {
      this.game.netSend({ t: 'mobatk', target: p.id, dmg, kx: dx / dl * 7, kz: dz / dl * 7 });
    }
  }

  _explode(m) {
    const [cx, cy, cz] = [m.pos[0], m.pos[1] + 0.8, m.pos[2]];
    this.list.delete(m.id);
    this.game.applyExplosion(cx, cy, cz, 2.6);
  }

  _startDeath(m, withDrops) {
    m.deathT = 0.001;
    Sfx.mobDeath();
    if (withDrops) {
      const t = MOB_TYPES[m.type];
      for (const d of t.drops) {
        if (Math.random() < d.ch) {
          const n = d.n || 1;
          for (let i = 0; i < n; i++) this.game.spawnMobDrop(d.id, m.pos[0], m.pos[1] + 0.5, m.pos[2], m.lastHitBy);
        }
      }
    }
  }

  // attacker side: damage a mob (sim applies, others relay to sim)
  hit(m, dmg, kx, kz, byName) {
    Sfx.hit();
    if (this.isSim) this.applyHit(m.id, dmg, kx, kz, byName);
    else this.game.netSend({ t: 'mobhit', id: m.id, dmg, kx, kz });
    m.hurtT = 0.4; // immediate local feedback
  }

  applyHit(id, dmg, kx, kz, byName) {
    const m = this.list.get(id);
    if (!m || m.deathT > 0) return;
    m.hp -= dmg;
    m.hurtT = 0.4;
    m.lastHitBy = byName;
    m.vel[0] += kx; m.vel[2] += kz; m.vel[1] = Math.max(m.vel[1], 4.5);
    const t = MOB_TYPES[m.type];
    if (!t.hostile) m.fleeT = 4;
    else {
      // getting hit wakes the mob up — and its friends nearby
      m.aggroT = 8;
      m.lastSeenPos = m.pos.slice();
      for (const o of this.list.values()) {
        if (o === m || o.deathT > 0) continue;
        const ot = MOB_TYPES[o.type];
        if (!ot.hostile || ot.fuse) continue;
        if (dist2d(o.pos[0], o.pos[2], m.pos[0], m.pos[2]) < 12) {
          o.aggroT = Math.max(o.aggroT, 6);
          o.lastSeenPos = m.pos.slice();
        }
      }
    }
    if (t.fuse) m.fuseT = 0; // knocking a creeper back resets its fuse
    if (m.hp <= 0) this._startDeath(m, true);
  }

  // ---------- spawning (sim host) ----------
  _spawning(dt, dayLight) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const midnight = dayLight < 0.24;
    this.spawnTimer = midnight ? 0.9 : 1.8; // more spawns deep in the night
    const players = this._players();
    if (!players.length) return;
    const w = this.game.world;
    const hostiles = this.count(m => MOB_TYPES[m.type].hostile);
    const passives = this.count(m => !MOB_TYPES[m.type].hostile);

    const p = players[(Math.random() * players.length) | 0];
    const ang = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 22;
    const x = p.pos[0] + Math.cos(ang) * dist;
    const z = p.pos[2] + Math.sin(ang) * dist;
    if (!w.isLoaded(x, z)) return;
    const gy = w.findGroundY(x, z);
    if (gy < 2 || gy > WORLD_H - 4) return;
    const ground = w.getBlock(Math.floor(x), gy, Math.floor(z));
    if (ground === BL.WATER || w.getBlock(Math.floor(x), gy + 1, Math.floor(z)) === BL.WATER) return;
    // not too close to anyone
    for (const pl of players) {
      if (dist2d(pl.pos[0], pl.pos[2], x, z) < 15) return;
    }
    const surfaceH = w.gen.heightAt(Math.floor(x), Math.floor(z));
    const inCave = gy < surfaceH - 5;
    if ((dayLight < 0.42 || inCave) && hostiles < 10) {
      const r = Math.random();
      const kind = r < 0.35 ? 'zombie' : r < 0.6 ? 'skeleton' : r < 0.82 ? 'spider' : 'creeper';
      this.spawn(kind, x, gy + 1, z);
    } else if (dayLight > 0.55 && !inCave && passives < 8 && ground === BL.GRASS) {
      const r = Math.random();
      const kind = r < 0.4 ? 'pig' : r < 0.7 ? 'sheep' : 'cow';
      this.spawn(kind, x, gy + 1, z);
    }
  }

  // ---------- rendering ----------
  draw(renderer, playerMeshes, mobMeshes, getMobTex, getSkinTex, time) {
    for (const m of this.list.values()) {
      const t = MOB_TYPES[m.type];
      const dying = m.deathT > 0;
      const burnFlicker = m.burning ? (Math.sin(time * 22 + m.id) * 0.5 + 0.5) * 0.45 : 0;
      const tint = [
        Math.max(m.hurtT > 0 || (dying && m.deathT < 0.3) ? 0.55 : 0, burnFlicker),
        m.fuseT > 0 ? (Math.sin(m.fuseT * 18) > 0 ? 0.6 : 0) : 0,
        0,
        dying ? Math.max(0, 1 - (m.deathT - 0.5) / 0.6) : 1,
      ];
      if (t.model === 'humanoid') {
        const parts = playerPartMatrices({
          pos: m.pos, bodyYaw: m.yaw, headYaw: m.yaw, pitch: -(m.headPitch || 0),
          walkPhase: m.walkPhase, walkAmp: m.walkAmp,
          swing: m.swingT >= 0 ? m.swingT / 0.3 : -1, time,
          zombieArms: true, deathT: m.deathT, // undead hold their arms out
        });
        const tex = getSkinTex(t.skin || 'zombie');
        for (const name in parts) renderer.drawBox(playerMeshes[name], parts[name], tex, { tint });
      } else {
        const tex = getMobTex(m.type);
        for (const [meshName, mat] of mobPartList(m, time)) {
          renderer.drawBox(mobMeshes[meshName], mat, tex, { tint });
        }
      }
    }
  }

  drawArrows(renderer, arrowMesh, tex) {
    for (const a of this.arrows) {
      const yaw = Math.atan2(-a.vel[0], -a.vel[2]);
      const pitch = Math.atan2(a.vel[1], Math.hypot(a.vel[0], a.vel[2]));
      let mat = M4.translate(a.pos[0], a.pos[1], a.pos[2]);
      mat = M4.mul(mat, M4.rotY(yaw));
      mat = M4.mul(mat, M4.rotX(-pitch));
      mat = M4.mul(mat, M4.translate(-0.035, -0.035, -0.25));
      renderer.drawBox(arrowMesh, mat, tex);
    }
  }

  // ray vs mob AABBs; returns {mob, dist} or null
  raycast(origin, dir, maxDist) {
    let best = null, bestD = maxDist;
    for (const m of this.list.values()) {
      if (m.deathT > 0) continue;
      const t = MOB_TYPES[m.type];
      const half = t.w / 2 + 0.1;
      const lo = [m.pos[0] - half, m.pos[1] - 0.1, m.pos[2] - half];
      const hi = [m.pos[0] + half, m.pos[1] + t.h + 0.1, m.pos[2] + half];
      let tmin = 0, tmax = bestD, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(dir[a]) < 1e-8) {
          if (origin[a] < lo[a] || origin[a] > hi[a]) ok = false;
        } else {
          let t1 = (lo[a] - origin[a]) / dir[a];
          let t2 = (hi[a] - origin[a]) / dir[a];
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) ok = false;
        }
      }
      if (ok && tmin < bestD) { bestD = tmin; best = m; }
    }
    return best ? { mob: best, dist: bestD } : null;
  }

  clear() { this.list.clear(); }
}
