// Procedural terrain: biomes, oceans, mountains, caves, ores, trees, plants.
// Fully deterministic from the seed — server only stores player edits.
'use strict';

function createWorldGen(seed) {
  const seedNum = Noise.hashSeed(seed);
  const nCont = Noise.makeNoise2D(seed + ':continent');
  const nRidge = Noise.makeNoise2D(seed + ':ridge');
  const nTemp = Noise.makeNoise2D(seed + ':temp');
  const nMoist = Noise.makeNoise2D(seed + ':moist');
  const nCave1 = Noise.makeNoise3D(seed + ':cave1');
  const nCave2 = Noise.makeNoise3D(seed + ':cave2');

  function heightAt(x, z) {
    const c = Noise.fbm2(nCont, x / 280, z / 280, 4, 2, 0.5);
    let h = SEA + 5 + c * 17;
    let m = Noise.fbm2(nRidge, x / 190, z / 190, 4, 2, 0.5);
    if (m > 0.12) h += (m - 0.12) * 75;
    return Math.max(4, Math.min(WORLD_H - 12, Math.floor(h)));
  }

  function tempAt(x, z) { return Noise.fbm2(nTemp, x / 480 + 31.7, z / 480 - 12.3, 3, 2, 0.5); }
  function moistAt(x, z) { return Noise.fbm2(nMoist, x / 360 - 7.1, z / 360 + 19.9, 3, 2, 0.5); }

  function biomeAt(x, z) {
    const h = heightAt(x, z);
    if (h < SEA) return 'ocean';
    const t = tempAt(x, z), m = moistAt(x, z);
    if (h > 68) return 'mountains';
    if (t < -0.32) return 'snowy';
    if (t > 0.34 && m < 0.1) return 'desert';
    if (m > 0.05) return 'forest';
    return 'plains';
  }

  function chunkRng(cx, cz, salt) {
    return Noise.mulberry32((seedNum ^ Math.imul(cx, 0x9E3779B1) ^ Math.imul(cz, 0x85EBCA77) ^ Math.imul(salt, 0xC2B2AE35)) >>> 0);
  }

  // Trees/cacti planned per-chunk so neighbors can render the overhang.
  function decorationsFor(cx, cz) {
    const out = [];
    const rng = chunkRng(cx, cz, 101);
    for (let i = 0; i < 8; i++) {
      const x = cx * CHUNK + ((rng() * CHUNK) | 0);
      const z = cz * CHUNK + ((rng() * CHUNK) | 0);
      const r = rng();
      const biome = biomeAt(x, z);
      const h = heightAt(x, z);
      if (h <= SEA + 1) continue;
      if (biome === 'forest' && r < 0.8) out.push({ type: 'tree', x, z, h, th: 4 + ((rng() * 3) | 0) });
      else if (biome === 'plains' && r < 0.12) out.push({ type: 'tree', x, z, h, th: 4 + ((rng() * 2) | 0) });
      else if (biome === 'snowy' && r < 0.2) out.push({ type: 'tree', x, z, h, th: 5 + ((rng() * 2) | 0) });
      else if (biome === 'desert' && r < 0.35) out.push({ type: 'cactus', x, z, h, th: 2 + ((rng() * 2) | 0) });
      else if (biome === 'plains' && r < 0.18) out.push({ type: 'pumpkin', x, z, h });
    }
    return out;
  }

  function genChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * WORLD_H);
    const heights = new Int16Array(CHUNK * CHUNK);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;

    // base terrain + water
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const wx = x0 + x, wz = z0 + z;
        const h = heightAt(wx, wz);
        heights[x + z * CHUNK] = h;
        const biome = biomeAt(wx, wz);
        const beach = h >= SEA - 1 && h <= SEA + 2 && biome !== 'snowy';
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = BL.BEDROCK;
          else if (y < 3 && Noise.cellRand(seedNum, wx * 7 + y, wz * 13, 5) < 0.5) id = BL.BEDROCK;
          else if (y < h - 3) id = BL.STONE;
          else if (y < h) {
            id = (biome === 'desert' || beach || h < SEA) ? (y < h - 1 ? BL.SANDSTONE : BL.SAND) : BL.DIRT;
          } else { // surface block
            if (h < SEA) id = Noise.cellRand(seedNum, wx, wz, 9) < 0.4 ? BL.GRAVEL : BL.SAND;
            else if (beach || biome === 'desert') id = BL.SAND;
            else if (biome === 'snowy' || h > 74) id = BL.SNOW;
            else if (biome === 'mountains') id = BL.STONE;
            else id = BL.GRASS;
          }
          data[chunkIdx(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA; y++) data[chunkIdx(x, y, z)] = BL.WATER;
      }
    }

    // caves: two ridged 3D noises make spaghetti tunnels
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const wx = x0 + x, wz = z0 + z;
        const h = heights[x + z * CHUNK];
        const top = h > SEA + 2 ? h : h - 4; // no surface holes near/under water
        for (let y = 3; y <= top; y++) {
          const c1 = nCave1(wx / 42, y / 26, wz / 42);
          if (c1 > 0.16 || c1 < -0.16) continue;
          const c2 = nCave2(wx / 42, y / 30, wz / 42);
          if (c2 > 0.16 || c2 < -0.16) continue;
          const id = data[chunkIdx(x, y, z)];
          if (id !== BL.BEDROCK && id !== BL.WATER) data[chunkIdx(x, y, z)] = BL.AIR;
        }
      }
    }

    // ores (replace stone)
    const rng = chunkRng(cx, cz, 55);
    const oreSpecs = [
      [BL.COAL_ORE, 13, 12, 60, 5], [BL.IRON_ORE, 9, 4, 40, 4],
      [BL.GOLD_ORE, 4, 3, 24, 3], [BL.DIAMOND_ORE, 3, 3, 14, 3],
    ];
    for (const [ore, attempts, yMin, yMax, veinMax] of oreSpecs) {
      for (let i = 0; i < attempts; i++) {
        let ox = (rng() * CHUNK) | 0, oz = (rng() * CHUNK) | 0;
        let oy = yMin + ((rng() * (yMax - yMin)) | 0);
        const vein = 2 + ((rng() * (veinMax - 1)) | 0);
        for (let v = 0; v < vein; v++) {
          if (ox >= 0 && ox < CHUNK && oz >= 0 && oz < CHUNK && oy > 0 && oy < WORLD_H) {
            if (data[chunkIdx(ox, oy, oz)] === BL.STONE) data[chunkIdx(ox, oy, oz)] = ore;
          }
          const d = (rng() * 6) | 0;
          if (d === 0) ox++; else if (d === 1) ox--; else if (d === 2) oz++;
          else if (d === 3) oz--; else if (d === 4) oy++; else oy--;
        }
      }
    }

    // decorations from this chunk and neighbors (trees overhang boundaries)
    for (let dcz = cz - 1; dcz <= cz + 1; dcz++) {
      for (let dcx = cx - 1; dcx <= cx + 1; dcx++) {
        for (const dec of decorationsFor(dcx, dcz)) {
          placeDecoration(data, x0, z0, dec, seedNum);
        }
      }
    }

    // flowers & tall grass on grass blocks of this chunk
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const wx = x0 + x, wz = z0 + z;
        const h = heights[x + z * CHUNK];
        if (h + 1 >= WORLD_H) continue;
        if (data[chunkIdx(x, h, z)] !== BL.GRASS || data[chunkIdx(x, h + 1, z)] !== BL.AIR) continue;
        const r = Noise.cellRand(seedNum, wx, wz, 21);
        if (r < 0.016) data[chunkIdx(x, h + 1, z)] = BL.FLOWER_RED;
        else if (r < 0.034) data[chunkIdx(x, h + 1, z)] = BL.FLOWER_YELLOW;
        else if (r < 0.13) data[chunkIdx(x, h + 1, z)] = BL.TALLGRASS;
      }
    }

    return data;
  }

  function placeDecoration(data, x0, z0, dec, seedNum) {
    const set = (wx, wy, wz, id, onlyAir) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || wy < 0 || wy >= WORLD_H) return;
      const cur = data[chunkIdx(x, wy, z)];
      if (onlyAir && cur !== BL.AIR) return;
      if (!onlyAir && cur === BL.BEDROCK) return;
      data[chunkIdx(x, wy, z)] = id;
    };
    if (dec.type === 'tree') {
      const { x, z, h, th } = dec;
      // leaf blob
      for (let ly = h + th - 2; ly <= h + th + 1; ly++) {
        const r = ly >= h + th ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (dx === 0 && dz === 0 && ly <= h + th) continue;
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (r === 1 || Noise.cellRand(seedNum, x + dx, z + dz, ly) < 0.55)) continue;
            set(x + dx, ly, z + dz, BL.LEAVES, true);
          }
        }
      }
      set(x, h + th + 1, z, BL.LEAVES, true);
      for (let y = h + 1; y <= h + th; y++) set(x, y, z, BL.LOG, false);
    } else if (dec.type === 'cactus') {
      for (let y = dec.h + 1; y <= dec.h + dec.th; y++) set(dec.x, y, dec.z, BL.CACTUS, true);
    } else if (dec.type === 'pumpkin') {
      set(dec.x, dec.h + 1, dec.z, BL.PUMPKIN, true);
    }
  }

  function findSpawn() {
    for (let r = 0; r < 80; r += 4) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = Math.floor(Math.cos(ang) * r), z = Math.floor(Math.sin(ang) * r);
        const h = heightAt(x, z);
        if (h > SEA + 1 && h < 64) return [x + 0.5, h + 1, z + 0.5];
      }
    }
    return [0.5, heightAt(0, 0) + 1, 0.5];
  }

  return { heightAt, biomeAt, genChunk, findSpawn, decorationsFor };
}
