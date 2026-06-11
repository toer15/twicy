// Minimal RFC 6455 WebSocket server — zero dependencies.
// Supports text frames, fragmentation, ping/pong and clean closes.
'use strict';

const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 4 * 1024 * 1024;

class WSConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = 0;
    this.closed = false;
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;

    socket.on('data', d => this._onData(d));
    socket.on('error', () => this._destroy());
    socket.on('close', () => this._destroy());
    socket.setNoDelay(true);
  }

  _onData(data) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;
    try {
      while (this._parseFrame()) { /* keep parsing */ }
    } catch (e) {
      this.close(1002);
    }
  }

  _parseFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return false;
    const b0 = buf[0], b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = 2;

    if (len === 126) {
      if (buf.length < 4) return false;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return false;
      const hi = buf.readUInt32BE(2);
      const lo = buf.readUInt32BE(6);
      if (hi !== 0) throw new Error('frame too large');
      len = lo;
      off = 10;
    }
    if (len > MAX_MESSAGE) throw new Error('frame too large');

    let mask = null;
    if (masked) {
      if (buf.length < off + 4) return false;
      mask = buf.subarray(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return false;

    let payload = buf.subarray(off, off + len);
    this.buffer = buf.subarray(off + len);
    if (mask) {
      payload = Buffer.from(payload); // unmask a copy
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }

    switch (opcode) {
      case 0x0: // continuation
        if (!this.fragOpcode) throw new Error('unexpected continuation');
        this.fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragments);
          const op = this.fragOpcode;
          this.fragments = [];
          this.fragOpcode = 0;
          this._deliver(op, full);
        }
        break;
      case 0x1: case 0x2: // text / binary
        if (!fin) {
          this.fragOpcode = opcode;
          this.fragments = [payload];
        } else {
          this._deliver(opcode, payload);
        }
        break;
      case 0x8: // close
        this.close(1000);
        return false;
      case 0x9: // ping -> pong
        this._sendFrame(0xA, payload);
        break;
      case 0xA: // pong
        this.alive = true;
        break;
      default:
        throw new Error('bad opcode');
    }
    return this.buffer.length > 0;
  }

  _deliver(opcode, payload) {
    this.alive = true;
    if (opcode === 0x1 && this.onmessage) {
      this.onmessage(payload.toString('utf8'));
    }
  }

  _sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) { this._destroy(); }
  }

  send(str) {
    this._sendFrame(0x1, Buffer.from(str, 'utf8'));
  }

  ping() {
    this._sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (!this.closed) {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code);
      this._sendFrame(0x8, b);
    }
    this._destroy();
  }

  _destroy() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch (e) {}
    if (this.onclose) {
      const cb = this.onclose;
      this.onclose = null;
      cb();
    }
  }
}

// attach to an http server; onConnection(conn, req) for upgrades at `path`
function attachWebSocketServer(httpServer, path, onConnection) {
  const conns = new Set();

  httpServer.on('upgrade', (req, socket) => {
    const url = (req.url || '').split('?')[0];
    if (url !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    if (!key || version !== '13' || !/upgrade/i.test(req.headers.connection || '') ||
        !/websocket/i.test(req.headers.upgrade || '')) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const conn = new WSConnection(socket);
    conns.add(conn);
    const prevClose = () => conns.delete(conn);
    conn.onclose = prevClose;
    onConnection(conn, req);
    // chain user-assigned onclose with registry cleanup
    const userClose = conn.onclose === prevClose ? null : conn.onclose;
    conn.onclose = () => {
      conns.delete(conn);
      if (userClose) userClose();
    };
  });

  // keepalive: ping every 30s, drop the dead after 75s of silence
  const interval = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.close(1001); continue; }
      c.alive = false;
      c.ping();
    }
  }, 30000);
  interval.unref();

  return { conns };
}

module.exports = { attachWebSocketServer, WSConnection };
