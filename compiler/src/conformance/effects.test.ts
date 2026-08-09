/**
 * Conformance for the #355 effects prototype, behind `ProjectOptions.effects`.
 *
 * The acceptance test the issue names is the `Seq` migration — the five strict
 * consumers' signatures flipped to a linked `=>` and their bodies wearing one
 * `?` each — with `fold`'s body as the designated specimen: each of its calls
 * must demand exactly its one correct mark, and mutating a mark must be an
 * error naming the fixit, in all six directions.
 *
 * Everything else here is one scratch module per ruling. Nothing in `stdlib/`
 * is touched: the `Seq.hex` these tests compile is the fixture copy, which
 * `compileProject` seats as the prelude member because a project file with that
 * basename wins over the injected one.
 */

import { describe, expect, it } from "vitest";
import seqFixture from "./effects-fixtures/Seq.hex?raw";
import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";
import type { ProjectOptions } from "../project.js";

/** Diagnostics of a project compiled with the flag on. */
function effectDiagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files, { effects: true }).diagnostics.map(({ message }) => message);
}

/** The same, plus the fixture `Seq` seated as the prelude member. */
function withSeq(main: string): readonly string[] {
  return effectDiagnostics([["/Seq.hex", seqFixture], ["/main.hex", main]]);
}

/** Every fix replacement a project offered, so a test can pin the fixit text. */
function effectFixes(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files, { effects: true }).diagnostics.flatMap((diagnostic) =>
    (diagnostic.fixes ?? []).flatMap((fix) =>
      fix.edits.map((edit) => `${fix.message}: ${JSON.stringify(edit.replacement)}`)
    )
  );
}

/** The `.d.ts` one file of a project emits. */
function declarationsOf(
  files: readonly (readonly [string, string])[],
  options: ProjectOptions,
  path = "/main.hex",
): string {
  const compiled = compileFiles(files, options);
  return compiled.modules.find((module) => module.source.path === path)!.declarations.text;
}

/** What a hover where `needle` is written shows as the type there. */
function hoveredType(source: string, needle: string, options: ProjectOptions): string | undefined {
  const session = new AnalysisSession(options);
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

describe("#355 effects prototype — the flag itself", () => {
  it("compiles the whole prelude and runtime clean with the flag on", () => {
    expect(effectDiagnostics([["/main.hex", "export let x: Int = 1\n"]])).toEqual([]);
  });

  it("compiles the migrated Seq clean — the acceptance test", () => {
    expect(withSeq("export let x: Int = 1\n")).toEqual([]);
  });

  it("leaves `!` and `?` unlexable with the flag off", () => {
    const off = compileFiles([["/main.hex", "export let x: Int = readLine!()\n"]]);
    expect(off.diagnostics.map(({ message }) => message)).toContain(
      "Hexagon spells logical negation `not`",
    );
  });
});

describe("#355 fold's body — the designated specimen, six directions", () => {
  /** `fold`'s body with one mark mutated, as the fixture would carry it. */
  function foldWith(next: string, combine: string): readonly string[] {
    const foldBody = seqFixture.slice(seqFixture.indexOf("export let fold("));
    const mutatedBody = foldBody
      .replace("match next(current)", `match next${next}(current)`)
      .replace("combine?(accumulator, value)", `combine${combine}(accumulator, value)`);
    // Guard against a replacement that silently matched nothing: only the
    // no-mutation case may leave the body untouched.
    expect(mutatedBody === foldBody).toBe(next === "" && combine === "?");
    const mutated = seqFixture.slice(0, seqFixture.indexOf("export let fold(")) + mutatedBody;
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

  it("`!` -> `?`: a source claimed where there is only a conductor", () => {
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

  it("`?` -> bare: a conductor claimed where nothing conducts", () => {
    expect(foldWith("?", "?")).toEqual([
      "this call is pure, so `next` wants no mark, not `?`",
    ]);
  });

  it("`?` -> `!`: a conductor claimed where the colour is the impure constant", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let run(document: String): Unit = save?(document)
`]]),
    ).toEqual([
      "this call runs effects, so `save` wants `!`, not `?`",
    ]);
  });

  it("offers exactly one token as the fix, in each direction", () => {
    const mutated = seqFixture.replace("combine?(accumulator, value)", "combine!(accumulator, value)");
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

export let compose(first: String => String, second: String => String): (String => String) =
    (document) => second?(first?(document))
`;

  it("a call that only wires impurity through is bare", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${compose}
export let wired: (String =>! String) = compose(save2, audit2)
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

describe("#355 the else-constant rule", () => {
  it("makes a result-only `=>` the impure constant", () => {
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

  it("makes a data-position `=>` the impure constant, never linked", () => {
    // A record declaration has no signature to quantify over, so its arrow has
    // nothing to link to and the rule fires with nothing else in play — the one
    // place in this prototype where the else-constant rule is load-bearing on
    // its own, since a user extern is already impure by ruling 4.
    expect(
      effectDiagnostics([["/main.hex", `
export record Source = { step: () => String }
export let drive(source: Source): String = (source.step)!()
`]]),
    ).toEqual([]);
  });

  it("refuses the bare call through that field", () => {
    expect(
      effectDiagnostics([["/main.hex", `
export record Source = { step: () => String }
export let drive(source: Source): String = (source.step)()
`]]),
    ).toEqual([
      "this call runs effects, so this call wants `!`, not no mark",
    ]);
  });

  it("reads the same record shape as linked when it stands in a signature", () => {
    // Pinned because it is a *divergence*, not an obvious consequence: the
    // arrow is in a parameter annotation, so it is part of this signature and
    // links; the identical shape in a `record` declaration is data and takes
    // the constant. The ruling should say which reading it wants.
    expect(
      effectDiagnostics([["/main.hex", `
export let drive(source: { step: () => String }): String = (source.step)?()
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

describe("#355 ruling 9 — `=>!`, the const ⊔ var face", () => {
  const shape = (arrow: string) => `${world}
export let withTransaction: ((String => String) ${arrow} String) = (run: String => String): String =>
    save!("begin")
    let result = run?("body")
    audit!("commit")
    result
`;

  it("checks with the banged arrow", () => {
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", shape("=>!")]])).toEqual([]);
  });

  it("refuses the `=>` face, naming `=>!`", () => {
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", shape("=>")]])).toEqual([
      "this signature's `=>` promises a colour the caller chooses, but the body " +
      "solves it to the impure constant — a function that performs its own " +
      "unconditional effects rounds up, and its face is `=>!`",
    ]);
    expect(effectFixes([["/world.js", ""], ["/main.hex", shape("=>")]])).toEqual([
      'write `=>!`: "=>!"',
    ]);
  });

  it("refuses a `=>!` face over a body that performs no unconditional effect", () => {
    const source = `${world}
export let apply: ((String => String) =>! String) = (run: String => String): String => run?("body")
`;
    expect(effectDiagnostics([["/world.js", ""], ["/main.hex", source]])).toEqual([
      "this face is the impure constant `=>!`, but the body performs no " +
      "unconditional effect — it is effect-polymorphic, and its face is `=>`",
    ]);
    expect(effectFixes([["/world.js", ""], ["/main.hex", source]])).toEqual(['write `=>`: "=>"']);
  });

  it("demands `!` at every call site, pure callback or not", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${shape("=>!")}
export let go(): String = withTransaction((document) => document)
`]]),
    ).toEqual([
      "this call runs effects, so `withTransaction` wants `!`, not no mark",
    ]);
  });

  it("keeps a pure callback pure through the banged face", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${shape("=>!")}
export let go(): String = withTransaction!((document) => document)
`]]),
    ).toEqual([]);
  });
});

describe("#355 eager combinators — the shape Map/Set will imitate", () => {
  const eager = `${world}
export let map(values: Vector(a), transform: a => b): Vector(b) =
    var out: Vector(b) = []
    var index = 1
    while index <= Vector.length(values)
        out := Vector.append(out, transform?(Vector.at(values, index)))
        index := index + 1
    out

export let fold(values: Vector(a), initial: b, combine: (b, a) => b): b =
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
export let pull(source: { step: (() =>! String) }): String = (source.step)!()
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
export let held: (String =>! Unit) = save!
`]]),
    ).toEqual([markSeat]);
  });

  it("stores an impure function without a mark", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let held: (String =>! Unit) = save
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
      "demand is written `->`, the function's face `=>` or `=>!`",
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
let store(callback: () => String): Int = 1
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
export let asImpure: ((() -> String) =>! Int) = stored
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
export let asImpure: ((() =>! String) -> Int) = stored
`]]),
    ).toEqual([
      "this position's arrow is the impure constant — its colour is fixed where " +
      "the type is declared, and this function's face is the pure `->`; the " +
      "demand cannot weaken — change the position's declared arrow, or supply " +
      "the effectful function the position promises",
    ]);
  });
});

describe("#355 ruling 8 — the return-annotation slot", () => {
  it("gives an unparenthesized `=>` to the body", () => {
    // The annotation is the *result* type and the body starts at the arrow, so
    // this promises `Int` and produces a lambda.
    expect(
      effectDiagnostics([["/main.hex", `
export let curried(seed: Int): Int =
    let make = (x: Int): Int => (y: Int) => x
    make(seed)(seed)
`]]),
    ).not.toEqual([]);
    // Parenthesized, the same tokens are the function return type they read as.
    expect(
      effectDiagnostics([["/main.hex", `
export let curried(seed: Int): Int =
    let make = (x: Int): (Int -> Int) => (y: Int) => x
    make(seed)(seed)
`]]),
    ).toEqual([]);
  });

  it("reads the parenthesized form as the impure function return type", () => {
    expect(
      effectDiagnostics([["/world.js", ""], ["/main.hex", `${world}
export let maker = (seed: String): (String =>! Unit) => save
export let run(document: String): Unit = maker("s")!(document)
`]]),
    ).toEqual([]);
  });

  it("names the parenthesization when the writer plainly meant a type", () => {
    const source = `export let f = (x: Int): Int => Int => x\n`;
    // The whole list, not `toContain` (#364; Effects §9's return-annotation row): the report has to
    // *lead*, and it used to fire third — behind a type mismatch against the
    // annotation it was telling the reader to rewrite, and an unknown
    // constructor `Int` from reading the intended type as a pattern. Both
    // describe a tree the writer did not write.
    expect(effectDiagnostics([["/main.hex", source]])).toEqual([
      "a lambda's return annotation gives an unparenthesized `=>` to the body, so " +
      "this reads as the body starting here; an impure function type in a return " +
      "annotation must be parenthesized",
    ]);
    expect(effectFixes([["/main.hex", source]])).toEqual([
      'parenthesize the return type: "("',
      'parenthesize the return type: ")"',
    ]);
  });

  it("supersedes only the lambda it reports on", () => {
    // The cut is a region, so it must not reach past the lambda: a sibling
    // binding's own error is nobody's consequence.
    expect(
      effectDiagnostics([["/main.hex", `export let f = (x: Int): Int => Int => x
export let g: Int = "text"
`]]),
    ).toEqual([
      "a lambda's return annotation gives an unparenthesized `=>` to the body, so " +
      "this reads as the body starting here; an impure function type in a return " +
      "annotation must be parenthesized",
      "type mismatch: expected Int, found String",
    ]);
  });
});

/**
 * §10's first obligation, as ruled in #364: display **distinguishes** rather
 * than normalizes. A face renders its arrows by colour, and the undecorated
 * `=>` is reserved for the faces whose write-back preserves meaning — exactly
 * one effect variable, with at least one inlet occurrence, so that §2.2's
 * linked reading reproduces the displayed scheme. Every other face carrying
 * variables is numbered by first appearance, the inlet-less lone variable
 * included, because its undecorated spelling would come back as the impure
 * constant.
 */
describe("#364 the arrow trio, displayed", () => {
  const composeSource = `${world}
export let save2(document: String): String =
    save!(document)
    document

export let compose(first: String => String, second: String => String): (String => String) =
    (document) => second?(first?(document))

export let withTransaction: ((String => String) =>! String) = (run: String => String): String =>
    save!("begin")
    run?("body")

export let clean(document: String): String = trim(document)
`;

  it("numbers the headline probe's distinct colours", () => {
    // §10's own specimen. `compose`'s parameters share one variable and its own
    // colour is a second, unconstrained one (§3.4's third arm) — so the face is
    // *not* the one the written `(String => String, String => String) => …`
    // would mean, and the numbers are what say so.
    expect(hoveredType(composeSource, "compose", { effects: true })).toBe(
      "(String =>¹ String, String =>¹ String) =>² String =>¹ String",
    );
  });

  it("leaves a single-variable face undecorated, so it writes back unchanged", () => {
    // One variable, one spelling: the annotation grammar links every written
    // `=>` into one variable (§2.2), so this face round-trips exactly.
    expect(hoveredType(composeSource, "withTransaction", { effects: true })).toBe(
      "(String => String) =>! String",
    );
  });

  it("displays a linked conductor's whole signature with the plain arrow", () => {
    // `fold`'s shape is the designated specimen: the body conducts, so its own
    // colour *unifies with* the callback's (§3.4) rather than standing apart,
    // and one variable covers the whole face — which is why nothing is
    // numbered and the face is exactly what a writer would write.
    const source = `export let fold(values: Vector(a), initial: b, combine: (b, a) => b): b =
    var total = initial
    var index = 1
    while index <= Vector.length(values)
        total := combine?(total, Vector.at(values, index))
        index := index + 1
    total
`;
    expect(hoveredType(source, "fold", { effects: true })).toBe(
      "(Vector(a), b, (b, a) => b) => b",
    );
  });

  it("numbers a lone colour that offers no inlet, which is the ruling's cut", () => {
    // The undecorated `=>` is reserved for faces that write back *unchanged*,
    // and one variable is not enough for that: §2.2's else-constant rule reads
    // a sole `=>` with no parameter-position occurrence as the impure constant.
    // So `(() -> String) => Int` would come back a different type, and the
    // index is what stops it being offered as the same one.
    const source = `export let make(): String = "x"
export let hold(f: (() -> String) => Int): Int = f?(make)
`;
    expect(hoveredType(source, "f:", { effects: true })).toBe("(() -> String) =>¹ Int");
    // The very same variable, displayed as `hold`'s own face, is plain: there
    // it *has* an inlet — the arrow inside the parameter `f` — so the linked
    // reading of the written text reproduces this scheme exactly.
    expect(hoveredType(source, "hold", { effects: true })).toBe(
      "((() -> String) => Int) => Int",
    );
  });

  it("numbers a callback parameter hovered on its own", () => {
    // The everyday shape of the same cut: `first`'s colour is the enclosing
    // signature's, but nothing in `String => String` is a slot, so as a face in
    // its own right it does not write back.
    expect(hoveredType(composeSource, "first:", { effects: true })).toBe("String =>¹ String");
  });

  it("never numbers a constant, at either end of the trio", () => {
    expect(hoveredType(composeSource, "save", { effects: true })).toBe("String =>! Unit");
    expect(hoveredType(composeSource, "trim", { effects: true })).toBe("String -> String");
    expect(hoveredType(composeSource, "clean", { effects: true })).toBe("String -> String");
  });

  it("keeps a colour from taking a type variable's letter", () => {
    // Effect variables generalize with the binding (§3.4), so they arrive in the
    // scheme's quantifier list beside the ordinary ones. Naming them would have
    // spent `a` on a colour that displays as an arrow, and the type variable
    // that follows would print as `b` with no `a` anywhere in the face.
    const source = `${world}
export let hold(step: () => Int, value: a): a = value
`;
    expect(hoveredType(source, "hold", { effects: true })).toBe(
      "(() =>¹ Int, a) =>² a",
    );
  });

  it("says the same thing in the emitted `.d.ts`, where TypeScript cannot", () => {
    // TypeScript has one function arrow, so the trio has no seat in the face
    // itself; `spec/doc-comments.md` §7.3 provides the one channel that is left,
    // and the author's own documentation shares the block.
    const emitted = declarationsOf(
      [["/world.js", ""], ["/main.hex", `${world}
(** Runs both, in order. *)
export let compose(first: String => String, second: String => String): (String => String) =
    (document) => second?(first?(document))
`]],
      { effects: true },
    );
    expect(emitted).toContain(
      " * Hexagon: `(String =>¹ String, String =>¹ String) =>² String =>¹ String`",
    );
    expect(emitted).toContain(" * Runs both, in order.");
    // The colours erase (§8), so they take no TypeScript quantifier with them:
    // `compose` is polymorphic in nothing and its face says so.
    expect(emitted).toContain("export declare const compose: (first:");
  });

  it("gives an impure extern row its face and a pure one none", () => {
    const emitted = declarationsOf(
      [["/world.js", ""], ["/main.hex", world]],
      { effects: true },
    );
    expect(emitted).toContain("/** Hexagon: `String =>! Unit` */\nexport declare function save(");
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
      "((String) =>¹ String, (String) =>¹ String) =>² (String) =>¹ String",
    ]);
  });

  it("applies the inlet cut in a diagnostic too, in both directions", () => {
    const holder = `export let make(): String = "x"
export let hold(f: (() -> String) => Int): Int = f?(make)
`;
    // The face has one colour and an inlet — the arrow inside `f` — so it is
    // plain, and a reader can copy it into an annotation.
    expect(
      effectDiagnostics([["/main.hex", `${holder}
export let wrong: Int = hold
`]]),
    ).toEqual([
      "type mismatch: expected Int, found ((() -> String) => Int) => Int",
    ]);
    // The same colour, displayed as `f`'s own type, has no inlet left in view.
    expect(
      effectDiagnostics([["/main.hex", `export let make(): String = "x"
export let hold(f: (() -> String) => Int): Int =
    let n: String = f
    f?(make)
`]]),
    ).toEqual([
      "type mismatch: expected String, found (() -> String) =>¹ Int",
    ]);
  });

  it("refuses to write a variable colour back into source", () => {
    // The decorated spelling is display-only — `=>¹` is not grammar — and the
    // undecorated one would link this arrow into the signature's own colour,
    // which is a claim about the *other* arrows that this type alone cannot
    // know is true. So the repair says why rather than writing it.
    const source = "export fun pick(step: String => String) = step\n";
    const session = new AnalysisSession({ effects: true });
    session.setFile("/main.hex", source);
    const offset = source.indexOf("pick");
    const actions = session.codeActions("/main.hex", { start: offset, end: offset });
    expect(actions.map(({ title, disabled }) => `${title}: ${disabled ?? "offered"}`)).toEqual([
      "Infer return type: the return type of `pick` cannot be written here: " +
      "this function type's arrow is an effect variable, and writing `=>` here " +
      "would link it to the rest of the signature's colour",
    ]);
  });

  it("spells the impure constant, which means the same wherever it stands", () => {
    const source = `${world}
export fun maker(seed: String) = save
`;
    const session = new AnalysisSession({ effects: true });
    session.setFile("/world.js", "");
    session.setFile("/main.hex", source);
    const offset = source.indexOf("maker");
    const [action] = session.codeActions("/main.hex", { start: offset, end: offset });
    const edit = action!.edits[0]!;
    // Parenthesized: a return annotation is written immediately before the
    // token introducing the body, and for a lambda that token is `=>` — so a
    // bare `=>!` there would read as the body starting at the arrow (§2.6).
    expect(edit.replacement).toBe(": (String =>! Unit)");
    session.setFile(
      "/main.hex",
      source.slice(0, edit.span.start.offset) + edit.replacement +
        source.slice(edit.span.end.offset),
    );
    expect(session.diagnostics("/main.hex")).toEqual([]);
  });

  it("is byte-identical with the flag off, on a corpus both can read", () => {
    // The pure corpus is where the two compilations meet, and it is the whole
    // of what flag-off byte-identity can be asked about: `=>`, `!` and `?` do
    // not lex with the flag off at all.
    const pure = `export let twice(step: Int -> Int, value: Int): Int = step(step(value))
export let pair(value: a): (a, a) = (value, value)
`;
    const files = [["/main.hex", pure]] as const;
    expect(declarationsOf(files, { effects: true })).toBe(declarationsOf(files, {}));
    expect(hoveredType(pure, "twice", { effects: true })).toBe(
      hoveredType(pure, "twice", {}),
    );
    expect(hoveredType(pure, "twice", {})).toBe("(Int -> Int, Int) -> Int");
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
      "demand is written `->`, the function's face `=>` or `=>!`",
    ]);
  });

  it("refuses a pure function where a `=>` data field is demanded", () => {
    // The reverse direction, in the position §2.5 makes the constant on its own
    // account: a record declaration has no signature, so the field's arrow is
    // the impure constant and a pure function cannot weaken it. Under the §4.3
    // message every clause named a `->` this program does not contain.
    expect(
      effectDiagnostics([["/main.hex", `
export record Source = { step: () => String }
export let hold(step: () -> String): Source = Source({ step = step })
`]]),
    ).toEqual([reverseDemand]);
  });

  it("refuses a pure function at a result-only face", () => {
    // §2.2's else-constant rule supplies the other constant position: the
    // annotation's only `=>` stands in result position, so it is the constant.
    expect(
      effectDiagnostics([["/main.hex", `
export let pureStep(): String = "x"
export let held: (() =>! String) = pureStep
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
      "demand is written `->`, the function's face `=>` or `=>!`",
    ]);
  });
});
