// Regenerates the engine's Unicode tables (`spec/regex.md` §6.1, §7) — the data
// behind the `regexPropertyRanges` and `regexFoldOrbit` door keys — from the
// `@unicode/unicode-17.0.0` package, with General_Category's short names read
// from the PropertyValueAliases.txt that `generate-regex-names.mjs` reads too,
// so that the parser's names and the engine's ranges move together.
//
// Stored: the thirty leaf General_Category values, every Script and
// Script_Extensions value, and the six binary properties UTS #18 RL1.2 names,
// each as sorted inclusive ranges with U+D800–U+DFFF carved out (§7). The
// groupings (`L`, `LC`, …), `Any`, `ASCII`, `Assigned` and `Word` are unions and
// complements of these, built by the helper on first use rather than stored.
// The simple case foldings are CaseFolding.txt's statuses C and S (§3.4).
//
// Each range list is written as base-36 deltas — every number less the one
// before it — joined by commas, which keeps the emitted helper small.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const UNICODE = "@unicode/unicode-17.0.0";
const PACKAGE = new URL(`../node_modules/${UNICODE}/`, import.meta.url);
const ALIASES = new URL("./ucd-17.0.0/PropertyValueAliases.txt", import.meta.url);
const DESTINATION = new URL("../src/passes/emitter/unicode-regex-17.ts", import.meta.url);

const BINARY = [
  "Alphabetic",
  "Uppercase",
  "Lowercase",
  "White_Space",
  "Noncharacter_Code_Point",
  "Default_Ignorable_Code_Point",
];

const isSurrogate = (point) => point >= 0xD800 && point <= 0xDFFF;

function rangesOf(points) {
  const ranges = [];
  for (const point of [...points].sort((left, right) => left - right)) {
    if (isSurrogate(point)) continue;
    const last = ranges.at(-1);
    if (last !== undefined && last[1] + 1 === point) last[1] = point;
    else ranges.push([point, point]);
  }
  return ranges;
}

function encoded(ranges) {
  let previous = 0;
  return ranges.flat().map((value) => {
    const delta = value - previous;
    previous = value;
    return delta.toString(36);
  }).join(",");
}

const points = (directory) => require(`${UNICODE}/${directory}/code-points.js`);

async function values(family) {
  const entries = await readdir(new URL(`${family}/`, PACKAGE), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
}

// General_Category's long names, as the package spells its directories, to the
// short names the parser's tree carries (§5).
const shortName = new Map();
for (const line of (await readFile(ALIASES, "utf8")).split("\n")) {
  const fields = line.replace(/#.*/u, "").split(";").map((field) => field.trim());
  if (fields[0] === "gc") shortName.set(fields[2], fields[1]);
}

const table = {};
for (const long of await values("General_Category")) {
  const short = shortName.get(long);
  if (short === undefined) throw new Error(`no short name for General_Category ${long}`);
  if (short.length === 2 && short !== "LC") table[`GeneralCategory:${short}`] = encoded(rangesOf(points(`General_Category/${long}`)));
}
for (const name of await values("Script")) {
  table[`Script:${name}`] = encoded(rangesOf(points(`Script/${name}`)));
}
for (const name of await values("Script_Extensions")) {
  table[`ScriptExtensions:${name}`] = encoded(rangesOf(points(`Script_Extensions/${name}`)));
}
for (const name of BINARY) {
  table[`Binary:${name}`] = encoded(rangesOf(points(`Binary_Property/${name}`)));
}
if (Object.keys(table).filter((key) => key.startsWith("GeneralCategory:")).length !== 30) {
  throw new Error("expected the thirty leaf General_Category values");
}

const folds = [
  ...require(`${UNICODE}/Case_Folding/C/code-points.js`),
  ...require(`${UNICODE}/Case_Folding/S/code-points.js`),
].sort(([left], [right]) => left - right);
let previous = 0;
const foldText = folds.flat().map((value) => {
  const delta = value - previous;
  previous = value;
  return delta.toString(36);
}).join(",");

const lines = [
  "/**",
  " * Generated Unicode 17.0.0 tables for the regular-expression engine. Do not",
  " * edit by hand. Regenerate with `npm run generate:regex-tables`.",
  " */",
  "",
  "/** Each property's ranges, keyed `Kind:Value`, as base-36 deltas. */",
  `export const regexPropertyTable: Readonly<Record<string, string>> = ${JSON.stringify(table, null, 2)};`,
  "",
  "/** Simple case folding (statuses C and S) as `point, fold` pairs, base-36 deltas. */",
  `export const regexSimpleFolds = ${JSON.stringify(foldText)};`,
  "",
];
await writeFile(DESTINATION, lines.join("\n"));
console.log(`wrote ${Object.keys(table).length} property tables and ${folds.length} simple folds`);
