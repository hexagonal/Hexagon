import { describe, expect, test } from "vitest";

// Monaco does not publish declarations for its Monarch compiler, but exercising
// that compiler is what catches language-level regex flags being dropped.
// @ts-expect-error Internal Monaco module intentionally has no declaration file.
import { compile } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js";

import { hexagonLanguage, hexagonTokens } from "./monaco-language";

describe("Hexagon Monaco tokens", () => {
  test("recognizes JavaScript-compatible international identifiers by start class", () => {
    const lexer = compile(hexagonLanguage, hexagonTokens);
    const moduleBlock = lexer.tokenizer.root[1].regex;
    const endModuleBlock = lexer.tokenizer.root[2].regex;
    const wildcard = lexer.tokenizer.root[4].regex;
    const upperIdentifier = lexer.tokenizer.root[5].regex;
    const nonUpperIdentifier = lexer.tokenizer.root[6].regex;

    expect(nonUpperIdentifier.exec("attendanceLabel")?.[0]).toBe("attendanceLabel");
    expect(nonUpperIdentifier.exec("用户")?.[0]).toBe("用户");
    expect(nonUpperIdentifier.exec("$税率")?.[0]).toBe("$税率");
    expect(nonUpperIdentifier.exec("_折扣")?.[0]).toBe("_折扣");
    expect(upperIdentifier.exec("Suit")?.[0]).toBe("Suit");
    expect(upperIdentifier.exec("T用户")?.[0]).toBe("T用户");
    expect(nonUpperIdentifier.exec("😀")).toBeNull();
    expect(wildcard.exec("_")?.[0]).toBe("_");
    expect(wildcard.exec("_折扣")).toBeNull();
    expect(moduleBlock.exec("module Mगणित")?.[0]).toBe("module");
    expect(endModuleBlock.exec("end module Mगणित")?.[0]).toBe("end module");
  });
});
