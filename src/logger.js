'use strict';

const fs = require('fs');

function createLogger(logFile) {
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });

  function log(message) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${message}`;
    console.log(line);
    logStream.write(line + '\n');
  }

  function hexDump(buf, prefix = '') {
    const lines = [];
    for (let i = 0; i < buf.length; i += 16) {
      const chunk = buf.slice(i, i + 16);
      const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(chunk).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      lines.push(`${prefix}${i.toString(16).padStart(4, '0')}: ${hex.padEnd(47)} | ${ascii}`);
    }
    return lines.join('\n');
  }

  function close() {
    logStream.end();
  }

  return { log, hexDump, close };
}

module.exports = {
  createLogger,
};
