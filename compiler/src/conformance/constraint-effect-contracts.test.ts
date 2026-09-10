/**
 * Conformance for **effect contracts at the constraint seat** (`spec/effects.md`
 * §13; `spec/constraints.md` §2, §4.1, §4.7, §8), and for the defect the seat
 * closes: #865, an `honor` body performing effects behind a member's pure face,
 * accepted with no diagnostic since #355.
 *
 * The doctrine in one sentence: **an instance accepts everything its contract
 * promises to accept, and performs no more effects than its contract permits.**
 * A member header writes its outer arrow because it is a contract with no body
 * to infer from; the body under it is inferred as any body is and then
 * *compared*, at the sign of each arrow. This is the one seat in the language
 * where colours are ordered rather than unified (§1).
 *
 * The file is organised by the spec's own sections, and every message here is
 * quoted from Effects §9's three contract rows or Constraints §8's — a
 * paraphrase in a test is a paraphrase in the compiler within one edit.
 */

import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";
import { compileFiles } from "../support/test-project.js";

/** A one-module project's diagnostics, `module Main` prepended. */
function messages(source: string): readonly string[] {
  return compileFiles([
    ["/main.hex", "module Main\n\n" + source],
    ["/io.js", ""],
  ]).diagnostics.map(({ message }) => message);
}

/** The same, over a whole project. */
function projectMessages(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/**
 * What each diagnostic's primary span covers, as source text. Placement is a
 * claim §13.2 makes explicitly — "at the offending call", "at the demand that
 * narrowed it" — so the spans are pinned, not only the sentences.
 */
function primaries(source: string): readonly string[] {
  const text = "module Main\n\n" + source;
  return compileFiles([["/main.hex", text], ["/io.js", ""]]).diagnostics.map(
    ({ primary }) => text.slice(primary.start.offset, primary.end.offset),
  );
}

/**
 * Each diagnostic's related locations, as `message: source text`. §13.2 makes
 * the contract's failing arrow, and the merge that joined a handed slot in,
 * related locations on every conflict report, so they are pinned too.
 */
function labels(source: string): readonly (readonly string[])[] {
  const text = "module Main\n\n" + source;
  return compileFiles([["/main.hex", text], ["/io.js", ""]]).diagnostics.map(
    ({ labels: related }) =>
      (related ?? []).map(({ message, span }) =>
        `${message}: ${JSON.stringify(text.slice(span.start.offset, span.end.offset))}`
      ),
  );
}

/** Every fixit a one-module project offered, as `message: replacement`. */
function fixes(source: string): readonly string[] {
  return compileFiles([["/main.hex", "module Main\n\n" + source]]).diagnostics
    .flatMap((diagnostic) =>
      (diagnostic.fixes ?? []).flatMap((fix) =>
        fix.edits.map((edit) => `${fix.message}: ${JSON.stringify(edit.replacement)}`)
      )
    );
}

/** What a hover at the first occurrence of `needle` shows as the type there. */
function hoveredType(source: string, needle: string): string | undefined {
  const session = new AnalysisSession();
  session.setFile("/io.js", "");
  session.setFile("/main.hex", source);
  return session.hover("/main.hex", source.indexOf(needle))?.displayedType;
}

/** The world's door, so a body has a genuine effect to perform. */
const IO = 'extern from "./io.js"\n    export fun readIt(path: String): String\n\n';

/** Effects §9's pure-contract row, base form, verbatim, for the member it names. */
const pureContract = (member: string): string =>
  `this call performs effects, and \`${member}\`'s contract is the pure arrow ` +
  "`->` — an instance performs no more than its contract permits — keep this " +
  "body pure, or, if the constraint is yours, write `->!` on the member";

/**
 * Effects §9's pure-contract row in its **conflict form**: the effect is one
 * the contract handed the body, so the clause names the callback and the advice
 * says what not to call.
 */
const pureConflict = (member: string, handed: string): string =>
  `this call performs effects the contract hands the body, and \`${member}\`'s ` +
  "contract is the pure arrow `->` — an instance performs no more than its " +
  `contract permits, and \`${handed}\` may perform effects whatever the caller ` +
  `supplies — do not call \`${handed}\` here, or, if the constraint is yours, ` +
  "write `->!` on the member";

/** The same row with the **merge** as its primary (§13.2; James, 2026-09-10). */
const pureMergeConflict = (member: string, handed: string, returns = false): string =>
  "this expression merges in a function that may perform effects the contract " +
  `hands it, and \`${member}\`'s contract ` +
  (returns ? "returns a `->` function" : "is the pure arrow `->`") +
  " — an instance performs no more than its contract permits, and " +
  `\`${handed}\` may perform effects whatever the caller supplies — do not merge ` +
  `\`${handed}\` into that arrow, or, if the constraint is yours, write \`->!\` on ` +
  (returns ? "the arrow the contract returns" : "the member");

/** The same row with the **seat** as its primary — a body that merely forwards. */
const pureSeatConflict = (member: string, handed: string, returns = false): string =>
  `this instance ${returns ? "returns" : "supplies"} a function that may perform ` +
  `effects the contract hands it, and \`${member}\`'s contract ` +
  (returns ? "returns a `->` function" : "is the pure arrow `->`") +
  " — an instance performs no more than its contract permits, and " +
  `\`${handed}\` may perform effects whatever the caller supplies — do not ` +
  `supply \`${handed}\` here, or, if the constraint is yours, write \`->!\` on ` +
  (returns ? "the arrow the contract returns" : "the member");

/**
 * The **invariant** counterpart of the conflict form's seat primary (§9's
 * invariant clause; §13.2 asks for "the invariant counterpart of each"). The
 * failing arrow is the one written *inside the parameter*, so the member's
 * outer arrow changes nothing about the sentence — an invariant position admits
 * no widening at either.
 */
const invariantSeatConflict = (
  member: string,
  handed: string,
  parameter: string,
  arrow: string,
): string =>
  "this instance supplies a function that may perform effects the contract " +
  `hands it, and \`${member}\`'s contract writes \`${arrow}\` inside the ` +
  `parameter \`${parameter}\` — an invariant position admits no widening, and ` +
  `\`${handed}\` may perform effects whatever the caller supplies — do not ` +
  `supply \`${handed}\` there, or, if the constraint is yours, write \`->!\` on ` +
  `that arrow inside the parameter \`${parameter}\``;

/** The same, where the body's own **merge** is what carried the callback in. */
const invariantMergeConflict = (
  member: string,
  handed: string,
  parameter: string,
  arrow: string,
): string =>
  "this expression merges in a function that may perform effects the contract " +
  `hands it, and \`${member}\`'s contract writes \`${arrow}\` inside the ` +
  `parameter \`${parameter}\` — an invariant position admits no widening, and ` +
  `\`${handed}\` may perform effects whatever the caller supplies — do not ` +
  `merge \`${handed}\` into that arrow, or, if the constraint is yours, write ` +
  `\`->!\` on that arrow inside the parameter \`${parameter}\``;

/** Effects §9's linked-contract row, base form, verbatim. */
const linkedContract = (member: string): string =>
  `this call performs effects unconditionally, and \`${member}\`'s contract is ` +
  "linked `->?` — an instance must be pure whenever what it is handed is pure, " +
  "so its effects may come only from what it is handed — move this effect " +
  "behind the callback, or, if the constraint is yours, write `->!` on the member";

/** Effects §9's linked-contract row in its **conflict form**, verbatim. */
const linkedConflict = (member: string, handed: string): string =>
  `this call performs effects the contract hands the body, and \`${member}\`'s ` +
  "contract is linked `->?` — a linked `->?` is pure whenever the caller's " +
  `callbacks are pure, and \`${handed}\` may perform effects whatever the caller ` +
  `supplies — do not call \`${handed}\` here, or, if the constraint is yours, ` +
  "write `->!` on the member";

/**
 * Effects §9's **linked** narrower-acceptance row, verbatim, at a top-level
 * callback parameter. `inletGain` is the clause the advice takes on where
 * rewriting this parameter would leave the header inlet-less.
 */
const narrowerAcceptance = (
  member: string,
  parameter: string,
  inletGain = true,
): string =>
  `\`${member}\`'s contract accepts an \`${parameter}\` of either colour, and ` +
  "this instance accepts only a pure one — an instance accepts everything its " +
  "contract promises to accept — call the callback with `?` instead of handing " +
  "it, or a function that calls it, to a `->` demand, or, if the constraint is " +
  "yours, write the member's callback parameter `->`" +
  (inletGain ? " and the member's outer arrow `->` with it" : "");

/** Effects §9's **`->!`** narrower-acceptance row, verbatim. */
const impureNarrowerAcceptance = (member: string, parameter: string): string =>
  `\`${member}\`'s contract accepts an \`${parameter}\` that performs effects, ` +
  "and this instance accepts only a pure one — an instance accepts everything " +
  "its contract promises to accept — call the callback with `!` instead of " +
  "handing it, or a function that calls it, to a `->` demand, or, if the " +
  "constraint is yours, write the member's callback parameter `->`";

describe("Constraints §2, §8: the header writes its arrow, and `:` is a parse error", () => {
  test("`->`, `->!` and `->?` are all legal on a member header", () => {
    expect(messages(
      "constraint R<a> =\n" +
      "    plain(s: a) -> String\n" +
      "    loud(s: a) ->! String\n" +
      "    linked(s: a, action: () ->? Unit) ->? String\n",
    )).toEqual([]);
  });

  test("a `:` separator is refused with Constraints §8's sentence", () => {
    // The colon belongs to *implementation* headers — a `let`, a `fun` member,
    // an `honor` member, a `widens` door — which write `:` and infer. A member
    // has no body to infer from, so it writes the arrow the contract is about.
    expect(messages("constraint R<a> =\n    read(s: a): String\n")).toEqual([
      "a constraint member declares its effect — write `show(x: a) -> String` " +
      "(`->!` for a member whose instances may perform effects, `->?` for one " +
      "as effectful as a callback it is handed)",
    ]);
  });

  test("its fixit replaces exactly the colon with the arrow", () => {
    expect(fixes("constraint R<a> =\n    read(s: a): String\n"))
      .toEqual(['write `->`: "->"']);
    expect(primaries("constraint R<a> =\n    read(s: a): String\n")).toEqual([":"]);
  });

  test("the refusal does not swallow the header, so one typo is one report", () => {
    // Recovery parses the result type as it always did: the member is still a
    // member, and the honor block below it draws no missing-member cascade.
    expect(messages(
      "constraint R<a> =\n    read(s: a): String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n",
    )).toHaveLength(1);
  });

  test("implementation headers keep `:` — the two forms are not one", () => {
    // Functions §4.1's headers infer their colour and write `:`; only the
    // contract writes an arrow, and the two live side by side in one module.
    expect(messages(
      "constraint R<a> =\n    read(s: a) -> String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s: P) = s.name\n" +
      "fun helper(p: P): String = read(p)\n" +
      "export let top(p: P): String = helper(p)\n",
    )).toEqual([]);
  });
});

describe("#865: an `honor` body's effects are no longer laundered", () => {
  /** The reproduction exactly as filed, with the header taking its arrow. */
  const REPRO = IO +
    "constraint Readable<a> =\n" +
    "    read(source: a) -> String\n" +
    "\n" +
    "export record Path = { name: String }\n" +
    "\n" +
    "honor Readable<Path> =\n" +
    "    read(source) = readIt!(source.name)\n" +
    "\n" +
    "export let use(p: Path): String = read(p)\n";

  test("the body is refused, in §4.2's pure-face frame with the contract named", () => {
    expect(messages(REPRO)).toEqual([pureContract("read")]);
  });

  test("the report stands at the offending call", () => {
    // §13.2's placement, which is the whole of the report's usefulness: the
    // member span would name the seat, and the call is what the author edits.
    expect(primaries(REPRO)).toEqual(['readIt!(source.name)']);
  });

  test("a default body has the same seat and the same refusal", () => {
    const source = IO +
      "constraint Readable<a> =\n" +
      "    read(source: a) -> String\n" +
      "    readTwice(source: a) -> String = readIt!(\"x\")\n";
    expect(messages(source)).toEqual([pureContract("readTwice")]);
    expect(primaries(source)).toEqual(['readIt!("x")']);
  });

  test("with the contract written `->!`, the same body is accepted and `use` wears `!`", () => {
    const source = REPRO
      .replace("read(source: a) -> String", "read(source: a) ->! String")
      .replace("read(p)", "read!(p)");
    expect(messages(source)).toEqual([]);
    expect(hoveredType("module Main\n\n" + source, "use(p")).toBe("Path ->! String");
  });
});

describe("Effects §13.2: the constant table", () => {
  const table = (arrow: string, body: string): readonly string[] =>
    messages(IO +
      `constraint R<a> =\n    read(s: a) ${arrow} String\n` +
      "export record P = { name: String }\n" +
      `honor R<P> =\n    read(s) = ${body}\n`);

  test("a pure body under a `->` contract is accepted", () => {
    expect(table("->", "s.name")).toEqual([]);
  });

  test("a pure body under a `->!` contract is accepted", () => {
    // The lower-right cell is what the ordering buys: a `->!` member honored at
    // an in-memory type by a body that reads nothing.
    expect(table("->!", "s.name")).toEqual([]);
  });

  test("an impure body under a `->` contract is refused", () => {
    expect(table("->", 'readIt!(s.name)')).toEqual([pureContract("read")]);
  });

  test("an impure body under a `->!` contract is accepted", () => {
    expect(table("->!", 'readIt!(s.name)')).toEqual([]);
  });

  test("a pure body under `->!` still makes every call wear `!`", () => {
    // §13.3's price, stated as a pin: knowing the implementation grants no
    // purer callable face.
    expect(messages(
      "constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n" +
      "export let dot(p: P): String = p.read!()\n",
    )).toEqual([]);
    expect(messages(
      "constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n" +
      "export let dot(p: P): String = p.read()\n",
    )).toEqual(["this call runs effects, so `.read` wants `!`, not no mark"]);
  });
});

describe("Effects §13.4: one effect variable per member", () => {
  const RUNNER =
    "constraint Runner<r> =\n" +
    "    run(runner: r, action: () ->? Unit) ->? Unit\n" +
    "export record Job = { id: Int }\n";

  test("`action?()` is ordinary conduct, and the seat accepts it", () => {
    expect(messages(RUNNER + "honor Runner<Job> =\n    run(job, action) = action?()\n"))
      .toEqual([]);
  });

  test("ignoring the callback satisfies the contract too", () => {
    // Behavioural laws are the constraint author's business, not the checker's.
    expect(messages(RUNNER + "honor Runner<Job> =\n    run(job, action) = ()\n"))
      .toEqual([]);
  });

  test("a body's own unconditional effect fails the pure instantiation", () => {
    const source = IO + RUNNER +
      "honor Runner<Job> =\n    run(job, action) = Debug.log(readIt!(\"x\"))\n";
    expect(messages(source)).toEqual([linkedContract("run")]);
    expect(primaries(source)).toEqual(['readIt!("x")']);
  });

  test("a body that accepts only pure callbacks fails the supplied direction", () => {
    // The narrowing is an ordinary unification inside the body — the callback's
    // fresh colour pinned pure by a `->` demand — and it is the *seat* that
    // refuses it, at the demand that did the pinning.
    const source = RUNNER +
      "let force(f: () -> Unit): Unit = f()\n" +
      "honor Runner<Job> =\n    run(job, action) = force(action)\n";
    expect(messages(source)).toEqual([narrowerAcceptance("run", "action")]);
    expect(primaries(source)).toEqual(["force(action)"]);
  });

  test("an outer-only `->?` header is §4.4's inlet-less refusal", () => {
    // A member header is a signature (§13.4), so the inlet rule applies to it
    // unchanged: nothing a caller supplies carries the colour.
    expect(messages("constraint R<a> =\n    read(s: a) ->? String\n")).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose " +
      "it — nothing a caller of this signature supplies carries `->?`, so " +
      "nothing instantiates it; write `->!` for a function that pulls the " +
      "world, or `->` for one that does not",
    ]);
    expect(primaries("constraint R<a> =\n    read(s: a) ->? String\n")).toEqual(["->?"]);
  });

  test("the join is the contract for a member that wants both", () => {
    // §2.4's `withTransaction` shape as a contract: a linked callback and a
    // licence for the instance's own effects, whose calls always wear `!`.
    expect(messages(IO +
      "constraint Tx<t> =\n" +
      "    within(t: t, action: () ->? Unit) ->! Unit\n" +
      "export record Db = { name: String }\n" +
      "honor Tx<Db> =\n" +
      "    within(db, action) =\n" +
      "        Debug.log(readIt!(db.name))\n" +
      "        action?()\n",
    )).toEqual([]);
  });
});

describe("Effects §13.2: a body colour still a variable collects its bounds", () => {
  const RUNNER = (arrow: string) =>
    "constraint Runner<r> =\n" +
    `    run(runner: r, action: () ->! Unit) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n";

  test("ignoring the callback leaves the colour unconstrained, and the seat passes", () => {
    expect(messages(RUNNER("->") + "honor Runner<Job> =\n    run(job, action) = ()\n"))
      .toEqual([]);
  });

  test("conducting it bounds the colour above pure and below impure at once", () => {
    // The invoked arrow is the one that failed, so the covariant bound reports —
    // and the mark that reads the condemned colour owes no second report.
    expect(messages(RUNNER("->") + "honor Runner<Job> =\n    run(job, action) = action!()\n"))
      .toEqual([pureConflict("run", "action")]);
  });

  test("and under a `->!` contract the same body is accepted", () => {
    expect(messages(RUNNER("->!") + "honor Runner<Job> =\n    run(job, action) = action!()\n"))
      .toEqual([]);
  });
});

describe("Effects §13.2: the sign is the variance product", () => {
  test("a returned `->` function that performs effects takes the adapted frame", () => {
    // The result position keeps the sign, so the arrow is invoked and the frame
    // names it: §13.2's own worked sentence.
    expect(messages(IO +
      "constraint Maker<a> =\n    make(seed: a) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed) = () => Debug.log(readIt!(\"x\"))\n",
    )).toEqual([
      "the function this instance returns performs effects, and `make`'s " +
      "contract returns a `->` function — an instance performs no more than its " +
      "contract permits — keep this body pure, or, if the constraint is yours, " +
      "write `->!` on the arrow the contract returns",
    ]);
  });

  test("a supplied function's arrows are contravariant at every step", () => {
    // `build: (Int) -> (() -> Unit)` is reached through a parameter, so both of
    // its arrows are supplied — one sign per arrow, read once — and a body that
    // merely applies it is accepted.
    expect(messages(
      "constraint Maker<a> =\n" +
      "    make(seed: a, build: (Int) -> (() -> Unit)) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, build) = build(seed.n)\n",
    )).toEqual([]);
  });
});

describe("Effects §13.3: every spelling wears the contract's mark", () => {
  const LIB = "module Lib\n\n" +
    "export constraint R<a> =\n    read(s: a) ->! String\n" +
    "export record Note = { name: String }\n" +
    "honor R<Note> =\n    read(s) = s.name\n";

  test("bare, qualified, dot and bounded-generic spellings all wear `!`", () => {
    expect(projectMessages([
      ["/lib.hex", LIB],
      ["/main.hex", "module Main\n\nimport Lib\n\n" +
        "export let qualified(n: Lib.Note): String = Lib.read!(n)\n" +
        "export let dotted(n: Lib.Note): String = n.read!()\n" +
        "export let generic<a: Lib.R>(x: a): String = x.read!()\n"],
    ])).toEqual([]);
  });

  test("and none of them may be written bare", () => {
    expect(projectMessages([
      ["/lib.hex", LIB],
      ["/main.hex", "module Main\n\nimport Lib\n\n" +
        "export let qualified(n: Lib.Note): String = Lib.read(n)\n"],
    ])).toEqual(["this call runs effects, so `Lib.read` wants `!`, not no mark"]);
  });

  test("a call at a known concrete instance wears it, through the companion", () => {
    // Method Syntax §4: the companion is the module addressable under the type's
    // name, and knowing which instance answers grants no purer face.
    const files = (mark: string) => [
      ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    read(s: a) ->! String\n"],
      ["/note.hex", "module Note\n\nimport Lib\n\n" +
        "export record Note = { name: String }\n" +
        "honor Lib.R<Note> =\n    read(s) = s.name\n"],
      ["/main.hex", "module Main\n\nimport Note\n\n" +
        `export let at(n: Note.Note): String = Note.read${mark}(n)\n`],
    ] as const;
    expect(projectMessages(files("!"))).toEqual([]);
    expect(projectMessages(files("")))
      .toEqual(["this call runs effects, so `Note.read` wants `!`, not no mark"]);
  });

  test("a bare call in the honoring module wears it too", () => {
    expect(messages(
      "constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n" +
      "export let bare(p: P): String = read!(p)\n",
    )).toEqual([]);
  });
});

describe("Constraints §4.7: the `widens` door is compared, and shows the contract", () => {
  const LIB = (arrow: string) => "module Lib\n\n" +
    `export constraint R<a> =\n    tag(s: a, n: Int) ${arrow} String\n`;

  /** A door widening the second seat, `Int` reaching `BigInt` by §5.1. */
  const door = (body: string, call: string) => "module Main\n\nimport Lib\n\n" +
    IO +
    "export record P = { name: String }\n" +
    `widens Lib.tag(s: P, n: BigInt): String = ${body}\n` +
    "honor Lib.R<P> =\n    tag = widened\n" +
    `export let through(p: P): String = ${call}\n`;

  test("a pure door body under a `->!` member is accepted, and its calls wear `!`", () => {
    expect(projectMessages([
      ["/lib.hex", LIB("->!")],
      ["/main.hex", door("s.name", "tag!(p, 2n)")],
      ["/io.js", ""],
    ])).toEqual([]);
  });

  test("the door's binding shows the member's contract colour, never the body's", () => {
    // One operation, two widths, one colour — and the colour is the member's.
    const main = door("s.name", "tag!(p, 2n)");
    const session = new AnalysisSession();
    session.setFile("/io.js", "");
    session.setFile("/lib.hex", LIB("->!"));
    session.setFile("/main.hex", main);
    expect(session.hover("/main.hex", main.indexOf("tag(s: P"))?.displayedType)
      .toBe("(P, BigInt) ->! String");
  });

  test("so a bare call to the pure-bodied door is refused", () => {
    expect(projectMessages([
      ["/lib.hex", LIB("->!")],
      ["/main.hex", door("s.name", "tag(p, 2n)")],
      ["/io.js", ""],
    ])).toEqual(["this call runs effects, so `tag` wants `!`, not no mark"]);
  });

  test("an impure door body under a `->` member is refused at the seat", () => {
    expect(projectMessages([
      ["/lib.hex", LIB("->")],
      ["/main.hex", door('readIt!("x")', "tag(p, 2n)")],
      ["/io.js", ""],
    ])).toEqual([pureContract("tag")]);
  });
});

describe("Constraints §2: a default calls its siblings at their contracts' marks", () => {
  test("a default under `->` cannot call a `->!` sibling", () => {
    const source =
      "constraint R<a> =\n" +
      "    read(s: a) ->! String\n" +
      "    twice(s: a) -> String = read!(s) ++ read!(s)\n";
    expect(messages(source)).toEqual([pureContract("twice")]);
    expect(primaries(source)).toEqual(["read!(s)"]);
  });

  test("a default under `->!` may call anything", () => {
    expect(messages(
      "constraint R<a> =\n" +
      "    read(s: a) ->! String\n" +
      "    twice(s: a) ->! String = read!(s) ++ read!(s)\n",
    )).toEqual([]);
  });

  test("a default under `->?` may conduct a `->?` sibling", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, action: () ->? Unit) ->? Unit\n" +
      "    twice(runner: r, action: () ->? Unit) ->? Unit = run?(runner, action)\n",
    )).toEqual([]);
  });

  test("but not call a `->!` one", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    boom(runner: r) ->! Unit\n" +
      "    run(runner: r, action: () ->? Unit) ->? Unit = boom!(runner)\n",
    )).toEqual([linkedContract("run")]);
  });

  test("a default under `->` calling a `->` sibling is silent", () => {
    expect(messages(
      "constraint R<a> =\n" +
      "    read(s: a) -> String\n" +
      "    twice(s: a) -> String = read(s) ++ read(s)\n",
    )).toEqual([]);
  });
});

describe("Effects §13.5: the unmarkable forms rest on the prelude's headers", () => {
  /**
   * Every constraint member header the standard library writes, as
   * `Module.member -> arrow`. The scan is deliberately textual: §13.5's
   * constraint is on what the *sources say*, and a scheme read back through the
   * checker would pass even if a header were respelled through some recovery.
   */
  function preludeMemberArrows(): readonly string[] {
    const found: string[] = [];
    for (const [module, source] of Object.entries(STDLIB_SOURCES)) {
      let indent: number | undefined;
      for (const line of source.split("\n")) {
        if (/^(?:export\s+)?constraint\s/.test(line)) {
          indent = 0;
          continue;
        }
        if (indent === undefined) continue;
        if (line.trim() === "") continue;
        if (!/^\s/.test(line)) {
          indent = undefined;
          continue;
        }
        const member = /^\s+([a-z][A-Za-z0-9_]*)\(.*\)\s*(->[!?]?)\s/.exec(line);
        if (member !== null) found.push(`${module}.${member[1]} ${member[2]}`);
      }
    }
    return found;
  }

  test("every prelude member's outer arrow is `->`", () => {
    // A compile-breaking standard-library constraint, of the kind the prelude
    // seat order already is: a prelude header written `->!` would put an
    // unmarkable call — an operator, a bracket, a `for` head, an interpolation
    // — on an effectful member.
    const arrows = preludeMemberArrows();
    expect(arrows.length).toBeGreaterThanOrEqual(20);
    expect(arrows.filter((entry) => !entry.endsWith(" ->"))).toEqual([]);
  });

  test("and no arrow beneath one carries a colour either", () => {
    // Standard-library policy, one step stronger than §13.5's requirement: no
    // prelude member is effect-polymorphic.
    const coloured: string[] = [];
    for (const [module, source] of Object.entries(STDLIB_SOURCES)) {
      let inside = false;
      for (const line of source.split("\n")) {
        if (/^(?:export\s+)?constraint\s/.test(line)) {
          inside = true;
          continue;
        }
        if (inside && line.trim() !== "" && !/^\s/.test(line)) inside = false;
        if (!inside) continue;
        if (/->[!?]/.test(line)) coloured.push(`${module}: ${line.trim()}`);
      }
    }
    expect(coloured).toEqual([]);
  });

  test("`Iterable` therefore admits no effectful instance", () => {
    expect(messages(IO +
      "export record Bag = { items: Vector(Int) }\n" +
      "honor Iterable<Bag> =\n" +
      "    type Item = Int\n" +
      "    toSeq(b) = Debug.log(readIt!(\"x\")) |> (u => b.items.toSeq())\n",
    )).toEqual([pureContract("toSeq")]);
  });

  test("and an operator's member call stays unmarkable and pure", () => {
    expect(messages("export let sum(a: Int, b: Int): Int = a + b\n")).toEqual([]);
  });
});

describe("Effects §13.6: derived instances and display", () => {
  test("derived instances are pure by construction", () => {
    expect(messages(
      "export record P derives (Eq, Show, Ord, Hash) = { n: Int }\n" +
      "export let same(a: P, b: P): Bool = a.equals(b)\n" +
      'export let shown(a: P): String = "${a}"\n',
    )).toEqual([]);
  });

  test("a member's face displays its contract arrows at the declaration", () => {
    const source = "module Main\n\n" +
      "export constraint R<a> =\n    read(s: a) ->! String\n";
    expect(hoveredType(source, "read(s: a)")).toBe("<a: R> a ->! String");
  });

  test("and at every use, whatever the instance's body does", () => {
    const source = "module Main\n\n" +
      "export constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n" +
      "export let use(p: P): String = read!(p)\n";
    expect(hoveredType(source, "read!(p)")).toBe("<a: R> a ->! String");
    expect(hoveredType(source, "use(p")).toBe("P ->! String");
  });

  test("a coloured face's `.d.ts` carries its Hexagon signature", () => {
    // Effects §10's generated documentation line, which is what FFI Part 9 §2.2
    // points a coloured dictionary member at.
    const compiled = compileFiles([
      ["/main.hex", "module Main\n\n" +
        "export constraint R<a> =\n    read(s: a) ->! String\n" +
        "export record P = { name: String }\n" +
        "honor R<P> =\n    read(s) = s.name\n" +
        "export let use(p: P): String = read!(p)\n"],
    ]);
    expect(compiled.diagnostics).toEqual([]);
    const declarations = compiled.modules
      .find(({ source }) => source.path === "/main.hex")!.declarations.text;
    expect(declarations).toContain("/** Hexagon: `P ->! String` */");
  });

  test("no diagnostic displays a numbered inference variable (#649)", () => {
    // Over a message that **displays a type**: §9's contract rows name arrows
    // and parameters and never render one, so the predecessor pin could not
    // have failed however many variables a member owned. This mismatch renders
    // the member's whole face, which is where a second variable would show.
    const messagesWithTypes = messages(
      "constraint Tx<t> =\n" +
      "    within(t: t, action: () ->? Unit) ->! Unit\n" +
      "export record Db = { name: String }\n" +
      "honor Tx<Db> =\n    within(db, action) = action?()\n" +
      "let bad(d: Db): Int = within\n",
    );
    expect(messagesWithTypes).toContain(
      "type mismatch: expected Int, found (a, () ->? Unit) ->! Unit",
    );
    for (const message of messagesWithTypes) expect(message).not.toMatch(/\?\d/);
    for (const message of messages(IO +
      "constraint Runner<r> =\n" +
      "    run(runner: r, action: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, action) = Debug.log(readIt!(\"x\"))\n")) {
      expect(message).not.toMatch(/\?\d/);
    }
  });
});

describe("Effects §13.4: the member's variable is the member's, wherever written", () => {
  // *(#867, fix round 1.)* §2.4's join as a contract: the outer arrow is the
  // impure **constant** and the callback parameter carries the member's one
  // variable. Reading the variable off the outer arrow quantified nothing here,
  // so the seat compared one instantiation and every call in the program shared
  // one monomorphic colour.
  const TX =
    "constraint Tx<t> =\n" +
    "    within(t: t, action: () ->? Unit) ->! Unit\n" +
    "export record Db = { name: String }\n";

  test("the supplied direction is checked at a `->?` under a constant outer arrow", () => {
    // (1a.) A body handing the linked callback to a `->` demand accepts only
    // pure callbacks, and the seat refuses it at the demand that narrowed it.
    // The advice does **not** gain "and the member's outer arrow `->` with it":
    // the outer arrow is `->!`, so rewriting the parameter leaves no inlet to
    // lose (§9).
    const source = TX +
      "let force(f: () -> Unit): Unit = f()\n" +
      "honor Tx<Db> =\n    within(db, action) = force(action)\n";
    expect(messages(source)).toEqual([narrowerAcceptance("within", "action", false)]);
    expect(primaries(source)).toEqual(["force(action)"]);
  });

  test("and the variable is instantiated fresh at every call", () => {
    // (1b.) Two callers, one supplying an effectful callback and one a pure
    // one. Sharing a single unquantified colour, the second was refused.
    expect(messages(IO + TX +
      "honor Tx<Db> =\n    within(db, action) = action?()\n" +
      "let world(): Unit = Debug.log(readIt!(\"x\"))\n" +
      "export let effectful(d: Db): Unit = d.within!(() => world!())\n" +
      "export let pure(d: Db): Unit = d.within!(() => ())\n",
    )).toEqual([]);
  });

  test("and the header itself draws no face report", () => {
    // (1c.) The member's own `->?` is quantified at the member, so §4.2's
    // impure-direction face check never sees a signature variable solved to a
    // constant on the header's behalf.
    expect(messages(TX)).toEqual([]);
  });

  test("the face carries exactly one variable, displayed undecorated", () => {
    // (1d.) §10 numbers a face carrying **more than one** variable. Two
    // variables here — one for the outer arrow's absent quantifier, one for the
    // callback — would render `->?¹`, which is what the #649 pin above catches.
    expect(messages(TX + "honor Tx<Db> =\n    within(db, action) = action?()\n" +
      "let bad(d: Db): Int = within\n")).toContain(
        "type mismatch: expected Int, found (a, () ->? Unit) ->! Unit",
      );
  });
});

describe("Effects §13.2: where a seat's refusal stands", () => {
  const RUN = (arrow: string) =>
    "constraint Runner<r> =\n" +
    `    run(runner: r, a: () ->! Unit, b: () ->! Unit) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n";

  test("the offending call is the first in SOURCE order", () => {
    // Absorption order is elaboration order; §13.2 says source order, and the
    // two part company as soon as a call stands inside a nested lambda.
    const source = RUN("->") +
      "honor Runner<Job> =\n    run(job, a, b) =\n        a!()\n        b!()\n";
    expect(messages(source)).toEqual([pureConflict("run", "a")]);
    expect(primaries(source)).toEqual(["a!()"]);
  });

  test("the clause names the slot the offending call stands at, not another", () => {
    // "the message names the contract parameter that slot stands at, whatever
    // the call spells". Two `->!` slots that merely both settle are not a body
    // that "merged several contract slots into one", so the merged-slot clause
    // — the first in the contract's parameter order — does not apply, and a
    // report primary at `b!()` may not tell the writer not to call `a`.
    const source = RUN("->") +
      "export record Pair = { x: Unit, y: Unit }\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) = ignore(Pair({ y = b!(), x = a!() }))\n";
    expect(primaries(source)).toEqual(["b!()"]);
    expect(messages(source)).toEqual([pureConflict("run", "b")]);
  });

  test("but where a merge made several slots one, the first in contract order", () => {
    // The clause §13.2 reserves for an actual merge: `f` is `a` and `b` at
    // once, no call can tell them apart, and `a` is first in the header.
    const source = RUN("->") +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n        let f = if c then b else a\n        f!()\n";
    expect(primaries(source)).toEqual(["f!()"]);
    expect(messages(source)).toEqual([pureConflict("run", "a")]);
  });

  test("one report per seat, however many arrows offend", () => {
    const source = RUN("->") +
      "honor Runner<Job> =\n    run(job, a, b) =\n        b!()\n        a!()\n";
    expect(messages(source)).toHaveLength(1);
    expect(primaries(source)).toEqual(["b!()"]);
  });

  test("the conflicting variable whose first bound the walk took EARLIEST", () => {
    // Two conflicting variables in one walk, which two slots that stay two make
    // reachable: the body's own colour under the outer `->`, and the returned
    // closure's under the `->` the contract returns. Both are bounded below by
    // `k`'s slot through the ordering; the outer arrow's bound was taken first,
    // so the outer arrow's frame is the one that reports, and the result form
    // waits for the next compile (§13.2's "one committed answer at a time").
    const source =
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k) =\n        k!()\n        (() => k!())\n";
    expect(messages(source)).toEqual([pureConflict("make", "k")]);
    expect(primaries(source)).toEqual(["k!()"]);
    // With only the returned closure offending, the same seat takes the result
    // form — so the message above is the *choice* of variable, not the only
    // frame this contract can produce.
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k) = (() => k!())\n",
    )).toEqual([
      "this call performs effects the contract hands the body, and `make`'s " +
      "contract returns a `->` function — an instance performs no more than " +
      "its contract permits, and `k` may perform effects whatever the caller " +
      "supplies — do not call `k` here, or, if the constraint is yours, write " +
      "`->!` on the arrow the contract returns",
    ]);
  });

  test("the seat itself is the primary where no call carries the colour", () => {
    // `make(k) = k` merges nothing of its own and calls nothing: the refusal is
    // anchored at the member line, and **both** contract arrows are related
    // locations, neither being visible from the seat.
    const source =
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(k) = k\n";
    expect(messages(source)).toEqual([pureSeatConflict("make", "k", true)]);
    expect(primaries(source)).toEqual(["make(k) = k"]);
    // **Both**, as the comment says: the failing upper arrow — the `->` inside
    // `(() -> Unit)`, whose written token is recorded like every other arrow's
    // — and the handed callback's, in walk order.
    expect(labels(source)).toEqual([[
      "the contract's failing arrow: \"->\"",
      "the handed callback's contract arrow: \"->!\"",
    ]]);
  });

  test("a merge is the primary where no call carries the colour", () => {
    const source =
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(k) = if c then k else (() => ())\n";
    expect(messages(source)).toEqual([pureMergeConflict("make", "k", true)]);
    expect(primaries(source)).toEqual(["if c then k else (() => ())"]);
    // A merge primary takes the handed callback's arrow as its second related
    // location, beside the failing one (§9, §13.2).
    expect(labels(source)).toEqual([[
      "the contract's failing arrow: \"->\"",
      "the handed callback's contract arrow: \"->!\"",
    ]]);
  });

  test("a call primary relates the merge that joined the handed callback in", () => {
    // "the merge that joined the handed slot into the colour that arrow bounds
    // … a second related location where one did" (§9's contract rows).
    const source =
      "constraint Runner<r> =\n    run(runner: r, k: () ->! Unit) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, k) =\n" +
      "        let f = if c then k else (() => ())\n" +
      "        f!()\n";
    expect(messages(source)).toEqual([pureConflict("run", "k")]);
    expect(primaries(source)).toEqual(["f!()"]);
    expect(labels(source)).toEqual([[
      "the contract's failing arrow: \"->\"",
      "the merge that joined the handed callback in: " +
      "\"if c then k else (() => ())\"",
    ]]);
  });

  test("the invariant clause relates the contract's invariant arrow", () => {
    const source =
      "constraint Runner<r> =\n    run(runner: r, cells: Array(() -> Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() ->! Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells) = force(cells)\n";
    expect(primaries(source)).toEqual(["force(cells)"]);
    expect(labels(source)).toEqual([[
      "the contract's invariant arrow: \"->\"",
    ]]);
  });

  test("a default body's seat relates its failing arrow too", () => {
    // Constraints §8's row names two seats — the honor block's member line and
    // the constraint's default member line — and Effects §9 gives them the same
    // related location. The default body is compared against the member's own
    // scheme rather than a re-elaborated contract, so both must reach the
    // written arrow through one route.
    const source =
      IO + "constraint Deflt<a> =\n    tag(x: a) -> String = readIt!(\"z\")\n" +
      "export record P = { name: String }\n" +
      "honor Deflt<P> =\n    tag(x) = x.name\n";
    expect(messages(source)).toEqual([pureContract("tag")]);
    expect(primaries(source)).toEqual(["readIt!(\"z\")"]);
    expect(labels(source)).toEqual([[
      "the contract's failing arrow: \"->\"",
    ]]);
  });
});

describe("Effects §13.2: every frame names the arrow's actual position", () => {
  const MAKER = (result: string, body: string) =>
    IO + `constraint Maker<a> =\n    make(seed: a) -> ${result}\n` +
    "export record S = { n: Int }\n" +
    `honor Maker<S> =\n    make(seed) = ${body}\n`;

  test("the result form, where the path is result steps alone", () => {
    const source = MAKER("(() -> Unit)", '() => Debug.log(readIt!("x"))');
    expect(messages(source)).toEqual([
      "the function this instance returns performs effects, and `make`'s " +
      "contract returns a `->` function — an instance performs no more than its " +
      "contract permits — keep this body pure, or, if the constraint is yours, " +
      "write `->!` on the arrow the contract returns",
    ]);
    // §9 makes the failing arrow a related location on **every** row, and a
    // `->` fails as readily as a coloured arrow does.
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("and a step into data ends that path", () => {
    // *(Fix round 1.)* `Vector(() -> Unit)` is not a function this instance
    // *returns*: the descent into the vector's element is a data step, and the
    // frame that claimed otherwise was false.
    const source = MAKER("Vector(() -> Unit)", '[() => Debug.log(readIt!("x"))]');
    expect(messages(source)).toEqual([
      "a function this instance supplies performs effects, and `make`'s " +
      "contract writes `->` inside its result — an instance performs no more " +
      "than its contract permits — keep this body pure, or, if the constraint " +
      "is yours, write `->!` on that arrow inside its result",
    ]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("the parameter form, for an arrow standing under a named parameter", () => {
    const source = IO +
      "constraint Maker<a> =\n    make(seed: a, use: (() -> Unit) -> Unit) -> Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, use) = use(() => Debug.log(readIt!(\"x\")))\n";
    expect(messages(source)).toEqual([
      "a function this instance supplies performs effects, and `make`'s " +
      "contract writes `->` inside the parameter `use` — an instance performs " +
      "no more than its contract permits — keep this body pure, or, if the " +
      "constraint is yours, write `->!` on that arrow inside the parameter `use`",
    ]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("the narrower-acceptance rows take the same three forms", () => {
    // Each row's own failing arrow — supplied, and so `->!` — is its related
    // location (§9's two narrower-acceptance rows).
    expect(labels(
      "constraint Runner<r> =\n    run(runner: r, cell: (() ->! Unit, Int)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(c: (() -> Unit, Int)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cell) = force(cell)\n",
    )).toEqual([["the contract's failing arrow: \"->!\""]]);
    expect(messages(
      "constraint Runner<r> =\n    run(runner: r, cell: (() ->! Unit, Int)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(c: (() -> Unit, Int)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cell) = force(cell)\n",
    )).toEqual([
      "`run`'s contract accepts a function inside the parameter `cell` that " +
      "performs effects, and this instance accepts only a pure one — an " +
      "instance accepts everything its contract promises to accept — call the " +
      "callback with `!` instead of handing it, or a function that calls it, to " +
      "a `->` demand, or, if the constraint is yours, write that arrow `->` " +
      "inside the parameter `cell`",
    ]);
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a) -> ((() ->! Unit) -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let apply(f: () -> Unit): Unit = f()\n" +
      "honor Maker<S> =\n    make(seed) = (g => apply(g))\n",
    )).toEqual([
      "`make`'s contract accepts a function inside its result that performs " +
      "effects, and this instance accepts only a pure one — an instance accepts " +
      "everything its contract promises to accept — call the callback with `!` " +
      "instead of handing it, or a function that calls it, to a `->` demand, " +
      "or, if the constraint is yours, write that arrow `->` inside its result",
    ]);
  });

  test("and each nested form reports at the act that narrowed the slot", () => {
    expect(primaries(
      "constraint Runner<r> =\n    run(runner: r, cell: (() ->! Unit, Int)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(c: (() -> Unit, Int)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cell) = force(cell)\n",
    )).toEqual(["force(cell)"]);
    expect(primaries(
      "constraint Maker<a> =\n    make(seed: a) -> ((() ->! Unit) -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let apply(f: () -> Unit): Unit = f()\n" +
      "honor Maker<S> =\n    make(seed) = (g => apply(g))\n",
    )).toEqual(["apply(g)"]);
  });

  test("the linked-contract row has a conflict form of its own", () => {
    // §13.2's own worked contract: `a` carries the inlet, so the header is
    // legal, and the body's effect is one `b` handed it — the guarantee broken
    // is the linked outer arrow's, not the base row's "unconditionally".
    const source =
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->? Unit, b: () ->! Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, a, b) = b!()\n";
    expect(messages(source)).toEqual([linkedConflict("run", "b")]);
    expect(primaries(source)).toEqual(["b!()"]);
    // The failing arrow here is the member's own outer `->?`.
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->?\""]]);
  });

  test("the article follows the parameter's own name", () => {
    // `an \`action\`` is §9's example, not a constant: a parameter named `k`
    // earns "a `k`".
    expect(labels(
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(k: () -> Unit) = ()\n",
    )).toEqual([["the contract's failing arrow: \"->!\""]]);
    expect(messages(
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(k: () -> Unit) = ()\n",
    )).toEqual([
      "`make`'s contract accepts a `k` that performs effects, and this instance " +
      "accepts only a pure one — an instance accepts everything its contract " +
      "promises to accept — do not narrow the callback here, or, if the " +
      "constraint is yours, write the member's callback parameter `->`",
    ]);
  });
});

describe("Effects §13.2: the settle, the disposal, and what the bounds leave behind", () => {
  const RUN = (parameters: string, arrow: string, body: string) =>
    `constraint Runner<r> =\n    run(runner: r, ${parameters}) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n" +
    `honor Runner<Job> =\n    run(job, ${parameters.split(":")[0]!.trim()}` +
    `${parameters.includes(",") ? ", " + parameters.split(",")[1]!.split(":")[0]!.trim() : ""}) = ${body}\n`;

  test("a `->!` callback's slot settles, so its calls wear `!`", () => {
    // Left a variable, the colour would default pure and no body that calls
    // what it is handed could honor the member.
    expect(messages(RUN("k: () ->! Unit", "->!", "k!()"))).toEqual([]);
    expect(messages(RUN("k: () ->! Unit", "->!", "k()"))).toEqual([
      "this call runs effects, so `k` wants `!`, not no mark",
    ]);
  });

  test("a `->` callback's slot is released, so its calls stay bare — even under a linked header", () => {
    // **The disposal** (fix round 1). The frame's own defaulting stands down
    // for the inlet, so without the disposal the released slot stayed a
    // variable and `k()` was told to wear `?`.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, k: () -> Unit, action: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, k, action) = k()\n",
    )).toEqual([]);
  });

  test("and `k!()` at a `->` callback is refused", () => {
    // §13.2's pin for the conduit arm at a seat: a call on a freshened callback
    // bounds the body's colour, and a `->` slot fixes nothing, so the mark is
    // read off the released colour.
    expect(messages(RUN("k: () -> Unit", "->", "k!()"))).toEqual([
      "this call is pure, so `k` wants no mark, not `!`",
    ]);
  });

  test("a linked slot is kept, so a conducted callback keeps the linked face", () => {
    // "a released colour takes the join of its lower bounds … so
    // `run(job, action) = action?()` keeps its linked outer face."
    expect(messages(RUN("action: () ->? Unit", "->?", "action?()"))).toEqual([]);
  });

  test("a settled `->!` slot beside a kept linked one: two slots that stay two", () => {
    // **§13.2's conduit qualification** (#885): a call on a freshened callback
    // slot bounds the body's colour below instead of unifying with it, so the
    // two slots stay two. `b`'s settles off its own `->!` bound; `a`'s is the
    // member's variable still, and its calls wear `?`. Unifying them made one
    // colour of the pair and settled it, which refused the `?` and accepted the
    // `!` — the inverse of what the contract says.
    const both = (mark: string) =>
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->? Unit, b: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      `honor Runner<Job> =\n    run(job, a, b) =\n        b!()\n        a${mark}()\n`;
    expect(messages(both("?"))).toEqual([]);
    expect(messages(both("!"))).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`a` wants `?`, not `!`",
    ]);
  });

  test("two slots that stay two: a `->` callback beside a `->!` one", () => {
    // Neither a merge, nor a raise, nor an annotation — none of the three acts
    // §13.2 names as the body fixing a slot — so `a`'s calls stay bare off
    // §3.4's defaulting while `b`'s wear `!`.
    expect(messages(
      "constraint Both<r> =\n" +
      "    both(runner: r, a: () -> Unit, b: () ->! Unit) ->! Unit\n" +
      "export record R = { id: String }\n" +
      "honor Both<R> =\n    both(runner, a, b) =\n        a()\n        b!()\n",
    )).toEqual([]);
  });

  test("and a `->` callback beside a `->?` one, under a linked header", () => {
    // The suite's own released-slot case with one further call added: order is
    // irrelevant, and the second call fixes nothing about the first's slot.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, k: () -> Unit, action: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, k, action) =\n        k()\n        action?()\n",
    )).toEqual([]);
  });

  test("a merged linked-and-`->!` colour settles, and the merge's calls wear `!`", () => {
    // §13.2's merge outcome under a `->!` outer arrow, through a binding: the
    // body asked for one colour by its own act, and the settle fixes it before
    // the disposal can keep it.
    //
    // It does **not** pin "some lower bound rather than the first": a linked
    // arrow imposes no lower bound at all at the pure instantiation, which is
    // compared first, so the colour that settles carries the constant bound
    // alone in the walk that settles it. See the PR's deferred list.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->? Unit, b: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n" +
      "        let f = if c then a else b\n" +
      "        f!()\n",
    )).toEqual([]);
  });

  test("bounds are per instantiation and never pooled", () => {
    // A linked arrow's pure upper bound at the pure instantiation beside its
    // impure lower bound at the impure is the everyday pair pooling would read
    // as a contradiction.
    expect(messages(RUN("action: () ->? Unit", "->?", "action?()"))).toEqual([]);
  });

  test("a failed seat draws no mark report against the colour it condemned", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->! Unit) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, a) = a!()\n",
    )).toEqual([pureConflict("run", "a")]);
  });
});

describe("Effects §13.2: broader acceptance, the raise, the annotation, and the merges", () => {
  const MAKER = (parameter: string, arrow: string, body: string) =>
    `constraint Maker<a> =\n    make(k: ${parameter}) ${arrow} Unit\n` +
    "export record S = { n: Int }\n" +
    `honor Maker<S> =\n    make(k) = ${body}\n`;

  test("the raise: a `->!` demand on a `->` callback is accepted silently", () => {
    expect(messages(
      "constraint Maker<a> =\n    make(k: () -> Unit) ->! Unit\n" +
      "export record S = { n: Int }\n" +
      "let force(f: () ->! Unit): Unit = f!()\n" +
      "honor Maker<S> =\n    make(k) = force!(k)\n",
    )).toEqual([]);
  });

  test("the annotation: writing `->!` where the contract writes `->` is accepted silently", () => {
    expect(messages(
      "constraint Maker<a> =\n    make(k: () -> Unit) ->! Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(k: () ->! Unit) = k!()\n",
    )).toEqual([]);
  });

  test("but a written annotation holds the slot, so it cannot be narrowed", () => {
    // "An explicit implementation annotation is preserved: a member's own
    // written annotation for the parameter is its face, exact."
    expect(messages(MAKER("() ->! Unit", "->", "()").replace(
      "make(k) = ()",
      "make(k: () -> Unit) = ()",
    ))).toEqual([
      "`make`'s contract accepts a `k` that performs effects, and this instance " +
      "accepts only a pure one — an instance accepts everything its contract " +
      "promises to accept — do not narrow the callback here, or, if the " +
      "constraint is yours, write the member's callback parameter `->`",
    ]);
  });

  test("and writing the contract's own `->!` holds it, which is accepted", () => {
    expect(messages(MAKER("() ->! Unit", "->!", "k!()").replace(
      "make(k) = k!()",
      "make(k: () ->! Unit) = k!()",
    ))).toEqual([]);
  });

  test("`->` merged with `->!` wears `!`", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, j: () -> Unit, b: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, j, b) =\n" +
      "        let f = if c then j else b\n" +
      "        j!()\n",
    )).toEqual([]);
  });

  test("`->` merged with `->?` wears `?`", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, j: () -> Unit, a: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, j, a) =\n" +
      "        let f = if c then j else a\n" +
      "        j?()\n",
    )).toEqual([]);
  });

  test("`->?` merged with `->!` settles impure under a `->!` outer arrow", () => {
    // The body asked for one colour by its own act, so `a!()` is then correct
    // and `a?()` refused under a header that writes `->?` at `a`.
    const merged = (mark: string) =>
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->? Unit, b: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n" +
      "        let f = if c then a else b\n" +
      `        a${mark}()\n`;
    expect(messages(merged("!"))).toEqual([]);
    expect(messages(merged("?"))).toEqual([
      "this call runs effects, so `a` wants `!`, not `?`",
    ]);
  });

  test("`->?` merged with `->!` conflicts under a `->` outer arrow", () => {
    const source =
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->? Unit, b: () ->! Unit) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n" +
      "        let f = if c then a else b\n" +
      "        a!()\n";
    expect(messages(source)).toHaveLength(1);
    expect(messages(source)[0]).toContain("may perform effects whatever the caller supplies");
  });

  test("a merge alone narrowing a handed slot, with no pure upper arrow met", () => {
    // James, 2026-09-10: the narrower-acceptance row in its **merge form**, the
    // merge its pin — never in preference to a conflict that is available.
    expect(messages(
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let pureFn(): Unit = ()\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(k) = if c then k else pureFn\n",
    )).toEqual([
      "this expression merges the callback with a pure function, and `make`'s " +
      "contract accepts a `k` that performs effects, and this instance accepts " +
      "only a pure one — an instance accepts everything its contract promises " +
      "to accept — do not merge `k` with a pure function here, or, if the " +
      "constraint is yours, write the member's callback parameter `->`",
    ]);
  });

  test("and its inline-lambda counterpart is accepted — the inherited difference", () => {
    // James, 2026-09-10: **retained** and recorded as inherited inference
    // behaviour with a refactoring cost — a named function's colour was
    // defaulted pure before its generalization where a lambda's is still a
    // variable the seat has not defaulted. Extracting the lambda into a named
    // function can change the verdict; the paired requirement below promises
    // equivalent *explanations*, never identical acceptance.
    expect(messages(
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(k) = if c then k else (() => ())\n",
    )).toEqual([]);
  });

  test("and the boundary is inline versus bound, not lambda versus named", () => {
    // *(Review round 4, MINOR 2.)* §3.4 says where the defaulting happens: "at
    // body close for a lone binding … and for a lambda that is **no binding's
    // right-hand side**, where the binding whose body holds it closes". A `let
    // g = () => ()` is a lone binding, so its colour defaults at its own
    // generalization exactly as `let g(): Unit = ()` does, and §13.2's "a
    // lambda's is still a variable the seat has not defaulted" is true of the
    // **inline** lambda alone. The refactoring cost §13.2 records is therefore
    // one step earlier than "extracting into a named function": giving the
    // lambda a name is what moves the verdict, whichever spelling the name
    // takes.
    const narrower = (bind: string, other: string) =>
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(k) =\n" + bind + `        if c then k else ${other}\n`;
    const merged = "this expression merges the callback with a pure function, and `make`'s " +
      "contract accepts a `k` that performs effects, and this instance accepts " +
      "only a pure one — an instance accepts everything its contract promises " +
      "to accept — do not merge `k` with a pure function here, or, if the " +
      "constraint is yours, write the member's callback parameter `->`";
    // Inline: accepted, as the pair above pins it.
    expect(messages(narrower("", "(() => ())"))).toEqual([]);
    // Bound to a name, either spelling: refused, and with the same sentence.
    expect(messages(narrower("        let g = () => ()\n", "g"))).toEqual([merged]);
    expect(messages(narrower("        let g(): Unit = ()\n", "g"))).toEqual([merged]);
  });

  test("the paired requirement: named and inline coincide where both are refused", () => {
    // A **pure** upper arrow is met, so the merge's incidental unification with
    // a pure constant classifies as the conflict it would have been without the
    // constant — same row, same form, same primary (James, 2026-09-10).
    const paired = (other: string) =>
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let pureFn(): Unit = ()\n" +
      "let c: Bool = True\n" +
      `honor Maker<S> =\n    make(k) = if c then k else ${other}\n`;
    expect(messages(paired("pureFn"))).toEqual([pureMergeConflict("make", "k", true)]);
    expect(messages(paired("(() => ())"))).toEqual([pureMergeConflict("make", "k", true)]);
    expect(primaries(paired("pureFn"))).toEqual(["if c then k else pureFn"]);
    expect(primaries(paired("(() => ())"))).toEqual(["if c then k else (() => ())"]);
    // And the third member of the family (review round 4, MINOR 2): a lambda
    // bound to a name, which defaults where a named function does. Where a pure
    // upper arrow is met all three coincide, which is what "equivalent
    // explanations" promises.
    const bound =
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(k) =\n        let g = () => ()\n" +
      "        if c then k else g\n";
    expect(messages(bound)).toEqual([pureMergeConflict("make", "k", true)]);
    expect(primaries(bound)).toEqual(["if c then k else g"]);
  });

  test("and plain forwarding keeps its seat-level conflict report", () => {
    const source =
      "constraint Maker<a> =\n    make(k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(k) = k\n";
    expect(messages(source)).toEqual([pureSeatConflict("make", "k", true)]);
    expect(primaries(source)).toEqual(["make(k) = k"]);
  });
});

describe("Effects §13.2: invariant and phantom positions", () => {
  const CELLS = (element: string, arrow: string, extra: string, body: string) =>
    `constraint Runner<r> =\n    run(runner: r, cells: Array(${element})${extra}) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n" +
    `honor Runner<Job> =\n    run(job, cells${extra === "" ? "" : ", action"}) = ${body}\n`;

  test("an invariant `->!` slot settles, so a body that calls an element is accepted", () => {
    expect(messages(CELLS("() ->! Unit", "->!", "", "ignore(Array.get(cells, 0))")))
      .toEqual([]);
  });

  test("an invariant `->?` slot keeps the member's variable", () => {
    expect(messages(CELLS(
      "() ->? Unit",
      "->?",
      ", action: () ->? Unit",
      "action?()",
    ))).toEqual([]);
  });

  test("but an invariant slot admits no raise, in its own clause", () => {
    // The body did not perform an effect — it *demanded* one — so the frame,
    // the guarantee, and the advice are the invariant clause's, at the pin.
    const source =
      "constraint Runner<r> =\n    run(runner: r, cells: Array(() -> Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() ->! Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells) = force(cells)\n";
    expect(messages(source)).toEqual([
      "this instance demands a function that may perform effects where `run`'s " +
      "contract writes `->` inside the parameter `cells` — an invariant " +
      "position admits no widening — do not require effects of the function " +
      "inside `cells` here, or, if the constraint is yours, write `->!` on that " +
      "arrow inside the parameter `cells`",
    ]);
    expect(primaries(source)).toEqual(["force(cells)"]);
  });

  test("and an invariant linked slot raised the same way says `->?`", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, cells: Array(() ->? Unit), action: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() ->! Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells, action) = force(cells)\n",
    )).toEqual([
      "this instance demands a function that may perform effects where `run`'s " +
      "contract writes `->?` inside the parameter `cells` — an invariant " +
      "position admits no widening — do not require effects of the function " +
      "inside `cells` here, or, if the constraint is yours, write `->!` on that " +
      "arrow inside the parameter `cells`",
    ]);
  });

  test("the conflict form's invariant counterpart, at a forward and at a merge", () => {
    // *(Review round 3, MINOR 4.)* §13.2 asks for "the invariant counterpart of
    // each" of the pinned outcomes, and these two were the outcomes with none:
    // a body that hands the contract's own effectful callback into an invariant
    // `->` position, by forwarding it and by merging it. The effect is one the
    // contract handed the body, so the clause names `k` and the advice says
    // what not to supply — the conflict form, in the invariant frame.
    const FORWARD =
      "constraint Runner<r> =\n" +
      "    run(runner: r, k: () ->! Unit, cells: Array(() -> Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let take<a>(xs: Array(a), x: a): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, k, cells) = take(cells, k)\n";
    expect(messages(FORWARD))
      .toEqual([invariantSeatConflict("run", "k", "cells", "->")]);
    expect(primaries(FORWARD)).toEqual(["run(job, k, cells) = take(cells, k)"]);
    expect(labels(FORWARD)).toEqual([[
      "the contract's invariant arrow: \"->\"",
      "the handed callback's contract arrow: \"->!\"",
    ]]);
    const MERGE =
      "constraint Runner<r> =\n" +
      "    run(runner: r, k: () ->! Unit, cells: Array(() -> Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "let take<a>(xs: Array(a), x: a): Unit = ()\n" +
      "honor Runner<Job> =\n" +
      "    run(job, k, cells) =\n" +
      "        let f = if c then k else (() => ())\n" +
      "        take(cells, f)\n";
    expect(messages(MERGE))
      .toEqual([invariantMergeConflict("run", "k", "cells", "->")]);
    expect(primaries(MERGE)).toEqual(["if c then k else (() => ())"]);
    expect(labels(MERGE)).toEqual([[
      "the contract's invariant arrow: \"->\"",
      "the handed callback's contract arrow: \"->!\"",
    ]]);
  });

  test("and both invariant counterparts say the same under a linked outer arrow", () => {
    // The failing arrow is the one inside `cells`, not the member's own, so a
    // header that carries an inlet reports identically — which is the claim the
    // outer arrow could have falsified and does not.
    const HEAD =
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->? Unit, k: () ->! Unit, " +
      "cells: Array(() -> Unit)) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "let take<a>(xs: Array(a), x: a): Unit = ()\n";
    const FORWARD = HEAD +
      "honor Runner<Job> =\n    run(job, a, k, cells) = take(cells, k)\n";
    expect(messages(FORWARD))
      .toEqual([invariantSeatConflict("run", "k", "cells", "->")]);
    expect(primaries(FORWARD)).toEqual(["run(job, a, k, cells) = take(cells, k)"]);
    const MERGE = HEAD +
      "honor Runner<Job> =\n" +
      "    run(job, a, k, cells) =\n" +
      "        let f = if c then k else (() => ())\n" +
      "        take(cells, f)\n";
    expect(messages(MERGE))
      .toEqual([invariantMergeConflict("run", "k", "cells", "->")]);
    expect(primaries(MERGE)).toEqual(["if c then k else (() => ())"]);
    expect(labels(MERGE)).toEqual([[
      "the contract's invariant arrow: \"->\"",
      "the handed callback's contract arrow: \"->!\"",
    ]]);
  });

  test("an invariant slot narrowed the other way takes the narrower-acceptance row", () => {
    expect(messages(
      "constraint Runner<r> =\n    run(runner: r, cells: Array(() ->! Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() -> Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells) = force(cells)\n",
    )).toEqual([
      "`run`'s contract accepts a function inside the parameter `cells` that " +
      "performs effects, and this instance accepts only a pure one — an " +
      "instance accepts everything its contract promises to accept — call the " +
      "callback with `!` instead of handing it, or a function that calls it, " +
      "to a `->` demand, or, if the constraint is yours, write that arrow `->` " +
      "inside the parameter `cells`",
    ]);
  });

  test("a phantom position contributes no bound and pins nothing", () => {
    // §13.2's vacuous inlet: the header is legal under §2.2.1's coarse test,
    // the slot is compared with nothing, and a caller supplies either colour.
    const PHANTOM =
      "export union Tag(a) = Plain | Marked\n" +
      "constraint Runner<r> =\n" +
      "    run(runner: r, tag: Tag(() ->? Unit), action: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, tag, action) = action?()\n";
    expect(messages(PHANTOM)).toEqual([]);
    expect(messages(PHANTOM + "export let pure(j: Job): Unit = j.run(Plain, () => ())\n"))
      .toEqual([]);
  });

  test("a CONSTANT phantom slot is compared with nothing, in both directions", () => {
    // The two phantom cases above use a *linked* slot, whose per-instantiation
    // bounds never conflict, so neither can tell the rule from its absence. A
    // `->!` under an unused constructor parameter can: handed to a `Tag(() ->
    // Unit)` demand, it would be the narrower-acceptance row's refusal at the
    // supplied direction and the invariant clause's at the invoked one —
    // "where the analysis's **unused** point erases the occurrence, the slot is
    // compared with nothing", and nothing is what a value of `Tag` carries.
    expect(messages(
      "export union Tag(a) = Plain | Marked\n" +
      "constraint Runner<r> =\n    run(runner: r, tag: Tag(() ->! Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(t: Tag(() -> Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, tag) = force(tag)\n",
    )).toEqual([]);
  });

  test("and a header whose only `->?` stands at a phantom position is still legal", () => {
    expect(messages(
      "export union Tag(a) = Plain | Marked\n" +
      "constraint Runner<r> =\n    run(runner: r, tag: Tag(() ->? Unit)) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, tag) = ()\n",
    )).toEqual([]);
  });
});

describe("Constraints §4.7: a door wears the member's colour, and the listed members must agree", () => {
  const LINKED = "module Lib\n\n" +
    "export constraint R<a> =\n    run(s: a, n: Int, action: () ->? Unit) ->? Unit\n";
  const DOOR = "module Main\n\nimport Lib\n\nexport record P = { name: String }\n" +
    "widens Lib.run(s: P, n: BigInt, action: () ->? Unit): Unit =\n    action?()\n" +
    "honor Lib.R<P> =\n    run = widened\n";

  test("a door under a `->?` member wears the member's variable, not a second one", () => {
    // *(Fix round 1.)* The `->?` the door writes at a widened seat denotes the
    // member's own variable, so its face carries **one** colour across the
    // outer arrow and the callback parameter — §10 displays it undecorated.
    const session = new AnalysisSession();
    session.setFile("/io.js", "");
    session.setFile("/lib.hex", LINKED);
    session.setFile("/main.hex", DOOR);
    expect(session.hover("/main.hex", DOOR.indexOf("run(s: P"))?.displayedType)
      .toBe("(P, BigInt, () ->? Unit) ->? Unit");
  });

  test("so a call through the door conducts", () => {
    const call = (mark: string, callback: string) =>
      DOOR + `export let through(p: P, cb: () ->? Unit): Unit = run${mark}(p, 2n, ${callback})\n`;
    expect(projectMessages([
      ["/lib.hex", LINKED],
      ["/main.hex", call("?", "cb")],
      ["/io.js", ""],
    ])).toEqual([]);
    expect(projectMessages([
      ["/lib.hex", LINKED],
      ["/main.hex", call("", "cb")],
      ["/io.js", ""],
    ])).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`run` wants `?`, not no mark",
    ]);
    // And a pure callback instantiates the same variable pure, so the call is bare.
    expect(projectMessages([
      ["/lib.hex", LINKED],
      ["/main.hex", DOOR + "export let through(p: P): Unit = run(p, 2n, () => ())\n"],
      ["/io.js", ""],
    ])).toEqual([]);
  });

  test("a `Unit`-returning member admits a door at all (#887)", () => {
    // `Unit` is the empty tuple, and `#sameSeat` recognised neither tuples nor
    // functions: every such door was refused as not reaching its own seat,
    // ``the result is `Unit`, not `Unit` ``. Fixed minimally here because
    // #867's own shapes — doors under `->!`/`->?` members with callback
    // parameters — all land on it.
    expect(projectMessages([
      ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    ping(s: a, n: Int) ->! Unit\n"],
      ["/main.hex", "module Main\n\nimport Lib\n\nexport record P = { name: String }\n" +
        "widens Lib.ping(s: P, n: BigInt): Unit = ()\n" +
        "honor Lib.R<P> =\n    ping = widened\n"],
      ["/io.js", ""],
    ])).toEqual([]);
  });

  test("and so does a member with a function-typed parameter (#887)", () => {
    expect(projectMessages([
      ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n" +
        "    apply(s: a, n: Int, f: () -> Unit) -> Unit\n"],
      ["/main.hex", "module Main\n\nimport Lib\n\nexport record P = { name: String }\n" +
        "widens Lib.apply(s: P, n: BigInt, f: () -> Unit): Unit = f()\n" +
        "honor Lib.R<P> =\n    apply = widened\n"],
      ["/io.js", ""],
    ])).toEqual([]);
  });

  test("a door's seat report places at the offending call in the door's body", () => {
    // *(Fix round 1.)* The door's seat runs at the honor block, long after the
    // door's own body closed and with no frame of its own — and it still names
    // the call the writer must change.
    const PURE_LIB = "module Lib\n\nexport constraint R<a> =\n    tag(s: a, n: Int) -> String\n";
    const main = "module Main\n\nimport Lib\n\n" + IO +
      "export record P = { name: String }\n" +
      "widens Lib.tag(s: P, n: BigInt): String =\n" +
      "    let prefix = s.name\n" +
      '    Debug.log(readIt!("x"))\n' +
      "    prefix\n" +
      "honor Lib.R<P> =\n    tag = widened\n";
    const compiled = compileFiles([
      ["/lib.hex", PURE_LIB],
      ["/main.hex", main],
      ["/io.js", ""],
    ]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([pureContract("tag")]);
    expect(
      compiled.diagnostics.map(({ primary }) =>
        main.slice(primary.start.offset, primary.end.offset)
      ),
    ).toEqual(['readIt!("x")']);
  });

  const multi = (first: string, second: string, third?: string) => {
    const heads = ["Lib.op", "Lib2.op", ...(third === undefined ? [] : ["Lib3.op"])];
    return [
      ["/lib.hex", `module Lib\n\nexport constraint P<a> =\n    op(v: a, n: Int) ${first} Int\n`],
      ["/lib2.hex", `module Lib2\n\nexport constraint M<a> =\n    op(v: a, n: Int) ${second} Int\n`],
      ...(third === undefined
        ? []
        : [["/lib3.hex", `module Lib3\n\nexport constraint Q<a> =\n    op(v: a, n: Int) ${third} Int\n`]]),
      ["/main.hex", "module Main\n\nimport Lib\nimport Lib2\n" +
        (third === undefined ? "" : "import Lib3\n") +
        "\nexport record S = { n: Int }\n" +
        `widens ${heads.join(", ")}(v: S, n: BigInt): Int = v.n\n` +
        "honor Lib.P<S> =\n    op = widened\n" +
        "honor Lib2.M<S> =\n    op = widened\n" +
        (third === undefined ? "" : "honor Lib3.Q<S> =\n    op = widened\n")],
      ["/io.js", ""],
    ].map((entry) => [entry[0]!, entry[1]!] as const);
  };

  test("listed members that agree on colour are accepted", () => {
    expect(projectMessages(multi("->!", "->!"))).toEqual([]);
  });

  test("and a disagreement at the outer arrow is refused at the head", () => {
    // *(Fix round 1, root three.)* The impure constant is **not** taken as the
    // wider licence, and the body's inferred colour is not read either — both
    // are refused in Effects §11.
    expect(projectMessages(multi("->", "->!"))).toEqual([
      "this declaration widens `Lib.op`, whose contract is `->`, and `Lib2.op`, " +
      "whose contract is `->!` — a door wears one colour, the member's " +
      "contract, and these disagree; if the constraints are yours, give the " +
      "members one contract; otherwise write each member in its honor block " +
      "instead of a door",
    ]);
  });

  test("three members list in head order, with `and` before the last", () => {
    expect(projectMessages(multi("->", "->!", "->"))).toEqual([
      "this declaration widens `Lib.op`, whose contract is `->`, `Lib2.op`, " +
      "whose contract is `->!`, and `Lib3.op`, whose contract is `->` — a door " +
      "wears one colour, the member's contract, and these disagree; if the " +
      "constraints are yours, give the members one contract; otherwise write " +
      "each member in its honor block instead of a door",
    ]);
  });

  test("a nested disagreement names the position", () => {
    expect(projectMessages([
      ["/lib.hex", "module Lib\n\nexport constraint P<a> =\n" +
        "    op(v: a, n: Int, action: () -> Unit) -> Int\n"],
      ["/lib2.hex", "module Lib2\n\nexport constraint M<a> =\n" +
        "    op(v: a, n: Int, action: () ->! Unit) -> Int\n"],
      ["/main.hex", "module Main\n\nimport Lib\nimport Lib2\n\n" +
        "export record S = { n: Int }\n" +
        "widens Lib.op, Lib2.op(v: S, n: BigInt, action: () -> Unit): Int = v.n\n" +
        "honor Lib.P<S> =\n    op = widened\n" +
        "honor Lib2.M<S> =\n    op = widened\n"],
      ["/io.js", ""],
    ])).toEqual([
      "this declaration widens `Lib.op`, whose contract writes `->` inside the " +
      "parameter `action`, and `Lib2.op`, whose contract writes `->!` inside " +
      "the parameter `action` — a door wears one colour, the member's " +
      "contract, and these disagree; if the constraints are yours, give the " +
      "members one contract; otherwise write each member in its honor block " +
      "instead of a door",
      // §4.7's failed-door row stands beside it, and truthfully: a door's
      // arrows are its **written face** and exact (§4.6), so whichever arrow
      // this declaration writes at that seat, one of the two listed members
      // refuses it. The colour refusal says why no spelling would do.
      "this declaration does not widen `Lib2.op`: `() ->! Unit` does not reach " +
      "the seat `() -> Unit` exactly",
    ]);
  });

  test("two linked members agree — the relationship, not the variable's name", () => {
    // "Agreement is on the linked relationship — which positions share the
    // member's one variable — and on the constant written at every other
    // position, never on variable names, which are immaterial."
    expect(projectMessages([
      ["/lib.hex", "module Lib\n\nexport constraint P<a> =\n" +
        "    op(v: a, n: Int, action: () ->? Unit) ->? Unit\n"],
      ["/lib2.hex", "module Lib2\n\nexport constraint M<a> =\n" +
        "    op(v: a, n: Int, action: () ->? Unit) ->? Unit\n"],
      ["/main.hex", "module Main\n\nimport Lib\nimport Lib2\n\n" +
        "export record S = { n: Int }\n" +
        "widens Lib.op, Lib2.op(v: S, n: BigInt, action: () ->? Unit): Unit =\n" +
        "    action?()\n" +
        "honor Lib.P<S> =\n    op = widened\n" +
        "honor Lib2.M<S> =\n    op = widened\n"],
      ["/io.js", ""],
    ])).toEqual([]);
  });
});

describe("Effects §13.2: the freshening, and what the bounds leave as the ordering", () => {
  test("the contract's colours do not reach the body: every slot is freshened", () => {
    // A `->!` arrow the contract *returns* is a ceiling. Had its colour arrived
    // at the body, the pure lambda beneath it would wear `->!` as a written
    // face and §4.2 would refuse it for performing no effect; freshened, the
    // lambda infers its own colour and the seat compares.
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let quiet(): Unit = ()\n" +
      "honor Maker<S> =\n    make(seed) = (() => quiet())\n",
    )).toEqual([]);
  });

  test("and the same for a supplied slot: a pure body accepts an effectful callback", () => {
    expect(messages(
      "constraint Runner<r> =\n    run(runner: r, k: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, k) = ()\n",
    )).toEqual([]);
  });

  test("a released closure takes the join of its lower bounds, through a chain", () => {
    // "a chain of released closures each conducting the next lands on the one
    // kept slot" — so the body's own colour is the callback's, and the marks
    // read it.
    const chain = (mark: string) =>
      "constraint Runner<r> =\n    run(runner: r, action: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n" +
      "    run(job, action) =\n" +
      "        let inner = () => action?()\n" +
      `        inner${mark}()\n`;
    expect(messages(chain("?"))).toEqual([]);
    expect(messages(chain(""))).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`inner` wants `?`, not no mark",
    ]);
  });
});

/**
 * **A colour the seat bounded is a dependency** — Effects §3.4's fifth, and the
 * one the seat adds *(#885)*. A body colour the ordering carries a slot to may
 * not be generalized: every use would instantiate a copy the seat's comparison,
 * settle and disposal could none of them reach.
 *
 * *(Review round 3, BLOCKER 1.)* The guard existed and was defeated by the
 * ordinary unification standing three lines from where the bound is recorded:
 * it was keyed on the **node** the conduit arm had in hand, and a body that
 * calls a second thing binds that node into another. Every case below is a body
 * that calls two things — the ordinary case, not a corner — and each one gave
 * the wrong verdict before the seat's sets were read through prunes. The worst
 * is the first: a body performing a `->!` callback's effects under a `->`
 * contract, accepted with no diagnostic at all, which is #865, the defect this
 * PR closes.
 */
describe("Effects §3.4: a bounded body colour is a dependency, not a quantifier", () => {
  const KNOT = (head: string, args: string, mark: string, first: string, second: string) =>
    head +
    "export record R = { id: Int }\n" +
    "honor C<R> =\n" +
    `    go(${args}) =\n` +
    "        fun\n" +
    `            ping(n: Int): Unit = if n == 0 then ${first} else ${second}\n` +
    `            pong(n: Int): Unit = ping${mark}(n)\n` +
    `        ping${mark}(2)\n`;
  const PURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n";
  const LINKED_HEAD = "constraint C<r> =\n" +
    "    go(runner: r, a: () ->? Unit, b: () ->! Unit) ->? Unit\n";
  const IMPURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) ->! Unit\n";
  const BODY_3_4 = (lines: readonly string[]): string =>
    PURE_HEAD +
    "export record R = { id: Int }\n" +
    "honor C<R> =\n" +
    "    go(runner, b) =\n" +
    lines.map((line) => `        ${line}\n`).join("");

  test("a `fun` knot inside a seat is bounded whichever call the `if` reaches first", () => {
    // The knot is what made the defect unmissable: `ping` and `pong` close
    // together, so the body's own colour is bound into a sibling's before the
    // seat ever compares. Both orders, because the defect's signature was that
    // swapping these two calls flipped the verdict.
    const first = KNOT(PURE_HEAD, "runner, b", "", "b!()", "pong(n - 1)");
    expect(messages(first)).toEqual([pureConflict("go", "b")]);
    expect(primaries(first)).toEqual(["b!()"]);
    expect(labels(first)).toEqual([["the contract's failing arrow: \"->\""]]);
    const second = KNOT(PURE_HEAD, "runner, b", "", "pong(n - 1)", "b!()");
    expect(messages(second)).toEqual([pureConflict("go", "b")]);
    // **The selector's first tier** *(#889; §13.2)*: the sibling `pong(n - 1)`
    // stands earlier and carries the bound, but only *through the ordering* —
    // `b!()` is the call directly on the freshened slot, so it is the primary in
    // this order as in the other, and the advice "do not call `b` here" now
    // stands on the call to `b`. Before the tier, swapping these two calls moved
    // the report onto a sibling with nothing to do with the contract.
    expect(primaries(second)).toEqual(["b!()"]);
    expect(labels(second)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("and the same knot under a linked header refuses at the pure instantiation", () => {
    const first = KNOT(LINKED_HEAD, "runner, a, b", "?", "b!()", "pong?(n - 1)");
    expect(messages(first)).toEqual([linkedConflict("go", "b")]);
    expect(primaries(first)).toEqual(["b!()"]);
    expect(labels(first)).toEqual([["the contract's failing arrow: \"->?\""]]);
    const second = KNOT(LINKED_HEAD, "runner, a, b", "?", "pong?(n - 1)", "b!()");
    expect(messages(second)).toEqual([linkedConflict("go", "b")]);
    // The first tier again, at the linked row (#889).
    expect(primaries(second)).toEqual(["b!()"]);
  });

  test("and under a `->!` header the knot is accepted, in both orders", () => {
    // The mirror image of the first case, and the defect's other face: with the
    // bound lost, the knot's colours generalized, the seat settled nothing, and
    // a correctly written `ping!(2)` drew "this call is pure, so `ping` wants no
    // mark" — a false refusal of a program the contract permits.
    expect(messages(KNOT(IMPURE_HEAD, "runner, b", "!", "b!()", "pong!(n - 1)")))
      .toEqual([]);
    expect(messages(KNOT(IMPURE_HEAD, "runner, b", "!", "pong!(n - 1)", "b!()")))
      .toEqual([]);
  });

  test("a helper that calls the handed callback and then a second callee", () => {
    // No knot needed: two ordinary local functions reach it, because the second
    // callee's colour is still a variable — the seat holds the defaulting back —
    // and the ordinary arm binds the helper's own colour into it. The seat's
    // refusal stands at `b!()`, and nothing is said about `spare`, which is
    // `let spare(): Unit = ()`.
    const source = PURE_HEAD +
      "export record R = { id: Int }\n" +
      "honor C<R> =\n" +
      "    go(runner, b) =\n" +
      "        let spare(): Unit = ()\n" +
      "        let inner(): Unit =\n" +
      "            b!()\n" +
      "            spare()\n" +
      "        inner()\n";
    expect(messages(source)).toEqual([pureConflict("go", "b")]);
    expect(primaries(source)).toEqual(["b!()"]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("and a helper whose colour a lambda's binds into: the guard's own witness", () => {
    // *(Review round 4, MINOR 3.)* The guard at generalization reads
    // `#seatBounded` **through prunes**, and this is the shape that needs it.
    // `inner`'s colour is the one the seat bounded; the second callee is an
    // inline lambda, whose colour Decision 3 deliberately leaves deferred — so
    // it is still a variable when `inner`'s body absorbs it, the ordinary arm
    // binds the bounded colour into it, and a guard reading the node it stored
    // no longer recognises the colour it had just bounded. Quantified there,
    // every use of `inner` instantiates a copy the ordering, the settle and the
    // disposal can none of them reach — #865 reopened, a `->!` callback's
    // effects performed under a `->` contract with no diagnostic at all.
    //
    // Round 3's witness for this was a *named* second callee, which Decision 3
    // now defaults at its own generalization; the lambda is what still reaches
    // it.
    const inline = BODY_3_4([
      "let inner(): Unit =",
      "    b!()",
      "    (() => ())()",
      "inner()",
    ]);
    expect(messages(inline)).toEqual([pureConflict("go", "b")]);
    expect(primaries(inline)).toEqual(["b!()"]);
    // The same with the lambda standing in a record field rather than applied
    // where it is written — a second route to the same deferral.
    const stored = BODY_3_4([
      "let r = { f = () => () }",
      "let inner(): Unit =",
      "    b!()",
      "    r.f()",
      "inner()",
    ]);
    expect(messages(stored)).toEqual([pureConflict("go", "b")]);
    expect(primaries(stored)).toEqual(["b!()"]);
  });

  test("and one local helper conducting the callback, under each outer arrow", () => {
    const helper = (head: string, args: string, mark: string) =>
      head +
      "export record R = { id: Int }\n" +
      "honor C<R> =\n" +
      `    go(${args}) =\n` +
      "        let inner(): Unit =\n" +
      "            b!()\n" +
      `        inner${mark}()\n`;
    expect(messages(helper(PURE_HEAD, "runner, b", "")))
      .toEqual([pureConflict("go", "b")]);
    expect(primaries(helper(PURE_HEAD, "runner, b", ""))).toEqual(["b!()"]);
    expect(messages(helper(LINKED_HEAD, "runner, a, b", "?")))
      .toEqual([linkedConflict("go", "b")]);
    expect(primaries(helper(LINKED_HEAD, "runner, a, b", "?"))).toEqual(["b!()"]);
    expect(messages(helper(IMPURE_HEAD, "runner, b", "!"))).toEqual([]);
  });

  test("a merged slot is still a slot: the seat bounds it rather than joining it", () => {
    // *(Review round 3, MEDIUM 2 — the witness that set had none.)* The set of
    // colours the freshening minted was read by identity too, and a merge binds
    // the slot into the colour it was merged with. Read that way the call on
    // `f` fell to the ordinary arm, which *joined* the slot to the body's own —
    // "two slots that stay two" (§13.2) collapsed into one — and the impure
    // bound `k!()` puts on the body's colour then arrived at `j`'s pure slot,
    // so a bare call on a provably pure merge was told to write `!`.
    const merged = (before: string, after: string) =>
      "constraint Runner<r> =\n" +
      "    run(runner: r, j: () -> Unit, k: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, j, k) =\n" +
      "        let f = if c then j else (() => ())\n" +
      `${before}${after}`;
    expect(messages(merged("        f()\n", "        k!()\n"))).toEqual([]);
    // And in the other call order, which is where the identity read's answer
    // depended on which way the merge's unification happened to bind.
    expect(messages(merged("        k!()\n", "        f()\n"))).toEqual([]);
    // The merge written the other way round binds the other way and was right
    // by luck; it must stay right.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, j: () -> Unit, k: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, j, k) =\n" +
      "        let f = if c then (() => ()) else j\n" +
      "        f()\n" +
      "        k!()\n",
    )).toEqual([]);
  });

  test("and the same merged slot under a linked outer arrow", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, j: () -> Unit, a: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, j, a) =\n" +
      "        let f = if c then j else (() => ())\n" +
      "        f()\n" +
      "        a?()\n",
    )).toEqual([]);
  });

  test("a merged slot the seat condemned draws no second report about its call", () => {
    // The companion set (review round 3): `#reportedFaces` is keyed the same
    // way, and a merge may bind the freshened slot into the colour it was
    // merged with — so the node the freshening minted is no longer the one the
    // call's mark obligation carries. Recording the chain rather than the node
    // keeps §13.2's "a failed seat settles nothing, so no mark report is made
    // against any colour the freshening minted" true of a merged slot too.
    const source =
      "constraint Runner<r> =\n    run(runner: r, k: () ->! Unit) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, k) =\n" +
      "        let f = if c then k else (() => ())\n" +
      "        f!()\n";
    expect(messages(source)).toEqual([pureConflict("run", "k")]);
  });
});

describe("Constraints §8: a member header's arrow seat, and what recovery leaks", () => {
  test("`=>` at the arrow seat takes the type-arrow redirect, and one typo yields one report", () => {
    // *(Fix round 1.)* Four diagnostics before this: the redirect's absence
    // cost the header its result type, and the parser's `Invalid` placeholder
    // then leaked into the resolver and back out at the member name.
    const source = "constraint C<a> =\n    m(x: a) => String\n";
    expect(messages(source)).toEqual([
      "Hexagon's type arrows are `->`, `->?`, `->!`; `=>` is the lambda arrow " +
      "— for a function type write `Int -> Int` (or `->?` / `->!` for its colour)",
    ]);
    expect(primaries(source)).toEqual(["=>"]);
    expect(fixes(source)).toEqual(['write `->`: "->"']);
  });

  test("and the retired `=>!` recovers as `->!`", () => {
    expect(messages("constraint C<a> =\n    m(x: a) =>! String\n")).toHaveLength(1);
    expect(fixes("constraint C<a> =\n    m(x: a) =>! String\n"))
      .toEqual(['write `->!`: "->!"']);
  });

  test("a header with no arrow at all reports once, and leaks no `Invalid`", () => {
    const source = "constraint C<a> =\n    m(x: a)\n";
    expect(messages(source)).toEqual(["constraint members require a result type"]);
  });
});

/**
 * **A failed seat's mark suppression reaches the freshened slots' forward
 * reach**, and **a conflict's primary prefers a call directly on a contract
 * slot** — Effects §13.2's failed-seat sentence and its conflict selector, both
 * as rider #889 amends them (§4.1's two suppressions, §9's two conflict rows,
 * §12's rows). Beside them, §13.2's own reading of when a nested frame defaults
 * at a seat: **a named local function defaults at its own generalization**, as
 * §3.4 says and as it does outside a seat; only a lambda, which has no
 * generalization point of its own, keeps the variable the seat has not
 * defaulted.
 *
 * *(Review round 3, MEDIUM 3 and MINOR 5, and fix round 3's third pending
 * item.)* All three were the seat's deferred defaulting meeting §3.4's ordinary
 * conduit arm: inside an instance body every nested frame's colour was still a
 * variable when the enclosing body absorbed its call, so the ordinary arm joined
 * the two, and what the seat then decided about the body it decided about the
 * helper.
 */
describe("Effects §13.2: a failed seat's suppression, and the conflict's two tiers", () => {
  const PURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n";
  const IMPURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) ->! Unit\n";
  const LINKED_HEAD = "constraint C<r> =\n" +
    "    go(runner: r, a: () ->? Unit, b: () ->! Unit) ->? Unit\n";
  const BODY = (head: string, args: string, lines: readonly string[]): string =>
    head +
    "record R = { id: Int }\n" +
    "honor C<R> =\n" +
    `    go(${args}) =\n` +
    lines.map((line) => `        ${line}\n`).join("");

  test("a failed seat says nothing about the helpers its slots reach", () => {
    // MEDIUM 3, verbatim. `one` calls the handed callback and `two` calls
    // `one`, so the ordering carries the seat's unsettled slot to both — and a
    // mark read off either is no trustworthy ground for a correction. The
    // deletion the second report used to offer damaged a body the seat's one
    // refusal already names.
    const source = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two()",
    ]);
    expect(messages(source)).toEqual([pureConflict("go", "b")]);
    expect(primaries(source)).toEqual(["b!()"]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
    // No deletion fixit: the suppression is what removes the whole report, not
    // its sentence alone.
    expect(fixes(source)).toEqual([]);
  });

  test("and the same where the seat fails at a linked contract's pure instantiation", () => {
    // The `->?` outer arrow's variant: three diagnostics before the
    // suppression reached the forward reach, one after.
    const source = BODY(LINKED_HEAD, "runner, a, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two()",
    ]);
    expect(messages(source)).toEqual([linkedConflict("go", "b")]);
    expect(primaries(source)).toEqual(["b!()"]);
  });

  test("and the marks the reach suppresses survive a `fun` knot's compression", () => {
    // *(Review round 4, MAJOR 1.)* The knot is what defeats a suppression set
    // read off the colours afterwards: `ping`'s colour is bound into `pong`'s,
    // so the reach holds `pong`'s node alone — and once §3.4's defaulting binds
    // `pong` to the pure constant, `#prune`'s **path compression** rewrites
    // `ping`'s chain straight to that constant and cuts `pong` out of it. Three
    // diagnostics stood here, two of them affirmatively false about the program
    // and each offering to delete a `!` from a genuinely impure call.
    //
    // The bare spelling above sidesteps the shape entirely, because a mark that
    // is already right is never reported. These are the same programs with the
    // marks the writer would have written.
    const KNOT = (head: string, args: string, first: string, second: string) =>
      head +
      "record R = { id: Int }\n" +
      "honor C<R> =\n" +
      `    go(${args}) =\n` +
      "        fun\n" +
      `            ping(n: Int): Unit = if n == 0 then ${first} else ${second}\n` +
      "            pong(n: Int): Unit = ping!(n)\n" +
      "        ping!(2)\n";
    for (const source of [
      KNOT(PURE_HEAD, "runner, b", "b!()", "pong!(n - 1)"),
      KNOT(PURE_HEAD, "runner, b", "pong!(n - 1)", "b!()"),
    ]) {
      expect(messages(source)).toEqual([pureConflict("go", "b")]);
      expect(primaries(source)).toEqual(["b!()"]);
      // The whole of the damage: no deletion offered against `ping!` or `pong!`.
      expect(fixes(source)).toEqual([]);
    }
    for (const source of [
      KNOT(LINKED_HEAD, "runner, a, b", "b!()", "pong!(n - 1)"),
      KNOT(LINKED_HEAD, "runner, a, b", "pong!(n - 1)", "b!()"),
    ]) {
      expect(messages(source)).toEqual([linkedConflict("go", "b")]);
      expect(primaries(source)).toEqual(["b!()"]);
      expect(fixes(source)).toEqual([]);
    }
  });

  test("and the two-locals and lambda shapes in the marked spelling too", () => {
    // The same question of the shapes that do not knot: a chain of two named
    // locals, and a lambda the ordering reaches. Both are marked as the writer
    // would mark them once the member is repaired, and the failed seat says
    // nothing about either.
    const twoLocals = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two!()",
    ]);
    expect(messages(twoLocals)).toEqual([pureConflict("go", "b")]);
    expect(fixes(twoLocals)).toEqual([]);
    const lambda = BODY(PURE_HEAD, "runner, b", [
      "let f = () => b!()",
      "f!()",
    ]);
    expect(messages(lambda)).toEqual([pureConflict("go", "b")]);
    expect(fixes(lambda)).toEqual([]);
  });

  test("a helper the ordering does not reach keeps its own mark report", () => {
    // "its error being its own": `quiet` calls nothing, so no slot reaches it
    // and §4.1 speaks about it as it would anywhere.
    const source = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let quiet(): Unit = ()",
      "quiet!()",
      "one()",
    ]);
    expect(messages(source)).toEqual([
      pureConflict("go", "b"),
      "this call is pure, so `quiet` wants no mark, not `!`",
    ]);
    expect(primaries(source)).toEqual(["b!()", "!"]);
  });

  test("and a wrong mark on a reached helper surfaces once the seat is repaired", () => {
    // "diagnostic recovery only": the seat settles nothing and defaulting still
    // runs, so the suppression buys one compile, never silence. Repaired by
    // respelling the member `->!`, `two()` is a bare call on an impure helper.
    const respelled = BODY(IMPURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two()",
    ]);
    expect(messages(respelled)).toEqual([
      "this call runs effects, so `two` wants `!`, not no mark",
    ]);
    // Repaired the other way — the offending call removed — a `two!()` on a
    // helper that calls nothing is reported as it would be anywhere.
    const removed = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = ()",
      "let two(): Unit = one()",
      "two!()",
    ]);
    expect(messages(removed)).toEqual([
      "this call is pure, so `two` wants no mark, not `!`",
    ]);
  });

  test("a conflict's primary is the call on the slot, not a pure local standing earlier", () => {
    // MINOR 5, verbatim, and its mirror. `spare`'s colour is one the ordering
    // carries the slot to, and it is first in source order — but `b!()` is the
    // call *directly* on the freshened slot, and the report's advice says "do
    // not call `b` here". Both call orders, because before the first tier the
    // verdict's placement moved with them.
    const before = BODY(PURE_HEAD, "runner, b", [
      "let spare(): Unit = ()",
      "let inner(): Unit =",
      "    spare()",
      "    b!()",
      "inner()",
    ]);
    expect(messages(before)).toEqual([pureConflict("go", "b")]);
    expect(primaries(before)).toEqual(["b!()"]);
    const after = BODY(PURE_HEAD, "runner, b", [
      "let spare(): Unit = ()",
      "let inner(): Unit =",
      "    b!()",
      "    spare()",
      "inner()",
    ]);
    expect(messages(after)).toEqual([pureConflict("go", "b")]);
    expect(primaries(after)).toEqual(["b!()"]);
  });

  test("an aliased slot is a direct call: slot identity, never the callee's spelling", () => {
    // "a local the body bound to the callback, `let k = b`, is the slot as
    // surely as `b` is, ordinary unification having identified the two, the
    // identity read through pruning".
    const source = BODY(PURE_HEAD, "runner, b", [
      "let k = b",
      "let spare(): Unit = ()",
      "let inner(): Unit =",
      "    spare()",
      "    k!()",
      "inner()",
    ]);
    expect(messages(source)).toEqual([pureConflict("go", "b")]);
    expect(primaries(source)).toEqual(["k!()"]);
  });

  test("a contract-slot call carrying nothing into this conflict wins nothing", () => {
    // The first tier is drawn from *this* conflict's own lower bounds, not from
    // every slot the seat freshened: `c!()` stands earlier and stands on a
    // `->!` slot, but its colour is bounded into a helper the body never calls,
    // so it carries nothing into the conflict the outer arrow raises.
    const source =
      "constraint C<r> =\n    go(runner: r, c: () ->! Unit, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\n" +
      "honor C<R> =\n" +
      "    go(runner, c, b) =\n" +
      "        let unused(): Unit = c!()\n" +
      "        b!()\n";
    expect(messages(source)).toEqual([pureConflict("go", "b")]);
    expect(primaries(source)).toEqual(["b!()"]);
  });

  test("a named local function defaults at its own generalization, seat or no seat", () => {
    // §13.2's merge-classification sentence says which colour a seat holds a
    // variable and why: "a named function's colour having been defaulted pure
    // before its generalization (§3.4) where a lambda's is still a variable the
    // seat has not defaulted". Blanket deferral made this program refused —
    // `spare`'s colour was joined to the body's own, and the settle then drove
    // the helper impure.
    expect(messages(BODY(IMPURE_HEAD, "runner, b", [
      "let spare(): Unit = ()",
      "spare()",
      "b!()",
    ]))).toEqual([]);
    // A `fun` knot member has a generalization point too — the knot's close.
    expect(messages(BODY(IMPURE_HEAD, "runner, b", [
      "fun spare(): Unit = ()",
      "spare()",
      "b!()",
    ]))).toEqual([]);
    // And the `->` refusal is unchanged: the helper says nothing, the seat says
    // everything.
    const refused = BODY(PURE_HEAD, "runner, b", [
      "let spare(): Unit = ()",
      "spare()",
      "b!()",
    ]);
    expect(messages(refused)).toEqual([pureConflict("go", "b")]);
    expect(primaries(refused)).toEqual(["b!()"]);
  });

  test("and under a linked header the seat's answer is the answer outside one", () => {
    // The same two locals under a `->?` outer arrow. The seat accepts them, and
    // the mark the inlet demands of `spare()` is **#890**'s — a pre-existing
    // #868 gap that reproduces with no constraint in sight, so the pin here is
    // the equivalence: inside a seat, a named local function is answered
    // exactly as it is outside one.
    const LINKED_ONLY = "constraint C<r> =\n    go(runner: r, a: () ->? Unit) ->? Unit\n";
    expect(messages(BODY(LINKED_ONLY, "runner, a", [
      "let spare(): Unit = ()",
      "spare?()",
      "a?()",
    ]))).toEqual([]);
    expect(messages(BODY(LINKED_ONLY, "runner, a", [
      "fun spare(): Unit = ()",
      "spare?()",
      "a?()",
    ]))).toEqual([]);
    // Bare, the seat says what the constraint-free program says, word for word.
    const inSeat = messages(BODY(LINKED_ONLY, "runner, a", [
      "let spare(): Unit = ()",
      "spare()",
      "a?()",
    ]));
    const outside = messages(
      "let outer(a: () ->? Unit): Unit =\n" +
      "    let spare(): Unit = ()\n" +
      "    spare()\n" +
      "    a?()\n",
    );
    expect(inSeat).toEqual(outside);
    expect(inSeat).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`spare` wants `?`, not no mark",
    ]);
  });
});
