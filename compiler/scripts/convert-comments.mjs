/**
 * Respells comments in Hexagon source from the old spellings to the current
 * ones (spec/comments.md §14, issue #1538): `//` becomes `--`, `(* *)` becomes
 * `{- -}`, and `(** *)` becomes `{-- -}`.
 *
 * The compiler's own lexer does the work. It refuses each old spelling with a
 * fix that rewrites the delimiters it found (Comments §3.1), so this script
 * lexes each file, applies those fixes and nothing else, and then lexes the
 * result again to check it. It stops without writing a file when:
 *
 * - the old text already holds a `--`, `{-` or `-}` that would read differently
 *   once the new forms exist (a double minus written together, say), or holds
 *   new comments beside old ones;
 * - a refusal carries no fix, because the comment is unterminated or its body
 *   holds `{-` or `-}` text that would change its extent once it nests;
 * - the result does not lex cleanly, or does not hold the same number of
 *   comments and documentation comments as the original held.
 *
 * A file with no old spelling left is taken as converted and passed over, so a
 * file that never had an old comment is not checked for a double minus written
 * together (`x --1`): the check above runs only beside an old spelling.
 *
 * Run it after `npm run build`, from `compiler/`:
 *
 *     node scripts/convert-comments.mjs [--check] [--markdown] [path...]
 *
 * With no paths it converts every `.hex` file under `stdlib/`. `--markdown`
 * converts the ```hexagon fenced blocks of Markdown files instead. `--check`
 * writes nothing and exits non-zero if any file would change. It is idempotent:
 * a converted file has nothing left to convert.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { lex, Source } = await import("../dist/index.js");

const OLD_SPELLING = [
  /^JavaScript line comment syntax/u,
  /^JavaScript block comment syntax/u,
  /^OCaml block comment syntax/u,
];

/** Converts one Hexagon text; returns `{ text }` or `{ problems }`. */
export function convert(text, name = "source.hex") {
  const before = lex(new Source.File(Source.fileId(0), name, text));
  const problems = [];
  const edits = [];
  const at = (span) => `${name}:${span.start.line + 1}:${span.start.column + 1}`;

  // A text with no old spelling is converted already, or never had a comment.
  if (!before.diagnostics.some(({ message }) => OLD_SPELLING.some((pattern) => pattern.test(message)))) {
    return { text };
  }

  // The old lexer read none of these as comments, so in a text still holding
  // the old spellings any the new one finds was code, or a comment already
  // converted by hand beside unconverted ones: either way a person decides.
  for (const comment of before.comments) {
    problems.push(`${at(comment.span)}: already reads as a comment under the new spelling: ${JSON.stringify(comment.text.slice(0, 40))}`);
  }
  for (const diagnostic of before.diagnostics) {
    if (OLD_SPELLING.some((pattern) => pattern.test(diagnostic.message))) {
      const fix = diagnostic.fixes?.[0];
      if (fix === undefined) {
        problems.push(`${at(diagnostic.primary)}: no automatic rewrite: ${diagnostic.message}`);
        continue;
      }
      edits.push(...fix.edits);
    } else {
      problems.push(`${at(diagnostic.primary)}: ${diagnostic.message}`);
    }
  }
  if (problems.length > 0) return { problems };
  if (edits.length === 0) return { text };

  edits.sort((left, right) => right.span.start.offset - left.span.start.offset);
  let converted = text;
  for (const { span, replacement } of edits) {
    converted = converted.slice(0, span.start.offset) + replacement + converted.slice(span.end.offset);
  }

  const after = lex(new Source.File(Source.fileId(0), name, converted));
  for (const diagnostic of after.diagnostics) {
    problems.push(`${at(diagnostic.primary)} (converted): ${diagnostic.message}`);
  }
  const lines = edits.filter(({ replacement }) => /^-+$/u.test(replacement) && replacement.length >= 2).length;
  const blocks = edits.filter(({ replacement }) => replacement.startsWith("{-")).length;
  const docs = edits.filter(({ replacement }) => replacement === "{--").length;
  // Nested openers become nested openers, not comments of their own; count the
  // outermost comments the result records against the old comments' openers.
  const recordedLines = after.comments.filter(({ kind }) => kind === "Line").length;
  const recordedDocs = after.comments.filter(({ documentation }) => documentation).length;
  if (recordedLines !== lines) {
    problems.push(`${name}: ${lines} line comments converted, ${recordedLines} read back`);
  }
  if (recordedDocs !== docs) {
    problems.push(`${name}: ${docs} documentation comments converted, ${recordedDocs} read back`);
  }
  if (after.comments.length > lines + blocks) {
    problems.push(`${name}: more comments read back than were converted`);
  }
  return problems.length > 0 ? { problems } : { text: converted };
}

/** Converts the ```hexagon blocks of a Markdown text. */
function convertMarkdown(text, name) {
  const problems = [];
  const converted = text.replace(
    /^(```hexagon[^\n]*\n)([\s\S]*?)(^```)/gmu,
    (whole, open, body, close, offset) => {
      const line = text.slice(0, offset).split("\n").length;
      const result = convert(body, `${name} (block at line ${line})`);
      if (result.problems !== undefined) {
        problems.push(...result.problems);
        return whole;
      }
      return open + result.text + close;
    },
  );
  return problems.length > 0 ? { problems, text: converted } : { text: converted };
}

async function hexFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await hexFiles(full));
    else if (entry.name.endsWith(".hex")) found.push(full);
  }
  return found.sort();
}

async function main(argv) {
  const check = argv.includes("--check");
  const markdown = argv.includes("--markdown");
  const named = argv.filter((argument) => !argument.startsWith("--"));
  const stdlib = fileURLToPath(new URL("../../stdlib/", import.meta.url));
  const files = named.length > 0 ? named : await hexFiles(stdlib);

  let failed = false;
  let changed = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const result = markdown ? convertMarkdown(text, file) : convert(text, file);
    if (result.problems !== undefined) {
      failed = true;
      for (const problem of result.problems) console.error(problem);
      if (markdown && result.text !== text && !check) {
        // The blocks that converted cleanly are kept; the others are reported.
        await writeFile(file, result.text);
        changed += 1;
      }
      continue;
    }
    if (result.text === text) continue;
    changed += 1;
    if (check) console.error(`${file}: would change`);
    else await writeFile(file, result.text);
  }
  console.log(`${check ? "would change" : "changed"} ${changed} of ${files.length} files`);
  if (failed || (check && changed > 0)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
