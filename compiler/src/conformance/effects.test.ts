/**
 * Conformance for the effects discipline (`spec/effects.md`), which is
 * unconditional since #364 removed the flag it shipped behind.
 *
 * The acceptance test the ruling names is the `Seq` migration — the five strict
 * consumers' signatures flipped to a linked `>->` and their bodies wearing one
 * `!` each — with `fold`'s body as the designated specimen: each of its calls
 * must demand exactly its one correct mark, and mutating a mark must be an
 * error naming the fixit, in both directions.
 *
 * Everything else here is one scratch module per section. The `Seq` these tests
 * read is `stdlib/Seq.hex` itself — the migrated prelude member, one source of
 * truth, since the discipline's removal from behind the flag is what let the
 * stdlib copy carry the marks at all.
 */

import { describe, expect, it } from "vitest";
import seqSource from "../../../stdlib/Seq.hex?raw";
import { hoverMarkdown } from "../analysis/hover-text.js";
import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/** Diagnostics of a compiled project. */
function effectDiagnostics(
  files: readonly (readonly [string, string])[],
  trustedStandardLibraryModules: ReadonlySet<string> = new Set(),
): readonly string[] {
  return compileFiles(files, { trustedStandardLibraryModules }).diagnostics.map(({ message }) => message);
}

/**
 * The same, with `Seq` reachable. The prelude's own `Seq.hex` is injected, so
 * this is only a name for the one-file shape the `Seq` probes below share.
 */
function withSeq(main: string): readonly string[] {
  return effectDiagnostics([["/main.hex", "module Main\n\n" + main]]);
}

/** Every fix replacement a project offered, so a test can pin the fixit text. */
function effectFixes(
  files: readonly (readonly [string, string])[],
  trustedStandardLibraryModules: ReadonlySet<string> = new Set(),
): readonly string[] {
  return compileFiles(files, { trustedStandardLibraryModules }).diagnostics.flatMap((diagnostic) =>
    (diagnostic.fixes ?? []).flatMap((fix) =>
      fix.edits.map((edit) => `${fix.message}: ${JSON.stringify(edit.replacement)}`)
    )
  );
}

/**
 * Every diagnostic's primary span and its fixit's edits, as source offsets, so
 * a test can pin *where* a report stands rather than only what it says. §4.2's
 * placement is a claim about spans and nothing else: the same sentence at the
 * wrong arrow is the defect #408 filed.
 */
function effectSpans(
  files: readonly (readonly [string, string])[],
): readonly { readonly primary: number; readonly edits: readonly number[] }[] {
  return compileFiles(files).diagnostics.map((diagnostic) => ({
    primary: diagnostic.primary.start.offset,
    edits: (diagnostic.fixes ?? []).flatMap((fix) =>
      fix.edits.map((edit) => edit.span.start.offset)
    ),
  }));
}

/** The `.d.ts` one file of a project emits. */
function declarationsOf(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const compiled = compileFiles(files);
  return compiled.modules.find((module) => module.source.path === path)!.declarations.text;
}

/** What a hover where `needle` is written shows as the type there. */
function hoveredType(source: string, needle: string): string | undefined {
  const session = new AnalysisSession();
  session.setFile("/world.js", "");
  session.setFile("/main.hex", source);
  return session.hover("/main.hex", source.indexOf(needle))?.displayedType;
}

/**
 * A user-written extern block. Ruling 4 makes these effectful by default, so
 * this is the only way a fixture can get an impure face at all — which is
 * itself the point: the pure corpus stays pure until something foreign enters.
 */
const world = `extern from "./world.js"
    export fun readLine() ->! String
    export fun save(document: String) ->! Unit
    export fun audit(document: String) ->! Unit
    export fun trim(document: String) -> String
`;

/**
 * Effects §4.4's inlet-less clause **at an extern row**, which FFI Part 4 §4.5
 * owes the advice in words besides: a boundary row has no body, so the repair
 * is a declaration the author writes (#869).
 */
const UNLINKED_EXTERN_ROW = "`>->` means only as effectful as what it is handed, and nothing is handed here " +
  "— no callback of this signature has been handed over by the time this arrow " +
  "runs; write `->!` for a function that may touch the world, or `->` for one that " +
  "does not — write the callback parameter this row runs, with `->!`, or write " +
  "`->!` on the row";

/** FFI Part 4 §13's colon row *(#869)*. */
const RETIRED_COLON = "an extern callable declares its effect — write `->` for a function " +
  "that touches nothing, `->!` for one that may, `>->` for one exactly as effectful as a " +
  "callback it is handed; when in doubt, `->!`";

/** FFI Part 4 §4.5's worked example, verbatim — the five arrows it writes. */
const SPECIMENS = `extern from "./operations.js"
    export fun trim(text: String) -> String
    export fun read(path: String) ->! String
    export fun run(action: () ->! Unit) >-> Unit
    export fun defer(action: () ->! Unit) -> (() >-> Unit)
    export fun transaction(action: () ->! Unit) ->! Unit
`;

/** Effects §9's mark-position row, the one every misplaced mark takes. */
const markSeat =
  "a call mark governs an argument list; write it immediately before `(`, " +
  "or (in a `|>` stage) at the end of the stage — a reference carries no colour";

/** Effects §9's type-arrow row: `=>` written where a type arrow belongs (#410). */
const typeArrowRedirect =
  "Hexagon's type arrows are `->`, `->!`, `>->`; `=>` is the lambda arrow — " +
  "for a function type write `Int -> Int` (or `->!` / `>->` for its colour)";

describe("the discipline, unconditional", () => {
  it("compiles the whole prelude and runtime clean", () => {
    expect(effectDiagnostics([["/main.hex", "module Main\n\n" + "export let x: Int = 1\n"]])).toEqual([]);
  });

  it("compiles the migrated Seq clean — the acceptance test", () => {
    expect(withSeq("export let x: Int = 1\n")).toEqual([]);
  });
});

describe("#355 fold's body — the designated specimen, in both directions", () => {
  /**
   * `stdlib/Seq.hex` with one mark in `fold`'s body mutated, seated as the
   * prelude member through an explicit host grant, which is how the migrated
   * source itself is put under test.
   */
  function foldWith(next: string, combine: string): readonly string[] {
    const foldBody = seqSource.slice(seqSource.indexOf("export let fold("));
    const mutatedBody = foldBody
      .replace("match next(current)", `match next${next}(current)`)
      .replace("combine!(accumulator, value)", `combine${combine}(accumulator, value)`);
    // Guard against a replacement that silently matched nothing: only the
    // no-mutation case may leave the body untouched.
    expect(mutatedBody === foldBody).toBe(next === "" && combine === "!");
    const mutated = seqSource.slice(0, seqSource.indexOf("export let fold(")) + mutatedBody;
    return effectDiagnostics(
      [["/Seq.hex", mutated], ["/main.hex", "module Main\n\n" + "export let x: Int = 1\n"]],
      new Set(["Seq"]),
    );
  }

  it("wants no mark on `next` and `!` on `combine`", () => {
    expect(foldWith("", "!")).toEqual([]);
  });

  it("bare -> `!`: an unmarked call on a callback is refused with the `!` fixit", () => {
    expect(foldWith("", "")).toEqual([
      "this call may touch the world, so `combine` wants `!`, not no mark",
    ]);
  });

  it("bare -> `!`: a bare call on a constant-impure arrow is refused", () => {
    // `save` is impure by ruling 4's extern default, and the report names `!`.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let run(document: String): Unit = save(document)
`]]),
    ).toEqual([
      "this call may touch the world, so `save` wants `!`, not no mark",
    ]);
  });

  it("`!` -> bare: symmetric enforcement, a mark on a provably pure call", () => {
    expect(foldWith("!", "!")).toEqual([
      "this call is pure, so `next` wants no mark, not `!`",
    ]);
  });

  it("offers exactly one token as the fix, in each direction", () => {
    const mutated = seqSource.replace("combine!(accumulator, value)", "combine(accumulator, value)");
    expect(
      effectFixes(
        [["/Seq.hex", mutated], ["/main.hex", "module Main\n\n" + "export let x: Int = 1\n"]],
        new Set(["Seq"]),
      ),
    ).toEqual(['mark the call `!`: "!"']);
  });
});

describe("#355 ruling 6 — the outermost arrow", () => {
  const compose = `${world}
export let save2(document: String): String =
    save!(document)
    document

export let audit2(document: String): String =
    audit!(document)
    document

export let compose(first: String ->! String, second: String ->! String): (String >-> String) =
    (document) => second!(first!(document))
`;

  it("a call that only wires impurity through is bare", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${compose}
export let wired: (String ->! String) = compose(save2, audit2)
`]]),
    ).toEqual([]);
  });

  it("but the composite it returns demands `!` at its own call", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${compose}
export let run(document: String): String = compose(save2, audit2)(document)
`]]),
    ).toEqual([
      "this call may touch the world, so this call wants `!`, not no mark",
    ]);
  });
});

describe("#405 the inlet rule — `>->` is refused where nothing can link it", () => {
  /**
   * The predecessor of this block pinned the *else-constant rule*: a `=>` with
   * nothing to link to was read as the impure constant. #405 withdrew that
   * reading, so each of those probes is now a refusal, and the two that were
   * only ever about the extern default survive unchanged.
   */

  it("keeps the extern default doing the work it always did", () => {
    // Never the else-constant rule's client: a user extern is impure by the
    // ownership split (§6.1), and always was.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let ask(): String = readLine!()
`]]),
    ).toEqual([]);
  });

  it("refuses to let a caller instantiate it pure", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let ask(): String = readLine()
`]]),
    ).toEqual([
      "this call may touch the world, so `readLine` wants `!`, not no mark",
    ]);
  });

  it("colours the enclosing function, so its own callers wear `!` too", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let ask(): String = readLine!()
export let twice(): String = ask() ++ ask!()
`]]),
    ).toEqual([
      "this call may touch the world, so `ask` wants `!`, not no mark",
    ]);
  });

  it("refuses `>->` in a `record` field, naming the field as data", () => {
    // The predecessor read this as the impure constant. It is now §4.4's error:
    // a record declaration has no signature to quantify over, so the arrow has
    // nothing to denote — and a rejection is not a second meaning.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export record Source = { step: () >-> String }
export let drive(source: Source): String = (source.step)!()
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — a `record` field is data, not a signature; write `->!` for a " +
      "function that may touch the world, or `->` for one that does not",
    ]);
  });

  it("offers `->!` as the fix, which is what the writer meant", () => {
    expect(
      effectFixes([["/main.hex", "module Main\n\n" + `
export record Source = { step: () >-> String }
`]]),
    ).toEqual(['write `->!`: "->!"']);
  });

  it("refuses `>->` in a `union` field for the same reason", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export union Step = Ready(() >-> String) | Done
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — a `union` field is data, not a signature; write `->!` for a function " +
      "that may touch the world, or `->` for one that does not",
    ]);
  });

  it("refuses `>->` in a `type` alias body, before the body can be inlined", () => {
    // Reported by the resolver, at the declaration: transparency means an alias
    // inlined into a signature that happens to have an inlet would otherwise
    // silently link, and one alias would name two colours across two mentions
    // (Declarations Preamble §5.1.1).
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
type Handler = () >-> String
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — an alias is a type fragment, not a signature; write `->!` for a " +
      "function that may touch the world, or `->` for one that does not",
    ]);
  });

  it("refuses it once, not twice, when the alias is also used", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
type Handler = () >-> String
export let run(h: Handler): String = h!()
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — an alias is a type fragment, not a signature; write `->!` for a " +
      "function that may touch the world, or `->` for one that does not",
    ]);
  });

  it("reports every offending arrow, not just the first in a file", () => {
    // The dedupe that keeps one arrow from being reported twice keys on source
    // *offsets*. Keying on the `Position` objects instead gave every arrow in a
    // file one `[object Object]` key, which silently turned the dedupe into a
    // per-file latch: a writer fixed one arrow, recompiled, and discovered the
    // next. Three independent offences owe three reports.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export record R = { step: () >-> String }
export record S = { other: (Int) >-> Int }
export union U = A(() >-> Int) | B
`]]).length,
    ).toBe(3);
  });

  it("admits a `>->` in an extern row's parameter — the row is a signature", () => {
    // An extern declares a signature like any other, so FFI Part 4 §4.5's
    // "function-typed slots carry whatever arrows the author writes" covers
    // `>->` too. The parameter is its own inlet (§2.2.1).
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun run(k: () ->! String) ->! String
`]]),
    ).toEqual([]);
  });

  it("quantifies that row's colour, so two call sites may instantiate it apart", () => {
    // The row's own colour is the §6.1 default; the signature's variable belongs
    // to its callback slot. Left unquantified it would be one module-global
    // variable that the first call site pinned for every other — so a pure
    // callback and an impure one in the same module is the test that matters.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun run(k: () ->! String) ->! String
    export fun save(document: String) ->! Unit

export let pureUse(): String = run!(() => "x")
export let impureUse(): String = run!(() =>
    save!("a")
    "x")
`]]),
    ).toEqual([]);
  });

  it("still refuses a received-only `>->` in an extern row", () => {
    // #408's second refused shape: the arrow stands in what every application
    // hands *back*, so no argument the caller supplies contains it. The spine
    // walk reaches this result and finds the colour only on the arrow's own
    // slot, which is not an inlet.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun mk(seed: String) ->! (String >-> String)
`]]),
    ).toEqual([UNLINKED_EXTERN_ROW]);
  });

  it("takes the impure constant in a data field, spelled", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export record Source = { step: () ->! String }
export let drive(source: Source): String = (source.step)!()
`]]),
    ).toEqual([]);
  });

  it("refuses the bare call through that field", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export record Source = { step: () ->! String }
export let drive(source: Source): String = (source.step)()
`]]),
    ).toEqual([
      "this call may touch the world, so this call wants `!`, not no mark",
    ]);
  });

  it("reads the same record shape as linked when it stands in a signature", () => {
    // The position still decides, but it now decides legal-vs-rejected rather
    // than between two meanings (§2.5): here the arrow is in a parameter
    // annotation, so it is part of this signature, links, and *is* the inlet
    // that makes itself legal.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export let drive(source: { step: () ->! String }): String = (source.step)!()
`]]),
    ).toEqual([]);
  });

  it("keeps a `->` field pure beside it — branch (ii)'s posture", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export record Pure = { step: () -> String }
export let drive(source: Pure): String = (source.step)()
`]]),
    ).toEqual([]);
  });

  it("honours a user extern's `pure` claim", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let clean(document: String): String = trim(document)
`]]),
    ).toEqual([]);
  });
});

describe("#408 the inlet reaches the whole application spine", () => {
  /**
   * The counterexample the issue was filed on. `mk` is definable, usable and
   * hoverable, and its face was un-writable: the inlet test read the written
   * *parameter* annotations only, so a colour the caller pins at the second
   * application looked like one nobody could pin. The spine walk is what closes
   * the gap — a curried signature is applied step by step, and each step's
   * arguments come from a caller.
   */
  const mk = `export let mk(): ((Int) ->! Int) >-> Int = (g: (Int) ->! Int): Int => g!(1)
`;

  it("admits the inferred face, unchanged", () => {
    const inferred = `let mk() = (g: (Int) ->! Int): Int => g!(1)
export let z: Int = mk()((n) => n)
`;
    expect(effectDiagnostics([["/main.hex", "module Main\n\n" + inferred]])).toEqual([]);
    // §10's premise, restored: the display shows one variable undecorated, and
    // the grammar can now spell what it shows. Nothing about the inferred form
    // moved — the widening changes which *written* faces are legal.
    expect(hoveredType(inferred, "mk()")).toBe("() -> (Int ->! Int) >-> Int");
  });

  it("now admits that face written down, and exported", () => {
    expect(effectDiagnostics([["/main.hex", "module Main\n\n" + mk]])).toEqual([]);
  });

  it("admits a three-step spine, whose inlet arrives at the third application", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let mk3(): (Int) -> (((Int) ->! Int) >-> Int) =
    (a: Int): (((Int) ->! Int) >-> Int) => (g: (Int) ->! Int): Int => g!(a)
`]]),
    ).toEqual([]);
  });

  it("refuses a `>->` over a parameter that is data: a record type in a parameter is no callback", () => {
    // Every arrow inside a parameter type other than a callback's own means
    // what it says (§2.4): the record's field is the impure constant, so there
    // is no callback for the `>->` to follow (§2.2.1).
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let mkr(): ({ step: () ->! String }) >-> String =
    (source: { step: () ->! String }): String => (source.step)!()
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
      "no callback of this signature has been handed over by the time this arrow runs; " +
      "write `->!` for a function that may touch the world, or `->` for one that does not",
    ]);
  });

  it("carries the face across the module boundary, at both colours", () => {
    // The export obligation the issue named: "un-exportable in principle" is
    // what the refusal made it. A second module instantiates the one variable
    // pure at one call and impure at the next, which is what a caller-pinned
    // colour means.
    expect(
      effectDiagnostics([
        ["/world.js", ""],
        ["/maker.hex", "module Maker\n\n" + mk],
        ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun save(document: String) ->! Unit

import Maker

export let pureUse(): Int = Maker.mk()((n) => n)
export let impureUse(): Int = Maker.mk()!((n) =>
    save!("x")
    n)
`],
      ]),
    ).toEqual([]);
  });

  it("emits the face into the declaration file", () => {
    // One variable, the spine's: `mk`'s own outer colour is unconstrained, and
    // it defaults pure whatever the inlets (§3.4, #868) — so nothing is
    // numbered and the face writes back as it reads.
    expect(declarationsOf([["/main.hex", "module Main\n\n" + mk]])).toContain(
      "Hexagon: `() -> (Int ->! Int) >-> Int`",
    );
  });

  it("still refuses the outer-only face, a local one with the local clause", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f(x: Int): Int =
    let g: (String) >-> Int = (s: String): Int => 1
    x
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
      "this annotation has no callbacks of its own, and a local `>->` does not borrow the " +
      "enclosing function's — leave its type to inference, or write `->!`",
    ]);
  });

  it("still refuses the received-only face, at a declaration's return annotation", () => {
    // The spine walk reaches this arrow and asks the right question of it: the
    // colour stands on the arrow the caller *receives*, and in no parameter of
    // any step, so nothing instantiates it.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f(x: Int): (String) >-> Int = (s: String): Int => 1
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
      "no callback of this signature has been handed over by the " +
      "time this arrow runs; " +
      "write `->!` for a function that may touch the world, or `->` for one that does not",
    ]);
  });

  it("offers `->!` at both refusals, the fixit §4.4 gives every position", () => {
    expect(
      effectFixes([["/main.hex", "module Main\n\n" + `export let f(x: Int): (String) >-> Int = (s: String): Int => 1
`]]),
    ).toEqual(['write `->!`: "->!"']);
  });
});

describe("Effects §2.2.1 — a local `>->` borrows nothing (#1145, E-a)", () => {
  const LOCAL = "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
    "this annotation has no callbacks of its own, and a local `>->` does not borrow the " +
    "enclosing function's — leave its type to inference, or write `->!`";
  /** `f`, with its one local position written the two ways that once borrowed. */
  const annotated = `export let f(g: () ->! String): String =
    let h: () >-> String = g
    h!()
`;
  const ascribed = `export let f(g: () ->! String): String =
    let h = (g : () >-> String)
    h!()
`;

  it("refuses the binding annotation and the ascription alike, at the arrow", () => {
    expect(effectDiagnostics([["/main.hex", "module Main\n\n" + annotated]])).toEqual([LOCAL]);
    expect(effectDiagnostics([["/main.hex", "module Main\n\n" + ascribed]])).toEqual([LOCAL]);
  });

  it("reads the refused arrow as its fixit, the impure constant, so `f` is a source", () => {
    expect(hoveredType(annotated, "f(g")).toBe("(() ->! String) ->! String");
    expect(hoveredType(ascribed, "f(g")).toBe("(() ->! String) ->! String");
  });

  it("leaves a local that should follow the callback to inference", () => {
    const inferred = `export let f(g: () ->! String): String =
    let h = g
    h!()
`;
    expect(effectDiagnostics([["/main.hex", "module Main\n\n" + inferred]])).toEqual([]);
    expect(hoveredType(inferred, "f(g")).toBe("(() ->! String) >-> String");
    expect(hoveredType("export let f(g: () ->! String): String = g!()\n", "f(g"))
      .toBe("(() ->! String) >-> String");
  });

  it("keeps a local function type with callbacks of its own a signature of its own", () => {
    // `k` has a callback of its own, so it quantifies its own colour: pinning
    // that colour impure at a call says nothing about `f`'s face, which stays
    // effect-polymorphic.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let f(g: () ->! String): String =
    let k(q: () ->! String): String = q!()
    k!(readLine) ++ g!()
`]]),
    ).toEqual([]);
  });

  it("refuses both spellings in a body with no callbacks either", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f(x: Int): Int =
    let h: () >-> String = () => "s"
    x
`]]),
    ).toEqual([LOCAL]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f(x: Int): Int =
    let h = ((): String => "s" : () >-> String)
    x
`]]),
    ).toEqual([LOCAL]);
  });

  it("names the missing signature where there is no signature to lack an inlet", () => {
    // §2.2.1's boundaries, and §4.4's rows. A function in a record type of a
    // module-level binding is a signature of its own (#1176), here one handed
    // nothing; an `extern let` declares a foreign *value* whatever its
    // annotation's shape — the callable form with a signature of its own is
    // `extern fun` (FFI Part 4 §4.5).
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `let h: { step: () >-> String } = { step = () => "x" }
export let z: Int = 1
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
      "no callback of this signature has been handed over by the time this arrow runs; " +
      "write `->!` for a function that may touch the world, or `->` for one that does not",
    ]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let handler: () >-> String
`]]),
    // The extern `let` is the exception Effects §9 names: its annotation is a
    // function type, so FFI Part 4 §13's callable-intended row is the whole
    // report and §4.4's refusal is not stacked on top of it.
    ).toEqual([
      "extern callable declarations use `fun`; a binding of type `() >-> String` is " +
      "callable — write `fun handler() >-> String`",
    ]);
  });

  it("takes the local clause for a record type inside a body too", () => {
    // The record's function is a signature of its own with no callbacks, and a
    // body lends it nothing (§2.2.1).
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f(x: Int): Int =
    let h: { step: () >-> String } = { step = () => "s" }
    x
`]]),
    ).toEqual([LOCAL]);
  });

  it("calls a module-level function-type annotation a signature, and names its want", () => {
    // A binding annotation that is itself a function type is a signature
    // *wherever it stands*, so the inlet-less one is an outer-only face and owes
    // §2.2.1's sentence: it is not that there is no signature here, it is that
    // nothing a caller supplies carries the colour. The `var` goes the same way
    // — shape decides for it as for a `let` — under its own module-level refusal.
    const clause = "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — no callback of this signature has been handed over by the time this " +
      "arrow runs; write `->!` for a function that may touch the world, or `->` " +
      "for one that does not";
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `let h: () >-> String = () => "x"
export let z: Int = 1
`]]),
    ).toEqual([clause]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `var h: () >-> String = () => "x"
export let z: Int = 1
`]]),
    ).toEqual([
      "`var` is only allowed inside a function",
      // *(#700.)* And a `var` may not have a function type at all (Statements
      // §6.1) — a second refusal on the same line, which does not disturb the
      // one this test is about: the annotation is still read as a signature.
      "`h` is a `var`, and a `var` cannot hold a function — vars accumulate data; " +
        "model changing behavior as a union and `match` on it",
      clause,
    ]);
    // And the module-level function type *with* an inlet is a signature that has
    // one, so it opens and stays legal.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `let h: (() ->! String) >-> String = (k: () ->! String): String => k!()
export let z: Int = 1
`]]),
    ).toEqual([]);
    expect(
      effectFixes([["/main.hex", "module Main\n\n" + `let h: () >-> String = () => "x"
export let z: Int = 1
`]]),
    ).toEqual(['write `->!`: "->!"']);
  });
});

describe("Effects §4.2 — where the face reports stand", () => {
  it("an arrow in a callback's own parameters is a constant, so handing it an effectful function is no report", () => {
    const nested = `${world}
export let step(n: Int): Int =
    save!("x")
    n

export let f(h: ((Int) ->! Int) -> Int): Int = h(step)
`;
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + nested]])).toEqual([]);
    expect(hoveredType("module Main\n\n" + nested, "f(h")).toBe("((Int ->! Int) -> Int) -> Int");
  });

  it("the lie of generality rewrites every `->!` that spells the colour, and a `>->` left handed nothing", () => {
    // §4.2: the callback meets a `->` demand, so its colour is pure, and every
    // arrow that spells it — the annotation's and the lambda parameter's — is
    // over-claiming; the outer `>->`, which followed only it, goes with them.
    const pureFace = `export let strict(step: String -> String, d: String): String = step(d)
export let f: ((String ->! String) >-> String) = (run: String ->! String): String =>
    strict(run, "body")
`;
    expect(effectDiagnostics([["/main.hex", "module Main\n\n" + pureFace]])).toEqual([
      "the parameter `run` is written `->!`, which accepts any function, and this accepts only a " +
      "pure one — write `run`'s arrow `->`",
    ]);
    expect(effectFixes([["/main.hex", "module Main\n\n" + pureFace]])).toEqual([
      'write `->`: "->"',
      'write `->`: "->"',
      'write `->`: "->"',
    ]);
    // And the rewrite is a repair: the same program with `->` throughout checks.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let strict(step: String -> String, d: String): String = step(d)
export let f: ((String -> String) -> String) = (run: String -> String): String =>
    strict(run, "body")
`]]),
    ).toEqual([]);
  });

  it("a lambda a written `>->` result returns answers to that `>->` at its offending call", () => {
    const at = (source: string) => {
      const text = "module Main\n\n" + world + source;
      return compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics.map((diagnostic) => [
        text.slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset),
        diagnostic.message,
        (diagnostic.labels ?? []).map(({ span }) => text.slice(span.start.offset, span.end.offset)),
      ]);
    };
    const promise = "and this face's `>->` promises the function is only as effectful as what it is handed — write `->!`";
    // On its own account, at the call, however deep the returned lambda stands.
    for (const result of ["() >-> Unit = () =>", "() -> () >-> Unit = () => () =>"]) {
      expect(at(`export let mk(cb: () ->! Unit): ${result} save!("x")\n`)).toEqual([
        ["save!(\"x\")", `this call touches the world on its own account, ${promise}`, [">->"]],
      ]);
    }
    // Running a captured colour, at the call, with §4.2's captured clause.
    expect(at(`export let outer(action: () ->! Unit): Unit =
    let mk(cb: () ->! Unit): () >-> Unit = () =>
        action!()
    let x = mk(() => save!("y"))
    ()
`)).toEqual([["action!()", `this call runs \`outer\`'s \`action\`, which this signature is not handed, ${promise}`, [">->"]]]);
  });

  it("a refused `>->` reads as its fix, `->!`, where callers meet it", () => {
    // The refused arrow is §4.2's one report: callers' marks are read against
    // the face the fix writes, as §4.4's refused `>->` reads as its fixit.
    const refusedResult = `export let mk(cb: () ->! Unit): () >-> Unit = () => save!("x")
export let use(): Unit = mk(noop)()
`;
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + "let noop(): Unit = ()\n" + refusedResult]]))
      .toEqual([
        "this call touches the world on its own account, and this face's `>->` promises the function is only as effectful as what it is handed — write `->!`",
        "this call may touch the world, so this call wants `!`, not no mark",
      ]);
    expect(hoveredType("module Main\n\n" + world + "let noop(): Unit = ()\n" + refusedResult, "mk(")).toBe("(() ->! Unit) -> () ->! Unit");
    const refusedOuter = `export let outer(action: () ->! Unit): Unit =
    let mk: (() ->! Unit) >-> Unit = (cb) => action!()
    mk!(() => ())
`;
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + refusedOuter]])).toEqual([
      "this call runs `outer`'s `action`, which this signature is not handed, and this face's `>->` promises the function is only as effectful as what it is handed — write `->!`",
    ]);
  });

  it("a colour still to be decided is compared once it is, and the published arrow carries it until then", () => {
    const text = (source: string) => "module Main\n\n" + world + "let noop(): Unit = ()\n" + source;
    const at = (source: string) => compileFiles([["/world.js", ""], ["/main.hex", text(source)]]).diagnostics
      .map((diagnostic) => [
        text(source).slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset),
        diagnostic.message.split(", and this face's")[0],
      ]);
    // An enclosing body's untyped callback: decided by its claims at its close.
    for (const value of ["let g = () => action!()\n        g", "() => action!()"]) {
      expect(at(`let outer(action): Unit =
    action!()
    let h(cb: () ->! Unit): () >-> Unit =
        ${value}
    h(() => ())!()
`)).toEqual([["action!()", "this call runs `outer`'s `action`, which this signature is not handed"]]);
    }
    // Unclaimed, it is pure: nothing to report.
    expect(at(`let outer(action): Unit =
    let h(cb: () ->! Unit): () >-> Unit =
        let g = () => action()
        g
    h(() => ())()
`)).toEqual([]);
    // A knot's colour, decided at the knot's close: the callers follow it.
    for (const value of ["() => b!(n)", "\n            let g = () => b!(n)\n            g"]) {
      const source = `fun
    a(n: Int): Unit =
        let h(cb: () ->! Unit): () >-> Unit = ${value}
        h(() => ())!()
    b(n: Int): Unit = if n == 0 then save!("x") else a!(n - 1)
`;
      expect(at(source)).toEqual([["b!(n)", "this call touches the world on its own account"]]);
      expect(hoveredType(text(source), "a(n")).toBe("Int ->! Unit");
    }
  });

  it("searches only the functions the value hands back, and stands at the value where none runs it", () => {
    const text = (source: string) => "module Main\n\n" + world + source;
    const at = (source: string) => compileFiles([["/world.js", ""], ["/main.hex", text(source)]]).diagnostics
      .map((diagnostic) => text(source).slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset));
    expect(at(`export let h(cb: () ->! Unit): () >-> Unit =
    let unrelated = () => save!("a")
    unrelated!()
    let g = () => audit!("b")
    g
`)).toEqual(['audit!("b")']);
    expect(at(`let outer(action: () ->! Unit): Unit =
    let h(cb: () ->! Unit): () >-> Unit =
        let g = action
        g
    ()
`)).toEqual(["g"]);
    // An arrow a pin itself made impure is one report, not two.
    expect(at(`let apply(f: (() ->! Unit) ->! (() ->! Unit)): Unit = f!(() => ())!()
export let u(): Unit = apply!((cb: () ->! Unit): () >-> Unit => cb)
`)).toEqual(["cb"]);
  });

  it("never counts a call the body runs itself, and gives each arrow and each merged lambda its own search", () => {
    const text = (source: string) => "module Main\n\n" + world + source;
    const at = (source: string) => compileFiles([["/world.js", ""], ["/main.hex", text(source)]]).diagnostics
      .map((diagnostic) => text(source).slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset));
    // A condition the body evaluates is the body's own call.
    expect(at(`export let loud(): Bool =
    save!("a")
    True
export let h(cb: () ->! Unit): () >-> Unit =
    if loud!() then (() => cb!()) else (() => audit!("x"))
`)).toEqual(['audit!("x")']);
    // Two written `>->`: each answers for the lambda that stands under it.
    expect(at(`export let h(cb: () ->! Unit): () >-> (() >-> Unit) =
    () =>
        save!("a")
        () => audit!("b")
`)).toEqual(['save!("a")', 'audit!("b")']);
    // A merge of named lambdas searches both, whichever the unifier kept.
    for (const merge of ["if c then f1 else f2", "if c then f2 else f1"]) {
      expect(at(`export let h(c: Bool, cb: () ->! Unit): () >-> Unit =
    let f1 = () => cb!()
    let f2 = () => save!("x")
    let g = ${merge}
    g
`)).toEqual(['save!("x")']);
    }
    // A pin that is a knot's own unification names no act: the value stands.
    expect(at(`fun
    h(n: Int, cb: () ->! Unit): () >-> Unit =
        if n == 0 then cb else h(n - 1, () => save!("y"))
`)).toEqual(['if n == 0 then cb else h(n - 1, () => save!("y"))']);
  });

  it("names the enclosing signature's callback where a knot shares the colour", () => {
    const text = "module Main\n\n" + world + `fun
    a(n: Int, f: () ->! Unit): Unit =
        let h(cb: () ->! Unit): () >-> Unit = () => b!(n, f)
        h(() => ())!()
    b(n: Int, f: () ->! Unit): Unit = if n == 0 then f!() else a!(n - 1, f)
`;
    expect(compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics.map(({ message }) => message.split(", and this face's")[0]))
      .toEqual(["this call runs `a`'s `f`, which this signature is not handed"]);
  });

  it("any function value meeting a written `>->` is compared with it, never merged, whatever its shape", () => {
    // §4.2: a named local, a merge, a captured parameter, an annotation over a
    // lambda — each is compared with what the arrow is handed, and the report
    // stands at the first call that runs the colour it is not handed, or at
    // the value where no call does; the arrow then reads as `->!`.
    const at = (source: string) => {
      const text = "module Main\n\n" + world + "let noop(): Unit = ()\n" + source;
      return compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics.map((diagnostic) => [
        text.slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset),
        diagnostic.message.split(", and this face's")[0],
      ]);
    };
    const runs = "runs `outer`'s `action`, which this signature is not handed";
    const shapes: [string, readonly (readonly [string, string])[]][] = [
      ["let h(cb: () ->! Unit): () >-> Unit =\n        let g = () => action!()\n        g", [["action!()", `this call ${runs}`]]],
      ["let h(cb: () ->! Unit): () >-> Unit =\n        let g() = action!()\n        g", [["action!()", `this call ${runs}`]]],
      ["let h(cb: () ->! Unit): () >-> Unit = if c then (() => action!()) else (() => cb!())", [["action!()", `this call ${runs}`]]],
      ["let h: (() ->! Unit) -> () >-> Unit = (cb) => () => action!()", [["action!()", `this call ${runs}`]]],
      ["let h(cb: () ->! Unit): () >-> Unit = action", [["action", `this function ${runs}`]]],
    ];
    for (const [helper, expected] of shapes) {
      const source = `export let outer(action: () ->! Unit, c: Bool): Unit =\n    ${helper}\n    h(() => ())!()\n`;
      expect([helper, at(source)]).toEqual([helper, expected]);
      expect([helper, hoveredType("module Main\n\n" + world + "let noop(): Unit = ()\n" + source, "outer(")])
        .toEqual([helper, "(() ->! Unit, Bool) ->! Unit"]);
    }
    // What the arrow is handed fits, however the value is spelled.
    expect(at(`export let h(c: Bool, cb: () ->! Unit): () >-> Unit = if c then cb else noop
export let u(): Unit = h(True, noop)()
`)).toEqual([]);
    expect(at(`export let h(cb: () ->! Unit): () >-> Unit =
    let g = () => cb!()
    g
`)).toEqual([]);
    // A function handed back whole that touches the world: the no-call form.
    expect(at(`export let save0(): Unit = save!("z")
export let h(cb: () ->! Unit): () >-> Unit = save0
`)).toEqual([["save0", "this function touches the world on its own account"]]);
  });
});

describe("Effects §3.4 — a parameter with no written type is decided by its call marks", () => {
  const fixtures = "export let apply2(f: () ->! Unit, g: () ->! Unit): Unit =\n    f!()\n    g!()\n" +
    "export let pureOnly(f: () -> Unit): Unit = f()\n";
  const text = (source: string): string => "module Main\n\n" + fixtures + source;
  const check = (source: string): readonly string[] => effectDiagnostics([["/main.hex", text(source)]]);

  it("a `!` call claims the parameter's colour, and one no `!` claims is pure", () => {
    // §3.4's own examples, each with the face the spec gives it.
    const source = `let twice(f) =
    f!()
    f!()
let twicePure(f) =
    f()
    f()
let fwd(x, cb) = apply2!(x, cb)
let fwdPure(cb) = apply2(() => (), cb)
let relay(f: () ->! Unit, g): Unit = g!(f)
`;
    expect(check(source)).toEqual([]);
    expect(hoveredType(text(source), "twice(")).toBe("(() ->! Unit) >-> Unit");
    expect(hoveredType(text(source), "twicePure(")).toBe("(() -> Unit) -> Unit");
    expect(hoveredType(text(source), "fwd(")).toBe("(() ->! Unit, () ->! Unit) >-> Unit");
    expect(hoveredType(text(source), "fwdPure(")).toBe("(() -> Unit) -> Unit");
    expect(hoveredType(text(source), "relay(")).toBe("(() ->! Unit, (() ->! Unit) ->! Unit) >-> Unit");
  });

  it("a claimed colour is a callback's: a bare call on it is the missing-mark report", () => {
    expect(check("let mixed(f) =\n    f!()\n    f()\n")).toEqual([
      "this call may touch the world, so `f` wants `!`, not no mark",
    ]);
  });

  it("a claimed colour something else pins pure is pure, and the `!` is the mark report", () => {
    // `pinned(f)`: the `->` demand decides the colour, and there is no written
    // arrow for a lie-of-generality report to name.
    for (const lines of [["pureOnly(f)", "f!()"], ["f!()", "pureOnly(f)"]]) {
      expect(check(`let pinned(f) =\n    ${lines[0]}\n    ${lines[1]}\n`)).toEqual([
        "this call is pure, so `f` wants no mark, not `!`",
      ]);
    }
  });

  it("a claim made in a nested body is the enclosing parameter's, and never generalizes there", () => {
    // `h` runs `action`, a colour of `outer`'s environment: `h` does not
    // quantify it, so `h`'s `!` claims it and `outer` follows it.
    const world = 'extern from "./world.js"\n    export fun save(document: String) ->! Unit\n';
    for (const helper of ["let h() = action!()", "let h = () => action!()", "let h() = apply2!(action, action)"]) {
      const source = `${world}let outer(action): Unit =
    ${helper}
    h!()
let user(): Unit = outer!(() => save!("x"))
`;
      expect([helper, effectDiagnostics([["/world.js", ""], ["/main.hex", text(source)]])]).toEqual([helper, []]);
      expect([helper, hoveredType(text(source), "outer(")]).toEqual([helper, "(() ->! Unit) >-> Unit"]);
    }
    expect(check("let outer(action): Unit =\n    let h() = action!()\n    h()\n")).toEqual([
      "this call may touch the world, so `h` wants `!`, not no mark",
    ]);
  });
});

describe("Effects §3.4 — a parameter no call reaches keeps its own colour (#1178)", () => {
  const world = 'extern from "./world.js"\n    export fun save(document: String) ->! Unit\n' +
    'let save0(): Unit = save!("x")\nlet noop(): Unit = ()\nlet c = True\n' +
    "let keep(callback: () ->! Unit): Unit = ()\nlet runIt(callback: () ->! Unit): Unit = callback!()\n" +
    "let ident(x: a): a = x\n" +
    "export let pureOnly(f: () -> Unit): Unit = f()\n";
  const text = (source: string): string => "module Main\n\n" + world + source;
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", text(source)]]);
  const permutations = (lines: readonly string[]): string[][] =>
    lines.length <= 1 ? [[...lines]] : lines.flatMap((line, index) =>
      permutations([...lines.slice(0, index), ...lines.slice(index + 1)]).map((rest) => [line, ...rest])
    );
  const PURITY = "a `->` arrow promises purity, and this function may touch the world — the demand is written " +
    "`->`, the function's face `->!` or `>->`";

  it("a parameter only handed on is the parameter's own, as writing its type would make it", () => {
    // §3.4's examples: `hold` keeps what it is handed, `orNoop` returns it.
    const source = "let hold(cb) = keep(cb)\nlet orNoop(cb) = if c then cb else () => ()\n" +
      "export let user(): Unit =\n    hold(save0)\n    orNoop(save0)!()\n    orNoop(noop)()\n";
    expect(check(source)).toEqual([]);
    expect(hoveredType(text(source), "hold(cb)")).toBe("(() ->! Unit) -> Unit");
    expect(hoveredType(text(source), "orNoop(cb)")).toBe("(() ->! Unit) -> () >-> Unit");
    // What `orNoop` hands back follows what it was handed, so a bare call on it
    // is the missing-mark report.
    expect(check("let orNoop(cb) = if c then cb else () => ()\nexport let user(): Unit = orNoop(save0)()\n"))
      .toEqual(["this call may touch the world, so this call wants `!`, not no mark"]);
  });

  it("nested, in a knot, curried, local, and two functions deep", () => {
    const programs = [
      "let f(k) =\n    let g = () => keep(k)\n    g()\nexport let user(): Unit = f(save0)\n",
      "fun\n    a(k, n: Int): Unit = if n == 0 then keep(k) else b(k, n - 1)\n    b(k, n: Int): Unit = a(k, n)\n" +
        "export let user(): Unit = a(save0, 3)\n",
      "let f(k) = (n: Int) => keep(k)\nexport let user(): Unit = f(save0)(1)\n",
      "export let user(): Unit =\n    let fwd = (k) => keep(k)\n    fwd(save0)\n",
      "let g(j) = keep(j)\nlet f(k) = g(k)\nexport let user(): Unit = f(save0)\n",
    ];
    for (const source of programs) expect([source, check(source)]).toEqual([source, []]);
  });

  it("a colour two untyped parameters share, where no call reaches it, is pure: no written type can say it", () => {
    const source = "let both(k, j) = keep(if c then k else j)\n";
    expect(check(source + "export let user(): Unit = both(noop, noop)\n")).toEqual([]);
    expect(hoveredType(text(source), "both(k")).toBe("(() -> Unit, () -> Unit) -> Unit");
    expect(check(source + "export let user(): Unit = both(save0, noop)\n")).toEqual([PURITY]);
  });

  it("a colour shared with an untyped parameter of a nested body is shared too, in every order of the lines", () => {
    // `j` leaves the colour to the body around it, which counts it as shared:
    // a lambda's parameter, and a local function's.
    const lambda = "let f(k) = (j) => keep(if c then k else j)\n";
    expect(check(lambda + "export let user(): Unit = f(noop)(noop)\n")).toEqual([]);
    expect(hoveredType(text(lambda), "f(k)")).toBe("(() -> Unit) -> (() -> Unit) -> Unit");
    expect(check("let f(k) =\n    let g(j) = keep(if c then k else j)\n    g(noop)\nexport let user(): Unit = f(noop)\n"))
      .toEqual([]);
    // Two bodies down, too.
    expect(check("let f(k) = (n: Int) => (j) => keep(if c then k else j)\nexport let user(): Unit = f(noop)(1)(noop)\n"))
      .toEqual([]);
    const lines = ["keep(if c then k else noop)", "let r = (j) => keep(if c then k else j)"];
    const seen = permutations(lines).map((order) => {
      const body = "let f(k) =\n" + order.map((line) => "    " + line + "\n").join("") + "    ()\n";
      return [hoveredType(text(body), "f(k)"), check(body + "export let user(): Unit = f(noop)\n")];
    });
    expect(seen).toEqual([seen[0], seen[0]]);
    expect(seen[0]).toEqual(["(() -> Unit) -> Unit", []]);
  });

  it("a colour kept where its body closed is a callback's, as a written one would be, through a value that did not generalize", () => {
    // `g` does not generalize, so its parameter's colour is one colour: it accepts any function.
    expect(check("export let user(): Unit =\n    let g = ident((j) => keep(j))\n    g(save0)\n    g(noop)\n")).toEqual([]);
    expect(check("let f(k: () ->! Unit) =\n    let g = ident((j) => keep(j))\n    g(k)\nexport let user(): Unit = f(save0)\n"))
      .toEqual([]);
  });

  it("a bare call, a `!` call and a `->` demand still decide it, in every order of the lines", () => {
    const cases: readonly (readonly [readonly string[], string, readonly string[]])[] = [
      // A bare call reaches it: pure, so the effectful argument is refused.
      [["keep(k)", "k()"], "(() -> Unit) -> Unit", [PURITY]],
      // A bare call in a nested body reaches it too.
      [["keep(k)", "let g = () => runIt(k)"], "(() -> Unit) -> Unit", [PURITY]],
      // A `!` call claims it.
      [["keep(k)", "runIt!(k)"], "(() ->! Unit) >-> Unit", ["this call may touch the world, so `f` wants `!`, not no mark"]],
      // A `->` demand pins it.
      [["keep(k)", "pureOnly(k)"], "(() -> Unit) -> Unit", [PURITY]],
    ];
    for (const [lines, face, reports] of cases) {
      for (const order of permutations(lines)) {
        const body = "let f(k) =\n" + order.map((line) => "    " + line + "\n").join("") + "    ()\n";
        expect([order, hoveredType(text(body), "f(k)")]).toEqual([order, face]);
        expect([order, check(body + "export let user(): Unit = f(save0)\n")]).toEqual([order, reports]);
      }
    }
  });
});

describe("Effects §3.4 — a tie between callbacks is refused, where it was made", () => {
  const fixtures = "export let tieTwo(x: a, y: a): Unit = ()\n" +
    "export let pureOnly(f: () -> Unit): Unit = f()\n" +
    "export let takesD(f: (() -> Unit) ->! Unit): Unit = f!(() => ())\n";
  /** Each report as its primary's text, its message, its labels' texts, and its fixit's replacements. */
  const tieReports = (source: string) => {
    const text = "module Main\n\n" + fixtures + source;
    const at = (span: { start: { offset: number }; end: { offset: number } }): string =>
      text.slice(span.start.offset, span.end.offset);
    return compileFiles([["/main.hex", text]]).diagnostics.map((diagnostic) => ({
      at: at(diagnostic.primary),
      message: diagnostic.message,
      labels: (diagnostic.labels ?? []).map(({ span, message }) => `${at(span)}: ${message}`),
      fixes: (diagnostic.fixes ?? []).flatMap((fix) => fix.edits.map((edit) => edit.replacement)),
    }));
  };

  it("stands at the merge, labels the parameter, and writes the black-box reading", () => {
    for (const merge of ["tieTwo(action, cb)", "if True then cb else action"]) {
      expect(tieReports(`export let outer(action: () ->! Unit): Unit =
    let h = (cb) => ${merge}
    ()
`)).toEqual([{
        at: merge,
        message: "`cb`'s colour is tied to `action`'s here, and no written type can say that — write `cb`'s type",
        labels: ["cb: `cb` has no written type"],
        fixes: [": () ->! Unit"],
      }]);
    }
    // And the fixit is a repair: a written callback is fitted where it is used.
    expect(tieReports(`export let outer(action: () ->! Unit): Unit =
    let h = (cb: () ->! Unit) => tieTwo(action, cb)
    ()
`)).toEqual([]);
  });

  it("is one report per tie, at the first tied parameter, the others labels on it", () => {
    const source = `let pair(a, g) =
    let m = if True then a else g
    m!()
`;
    expect(tieReports(source)).toEqual([{
      at: "if True then a else g",
      message: "`a`'s colour is tied to `g`'s here, and no written type can say that — write `a`'s type",
      labels: ["a: `a` has no written type", "g: `g` has no written type"],
      // The result is still a type variable: the writer's intent is not plain.
      fixes: [],
    }]);
  });

  it("the refused parameter reads as its fixit from outside, so no caller meets the tie again", () => {
    const tied = `export let outer(action: () ->! Unit): Unit =
    let h = (cb) => tieTwo(action, cb)
    takesD(h)
`;
    expect(tieReports(tied).map(({ message }) => message)).toEqual([
      "`cb`'s colour is tied to `action`'s here, and no written type can say that — write `cb`'s type",
    ]);
    expect(hoveredType("module Main\n\n" + fixtures + tied, "h =")).toBe("(() ->! Unit) -> Unit");
  });

  it("a colour pinned to a constant, or met only by a slack, is no tie", () => {
    expect(tieReports(`export let outer(action: () ->! Unit): Unit =
    let k = (cb) =>
        pureOnly(cb)
        let g = if True then cb else () => ()
        ()
    ()
`)).toEqual([]);
  });

  it("is refused in a `fun` block as in a lone body", () => {
    const tie = "`f`'s colour is tied to `g`'s here, and no written type can say that — write `f`'s type";
    for (const head of ["fun\n    a", "let a"]) {
      const indent = head.startsWith("fun") ? "        " : "    ";
      expect(tieReports(`${head}(c: Bool, f, g): Unit =\n${indent}let h = if c then f else g\n${indent}h!()\n`)
        .map(({ message }) => message)).toEqual([tie]);
    }
  });

  it("to an enclosing untyped callback, decided where that callback's body closes", () => {
    // Claimed there, `g`'s colour is a callback's, and the merge ties `f` to
    // it; unclaimed, `g` is pure, and a colour pinned to a constant is no tie.
    expect(tieReports(`let outer(g, c: Bool): Unit =
    g!()
    let inner = (f) => if c then g else f
    ()
`).map(({ message }) => message)).toEqual([
      "`f`'s colour is tied to `g`'s here, and no written type can say that — write `f`'s type",
    ]);
    expect(tieReports(`let outer(g, c: Bool): Unit =
    let inner = (f) => if c then g else f
    ()
`)).toEqual([]);
  });

  it("is refused in a lambda a knot holds, reading its member's claims", () => {
    expect(tieReports(`fun
    a(g, c: Bool, n: Int): Unit =
        g!()
        let inner = (f) =>
            b!(g, c, n - 1)
            if c then g else f
        ()
    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)
`).map(({ message }) => message)).toEqual([
      "`f`'s colour is tied to `g`'s here, and no written type can say that — write `f`'s type",
    ]);
  });

  it("reads siblings as the fix's face: each its own colour, and the function runs their join", () => {
    // With the fix applied `pick` is `(Bool, () ->! Unit, () ->! Unit) >-> Unit`:
    // a call handing it an impure function wears `!`, and a forwarder meets no
    // second tie.
    const source = `let pick(c: Bool, f, g): Unit =
    let h = if c then f else g
    h!()
let use(): Unit = pick!(True, () => save!("x"), () => ())
let fwd(a, b) = pick!(True, a, b)
`;
    expect(tieReports(`extern from "./world.js"\n    export fun save(document: String) ->! Unit\n` + source)
      .map(({ message }) => message)).toEqual([
        "`f`'s colour is tied to `g`'s here, and no written type can say that — write `f`'s type",
      ]);
  });

  it("writes every tied parameter's type, and the repaired program compiles", () => {
    const repaired = (source: string): { fixes: readonly string[]; after: readonly string[] } => {
      const text = "module Main\n\n" + fixtures + source;
      const diagnostics = compileFiles([["/main.hex", text]]).diagnostics;
      const edits = diagnostics.flatMap(({ fixes }) => (fixes ?? []).flatMap((fix) => fix.edits))
        .sort((left, right) => right.span.start.offset - left.span.start.offset);
      let fixed = text;
      for (const edit of edits) {
        fixed = fixed.slice(0, edit.span.start.offset) + edit.replacement + fixed.slice(edit.span.end.offset);
      }
      return {
        fixes: diagnostics.flatMap(({ fixes }) => (fixes ?? []).map((fix) => fix.message)),
        after: compileFiles([["/main.hex", fixed]]).diagnostics.map(({ message }) => message),
      };
    };
    expect(repaired("let pick(c: Bool, f, g): Unit =\n    let h = if c then f else g\n    h!()\n"))
      .toEqual({ fixes: ["write the types of `f` and `g`"], after: [] });
    expect(repaired("let outer(g, c: Bool): Unit =\n    g!()\n    let inner = (f) => if c then g else f\n    ()\n"))
      .toEqual({ fixes: ["write the types of `f` and `g`"], after: [] });
    expect(repaired("export let outer(action: () ->! Unit, c: Bool): Unit =\n    let inner = (f) => if c then action else f\n    ()\n"))
      .toEqual({ fixes: ["write `f`'s type"], after: [] });
  });

  it("names the owner where the two parameters are spelled alike, and its reading keeps the result's", () => {
    // `inner`'s result is the join of `outer`'s `f` and its own: reading `f`
    // as its fix changes the parameter, never the function `inner` returns.
    const source = `export let outer(f: () ->! Unit, c: Bool): Unit =
    let g = f
    let inner(f) = if c then g else f
    inner(() => ())!()
`;
    expect(tieReports(source).map(({ message }) => message)).toEqual([
      "`f`'s colour is tied to `outer`'s `f` here, and no written type can say that — write `f`'s type",
    ]);
    expect(tieReports(source.replace("inner(f)", "inner(f: () ->! Unit)"))).toEqual([]);
  });
});

describe("Effects §4.4 — a refused `>->` reads as its fixit", () => {
  it("one report at a module-level record type", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `let h: { step: () >-> String } = { step = () => "x" }
export let z: Int = 1
`]]).length,
    ).toBe(1);
  });

  it("a call through the refused arrow owes the mark its fixit implies", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f(x: Int): Int =
    let h: () >-> String = () => "s"
    let y = h!()
    x
`]]).length,
    ).toBe(1);
  });

  it("and every further report is one the fixed program draws: a `->` face over it is refused", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f: ((Int) -> Int) = (x: Int): Int =>
    let h: () >-> String = () => "s"
    let y = h!()
    x
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
      "this annotation has no callbacks of its own, and a local `>->` does not borrow the " +
      "enclosing function's — leave its type to inference, or write `->!`",
      "this call may touch the world, and the enclosing function's face is the pure arrow `->` " +
      "— a pure face cannot run effects",
    ]);
  });

  it("an alias's refused arrow reads as `->!` wherever the alias stands", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `type Maker = () >-> String

export let f(g: (() ->! String) -> String): String =
    let mkBad = (): Maker => (): String => "x"
    g(mkBad())
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
      "an alias is a type fragment, not a signature; " +
      "write `->!` for a function that may touch the world, or `->` for one that does not",
    ]);
  });
});

describe("#355 ruling 9 — `->!`, the const ⊔ var face", () => {
  const shape = (arrow: string) => `${world}
export let withTransaction: ((String ->! String) ${arrow} String) = (run: String ->! String): String =>
    save!("begin")
    let result = run!("body")
    audit!("commit")
    result
`;

  it("checks with the banged arrow", () => {
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + shape("->!")]])).toEqual([]);
  });

  it("refuses the `>->` face, naming `->!`", () => {
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + shape(">->")]])).toEqual([
      "this call touches the world on its own account, and this face's `>->` promises the " +
      "function is only as effectful as what it is handed — write `->!`",
    ]);
    // §4.2: the fixit rewrites the written `>->` alone: `(String ->! String)
    // ->! String` is the face, and the callback keeps its own colour.
    expect(effectFixes([["/world.js", ""], ["/main.hex", "module Main\n\n" + shape(">->")]])).toEqual([
      'write `->!`: "->!"',
    ]);
    // The one edit lands on the outer arrow, and the repaired source compiles.
    const source = shape(">->");
    const [report] = effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + source]]);
    // `((String ->! String) >-> String)`: the arrow after the callback's closing
    // paren is the outer one, and it is the only span the fixit touches.
    expect(report?.edits).toEqual(["module Main\n\n".length + source.indexOf(") >-> String) =") + 2]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + shape("->!")]]),
    ).toEqual([]);
  });

  it("accepts a `->!` face over a body that performs no unconditional effect (#1119)", () => {
    // A face may claim more effect than its body performs, never less: `->!`
    // is an allowance, and every call through `apply` wears `!`.
    const source = `${world}
export let apply: ((String ->! String) ->! String) = (run: String ->! String): String => run!("body")
export let go(): String = apply!((s) => s)
`;
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + source]])).toEqual([]);
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" +
      source.replace("apply!((s) => s)", "apply((s) => s)")]]))
      .toEqual(["this call may touch the world, so `apply` wants `!`, not no mark"]);
  });

  it("demands `!` at every call site, pure callback or not", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${shape("->!")}
export let go(): String = withTransaction((document) => document)
`]]),
    ).toEqual([
      "this call may touch the world, so `withTransaction` wants `!`, not no mark",
    ]);
  });

  it("keeps a pure callback pure through the banged face", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${shape("->!")}
export let go(): String = withTransaction!((document) => document)
`]]),
    ).toEqual([]);
  });
});

describe("#355 eager combinators — the shape Map/Set will imitate", () => {
  const eager = `${world}
export let map(values: Vector(a), transform: a ->! b): Vector(b) =
    var out: Vector(b) = []
    var index = 1
    while index <= Vector.length(values)
        out := Vector.append(out, transform!(Vector.at(values, index)))
        index := index + 1
    out

export let fold(values: Vector(a), initial: b, combine: (b, a) ->! b): b =
    var total = initial
    var index = 1
    while index <= Vector.length(values)
        total := combine!(total, Vector.at(values, index))
        index := index + 1
    total
`;

  it("takes a pure callback bare and an impure one banged", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${eager}
export let stamped(values: Vector(String)): Vector(String) =
    map(values, (text) => text ++ ".")

export let saveAll(values: Vector(String)): Vector(String) =
    map!(values, (document) =>
        save!(document)
        document)
`]]),
    ).toEqual([]);
  });

  it("refuses the bare call at an impure instantiation", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${eager}
export let saveAll(values: Vector(String)): Vector(String) =
    map(values, (document) =>
        save!(document)
        document)
`]]),
    ).toEqual([
      "this call may touch the world, so `map` wants `!`, not no mark",
    ]);
  });

  it("refuses `!` at a pure instantiation — symmetric enforcement", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${eager}
export let stamped(values: Vector(String)): Vector(String) =
    map!(values, (text) => text ++ ".")
`]]),
    ).toEqual([
      "this call is pure, so `map` wants no mark, not `!`",
    ]);
  });
});

describe("#355 grammar — where a mark may stand", () => {
  it("reads a retired `?` in the mark seat as the seat, so the mark's fixit rewrites it", () => {
    // `?` is no token (§3.1): the lexer reports it, and the mark report's fixit
    // replaces it rather than writing `!` beside it.
    const text = "module Main\n\n" + world + 'export let run(): Unit = save?("x")\n';
    const diagnostics = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics;
    expect(diagnostics.map(({ message }) => message)).toEqual([
      'invalid character "?" (U+003F)',
      "this call may touch the world, so `save` wants `!`, not no mark",
    ]);
    const edits = diagnostics.flatMap(({ fixes }) => (fixes ?? []).flatMap((fix) => fix.edits));
    expect(edits.map(({ span, replacement }) => [text.slice(span.start.offset, span.end.offset), replacement]))
      .toEqual([["?", "!"]]);
  });

  it("carries a bare pipe stage's mark onto the call the rewrite makes", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let run(document: String): Unit = document |> save!
`]]),
    ).toEqual([]);
  });

  it("keeps the bare pipe legal for pure stages", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let clean(document: String): String = document |> trim
`]]),
    ).toEqual([]);
  });

  it("refuses a bare pipe stage whose call is impure", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let run(document: String): Unit = document |> save
`]]),
    ).toEqual([
      "this call may touch the world, so `save` wants `!`, not no mark",
    ]);
  });

  it("marks a call through a non-identifier callee", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let pull(source: { step: (() ->! String) }): String = (source.step)!()
`]]),
    ).toEqual([]);
  });

  it("marks a dot call before its own argument list", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let stamp(document: String): String = document.show()
`]]),
    ).toEqual([]);
  });

  it("refuses a mark on a reference — references are colourless", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let held: (String ->! Unit) = save!
`]]),
    ).toEqual([markSeat]);
  });

  it("stores an impure function without a mark", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let held: (String ->! Unit) = save
export let run(document: String): Unit = held!(document)
`]]),
    ).toEqual([]);
  });

  it("keeps the `not` redirect for a prefix `!`", () => {
    // §9's prefix row, and Lexer §8.2's division of labour: `!` lexes as a mark
    // now, so the redirect is position-selected by the parser. The prototype
    // reported the mark-position row here, which tells a reader writing `not`
    // to go and find an argument list.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "export let f(flag: Bool): Bool = !flag\n"]]),
    ).toEqual(["Hexagon spells logical negation `not`"]);
    // Parenthesizing the operand does not make it a call: nothing precedes the
    // mark, so there is no argument list for it to govern either way.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "export let f(flag: Bool): Bool = !(flag)\n"]]),
    ).toEqual(["Hexagon spells logical negation `not`"]);
  });

  it("redirects a `=>` written in type position, collapsing the cascade (#410)", () => {
    // §9's type-arrow row. Both specimens are #410's own measurements. Before
    // the redirect the first produced a parse cascade — "expected `)` after
    // parameters", then "expected `=` in `let` binding" — and the second the
    // layout pass's "expected a newline or `;` between block items"; neither
    // mentioned an arrow. The teaching report replaces the lot, one per typo.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "let f(g: (Int) => Int): Int = g(1)\n"]]),
    ).toEqual([typeArrowRedirect]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "type H = (Int) =>! Int\n"]]),
    ).toEqual([typeArrowRedirect]);
  });

  it("recovers the redirected arrow as the one it advises, so checking continues", () => {
    // Resolve-and-retain, the family's recovery: the annotation is the type the
    // fixit would have written, so the rest of the module is checked against it
    // rather than abandoned. `=>!` recovers as `->!`, which is visible here as
    // the impure call's own mark row firing behind the redirect.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "let f(g: (Int) =>! Int): Int = g(1)\n"]]),
    ).toEqual([typeArrowRedirect, "this call may touch the world, so `g` wants `!`, not no mark"]);
    // And taking the advice is the whole repair — nothing else was wrong.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "let f(g: (Int) -> Int): Int = g(1)\n"]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "let f(g: (Int) ->! Int): Int = g!(1)\n"]]),
    ).toEqual([]);
  });

  it("leaves the curried lambda alone: there the `=>` is the body's (#410)", () => {
    // §2.6's own pair, end to end. This is the redirect's one carve-out — the
    // slot where a fat arrow after a complete annotation is legal — so it is
    // pinned as *silence*, not as a different message.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "export let k = (x: Int): (Int) -> Int => (y: Int) => x\n"]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "export let f = (x: Int): Int -> Int -> Int => (y: Int) => (z: Int) => x\n"]]),
    ).toEqual([]);
  });

  it("requires the mark glued to the argument list it governs", () => {
    // Lexer §8.1 spells the seat "glued immediately before `(`". The prototype
    // accepted every spacing, which makes a mark look like an operator.
    const spellings = ["readLine ! ()", "readLine! ()", "readLine !()"];
    for (const spelling of spellings) {
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let ask(): String = ${spelling}
`]]),
      ).toEqual([markSeat]);
    }
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let ask(): String = readLine!()
`]]),
    ).toEqual([]);
  });

  it("requires a pipe stage's mark glued to the stage", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let run(document: String): Unit = document |> save !
`]]),
    ).toEqual([markSeat]);
  });

  it("does not admit `!=>`, which `!=` would win", () => {
    // `!=` takes the maximal munch, so the type ends at `Int` and the `!` is
    // never an arrow. Pinned on the exact reports, because "it errors" is true
    // of the admitted spelling too.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + "export let f: (Int !=> Int) = (x) => x\n"]]),
    ).toEqual(["expected `)` after type", "expected `=` in `let` binding"]);
  });
});

describe("#869 the `->` arrow — FFI Part 4 §4.5, §13", () => {
  it("honours the pure arrow on an extern `fun`", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let clean(document: String): String = trim(document)
`]]),
    ).toEqual([]);
  });

  it("keeps `pure` and `conduit` ordinary names everywhere, extern rows included", () => {
    // The words left Lexer §4.2's contextual table with the forms they
    // introduced (#869), so they bind like any other name — a row may be
    // *called* one — and, before a row's keyword, draw what any stray name
    // there draws (#1185).
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export let pure(value: Int): Int = value
export let doubled: Int = pure(21) + pure(21)
`]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun pure(value: Int) -> Int
    export let conduit: Int
`]]),
    ).toEqual([]);
    const head = (word: string) =>
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export ${word} fun trim(document: String) -> String
`]]);
    expect(head("pure")).toEqual(head("frob").map((report) => report.replaceAll("frob", "pure")));
    expect(head("conduit")).toEqual(head("frob").map((report) => report.replaceAll("frob", "conduit")));
    expect(head("frob")).toHaveLength(1);
  });

  it("redirects the retired `:` separator, with `->!` as its fixit", () => {
    const source = `extern from "./world.js"
    export fun trim(document: String): String
`;
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + source]]),
    ).toEqual([RETIRED_COLON]);
    expect(effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + source]])).toEqual([
      {
        primary: "module Main\n\n".length + source.indexOf("): String") + 1,
        edits: ["module Main\n\n".length + source.indexOf("): String") + 1],
      },
    ]);
  });

  it("asks a row that stops at its parameter list for both halves", () => {
    // §13's missing-annotation row: an extern declaration has nothing to infer
    // from, so the arrow and the result are owed together — and one omission
    // costs one report, never a second complaint about the type it also lacks.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun trim(document: String)
`]]),
    ).toEqual([
      "extern functions require an effect arrow and a result type; write `->! T` when in doubt",
    ]);
  });

  it("reads the arrow on a `let`-with-parameters row's redirect, and reports it once", () => {
    // §13's first row fires first, and its rewrite already spells the arrow, so
    // the colon row is not also reported.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let parse(text: String): Int
`]]),
    ).toEqual([
      "extern callable declarations use `fun` and write their effect arrow; " +
      "write `fun parse(text: String) ->! Int`",
    ]);
  });

  it("recovers every failed arrow seat as `->!`, never as a silent purity claim", () => {
    // §4.5: "never a silent claim in either direction". A row that did not
    // validly write its arrow has claimed nothing, and the recovery has to
    // claim nothing back — observed where it is observable, at a call, since a
    // recovered `->` would make the unmarked call below legal.
    const wants = (name: string) => `this call may touch the world, so \`${name}\` wants \`!\`, not no mark`;
    // The retired `:`.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun trim(document: String): String

export let t: String = trim("x")
`]]),
    ).toEqual([RETIRED_COLON, wants("trim")]);
    // No arrow and no result at all.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun trim(document: String)

export let t: String = trim("x")
`]]),
    ).toEqual([
      "extern functions require an effect arrow and a result type; write `->! T` when in doubt",
      wants("trim"),
    ]);
    // The lambda arrow at the arrow seat: Effects §9's redirect, and the same
    // recovery — a refused arrow hands out no purity, whatever it spelled.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun trim(document: String) => String

export let t: String = trim("x")
`]]),
    ).toEqual([
      "Hexagon's type arrows are `->`, `->!`, `>->`; `=>` is the lambda arrow — " +
      "for a function type write `Int -> Int` (or `->!` / `>->` for its colour)",
      wants("trim"),
    ]);
  });

  it("falls back to a placeholder where there is no spelling to quote", () => {
    // A rewrite quotes the row the author wrote, and quotes nothing where what
    // they wrote is not a row: a result that failed to parse leaves a
    // placeholder carrying the *name*'s span, and an unclosed parameter list
    // has no list to reproduce.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let parse(text: String) ->
`]]),
    ).toEqual([
      // The author wrote the arrow; it stands, and only the result is missing.
      "extern callable declarations use `fun` and write their effect arrow; " +
      "write `fun parse(text: String) -> T`",
      "expected a type annotation",
    ]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let parse(text: String: String
`]]),
    ).toEqual([
      "extern callable declarations use `fun` and write their effect arrow; " +
      "write `fun parse(…) ->! String`",
      "expected `)` after parameters",
    ]);
  });

  it("names the row's own type in the paramless and function-type rewrites", () => {
    // §13's two `let`-shaped rows. Each quotes what the author wrote: the
    // annotation on the row, and the type that is callable — whose own arrow
    // the rewrite keeps, since it is a colour the author already chose.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun version: String
`]]),
    ).toEqual([
      "extern `fun` declares a callable and requires a parameter list; for a " +
      "foreign value, write `let version: String`",
    ]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let f: Int -> Int
    export let g: (String, Int) ->! Bool
`]]),
    ).toEqual([
      "extern callable declarations use `fun`; a binding of type `Int -> Int` is " +
      "callable — write `fun f(x: Int) -> Int`",
      "extern callable declarations use `fun`; a binding of type `(String, Int) ->! Bool` " +
      "is callable — write `fun g(x: String, y: Int) ->! Bool`",
    ]);
  });

  it("keeps a `let`-with-parameters row's own arrow in the rewrite it quotes", () => {
    // A written arrow stands, so this row's rewrite spells the `fun` and keeps
    // the arrow its author already wrote; a row that wrote `:` takes §13's own
    // `->!`.
    const row = (text: string) =>
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export ${text}
`]]);
    expect(row("let f(x: Int) ->! Int")).toEqual([
      "extern callable declarations use `fun` and write their effect arrow; " +
      "write `fun f(x: Int) ->! Int`",
    ]);
    expect(row("let f(x: Int) -> Int")).toEqual([
      "extern callable declarations use `fun` and write their effect arrow; " +
      "write `fun f(x: Int) -> Int`",
    ]);
    expect(row("let f(x: Int): Int")).toEqual([
      "extern callable declarations use `fun` and write their effect arrow; " +
      "write `fun f(x: Int) ->! Int`",
    ]);
  });

  it("leaves the callable-intended `let` row as the whole report", () => {
    // Effects §9: an `extern let` whose annotation is a function type takes FFI
    // Part 4 §13's callable-intended row, not §4.4's no-signature refusal —
    // that row's rewrite, the `fun` the binding should have been, is the repair,
    // and a second report about an arrow inside a type that is not going to stay
    // would be a complaint about the wrong row.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let f: () >-> Int
`]]),
    ).toEqual([
      "extern callable declarations use `fun`; a binding of type `() >-> Int` is " +
      "callable — write `fun f() >-> Int`",
    ]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let g: (() ->! Int) -> Int
`]]),
    ).toEqual([
      "extern callable declarations use `fun`; a binding of type `(() ->! Int) -> Int` " +
      "is callable — write `fun g(x: (() ->! Int)) -> Int`",
    ]);
    // A non-function annotation is a value reference still, and keeps §4.4's
    // no-signature clause.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let h: { step: () >-> Int }
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — this annotation is not a function signature; write `->!` for a " +
      "function that may touch the world, or `->` for one that does not",
    ]);
  });

  it("closes the boundary's advice with the row that opened it", () => {
    // `#atExternRow` is restored when the row's elaboration ends, so §4.5's
    // extra sentence reaches boundary rows and nothing after them: the record
    // field below takes Effects §4.4's own clause, undecorated.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun trim(document: String) -> String

export record R = { k: () >-> Unit }
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — a `record` field is data, not a signature; write `->!` for a " +
      "function that may touch the world, or `->` for one that does not",
    ]);
  });

  it("compiles §4.5's five specimen rows, `defer`'s `>->` result included", () => {
    // The section's own worked example, whole. `defer` is the one that pins the
    // publication seat: its `>->` stands in the *result*, so a materialization
    // that re-elaborated the annotation outside the row's signature scope would
    // refuse an arrow §4.5 writes itself.
    expect(
      effectDiagnostics([["/operations.js", ""], ["/main.hex", "module Main\n\n" + SPECIMENS]]),
    ).toEqual([]);
    // The result's colour is the row's own variable, not §4.4's recovered
    // constant; the display drops the redundant bracket the source writes.
    expect(hoveredType(SPECIMENS, "defer")).toBe("(() ->! Unit) -> () >-> Unit");
  });

  it("carries `defer`'s result colour to a caller, pure and impure alike", () => {
    // The face survives the boundary as a face, not as a recovered constant: a
    // pure callback yields a pure thunk called bare, an impure one a thunk that
    // wants `!`, and the row's own call is bare either way — it is `->`.
    expect(
      effectDiagnostics([["/operations.js", ""], ["/main.hex", "module Main\n\n" + `${SPECIMENS}
export let now: Unit = defer(() => ())()
export let later: Unit = defer(() => read!("p") |> ignore)!()
`]]),
    ).toEqual([]);
  });

  it("leaves `let` and `type` rows exactly as they were", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export let seed: Int
    export type Handle
`]]),
    ).toEqual([]);
  });
});

describe("#869 the `>->` outer arrow — FFI Part 4 §4.5", () => {
  /**
   * The ruling's own specimen. A `>->` outer arrow seats one colour variable at
   * that arrow *and* at every `>->` the signature writes, so the row is exactly
   * as effectful as its callbacks, jointly.
   */
  const runner = `extern from "./world.js"
    export fun runner(step: () ->! String) >-> Int
    export fun readLine() ->! String
`;

  /** Two linked slots on one row — still one variable (Effects §2.2). */
  const both = `extern from "./world.js"
    export fun both(first: () ->! String, second: () ->! String) >-> Int
    export fun readLine() ->! String
`;

  /**
   * §13's row for an inlet-less `>->` on a callable row: Effects §4.4's
   * signature clause — the outer arrow is part of the row's signature, and a
   * signature whose parameters carry no `>->` has nothing to instantiate it —
   * with §4.5's advice in words appended, which is the boundary's addition.
   */
  const unlinkedConduit = UNLINKED_EXTERN_ROW;

  it("admits the row, and produces the ordinary linked face", () => {
    // No new face vocabulary: what the keyword yields is a face the written
    // grammar can already spell, displayed with the plain `>->` because it
    // carries exactly one variable (§10's single-variable rule).
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + runner]])).toEqual([]);
    expect(hoveredType(runner, "runner")).toBe("(() ->! String) >-> Int");
  });

  it("takes a bare call with a pure callback", () => {
    // The whole point of the claim, and the thing the impure default could not
    // express: a pure callback costs its caller no mark at all.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${runner}
export let n: Int = runner(() => "x")
`]]),
    ).toEqual([]);
  });

  it("demands `!` with an impure callback, and refuses the bare call", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${runner}
export let n: Int = runner!(() => readLine!())
`]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${runner}
export let n: Int = runner(() => readLine!())
`]]),
    ).toEqual([
      "this call may touch the world, so `runner` wants `!`, not no mark",
    ]);
  });

  it("conducts inside an inlet-bearing body, its call wearing `!`", () => {
    // §3.3's third arm, reached with no FFI-specific rule: the enclosing
    // signature's variable is what the row's outer arrow instantiates to.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${runner}
export let use(k: () ->! String): Int = runner!(k)
`]]),
    ).toEqual([]);
  });

  it("joins every `>->` slot into one colour, exactly as a written signature does", () => {
    // One variable per signature (§2.2) is not relaxed at the boundary: the two
    // slots are one colour, so both callbacks are pure or both are impure, and
    // the outer arrow follows them. The in-language twin below is the control —
    // the keyword must add no behaviour of its own.
    const twin = `extern from "./world.js"
    export fun readLine() ->! String

export let both(first: () ->! String, second: () ->! String): Int =
    let a: String = first!()
    let b: String = second!()
    1
`;
    for (const source of [both, twin]) {
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${source}
export let pureUse: Int = both(() => "a", () => "b")
`]]),
      ).toEqual([]);
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${source}
export let impureUse: Int = both!(() => readLine!(), () => readLine!())
`]]),
      ).toEqual([]);
      // Mixing the colours in one call is a join (#1119): the pure lambda fits
      // the shared variable and adds nothing to it, so the impure one decides
      // and the call wears `!`, in either argument order. Pinned on both
      // spellings because "the extern behaves like the written signature" is
      // the claim, and a difference here would be one.
      for (const call of ['both!(() => "a", () => readLine!())', 'both!(() => readLine!(), () => "a")']) {
        expect(
          effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${source}
export let mixed: Int = ${call}
`]]),
        ).toEqual([]);
      }
    }
  });

  it("quantifies the colour, so two call sites instantiate it apart", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${runner}
export let pureUse: Int = runner(() => "x")
export let impureUse: Int = runner!(() => readLine!())
`]]),
    ).toEqual([]);
  });

  it("refuses the claim on a row with no `>->` slot to link to", () => {
    // §4.1's and §4.4's own sentence, at the claim: one spelling, one meaning,
    // and where the meaning is unavailable, a diagnostic rather than a silent
    // re-read as the impure default.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun runner(step: () -> String) >-> Int
`]]),
    ).toEqual([unlinkedConduit]);
    // A row with no function-typed parameter at all takes the same report.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun trim(document: String) >-> String
`]]),
    ).toEqual([unlinkedConduit]);
  });

  it("stands that report on the arrow itself, with `->!` as its fixit", () => {
    const source = `extern from "./world.js"
    export fun trim(document: String) >-> String
`;
    expect(effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + source]])).toEqual([
      {
        primary: "module Main\n\n".length + source.indexOf(">->"),
        edits: ["module Main\n\n".length + source.indexOf(">->")],
      },
    ]);
  });

  it("keeps `conduit` an ordinary name everywhere else", () => {
    // An ordinary name (Lexer §4.3), exactly as `pure` is.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export record Pipe = { conduit: Int }
export let conduit(value: Int): Int = value
export let total: Int = conduit(21) + Pipe({ conduit = 21 }).conduit
`]]),
    ).toEqual([]);
    // And a row may be called it.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `extern from "./world.js"
    export fun conduit(value: Int) ->! Int
`]]),
    ).toEqual([]);
  });

  it("carries the linked face into the emitted `.d.ts`", () => {
    expect(declarationsOf([["/world.js", ""], ["/main.hex", "module Main\n\n" + runner]])).toContain(
      "/** Hexagon: `(() ->! String) >-> Int` */\nexport declare function runner(",
    );
  });
});

describe("#355 marks where the text does not decide a dot call's subject (Method Syntax §3.5)", () => {
  // A dot call whose subject the text does not decide is refused at the dot,
  // whatever its mark: no operation is chosen, so no colour exists to mark.
  const undecided = (mark: string) => `${world}
let run(source): Seq(String) =
    source.forEach${mark}((value) => save!(value))
    let pinned: Seq(String) = source
    pinned

export let x: Int = 1
`;
  const refusal = "the program's text does not decide `source`'s type here, so `.forEach(…)` cannot " +
    "tell whose `forEach` it is — write `source`'s type, or call the operation by its module " +
    "(`Module.forEach(source, …)`); a record's field is called as `(source.forEach)(…)`";

  it("is the one report, marked or bare", () => {
    expect(withSeq(undecided("!"))).toEqual([refusal]);
    expect(withSeq(undecided(""))).toEqual([refusal]);
  });

  it("makes a field call on a row the pure one, and enforces it", () => {
    // The parenthesized field call is the record spelling (§3.6): it imposes
    // `{next: () -> a, ...}` — a `->`, and a row is data (Effects §2.5). So the
    // call is pure and a mark on it is refused.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
let drive(source): String = (source.next)!()

export let x: Int = 1
`]]),
    ).toEqual(["this call is pure, so this call wants no mark, not `!`"]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
let drive(source): String = (source.next)()

export let x: Int = 1
`]]),
    ).toEqual([]);
  });

  it("refuses an impure field at the row a field call imposed", () => {
    // The other half of the same arrow: the row demands purity, so supplying an
    // impure step is §4.3's refusal rather than a silent widening.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
let drive(source): Unit = (source.step)()

export let go(): Unit = drive({ step = () => save!("x") })
`]]),
    ).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — the " +
      "demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });
});

describe("#355 declaration-site variance counts the effect slot (Effects §3.4, #364)", () => {
  // `#variablePositions` walked a function type's parameters and result and
  // skipped its colour, so every effect variable read as absent — and an absent
  // variable is invariant by default, which item 7's covariant-only clause
  // declines. A computed binding's own colour was therefore pinned monomorphic.
  const inletFace = `
let pick(value: a): a = value
let store(callback: () ->! String): Int = 1
let stored = pick(store)
`;

  it("finds no own colour left to generalize: `store`'s is pure before `pick` sees it", () => {
    // Before #868 `store`'s outer colour stayed a variable, occurring only at
    // the root, and item 7 generalized it at `stored` — two faces, two
    // instantiations. §3.4 now defaults it pure before `store` generalizes, so
    // there is no variable to generalize, and both faces are accepted: the pure
    // one as written, the `->!` one because a pure function fits wherever a
    // function is expected (§2.6, #1119) — `stored`'s outer arrow is decided,
    // and a use opens it.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `${inletFace}
export let asPure: ((() -> String) -> Int) = stored
`]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `${inletFace}
export let asImpure: ((() -> String) ->! Int) = stored
`]]),
    ).toEqual([]);
  });

  it("still refuses to weaken the callback's colour, which is not covariant-only", () => {
    // The inlet's variable occurs in argument position, so item 7 declines it
    // exactly as it declines every other contravariant variable — the inclusion
    // is an occurrence count, not an exemption. The first face pins the callback
    // pure; the second demands the constant of the same, now monomorphic, slot.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `${inletFace}
export let asPure: ((() -> String) -> Int) = stored
export let asImpure: ((() ->! String) -> Int) = stored
`]]),
    ).toEqual([
      // The first face pinned `stored`'s callback slot pure, so `stored` now
      // accepts only a pure callback, and the second face's callback, written
      // `->!` to accept any function, is bound to it: the lie of generality,
      // standing at the value that brought the constant (§4.2).
      "this callback is written `->!`, which accepts any function, and this accepts only a " +
      "pure one — write its arrow `->`",
    ]);
  });
});

describe("#405 the return-annotation slot needs no parentheses", () => {
  /**
   * The predecessor of this block pinned #355's ruling 8: an unparenthesized
   * `=>` in a lambda's return annotation went to the body, so a function type
   * there had to be parenthesized, and a writer who plainly meant a type got a
   * dedicated report whose region superseded the misparse's consequences.
   *
   * All of it is withdrawn. Both of that rule's causes were the type and term
   * levels sharing the `=>` token; the type arrows are now `->`, `>->`, `->!`
   * and the lambda's is `=>`, so a greedy annotation parse cannot reach the
   * body and there is nothing left to disambiguate.
   */

  it("takes an unparenthesized function type as the return type", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export let curried(seed: Int): Int =
    let make = (x: Int): Int -> Int => (y: Int) => x
    make(seed)(seed)
`]]),
    ).toEqual([]);
  });

  it("takes an unparenthesized impure function type too", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let maker = (seed: String): String ->! Unit => save
export let run(document: String): Unit = maker("s")!(document)
`]]),
    ).toEqual([]);
  });

  it("still reads the parenthesized form the same way", () => {
    // Parentheses did not stop meaning grouping; they merely stopped being
    // mandatory.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let maker = (seed: String): (String ->! Unit) => save
export let run(document: String): Unit = maker("s")!(document)
`]]),
    ).toEqual([]);
  });

  it("keeps the curried lambda meaning what it always meant", () => {
    // The one shape ruling 8 existed to protect. `Int` is the annotation and
    // `(y: Int) => x` is the body, so this claims a result it does not produce
    // — exactly as it did before #405, because `=>` is still the lambda's arrow
    // and still starts the body. What changed is that nothing had to be ruled
    // to make it so.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export let curried(seed: Int): Int =
    let make = (x: Int): Int => (y: Int) => x
    make(seed)(seed)
`]]),
    ).toEqual(["type mismatch: expected Int, found (Int) -> Int"]);
  });

  it("leaves a sibling binding's own error to itself", () => {
    // The predecessor needed a `supersedes` region here, because the misparse
    // provoked type errors that described a tree the writer did not write. With
    // no misparse there is nothing to supersede, and the sibling reports alone.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let f = (x: Int): Int -> Int => x
export let g: Int = "text"
`]]),
    ).toEqual([
      "type mismatch: expected (Int) -> Int, found Int",
      "type mismatch: expected Int, found String",
    ]);
  });
});

/**
 * §10's first obligation, as ruled in #364 and narrowed by #405: display
 * **distinguishes** rather than normalizes. A face renders its arrows by
 * colour, and the undecorated `>->` covers every face with exactly one effect
 * variable — which is what a written signature spells, since the grammar links
 * every `>->` into one colour. Only a face with *more than one* is numbered,
 * by first appearance, because only that is inexpressible.
 *
 * The predecessor also numbered a lone variable with no inlet occurrence: the
 * else-constant rule read an inlet-less written arrow back as the impure
 * constant, so the plain spelling would have meant something else. That rule is
 * withdrawn, and with it the case — a plain `>->` is exactly right about the
 * colour, and pasting it somewhere that cannot host it is §4.4's error, which
 * explains itself where a lexer failure would not.
 */
describe("#364 the arrow trio, displayed", () => {
  const composeSource = `${world}
export let save2(document: String): String =
    save!(document)
    document

export let compose(first: String ->! String, second: String ->! String): (String >-> String) =
    (document) => second!(first!(document))

export let withTransaction: ((String ->! String) ->! String) = (run: String ->! String): String =>
    save!("begin")
    run!("body")

export let clean(document: String): String = trim(document)
`;

  /** Two colours no written signature spells — module-private, as it must be. */
  const stagedSource = `let staged(first: String ->! String) =
    (second: String ->! String): String => second!("x")
`;

  it("leaves `compose` with one colour, undecorated (#868)", () => {
    // The headline probe before #868: `compose`'s own colour was a second,
    // unconstrained variable and the face was numbered. Its body is neither a
    // source nor a conduit, so that colour now defaults pure (§3.4's third arm),
    // and the one variable left displays plainly.
    expect(hoveredType(composeSource, "compose")).toBe(
      "(String ->! String, String ->! String) -> String >-> String",
    );
  });

  it("shows a face with two callbacks' colours unnumbered (§10)", () => {
    // `staged` takes a callback it never calls and returns a lambda that runs a
    // second. A finished face depends on all of its callbacks or none (§2.4),
    // so nothing is numbered, and each callback's own arrow shows `->!`.
    expect(hoveredType(stagedSource, "staged")).toBe(
      "(String ->! String) -> (String ->! String) >-> String",
    );
  });

  it("leaves a single-variable face undecorated, so it writes back unchanged", () => {
    // One variable, one spelling: the annotation grammar links every written
    // `=>` into one variable (§2.2), so this face round-trips exactly.
    expect(hoveredType(composeSource, "withTransaction")).toBe(
      "(String ->! String) ->! String",
    );
  });

  it("displays a linked conduit's whole signature with the plain arrow", () => {
    // `fold`'s shape is the designated specimen: the body conducts, so its own
    // colour *unifies with* the callback's (§3.4) rather than standing apart,
    // and one variable covers the whole face — which is why nothing is
    // numbered and the face is exactly what a writer would write.
    const source = `export let fold(values: Vector(a), initial: b, combine: (b, a) ->! b): b =
    var total = initial
    var index = 1
    while index <= Vector.length(values)
        total := combine!(total, Vector.at(values, index))
        index := index + 1
    total
`;
    expect(hoveredType(source, "fold")).toBe(
      "(Vector(a), b, (b, a) ->! b) >-> b",
    );
  });

  it("carries the constraint bracket and the colour in one face (#410)", () => {
    // The two display marks meet: #410's source-shaped bracket in front,
    // #364's colour on the arrows behind, and one space between them. Neither
    // rule knows about the other, so nothing but a pin says they compose.
    //
    // The callback is annotated deliberately. An unannotated `g!(1)` is
    // refused by the pure demand, which is effects doctrine (§4) and no
    // business of the display's. `show(...)` is simply the plainer seat for the
    // `Show` constraint: an interpolation would serve as well, and compiles
    // with the same face.
    const source = `let k(x: _ : Show, g: (a) ->! a) = show(g!(x))
export let out: String = k("a", (s) => s)
`;
    expect(hoveredType(source, "k(")).toBe("<a: Show> (a, a ->! a) >-> String");
  });

  it("leaves a lone colour plain even where it offers no inlet (#405)", () => {
    // The predecessor numbered this: with the else-constant rule in force, a
    // sole `=>` and no parameter-position occurrence read back as the impure
    // constant, so `(() -> String) => Int` would come back a different type.
    // With the rule withdrawn there is one colour and one spelling for it, and
    // a paste into a position with no inlet is §4.4's error rather than a
    // silent change of meaning.
    const source = `export let make(): String = "x"
export let hold(f: (() -> String) ->! Int): Int = f!(make)
`;
    expect(hoveredType(source, "f:")).toBe("(() -> String) >-> Int");
    expect(hoveredType(source, "hold")).toBe(
      "((() -> String) ->! Int) >-> Int",
    );
  });

  it("leaves a callback parameter plain when hovered on its own", () => {
    // The everyday shape of the same change: `first`'s colour is the enclosing
    // signature's, and as a face in its own right it is still one colour, so it
    // is still spelled `>->`.
    expect(hoveredType(composeSource, "first:")).toBe("String >-> String");
  });

  it("never numbers a constant, at either end of the trio", () => {
    expect(hoveredType(composeSource, "save")).toBe("String ->! Unit");
    expect(hoveredType(composeSource, "trim")).toBe("String -> String");
    expect(hoveredType(composeSource, "clean")).toBe("String -> String");
  });

  it("keeps a colour from taking a type variable's letter", () => {
    // Effect variables generalize with the binding (§3.4), so they arrive in the
    // scheme's quantifier list beside the ordinary ones. Naming them would have
    // spent `a` on a colour that displays as an arrow, and the type variable
    // that follows would print as `b` with no `a` anywhere in the face.
    const source = `${world}
export let hold(step: () ->! Int, value: a): a = value
`;
    expect(hoveredType(source, "hold")).toBe(
      "(() ->! Int, a) -> a",
    );
  });

  it("says the same thing in the emitted `.d.ts`, where TypeScript cannot", () => {
    // TypeScript has one function arrow, so the trio has no seat in the face
    // itself; `spec/doc-comments.md` §7.3 provides the one channel that is left,
    // and the author's own documentation shares the block.
    const emitted = declarationsOf(
      [["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
(** Runs both, in order. *)
export let compose(first: String ->! String, second: String ->! String): (String >-> String) =
    (document) => second!(first!(document))
`]],
    );
    expect(emitted).toContain(
      " * Hexagon: `(String ->! String, String ->! String) -> String >-> String`",
    );
    expect(emitted).toContain(" * Runs both, in order.");
    // The colours erase (§8), so they take no TypeScript quantifier with them:
    // `compose` is polymorphic in nothing and its face says so.
    expect(emitted).toContain("export declare const compose: (first:");
  });

  it("gives an impure extern row its face and a pure one none", () => {
    const emitted = declarationsOf(
      [["/world.js", ""], ["/main.hex", "module Main\n\n" + world]],
    );
    expect(emitted).toContain("/** Hexagon: `String ->! Unit` */\nexport declare function save(");
    // Purity is the silent one (§1): a face with nothing but pure arrows says
    // nothing the TypeScript type has not already said.
    expect(emitted).toContain("\nexport declare function trim(");
    expect(emitted).not.toContain("Hexagon: `String -> String`");
  });

  it("shows the same face in a diagnostic", () => {
    // The checker's renderer is a third printer over a third representation of
    // the type, and it spells the face as hover does.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `${stagedSource}
export let wrong: Int = staged
`]]),
    ).toEqual([
      "type mismatch: expected Int, found " +
      "((String) ->! String) -> ((String) ->! String) >-> String",
    ]);
  });

  it("spells one colour plainly in a diagnostic, inlet or not (#405)", () => {
    const holder = `export let make(): String = "x"
export let hold(f: (() -> String) ->! Int): Int = f!(make)
`;
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `${holder}
export let wrong: Int = hold
`]]),
    ).toEqual([
      "type mismatch: expected Int, found ((() -> String) ->! Int) >-> Int",
    ]);
    // The same colour, displayed as `f`'s own type — no inlet in view, and
    // still the plain spelling, because it is still one colour.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `export let make(): String = "x"
export let hold(f: (() -> String) ->! Int): Int =
    let n: String = f
    f!(make)
`]]),
    ).toEqual([
      "type mismatch: expected String, found (() -> String) >-> Int",
    ]);
  });

  it("refuses to write a variable colour back into source", () => {
    // The displayed `>->` would link this arrow into the signature's own colour,
    // which is a claim about the *other* arrows that this type alone cannot
    // know is true. So the repair says why rather than writing it.
    const source = "module Main\n\n" + "export fun pick(step: String ->! String) = step\n";
    const session = new AnalysisSession();
    session.setFile("/main.hex", source);
    const offset = source.indexOf("pick");
    const actions = session.codeActions("/main.hex", { start: offset, end: offset });
    expect(actions.map(({ title, disabled }) => `${title}: ${disabled ?? "offered"}`)).toEqual([
      "Infer return type: the return type of `pick` cannot be written here: " +
      "this function type's arrow is an effect variable, and writing `>->` here " +
      "would link it to the rest of the signature's colour",
    ]);
  });

  it("spells the impure constant, which means the same wherever it stands", () => {
    const source = "module Main\n\n" + `${world}
export fun maker(seed: String) = save
`;
    const session = new AnalysisSession();
    session.setFile("/world.js", "");
    session.setFile("/main.hex", source);
    const offset = source.indexOf("maker");
    const [action] = session.codeActions("/main.hex", { start: offset, end: offset });
    const edit = action!.edits[0]!;
    // Unparenthesized since #405: the type arrows and the lambda's arrow are
    // different tokens, so the annotation cannot run into the body and the
    // written text is what a writer would have written (§2.6).
    expect(edit.replacement).toBe(": String ->! Unit");
    session.setFile(
      "/main.hex",
      source.slice(0, edit.span.start.offset) + edit.replacement +
        source.slice(edit.span.end.offset),
    );
    expect(session.diagnostics("/main.hex")).toEqual([]);
  });

  it("leaves a wholly pure face saying nothing about colour", () => {
    // Purity is the silent one (§1): a corpus that writes only `->` displays
    // only `->`, with no variable anywhere to number.
    const pure = `export let twice(step: Int -> Int, value: Int): Int = step(step(value))
export let pair(value: a): (a, a) = (value, value)
`;
    expect(hoveredType(pure, "twice")).toBe("(Int -> Int, Int) -> Int");
  });

  it("writes an unquantified row tail into the `.d.ts` face as `...` (#959)", () => {
    // The face doc renders through the same display hover does, so #649's rule
    // reaches the *published* artifact too: a monomorphic binding's open record
    // leaves an unquantified row, and its internal number would otherwise ship
    // in the declaration file a consumer reads. The face exists here at all
    // because the element's arrow is the impure constant — a wholly pure face
    // carries no block (§1).
    const source = "module Main\n\n" +
      "export let handlers: Vector(({n: Int, ...}) ->! Unit) = []\n";
    expect(effectDiagnostics([["/main.hex", source]])).toEqual([]);
    const declarations = declarationsOf([["/main.hex", source]]);
    expect(declarations).toContain("/** Hexagon: `Vector({n: Int, ...} ->! Unit)` */");
    expect(declarations).not.toMatch(/\.\.\.t\d/);
  });
});

describe("#355 the pure demand", () => {
  it("refuses an impure function where `->` is demanded", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let strict(step: String -> Unit, document: String): Unit = step(document)
export let go(document: String): Unit = strict(save, document)
`]]),
    ).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — the " +
      "demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });

  it("accepts a pure function where a `->!` data field is demanded (#1119)", () => {
    // §4.3's reverse direction is no failure: a pure function fits wherever a
    // function is expected, and the field keeps the constant §2.5 gives it.
    // `step` is written `->`, so its colour is decided and its use opens it.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export record Source = { step: () ->! String }
export let hold(step: () -> String): Source = Source({ step = step })
`]]),
    ).toEqual([]);
  });

  it("accepts a pure function at a written `->!` face (#1119)", () => {
    // The other constant position, written: the binding means the constant and
    // spells it (§2.3), and a pure function fits it. `held` wears `->!`, so
    // every call through it is `!`, whatever `pureStep` does.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
export let pureStep(): String = "x"
export let held: (() ->! String) = pureStep
`]]),
    ).toEqual([]);
  });

  it("keeps `Seq`'s producer pure by construction — branch (ii)", () => {
    expect(
      withSeq(`${world}
export let bad: Seq(String) = Seq.unfold("x", (seed) =>
    save!(seed)
    None)
`),
    ).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — the " +
      "demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });
});

/**
 * **#868, implemented by #947** — an unconstrained own colour defaults pure
 * before generalization whatever the inlets, knot colours and obligations
 * settle at the knot's close, and a function's colour is what its body does
 * (Effects §2.6, §3.3, §3.4, §4.1, §4.2, §11).
 */
describe("#947 closure construction stays pure, and knots settle at their close", () => {
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + source]]);
  const hover = (source: string, needle: string): string | undefined =>
    hoveredType("module Main\n\n" + world + source, needle);
  const wantsBang = (callee: string): string =>
    `this call may touch the world, so \`${callee}\` wants \`!\`, not no mark`;
  const wantsBare = (callee: string, mark: string): string =>
    `this call is pure, so \`${callee}\` wants no mark, not \`${mark}\``;

  it("publishes pure a colour a member runs that stands in none of its parameters", () => {
    // `k` runs `h`'s returned function, whose colour is `h`'s callback's —
    // monomorphic inside the knot, so the sibling call inside wears `!` — and
    // finishes with that colour standing in none of its own parameters: `k`
    // is published `Int -> Unit`, and an outside call is bare (§2.4).
    const source = `fun
    h(n: Int, cb: () ->! Unit): () >-> Unit =
        let g = () => k!(n)
        g
    k(n: Int): Unit = if n == 0 then () else h(n - 1, () => ())!()
export let use(): Unit = k(3)
`;
    expect(check(source)).toEqual([]);
    expect(hover(source, "k(n")).toBe("Int -> Unit");
    expect(check(source.replace("let g = () => k!(n)", "let g = () => k(n)"))).toEqual([wantsBang("k")]);
  });

  it("keeps its own colour for a function the result carries in data (#1166)", () => {
    // `k`'s colour is `h`'s callback's, and `k` returns `h` inside a tuple: the
    // colour is published pure on `k`'s own arrow, and `h` keeps it as a colour
    // of its own there, so the caller hands it an effectful callback (§2.4).
    const source = `fun
    h(n: Int, cb: () ->! Unit): () >-> Unit =
        let g = () =>
            cb!()
            let _ = k!(n)
            ()
        g
    k(n: Int) =
        let _ = if n == 0 then () else h(n - 1, () => ())!()
        (h, 1)
export let use(): Unit =
    let (hh, _) = k(1)
    hh(1, () => save!("x"))!()
`;
    expect(check(source)).toEqual([]);
    expect(hover(source, "k(n: Int) =")).toBe("Int -> ((Int, () ->! Unit) -> () >-> Unit, Int)");
    expect(check(source.replace("= k(1)", "= k!(1)"))).toEqual([wantsBare("k", "!")]);
  });

  it("splits a local function's colour the same way outside a knot (#1166)", () => {
    // `run` is one local function, so `make`'s colour is `run`'s callback's.
    // `make` runs it with a pure lambda only, and is pure; the `run` it hands
    // back, in a tuple or an `Option`, still takes any callback.
    const make = (result: string, use: string): string => `let ident(x: a): a = x
let make() =
    let run = ident((f) => f!())
    run!(() => ())
    ${result}
export let use(): Unit =
${use}
`;
    const inTuple = make("(run, 1)", `    let (r, _) = make()
    r!(() => save!("x"))`);
    expect(check(inTuple)).toEqual([]);
    expect(hover(inTuple, "make() =")).toBe("() -> ((() ->! Unit) >-> Unit, Int)");
    const inOption = make("Some(run)", `    match make()
        Some(r) => r!(() => save!("x"))
        None => ()`);
    expect(check(inOption)).toEqual([]);
    expect(hover(inOption, "make() =")).toBe("() -> Option((() ->! Unit) >-> Unit)");
    // Held by no parameter at all, the colour is pure wherever it stands, the
    // returned function's own arrow included.
    const unheld = make(`let go = () => run!(() => ())
    (go, 1)`, `    let (g, _) = make()
    g()`);
    expect(check(unheld)).toEqual([]);
    expect(hover(unheld, "make() =")).toBe("() -> (() -> Unit, Int)");
    const go = (result: string): string => make(`let go = () => run!(() => ())
    ${result}`, "    ()");
    expect(hover(go("Some(go)"), "make() =")).toBe("() -> Option(() -> Unit)");
    expect(hover(go("{ g = go }"), "make() =")).toBe("() -> {g: () -> Unit}");
    expect(hover(go("[go]"), "make() =")).toBe("() -> Vector(() -> Unit)");
    // Each function the result carries keeps the colour only where its own
    // parameters hold it: `go` holds none, so it is pure, and the caller's
    // effectful callback to `r` does not reach it.
    const pair = make(`let go = () => run!(() => ())
    (run, go)`, `    let (r, g) = make()
    r!(() => save!("x"))
    g()`);
    expect(check(pair)).toEqual([]);
    expect(hover(pair, "make() =")).toBe("() -> ((() ->! Unit) >-> Unit, () -> Unit)");
    // In a record, in a vector, and behind a curried arrow alike.
    expect(hover(make("{ go = run }", "    ()"), "make() =")).toBe("() -> {go: (() ->! Unit) >-> Unit}");
    expect(hover(make("[run]", "    ()"), "make() =")).toBe("() -> Vector((() ->! Unit) >-> Unit)");
    expect(hover(make("(n: Int) => (run, n)", "    ()"), "make() =")).toBe("() -> Int -> ((() ->! Unit) >-> Unit, Int)");
  });

  it("reads a declared type's arguments by their variance when it publishes (#1166)", () => {
    // `R`'s fields are out of view at `make`: `apply` takes an `a` the caller
    // chooses and gives back the `b`, so a colour `a` holds is held for `b`
    // too, and `th` runs what the caller handed `apply`.
    const nominal = `let defer(action: () ->! Unit): () >-> Unit = () => action!()
let ident(x: a): a = x
record R(a, b) = { sample: a, apply: (a) -> b }
let make() =
    let run = ident((f) => f!())
    run!(() => ())
    let go = () => run!(() => ())
    R({ sample = defer, apply = (d) => d(go) })
export let probe(): Unit =
    let r = make()
    let th = r.apply((s) => () => save!("x"))
    th!()
`;
    expect(check(nominal)).toEqual([]);
    expect(check(nominal.replace("    th!()", "    th()"))).toEqual([wantsBang("th")]);
    // The same through a union's payload.
    const union = nominal
      .replace("record R(a, b) = { sample: a, apply: (a) -> b }", "union U(a, b) = MkU(a, (a) -> b)")
      .replace("R({ sample = defer, apply = (d) => d(go) })", "MkU(defer, (d) => d(go))")
      .replace("    let r = make()\n    let th = r.apply(", "    let MkU(_, apply) = make()\n    let th = apply(");
    expect(check(union)).toEqual([]);
    expect(check(union.replace("    th!()", "    th()"))).toEqual([wantsBang("th")]);
  });

  it("publishes a colour off the spine pure on a function that does not hold it (#1166, #1169)", () => {
    // `make` never runs `run`, and `go` runs it only with a pure function, so
    // `go` is pure; each use re-opens what it receives, so it still meets an
    // effectful function in the same data.
    const source = `let ident(x: a): a = x
let make() =
    let run = ident((f) => f!())
    let go = () => run!(() => ())
    (go, 1)
export let use(b: Bool): Unit =
    let p = if b then make() else (() => save!("x"), 2)
    let (g, _) = p
    g!()
`;
    expect(check(source)).toEqual([]);
    expect(hover(source, "make() =")).toBe("() -> (() -> Unit, Int)");
  });

  it("publishes a spine colour pure everywhere at an expansive binding (#1166)", () => {
    // `make` is a computed value, so the relaxed value restriction would not
    // generalize a colour kept in its result: every use would share it.
    const block = `let ident(x: a): a = x
let make =
    let k = 1
    () =>
        let run = ident((f) => f!())
        run!(() => ())
        (run, k)
export let use(): Unit =
    let (r, _) = make()
    r(() => ())
`;
    expect(check(block)).toEqual([]);
    expect(hover(block, "make =")).toBe("() -> ((() -> Unit) -> Unit, Int)");
    // Whatever a use hands `r`: the face is pure, never a colour every use shares.
    expect(hover(block.replace("    r(() => ())\n", '    r!(() => save!("x"))\n'), "make ="))
      .toBe("() -> ((() -> Unit) -> Unit, Int)");
    const local = `let ident(x: a): a = x
export let use(): Unit =
    let make = ident(() =>
        let run = ident((f) => f!())
        run!(() => ())
        (run, 1))
    let (r, _) = make()
    r(() => ())
`;
    expect(check(local)).toEqual([]);
  });

  it("leaves a colour the spine's parameters hold on every function the result carries (#1166)", () => {
    // `go` runs the caller's `cb`, so its colour is the caller's to choose.
    const source = `let make(cb: () ->! Unit) =
    let go = () => cb!()
    (go, 1)
export let use(): Unit =
    let (g, _) = make(() => save!("x"))
    g!()
`;
    expect(check(source)).toEqual([]);
    expect(hover(source, "make(cb")).toBe("(() ->! Unit) -> (() >-> Unit, Int)");
    expect(check(source.replace("    g!()", "    g()"))).toEqual([wantsBang("g")]);
  });

  it("places a pin a knot recorded where a lone body places it: at the argument", () => {
    const source = `export let pureOnly(f: () -> Unit): Unit = f()
fun
    a(cb: () ->! Unit, n: Int): Unit = if n == 0 then cb!() else b(cb, n - 1)
    b(cb: () ->! Unit, n: Int): Unit = pureOnly(() => a!(cb, n))
`;
    const text = "module Main\n\n" + world + source;
    const lie = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics
      .find(({ message }) => message.startsWith("the parameter `cb` is written `->!`"));
    expect(lie === undefined ? undefined : text.slice(lie.primary.start.offset, lie.primary.end.offset))
      .toBe("() => a!(cb, n)");
  });

  it("reads a sibling call's mark as an outside call's, the knot's colours being monotypes", () => {
    // Within the knot a member's colours are monotypes (Functions §7.4): a
    // sibling call wears the member's colour, `!` where it depends on the
    // member's callbacks, as §3.4's `even`/`odd` do, even where the sibling
    // hands it pure functions (§3.4's step 6). A sibling handing `b` an
    // impure function pins its monomorphic colour, and the face published
    // then follows `a` alone.
    const knot = (sibling: string, outside: string): string => `fun
    m(a: () ->! Unit, b: () ->! Unit, n: Int): Unit =
        a!()
        if n > 0 then s!(n - 1) else ()
    s(n: Int): Unit = ${sibling}
export let outside(): Unit = ${outside}
`;
    const noop = "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n";
    expect(check(noop + knot("m!(noop, noop, n)", "m!(noop, save0, 1)"))).toEqual([]);
    expect(check(noop + knot("m(noop, noop, n)", "m!(noop, save0, 1)"))).toEqual([wantsBang("m")]);
    expect(check(noop + knot("m!(noop, noop, n)", "m(noop, noop, 1)"))).toEqual([]);
    expect(check(noop + knot("m!(noop, save0, n)", "m(noop, save0, 1)"))).toEqual([]);
    expect(hover(noop + knot("m!(noop, noop, n)", "m(noop, noop, 1)"), "m(a")).toBe(
      "(() ->! Unit, () ->! Unit, Int) >-> Unit",
    );
  });

  it("defaults `store`'s outer colour pure and keeps the parameter's variable", () => {
    const source = "let store(callback: () ->! String): Int = 1\n" +
      "export let keep(callback: () ->! String): Int = store(callback)\n";
    expect(hover(source, "store(")).toBe("(() ->! String) -> Int");
    expect(check(source)).toEqual([]);
  });

  it("builds `defer`'s closure purely, with or without a written return", () => {
    for (const header of ["let defer(action: () ->! Unit)", "let defer(action: () ->! Unit): (() >-> Unit)"]) {
      const source = `${header} = () => action!()
export let useDefer(action: () ->! Unit): (() >-> Unit) = defer(action)
`;
      expect(hover(source, "defer(")).toBe("(() ->! Unit) -> () >-> Unit");
      expect(check(source)).toEqual([]);
      expect(check(source.replace("= defer(action)", "= defer!(action)"))).toEqual([wantsBare("defer", "!")]);
    }
  });

  it("takes a pure local's call bare in an inlet-bearing body (#890)", () => {
    const source = `export let outer(a: () ->! Unit, b: () -> Unit): Unit =
    let f = () => b()
    let g = (x: Int) => x + 1
    let n = g(1)
    f()
    a!()
`;
    expect(check(source)).toEqual([]);
    expect(hover(source, "g =")).toBe("Int -> Int");
    expect(hover(source, "outer")).toBe("(() ->! Unit, () -> Unit) >-> Unit");
  });

  it("decides a source's other call colours before it generalizes", () => {
    // The body is a source, so its conduit arm has nothing to join `f`'s
    // colour to; the defaulting clause at calls makes it pure before `run`
    // generalizes, and an impure argument meets that face (§3.4, §4.3).
    const source = `let run(cb: () ->! Unit, f) =
    save!("x")
    cb!()
    f(1)
`;
    expect(hover(source, "run(")).toBe("<a: Num> (() ->! Unit, a -> b) ->! b");
    expect(check(`${source}export let use(): Int = run!(() => (), (n) =>
    save!("y")
    n)
`)).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — the " +
      "demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });

  it("leaves a pure lambda handed to a conduit pure beside the enclosing callback", () => {
    // `applyTo` is a conduit; the lambda it is handed is pure by its body, so
    // the call is bare even beside `cb!()` — the conservative-conduct rule
    // would have read it as conducting `cb`'s colour (§11).
    const source = `let applyTo(value: Int, step: Int ->! Int): Int = step!(value)
export let total(value: Int, cb: () ->! Unit): Int =
    cb!()
    applyTo(value, (n) => n + 1)
`;
    expect(check(source)).toEqual([]);
  });

  describe("a `fun` knot settles at its close", () => {
    const twoMember = `fun
    a(cb: () ->! Unit): Int = b(cb)
    b(cb: () ->! Unit): Int = if True then 1 else a(cb)
`;

    it("gives two siblings that perform nothing two bare calls and two pure faces", () => {
      expect(check(twoMember)).toEqual([]);
      expect(hover(twoMember, "a(cb")).toBe("(() ->! Unit) -> Int");
      expect(hover(twoMember, "b(cb")).toBe("(() ->! Unit) -> Int");
      expect(check(twoMember.replace("= b(cb)", "= b!(cb)"))).toEqual([wantsBare("b", "!")]);
    });

    it("conducts through `even`/`odd`, and through a member that only calls the sibling that does", () => {
      const evenOdd = `fun
    even(n: Int, cb: () ->! Unit): Unit = if n == 0 then cb!() else odd!(n - 1, cb)
    odd(n: Int, cb: () ->! Unit): Unit = if n == 0 then () else even!(n - 1, cb)
`;
      expect(check(evenOdd)).toEqual([]);
      expect(hover(evenOdd, "odd(n")).toBe("(Int, () ->! Unit) >-> Unit");
      expect(check(evenOdd.replace("else even!(", "else even("))).toEqual([wantsBang("even")]);
    });

    it("makes every caller of a source a source, whichever member closes first", () => {
      for (const members of [
        ["    a(cb: () ->! Unit): Unit =\n        cb!()\n        b!()\n",
          "    b(): Unit =\n        let unused = a\n        save!(\"x\")\n"],
        ["    b(): Unit =\n        let unused = a\n        save!(\"x\")\n",
          "    a(cb: () ->! Unit): Unit =\n        cb!()\n        b!()\n"],
      ]) {
        const knot = `fun\n${members.join("")}`;
        expect(check(knot)).toEqual([]);
        expect(hover(knot, "a(cb")).toBe("(() ->! Unit) ->! Unit");
        expect(hover(knot, "b()")).toBe("() ->! Unit");
        expect(check(knot.replace("        b!()", "        b()"))).toEqual([
          "this call may touch the world, so `b` wants `!`, not no mark",
        ]);
      }
    });

    it("refuses a sibling pinned pure that the source arm then claims, at the demand (§4.3)", () => {
      const pinned = "    a(): Unit =\n        let p: () -> Unit = b\n        ()\n";
      const source = "    b(): Unit =\n        let unused = a\n        save!(\"x\")\n";
      for (const members of [[pinned, source], [source, pinned]]) {
        const knot = `fun\n${members.join("")}`;
        const text = "module Main\n\n" + world + knot;
        const compiled = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics;
        expect(compiled.map(({ message }) => message)).toEqual([
          "a `->` arrow promises purity, and this function may touch the world — the " +
          "demand is written `->`, the function's face `->!` or `>->`",
        ]);
        // The primary is the demand — the written `() -> Unit` that pinned `b`.
        expect(text.slice(compiled[0]!.primary.start.offset)).toMatch(/^\(\) -> Unit = b\n/);
        expect(hover(knot, "b()")).toBe("() ->! Unit");
      }
    });

    it("holds a lambda that calls a sibling to the knot's close, whichever member closes first", () => {
      const conducting = "    a(cb: () ->! Unit): Unit =\n        let g = () =>\n            cb!()\n" +
        "            b!()\n        g!()\n";
      const source = "    b(): Unit =\n        let unused = a\n        save!(\"x\")\n";
      for (const members of [[conducting, source], [source, conducting]]) {
        const knot = `fun\n${members.join("")}`;
        expect(check(knot)).toEqual([]);
        expect(hover(knot, "a(cb")).toBe("(() ->! Unit) ->! Unit");
      }
      // The same lambda beside a sibling that performs nothing: the sibling
      // stays pure, and the call on it bare — nothing conducted it early.
      const quiet = `fun
    a(cb: () ->! Unit): Unit =
        let g = () =>
            cb!()
            b(cb)
        g!()
    b(cb: () ->! Unit): Unit =
        let unused = a
        ()
`;
      expect(check(quiet)).toEqual([]);
      expect(hover(quiet, "b(cb: ")).toBe("(() ->! Unit) -> Unit");
    });

    it("decides a held lambda's own calls at its own close, so nothing generalizes them free", () => {
      // `g` reaches `b`, so its join with `b` waits for the knot; its call on
      // `h` does not, and is pure before `g` generalizes (§2.6, §3.4). The
      // impure argument then meets that face — §4.3, as outside any knot.
      const holding = "    a(): Int =\n        let g = (h) =>\n            let u = b()\n            h(1)\n" +
        "        g((n) =>\n            save!(\"x\")\n            n)\n";
      const quiet = "    b(): Int =\n        let unused = a\n        1\n";
      for (const members of [[holding, quiet], [quiet, holding]]) {
        const knot = `fun\n${members.join("")}`;
        expect(check(knot)).toEqual([
          "a `->` arrow promises purity, and this function may touch the world — the " +
          "demand is written `->`, the function's face `->!` or `>->`",
        ]);
        expect(hover(knot, "b()")).toBe("() -> Int");
      }
    });

    it("makes a pinned source's callers sources too, however the pin and the call are ordered", () => {
      const source = "    b(): Unit =\n        let unused = a\n        save!(\"x\")\n";
      for (
        const caller of [
          "    a(): Unit =\n        let p: () -> Unit = b\n        b!()\n",
          "    a(): Unit =\n        b!()\n        let p: () -> Unit = b\n        ()\n",
          "    a(): Unit =\n        let q = b\n        let p: () -> Unit = b\n        q!()\n",
        ]
      ) {
        for (const members of [[caller, source], [source, caller]]) {
          const knot = `fun\n${members.join("")}`;
          expect(check(knot)).toEqual([
            "a `->` arrow promises purity, and this function may touch the world — the " +
            "demand is written `->`, the function's face `->!` or `>->`",
          ]);
          expect(hover(knot, "a()")).toBe("() ->! Unit");
          expect(hover(knot, "b()")).toBe("() ->! Unit");
        }
      }
    });

    it("compares a `->!` demand with a pure sibling after the defaulting — the demand never chooses", () => {
      // The sibling's colour is decided at the knot's close, and only then do
      // the demands it met read it (§3.4). A pure sibling met as a value fits
      // wherever it was used (#1119): the `->!` field, and the branch joining it
      // with an impure lambda, accept it in either member order — and neither
      // chose its colour, which stays pure.
      const box = "    a(): Unit =\n        let s = Box({ step = b })\n        ()\n";
      const branch = "    a(): Unit =\n        let k = if True then b else () => save!(\"x\")\n        ()\n";
      const quiet = "    b(): Unit =\n        let unused = a\n        ()\n";
      for (const caller of [box, branch]) {
        for (const members of [[caller, quiet], [quiet, caller]]) {
          const knot = "export record Box = { step: () ->! Unit }\nfun\n" + members.join("");
          expect(check(knot)).toEqual([]);
          expect(hover(knot, "b()")).toBe("() -> Unit");
        }
      }
    });

    it("holds a lambda that calls a pure sibling as a member, so the call changes nothing", () => {
      const inside = `export let outer(cb: () ->! Unit): Unit =
    fun
        a(): Unit =
            let g = (h) =>
                cb!()
                let u = b()
                h!()
            g!(cb)
        b(): Unit =
            let u = a
            ()
    a!()
`;
      expect(check(inside)).toEqual([]);
      expect(check(inside.replace("                let u = b()\n", ""))).toEqual([]);
      expect(hover(inside, "g =")).toBe(hover(inside.replace("                let u = b()\n", ""), "g ="));
    });

    it("captures an enclosing signature's colour in a nested knot", () => {
      const source = `export let outer(action: () ->! Unit): Int =
    fun
        b(n: Int): Int =
            action!()
            n
        a(n: Int): Int = if n == 0 then b!(0) else a!(n - 1)
    a!(3)
`;
      expect(check(source)).toEqual([]);
      expect(hover(source, "a(n")).toBe("Int >-> Int");
    });
  });

  describe("a function's colour is what its body does (§2.6)", () => {
    it("fits a pure lambda to a monomorphic `>->`, the written face no longer needed (#1119)", () => {
      // A pure function fits wherever a function is expected: beside `cb` the
      // lambda adds nothing to the colour the two share, which stays `cb`'s.
      // A local left to inference serves as the lambda does.
      const both = "let both(first: () ->! Unit, second: () ->! Unit): Int = 1\n";
      expect(check(`${both}export let useBoth(cb: () ->! Unit): Int = both(cb, () => ())\n`)).toEqual([]);
      expect(check(`${both}export let useBoth(cb: () ->! Unit): Int =
    let noop = () => ()
    both(cb, noop)
`)).toEqual([]);
      const orNoop = `export let orNoop(flag: Bool, cb: () ->! Unit): (() >-> Unit) =
    let noop = () => ()
    if flag then cb else noop
`;
      expect(check(orNoop)).toEqual([]);
      expect(hover(orNoop, "orNoop")).toBe("(Bool, () ->! Unit) -> () >-> Unit");
      const direct = `export let orNoop(flag: Bool, cb: () ->! Unit): (() >-> Unit) =
    if flag then cb else () => ()
`;
      expect(check(direct)).toEqual([]);
      expect(hover(direct, "orNoop")).toBe("(Bool, () ->! Unit) -> () >-> Unit");
    });

    it("fits a pure lambda where a `->!` field is demanded, inside an inlet-bearing body too (#1119)", () => {
      const source = `export record Source = { step: () ->! String }
export let quiet(cb: () ->! Unit): Source =
    cb!()
    Source({ step = () => "x" })
`;
      // The lambda's own colour is its body's; the field keeps its constant.
      expect(check(source)).toEqual([]);
    });

    it("accepts a `->!` face over a body that performs nothing (#1119)", () => {
      // A face may claim more effect than its body performs: `f` wears `->!`,
      // and a call to it is `!`. The pure direction stays exact (§4.2).
      expect(check("let f: (() ->! Int) = () => 1\nlet n: Int = f!()\n")).toEqual([]);
      expect(check("let f: (() -> Int) = () =>\n    save!(\"x\")\n    1\n")).toEqual([
        "this call may touch the world, and the enclosing function's face is the pure arrow `->` — " +
        "a pure face cannot run effects",
      ]);
    });
  });
});

describe("captured colours, pins, and owners (Effects §3.4, §4.2, §10)", () => {
  const prefix = "module Main\n\n" + world;
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", prefix + source]]);
  const hover = (source: string, needle: string): string | undefined =>
    hoveredType(prefix + source, needle);
  /** Each report's primary, labels, and fixit edits, as offsets into `source`. */
  const placed = (source: string) =>
    compileFiles([["/world.js", ""], ["/main.hex", prefix + source]]).diagnostics.map((diagnostic) => ({
      primary: diagnostic.primary.start.offset - prefix.length,
      labels: (diagnostic.labels ?? []).map(({ span }) => span.start.offset - prefix.length),
      edits: (diagnostic.fixes ?? []).flatMap((fix) =>
        fix.edits.map(({ span, replacement }) => [span.start.offset - prefix.length, replacement])
      ),
    }));
  const LOCAL = "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
    "this annotation has no callbacks of its own, and a local `>->` does not borrow the " +
    "enclosing function's — leave its type to inference, or write `->!`";
  const lie = (name: string): string =>
    `the parameter \`${name}\` is written \`->!\`, which accepts any function, and this accepts ` +
    `only a pure one — write \`${name}\`'s arrow \`->\``;

  describe("a local header's `>->` borrows nothing (§2.2.1)", () => {
    it("is refused in every local form, and reads as its fixit", () => {
      for (const body of [
        "    fun h(): () >-> Unit = () => action!()\n    h()!()\n",
        "    let h(): () >-> Unit = () => action!()\n    h()!()\n",
        "    let h: () >-> Unit = () => action!()\n    h!()\n",
        "    let h = (): () >-> Unit => () => action!()\n    h()!()\n",
      ]) {
        const source = `export let outer(action: () ->! Unit): Unit =\n${body}`;
        expect(check(source)).toEqual([LOCAL]);
        expect(hover(source, "outer")).toBe("(() ->! Unit) ->! Unit");
      }
    });

    it("left to inference, a local follows the captured callback", () => {
      const source = "export let outer(action: () ->! Unit): Unit =\n    fun h() = () => action!()\n    h()!()\n";
      expect(check(source)).toEqual([]);
      expect(hover(source, "outer")).toBe("(() ->! Unit) >-> Unit");
      expect(hover(source, "h()")).toBe("() -> () >-> Unit");
    });

    it("a module-level header with nothing handed is refused with the nothing-handed clause", () => {
      expect(check("export fun h(): () >-> Unit = () => ()\n")).toEqual([
        "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
        "no callback of this signature has been handed over by the time this arrow runs; " +
        "write `->!` for a function that may touch the world, or `->` for one that does not",
      ]);
    });
  });

  describe("a pin places the lie of generality (§4.2)", () => {
    it("at an annotation that pins a captured helper pure, labelling the callback's `->!`", () => {
      const source = `export let outer(action: () ->! Unit): Unit =
    fun h(): Unit = action!()
    let p: () -> Unit = h
    ()
`;
      expect(check(source)).toEqual([lie("action")]);
      const arrow = source.indexOf("->!");
      expect(placed(source)).toEqual([{
        primary: source.indexOf("() -> Unit"),
        labels: [arrow],
        edits: [[arrow, "->"]],
      }]);
    });

    it("once, however many callbacks a join made one colour", () => {
      const source = `export let outer(action: () ->! Unit): Unit =
    let p: () -> Unit = action
    action!()
`;
      expect(check(source)).toEqual([lie("action")]);
    });

    it("at the argument handed, where a `->` demand receives the callback", () => {
      const source = "export let pureOnly(f: () -> Unit): Unit = f()\n" +
        "export let outer(action: () ->! Unit): Unit = pureOnly(action)\n";
      expect(check(source)).toEqual([lie("action")]);
      expect(placed(source)[0]?.primary).toBe(source.indexOf("action)"));
    });

    it("an impure pin draws no report: the callback's colour made the constant (§4.2)", () => {
      const source = `export let outer(action: () ->! Unit): Unit =
    let q: () ->! Unit = action
    q!()
`;
      expect(check(source)).toEqual([]);
      expect(hover(source, "outer")).toBe("(() ->! Unit) ->! Unit");
    });

    it("tells a `>->` face over a source once when a `fun` knot conducts it (#891)", () => {
      expect(check(`export let withTransaction: ((String ->! String) >-> String) = (run: String ->! String): String =>
    ignore(save!("begin"))
    fun
        ping(n: Int): String = if n == 0 then run!("x") else pong!(n - 1)
        pong(n: Int): String = ping!(n)
    ping!(2)
`)).toEqual([
        "this call touches the world on its own account, and this face's `>->` promises the " +
        "function is only as effectful as what it is handed — write `->!`",
      ]);
    });
  });

  describe("a captured colour's display (§10)", () => {
    /** The session over one program, for hover and completion at a needle. */
    const session = (source: string) => {
      const opened = new AnalysisSession();
      opened.setFile("/world.js", "");
      opened.setFile("/main.hex", prefix + source);
      return opened;
    };
    const hovered = (source: string, needle: string) =>
      session(source).hover("/main.hex", prefix.length + source.indexOf(needle));
    const owner = "depends on `outer`'s `action`";
    const inMid = `export let outer(action: () ->! Unit): Int =
    fun mid(cb: () ->! Int): Int =
        let g = action
        cb!()
    mid(() => 1)
`;

    it("shows `>->` and names the owner, however deep the capture", () => {
      const source = `export let outer(action: () ->! Unit): Unit =
    let g = action
    g!()
`;
      for (const [text, needle] of [[source, "g ="], [inMid, "g ="]] as const) {
        const shown = hovered(text, needle);
        expect(shown?.displayedType).toBe("() >-> Unit");
        expect(shown?.colourOwners).toEqual([owner]);
      }
      expect(hoverMarkdown(hovered(inMid, "g =")!)).toBe(`value \`g: () >-> Unit\`\n\n${owner}`);
      // `mid`'s own face is its own callback's, and names no owner.
      expect(hovered(inMid, "mid(cb")?.displayedType).toBe("(() ->! Int) >-> Int");
      expect(hovered(inMid, "mid(cb")?.colourOwners).toBeUndefined();
    });

    it("displays a hole where it stands", () => {
      const source = inMid.replace("let g = action", "let g: _ = action");
      const hole = hovered(source, "_ = action");
      expect(hole?.displayedType).toBe("() >-> Unit");
      expect(hole?.colourOwners).toEqual([owner]);
    });

    it("names only the captured colour where the face has callbacks of its own", () => {
      const source = `export let outer(action: () ->! Unit): Int =
    fun h(cb: () ->! Int): Int =
        action!()
        1
    fun mid(k: () ->! Int): Int =
        let copy = h
        k!()
    mid(() => 1)
`;
      expect(hovered(source, "h(cb")?.displayedType).toBe("(() ->! Int) >-> Int");
      expect(hovered(source, "copy =")?.displayedType).toBe("(() ->! Int) >-> Int");
      expect(hovered(source, "copy =")?.colourOwners).toEqual([owner]);
    });

    it("names the binding a lambda is the value of, and a lambda none names", () => {
      const inside = (value: string) => `export let outer(n: Int): Int =
    ${value}(act: () ->! Unit): Int =>
        fun mid(k: () ->! Int): Int =
            let g = act
            k!()
        mid(() => 1)${value === "let run = " ? "" : ")"}
    n
`;
      expect(hovered(inside("let run = "), "g =")?.colourOwners).toEqual(["depends on `run`'s `act`"]);
      expect(hovered(inside("let pair = (1, "), "g =")?.colourOwners).toEqual([
        "depends on an enclosing lambda's `act`",
      ]);
    });

    it("decorates completion detail at the cursor", () => {
      const source = inMid.replace("        cb!()\n", "        let z = g\n        cb!()\n");
      const cursor = prefix.length + source.indexOf("let z = g") + "let z = g".length;
      const g = session(source).completions("/main.hex", cursor).find(({ name }) => name === "g");
      expect(g?.detail).toBe("() >-> Unit — depends on outer's action");
    });

    it("decorates a diagnostic that shows a captured colour, over settled colours", () => {
      const inside = inMid.replace("        cb!()\n", "        let n: Int = g\n        cb!()\n");
      const report = compileFiles([["/world.js", ""], ["/main.hex", prefix + inside]]).diagnostics;
      expect(report.map(({ message }) => message)).toEqual(["type mismatch: expected Int, found () >-> Unit"]);
      expect(report[0]?.notes).toEqual([owner]);
      // A face with a callback of its own and a captured colour names what else
      // it depends on; one whose colours are all its own callbacks' names none.
      const both = inMid.replace("        cb!()\n", `        let k = (f: () ->! Unit): Unit =>
            action!()
            f!()
        let n: Int = k
        cb!()
`);
      const joined = compileFiles([["/world.js", ""], ["/main.hex", prefix + both]]).diagnostics;
      expect(joined.map(({ message }) => message)).toEqual([
        "type mismatch: expected Int, found (() ->! Unit) >-> Unit",
      ]);
      expect(joined[0]?.notes).toEqual([owner]);
      const own = inMid.replace("        cb!()\n", `        let k = (f: () ->! Unit): Unit => f!()
        let n: Int = k
        cb!()
`);
      const plain = compileFiles([["/world.js", ""], ["/main.hex", prefix + own]]).diagnostics;
      expect(plain.map(({ message }) => message)).toEqual([
        "type mismatch: expected Int, found (() ->! Unit) >-> Unit",
      ]);
      expect(plain[0]?.notes).toBeUndefined();
    });
  });
});
