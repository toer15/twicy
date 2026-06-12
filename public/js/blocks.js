// Block registry. IDs are persisted in world saves — append only, never reorder.
'use strict';

const BL = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, BEDROCK: 5, SAND: 6,
  SANDSTONE: 7, LOG: 8, PLANKS: 9, LEAVES: 10, GLASS: 11, BRICK: 12,
  SNOW: 13, WATER: 14, CACTUS: 15, COAL_ORE: 16, IRON_ORE: 17,
  GOLD_ORE: 18, DIAMOND_ORE: 19, GRAVEL: 20,
  WOOL_WHITE: 21, WOOL_RED: 22, WOOL_GREEN: 23, WOOL_BLUE: 24,
  WOOL_YELLOW: 25, WOOL_BLACK: 26,
  FLOWER_RED: 27, FLOWER_YELLOW: 28, TALLGRASS: 29,
  GLOWSTONE: 30, BOOKSHELF: 31, PUMPKIN: 32, CRAFTING_TABLE: 33,
};

// def: name, tiles {top,bottom,side} or {all}, solid (collision), opaque (culls
// neighbor faces), cutout (alpha-tested), cross (X-plant), fluid, hardness in
// seconds by hand (-1 = unbreakable), drop (block id given when mined;
// undefined = itself, 0 = nothing), creative (shown in creative palette),
// material ('wood'|'stone'|'earth'|'plant') drives tool speed & requirements
const BLOCKS = [];
function defBlock(id, def) {
  def.id = id;
  if (def.solid === undefined) def.solid = true;
  if (def.opaque === undefined) def.opaque = true;
  if (def.hardness === undefined) def.hardness = 1;
  if (def.creative === undefined) def.creative = true;
  BLOCKS[id] = def;
}

defBlock(BL.AIR, { name: 'Air', solid: false, opaque: false, creative: false, tiles: {} });
defBlock(BL.GRASS, { name: 'Grass Block', tiles: { top: TILE.GRASS_TOP, bottom: TILE.DIRT, side: TILE.GRASS_SIDE }, hardness: 0.9, drop: BL.DIRT, material: 'earth' });
defBlock(BL.DIRT, { name: 'Dirt', tiles: { all: TILE.DIRT }, hardness: 0.75, material: 'earth' });
defBlock(BL.STONE, { name: 'Stone', tiles: { all: TILE.STONE }, hardness: 2.2, drop: BL.COBBLE, material: 'stone' });
defBlock(BL.COBBLE, { name: 'Cobblestone', tiles: { all: TILE.COBBLE }, hardness: 2.5, material: 'stone' });
defBlock(BL.BEDROCK, { name: 'Bedrock', tiles: { all: TILE.BEDROCK }, hardness: -1 });
defBlock(BL.SAND, { name: 'Sand', tiles: { all: TILE.SAND }, hardness: 0.75, material: 'earth' });
defBlock(BL.SANDSTONE, { name: 'Sandstone', tiles: { top: TILE.SANDSTONE_TOP, bottom: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE_SIDE }, hardness: 1.8, material: 'stone' });
defBlock(BL.LOG, { name: 'Oak Log', tiles: { top: TILE.LOG_TOP, bottom: TILE.LOG_TOP, side: TILE.LOG_SIDE }, hardness: 2.0, material: 'wood' });
defBlock(BL.PLANKS, { name: 'Oak Planks', tiles: { all: TILE.PLANKS }, hardness: 2.0, material: 'wood' });
defBlock(BL.LEAVES, { name: 'Leaves', tiles: { all: TILE.LEAVES }, opaque: false, cutout: true, hardness: 0.3, drop: 0, material: 'plant' });
defBlock(BL.GLASS, { name: 'Glass', tiles: { all: TILE.GLASS }, opaque: false, cutout: true, hardness: 0.4, drop: 0 });
defBlock(BL.BRICK, { name: 'Bricks', tiles: { all: TILE.BRICK }, hardness: 2.5, material: 'stone' });
defBlock(BL.SNOW, { name: 'Snowy Grass', tiles: { top: TILE.SNOW_TOP, bottom: TILE.DIRT, side: TILE.SNOW_SIDE }, hardness: 0.9, drop: BL.DIRT, material: 'earth' });
defBlock(BL.WATER, { name: 'Water', tiles: { all: TILE.WATER }, solid: false, opaque: false, fluid: true, hardness: -1 });
defBlock(BL.CACTUS, { name: 'Cactus', tiles: { top: TILE.CACTUS_TOP, bottom: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE }, opaque: false, hardness: 0.6, material: 'plant' });
defBlock(BL.COAL_ORE, { name: 'Coal Ore', tiles: { all: TILE.COAL_ORE }, hardness: 3.0, material: 'stone' });
defBlock(BL.IRON_ORE, { name: 'Iron Ore', tiles: { all: TILE.IRON_ORE }, hardness: 3.5, material: 'stone' });
defBlock(BL.GOLD_ORE, { name: 'Gold Ore', tiles: { all: TILE.GOLD_ORE }, hardness: 3.5, material: 'stone' });
defBlock(BL.DIAMOND_ORE, { name: 'Diamond Ore', tiles: { all: TILE.DIAMOND_ORE }, hardness: 4.0, material: 'stone' });
defBlock(BL.GRAVEL, { name: 'Gravel', tiles: { all: TILE.GRAVEL }, hardness: 0.8, material: 'earth' });
defBlock(BL.WOOL_WHITE, { name: 'White Wool', tiles: { all: TILE.WOOL_WHITE }, hardness: 1.0 });
defBlock(BL.WOOL_RED, { name: 'Red Wool', tiles: { all: TILE.WOOL_RED }, hardness: 1.0 });
defBlock(BL.WOOL_GREEN, { name: 'Green Wool', tiles: { all: TILE.WOOL_GREEN }, hardness: 1.0 });
defBlock(BL.WOOL_BLUE, { name: 'Blue Wool', tiles: { all: TILE.WOOL_BLUE }, hardness: 1.0 });
defBlock(BL.WOOL_YELLOW, { name: 'Yellow Wool', tiles: { all: TILE.WOOL_YELLOW }, hardness: 1.0 });
defBlock(BL.WOOL_BLACK, { name: 'Black Wool', tiles: { all: TILE.WOOL_BLACK }, hardness: 1.0 });
defBlock(BL.FLOWER_RED, { name: 'Rose', tiles: { all: TILE.FLOWER_RED }, solid: false, opaque: false, cross: true, cutout: true, hardness: 0.05, material: 'plant' });
defBlock(BL.FLOWER_YELLOW, { name: 'Dandelion', tiles: { all: TILE.FLOWER_YELLOW }, solid: false, opaque: false, cross: true, cutout: true, hardness: 0.05, material: 'plant' });
defBlock(BL.TALLGRASS, { name: 'Tall Grass', tiles: { all: TILE.TALLGRASS }, solid: false, opaque: false, cross: true, cutout: true, hardness: 0.05, drop: 0, material: 'plant' });
defBlock(BL.GLOWSTONE, { name: 'Glowstone', tiles: { all: TILE.GLOWSTONE }, hardness: 0.6 });
defBlock(BL.BOOKSHELF, { name: 'Bookshelf', tiles: { top: TILE.PLANKS, bottom: TILE.PLANKS, side: TILE.BOOKSHELF }, hardness: 1.8, material: 'wood' });
defBlock(BL.CRAFTING_TABLE, { name: 'Crafting Table', tiles: { top: TILE.CRAFT_TOP, bottom: TILE.PLANKS, side: TILE.CRAFT_SIDE }, hardness: 1.8, material: 'wood' });
defBlock(BL.PUMPKIN, { name: 'Pumpkin', tiles: { top: TILE.PUMPKIN_TOP, bottom: TILE.PUMPKIN_TOP, side: TILE.PUMPKIN_SIDE }, hardness: 1.2, material: 'plant' });

// face: 0:+X 1:-X 2:+Y(top) 3:-Y(bottom) 4:+Z 5:-Z
function blockTile(id, face) {
  const t = BLOCKS[id].tiles;
  if (t.all !== undefined) return t.all;
  if (face === 2) return t.top;
  if (face === 3) return t.bottom;
  return t.side;
}

function blockDef(id) { return BLOCKS[id] || BLOCKS[0]; }
function isOpaque(id) { return BLOCKS[id] ? BLOCKS[id].opaque : false; }
function isSolid(id) { return BLOCKS[id] ? BLOCKS[id].solid : false; }
function blockDrop(id) {
  const d = BLOCKS[id];
  if (!d) return 0;
  return d.drop === undefined ? id : d.drop;
}

// items shown in the creative palette / valid placements
const CREATIVE_ITEMS = BLOCKS.filter(b => b && b.id !== BL.AIR && b.creative).map(b => b.id);
