/**
 * The house test (`spec/notes/canonical-formatting-and-naming.md` §5): house
 * text, which is the standard library, the Playground's tutorials, the Book's
 * samples and the spec's examples, meets five checks.
 *
 * - **Format document** at the house settings (H1, H2, H9) changes nothing.
 *   A text it changes is named by the first line it changes.
 * - **H9**: every construct is in its shape (Canonical Layout §12 item 6).
 *   Format document makes the half of H9 that spreads; the other half, a
 *   construct within its width limit written on one line, is made by hand, so
 *   this check names each construct in the wrong shape.
 * - **H6**: every `for` and `while` loop begins a line of its own. A loop has
 *   no value for H5 to place, so none follows an `=`, `:=`, `=>`, `then` or
 *   `else` on its line.
 * - **N6**: `fun` is written only for a knot (Functions §3.2). A function that
 *   is not recursive, by itself or with the members of its block, is a `let`.
 *   Whether it is recursive is the checker's own answer, read from the knots it
 *   typed (`knotlessFuns`), so each text is compiled.
 * - **H10**: a comment that ends a line has exactly one space before it, and
 *   the line, comment included, fits within 100; and a comment that ends a
 *   line is one line long. A comment that begins its line is not this check's.
 *
 * Format document cannot do the work of H9's second half, H6, N6 or H10: it
 * never joins lines, never changes a token and keeps a comment's gap as
 * written, so each has a check of its own.
 *
 * A sample is a fenced block that parses, read as a module of its own, with
 * `module A` above it where it has no header. In the Book that is each
 * `hexagon` block; in the spec, each `hexagon`, `hex` or untagged block. A
 * block with one line the compiler refuses does not parse, so the first four
 * checks pass it by; H10 asks only the lexer, which reads on past a token it
 * refuses, so it reads every block. The spec's chapters are read but for its decision records, which keep
 * history as it was written, and Canonical Layout and Lexer & Layout, whose
 * examples are the layouts those chapters change or refuse. Its notes, in
 * `spec/notes/`, are not chapters and are not read.
 *
 * `house.baseline.txt` holds what house text leaves as written, one finding to
 * a line, as `rule · place · …`: by file and by text, never by line number, so
 * that an edit above one does not move it. Each stands beneath a line
 * beginning `#` that says why it is left. A check fails on a finding the
 * baseline does not hold, and on an entry it holds that nothing now finds. The
 * baseline also fails while any entry stands beneath no reason, so it never
 * grows unseen.
 *
 * Run with `HOUSE_UPDATE=1` to write a check's entries afresh. An entry that
 * was held keeps its reason; a new one is written above every reason, and the
 * test fails until one is given.
 */

import { describe, expect, it } from "vitest";

import { knotlessFuns } from "../passes/checker/checker.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";
import { compileFiles } from "../support/test-project.js";
import { read, scan } from "./analysis.js";
import { formatDocument, type FormatOptions } from "./format.js";
import { constructs, wrongShapes } from "./widths.js";

// The compiler's own sources are host-neutral, so Node's modules are reached
// as `support/test-project.ts` reaches them.
const fsName = "node:fs";
const urlName = "node:url";
const { readdirSync, readFileSync, writeFileSync } = await import(/* @vite-ignore */ fsName) as {
  readonly readdirSync: (path: string) => string[];
  readonly readFileSync: (path: string, encoding: "utf8") => string;
  readonly writeFileSync: (path: string, data: string) => void;
};
const { fileURLToPath, pathToFileURL } = await import(/* @vite-ignore */ urlName) as {
  readonly fileURLToPath: (url: string) => string;
  readonly pathToFileURL: (path: string) => { readonly href: string };
};
const environment = (globalThis as { readonly process?: { readonly env: Record<string, string | undefined> } })
  .process?.env ?? {};

const here = fileURLToPath((import.meta as unknown as { readonly url: string }).url).replace(/[^/\\]*$/u, "");
const root = `${here}../../../`;
const baselineFile = `${here}house.baseline.txt`;

/** Maximum line length 100, Collapse extra spaces on, Apply width limits on (H1, H2, H9). */
const house: FormatOptions = { maximumLineLength: 100, collapseExtraSpaces: true, applyWidthLimits: true };

interface Text {
  /** Where it is: a file, or a tutorial. */
  readonly place: string;
  readonly text: string;
  /** The line of the file that the text's first line is. */
  readonly offset: number;
}

/** Texts read from Markdown, and how many fenced blocks did not parse. */
interface Samples {
  readonly samples: Text[];
  /** The blocks that do not parse, which only H10 reads, where they lex. */
  readonly fragments: Text[];
  readonly unread: number;
}

/** The standard library, by file. */
function library(): Text[] {
  return Object.entries(STDLIB_SOURCES).map(([name, text]) => ({
    place: `stdlib/${name.replaceAll(".", "/")}.hex`,
    text,
    offset: 0,
  }));
}

/** The Playground's tutorials, by file. */
async function tutorials(): Promise<Text[]> {
  const index = pathToFileURL(`${root}playground/src/examples/index.ts`).href;
  const { playgroundExamples } = await import(/* @vite-ignore */ index) as {
    readonly playgroundExamples: readonly { readonly id: string; readonly source: string }[];
  };
  return playgroundExamples.map(({ id, source }) => ({ place: `playground tutorial ${id}`, text: source, offset: 0 }));
}

/**
 * The fenced blocks of each Markdown file in `folder` whose tag is one of
 * `tags` and that parse. A block indented under a list item is read without
 * its fence's indentation.
 */
function samplesOf(folder: string, files: readonly string[], tags: ReadonlySet<string>): Samples {
  const samples: Text[] = [];
  const fragments: Text[] = [];
  let unread = 0;
  for (const file of files) {
    const lines = readFileSync(`${root}${folder}${file}`, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const opening = /^( *)```([\w-]*)\s*$/u.exec(lines[index]!);
      if (opening === null) continue;
      const indent = opening[1]!.length;
      const closing = new RegExp(`^ {0,${indent + 3}}\`\`\`\\s*$`, "u");
      let end = index + 1;
      while (end < lines.length && !closing.test(lines[end]!)) end += 1;
      if (tags.has(opening[2]!)) {
        const body = lines.slice(index + 1, end)
          .map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length)));
        const sample = body.join("\n") + "\n";
        const place = `${folder}${file}`;
        // The text's first line is the line after the fence, which is line `index + 2`.
        if (!read(sample).syntaxError) {
          samples.push({ place, text: sample, offset: index + 1 });
        } else if (!read(`module A\n${sample}`).syntaxError) {
          samples.push({ place, text: `module A\n${sample}`, offset: index });
        } else {
          unread += 1;
          fragments.push({ place, text: sample, offset: index + 1 });
        }
      }
      index = end;
    }
  }
  return { samples, fragments, unread };
}

/** The Book's samples that parse: each fenced `hexagon` block. */
function book(): Samples {
  const files = readdirSync(`${root}book/chapters/`).filter((name) => name.endsWith(".md")).sort();
  return samplesOf("book/chapters/", files, new Set(["hexagon"]));
}

/** The spec's examples that parse: each fenced `hexagon`, `hex` or untagged block of its chapters. */
function spec(): Samples {
  const skipped = new Set(["canonical-layout.md", "lexer-layout.md"]);
  const files = readdirSync(`${root}spec/`)
    .filter((name) => name.endsWith(".md") && !name.startsWith("decisions-") && !skipped.has(name))
    .sort();
  return samplesOf("spec/", files, new Set(["hexagon", "hex", ""]));
}

const bookSamples = book();
const specSamples = spec();

/** Every house text. */
async function houseText(): Promise<Text[]> {
  return [...library(), ...await tutorials(), ...bookSamples.samples, ...specSamples.samples];
}

/** A finding, as the baseline holds it and as a failure names it. */
interface Finding {
  readonly entry: string;
  readonly named: string;
}

/** The checks, as each entry of the baseline begins. */
type Rule = "Format document" | "H9" | "N6" | "H10";

function entryOf(rule: Rule, place: string, ...rest: readonly string[]): string {
  return [rule, place, ...rest].join(" · ");
}

/** An entry of the baseline, with the reason it stands beneath. */
interface Held {
  readonly entry: string;
  readonly reason: string | undefined;
}

function baseline(): Held[] {
  const held: Held[] = [];
  let reason: string | undefined;
  for (const line of readFileSync(baselineFile, "utf8").split("\n")) {
    if (line === "") reason = undefined;
    else if (line.startsWith("#")) reason = line;
    else held.push({ entry: line, reason });
  }
  return held;
}

const ruleOf = (entry: string): string => entry.split(" · ")[0]!;

/**
 * Writes `rule`'s entries afresh: each that was held keeps its reason, and the
 * rest are written above every reason. The other checks' groups keep their
 * order, and `rule`'s own groups come after them in the order found; groups
 * are parted by a blank line.
 */
function writeBaseline(rule: Rule, found: readonly string[]): void {
  const old = baseline();
  const reasons = new Map<string, (string | undefined)[]>();
  for (const { entry, reason } of old) {
    if (ruleOf(entry) === rule) reasons.set(entry, [...reasons.get(entry) ?? [], reason]);
  }
  const fresh: Held[] = found.map((entry) => ({ entry, reason: reasons.get(entry)?.shift() }));
  const kept = old.filter(({ entry }) => ruleOf(entry) !== rule);
  const order: (string | undefined)[] = [undefined];
  for (const { reason } of [...kept, ...fresh]) if (!order.includes(reason)) order.push(reason);
  const groups = order.flatMap((reason) => {
    const entries = [...kept, ...fresh].filter((held) => held.reason === reason).map(({ entry }) => entry);
    if (entries.length === 0) return [];
    return [[...reason === undefined ? [] : [reason], ...entries].join("\n")];
  });
  writeFileSync(baselineFile, groups.length === 0 ? "" : groups.join("\n\n") + "\n");
}

/**
 * Checks `found` against the baseline's entries for `rule`, after writing them
 * afresh where `HOUSE_UPDATE=1` asks. Each entry counts as often as it is
 * held: two identical findings in one file are two.
 */
function expectBaseline(rule: Rule, found: readonly Finding[], what: string): void {
  if (environment["HOUSE_UPDATE"] === "1") writeBaseline(rule, found.map(({ entry }) => entry));
  const remaining = new Map<string, number>();
  for (const { entry } of baseline()) {
    if (ruleOf(entry) === rule) remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
  }
  const unrecorded: string[] = [];
  for (const { entry, named } of found) {
    const left = remaining.get(entry) ?? 0;
    if (left > 0) remaining.set(entry, left - 1);
    else unrecorded.push(named);
  }
  const fixed = [...remaining].flatMap(([entry, count]) => Array.from({ length: count }, () => entry));
  expect(unrecorded, what).toEqual([]);
  expect(fixed, "baseline entries nothing finds now: remove them from house.baseline.txt").toEqual([]);
}

/** A comment that ends a line, as H10 reads it. */
interface TrailingComment {
  /** Its line in the text, from 0. */
  readonly line: number;
  /** The whitespace between the code and the comment. */
  readonly gap: string;
  /** Its line, code and comment, to the comment's first line end. */
  readonly whole: string;
  /** Whether the comment runs on past its first line. */
  readonly spans: boolean;
}

/**
 * Each comment that ends a line: a token before it on its line, and nothing
 * after it on its last line. Only the lexer is asked, so a text that does not
 * parse can be read too.
 */
function trailingComments(text: string): TrailingComment[] {
  const { tokens, comments } = scan(text).lexed;
  const found: TrailingComment[] = [];
  const lineEnd = (offset: number): number => text.indexOf("\n", offset) === -1 ? text.length : text.indexOf("\n", offset);
  // Comments with only whitespace between them on a line are one run, read
  // as one comment from its first comment's start to its last one's end.
  const joined = (left: (typeof comments)[number], right: (typeof comments)[number]): boolean =>
    left.span.end.line === right.span.start.line &&
    text.slice(left.span.end.offset, right.span.start.offset).trim() === "";
  for (let first = 0; first < comments.length; first += 1) {
    let last = first;
    while (last + 1 < comments.length && joined(comments[last]!, comments[last + 1]!)) last += 1;
    const start = comments[first]!.span.start;
    const end = comments[last]!.span.end;
    const code = tokens.some(({ span: token }) => token.start.line === start.line && token.end.offset <= start.offset);
    const ends = text.slice(end.offset, lineEnd(end.offset)).trim() === "";
    if (code && ends) {
      const lineStart = text.lastIndexOf("\n", start.offset - 1) + 1;
      found.push({
        line: start.line,
        gap: /\s*$/u.exec(text.slice(lineStart, start.offset))![0],
        whole: text.slice(lineStart, lineEnd(start.offset)).replace(/\r$/u, ""),
        spans: end.line !== start.line,
      });
    }
    first = last;
  }
  return found;
}

describe("The house test", () => {
  it("reads the samples that parse, and as many fragments as it did", () => {
    // Fragments no module can hold: a sentence's worth of syntax, a program
    // shown being refused, or another language's text in an untagged fence.
    // The counts are exact, so a sample that stops parsing cannot hide behind
    // one that starts.
    expect(bookSamples.unread).toBe(32);
    expect(specSamples.unread).toBe(117);
  });

  it("reads as ending a line only a comment with code before it and nothing after (H10)", () => {
    const text = [
      "module A",
      "-- begins its line",
      "let a = 1 -- one space",
      "let b = 2   -- three spaces",
      "let c = {- inside -} 3",
      "{- a -} -- after a comment, not code",
      "let d = 4 {- runs",
      "   on -}",
      "let e = 5 -- before a carriage return\r",
      "let f = 6  {- a -} -- b",
      "let g = 7 {- runs",
      "   on -}  -- more",
      "",
    ].join("\n");
    expect(trailingComments(text)).toEqual([
      { line: 2, gap: " ", whole: "let a = 1 -- one space", spans: false },
      { line: 3, gap: "   ", whole: "let b = 2   -- three spaces", spans: false },
      { line: 6, gap: " ", whole: "let d = 4 {- runs", spans: true },
      { line: 8, gap: " ", whole: "let e = 5 -- before a carriage return", spans: false },
      { line: 9, gap: "  ", whole: "let f = 6  {- a -} -- b", spans: false },
      { line: 10, gap: " ", whole: "let g = 7 {- runs", spans: true },
    ]);
  });

  it("gives every baseline entry a reason and a check", () => {
    expect(baseline().filter(({ reason }) => reason === undefined).map(({ entry }) => entry), "entries with no reason")
      .toEqual([]);
    const rules: readonly string[] = ["Format document", "H9", "N6", "H10"];
    expect(baseline().filter(({ entry }) => !rules.includes(ruleOf(entry))).map(({ entry }) => entry), "entries of no check")
      .toEqual([]);
  });

  it("leaves house text as it is at the house settings (Format document)", async () => {
    const found: Finding[] = [];
    for (const { place, text, offset } of await houseText()) {
      const result = formatDocument(text, house);
      if (result.kind !== "Formatted") {
        found.push({
          entry: entryOf("Format document", place, result.kind),
          named: `${place}:${offset + 1} is refused: ${result.kind === "Refused" ? result.message : "a syntax error"}`,
        });
        continue;
      }
      if (result.text === text) continue;
      const before = text.split("\n");
      const after = result.text.split("\n");
      let line = 0;
      while (before[line] === after[line]) line += 1;
      found.push({
        entry: entryOf("Format document", place, (before[line] ?? "").trim() || "(a blank line)"),
        named: `${place}:${line + 1 + offset} changes: ${JSON.stringify(before[line])} => ${JSON.stringify(after[line])}`,
      });
    }
    expectBaseline("Format document", found, "texts Format document changes");
  });

  it("holds every construct in its shape (H9)", async () => {
    const found: Finding[] = [];
    for (const { place, text, offset } of await houseText()) {
      for (const shape of wrongShapes(text)) {
        found.push({
          entry: entryOf("H9", place, shape.should, shape.kind, shape.text),
          named: `${place}:${shape.line + offset} ${shape.kind} should be ${shape.should}, ` +
            `${shape.width} wide (limit ${shape.limit ?? "none"}): ${shape.text}`,
        });
      }
    }
    expectBaseline("H9", found, "constructs in the wrong shape");
  });

  it("begins every loop on a line of its own (H6)", async () => {
    const midLine: string[] = [];
    for (const { place, text, offset } of await houseText()) {
      const reading = read(text);
      const tokens = reading.lexed.tokens;
      for (const { kind, first } of constructs(reading)) {
        if (kind !== "loop" || first === 0) continue;
        const line = tokens[first]!.span.start.line;
        if (tokens[first - 1]!.span.start.line === line) midLine.push(`${place}:${line + 1 + offset}`);
      }
    }
    expect(midLine, "loops that do not begin their line").toEqual([]);
  });

  it("writes `fun` only for a knot (N6)", async () => {
    const found: Finding[] = [];
    const record = (place: string, offset: number, module: Parameters<typeof knotlessFuns>[0]): void => {
      for (const { name, span } of knotlessFuns(module)) {
        found.push({
          entry: entryOf("N6", place, name),
          named: `${place}:${span.start.line + 1 + offset} \`${name}\` is in no knot, so it is a \`let\``,
        });
      }
    };
    const isLibrary = (path: string | undefined): boolean => path?.startsWith("/Hex/") ?? false;

    // Every module of the standard library is checked in any program.
    const library = compileFiles([["/main.hex", "module Main\n"]]).typedModules.filter(({ modulePath }) =>
      isLibrary(modulePath)
    );
    expect(library).toHaveLength(Object.keys(STDLIB_SOURCES).length);
    for (const module of library) record(`stdlib${module.modulePath!.slice("/Hex".length)}`, 0, module);

    const samples = [
      ...await tutorials(),
      ...[...bookSamples.samples, ...specSamples.samples].filter(({ text }) => /\bfun\b/u.test(text)),
    ];
    for (const { place, text, offset } of samples) {
      for (const module of compileFiles([["/main.hex", text]]).typedModules) {
        if (!isLibrary(module.modulePath)) record(place, offset, module);
      }
    }
    expectBaseline("N6", found, "`fun`s in no knot");
  });

  it("puts one space before a comment that ends a line, and keeps its line within 100 (H10)", async () => {
    const found: Finding[] = [];
    // A fragment that does not parse is read too, even where the lexer
    // refuses a token in it: its comments are comments, though its code is
    // not a module. Another language's text in an untagged fence would be
    // read as Hexagon, so such a fence is tagged.
    const fragments = [...bookSamples.fragments, ...specSamples.fragments];
    for (const { place, text, offset } of [...await houseText(), ...fragments]) {
      for (const { line, gap, whole, spans } of trailingComments(text)) {
        const width = [...whole].length;
        if (gap !== " ") {
          found.push({
            entry: entryOf("H10", place, "one space", whole.trim()),
            named: `${place}:${line + 1 + offset} has ${JSON.stringify(gap)} before its comment: ${whole.trim()}`,
          });
        }
        if (spans) {
          found.push({
            entry: entryOf("H10", place, "one line", whole.trim()),
            named: `${place}:${line + 1 + offset} has a comment that ends it over more than one line: ${whole.trim()}`,
          });
        }
        if (width > 100) {
          found.push({
            entry: entryOf("H10", place, "within 100", whole.trim()),
            named: `${place}:${line + 1 + offset} is ${width} wide with its comment: ${whole.trim()}`,
          });
        }
      }
    }
    expectBaseline("H10", found, "lines whose trailing comment is not in house style");
  });
});
