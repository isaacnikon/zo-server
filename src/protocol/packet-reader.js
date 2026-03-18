'use strict';

class PacketReader {
  constructor(buffer, offset = 0) {
    this._buf = buffer;
    this._pos = offset;
  }

  readUint8() {
    const v = this._buf.readUInt8(this._pos);
    this._pos += 1;
    return v;
  }

  readUint16() {
    const v = this._buf.readUInt16LE(this._pos);
    this._pos += 2;
    return v;
  }

  readUint32() {
    const v = this._buf.readUInt32LE(this._pos);
    this._pos += 4;
    return v;
  }

  readBytes(n) {
    const slice = this._buf.slice(this._pos, this._pos + n);
    this._pos += n;
    return slice;
  }

  /** Read a u16-length-prefixed latin1 string. */
  readString() {
    const len = this.readUint16();
    const str = this._buf.toString('latin1', this._pos, this._pos + len);
    this._pos += len;
    return str;
  }

  skip(n) {
    this._pos += n;
    return this;
  }

  remaining() {
    return this._buf.length - this._pos;
  }

  position() {
    return this._pos;
  }
}

module.exports = { PacketReader };
