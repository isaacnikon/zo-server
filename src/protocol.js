'use strict';

const { DEFAULT_FLAGS } = require('./config');

class PacketWriter {
  constructor(size = 4096) {
    this._buf = Buffer.alloc(size);
    this._pos = 0;
  }

  writeUint8(v) {
    this._buf.writeUInt8(v, this._pos);
    this._pos += 1;
  }

  writeUint16(v) {
    this._buf.writeUInt16LE(v, this._pos);
    this._pos += 2;
  }

  writeUint32(v) {
    this._buf.writeUInt32LE(v, this._pos);
    this._pos += 4;
  }

  writeBytes(buf) {
    buf.copy(this._buf, this._pos);
    this._pos += buf.length;
  }

  writeString(str) {
    const buf = Buffer.from(str, 'latin1');
    this.writeUint16(buf.length);
    this.writeBytes(buf);
  }

  writeStringFixed(str, len) {
    const buf = Buffer.alloc(len, 0);
    Buffer.from(str, 'latin1').copy(buf);
    this.writeBytes(buf);
  }

  payload() {
    return this._buf.slice(0, this._pos);
  }
}

function buildPacket(payload, seqNum, flags = DEFAULT_FLAGS) {
  const pkt = Buffer.alloc(5 + payload.length);
  pkt[0] = flags;
  pkt.writeUInt16LE(payload.length, 1);
  pkt.writeUInt16LE(seqNum, 3);
  payload.copy(pkt, 5);
  return pkt;
}

module.exports = {
  PacketWriter,
  buildPacket,
};
