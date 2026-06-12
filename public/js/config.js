// Global game constants (shared conventions across all modules).
'use strict';

const CHUNK = 16;          // chunk size in X and Z
const WORLD_H = 96;        // world height in blocks
const SEA = 30;            // sea level (highest Y that water fills)
const DAY_LENGTH = 600;    // seconds per full day/night cycle

const GAME_VERSION = '1.0.0';
const GAME_NAME = 'Twicycraft';

// Player dimensions (Minecraft-like)
const PLAYER_HALF_W = 0.3;
const PLAYER_HEIGHT = 1.8;
const PLAYER_EYE = 1.62;
const REACH = 5.0;

const DEFAULT_SETTINGS = {
  renderDist: 6,     // chunks
  fov: 75,           // degrees
  sensitivity: 1.0,
  viewBob: true,
  sound: true,
  soundVolume: 100,
  clouds: true,
  particles: 'all',  // 'all' | 'reduced' | 'off'
  invertY: false,
};

// chunk index helpers: idx = x + z*CHUNK + y*CHUNK*CHUNK
function chunkIdx(x, y, z) { return x + z * CHUNK + y * CHUNK * CHUNK; }
function chunkKey(cx, cz) { return cx + ',' + cz; }
