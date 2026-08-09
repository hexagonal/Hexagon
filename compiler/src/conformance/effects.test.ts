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
import { compileFiles } from "../support/test-project.js";

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
    // The whole list, not `toContain` (#364, §10's ledger): the report has to
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

describe("#355 the pure demand", () => {
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
