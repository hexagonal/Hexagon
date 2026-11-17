/**
 * House text holds every construct in its shape (`spec/notes/canonical-formatting-and-naming.md`
 * H9; Canonical Layout §12 item 6): the standard library, the Playground's
 * tutorials and the Book's samples.
 *
 * Format document at the house settings makes the half of H9 that spreads;
 * the other half, a construct within its width limit written on one line, is
 * made by hand. The house pass has made it (#1602), and what is left in
 * `house-shapes.baseline.txt` is the Book's samples whose layout is what the
 * prose beside them teaches: a condition carried on to its `then` (chapter 5),
 * and the loops shown with their body beneath `do` before the chapter brings
 * in the body on the head's line (chapter 17). They are recorded one to a
 * line, by file, what the shape would be, kind and text, and not by line
 * number, so that an edit above one does not move it. The test fails on a
 * construct in the wrong shape that the baseline does not hold, and on one the
 * baseline holds that is now in its shape, so the baseline never grows unseen.
 *
 * Run with `HOUSE_SHAPES_UPDATE=1` to write the baseline afresh.
 */

import { describe, expect, it } from "vitest";

import { STDLIB_SOURCES } from "../stdlib-sources.js";
import { read } from "./analysis.js";
import { wrongShapes } from "./widths.js";

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
const baselineFile = `${here}house-shapes.baseline.txt`;

interface Text {
  /** Where it is: a file, or a tutorial. */
  readonly place: string;
  readonly text: string;
  /** The line of the file that the text's first line is. */
  readonly offset: number;
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
 * The Book's samples that parse: each fenced `hexagon` block, read as a
 * module of its own, with `module A` above it where it has no header.
 */
function book(): { readonly samples: Text[]; readonly unread: number } {
  const chapters = `${root}book/chapters/`;
  const samples: Text[] = [];
  let unread = 0;
  for (const file of readdirSync(chapters).filter((name) => name.endsWith(".md")).sort()) {
    const markdown = readFileSync(`${chapters}${file}`, "utf8");
    const fence = /^```hexagon\n([\s\S]*?)^```/gmu;
    for (let found = fence.exec(markdown); found !== null; found = fence.exec(markdown)) {
      const line = markdown.slice(0, found.index).split("\n").length;
      const place = `book/chapters/${file}`;
      const sample = found[1]!;
      if (!read(sample).syntaxError) {
        samples.push({ place, text: sample, offset: line });
      } else if (!read(`module A\n${sample}`).syntaxError) {
        samples.push({ place, text: `module A\n${sample}`, offset: line - 1 });
      } else {
        unread += 1;
      }
    }
  }
  return { samples, unread };
}

/** A construct in the wrong shape, as the baseline holds it. */
function entryOf(place: string, should: string, kind: string, text: string): string {
  return `${place} · ${should} · ${kind} · ${text}`;
}

describe("House text holds every construct in its shape (H9)", () => {
  it("names no construct in the wrong shape beyond the recorded baseline, and the baseline holds none in its shape", async () => {
    const { samples, unread } = book();
    // The Book's samples that are fragments no module can hold: a sentence's
    // worth of syntax, or a program shown being refused.
    expect(unread).toBeLessThanOrEqual(32);
    const texts = [...library(), ...await tutorials(), ...samples];
    const found: { readonly entry: string; readonly named: string }[] = [];
    for (const { place, text, offset } of texts) {
      for (const shape of wrongShapes(text)) {
        found.push({
          entry: entryOf(place, shape.should, shape.kind, shape.text),
          named: `${place}:${shape.line + offset} ${shape.kind} should be ${shape.should}, ` +
            `${shape.width} wide (limit ${shape.limit ?? "none"}): ${shape.text}`,
        });
      }
    }
    const current = found.map(({ entry }) => entry);
    if (environment["HOUSE_SHAPES_UPDATE"] === "1") {
      writeFileSync(baselineFile, current.length === 0 ? "" : current.join("\n") + "\n");
    }
    const baseline = readFileSync(baselineFile, "utf8").split("\n").filter((line) => line !== "");

    // Each entry counts as often as it is held: two identical constructs in one file are two.
    const remaining = new Map<string, number>();
    for (const entry of baseline) remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
    const unrecorded: string[] = [];
    for (const { entry, named } of found) {
      const left = remaining.get(entry) ?? 0;
      if (left > 0) remaining.set(entry, left - 1);
      else unrecorded.push(named);
    }
    const fixed = [...remaining].flatMap(([entry, count]) => Array.from({ length: count }, () => entry));
    expect(unrecorded, "constructs in the wrong shape").toEqual([]);
    expect(fixed, "baseline entries now in their shape: remove them from house-shapes.baseline.txt").toEqual([]);
  });
});
