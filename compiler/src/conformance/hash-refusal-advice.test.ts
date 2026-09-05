import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { applyLayout } from "../passes/layout/layout.js";
import { check } from "../passes/checker/checker.js";
import { lex } from "../passes/lexer/lexer.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for Collections Part 2 §9's **member-block `honor Hash<T>`
 * refusal** and the five rows it now speaks in (#647).
 *
 * The refusal is §4.1's and does not move: `Hash` is derivable-only, so every
 * user module refuses the hand-written form, and #344's carve-out — a
 * privileged prelude companion at its own primitive — is the only exception.
 * What James ruled is that the refusal joins #644's advice family: one head,
 * stating the law **positively**, and advice the reader can actually take. Five
 * rows come out of that, and one of them is silence:
 *
 * 1. **Project-source nominal, `Eq` absent or derived.** Constraints §8's fixit,
 *    list-aware and base-complete in both dialects. The subject is named always;
 *    the file only when the declaration is not the reporting one — a softer gate
 *    than #644's, because here the refused `honor` is itself the anchor.
 * 2. **Project-source nominal, hand-written `Eq`.** Row 1's advice would itself
 *    be refused (§4.3), so §4.5's wrapper route stands in its place.
 * 3. **Prelude nominal.** The seat exists and the reader cannot edit it — the
 *    head plus one true sentence, and no fixit (Modules §7.6's offering
 *    discipline).
 * 4. **No `derives` seat at all** — a primitive outside the carve-out, an extern
 *    type, a structural subject.
 * 5. **A subject that cannot be named, or cannot host an instance** — an
 *    annotation that does not resolve, or a bare type-variable head. Silent:
 *    the unknown-name error, or Constraints §5.4's head refusal, is the whole
 *    answer.
 *
 * Every specimen here carries a **numeric literal** in its member body, which is
 * what #651 was: the refusal `continue`d out of `#inferItems` before the body's
 * requirements were registered, and materialization then dereferenced them
 * anyway. Collections Part 2 §4.1's own worked example crashed the compiler, so
 * the messages and the repair are measured by the same programs.
 * `derivation-fixit.test.ts` owns the use-site sentence this family shares its
 * head with; the four companion files own the carve-out's boundary.
 */

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

describe("row 1: a project-source nominal whose `Eq` is absent or derived", () => {
  /**
   * Collections Part 2 §15's item (4), byte for byte — the golden block, and the
   * program the spec holds up as what a user writes at this seat. It is also the
   * #651 crash verbatim: `hash(u) = u.n * 31` is §4.1's worked example.
   */
  test("§15's golden block: no `derives` list, no `Eq` — the whole clause, base-complete", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "record UserId = {n: Int}",
      "honor Hash<UserId> =",
      "    hash(u) = u.n * 31",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances must be derived; use `derives (Eq, Hash)` on the " +
        "declaration of `UserId`",
    ]);
  });

  /**
   * The dialect is a fact about the declaration's *text* and the base rendering
   * a fact about the `Eq` *instance*, so the two questions cross. This is the
   * cell #644's fixit called the least obvious one: no `derives` clause to
   * extend, and a derived `Eq` beside the declaration all the same, because
   * derivation has two spellings (Constraints §4.5's `= derive` and the header
   * sugar). `Eq` is satisfied, so it is not named.
   */
  test("no `derives` list, `Eq` derived through `= derive` — `Hash` alone", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "record UserId = {n: Int}",
      "honor Eq<UserId> = derive",
      "honor Hash<UserId> =",
      "    hash(u) = u.n * 31",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances must be derived; use `derives Hash` on the declaration " +
        "of `UserId`",
    ]);
  });

  /** §8's second dialect: a clause is already there, so the repair extends it. */
  test("a `derives` list carrying `Eq` — add `Hash` to it", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "record UserId derives (Eq) = {n: Int}",
      "honor Hash<UserId> =",
      "    hash(u) = u.n * 31",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances must be derived; add `Hash` to `UserId`'s `derives` list",
    ]);
  });

  /**
   * Base-complete in *this* dialect too. A reader who followed a bare
   * `add Hash` here would trade this error for the missing-base one, which is
   * exactly what base-completeness exists to prevent.
   */
  test("a `derives` list without `Eq` — add `(Eq, Hash)` to it", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "record UserId derives (Show) = {n: Int}",
      "honor Hash<UserId> =",
      "    hash(u) = u.n * 31",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances must be derived; add `(Eq, Hash)` to `UserId`'s " +
        "`derives` list",
    ]);
  });

  /** A union carries a `derives` clause exactly as a nominal record does. */
  test("a union subject reads the same law", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "union Tag = Red | Green",
      "honor Hash<Tag> =",
      "    hash(t) = 31",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances must be derived; use `derives (Eq, Hash)` on the " +
        "declaration of `Tag`",
    ]);
  });

  /**
   * The **elsewhere-file** branch, and the interplay §9 pins with it: a
   * member-block honor outside `T`'s own file is *also* an orphan — `Hash`'s
   * other legal home is the prelude — so the branch is reachable only in an
   * already-orphan program. Both diagnostics stand, and both are reported
   * against the same file, the one holding the refused `honor`.
   */
  test("a declaration in another file is named, beside the orphan error", () => {
    expect(messagesOf([
      ["/types.hex", "module Types\n\n" + "export record Weird = {n: Int}\n"],
      [
        "/main.hex",
        "module Main\n\n" + [
          // Rule 3's companion fallback (Modules §3.2, #762): the alias's
          // own spelling equals the exported record's, so the `honor` head
          // reaches it bare with no separate import for the type.
          "import Types as Weird",
          "honor Hash<Weird> =",
          "    hash(w) = w.n * 31",
          "",
        ].join("\n"),
      ],
    ])).toEqual([
      "orphan instance: this module declares neither `Hash` nor the instance subject",
      "`Hash` instances must be derived; use `derives (Eq, Hash)` on the " +
        "declaration of `Weird` in module `Types`",
    ]);
  });

  /**
   * The declaration's own file is never named. The `honor` the caret sits on is
   * already in the file the reader must open, and that anchor is the whole
   * reason this gate is softer than #644's — pinned negatively, because the
   * failure mode is a path appearing where it says nothing.
   */
  test("the reporting module is never named", () => {
    // No diagnostic names a *path* since #829 — a module is named, never a
    // file (Modules §1) — so the needle is the module the advice would name if
    // it named its own; `main.hex` could not appear whatever the compiler did.
    expect(projectDiagnostics([
      "module Main",
      "",
      "record UserId = {n: Int}",
      "honor Hash<UserId> =",
      "    hash(u) = u.n * 31",
      "",
    ].join("\n"))[0]).not.toContain("`Main`");
  });

  /**
   * A **pathless** compilation degrades gracefully: the subject is still named,
   * the file simply omitted. #644's fixit returns nothing at all here, printing
   * a path being the whole of what it offers; this seat keeps its advice,
   * because the advice does not depend on the path.
   */
  test("a pathless compilation names the subject and omits the file", () => {
    const source = new Source.File(
      Source.fileId(0),
      "test.hex",
      [
        "module Main",
        "",
        "record UserId = {n: Int}",
        "honor Hash<UserId> =",
        "    hash(u) = u.n * 31",
        "",
      ].join("\n"),
    );
    const module = check(resolve(parse(applyLayout(lex(source)))));

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`Hash` instances must be derived; use `derives (Eq, Hash)` on the " +
        "declaration of `UserId`",
    ]);
  });
});

describe("row 2: a project-source nominal whose `Eq` is hand-written", () => {
  /**
   * Derivation is barred outright (§4.3), so row 1's advice would itself be
   * refused and offering it would be worse than offering none. §4.5's wrapper
   * route is the one repair that keeps this equality, and it is seated after the
   * head the whole family shares. The provenance channel is the instance
   * record's `derived` flag, never the declaration's text.
   */
  test("the wrapper route stands in place of the fixit", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "record Weird = {s: String}",
      "honor Eq<Weird> =",
      "    equals(a, b) = a.s == b.s",
      "honor Hash<Weird> =",
      "    hash(w) = 31",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances must be derived, and `derives Hash` requires a derived " +
        "`Eq` — `Weird` declares its own; key on a wrapper type whose `Eq` and " +
        "`Hash` are both derived",
    ]);
  });
});

describe("row 3: a prelude nominal subject", () => {
  /**
   * The `derives` seat exists and sits outside project source, so there is a
   * true sentence to say and no repair to offer. The orphan error stands beside
   * it: a user module declares neither `Hash` nor `Ordering`.
   */
  test("the head plus the one true sentence, and no fixit", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "honor Hash<Ordering> =",
      "    hash(o) = 31",
      "",
    ].join("\n"))).toEqual([
      "orphan instance: this module declares neither `Hash` nor the instance subject",
      "`Hash` instances must be derived; derivation is spelled on the subject's " +
        "declaration, which is not in project source",
    ]);
  });
});

describe("row 4: a subject with no `derives` seat", () => {
  /**
   * A structural subject has no declaring module at all (Modules §7.6's own
   * carve-out), so there is nothing to name and nothing to edit. The primitive
   * arm of this row is pinned where the carve-out's boundary is measured —
   * `int-companion`, `nat-companion`, `bigint-companion`.
   */
  test("a structural subject", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "honor Hash<Vector(Int)> =",
      "    hash(v) = 31",
      "",
    ].join("\n"))).toContain(
      "`Hash` instances must be derived, and this subject has no declaration " +
        "that could carry a `derives` clause",
    );
  });

  /**
   * An extern type *has* a home — the file holding its `extern` block — but no
   * declaration a `derives` clause could sit on, which is this row's question
   * and not `#subjectHome`'s.
   */
  test("an extern type", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "extern from \"widgets\"",
      "    export type Widget",
      "honor Hash<Widget> =",
      "    hash(w) = 31",
      "",
    ].join("\n"))).toContain(
      "`Hash` instances must be derived, and this subject has no declaration " +
        "that could carry a `derives` clause",
    );
  });
});

describe("row 5: a subject that cannot be named, or cannot host an instance", () => {
  /**
   * The seat is **silent**. The refusal still stands — the instance never joins
   * the table — but no advice is owed about a subject the checker cannot name,
   * and the resolver has already reported the unknown name against this very
   * span. Before #647 all three fired: the refusal, the unknown-name error, and
   * an orphan error naming a subject that does not exist.
   *
   * Pinned from both sides, because a suppression that suppressed everything
   * would pass a one-sided assertion.
   */
  test("the unknown-name error is the whole answer", () => {
    const messages = projectDiagnostics([
      "module Main",
      "",
      "honor Hash<Nope> =",
      "    hash(n) = 31",
      "",
    ].join("\n"));

    expect(messages).toContain("unknown type `Nope`");
    expect(messages.join("\n")).not.toContain("`Hash` instances must be derived");
  });

  /**
   * The row's **second arm**, and the widening that put it here: row 5's
   * principle reads from "cannot be named" to "cannot host an instance at all".
   * A bare type variable resolves perfectly well and is still no subject —
   * Constraints §5.4 refuses the head outright, and that refusal is the whole
   * answer. Row 4's sentence would be true of a variable the way it is true of a
   * number: not usefully, and it is what this seat used to say.
   *
   * The body carries a literal, so the specimen drives the #651 guard too.
   */
  test("a bare type-variable head takes §5.4's refusal and no advice", () => {
    const messages = projectDiagnostics([
      "module Main",
      "",
      "honor Hash<a> =",
      "    hash(x) = 31",
      "",
    ].join("\n"));

    expect(messages).toContain(
      "an instance head must name a primitive or nominal type constructor",
    );
    expect(messages.join("\n")).not.toContain("`Hash` instances must be derived");
  });

  /**
   * The same subject under the `honor<a>` prefix, which §5.4 refuses with its
   * *other* message. One check answers both because both elaborate to a
   * variable, and pinning only the bare spelling would let the prefix form drift
   * back into row 4 unnoticed.
   */
  test("the prefix spelling of the same head is silent too", () => {
    const messages = projectDiagnostics([
      "module Main",
      "",
      "honor<a> Hash<a> =",
      "    hash(x) = 31",
      "",
    ].join("\n"));

    expect(messages).toContain(
      "a parameterized instance head must be a nominal constructor applied " +
        "once to each distinct instance parameter",
    );
    expect(messages.join("\n")).not.toContain("`Hash` instances must be derived");
  });
});

describe("#651: a refused member body is never materialized", () => {
  /**
   * The crash, from the other side, and at the *second* of the seats that reads
   * `#requirements` without a fallback: a string interpolation. The first is the
   * integer literal every row-1 pin above already drives — Collections Part 2
   * §4.1's own worked example, which is what #651 opened on — so this specimen
   * takes the seat none of them reaches.
   *
   * The body is deliberately ill-typed for a `hash`. It never has to type: the
   * refusal fires ahead of member inference, and the whole point of the repair
   * is that nothing downstream may assume otherwise. Removing the materializer's
   * guard makes this throw.
   */
  test("an interpolation in a refused `Hash` body reports rather than crashes", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "record UserId = {n: Int}",
      "honor Hash<UserId> =",
      "    hash(u) = \"${u.n}\"",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances must be derived; use `derives (Eq, Hash)` on the " +
        "declaration of `UserId`",
    ]);
  });

  /**
   * The sibling refusal in the same arm, which crashed identically and for the
   * identical reason: an unknown constraint's `honor` block also `continue`s
   * before member inference. One mechanism answers both, which is why the
   * refusal is recorded on the item rather than special-cased at the `Hash`
   * seat — a repair that fixed `Hash` alone and left this one throwing would be
   * arbitrary about a defect that is not about `Hash` at all.
   */
  test("an unknown constraint's refused body crashes no more than `Hash`'s", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "record R = {n: Int}",
      "honor Nope<R> =",
      "    f(r) = \"${r.n}\"",
      "",
    ].join("\n"))).toEqual([
      "unknown constraint `Nope`; import its home module under the alias " +
        "`Nope` for qualified access",
    ]);
  });
});
