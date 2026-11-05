import { describe, expect, test } from "vitest";

import { readSharedInput, readSharedSource, shareUrl } from "./sharing";

describe("shareable source URLs", () => {
  test("round-trips multiline Unicode source through the fragment", () => {
    const source = 'let greeting = "Hello, λ!"\nDebug.log(greeting)';
    const shared = shareUrl(new URL("https://example.test/Hexagon/?theme=dark"), source);

    expect(shared.search).toBe("?theme=dark");
    expect(readSharedSource(shared)).toBe(source);
  });

  test("leaves ordinary URLs without shared source alone", () => {
    expect(readSharedSource(new URL("https://example.test/Hexagon/"))).toBeUndefined();
    expect(readSharedInput(new URL("https://example.test/Hexagon/"))).toBeUndefined();
  });

  test("carries the input box's text beside the source, when there is any", () => {
    const input = "1 2 3\nλ & x=y\n";
    const shared = shareUrl(new URL("https://example.test/Hexagon/"), "let x = 1", input);

    expect(readSharedSource(shared)).toBe("let x = 1");
    expect(readSharedInput(shared)).toBe(input);
  });

  test("shares an empty box as no input at all", () => {
    const shared = shareUrl(new URL("https://example.test/Hexagon/"), "let x = 1", "");

    expect(shared.hash).toBe("#code=let+x+%3D+1");
    expect(readSharedInput(shared)).toBe("");
  });
});
