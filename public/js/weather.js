// Weather: deterministic rain/snow cycle (a pure function of world time +
// seed, so every player sees the same sky without any network sync),
// rain/snow precipitation rendering, and thunder.
'use strict';

class Weather {
  constructor(seed) {
    this.seedNum = Noise.hashSeed(String(seed) + ':weather');
    this.drops = [];      // precipitation streaks around the camera
    this.flash = 0;       // lightning flash 0..1
    this.thunderT = 0;
    this._wasRaining = false;
  }

  // rain intensity 0..1 for a given world time — same on every client
  intensity(time) {
    const WINDOW = 190; // seconds per weather window
    const win = Math.floor(time / WINDOW);
    const raining = Noise.cellRand(this.seedNum, win, 1, 7) < 0.28;
    if (!raining) return 0;
    const tIn = time - win * WINDOW;
    const ramp = 14;
    return clamp(Math.min(tIn / ramp, (WINDOW - tIn) / ramp, 1), 0, 1);
  }

  tick(dt, time, world, cam, particlesLevel) {
    const rain = this.intensity(time);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);

    // rain sound on/off
    const audible = rain > 0.05;
    if (audible !== this._wasRaining) {
      this._wasRaining = audible;
      Sfx.rain(audible);
    }

    // thunder during heavy rain
    if (rain > 0.6) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 8 + Math.random() * 22;
        this.flash = 1;
        Sfx.thunder();
      }
    }

    // snow in cold biomes, rain elsewhere
    const biome = world.gen.biomeAt(Math.floor(cam.pos[0]), Math.floor(cam.pos[2]));
    const snowy = biome === 'snowy';

    const targetCount = rain <= 0 ? 0 : Math.round((snowy ? 90 : 170) * rain * particlesLevel);
    while (this.drops.length < targetCount) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 13;
      const x = cam.pos[0] + Math.cos(a) * r;
      const z = cam.pos[2] + Math.sin(a) * r;
      this.drops.push({ x, z, y: cam.pos[1] + 4 + Math.random() * 10, snow: snowy, drift: Math.random() * 6.28 });
    }
    if (this.drops.length > targetCount) this.drops.length = targetCount;

    for (const d of this.drops) {
      d.y -= dt * (d.snow ? 2.2 : 22);
      if (d.snow) d.x += Math.sin(time * 1.3 + d.drift) * dt * 0.6;
      // recycle when below ground or too far from the camera
      const gy = world.findGroundY(d.x, d.z);
      if (d.y < gy + 0.4 || dist2d(d.x, d.z, cam.pos[0], cam.pos[2]) > 18) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 13;
        d.x = cam.pos[0] + Math.cos(a) * r;
        d.z = cam.pos[2] + Math.sin(a) * r;
        d.y = cam.pos[1] + 6 + Math.random() * 10;
        d.snow = snowy;
      }
    }
    return rain;
  }

  // vertical streak quads (rain) / small flakes (snow); right = camera right
  buildMesh(right) {
    const uv = tileUV(TILE.WATER);
    const uvS = tileUV(TILE.SNOW_TOP);
    const out = new Float32Array(this.drops.length * 36);
    let o = 0;
    for (const d of this.drops) {
      const w = d.snow ? 0.05 : 0.025;
      const h = d.snow ? 0.05 : 0.55;
      const u = d.snow ? uvS : uv;
      const rx = right[0] * w, rz = right[2] * w;
      const corners = [
        [d.x - rx, d.y, d.z - rz], [d.x + rx, d.y, d.z + rz],
        [d.x + rx, d.y + h, d.z + rz], [d.x - rx, d.y + h, d.z - rz],
      ];
      const cu = [[u.u0, u.v1], [u.u1, u.v1], [u.u1, u.v0], [u.u0, u.v0]];
      for (const ci of [0, 1, 2, 0, 2, 3]) {
        out[o++] = corners[ci][0]; out[o++] = corners[ci][1]; out[o++] = corners[ci][2];
        out[o++] = cu[ci][0]; out[o++] = cu[ci][1];
        out[o++] = d.snow ? 1.0 : 0.8;
      }
    }
    return out;
  }

  stop() {
    if (this._wasRaining) { this._wasRaining = false; Sfx.rain(false); }
    this.drops = [];
  }
}
