import { describe, expect, test } from "vitest";

import { Bag, type Diagnostic } from "./diagnostics.js";
import { File, fileId } from "./source.js";

describe("Diagnostics.Bag", () => {
  test("returns diagnostics in stable source order", () => {
    const firstFile = new File(fileId(0), "first.hex", "abc");
    const secondFile = new File(fileId(1), "second.hex", "abc");
    const bag = new Bag();
    const later = error("later", firstFile.span(2, 3));
    const samePlaceFirst = error("same place first", firstFile.span(0, 1));
    const samePlaceSecond = error("same place second", firstFile.span(0, 1));
    const otherFile = error("other file", secondFile.span(0, 1));

    bag.add(otherFile);
    bag.add(later);
    bag.add(samePlaceFirst);
    bag.add(samePlaceSecond);

    expect(bag.toArray()).toEqual([
      samePlaceFirst,
      samePlaceSecond,
      later,
      otherFile,
    ]);
  });

  test("does not expose mutable bag storage", () => {
    const source = new File(fileId(0), "source.hex", "x");
    const bag = new Bag();
    bag.add(error("original", source.span(0, 1)));

    const copy = bag.toArray() as Diagnostic[];
    copy.length = 0;

    expect(bag.isEmpty).toBe(false);
    expect(bag.toArray()).toHaveLength(1);
  });
});

function error(message: string, primary: Diagnostic["primary"]): Diagnostic {
  return { severity: "error", message, primary };
}
