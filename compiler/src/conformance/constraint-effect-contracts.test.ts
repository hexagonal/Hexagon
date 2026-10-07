/**
 * Conformance for **effect contracts at the constraint seat** (`spec/effects.md`
 * §13; `spec/constraints.md` §2, §4.1, §4.7, §8), and for the defect the seat
 * closes: #865, an `honor` body performing effects behind a member's pure face,
 * accepted with no diagnostic since #355.
 *
 * The doctrine in one sentence: **an instance accepts everything its contract
 * promises to accept, and does no more than its contract permits.**
 * A member header writes its outer arrow because it is a contract with no body
 * to infer from; the body under it is inferred as any body is and then
 * *compared* against the contract, at the sign of each arrow. This is the one
 * seat in the language where colours are compared rather than unified (§13.1).
 *
 * The file is organised by the spec's own sections, and every message here is
 * quoted from Effects §9's two seat rows or Constraints §8's — a
 * paraphrase in a test is a paraphrase in the compiler within one edit.
 */

import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";
import { compileFiles, runProject } from "../support/test-project.js";

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
 * claim §13.2 makes explicitly — "at the offending call", "at the pin" — so the
 * spans are pinned, not only the sentences.
 */
function primaries(source: string): readonly string[] {
  const text = "module Main\n\n" + source;
  return compileFiles([["/main.hex", text], ["/io.js", ""]]).diagnostics.map(
    ({ primary }) => text.slice(primary.start.offset, primary.end.offset),
  );
}

/**
 * Each diagnostic's related locations, as `message: source text`. §9's seat
 * rows make the contract's failing arrow the one related location, so it is
 * pinned too.
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

/**
 * All three views off **one** compile. Every family below wants the sentence,
 * the primary and the related locations of the same program, and asking for
 * them through the three helpers above compiles it three times, which puts the
 * heaviest blocks of this file over vitest's per-test budget.
 */
function seen(source: string): {
  readonly messages: readonly string[];
  readonly primaries: readonly string[];
  readonly labels: readonly (readonly string[])[];
} {
  const text = "module Main\n\n" + source;
  const diagnostics = compileFiles([["/main.hex", text], ["/io.js", ""]]).diagnostics;
  const at = (span: { start: { offset: number }; end: { offset: number } }) =>
    text.slice(span.start.offset, span.end.offset).trimEnd();
  return {
    messages: diagnostics.map(({ message }) => message),
    primaries: diagnostics.map(({ primary }) => at(primary)),
    labels: diagnostics.map(({ labels: related }) =>
      (related ?? []).map(({ message, span }) => `${message}: ${JSON.stringify(at(span))}`)
    ),
  };
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
const IO = 'extern from "./io.js"\n    export fun readIt(path: String) ->! String\n\n';

/**
 * Effects §9's first seat row — the body does more than its contract permits —
 * at the outer arrow of a `->` contract, verbatim, for the member it names.
 */
const pureContract = (member: string): string =>
  `this call may touch the world, and \`${member}\`'s contract is the pure arrow ` +
  "`->` — an instance does no more than its contract permits — keep this " +
  "body pure, or, if the constraint is yours, write `->!` on the member";

/**
 * The same row where the effect is one the contract handed the body: the one
 * row, reported at the call that runs it (§13.2). The second argument is unused.
 */
const pureConflict = (member: string, _handed: string): string => pureContract(member);

/** The same row where the failing arrow is the one the contract returns. */
const pureReturns = (member: string): string =>
  `the function this instance returns may touch the world, and \`${member}\`'s contract ` +
  "returns a `->` function — an instance does no more than its contract permits — keep " +
  "this body pure, or, if the constraint is yours, write `->!` on the arrow the contract returns";

/**
 * The same row where the failing arrow stands inside a parameter or inside the
 * result past a data step (§9's position forms): `where` is "the parameter
 * `use`" or "its result".
 */
const pureInside = (member: string, where: string): string =>
  `a function this instance supplies may touch the world, and \`${member}\`'s contract writes ` +
  `\`->\` inside ${where} — an instance does no more than its contract permits — keep this ` +
  `body pure, or, if the constraint is yours, write \`->!\` on that arrow inside ${where}`;

/** Effects §9's first seat row under a `>->` contract, verbatim. */
const linkedContract = (member: string): string =>
  `this call touches the world on its own account, and \`${member}\`'s contract is ` +
  "`>->` — an instance is only as effectful as what it is handed — move the effect " +
  "behind a callback, or, if the constraint is yours, write `->!` on the member";

/**
 * Effects §9's second seat row — the body accepts less than its contract
 * promises — at a top-level callback parameter, verbatim. The third argument is
 * unused.
 */
const narrowerAcceptance = (member: string, parameter: string, _inletGain = true): string =>
  `\`${member}\`'s contract accepts any \`${parameter}\`, and this instance accepts only a pure ` +
  "one — an instance accepts everything its contract promises to accept — do not narrow " +
  `\`${parameter}\` here, or, if the constraint is yours, write the member's \`${parameter}\` ` +
  "arrow `->`";

/**
 * The same row at a constant arrow inside a parameter or a result, which the
 * body fixed pure where the contract writes `->!` (§9's position forms).
 */
const narrowerInside = (member: string, where: string): string =>
  `\`${member}\`'s contract accepts a function that may touch the world inside ${where}, and ` +
  "this instance accepts only a pure one — an instance accepts everything its contract " +
  `promises to accept — do not narrow that function here, or, if the constraint is yours, ` +
  `write that arrow \`->\` inside ${where}`;

/**
 * The same row where the body fixed an invariant `->` inside a parameter to
 * `->!` (§13.2: "a constant arrow inside a parameter that the body fixes to
 * the other constant").
 */
const raisedInside = (member: string, where: string): string =>
  `\`${member}\`'s contract accepts a pure function inside ${where}, and this instance ` +
  "accepts only one that may touch the world — an instance accepts everything its " +
  "contract promises to accept — do not narrow that function here, or, if the " +
  `constraint is yours, write that arrow \`->!\` inside ${where}`;

describe("Constraints §2, §8: the header writes its arrow, and `:` is a parse error", () => {
  test("`->`, `->!` and `>->` are all legal on a member header", () => {
    expect(messages(
      "constraint R<a> =\n" +
      "    plain(s: a) -> String\n" +
      "    loud(s: a) ->! String\n" +
      "    linked(s: a, action: () ->! Unit) >-> String\n",
    )).toEqual([]);
  });

  test("a `:` separator is refused with Constraints §8's sentence", () => {
    // The colon belongs to *implementation* headers — a `let`, a `fun` member,
    // an `honor` member, a `widens` door — which write `:` and infer. A member
    // has no body to infer from, so it writes the arrow the contract is about.
    expect(messages("constraint R<a> =\n    read(s: a): String\n")).toEqual([
      "a constraint member declares its effect — write `show(x: a) -> String` " +
      "(`->!` for a member whose instances may perform effects, `>->` for one " +
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
    // The table's lower-right cell: a `->!` member honored at an in-memory type
    // by a body that reads nothing.
    expect(table("->!", "s.name")).toEqual([]);
  });

  test("an impure body under a `->` contract is refused", () => {
    expect(table("->", 'readIt!(s.name)')).toEqual([pureContract("read")]);
  });

  test("an impure body under a `->!` contract is accepted", () => {
    expect(table("->!", 'readIt!(s.name)')).toEqual([]);
  });

  test("a pure body under `->!` makes its calls bare (the lower-right cell, §13.3)", () => {
    // A call at this instance follows the instance's own colour: the body
    // reads nothing, so the dot call is bare and a `!` is the error it always was.
    expect(messages(
      "constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n" +
      "export let dot(p: P): String = p.read()\n",
    )).toEqual([]);
    expect(messages(
      "constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n" +
      "export let dot(p: P): String = p.read!()\n",
    )).toEqual(["this call is pure, so `.read` wants no mark, not `!`"]);
  });
});

describe("Effects §13.4: `>->` on a member means only through its callbacks", () => {
  const RUNNER =
    "constraint Runner<r> =\n" +
    "    run(runner: r, action: () ->! Unit) >-> Unit\n" +
    "export record Job = { id: Int }\n";

  test("running the callback, `action!()`, is accepted", () => {
    expect(messages(RUNNER + "honor Runner<Job> =\n    run(job, action) = action!()\n"))
      .toEqual([]);
  });

  test("ignoring the callback satisfies the contract too", () => {
    // Behavioural laws are the constraint author's business, not the checker's.
    expect(messages(RUNNER + "honor Runner<Job> =\n    run(job, action) = ()\n"))
      .toEqual([]);
  });

  test("a body's own effect fails the all-pure choice, at the call", () => {
    const source = IO + RUNNER +
      "honor Runner<Job> =\n    run(job, action) = Debug.log(readIt!(\"x\"))\n";
    expect(messages(source)).toEqual([linkedContract("run")]);
    expect(primaries(source)).toEqual(['readIt!("x")']);
  });

  test("a body that accepts only pure callbacks accepts less than the contract promises", () => {
    // The narrowing is an ordinary unification inside the body — the callback's
    // fresh colour pinned pure by a `->` demand — and it is the *seat* that
    // refuses it, at the pin.
    const source = RUNNER +
      "let force(f: () -> Unit): Unit = f()\n" +
      "honor Runner<Job> =\n    run(job, action) = force(action)\n";
    expect(messages(source)).toEqual([narrowerAcceptance("run", "action")]);
    expect(primaries(source)).toEqual(["force(action)"]);
  });

  test("an outer-only `>->` header is §4.4's refusal: nothing is handed", () => {
    // A member header is a signature (§13.4), so §2.2.1 applies to it
    // unchanged: no callback has been handed by the time the arrow runs.
    expect(messages("constraint R<a> =\n    read(s: a) >-> String\n")).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed " +
      "here — no callback of this signature has been handed over by the time this " +
      "arrow runs; write `->!` for a function that may touch the world, or `->` " +
      "for one that does not",
    ]);
    expect(primaries("constraint R<a> =\n    read(s: a) >-> String\n")).toEqual([">->"]);
  });

  test("a `->!` outer arrow is the contract for a member that wants both", () => {
    // `withTransaction`'s shape as a contract (§13.4): a `->!` callback, and a
    // `->!` outer arrow licensing the instance's own effects.
    expect(messages(IO +
      "constraint Tx<t> =\n" +
      "    within(t: t, action: () ->! Unit) ->! Unit\n" +
      "export record Db = { name: String }\n" +
      "honor Tx<Db> =\n" +
      "    within(db, action) =\n" +
      "        Debug.log(readIt!(db.name))\n" +
      "        action!()\n",
    )).toEqual([]);
  });
});

describe("Effects §13.2: a callback run under a constant outer arrow", () => {
  const RUNNER = (arrow: string) =>
    "constraint Runner<r> =\n" +
    `    run(runner: r, action: () ->! Unit) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n";

  test("ignoring the callback under a `->` contract is accepted", () => {
    expect(messages(RUNNER("->") + "honor Runner<Job> =\n    run(job, action) = ()\n"))
      .toEqual([]);
  });

  test("running it under a `->` contract does more than the contract permits", () => {
    // The outer arrow is the one that fails, at the all-impure choice, and the
    // failed seat holds back the mark report on the colour it condemned.
    expect(messages(RUNNER("->") + "honor Runner<Job> =\n    run(job, action) = action!()\n"))
      .toEqual([pureConflict("run", "action")]);
  });

  test("and under a `->!` contract the same body is accepted", () => {
    expect(messages(RUNNER("->!") + "honor Runner<Job> =\n    run(job, action) = action!()\n"))
      .toEqual([]);
  });
});

describe("Effects §13.2: the sign is the variance product", () => {
  test("a returned `->` function that may touch the world takes the result frame", () => {
    // The result position keeps the sign, so the arrow is invoked and the frame
    // names it: §13.2's own worked sentence.
    expect(messages(IO +
      "constraint Maker<a> =\n    make(seed: a) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed) = () => Debug.log(readIt!(\"x\"))\n",
    )).toEqual([pureReturns("make")]);
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

describe("Effects §13.3: a known instance's calls follow it, a generic call the contract", () => {
  const LIB = "module Lib\n\n" +
    "export constraint R<a> =\n    read(s: a) ->! String\n" +
    "export record Note = { name: String }\n" +
    "honor R<Note> =\n    read(s) = s.name\n";

  test("every spelling at an imported pure instance is bare; the generic one wears `!`", () => {
    // The instance's colour is published with it (§13.3), so an importer's
    // known-instance call follows it, and the bounded-generic call the contract.
    expect(projectMessages([
      ["/lib.hex", LIB],
      ["/main.hex", "module Main\n\nimport Lib\n\n" +
        "export let qualified(n: Lib.Note): String = Lib.read(n)\n" +
        "export let dotted(n: Lib.Note): String = n.read()\n" +
        "export let generic<a: Lib.R>(x: a): String = x.read!()\n"],
    ])).toEqual([]);
  });

  test("and the generic call may not be written bare, nor the known one marked", () => {
    expect(projectMessages([
      ["/lib.hex", LIB],
      ["/main.hex", "module Main\n\nimport Lib\n\n" +
        "export let generic<a: Lib.R>(x: a): String = x.read()\n" +
        "export let qualified(n: Lib.Note): String = Lib.read!(n)\n"],
    ])).toEqual([
      "this call may touch the world, so `.read` wants `!`, not no mark",
      "this call is pure, so `Lib.read` wants no mark, not `!`",
    ]);
  });

  test("a call at a known instance follows it through the companion too", () => {
    // Method Syntax §4: the companion is the module addressable under the
    // type's name, and the call through it is the call at its instance.
    const files = (body: string, mark: string) => [
      ["/io.js", ""],
      ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    read(s: a) ->! String\n"],
      ["/note.hex", "module Note\n\nimport Lib\n\n" + IO +
        "export record Note = { name: String }\n" +
        `honor Lib.R<Note> =\n    read(s) = ${body}\n`],
      ["/main.hex", "module Main\n\nimport Note\n\n" +
        `export let at(n: Note.Note): String = Note.read${mark}(n)\n`],
    ] as const;
    expect(projectMessages(files("s.name", ""))).toEqual([]);
    expect(projectMessages(files("s.name", "!")))
      .toEqual(["this call is pure, so `Note.read` wants no mark, not `!`"]);
    expect(projectMessages(files("readIt!(s.name)", "!"))).toEqual([]);
    expect(projectMessages(files("readIt!(s.name)", "")))
      .toEqual(["this call may touch the world, so `Note.read` wants `!`, not no mark"]);
  });

  test("an imported returned function's arrow follows the instance too", () => {
    const files = (body: string, call: string) => [
      ["/io.js", ""],
      ["/lib.hex", "module Lib\n\n" + IO + "export constraint R<a> =\n    make(s: a) ->! (() ->! Unit)\n" +
        `export record Note = { name: String }\nhonor R<Note> =\n    make(s) = ${body}\n`],
      ["/main.hex", `module Main\n\nimport Lib\n\nexport let at(n: Lib.Note): Unit = ${call}\n`],
    ] as const;
    expect(projectMessages(files("() => ()", "Lib.make(n)()"))).toEqual([]);
    expect(projectMessages(files('() =>\n        let z = readIt!("x")\n        ()', "Lib.make(n)!()"))).toEqual([]);
    expect(projectMessages(files('() =>\n        let z = readIt!("x")\n        ()', "Lib.make(n)()")))
      .toEqual(["this call may touch the world, so this call wants `!`, not no mark"]);
  });

  test("an instance that uses an imported default follows the default", () => {
    // The default's colour is published with the constraint; an instance's
    // with the instance (§13.3).
    const files = (body: string, honorIn: "lib" | "main") => {
      const constraint = "export constraint R<a> =\n    read(s: a) ->! Int\n" + `    tag(s: a) ->! Int = ${body}\n`;
      const honor = "export record A = { n: Int }\nhonor R<A> =\n    read(s) = s.n\n";
      return honorIn === "lib"
        ? [["/io.js", ""], ["/lib.hex", "module Lib\n\n" + IO + constraint + honor],
          ["/main.hex", "module Main\n\nimport Lib\n\nexport let p(a: Lib.A): Int = Lib.tag(a) + a.tag()\n"]] as const
        : [["/io.js", ""], ["/lib.hex", "module Lib\n\n" + IO + constraint],
          ["/main.hex", "module Main\n\nimport Lib\n\n" + honor.replace("R<A>", "Lib.R<A>") +
            "export let p(a: A): Int = Lib.tag(a)\n"]] as const;
    };
    expect(projectMessages(files("7", "lib"))).toEqual([]);
    // Republished by the honoring module for its own importers.
    expect(projectMessages([
      ["/io.js", ""],
      ["/lib.hex", "module Lib\n\n" + IO + "export constraint R<a> =\n    read(s: a) ->! Int\n    tag(s: a) ->! Int = 7\n"],
      ["/mid.hex", "module Mid\n\nimport Lib\n\nexport record A = { n: Int }\nhonor Lib.R<A> =\n    read(s) = s.n\n"],
      ["/main.hex", "module Main\n\nimport Lib\nimport Mid\n\nexport let p(a: Mid.A): Int = Lib.tag(a)\n"],
    ])).toEqual([]);
    expect(projectMessages(files("7", "main"))).toEqual([]);
    expect(projectMessages(files('String.length(readIt!("x"))', "main")))
      .toEqual(["this call may touch the world, so `Lib.tag` wants `!`, not no mark"]);
  });

  test("a bare call in the honoring module follows it too", () => {
    expect(messages(
      "constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n" +
      "export let bare(p: P): String = read(p)\n",
    )).toEqual([]);
  });
});

describe("Effects §13.3: an instance's own colour, and the calls that follow it", () => {
  const R = "constraint R<a> =\n    read(s: a) ->! String\n" +
    "record P = { name: String }\n" +
    "record D = { name: String }\n";
  const PURE_P = "honor R<P> =\n    read(s) = s.name\n";
  const SAVING_D = "honor R<D> =\n    read(s) =\n        readIt!(s.name)\n";
  /** §13.3's refusal of a call that stands above the honor it follows. */
  const BELOW = (instance: string) =>
    `this call follows what \`${instance}\` does, and that honor is declared below it; ` +
    "declarations are read top-down — move the honor above this call";

  test("a call follows an honor above it, and one below it is refused in every spelling", () => {
    const calls = "let p(x: P): String = read(x)\nlet d(x: D): String = read!(x)\n";
    expect(messages(IO + R + PURE_P + SAVING_D + calls)).toEqual([]);
    expect(messages(IO + R + calls + SAVING_D + PURE_P)).toEqual([BELOW("R<P>"), BELOW("R<D>")]);
    expect(messages(IO + R + "let p(x: P): String = x.read()\n" + PURE_P)).toEqual([BELOW("R<P>")]);
    expect(messages(IO + R + "let p(x: P): String = x |> read()\n" + PURE_P)).toEqual([BELOW("R<P>")]);
    // The refusal is the honor's place, never a mark: a refused call owes none.
    expect(messages(IO + R + "let p(x: P): String = read!(x)\n" + PURE_P)).toEqual([BELOW("R<P>")]);
    expect(messages(IO + R + PURE_P + "let p(x: P): String = read!(x)\n"))
      .toEqual(["this call is pure, so `read` wants no mark, not `!`"]);
  });

  test("a call above its honor is told once, and what it returns owes no mark (review r1)", () => {
    const made = (call: string) => IO + "record A = { n: Int }\nconstraint M<a> =\n    make(s: a) ->! (() ->! Int)\n" +
      `let p1(): Int = ${call}\n` +
      'honor M<A> =\n    make(s) = () =>\n        let z = readIt!("x")\n        s.n\n';
    expect(messages(made("make(A({ n = 1 }))!()"))).toEqual([BELOW("M<A>")]);
    expect(messages(made("make(A({ n = 1 }))()"))).toEqual([BELOW("M<A>")]);
  });

  test("everything else about an honor is free of source order", () => {
    // A `->` member, a generic call and a reference read no honor's body.
    const show = "constraint Tag<a> =\n    tag(s: a) -> String\nhonor Tag<P> =\n    tag(s) = s.name\n";
    expect(messages(IO + R + "constraint Tag<a> =\n    tag(s: a) -> String\n" +
      "let t(x: P): String = tag(x)\nhonor Tag<P> =\n    tag(s) = s.name\n")).toEqual([]);
    expect(messages(IO + R + "let g<a: R>(x: a): String = read!(x)\n" +
      'let u(): String = g!(P({ name = "p" }))\n' + PURE_P + show)).toEqual([]);
    expect(messages(IO + R + "let r = read\n" + 'let u(x: P): String = r!(x)\n' + PURE_P)).toEqual([]);
  });

  test("a callback whose body binds names is decided where the outer call ends (review r1)", () => {
    // A `let` inside an argument generalizes while the call is still open; the
    // call's own colour is decided at its end, never there.
    const run = (honor: string, call: string, above: boolean) => {
      const decl = "record Job = { n: Int }\nconstraint Run<a> =\n    with(r: a, f: (Int) ->! Int) ->! Int\n";
      const user = `let p1(): Int = ${call}\n`;
      return IO + decl + (above ? honor + user : user + honor);
    };
    const pure = "honor Run<Job> =\n    with(job, f) = f!(job.n)\n";
    const saving = "honor Run<Job> =\n    with(job, f) =\n        let z = readIt!(\"x\")\n        f!(job.n)\n";
    const block = "with(Job({ n = 1 }), (i) =>\n    let z = i + 1\n    z)";
    expect(messages(run(pure, block, true))).toEqual([]);
    expect(messages(run(pure, "Job({ n = 1 }).with((i) =>\n    let z = i + 1\n    z)", true))).toEqual([]);
    expect(messages(run(saving, block, true))).toEqual(["this call may touch the world, so `with` wants `!`, not no mark"]);
    expect(messages(run(pure, block, false))).toEqual([BELOW("Run<Job>")]);
  });

  test("a subject the text does not decide follows the contract, whatever another line decides", () => {
    // §13.3: whether a call is known is decided at the call, from the text.
    expect(messages(IO + R + PURE_P + "let k(x) =\n    let n = read!(x)\n    let p: P = x\n    n\n"))
      .toEqual([]);
    expect(messages(IO + R + PURE_P + "let k(x) =\n    let p: P = x\n    read!(x)\n")).toEqual([]);
    expect(messages(IO + R + PURE_P + "let k(x) =\n    let p: P = x\n    read(x)\n"))
      .toEqual(["this call may touch the world, so `read` wants `!`, not no mark"]);
    expect(messages(IO + R + PURE_P + "let k(x: P): String = read(x)\n")).toEqual([]);
  });

  test("the subject is the first argument whose parameter mentions it", () => {
    const pair = (call: string) => "constraint S<s> =\n    pair(a: s, b: s) ->! Unit\nrecord M = { n: Int }\n" +
      `honor S<M> =\n    pair(a, b) = ()\nlet k(m: M, x): Unit = ${call}\n`;
    expect(messages(pair("pair(m, x)"))).toEqual([]);
    expect(messages(pair("pair(x, m)"))).toEqual(["this call may touch the world, so `pair` wants `!`, not no mark"]);
  });

  test("a member calling a sibling at its own instance follows the contract, the honor not yet read", () => {
    const two = (second: string, call: string) => "constraint Two<a> =\n    first(s: a) ->! Int\n    second(s: a) ->! Int\n" +
      `record P = { n: Int }\nhonor Two<P> =\n    first(s) = 1\n    second(s) = ${second}\nlet k(p: P): Int = ${call}\n`;
    expect(messages(two("s.first!()", "second!(p)"))).toEqual([]);
    expect(messages(two("s.first()", "second!(p)"))).toEqual(["this call may touch the world, so `.first` wants `!`, not no mark"]);
    expect(messages(two("s.first!()", "second(p)"))).toEqual(["this call may touch the world, so `second` wants `!`, not no mark"]);
  });

  test("a subject inside a parameter is decided by its whole type", () => {
    const all = (call: string) => IO + "constraint S<s> =\n    all(stores: Vector(s)) ->! Unit\n" +
      "record M = { n: Int }\nhonor S<M> =\n    all(ms) = ()\n" + `let k(m: M, ms: Vector(M)): Unit = ${call}\n`;
    expect(messages(all("all(ms)"))).toEqual([]);
    expect(messages(all("all([m])"))).toEqual([]);
    expect(messages(all("all!(ms)"))).toEqual(["this call is pure, so `all` wants no mark, not `!`"]);
    // An element only inference decides is not decided by the text, in
    // either order of the lines (review r1).
    const loose = (body: string) => IO + "constraint S<s> =\n    all(stores: Vector(s)) ->! Unit\n" +
      "record M = { n: Int }\nhonor S<M> =\n    all(ms) = ()\n" + `let k(x) =\n${body}`;
    expect(messages(loose("    let p: M = x\n    all([x])\n")))
      .toEqual(["this call may touch the world, so `all` wants `!`, not no mark"]);
    expect(messages(loose("    let p: M = x\n    all!([x])\n"))).toEqual([]);
    expect(messages(loose("    let u = all!([x])\n    let p: M = x\n    u\n"))).toEqual([]);
  });

  test("a subject that generalizes makes the call generic: `!`", () => {
    expect(messages(IO + R + PURE_P + "let k(x) = read!(x)\n")).toEqual([]);
    expect(messages(IO + R + PURE_P + "let k(x) = read(x)\n"))
      .toEqual(["this call may touch the world, so `read` wants `!`, not no mark"]);
    // Decided where `k` generalizes, so `k` is `->!` at every use, whatever
    // instance answers it there.
    expect(messages(IO + R + PURE_P + "let k(x) = read!(x)\nlet u(p: P): String = k(p)\n"))
      .toEqual(["this call may touch the world, so `k` wants `!`, not no mark"]);
    expect(hoveredType("module Main\n\n" + IO + R + PURE_P + "let k(x) = read!(x)\nlet u(p: P): String = k!(p)\n", "k(x)"))
      .toBe("<a: R> a ->! String");
  });

  test("inside its own honor, a call at its own instance follows the contract", () => {
    // Its body is not yet read (§13.3); declared honor knots are open
    // (Constraints §9.8).
    const tree = (mark: string) =>
      "constraint Size<a> =\n    size(x: a) ->! Int\n" +
      "union T = Leaf | Node(T, T)\n" +
      "honor Size<T> =\n    size(t) = match t\n" +
      "        Leaf => 0\n" +
      `        Node(l, r) => l.size${mark}() + r.size${mark}()\n`;
    expect(messages(IO + tree("!") + "let k(t: T): Int = size!(t)\n")).toEqual([]);
    expect(messages(IO + tree("!") + "let k(t: T): Int = size(t)\n"))
      .toEqual(["this call may touch the world, so `size` wants `!`, not no mark"]);
    expect(messages(IO + tree("") + "let k(t: T): Int = size!(t)\n")).toEqual([
      "this call may touch the world, so `.size` wants `!`, not no mark",
      "this call may touch the world, so `.size` wants `!`, not no mark",
    ]);
  });

  test("an honor follows an honor above it; honors and functions that call each other are refused", () => {
    const pair = (aBody: string, bBody: string, aFirst: boolean) => {
      const a = `honor R3<A> =\n    read3(s) = ${aBody}\n`;
      const b = `honor R3<B> =\n    read3(s) = ${bBody}\n`;
      return "constraint R3<a> =\n    read3(s: a) ->! String\n" +
        "record A = { name: String }\nrecord B = { a: A }\n" + (aFirst ? a + b : b + a);
    };
    expect(messages(IO + pair("s.name", "s.a.read3()", true) + "let k(b: B): String = read3(b)\n")).toEqual([]);
    expect(messages(IO + pair("readIt!(s.name)", "s.a.read3!()", true) + "let k(b: B): String = read3!(b)\n"))
      .toEqual([]);
    expect(messages(IO + pair("s.name", "s.a.read3()", false) + "let k(b: B): String = read3(b)\n"))
      .toEqual([BELOW("R3<A>")]);
    // A function and an honor that need each other: one stands below the other.
    expect(messages(IO + "constraint R3<a> =\n    read3(s: a) ->! String\nrecord A = { name: String }\n" +
      "let h(a: A): String = a.read3!()\nhonor R3<A> =\n    read3(s) = h(s)\n")).toEqual([BELOW("R3<A>")]);
  });

  test("a call hands its callbacks to the instance's own colour", () => {
    // The instance decides only its own colour (its body with every callback
    // pure); a call at it is that colour joined with the callbacks it hands.
    const run = (body: string) =>
      "constraint Run<a> =\n    run(r: a, action: () ->! Unit) ->! Unit\n" +
      "record Job = { n: Int }\n" +
      `honor Run<Job> =\n    run(job, action) = ${body}\n` +
      'let save(): Unit = Debug.log(readIt!("x"))\n';
    expect(messages(IO + run("action!()") +
      "let quiet(j: Job): Unit = run(j, () => ())\nlet loud(j: Job): Unit = run!(j, () => save!())\n"))
      .toEqual([]);
    // An instance that never runs its callback still follows the callbacks a
    // call hands it: one colour per instance, the same at every use (§3.4).
    expect(messages(IO + run("()") + "let loud(j: Job): Unit = run(j, () => save!())\n"))
      .toEqual(["this call may touch the world, so `run` wants `!`, not no mark"]);
  });

  test("an arrow the member returns directly follows the instance; one inside data the contract", () => {
    const make = (result: string, body: string, use: string) =>
      `constraint Make<a> =\n    make(seed: a) ->! ${result}\n` +
      "record S = { n: Int }\n" +
      `honor Make<S> =\n    make(seed) = ${body}\n` +
      `let use(s: S): Unit = ${use}\n`;
    expect(messages(IO + make("(() ->! Unit)", "() => ()", "make(s)()"))).toEqual([]);
    expect(messages(IO + make("(() ->! Unit)", '() => Debug.log(readIt!("x"))', "make(s)!()"))).toEqual([]);
    expect(messages(IO + make("Option(() ->! Unit)", "Some(() => ())",
      "match make(s)\n    Some(f) => f!()\n    None => ()"))).toEqual([]);
  });

  test("a member named without being called carries the contract's face", () => {
    // `read` here is a reference, not a call: it carries the contract's `->!`,
    // so `k` may touch the world whatever `f` is (§13.3).
    const merged = (call: string) => IO + R + PURE_P +
      'let loud(q: P): String = readIt!(q.name)\n' +
      "let h(f, p: P, c: Bool): String =\n    let k = if c then f else read\n    k!(p)\n" +
      `let u(p: P): String = ${call}\n`;
    expect(messages(merged("h!(loud, p, True)"))).toEqual([]);
    expect(messages(merged("h!((q) => q.name, p, True)"))).toEqual([]);
    expect(messages(merged("h((q) => q.name, p, True)")))
      .toEqual(["this call may touch the world, so `h` wants `!`, not no mark"]);
  });

  test("a constant a call meets before it ends is compared where the call is decided", () => {
    expect(messages(IO + R + "honor R<P> =\n    read(s) = readIt!(s.name)\n" +
      "let f(x: P): String = read!(x)\nlet g: (P) -> String = f\n"))
      .toEqual(["a `->` arrow promises purity, and this function may touch the world — " +
        "the demand is written `->`, the function's face `->!` or `>->`"]);
    expect(messages(IO + R + PURE_P + "let f(x: P): String = read(x)\nlet g: (P) -> String = f\n")).toEqual([]);
    // The call's own expected type meets its returned arrow first.
    const made = (body: string) => IO + "record A = { n: Int }\nconstraint M<a> =\n    make(s: a) ->! (() ->! Unit)\n" +
      `honor M<A> =\n    make(s) = ${body}\n` + "let h: () -> Unit = make(A({ n = 1 }))\n";
    expect(messages(made("() => ()"))).toEqual([]);
    expect(messages(made('() =>\n        let z = readIt!("x")\n        ()'))).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — " +
        "the demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });

  test("a chain of honors, each above the next, follows each body", () => {
    const chain = (aBody: string, bBody: string, call: string) =>
      "constraint R3<a> =\n    read3(s: a) ->! String\n" +
      "record A = { name: String }\nrecord B = { a: A }\n" +
      `honor R3<A> =\n    read3(s) = ${aBody}\nhonor R3<B> =\n    read3(s) = ${bBody}\n` +
      `let k(b: B): String = ${call}\n`;
    expect(messages(IO + chain("readIt!(s.name)", "s.a.read3!()", "read3!(b)"))).toEqual([]);
    expect(messages(IO + chain("readIt!(s.name)", "s.a.read3!()", "read3(b)")))
      .toEqual(["this call may touch the world, so `read3` wants `!`, not no mark"]);
    expect(messages(IO + chain("s.name", "s.a.read3()", "read3(b)"))).toEqual([]);
  });

  test("a written `>->` over a call at a known instance holds where the instance is pure", () => {
    const face = (honor: string, call: string) => IO + R + honor +
      `let f: (P, () ->! Unit) >-> String = (p, k) =>\n    k!()\n    ${call}\n`;
    expect(messages(face(PURE_P, "read(p)"))).toEqual([]);
    // A written `>->` result over a function that calls it, too.
    expect(messages(IO + R + PURE_P +
      "let mk(k: () ->! Unit, p: P): () >-> String = () =>\n    k!()\n    read(p)\n")).toEqual([]);
    expect(messages(face("honor R<P> =\n    read(s) = readIt!(s.name)\n", "read!(p)"))).toEqual([
      "this call touches the world on its own account, and this face's `>->` promises the function is " +
        "only as effectful as what it is handed — write `->!`",
    ]);
  });

  test("a call whose subject an enclosing scope decides waits there, not in a nested binding", () => {
    const nested = (call: string) => IO + R + "honor R<P> =\n    read(s) = readIt!(s.name)\n" +
      `let k(x) =\n    let g = () => read!(x)\n    let d: P = x\n    ${call}\n`;
    expect(messages(nested("g!()"))).toEqual([]);
    expect(messages(nested("g()"))).toEqual(["this call may touch the world, so `g` wants `!`, not no mark"]);
  });

  test("an instance's colour is read off a body whose other colours are final (review r1)", () => {
    // `via`'s `f` takes `read`'s type, so the impure function `R<A>` hands it
    // meets `R<B>`'s colour as a hard case; it settles before `R<A>`'s colour
    // is read, so `R<A>` touches the world, and its calls wear `!`.
    const via = (call: string) => IO +
      "constraint R<a> =\n    read(s: a) ->! Int\nrecord A = { n: Int }\nrecord B = { m: Int }\n" +
      "honor R<B> =\n    read(s) = 0\n" +
      "let via(f): Int =\n    let g = if True then f else read\n    g!(B({ m = 1 }))\n" +
      'honor R<A> =\n    read(s) = via!((x: B) =>\n        let z = readIt!("x")\n        0)\n' +
      `let p1(): Int = ${call}\n`;
    expect(messages(via("read(A({ n = 1 }))")))
      .toEqual(["this call may touch the world, so `read` wants `!`, not no mark"]);
    expect(messages(via("read!(A({ n = 1 }))"))).toEqual([]);
    // A written `>->` over the same body is read once the case settles.
    expect(messages(IO +
      "constraint R<a> =\n    read(s: a) ->! Int\nrecord B = { m: Int }\nhonor R<B> =\n    read(s) = 0\n" +
      'let loudB(x: B): Int =\n    let z = readIt!("x")\n    0\n' +
      "let viaB(f): Int =\n    let g = if True then f else read\n    g!(B({ m = 8 }))\n" +
      "let f: (() ->! Unit) >-> Int = (k) =>\n    k!()\n    viaB!(loudB)\n"))
      .toEqual(["this call touches the world on its own account, and this face's `>->` promises the function is " +
        "only as effectful as what it is handed — write `->!`"]);
  });

  test("a returned arrow follows the callbacks handed at the outer arrow", () => {
    const make = (call: string) => IO +
      "record A = { n: Int }\nconstraint R<a> =\n    make(s: a, k: () ->! Unit) ->! (() ->! Unit)\n" +
      "honor R<A> =\n    make(s, k) = () => k!()\n" +
      'let loud(): Unit =\n    let z = readIt!("x")\n    ()\n' +
      `let p1(): Unit = ${call}\n`;
    expect(messages(make("make(A({ n = 1 }), () => ())()"))).toEqual([]);
    // The call hands `make` a function that saves, so both arrows follow it.
    expect(messages(make("make!(A({ n = 1 }), loud)!()"))).toEqual([]);
    expect(messages(make("make!(A({ n = 1 }), loud)()")))
      .toEqual(["this call may touch the world, so this call wants `!`, not no mark"]);
  });

  test("an honor whose returned `->` function calls an instance above it is compared at its seat", () => {
    const made = (bBody: string, call: string) => IO +
      "constraint R<a> =\n    read(s: a) ->! Int\n    make(s: a) -> (() -> Unit)\n" +
      "record A = { n: Int }\nrecord B = { m: Int }\n" +
      `honor R<B> =\n    read(s) = ${bBody}\n    make(s) = () => ()\n` +
      `honor R<A> =\n    read(s) = 1\n    make(s) = () =>\n        let z = ${call}\n        ()\n`;
    expect(messages(made("0", "read(B({ m = 1 }))"))).toEqual([]);
    expect(messages(made('String.length(readIt!("x"))', "read!(B({ m = 1 }))"))).toEqual([
      "the function this instance returns may touch the world, and `make`'s contract returns a `->` function — " +
        "an instance does no more than its contract permits — keep this body pure, or, if the constraint is yours, " +
        "write `->!` on the arrow the contract returns",
    ]);
  });

  test("a member reference a binding holds carries the contract's face", () => {
    const held = (call: string) => IO + R + PURE_P + "let ident(x: t): t = x\nlet r = ident(read)\n" +
      `let u(p: P): String = ${call}\n`;
    expect(messages(held("r!(p)"))).toEqual([]);
    expect(messages(held("r(p)"))).toEqual(["this call may touch the world, so `r` wants `!`, not no mark"]);
  });

  test("a returned function's own callbacks are callbacks, not the instance's world (review r2)", () => {
    const make = (call: string) => IO +
      "record A = { n: Int }\nconstraint R<a> =\n    make(s: a) ->! ((() ->! Unit) ->! Unit)\n" +
      "honor R<A> =\n    make(s) = (k) => k!()\n" +
      'let loud(): Unit =\n    let z = readIt!("x")\n    ()\n' +
      `let p1(): Unit = ${call}\n`;
    expect(messages(make("make(A({ n = 1 }))(() => ())"))).toEqual([]);
    expect(messages(make("make(A({ n = 1 }))!(loud)"))).toEqual([]);
    expect(messages(make("make(A({ n = 1 }))(loud)")))
      .toEqual(["this call may touch the world, so this call wants `!`, not no mark"]);
  });

  test("an honor that hands on another known instance's returned function follows it, here and across modules", () => {
    // The honor's own returned arrow is no callback: it is the instance colour
    // it meets, never a slot fitted from it.
    const LOUD = '() =>\n        let z = readIt!("x")\n        ()';
    const honors = (exported: string, aBody: string, bBody: string) =>
      `${exported}constraint R<a> =\n    make(s: a) ->! (() ->! Unit)\n` +
      `${exported}record A = { n: Int }\n${exported}record B = { a: A }\n` +
      `honor R<A> =\n    make(s) = ${aBody}\nhonor R<B> =\n    make(s) =${bBody}\n`;
    const here = (aBody: string, bBody: string, call: string) =>
      messages(IO + honors("", aBody, bBody) + `let p(b: B): Unit = ${call}\n`);
    const across = (aBody: string, bBody: string, call: string) =>
      projectMessages([
        ["/io.js", ""],
        ["/lib.hex", "module Lib\n\n" + IO + honors("export ", aBody, bBody)],
        ["/main.hex", `module Main\n\nimport Lib\n\nexport let p(b: Lib.B): Unit = Lib.${call}\n`],
      ]);
    const handOn = (mark: string) => `\n        let g = s.a.make()\n        () => g${mark}()`;
    for (const check of [here, across]) {
      expect(check("() => ()", handOn(""), "make(b)()")).toEqual([]);
      expect(check("() => ()", " s.a.make()", "make(b)()")).toEqual([]);
      expect(check(LOUD, handOn("!"), "make(b)!()")).toEqual([]);
      expect(check(LOUD, handOn("!"), "make(b)()"))
        .toEqual(["this call may touch the world, so this call wants `!`, not no mark"]);
    }
  });

  test("an honor that merges its callback with a member's reference accepts any callback (reviews r2, r3)", () => {
    // `get` is named, not called: the merge carries the contract's `->!`, so
    // the slot accepts any function and the body touches the world (§13.3).
    const merged = (honor: string, call: string) => IO +
      "record A = { n: Int }\nrecord B = { m: Int }\n" +
      "constraint Q<a> =\n    get(s: a) ->! Int\nhonor Q<B> =\n    get(s) = 0\n" +
      'let loudB(b: B): Int = String.length(readIt!("x"))\n' +
      "constraint R<a> =\n    run(s: a, f: (B) ->! Int) ->! Int\n" + honor +
      `let p1(): Int = ${call}\n`;
    const one = "honor R<A> =\n    run(s, f) =\n        let g = if s.n > 0 then f else get\n        g!(B({ m = 1 }))\n";
    expect(messages(merged(one, "run!(A({ n = 0 }), (b: B) => 7)"))).toEqual([]);
    expect(messages(merged(one, "run(A({ n = 0 }), (b: B) => 7)")))
      .toEqual(["this call may touch the world, so `run` wants `!`, not no mark"]);
    expect(messages(merged(one, "run!(A({ n = 0 }), loudB)"))).toEqual([]);
    // Review r3's shapes: a second merge, a second callback, a `->` field.
    const twice = "honor R<A> =\n    run(s, f) =\n        let g = if s.n > 0 then f else get\n" +
      "        let h = if s.n > 0 then f else loudB\n        h!(B({ m = 1 }))\n";
    expect(messages(merged(twice, "run(A({ n = 0 }), (b: B) => 7)")))
      .toEqual(["this call may touch the world, so `run` wants `!`, not no mark"]);
    const boxed = "record Box = { g: (B) -> Int }\nconstraint W<a> =\n    wrap(s: a, f: (B) ->! Int) ->! Box\n" +
      "honor W<A> =\n    wrap(s, f) =\n        let x = if s.n > 0 then f else get\n        Box({ g = f })\n";
    expect(messages(merged(boxed, "0"))).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — " +
        "the demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });

  test("an instance that uses the default body has the default's colour", () => {
    const withDefault = (body: string) =>
      "constraint R<a> =\n    read(s: a) ->! String\n" +
      `    tag(s: a) ->! String = ${body}\n` +
      "record P = { name: String }\n" +
      "honor R<P> =\n    read(s) = s.name\n";
    expect(messages(IO + withDefault('"p"') + "let k(p: P): String = tag(p)\n")).toEqual([]);
    // A default calls its siblings generically, at their contracts' `!`.
    expect(messages(IO + withDefault("s.read!()") + "let k(p: P): String = tag!(p)\n")).toEqual([]);
  });
});

describe("Constraints §4.7: the `widens` door is compared, and follows its body", () => {
  const LIB = (arrow: string) => "module Lib\n\n" +
    `export constraint R<a> =\n    tag(s: a, n: Int) ${arrow} String\n`;

  /** A door widening the second seat, `Int` reaching `BigInt` by §5.1. */
  const door = (body: string, call: string) => "module Main\n\nimport Lib\n\n" +
    IO +
    "export record P = { name: String }\n" +
    `widens Lib.tag(s: P, n: BigInt): String = ${body}\n` +
    "honor Lib.R<P> =\n    tag = widened\n" +
    `export let through(p: P): String = ${call}\n`;

  test("a pure door body under a `->!` member is accepted, and its calls are bare", () => {
    // The door is the instance at its type (Effects §13.3), so it follows its
    // body: every spelling at the type agrees.
    expect(projectMessages([
      ["/lib.hex", LIB("->!")],
      ["/main.hex", door("s.name", "tag(p, 2n)")],
      ["/io.js", ""],
    ])).toEqual([]);
    expect(projectMessages([
      ["/lib.hex", LIB("->!")],
      ["/main.hex", door("s.name", "tag(p, 2n) ++ Lib.tag(p, 2)")],
      ["/io.js", ""],
    ])).toEqual([]);
  });

  test("a call through the member reads the door, wherever the honor that accounts for it stands (review r1)", () => {
    // Every spelling at the known type agrees: the door is the body read, so
    // it is the door that stands above the call (Effects §13.3).
    const order = (items: readonly string[]) => [
      ["/lib.hex", LIB("->!")],
      ["/main.hex", "module Main\n\nimport Lib\n\n" + IO + "export record P = { name: String }\n" + items.join("")],
      ["/io.js", ""],
    ] as const;
    const door = "widens Lib.tag(s: P, n: BigInt): String = s.name\n";
    const honor = "honor Lib.R<P> =\n    tag = widened\n";
    const calls = "export let through(p: P): String = tag(p, 2n) ++ p.tag(2) ++ Lib.tag(p, 2)\n";
    expect(projectMessages(order([door, calls, honor]))).toEqual([]);
    expect(projectMessages(order([honor, door, calls]))).toEqual([]);
    expect(projectMessages(order([honor, "export let early(p: P): String = Lib.tag(p, 2)\n", door])))
      .toEqual(["this call follows the `widens` door that supplies `tag` at `P`, and that door is declared below it; " +
        "declarations are read top-down — move the door above this call"]);
  });

  test("a door's own body, and an honor's, read a door-supplied member as the rules say (review r2)", () => {
    const lib = "module Lib\n\nexport constraint R<a> =\n    tag(s: a, n: Int) ->! String\n    read(s: a) ->! Int\n";
    const order = (items: readonly string[]) => [
      ["/lib.hex", lib],
      ["/main.hex", "module Main\n\nimport Lib\n\nexport record P = { name: String }\n" + items.join("")],
    ] as const;
    // Inside the door's own body the door is not yet read: the contract, in
    // either order of the door and the honor.
    const recursive = "widens Lib.tag(s: P, n: BigInt): String = if n == 0n then s.name else Lib.tag!(s, 0)\n";
    const accounts = "honor Lib.R<P> =\n    tag = widened\n    read(s) = 1\n";
    const call = 'export let p1(): String = Lib.tag!(P({ name = "a" }), 2)\n';
    expect(projectMessages(order([accounts, recursive, call]))).toEqual([]);
    expect(projectMessages(order([recursive, accounts, call]))).toEqual([]);
    // An honor's own body calling the member a door above supplies reads the door.
    const quiet = "widens Lib.tag(s: P, n: BigInt): String =\n    s.name\n";
    const reads = "honor Lib.R<P> =\n    tag = widened\n    read(s) = String.length(s.tag(2))\n";
    expect(projectMessages(order([quiet, reads, 'export let p1(): Int = Lib.read(P({ name = "a" }))\n']))).toEqual([]);
  });

  test("the door's binding shows its body's colour", () => {
    // One operation, two widths, one colour: the instance's.
    const shown = (body: string) => {
      const main = door(body, "tag!(p, 2n)");
      const session = new AnalysisSession();
      session.setFile("/io.js", "");
      session.setFile("/lib.hex", LIB("->!"));
      session.setFile("/main.hex", main);
      return session.hover("/main.hex", main.indexOf("tag(s: P"))?.displayedType;
    };
    expect(shown("s.name")).toBe("(P, BigInt) -> String");
    expect(shown('readIt!("x")')).toBe("(P, BigInt) ->! String");
  });

  test("so a marked call to the pure-bodied door is refused, and a bare one to the effectful door", () => {
    expect(projectMessages([
      ["/lib.hex", LIB("->!")],
      ["/main.hex", door("s.name", "tag!(p, 2n)")],
      ["/io.js", ""],
    ])).toEqual(["this call is pure, so `tag` wants no mark, not `!`"]);
    expect(projectMessages([
      ["/lib.hex", LIB("->!")],
      ["/main.hex", door('readIt!("x")', "tag(p, 2n)")],
      ["/io.js", ""],
    ])).toEqual(["this call may touch the world, so `tag` wants `!`, not no mark"]);
  });

  test("a door on a member that returns a `->!` function is a door (review r1)", () => {
    expect(projectMessages([
      ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    make(s: a, n: Int) ->! (() ->! Unit)\n"],
      ["/main.hex", "module Main\n\nimport Lib\n\nexport record P = { name: String }\n" +
        "widens Lib.make(s: P, n: BigInt): () ->! Unit = () => ()\nhonor Lib.R<P> =\n    make = widened\n" +
        "export let use(p: P): Unit = make(p, 2n)!()\n"],
    ])).toEqual([]);
  });

  test("a door that runs its callback follows what it is handed, through every spelling", () => {
    const files = (callback: string, mark: string) => [
      ["/io.js", ""],
      ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    tag(s: a, n: Int, k: () ->! Unit) ->! String\n"],
      ["/main.hex", "module Main\n\nimport Lib\n\n" + IO + "export record P = { name: String }\n" +
        'let loud(): Unit =\n    let z = readIt!("x")\n    ()\n' +
        "widens Lib.tag(s: P, n: BigInt, k: () ->! Unit): String =\n    k!()\n    s.name\n" +
        "honor Lib.R<P> =\n    tag = widened\n" +
        `export let p1(): String = tag${mark}(P({ name = "a" }), 2n, ${callback})\n` +
        `export let p2(): String = Lib.tag${mark}(P({ name = "a" }), 2, ${callback})\n`],
    ] as const;
    expect(projectMessages(files("() => ()", ""))).toEqual([]);
    expect(projectMessages(files("loud", "!"))).toEqual([]);
    expect(projectMessages(files("loud", ""))).toEqual([
      "this call may touch the world, so `tag` wants `!`, not no mark",
      "this call may touch the world, so `Lib.tag` wants `!`, not no mark",
    ]);
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

  test("a default under `>->` may call a `>->` sibling with its callback", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, action: () ->! Unit) >-> Unit\n" +
      "    twice(runner: r, action: () ->! Unit) >-> Unit = run!(runner, action)\n",
    )).toEqual([]);
  });

  test("but not call a `->!` one", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    boom(runner: r) ->! Unit\n" +
      "    run(runner: r, action: () ->! Unit) >-> Unit = boom!(runner)\n",
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
        const member = /^\s+([a-z][A-Za-z0-9_]*)\(.*\)\s*(>->|->!?)\s/.exec(line);
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
        if (/->!|>->/.test(line)) coloured.push(`${module}: ${line.trim()}`);
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

  test("in generic code, and the instance's face at a known instance (§10, R4)", () => {
    const source = (body: string) => "module Main\n\n" + IO +
      "export constraint R<a> =\n    read(s: a) ->! String\n" +
      "export record P = { name: String }\n" +
      `honor R<P> =\n    read(s) = ${body}\n` +
      "export let use(p: P): String = read(p)\n" +
      "export let any<a: R>(x: a): String = read!(x)\n";
    expect(hoveredType(source("s.name"), "read(p)")).toBe("P -> String");
    expect(hoveredType(source("s.name"), "use(p")).toBe("P -> String");
    expect(hoveredType(source("s.name"), "read!(x)")).toBe("<a: R> a ->! String");
    expect(hoveredType(source('readIt!("x")'), "read(p)")).toBe("P ->! String");
  });

  test("a coloured face's `.d.ts` carries its Hexagon signature", () => {
    // Effects §10's generated documentation line, which is what FFI Part 9 §2.2
    // points a coloured dictionary member at.
    // The face is the instance's, which reads the world.
    const compiled = compileFiles([
      ["/io.js", ""],
      ["/main.hex", "module Main\n\n" + IO +
        "export constraint R<a> =\n    read(s: a) ->! String\n" +
        "export record P = { name: String }\n" +
        "honor R<P> =\n    read(s) = readIt!(s.name)\n" +
        "export let use(p: P): String = read!(p)\n"],
    ]);
    expect(compiled.diagnostics).toEqual([]);
    const declarations = compiled.modules
      .find(({ source }) => source.path === "/main.hex")!.declarations.text;
    expect(declarations).toContain("/** Hexagon: `P ->! String` */");
  });

  test("no diagnostic displays a numbered inference variable (#649)", () => {
    // Over a message that **displays a type**: §9's seat rows name arrows and
    // parameters and never render one, so this mismatch renders the member's
    // whole face instead.
    const messagesWithTypes = messages(
      "constraint Tx<t> =\n" +
      "    within(t: t, action: () ->! Unit) ->! Unit\n" +
      "export record Db = { name: String }\n" +
      "honor Tx<Db> =\n    within(db, action) = action!()\n" +
      "let bad(d: Db): Int = within\n",
    );
    expect(messagesWithTypes).toContain(
      "type mismatch: expected Int, found (a, () ->! Unit) ->! Unit",
    );
    for (const message of messagesWithTypes) expect(message).not.toMatch(/\?\d/);
    for (const message of messages(IO +
      "constraint Runner<r> =\n" +
      "    run(runner: r, action: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, action) = Debug.log(readIt!(\"x\"))\n")) {
      expect(message).not.toMatch(/\?\d/);
    }
  });
});

describe("Effects §13.4: a callback's colour is the member's, under a constant outer arrow", () => {
  // The outer arrow is the impure **constant**, and the callback parameter
  // carries its own colour, quantified at the member and instantiated fresh at
  // every call.
  const TX =
    "constraint Tx<t> =\n" +
    "    within(t: t, action: () ->! Unit) ->! Unit\n" +
    "export record Db = { name: String }\n";

  test("a `->!` callback under a `->!` outer arrow may not be narrowed", () => {
    // A body handing the callback to a `->` demand accepts only pure
    // callbacks, and the seat refuses it at the pin.
    const source = TX +
      "let force(f: () -> Unit): Unit = f()\n" +
      "honor Tx<Db> =\n    within(db, action) = force(action)\n";
    expect(messages(source)).toEqual([narrowerAcceptance("within", "action", false)]);
    expect(primaries(source)).toEqual(["force(action)"]);
  });

  test("and the callback's colour is instantiated fresh at every call", () => {
    // Two callers, one handing an effectful callback and one a pure one: both
    // are accepted.
    expect(messages(IO + TX +
      "honor Tx<Db> =\n    within(db, action) = action!()\n" +
      "let world(): Unit = Debug.log(readIt!(\"x\"))\n" +
      "export let effectful(d: Db): Unit = d.within!(() => world!())\n" +
      "export let pure(d: Db): Unit = d.within(() => ())\n",
    )).toEqual([]);
  });

  test("and the header itself draws no report", () => {
    // A `->!` callback under a `->!` outer arrow is a legal header.
    expect(messages(TX)).toEqual([]);
  });

  test("the face displays as written, undecorated", () => {
    // §10 displays no numbered colour: the face shows `->!` on the callback's
    // own arrow and on the outer arrow, as the header writes them.
    expect(messages(TX + "honor Tx<Db> =\n    within(db, action) = action!()\n" +
      "let bad(d: Db): Int = within\n")).toContain(
        "type mismatch: expected Int, found (a, () ->! Unit) ->! Unit",
      );
  });
});

describe("Effects §13.2: where a seat's refusal stands", () => {
  const RUN = (arrow: string) =>
    "constraint Runner<r> =\n" +
    `    run(runner: r, a: () ->! Unit, b: () ->! Unit) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n";

  test("the offending call is the first in SOURCE order", () => {
    // §13.2 says source order, which parts company with elaboration order as
    // soon as a call stands inside a nested lambda.
    const source = RUN("->") +
      "honor Runner<Job> =\n    run(job, a, b) =\n        a!()\n        b!()\n";
    expect(messages(source)).toEqual([pureConflict("run", "a")]);
    expect(primaries(source)).toEqual(["a!()"]);
  });

  test("source order, not field order, inside a record literal", () => {
    // `b!()` is written first though `x` is the first field, so the report
    // stands at `b!()`.
    const source = RUN("->") +
      "export record Pair = { x: Unit, y: Unit }\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) = ignore(Pair({ y = b!(), x = a!() }))\n";
    expect(primaries(source)).toEqual(["b!()"]);
    expect(messages(source)).toEqual([pureConflict("run", "b")]);
  });

  test("a call on a merge of two callbacks stands at that call", () => {
    // `f` is `a` and `b` at once, and `f!()` is the one offending call.
    const source = RUN("->") +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n        let f = if c then b else a\n        f!()\n";
    expect(primaries(source)).toEqual(["f!()"]);
    expect(messages(source)).toEqual([pureConflict("run", "a")]);
  });

  test("one report per seat, however many calls offend", () => {
    const source = RUN("->") +
      "honor Runner<Job> =\n    run(job, a, b) =\n        b!()\n        a!()\n";
    expect(messages(source)).toHaveLength(1);
    expect(primaries(source)).toEqual(["b!()"]);
  });

  test("the first failing arrow in walk order: the outer before the result", () => {
    // Two failing arrows in one walk: the body's own colour under the outer
    // `->`, and the returned closure's under the `->` the contract returns.
    // Both carry `k`'s colour; the outer arrow is first in walk order, so its
    // frame is the one that reports (§13.2).
    const source =
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k) =\n        k!()\n        (() => k!())\n";
    expect(messages(source)).toEqual([pureConflict("make", "k")]);
    expect(primaries(source)).toEqual(["k!()"]);
    // With only the returned closure offending, the same seat takes the result
    // form — so the message above is the *choice* of arrow, not the only frame
    // this contract can produce.
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k) = (() => k!())\n",
    )).toEqual([pureReturns("make")]);
  });

  test("where no call carries the colour, the report stands at what hands the function back", () => {
    // `make(seed, k) = k` calls nothing: the refusal stands at the body
    // expression that hands `k` back (§9), in the position form, relating the
    // contract's failing arrow, the `->` inside `(() -> Unit)`.
    const source =
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k) = k\n";
    expect(messages(source)).toEqual([pureReturns("make")]);
    expect(primaries(source)).toEqual(["k"]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("and the same where a merge carries the callback out", () => {
    const source =
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(seed, k) = if c then k else (() => ())\n";
    expect(messages(source)).toEqual([pureReturns("make")]);
    expect(primaries(source)).toEqual(["if c then k else (() => ())"]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("a call through a merge stands at the call, relating only the failing arrow", () => {
    // §9's rows relate the contract's failing arrow alone: the merge that
    // joined the callback in is the call's colour, not a second location.
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
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("an invariant arrow inside a parameter relates the contract's failing arrow", () => {
    const source =
      "constraint Runner<r> =\n    run(runner: r, cells: Array(() -> Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() ->! Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells) = force(cells)\n";
    expect(primaries(source)).toEqual(["force(cells)"]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
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
    expect(messages(source)).toEqual([pureReturns("make")]);
    // §9 makes the failing arrow a related location on **every** row, and a
    // `->` fails as readily as a coloured arrow does.
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("and a step into data ends that path", () => {
    // `Vector(() -> Unit)` is not a function this instance *returns*: the
    // descent into the vector's element is a data step, so the frame names the
    // arrow as inside its result.
    const source = MAKER("Vector(() -> Unit)", '[() => Debug.log(readIt!("x"))]');
    expect(messages(source)).toEqual([pureInside("make", "its result")]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("the parameter form, for an arrow standing under a named parameter", () => {
    const source = IO +
      "constraint Maker<a> =\n    make(seed: a, use: (() -> Unit) -> Unit) -> Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, use) = use(() => Debug.log(readIt!(\"x\")))\n";
    expect(messages(source)).toEqual([pureInside("make", "the parameter `use`")]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("the accepts-less row takes the same position forms", () => {
    // The failing arrow — supplied, and so `->!` — is the related location.
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
    )).toEqual([narrowerInside("run", "the parameter `cell`")]);
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a) -> ((() ->! Unit) -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let apply(f: () -> Unit): Unit = f()\n" +
      "honor Maker<S> =\n    make(seed) = (g => apply(g))\n",
    )).toEqual([narrowerInside("make", "its result")]);
  });

  test("and each nested form stands at the pin", () => {
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

  test("under `>->`, a handed callback is followed and the body's own effect is refused", () => {
    // The `>->` follows every callback the member is handed (§2.2), so running
    // `b` is what it promises; the body's own effect is §9's `>->` row, at the
    // call, relating the member's own outer `>->`.
    const HEAD =
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->! Unit, b: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n";
    expect(messages(HEAD + "honor Runner<Job> =\n    run(job, a, b) = b!()\n")).toEqual([]);
    const own = IO + HEAD + "honor Runner<Job> =\n    run(job, a, b) =\n        b!()\n        ignore(readIt!(\"x\"))\n";
    expect(messages(own)).toEqual([linkedContract("run")]);
    expect(primaries(own)).toEqual(["readIt!(\"x\")"]);
    expect(labels(own)).toEqual([["the contract's failing arrow: \">->\""]]);
  });

  test("the row quotes the parameter's own name", () => {
    // `action` is §9's example, not a constant: a parameter named `k` is
    // quoted as `k`, in the clause and in the advice.
    expect(labels(
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k: () -> Unit) = ()\n",
    )).toEqual([["the contract's failing arrow: \"->!\""]]);
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k: () -> Unit) = ()\n",
    )).toEqual([narrowerAcceptance("make", "k")]);
  });
});

describe("Effects §13.2: a consistent seat fixes its slots for the marks", () => {
  const RUN = (parameters: string, arrow: string, body: string) =>
    `constraint Runner<r> =\n    run(runner: r, ${parameters}) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n" +
    `honor Runner<Job> =\n    run(job, ${parameters.split(":")[0]!.trim()}` +
    `${parameters.includes(",") ? ", " + parameters.split(",")[1]!.split(":")[0]!.trim() : ""}) = ${body}\n`;

  test("a `->!` callback's slot takes the member's colour, so its calls wear `!`", () => {
    // Left a variable, the colour would default pure and no body that calls
    // what it is handed could honor the member.
    expect(messages(RUN("k: () ->! Unit", "->!", "k!()"))).toEqual([]);
    expect(messages(RUN("k: () ->! Unit", "->!", "k()"))).toEqual([
      "this call may touch the world, so `k` wants `!`, not no mark",
    ]);
  });

  test("a `->` callback's slot takes `->`, so its calls stay bare — even under a `>->` header", () => {
    // A slot at a supplied arrow takes the contract's colour there, so `k()`
    // is bare beside the `->!` callback the `>->` follows.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, k: () -> Unit, action: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, k, action) = k()\n",
    )).toEqual([]);
  });

  test("and `k!()` at a `->` callback is refused", () => {
    // The seat is consistent and fixes `k`'s slot to the contract's `->`, so
    // the mark is read off a pure colour: the ordinary extra-mark report.
    expect(messages(RUN("k: () -> Unit", "->", "k!()"))).toEqual([
      "this call is pure, so `k` wants no mark, not `!`",
    ]);
  });

  test("a callback's slot takes the member's colour, so running it keeps the `>->` face", () => {
    // A slot at a `->!` callback's own arrow is the member's callback colour,
    // quantified at the member (§13.2), so `run(job, action) = action!()`
    // follows it, as the contract's `>->` does.
    expect(messages(RUN("action: () ->! Unit", ">->", "action!()"))).toEqual([]);
  });

  test("two callbacks' slots stay two, each the member's colour", () => {
    // Running both makes the body's own colour the join of `a`'s and `b`'s,
    // and neither slot is made the other. Each takes
    // its member callback colour, so each call wears `!` and a bare one is
    // the ordinary missing-mark report.
    const both = (mark: string) =>
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->! Unit, b: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      `honor Runner<Job> =\n    run(job, a, b) =\n        b!()\n        a${mark}()\n`;
    expect(messages(both("!"))).toEqual([]);
    expect(messages(both(""))).toEqual([
      "this call may touch the world, so `a` wants `!`, not no mark",
    ]);
  });

  test("two slots that stay two: a `->` callback beside a `->!` one", () => {
    // Each slot takes the contract's colour at its own arrow, so `a`'s calls
    // stay bare while `b`'s wear `!`.
    expect(messages(
      "constraint Both<r> =\n" +
      "    both(runner: r, a: () -> Unit, b: () ->! Unit) ->! Unit\n" +
      "export record R = { id: String }\n" +
      "honor Both<R> =\n    both(runner, a, b) =\n        a()\n        b!()\n",
    )).toEqual([]);
  });

  test("and a `->` callback beside a `->!` one, under a `>->` header", () => {
    // The bare-`k()` case above with a call on `action` added: the second call
    // fixes nothing about `k`'s slot.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, k: () -> Unit, action: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, k, action) =\n        k()\n        action!()\n",
    )).toEqual([]);
  });

  test("a merge of two `->!` callbacks takes their join, and the merge's calls wear `!`", () => {
    // A slot the body merged across several supplied arrows takes the join of
    // their colours (§13.2), here through a binding under a `->!` outer arrow.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->! Unit, b: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n" +
      "        let f = if c then a else b\n" +
      "        f!()\n",
    )).toEqual([]);
  });

  test("each choice is compared on its own, never pooled", () => {
    // The `>->` arrow is pure at the all-pure choice and impure at the
    // all-impure one; pooling the two would read the everyday body as a
    // contradiction (§13.2).
    expect(messages(RUN("action: () ->! Unit", ">->", "action!()"))).toEqual([]);
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

describe("Effects §13.2: accepting more, annotations, and merges", () => {
  const MAKER = (parameter: string, arrow: string, body: string) =>
    `constraint Maker<a> =\n    make(seed: a, k: ${parameter}) ${arrow} Unit\n` +
    "export record S = { n: Int }\n" +
    `honor Maker<S> =\n    make(seed, k) = ${body}\n`;

  test("a `->!` demand on a `->` callback is accepted silently", () => {
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () -> Unit) ->! Unit\n" +
      "export record S = { n: Int }\n" +
      "let force(f: () ->! Unit): Unit = f!()\n" +
      "honor Maker<S> =\n    make(seed, k) = force(k)\n",
    )).toEqual([]);
  });

  test("annotating `->!` where the contract writes `->` is accepted silently", () => {
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () -> Unit) ->! Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k: () ->! Unit) = k!()\n",
    )).toEqual([]);
  });

  test("but annotating `->` where the contract writes `->!` accepts less", () => {
    // An annotation is one of §13.2's pins: `k: () -> Unit` narrows the `->!`
    // callback to pure.
    expect(messages(MAKER("() ->! Unit", "->", "()").replace(
      "make(seed, k) = ()",
      "make(seed, k: () -> Unit) = ()",
    ))).toEqual([narrowerAcceptance("make", "k")]);
  });

  test("and annotating the contract's own `->!` is accepted", () => {
    expect(messages(MAKER("() ->! Unit", "->!", "k!()").replace(
      "make(seed, k) = k!()",
      "make(seed, k: () ->! Unit) = k!()",
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

  test("`->` merged with a `->!` callback under a `>->` outer arrow wears `!`", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, j: () -> Unit, a: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, j, a) =\n" +
      "        let f = if c then j else a\n" +
      "        j!()\n",
    )).toEqual([]);
  });

  test("two merged callbacks take both colours under a `->!` outer arrow", () => {
    // The body made one slot of two by its own act, and the seat fixes it to
    // the join of `a`'s and `b`'s colours (§13.2), so `a!()` is correct and a
    // bare `a()` is the ordinary missing-mark report.
    const merged = (mark: string) =>
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->! Unit, b: () ->! Unit) ->! Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n" +
      "        let f = if c then a else b\n" +
      `        a${mark}()\n`;
    expect(messages(merged("!"))).toEqual([]);
    expect(messages(merged(""))).toEqual([
      "this call may touch the world, so `a` wants `!`, not no mark",
    ]);
  });

  test("two merged callbacks under a `->` outer arrow: the one row, at the call", () => {
    const source =
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->! Unit, b: () ->! Unit) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, a, b) =\n" +
      "        let f = if c then a else b\n" +
      "        a!()\n";
    expect(messages(source)).toEqual([pureContract("run")]);
    expect(primaries(source)).toEqual(["a!()"]);
  });

  test("a merge with a named pure function narrows nothing (#1119)", () => {
    // A pure function fits wherever a function is expected, so `pureFn` meets
    // `k`'s slot with its arrow opened and fixes nothing: the merged colour is
    // `k`'s.
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let pureFn(): Unit = ()\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(seed, k) = if c then k else pureFn\n",
    )).toEqual([]);
  });

  test("a merge still narrows where the merged colour was pinned pure before the merge", () => {
    // What a merge can still narrow is a colour that is not decided: a
    // parameter with no written type, pinned pure by another use (#1119).
    // Joined with `k`'s slot, it fixes that slot pure: the accepts-less row.
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(seed, k) =\n        let pin = (h) =>\n" +
      "            let p: () -> Unit = h\n            if c then k else h\n        pin(() => ())\n",
    )).toEqual([narrowerAcceptance("make", "k")]);
  });

  test("and its inline-lambda counterpart is accepted, as the named one is", () => {
    // The inline lambda's colour is a variable the seat has not defaulted; the
    // named function's is decided and opened at the use (#1119). Both fix
    // nothing, and extracting the lambda into a named function changes no
    // verdict.
    expect(messages(
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(seed, k) = if c then k else (() => ())\n",
    )).toEqual([]);
  });

  test("and every spelling agrees: inline, bound, and named (#1119)", () => {
    // Inline, bound with `let g = () => ()`, or declared `let g(): Unit = ()`:
    // a pure function merged with `k` fixes nothing, so no spelling moves the
    // verdict.
    const narrower = (bind: string, other: string) =>
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(seed, k) =\n" + bind + `        if c then k else ${other}\n`;
    // Inline: accepted, as the pair above pins it. Bound to a name, either
    // spelling: accepted too — the name's colour is decided pure, and its use
    // opens it (#1119).
    expect(messages(narrower("", "(() => ())"))).toEqual([]);
    expect(messages(narrower("        let g = () => ()\n", "g"))).toEqual([]);
    expect(messages(narrower("        let g(): Unit = ()\n", "g"))).toEqual([]);
  });

  test("named and inline coincide where both are refused", () => {
    // The contract returns a pure `->`, which `k` fails whatever it is merged
    // with: same row, same primary, whichever spelling the pure function takes.
    // No call carries the colour, so the report stands at the merge that hands
    // the function back.
    const paired = (other: string) =>
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let pureFn(): Unit = ()\n" +
      "let c: Bool = True\n" +
      `honor Maker<S> =\n    make(seed, k) = if c then k else ${other}\n`;
    expect(messages(paired("pureFn"))).toEqual([pureReturns("make")]);
    expect(messages(paired("(() => ())"))).toEqual([pureReturns("make")]);
    expect(primaries(paired("pureFn"))).toEqual(["if c then k else pureFn"]);
    expect(primaries(paired("(() => ())"))).toEqual(["if c then k else (() => ())"]);
    // And a lambda bound to a name: the same row, at the member line.
    const bound =
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "let c: Bool = True\n" +
      "honor Maker<S> =\n    make(seed, k) =\n        let g = () => ()\n" +
      "        if c then k else g\n";
    expect(messages(bound)).toEqual([pureReturns("make")]);
    expect(primaries(bound)).toEqual(["if c then k else g"]);
  });

  test("and where the failing `->` is the OUTER arrow", () => {
    // The pair above fails at the `->` the contract **returns**. Here it is the
    // member's own **outer** `->`, which the call `f()` runs the merged slot
    // under: every spelling of the pure side is the one row, at that call.
    const outer = (other: string, bind = "") =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" + bind +
      `        let f = if c then b else ${other}\n` +
      "        f()\n";
    for (
      const [other, bind] of [
        ["spare", ""],
        ["(() => ())", ""],
        ["g", "        let g = () => ()\n"],
      ] as const
    ) {
      const source = outer(other, bind);
      expect(messages(source)).toEqual([pureConflict("go", "b")]);
      expect(primaries(source)).toEqual(["f()"]);
      expect(labels(source)).toEqual([['the contract\'s failing arrow: "->"']]);
    }
  });

  test("and where the merge stands on a helper that runs the callback", () => {
    // The same pair one step further out: `one` runs `b`, the merge joins `one`
    // with a pure function, and the body calls `one`. Either spelling of the
    // pure side is the one row, at the first offending call, `b!()`.
    const conductor = (other: string) =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" +
      "        let one(): Unit = b!()\n" +
      `        let f = if c then one else ${other}\n` +
      "        ignore(f)\n" +
      "        one()\n";
    for (const source of [conductor("spare"), conductor("(() => ())")]) {
      expect(messages(source)).toEqual([pureConflict("go", "b")]);
      expect(primaries(source)).toEqual(["b!()"]);
    }
  });

  test("a merge of a helper that calls another, at a nested frame", () => {
    // `two` calls `one`, the merge joins `two` with a pure function, and the
    // body itself calls `one`: the pure side changes nothing, in either
    // spelling, and the report stands at the call on the slot.
    const nested = (other: string) =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" +
      "        let one(): Unit = b!()\n" +
      "        let two(): Unit = one()\n" +
      "        one()\n" +
      `        ignore(if c then two else ${other})\n`;
    for (const source of [nested("spare"), nested("(() => ())")]) {
      expect(messages(source)).toEqual([pureConflict("go", "b")]);
      expect(primaries(source)).toEqual(["b!()"]);
    }
  });

  test("a function handed back inside data stands at what hands it back too", () => {
    const source =
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> Vector(() -> Unit)\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k) = [k]\n";
    expect(messages(source)).toEqual([pureInside("make", "its result")]);
    expect(primaries(source)).toEqual(["[k]"]);
  });

  test("and where nothing hands the function back, at the member line", () => {
    // `k` is supplied to `use`'s pure slot: no call carries its colour and the
    // body hands nothing back, so the report falls back to the member line.
    const source =
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit, use: (() -> Unit) -> Unit) -> Unit\n" +
      "export record S = { n: Int }\n" +
      "honor Maker<S> =\n    make(seed, k, use) = use(k)\n";
    expect(messages(source)).toEqual([pureInside("make", "the parameter `use`")]);
    expect(primaries(source)).toEqual(["make(seed, k, use) = use(k)"]);
  });
});

describe("Effects §13.2: invariant and phantom positions", () => {
  const CELLS = (element: string, arrow: string, extra: string, body: string) =>
    `constraint Runner<r> =\n    run(runner: r, cells: Array(${element})${extra}) ${arrow} Unit\n` +
    "export record Job = { id: Int }\n" +
    `honor Runner<Job> =\n    run(job, cells${extra === "" ? "" : ", action"}) = ${body}\n`;

  test("an invariant `->!` slot takes the contract's `->!`, so a body that reads an element is accepted", () => {
    expect(messages(CELLS("() ->! Unit", "->!", "", "ignore(Array.get(cells, 0))")))
      .toEqual([]);
  });

  test("an arrow inside a parameter is a constant, and the callback beside it is followed", () => {
    // Under a constructor an arrow is the constant it spells (§2.4): only
    // `action` has a colour, and the `>->` follows it.
    expect(messages(CELLS(
      "() ->! Unit",
      ">->",
      ", action: () ->! Unit",
      "action!()",
    ))).toEqual([]);
  });

  test("but an invariant `->` the body fixes to `->!` accepts less", () => {
    // The body did not perform an effect — it *demanded* one — and a constant
    // arrow inside a parameter the body fixes to the other constant is §13.2's
    // second row, at the pin.
    const source =
      "constraint Runner<r> =\n    run(runner: r, cells: Array(() -> Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() ->! Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells) = force(cells)\n";
    expect(messages(source)).toEqual([raisedInside("run", "the parameter `cells`")]);
    expect(primaries(source)).toEqual(["force(cells)"]);
  });

  test("and an invariant constant the body demands as written is accepted", () => {
    // `cells`'s arrow is the constant `->!` whatever the outer arrow is, and
    // `force` demands that constant.
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, cells: Array(() ->! Unit), action: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() ->! Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells, action) = force(cells)\n",
    )).toEqual([]);
  });

  test("a callback handed into an invariant `->` position fixes it to `->!`, forwarded or merged", () => {
    // A body that hands the contract's `->!` callback into an invariant `->`
    // position, by forwarding it and by merging it, joins the callback's colour
    // into that arrow. `k`'s own arrow still accepts what the contract hands
    // it; the first failing arrow in walk order is the one inside `cells`,
    // which the body can no longer take as pure (§13.2's second row).
    const FORWARD =
      "constraint Runner<r> =\n" +
      "    run(runner: r, k: () ->! Unit, cells: Array(() -> Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let take<a>(xs: Array(a), x: a): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, k, cells) = take(cells, k)\n";
    expect(messages(FORWARD))
      .toEqual([raisedInside("run", "the parameter `cells`")]);
    expect(primaries(FORWARD)).toEqual(["take(cells, k)"]);
    expect(labels(FORWARD)).toEqual([["the contract's failing arrow: \"->\""]]);
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
      .toEqual([raisedInside("run", "the parameter `cells`")]);
    expect(primaries(MERGE)).toEqual(["take(cells, f)"]);
    expect(labels(MERGE)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("and the same under a `>->` outer arrow", () => {
    // The failing arrow is the one inside `cells`, not the member's outer one,
    // so a header whose outer arrow follows its callbacks reports identically.
    const HEAD =
      "constraint Runner<r> =\n" +
      "    run(runner: r, a: () ->! Unit, k: () ->! Unit, " +
      "cells: Array(() -> Unit)) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "let take<a>(xs: Array(a), x: a): Unit = ()\n";
    const FORWARD = HEAD +
      "honor Runner<Job> =\n    run(job, a, k, cells) = take(cells, k)\n";
    expect(messages(FORWARD))
      .toEqual([raisedInside("run", "the parameter `cells`")]);
    expect(primaries(FORWARD)).toEqual(["take(cells, k)"]);
    const MERGE = HEAD +
      "honor Runner<Job> =\n" +
      "    run(job, a, k, cells) =\n" +
      "        let f = if c then k else (() => ())\n" +
      "        take(cells, f)\n";
    expect(messages(MERGE))
      .toEqual([raisedInside("run", "the parameter `cells`")]);
    expect(primaries(MERGE)).toEqual(["take(cells, f)"]);
    expect(labels(MERGE)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("an invariant constant narrowed the other way takes the same row", () => {
    expect(messages(
      "constraint Runner<r> =\n    run(runner: r, cells: Array(() ->! Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(fs: Array(() -> Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, cells) = force(cells)\n",
    )).toEqual([narrowerInside("run", "the parameter `cells`")]);
  });

  test("a phantom position is compared with nothing and pins nothing", () => {
    // The arrow under the unused `Tag` parameter is compared with nothing
    // (§13.2), the `>->` follows `action`, and a caller hands either colour.
    const PHANTOM =
      "export union Tag(a) = Plain | Marked\n" +
      "constraint Runner<r> =\n" +
      "    run(runner: r, tag: Tag(() ->! Unit), action: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, tag, action) = action!()\n";
    expect(messages(PHANTOM)).toEqual([]);
    expect(messages(PHANTOM + "export let pure(j: Job): Unit = j.run(Plain, () => ())\n"))
      .toEqual([]);
  });

  test("a phantom `->!` narrowed to `->` draws no report", () => {
    // Handed to a `Tag(() -> Unit)` demand, the `->!` under `Tag` would be the
    // accepts-less row's refusal were it compared. The analysis's unused point
    // erases it (§13.2), and nothing is what a value of `Tag` carries.
    expect(messages(
      "export union Tag(a) = Plain | Marked\n" +
      "constraint Runner<r> =\n    run(runner: r, tag: Tag(() ->! Unit)) -> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let force(t: Tag(() -> Unit)): Unit = ()\n" +
      "honor Runner<Job> =\n    run(job, tag) = force(tag)\n",
    )).toEqual([]);
  });

  test("and a `>->` over no callback but one inside a constructor is handed nothing", () => {
    // An arrow under a constructor is a constant, not a callback (§2.4), so the
    // outer `>->` follows nothing and takes §4.4's no-callbacks refusal.
    expect(messages(
      "export union Tag(a) = Plain | Marked\n" +
      "constraint Runner<r> =\n    run(runner: r, tag: Tag(() ->! Unit)) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, tag) = ()\n",
    )).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — " +
      "no callback of this signature has been handed over by the time this arrow runs; " +
      "write `->!` for a function that may touch the world, or `->` for one that does not",
    ]);
  });
});

describe("Constraints §4.7: a door wears the member's colour, and the listed members must agree", () => {
  const LINKED = "module Lib\n\n" +
    "export constraint R<a> =\n    run(s: a, n: Int, action: () ->! Unit) >-> Unit\n";
  const DOOR = "module Main\n\nimport Lib\n\nexport record P = { name: String }\n" +
    "widens Lib.run(s: P, n: BigInt, action: () ->! Unit): Unit =\n    action!()\n" +
    "honor Lib.R<P> =\n    run = widened\n";

  test("a door under a `>->` member shows a `>->` face over its callback", () => {
    // The door writes `:` and runs `action`, so its face is `>->` over the
    // `->!` callback, displayed undecorated (§10).
    const session = new AnalysisSession();
    session.setFile("/io.js", "");
    session.setFile("/lib.hex", LINKED);
    session.setFile("/main.hex", DOOR);
    expect(session.hover("/main.hex", DOOR.indexOf("run(s: P"))?.displayedType)
      .toBe("(P, BigInt, () ->! Unit) >-> Unit");
  });

  test("so a call through the door follows its callback", () => {
    const call = (mark: string, callback: string) =>
      DOOR + `export let through(p: P, cb: () ->! Unit): Unit = run${mark}(p, 2n, ${callback})\n`;
    expect(projectMessages([
      ["/lib.hex", LINKED],
      ["/main.hex", call("!", "cb")],
      ["/io.js", ""],
    ])).toEqual([]);
    expect(projectMessages([
      ["/lib.hex", LINKED],
      ["/main.hex", call("", "cb")],
      ["/io.js", ""],
    ])).toEqual([
      "this call may touch the world, so `run` wants `!`, not no mark",
    ]);
    // And a pure callback makes the call bare.
    expect(projectMessages([
      ["/lib.hex", LINKED],
      ["/main.hex", DOOR + "export let through(p: P): Unit = run(p, 2n, () => ())\n"],
      ["/io.js", ""],
    ])).toEqual([]);
  });

  test("a `Unit`-returning member admits a door at all (#887)", () => {
    // `Unit` is the empty tuple, and a door's seat check must recognise tuples
    // and functions for the door to reach its own seat.
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
    // The door's seat runs at the honor block, long after the door's own body
    // closed and with no frame of its own — and it still names the call the
    // writer must change.
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
    // The impure constant is **not** taken as the wider licence, and the body's
    // colour is not read either (Constraints §4.7).
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

  test("two `>->` members agree on their written arrows", () => {
    // Agreement is on the written arrows alone (Constraints §4.7): both write
    // `>->` over a `->!` `action`.
    expect(projectMessages([
      ["/lib.hex", "module Lib\n\nexport constraint P<a> =\n" +
        "    op(v: a, n: Int, action: () ->! Unit) >-> Unit\n"],
      ["/lib2.hex", "module Lib2\n\nexport constraint M<a> =\n" +
        "    op(v: a, n: Int, action: () ->! Unit) >-> Unit\n"],
      ["/main.hex", "module Main\n\nimport Lib\nimport Lib2\n\n" +
        "export record S = { n: Int }\n" +
        "widens Lib.op, Lib2.op(v: S, n: BigInt, action: () ->! Unit): Unit =\n" +
        "    action!()\n" +
        "honor Lib.P<S> =\n    op = widened\n" +
        "honor Lib2.M<S> =\n    op = widened\n"],
      ["/io.js", ""],
    ])).toEqual([]);
  });
});

describe("Effects §13.2: the freshening, and what the comparison leaves", () => {
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

  test("a closure that runs the callback carries its colour, through a chain", () => {
    // `inner` runs `action`, whose slot the seat fixes to the member's
    // callback colour, so the body's own colour is the callback's and the
    // marks read it.
    const chain = (mark: string) =>
      "constraint Runner<r> =\n    run(runner: r, action: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n" +
      "    run(job, action) =\n" +
      "        let inner = () => action!()\n" +
      `        inner${mark}()\n`;
    expect(messages(chain("!"))).toEqual([]);
    expect(messages(chain(""))).toEqual([
      "this call may touch the world, so `inner` wants `!`, not no mark",
    ]);
  });
});

/**
 * **A body colour that runs a callback is a dependency** (Effects §3.4; #885).
 * At a seat it may not be generalized: every use would instantiate a copy the
 * seat's comparison could not reach. Every case below is a body that calls two
 * things — the ordinary case, not a corner. The first is #865's shape: a body
 * running a `->!` callback under a `->` contract.
 */
describe("Effects §3.4: a body colour that runs a callback is a dependency, not a quantifier", () => {
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
    "    go(runner: r, a: () ->! Unit, b: () ->! Unit) >-> Unit\n";
  const IMPURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) ->! Unit\n";
  const BODY_3_4 = (lines: readonly string[]): string =>
    PURE_HEAD +
    "export record R = { id: Int }\n" +
    "honor C<R> =\n" +
    "    go(runner, b) =\n" +
    lines.map((line) => `        ${line}\n`).join("");

  test("a `fun` knot inside a seat is refused whichever call the `if` reaches first", () => {
    // `ping` and `pong` close together, so the body's own colour is joined into
    // a sibling's before the seat compares. Both orders, since swapping the two
    // calls must not flip the verdict.
    const first = KNOT(PURE_HEAD, "runner, b", "", "b!()", "pong(n - 1)");
    expect(messages(first)).toEqual([pureConflict("go", "b")]);
    expect(primaries(first)).toEqual(["b!()"]);
    expect(labels(first)).toEqual([["the contract's failing arrow: \"->\""]]);
    const second = KNOT(PURE_HEAD, "runner, b", "", "pong(n - 1)", "b!()");
    expect(messages(second)).toEqual([pureConflict("go", "b")]);
    // The offending call is the first in source order (§13.2): the sibling
    // `pong(n - 1)` carries `b`'s colour and stands earlier, so it is the
    // primary in this order.
    expect(primaries(second)).toEqual(["pong(n - 1)"]);
    expect(labels(second)).toEqual([["the contract's failing arrow: \"->\""]]);
  });

  test("and the same knot under a `>->` header follows `b`, in both orders", () => {
    // The `>->` is the join of `a`'s and `b`'s colours (§2.2), so a knot that
    // runs `b` does what it promises, and its calls wear `!`.
    expect(messages(KNOT(LINKED_HEAD, "runner, a, b", "!", "b!()", "pong!(n - 1)"))).toEqual([]);
    expect(messages(KNOT(LINKED_HEAD, "runner, a, b", "!", "pong!(n - 1)", "b!()"))).toEqual([]);
  });

  test("and under a `->!` header the knot is accepted, in both orders", () => {
    // The mirror image of the first case: the seat fixes `b`'s slot to the
    // member's colour, so a correctly written `ping!(2)` draws no report.
    expect(messages(KNOT(IMPURE_HEAD, "runner, b", "!", "b!()", "pong!(n - 1)")))
      .toEqual([]);
    expect(messages(KNOT(IMPURE_HEAD, "runner, b", "!", "pong!(n - 1)", "b!()")))
      .toEqual([]);
  });

  test("a helper that calls the handed callback and then a second callee", () => {
    // No knot needed: two ordinary local functions. The seat's refusal stands
    // at `b!()`, and nothing is said about `spare`, which is
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

  test("and a helper whose second callee is an inline lambda", () => {
    // `inner` runs `b` and then a lambda applied where it is written. `inner`'s
    // colour must stay a dependency through that join: quantified, every use of
    // `inner` would instantiate a copy the seat's comparison could not reach.
    const inline = BODY_3_4([
      "let inner(): Unit =",
      "    b!()",
      "    ignore(((n: Int) => n * 2)(runner.id))",
      "inner()",
    ]);
    expect(messages(inline)).toEqual([pureConflict("go", "b")]);
    expect(primaries(inline)).toEqual(["b!()"]);
    // The same with the lambda standing in a record field rather than applied
    // where it is written.
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

  test("and one local helper running the callback, under each outer arrow", () => {
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
    // Under `>->` the helper runs a callback the member is handed, which is
    // what the `>->` follows.
    expect(messages(helper(LINKED_HEAD, "runner, a, b", "!"))).toEqual([]);
    expect(messages(helper(IMPURE_HEAD, "runner, b", "!"))).toEqual([]);
  });

  test("a `->` slot merged with a pure lambda stays pure beside a `->!` callback", () => {
    // `f` merges `j`'s `->` slot with a pure lambda, so `f()` is bare; `k!()`
    // runs the `->!` callback beside it, and its colour never reaches `j`'s.
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
    // And in the other call order.
    expect(messages(merged("        k!()\n", "        f()\n"))).toEqual([]);
    // And with the merge written the other way round.
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

  test("and the same merged slot under a `>->` outer arrow", () => {
    expect(messages(
      "constraint Runner<r> =\n" +
      "    run(runner: r, j: () -> Unit, a: () ->! Unit) >-> Unit\n" +
      "export record Job = { id: Int }\n" +
      "let c: Bool = True\n" +
      "honor Runner<Job> =\n" +
      "    run(job, j, a) =\n" +
      "        let f = if c then j else (() => ())\n" +
      "        f()\n" +
      "        a!()\n",
    )).toEqual([]);
  });

  test("a merged slot the seat condemned draws no second report about its call", () => {
    // A failed seat holds back mark reports on the colours it condemned
    // (§13.2), and `f`'s colour is `k`'s through the merge: `f!()` draws
    // nothing beside the seat's one report.
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
    // Without the redirect the header would lose its result type, and the
    // parser's `Invalid` placeholder would leak into the resolver and back out
    // at the member name.
    const source = "constraint C<a> =\n    m(x: a) => String\n";
    expect(messages(source)).toEqual([
      "Hexagon's type arrows are `->`, `->!`, `>->`; `=>` is the lambda arrow " +
      "— for a function type write `Int -> Int` (or `->!` / `>->` for its colour)",
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
 * **A failed seat holds back mark reports on the colours it condemned** —
 * including those of the local helpers that carry them — and **its report
 * stands at the first offending call in source order** (Effects §13.2). Beside
 * them: **a named local function defaults at its own generalization**, as
 * §3.4 says and as it does outside a seat, so a pure helper is no offending
 * call and keeps its own mark report.
 */
describe("Effects §13.2: a failed seat's held-back marks, and where its report stands", () => {
  const PURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n";
  const IMPURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) ->! Unit\n";
  const LINKED_HEAD = "constraint C<r> =\n" +
    "    go(runner: r, a: () ->! Unit, b: () ->! Unit) >-> Unit\n";
  const BODY = (head: string, args: string, lines: readonly string[]): string =>
    head +
    "record R = { id: Int }\n" +
    "honor C<R> =\n" +
    `    go(${args}) =\n` +
    lines.map((line) => `        ${line}\n`).join("");

  test("a failed seat says nothing about the helpers that carry its condemned colour", () => {
    // `one` runs the handed callback and `two` calls `one`, so both carry the
    // colour the seat condemned, and a mark read off either is no ground for a
    // correction: the bare `two()` draws no report beside the seat's one.
    const source = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two()",
    ]);
    expect(messages(source)).toEqual([pureConflict("go", "b")]);
    expect(primaries(source)).toEqual(["b!()"]);
    expect(labels(source)).toEqual([["the contract's failing arrow: \"->\""]]);
    // No fixit either: the whole mark report is held back, not its sentence
    // alone.
    expect(fixes(source)).toEqual([]);
  });

  test("and under a `>->` outer arrow the same helpers follow `b`", () => {
    // The `>->` is the join of `a`'s and `b`'s colours, so helpers that run
    // `b` do what it promises, and every call on them wears `!`.
    expect(messages(BODY(LINKED_HEAD, "runner, a, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two!()",
    ]))).toEqual([]);
  });

  test("and the marks stay held back inside a `fun` knot", () => {
    // `ping`'s colour is joined into `pong`'s, and both carry the colour the
    // seat condemned. These are the knot programs above with the marks the
    // writer would have written: no mark report, and no fixit deleting a `!`
    // from a genuinely impure call.
    const KNOT = (head: string, args: string, first: string, second: string) =>
      head +
      "record R = { id: Int }\n" +
      "honor C<R> =\n" +
      `    go(${args}) =\n` +
      "        fun\n" +
      `            ping(n: Int): Unit = if n == 0 then ${first} else ${second}\n` +
      "            pong(n: Int): Unit = ping!(n)\n" +
      "        ping!(2)\n";
    for (const [source, primary] of [
      [KNOT(PURE_HEAD, "runner, b", "b!()", "pong!(n - 1)"), "b!()"],
      [KNOT(PURE_HEAD, "runner, b", "pong!(n - 1)", "b!()"), "pong!(n - 1)"],
    ] as const) {
      expect(messages(source)).toEqual([pureConflict("go", "b")]);
      // The first offending call in source order (§13.2).
      expect(primaries(source)).toEqual([primary]);
      // No deletion offered against `ping!` or `pong!`.
      expect(fixes(source)).toEqual([]);
    }
    // Under a `>->` outer arrow the knot follows `b`: accepted, marks as written.
    for (const source of [
      KNOT(LINKED_HEAD, "runner, a, b", "b!()", "pong!(n - 1)"),
      KNOT(LINKED_HEAD, "runner, a, b", "pong!(n - 1)", "b!()"),
    ]) {
      expect(messages(source)).toEqual([]);
    }
  });

  test("and a helper that calls past a pin carries the condemned colour too", () => {
    // `let p` pins `one`'s colour, and so `b`'s, pure: the accepts-less row, at
    // the annotation. `two` calls `one` after the pin, and its mark draws no
    // report and no fixit.
    const twoLocals = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let p: () -> Unit = one",
      "let two(): Unit = one()",
      "two!()",
    ]);
    expect(messages(twoLocals)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(twoLocals)).toEqual(["() -> Unit"]);
    expect(fixes(twoLocals)).toEqual([]);
    // And a knot past the pin.
    const knot = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let p: () -> Unit = one",
      "fun",
      "    ping(n: Int): Unit = if n == 0 then one() else pong!(n - 1)",
      "    pong(n: Int): Unit = ping!(n)",
      "ping!(2)",
    ]);
    expect(messages(knot)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(knot)).toEqual(["() -> Unit"]);
    expect(fixes(knot)).toEqual([]);
    // With the pin written after `two`: the same one report and no fixit, so
    // source order decides nothing here.
    const flipped = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one()",
      "let p: () -> Unit = one",
      "two!()",
    ]);
    expect(messages(flipped)).toEqual([narrowerAcceptance("go", "b")]);
    expect(fixes(flipped)).toEqual([]);
    // Repair the seat instead, and every mark here is one the program needs.
    const repaired = BODY(IMPURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two!()",
    ]);
    expect(messages(repaired)).toEqual([]);
  });

  test("and the two-locals and lambda shapes in the marked spelling too", () => {
    // The same question of the shapes that do not knot: a chain of two named
    // locals, and a lambda that runs `b`. Both are marked as the writer
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

  test("a helper that carries no condemned colour keeps its own mark report", () => {
    // `quiet` calls nothing, so it carries no colour the seat condemned, and
    // §4.1 speaks about it as it would anywhere.
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
    // The body's defaulting still runs at a failed seat (§13.2), so holding the
    // marks back buys one compile, never silence. Repaired by respelling the
    // member `->!`, `two()` is a bare call on an impure helper.
    const respelled = BODY(IMPURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let two(): Unit = one!()",
      "two()",
    ]);
    expect(messages(respelled)).toEqual([
      "this call may touch the world, so `two` wants `!`, not no mark",
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

  test("the report stands at the call on the callback, not a pure local called earlier", () => {
    // `spare` is pure, so `spare()` is no offending call whichever side of
    // `b!()` it stands on.
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

  test("a call on an alias of the callback is the offending call", () => {
    // `let k = b` makes `k` the callback as surely as `b` is, so `k!()` is the
    // offending call, not the pure `spare()` before it.
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

  test("a call inside a helper the body never calls is no offending call", () => {
    // `c!()` stands earlier, but only inside `unused`, which the body never
    // calls, so it carries nothing to the outer arrow.
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
    // As §3.4 says: `spare`'s colour defaults pure at its own close, so it is
    // never joined to the body's own and its call stays bare.
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

  test("and under a `>->` header the seat's answer is the answer outside one", () => {
    // The same two locals under a `>->` outer arrow. `spare` runs nothing, so
    // its colour defaults pure whatever the callbacks (§3.4): its call is bare,
    // inside the seat exactly as outside one, and a `!` on it is a mark on a
    // pure call.
    const LINKED_ONLY = "constraint C<r> =\n    go(runner: r, a: () ->! Unit) >-> Unit\n";
    for (const keyword of ["let", "fun"]) {
      expect(messages(BODY(LINKED_ONLY, "runner, a", [
        `${keyword} spare(): Unit = ()`,
        "spare()",
        "a!()",
      ]))).toEqual([]);
    }
    const inSeat = messages(BODY(LINKED_ONLY, "runner, a", [
      "let spare(): Unit = ()",
      "spare!()",
      "a!()",
    ]));
    const outside = messages(
      "let outer(a: () ->! Unit): Unit =\n" +
      "    let spare(): Unit = ()\n" +
      "    spare!()\n" +
      "    a!()\n",
    );
    expect(inSeat).toEqual(outside);
    expect(inSeat).toEqual(["this call is pure, so `spare` wants no mark, not `!`"]);
  });
});

/**
 * **A callback narrowed through a helper is narrowed.** A `->` demand or
 * annotation on a function that runs the callback pins the callback's colour
 * pure, and the seat refuses it at the pin — the same row and the same
 * sentence as a pin on the callback itself (Effects §13.2). `force(() => b!())`
 * is refused exactly as `force(b)` is; accepted, it would run the effect behind
 * a pure contract (#865).
 */
describe("Effects §13.2: a callback narrowed through a helper", () => {
  const PURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n";
  const IMPURE_HEAD = "constraint C<r> =\n    go(runner: r, b: () ->! Unit) ->! Unit\n";
  const LINKED_HEAD = "constraint C<r> =\n" +
    "    go(runner: r, a: () ->! Unit, b: () ->! Unit) >-> Unit\n";
  const LINKED_ONLY = "constraint C<r> =\n    go(runner: r, a: () ->! Unit) >-> Unit\n";
  const PURE_CALLBACK = "constraint C<r> =\n    go(runner: r, b: () -> Unit) -> Unit\n";
  const BODY = (head: string, args: string, lines: readonly string[]): string =>
    head +
    "record R = { id: Int }\n" +
    "honor C<R> =\n" +
    `    go(${args}) =\n` +
    lines.map((line) => `        ${line}\n`).join("");
  /** A `->` demand, which a lambda running the callback is handed to. */
  const FORCE = "let force(f: () -> Unit): Unit = f()\n";

  test("an annotation on a helper that runs the callback narrows it", () => {
    // `one` runs `b`, so `let p: () -> Unit = one` pins `b`'s colour pure.
    const lines = [
      "let one(): Unit = b!()",
      "let p: () -> Unit = one",
      "one()",
    ];
    for (const [head, args] of [
      [PURE_HEAD, "runner, b"],
      [IMPURE_HEAD, "runner, b"],
      [LINKED_HEAD, "runner, a, b"],
    ] as const) {
      const source = BODY(head, args, head === LINKED_HEAD ? [...lines, "a!()"] : lines);
      expect(messages(source)).toEqual([narrowerAcceptance("go", "b")]);
      // §13.2 reports at the pin, and the pin here is the annotation, not the
      // call and not the seat.
      expect(primaries(source)).toEqual(["() -> Unit"]);
    }
  });

  test("without the pin the same body does more than its contract permits", () => {
    // Delete the annotation and the seat refuses at `b!()` in the does-more
    // row. The pin is what moves the report, and adding one never silences it.
    const source = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "one()",
    ]);
    expect(messages(source)).toEqual([pureConflict("go", "b")]);
    expect(primaries(source)).toEqual(["b!()"]);
  });

  test("a `->` demand met by a lambda that runs the callback narrows it as the callback does", () => {
    // `force(() => b!())` hands a function that runs `b` to the same demand as
    // `force(b)`, and is refused in the same words.
    const handed = FORCE + BODY(PURE_HEAD, "runner, b", ["force(b)"]);
    const conducted = FORCE + BODY(PURE_HEAD, "runner, b", ["force(() => b!())"]);
    expect(messages(conducted)).toEqual(messages(handed));
    expect(messages(conducted)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(conducted)).toEqual(["force(() => b!())"]);
    expect(primaries(handed)).toEqual(["force(b)"]);
  });

  test("and through a named local, a `fun`, and a second helper beyond it", () => {
    // The helper's spelling is immaterial: what it carries is `b`'s colour.
    for (const lines of [
      ["let g = () => b!()", "force(g)"],
      ["let g(): Unit = b!()", "force(g)"],
      ["fun g(): Unit = b!()", "force(g)"],
      ["let mid(): Unit = b!()", "force(() => mid!())"],
    ]) {
      const source = FORCE + BODY(PURE_HEAD, "runner, b", lines);
      expect(messages(source)).toEqual([narrowerAcceptance("go", "b")]);
    }
  });

  test("and through an alias of the helper, and an annotation on the alias", () => {
    // `let k = one` is `one`, and the annotation on `k` is the pin. An alias of
    // the callback itself, `let k = b` annotated directly, reports identically.
    const throughAlias = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let k = one",
      "let p: () -> Unit = k",
      "one()",
    ]);
    const onTheSlot = BODY(PURE_HEAD, "runner, b", [
      "let k = b",
      "let p: () -> Unit = k",
      "()",
    ]);
    expect(messages(throughAlias)).toEqual([narrowerAcceptance("go", "b")]);
    expect(messages(onTheSlot)).toEqual(messages(throughAlias));
    expect(primaries(throughAlias)).toEqual(["() -> Unit"]);
  });

  test("and through a collection element and a record field", () => {
    // The annotation need not stand on a function binding at all: what it
    // narrows is the colour, wherever the writer spelled `->` over it.
    const inVector = BODY(PURE_HEAD, "runner, b", [
      "let handlers: Vector(() -> Unit) = [() => b!()]",
      "ignore(handlers)",
    ]);
    expect(messages(inVector)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(inVector)).toEqual(["Vector(() -> Unit)"]);
    const inField = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let box: { f: () -> Unit } = { f = one }",
      "ignore(box)",
    ]);
    expect(messages(inField)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(inField)).toEqual(["{ f: () -> Unit }"]);
  });

  test("under a `>->` outer arrow, a callback narrowed through a helper takes the same row", () => {
    // The failing arrow is `a`'s own `->!`, not the outer `>->`, so the report
    // is the same accepts-less row, at the pin.
    const viaHelper = BODY(LINKED_ONLY, "runner, a", [
      "let one(): Unit = a!()",
      "let p: () -> Unit = one",
      "one()",
    ]);
    expect(messages(viaHelper)).toEqual([narrowerAcceptance("go", "a")]);
    expect(primaries(viaHelper)).toEqual(["() -> Unit"]);
    const viaDemand = FORCE + BODY(LINKED_ONLY, "runner, a", ["force(() => a!())"]);
    expect(messages(viaDemand)).toEqual([narrowerAcceptance("go", "a")]);
    expect(primaries(viaDemand)).toEqual(["force(() => a!())"]);
  });

  test("a `->` callback narrowed is accepted: the floor is the bottom", () => {
    // The rule is one-directional, and this is the side that must not move. A
    // contract that promises only a pure callback places no floor to violate,
    // so handing a function that runs it to a `->` demand is exactly what it
    // promised.
    expect(messages(FORCE + BODY(PURE_CALLBACK, "runner, b", ["force(() => b())"])))
      .toEqual([]);
    expect(messages(BODY(PURE_CALLBACK, "runner, b", [
      "let one(): Unit = b()",
      "let p: () -> Unit = one",
      "one()",
    ]))).toEqual([]);
  });

  test("and a helper that is not pinned is accepted under a `->!` header", () => {
    // Nothing here pins `b`'s colour, so the seat fixes `b`'s slot to the
    // member's colour and the helper's own call wears `!`.
    expect(messages(BODY(IMPURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "one!()",
    ]))).toEqual([]);
    // Under a `>->` header the same body is accepted too: the helper runs `b`,
    // a callback the member is handed, which the `>->` follows.
    expect(messages(BODY(LINKED_HEAD, "runner, a, b", [
      "let one(): Unit = b!()",
      "one!()",
    ]))).toEqual([]);
  });

  test("the refusal is the seat's one report, with no deletion fixit beside it", () => {
    // Here the pin has already made the helpers' colour pure when the seat
    // rules. The helpers still carry the colour the seat condemned, so their
    // marks draw no "wants no mark" report and no fixit deleting a `!` from a
    // genuinely impure call.
    const knot = BODY(PURE_HEAD, "runner, b", [
      "let force(f: (Int) -> Unit): Unit = f(0)",
      "fun",
      "    ping(n: Int): Unit = if n == 0 then b!() else pong!(n - 1)",
      "    pong(n: Int): Unit = ping!(n)",
      "force(ping)",
      "ping!(2)",
    ]);
    expect(messages(knot)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(knot)).toEqual(["force(ping)"]);
    expect(fixes(knot)).toEqual([]);
    const twoLocals = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let p: () -> Unit = one",
      "one!()",
    ]);
    expect(messages(twoLocals)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(twoLocals)).toEqual(["() -> Unit"]);
    expect(fixes(twoLocals)).toEqual([]);
  });

  test("and the pin is taken from THIS callback's helpers, never another's", () => {
    // Two `->!` callbacks, each with its own chain of helpers and its own
    // annotations. `b` is first in walk order, so the report is about `b` and
    // stands at `let p`, its own pin — not at `let r2` on `c`'s chain, though
    // `r2` is written first. The two chains are spelled at different arities
    // so the primary's own text says which one it stands on.
    const source =
      "constraint C<r> =\n" +
      "    go(runner: r, b: () ->! Unit, c: (Int) ->! Unit) -> Unit\n" +
      "record R = { id: Int }\n" +
      "honor C<R> =\n    go(runner, b, c) =\n" +
      "        let two(n: Int): Unit = c!(n)\n" +
      "        let three(n: Int): Unit = two(n)\n" +
      "        let r2: (Int) -> Unit = three\n" +
      "        let q: (Int) -> Unit = two\n" +
      "        let one(): Unit = b!()\n" +
      "        let p: () -> Unit = one\n" +
      "        one()\n" +
      "        three(0)\n";
    expect(messages(source)).toEqual([narrowerAcceptance("go", "b")]);
    expect(primaries(source)).toEqual(["() -> Unit"]);
  });

  test("a body-local `let` annotation and the member's own annotation take the one row", () => {
    // §9's second seat row has one sentence however the callback was narrowed:
    // a demand, a body-local annotation, or the member's own annotation on the
    // parameter. Each stands at its pin.
    const demanded = BODY(PURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let p: () -> Unit = one",
      "one()",
    ]);
    expect(messages(demanded)).toEqual([narrowerAcceptance("go", "b")]);
    const annotated = PURE_HEAD +
      "record R = { id: Int }\n" +
      "honor C<R> =\n    go(runner, b: () -> Unit) = ()\n";
    expect(messages(annotated)).toEqual([narrowerAcceptance("go", "b")]);
  });

  test("where two pins qualify, the first in source order is the one named", () => {
    // The report stands at the pin, the first in source order (§13.2). Both
    // helpers run `b` and both are annotated, so both pins narrow it; the
    // report names one.
    const pins = (first: string, second: string) =>
      BODY(PURE_HEAD, "runner, b", [
        "let one(): Unit = b!()",
        "let two(n: Int): Unit = one()",
        first,
        second,
        "two(0)",
      ]);
    const onFirst = pins("let p: () -> Unit = one", "let q: (Int) -> Unit = two");
    const onSecond = pins("let q: (Int) -> Unit = two", "let p: () -> Unit = one");
    expect(messages(onFirst)).toEqual([narrowerAcceptance("go", "b")]);
    expect(messages(onSecond)).toEqual(messages(onFirst));
    // Written order, not walk order.
    expect(primaries(onFirst)).toEqual(["() -> Unit"]);
    expect(primaries(onSecond)).toEqual(["(Int) -> Unit"]);
  });

  test("a `->!` annotation on a helper narrows nothing", () => {
    // A helper annotated `->!` accepts exactly what the contract's `->!`
    // callback promises, so nothing is narrowed.
    expect(messages(BODY(IMPURE_HEAD, "runner, b", [
      "let one(): Unit = b!()",
      "let p: () ->! Unit = one",
      "one!()",
    ]))).toEqual([]);
  });

  test("a helper that carries no condemned colour still keeps its own mark report", () => {
    // `quiet` runs nothing, so its colour is no colour the seat condemned and
    // its error is its own.
    const source = BODY(PURE_HEAD, "runner, b", [
      "let quiet(): Unit = ()",
      "let one(): Unit = b!()",
      "let p: () -> Unit = one",
      "quiet!()",
      "one()",
    ]);
    expect(messages(source)).toEqual([
      narrowerAcceptance("go", "b"),
      "this call is pure, so `quiet` wants no mark, not `!`",
    ]);
  });

  test("#865's executable witness no longer compiles, and its repair runs once", async () => {
    // Accepted, this program would run `readIt` behind the `->` contract. It
    // is refused, so it never runs; the member written `->!`, which is the
    // row's own advice, both compiles and performs the effect exactly once.
    const io =
      "let reads = 0;\n" +
      "export function readIt(path) { reads += 1; return path; }\n" +
      "export function readCount() { return reads; }\n";
    const program = (arrow: string, body: readonly string[]) => [
      ["/main.hex",
        "module Main\n\n" +
        'extern from "./io.js"\n' +
        "    export fun readIt(path: String) ->! String\n" +
        "    export fun readCount() ->! Int\n\n" +
        "constraint Runner<r> =\n" +
        `    run(runner: r, action: () ->! Unit) ${arrow} Unit\n\n` +
        "record Job = { id: Int }\n\n" +
        "honor Runner<Job> =\n" +
        "    run(job, action) =\n" +
        body.map((line) => `        ${line}\n`).join("") +
        '\nlet world(): Unit = ignore(readIt!("x"))\n\n' +
        "let job: Job = Job({ id = 1 })\n\n" +
        "export let count(): Int =\n" +
        `    run${arrow === "->" ? "" : "!"}(job, () => world!())\n` +
        "    readCount!()\n"],
      ["/io.js", io],
    ] as const;
    const laundered = program("->", [
      "let one(): Unit = action!()",
      "let p: () -> Unit = one",
      "one()",
    ]);
    expect(projectMessages(laundered))
      .toEqual([narrowerAcceptance("run", "action")]);
    const honest = program("->!", ["action!()"]);
    expect(projectMessages(honest)).toEqual([]);
    const linked = `data:text/javascript;charset=utf-8,${encodeURIComponent(io)}`;
    const exports_ = await runProject([...honest], {
      transform: (_path, javascript) =>
        javascript.replaceAll('"./io.js"', JSON.stringify(linked)),
    });
    expect((exports_["count"] as () => number)()).toBe(1);
  });
});

describe("Effects §13.2: a merge with a pure function, in either branch order", () => {
  /**
   * A pure function merged with a handed callback, in either branch order and
   * in each of its three spellings, meets it as an opening (§3.4): it fixes
   * nothing, so the verdict, the sentence and the placement are the ones the
   * callback alone would draw.
   */
  /** The three spellings of the pure side, and the binding each needs above it. */
  const SPELLINGS = [
    ["spare", ""],
    ["(() => ())", ""],
    ["g", "        let g = () => ()\n"],
  ] as const;

  /** Both written orders of one merge — the slot first, and the pure arm first. */
  const orders = (slot: string, other: string): readonly string[] => [
    `if c then ${slot} else ${other}`,
    `if c then ${other} else ${slot}`,
  ];

  test("the three spellings coincide in both branch orders, at the OUTER arrow", () => {
    // The call `f()` runs the merged callback under the outer `->`: the one
    // row, at that call.
    const outer = (merge: string, bind: string) =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" + bind +
      `        let f = ${merge}\n` +
      "        f()\n";
    for (const [other, bind] of SPELLINGS) {
      for (const merge of orders("b", other)) {
        const seat = seen(outer(merge, bind));
        expect(seat.messages).toEqual([pureConflict("go", "b")]);
        expect(seat.primaries).toEqual(["f()"]);
        expect(seat.labels).toEqual([['the contract\'s failing arrow: "->"']]);
      }
    }
  });

  test("the three spellings coincide in both branch orders, at a NESTED arrow", () => {
    // The failing `->` is the one the contract **returns**, not the member's
    // own outer one. No call carries the colour, so the report stands at the
    // merge that hands the function back.
    const nested = (merge: string, bind: string) =>
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() -> Unit)\n" +
      "export record S = { n: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor Maker<S> =\n    make(seed, k) =\n" + bind + `        ${merge}\n`;
    for (const [other, bind] of SPELLINGS) {
      for (const merge of orders("k", other)) {
        const seat = seen(nested(merge, bind));
        expect(seat.messages).toEqual([pureReturns("make")]);
        expect(seat.primaries).toEqual([merge]);
        expect(seat.labels).toEqual([['the contract\'s failing arrow: "->"']]);
      }
    }
  });

  test("the three spellings coincide in both branch orders, with the merge on a HELPER", () => {
    // One step further out: the merge meets a **helper** that runs `b`; the
    // report stands at `b!()`, the first offending call in source order.
    const conductor = (merge: string, bind: string) =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" +
      "        let one(): Unit = b!()\n" + bind +
      `        let f = ${merge}\n` +
      "        ignore(f)\n" +
      "        one()\n";
    for (const [other, bind] of SPELLINGS) {
      for (const merge of orders("one", other)) {
        const seat = seen(conductor(merge, bind));
        expect(seat.messages).toEqual([pureConflict("go", "b")]);
        expect(seat.primaries).toEqual(["b!()"]);
        expect(seat.labels).toEqual([['the contract\'s failing arrow: "->"']]);
      }
    }
  });

  test("and every spelling is accepted alike, in both branch orders (#1119)", () => {
    // Where the contract returns `->!`, the named, the `let`-bound, and the
    // inline spellings are all accepted: a pure function fits wherever a
    // function is expected, and fixes nothing it meets, whichever branch is
    // first.
    const alone = (merge: string, bind: string) =>
      "constraint Maker<a> =\n    make(seed: a, k: () ->! Unit) -> (() ->! Unit)\n" +
      "export record S = { n: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor Maker<S> =\n    make(seed, k) =\n" + bind + `        ${merge}\n`;
    for (const [other, bind] of SPELLINGS) {
      for (const merge of orders("k", other)) {
        expect([merge, messages(alone(merge, bind))]).toEqual([merge, []]);
      }
    }
  });

  test("under a `>->` header, a merge runs the callback and a pin narrows it", () => {
    // A pure function merged with `a` fixes nothing, so the call on the merge
    // runs `a` and wears `!`; an annotation that narrows `a` is the one report,
    // at the annotation, never at `b!()`, which runs `b` correctly.
    const linked = (merge: string) =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit, a: () ->! Unit) >-> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b, a) =\n" +
      `        let f = ${merge}\n` +
      "        f()\n" +
      "        b!()\n";
    // A pure function merged in fixes nothing (#1119): the call on the merge
    // runs `a`.
    for (const merge of orders("a", "spare")) {
      const source = linked(merge);
      expect(messages(source)).toEqual([
        "this call may touch the world, so `f` wants `!`, not no mark",
      ]);
      expect(messages(source.replace("        f()\n", "        f!()\n"))).toEqual([]);
    }
    // An annotation that narrows `a`: the refusal stands at the annotation,
    // never at `b!()`.
    const pinned =
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit, a: () ->! Unit) >-> Unit\n" +
      "record R = { id: Int }\n" +
      "honor C<R> =\n    go(runner, b, a) =\n        let f: () -> Unit = a\n        f()\n        b!()\n";
    expect(messages(pinned)).toHaveLength(1);
    expect(primaries(pinned)).toEqual(["() -> Unit"]);
    // The same body calling both callbacks directly is accepted.
    expect(messages(
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit, a: () ->! Unit) >-> Unit\n" +
      "record R = { id: Int }\n" +
      "honor C<R> =\n    go(runner, b, a) =\n        a!()\n        b!()\n",
    )).toEqual([]);
  });
});

describe("Effects §13.2: each callback's own merge and pin", () => {
  /**
   * Each callback is a colour of its own (§2.4), so a merge or a pin on one
   * never moves the report about another: the seat asks each arrow its own
   * question (§13.2).
   */

  const TWO = (lines: readonly string[]) =>
    "constraint C<r> =\n    go(runner: r, b: () ->! Unit, j: () -> Unit) -> Unit\n" +
    "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
    "honor C<R> =\n    go(runner, b, j) =\n" +
    lines.map((line) => `        ${line}\n`).join("");

  test("an unrelated merge does not move the report about an annotation's narrowing", () => {
    // A merge of `j` with a pure function stands above the annotation that
    // narrows `b`. It fixes nothing about `b`, so the report stands at the
    // annotation, exactly as it does without the merge.
    const withMerge = TWO([
      "let m = if c then j else spare",
      "ignore(m)",
      "let p: () -> Unit = b",
      "ignore(p)",
    ]);
    const without = TWO(["let p: () -> Unit = b", "ignore(p)"]);
    for (const source of [withMerge, without]) {
      expect(messages(source)).toEqual([narrowerAcceptance("go", "b")]);
      expect(primaries(source)).toEqual(["() -> Unit"]);
      expect(labels(source)).toEqual([['the contract\'s failing arrow: "->!"']]);
    }
  });

  test("and it does not change the ROW when the narrowed alias is called", () => {
    // With `p()` beside the pin, the report is still the accepts-less row at
    // the annotation, since `let p: () -> Unit = b` narrows `b`; advice to
    // write `->!` on the member would be a wrong repair. The merge lines have
    // nothing to do with `b`.
    const withMerge = TWO([
      "let m = if c then j else spare",
      "ignore(m)",
      "let p: () -> Unit = b",
      "p()",
    ]);
    const without = TWO(["let p: () -> Unit = b", "p()"]);
    for (const source of [withMerge, without]) {
      expect(messages(source)).toEqual([narrowerAcceptance("go", "b")]);
      expect(primaries(source)).toEqual(["() -> Unit"]);
    }
  });

  const PAIR = (result: string, lines: readonly string[]) =>
    `constraint C<r> =\n    go(runner: r, d: () ->${result} Unit, b: () ->! Unit) ->! (() -> Unit)\n` +
    "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
    "honor C<R> =\n    go(runner, d, b) =\n" +
    lines.map((line) => `        ${line}\n`).join("");

  test("two callbacks each merged with a pure function: each keeps its own colour", () => {
    // `d` and `b` are each merged with `spare`, separately.
    const merges = [
      "let f = if c then d else spare",
      "let g = if c then b else spare",
    ] as const;
    // The pure function fits each slot and narrows neither (#1119), so the
    // body with no call is accepted in either order.
    for (const [first, second] of [merges, [merges[1], merges[0]]] as const) {
      const source = PAIR("!", [first, second, "ignore(f)", "ignore(g)", "() => ()"]);
      expect(messages(source)).toEqual([]);
    }
    // And with a **call** on one of the two: `d` narrows nothing, so the one
    // failure is `b`'s own, its call under the returned pure arrow.
    const called = PAIR("!", [...merges, "ignore(f)", "() => g()"]);
    expect(messages(called)).toEqual([pureReturns("go")]);
    expect(primaries(called)).toEqual(["g()"]);
    expect(labels(called)).toEqual([['the contract\'s failing arrow: "->"']]);
  });

  test("and with the other callback written `->`, the report is still `b`'s", () => {
    // With `d` written `->` there is one failing callback, `b`, and the report
    // stands at its call.
    const source = PAIR("", [
      "let f = if c then d else spare",
      "let g = if c then b else spare",
      "ignore(f)",
      "() => g()",
    ]);
    expect(messages(source)).toEqual([pureReturns("go")]);
    expect(primaries(source)).toEqual(["g()"]);
    expect(labels(source)).toEqual([['the contract\'s failing arrow: "->"']]);
  });

});

/**
 * **Every merging expression, in every spelling of its pure side** (Effects
 * §13.2, §3.4). An `if`, a `match`, a value carrying both, a `catch` arm and a
 * `var`'s re-assignment each join a handed callback with a pure function, and
 * the pure side is an opening that fixes nothing: in both orders and all three
 * spellings, the report is the one row, at the call under the contract's `->`,
 * relating the contract's failing arrow. **A merging expression added to the
 * language is added here**, and the row it adds must agree with every other row.
 */
describe("Effects §13.2: every merging expression, spelled three ways, in both orders", () => {
  /**
   * The three spellings of the pure side. `bind` is what has to stand above
   * the merge for the spelling to exist at all.
   */
  const SPELLINGS = [
    { name: "a named function", pure: "spare", bind: "" },
    { name: "an inline lambda", pure: "(() => ())", bind: "" },
    { name: "a `let`-bound lambda", pure: "g", bind: "        let g = () => ()\n" },
  ] as const;

  /**
   * **The merging expressions.** `join` is the expression that does the joining.
   * `after` is what the body does with the joined value — it is handed the
   * merge and, for the forms that need it, the two joined spellings — and
   * `call` is the primary the report must take.
   *
   * `before` is a report the *language* makes about the program before the seat
   * says anything: the function-typed `var` row below is refused by Statements
   * §6.1 whatever a seat thinks of it, and the row exists to hold the seat's
   * report steady beside that refusal rather than to claim the program is
   * otherwise legal.
   */
  interface MergeForm {
    readonly name: string;
    readonly join: (first: string, second: string) => string;
    readonly after: (join: string, first: string, second: string) => string;
    readonly call: string;
    readonly before?: readonly {
      readonly message: string;
      readonly primary: string;
      readonly labels: readonly string[];
    }[];
  }

  const FORMS: readonly MergeForm[] = [
    {
      name: "an `if`",
      join: (first: string, second: string) => `if c then ${first} else ${second}`,
      after: (join: string) => `        let f = ${join}\n        f()\n`,
      call: "f()",
    },
    {
      name: "a `match`, the slot in one arm and a pure function in the others",
      join: (first: string, second: string) =>
        `match t\n            A => ${first}\n            B => spare\n            Z => ${second}`,
      after: (join: string) => `        let f = ${join}\n        f()\n`,
      call: "f()",
    },
    {
      name: "a record field",
      join: (first: string, second: string) =>
        `if c then { cb = ${first} } else { cb = ${second} }`,
      after: (join: string) => `        let z = ${join}\n        z.cb()\n`,
      call: "z.cb()",
    },
    {
      name: "a tuple element",
      join: (first: string, second: string) =>
        `if c then (${first}, 1) else (${second}, 2)`,
      after: (join: string) =>
        `        let (q, n) = ${join}\n        ignore(n)\n        q()\n`,
      call: "q()",
    },
    {
      name: "a vector element",
      join: (first: string, second: string) => `[${first}, ${second}]`,
      after: (join: string) =>
        `        let v = ${join}\n        match Vector.get(v, 0)\n` +
        "            Some(u) => u()\n            None => ()\n",
      call: "u()",
    },
    {
      name: "a `catch` arm",
      join: (first: string, second: string) =>
        `try\n                ${first}\n            catch\n                Boom(n) =>\n` +
        `                    ignore(n)\n                    ${second}`,
      after: (join: string) => `        let f =\n            ${join}\n        f()\n`,
      call: "f()",
    },
    // **The `var` rows** *(Effects §13.2)*. A `var` has one
    // monotype, and the assigned value's type is unified with it: two function
    // colours meeting there are joined exactly as an `if`'s branches join
    // theirs, through the **shared static type** — the variable's monotype says
    // nothing about which assignment a run performs, and no runtime value
    // retains both. So the merge is the assignment, and every column of this
    // table reads the same as the `if` row's.
    {
      name: "a `var` of record type, re-assigned",
      join: (_first: string, second: string) => `z := { cb = ${second} }`,
      after: (join: string, first: string) =>
        `        var z = { cb = ${first} }\n        ${join}\n        z.cb()\n`,
      call: "z.cb()",
    },
    {
      name: "a `var` of vector type, re-assigned",
      join: (_first: string, second: string) => `v := [${second}]`,
      after: (join: string, first: string) =>
        `        var v = [${first}]\n        ${join}\n` +
        "        match Vector.get(v, 0)\n" +
        "            Some(u) => u()\n            None => ()\n",
      call: "u()",
    },
    {
      // The join at the **outermost** arrow, with no composite between the
      // colours and the variable's own type. Statements §6.1 bans a
      // function-typed `var` outright, so this form is never a legal program —
      // but the ban is a separate refusal at the binding, the assignment still
      // unifies the two arrows, and the seat's report must be the same row,
      // sentence, primary and related locations the other forms take. Recorded
      // as a row rather than left out, because leaving it out would be the
      // enumeration claiming a form the grammar admits does not exist.
      name: "a `var` of function type, re-assigned (refused by Statements §6.1)",
      join: (_first: string, second: string) => `f := ${second}`,
      after: (join: string, first: string) =>
        `        var f = ${first}\n        ${join}\n        f()\n`,
      call: "f()",
      before: [{
        message: "`f` is a `var`, and a `var` cannot hold a function — vars " +
          "accumulate data; model changing behavior as a union and `match` on it",
        primary: "f",
        labels: [],
      }],
    },
  ];

  const HEAD =
    "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
    "record R = { id: Int }\n" +
    "exception Boom(code: Int)\n" +
    "union T = A | B | Z\n" +
    "let t: T = A\n" +
    "let c: Bool = True\n" +
    "let spare(): Unit = ()\n" +
    "honor C<R> =\n    go(runner, b) =\n";

  for (const form of FORMS) {
    for (const slotFirst of [true, false]) {
      test(
        `${form.name}, the slot written ${slotFirst ? "first" : "second"}`,
        () => {
          for (const spelling of SPELLINGS) {
            const [first, second] = slotFirst
              ? ["b", spelling.pure]
              : [spelling.pure, "b"];
            const join = form.join(first, second);
            const source = HEAD + spelling.bind + form.after(join, first, second);
            const { messages: said, primaries: at, labels: related } = seen(source);
            const before = form.before ?? [];
            // One report from the seat — the body calls the handed callback
            // under the contract's `->` — behind whatever the language itself
            // already refused.
            expect([spelling.name, said]).toEqual([spelling.name, [
              ...before.map(({ message }) => message),
              pureConflict("go", "b"),
            ]]);
            // The call, not the merge: a call carries the condemned colour.
            expect([spelling.name, at]).toEqual([spelling.name, [
              ...before.map(({ primary }) => primary),
              form.call,
            ]]);
            // The contract's failing arrow alone.
            expect([spelling.name, related]).toEqual([spelling.name, [
              ...before.map(({ labels }) => labels),
              ['the contract\'s failing arrow: "->"'],
            ]]);
            // And never the second row: none of these programs narrows the
            // callback, so advice to stop narrowing it is a repair for a
            // defect nobody committed.
            for (const message of said) {
              expect([spelling.name, message.includes("do not narrow")])
                .toEqual([spelling.name, false]);
            }
          }
        },
      );
    }
  }
});

/**
 * **A `var`'s re-assignment, past the table's own cells** (Effects §13.2).
 * A `var` has one monotype, and each assignment joins the colours it
 * brings as an `if`'s branches join theirs: one mechanism, not two. These are
 * the cells the table's shape cannot reach: the re-assignment standing as the
 * **pin** where it narrows the callback, the assignment written inside a
 * **helper**, and a `var` re-assigned **twice**.
 */
describe("Effects §13.2: a `var`'s re-assignment is the merge, past the table", () => {
  const IMPURE =
    "constraint C<r> =\n    go(runner: r, b: () ->! Unit) ->! Unit\n" +
    "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
    "honor C<R> =\n    go(runner, b) =\n";
  const PURE =
    "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
    "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
    "honor C<R> =\n    go(runner, b) =\n";

  test("where the merge narrows the callback, the assignment is the pin", () => {
    // Under a `->!` header nothing the body calls is refused, so only a
    // narrowing can fail, and a named pure function merged in narrows nothing
    // (#1119). What narrows is a colour pinned pure before the merge — a
    // parameter with no written type (#1119) — and then the merge is the
    // pin: §13.2's second row stands at it, for a `var` at the assignment,
    // with the `if` form written beside each one.
    const shapesOf = (first: string, second: string, indent: string) => {
      const joined = `if c then { cb = ${first} } else { cb = ${second} }`;
      return [
        {
          merge: `z := { cb = ${second} }`,
          source: `${indent}var z = { cb = ${first} }\n${indent}z := { cb = ${second} }\n` +
            `${indent}ignore(z)\n`,
        },
        {
          merge: `v := [${second}]`,
          source: `${indent}var v = [${first}]\n${indent}v := [${second}]\n${indent}ignore(v)\n`,
        },
        // The `if` counterpart is the third shape, measured beside the two.
        { merge: joined, source: `${indent}let z = ${joined}\n${indent}ignore(z)\n` },
      ];
    };
    for (const [pure, bind] of [["spare", ""], ["g", "        let g = () => ()\n"]] as const) {
      for (const slotFirst of [true, false]) {
        const [first, second] = slotFirst ? ["b", pure] : [pure, "b"];
        for (const { merge, source } of shapesOf(first, second, "        ")) {
          expect([merge, seen(IMPURE + bind + source).messages]).toEqual([merge, []]);
        }
      }
    }
    {
      const open = "        let pin = (h) =>\n            let p: () -> Unit = h\n";
      const close = "        pin(() => ())\n";
      for (const slotFirst of [true, false]) {
        const [first, second] = slotFirst ? ["b", "h"] : ["h", "b"];
        for (const { merge, source: shape } of shapesOf(first, second, "            ")) {
          const seat = seen(IMPURE + open + shape + close);
          expect([merge, seat.messages])
            .toEqual([merge, [narrowerAcceptance("go", "b")]]);
          expect([merge, seat.primaries]).toEqual([merge, [merge]]);
          expect([merge, seat.labels])
            .toEqual([merge, [['the contract\'s failing arrow: "->!"']]]);
        }
      }
    }
  });

  test("and the inline lambda is accepted in every shape, as the named function is", () => {
    // Like a named function merged in (#1119), an inline lambda fixes nothing:
    // accepted in the re-assignment exactly as in the `if` form.
    for (
      const source of [
        "        var z = { cb = (() => ()) }\n        z := { cb = b }\n        ignore(z)\n",
        "        var z = { cb = b }\n        z := { cb = (() => ()) }\n        ignore(z)\n",
        "        var v = [(() => ())]\n        v := [b]\n        ignore(v)\n",
        "        let z = if c then { cb = (() => ()) } else { cb = b }\n        ignore(z)\n",
        "        let v = [(() => ()), b]\n        ignore(v)\n",
      ]
    ) {
      expect([source, seen(IMPURE + source).messages]).toEqual([source, []]);
    }
  });

  test("an assignment inside a helper is read by the seat through the helper", () => {
    // The `var`, the assignment and the call all stand inside `h`, which runs
    // `b`. The report is the table's, on the call inside the helper, first in
    // source order.
    for (const call of ["        h()\n", "        h!()\n"]) {
      const source = PURE +
        "        let h() =\n" +
        "            var z = { cb = spare }\n" +
        "            z := { cb = b }\n" +
        "            z.cb()\n" + call;
      const seat = seen(source);
      expect([call, seat.messages]).toEqual([call, [pureConflict("go", "b")]]);
      expect([call, seat.primaries]).toEqual([call, ["z.cb()"]]);
      expect([call, seat.labels]).toEqual([call, [['the contract\'s failing arrow: "->"']]]);
    }
  });

  test("a `var` re-assigned twice: the report stands at the call, in either order", () => {
    // Three colours meet in one monotype — `spare`'s, the handed callback
    // `b`'s, and a `let`-bound lambda `g`'s — across two assignments, of which
    // only one joins `b`; the pure ones fix nothing, whichever comes first.
    for (
      const [order, body] of [
        ["the handed slot joined first", "        z := { cb = b }\n        z := { cb = g }\n"],
        ["the handed slot joined last", "        z := { cb = g }\n        z := { cb = b }\n"],
      ] as const
    ) {
      const source = PURE + "        let g = () => ()\n" +
        "        var z = { cb = spare }\n" + body + "        z.cb()\n";
      const seat = seen(source);
      expect([order, seat.messages]).toEqual([order, [pureConflict("go", "b")]]);
      expect([order, seat.primaries]).toEqual([order, ["z.cb()"]]);
      expect([order, seat.labels]).toEqual([order, [['the contract\'s failing arrow: "->"']]]);
    }
  });

  test("a `:=` §6.3 refuses still joins the colours, and the seat reads it", () => {
    // A `:=` on a `let` is refused by Statements §6.3 at its target, and the
    // assignment still unifies the two colours: a colour pinned pure first (a
    // parameter with no written type, pinned by an annotation) narrows `b` at
    // the assignment, as at a `var`'s.
    for (
      const [order, first, second] of [
        ["the handed slot joined second", "h", "b"],
        ["the handed slot joined first", "b", "h"],
      ] as const
    ) {
      const seat = seen(
        IMPURE + "        let pin = (h) =>\n            let q: () -> Unit = h\n" +
          `            let p = { cb = ${first} }\n` +
          `            p := { cb = ${second} }\n            ignore(p)\n        pin(() => ())\n`,
      );
      expect([order, seat.messages]).toEqual([order, [
        "`p` is not mutable; declare it with `var` if you need to update it",
        narrowerAcceptance("go", "b"),
      ]]);
      // §6.3's refusal is on the target alone; the seat's is on the whole
      // assignment, exactly where it stands when the target is a `var`.
      expect([order, seat.primaries])
        .toEqual([order, ["p", `p := { cb = ${second} }`]]);
      expect([order, seat.labels])
        .toEqual([order, [[], ['the contract\'s failing arrow: "->!"']]]);
    }
  });

  test("and a `var` a seat never sees is untouched: the boundary costs it nothing", () => {
    // A re-assignment outside any seat is an ordinary unification: both shapes
    // the rows above use, compiled with no constraint in sight.
    expect(seen(
      "record P = { cb: () -> Unit }\nlet spare(): Unit = ()\n" +
      "let main(): Unit =\n    var z = { cb = spare }\n    z := { cb = spare }\n    z.cb()\n",
    ).messages).toEqual([]);
    expect(seen(
      "let main(): Unit =\n    var n = 1\n    n := 2\n    ignore(n)\n",
    ).messages).toEqual([]);
  });
});

/**
 * **A merge across a `match`'s arms, and a pin on a merge.** Each callback is
 * judged by its own colour, and an annotation on a merged value narrows the
 * callback merged into it.
 */
describe("Effects §13.2: a `match` merge, and a pin on a merge", () => {
  test("a `match` joining every arm: the failing callback is the later arm's", () => {
    // Arm 1 hands in `d`, written `->`, and arm 3 hands in `b`: only `b` fails,
    // at its call under the returned `->` (§13.2).
    const source =
      "constraint C<r> =\n" +
      "    go(runner: r, d: () -> Unit, b: () ->! Unit) ->! (() -> Unit)\n" +
      "record R = { id: Int }\n" +
      "let spare(): Unit = ()\n" +
      "union T = A | B | Z\n" +
      "let t: T = A\n" +
      "honor C<R> =\n    go(runner, d, b) =\n" +
      "        let g = match t\n" +
      "            A => d\n            B => spare\n            Z => b\n" +
      "        () => g()\n";
    expect(messages(source)).toEqual([pureReturns("go")]);
    expect(primaries(source)).toEqual(["g()"]);
    expect(labels(source)).toEqual([['the contract\'s failing arrow: "->"']]);
  });

  test("an annotation on the merge narrows the callback, in every spelling and order", () => {
    // `let p: () -> Unit = f` pins the merged colour pure, and with it `b`'s
    // (§3.4's join fragment, rule 1): the body accepts only a pure `b`, §13.2's
    // second row at the annotation, whichever spelling the pure side takes.
    const demanded = (other: string, bind = "") =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" + bind +
      `        let f = if c then ${other} else b\n` +
      "        let p: () -> Unit = f\n        ignore(p)\n        f()\n";
    // And with the merge written the other way round.
    const demandedFirst = (other: string, bind = "") =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" + bind +
      `        let f = if c then b else ${other}\n` +
      "        let p: () -> Unit = f\n        ignore(p)\n        f()\n";
    for (
      const [other, bind] of [
        ["spare", ""],
        ["(() => ())", ""],
        ["g", "        let g = () => ()\n"],
      ] as const
    ) {
      for (const source of [demanded(other, bind), demandedFirst(other, bind)]) {
        const seat = seen(source);
        expect([other, seat.messages]).toEqual([other, [narrowerAcceptance("go", "b")]]);
        expect([other, seat.primaries]).toEqual([other, ["() -> Unit"]]);
        expect([other, seat.labels]).toEqual([other, [['the contract\'s failing arrow: "->!"']]]);
      }
    }
  });

  test("and the same through an annotated local function", () => {
    // The merge under a `let` whose own result type is annotated `() -> Unit`,
    // called through: the annotation narrows `b`.
    const annotated = (other: string, bind = "") =>
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" + bind +
      `        let choose(): (() -> Unit) = if c then ${other} else b\n` +
      "        choose()()\n";
    for (
      const [other, bind] of [
        ["spare", ""],
        ["(() => ())", ""],
        ["g", "        let g = () => ()\n"],
      ] as const
    ) {
      const source = annotated(other, bind);
      expect([other, messages(source)]).toEqual([other, [narrowerAcceptance("go", "b")]]);
      expect([other, primaries(source)]).toEqual([other, ["(() -> Unit)"]]);
      expect([other, labels(source)]).toEqual([other, [['the contract\'s failing arrow: "->!"']]]);
    }
  });
});

/**
 * **A join at a seat moves colours, never a type, at any depth** (Effects
 * §13.2, §3.4).
 */
describe("Effects §13.2: a join at a seat moves colours, never a type, at any depth", () => {
  test("a callback fixed impure BEFORE the merge keeps the face the join gave it", () => {
    // `let q: () ->! Unit = b` fixes the callback to the impure constant
    // FIRST, and `h` is pinned pure by `p`, so the `if` merges the impure
    // constant with the pure one: §4.3's row at the merge, and the unification
    // binds nothing. `f` keeps the face its own branch gave it, and no second
    // report follows under either outer arrow.
    const raisedFirst = (arrow: string): string =>
      "constraint C<r> =\n" +
      `    go(runner: r, b: () ->! Unit) ${arrow} Unit\n` +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" +
      "        let q: () ->! Unit = b\n" +
      "        ignore(q)\n" +
      "        let pin = (h) =>\n" +
      "            let p: () -> Unit = h\n" +
      "            let f = if c then h else b\n" +
      "            f()\n" +
      "        pin(() => ())\n";
    for (const arrow of ["->", "->!"]) {
      const source = raisedFirst(arrow);
      // The verdict: §4.3's row for the merge the program really wrote, and
      // nothing beside it.
      expect([arrow, messages(source)]).toEqual([arrow, [
        "a `->` arrow promises purity, and this function may touch the world — the " +
        "demand is written `->`, the function's face `->!` or `>->`",
      ]]);
      // And the face the join left: the merge bound nothing, so `f` is the pure
      // arrow its own branch published, not `() ->! Unit`.
      expect([arrow, hoveredType("module Main\n\n" + source, "f = if c")])
        .toEqual([arrow, "() -> Unit"]);
    }
  });

  test("thirty nested records report exactly as one nested record does", () => {
    // A join is structural at any depth: the pure branch fixes nothing however
    // deep the callback sits, so the call on it is the one report.
    const wrap = (n: number, inner: string): string => {
      let text = inner;
      for (let index = 0; index < n; index += 1) text = `{ a = ${text} }`;
      return text;
    };
    const merge = (n: number): string =>
      `if c then ${wrap(n, "{ cb = spare }")} else ${wrap(n, "{ cb = b }")}`;
    const nested = (n: number): string =>
      "constraint C<r> =\n" +
      "    go(runner: r, b: () ->! Unit) -> Unit\n" +
      "record R = { id: Int }\nlet c: Bool = True\nlet spare(): Unit = ()\n" +
      "honor C<R> =\n    go(runner, b) =\n" +
      `        let z = ${merge(n)}\n` +
      `        z${".a".repeat(n)}.cb()\n`;
    for (const n of [1, 24, 30]) {
      const source = nested(n);
      expect([n, messages(source)]).toEqual([n, [pureConflict("go", "b")]]);
      expect([n, primaries(source)]).toEqual([n, [`z${".a".repeat(n)}.cb()`]]);
      expect([n, labels(source)]).toEqual([n, [['the contract\'s failing arrow: "->"']]]);
    }
  });
});

/**
 * **§3.4's defaulting clause at calls reaches a named local inside a seat**
 * *(#947)*: the local generalizes where it is bound, so its undetermined call
 * colours are decided there — not left free and pinned after its callers
 * instantiated them.
 */
describe("Effects §3.4 at a seat: a named local's call colours default before it generalizes", () => {
  test("an impure argument meets the pure face the local's body gave its callback", () => {
    expect(messages(`extern from "./io.js"
    export fun save(document: String) ->! Unit

constraint C<r> =
    go(runner: r, b: () ->! Unit) ->! Unit
record R = { id: Int }
honor C<R> =
    go(runner, b) =
        let run = (f) =>
            save!("x")
            f(1)
        let k = run!((n) =>
            save!("y")
            n)
        b!()
`)).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — the " +
      "demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });
});

/**
 * **A knot inside a seat compares its demands at its close too** *(#947)*:
 * its members settle on the seat's path, but the demand a sibling met while
 * the knot was open is still compared — a source against a `->` refused.
 */
describe("Effects §3.4 at a seat: a knot's recorded demands are compared", () => {
  test("a source sibling at a `->` demand is §4.3's refusal", () => {
    expect(messages(`extern from "./io.js"
    export fun save(document: String) ->! Unit

constraint C<r> =
    go(runner: r, b: () ->! Unit) ->! Unit
record R = { id: Int }
honor C<R> =
    go(runner, k) =
        fun
            a(): Unit =
                let p: () -> Unit = b
                ()
            b(): Unit =
                let unused = a
                save!("x")
        k!()
`)).toEqual([
      "a `->` arrow promises purity, and this function may touch the world — the " +
      "demand is written `->`, the function's face `->!` or `>->`",
    ]);
  });

  test("a `->!` demand never chooses a pure sibling's colour at a seat either", () => {
    expect(messages(`export record Box = { step: () ->! Int }
constraint C<r> =
    go(runner: r, k: () ->! Unit) ->! Unit
record R = { id: Int }
honor C<R> =
    go(runner, k) =
        fun
            a(): Int =
                let s = Box({ step = b })
                1
            b(): Int =
                let unused = a
                1
        k!()
`)).toEqual([]);
    // The sibling stays pure — the field chose nothing — and fits the field,
    // as a pure function fits wherever a function is expected (#1119).
  });
});
