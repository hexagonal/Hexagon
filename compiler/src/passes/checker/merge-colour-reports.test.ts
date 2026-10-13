/**
 * One report across both colours (Effects §1), as `mergeColourReports` makes
 * it from the world colour's reports and the fail colour's staged ones. Until
 * the fail colour has spellings of its own every report has a twin, so these
 * cases build the bags directly.
 */

import { describe, expect, it } from "vitest";
import * as Diagnostics from "../../support/diagnostics.js";
import * as Source from "../../support/source.js";
import { type ColourReportTag, mergeColourReports } from "./checker.js";

type Axis = "world" | "fail";

const span = (start: number): Source.Span => ({
  fileId: Source.fileId(0),
  start: { offset: start, line: 1, column: start + 1 },
  end: { offset: start + 1, line: 1, column: start + 2 },
});

/** A colour-worded report about `site`, made on `axis`, whose words name its colours and the run that made it. */
function colourReport(bag: Diagnostics.Bag, key: string, axis: Axis, at = 0): void {
  const render = (axes: readonly Axis[]): Diagnostics.Diagnostic => ({
    severity: "error",
    message: `${key}: ${axes.join(" and ")} (made on ${axis})`,
    primary: span(at),
  });
  const tag: ColourReportTag = { key, axis, render };
  bag.add(render([axis]), tag);
}

const messages = (bag: Diagnostics.Bag): string[] =>
  Array.from({ length: bag.count }, (_, index) => bag.at(index)!.message);

describe("one report across both colours", () => {
  it("joins a fail report to its world twin, in the world report's place, in the world run's words", () => {
    const reports = new Diagnostics.Bag();
    const staged = new Diagnostics.Bag();
    reports.add({ severity: "error", message: "before", primary: span(0) });
    colourReport(reports, "lie 1", "world");
    reports.add({ severity: "error", message: "after", primary: span(2) });
    colourReport(staged, "lie 1", "fail");
    mergeColourReports(reports, staged);
    expect(messages(reports)).toEqual(["before", "lie 1: world and fail (made on world)", "after"]);
    expect(staged.count).toBe(0);
  });

  it("joins twins of one key in the order the two runs made them", () => {
    const reports = new Diagnostics.Bag();
    const staged = new Diagnostics.Bag();
    colourReport(reports, "demand 5", "world", 1);
    colourReport(reports, "demand 5", "world", 2);
    colourReport(staged, "demand 5", "fail", 1);
    colourReport(staged, "demand 5", "fail", 2);
    mergeColourReports(reports, staged);
    expect(messages(reports)).toEqual([
      "demand 5: world and fail (made on world)",
      "demand 5: world and fail (made on world)",
    ]);
  });

  it("joins the first world report of a key where the fail colour made fewer", () => {
    const reports = new Diagnostics.Bag();
    const staged = new Diagnostics.Bag();
    colourReport(reports, "demand 5", "world", 1);
    colourReport(reports, "demand 5", "world", 2);
    colourReport(staged, "demand 5", "fail", 1);
    mergeColourReports(reports, staged);
    expect(reports.toArray().map(({ message, primary }) => `${primary.start.offset} ${message}`)).toEqual([
      "1 demand 5: world and fail (made on world)",
      "2 demand 5: world (made on world)",
    ]);
  });

  it("keeps a fail report with no twin of its key alone, in its own words", () => {
    const reports = new Diagnostics.Bag();
    const staged = new Diagnostics.Bag();
    colourReport(reports, "seat-more 3 run 0", "world");
    colourReport(staged, "seat-more 3 run 1", "fail");
    mergeColourReports(reports, staged);
    expect(messages(reports)).toEqual([
      "seat-more 3 run 0: world (made on world)",
      "seat-more 3 run 1: fail (made on fail)",
    ]);
  });

  it("drops a report whose words name no colour where the world colour made the same one, and keeps any other", () => {
    const reports = new Diagnostics.Bag();
    const staged = new Diagnostics.Bag();
    reports.add({ severity: "error", message: "`g`'s colour is tied to `a`'s here", primary: span(4) });
    staged.add({ severity: "error", message: "`g`'s colour is tied to `a`'s here", primary: span(4) });
    staged.add({ severity: "error", message: "`g`'s colour is tied to `a`'s here", primary: span(6) });
    mergeColourReports(reports, staged);
    expect(reports.toArray().map(({ primary }) => primary.start.offset)).toEqual([4, 6]);
  });
});
