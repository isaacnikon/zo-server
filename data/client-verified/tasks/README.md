Client-verified quest metadata extracted from the installed client build.

Files:
- `tasklist.txt`: raw task table extracted from `/home/nikon/Data/Zodiac Online/gcg/attrres.rc`
- `tasklist.json`: parsed UTF-8 JSON version of the same table
- `selected-tasks.json`: the currently referenced quest IDs validated from this client build

Notes:
- `tasklist.txt` was decoded with `gb18030`.
- This folder is intended to be the structured handoff point before moving quest data into a database.
- Treat the raw file as the source of truth and the JSON files as derived artifacts.
