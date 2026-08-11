import { describe, expect, test } from "vitest";

import { compileMain } from "../support/test-project.js";
import type { CompiledModule } from "../project.js";

/**
 * Conformance for documentation comments (`spec/doc-comments.md`, ruling #191).
 *
 * The spec's §11 snippets are the backbone here — each is its own source file,
 * and each is checked on all three of the axes §11 names: what attached, what
 * was diagnosed, and what emitted. Around them sit the rules §11 states but does
 * not exhibit: §3.1's extraction order, §4.2's inventory, and §7's seats in both
 * artifacts.
 *
 * One place where this file's diagnostic goldens are sharper than §11's prose:
 * §5's first and fourth rows both describe a doc comment with code before it on
 * its line, and §11 annotates `let a = 1 (** note *)` with the fourth and
 * `let x = (** inline? *) 2` with the first. The implementation splits them the
 * way that reproduces both — a doc comment that *ends* its line is the trailing
 * annotation §10 rejects and takes row 4; one with code still after it on the
 * line is embedded in a declaration or an expression, which is what row 1 says
 * it covers. Either way the source is rejected.
 */

function compiled(source: string): CompiledModule {
  const project = compileMain(source);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!;
}

/** The attachment table §11 asks for: documented declaration → doc content. */
function attachments(source: string): readonly string[] {
  const main = compiled(source);
  const text = main.source.text;
  return [...main.core.docs]
    .sort((left, right) => left.target - right.target)
    .map(({ target, content }) => {
      // Name the target by the source line it starts, which is what a reader of
      // the snippet can check by eye.
      const line = text.slice(target).split("\n")[0]!.trim();
      return `${line} :: ${JSON.stringify(content)}`;
    });
}

function diagnostics(source: string): readonly string[] {
  return compileMain(source).diagnostics.map(({ message }) => message);
}

const DANGLING =
  "documentation comment does not document anything — the next code is not a " +
  "declaration. Move it directly above the declaration it describes, or make " +
  "it an ordinary comment (`(* ... *)`).";

const LEADING_ONLY =
  "documentation comments precede what they document — move this above the " +
  "declaration on its own line, or make it an ordinary comment (`(* ... *)`).";

describe("§11: attachment", () => {
  test("a doc block attaches to the declaration its next code token begins", () => {
    const source = "(** Doubles a number. *)\nfun double(x: Int): Int = x * 2\n";

    expect(attachments(source)).toEqual([
      'fun double(x: Int): Int = x * 2 :: "Doubles a number."',
    ]);
    expect(diagnostics(source)).toEqual([]);
  });

  test("consecutive doc comments are one block, and attach through `export`", () => {
    const source = "(** Line one. *)\n(** Line two. *)\nexport fun f(x: Int): Int = x\n";

    expect(attachments(source)).toEqual([
      'export fun f(x: Int): Int = x :: "Line one.\\n\\nLine two."',
    ]);
    expect(diagnostics(source)).toEqual([]);
  });

  test("an ordinary comment between doc comments is invisible to the block", () => {
    const source = "(** Overview. *)\n// ordinary note in between\n(** Addendum. *)\nfun h(): Unit = ()\n";

    expect(attachments(source)).toEqual([
      'fun h(): Unit = () :: "Overview.\\n\\nAddendum."',
    ]);
    expect(diagnostics(source)).toEqual([]);
  });

  test("constructor docs attach across the alternative's leading `|`", () => {
    const source = "union Shape =\n" +
      "  (** A circle of the given radius. *)\n" +
      "  | Circle(radius: Float)\n" +
      "  (** An axis-aligned box. *)\n" +
      "  | Box(w: Float, h: Float)\n";

    expect(attachments(source)).toEqual([
      'Circle(radius: Float) :: "A circle of the given radius."',
      'Box(w: Float, h: Float) :: "An axis-aligned box."',
    ]);
    expect(diagnostics(source)).toEqual([]);
  });

  test("constraint members are documentable, `type` members among them", () => {
    // §11's `Keyed` pair, verbatim: §4.2 puts a constraint's `type` member and
    // an `honor` block's implied-type binding on the documentable inventory
    // beside the function members they sit with (#394).
    const source = "constraint Keyed<c> =\n" +
      "    (** The type of one key, chosen by each instance. *)\n" +
      "    type Key\n" +
      "    (** The key of `x`. *)\n" +
      "    keyOf(x: c): Key\n" +
      "\n" +
      "honor Keyed<Int> =\n" +
      "    (** An `Int` keys itself. *)\n" +
      "    type Key = Int\n" +
      "    keyOf(x) = x\n";

    expect(attachments(source)).toEqual([
      'type Key :: "The type of one key, chosen by each instance."',
      'keyOf(x: c): Key :: "The key of `x`."',
      'type Key = Int :: "An `Int` keys itself."',
    ]);
    expect(diagnostics(source)).toEqual([]);
  });

  test("an `honor` block's function member documents beside its binding", () => {
    // The two `honor` member forms in one block: §11's snippet documents only
    // the binding, and nothing about the implied-type branch changes what the
    // member branch beside it already did.
    const source = "constraint Keyed<c> =\n" +
      "    type Key\n" +
      "    keyOf(x: c): Key\n" +
      "\n" +
      "honor Keyed<Int> =\n" +
      "    (** An `Int` keys itself. *)\n" +
      "    type Key = Int\n" +
      "    (** Itself, again. *)\n" +
      "    keyOf(x) = x\n";

    expect(attachments(source)).toEqual([
      'type Key = Int :: "An `Int` keys itself."',
      'keyOf(x) = x :: "Itself, again."',
    ]);
    expect(diagnostics(source)).toEqual([]);
  });

  test("a doc block above the first `let` of an indented block reaches it", () => {
    // The VOPEN layout interposes does not stand between them: attachment sees
    // physical tokens only (§4.1).
    const source = "export fun f(): Int =\n  (** A local. *)\n  let a: Int = 1\n  a\n";

    expect(attachments(source)).toEqual(['let a: Int = 1 :: "A local."']);
    expect(diagnostics(source)).toEqual([]);
  });

  test("a doc comment closing mid-line before code is leading", () => {
    const source = "(** doc *) let x = 1\n";

    expect(attachments(source)).toEqual(['let x = 1 :: "doc"']);
    expect(diagnostics(source)).toEqual([]);
  });

  test("an empty doc block attaches and contributes empty documentation", () => {
    const source = "(** *)\nlet k = 1\n";

    expect(attachments(source)).toEqual(['let k = 1 :: ""']);
    expect(diagnostics(source)).toEqual([]);
  });
});

describe("§3.1: extraction and dedent", () => {
  test("the opener-line fragment is exempt; later lines dedent together", () => {
    const source = "(** Overview paragraph.\n\n    Indented continuation dedents.  *)\nfun g(): Unit = ()\n";

    expect(attachments(source)).toEqual([
      'fun g(): Unit = () :: "Overview paragraph.\\n\\nIndented continuation dedents."',
    ]);
  });

  test("a newline-first body has no fragment, so every line participates", () => {
    const source = "(**\n" +
      "    A newline-first body: every content line\n" +
      "    participates in the dedent together.\n" +
      "*)\n" +
      "fun g2(): Unit = ()\n";

    expect(attachments(source)).toEqual([
      'fun g2(): Unit = () :: "A newline-first body: every content line\\nparticipates in the dedent together."',
    ]);
  });

  test("the space-first idiom carries content that begins with `*`", () => {
    const source = "(** *bold* *)\nlet k = 1\n";

    expect(attachments(source)).toEqual(['let k = 1 :: "*bold*"']);
  });

  test("the common prefix is literal, and a shallower line is not over-stripped", () => {
    const source = "(**\n" +
      "      deeper\n" +
      "  shallower\n" +
      "*)\n" +
      "let k = 1\n";

    expect(attachments(source)).toEqual(['let k = 1 :: "    deeper\\nshallower"']);
  });
});

describe("§2: what is not documentation", () => {
  test("`///` attaches nothing and lexes as an ordinary `//` comment", () => {
    const source = "/// not documentation\nfun plain(): Unit = ()\n";

    expect(attachments(source)).toEqual([]);
    expect(diagnostics(source)).toEqual([]);
    // The accepted footgun (§10), pinned: no diagnostic redirects it either.
    expect(compiled(source).javascript.text).toContain("/// not documentation");
  });

  test("banners, the empty comment, and `(*!` carry nothing", () => {
    const source = "(**********)\n(**)\n(*! not special *)\nlet z = 1\n";

    expect(attachments(source)).toEqual([]);
    expect(diagnostics(source)).toEqual([]);
  });
});

describe("§5: the hard errors", () => {
  test("a doc comment with code before it on its line does not attach", () => {
    const source = "let a = 1 (** note *)\n";

    expect(diagnostics(source)).toEqual([LEADING_ONLY]);
    expect(attachments(source)).toEqual([]);
  });

  test("the trailing form does not reach the declaration on the next line", () => {
    const source = "let a = 1 (** note *)\nfun f(): Unit = ()\n";

    expect(diagnostics(source)).toEqual([LEADING_ONLY]);
    expect(attachments(source)).toEqual([]);
  });

  test("a doc block at end of file documents nothing", () => {
    const source = "let a = 1\n(** Orphaned. *)\n";

    expect(diagnostics(source)).toEqual([DANGLING]);
  });

  test("a doc comment inside an expression documents nothing", () => {
    const source = "let x = (** inline? *) 2\n";

    expect(diagnostics(source)).toEqual([DANGLING]);
  });

  test("a doc comment between `export` and `fun` documents nothing", () => {
    const source = "export (** misplaced *) fun m(): Unit = ()\n";

    expect(diagnostics(source)).toEqual([DANGLING]);
    expect(attachments(source)).toEqual([]);
  });

  test("an import is not documentable, and the message names the deferral", () => {
    const source = '(** Module header? *)\nimport {map} from "./other.hex"\n';

    expect(diagnostics(source)[0]).toBe(
      `${DANGLING} imports are not documentable; module-level documentation is not in v1.`,
    );
  });

  test("`extern import` takes the same message", () => {
    const source = '(** Module header? *)\nextern import "./side.js"\n';

    expect(diagnostics(source)).toEqual([
      `${DANGLING} imports are not documentable; module-level documentation is not in v1.`,
    ]);
  });

  test("the `extern from` header gets its own message", () => {
    const source = '(** The filesystem module. *)\nextern from "node:fs"\n' +
      "  fun readFileSync(path: String): String\n";

    expect(diagnostics(source)).toEqual([
      "documentation attaches to the items an `extern from` block introduces, " +
      "not to the block — move it above the first item inside the block, or " +
      "make it an ordinary comment (`(* ... *)`).",
    ]);
  });

  test("a module-level effect statement is not a declaration", () => {
    const source = '(** Runs it. *)\nprint("hi")\n';

    expect(diagnostics(source)[0]).toBe(DANGLING);
  });

  test("a doc comment inside a string interpolation documents nothing", () => {
    // Interpolation trivia reaches the same comment channel, but its tokens are
    // inside the string token — the code after the string is not its neighbour.
    const source = 'let s: String = "${(** inline *) 1}"\nfun f(): Unit = ()\n';

    expect(diagnostics(source)).toEqual([DANGLING]);
    expect(attachments(source)).toEqual([]);
  });

  test("a malformed `type` member does not also report a dangling doc", () => {
    // The block is claimed and dropped rather than left over: the member it
    // would have documented failed to parse, and one syntax error is enough
    // (the `discard` path every failed declaration takes).
    const source = "constraint Keyed<c> =\n" +
      "    (** The type of one key. *)\n" +
      "    type key\n" +
      "    keyOf(x: c): Int\n";

    expect(diagnostics(source)).toContain("implied types require an uppercase-start name");
    expect(diagnostics(source)).not.toContain(DANGLING);
    expect(attachments(source)).toEqual([]);
  });

  test("a malformed implied-type binding does not either", () => {
    const source = "constraint Keyed<c> =\n" +
      "    type Key\n" +
      "    keyOf(x: c): Key\n" +
      "\n" +
      "honor Keyed<Int> =\n" +
      "    (** An `Int` keys itself. *)\n" +
      "    type Key =\n" +
      "    keyOf(x) = x\n";

    expect(diagnostics(source)).toContain("expected a type annotation");
    expect(diagnostics(source)).not.toContain(DANGLING);
    expect(attachments(source)).toEqual([]);
  });

  test("an unterminated doc comment gets Comments §5's error, and only that", () => {
    const source = "(** never closed\n";

    expect(diagnostics(source)).toEqual([
      "unterminated block comment; opened at line 1, column 1",
    ]);
  });
});

describe("§7: emission into both artifacts", () => {
  test("a documented export carries JSDoc into the `.js` and the `.d.ts`", () => {
    const main = compiled(
      "(** Doubles a number. *)\nexport fun double(x: Int): Int = x * 2\n",
    );

    expect(main.javascript.text).toBe(
      "/** Doubles a number. */\n" +
        "function double(x) {\n  return x * 2;\n}\n" +
        "export { double };\n",
    );
    expect(main.declarations.text).toBe(
      "/** Doubles a number. */\nexport declare function double(x: number): number;\n",
    );
  });

  test("a doc comment is not also emitted as an ordinary comment", () => {
    const main = compiled("(** Doubles. *)\nexport let two: Int = 2\n");

    expect(main.javascript.text.match(/Doubles\./gu)).toHaveLength(1);
  });

  test("multi-paragraph content emits as a conventional JSDoc block", () => {
    const main = compiled(
      "(** Overview.\n\n    More.  *)\nexport let two: Int = 2\n",
    );

    expect(main.declarations.text).toBe(
      "/**\n * Overview.\n *\n * More.\n */\nexport declare const two: number;\n",
    );
  });

  test("`*/` in content takes the JSDoc escape (§7.2)", () => {
    const main = compiled(
      "(** Ends a block: */ inside. *)\nexport let e: Int = 1\n",
    );

    expect(main.declarations.text).toContain("/** Ends a block: *\\/ inside. */");
    expect(main.javascript.text).toContain("/** Ends a block: *\\/ inside. */");
  });

  test("constructor docs ride the materialized constructors, the union its type", () => {
    const main = compiled(
      "(** A shape. *)\n" +
        "export union Shape =\n" +
        "  (** A circle. *)\n" +
        "  | Circle(radius: Float)\n" +
        "  | Box(w: Float, h: Float)\n",
    );

    // The `.js` has no seat for the union type itself; it emits constructors.
    expect(main.javascript.text).toContain('/** A circle. */\nconst Circle = radius =>');
    // Having no seat does not make the comment disappear: it stays the
    // item-boundary comment Comments §6 preserves, in JavaScript's spelling.
    expect(main.javascript.text).toContain("/** A shape. */");
    expect(main.declarations.text).toContain("/** A shape. */\nexport type Shape =");
    expect(main.declarations.text).toContain(
      "/** A circle. */\nexport declare const Circle:",
    );
  });

  test("record field docs sit on the properties of the structural type", () => {
    const main = compiled(
      "(** A point. *)\n" +
        "export record Point = {\n" +
        "  (** The horizontal coordinate. *)\n" +
        "  x: Float,\n" +
        "  y: Float,\n" +
        "}\n",
    );

    expect(main.declarations.text).toContain(
      "/** A point. */\n" +
        "export type Point = {\n" +
        "  /** The horizontal coordinate. */\n" +
        "  x: number;\n" +
        "  y: number;\n" +
        "};",
    );
    // The record's own documentation reaches its `.js` binding.
    expect(main.javascript.text).toContain(
      "/** A point. */\nconst Point = __hex_record => __hex_record;",
    );
  });

  test("an undocumented record still emits its structural type on one line", () => {
    const main = compiled("export record Point = {x: Float, y: Float}\n");

    expect(main.declarations.text).toContain(
      "export type Point = { x: number; y: number };",
    );
  });

  test("an exception carries its documentation to the emitted type", () => {
    const main = compiled("(** Thrown on overflow. *)\nexport exception Overflow\n");

    expect(main.declarations.text).toContain(
      "/** Thrown on overflow. */\nexport type Overflow =",
    );
    expect(main.javascript.text).toContain("/** Thrown on overflow. */\nconst Overflow =");
  });

  test("a `type` alias documents the emitted type declaration and nothing in the `.js`", () => {
    const main = compiled("(** A tally. *)\nexport type Count = Int\n");

    expect(main.declarations.text).toBe(
      "/** A tally. */\nexport type Count = number;\n",
    );
    // A `type` alias emits no JavaScript at all, so there is no seat — but the
    // comment is still preserved as trivia (Comments §6), not deleted.
    expect(main.javascript.text).toBe("/** A tally. */\n");
  });

  test("a foreign declaration documents both its import and its `.d.ts` face", () => {
    const main = compiled(
      'extern from "node:fs"\n' +
        "  (** Reads a file. *)\n" +
        "  export fun readFileSync(path: String): String\n",
    );

    expect(main.javascript.text).toContain(
      '/** Reads a file. */\nimport { readFileSync } from "node:fs";',
    );
    // §7.3's channel carries the Hexagon face beside the author's own sentence:
    // an unannotated user extern is the impure constant (Effects §6.1), and
    // TypeScript's one arrow cannot say so.
    expect(main.declarations.text).toContain(
      "/**\n * Reads a file.\n *\n * Hexagon: `String ->! String`\n */\n" +
        "export declare function readFileSync(path: string): string;",
    );
  });

  test("an empty doc block emits nothing — tooling treats it as absent", () => {
    const main = compiled("(** *)\nexport let k: Int = 1\n");

    expect(main.declarations.text).toBe("export declare const k: number;\n");
  });

  test("a local binder has no seat in either artifact (§7.1)", () => {
    const main = compiled(
      "export fun f(): Int =\n  (** A local. *)\n  let a: Int = 1\n  a\n",
    );

    expect(main.javascript.text).not.toContain("A local.");
    expect(main.declarations.text).not.toContain("A local.");
  });

  test("an unexported declaration keeps its documentation in the `.js` only", () => {
    const main = compiled("(** Private. *)\nlet p = 1\nexport let q: Int = p\n");

    expect(main.javascript.text).toContain("/** Private. */\nconst p = 1;");
    expect(main.declarations.text).not.toContain("Private.");
  });

  test("documentation does not disturb the blank lines around an item", () => {
    const main = compiled(
      "export let a: Int = 1\n\n(** Second. *)\nexport let b: Int = 2\n",
    );

    expect(main.javascript.text).toBe(
      "const a = 1;\n\n/** Second. */\nconst b = 2;\nexport { a };\nexport { b };\n",
    );
  });
});

describe("§7.1: seats that are not one-to-one", () => {
  test("a constrained export's documentation rides each specialization", () => {
    const main = compiled(
      "(** Renders it. *)\nexport fun render<a: Show>(x: a): String = \"${x}\"\n",
    );

    const rendered = main.declarations.text;
    expect(rendered).toContain("/** Renders it. */");
    // One JSDoc block per specialized declaration, and no specialization left
    // without one.
    expect(rendered.match(/\/\*\* Renders it\. \*\//gu)).toHaveLength(
      rendered.match(/^export declare function render/gmu)?.length ?? 0,
    );
  });

  test("constraint members document the forwarders emitted for them", () => {
    const main = compiled(
      "constraint Sized<a> =\n" +
        "  (** How big it is. *)\n" +
        "  size(value: a): Int\n" +
        "honor Sized<Int> =\n" +
        "  size(value) = value\n",
    );

    expect(main.javascript.text).toContain("/** How big it is. */\nconst size =");
  });

  test("a `type` member is the member with no seat, beside one that has", () => {
    // §7.1's newest sentence (#394): a constraint's `type` member is the member
    // with no property — an instance's choice is a type, and types are gone
    // before the boundary — so its documentation crosses into neither artifact,
    // while the function member beside it rides the forwarder emitted for it.
    //
    // The contrast is observable in the `.js` only, and that is a fact about
    // today's emitter rather than about §7.1: the dictionary *type* an exported
    // constraint owes the `.d.ts` is FFI Part 9's public-evidence surface, and
    // it is unbuilt (`exported-constraints.test.ts` says so where it declines to
    // assert its absence), so nothing about this constraint reaches the `.d.ts`
    // yet — neither the documented member nor the undocumentable one.
    const source = "export constraint Keyed<c> =\n" +
      "    (** The type of one key, chosen by each instance. *)\n" +
      "    type Key\n" +
      "    (** The key of `x`. *)\n" +
      "    keyOf(x: c): Key\n" +
      "\n" +
      "honor Keyed<Int> =\n" +
      "    (** An `Int` keys itself. *)\n" +
      "    type Key = Int\n" +
      "    keyOf(x) = x\n" +
      "\n" +
      "export let one: Int = keyOf((3 : Int))\n";
    const main = compiled(source);

    expect(diagnostics(source)).toEqual([]);
    expect(main.javascript.text).toContain("/** The key of `x`. */\nconst keyOf =");
    // No seat is no seat in either artifact, and in neither is it invented.
    for (const text of [main.javascript.text, main.declarations.text]) {
      expect(text).not.toContain("The type of one key");
      // The instance's binding is an `honor` member: tooling-only too (§7.1).
      expect(text).not.toContain("keys itself");
    }
    expect(main.declarations.text).not.toContain("The key of");
  });

  test("an `honor` member attaches without erroring and emits nowhere (§7.1)", () => {
    const source = "constraint Sized<a> =\n" +
      "  size(value: a): Int\n" +
      "honor Sized<Int> =\n" +
      "  (** The obvious size. *)\n" +
      "  size(value) = value\n";
    const main = compiled(source);

    expect(diagnostics(source)).toEqual([]);
    expect(attachments(source)).toEqual([
      'size(value) = value :: "The obvious size."',
    ]);
    expect(main.javascript.text).not.toContain("The obvious size.");
  });
});

/**
 * The cold review's two defects, and the behaviour around them that no golden
 * held down before: documentation that finds no seat is still trivia, and
 * "did this comment close?" is a fact the lexer knows rather than one the text
 * can be asked.
 */
describe("no seat is not deletion (Comments §6)", () => {
  test("a `union`'s own documentation survives in the `.js` as a comment", () => {
    const main = compiled("(** A shape. *)\nexport union Shape = | A | B\n");

    expect(main.javascript.text).toContain("/** A shape. */");
    expect(main.declarations.text).toContain("/** A shape. */\nexport type Shape =");
  });

  test("a `constraint`'s and an `honor`'s documentation survive too", () => {
    const main = compiled(
      "(** Things with a size. *)\n" +
        "constraint Sized<a> =\n" +
        "  size(value: a): Int\n" +
        "(** Ints have one. *)\n" +
        "honor Sized<Int> =\n" +
        "  size(value) = value\n",
    );

    expect(main.javascript.text).toContain("/** Things with a size. */");
    expect(main.javascript.text).toContain("/** Ints have one. */");
  });

  test("a doc comment with a seat is written once, not twice", () => {
    const main = compiled("(** Doubles. *)\nexport let two: Int = 2\n");

    expect(main.javascript.text.match(/Doubles\./gu)).toHaveLength(1);
  });
});

describe("termination is the lexer's answer, not the text's", () => {
  test("an unterminated *nested* doc comment gets one diagnostic, like a flat one", () => {
    // `(** a (* b *)` ends in `*)` and is open at depth 1 all the same; asking
    // the text would admit it to a block and stack "documents nothing" on top.
    expect(diagnostics("(** doc (* inner *)")).toEqual([
      "unterminated block comment; opened at line 1, column 1",
    ]);
    expect(diagnostics("(** doc")).toEqual([
      "unterminated block comment; opened at line 1, column 1",
    ]);
  });
});

describe("§4.3: one offending comment does not take its block down", () => {
  test("the leading member still attaches; the offender is still reported", () => {
    const source = "let a = 1 (** trailing *)\n(** Leading. *)\nlet b = 2\n";

    expect(diagnostics(source)).toEqual([LEADING_ONLY]);
    expect(attachments(source)).toEqual(['let b = 2 :: "Leading."']);
  });
});

describe("shapes the §11 snippets do not exhibit", () => {
  test("CRLF line endings dedent and join the same way", () => {
    const source = "(**\r\n    First line.\r\n    Second line.\r\n*)\r\nlet k = 1\r\n";

    expect(attachments(source)).toEqual([
      'let k = 1 :: "First line.\\nSecond line."',
    ]);
  });

  test("tabs inside a doc body are the author's business (§3.1)", () => {
    const source = "(**\n\tTabbed.\n\tAlso tabbed.\n*)\nlet k = 1\n";

    expect(attachments(source)).toEqual(['let k = 1 :: "Tabbed.\\nAlso tabbed."']);
  });

  test("nested `(* *)` inside a doc body is content, not structure", () => {
    const source = "(** Mentions (* a nested comment *) inline. *)\nlet k = 1\n";

    expect(attachments(source)).toEqual([
      'let k = 1 :: "Mentions (* a nested comment *) inline."',
    ]);
  });

  test("a blank line between two doc comments still leaves one block", () => {
    const source = "(** First. *)\n\n(** Second. *)\nlet k = 1\n";

    expect(attachments(source)).toEqual(['let k = 1 :: "First.\\n\\nSecond."']);
  });

  test("a local `var` and a union with no leading `|` are documentable", () => {
    const source = "(** A choice. *)\nunion Choice = Yes | No\n" +
      "export fun f(): Int =\n  (** A counter. *)\n  var n = 0\n  n\n";

    expect(attachments(source)).toEqual([
      'union Choice = Yes | No :: "A choice."',
      'var n = 0 :: "A counter."',
    ]);
    expect(diagnostics(source)).toEqual([]);
  });

  test("opaque exports document their branded type, not the brand", () => {
    const main = compiled(
      "(** An opaque handle. *)\nexport opaque record Handle = {id: Int}\n",
    );

    expect(main.declarations.text).toContain(
      "unique symbol;\n/** An opaque handle. */\nexport type Handle =",
    );
  });

  test("`derives` does not duplicate a declaration's documentation", () => {
    const main = compiled(
      "(** A tag. *)\nexport union Tag derives Eq = Yes | No\n",
    );

    expect(main.declarations.text.match(/\/\*\* A tag\. \*\//gu)).toHaveLength(1);
  });

  test("content carrying `@deprecated` passes through untouched (§7.2)", () => {
    // The recorded hole: TypeScript reads its own tag vocabulary out of emitted
    // JSDoc, and Hexagon neither validates nor suppresses it.
    const main = compiled("(** @deprecated Use `two`. *)\nexport let one: Int = 1\n");

    expect(main.declarations.text).toContain("/** @deprecated Use `two`. */");
  });

  test("emitted JavaScript stays parseable when content ends a block at a line seam", () => {
    const main = compiled(
      "(** Ends with a star *\n    / starts with a slash *)\nexport let e: Int = 1\n",
    );

    expect(() => new Function(main.javascript.text.replace(/^export .*$/gmu, "")))
      .not.toThrow();
  });
});
