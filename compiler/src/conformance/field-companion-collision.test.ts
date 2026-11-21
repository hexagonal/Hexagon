import { describe, expect, test } from "vitest";

import { compileProject, type ProjectPackage } from "../project.js";
import * as Source from "../support/source.js";
import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Method Syntax §6's field/companion collision (#292), with no member involved.
 *
 * For a nominal receiver, a `name` that is both a field of `T` visible at the
 * call site and an exported companion operation of `T` is a hard error in the
 * fused form `e.name(args…)`, naming both claimants with a spelling for each
 * (§3.4's nominal row, §9 row 1). The field used to win silently: `b.grow(5)`
 * called the stored function, while `Box.grow` sat one dot away.
 *
 * The rewrites follow §6's spelling rules, which the field-versus-member arm
 * already kept: the companion through its module as this module spells it, the
 * import named first where this module holds no alias for it, and the bare
 * spelling where the companion is declared here. The field's rewrite is
 * conditional on its type: `(…​.grow)(…)` for a function-typed field, the bare
 * access `…​.size` for any other. Every offered spelling is applied and run.
 */

const MAIN = "module Main\n\n";
/** The receiver placeholder the refusal writes: an ellipsis, then a zero-width space. */
const SUBJECT = "…​";

function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

const callable = (companion: string, offer: string) =>
  `\`grow\` after a dot is ambiguous at \`Box\`: a field \`grow\`, a companion operation \`${companion}\`; ` +
  `write ${offer} for the companion operation, or \`(${SUBJECT}.grow)(…)\` for the field`;

const plain = (companion: string, offer: string) =>
  `\`size\` after a dot is ambiguous at \`Box\`: a field \`size\`, a companion operation \`${companion}\`; ` +
  `write ${offer} for the companion operation, or \`${SUBJECT}.size\` to access the field`;

const BOX = "export record Box = {size: Int, grow: (Int) -> Int}\n" +
  "export let grow(b: Box, n: Int): Int = 1000 + n\n" +
  "export let size(b: Box): Int = 7\n" +
  "export let mk(): Box = Box({size = 1, grow = (n) => n + 1})\n";

describe("in the companion's own module: the bare spelling", () => {
  test("a function-typed field: the companion bare, the field parenthesized", () => {
    expect(projectDiagnostics(MAIN + BOX + "export let r: Int = mk().grow(5)\n")).toEqual([
      callable("grow", "`grow(…)`"),
    ]);
  });

  test("a non-callable field collides too, and is pointed at its bare access", () => {
    expect(projectDiagnostics(MAIN + BOX + "export let r: Int = mk().size()\n")).toEqual([
      plain("size", "`size(…)`"),
    ]);
  });

  test("every spelling offered compiles, and means its claimant", async () => {
    const exports = await runProject([["/main.hex", MAIN + BOX +
      "export let companion: Int = grow(mk(), 5)\nexport let field: Int = (mk().grow)(5)\n" +
      "export let sized: Int = size(mk())\nexport let read: Int = mk().size\n"]]);
    expect([exports.companion, exports.field, exports.sized, exports.read]).toEqual([1005, 6, 7, 1]);
  });

  test("the bare and parenthesized forms are never ambiguous", async () => {
    const exports = await runProject([["/main.hex", MAIN + BOX +
      "export let b: Box = mk()\nexport let read: Int = b.size\nexport let called: Int = (b.grow)(2)\n"]]);
    expect([exports.read, exports.called]).toEqual([1, 3]);
  });
});

describe("from another module: through the companion's module", () => {
  const LIB = ["/lib.hex", "module Lib\n\n" + BOX] as const;
  const MID = ["/mid.hex", "module Mid\n\nimport Lib\n\nexport let box: Lib.Box = Lib.mk()\n"] as const;

  test("through this module's alias for it", () => {
    expect(messages([LIB, ["/main.hex", MAIN + "import Lib\n\nexport let r: Int = Lib.mk().grow(5)\n"]]))
      .toEqual([callable("Lib.grow", "`Lib.grow(…)`")]);
    expect(messages([LIB, ["/main.hex", MAIN + "import Lib\n\nexport let r: Int = Lib.mk().size()\n"]]))
      .toEqual([plain("Lib.size", "`Lib.size(…)`")]);
  });

  test("through an `import … as` alias", () => {
    expect(messages([LIB, ["/main.hex", MAIN + "import Lib as L\n\nexport let r: Int = L.mk().grow(5)\n"]]))
      .toEqual([callable("L.grow", "`L.grow(…)`")]);
  });

  test("with no alias held, the import is named first", () => {
    expect(messages([LIB, MID, ["/main.hex", MAIN + "import Mid\n\nexport let r: Int = Mid.box.grow(5)\n"]]))
      .toEqual([callable("Lib.grow", "`import Lib`, then `Lib.grow(…)`")]);
  });

  test("every spelling offered compiles, and means its claimant", async () => {
    const aliased = await runProject([LIB, ["/main.hex", MAIN + "import Lib as L\n\n" +
      "export let companion: Int = L.grow(L.mk(), 5)\nexport let field: Int = (L.mk().grow)(5)\n" +
      "export let read: Int = L.mk().size\n"]]);
    expect([aliased.companion, aliased.field, aliased.read]).toEqual([1005, 6, 1]);
    const imported = await runProject([LIB, MID, ["/main.hex", MAIN + "import Mid\nimport Lib\n\n" +
      "export let companion: Int = Lib.grow(Mid.box, 5)\nexport let field: Int = (Mid.box.grow)(5)\n"]]);
    expect([imported.companion, imported.field]).toEqual([1005, 6]);
  });
});

describe("visibility-scoped: an `opaque` type's fields (§4.3)", () => {
  const VAULT = "opaque record Box = {grow: (Int) -> Int}\n" +
    "export let grow(b: Box, n: Int): Int = 1000 + n\n" +
    "export let mk(): Box = Box({grow = (n) => n + 1})\n";

  test("outside the home module no field is visible, so the companion is called", async () => {
    const exports = await runProject([["/vault.hex", "module Vault\n\n" + VAULT],
      ["/main.hex", MAIN + "import Vault\n\nexport let r: Int = Vault.mk().grow(5)\n"]]);
    expect(exports.r).toBe(1005);
  });

  test("inside the home module the field is visible, and the call collides", () => {
    expect(projectDiagnostics(MAIN + VAULT + "export let r: Int = mk().grow(5)\n")).toEqual([
      callable("grow", "`grow(…)`"),
    ]);
  });
});

describe("only an exported companion operation is a claimant (§4.2)", () => {
  test("an unexported function of the name, in the home module, is no claimant: the field is called", async () => {
    const exports = await runProject([["/main.hex", MAIN +
      "export record Box = {grow: (Int) -> Int}\nlet grow(b: Box, n: Int): Int = 1000 + n\n" +
      "export let r: Int = Box({grow = (n) => n + 1}).grow(5)\nexport let q: Int = grow(Box({grow = (n) => n}), 1)\n"]]);
    expect([exports.r, exports.q]).toEqual([6, 1001]);
  });
});

describe("with a member too: one report naming all three", () => {
  const CRATE = ["/crate.hex", "module Crate\n\nexport record Crate = {n: Int, size: Int}\n" +
    "export let size(c: Crate): Int = c.n\nexport let mk(n: Int): Crate = Crate({n = n, size = 9})\n"] as const;
  const WEIGH = ["/weigh.hex", "module Weigh\n\nimport Crate\n\nexport constraint Weigh<c> =\n" +
    "    size(x: c) -> Int\n\nhonor Weigh<Crate.Crate> =\n    size(c) = 1000\n"] as const;

  test("field, companion operation and member", async () => {
    const program = (line: string) =>
      [CRATE, WEIGH, ["/main.hex", MAIN + "import Crate\nimport Weigh\n\n" + line]] as const;
    expect(messages(program("export let u: Int = Crate.mk(4).size()\n"))).toEqual([
      "`size` after a dot is ambiguous at `Crate`: a field `size`, a companion operation `Crate.size`, " +
        "`Weigh`'s member `size`; write `Weigh.size(…)`, or `Crate.size(…)` for the companion operation, " +
        `or \`${SUBJECT}.size\` to access the field`,
    ]);
    const exports = await runProject(program("export let member: Int = Weigh.size(Crate.mk(4))\n" +
      "export let companion: Int = Crate.size(Crate.mk(4))\nexport let field: Int = Crate.mk(4).size\n"));
    expect([exports.member, exports.companion, exports.field]).toEqual([1000, 4, 9]);
  });
});

describe("a field and a member: the field's rewrite follows its type", () => {
  const program = (field: string, lines: string) => MAIN +
    "export constraint Grows<c> =\n    grow(x: c) -> Int\n\n" +
    `export record Box = {grow: ${field}}\n\nhonor Grows<Box> =\n    grow(b) = 1000\n\n` + lines;

  test("a function-typed field is offered parenthesized", async () => {
    expect(projectDiagnostics(program("(Int) -> Int", "export let r: Int = Box({grow = (n) => n + 1}).grow()\n")))
      .toEqual([
        "`grow` after a dot is ambiguous at `Box`: a field `grow`, `Grows`'s member `grow`; " +
          `write \`grow(…)\`, or \`(${SUBJECT}.grow)(…)\` for the field`,
      ]);
    const exports = await runProject([["/main.hex", program("(Int) -> Int",
      "export let member: Int = grow(Box({grow = (n) => n}))\n" +
        "export let field: Int = (Box({grow = (n) => n + 1}).grow)(5)\n")]]);
    expect([exports.member, exports.field]).toEqual([1000, 6]);
  });

  test("a non-callable field is pointed at its bare access", async () => {
    expect(projectDiagnostics(program("Int", "export let r: Int = Box({grow = 3}).grow()\n"))).toEqual([
      "`grow` after a dot is ambiguous at `Box`: a field `grow`, `Grows`'s member `grow`; " +
        `write \`grow(…)\`, or \`${SUBJECT}.grow\` to access the field`,
    ]);
    const exports = await runProject([["/main.hex", program("Int",
      "export let member: Int = grow(Box({grow = 3}))\nexport let field: Int = Box({grow = 3}).grow\n")]]);
    expect([exports.member, exports.field]).toEqual([1000, 3]);
  });
});

/**
 * A companion whose module lies outside the calling package's visible set
 * (Packages §3.1) has no spelling here: it is named as fact, with its module,
 * and the field's rewrite is the only one offered (§6).
 */
describe("a companion this module cannot import", () => {
  test("is named as fact, and only the field is offered", () => {
    let id = 100;
    const file = (path: string, text: string) => new Source.File(Source.fileId(id++), path, text);
    const pkg = (name: string, dependencies: readonly string[], files: readonly Source.File[]): ProjectPackage => ({
      record: { name, dependencies, installed: new Set(dependencies) },
      files,
    });
    const main = MAIN + "import Near\n\nexport let r: Int = Near.box.grow(5)\n";
    expect(compileProject([new Source.File(Source.fileId(0), "/work/app/main.hex", main)], {
      dependencies: ["Acme"],
      installed: new Set(["Acme", "Bolt"]),
      packages: [
        pkg("Acme", ["Bolt"], [file("/work/app/node_modules/acme/near.hex",
          "module Near\n\nimport Lib\n\nexport let box: Lib.Box = Lib.mk()\n")]),
        pkg("Bolt", [], [file("/work/app/node_modules/bolt/lib.hex", "module Lib\n\n" + BOX)]),
      ],
    }).diagnostics.map(({ message }) => message)).toEqual([
      "`grow` after a dot is ambiguous at `Box`: a field `grow`, a companion operation `grow`, declared in " +
        "module `Bolt.Lib`, which this module cannot import; write " +
        `\`(${SUBJECT}.grow)(…)\` for the field`,
    ]);
  });
});

/**
 * A companion binding this module refuses for wearing a member's spelling is
 * no claimant (one report per cause): the field and the member, if any, are
 * what the dot weighs.
 */
describe("a companion binding already refused for wearing a member's spelling", () => {
  const program = (honor: string, call: string) => MAIN +
    "export constraint Sized<c> =\n    size(x: c) -> Int\n\n" +
    "export record Box = {size: (Int) -> Int}\nexport let size(b: Box): Int = 3\n\n" + honor +
    `export let r: Int = Box({size = (n) => n}).${call}\n`;
  const rebinding = "`size` is already bound (line 4); Hexagon does not allow rebinding — choose a different name";

  test("with no member honored, the field is the one claimant", () => {
    expect(projectDiagnostics(program("", "size(1)"))).toEqual([rebinding]);
  });

  test("with a member honored, the field and the member are named, the binding not", () => {
    expect(projectDiagnostics(program("honor Sized<Box> =\n    size(b) = 7\n\n", "size()"))).toEqual([
      rebinding,
      "`size` after a dot is ambiguous at `Box`: a field `size`, `Sized`'s member `size`; " +
        `write \`size(…)\`, or \`(${SUBJECT}.size)(…)\` for the field`,
    ]);
  });
});

/**
 * §9 row 16's receiver refusal fires only where one claimant outside the
 * spelling's rung answers the dot; a field and a companion operation both
 * answering is §6's refusal, its own report, and no ascription is offered
 * over it (the ascribed call collides just the same).
 */
test("a field and a companion operation at a tower-spelled dot: the collision alone, never row 16", () => {
  const baz = MAIN + "export record Baz = {n: Int, gcd: (Baz) -> BigInt}\n" +
    "export let gcd(left: Baz, right: Baz): BigInt = 5n\n" +
    "honor Num<Baz> =\n" +
    "    add(left, right) = Baz({n = left.n + right.n, gcd = left.gcd})\n" +
    "    multiply(left, right) = Baz({n = left.n * right.n, gcd = left.gcd})\n" +
    "    fromNat(value) = Baz({n = Int.fromNat(value), gcd = other => 0n})\n" +
    "honor Signed<Baz> =\n" +
    "    subtract(left, right) = Baz({n = left.n - right.n, gcd = left.gcd})\n" +
    "    negate(value) = Baz({n = -value.n, gcd = value.gcd})\n" +
    "    fromInt(value) = Baz({n = value, gcd = other => 0n})\n" +
    "let z1: Baz = Baz({n = 4, gcd = other => 1n})\n" +
    "let z2: Baz = Baz({n = 6, gcd = other => 1n})\n" +
    "let z3: Baz = Baz({n = 8, gcd = other => 1n})\n";
  const collision = "`gcd` after a dot is ambiguous at `Baz`: a field `gcd`, a companion operation `gcd`; " +
    `write \`gcd(…)\` for the companion operation, or \`(${SUBJECT}.gcd)(…)\` for the field`;
  expect(projectDiagnostics(baz + "let probe: BigInt = z1.add(z2).gcd(z3)\n")).toEqual([collision]);
  expect(projectDiagnostics(baz + "let probe: BigInt = (z1.add(z2): Baz).gcd(z3)\n")).toEqual([collision]);
});
