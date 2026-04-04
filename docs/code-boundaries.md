# Code Boundaries

The main source of ad hoc behavior in this codebase is that inbound packet handling currently mixes three different jobs:

- transport and routing
- gameplay state transitions
- instrumentation and one-off tracing

That makes `Session` and [`src/handlers/packet-dispatcher.ts`](/home/nikon/projects/zo-server/src/handlers/packet-dispatcher.ts) the default place to add anything new, which in turn weakens module boundaries over time.

## Target layering

`transport`
- [`src/server.ts`](/home/nikon/projects/zo-server/src/server.ts)
- [`src/session.ts`](/home/nikon/projects/zo-server/src/session.ts)
- [`src/handlers/packet-dispatcher.ts`](/home/nikon/projects/zo-server/src/handlers/packet-dispatcher.ts)

Responsibility:
- parse frames
- identify packet families
- delegate to the correct runtime/service
- never own gameplay rules

`application/runtime`
- [`src/gameplay/*`](/home/nikon/projects/zo-server/src/gameplay)
- [`src/scenes/*`](/home/nikon/projects/zo-server/src/scenes)
- [`src/handlers/*`](/home/nikon/projects/zo-server/src/handlers)

Responsibility:
- coordinate state changes across session, world, quest, combat, pets, and inventory
- own workflows such as movement sync, quest acceptance, item use, and team coordination
- keep orchestration near the feature, not in the packet router

`domain/pure logic`
- [`src/quest2/*`](/home/nikon/projects/zo-server/apps/game-server/src/quest2)
- [`src/combat/combat-formulas.ts`](/home/nikon/projects/zo-server/src/combat/combat-formulas.ts)
- [`src/character/normalize.ts`](/home/nikon/projects/zo-server/src/character/normalize.ts)
- [`src/inventory/*`](/home/nikon/projects/zo-server/src/inventory)
- [`src/protocol/*`](/home/nikon/projects/zo-server/src/protocol)

Responsibility:
- pure calculations, schemas, parsing, serialization, and deterministic decisions
- no logging, no socket writes, no filesystem access

`infrastructure`
- [`src/character-store.ts`](/home/nikon/projects/zo-server/src/character-store.ts)
- [`src/logger.ts`](/home/nikon/projects/zo-server/src/logger.ts)
- [`src/runtime-paths.ts`](/home/nikon/projects/zo-server/src/runtime-paths.ts)

Responsibility:
- filesystem and process-adjacent concerns
- persistence, logging sinks, runtime paths

`observability`
- [`src/observability/packet-tracing.ts`](/home/nikon/projects/zo-server/src/observability/packet-tracing.ts)

Responsibility:
- packet tracing and debug probes
- must not own gameplay behavior

## Rules

1. `packet-dispatcher` may route, but it should not update quest/world/team/map state directly.
2. Debug tracing belongs in `observability`, not beside gameplay decisions.
3. If logic needs both map sync and team/world updates, it belongs in a feature runtime module, not in `Session`.
4. Pure modules should accept data and return data; they should not depend on `GameSession`.
5. `Session` should remain a stateful shell for transport, packet writing, and delegation.

## First cut applied

The current refactor starts enforcing those rules in three places:

- movement side effects moved into [`src/gameplay/movement-runtime.ts`](/home/nikon/projects/zo-server/src/gameplay/movement-runtime.ts)
- packet tracing moved into [`src/observability/packet-tracing.ts`](/home/nikon/projects/zo-server/src/observability/packet-tracing.ts)
- server-run request orchestration moved into [`src/gameplay/server-run-runtime.ts`](/home/nikon/projects/zo-server/src/gameplay/server-run-runtime.ts)

That leaves `packet-dispatcher` responsible for identifying the packet and selecting the correct workflow, instead of embedding each workflow inline.

## Next worthwhile extractions

- introduce a narrower `SessionPorts` interface so handlers stop depending on the full mutable `GameSession`
- split `Session` construction/default state from `Session` transport behavior
- carve the combat entry path out of `Session.sendCombatEncounterProbe()` into a combat application service
