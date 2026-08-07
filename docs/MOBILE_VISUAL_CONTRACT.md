# Mobile visual contract

Runefolio has one theme, one scroll axis and one orientation on a phone. This
document states those rules, what enforces each of them, and what they cost.

## The rules

1. Runefolio has one visual theme: dark.
2. No normal Runefolio surface scrolls horizontally.
3. The installed mobile app is portrait-primary.
4. Mobile landscape never reveals a squeezed or alternative landscape UI.
5. Desktop and larger-tablet layouts stay responsive and landscape-capable.

## One global dark theme

`app/theme.css` is the single token source. It declares `color-scheme: dark` at
`:root` and every surface, text, line and semantic colour the app uses. No other
stylesheet may state a colour literally, and none reads the operating system's
colour preference.

The previous architecture was a light default with a partial dark override on
the play sheet only, expressed as two `prefers-color-scheme: dark` blocks and a
parallel `--sh-*` token set. That is two products: a phone set to light rendered
parchment cards, a phone set to dark rendered navy ones, and every surface with
no dark branch — Compendium, Settings, import, the offline banner — stayed light
inside a dark shell. Both blocks and the parallel token set are gone.

The identity is unchanged: midnight-ink navy, deep blue, burnished brass and
warm parchment text. It is not a generic black-and-white dark mode.

### What paints when

| Layer | Value | Why it exists |
| --- | --- | --- |
| `background_color` in the manifest | `#08121B` | The Android splash screen, painted before the app's first frame |
| Inline `style` on `<html>` | `#08121B` | The frame before any stylesheet resolves, on a cold or slow load |
| `<meta name="color-scheme">` | `dark` | The user agent's own control, scrollbar and overscroll palette |
| `theme.css` `html` background | `--deep` | What an overscroll bounce exposes past the end of `body` |

All four are needed. Any one of them missing is a white flash somewhere in the
launch sequence, and none of them is observable in a rendered DOM.

### Contrast

Measured against the surface each token is used on:

| Token | Ratio | Requirement |
| --- | --- | --- |
| `--ink` | ≥ 13.5:1 | WCAG 1.4.3 AA text (4.5:1) |
| `--muted` | ≥ 5.8:1 | WCAG 1.4.3 AA text (4.5:1) |
| `--brass` | ≥ 5.3:1 | WCAG 1.4.3 AA text (4.5:1) |
| `--border` | ≥ 3.3:1 | WCAG 1.4.11 non-text contrast (3:1) |
| semantic ink/background pairs | ≥ 8:1 | WCAG 1.4.3 AA text (4.5:1) |

No state is carried by colour alone. Selected sheet sections pair colour with a
filled surface, a brass underline and `aria-selected`; badges always carry a
word; proficiency is a filled ring; navigation pairs colour with weight and a
rule.

## Zero horizontal scrolling

Overflow is fixed at the layout, never hidden. `overflow-x: clip` was removed
from the shell, the main region and the page: with it in place
`document.documentElement.scrollWidth` can never exceed `clientWidth`, so every
overflow assertion in the browser suite would have passed against a broken
layout while the content was merely invisible.

What changed:

- **Sheet sections** were `display: flex; overflow-x: auto`. At 360 px a
  caster's fifth section sat off the right edge, findable only by dragging a
  container with no affordance saying it could be dragged. They are now a grid
  of exactly as many equal columns as there are sections, sized from
  `--sheet-tab-count`, with an icon over a full-word label.
- **Builder step navigation** is a vertical list at every width.
- **Level-up comparison tables** were `white-space: nowrap` inside a focusable
  wrapper announced as "scrollable". The cells wrap; the wrapper is gone.
- **Registry rows** (packs, sources) stack below 720 px so a long identifier
  gets the full width to wrap into.
- **Raw entry data** wraps rather than being its own scroll container.
- Long identifiers, source IDs and validation codes wrap globally through
  `overflow-wrap: anywhere`.

`tests/e2e/mobile-visual-contract.spec.ts` asserts, on every primary surface:

```
document.documentElement.scrollWidth <= document.documentElement.clientWidth
document.body.scrollWidth            <= document.body.clientWidth
```

plus, for every element on the page, that its box does not overhang the viewport
and that nothing with `overflow-x: auto | scroll | hidden | clip` conceals
content — which is the assertion that stops a future overflow being "fixed" by
clipping it. Primary navigation and task containers are checked individually.

Covered widths: 320, 360, 375, 390 and 412 px; 200% zoom at 640, 512 and 384
effective CSS px; long character names; long content labels; and both the
four-section and five-section sheets.

A deliberate exception: the sticky sheet-section strip is full-bleed through a
negative margin, so it reaches both viewport edges. Its `overflow: visible`
parent therefore reports a larger `scrollWidth`. Nothing is concealed and
nothing scrolls — an element that cannot scroll does not scroll — so the
assertions measure scrollability, not ink overflow.

## Portrait-first

Three layers, each allowed to be absent:

1. `orientation: "portrait-primary"` in the manifest. Android, installed only.
2. `screen.orientation.lock("portrait-primary")` at runtime, attempted **once**,
   and only in an installed app on a phone. See `src/pwa/orientation.ts`.
3. The portrait guard, which is the only layer that always works.

A rejected or missing lock is a capability gap, not a failure. It is the
expected outcome on iOS, in every desktop browser and in any non-installed tab.
Nothing is shown to the user, because there is no action they could take. The
attempt is held behind a ref so it is never retried in a loop.

The guard covers the complete app, uses ordinary dark Runefolio styling, and
marks the app `inert` — which removes the whole subtree from the focus order,
from pointer events and from the accessibility tree. It is a sibling of the app,
not a wrapper, so raising and lowering it never remounts anything: an
in-progress build, a half-typed field, an open drawer and the scroll position
all survive a rotation. The app is never rotated with a CSS transform, which
would give it the wrong hit targets, the wrong scroll axis and a reading order
that lies to a screen reader.

The guard is scoped to coarse-pointer, phone-sized contexts only. It never
appears on a desktop window — including a narrow one, and including a browser at
200% zoom — or on a tablet.

### Accessibility tradeoff

**Portrait-only operation on phones is a deliberate restriction, and it excludes
some people.**

Someone whose phone is mounted, braced or held in a fixed landscape position
cannot use Runefolio while it is in that position. This includes users of
wheelchair- and bed-mounted holders, mounting arms, and switch access or head
pointing rigs where the device orientation is set by the physical rig rather
than chosen per app. For those users the guard is not a prompt — it is a wall,
and "turn your phone upright" is not an instruction they can follow.

This is accepted for the current increment on the following grounds, and it is
not a permanent decision:

- The alternative shipped today is worse, not better. A landscape phone layout
  that has never been designed or tested is not access; the app bar, the sheet
  vitals row and the bottom bar together leave roughly a hundred pixels of
  content between them.
- The restriction is scoped as narrowly as it can be. It applies only to
  coarse-pointer phone-sized contexts. Tablets and desktop windows keep a fully
  responsive, landscape-capable layout, so a mounted tablet — the common
  assistive configuration — is unaffected.
- No data is lost or made unreachable. All state is preserved behind the guard
  and every character remains exportable through a transfer file from any
  supported device.
- The guard is a normal app surface, not an error: it uses the app's own
  styling, states the reason, and says the user's place is kept.

The honest fix is a designed landscape layout for phones, not a smaller guard.
That is the work this tradeoff defers, and it should be reconsidered before the
app is presented as generally accessible on mobile.

## Required physical device test

Emulated rotation is **not** evidence that a physical device honours an
orientation lock. Chromium's viewport emulation neither installs the app nor
exercises the Screen Orientation API, so the manifest's `orientation` and the
runtime lock are both unverified by CI.

After deployment, on a real Android phone:

1. Install Runefolio from the browser's "Install app" / "Add to home screen".
2. Confirm the splash screen is dark — no white or parchment flash on launch.
3. With the OS set to **light** mode, launch the installed app and confirm every
   surface is dark: Characters, builder, sheet, Compendium, Settings.
4. With the OS auto-rotate **on**, rotate the phone to landscape while on the
   character sheet. Expect the app to stay portrait.
5. If it does rotate, confirm the portrait guard covers the app, that nothing
   behind it can be tapped, and that rotating back restores the same screen with
   the same scroll position and any typed input intact.
6. Repeat step 4 mid-build, on a builder step with a half-typed character name,
   and confirm the name is still there afterwards.
7. Confirm the app bar clears the status bar and the bottom bar clears the home
   indicator or gesture bar, with no content trapped under either.
8. Overscroll the top and bottom of a long sheet and confirm no light band
   appears.
9. Repeat 2–5 on iOS Safari's "Add to Home Screen", where the lock API is absent
   and the guard is the only layer in force.

Record the device, OS version and browser version with the result.
