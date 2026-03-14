# Heaven Maps

## Confirmed Map IDs
- `204` = `Celestial State`
- `206` = `South Gate`
- `207` = `Cloud Hall`
- `208` = `Covert Palace`
- `209` = `Peach Garden`
- `210` = `West County Pass`

## Working Heaven Travel
- `207` Cloud Hall -> `209` Peach Garden
- `209` Peach Garden -> `207` Cloud Hall

## Trigger Model
- Cloud Hall originally exposed a `.b` scene trigger region, but for stable routing the server now relies on the client's own `0x03f1` request rather than server-side tile bridging.
- Peach Garden standing teleporter request:
  - `0x03f1 / sub=0x01 / script=1 / map=209`

The current working server behavior is to interpret that request as a direct scene transition.

## Peach Garden Notes
- Peach Garden is confirmed as `map 209`
- `136` was a false lead for Peach Garden; it belongs to a Rainbow Valley quest jump into Bling Alley 1
- The `#2<08><1000><0>` Apollo link path was a dead end for auto-navigation:
  - clicking it produced only `0x03f1 / sub=0x01 / script=1000 / map=209`
  - replying with `0x03e7`, `0x0407`, or `0x03f1` message variants did not reproduce the world transition
- The real world transition happens later via the Apollo film exit request:
  - `0x03f1 / sub=0x02 / script=20001`

## NPC Notes
- Peach Garden NPC setup from client scripts is usable for visible world spawns
- Apollo is still special:
  - `macro_AddNpcDemo(2,3054,117,127,"Apollo")`
  - current evidence still treats Apollo as a film/demo actor, not a plain free-roam spawn
