// In-game HUD: hotbar, hearts, air, chat, debug overlay, player list.
'use strict';

const HUD = {
  els: {},

  init() {
    for (const id of ['hotbar', 'hearts', 'air', 'chat-log', 'chat-input-wrap', 'chat-input',
      'debug', 'tablist', 'flash', 'water-overlay', 'crosshair', 'item-name', 'hud']) {
      this.els[id] = document.getElementById(id);
    }
    this._buildHotbar();
    this._itemNameTimer = null;
  },

  show() { this.els.hud.classList.remove('hidden'); },
  hide() { this.els.hud.classList.add('hidden'); },

  _buildHotbar() {
    const hb = this.els.hotbar;
    hb.innerHTML = '';
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      hb.appendChild(el);
      this.hotSlots.push(el);
    }
  },

  updateHotbar(inv) {
    for (let i = 0; i < 9; i++) {
      const el = this.hotSlots[i];
      const s = inv.slots[i];
      el.classList.toggle('selected', i === inv.selected);
      el.innerHTML = '';
      if (s) {
        const img = document.createElement('img');
        img.src = blockIconURL(s.id);
        img.draggable = false;
        el.appendChild(img);
        if (s.count > 1) {
          const c = document.createElement('span');
          c.className = 'count';
          c.textContent = s.count;
          el.appendChild(c);
        }
      }
    }
  },

  showItemName(name) {
    const el = this.els['item-name'];
    el.textContent = name;
    el.classList.add('visible');
    clearTimeout(this._itemNameTimer);
    this._itemNameTimer = setTimeout(() => el.classList.remove('visible'), 1400);
  },

  setHealthVisible(v) {
    this.els.hearts.classList.toggle('hidden', !v);
  },

  setHealth(h, armorPts = 0) {
    const el = this.els.hearts;
    el.innerHTML = '';
    if (armorPts > 0) {
      const row = document.createElement('div');
      row.className = 'armor-row';
      for (let i = 0; i < armorPts && i < 10; i++) {
        const s = document.createElement('span');
        s.className = 'armor-pip';
        s.textContent = '▣';
        row.appendChild(s);
      }
      el.appendChild(row);
    }
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('span');
      const v = h - i * 2;
      s.className = 'heart ' + (v >= 2 ? 'full' : v >= 1 ? 'half' : 'empty');
      s.textContent = '♥';
      el.appendChild(s);
    }
  },

  setAir(air) {
    const el = this.els.air;
    if (air >= 10) { el.innerHTML = ''; return; }
    el.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('span');
      s.className = 'bubble' + (i < Math.ceil(air) ? '' : ' popped');
      s.textContent = '●';
      el.appendChild(s);
    }
  },

  addChat(from, text, sys) {
    const log = this.els['chat-log'];
    const line = document.createElement('div');
    line.className = 'chat-line' + (sys ? ' sys' : '');
    if (from && !sys) {
      const b = document.createElement('b');
      b.textContent = `<${from}> `;
      line.appendChild(b);
    }
    line.appendChild(document.createTextNode(text));
    log.appendChild(line);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    setTimeout(() => line.classList.add('fade'), 9000);
  },

  openChat(prefill) {
    this.els['chat-input-wrap'].classList.remove('hidden');
    this.els['chat-log'].classList.add('chat-open');
    const inp = this.els['chat-input'];
    inp.value = prefill || '';
    setTimeout(() => inp.focus(), 0);
  },

  closeChat() {
    this.els['chat-input-wrap'].classList.add('hidden');
    this.els['chat-log'].classList.remove('chat-open');
    this.els['chat-input'].blur();
  },

  get chatOpen() { return !this.els['chat-input-wrap'].classList.contains('hidden'); },

  setDebug(lines) {
    const el = this.els.debug;
    if (!lines) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = lines.join('\n');
  },

  setTablist(names) {
    const el = this.els.tablist;
    if (!names) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '<h4>Players online</h4>';
    for (const n of names) {
      const d = document.createElement('div');
      d.textContent = n;
      el.appendChild(d);
    }
  },

  flash(color = 'rgba(255,0,0,0.35)') {
    const el = this.els.flash;
    el.style.background = color;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 180);
  },

  setUnderwater(on) {
    this.els['water-overlay'].classList.toggle('hidden', !on);
  },
};
