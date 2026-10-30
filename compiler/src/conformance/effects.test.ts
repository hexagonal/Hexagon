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

/**
 * A mark that claims more than its call does, where the report names no
 * cause, is hedged (Declarations Preamble §1.1): it names the other
 * possibility, its removal is a suggestion, and only the first such report in
 * a module is given.
 */
const perhaps = (message: string, claims: string, silent: string): string =>
  `${message} — perhaps the mark is wrong; or, if this call ${claims}, something makes it ${silent} ` +
  "that this report does not name";

/** A hedged report on a mark that claims both colours where the call has neither. */
const pureAndTotal = (message: string): string => perhaps(message, "is impure and may fail", "pure and unable to fail");

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
const UNLINKED_EXTERN_ROW = "`>->` means only as effectful as what it is handed, and nothing is handed here — no callback of " +
  "this signature has been handed over by the time this arrow runs; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail — write the callback " +
  "parameter this row runs, with `->!`, or write `->!` on the row";

/** FFI Part 4 §13's colon row *(#869)*. */
const RETIRED_COLON = "an extern callable declares its effect — write `->` for a function " +
  "that is pure and never throws, `->^` for one that may throw, `->~` for one that is impure " +
  "and never throws, `->!` for one that may do both, `>->` for one exactly as effectful as a " +
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
  "Hexagon's type arrows are `->`, `->^`, `->~`, `->!` and the following arrows such as `>->`; `=>` is the lambda arrow — " +
  "for a function type write `Int -> Int` (or a marked arrow for what it may do)";

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
      "this call is impure and may fail, so `combine` wants `!`, not no mark",
    ]);
  });

  it("bare -> `!`: a bare call on a constant-impure arrow is refused", () => {
    // `save` is impure by ruling 4's extern default, and the report names `!`.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let run(document: String): Unit = save(document)
`]]),
    ).toEqual([
      "this call is impure and may fail, so `save` wants `!`, not no mark",
    ]);
  });

  it("`!` -> bare: symmetric enforcement, a mark on a provably pure call", () => {
    expect(foldWith("!", "!")).toEqual([
      pureAndTotal("this call is pure and cannot fail, so `next` wants no mark, not `!`"),
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
      "this call is impure and may fail, so this call wants `!`, not no mark",
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
      "this call is impure and may fail, so `readLine` wants `!`, not no mark",
    ]);
  });

  it("colours the enclosing function, so its own callers wear `!` too", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}
export let ask(): String = readLine!()
export let twice(): String = ask() ++ ask!()
`]]),
    ).toEqual([
      "this call is impure and may fail, so `ask` wants `!`, not no mark",
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
      "`>->` means only as effectful as what it is handed, and nothing is handed here — a `record` " +
      "field is data, not a signature; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
      "`>->` means only as effectful as what it is handed, and nothing is handed here — a `union` " +
      "field is data, not a signature; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
      "`>->` means only as effectful as what it is handed, and nothing is handed here — an alias is a " +
      "type fragment, not a signature; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
    ]);
  });

  it("refuses it once, not twice, when the alias is also used", () => {
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
type Handler = () >-> String
export let run(h: Handler): String = h!()
`]]),
    ).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — an alias is a " +
      "type fragment, not a signature; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
      "this call is impure and may fail, so this call wants `!`, not no mark",
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
      "write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
      "write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
      "write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
    const clause = "`>->` means only as effectful as what it is handed, and nothing is handed here — no callback of " +
      "this signature has been handed over by the time this arrow runs; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail";
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
      "the parameter `run` is written `->!`, which accepts any function, and this accepts only one " +
      "that is pure and cannot fail — write `run`'s arrow `->`",
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
        ["save!(\"x\")", `this call is impure and may fail on its own account, ${promise}`, [">->"]],
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
        "this call is impure and may fail on its own account, and this face's `>->` promises the function is only as effectful as what it is handed — write `->!`",
        "this call is impure and may fail, so this call wants `!`, not no mark",
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
    // An enclosing body's untyped callback: decided by its facts at its close.
    for (const value of ["let g = () => action!()\n        g", "() => action!()"]) {
      expect(at(`let outer(action): Unit =
    action!()
    let h(cb: () ->! Unit): () >-> Unit =
        ${value}
    h(() => ())!()
`)).toEqual([["action!()", "this call runs `outer`'s `action`, which this signature is not handed"]]);
    }
    // Called bare, it is pure: nothing to report.
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
      expect(at(source)).toEqual([["b!(n)", "this call is impure and may fail on its own account"]]);
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
    // A lambda written in place reads as its let-bound twin (#1213 (T)): the
    // seat meets an instance of its written callback, so handing it back is no
    // lie, and a function it hands back that touches the world on its own
    // account is the report, at that call.
    const apply = "let apply(f: (() ->! Unit) ->! (() ->! Unit)): Unit = f!(() => ())!()\n";
    for (const lambda of ["(cb: () ->! Unit): () >-> Unit => cb", "(cb: () ->! Unit): () >-> Unit => () => save!(\"q\")"]) {
      const twin = at(`${apply}let lam = ${lambda}\nexport let u(): Unit = apply!(lam)\n`);
      expect([lambda, at(`${apply}export let u(): Unit = apply!(${lambda})\n`)]).toEqual([lambda, twin]);
    }
    expect(at(`${apply}export let u(): Unit = apply!((cb: () ->! Unit): () >-> Unit => () => save!("q"))\n`))
      .toEqual(['save!("q")']);
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
    // A knot can no longer pin its own callback: the function its recursive
    // call made is refused where it is handed, and that refusal stands alone
    // (Effects §3.4, #1218).
    expect(at(`fun
    h(n: Int, cb: () ->! Unit): () >-> Unit =
        if n == 0 then cb else h(n - 1, () => save!("y"))
`)).toEqual(['() => save!("y")']);
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
`)).toEqual([["save0", "this function is impure and may fail on its own account"]]);
  });
});

describe("Effects §3.4 — a parameter with no written type is decided by the facts about it", () => {
  const fixtures = "export let apply2(f: () ->! Unit, g: () ->! Unit): Unit =\n    f!()\n    g!()\n" +
    "export let pureOnly(f: () -> Unit): Unit = f()\n";
  const text = (source: string): string => "module Main\n\n" + fixtures + source;
  const check = (source: string): readonly string[] => effectDiagnostics([["/main.hex", text(source)]]);

  it("a colour no fact reaches is the parameter's own, and one a bare call runs is pure", () => {
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

  it("a bare call is a fact: a mark beside it is the wrong one, and its report names the fact", () => {
    // A mark decides nothing (§2.6); the bare call says `f` is pure.
    expect(check("let mixed(f) =\n    f!()\n    f()\n")).toEqual([
      "this call is pure and cannot fail, so `f` wants no mark, not `!` — `f` is called bare, which makes it pure " +
      "and unable to fail",
    ]);
  });

  it("a `->` demand is a fact: the `!` beside it is the mark report, naming the meeting", () => {
    // `pinned(f)`: the `->` demand decides the colour, and there is no written
    // arrow for a lie-of-generality report to name.
    for (const lines of [["pureOnly(f)", "f!()"], ["f!()", "pureOnly(f)"]]) {
      expect(check(`let pinned(f) =\n    ${lines[0]}\n    ${lines[1]}\n`)).toEqual([
        "this call is pure and cannot fail, so `f` wants no mark, not `!` — `f` meets a type that makes it pure and " +
        "unable to fail",
      ]);
    }
  });

  it("a colour a nested body runs is the enclosing parameter's, and never generalizes there", () => {
    // `h` runs `action`, a colour of `outer`'s environment: `h` does not
    // quantify it, no fact silences it, so it is `action`'s own and `outer`
    // follows it.
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
    // A bare call of `h` is a fact through its label: `action` is pure, and the
    // mark inside is the one the fact contradicts.
    expect(check("let outer(action): Unit =\n    let h() = action!()\n    h()\n")).toEqual([
      "this call is pure and cannot fail, so `action` wants no mark, not `!` — `h` is called bare, which makes " +
      "`action` pure and unable to fail",
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
  const PURITY = "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the demand is written " +
    "`->`";
  // A function handed where a bare call made the parameter pure: the report names the fact (#1240).
  const BARE = (fact: string): string =>
    `this function is impure and may fail, where the function handed must be pure and unable to fail — ${fact}`;

  it("a fact on an arrow a parameter returns names what it returns (#1308)", () => {
    // `h()` decides the arrow `f` returns, not `f`'s own: the function handed
    // returns an impure one, and is itself pure.
    const twice = "let tw(f) =\n    let h = f()\n    h()\n    0\n";
    expect(check(twice + "export let p(): Int = tw(() => save0)\n")).toEqual([
      "this function returns a function that is impure and may fail, where the function handed must return one that " +
      "is pure and unable to fail — `h` is called bare, which makes what `f` returns pure and unable to fail",
    ]);
    // A mark on that arrow is told the same.
    expect(check("let tw(f) =\n    let h = f()\n    h()\n    h!()\n    0\n")).toEqual([
      "this call is pure and cannot fail, so `h` wants no mark, not `!` — `h` is called bare, which makes what `f` " +
      "returns pure and unable to fail",
    ]);
    // One arrow further, through the call that reaches it.
    expect(check("let tw(f) =\n    let h = f()()\n    h()\n    0\nexport let p(): Int = tw(() => () => save0)\n")).toEqual([
      "this function returns a function that returns one that is impure and may fail, where the function handed must " +
      "return one that returns one that is pure and unable to fail — `h` is called bare, which makes what `f()` returns " +
      "pure and unable to fail",
    ]);
    // A fact on the parameter's own arrow names the parameter, as before.
    expect(check("let tw2(f) =\n    f()\n    0\nexport let q(): Int = tw2(save0)\n"))
      .toEqual([BARE("`f` is called bare, which makes it pure and unable to fail")]);
    // Handed through a wrapper onto the arrow `k` is called through, it is
    // `k`'s own arrow the demand sits on: what is handed is impure itself.
    expect(check(twice + "let w(k) = tw(() => k)\nexport let p(): Int = w(save0)\n"))
      .toEqual([BARE("`h` is called bare, which makes `k` pure and unable to fail")]);
    // Handed where what it returns meets the fact, it is what the lambda
    // returns that does not fit, whatever the fact is about.
    expect(check("let tw(f) =\n    f()\n    0\nlet w(k) = tw(k())\nexport let p(): Int = w(() => save0)\n")).toEqual([
      "this function returns a function that is impure and may fail, where the function handed must return one that " +
      "is pure and unable to fail — `f` is called bare, which makes it pure and unable to fail",
    ]);
    // Through a call with arguments, and in the fix that marks every call.
    expect(check("let tw(f) =\n    let h = f(1)()\n    h()\n    h!()\n    0\n")).toEqual([
      "this call is pure and cannot fail, so `h` wants no mark, not `!` — `h` is called bare, which makes what `f(…)` " +
      "returns pure and unable to fail",
    ]);
    const fixes = effectFixes([["/world.js", ""], ["/main.hex",
      text("let tw(f) =\n    let h = f()\n    h()\n    h()\n    0\nexport let p(): Int = tw(() => save0)\n")]]);
    expect(fixes).toContain("mark every call that makes what `f` returns pure and unable to fail: \"!\"");
    // A guard's report, and a grouped report's label at the function handed.
    expect(check("exception Oops\nlet tw(f) =\n    let h = f()\n    try\n        h()\n    catch\n        Oops => ()\n    0\n"))
      .toContain("this arm can never run: nothing in this `try` may fail — `h` is called bare, which makes what `f` returns unable to fail");
    const labels = compileFiles([["/world.js", ""], ["/main.hex",
      text("let tw(f) =\n    let h = f()\n    h()\n    h!()\n    0\nexport let p(): Int = tw(() => save0)\n")]])
      .diagnostics.flatMap(({ labels: each }) => (each ?? []).map(({ message }) => message));
    expect(labels).toContain("a function that returns a function that is impure and may fail is handed here");
    // Where the two colours sit on different arrows, each is told on its own.
    const ones = 'extern from "./world.js"\n    export fun log(s: String) ->~ Unit\n' +
      'let log0(): Unit = log~("x")\nexception Oops\nlet oops0(): Unit = throw^(Oops)\n';
    expect(check(ones + "let tw(f) =\n    let h = f^()\n    h~()\n    0\nlet mk() =\n    log0~()\n    oops0\n" +
      "export let p(): Int = tw(mk)\n")).toEqual([
      "this function is impure, and returns a function that may fail, where the function handed must be pure, and return " +
      "one that is unable to fail — `f` is called `^`, which makes it pure, and `h` is called `~`, which makes what `f` " +
      "returns unable to fail",
    ]);
  });

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
      .toEqual(["this call is impure and may fail, so this call wants `!`, not no mark"]);
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

  it("a colour two untyped parameters share, where no call reaches it, is pure: inference cannot keep them apart", () => {
    const source = "let both(k, j) = keep(if c then k else j)\n";
    expect(check(source + "export let user(): Unit = both(noop, noop)\n")).toEqual([]);
    expect(hoveredType(text(source), "both(k")).toBe("(() -> Unit, () -> Unit) -> Unit");
    // No `->` is written: inference settled it, and the report says so (#1303).
    expect(check(source + "export let user(): Unit = both(save0, noop)\n")).toEqual([
      "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — no `->` is written here: inference settled it, since nothing it was decided from is impure or may fail; write the type you mean where it is decided",
    ]);
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
      [["keep(k)", "k()"], "(() -> Unit) -> Unit", [BARE("`k` is called bare, which makes it pure and unable to fail")]],
      // A bare call in a nested body reaches it too.
      [["keep(k)", "let g = () => runIt(k)"], "(() -> Unit) -> Unit", [BARE("`runIt` is called bare, which makes `k` pure and unable to fail")]],
      // A `!` call runs it, and no fact silences it: it is its own.
      [["keep(k)", "runIt!(k)"], "(() ->! Unit) >-> Unit", ["this call is impure and may fail, so `f` wants `!`, not no mark"]],
      // A `->` demand pins it, and the report names that type (#1307).
      [["keep(k)", "pureOnly(k)"], "(() -> Unit) -> Unit", [BARE("`k` meets a type that makes it pure and unable to fail")]],
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
        message: "`cb`'s colour is tied to `action`'s here, and inference cannot keep them apart — write `cb`'s type, or wrap `cb` where they meet",
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
      message: "`a`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `a`'s type, or wrap `a` where they meet",
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
      "`cb`'s colour is tied to `action`'s here, and inference cannot keep them apart — write `cb`'s type, or wrap `cb` where they meet",
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
    const tie = "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet";
    for (const head of ["fun\n    a", "let a"]) {
      const indent = head.startsWith("fun") ? "        " : "    ";
      expect(tieReports(`${head}(c: Bool, f, g): Unit =\n${indent}let h = if c then f else g\n${indent}h!()\n`)
        .map(({ message }) => message)).toEqual([tie]);
    }
  });

  it("to an enclosing untyped callback, decided where that callback's body closes", () => {
    // Claimed there, `g`'s colour is a callback's, and the merge ties `f` to
    // it; called bare, `g` is pure, and a colour pinned to a constant is no tie.
    expect(tieReports(`let outer(g, c: Bool): Unit =
    g!()
    let inner = (f) => if c then g else f
    ()
`).map(({ message }) => message)).toEqual([
      "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
    ]);
    expect(tieReports(`let outer(g, c: Bool): Unit =
    let inner = (f) => if c then g else f
    ()
`)).toEqual([]);
  });

  it("to an enclosing untyped callback, the same report whichever line comes first (#1163)", () => {
    // `f` is a function only once `g!()` is read: a later line of the
    // enclosing body decides its shape, and its close decides the tie.
    const lines = ["g!()", "let inner = (f) => if c then g else f"];
    const reports = [lines, [...lines].reverse()].map((order) =>
      tieReports("let outer(g, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n")
    );
    expect(reports[0]!.map(({ at }) => at)).toEqual(["if c then g else f"]);
    expect(reports[1]).toEqual(reports[0]);
  });

  it("one report per tie, across nested bodies, whatever the order of the lines (#1163)", () => {
    const tie = "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet";
    for (const [nested, later] of [
      // A use of the tied function hands it another untyped callback, tied to the same colour.
      ["let inner = (f) => if c then g else f", "let fwd = (h) => inner(h)"],
      // Two nested bodies tie their own parameters to the same callback.
      ["let inner = (f) => if c then g else f", "let other = (h) => if c then g else h"],
    ]) {
      const orders = [["g!()", nested, later], [nested, "g!()", later], [nested, later, "g!()"]];
      const reports = orders.map((order) =>
        tieReports("let outer(g, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n")
      );
      expect([later, reports[0]!.map(({ message }) => message)]).toEqual([later, [tie]]);
      expect([later, reports[0]![0]!.labels]).toEqual([later, [
        "f: `f` has no written type",
        "g: `g` has no written type",
        "h: `h` has no written type",
      ]]);
      for (const report of reports) expect([later, report]).toEqual([later, reports[0]]);
    }
    // Nested two deep: the report names the first tied parameter in source order, in either order.
    const deep = "let inner = (f) =>\n        let more = (k) => if c then g else k\n        more(f)";
    const reports = [["g!()", deep], [deep, "g!()"]].map((order) =>
      tieReports("let outer(g, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n")
    );
    expect(reports[0]!.map(({ message }) => message))
      .toEqual(["`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet"]);
    expect(reports[1]).toEqual(reports[0]);
  });

  it("two bodies deep, the same report wherever the line that decides the callback stands (#1163)", () => {
    const programs = [
      "let outer(g, c: Bool): Unit =\n    let mid = () =>\n        let inner = (f) => if c then g else f\n        g!()\n        ()\n    ()\n",
      "let outer(g, c: Bool): Unit =\n    let mid = () =>\n        g!()\n        let inner = (f) => if c then g else f\n        ()\n    ()\n",
      "let outer(g, c: Bool): Unit =\n    let mid = () =>\n        let inner = (f) => if c then g else f\n        ()\n    g!()\n    ()\n",
      "let outer(g, c: Bool): Unit =\n    g!()\n    let mid = () =>\n        let inner = (f) => if c then g else f\n        ()\n    ()\n",
    ];
    const reports = programs.map(tieReports);
    expect(reports[0]!.map(({ at }) => at)).toEqual(["if c then g else f"]);
    for (const report of reports) expect(report).toEqual(reports[0]);
  });

  it("stands at the merge that tied them, whatever later line meets the callback's colour (#1163)", () => {
    for (const later of ["let other = if c then g else () => ()\n    other!()", "let k = (h) => [g, h]"]) {
      const at = tieReports(`let outer(g, c: Bool): Unit =\n    g!()\n    let inner = (f) => if c then g else f\n    ${later}\n    ()\n`)
        .map(({ at }) => at);
      expect([later, at[0]]).toEqual([later, "if c then g else f"]);
    }
  });

  it("three bodies deep, a tie that waits on a callback further out joins its report (#1163)", () => {
    const head = "let top(h, c: Bool): Unit =\n";
    const outer = (lines: readonly string[]): string =>
      "    let outer = (g) =>\n" + lines.map((line) => `        ${line}\n`).join("") + "        ()\n";
    const inside = ["let inner = (f) => if c then g else f", "let pair = [g, h]"];
    const programs = [
      head + "    h!()\n" + outer(inside) + "    ()\n",
      head + "    h!()\n" + outer([...inside].reverse()) + "    ()\n",
      head + outer(inside) + "    h!()\n    ()\n",
      head + outer([...inside].reverse()) + "    h!()\n    ()\n",
    ];
    for (const program of programs) {
      const reports = tieReports(program);
      expect([program, reports.map(({ message }) => message)]).toEqual([program, [
        "`g`'s colour is tied to `h`'s here, and inference cannot keep them apart — write `g`'s type, or wrap `g` where they meet",
      ]]);
      expect([program, reports[0]!.labels]).toEqual([program, [
        "g: `g` has no written type",
        "h: `h` has no written type",
        "f: `f` has no written type",
      ]]);
    }
  });

  it("a nested parameter spelled like the callback it is tied to reads alike in either order (#1163)", () => {
    const lines = ["g!()", "let h = g", "let inner = (g) => if c then h else g"];
    const reports = [lines, [lines[1]!, lines[2]!, lines[0]!]].map((order) =>
      tieReports("let outer(g, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n")
    );
    expect(reports[0]!.map(({ message }) => message))
      .toEqual(["`g`'s colour is tied to `outer`'s `g` here, and inference cannot keep them apart — write `g`'s type, or wrap `g` where they meet"]);
    expect(reports[0]![0]!.labels).toEqual([
      "g: `inner`'s `g` has no written type",
      "g: `outer`'s `g` has no written type",
    ]);
    expect(reports[1]).toEqual(reports[0]);
  });

  it("a tie that waited on a callback that turned pure is still read, in either order (#1163)", () => {
    // `f` waits on `g`, which shares its colour; `g` is decided pure, and `f`
    // is tied through the lambda to the captured `action`.
    const lambda = "let inner = (f) => if c then f else () =>\n            g()\n            action!()";
    for (const decide of ["g()", "pureOnly(g)"]) {
      const reports = [[decide, lambda], [lambda, decide]].map((order) =>
        tieReports("let outer(action: () ->! Unit, g, c: Bool): Unit =\n" +
          order.map((line) => `    ${line}\n`).join("") + "    ()\n").map(({ message }) => message)
      );
      expect([decide, reports[0]]).toEqual([decide, [
        "`f`'s colour is tied to `action`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
      ]]);
      expect([decide, reports[1]]).toEqual([decide, reports[0]]);
    }
  });

  it("to a captured written callback, where a later line makes the captured value a function, in either order (#1216)", () => {
    // `inner` makes `f` one with `a`, taken from `p`; `tieTwo` makes `p`'s
    // first part `action`'s type. The sharing is `inner`'s, so the tie stands
    // where `inner` made it, whichever line comes first.
    for (const tieLine of ["tieTwo(p, (action, 1))", "tieTwo(p, (() => action!(), 1))"]) {
    for (const [nested, at, named] of [
      ["let inner = (f) =>\n        let (a, _) = p\n        if c then a else f", "if c then a else f", "action"],
      ["let inner = (f) =>\n        let (a, _) = p\n        tieTwo(a, f)\n        ()", "tieTwo(a, f)", "action"],
      // Siblings in a middle body, tied to each other through the captured colour.
      ["let mid = (f, g) =>\n        let (a, _) = p\n        tieTwo(a, f)\n        if c then f else g", "if c then f else g", "g"],
      // Two bodies deep.
      ["let mid = () =>\n        let inner = (f) =>\n            let (a, _) = p\n            if c then a else f\n        ()", "if c then a else f", "action"],
    ] as const) {
      const reports = [[nested, tieLine], [tieLine, nested]].map((order) =>
        tieReports("let outer(action: () ->! Unit, p, c: Bool): Unit =\n" +
          order.map((line) => `    ${line}\n`).join("") + "    ()\n")
      );
      expect([nested, reports[0]!.map(({ at, message }) => [at, message])]).toEqual([nested, [[
        at,
        `\`f\`'s colour is tied to \`${named}\`'s here, and inference cannot keep them apart — write \`f\`'s type, or wrap \`f\` where they meet`,
      ]]]);
      expect([nested, reports[1]]).toEqual([nested, reports[0]]);
    }
    }
    // Two nested bodies tied to it: a report each, in either order.
    const i1 = "let i1 = (f) =>\n        let (a, _) = p\n        if c then a else f";
    const i2 = "let i2 = (g) =>\n        let (a, _) = p\n        if c then a else g";
    const both = [[i1, i2, "tieTwo(p, (action, 1))"], ["tieTwo(p, (action, 1))", i1, i2]].map((order) =>
      tieReports("let outer(action: () ->! Unit, p, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n")
    );
    expect(both[0]!.map(({ at }) => at)).toEqual(["if c then a else f", "if c then a else g"]);
    expect(both[1]).toEqual(both[0]);
  });

  it("not to a colour a later line gave a captured value, nor through a use of the body's value (#1216)", () => {
    // `p`'s first part is a function only that line decides; no written
    // callback's colour reaches `f` or `g`, so neither order is a tie.
    const nested = "let mid = (f, g) =>\n        let (a, _) = p\n        tieTwo(a, f)\n        if c then f else g";
    for (const later of ["tieTwo(p, (noop, 1))", "tieTwo(p, (() => (), 1))", "tieTwo(p, ((h) => h!(), 1))", "tieTwo(p, (takesD, 1))"]) {
      for (const order of [[nested, later], [later, nested]]) {
        const source = "let noop(): Unit = ()\nlet outer(p, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n";
        expect([order, tieReports(source)]).toEqual([order, []]);
      }
    }
  });

  it("to a captured colour, read where the body that owns it closes, from all its facts, in every order (#1293)", () => {
    const outer = (lines: readonly string[], head = "action: () ->! Unit, p, c: Bool"): string =>
      `let noop(): Unit = ()\nlet outer(${head}): Unit =\n` + lines.map((line) => `    ${line}\n`).join("") + "    ()\n";
    const inner = "let inner = (f) =>\n        let (a, _) = p\n        if c then a else f";
    const tiedToAction = "`f`'s colour is tied to `action`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet";
    // Two nested bodies share `p`'s colour, which no written callback reaches:
    // `outer` decides it, so neither is tied, whichever line comes first.
    const i1 = "let i1 = (f) =>\n        let (a, _) = p\n        if c then a else f";
    const i2 = "let i2 = (g) =>\n        let (a, _) = p\n        if c then a else g";
    for (const order of orders([i1, i2, "tieTwo(p, (noop, 1))"])) {
      expect([order, tieReports(outer(order))]).toEqual([order, []]);
    }
    // A written colour a later line joins in is part of it, whichever line
    // shaped `p` and wherever the join stands, so `f` is tied to `action`.
    for (
      const lines of [
        [inner, "tieTwo(p, (noop, 1))", "tieTwo(p, (action, 1))"],
        [inner, "tieTwo(p, (noop, 1))", "let (q, _) = p\n    tieTwo(q, action)"],
        [inner, "if c then tieTwo(p, (noop, 1)) else tieTwo(p, (action, 1))"],
        [inner, "if c then tieTwo(p, (action, 1)) else tieTwo(p, (noop, 1))"],
      ]
    ) {
      for (const order of orders(lines)) {
        const reports = tieReports(outer(order));
        expect([order, reports.map(({ at, message, fixes }) => [at, message, fixes])])
          .toEqual([order, [["if c then a else f", tiedToAction, [": () ->! Unit"]]]]);
      }
    }
    // Once a written colour is part of it at `inner`'s close, `f` reads as its
    // fix from there, so a forwarder meets no tie of its own.
    expect(tieReports(outer(["tieTwo(p, (action, 1))", inner, "let fwd = (k) => inner(k)"])).map(({ at }) => at))
      .toEqual(["if c then a else f"]);
    // The nested body neither keeps, silences nor defaults the captured
    // colour: a bare call or a mark beside it reads as it would with no nested
    // body, and so do the nested body's own calls (#1369).
    const z = (call: string): string => `let (z, _) = p\n    ${call}`;
    for (const order of orders([z("z()"), inner])) expect([order, tieReports(outer(order))]).toEqual([order, []]);
    // A mark through `p`'s data is true: that arrow is the written twin's
    // `->!` (#1380).
    for (const order of orders([z("z!()"), inner])) expect([order, tieReports(outer(order))]).toEqual([order, []]);
    const calls = "let inner = (f) =>\n        let (a, _) = p\n        let x = if c then a else f\n        f()";
    for (const order of orders([calls, "tieTwo(p, (action, 1))"])) {
      expect([order, tieReports(outer(order)).map(({ at, message }) => [at, message])])
        .toEqual([order, [["if c then a else f", tiedToAction]]]);
    }
    // A forwarder's parameter is the refused lambda's, one report in every order.
    for (const order of [...orders([inner, "tieTwo(p, (action, 1))"]).map((lines) => [...lines, "let fwd = (k) => inner(k)"]),
      [inner, "let fwd = (k) => inner(k)", "tieTwo(p, (action, 1))"]]) {
      expect([order, tieReports(outer(order)).map(({ at }) => at)]).toEqual([order, ["if c then a else f"]]);
    }
    // In a knot, where a member's parameters sit at the knot's level, the
    // member that holds the value decides it, in every order (#1372).
    const knotLines = [z("z()"), "b(p, c, n - 1)", "let i1 = (f) =>\n        let (a2, _) = p\n        if c then a2 else f"];
    for (const order of orders(knotLines)) {
      const program = "fun\n    a(p, c: Bool, n: Int): Unit =\n" + order.map((line) => `        ${line.replaceAll("\n    ", "\n        ")}\n`).join("") +
        "        ()\n    b(p, c: Bool, n: Int): Unit = if n == 0 then () else a(p, c, n)\n";
      expect([order, tieReports(program)]).toEqual([order, []]);
    }
    // A forwarder whose colour is only the refused parameter's meets no tie of
    // its own, and nor does a sibling sharing it, so the fix writes `f` alone,
    // in every order.
    for (const fwd of ["let fwd = (k) => inner(k)", "let fwd = (k, m) =>\n        ignore(inner(k))\n        ignore(if c then k else m)\n        ()"]) {
      for (const order of orders([inner, "tieTwo(p, (action, 1))"]).map((lines) => [...lines, fwd])) {
        expect([order, tieReports(outer(order)).map(({ labels }) => labels)]).toEqual([order, [["f: `f` has no written type"]]]);
      }
    }
    // An outer callback merged with the captured value is decided with it.
    const b = "let (b, _) = p\n    let y = if c then b else h";
    for (const order of orders(["tieTwo(p, (noop, 1))", inner.replace("inner", "i1"), b])) {
      expect([order, tieReports(outer(order, "action: () ->! Unit, p, h, c: Bool"))]).toEqual([order, []]);
    }
    // A colour two bodies' values make is read where the outer one closes.
    // `b!()` runs `q`'s data, the written twin's `->!` (#1380), so the lambda
    // is impure on its own account, and `f` meets that constant: no tie.
    const mid = "let mid = (q) =>\n        let inner = (f) =>\n            let (a, _) = p\n            let (b, _) = q\n" +
      "            if c then f else () =>\n                a!()\n                b!()\n        tieTwo(q, (noop, 1))\n        1";
    for (const order of orders([mid, "tieTwo(p, (action, 1))"])) expect([order, tieReports(outer(order))]).toEqual([order, []]);
    // An outer callback a later line ties to the same colour shares a tied
    // parameter with `f`: one report, in every order.
    for (const order of orders([inner, "tieTwo(p, (action, 1))", "tieTwo(h, action)"])) {
      const reports = tieReports(outer(order, "action: () ->! Unit, p, h, c: Bool"));
      expect([order, reports.map(({ at, labels }) => [at, labels])]).toEqual([order, [[
        "tieTwo(h, action)",
        ["h: `h` has no written type", "f: `f` has no written type"],
      ]]]);
    }
  });

  it("is one report per tie, whichever close finds each end of it (#1217)", () => {
    // `f` waits on `g`, which turns pure, but is tied to `action` either way:
    // it reads as its fix from `inner`'s close, so `fwd` does not meet the tie.
    const inner = "let inner = (f) => if c then f else () =>\n            g()\n            action!()";
    for (const order of orders([inner, "pureOnly(g)"])) {
      const reports = tieReports("let outer(action: () ->! Unit, g, c: Bool): Unit =\n" +
        [...order, "let fwd = (h) => inner(h)"].map((line) => `    ${line}\n`).join("") + "    ()\n");
      expect([order, reports.map(({ at, labels }) => [at, labels])]).toEqual([order, [[
        "if c then f else () =>\n            g()\n            action!()",
        ["f: `f` has no written type"],
      ]]]);
    }
    // Siblings tied to each other through a lambda join: each report names
    // the callback the next one is about, so they are one.
    for (const order of orders(["g!()", "let x = if c then f else () => g!()", "let y = if c then h else () => g!()"])) {
      const reports = tieReports("let outer(g, f, h, c: Bool): Unit =\n" +
        [...order, "x!()", "y!()"].map((line) => `    ${line}\n`).join("") + "    ()\n");
      expect([order, reports.map(({ labels, fixes }) => [labels, fixes])]).toEqual([order, [[
        ["g: `g` has no written type", "f: `f` has no written type", "h: `h` has no written type"],
        [": () ->! Unit", ": () ->! Unit", ": () ->! Unit"],
      ]]]);
    }
    // A tie its own body's close finds, whose other end waited on the body
    // around it: one report, in either order.
    const nested = "let inner = (f, k) => if c then f else () =>\n            g()\n            k!()";
    for (const order of orders([nested, "g()"])) {
      const reports = tieReports("let outer(g, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n");
      expect([order, reports.map(({ labels }) => labels)]).toEqual([order, [["f: `f` has no written type", "k: `k` has no written type"]]]);
    }
    // Two ties to the same written callback stay two reports.
    const other = "let other = (h) => if c then h else action";
    for (const order of orders(["g()", inner, other])) {
      const reports = tieReports("let outer(action: () ->! Unit, g, c: Bool): Unit =\n" + order.map((line) => `    ${line}\n`).join("") + "    ()\n");
      expect([order, reports.map(({ at }) => at).sort()]).toEqual([order, [
        "if c then f else () =>\n            g()\n            action!()",
        "if c then h else action",
      ]]);
    }
  });

  it("is refused in a lambda a knot holds, reading its member's facts", () => {
    expect(tieReports(`fun
    a(g, c: Bool, n: Int): Unit =
        g!()
        let inner = (f) =>
            b!(g, c, n - 1)
            if c then g else f
        ()
    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)
`).map(({ message }) => message)).toEqual([
      "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
    ]);
  });

  /** Every order of `lines` in member `a`, beside its sibling `b`, with the members in either order. */
  const knotOrders = (lines: readonly string[]): string[] => {
    const permutations = (rest: readonly string[]): string[][] =>
      rest.length === 0 ? [[]] : rest.flatMap((line, index) =>
        permutations([...rest.slice(0, index), ...rest.slice(index + 1)]).map((tail) => [line, ...tail])
      );
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    return permutations(lines).flatMap((order) => {
      const a = "    a(g, c: Bool, n: Int): Unit =\n" + order.map((line) => `        ${line}\n`).join("") + "        ()\n";
      return [`fun\n${a}${b}`, `fun\n${b}${a}`];
    });
  };

  it("in a lambda a knot holds, one report at the merge, whatever the order of the lines and members (#1215)", () => {
    for (
      const held of [
        // The held lambda's own parameter is tied.
        "let inner = (f) =>\n            b!(g, c, n - 1)\n            if c then g else f",
        // A lambda nested in the held one waits on it, and it on its member.
        "let hold = (z) =>\n            b!(g, c, n - 1)\n            let inner = (f) => if c then g else f\n            ()",
      ]
    ) {
      for (const program of knotOrders(["g!()", held])) {
        expect([program, tieReports(program)]).toEqual([program, [{
          at: "if c then g else f",
          message: "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
          labels: ["f: `f` has no written type", "g: `g` has no written type"],
          fixes: [": () ->! Unit", ": () ->! Unit"],
        }]]);
      }
    }
  });

  it("two held lambdas tied to their member's callback are one report, naming the first in source order (#1215)", () => {
    const inner = "let inner = (f) =>\n            b!(g, c, n - 1)\n            if c then g else f";
    const other = "let other = (h) => if c then g else h";
    for (const program of knotOrders(["g!()", inner, other])) {
      const reports = tieReports(program);
      const first = program.indexOf("inner =") < program.indexOf("other =") ? "f" : "h";
      expect([program, reports.map(({ message }) => message)]).toEqual([program, [
        `\`${first}\`'s colour is tied to \`g\`'s here, and inference cannot keep them apart — write \`${first}\`'s type, or wrap \`${first}\` where they meet`,
      ]]);
      // The named parameter first, then the others in source order.
      const second = first === "f" ? "h" : "f";
      expect([program, reports[0]!.labels]).toEqual([program, [
        `${first}: \`${first}\` has no written type`,
        "g: `g` has no written type",
        `${second}: \`${second}\` has no written type`,
      ]]);
    }
  });

  /** Every order of `lines`. */
  const orders = (lines: readonly string[]): string[][] =>
    lines.length === 0 ? [[]] : lines.flatMap((line, index) =>
      orders([...lines.slice(0, index), ...lines.slice(index + 1)]).map((rest) => [line, ...rest])
    );
  const tiedToK = {
    at: "if c then k else f",
    message: "`f`'s colour is tied to `k`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
    labels: ["f: `f` has no written type", "k: `k` has no written type"],
    fixes: [": () ->! Unit", ": () ->! Unit"],
  };

  it("a body around a held lambda reads its ties after the held lambda's, whatever body it is (#1215)", () => {
    // `p`, a plain lambda, a nested `fun` member and a lone `fun` member each
    // hold a lambda that calls the recursion; the tie to their own `k` waits
    // for the held lambda's, in every order of their lines and members.
    const hold = "let hold = (z) =>\n    b!(g, c, n - 1)\n    let inner = (f) => if c then k else f\n    ()";
    const indent = (text: string, by: string): string => text.split("\n").map((line) => by + line).join("\n");
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    const programs: string[] = [];
    for (const lines of orders([hold, "k!()"])) {
      const plain = "    a(g, c: Bool, n: Int): Unit =\n        g!()\n        let p = (k) =>\n" +
        lines.map((line) => indent(line, "            ")).join("\n") + "\n            ()\n        p!(g)\n";
      const nested = "    a(g, c: Bool, n: Int): Unit =\n        g!()\n        fun loop(k, m: Int): Unit =\n" +
        lines.map((line) => indent(line, "            ")).join("\n") +
        "\n            if m == 0 then () else loop!(k, m - 1)\n        loop!(g, n)\n";
      // A body that holds lambdas of two knots, an inner `fun`'s and the
      // enclosing block's, waits for the outer one, which closes last.
      const both = "    a(g, c: Bool, n: Int): Unit =\n        g!()\n        fun loop(m: Int): Unit =\n" +
        "            let p = (k) =>\n                let again = (z) => if m == 0 then () else loop!(m - 1)\n" +
        lines.map((line) => indent(line, "                ")).join("\n") + "\n                ()\n" +
        "            p!(g)\n        loop!(n)\n";
      for (const a of [plain, nested, both]) programs.push(`fun\n${a}${b}`, `fun\n${b}${a}`);
      programs.push("fun walk(g, c: Bool, n: Int): Unit =\n    let p = (k) =>\n" +
        lines.map((line) => indent(line.replace("b!(g, c, n - 1)", "walk!(g, c, n - 1)"), "        ")).join("\n") +
        "\n        ()\n    p!(g)\n");
    }
    for (const program of programs) expect([program, tieReports(program)]).toEqual([program, [tiedToK]]);
  });

  it("a held lambda's tie to the callback of a body around it is one report, however many tie (#1215)", () => {
    const inner = "let inner = (f) =>\n    b!(g, c, n - 1)\n    if c then k else f";
    const other = "let other = (h) => if c then k else h";
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    for (const lines of [...orders(["k!()", inner]), ...orders(["k!()", inner, other])]) {
      const a = "    a(g, c: Bool, n: Int): Unit =\n        g!()\n        let p = (k) =>\n" +
        lines.map((line) => line.split("\n").map((part) => "            " + part).join("\n")).join("\n") +
        "\n            ()\n        p!(g)\n";
      // One report, named for the first tied parameter in source order, `p`'s
      // `k` labelled next, and every other tied parameter after it.
      const first = !lines.includes(other) || lines.indexOf(inner) < lines.indexOf(other) ? "f" : "h";
      const labels = [`${first}: \`${first}\` has no written type`, "k: `k` has no written type"];
      if (lines.includes(other)) {
        const second = first === "f" ? "h" : "f";
        labels.push(`${second}: \`${second}\` has no written type`);
      }
      for (const program of [`fun\n${a}${b}`, `fun\n${b}${a}`]) {
        const reports = tieReports(program);
        expect([program, reports.length, reports[0]!.labels]).toEqual([program, 1, labels]);
      }
    }
  });

  it("a held lambda's own lines decide its tie in any order (#1215)", () => {
    // `g!()` inside the held lambda decides `g`, so the merge ties `f` to it,
    // whichever of the three lines comes first.
    const lines = ["b(g, c, n - 1)", "g!()", "let inner = (f) => if c then g else f"];
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a(g, c, n)\n";
    for (const order of orders(lines)) {
      const a = "    a(g, c: Bool, n: Int): Unit =\n        let hold = (z) =>\n" +
        order.map((line) => "            " + line).join("\n") + "\n            ()\n        ()\n";
      for (const program of [`fun\n${a}${b}`, `fun\n${b}${a}`]) {
        expect([program, tieReports(program)]).toEqual([program, [{
          at: "if c then g else f",
          message: "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
          labels: ["f: `f` has no written type", "g: `g` has no written type"],
          fixes: [": () ->! Unit", ": () ->! Unit"],
        }]]);
      }
    }
  });

  it("a body around a held lambda decides its ties where it closes, and reports them with the knot (#1215)", () => {
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    const both = (a: string): string[] => [`fun\n${a}${b}`, `fun\n${b}${a}`];
    // Its tie's fix reading holds when it generalizes, so a forwarder meets
    // the tie once, as outside a knot.
    for (const head of ["let choose = (d: Bool, f, e) =>", "fun choose(d: Bool, f, e): Unit ="]) {
      const a = `    a(g, c: Bool, n: Int): Unit =\n        g!()\n        ${head}\n            let h = if d then f else e\n` +
        "            h!()\n            let hold = (z) => b!(g, c, n - 1)\n            ()\n" +
        "        let fwd = (x, y) => choose!(True, x, y)\n        ()\n";
      for (const program of both(a)) {
        expect([program, tieReports(program).map(({ message }) => message)]).toEqual([program, [
          "`f`'s colour is tied to `e`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
        ]]);
      }
    }
    // A nested lambda's tie that reached it before it closed is decided there,
    // so a later use of an ungeneralized `q` neither moves it nor its labels.
    const used = "    a(g, c: Bool, n: Int): Unit =\n        g!()\n        let q = ident((k) =>\n            k!()\n" +
      "            let inner = (f) => if c then k else f\n            let hold = (z) => b!(g, c, n - 1)\n" +
      "            ())\n        q!(g)\n";
    for (const program of both(used)) {
      const reports = tieReports("let ident(x: t): t = x\n" + program);
      expect([program, reports[0]]).toEqual([program, {
        at: "if c then k else f",
        message: "`f`'s colour is tied to `k`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
        labels: ["f: `f` has no written type", "k: `k` has no written type"],
        fixes: [": () ->! Unit", ": () ->! Unit"],
      }]);
      expect([program, reports.slice(1).flatMap(({ labels }) => labels).filter((label) => label.startsWith("f"))])
        .toEqual([program, []]);
    }
    // Without the nested tie, the use's report labels only `g`.
    for (const program of both(used.replace("            let inner = (f) => if c then k else f\n", ""))) {
      expect([program, tieReports("let ident(x: t): t = x\n" + program).flatMap(({ labels }) => labels)])
        .toEqual([program, ["g: `g` has no written type", "g: `g` has no written type"]]);
    }
  });

  it("a held lambda's tie between its own callbacks reads as its fix where its text ends, as its plain twin's does, and stands (#1305, #1328)", () => {
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    const member = (lines: readonly string[]): string[] => {
      const a = "    a(g, c: Bool, n: Int): Unit =\n" + lines.map((line) => `        ${line}\n`).join("") + "        ()\n";
      return [`fun\n${a}${b}`, `fun\n${b}${a}`];
    };
    const atOf = (program: string) => tieReports("let ident(x: t): t = x\n" + program).map(({ at }) => at);
    // `q!(g, g)` comes after the lambda's text and before the knot closes:
    // `k` already reads as its fix there, so `g` meets no tie, as in the twin.
    const own = ["g!()", "let q = ident((k, h) =>", "    b!(g, c, n - 1)", "    k!()", "    let _ = if c then k else h",
      "    ())", "q!(g, g)"];
    for (const program of member(own)) expect([program, atOf(program)]).toEqual([program, ["if c then k else h"]]);
    // So with three callbacks.
    const three = ["g!()", "let q = ident((k, h, m) =>", "    b!(g, c, n - 1)", "    k!()", "    let _ = if c then k else h",
      "    let _ = if c then h else m", "    ())", "q!(g, g, g)"];
    for (const program of member(three)) expect([program, atOf(program)]).toEqual([program, ["if c then k else h"]]);
    // Not where a callback of the member around it shares the colour too: a
    // fact there may make it silent at the knot's close, and the tie must
    // still be reported, not read as its fix with no report left.
    const outward = ["g()", "let q = ident((k, h) =>", "    b(g, c, n - 1)", "    let _ = if c then k else h",
      "    let _ = if c then h else g", "    ())", "q(save0, noop)"];
    for (const program of member(outward.map((line) => line.replace("b!(", "b(")))) {
      const withSave = 'extern from "./world.js"\n    export fun save(s: String) ->! Unit\nlet save0(): Unit = save!("x")\n';
      const reports = compileFiles([["/world.js", ""], ["/main.hex", "module Main\n\n" + fixtures + withSave +
        "let ident(x: t): t = x\n" + program.replaceAll("a!(", "a(")]]).diagnostics.map(({ message }) => message);
      expect([program, reports.some((message) => message.includes("is tied to"))]).toEqual([program, true]);
    }
    // A bare call that silences the tied colour where the knot closes (the
    // member's `g()`, which `h` shares) does not dissolve the tie (#1328).
    const pinned = ["g()", "let q = ident((k, h) =>", "    b(g, c, n - 1)", "    let _ = if c then k else h",
      "    let _ = if c then h else g", "    ())", "q(noop, noop)"];
    for (const program of member(pinned)) {
      const text = "let ident(x: t): t = x\nlet noop(): Unit = ()\n" + program.replaceAll("a!(", "a(");
      expect([program, tieReports(text).map(({ at }) => at)]).toEqual([program, ["if c then k else h"]]);
    }
    // But a colour the held lambda's own bare call made silent is no tie,
    // there as in its twin: `k()` silences what `x` meets, and `h()` what `f`
    // meets (§3.4's own example, held).
    for (const lines of [
      ["let q = ident((k) =>", "    b(g, c, n - 1)", "    k()", "    let r = (x) =>", "        let _ = if c then x else k",
        "        ()", "    ())", "q(noop)"],
      ["let q = ident((h) =>", "    b(g, c, n - 1)", "    let inner = (f) => if c then h else f", "    h()", "    ())", "q(noop)"],
    ]) {
      for (const program of member(lines)) {
        const text = "let ident(x: t): t = x\nlet noop(): Unit = ()\n" + program.replaceAll("a!(", "a(");
        expect([program, tieReports(text)]).toEqual([program, []]);
      }
    }
    // The twin: the same lambda, no knot holding it.
    const twin = own.filter((line) => !line.includes("b!("));
    expect(atOf("let a(g, c: Bool, n: Int): Unit =\n" + twin.map((line) => `    ${line}\n`).join("") + "    ()\n"))
      .toEqual(["if c then k else h"]);
  });

  it("a later use neither moves a held lambda's tie nor joins another partner to it; a knot's demand stands at the function handed (#1329)", () => {
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    const member = (lines: readonly string[]): string[] => {
      const a = "    a(g, c: Bool, n: Int): Unit =\n" + lines.map((line) => `        ${line}\n`).join("") + "        ()\n";
      return [`fun\n${a}${b}`, `fun\n${b}${a}`];
    };
    // `k` waits on the member's `g` where the lambda's text ends; the later
    // `q!(g, g)` hands `h` the same value, which is no tie the text made: the
    // tie stands at the merge, with `g`, as in the twin.
    const waits = ["g!()", "let q = ident((k, h) =>", "    b!(g, c, n - 1)", "    k!()", "    let _ = if c then k else g", "    ())",
      "q!(g, g)"];
    for (const program of member(waits)) {
      const reports = tieReports("let ident(x: t): t = x\n" + program);
      expect([program, reports.map(({ at, message }) => [at, message.slice(0, message.indexOf(" here"))])]).toEqual([program, [
        ["if c then k else g", "`k`'s colour is tied to `g`'s"],
      ]]);
    }
    // A demand the knot records and compares at its close is reported at the
    // function handed, as in the twin.
    const handed = ["let m = () => b(g, c, n - 1)", "let q = ident((k, h) =>", "    m()", "    let _ = if c then k else h",
      "    let _ = if c then h else m", "    ())", "q(save0, noop)"];
    for (const program of member(handed)) {
      const world = 'extern from "./world.js"\n    export fun save(s: String) ->! Unit\nlet save0(): Unit = save!("x")\n';
      const text = "module Main\n\n" + fixtures + world + "let ident(x: t): t = x\nlet noop(): Unit = ()\n" + program.replaceAll("a!(", "a(");
      const at = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics
        .filter(({ message }) => message.includes("promises purity"))
        .map(({ primary }) => text.slice(primary.start.offset, primary.end.offset));
      expect([program, at]).toEqual([program, ["save0"]]);
    }
  });

  it("reads a held lambda's tie against the body it waits on as that body closed (#1220)", () => {
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    const member = (lines: readonly string[]): string[] => {
      const a = "    a(g, c: Bool, n: Int): Unit =\n" + lines.map((line) => `        ${line}\n`).join("") + "        ()\n";
      return [`fun\n${a}${b}`, `fun\n${b}${a}`];
    };
    const reportsOf = (program: string) => tieReports("let ident(x: t): t = x\n" + program);
    const tied = (parameter: string, other: string, at: string) => ({
      at,
      message: `\`${parameter}\`'s colour is tied to \`${other}\`'s here, and inference cannot keep them apart — ` +
        `write \`${parameter}\`'s type, or wrap \`${parameter}\` where they meet`,
      labels: [`${parameter}: \`${parameter}\` has no written type`, `${other}: \`${other}\` has no written type`],
      fixes: [": () ->! Unit", ": () ->! Unit"],
    });
    const onlyG = ["g: `g` has no written type", "g: `g` has no written type"];
    // `inner` calls the recursion, so the knot holds it, and its tie to `k`
    // reaches `k`'s body only at the knot's close, after `q!(g)` has bound
    // `k`'s colour to `g`'s. It stands at the merge, as outside a knot; the
    // use's report labels only `g` (`a`'s, and `b`'s, which hands it on).
    const held = ["g!()", "let q = ident((k) =>", "    k!()", "    let inner = (f) =>", "        b!(g, c, n - 1)",
      "        if c then k else f", "    ())", "q!(g)"];
    for (const program of member(held)) {
      const reports = reportsOf(program);
      expect([program, reports[0]]).toEqual([program, tied("f", "k", "if c then k else f")]);
      expect([program, reports.slice(1).flatMap(({ labels }) => labels)]).toEqual([program, onlyG]);
      // And its fix is a repair.
      const text = "module Main\n\nlet ident(x: t): t = x\n" + program;
      const edits = compileFiles([["/main.hex", text]]).diagnostics
        .flatMap(({ fixes }) => (fixes ?? []).flatMap((fix) => fix.edits))
        .sort((left, right) => right.span.start.offset - left.span.start.offset);
      let fixed = text;
      for (const edit of edits) fixed = fixed.slice(0, edit.span.start.offset) + edit.replacement + fixed.slice(edit.span.end.offset);
      expect([program, compileFiles([["/main.hex", fixed]]).diagnostics.map(({ message }) => message)]).toEqual([program, []]);
    }
    // So through two such bodies: `m!(k)` and `q!(g)` come after each closed.
    const twice = ["g!()", "let q = ident((k) =>", "    k!()", "    let m = ident((j) =>", "        j!()",
      "        let inner = (f) =>", "            b!(g, c, n - 1)", "            if c then j else f", "        ())",
      "    m!(k)", "    ())", "q!(g)"];
    for (const program of member(twice)) {
      expect([program, reportsOf(program)[0]]).toEqual([program, tied("f", "j", "if c then j else f")]);
    }
    // A sharing there at the body's close still sends the tie further out.
    const shared = [...held.slice(0, 6), "    let _ = if c then g else k", ...held.slice(6)];
    for (const program of member(shared)) {
      expect([program, reportsOf(program).map(({ at, labels }) => [at, labels])]).toEqual([program, [[
        "if c then g else k",
        ["k: `k` has no written type", "g: `g` has no written type", "f: `f` has no written type"],
      ]]]);
    }
    // Where the use's is the first bind after the close (a `var`, refused for
    // holding a function, is not instantiated), it is still a later line's.
    for (const program of member(held.map((line) => line.replace("let q = ident((k) =>", "var q = (k) =>")
      .replace("    ())", "    ()")))) {
      expect([program, reportsOf(program)[1]]).toEqual([program, tied("f", "k", "if c then k else f")]);
    }
    // What the body shared there is read whole: through a join `f` met...
    const runsBoth = ["    let inner = (f) =>", "        b!(g, c, n - 1)", "        let _ = if c then f else () =>",
      "            k!()", "            h!()", "        ()"];
    const join = ["g!()", "let q = ident((k, h) =>", "    k!()", "    h!()", ...runsBoth, "    ())", "q!(noop, g)"];
    for (const program of member(join)) {
      expect([program, reportsOf("let noop(): Unit = ()\n" + program)[0]!.labels]).toEqual([program, [
        "f: `f` has no written type",
        "k: `k` has no written type",
      ]]);
    }
    // ...whose part a line before the close bound to `g`...
    const bound = ["g!()", "let q = ident((k, h) =>", "    k!()", "    h!()", ...runsBoth, "    let _ = if c then h else g",
      "    ())", "q!(noop, noop)"];
    // ...and through the arrow of the function an enclosing callback returns.
    const returned = ["let r = g!()", "r!()", "let q = ident((k) =>", "    k!()", "    let inner = (f) =>",
      "        b!(g, c, n - 1)", "        if c then k else f", "    let _ = if c then g!() else k", "    ())", "q!(noop)"];
    for (const [lines, at, labels] of [
      [bound, "if c then h else g", ["h", "g", "f"]],
      [returned, "if c then g!() else k", ["k", "g", "f"]],
    ] as const) {
      for (const program of member(lines)) {
        expect([program, reportsOf("let noop(): Unit = ()\n" + program).map((report) => [report.at, report.labels])])
          .toEqual([program, [[at, labels.map((name) => `${name}: \`${name}\` has no written type`)]]]);
      }
    }
    // The callback it is tied to is the one it shared a colour with there:
    // `h`, though `q!(g, g)` (or a forwarder's `q!(x, x)`) has since made `k`
    // share it too.
    const second = ["g!()", "let q = ident((k, h) =>", "    k!()", "    h!()", "    let inner = (f) =>",
      "        b!(g, c, n - 1)", "        if c then h else f", "    ())"];
    for (const use of [["q!(g, g)"], ["let w = (x) =>", "    x!()", "    q!(x, x)", "w!(noop)"]]) {
      for (const program of member([...second, ...use])) {
        expect([program, reportsOf("let noop(): Unit = ()\n" + program)[0]]).toEqual([program, tied("f", "h", "if c then h else f")]);
      }
    }
    // Two such ties a later use merged stay two reports, each at its merge.
    const two = ["g!()", "let q = ident((k, h) =>", "    k!()", "    h!()", "    let i1 = (f1) =>", "        b!(g, c, n - 1)",
      "        if c then k else f1", "    let i2 = (f2) =>", "        b!(g, c, n - 1)", "        if c then h else f2", "    ())",
      "q!(g, g)"];
    for (const program of member(two)) {
      expect([program, reportsOf(program).slice(0, 2)]).toEqual([program, [
        tied("f1", "k", "if c then k else f1"),
        tied("f2", "h", "if c then h else f2"),
      ]]);
    }
    // `f` was no function at the close, and `q!(x, x)` makes it one with the
    // very type `k` had there: still a tie a later line made.
    const sameType = ["let q = ident((k, y) =>", "    k!()", "    let inner = (f) =>", "        b!(g, c, n - 1)",
      "        let _ = if c then y else f", "        ()", "    ())", "q!(g, g)"];
    for (const program of member(sameType)) {
      expect([program, reportsOf(program).map(({ labels }) => labels).find((labels) => labels.length > 1)]).toEqual([program, [
        "g: `g` has no written type",
        "y: `y` has no written type",
        "f: `f` has no written type",
      ]]);
    }
    // A tie a later line made is read now, by the body that line is in: `f`
    // was no function yet where `k`'s body closed.
    const later = ["g!()", "let q = ident((k, y) =>", "    k!()", "    let inner = (f) =>", "        b!(g, c, n - 1)",
      "        let _ = if c then y else f", "        ()", "    ())", "q!(g, g)"];
    for (const program of member(later)) {
      expect([program, reportsOf(program).map(({ at, labels }) => [at, labels]).sort()]).toEqual([program, [
        ["q!(g, g)", ["g: `g` has no written type"]],
        ["q!(g, g)", ["g: `g` has no written type", "y: `y` has no written type", "f: `f` has no written type"]],
      ]]);
    }
  });

  it("reads a held lambda's own tie where its text ends, as its plain twin does (#1246)", () => {
    const world = "extern from \"./world.js\"\n    export fun save(s: String) ->! Unit\n" +
      "let save0(): Unit = save!(\"x\")\nlet noop(): Unit = ()\nlet ident(x: t): t = x\n" +
      "record Box = { run: () ->! Unit }\nrecord PBox = { run: () -> Unit }\n";
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    const member = (lines: readonly string[]): string[] => {
      const a = "    a(g, c: Bool, n: Int): Unit =\n" + lines.map((line) => `        ${line}\n`).join("") + "        ()\n";
      return [`fun\n${a}${b}`, `fun\n${b}${a}`];
    };
    // The plain twin: the recursive call replaced by an impure one, so no knot
    // holds the lambda and it closes where its text ends.
    const twin = (lines: readonly string[]): string =>
      "let a(g, c: Bool, n: Int): Unit =\n" +
      lines.map((line) => `    ${line.replace("b!(g, c, n - 1)", "save!(\"x\")")}\n`).join("") + "    ()\n";
    const reportsOf = (program: string) => tieReports(world + program);
    const tied = (parameter: string, other: string, at: string) => ({
      at,
      message: `\`${parameter}\`'s colour is tied to \`${other}\`'s here, and inference cannot keep them apart — ` +
        `write \`${parameter}\`'s type, or wrap \`${parameter}\` where they meet`,
      labels: [`${parameter}: \`${parameter}\` has no written type`, `${other}: \`${other}\` has no written type`],
      fixes: [": () ->! Unit", ": () ->! Unit"],
    });
    const compilesFixed = (program: string): readonly string[] => {
      const text = "module Main\n\n" + fixtures + world + program;
      const edits = compileFiles([["/main.hex", text]]).diagnostics
        .flatMap(({ fixes }) => (fixes ?? []).flatMap((fix) => fix.edits))
        .sort((left, right) => right.span.start.offset - left.span.start.offset);
      let fixed = text;
      for (const edit of edits) fixed = fixed.slice(0, edit.span.start.offset) + edit.replacement + fixed.slice(edit.span.end.offset);
      return compileFiles([["/main.hex", fixed]]).diagnostics.map(({ message }) => message);
    };
    const useOfG = {
      at: "q!(g)",
      message: "`g`'s colour is tied to `k`'s here, and inference cannot keep them apart — write `g`'s type, or wrap `g` where they meet",
      labels: ["g: `g` has no written type"],
      fixes: [": () ->! Unit"],
    };
    // (a) The body around `inner` is the held one: `inner`'s tie to `k` is
    // read where that body's text ends, before `q!(g)` binds `k` to `g`. It
    // stands at the merge, labelled `f` and `k`, as in the twin, and `q!(g)`
    // keeps its own report (one for `a`'s `g`, one for `b`'s, as in #1220).
    const held = ["g!()", "let q = ident((k) =>", "    b!(g, c, n - 1)", "    k!()", "    let inner = (f) => if c then k else f",
      "    ())", "q!(g)"];
    expect(reportsOf(twin(held))).toEqual([tied("f", "k", "if c then k else f"), useOfG]);
    for (const program of member(held)) {
      expect([program, reportsOf(program)]).toEqual([program, [tied("f", "k", "if c then k else f"), useOfG, useOfG]]);
      expect([program, compilesFixed(program)]).toEqual([program, []]);
    }
    // (b) A later line pins the tied colour: `q!(g, g)` joins `k` with `h`,
    // which the merge below `i1` made impure. The tie stood where `i1`'s text
    // ended, so it is refused at the merge, as in the twin, not dissolved.
    const pinnedByJoin = ["g!()", "let q = ident((k, h) =>", "    k!()", "    h!()", "    let i1 = (f1) =>",
      "        b!(g, c, n - 1)", "        if c then k else f1", "    let _ = if c then h else (() => save!(\"y\"))", "    ())",
      "q!(g, g)"];
    // So where the use pins `k` to the constant itself...
    const pinnedByUse = ["g!()", "let q = ident((k) =>", "    k!()", "    let i1 = (f1) =>", "        b!(g, c, n - 1)",
      "        if c then k else f1", "    ())", "q!(save0)"];
    // ...and where the held lambda's tie is between its own two callbacks.
    const ownPinned = ["g!()", "let q = ident((k, h) =>", "    b!(g, c, n - 1)", "    k!()", "    h!()",
      "    let _ = if c then k else h", "    ())", "q!(save0, save0)"];
    for (const [lines, report] of [
      [pinnedByJoin, tied("f1", "k", "if c then k else f1")],
      [pinnedByUse, tied("f1", "k", "if c then k else f1")],
      [ownPinned, tied("k", "h", "if c then k else h")],
    ] as const) {
      expect(reportsOf(twin(lines))).toEqual([report]);
      for (const program of member(lines)) {
        expect([program, reportsOf(program)]).toEqual([program, [report]]);
        expect([program, compilesFixed(program)]).toEqual([program, []]);
      }
    }
    // A tie that waits for a parameter to become a function is read where the
    // text ends too: `f2` is one only once `k!()` (below it) shapes `k`, or,
    // nested, once `i1`'s merge (below `i2`) shapes `f1`. Each with the line
    // that shapes it above the nested lambda and below it; `i2` held or not.
    const shape = (above: boolean, use: string) => ["g!()", "let q = ident((k) =>", "    b!(g, c, n - 1)",
      ...(above ? ["    k!()"] : []), "    let i2 = (f2) => if c then k else f2", ...(above ? [] : ["    k!()"]), "    ())", use];
    const viaF1 = (above: boolean, held: boolean) => ["g!()", "let q = ident((k) =>", "    k!()", "    let i1 = (f1) =>",
      "        b!(g, c, n - 1)", ...(above ? ["        f1!()"] : []), "        let i2 = (f2) =>",
      ...(held ? ["            b!(g, c, n - 1)"] : []), "            if c then f1 else f2", ...(above ? [] : ["        f1!()"]),
      "        if c then k else f1", "    ())", "q!(save0)"];
    // ...and where only `i2` is held: `i1` closes where its text ends, and
    // `i2`'s tie reaches it at the knot's close, read as `i1` closed.
    const viaF1Inner = (above: boolean) => viaF1(above, true).filter((line, index) => index !== 4);
    const threeTied = {
      ...tied("f1", "k", "if c then k else f1"),
      labels: ["f1: `f1` has no written type", "k: `k` has no written type", "f2: `f2` has no written type"],
      fixes: [": () ->! Unit", ": () ->! Unit", ": () ->! Unit"],
    };
    for (const above of [true, false]) {
      const cases = [
        [shape(above, "q!(save0)"), [tied("f2", "k", "if c then k else f2")]],
        [shape(above, "q!(g)"), [tied("f2", "k", "if c then k else f2"), useOfG, useOfG]],
        ...[false, true].map((held) => [viaF1(above, held), [threeTied]] as const),
        [viaF1Inner(above), [threeTied]],
      ] as const;
      for (const [lines, reports] of cases) {
        // The twin gives the same reports, `q!(g)`'s once (#1220).
        expect([lines, reportsOf(twin(lines))]).toEqual([lines, reports.filter((each, index) => index < 2)]);
        for (const program of member(lines)) {
          expect([program, reportsOf(program)]).toEqual([program, reports]);
          expect([program, compilesFixed(program)]).toEqual([program, []]);
        }
      }
    }
    // A colour already a constant where the text ends is no tie, as in the
    // twin: a merge with an impure function, a pin inside the held lambda
    // above its merge, a `->!` field; and the pure constant, by a written
    // `->` or a `->` field, above the held lambda or below it.
    const constantBy = (pin: readonly string[], inside: readonly string[] = [], use = "q!(g)", below = false) => [
      "g!()", "let q = ident((k) =>", ...(use === "q!(g)" ? ["    k!()"] : []), ...(below ? [] : pin), "    let i1 = (f1) =>",
      "        b!(g, c, n - 1)", ...inside, "        if c then k else f1", ...(below ? pin : []), "    ())", use];
    const constants = [
      constantBy(["    let _ = if c then k else save0"]),
      constantBy([], ["        let _ = if c then f1 else save0"]),
      constantBy(["    let bx = Box({ run = k })"]),
      // A held lambda's own two callbacks, tied and then pinned where its text ends.
      ["g!()", "let q = ident((k, h) =>", "    b!(g, c, n - 1)", "    k!()", "    h!()", "    let _ = if c then k else h",
        "    let _ = if c then k else save0", "    ())", "q!(g, g)"],
      ...[false, true].flatMap((below) => [
        constantBy(["    let p: () -> Unit = k"], [], "q(noop)", below),
        constantBy(["    let bx = PBox({ run = k })"], [], "q(noop)", below),
      ]),
    ];
    for (const lines of constants) {
      expect([lines, reportsOf(twin(lines))]).toEqual([lines, []]);
      for (const program of member(lines)) expect([program, reportsOf(program)]).toEqual([program, []]);
    }
  });

  it("a member that hands its callback on is no tie where a sibling's ungeneralized lambda around a held one takes the written callback (#1244)", () => {
    // `b` only hands `g` on to `a`, and `hold` touches neither `g` nor `k`:
    // `k`'s written colour is the in-place lambda's own (#1250), so `q(g)`
    // meets an instance of it and `b`'s `g` is `a`'s, in either order.
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    const asWritten = ["g!()", "let q = ident((k: () ->! Unit) =>", "    let hold = (z) => b!(g, c, n - 1)", "    ())",
      "q(g)", "()"];
    const twins = [
      asWritten,
      // Without `hold`, the lambda the knot holds...
      asWritten.filter((line) => !line.includes("hold")),
      // ...with `k` untyped...
      asWritten.map((line) => line.replace("(k: () ->! Unit)", "(k)")),
      // ...and with `q` a generalized `let`.
      ["g!()", "let q = (k: () ->! Unit) =>", "    let hold = (z) => b!(g, c, n - 1)", "    ()", "q(g)", "()"],
    ];
    for (const lines of twins) {
      const a = "    a(g: () ->! Unit, c: Bool, n: Int): Unit =\n" + lines.map((line) => `        ${line}\n`).join("");
      for (const program of [`fun\n${a}${b}`, `fun\n${b}${a}`]) {
        const text = "module Main\n\nlet ident(x: t): t = x\n" + program;
        expect([program, compileFiles([["/main.hex", text]]).diagnostics.map(({ message }) => message)]).toEqual([program, []]);
      }
    }
  });

  it("a knot frame around a lambda an outer knot holds keeps the colours it noted at its own close (#1215)", () => {
    // `h1`'s own callback `k` is its own (#1231): `h1!(g)` meets an instance,
    // so the tie stands where `inner` merges `k` with `f`, as outside a knot,
    // and its fix compiles.
    const a = "    a(g, c: Bool, n: Int): Unit =\n        g!()\n        fun loop(m: Int): Unit =\n" +
      "            let h1 = (k) =>\n                if m == 0 then () else loop!(m - 1)\n                k!()\n" +
      "                let h2 = (z) =>\n                    b!(g, c, n - 1)\n" +
      "                    let inner = (f) => if c then k else f\n                    ()\n                ()\n" +
      "            h1!(g)\n        loop!(n)\n        ()\n";
    const b = "    b(g, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, c, n)\n";
    for (const program of [`fun\n${a}${b}`, `fun\n${b}${a}`]) {
      expect([program, tieReports(program).map(({ at, message, labels }) => [at, message, labels])]).toEqual([program, [[
        "if c then k else f",
        "`f`'s colour is tied to `k`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
        ["f: `f` has no written type", "k: `k` has no written type"],
      ]]]);
    }
  });

  it("reads a knot's ties only after every one of its frames has decided (#1215)", () => {
    // The held lambda's black box closes `g`'s arrow to the constant before
    // the member's ties are read, as outside a knot: no tie, in every order.
    const lines = ["g!()", "let _ = if c then g else h", "let inner = (f) =>\n            b!(g, h, c, n - 1)\n" +
      "            let _ = if c then f else () => Some(g)\n            ()"];
    const b = "    b(g, h, c: Bool, n: Int): Unit = if n == 0 then () else a!(g, h, c, n)\n";
    for (const order of orders(lines)) {
      const a = "    a(g, h, c: Bool, n: Int): Unit =\n" + order.map((line) => "        " + line).join("\n") + "\n        ()\n";
      for (const program of [`fun\n${a}${b}`, `fun\n${b}${a}`]) expect([program, tieReports(program)]).toEqual([program, []]);
    }
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
        "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
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
    // Two nested ties to one callback: one report, so `g`'s type is written once (#1163).
    expect(repaired("let outer(g, c: Bool): Unit =\n    g!()\n    let inner = (f) => if c then g else f\n" +
      "    let fwd = (h) => inner(h)\n    ()\n"))
      .toEqual({ fixes: ["write the types of `f`, `g` and `h`"], after: [] });
    // So where one is tied through a lambda that runs `g`, in every order of the lines.
    const lines = ["g!()", "let inner = (f) => if c then f else () => g!()", "let other = (h) => if c then g else h"];
    for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const source = "let outer(g, c: Bool): Unit =\n" + order.map((index) => `    ${lines[index]!}\n`).join("") + "    ()\n";
      const { fixes, after } = repaired(source);
      expect([order, fixes.length, after]).toEqual([order, 1, []]);
    }
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
      "`f`'s colour is tied to `outer`'s `f` here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
    ]);
    expect(tieReports(source.replace("inner(f)", "inner(f: () ->! Unit)"))).toEqual([]);
  });
});

describe("Effects §3.4 — a recursive call hands on the callbacks it was given (#1218)", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n";
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", prelude + source]]);
  const at = (source: string): readonly (readonly [string, string])[] => {
    const text = prelude + source;
    return compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics.map(({ primary, message }) =>
      [text.slice(primary.start.offset, primary.end.offset), message] as const
    );
  };
  const made = (caller: string, given: boolean): string =>
    given
      ? `this function is not one \`${caller}\` was given, and a recursive call hands on only the callbacks it was given`
      : `\`${caller}\` was given no callback, and a recursive call hands on only the callbacks it was given`;
  const named = (member: string): string =>
    `\`${member}\` takes callbacks, so inside its own recursion it is only called, by its name`;
  const applied = (member: string): string =>
    `\`${member}\` takes callbacks, so inside its own recursion it is applied in full where it is named, ` +
    "and this leaves a callback to give it";
  const members = (first: string, second: string): readonly string[] => [`fun\n${first}${second}`, `fun\n${second}${first}`];

  it("refuses a function made inside the recursion where it is handed, and that refusal stands alone", () => {
    // Monomorphic recursion would make the made function's colour every
    // call's; main accepted this with pure faces in one member order.
    const a = "    a(cb: () ->! Unit, n: Int): Unit =\n        if n == 0 then cb!() else a!(() => b(n), n - 1)\n";
    const b = "    b(n: Int): Unit = if n > 0 then a(save0, n - 1) else ()\n";
    for (const knot of members(a, b)) {
      expect([...at(knot + "export let probe(): Unit = b(1)\n")].sort()).toEqual([
        ["() => b(n)", made("a", true)],
        ["save0", made("b", false)],
      ]);
    }
  });

  it("lets nothing the refused knot's close would say through: no face, mark or tie report, in either order", () => {
    // Settled with `save0` in `h`'s callback, the close would report `h`'s
    // `>->` face, at a place that follows the order of the members.
    const h = "    h(n: Int, cb: () ->! Unit): () >-> Unit =\n        let g = () =>\n            cb!()\n" +
      "            let _ = if n == 0 then () else k(n)\n            ()\n        g\n";
    const k = "    k(n: Int): Unit =\n        h(n - 1, save0)()\n";
    for (const knot of members(h, k)) {
      expect(at(knot + "export let outside(): Unit = h(1, save0)()\n")).toEqual([["save0", made("k", false)]]);
    }
  });

  it("lets no tie of a refused knot through, though the tie is the knot's own", () => {
    const source = `fun b(f, g, c: Bool, n: Int): Unit =
    let h = if c then f else g
    h!()
    if n <= 0 then () else b!(f, g, c, n - 1)
    if n <= 0 then () else b!(() => (), g, c, n - 1)
`;
    expect(at(source)).toEqual([["() => ()", made("b", true)]]);
    expect(check(source.replace("    if n <= 0 then () else b!(() => (), g, c, n - 1)\n", ""))).toEqual([
      "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
    ]);
  });

  it("refuses it in one recursive function too, and offers the parameter a lambda only forwards to", () => {
    const source = `fun b(cb: () ->! Unit, n: Int): Unit =
    let h = () =>
        cb!()
        if n <= 0 then () else b(cb, n - 1)
    h()
    if n <= 0 then () else b(() => cb!(), n - 1)
    if n <= 0 then () else b(save0, n - 1)
`;
    expect(at(source)).toEqual([["() => cb!()", made("b", true)], ["save0", made("b", true)]]);
    expect(effectFixes([["/world.js", ""], ["/main.hex", prelude + source]])).toEqual(["hand `cb` on: \"cb\""]);
    // A lambda that does more than forward is no such function, and has no fixit.
    expect(effectFixes([["/world.js", ""], ["/main.hex", prelude + source.replace("() => cb!()", "() => save!(\"y\")")]]))
      .toEqual([]);
    // Handing `cb` on instead, the recursion compiles once its calls are marked.
    const handedOn = source.replace("b(() => cb!(), n - 1)", "b!(cb, n - 1)").replace("b(save0, n - 1)", "b!(cb, n - 1)")
      .replace("else b(cb, n - 1)", "else b!(cb, n - 1)").replace("    h()", "    h!()");
    expect(check(handedOn)).toEqual([]);
  });

  it("reads a nested recursion's call and the enclosing one's alike", () => {
    expect(at(`fun
    a(cb: () ->! Unit, n: Int): Unit =
        fun go(m: Int, f: () ->! Unit): Unit = if m == 0 then f!() else go!(m - 1, () => b(n))
        go!(n, cb)
    b(n: Int): Unit = if n > 0 then a(save0, n - 1) else ()
`)).toEqual([["() => b(n)", made("go", true)], ["save0", made("b", false)]]);
  });

  it("offers no fixit for a lambda that reorders what it forwards", () => {
    const source = `fun b(cb: (Int, Int) ->! Unit, n: Int): Unit =
    cb!(n, 1)
    if n <= 0 then () else b!((x, y) => cb!(y, x), n - 1)
`;
    expect(at(source)).toEqual([["(x, y) => cb!(y, x)", made("b", true)]]);
    expect(effectFixes([["/world.js", ""], ["/main.hex", prelude + source]])).toEqual([]);
    expect(effectFixes([["/world.js", ""], ["/main.hex", prelude + source.replace("cb!(y, x)", "cb!(x, y)")]]))
      .toEqual(["hand `cb` on: \"cb\""]);
  });

  it("reads a nested recursion's call to the enclosing one, and parameters handed on untyped", () => {
    // `go`'s knot is the innermost open one, and its call to `b` is the
    // enclosing knot's recursive call all the same.
    expect(at(`fun
    a(cb: () ->! Unit, n: Int): Unit =
        fun go(m: Int): Unit = if m == 0 then () else b!(() => (), m - 1)
        go!(n)
    b(cb: () ->! Unit, n: Int): Unit = if n > 0 then a!(cb, n - 1) else cb!()
`)).toEqual([["() => ()", made("a", true)]]);
    // Two untyped parameters, one handed on to the other, hold one function,
    // whatever they are called.
    const a = "    a(g, n: Int): Unit =\n        g!()\n        if n == 0 then () else b!(g, n - 1)\n";
    const b = "    b(h, n: Int): Unit =\n        if n == 0 then () else a!(h, n)\n";
    for (const knot of members(a, b)) expect(check(knot)).toEqual([]);
  });

  it("refuses naming a member that takes callbacks inside its recursion, so no alias carries a call", () => {
    const source = `fun b(cb: () ->! Unit, n: Int): Unit =
    let p = b
    cb!()
    if n <= 0 then () else p(save0, n - 1)
`;
    expect(at(source)).toEqual([["b", named("b")]]);
    expect(at(source.replace("let p = b", "let p = ident(b)").replace("fun b", "let ident(x: t): t = x\nfun b")))
      .toEqual([["b", named("b")]]);
    // A member that takes no callback has nothing to carry, and may be named.
    expect(check(`fun
    a(n: Int): Int =
        let p = b
        if n == 0 then 0 else p(n - 1)
    b(n: Int): Int = if n == 0 then 1 else a(n - 1)
`)).toEqual([]);
  });

  it("hands on a parameter in any position, by a pipe too, and a held or stored lambda that hands one on", () => {
    for (const knot of members(
      "    m(f: () ->! Unit, g: () ->! Unit, n: Int): Unit =\n        f!()\n        if n > 0 then s!(g, f, n - 1) else ()\n",
      "    s(f: () ->! Unit, g: () ->! Unit, n: Int): Unit =\n        let h = () => m!(f, g, n)\n        h!()\n",
    )) {
      expect(check(knot)).toEqual([]);
    }
    expect(check("fun walk(n: Int, f: () ->! Unit): Unit =\n    if n == 0 then f!() else (n - 1) |> walk!(f)\n")).toEqual([]);
    expect(at("fun walk(n: Int, f: () ->! Unit): Unit =\n    if n == 0 then f!() else (n - 1) |> walk!(save0)\n"))
      .toEqual([["save0", made("walk", true)]]);
    // The recursion stored, as `Seq` stores its `pull`, hands its callback on.
    expect(check(`record Stream = { pull: () -> Option((Int, Stream)) }
fun numbers(from: Int, f: Int -> Int): Stream =
    Stream({ pull = () => Some((f(from), numbers(from + 1, f))) })
`)).toEqual([]);
  });

  it("takes the callback in an enclosing function, where the recursion is handed nothing", () => {
    const source = `export let walk(n: Int, cb: () ->! Unit): Unit =
    fun
        even(k: Int): Unit = if k == 0 then cb!() else odd!(k - 1)
        odd(k: Int): Unit = if k == 0 then () else even!(k - 1)
    even!(n)
export let probe(): Unit = walk!(3, save0)
`;
    expect(check(source)).toEqual([]);
    expect(hoveredType(prelude + source, "walk(n")).toBe("(Int, () ->! Unit) >-> Unit");
  });

  it("never places a tie at a call that only hands parameters on, in either member order", () => {
    // A hand-on joins two names for one function: the tie stands at the merge
    // that made it, whichever member is read first.
    const a = "    a(action: () ->! Unit, c: Bool, n: Int): Unit =\n        action!()\n        let inner = (f) =>\n" +
      "            b!(action, c, n - 1)\n            if c then action else f\n        ()\n";
    const b = "    b(action: () ->! Unit, c: Bool, n: Int): Unit = if n == 0 then () else a!(action, c, n)\n";
    for (const knot of [...members(a, b), ...members(a.replace("b!(action,", "b!((action),"), b)]) {
      expect(at(knot)).toEqual([[
        "if c then action else f",
        "`f`'s colour is tied to `action`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
      ]]);
    }
  });

  it("reads a colour only parameters handed on share as each one's own, in every member order (#1215 (c))", () => {
    // `a`'s untyped `g` holds the function `b`'s written `g` holds: no tie.
    const a = "    a(g, n: Int): Unit =\n        g!()\n        if n == 0 then () else b!(g, n - 1)\n";
    const b = "    b(g: () ->! Unit, n: Int): Unit =\n        if n == 0 then () else a!(g, n)\n";
    for (const knot of members(a, b)) {
      expect(check(knot)).toEqual([]);
      expect(hoveredType(prelude + knot, "a(g, n")).toBe("(() ->! Unit, Int) >-> Unit");
    }
    // #1215 (c): a nested lambda's merge is a tie; its fix writes `f` and `a`'s
    // `g`, and the repaired program compiles in every line and member order.
    const tied = "    a(g, c: Bool, n: Int): Unit =\n        let inner = (f) => if c then g else f\n        b!(g, c, n - 1)\n        ()\n";
    const callee = "    b(g, c: Bool, n: Int): Unit =\n        g!()\n        if n == 0 then () else a!(g, c, n)\n";
    for (const knot of members(tied, callee)) {
      const text = prelude + knot;
      const diagnostics = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics;
      expect(diagnostics.map(({ message }) => message)).toEqual([
        "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
      ]);
      let fixed = text;
      for (const edit of diagnostics.flatMap(({ fixes }) => (fixes ?? []).flatMap((fix) => fix.edits))
        .sort((left, right) => right.span.start.offset - left.span.start.offset)) {
        fixed = fixed.slice(0, edit.span.start.offset) + edit.replacement + fixed.slice(edit.span.end.offset);
      }
      expect(compileFiles([["/world.js", ""], ["/main.hex", fixed]]).diagnostics).toEqual([]);
    }
  });

  it("reads every application of a curried member: a callback taken later is handed on as one taken first", () => {
    // The member returns the function that takes its callback. Main accepted
    // this with a pure face for `a`, in either member order, and ran `save0`.
    const a = "    a(n: Int): (() ->! Unit) -> Unit = (cb) => if n == 0 then cb!() else a(n - 1)(() => b(n))\n";
    const b = "    b(n: Int): Unit = if n > 0 then a(n - 1)(save0) else ()\n";
    for (const knot of members(a, b)) {
      expect([...at(knot)].sort()).toEqual([["() => b(n)", made("a", true)], ["save0", made("b", false)]]);
    }
    const one = `fun b(n: Int) = (cb: () ->! Unit) =>
    let h = () =>
        cb!()
        if n <= 0 then () else b(n - 1)(cb)
    h()
    if n <= 0 then () else b(n - 1)(() => cb!())
    if n <= 0 then () else b(n - 1)(save0)
`;
    expect(at(one)).toEqual([["() => cb!()", made("b", true)], ["save0", made("b", true)]]);
    // What the returned lambda was given is the member's to hand on, returned
    // as a block's last line too.
    expect(check("fun walk(n: Int) = (cb: () ->! Unit) =>\n    if n == 0 then cb!() else walk(n - 1)!(cb)\n"))
      .toEqual([]);
    expect(check("fun walk(n: Int) =\n    let m = n - 1\n    (cb: () ->! Unit) => if n == 0 then cb!() else walk(m)!(cb)\n"))
      .toEqual([]);
  });

  it("applies a curried member in full where it is named, and lets one hand back what takes no callback", () => {
    expect(at(`fun a(n: Int): (() ->! Unit) -> Unit = (cb) =>
    let r = a(n - 1)
    if n == 0 then cb!() else r(cb)
`)).toEqual([["a(n - 1)", applied("a")]]);
    expect(check(`fun later(cb: () ->! Unit, n: Int) = if n == 0 then () => cb!() else later(cb, n - 1)
export let probe(): Unit = later(save0, 2)!()
`)).toEqual([]);
  });

  it("refuses a member that hands back data holding a function that takes callbacks, in either member order", () => {
    // What is taken out of the result is the member's own callback-taker under
    // another name. Main accepted the pair in one member order, and ran `save0`.
    const handed = "`a` hands back data holding a function that takes callbacks, so inside its own recursion it is " +
      "not called";
    const a = "    a(n: Int) =\n        let run = (cb: () ->! Unit) =>\n            if n == 0 then cb!()\n            else\n" +
      "                let (r, _) = a(n - 1)\n                r(() => b(n))\n        (run, 1)\n";
    const b = "    b(n: Int): Unit =\n        if n > 0 then\n            let (r, _) = a(n - 1)\n            r(save0)\n        else ()\n";
    for (const knot of members(a, b)) expect(at(knot)).toEqual([["a(n - 1)", handed], ["a(n - 1)", handed]]);
    // Through an `Option` and an anonymous record too.
    expect(at(`fun
    a(n: Int) = Some((cb: () ->! Unit) =>
        if n == 0 then cb!()
        else
            match a(n - 1)
                Some(r) => r(() => b(n))
                None => ())
    b(n: Int): Unit =
        if n > 0 then
            match a(n - 1)
                Some(r) => r(save0)
                None => ()
        else ()
`)).toEqual([["a(n - 1)", handed], ["a(n - 1)", handed]]);
    const record = (member: string): string =>
      member.replace("let (r, _) = a(n - 1)", "let { go = r } = a(n - 1)").replace("(run, 1)", "{ go = run }");
    expect(at(members(record(a), record(b))[0]!)).toEqual([["a(n - 1)", handed], ["a(n - 1)", handed]]);
    // A generic union holding one in its payload, as the record spelling of the
    // same data does.
    const union = "union Cont(a) = K((a) ->! Unit) | Done\n";
    const contA = "    a(n: Int) =\n        K((cb) =>\n            if n == 0 then cb!()\n            else\n" +
      "                match a(n - 1)\n                    K(r) => r!(() => b(n))\n                    Done => ())\n";
    const contB = "    b(n: Int): Unit =\n        if n > 0 then\n            match a(n - 1)\n                K(r) => r!(save0)\n" +
      "                Done => ()\n        else ()\n";
    for (const knot of members(contA, contB)) {
      expect(at(union + knot).filter(([, message]) => message === handed)).toEqual([["a(n - 1)", handed], ["a(n - 1)", handed]]);
    }
    // Whatever else the module declares first, and in each instantiation a
    // value holds.
    const wrapped = "union Cont(a) = K((a) ->! Unit) | Done\nrecord W = { c: Cont(() ->! Unit) }\nfun\n    a(n: Int) =\n" +
      "        let k = K((cb: () ->! Unit) => cb!())\n        if n == 0 then W({ c = k }) else a(n - 1)\n";
    for (const before of ["", "union Pad0 = P0\n", "record Pad1 = { x: Int }\n"]) {
      expect(at(before + wrapped)).toEqual([["a(n - 1)", handed]]);
    }
    expect(at(`union Cont(a) = K((a) ->! Unit) | Done
fun
    a(n: Int) =
        let first: Cont(Int) = Done
        (first, K((cb) =>
            if n == 0 then cb!()
            else
                let (_, k) = a(n - 1)
                match k
                    K(r) => r!(() => ())
                    Done => ()))
`).filter(([, message]) => message === handed)).toEqual([["a(n - 1)", handed]]);
    // Data holding only a function that takes none is handed back as before.
    expect(check("fun count(cb: () ->! Unit, n: Int) = if n == 0 then (() => cb!(), 0) else count(cb, n - 1)\n"))
      .toEqual([]);
  });

  it("reads the types behind a recursive member's result a bounded number of times, however densely they name each other or deeply they nest", () => {
    // Every union names every other: read path by path, the walk is
    // exponential in the number of types.
    const names = Array.from({ length: 12 }, (_, index) => `T${index}`);
    const unions = names.map((name) =>
      `union ${name} = ${name}Leaf | ${names.map((other, index) => `${name}C${index}(${other}, Int)`).join(" | ")}\n`
    ).join("");
    expect(check(unions + "fun build(n: Int): T0 = if n == 0 then T0Leaf else T0C0(build(n - 1), n)\n")).toEqual([]);
    // Each level's argument is larger than the last's: a nested datatype.
    expect(check(
      "union Perfect(a) = Leaf(a) | Node(Perfect((a, a)))\n" +
        "fun times(t: Perfect(Int), n: Int): Perfect(Int) = if n == 0 then t else times(t, n - 1)\n",
    )).toEqual([]);
    expect(check(
      "record Nest(a) = { here: a, deeper: Option(Nest((a, a))) }\n" +
        "fun times(t: Nest(Int), n: Int): Nest(Int) = if n == 0 then t else times(t, n - 1)\n",
    )).toEqual([]);
  });

  it("reads a member's own parameters sharing a colour as a tie in either member order, however it came to be shared", () => {
    // Swapped back by a sibling, or handed twice into one slot: the shared
    // colour is the member's own two callbacks', which no written face can say.
    const pairs = [
      [
        "    a(f, g: () ->! Unit, n: Int): Unit = if n > 0 then b!(f, g, n - 1) else ()\n",
        "    b(p, q, n: Int): Unit = if n == 0 then p!() else a!(q, p, n - 1)\n",
      ],
      [
        "    a(f, g, n: Int): Unit = if n > 0 then b!(f, f, n - 1) else ()\n",
        "    b(p, q, n: Int): Unit =\n        p!()\n        q!()\n        if n == 0 then () else a!(p, q, n - 1)\n",
      ],
      [
        "    a(f, g, n: Int): Unit =\n        f!()\n        g!()\n        if n > 0 then b!(f, g, n - 1) else ()\n",
        "    b(p, q, n: Int): Unit = if n == 0 then p!() else a!(q, p, n - 1)\n",
      ],
    ] as const;
    for (const [a, b] of pairs) {
      expect(members(a, b).map((knot) => check(knot).some((message) => message.includes("inference cannot keep them apart"))))
        .toEqual([true, true]);
    }
  });

  it("reads a member's callbacks a written sibling hands back crossed as a tie in either member order (#1224)", () => {
    // `b` writes `p` and `q` and hands them back to `a` swapped, so `f` and
    // `g` hold each other's function by turns. Read where `a`'s own body
    // closed, before `b`'s was in, they had looked like their own.
    const b = "    b(act: () ->! Unit, p: () ->! Unit, q: () ->! Unit, c: Bool, n: Int): Unit =\n" +
      "        if n == 0 then p!() else a!(act, q, p, c, n - 1)\n";
    const tie = "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` " +
      "where they meet";
    for (const g of ["g", "g: () ->! Unit"]) {
      const a = `    a(act: () ->! Unit, f, ${g}, c: Bool, n: Int): Unit =\n        f!()\n        g!()\n` +
        "        if n > 0 then b!(act, f, g, c, n - 1) else ()\n";
      for (const knot of members(a, b)) expect([knot, check(knot)]).toEqual([knot, [tie]]);
    }
  });

  it("writes a tied callback silent only where every callback the recursion hands into its place is too (#1224)", () => {
    // `a` calls `f` bare, but `b` hands `g`'s function back into `f`'s place,
    // and `g`'s is any function, so by turns `f` holds one that may do
    // anything: its fix writes the constant, and the bare call keeps its own
    // report, in either member order.
    const a = "    a(f, g, n: Int): Unit =\n        f()\n        if n > 0 then b!(f, g, n - 1) else ()\n";
    const b = "    b(p, q, n: Int): Unit =\n        if n > 0 then a!(q, p, n - 1) else ()\n";
    const tie = (parameter: string, other: string): string =>
      `\`${parameter}\`'s colour is tied to \`${other}\`'s here, and inference cannot keep them apart — ` +
      `write \`${parameter}\`'s type, or wrap \`${parameter}\` where they meet`;
    for (const knot of members(a, b)) {
      const reports = compileFiles([["/world.js", ""], ["/main.hex", prelude + knot]]).diagnostics
        .map(({ message, fixes }) => [message, (fixes ?? []).flatMap((fix) => fix.edits.map((edit) => edit.replacement))])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
      expect([knot, reports]).toEqual([knot, [
        [tie("f", "g"), [": () ->! Unit", ": () ->! Unit"]],
        [tie("p", "q"), [": () ->! Unit", ": () ->! Unit"]],
        ["this call is impure and may fail, so `f` wants `!`, not no mark", ["!"]],
      ].sort((left, right) => String(left[0]).localeCompare(String(right[0])))]);
    }
  });

  it("follows the recursion's hand-ons into a curried member's later places too (#1224)", () => {
    // `a` hands `f` to `b`'s first application and `g` to its second; `b`
    // hands `q` back into `f`'s place and `p` into `g`'s. `f` holds `q`'s
    // function by turns, and `q` holds `g`'s, which `a` marks: so `f` and `q`,
    // though each is called bare, are written impure, and keep their reports.
    const a = "    a(n: Int, f) = (g) =>\n        f()\n        g!()\n        if n > 0 then b(n - 1, f)!(g) else ()\n";
    const b = "    b(n: Int, p) = (q) =>\n        q()\n        if n > 0 then a(n - 1, q)!(p) else ()\n";
    for (const knot of members(a, b)) {
      const reports = compileFiles([["/world.js", ""], ["/main.hex", prelude + knot]]).diagnostics;
      const written = reports.filter(({ message }) => message.includes("inference cannot keep them apart"))
        .flatMap(({ fixes }) => (fixes ?? []).flatMap((fix) => fix.edits.map((edit) => edit.replacement)));
      expect([knot, [...new Set(written)]]).toEqual([knot, [": () ->! Unit"]]);
      const marks = reports.filter(({ message }) => message.startsWith("this call is impure"))
        .map(({ message }) => message).sort();
      expect([knot, marks]).toEqual([knot, [
        "this call is impure and may fail, so `f` wants `!`, not no mark",
        "this call is impure and may fail, so `q` wants `!`, not no mark",
      ]]);
    }
  });

  it("reads a curried member's callbacks a sibling hands back crossed as its uncurried twin does, in either member order (#1337)", () => {
    // The lambda `a`'s value hands back takes the member's own parameters, so
    // they are read once every member's body is in, as `a(f, g, n: Int)`'s
    // are: `b` hands them back crossed, and they are tied whichever member
    // comes first.
    const curried = [
      "    a(n: Int) = (f, g) =>\n        f()\n        g!()\n        if n > 0 then b(n - 1)!(f, g) else ()\n",
      "    b(n: Int) = (p, q) =>\n        q()\n        if n > 0 then a(n - 1)!(q, p) else ()\n",
    ] as const;
    const twin = [
      "    a(f, g, n: Int): Unit =\n        f()\n        g!()\n        if n > 0 then b!(f, g, n - 1) else ()\n",
      "    b(p, q, n: Int): Unit =\n        q()\n        if n > 0 then a!(q, p, n - 1) else ()\n",
    ] as const;
    const read = (knots: readonly string[]) => knots.map((knot) => [...check(knot)].sort());
    const twins = read(members(...twin));
    expect(read(members(...curried))).toEqual(twins);
    expect(twins[0]!.filter((message) => message.includes("inference cannot keep them apart")).length).toBe(2);
    // Curried twice: both lambdas the value hands back take the member's
    // parameters, so a lone member reads as `a(f, g, n: Int)` does.
    expect(check("fun\n    a(n: Int) = (f) => (g) =>\n        f!()\n        g!()\n        if n > 0 then a(n - 1)(f)!(g) else ()\n"))
      .toEqual(check("fun\n    a(f, g, n: Int): Unit =\n        f!()\n        g!()\n        if n > 0 then a!(f, g, n - 1) else ()\n"));
  });

  it("reads a sibling's bare call as no fact about a colour two of a member's own callbacks share, in either member order (#1336)", () => {
    // `b` hands its one `p` into both of `a`'s places, so `a`'s `f` and `g`
    // share a colour: `p()` says `p`'s function is pure, and nothing of `g`'s,
    // whichever member is read first. The tie stands, and `p()` keeps its
    // report.
    const a = "    a(f, g, n: Int): Unit =\n        f()\n        g!()\n        if n > 0 then b!(f, n - 1) else ()\n";
    const b = "    b(p, n: Int): Unit =\n        p()\n        if n > 0 then a!(p, p, n - 1) else ()\n";
    const tie = "`f`'s colour is tied to `g`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` " +
      "where they meet";
    for (const knot of members(a, b)) {
      expect([knot, [...check(knot)].sort()]).toEqual([knot, [
        tie,
        "this call is impure and may fail, so `p` wants `!`, not no mark",
      ].sort()]);
    }
    // With nothing marking the colour, the sibling read first leaves it to
    // `a`, which decides it: no order names a bare call as a type it met.
    const bare = "    a(f, g, n: Int): Unit =\n        f()\n        g()\n        if n > 0 then b(f, n - 1) else ()\n";
    const quiet = "    b(p, n: Int): Unit =\n        if n > 0 then a(p, p, n - 1) else ()\n";
    const [first, second] = members(bare, quiet).map((knot) => [...check(knot + "export let probe(): Unit = a!(noop, save0, 2)\n")].sort());
    expect(second).toEqual(first);
    expect(first!.some((message) => message.includes("meets a type"))).toBe(false);
  });

  it("reads a colour two members' own callbacks share as no type met, in either member order (#1344)", () => {
    // `a`'s merge makes `f` and `g` one colour, and the recursion hands it to
    // `b`'s `p` and `q`, so both members' own callbacks share it. Nothing marks
    // it, so it is silent whichever member decides it, and the member read
    // second does not take that decision for a type its callback met.
    const a = "    a(f, g, n: Int): Unit =\n        let h = if n > 0 then f else g\n        h()\n        f()\n        g()\n" +
      "        if n > 0 then b(f, g, n - 1) else ()\n";
    const b = "    b(p, q, n: Int): Unit =\n        if n > 0 then a(p, q, n - 1) else ()\n";
    const [first, second] = members(a, b).map((knot) => [...check(knot + "export let probe(): Unit = a!(noop, save0, 2)\n")].sort());
    expect(second).toEqual(first);
    expect(first!.some((message) => message.includes("meets a type"))).toBe(false);
    // A curried member's inner lambda is the member's too: the default its
    // outer frame takes is no type `g` met there either, as the twin without
    // the recursion reads it.
    const curried = "fun\n    a(f, n: Int) =\n        (g) =>\n            let h = if n > 0 then f else g\n            h()\n" +
      "            f()\n            g()\n            if n > 0 then a(f, n - 1)(g) else ()\n";
    const twin = "let a(f, n: Int) =\n    (g) =>\n        let h = if n > 0 then f else g\n        h()\n        f()\n        g()\n";
    const probe = "export let probe(): Unit = a(noop, 2)!(save0)\n";
    expect([...check(curried + probe)].sort()).toEqual([...check(twin + probe)].sort());
  });

  it("reads a merge with the member's own written parameter as a tie, in either member order", () => {
    // The colour `f` shares with `act` is not one only handing on made, so it
    // is a tie whichever member is read first.
    const b = "    b(act: () ->! Unit, g: () ->! Unit, n: Int): Unit = a!(act, g, n)\n";
    const a = "    a(act: () ->! Unit, f, n: Int): Unit =\n        (if n > 1 then act else f)!()\n" +
      "        if n > 0 then b!(act, f, n - 1) else ()\n";
    for (const knot of members(a, b)) {
      expect(at(knot)).toEqual([[
        "if n > 1 then act else f",
        "`f`'s colour is tied to `act`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
      ]]);
    }
  });

  it("stands alone outside the knot too: at a caller's callers, around a nested knot, and beside its types", () => {
    const a = "fun\n    a(cb: () ->! Unit, n: Int): Unit =\n        if n == 0 then cb!() else a!(() => cb!(), n - 1)\n";
    // `user`'s colour is one the refused knot decided, so a call to it owes no
    // mark either.
    expect(at(a + "let user(): Unit = a!(save0, 1)\nexport let probe(): Unit = user!()\n"))
      .toEqual([["() => cb!()", made("a", true)]]);
    // Nor where a pure demand reads it, though the refused hand-off made its
    // colour the world's.
    expect(at(`fun a(cb: () ->! Unit, n: Int): Unit = if n == 0 then cb!() else a!(save0, n - 1)
let pureOnly(f: () -> Unit): Unit = f()
export let probe(): Unit = pureOnly(() => a(noop, 1))
`)).toEqual([["save0", made("a", true)]]);
    // Nor at a call inside a lambda handed to it: that lambda is handed the
    // colours the refused recursion decided.
    expect(at(`fun a(k: (() ->! Unit) ->! Unit, n: Int): Unit = if n == 0 then k!(save0) else a!((f) => f!(), n - 1)
let user(): Unit = a!((g) => g!(), 1)
export let probe(): Unit = user!()
`)).toEqual([["(f) => f!()", made("a", true)]]);
    // The knot's types are read as written, its colours not.
    expect(check(a + "let user(): Int = a!(save0, 1)\n")).toEqual([
      made("a", true),
      "type mismatch: expected Int, found Unit",
    ]);
    // A tie the refused call made in the body around the knot is a tie as any
    // is, and is not hidden; nor is a mark a binding owes on its own account,
    // nor a tie a merge made. It stands at the recursive call that made it:
    // `go`'s written `f` is its type from where the knot opens (#1279).
    expect(at(`let walk(cb, n: Int): Unit =
    fun go(m: Int, f: () ->! Unit): Unit = if m == 0 then f!() else go!(m - 1, () => cb!())
    go!(n, noop)
export let probe(): Unit = walk!(save0, 2)
`)).toEqual([
      [
        "go!(m - 1, () => cb!())",
        "`cb`'s colour is tied to `f`'s here, and inference cannot keep them apart — write `cb`'s type, or wrap `cb` where they meet",
      ],
      ["() => cb!()", made("go", true)],
    ]);
    expect(at(a + "let user(): Unit =\n    let _ = (a, 1)\n    save!(\"u\")\nexport let probe(): Unit = user()\n")).toEqual([
      ["() => cb!()", made("a", true)],
      ["user()", "this call is impure and may fail, so `user` wants `!`, not no mark"],
    ]);
    expect(at(`let walk(g, h, c: Bool, n: Int): Unit =
    fun go(m: Int, f: () ->! Unit): Unit = if m == 0 then f!() else go!(m - 1, () => g!())
    go!(n, noop)
    let k = if c then g else h
    k!()
`)).toEqual([
      ["() => g!()", made("go", true)],
      ["if c then g else h", "`g`'s colour is tied to `h`'s here, and inference cannot keep them apart — write `g`'s type, or wrap `g` where they meet"],
    ]);
  });

  it("hands on a parameter in parentheses, under an ascription or through a `let`, and calls a member in parentheses", () => {
    for (const handed of ["(cb)", "(cb: () ->! Unit)", "k"]) {
      expect(check(`fun walk(cb: () ->! Unit, n: Int): Unit =
    let k = cb
    if n > 0 then walk!(${handed}, n - 1) else k!()
`)).toEqual([]);
    }
    expect(check("fun walk(cb: () ->! Unit, n: Int): Unit = if n > 0 then (walk)!(cb, n - 1) else cb!()\n"))
      .toEqual([]);
    expect(check(
      "fun walk(cb: () ->! Unit, n: Int): Unit = if n > 0 then (walk: (() ->! Unit, Int) >-> Unit)!(cb, n - 1) else cb!()\n",
    )).toEqual([]);
    expect(check("fun walk(n: Int) = (cb: () ->! Unit) => if n == 0 then cb!() else ((n - 1) |> walk)!(cb)\n"))
      .toEqual([]);
    // A callback the enclosing function was given is captured, and not one the
    // recursion was given.
    expect(at(`let walk(cb: () ->! Unit, n: Int): Unit =
    fun go(m: Int, f: () ->! Unit): Unit = if m == 0 then f!() else go!(m - 1, cb)
    go!(n, cb)
`)).toEqual([["cb", made("go", true)]]);
  });
});

describe("Effects §3.4 — a knot's facts decide together, and one fact is one report (#1240, #1310)", () => {
  const prelude = "module Main\n\n" + 'extern from "./world.js"\n    export fun log(s: String) ->~ Unit\n' +
    "    export fun save(s: String) ->! Unit\n    export fun parse(s: String) ->^ Int\n" +
    "let noop(): Unit = ()\nlet log0(): Unit = log~(\"x\")\nlet save0(): Unit = save!(\"x\")\n" +
    "let oops0(): Unit =\n    let n = parse^(\"1\")\n    ()\nlet ident(x: t): t = x\nlet pureOnly(f: () -> Unit): Unit = f()\n";
  type Shown = { readonly at: string; readonly message: string; readonly fixes: readonly string[] };
  const diagnostics = (text: string) => compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics;
  /** The line of the source, after the prelude, an offset stands on. */
  const line = (text: string, offset: number): string => `L${text.slice(prelude.length, offset).split("\n").length}`;
  /** Every report: where it stands, what it says, and its fixes' names. */
  const reports = (source: string): readonly Shown[] => {
    const text = prelude + source;
    return diagnostics(text).map((diagnostic) => ({
      at: `${line(text, diagnostic.primary.start.offset)} ${text.slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset)}`,
      message: diagnostic.message,
      fixes: (diagnostic.fixes ?? []).map(({ message }) => message),
    }));
  };
  /** Every label of every report, in order. */
  const labels = (source: string): readonly string[] =>
    diagnostics(prelude + source).flatMap((diagnostic) => (diagnostic.labels ?? []).map(({ message }) => message));
  /** What the program reports once one fix of one of its reports is applied. */
  const fixed = (source: string, report: number, fix: number): readonly string[] => {
    let text = prelude + source;
    const edits = [...diagnostics(text)[report]!.fixes![fix]!.edits]
      .sort((left, right) => right.span.start.offset - left.span.start.offset);
    for (const edit of edits) text = text.slice(0, edit.span.start.offset) + edit.replacement + text.slice(edit.span.end.offset);
    return diagnostics(text).map(({ message }) => message);
  };
  const both = (first: string, second: string): readonly [string, string] =>
    [`fun\n${first}${second}`, `fun\n${second}${first}`];
  const handed = "this function is impure and may fail, where the function handed must be pure and unable to fail";
  const over = (callee: string) => `this call is pure and cannot fail, so \`${callee}\` wants no mark, not \`!\``;

  it("decides a colour one member reads bare and another marks by the bare call, in either member order", () => {
    // `pong`'s bare `ping(n - 1, act)` makes `act` pure (R2). The marks and the
    // probe handing `save0` contradict it: one report, at the first of them in
    // source order, the rest labels; marking the bare call repairs every one.
    const pong = "    pong(n: Int, act): Int = if n > 0 then ping(n - 1, act) else 0\n";
    const ping = "    ping(n: Int, act): Int =\n        let q = (cc: () ->! Unit) =>\n            cc!()\n" +
      "            let _ = if n > 0 then pong!(n - 1, act) else 0\n            ()\n        q!(act)\n        0\n";
    const probe = "export let probe(): Int = ping!(2, save0)\n";
    const [pingFirst, pongFirst] = both(ping, pong);
    for (const [knot, first] of [[pingFirst, "L5 !"], [pongFirst, "L6 !"]] as const) {
      // Not "remove the marks": handing `save0` is no claim a fix removes.
      expect(reports(knot + probe)).toEqual([{
        at: first,
        message: over("pong") + " — `ping` is called bare, which makes `act` pure and unable to fail",
        fixes: ["mark the call of `ping` `!`"],
      }]);
      expect(labels(knot + probe)).toEqual(expect.arrayContaining([
        "called bare here",
        "`q` wants no mark, not `!`",
        "`ping` wants no mark, not `!`",
        "a function that is impure and may fail is handed here",
      ]));
      expect(fixed(knot + probe, 0, 0)).toEqual([]);
    }
  });

  it("decides an annotation-free knot's held lambda by every member's facts, in either member order (#1286)", () => {
    // `pass` hands back `() => k()`: its bare `k()` makes `k` pure, read
    // before `useF`, which closes first as written, decides the colour.
    const useF = "    useF(p, k) =\n        let f = pass(k, p)\n        ()\n";
    const pass = "    pass(k, n) =\n        useF(n, k)\n        () => k()\n";
    for (const knot of both(useF, pass)) {
      expect(reports("let noop2(): Unit = ()\n" + knot + "export let user(): Unit = useF(1, noop2)\n")).toEqual([]);
    }
  });

  it("names the parameter of the member that wrote the fact, whichever member decides it", () => {
    const pong = "    pong(n: Int, f): Int = if n > 0 then ping(n - 1, f) else 0\n";
    const ping = "    ping(n: Int, act): Int =\n        let q = (cc: () ->! Unit) =>\n            cc!()\n" +
      "            let _ = if n > 0 then pong!(n - 1, act) else 0\n            ()\n        q!(act)\n        0\n";
    for (const knot of both(ping, pong)) {
      // Both marks are the fact's checks: one report, and where every check
      // is a mark, removing them is offered too.
      expect(reports(knot).map(({ message, fixes }) => [message, fixes])).toEqual([[
        over("pong") + " — `ping` is called bare, which makes `f` pure and unable to fail",
        ["mark the call of `ping` `!`", "remove the marks"],
      ]]);
    }
  });

  it("marks every call that makes the fact where several do, and that repairs each report", () => {
    const pong = "    pong(n: Int, act): Int = if n > 0 then ping(n - 1, act) else 0\n";
    const ping = "    ping(n: Int, act): Int =\n        let q = (cb: () ->! Unit) =>\n            cb!()\n" +
      "            let _ = if n > 0 then pong(n - 1, act) else 0\n            act()\n            ()\n" +
      "        q!(noop)\n        0\n";
    const probe = "export let probe(): Unit =\n    let _ = ping!(2, save0)\n    ()\n";
    for (const knot of both(ping, pong)) {
      const shown = reports(knot + probe);
      expect(shown.map(({ fixes }) => fixes.at(-1))).toEqual(
        shown.map(() => "mark every call that makes `act` pure and unable to fail"),
      );
      for (const [report, { fixes }] of shown.entries()) expect(fixed(knot + probe, report, fixes.length - 1)).toEqual([]);
    }
  });

  it("reads no fact through a colour the writing member's own parameters share", () => {
    const a = "    a(f, n: Int): Unit = if n > 0 then b!(f, f, n - 1) else f!()\n";
    const b = "    b(g, h, n: Int): Unit =\n        let k = if n > 0 then g else h\n        k()\n        if n > 0 then a!(g, n) else ()\n";
    for (const knot of both(a, b)) {
      expect(reports(knot + "export let probe(): Unit = a!(save0, 2)\n").map(({ message }) => message)).toEqual([
        "`g`'s colour is tied to `h`'s here, and inference cannot keep them apart — write `g`'s type, or wrap `g` where they meet",
        "this call is impure and may fail, so `k` wants `!`, not no mark",
      ]);
    }
  });

  it("makes one report of a world fact and a fail fact that one check fails, in either member order", () => {
    // `b^(…)` makes `act` pure, and the bare `act()` makes it unable to fail;
    // the probe fails both, so they are one report, whichever member is first.
    const a = "    a(n: Int, act): Int =\n        let _ = if n > 0 then b^(n - 1, act) else 0\n        0\n";
    const b = "    b(n: Int, act): Int =\n        act()\n        if n > 0 then a!(n - 1, act) else 0\n";
    const probe = "export let probe(): Int = a!(2, save0)\n";
    for (const knot of both(a, b)) {
      const shown = reports(knot + probe);
      expect(shown).toHaveLength(1);
      expect(shown[0]!.fixes[0]).toBe("mark every call that makes `act` pure and unable to fail");
      expect(labels(knot + probe)).toContain("a function that is impure and may fail is handed here");
      expect(fixed(knot + probe, 0, 0)).toEqual([]);
    }
  });

  it("explains a mark from the callee's declaration where its colour joins the fact with another", () => {
    // `tw`'s colour is `f`'s and `g`'s together, so the fact leaves no trace in
    // it; `tw`'s declaration still says `f` is called bare, and `save0` is
    // handed to `f`. Marking `f()` repairs both reports.
    const source = "let tw(f, g) =\n    f()\n    g^()\n    0\nexport let p(): Int = tw!(save0, noop)\n";
    expect(reports(source)).toEqual([
      { at: "L5 !", message: over("tw") + " — `f` is called bare, which makes it pure and unable to fail", fixes: ["mark the call of `f` `!`"] },
    ]);
    expect(labels(source)).toEqual(["called bare here", "a function that is impure and may fail is handed here"]);
    expect(fixed(source, 0, 0)).toEqual([]);
  });

  it("names no fact where the function handed does nothing there", () => {
    // `a!` claims what nothing it runs does: `save0` goes to `f`, which nothing
    // runs, and `noop`, which is pure, to `g`. No fact is named, so the removal
    // is a suggestion (Declarations Preamble §1.1).
    const source = "fun\n    a(f, g, n: Int): Int = if n > 0 then b(f, g, n - 1) else 0\n" +
      "    b(f, g, n: Int): Int =\n        g^()\n        if n > 0 then a(f, g, n - 1) else 0\n" +
      "export let p(): Int = a!(save0, noop, 2)\n";
    expect(reports(source).at(-1)).toEqual({
      at: "L6 !",
      message: pureAndTotal(over("a")),
      fixes: ["perhaps remove the mark"],
    });
  });

  it("offers a removal no cause explains as a suggestion, and gives only the first (Declarations Preamble §1.1)", () => {
    // `tw` calls `f` bare, so `fwd(k) = tw(k)` is pure, and `fwd!(save0)`'s
    // mark is true at run time: no fact, demand or limitation is named.
    const fwd = "let tw(f) =\n    f()\n    0\nlet fwd(k) = tw(k)\n";
    const hedged = pureAndTotal(over("fwd"));
    const one = fwd + "export let p(): Int = fwd!(save0)\n";
    expect(reports(one).map(({ message }) => message)).toContain(hedged);
    const fixesOf = diagnostics(prelude + one).flatMap((diagnostic) => diagnostic.fixes ?? [])
      .filter(({ message }) => message === "perhaps remove the mark");
    expect(fixesOf.map(({ suggestion }) => suggestion)).toEqual([true]);
    // Only the first such report in source order is given; the rest wait.
    const two = fwd + "export let p(): Int = fwd!(save0)\nexport let q(): Int = fwd!(log0)\n";
    expect(reports(two).filter(({ message }) => message.includes("perhaps")).map(({ at }) => at)).toEqual(["L5 !"]);
    // Where the text shows why the call is silent but the report names no
    // cause, the removal is a suggestion all the same.
    const plain = "export let p(): Unit = noop!()\n";
    expect(reports(plain)).toEqual([{ at: "L1 !", message: pureAndTotal(over("noop")), fixes: ["perhaps remove the mark"] }]);
    // A part the call wants that the mark lacks stays a fix; only the whole
    // mark is a suggestion: `log0` is impure, and nothing named says why it
    // cannot fail.
    const partly = "export let p(): Unit = log0^()\n";
    const partlyFixes = diagnostics(prelude + partly).flatMap((diagnostic) => diagnostic.fixes ?? []);
    expect(partlyFixes.map(({ message, suggestion }) => [message, suggestion === true])).toEqual([
      ["mark the call `!`", false],
      ["perhaps mark the call `~`", true],
    ]);
    // A report with a part the call certainly wants is always given, even
    // after another report that names no cause.
    const after = "export let p(): Unit = noop!()\nexport let q(): Unit = log0^()\n";
    expect(reports(after).map(({ at }) => at)).toEqual(["L1 !", "L2 ^"]);
  });

  it("explains each colour on its own: a part the fact does not explain keeps its own report", () => {
    // `log0` is impure but cannot fail: the fact explains the world part of
    // `tw!`, and once `f` is marked, the fail part is reported on its own.
    const source = "let tw(f) =\n    f()\n    0\nexport let p(): Int = tw!(log0)\n";
    expect(reports(source).map(({ message }) => message)).toEqual([over("tw") + " — `f` is called bare, which makes it pure"]);
    expect(fixed(source, 0, 0)).toEqual([perhaps("this call cannot fail, so `tw` wants `~`, not `!`", "may fail", "unable to fail")]);
  });

  it("names a fact only where marking its calls settles the mark", () => {
    // Each program has a mark the fact could seem to explain, but does not:
    // the callee is not known (`ident(keep)`, the aliases), runs its parameter
    // only in a lambda it returns (`later`), or is handed a function silenced
    // by a written type, by another callee, or by the knot (`pureOnly`, `use`,
    // `act`). Where a report names a fact, its fix that marks the fact's calls
    // settles that mark.
    const programs = [
      "let keep(f) = 0\nlet outer(g) =\n    g()\n    ident(keep)!(g)\n",
      "let tw(f) =\n    f()\n    0\nlet t2 = tw\nlet keep(f) = 0\nlet k2 = keep\n" +
        "let outer(g): Int =\n    g()\n    let a = t2!(g)\n    k2!(g)\n",
      "let later(f) = () => f()\nexport let p(): Unit =\n    let h = later!(save0)\n    ()\n",
      "let later(f) = () => f!()\nlet outer(g) =\n    g()\n    let h = later!(g)\n    0\n",
      "let tw(f) =\n    f()\n    0\nlet outer(h): Int =\n    pureOnly(h)\n    tw!(h)\n",
      "let tw(f) =\n    f()\n    0\nlet use(k) =\n    k()\n    0\nlet outer(h): Int =\n    let _ = use(h)\n    tw!(h)\n",
      ...both(
        "    ping(n: Int, act): Int =\n        let q = (cb: () ->! Unit, k) =>\n            cb!()\n            k()\n" +
          "            let _ = if n > 0 then pong(n - 1, act) else 0\n            ()\n        q!(noop, act)\n        0\n",
        "    pong(n: Int, act): Int =\n        act()\n        if n > 0 then ping(n - 1, act) else 0\n",
      ).map((knot) => knot + "export let probe(): Unit =\n    let _ = ping(2, noop)\n    ()\n"),
    ];
    for (const source of programs) {
      for (const [index, { at, message, fixes }] of reports(source).entries()) {
        const fix = fixes.findIndex((each) => each.startsWith("mark the call of") || each.startsWith("mark every call"));
        if (!message.startsWith("this call") || fix < 0) continue;
        const claim = message.split(" — ")[0]!;
        expect([at, fixed(source, index, fix).filter((each) => each.split(" — ")[0] === claim)]).toEqual([at, []]);
      }
    }
  });

  it("reports each function handed on its own, at the function, true of that function", () => {
    const tw = "let tw(f, g) =\n    f()\n    g()\n    0\n";
    expect(reports(tw + "export let p(): Int = tw(save0, save0)\n").map(({ at, message }) => [at, message])).toEqual([
      ["L5 save0", handed + " — `f` is called bare, which makes it pure and unable to fail"],
      ["L5 save0", handed + " — `g` is called bare, which makes it pure and unable to fail"],
    ]);
    expect(reports(tw + "export let p(): Int = tw(log0, oops0)\n").map(({ at, message }) => [at, message])).toEqual([
      ["L5 log0", "this function is impure, where the function handed must be pure — `f` is called bare, which makes it pure"],
      ["L5 oops0", "this function may fail, where the function handed must be unable to fail — `g` is called bare, which " +
        "makes it unable to fail"],
    ]);
  });

  it("names the parameter the function is handed to, in either member order", () => {
    const a = "    a(p, n: Int): Int = if n > 0 then b(p, n - 1) else 0\n";
    const b = "    b(q, n: Int): Int =\n        q()\n        if n > 0 then a(q, n - 1) else 0\n";
    for (const knot of both(a, b)) {
      // One report for the fact, named by the parameter the function goes to.
      const words = reports(knot + "export let x(): Int = b!(log0, 2)\n").map(({ message }) => message.split(" — ")[1]);
      expect(words).toHaveLength(1);
      expect(words[0]).toContain("`q`");
    }
  });

  it("sets apart the facts only the other checks meet, and names each on its own colours", () => {
    // `save0` goes to `f`; `g` joins the report only through the `tw!` mark at
    // the other call, so the headline at `save0` names it apart (#1311 r1).
    const source = "let tw(f, g) =\n    f()\n    g()\n    0\n" +
      "export let a(): Int = tw(save0, noop)\nexport let b(): Int = tw!(log0, oops0)\n";
    expect(reports(source)).toEqual([{
      at: "L5 save0",
      message: handed + " — `f` is called bare, which makes it pure and unable to fail (and for the other checks here, " +
        "`g` is called bare, which makes it unable to fail)",
      fixes: ["mark every call that makes `f` pure and unable to fail, and `g` unable to fail"],
    }]);
  });

  it("makes a written type a parameter meets a fact the reports of its checks share (#1307)", () => {
    // `pinned`'s `f` meets `pureOnly`'s `() -> Unit`: its own `f!()`, the mark
    // on `pinned!`, and `save0` handed in are one report, naming the type.
    const pinned = "let pinned(f) =\n    pureOnly(f)\n    f!()\n";
    const source = pinned + "export let p(): Unit = pinned!(save0)\n";
    expect(reports(source)).toEqual([{
      at: "L3 !",
      message: over("f") + " — `f` meets a type that makes it pure and unable to fail",
      fixes: [],
    }]);
    expect(labels(source)).toEqual([
      "`f` meets a type here that makes it pure and unable to fail",
      "`pinned` wants no mark, not `!`",
      "a function that is impure and may fail is handed here",
    ]);
    // With only marks against it, removing them is the fix.
    const marks = pinned + "    f!()\n";
    expect(reports(marks).map(({ fixes }) => fixes)).toEqual([["remove the marks"]]);
    expect(fixed(marks, 0, 0)).toEqual([]);
  });

  it("sets a written type apart from a call's fact, and its fix leaves silent what the type makes silent (#1312)", () => {
    // `failsNot`'s `->~` makes `f` unable to fail; `f^()` is bare on the world
    // colour, so it makes `f` pure. `save0` handed in fails both: one report.
    const source = "let failsNot(g: () ->~ Unit): Unit = ()\nlet m(f) =\n    f^()\n    failsNot(f)\n    ()\n" +
      "export let probe(): Unit = m(save0)\n";
    expect(reports(source)).toEqual([{
      at: "L3 ^",
      message: "this call cannot fail, so `f` wants no mark, not `^` — `f` meets a type that makes it unable to fail " +
        "(and for the other checks here, `f` is called `^`, which makes it pure)",
      fixes: ["mark the call of `f` `~`"],
    }]);
  });

  it("names where a contract is written, and offers `assume` where only the failure keeps the function out (#1313)", () => {
    // Declarations Preamble §1.1's contract clause: the label says where the
    // contract is written; no fix widens it; `assume` is offered on the fail
    // colour alone, by name, and compiles.
    const written = "let applyPure(g: (Int) -> Int): Int = g(1)\nlet risky(n: Int): Int = parse^(\"1\") + n\n";
    const contract = "`f` is written `() -> Unit` here";
    const fail = written + "export let p(): Unit = pureOnly(oops0)\n";
    expect(reports(fail).map(({ fixes }) => fixes)).toEqual([["assume it cannot fail here: `() => assume oops0^()`"]]);
    // Refused at the value handed, where the contract is the parameter's.
    expect(reports(fail).map(({ at }) => at)).toEqual(["L3 oops0"]);
    expect(labels(fail)).toEqual([contract]);
    expect(fixed(fail, 0, 0)).toEqual([]);
    const arity = written + "export let q(): Int = applyPure(risky)\n";
    expect(reports(arity).map(({ fixes }) => fixes)).toEqual([["assume it cannot fail here: `(x) => assume risky^(x)`"]]);
    expect(labels(arity)).toEqual(["`g` is written `(Int) -> Int` here"]);
    expect(fixed(arity, 0, 0)).toEqual([]);
    // A qualified name keeps its qualifier.
    const qualified = "let applyF(g: (String) -> Float): Float = g(\"1\")\nexport let q(): Float = applyF(Float.parse)\n";
    expect(reports(qualified).map(({ fixes }) => fixes)).toEqual([["assume it cannot fail here: `(x) => assume Float.parse^(x)`"]]);
    expect(fixed(qualified, 0, 0)).toEqual([]);
    // The world part keeps `save0` and `log0` out: nothing turns them pure, so no fixit.
    for (const impure of ["save0", "log0"]) {
      const world = written + `export let r(): Unit = pureOnly(${impure})\n`;
      expect(reports(world).map(({ fixes }) => fixes)).toEqual([[]]);
      expect(labels(world)).toEqual([contract]);
    }
    // Where the contract allows the world, only the failure is in the way, and `assume` keeps the world.
    const failsNot = "let failsNot(g: () ->~ Unit): Unit = ()\nexport let t(): Unit = failsNot(save0)\n";
    expect(reports(failsNot).map(({ fixes }) => fixes)).toEqual([["assume it cannot fail here: `() => assume save0!()`"]]);
    expect(fixed(failsNot, 0, 0)).toEqual([]);
    // A type a parameter meets is such a contract: its report offers `assume`
    // only where it settles every check (§3.4).
    const twice = "let pinned(h) =\n    pureOnly(h)\n    0\nexport let a(): Int = pinned(oops0)\nexport let b(): Int = pinned(oops0)\n";
    expect(reports(twice).map(({ fixes }) => fixes)).toEqual([["assume none of them can fail here"]]);
    expect(fixed(twice, 0, 0)).toEqual([]);
    const mixed = "let pinned(h) =\n    pureOnly(h)\n    h^()\n    0\nexport let a(): Int = pinned^(oops0)\n";
    expect(reports(mixed).flatMap(({ fixes }) => fixes).filter((fix) => fix.startsWith("assume"))).toEqual([]);
    // A fact a bare call makes is not offered it.
    const called = "let tw(f) =\n    f()\n    0\nexport let a(): Int = tw(oops0)\n";
    expect(reports(called).flatMap(({ fixes }) => fixes).filter((fix) => fix.startsWith("assume"))).toEqual([]);
    // Through a parameter that meets the written type, the same fix.
    const pinned = "let pinned(h) =\n    pureOnly(h)\n    ()\nexport let s(): Unit = pinned(oops0)\n";
    expect(reports(pinned).map(({ fixes }) => fixes)).toEqual([["assume it cannot fail here: `() => assume oops0^()`"]]);
    expect(fixed(pinned, 0, 0)).toEqual([]);
  });

  it("reads a callee as its value, so every spelling of one call reads alike (#1307)", () => {
    // `save0` goes to `f`, which `f()` makes pure and unable to fail; the
    // later `!` runs `f` through what `mk` returned, so it is the fact's check
    // too, a label on its one report, however the text spells the callee.
    const mk = "let mk(f) =\n    f()\n    () => f()\n";
    const spellings = [
      "export let p(): Unit =\n    let h = mk(save0)\n    h!()\n",
      "export let p(): Unit = mk(save0)!()\n",
      "export let p(): Unit =\n    let h = mk(save0)\n    let k = h\n    k!()\n",
      "let mk2(g) = mk(g)\nexport let p(): Unit =\n    let h = mk2(save0)\n    h!()\n",
      "export let p(): Unit =\n    let h = ident(mk(save0))\n    h!()\n",
    ];
    for (const spelling of spellings) {
      expect(reports(mk + spelling)).toHaveLength(1);
      expect(labels(mk + spelling).filter((label) => label.includes("wants no mark"))).toHaveLength(1);
    }
    const bound = "let mk(f) =\n    f()\n    let r = () => f()\n    r\nexport let p(): Unit =\n    let h = mk(save0)\n    h!()\n";
    expect(reports(bound)).toHaveLength(1);
    const curried = "let mk(f) =\n    f()\n    (x: Int) => () => f()\nexport let p(): Unit = mk(save0)(1)!()\n";
    expect(reports(curried)).toHaveLength(1);
    // A written type is the face: the reading stops there, and the mark keeps
    // its own report, since the fact is not why the call is silent.
    const typedParameter = mk + "let mk2(g: () -> Unit) = mk(g)\nexport let p(): Unit =\n    let h = mk2(save0)\n    h!()\n";
    expect(labels(typedParameter).filter((label) => label.includes("wants no mark"))).toEqual([]);
    const typedLet = mk + "export let p(): Unit =\n    let h: () -> Unit = mk(save0)\n    h!()\n";
    expect(labels(typedLet).filter((label) => label.includes("wants no mark"))).toEqual([]);
    const typedResult = "let mk(f): () -> Unit =\n    f()\n    () => f()\nexport let p(): Unit =\n    let h = mk(save0)\n    h!()\n";
    expect(labels(typedResult).filter((label) => label.includes("wants no mark"))).toEqual([]);
    // A `let`'s hole decides nothing, so the reading goes through it; a
    // parameter's hole is filled as written arrows, and a type variable two
    // parameters write ties them, so each stops it.
    const hole = mk + "export let p(): Unit =\n    let h: _ = mk(save0)\n    h!()\n";
    expect(labels(hole)).toContain("`h` wants no mark, not `!`");
    const parameterHole = mk + "let mk2(g: _) = mk(g)\nexport let p(): Unit =\n    let h = mk2(save0)\n    h!()\n";
    expect(labels(parameterHole).filter((label) => label.includes("wants no mark"))).toEqual([]);
    const tied = mk + "let mk2(g: t, w: t) = mk(g)\nlet pw: () -> Unit = noop\nexport let p(): Unit =\n    let h = mk2(save0, pw)\n    h!()\n";
    expect(reports(tied).filter(({ message }) => message.includes("is called bare") && message.startsWith("this call"))).toEqual([]);
    // A long chain of makers that forward to one another reads through.
    const chain = "let mk0(f) =\n    f()\n    () => f()\n" +
      Array.from({ length: 400 }, (_, index) => `let mk${index + 1}(f) = mk${index}(f)\n`).join("") +
      "export let p(): Unit =\n    let h = mk400(save0)\n    h!()\n";
    expect(labels(chain)).toContain("`h` wants no mark, not `!`");
    // What the returned lambda runs was handed `noop`: nothing hides behind
    // the fact there, so the mark keeps its own report.
    const quiet = "let mk(f, g) =\n    f()\n    g()\n    () => g()\nexport let p(): Unit =\n    let h = mk(save0, noop)\n    h!()\n";
    expect(reports(quiet).map(({ fixes }) => fixes.at(-1))).toEqual(["mark the call of `f` `!`", "perhaps remove the mark"]);
  });

  it("reads a callee as its value the same way whatever else the text holds (#1307)", () => {
    // `mk` returns through a local `let` and a knot sibling; an unrelated
    // function before it changes nothing of the reading.
    const knot = "fun\n    mk(f, n: Int) =\n        f()\n        let r = if n > 0 then use(f, n - 1) else () => f()\n        r\n" +
      "    use(k, n: Int) =\n        if n > 0 then mk(k, n - 1) else () => k()\n";
    const probe = "export let probe(): Unit =\n    let h = mk(save0, 2)\n    h!()\n";
    const before = "export let probe0(): Unit =\n    let j = use(log0, 1)\n    j~()\n";
    for (const source of [knot + probe, knot + before + probe]) {
      expect(labels(source)).toContain("`h` wants no mark, not `!`");
      expect(reports(source).filter(({ at }) => at.endsWith("!"))).toEqual([]);
    }
  });

  it("reads a call of a value a knot member returned, in either member order (#1307)", () => {
    const mk = "    mk(k, n: Int) = if n > 0 then use(k, n - 1) else () => k()\n";
    const use = "    use(k, n: Int) =\n        let h = mk(k, n)\n        h!()\n        () => ()\n";
    const probe = "export let probe(): Unit =\n    let h = mk(save0, 2)\n    h!()\n";
    for (const knot of both(mk, use)) {
      expect(reports(knot + probe)).toHaveLength(1);
      expect(labels(knot + probe)).toContain("`h` wants no mark, not `!`");
      expect(fixed(knot + probe, 0, 0)).toEqual(["this call is impure and may fail, so `mk` wants `!`, not no mark"]);
    }
  });

  it("explains a held lambda's marks as its plain twin's", () => {
    // `q!(noop, act)` hands `cb` a pure function, so nothing hides behind the
    // fact there; `q!(act, …)` hands it `act`, which is silent too, and what
    // silenced it may be no fact a report can name, so neither twin explains it.
    const q = (inner: string) => `${inner}let q = (cb, cc) =>\n${inner}    cb()\nREC${inner}    ()\n` +
      `${inner}q!(noop, act)\n${inner}q!(act, () => ())\n${inner}0\n`;
    const knot = "fun\n    ping(n: Int, act): Int =\n" +
      q("        ").replace("REC", "            let _ = if n > 0 then pong(n - 1, act) else 0\n") +
      "    pong(n: Int, act): Int = if n > 0 then ping(n - 1, act) else 0\n";
    const lone = "let ping(n: Int, act): Int =\n" + q("    ").replace("REC", "");
    const probe = "export let probe(): Int = ping!(2, save0)\n";
    const messages = (source: string) => reports(source).map(({ message }) => message);
    // Where no fact explains a mark, the removal is a suggestion, and only the
    // first such report is given (Declarations Preamble §1.1), in the knot and
    // in its twin alike.
    const fact = handed + " — `cb` is called bare, which makes `act` pure and unable to fail";
    expect(messages(knot + probe)).toEqual(messages(lone + probe));
    expect(messages(lone + probe)).toEqual([pureAndTotal(over("q")), fact]);
  });
});

describe("Effects §3.4 — a member is its value: its recursion follows the faces it writes (#1222, #1229)", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n";
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", prelude + source]]);
  const hover = (source: string, needle: string): string | undefined => hoveredType(prelude + source, needle);
  const bang = "this call is impure and may fail, so this call wants `!`, not no mark";
  const follows = "(() ->! Unit) >-> Unit";

  it("follows a written result type's `>->` over the lambda it returns, at every depth of its spine (#1229)", () => {
    // Main pinned `cb` pure at the knot's close: a lie of generality whose
    // fixit did not compile.
    const walk = `fun a(n: Int): ${follows} = (cb) => if n == 0 then cb!() else a(n - 1)!(cb)\n`;
    expect(check(walk + "export let probe(): Unit = a(2)!(save0)\n")).toEqual([]);
    expect(check(walk + "export let probe(): Unit = a(2)(noop)\n")).toEqual([]);
    expect(check(walk + "export let probe(): Unit = a(2)(save0)\n")).toEqual([bang]);
    expect(check(walk.replace("a(n - 1)!(cb)", "a(n - 1)(cb)"))).toEqual([bang]);
    expect(hover(walk, "a(n: Int)")).toBe(`Int -> ${follows}`);
    expect(check(walk.replaceAll("Unit", "Int") +
      "export let probe(): Int = a(2)!(() =>\n    save!(\"x\")\n    1)\n")).toEqual([]);
    const deep = `fun a(n: Int): (Int) -> ${follows} = (m) => (cb) => if n == 0 then cb!() else a(n - 1)(m)!(cb)\n`;
    expect(check(deep + "export let probe(): Unit = a(2)(1)!(save0)\n")).toEqual([]);
    expect(check(deep + "export let probe(): Unit = a(2)(1)(noop)\n")).toEqual([]);
    expect(check(deep + "export let probe(): Unit = a(2)(1)(save0)\n")).toEqual([bang]);
    expect(hover(deep, "a(n: Int)")).toBe(`Int -> Int -> ${follows}`);
  });

  it("follows an ascription over the lambda it returns, which the spine reads through (#1222)", () => {
    // Main refused this with "`cb` is not one `a` was given", and read the
    // recursion as pure beneath that refusal.
    const walk = `fun a(n: Int) = (((cb) => if n == 0 then cb!() else a(n - 1)!(cb)): ${follows})\n`;
    expect(check(walk + "export let probe(): Unit = a(2)!(save0)\n")).toEqual([]);
    expect(check(walk + "export let probe(): Unit = a(2)(noop)\n")).toEqual([]);
    expect(check(walk + "export let probe(): Unit = a(2)(save0)\n")).toEqual([bang]);
    expect(hover(walk, "a(n: Int)")).toBe(`Int -> ${follows}`);
    const always = walk.replace(follows, "(() ->! Unit) ->! Unit");
    expect(check(always + "export let probe(): Unit = a(2)!(noop)\n")).toEqual([]);
    expect(hover(always, "a(n: Int)")).toBe("Int -> (() ->! Unit) ->! Unit");
    expect(check(
      `fun a(n: Int) = (m) => (((cb) => if n == 0 then cb!() else a(n - 1)(m)!(cb)): ${follows})\n` +
        "export let probe(): Unit = a(2)(1)(save0)\n",
    )).toEqual([bang]);
    // Several members, in either order.
    const a = `    a(n: Int) = (((cb) => if n == 0 then cb!() else b(n - 1)!(cb)): ${follows})\n`;
    const b = `    b(n: Int) = (((cb) => if n == 0 then cb!() else a(n - 1)!(cb)): ${follows})\n`;
    for (const knot of [`fun\n${a}${b}`, `fun\n${b}${a}`]) {
      expect(check(knot + "export let probe(): Unit = b(2)(save0)\n")).toEqual([bang]);
      expect(check(knot + "export let probe(): Unit = b(2)(noop)\n")).toEqual([]);
    }
    // What the recursion was not given is still refused where it is handed.
    expect(check(walk.replace("a(n - 1)!(cb)", "a(n - 1)!(noop)"))).toEqual([
      "this function is not one `a` was given, and a recursive call hands on only the callbacks it was given",
    ]);
  });

  it("takes an ascription's `->!` over a value a knot holds as its face, as a binding annotation's (#1149)", () => {
    const knot = (written: string, call: string, sibling: string) => `fun
    ping(n: Int): Int =
        let act = () => pong${sibling}(n)
        ${written}
        ${call}
    pong(n: Int): Int = if n > 0 then ping${sibling}(n - 1) else 0
`;
    for (const written of ["let q: () ->! Int = act", "let q = (act: () ->! Int)"]) {
      expect(check(knot(written, "q!()", "!"))).toEqual([]);
      expect(check(knot(written, "q()", "!"))).toEqual(["this call is impure and may fail, so `q` wants `!`, not no mark"]);
    }
    expect(check(knot("let z = 0", "(act: () ->! Int)!()", "!"))).toEqual([]);
  });

  it("takes a written result type's `->!` over a lambda a knot holds as its face, as outside a knot (#1149)", () => {
    const walk = "fun a(n: Int): () ->! Unit = () => if n == 0 then () else a(n - 1)!()\n";
    expect(check(walk + "export let probe(): Unit = a(2)!()\n")).toEqual([]);
    expect(hover(walk, "a(n: Int)")).toBe("Int -> () ->! Unit");
    expect(check(walk.replace("a(n - 1)!()", "a(n - 1)()") + "export let probe(): Unit = a(2)()\n"))
      .toEqual([bang, bang]);
    expect(check("let mk(n: Int): () ->! Unit = () => ()\nexport let probe(): Unit = mk(2)()\n")).toEqual([bang]);
  });

  it("still holds what a use demanded of the recursion for the close, and never lets it choose", () => {
    // The use's `->` meets the member's colour on the name's side: it is
    // compared at the close and reported at the member, as on main, and does
    // not make the member's body a pure face.
    const source = `fun a(n: Int) = () =>
    save!("x")
    if n == 0 then () else
        let g: () -> Unit = a(n - 1)
        g()
`;
    const text = prelude + source;
    const reports = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics;
    expect(reports.map(({ message }) => message)).toEqual([
      "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the demand is written `->`",
    ]);
    expect(reports[0]!.primary.start.offset).toBe(text.indexOf("fun a("));
  });

  it("follows a written `>->` a recursive call's ascription writes, on the name's side, as a use's", () => {
    // The use's `>->` is fitted, as it was: merging it (on the name's side)
    // would refuse this correct program.
    const walk = `fun a(n: Int): ${follows} = (cb) => if n == 0 then cb!() else (a(n - 1): ${follows})!(cb)\n`;
    expect(check(walk + "export let probe(): Unit = a(2)(save0)\n")).toEqual([bang]);
    expect(check(walk + "export let probe(): Unit = a(2)!(save0)\n")).toEqual([]);
  });

  it("holds a use's merge with the recursion's result, never taking it into the member's colour", () => {
    // `k` merges the recursion's result with a lambda running both callbacks:
    // a use, on the name's side, so the member's colour does not take its
    // join. The use re-opens the result (#1233), and the member follows the
    // callbacks it is handed.
    const source = `fun a(n: Int, f: () ->! Unit, g: () ->! Unit) =
    let k = if n > 5 then a!(n - 1, f, g) else () =>
            f!()
            g!()
    k!()
    () => if n > 0 then a!(n - 1, f, g)!() else f!()
`;
    const wants = "this call is impure and may fail, so `a` wants `!`, not no mark";
    expect(check(source + "export let probe(): Unit = a(2, noop, noop)()\n")).toEqual([]);
    expect(check(source + "export let probe(): Unit = a!(2, save0, noop)!()\n")).toEqual([]);
    expect(check(source + "export let probe(): Unit = a(2, noop, save0)()\n")).toEqual([wants, bang]);
    expect(hover(source, "a(n: Int")).toBe("(Int, () ->! Unit, () ->! Unit) >-> () >-> Unit");
  });

  it("lets a member reach the untyped callback a held lambda's body runs, past its written `>->`", () => {
    // What the lambda runs beyond the callbacks it is handed still reaches
    // the members that call it: `ping` is a conduit of `cb`. That `q` runs
    // `cb` and promises `>->` is the face report, once `cb` is decided (#1230).
    const wants = (callee: string) => `this call is impure and may fail, so \`${callee}\` wants \`!\`, not no mark`;
    const runs = (owner: string) => `this call runs \`${owner}\`'s \`cb\`, which this signature is not handed, and ` +
      "this face's `>->` promises the function is only as effectful as what it is handed — write `->!`";
    expect(check(`fun ping(n: Int, cb): Int =
    let q: ${follows} = (x) =>
        x!()
        cb!()
        let _ = if n > 0 then ping!(n - 1, cb) else 0
        ()
    q!(noop)
    0
let user(): Int = ping(2, save0)
export let probe(): Int = user()
`)).toEqual([runs("ping"), wants("ping"), wants("user")]);
    const ping = `    ping(n: Int, cb): Int =
        let q: ${follows} = (x) =>
            x!()
            let _ = if n > 0 then pong!(n - 1, cb) else 0
            ()
        q!(noop)
        0
`;
    const pong = "    pong(n: Int, cb): Int =\n        cb!()\n        if n > 0 then ping!(n - 1, cb) else 0\n";
    // The knot shares one `cb`, named for the member that kept it first.
    expect(check(`fun\n${ping}${pong}export let probe(): Int = ping(2, save0)\n`))
      .toEqual([runs("ping"), wants("ping")]);
    expect(check(`fun\n${pong}${ping}export let probe(): Int = ping(2, save0)\n`))
      .toEqual([runs("pong"), wants("ping")]);
  });
});

describe("Effects §4.2 — a written `>->` meets the function it stands over alike in every spelling (#1230, #1234)", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n" +
    "let pureOnly(f: () -> Unit): Unit = f()\n";
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", prelude + source]]);
  const follows = "(() ->! Unit) >-> Unit";
  const runs = (owner: string, parameter: string) =>
    `this call runs \`${owner}\`'s \`${parameter}\`, which this signature is not handed, and this face's \`>->\` ` +
    "promises the function is only as effectful as what it is handed — write `->!`";
  const promise = "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the " +
    "demand is written `->`";
  // A binding annotation, an ascription and a written result type, over one
  // lambda, and the call that runs it.
  const spellings = (face: string, lambda: string, args: string, mark: string): readonly (readonly [string, string])[] => [
    [`    let k: ${face} = ${lambda}\n`, `    k${mark}(${args})\n`],
    [`    let k = ((${lambda}): ${face})\n`, `    k${mark}(${args})\n`],
    [`    let k(): ${face} = ${lambda}\n`, `    k()${mark}(${args})\n`],
  ];

  it("leaves an untyped callback the lambda runs bare to its body's facts, in every spelling", () => {
    // Main refused the binding spelling at once, before `outer`'s close had
    // decided `action` pure.
    for (const [face, call] of spellings(follows, "(cb) => action()", "noop", "")) {
      expect(check(`let outer(action): Unit =\n${face}${call}`)).toEqual([]);
    }
  });

  it("reports an untyped callback a mark leaves its own, before the face or after it, at the call that runs it", () => {
    for (const [face, call] of spellings(follows, "(cb) => action!()", "noop", "!")) {
      expect(check(`let outer(action): Unit =\n    action!()\n${face}${call}`)).toEqual([runs("outer", "action")]);
      expect(check(`let outer(action): Unit =\n${face}${call}    action!()\n`)).toEqual([runs("outer", "action")]);
      expect(check(`let outer(action): Unit =\n${face.replace(">->", "->!")}${call}    action!()\n`)).toEqual([]);
    }
  });

  it("publishes the callbacks a written `>->` follows, joined with what the value runs, in every spelling", () => {
    // Main's ascription published only the lambda's own colour, so a call
    // handing `k` a function that is impure stayed bare.
    const wants = ["this call is impure and may fail, so `k` wants `!`, not no mark",
      "this call is impure and may fail, so `k` wants `!`, not no mark",
      "this call is impure and may fail, so this call wants `!`, not no mark"];
    for (const [index, [face, call]] of spellings(follows, "(x) => action()", "save0", "").entries()) {
      expect(check(`let outer(action): Unit =\n    action()\n${face}${call}`)).toEqual([wants[index]]);
    }
  });

  it("reports a face once where its body both touches the world and runs a colour it is not handed", () => {
    const own = "this call is impure and may fail on its own account, and this face's `>->` promises the function is " +
      "only as effectful as what it is handed — write `->!`";
    for (const [face, call] of spellings(follows, "(x) =>\n        save!(\"z\")\n        action!()", "noop", "!")) {
      expect(check(`let outer(action): Unit =\n${face}${call}`)).toEqual([own]);
    }
  });

  it("reports a held lambda's `>->` that runs a member's untyped callback, in either member order", () => {
    // Main read `q` as following only `x` and `y`, so `ping` read pure and
    // ran `save` through `pong`.
    const ping = "    ping(n: Int, cb): Int =\n" +
      "        let q: (() ->! Unit, () ->! Unit) >-> Unit = (x, y) =>\n            x!()\n            y!()\n" +
      "            let _ = if n > 0 then pong!(n - 1, cb) else 0\n            ()\n        q!(noop, noop)\n        0\n";
    const pong = "    pong(n: Int, cb): Int =\n        cb!()\n        if n > 0 then ping!(n - 1, cb) else 0\n";
    const user = "let user(): Int = ping!(2, save0)\n";
    expect(check(`fun\n${ping}${pong}${user}`)).toEqual([runs("ping", "cb")]);
    expect(check(`fun\n${pong}${ping}${user}`)).toEqual([runs("pong", "cb")]);
    expect(check(`fun\n${ping.replace(">->", "->!")}${pong}${user}`)).toEqual([]);
  });

  it("decides a `fun` member's untyped callback by its facts where an ascribed lambda runs it, as a `let`'s", () => {
    // Main left the `fun` member's `cb` to no body, and showed `ping` pure
    // while it followed `cb`.
    for (const keyword of ["let", "fun"]) {
      expect(check(`${keyword} ping(n: Int, cb): Int =\n    let q = (((x) =>\n        x!()\n        cb()\n` +
        `        ()): ${follows})\n    q(noop)\n    0\nexport let probe(): Int = ping(2, save0)\n`)).toEqual([
        "this function is impure and may fail, where the function handed must be pure and unable to fail — `cb` is " +
        "called bare, which makes it pure and unable to fail",
      ]);
    }
  });

  it("gives a binding's one-callback `>->` lambda in a knot one report, whose fixit compiles (#1234)", () => {
    // Main took the lambda for a sibling, so `ping` lost the callback's colour.
    // The report stands at the call that runs the world (#1238).
    const knot = (arrow: string) => `fun\n    ping(n: Int): Int =\n        let q: (() ->! Unit) ${arrow} Unit = (cb) =>\n` +
      "            cb!()\n            let _ = if n > 0 then ping!(n - 1) else 0\n            ()\n" +
      "        q!(save0)\n        0\nexport let probe(): Int = ping!(2)\n";
    expect(check(knot(">->"))).toEqual([
      "this call is impure and may fail on its own account, and this face's `>->` promises the function is only " +
      "as effectful as what it is handed — write `->!`",
    ]);
    expect(check(knot("->!"))).toEqual([]);
  });
});

describe("Effects §3.4 — a knot's colour is re-opened where it is used (#1233)", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n" +
    "let pureOnly(f: () -> Unit): Unit = f()\nlet pick(x: a, y: a): a = y\n";
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", prelude + source]]);
  const hover = (source: string, needle: string): string | undefined => hoveredType(prelude + source, needle);
  const bang = "this call is impure and may fail, so this call wants `!`, not no mark";
  const wants = (callee: string) => `this call is impure and may fail, so \`${callee}\` wants \`!\`, not no mark`;
  const promise = "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the " +
    "demand is written `->`";

  it("joins a held lambda with an effectful function as either branch, the join touching the world", () => {
    // Main published the held lambda's colour for the join, so a bare
    // `a(2)()` saved.
    for (
      const join of [
        "if n > 1 then () => a(n - 1)() else () => save!(\"x\")",
        "if n > 1 then () => save!(\"x\") else () => a(n - 1)()",
        "if n > 0 then () => a(n - 1)() else save0",
        "if n == 0 then save0 else () => a(n - 1)()",
        "\n    match n\n        0 => () => a(n - 1)()\n        _ => save0",
        "\n    let f = if n > 1 then () => a(n - 1)() else save0\n    f",
      ]
    ) {
      const source = `fun a(n: Int) = ${join}\n`;
      expect(check(source + "export let probe(): Unit = a(2)()\n")).toEqual([bang, bang]);
      expect(check(source.replace("a(n - 1)()", "a(n - 1)!()") + "export let probe(): Unit = a(2)!()\n"))
        .toEqual([]);
      expect(hover(source, "a(n: Int)")).toBe("Int -> () ->! Unit");
    }
  });

  it("refuses a written pure face over the join, and asks `!` of a pure-faced member's calls through it", () => {
    expect(check("fun a(n: Int): () -> Unit = if n > 0 then () => a(n - 1)() else save0\n")).toContain(promise);
    const member = "fun a(n: Int): Unit =\n    let f = if n > 1 then () => a(n - 1) else () => save!(\"x\")\n    f()\n";
    expect(check(member + "export let probe(): Unit = a(2)\n")).toEqual([wants("a"), wants("f"), wants("a")]);
    expect(check(member.replace("a(n - 1)", "a!(n - 1)").replace("f()", "f!()") +
      "export let probe(): Unit = a!(2)\n")).toEqual([]);
  });

  it("joins across siblings and inside a constructor, whichever member is written first", () => {
    const a = "    a(n: Int) = if n > 0 then () => b(n - 1)() else save0\n";
    const b = "    b(n: Int) = a(n)\n";
    for (const members of [[a, b], [b, a]]) {
      const knot = `fun\n${members.join("")}`;
      expect(check(knot + "export let probe(): Unit = b(2)()\n")).toEqual([bang, bang]);
      expect(hover(knot, "b(n: Int)")).toBe("Int -> () ->! Unit");
    }
    const boxed = "fun a(n: Int) = if n > 1 then Some(() =>\n    match a(n - 1)\n        Some(f) => f!()\n" +
      "        None => ()) else Some(save0)\n";
    expect(hover(boxed, "a(n: Int)")).toBe("Int -> Option(() ->! Unit)");
  });

  it("keeps a sibling named as a value its own colour beside an effectful branch, the join's room taking the effect", () => {
    // Main read `k` as `b`'s colour, pure, so a bare `k()` ran `save`. A
    // sibling not yet read is a function of the arity its text writes, so the
    // members' order decides nothing.
    const caller = "    a(c: Bool): Unit =\n        let k = if c then b else () => save!(\"x\")\n        k()\n";
    const quiet = "    b(): Unit =\n        let unused = a\n        ()\n";
    const picked = "    a(c: Bool): Unit =\n        let k = pick(b, save0)\n        k()\n";
    for (const user of [caller, picked]) {
      for (const members of [[user, quiet], [quiet, user]]) {
        const knot = `fun\n${members.join("")}`;
        expect(check(knot)).toEqual([wants("k")]);
        expect(check(knot.replace("k()", "k!()"))).toEqual([]);
        expect(hover(knot, "b()")).toBe("() -> Unit");
        expect(hover(knot, "a(c")).toBe("Bool ->! Unit");
      }
    }
  });

  it("refuses a pure pin on a join of a sibling with an effectful function, in either member order", () => {
    // Main compiled these, and `a(False)` saved through `pureOnly`.
    const caller = "    a(c: Bool): Unit =\n        pureOnly(if c then b else save0)\n";
    const quiet = "    b(): Unit =\n        let unused = a\n        ()\n";
    for (const members of [[caller, quiet], [quiet, caller]]) {
      expect(check(`fun\n${members.join("")}`)).toEqual([promise]);
    }
    const nested = "let go(m: Int): Unit =\n    pureOnly(() =>\n        fun\n" +
      "            a(n: Int) = if n > 1 then () => a(n - 1)!() else save0\n        a(m)!())\n";
    expect(check(nested)).toEqual([promise]);
  });

  it("calls a held lambda stored under a written `->!` with `!`, as outside a knot", () => {
    // Main read the stored lambda as the held colour, pure, and asked the
    // marks away.
    const quiet = "    b(): Unit =\n        let unused = a\n        ()\n";
    for (
      const caller of [
        "    a(): Unit =\n        let r: { step: () ->! Unit } = { step = () => b() }\n        r.step!()\n",
        "    a(): Unit =\n        let v: Vector(() ->! Unit) = [() => b(), noop]\n        Vector.at(v, 1)!()\n",
      ]
    ) {
      for (const members of [[caller, quiet], [quiet, caller]]) {
        const knot = `fun\n${members.join("")}`;
        expect(check(knot)).toEqual([]);
        expect(hover(knot, "a(): Unit")).toBe("() ->! Unit");
        expect(hover(knot, "b(): Unit")).toBe("() -> Unit");
      }
    }
  });

  it("reads a sibling not yet checked as a function of the arity its text writes, in either member order", () => {
    // A call's wrong count of arguments stands at the call whichever member
    // is written first.
    const caller = "    a(n: Int): Int = b(n, 1)\n";
    const callee = "    b(n: Int): Int = if n > 0 then a(n - 1) else 0\n";
    for (const members of [[caller, callee], [callee, caller]]) {
      expect(check(`fun\n${members.join("")}`)).toEqual(["function expects 1 arguments, got 2"]);
    }
  });

  it("keeps a held lambda named by a `let` pure where a use pins it, beside the join that took the effect", () => {
    const caller = "    a(n: Int): Unit =\n        let g = () => c(n)\n        let f = if n > 0 then g else save0\n" +
      "        pureOnly(g)\n        f!()\n";
    const quiet = "    c(n: Int): Unit =\n        let unused = a\n        ()\n";
    for (const members of [[caller, quiet], [quiet, caller]]) {
      const knot = `fun\n${members.join("")}`;
      expect(check(knot)).toEqual([]);
      expect(hover(knot, "a(n: Int)")).toBe("Int ->! Unit");
      expect(hover(knot, "c(n: Int)")).toBe("Int -> Unit");
    }
  });
});

describe("Effects §3.4 — what a held lambda's own callbacks run is not held (#1231)", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n" +
    "let pureOnly(f: () -> Unit): Unit = f()\nlet pick(x: a, y: a): a = y\nlet ident(x: a): a = x\n";
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", prelude + source]]);
  const hover = (source: string, needle: string): string | undefined => hoveredType(prelude + source, needle);
  // Where each report stands, by the text there.
  const reports = (source: string): readonly (readonly [string, string])[] => {
    const text = prelude + source;
    return compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics.map((diagnostic) =>
      [text.slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset), diagnostic.message] as const
    );
  };
  // `ping` holds `q`, whose body calls `ping`; `rec` is that call.
  const ping = (q: string, uses: string, rec = "ping(n - 1)", probe = "ping(2)") =>
    `fun\n    ping(n: Int): Int =\n${q.replaceAll("REC", rec)}${uses}        0\nexport let probe(): Int = ${probe}\n`;
  const body = "            cb!()\n            let _ = if n > 0 then REC else 0\n            ()\n";
  const promise = "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the " +
    "demand is written `->`";

  it("calls a held lambda handed only pure functions bare, however its callback is written", () => {
    // Main held `q`'s callback as one colour for every use, which nothing
    // decided, so `q(noop)` and `ping(n - 1)` wanted `!`.
    for (
      const [q, use] of [
        ["        let q: (() ->! Unit) >-> Unit = (cb) =>\n" + body, "q(noop)"],
        ["        let q = (((cb) =>\n" + body.trimEnd() + "): (() ->! Unit) >-> Unit)\n", "q(noop)"],
        ["        let q(): (() ->! Unit) >-> Unit = (cb) =>\n" + body, "q()(noop)"],
        ["        let q = (cb: () ->! Unit) =>\n" + body, "q(noop)"],
        ["        let q = (cb) =>\n" + body, "q(noop)"],
      ] as const
    ) {
      const source = ping(q, `        ${use}\n`);
      expect([source, check(source)]).toEqual([source, []]);
      expect(hover(source, "ping(n: Int)")).toBe("Int -> Int");
    }
    expect(hover(ping("        let q = (cb) =>\n" + body, "        q(noop)\n"), "q = ")).toBe("(() ->! Unit) >-> Unit");
  });

  it("decides a held lambda's untyped callback by its own calls, so it takes a function that touches the world", () => {
    // Main defaulted `cb` pure at `ping`'s close, before `q`'s `!` ran it,
    // and refused `q!(save0)` as if a `->` were written.
    const direct = ping("        let q = (cb) =>\n" + body, "        q!(save0)\n", "ping!(n - 1)", "ping!(2)");
    expect(check(direct)).toEqual([]);
    expect(hover(direct, "q = ")).toBe("(() ->! Unit) ->! Unit");
    expect(hover(direct, "ping(n: Int)")).toBe("Int ->! Int");
    // Run by a lambda the knot holds inside it, the callback is still its.
    const nested = (rec: string) => "        let q = (cb) =>\n            let r = () =>\n                cb!()\n" +
      `                let _ = if n > 0 then ${rec} else 0\n                ()\n            r!()\n`;
    expect(check(ping(nested("ping(n - 1)"), "        q(noop)\n"))).toEqual([]);
    expect(check(ping(nested("ping!(n - 1)"), "        q!(save0)\n", "ping!(n - 1)", "ping!(2)"))).toEqual([]);
  });

  it("leaves a held lambda's callbacks its own under a written `->!` face, so no use ties them", () => {
    // Main bound `cb`'s one colour to `act`'s at `q!(act)`, and refused a tie.
    expect(check("fun\n    ping(n: Int, act): Int =\n" +
      "        let q: (() ->! Unit) ->! Unit = (cb: () ->! Unit) =>\n" + body.replace("REC", "ping!(n - 1, act)") +
      "        q!(act)\n        q!(noop)\n        0\nexport let probe(): Int = ping!(2, noop)\n")).toEqual([]);
  });

  it("reports a held lambda's `>->` at the recursive call that runs the world, in every spelling (#1238)", () => {
    // Main reported at the argument `save0`, whose colour `q`'s one callback
    // colour had taken.
    const own = "this call is impure and may fail on its own account, and this face's `>->` promises the function is only " +
      "as effectful as what it is handed — write `->!`";
    for (
      const [q, use] of [
        ["        let q: (() ->! Unit) >-> Unit = (cb) =>\n" + body, "q!(save0)"],
        ["        let q = (((cb) =>\n" + body.trimEnd() + "): (() ->! Unit) >-> Unit)\n", "q!(save0)"],
        ["        let q(): (() ->! Unit) >-> Unit = (cb) =>\n" + body, "q()!(save0)"],
      ] as const
    ) {
      const source = ping(q, `        ${use}\n`, "ping!(n - 1)", "ping!(2)");
      expect([source, reports(source)]).toEqual([source, [["ping!(n - 1)", own]]]);
    }
  });

  it("lets a refused `>->` over a held lambda read what it runs through the recursion", () => {
    // The refused face keeps reading as the join (§4.2), and the part that
    // waits is what the recursion runs: `q!(noop)` keeps its mark.
    expect(reports("fun\n    ping(n: Int, act): Int =\n" +
      "        let q: (() ->! Unit) >-> Unit = (cb: () ->! Unit) =>\n" + body.replace("REC", "ping!(n - 1, act)") +
      "        q!(save0)\n        q!(noop)\n        0\n")).toEqual([[
        "ping!(n - 1, act)",
        "this call is impure and may fail on its own account, and this face's `>->` promises the function is only " +
        "as effectful as what it is handed — write `->!`",
      ]]);
  });

  it("keeps a held lambda's written `->` face meeting what its callbacks run", () => {
    // Taken out of what the knot reads, the callback still meets the face
    // where the lambda closes, as outside a knot: `q(save0)` is refused.
    const q = (rec: string) => "let q: (() ->! Unit) -> Unit = (cb) =>\n    cb!()\n" + rec + "    ()\nq(save0)\n0\n";
    const indent = (text: string, by: string) => text.split("\n").map((line) => line === "" ? line : by + line).join("\n");
    const knot = "fun\n    ping(n: Int): Int =\n" + indent(q("    let _ = if n > 0 then ping(n - 1) else 0\n"), "        ");
    const lone = "let ping(n: Int): Int =\n" + indent(q(""), "    ");
    expect(check(knot)).toEqual(check(lone));
    expect(check(knot)).toContain(promise);
  });

  it("keeps a callback tied to a member's parameter in the knot's hands", () => {
    expect(check("fun\n    ping(n: Int, act: () ->! Unit): Int =\n        let q = (cb) =>\n" +
      "            let _ = pick(cb, act)\n            cb!()\n            let _ = if n > 0 then ping!(n - 1, act) else 0\n" +
      "            ()\n        q!(noop)\n        pureOnly(act)\n        0\nexport let probe(): Int = ping!(2, noop)\n"))
      .toContain("`cb`'s colour is tied to `act`'s here, and inference cannot keep them apart — write `cb`'s type, or wrap `cb` where they meet");
  });

  it("leaves a signature written inside a held lambda its own too", () => {
    // `p` is one value (`ident(…)` is a call), and its callback's colour is
    // the held lambda's to generalize, as outside a knot.
    const q = "let q = (cb: () ->! Unit) =>\n    let p: (() ->! Unit) >-> Unit = ident((f) => f!())\n    p!(noop)\n" +
      "    cb!()\nREC    ()\nq(noop)\n0\n";
    const indent = (text: string, by: string) => text.split("\n").map((line) => line === "" ? line : by + line).join("\n");
    expect(check("fun\n    ping(n: Int): Int =\n" +
      indent(q.replace("REC", "    let _ = if n > 0 then ping(n - 1) else 0\n"), "        "))).toEqual([]);
  });

  it("closes what main accepted where a held lambda's one callback colour hid what a use handed it", () => {
    // Main published `ping` pure in both, and a bare `ping(2)` saved.
    const wants = (callee: string) => `this call is impure and may fail, so \`${callee}\` wants \`!\`, not no mark`;
    const nested = (mark: string) => "fun\n    ping(n: Int): Int =\n        fun loop(m: Int): Int =\n" +
      "            let q = (cb: () ->! Unit) =>\n                cb!()\n" +
      `                let _ = if m > 0 then loop${mark}(m - 1) else if n > 0 then ping${mark}(n - 1) else 0\n` +
      `                ()\n            q!(save0)\n            0\n        loop${mark}(n)\nexport let probe(): Int = ping${mark}(2)\n`;
    expect(check(nested(""))).toEqual([wants("loop"), wants("ping"), wants("loop"), wants("ping")]);
    expect(check(nested("!"))).toEqual([]);
    expect(hover(nested("!"), "ping(n: Int)")).toBe("Int ->! Int");
    // A use inside a function handed to the held lambda itself.
    const self = (mark: string) => "let seq(x: Unit, y: Int): Unit = ()\nfun\n    ping(n: Int): Int =\n" +
      `        let q = (cb) => seq(cb!(), if n > 0 then ping${mark}(n - 1) else 0)\n` +
      `        q${mark}(() => q${mark}(save0))\n        0\nexport let probe(): Int = ping${mark}(2)\n`;
    expect(check(self(""))).toEqual([wants("ping"), wants("q"), wants("q"), wants("ping")]);
    expect(check(self("!"))).toEqual([]);
  });

  it("closes the arrows inside a held lambda's untyped callback where it closes", () => {
    // An arrow under a constructor in what the callback hands back is `->!`,
    // as outside a knot, unless a bare call pins it pure (#1380): `h()` does.
    const source = "fun\n    ping(n: Int): Int =\n        let q = (cb) =>\n            let _ = if n > 0 then ping(n - 1) else 0\n" +
      "            match cb()\n                Some(h) => h()\n                None => ()\n        q(() => Some(noop))\n        0\n";
    expect(check(source)).toEqual([]);
  });

  it("still runs through the recursion what one use hands", () => {
    // `q!(save0)` makes `ping` touch the world, and `q(noop)` runs `ping`.
    expect(check(ping("        let q = (cb: () ->! Unit) =>\n" + body, "        q(noop)\n        q!(save0)\n",
      "ping!(n - 1)", "ping!(2)"))).toEqual(["this call is impure and may fail, so `q` wants `!`, not no mark"]);
  });

  it("holds a lambda a member hands back whole: its parameters are the member's", () => {
    // `cb()` written bare is a fact, so `cb` is pure and the member's recursive
    // `!` is the mark it contradicts (§3.4); the member hands back a lambda
    // whose callback is pure, which `probe` then hands `save0`.
    expect(check("fun a(n: Int) = (cb) => if n == 0 then cb() else a(n - 1)!(cb)\n" +
      "export let probe(): Unit = a(2)!(save0)\n")).toEqual([
      // One report for the fact: `save0` handed against it is a label (#1310),
      // and so is `probe`'s `!`, read through the lambda `a(2)` hands back (#1307).
      "this call is pure and cannot fail, so this call wants no mark, not `!` — `cb` is called bare, which makes it pure " +
      "and unable to fail",
    ]);
    // Under a `match` too, where the refusal of a function the member was not
    // given stands alone.
    const given = (member: string) => `this function is not one \`${member}\` was given, and a recursive call ` +
      "hands on only the callbacks it was given";
    expect(check("fun\n    a(n: Int) =\n            match n\n                0 => (cb) => save!(\"x\")\n" +
      "                _ => ((cb) => if n > 3 then b(n - 1)!(cb) else cb())\n" +
      "    b(n: Int) = ((if n > 1 then (cb) => cb() else (cb) => a(n - 1)(cb)): (() ->! Unit) ->! Unit)\n" +
      "export let probe(): Unit = a(2)(save0)\n")).toEqual([given("a"), given("b")]);
    // Through an `if` and the `let` a block's last line names.
    expect(check("fun\n    b(n: Int): (() ->! Unit) ->! Unit =\n" +
      "            let f = if n > 1 then (cb) => a(n - 1)(cb) else ((cb) => if n > 3 then b(n - 1)(cb) else cb())\n" +
      "            f\n    a(n: Int) = ((if n > 1 then (cb) => b(n - 1)!(cb) else (cb) => a(n - 1)!(cb)): (() ->! Unit) ->! Unit)\n" +
      "export let probe(): Unit = a(2)!(save0)\n")).toEqual([given("b"), given("b"), given("a"), given("a")]);
  });

  it("reads a held lambda as the same lambda outside the recursion", () => {
    const q = "let q = (cb, cc) =>\n    cb()\nREC    ()\nq!(noop, act)\nq!(act, () => ())\n0\n";
    const indent = (text: string, by: string) => text.split("\n").map((line) => line === "" ? line : by + line).join("\n");
    const knot = "fun\n    ping(n: Int, act): Int =\n" +
      indent(q.replace("REC", "    let _ = if n > 0 then pong(n - 1, act) else 0\n"), "        ") +
      "    pong(n: Int, act): Int = if n > 0 then ping(n - 1, act) else 0\n";
    const lone = "let ping(n: Int, act): Int =\n" + indent(q.replace("REC", ""), "    ");
    const probe = "export let probe(): Int = ping!(2, save0)\n";
    // `save0` handed where the bare `cb()` made `act` pure names that fact, and
    // the parameter of `ping` it is handed to (#1240), in both.
    const fact = "this function is impure and may fail, where the function handed must be pure " +
      "and unable to fail — `cb` is called bare, which makes `act` pure and unable to fail";
    expect(check(knot + probe).filter((message) => !message.includes("perhaps"))).toEqual(
      check(lone + probe).filter((message) => !message.includes("perhaps") && !message.startsWith("this call is pure")),
    );
    expect(check(lone + probe)).toContain(fact);
    // A mark no fact explains is a suggestion where something is out of sight
    // (Declarations Preamble §1.1): in the knot, `q`'s recursion hands `act`
    // on, so whether `q!(noop, act)` runs it is out of sight; its twin's is not.
    expect(check(knot + probe).filter((message) => message.includes("perhaps"))).toHaveLength(1);
  });

  it("carries what a use hands a held lambda into the knot's colours, through room the knot holds (#1334)", () => {
    // `q` merges its callback with `r`, which runs `ping`, and with `outer`'s
    // `f`, so the room of that merge is the knot's to hold. `save0`, handed
    // to `q` inside a lambda handed to `q`, makes both calls impure, and
    // `ping` with them, as outside the knot; main recorded the meeting as a
    // demand and accepted every call bare.
    const knot = (mark: string): string =>
      "let outer(f): Int =\n    fun\n        ping(n: Int): Int =\n" +
      `            let r = () =>\n                let _ = if n > 0 then ping${mark}(n - 1) else 0\n                ()\n` +
      "            let q = (cb, c: Bool) =>\n                let h = if c then cb else (if c then r else f)\n" +
      `                h!()\n                ()\n            q${mark}(() => q${mark}(save0, True), True)\n            0\n` +
      `    ping${mark}(2)\nexport let probe(): Int = outer${mark}(noop)\n`;
    const wants = (callee: string) => `this call is impure and may fail, so \`${callee}\` wants \`!\`, not no mark`;
    expect(reports(knot(""))).toEqual([
      ["ping(n - 1)", wants("ping")],
      ["q(() => q(save0, True), True)", wants("q")],
      ["q(save0, True)", wants("q")],
      ["ping(2)", wants("ping")],
      ["outer(noop)", wants("outer")],
    ]);
    expect(check(knot("!"))).toEqual([]);
    // A pure nested use first leaves the merge no room, so `save0` meets the
    // colours of `r` and of the lambda alone, a hard case `f` sank below the
    // knot: it settles at the knot's close, which reads it as a source.
    const first = (mark: string): string =>
      knot(mark).replace(`q${mark}(() => q${mark}(save0, True), True)`, `q${mark}(() => q${mark}(noop, True), True)\n            q${mark}(save0, True)`);
    expect(reports(first(""))).toEqual([
      ["ping(n - 1)", wants("ping")],
      ["q(() => q(noop, True), True)", wants("q")],
      ["q(noop, True)", wants("q")],
      ["q(save0, True)", wants("q")],
      ["ping(2)", wants("ping")],
      ["outer(noop)", wants("outer")],
    ]);
    expect(check(first("!"))).toEqual([]);
    // Two pure nested uses tie the knot's colours to `f`'s, with no room left:
    // they follow `f`'s, so `outer`'s face carries `f`, and the merge is the
    // tie its twin reports, written the same way: `outer`'s caller, handing
    // `save0`, owes the mark too.
    const viaF = (mark: string): string =>
      knot(mark)
        .replace(`q${mark}(() => q${mark}(save0, True), True)`, `q${mark}(() => q${mark}(noop, False), False)\n            q${mark}(() => q${mark}(noop, False), False)`)
        .replace(`outer${mark}(noop)`, `outer${mark}(save0)`);
    // A third use ties a second case to `f` only through the first, read
    // again once the first is met: the face follows in both.
    const thrice = (mark: string): string =>
      viaF(mark).replace(`            outer${mark}(save0)`, `            outer${mark}(save0)`)
        .replace(`q${mark}(() => q${mark}(noop, False), False)\n            0`, `q${mark}(() => q${mark}(noop, False), False)\n            q${mark}(() => q${mark}(noop, False), False)\n            0`);
    for (const each of [viaF("!"), thrice("!")]) {
      expect([each, hover(each, "outer(f)")]).toEqual([each, "(() ->! Unit) >-> Int"]);
    }
    for (const mark of ["", "!"]) {
      const text = prelude + viaF(mark);
      const ties = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics
        .filter(({ message }) => message.includes("inference cannot keep them apart"))
        .map(({ labels, fixes }) => [
          (labels ?? []).map(({ span }) => text.slice(span.start.offset, span.end.offset)).sort(),
          (fixes ?? []).flatMap((fix) => fix.edits.map((edit) => edit.replacement)),
        ]);
      expect([mark, ties]).toEqual([mark, [[["cb", "f"], [": () ->! Unit", ": () ->! Unit"]]]]);
    }
    expect(reports(viaF(""))).toContainEqual(["outer(save0)", wants("outer")]);
  });

  it("gives what a use meets to what the use chose, never to a colour its knot decides (#1247)", () => {
    // `r` runs `ping`, so where `q!(save0, True)` meets `save0` its colour
    // waits on the knot. The merge joined it with room, which `q`'s instance
    // makes the use's: the use's part takes `save0`, as in the twin, where
    // `r`'s colour is decided before `q` closes and the join is the room alone.
    const q = (merge: string) =>
      "        let r = () =>\n            let _ = if n > 0 then REC else 0\n            ()\n" +
      `        let q = (cb, b: Bool) =>\n            let h = ${merge}\n            h!()\n            ()\n`;
    for (const merge of ["if b then cb else r", "pick(cb, r)"]) {
      const marked = ping(q(merge), "        q!(save0, True)\n", "ping!(n - 1)", "ping!(2)");
      expect([marked, check(marked)]).toEqual([marked, []]);
      // `ping` is impure, so the call `r` writes bare is refused, and only it.
      const bare = ping(q(merge), "        q!(save0, True)\n", "ping(n - 1)", "ping!(2)");
      expect([bare, reports(bare)]).toEqual([bare, [
        ["ping(n - 1)", "this call is impure and may fail, so `ping` wants `!`, not no mark"],
      ]]);
      // Where `ping` runs no impure call, the knot decides `r` pure.
      const later = ping(q(merge), "        let later = () => q!(save0, True)\n        q(noop, True)\n");
      expect([later, check(later)]).toEqual([later, []]);
    }
  });
});

describe("Effects §2.6 — a short form reads as its longhand twin (#1213 (T))", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet ident(x: a): a = x\n" +
    "let pick(x: a, y: a): a = y\nlet tieTwo(x: a, y: a): Unit = ()\n" +
    "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    (run, 1)\n";
  const outer = (lines: readonly string[]): string =>
    prelude + "export let outer(a1: () ->! Unit, a2: () ->! Unit): Unit =\n    let (r, _) = make()\n" +
    lines.map((line) => `    ${line}\n`).join("") + "    ()\n" +
    "let user(p, q) = outer!(p, q)\nexport let top(): Unit = outer(noop, noop)\n";
  /** Each line placed first, between and last among the two callbacks `r` is handed. */
  const placed = (line: string): string[][] => [
    [line, "r!(a1)", "r!(a2)"],
    ["r!(a1)", line, "r!(a2)"],
    ["r!(a1)", "r!(a2)", line],
  ];
  const follows = "(() ->! Unit, () ->! Unit) >-> Unit";

  it("reads a value at a written seat as its eta-expansion, in every order: no tie, and no collapse", () => {
    // Verdict Table rows 84 and 84b: met last, the seat collapsed to `->!`;
    // met first, `a1` and `a2` were made one colour, which `user` met as a tie.
    for (
      const seat of [
        "let h: (() ->! Unit) ->! Unit = r",
        "let h = (r : (() ->! Unit) ->! Unit)",
        "let mk(): (() ->! Unit) ->! Unit = r\n    let h = mk()",
        "let h: (() -> Unit) ->! Unit = r",
      ]
    ) {
      for (const lines of placed(seat)) {
        const source = outer(lines);
        expect([lines, effectDiagnostics([["/world.js", ""], ["/main.hex", source]])]).toEqual([lines, []]);
        expect([lines, hoveredType(source, "outer(a1")]).toEqual([lines, follows]);
      }
    }
  });

  it("reads a lambda written in place as its let-bound twin, in every order", () => {
    for (
      const meet of [
        "tieTwo(r, (g: () ->! Unit) => a2!())",
        "tieTwo(r, (g: () ->! Unit) => g!())",
        "let z = pick(r, (g: () ->! Unit) => a2!())",
        "let z = if True then r else (g: () ->! Unit) => a2!()",
      ]
    ) {
      for (const lines of placed(meet)) {
        const source = outer(lines);
        expect([lines, effectDiagnostics([["/world.js", ""], ["/main.hex", source]])]).toEqual([lines, []]);
        expect([lines, hoveredType(source, "outer(a1")]).toEqual([lines, follows]);
      }
    }
  });

  it("reads the value through what it supplies: a tuple's, an `Option`'s or a vector's function, and what a function returns", () => {
    for (
      const seat of [
        "let p: ((() ->! Unit) ->! Unit, Int) = (r, 1)",
        "let p: Option((() ->! Unit) ->! Unit) = Some(r)",
        "let p: Vector((() ->! Unit) ->! Unit) = [r]",
      ]
    ) {
      for (const lines of placed(seat)) {
        const source = outer(lines);
        expect([lines, effectDiagnostics([["/world.js", ""], ["/main.hex", source]])]).toEqual([lines, []]);
        expect([lines, hoveredType(source, "outer(a1")]).toEqual([lines, follows]);
      }
    }
    // A pure callback the seat writes, handed to a function that accepts any.
    const holder = "record Holder = { run: (() ->! Unit) -> Unit }\nlet hold = Holder({ run = (f) => () })\n" +
      "let takeAny(k) = hold.run(k)\n";
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", prelude + holder +
      "export let go(): Unit =\n    let q: (Int) -> ((() -> Unit) -> Unit) = ident((n: Int) => takeAny)\n    q(1)(noop)\n"]]))
      .toEqual([]);
  });

  it("reads a lambda written in place as its let-bound twin where its callback is bound outside it too", () => {
    // `g` is handed to `r`, so its colour is `r`'s, as at a `let`: the twin's
    // verdict and face, whatever they are, in every order.
    for (const lines of placed("tieTwo(r, (g: () ->! Unit) => r!(g))")) {
      const twin = lines.map((line) => line.startsWith("tieTwo") ? "let lam = (g: () ->! Unit) => r!(g)\n    tieTwo(r, lam)" : line);
      const verdict = (source: string) => [
        effectDiagnostics([["/world.js", ""], ["/main.hex", source]]),
        hoveredType(source, "outer(a1"),
      ];
      expect([lines, verdict(outer(lines))]).toEqual([lines, verdict(outer(twin))]);
    }
  });

  it("publishes the written parameters, as the expansion's own would be", () => {
    // The seat no longer pins `r`'s callback pure, but `h` is what was written:
    // it accepts only a pure callback, at a binding, an ascription and a
    // written result type alike.
    const purity = "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the demand is written " +
      "`->`";
    for (
      const body of [
        "    let (r, _) = make()\n    let h: (() -> Unit) ->! Unit = r\n    h!(save0)\n",
        "    let (r, _) = make()\n    (r : (() -> Unit) ->! Unit)!(save0)\n",
      ]
    ) {
      const reports = effectDiagnostics([["/world.js", ""], ["/main.hex",
        prelude + "let save0(): Unit = save!(\"x\")\nexport let go(): Unit =\n" + body]]);
      expect([body, reports.map((message) => message.startsWith(purity))]).toEqual([body, [true]]);
    }
    const keep = "let keep(cb: () ->! Unit): Unit = ()\nlet save0(): Unit = save!(\"x\")\n" +
      "fun a(n: Int): (() -> Unit) -> Unit =\n    let f = if n > 1 then keep else (cb) => ()\n    f\n";
    const reports = effectDiagnostics([["/world.js", ""], ["/main.hex",
      prelude + keep + "export let probe(): Unit = a(2)(save0)\n"]]);
    expect(reports.map((message) => message.startsWith(purity))).toEqual([true]);
  });

  it("reads a seat whose count does not match as written: the mismatch, and no mark judged by it", () => {
    // `h` runs `save0`, so its `!` is right: the mismatch is the report.
    for (const [seat, call] of [["let h: (() ->! Unit, Int) ->! Unit = r", "h!(save0, 1)"]]) {
      const reports = effectDiagnostics([["/world.js", ""], ["/main.hex",
        prelude + "let save0(): Unit = save!(\"x\")\nexport let outer(): Unit =\n    let (r, _) = make()\n" +
        `    ${seat}\n    ${call}\n    ()\n`]]);
      expect([seat, reports.filter((message) => message.includes("wants no mark"))]).toEqual([seat, []]);
    }
  });

  it("reads a callback a lambda in place captures as its let-bound twin does (b1170 `tieAct`)", () => {
    // `r` runs only what it is handed: a pure lambda here, so the call is pure,
    // written bare, as the twin reads it, whatever `tieTwo` met.
    for (const lambda of ["(g: () ->! Unit) => action!()", "lam"]) {
      const before = lambda === "lam" ? "    let lam = (g: () ->! Unit) => action!()\n" : "";
      const source = (call: string) => prelude + "export let outer(action: () ->! Unit): Unit =\n" +
        "    let (r, _) = make()\n" + before + `    tieTwo(${lambda}, r)\n    ${call}\n    ()\n`;
      expect([lambda, effectDiagnostics([["/world.js", ""], ["/main.hex", source("r(() => ())")]])]).toEqual([lambda, []]);
      expect([lambda, effectDiagnostics([["/world.js", ""], ["/main.hex", source("r!(() => ())")]])])
        .toEqual([lambda, [pureAndTotal("this call is pure and cannot fail, so `r` wants no mark, not `!`")]]);
    }
  });

  it("keeps what the longhand keeps: a parameter's arrow inside a callback is the impure constant", () => {
    // `keepRunner` may hand `r` any function, so `r` is impure, and
    // `outer` with it, in every order, as `(cb) => r!(cb)` handed there would.
    for (const lines of placed("keepRunner(r)")) {
      const source = outer(lines).replace(
        "export let outer",
        "let keepRunner(k: (() ->! Unit) ->! Unit): Unit = ()\nexport let outer",
      );
      expect([lines, hoveredType(source, "outer(a1")]).toEqual([lines, "(() ->! Unit, () ->! Unit) ->! Unit"]);
    }
  });
});

describe("Effects §2.6, §3.4 — a written callback colour a value took in grows as the value's (#1249)", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n" +
    "let ident(x: a): a = x\nlet pick(x: a, y: a): a = y\nlet tieTwo(x: a, y: a): Unit = ()\n" +
    "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    (run, 1)\n";
  const outer = (lines: readonly string[], probe = "export let top(): Unit = outer(noop, noop)\n"): string =>
    prelude + "export let outer(a1: () ->! Unit, a2: () ->! Unit): Unit =\n    let (r, _) = make()\n" +
    lines.map((line) => `    ${line}\n`).join("") + "    ()\n" + "let user(p, q) = outer!(p, q)\n" + probe;
  const reports = (source: string): readonly string[] => effectDiagnostics([["/world.js", ""], ["/main.hex", source]]);
  const follows = "(() ->! Unit, () ->! Unit) >-> Unit";
  const lam = "let lam = (g: () ->! Unit) => r!(g)";
  /** Every order of some lines, the lambda's binding kept before its uses. */
  const orders = (lines: readonly string[]): string[][] =>
    lines.length <= 1 ? [[...lines]] : lines.flatMap((line, index) =>
      orders([...lines.slice(0, index), ...lines.slice(index + 1)]).map((rest) => [line, ...rest])
    );

  it("grows to cover each callback the lambda is handed, so two stay two, in every order", () => {
    // `g`'s colour went into `r`'s, so no generalization reaches it: from the
    // lambda's close it is `r`'s, and grows as `r`'s does. Held as a callback's,
    // it tied `a1` to `a2`, which `user` met as a tie of `p` and `q`.
    for (const uses of orders(["lam!(a1)", "lam!(a2)", "r!(a1)"])) {
      const source = outer([lam, ...uses]);
      expect([uses, reports(source)]).toEqual([uses, []]);
      expect([uses, hoveredType(source, "outer(a1"), hoveredType(source, "user(p")]).toEqual([uses, follows, follows]);
    }
    // The untyped twin's `g` shares `r`'s colour, which `outer` reads where it
    // closes, from all its facts: it holds the written `a1`, so `g` is tied,
    // in every order, and the fix is the written lambda above (#1293).
    for (const uses of [["lam!(a1)", "lam!(a2)"], ["r!(a1)", "lam!(a2)"], ["lam!(a2)", "r!(a1)"]]) {
      const messages = reports(outer(["let lam = (g) => r!(g)", ...uses]));
      expect([uses, messages.length, messages[0]?.startsWith("`g`'s colour is tied to `a")]).toEqual([uses, 1, true]);
    }
  });

  it("neither ties nor rounds up where it meets the value as one type, in every order", () => {
    // Met first, `g`'s colour bound `r`'s and tied `a1` to `a2`; met after `r`
    // took a callback in, a held colour could not equal a grown one, and
    // `outer` rounded up to `->!`. Written in place, the lambda reads as its
    // let-bound twin (#1213 (T)), so it grows the same way.
    for (
      const meet of [
        [lam, "tieTwo(r, lam)"],
        [lam, "let z = pick(r, lam)"],
        [lam, "let z = if True then r else lam"],
        [lam, "let z = [r, lam]"],
        ["tieTwo(r, (g: () ->! Unit) => r!(g))"],
      ]
    ) {
      const placed = [[...meet, "r!(a1)", "r!(a2)"], ["r!(a1)", ...meet, "r!(a2)"], ["r!(a1)", "r!(a2)", ...meet]];
      for (const lines of placed) {
        const source = outer(lines);
        expect([lines, reports(source)]).toEqual([lines, []]);
        expect([lines, hoveredType(source, "outer(a1")]).toEqual([lines, follows]);
      }
    }
  });

  it("meets a value that took more in than itself: what they share grows to cover the rest", () => {
    // `r` took `a1` before the lambda was made, so where the two meet as one
    // type, `r`'s colour holds all of the lambda's and `a1` besides. Rule 4: a
    // slack they share takes `a1`, as rule 3 rebinds a variable.
    for (const uses of orders(["lam!(a2)", "tieTwo(r, lam)"])) {
      const source = outer(["r!(a1)", lam, ...uses]);
      expect([uses, reports(source)]).toEqual([uses, []]);
      expect([uses, hoveredType(source, "outer(a1")]).toEqual([uses, follows]);
    }
  });

  it("is checked on each colour on its own", () => {
    const one = (arrow: string, mark: string, face: string) => {
      const source = prelude + `export let outer(a1: () ${arrow} Unit, a2: () ${arrow} Unit): Unit =\n` +
        `    let (r, _) = make()\n    let lam = (g: () ${arrow} Unit) => r${mark}(g)\n` +
        `    lam${mark}(a1)\n    lam${mark}(a2)\n    ()\nlet user(p, q) = outer${mark}(p, q)\n` +
        "export let top(): Unit = outer(() => (), () => ())\n";
      expect([arrow, reports(source), hoveredType(source, "outer(a1")]).toEqual([arrow, [], face]);
    };
    one("->^", "^", "(() ->^ Unit, () ->^ Unit) >^> Unit");
    one("->~", "~", "(() ->~ Unit, () ->~ Unit) >~> Unit");
  });

  it("is one colour for every use, as the value's is", () => {
    // The lambda generalizes nothing, so a call is marked for everything it has
    // been handed: `r` has run `a1` through it.
    expect(reports(outer([lam, "lam!(a1)", "lam(noop)"])))
      .toEqual(["this call is impure and may fail, so `lam` wants `!`, not no mark"]);
    // A pure function handed first leaves room to grow: `a1` and `a2` stay two
    // colours, and the bare call wants `!` for what came after.
    for (const lines of [[lam, "lam(noop)", "lam!(a1)", "lam!(a2)"], [lam, "lam(noop)", "tieTwo(r, lam)", "r!(a1)", "r!(a2)"]]) {
      const source = outer(lines);
      expect([lines, reports(source)]).toEqual([lines, ["this call is impure and may fail, so `lam` wants `!`, not no mark"]]);
      expect([lines, hoveredType(source, "user(p")]).toEqual([lines, follows]);
    }
    // What the callbacks may do still reaches the callers.
    expect(reports(outer([lam, "lam!(a1)", "lam!(a2)"], "export let top(): Unit = outer(noop, save0)\n")))
      .toEqual(["this call is impure and may fail, so `outer` wants `!`, not no mark"]);
    // Inside a knot as outside it.
    const knot = prelude + "fun\n    ping(n: Int, a1: () ->! Unit, a2: () ->! Unit): Int =\n" +
      "        let (r, _) = make()\n        let lam = (g: () ->! Unit) => r!(g)\n        lam!(a1)\n        lam!(a2)\n" +
      "        if n > 0 then ping!(n - 1, a1, a2) else 0\nexport let top(): Int = ping(2, noop, noop)\n" +
      "let user(p, q) = ping!(1, p, q)\n";
    expect(reports(knot)).toEqual([]);
  });

  it("is the enclosing body's to decide, as the value's is, wherever it meets it", () => {
    // A body nested in `outer` that calls the lambda leaves its colour to
    // `outer`, which decides it from every use.
    expect(reports(outer([lam, "let k = () => lam!(a1)", "k!()", "lam!(a2)"]))).toEqual([]);
    expect(reports(outer([lam, "let k = () => lam(noop)", "lam!(a2)", "k()"]))).toEqual([
      "this call is impure and may fail, so `lam` wants `!`, not no mark",
      "this call is impure and may fail, so `k` wants `!`, not no mark",
    ]);
    // A lambda nested in it, one that runs a callback of `outer`'s itself, and
    // a second lambda that `r` takes in too, met as one type with the first.
    for (
      const lines of [
        ["let lam = (g: () ->! Unit) =>\n        let k = (h: () ->! Unit) => r!(h)\n        k!(g)", "lam!(a1)", "lam!(a2)"],
        ["let lam = (g: () ->! Unit) =>\n        r!(g)\n        r!(a1)", "lam!(a2)", "tieTwo(r, lam)"],
        [lam, "let lam2 = (g2: () ->! Unit) => r!(g2)", "lam!(a1)", "lam2!(a2)", "tieTwo(lam, lam2)"],
      ]
    ) {
      const source = outer(lines);
      expect([lines, reports(source)]).toEqual([lines, []]);
      expect([lines, hoveredType(source, "outer(a1")]).toEqual([lines, follows]);
    }
  });

  it("is left to generalization where the value is the lambda's own", () => {
    // `r2` is made in the lambda's body, so the binding generalizes `g`'s
    // colour, and each use meets an instance: `lam(noop)` is bare between two
    // effectful calls.
    const inBody = "let lam = (g: () ->! Unit) =>\n        let (r2, _) = make()\n        r2!(g)";
    expect(reports(outer([inBody, "lam!(a1)", "lam(noop)", "lam!(a2)"]))).toEqual([]);
    expect(reports(outer([inBody, "tieTwo(r, lam)", "lam(noop)", "r!(a1)"]))).toEqual([]);
    // And it keeps growing past what a meeting with more gave it.
    const three = prelude + "export let outer(a1: () ->! Unit, a2: () ->! Unit, a3: () ->! Unit): Unit =\n" +
      `    let (r, _) = make()\n    r!(a1)\n    ${lam}\n    lam!(a2)\n    tieTwo(r, lam)\n    lam!(a3)\n    ()\n` +
      "let user(p, q, s) = outer!(p, q, s)\n";
    expect(reports(three)).toEqual([]);
    expect(hoveredType(three, "outer(a1")).toBe("(() ->! Unit, () ->! Unit, () ->! Unit) >-> Unit");
  });

  it("stays the callback's colour inside the lambda's body: its calls are checked as written", () => {
    // Only its hold against growing ends. A bare call that runs `g` claims what
    // `g: () ->! Unit` does not, whatever the lambda is later handed, and
    // whether the lambda stays in `outer` or leaves it.
    const bare = "this call is impure and may fail, so `r` wants `!`, not no mark";
    expect(reports(outer(["let lam = (g: () ->! Unit) => r(g)", "lam!(a1)"]))).toEqual([bare]);
    expect(reports(outer(["let lam = (g: () ->! Unit) =>\n        r!(g)\n        g()", "lam!(a1)"])))
      .toEqual(["this call is impure and may fail, so `g` wants `!`, not no mark"]);
    for (const pair of ["(r, (g: () ->! Unit) => r(g))", "(r, lam)"]) {
      const before = pair === "(r, lam)" ? "    let lam = (g: () ->! Unit) => r(g)\n" : "";
      const source = prelude + "let mk() =\n    let (r, _) = make()\n" + before + `    ${pair}\n` +
        "export let probe(): Unit =\n    let (r1, l) = mk()\n    l!(save0)\n";
      expect([pair, reports(source)]).toEqual([pair, [bare]]);
    }
  });

  it("keeps the acceptance it was written with where nothing grows it", () => {
    // Nothing is handed to the lambda: its `->!` callback is still any
    // function, so the `!` inside is owed, and a lambda handed back keeps the
    // face it was written with.
    const alone = (lines: readonly string[]) => prelude + "export let outer(a1: () ->! Unit): Unit =\n" +
      "    let (r, _) = make()\n" + lines.map((line) => `    ${line}\n`).join("") + "    ()\n";
    expect(reports(alone([lam]))).toEqual([]);
    // `r` took in `g`, which may be any function, so a bare call of `r` is wrong.
    expect(reports(alone([lam, "r(noop)"])))
      .toEqual(["this call is impure and may fail, so `r` wants `!`, not no mark"]);
    const back = prelude + "let mk() =\n    let (r, _) = make()\n    let lam = (g: () ->! Unit) => r!(g)\n    lam\n" +
      "export let probe(): Unit = mk()!(save0)\n";
    expect(reports(back)).toEqual([]);
    expect(hoveredType(back, "mk()")).toBe("() -> (() ->! Unit) >-> Unit");
  });

  it("names the written arrow a pin narrows, as a callback's colour", () => {
    // A seat that writes the callback pure, before anything grows it, pins the
    // colour the lambda wrote: the report names `g`, beside `a1`, which the
    // pin reaches once `lam` is handed it. (Met after `lam!(a1)`, the pin
    // lands on what the colour grew into, `a1`, as on main.)
    const lie = (name: string) => `the parameter \`${name}\` is written \`->!\`, which accepts any function, and this ` +
      `accepts only one that is pure and cannot fail — write \`${name}\`'s arrow \`->\``;
    const seatFirst = reports(outer([lam, "let h: (() -> Unit) -> Unit = lam", "lam!(a1)"]));
    expect([seatFirst.includes(lie("g")), seatFirst.includes(lie("a1"))]).toEqual([true, true]);
  });

  it("leaves a lambda in place to its instances where its own value took the colour in", () => {
    // `r2` is made inside the lambda, so the lambda's own colour generalizes
    // there; `tieTwo` meets an instance, and `r2!(g)` is owed its mark.
    const inPlace = "tieTwo(r, (g: () ->! Unit) =>\n        let (r2, _) = make()\n        r2!(g))";
    expect(reports(outer([inPlace, "r!(a1)", "r!(a2)"]))).toEqual([]);
  });

  it("keeps growing where a merge binds it to another lambda's instance", () => {
    // `pick` makes `g`'s colour one with an instance of `lam2`'s own `h`; the
    // colour that results still grows, so `a1` and `a2` stay two colours.
    for (const tail of [["z!(a1)", "lam!(a2)"], ["lam!(a2)", "z!(a1)"]]) {
      for (const merge of ["pick(lam, lam2)", "pick(lam2, lam)"]) {
        const lines = [lam, "let lam2 = (h: () ->! Unit) => h!()", `let z = ${merge}`, ...tail];
        expect([lines, reports(outer(lines))]).toEqual([lines, []]);
      }
    }
  });

  it("is not reached where a value's type, not its colour, takes the callback in", () => {
    // `idf` is one value whose type variable takes `g`'s whole type in, so no
    // colour of a value took `g`'s colour in: it keeps its hold, and the two
    // callbacks tie, as on main and as the untyped twin does. Out of scope for
    // now; a follow-up decides whether a value's type taking it in counts too.
    const id = prelude.replace("let make() =", "let makeId() =\n    let idf = ident((f) => f)\n    (idf, 1)\nlet make() =");
    const source = id + "export let outer(a1: () ->! Unit, a2: () ->! Unit): Unit =\n    let (idf, _) = makeId()\n" +
      "    let lam = (g: () ->! Unit) =>\n        let w = idf(g)\n        w!()\n    lam!(a1)\n    lam!(a2)\n    ()\n" +
      "let user(p, q) = outer!(p, q)\n";
    expect(reports(source)).toEqual([
      "`p`'s colour is tied to `q`'s here, and inference cannot keep them apart — write `p`'s type, or wrap `p` where they meet",
    ]);
  });

  it("is held where no body decides the value: a module's value left open (#1283)", () => {
    const top = prelude + "let (r, _) = make()\n";
    // A top-level function's own callback, which a module-level `r` took in,
    // stays its callback: no body would decide it as `r`'s.
    expect(reports(top + "export let a(a1: () ->! Unit): Unit =\n    let t = () => r!(a1)\n    t!()\n" +
      "export let b(): Unit = r!(noop)\nexport let c(): Unit =\n    let w = [r, (g) => save!(\"y\")]\n    ()\n"))
      .toEqual([]);
    // Its two callbacks, which `r` took in, stay as main has them: `b(noop, noop)`
    // wants `!`, since `r`'s colour is the module's.
    expect(reports(top + "export let b(b1: () ->! Unit, b2: () ->! Unit): Unit =\n    r!(b1)\n    r!(b2)\n" +
      "export let top2(): Unit = b(noop, noop)\n"))
      .toEqual(["this call is impure and may fail, so `b` wants `!`, not no mark"]);
    // And where a merge of two callbacks meets that colour, it still rounds up.
    const merged = top + "export let a(a1: () ->! Unit): Unit = r!(a1)\n" +
      "export let u2(c: Bool, p: () ->! Unit, q: () ->! Unit): Unit = a!(if c then p else q)\n";
    expect(hoveredType(merged, "u2(c")).toBe("(Bool, () ->! Unit, () ->! Unit) ->! Unit");
    // So does a lambda's inside a function, where the module's `r` took it in:
    // today's tie stands until #1283 decides who decides such a colour.
    expect(reports(top + "export let outer(a1: () ->! Unit, a2: () ->! Unit): Unit =\n" +
      `    ${lam}\n    lam!(a1)\n    lam!(a2)\n    ()\nlet user(p, q) = outer!(p, q)\n`))
      .toEqual([
        "`p`'s colour is tied to `q`'s here, and inference cannot keep them apart — write `p`'s type, or wrap `p` where they meet",
      ]);
  });
});

describe("Effects §3.5 — a colour in error (#1223)", () => {
  const prelude = "module Main\n\n" + world + "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n" +
    "let pureOnly(f: () -> Unit): Unit = f()\nlet keep(cb: () ->! Unit): Unit = ()\n" +
    "let run(cb: () ->! Unit): Unit = cb!()\nlet pick(x: a, y: a): a = y\nlet ident(x: a): a = x\n";
  const check = (source: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", prelude + source]]);
  const hover = (source: string, needle: string): string | undefined => hoveredType(prelude + source, needle);
  const twoModules = (lib: string, main: string): readonly string[] =>
    effectDiagnostics([
      ["/world.js", ""],
      ["/lib.hex", "module Lib\n\n" + world + lib],
      ["/main.hex", "module Main\n\nimport Lib\n" + main],
    ]);
  const unknown = "unknown name `nope`";
  const wants = (callee: string): string => `this call is impure and may fail, so ${callee} wants \`!\`, not no mark`;
  const noMark = (callee: string): string => `this call is pure and cannot fail, so ${callee} wants no mark, not \`!\``;
  /** `noMark`, hedged: no cause is named (Declarations Preamble §1.1). */
  const hedged = (callee: string): string => pureAndTotal(noMark(callee));
  const made = "this function is not one `a` was given, and a recursive call hands on only the callbacks it was given";
  const bothMarks = (source: (mark: string) => string): readonly (readonly string[])[] =>
    ["!", ""].map((mark) => check(source(mark)));

  it("makes a body that calls an unknown name in error, and every body that runs it, whatever the marks", () => {
    // Main read the failed call as pure, and told `user!()` to remove a mark.
    for (const [inner, outer] of [["!", "!"], ["!", ""], ["", "!"], ["", ""]]) {
      expect(check(`let user(): Unit = nope${inner}(1)\nlet mid(): Unit = user${outer}()\n` +
        `export let probe(): Unit = mid${outer}()\n`)).toEqual([unknown]);
    }
    expect(check("let user(): Unit =\n    let k = () => nope!(1)\n    k!()\nexport let probe(): Unit = user!()\n"))
      .toEqual([unknown]);
    expect(hover("let user(): Unit =\n    let k = () => nope!(1)\n    k!()\n", "user")).toBe("() ->! Unit");
  });

  it("makes a call in error whose callee is no function, or none of its arity, unless the callee is impure", () => {
    expect(check("let user(): Unit =\n    let x = 1\n    x!()\nexport let probe(): Unit = user!()\n"))
      .toEqual(["`x` is not a function — it has type `Int`, and this call supplies no arguments"]);
    // Failing to be a function at the call: the call itself owes no mark either.
    expect(check("let user(): Unit = (1)!(2)\nexport let probe(): Unit = user!()\n"))
      .toEqual(["functions have no `Num` instance"]);
    expect(check("let user(): Unit = noop!(1)\nexport let probe(): Unit = user!()\n"))
      .toEqual(["this function takes no arguments; write `f()`"]);
    // `save` touches the world whatever it is handed: the missing mark is
    // drawn by every repair.
    expect(check("let user(): Unit = save!(\"x\", \"y\")\nexport let probe(): Unit = user()\n"))
      .toEqual(["function expects 1 arguments, got 2", wants("`user`")]);
  });

  it("makes a dot call in error whose subject the text does not decide or whose operation is not found", () => {
    expect(check("let user(x) = x.foo!()\nexport let probe(): Unit = user!(1)\n")).toEqual([
      "the program's text does not decide `x`'s type here, so `.foo(…)` cannot tell whose `foo` it is — write " +
      "`x`'s type, or call the operation by its module (`Module.foo(x, …)`); a record's field is called as " +
      "`(x.foo)(…)`",
    ]);
    expect(check("let user(r: {a: Int}): Unit = r.nope!()\nexport let probe(): Unit = user!({ a = 1 })\n"))
      .toEqual(["record has fields `a`, not `nope`"]);
    // An operation found, called with the wrong arity: the call owes no mark either.
    for (const mark of ["!", ""]) {
      expect(check(`let user(): Int = "s".length${mark}(1)\nexport let probe(): Int = user!()\n`))
        .toEqual(["function arity mismatch: 1 and 2"]);
    }
  });

  it("lets the impure constant win, whatever the order of the lines", () => {
    for (
      const body of [
        "    save!(\"x\")\n    nope!()\n",
        "    nope!()\n    save!(\"x\")\n",
        "    let k = () => nope!()\n    k!()\n    save!(\"x\")\n",
      ]
    ) {
      expect(check(`let user(): Unit =\n${body}export let probe(): Unit = user()\n`)).toEqual([unknown, wants("`user`")]);
    }
  });

  it("lets the impure constant win where a use in error is merged, whatever the order of the branches", () => {
    // A use re-opens a function in error as "in error or more", so a merge
    // raises it as it raises any opening.
    const user = "let user(): Unit = nope!()\n";
    for (const [first, second] of [["user", "save0"], ["save0", "user"]]) {
      expect(check(`${user}export let p1(c: Bool): Unit =\n    let k = if c then ${first} else ${second}\n    k()\n`))
        .toEqual([unknown, wants("`k`")]);
    }
    for (const [first, second] of [["() => nope!()", "() => save!(\"x\")"], ["() => save!(\"x\")", "() => nope!()"]]) {
      expect(check(`export let p1(c: Bool): () -> Unit = if c then (${first}) else (${second})\n`)).toEqual([
        "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the demand is written `->`",
        unknown,
      ]);
    }
    // Beside a pure function, the merge is in error, in either order and with either mark.
    for (const [first, second] of [["() => nope!()", "() => noop()"], ["() => noop()", "() => nope!()"]]) {
      expect(bothMarks((mark) =>
        `export let p1(c: Bool): Unit =\n    let k = if c then (${first}) else (${second})\n    k${mark}()\n`
      )).toEqual([[unknown], [unknown]]);
    }
  });

  it("absorbs a callback's colour beside it, and shows the face `->!`", () => {
    const user = "let user(f: () ->! Unit): Unit =\n    nope!(1)\n    f!()\n";
    for (const call of ["user(save0)", "user!(noop)", "user(noop)", "user!(save0)"]) {
      expect(check(`${user}export let probe(): Unit = ${call}\n`)).toEqual([unknown]);
    }
    expect(hover(user, "user")).toBe("(() ->! Unit) ->! Unit");
    // So is a callback merged with a use in error.
    expect(check("let user(): Unit = nope!()\nlet g(c: Bool, cb: () ->! Unit): Unit =\n    let k = if c then user else cb\n" +
      "    k()\n")).toEqual([unknown]);
  });

  it("puts what a function does in error where a value in error meets it", () => {
    for (const handed of ["nope", "() => nope!()"]) {
      expect(bothMarks((mark) => `export let probe(): Unit = run${mark}(${handed})\n`)).toEqual([[unknown], [unknown]]);
    }
    expect(check("let runU(cb) = cb!()\nexport let probe(): Unit = runU!(nope)\n")).toEqual([unknown]);
    // A written `->!` field it meets is no demand it fails.
    expect(check("export let probe(): Unit =\n    let r: { f: () ->! Unit } = { f = nope }\n    (r.f)!()\n"))
      .toEqual([unknown]);
    expect(bothMarks((mark) =>
      `let g(c: Bool, cb: () ->! Unit): Unit =\n    let k = if c then cb else nope\n    k!()\n` +
      `export let probe(): Unit = g${mark}(True, noop)\n`
    )).toEqual([[unknown], [unknown]]);
    // Two callbacks that each meet it are not tied to each other.
    expect(check("let g(c: Bool, f, h) =\n    let k = if c then f else nope\n    let j = if c then h else nope\n" +
      "    k!()\n    j!()\n")).toEqual([unknown, unknown]);
    expect(check("let g(c: Bool, f, h) =\n    f!()\n    h!()\n    let k = if c then f else nope\n" +
      "    let j = if c then h else nope\n    ()\n")).toEqual([unknown, unknown]);
    // A knot's sibling, and an instance's result, that meet it.
    expect(bothMarks((mark) =>
      "fun\n    a(n: Int): Unit =\n        let k = if n == 0 then b else nope\n        k!()\n    b(): Unit = a!(1)\n" +
      `export let probe(): Unit = b${mark}()\n`
    )).toEqual([[unknown], [unknown]]);
    expect(check(
      "constraint M<a> =\n    make(s: a) ->! (() ->! Int)\nrecord A = { n: Int }\nhonor M<A> =\n    make(s) = () => s.n\n" +
        "let probe(c: Bool, x: A): Int =\n    let k = if c then make(x) else nope\n    k!()\n",
    )).toEqual([unknown]);
  });

  it("makes an untyped parameter in error where it meets a colour in error, whatever the order of the lines", () => {
    // A value in error that meets the parameter, before or after a line makes
    // it a function (#1243 review r1, F1).
    for (
      const [first, second] of [
        ["f()", "let k = pick(f, nope)"],
        ["let k = pick(f, nope)", "f()"],
        ["let k = pick(ident(nope), f)", "f()"],
        ["let g = ident(nope)\n    let k = pick(g, f)", "f()"],
      ]
    ) {
      expect(check(`let outer(f): Unit =\n    ${first}\n    ${second}\n    ()\nexport let p1(): Unit = outer(save0)\n`))
        .toEqual([unknown]);
    }
    for (const [first, second] of [["f()", "let k = if c then f else nope"], ["let k = if c then f else nope", "f()"]]) {
      expect(check(
        `let outer(c: Bool, f): Unit =\n    ${first}\n    ${second}\n    ()\nexport let p1(): Unit = outer(True, save0)\n`,
      )).toEqual([unknown]);
    }
    // A use in error merged with it, whatever marks it (F2).
    const user = "let user(): Unit = nope!()\n";
    for (const [made_, merged] of [[user, "user"], ["", "(() => nope!())"]]) {
      expect(check(`${made_}let outer(c: Bool, f) =\n    let k = if c then f else ${merged}\n    k!()\n` +
        "export let p1(): Unit = outer!(True, noop)\n")).toEqual([unknown]);
    }
    for (const [first, second, call] of [["f!()", "let k = if c then f else user", "outer!(True, noop)"], [
      "let k = if c then f else user",
      "f()",
      "outer(True, save0)",
    ]]) {
      expect(check(`${user}let outer(c: Bool, f): Unit =\n    ${first}\n    ${second}\n    ()\nexport let p1(): Unit = ${call}\n`))
        .toEqual([unknown]);
    }
    // Handed to a call in error: whether that call runs it is what the error hides.
    expect(check(
      "let user(cb: () ->! Unit): Unit =\n    nope!()\n    cb!()\nlet g(f) =\n    user!(f)\n    f()\n" +
        "export let p(): Unit = g(save0)\n",
    )).toEqual([unknown]);
    // The subject of a dot call in error is handed to it.
    expect(check("let g(x) =\n    x.foo!()\n    x()\nexport let p(): Unit = g(save0)\n")).toEqual([
      "the program's text does not decide `x`'s type here, so `.foo(…)` cannot tell whose `foo` it is — write " +
      "`x`'s type, or call the operation by its module (`Module.foo(x, …)`); a record's field is called as " +
      "`(x.foo)(…)`",
    ]);
    // Handed inside a lambda that runs it: whether the call in error runs the
    // lambda, and under what mark, is what the error hides (#1243 review r2,
    // N2).
    expect(check("let outer(f) =\n    let h = () => nope(() => f())\n    f()\nexport let p1(): Unit = outer(save0)\n"))
      .toEqual([unknown]);
  });

  it("holds back the marks a written callback alone makes `!` where a demand in error meets it", () => {
    // Whether the failure pins it pure is what the error hides: a repair such
    // as `pureOnly(f)` or `let g: () -> Unit = f` would make `f` pure, its
    // `->!` a lie of generality.
    const nopeType = "unknown type `Nope`";
    for (
      const [meeting, errors] of [
        ["let g: Nope = f", [nopeType]],
        ["let g = (f : Nope)", [nopeType]],
        ["let k = (x) =>\n        let g: Nope = x\n        x\n    let y = k(f)", [nopeType]],
        ["nope(f)", [unknown]],
        ["nope(() => f!())", [unknown]],
        ["ident(nope)(f)", [unknown]],
        ["noop(f)", ["this function takes no arguments; write `f()`"]],
        ["let x = 1\n    x(f)", ["`x` is not a function — it has type `Int`, and this call supplies 1 argument"]],
        ["(1)(f)", ["functions have no `Num` instance"]],
        ["let n = \"s\".length(f)", ["function arity mismatch: 1 and 2"]],
        // A type variable the written error met, joined to another first.
        ["let k = (x, z) =>\n        let g: Nope = x\n        pick(x, z)\n    let y = k(noop, f)", [nopeType]],
        ["let k = (x, z) =>\n        let g: Nope = x\n        pick(z, x)\n    let y = k(noop, f)", [nopeType]],
      ] as const
    ) {
      expect(check(`let outer(f: () ->! Unit): Unit =\n    ${meeting}\n    f()\nexport let p1(): Unit = outer(save0)\n`))
        .toEqual(errors);
    }
    expect(check("let outer(r: {a: Int}, f: () ->! Unit): Unit =\n    r.nope(f)\n    f()\n"))
      .toEqual(["record has fields `a`, not `nope`"]);
    // A parameter written in error, one a failed call would have typed, or
    // one a value in error typed where its function was defined (review r3b,
    // m2): `Some(noop)` would make `user` take `Option(() -> Unit)`.
    for (
      const [user, call, errors] of [
        ["let user(g: Nope): Unit = ()\n", "user(f)", [nopeType]],
        ["let user(g) =\n    nope(g)\n    ()\n", "user(f)", [unknown]],
        ["let user(o) =\n    let g = pick(o, Some(nope))\n    ()\n", "user(Some(f))", [unknown]],
        ["let user(r) =\n    let g = pick(r, { h = nope })\n    ()\n", "user({ h = f })", [unknown]],
      ] as const
    ) {
      expect(check(`${user}let outer(f: () ->! Unit): Unit =\n    ${call}\n    f()\n`)).toEqual(errors);
    }
    // A type variable a written error met, joined to the callback in the same
    // body: the repair `let g: () -> Unit = x` pins it.
    expect(check("let outer(f: () ->! Unit, x) =\n    let g: Nope = x\n    let y = pick(x, f)\n    f()\n")).toEqual([
      nopeType,
      "`x`'s colour is tied to `f`'s here, and inference cannot keep them apart — write `x`'s type, or wrap `x` where they meet",
    ]);
    // An untyped parameter whose whole type a value in error decided is the
    // parameter's own: what its colours are its own calls decide (§3.4), and
    // no repair of the value pins it.
    expect(check("let user(g) =\n    let q = pick(g, nope)\n    ()\nlet outer(f: () ->! Unit): Unit =\n    user(f)\n    f()\n"))
      .toEqual([unknown, wants("`f`")]);
    // A `var`'s type written in error is a demand at each `:=`.
    expect(check("let outer(f: () ->! Unit): Unit =\n    var v: { h: Nope } = { h = f }\n    v := { h = f }\n    f()\n"))
      .toEqual([nopeType]);
    // At a caller, and through a written callback the caller hands it, which
    // the pin would make pure too, whatever the order of the lines.
    const mid = (h: string, first: string, second: string) =>
      "let outer(f: () ->! Unit): Unit =\n    let g: Nope = f\n    f!()\n" +
      `let mid(${h}): Unit =\n    ${first}\n    ${second}\nexport let p1(): Unit = mid(save0)\n`;
    for (const [first, second] of [["outer!(h)", "h()"], ["h()", "outer!(h)"]] as const) {
      expect(check(mid("h: () ->! Unit", first, second))).toEqual([nopeType]);
      // An untyped `h` called bare is a fact: `h` is pure under every repair,
      // so `outer!(h)` is the extra mark, and `mid`'s callers meet a pure `h`.
      expect(check(mid("h", first, second))).toEqual([
        nopeType,
        // One report for the fact, `save0` handed against it a label (#1310).
        "this call is pure and cannot fail, so `outer` wants no mark, not `!` — `h` is called bare, which makes it pure " +
        "and unable to fail",
      ]);
    }
    // An untyped parameter handed to a call whose callee failed is in error,
    // whatever marks it: whether that call runs it is what the error hides
    // (§3.5), so neither its `!` nor its bare call is reported.
    expect(check("let outer(f) =\n    f!()\n    nope(f)\n    f()\n")).toEqual([unknown]);
    // Through a module's interface, and at a parameter written in error there.
    expect(twoModules(
      "export let outer(f: () ->! Unit): Unit =\n    let g: Nope = f\n    f!()\nexport let s0(): Unit = save!(\"x\")\n",
      "export let p1(): Unit = Lib.outer(Lib.s0)\n",
    )).toEqual([nopeType]);
    expect(twoModules(
      "export let user(g: Nope): Unit = ()\n",
      "let outer(f: () ->! Unit): Unit =\n    Lib.user(f)\n    f()\n",
    )).toEqual([nopeType]);
    // A value in error never pins it: a use re-opens it, so a merge leaves it
    // as it stands (review r3, D2). Nor does a call of a function whose body
    // is in error, where the slot it meets is that function's text (D1).
    // So does an error a value leaves in a `var`'s type (review r3b, M1).
    for (
      const meeting of [
        "let g = if c then f else nope",
        "let g = pick(f, nope)",
        "let g = pick(nope, f)",
        "let k = ident(nope)\n    let g = if c then k else f",
        "var v = { h = nope }\n    v := { h = f }",
        "var v: { h: () ->! Unit } = { h = nope }\n    v := { h = f }",
        "user!(f)",
      ]
    ) {
      expect(check(
        "let user(g: () ->! Unit): Unit =\n    nope!()\n    g!()\n" +
          `let outer(c: Bool, f: () ->! Unit): Unit =\n    ${meeting}\n    f()\n`,
      )).toEqual([unknown, unknown, wants("`f`")].slice(meeting.startsWith("user") ? 1 : 0));
    }
    // A mark the pin would leave as it is stands: what touches the world
    // whatever the callback does, another callback, and a mark to remove.
    expect(check(
      "let outer(c: Bool, f: () ->! Unit): Unit =\n    let g: Nope = f\n    let k = if c then f else save0\n" +
        "    k()\n",
    )).toEqual([nopeType, wants("`k`")]);
    expect(check("let outer(f: () ->! Unit): Unit =\n    let g: Nope = f\n    save!(\"x\")\n    f!()\n" +
      "export let p1(): Unit = outer(save0)\n")).toEqual([nopeType, wants("`outer`")]);
    expect(check(
      "let both(f: () ->! Unit, h: () ->! Unit): Unit =\n    let g: Nope = f\n    f!()\n    h()\n" +
        "export let p1(): Unit = both(save0, save0)\n",
    )).toEqual([nopeType, wants("`h`"), wants("`both`")]);
    expect(check("let outer(f: () ->! Unit): Unit =\n    let g: Nope = f\n    f!()\nexport let p1(): Unit = outer!(noop)\n"))
      .toEqual([nopeType, hedged("`outer`")]);
    // A callback written `->` is pure as written.
    expect(check("let outer(f: () -> Unit): Unit =\n    let g: Nope = f\n    f!()\n")).toEqual([nopeType, hedged("`f`")]);
  });

  it("keeps every report that does not depend on it", () => {
    // `keep` is pure whatever it is handed.
    expect(check("let user(): Unit = nope!(1)\nexport let probe(): Unit = keep!(user)\n"))
      .toEqual([unknown, hedged("`keep`")]);
    // A tie is the merge's, not the error's.
    expect(check("let g(c: Bool, f, h) =\n    nope!()\n    let k = if c then f else h\n    k!()\n")).toEqual([
      unknown,
      "`f`'s colour is tied to `h`'s here, and inference cannot keep them apart — write `f`'s type, or wrap `f` where they meet",
    ]);
    // A lambda with a parameter type in error still saves.
    expect(check("let user(): Unit =\n    let k = (x: Nope) => save!(\"x\")\n    k!(1)\nexport let probe(): Unit = user()\n"))
      .toEqual(["unknown type `Nope`", wants("`user`")]);
  });

  it("makes a refused knot's member in error however it is reached, and keeps the arrows its text writes", () => {
    const a = "fun a(cb: () ->! Unit, n: Int): Unit = if n == 0 then cb!() else a!(() => cb!(), n - 1)\n";
    const purity = "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the demand is written `->`";
    // By name, as a value, and through data it hands back.
    expect(bothMarks((mark) => `${a}export let probe(): Unit = a${mark}(save0, 1)\n`)).toEqual([[made], [made]]);
    expect(check(`${a}let applyU(f) = f!(save0, 1)\nexport let probe(): Unit = applyU!(a)\n`)).toEqual([made]);
    expect(check(
      "fun a(cb, n: Int) =\n    cb!()\n    if n == 0 then (cb, 1) else a(() => (), n - 1)\n" +
        "export let probe(): Unit =\n    let (r, _) = a!(save0, 1)\n    r!()\n",
    )).toEqual(["this function is not one `a` was given, and a recursive call hands on only the callbacks it was given"]);
    // A callback a caller hands it keeps the caller's colour, and the marks it
    // alone makes `!` wait on the refusal: whether the repair pins it is hidden.
    expect(check(`${a}let g(cb: () ->! Unit): Unit =\n    a!(cb, 1)\n    cb()\n`)).toEqual([made]);
    // An untyped parameter a caller hands it is in error, whichever line comes first.
    for (const [first, second] of [["a!(f, 1)", "f()"], ["f()", "a!(f, 1)"]]) {
      expect(check(`${a}let g(f) =\n    ${first}\n    ${second}\nexport let p(): Unit = g(save0)\n`)).toEqual([made]);
    }
    // An arrow written beneath a parameter is the text's.
    expect(check(
      "fun a(cb: (() -> Unit) ->! Unit, n: Int): Unit = if n == 0 then cb!(noop) else a!((h) => cb!(h), n - 1)\n" +
        "export let p(): Unit = a!((h) => h!(), 1)\n",
    )).toEqual([made, hedged("`h`")]);
    // So is one inside a type argument, handed (#1243 review r2, N1)…
    for (
      const [type, value] of [
        ["Option(() -> Unit)", "Some(save0)"],
        ["Vector(() -> Unit)", "[save0]"],
        ["Map(String, () -> Unit)", "Map.singleton(\"k\", save0)"],
        ["Nullable(() -> Unit)", "maybe()"],
      ]
    ) {
      expect(check(
        "extern from \"./world.js\"\n    export fun maybe() -> Nullable(() ->! Unit)\n" +
          `fun a(o: ${type}, cb: () ->! Unit, n: Int): Unit =\n    if n == 0 then cb!() else a(o, () => cb!(), n - 1)\n` +
          `export let p(): Unit = a!(${value}, noop, 1)\n`,
      )).toEqual([made, purity]);
    }
    // …or handed back. No cause is named, so the removal is a suggestion
    // (Declarations Preamble §1.1).
    expect(check(
      "fun a(cb: () ->! Unit, n: Int): Option(() -> Unit) = if n == 0 then Some(noop) else a(() => cb!(), n - 1)\n" +
        "export let p(): Unit =\n    match a(save0, 1)\n        Some(g) => g!()\n        None => ()\n",
    )).toEqual([made, hedged("`g`")]);
    // An arrow its text writes as a constant is the text's: the refused member
    // draws what its repair draws, beside the refusal.
    const written = (handed: string) =>
      `fun a(n: Int): (() -> Unit) -> Unit = (cb) => if n == 0 then () else a(n - 1)(${handed})\n` +
      "export let p1(): Unit = a(2)!(noop)\nexport let p2(): Unit = a(2)(save0)\n";
    expect(check(written("noop"))).toEqual([made, hedged("this call"), purity]);
    expect(check(written("cb"))).toEqual([hedged("this call"), purity]);
    // A callback's own written `->!` is its colour, which the refused
    // recursion decided (here, impure): it is in error, not the text's.
    expect(check(
      "let applyPure2(k: (() -> Unit, Bool) -> Unit): Unit = k(() => (), True)\n" +
        "fun fk(k: () ->! Unit, n0: Bool): Unit = if n0 then fk(save0, False) else ()\n" +
        "export let user(): Unit = applyPure2(fk)\n",
    )).toEqual(["this function is not one `fk` was given, and a recursive call hands on only the callbacks it was given"]);
    // From another module, uncurried and curried.
    const lib = "export fun a(cb: () ->! Unit, n: Int): Unit = if n == 0 then cb!() else a!(() => cb!(), n - 1)\n" +
      "export let s0(): Unit = save!(\"x\")\n";
    expect(twoModules(lib, "export let p1(): Unit = Lib.a!(Lib.s0, 1)\nexport let p2(): Unit = Lib.a(Lib.s0, 1)\n"))
      .toEqual([made]);
    const curried = "export fun a(n: Int): (() ->! Unit) >-> Unit = (cb) => if n == 0 then cb!() else " +
      "a(n - 1)!(() => cb!())\nexport let s0(): Unit = save!(\"x\")\n";
    expect(twoModules(curried, "export let p1(): Unit = Lib.a(1)!(Lib.s0)\nexport let p2(): Unit = Lib.a(1)(Lib.s0)\n"))
      .toEqual([made]);
  });

  it("settles a knot's member in error where it runs one, after the impure constant", () => {
    const knot = (b: string) => `fun\n    a(n: Int): Unit = if n == 0 then nope!() else b!(n - 1)\n${b}`;
    for (const mark of ["!", ""]) {
      expect(check(knot("    b(n: Int): Unit = a!(n)\n") + `export let p1(): Unit = a${mark}(1)\nexport let p2(): Unit = b${mark}(1)\n`))
        .toEqual([unknown]);
    }
    // A sibling that saves makes the whole knot impure.
    expect(check(knot("    b(n: Int): Unit =\n        save!(\"x\")\n        a!(n)\n") + "export let p1(): Unit = a(1)\n"))
      .toEqual([unknown, wants("`a`")]);
    // A held lambda that runs it.
    expect(check(
      "fun go(n: Int): Unit =\n    let h = () =>\n        nope!()\n        if n == 0 then () else go!(n - 1)\n    h!()\n" +
        "export let p1(): Unit = go!(1)\n",
    )).toEqual([unknown]);
  });

  it("makes a call above its honor, and an instance whose body failed, in error, through module interfaces too", () => {
    const honor = "constraint R<a> =\n    read(s: a) ->! String\nrecord D = { name: String }\n";
    const saving = "honor R<D> =\n    read(s) =\n        save!(s.name)\n        s.name\n";
    for (const mark of ["!", ""]) {
      expect(check(`${honor}let d(x: D): String = read(x)\nlet probe(x: D): String = d${mark}(x)\n${saving}`)).toEqual([
        "this call follows what `R<D>` does, and that honor is declared below it; declarations are read top-down — " +
        "move the honor above this call",
      ]);
    }
    const failed = "honor R<D> =\n    read(s) =\n        nope!(s.name)\n        s.name\n";
    for (const mark of ["!", ""]) {
      expect(check(`${honor}${failed}let probe(x: D): String = read${mark}(x)\n`)).toEqual([unknown]);
    }
    const lib = "export constraint R<a> =\n    read(s: a) ->! String\nexport record D = { name: String }\n" +
      "honor R<D> =\n    read(s) =\n        nope!(s.name)\n        s.name\n";
    expect(twoModules(lib, "export let p1(x: Lib.D): String = Lib.read!(x)\nexport let p2(x: Lib.D): String = Lib.read(x)\n"))
      .toEqual([unknown]);
    // A `widens` door whose body is in error, in each of its spellings, unless it saves.
    const door = (body: string, marks: string) =>
      twoModules(
        "export constraint R<a> =\n    tag(s: a, n: Int) ->! String\n",
        world + `export record P = { name: String }\nwidens Lib.tag(s: P, n: BigInt): String =\n${body}    s.name\n` +
          `honor Lib.R<P> =\n    tag = widened\n` +
          `export let through(p: P): String = tag${marks}(p, 2n) ++ Lib.tag${marks}(p, 2) ++ p.tag${marks}(2)\n`,
      );
    expect(door("    nope!()\n", "!")).toEqual([unknown]);
    expect(door("    nope!()\n", "")).toEqual([unknown]);
    expect(door("    nope!()\n    save!(s.name)\n", "")).toEqual([unknown, wants("`tag`"), wants("`Lib.tag`"), wants("`.tag`")]);
  });

  it("compares nothing against it, and reads a written `>->` over it in error", () => {
    expect(check("let user: () -> Unit = () => nope!()\nexport let probe(): Unit = user()\n")).toEqual([unknown]);
    expect(check("export let p1(): Unit = pureOnly(() => nope!())\nexport let p2(): Unit = pureOnly(nope)\n"))
      .toEqual([unknown, unknown]);
    expect(check(
      "constraint P<a> =\n    get(s: a) -> Int\nrecord D = { n: Int }\nhonor P<D> =\n    get(s) =\n        nope!()\n" +
        "        s.n\nlet probe(x: D): Int = get(x)\n",
    )).toEqual([unknown]);
    // An instance whose supplied callback meets it is not told it accepts less.
    expect(check(
      "constraint Run<a> =\n    with(r: a, f: () ->! Unit) ->! Unit\nrecord Job = { n: Int }\nhonor Run<Job> =\n" +
        "    with(job, f) =\n        let k = if job.n == 0 then f else nope\n        k!()\n",
    )).toEqual([unknown]);
    // Whether §4.2 refuses the `>->` is not known, so its callers' marks are
    // not judged: in a written header result and at an ascription.
    expect(bothMarks((mark) =>
      "let user(cb: () ->! Unit): () >-> Unit = () =>\n    nope!()\n    cb!()\n" +
      `export let probe(): Unit = user(noop)${mark}()\n`
    )).toEqual([[unknown], [unknown]]);
    const user = "let user(cb: () ->! Unit): Unit =\n    nope!()\n    cb!()\n";
    expect(bothMarks((mark) => `${user}let w = (user : (() ->! Unit) >-> Unit)\nexport let probe(): Unit = w${mark}(noop)\n`))
      .toEqual([[unknown], [unknown]]);
    expect(bothMarks((mark) => `${user}let mk(): (() ->! Unit) >-> Unit = user\nexport let probe(): Unit = mk()${mark}(noop)\n`))
      .toEqual([[unknown], [unknown]]);
    // A written `->` that reads as the body where the body touches the world
    // reads in error over a body in error: an ascription, a written result
    // type. A binding annotation's stands as written either way.
    expect(bothMarks((mark) => `let k = (() => nope!() : () -> Unit)\nexport let p(): Unit = k${mark}()\n`))
      .toEqual([[unknown], [unknown]]);
    expect(bothMarks((mark) => `let mk(): () -> Unit = () => nope!()\nexport let p(): Unit = mk()${mark}()\n`))
      .toEqual([[unknown], [unknown]]);
    expect(check("let k: () -> Unit = () => nope!()\nexport let p(): Unit = k!()\n"))
      .toEqual([unknown, hedged("`k`")]);
    // A binding annotation over a lambda whose body is in error.
    expect(bothMarks((mark) =>
      `let w: (() ->! Unit) >-> Unit = (cb) =>\n    nope!()\n    cb!()\nexport let probe(): Unit = w${mark}(noop)\n`
    )).toEqual([[unknown], [unknown]]);
  });

  it("shows an arrow in error as `->!` in a report", () => {
    expect(check("let user(): Unit =\n    let k = () => nope!(1)\n    k!()\nlet x: Int = user\n"))
      .toEqual([unknown, "type mismatch: expected Int, found () ->! Unit"]);
  });

  it("carries it through a module's interface", () => {
    expect(twoModules("export let user(): Unit = nope!(1)\n",
      "export let p1(): Unit = Lib.user!()\nexport let p2(): Unit = Lib.user()\n")).toEqual([unknown]);
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
      "this call is impure and may fail, and the enclosing function's face is the pure arrow " +
      "`->`, which cannot fail — a pure face cannot run effects, and a face that cannot fail cannot " +
      "run a call that may, unless it handles the failure",
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
      "write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
    ]);
  });
});

describe("Effects §4.2, §4.4 — a refused `>->` reads as its fix wherever it stands and whenever it is refused (#1239, #1281, #1242)", () => {
  const fixtures = 'let noop(): Unit = ()\nlet save0(): Unit = save!("x")\nlet keep(cb: () ->! Unit): Unit = ()\n';
  const source = (program: string): string => "module Main\n\n" + world + fixtures + program;
  const check = (program: string): readonly string[] =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", source(program)]]);
  const faceReport = (message: string): boolean => /this face's `>[-~^]>/.test(message);
  /**
   * §4.4's promise: with only the face reports' fixits applied, the program
   * draws exactly the other reports round 1 drew.
   */
  const oneRound = (program: string): void => {
    const text = source(program);
    const round1 = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics;
    const edits = round1.filter(({ message }) => faceReport(message))
      .flatMap(({ fixes }) => fixes?.[0]?.edits ?? [])
      .sort((left, right) => right.span.start.offset - left.span.start.offset);
    expect(edits.length).toBeGreaterThan(0);
    let fixed = text;
    for (const edit of edits) {
      fixed = fixed.slice(0, edit.span.start.offset) + edit.replacement + fixed.slice(edit.span.end.offset);
    }
    const repaired = compileFiles([["/world.js", ""], ["/main.hex", fixed]]).diagnostics.map(({ message }) => message);
    expect(round1.map(({ message }) => message).filter((message) => !faceReport(message))).toEqual(repaired);
  };
  const late = (spelling: "binding" | "ascription" | "result", mark: string): string => {
    const lambda = "(x) =>\n        action!()\n        ()";
    const [declaration, callee] = spelling === "binding"
      ? [`let k: (() ->! Unit) >-> Unit = ${lambda}`, "k"]
      : spelling === "ascription"
      ? [`let k = ((${lambda}): (() ->! Unit) >-> Unit)`, "k"]
      : [`let k(): (() ->! Unit) >-> Unit = ${lambda}`, "k()"];
    return `let outer(action): Unit =\n    ${declaration}\n    ${callee}!(noop)\nexport let probe(): Unit = outer${mark}(noop)\n`;
  };
  const lateReport = "this call runs `outer`'s `action`, which this signature is not handed, and this face's `>->` " +
    "promises the function is only as effectful as what it is handed — write `->!`";

  it("a face compared only once an enclosing body's untyped callback is decided reads as its fix, in every spelling", () => {
    for (const spelling of ["binding", "ascription", "result"] as const) {
      // The enclosing function's callers are read against `->!`: its `!` is
      // kept, and a bare call is asked for it, in round 1.
      expect(check(late(spelling, "!"))).toEqual([lateReport]);
      expect(check(late(spelling, ""))).toEqual([
        lateReport,
        "this call is impure and may fail, so `outer` wants `!`, not no mark",
      ]);
      expect(hoveredType(source(late(spelling, "!")), "outer(")).toBe("(() ->! Unit) ->! Unit");
      oneRound(late(spelling, ""));
      oneRound(late(spelling, "!"));
    }
  });

  it("so does one in a nested function, on a returned arrow, and one a second face runs", () => {
    const nested = "let outer(action): Unit =\n    let inner(): Unit =\n        let k: (() ->! Unit) >-> Unit = (x) =>\n" +
      "            action!()\n            ()\n        k!(noop)\n    inner!()\nexport let probe(): Unit = outer!(noop)\n";
    expect(check(nested)).toEqual([lateReport]);
    expect(hoveredType(source(nested), "inner(")).toBe("() ->! Unit");
    const curried = "let outer(action): Unit =\n    let k: () -> (() ->! Unit) >-> Unit = () => (x) =>\n        action!()\n" +
      "    k()!(noop)\nexport let probe(): Unit = outer!(noop)\n";
    expect(check(curried)).toEqual([lateReport]);
    oneRound(curried);
    // `k2` runs `k1`, which reads as `->!`: round 1 says what the repaired
    // program says of `k1!(y)`.
    const chained = "let outer(action): Unit =\n    let k1: (() ->! Unit) >-> Unit = (x) =>\n        action!()\n" +
      "    let k2: (() ->! Unit) >-> Unit = (y) =>\n        k1!(y)\n    k2!(noop)\nexport let probe(): Unit = outer!(noop)\n";
    expect(check(chained)).toEqual([
      lateReport,
      "this call is impure and may fail on its own account, and this face's `>->` promises the function is only as " +
      "effectful as what it is handed — write `->!`",
    ]);
    oneRound(chained);
  });

  it("so does one in a knot member, decided at the knot's close", () => {
    const knot = "fun\n    ping(n: Int, cb): Int =\n        let g: (() ->! Unit) >-> Unit = (x) =>\n            x!()\n" +
      "            cb!()\n        g!(noop)\n        if n > 0 then pong!(n - 1, cb) else 0\n    pong(n: Int, cb): Int =\n" +
      "        if n > 0 then ping!(n - 1, cb) else 0\nexport let probe(): Unit =\n    let _ = ping!(2, noop)\n    ()\n";
    expect(check(knot)).toEqual([
      "this call runs `ping`'s `cb`, which this signature is not handed, and this face's `>->` promises the " +
      "function is only as effectful as what it is handed — write `->!`",
    ]);
    expect(hoveredType(source(knot), "ping(")).toBe("(Int, () ->! Unit) ->! Int");
  });

  it("each colour on its own: a `>^>` refused late reads as `->^`", () => {
    const fail = "let outer(action): Unit =\n    let k: (() ->^ Unit) >^> Unit = (x) =>\n        x^()\n        action^()\n" +
      "    k^(noop)\nexport let p1(): Unit = outer(noop)\nexport let p2(): Unit = outer^(noop)\n";
    expect(check(fail)).toEqual([
      "this call runs `outer`'s `action`, which this signature is not handed, and this face's `>^>` promises the " +
      "function is only as effectful as what it is handed — write `->^`",
      "this call may fail, so `outer` wants `^`, not no mark",
    ]);
    expect(hoveredType(source(fail), "outer(")).toBe("(() ->^ Unit) ->^ Unit");
  });

  it("a fix that passes a colour through reads the face's own callbacks, in every spelling, whenever the rest is decided", () => {
    const passes = (arrow: string, clause: string): string =>
      `this call ${clause}, and this face's \`${arrow}\` ` +
      (arrow === ">^>" ? "is pure there" : "cannot fail there") + " — write `>->`, which passes that through";
    const world = passes(">^>", "is impure where what it is handed is");
    const lambda = "(x) =>\n        x!()\n        action()";
    // The rest is decided only at `outer`'s close, after `k` is generalized:
    // `k(noop)` still reads `noop`'s colour, whatever spells the face.
    for (const [declaration, use] of [
      [`let k: (() ->! Unit) >^> Unit = ${lambda}`, "k(noop)"],
      [`let k = ((${lambda}): (() ->! Unit) >^> Unit)`, "k(noop)"],
      [`let p: ((() ->! Unit) >^> Unit, Int) = ((${lambda}), 1)\n    let (g, _) = p`, "g(noop)"],
    ]) {
      const program = `let outer(action): Unit =\n    ${declaration}\n    ${use}\nexport let probe(): Unit = outer(noop)\n`;
      expect(check(program)).toEqual([world]);
      oneRound(program);
    }
    const fail = `let outer(action): Unit =\n    let k = ((${lambda}): (() ->! Unit) >~> Unit)\n    k(noop)\nexport let probe(): Unit = outer(noop)\n`;
    expect(check(fail)).toEqual([passes(">~>", "may fail where what it is handed may")]);
    oneRound(fail);
    // The rest decided pure: the fix passes the colour through.
    const pure = "let outer(action): Unit =\n    let k: (() ->! Unit) >^> Unit = (x) =>\n        x!()\n        action()\n" +
      "    k(save0)\n    k(noop)\nexport let probe(): Unit = outer(noop)\n";
    expect(check(pure)).toEqual([
      world,
      "this call is impure and may fail, so `k` wants `!`, not no mark",
      "this call is impure and may fail, so `outer` wants `!`, not no mark",
    ]);
    oneRound(pure);
    // The rest decided impure: the fix is the constant, in one report.
    const impure = "let outer(action): Unit =\n    let k: (() ->! Unit) >^> Unit = (x) =>\n        x!()\n        action!()\n" +
      "    k!(save0)\n    k!(noop)\nexport let probe(): Unit = outer!(save0)\nexport let probe2(): Unit = outer(noop)\n";
    expect(check(impure)).toEqual([
      "this call runs `outer`'s `action`, which this signature is not handed, and this face's `>^>` promises the " +
      "function is only as effectful as what it is handed — write `->!`",
      "this call is impure and may fail, so `outer` wants `!`, not no mark",
    ]);
    oneRound(impure);
  });

  it("a face compared late over a colour in error reads in error", () => {
    expect(check(
      "let outer(action): Unit =\n    let k: (() ->! Unit) >-> Unit = (x) =>\n        action!()\n        ()\n" +
        "    k!(noop)\n    nope!(action)\nexport let p1(): Unit = outer!(noop)\nexport let p2(): Unit = outer(noop)\n",
    )).toEqual(["unknown name `nope`"]);
  });

  it("a face refused late over a body in error reads as its fix, as one refused at once does", () => {
    const program = "let outer(action): Unit =\n    let k: (() ->! Unit) >-> Unit = (x) =>\n        action!()\n        nope!()\n" +
      "        ()\n    k!(noop)\nexport let p1(): Unit = outer!(noop)\nexport let p2(): Unit = outer(noop)\n";
    expect(check(program)).toEqual([
      lateReport,
      "unknown name `nope`",
      "this call is impure and may fail, so `outer` wants `!`, not no mark",
    ]);
    oneRound(program);
  });

  it("a refusal found at a close is reported there, at the first call that runs a colour decided by then", () => {
    // `b` is decided at `inner`'s close and `action` only at `outer`'s: the
    // refusal is known at `inner`'s close and stands at `b!()`, and the
    // arrow reads as its fix from then on.
    const program = "let outer(action): Unit =\n    let inner(b) =\n        let k: (() ->! Unit) >-> Unit = (x) =>\n" +
      "            action!()\n            b!()\n        k!(noop)\n    inner!(noop)\nexport let probe(): Unit = outer!(noop)\n" +
      "export let p2(): Unit = outer(noop)\n";
    expect(check(program)).toEqual([
      "this call runs `inner`'s `b`, which this signature is not handed, and this face's `>->` promises the function " +
      "is only as effectful as what it is handed — write `->!`",
      "this call is impure and may fail, so `outer` wants `!`, not no mark",
    ]);
    oneRound(program);
  });

  it("a face in a refused knot draws no report of its own, as the knot's other faces do not (§3.4)", () => {
    expect(check(
      "fun\n    ping(n: Int): (() ->! Unit) >-> Unit = (x) =>\n        x!()\n        if n > 0 then pong!(n - 1) else ()\n" +
        "    pong(n: Int): Unit =\n        let _ = ping(n - 1)\n        save!(\"z\")\n" +
        "export let probe(): Unit = ping(2)!(noop)\nexport let probe2(): Unit = ping(2)(noop)\n",
    )).toEqual([
      "`ping` takes callbacks, so inside its own recursion it is applied in full where it is named, and this leaves a callback to give it",
    ]);
  });

  it("a function in the data a face returns reads as its fix (#1281)", () => {
    const own = "this function is impure and may fail on its own account, and this face's `>->` promises the function " +
      "is only as effectful as what it is handed — write `->!`";
    const shapes = [
      ["(() >-> Unit, Int)", "(save0, 1)", "let (g, _) = mkBad(noop)\n    g", "", "(() ->! Unit) -> (() ->! Unit, Int)"],
      ["{ run: () >-> Unit, n: Int }", "{ run = save0, n = 1 }", "let g = mkBad(noop).run\n    g", "", "(() ->! Unit) -> {run: () ->! Unit, n: Int}"],
      ["Option(() >-> Unit)", "Some(save0)", "match mkBad(noop)\n        Some(g) => g", "\n        None => ()", "(() ->! Unit) -> Option(() ->! Unit)"],
    ] as const;
    for (const [face, value, use, rest, hover] of shapes) {
      const program = (mark: string) =>
        `let mkBad(f: () ->! Unit): ${face} = ${value}\nexport let probe(): Unit =\n    ${use}${mark}()${rest}\n`;
      expect(check(program(""))).toEqual([own, "this call is impure and may fail, so `g` wants `!`, not no mark"]);
      expect(check(program("!"))).toEqual([own]);
      expect(hoveredType(source(program("!")), "mkBad(")).toBe(hover);
      oneRound(program(""));
    }
    // A binding annotation over data, at module level and locally: the
    // binding's scheme never holds the outcome.
    const lambda = "this call is impure and may fail on its own account, and this face's `>->` promises the function is " +
      "only as effectful as what it is handed — write `->!`";
    const pair = 'let p: ((() ->! Unit) >-> Unit, Int) = (((x) => save!("a")), 1)\n';
    const top = (mark: string) => `${pair}export let outer(): Unit =\n    let (g, _) = p\n    g${mark}(noop)\n`;
    expect(check(top(""))).toEqual([lambda, "this call is impure and may fail, so `g` wants `!`, not no mark"]);
    expect(check(top("!"))).toEqual([lambda]);
    expect(hoveredType(source(top("!")), "p:")).toBe("((() ->! Unit) ->! Unit, Int)");
    oneRound(top(""));
    const local = (mark: string) => `export let outer(): Unit =\n    ${pair}    let (g, _) = p\n    g${mark}(noop)\n`;
    expect(check(local("!"))).toEqual([lambda]);
    oneRound(local(""));
  });

  it("a binding annotation over a named function reads as its fix, or in error, as the other spellings do (#1242)", () => {
    const own = "this function is impure and may fail on its own account, and this face's `>->` promises the function " +
      "is only as effectful as what it is handed — write `->!`";
    const user = 'let user(cb: () ->! Unit): Unit =\n    save!("y")\n    cb!()\n';
    expect(check(`${user}let w: (() ->! Unit) >-> Unit = user\nexport let p1(): Unit = w(noop)\nexport let p2(): Unit = w!(noop)\n`))
      .toEqual([own, "this call is impure and may fail, so `w` wants `!`, not no mark"]);
    expect(check(`${user}export let p1(): Unit =\n    let w: (() ->! Unit) >-> Unit = user\n    w!(noop)\n`)).toEqual([own]);
    const broken = "let user(cb: () ->! Unit): Unit =\n    nope!()\n    cb!()\n";
    expect(check(`${broken}let w: (() ->! Unit) >-> Unit = user\nexport let p1(): Unit = w(noop)\nexport let p2(): Unit = w!(noop)\n`))
      .toEqual(["unknown name `nope`"]);
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
      "this call is impure and may fail on its own account, and this face's `>->` promises the " +
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
      .toEqual(["this call is impure and may fail, so `apply` wants `!`, not no mark"]);
  });

  it("demands `!` at every call site, pure callback or not", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${shape("->!")}
export let go(): String = withTransaction((document) => document)
`]]),
    ).toEqual([
      "this call is impure and may fail, so `withTransaction` wants `!`, not no mark",
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

describe("a binding annotation's outer arrow is the face of the value it writes (#1106, #1149)", () => {
  const compile = (source: string) =>
    effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + source]]);
  const run4 = "let run4(k: () ->! Unit): () -> Unit = () => ()\n";
  const pureFace = "this call is impure and may fail, and the enclosing function's face is the pure arrow " +
    "`->`, which cannot fail — a pure face cannot run effects, and a face that cannot fail cannot " +
    "run a call that may, unless it handles the failure";

  it("is not taken by a lambda handed to a call on a branch", () => {
    // `run4(…)` hands back a pure function, so the branch fits `() -> Unit`;
    // the lambda it is handed is a value of its own and may save.
    expect(compile(run4 + 'let r: () -> Unit = if True then run4(() => save!("x")) else () => ()\n'))
      .toEqual([]);
    expect(compile(run4 +
      'let r: () -> Unit = match True\n    True => run4(() => save!("x"))\n    False => () => ()\n'))
      .toEqual([]);
    expect(compile(run4 + 'let r: () -> Unit = try\n    run4(() => save!("x"))\ncatch\n    fault _ => () => ()\n'))
      .toEqual([]);
  });

  it("is taken by the branch lambda it lands on, which alone is reported", () => {
    const source = run4 + 'let r: () -> Unit = if True then run4(() => save!("x")) else () => save!("y")\n';
    expect(compile(source)).toEqual([pureFace]);
    const [report] = effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + source]]);
    expect(report?.primary).toBe(("module Main\n\n" + world + source).indexOf('save!("y")'));
    const arms = run4 +
      'let r: () -> Unit = match True\n    True => run4(() => save!("x"))\n    False => () => save!("y")\n';
    expect(compile(arms)).toEqual([pureFace]);
    const [armReport] = effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + arms]]);
    expect(armReport?.primary).toBe(("module Main\n\n" + world + arms).indexOf('save!("y")'));
  });

  it("reaches a `try` body, a catch arm and a grouped lambda", () => {
    const at = (source: string, needle: string) => {
      expect(compile(source)).toEqual([pureFace]);
      const [report] = effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + source]]);
      expect(report?.primary).toBe(("module Main\n\n" + world + source).indexOf(needle));
    };
    at('let r: () -> Unit = try\n    () => save!("x")\ncatch\n    fault _ => () => ()\n', 'save!("x")');
    at(run4 + 'let r: () -> Unit = try\n    run4(() => save!("x"))\ncatch\n    fault _ => (() => save!("y"))\n', 'save!("y")');
    at(run4 + 'let r: () -> Unit =\n    match trim("a")\n        "a" => run4(() => save!("x"))\n' +
      '        _ => run4(() => save!("y"))\n    catch\n        fault _ => () => save!("z")\n', 'save!("z")');
  });

  it("lands on every branch's lambda, so the report stands at the call in either order", () => {
    for (const [source, needle] of [
      ['let r: () -> Unit = if True then () => () else () => save!("y")\n', 'save!("y")'],
      ['let r: () -> Unit = if True then () => save!("x") else () => ()\n', 'save!("x")'],
    ] as const) {
      expect(compile(source)).toEqual([pureFace]);
      const [report] = effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + source]]);
      expect(report?.primary).toBe(("module Main\n\n" + world + source).indexOf(needle));
    }
  });

  it("lands through a nested binding on the block's final lambda", () => {
    const source = 'let r: () -> Unit =\n    let z = 1\n    () => save!("x")\n';
    expect(compile(source)).toEqual([pureFace]);
    const [report] = effectSpans([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + source]]);
    expect(report?.primary).toBe(("module Main\n\n" + world + source).indexOf('save!("x")'));
  });

  /** A lambda a knot holds, under a written face (#1149). */
  const knot = (written: string, call: string, sibling: string) => `fun
    ping(n: Int): Int =
        let act = () => pong${sibling}(n)
        let q: ${written} = act
        ${call}
    pong(n: Int): Int = if n > 0 then ping${sibling}(n - 1) else 0
`;

  it("is the binding's type over a lambda a knot holds, as over any other", () => {
    // `q` is `() ->! Int`, as it is outside a knot, so `q!()` is a source and
    // the knot touches the world. A written `->` publishes the value's colour,
    // which the knot settles pure here (pinned as main has it).
    expect(compile(knot("() ->! Int", "q!()", "!"))).toEqual([]);
    expect(compile(knot("() ->! Int", "q()", "!")))
      .toEqual(["this call is impure and may fail, so `q` wants `!`, not no mark"]);
    expect(compile(knot("() -> Int", "q()", ""))).toEqual([]);
    expect(compile(knot("() -> Int", "q!()", "")))
      .toEqual([pureAndTotal("this call is pure and cannot fail, so `q` wants no mark, not `!`")]);
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
      "this call is impure and may fail, so `map` wants `!`, not no mark",
    ]);
  });

  it("refuses `!` at a pure instantiation — symmetric enforcement", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${eager}
export let stamped(values: Vector(String)): Vector(String) =
    map!(values, (text) => text ++ ".")
`]]),
    ).toEqual([
      pureAndTotal("this call is pure and cannot fail, so `map` wants no mark, not `!`"),
    ]);
  });
});

describe("#355 grammar — where a mark may stand", () => {
  it("reads `?` in the mark seat as the reading, whose world part its fixit adds", () => {
    // `?` is the reading (§3.1): on a call that is impure it wants `~?`, and
    // the fixit rewrites the reading in place.
    const text = "module Main\n\n" + world + 'export let run(): Option(Unit) = save?("x")\n';
    const diagnostics = compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics;
    expect(diagnostics.map(({ message }) => message)).toEqual([
      "this call is impure, so `save` wants `~?`, not `?`",
    ]);
    const edits = diagnostics.flatMap(({ fixes }) => (fixes ?? []).flatMap((fix) => fix.edits));
    expect(edits.map(({ span, replacement }) => [text.slice(span.start.offset, span.end.offset), replacement]))
      .toEqual([["?", "~?"]]);
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
      "this call is impure and may fail, so `save` wants `!`, not no mark",
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
    ).toEqual([typeArrowRedirect, "this call is impure and may fail, so `g` wants `!`, not no mark"]);
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
    const wants = (name: string) => `this call is impure and may fail, so \`${name}\` wants \`!\`, not no mark`;
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
      "Hexagon's type arrows are `->`, `->^`, `->~`, `->!` and the following arrows such as `>->`; `=>` is the lambda arrow — " +
      "for a function type write `Int -> Int` (or a marked arrow for what it may do)",
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
      "`>->` means only as effectful as what it is handed, and nothing is handed here — this " +
      "annotation is not a function signature; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
      "`>->` means only as effectful as what it is handed, and nothing is handed here — a `record` " +
      "field is data, not a signature; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
      "this call is impure and may fail, so `runner` wants `!`, not no mark",
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
    // The parenthesized field call is the record spelling (§3.6), and a row is
    // data (Effects §2.5): its arrow is the written twin's constant (#1380).
    // Marked, it is `->!`, and the mark is true.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
let drive(source): String = (source.next)!()

export let x: Int = 1
`]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `
let drive(source): String = (source.next)()

export let x: Int = 1
`]]),
    ).toEqual([]);
  });

  it("a nested lambda leaves a colour in an untyped parameter's data to the body around it, in every order (#1210)", () => {
    const fixtures = `${world}let noop(): Unit = ()\nlet save0(): Unit = save!("x")\nlet keep(f: () ->! Unit): Unit = ()\n` +
      "export let tieTwo(x: a, y: a): Unit = ()\nlet fst(t: (a, b)): a =\n    let (x, _) = t\n    x\n";
    const reports = (source: string): readonly string[] =>
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + fixtures + source]]);
    const g = "let g = () => fst(p)!()";
    const tie = "tieTwo(p, (save0, 1))";
    for (const lines of [[g, tie], [tie, g]]) {
      const source = "let f(p) =\n" + [...lines, "g!()"].map((line) => `    ${line}\n`).join("") +
        "export let user(): Unit = f!((save0, 1))\n";
      expect([lines, reports(source)]).toEqual([lines, []]);
    }
    // In a knot: the bare call in the unused lambda is a fact either way, so
    // both member orders give the same reports.
    const ping = "    ping(n: Int, cb): Int =\n        let k = () => cb()\n        if n > 0 then pong!(n - 1, cb) else 0\n";
    const pong = "    pong(n: Int, cb): Int =\n        keep(cb)\n        if n > 0 then ping!(n - 1, cb) else 0\n";
    const probe = "export let probe(): Int = ping!(2, save0)\n";
    const first = reports("fun\n" + ping + pong + probe);
    const second = reports("fun\n" + pong + ping + probe);
    expect(first.some((message) => message.includes("`cb` is called bare"))).toBe(true);
    expect(second.filter((message) => message.includes("`cb` is called bare"))).toEqual(
      first.filter((message) => message.includes("`cb` is called bare")),
    );
  });

  it("names no written `->` where inference settled the demand (#1303)", () => {
    const settled = "a `->` arrow promises purity and that the function cannot fail, and this function is impure and " +
      "may fail — no `->` is written here: inference settled it, since nothing it was decided from is impure or may " +
      "fail; write the type you mean where it is decided";
    const fixtures = `${world}let noop(): Unit = ()\nlet save0(): Unit = save!("x")\nlet ident(x: a): a = x\n`;
    const reports = (source: string): readonly string[] =>
      effectDiagnostics([["/world.js", ""], ["/main.hex", "module Main\n\n" + fixtures + source]]);
    // A returned lambda whose parameter follows a callback a pure one filled.
    expect(reports(
      "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    (run, 1)\n" +
        "let mk(a1: () ->! Unit) =\n    let (r, _) = make()\n    let lam = (g: () ->! Unit) => r!(g)\n    lam!(a1)\n    lam\n" +
        "export let probe(): Unit =\n    let l = mk(noop)\n    l(save0)\n",
    )).toContain(settled);
    // A structural field an untyped parameter's bare call closed pure names
    // the call (#1376), with no `!` fix: a mark keeps no arrow in a
    // parameter's data open.
    expect(reports(
      "let use(r) =\n    (r.run)()\nlet tw(f) =\n    f!()\n    { run = f }\nexport let p(): Unit = use(tw!(save0))\n",
    )).toEqual([
      "this function is impure and may fail, where the function handed must be pure and unable to fail — " +
        "a call written bare runs `r.run`, which makes it pure and unable to fail",
    ]);
  });

  it("an arrow in data the body receives is its written twin's constant, bare or marked (#1380)", () => {
    const fixtures = `${world}let noop(): Unit = ()\nlet save0(): Unit = save!("x")\n`;
    const check = (source: string) =>
      compileFiles([["/world.js", ""], ["/main.hex", "module Main\n\n" + fixtures + source]]).diagnostics.map(({ message }) => message);
    const face = (source: string): string | undefined => hoveredType("module Main\n\n" + fixtures + source, "use(");
    const held = "let (a, _) = t";
    const back = "let (a, _) = f()";
    // The parameter's own data, and what a callback hands back: `->` where a
    // bare call pins it, `->!` otherwise, so a mark is true.
    for (const [head, take, pure, impure] of [
      ["use(t)", held, "use((noop, 1))", "use!((save0, 1))"],
      ["use(f)", back, "use(() => (noop, 1))", "use!(() => (save0, 1))"],
    ]) {
      expect(check(`let ${head} =\n    ${take}\n    a()\nexport let p(): Unit = ${pure}\n`)).toEqual([]);
      expect(check(`let ${head} =\n    ${take}\n    a!()\nexport let p(): Unit = ${impure}\n`)).toEqual([]);
    }
    expect(face(`let use(t) =\n    ${held}\n    a()\n`)).toBe("((() -> a, b)) -> a");
    expect(face(`let use(t) =\n    ${held}\n    a!()\n`)).toBe("((() ->! a, b)) ->! a");
    expect(face(`let use(f) =\n    ${back}\n    a()\n`)).toBe("(() -> (() -> a, b)) -> a");
    // A field and an `Option`'s contents, the same.
    expect(check("let use(r) =\n    (r.run)!()\nexport let p(): Unit = use!({ run = save0 })\n")).toEqual([]);
    expect(check("let use(o) =\n    match o\n        Some(f) => f!()\n        None => ()\nexport let p(): Unit = use!(Some(save0))\n"))
      .toEqual([]);
    // The cost the written twin has too: the marked body wears its mark,
    // whatever it is handed.
    expect(check(`let use(t) =\n    ${held}\n    a!()\nexport let p(): Unit = use((noop, 1))\n`)).toEqual([
      "this call is impure and may fail, so `use` wants `!`, not no mark",
    ]);
  });

  it("a bare call through a tuple part names itself, and the mark that repairs it (#1376, #1380)", () => {
    const reports = (source: string) =>
      compileFiles([["/world.js", ""], ["/main.hex", "module Main\n\n" + `${world}let save0(): Unit = save!("x")\n` + source]])
        .diagnostics.map(({ message, fixes }) => [message, (fixes ?? []).length]);
    expect(reports("let use(t) =\n    let (a, _) = t\n    a()\nexport let p(): Unit = use((save0, 1))\n")).toEqual([[
      "this function is impure and may fail, where the function handed must be pure and unable to fail — " +
        "`a` is called bare, which makes it pure and unable to fail",
      1,
    ]]);
    // In a knot, a sibling's bare call is named, whichever member comes first (#1379).
    const ping = "    ping(t, n: Int): Unit = if n > 0 then pong(t, n - 1) else ()\n";
    const pong = "    pong(t, n: Int): Unit =\n        let (a, _) = t\n        a()\n        ping(t, n)\n";
    for (const members of [[ping, pong], [pong, ping]]) {
      expect([members, reports("fun\n" + members.join("") + "export let p(): Unit = ping((save0, 1), 3)\n")]).toEqual([members, [[
        "this function is impure and may fail, where the function handed must be pure and unable to fail — " +
          "`a` is called bare, which makes it pure and unable to fail",
        1,
      ]]]);
    }
    // Nor is a sibling's bare call a fact where its own parameters share the
    // colour there.
    const ping2 = "    ping(t, n: Int): Unit =\n        let (_, b) = t\n        if n > 0 then pong(t, (b, 1), n - 1) else ()\n";
    const pong2 = "    pong(t, s, n: Int): Unit =\n        let (a, _) = t\n        let (g, _) = s\n" +
      "        let h = if True then g else a\n        g()\n        ping(t, n)\n";
    for (const members of [[ping2, pong2], [pong2, ping2]]) {
      const messages = reports("let noop(): Unit = ()\nfun\n" + members.join("") + "export let p(): Unit = ping((save0, noop), 3)\n")
        .map(([message]) => message as string);
      expect([members, messages.some((message) => message.includes("is called bare"))]).toEqual([members, false]);
    }
    // A colour another parameter holds too is decided by no fact (§3.4).
    for (const source of [
      "let use(f, g, t) =\n    let (a, _) = t\n    let h = if True then (if True then f else g) else a\n    a()\n" +
        "export let p(): Unit = use(save0, noop, (noop, 1))\n",
      "let use(t, u) =\n    let (a, _) = t\n    let (b, _) = u\n    let h = if True then a else b\n    a()\n" +
        "export let p(): Unit = use((noop, 1), (save0, 2))\n",
    ]) {
      const messages = reports("let noop(): Unit = ()\n" + source).map(([message]) => message as string);
      expect([source, messages.some((message) => message.includes("is called bare"))]).toEqual([source, false]);
    }
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
      "this function is impure and may fail, where the function handed must be pure and unable to fail — " +
        "a call written bare runs `source.step`, which makes it pure and unable to fail",
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
    // is an occurrence count, not an exemption: `stored` keeps one callback
    // slot. Each face reads `stored` as its eta-expansion would (#1213 (T)): it
    // hands its callback in, which the slot covers, so a pure face pins
    // nothing, and a face accepting any function is no lie while `store` never
    // runs it.
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `${inletFace}
export let asPure: ((() -> String) -> Int) = stored
export let asImpure: ((() ->! String) -> Int) = stored
`]]),
    ).toEqual([]);
    // Where `store` runs it, the pure face over any function is the lie of
    // generality (§4.2).
    const runs = inletFace.replace("Int = 1", "Int =\n    let _ = callback!()\n    1");
    expect(
      effectDiagnostics([["/main.hex", "module Main\n\n" + `${runs}
export let asPure: ((() -> String) -> Int) = stored
export let asImpure: ((() ->! String) -> Int) = stored
`]]),
    ).toEqual([
      "this callback is written `->!`, which accepts any function, and this accepts only one that is " +
      "pure and cannot fail — write its arrow `->`",
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
      "this function type's arrow is an effect variable, and writing a following arrow here " +
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
      "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the " +
      "demand is written `->`",
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
      "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the " +
      "demand is written `->`; a lazy `Seq` would throw it at a later pull, so keep it where a mark sees it: a " +
      "strict operation (`Vector.map^`), a strict consumer (`Seq.fold^`), or elements that carry it as data " +
      "(`(x) => f?(x)` gives `Option`s, and `attempt` in the function gives `Result`s)",
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
    `this call is impure and may fail, so \`${callee}\` wants \`!\`, not no mark`;
  const wantsBare = (callee: string, mark: string): string =>
    `this call is pure and cannot fail, so \`${callee}\` wants no mark, not \`${mark}\``;

  it("refuses a member handing its sibling a function it made, and the refusal stands alone (#1218)", () => {
    // `k` takes no callback, so the pure lambda it hands `h` is not one it
    // was given, and monomorphic recursion would make its colour every
    // call's (§3.4). The refusal is the only report: the knot's marks and
    // faces, and the outside call to `k`, owe none, whatever the marks say.
    const source = `fun
    h(n: Int, cb: () ->! Unit): () >-> Unit =
        let g = () => k!(n)
        g
    k(n: Int): Unit = if n == 0 then () else h(n - 1, () => ())!()
export let use(): Unit = k(3)
`;
    const made = "`k` was given no callback, and a recursive call hands on only the callbacks it was given";
    expect(check(source)).toEqual([made]);
    expect(check(source.replace("let g = () => k!(n)", "let g = () => k(n)"))).toEqual([made]);
    expect(check(source.replace("= k(3)", "= k!(3)"))).toEqual([made]);
  });

  it("refuses naming a member that takes callbacks inside its recursion (#1218)", () => {
    // `k` hands `h` a function it made and returns `h` itself inside a tuple:
    // inside its recursion `h` is only called, by its name, so an alias cannot
    // carry a call the text does not read (§3.4). Two refusals, nothing else.
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
`;
    expect(check(source)).toEqual([
      "`k` hands back data holding a function that takes callbacks, so inside its own recursion it is not called",
      "`k` was given no callback, and a recursive call hands on only the callbacks it was given",
      "`h` takes callbacks, so inside its own recursion it is only called, by its name",
    ]);
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
    // Within the knot a member's colours are monotypes (Functions §7.4), and a
    // sibling call hands on only the callbacks its caller was given (§3.4): it
    // wears the member's colour, `!` where that depends on the callbacks, as an
    // outside call handing a function that is impure does, and as
    // §3.4's `even`/`odd` do. A sibling that hands `m` a function it made is
    // refused, whatever the function does.
    const knot = (sibling: string, outside: string): string => `fun
    m(a: () ->! Unit, b: () ->! Unit, n: Int): Unit =
        a!()
        if n > 0 then s!(a, b, n - 1) else ()
    s(a: () ->! Unit, b: () ->! Unit, n: Int): Unit = ${sibling}
export let outside(): Unit = ${outside}
`;
    const noop = "let noop(): Unit = ()\nlet save0(): Unit = save!(\"x\")\n";
    expect(check(noop + knot("m!(a, b, n)", "m!(save0, noop, 1)"))).toEqual([]);
    expect(check(noop + knot("m(a, b, n)", "m!(save0, noop, 1)"))).toEqual([wantsBang("m")]);
    // A finished face follows all of its callbacks (§2.4): `b` is handed on, so
    // it is one of them, and an outside call handing it `save0` wears `!`.
    expect(check(noop + knot("m!(a, b, n)", "m(noop, save0, 1)"))).toEqual([wantsBang("m")]);
    expect(check(noop + knot("m!(b, a, n)", "m(noop, noop, 1)"))).toEqual([]);
    expect(hover(noop + knot("m!(a, b, n)", "m(noop, noop, 1)"), "m(a")).toBe(
      "(() ->! Unit, () ->! Unit, Int) >-> Unit",
    );
    for (const made of ["m!(noop, b, n)", "m!(a, save0, n)", "m!(() => a!(), b, n)"]) {
      expect([made, check(noop + knot(made, "m(noop, noop, 1)"))]).toEqual([made, [
        "this function is not one `s` was given, and a recursive call hands on only the callbacks it was given",
      ]]);
    }
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
      expect(check(source.replace("= defer(action)", "= defer!(action)"))).toEqual([pureAndTotal(wantsBare("defer", "!"))]);
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
      "this function is impure and may fail, where the function handed must be pure and unable to fail — `f` is " +
      "called bare, which makes it pure and unable to fail",
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
      expect(check(twoMember.replace("= b(cb)", "= b!(cb)"))).toEqual([pureAndTotal(wantsBare("b", "!"))]);
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
        ["    a(cb: () ->! Unit): Unit =\n        cb!()\n        b!(cb)\n",
          "    b(cb: () ->! Unit): Unit =\n        let unused = () => a!(cb)\n        save!(\"x\")\n"],
        ["    b(cb: () ->! Unit): Unit =\n        let unused = () => a!(cb)\n        save!(\"x\")\n",
          "    a(cb: () ->! Unit): Unit =\n        cb!()\n        b!(cb)\n"],
      ]) {
        const knot = `fun\n${members.join("")}`;
        expect(check(knot)).toEqual([]);
        expect(hover(knot, "a(cb")).toBe("(() ->! Unit) ->! Unit");
        expect(hover(knot, "b(cb: ")).toBe("(() ->! Unit) ->! Unit");
        expect(check(knot.replace("        b!(cb)", "        b(cb)"))).toEqual([
          "this call is impure and may fail, so `b` wants `!`, not no mark",
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
          "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the " +
          "demand is written `->`",
        ]);
        // The primary is the demand — the written `() -> Unit` that pinned `b`.
        expect(text.slice(compiled[0]!.primary.start.offset)).toMatch(/^\(\) -> Unit = b\n/);
        expect(hover(knot, "b()")).toBe("() ->! Unit");
      }
    });

    it("holds a lambda that calls a sibling to the knot's close, whichever member closes first", () => {
      const conducting = "    a(cb: () ->! Unit): Unit =\n        let g = () =>\n            cb!()\n" +
        "            b!(cb)\n        g!()\n";
      const source = "    b(cb: () ->! Unit): Unit =\n        let unused = () => a!(cb)\n        save!(\"x\")\n";
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
        let unused = () => a!(cb)
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
          "this function is impure and may fail, where the function handed must be pure and unable to fail — `h` is " +
          "called bare, which makes it pure and unable to fail",
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
            "a `->` arrow promises purity and that the function cannot fail, and this function is impure and may fail — the " +
            "demand is written `->`",
          ]);
          expect(hover(knot, "a()")).toBe("() ->! Unit");
          expect(hover(knot, "b()")).toBe("() ->! Unit");
        }
      }
    });

    it("fits a pure sibling where a use expects more, the use's room taking it — the use never chooses", () => {
      // A use re-opens the sibling's colour while the knot is open, as its
      // colour or more (§3.4, #1233): the `->!` field, and the branch joining it
      // with an impure lambda, meet the use's room, in either member order. The
      // sibling's colour is its body's, decided at the knot's close, and stays
      // pure.
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
        "this call is impure and may fail, and the enclosing function's face is the pure arrow " +
        "`->`, which cannot fail — a pure face cannot run effects, and a face that cannot fail cannot " +
        "run a call that may, unless it handles the failure",
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
    `only one that is pure and cannot fail — write \`${name}\`'s arrow \`->\``;

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
        "write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
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
        "this call is impure and may fail on its own account, and this face's `>->` promises the " +
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
    const owner = "impure only if `outer`'s `action` is; may fail only if `outer`'s `action` may";
    // A report notes each colour a captured callback passes through on its own line.
    const notes = ["impure only if `outer`'s `action` is", "may fail only if `outer`'s `action` may"];
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
      // `mid`'s own face is its own callback's, named by its parameter.
      expect(hovered(inMid, "mid(cb")?.displayedType).toBe("(() ->! Int) >-> Int");
      expect(hovered(inMid, "mid(cb")?.colourOwners).toEqual(["impure only if `cb` is; may fail only if `cb` may"]);
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
      expect(hovered(inside("let run = "), "g =")?.colourOwners).toEqual([
        "impure only if `run`'s `act` is; may fail only if `run`'s `act` may",
      ]);
      expect(hovered(inside("let pair = (1, "), "g =")?.colourOwners).toEqual([
        "impure only if an enclosing lambda's `act` is; may fail only if an enclosing lambda's `act` may",
      ]);
    });

    it("decorates completion detail at the cursor", () => {
      const source = inMid.replace("        cb!()\n", "        let z = g\n        cb!()\n");
      const cursor = prefix.length + source.indexOf("let z = g") + "let z = g".length;
      const g = session(source).completions("/main.hex", cursor).find(({ name }) => name === "g");
      expect(g?.detail).toBe("() >-> Unit — impure only if outer's action is; may fail only if outer's action may");
    });

    it("decorates a diagnostic that shows a captured colour, over settled colours", () => {
      const inside = inMid.replace("        cb!()\n", "        let n: Int = g\n        cb!()\n");
      const report = compileFiles([["/world.js", ""], ["/main.hex", prefix + inside]]).diagnostics;
      expect(report.map(({ message }) => message)).toEqual(["type mismatch: expected Int, found () >-> Unit"]);
      expect(report[0]?.notes).toEqual(notes);
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
      expect(joined[0]?.notes).toEqual(notes);
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
