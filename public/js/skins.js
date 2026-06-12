// Character skins: procedural 64x64 textures painted from palettes, plus
// the UV layout shared with the player model mesh in entities.js.
'use strict';

// Face strips per part: front, back, right, left, top, bottom (pixel rects).
function partLayout(ox, oy, w, h, d) {
  return {
    front:  { x: ox, y: oy, w, h },
    back:   { x: ox + w, y: oy, w, h },
    right:  { x: ox + w * 2, y: oy, w: d, h },
    left:   { x: ox + w * 2 + d, y: oy, w: d, h },
    top:    { x: ox + w * 2 + d * 2, y: oy, w, h: d },
    bottom: { x: ox + w * 3 + d * 2, y: oy, w, h: d },
  };
}

const SKIN_LAYOUT = {
  head: partLayout(0, 0, 8, 8, 8),
  body: partLayout(0, 8, 8, 12, 4),
  armR: partLayout(0, 20, 4, 12, 4),
  armL: partLayout(28, 20, 4, 12, 4),
  legR: partLayout(0, 32, 4, 12, 4),
  legL: partLayout(28, 32, 4, 12, 4),
};

const SKINS = [
  { id: 'explorer', name: 'Explorer', skin: '#eac08f', hair: '#4f3622', eyes: '#3a52c4', shirt: '#27a596', pants: '#3b4da0', shoes: '#5a5a5a', sleeves: 'skin' },
  { id: 'ranger', name: 'Ranger', skin: '#f0c8a0', hair: '#c46a2c', eyes: '#4d9143', shirt: '#5d7e3a', pants: '#54402c', shoes: '#3c2e1e', sleeves: 'skin' },
  { id: 'knight', name: 'Knight', skin: '#e0b48a', hair: '#888f99', eyes: '#39434f', shirt: '#9aa3ad', pants: '#6e7680', shoes: '#454c55', sleeves: 'shirt', helmet: true },
  { id: 'robot', name: 'Robot', skin: '#b8c0c8', hair: '#8f99a3', eyes: '#27e0f0', shirt: '#7c858f', pants: '#5c646e', shoes: '#3a4046', sleeves: 'shirt', glowEyes: true },
  { id: 'zombie', name: 'Zombie', skin: '#6ea25b', hair: '#4a7340', eyes: '#1c2b18', shirt: '#3d7068', pants: '#4a3a72', shoes: '#3a3a3a', sleeves: 'skin' },
  { id: 'royal', name: 'Royal', skin: '#f0c8a0', hair: '#e8d24c', eyes: '#7a3ab0', shirt: '#7a3ab0', pants: '#4c2570', shoes: '#d8b832', sleeves: 'shirt', crown: true },
  { id: 'miner', name: 'Miner', skin: '#e0b48a', hair: '#f0c828', eyes: '#54402c', shirt: '#c4622c', pants: '#4a4a52', shoes: '#2e2e2e', sleeves: 'shirt', helmet: true },
  { id: 'shadow', name: 'Shadow', skin: '#9088a8', hair: '#241f33', eyes: '#e03a5f', shirt: '#2c2640', pants: '#1c1830', shoes: '#15121f', sleeves: 'shirt' },
];

// humanoid mob palettes — usable by buildSkinCanvas but not player-selectable
const EXTRA_SKINS = {
  skeleton: { id: 'skeleton', name: 'Skeleton', skin: '#e8e8e0', hair: '#d8d8d0', eyes: '#1c1c1c',
    shirt: '#cfcfc6', pants: '#bdbdb4', shoes: '#a8a89e', sleeves: 'skin' },
};

function getSkin(id) { return SKINS.find(s => s.id === id) || EXTRA_SKINS[id] || SKINS[0]; }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((((n >> 16) & 255) * f) | 0, 0, 255);
  const g = clamp((((n >> 8) & 255) * f) | 0, 0, 255);
  const b = clamp(((n & 255) * f) | 0, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function buildSkinCanvas(skinId) {
  const s = getSkin(skinId);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');

  let rngState = Noise.hashSeed(s.id);
  const rnd = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0;
    return ((rngState >>> 9) % 1000) / 1000;
  };
  // fill a rect with subtle per-pixel shading for a cloth look
  function tex(rect, color) {
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        ctx.fillStyle = shade2(color, 0.92 + rnd() * 0.16);
        ctx.fillRect(rect.x + x, rect.y + y, 1, 1);
      }
  }
  function shade2(hex, f) { return shade(hex, f); }
  function px(rect, x, y, color) { ctx.fillStyle = color; ctx.fillRect(rect.x + x, rect.y + y, 1, 1); }

  const L = SKIN_LAYOUT;
  const sleeveCol = s.sleeves === 'shirt' ? s.shirt : s.skin;

  // head: hair everywhere, face on front
  for (const f of ['front', 'back', 'right', 'left', 'top']) tex(L.head[f], s.hair);
  tex(L.head.bottom, s.skin);
  const hf = L.head.front;
  for (let y = (s.helmet || s.crown) ? 3 : 2; y < 8; y++)
    for (let x = 0; x < 8; x++) px(hf, x, y, shade(s.skin, 0.94 + ((x * 3 + y * 7) % 5) * 0.025));
  // eyes
  const eyeY = 4;
  px(hf, 1, eyeY, s.glowEyes ? s.eyes : '#ffffff'); px(hf, 2, eyeY, s.eyes);
  px(hf, 5, eyeY, s.eyes); px(hf, 6, eyeY, s.glowEyes ? s.eyes : '#ffffff');
  // mouth
  px(hf, 3, 6, shade(s.skin, 0.72)); px(hf, 4, 6, shade(s.skin, 0.72));
  if (s.crown) {
    for (let x = 0; x < 8; x++) px(hf, x, 0, '#f5d62a');
    px(hf, 1, 1, '#f5d62a'); px(hf, 4, 1, '#f5d62a'); px(hf, 6, 1, '#f5d62a');
    px(hf, 4, 0, '#e03a5f');
  }
  if (s.helmet) for (let x = 0; x < 8; x++) { px(hf, x, 0, shade(s.hair, 1.25)); px(hf, x, 1, shade(s.hair, 1.1)); }

  // body: shirt with a belt line
  for (const f of ['front', 'back', 'right', 'left', 'top', 'bottom']) tex(L.body[f], s.shirt);
  for (let x = 0; x < 8; x++) px(L.body.front, x, 11, shade(s.pants, 0.8));
  px(L.body.front, 3, 11, '#d8b832'); px(L.body.front, 4, 11, '#d8b832');

  // arms: sleeve on top third, skin hands
  for (const arm of [L.armR, L.armL]) {
    for (const f of ['front', 'back', 'right', 'left', 'top', 'bottom']) tex(arm[f], sleeveCol);
    for (const f of ['front', 'back', 'right', 'left']) {
      const r = arm[f];
      for (let y = 9; y < 12; y++)
        for (let x = 0; x < r.w; x++) px(r, x, y, shade(s.skin, 0.95 + ((x + y) % 3) * 0.04));
    }
  }

  // legs: pants with shoes
  for (const leg of [L.legR, L.legL]) {
    for (const f of ['front', 'back', 'right', 'left', 'top', 'bottom']) tex(leg[f], s.pants);
    for (const f of ['front', 'back', 'right', 'left']) {
      const r = leg[f];
      for (let y = 10; y < 12; y++)
        for (let x = 0; x < r.w; x++) px(r, x, y, shade(s.shoes, 0.95 + ((x + y) % 2) * 0.08));
    }
  }
  return cv;
}

// front-facing 2D preview (for menus): head + body + arms + legs
function skinPreviewURL(skinId, scale = 7) {
  const skin = buildSkinCanvas(skinId);
  const cv = document.createElement('canvas');
  cv.width = 16 * scale; cv.height = 32 * scale;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const L = SKIN_LAYOUT;
  const blit = (r, dx, dy) => ctx.drawImage(skin, r.x, r.y, r.w, r.h, dx * scale, dy * scale, r.w * scale, r.h * scale);
  blit(L.head.front, 4, 0);
  blit(L.body.front, 4, 8);
  blit(L.armR.front, 0, 8);
  blit(L.armL.front, 12, 8);
  blit(L.legR.front, 4, 20);
  blit(L.legL.front, 8, 20);
  return cv.toDataURL();
}

// uv rect helper for the model mesh (64x64 texture space)
function skinUV(rect) {
  const pad = 0.05 / 64;
  return { u0: rect.x / 64 + pad, v0: rect.y / 64 + pad, u1: (rect.x + rect.w) / 64 - pad, v1: (rect.y + rect.h) / 64 - pad };
}
