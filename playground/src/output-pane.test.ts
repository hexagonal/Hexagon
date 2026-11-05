import { describe, expect, test } from "vitest";

import { exitStatusNote, outputSegments } from "./output-pane";

describe("the output pane", () => {
  test("joins a stream's text across writes that don't end a line", () => {
    expect(outputSegments([
      { stream: "stdout", text: "partial " },
      { stream: "stdout", text: "then whole\n" },
      { stream: "stderr", text: "to stderr\n" },
      { stream: "stdout", text: "back\n" },
    ])).toEqual([
      { stream: "stdout", text: "partial then whole\n" },
      { stream: "stderr", text: "to stderr\n" },
      { stream: "stdout", text: "back\n" },
    ]);
  });

  test("starts a note on a line of its own", () => {
    expect(outputSegments([
      { stream: "stdout", text: "no newline" },
      { stream: "note", text: "exit status 3" },
    ])).toEqual([
      { stream: "stdout", text: "no newline" },
      { stream: "note", text: "\nexit status 3\n" },
    ]);
    expect(outputSegments([{ stream: "note", text: "Program completed." }]))
      .toEqual([{ stream: "note", text: "Program completed.\n" }]);
  });

  test("shows a status only when it isn't 0", () => {
    expect(exitStatusNote(0)).toBeUndefined();
    expect(exitStatusNote(141)).toEqual({ stream: "note", text: "exit status 141" });
  });
});
