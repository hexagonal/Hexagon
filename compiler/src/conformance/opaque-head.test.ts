import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for the **head's one visibility slot** (Modules §4, §4.2, §10,
 * §13(c); Declarations Preamble §2.1; Lexer §4.2; #590).
 *
 * The slot has three values and they are mutually exclusive spellings: absent,
 * `export`, `opaque`. `opaque` fills it by itself — opacity of a private thing
 * is vacuous, so the word already claims the crossing — and the pre-#590 pair
 * `export opaque` is refused with a required, mechanical rewrite.
 *
 * Three separate claims are pinned here, and each can fail alone:
 *
 * - **the head parses and means what the pair meant.** `opaque record` exports
 *   the type name and nothing else, which is a *semantic* claim and not a
 *   parsing one: it fails if the flags reach the checker in the wrong shape,
 *   however cleanly the line reads.
 * - **the pair is refused, in the introducer the author wrote.** Two exemplars,
 *   chosen by `record` or `union`, plus the fix-it that performs the edit.
 * - **`opaque` is still an ordinary name.** The word is contextual (the `union`
 *   precedent), so a head is a head only where a declaration follows it, and
 *   `let opaque = 3` binds like any other name.
 *
 * The redirects §10 keeps live are here too — `type` gets the alias sentence,
 * `let`/`fun`/`constraint`/`exception` the general one — and the row #590 killed
 * is pinned by its absence in `parser.ts` (there is no "everything is already
 * private" sentence left to reach).
 *
 * Fixtures differ in their record names and fields on purpose: two modules whose
 * emitted JavaScript is byte-identical share one `data:` module instance in the
 * test linker, which would quietly make two programs one.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("the `opaque` head means what `export opaque` meant (§4.2)", () => {
  /** A home module and a stranger that imports the type name alone. */
  const vault = (body: string) =>
    [
      ["/vault.hex",
        "opaque record Ticket = {serial: Int}\n" +
        "export fun issue(serial: Int): Ticket = Ticket({serial = serial})\n" +
        "export fun serialOf(t: Ticket): Int = t.serial\n"],
      ["/main.hex", body],
    ] as const;

  test("the type name crosses: a stranger may name it and pass it around", () => {
    expect(messages(vault(
      'import { Ticket, issue, serialOf } from "./vault"\n' +
      "export fun round(t: Ticket): Int = serialOf(t)\n" +
      "export let one: Int = round(issue(7))\n",
    ))).toEqual([]);
  });

  test("the field does not cross", () => {
    expect(messages(vault(
      'import { Ticket, issue } from "./vault"\n' +
      "export fun peek(t: Ticket): Int = t.serial\n",
    ))).toEqual([
      "cannot access field `serial` of opaque record `Ticket`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("the constructor does not cross", () => {
    expect(messages(vault(
      'import { Ticket } from "./vault"\n' +
      "export fun forge(): Ticket = Ticket({serial = 1})\n",
    ))).toEqual([
      // The name arrives in the *type* namespace alone, so the constructor is
      // not merely refused at the seat — it was never bound here.
      "unknown name `Ticket`",
    ]);
  });

  test("inside the home module `opaque` changes nothing", () => {
    expect(projectDiagnostics(
      "opaque record Crate = {weight: Float}\n" +
      "export fun heavier(c: Crate): Float = c.weight + 1.0\n" +
      "export let built: Float = heavier(Crate({weight = 2.0}))\n",
    )).toEqual([]);
  });

  test("an `opaque union`'s constructors stay home, and the type name travels", () => {
    const files = [
      ["/handles.hex",
        "opaque union Handle = FileHandle(fd: Int) | NetHandle(sock: Int)\n" +
        "export fun openFile(fd: Int): Handle = FileHandle(fd)\n" +
        "export fun describe(h: Handle): Int =\n" +
        "    match h\n" +
        "        FileHandle(fd) => fd\n" +
        "        NetHandle(sock) => sock\n"],
      ["/main.hex",
        'import { Handle, openFile, describe } from "./handles"\n' +
        "export fun show(h: Handle): Int = describe(h)\n" +
        "export let n: Int = show(openFile(3))\n"],
    ] as const;
    expect(messages(files)).toEqual([]);

    expect(messages([
      files[0],
      ["/main.hex",
        'import { Handle, FileHandle } from "./handles"\n' +
        "export fun forge(): Handle = FileHandle(1)\n"],
    ])).toEqual([
      "module `./handles` does not export `FileHandle`",
      "unknown name `FileHandle`",
    ]);
  });

  test("the emitted module still runs, and the opaque value is real", async () => {
    const exports = await runProject([
      ["/badge.hex",
        "opaque record Badge = {number: Int}\n" +
        "export fun mint(number: Int): Badge = Badge({number = number})\n" +
        "export fun numberOf(b: Badge): Int = b.number\n"],
      ["/main.hex",
        'import { mint, numberOf } from "./badge"\n' +
        "export let answer: Int = numberOf(mint(42))\n"],
    ]);
    expect(exports["answer"]).toBe(42);
  });
});

describe("`export opaque` is refused with the required rewrite (§4.2, §10)", () => {
  test("a record head names the record exemplar", () => {
    expect(projectDiagnostics(
      "export opaque record Point = {x: Float, y: Float}\n",
    )).toEqual([
      "`opaque` already exports the type name; write `opaque record Point = …`",
    ]);
  });

  test("a union head names the union exemplar", () => {
    expect(projectDiagnostics(
      "export opaque union Handle = FileHandle(fd: Int) | NetHandle(sock: Int)\n",
    )).toEqual([
      "`opaque` already exports the type name; write `opaque union Handle = …`",
    ]);
  });

  /**
   * Recovery, and it is the migration's own case: the declaration below the
   * refused head is still read as the `opaque` head it meant, so a file of the
   * old spelling reports once per line and never cascades into the module's
   * body.
   */
  test("the declaration is still parsed, opacity and all", () => {
    expect(messages([
      ["/mint.hex",
        "export opaque record Coin = {face: Int}\n" +
        "export fun strike(face: Int): Coin = Coin({face = face})\n"],
      ["/main.hex",
        'import { Coin, strike } from "./mint"\n' +
        "export fun read(c: Coin): Int = c.face\n"],
    ])).toEqual([
      "`opaque` already exports the type name; write `opaque record Point = …`",
      "cannot access field `face` of opaque record `Coin`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("the refusal carries a fix-it that writes the bare head", () => {
    // Asserted by *applying* it: an edit count proves nothing about an edit,
    // and the claim being made is that the repair produces the spelling the
    // message asked for and touches nothing else on the line.
    const source = "export opaque record Point = {x: Float, y: Float}\n";
    const [diagnostic] = compileFiles([["/main.hex", source]]).diagnostics;
    expect(diagnostic?.fixes).toMatchObject([{ message: "write `opaque`" }]);
    const edits = diagnostic?.fixes?.[0]?.edits ?? [];
    expect(edits).toHaveLength(1);
    const { span, replacement } = edits[0]!;
    expect(
      source.slice(0, span.start.offset) + replacement + source.slice(span.end.offset),
    ).toBe("opaque record Point = {x: Float, y: Float}\n");
  });
});

describe("`opaque` on a subject it does not apply to (§10)", () => {
  test("`type` gets the alias redirect", () => {
    const alias = "aliases are transparent; make it a `record` or single-constructor `union`";
    expect(projectDiagnostics("opaque type Name = String\n")).toContain(alias);
    // The pair reaches the same sentence: the subject is what is wrong, and the
    // rewrite the pair would otherwise be offered leads nowhere here.
    expect(projectDiagnostics("export opaque type Name = String\n")).toContain(alias);
  });

  test("`let`, `fun`, `constraint` and `exception` get the general redirect", () => {
    const applies = "`opaque` applies to `record` and `union` declarations";
    expect(projectDiagnostics("opaque let width: Int = 3\n")).toContain(applies);
    expect(projectDiagnostics("opaque fun width(): Int = 3\n")).toContain(applies);
    expect(projectDiagnostics(
      "opaque constraint Hidden<a> =\n    peek(subject: a): Int\n",
    )).toContain(applies);
    expect(projectDiagnostics("opaque exception Torn(reason: String)\n")).toContain(applies);
  });

  /**
   * What recovery may and may not assume, and the two heads part company here.
   *
   * A refused word claims nothing, so the bare head recovers to the slot's
   * **neutral** value — private — which is exactly what the only available fix
   * produces. Recovering as exported would invent a crossing the author never
   * wrote, and the invention is not inert: an export owes a complete signature,
   * so the phantom draws a second diagnostic whose advice is *false* once the
   * real repair is applied, and the name resolves from an importing module.
   *
   * The pair is the control. There `export` is written and only `opaque` is
   * refused, so the crossing stands and the signature error below it is the
   * author's own to answer — which is why an equality assertion is the right
   * one on both sides: the count is the claim.
   */
  test("a redirected subject is not exported by the word that was refused", () => {
    const applies = "`opaque` applies to `record` and `union` declarations";
    expect(projectDiagnostics("opaque let width = 3\n")).toEqual([applies]);
    expect(projectDiagnostics("opaque fun width(n: Int) = n * 2\n")).toEqual([applies]);
    expect(projectDiagnostics("export opaque let width = 3\n")).toEqual([
      applies,
      "exported value `width` requires a type annotation",
    ]);
  });

  test("the phantom export is not reachable from another module", () => {
    expect(messages([
      ["/hidden.hex", "opaque let width = 3\n"],
      ["/main.hex", 'import { width } from "./hidden"\nexport let n: Int = width\n'],
    ])).toEqual([
      "`opaque` applies to `record` and `union` declarations",
      "module `./hidden` does not export `width`",
      "unknown name `width`",
    ]);
  });

  /**
   * The redirects are the reason `#atOpaqueHead` recognizes the refused
   * followers at all: a head that stopped at `record`/`union` would let
   * `opaque type Name = String` fall out of the item grammar, and the author
   * would be answered by whatever the expression parser made of two adjacent
   * words instead of by §10's row.
   */
  test("the redirected declaration is still read, so the module below it survives", () => {
    expect(projectDiagnostics(
      "opaque type Name = String\n" +
      "export fun greet(n: Name): Name = n\n",
    )).toEqual([
      "aliases are transparent; make it a `record` or single-constructor `union`",
    ]);
  });
});

describe("`opaque` is contextual, never reserved (Lexer §4.2)", () => {
  test("`let opaque = 3` binds", () => {
    expect(projectDiagnostics(
      "let opaque = 3\nexport let doubled: Int = opaque * 2\n",
    )).toEqual([]);
  });

  test("the word is an ordinary term, parameter and field", async () => {
    const exports = await runProject([
      ["/main.hex",
        "export fun scale(opaque: Int): Int = opaque + 1\n" +
        "record Cover = {opaque: Bool}\n" +
        "let sheet = Cover({opaque = True})\n" +
        "export let veiled: Bool = sheet.opaque\n" +
        "export let bumped: Int = scale(4)\n"],
    ]);
    expect(exports["veiled"]).toBe(true);
    expect(exports["bumped"]).toBe(5);
  });

  test("a head is a head only where a declaration follows", () => {
    // No juxtaposition in the grammar, so a term `opaque` is followed by `(`,
    // an operator, a newline, or nothing — never by a declaration keyword.
    expect(projectDiagnostics(
      "fun opaque(n: Int): Int = n\nexport let called: Int = opaque(1)\n",
    )).toEqual([]);
  });

  test("`opaque` at a block's item position is not a module-level declaration", () => {
    expect(projectDiagnostics(
      "export fun wrap(): Int =\n" +
      "    opaque record Inner = {n: Int}\n" +
      "    1\n",
    )).toContain("`opaque` is only allowed at module top level");
  });
});

/**
 * Layout decides whether an indented line continues a declaration or opens a
 * block by reading the item's *head*, and it has always had to look past the
 * visibility slot to find it. Before #590 that was one token of `export`; now
 * it is `export`, `opaque`, or — while a migration is under way — both.
 *
 * These fail loudly and unhelpfully when the head is not skipped: a union's
 * alternatives get a VOPEN they should not have, and a constraint body gets
 * none where it needs one, so the reports come out of the body rather than
 * from the head that confused it.
 */
describe("the `opaque` head lays out like the head it replaced (Lexer & Layout)", () => {
  test("an indented alternative list still belongs to its declaration", () => {
    expect(projectDiagnostics(
      "opaque union Tree(a) =\n" +
      "    | Leaf\n" +
      "    | Fork(left: Tree(a), value: a)\n" +
      "export fun leaf(): Tree(Int) = Leaf\n",
    )).toEqual([]);
  });

  test("an indented record body still belongs to its declaration", () => {
    expect(projectDiagnostics(
      "opaque record Ledger = {\n" +
      "    total: Int,\n" +
      "    count: Int,\n" +
      "}\n" +
      "export fun empty(): Ledger = Ledger({total = 0, count = 0})\n",
    )).toEqual([]);
  });

  /**
   * The refused subjects lay out too, or the redirect arrives buried under the
   * body's own complaints — which is the failure this pins: the head is the
   * defect, and it should be the only report.
   */
  test("a redirected `opaque constraint` still opens its body", () => {
    expect(projectDiagnostics(
      "opaque constraint Hidden<a> =\n    peek(subject: a): Int\n",
    )).toEqual([
      "`opaque` applies to `record` and `union` declarations",
    ]);
  });

  test("a redirected `opaque fun` still opens its body", () => {
    // Two statements, not one: a single indented line would ride in as a
    // continuation whether or not a block opened, and would pass either way.
    expect(projectDiagnostics(
      "opaque fun width(n: Int): Int =\n" +
      "    let doubled = n * 2\n" +
      "    doubled + 1\n",
    )).toEqual([
      "`opaque` applies to `record` and `union` declarations",
    ]);
  });

  test("the refused pair lays out as the declaration it plainly is", () => {
    expect(projectDiagnostics(
      "export opaque union Colour =\n" +
      "    | Red\n" +
      "    | Green\n",
    )).toEqual([
      "`opaque` already exports the type name; write `opaque union Handle = …`",
    ]);
  });
});

describe("variance sigils read the `opaque` head (Preamble §2.1, §4.2.1)", () => {
  test("a sigil on a bare `opaque` head is accepted and claimed", () => {
    expect(projectDiagnostics(
      "opaque record Holder(+a) = { get: () -> a }\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      "opaque record Drain(-a) = { accept: a -> Unit }\n",
    )).toEqual([]);
  });

  test("the claim is still verified against the representation", () => {
    expect(projectDiagnostics(
      "opaque record Drain(+a) = { accept: a -> Unit }\n",
    )).toContain(
      "`a` cannot be declared covariant in `Drain`: field `accept` uses `a` in argument position. " +
        "Remove the `+`, or change the field",
    );
  });

  test("a sigil on a transparent declaration is still refused", () => {
    expect(projectDiagnostics(
      "export record Pair(+a, b) = { left: a, right: b }\n",
    )).toContain("variance is inferred for transparent types; remove the `+`");
    expect(projectDiagnostics(
      "record Solo(-a) = { accept: a -> Unit }\n",
    )).toContain("variance is inferred for transparent types; remove the `-`");
  });
});
