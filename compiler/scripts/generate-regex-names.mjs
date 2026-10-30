// Regenerates the admitted property names in `stdlib/Regex/Syntax.hex`
// (`spec/regex.md` §2.4, §5) from Unicode's PropertyAliases.txt and
// PropertyValueAliases.txt, kept beside this script so that a regeneration needs
// no network. A Unicode update replaces both files with the engine's range
// tables, so that the names and the ranges move together.
//
// Admitted, and nothing else: every alias of the six binary properties UTS #18
// RL1.2 names, and the second and third fields (short and long name) of every
// General_Category and Script value. A later field — `digit`, `Combining_Mark`,
// `Qaai` — is not admitted.
import { readFile, writeFile } from "node:fs/promises";

const UNICODE = "17.0.0";
const DATA = new URL(`./ucd-${UNICODE}/`, import.meta.url);
const SYNTAX = new URL("../../stdlib/Regex/Syntax.hex", import.meta.url);
const BEGIN = "// BEGIN GENERATED NAMES\n";
const END = "// END GENERATED NAMES\n";

const BINARY = [
  "Alphabetic",
  "Uppercase",
  "Lowercase",
  "White_Space",
  "Noncharacter_Code_Point",
  "Default_Ignorable_Code_Point",
];

async function rows(file) {
  const text = await readFile(new URL(file, DATA), "utf8");
  return text.split("\n")
    .map((line) => line.replace(/#.*/u, "").trim())
    .filter((line) => line !== "")
    .map((line) => line.split(";").map((field) => field.trim()));
}

function binaryNames(propertyRows) {
  const pairs = [];
  for (const long of BINARY) {
    const row = propertyRows.find((fields) => fields[1] === long);
    if (row === undefined) throw new Error(`PropertyAliases.txt has no ${long}`);
    for (const alias of row) pairs.push([alias, long]);
  }
  return pairs;
}

function valueNames(valueRows, property, canonical) {
  const pairs = [];
  for (const fields of valueRows.filter((row) => row[0] === property)) {
    const target = fields[canonical];
    for (const alias of new Set([fields[1], fields[2]])) pairs.push([alias, target]);
  }
  if (pairs.length === 0) throw new Error(`PropertyValueAliases.txt has no ${property} values`);
  return pairs;
}

function table(name, pairs) {
  const seen = new Set();
  for (const [alias] of pairs) {
    if (seen.has(alias)) throw new Error(`${name}: ${alias} appears twice`);
    seen.add(alias);
  }
  const entries = pairs.map(([alias, target]) => `(${JSON.stringify(alias)}, ${JSON.stringify(target)})`);
  const lines = [];
  let line = "   ";
  for (const entry of entries) {
    if (line.length + entry.length + 2 > 100) {
      lines.push(line.trimEnd());
      line = "   ";
    }
    line += ` ${entry},`;
  }
  lines.push(line.trimEnd());
  return `let ${name}: Map(String, String) = Map.fromVector([\n${lines.join("\n")}\n])\n`;
}

const propertyRows = await rows("PropertyAliases.txt");
const valueRows = await rows("PropertyValueAliases.txt");
const generalCategory = valueNames(valueRows, "gc", 1);
const script = valueNames(valueRows, "sc", 2);
const binary = binaryNames(propertyRows);

// A bare name is looked up in one order (§2.4), and the order decides nothing
// only while the name spaces are disjoint; a Unicode update that broke that
// would need a ruling, not a regeneration.
const spaces = [generalCategory, script, binary, [["Any"], ["ASCII"], ["Assigned"]]];
const owner = new Map();
spaces.forEach((pairs, space) => {
  for (const [alias] of pairs) {
    if (owner.has(alias) && owner.get(alias) !== space) throw new Error(`${alias} is in two name spaces`);
    owner.set(alias, space);
  }
});

const generated = [
  table("generalCategoryNames", generalCategory),
  table("scriptNames", script),
  table("binaryNames", binary),
].join("\n");

const source = await readFile(SYNTAX, "utf8");
const begin = source.indexOf(BEGIN);
const end = source.indexOf(END);
if (begin < 0 || end < begin) throw new Error("Syntax.hex has no generated-names markers");
await writeFile(SYNTAX, source.slice(0, begin + BEGIN.length) + generated + source.slice(end));
console.log(`wrote the Unicode ${UNICODE} property names into stdlib/Regex/Syntax.hex`);
