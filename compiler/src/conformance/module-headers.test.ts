import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import type * as Diagnostics from "../support/diagnostics.js";

/**
 * Conformance for **#829** — a module is a named declaration, a file is a
 * container — at the seats a file's own *text* owns: the header, the closer,
 * the names two modules may not share, and the address the emitted files take.
 *
 * Modules §13(o)'s headers and closers, §13(p)'s reachable rows, and every §10
 * row those two reach with the package set this slice has, `{project, Hex}`.
 * The import head's own family is `module-imports.test.ts`'s §13(n); what is
 * here is everything that happens before an import is read, plus Packages §6's
 * layout, which is the one rule an emitted path can get wrong silently.
 */

/** Every message the project reported, in order. */
function messages(
  files: readonly (readonly [string, string])[],
  options: Parameters<typeof compileFiles>[1] = {},
): readonly string[] {
  return compileFiles(files, options).diagnostics.map(({ message }) => message);
}

/** Every diagnostic the project reported, for the fixits and notes. */
function reports(
  files: readonly (readonly [string, string])[],
): readonly Diagnostics.Diagnostic[] {
  return compileFiles(files).diagnostics;
}

/**
 * One file's text with every edit of one diagnostic's sole fix applied — the
 * proof that a rewrite is the repair and not a gesture at one (Declarations
 * Preamble §1.1). Edits are applied last-first so earlier spans keep their
 * offsets.
 */
function applied(text: string, diagnostic: Diagnostics.Diagnostic | undefined): string {
  const [fix, ...rest] = diagnostic?.fixes ?? [];
  expect(rest).toEqual([]);
  return [...fix?.edits ?? []]
    .sort((left, right) => right.span.start.offset - left.span.start.offset)
    .reduce(
      (document, { span, replacement }) =>
        document.slice(0, span.start.offset) + replacement + document.slice(span.end.offset),
      text,
    );
}

/** The emitted addresses of a project's own modules — the prelude's dropped. */
function projectPaths(
  files: readonly (readonly [string, string])[],
  options: Parameters<typeof compileFiles>[1] = {},
): readonly string[] {
  return compileFiles(files, options).modules
    .filter(({ name }) => !name.startsWith("Hex."))
    .map(({ path }) => path);
}

const POINT = "export record Point = {x: Float, y: Float}\n";

describe("§13 (o) — every file declares its module", () => {
  test("a headerless file is refused, and the fixit inserts the derived header", () => {
    const text = "export fun parse(s: String): Int = 1\n";
    const [diagnostic, ...rest] = reports([["/search-params.hex", text]]);
    expect(diagnostic?.message).toBe(
      "every file declares its module; write `module SearchParams`",
    );
    expect(rest).toEqual([]);
    // The derivation is the fixit's alone: it upper-cases each separator-
    // delimited segment and joins them, and the compiler reads no name off a
    // path (§2.1, §9.2).
    expect(applied(text, diagnostic)).toBe(`module SearchParams\n\n${text}`);
    expect(messages([["/search-params.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("a basename yielding no uppercase-start identifier names the slot, with no edit", () => {
    const [diagnostic, ...rest] = reports([["/2d-utils.hex", "export let n: Int = 1\n"]]);
    expect(diagnostic?.message).toBe("every file declares its module; write `module <Name>`");
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("items above a header are code outside a module, and the header is named", () => {
    // §2.2's family, not §2.1's: the file *does* declare its module, so no name
    // derived from a path is offered — a spelling the language never reads.
    // §10's row verbatim, as `8e5c7fc` (#835) settled it: the repair moves the
    // **header**, which is §2.2's own direction ("every module begins with its
    // header … its fixit the header moved above the item").
    expect(messages([["/f.hex", "let stray: Int = 1\nmodule Geometry\n" + POINT]])).toEqual([
      "code outside a module: a module begins with its header; " +
      "move `module Geometry` above this item",
    ]);
  });

  test("and the fixit moves the header, blank run and all, to the top of the file", () => {
    // §2.2 states the direction and the edit performs it: the header's own line
    // is lifted from where it stands and put back above the item. The blank
    // line the author left under it travels with it — a repair reformats
    // nothing — and the file it produces compiles, which is the only reading of
    // "its fixit" worth having (Declarations Preamble §1.1's Rewrite Rule).
    const text = "let stray: Int = 1\n\nmodule Geometry\n\n" + POINT;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "code outside a module: a module begins with its header; " +
        "move `module Geometry` above this item",
    );
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Geometry\n\nlet stray: Int = 1\n\n" + POINT,
    );
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("the header moved is the file's first, in a file that declares several", () => {
    // The row is about the items above the **first** header, so that is the
    // header the edit moves — and the modules the repaired file declares are
    // the modules the refused one declared, in the order it declared them.
    const text = "let stray: Int = 1\n\nmodule Geometry\n\n" + POINT +
      "\nend module Geometry\n\nmodule Shapes\n\nexport let n: Int = 1\n";
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Geometry\n\nlet stray: Int = 1\n\n" + POINT +
        "\nend module Geometry\n\nmodule Shapes\n\nexport let n: Int = 1\n",
    );
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
    expect(compileFiles([["/f.hex", applied(text, diagnostic)]]).modules
      .filter(({ name }) => !name.startsWith("Hex.")).map(({ name }) => name))
      .toEqual(["Geometry", "Shapes"]);
  });

  test("a doc comment above the stray item keeps the declaration it documents", () => {
    // The one placement that would change what the file *means*: a doc comment
    // attaches to what immediately follows it (`spec/doc-comments.md` §2.1), so
    // the edit goes above the comment rather than between the two. The top of
    // the file is above every comment there is, which is why it is the seat.
    const text = "(** The stray. *)\nlet stray: Int = 1\n\nmodule Geometry\n\n" + POINT;
    const [diagnostic] = reports([["/f.hex", text]]);
    expect(applied(text, diagnostic)).toBe(
      "module Geometry\n\n(** The stray. *)\nlet stray: Int = 1\n\n" + POINT,
    );
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("a refused header is repaired at its own seat first; the move stands down", () => {
    // Two reports at one line, and their edits would overlap: the casing
    // rewrite replaces the name, the move deletes the line the name is in. A
    // host applying both at once ("fix all in file") has no defined result from
    // a pair of overlapping spans, so the collision is *removed* rather than
    // ordered around — the same call review round 3 made for the two fixes a
    // headerless file used to offer at offset zero.
    //
    // The header's own repair is the one left standing, because it is the one
    // that has to happen either way, and because a move that wrote the name the
    // message spells would be editing inside the line it also deletes. The row
    // keeps its message: what it says is true of this file whether or not an
    // edit can be offered for it.
    const text = "let stray: Int = 1\n\nmodule geometry\n\n" + POINT;
    const [moved, cased, ...rest] = reports([["/f.hex", text]]);
    expect(moved?.message).toBe(
      "code outside a module: a module begins with its header; " +
        "move `module Geometry` above this item",
    );
    expect(moved?.fixes ?? []).toEqual([]);
    expect(cased?.message).toBe("a module name is uppercase-start; write `module Geometry`");
    expect(rest).toEqual([]);
    // And the two repairs compose in sequence, which is what the removal buys:
    // the casing rewrite lands, the row is recomputed against the file it made,
    // and *that* move repairs the file to nothing.
    const recased = applied(text, cased);
    expect(recased).toBe("let stray: Int = 1\n\nmodule Geometry\n\n" + POINT);
    const [again, ...others] = reports([["/f.hex", recased]]);
    expect(others).toEqual([]);
    expect(applied(recased, again)).toBe("module Geometry\n\nlet stray: Int = 1\n\n" + POINT);
    expect(messages([["/f.hex", applied(recased, again)]])).toEqual([]);
  });

  test("a lawful header spaced around its dots still moves — nothing refused it", () => {
    // The near neighbour of the stand-down above, and the reason it is keyed to
    // whether §2.1's seat published an *edit* rather than to whether the
    // header's written text is its canonical spelling. `module Acme . Geometry`
    // is a lawful header — one name, whose segments the layout dots (§2.3) —
    // written with space around the dot. Its text differs from `Acme.Geometry`
    // and nothing refuses it, so there is no second repair to collide with and
    // a verbatim lift is the repair, exactly as it is when the dot is tight.
    for (const header of ["module Acme . Geometry", "module Acme .Geometry"]) {
      const text = `let stray: Int = 1\n\n${header}\n\n${POINT}`;
      const [diagnostic, ...rest] = reports([["/f.hex", text]]);
      expect(diagnostic?.message).toBe(
        "code outside a module: a module begins with its header; " +
          "move `module Acme.Geometry` above this item",
      );
      expect(rest).toEqual([]);
      // Verbatim: the spacing the author wrote travels with the line, because a
      // repair moves a line and reformats nothing.
      expect(applied(text, diagnostic)).toBe(
        `${header}\n\nlet stray: Int = 1\n\n${POINT}`,
      );
      expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
    }
  });

  test("a header whose name spans two lines: the move stands down, message only", () => {
    // A dotted name may be broken across lines, and what this move lifts is a
    // *line*. The header's extent is then not a thing the line arithmetic can
    // carry, so the lift is declined rather than made to guess where the name
    // ends — the same call as the two stand-downs beside it, and its own
    // condition rather than the casing test's shadow.
    const text = "let stray: Int = 1\n\nmodule Acme.\n    Geometry\n\n" + POINT;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "code outside a module: a module begins with its header; " +
        "move `module Acme.Geometry` above this item",
    );
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("an item and the header on one line: the move stands down, message only", () => {
    // `;` separates block items, so this is a lawful line that draws the row —
    // and the header's line is the stray item's line. Lifting the line and
    // putting it back at the top is two edits that cancel: the lightbulb is
    // offered, the user clicks it, and the file is unchanged with the error
    // still standing. An offered rewrite must rewrite (Declarations Preamble
    // §1.1), so where a verbatim lift cannot, none is offered.
    const text = "let stray: Int = 1; module Geometry\n\n" + POINT;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "code outside a module: a module begins with its header; " +
        "move `module Geometry` above this item",
    );
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("the header on the file's last line, ended by nothing, still moves", () => {
    // The file an author has while they are typing the header: the line exists
    // and no Return has been pressed yet, and the lightbulb is live at that
    // keystroke. A lift that carried no terminator would weld the header to the
    // line it lands above — `module Geometrylet stray: Int = 1` — so the line
    // is written as a whole line, ended the way this file ends its own
    // (`insertedLine`).
    const text = "let stray: Int = 1\n\nmodule Geometry";
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe("module Geometry\nlet stray: Int = 1\n\n");
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("the same file in CRLF, and with the header's line left trailing spaces", () => {
    // The terminator the move supplies is the file's own, so a CRLF file keeps
    // its endings here as it does where the lift carries them; and the lifted
    // text stays verbatim, trailing whitespace included, because a repair
    // reformats nothing.
    const crlf = "let stray: Int = 1\r\n\r\nmodule Geometry";
    const [crlfReport] = reports([["/f.hex", crlf]]);
    expect(applied(crlf, crlfReport)).toBe("module Geometry\r\nlet stray: Int = 1\r\n\r\n");
    expect(messages([["/f.hex", applied(crlf, crlfReport)]])).toEqual([]);

    const spaced = "let stray: Int = 1\n\nmodule Geometry   ";
    const [spacedReport] = reports([["/f.hex", spaced]]);
    expect(applied(spaced, spacedReport)).toBe("module Geometry   \nlet stray: Int = 1\n\n");
    expect(messages([["/f.hex", applied(spaced, spacedReport)]])).toEqual([]);
  });

  test("a CRLF file keeps its line endings — the lifted text is the file's own", () => {
    // Nothing in a token stream says how a line ends. The edit slices the text
    // it moves out of the file it is repairing, so the `\r` travels with its
    // line instead of being reconstructed as a bare `\n` (review round 3's NB4,
    // at the seat this round adds).
    const text = "let stray: Int = 1\r\n\r\nmodule Geometry\r\n\r\n" +
      "export record Point = {x: Float, y: Float}\r\n";
    const [diagnostic] = reports([["/f.hex", text]]);
    expect(applied(text, diagnostic)).toBe(
      "module Geometry\r\n\r\nlet stray: Int = 1\r\n\r\n" +
        "export record Point = {x: Float, y: Float}\r\n",
    );
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("a second header met with one open is refused, and the fixit closes the first", () => {
    const text = `module Geometry\n${POINT}module Shapes\nexport let n: Int = 1\n`;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "a file holding several modules closes each with `end module Geometry`",
    );
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      `module Geometry\n${POINT}end module Geometry\n\nmodule Shapes\nexport let n: Int = 1\n`,
    );
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("a closer naming another module is refused, and the fixit names the open one", () => {
    const text = `module Geometry\n${POINT}end module Shapes\n`;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "`end module Shapes` closes `module Geometry`; write `end module Geometry`",
    );
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(`module Geometry\n${POINT}end module Geometry\n`);
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("code after a closer is refused, once, at the first such item", () => {
    expect(messages([[
      "/f.hex",
      `module Geometry\n${POINT}end module Geometry\nlet stray: Int = 1\nlet other: Int = 2\n`,
    ]])).toEqual([
      "code outside a module: `end module Geometry` ended the module above; " +
      "open another with `module Name`",
    ]);
  });

  test("a closer with no module open is refused", () => {
    expect(messages([["/f.hex", `module Geometry\n${POINT}end module Geometry\nend module Geometry\n`]]))
      .toEqual([
        "`end module Geometry` closes no module; open one with `module Name`",
      ]);
  });

  test("the closer is optional in a one-module file, and legal there", () => {
    expect(messages([["/f.hex", `module Geometry\n${POINT}end module Geometry\n`]])).toEqual([]);
    expect(messages([["/f.hex", `module Geometry\n${POINT}`]])).toEqual([]);
  });

  test("two modules sharing a file are strangers: neither's names are in scope", () => {
    // §13(o)'s golden, and rule 1's **one report at every seat** (#829's Ruling
    // A): the type seat and the term seat of one line draw the same sentence
    // with the same repair, where before they drew ``unknown module alias
    // `Geometry` `` and ``unknown name `Geometry` `` — two descriptions of one
    // mistake, one of them silent about the module the writer meant.
    expect(messages([[
      "/f.hex",
      `module Geometry\n${POINT}end module Geometry\n` +
      "module Shapes\nexport fun unit(): Geometry.Point = Geometry.Point({x = 1.0, y = 2.0})\n",
    ]])).toEqual([
      "no module alias `Geometry`; `import Geometry`",
      "no module alias `Geometry`; `import Geometry`",
    ]);
  });

  test("the strangers' repair is one edit, and it makes the file compile", () => {
    // The applied edit §5.1 obliges, at the seat the review met it: the line is
    // placed below `module Shapes`' own header — not the file's first — and
    // both seats carry the identical insert, so applying either repairs the
    // module whole.
    const text = `module Geometry\n${POINT}end module Geometry\n` +
      "module Shapes\nexport fun unit(): Geometry.Point = Geometry.Point({x = 1.0, y = 2.0})\n";
    const reported = compileFiles([["/f.hex", text]]).diagnostics;
    const fixes = reported.map(({ fixes: each }) => each![0]!);
    expect(fixes.map(({ message }) => message)).toEqual(["import `Geometry`", "import `Geometry`"]);
    const repaired = `module Geometry\n${POINT}end module Geometry\n` +
      "module Shapes\nimport Geometry\n" +
      "export fun unit(): Geometry.Point = Geometry.Point({x = 1.0, y = 2.0})\n";
    for (const fix of fixes) {
      const edit = fix.edits[0]!;
      expect(
        text.slice(0, edit.span.start.offset) + edit.replacement +
          text.slice(edit.span.end.offset),
      ).toBe(repaired);
    }
    expect(messages([["/f.hex", repaired]])).toEqual([]);
  });

  /**
   * §13(o)'s own second file, run verbatim: `module Geometry` declaring an
   * `export record Point`, a use of `Point.make` above the declaration of
   * `make` and another below it, then `module Shapes` qualifying through the
   * stranger above it and through itself.
   *
   * The record is what makes the specimen worth running: a record declares a
   * type **and** a constructor of one spelling, so before this the two
   * `Point.make` lines never reached rule 1 at all — the resolver read `Point.`
   * as a field access on the constructor and the writer was handed `type
   * mismatch: expected ({x: Float, y: Float}) -> Point, found {make: a, ...}`.
   */
  test("§13(o)'s own-type carve and self-qualification, over a record", () => {
    const text = "module Geometry\n" + POINT +
      "export let scale: Float = 1.0\n" +
      "export let p: Point = Point.make(1.0, 1.0)\n" +
      "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n" +
      "export let o: Point = Point.make(0.0, 0.0)\n" +
      "end module Geometry\n" +
      "module Shapes\n" +
      "export let two: Float = 2.0 * Geometry.scale\n" +
      "export let four: Float = Shapes.two * 2.0\n" +
      "export fun grow(two: Float): Float = Shapes.two * two\n";
    const reported = reports([["/f.hex", text]]);
    expect(reported.map(({ message }) => message)).toEqual([
      // `p` sits above `make`, and a `let`'s right-hand side sees no
      // declaration below it (Functions §7.2), so no repair is named.
      "`Point` is a type, not a module",
      // `o` sits below it, so the bare spelling names the module's own binding
      // and the qualifier is dropped — never `import Geometry` into itself.
      "`Point` is a type, not a module; write `make(0.0, 0.0)`",
      "no module alias `Geometry`; `import Geometry`",
      // The repair drops the qualifier from the **reference**, which is what
      // §5.1's normative example writes and what §13(o)'s golden quotes
      // ("write `two`"): the two spellings agree, and this is the one the
      // compiler emits.
      "a module does not qualify through itself; write `two`",
      // `two` here is `grow`'s parameter, which eclipses the module's own
      // binding, so the sentence stands alone.
      "a module does not qualify through itself",
    ]);
    expect(reported[0]?.fixes).toBeUndefined();
    expect(reported[4]?.fixes).toBeUndefined();
    // And every named repair is one a reader can apply. Applying the three that
    // name one leaves exactly the two that named none — which is the point of
    // withholding them: neither `p`'s drop nor `grow`'s would have compiled.
    const repaired = "module Geometry\n" + POINT +
      "export let scale: Float = 1.0\n" +
      "export let p: Point = Point.make(1.0, 1.0)\n" +
      "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n" +
      "export let o: Point = make(0.0, 0.0)\n" +
      "end module Geometry\n" +
      "module Shapes\n" +
      "import Geometry\n" +
      "export let two: Float = 2.0 * Geometry.scale\n" +
      "export let four: Float = two * 2.0\n" +
      "export fun grow(two: Float): Float = Shapes.two * two\n";
    expect(messages([["/f.hex", repaired]])).toEqual([
      "`Point` is a type, not a module",
      "a module does not qualify through itself",
    ]);
    // The withheld drops, taken anyway, are the programs the condition refuses
    // to write: `p`'s names a declaration it does not yet see, and `grow`'s
    // names the parameter.
    expect(messages([["/f.hex", repaired.replace("Point.make(1.0, 1.0)", "make(1.0, 1.0)")]]))
      .toContain(
        "`make` is declared later in this block; declarations are read " +
          "top-down — move its declaration above this use",
      );
  });

  /**
   * The refused-head suppression is read **per module**, not per file (§5.1's
   * "a refused import head that offers the same line by its own rewrite … the
   * seats below it carry none" — the seats *below it*, in the module it stands
   * in). A stranger above a module is a stranger for this rule too: without the
   * partition, a bad head in one module silently takes the repair away from a
   * use in the next, and the reader is left with a sentence and nothing to
   * apply for a reason nothing on their screen states.
   */
  test("a refused head takes the edit only from the module it stands in", () => {
    const text = "module First\n" + "import geometry\n" + "end module First\n" +
      "module Second\n" + "export let two: Float = 2.0 * Geometry.scale\n";
    const reported = reports([
      ["/g.hex", "module Geometry\n\nexport let scale: Float = 1.0\n"],
      ["/f.hex", text],
    ]);
    const seat = reported.find(({ message }) => message.startsWith("no module alias"));
    expect(seat?.message).toBe("no module alias `Geometry`; `import Geometry`");
    const edit = seat?.fixes?.[0]?.edits[0];
    expect(edit).toBeDefined();
    // Below `module Second`'s own header, not `module First`'s.
    expect(
      text.slice(0, edit!.span.start.offset) + edit!.replacement +
        text.slice(edit!.span.end.offset),
    ).toBe(
      "module First\n" + "import geometry\n" + "end module First\n" +
        "module Second\n" + "import Geometry\n" +
        "export let two: Float = 2.0 * Geometry.scale\n",
    );
  });

  /**
   * The notation is the **language's**, so its markers are read by the lexer
   * and are trivia or text wherever the lexer says they are — a fact the
   * Playground's retired splitter scanned lines to approximate, and got wrong
   * in both directions (#831). Pinned here because the splitter's own tests for
   * it went with it, and this is the seat that owes them.
   */
  test("a `module` header inside a string is a string, and a commented-out import is a comment", () => {
    const text = "module Main\n\n" +
      'export let banner: String = "module Helper\\nend module Helper\\n"\n' +
      "// import Geometry\n" +
      "(* import Geometry *)\n" +
      "export let n: Int = 1\n";
    // One module, not three: the file declares exactly the header it wrote.
    const project = compileFiles([["/f.hex", text]]);
    expect(project.diagnostics).toEqual([]);
    expect(project.modules.map(({ path }) => path)).toEqual(["/Main.hex"]);
    // And the commented-out import binds nothing, which is the other half: a
    // use of `Geometry` below it draws §5.1 rule 1's report, not a resolution.
    expect(messages([[
      "/g.hex",
      "module Geometry\n\nexport let scale: Float = 1.0\n",
    ], [
      "/f.hex",
      "module Main\n\n// import Geometry\n" +
      "export let n: Float = Geometry.scale\n",
    ]])).toEqual(["no module alias `Geometry`; `import Geometry`"]);
  });

  test("a header below the top level is refused, the name uppercase-start", () => {
    expect(messages([[
      "/f.hex",
      "module Geometry\nfun f(): Int =\n    module Inner\n    1\n",
    ]])).toEqual([
      "`module` and `end module` mark a module at a file's top level; " +
      "a module cannot be declared or closed inside a block",
    ]);
  });
});

describe("§13 (o) — the miscased header (#838)", () => {
  test("`module geometry` is refused with the header's own rewrite", () => {
    const text = `module geometry\n${POINT}`;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "a module name is uppercase-start; write `module Geometry`",
    );
    // The reading recovers as the rewrite spells it, so the file has its
    // header: no headerless report follows it.
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(`module Geometry\n${POINT}`);
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("each dot-separated segment is upper-cased and the dots are kept", () => {
    const text = `module render.geometry\n${POINT}`;
    expect(messages([["/f.hex", text]])).toEqual([
      "a module name is uppercase-start; write `module Render.Geometry`",
    ]);
    expect(applied(text, reports([["/f.hex", text]])[0])).toBe(
      `module Render.Geometry\n${POINT}`,
    );
    // One segment wrong is the same one name (§2.3), not a name and a stray dot.
    expect(messages([["/f.hex", `module Render.geometry\n${POINT}`]])).toEqual([
      "a module name is uppercase-start; write `module Render.Geometry`",
    ]);
  });

  test("a header whose upper-casing is a no-op names the slot and carries no edit", () => {
    const [diagnostic, ...rest] = reports([["/f.hex", `module 用户\n${POINT}`]]);
    expect(diagnostic?.message).toBe(
      "a module name is uppercase-start; write `module <Name>`",
    );
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("the slot's test is that no *lawful* name results, not that nothing changed", () => {
    // §13(o)'s `internal.hex`. Upper-casing `_internal.util` yields
    // `_internal.Util` — a different spelling, and still no module name, since
    // every segment has to be uppercase-start. The message names the slot, and
    // no edit is offered: writing `_internal.Util` would repair one refusal
    // into another (#838).
    const [diagnostic, ...rest] = reports([["/internal.hex", `module _internal.util\n${POINT}`]]);
    expect(diagnostic?.message).toBe("a module name is uppercase-start; write `module <Name>`");
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
    // And the reading recovers under the *written* spelling, there being no
    // other: the file has its header, so no headerless report follows, and the
    // name the file's own checks see is `_internal.util`.
    expect(
      compileFiles([["/internal.hex", `module _internal.util\n${POINT}`]])
        .modules.filter(({ name }) => !name.startsWith("Hex."))
        .map(({ name }) => name),
    ).toEqual(["_internal.util"]);
  });

  test("the recovered name meets §2.2's first-segment rule at the same header", () => {
    // §13(o)'s `util.hex`: two reports at one line. The casing rewrite names
    // the very spelling the first-segment rule then refuses, so the rewrite is
    // one repair of two and the rename is the one that reaches legal code.
    expect(messages([["/util.hex", `module hex.util\n${POINT}`]])).toEqual([
      "a module name is uppercase-start; write `module Hex.Util`",
      "`Hex.Util` begins with the name of the package `Hex`; a dotted module's first " +
      "segment cannot name a package in the program; rename the module",
    ]);
    // At the slot the reach is the same: a dotted slot name whose first segment
    // names a package draws the first-segment report beside the casing one,
    // against the spelling the file recovered under.
    expect(messages([["/i.hex", `module Hex._internal\n${POINT}`]])).toEqual([
      "a module name is uppercase-start; write `module <Name>`",
      "`Hex._internal` begins with the name of the package `Hex`; a dotted module's first " +
      "segment cannot name a package in the program; rename the module",
    ]);
  });

  test("a slot name is a declaration for the package's duplicate rule, and renames", () => {
    // §13(o)'s `a.hex`/`b.hex`. The written spelling is a declaration for the
    // file's and the package's own checks — no importer can spell it — so two
    // files declaring `用户` collide. The dotted hint is unspellable here, no
    // dotting making such a name lawful, so the hint is a rename instead.
    const [first, second, duplicate, ...rest] = reports([
      ["/a.hex", `module 用户\n${POINT}`],
      ["/b.hex", "module 用户\nexport let n: Int = 1\n"],
    ]);
    // a.hex draws its casing report; b.hex draws its own and the duplicate.
    expect([first?.message, second?.message, duplicate?.message]).toEqual([
      "a module name is uppercase-start; write `module <Name>`",
      "a module name is uppercase-start; write `module <Name>`",
      "module `用户` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
    expect(duplicate?.notes).toEqual(["rename the module"]);
    expect(rest).toEqual([]);
    // A lawful name keeps the dotted hint: the rename is the slot's answer,
    // not the rule's.
    expect(
      reports([
        ["/a.hex", `module Geometry\n${POINT}`],
        ["/b.hex", "module Geometry\nexport let n: Int = 1\n"],
      ])[0]?.notes,
    ).toEqual(["give one a dotted name, `module Render.Geometry`"]);
  });

  test("§2.2's reports fire against the rewritten name, each at its own seat", () => {
    // The closer is never a casing seat: `end module geometry` under the
    // recovered `Geometry` draws §2.2's closer-naming rule and nothing else.
    expect(messages([["/f.hex", `module geometry\n${POINT}end module geometry\n`]])).toEqual([
      "a module name is uppercase-start; write `module Geometry`",
      "`end module geometry` closes `module Geometry`; write `end module Geometry`",
    ]);
    // A second header, judged against the recovered name.
    expect(messages([["/f.hex", `module geometry\n${POINT}module Shapes\nlet n: Int = 1\n`]]))
      .toEqual([
        "a module name is uppercase-start; write `module Geometry`",
        "a file holding several modules closes each with `end module Geometry`",
      ]);
    // And the duplicate-name rule, against the recovered name too.
    expect(messages([
      ["/a.hex", `module Geometry\n${POINT}`],
      ["/b.hex", "module geometry\nexport let n: Int = 1\n"],
    ])).toEqual([
      "a module name is uppercase-start; write `module Geometry`",
      "module `Geometry` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
  });

  test("a header both miscased and second draws both reports, edits that compose", () => {
    const text = `module Geometry\n${POINT}module shapes\nexport let n: Int = 1\n`;
    const [casing, second, ...rest] = reports([["/f.hex", text]]);
    expect([casing?.message, second?.message]).toEqual([
      "a module name is uppercase-start; write `module Shapes`",
      "a file holding several modules closes each with `end module Geometry`",
    ]);
    expect(rest).toEqual([]);
    // Neither edit stands in the other's way: applying both — the later span
    // first, as a host applying two edits to one document does — reaches a
    // file that compiles.
    expect(messages([["/f.hex", applied(applied(text, casing), second)]])).toEqual([]);
  });

  test("the module the file recovers under is the one an importer names", () => {
    expect(messages([
      ["/g.hex", `module geometry\n${POINT}`],
      ["/main.hex", "module Main\n\nimport Geometry\nexport let p: Geometry.Point = " +
        "Geometry.Point({x = 1.0, y = 2.0})\n"],
    ])).toEqual(["a module name is uppercase-start; write `module Geometry`"]);
  });

  test("below the top level `module geometry` is the ordinary parse error", () => {
    // The seat is not claimed there: no header was ever possible, so there is
    // nothing to redirect to (§2.1).
    expect(messages([["/f.hex", "module Geometry\nfun f(): Int =\n    module geometry\n    1\n"]]))
      .toEqual([
        "unknown name `module`",
        "expected a newline or `;` between block items",
      ]);
  });
});

describe("§2.2 / Comments §6 — a file's comments are cut with its modules", () => {
  /**
   * Modules §11 emits one JavaScript file per module, and Comments §6 preserves
   * a module's comments in it. A file holding several modules therefore has to
   * cut the comment list at the same places it cuts the item list: the parser
   * handed every section the whole file's `comments`, so each emitted module
   * carried every other module's comments — and, because the blank-line rhythm
   * is measured between the entries' spans, a run of blank lines where the
   * other module's items stood.
   *
   * The cut is by offset at each section's end: a comment above the file's
   * first header belongs to the module that header opens, as the items above it
   * do; a comment between a closer and the next header belongs to the module it
   * stands above.
   */
  test("each module's emitted JavaScript carries its own comments and no others", () => {
    const project = compileFiles([["/f.hex",
      "// above the first header\n" +
      "module Numbers\n" +
      "\n" +
      "// Numbers own line\n" +
      "export let answer: Int = 21\n" +
      "\n" +
      "end module Numbers\n" +
      "\n" +
      "// written above the second header\n" +
      "module Main\n" +
      "\n" +
      "// Main own line\n" +
      "export let doubled: Int = 42\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const javascript = (name: string): string =>
      project.modules.find((module) => module.name === name)!.javascript.text;

    expect(javascript("Numbers")).toContain("// above the first header");
    expect(javascript("Numbers")).toContain("// Numbers own line");
    expect(javascript("Numbers")).not.toContain("// written above the second header");
    expect(javascript("Numbers")).not.toContain("// Main own line");

    expect(javascript("Main")).toContain("// written above the second header");
    expect(javascript("Main")).toContain("// Main own line");
    expect(javascript("Main")).not.toContain("// above the first header");
    expect(javascript("Main")).not.toContain("// Numbers own line");

    // The blank-run half of the same defect, pinned byte for byte: each file
    // held the *other* module's comment and a run of blank lines where the
    // other module's items stood. What is left is the two modules' own text,
    // and the same shape in both — the one blank the source wrote, plus the
    // line the header stood on, which emission has no line for.
    expect(javascript("Numbers")).toBe(
      "// above the first header\n\n\n// Numbers own line\n" +
        "const answer = 21;\nexport { answer };\n",
    );
    expect(javascript("Main")).toBe(
      "// written above the second header\n\n\n// Main own line\n" +
        "const doubled = 42;\nexport { doubled };\n",
    );
  });
});

describe("§2.2 — two modules of one name in one package", () => {
  test("the second header is refused, both files named, with the dotted hint", () => {
    const [diagnostic, ...rest] = reports([
      ["/render.hex", `module Geometry\n${POINT}`],
      ["/physics.hex", "module Geometry\nexport let n: Int = 1\n"],
    ]);
    expect(diagnostic?.message).toBe(
      "module `Geometry` is declared twice: `/render.hex` (line 1) and `/physics.hex` (line 1)",
    );
    expect(diagnostic?.notes).toEqual(["give one a dotted name, `module Render.Geometry`"]);
    expect(rest).toEqual([]);
  });

  test("the file the duplicate shadows keeps its own parse reports", () => {
    // Only one of two same-named modules is compiled — they share one layout
    // address (Packages §6) — and the other's reports would go down with it.
    // A file's *parse* reports are the file's, whatever the index then decides
    // (§2.1's stage line), so the shadowed file still draws them.
    expect(messages([
      ["/a.hex", "module Geometry\nexport let n: Int = \n"],
      ["/b.hex", `module Geometry\n${POINT}`],
    ])).toEqual([
      "expected an indented block",
      "expected an expression, found the end of a block",
      "module `Geometry` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
  });

  /**
   * One address holds **one** unit, and it is the one the rule accepted (#836
   * review B5a). The index registers the *first* declaration of a name and
   * refuses the second; the compile was keyed by a map built off the unit list,
   * where the **last** unit at an address won. So the module the rule accepted
   * was the one nobody could reach: an importer writing `Geo.x` against the
   * accepted `/a.hex` was told `` module `Geo` does not export `x` ``, naming
   * an export that is there.
   */
  test("the accepted duplicate is the one compiled, and the importer reaches it", () => {
    expect(messages([
      ["/a.hex", "module Geo\n\nexport let x: Int = 1\n"],
      ["/b.hex", "module Geo\n\nexport let y: Int = 2\n"],
      ["/main.hex", "module Main\n\nimport Geo\nexport let n: Int = Geo.x\n"],
    ])).toEqual([
      "module `Geo` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
  });

  test("the comparison folds case, on the emitted filesystem's account (§11.1)", () => {
    expect(messages([
      ["/a.hex", `module Geometry\n${POINT}`],
      ["/b.hex", "module GEOMETRY\nexport let n: Int = 1\n"],
    ])).toEqual([
      "module `GEOMETRY` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
  });

  test("two modules of one name in *different* packages are legal", () => {
    // The project's own `Option` beside the prelude's — §5.4's occlusion, and
    // the case the case-fold rule must not catch.
    expect(messages([["/o.hex", "module Option\nexport let n: Int = 1\n"]])).toEqual([]);
  });
});

describe("§2.2 — a dotted module's first segment never names a package", () => {
  test("the standard library's own name is refused at the header", () => {
    expect(messages([["/f.hex", "module Hex.Util\nexport let n: Int = 1\n"]])).toEqual([
      "`Hex.Util` begins with the name of the package `Hex`; a dotted module's first " +
      "segment cannot name a package in the program; rename the module",
    ]);
  });

  /**
   * The refused name lays out at an **injected** module's address, and must not
   * take it (#836 review B5b). `module Hex.Option` seats at `/Hex/Option.hex`,
   * where `stdlib/Option.hex` already sits; pushed after the injected units, it
   * won the compile's maps and the whole standard library collapsed behind it —
   * two hundred reports naming files the author has never opened, and one they
   * could act on buried among them. The user's file also took `isPrelude`, and
   * with it the `privileged` intrinsic door, by a route `gatherModules`' own
   * two-halves adoption test was written to close.
   */
  test("a refused `Hex.*` name never displaces the prelude module at its address", () => {
    const project = compileFiles([
      ["/mine.hex", "module Hex.Option\n\nexport let mine: Int = 1\n"],
      ["/main.hex", "module Main\n\nexport let x: Option(Int) = Some(1)\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "`Hex.Option` begins with the name of the package `Hex`; a dotted module's " +
      "first segment cannot name a package in the program; rename the module",
    ]);
    // The seat is the prelude's, and the prelude is intact: `Option` is still a
    // generic type and `Some` still a constructor.
    const seated = project.modules.filter(({ path }) => path === "/Hex/Option.hex");
    expect(seated.map(({ name }) => name)).toEqual(["Hex.Option"]);
  });

  test("a listed dependency's name is refused at the header", () => {
    expect(messages(
      [["/f.hex", "module Acme.Geometry\nexport let n: Int = 1\n"]],
      { dependencies: ["Acme"] },
    )).toEqual([
      "`Acme.Geometry` begins with the name of the package `Acme`; a dotted module's " +
      "first segment cannot name a package in the program; rename the module",
    ]);
  });

  test("the project's own name is refused at the header too", () => {
    expect(messages(
      [["/f.hex", "module MyApp.Geometry\nexport let n: Int = 1\n"]],
      { packageName: "MyApp" },
    )).toEqual([
      "`MyApp.Geometry` begins with the name of the package `MyApp`; a dotted module's " +
      "first segment cannot name a package in the program; rename the module",
    ]);
  });

  test("an undotted name beside a package of that name is fine", () => {
    // §13(o)'s fourth file: `module Json` beside a dependency `Json`.
    expect(messages(
      [["/f.hex", "module Json\nexport let n: Int = 1\n"]],
      { dependencies: ["Json"] },
    )).toEqual([]);
  });

  test("a dotted name whose first segment names no package is fine", () => {
    expect(messages([["/f.hex", `module Render.Geometry\n${POINT}`]])).toEqual([]);
  });
});

describe("§13 (p) — the rows a `{project, Hex}` program reaches", () => {
  test("a package qualifying its own module draws the self-qualified report", () => {
    expect(messages(
      [
        ["/g.hex", `module Geometry\n${POINT}`],
        ["/main.hex", "module Main\n\nimport MyApp.Geometry\n"],
      ],
      { packageName: "MyApp" },
    )).toEqual([
      "no module `MyApp.Geometry`; a package's own modules are imported by their " +
      "declared names: `import Geometry`",
    ]);
  });

  test("an unknown module names the near misses, a dotted suffix included", () => {
    expect(messages([
      ["/g.hex", `module Render.Geometry\n${POINT}`],
      ["/main.hex", "module Main\n\nimport Geometry\n"],
    ])).toEqual(["no module `Geometry`; did you mean `Render.Geometry`?"]);
  });

  test("an unknown module with no near miss names none", () => {
    expect(messages([["/main.hex", "module Main\n\nimport Nowhere\n"]])).toEqual([
      "no module `Nowhere`",
    ]);
  });

  test("a dotted import binds the last segment", () => {
    expect(messages([
      ["/g.hex", `module Render.Geometry\n${POINT}`],
      ["/main.hex", "module Main\n\nimport Render.Geometry\n" +
        "export let p: Geometry.Point = Geometry.Point({x = 1.0, y = 2.0})\n"],
    ])).toEqual([]);
  });

  test("two imports landing on one alias collide, and `as` is the fixit", () => {
    expect(messages([
      ["/r.hex", `module Render.Geometry\n${POINT}`],
      ["/p.hex", "module Physics.Geometry\nexport let n: Int = 1\n"],
      ["/main.hex", "module Main\n\nimport Render.Geometry\nimport Physics.Geometry\n"],
    ])).toEqual([
      "module alias `Geometry` is already bound; write `import Physics.Geometry as <Alias>`",
    ]);
  });

  test("a second alias onto a prelude module is legal", () => {
    expect(messages([[
      "/main.hex",
      "module Main\n\nimport Option as Opt\nexport let n: Opt.Option(Int) = Opt.Some(1)\n",
    ]])).toEqual([]);
  });

  test("the prelude is reachable by its full name too", () => {
    expect(messages([[
      "/main.hex",
      "module Main\n\nimport Hex.Option as Opt\nexport let n: Opt.Option(Int) = Opt.Some(1)\n",
    ]])).toEqual([]);
  });

  test("the project's own module occludes a package's of the same name, silently", () => {
    expect(messages([
      ["/o.hex", "module Option\nexport fun mine(n: Int): Int = n\n"],
      ["/main.hex", "module Main\n\nimport Option\nexport let n: Int = Option.mine(1)\n"],
    ])).toEqual([]);
  });
});

describe("Packages §6 — the layout a module emits under", () => {
  const MAIN = ["/m.hex", "module Main\nexport let a: Int = 1\n"] as const;
  const NESTED = ["/g.hex", "module Render.Geometry\nexport let b: Int = 1\n"] as const;

  test("an unnamed project's modules lie at the output root, dotted segments as directories", () => {
    expect(projectPaths([MAIN, NESTED])).toEqual(["/Main.hex", "/Render/Geometry.hex"]);
  });

  /**
   * §6's one asymmetry, and the reason it is written down: "*the full name
   * (§2.3) as a path, **with the project's package segment elided because a
   * project may have none***". A project that gains a `name` moves no file and
   * changes no specifier — only its modules' full names gain the segment.
   */
  test("a named project's modules lie at the root too — the package segment is elided", () => {
    expect(projectPaths([MAIN, NESTED], { packageName: "MyApp" })).toEqual([
      "/Main.hex",
      "/Render/Geometry.hex",
    ]);
  });

  /**
   * The elision is one rule, so it has to be **one computation**: the address a
   * unit is seated at and the address an import edge points at are the same
   * address or the program does not link (#836 review B1).
   *
   * Nothing above catches it, because `MAIN` and `NESTED` do not import each
   * other. With the edge laying the full name out a second time — without the
   * project's name — a named project's every cross-module import reported
   * `` unknown name `Geometry` `` and emitted `from ".js"`, which is not a
   * module at all; unnamed projects were unaffected, so every suite stayed
   * green. `language-server`'s workspace passes `packageName` straight through
   * from `hexagon.json`, so this was the first thing a real named project met.
   */
  test("a named project's modules import each other, and the specifier is the layout's", async () => {
    const files = [
      ["/g.hex", "module Geometry\n\nexport let area: Int = 3\n"],
      ["/r.hex", "module Render.Geometry\n\nexport let depth: Int = 4\n"],
      ["/main.hex",
        "module Main\n\n" + "import Geometry\nimport Render.Geometry as Deep\n" +
        "export let x: Int = Geometry.area + Deep.depth\n"],
    ] as const;
    for (const options of [{}, { packageName: "Acme" }]) {
      const project = compileFiles(files, options);
      expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
      const main = project.modules.find(({ name }) => name.endsWith("Main"))!;
      expect(main.javascript.text).toContain('import * as Geometry from "./Geometry.js";');
      expect(main.javascript.text).toContain('import * as Deep from "./Render/Geometry.js";');
    }
    // And it runs: a linked graph is the only proof the specifiers are real.
    // The root is named by its **full** name, which is what a named project's
    // module identity is (Packages §2.3).
    expect((await runProject(files, { packageName: "Acme", entry: "Acme.Main" }))["x"]).toBe(7);
  });

  test("the full name keeps the segment the layout drops", () => {
    const named = compileFiles([MAIN, NESTED], { packageName: "MyApp" });
    expect(named.modules.filter(({ name }) => !name.startsWith("Hex.")).map(({ name }) => name))
      .toEqual(["MyApp.Main", "MyApp.Render.Geometry"]);
  });

  test("the prelude specifier's depth follows the emitted file, named project or not", () => {
    for (const options of [{}, { packageName: "MyApp" }]) {
      const project = compileFiles(
        [
          ["/m.hex", "module Main\nexport let a: String = show(1)\n"],
          ["/g.hex", "module Render.Geometry\nexport let b: String = show(1)\n"],
        ],
        options,
      );
      const of = (name: string): string =>
        project.modules.find((module) => module.name.endsWith(name))!.javascript.text;
      expect(of("Main")).toContain('"./Hex/');
      expect(of("Render.Geometry")).toContain('"../Hex/');
    }
  });

  /**
   * The collision probe claims root-level names, so it can only work while the
   * project's modules are *at* the root (`runtimeDeclarationsBasename`). A
   * named project whose modules emitted under `MyApp/` would leave the probe
   * unable to fire at all.
   */
  test("a project module named `Hex` moves the generated runtime file, named project or not", () => {
    for (const options of [{}, { packageName: "MyApp" }]) {
      const project = compileFiles(
        [
          ["/hex.hex", "module Hex_\nexport let a: Int = 1\n"],
          ["/main.hex", "module Hex\nexport let b: Int = 1\n"],
        ],
        options,
      );
      expect(project.modules.some(({ path }) => path === "/Hex.hex")).toBe(true);
    }
  });
});

describe("Modules §11.1 / FFI Part 4 §2.1 — a foreign specifier is emitted verbatim", () => {
  /** The specifiers one module's emitted JavaScript imports from. */
  function specifiers(javascript: string): readonly string[] {
    return [...javascript.matchAll(/from\s+"([^"]+)"|^import\s+"([^"]+)"/gmu)]
      .map(([, from, bare]) => from ?? bare!);
  }

  test("a dotted module's relative specifier is copied, not re-based", () => {
    // `Deep/Nested.js` names `Deep/world.js`, which Hexagon neither writes nor
    // places: the specifier is JavaScript's own and resolves from the emitted
    // file (FFI Part 4 §2.1, #839).
    const project = compileFiles([[
      "/n.hex",
      "module Deep.Nested\n\n" +
      'extern from "./world.js"\n    fun boom(): Int\n' +
      "export let n: Int = boom()\n",
    ]]);
    const nested = project.modules.find(({ name }) => name === "Deep.Nested")!;
    expect(nested.path).toBe("/Deep/Nested.hex");
    expect(specifiers(nested.javascript.text)).toContain("./world.js");
  });

  test("a module whose source sits in a subdirectory keeps its specifier too", () => {
    const project = compileFiles([[
      "/src/app.hex",
      "module Main\n\n" +
      'extern import "./register.js"\n' +
      "export let n: Int = 1\n",
    ]]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    expect(main.path).toBe("/Main.hex");
    expect(specifiers(main.javascript.text)).toContain("./register.js");
  });

  test("a bare specifier is copied verbatim as well", () => {
    const project = compileFiles([[
      "/n.hex",
      "module Deep.Nested\n\n" +
      'extern from "tiny-json"\n    fun parse(s: String): Int\n' +
      'export let n: Int = parse("1")\n',
    ]]);
    expect(specifiers(project.modules.find(({ name }) => name === "Deep.Nested")!.javascript.text))
      .toContain("tiny-json");
  });
});
