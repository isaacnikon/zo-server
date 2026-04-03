class PacketReader {
  private _buf: Buffer;
  private _pos: number;

  constructor(buffer: Buffer, offset = 0) {
    this._buf = buffer;
    this._pos = offset;
  }

  readUint8(): number {
    const value = this._buf.readUInt8(this._pos);
    this._pos += 1;
    return value;
  }

  readUint16(): number {
    const value = this._buf.readUInt16LE(this._pos);
    this._pos += 2;
    return value;
  }

  readUint32(): number {
    const value = this._buf.readUInt32LE(this._pos);
    this._pos += 4;
    return value;
  }

  readBytes(length: number): Buffer {
    const slice = this._buf.slice(this._pos, this._pos + length);
    this._pos += length;
    return slice;
  }

  readString(): string {
    const length = this.readUint16();
    const value = this._buf.toString('latin1', this._pos, this._pos + length);
    this._pos += length;
    return value;
  }

  skip(length: number): this {
    this._pos += length;
    return this;
  }

  remaining(): number {
    return this._buf.length - this._pos;
  }

  position(): number {
    return this._pos;
  }
}

export {
  PacketReader,
};
