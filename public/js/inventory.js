// Inventory: 9 hotbar + 27 main slots, drag & drop UI, creative palette.
'use strict';

const STACK_MAX = 64;

class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null); // {id, count} | null; 0..8 = hotbar
    this.selected = 0;
  }

  getSelected() { return this.slots[this.selected]; }

  addItem(id, count = 1) {
    // stack onto existing first (hotbar first), then empty slots
    for (let i = 0; i < 36 && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < STACK_MAX) {
        const add = Math.min(count, STACK_MAX - s.count);
        s.count += add; count -= add;
      }
    }
    for (let i = 0; i < 36 && count > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(count, STACK_MAX);
        this.slots[i] = { id, count: add };
        count -= add;
      }
    }
    return count; // leftover that didn't fit
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
      this.slots[i] = Array.isArray(v) && BLOCKS[v[0]] ? { id: v[0], count: clamp(v[1] | 0, 1, STACK_MAX) } : null;
    }
  }

  giveStarterKit() {
    this.addItem(BL.PLANKS, 32);
    this.addItem(BL.COBBLE, 32);
    this.addItem(BL.GLASS, 16);
  }
}

// ---- icons ----
let _iconAtlas = null;
const _iconCache = new Map();
function blockIconURL(id) {
  if (_iconCache.has(id)) return _iconCache.get(id);
  if (!_iconAtlas) _iconAtlas = buildAtlas();
  const tile = blockTile(id, 4);
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
    this.cursor = null; // {id, count} being dragged
    this.openState = false;
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

  open() {
    this.openState = true;
    this._build();
    this.root.classList.remove('hidden');
  }

  close() {
    this.openState = false;
    // return cursor stack to inventory (survival keeps items)
    if (this.cursor && !this.creative) this.inv.addItem(this.cursor.id, this.cursor.count);
    this.cursor = null;
    this._renderCursor();
    this.root.classList.add('hidden');
    this.onChange();
  }

  toggle() { this.openState ? this.close() : this.open(); }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel inv-panel';
    panel.innerHTML = `<h3>${this.creative ? 'Creative Inventory' : 'Inventory'}</h3>`;

    if (this.creative) {
      const pal = document.createElement('div');
      pal.className = 'inv-grid palette';
      for (const id of CREATIVE_ITEMS) {
        pal.appendChild(this._slotEl({ id, count: 0 }, () => this._paletteClick(id), BLOCKS[id].name));
      }
      panel.appendChild(pal);
      const sep = document.createElement('div');
      sep.className = 'inv-sep';
      sep.textContent = 'Hotbar & storage';
      panel.appendChild(sep);
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
    hint.textContent = this.creative
      ? 'Click palette: grab a stack • click with item on palette: discard • right-click: place one'
      : 'Click: pick/place • right-click: split/place one • shift-click: quick move';
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
    return this._slotEl(s, e => this._slotClick(i, e), s ? BLOCKS[s.id].name : '');
  }

  _paletteClick(id) {
    Sfx.click();
    if (!this.cursor) this.cursor = { id, count: STACK_MAX };
    else if (this.cursor.id === id) this.cursor.count = STACK_MAX;
    else this.cursor = null; // acts as trash in creative
    this._refresh();
  }

  _slotClick(i, e) {
    Sfx.click();
    const slots = this.inv.slots;
    const s = slots[i];
    if (e.shiftKey && e.button === 0) {
      if (s) {
        // quick-move between hotbar and main storage
        const [from, to] = i < 9 ? [i, [9, 36]] : [i, [0, 9]];
        let rest = s.count;
        for (let j = to[0]; j < to[1] && rest > 0; j++) {
          const t = slots[j];
          if (t && t.id === s.id && t.count < STACK_MAX) {
            const add = Math.min(rest, STACK_MAX - t.count);
            t.count += add; rest -= add;
          }
        }
        for (let j = to[0]; j < to[1] && rest > 0; j++) {
          if (!slots[j]) { slots[j] = { id: s.id, count: rest }; rest = 0; }
        }
        slots[from] = rest > 0 ? { id: s.id, count: rest } : null;
      }
    } else if (e.button === 2) {
      if (!this.cursor && s) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half };
        s.count -= half;
        if (s.count <= 0) slots[i] = null;
      } else if (this.cursor) {
        if (!s) { slots[i] = { id: this.cursor.id, count: 1 }; this.cursor.count--; }
        else if (s.id === this.cursor.id && s.count < STACK_MAX) { s.count++; this.cursor.count--; }
        if (this.cursor.count <= 0) this.cursor = null;
      }
    } else {
      if (!this.cursor && s) { this.cursor = s; slots[i] = null; }
      else if (this.cursor && !s) { slots[i] = this.cursor; this.cursor = null; }
      else if (this.cursor && s) {
        if (s.id === this.cursor.id) {
          const add = Math.min(this.cursor.count, STACK_MAX - s.count);
          s.count += add; this.cursor.count -= add;
          if (this.cursor.count <= 0) this.cursor = null;
        } else { slots[i] = this.cursor; this.cursor = s; }
      }
    }
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
