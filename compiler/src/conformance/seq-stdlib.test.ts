import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import seqSource from "../../../stdlib/Seq.hex?raw";

/**
 * `stdlib/Seq.hex` as written, ahead of joining the prelude
 * (`spec/notes/seq-deintrinsification-plan.md` Phase 4, step 7).
 *
 * The file is the de-intrinsified `Seq`: `export opaque record Seq(a)` plus the
 * §6.2 protocol and the combinator core, per Loops §6.6. It is mounted here as
 * an ordinary module because joining `PRELUDE_MODULES` requires step 8 — the
 * intrinsic `Seq` producers must be repointed first, or the record and the
 * intrinsic coexist under one name and never unify (Phase 2's carry-forward).
 *
 * What this file pins is that the *source* is ready: it compiles, and the three
 * things step 7 asks for are all real rather than assumed —
 *
 * 1. the `emptyCore`/`empty` split is gone (PR #86's amendment predicted this
 *    once defect 7 was fixed; a single annotated `export let empty: Seq(a)`
 *    generalizes and serves `singleton`, `take`, and `flatMap`);
 * 2. the defect-1 workaround is reverted — recursive bodies call `next(source)`
 *    rather than driving `(source.pull)()` inline;
 * 3. the defect-2 workaround is reverted — arms are written `Some((value, rest))`
 *    rather than binding the payload whole and destructuring on the next line.
 *
 * The behavioural conformance for these combinators lives in `seq.test.ts` and
 * is deliberately representation-blind; step 9 repoints it at the prelude `Seq`
 * wholesale. Rather than duplicate it, this file asserts the properties that
 * would silently regress if someone "tidied" the source back toward a workaround.
 */

function diagnostics(entry: string): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(1), "/Seq.hex", seqSource),
    new Source.File(Source.fileId(0), "/main.hex", entry),
  ]).diagnostics.map((diagnostic) => diagnostic.message);
}

const IMPORT = "import * as Seq from \"./Seq\"\n";

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
    expect(seqSource).toContain("export let empty: Seq(a) = Seq({ pull: () => None })");
  });

  test("the declaration is the opaque record Loops §6.6 specifies", () => {
    expect(seqSource).toContain("export opaque record Seq(a) = { pull: () -> Option((a, Seq(a))) }");
  });

  test("no `import` lines — prelude source uses the header-comment convention", () => {
    // Modules §5.5. Checked now so the file is already conformant on the day it
    // joins the set.
    expect(seqSource).not.toMatch(/^import /mu);
    expect(seqSource).toContain("implicitly in scope via the prelude");
  });
});
