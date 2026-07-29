import { describe, expect, test } from "vitest";

// Monaco does not publish declarations for its Monarch compiler, but exercising
// that compiler is what catches language-level regex flags being dropped.
// @ts-expect-error Internal Monaco module intentionally has no declaration file.
import { compile } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js";

import { hexagonLanguage, hexagonTokens } from "./monaco-language";

interface CompiledRule {
  readonly regex: RegExp;
  readonly action: { readonly token?: string };
}

/**
 * Finds a root rule by what its regex says, never by its position: rules get
 * inserted ahead of these over time, and an index-based lookup silently starts
 * testing a different rule instead of failing. Monarch wraps every pattern as
 * `^(?:…)`, so these predicates read the body it wrapped.
 */
function rootRule(
  lexer: { tokenizer: { root: CompiledRule[] } },
  describes: string,
  matches: (body: string) => boolean,
): RegExp {
  const found = lexer.tokenizer.root.filter((rule) =>
    matches(rule.regex.source.replace(/^\^\(\?:/, "").replace(/\)$/, ""))
  );
  if (found.length !== 1) {
    throw new Error(`expected exactly one root rule for ${describes}, found ${found.length}`);
  }
  return found[0].regex;
}

describe("Hexagon Monaco tokens", () => {
  test("recognizes JavaScript-compatible international identifiers by start class", () => {
    const lexer = compile(hexagonLanguage, hexagonTokens);
    const moduleBlock = rootRule(lexer, "module block", (b) => b.startsWith("module(?="));
    const endModuleBlock = rootRule(lexer, "end module", (b) => b.startsWith("end[ \\t]+module"));
    const wildcard = rootRule(lexer, "bare wildcard", (b) => b.startsWith("_(?!"));
    // The bare name rules, as opposed to the call-head and constraint-head rules,
    // which all carry extra context in their patterns.
    const upperIdentifier = rootRule(
      lexer,
      "bare uppercase name",
      (b) => b.startsWith("[\\p{Uppercase}") && !b.includes("(?="),
    );
    const nonUpperIdentifier = rootRule(
      lexer,
      "bare non-uppercase name",
      (b) => b.startsWith("(?![\\p{Uppercase}") && !b.includes("(?=[ \\t]*\\("),
    );

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

  test("compiles every state the Hexagon colour families depend on", () => {
    const lexer = compile(hexagonLanguage, hexagonTokens);
    expect(Object.keys(lexer.tokenizer).sort()).toEqual([
      "aliasHeader",
      "annotation",
      "annotationGroup",
      "declarationParameters",
      "derivesList",
      "root",
      "typeParameterBound",
      "typeParameterBoundGroup",
      "typeParameters",
    ]);
  });
});
