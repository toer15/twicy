// Inventory: 9 hotbar + 27 main slots, drag & drop UI, creative palette,
// and Minecraft-style crafting (2x2 in inventory, 3x3 at a crafting table).
'use strict';

const STACK_MAX = 64; // default for blocks; items can override via stackMax()

class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null); // {id, count} | null; 0..8 = hotbar
    this.armor = new Array(4).fill(null);  // helmet, chestplate, leggings, boots
    this.selected = 0;
  }

  armorPoints() {
    let p = 0;
    for (const a of this.armor) if (a && ITEMS[a.id]) p += ITEMS[a.id].armor || 0;
    return p;
  }

  serializeArmor() { return this.armor.map(s => (s ? [s.id, s.count] : 0)); }

  loadArmor(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < 4; i++) {
      const v = arr[i];
      this.armor[i] = Array.isArray(v) && ITEMS[v[0]] && ITEMS[v[0]].armorSlot === i
        ? { id: v[0], count: 1 } : null;
    }
  }

  getSelected() { return this.slots[this.selected]; }

  addItem(id, count = 1) {
    const cap = stackMax(id);
    // stack onto existing first (hotbar first), then empty slots
    for (let i = 0; i < 36 && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < cap) {
        const add = Math.min(count, cap - s.count);
        s.count += add; count -= add;
      }
    }
    for (let i = 0; i < 36 && count > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(count, cap);
        this.slots[i] = { id, count: add };
        count -= add;
      }
    }
    return count; // leftover that didn't fit
  }

  canFit(id, count = 1) {
    const cap = stackMax(id);
    for (let i = 0; i < 36 && count > 0; i++) {
      const s = this.slots[i];
      if (!s) count -= cap;
      else if (s.id === id) count -= (cap - s.count);
    }
    return count <= 0;
  }

  consumeSelected() {
    const s = this.slots[this.selected];
    if (!s) return false;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    return true;
  }

  findItem(id) {
    for (let i = 0; i < 36; i++) if (this.slots[i] && this.slots[i].id === id) return i;
    return -1;
  }

  serialize() { return this.slots.map(s => (s ? [s.id, s.count] : 0)); }

  load(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < 36; i++) {
      const v = arr[i];
      this.slots[i] = Array.isArray(v) && isThing(v[0])
        ? { id: v[0], count: clamp(v[1] | 0, 1, stackMax(v[0])) }
        : null;
    }
  }
}

// ---- icons (blocks use their side tile, items their sprite tile) ----
let _iconAtlas = null;
const _iconCache = new Map();
function blockIconURL(id) {
  if (_iconCache.has(id)) return _iconCache.get(id);
  if (!_iconAtlas) _iconAtlas = buildAtlas();
  const tile = ITEMS[id] ? ITEMS[id].tile : blockTile(id, 4);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tx = (tile % ATLAS_TILES) * TILE_PX, ty = Math.floor(tile / ATLAS_TILES) * TILE_PX;
  ctx.drawImage(_iconAtlas, tx, ty, TILE_PX, TILE_PX, 0, 0, 32, 32);
  const url = cv.toDataURL();
  _iconCache.set(id, url);
  return url;
}

// ---- UI ----
class InventoryUI {
  constructor(inv, onChange) {
    this.inv = inv;
    this.onChange = onChange;
    this.creative = false;
    this.cursor = null;        // {id, count} being dragged
    this.openState = false;
    this.kind = 'player';      // 'player' (2x2 craft) | 'table' (3x3 craft)
    this.craftSize = 2;
    this.craft = new Array(9).fill(null);
    this.root = document.getElementById('inv-screen');
    this.cursorEl = document.getElementById('inv-cursor');
    document.addEventListener('mousemove', e => {
      if (this.openState) {
        this.cursorEl.style.left = e.clientX + 4 + 'px';
        this.cursorEl.style.top = e.clientY + 4 + 'px';
      }
    });
  }

  setCreative(creative) { this.creative = creative; }

  open(kind = 'player') {
    this.openState = true;
    this.kind = kind;
    this.craftSize = kind === 'table' ? 3 : 2;
    // the mouse must be free while a UI is open
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    this._build();
    this.root.classList.remove('hidden');
  }

  close() {
    this.openState = false;
    // return whatever is left on the crafting grid + cursor to the inventory
    for (let i = 0; i < 9; i++) {
      const c = this.craft[i];
      if (c) this.inv.addItem(c.id, c.count);
      this.craft[i] = null;
    }
    if (this.cursor && !this.creative) this.inv.addItem(this.cursor.id, this.cursor.count);
    this.cursor = null;
    this._renderCursor();
    this.root.classList.add('hidden');
    this.onChange();
  }

  toggle(kind) { this.openState ? this.close() : this.open(kind); }

  _result() {
    const size = this.craftSize;
    const grid = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const c = this.craft[y * 3 + x];
        grid.push(c ? c.id : 0);
      }
    return matchRecipe(grid, size);
  }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel inv-panel';
    const showPalette = this.creative && this.kind === 'player';
    const title = this.kind === 'table' ? 'Crafting Table'
      : showPalette ? 'Creative Inventory' : 'Inventory & Crafting';
    panel.innerHTML = `<h3>${title}</h3>`;

    if (showPalette) {
      const pal = document.createElement('div');
      pal.className = 'inv-grid palette';
      for (const id of CREATIVE_ALL) {
        pal.appendChild(this._slotEl({ id, count: 0 }, () => this._paletteClick(id), thingName(id)));
      }
      panel.appendChild(pal);
      const sep = document.createElement('div');
      sep.className = 'inv-sep';
      sep.textContent = 'Hotbar & storage';
      panel.appendChild(sep);
    } else {
      if (this.kind === 'player') {
        // character pane: skin preview + armor slots
        const cp = document.createElement('div');
        cp.className = 'char-pane';
        const armorCol = document.createElement('div');
        armorCol.className = 'armor-col';
        const names = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
        for (let i = 0; i < 4; i++) {
          const a = this.inv.armor[i];
          const el = this._slotEl(a, e => this._armorClick(i, e), a ? thingName(a.id) : names[i]);
          el.classList.add('armor-slot');
          if (!a) el.dataset.ph = ['🪖', '👕', '👖', '🥾'][i];
          armorCol.appendChild(el);
        }
        cp.appendChild(armorCol);
        const img = document.createElement('img');
        img.className = 'char-preview';
        img.src = skinPreviewURL(typeof App !== 'undefined' ? App.profile.skin : 'explorer', 5);
        img.draggable = false;
        cp.appendChild(img);
        const stats = document.createElement('div');
        stats.className = 'char-stats';
        const pts = this.inv.armorPoints();
        stats.innerHTML = `<b>${escapeHTML(typeof App !== 'undefined' ? App.profile.name : 'Player')}</b><br>` +
          `Armor: ${'▣'.repeat(pts) || '—'}<br><small>${pts ? Math.round(pts * 4) + '% protection' : 'no protection'}</small>`;
        cp.appendChild(stats);
        panel.appendChild(cp);
      }
      // crafting area: grid -> result
      const area = document.createElement('div');
      area.className = 'craft-area';
      const grid = document.createElement('div');
      grid.className = 'inv-grid craft-grid size' + this.craftSize;
      for (let y = 0; y < this.craftSize; y++)
        for (let x = 0; x < this.craftSize; x++) {
          const i = y * 3 + x;
          const c = this.craft[i];
          grid.appendChild(this._slotEl(c, e => this._craftClick(i, e), c ? thingName(c.id) : ''));
        }
      area.appendChild(grid);
      const arrow = document.createElement('div');
      arrow.className = 'craft-arrow';
      arrow.textContent = '➜';
      area.appendChild(arrow);
      const res = this._result();
      const resEl = this._slotEl(res, e => this._resultClick(e), res ? thingName(res.id) : '');
      resEl.classList.add('craft-result');
      if (res) resEl.querySelector('img').title = thingName(res.id);
      area.appendChild(resEl);
      panel.appendChild(area);
    }

    const main = document.createElement('div');
    main.className = 'inv-grid';
    for (let i = 9; i < 36; i++) main.appendChild(this._invSlotEl(i));
    panel.appendChild(main);

    const hot = document.createElement('div');
    hot.className = 'inv-grid hotrow';
    for (let i = 0; i < 9; i++) hot.appendChild(this._invSlotEl(i));
    panel.appendChild(hot);

    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = showPalette
      ? 'Click palette: grab a stack • click with item on palette: discard • right-click: place one'
      : this.kind === 'table'
        ? '3x3 crafting — try tools: planks/cobble on top, sticks below • shift-click result: craft all'
        : 'Craft: log ➜ planks ➜ sticks & crafting table • shift-click: quick move • right-click: split';
    panel.appendChild(hint);
    r.appendChild(panel);
  }

  _slotEl(stack, onClick, title) {
    const el = document.createElement('div');
    el.className = 'slot';
    if (title) el.title = title;
    if (stack && stack.id) {
      const img = document.createElement('img');
      img.src = blockIconURL(stack.id);
      img.draggable = false;
      el.appendChild(img);
      if (stack.count > 1) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = stack.count;
        el.appendChild(c);
      }
    }
    el.addEventListener('mousedown', e => { e.preventDefault(); onClick(e); });
    el.addEventListener('contextmenu', e => e.preventDefault());
    return el;
  }

  _invSlotEl(i) {
    const s = this.inv.slots[i];
    return this._slotEl(s, e => this._slotClick(this.inv.slots, i, e, true), s ? thingName(s.id) : '');
  }

  _paletteClick(id) {
    Sfx.click();
    if (!this.cursor) this.cursor = { id, count: stackMax(id) };
    else if (this.cursor.id === id) this.cursor.count = stackMax(id);
    else this.cursor = null; // acts as trash in creative
    this._refresh();
  }

  _craftClick(i, e) {
    Sfx.click();
    this._slotClick(this.craft, i, e, false);
  }

  // armor slots only accept the matching piece
  _armorClick(i, e) {
    const cur = this.inv.armor[i];
    if (this.cursor) {
      const def = ITEMS[this.cursor.id];
      if (!def || def.armorSlot !== i) return;
      this.inv.armor[i] = { id: this.cursor.id, count: 1 };
      this.cursor.count--;
      if (this.cursor.count <= 0) this.cursor = null;
      if (cur) {
        if (!this.cursor) this.cursor = cur;
        else this.inv.addItem(cur.id, cur.count);
      }
      Sfx.equip();
    } else if (cur) {
      if (e.shiftKey) this.inv.addItem(cur.id, cur.count);
      else this.cursor = cur;
      this.inv.armor[i] = null;
      Sfx.equip();
    }
    this._refresh();
  }

  // shared click logic for a slot array; quickMove toggles hotbar<->main
  _slotClick(slots, i, e, isInv) {
    const s = slots[i];
    if (e.shiftKey && e.button === 0) {
      if (s) {
        const aSlot = ITEMS[s.id] ? ITEMS[s.id].armorSlot : undefined;
        if (isInv && aSlot !== undefined && !this.inv.armor[aSlot] && this.kind === 'player') {
          // shift-click armor to equip it
          this.inv.armor[aSlot] = { id: s.id, count: 1 };
          s.count--;
          if (s.count <= 0) slots[i] = null;
          Sfx.equip();
        } else if (!isInv) { // craft grid -> inventory
          const left = this.inv.addItem(s.id, s.count);
          slots[i] = left > 0 ? { id: s.id, count: left } : null;
        } else {
          const [from, to] = i < 9 ? [i, [9, 36]] : [i, [0, 9]];
          let rest = s.count;
          const cap = stackMax(s.id);
          for (let j = to[0]; j < to[1] && rest > 0; j++) {
            const t = slots[j];
            if (t && t.id === s.id && t.count < cap) {
              const add = Math.min(rest, cap - t.count);
              t.count += add; rest -= add;
            }
          }
          for (let j = to[0]; j < to[1] && rest > 0; j++) {
            if (!slots[j]) { slots[j] = { id: s.id, count: rest }; rest = 0; }
          }
          slots[from] = rest > 0 ? { id: s.id, count: rest } : null;
        }
      }
    } else if (e.button === 2) {
      if (!this.cursor && s) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half };
        s.count -= half;
        if (s.count <= 0) slots[i] = null;
      } else if (this.cursor) {
        const cap = stackMax(this.cursor.id);
        if (!s) { slots[i] = { id: this.cursor.id, count: 1 }; this.cursor.count--; }
        else if (s.id === this.cursor.id && s.count < cap) { s.count++; this.cursor.count--; }
        if (this.cursor.count <= 0) this.cursor = null;
      }
    } else {
      if (!this.cursor && s) { this.cursor = s; slots[i] = null; }
      else if (this.cursor && !s) { slots[i] = this.cursor; this.cursor = null; }
      else if (this.cursor && s) {
        if (s.id === this.cursor.id) {
          const add = Math.min(this.cursor.count, stackMax(s.id) - s.count);
          s.count += add; this.cursor.count -= add;
          if (this.cursor.count <= 0) this.cursor = null;
        } else { slots[i] = this.cursor; this.cursor = s; }
      }
    }
    Sfx.click();
    this._refresh();
  }

  _consumeCraft() {
    for (let y = 0; y < this.craftSize; y++)
      for (let x = 0; x < this.craftSize; x++) {
        const i = y * 3 + x;
        const c = this.craft[i];
        if (c) {
          c.count--;
          if (c.count <= 0) this.craft[i] = null;
        }
      }
  }

  _resultClick(e) {
    const res = this._result();
    if (!res) return;
    if (e.shiftKey) {
      // craft as many as fit in the inventory
      let guard = 0;
      while (guard++ < 64) {
        const r = this._result();
        if (!r || !this.inv.canFit(r.id, r.count)) break;
        this.inv.addItem(r.id, r.count);
        this._consumeCraft();
      }
    } else {
      const cap = stackMax(res.id);
      if (!this.cursor) this.cursor = { id: res.id, count: res.count };
      else if (this.cursor.id === res.id && this.cursor.count + res.count <= cap) this.cursor.count += res.count;
      else return;
      this._consumeCraft();
    }
    Sfx.pop();
    this._refresh();
  }

  _refresh() {
    this._build();
    this._renderCursor();
    this.onChange();
  }

  _renderCursor() {
    const el = this.cursorEl;
    el.innerHTML = '';
    if (this.cursor) {
      const img = document.createElement('img');
      img.src = blockIconURL(this.cursor.id);
      el.appendChild(img);
      if (this.cursor.count > 1) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = this.cursor.count;
        el.appendChild(c);
      }
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
}
