import { describe, expect, test } from "vitest";
import type { CodeAction } from "../../compiler/src/index.js";
import { codeActionSupportOf, selects, toLspCodeAction, wantsActions } from "./code-actions.js";
import { UriPaths } from "./positions.js";

describe("what a client is sent", () => {
  test("a client declaring nothing takes neither literals nor refusals", () => {
    expect(codeActionSupportOf(undefined)).toEqual({ literals: false, disabled: false });
    expect(codeActionSupportOf({})).toEqual({ literals: false, disabled: false });
  });

  test("literal support is the presence of the declaration, not a flag in it", () => {
    // The protocol spells this one as an object rather than a boolean: a client
    // that supports literals says which kinds it knows. An empty valueSet is
    // still support — it is a client that knows the *form*.
    expect(codeActionSupportOf({ codeActionLiteralSupport: { codeActionKind: { valueSet: [] } } }))
      .toEqual({ literals: true, disabled: false });
  });

  test("disabled support is read on its own", () => {
    expect(codeActionSupportOf({
      codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } },
      disabledSupport: true,
    })).toEqual({ literals: true, disabled: true });
  });
});

describe("which requests want the actions this server offers", () => {
  test("a request that asks for nothing in particular wants them", () => {
    expect(wantsActions(undefined)).toBe(true);
  });

  test("the kinds themselves, and the empty prefix that selects everything", () => {
    expect(wantsActions(["quickfix"])).toBe(true);
    // `refactor` became a kind this server produces with #205's variance offer,
    // which answers no diagnostic and so is not a quick fix (closure doc §8.2).
    expect(wantsActions(["refactor"])).toBe(true);
    expect(wantsActions([""])).toBe(true);
  });

  test("a request for other kinds gets none", () => {
    expect(wantsActions(["source.organizeImports"])).toBe(false);
    // `quickfixes` is not a prefix of `quickfix`, and the other way round it is
    // only one with the dot: matching on bare `startsWith` would make a request
    // for a hypothetical `quick` kind collect fixes it never asked for.
    expect(wantsActions(["quick"])).toBe(false);
  });

  test("a request narrower than the kinds on offer gets nothing", () => {
    // An entry in `only` is a prefix of the kinds it selects, so a client asking
    // for `quickfix.hexagon` is asking for something more specific than this
    // server produces and must not be handed the general kind instead.
    expect(wantsActions(["quickfix.hexagon"])).toBe(false);
    expect(wantsActions(["refactor.extract"])).toBe(false);
    // One matching entry among several is a match.
    expect(wantsActions(["source.organizeImports", "quickfix"])).toBe(true);
  });
});

describe("kind selection", () => {
  // Tested on kinds this server does not offer as well as the one it does. The
  // rule is the protocol's rather than this server's, and a server that grows a
  // sub-kind should find the rule already right rather than discover it then.
  test("an entry selects itself and everything below it", () => {
    expect(selects("quickfix", "quickfix")).toBe(true);
    expect(selects("quickfix", "quickfix.spelling")).toBe(true);
    expect(selects("source", "source.organizeImports")).toBe(true);
    expect(selects("", "quickfix.spelling")).toBe(true);
  });

  test("and nothing above or beside it", () => {
    expect(selects("quickfix.spelling", "quickfix")).toBe(false);
    expect(selects("refactor", "quickfix")).toBe(false);
    // A shared prefix is not a kind prefix: the separator is part of the rule.
    expect(selects("quick", "quickfix")).toBe(false);
  });
});

describe("converting one action", () => {
  const span = {
    fileId: 0 as never,
    start: { offset: 4, line: 0, column: 4 },
    end: { offset: 4, line: 0, column: 4 },
  };
  const action: CodeAction = {
    title: "Infer return type",
    diagnostic: { severity: "error", message: "needs a signature", primary: span },
    edits: [{ path: "/main.hex", span, replacement: ": Int" }],
  };
  const convert = (support: { literals: boolean; disabled: boolean }, one = action) =>
    toLspCodeAction(one, support, new UriPaths(), () => "/main.hex");

  test("a client that cannot read a literal is sent nothing", () => {
    // There is no `Command` behind any of these to fall back to, so a client
    // that never learned the literal form has nothing here it could apply.
    expect(convert({ literals: false, disabled: true })).toBeUndefined();
  });

  test("an edit becomes a workspace edit against the URI the path came from", () => {
    const converted = convert({ literals: true, disabled: false });
    expect(converted?.kind).toBe("quickfix");
    expect(converted?.diagnostics?.[0]?.message).toBe("needs a signature");
    const changes = converted?.edit?.changes ?? {};
    // Keyed by the URI, not by the compiler's path: a client is told about its
    // own file the way it spells it.
    expect(Object.keys(changes)).toEqual(["file:///main.hex"]);
    expect(Object.values(changes)[0]).toEqual([
      { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } }, newText: ": Int" },
    ]);
  });

  test("a refusal carries its reason and no edit, and only where it can be shown", () => {
    const refused: CodeAction = { ...action, edits: [], disabled: "the body has an error" };
    const shown = convert({ literals: true, disabled: true }, refused);
    expect(shown?.disabled?.reason).toBe("the body has an error");
    // The same kind as an enabled one: a client filtering by kind must still
    // see the refusals, or they vanish where the fixes appear.
    expect(shown?.kind).toBe("quickfix");
    expect(shown?.edit).toBeUndefined();
    expect(convert({ literals: true, disabled: false }, refused)).toBeUndefined();
  });
});
