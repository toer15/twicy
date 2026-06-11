// Chunk meshing: visible-face extraction with per-vertex ambient occlusion.
// Vertex layout: x,y,z, u,v, light  (6 floats). Two buckets: solid (opaque +
// alpha-tested cutouts) and water (blended).
'use strict';

const MESH_FACES = [
  // dir, normal, 4 corner offsets (bottom-left, bottom-right, top-right, top-left
  // as seen from outside), shade
  { n: [1, 0, 0],  c: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], shade: 0.65 },
  { n: [-1, 0, 0], c: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], shade: 0.65 },
  { n: [0, 1, 0],  c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], shade: 0.55 },
  { n: [0, 0, 1],  c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], shade: 0.82 },
  { n: [0, 0, -1], c: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], shade: 0.82 },
];

function meshChunk(world, cx, cz) {
  const solid = [], water = [];
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const data = world.chunks.get(chunkKey(cx, cz));
  if (!data) return null;

  // neighbor-aware block lookup; outside generated area counts as opaque
  // so we never draw walls at the loading frontier
  const blockAt = (wx, wy, wz) => {
    if (wy < 0) return BL.BEDROCK;
    if (wy >= WORLD_H) return BL.AIR;
    if (wx >= x0 && wx < x0 + CHUNK && wz >= z0 && wz < z0 + CHUNK) {
      return data[chunkIdx(wx - x0, wy, wz - z0)];
    }
    const ncx = Math.floor(wx / CHUNK), ncz = Math.floor(wz / CHUNK);
    const nd = world.chunks.get(chunkKey(ncx, ncz));
    if (!nd) return BL.BEDROCK;
    return nd[chunkIdx(wx - ncx * CHUNK, wy, wz - ncz * CHUNK)];
  };
  const opaqueAt = (wx, wy, wz) => isOpaque(blockAt(wx, wy, wz));

  function aoLevel(occ) { return [0.45, 0.62, 0.8, 1.0][occ]; }

  for (let y = 0; y < WORLD_H; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const id = data[chunkIdx(x, y, z)];
        if (id === BL.AIR) continue;
        const def = BLOCKS[id];
        const wx = x0 + x, wz = z0 + z;

        if (def.cross) {
          pushCross(solid, wx, y, wz, blockTile(id, 0));
          continue;
        }

        const isWater = !!def.fluid;
        const out = isWater ? water : solid;
        const surfaced = isWater && blockAt(wx, y + 1, wz) !== BL.WATER;
        const topY = surfaced ? 0.875 : 1;

        for (let f = 0; f < 6; f++) {
          const face = MESH_FACES[f];
          const nb = blockAt(wx + face.n[0], y + face.n[1], wz + face.n[2]);
          if (isWater) {
            if (nb === BL.WATER) continue;
            if (isOpaque(nb)) continue;
          } else {
            if (isOpaque(nb)) continue;
            if (nb === id && (id === BL.GLASS || id === BL.LEAVES)) continue;
          }

          const tile = blockTile(id, f);
          const uv = tileUV(tile);
          const uvs = [[uv.u0, uv.v1], [uv.u1, uv.v1], [uv.u1, uv.v0], [uv.u0, uv.v0]];
          const verts = [];
          for (let ci = 0; ci < 4; ci++) {
            const co = face.c[ci];
            let vy = co[1] === 1 ? topY : 0;
            let light = face.shade;
            if (!isWater) {
              // ambient occlusion from the 3 blocks diagonal to this corner
              const sx = co[0] === 1 ? 1 : -1, sy = co[1] === 1 ? 1 : -1, sz = co[2] === 1 ? 1 : -1;
              let s1, s2, c1;
              if (face.n[0] !== 0) {
                s1 = opaqueAt(wx + face.n[0], y + sy, wz);
                s2 = opaqueAt(wx + face.n[0], y, wz + sz);
                c1 = opaqueAt(wx + face.n[0], y + sy, wz + sz);
              } else if (face.n[1] !== 0) {
                s1 = opaqueAt(wx + sx, y + face.n[1], wz);
                s2 = opaqueAt(wx, y + face.n[1], wz + sz);
                c1 = opaqueAt(wx + sx, y + face.n[1], wz + sz);
              } else {
                s1 = opaqueAt(wx + sx, y, wz + face.n[2]);
                s2 = opaqueAt(wx, y + sy, wz + face.n[2]);
                c1 = opaqueAt(wx + sx, y + sy, wz + face.n[2]);
              }
              const occ = (s1 && s2) ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c1 ? 1 : 0));
              light *= aoLevel(occ);
            }
            verts.push([wx + co[0], y + vy, wz + co[2], uvs[ci][0], uvs[ci][1], light]);
          }
          // flip quad diagonal when AO is anisotropic (avoids dark seams)
          const flip = verts[0][5] + verts[2][5] < verts[1][5] + verts[3][5];
          const order = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
          for (const vi of order) out.push(...verts[vi]);
        }
      }
    }
  }

  function pushCross(out, wx, y, wz, tile) {
    const uv = tileUV(tile);
    const quads = [
      [[0.07,0,0.07],[0.93,0,0.93],[0.93,1,0.93],[0.07,1,0.07]],
      [[0.93,0,0.07],[0.07,0,0.93],[0.07,1,0.93],[0.93,1,0.07]],
    ];
    for (const q of quads) {
      const verts = q.map((co, ci) => {
        const us = [[uv.u0, uv.v1], [uv.u1, uv.v1], [uv.u1, uv.v0], [uv.u0, uv.v0]][ci];
        return [wx + co[0], y + co[1], wz + co[2], us[0], us[1], 0.95];
      });
      for (const vi of [0, 1, 2, 0, 2, 3]) out.push(...verts[vi]);
    }
  }

  return {
    solid: new Float32Array(solid),
    water: new Float32Array(water),
    solidVerts: solid.length / 6,
    waterVerts: water.length / 6,
  };
}
