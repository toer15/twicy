// Local player: Minecraft-style physics, swimming, flying, health & damage.
'use strict';

const PHYS = {
  WALK: 4.32, SPRINT: 5.61, SNEAK: 1.31, WATER: 2.4,
  FLY: 10.9, FLY_SPRINT: 21.8, FLY_VERT: 8.4,
  ACCEL_GROUND: 75, ACCEL_AIR: 18, ACCEL_WATER: 32, ACCEL_FLY: 45,
  GRAV: 30, JUMP: 8.75, WATER_GRAV: 7.5, WATER_TERM: -3.4, SWIM_UP: 4.4,
};

class Player {
  constructor(world, mode) {
    this.world = world;
    this.mode = mode; // 'survival' | 'creative'
    this.pos = [0.5, WORLD_H, 0.5];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.inWater = false;
    this.eyesInWater = false;
    this.health = 20;
    this.air = 10;
    this.dead = false;
    this.fall = 0;
    this.lastDamage = -99;
    this.regenT = 0;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.hurtAnim = 0;
    this.walkDist = 0;       // for footstep sounds
    this.time = 0;
    this.onDamage = null;    // cb(amount)
    this.onDeath = null;
    this.spawn = [0.5, WORLD_H, 0.5];
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'survival') this.flying = false;
    else { this.health = 20; this.air = 10; }
  }

  teleport(p) {
    this.pos = p.slice();
    this.vel = [0, 0, 0];
    this.fall = 0;
  }

  respawn() {
    this.teleport(this.spawn);
    this.health = 20;
    this.air = 10;
    this.dead = false;
    // make sure we stand on ground, not inside it
    this._unstick();
  }

  _unstick() {
    let tries = 0;
    while (this.world.boxCollides(this.pos[0], this.pos[1], this.pos[2], PLAYER_HALF_W, PLAYER_HEIGHT) && tries++ < 60) {
      this.pos[1] += 1;
    }
  }

  toggleFly() {
    if (this.mode !== 'creative') return;
    this.flying = !this.flying;
    if (this.flying) this.vel[1] = 0;
    this.fall = 0;
  }

  eyeHeight() { return this.sneaking && !this.flying ? PLAYER_EYE - 0.12 : PLAYER_EYE; }

  // input: {f,b,l,r:0/1, jump, down, sprint, sneak}
  tick(dt, input) {
    this.time += dt;
    if (this.hurtAnim > 0) this.hurtAnim = Math.max(0, this.hurtAnim - dt);
    if (this.dead) return;
    const w = this.world;
    // never simulate while standing in an ungenerated chunk
    if (!w.isLoaded(this.pos[0], this.pos[2])) return;

    const feetBlock = w.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.2), Math.floor(this.pos[2]));
    const midBlock = w.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.9), Math.floor(this.pos[2]));
    const eyeBlock = w.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.eyeHeight()), Math.floor(this.pos[2]));
    const wasInWater = this.inWater;
    this.inWater = feetBlock === BL.WATER || midBlock === BL.WATER;
    this.eyesInWater = eyeBlock === BL.WATER;
    if (this.inWater && !wasInWater && this.vel[1] < -6) Sfx.splash();

    this.sneaking = !!input.sneak && !this.flying;
    this.sprinting = !!input.sprint && input.f && !this.sneaking;

    // --- horizontal movement ---
    let mx = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    let mz = (input.f ? 1 : 0) - (input.b ? 1 : 0);
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const dirX = fx * mz + rx * mx;
    const dirZ = fz * mz + rz * mx;

    let speed, accel;
    if (this.flying) {
      speed = this.sprinting ? PHYS.FLY_SPRINT : PHYS.FLY;
      accel = PHYS.ACCEL_FLY;
    } else if (this.inWater) {
      speed = PHYS.WATER;
      accel = PHYS.ACCEL_WATER;
    } else {
      speed = this.sneaking ? PHYS.SNEAK : this.sprinting ? PHYS.SPRINT : PHYS.WALK;
      accel = this.onGround ? PHYS.ACCEL_GROUND : PHYS.ACCEL_AIR;
    }
    const k = Math.min(1, accel * dt / speed);
    this.vel[0] += (dirX * speed - this.vel[0]) * k;
    this.vel[2] += (dirZ * speed - this.vel[2]) * k;

    // --- vertical movement ---
    if (this.flying) {
      const vy = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
      this.vel[1] += (vy * PHYS.FLY_VERT - this.vel[1]) * Math.min(1, 12 * dt);
      this.fall = 0;
    } else if (this.inWater) {
      this.vel[1] -= PHYS.WATER_GRAV * dt;
      if (this.vel[1] < PHYS.WATER_TERM) this.vel[1] = PHYS.WATER_TERM;
      if (input.jump) this.vel[1] += (PHYS.SWIM_UP - this.vel[1]) * Math.min(1, 10 * dt);
      this.fall = 0;
    } else {
      this.vel[1] -= PHYS.GRAV * dt;
      if (this.vel[1] < -50) this.vel[1] = -50;
      if (input.jump && this.onGround) {
        this.vel[1] = PHYS.JUMP;
        this.onGround = false;
      }
    }

    // --- integrate with collision ---
    const beforeY = this.vel[1];
    const wasGround = this.onGround;
    this._move(dt);

    // fall damage
    if (!this.flying && !this.inWater) {
      if (!this.onGround && this.vel[1] < 0) this.fall += -this.vel[1] * dt;
      else if (this.onGround && !wasGround) {
        if (this.fall > 3.4 && this.mode === 'survival') {
          this.damage(Math.floor(this.fall - 3));
        }
        this.fall = 0;
      } else if (this.onGround) {
        this.fall = 0;
      }
    } else {
      this.fall = 0;
    }

    // footsteps & view bob
    const hSpeed = Math.hypot(this.vel[0], this.vel[2]);
    if (this.onGround && hSpeed > 0.5) {
      this.walkDist += hSpeed * dt;
      if (this.walkDist > 2.2) { this.walkDist = 0; Sfx.step(); }
      this.bobPhase += dt * hSpeed * 1.85;
      this.bobAmp = Math.min(1, this.bobAmp + dt * 6);
    } else {
      this.bobAmp = Math.max(0, this.bobAmp - dt * 6);
    }

    // --- survival hazards ---
    if (this.mode === 'survival') {
      // drowning
      if (this.eyesInWater) {
        this.air -= dt;
        if (this.air <= 0) {
          this.air = 0;
          this._drownT = (this._drownT || 0) + dt;
          if (this._drownT >= 1) { this._drownT = 0; this.damage(2); }
        }
      } else {
        this.air = Math.min(10, this.air + dt * 3);
        this._drownT = 0;
      }
      // void
      if (this.pos[1] < -8) {
        this._voidT = (this._voidT || 0) + dt;
        if (this._voidT > 0.4) { this._voidT = 0; this.damage(3); }
      }
      // regeneration
      if (this.health < 20 && this.time - this.lastDamage > 5) {
        this.regenT += dt;
        if (this.regenT > 1.8) { this.regenT = 0; this.health = Math.min(20, this.health + 1); }
      }
    }
  }

  _move(dt) {
    let dx = this.vel[0] * dt, dy = this.vel[1] * dt, dz = this.vel[2] * dt;
    const sub = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
    let hitY = false;
    for (let i = 0; i < sub; i++) {
      if (this._axis(1, dy / sub)) { hitY = true; }
      if (this._axis(0, dx / sub)) this.vel[0] = 0;
      if (this._axis(2, dz / sub)) this.vel[2] = 0;
    }
    if (hitY) {
      this.onGround = this.vel[1] < 0;
      this.vel[1] = 0;
    } else {
      this.onGround = false;
    }
  }

  // move along one axis with exact snapping; returns true if blocked
  _axis(axis, delta) {
    if (delta === 0) return false;
    const w = this.world;
    const half = PLAYER_HALF_W, h = PLAYER_HEIGHT;
    const p = this.pos;
    const old = p[axis];
    p[axis] += delta;
    if (!w.boxCollides(p[0], p[1], p[2], half, h)) return false;
    // snap flush against the block boundary
    const eps = 0.001;
    if (axis === 1) {
      p[1] = delta > 0 ? Math.floor(p[1] + h) - h - eps : Math.floor(p[1]) + 1 + eps;
    } else {
      const c = p[axis];
      p[axis] = delta > 0 ? Math.floor(c + half) - half - eps : Math.ceil(c - half) + half + eps;
    }
    if (w.boxCollides(p[0], p[1], p[2], half, h)) p[axis] = old; // corner case: revert
    return true;
  }

  damage(n, silent) {
    if (this.mode === 'creative' || this.dead || n <= 0) return;
    this.health -= n;
    this.lastDamage = this.time;
    this.hurtAnim = 0.35; // Minecraft-style camera tilt
    if (!silent) Sfx.hurt();
    if (this.onDamage) this.onDamage(n);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (this.onDeath) this.onDeath();
    }
  }

  camera(viewBob) {
    let eyeY = this.pos[1] + this.eyeHeight();
    let ox = 0, roll = 0;
    if (viewBob && this.bobAmp > 0.01) {
      eyeY += Math.abs(Math.sin(this.bobPhase)) * 0.05 * this.bobAmp;
      ox = Math.cos(this.bobPhase) * 0.025 * this.bobAmp;
      roll = Math.sin(this.bobPhase) * 0.006 * this.bobAmp;
    }
    // hurt: sharp roll tilt that eases back (like Minecraft's damage wobble)
    if (this.hurtAnim > 0) roll += Math.sin((this.hurtAnim / 0.35) * Math.PI) * 0.05;
    // bob sideways offset along the right vector
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return {
      pos: [this.pos[0] + rx * ox, eyeY, this.pos[2] + rz * ox],
      yaw: this.yaw, pitch: this.pitch, roll,
    };
  }

  // is the given block position overlapping the player's AABB (placement check)
  intersectsBlock(bx, by, bz) {
    const half = PLAYER_HALF_W, h = PLAYER_HEIGHT;
    return bx + 1 > this.pos[0] - half && bx < this.pos[0] + half &&
           bz + 1 > this.pos[2] - half && bz < this.pos[2] + half &&
           by + 1 > this.pos[1] && by < this.pos[1] + h;
  }
}
