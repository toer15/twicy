// Procedural 16x16 pixel-art texture atlas (256x256, 16x16 tiles).
// TILE indices are safe to use headless; buildAtlas() requires a canvas.
'use strict';

const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, COBBLE: 4, BEDROCK: 5,
  SAND: 6, SANDSTONE_SIDE: 7, SANDSTONE_TOP: 8, LOG_SIDE: 9, LOG_TOP: 10,
  PLANKS: 11, LEAVES: 12, GLASS: 13, BRICK: 14, SNOW_TOP: 15,
  SNOW_SIDE: 16, WATER: 17, CACTUS_SIDE: 18, CACTUS_TOP: 19,
  COAL_ORE: 20, IRON_ORE: 21, GOLD_ORE: 22, DIAMOND_ORE: 23, GRAVEL: 24,
  WOOL_WHITE: 25, WOOL_RED: 26, WOOL_GREEN: 27, WOOL_BLUE: 28,
  WOOL_YELLOW: 29, WOOL_BLACK: 30,
  FLOWER_RED: 31, FLOWER_YELLOW: 32, TALLGRASS: 33,
  GLOWSTONE: 34, BOOKSHELF: 35, PUMPKIN_SIDE: 36, PUMPKIN_TOP: 37,
  CRACK_0: 40, // 40..49 are the 10 break-progress stages
  SUN: 50, MOON: 51,
  CRAFT_TOP: 52, CRAFT_SIDE: 53,
  ITEM_STICK: 54,
  ITEM_PICK_WOOD: 55, ITEM_PICK_STONE: 56,
  ITEM_AXE_WOOD: 57, ITEM_AXE_STONE: 58,
  ITEM_SHOVEL_WOOD: 59, ITEM_SHOVEL_STONE: 60,
};

const ATLAS_TILES = 16;        // tiles per row
const ATLAS_PX = 256;          // atlas size in pixels
const TILE_PX = 16;

// uv rect for a tile index, with a half-texel inset against bleeding
function tileUV(tile) {
  const tx = tile % ATLAS_TILES, ty = Math.floor(tile / ATLAS_TILES);
  const s = TILE_PX / ATLAS_PX, pad = 0.5 / ATLAS_PX;
  return { u0: tx * s + pad, v0: ty * s + pad, u1: (tx + 1) * s - pad, v1: (ty + 1) * s - pad };
}

function buildAtlas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_PX;
  const ctx = cv.getContext('2d');

  // tiny deterministic rng for texture speckling
  let rngState = 12345;
  const rnd = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0;
    return ((rngState >>> 9) % 1000) / 1000;
  };

  function px(tile, x, y, color) {
    const tx = (tile % ATLAS_TILES) * TILE_PX, ty = Math.floor(tile / ATLAS_TILES) * TILE_PX;
    ctx.fillStyle = color;
    ctx.fillRect(tx + x, ty + y, 1, 1);
  }
  function fill(tile, color) {
    const tx = (tile % ATLAS_TILES) * TILE_PX, ty = Math.floor(tile / ATLAS_TILES) * TILE_PX;
    ctx.fillStyle = color;
    ctx.fillRect(tx, ty, TILE_PX, TILE_PX);
  }
  function clearTile(tile) {
    const tx = (tile % ATLAS_TILES) * TILE_PX, ty = Math.floor(tile / ATLAS_TILES) * TILE_PX;
    ctx.clearRect(tx, ty, TILE_PX, TILE_PX);
  }
  // fill with per-pixel jitter between shades
  function speckle(tile, shades) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        px(tile, x, y, shades[(rnd() * shades.length) | 0]);
  }
  function sprinkle(tile, color, count) {
    for (let i = 0; i < count; i++) px(tile, (rnd() * 16) | 0, (rnd() * 16) | 0, color);
  }

  // --- terrain ---
  speckle(TILE.GRASS_TOP, ['#5fae3f', '#55a437', '#67b746', '#4f9c33']);
  speckle(TILE.DIRT, ['#8a6244', '#7d573c', '#96704e', '#835d40']);
  speckle(TILE.GRASS_SIDE, ['#8a6244', '#7d573c', '#96704e', '#835d40']);
  for (let x = 0; x < 16; x++) {
    const h = 3 + ((x * 7) % 3);
    for (let y = 0; y < h; y++)
      px(TILE.GRASS_SIDE, x, y, ['#5fae3f', '#55a437', '#67b746'][(x + y) % 3]);
  }
  speckle(TILE.STONE, ['#8f8f8f', '#848484', '#9a9a9a', '#888']);
  speckle(TILE.COBBLE, ['#7a7a7a', '#8d8d8d', '#676767', '#999']);
  // cobble cracks
  for (let i = 0; i < 6; i++) {
    const cx = (rnd() * 13 + 1) | 0, cy = (rnd() * 13 + 1) | 0;
    px(TILE.COBBLE, cx, cy, '#4f4f4f'); px(TILE.COBBLE, cx + 1, cy, '#525252');
    px(TILE.COBBLE, cx, cy + 1, '#565656');
  }
  speckle(TILE.BEDROCK, ['#3a3a3a', '#555', '#2c2c2c', '#666']);
  speckle(TILE.SAND, ['#e7dca6', '#ddd29b', '#efe5b2', '#d8cc92']);
  speckle(TILE.GRAVEL, ['#9b938b', '#857d75', '#aaa298', '#76716b']);
  speckle(TILE.SANDSTONE_TOP, ['#e2d49a', '#d9cb90', '#e9dca5']);
  speckle(TILE.SANDSTONE_SIDE, ['#e2d49a', '#d9cb90', '#e9dca5']);
  for (let x = 0; x < 16; x++) { px(TILE.SANDSTONE_SIDE, x, 4, '#c9b97c'); px(TILE.SANDSTONE_SIDE, x, 10, '#c9b97c'); }

  // --- wood / plants ---
  speckle(TILE.LOG_SIDE, ['#6b5232', '#5e4729', '#76603d']);
  for (let y = 0; y < 16; y++) { px(TILE.LOG_SIDE, 3, y, '#4e3a1f'); px(TILE.LOG_SIDE, 9, y, '#4e3a1f'); px(TILE.LOG_SIDE, 13, y, '#553f23'); }
  speckle(TILE.LOG_TOP, ['#6b5232', '#5e4729']);
  ctx.fillStyle = '#b58e58';
  {
    const tx = (TILE.LOG_TOP % 16) * 16, ty = Math.floor(TILE.LOG_TOP / 16) * 16;
    ctx.fillRect(tx + 3, ty + 3, 10, 10);
    ctx.fillStyle = '#9c7944'; ctx.fillRect(tx + 5, ty + 5, 6, 6);
    ctx.fillStyle = '#b58e58'; ctx.fillRect(tx + 7, ty + 7, 2, 2);
  }
  speckle(TILE.PLANKS, ['#a8824e', '#9d7846', '#b28a55']);
  for (let x = 0; x < 16; x++) { px(TILE.PLANKS, x, 3, '#7c5c33'); px(TILE.PLANKS, x, 7, '#7c5c33'); px(TILE.PLANKS, x, 11, '#7c5c33'); px(TILE.PLANKS, x, 15, '#7c5c33'); }
  clearTile(TILE.LEAVES);
  speckle(TILE.LEAVES, ['#3e7a26', '#356b1f', '#46892c', '#2f6019']);
  // punch a few transparent holes in leaves
  {
    const tx = (TILE.LEAVES % 16) * 16, ty = Math.floor(TILE.LEAVES / 16) * 16;
    for (let i = 0; i < 10; i++) ctx.clearRect(tx + ((rnd() * 16) | 0), ty + ((rnd() * 16) | 0), 1, 1);
  }
  speckle(TILE.CACTUS_SIDE, ['#4c7d2a', '#558a31', '#446f24']);
  for (let y = 0; y < 16; y++) { px(TILE.CACTUS_SIDE, 0, y, '#699e44'); px(TILE.CACTUS_SIDE, 15, y, '#699e44'); px(TILE.CACTUS_SIDE, 4, y, y % 4 < 2 ? '#2f5417' : '#446f24'); px(TILE.CACTUS_SIDE, 11, y, y % 4 > 1 ? '#2f5417' : '#446f24'); }
  speckle(TILE.CACTUS_TOP, ['#558a31', '#4c7d2a']);

  // --- building ---
  fill(TILE.BRICK, '#9a4f43');
  for (let y = 0; y < 16; y += 4)
    for (let x = 0; x < 16; x++) px(TILE.BRICK, x, y, '#d8d3cd');
  for (let row = 0; row < 4; row++) {
    const off = row % 2 === 0 ? 3 : 7;
    for (let y = row * 4 + 1; y < row * 4 + 4 && y < 16; y++) {
      px(TILE.BRICK, off, y, '#d8d3cd'); px(TILE.BRICK, (off + 8) % 16, y, '#d8d3cd');
    }
  }
  sprinkle(TILE.BRICK, '#8a4439', 30);
  clearTile(TILE.GLASS);
  {
    const tx = (TILE.GLASS % 16) * 16, ty = Math.floor(TILE.GLASS / 16) * 16;
    ctx.fillStyle = 'rgba(200,230,240,0.9)';
    ctx.fillRect(tx, ty, 16, 1); ctx.fillRect(tx, ty + 15, 16, 1);
    ctx.fillRect(tx, ty, 1, 16); ctx.fillRect(tx + 15, ty, 1, 16);
    ctx.fillStyle = 'rgba(235,250,255,0.55)';
    ctx.fillRect(tx + 2, ty + 2, 1, 4); ctx.fillRect(tx + 3, ty + 2, 1, 2);
    ctx.fillRect(tx + 11, ty + 9, 1, 4); ctx.fillRect(tx + 12, ty + 10, 1, 2);
  }
  speckle(TILE.SNOW_TOP, ['#f4fbfd', '#eaf4f8', '#ffffff']);
  speckle(TILE.SNOW_SIDE, ['#8a6244', '#7d573c', '#96704e']);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) px(TILE.SNOW_SIDE, x, y, ['#f4fbfd', '#ffffff'][(x + y) % 2]);
  fill(TILE.WATER, 'rgba(40,82,180,0.78)');
  {
    const tx = (TILE.WATER % 16) * 16, ty = Math.floor(TILE.WATER / 16) * 16;
    ctx.fillStyle = 'rgba(90,130,220,0.8)';
    for (let i = 0; i < 7; i++) ctx.fillRect(tx + ((rnd() * 12) | 0), ty + ((rnd() * 14) | 0), 4, 1);
    ctx.fillStyle = 'rgba(20,50,140,0.8)';
    for (let i = 0; i < 5; i++) ctx.fillRect(tx + ((rnd() * 12) | 0), ty + ((rnd() * 14) | 0), 3, 1);
  }
  speckle(TILE.GLOWSTONE, ['#f9d97c', '#eec256', '#fde9a4', '#d9a93e']);
  speckle(TILE.BOOKSHELF, ['#a8824e', '#9d7846']);
  {
    const tx = (TILE.BOOKSHELF % 16) * 16, ty = Math.floor(TILE.BOOKSHELF / 16) * 16;
    const cols = ['#b03a3a', '#3a62b0', '#3aa052', '#b08a3a', '#7a3ab0'];
    for (let row = 0; row < 2; row++)
      for (let x = 2; x < 14; x += 2) {
        ctx.fillStyle = cols[((x >> 1) + row * 2) % cols.length];
        ctx.fillRect(tx + x, ty + 2 + row * 7, 2, 5);
      }
  }
  speckle(TILE.PUMPKIN_SIDE, ['#cf7a1d', '#c06f15', '#dd8826']);
  for (let x = 2; x < 16; x += 4) for (let y = 0; y < 16; y++) px(TILE.PUMPKIN_SIDE, x, y, '#a85e10');
  speckle(TILE.PUMPKIN_TOP, ['#cf7a1d', '#c06f15']);
  px(TILE.PUMPKIN_TOP, 7, 7, '#5d8a2a'); px(TILE.PUMPKIN_TOP, 8, 7, '#5d8a2a');
  px(TILE.PUMPKIN_TOP, 8, 8, '#4a7020'); px(TILE.PUMPKIN_TOP, 7, 8, '#4a7020');

  // --- ores: stone base + colored chips ---
  const ores = [
    [TILE.COAL_ORE, '#2e2e2e', '#1c1c1c'],
    [TILE.IRON_ORE, '#d8af93', '#b78a6b'],
    [TILE.GOLD_ORE, '#fcee4b', '#d8c52e'],
    [TILE.DIAMOND_ORE, '#62e6dc', '#3dc4ba'],
  ];
  for (const [tile, c1, c2] of ores) {
    speckle(tile, ['#8f8f8f', '#848484', '#9a9a9a']);
    for (let i = 0; i < 5; i++) {
      const ox = (rnd() * 12 + 1) | 0, oy = (rnd() * 12 + 1) | 0;
      px(tile, ox, oy, c1); px(tile, ox + 1, oy, c2); px(tile, ox, oy + 1, c2); px(tile, ox + 1, oy + 1, c1);
    }
  }

  // --- wool ---
  const wools = [
    [TILE.WOOL_WHITE, ['#eeeeee', '#e2e2e2', '#f6f6f6']],
    [TILE.WOOL_RED, ['#b03a3a', '#a23333', '#bd4444']],
    [TILE.WOOL_GREEN, ['#4a8f3a', '#418234', '#549d43']],
    [TILE.WOOL_BLUE, ['#3a55b0', '#3349a2', '#4462bd']],
    [TILE.WOOL_YELLOW, ['#d8c52e', '#c9b626', '#e6d33c']],
    [TILE.WOOL_BLACK, ['#262626', '#1e1e1e', '#303030']],
  ];
  for (const [tile, shades] of wools) speckle(tile, shades);

  // --- cross plants (transparent background) ---
  function plant(tile, stemCol, headCol) {
    clearTile(tile);
    for (let y = 8; y < 16; y++) px(tile, 7 + (y % 2), y, stemCol);
    if (headCol) {
      px(tile, 7, 4, headCol); px(tile, 8, 4, headCol);
      px(tile, 6, 5, headCol); px(tile, 9, 5, headCol);
      px(tile, 7, 6, headCol); px(tile, 8, 6, headCol);
      px(tile, 7, 5, '#f7e26b'); px(tile, 8, 5, '#f7e26b');
      px(tile, 5, 9, stemCol); px(tile, 10, 10, stemCol);
    }
  }
  plant(TILE.FLOWER_RED, '#3e7a26', '#d33b3b');
  plant(TILE.FLOWER_YELLOW, '#3e7a26', '#e8d934');
  clearTile(TILE.TALLGRASS);
  for (let i = 0; i < 9; i++) {
    const bx = 1 + i * 1.6 | 0;
    const h = 5 + ((i * 5) % 7);
    for (let y = 0; y < h; y++) px(TILE.TALLGRASS, bx + (y > h - 3 ? (i % 2 ? 1 : -1) : 0), 15 - y, ['#4f9c33', '#5fae3f', '#467f2b'][i % 3]);
  }

  // --- crack stages 0..9 (transparent overlays) ---
  for (let s = 0; s < 10; s++) {
    const tile = TILE.CRACK_0 + s;
    clearTile(tile);
    rngState = 777 + 0; // same crack pattern every stage, growing
    const pts = [];
    let cx = 8, cy = 8;
    for (let i = 0; i < 40; i++) {
      pts.push([cx, cy]);
      cx = clampPix(cx + ((rnd() * 3) | 0) - 1); cy = clampPix(cy + ((rnd() * 3) | 0) - 1);
      if (i % 8 === 7) { cx = (rnd() * 16) | 0; cy = (rnd() * 16) | 0; }
    }
    const n = 4 + s * 4;
    for (let i = 0; i < Math.min(n, pts.length); i++) {
      px(tile, pts[i][0], pts[i][1], 'rgba(20,20,20,0.85)');
      if (i % 2 === 0) px(tile, clampPix(pts[i][0] + 1), pts[i][1], 'rgba(40,40,40,0.6)');
    }
  }
  function clampPix(v) { return v < 0 ? 0 : v > 15 ? 15 : v; }

  // --- crafting table ---
  speckle(TILE.CRAFT_TOP, ['#a8824e', '#9d7846', '#b28a55']);
  {
    const tx = (TILE.CRAFT_TOP % 16) * 16, ty = Math.floor(TILE.CRAFT_TOP / 16) * 16;
    ctx.fillStyle = '#6e5230';
    ctx.fillRect(tx + 1, ty + 1, 14, 1); ctx.fillRect(tx + 1, ty + 14, 14, 1);
    ctx.fillRect(tx + 1, ty + 1, 1, 14); ctx.fillRect(tx + 14, ty + 1, 1, 14);
    ctx.fillRect(tx + 7, ty + 2, 2, 12); ctx.fillRect(tx + 2, ty + 7, 12, 2);
    ctx.fillStyle = '#c9a86a';
    ctx.fillRect(tx + 7, ty + 7, 2, 2);
  }
  speckle(TILE.CRAFT_SIDE, ['#a8824e', '#9d7846', '#b28a55']);
  {
    const tx = (TILE.CRAFT_SIDE % 16) * 16, ty = Math.floor(TILE.CRAFT_SIDE / 16) * 16;
    ctx.fillStyle = '#6e5230';
    ctx.fillRect(tx, ty, 16, 2);
    // a saw and a hammer silhouette
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(tx + 2, ty + 5, 5, 2);  ctx.fillRect(tx + 3, ty + 7, 1, 1); ctx.fillRect(tx + 5, ty + 7, 1, 1);
    ctx.fillRect(tx + 10, ty + 4, 3, 3);
    ctx.fillStyle = '#7c5c33';
    ctx.fillRect(tx + 11, ty + 7, 1, 5);
  }

  // --- item sprites: stick + tools (transparent background) ---
  const HANDLE = '#8a6244', HANDLE_D = '#6e4f33';
  // 2px-thick 45° handle running up-right; (x0,y0) = bottom-left start
  function drawHandle(tile, x0, y0, len) {
    for (let i = 0; i < len; i++) {
      px(tile, x0 + i, y0 - i, HANDLE);
      px(tile, x0 + i + 1, y0 - i, HANDLE_D);
    }
  }
  clearTile(TILE.ITEM_STICK);
  drawHandle(TILE.ITEM_STICK, 3, 12, 9);

  // solid Minecraft-style heads, drawn from explicit row spans [y, x0, x1]
  const TOOL_HEADS = {
    pickaxe: [
      [1, 5, 10], [2, 3, 5], [2, 10, 12], [3, 2, 3], [3, 12, 13],
      [4, 2, 2], [4, 13, 14], [5, 1, 2], [5, 13, 14], [6, 14, 14], [7, 14, 14],
    ],
    axe: [
      [1, 6, 10], [2, 4, 11], [3, 4, 11], [4, 4, 8], [5, 5, 7],
    ],
    shovel: [
      [0, 10, 13], [1, 9, 14], [2, 9, 14], [3, 9, 14], [4, 10, 13], [5, 11, 12],
    ],
  };
  function drawTool(tile, type, headCol, headDark) {
    clearTile(tile);
    drawHandle(tile, 1, 14, type === 'shovel' ? 8 : 10);
    for (const [y, xa, xb] of TOOL_HEADS[type]) {
      for (let x = xa; x <= xb; x++) {
        px(tile, x, y, (x * 3 + y * 5) % 4 ? headCol : headDark);
      }
    }
    // outline the head bottom for a chunky look
    for (const [y, xa, xb] of TOOL_HEADS[type]) {
      px(tile, xa, y, headDark); px(tile, xb, y, headDark);
    }
  }
  drawTool(TILE.ITEM_PICK_WOOD, 'pickaxe', '#b08a52', '#7c5c33');
  drawTool(TILE.ITEM_PICK_STONE, 'pickaxe', '#9a9a9a', '#5f5f5f');
  drawTool(TILE.ITEM_AXE_WOOD, 'axe', '#b08a52', '#7c5c33');
  drawTool(TILE.ITEM_AXE_STONE, 'axe', '#9a9a9a', '#5f5f5f');
  drawTool(TILE.ITEM_SHOVEL_WOOD, 'shovel', '#b08a52', '#7c5c33');
  drawTool(TILE.ITEM_SHOVEL_STONE, 'shovel', '#9a9a9a', '#5f5f5f');

  // --- sun & moon ---
  fill(TILE.SUN, '#fdf2b0');
  {
    const tx = (TILE.SUN % 16) * 16, ty = Math.floor(TILE.SUN / 16) * 16;
    ctx.fillStyle = '#fff8d8'; ctx.fillRect(tx + 3, ty + 3, 10, 10);
  }
  fill(TILE.MOON, '#e7ecf0');
  {
    const tx = (TILE.MOON % 16) * 16, ty = Math.floor(TILE.MOON / 16) * 16;
    ctx.fillStyle = '#c4ccd4';
    ctx.fillRect(tx + 3, ty + 4, 3, 3); ctx.fillRect(tx + 9, ty + 9, 4, 3); ctx.fillRect(tx + 10, ty + 2, 2, 2);
  }

  return cv;
}
