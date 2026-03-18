#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-runtime.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-runtime.lua');

function main() {
  const runtime = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const lua = `return ${toLua(runtime, 0)}\n`;
  fs.writeFileSync(OUTPUT_FILE, lua, 'utf8');
  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function toLua(value, indentLevel) {
  if (value === null || value === undefined) {
    return 'nil';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'nil';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return `"${escapeLuaString(value)}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '{}';
    }
    const indent = '  '.repeat(indentLevel);
    const nextIndent = '  '.repeat(indentLevel + 1);
    const parts = value.map((entry) => `${nextIndent}${toLua(entry, indentLevel + 1)}`);
    return `{\n${parts.join(',\n')}\n${indent}}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    if (entries.length === 0) {
      return '{}';
    }
    const indent = '  '.repeat(indentLevel);
    const nextIndent = '  '.repeat(indentLevel + 1);
    const parts = entries.map(([key, entryValue]) => `${nextIndent}${formatLuaKey(key)} = ${toLua(entryValue, indentLevel + 1)}`);
    return `{\n${parts.join(',\n')}\n${indent}}`;
  }
  return 'nil';
}

function formatLuaKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? key
    : `["${escapeLuaString(key)}"]`;
}

function escapeLuaString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/"/g, '\\"');
}

main();
