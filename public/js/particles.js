// Block-break particles and Minecraft-style item drop entities
// (spinning, bobbing mini-blocks you walk over to collect).
'use strict';

class Particles {
  constructor() {
    this.list = [];
  }

  // burst of texture-fragment particles when a block is destroyed
  burst(x, y, z, blockId, count = 16) {
    const tile = blockTile(blockId, 4);
    const uv = tileUV(tile);
    for (let i = 0; i < count; i++) {
      const u0 = uv.u0 + Math.random() * (uv.u1 - uv.u0) * 0.75;
      const v0 = uv.v0 + Math.random() * (uv.v1 - uv.v0) * 0.75;
      this.list.push({
        x: x + 0.15 + Math.random() * 0.7,
        y: y + 0.15 + Math.random() * 0.7,
        z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 4.5,
        vy: Math.random() * 4.5 + 1,
        vz: (Math.random() - 0.5) * 4.5,
        size: 0.06 + Math.random() * 0.07,
        u0, v0,
        du: (uv.u1 - uv.u0) * 0.25, dv: (uv.v1 - uv.v0) * 0.25,
        life: 0.45 + Math.random() * 0.4,
        light: 0.65 + Math.random() * 0.35,
      });
    }
    if (this.list.length > 600) this.list.splice(0, this.list.length - 600);
  }

  // small puffs while punching a block (spawned at the hit face)
  hit(target, blockId) {
    const tile = tileUV(blockTile(blockId, 4));
    const f = target.face;
    for (let i = 0; i < 2; i++) {
      const px = target.x + 0.5 + f[0] * 0.55 + (f[0] ? 0 : (Math.random() - 0.5) * 0.7);
      const py = target.y + 0.5 + f[1] * 0.55 + (f[1] ? 0 : (Math.random() - 0.5) * 0.7);
      const pz = target.z + 0.5 + f[2] * 0.55 + (f[2] ? 0 : (Math.random() - 0.5) * 0.7);
      this.list.push({
        x: px, y: py, z: pz,
        vx: f[0] * 1.4 + (Math.random() - 0.5) * 1.6,
        vy: f[1] * 1.4 + Math.random() * 1.8,
        vz: f[2] * 1.4 + (Math.random() - 0.5) * 1.6,
        size: 0.05 + Math.random() * 0.05,
        u0: tile.u0 + Math.random() * (tile.u1 - tile.u0) * 0.75,
        v0: tile.v0 + Math.random() * (tile.v1 - tile.v0) * 0.75,
        du: (tile.u1 - tile.u0) * 0.25, dv: (tile.v1 - tile.v0) * 0.25,
        life: 0.3 + Math.random() * 0.25,
        light: 0.65 + Math.random() * 0.35,
      });
    }
  }

  tick(dt, world) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      p.vy -= 16 * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (world.solidAt(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))) { p.vx = 0; } else p.x = nx;
      if (world.solidAt(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) {
        p.vy = 0; p.vx *= 0.7; p.vz *= 0.7;
      } else p.y = ny;
      if (world.solidAt(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))) { p.vz = 0; } else p.z = nz;
    }
  }

  // camera-facing quads; right/up are the camera basis vectors
  buildMesh(right, up) {
    const out = new Float32Array(this.list.length * 36);
    let o = 0;
    for (const p of this.list) {
      const s = p.size;
      const rx = right[0] * s, ry = right[1] * s, rz = right[2] * s;
      const ux = up[0] * s, uy = up[1] * s, uz = up[2] * s;
      const corners = [
        [p.x - rx - ux, p.y - ry - uy, p.z - rz - uz, p.u0, p.v0 + p.dv],
        [p.x + rx - ux, p.y + ry - uy, p.z + rz - uz, p.u0 + p.du, p.v0 + p.dv],
        [p.x + rx + ux, p.y + ry + uy, p.z + rz + uz, p.u0 + p.du, p.v0],
        [p.x - rx + ux, p.y - ry + uy, p.z - rz + uz, p.u0, p.v0],
      ];
      for (const ci of [0, 1, 2, 0, 2, 3]) {
        const c = corners[ci];
        out[o++] = c[0]; out[o++] = c[1]; out[o++] = c[2];
        out[o++] = c[3]; out[o++] = c[4]; out[o++] = p.light;
      }
    }
    return out;
  }
}

// ---------------- item drops ----------------

class Drops {
  constructor() {
    this.list = [];
  }

  spawn(id, x, y, z) {
    this.list.push({
      id,
      x, y, z,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 3 + Math.random() * 1.5,
      vz: (Math.random() - 0.5) * 2.4,
      age: 0,
      grounded: false,
      pickupDelay: 0.5, // can't collect instantly (like Minecraft)
    });
  }

  // onPickup(id) -> true if the inventory accepted it
  tick(dt, world, playerPos, onPickup) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      if (d.age > 300) { this.list.splice(i, 1); continue; }
      if (d.pickupDelay > 0) d.pickupDelay -= dt;

      // magnet toward a close player, collect when touching
      if (playerPos && d.pickupDelay <= 0) {
        const dx = playerPos[0] - d.x, dy = playerPos[1] + 0.9 - d.y, dz = playerPos[2] - d.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.6) {
          if (onPickup(d.id)) { this.list.splice(i, 1); continue; }
        } else if (dist < 1.8) {
          const pull = 7 * dt / Math.max(dist, 0.25);
          d.x += dx * pull; d.y += dy * pull; d.z += dz * pull;
          continue; // magnet overrides physics
        }
      }

      d.vy -= 18 * dt;
      if (d.vy < -22) d.vy = -22;
      const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt, nz = d.z + d.vz * dt;
      if (world.solidAt(Math.floor(nx), Math.floor(d.y + 0.1), Math.floor(d.z))) d.vx = 0; else d.x = nx;
      if (world.solidAt(Math.floor(d.x), Math.floor(ny), Math.floor(d.z))) {
        if (d.vy < 0) { d.y = Math.floor(ny) + 1.001; d.grounded = true; }
        d.vy = 0; d.vx *= 0.6; d.vz *= 0.6;
      } else { d.y = ny; d.grounded = false; }
      if (world.solidAt(Math.floor(d.x), Math.floor(d.y + 0.1), Math.floor(nz))) d.vz = 0; else d.z = nz;
      if (d.y < -40) this.list.splice(i, 1);
    }
  }

  // draws each drop as a spinning, bobbing mini block/item
  draw(renderer, getMesh, time) {
    for (const d of this.list) {
      const bob = Math.sin(time * 2.2 + d.x * 3.1) * 0.04 + 0.07;
      const s = ITEMS[d.id] ? 0.3 : 0.22; // item sprites a bit larger
      let m = M4.translate(d.x, d.y + bob, d.z);
      m = M4.mul(m, M4.rotY(time * 1.6 + d.x));
      m = M4.mul(m, M4.scale(s, s, s));
      m = M4.mul(m, M4.translate(-0.5, 0, -0.5));
      renderer.drawBox(getMesh(d.id), m, renderer.atlasTex, { alphaTest: true });
    }
  }

  clear() { this.list = []; }
}
