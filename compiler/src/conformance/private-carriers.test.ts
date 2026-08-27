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

  test("the one shape with no declaration in reach ships without the label (#629)", () => {
    // The extern arm of the walk has no locality component — it flags any
    // identity absent from the module's own extern-type table, unlike records
    // and unions, whose `representationVisible` is stamped false on every
    // imported copy. So a *consumer* reaching another module's private extern
    // type through that module's exported alias refuses here, with no
    // declaration span in reach and therefore no label: pointing across files
    // would break §4.2.1's convention that the label is in the file the reader
    // is looking at, so withholding it is the right answer to the wrong
    // question. The refusal is pre-existing (the same report is drawn on the
    // exported-binding route) and misaddressed — its remedy, "export the type",
    // is one `main` cannot perform. #629 owns both halves; a repair there has to
    // move this test.
    const compiled = project({
      "/src/lib.hex": 'extern from "./lib.js"\n    type Hidden\n' +
        "export type Exposed = Hidden\n",
      "/src/main.hex": 'import { Exposed } from "./lib"\n' +
        "export record Wrap = {h: Exposed}\n",
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      // `lib`'s own alias is a carrier too, so the home diagnosis exists and
      // carries its label; the consumer's is a second report of that defect.
      "exported type alias `Exposed` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the alias private",
      "exported record `Wrap` exposes private type `Hidden`; " +
        "export the type, perhaps opaquely, or keep the record private",
    ]);
    const [home, consumer] = compiled.diagnostics;
    expect(home!.labels?.map(({ message }) => message)).toEqual([
      "`Hidden` is declared private here",
    ]);
    expect(consumer!.labels ?? []).toEqual([]);
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
