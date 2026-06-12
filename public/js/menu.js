// Main menu: title, world select/create (with mode selection), skins, help.
'use strict';

class Menu {
  // cb: {connect(addr), listWorlds(), createWorld(o), deleteWorld(id), joinWorld(id),
  //      getProfile(), setProfile(p)}
  constructor(cb) {
    this.cb = cb;
    this.root = document.getElementById('menu');
    this.address = ''; // '' = this server
    this._pollTimer = null;
    this._setMenuBackground();
  }

  _setMenuBackground() {
    const atlas = buildAtlas();
    const cv = document.createElement('canvas');
    cv.width = cv.height = TILE_PX;
    const ctx = cv.getContext('2d');
    const t = TILE.DIRT;
    ctx.drawImage(atlas, (t % ATLAS_TILES) * TILE_PX, Math.floor(t / ATLAS_TILES) * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    document.documentElement.style.setProperty('--dirt-bg', `url(${cv.toDataURL()})`);
  }

  show(screen = 'title') {
    this.root.classList.remove('hidden');
    this[`_${screen}`]();
  }

  hide() {
    this.root.classList.add('hidden');
    this._stopPoll();
  }

  toast(msg, isError = true) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.toggle('error', isError);
    t.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('on'), 3500);
  }

  _clear() {
    this._stopPoll();
    this.root.innerHTML = '';
  }

  _stopPoll() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _el(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  // ---------- title ----------
  _title() {
    this._clear();
    const splashes = ['Now with 100% more blocks!', 'Punch trees!', 'Multiplayer ready!',
      'Watch out for caves!', 'Also try going outside!', 'Procedurally generated!', 'Diamonds are deep!'];
    const splash = splashes[(Math.random() * splashes.length) | 0];
    const p = this.cb.getProfile();
    const s = this._el(`
      <div class="menu-screen">
        <div class="logo">${GAME_NAME.toUpperCase()}</div>
        <div class="splash">${splash}</div>
        <div class="menu-buttons">
          <button class="btn big" id="m-play">Singleplayer / LAN</button>
          <button class="btn big" id="m-mp">Multiplayer (other server)</button>
          <button class="btn" id="m-skins">Skins &amp; Profile</button>
          <button class="btn" id="m-help">How to Play</button>
        </div>
        <div class="menu-footer">
          <span>${GAME_NAME} ${GAME_VERSION} — a Minecraft-inspired game</span>
          <span>Playing as <b>${escapeHTML(p.name)}</b></span>
        </div>
      </div>`);
    s.querySelector('#m-play').onclick = () => { Sfx.unlock(); Sfx.click(); this.address = ''; this._worlds(); };
    s.querySelector('#m-mp').onclick = () => { Sfx.unlock(); Sfx.click(); this._connect(); };
    s.querySelector('#m-skins').onclick = () => { Sfx.unlock(); Sfx.click(); this._skins(); };
    s.querySelector('#m-help').onclick = () => { Sfx.unlock(); Sfx.click(); this._help(); };
    this.root.appendChild(s);
  }

  // ---------- multiplayer connect ----------
  _connect() {
    this._clear();
    const s = this._el(`
      <div class="menu-screen">
        <h2>Connect to a server</h2>
        <div class="panel narrow">
          <p>Enter the address of another ${GAME_NAME} server.<br>
          To host for friends: run <b>npm start</b> on one computer — everyone else opens
          <b>http://&lt;that-ip&gt;:3000</b> in a browser.</p>
          ${location.protocol === 'https:'
            ? '<p class="offline-note">⚠ This page is served over https, so browsers will only allow secure (wss://) servers from here. For LAN play, open your host\'s http:// address directly instead.</p>'
            : ''}
          <input id="m-addr" class="input" placeholder="host:port (e.g. 192.168.1.10:3000)" value="">
          <div class="row">
            <button class="btn" id="m-back">Back</button>
            <button class="btn primary" id="m-go">Connect</button>
          </div>
        </div>
      </div>`);
    s.querySelector('#m-back').onclick = () => { Sfx.click(); this._title(); };
    s.querySelector('#m-go').onclick = () => {
      Sfx.click();
      this.address = s.querySelector('#m-addr').value.trim();
      if (!this.address) return this.toast('Enter a server address');
      this._worlds();
    };
    this.root.appendChild(s);
  }

  // ---------- world list / create ----------
  async _worlds() {
    this._clear();
    const s = this._el(`
      <div class="menu-screen">
        <h2>Select World ${this.address ? `<small>@ ${escapeHTML(this.address)}</small>` : ''}</h2>
        <div class="panel worlds-panel">
          <div id="m-offline" class="offline-note hidden">📁 Offline mode — worlds are saved in this browser.
            For LAN multiplayer, run the server: <b>npm start</b></div>
          <div id="m-worldlist" class="world-list"><div class="muted">Connecting…</div></div>
          <h3>Create New World</h3>
          <div class="row">
            <input id="m-wname" class="input" placeholder="World name" maxlength="28">
            <input id="m-wseed" class="input" placeholder="Seed (optional)" maxlength="28">
          </div>
          <div class="row mode-row">
            <button class="btn mode selected" id="m-mode-s" data-mode="survival">⛏ Survival<small>Health, mining, limited blocks</small></button>
            <button class="btn mode" id="m-mode-c" data-mode="creative">🪶 Creative<small>Fly, unlimited blocks</small></button>
          </div>
          <div class="row">
            <button class="btn" id="m-back">Back</button>
            <button class="btn primary" id="m-create">Create &amp; Play</button>
          </div>
        </div>
      </div>`);
    this.root.appendChild(s);
    let mode = 'survival';
    const bS = s.querySelector('#m-mode-s'), bC = s.querySelector('#m-mode-c');
    const pick = m => {
      mode = m;
      bS.classList.toggle('selected', m === 'survival');
      bC.classList.toggle('selected', m === 'creative');
      Sfx.click();
    };
    bS.onclick = () => pick('survival');
    bC.onclick = () => pick('creative');
    s.querySelector('#m-back').onclick = () => { Sfx.click(); this._title(); };
    s.querySelector('#m-create').onclick = async () => {
      Sfx.click();
      const name = s.querySelector('#m-wname').value.trim() || 'New World';
      const seed = s.querySelector('#m-wseed').value.trim() || String((Math.random() * 1e9) | 0);
      try {
        const id = await this.cb.createWorld({ name, seed, mode });
        await this.cb.joinWorld(id);
      } catch (e) { this.toast(e.message); }
    };

    const listEl = s.querySelector('#m-worldlist');
    const offlineEl = s.querySelector('#m-offline');
    const refresh = async () => {
      try {
        const worlds = await this.cb.listWorlds(this.address);
        if (!listEl.isConnected) return;
        offlineEl.classList.toggle('hidden', !(this.cb.isOffline && this.cb.isOffline()));
        this._renderWorldList(listEl, worlds);
      } catch (e) {
        if (listEl.isConnected) listEl.innerHTML = `<div class="muted">⚠ ${escapeHTML(e.message)}</div>`;
        this._stopPoll();
      }
    };
    await refresh();
    this._pollTimer = setInterval(refresh, 3000);
  }

  _renderWorldList(el, worlds) {
    el.innerHTML = '';
    if (!worlds.length) {
      el.innerHTML = '<div class="muted">No worlds yet — create one below!</div>';
      return;
    }
    for (const w of worlds) {
      const row = this._el(`
        <div class="world-row">
          <div class="world-info">
            <b>${escapeHTML(w.name)}</b>
            <span class="badge ${w.mode}">${w.mode}</span>
            ${w.players ? `<span class="badge online">${w.players} online</span>` : ''}
            <small>seed ${escapeHTML(String(w.seed))} • ${timeAgo(w.lastPlayed)}</small>
          </div>
          <div class="world-actions">
            <button class="btn primary sm">Play</button>
            <button class="btn danger sm">✕</button>
          </div>
        </div>`);
      const [playBtn, delBtn] = row.querySelectorAll('button');
      playBtn.onclick = async () => {
        Sfx.click();
        try { await this.cb.joinWorld(w.id); } catch (e) { this.toast(e.message); }
      };
      delBtn.onclick = async () => {
        Sfx.click();
        if (!confirm(`Delete world "${w.name}" forever?`)) return;
        try { await this.cb.deleteWorld(w.id); this._worlds(); } catch (e) { this.toast(e.message); }
      };
      el.appendChild(row);
    }
  }

  // ---------- skins ----------
  _skins() {
    this._clear();
    const p = this.cb.getProfile();
    const s = this._el(`
      <div class="menu-screen">
        <h2>Skins &amp; Profile</h2>
        <div class="panel">
          <div class="row">
            <label>Player name:&nbsp;</label>
            <input id="m-pname" class="input" maxlength="16" value="${escapeHTML(p.name)}">
          </div>
          <div class="skin-grid" id="m-skingrid"></div>
          <div class="row">
            <button class="btn" id="m-back">Back</button>
            <button class="btn primary" id="m-save">Save</button>
          </div>
        </div>
      </div>`);
    const grid = s.querySelector('#m-skingrid');
    let chosen = p.skin;
    for (const sk of SKINS) {
      const card = this._el(`
        <div class="skin-card ${sk.id === chosen ? 'selected' : ''}" data-id="${sk.id}">
          <img src="${skinPreviewURL(sk.id)}" draggable="false">
          <span>${sk.name}</span>
        </div>`);
      card.onclick = () => {
        Sfx.click();
        chosen = sk.id;
        grid.querySelectorAll('.skin-card').forEach(c => c.classList.toggle('selected', c.dataset.id === chosen));
      };
      grid.appendChild(card);
    }
    s.querySelector('#m-back').onclick = () => { Sfx.click(); this._title(); };
    s.querySelector('#m-save').onclick = () => {
      Sfx.pop();
      const name = s.querySelector('#m-pname').value.trim() || 'Player';
      this.cb.setProfile({ name: name.replace(/[^\w\- ]/g, '').slice(0, 16) || 'Player', skin: chosen });
      this._title();
    };
    this.root.appendChild(s);
  }

  // ---------- help ----------
  _help() {
    this._clear();
    const rows = [
      ['W A S D', 'Move'], ['Mouse', 'Look around'], ['Space', 'Jump / swim / fly up'],
      ['Double Space', 'Toggle fly (creative)'], ['Shift', 'Sneak / fly down'],
      ['Ctrl or double-W', 'Sprint'], ['Left click', 'Break block (hold in survival)'],
      ['Right click', 'Place block / use crafting table'], ['Middle click', 'Pick block'],
      ['1–9 / wheel', 'Select hotbar slot'], ['E', 'Inventory & 2x2 crafting'], ['T or /', 'Chat / commands'],
      ['Tab', 'Player list'], ['F3', 'Debug info'], ['F5', 'Third-person view'], ['Esc', 'Pause'],
    ];
    const s = this._el(`
      <div class="menu-screen">
        <h2>How to Play</h2>
        <div class="panel narrow">
          <table class="help-table">${rows.map(r => `<tr><td><kbd>${r[0]}</kbd></td><td>${r[1]}</td></tr>`).join('')}</table>
          <p class="muted">Survival tip: punch a tree for logs ➜ craft planks ➜ a crafting table ➜
          tools (axe chops faster, stone blocks need a pickaxe to drop anything).</p>
          <p class="muted">Commands: /gamemode creative|survival, /time day|night, /help</p>
          <button class="btn" id="m-back">Back</button>
        </div>
      </div>`);
    s.querySelector('#m-back').onclick = () => { Sfx.click(); this._title(); };
    this.root.appendChild(s);
  }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(ts) {
  if (!ts) return 'never played';
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
