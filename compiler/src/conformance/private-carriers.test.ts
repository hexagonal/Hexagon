import { describe, expect, test } from "vitest";

import {
  compileProject,
  emitTypeScriptPreview,
  Source,
  type CompiledProject,
} from "../index";
import type { Diagnostic } from "../support/diagnostics.js";
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
  // construction. What leaves the restraint with nothing unguarded is §4.3's
  // pair of guards, and these tests are that pair measured rather than argued.
  // Every **carrier** route into a consumer's face runs through some exported
  // carrier or binding of the home module, and that carrier is refused *there*,
  // in the one module holding the declaration the label points at and able to
  // perform the remedy the message names. Where no carrier route exists — an
  // exported constraint's members, which are no carrier (#626) — the guard is a
  // different one: the private type is unnameable in the consumer, so no
  // complete exported signature (§4.1.1) can mention it. One test below is that
  // second guard's, and it is the one route with no home refusal to point at.

  const PRIVATE_EXTERN = 'extern from "./lib.js"\n    type Hidden\n';

  test("the alias route reports once, at home, with its label", () => {
    // Formerly the shape with no declaration in reach: the consumer's table held
    // nothing to label, so its report shipped bare and told `main` to export a
    // type declared in `lib`. Now `lib`'s own alias — a carrier since #621 —
    // carries the arc alone, and every diagnostic in the family has its label.
    const lib = PRIVATE_EXTERN + "export type Exposed = Hidden\n";
    const compiled = project({
      "/src/lib.hex": lib,
      "/src/main.hex": 'import { Exposed } from "./lib"\n' +
        "export record Wrap = {h: Exposed}\n",
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
      "/src/main.hex": 'import { peek, Exposed } from "./lib"\n' +
        "export fun g(h: Exposed): Exposed = peek(h)\n",
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
      "/src/main.hex": 'import { peek } from "./lib"\n' + "export let g = peek\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported binding `peek` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the binding private",
      "exported value `g` requires a type annotation",
    ]);
  });

  test("a constraint member's mention, where no home refusal exists at all", () => {
    // The one route with *no* carrier behind it: an exported constraint is not a
    // carrier (§4.3's last bullet; #626), so `lib` alone draws nothing and there
    // is no home-side refusal for the consumer's report to duplicate. The guard
    // here is a different one and it holds on its own — §4.1.1 plus
    // unnameability: `main` cannot spell `Hidden`, so no complete exported
    // signature of its can mention it, and the incomplete one it wrote is
    // refused as incomplete. What is left is that refusal alone.
    const lib = 'extern from "./lib.js"\n    type Hidden\n' +
      "export constraint Probe<a> =\n    probe(x: a): Hidden\n";
    const consumer = 'import { Probe } from "./lib"\n' +
      "export fun g<a: Probe>(x: a) = probe(x)\n";
    expect(project({ "/src/lib.hex": lib }).diagnostics.map(({ message }) => message))
      .toEqual([]);
    const compiled = project({ "/src/lib.hex": lib, "/src/main.hex": consumer });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "exported function `g` requires a complete signature; add a return type",
    ]);
  });

  test("and the same shape over a private *record* draws exactly the same", () => {
    // The parity control for the test above: the record arm has been local since
    // #605, so this program has always drawn the completeness error alone. The
    // extern arm now agrees with it — which is the whole of the repair, stated as
    // a program the two arms answer identically.
    const consumer = 'import { Probe } from "./lib"\n' +
      "export fun g<a: Probe>(x: a) = probe(x)\n";
    const compiled = project({
      "/src/lib.hex": "record Hidden = {n: Int}\n" +
        "export constraint Probe<a> =\n    probe(x: a): Hidden\n",
      "/src/main.hex": consumer,
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
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
      "/src/main.hex": 'import { Alias } from "./lib"\n' +
        "export record Wrap = {h: Alias}\n",
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
      "/src/mid.hex": 'import { Shown } from "./lib"\nexport type Alias = Shown\n',
      "/src/main.hex": 'import { Alias } from "./mid"\n' +
        "export record Wrap = {h: Alias}\n",
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
    const main = 'import { Shown } from "./lib"\n' +
      'extern from "./host.js"\n    type Own\n' +
      "export record Wrap = {a: Shown, b: Own}\n";
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
      "/src/main.hex": 'import { Pub, Flag } from "./lib"\n' +
        "export record Outer = {p: Pub, f: Flag}\n" +
        "export type W = Pub\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("the shipped `.d.ts` carries no private type, in any form", () => {
  test("an unreferenced private union contributes no `type` row", () => {
    // The arm's own defect: it pushed its row for every union, so this file
    // shipped `type Hidden = \"A\" | \"B\";` — the whole representation, published
    // against Modules §11.4, for a type nothing exported even mentions.
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
      'type Hidden = "A" | "B";\n' +
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
