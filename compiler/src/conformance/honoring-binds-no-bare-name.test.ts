import { describe, expect, test } from "vitest";

import { compileProject, type ProjectPackage } from "../project.js";
import * as Source from "../support/source.js";
import { compileFiles, compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * #757 and #1077, as Constraints §4.6–§4.8 and §8, Modules §5.4–§5.5 and §7,
 * and Method Syntax §4.2, §6 and §9 state them:
 *
 * - **Honoring binds no bare name.** A bare member spelling in a module that
 *   honors the constraint reads as it reads in a module that honors nothing —
 *   `show` the prelude's at every type, every other prelude member Modules
 *   §5.5's refusal, a member of another module's constraint an unknown name —
 *   for every form of instance, in member bodies and out of them.
 * - **The claim is unchanged, and its report tells the truth** about a
 *   spelling no line of the block writes (Constraints §8's three forms).
 * - **The dot refusal names only spellings the next compile accepts**
 *   (Method Syntax §6): a companion through its module, a member through its
 *   declaring module by this module's alias, the import first where it holds
 *   none, and a claimant with no spelling named as fact.
 * - **An instance is visible where a module's imports reach it** (Modules
 *   §7.1), so one dot call is accepted in one module and refused in another.
 */

const MAIN = "module Main\n\n";

/** Modules §5.5's refusal for a two-argument member, in the program's own words. */
const noBare = (member: string, left: string, right: string, receiver = left): string =>
  `no bare \`${member}\`; write \`${receiver}.${member}(${right})\` or \`Ord.${member}(${left}, ${right})\``;

/**
 * The same refusal at `max` and `min`, whose spelling the collection companions
 * export too, so every exporter is named — content this ruling leaves alone.
 */
const noBareCollected = (member: string, left: string, right: string): string =>
  `no bare \`${member}\`; write \`${left}.${member}(${right})\`, ` +
  ["Ord", "Seq", "Vector", "Map"].map((home) => `\`${home}.${member}(${left}, ${right})\``).join(", ") +
  `, or \`Set.${member}(${left}, ${right})\``;

/**
 * The three forms of a prelude-constraint instance, each at `Box`. `Eq` is
 * derived alongside, being `Ord`'s base.
 */
const ORD_FORMS = {
  "a hand-written block": "record Box derives (Eq) = {n: Int}\n\n" +
    "honor Ord<Box> =\n    compare(left, right) = left.n.compare(right.n)\n\n",
  "a `derives` clause": "record Box derives (Eq, Ord) = {n: Int}\n\n",
  "`honor C<T> = derive`": "record Box derives (Eq) = {n: Int}\n\nhonor Ord<Box> = derive\n\n",
} as const;

describe("a bare member spelling in an honoring module (Constraints §4.6, #757)", () => {
  describe.each(Object.entries(ORD_FORMS))("at a prelude constraint, honored by %s", (_, honoring) => {
    test("at the honored type, it is Modules §5.5's refusal", () => {
      expect(projectDiagnostics(MAIN + honoring +
        "export let o: Ordering = compare(Box({n = 1}), Box({n = 2}))\n")).toEqual([
        noBare("compare", "Box({n = 1})", "Box({n = 2})"),
      ]);
    });

    test("at another type, it is the same refusal", () => {
      expect(projectDiagnostics(MAIN + honoring + "export let o: Ordering = compare(1, 2)\n")).toEqual([
        noBare("compare", "1", "2", "(1)"),
      ]);
    });

    test("an unwritten default's spelling is the same refusal", () => {
      expect(projectDiagnostics(MAIN + honoring +
        "export let m: Box = max(Box({n = 1}), Box({n = 2}))\n")).toEqual([
        noBareCollected("max", "Box({n = 1})", "Box({n = 2})"),
      ]);
    });

    test("the routes the refusal names run, at the module's own instance", async () => {
      const exports = await runMain(MAIN + honoring +
        "export let dotted: Int = Box({n = 1}).max(Box({n = 2})).n\n" +
        "export let qualified: Int = Ord.min(Box({n = 1}), Box({n = 2})).n\n" +
        "export let compared: Bool = Ord.compare(Box({n = 3}), Box({n = 2})) == Ordering.Greater\n" +
        "export let elsewhere: Bool = (1).compare(2) == Ordering.Less\n");
      expect([exports.dotted, exports.qualified, exports.compared, exports.elsewhere])
        .toEqual([2, 1, true, true]);
    });
  });

  describe("inside a hand-written block", () => {
    test("the member's own spelling in its body is the refusal, not an own-name rule", () => {
      expect(projectDiagnostics(MAIN + "record Box derives (Eq) = {n: Int}\n\n" +
        "honor Ord<Box> =\n    compare(left, right) = compare(left.n, right.n)\n")).toEqual([
        noBare("compare", "left.n", "right.n"),
      ]);
    });

    test("a sibling's spelling, written or inherited, is the refusal", () => {
      expect(projectDiagnostics(MAIN + "record Box derives (Eq) = {n: Int}\n\n" +
        "honor Ord<Box> =\n" +
        "    compare(left, right) = left.n.compare(right.n)\n" +
        "    max(left, right) = if compare(left, right) == Ordering.Greater then left else right\n" +
        "    min(left, right) = if max(left, right).n == left.n then right else left\n")).toEqual([
        noBare("compare", "left", "right"),
        noBareCollected("max", "left", "right"),
      ]);
    });

    test("its rewrites run", async () => {
      const exports = await runMain(MAIN + "record Box derives (Eq) = {n: Int}\n\n" +
        "honor Ord<Box> =\n" +
        "    compare(left, right) = Ord.compare(left.n, right.n)\n" +
        "    max(left, right) = if left.compare(right) == Ordering.Greater then left else right\n\n" +
        "export let biggest: Int = Box({n = 4}).max(Box({n = 9})).n\n");
      expect(exports.biggest).toBe(9);
    });

    test("a binder in the body may not take the member's spelling (Statements §9.3)", () => {
      expect(projectDiagnostics(MAIN + "record Box derives (Eq) = {n: Int}\n\n" +
        "honor Ord<Box> =\n" +
        "    compare(left, right) =\n" +
        "        let compare = left.n.compare(right.n)\n" +
        "        compare\n")).toEqual([
        "`compare` is already being defined by the enclosing member definition (line 6); " +
          "Hexagon does not allow rebinding — choose a different name",
      ]);
    });
  });

  describe("at a constraint another module declares", () => {
    const LIB = ["/lib.hex", "module Lib\n\n" +
      "export constraint Sized<c> =\n" +
      "    heft(x: c) -> Int\n" +
      "    trim(x: c) -> Int\n" +
      "    twice(x: c) -> Int = heft(x) + heft(x)\n"] as const;
    const honor = (body: string, below = ""): readonly (readonly [string, string])[] => [
      LIB,
      ["/main.hex", MAIN + "import Lib\n\nexport record Box = {n: Int}\n\n" +
        `honor Lib.Sized<Box> =\n${body}\n${below}`],
    ];
    const messages = (files: readonly (readonly [string, string])[]): readonly string[] =>
      compileFiles(files).diagnostics.map(({ message }) => message);

    test("every bare spelling is in no scope: an unknown name, in a body and out of one", () => {
      expect(messages(honor(
        "    heft(b) = if b.n > 0 then heft(Box({n = b.n - 1})) + 1 else 0\n" +
          "    trim(b) = heft(b)\n",
        "export let a: Int = heft(Box({n = 1}))\n" +
          "export let b: Int = twice(Box({n = 1}))\n" +
          "export let c: Int = heft(3)\n",
      ))).toEqual([
        "unknown name `heft`",
        "unknown name `heft`",
        "unknown name `heft`",
        "unknown name `twice`",
        "unknown name `heft`",
      ]);
    });

    test("the member is reached by the dot and through its declaring module", async () => {
      const exports = await runProject(honor(
        "    heft(b) = b.n\n    trim(b) = Lib.heft(b) - 1\n",
        "export let dotted: Int = Box({n = 5}).twice()\n" +
          "export let qualified: Int = Lib.trim(Box({n = 5}))\n",
      ));
      expect([exports.dotted, exports.qualified]).toEqual([10, 4]);
    });
  });

  describe("`show`, the prelude's bare member, at every type", () => {
    const SHOW_FORMS = {
      "a hand-written block": "record Box = {n: Int}\n\nhonor Show<Box> =\n    show(box) = \"Box${box.n}\"\n\n",
      "a `derives` clause": "record Box derives (Show) = {n: Int}\n\n",
      "`honor C<T> = derive`": "record Box = {n: Int}\n\nhonor Show<Box> = derive\n\n",
    } as const;

    test.each(Object.entries(SHOW_FORMS))(
      "honored by %s: at the honored type, another type, and a type variable",
      async (form, honoring) => {
        const exports = await runMain(MAIN + honoring +
          "fun shown<a: Show>(value: a): String = show(value)\n\n" +
          "export let own: String = show(Box({n = 1}))\n" +
          "export let other: String = show(42)\n" +
          "export let generic: String = shown(Box({n = 2}))\n");
        // A derived `Show` renders a record's fields (Products §2.5).
        const box = form === "a hand-written block" ? (n: number) => `Box${n}` : (n: number) => `{n = ${n}}`;
        expect([exports.own, exports.other, exports.generic]).toEqual([box(1), "42", box(2)]);
      },
    );

    test("inside its own body it is the prelude's, selecting by the argument's type", async () => {
      const exports = await runMain(MAIN + "record Box = {n: Int}\n\n" +
        "honor Show<Box> =\n    show(box) = \"<\" ++ show(box.n) ++ \">\"\n\n" +
        "export let s: String = show(Box({n = 7}))\n");
      expect(exports.s).toBe("<7>");
    });

    test("two `Show` types in one module leave bare `show` usable at both", async () => {
      const exports = await runMain(MAIN +
        "record Box derives (Show) = {n: Int}\n" +
        "union Tag derives (Show) = Red | Blue\n\n" +
        "export let s: String = show(Box({n = 1})) ++ \" \" ++ show(Blue)\n");
      expect(exports.s).toBe("{n = 1} Blue");
    });
  });

  describe("what stays the module's own", () => {
    test("a local `let compare` inside a function is an ordinary local", async () => {
      const exports = await runMain(MAIN + "record Box derives (Eq) = {n: Int}\n\n" +
        "honor Ord<Box> =\n    compare(left, right) = left.n.compare(right.n)\n\n" +
        "export fun pick(a: Int, b: Int): Int =\n" +
        "    let compare = a - b\n" +
        "    if compare > 0 then a else b\n\n" +
        "export let picked: Int = pick(3, 8)\n");
      expect(exports.picked).toBe(8);
    });

    test("the declaring module keeps its members bare, a sibling's in a block included", async () => {
      const exports = await runMain(MAIN +
        "export constraint Describe<a> =\n" +
        "    describe(value: a) -> String\n" +
        "    label(value: a) -> String\n\n" +
        "export record Metre = {span: Int}\n\n" +
        "honor Describe<Metre> =\n" +
        "    describe(value) = \"${value.span}m\"\n" +
        "    label(value) = \"[\" ++ describe(value) ++ \"]\"\n\n" +
        "export let rendered: String = label(Metre({span = 5}))\n");
      expect(exports.rendered).toBe("[5m]");
    });

    test("a `widens` binding is bare in its module, monomorphic, as before", async () => {
      const files = [
        ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    tag(s: a, n: Int) -> String\n"],
        ["/main.hex", MAIN + "import Lib\n\nexport record P = { name: String }\n" +
          "widens Lib.tag(s: P, n: BigInt): String = s.name ++ BigInt.show(n)\n" +
          "honor Lib.R<P> =\n    tag = widened\n" +
          "export let wide: String = tag(P({name = \"p\"}), 20n)\n" +
          "export let member: String = Lib.tag(P({name = \"q\"}), 3)\n"],
      ] as const;
      expect(compileFiles(files).diagnostics).toEqual([]);
      const exports = await runProject(files);
      expect([exports.wide, exports.member]).toEqual(["p20", "q3"]);
      // Monomorphic: at another type the bare spelling is still the binding at
      // `P`, never a member call that would select an instance at `Int`.
      expect(compileFiles([files[0], [files[1][0], files[1][1] + "export let bad: String = tag(3, 2n)\n"]])
        .diagnostics.map(({ message }) => message)).toEqual([
        "no `Num<P>` instance is visible in this module; it could only be declared in module `Main` (declares `P`) " +
          "or the module declaring `Num`",
      ]);
    });
  });
});

describe("the claim's report says how the instance holds the spelling (Constraints §8, #757)", () => {
  const REBIND = "Hexagon does not allow rebinding — choose a different name";
  /** The one report, its primary line, and the line its label cites. */
  const report = (source: string) => {
    const diagnostics = compileMain(MAIN + source).diagnostics;
    return diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      at: diagnostic.primary.start.line + 1,
      cites: diagnostic.labels?.map(({ span }) => span.start.line + 1),
    }));
  };

  test("a member the block writes: the honor's line", () => {
    for (const binding of ["let", "export let"]) {
      expect(report("export record Box derives (Eq) = {n: Int}\n\n" +
        "honor Ord<Box> =\n    compare(left, right) = left.n.compare(right.n)\n    max(left, right) = left\n\n" +
        `${binding} max(a: Box, b: Box): Box = a\n`)).toEqual([{
        message: `\`max\` is already bound: the \`Ord<Box>\` instance binds it as a member (line 5); ${REBIND}`,
        at: 9,
        cites: [5],
      }]);
    }
  });

  test("a member a hand-written block inherits from the default: the honor's line, and the default", () => {
    for (const binding of ["let", "export let"]) {
      expect(report(`${binding} max(a: Int, b: Int): Int = a\n\nexport record Box derives (Eq) = {n: Int}\n\n` +
        "honor Ord<Box> =\n    compare(left, right) = left.n.compare(right.n)\n")).toEqual([{
        message: "`max` is already bound: the `Ord<Box>` instance (line 7) inherits it as a member " +
          `from \`Ord\`'s default; ${REBIND}`,
        at: 3,
        cites: [7],
      }]);
    }
  });

  test("a derived instance's members, supplied and inherited: the line that derives it", () => {
    expect(report("export record Box derives (Eq, Ord) = {n: Int}\n\n" +
      "let compare(a: Box, b: Box): Ordering = Ordering.Equal\n" +
      "export let min(a: Box, b: Box): Box = a\n")).toEqual([
      {
        message: `\`compare\` is already bound: the derived \`Ord<Box>\` instance (line 3) binds it as a member; ${REBIND}`,
        at: 5,
        cites: [3],
      },
      {
        message: "`min` is already bound: the derived `Ord<Box>` instance (line 3) inherits it as a member " +
          `from \`Ord\`'s default; ${REBIND}`,
        at: 6,
        cites: [3],
      },
    ]);
    expect(report("export record Box = {n: Int}\n\nhonor Eq<Box> = derive\n\n" +
      "let notEquals(a: Box, b: Box): Bool = False\nlet equals(a: Box, b: Box): Bool = True\n")).toEqual([
      {
        message: "`notEquals` is already bound: the derived `Eq<Box>` instance (line 5) inherits it as a " +
          `member from \`Eq\`'s default; ${REBIND}`,
        at: 7,
        cites: [5],
      },
      {
        message: `\`equals\` is already bound: the derived \`Eq<Box>\` instance (line 5) binds it as a member; ${REBIND}`,
        at: 8,
        cites: [5],
      },
    ]);
  });

  test("a declaration over several lines: the line the label points at, the `derives` entry's", () => {
    expect(report("export record Box derives (\n    Eq,\n    Ord\n) = {n: Int}\n\n" +
      "let compare(a: Int, b: Int): Int = a\n")).toEqual([{
      message: `\`compare\` is already bound: the derived \`Ord<Box>\` instance (line 5) binds it as a member; ${REBIND}`,
      at: 8,
      cites: [5],
    }]);
    expect(report("export union Shape\n    derives (Eq, Ord) =\n    | Circle\n    | Square\n\n" +
      "let max(a: Int, b: Int): Int = a\n")).toEqual([{
      message: "`max` is already bound: the derived `Ord<Shape>` instance (line 4) inherits it as a member " +
        `from \`Ord\`'s default; ${REBIND}`,
      at: 8,
      cites: [4],
    }]);
    // A hand-written block's report cites its `honor` line, as its label does.
    expect(report("export record Box derives (Eq) = {n: Int}\n\n\nhonor Ord<Box> =\n" +
      "    compare(left, right) = left.n.compare(right.n)\n\nlet compare(a: Int, b: Int): Int = a\n")).toEqual([{
      message: `\`compare\` is already bound: the \`Ord<Box>\` instance binds it as a member (line 6); ${REBIND}`,
      at: 9,
      cites: [6],
    }]);
  });

  test("several instances claiming one spelling: one report at the binding, the first instance's", () => {
    // `Ord<A>` inherits `max`, `Ord<B>` writes it; the binding is one cause.
    for (const binding of ["let", "export let"]) {
      expect(report("export record A derives (Eq) = {n: Int}\nexport record B derives (Eq) = {n: Int}\n\n" +
        "honor Ord<A> =\n    compare(l, r) = l.n.compare(r.n)\n\n" +
        "honor Ord<B> =\n    compare(l, r) = l.n.compare(r.n)\n    max(l, r) = l\n\n" +
        `${binding} max(a: Int, b: Int): Int = a\n`)).toEqual([{
        message: "`max` is already bound: the `Ord<A>` instance (line 6) inherits it as a member " +
          `from \`Ord\`'s default; ${REBIND}`,
        at: 13,
        cites: [6],
      }]);
    }
    // Derived and written alike: the first in source order is named.
    expect(report("export record Box derives (Eq, Ord) = {n: Int}\n\n" +
      "export union Shape derives (Eq, Ord) = Circle | Square\n\n" +
      "let max(a: Int, b: Int): Int = a\n")).toEqual([{
      message: "`max` is already bound: the derived `Ord<Box>` instance (line 3) inherits it as a member " +
        `from \`Ord\`'s default; ${REBIND}`,
      at: 7,
      cites: [3],
    }]);
  });

  test("the repair each report offers compiles: the binding renamed", () => {
    expect(projectDiagnostics(MAIN + "export record Box derives (Eq, Ord) = {n: Int}\n\n" +
      "let larger(a: Box, b: Box): Box = a\nexport let ordering(a: Box, b: Box): Ordering = Ordering.Equal\n"))
      .toEqual([]);
  });
});

describe("the dot refusal names only writable spellings (Method Syntax §6, #1077, #1085)", () => {
  const LIB = ["/lib.hex", "module Lib\n\n" +
    "export constraint Sized<c> =\n" +
    "    heft(x: c) -> String\n" +
    "    trim(x: c) -> String\n\n" +
    "honor Sized<String> =\n" +
    "    heft(v) = \"heft\"\n" +
    "    trim(v) = \"lib-trim\"\n"] as const;
  const MID = ["/mid.hex", "module Mid\n\nimport Lib\n\nexport let n: Int = 1\n"] as const;
  const messages = (files: readonly (readonly [string, string])[]): readonly string[] =>
    compileFiles(files).diagnostics.map(({ message }) => message);
  const ambiguous = (member: string): string =>
    "`trim` after a dot is ambiguous at `String`: a companion operation `String.trim`, " +
    `\`Sized\`'s member \`trim\`; write ${member}, or \`String.trim(…)\` for the companion operation`;

  test("a companion at a built-in collection is named through its module, never the type's display (#1085)", async () => {
    const program = (use: string) => MAIN +
      "export constraint Sized<t> =\n    length(x: t) -> Int\n\n" +
      "honor Sized<Vector(a)> =\n    length(x) = 7\n\n" + use;
    expect(projectDiagnostics(program("export let a: Int = [1, 2].length()\n"))).toEqual([
      "`length` after a dot is ambiguous at `Vector(a)`: a companion operation `Vector.length`, " +
        "`Sized`'s member `length`; write `length(…)`, or `Vector.length(…)` for the companion operation",
    ]);
    // Both offers, pasted back: the claimant declared here keeps the bare
    // spelling, and the companion is its module's.
    const exports = await runMain(program("export let mine: Int = length([1, 2])\nexport let its: Int = Vector.length([1, 2])\n"));
    expect([exports.mine, exports.its]).toEqual([7, 2]);
  });

  test("a member is named through its declaring module, by this module's alias", () => {
    expect(messages([LIB, ["/main.hex", MAIN + "import Lib\n\nexport let t: String = \"ab\".trim()\n"]]))
      .toEqual([ambiguous("`Lib.trim(…)`")]);
    expect(messages([LIB, ["/main.hex", MAIN + "import Lib as L\n\nexport let t: String = \"ab\".trim()\n"]]))
      .toEqual([ambiguous("`L.trim(…)`")]);
  });

  test("with no alias for the declaring module, the import is named first", () => {
    expect(messages([LIB, MID, ["/main.hex", MAIN + "import Mid\n\nexport let t: String = \"ab\".trim()\n"]]))
      .toEqual([ambiguous("`import Lib`, then `Lib.trim(…)`")]);
  });

  test("every spelling offered compiles, and means its claimant", async () => {
    const exports = await runProject([LIB, MID, ["/main.hex", MAIN + "import Mid\nimport Lib\nimport Lib as L\n\n" +
      "export let member: String = Lib.trim(\"ab\")\n" +
      "export let aliased: String = L.trim(\"ab\")\n" +
      "export let companion: String = String.trim(\" ab \")\n"]]);
    expect([exports.member, exports.aliased, exports.companion]).toEqual(["lib-trim", "lib-trim", "ab"]);
  });

  test("a member of a constraint its module does not export is named as fact, and offered no spelling", async () => {
    const PRIVATE = ["/lib.hex", LIB[1].replace("export constraint", "constraint") + "\nexport let k: Int = 1\n"] as const;
    expect(messages([PRIVATE, ["/main.hex", MAIN + "import Lib\n\nexport let t: String = \"ab\".trim()\n"]])).toEqual([
      "`trim` after a dot is ambiguous at `String`: a companion operation `String.trim`, `Sized`'s member " +
        "`trim`, declared in module `Lib`, which does not export `Sized`; write `String.trim(…)` for the " +
        "companion operation",
    ]);
    // The spelling it withholds is indeed none: `Lib.trim` does not resolve.
    expect(messages([PRIVATE, ["/main.hex", MAIN + "import Lib\n\nexport let t: String = Lib.trim(\"ab\")\n"]]))
      .not.toEqual([]);
    const exports = await runProject([PRIVATE, ["/main.hex", MAIN + "import Lib\n\nexport let t: String = String.trim(\" ab \")\n"]]);
    expect(exports.t).toBe("ab");
  });

  test("a companion whose module's name a user alias shadows is reached through a fresh alias", async () => {
    // `String` here is `Lib`, so `String.trim` would be the member: the
    // companion is offered through an alias the import binds.
    expect(messages([LIB, ["/main.hex", MAIN + "import Lib\nimport Lib as String\n\nexport let t: String = \"ab\".trim()\n"]]))
      .toEqual([
        "`trim` after a dot is ambiguous at `String`: a companion operation `String_1.trim`, `Sized`'s member " +
          "`trim`; write `Lib.trim(…)`, or `import String as String_1`, then `String_1.trim(…)` for the companion operation",
      ]);
    const exports = await runProject([LIB, ["/main.hex", MAIN + "import Lib\nimport Lib as String\nimport String as String_1\n\n" +
      "export let companion: String = String_1.trim(\" ab \")\nexport let shadowed: String = String.trim(\" ab \")\n"]]);
    expect([exports.companion, exports.shadowed]).toEqual(["ab", "lib-trim"]);
  });
});

describe("an instance is visible where the module's imports reach it (Modules §7.1, §7.6)", () => {
  const LIB = ["/lib.hex", "module Lib\n\n" +
    "export constraint Sized<c> =\n" +
    "    heft(x: c) -> String\n" +
    "    trim(x: c) -> String\n\n" +
    "honor Sized<String> =\n" +
    "    heft(v) = \"heft\"\n" +
    "    trim(v) = \"lib-trim\"\n"] as const;
  const MID = ["/mid.hex", "module Mid\n\nimport Lib\n\nexport let n: Int = 1\n"] as const;
  const MODULES = {
    direct: [LIB, ["/main.hex", MAIN + "import Lib\n\n"]],
    transitive: [LIB, MID, ["/main.hex", MAIN + "import Mid\n\n"]],
    unreached: [LIB, ["/main.hex", MAIN]],
  } as const;
  const program = (reach: keyof typeof MODULES, line: string) =>
    MODULES[reach].map(([path, text]) => [path, path === "/main.hex" ? text + line : text] as const);
  const messages = (files: readonly (readonly [string, string])[]): readonly string[] =>
    compileFiles(files).diagnostics.map(({ message }) => message);

  test("a member-only dot call: accepted directly and transitively, refused unreached", async () => {
    for (const reach of ["direct", "transitive"] as const) {
      const exports = await runProject(program(reach, "export let h: String = \"ab\".heft()\n"));
      expect(exports.h).toBe("heft");
    }
    expect(messages(program("unreached", "export let h: String = \"ab\".heft()\n"))).toEqual([
      "`String` has no field `heft`, its companion exports no operation `heft`, and no constraint whose " +
        "instance at `String` is visible in this module has a subject-first member `heft`; call an " +
        "available subject-first function explicitly",
    ]);
  });

  test("a spelling `String.hex` also exports: refused where both reach, `String`'s where only it does", async () => {
    for (const reach of ["direct", "transitive"] as const) {
      expect(messages(program(reach, "export let t: String = \" ab \".trim()\n"))[0])
        .toMatch(/^`trim` after a dot is ambiguous at `String`: /u);
    }
    const exports = await runProject(program("unreached", "export let t: String = \" ab \".trim()\n"));
    expect(exports.t).toBe("ab");
  });
});

describe("every claimant of a dot refusal is named, with a spelling or as fact (Method Syntax §6, §9 rows 4–6)", () => {
  const messages = (files: readonly (readonly [string, string])[]): readonly string[] =>
    compileFiles(files).diagnostics.map(({ message }) => message);

  describe("on a declared type variable, as at a known head", () => {
    /** Two bounds, each reaching a base constraint with a member `heft`. */
    const program = (exportP1: boolean, exportP2: boolean, body = "x.heft()") => [
      ["/x.hex", "module X\n\n" + (exportP1 ? "export " : "") + "constraint P1<c> =\n    heft(x: c) -> String\n\n" +
        "export constraint B1<a: P1> =\n    one(x: a) -> Int\n"],
      ["/y.hex", "module Y\n\n" + (exportP2 ? "export " : "") + "constraint P2<c> =\n    heft(x: c) -> String\n\n" +
        "export constraint B2<a: P2> =\n    two(x: a) -> Int\n"],
      ["/main.hex", MAIN + "import X\nimport Y\n\n" + `export fun f<a: (X.B1, Y.B2)>(x: a): String = ${body}\n`],
    ] as const;

    test("a claimant with no spelling is named as fact, and the others' spellings offered", () => {
      expect(messages(program(false, true))).toEqual([
        "`heft` after a dot is ambiguous on `a`: `P1`'s member `heft`, declared in module `X`, which does not " +
          "export `P1`, `P2`'s member `heft`; write `Y.heft(…)`",
      ]);
      // The offer, pasted back, compiles.
      expect(messages(program(false, true, "Y.heft(x)"))).toEqual([]);
    });

    test("where none has a spelling, the refusal says so and offers none", () => {
      expect(messages(program(false, false))).toEqual([
        "`heft` after a dot is ambiguous on `a`: `P1`'s member `heft`, declared in module `X`, which does not " +
          "export `P1`, `P2`'s member `heft`, declared in module `Y`, which does not export `P2`; " +
          "none of them has a spelling this module can write",
      ]);
    });
  });

  test("at a known head, where none has a spelling, the refusal says so and offers none", () => {
    const module = (name: string, constraint: string) => [`/${name.toLowerCase()}.hex`, `module ${name}\n\n` +
      `constraint ${constraint}<c> =\n    heft(x: c) -> String\n\n` +
      `honor ${constraint}<String> =\n    heft(v) = "${name}"\n\nexport let k: Int = 1\n`] as const;
    expect(messages([module("X", "P1"), module("Y", "P2"),
      ["/main.hex", MAIN + "import X\nimport Y\n\nexport let h: String = \"ab\".heft()\n"]])).toEqual([
      "`heft` after a dot is ambiguous at `String`: `P1`'s member `heft`, declared in module `X`, which does " +
        "not export `P1`, `P2`'s member `heft`, declared in module `Y`, which does not export `P2`; " +
        "none of them has a spelling this module can write",
    ]);
  });

  /**
   * Packages §3.1's visible set: a member whose instance reaches this module
   * through a dependency's own dependency is visible here, and its declaring
   * module is one this package cannot import.
   */
  describe("a claimant whose module lies outside the package's visible set", () => {
    const LIB_TEXT = "module Lib\n\nexport constraint Sized<c> =\n    trim(x: c) -> String\n\n" +
      "honor Sized<String> =\n    trim(v) = \"lib-trim\"\n";
    const NEAR_TEXT = "module Near\n\nimport Lib\n\nexport let n: Int = 1\n";
    // Ids clear of the project's own files, which `compileFiles` numbers from 0.
    let id = 100;
    const file = (path: string, text: string) => new Source.File(Source.fileId(id++), path, text);
    const pkg = (name: string, dependencies: readonly string[], files: readonly Source.File[]): ProjectPackage => ({
      record: { name, dependencies, installed: new Set(dependencies) },
      files,
    });
    const compile = (main: string, packages: readonly ProjectPackage[]) =>
      compileProject([new Source.File(Source.fileId(0), "/work/app/main.hex", main)], {
        dependencies: ["Acme"],
        installed: new Set(["Acme", "Bolt"]),
        packages,
      }).diagnostics.map(({ message }) => message);

    test("is named as fact, with its module, which this module cannot import", () => {
      expect(compile(MAIN + "import Near\n\nexport let t: String = \"ab\".trim()\n", [
        pkg("Acme", ["Bolt"], [file("/work/app/node_modules/acme/near.hex", NEAR_TEXT)]),
        pkg("Bolt", [], [file("/work/app/node_modules/bolt/lib.hex", LIB_TEXT)]),
      ])).toEqual([
        "`trim` after a dot is ambiguous at `String`: a companion operation `String.trim`, `Sized`'s member " +
          "`trim`, declared in module `Bolt.Lib`, which this module cannot import; write `String.trim(…)` " +
          "for the companion operation",
      ]);
    });

    test("one the package may import is offered by the import that resolves to it from here", async () => {
      const packages = [pkg("Acme", [], [
        file("/work/app/node_modules/acme/near.hex", NEAR_TEXT),
        file("/work/app/node_modules/acme/lib.hex", LIB_TEXT),
      ])];
      expect(compile(MAIN + "import Acme.Near\n\nexport let t: String = \"ab\".trim()\n", packages)).toEqual([
        "`trim` after a dot is ambiguous at `String`: a companion operation `String.trim`, `Sized`'s member " +
          "`trim`; write `import Acme.Lib`, then `Lib.trim(…)`, or `String.trim(…)` for the companion operation",
      ]);
      const exports = await runProject([["/work/app/main.hex", MAIN + "import Acme.Near\nimport Acme.Lib\n\n" +
        "export let t: String = Lib.trim(\"ab\")\n"]], {
        dependencies: ["Acme"],
        installed: new Set(["Acme"]),
        packages,
      });
      expect(exports.t).toBe("lib-trim");
    });
  });

  /**
   * A companion operation declared in another user module is spelled through
   * that module — never bare, which only a claimant declared in the calling
   * module may be (`Crate.size`, not `size`).
   */
  describe("a user module's companion beside a visible member", () => {
    const CRATE = ["/crate.hex", "module Crate\n\nexport record Crate = {n: Int}\n" +
      "export let size(c: Crate): Int = c.n\nexport let mk(n: Int): Crate = Crate({n = n})\n"] as const;
    const WEIGH = ["/weigh.hex", "module Weigh\n\nimport Crate\n\nexport constraint Weigh<c> =\n" +
      "    size(x: c) -> Int\n\nhonor Weigh<Crate.Crate> =\n    size(c) = 1000\n"] as const;
    const MID = ["/mid.hex", "module Mid\n\nimport Crate\nimport Weigh\n\n" +
      "export let crate: Crate.Crate = Crate.mk(4)\n"] as const;
    const program = (imports: string, line: string) =>
      [CRATE, WEIGH, MID, ["/main.hex", MAIN + `import Mid\n${imports}\n${line}`]] as const;
    const head = (companion: string) => `\`size\` after a dot is ambiguous at \`Crate\`: a companion operation ` +
      `\`${companion}.size\`, \`Weigh\`'s member \`size\`; write `;

    test("with no alias for either module, each import is named first", () => {
      expect(messages(program("", "export let u: Int = Mid.crate.size()\n"))).toEqual([
        head("Crate") + "`import Weigh`, then `Weigh.size(…)`, or `import Crate`, then `Crate.size(…)` for the " +
          "companion operation",
      ]);
    });

    test("with an alias held for each, the aliases", () => {
      expect(messages(program("import Weigh as W\nimport Crate as C\n", "export let u: Int = Mid.crate.size()\n")))
        .toEqual([head("C") + "`W.size(…)`, or `C.size(…)` for the companion operation"]);
    });

    test("every spelling offered compiles, and means its claimant", async () => {
      const imported = await runProject(program("import Weigh\nimport Crate\n",
        "export let member: Int = Weigh.size(Mid.crate)\nexport let companion: Int = Crate.size(Mid.crate)\n"));
      expect([imported.member, imported.companion]).toEqual([1000, 4]);
      const aliased = await runProject(program("import Weigh as W\nimport Crate as C\n",
        "export let member: Int = W.size(Mid.crate)\nexport let companion: Int = C.size(Mid.crate)\n"));
      expect([aliased.member, aliased.companion]).toEqual([1000, 4]);
    });
  });

  /**
   * The binding a member's spelling refuses is that refusal's cause, and the
   * dot names it no second time — which would offer the same spelling twice,
   * once for the member and once for the binding (Constraints §4.6).
   */
  describe("a companion binding the module already refused is no claimant at the dot", () => {
    test("one an instance honored here claims: the claim's report, alone", () => {
      const LIB = ["/lib.hex", "module Lib\n\nexport constraint Sized<c> =\n    size(x: c) -> Int\n"] as const;
      for (const binding of ["let", "fun"]) {
        expect(messages([LIB, ["/main.hex", MAIN + "import Lib\n\nexport record Box = {n: Int}\n" +
          `export ${binding} size(b: Box): Int = b.n\n\nhonor Lib.Sized<Box> =\n    size(b) = 7\n\n` +
          "export let r: Int = Box({n = 1}).size()\n"]])).toEqual([
          "`size` is already bound: the `Lib.Sized<Box>` instance binds it as a member (line 8); " +
            "Hexagon does not allow rebinding — choose a different name",
        ]);
      }
    });

    test("one a constraint declared here binds: the rebinding report, alone", () => {
      expect(projectDiagnostics(MAIN + "export constraint Sized<c> =\n    size(x: c) -> Int\n\n" +
        "export record Box = {n: Int}\nexport let size(b: Box): Int = b.n\n\n" +
        "honor Sized<Box> =\n    size(b) = 7\n\nexport let r: Int = Box({n = 1}).size()\n")).toEqual([
        "`size` is already bound (line 4); Hexagon does not allow rebinding — choose a different name",
      ]);
    });
  });

  test("a prelude alias a module alias shadows is no spelling: the import is named first", async () => {
    const LIB = ["/lib.hex", "module Lib\n\nexport let k: Int = 1\n"] as const;
    expect(messages([LIB, ["/main.hex", MAIN + "import Lib as Ord\n\n" +
      "export record Box derives (Eq, Ord) = {max: Int}\n" +
      "export let r: Box = Box({max = 1}).max(Box({max = 2}))\n"]])).toEqual([
      "`max` after a dot is ambiguous at `Box`: a field `max`, `Ord`'s member `max`; write " +
        "`import Ord as Ord_1`, then `Ord_1.max(…)`, or `(…​.max)` for the field",
    ]);
    const exports = await runProject([LIB, ["/main.hex", MAIN + "import Lib as Ord\nimport Ord as Ord_1\n\n" +
      "export record Box derives (Eq, Ord) = {max: Int}\n" +
      "export let r: Int = Ord_1.max(Box({max = 1}), Box({max = 2})).max\n"]]);
    expect(exports.r).toBe(2);
  });

  describe("an offer that needs its import says to add it, then call (Method Syntax §9 rows 5, 8)", () => {
    const LIB = ["/lib.hex", "module Lib\n\nexport constraint Sized<c> =\n    heft(x: c) -> String\n" +
      "    make(n: Int) -> c\n\nhonor Sized<String> =\n    heft(v) = \"heft\"\n    make(n) = \"made\"\n"] as const;
    const MID = ["/mid.hex", "module Mid\n\nimport Lib\n\nexport let n: Int = 1\n"] as const;

    test("the near-miss: `add`, `then call`; with the alias held, `call it as`", async () => {
      const tail = "`String` has no field `make`, its companion exports no operation `make`, and no constraint " +
        "whose instance at `String` is visible in this module has a subject-first member `make`; `Sized`'s " +
        "member `make` does not take its constraint's subject first — ";
      expect(messages([LIB, MID, ["/main.hex", MAIN + "import Mid\n\nexport let t: String = \"ab\".make()\n"]]))
        .toEqual([tail + "add `import Lib`, then call `Lib.make(…)`"]);
      expect(messages([LIB, ["/main.hex", MAIN + "import Lib\n\nexport let t: String = \"ab\".make()\n"]]))
        .toEqual([tail + "call it as `Lib.make(…)`"]);
      const exports = await runProject([LIB, MID, ["/main.hex", MAIN + "import Mid\nimport Lib\n\n" +
        "export let t: String = Lib.make(1)\n"]]);
      expect(exports.t).toBe("made");
    });

    test("the record spelling's redirect: `add`, `then call`; with the alias held, `call`", () => {
      const use = "fun g(x) = x.heft\nlet t = g(\"ab\")\n";
      const tail = "this value's type was inferred as a record with a `heft` field because its type was unknown " +
        "where it was written; `String` is not a record; annotate it to use dispatch, or ";
      expect(messages([LIB, MID, ["/main.hex", MAIN + "import Mid\n\n" + use]]))
        .toEqual([tail + "add `import Lib`, then call `Lib.heft(…)` directly"]);
      expect(messages([LIB, ["/main.hex", MAIN + "import Lib\n\n" + use]]))
        .toEqual([tail + "call `Lib.heft(…)` directly"]);
    });
  });
});
