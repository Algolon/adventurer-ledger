import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  brandDirectory = path.join(root, "public", "brand"),
  iconDirectory = path.join(root, "public", "icons"),
  verificationDirectory = path.join(root, "docs", "brand"),
  colors = {
    ink: "#0F1D29",
    parchment: "#F6EBD6",
    gold: "#C79A45",
    darkBackground: "#09141E",
    lightBackground: "#FBF5E8",
  },
  geometry = ({ rune, ring, detail }) => `
    <path d="M96 31A101 101 0 0 0 96 225" fill="none" stroke="${ring}" stroke-width="14" stroke-linecap="butt"/>
    <path d="M160 31A101 101 0 0 1 160 225" fill="none" stroke="${ring}" stroke-width="14" stroke-linecap="butt"/>
    <path d="M82 55h54l45 42-42 40 39 54-30 18-40-58v51l-26-12V55Zm26 29v46l45-33-45-13Z" fill="${rune}" fill-rule="evenodd"/>
    <path d="m128 5 13 24-13 24-13-24 13-24Zm0 198 13 24-13 24-13-24 13-24Z" fill="${ring}"/>
    <path d="m101 112 10 19-10 19-10-19 10-19Z" fill="${detail}"/>`,
  title = (name) => `<title>${name}</title>`,
  svg = ({ name, rune, ring, detail, background }) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title">${title(name)}${background ? `<path fill="${background}" d="M0 0h256v256H0z"/>` : ""}${geometry({ rune, ring, detail })}</svg>`,
  assets = {
    "runefolio-mark.svg": svg({
      name: "Runefolio mark",
      rune: colors.ink,
      ring: colors.gold,
      detail: colors.gold,
    }),
    "runefolio-mark-inverse.svg": svg({
      name: "Runefolio inverse mark",
      rune: colors.parchment,
      ring: colors.gold,
      detail: colors.ink,
    }),
    "runefolio-mark-monochrome.svg": svg({
      name: "Runefolio monochrome mark",
      rune: "currentColor",
      ring: "currentColor",
      detail: "currentColor",
    }),
    "runefolio-favicon.svg": svg({
      name: "Runefolio favicon",
      rune: colors.parchment,
      ring: colors.gold,
      detail: colors.ink,
      background: colors.ink,
    }),
  };

await Promise.all([
  fs.mkdir(brandDirectory, { recursive: true }),
  fs.mkdir(iconDirectory, { recursive: true }),
  fs.mkdir(verificationDirectory, { recursive: true }),
]);
await Promise.all(
  Object.entries(assets).map(([name, source]) =>
    fs.writeFile(path.join(brandDirectory, name), `${source}\n`),
  ),
);

const appIcon = (size, maskable = false) => {
    const scale = maskable ? 0.68 : 0.78,
      offset = (256 - 256 * scale) / 2;
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256"><path fill="${colors.ink}" d="M0 0h256v256H0z"/><g transform="translate(${offset} ${offset}) scale(${scale})">${geometry({ rune: colors.parchment, ring: colors.gold, detail: colors.ink })}</g></svg>`,
    );
  },
  renderPng = async (name, size, maskable = false) =>
    sharp(appIcon(size, maskable)).png().toFile(path.join(iconDirectory, name)),
  pngFiles = [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["maskable-192.png", 192, true],
    ["maskable-512.png", 512, true],
    ["apple-touch-icon.png", 180, false],
    ["favicon-16.png", 16, false],
    ["favicon-32.png", 32, false],
  ];
await Promise.all(pngFiles.map(([name, size, maskable]) => renderPng(name, size, maskable)));

const favicon32 = await fs.readFile(path.join(iconDirectory, "favicon-32.png")),
  icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt8(32, 6);
icoHeader.writeUInt8(32, 7);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(favicon32.length, 14);
icoHeader.writeUInt32LE(22, 18);
await fs.writeFile(path.join(root, "public", "favicon.ico"), Buffer.concat([icoHeader, favicon32]));

const dataUri = (source) => `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`,
  fullColor = dataUri(assets["runefolio-mark.svg"]),
  inverse = dataUri(assets["runefolio-mark-inverse.svg"]),
  monochrome = dataUri(assets["runefolio-mark-monochrome.svg"]),
  icon = dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="${colors.ink}" d="M0 0h256v256H0z"/><g transform="translate(28.16 28.16) scale(.78)">${geometry({ rune: colors.parchment, ring: colors.gold, detail: colors.ink })}</g></svg>`,
  ),
  maskable = dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="${colors.ink}" d="M0 0h256v256H0z"/><g transform="translate(40.96 40.96) scale(.68)">${geometry({ rune: colors.parchment, ring: colors.gold, detail: colors.ink })}</g></svg>`,
  ),
  sizes = [16, 24, 32, 48, 64, 192, 512],
  sizeCells = sizes
    .map((size, index) => {
      const cellX = 80 + index * 230,
        displayed = Math.min(size, 150),
        imageX = cellX + (150 - displayed) / 2;
      return `<g><text x="${cellX + 75}" y="478" text-anchor="middle" class="label">${size} px</text><rect x="${cellX}" y="495" width="150" height="150" rx="12" fill="#fff" stroke="#D8C8AA"/><image href="${icon}" x="${imageX}" y="${495 + (150 - displayed) / 2}" width="${displayed}" height="${displayed}" image-rendering="auto"/><text x="${cellX + 75}" y="671" text-anchor="middle" class="note">${size > 150 ? "fit preview" : "1:1 pixels"}</text></g>`;
    })
    .join(""),
  comparison = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1350" viewBox="0 0 1800 1350"><style>.title{font:700 42px Georgia,serif;fill:${colors.ink}}.heading{font:700 23px system-ui,sans-serif;fill:${colors.ink};letter-spacing:.08em}.label{font:700 18px system-ui,sans-serif;fill:${colors.ink}}.note{font:15px system-ui,sans-serif;fill:#675F55}</style><path fill="${colors.lightBackground}" d="M0 0h1800v1350H0z"/><text x="80" y="76" class="title">Runefolio vector verification</text><text x="80" y="122" class="note">Canonical geometry • production render • ${colors.ink} / ${colors.parchment} / ${colors.gold}</text><text x="80" y="185" class="heading">FUNCTIONAL VARIANTS</text><g><rect x="80" y="215" width="340" height="190" rx="16" fill="${colors.parchment}"/><image href="${fullColor}" x="190" y="225" width="120" height="120"/><text x="250" y="380" text-anchor="middle" class="label">dark on light</text><rect x="450" y="215" width="340" height="190" rx="16" fill="${colors.darkBackground}"/><image href="${inverse}" x="560" y="225" width="120" height="120"/><text x="620" y="380" text-anchor="middle" fill="${colors.parchment}" class="label">light on dark</text><rect x="820" y="215" width="340" height="190" rx="16" fill="#fff"/><image href="${icon}" x="930" y="225" width="120" height="120"/><text x="990" y="380" text-anchor="middle" class="label">full-color app icon</text><rect x="1190" y="215" width="340" height="190" rx="16" fill="${colors.parchment}"/><g color="${colors.ink}"><image href="${monochrome}" x="1300" y="225" width="120" height="120"/></g><text x="1360" y="380" text-anchor="middle" class="label">monochrome</text></g><text x="80" y="445" class="heading">RASTER SIZES</text>${sizeCells}<text x="80" y="750" class="heading">MASKABLE ANDROID PREVIEWS</text><g><defs><clipPath id="circle"><circle cx="270" cy="935" r="160"/></clipPath><clipPath id="squircle"><path d="M660 775c-92 0-130 38-130 160s38 160 130 160 130-38 130-160-38-160-130-160Z"/></clipPath><clipPath id="rounded"><rect x="920" y="775" width="320" height="320" rx="72"/></clipPath></defs><image href="${maskable}" x="110" y="775" width="320" height="320" clip-path="url(#circle)"/><image href="${maskable}" x="500" y="775" width="320" height="320" clip-path="url(#squircle)"/><image href="${maskable}" x="920" y="775" width="320" height="320" clip-path="url(#rounded)"/><rect x="1300" y="775" width="320" height="320" fill="${colors.ink}"/><image href="${maskable}" x="1300" y="775" width="320" height="320"/><circle cx="1460" cy="935" r="128" fill="none" stroke="${colors.parchment}" stroke-width="3" stroke-dasharray="10 8" opacity=".7"/><text x="270" y="1134" text-anchor="middle" class="label">circle</text><text x="660" y="1134" text-anchor="middle" class="label">squircle</text><text x="1080" y="1134" text-anchor="middle" class="label">rounded square</text><text x="1460" y="1134" text-anchor="middle" class="label">safe-zone guide</text></g><rect x="80" y="1210" width="1640" height="78" rx="12" fill="#EFE2C9"/><text x="110" y="1245" class="label">Inspection:</text><text x="110" y="1272" class="note">R counter, stem diamond, ring openings, optical centering, and all three diamonds remain visible at production sizes.</text></svg>`;
const correctedComparison = comparison.replace(
  `fill="${colors.parchment}" class="label">light on dark`,
  `class="label" style="fill:${colors.parchment}">light on dark`,
);
await fs.writeFile(
  path.join(verificationDirectory, "runefolio-visual-verification.svg"),
  `${correctedComparison}\n`,
);
await sharp(Buffer.from(correctedComparison))
  .png()
  .toFile(path.join(verificationDirectory, "runefolio-visual-verification.png"));
process.stdout.write("Generated Runefolio SVG, PWA, favicon, and verification assets.\n");
