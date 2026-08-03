# M2.1 low-fidelity prototype

This dependency-free prototype validates the mobile task order and the settled product decisions. It is documentation, not a production route, and is not imported by the Next.js application or included intentionally in the PWA shell.

Measured results are recorded in [FINDINGS.md](FINDINGS.md); product decisions remain in [../M2_DECISIONS.md](../M2_DECISIONS.md).

## Run

Serve the repository root with any static server and open:

```text
/docs/product/prototype/index.html
```

The prototype has no build step, network request, external asset, package, or protected rules text.

## Covered states

- empty Character Library and New character entry;
- nine-step builder with Guided/Flexible presentation switch;
- representative long Class and Origin choices;
- incomplete warning and Review;
- Play home with HP, AC, initiative, expression-only attack, and limited resource;
- typed `add` override detail;
- standard file-transfer preview and exclusions.

## Validation contract

Check 360×800 first, then 390, 412, 768, 1024, and 1440 CSS px. At each width:

- document scroll width does not exceed viewport width;
- controls have at least 44×44 CSS px targets;
- long labels wrap without clipping;
- native Tab/Shift+Tab reaches every enabled control in order;
- Enter/Space activates buttons, radios, checkboxes, and step disclosure;
- Escape closes the character menu and restores focus;
- switching Guided/Flexible preserves selected Class and Origin values;
- the compact navigation rail appears only when effective CSS width permits it.

The script exposes no production API and persists nothing. Reloading intentionally resets the prototype.
