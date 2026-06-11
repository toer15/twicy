// Minimal column-major mat4 / vector math for WebGL.
'use strict';

const M4 = {
  ident() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  },
  // out = a * b  (apply b first, then a)
  mul(a, b, out) {
    out = out || new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      const b0 = b[c*4], b1 = b[c*4+1], b2 = b[c*4+2], b3 = b[c*4+3];
      out[c*4]   = a[0]*b0 + a[4]*b1 + a[8]*b2  + a[12]*b3;
      out[c*4+1] = a[1]*b0 + a[5]*b1 + a[9]*b2  + a[13]*b3;
      out[c*4+2] = a[2]*b0 + a[6]*b1 + a[10]*b2 + a[14]*b3;
      out[c*4+3] = a[3]*b0 + a[7]*b1 + a[11]*b2 + a[15]*b3;
    }
    return out;
  },
  translate(x, y, z) {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
  },
  scale(x, y, z) {
    return new Float32Array([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);
  },
  rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
  },
  rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
  },
  rotZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
  },
  perspective(fovYDeg, aspect, near, far) {
    const f = 1 / Math.tan(fovYDeg * Math.PI / 360);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },
  // FPS view matrix: V = rotX(-pitch) * rotY(-yaw) * translate(-eye)
  fpsView(eye, yaw, pitch) {
    const t = M4.translate(-eye[0], -eye[1], -eye[2]);
    const ry = M4.rotY(-yaw);
    const rx = M4.rotX(-pitch);
    return M4.mul(rx, M4.mul(ry, t));
  },
};

// Camera forward direction for yaw/pitch convention used everywhere:
// yaw=0 faces -Z; positive pitch looks up.
function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function dist2d(x1, z1, x2, z2) {
  const dx = x1 - x2, dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

// Voxel raycast (Amanatides & Woo). isSolid(x,y,z) -> bool.
// Returns {x,y,z, face:[nx,ny,nz], dist} or null.
function raycastVoxels(origin, dir, maxDist, isSolid) {
  let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
  const stepX = dir[0] > 0 ? 1 : -1, stepY = dir[1] > 0 ? 1 : -1, stepZ = dir[2] > 0 ? 1 : -1;
  const tDeltaX = dir[0] !== 0 ? Math.abs(1 / dir[0]) : Infinity;
  const tDeltaY = dir[1] !== 0 ? Math.abs(1 / dir[1]) : Infinity;
  const tDeltaZ = dir[2] !== 0 ? Math.abs(1 / dir[2]) : Infinity;
  const fracX = origin[0] - x, fracY = origin[1] - y, fracZ = origin[2] - z;
  let tMaxX = tDeltaX === Infinity ? Infinity : (dir[0] > 0 ? (1 - fracX) : fracX) * tDeltaX;
  let tMaxY = tDeltaY === Infinity ? Infinity : (dir[1] > 0 ? (1 - fracY) : fracY) * tDeltaY;
  let tMaxZ = tDeltaZ === Infinity ? Infinity : (dir[2] > 0 ? (1 - fracZ) : fracZ) * tDeltaZ;
  let face = [0, 0, 0];
  let t = 0;
  for (let i = 0; i < 256; i++) {
    if (isSolid(x, y, z)) return { x, y, z, face, dist: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
    if (t > maxDist) return null;
  }
  return null;
}
