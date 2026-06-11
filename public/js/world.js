// Chunk store: lazily generated terrain + an overlay of player edits.
'use strict';

class World {
  constructor(seed) {
    this.seed = seed;
    this.gen = createWorldGen(seed);
    this.chunks = new Map();   // "cx,cz" -> Uint8Array
    this.edits = new Map();    // "x,y,z" -> block id (server-synced overlay)
    this.dirty = new Set();    // chunk keys needing remesh
  }

  hasChunk(cx, cz) { return this.chunks.has(chunkKey(cx, cz)); }

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let data = this.chunks.get(key);
    if (data) return data;
    data = this.gen.genChunk(cx, cz);
    // apply known edits that fall inside this chunk
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (const [k, id] of this.edits) {
      const [x, y, z] = k.split(',').map(Number);
      if (x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK && y >= 0 && y < WORLD_H) {
        data[chunkIdx(x - x0, y, z - z0)] = id;
      }
    }
    this.chunks.set(key, data);
    return data;
  }

  unloadChunk(cx, cz) { this.chunks.delete(chunkKey(cx, cz)); }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_H) return BL.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const data = this.chunks.get(chunkKey(cx, cz));
    if (!data) return BL.AIR;
    return data[chunkIdx(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  // returns true if the chunk holding (x,z) is generated
  isLoaded(x, z) {
    return this.chunks.has(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  }

  setBlock(x, y, z, id, recordEdit = true) {
    if (y < 0 || y >= WORLD_H) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const data = this.chunks.get(chunkKey(cx, cz));
    if (recordEdit) this.edits.set(x + ',' + y + ',' + z, id);
    if (!data) return; // edit recorded; applied when chunk generates
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    data[chunkIdx(lx, y, lz)] = id;
    this.dirty.add(chunkKey(cx, cz));
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK - 1) this.dirty.add(chunkKey(cx + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK - 1) this.dirty.add(chunkKey(cx, cz + 1));
  }

  applyEditsObject(obj) {
    for (const k in obj) this.edits.set(k, obj[k]);
  }

  // top-most solid block at (x,z); -1 if none loaded/found
  findGroundY(x, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let y = WORLD_H - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(bx, y, bz))) return y;
    }
    return -1;
  }

  solidAt(x, y, z) { return isSolid(this.getBlock(x, y, z)); }

  // does AABB (centered at x,z; feet at y) intersect any solid block
  boxCollides(x, y, z, halfW, height) {
    const x0 = Math.floor(x - halfW), x1 = Math.floor(x + halfW);
    const y0 = Math.floor(y), y1 = Math.floor(y + height - 1e-7);
    const z0 = Math.floor(z - halfW), z1 = Math.floor(z + halfW);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++)
          if (this.solidAt(bx, by, bz)) return true;
    return false;
  }
}
