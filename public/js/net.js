// WebSocket client wrapper with a tiny event emitter.
'use strict';

class Net {
  constructor() {
    this.ws = null;
    this.local = null; // offline mode: in-browser LocalServer bridge
    this.handlers = new Map();
    this.connected = false;
  }

  on(type, fn) { this.handlers.set(type, fn); }

  connect(address, timeoutMs = 6000) {
    // address '@local' = offline single-player backed by localStorage
    if (address === '@local') {
      this.local = new LocalServer(msg => this._emit(msg.t, msg));
      this.connected = true;
      return Promise.resolve();
    }
    // address like "host:port" or full ws url; empty = same origin
    let url;
    if (!address) {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      url = `${scheme}://${location.host}/ws`;
    } else if (address.startsWith('ws://') || address.startsWith('wss://')) {
      url = address.replace(/\/?$/, '').endsWith('/ws') ? address : address.replace(/\/$/, '') + '/ws';
    } else {
      url = `ws://${address}/ws`;
    }
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('Connection timed out')); }, timeoutMs);
        ws.onopen = () => {
          clearTimeout(timer);
          this.ws = ws;
          this.connected = true;
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          if (!this.connected) reject(new Error('Could not connect to server'));
        };
        ws.onclose = () => {
          // ignore sockets that never became (or stopped being) the active one,
          // e.g. a failed same-origin probe closing after we fell back to local
          if (this.ws !== ws) return;
          this.connected = false;
          this.ws = null;
          this._emit('disconnect', {});
        };
        ws.onmessage = ev => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          if (msg && msg.t) this._emit(msg.t, msg);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  _emit(type, msg) {
    const fn = this.handlers.get(type);
    if (fn) fn(msg);
  }

  send(obj) {
    if (this.local) { this.local.handle(obj); return; }
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.connected = false;
    if (this.local) { this.local.close(); this.local = null; }
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
  }
}
