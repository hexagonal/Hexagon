import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "../analysis/session.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import * as Source from "../support/source.js";
import { TO_LAMBDA_TITLE, TO_MATCH_FUNCTION_TITLE } from "./match-function.js";
import { keepsReading } from "./same-reading.js";

/**
 * A program and where in it: `‸` is a caret, `«…»` a selection. Both marks are
 * removed before compiling.
 */
function marked(source: string): { readonly text: string; readonly start: number; readonly end: number } {
  const caret = source.indexOf("‸");
  if (caret >= 0) return { text: source.slice(0, caret) + source.slice(caret + 1), start: caret, end: caret };
  const open = source.indexOf("«");
  const close = source.indexOf("»");
  if (open < 0 || close < open) throw new Error("no caret or selection in the source");
  return {
    text: source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1),
    start: open,
    end: close - 1,
  };
}

const PRELUDE = [
  "module Main",
  "union Shape = Circle(radius: Float) | Square(side: Float)",
  "let shapes = [Circle(1.0), Square(2.0)]",
  "let circle = Circle(1.0)",
  "",
].join("\n");

/** The refactorings offered at the mark, by title. */
function offered(body: string): ReadonlyMap<string, CodeAction> {
  const { text, start, end } = marked(PRELUDE + body);
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return new Map(
    session.codeActions("/main.hex", { start, end }, { invoked: true })
      .filter(({ kind }) => kind === "refactor")
      .map((action) => [action.title, action]),
  );
}

/** The body after the refactoring named `title` is applied at the mark, or why it is refused. */
function rewritten(body: string, title: string): string {
  const action = offered(body).get(title);
  if (action === undefined) return "not offered";
  if (action.disabled !== undefined) return `refused: ${action.disabled}`;
  const { text } = marked(PRELUDE + body);
  const [edit] = action.edits;
  const after = text.slice(0, edit!.span.start.offset) + edit!.replacement + text.slice(edit!.span.end.offset);
  return after.slice(PRELUDE.length);
}

const asMatchFunction = (body: string): string => rewritten(body, TO_MATCH_FUNCTION_TITLE);
const asLambda = (body: string): string => rewritten(body, TO_LAMBDA_TITLE);

/** Lines joined, so a program reads as it is laid out. */
const lines = (...written: readonly string[]): string => written.join("\n");

const ARMS = ["    Circle(r) => r", "    Square(s) => s"];
/** The arms under a `match` begun on the line after an arrow. */
const INDENTED = ARMS.map((arm) => `    ${arm}`);

describe("a lambda written as a match function", () => {
  test("from its parameter, its arrow, its `match` or the scrutinee", () => {
    const matchFunction = lines("let size = match", ...ARMS);
    expect(asMatchFunction(lines("let size = (sh‸ape) => match shape", ...ARMS))).toBe(matchFunction);
    expect(asMatchFunction(lines("let size = (shape) =‸> match shape", ...ARMS))).toBe(matchFunction);
    expect(asMatchFunction(lines("let size = (shape) => ma‸tch shape", ...ARMS))).toBe(matchFunction);
    expect(asMatchFunction(lines("let size = (shape) => match sha‸pe", ...ARMS))).toBe(matchFunction);
    expect(asMatchFunction(lines("let size = (shape) => match shape‸", ...ARMS))).toBe(matchFunction);
    expect(asMatchFunction(lines("let size = sh‸ape => match shape", ...ARMS))).toBe(matchFunction);
  });

  test("not from inside an arm", () => {
    expect(asMatchFunction(lines("let size = (shape) => match shape", "    Circle(r) => ‸r", ARMS[1]!)))
      .toBe("not offered");
    expect(asMatchFunction(lines("let size = (shape) => match shape", "    Circ‸le(r) => r", ARMS[1]!)))
      .toBe("not offered");
  });

  test("the innermost lambda the mark is in", () => {
    expect(asMatchFunction(lines("let size = (x) => (sh‸ape) => match shape", ...ARMS)))
      .toBe(lines("let size = (x) => match", ...ARMS));
  });

  test("where it stands, as an argument or a callee", () => {
    expect(asMatchFunction(lines("let sizes = Vector.map(shapes, (sh‸ape) => match shape", ...ARMS, ")")))
      .toBe(lines("let sizes = Vector.map(shapes, match", ...ARMS, ")"));
    expect(asMatchFunction(lines("let one = ((sh‸ape) => match shape", ARMS[0]!, `${ARMS[1]!})(Circle(1.0))`)))
      .toBe(lines("let one = (match", ARMS[0]!, `${ARMS[1]!})(Circle(1.0))`));
  });

  test("with the `match` on the line after the arrow", () => {
    expect(asMatchFunction(lines("let size = (sh‸ape) =>", "    match shape", "        Circle(r) => r", "        Square(s) => s")))
      .toBe(lines("let size = match", "        Circle(r) => r", "        Square(s) => s"));
  });

  test("keeping a comment on the `match` line", () => {
    expect(asMatchFunction(lines("let size = (sh‸ape) => match shape // by kind", ...ARMS)))
      .toBe(lines("let size = match // by kind", ...ARMS));
  });

  test("refused where a comment would be lost", () => {
    expect(asMatchFunction(lines("let size = (sh‸ape) => // by kind", "    match shape", "        Circle(r) => r", "        Square(s) => s")))
      .toBe("refused: A comment inside it would be lost. Move the comment out first.");
  });

  test("refused where its parameter is named in an arm, even one that binds the name again", () => {
    const named = "refused: `shape` is named in an arm, and a match function's parameter has no name.";
    expect(asMatchFunction(lines("let label = (sh‸ape) => match shape", "    Circle(_) => \"${shape}\"", "    Square(_) => \"square\"")))
      .toBe(named);
    expect(asMatchFunction(lines("let size = (sh‸ape) => match shape", "    Circle(shape) => shape", "    Square(s) => s")))
      .toBe(named);
  });

  test("refused where the lambda writes a type a match function cannot", () => {
    const typed = "refused: A match function writes no types, so the lambda's written types would be lost.";
    expect(asMatchFunction(lines("let size = (sh‸ape: Shape) => match shape", ...ARMS))).toBe(typed);
    expect(asMatchFunction(lines("let size = (sh‸ape): Float => match shape", ...ARMS))).toBe(typed);
    expect(asMatchFunction(lines("let size = <t>(sh‸ape) => match shape", ...ARMS))).toBe(typed);
  });

  test("refused where the `match` has a `catch` clause", () => {
    expect(asMatchFunction(lines("let size = (sh‸ape) =>", "    match shape", ...INDENTED, "    catch", "        _ => 0.0")))
      .toBe("refused: A match function has no `catch` clause.");
  });

  test("not for a match on anything but the one parameter, a pattern parameter, or a header", () => {
    expect(asMatchFunction(lines("let size = (sh‸ape) => match Some(shape)", "    Some(_) => 1.0", "    None => 0.0")))
      .toBe("not offered");
    expect(asMatchFunction(lines("let size = (sh‸ape) => match circle", ...ARMS))).toBe("not offered");
    expect(asMatchFunction(lines("let size = (sh‸ape) =>", "    shape"))).toBe("not offered");
    expect(asMatchFunction(lines("let size = (sh‸ape, other) => match shape", ...ARMS))).toBe("not offered");
    expect(asMatchFunction(lines("let size = ((sh‸ape, other)) => match shape", ...ARMS))).toBe("not offered");
    expect(asLambda(lines("let size = ((sh‸ape, other)) => match shape", ...ARMS))).toBe("not offered");
    expect(asMatchFunction(lines("let size = (‸) => match circle", ...ARMS))).toBe("not offered");
    expect(asMatchFunction(lines("let size(sh‸ape) = match shape", ...ARMS))).toBe("not offered");
    expect(asMatchFunction(lines("let size(shape) = ma‸tch shape", ...ARMS))).toBe("not offered");
    // A header after a lambda that is one: the `=>` is the lambda's, not the header's.
    expect(asMatchFunction(lines("let id = (x) => x", "let size(shape) = ma‸tch shape", ...ARMS))).toBe("not offered");
    // Nor an arrow in a header's types.
    expect(asMatchFunction(lines("let apply(sh‸ape: (Shape) => Float) = match shape", ...ARMS))).toBe("not offered");
  });
});

describe("a match function written as a lambda", () => {
  test("from its `match`", () => {
    expect(asLambda(lines("let size = ma‸tch", ...ARMS))).toBe(lines("let size = (value) => match value", ...ARMS));
    expect(asLambda(lines("let size = ‸match", ...ARMS))).toBe(lines("let size = (value) => match value", ...ARMS));
    expect(asLambda(lines("let size = match‸", ...ARMS))).toBe(lines("let size = (value) => match value", ...ARMS));
  });

  test("not from inside an arm", () => {
    expect(asLambda(lines("let size = match", "    Circle(r) => ‸r", ARMS[1]!))).toBe("not offered");
  });

  test("where it stands, as an argument, a callee or a pipe's stage", () => {
    expect(asLambda(lines("let sizes = Vector.map(shapes, ma‸tch", ...ARMS, ")")))
      .toBe(lines("let sizes = Vector.map(shapes, (value) => match value", ...ARMS, ")"));
    expect(asLambda(lines("let one = (ma‸tch", ARMS[0]!, `${ARMS[1]!})(Circle(1.0))`)))
      .toBe(lines("let one = ((value) => match value", ARMS[0]!, `${ARMS[1]!})(Circle(1.0))`));
    expect(asLambda(lines("let one = Circle(1.0) |> ma‸tch", ...ARMS)))
      .toBe(lines("let one = Circle(1.0) |> (value) => match value", ...ARMS));
  });

  test("under a name its arms leave free", () => {
    expect(asLambda(lines("let value = 1.0", "let size = ma‸tch", "    Circle(_) => value", "    Square(s) => s")))
      .toBe(lines("let value = 1.0", "let size = (value2) => match value2", "    Circle(_) => value", "    Square(s) => s"));
    expect(asLambda(lines("let size = ma‸tch", "    Circle(value) => value", "    Square(value2) => value2")))
      .toBe(lines("let size = (value3) => match value3", "    Circle(value) => value", "    Square(value2) => value2"));
  });

  test("keeping its comments", () => {
    expect(asLambda(lines("let size = ma‸tch // by kind", "    Circle(r) => r // round", ARMS[1]!)))
      .toBe(lines("let size = (value) => match value // by kind", "    Circle(r) => r // round", ARMS[1]!));
  });
});

describe("the two rewrites", () => {
  /**
   * The binders the parser mints share their spellings: a nested match
   * function's is the outer one's, and so is a `(_) =>` lambda's. Each is read
   * only inside the lambda that mints it, so it names no parameter of another.
   */
  test("with a lambda in an arm whose parameter the parser minted", () => {
    const minted = [
      ["    Circle(r) => (_) => r", "    Square(s) => (_) => s"],
      ["    Circle(r) => ((a, b)) => r", "    Square(s) => ((a, b)) => s"],
      ["    Circle(r) => match", "        Circle(q) => q", "        Square(q) => q", "    Square(s) => (x) => s"],
    ];
    for (const arms of minted) {
      expect(asMatchFunction(lines("let f = (sh‸ape) => match shape", ...arms))).toBe(lines("let f = match", ...arms));
      expect(asLambda(lines("let f = ma‸tch", ...arms))).toBe(lines("let f = (value) => match value", ...arms));
    }
  });

  test("undo one another", () => {
    const lambda = lines("let sizes = Vector.map(shapes, (value) => match value", ...ARMS, ")");
    const matchFunction = asMatchFunction(lambda.replace("(value)", "(val‸ue)"));
    expect(matchFunction).toBe(lines("let sizes = Vector.map(shapes, match", ...ARMS, ")"));
    expect(asLambda(matchFunction.replace("match", "ma‸tch"))).toBe(lambda);
  });

  test("are offered only when the dev asks, as refactorings, never preferred", () => {
    const { text, start, end } = marked(PRELUDE + lines("let size = ma‸tch", ...ARMS));
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    expect(session.codeActions("/main.hex", { start, end }).map(({ title }) => title)).toEqual([]);
    expect(session.codeActions("/main.hex", { start, end }, { invoked: true })
      .map(({ title, kind, preferred }) => ({ title, kind, preferred })))
      .toEqual([{ title: TO_LAMBDA_TITLE, kind: "refactor", preferred: undefined }]);
  });
});

describe("the parse that checks a rewrite", () => {
  const check = (before: string, after: string): boolean => {
    const text = PRELUDE + before;
    const file = new Source.File(1 as Source.FileId, "/main.hex", text);
    const [module] = parseFile(applyLayout(lex(file)), file.path);
    return keepsReading(file, module!, { start: PRELUDE.length, end: text.length, replacement: after });
  };

  test("reads a match function as the lambda that matches its one parameter", () => {
    const matchFunction = lines("let size = match", ...ARMS);
    expect(check(matchFunction, lines("let size = (shape) => match shape", ...ARMS))).toBe(true);
    expect(check(matchFunction, lines("let size = (shape) =>", "    match shape", ...INDENTED)))
      .toBe(true);
  });

  test("and not the lambda whose parameter an arm names, which would capture it", () => {
    const named = ["    Circle(_) => Vector.length(shapes)", "    Square(_) => 0"];
    expect(check(lines("let size = match", ...named), lines("let size = (shapes) => match shapes", ...named))).toBe(false);
    expect(check(lines("let size = match", ...named), lines("let size = (shape) => match shape", ...named))).toBe(true);
  });

  test("and not a lambda that says more than one", () => {
    const matchFunction = lines("let size = match", ...ARMS);
    expect(check(matchFunction, lines("let size = (shape: Shape) => match shape", ...ARMS))).toBe(false);
    expect(check(matchFunction, lines("let size = (shape): Float => match shape", ...ARMS))).toBe(false);
    expect(check(matchFunction, lines("let size = (shape) => match shape", "    Circle(r) => r", "    Square(s) => s + 1.0")))
      .toBe(false);
    expect(check(matchFunction, lines("let size = (shape) =>", "    match shape", ...INDENTED, "    0.0")))
      .toBe(false);
    expect(check(matchFunction, lines("let size = (shape) =>", "    match shape", ...INDENTED, "    catch", "        _ => 0.0")))
      .toBe(false);
    expect(check(matchFunction, lines("let size = (shape, other) => match shape", ...ARMS))).toBe(false);
    expect(check(matchFunction, lines("let size = (shape) => match other", ...ARMS))).toBe(false);
    expect(check(matchFunction, lines("let size = (shape) => match Some(shape)", ...ARMS))).toBe(false);
    expect(check(matchFunction, lines("let size = () => match circle", ...ARMS))).toBe(false);
  });
});
