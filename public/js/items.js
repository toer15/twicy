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
  COAL: 114, IRON_INGOT: 115, GOLD_INGOT: 116, DIAMOND: 117,
  PICK_IRON: 118, AXE_IRON: 119, SHOVEL_IRON: 120, SWORD_IRON: 121,
  PICK_DIAMOND: 122, SWORD_DIAMOND: 123,
  HELMET_IRON: 124, CHEST_IRON: 125, LEGS_IRON: 126, BOOTS_IRON: 127,
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
defItem(IT.COAL, { name: 'Coal', tile: TILE.ITEM_COAL });
defItem(IT.IRON_INGOT, { name: 'Iron Ingot', tile: TILE.ITEM_IRON });
defItem(IT.GOLD_INGOT, { name: 'Gold Ingot', tile: TILE.ITEM_GOLD });
defItem(IT.DIAMOND, { name: 'Diamond', tile: TILE.ITEM_DIAMOND });
defItem(IT.PICK_IRON, { name: 'Iron Pickaxe', tile: TILE.ITEM_PICK_IRON, tool: 'pickaxe', tier: 3, speed: 7, stack: 1 });
defItem(IT.AXE_IRON, { name: 'Iron Axe', tile: TILE.ITEM_AXE_IRON, tool: 'axe', tier: 3, speed: 7, stack: 1 });
defItem(IT.SHOVEL_IRON, { name: 'Iron Shovel', tile: TILE.ITEM_SHOVEL_IRON, tool: 'shovel', tier: 3, speed: 7, stack: 1 });
defItem(IT.SWORD_IRON, { name: 'Iron Sword', tile: TILE.ITEM_SWORD_IRON, tool: 'sword', tier: 3, dmg: 6, stack: 1 });
defItem(IT.PICK_DIAMOND, { name: 'Diamond Pickaxe', tile: TILE.ITEM_PICK_DIAMOND, tool: 'pickaxe', tier: 4, speed: 9, stack: 1 });
defItem(IT.SWORD_DIAMOND, { name: 'Diamond Sword', tile: TILE.ITEM_SWORD_DIAMOND, tool: 'sword', tier: 4, dmg: 7, stack: 1 });
defItem(IT.HELMET_IRON, { name: 'Iron Helmet', tile: TILE.ITEM_HELMET_I, armorSlot: 0, armor: 2, stack: 1 });
defItem(IT.CHEST_IRON, { name: 'Iron Chestplate', tile: TILE.ITEM_CHEST_I, armorSlot: 1, armor: 6, stack: 1 });
defItem(IT.LEGS_IRON, { name: 'Iron Leggings', tile: TILE.ITEM_LEGS_I, armorSlot: 2, armor: 5, stack: 1 });
defItem(IT.BOOTS_IRON, { name: 'Iron Boots', tile: TILE.ITEM_BOOTS_I, armorSlot: 3, armor: 2, stack: 1 });

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
const FE = IT.IRON_INGOT, DI = IT.DIAMOND;
const RECIPES = [
  { pattern: [[C, C, C], [C, 0, C], [C, C, C]], out: BL.FURNACE, n: 1 },
  { pattern: [[FE, FE, FE], [0, S, 0], [0, S, 0]], out: IT.PICK_IRON, n: 1 },
  { pattern: [[FE, FE], [FE, S], [0, S]], out: IT.AXE_IRON, n: 1 },
  { pattern: [[FE], [S], [S]], out: IT.SHOVEL_IRON, n: 1 },
  { pattern: [[FE], [FE], [S]], out: IT.SWORD_IRON, n: 1 },
  { pattern: [[DI, DI, DI], [0, S, 0], [0, S, 0]], out: IT.PICK_DIAMOND, n: 1 },
  { pattern: [[DI], [DI], [S]], out: IT.SWORD_DIAMOND, n: 1 },
  { pattern: [[FE, FE, FE], [FE, 0, FE]], out: IT.HELMET_IRON, n: 1 },
  { pattern: [[FE, 0, FE], [FE, FE, FE], [FE, FE, FE]], out: IT.CHEST_IRON, n: 1 },
  { pattern: [[FE, FE, FE], [FE, 0, FE], [FE, 0, FE]], out: IT.LEGS_IRON, n: 1 },
  { pattern: [[FE, 0, FE], [FE, 0, FE]], out: IT.BOOTS_IRON, n: 1 },
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

// ---------------- smelting (furnace) ----------------
const SMELT_TIME = 5; // seconds per item
const SMELT_RECIPES = {
  [BL.IRON_ORE]: { id: IT.IRON_INGOT, n: 1 },
  [BL.GOLD_ORE]: { id: IT.GOLD_INGOT, n: 1 },
  [BL.SAND]: { id: BL.GLASS, n: 1 },
  [BL.COBBLE]: { id: BL.STONE, n: 1 },
  [BL.LOG]: { id: IT.COAL, n: 1 }, // charcoal
};
// burn seconds per fuel item (coal smelts 8, planks 1.5, etc.)
const FUEL_TIME = {
  [IT.COAL]: 40,
  [BL.LOG]: 7.5,
  [BL.PLANKS]: 7.5,
  [BL.CRAFTING_TABLE]: 7.5,
  [BL.BOOKSHELF]: 7.5,
  [IT.STICK]: 2.5,
};
function smeltResult(id) { return SMELT_RECIPES[id] || null; }
function fuelTime(id) { return FUEL_TIME[id] || 0; }

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
    if (blockId === BL.IRON_ORE && item.tier < 2) drop = 0;            // stone pick for iron
    if ((blockId === BL.GOLD_ORE || blockId === BL.DIAMOND_ORE) && item.tier < 3) drop = 0; // iron pick for gold/diamond
  } else if (mat === 'wood' && item && item.tool === 'axe') {
    seconds /= item.speed;
  } else if (mat === 'earth' && item && item.tool === 'shovel') {
    seconds /= item.speed;
  } else if (mat === 'plant' && item && item.tool === 'axe') {
    seconds /= 2; // axes help a little on pumpkins etc.
  }
  return { seconds, drop };
}
