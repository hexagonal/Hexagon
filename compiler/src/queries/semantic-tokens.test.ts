import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";

/**
 * Renders tokens as `text:type` with a `+declaration` suffix, against the source
 * they came from. The text is sliced from the file rather than taken from the
 * occurrence, so a token whose span drifted off its name shows up as the wrong
 * text instead of quietly agreeing with itself.
 */
function render(source: string, session: AnalysisSession, path = "/main.hex"): readonly string[] {
  return session.semanticTokens(path).map((token) => {
    const text = source.slice(token.span.start.offset, token.span.end.offset);
    return `${text}:${token.type}${token.modifiers.includes("declaration") ? "+declaration" : ""}`;
  });
}

function sessionOf(files: Record<string, string>): AnalysisSession {
  const session = new AnalysisSession();
  for (const [path, text] of Object.entries(files)) session.setFile(path, text);
  return session;
}

describe("semantic tokens", () => {
  test("classifies each kind of name by what the resolver made of it", () => {
    const source = [
      "union Shade =",
      "    | Pale",
      "    | Deep",
      "",
      "record Box = {item: Int}",
      "",
      "fun tint(shade: Shade): Shade = shade",
      "",
      "fun counted(): Int =",
      "    var moving: Int = 2",
      "    moving",
      "",
      "let fixed: Int = 1",
      "",
    ].join("\n");
    const session = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    // A record's field name is absent because it denotes nothing the index
    // knows: fields are not symbols, and the grammar already colours them.
    expect(render(source, session)).toEqual([
      "Shade:enum+declaration",
      "Pale:enumMember+declaration",
      "Deep:enumMember+declaration",
      "Box:struct+declaration",
      "tint:function+declaration",
      "shade:parameter+declaration",
      "Shade:enum",
      "Shade:enum",
      "shade:parameter",
      "counted:function+declaration",
      "moving:variable+declaration",
      "moving:variable",
      "fixed:variable+declaration",
    ]);
  });

  test("a record's declaration is one token, not two at one range", () => {
    // The name is its type and its constructor at once, and the index publishes
    // both. The protocol's encoding admits one token per range, and two tokens
    // at one range would shift every token after them in the file.
    const source = ["record Box = {item: Int}", "", "let boxed: Box = Box({item = 1})", ""]
      .join("\n");
    const session = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const tokens = session.semanticTokens("/main.hex");
    const ranges = tokens.map(({ span }) => `${span.start.offset}:${span.end.offset}`);
    expect(new Set(ranges).size).toBe(ranges.length);
    // Both readings of the name colour the same, so nothing is being chosen
    // between: in source they are one declaration and they look like one.
    expect(render(source, session)).toEqual([
      "Box:struct+declaration",
      "boxed:variable+declaration",
      "Box:struct",
      "Box:struct",
    ]);
  });

  test("a constraint and its members are told apart from ordinary values", () => {
    const source = [
      "constraint Same<a> =",
      "    same(left: a, right: a): Bool",
      "",
      "record Token = {value: Int}",
      "",
      "honor Same<Token> =",
      "    same(left, right) = left.value == right.value",
      "",
    ].join("\n");
    const session = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const rendered = render(source, session);
    expect(rendered).toContain("Same:interface+declaration");
    expect(rendered).toContain("Same:interface");
    expect(rendered).toContain("same:method+declaration");
    expect(rendered).toContain("Token:struct+declaration");
  });

  test("tokens are ordered by position, which the encoding depends on", () => {
    const source = [
      "fun outer(value: Int): Int = value",
      "",
      "union Shade =",
      "    | Pale",
      "",
      "let chosen: Shade = Pale",
      "",
    ].join("\n");
    const session = sessionOf({ "/main.hex": source });
    const tokens = session.semanticTokens("/main.hex");
    const positions = tokens.map(({ span }) => [span.start.line, span.start.column] as const);
    // A single token out of order shifts every token after it, because each one
    // is encoded relative to the one before.
    expect(positions).toEqual(
      [...positions].sort((left, right) => left[0] - right[0] || left[1] - right[1]),
    );
    expect(tokens.every(({ span }) => span.start.line === span.end.line)).toBe(true);
  });

  test("a function is a function however it was bound", () => {
    // The binder form does not say what a name holds. `let brighten(colour) = …`
    // is a `let`; `let indirect = tint` is a `let` with no parameter list at
    // all. Both are functions, and a reader scanning for calls needs them to
    // look like it. The checker's type is what knows.
    const source = [
      "fun tint(value: Int): Int = value",
      "let brighten(value: Int): Int = value",
      "let indirect = tint",
      "let plain: Int = 1",
      "",
    ].join("\n");
    const session = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const rendered = render(source, session);
    expect(rendered).toContain("tint:function+declaration");
    expect(rendered).toContain("brighten:function+declaration");
    expect(rendered).toContain("indirect:function+declaration");
    expect(rendered).toContain("plain:variable+declaration");
  });

  test("a foreign function and a foreign value are told apart", () => {
    // `SymbolKind` flattens both declaration forms to `extern`, so neither can
    // be read off the symbol's binder form. They fall out of the same question
    // asked of the checker.
    const source = [
      'extern from "./shim.js"',
      "    fun compute(value: Int): Int",
      "    let version: String",
      "",
      "let answer: Int = compute(1)",
      "let label: String = version",
      "",
    ].join("\n");
    const session = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const rendered = render(source, session);
    expect(rendered).toContain("compute:function");
    expect(rendered).toContain("version:variable");
  });

  test("a foreign declaration keeps its classification in another module", () => {
    // The fact table is built for the whole project rather than per module: a
    // foreign function declared in one file and used in another has to colour
    // the same in both, and a per-module table would only know its own.
    const helper = [
      'extern from "./shim.js"',
      "    export fun compute(value: Int): Int",
      "    export let version: String",
      "",
    ].join("\n");
    const main = [
      'import {compute, version} from "./helper"',
      "",
      "let answer: Int = compute(1)",
      "let label: String = version",
      "",
    ].join("\n");
    const session = sessionOf({ "/helper.hex": helper, "/main.hex": main });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const rendered = render(main, session);
    expect(rendered).toContain("compute:function");
    expect(rendered).toContain("version:variable");
  });

  test("a file the session does not hold answers with no tokens", () => {
    const session = sessionOf({ "/main.hex": "let value: Int = 1\n" });
    expect(session.semanticTokens("/absent.hex")).toEqual([]);
  });

  test("a file that does not compile still colours what resolved", () => {
    // Semantic tokens layer over the TextMate grammar, so going silent on a
    // broken file would repaint it as the user types. Whatever still has an
    // identity keeps its colour.
    const source = ["fun tint(value: Int): Int = value", "", "let broken: Int = ", ""].join("\n");
    const session = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex").length).toBeGreaterThan(0);
    expect(render(source, session)).toContain("tint:function+declaration");
  });
});
