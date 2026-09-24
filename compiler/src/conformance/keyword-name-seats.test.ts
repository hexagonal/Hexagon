import { describe, expect, test } from "vitest";

import { hardKeywordSpellings } from "../syntax/lexed/token.js";
import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Lexer §4.4 (#1014): a hard keyword is reserved in bare seats only. In the
 * dotted, label, and declaration-name seats it is an ordinary name; everywhere a
 * name would be written bare — a parameter, a local, a pun, a pattern
 * declaration's name — it is refused, and a keyword-named declaration is
 * exported, since only a dot reaches it.
 *
 * The seat × keyword table below is the point of this file: the seats are
 * decided by one door (the lexer's name-seat pass, then the parser's sweep), and
 * a table over every keyword is what keeps a seat added later from admitting or
 * refusing some keywords by accident.
 */

const KEYWORDS = [...hardKeywordSpellings];
/** `true`/`false` never name a declaration (Lexer §4.1's redirect). */
const DECLARABLE = KEYWORDS.filter((word) => word !== "true" && word !== "false");

function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

function main(source: string): readonly string[] {
  return messages([["/main.hex", `module Main\n\n${source}`]]);
}

function javascript(source: string, path = "/Main.hex"): string {
  const project = compileFiles([["/main.hex", `module Main\n\n${source}`]]);
  return project.modules.find((module) => module.path === path)!.javascript.text;
}

describe("the table: every hard keyword in every name seat", () => {
  test.each(KEYWORDS)("`%s` is a field label, a dotted field, and a pattern label", (word) => {
    expect(main(
      `export let r: {${word}: Int} = {${word} = 1}\n` +
        `export let v: Int = r.${word}\n` +
        `export let w: Int = match r\n    {${word} = x} => x\n` +
        `export let u: {${word}: Int} = {r with ${word} = 2}\n`,
    )).toEqual([]);
  });

  test.each(KEYWORDS)("`%s` is a union constructor's or exception's slot label", (word) => {
    expect(main(`export union U = C(${word}: Int)\nexport exception E(${word}: Int)\n`)).toEqual([]);
  });

  test.each(DECLARABLE)("`%s` names an exported declaration, reached through a dot", (word) => {
    expect(messages([
      ["/lib.hex", `module Lib\n\nexport let ${word}(x: Int): Int = x + 1\n`],
      ["/main.hex", `module Main\n\nimport Lib\n\nexport let v: Int = Lib.${word}(1)\n`],
    ])).toEqual([]);
  });

  test.each(DECLARABLE)("`%s` unexported could never be reached, and is refused", (word) => {
    expect(main(`let ${word}(x: Int): Int = x + 1\n`)).toEqual([
      `\`${word}\` is reserved; a declaration named \`${word}\` is reached only through a dot, ` +
        "from an importer or on its home type — export it, or choose another name",
    ]);
  });

  test.each(KEYWORDS)("`%s` as a parameter is refused: a parameter is only written bare", (word) => {
    expect(main(`export let f(${word}: Int): Int = 1\n`)).toEqual([
      `\`${word}\` is reserved; a local or parameter name is only ever written bare — choose another name`,
    ]);
  });

  test.each(KEYWORDS)("`%s` as a pun is refused, naming the written-out field", (word) => {
    expect(main(`export let r = {${word}}\n`)).toContain(
      `\`${word}\` is reserved; write the field out: \`{${word} = …}\``,
    );
  });
});

describe("the seats, one construct at a time", () => {
  test("a local binding refuses a keyword even where its neighbours make it a name", () => {
    expect(main("export let f(): Int =\n    let type = 1\n    2\n")).toEqual([
      "`type` is reserved; a local or parameter name is only ever written bare — choose another name",
    ]);
  });

  test("`true` and `false` never name a declaration", () => {
    expect(main("export let true = 1\n")).toEqual(["`true` is reserved and cannot be used as a name"]);
  });

  test("a half-typed `let = 1` stays a keyword: a label seat lies inside a bracket pair", () => {
    expect(main("let = 1\nexport let good: Int = 2\n")).toEqual(["`let` requires a non-uppercase-start name"]);
  });

  test("a member-block item is not a name seat: `or = …` in an `honor` block stays the keyword", () => {
    // At block level a label seat does not exist (it lies inside a bracket pair),
    // so the line is the continuation §2.3 makes it, never a member named `or`.
    expect(main(
      "constraint Both<a> =\n    both(x: a, y: a) -> a\n" +
        "honor Both<Int> =\n    both(x, y) = x\n    or = 1\n",
    )).not.toContain("`or` is reserved; a local or parameter name is only ever written bare — choose another name");
  });

  test("`get`, `set`, `method`, and `as` are ordinary names outside an extern row", () => {
    // Their seat is an extern row's alone; a keyword after one elsewhere stays a
    // keyword (the review's regression: these compiled before Rule D).
    expect(main("export let f(r: {get: Bool}): Int = if r.get then 1 else 2\n")).toEqual([]);
    expect(main("export let f(get: Bool, set: Int): Int = if get then set else 0\n")).toEqual([]);
    expect(main("export let f(set: Bool, b: Bool): Bool = set and b\n")).toEqual([]);
    expect(main("export let f(method: Bool, b: Bool): Bool =\n    method\n    or b\n")).toEqual([]);
    expect(main("export let f(as: Bool, b: Bool): Bool = as and b\n")).toEqual([]);
  });

  test.each(KEYWORDS)("a `%s` pun is the one report, in a literal, an update, and a pattern (#1021)", (word) => {
    const pun = `\`${word}\` is reserved; write the field out: \`{${word} = …}\``;
    expect(main(`let r = {${word} = 1}\nexport let u: {${word}: Int} = {r with ${word}}\n`)).toEqual([pun]);
    expect(main(`export let r: {${word}: Int, x: Int} = {${word}, x = 1}\n`)).toEqual([pun]);
    expect(main(`let r = {${word} = 1}\nexport let v: Int = match r\n    {${word}} => 1\n`)).toEqual([pun]);
  });

  test("a keyword in a type's braces is a missing annotation, as `{x}` is", () => {
    expect(main("record R = {type}\n")).toEqual(main("record R = {x}\n"));
  });

  test("`true` and `false` are foreign names on any extern row, never the local", () => {
    expect(main(
      'extern from "lib"\n    export fun true as isTrue(x: Int) -> Bool\n    export let false as no: Int\n',
    )).toEqual([]);
    expect(main('extern from "lib"\n    export fun true(x: Int) -> Bool\n')).toContain(
      "`true` is reserved and cannot be used as a name",
    );
  });

  test("a keyword in a name seat is never a block head (Lexer & Layout §2.1)", () => {
    expect(main("let r = {match = 1}\nexport let v: Int = r.match\nexport let w: Int = 2\n"))
      .toEqual([]);
  });

  test("a bare use of the module's own keyword-named term says where the name went", () => {
    const [report] = compileFiles([["/main.hex",
      "module Main\n\nexport let or(a: Int, b: Int): Int = a\nexport let v: Int = or(1, 2)\n"]]).diagnostics;
    const note =
      "this module's `or` is reached only through a dot, from an importer or on its home type";
    expect(report?.notes).toContain(note);
    // Once per report, however many bare uses share its line.
    const [twice] = compileFiles([["/main.hex",
      "module Main\n\nexport let or(a: Int, b: Int): Int = a\nexport let v: Int = or(or(1, 2), 3)\n"]]).diagnostics;
    expect(twice?.notes?.filter((text) => text === note)).toEqual([note]);
  });

  test("an extern row binds a keyword-named export unaliased, and a foreign type name before `as`", () => {
    expect(main(
      'extern from "lib"\n    export type match as Matcher\n    export fun match(pattern: String) -> Matcher\n',
    )).toEqual([]);
  });

  test("an interpolation is an expression like any other: `${ev.type}`", () => {
    expect(main('let r = {type = "click"}\nexport let s: String = "${r.type}!"\n')).toEqual([]);
  });
});

describe("emission", () => {
  test("keyword fields and dotted names are written verbatim", async () => {
    const text = javascript(
      'let r = {type = "click", in = 1}\nexport let k: String = r.type\nexport let n: Int = r.in\n',
    );
    expect(text).toContain('const r = { type: "click", in: 1 };');
    expect(text).toContain("const k = r.type;");
    const { k, n } = await runProject([["/main.hex",
      'module Main\n\nlet r = {type = "click", in = 1}\nexport let k: String = r.type\n' +
      "export let n: Int = r.in\n"]]);
    expect([k, n]).toEqual(["click", 1]);
  });

  test("a JavaScript-reserved slot takes rule 4's parameter in the `.js` and the `.d.ts`", async () => {
    const project = compileFiles([["/main.hex",
      "module Main\n\nexport union U = C(delete: Int, in: Int, type: String)\nexport exception E(for: Int)\n"]]);
    const module = project.modules.find(({ path }) => path === "/Main.hex")!;
    expect(module.javascript.text).toContain(
      'const C = (__delete, __in, type) => ({ tag: "C", delete: __delete, in: __in, type });',
    );
    expect(module.javascript.text).toContain('const E = __for => __exception("E", "", { for: __for });');
    expect(module.declarations?.text).toContain(
      "export declare const C: (__delete: number, __in: number, type: string) => U;",
    );
    expect(module.declarations?.text).toContain("export declare function E(__for: number): E;");
    const { value } = await runProject([["/main.hex",
      "module Main\n\nunion U = C(delete: Int, in: Int)\n" +
      "export let value: Int = match C(1, 2)\n    C(d, i) => d + i\n"]]);
    expect(value).toBe(3);
  });

  test("a JavaScript-reserved keyword term takes rule 4's local and keeps its export name", () => {
    const text = javascript("export let catch(x: Int): Int = x\n");
    expect(text).toContain("const __catch = x => x;");
    expect(text).toContain("export { __catch as catch };");
  });
});

describe("no module publishes a JavaScript export named `then` (FFI Part 7 §7)", () => {
  const LIB = "module Lib\n\nexport let then(a: Int, b: Int): Int = a + b\nexport let other: Int = 1\n";

  test("the term exports only as `__then`, and the `.d.ts` declares no `then`", () => {
    const project = compileFiles([["/lib.hex", LIB]]);
    const module = project.modules.find(({ path }) => path === "/Lib.hex")!;
    expect(module.javascript.text).toContain("export { then as __then };");
    expect(module.javascript.text).not.toMatch(/export \{ then \}|as then \}/u);
    expect(module.declarations?.text ?? "").not.toMatch(/\bthen\b/u);
  });

  test("a Hexagon importer reaches it through the internal edition, and the module loads", async () => {
    const project = compileFiles([
      ["/lib.hex", LIB],
      ["/main.hex", "module Main\n\nimport Lib\n\nexport let v: Int = Lib.then(1, 2)\n"],
    ]);
    const main = project.modules.find(({ path }) => path === "/Main.hex")!;
    expect(main.javascript.text).toContain('import { __then } from "./Lib.js";');
    expect(main.javascript.text).toContain("const v = __then(1, 2);");
    // A module whose namespace carried a callable `then` would never arrive from
    // the harness's dynamic `import()` — promise resolution would call it.
    const { v } = await runProject([
      ["/lib.hex", LIB],
      ["/main.hex", "module Main\n\nimport Lib\n\nexport let v: Int = Lib.then(1, 2)\n"],
    ]);
    expect(v).toBe(3);
  });

  test("an importer reaches a member `then` inline, and a first-class one as `__then`, importing nothing (#1021)", () => {
    const project = compileFiles([
      ["/task.hex", 'module Task\n\nextern from "task-lib"\n    export type Task\n' +
        "    export method then(task: Task, next: String -> Task) ->! Task\n"],
      ["/main.hex", "module Main\n\nimport Task\n\n" +
        "export let g(t: Task.Task, f: String -> Task.Task): Task.Task = t.then!(f)\n" +
        "export let h: (Task.Task, String -> Task.Task) ->! Task.Task = Task.then\n"],
    ]);
    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ path }) => path === "/Main.hex")!.javascript.text;
    expect(text).toContain("const g = (t, f) => t.then(f);");
    expect(text).toContain("const h = Task.__then;");
    expect(text).not.toContain("import { __then }");
  });

  test("an extern member named `then` is emitted inline and published as `__then` only", () => {
    const project = compileFiles([["/task.hex",
      'module Task\n\nextern from "task-lib"\n    export type Task\n' +
      "    export method then(task: Task, next: String -> Task) ->! Task\n\n" +
      "export let twice(t: Task, f: String -> Task): Task = t.then!(f).then!(f)\n"]]);
    const module = project.modules.find(({ path }) => path === "/Task.hex")!;
    expect(project.diagnostics).toEqual([]);
    expect(module.javascript.text).toContain("const twice = (t, f) => t.then(f).then(f);");
    expect(module.javascript.text).toContain("export { then as __then };");
    expect(module.javascript.text).not.toMatch(/export \{ then \}/u);
  });
});
