# Human World Maps

## Confirmed Map IDs
- `101` = `Rainbow Valley`
- `102` = `Bling Alley`
- `103` = `Bling Spring`

## Confirmed Entry
- Apollo post-film exit from Peach Garden lands in `101` Rainbow Valley
- Trigger request:
  - `0x03f1 / sub=0x02 / mode=0xfe / contextId=12 / extra=0 / script=20001`

## Verified Working Travel Chain
- `209` Peach Garden -> `101` Rainbow Valley
- `101` Rainbow Valley -> `103` Bling Spring
- `103` Bling Spring -> `101` Rainbow Valley
- `103` Bling Spring -> `102` Bling Alley
- `102` Bling Alley -> `103` Bling Spring

## Position-Aware Travel Windows
The client reuses the same `0x03f1` family across multiple exits, so route resolution is position-aware.

### Rainbow Valley
- `map=101, sub=0x01, script=1` -> `Bling Spring`
- verified exit window near:
  - `x=70..77`
  - `y=0..20`
- practical note:
  - `script=1` in Rainbow Valley is reused by non-travel paths too
  - leaving this trigger ungated causes quest/script collisions
  - the working server fix is a narrow position window plus transition priority inside that window

### Bling Alley
- `map=102, sub=0x01, script=1`
- east-side exit window near:
  - `x=110..127`
  - `y=170..210`
- destination:
  - `Bling Spring`

### Bling Spring
- `map=103, sub=0x01, script=1`
- east-side hotspot near:
  - `x=116..123`
  - `y=188..195`
- destination:
  - `Rainbow Valley`

- `map=103, sub=0x01, script=2`
- west-side hotspot near:
  - `x=0..12`
  - `y=186..193`
- destination:
  - `Bling Alley`

## Arrival Points Currently Used
- `Rainbow Valley -> Bling Spring`
  - lands near Bling Spring east edge to avoid the middle of the map
- `Bling Alley -> Bling Spring`
  - lands near Bling Spring west edge
- `Bling Spring -> Rainbow Valley`
  - lands south of the Rainbow Valley teleporter region
- `Bling Spring -> Bling Alley`
  - lands outside the east-exit bounce region

These are implementation coordinates, not necessarily canonical client-script home points.

## NPC Scene Alignment
- `102` Bling Alley and `103` Bling Spring NPC sets are now confirmed to look correct in-game
- Earlier `102`/`103` naming was reversed and has been corrected
