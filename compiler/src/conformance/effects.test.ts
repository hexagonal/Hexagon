/**
 * Conformance for the effects discipline (`spec/effects.md`), which is
 * unconditional since #364 removed the flag it shipped behind.
 *
 * The acceptance test the ruling names is the `Seq` migration — the five strict
 * consumers' signatures flipped to a linked `=>` and their bodies wearing one
 * `?` each — with `fold`'s body as the designated specimen: each of its calls
 * must demand exactly its one correct mark, and mutating a mark must be an
 * error naming the fixit, in all six directions.
 *
 * Everything else here is one scratch module per section. The `Seq` these tests
 * read is `stdlib/Seq.hex` itself — the migrated prelude member, one source of
 * truth, since the discipline's removal from behind the flag is what let the
 * stdlib copy carry the marks at all.
 */

import { describe, expect, it } from "vitest";
import seqSource from "../../../stdlib/Seq.hex?raw";
import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/** Diagnostics of a compiled project. */
function effectDiagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/**
 * The same, with `Seq` reachable. The prelude's own `Seq.hex` is injected, so
 * this is only a name for the one-file shape the `Seq` probes below share.
 */
function withSeq(main: string): readonly string[] {
  return effectDiagnostics([["/main.hex", main]]);
}

/** Every fix replacement a project offered, so a test can pin the fixit text. */
function effectFixes(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.flatMap((diagnostic) =>
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
    export fun readLine(): String
    export fun save(document: String): Unit
    export fun audit(document: String): Unit
    export pure fun trim(document: String): String
`;

/** Effects §9's mark-position row, the one every misplaced mark takes. */
const markSeat =
  "a call mark governs an argument list; write it immediately before `(`, " +
  "or (in a `|>` stage) at the end of the stage — a reference carries no colour";

/** Effects §9's type-arrow row: `=>` written where a type arrow belongs (#410). */
const typeArrowRedirect =
  "Hexagon's type arrows are `->`, `->?`, `->!`; `=>` is the lambda arrow — " +
  "for a function type write `Int -> Int` (or `->?` / `->!` for its colour)";

describe("the discipline, unconditional", () => {
  it("compiles the whole prelude and runtime clean", () => {
    expect(effectDiagnostics([["/main.hex", "export let x: Int = 1\n"]])).toEqual([]);
  });

  it("compiles the migrated Seq clean — the acceptance test", () => {
    expect(withSeq("export let x: Int = 1\n")).toEqual([]);
  });
});

describe("#355 fold's body — the designated specimen, six directions", () => {
  /**
   * `stdlib/Seq.hex` with one mark in `fold`'s body mutated, seated as the
   * prelude member: a project file with a prelude basename wins over the
   * injected copy, which is how the migrated source itself is put under test.
   */
  function foldWith(next: string, combine: string): readonly string[] {
    const foldBody = seqSource.slice(seqSource.indexOf("export let fold("));
    const mutatedBody = foldBody
      .replace("match next(current)", `match next${next}(current)`)
      .replace("combine?(accumulator, value)", `combine${combine}(accumulator, value)`);
    // Guard against a replacement that silently matched nothing: only the
    // no-mutation case may leave the body untouched.
    expect(mutatedBody === foldBody).toBe(next === "" && combine === "?");
    const mutated = seqSource.slice(0, seqSource.indexOf("export let fold(")) + mutatedBody;
    return effectDiagnostics([["/Seq.hex", mutated], ["/main.hex", "export let x: Int = 1\n"]]);
  }

  it("wants no mark on `next` and `?` on `combine`", () => {
    expect(foldWith("", "?")).toEqual([]);
  });

  it("bare -> `?`: an unmarked forwarding call is refused with the `?` fixit", () => {
    expect(foldWith("", "")).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`combine` wants `?`, not no mark",
    ]);
  });

  it("bare -> `!`: a bare call on a constant-impure arrow is refused", () => {
    // `save` is impure by ruling 4's extern default, and the report names `!`.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let run(document: String): Unit = save(document)
`]]),
    ).toEqual([
      "this call runs effects, so `save` wants `!`, not no mark",
    ]);
  });

  it("`!` -> `?`: a source claimed where there is only a conduit", () => {
    expect(foldWith("", "!")).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`combine` wants `?`, not `!`",
    ]);
  });

  it("`!` -> bare: symmetric enforcement, a mark on a provably pure call", () => {
    expect(foldWith("!", "?")).toEqual([
      "this call is pure, so `next` wants no mark, not `!`",
    ]);
  });

  it("`?` -> bare: a conduit claimed where nothing conducts", () => {
    expect(foldWith("?", "?")).toEqual([
      "this call is pure, so `next` wants no mark, not `?`",
    ]);
  });

  it("`?` -> `!`: a conduit claimed where the colour is the impure constant", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let run(document: String): Unit = save?(document)
`]]),
    ).toEqual([
      "this call runs effects, so `save` wants `!`, not `?`",
    ]);
  });

  it("offers exactly one token as the fix, in each direction", () => {
    const mutated = seqSource.replace("combine?(accumulator, value)", "combine!(accumulator, value)");
    expect(
      effectFixes([["/Seq.hex", mutated], ["/main.hex", "export let x: Int = 1\n"]]),
    ).toEqual(['mark the call `?`: "?"']);
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

export let compose(first: String ->? String, second: String ->? String): (String ->? String) =
    (document) => second?(first?(document))
`;

  it("a call that only wires impurity through is bare", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${compose}
export let wired: (String ->! String) = compose(save2, audit2)
`]]),
    ).toEqual([]);
  });

  it("but the composite it returns demands `!` at its own call", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${compose}
export let run(document: String): String = compose(save2, audit2)(document)
`]]),
    ).toEqual([
      "this call runs effects, so this call wants `!`, not no mark",
    ]);
  });
});

describe("#405 the inlet rule — `->?` is refused where nothing can link it", () => {
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
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let ask(): String = readLine!()
`]]),
    ).toEqual([]);
  });

  it("refuses to let a caller instantiate it pure", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let ask(): String = readLine()
`]]),
    ).toEqual([
      "this call runs effects, so `readLine` wants `!`, not no mark",
    ]);
  });

  it("colours the enclosing function, so its own callers wear `!` too", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let ask(): String = readLine!()
export let twice(): String = ask() ++ ask!()
`]]),
    ).toEqual([
      "this call runs effects, so `ask` wants `!`, not no mark",
    ]);
  });

  it("refuses `->?` in a `record` field, naming the field as data", () => {
    // The predecessor read this as the impure constant. It is now §4.4's error:
    // a record declaration has no signature to quantify over, so the arrow has
    // nothing to denote — and a rejection is not a second meaning.
    expect(
      effectDiagnostics([["/main.hex", `
export record Source = { step: () ->? String }
export let drive(source: Source): String = (source.step)!()
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "a `record` field is data, not a signature; write `->!` for a function that " +
      "pulls the world, or `->` for one that does not",
    ]);
  });

  it("offers `->!` as the fix, which is what the writer meant", () => {
    expect(
      effectFixes([["/main.hex", `
export record Source = { step: () ->? String }
`]]),
    ).toEqual(['write `->!`: "->!"']);
  });

  it("refuses `->?` in a `union` field for the same reason", () => {
    expect(
      effectDiagnostics([["/main.hex", `
export union Step = Ready(() ->? String) | Done
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "a `union` field is data, not a signature; write `->!` for a function that " +
      "pulls the world, or `->` for one that does not",
    ]);
  });

  it("refuses `->?` in a `type` alias body, before the body can be inlined", () => {
    // Reported by the resolver, at the declaration: transparency means an alias
    // inlined into a signature that happens to have an inlet would otherwise
    // silently link, and one alias would name two colours across two mentions
    // (Declarations Preamble §5.1.1).
    expect(
      effectDiagnostics([["/main.hex", `
type Handler = () ->? String
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "an alias is a type fragment, not a signature; write `->!` for a function that " +
      "pulls the world, or `->` for one that does not",
    ]);
  });

  it("refuses it once, not twice, when the alias is also used", () => {
    expect(
      effectDiagnostics([["/main.hex", `
type Handler = () ->? String
export let run(h: Handler): String = h!()
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "an alias is a type fragment, not a signature; write `->!` for a function that " +
      "pulls the world, or `->` for one that does not",
    ]);
  });

  it("reports every offending arrow, not just the first in a file", () => {
    // The dedupe that keeps one arrow from being reported twice keys on source
    // *offsets*. Keying on the `Position` objects instead gave every arrow in a
    // file one `[object Object]` key, which silently turned the dedupe into a
    // per-file latch: a writer fixed one arrow, recompiled, and discovered the
    // next. Three independent offences owe three reports.
    expect(
      effectDiagnostics([["/main.hex", `
export record R = { step: () ->? String }
export record S = { other: (Int) ->? Int }
export union U = A(() ->? Int) | B
`]]).length,
    ).toBe(3);
  });

  it("admits a `->?` in an extern row's parameter — the row is a signature", () => {
    // An extern declares a signature like any other, so FFI Part 4 §4.5's
    // "function-typed slots carry whatever arrows the author writes" covers
    // `->?` too. The parameter is its own inlet (§2.2.1).
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export fun run(k: () ->? String): String
`]]),
    ).toEqual([]);
  });

  it("quantifies that row's colour, so two call sites may instantiate it apart", () => {
    // The row's own colour is the §6.1 default; the signature's variable belongs
    // to its callback slot. Left unquantified it would be one module-global
    // variable that the first call site pinned for every other — so a pure
    // callback and an impure one in the same module is the test that matters.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export fun run(k: () ->? String): String
    export fun save(document: String): Unit

export let pureUse(): String = run!(() => "x")
export let impureUse(): String = run!(() =>
    save!("a")
    "x")
`]]),
    ).toEqual([]);
  });

  it("still refuses a received-only `->?` in an extern row", () => {
    // #408's second refused shape: the arrow stands in what every application
    // hands *back*, so no argument the caller supplies contains it. The spine
    // walk reaches this result and finds the colour only on the arrow's own
    // slot, which is not an inlet.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export fun mk(seed: String): (String ->? String)
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "nothing a caller of this signature supplies carries `->?`, so nothing " +
      "instantiates it; " +
      "write `->!` for a function that pulls the world, or `->` for one that does not",
    ]);
  });

  it("takes the impure constant in a data field, spelled", () => {
    expect(
      effectDiagnostics([["/main.hex", `
export record Source = { step: () ->! String }
export let drive(source: Source): String = (source.step)!()
`]]),
    ).toEqual([]);
  });

  it("refuses the bare call through that field", () => {
    expect(
      effectDiagnostics([["/main.hex", `
export record Source = { step: () ->! String }
export let drive(source: Source): String = (source.step)()
`]]),
    ).toEqual([
      "this call runs effects, so this call wants `!`, not no mark",
    ]);
  });

  it("reads the same record shape as linked when it stands in a signature", () => {
    // The position still decides, but it now decides legal-vs-rejected rather
    // than between two meanings (§2.5): here the arrow is in a parameter
    // annotation, so it is part of this signature, links, and *is* the inlet
    // that makes itself legal.
    expect(
      effectDiagnostics([["/main.hex", `
export let drive(source: { step: () ->? String }): String = (source.step)?()
`]]),
    ).toEqual([]);
  });

  it("keeps a `->` field pure beside it — branch (ii)'s posture", () => {
    expect(
      effectDiagnostics([["/main.hex", `
export record Pure = { step: () -> String }
export let drive(source: Pure): String = (source.step)()
`]]),
    ).toEqual([]);
  });

  it("honours a user extern's `pure` claim", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
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
  const mk = `export let mk(): ((Int) ->? Int) ->? Int = (g: (Int) ->? Int): Int => g?(1)
`;

  it("admits the inferred face, unchanged", () => {
    const inferred = `let mk() = (g: (Int) ->? Int): Int => g?(1)
export let z: Int = mk()((n) => n)
`;
    expect(effectDiagnostics([["/main.hex", inferred]])).toEqual([]);
    // §10's premise, restored: the display shows one variable undecorated, and
    // the grammar can now spell what it shows. Nothing about the inferred form
    // moved — the widening changes which *written* faces are legal.
    expect(hoveredType(inferred, "mk()")).toBe("() -> (Int ->? Int) ->? Int");
  });

  it("now admits that face written down, and exported", () => {
    expect(effectDiagnostics([["/main.hex", mk]])).toEqual([]);
  });

  it("admits a three-step spine, whose inlet arrives at the third application", () => {
    expect(
      effectDiagnostics([["/main.hex", `export let mk3(): (Int) -> (((Int) ->? Int) ->? Int) =
    (a: Int): (((Int) ->? Int) ->? Int) => (g: (Int) ->? Int): Int => g?(a)
`]]),
    ).toEqual([]);
  });

  it("admits a record type standing in a spine arrow's parameter", () => {
    // Depth and polarity stay irrelevant *within* the supplied argument (§2.2.1):
    // the caller hands over the whole record, so it pins the field's colour too.
    expect(
      effectDiagnostics([["/main.hex", `export let mkr(): ({ step: () ->? String }) ->? String =
    (source: { step: () ->? String }): String => (source.step)?()
`]]),
    ).toEqual([]);
  });

  it("carries the face across the module boundary, at both colours", () => {
    // The export obligation the issue named: "un-exportable in principle" is
    // what the refusal made it. A second module instantiates the one variable
    // pure at one call and impure at the next, which is what a caller-pinned
    // colour means.
    expect(
      effectDiagnostics([
        ["/world.js", ""],
        ["/maker.hex", mk],
        ["/main.hex", `extern from "./world.js"
    export fun save(document: String): Unit

import { mk } from "./maker"

export let pureUse(): Int = mk()((n) => n)
export let impureUse(): Int = mk()!((n) =>
    save!("x")
    n)
`],
      ]),
    ).toEqual([]);
  });

  it("emits the face into the declaration file", () => {
    // Two variables, numbered: the signature's own (the spine's) and `mk`'s
    // outer colour, which the header form does not spell and which an
    // inlet-bearing body does not default (§3.4). The same shape `store`'s face
    // has displayed since #364.
    expect(declarationsOf([["/main.hex", mk]])).toContain(
      "Hexagon: `() ->?¹ (Int ->?² Int) ->?² Int`",
    );
  });

  it("still refuses the outer-only face — a spine arrow's colour is not an inlet", () => {
    expect(
      effectDiagnostics([["/main.hex", `export let f(x: Int): Int =
    let g: (String) ->? Int = (s: String): Int => 1
    x
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "nothing a caller of this signature supplies carries `->?`, so nothing " +
      "instantiates it; " +
      "write `->!` for a function that pulls the world, or `->` for one that does not",
    ]);
  });

  it("still refuses the received-only face, at a declaration's return annotation", () => {
    // The spine walk reaches this arrow and asks the right question of it: the
    // colour stands on the arrow the caller *receives*, and in no parameter of
    // any step, so nothing instantiates it.
    expect(
      effectDiagnostics([["/main.hex", `export let f(x: Int): (String) ->? Int = (s: String): Int => 1
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "nothing a caller of this signature supplies carries `->?`, so nothing " +
      "instantiates it; " +
      "write `->!` for a function that pulls the world, or `->` for one that does not",
    ]);
  });

  it("offers `->!` at both refusals, the fixit §4.4 gives every position", () => {
    expect(
      effectFixes([["/main.hex", `export let f(x: Int): (String) ->? Int = (s: String): Int => 1
`]]),
    ).toEqual(['write `->!`: "->!"']);
  });
});

describe("#408 §2.2.2 — a local type position names the enclosing colour", () => {
  /** `f`, with its one local position written the two ways that mean it. */
  const annotated = `export let f(g: () ->? String): String =
    let h: () ->? String = g
    h?()
`;
  const ascribed = `export let f(g: () ->? String): String =
    let h = (g : () ->? String)
    h?()
`;

  it("accepts the binding annotation, which the ascription always accepted", () => {
    // The divergence the issue found: same intent, same position, opposite
    // outcomes, and no rule distinguishing them. Both now link.
    expect(effectDiagnostics([["/main.hex", annotated]])).toEqual([]);
    expect(effectDiagnostics([["/main.hex", ascribed]])).toEqual([]);
  });

  it("names the *enclosing* variable, not a fresh one — one colour in the face", () => {
    // The discriminator: a fresh signature for the local annotation would leave
    // `f` conducting a colour of its own, and the face would display two
    // numbered variables. One undecorated `->?` everywhere is the claim.
    expect(hoveredType(annotated, "f(g")).toBe("(() ->? String) ->? String");
    expect(hoveredType(ascribed, "f(g")).toBe("(() ->? String) ->? String");
    expect(hoveredType("export let f(g: () ->? String): String = g?()\n", "f(g"))
      .toBe("(() ->? String) ->? String");
  });

  it("does not generalize the borrowed colour at the local `let`", () => {
    // A local `let` generalizes what its own level owns; the borrowed variable
    // belongs to the enclosing signature, so `h` is one colour and not a scheme
    // a second use may instantiate afresh. A bare call is refused for exactly
    // that reason.
    expect(
      effectDiagnostics([["/main.hex", `export let f(g: () ->? String): String =
    let h: () ->? String = g
    h()
`]]),
    ).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`h` wants `?`, not no mark",
    ]);
  });

  it("keeps a local function type with its own inlet a signature of its own", () => {
    // §2.2.2's first boundary. `k` carries an inlet, so it quantifies its own
    // colour: pinning that colour impure at a call says nothing about `f`'s
    // face, which stays effect-polymorphic. Were the two one variable, this
    // program would take §4.2's constantified-face report.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let f(g: () ->? String): String =
    let k(q: () ->? String): String = q?()
    k!(readLine) ++ g?()
`]]),
    ).toEqual([]);
  });

  it("refuses both spellings in an inlet-less body — there is nothing to lend", () => {
    // The legality condition is the enclosing signature's own: a local `->?` is
    // legal exactly where that signature admits one, and it never supplies the
    // inlet it needs.
    const clause = "`->?` is the caller's colour, and this position has no caller to " +
      "choose it — nothing a caller of this signature supplies carries `->?`, so " +
      "nothing instantiates it; write `->!` for a function that pulls the world, " +
      "or `->` for one that does not";
    expect(
      effectDiagnostics([["/main.hex", `export let f(x: Int): Int =
    let h: () ->? String = () => "s"
    x
`]]),
    ).toEqual([clause]);
    expect(
      effectDiagnostics([["/main.hex", `export let f(x: Int): Int =
    let h = ((): String => "s" : () ->? String)
    x
`]]),
    ).toEqual([clause]);
  });

  it("names the missing signature where there is no signature to lack an inlet", () => {
    // §2.2.2's second boundary, and §4.4's fifth row. The split is shape and
    // doctrine rather than position: a record type in a module-level binding has
    // no signature at all to be missing an inlet, and an `extern let` declares a
    // foreign *value* whatever its annotation's shape — the callable form with a
    // signature of its own is `extern fun` (FFI Part 4 §4.5).
    const clause = "`->?` is the caller's colour, and this position has no caller to " +
      "choose it — this annotation is not part of a function signature; write " +
      "`->!` for a function that pulls the world, or `->` for one that does not";
    expect(
      effectDiagnostics([["/main.hex", `let h: { step: () ->? String } = { step = () => "x" }
export let z: Int = 1
`]]),
    ).toEqual([clause]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export let handler: () ->? String
`]]),
    ).toEqual([
      "extern callable declarations use `fun`; write `fun handler(...)` with explicit parameters",
      clause,
    ]);
  });

  it("keeps the signature clause for a record type *inside* a body", () => {
    // Shape selects the clause only where there is no enclosing signature. In an
    // inlet-less body there is one — it is the thing without the inlet — so a
    // `->?` in a record-type annotation is told what it actually lacks.
    expect(
      effectDiagnostics([["/main.hex", `export let f(x: Int): Int =
    let h: { step: () ->? String } = { step = () => "s" }
    x
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "nothing a caller of this signature supplies carries `->?`, so nothing " +
      "instantiates it; " +
      "write `->!` for a function that pulls the world, or `->` for one that does not",
    ]);
  });

  it("calls a module-level function-type annotation a signature, and names its want", () => {
    // A binding annotation that is itself a function type is a signature
    // *wherever it stands*, so the inlet-less one is an outer-only face and owes
    // §2.2.1's sentence: it is not that there is no signature here, it is that
    // nothing a caller supplies carries the colour. The `var` goes the same way
    // — shape decides for it as for a `let` — under its own module-level refusal.
    const clause = "`->?` is the caller's colour, and this position has no caller to " +
      "choose it — nothing a caller of this signature supplies carries `->?`, so " +
      "nothing instantiates it; write `->!` for a function that pulls the world, " +
      "or `->` for one that does not";
    expect(
      effectDiagnostics([["/main.hex", `let h: () ->? String = () => "x"
export let z: Int = 1
`]]),
    ).toEqual([clause]);
    expect(
      effectDiagnostics([["/main.hex", `var h: () ->? String = () => "x"
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
      effectDiagnostics([["/main.hex", `let h: (() ->? String) ->? String = (k: () ->? String): String => k?()
export let z: Int = 1
`]]),
    ).toEqual([]);
    expect(
      effectFixes([["/main.hex", `let h: () ->? String = () => "x"
export let z: Int = 1
`]]),
    ).toEqual(['write `->!`: "->!"']);
  });
});

describe("#408 §4.2 — the face report stands at the written arrow", () => {
  const nested = `${world}
export let step(n: Int): Int =
    save!("x")
    n

export let f(h: ((Int) ->? Int) -> Int): Int = h(step)
`;

  it("reports at `h`'s nested arrow, and rewrites that arrow", () => {
    // `f`'s own outer arrow is `->`, returning `Int`, and it is honest: the
    // arrow that constantified is `h`'s parameter's. The advice to give the
    // *binding* an explicit face would have fixed nothing here.
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", nested]])).toEqual([
      "this signature's `->?` promises a colour the caller chooses, but the body " +
      "solves it to the impure constant — a function that performs its own " +
      "unconditional effects rounds up, and its face is `->!`",
    ]);
    const [report] = effectSpans([["/world.js", ""], ["/main.hex", nested]]);
    expect(report).toEqual({
      primary: nested.indexOf("->?"),
      edits: [nested.indexOf("->?")],
    });
  });

  it("rewrites every nested occurrence when the outer arrow is not one of them", () => {
    // The other half of the join rule: with no written outer arrow there is no
    // join to preserve, and the nested spelling is the whole of the condemned
    // colour — both parameters carry it, and both are repaired.
    const two = `${world}
export let step(n: Int): Int =
    save!("x")
    n

export let f(h: ((Int) ->? Int) -> Int, k: ((Int) ->? Int) -> Int): Int = h(step) + k(step)
`;
    const [report] = effectSpans([["/world.js", ""], ["/main.hex", two]]);
    expect(report?.edits).toEqual([
      two.indexOf("->?"),
      two.indexOf("->?", two.indexOf("->?") + 1),
    ]);
  });

  it("rewrites every occurrence in the pure direction — there is no join to keep", () => {
    // §4.2's last sentence. The callback meets a `->` demand, so the signature's
    // one colour solves *pure*, and every arrow that spells it — the annotation's
    // two and the lambda parameter's — is over-claiming.
    const pureFace = `export let strict(step: String -> String, d: String): String = step(d)
export let f: ((String ->? String) ->? String) = (run: String ->? String): String =>
    strict(run, "body")
`;
    expect(effectDiagnostics([["/main.hex", pureFace]])).toEqual([
      "this signature's `->?` promises a colour the caller chooses, but the body " +
      "solves it to the pure constant — the honest face is `->`",
    ]);
    expect(effectFixes([["/main.hex", pureFace]])).toEqual([
      'write `->`: "->"',
      'write `->`: "->"',
      'write `->`: "->"',
    ]);
    // And the rewrite is a repair: the same program with `->` throughout checks.
    expect(
      effectDiagnostics([["/main.hex", `export let strict(step: String -> String, d: String): String = step(d)
export let f: ((String -> String) -> String) = (run: String -> String): String =>
    strict(run, "body")
`]]),
    ).toEqual([]);
  });
});

describe("#408 §4.4 — the recovery is scaffolding, not a second claim", () => {
  it("collapses the reverse-demand cascade at a module-level record type", () => {
    // Measured before the ruling: the *first* report a writer saw here was the
    // §4.3 reverse demand — a sentence about a declared impure constant the
    // program never wrote, produced by the recovery itself.
    expect(
      effectDiagnostics([["/main.hex", `let h: { step: () ->? String } = { step = () => "x" }
export let z: Int = 1
`]]).length,
    ).toBe(1);
  });

  it("collapses the mark cascade in a body that goes on to call the binding", () => {
    // The affirmatively false one: "this call runs effects, so `h` wants `!`" —
    // when what made the call impure was the recovery standing in for the
    // refused arrow.
    expect(
      effectDiagnostics([["/main.hex", `export let f(x: Int): Int =
    let h: () ->? String = () => "s"
    let y = h?()
    x
`]]).length,
    ).toBe(1);
  });

  it("suppresses the pure-face report under a written `->` face", () => {
    // The third downstream client: the body's own colour is the pure constant
    // because the binding annotation says so, and the only call that would
    // contradict it is impure by recovery. Un-suppressed this adds "a pure face
    // cannot run effects" — about effects the program does not perform.
    expect(
      effectDiagnostics([["/main.hex", `export let f: ((Int) -> Int) = (x: Int): Int =>
    let h: () ->? String = () => "s"
    let y = h?()
    x
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "nothing a caller of this signature supplies carries `->?`, so nothing " +
      "instantiates it; " +
      "write `->!` for a function that pulls the world, or `->` for one that does not",
    ]);
  });

  it("suppresses the constantified-face report when a recovery pins the colour", () => {
    // The fourth: a recovered arrow travelling into a linked parameter unifies
    // the *signature's* variable with the recovery, and §4.2 would then condemn
    // a face for a colour the writer never wrote. (The `?` on `mkBad` is an
    // ordinary conservative mark, §3.4's, and stands on its own.)
    expect(
      effectDiagnostics([["/main.hex", `export let f(g: (() ->? String) -> String): String =
    let mkBad = (): (() ->? String) => (): String => "x"
    g(mkBad())
`]]),
    ).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "nothing a caller of this signature supplies carries `->?`, so nothing " +
      "instantiates it; " +
      "write `->!` for a function that pulls the world, or `->` for one that does not",
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`mkBad` wants `?`, not no mark",
    ]);
  });
});

describe("#355 ruling 9 — `->!`, the const ⊔ var face", () => {
  const shape = (arrow: string) => `${world}
export let withTransaction: ((String ->? String) ${arrow} String) = (run: String ->? String): String =>
    save!("begin")
    let result = run?("body")
    audit!("commit")
    result
`;

  it("checks with the banged arrow", () => {
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", shape("->!")]])).toEqual([]);
  });

  it("refuses the `->?` face, naming `->!`", () => {
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", shape("->?")]])).toEqual([
      "this signature's `->?` promises a colour the caller chooses, but the body " +
      "solves it to the impure constant — a function that performs its own " +
      "unconditional effects rounds up, and its face is `->!`",
    ]);
    // §4.2 (#408): the impure direction's fixit is the join. Three arrows write
    // this one colour — the binding annotation's two and the lambda parameter's
    // — and the repair is the *outer* one alone: `(String ->? String) ->! String`
    // is the face, and rewriting the callback's arrow with it would refuse the
    // pure callbacks §2.4 keeps.
    expect(effectFixes([["/world.js", ""], ["/main.hex", shape("->?")]])).toEqual([
      'write `->!`: "->!"',
    ]);
    // The one edit lands on the outer arrow, and the repaired source compiles.
    const source = shape("->?");
    const [report] = effectSpans([["/world.js", ""], ["/main.hex", source]]);
    // `((String ->? String) ->? String)`: the arrow after the callback's closing
    // paren is the outer one, and it is the only span the fixit touches.
    expect(report?.edits).toEqual([source.indexOf(") ->? String) =") + 2]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", shape("->!")]]),
    ).toEqual([]);
  });

  it("refuses a `->!` face over a body that performs no unconditional effect", () => {
    const source = `${world}
export let apply: ((String ->? String) ->! String) = (run: String ->? String): String => run?("body")
`;
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", source]])).toEqual([
      "this face is the impure constant `->!`, but the body performs no " +
      "unconditional effect — it is effect-polymorphic, and its face is `->?`",
    ]);
    expect(effectFixes([["/world.js", ""], ["/main.hex", source]])).toEqual(['write `->?`: "->?"']);
  });

  it("demands `!` at every call site, pure callback or not", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${shape("->!")}
export let go(): String = withTransaction((document) => document)
`]]),
    ).toEqual([
      "this call runs effects, so `withTransaction` wants `!`, not no mark",
    ]);
  });

  it("keeps a pure callback pure through the banged face", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${shape("->!")}
export let go(): String = withTransaction!((document) => document)
`]]),
    ).toEqual([]);
  });
});

describe("#355 eager combinators — the shape Map/Set will imitate", () => {
  const eager = `${world}
export let map(values: Vector(a), transform: a ->? b): Vector(b) =
    var out: Vector(b) = []
    var index = 1
    while index <= Vector.length(values)
        out := Vector.append(out, transform?(Vector.at(values, index)))
        index := index + 1
    out

export let fold(values: Vector(a), initial: b, combine: (b, a) ->? b): b =
    var total = initial
    var index = 1
    while index <= Vector.length(values)
        total := combine?(total, Vector.at(values, index))
        index := index + 1
    total
`;

  it("takes a pure callback bare and an impure one banged", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${eager}
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
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${eager}
export let saveAll(values: Vector(String)): Vector(String) =
    map(values, (document) =>
        save!(document)
        document)
`]]),
    ).toEqual([
      "this call runs effects, so `map` wants `!`, not no mark",
    ]);
  });

  it("refuses `!` at a pure instantiation — symmetric enforcement", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${eager}
export let stamped(values: Vector(String)): Vector(String) =
    map!(values, (text) => text ++ ".")
`]]),
    ).toEqual([
      "this call is pure, so `map` wants no mark, not `!`",
    ]);
  });
});

describe("#355 grammar — where a mark may stand", () => {
  it("carries a bare pipe stage's mark onto the call the rewrite makes", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let run(document: String): Unit = document |> save!
`]]),
    ).toEqual([]);
  });

  it("keeps the bare pipe legal for pure stages", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let clean(document: String): String = document |> trim
`]]),
    ).toEqual([]);
  });

  it("refuses a bare pipe stage whose call is impure", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let run(document: String): Unit = document |> save
`]]),
    ).toEqual([
      "this call runs effects, so `save` wants `!`, not no mark",
    ]);
  });

  it("marks a call through a non-identifier callee", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let pull(source: { step: (() ->! String) }): String = (source.step)!()
`]]),
    ).toEqual([]);
  });

  it("marks a dot call before its own argument list", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let stamp(document: String): String = document.show()
`]]),
    ).toEqual([]);
  });

  it("refuses a mark on a reference — references are colourless", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let held: (String ->! Unit) = save!
`]]),
    ).toEqual([markSeat]);
  });

  it("stores an impure function without a mark", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
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
      effectDiagnostics([["/main.hex", "export let f(flag: Bool): Bool = !flag\n"]]),
    ).toEqual(["Hexagon spells logical negation `not`"]);
    // Parenthesizing the operand does not make it a call: nothing precedes the
    // mark, so there is no argument list for it to govern either way.
    expect(
      effectDiagnostics([["/main.hex", "export let f(flag: Bool): Bool = !(flag)\n"]]),
    ).toEqual(["Hexagon spells logical negation `not`"]);
  });

  it("gives a prefix `?` the mark-position row instead", () => {
    // `?` never had the negation reading, so the same seat takes the other row.
    expect(
      effectDiagnostics([["/main.hex", "export let f(flag: Bool): Bool = ?flag\n"]]),
    ).toEqual([markSeat]);
  });

  it("redirects a `=>` written in type position, collapsing the cascade (#410)", () => {
    // §9's type-arrow row. Both specimens are #410's own measurements. Before
    // the redirect the first produced a parse cascade — "expected `)` after
    // parameters", then "expected `=` in `let` binding" — and the second the
    // layout pass's "expected a newline or `;` between block items"; neither
    // mentioned an arrow. The teaching report replaces the lot, one per typo.
    expect(
      effectDiagnostics([["/main.hex", "let f(g: (Int) => Int): Int = g(1)\n"]]),
    ).toEqual([typeArrowRedirect]);
    expect(
      effectDiagnostics([["/main.hex", "type H = (Int) =>! Int\n"]]),
    ).toEqual([typeArrowRedirect]);
  });

  it("recovers the redirected arrow as the one it advises, so checking continues", () => {
    // Resolve-and-retain, the family's recovery: the annotation is the type the
    // fixit would have written, so the rest of the module is checked against it
    // rather than abandoned. `=>!` recovers as `->!`, which is visible here as
    // the impure call's own mark row firing behind the redirect.
    expect(
      effectDiagnostics([["/main.hex", "let f(g: (Int) =>! Int): Int = g(1)\n"]]),
    ).toEqual([typeArrowRedirect, "this call runs effects, so `g` wants `!`, not no mark"]);
    // And taking the advice is the whole repair — nothing else was wrong.
    expect(
      effectDiagnostics([["/main.hex", "let f(g: (Int) -> Int): Int = g(1)\n"]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/main.hex", "let f(g: (Int) ->! Int): Int = g!(1)\n"]]),
    ).toEqual([]);
  });

  it("leaves the curried lambda alone: there the `=>` is the body's (#410)", () => {
    // §2.6's own pair, end to end. This is the redirect's one carve-out — the
    // slot where a fat arrow after a complete annotation is legal — so it is
    // pinned as *silence*, not as a different message.
    expect(
      effectDiagnostics([["/main.hex", "export let k = (x: Int): (Int) -> Int => (y: Int) => x\n"]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/main.hex", "export let f = (x: Int): Int -> Int -> Int => (y: Int) => (z: Int) => x\n"]]),
    ).toEqual([]);
  });

  it("requires the mark glued to the argument list it governs", () => {
    // Lexer §8.1 spells the seat "glued immediately before `(`". The prototype
    // accepted every spacing, which makes a mark look like an operator.
    const spellings = ["readLine ! ()", "readLine! ()", "readLine !()"];
    for (const spelling of spellings) {
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let ask(): String = ${spelling}
`]]),
      ).toEqual([markSeat]);
    }
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let ask(): String = readLine!()
`]]),
    ).toEqual([]);
  });

  it("requires a pipe stage's mark glued to the stage", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let run(document: String): Unit = document |> save !
`]]),
    ).toEqual([markSeat]);
  });

  it("does not admit `!=>`, which `!=` would win", () => {
    // `!=` takes the maximal munch, so the type ends at `Int` and the `!` is
    // never an arrow. Pinned on the exact reports, because "it errors" is true
    // of the admitted spelling too.
    expect(
      effectDiagnostics([["/main.hex", "export let f: (Int !=> Int) = (x) => x\n"]]),
    ).toEqual(["expected `)` after type", "expected `=` in `let` binding"]);
  });
});

describe("#355 the `pure` claim — FFI Part 4 §4.5", () => {
  it("honours it on an extern `fun`", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let clean(document: String): String = trim(document)
`]]),
    ).toEqual([]);
  });

  it("refuses it on an extern `let` — a value reference has no face", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export pure let seed: Int
`]]),
    ).toEqual([
      "`pure` claims a function's face, and a value reference carries no colour " +
      "— the claim belongs on an extern `fun`",
    ]);
  });

  it("refuses it on an extern `type`", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export pure type Handle
`]]),
    ).toEqual([
      "`pure` claims a function's face, and a type has none — the claim belongs " +
      "on an extern `fun`",
    ]);
  });

  it("keeps `pure` an ordinary name everywhere else", () => {
    // Contextual vocabulary (Lexer §4.2's family): the refusals above must not
    // have reserved the word.
    expect(
      effectDiagnostics([["/main.hex", `
export let pure(value: Int): Int = value
export let doubled: Int = pure(21) + pure(21)
`]]),
    ).toEqual([]);
  });
});

describe("#409 the `conduit` claim — FFI Part 4 §4.5", () => {
  /**
   * The ruling's own specimen. `conduit` seats one colour variable at the row's
   * outer arrow *and* at every `->?` the signature writes, so the row is exactly
   * as effectful as its callbacks, jointly.
   */
  const runner = `extern from "./world.js"
    export conduit fun runner(step: () ->? String): Int
    export fun readLine(): String
`;

  /** Two linked slots on one row — still one variable (Effects §2.2). */
  const both = `extern from "./world.js"
    export conduit fun both(first: () ->? String, second: () ->? String): Int
    export fun readLine(): String
`;

  const unlinkedConduit =
    "`conduit` claims this row is exactly as effectful as its callbacks, and " +
    "this signature has no `->?` slot to take that colour from — write `->?` " +
    "on the callback parameter this row runs, or drop the claim and take the " +
    "impure default";

  const oneClaim =
    "one row, one claim: `pure` says this function never observably invokes " +
    "what it is handed, and `conduit` says it is exactly as effectful as " +
    "what it is handed — write one";

  it("admits the row, and produces the ordinary linked face", () => {
    // No new face vocabulary: what the keyword yields is a face the written
    // grammar can already spell, displayed with the plain `->?` because it
    // carries exactly one variable (§10's single-variable rule).
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", runner]])).toEqual([]);
    expect(hoveredType(runner, "runner")).toBe("(() ->? String) ->? Int");
  });

  it("takes a bare call with a pure callback", () => {
    // The whole point of the claim, and the thing the impure default could not
    // express: a pure callback costs its caller no mark at all.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${runner}
export let n: Int = runner(() => "x")
`]]),
    ).toEqual([]);
  });

  it("demands `!` with an impure callback, and refuses the bare call", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${runner}
export let n: Int = runner!(() => readLine!())
`]]),
    ).toEqual([]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${runner}
export let n: Int = runner(() => readLine!())
`]]),
    ).toEqual([
      "this call runs effects, so `runner` wants `!`, not no mark",
    ]);
  });

  it("conducts inside an inlet-bearing body, wearing `?`", () => {
    // §3.3's third arm, reached with no FFI-specific rule: the enclosing
    // signature's variable is what the row's outer arrow instantiates to.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${runner}
export let use(k: () ->? String): Int = runner?(k)
`]]),
    ).toEqual([]);
  });

  it("joins every `->?` slot into one colour, exactly as a written signature does", () => {
    // One variable per signature (§2.2) is not relaxed at the boundary: the two
    // slots are one colour, so both callbacks are pure or both are impure, and
    // the outer arrow follows them. The in-language twin below is the control —
    // the keyword must add no behaviour of its own.
    const twin = `extern from "./world.js"
    export fun readLine(): String

export let both(first: () ->? String, second: () ->? String): Int =
    let a: String = first?()
    let b: String = second?()
    1
`;
    for (const source of [both, twin]) {
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", `${source}
export let pureUse: Int = both(() => "a", () => "b")
`]]),
      ).toEqual([]);
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", `${source}
export let impureUse: Int = both!(() => readLine!(), () => readLine!())
`]]),
      ).toEqual([]);
      // Mixing the colours in one call is §4.3's pure demand, not a join: the
      // pure lambda pins the shared variable, and the impure one then meets a
      // `->`. Pinned on both spellings because "the extern behaves like the
      // written signature" is the claim, and a difference here would be one.
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", `${source}
export let mixed: Int = both!(() => "a", () => readLine!())
`]]),
      ).toEqual([
        "a `->` arrow promises purity, and this function performs effects — " +
        "the demand is written `->`, the function's face `->?` or `->!`",
        "this call is pure, so `both` wants no mark, not `!`",
      ]);
    }
  });

  it("quantifies the colour, so two call sites instantiate it apart", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${runner}
export let pureUse: Int = runner(() => "x")
export let impureUse: Int = runner!(() => readLine!())
`]]),
    ).toEqual([]);
  });

  it("refuses the claim on a row with no `->?` slot to link to", () => {
    // §4.1's and §4.4's own sentence, at the claim: one spelling, one meaning,
    // and where the meaning is unavailable, a diagnostic rather than a silent
    // re-read as the impure default.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export conduit fun runner(step: () -> String): Int
`]]),
    ).toEqual([unlinkedConduit]);
    // A row with no function-typed parameter at all takes the same report.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export conduit fun trim(document: String): String
`]]),
    ).toEqual([unlinkedConduit]);
  });

  it("stands that report on the claim word itself", () => {
    const source = `extern from "./world.js"
    export conduit fun trim(document: String): String
`;
    expect(effectSpans([["/world.js", ""], ["/main.hex", source]])).toEqual([
      { primary: source.indexOf("conduit"), edits: [] },
    ]);
  });

  it("refuses `pure conduit`, in either order — one row, one claim", () => {
    for (const claims of ["pure conduit", "conduit pure"]) {
      expect(
        effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export ${claims} fun runner(step: () ->? String): Int
`]]),
      ).toEqual([oneClaim]);
    }
  });

  it("believes neither claim behind that report, so the row takes the impure default", () => {
    // The honest fallback for a row that claimed nothing — and the reason the
    // conflict costs exactly one report rather than cascading through the body.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export pure conduit fun runner(step: () ->? String): Int

export let n: Int = runner!(() => "x")
`]]),
    ).toEqual([oneClaim]);
  });

  it("refuses it on an extern `let` and an extern `type`, as `pure` is refused", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export conduit let seed: Int
`]]),
    ).toEqual([
      "`conduit` claims a function's face, and a value reference carries no colour " +
      "— the claim belongs on an extern `fun`",
    ]);
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export conduit type Handle
`]]),
    ).toEqual([
      "`conduit` claims a function's face, and a type has none — the claim belongs " +
      "on an extern `fun`",
    ]);
  });

  it("refuses either claim on an intrinsic row, naming the word that was written", () => {
    // Effects §6.1's ownership split, from the verified side: the intrinsic
    // door's colours come from Intrinsics §4.2's verification, so neither
    // trusted claim has anything to do there. The privilege gate speaks first
    // — this is an ordinary user file — and the claim refusal rides beside it.
    for (const claim of ["pure", "conduit"]) {
      expect(
        effectDiagnostics([["/main.hex", `extern from "hex:intrinsic"
    ${claim} fun seqMemoize(source: Seq(a)): Seq(a)
`]]),
      ).toEqual([
        "the `hex:` specifier scheme is reserved to standard-library source; to bind " +
        "your own JavaScript implementation, use an ordinary `extern from` block " +
        "naming your module",
        `intrinsic rows are verified rather than trusted; \`${claim}\` is for user-written externs`,
      ]);
    }
  });

  it("keeps `conduit` an ordinary name everywhere else", () => {
    // Contextual vocabulary (Lexer §4.2's family), exactly as `pure` is: the
    // refusals above must not have reserved the word.
    expect(
      effectDiagnostics([["/main.hex", `
export record Pipe = { conduit: Int }
export let conduit(value: Int): Int = value
export let total: Int = conduit(21) + Pipe({ conduit = 21 }).conduit
`]]),
    ).toEqual([]);
    // And the foreign side of a row is not the claim slot either.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export fun conduit(value: Int): Int
`]]),
    ).toEqual([]);
  });

  it("carries the linked face into the emitted `.d.ts`", () => {
    expect(declarationsOf([["/world.js", ""], ["/main.hex", runner]])).toContain(
      "/** Hexagon: `(() ->? String) ->? Int` */\nexport declare function runner(",
    );
  });
});

describe("#355 marks on the deferred dot-call goal path (Method Syntax §3)", () => {
  // A dot call whose receiver is a flexible tyvar pends: the evidence arrives
  // later in the owner region, and the goal settles at that region's deadline
  // (§3.1). The mark still anchors to *this* argument list (Effects §3.2,
  // ruling 2), and it is read off the colour the deadline finally produced.
  const deferred = (mark: string) => `${world}
let run(source): Seq(String) =
    source.forEach${mark}((value) => save!(value))
    let pinned: Seq(String) = source
    pinned

export let x: Int = 1
`;

  it("wants `!` on a goal that settles onto an impure instantiation", () => {
    expect(withSeq(deferred("!"))).toEqual([]);
  });

  it("names the member in §9's frame when the mark is missing", () => {
    expect(withSeq(deferred(""))).toEqual([
      "this call runs effects, so `.forEach` wants `!`, not no mark",
    ]);
  });

  it("carries the settled colour out to the enclosing body's callers", () => {
    expect(
      withSeq(`${world}
let run(source): Seq(String) =
    source.forEach!((value) => save!(value))
    let pinned: Seq(String) = source
    pinned

let go(source: Seq(String)): Seq(String) = run(source)

export let x: Int = 1
`),
    ).toEqual([
      "this call runs effects, so `run` wants `!`, not no mark",
    ]);
  });

  it("makes the row fallback's arrow the pure one, and enforces it", () => {
    // A goal whose receiver never becomes head-known takes §3.5's fallback,
    // which imposes `{next: () -> a, ...}` — a `->`, written so in the spec, and
    // a row is data (Effects §2.5). So the call is pure and a mark on it is
    // refused. The prototype registered no obligation at all here, and every
    // mark on a fallback-resolved dot call was silently accepted.
    for (const [mark, name] of [["!", "`!`"], ["?", "`?`"]] as const) {
      expect(
        effectDiagnostics([["/main.hex", `
let drive(source): String = source.next${mark}()

export let x: Int = 1
`]]),
      ).toEqual([`this call is pure, so \`.next\` wants no mark, not ${name}`]);
    }
    expect(
      effectDiagnostics([["/main.hex", `
let drive(source): String = source.next()

export let x: Int = 1
`]]),
    ).toEqual([]);
  });

  it("refuses an impure field at the row the fallback imposed", () => {
    // The other half of the same arrow: the row demands purity, so supplying an
    // impure step is §4.3's refusal rather than a silent widening.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
let drive(source): Unit = source.step()

export let go(): Unit = drive({ step = () => save!("x") })
`]]),
    ).toEqual([
      "a `->` arrow promises purity, and this function performs effects — the " +
      "demand is written `->`, the function's face `->?` or `->!`",
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
let store(callback: () ->? String): Int = 1
let stored = pick(store)
`;

  it("generalizes a computed binding's own colour", () => {
    // `stored`'s right-hand side is an application, so the value restriction
    // applies and item 7 decides. Its own outer colour occurs only at the root —
    // covariant-only — so the two faces below are two instantiations, not a
    // contradiction.
    expect(
      effectDiagnostics([["/main.hex", `${inletFace}
export let asPure: ((() -> String) -> Int) = stored
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
      effectDiagnostics([["/main.hex", `${inletFace}
export let asPure: ((() -> String) -> Int) = stored
export let asImpure: ((() ->! String) -> Int) = stored
`]]),
    ).toEqual([
      "this position's arrow is the impure constant — its colour is fixed where " +
      "the type is declared, and this function's face is the pure `->`; the " +
      "demand cannot weaken — change the position's declared arrow, or supply " +
      "the effectful function the position promises",
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
   * levels sharing the `=>` token; the type arrows are now `->`, `->?`, `->!`
   * and the lambda's is `=>`, so a greedy annotation parse cannot reach the
   * body and there is nothing left to disambiguate.
   */

  it("takes an unparenthesized function type as the return type", () => {
    expect(
      effectDiagnostics([["/main.hex", `
export let curried(seed: Int): Int =
    let make = (x: Int): Int -> Int => (y: Int) => x
    make(seed)(seed)
`]]),
    ).toEqual([]);
  });

  it("takes an unparenthesized impure function type too", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let maker = (seed: String): String ->! Unit => save
export let run(document: String): Unit = maker("s")!(document)
`]]),
    ).toEqual([]);
  });

  it("still reads the parenthesized form the same way", () => {
    // Parentheses did not stop meaning grouping; they merely stopped being
    // mandatory.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
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
      effectDiagnostics([["/main.hex", `
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
      effectDiagnostics([["/main.hex", `export let f = (x: Int): Int -> Int => x
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
 * colour, and the undecorated `->?` covers every face with exactly one effect
 * variable — which is what a written signature spells, since the grammar links
 * every `->?` into one colour. Only a face with *more than one* is numbered,
 * by first appearance, because only that is inexpressible.
 *
 * The predecessor also numbered a lone variable with no inlet occurrence: the
 * else-constant rule read an inlet-less written arrow back as the impure
 * constant, so the plain spelling would have meant something else. That rule is
 * withdrawn, and with it the case — a plain `->?` is exactly right about the
 * colour, and pasting it somewhere that cannot host it is §4.4's error, which
 * explains itself where a lexer failure would not.
 */
describe("#364 the arrow trio, displayed", () => {
  const composeSource = `${world}
export let save2(document: String): String =
    save!(document)
    document

export let compose(first: String ->? String, second: String ->? String): (String ->? String) =
    (document) => second?(first?(document))

export let withTransaction: ((String ->? String) ->! String) = (run: String ->? String): String =>
    save!("begin")
    run?("body")

export let clean(document: String): String = trim(document)
`;

  it("numbers the headline probe's distinct colours", () => {
    // §10's own specimen. `compose`'s parameters share one variable and its own
    // colour is a second, unconstrained one (§3.4's third arm) — so the face is
    // *not* the one the written `(String ->? String, String ->? String) => …`
    // would mean, and the numbers are what say so.
    expect(hoveredType(composeSource, "compose")).toBe(
      "(String ->?¹ String, String ->?¹ String) ->?² String ->?¹ String",
    );
  });

  it("leaves a single-variable face undecorated, so it writes back unchanged", () => {
    // One variable, one spelling: the annotation grammar links every written
    // `=>` into one variable (§2.2), so this face round-trips exactly.
    expect(hoveredType(composeSource, "withTransaction")).toBe(
      "(String ->? String) ->! String",
    );
  });

  it("displays a linked conduit's whole signature with the plain arrow", () => {
    // `fold`'s shape is the designated specimen: the body conducts, so its own
    // colour *unifies with* the callback's (§3.4) rather than standing apart,
    // and one variable covers the whole face — which is why nothing is
    // numbered and the face is exactly what a writer would write.
    const source = `export let fold(values: Vector(a), initial: b, combine: (b, a) ->? b): b =
    var total = initial
    var index = 1
    while index <= Vector.length(values)
        total := combine?(total, Vector.at(values, index))
        index := index + 1
    total
`;
    expect(hoveredType(source, "fold")).toBe(
      "(Vector(a), b, (b, a) ->? b) ->? b",
    );
  });

  it("carries the constraint bracket and the colour in one face (#410)", () => {
    // The two display marks meet: #410's source-shaped bracket in front,
    // #364's colour on the arrows behind, and one space between them. Neither
    // rule knows about the other, so nothing but a pin says they compose.
    //
    // The callback is annotated deliberately. An unannotated `g?(1)` is
    // refused by the pure demand, which is effects doctrine (§4) and no
    // business of the display's. `show(...)` is simply the plainer seat for the
    // `Show` constraint: an interpolation would serve as well, and compiles
    // with the same face.
    const source = `let k(x: _ : Show, g: (a) ->? a) = show(g?(x))
export let out: String = k("a", (s) => s)
`;
    expect(hoveredType(source, "k(")).toBe("<a: Show> (a, a ->? a) ->? String");
  });

  it("leaves a lone colour plain even where it offers no inlet (#405)", () => {
    // The predecessor numbered this: with the else-constant rule in force, a
    // sole `=>` and no parameter-position occurrence read back as the impure
    // constant, so `(() -> String) => Int` would come back a different type.
    // With the rule withdrawn there is one colour and one spelling for it, and
    // a paste into a position with no inlet is §4.4's error rather than a
    // silent change of meaning.
    const source = `export let make(): String = "x"
export let hold(f: (() -> String) ->? Int): Int = f?(make)
`;
    expect(hoveredType(source, "f:")).toBe("(() -> String) ->? Int");
    expect(hoveredType(source, "hold")).toBe(
      "((() -> String) ->? Int) ->? Int",
    );
  });

  it("leaves a callback parameter plain when hovered on its own", () => {
    // The everyday shape of the same change: `first`'s colour is the enclosing
    // signature's, and as a face in its own right it is still one colour, so it
    // is still spelled `->?`.
    expect(hoveredType(composeSource, "first:")).toBe("String ->? String");
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
export let hold(step: () ->? Int, value: a): a = value
`;
    expect(hoveredType(source, "hold")).toBe(
      "(() ->?¹ Int, a) ->?² a",
    );
  });

  it("says the same thing in the emitted `.d.ts`, where TypeScript cannot", () => {
    // TypeScript has one function arrow, so the trio has no seat in the face
    // itself; `spec/doc-comments.md` §7.3 provides the one channel that is left,
    // and the author's own documentation shares the block.
    const emitted = declarationsOf(
      [["/world.js", ""], ["/main.hex", `${world}
(** Runs both, in order. *)
export let compose(first: String ->? String, second: String ->? String): (String ->? String) =
    (document) => second?(first?(document))
`]],
    );
    expect(emitted).toContain(
      " * Hexagon: `(String ->?¹ String, String ->?¹ String) ->?² String ->?¹ String`",
    );
    expect(emitted).toContain(" * Runs both, in order.");
    // The colours erase (§8), so they take no TypeScript quantifier with them:
    // `compose` is polymorphic in nothing and its face says so.
    expect(emitted).toContain("export declare const compose: (first:");
  });

  it("gives an impure extern row its face and a pure one none", () => {
    const emitted = declarationsOf(
      [["/world.js", ""], ["/main.hex", world]],
    );
    expect(emitted).toContain("/** Hexagon: `String ->! Unit` */\nexport declare function save(");
    // Purity is the silent one (§1): a face with nothing but pure arrows says
    // nothing the TypeScript type has not already said.
    expect(emitted).toContain("\nexport declare function trim(");
    expect(emitted).not.toContain("Hexagon: `String -> String`");
  });

  it("numbers the same way in a diagnostic", () => {
    // The checker's renderer is a third printer over a third representation of
    // the type, and an unnumbered face in a report would be the same ambiguity
    // in the one place a reader is already confused.
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${composeSource}
export let wrong: Int = compose
`]]),
    ).toEqual([
      "type mismatch: expected Int, found " +
      "((String) ->?¹ String, (String) ->?¹ String) ->?² (String) ->?¹ String",
    ]);
  });

  it("spells one colour plainly in a diagnostic, inlet or not (#405)", () => {
    const holder = `export let make(): String = "x"
export let hold(f: (() -> String) ->? Int): Int = f?(make)
`;
    expect(
      effectDiagnostics([["/main.hex", `${holder}
export let wrong: Int = hold
`]]),
    ).toEqual([
      "type mismatch: expected Int, found ((() -> String) ->? Int) ->? Int",
    ]);
    // The same colour, displayed as `f`'s own type — no inlet in view, and
    // still the plain spelling, because it is still one colour.
    expect(
      effectDiagnostics([["/main.hex", `export let make(): String = "x"
export let hold(f: (() -> String) ->? Int): Int =
    let n: String = f
    f?(make)
`]]),
    ).toEqual([
      "type mismatch: expected String, found (() -> String) ->? Int",
    ]);
  });

  it("refuses to write a variable colour back into source", () => {
    // The decorated spelling is display-only — `->?¹` is not grammar — and the
    // undecorated one would link this arrow into the signature's own colour,
    // which is a claim about the *other* arrows that this type alone cannot
    // know is true. So the repair says why rather than writing it.
    const source = "export fun pick(step: String ->? String) = step\n";
    const session = new AnalysisSession();
    session.setFile("/main.hex", source);
    const offset = source.indexOf("pick");
    const actions = session.codeActions("/main.hex", { start: offset, end: offset });
    expect(actions.map(({ title, disabled }) => `${title}: ${disabled ?? "offered"}`)).toEqual([
      "Infer return type: the return type of `pick` cannot be written here: " +
      "this function type's arrow is an effect variable, and writing `->?` here " +
      "would link it to the rest of the signature's colour",
    ]);
  });

  it("spells the impure constant, which means the same wherever it stands", () => {
    const source = `${world}
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
});

describe("#355 the pure demand", () => {
  /** The reverse direction's sentence (#364; Effects §4.3/§9). */
  const reverseDemand =
    "this position's arrow is the impure constant — its colour is fixed where " +
    "the type is declared, and this function's face is the pure `->`; the " +
    "demand cannot weaken — change the position's declared arrow, or supply " +
    "the effectful function the position promises";

  it("refuses an impure function where `->` is demanded", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let strict(step: String -> Unit, document: String): Unit = step(document)
export let go(document: String): Unit = strict(save, document)
`]]),
    ).toEqual([
      "a `->` arrow promises purity, and this function performs effects — the " +
      "demand is written `->`, the function's face `->?` or `->!`",
    ]);
  });

  it("refuses a pure function where a `->!` data field is demanded", () => {
    // The reverse direction, in the position §2.5 keeps constant on its own
    // account: a record declaration has no signature, so the field's arrow can
    // only be a constant and a pure function cannot weaken it. Under the §4.3
    // message every clause named a `->` this program does not contain.
    expect(
      effectDiagnostics([["/main.hex", `
export record Source = { step: () ->! String }
export let hold(step: () -> String): Source = Source({ step = step })
`]]),
    ).toEqual([reverseDemand]);
  });

  it("refuses a pure function at a written `->!` face", () => {
    // The other constant position, written: since #405 there is no rule that
    // re-reads an arrow as the constant, so a binding that means the constant
    // spells it (§2.3).
    expect(
      effectDiagnostics([["/main.hex", `
export let pureStep(): String = "x"
export let held: (() ->! String) = pureStep
`]]),
    ).toEqual([reverseDemand]);
  });

  it("keeps `Seq`'s producer pure by construction — branch (ii)", () => {
    expect(
      withSeq(`${world}
export let bad: Seq(String) = Seq.unfold("x", (seed) =>
    save!(seed)
    None)
`),
    ).toEqual([
      "a `->` arrow promises purity, and this function performs effects — the " +
      "demand is written `->`, the function's face `->?` or `->!`",
    ]);
  });
});
