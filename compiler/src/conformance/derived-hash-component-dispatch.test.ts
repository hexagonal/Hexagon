import { describe, expect, test } from "vitest";

import { compileMain, runProject } from "../support/test-project.js";

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
 *
 * Imports bind modules, never names smaller than one (#762): every alias file
 * below imports its home module under the type's own spelling, so the type
 * itself reads bare through Modules §5.1 rule 2's companion fallback (or, for a
 * one-constructor nominal record, rule 3's term-namespace twin lets the
 * constructor read bare too — `Cell({v = v})`, `Coin({value = value})`). A
 * union's several constructors have no such luck: nothing spells `Dot` or `On`
 * the way an alias spells its own type, so every construction of one in
 * *expression* position is qualified through the alias — `Shape.Dot`,
 * `Flag.On`. There is no expression-side door (#763).
 */

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

describe("a record's derived `Hash` over a reached union component", () => {
  test("a payload-free union reached through an alias still separates (#609 filed case)", async () => {
    const module = await runProject([
      ["/flag.hex", "module Flag\n\n" + "export union Flag derives (Eq, Hash) = On | Off\n"],
      [
        "/flagalias.hex",
        "module Flagalias\n\n" + "import Flag\n" +
        "export type F = Flag\n" +
        "export fun on(): F = Flag.On\n" +
        "export fun off(): F = Flag.Off\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import Flagalias as F\n" +
        "export record Box derives (Eq, Hash) = {f: F}\n" +
        "export let onHash: Int = Hash.hash(Box({f = F.on()}))\n" +
        "export let offHash: Int = Hash.hash(Box({f = F.off()}))\n" +
        "export let equal: Bool = Box({f = F.on()}) == Box({f = F.off()})\n",
      ],
    ]);

    // At 6b46054 both arms were `__mixHash(0, 0)`: the walk missed `Flag` in
    // `module.unions` and took the `"0"` miss arm, while the imported
    // `__Hash_Flag` dictionary sat unused beside it.
    expect(module.onHash).not.toBe(module.offHash);
    // `Eq` has dispatched since #278; the two members must not disagree.
    expect(module.equal).toBe(false);
  });

  test("a payload-carrying union reached through an alias separates by payload", async () => {
    const module = await runProject([
      ["/shape.hex", "module Shape\n\n" + "export union Shape derives (Eq, Hash) = Dot | Circle(radius: Int)\n"],
      [
        "/shapealias.hex",
        "module Shapealias\n\n" + "import Shape\n" +
        "export type S = Shape\n" +
        "export fun dot(): S = Shape.Dot\n" +
        "export fun circle(r: Int): S = Shape.Circle(r)\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import Shapealias as S\n" +
        "export record Frame derives (Eq, Hash) = {s: S}\n" +
        "export let three: Int = Hash.hash(Frame({s = S.circle(3)}))\n" +
        "export let four: Int = Hash.hash(Frame({s = S.circle(4)}))\n" +
        "export let plain: Int = Hash.hash(Frame({s = S.dot()}))\n" +
        "export let threeAgain: Int = Hash.hash(Frame({s = S.circle(3)}))\n",
      ],
    ]);

    expect(module.three).not.toBe(module.four);
    expect(module.three).not.toBe(module.plain);
    // The law itself: equal values hash equally.
    expect(module.three).toBe(module.threeAgain);
  });

  test("a nominal record component reached through an alias separates (the record half)", async () => {
    const module = await runProject([
      ["/cell.hex", "module Cell\n\n" + "export record Cell derives (Eq, Hash) = {v: Int}\n"],
      [
        "/cellalias.hex",
        "module Cellalias\n\n" + "import Cell\n" +
        "export type C = Cell\n" +
        "export fun cell(v: Int): C = Cell({v = v})\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import Cellalias as C\n" +
        "export record Crate derives (Eq, Hash) = {c: C}\n" +
        "export let one: Int = Hash.hash(Crate({c = C.cell(1)}))\n" +
        "export let two: Int = Hash.hash(Crate({c = C.cell(2)}))\n" +
        "export let oneAgain: Int = Hash.hash(Crate({c = C.cell(1)}))\n",
      ],
    ]);

    expect(module.one).not.toBe(module.two);
    expect(module.one).toBe(module.oneAgain);
  });

  test("the direct-import spelling is unmoved (parity control)", async () => {
    const module = await runProject([
      ["/mark.hex", "module Mark\n\n" + "export union Mark derives (Eq, Hash) = Up | Down\n"],
      [
        "/main.hex",
        "module Main\n\n" + "import Mark\n" +
        "export record Slot derives (Eq, Hash) = {m: Mark}\n" +
        "export let up: Int = Hash.hash(Slot({m = Mark.Up}))\n" +
        "export let down: Int = Hash.hash(Slot({m = Mark.Down}))\n" +
        "export let upAgain: Int = Hash.hash(Slot({m = Mark.Up}))\n",
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
      ["/a.hex", "module A\n\n" + "export union Ring derives (Eq, Hash) = Nil | Node(size: Int)\n"],
      [
        "/b.hex",
        "module B\n\n" + "import A as Ring\n" +
        "export type R = Ring\n" +
        "export fun node(n: Int): R = Ring.Node(n)\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import B as R\n" +
        "let rings: Set({r: R}) = Set.add(Set.add(Set.empty, {r = R.node(3)}), {r = R.node(3)})\n" +
        "export let count: Int = Set.size(rings)\n" +
        "export let found: Bool = Set.contains(rings, {r = R.node(3)})\n" +
        "export let absent: Bool = Set.contains(rings, {r = R.node(4)})\n",
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
      ["/keys.hex", "module Keys\n\n" + "export union Key derives (Eq, Hash) = Anon | Named(id: Int)\n"],
      [
        "/keysalias.hex",
        "module Keysalias\n\n" + "import Keys as Key\n" +
        "export type K = Key\n" +
        "export fun named(id: Int): K = Key.Named(id)\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import Keysalias as K\n" +
        "let table: Map({k: K}, Int) =\n" +
        "    Map.set(Map.set(Map.empty, {k = K.named(7)}, 1), {k = K.named(7)}, 2)\n" +
        "export let entries: Int = Map.size(table)\n" +
        "export let bound: Bool = Map.containsKey(table, {k = K.named(7)})\n",
      ],
    ]);

    expect(module.entries).toBe(1);
    expect(module.bound).toBe(true);
  });

  test("the direct-import `Set` spelling is unmoved (parity control)", async () => {
    const module = await runProject([
      ["/tone.hex", "module Tone\n\n" + "export union Tone derives (Eq, Hash) = Flat | Sharp(step: Int)\n"],
      [
        "/main.hex",
        "module Main\n\n" + "import Tone\n" +
        "let tones: Set({t: Tone}) = Set.add(Set.add(Set.empty, {t = Tone.Sharp(2)}), {t = Tone.Sharp(2)})\n" +
        "export let count: Int = Set.size(tones)\n" +
        "export let found: Bool = Set.contains(tones, {t = Tone.Sharp(2)})\n",
      ],
    ]);

    expect(module.count).toBe(1);
    expect(module.found).toBe(true);
  });
});

describe("the evidence chain through structural layers", () => {
  test("`Vector` and tuple components over a reached union carry the selection", async () => {
    const module = await runProject([
      ["/beat.hex", "module Beat\n\n" + "export union Beat derives (Eq, Hash) = Rest | Hit(force: Int)\n"],
      [
        "/beatalias.hex",
        "module Beatalias\n\n" + "import Beat\n" +
        "export type B = Beat\n" +
        "export fun rest(): B = Beat.Rest\n" +
        "export fun hit(force: Int): B = Beat.Hit(force)\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import Beatalias as B\n" +
        "export record Bar derives (Eq, Hash) = {beats: Vector(B), lead: (B, Int)}\n" +
        "let soft: Bar = Bar({beats = [B.hit(1), B.rest()], lead = (B.hit(1), 0)})\n" +
        "let loud: Bar = Bar({beats = [B.hit(2), B.rest()], lead = (B.hit(1), 0)})\n" +
        "let leadShift: Bar = Bar({beats = [B.hit(1), B.rest()], lead = (B.hit(2), 0)})\n" +
        "let softAgain: Bar = Bar({beats = [B.hit(1), B.rest()], lead = (B.hit(1), 0)})\n" +
        "export let softHash: Int = Hash.hash(soft)\n" +
        "export let loudHash: Int = Hash.hash(loud)\n" +
        "export let leadHash: Int = Hash.hash(leadShift)\n" +
        "export let softAgainHash: Int = Hash.hash(softAgain)\n" +
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
      ["/inner.hex", "module Inner\n\n" + "export union Inner derives (Eq, Hash) = Zero | One\n"],
      [
        "/outer.hex",
        "module Outer\n\n" + "import Inner\n" +
        "export union Outer derives (Eq, Hash) = Wrap(inner: Inner)\n" +
        "export fun wrapZero(): Outer = Wrap(Inner.Zero)\n" +
        "export fun wrapOne(): Outer = Wrap(Inner.One)\n",
      ],
      [
        "/outeralias.hex",
        "module Outeralias\n\n" + "import Outer\n" +
        "export type O = Outer\n" +
        "export fun zero(): O = Outer.wrapZero()\n" +
        "export fun one(): O = Outer.wrapOne()\n",
      ],
      [
        "/main.hex",
        // Neither `Outer` nor `Inner` is spelled in this module — only the
        // alias `O`, itself two removes from either declaration.
        "import Outeralias as O\n" +
        "export record Cage derives (Eq, Hash) = {held: O}\n" +
        "export let zeroHash: Int = Hash.hash(Cage({held = O.zero()}))\n" +
        "export let oneHash: Int = Hash.hash(Cage({held = O.one()}))\n" +
        "export let zeroAgain: Int = Hash.hash(Cage({held = O.zero()}))\n",
      ],
    ]);

    expect(module.zeroHash).not.toBe(module.oneHash);
    expect(module.zeroHash).toBe(module.zeroAgain);
  });

  test("a union subject's slot over a reached nominal separates", async () => {
    const module = await runProject([
      ["/coin.hex", "module Coin\n\n" + "export record Coin derives (Eq, Hash) = {value: Int}\n"],
      [
        "/coinalias.hex",
        "module Coinalias\n\n" + "import Coin\n" +
        "export type Money = Coin\n" +
        "export fun coin(value: Int): Money = Coin({value = value})\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import Coinalias as Money\n" +
        "export union Purse derives (Eq, Hash) = Empty | Holding(coin: Money)\n" +
        "export let one: Int = Hash.hash(Holding(Money.coin(1)))\n" +
        "export let two: Int = Hash.hash(Holding(Money.coin(2)))\n" +
        "export let oneAgain: Int = Hash.hash(Holding(Money.coin(1)))\n" +
        "export let none: Int = Hash.hash(Empty)\n",
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
