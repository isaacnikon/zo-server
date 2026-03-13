/**
 * Zodiac Online - Packet Capture Proxy
 * Sits between the game client and server, logging all raw bytes.
 * Usage: node capture.js [--forward <real_ip>:<port>]
 */

const net = require('net');
const fs = require('fs');

const LISTEN_PORT = 7777;
const LOG_FILE = 'capture.log';

// Optional: forward to real server (set via env or args)
const FORWARD_HOST = process.env.FORWARD_HOST || null;
const FORWARD_PORT = parseInt(process.env.FORWARD_PORT || '7777');

let sessionCount = 0;
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

function parsePacketHeader(buf) {
  if (buf.length < 4) return null;
  // Try common MMO packet formats:
  // Format 1: [size:2][cmd:2][data...]
  // Format 2: [size:2][flag:1][cmd:1][data...]
  // Format 3: [size:4][cmd:2][data...]
  const size16le = buf.readUInt16LE(0);
  const size16be = buf.readUInt16BE(0);
  const byte2 = buf[2];
  const byte3 = buf[3];
  return {
    size16le, size16be,
    cmd_at2: `0x${byte2.toString(16).padStart(2,'0')}${byte3.toString(16).padStart(2,'0')}`,
    first4: buf.slice(0,4).toString('hex'),
    length: buf.length
  };
}

const server = net.createServer((clientSocket) => {
  const sessionId = ++sessionCount;
  const clientAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
  log(`\n=== SESSION ${sessionId} CONNECTED from ${clientAddr} ===`);

  let serverSocket = null;
  let clientBuffer = Buffer.alloc(0);
  let serverBuffer = Buffer.alloc(0);

  if (FORWARD_HOST) {
    serverSocket = net.createConnection(FORWARD_PORT, FORWARD_HOST);
    log(`[S${sessionId}] Forwarding to ${FORWARD_HOST}:${FORWARD_PORT}`);

    serverSocket.on('connect', () => {
      log(`[S${sessionId}] Connected to real server`);
    });

    serverSocket.on('data', (data) => {
      serverBuffer = Buffer.concat([serverBuffer, data]);
      const hdr = parsePacketHeader(data);
      log(`[S${sessionId}] SERVER->CLIENT (${data.length} bytes) header: ${JSON.stringify(hdr)}`);
      log(hexDump(data, `[S${sessionId}] S>C `));
      clientSocket.write(data);
    });

    serverSocket.on('error', (err) => log(`[S${sessionId}] Server socket error: ${err.message}`));
    serverSocket.on('close', () => {
      log(`[S${sessionId}] Server socket closed`);
      clientSocket.destroy();
    });
  }

  clientSocket.on('data', (data) => {
    clientBuffer = Buffer.concat([clientBuffer, data]);
    const hdr = parsePacketHeader(data);
    log(`[S${sessionId}] CLIENT->SERVER (${data.length} bytes) header: ${JSON.stringify(hdr)}`);
    log(hexDump(data, `[S${sessionId}] C>S `));

    // Try to identify strings in the packet
    const str = data.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    if (str.replace(/\./g, '').length > 3) {
      log(`[S${sessionId}] ASCII: ${str}`);
    }

    if (serverSocket && serverSocket.writable) {
      serverSocket.write(data);
    } else if (!FORWARD_HOST) {
      // Send a basic ACK to keep connection alive for capture
      // (no-op: just capture, don't respond)
    }
  });

  clientSocket.on('close', () => {
    log(`[S${sessionId}] Client disconnected. Total captured: C>${clientBuffer.length}B S>${serverBuffer.length}B`);
    if (serverSocket) serverSocket.destroy();

    // Save full session dump
    const dumpFile = `session_${sessionId}.bin`;
    fs.writeFileSync(dumpFile, clientBuffer);
    log(`[S${sessionId}] Full client data saved to ${dumpFile}`);
  });

  clientSocket.on('error', (err) => log(`[S${sessionId}] Client error: ${err.message}`));
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  log(`Capture proxy listening on port ${LISTEN_PORT}`);
  if (FORWARD_HOST) {
    log(`Forwarding to ${FORWARD_HOST}:${FORWARD_PORT}`);
  } else {
    log(`Capture-only mode (no forwarding). Set FORWARD_HOST env to proxy to real server.`);
  }
  log(`Logs written to ${LOG_FILE}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
