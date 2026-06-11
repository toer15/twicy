// Seeded 2D/3D gradient noise + fBM, deterministic across machines.
'use strict';

const Noise = (() => {
  // string/number -> 32-bit seed
  function hashSeed(s) {
    s = String(s);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makePerm(seed) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(512);
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const tmp = src[i]; src[i] = src[j]; src[j] = tmp;
    }
    for (let i = 0; i < 512; i++) p[i] = src[i & 255];
    return p;
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function nlerp(a, b, t) { return a + (b - a) * t; }

  const GRAD2 = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];

  function grad3(h, x, y, z) {
    switch (h & 15) {
      case 0: return x + y;   case 1: return -x + y;  case 2: return x - y;   case 3: return -x - y;
      case 4: return x + z;   case 5: return -x + z;  case 6: return x - z;   case 7: return -x - z;
      case 8: return y + z;   case 9: return -y + z;  case 10: return y - z;  case 11: return -y - z;
      case 12: return x + y;  case 13: return -y + z; case 14: return -x + y; default: return -y - z;
    }
  }

  // Perlin-style 2D noise in [-1, 1]
  function makeNoise2D(seed) {
    const p = makePerm(hashSeed(seed));
    return function (x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      x -= Math.floor(x); y -= Math.floor(y);
      const u = fade(x), v = fade(y);
      const g = (hash, xx, yy) => {
        const gr = GRAD2[hash & 7];
        return gr[0] * xx + gr[1] * yy;
      };
      const a = p[X] + Y, b = p[X + 1] + Y;
      return nlerp(
        nlerp(g(p[a], x, y), g(p[b], x - 1, y), u),
        nlerp(g(p[a + 1], x, y - 1), g(p[b + 1], x - 1, y - 1), u),
        v
      ) * 1.42;
    };
  }

  // Perlin-style 3D noise in [-1, 1]
  function makeNoise3D(seed) {
    const p = makePerm(hashSeed(seed));
    return function (x, y, z) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      const u = fade(x), v = fade(y), w = fade(z);
      const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
      const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
      return nlerp(
        nlerp(
          nlerp(grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z), u),
          nlerp(grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z), u), v),
        nlerp(
          nlerp(grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1), u),
          nlerp(grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1), u), v),
        w
      );
    };
  }

  // fractal Brownian motion over a 2D noise fn, roughly [-1, 1]
  function fbm2(noise, x, y, octaves, lacunarity, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  // deterministic per-cell hash in [0,1)
  function cellRand(seed, x, z, salt) {
    let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  return { hashSeed, mulberry32, makeNoise2D, makeNoise3D, fbm2, cellRand };
})();
