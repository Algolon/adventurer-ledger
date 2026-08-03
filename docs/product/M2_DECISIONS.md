# M2.1 product decisions

Status: accepted product gate for a bounded implementation

These decisions close the questions recorded in `M2_ACCEPTANCE_CRITERIA.md`. They constrain M2.1; later increments may extend them through versioned contracts without silently changing an existing character.

## Decision summary

| ID | Decision | M2.1 consequence |
| --- | --- | --- |
| D-01 | Brammel is built at level 1 and advanced to level 2 | One creation path and one level-up transaction are required |
| D-02 | “Boss” is identity only | Nickname has no rule effect |
| D-03 | Fixtures use one original 2024-style synthetic ruleset | No official non-SRD or private book text is required |
| D-04 | The automatic sheet has an explicit minimum input contract | Unknown required values block automatic calculation instead of becoming zero |
| D-05 | A classless flexible character has a separate manual-sheet contract | It cannot masquerade as an automatically justified character |
| D-06 | Overrides support only `replace` and `add` | Conditional, multiplicative, and formula overrides are deferred |
| D-07 | Durable history and session history are separate | Runtime actions do not create a full character version |
| D-08 | Level-up preserves the existing deficit or expenditure | Current values increase by the same delta as their maxima |
| D-09 | File transfer is the baseline | QR is deferred; transfer is never described as device replication |
| D-10 | Dice support is expression-only | Copy expression is actionable; there is no inactive Roll control |
| D-11 | A compact rail is preferred at an effective 1024 CSS px | It collapses when zoom or available content width makes it unsafe |

## D-01 — Brammel vertical slice

M2.1 creates Brammel “Boss” Voss at level 1 and advances the same character to level 2.

- “Boss” is stored and displayed as a nickname only.
- It never grants an action, resource, modifier, proficiency, tag, or recommendation.
- The class definition uses stable level-keyed grants so the same progression can extend to level 20.
- Only level 1 and level 2 definitions are implemented and accepted in M2.1.
- Level 3–5 definitions, a subclass choice, and subclass-feature progression belong to the next product increment.
- Multiclassing remains out of scope.

The original synthetic fixture vocabulary is:

| Concept | Synthetic fixture | Purpose |
| --- | --- | --- |
| Ruleset | `ruleset:runefolio-2024-synthetic` | 2024-style ordering and policies |
| Class path | `class:vanguard` | Single martial level 1–2 path |
| Species | `species:riverborn` | One origin species choice |
| Background | `background:caravan-warden` | One origin/background choice |
| Fighting choice | `style:guarded-hand` | One comparable class choice |
| Weapon choice | `mastery:measured-cut` | One weapon-mastery-like choice |
| Weapon | `weapon:longblade` | Longsword-like synthetic weapon |
| Shield | `armor:round-guard` | Shield-like equipment |
| Armor | `armor:travel-mail` | Armor-like equipment |
| Attack | `action:longblade-strike` | At least one playable attack |
| Resource | `resource:rallying-breath` | Limited class resource |

Names and concise summaries are original test material. They must not quote or closely paraphrase protected rules text. Stable IDs may outlive display-label refinement.

## D-02 — Minimum synthetic content

The slice contains exactly enough declarative content to prove the vertical path:

- the level 1–2 Vanguard class path with future level slots reserved by stable IDs;
- Riverborn species and Caravan Warden background/origin;
- language and skill/proficiency choice groups;
- standard-array and manual ability-score methods;
- Guarded Hand and Measured Cut choices;
- Longblade, Round Guard, and Travel Mail equipment;
- Longblade Strike and Rallying Breath;
- derived HP, hit dice, AC, initiative, speed, saves, and checks;
- no spell definitions or spell runtime state.

The creation step “Spells & resources” remains visible and reads `Not needed · This class has no spells at level 1`. The resource configuration still appears in that step. Tests and screenshots use only this synthetic material.

## D-03 — Minimum renderable sheet

### Automatically calculated Play sheet

An automatic sheet is renderable only when the resolver can produce all of the following without an unknown required input:

- name or the safe fallback `Unnamed character`;
- level and class;
- six ability scores and modifiers;
- proficiency bonus;
- current and maximum HP;
- AC;
- initiative;
- speed;
- saves and checks;
- at least one action or attack;
- every resource tracker required by the class at the current level.

Missing portrait, nickname, pronouns, alignment, appearance, biography, notes, and other narrative fields never block the sheet.

If any required calculation is unknown, the draft remains saveable and the affected value is `—`; it does not become zero. Review identifies the exact non-sensitive field path and recovery action.

### Neutral manual sheet

A flexible character without a class can open only as a **Manual character sheet** when the user has explicitly supplied:

- all six abilities;
- current and maximum HP;
- AC;
- initiative;
- at least one action;
- name or the safe fallback.

Speed, saves, checks, and resources may also be manual but are not inferred from a nonexistent class. The sheet carries a persistent Manual badge and never claims automatic rules justification. If the minimum is absent, the record is an incomplete draft with blocked calculations.

### Completion vocabulary

- **Renderable automatic:** all automatic-sheet minimums resolve.
- **Renderable manual:** all manual-sheet minimums are explicitly entered.
- **Guided-complete:** every required ruleset choice is resolved with no blocking or unacknowledged incompatible choice.
- **Incomplete:** saveable, but neither renderable contract is met.

Renderable and guided-complete are independent. A renderable automatic character may still have warnings; a guided-complete character necessarily meets the automatic minimum.

## D-04 — Override semantics

M2.1 accepts two typed operations:

```ts
type OverrideOperation = "replace" | "add";
```

- `replace` substitutes the automatic final value with the typed override value.
- `add` applies a typed numeric modifier to the automatic baseline.

Every stored override contains:

| Field | Contract |
| --- | --- |
| `targetPath` | Stable allow-listed derived-field path |
| `operation` | `replace` or `add` |
| `value` | Typed value valid for the target and operation |
| `automaticBaseline` | Resolver output at the revision on which the override was accepted |
| `scope` | Explicit duration/context, initially `persistent` or `until-level-up` |
| `createdAt` | ISO timestamp |
| `characterId` | Affected stable character ID |
| `reason` | Optional private user explanation |
| `sourceId` | Optional provenance when a table ruling or source motivated it |

The resolver recalculates the current automatic baseline before applying an override. The stored baseline remains audit context. If the target type or availability changes, the override is marked stale for review and is not executed blindly.

Multiplication, conditions, arbitrary formulas, script, and imported expressions are rejected in M2.1. Imported data is treated as unknown input and never executed.

## D-05 — Durable history and runtime history

### Character versions and restore points

These durable changes create a new character version:

- class, origin, abilities, proficiency, equipment, or other build choices;
- manual character values;
- overrides;
- ruleset changes;
- confirmed level-up;
- restore/import replacement.

A restore point captures the durable version reference plus runtime state before level-up, explicit session snapshot, import replacement, and restore. Ordinary form autosave remains draft history and does not create a committed character version.

### Session-action log

These actions update runtime state and append a lightweight action entry in one transaction:

- damage and healing;
- resource spend and recovery;
- condition add/remove;
- short/long rest application.

They do not create a full character version. An explicit session snapshot creates a restore point. Action entries store operation metadata and deltas, not copied private notes or rule text.

## D-06 — Level-up current-value policy

The synthetic ruleset uses **preserve deficit/expenditure** when a maximum increases:

```text
HP:       5 / 10 + 2 maximum → 7 / 12
Resource: 1 /  3 + 1 maximum → 2 /  4
```

Equivalent form: `newCurrent = oldCurrent + (newMaximum - oldMaximum)`, clamped only to the new valid range. A decreasing maximum uses an explicit preview and never creates a negative current value.

The level-up review always shows old current/max, maximum delta, policy, and resulting current/max. A user may change the proposed current value before confirmation; that decision is stored as manual or override provenance in the durable level-up result. Future rulesets may name a different versioned policy.

## D-07 — Transfer baseline

M2.1 supports user-controlled **file transfer** only. QR encoding is deferred.

A standard character transfer may contain:

- stable IDs and format version;
- durable character state;
- runtime state;
- a derived snapshot and safe display summaries;
- dependency IDs, versions, and non-sensitive availability metadata;
- character/version fingerprint and local timestamps.

It excludes by default:

- private `fullText`;
- biography and notes not required for the selected safe transfer;
- `exportRestricted` packs, sources, and entries;
- arbitrary imported payload fragments;
- action-log notes.

A character whose definitions are absent on the destination can display the last safe snapshot. Affected calculations are marked uncertain and cannot be silently recomputed from a name match. A self-contained restricted export is a separate, explicitly confirmed future/export-boundary mode and is not part of standard M2.1 transfer.

Conflict actions remain Keep both, Replace local with a restore point, and Cancel. Field-level merge is deferred.

## D-08 — Dice behavior

M2.1 displays an accessible roll expression and provides **Copy expression**. It does not generate a random result, animate dice, or maintain roll history. There is no control labelled Roll unless local random rolling is implemented in a later increment.

## D-09 — 1024 px navigation

At an effective viewport width of at least 960 CSS px, the prototype and later implementation may show a compact persistent navigation rail when the remaining content column stays readable.

At 200% zoom a physical 1024 px viewport typically exposes about 512 CSS px; the normal responsive query therefore returns to tablet/off-canvas navigation. No user-agent or device-class detection is required. Mobile task order and route labels remain unchanged.

## Explicit deferrals

- level 3–5 content and tests;
- subclass selection and subclass-feature progression;
- multiclassing;
- spells;
- QR transfer;
- self-contained restricted character export beyond the existing explicit content-export boundary;
- field-level transfer merge;
- random dice results, animation, and roll history;
- multiplicative, conditional, or formula overrides;
- automatic repair of missing definitions;
- broad rules/content coverage.

## Gate outcome

**GO for a bounded M2.1 production implementation** using the scope and contracts in this document, [M2_SERVICE_BOUNDARIES.md](M2_SERVICE_BOUNDARIES.md), and [M2_ACCEPTANCE_CRITERIA.md](M2_ACCEPTANCE_CRITERIA.md).

Recommended implementation branch: `codex/m2.1-brammel-character-slice`.
