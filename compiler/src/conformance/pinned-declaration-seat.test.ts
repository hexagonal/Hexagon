import { describe, expect, test } from "vitest";

import { compileProject, Source, type CompiledProject } from "../index";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for FFI Part 7 §2.3's **declaration seat** — the pinned type's own
 * row in its home module's `.d.ts` (#622; correction record §14.5).
 *
 * §2.3 pins `Seq(a)`'s every face to `Iterable<a>` and §5 gives every opaque
 * export a `unique symbol` brand, and until this landed both fired on `Seq`:
 * `Seq.d.ts` declared `export type Seq<a> = { readonly [SeqBrand]: a }` while
 * every signature in that same file — and in every consumer file — spelled
 * `Iterable<a>`. Measured, the exported name was uninhabited from outside (the
 * symbol is not exported) and assignable with the published face in *neither*
 * direction, TS2741 both ways, while being the name a consumer following the
 * corpus reaches for first.
 *
 * The rule now: a pin governs the type **everywhere**. The home seat exports the
 * type's own name as a transparent alias of the pinned face at the type's own
 * §2.2 parameters, the doc comment riding it, and no brand is emitted.
 *
 * Three things this file keeps honest, because each is a way the repair could go
 * wrong rather than a restatement of it:
 *
 * 1. **The seat is exact and the brand is gone**, asserted as a pair. A bare
 *    "no `SeqBrand` anywhere" passes trivially in a file that stopped declaring
 *    the type at all, so every absence here is paired with the exact line that
 *    must be present at the same seat.
 * 2. **The gate is the pin, not opacity.** An ordinary `opaque record` still
 *    brands, a user's own record spelled `Seq` still brands, and — the case the
 *    ruling names explicitly — `Stream`, an `opaque record` whose Part 3 §14.2
 *    face is unimplemented (#659), still brands. A gate written as "prelude
 *    opaque record" would pass every test but those.
 * 3. **The consumer program from the issue compiles**, both directions, through
 *    the real TypeScript compiler over the whole emitted set. The alias makes
 *    assignability definitional, which is exactly why it is worth measuring
 *    rather than reasoning about: the claim is about `tsc`'s opinion.
 */

function project(files: Readonly<Record<string, string>>): CompiledProject {
  const compiled = compileProject(
    Object.entries(files).map(([path, text], index) =>
      new Source.File(Source.fileId(index), path, text)
    ),
  );
  expect(compiled.diagnostics).toEqual([]);
  return compiled;
}

/**
 * Every emitted `.d.ts` of a program, keyed for `typeScriptErrors`, with the
 * runtime declaration module (Part 1 §8.3) where the program has one.
 *
 * The whole set, never one file: a declaration file that imports is only
 * TypeScript together with what it imports from, and the consumer test below
 * asks about a name crossing two of them.
 */
function declarationSet(compiled: CompiledProject): Record<string, string> {
  const files: Record<string, string> = {};
  const runtime = compiled.runtimeDeclarations;
  if (runtime !== undefined) files[runtime.path.replace(/^\//u, "")] = runtime.text;
  for (const module of compiled.modules) {
    files[module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] =
      module.declarations.text;
  }
  return files;
}

/** The lines of one emitted `.d.ts`, so a seat can be pinned as a whole line. */
function lines(files: Readonly<Record<string, string>>, name: string): readonly string[] {
  const text = files[name];
  if (text === undefined) throw new Error(`the program emitted no ${name}`);
  return text.split("\n");
}

/**
 * A program that reaches `Seq` and `Stream`, so both prelude members are
 * compiled and emitted: `Stream` is the guard case, and it only has a `.d.ts`
 * when something in the program pulls it into the module graph.
 */
const PROGRAM =
  "export let e: Seq(Int) = Seq.empty\n" +
  "export let twice(s: Seq(Int)): Int = Seq.length(s) * 2\n" +
  "export let live: Stream(Int) = Stream.fromSeq(e)\n";

describe("a §2.3-pinned type's seat is the pin's alias (§14.5)", () => {
  test("`Seq.d.ts` declares the alias exactly, and declares no brand", () => {
    const files = declarationSet(project({ "/main.hex": PROGRAM }));
    const seq = files["Seq.d.ts"]!;

    // The seat, as a whole line. Paired with the absences below so the pair
    // fails rather than passes if the seat moves or stops being emitted: a
    // missing declaration would satisfy every `not.toContain` here on its own.
    expect(lines(files, "Seq.d.ts")).toContain("export type Seq<a> = Iterable<a>;");
    expect(seq).not.toContain("SeqBrand");
    expect(seq).not.toContain("unique symbol");

    // No face moved (§14.5: the change is confined to the seat). The pin was
    // already settled ahead of §2.4's sink, so the faces spelled the notion
    // before this rule and spell it after — including the alias's own module,
    // which deliberately does not route its faces through the new name.
    //
    // The absence goes **first**, ahead of the positive pins below, because it
    // is the broader of the two claims: a sink answering for `Seq` writes the
    // declared name at every parameter seat in this file, `declare function` and
    // `declare const` alike, while each positive pin below names one of them. An
    // assertion that only ever runs after its own subject has been caught by a
    // narrower neighbour is not the guard it reads as.
    expect(seq).not.toContain("source: Seq<a>");
    expect(lines(files, "Seq.d.ts")).toContain("export declare const empty: Iterable<never>;");
    expect(seq).toContain("export declare function memoize<a>(source: Iterable<a>): Iterable<a>;");
    expect(lines(files, "main.d.ts")).toContain("export declare const e: Iterable<number>;");
  });

  test("the type's documentation rides the alias", () => {
    const files = declarationSet(project({ "/main.hex": PROGRAM }));
    const seat = lines(files, "Seq.d.ts");
    const at = seat.indexOf("export type Seq<a> = Iterable<a>;");

    // Read backwards from the seat rather than searched for anywhere in the
    // file: §14.5 rejects suppressing the declaration precisely because that
    // deletes the prose a TypeScript consumer most needs, and prose sitting
    // somewhere else in the file would not be this declaration's.
    expect(seat[at - 1]).toBe(" */");
    expect(seat.slice(0, at).join("\n")).toContain(
      "A lazy, immutable, possibly infinite sequence of `a`s.",
    );
  });

  test("the issue's consumer program compiles, in both directions", async () => {
    // #622's measurement, as filed: the exported name receives an exported
    // value, and a value named by it is passed to an exported function. Both
    // were `TS2741` before the alias — the errors pointing in opposite
    // directions, which is what made the brand seat incoherent rather than
    // merely unused.
    const files = declarationSet(project({ "/main.hex": PROGRAM }));
    expect(
      await typeScriptErrors({
        ...files,
        "consumer.ts":
          'import type { Seq } from "./Hex/Seq.js";\n' +
          'import { e, twice } from "./main.js";\n' +
          "export const byBrand: Seq<number> = e;\n" +
          "export const roundTrip: number = twice(byBrand);\n" +
          // The outbound direction through the *declared* type, and the only
          // line here that really carries it. `byBrand` is a `const` with an
          // initializer, so TypeScript narrows it to `typeof e` at every use
          // site: the line above measures `Iterable<number>` reaching `twice`
          // however wide `Seq<number>` is, and passed with the seat mutated to
          // `Iterable<a> | undefined`. A parameter is not narrowed, so this one
          // asks what the issue asked — a value named by the exported type is
          // accepted by an exported function.
          "export const viaParam = (s: Seq<number>): number => twice(s);\n" +
          // The other direction of the same claim: the name and the face are
          // one type, so a value the consumer builds against the native
          // spelling satisfies the exported name too.
          "export const byFace: Seq<number> = [1, 2, 3][Symbol.iterator]();\n",
      }),
    ).toEqual([]);
  });
});

describe("the gate is the pin, not opacity", () => {
  test("an ordinary `opaque record` still takes §5's brand", () => {
    const files = declarationSet(project({
      "/main.hex":
        "opaque record Point = {x: Int, y: Int}\n" +
        "export let origin(): Point = Point({x = 0, y = 0})\n",
    }));

    expect(lines(files, "main.d.ts")).toContain("declare const PointBrand: unique symbol;");
    expect(lines(files, "main.d.ts")).toContain(
      "export type Point = { readonly [PointBrand]: never };",
    );
  });

  test("`Stream.d.ts` keeps its brand — Part 3 §14.2 is unimplemented (#659)", () => {
    // The ruling's scope correction. `Stream(a)` is `opaque record` with a home
    // module and is §14.2's standing pin candidate, but its face is not pinned
    // today: the faces below spell the brand type through §2.4's ordinary sink,
    // and brand-and-sink are coherent together. It joins this rule the day #659
    // settles its membership and lands the face — consciously, by moving
    // `pinnedRecord`, which is what these exact lines are here to require.
    const files = declarationSet(project({ "/main.hex": PROGRAM }));
    const stream = lines(files, "Stream.d.ts");

    expect(stream).toContain("declare const StreamBrand: unique symbol;");
    expect(stream).toContain("export type Stream<a> = { readonly [StreamBrand]: a };");
    expect(stream).toContain(
      "export declare function fromSeq<a>(source: Iterable<a>): Stream<a>;",
    );

    // The consumer side of the same claim, and the half a widened gate actually
    // moves. `Stream.hex` cannot see itself through the prelude (`preludeIds`
    // documents the self-blindness `seq` and `bool` carry fallbacks for), so a
    // gate widened to `Stream` would leave its *own* seat branded while every
    // consumer face became the notion — the mismatch this issue closed, in the
    // mirror. Both halves are pinned so that #659 has to move both.
    expect(lines(files, "main.d.ts")).toContain('import type { Stream } from "./Hex/Stream.js";');
    expect(lines(files, "main.d.ts")).toContain("export declare const live: Stream<number>;");
  });

  test("a module's own `opaque record Seq` is an ordinary opaque type", () => {
    // The pin is an identity, never a spelling (the `#prelude` reading every
    // other pinned seat uses). A module that declares its own `Seq` occludes the
    // prelude's (Modules §5.4) and acquires none of its boundary contract, so
    // its seat is §5's brand and its faces name the brand type.
    const files = declarationSet(project({
      "/main.hex":
        "opaque record Seq(+a) = {held: a}\n" +
        "export let hold(value: a): Seq(a) = Seq({held = value})\n",
    }));

    expect(lines(files, "main.d.ts")).toContain("declare const SeqBrand: unique symbol;");
    expect(lines(files, "main.d.ts")).toContain(
      "export type Seq<a> = { readonly [SeqBrand]: a };",
    );
  });
});
