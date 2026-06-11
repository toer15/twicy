// WebSocket client wrapper with a tiny event emitter.
'use strict';

class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
  }

  on(type, fn) { this.handlers.set(type, fn); }

  connect(address) {
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
        const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('Connection timed out')); }, 6000);
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
          const was = this.connected;
          this.connected = false;
          this.ws = null;
          if (was) this._emit('disconnect', {});
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
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.connected = false;
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
  }
}
