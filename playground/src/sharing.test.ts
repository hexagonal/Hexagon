import { describe, expect, test } from "vitest";

import { readSharedSource, shareUrl } from "./sharing";

describe("shareable source URLs", () => {
  test("round-trips multiline Unicode source through the fragment", () => {
    const source = 'let greeting = "Hello, λ!"\nconsole.log(greeting)';
    const shared = shareUrl(new URL("https://example.test/Hexagon/?theme=dark"), source);

    expect(shared.search).toBe("?theme=dark");
    expect(readSharedSource(shared)).toBe(source);
  });

  test("leaves ordinary URLs without shared source alone", () => {
    expect(readSharedSource(new URL("https://example.test/Hexagon/"))).toBeUndefined();
  });
});
