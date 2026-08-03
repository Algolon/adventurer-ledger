# Runefolio product vision

Status: M2 product specification
Audience: product, design, engineering, QA
Visible product name: **Runefolio** (working name)
Scope boundary: this document does not rename the repository, Pages base path, manifest ID, or production code.

## Vision

Runefolio is a mobile-first, local-first D&D 2024/5.5e character builder and active digital character sheet. It should help a first-time player make a coherent character without hiding the rules, and let an experienced player preserve an unconventional or temporarily invalid build without fighting the tool.

The same app has two deliberately different centers of gravity:

- **Mobile:** create, level, and play a character with one hand, weak connectivity, and limited attention.
- **Desktop:** perform wide-screen comparison, detailed configuration, content management, and import/export.

IndexedDB remains authoritative on each device. “Local-first” must be visible in normal workflows, not relegated to a privacy statement. There is no automatic cloud sync and no implication that another device is current.

## Product promise

> Build with guidance, bend with intent, and play from the state that is actually on this device.

Runefolio earns trust by making four things consistently clear:

1. what the player chose;
2. what the rules engine derived and why;
3. what is incomplete, incompatible, missing, or overridden;
4. what is saved on this device and what has or has not been transferred.

## Jobs to be done

### Before a campaign

| Situation | Job | Successful outcome |
| --- | --- | --- |
| I am new to D&D | Help me make one legal, understandable character without reading every option | I reach a playable sheet and can explain my important choices |
| I know the concept I want | Let me compare meaningful options and see downstream consequences | I can choose confidently without tab-hopping through rules text |
| My table uses mixed or custom material | Let me select rulesets and sources without silently blending them | Every option shows provenance and compatibility |
| I already have a paper or external character | Let me enter what is true, even if Runefolio cannot justify it | The character is saved with visible manual/override provenance |
| I manage owned content on a PC | Let me prepare packs and move only the intended data to my phone | The phone can preview, verify, and import a portable file offline |

### During a session

| Situation | Job | Successful outcome |
| --- | --- | --- |
| The GM asks for a check | Show the relevant modifier and roll expression immediately | The answer takes at most two taps from the sheet home |
| I attack or cast a spell | Put action, roll, damage, save, range, and resource cost together | I can resolve the action without changing mental context |
| I take damage or spend a resource | Update mutable play state safely and visibly | The new value, cause, and undo affordance are clear |
| We rest | Apply only the selected rest effects and explain them | I can preview and undo the state transition |
| The network disappears | Keep the active sheet usable and be honest about cached content | No core play action depends on connectivity |

### Between sessions

| Situation | Job | Successful outcome |
| --- | --- | --- |
| I level up | Show only new decisions and a before/after diff | I can confirm or roll back the level safely |
| The GM grants an exception | Let me edit or override without losing the automated baseline | The exception has a reason and can be removed later |
| A pack changed or is missing | Preserve the character and help me recover references | No silent substitution; play-safe snapshots remain visible |
| I switch devices | Tell me which copy I am moving and whether the destination conflicts | Import is previewed, explicit, and recoverable |

## Product principles

### 1. Playable beats perfectly complete

A draft may be incomplete or invalid and still be valuable. Runefolio distinguishes:

- **complete:** all required choices resolved;
- **playable with warnings:** key play values exist, but issues remain;
- **incomplete:** required choices are absent;
- **blocked calculation:** a required dependency is missing or contradictory.

“Invalid” never means “discarded” or “unsaveable.”

### 2. Guidance is a layer, not a gate

Guided mode supplies recommendations, concise explanations, dependency-aware ordering, and safe defaults. Flexible mode uses the same underlying steps and state, but allows skipping, free entry, manual calculations, and explicit overrides. Switching modes never resets work.

### 3. Explain the number

Every important derived value has a compact breakdown: base, contributors, override, and source. Explanations are available on demand and do not crowd the play surface.

### 4. Separate build state from play state

Build choices, derived values, and mutable session state are visually and conceptually distinct. Level-up changes class features; spending Second Wind changes runtime state. Editing maximum hit points is not the same action as taking damage.

### 5. Device truth is explicit

The UI says “On this device,” shows last local save and backup/transfer status, and never uses cloud vocabulary such as “synced” unless an actual future sync capability exists.

### 6. Sources remain legible

Public, private, legacy, homebrew, character, and runtime data never collapse into one undifferentiated badge. Missing and conflicting sources are recoverable states, not generic errors.

### 7. The active sheet protects attention

Frequently used play actions are reachable without opening full rule text. Full explanations appear in sheets, drawers, or detail routes that preserve context and return position.

## Primary audiences

- **Learning player:** wants recommendations, plain-language consequences, and reassurance.
- **Experienced optimizer:** wants comparison, filters, complete provenance, and fast review.
- **Table-rule player:** needs manual entry and overrides without red error walls.
- **Mobile session player:** needs high-frequency actions in thumb reach and offline.
- **Local librarian:** manages private packs, sources, rulesets, and transfers primarily on desktop.

These are modes of work, not permanent personas; one user can occupy all five.

## Product modes

| Mode | Purpose | Entry point | Exit condition |
| --- | --- | --- | --- |
| Library | Find, resume, duplicate, archive, transfer, or create | App launch / Characters | Character or management task selected |
| Create | Establish a level-1 character | New character | Review confirmed or draft saved |
| Build/Edit | Change durable character configuration | Manage character | Changes reviewed or abandoned |
| Level up | Add exactly one level with a scoped diff | Sheet / Library | New snapshot confirmed |
| Play | Use and mutate session state | Open sheet | User leaves character |
| Content administration | Manage packs, sources, rulesets, import/export | Settings | User returns to play/library |

## Success measures for the Brammel slice

The first vertical slice should prove the product model, not broad rules coverage:

- A new user can create synthetic Brammel from blank draft to a level-1 playable sheet on a 360 px viewport.
- A returning user can resume at the exact unresolved choice after reload and offline restart.
- Guided and flexible mode share one saved draft and can be switched without data loss.
- Every Brammel headline value identifies its inputs and any override.
- A level-up preview shows decisions and before/after results before committing.
- A PC-to-phone transfer can be previewed and imported without network or automatic sync.
- Missing source and conflict states preserve the character and offer safe next actions.

## Non-goals for M2

- broad official-book coverage or copied non-SRD text;
- multiclassing, campaign management, VTT integration, or automatic cloud sync;
- production visual redesign in this documentation branch;
- changes to schemas, Dexie, repositories, import/export services, or production UI;
- perfect automation for every house rule;
- desktop-only configuration that makes mobile creation dependent on a PC.

## Product decision guardrails

When requirements conflict, prefer in this order:

1. preserve user data and provenance;
2. keep the active character usable offline;
3. expose uncertainty rather than inventing certainty;
4. keep common play actions fast;
5. teach progressively;
6. optimize visual density.
