# Runefolio design system direction

## Direction

Runefolio should feel like a dependable field tool with a hint of fantasy, not a themed imitation of a published rulebook. Brand character comes from restrained color, typography, original icon treatment, and tactile state changes. Information density and legibility win over ornament during play.

Do not copy competitor layouts, trade dress, art, iconography, dice, frames, book textures, or protected content.

## System principles

1. **Task before decoration:** the primary action and current state are recognizable in a glance.
2. **One component, adaptive composition:** mobile and desktop share primitives and semantics.
3. **State is not color alone:** icon, label, and sometimes pattern accompany color.
4. **Provenance on demand:** badges identify meaningful source boundaries without turning every row into metadata soup.
5. **Fantasy at the edges:** display type and subtle linework may carry tone; forms and numeric play controls remain utilitarian.
6. **Motion confirms causality:** animation connects an action to a result and is never required to understand it.

## Foundations

### Color roles

Define semantic tokens before palette values:

- `surface.canvas`, `surface.raised`, `surface.sunken`, `surface.inverse`;
- `text.primary`, `text.secondary`, `text.inverse`, `text.link`;
- `border.default`, `border.strong`, `focus.ring`;
- `action.primary`, `action.secondary`, `action.danger`;
- `state.success`, `state.info`, `state.warning`, `state.danger`;
- provenance roles for `public`, `private`, `legacy`, `homebrew`, `manual`, and `override`.

Every text/background pair must meet WCAG 2.2 AA: 4.5:1 for normal text and 3:1 for large text and essential graphical objects. Selected, disabled, hover, focus, offline, and high-contrast variants are part of the token definition.

The current navy/brass/paper direction may evolve, but paper texture must not reduce contrast and cream surfaces must not imply protected book trade dress.

### Typography

- UI/body: highly legible system or bundled open-license sans serif;
- display: restrained open-license serif for character names and major headings;
- numeric stats: tabular figures to prevent layout shift;
- minimum default body size: 16 CSS px on mobile;
- support 200% text zoom and OS text scaling without horizontal document scroll.

Do not use all-caps for sentences. Eyebrows and badges need sufficient letter spacing and accessible names that do not repeat every visual decoration.

### Spacing and layout

Use a 4 px base with common steps 4, 8, 12, 16, 24, 32, and 48. Mobile page gutters start at 16 px and may reduce to 12 px only for dense tables. Content maintains `min-width: 0`, safe-area padding, and no fixed minimum wider than 320 px.

Reading text targets 45–75 characters per line. Wide desktop layouts add columns; they do not stretch forms and rule text across the viewport.

### Shape and elevation

Use modest radii to group controls, not different radii for every hierarchy level. Elevation is limited to navigation, transient sheets/dialogs, and dragged/floating elements. Borders and spacing establish most hierarchy.

## Iconography

Use one consistent open-license icon family (the repository currently uses Lucide) plus a small set of original Runefolio marks if needed.

Rules:

- icons are 20–24 px in ordinary controls and optically aligned;
- every icon-only control has a stable accessible label and at least 44 × 44 CSS px target;
- do not use two icons for the same concept or one icon for unrelated concepts;
- pair unfamiliar icons with text until repeated context makes them unambiguous;
- chevron means navigation/disclosure, not submit;
- pencil means edit durable data; plus/minus means runtime increment/decrement only when the target is labelled;
- cloud icons are prohibited for transfer because there is no cloud sync;
- source badges use text labels; a lock alone cannot distinguish private, restricted, or device-local.

Suggested mappings:

| Concept | Icon direction | Required label example |
| --- | --- | --- |
| Characters | person/card | Characters |
| Active sheet | document with stats | Sheet |
| Compendium | book/search | Compendium |
| Settings | gear | Settings |
| Transfer | device-to-device or file arrows | Transfer to another device |
| Local storage | database/device | On this device |
| Override | sliders/adjustment | Override automatic value |
| Missing source | broken link/book alert | Missing source |
| Offline ready | device-check | Ready offline |

## Core components

### App shell

Compact top bar, adaptive primary navigation, page/task title, and a single state slot. Mobile headers must not reserve a full second row for global search unless search is the current task.

### Buttons

One primary action per task region. Secondary, quiet, and danger styles are distinct. Destructive actions state the object and are not icon-only in confirmation dialogs. Loading buttons retain width and label context.

### Choice card

Choice cards contain a radio/checkbox semantic control, name, concise effect/play-style summary, provenance, recommendation explanation, and optional detail disclosure. The entire card may be the label, but details must be a separate focusable action so selecting and reading are not conflated.

### Step status

Five statuses: not started, in progress, complete, warning, blocked. Use label + icon + count. A progress bar communicates position, not validity.

### Issue summary

Issues group by severity and destination. Each issue contains a plain-language consequence and one primary repair action. It identifies stable record ID/field path where needed but never private values.

### Stat tile

Stat tiles show label, value, optional roll action, and override/unknown state. The value itself is not the only control. At 200% zoom tiles reflow rather than shrink.

### Resource tracker

Label, current/max, reset cadence, and large spend/recover controls. Dot/pip visuals are supplemental; numeric text is authoritative.

### Bottom sheet / side panel

The same detail component appears as a bottom sheet on phone and docked/overlay side panel on desktop. It has a visible title, close control, focus management, back semantics, and scroll containment.

### Toast / receipt

Toasts confirm reversible low-risk changes and include Undo when applicable. They never contain essential-only information, never cover bottom navigation or focused input, pause for hover/focus, and respect reduced motion. Persistent privacy/offline facts belong in Settings or a compact state indicator, not a permanent toast.

## Content and provenance badges

Use badges only when the distinction affects choice, compatibility, export, or recovery.

| Badge | Meaning | Example treatment |
| --- | --- | --- |
| 2024 | Active edition | neutral/info |
| Legacy | Older rules option | warning-toned, not error |
| Private | User-owned local content | privacy-toned |
| Restricted | Excluded from standard export | lock + text |
| Homebrew | Custom rules source | distinct neutral |
| Manual | No content definition drives this value | adjustment + text |
| Override | Automatic baseline changed | visible accent and breakdown |
| Missing source | Reference cannot resolve | warning/danger by consequence |

Never encode `private` and `exportRestricted` as synonyms.

## Accessibility and touch requirements

Minimum bar for M2:

- WCAG 2.2 AA target;
- 44 × 44 CSS px minimum target, with 48 px preferred for session actions;
- at least 8 px visual separation between adjacent destructive/high-frequency targets;
- visible focus at 3:1 against adjacent colors;
- semantic headings, landmarks, lists, buttons, radios, checkboxes, status, and alerts;
- no drag-only, swipe-only, hover-only, color-only, icon-only, or motion-only meaning;
- error text adjacent to the control and summarized at step level;
- focus moves to the error summary only after submit/review, not during typing;
- inputs use correct autocomplete/inputmode without exposing private text;
- portrait images have user-controlled alt behavior; decorative fantasy marks are hidden;
- reduced motion removes transforms/parallax and shortens nonessential transitions;
- forced-colors support preserves borders, selection, focus, and issue severity;
- landscape and 200% zoom remain usable at 360 px CSS width;
- touch actions do not rely on double-tap or long-press.

## Motion

Use 120–200 ms transitions for local disclosure and 180–240 ms for route/task changes. Resource spend may animate from old to new value, but the text change and receipt are authoritative. Respect `prefers-reduced-motion`. No simulated dice physics is required for M2.

## Responsive acceptance matrix

Every implemented character surface must be reviewed at 360, 390, 412, 768, 1024, and 1440 px.

At each width verify:

- `document.documentElement.scrollWidth <= window.innerWidth` except intentionally scoped horizontal regions;
- focused controls remain visible above virtual keyboard assumptions and sticky footer;
- primary action is reachable without precision tapping;
- dialogs/sheets fit the viewport and scroll internally;
- long synthetic names, badges, and localized text wrap safely;
- navigation does not overlap content;
- no toast covers navigation or a primary action;
- text zoom and screen-reader labels remain coherent.

Horizontal scroll is permitted only inside an explicitly labelled data table or optional carousel with keyboard controls and edge affordances. Creation step navigation must not depend on it.

## Content writing

- Use verbs: “Choose class,” “Apply 3 damage,” “Transfer character.”
- Explain consequence before mechanism.
- Replace “invalid” with the specific issue and its effect.
- Say “saved on this device,” never “synced.”
- Keep recommendation copy neutral: “Recommended because…”
- For destructive action, name both object and recovery: “Replace local Brammel; a restore point will be kept.”
- Sanitized errors identify operation, stable ID/path when safe, and next action; they never echo imported JSON, full text, or notes.
