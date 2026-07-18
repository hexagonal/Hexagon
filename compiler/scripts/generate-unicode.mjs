import { writeFile } from "node:fs/promises";

import lowercase from "@unicode/unicode-17.0.0/Binary_Property/Lowercase/regex.js";
import uppercase from "@unicode/unicode-17.0.0/Binary_Property/Uppercase/regex.js";
import idContinue from "@unicode/unicode-17.0.0/Binary_Property/ID_Continue/regex.js";
import idStart from "@unicode/unicode-17.0.0/Binary_Property/ID_Start/regex.js";
import titlecase from "@unicode/unicode-17.0.0/General_Category/Titlecase_Letter/regex.js";

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
