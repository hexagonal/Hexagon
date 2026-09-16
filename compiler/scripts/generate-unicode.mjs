import { writeFile } from "node:fs/promises";

import lowercase from "@unicode/unicode-17.0.0/Binary_Property/Lowercase/regex.js";
import uppercase from "@unicode/unicode-17.0.0/Binary_Property/Uppercase/regex.js";
import idContinue from "@unicode/unicode-17.0.0/Binary_Property/ID_Continue/regex.js";
import idStart from "@unicode/unicode-17.0.0/Binary_Property/ID_Start/regex.js";
import titlecase from "@unicode/unicode-17.0.0/General_Category/Titlecase_Letter/regex.js";
import whiteSpace from "@unicode/unicode-17.0.0/Binary_Property/White_Space/regex.js";
import cased from "@unicode/unicode-17.0.0/Binary_Property/Cased/regex.js";
import caseIgnorable from "@unicode/unicode-17.0.0/Binary_Property/Case_Ignorable/regex.js";
import simpleLowercase from "@unicode/unicode-17.0.0/Simple_Case_Mapping/Lowercase/code-points.js";
import specialLowercase from "@unicode/unicode-17.0.0/Special_Casing/Lowercase/code-points.js";
import simpleUppercase from "@unicode/unicode-17.0.0/Simple_Case_Mapping/Uppercase/code-points.js";
import specialUppercase from "@unicode/unicode-17.0.0/Special_Casing/Uppercase/code-points.js";
import commonCaseFold from "@unicode/unicode-17.0.0/Case_Folding/C/code-points.js";
import fullCaseFold from "@unicode/unicode-17.0.0/Case_Folding/F/code-points.js";

const destination = new URL("../src/passes/lexer/unicode-17.ts", import.meta.url);
const tables = { idContinue, idStart, lowercase, uppercase, titlecase };
const lines = [
  "/**",
  " * Generated Unicode 17.0.0 identifier tables. Do not edit by hand.",
  " * Regenerate with `npm run generate:unicode`.",
  " */",
  "",
];

for (const [name, regex] of Object.entries(tables)) {
  lines.push(`export const ${name} = new RegExp(${JSON.stringify(regex.source)});`);
}
lines.push("");

await writeFile(destination, lines.join("\n"));

const textDestination = new URL("../src/passes/emitter/unicode-text-17.ts", import.meta.url);

const mappedString = (value) =>
  String.fromCodePoint(...(Array.isArray(value) ? value : [value]));
// Keep generated TypeScript ASCII-only. Besides making the tables reviewable,
// this avoids raw astral characters confusing source scanners whose offsets are
// UTF-16 code-unit positions.
const asciiJson = (value) => JSON.stringify(value).replace(
  /[^\x20-\x7E]/g,
  (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
);
const mergedMapping = (...maps) => {
  const merged = new Map();
  for (const map of maps) {
    for (const [source, target] of map) merged.set(source, mappedString(target));
  }
  return [...merged];
};

const textLines = [
  "/**",
  " * Generated Unicode 17.0.0 text-processing tables. Do not edit by hand.",
  " * Regenerate with `npm run generate:unicode`.",
  " */",
  "",
  `export const whiteSpacePattern = ${asciiJson(whiteSpace.source)};`,
  `export const casedPattern = ${asciiJson(cased.source)};`,
  `export const caseIgnorablePattern = ${asciiJson(caseIgnorable.source)};`,
  `export const lowercaseMapping = ${asciiJson(mergedMapping(simpleLowercase, specialLowercase))} as const;`,
  `export const uppercaseMapping = ${asciiJson(mergedMapping(simpleUppercase, specialUppercase))} as const;`,
  `export const caseFoldMapping = ${asciiJson(mergedMapping(commonCaseFold, fullCaseFold))} as const;`,
  "",
];

await writeFile(textDestination, textLines.join("\n"));
