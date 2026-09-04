import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import seqSource from "../../../stdlib/Seq.hex?raw";

/**
 * `stdlib/Seq.hex` as written — the de-intrinsified `Seq`: `opaque record
 * Seq(a)` plus the §6.2 protocol and the combinator core, per Loops §6.6.
 *
 * It is a prelude member now (plan Phase 4 step 8), and the behavioural
 * conformance for these combinators lives in `seq.test.ts`, driven through the
 * prelude with no import at all. This file keeps a different job: it asserts
 * properties of the **source text** that would silently regress if someone
 * "tidied" the file back toward a workaround for a defect that is fixed —
 *
 * 1. the `emptyCore`/`empty` split is gone (a single annotated
 *    `export let empty: Seq(a)` generalizes and serves `singleton`, `take`, and
 *    `flatMap`);
 * 2. the defect-1 workaround is reverted — recursive bodies call `next(source)`
 *    rather than driving `(source.pull)()` inline;
 * 3. the defect-2 workaround is reverted — arms are written `Some((value, rest))`
 *    rather than binding the payload whole and destructuring on the next line;
 * 4. the pull steps are inline (#177) — a lambda written at the `pull` field,
 *    not bound to a local and passed by name. Item 4 is not a revert like 1–3:
 *    the constraint it worked around never applied to this spelling.
 *
 * The prelude is exemplary code and must not carry a workaround for a fixed bug,
 * nor — item 4's lesson — for one that was never there.
 *
 * The module is still mounted explicitly at `/Seq.hex` and imported by name.
 * That is not redundant with the prelude: a project file at a prelude basename
 * *is* the member (the embedded fallback stands down), so this also pins that an
 * explicit `import Seq` of a prelude module still works — the qualified
 * path Modules §5.4 depends on, exercised against a real one.
 */

function compileSeq(entry: string): ReturnType<typeof compileProject> {
  return compileProject([
    new Source.File(Source.fileId(1), "/Seq.hex", seqSource),
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + entry),
  ]);
}

function diagnostics(entry: string): readonly string[] {
  return compileSeq(entry).diagnostics.map((diagnostic) => diagnostic.message);
}

/**
 * The JSDoc block emitted directly above `declaration`, or `undefined` when the
 * declaration carries none. Read backwards from the declaration's own line,
 * which is the only reading that answers the question attachment asks — *this*
 * declaration's documentation, not "the text appears somewhere in the file".
 */
function docAbove(emitted: string, declaration: string): string | undefined {
  const lines = emitted.split("\n");
  const at = lines.findIndex((line) => line.startsWith(declaration));
  if (at < 0) throw new Error(`no emitted line begins \`${declaration}\``);
  if (lines[at - 1]?.trim() !== "*/") return undefined;
  const opener = lines.lastIndexOf("/**", at - 1);
  return lines
    .slice(opener + 1, at - 1)
    .map((line) => line.replace(/^\s*\* ?/u, ""))
    .join("\n");
}

const IMPORT = "import Seq\n";

describe("stdlib/Seq.hex compiles and serves its own surface", () => {
  test("the module compiles clean", () => {
    expect(diagnostics(IMPORT + "export let ok: Int = 1\n")).toEqual([]);
  });

  test("the protocol and the combinator core typecheck through a consumer", () => {
    expect(diagnostics(
      IMPORT +
      "export let counted: Int = Seq.length(Seq.take(Seq.iterate(1, x => x + 1), 3))\n" +
      "export let summed: Int = Seq.fold(Seq.take(Seq.iterate(1, x => x + 1), 4), 0, (a, b) => a + b)\n" +
      "export let mapped: Seq.Seq(Int) = Seq.map(Seq.singleton(1), x => x * 2)\n" +
      "export let kept: Seq.Seq(Int) = Seq.filter(Seq.iterate(1, x => x + 1), x => x > 2)\n" +
      "export let joined: Seq.Seq(Int) = Seq.concat(Seq.singleton(1), Seq.empty)\n" +
      "export let flat: Seq.Seq(Int) = Seq.flatMap(Seq.singleton(1), x => Seq.singleton(x))\n",
    )).toEqual([]);
  });

  test("`empty` is one generalized binding serving two element types", () => {
    // The collapse. If `empty` were pinned to a single element type — the reason
    // the `emptyCore`/`empty` split existed — the second annotation would fail.
    expect(diagnostics(
      IMPORT +
      "export let ints: Seq.Seq(Int) = Seq.empty\n" +
      "export let texts: Seq.Seq(String) = Seq.empty\n",
    )).toEqual([]);
  });

  test("the type is opaque: `pull` is not reachable from outside", () => {
    // Loops §6.6: opacity is load-bearing. `next` plus `Option` destructuring is
    // the entire public face.
    expect(diagnostics(
      IMPORT + "export let sneak(source: Seq.Seq(Int)): Int = 0\n" +
      "export let peek(source: Seq.Seq(Int)) = (source.pull)()\n",
    )).not.toEqual([]);
  });
});

describe("the step-7 reverts are in the source, not merely intended", () => {
  test("no `(x.pull)()` inline drive survives — recursive bodies call `next`", () => {
    // Defect 1's workaround. The one legitimate `(source.pull)()` is `next`'s own
    // body, which is what the protocol is defined as.
    // Comment lines discuss the form deliberately (that is the note explaining
    // why `next` is written this way), so count code lines only.
    const inlineDrives = seqSource
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .filter((line) => /\(\w+\.pull\)\(\)/u.test(line));
    expect(inlineDrives).toHaveLength(1);
    expect(seqSource).toContain("export let next(source: Seq(a)): Option((a, Seq(a))) = (source.pull)()");
  });

  test("constructor arms destructure inline — no payload-then-`let` workaround", () => {
    // Defect 2's workaround was `Some(pulled) =>` followed by
    // `let (value, rest) = pulled`. Its absence is the assertion.
    expect(seqSource).toContain("Some((value, rest)) =>");
    expect(seqSource).not.toMatch(/Some\(pulled\)/u);
  });

  test("the `emptyCore` split is gone from the source", () => {
    expect(seqSource).not.toContain("emptyCore");
    expect(seqSource).toContain("export let empty: Seq(a) = Seq({ pull = () => None })");
  });

  test("every pull step is inline — no `let step` indirection survives", () => {
    // Unlike the two above, this is not a revert: nothing was ever broken here
    // (#177). Every combinator bound its step to a local first — `let step = ...`
    // then `Seq({ pull = step })` — on the strength of a file comment claiming an
    // inline `match` could not be a record-field value. Checked against the very
    // commit that wrote the comment: this spelling parsed clean there too. The
    // spelling that genuinely failed was defect-log finding 5's (head on the
    // `pull =` line, `})` trailing the last arm); the comment over-generalized
    // that finding to a shape it never covered. Finding 5 is since fixed, so the
    // shape below is now a style choice — #177's, made on the merits.
    expect(seqSource).not.toMatch(/\blet step\b/u);

    // The general form of the same assertion, which no rename escapes: the step
    // is always a literal lambda at the field, never a name bound above it. The
    // record *declaration* spells the field `pull:`, so it is not in scope here.
    expect(seqSource).not.toMatch(/pull = (?!\(\) =>)/u);

    // …and the two above are not vacuous: every combinator still builds a `Seq`.
    // This one also pins the formatting — `Seq({ pull = () =>` on one line —
    // which is deliberate but worth saying, since a reformat that hung the
    // opener would fail here while breaking nothing the test names. It earns the
    // brittleness: an indirection reintroduced across a line break slips past
    // both regexes above and is caught only by the count.
    expect(seqSource.match(/Seq\(\{ pull = \(\) =>/gu)).toHaveLength(14);
  });

  test("the declaration is the opaque record Loops §6.6 specifies", () => {
    // The `+` arrived with the #205 stdlib sweep (closure doc §11.4): `Seq` is
    // covariant in `a`, the ruling's transitional compiler-side row is retired,
    // and the claim now lives where every consumer reads it — in the source.
    expect(seqSource).toContain("opaque record Seq(+a) = { pull: () -> Option((a, Seq(a))) }");
  });

  test("no `import` lines — prelude source names earlier prelude members implicitly", () => {
    // Modules §5.5. The header comment that used to accompany this rule was
    // withdrawn 2026-08-01 and is asserted absent, not present: the rule is
    // about what the source may not contain, and never needed a note saying so.
    expect(seqSource).not.toMatch(/^import /mu);
    expect(seqSource).not.toContain("implicitly in scope via the prelude");
  });
});

describe("each doc block sits at the declaration it describes", () => {
  test("the type doc rides the record, and `ReentrancyError` keeps only its own", () => {
    // #561. Adjacent doc blocks concatenate and attach to the next code token
    // (Doc Comments §3.2, §4.1), so the type doc written above the exception's
    // doc documented the *exception* — and the record it describes emitted with
    // no documentation at all. A blank line repairs nothing (§3.2: blank lines
    // are invisible to attachment); only the order of the blocks does, which is
    // why this reads the emitted seats rather than the source's line order.
    //
    // The **`.d.ts`** carries the record's seat. The emitted JavaScript no
    // longer has one: `Seq` is opaque, so its constructor is exported nowhere,
    // and every construction in the module is a direct application that erases
    // (Products §5.4, #770) — so the function is materialised for no one and
    // the type doc that rode it has nothing left to ride. The exception's seat
    // is in both artifacts and answers in both, which is what keeps the #561
    // misfire — the type doc landing on the *exception* — falsifiable here.
    const seq = compileSeq(IMPORT + "export let ok: Int = 1\n")
      .modules.find(({ source }) => source.path === "/Seq.hex")!;

    // `?? "(undocumented)"` so the failure names the defect rather than the
    // shape of `undefined`: an unattached type doc leaves the record bare.
    expect(docAbove(seq.declarations.text, "export type Seq<a> = ") ?? "(undocumented)")
      .toContain("A lazy, immutable, possibly infinite sequence");
    expect(seq.javascript.text).not.toContain("const Seq = ");
    expect(seq.javascript.text).not.toContain(
      "A lazy, immutable, possibly infinite sequence",
    );

    for (const [emitted, exception] of [
      [seq.javascript.text, "const ReentrancyError = "],
      [seq.declarations.text, "export type ReentrancyError = "],
    ] as const) {
      expect(docAbove(emitted, exception)).toBe(
        "Raised when a sequence position is forced while it is already being\n" +
        "forced (FFI Part 3 section 7.3-7.4).",
      );
    }
  });
});
