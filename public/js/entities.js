// Remote player entities: interpolation, Minecraft-style model + animations.
'use strict';

const MODEL_SCALE = 1.8 / 32; // 1 skin pixel = this many world units

// part geometry built once; uv comes from SKIN_LAYOUT (same for all skins)
function makePartMesh(renderer, part, w, h, d) {
  const L = SKIN_LAYOUT[part];
  // cube faces: 0:+X(left) 1:-X(right) 2:+Y(top) 3:-Y(bottom) 4:+Z(back) 5:-Z(front)
  const uvFor = f => skinUV([L.left, L.right, L.top, L.bottom, L.back, L.front][f]);
  const S = MODEL_SCALE;
  return renderer.makeMesh(makeCubeVerts(w * S, h * S, d * S, uvFor, 1));
}

function buildPlayerMeshes(renderer) {
  return {
    head: makePartMesh(renderer, 'head', 8, 8, 8),
    body: makePartMesh(renderer, 'body', 8, 12, 4),
    armR: makePartMesh(renderer, 'armR', 4, 12, 4),
    armL: makePartMesh(renderer, 'armL', 4, 12, 4),
    legR: makePartMesh(renderer, 'legR', 4, 12, 4),
    legL: makePartMesh(renderer, 'legL', 4, 12, 4),
  };
}

// computes part model matrices for a pose, using Minecraft's animation curves
// pose: {pos:[x,y,z] feet, bodyYaw, headYaw, pitch, walkPhase, walkAmp, swing (0..1 or -1), sneak, time}
function playerPartMatrices(pose) {
  const S = MODEL_SCALE;
  const px = v => v * S;
  const root = M4.mul(M4.translate(pose.pos[0], pose.pos[1], pose.pos[2]), M4.rotY(pose.bodyYaw));
  const parts = {};
  const at = (pivot, rot, offset) =>
    M4.mul(root, M4.mul(M4.translate(px(pivot[0]), px(pivot[1]), px(pivot[2])),
      M4.mul(rot, M4.translate(px(offset[0]), px(offset[1]), px(offset[2])))));

  const wp = pose.walkPhase || 0, amp = Math.min(pose.walkAmp || 0, 1.35);
  // Minecraft: legs cos(t)*1.4*amp, arms opposite at ~0.7 of leg swing
  const legSwing = Math.cos(wp) * 1.35 * amp;
  const armSwing = Math.cos(wp + Math.PI) * 0.95 * amp;
  const idle = Math.sin((pose.time || 0) * 1.05) * 0.04; // idle arm sway (zRot in MC)

  // punch: MC combines two eased sines on the swing progress
  let punchX = 0, punchY = 0;
  if (pose.swing >= 0 && pose.swing <= 1) {
    const p = pose.swing;
    punchX = Math.sin(Math.sqrt(p) * Math.PI) * 1.35 + Math.sin(p * Math.PI) * 0.45;
    punchY = Math.sin(Math.sqrt(p) * Math.PI) * 0.35;
  }

  const sneak = !!pose.sneak;
  const lean = sneak ? -0.5 : 0; // torso pitches forward when sneaking
  // pivots shift when the torso leans (neck/shoulders follow the hip rotation)
  const cos = Math.cos(lean), sin = Math.sin(lean);
  const neck = [0, 12 + 12 * cos, 12 * sin];
  const shoulderY = 12 + 10 * cos, shoulderZ = 10 * sin;

  const headRot = M4.mul(M4.rotY(pose.headYaw - pose.bodyYaw), M4.rotX(-pose.pitch + (sneak ? -0.2 : 0)));
  parts.head = at(neck, headRot, [-4, sneak ? -1 : 0, -4]);
  parts.body = at([0, 12, 0], M4.rotX(lean), [-4, 0, -2]);
  const armLean = sneak ? -0.45 : 0;
  parts.armR = at([-6, shoulderY, shoulderZ],
    M4.mul(M4.rotY(-punchY), M4.mul(M4.rotX(-armSwing - punchX + armLean), M4.rotZ(idle + 0.05))), [-2, -10, -2]);
  parts.armL = at([6, shoulderY, shoulderZ],
    M4.mul(M4.rotX(armSwing + armLean * 0.7), M4.rotZ(-idle - 0.05)), [-2, -10, -2]);
  parts.legR = at([-2, 12, 0], M4.rotX(legSwing), [-2, -12, -2]);
  parts.legL = at([2, 12, 0], M4.rotX(-legSwing), [-2, -12, -2]);
  return parts;
}

class RemotePlayers {
  constructor() {
    this.map = new Map(); // id -> rp
  }

  add(info) {
    const st = info.state || {};
    const pos = st.p ? st.p.slice() : [0.5, 80, 0.5];
    this.map.set(info.id, {
      id: info.id, name: info.name, skin: info.skin || 'explorer',
      pos, target: pos.slice(),
      yaw: st.yaw || 0, pitch: st.pitch || 0,
      targetYaw: st.yaw || 0, targetPitch: st.pitch || 0,
      bodyYaw: st.yaw || 0, sneak: !!st.sn,
      walkPhase: 0, walkAmp: 0, speed: 0,
      swingT: -1, lastStateAt: 0, tag: null,
    });
  }

  remove(id) { this.map.delete(id); }
  get(id) { return this.map.get(id); }
  clear() { this.map.clear(); }
  get count() { return this.map.size; }

  onState(msg, now) {
    const rp = this.map.get(msg.id);
    if (!rp) return;
    const dtNet = Math.min(0.5, Math.max(0.04, now - rp.lastStateAt));
    rp.lastStateAt = now;
    if (msg.p) {
      const d = dist2d(msg.p[0], msg.p[2], rp.target[0], rp.target[2]);
      rp.speed = d / dtNet;
      // teleport on big jumps
      if (d > 12) { rp.pos = msg.p.slice(); rp.speed = 0; }
      rp.target = msg.p.slice();
    }
    if (msg.yaw !== undefined) rp.targetYaw = msg.yaw;
    if (msg.pitch !== undefined) rp.targetPitch = msg.pitch;
    rp.sneak = !!msg.sn;
    if (msg.swing) rp.swingT = 0;
  }

  tick(dt, time) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    for (const rp of this.map.values()) {
      // no fresh updates -> they stopped; don't keep walking in place
      if (now - rp.lastStateAt > 0.5) rp.speed = 0;
      const k = Math.min(1, dt * 12);
      for (let i = 0; i < 3; i++) rp.pos[i] = lerp(rp.pos[i], rp.target[i], k);
      rp.yaw = lerpAngle(rp.yaw, rp.targetYaw, Math.min(1, dt * 16));
      rp.pitch = lerp(rp.pitch, rp.targetPitch, Math.min(1, dt * 16));
      const moving = rp.speed > 0.3;
      rp.walkAmp = lerp(rp.walkAmp, moving ? Math.min(1.3, rp.speed / 4.3) : 0, Math.min(1, dt * 8));
      rp.walkPhase += dt * Math.max(rp.speed, moving ? 3 : 0) * 2.6;
      // body follows movement/look direction with lag
      rp.bodyYaw = lerpAngle(rp.bodyYaw, rp.targetYaw, Math.min(1, dt * (moving ? 10 : 3)));
      if (rp.swingT >= 0) {
        rp.swingT += dt;
        if (rp.swingT > 0.3) rp.swingT = -1;
      }
    }
  }

  draw(renderer, meshes, getSkinTex, time) {
    for (const rp of this.map.values()) {
      const parts = playerPartMatrices({
        pos: rp.pos, bodyYaw: rp.bodyYaw, headYaw: rp.yaw, pitch: rp.pitch,
        walkPhase: rp.walkPhase, walkAmp: rp.walkAmp, sneak: rp.sneak,
        swing: rp.swingT >= 0 ? rp.swingT / 0.3 : -1, time,
      });
      const tex = getSkinTex(rp.skin);
      for (const name in parts) renderer.drawBox(meshes[name], parts[name], tex);
    }
  }

  drawNametags(renderer) {
    for (const rp of this.map.values()) {
      if (!rp.tag) rp.tag = renderer.makeTextTexture(rp.name);
      renderer.drawNametag(rp.tag, rp.pos[0], rp.pos[1] + 2.25, rp.pos[2]);
    }
  }
}
