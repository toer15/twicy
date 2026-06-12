// Items (non-placeable: sticks, tools), crafting recipes, and the Minecraft
// tool/material break mechanics. Pure logic — runs headless for tests.
'use strict';

// item ids start at 100 so they can never collide with block ids
const IT = {
  STICK: 100,
  PICK_WOOD: 101, PICK_STONE: 102,
  AXE_WOOD: 103, AXE_STONE: 104,
  SHOVEL_WOOD: 105, SHOVEL_STONE: 106,
  SWORD_WOOD: 107, SWORD_STONE: 108,
  LEATHER: 109,
  HELMET: 110, CHESTPLATE: 111, LEGGINGS: 112, BOOTS: 113,
};

const ITEMS = {};
function defItem(id, def) {
  def.id = id;
  if (def.stack === undefined) def.stack = 64;
  ITEMS[id] = def;
}
defItem(IT.STICK, { name: 'Stick', tile: TILE.ITEM_STICK });
defItem(IT.PICK_WOOD, { name: 'Wooden Pickaxe', tile: TILE.ITEM_PICK_WOOD, tool: 'pickaxe', tier: 1, speed: 3, stack: 1 });
defItem(IT.PICK_STONE, { name: 'Stone Pickaxe', tile: TILE.ITEM_PICK_STONE, tool: 'pickaxe', tier: 2, speed: 5, stack: 1 });
defItem(IT.AXE_WOOD, { name: 'Wooden Axe', tile: TILE.ITEM_AXE_WOOD, tool: 'axe', tier: 1, speed: 3, stack: 1 });
defItem(IT.AXE_STONE, { name: 'Stone Axe', tile: TILE.ITEM_AXE_STONE, tool: 'axe', tier: 2, speed: 5, stack: 1 });
defItem(IT.SHOVEL_WOOD, { name: 'Wooden Shovel', tile: TILE.ITEM_SHOVEL_WOOD, tool: 'shovel', tier: 1, speed: 3, stack: 1 });
defItem(IT.SHOVEL_STONE, { name: 'Stone Shovel', tile: TILE.ITEM_SHOVEL_STONE, tool: 'shovel', tier: 2, speed: 5, stack: 1 });
defItem(IT.SWORD_WOOD, { name: 'Wooden Sword', tile: TILE.ITEM_SWORD_WOOD, tool: 'sword', tier: 1, dmg: 4, stack: 1 });
defItem(IT.SWORD_STONE, { name: 'Stone Sword', tile: TILE.ITEM_SWORD_STONE, tool: 'sword', tier: 2, dmg: 5, stack: 1 });
defItem(IT.LEATHER, { name: 'Leather', tile: TILE.ITEM_LEATHER });
defItem(IT.HELMET, { name: 'Leather Cap', tile: TILE.ITEM_HELMET, armorSlot: 0, armor: 1, stack: 1 });
defItem(IT.CHESTPLATE, { name: 'Leather Tunic', tile: TILE.ITEM_CHEST, armorSlot: 1, armor: 3, stack: 1 });
defItem(IT.LEGGINGS, { name: 'Leather Pants', tile: TILE.ITEM_LEGS, armorSlot: 2, armor: 2, stack: 1 });
defItem(IT.BOOTS, { name: 'Leather Boots', tile: TILE.ITEM_BOOTS, armorSlot: 3, armor: 1, stack: 1 });

// melee damage (half-hearts) for whatever is in hand
function attackDamage(heldId) {
  const it = ITEMS[heldId];
  if (!it) return 1;
  if (it.tool === 'sword') return it.dmg;
  if (it.tool === 'axe') return it.tier >= 2 ? 4 : 3;
  if (it.tool === 'pickaxe') return it.tier >= 2 ? 3 : 2;
  if (it.tool === 'shovel') return 2;
  return 1;
}

// unified lookups across blocks + items
function thingDef(id) { return ITEMS[id] || BLOCKS[id] || null; }
function thingName(id) { const d = thingDef(id); return d ? d.name : '?'; }
function stackMax(id) { const d = ITEMS[id]; return d ? d.stack : 64; }
function isThing(id) { return !!thingDef(id) && id !== BL.AIR; }

const CREATIVE_ALL = CREATIVE_ITEMS.concat(Object.keys(ITEMS).map(Number));

// ---------------- crafting ----------------
// shaped patterns are row arrays of ids (0 = empty); matched against the
// trimmed crafting grid, including the horizontally mirrored variant.
const P = BL.PLANKS, S = IT.STICK, C = BL.COBBLE, L = IT.LEATHER;
const RECIPES = [
  { pattern: [[P], [P], [S]], out: IT.SWORD_WOOD, n: 1 },
  { pattern: [[C], [C], [S]], out: IT.SWORD_STONE, n: 1 },
  { pattern: [[L, L, L], [L, 0, L]], out: IT.HELMET, n: 1 },
  { pattern: [[L, 0, L], [L, L, L], [L, L, L]], out: IT.CHESTPLATE, n: 1 },
  { pattern: [[L, L, L], [L, 0, L], [L, 0, L]], out: IT.LEGGINGS, n: 1 },
  { pattern: [[L, 0, L], [L, 0, L]], out: IT.BOOTS, n: 1 },
  { shapeless: [BL.LOG], out: BL.PLANKS, n: 4 },
  { pattern: [[P], [P]], out: IT.STICK, n: 4 },
  { pattern: [[P, P], [P, P]], out: BL.CRAFTING_TABLE, n: 1 },
  { pattern: [[P, P, P], [0, S, 0], [0, S, 0]], out: IT.PICK_WOOD, n: 1 },
  { pattern: [[C, C, C], [0, S, 0], [0, S, 0]], out: IT.PICK_STONE, n: 1 },
  { pattern: [[P, P], [P, S], [0, S]], out: IT.AXE_WOOD, n: 1 },
  { pattern: [[C, C], [C, S], [0, S]], out: IT.AXE_STONE, n: 1 },
  { pattern: [[P], [S], [S]], out: IT.SHOVEL_WOOD, n: 1 },
  { pattern: [[C], [S], [S]], out: IT.SHOVEL_STONE, n: 1 },
  { shapeless: [BL.SNOW], out: BL.DIRT, n: 1 },
  { pattern: [[BL.SAND, BL.SAND], [BL.SAND, BL.SAND]], out: BL.SANDSTONE, n: 1 },
  { pattern: [[P, P, P], [P, 0, P], [P, P, P]], out: BL.BOOKSHELF, n: 1 },
];

// grid: flat array of ids (0/null = empty), size x size.
// Returns {id, count} or null.
function matchRecipe(grid, size) {
  const ids = [];
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = grid[y * size + x] || 0;
      if (v) {
        ids.push(v);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!ids.length) return null;

  for (const r of RECIPES) {
    if (r.shapeless) {
      if (r.shapeless.length === ids.length &&
          [...r.shapeless].sort().join() === [...ids].sort().join()) {
        return { id: r.out, count: r.n };
      }
      continue;
    }
    const h = r.pattern.length, w = r.pattern[0].length;
    if (maxX - minX + 1 !== w || maxY - minY + 1 !== h) continue;
    let ok = true, okMir = true;
    for (let y = 0; y < h && (ok || okMir); y++) {
      for (let x = 0; x < w; x++) {
        const cell = grid[(minY + y) * size + (minX + x)] || 0;
        if (cell !== (r.pattern[y][x] || 0)) ok = false;
        if (cell !== (r.pattern[y][w - 1 - x] || 0)) okMir = false;
      }
    }
    if (ok || okMir) return { id: r.out, count: r.n };
  }
  return null;
}

// ---------------- breaking mechanics ----------------
// Minecraft rules: axes speed up wood, shovels speed up earth; stone-class
// blocks REQUIRE a pickaxe to drop anything and break 3.3x slower without
// one; better ores need a stone pickaxe.
function breakInfo(blockId, heldId) {
  const def = BLOCKS[blockId];
  if (!def || def.hardness < 0) return { seconds: Infinity, drop: 0 };
  const item = ITEMS[heldId];
  const mat = def.material;
  let seconds = def.hardness;
  let drop = blockDrop(blockId);

  if (mat === 'stone') {
    if (!item || item.tool !== 'pickaxe') {
      return { seconds: seconds * 3.3, drop: 0 };
    }
    seconds /= item.speed;
    const needsTier2 = blockId === BL.IRON_ORE || blockId === BL.GOLD_ORE || blockId === BL.DIAMOND_ORE;
    if (needsTier2 && item.tier < 2) drop = 0;
  } else if (mat === 'wood' && item && item.tool === 'axe') {
    seconds /= item.speed;
  } else if (mat === 'earth' && item && item.tool === 'shovel') {
    seconds /= item.speed;
  } else if (mat === 'plant' && item && item.tool === 'axe') {
    seconds /= 2; // axes help a little on pumpkins etc.
  }
  return { seconds, drop };
}
