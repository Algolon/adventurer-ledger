# Prototype validation findings

Validation date: 2026-08-03

## Tested flow

The dependency-free prototype was served as a static document and exercised through its browser-accessible controls:

1. empty Character Library;
2. New character;
3. Start / ruleset → Class → Origin;
4. select Vanguard and Riverborn/Caravan Warden;
5. change Guided → Flexible → Guided and confirm both selections remain checked;
6. jump through the native All steps disclosure to Review;
7. Finish and open sheet;
8. copy `1d20 + 5` through Copy expression;
9. open the AC `add +1` override detail;
10. open the standard file-transfer preview and inspect exclusions.

The browser accessibility tree exposed native button, radio, checkbox, progress, disclosure, status, note, navigation, region, heading, term, and definition semantics. There are no click handlers on non-interactive `div`/`span` elements and no positive `tabindex` values. Escape closes the character menu and restores focus to its invoker.

## Responsive measurements

Library, long-label Class step, Play, override detail, and transfer preview were measured at every required width with an 800 px viewport height.

| Width | Document / viewport | Navigation | Minimum visible button | Finding |
| ---: | --- | --- | ---: | --- |
| 360 | 360 / 360 | Mobile app bar; no rail | 44 px | Pass; long Class/Origin labels wrap, one-column task order |
| 390 | 390 / 390 | Mobile app bar; no rail | 44 px | Pass; no clipped cards or fixed-footer overlap |
| 412 | 412 / 412 | Mobile app bar; no rail | 44 px | Pass; detail terms and fingerprint wrap safely |
| 768 | 768 / 768 | Tablet app bar; centered content | 44 px | Pass; two-column opportunities do not reorder the task |
| 1024 | 1024 / 1024 | Compact persistent 220 px rail | 44 px | Pass; remaining content column stays usable |
| 1440 | 1440 / 1440 | Compact persistent 220 px rail | 44 px | Pass; content width is capped and readable |

For every measured screen and viewport:

- `document.documentElement.scrollWidth === window.innerWidth`;
- no non-fixed element crossed the viewport edge;
- visible buttons were at least 44 px high and wide;
- the rail appeared at 1024/1440 and disappeared below the effective 960 CSS px threshold;
- the fixed task footer/bottom navigation stayed inside the application content region.

Because media queries use effective CSS pixels, browser text/page zoom that reduces a physical 1024 px viewport below 960 CSS px automatically selects the tablet/off-canvas composition.

## Interaction findings

- Guided/Flexible is presentation state: switching twice preserved both selected records.
- Review can represent incomplete or renderable automatic state without changing stored choices.
- “Spells & resources” remains the sixth step and exposes `Not needed` for spells plus the Rallying Breath resource.
- The Play home gives distinct controls for runtime actions, value detail, and expression copying; it has no random-result control.
- Override detail makes the stable target, automatic baseline, operation, typed value, scope, reason, and provenance visible.
- The standard file preview exposes IDs/counts/fingerprint while explicitly excluding private full text, notes, restricted entries, and action-note bodies.

## Prototype limitations

The prototype intentionally does not persist data, calculate rules, mutate HP/resources, generate a downloadable file, import records, or model every loading/error state. Those behaviors belong to service and production acceptance tests. It validates information order, state vocabulary, responsiveness, touch sizing, focus semantics, and the product gate only.
