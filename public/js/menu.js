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
          <button class="btn" id="m-friends">Friends</button>
          <button class="btn" id="m-skins">Skins &amp; Profile</button>
          <div class="row">
            <button class="btn" id="m-settings">Settings</button>
            <button class="btn" id="m-help">How to Play</button>
          </div>
        </div>
        <div class="menu-footer">
          <span>${GAME_NAME} ${GAME_VERSION} — a Minecraft-inspired game</span>
          <span>Playing as <b>${escapeHTML(p.name)}</b></span>
        </div>
      </div>`);
    s.querySelector('#m-play').onclick = () => { Sfx.unlock(); Sfx.click(); this.address = ''; this._worlds(); };
    s.querySelector('#m-mp').onclick = () => { Sfx.unlock(); Sfx.click(); this._connect(); };
    s.querySelector('#m-skins').onclick = () => { Sfx.unlock(); Sfx.click(); this._skins(); };
    s.querySelector('#m-friends').onclick = () => { Sfx.unlock(); Sfx.click(); this._friends(); };
    s.querySelector('#m-settings').onclick = () => { Sfx.unlock(); Sfx.click(); openSettings(() => this._title()); };
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
          <div class="row mode-row">
            <button class="btn mode small-mode selected" id="m-vis-pub">🌍 Public<small>Anyone on this server sees it</small></button>
            <button class="btn mode small-mode" id="m-vis-priv">🔒 Private<small>Only you + invited friends</small></button>
            <button class="btn mode small-mode selected" id="m-mobs-on">👾 Mobs: ON<small>Monsters at night, animals by day</small></button>
          </div>
          <div class="row">
            <button class="btn" id="m-back">Back</button>
            <button class="btn primary" id="m-create">Create &amp; Play</button>
          </div>
        </div>
      </div>`);
    this.root.appendChild(s);
    let mode = 'survival', visibility = 'public', mobs = true;
    const bS = s.querySelector('#m-mode-s'), bC = s.querySelector('#m-mode-c');
    const pick = m => {
      mode = m;
      bS.classList.toggle('selected', m === 'survival');
      bC.classList.toggle('selected', m === 'creative');
      Sfx.click();
    };
    bS.onclick = () => pick('survival');
    bC.onclick = () => pick('creative');
    const bPub = s.querySelector('#m-vis-pub'), bPriv = s.querySelector('#m-vis-priv');
    const pickVis = v => {
      visibility = v;
      bPub.classList.toggle('selected', v === 'public');
      bPriv.classList.toggle('selected', v === 'private');
      Sfx.click();
    };
    bPub.onclick = () => pickVis('public');
    bPriv.onclick = () => pickVis('private');
    const bMobs = s.querySelector('#m-mobs-on');
    bMobs.onclick = () => {
      mobs = !mobs;
      bMobs.classList.toggle('selected', mobs);
      bMobs.innerHTML = mobs ? '👾 Mobs: ON<small>Monsters at night, animals by day</small>'
                             : '😴 Mobs: OFF<small>A peaceful world</small>';
      Sfx.click();
    };
    s.querySelector('#m-back').onclick = () => { Sfx.click(); this._title(); };
    s.querySelector('#m-create').onclick = async () => {
      Sfx.click();
      const name = s.querySelector('#m-wname').value.trim() || 'New World';
      const seed = s.querySelector('#m-wseed').value.trim() || String((Math.random() * 1e9) | 0);
      try {
        const id = await this.cb.createWorld({ name, seed, mode, visibility, mobs });
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
    const mine = worlds.filter(w => w.yours || w.visibility !== 'public');
    const pub = worlds.filter(w => !mine.includes(w));
    if (mine.length) {
      const h = document.createElement('div');
      h.className = 'world-group';
      h.textContent = 'Your worlds & invites';
      el.appendChild(h);
      for (const w of mine) this._worldRow(el, w);
    }
    if (pub.length) {
      const h = document.createElement('div');
      h.className = 'world-group';
      h.textContent = '🌍 Public worlds on this server';
      el.appendChild(h);
      for (const w of pub) this._worldRow(el, w);
    }
  }

  _worldRow(el, w) {
    {
      const row = this._el(`
        <div class="world-row">
          <div class="world-info">
            <b>${escapeHTML(w.name)}</b>
            <span class="badge ${w.mode}">${w.mode}</span>
            ${w.visibility === 'private' ? '<span class="badge private">🔒 private</span>' : ''}
            ${w.mobs === false ? '<span class="badge">no mobs</span>' : ''}
            ${w.players ? `<span class="badge online">${w.players} online</span>` : ''}
            <small>${w.owner ? 'by ' + escapeHTML(w.owner) + ' • ' : ''}seed ${escapeHTML(String(w.seed))} • ${timeAgo(w.lastPlayed)}</small>
          </div>
          <div class="world-actions">
            <button class="btn primary sm">Play</button>
            ${w.yours !== false ? '<button class="btn danger sm">✕</button>' : ''}
          </div>
        </div>`);
      const [playBtn, delBtn] = row.querySelectorAll('button');
      playBtn.onclick = async () => {
        Sfx.click();
        try { await this.cb.joinWorld(w.id); } catch (e) { this.toast(e.message); }
      };
      if (delBtn) delBtn.onclick = async () => {
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

  // ---------- friends ----------
  async _friends() {
    this._clear();
    const s = this._el(`
      <div class="menu-screen">
        <h2>Friends</h2>
        <div class="panel worlds-panel">
          <div id="m-foffline" class="offline-note hidden">Friends need a server — start the game with <b>npm start</b> (or join one) to use friends.</div>
          <div class="row">
            <input id="m-fsearch" class="input" placeholder="Search player name…" maxlength="16">
            <button class="btn sm" id="m-fsearch-btn">Search</button>
          </div>
          <div id="m-fresults"></div>
          <h3>Requests</h3>
          <div id="m-frequests" class="muted">None</div>
          <h3>Your friends</h3>
          <div id="m-flist" class="muted">Loading…</div>
          <div class="row"><button class="btn" id="m-back">Back</button></div>
        </div>
      </div>`);
    this.root.appendChild(s);
    s.querySelector('#m-back').onclick = () => { Sfx.click(); this._title(); };

    const render = data => {
      if (!s.isConnected) return;
      s.querySelector('#m-foffline').classList.toggle('hidden', !data.offline);
      const reqEl = s.querySelector('#m-frequests');
      reqEl.innerHTML = '';
      if (!data.requests || !data.requests.length) reqEl.textContent = 'None';
      for (const name of data.requests || []) {
        const row = this._el(`<div class="friend-row"><b>${escapeHTML(name)}</b> wants to be friends
          <span><button class="btn primary sm">Accept</button> <button class="btn sm">Decline</button></span></div>`);
        const [acc, dec] = row.querySelectorAll('button');
        acc.onclick = () => { Sfx.pop(); this.cb.friendAction({ t: 'faccept', from: name }); };
        dec.onclick = () => { Sfx.click(); this.cb.friendAction({ t: 'fdecline', from: name }); };
        reqEl.appendChild(row);
      }
      const listEl = s.querySelector('#m-flist');
      listEl.innerHTML = '';
      if (!data.friends || !data.friends.length) listEl.textContent = 'No friends yet — search above!';
      for (const f of data.friends || []) {
        const where = f.online ? (f.world ? (f.world.id ? `playing <b>${escapeHTML(f.world.name)}</b>` : 'in a private world') : 'in the menus') : 'offline';
        const row = this._el(`<div class="friend-row">
          <span><span class="dot ${f.online ? 'on' : ''}"></span> <b>${escapeHTML(f.name)}</b> <small>${where}</small></span>
          <span>${f.world && f.world.id ? '<button class="btn primary sm">Join</button>' : ''}
          <button class="btn danger sm">Remove</button></span></div>`);
        const btns = row.querySelectorAll('button');
        if (f.world && f.world.id) {
          btns[0].onclick = async () => {
            Sfx.click();
            try { await this.cb.joinWorld(f.world.id); } catch (e) { this.toast(e.message); }
          };
        }
        btns[btns.length - 1].onclick = () => {
          if (confirm(`Remove ${f.name} from friends?`)) this.cb.friendAction({ t: 'fremove', name: f.name });
        };
        listEl.appendChild(row);
      }
    };
    this.onFriendList = render; // live updates while screen open

    const doSearch = async () => {
      const q = s.querySelector('#m-fsearch').value.trim();
      if (q.length < 2) return this.toast('Type at least 2 letters');
      try {
        const res = await this.cb.friendSearch(q);
        const out = s.querySelector('#m-fresults');
        out.innerHTML = '';
        if (res.offline) return;
        if (!res.list.length) out.innerHTML = '<div class="muted">No players found (they must have visited this server)</div>';
        for (const u of res.list) {
          const row = this._el(`<div class="friend-row">
            <span><span class="dot ${u.online ? 'on' : ''}"></span> <b>${escapeHTML(u.name)}</b></span>
            <span>${u.friend ? '<small>already friends</small>' : u.requested ? '<small>request sent</small>' : '<button class="btn primary sm">Add friend</button>'}</span></div>`);
          const btn = row.querySelector('button');
          if (btn) btn.onclick = () => {
            Sfx.pop();
            this.cb.friendAction({ t: 'frequest', to: u.name });
            btn.replaceWith(this._el('<small>request sent</small>'));
          };
          out.appendChild(row);
        }
      } catch (e) { this.toast(e.message); }
    };
    s.querySelector('#m-fsearch-btn').onclick = doSearch;
    s.querySelector('#m-fsearch').addEventListener('keydown', e => { if (e.code === 'Enter') doSearch(); });

    try {
      const data = await this.cb.friendList();
      render(data);
    } catch (e) {
      render({ offline: true, friends: [], requests: [] });
    }
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

// ---------- shared settings overlay (title screen + pause menu) ----------
function openSettings(onClose) {
  const el = document.getElementById('settings-screen');
  el.classList.remove('hidden');
  el.innerHTML = '';
  const S = App.settings;
  const save = () => saveJSON('twicy.settings', S);
  const panel = document.createElement('div');
  panel.className = 'panel settings-panel';
  panel.innerHTML = '<h2>Settings</h2>';

  const section = title => {
    const d = document.createElement('div');
    d.innerHTML = `<h3>${title}</h3>`;
    panel.appendChild(d);
    return d;
  };
  const slider = (parent, label, key, min, max, step, fmt) => {
    const row = document.createElement('label');
    row.className = 'set-row';
    row.innerHTML = `<span>${label}: <b></b></span>`;
    const val = row.querySelector('b');
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = S[key];
    val.textContent = fmt ? fmt(S[key]) : S[key];
    inp.oninput = () => {
      S[key] = parseFloat(inp.value);
      val.textContent = fmt ? fmt(S[key]) : S[key];
      save();
      applySettings();
    };
    row.appendChild(inp);
    parent.appendChild(row);
  };
  const toggle = (parent, label, key) => {
    const btn = document.createElement('button');
    btn.className = 'btn set-toggle';
    const refresh = () => { btn.textContent = `${label}: ${S[key] ? 'ON' : 'OFF'}`; };
    refresh();
    btn.onclick = () => { Sfx.click(); S[key] = !S[key]; refresh(); save(); applySettings(); };
    parent.appendChild(btn);
  };
  const choice = (parent, label, key, options) => {
    const btn = document.createElement('button');
    btn.className = 'btn set-toggle';
    const refresh = () => { btn.textContent = `${label}: ${String(S[key]).toUpperCase()}`; };
    refresh();
    btn.onclick = () => {
      Sfx.click();
      S[key] = options[(options.indexOf(S[key]) + 1) % options.length];
      refresh(); save(); applySettings();
    };
    parent.appendChild(btn);
  };

  const vid = section('Video');
  slider(vid, 'Render distance', 'renderDist', 3, 10, 1, v => v + ' chunks');
  slider(vid, 'Field of view', 'fov', 50, 110, 1);
  choice(vid, 'Particles', 'particles', ['all', 'reduced', 'off']);
  toggle(vid, 'Clouds', 'clouds');
  toggle(vid, 'View bobbing', 'viewBob');
  const fsBtn = document.createElement('button');
  fsBtn.className = 'btn set-toggle';
  fsBtn.textContent = 'Toggle Fullscreen';
  fsBtn.onclick = () => {
    Sfx.click();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  vid.appendChild(fsBtn);

  const ctr = section('Controls');
  slider(ctr, 'Mouse sensitivity', 'sensitivity', 0.2, 3, 0.1, v => v.toFixed(1));
  toggle(ctr, 'Invert Y axis', 'invertY');

  const aud = section('Audio');
  slider(aud, 'Master volume', 'soundVolume', 0, 100, 5, v => v + '%');
  toggle(aud, 'Sound', 'sound');

  const done = document.createElement('button');
  done.className = 'btn primary big';
  done.textContent = 'Done';
  done.onclick = () => {
    Sfx.click();
    el.classList.add('hidden');
    if (onClose) onClose();
  };
  panel.appendChild(done);
  el.appendChild(panel);
}

function applySettings() {
  Sfx.enabled = App.settings.sound;
  Sfx.setVolume((App.settings.soundVolume ?? 100) / 100);
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
