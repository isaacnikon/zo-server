This directory contains generated quest scaffolding derived from the installed client.

Files:
- `catalog.json`: full normalized quest catalog merged from `tasklist.json`, extracted help blocks, and live runtime quest definitions.

Source kinds:
- `tasklist`: quest exists in the extracted client `tasklist.txt`.
- `help_only`: quest was recovered from client help/script text but is not present in the extracted tasklist dataset.

Status meanings:
- `runnable`: the server already has a verified runtime quest definition.
- `needs_override`: the client exposes quest/help metadata, but packet-level trigger details are still missing.
- `metadata_only`: the quest exists in the client task table, but no usable help block has been extracted yet.

This is intended as a structured staging area before moving quest metadata into a database.
