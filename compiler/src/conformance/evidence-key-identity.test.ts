import { describe, expect, test } from "vitest";

import { PRE_REGISTERED_CONSTRAINTS } from "../constraints.js";
import { isGroundEvidence, serializeDictionaryEvidence } from "../passes/emitter/emitter.js";
import { compileFiles, projectDiagnostics } from "../support/test-project.js";
import type * as Core from "../syntax/core/index.js";
import { typeVariableId } from "../syntax/typed/tree.js";

/**
 * What Dictionary Sharing §4's CSE key rests on (#685).
 *
 * The key is internal — §4 says "any deterministic spelling serves" — so this
 * file pins nothing about how it *reads*. It pins the one property a key must
 * have: two different constraints must never spell one key. `#serializeEvidence`
 * has three live cases and two that are defence, and two of the three live ones
 * read a constraint **name**:
 *
 * - `S|name|type|components` for a structural node, and
 * - `P|name|instance`, the fallback the `Primitive` case takes when no source
 *   instance answers.
 *
 * A name is not in general a property of a constraint — two modules may each
 * declare a `Describe` — so those two reads are only safe because the
 * constraints they can be minted for are **pre-registered**, and §5.1.1 makes a
 * pre-registered name non-redeclarable. That is what the second and third
 * blocks below measure, and they are what should redden if a future change
 * lets a module-declared constraint reach either seat. The repair then is to
 * thread identities through the key the way `serializeDictionaryEvidence`
 * already does — a decision, taken deliberately, rather than a silent drift.
 *
 * The first block is the `D|` case itself, which #685 moved off
 * `evidence.constraint ?? constraint` and onto the node's identity — read
 * through `dictionaryIdentity`, the same rule the emission sites resolve a
 * `Dictionary` node's constraint by, so the key and a use site cannot name
 * different constraints for one node. That case is unreachable from the key
 * path today (the ground gate, pinned in the second block), so neither change
 * moves a key the compiler mints, and it is pinned here by direct call rather
 * than through emission.
 *
 * `edition-evidence-identity.test.ts` carries the planner half of the `P|`
 * producers claim — a declared constraint's edition takes `Instance` evidence
 * and a pre-registered one keeps `Primitive` (#684) — and is not rebuilt here.
 */

const dictionary = (
  constraintIdentity: string,
  variable: number,
  extra: Partial<Core.DictionaryEvidence> = {},
): Core.DictionaryEvidence => ({
  kind: "Dictionary",
  variable: typeVariableId(variable),
  constraintIdentity,
  ...extra,
});

describe("the `D|` case keys on the constraint's identity, not on a spelling", () => {
  /**
   * The defect #685 names, at the smallest scale that shows it: two modules
   * each declare a `Describe`, and one evidence parameter answers each. Under
   * the name-keyed spelling these two nodes were one key.
   */
  test("one spelling over two declarations gives two keys", () => {
    const first = dictionary("3:Describe", 7, { constraint: "Describe" });
    const second = dictionary("9:Describe", 7, { constraint: "Describe" });

    expect(serializeDictionaryEvidence(first))
      .not.toBe(serializeDictionaryEvidence(second));
  });

  /**
   * The other half, and the one a subset of the repair would fail: an import
   * may rename a constraint, so the *same* declaration reaches two modules
   * under two spellings and must still be one key. Keying on the spelling made
   * this pair two keys; keying on the identity makes it one.
   */
  test("two spellings over one declaration give one key", () => {
    const declared = dictionary("3:Describe", 7, { constraint: "Describe" });
    const renamed = dictionary("3:Describe", 7, { constraint: "Portray" });

    expect(serializeDictionaryEvidence(declared))
      .toBe(serializeDictionaryEvidence(renamed));
  });

  /**
   * The two fields #685 left alone. A key that collapsed these would share one
   * binding between two different evidence parameters, which is the failure the
   * constraint half exists to prevent, reached from the other side.
   */
  test("the variable and the entailment path still separate", () => {
    const base = dictionary("3:Describe", 7);

    expect(serializeDictionaryEvidence(base))
      .not.toBe(serializeDictionaryEvidence(dictionary("3:Describe", 8)));
    expect(serializeDictionaryEvidence(base))
      .not.toBe(serializeDictionaryEvidence(dictionary("3:Describe", 7, { path: ["base"] })));
    expect(serializeDictionaryEvidence(dictionary("3:Describe", 7, { path: ["base"] })))
      .not.toBe(serializeDictionaryEvidence(dictionary("3:Describe", 7, { path: ["other"] })));
  });
});

describe("the `D|` case is defence: no dictionary node reaches the key path", () => {
  /**
   * `#hoistStructuralEvidence` asks `isGroundEvidence` before it asks for a
   * key, so the serializer never sees a tree this answers `false` for — and it
   * recurses through exactly the children groundness recurses through, so a
   * `Dictionary` node at any depth keeps the whole tree off the key path.
   * Dictionary Sharing §3.3/§4 state the same rule normatively: evidence
   * containing a free dictionary parameter is not ground and never hoists.
   *
   * Each row is the same tree twice, differing only in whether its leaf is the
   * free parameter or a ground one, so a mutation that made `isGroundEvidence`
   * blind to `Dictionary` reddens rather than leaving a row that passes for the
   * shape's own reasons.
   */
  const free: Core.Evidence = dictionary("hex:Show", 3, { constraint: "Show" });
  const ground: Core.Evidence = { kind: "Primitive", instance: "Int" };
  const structural = (leaf: Core.Evidence): Core.Evidence => ({
    kind: "Structural",
    type: { kind: "Tuple", elements: [{ kind: "Primitive", name: "Int" }] },
    components: [{ key: "0", evidence: leaf }],
  });
  const instance = (leaf: Core.Evidence): Core.Evidence => ({
    kind: "Instance",
    dictionary: "__Show_Box",
    arguments: [{ constraint: "Show", evidence: leaf }],
  });

  test("the bare node is not ground", () => {
    expect(isGroundEvidence(free)).toBe(false);
    expect(isGroundEvidence(ground)).toBe(true);
  });

  test("a structural component carrying one is not ground", () => {
    expect(isGroundEvidence(structural(free))).toBe(false);
    expect(isGroundEvidence(structural(ground))).toBe(true);
  });

  test("an instance argument carrying one is not ground", () => {
    expect(isGroundEvidence(instance(free))).toBe(false);
    expect(isGroundEvidence(instance(ground))).toBe(true);
  });

  test("one nested two levels down is not ground either", () => {
    expect(isGroundEvidence(instance(structural(free)))).toBe(false);
    expect(isGroundEvidence(instance(structural(ground)))).toBe(true);
  });
});

/**
 * A constraint requirement as the checker left it, read off a whole compile.
 *
 * The four fields are exactly the ones elaboration's `evidence` switches on, so
 * a row says which evidence kind the requirement became without this file
 * re-deriving one: reported requirements take `Error`, requirements with a
 * dictionary take `Instance`, `structural` ones take `Structural`, and what is
 * left switches on the type — a primitive to `Primitive`, a variable to
 * `Dictionary`.
 */
interface Requirement {
  readonly name: string;
  readonly identity: string;
  readonly structural: boolean;
  readonly dictionary: boolean;
  readonly unsatisfied: boolean;
  readonly typeKind: string;
}

/**
 * Every `Typed.Constraint` in a tree, found by shape.
 *
 * `Typed` has three constraint-ish records carrying an `identity`, and only
 * this one carries a `type` and a `span` without a `kind` — `SchemeConstraint`
 * has neither, and `ConstraintItem` is a `kind: "ConstraintDeclaration"` item.
 * The counts asserted below are what keeps the discriminator honest: a walk
 * that stopped finding requirements would fail rather than pass vacuously.
 */
function requirements(root: unknown): readonly Requirement[] {
  const seen = new Set<object>();
  const found: Requirement[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const element of node) visit(element);
      return;
    }
    const record = node as Record<string, unknown>;
    if (
      typeof record["name"] === "string" && typeof record["identity"] === "string" &&
      record["type"] !== undefined && record["span"] !== undefined &&
      record["kind"] === undefined
    ) {
      found.push({
        name: record["name"],
        identity: record["identity"],
        structural: record["structural"] === true,
        dictionary: record["dictionary"] !== undefined,
        unsatisfied: record["unsatisfied"] === true,
        typeKind: String((record["type"] as { readonly kind?: unknown }).kind),
      });
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(root);
  return found;
}

/**
 * A module declaring, honoring and consuming its own constraint, beside a main
 * module that reaches every structural shape the checker satisfies without an
 * instance: tuples, structural records, vectors, sets, maps, `Bool` and `Unit`,
 * under `Eq`, `Ord`, `Show`, `Hash`, `Concat` and `Iterable`. The prelude is
 * compiled with it, so the walk below covers the whole stdlib as well.
 */
const DECLARED_MODULE = [
  "export constraint Describe<a> =",
  "    describe(subject: a): String",
  "honor Describe<Int> =",
  '    describe(n) = "int ${n}"',
  "honor Describe<Bool> =",
  '    describe(b) = "bool"',
  "export record Pair(a, b) = {left: a, right: b}",
  "honor<a: Describe, b: Describe> Describe<Pair(a, b)> =",
  '    describe(p) = "${p.left.describe()}/${p.right.describe()}"',
  "export fun tell<a: Describe>(x: a): String = describe(x)",
  "export fun tellPair<a: Describe, b: Describe>(p: Pair(a, b)): String = describe(p)",
  "",
].join("\n");

const MAIN_MODULE = [
  'import Declared from "./declared"',
  "export record Point derives (Eq, Ord, Show, Hash) = {x: Int, y: Int}",
  "export let shownPair: String = show((1, 2))",
  'export let interpolated: String = "pair ${(3, 4)}"',
  "export let shownUnit: String = show(())",
  "export let sameUnit: Bool = () == ()",
  "export let shownBool: String = show(True)",
  "export let shownRecord: String = show({x = 1, y = 2})",
  "export let shownVector: String = show([1, 2, 3])",
  "export let vectorEq: Bool = [1, 2] == [1, 2]",
  "export let setShown: String = show(Set.add(Set.add(Set.empty, (1, 2)), (3, 4)))",
  'export let mapShown: String = show(Map.set(Map.empty, (1, 2), "v"))',
  "export let tupleOrder: Bool = (1, 2) < (3, 4)",
  "export let vectorOrder: Bool = [1, 2] < [3, 4]",
  "export let vectorJoin: Vector(Int) = [1] ++ [2]",
  "export let recordOrder: Bool = {x = 1} < {x = 2}",
  "export fun counted(xs: Vector(Int)): Seq(Int) = xs.toSeq()",
  "export fun showPair<a: Show, b: Show>(x: a, y: b): String = show((x, y))",
  "export fun both<a: (Eq, Show)>(x: a, y: a): String = show(x) ++ show(y)",
  "export fun hashed<a: Hash>(x: a): Int = Hash.hash(x)",
  "export fun joined<a: Concat>(x: a, y: a): a = x ++ y",
  "let one: Int = 1",
  "export let told: String = Declared.tell(one)",
  "export let toldPair: String = Declared.tell(Declared.Pair({left = one, right = True}))",
  "export let point: Point = Point({x = 1, y = 2})",
  "export let pointShown: String = show(point)",
  "export let pointsEqual: Bool = point == point",
  "",
].join("\n");

describe("the live name-reads see pre-registered names only", () => {
  const compiled = compileFiles([
    ["/declared.hex", DECLARED_MODULE],
    ["/main.hex", MAIN_MODULE],
  ]);
  const rows = compiled.modules.flatMap(({ typed }) => [...requirements(typed)]);
  const preRegistered = (identity: string): boolean =>
    PRE_REGISTERED_CONSTRAINTS.some((name) => identity === `hex:${name}`);

  test("the corpus compiles clean, and the walk finds it", () => {
    // KNOWN COMPILER DEFECT, reported rather than routed around — see this
    // file's report. `MAIN_MODULE`'s `Declared.tell(Declared.Pair({...}))`
    // demands `Describe<Pair(Int, Bool)>` from *outside* `/declared.hex`; that
    // instance is `honor<a: Describe, b: Describe> Describe<Pair(a, b)>`, whose
    // own binder list in turn demands `Describe<Int>` and `Describe<Bool>` — two
    // instances that live in the very same external module. Reduced to a
    // minimal repro: a module declaring `Describe`, honoring it at `Int` and at
    // `Bool`, and a parameterized `Describe<Pair(a, b)>` instance over both,
    // compiles clean on its own (proven directly, and by every other row in
    // this corpus), but the moment a *second* module reaches the parameterized
    // instance only through a module alias — `Declared.tell(Declared.Pair(...))`,
    // never a bare name — the binder demand at `Int`/`Bool` reports
    // `` type `Int` has no `Describe` instance `` and `` type `Bool` has no
    // `Describe` instance `` even though both are declared two lines above the
    // instance that needs them. This is the same starved-local-table shape
    // `#587`/`#763` hit elsewhere (`transparent-representation.test.ts`): the
    // checker's own-module `#instances` map is never faulted for the *outer*
    // demand (`Describe<Pair(Int, Bool)>` resolves, and reaches the
    // parameterized instance fine), only for the instance's *own* recursive
    // binder demands, which under #762 can now be reached with no bare name for
    // either constraint or record ever having crossed into the caller's module.
    // Both halves matter otherwise. A rejected program satisfies the pins below
    // for free, and so does a discriminator that has stopped matching anything.
    expect(compiled.diagnostics).toEqual([]);
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.some(({ identity }) => identity === "0:Describe")).toBe(true);
  });

  /**
   * The `S|name|` read. `#validate` marks a requirement structural at six
   * spellings and no others — the four `STRUCTURAL_CONSTRAINTS` over tuples,
   * structural records, vectors, sets, maps and the `Bool` pin, `Concat` over a
   * vector spine, and the provided `Iterable` rows — and every one of the six
   * is pre-registered, so the name in the key determines the declaration.
   *
   * Asserted as an equality rather than a subset: a seventh spelling reaching
   * this seat is a decision about the key, and it should have to be made here.
   *
   * Not because a gate losing its name check would otherwise go unnoticed —
   * dropping the `Bool` pin's reddens eight rows elsewhere in the suite, and a
   * tighter drift still reddened four. What this row buys is a failure that
   * *names* what drifted: the diff of the closed set against the spellings
   * actually reaching the seat, in the file whose subject is the key, rather
   * than an unrelated emission row somewhere else.
   */
  test("every structural requirement names a pre-registered constraint", () => {
    const structural = rows.filter(({ structural: flag }) => flag);

    expect(structural.length).toBeGreaterThan(0);
    expect([...new Set(structural.map(({ name }) => name))].sort())
      .toEqual(["Concat", "Eq", "Hash", "Iterable", "Ord", "Show"]);
    expect([...new Set(structural.map(({ identity }) => identity))].sort())
      .toEqual(["hex:Concat", "hex:Eq", "hex:Hash", "hex:Iterable", "hex:Ord", "hex:Show"]);
    expect(structural.every(({ identity }) => preRegistered(identity))).toBe(true);
  });

  /**
   * The `P|name|` read. Elaboration mints `Primitive` evidence for a
   * requirement at a primitive that is neither reported nor satisfied by a
   * dictionary; the planner mints it too, behind `isPreRegisteredIdentity`
   * (pinned in `edition-evidence-identity.test.ts`). This is the elaboration
   * half: every such requirement in the corpus is pre-registered, so the
   * fallback's name determines its declaration too.
   */
  test("every bare-primitive requirement names a pre-registered constraint", () => {
    const bare = rows.filter(({ structural, dictionary: named, unsatisfied, typeKind }) =>
      !structural && !named && !unsatisfied && typeKind === "Primitive"
    );

    expect(bare.length).toBeGreaterThan(0);
    expect(bare.every(({ identity }) => preRegistered(identity))).toBe(true);
  });

  /**
   * The same two facts from the other side, and the one a reader can check
   * against the source: a constraint a module declared reaches emission as
   * `Instance` evidence where an instance answers it and as `Dictionary`
   * evidence at a type variable. Never `Structural`, never bare `Primitive` —
   * so neither name-read can ever see the one spelling that would not
   * determine a declaration.
   */
  test("a module-declared constraint reaches neither seat", () => {
    // KNOWN COMPILER DEFECT, the same one flagged above: the failed
    // `Describe<Int>`/`Describe<Bool>` binder resolution inside
    // `Describe<Pair(a, b)>`'s own instance leaves those two requirements
    // `reported` rather than resolved, which mints them a second, unrelated
    // identity (`1:Describe`) instead of unifying them with the `0:Describe`
    // every other occurrence in the corpus shares — so the row set below has
    // five entries instead of the four a clean compile produces. Left as the
    // correct expectation; see the report for this file.
    const declared = rows.filter(({ identity }) => !identity.startsWith("hex:"));

    expect(declared.length).toBeGreaterThan(0);
    expect(
      [...new Set(declared.map(({ name, identity, structural, dictionary: named, typeKind }) =>
        `${name} ${identity} structural=${structural} dictionary=${named} ${typeKind}`
      ))].sort(),
    ).toEqual([
      "Describe 0:Describe structural=false dictionary=false Variable",
      "Describe 0:Describe structural=false dictionary=true NominalRecord",
      "Describe 0:Describe structural=false dictionary=true Primitive",
      "Describe 0:Describe structural=false dictionary=true Union",
    ]);
  });
});

describe("what keeps a pre-registered name canonical", () => {
  /**
   * §5.1.1's ban, which is the whole reason `S|` and `P|` may read a name: a
   * module cannot mint a second constraint that answers to one of the six.
   */
  test("a pre-registered name cannot be redeclared", () => {
    expect(projectDiagnostics(
      "constraint Eq<a> =\n    equals(left: a, right: a): Bool\n",
    )).toEqual(["constraint `Eq` is pre-registered and cannot be redeclared"]);
  });

  // "The other door onto the name" this file used to pin here — an import
  // renaming a declared constraint onto a pre-registered spelling, refused as
  // a collision — has no seat left under #762. An import binds a module alias
  // and nothing smaller: it does not bind the constraint's name at all, renamed
  // or otherwise, so there is no route left by which importing can put a
  // second `Eq` in the constraint namespace. (A module alias *can* be spelled
  // `Eq`, but the companion-fallback tests pin that a module alias and a
  // constraint of the same spelling occupy different namespaces and do not
  // collide — `companion-fallback.test.ts`'s "the module's own record wins,
  // with no diagnostic at all" is the type-namespace instance of the same
  // fact.) So the property this test pinned — that `#validate` never sees a
  // module-declared constraint reading back as `Eq` — is now guaranteed by a
  // stronger fact than a collision refusal: nothing an importer writes can
  // bind a constraint name at all.

  /**
   * Why a declared constraint cannot reach the `S|` seat even where the gate
   * names a shape rather than a constraint: Constraints §5.4/§9.3 refuse a
   * structural instance head outright, so the only structural shape a declared
   * constraint can be honored at is none of them. `Bool` is the exception the
   * gate itself handles — it is an ordinary union head — and that arm reads the
   * four derivable spellings.
   */
  test("a declared constraint cannot be honored at a structural head", () => {
    const declaration = "constraint Describe<a> =\n    describe(subject: a): String\n";

    for (const head of ["(Int, Int)", "Vector(Int)", "{x: Int}"]) {
      expect(projectDiagnostics(
        `${declaration}honor Describe<${head}> =\n    describe(v) = "shape"\n`,
      )).toContain("an instance head must name a primitive or nominal type constructor");
    }
  });

  /**
   * And what the checker does with the demand instead of satisfying it
   * structurally. This is the row that reddens if a `#validate` gate loses its
   * name check: the refusal becomes a silent structural satisfaction, and a
   * declared `Describe` lands in the key as `S|Describe|Tuple(Int,Int)|`.
   */
  test("a declared constraint demanded at a tuple is refused, not satisfied", () => {
    expect(projectDiagnostics(
      "constraint Describe<a> =\n" +
        "    describe(subject: a): String\n" +
        "honor Describe<Int> =\n" +
        '    describe(n) = "int"\n' +
        "let pair: (Int, Int) = (1, 2)\n" +
        "export let told: String = describe(pair)\n",
    )).toEqual(["type `(Int, Int)` has no `Describe` instance"]);
  });
});
