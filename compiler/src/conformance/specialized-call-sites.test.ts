/**
 * Conformance for the **imported** half of FFI Part 8 §8.2's optimizer freedom
 * (§15 row 18, #440): a call whose callee is an exported constrained
 * declaration in another module, and whose constrained variables all
 * instantiate at fundamental types, emits the Algorithm N edition by name
 * rather than the generic edition with trailing evidence.
 *
 * The same-module half predates this and is pinned in `emitter.test.ts`. What
 * is new here is everything the module boundary adds: the plan is recomputed
 * from the scheme the interface carries rather than read off local items, the
 * edition's name has to be *imported*, and the module it comes from has to be
 * emitted. That last one is defect 8's shape and is the reason several tests
 * here run the graph instead of reading it — a program can import `logString`
 * from a `Debug.js` that was never written, compile clean, and fail only at
 * load.
 *
 * The last two describe blocks are about the recognition step both halves
 * share, and each covers both. #441's is the two enumeration-membered
 * fundamentals, which were missing from it in each half; #679's rider is the one
 * shape left after that — a constraint a module *declared*, honored at `Bool`,
 * whose evidence is neither a stamped primitive nor a structural type.
 *
 * **Every executed graph is made byte-distinct**, through the `distinct`
 * transform `debug-log.test.ts` introduced: emitted modules mount as `data:`
 * URLs and the registry caches those by text, so two tests compiling the same
 * program would share one `Debug.js` — and one captured sink.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function emitted(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) {
    throw new Error(
      `no emitted module at ${path}; emitted: ${
        project.modules.map(({ source }) => source.path).join(", ")
      }`,
    );
  }
  return module.javascript.text;
}

/**
 * Relative imports in the emitted JavaScript naming a module the project did not
 * emit — defect 8's general form. Empty is the only acceptable value.
 */
function danglingImports(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  const project = compileFiles(files);
  const paths = new Set(project.modules.map(({ source }) => source.path));
  return project.modules.flatMap((module) =>
    [...module.javascript.text.matchAll(/from\s+"(\.[^"]+)"/gu)].flatMap((match) => {
      const specifier = match[1];
      if (specifier === undefined) return [];
      const target = `${specifier.replace(/\.js$/u, "")}.hex`.replace(/^\.\//u, "/");
      return paths.has(target) ? [] : [`${module.source.path} -> ${specifier}`];
    })
  );
}

/** The lines `Debug.hex`'s captured sink writes while `run` executes. */
async function written(run: () => Promise<unknown>): Promise<readonly unknown[][]> {
  const host = globalThis as unknown as {
    console: { log: (...values: unknown[]) => void };
  };
  const lines: unknown[][] = [];
  const original = host.console.log;
  host.console.log = (...values: unknown[]) => {
    lines.push(values);
  };
  try {
    await run();
  } finally {
    host.console.log = original;
  }
  return lines;
}

/** Import lines only — several claims here are about the module graph. */
function importLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("import "));
}

const SHOW_PAIR =
  "export let pair<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n";

describe("a concrete call to a prelude constrained export", () => {
  test("reaches the `String` edition and asks for no evidence", () => {
    const javascript = emitted([["/main.hex", 'Debug.log("hello")\n']]);

    expect(javascript).toContain('import { logString } from "./Debug.js";');
    expect(javascript).toContain('logString("hello");');
    // The two things the edition replaces: the generic edition's aliased import
    // and the dictionary it would have been handed.
    expect(javascript).not.toContain("__log as log");
    expect(javascript).not.toContain("__Show_String");
  });

  test("reaches the `Int` edition, and through a nested call too", () => {
    const javascript = emitted([[
      "/main.hex",
      'Debug.log(Debug.trace("n", 7))\n',
    ]]);

    expect(javascript).toContain(
      'import { logInt, traceInt } from "./Debug.js";',
    );
    expect(javascript).toContain('logInt(traceInt("n", 7));');
    expect(javascript).not.toContain("__Show_Int");
  });

  /**
   * A constraint **member** is not a declaration Algorithm S enumerates: `show`
   * and `equals` are forwarders emitted from a `constraint` item, and the plan
   * walks `let` and `fun` items only, so no `showFloat` or `equalsString` exists
   * anywhere to call. The issue's specimen names both; the rule as implemented
   * covers `log` and `trace` — declarations — and leaves a member call to its
   * own machinery. Nothing here is a choice this change made, and widening it
   * would be minting editions the export surface does not have.
   *
   * The permanent half is the `showInt` clause, and it is permanent: Constraints
   * §6.1 fixes the forwarder as the seat the member name denotes as a
   * module-scope *term* — a reference, a generalized alias, the exported ABI
   * face — so it has no Part 8 specialization at any type and no generic
   * edition. What #444 changed is the other half: a concrete member **call** is
   * a call to the instance's method, so it reaches `Int.hex`'s member seat.
   * That is routing to a binding the honoring module already owed, not a minted
   * edition, and the two claims are independent — the pin below holds both.
   */
  test("a constraint member forwarder has no edition, at any type", () => {
    const javascript = emitted([[
      "/main.hex",
      "export let rendered: String = show(42)\n",
    ]]);

    expect(javascript).toContain('import { __Show_Int_show as show } from "./Int.js";');
    expect(javascript).toContain("const rendered = show(42);");
    expect(javascript).not.toContain("showInt");
  });

  /**
   * And the forwarder is still what a *polymorphic* member call reaches, which
   * is the other side of the same pin: no edition exists there either, so the
   * evidence rides the trailing suffix exactly as it always did.
   */
  test("a polymorphic member call keeps the forwarder and its evidence", () => {
    const javascript = emitted([[
      "/main.hex",
      "export let render<a: Show>(value: a): String = show(value)\n",
    ]]);

    expect(javascript).toContain('import { __show as show } from "./Show.js";');
    expect(javascript).toContain("const render = (value, __Show_a) => show(value, __Show_a);");
    expect(javascript).not.toContain("showInt");
  });

  /**
   * The whole reachability claim in one assertion, and the reason the new
   * channel reports its specifiers: routing every call to an edition spends the
   * synthesized prelude import's entire name list, so the term channel reports
   * nothing while the file still imports `logString` from `Debug.js`.
   */
  test("keeps the module it imports the edition from in the emitted graph", () => {
    expect(danglingImports([["/main.hex", 'Debug.log("hello")\nDebug.log(1)\n']])).toEqual([]);
  });

  test("runs, and the write reaches the sink", async () => {
    const lines = await written(() =>
      runProject(
        [["/main.hex", 'Debug.log("through the edition")\nexport let ok: Int = 1\n']],
        { transform: distinct("specialized call sites: prelude edition") },
      )
    );

    expect(lines).toEqual([["through the edition"]]);
  });
});

describe("a concrete call across a source-written import", () => {
  test("reaches the edition while the source's own import line stays", () => {
    const javascript = emitted([
      ["/math.hex", "export let plus<a: Num>(x: a, y: a): a = x + y\n"],
      [
        "/main.hex",
        'import Math from "./math"\nexport let answer: Int = Math.plus(20, 22)\n',
      ],
    ]);

    // Two lines, not one merged line: since #762 the source's own import is a
    // namespace import (`import * as Math`), which is not a named list an
    // edition's binding can join — so the specializer opens its own line for
    // the generic name and the edition beside it, and no *third* line repeats
    // either. `__plus` rides bare, unaliased, because nothing in the source
    // binds the local name `plus` any more — only `Math` is bound.
    expect(javascript).toContain('import * as Math from "./math.js";');
    expect(javascript).toContain('import { __plus, plusInt } from "./math.js";');
    expect(javascript).toContain("const answer = plusInt(20, 22);");
    expect(javascript).not.toContain("__Num_Int");
    expect(importLines(javascript).filter((line) => line.includes('"./math.js"')))
      .toHaveLength(2);
  });

  /**
   * Both lines take their **source position**, not the top of the file:
   * `Import` items render last so the line can know its editions, but they
   * keep their seat in the entries stream, and the specializer's line joins
   * immediately after the namespace import it rides beside.
   */
  test("keeps both lines where the source wrote the import", () => {
    const javascript = emitted([
      ["/math.hex", "export let plus<a: Num>(x: a, y: a): a = x + y\n"],
      [
        "/main.hex",
        "let before: Int = 1\n" +
          'import Math from "./math"\n' +
          "export let answer: Int = Math.plus(before, 41)\n",
      ],
    ]);

    expect(javascript.indexOf("const before = 1;")).toBeLessThan(
      javascript.indexOf('import * as Math from "./math.js";'),
    );
    expect(javascript.indexOf('import * as Math from "./math.js";')).toBeLessThan(
      javascript.indexOf('import { __plus, plusInt } from "./math.js";'),
    );
  });

  test("names each variable's assignment in declaration order", () => {
    const javascript = emitted([
      ["/pair.hex", SHOW_PAIR],
      [
        "/main.hex",
        'import Pair from "./pair"\n' +
          'export let answer: String = Pair.pair(1, "x")\n',
      ],
    ]);

    expect(javascript).toContain('import * as Pair from "./pair.js";');
    expect(javascript).toContain(
      'import { __pair, pairIntString } from "./pair.js";',
    );
    expect(javascript).toContain('const answer = pairIntString(1, "x");');
  });

  test("computes what the generic edition would have", async () => {
    const exports = await runProject(
      [
        ["/pair.hex", SHOW_PAIR],
        [
          "/main.hex",
          'import Pair from "./pair"\n' +
            'export let answer: String = Pair.pair(1, "x")\n',
        ],
      ],
      { transform: distinct("specialized call sites: cartesian edition") },
    );

    expect(exports["answer"]).toBe("1x");
  });
});

describe("everything else keeps its trailing evidence", () => {
  test("a variable still in play carries the dictionary", () => {
    const javascript = emitted([
      ["/pair.hex", SHOW_PAIR],
      [
        "/main.hex",
        'import Pair from "./pair"\n' +
          "export let half<b: Show>(y: b): String = Pair.pair(1, y)\n",
      ],
    ]);

    // The dictionary is this module's own parameter, spelled after the binder
    // `half` declares rather than after the one `pair` was written with (#425).
    // The callee is `__pair` bare, not aliased to `pair`, because the source's
    // own binding is `Pair` the module alias — no local `pair` for #425's
    // on-collision rule to protect (#762).
    expect(javascript).toMatch(
      /const half = \(y, (__Show_a)\) => __pair\(1, y, __Show_Int, \1\);/u,
    );
  });

  /**
   * The residue the issue records as defensible rather than as a defect: the
   * rule keys on Part 8's fundamental set, and a user type is not in it, so
   * there is no edition to call and the instance the user wrote reaches the
   * call visibly.
   */
  test("a concrete user type has no edition to reach", () => {
    const javascript = emitted([
      [
        "/point.hex",
        "export record Point = {x: Int}\n" +
          "honor Show<Point> =\n" +
          "    show(value) = \"Point\"\n",
      ],
      [
        "/main.hex",
        'import Point from "./point"\n' +
          "export let answer: String = show(Point({x = 1}))\n",
      ],
    ]);

    expect(javascript).toContain("__Show_Point");
    expect(javascript).not.toContain("showPoint(");
  });

  /**
   * The one fact no importer can read off a scheme, and therefore the one
   * carried on the import: `alias` is constrained, exported, and function-typed,
   * yet mints no editions at all, because the exporter's plan reads the *value*
   * and finds no lambda. Predicting from the scheme emits `import { aliasInt }`
   * beside a module that exports nothing of the kind.
   */
  test("an exported constrained alias mints no edition to call", () => {
    const files = [
      [
        "/alias.hex",
        "export let describe<a: Show>(x: a): String = show(x)\n" +
          "export let alias<a: Show>: (a) -> String = describe\n",
      ],
      [
        "/main.hex",
        'import Alias from "./alias"\nexport let answer: String = Alias.alias(4)\n',
      ],
    ] as const;
    const javascript = emitted(files);

    expect(javascript).toContain("__Show_Int");
    expect(javascript).not.toContain("aliasInt");
    expect(danglingImports(files)).toEqual([]);
  });
});

describe("an edition's public name reaching a module that binds it", () => {
  /**
   * An edition's name is a source-level spelling, unlike every other name the
   * emitter mints, so a module is free to have bound it already. The source's
   * binding keeps the public name and the import moves aside — #425's
   * alias-only-on-collision rule, from the other side.
   */
  test("claims a reserved local, leaving the source's binding alone", () => {
    const javascript = emitted([[
      "/main.hex",
      "let logString(x: String): String = x\n" +
        'Debug.log("direct")\n' +
        'Debug.log(logString("through"))\n',
    ]]);

    expect(javascript).toContain(
      'import { logString as __logString } from "./Debug.js";',
    );
    expect(javascript).toContain("const logString = x => x;");
    expect(javascript).toContain('__logString("direct");');
    expect(javascript).toContain('__logString(logString("through"));');
  });

  test("runs with both names live", async () => {
    const lines = await written(() =>
      runProject(
        [[
          "/main.hex",
          "let logString(x: String): String = x\n" +
            'Debug.log(logString("shadowed"))\n' +
            "export let ok: Int = 1\n",
        ]],
        { transform: distinct("specialized call sites: shadowed edition") },
      )
    );

    expect(lines).toEqual([["shadowed"]]);
  });
});

/**
 * #441, at both halves at once. `Bool` and `Unit` are fundamental by
 * **enumeration** (§15 row 17) rather than by classification, and since #147
 * and #159 neither is a primitive — the prelude union and the arity-0 tuple.
 * Their editions were planned, emitted, exported and `.d.ts`-faced from the
 * start; what was missing was the recognition step both routers share, which
 * read a primitive's name off the evidence and so answered "unknown" for
 * exactly these two. The values need no conversion to route: `True` is `true`
 * (Unions §6.2) and `()` is `undefined`.
 */
describe("the two fundamentals that name no primitive", () => {
  test("a same-module callee reaches its `Bool` and `Unit` editions", () => {
    const javascript = emitted([[
      "/main.hex",
      "export let describe<a: Show>(x: a): String = show(x)\n" +
        "export let ofBool: String = describe(True)\n" +
        "export let ofUnit: String = describe(())\n",
    ]]);

    expect(javascript).toContain("const ofBool = describeBool(true);");
    expect(javascript).toContain("const ofUnit = describeUnit(undefined);");
  });

  test("an imported callee reaches them, and asks for no dictionary", () => {
    const javascript = emitted([["/main.hex", "Debug.log(True)\nDebug.log(())\n"]]);

    expect(javascript).toContain('import { logBool, logUnit } from "./Debug.js";');
    expect(javascript).toContain("logBool(true);");
    expect(javascript).toContain("logUnit(undefined);");
    // The two things the editions replace, and the second is the point the
    // `__Eq_Bool` pins make from the other side: at a routed site no dictionary
    // is built at all, so there is nothing left to name.
    expect(javascript).not.toContain("__log as log");
    expect(javascript).not.toContain('"True" : "False"');
  });

  test("keeps the modules the editions come from in the emitted graph", () => {
    expect(danglingImports([["/main.hex", "Debug.log(True)\nDebug.log(())\n"]])).toEqual([]);
  });

  test("`Bool` is one assignment among several across a boundary", () => {
    const javascript = emitted([
      ["/pair.hex", SHOW_PAIR],
      [
        "/main.hex",
        'import Pair from "./pair"\n' +
          "export let answer: String = Pair.pair(1, True)\n",
      ],
    ]);

    expect(javascript).toContain('import * as Pair from "./pair.js";');
    expect(javascript).toContain(
      'import { __pair, pairIntBool } from "./pair.js";',
    );
    expect(javascript).toContain("const answer = pairIntBool(1, true);");
  });

  test("a variable still in play keeps the dictionary the `Bool` one rode with", () => {
    const javascript = emitted([
      ["/pair.hex", SHOW_PAIR],
      [
        "/main.hex",
        'import Pair from "./pair"\n' +
          "export let half<b: Show>(y: b): String = Pair.pair(True, y)\n",
      ],
    ]);

    // The negative control: recognition is per *variable*, and this site's
    // second one is not ground, so the call keeps the generic edition — with
    // `Show<Bool>`'s dictionary riding along like any other structural one.
    // Since #446 that is its Dictionary Sharing §3.4 binding rather than a
    // literal: `Show<Bool>` has no free component, so a polymorphic body is no
    // obstacle to hoisting it — only a free *component* is (§3.4's second
    // paragraph), and this body's free variable rides the slot beside it.
    // `half`'s own editions are the other side of the same claim: inside
    // `halfInt` both variables are ground, so that body does route.
    expect(javascript).toContain(
      'const __Show_Bool = ({ show: __value => (__value ? "True" : "False") });',
    );
    expect(javascript).toContain(
      "const half = (y, __Show_a) => __pair(true, y, __Show_Bool, __Show_a);",
    );
    expect(javascript).toContain("return pairBoolInt(true, y);");
  });

  test("the editions compute what the generic edition would have", async () => {
    const files = [
      ["/pair.hex", SHOW_PAIR],
      [
        "/main.hex",
        'import Pair from "./pair"\n' +
          "export let answer: String = Pair.pair(True, ())\n",
      ],
    ] as const;

    expect(emitted(files)).toContain(
      "const answer = pairBoolUnit(true, undefined);",
    );
    const exports = await runProject(files, {
      transform: distinct("specialized call sites: Bool and Unit editions"),
    });

    expect(exports["answer"]).toBe("True()");
  });

  /**
   * The edition has to *agree* with the call it replaced, and the `Bool` one did
   * not: its `Show` dictionary reached the interpolation as a primitive's would
   * and rendered the host's `"true"` where every other spelling of the same call
   * says `"True"`. Unreachable while nothing routed, and a wrong answer the
   * moment something did.
   */
  test("the `Bool` edition renders `Show<Bool>`, not the host's boolean", async () => {
    const files = [
      ["/main.hex", "Debug.log(True)\nDebug.log(())\nexport let ok: Int = 1\n"],
    ] as const;

    expect(emitted(files)).toContain("logBool(true);");
    const lines = await written(() =>
      runProject(files, {
        transform: distinct("specialized call sites: Bool and Unit sink"),
      })
    );

    expect(lines).toEqual([["True"], ["()"]]);
  });
});

/**
 * #679's rider, and the last shape §8.2's freedom was dropped at: a constraint
 * some module **declared**, honored at `Bool`.
 *
 * The block above reads `Bool` off *structural* evidence, which is what the four
 * derivable constraints carry there — the #147 pin satisfies them without
 * consulting an instance. A declared constraint has no pin and takes the
 * ordinary instance row, so its evidence at `Bool` is `Instance` evidence: a
 * dictionary name, a union subject, and no primitive for elaboration to stamp.
 * Recognition read a primitive's tag or a structural type and found neither, so
 * `tell(True)` kept the generic edition and its trailing `__Describe_Bool` while
 * `tellBool` sat exported and unread — the freedom taken at five of the six
 * non-`Unit` fundamentals and dropped at the sixth.
 *
 * `Unit` needs no counterpart and gets none: no `honor` can name the empty tuple
 * (Zero-Cost Fundamental Exports §3.2's judgment at `Unit`), so a declared
 * constraint mints no `Unit` edition and there is nothing at such a call site to
 * route to. The last row is that, asserted rather than assumed.
 *
 * Routing only. The rows are paired with the value each call computes, and the
 * boundary rows are row 18's own: any variable still in play, any
 * non-fundamental concrete instantiation, any unexported callee keeps its
 * evidence.
 */
describe("a declared constraint's `Bool` edition", () => {
  const DESCRIBE = [
    "export constraint Describe<a> =",
    "    describe(subject: a): String",
    "",
    "honor Describe<Int> =",
    "    describe(n) = \"int ${n}\"",
    "",
    "honor Describe<Bool> =",
    "    describe(b) = if b then \"yes\" else \"no\"",
    "",
    "export fun tell<a: Describe>(x: a): String = describe(x)",
    "",
  ].join("\n");

  test("a same-module ground call reaches it, with no dictionary left over", () => {
    const javascript = emitted([[
      "/main.hex",
      `${DESCRIBE}export let atBool: String = tell(True)\n`,
    ]]);

    expect(javascript).toContain("const atBool = tellBool(true);");
    // The two things the edition replaces: the generic callee, and the evidence
    // that rode with it. `__Describe_Bool` is still *declared* — it is the
    // instance the module wrote — but nothing passes it any more.
    expect(javascript).not.toContain("tell(true");
  });

  test("the primitive half is unmoved beside it", () => {
    const javascript = emitted([[
      "/main.hex",
      // Annotated, because a literal cannot default under a constraint the
      // defaulting rule does not hold (Numeric Literals §4).
      `${DESCRIBE}let one: Int = 1\nexport let atInt: String = tell(one)\n`,
    ]]);

    // Routed before this rider and routed after, through the primitive tag
    // elaboration stamps rather than through the dictionary lookup.
    expect(javascript).toContain("const atInt = tellInt(one);");
  });

  test("an imported callee reaches it, and its module is emitted", () => {
    const files = [
      ["/describe.hex", DESCRIBE],
      [
        "/main.hex",
        'import Describe from "./describe"\n' +
          "export let atBool: String = Describe.tell(True)\n",
      ],
    ] as const;
    const javascript = emitted(files);

    expect(importLines(javascript)).toContain('import * as Describe from "./describe.js";');
    expect(importLines(javascript)).toContain(
      'import { __tell, tellBool } from "./describe.js";',
    );
    expect(javascript).toContain("const atBool = tellBool(true);");
    expect(danglingImports(files)).toEqual([]);
  });

  test("the edition computes what the generic edition would have", async () => {
    const files = [
      [
        "/main.hex",
        `${DESCRIBE}export let atBool: String = tell(True)\n` +
          "export let atOther: String = tell(False)\n",
      ],
    ] as const;

    expect(emitted(files)).toContain("const atBool = tellBool(true);");
    const exports = await runProject(files, {
      transform: distinct("specialized call sites: declared Bool edition"),
    });

    // The instance's own arms, not the host's boolean and not an empty
    // dictionary's slot — leg 1's repair, read through the routed call.
    expect(exports["atBool"]).toBe("yes");
    expect(exports["atOther"]).toBe("no");
  });

  test("a variable still in play keeps the dictionary", () => {
    const javascript = emitted([[
      "/main.hex",
      `${DESCRIBE}export let held<b: Describe>(y: b): String = tell(y)\n`,
    ]]);

    // Row 18's boundary: recognition is per variable, and this one is not
    // ground, so the call keeps the generic edition and passes the binder's own
    // dictionary through.
    expect(javascript).toMatch(
      /const held = \(y, (__Describe_\w+)\) => tell\(y, \1\);/u,
    );
    // The other side of the same claim: inside `held`'s own editions both
    // variables are ground, so those bodies do route — `Bool` included, which is
    // this rider reaching an edition from inside another edition.
    expect(javascript).toContain("return tellBool(y);");
  });

  test("a nominal subject has no edition to reach", () => {
    const javascript = emitted([[
      "/main.hex",
      `${DESCRIBE}record Point = {x: Int}\n` +
        "honor Describe<Point> =\n" +
        "    describe(p) = \"point\"\n" +
        "export let atPoint: String = tell(Point({x = 1}))\n",
    ]]);

    // The same `Instance` evidence shape as the `Bool` case and a dictionary
    // this module declares — but `Point` is not in Part 8's set, so the lookup
    // answers nothing and the instance reaches the call visibly. The negative
    // control for reading a fundamental off a dictionary name.
    expect(javascript).toContain("__Describe_Point)");
    expect(javascript).not.toContain("tellPoint");
  });

  test("another union is not the pin, and a factory is not a subject", () => {
    const javascript = emitted([[
      "/main.hex",
      `${DESCRIBE}union Colour = Red | Green\n` +
        "honor Describe<Colour> =\n" +
        "    describe(c) = \"colour\"\n" +
        "union Box(a) = Packed(a)\n" +
        "honor<a: Describe> Describe<Box(a)> =\n" +
        "    describe(b) = \"box\"\n" +
        "export let atColour: String = tell(Red)\n" +
        "export let atBox: String = tell(Packed(True))\n",
    ]]);

    // The control the `Point` row cannot be. A record subject declines because
    // it is not a union at all, so it would go on declining however the `Bool`
    // test were written; `Colour` is a union and declines only because the test
    // is the *identity* of the prelude's `Bool`. Loosen that to "any union" and
    // this call becomes `tellBool(Red)` — a clean compile with the wrong
    // dictionary at run time.
    expect(javascript).toContain("const atColour = tell(Red, __Describe_Colour);");

    // And the parameterized instance beside it, which is why no arity test
    // guards the lookup: `Box(a)`'s subject names the factory's own variable, so
    // it is no fundamental and its dictionary is not in the table. Under the
    // same loosening it would be, and `atBox` would route too — so this is the
    // falsifiable form of a guard that could not be given one directly.
    expect(javascript).toContain("const atBox = tell(Packed(true), __Describe_Box_Bool);");
    expect(javascript).not.toContain("tellBool(Red)");
    expect(javascript).not.toContain("tellBool(Packed");
  });

  test("an unexported callee mints nothing, so nothing routes", () => {
    const javascript = emitted([[
      "/main.hex",
      `${DESCRIBE.replace("export fun tell", "fun tell")}` +
        "export let atBool: String = tell(True)\n",
    ]]);

    expect(javascript).not.toContain("tellBool");
    expect(javascript).toContain("__Describe_Bool)");
  });

  test("`Unit` has no counterpart, because the call cannot be written", () => {
    const compiled = compileFiles([[
      "/main.hex",
      `${DESCRIBE}export let atUnit: String = tell(())\n`,
    ]]);

    // Constraints §5.4 refuses `honor Describe<Unit>`, so there is no instance
    // for a ground call at `Unit` to discharge and the checker refuses the call
    // outright. Nothing is left for a router to reach: `candidates(a)` never
    // holds `Unit` (§3.2's judgment at `Unit`), no `tellUnit` is minted, and no
    // legal program reaches a site where one would be wanted.
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "type `Unit` has no `Describe` instance",
    ]);
    const javascript = compiled.modules
      .find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(javascript).not.toContain("tellUnit");
  });
});
