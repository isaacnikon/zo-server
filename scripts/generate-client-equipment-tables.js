#!/usr/bin/env node
'use strict';

process.stderr.write(
  'Deprecated: use scripts/generate-client-derived-tables.py. ' +
  'The old JS generator read the server-side dump instead of client archive data.\n'
);
process.exitCode = 1;
