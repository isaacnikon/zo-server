/**
 * Zodiac Online - Game Server (Node.js)
 * Handles login flow for gc12.exe client
 *
 * Packet format (confirmed via Ghidra decompile of FUN_0058b730):
 *   [0]   flags byte  (must satisfy: byte & 0xE0 == 0x40)
 *   [1-2] uint16 LE   payload length (max 0x4000)
 *   [3-4] uint16 LE   sequence number
 *   [5+]  payload     (length bytes)
 *   Total = 5 + payload_length
 */

'use strict';

const net = require('net');
const fs = require('fs');

const PORT = 7777;
const LOG_FILE = 'server.log';

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

function hexDump(buf, prefix = '') {
  const lines = [];
  for (let i = 0; i < buf.length; i += 16) {
    const chunk = buf.slice(i, i + 16);
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    lines.push(`${prefix}${i.toString(16).padStart(4, '0')}: ${hex.padEnd(47)} | ${ascii}`);
  }
  return lines.join('\n');
}

// ── Packet builder ──────────────────────────────────────────────────────────

class PacketWriter {
  constructor() {
    this._buf = Buffer.alloc(4096);
    this._pos = 0;
  }
  writeUint8(v)  { this._buf.writeUInt8(v, this._pos);   this._pos += 1; }
  writeUint16(v) { this._buf.writeUInt16LE(v, this._pos); this._pos += 2; }
  writeUint32(v) { this._buf.writeUInt32LE(v, this._pos); this._pos += 4; }
  writeBytes(buf) { buf.copy(this._buf, this._pos); this._pos += buf.length; }
  writeString(str) {
    const b = Buffer.from(str, 'latin1');
    this._buf.writeUInt16LE(b.length, this._pos); this._pos += 2;
    b.copy(this._buf, this._pos); this._pos += b.length;
  }
  writeStringFixed(str, len) {
    const b = Buffer.alloc(len, 0);
    Buffer.from(str, 'latin1').copy(b);
    b.copy(this._buf, this._pos); this._pos += len;
  }
  payload() { return this._buf.slice(0, this._pos); }
}

function buildPacket(payload, seqNum, flags = 0x40) {
  const pkt = Buffer.alloc(5 + payload.length);
  pkt[0] = flags;                             // flags byte
  pkt.writeUInt16LE(payload.length, 1);       // payload length
  pkt.writeUInt16LE(seqNum, 3);               // sequence number
  payload.copy(pkt, 5);
  return pkt;
}

// ── Packet reader ───────────────────────────────────────────────────────────

class Session {
  constructor(socket, id) {
    this.socket = socket;
    this.id = id;
    this.recvBuf = Buffer.alloc(0);
    this.serverSeq = 0;   // seq we send to client (client expects 0 first)
    this.clientSeq = 0;   // seq we expect from client
    this.state = 'CONNECTED'; // CONNECTED → LOGGED_IN
  }

  feed(data) {
    this.recvBuf = Buffer.concat([this.recvBuf, data]);
    while (this.recvBuf.length >= 5) {
      const flags = this.recvBuf[0];
      if ((flags & 0xe0) !== 0x40) {
        log(`[S${this.id}] Bad flags byte: 0x${flags.toString(16)} — dropping connection`);
        this.socket.destroy();
        return;
      }
      const payloadLen = this.recvBuf.readUInt16LE(1);
      const totalLen = 5 + payloadLen;
      if (this.recvBuf.length < totalLen) break; // wait for more data

      const seq    = this.recvBuf.readUInt16LE(3);
      const payload = this.recvBuf.slice(5, totalLen);
      this.recvBuf  = this.recvBuf.slice(totalLen);

      log(`[S${this.id}] RECV pkt flags=0x${flags.toString(16)} len=${payloadLen} seq=${seq}`);
      log(hexDump(payload, `[S${this.id}] < `));

      this.handlePacket(flags, seq, payload);
    }
  }

  handlePacket(flags, seq, payload) {
    if (payload.length === 0) return;

    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    log(`[S${this.id}] CMD8=0x${cmdByte.toString(16).padStart(2,'0')} CMD16=0x${cmdWord.toString(16).padStart(4,'0')} state=${this.state}`);

    // Log all readable strings in payload
    const readable = payload.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    log(`[S${this.id}] ASCII: ${readable}`);

    switch (this.state) {
      case 'CONNECTED':
        this.handleLogin(cmdByte, payload, seq);
        break;
      case 'LOGGED_IN':
        this.handleGamePacket(flags, payload, seq);
        break;
    }
  }

  handleLogin(cmdByte, payload, seq) {
    log(`[S${this.id}] Login packet received, cmd=0x${cmdByte.toString(16)}`);
    log(`[S${this.id}] Full payload hex: ${payload.toString('hex')}`);
    // Extract printable strings (username/password likely in here)
    for (let i = 0; i < payload.length - 1; i++) {
      let s = '';
      while (i < payload.length && payload[i] >= 0x20 && payload[i] < 0x7f) {
        s += String.fromCharCode(payload[i++]);
      }
      if (s.length > 3) log(`[S${this.id}] String at ${i}: "${s}"`);
    }
    this.state = 'LOGGED_IN';
    this.sendLoginResponse();
  }

  sendHandshake() {
    // Server MUST send this first — client waits in state 1→2 for it
    // Format (from FUN_00589960 + FUN_005895d0):
    //   uint16 cmd = 1
    //   uint32 seed (0 = no XOR encryption)
    //
    // Seed != 0 generates XOR key: key[i] = (seed % 255) + 1; seed /= 19
    const pw = new PacketWriter();
    pw.writeUint16(1);       // handshake cmd
    pw.writeUint32(0);       // seed = 0 → no encryption
    // Flags = 0x44: bit 2 must be set — state-2 handler (FUN_0058b9c0) checks this
    const pkt = buildPacket(pw.payload(), this.serverSeq++, 0x44);
    if (this.serverSeq > 65000) this.serverSeq = 1;
    log(`[S${this.id}] Sending handshake (flags=0x44, seed=0, no encryption)`);
    log(hexDump(pkt, `[S${this.id}] > `));
    this.socket.write(pkt);
  }

  sendLoginResponse() {
    // Real server-selection path:
    //   cmd=0x03e9, result=0x03
    // followed by:
    //   u8, u8, u32, 8-byte line-enable header,
    //   then exactly 3 server entries,
    //   then trailing string + u8 flag.
    const pw = new PacketWriter();
    pw.writeUint16(0x03e9);
    pw.writeUint8(0x03);

    // Header fields consumed before FUN_00502d70 server-list parsing.
    pw.writeUint8(0x00);
    pw.writeUint8(0x00);
    pw.writeUint32(0x00000000);

    // 8 per-line enable bytes. Enable the first line only.
    pw.writeBytes(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]));

    // Entry 0: a selectable local line.
    pw.writeUint32(6101);        // areaID
    pw.writeUint16(7777);        // port
    pw.writeUint8(1);            // status / selectable
    pw.writeString('127.0.0.1'); // server IP/address
    pw.writeUint8(0);            // unknown1
    pw.writeUint8(0);            // unknown2

    // Entry 1: empty
    pw.writeUint32(0);

    // Entry 2: empty
    pw.writeUint32(0);

    // Trailing string + flag consumed after the 3 entries.
    pw.writeString('');
    pw.writeUint8(0);

    const pkt = buildPacket(pw.payload(), this.serverSeq++);
    if (this.serverSeq > 65000) this.serverSeq = 1;
    log(`[S${this.id}] Sending login response (success)`);
    log(hexDump(pkt, `[S${this.id}] > `));
    this.socket.write(pkt);
  }

  handleGamePacket(flags, payload, seq) {
    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    log(`[S${this.id}] Game packet flags=0x${flags.toString(16)} cmd8=0x${cmdByte.toString(16).padStart(2,'0')} cmd16=0x${cmdWord.toString(16).padStart(4,'0')}`);

    // Special control packets use flags=0x44.
    if ((flags & 0x04) !== 0 && payload.length >= 6) {
      if (cmdWord === 2) {
        const token = payload.readUInt32LE(2);
        this.sendPong(token);
        return;
      }
      log(`[S${this.id}] Unhandled special cmd16=0x${cmdWord.toString(16)}`);
      return;
    }

    switch (cmdByte) {
      case 0x4c:
        this.handle044c(payload);
        break;
      case 0x01:
        this.sendServerList();
        break;
      default:
        log(`[S${this.id}] Unhandled game cmd8=0x${cmdByte.toString(16)} cmd16=0x${cmdWord.toString(16)}`);
    }
  }

  sendPong(token) {
    const pw = new PacketWriter();
    pw.writeUint16(3);
    pw.writeUint32(token);
    const pkt = buildPacket(pw.payload(), this.serverSeq++, 0x44);
    if (this.serverSeq > 65000) this.serverSeq = 1;
    log(`[S${this.id}] Sending pong token=0x${token.toString(16)}`);
    log(hexDump(pkt, `[S${this.id}] > `));
    this.socket.write(pkt);
  }

  handle044c(payload) {
    if (payload.length < 3) {
      log(`[S${this.id}] Short 0x044c payload`);
      return;
    }

    const subcmd = payload[2];
    switch (subcmd) {
      case 0x1c: {
        const lineNo = payload.length >= 4 ? payload[3] : 0;
        log(`[S${this.id}] Line select request for line ${lineNo}`);
        this.sendLineSelectOk(lineNo);
        break;
      }
      default:
        log(`[S${this.id}] Unhandled 0x044c subcmd=0x${subcmd.toString(16)}`);
    }
  }

  sendLineSelectOk(lineNo) {
    // `FUN_0050a590` case 0x1b reads one byte, then transitions to role select (state 4).
    const pw = new PacketWriter();
    pw.writeUint16(0x03e9);
    pw.writeUint8(0x1b);
    pw.writeUint8(lineNo & 0xff);

    const pkt = buildPacket(pw.payload(), this.serverSeq++);
    if (this.serverSeq > 65000) this.serverSeq = 1;
    log(`[S${this.id}] Sending line-select success for line ${lineNo}`);
    log(hexDump(pkt, `[S${this.id}] > `));
    this.socket.write(pkt);
  }

  sendServerList() {
    const pw = new PacketWriter();
    // Server list response - format TBD
    pw.writeUint8(0x01);  // placeholder cmd
    pw.writeUint16(1);    // server count

    // Server entry
    pw.writeStringFixed('Luna(Smooth)', 32);
    pw.writeStringFixed('127.0.0.1', 16);
    pw.writeUint16(7777);
    pw.writeUint8(0);  // status OK
    pw.writeUint32(6101);  // area ID

    const pkt = buildPacket(pw.payload(), this.serverSeq++);
    if (this.serverSeq > 65000) this.serverSeq = 1;
    this.socket.write(pkt);
  }

  send(payload) {
    const pkt = buildPacket(payload, this.serverSeq++);
    if (this.serverSeq > 65000) this.serverSeq = 1;
    log(`[S${this.id}] SEND ${pkt.length} bytes seq=${this.serverSeq-1}`);
    log(hexDump(pkt, `[S${this.id}] > `));
    this.socket.write(pkt);
  }
}

// ── Main server ─────────────────────────────────────────────────────────────

let sessionCount = 0;

const server = net.createServer((socket) => {
  const session = new Session(socket, ++sessionCount);
  const addr = `${socket.remoteAddress}:${socket.remotePort}`;
  log(`\n=== SESSION ${session.id} CONNECTED from ${addr} ===`);
  session.sendHandshake();

  socket.on('data', (data) => {
    try { session.feed(data); }
    catch (err) { log(`[S${session.id}] Error: ${err.message}\n${err.stack}`); }
  });

  socket.on('close', () => log(`[S${session.id}] Disconnected`));
  socket.on('error', (err) => log(`[S${session.id}] Socket error: ${err.message}`));
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Zodiac Online server listening on port ${PORT}`);
  log(`Logs: ${LOG_FILE}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
