'use strict';

const fs = require('fs');
const path = require('path');

class CharacterStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {};
      }
      throw err;
    }
  }

  save() {
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
  }

  get(account) {
    if (!account) {
      return null;
    }
    return this.data[account] || null;
  }

  set(account, character) {
    if (!account) {
      return;
    }
    this.data[account] = character;
    this.save();
  }
}

module.exports = {
  CharacterStore,
};
