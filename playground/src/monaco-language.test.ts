import { describe, expect, test } from "vitest";

// Monaco does not publish declarations for its Monarch compiler, but exercising
// that compiler is what catches language-level regex flags being dropped.
// @ts-expect-error Internal Monaco module intentionally has no declaration file.
import { compile } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js";

import { hexagonLanguage, hexagonTokens } from "./monaco-language";

describe("Hexagon Monaco tokens", () => {
  test("keeps camel-case value names in one identifier token", () => {
    const lexer = compile(hexagonLanguage, hexagonTokens);
    const lowerIdentifier = lexer.tokenizer.root[1].regex;
    const upperIdentifier = lexer.tokenizer.root[2].regex;

    expect(lowerIdentifier.exec("attendanceLabel")?.[0]).toBe("attendanceLabel");
    expect(upperIdentifier.exec("Suit")?.[0]).toBe("Suit");
  });
});
