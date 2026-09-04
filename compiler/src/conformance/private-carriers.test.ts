import { describe, expect, test } from "vitest";

import {
  compileProject,
  emitTypeScriptPreview,
  Source,
  type CompiledProject,
} from "../index";
import type { Diagnostic } from "../support/diagnostics.js";
import { compileFiles } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **Modules §4.3's boundary rule read over every exported
 * carrier** (#621; FFI Part 7 correction record §14.4).
 *
 * The refusal was collected per *binding*, over `let`, `fun` and extern rows
 * alone. Four other carriers put a type into a module's exported `.d.ts` face —
 * a type alias's target, a record's fields, a union constructor's payload, an
 * exception's payload — and none was visited, so each carried a module-private
 * nominal into the public face with zero Hexagon diagnostics and a `TS2304` from
 * `tsc`. The union case was worse than a near-miss: the declaration emitter's
 * union arm pushed its `type` row for *every* union, exported or not, so every
 * private union in every module was published in its shipped `.d.ts`,
 * representation included.
 *
 * The two halves land together, which is what leaves no state in which a clean
 * compile ships a broken or leaking declaration file: the checker refuses every
 * face that could reach a private union, and the emitter stops writing one.
 *
 * A sixth exported face joined the family later, and it is the only one that is
 * no carrier at all: an **exported constraint's member signatures** (#626). No
 * `.d.ts` row of its own rides Part 7's carrier list, and the refusal stands on
 * two legs. The one that never was the emitter's: §4.3's rationale reads a
 * member signature verbatim — an honor abroad must produce what the signature
 * names and can neither name nor build the type. And the emitter's after all:
 * member signatures reach a declaration file through Parts 8–9's deliberate
 * surfaces, where the public-evidence closure's `Constraint.Dictionary<a>`
 * interface renders the member set (FFI Part 9 §2.2; Modules §11.5), and a
 * private nominal there is #621's failure class exactly. Its scope lines are
 * pinned beside it — default bodies stay free, and a *private* constraint
 * gating an export is the lawful sealing idiom.
 */

/** One compiled project, keyed by path. */
function project(files: Readonly<Record<string, string>>): CompiledProject {
  return compileProject(
    Object.entries(files).map(([path, text], index) =>
      new Source.File(Source.fileId(index), path, text)
    ),
  );
}

/** Every diagnostic of a one-module program, in order. */
function diagnose(source: string): readonly Diagnostic[] {
  return project({ "/src/main.hex": source }).diagnostics;
}

/** Every diagnostic *message* of a one-module program, in order. */
function messages(source: string): readonly string[] {
  return diagnose(source).map(({ message }) => message);
}

/** The one diagnostic a program is expected to draw. */
function lone(source: string): Diagnostic {
  const drawn = diagnose(source);
  expect(drawn.map(({ message }) => message)).toHaveLength(1);
  return drawn[0]!;
}

/** The source text a span covers — how a seat assertion says *where*. */
function at(source: string, span: Source.Span): string {
  return source.slice(span.start.offset, span.end.offset);
}

/** One module of a compiled project, by path. */
function moduleOf(compiled: CompiledProject, path: string) {
  const found = compiled.modules.find(({ source }) => source.path === path);
  if (found === undefined) throw new Error(`${path} was not emitted`);
  return found;
}

/** The shipped `.d.ts` text of a one-module program. */
function declarations(source: string): string {
  return moduleOf(project({ "/src/main.hex": source }), "/src/main.hex").declarations.text;
}

/** The inspection-only preview text — the Playground's declarations pane. */
function preview(source: string): string {
  return emitTypeScriptPreview(moduleOf(project({ "/src/main.hex": source }), "/src/main.hex").core)
    .text;
}

/** Every emitted module's declarations, plus `hex.d.ts` where one was emitted. */
function declarationSet(compiled: CompiledProject): Record<string, string> {
  const files: Record<string, string> = {};
  for (const module of compiled.modules) {
    files[module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] =
      module.declarations.text;
  }
  if (compiled.runtimeDeclarations !== undefined) {
    files["src/hex.d.ts"] = compiled.runtimeDeclarations.text;
  }
  return files;
}

const HIDDEN = "record Hidden = {n: Int}\n";

describe("the rule reads every exported carrier", () => {
  // One `describe` per carrier rather than one representative: each is its own
  // seat in the checker, reading its own table for its own annotations, and a
  // rule generalized from one probed carrier is exactly what let three of the
  // four through in the first place.

  test("an exported type alias's target", () => {
    expect(messages(HIDDEN + "export type W = Hidden\n")).toEqual([
      "exported type alias `W` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the alias private",
    ]);
  });

  test("an exported record's field", () => {
    expect(messages(HIDDEN + "export record Outer = {h: Hidden}\n")).toEqual([
      "exported record `Outer` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the record private",
    ]);
  });

  test("an exported union's constructor payload", () => {
    expect(messages(HIDDEN + "export union U = C(h: Hidden) | D\n")).toEqual([
      "exported union `U` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the union private",
    ]);
  });

  test("an exported exception's payload", () => {
    expect(messages(HIDDEN + "export exception Boom(payload: Hidden)\n")).toEqual([
      "exported exception `Boom` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the exception private",
    ]);
  });

  test("an extern type its own module keeps private", () => {
    // The `.d.ts` cannot declare an extern type's representation at all — the
    // compiler does not hold one — so this is the arm for which "materialize a
    // non-exported row" was never even available.
    expect(messages(
      'extern from "./host.js"\n    type Hidden\n' +
        "export record Outer = {h: Hidden}\n",
    )).toEqual([
      "exported record `Outer` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the record private",
    ]);
  });

  test("the exported binding the rule already read is unchanged", () => {
    expect(messages(HIDDEN + "export fun peek(h: Hidden): Int = h.n\n")).toEqual([
      "exported binding `peek` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the binding private",
    ]);
  });
});

describe("the seat is the offending mention's, and the label the declaration's", () => {
  test("a record field reports at the field's annotation, labelling the declaration", () => {
    const source = HIDDEN + "export record Outer = {a: Int, h: Hidden}\n";
    const drawn = lone(source);

    // Not the ten-field head indicted for one field's fault: the eye lands on
    // the mention the message describes.
    expect(at(source, drawn.primary)).toBe("Hidden");
    expect(drawn.labels?.map(({ message }) => message)).toEqual([
      "`Hidden` is declared private here",
    ]);
    expect(at(source, drawn.labels![0]!.span)).toBe("record Hidden = {n: Int}");
  });

  test("a constructor slot reports at the slot's annotation", () => {
    const source = HIDDEN + "export union U = D | C(n: Int, h: Hidden)\n";
    const drawn = lone(source);
    expect(at(source, drawn.primary)).toBe("Hidden");
    expect(at(source, drawn.labels![0]!.span)).toBe("record Hidden = {n: Int}");
  });

  test("an exception slot reports at the slot's annotation", () => {
    const source = HIDDEN + "export exception Boom(payload: Hidden)\n";
    const drawn = lone(source);
    expect(at(source, drawn.primary)).toBe("Hidden");
    expect(at(source, drawn.labels![0]!.span)).toBe("record Hidden = {n: Int}");
  });

  test("an alias reports at its right-hand side", () => {
    const source = HIDDEN + "export type W = Hidden\n";
    const drawn = lone(source);
    expect(at(source, drawn.primary)).toBe("Hidden");
    expect(at(source, drawn.labels![0]!.span)).toBe("record Hidden = {n: Int}");
  });

  test("a nested occurrence anchors at the whole written annotation", () => {
    // §4.3: the seat is the carrier's own annotation, not the sub-annotation of
    // the occurrence inside it — `token: Vector(Token)` anchors at
    // `Vector(Token)`, which is the type the field actually writes.
    const source = "record Token = {n: Int}\n" +
      "export record Cursor = {token: Vector(Token)}\n";
    const drawn = lone(source);
    expect(at(source, drawn.primary)).toBe("Vector(Token)");
    expect(drawn.message).toContain("private type `Token`");
    expect(at(source, drawn.labels![0]!.span)).toBe("record Token = {n: Int}");
  });

  test("the private union's own declaration is what a union label points at", () => {
    // The label is the span the checker's own table holds for the declaration,
    // and the three tables do not agree on its width: a union's is its head
    // name, a record's the whole declaration, an extern type's its row. All
    // three land on the line the `export`/`opaque` keyword goes on, which is
    // what §4.3 asks of the label; none is the *use* the message came from.
    const source = "union Flag = On | Off\nexport record Outer = {f: Flag}\n";
    const drawn = lone(source);
    expect(at(source, drawn.labels![0]!.span)).toBe("Flag");
    expect(drawn.labels![0]!.span.start.line).toBe(
      // The declaration's line, not the field's.
      drawn.primary.start.line - 1,
    );
  });

  test("the private extern row is what an extern label points at", () => {
    const source = 'extern from "./host.js"\n    type Hidden\n' +
      "export record Outer = {h: Hidden}\n";
    const drawn = lone(source);
    expect(at(source, drawn.labels![0]!.span)).toBe("type Hidden");
  });
});

describe("the rule is local: a type declared elsewhere is refused at home (#629)", () => {
  // The private nominals the rule reads are the module's **own**. Records and
  // unions have practised this since #605 (`representationVisible` is stamped
  // false on every imported copy); the extern arm now asks the same question of
  // the module's own extern-type table, whose imported entries are exported by
  // construction. What leaves the restraint with nothing unguarded is that
  // every route into a consumer's face runs through some exported face of the
  // home module — a carrier, a binding, or (since #626) an exported
  // constraint's member signatures — and every one is refused *there*, in the
  // one module holding the declaration the label points at and able to perform
  // the remedy the message names. The unnameability backstop stands behind
  // that: a consumer cannot name the type, so no complete exported signature of
  // its own (§4.1.1) could mention it regardless. These tests are the restraint
  // measured rather than argued, the constraint route included.

  const PRIVATE_EXTERN = 'extern from "./lib.js"\n    type Hidden\n';

  test("the alias route reports once, at home, with its label", () => {
    // Formerly the shape with no declaration in reach: the consumer's table held
    // nothing to label, so its report shipped bare and told `main` to export a
    // type declared in `lib`. Now `lib`'s own alias — a carrier since #621 —
    // carries the arc alone, and every diagnostic in the family has its label.
    const lib = PRIVATE_EXTERN + "export type Exposed = Hidden\n";
    const compiled = project({
      "/src/lib.hex": lib,
      "/src/main.hex": 'import Lib\n' +
        "export record Wrap = {h: Lib.Exposed}\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported type alias `Exposed` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the alias private",
    ]);
    const [home] = compiled.diagnostics;
    expect(home!.labels?.map(({ message }) => message)).toEqual([
      "`Hidden` is declared private here",
    ]);
    // In `lib`, where the one-keyword fix goes — never across the file boundary
    // (§4.2.1).
    expect(at(lib, home!.labels![0]!.span)).toBe("type Hidden");
  });

  test("the binding route: the consumer's own exported face draws nothing", () => {
    // The consumer's signature genuinely mentions `Hidden` — `Exposed` expands
    // to it — and that is the case for the restraint, not against it: both of
    // `lib`'s exports are refused at home, so the consumer's report would be a
    // third telling of one defect, addressed to the one module that cannot fix
    // it.
    const compiled = project({
      "/src/lib.hex": PRIVATE_EXTERN + "export type Exposed = Hidden\n" +
        "export fun peek(h: Hidden): Hidden = h\n",
      "/src/main.hex": 'import Lib\n' +
        "export fun g(h: Lib.Exposed): Lib.Exposed = Lib.peek(h)\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported type alias `Exposed` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the alias private",
      "exported binding `peek` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the binding private",
    ]);
    expect(compiled.diagnostics.every(({ labels }) => labels?.length === 1)).toBe(true);
  });

  test("the inference route carries nothing an annotation did not", () => {
    // With no exported alias, the consumer cannot *spell* `Hidden`, and
    // §4.1.1's completeness rule means it cannot export a face over it either:
    // an exported binding's scheme is what its annotations write. So the route
    // closes on its own terms — the only word the consumer hears is about the
    // annotation it owes, never about a type it cannot name.
    const compiled = project({
      "/src/lib.hex": PRIVATE_EXTERN + "export fun peek(h: Hidden): Hidden = h\n",
      "/src/main.hex": 'import Lib\n' + "export let g = Lib.peek\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported binding `peek` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the binding private",
      "exported value `g` requires a type annotation",
    ]);
  });

  test("the constraint route reports at home too, and only there", () => {
    // Measured before the route had a home refusal (#631, for #626's dossier):
    // `lib` alone drew nothing, because an exported constraint was no carrier,
    // and the consumer was stopped by §4.1.1 plus unnameability alone. Since
    // #626 the member signature is the family's sixth face, so the refusal lands
    // where the fix does — in `lib`, at the member, with the label on `Hidden`'s
    // row — and the consumer still hears only about the annotation it owes.
    const lib = 'extern from "./lib.js"\n    type Hidden\n' +
      "export constraint Probe<a> =\n    probe(x: a): Hidden\n";
    const consumer = 'import Lib\n' +
      "export fun g<a: Lib.Probe>(x: a) = Lib.probe(x)\n";
    const alone = project({ "/src/lib.hex": lib }).diagnostics;
    expect(alone.map(({ message }) => message)).toEqual([
      "exported constraint `Probe` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the constraint private",
    ]);
    expect(at(lib, alone[0]!.primary)).toBe("probe(x: a): Hidden");
    expect(at(lib, alone[0]!.labels![0]!.span)).toBe("type Hidden");
    // The consumer adds nothing about `Hidden`: locality holds here as at every
    // other face, and the unnameability backstop stands behind it — `main`
    // cannot spell the type, so no complete exported signature of its own could
    // mention it, and the incomplete one it wrote is refused as incomplete.
    const compiled = project({ "/src/lib.hex": lib, "/src/main.hex": consumer });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported constraint `Probe` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the constraint private",
      "exported function `g` requires a complete signature; add a return type",
    ]);
  });

  test("and the same shape over a private *record* draws exactly the same", () => {
    // The parity control for the test above: the record arm has been local since
    // #605 and the extern arm since #629, so the two answer this program
    // identically — one refusal at `lib`'s member, one completeness error at
    // `main`, and no word to `main` about a type it cannot name.
    const consumer = 'import Lib\n' +
      "export fun g<a: Lib.Probe>(x: a) = Lib.probe(x)\n";
    const compiled = project({
      "/src/lib.hex": "record Hidden = {n: Int}\n" +
        "export constraint Probe<a> =\n    probe(x: a): Hidden\n",
      "/src/main.hex": consumer,
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported constraint `Probe` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the constraint private",
      "exported function `g` requires a complete signature; add a return type",
    ]);
  });

  test("an elsewhere-**exported** extern type in an exported face is lawful", async () => {
    // The locality gate the extern arm lacked, read from the other side. This
    // program was refused before the repair — the consumer imports the alias,
    // never the extern type, so the home module's public row was in no table the
    // consumer could consult and read as private. Nothing was wrong with it: the
    // shipped declarations import the type and `tsc` accepts them.
    const compiled = project({
      "/src/lib.hex": 'extern from "./lib.js"\n    export type Shown\n' +
        "export type Alias = Shown\n",
      "/src/main.hex": 'import Lib\n' +
        "export record Wrap = {h: Lib.Alias}\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(moduleOf(compiled, "/src/main.hex").declarations.text).toContain(
      'import type { Shown } from "./lib.js";',
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("and across two hops, with the import minted at the declaring module", async () => {
    // The route the repair opens is now reachable through an intermediary, and
    // the seat where that could go wrong is the emitted import's provenance: an
    // alias is transparent, so `main`'s face is `Shown` — a name `mid` never
    // declared and only passed along. The mint must therefore name `lib`, the
    // declaring module, never the module `main` actually imported from. Pinned
    // because nothing else in the suite reaches this arm through two hops.
    const compiled = project({
      "/src/lib.hex": 'extern from "./lib.js"\n    export type Shown\n',
      "/src/mid.hex": 'import Lib\nexport type Alias = Lib.Shown\n',
      "/src/main.hex": 'import Mid\n' +
        "export record Wrap = {h: Mid.Alias}\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(moduleOf(compiled, "/src/main.hex").declarations.text).toBe(
      'import type { Shown } from "./lib.js";\n' +
        "export type Wrap = { h: Shown };\n" +
        "export declare const Wrap: (record: { h: Shown }) => Wrap;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a module's own private extern type is still refused, imports notwithstanding", () => {
    // Locality withholds the check from types that live elsewhere; it does not
    // weaken it at home. `main` here has both an import and a private extern row
    // of its own, and only its own is read.
    const main = 'import Lib\n' +
      'extern from "./host.js"\n    type Own\n' +
      "export record Wrap = {a: Lib.Shown, b: Own}\n";
    const compiled = project({
      "/src/lib.hex": 'extern from "./lib.js"\n    export type Shown\n',
      "/src/main.hex": main,
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported record `Wrap` exposes private type `Own`; " +
        "export the type, perhaps opaquely, or keep the record private",
    ]);
    expect(at(main, compiled.diagnostics[0]!.labels![0]!.span)).toBe("type Own");
  });
});

describe("a private alias launders nothing, and is never the fault", () => {
  test("an alias of a private nominal in an exported field is refused", () => {
    // Transparency cuts both ways (Preamble §4): the expansion *is* the face, so
    // the nominal in it is refused the same. The message names the nominal the
    // expansion reached, the seat stays the field's own annotation — the one
    // spelling `Alias` — and the label is what resolves the two spellings.
    const source = HIDDEN + "type Alias = Hidden\n" +
      "export record Outer = {a: Alias}\n";
    const drawn = lone(source);

    expect(drawn.message).toBe(
      "exported record `Outer` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the record private",
    );
    expect(at(source, drawn.primary)).toBe("Alias");
    expect(at(source, drawn.labels![0]!.span)).toBe("record Hidden = {n: Int}");
  });

  test("an alias of an exported nominal is not refused, and the face is the expansion", () => {
    const source = "export record Shown = {n: Int}\ntype Alias = Shown\n" +
      "export record Outer = {s: Alias}\n";
    expect(messages(source)).toEqual([]);
    // §4.3's own sentence: display stickiness yields to visibility.
    expect(declarations(source)).toContain("export type Outer = { s: Shown };");
    expect(declarations(source)).not.toContain("Alias");
  });
});

describe("each carrier names every offending type once", () => {
  test("three fields of one private type draw one diagnostic, at the first", () => {
    const source = HIDDEN + "export record Outer = {a: Hidden, b: Hidden, c: Hidden}\n";
    const drawn = lone(source);
    // The first offending seat in declaration order — fields in written order.
    expect(drawn.primary.start.offset).toBe(source.indexOf("Hidden", HIDDEN.length));
  });

  test("a carrier leaking two private types draws two, each at its own first seat", () => {
    const source = "record Alpha = {n: Int}\nrecord Beta = {n: Int}\n" +
      "export record Outer = {a: Alpha, b: Beta, c: Alpha}\n";
    const drawn = diagnose(source);
    expect(drawn.map(({ message }) => message)).toEqual([
      "exported record `Outer` exposes private type `Alpha`; " +
        "export the type, perhaps opaquely, or keep the record private",
      "exported record `Outer` exposes private type `Beta`; " +
        "export the type, perhaps opaquely, or keep the record private",
    ]);
    expect(drawn.map((one) => at(source, one.primary))).toEqual(["Alpha", "Beta"]);
    // One diagnostic names one type and labels exactly that type's declaration.
    expect(drawn.map((one) => at(source, one.labels![0]!.span))).toEqual([
      "record Alpha = {n: Int}",
      "record Beta = {n: Int}",
    ]);
  });

  test("a union dedupes across constructors, at the first slot in written order", () => {
    const source = HIDDEN + "export union U = C(h: Hidden) | E(also: Hidden)\n";
    const drawn = lone(source);
    expect(drawn.primary.start.offset).toBe(source.indexOf("Hidden", HIDDEN.length));
  });

  test("an exception dedupes across its own slots", () => {
    const source = HIDDEN + "export exception Boom(first: Hidden, second: Hidden)\n";
    expect(lone(source)).toBeDefined();
  });

  test("two carriers leaking one type draw one diagnostic each", () => {
    // Deduplication is per (carrier, type), not per type: each carrier is its
    // own export and each needs its own fix.
    expect(messages(
      HIDDEN + "export record Outer = {h: Hidden}\nexport type W = Hidden\n",
    )).toEqual([
      "exported record `Outer` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the record private",
      "exported type alias `W` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the alias private",
    ]);
  });
});

describe("what is not a carrier", () => {
  test("an `opaque` record's fields are not, and its face mentions nothing", async () => {
    // An `opaque` item carries `exported: true` in the tree, so the gate that
    // matters is the second one. Its brand-only face (FFI Part 7 §5) mentions
    // neither a field nor a payload, so a private nominal inside leaks nothing —
    // and hiding a private representation behind an opaque name is Modules
    // §4.2's intended idiom.
    const source = HIDDEN + "opaque record Wrapper = {h: Hidden}\n";
    expect(messages(source)).toEqual([]);
    expect(declarations(source)).toBe(
      "declare const WrapperBrand: unique symbol;\n" +
        "export type Wrapper = { readonly [WrapperBrand]: never };\n",
    );
    expect(declarations(source)).not.toContain("Hidden");
    expect(await typeScriptErrors(declarationSet(project({ "/src/main.hex": source }))))
      .toEqual([]);
  });

  test("an `opaque` union's payloads are not", async () => {
    const source = HIDDEN + "opaque union Held = Wrap(h: Hidden)\n";
    expect(messages(source)).toEqual([]);
    expect(declarations(source)).toBe(
      "declare const HeldBrand: unique symbol;\n" +
        "export type Held = { readonly [HeldBrand]: never };\n",
    );
    expect(await typeScriptErrors(declarationSet(project({ "/src/main.hex": source }))))
      .toEqual([]);
  });

  test("a private carrier is not — only an exported one publishes anything", () => {
    expect(messages(HIDDEN + "record Outer = {h: Hidden}\ntype W = Hidden\n")).toEqual([]);
  });

  test("an imported, elsewhere-public type in an exported carrier is not refused", async () => {
    // The locality gate: `representationVisible` is stamped false on every
    // imported copy, so a type that lives elsewhere and is public there stays
    // out of the check — the rule is about types *this* module withholds.
    const compiled = project({
      "/src/lib.hex": "export record Pub = {n: Int}\nexport union Flag = On | Off\n",
      "/src/main.hex": 'import Lib\n' +
        "export record Outer = {p: Lib.Pub, f: Lib.Flag}\n" +
        "export type W = Lib.Pub\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("an exported constraint's member signatures are the sixth face (#626)", () => {
  // The family's one **non-carrier** member: no `.d.ts` row of its own rides FFI
  // Part 7's carrier list, so none of the four blocks above could reach it. The
  // refusal stands on two legs (§4.3) — the usability one, which reads a member
  // signature verbatim (an honor abroad must produce what the signature names,
  // and can neither name nor build the type), and the emitter's, since member
  // signatures do reach a declaration file through Parts 8–9's deliberate
  // public-evidence surfaces. Before the ruling this whole shape compiled clean
  // and the honor-writer abroad met ``type `Hidden` has no `Num`
  // instance``-grade misdirection instead.

  const REFUSED = "exported constraint `Probe` exposes private type `Hidden`; " +
    "export the type, perhaps opaquely, or keep the constraint private";

  test("the issue's own shape: a private extern type in a member's result", () => {
    const source = 'extern from "./lib.js"\n    type Hidden\n' +
      "export constraint Probe<a> =\n    probe(x: a): Hidden\n";
    const drawn = lone(source);
    expect(drawn.message).toBe(REFUSED);
    expect(at(source, drawn.primary)).toBe("probe(x: a): Hidden");
    expect(at(source, drawn.labels![0]!.span)).toBe("type Hidden");
  });

  test("a private record in a member's result, seat and label", () => {
    // The seat is the member's **whole written signature** — a binding in
    // miniature, the family's second anchor that is not an annotation — and the
    // label rides at the declaration, where the one-keyword fix goes.
    const source = "record Hidden = {a: Int}\n" +
      "export constraint Probe<a> =\n    peek(x: a): Hidden\n";
    const drawn = lone(source);
    expect(drawn.message).toBe(REFUSED);
    expect(at(source, drawn.primary)).toBe("peek(x: a): Hidden");
    expect(drawn.labels?.map(({ message }) => message)).toEqual([
      "`Hidden` is declared private here",
    ]);
    expect(at(source, drawn.labels![0]!.span)).toBe("record Hidden = {a: Int}");
  });

  test("a private type in a member's *parameter* is read the same", () => {
    const source = HIDDEN + "export constraint Probe<a> =\n    poke(x: a, h: Hidden): Int\n";
    const drawn = lone(source);
    expect(drawn.message).toBe(REFUSED);
    expect(at(source, drawn.primary)).toBe("poke(x: a, h: Hidden): Int");
  });

  test("a nested occurrence still anchors at the whole member signature", () => {
    const source = HIDDEN + "export constraint Probe<a> =\n    peek(x: a): Vector(Hidden)\n";
    expect(at(source, lone(source).primary)).toBe("peek(x: a): Vector(Hidden)");
  });

  test("two members mentioning one private type draw one, at the first", () => {
    // The family's dedupe, per (constraint, type), members in written order.
    const source = HIDDEN + "export constraint Probe<a> =\n" +
      "    peek(x: a): Hidden\n    poke(x: a, h: Hidden): a\n";
    const drawn = lone(source);
    expect(at(source, drawn.primary)).toBe("peek(x: a): Hidden");
  });

  test("a constraint leaking two private types draws two, each at its own first member", () => {
    const source = "record Alpha = {n: Int}\nrecord Beta = {n: Int}\n" +
      "export constraint Probe<a> =\n    one(x: a): Alpha\n    two(x: a): Beta\n";
    const drawn = diagnose(source);
    expect(drawn.map(({ message }) => message)).toEqual([
      "exported constraint `Probe` exposes private type `Alpha`; " +
        "export the type, perhaps opaquely, or keep the constraint private",
      "exported constraint `Probe` exposes private type `Beta`; " +
        "export the type, perhaps opaquely, or keep the constraint private",
    ]);
    expect(drawn.map((one) => at(source, one.primary))).toEqual([
      "one(x: a): Alpha",
      "two(x: a): Beta",
    ]);
    expect(drawn.map((one) => at(source, one.labels![0]!.span))).toEqual([
      "record Alpha = {n: Int}",
      "record Beta = {n: Int}",
    ]);
  });

  test("an `opaque` type mentioned in a member is fine — that is the whole point", () => {
    expect(messages("opaque record Hidden = {n: Int}\n" +
      "export constraint Probe<a> =\n    peek(x: a): Hidden\n")).toEqual([]);
  });

  test("an unexported constraint mentions private types freely", () => {
    // Only an exported face shows anybody anything, exactly as for a private
    // carrier.
    expect(messages(HIDDEN + "constraint Probe<a> =\n    peek(x: a): Hidden\n" +
      "export let n: Int = 1\n")).toEqual([]);
  });

  test("an `honor` block at a private type is still exempt (§7.4)", () => {
    expect(messages(HIDDEN + "export constraint Probe<a> =\n    peek(x: a): Int\n" +
      "honor Probe<Hidden> =\n    peek(x) = x.n\n")).toEqual([]);
  });

  test("an implied type bound to a private type draws nothing, and the silence is right", () => {
    // The **projection route**: a private nominal reached only through an
    // instance's `type Item = Hidden`. Nothing here is a face. The member's
    // signature writes `Item`, not a nominal; the binding that names `Hidden`
    // sits in an `honor` block, which is exempt (§7.4); and the route is closed
    // downstream before any face can form — Collections Part 2 §7.2's v1 binder
    // ban leaves an importer no way to bind the projection, and §7.3's
    // non-referenceability means the projected type is not nameable as a type in
    // the first place (the ground the #632 spec review settled this on). So the
    // rule has nothing to read and says nothing, correctly.
    //
    // Pinned because the tree is what keeps it that way: `impliedTypes` is a
    // **separate field** from `members`, so `item.members.map(…)` never sees an
    // implied type. A refactor that folded the two into one list would start
    // reporting here, at a seat with no fix behind it. The sibling case below is
    // the other half — the walk is not derailed by the implied type either.
    expect(messages(HIDDEN + "export record Ledger = {n: Int}\n" +
      "export constraint Source<a> =\n    type Item\n    peek(supply: a): Item\n" +
      "honor Source<Ledger> =\n    type Item = Hidden\n" +
      "    peek(l) = Hidden({n = l.n})\n")).toEqual([]);
  });

  test("but a projection-bearing constraint's *other* member is still refused", () => {
    const source = HIDDEN + "export constraint Source<a> =\n    type Item\n" +
      "    peek(supply: a): Item\n    poke(supply: a): Hidden\n";
    const drawn = lone(source);
    expect(drawn.message).toBe(
      "exported constraint `Source` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the constraint private",
    );
    expect(at(source, drawn.primary)).toBe("poke(supply: a): Hidden");
  });
});

describe("default bodies are bodies, not faces (#626; Constraints §6.5)", () => {
  test("a default body may name its module's private binding", () => {
    // The scope line the ruling drew: member **signatures** are visited, default
    // bodies are not. A default is checked at home in the constraint's generic
    // context, and a private module-level name is exactly what it is entitled to
    // reach — the same freedom an instance has (§7.4).
    expect(messages(HIDDEN + "let secret: Hidden = Hidden({n = 7})\n" +
      "export constraint Probe<a> =\n    size(x: a): Int = secret.n\n")).toEqual([]);
  });

  test("a default body may *construct* the private type", () => {
    expect(messages(HIDDEN + "export constraint Probe<a> =\n" +
      "    size(x: a): Int = Hidden({n = 3}).n\n")).toEqual([]);
  });
});

describe("the sealing idiom is lawful, deliberately (#626)", () => {
  // A *private* constraint in an exported binding's signature, or as a base of an
  // exported constraint, crosses nothing: the constraint is the gate, not the
  // cargo. Nothing unnameable lands in a consumer's hands, and no consumer can
  // honor the constraint at a new type — which is the point (Rust's sealed
  // traits, deliberate there too). A constraint in a binder's constraint list is
  // not a type mention, and the binding rule is untouched.

  test("a private constraint gates an exported function, and a consumer calls it", () => {
    const compiled = project({
      "/src/lib.hex": "constraint Priv<a> =\n    twiddle(x: a): Int\n" +
        "export record Pub = {n: Int}\n" +
        "honor Priv<Pub> =\n    twiddle(x) = x.n\n" +
        "export fun use<a: Priv>(x: a): Int = twiddle(x)\n",
      "/src/main.hex": 'import Lib\n' +
        "export let n: Int = Lib.use(Lib.Pub({n = 1}))\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("a private constraint may be the base of an exported one", () => {
    expect(messages("constraint Priv<a> =\n    twiddle(x: a): Int\n" +
      "export constraint Shown<a: Priv> =\n    show(x: a): Int\n")).toEqual([]);
  });
});

describe("`opaque` is the recovery the message names (#626)", () => {
  // The accidental existential pattern, measured whole: a home module honors its
  // own constraint at its own exported type, a consumer honors at a type of its
  // own by *harvesting* a value through the home instance, and an exported
  // constrained function threads values it can never name. Under `opaque` the
  // whole program compiles — this is the pattern spelled honestly (§4.2) — and
  // with the identical program's `Hidden` left a transparent private record it is
  // refused once, at the member. Ordering matters: an honor block sits above the
  // bare member uses that follow it.
  const OPAQUE_LIB = "opaque record Hidden = {n: Int}\n" +
    "export record Pub = {n: Int}\n" +
    "export constraint Probe<a> =\n" +
    "    peek(x: a): Hidden\n" +
    "    poke(x: a, h: Hidden): Int\n" +
    "honor Probe<Pub> =\n" +
    "    peek(x) = Hidden({n = x.n})\n" +
    "    poke(x, h) = h.n + x.n\n";
  const CONSUMER = 'import Lib\n' +
    "export record Mine = {n: Int}\n" +
    "honor Lib.Probe<Mine> =\n" +
    "    peek(x) = Lib.Pub({n = x.n}).peek()\n" +
    "    poke(x, h) = Lib.Pub({n = x.n}).poke(h)\n" +
    "export fun thread<a: Lib.Probe>(x: a): Int = Lib.poke(x, Lib.peek(x))\n";

  test("the whole existential pattern compiles under `opaque`", () => {
    const compiled = project({ "/src/lib.hex": OPAQUE_LIB, "/src/main.hex": CONSUMER });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("and the identical program over a transparent private record is refused once", () => {
    const compiled = project({
      "/src/lib.hex": OPAQUE_LIB.replace("opaque record", "record"),
      "/src/main.hex": CONSUMER,
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported constraint `Probe` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the constraint private",
    ]);
  });

  test("locality: a consumer's own exported constraint reports nothing abroad", () => {
    // `main`'s member genuinely mentions `Hidden` — `Exposed` expands to it — and
    // the one refusal is `lib`'s, at the alias that let the name travel. The
    // consumer holds no declaration to label and could perform no remedy.
    const compiled = project({
      "/src/lib.hex": 'extern from "./lib.js"\n    type Hidden\n' +
        "export type Exposed = Hidden\n",
      "/src/main.hex": 'import Lib\n' +
        "export constraint Probe<a> =\n    peek(x: a): Lib.Exposed\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported type alias `Exposed` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the alias private",
    ]);
  });
});

describe("no shipped exported constraint draws the new refusal", () => {
  // The survival sweep the ruling asked for. `shipped-sources.test.ts` already
  // compiles every `stdlib/` and `runtime/` file and demands zero diagnostics;
  // this one is narrowed to the files that actually declare an exported
  // constraint and names *this* message, so a future stdlib edit that trips the
  // sixth face fails here with the reason attached rather than as one more line
  // in a general sweep. One case per file, as there — a per-file budget, and a
  // failure that points at the file.
  const SHIPPED: Record<string, string> = {
    ...import.meta.glob("../../../stdlib/*.hex", { eager: true, query: "?raw", import: "default" }),
    ...import.meta.glob("../../../runtime/*.hex", { eager: true, query: "?raw", import: "default" }),
  } as Record<string, string>;

  const SUBJECTS = Object.entries(SHIPPED)
    .filter(([, source]) => /^export constraint /mu.test(source))
    .map(([globPath, source]) => {
      const basename = globPath.slice(globPath.lastIndexOf("/") + 1);
      return [
        `${globPath.includes("/runtime/") ? "runtime" : "stdlib"}/${basename}`,
        { basename, source, privileged: globPath.includes("/runtime/") },
      ] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));

  test("the sweep reaches the constraint-declaring sources", () => {
    // A glob that matched nothing, or a filter that matched nothing, would make
    // every case below disappear rather than fail.
    const labels = SUBJECTS.map(([label]) => label);
    expect(labels).toContain("stdlib/Eq.hex");
    expect(labels).toContain("stdlib/Ord.hex");
    expect(labels.length).toBeGreaterThan(4);
  });

  test.each(SUBJECTS)("%s exposes no private type", (_label, subject) => {
    const compiled = compileFiles(
      [[`/${subject.basename}`, subject.source]],
      subject.privileged ? { runtimePaths: [`/${subject.basename}`] } : {},
    );
    expect(compiled.diagnostics
      .map(({ message }) => message)
      .filter((message) => message.includes("exposes private type"))).toEqual([]);
  });
});

describe("the shipped `.d.ts` carries no private type, in any form", () => {
  test("an unreferenced private union contributes no `type` row", () => {
    // The arm's own defect: it pushed its row for every union, so this file
    // shipped `type Hidden = { tag: \"A\" } | { tag: \"B\" };` — the whole
    // representation, published against Modules §11.4, for a type nothing
    // exported even mentions.
    expect(declarations("union Hidden = A | B\nexport let n: Int = 1\n")).toBe(
      "export declare const n: number;\n",
    );
  });

  test("a payload-carrying private union contributes none either", () => {
    expect(declarations("record Hidden = {n: Int}\nunion Held = Wrap(h: Hidden)\n" +
      "export let n: Int = 1\n")).toBe("export declare const n: number;\n");
  });

  test("no shipped declaration file in a whole program holds a non-exported `type` row", () => {
    // Stated over the program rather than over one module, so the stdlib and the
    // runtime modules are swept too: `VectorTrie` and `HashTrie` each shipped a
    // private `Tree`, and `HashTrie` a private `Root` and `Frames` besides.
    const compiled = project({
      "/src/main.hex": "union Hidden = A | B\n" +
        "export let rows: Vector(Int) = [1]\n" +
        "export let m: Map(Int, Int) = Map.empty\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    const rows: string[] = [];
    for (const [path, text] of Object.entries(declarationSet(compiled))) {
      for (const line of text.split("\n")) {
        if (/^(?:declare )?type /u.test(line)) rows.push(`${path}: ${line}`);
      }
    }
    expect(rows).toEqual([]);
  });

  test("the runtime modules that shipped private rows now ship the marker", () => {
    const compiled = project({
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n" +
        "export let m: Map(Int, Int) = Map.empty\n",
    });
    // `Tree` in each, plus `Root` and `Frames` in `HashTrie` — four rows across
    // two files, none of them ever referenced by an exported face.
    expect(moduleOf(compiled, "/src/HashTrie.hex").declarations.text).toBe("export {};\n");
    expect(moduleOf(compiled, "/src/VectorTrie.hex").declarations.text).toBe("export {};\n");
  });

  test("the **preview** still renders the private union, unprefixed", () => {
    // The inspection preview is out of scope and unchanged (§14.3's scope note):
    // it renders private declarations by design, and the union renderer's second
    // caller keeps its behavior. Pinned so it cannot regress silently along with
    // the shipped file.
    const rendered = preview("union Hidden = A | B\nexport let n: Int = 1\n");
    expect(rendered).toBe(
      'type Hidden = { tag: "A" } | { tag: "B" };\n' +
        "declare const A: Hidden;\n" +
        "declare const B: Hidden;\n" +
        "export declare const n: number;\n",
    );
  });

  test("the preview renders a private *payload-carrying* union too", () => {
    expect(preview("record Hidden = {n: Int}\nunion Held = Wrap(h: Hidden)\n" +
      "export let n: Int = 1\n")).toContain('type Held = { tag: "Wrap"; h: Hidden };');
  });
});

describe("the refused programs are exactly the ones `tsc` rejected", () => {
  test("the three shapes the issue measured now draw Hexagon diagnostics", async () => {
    // Each shape compiled clean and produced a `.d.ts` that `tsc --noEmit
    // --strict` rejected with TS2304. The repair is at the Hexagon end: the face
    // is refused, so no such file is ever written from an accepted program.
    for (
      const [source, message] of [
        [
          HIDDEN + "export type W = Hidden\n",
          "exported type alias `W` exposes private type `Hidden`; " +
            "export the type, perhaps opaquely, or keep the alias private",
        ],
        [
          HIDDEN + "export record Outer = {h: Hidden}\n",
          "exported record `Outer` exposes private type `Hidden`; " +
            "export the type, perhaps opaquely, or keep the record private",
        ],
        [
          HIDDEN + "export union U = C(h: Hidden) | D\n",
          "exported union `U` exposes private type `Hidden`; " +
            "export the type, perhaps opaquely, or keep the union private",
        ],
      ] as const
    ) {
      expect(messages(source)).toEqual([message]);
    }
  });

  test("the accepted repair — exporting the type — compiles and typechecks", async () => {
    // The remedy the message names, run end to end: the `.d.ts` now declares
    // what it mentions.
    const compiled = project({
      "/src/main.hex": "export record Hidden = {n: Int}\n" +
        "export type W = Hidden\n" +
        "export record Outer = {h: Hidden}\n" +
        "export union U = C(h: Hidden) | D\n" +
        "export exception Boom(payload: Hidden)\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the other repair — opacity — compiles and typechecks", async () => {
    const compiled = project({
      "/src/main.hex": "opaque record Hidden = {n: Int}\n" +
        "export record Outer = {h: Hidden}\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});
