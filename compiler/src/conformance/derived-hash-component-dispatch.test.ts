import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runProject } from "../support/test-project.js";

/**
 * Conformance for the derived `Hash` walk under #278's rule — a component means
 * **its instance** (`spec/products.md` §2.5's implementer note) — and for the
 * `Eq`-law violation the exemption left behind (issue #609).
 *
 * `Hash` was the last member emission still walked *structurally*: the body
 * expanded every component's representation rather than rendering the evidence
 * the checker had already selected for it. The licence read that a `Hash`
 * subject's `Eq` is derived all the way down (Collections Part 2 §4.3), so the
 * structural answer *is* the instance's answer — true of the answer, and false
 * of the walk, because the walk needs the component's **declaration** and a
 * module only has the declarations it names. A nominal reaching the module
 * solely through an imported alias has no row in `module.unions`/`module.records`
 * here, and the walk's miss arms answered `0` and JavaScript `===`:
 *
 * - a record deriving `Hash` over such a component collapsed to a constant, so
 *   every value of it landed in one bucket;
 * - severer, the `eq` slot of the structural `Hash` dictionary a `Set`/`Map`
 *   builds for its element took `===` over a *tagged* union, which is reference
 *   equality on fresh objects. Two equal values, two set members — an `Eq`-law
 *   violation observable through `Set.size`, not merely a hash-quality loss.
 *
 * The repair is instance dispatch, exactly as `#derivedCompare` took it: every
 * structural arm of the hash walk, and of the walk's `hashBacked` equality mode,
 * consults the checker's per-component selection under the keys the checker
 * records — tuple indices, field names, `Constructor.field`, and
 * `element`/`key`/`value` for the collections. The evidence chain carries
 * arbitrary nesting and arbitrary transitive reach with no table lookup at all,
 * which is why the walk no longer cares what this module happens to name.
 *
 * Every case below is spelled twice where it can be: once **reached** — the
 * component's nominal arrives only as `export type F = Flag` plus maker
 * functions, so `/main.hex` never writes the nominal's own name — and once
 * directly imported, as a control that the repair moved nothing that was already
 * right. The reached spellings are the red ones at 6b46054.
 *
 * Every program is textually distinct on purpose: two programs whose emitted JS
 * is byte-identical share one `data:` URL module instance, so a copy of another
 * test's source would silently assert against that test's module.
 */

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

describe("a record's derived `Hash` over a reached union component", () => {
  test("an untagged union reached through an alias still separates (#609 filed case)", async () => {
    const module = await runProject([
      ["/flag.hex", "export union Flag derives (Eq, Hash) = On | Off\n"],
      [
        "/flagalias.hex",
        "import { Flag, On, Off } from \"./flag\"\n" +
        "export type F = Flag\n" +
        "export fun on(): F = On\n" +
        "export fun off(): F = Off\n",
      ],
      [
        "/main.hex",
        "import { F, on, off } from \"./flagalias\"\n" +
        "export record Box derives (Eq, Hash) = {f: F}\n" +
        "export let onHash: Int = hash(Box({f = on()}))\n" +
        "export let offHash: Int = hash(Box({f = off()}))\n" +
        "export let equal: Bool = Box({f = on()}) == Box({f = off()})\n",
      ],
    ]);

    // At 6b46054 both arms were `__mixHash(0, 0)`: the walk missed `Flag` in
    // `module.unions` and took the `"0"` miss arm, while the imported
    // `__Hash_Flag` dictionary sat unused beside it.
    expect(module.onHash).not.toBe(module.offHash);
    // `Eq` has dispatched since #278; the two members must not disagree.
    expect(module.equal).toBe(false);
  });

  test("a tagged union reached through an alias separates by payload", async () => {
    const module = await runProject([
      ["/shape.hex", "export union Shape derives (Eq, Hash) = Dot | Circle(radius: Int)\n"],
      [
        "/shapealias.hex",
        "import { Shape, Dot, Circle } from \"./shape\"\n" +
        "export type S = Shape\n" +
        "export fun dot(): S = Dot\n" +
        "export fun circle(r: Int): S = Circle(r)\n",
      ],
      [
        "/main.hex",
        "import { S, dot, circle } from \"./shapealias\"\n" +
        "export record Frame derives (Eq, Hash) = {s: S}\n" +
        "export let three: Int = hash(Frame({s = circle(3)}))\n" +
        "export let four: Int = hash(Frame({s = circle(4)}))\n" +
        "export let plain: Int = hash(Frame({s = dot()}))\n" +
        "export let threeAgain: Int = hash(Frame({s = circle(3)}))\n",
      ],
    ]);

    expect(module.three).not.toBe(module.four);
    expect(module.three).not.toBe(module.plain);
    // The law itself: equal values hash equally.
    expect(module.three).toBe(module.threeAgain);
  });

  test("a nominal record component reached through an alias separates (the record half)", async () => {
    const module = await runProject([
      ["/cell.hex", "export record Cell derives (Eq, Hash) = {v: Int}\n"],
      [
        "/cellalias.hex",
        "import { Cell } from \"./cell\"\n" +
        "export type C = Cell\n" +
        "export fun cell(v: Int): C = Cell({v = v})\n",
      ],
      [
        "/main.hex",
        "import { C, cell } from \"./cellalias\"\n" +
        "export record Crate derives (Eq, Hash) = {c: C}\n" +
        "export let one: Int = hash(Crate({c = cell(1)}))\n" +
        "export let two: Int = hash(Crate({c = cell(2)}))\n" +
        "export let oneAgain: Int = hash(Crate({c = cell(1)}))\n",
      ],
    ]);

    expect(module.one).not.toBe(module.two);
    expect(module.one).toBe(module.oneAgain);
  });

  test("the direct-import spelling is unmoved (parity control)", async () => {
    const module = await runProject([
      ["/mark.hex", "export union Mark derives (Eq, Hash) = Up | Down\n"],
      [
        "/main.hex",
        "import { Mark, Up, Down } from \"./mark\"\n" +
        "export record Slot derives (Eq, Hash) = {m: Mark}\n" +
        "export let up: Int = hash(Slot({m = Up}))\n" +
        "export let down: Int = hash(Slot({m = Down}))\n" +
        "export let upAgain: Int = hash(Slot({m = Up}))\n",
      ],
    ]);

    // Green before and after: the union's declaration was always in scope here.
    expect(module.up).not.toBe(module.down);
    expect(module.up).toBe(module.upAgain);
  });
});

describe("the `Eq` law through the hash-backed collections (#609's severer half)", () => {
  test("a `Set` over a structural record holding a reached tagged union dedups", async () => {
    const module = await runProject([
      ["/a.hex", "export union Ring derives (Eq, Hash) = Nil | Node(size: Int)\n"],
      [
        "/b.hex",
        "import { Ring, Nil, Node } from \"./a\"\n" +
        "export type R = Ring\n" +
        "export fun node(n: Int): R = Node(n)\n",
      ],
      [
        "/main.hex",
        "import { R, node } from \"./b\"\n" +
        "let rings: Set({r: R}) = Set.add(Set.add(Set.empty, {r = node(3)}), {r = node(3)})\n" +
        "export let count: Int = Set.size(rings)\n" +
        "export let found: Bool = Set.contains(rings, {r = node(3)})\n" +
        "export let absent: Bool = Set.contains(rings, {r = node(4)})\n",
      ],
    ]);

    // The filed program. At 6b46054 the `eq` slot of the structural `Hash`
    // dictionary fell to `left === right` over `{tag: "Node", size: 3}`, so two
    // equal values were two members and `contains` never found either.
    expect(module.count).toBe(1);
    expect(module.found).toBe(true);
    expect(module.absent).toBe(false);
  });

  test("a `Map` keyed by a structural record over a reached union replaces rather than adds", async () => {
    const module = await runProject([
      ["/keys.hex", "export union Key derives (Eq, Hash) = Anon | Named(id: Int)\n"],
      [
        "/keysalias.hex",
        "import { Key, Anon, Named } from \"./keys\"\n" +
        "export type K = Key\n" +
        "export fun named(id: Int): K = Named(id)\n",
      ],
      [
        "/main.hex",
        "import { K, named } from \"./keysalias\"\n" +
        "let table: Map({k: K}, Int) =\n" +
        "    Map.set(Map.set(Map.empty, {k = named(7)}, 1), {k = named(7)}, 2)\n" +
        "export let entries: Int = Map.size(table)\n" +
        "export let bound: Bool = Map.containsKey(table, {k = named(7)})\n",
      ],
    ]);

    expect(module.entries).toBe(1);
    expect(module.bound).toBe(true);
  });

  test("the direct-import `Set` spelling is unmoved (parity control)", async () => {
    const module = await runProject([
      ["/tone.hex", "export union Tone derives (Eq, Hash) = Flat | Sharp(step: Int)\n"],
      [
        "/main.hex",
        "import { Tone, Flat, Sharp } from \"./tone\"\n" +
        "let tones: Set({t: Tone}) = Set.add(Set.add(Set.empty, {t = Sharp(2)}), {t = Sharp(2)})\n" +
        "export let count: Int = Set.size(tones)\n" +
        "export let found: Bool = Set.contains(tones, {t = Sharp(2)})\n",
      ],
    ]);

    expect(module.count).toBe(1);
    expect(module.found).toBe(true);
  });
});

describe("the evidence chain through structural layers", () => {
  test("`Vector` and tuple components over a reached union carry the selection", async () => {
    const module = await runProject([
      ["/beat.hex", "export union Beat derives (Eq, Hash) = Rest | Hit(force: Int)\n"],
      [
        "/beatalias.hex",
        "import { Beat, Rest, Hit } from \"./beat\"\n" +
        "export type B = Beat\n" +
        "export fun rest(): B = Rest\n" +
        "export fun hit(force: Int): B = Hit(force)\n",
      ],
      [
        "/main.hex",
        "import { B, rest, hit } from \"./beatalias\"\n" +
        "export record Bar derives (Eq, Hash) = {beats: Vector(B), lead: (B, Int)}\n" +
        "let soft: Bar = Bar({beats = [hit(1), rest()], lead = (hit(1), 0)})\n" +
        "let loud: Bar = Bar({beats = [hit(2), rest()], lead = (hit(1), 0)})\n" +
        "let leadShift: Bar = Bar({beats = [hit(1), rest()], lead = (hit(2), 0)})\n" +
        "let softAgain: Bar = Bar({beats = [hit(1), rest()], lead = (hit(1), 0)})\n" +
        "export let softHash: Int = hash(soft)\n" +
        "export let loudHash: Int = hash(loud)\n" +
        "export let leadHash: Int = hash(leadShift)\n" +
        "export let softAgainHash: Int = hash(softAgain)\n" +
        "let bars: Set(Bar) = Set.add(Set.add(Set.empty, soft), softAgain)\n" +
        "export let count: Int = Set.size(bars)\n",
      ],
    ]);

    // The vector's `element` key and the tuple's `0` key each reach the union's
    // own dictionary through a structural layer.
    expect(module.softHash).not.toBe(module.loudHash);
    expect(module.softHash).not.toBe(module.leadHash);
    expect(module.softHash).toBe(module.softAgainHash);
    expect(module.count).toBe(1);
  });

  test("a transitively reached union needs no table lookup here", async () => {
    const module = await runProject([
      ["/inner.hex", "export union Inner derives (Eq, Hash) = Zero | One\n"],
      [
        "/outer.hex",
        "import { Inner, Zero, One } from \"./inner\"\n" +
        "export union Outer derives (Eq, Hash) = Wrap(inner: Inner)\n" +
        "export fun wrapZero(): Outer = Wrap(Zero)\n" +
        "export fun wrapOne(): Outer = Wrap(One)\n",
      ],
      [
        "/outeralias.hex",
        "import { Outer, wrapZero, wrapOne } from \"./outer\"\n" +
        "export type O = Outer\n" +
        "export fun zero(): O = wrapZero()\n" +
        "export fun one(): O = wrapOne()\n",
      ],
      [
        "/main.hex",
        // Neither `Outer` nor `Inner` is spelled in this module.
        "import { O, zero, one } from \"./outeralias\"\n" +
        "export record Cage derives (Eq, Hash) = {held: O}\n" +
        "export let zeroHash: Int = hash(Cage({held = zero()}))\n" +
        "export let oneHash: Int = hash(Cage({held = one()}))\n" +
        "export let zeroAgain: Int = hash(Cage({held = zero()}))\n",
      ],
    ]);

    expect(module.zeroHash).not.toBe(module.oneHash);
    expect(module.zeroHash).toBe(module.zeroAgain);
  });

  test("a union subject's slot over a reached nominal separates", async () => {
    const module = await runProject([
      ["/coin.hex", "export record Coin derives (Eq, Hash) = {value: Int}\n"],
      [
        "/coinalias.hex",
        "import { Coin } from \"./coin\"\n" +
        "export type Money = Coin\n" +
        "export fun coin(value: Int): Money = Coin({value = value})\n",
      ],
      [
        "/main.hex",
        "import { Money, coin } from \"./coinalias\"\n" +
        "export union Purse derives (Eq, Hash) = Empty | Holding(coin: Money)\n" +
        "export let one: Int = hash(Holding(coin(1)))\n" +
        "export let two: Int = hash(Holding(coin(2)))\n" +
        "export let oneAgain: Int = hash(Holding(coin(1)))\n" +
        "export let none: Int = hash(Empty)\n",
      ],
    ]);

    expect(module.one).not.toBe(module.two);
    expect(module.one).not.toBe(module.none);
    expect(module.one).toBe(module.oneAgain);
  });
});

describe("the shortcuts the dispatch keeps", () => {
  test("an all-primitive record still hashes inline, with no dictionary call", () => {
    const emitted = javascript(
      "export record Point derives (Eq, Hash) = {across: Int, down: Int}\n",
    );

    // #344's `componentInstance` fast path: a primitive component's instance is
    // an ordinary `Instance` now, and the inline arm *is* that instance rendered.
    expect(emitted).toContain("__stableHash(__value.across)");
    expect(emitted).toContain("__stableHash(__value.down)");
    expect(emitted).not.toContain(".hash(__value.across)");
    expect(emitted).not.toContain(".hash(__value.down)");
  });
});
