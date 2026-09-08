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

/** Effects §9's pure-contract row, verbatim, for the member it names. */
const pureContract = (member: string): string =>
  `this call performs effects, and \`${member}\`'s contract is the pure arrow ` +
  "`->` — an instance performs no more than its contract permits — keep this " +
  "body pure, or, if the constraint is yours, write `->!` on the member";

/** Effects §9's linked-contract row, verbatim. */
const linkedContract = (member: string): string =>
  `this call performs effects unconditionally, and \`${member}\`'s contract is ` +
  "linked `->?` — an instance must be pure whenever what it is handed is pure, " +
  "so its effects may come only from what it is handed — move this effect " +
  "behind the callback, or write `->!` on the member";

/** Effects §9's narrower-acceptance row, verbatim. */
const narrowerAcceptance = (member: string, parameter: string): string =>
  `\`${member}\`'s contract accepts an \`${parameter}\` of either colour, and ` +
  "this instance accepts only a pure one — an instance accepts everything its " +
  "contract promises to accept — call the callback with `?` instead of handing " +
  "it to a `->` demand, or, if the constraint is yours, write the member " +
  "pure-only — the callback `->` and the outer arrow `->`";

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
      .toEqual([pureContract("run")]);
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
      "write `->!` on the member",
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
    for (const message of messages(IO +
      "constraint Runner<r> =\n" +
      "    run(runner: r, action: () ->? Unit) ->? Unit\n" +
      "export record Job = { id: Int }\n" +
      "honor Runner<Job> =\n    run(job, action) = Debug.log(readIt!(\"x\"))\n")) {
      expect(message).not.toMatch(/\?\d/);
    }
  });
});
