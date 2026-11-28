/**
 * A named record tail `...a` written in an annotation is declared, as a written
 * type variable is (#520; Products §4, Functions §4.1). Inference may not close
 * it, grow it, or join it to another written tail; a bare `...` stays solved by
 * inference. Before, the tail was an ordinary inference variable: the published
 * face disagreed with the code, and an importer read a field the value did not
 * carry (`NaN` at run time).
 */

import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

function declarations(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.declarations.text;
}

const OPEN = "({ x: number } & a)";
const FACE = `<a>(r: ${OPEN}) => ${OPEN}`;

const CLOSED = "`...a` says this record may have more fields, but the body requires exactly `{ x: Int }`; " +
  "write `{ x: Int }`, or remove the annotation";
const GROWN = "`{ n: Int, ...a }` does not name `xs`; write `{ n: Int, xs: T, ...a }`";
const JOINED = "`...a` and `...b` are written separately, but these records must have the same additional " +
  "fields; use one name";

describe("#520 a written tail keeps a caller's fields", () => {
  const bodies = [
    ["identity", "r"],
    ["a spread", "{...r}"],
    ["an update", "{r with x = 1}"],
  ] as const;

  describe.each(bodies)("%s", (_name, body) => {
    test("in the body itself", async () => {
      const source = "module Main\n\n" +
        `export let f(r: {x: Int, ...a}): {x: Int, ...a} = ${body}\n` +
        "export let out: Int = f({x = 5, y = 2}).y\n";
      expect(declarations(source)).toContain(`export declare const f: ${FACE};`);
      expect(await runMain(source)).toMatchObject({ out: 2 });
    });

    test("through a higher-order helper", async () => {
      const source = "module Main\n\n" +
        "let keep(g: (b) -> b): (b) -> b = g\n" +
        `export let m(): ({x: Int, ...a}) -> {x: Int, ...a} = keep((r) => ${body})\n` +
        "export let out: Int = m()({x = 5, y = 2}).y\n";
      expect(declarations(source)).toContain(`export declare const m: <a>() => (arg0: ${OPEN}) => ${OPEN};`);
      expect(await runMain(source)).toMatchObject({ out: 2 });
    });

    test("through a returned local `let`", async () => {
      const source = "module Main\n\n" +
        "export let m(): ({x: Int, ...a}) -> {x: Int, ...a} =\n" +
        `    let g(r) = ${body}\n` +
        "    g\n" +
        "export let out: Int = m()({x = 5, y = 2}).y\n";
      expect(declarations(source)).toContain(`export declare const m: <a>() => (arg0: ${OPEN}) => ${OPEN};`);
      expect(await runMain(source)).toMatchObject({ out: 2 });
    });

    test("through an inner ascription that writes the same `...a`", async () => {
      const source = "module Main\n\n" +
        "export let f(r: {x: Int, ...a}): {x: Int, ...a} =\n" +
        `    let s: {x: Int, ...a} = ${body}\n` +
        "    s\n" +
        "export let out: Int = f({x = 5, y = 2}).y\n";
      expect(declarations(source)).toContain(`export declare const f: ${FACE};`);
      expect(await runMain(source)).toMatchObject({ out: 2 });
    });

    test("in a tuple in the function's result", async () => {
      const source = "module Main\n\n" +
        `export let f(r: {x: Int, ...a}): ({x: Int, ...a}, Int) = (${body}, r.x)\n` +
        "export let out: Int =\n" +
        "    let (s, n) = f({x = 5, y = 2})\n" +
        "    s.y + n\n";
      expect(declarations(source)).toContain(`export declare const f: <a>(r: ${OPEN}) => [${OPEN}, number];`);
      expect(await runMain(source)).toMatchObject({ out: 7 });
    });

    test("across a module boundary", async () => {
      const exports = await runProject([
        ["/main.hex", "module Main\n\nimport Lib\n\nexport let out: Int = Lib.f({x = 5, y = 2}).y\n"],
        ["/lib.hex", `module Lib\n\nexport let f(r: {x: Int, ...a}): {x: Int, ...a} = ${body}\n`],
      ]);
      expect(exports).toMatchObject({ out: 2 });
    });
  });

  test("a composition of two lambdas", async () => {
    const source = "module Main\n\n" +
      "let compose(f: (b) -> c, g: (c) -> d): (b) -> d = (x) => g(f(x))\n" +
      "export let m(): ({x: Int, ...a}) -> {x: Int, ...a} = compose((r) => {r with x = 1}, (r) => {...r})\n" +
      "export let out: Int = m()({x = 5, y = 2}).y\n";
    expect(declarations(source)).toContain(`export declare const m: <a>() => (arg0: ${OPEN}) => ${OPEN};`);
    expect(await runMain(source)).toMatchObject({ out: 2 });
  });

  test("the issue's collapse: a tail alone through a helper, read by an importer", async () => {
    const exports = await runProject([
      ["/main.hex", "module Main\n\nimport Lib\n\nexport let out: Int = Lib.m()({x = 5, y = 2}).y\n"],
      [
        "/lib.hex",
        "module Lib\n\nlet keep(g: (b) -> b): (b) -> b = g\n" +
        "export let m(): ({...a}) -> {...a} = keep((r) => {...r})\n",
      ],
    ]);
    expect(exports).toMatchObject({ out: 2 });
  });

  test("a pattern annotation and a nested lambda's annotation name the signature's tail", () => {
    expect(declarations(
      "module Main\n\n" +
      "export let f(r: {x: Int, ...a}): {x: Int, ...a} =\n" +
      "    let (s: {x: Int, ...a}) = r\n" +
      "    s\n" +
      "export let g(r: {x: Int, ...a}): () -> {x: Int, ...a} =\n" +
      "    (): {x: Int, ...a} => r\n",
    )).toContain(
      `export declare const f: ${FACE};\n` +
      `export declare const g: <a>(r: ${OPEN}) => () => ${OPEN};`,
    );
  });

  test("a type variable and a tail of one spelling stay two variables", async () => {
    const source = "module Main\n\n" +
      "export let f(x: a, r: {n: a, ...a}): {n: a, ...a} = {r with n = x}\n" +
      "export let out: Int = f(1, {n = 2, m = \"s\"}).n\n";
    expect(declarations(source)).toContain(
      "export declare const f: <a, b>(x: a, r: ({ n: a } & b)) => ({ n: a } & b);",
    );
    expect(await runMain(source)).toMatchObject({ out: 1 });
  });

  test("a knot sibling with no annotation of its own passes the record through, and the tail stays open", async () => {
    const source = "module Main\n\n" +
      "fun\n" +
      "    export pass(r: {x: Int, ...a}): {x: Int, ...a} = if r.x <= 0 then r else back({r with x = r.x - 1})\n" +
      "    back(r) = pass(r)\n" +
      "export let out: Int = pass({x = 3, y = 7}).y\n";
    expect(declarations(source)).toContain(`export declare function pass<a>(r: ${OPEN}): ${OPEN};`);
    expect(await runMain(source)).toMatchObject({ out: 7 });
  });
});

describe("#520 a written tail is refused, once, where inference would move it", () => {
  test("a body that closes it", () => {
    expect(projectDiagnostics(
      "module Main\n\nexport let f(r: {x: Int, ...a}): {x: Int, ...a} = {x = r.x}\n",
    )).toEqual([CLOSED]);
  });

  test("a callee that takes a closed record", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "let c(p: {x: Int}): Int = p.x\n" +
      "export let f(r: {x: Int, ...a}): Int = c(r)\n",
    )).toEqual([CLOSED]);
  });

  test("a field the annotation does not name, at the read", () => {
    const source = "module Main\n\n" +
      "export let f(r: {n: Int, ...a}): {n: Int, ...a} =\n" +
      "    let k = r.xs\n" +
      "    r\n";
    const compiled = compileMain(source);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([GROWN]);
    const primary = compiled.diagnostics[0]!.primary;
    expect(source.slice(primary.start.offset, primary.end.offset)).toBe("r.xs");
  });

  test("the unsound program: the importer no longer reads a field nobody passed", () => {
    const project = compileFiles([
      [
        "/main.hex",
        "module Main\n\nimport Lib\n\n" +
        "export let out: Int = Lib.f({n = 1, xs = 2}).missing\n" +
        "export let plus: Int = out + 1\n",
      ],
      [
        "/lib.hex",
        "module Lib\n\n" +
        "export let f(r: {n: Int, ...a}): {n: Int, ...a} =\n" +
        "    let k = r.xs\n" +
        "    r\n",
      ],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([GROWN]);
  });

  test("two written tails joined", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "export let f(r: {x: Int, ...a}, s: {x: Int, ...b}): Int =\n" +
      "    let t = if True then r else s\n" +
      "    t.x\n",
    )).toEqual([JOINED]);
    expect(projectDiagnostics(
      "module Main\n\nexport let f(r: {x: Int, ...a}): {x: Int, ...b} = r\n",
    )).toEqual([JOINED]);
  });

  test("a block-valued binding that cannot be generalized keeps the declared-variable report, naming the tail", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "let p: ({x: Int, ...a}) -> {x: Int, ...a} =\n" +
      "    let h = (r) => r\n" +
      "    h\n",
    )).toEqual([
      "`...a` is a declared record tail, but this right-hand side is a computation that cannot be " +
        "generalized in `...a` (`...a` occurs in an invariant position); bind where the type is known, or " +
        "remove the annotation",
    ]);
  });

  test("a knot sibling that uses the member at a closed record", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "fun\n" +
      "    export pass(r: {x: Int, ...a}): {x: Int, ...a} = if r.x <= 0 then r else {r with x = back(r.x)}\n" +
      "    back(n: Int): Int = pass({x = n - 1}).x\n",
    )).toEqual([CLOSED]);
  });

  test("each different mistake on one tail is reported once", () => {
    expect(projectDiagnostics("module Main\n\nexport let f(r: {n: Int, ...a}): Int = r.xs + r.ys\n")).toEqual([
      "`{ n: Int, ...a }` does not name `xs`; write `{ n: Int, xs: T, ...a }`",
      "`{ n: Int, ...a }` does not name `ys`; write `{ n: Int, ys: T, ...a }`",
    ]);
    expect(projectDiagnostics("module Main\n\nexport let f(r: {n: Int, ...a}): Int = r.xs + r.xs\n")).toEqual([
      "`{ n: Int, ...a }` does not name `xs`; write `{ n: Int, xs: T, ...a }`",
    ]);
    expect(projectDiagnostics(
      "module Main\n\n" +
      "let c(p: {n: Int}): Int = p.n\n" +
      "export let f(r: {n: Int, ...a}): Int = r.xs + c(r)\n",
    )).toEqual([
      "`{ n: Int, ...a }` does not name `xs`; write `{ n: Int, xs: T, ...a }`",
      "`...a` says this record may have more fields, but the body requires exactly `{ n: Int }`; " +
        "write `{ n: Int }`, or remove the annotation",
    ]);
  });
});

describe("#520 a record with more fields than a written tail allows", () => {
  test("a value: the message names its fields' types, and its advice compiles", () => {
    expect(projectDiagnostics("module Main\n\nexport let v: {n: Int, ...a} = {n = 1, y = 2}\n")).toEqual([
      "`...a` says this record may have more fields, but here it is exactly `{ n: Int, y: Int }`; " +
        "write `{ n: Int, y: Int }`, or remove the annotation",
    ]);
    expect(projectDiagnostics("module Main\n\nexport let v: {n: Int, y: Int} = {n = 1, y = 2}\n")).toEqual([]);
  });

  test("a knot sibling's argument: one report, and its advice compiles and runs", async () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "fun\n" +
      "    export pass(r: {x: Int, ...a}): {x: Int, ...a} = if r.x <= 0 then r else {r with x = back(r.x)}\n" +
      "    back(n: Int): Int = pass({x = n - 1, y = 2}).y\n",
    )).toEqual([
      "`...a` says this record may have more fields, but here it is exactly `{ x: Int, y: Int }`; " +
        "write `{ x: Int, y: Int }`, or remove the annotation",
    ]);
    expect(await runMain(
      "module Main\n\n" +
      "fun\n" +
      "    export pass(r: {x: Int, y: Int}): {x: Int, y: Int} = if r.x <= 0 then r else {r with x = back(r.x)}\n" +
      "    back(n: Int): Int = pass({x = n - 1, y = 2}).y\n" +
      "export let out: Int = pass({x = 2, y = 5}).y\n",
    )).toMatchObject({ out: 5 });
  });

  test("two tails of one spelling: the message is true, and its advice compiles", async () => {
    const program = (s: string, t: string): string =>
      "module Main\n\n" +
      "let pick(c: Bool, f: x, g: x): x = if c then f else g\n" +
      "export let f(r: {n: Int, z: Int}): Int =\n" +
      `    let h = pick(True, (${s}) => s, (${t}) => t)\n` +
      "    h(r).z\n";
    const messages = projectDiagnostics(program("s: {n: Int, ...b}", "t: {n: Int, ...b}"));
    // The second report is its own mistake: `h` is not generalized, so the
    // tail that survives is closed where `h` meets `r`.
    expect(messages).toEqual([
      "two written tails, both spelled `...b`, meet here; each annotation's tail is its own, but these " +
        "records must have the same additional fields; write both as `...`, or remove both annotations",
      "`...b` says this record may have more fields, but here it is exactly `{ n: Int, z: Int }`; " +
        "write `{ n: Int, z: Int }`, or remove the annotation",
    ]);
    for (const repaired of [program("s: {n: Int, ...}", "t: {n: Int, ...}"), program("s", "t")]) {
      expect(await runMain(repaired + "export let out: Int = f({n = 1, z = 2})\n")).toMatchObject({ out: 2 });
    }
  });

  test("two different closings of one tail are two reports; one closing met twice is one", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "let c2(p: {x: Int, y: Int}): Int = p.y\n" +
      "export let f(r: {x: Int, ...a}): {x: Int, ...a} =\n" +
      "    let k = c2(r)\n" +
      "    {x = k}\n",
    )).toEqual([
      "`...a` says this record may have more fields, but here it is exactly `{ x: Int, y: Int }`; " +
        "write `{ x: Int, y: Int }`, or remove the annotation",
      CLOSED,
    ]);
    expect(projectDiagnostics(
      "module Main\n\n" +
      "let c(p: {x: Int}): {x: Int} = p\n" +
      "export let f(r: {x: Int, ...a}): {x: Int, ...a} = c(r)\n",
    )).toEqual([CLOSED]);
  });
});

describe("#520 a constraint member's written tail", () => {
  const constraint = "constraint C<a> =\n    m(x: a, r: {n: Int, ...q}) -> {n: Int, ...q}\n";

  test("is fresh at every use, directly and through a generic forwarder", async () => {
    expect(await runMain(
      "module Main\n\n" + constraint +
      "honor C<Int> =\n    m(x, r) = {r with n = r.n + x}\n" +
      "let use<a: C>(x: a, r: {n: Int, ...p}): {n: Int, ...p} = m(x, r)\n" +
      "let one: Int = 1\n" +
      "export let out: Int = m(one, {n = 1}).n + m(one, {n = 1, y = 5}).y\n" +
      "export let through: Int = use(one, {n = 1, y = 5}).y + use(one, {n = 2}).n\n",
    )).toMatchObject({ out: 7, through: 8 });
  });

  test("a default body is checked against it, and keeps it", async () => {
    expect(await runMain(
      "module Main\n\n" +
      "constraint C<a> =\n" +
      "    k(x: a) -> Int\n" +
      "    m(x: a, r: {n: Int, ...q}) -> {n: Int, ...q} = r\n" +
      "honor C<Int> =\n    k(x) = x\n" +
      "let one: Int = 1\n" +
      "export let out: Int = m(one, {n = 1, y = 5}).y + m(one, {n = 2}).n\n",
    )).toMatchObject({ out: 7 });
  });

  test("an honor body that closes or grows it is refused, once", () => {
    expect(projectDiagnostics(
      "module Main\n\n" + constraint + "honor C<Int> =\n    m(x, r) = {n = r.n + x}\n",
    )).toEqual([
      "`...q` says this record may have more fields, but the body requires exactly `{ n: Int }`; " +
        "write `{ n: Int }`, or remove the annotation",
    ]);
    expect(projectDiagnostics(
      "module Main\n\n" + constraint + "honor C<Int> =\n    m(x, r) =\n        let k: Int = r.xs\n        r\n",
    )).toEqual(["`{ n: Int, ...q }` does not name `xs`; write `{ n: Int, xs: T, ...q }`"]);
  });
});

describe("#520 a declared pattern's written tail", () => {
  const pattern = "pattern wrapped(value: {n: Int, ...a}): {inner: {n: Int, ...a}}\n";

  test("is one tail across the head, fresh at every use", async () => {
    expect(await runMain(
      "module Main\n\n" + pattern +
      "    view(w) = w.inner\n" +
      "    build(value) = {inner = value}\n" +
      "export let out: Int =\n" +
      "    let (v)wrapped = {inner = {n = 1, z = 2}}\n" +
      "    let (u)wrapped = {inner = {n = 4}}\n" +
      "    let w = ({n = 1, k = 10})wrapped\n" +
      "    v.z + u.n + w.inner.k\n",
    )).toMatchObject({ out: 16 });
  });

  test("a view that closes it is refused", () => {
    expect(projectDiagnostics(
      "module Main\n\n" + pattern +
      "    view(w) = {n = w.inner.n}\n" +
      "    build(value) = {inner = value}\n",
    )).toEqual([
      "`...a` says this record may have more fields, but the body requires exactly `{ n: Int }`; " +
        "write `{ n: Int }`, or remove the annotation",
    ]);
  });
});

describe("#520 two knot members' written tails, refused in the knot's words", () => {
  const knotted = (first: string, second: string, earlier: string, later: string): string =>
    `${first} written on \`${earlier}\` and ${second} ` +
    `written on \`${later}\` are separate, but members of a recursive knot are checked together at ` +
    `not-yet-general types; write \`${later}\`'s tail as \`...\`, or drop \`${later}\`'s annotations and ` +
    "let inference link the knot";

  const cases = [
    {
      name: "K1: two names",
      head: "fun\n",
      first: "    export pass(r: {x: Int, ...a}): {x: Int, ...a} = if r.x <= 0 then r else back({r with x = r.x - 1})\n",
      earlier: "pass",
      later: "back",
      written: "    back(r: {x: Int, ...b}): {x: Int, ...b} = pass(r)\n",
      bare: "    back(r: {x: Int, ...}): {x: Int, ...} = pass(r)\n",
      dropped: "    back(r) = pass(r)\n",
      use: "export let out: Int = pass({x = 3, y = 7}).y\n",
      tails: ["`...a`", "`...b`"],
      out: 7,
    },
    {
      name: "K5: one name, under a constrained block head",
      head: "fun<t: Show>\n",
      first: "    export measure(r: {v: t, ...a}): String = if True then show(r.v) else again(r)\n",
      earlier: "measure",
      later: "again",
      written: "    again(r: {v: t, ...a}): String = measure(r)\n",
      bare: "    again(r: {v: t, ...}): String = measure(r)\n",
      dropped: "    again(r) = measure(r)\n",
      use: "export let out: String = measure({v = 3, w = \"x\"})\n",
      tails: ["`...a`", "`...a`"],
      out: "3",
    },
    {
      name: "K6: one name",
      head: "fun\n",
      first: "    export f(r: {x: Int, ...a}): {x: Int, ...a} = if r.x <= 0 then r else g(r)\n",
      earlier: "f",
      later: "g",
      written: "    g(r: {x: Int, ...a}): {x: Int, ...a} = f({r with x = r.x - 1})\n",
      bare: "    g(r: {x: Int, ...}): {x: Int, ...} = f({r with x = r.x - 1})\n",
      dropped: "    g(r) = f({r with x = r.x - 1})\n",
      use: "export let out: Int = f({x = 2, y = 9}).y\n",
      tails: ["`...a`", "`...a`"],
      out: 9,
    },
  ];

  describe.each(cases)("$name", ({ head, first, earlier, later, written, bare, dropped, use, tails, out }) => {
    test("refused once, naming both members and the later one's repairs", () => {
      expect(projectDiagnostics("module Main\n\n" + head + first + written + use))
        .toEqual([knotted(tails[0]!, tails[1]!, earlier, later)]);
    });

    test.each([["its tail written as `...`", bare], ["its annotations dropped", dropped]])(
      "repaired with %s, it compiles and keeps the caller's field",
      async (_how, member) => {
        const source = "module Main\n\n" + head + first + member + use;
        expect(projectDiagnostics(source)).toEqual([]);
        expect(await runMain(source)).toMatchObject({ out });
      },
    );
  });
});

describe("#520 a bare tail is still solved by inference", () => {
  test("its faces are unchanged", () => {
    expect(declarations(
      "module Main\n\n" +
      "export let echo(r: {x: Int, ...}): {x: Int, ...} = r\n" +
      "export let closes(r: {x: Int, ...}): {x: Int, ...} = {x = r.x}\n" +
      "let keep(g: (b) -> b): (b) -> b = g\n" +
      "export let m(): ({...}) -> {...} = keep((r) => {...r})\n",
    )).toBe(
      "export declare const echo: <a>(r: { x: number }) => { x: number };\n" +
      "export declare const closes: <a>(r: ({ x: number } & a)) => { x: number };\n" +
      "export declare const m: <a>() => (arg0: {  }) => {  };\n",
    );
  });

  test("a field it does not name is still inferred onto it", () => {
    expect(declarations(
      "module Main\n\n" +
      "export let f(r: {n: Int, ...}): {n: Int, ...} =\n" +
      "    let k = r.xs\n" +
      "    r\n",
    )).toContain("export declare const f: <a, b>(r: { n: number; xs: a }) => { n: number; xs: a };");
  });
});
