'use strict';
export {};

const fs = require('fs');
type LogWriter = {
  log: (message: string) => void;
  hexDump: (buf: Buffer, prefix?: string) => string;
  close: () => void;
};

function createLogger(logFile: string): LogWriter {
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });

  function log(message: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${message}`;
    console.log(line);
    logStream.write(line + '\n');
  }

  function hexDump(buf: Buffer, prefix = ''): string {
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i += 16) {
      const chunk = buf.slice(i, i + 16);
      const hex = Array.from(chunk).map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(chunk).map((b: number) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      lines.push(`${prefix}${i.toString(16).padStart(4, '0')}: ${hex.padEnd(47)} | ${ascii}`);
    }
    return lines.join('\n');
  }

  function close(): void {
    logStream.end();
  }

  return { log, hexDump, close };
}

module.exports = {
  createLogger,
};
