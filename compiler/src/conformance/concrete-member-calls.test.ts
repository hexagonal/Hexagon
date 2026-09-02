import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for `spec/constraints.md` §6.1's **member seats** and its
 * three-arm concrete-call doctrine (#444), with §6.3's emission-order rider,
 * §6.5's unexported-constraint variant, and `spec/dictionary-sharing.md` §5/§8
 * on how the seats are named and how they travel.
 *
 * The doctrine, in one sentence: *a constraint is an interface only, and an
 * instance method **is** a companion module method.* Two halves follow.
 *
 * - **The seat.** A ground instance is a record of its completed member set,
 *   and every member's implementation hoists to its own module-level binding —
 *   §4.6's law ("a member definition *is* a module-level binding") reaching
 *   emission at last. Supplied members, inherited defaults, and a derived
 *   instance's generated members all take one, because default-versus-override
 *   is a fact about the block's text and never about the instance's interface.
 * - **The call.** A source-written member call — bare, qualified, dot, or a
 *   pipe stage — whose head resolves to a concrete type is a call to the
 *   instance's method, and erases by what the instance is: a ground declared
 *   instance's seat by name, a parameterized instance's member off Dictionary
 *   Sharing §3.1's hoisted application, a compiler-built demand's off §3.4's
 *   hoisted structural dictionary.
 *
 * What is *not* here because it is elsewhere: the collision discipline over the
 * seat names is `dictionary-names.test.ts`'s and `dictionary-sharing.test.ts`'s,
 * the boundary claim that no honoring module exports a nameable `show` is
 * `show-member-boundary.test.ts`'s, and the permanent no-edition pin is
 * `specialized-call-sites.test.ts`'s.
 *
 * The programs are deliberately byte-distinct: two conformance modules whose
 * emitted JavaScript is identical share one instance through the ESM data-URL
 * cache, and a pin that silently measures its neighbour's module cannot fail.
 */

function emitted(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source: file }) => file.path === "/main.hex");
  if (module === undefined) throw new Error("/main.hex was not emitted");
  return module.javascript.text;
}

function emittedFrom(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** Every emitted relative import whose target module was not emitted (defect 8). */
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

/** The offset of `needle`, asserted present so -1 cannot satisfy an ordering pin. */
function offsetOf(text: string, needle: string): number {
  const offset = text.indexOf(needle);
  expect(offset, `${needle} was not emitted`).toBeGreaterThanOrEqual(0);
  return offset;
}

describe("§6.1 — a ground instance's members hoist to member seats", () => {
  test("a supplied member is its own module-level binding, and the slot names it", () => {
    const text = emitted(
      "record Coin = {face: String}\n" +
        "honor Show<Coin> =\n" +
        '    show(c) = "coin ${c.face}"\n' +
        'export let one: String = show(Coin({face = "heads"}))\n',
    );

    expect(text).toContain('const __Show_Coin_show = c => "coin " + c.face;');
    expect(text).toContain("const __Show_Coin = { show: __Show_Coin_show };");
  });

  test("every member of a multi-member instance takes one, in declaration order", () => {
    const text = emitted(
      "record Tally = {count: Int}\n" +
        "honor Num<Tally> =\n" +
        "    add(l, r) = Tally({count = l.count + r.count})\n" +
        "    multiply(l, r) = Tally({count = l.count * r.count})\n" +
        "    fromNat(n) = Tally({count = Int.fromNat(n)})\n" +
        "export let summed: Int = Num.add(Tally({count = 2}), Tally({count = 3})).count\n",
    );

    expect(text).toContain(
      "const __Num_Tally = { add: __Num_Tally_add, multiply: __Num_Tally_multiply," +
        " fromNat: __Num_Tally_fromNat };",
    );
    // The constraint declaration's member order, which is the rank
    // Dictionary Sharing §5's first phase assigns seats in.
    expect(offsetOf(text, "const __Num_Tally_add =")).toBeLessThan(
      offsetOf(text, "const __Num_Tally_multiply ="),
    );
    expect(offsetOf(text, "const __Num_Tally_multiply =")).toBeLessThan(
      offsetOf(text, "const __Num_Tally_fromNat ="),
    );
  });

  test("§6.3's rider: each seat precedes the record that references it, and both precede the terms", () => {
    const text = emitted(
      "record Badge = {rank: Int}\n" +
        "honor Show<Badge> =\n" +
        '    show(b) = "badge ${b.rank}"\n' +
        "let pinned: Badge = Badge({rank = 4})\n" +
        "export let label: String = show(pinned)\n",
    );

    expect(offsetOf(text, "const __Show_Badge_show =")).toBeLessThan(
      offsetOf(text, "const __Show_Badge ="),
    );
    expect(offsetOf(text, "const __Show_Badge =")).toBeLessThan(
      offsetOf(text, "const pinned ="),
    );
  });

  test("a derived instance's generated members take seats too", () => {
    // §4.5: "a derived instance is an ordinary instance thereafter." The seat
    // set is the constraint's members, so `Eq` gets both of its own.
    //
    // The call is the dot form because `derives` writes no member binding, so
    // Modules §5.5's in-module carve-out does not reach it (#742): a deriving
    // module is an ordinary consumer of the spelling. Which route reaches the
    // seat is not what this test is about — the seat set is — and the dot is the
    // one the language teaches.
    const text = emitted(
      "record Pair derives Eq = {left: Int, right: Int}\n" +
        "export let same: Bool =\n" +
        "    Pair({left = 1, right = 2}).equals(Pair({left = 1, right = 2}))\n",
    );

    expect(text).toContain(
      "const __Eq_Pair = { equals: __Eq_Pair_equals, notEquals: __Eq_Pair_notEquals };",
    );
    expect(text).toContain("const same = __Eq_Pair_equals({ left: 1, right: 2 }");
  });

  test("a parameterized instance has no seats: its members close over its parameters", () => {
    const text = emitted(
      "record Crate(a) = {item: a}\n" +
        "honor<a: Show> Show<Crate(a)> =\n" +
        '    show(c) = "crate(${c.item.show()})"\n' +
        "export let one: String = show(Crate({item = 5}))\n",
    );

    // The factory keeps its inline lambda — there is no module-level binding a
    // member closing over `__Show_a` could take.
    expect(text).toMatch(/const __Show_Crate = __Show_a => \{/u);
    expect(text).not.toContain("const __Show_Crate_show");
  });

  test("the completed set is what hoists: an omitted default gets a wrapper seat", async () => {
    // §2's completed member set, and §6.1's defaulted-member sentence. The
    // block writes only `equals`; the instance still *has* `notEquals`, and
    // §4.6 qualifies `Coupon.notEquals` either way.
    const source =
      "record Coupon = {code: String}\n" +
        "honor Eq<Coupon> =\n" +
        "    equals(l, r) = l.code == r.code\n" +
        'export let differs: Bool = notEquals(Coupon({code = "a"}), Coupon({code = "b"}))\n';
    const text = emitted(source);

    expect(text).toContain(
      "const __Eq_Coupon_notEquals = (__left, __right) => !__Eq_Coupon.equals(__left, __right);",
    );
    expect(text).toContain(
      "const __Eq_Coupon = { equals: __Eq_Coupon_equals, notEquals: __Eq_Coupon_notEquals };",
    );

    const main = await runMain(source);
    expect(main["differs"]).toBe(true);
  });

  test("§6.5's unexported-constraint variant: the wrapper seat carries the body itself", async () => {
    // No helper is hoisted for an unexported constraint, so the seat *is* the
    // materialized default — closing over this module's own dictionary, which
    // is what keeps an override winning (§2).
    const source =
      "constraint Chirp<a> =\n" +
        "    note(x: a): String\n" +
        '    twice(x: a): String = note(x) ++ note(x)\n' +
        "record Finch = {call: String}\n" +
        "honor Chirp<Finch> =\n" +
        "    note(f) = f.call\n" +
        'export let doubled: String = twice(Finch({call = "pip"}))\n';
    const text = emitted(source);

    expect(text).toContain(
      "const __Chirp_Finch_twice = x => note(x, __Chirp_Finch) + note(x, __Chirp_Finch);",
    );
    expect(text).toContain("const doubled = __Chirp_Finch_twice({ call: \"pip\" });");

    const main = await runMain(source);
    expect(main["doubled"]).toBe("pippip");
  });

  test("the seats are exported under generated spellings, never the member's own name", () => {
    // §8's sweep carries them, and `show-member-boundary.test.ts` owns the
    // other half: no importer can name a bare `show` here.
    const text = emittedFrom(
      [
        ["/tokens.hex",
          "export record Chip = {value: Int}\n" +
          "honor Show<Chip> =\n" +
          '    show(c) = "chip ${c.value}"\n'],
        ["/main.hex",
          'import Tokens from "./tokens"\n' +
          "export let one: String = show(Tokens.Chip({value = 9}))\n"],
      ],
      "/tokens.hex",
    );

    expect(text).toContain("export { __Show_Chip };");
    expect(text).toContain("export { __Show_Chip_show };");
    expect(text).not.toMatch(/export \{ show[ }]/u);
    expect(text).not.toContain("as show }");
  });
});

describe("§6.1 — arm 1: a ground declared instance is a direct call to its seat", () => {
  test("bare, dotted, and piped spellings all emit the same call", async () => {
    // The dotted-versus-bare equivalence (Method Syntax §8.1) survives the
    // change: both route, and both route to the same binding.
    const source =
      "record Note2 = {text: String}\n" +
        "honor Show<Note2> =\n" +
        '    show(n) = "note ${n.text}"\n' +
        'let subject: Note2 = Note2({text = "x"})\n' +
        "export let bare: String = show(subject)\n" +
        "export let dotted: String = subject.show()\n" +
        "export let piped: String = subject |> show\n";
    const text = emitted(source);

    expect(text).toContain("const bare = __Show_Note2_show(subject);");
    expect(text).toContain("const dotted = __Show_Note2_show(subject);");
    expect(text).toContain("const piped = __Show_Note2_show(subject);");

    const main = await runMain(source);
    expect(main["bare"]).toBe("note x");
    expect(main["dotted"]).toBe("note x");
    expect(main["piped"]).toBe("note x");
  });

  test("a prelude companion's member is reached by importing its seat", async () => {
    const source = 'export let rendered: String = show(41) ++ show("!")\n';
    const text = emitted(source);

    expect(text).toContain('import { __Show_Int_show } from "./Int.js";');
    expect(text).toContain('import { __Show_String_show } from "./String.js";');
    expect(text).toContain('const rendered = __Show_Int_show(41) + __Show_String_show("!");');
    // The forwarder and the dictionary are both gone from the call.
    expect(text).not.toContain("./Show.js");
    expect(text).not.toContain("__Show_Int }");

    const main = await runMain(source);
    expect(main["rendered"]).toBe("41!");
  });

  test("a qualified member call reaches the companion its spelling names", async () => {
    // The doctrinal offense the issue was filed on: `Rat.fromInt(3)` named the
    // companion's method in source and reached `Signed.hex`'s forwarder.
    const files = [
      ["/Rat.hex", RAT],
      ["/main.hex",
        'import Rat from "./Rat"\n' +
        "export let third: String = Rat.show(Rat.fromInt(3))\n"],
    ] as const;
    const text = emittedFrom(files, "/main.hex");

    // Both spellings are uncontested here, so both seats bind under the
    // member's own name and the routed call reads as the source wrote it
    // (Dictionary Sharing §8's seat-binding rule).
    expect(text).toContain(
      'import { __Show_Rat_show as show, __Signed_Rat_fromInt as fromInt } from "./Rat.js";',
    );
    expect(text).toContain("const third = show(fromInt(3));");

    const main = await runProject(files, { entry: "/main.hex" });
    expect(main["third"]).toBe("3/1");
  });

  test("a defaulted member at a concrete head reaches the wrapper seat", async () => {
    const source = "export let differs: Bool = Eq.notEquals(2, 3)\n";
    const text = emitted(source);

    expect(text).toContain('import { __Eq_Int_notEquals as notEquals } from "./Int.js";');
    expect(text).toContain("const differs = notEquals(2, 3);");

    const main = await runMain(source);
    expect(main["differs"]).toBe(true);
  });

  test("a companion's sibling-member call erases to a direct seat call, and still bottoms out", async () => {
    // §6.1's companion bullet made true: `div` is ordinary Hexagon over `quot`
    // and `mod`, and the chain terminates because it ends at the door.
    const text = emittedFrom(
      [["/main.hex", "export let d: Int = Int.div(-7, 2)\n"]],
      "/Int.hex",
    );

    expect(text).toContain(
      "__Integral_Int_quot(left - __Integral_Int_mod(left, right), right)",
    );
    expect(text).toContain("const remainder = __Integral_Int_rem(left, right);");
    expect(text).not.toContain('from "./Integral.js"; ');

    const main = await runMain("export let d: Int = Int.div(-7, 2)\n");
    expect(main["d"]).toBe(-4);
  });
});

/**
 * Dictionary Sharing §8's seat-binding rule: a consumer binds an imported seat
 * under the member's **source** spelling where that spelling is uncontested in
 * the consumer, so the routed call reads exactly as the source wrote it. The
 * one deliberate exception to §5's collision-only aliasing, in Part 8's
 * `claimPublic` lineage — and on any contest the generated spelling stands,
 * with no numbering: a seat's generated name is already unique, and it reads
 * better here than `show_1` would.
 */
describe("§8 — a routed seat binds the member's source spelling when uncontested", () => {
  test("uncontested: the call reads as the source wrote it", async () => {
    const source = "let uncontestedSeat = 0\nexport let one: String = show(21)\n";
    const text = emitted(source);

    expect(text).toContain('import { __Show_Int_show as show } from "./Int.js";');
    expect(text).toContain("const one = show(21);");

    const main = await runMain(source);
    expect(main["one"]).toBe("21");
  });

  test("two seats want one member spelling: all contestants keep the generated names", async () => {
    // §8 gives it to neither, and numbers nothing — the first call must not
    // win the spelling on the promise that no second one appears.
    const source =
      "let twoSeats = 0\n" +
        'export let one: String = show(22) ++ show("!")\n';
    const text = emitted(source);

    expect(text).toContain('import { __Show_Int_show } from "./Int.js";');
    expect(text).toContain('import { __Show_String_show } from "./String.js";');
    expect(text).toContain('const one = __Show_Int_show(22) + __Show_String_show("!");');
    expect(text).not.toContain("as show }");
    expect(text).not.toContain("show_1");

    const main = await runMain(source);
    expect(main["one"]).toBe("22!");
  });

  test("a surviving forwarder contests it: a polymorphic call beside a concrete one", async () => {
    const source =
      "let forwarderBeside = 0\n" +
        "let render4<a: Show>(value: a): String = show(value)\n" +
        "export let one: String = render4(23) ++ show(24)\n";
    const text = emitted(source);

    // The forwarder is bound as `show`, so the seat takes its generated name.
    expect(text).toContain('import { __show as show } from "./Show.js";');
    expect(text).toContain('import { __Show_Int_show } from "./Int.js";');
    expect(text).toContain("__Show_Int_show(24)");

    const main = await runMain(source);
    expect(main["one"]).toBe("2324");
  });

  test("a member reference as a value contests it too", async () => {
    const source =
      "let valueBeside = 0\n" +
        "let render5 = show\n" +
        "export let one: String = render5(25) ++ show(26)\n";
    const text = emitted(source);

    expect(text).toContain('import { __show as show } from "./Show.js";');
    expect(text).toContain("__Show_Int_show(26)");

    const main = await runMain(source);
    expect(main["one"]).toBe("2526");
  });

  test("an ordinary binding of the name contests it", async () => {
    // The module binds `show` itself, occluding the prelude's (Modules §5.4),
    // so the seat cannot have the spelling.
    const source =
      "let show = 27\n" +
        "export let one: String = Int.show(28)\n" +
        "export let two: Int = show\n";
    const text = emitted(source);

    expect(text).toContain('import { __Show_Int_show } from "./Int.js";');
    expect(text).toContain("const one = __Show_Int_show(28);");
    expect(text).toContain("const show = 27;");

    const main = await runMain(source);
    expect(main["one"]).toBe("28");
    expect(main["two"]).toBe(27);
  });

  test("a local instance's own member contests it, and its seat is never aliased", async () => {
    // Honoring a constraint claims the member's name in the module's term
    // space (§4.6), and a bare use there means *that* instance's member — so
    // binding another instance's seat to the same JavaScript name would make
    // the emitted spelling mean what the source spelling does not. The local
    // seat is a `const` here and is called by its own name.
    const source =
      "record Slug = {n: Int}\n" +
        "honor Show<Slug> =\n" +
        '    show(s) = "slug ${s.n}"\n' +
        "export let one: String = show(Slug({n = 29})) ++ Int.show(30)\n";
    const text = emitted(source);

    expect(text).toContain('import { __Show_Int_show } from "./Int.js";');
    expect(text).toContain("const one = __Show_Slug_show({ n: 29 }) + __Show_Int_show(30);");
    expect(text).not.toContain("as show }");

    const main = await runMain(source);
    expect(main["one"]).toBe("slug 2930");
  });

  test("two members of one instance each take their own spelling", async () => {
    const source =
      "let twoMembers = 0\n" +
        "export let one: String = show(Int.div(31, 2))\n";
    const text = emitted(source);

    expect(text).toContain(
      'import { __Integral_Int_div as div, __Show_Int_show as show } from "./Int.js";',
    );
    expect(text).toContain("const one = show(div(31, 2));");

    const main = await runMain(source);
    expect(main["one"]).toBe("15");
  });

  test("two compiles of one module agree on the binding", () => {
    const source = "let seatDeterminism = 0\nexport let one: String = show(32)\n";
    expect(emitted(source)).toBe(emitted(source));
  });
});

describe("§6.1 — arms 2 and 3: the hoisted binding's slot", () => {
  test("a parameterized instance at a ground head reads §3.1's hoisted application", async () => {
    const source = "export let shown: String = show(Some(11))\n";
    const text = emitted(source);

    expect(text).toContain("const __Show_Option_Int = __Show_Option(__Show_Int);");
    expect(text).toContain("const shown = __Show_Option_Int.show(Some(11));");

    const main = await runMain(source);
    expect(main["shown"]).toBe("Some(11)");
  });

  test("a compiler-built ground demand reads §3.4's hoisted structural dictionary", async () => {
    // `Bool` and `Unit` are the enumerated pair: `Bool`'s instances are
    // declared but its ground demands are satisfied structurally, and `Unit` is
    // the arity-0 tuple, which no module declares anything for.
    const source =
      "let structuralDemand = 0\n" +
        "export let flag: String = show(True)\n" +
        "export let nothing: String = show(())\n" +
        "export let pair: String = show((6, 7))\n";
    const text = emitted(source);

    expect(text).toContain("const flag = __Show_Bool.show(true);");
    expect(text).toContain("const nothing = __Show_Unit.show(undefined);");
    expect(text).toContain("const pair = __Show_Int_Int.show([6, 7]);");

    const main = await runMain(source);
    expect(main["flag"]).toBe("True");
    expect(main["nothing"]).toBe("()");
    expect(main["pair"]).toBe("(6, 7)");
  });
});

describe("§8 — the seats travel to the declaring module, not the transit one", () => {
  /**
   * Dictionary Sharing §5 settles an instance arriving by two routes on the
   * first specifier in source order, which may name a module that merely
   * carried it. A transit module re-exports the record, not the seats, so the
   * route to a seat is the **declaring** module's — which is why the inventory
   * travels with a declaring path rather than riding the import item.
   */
  test("a transited instance's dictionary and seat come from different modules", async () => {
    const files = [
      ["/mint.hex",
        "export record Coin2 = {edge: Int}\n" +
        "honor Show<Coin2> =\n" +
        '    show(c) = "coin2 ${c.edge}"\n'],
      ["/purse.hex",
        'import Mint from "./mint"\n' +
        "export let struck(edge: Int): Mint.Coin2 = Mint.Coin2({edge = edge})\n"],
      ["/main.hex",
        'import Purse from "./purse"\n' +
        "export let one: String = show(Purse.struck(3))\n"],
    ] as const;
    // Behavioral first, because it is the half that cannot be satisfied by a
    // plausible-looking wrong answer: importing the seat from the transit
    // module compiles clean and fails at load with "does not provide an export
    // named `__Show_Coin2_show`".
    const main = await runProject(files, { entry: "/main.hex" });
    expect(main["one"]).toBe("coin2 3");

    // The dictionary transits through `purse.hex`; the seat does not exist
    // there and is imported from the module that declared the instance.
    const text = emittedFrom(files, "/main.hex");
    expect(text).toContain('import { __Show_Coin2 } from "./purse.js";');
    expect(text).toContain('import { __Show_Coin2_show as show } from "./mint.js";');
    expect(text).toContain("const one = show(Purse.struck(3));");
  });

  test("importing a seat keeps its module in the emitted graph", () => {
    // Defect 8's shape: routing every call to a seat removes the dictionary
    // import that used to be the module's only edge, so the seat channel has
    // to report the edge itself.
    expect(danglingImports([["/main.hex", 'export let s: String = show(7)\n']]))
      .toEqual([]);
    expect(danglingImports([["/main.hex", "export let b: Bool = equals(1, 2)\n"]]))
      .toEqual([]);
  });

  test("a local instance used only by a concrete call is still materialized", () => {
    // §6.1: a concrete member call is a materialization demand on the instance
    // — record and seats together — in the honoring module.
    const text = emitted(
      "record Solo = {v: Int}\n" +
        "honor Show<Solo> =\n" +
        '    show(s) = "solo ${s.v}"\n' +
        "export let only: String = show(Solo({v = 1}))\n",
    );

    expect(text).toContain("const __Show_Solo_show =");
    expect(text).toContain("const __Show_Solo = {");
  });
});

describe("what the clause does not reach", () => {
  test("a genuinely polymorphic member call keeps the forwarder and its evidence", () => {
    const text = emitted(
      "let render2<a: Show>(value: a): String = show(value)\n" +
        "export let one: String = render2(12)\n",
    );

    expect(text).toContain('import { __show as show } from "./Show.js";');
    expect(text).toContain("const render2 = (value, __Show_a) => show(value, __Show_a);");
    // And the concrete call to `render2` itself is an ordinary constrained
    // call, which still hands over the dictionary.
    expect(text).toContain("const one = render2(12, __Show_Int);");
  });

  test("a member reference as a value keeps the forwarder's denotation", async () => {
    // §6.1's constrained-function-as-value bullet owns this, and it is a
    // reference rather than a call: the eta-expansion closes over the evidence
    // in scope, which is what a consumer of the value expects to find.
    const source = "let render3 = show\nexport let one: String = render3(13)\n";
    const text = emitted(source);

    expect(text).toContain("const render3 = __arg0 => show(__arg0, __Show_Int);");
    expect(text).not.toContain("const render3 = __Show_Int_show");

    const main = await runMain(source);
    expect(main["one"]).toBe("13");
  });

  test("interpolation and comparison keep their own routes", () => {
    const text = emitted(
      "record Ping = {n: Int}\n" +
        "honor Show<Ping> =\n" +
        '    show(p) = "ping ${p.n}"\n' +
        "record Pong derives Eq = {n: Int}\n" +
        'export let woven: String = "<${Ping({n = 1})}>"\n' +
        "export let alike: Bool = Pong({n = 2}) == Pong({n = 2})\n",
    );

    // Elaboration-internal dispatch: no `Call` node names a member, so the
    // clause never sees these. Both read the slot, as they did before.
    expect(text).toContain('const woven = "<" + __Show_Ping.show({ n: 1 }) + ">";');
    expect(text).toContain("const alike = __Eq_Pong.equals(");
  });

  test("operators at concrete primitives stay inlined, ahead of any dispatch", () => {
    const text = emitted(
      "let arithmetic = 0\n" +
        "export let sum: Int = 3 + 4 * 5\n" +
        "export let less: Bool = 3 < 4\n",
    );

    expect(text).toContain("const sum = 3 + 4 * 5;");
    expect(text).toContain("const less = 3 < 4;");
  });
});

/** `stdlib/Rat.hex`, the one prelude companion whose members are ordinary source. */
const RAT = [
  "opaque record Rat derives (Eq, Hash) = {",
  "    top: BigInt,",
  "    bottom: BigInt,",
  "}",
  "",
  "export let create(top: BigInt, bottom: BigInt): Rat =",
  "    if bottom == 0 then",
  '        throw(DivideByZeroError("Rat.create: bottom is zero"))',
  "    else",
  "        let divisor = top.gcd(bottom)",
  "        let reducedTop = top.quot(divisor)",
  "        let reducedBottom = bottom.quot(divisor)",
  "        if reducedBottom < 0 then",
  "            Rat({top = -reducedTop, bottom = -reducedBottom})",
  "        else",
  "            Rat({top = reducedTop, bottom = reducedBottom})",
  "",
  "honor Show<Rat> =",
  '    show(value) = "${value.top}/${value.bottom}"',
  "",
  "honor Num<Rat> =",
  "    add(left, right) =",
  "        create(",
  "            left.top * right.bottom + right.top * left.bottom,",
  "            left.bottom * right.bottom",
  "        )",
  "    multiply(left, right) =",
  "        create(left.top * right.top, left.bottom * right.bottom)",
  "    fromNat(value) = create(value, 1)",
  "",
  "honor Signed<Rat> =",
  "    subtract(left, right) =",
  "        create(",
  "            left.top * right.bottom - right.top * left.bottom,",
  "            left.bottom * right.bottom",
  "        )",
  "    negate(value) = Rat({top = -value.top, bottom = value.bottom})",
  "    fromInt(value) = create(value, 1)",
  "",
].join("\n");
