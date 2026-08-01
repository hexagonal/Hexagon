import { describe, expect, test } from "vitest";
import {
  AnalysisSession,
  refused,
  type RenameResult,
  type RenameSubject,
} from "./session.js";

/** Offset of the `nth` occurrence of `needle`, counting from one. */
function at(text: string, needle: string, nth = 1): number {
  let offset = -1;
  for (let found = 0; found < nth; found += 1) {
    offset = text.indexOf(needle, offset + 1);
    if (offset < 0) throw new Error(`no occurrence ${nth} of ${JSON.stringify(needle)}`);
  }
  return offset;
}

/** Renders locations as `path:text` against the session's own file texts. */
function show(
  texts: ReadonlyMap<string, string>,
  locations: readonly { path: string; span: { start: { offset: number }; end: { offset: number } } }[],
): readonly string[] {
  return locations.map((location) =>
    `${location.path}:${
      (texts.get(location.path) ?? "").slice(location.span.start.offset, location.span.end.offset)
    }`
  );
}

function sessionOf(files: Record<string, string>): {
  readonly session: AnalysisSession;
  readonly texts: ReadonlyMap<string, string>;
} {
  const session = new AnalysisSession();
  const texts = new Map(Object.entries(files));
  for (const [path, text] of texts) session.setFile(path, text);
  return { session, texts };
}

const HELPER = [
  "export union Colour =",
  "    | Red",
  "    | Green",
  "",
  "export let brighten(colour: Colour): Colour = colour",
  "",
].join("\n");

const MAIN = [
  'import {Colour, brighten, Red} from "./helper"',
  "",
  "let start: Colour = Red",
  "let finish: Colour = brighten(start)",
  "",
].join("\n");

describe("AnalysisSession", () => {
  test("reports diagnostics per file, and an entry for the clean ones", () => {
    const { session } = sessionOf({
      "/main.hex": "let broken: Int = \n",
      "/other.hex": "let fine: Int = 1\n",
    });
    const all = session.allDiagnostics();
    expect([...all.keys()].sort()).toEqual(["/main.hex", "/other.hex"]);
    expect(all.get("/main.hex")!.length).toBeGreaterThan(0);
    // An editor clears stale squiggles by being told a file has none, so the
    // clean file has to appear with an empty list rather than be absent.
    expect(all.get("/other.hex")).toEqual([]);
    expect(session.diagnostics("/main.hex")).toEqual(all.get("/main.hex"));
  });

  test("a diagnostic lands in the file its span names", () => {
    const { session } = sessionOf({
      "/main.hex": 'import {missing} from "./helper"\n',
      "/helper.hex": "export let present: Int = 1\n",
    });
    expect(session.diagnostics("/helper.hex")).toEqual([]);
    expect(session.diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "module `./helper` does not export `missing`",
    ]);
  });

  test("go-to-definition crosses modules", () => {
    const { session, texts } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const use = at(MAIN, "brighten", 2);
    expect(show(texts, session.definitions("/main.hex", use))).toEqual(["/helper.hex:brighten"]);

    const type = at(MAIN, "Colour", 2);
    expect(show(texts, session.definitions("/main.hex", type))).toEqual(["/helper.hex:Colour"]);
  });

  test("the definition of a declaration is itself", () => {
    const { session, texts } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const declaration = at(HELPER, "brighten");
    expect(show(texts, session.definitions("/helper.hex", declaration))).toEqual([
      "/helper.hex:brighten",
    ]);
  });

  test("find-references gathers every module and includes the declaration", () => {
    const { session, texts } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const found = session.references("/main.hex", at(MAIN, "Colour", 2));
    expect(show(texts, found)).toEqual([
      "/helper.hex:Colour",
      "/helper.hex:Colour",
      "/helper.hex:Colour",
      "/main.hex:Colour",
      "/main.hex:Colour",
      "/main.hex:Colour",
    ]);
    expect(found.filter(({ isDefinition }) => isDefinition)).toHaveLength(1);

    const withoutDeclaration = session.references("/main.hex", at(MAIN, "Colour", 2), {
      includeDeclaration: false,
    });
    expect(withoutDeclaration).toHaveLength(found.length - 1);
    expect(withoutDeclaration.every(({ isDefinition }) => !isDefinition)).toBe(true);
  });

  test("a request from either end of a reference sees the same set", () => {
    const { session } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const fromUse = session.references("/main.hex", at(MAIN, "brighten", 2));
    const fromDeclaration = session.references("/helper.hex", at(HELPER, "brighten"));
    expect(fromDeclaration).toEqual(fromUse);
  });

  test("hover carries the checker's type for a value", () => {
    const { session } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const hover = session.hover("/main.hex", at(MAIN, "brighten", 2));
    expect(hover?.name).toBe("brighten");
    expect(hover?.target?.kind).toBe("value");
    expect(hover?.displayedType).toBe("Colour -> Colour");
  });

  test("hover on a type names the type without inventing one", () => {
    const { session } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const hover = session.hover("/main.hex", at(MAIN, "Colour", 2));
    expect(hover?.name).toBe("Colour");
    expect(hover?.target?.kind).toBe("union");
    expect(hover?.displayedType).toBeUndefined();
  });

  test("a position with nothing at it answers nothing", () => {
    const { session } = sessionOf({ "/main.hex": "let value: Int = 1\n" });
    const inWhitespace = at("let value: Int = 1\n", " ");
    expect(session.hover("/main.hex", inWhitespace)).toBeUndefined();
    expect(session.definitions("/main.hex", inWhitespace)).toEqual([]);
    expect(session.references("/main.hex", inWhitespace)).toEqual([]);
  });

  test("the caret just past a name still lands on it", () => {
    const source = "let value: Int = 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    const justPast = at(source, "value") + "value".length;
    expect(session.hover("/main.hex", justPast)?.name).toBe("value");
  });

  test("an unknown file answers empty rather than throwing", () => {
    const { session } = sessionOf({ "/main.hex": "let value: Int = 1\n" });
    expect(session.diagnostics("/absent.hex")).toEqual([]);
    expect(session.hover("/absent.hex", 0)).toBeUndefined();
    expect(session.definitions("/absent.hex", 0)).toEqual([]);
    expect(session.references("/absent.hex", 0)).toEqual([]);
  });

  test("edits change the answers, and bump the version that dates them", () => {
    const { session } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const before = session.version;
    expect(session.diagnostics("/main.hex")).toEqual([]);

    session.setFile("/main.hex", 'import {Colour} from "./helper"\n\nlet start: Colour = Purple\n');
    expect(session.version).toBeGreaterThan(before);
    expect(session.diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "unknown name `Purple`",
    ]);

    // Writing identical text is not an edit; a host that re-sends unchanged
    // content must not invalidate every answer already in flight.
    const settled = session.version;
    session.setFile("/helper.hex", HELPER);
    expect(session.version).toBe(settled);
  });

  test("removing a file removes its answers and re-breaks its dependents", () => {
    const { session } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    session.removeFile("/helper.hex");
    expect(session.paths).toEqual(["/main.hex"]);
    expect(session.diagnostics("/main.hex").map(({ message }) => message)).toContain(
      "cannot resolve module `./helper` from `/main.hex`",
    );
    expect(session.diagnostics("/helper.hex")).toEqual([]);
  });

  test("a path keeps one identity across removal and re-adding", () => {
    const { session } = sessionOf({ "/main.hex": "let value: Int = 1\n" });
    const first = session.definitions("/main.hex", at("let value: Int = 1\n", "value"))[0]!;
    session.removeFile("/main.hex");
    session.setFile("/main.hex", "let value: Int = 2\n");
    const second = session.definitions("/main.hex", at("let value: Int = 2\n", "value"))[0]!;
    // Spans are compared by file id throughout the compiler, so a path that
    // changed identity when it was closed and reopened would make two spans in
    // one file look like spans in two. Answers going stale is `version`'s job.
    expect(second.span.fileId).toBe(first.span.fileId);
  });

  test("a record's declaration answers for both of its meanings", () => {
    const source = ["record Box(a) = {", "    item: a,", "}", "", "let one = Box({item = 1})", ""]
      .join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    const declaration = session.definitions("/main.hex", at(source, "Box"));
    expect(show(texts, declaration)).toEqual(["/main.hex:Box", "/main.hex:Box"]);
    expect(new Set(declaration.map(({ target }) => target.kind))).toEqual(
      new Set(["record", "value"]),
    );
    // A use in value position means only the constructor, so it must not drag
    // the type along: one meaning is present there, and one answer is right.
    const use = session.definitions("/main.hex", at(source, "Box", 2));
    expect(use.map(({ target }) => target.kind)).toEqual(["value"]);
  });

  test("a constraint's declaration, honour and bound are one identity", () => {
    const source = [
      "constraint Show2<a> =",
      "    show2(value: a): String",
      "",
      "record Wrapper = {",
      "    inner: Int,",
      "}",
      "",
      "honor Show2<Wrapper> =",
      '    show2(value) = "wrapped"',
      "",
      "let describe<a: Show2>(value: a): String = show2(value)",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    expect(session.allDiagnostics().get("/main.hex")).toEqual([]);
    // A constraint has no id — a constraint is its name — so the declaration,
    // the `honor` head and the type-parameter bound have to meet on the name.
    const fromBound = at(source, "Show2", 3);
    expect(show(texts, session.definitions("/main.hex", fromBound))).toEqual(["/main.hex:Show2"]);
    expect(show(texts, session.references("/main.hex", fromBound))).toEqual([
      "/main.hex:Show2",
      "/main.hex:Show2",
      "/main.hex:Show2",
    ]);
    expect(session.hover("/main.hex", fromBound)?.target?.kind).toBe("constraint");
  });

  test("a built-in constraint has uses but no declaration to jump to", () => {
    const source = ["union Colour derives (Eq, Show) =", "    | Red", "    | Green", ""].join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    expect(session.allDiagnostics().get("/main.hex")).toEqual([]);
    // `Eq`, `Ord`, `Show` and `Hash` are known to the checker rather than
    // declared in Hexagon, so there is honestly nowhere to go. Reporting the
    // use we can see beats inventing a definition we cannot.
    expect(session.definitions("/main.hex", at(source, "Eq"))).toEqual([]);
    expect(show(texts, session.references("/main.hex", at(source, "Eq")))).toEqual(["/main.hex:Eq"]);
    expect(session.hover("/main.hex", at(source, "Eq"))?.name).toBe("Eq");
  });

  test("two modules exporting one type name stay apart", () => {
    const shade = ["export union Shade =", "    | Pale", "    | Deep", ""].join("\n");
    const other = ["export union Shade =", "    | Faint", "    | Vivid", ""].join("\n");
    const main = [
      'import {Shade} from "./a"',
      'import {Shade as Other} from "./b"',
      "",
      "let p(x: Shade): Shade = x",
      "let q(y: Other): Other = y",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({
      "/a.hex": shade,
      "/b.hex": other,
      "/main.hex": main,
    });
    expect(session.allDiagnostics().get("/main.hex")).toEqual([]);

    // Both imports spell the same type name, so a lookup that only asks "is it
    // declared somewhere other than here?" picks whichever comes first and is
    // wrong half the time — with no diagnostic, because the program is valid.
    // Only the specifier says which module a name came from.
    expect(show(texts, session.definitions("/main.hex", at(main, "Shade", 3)))).toEqual([
      "/a.hex:Shade",
    ]);
    expect(show(texts, session.definitions("/main.hex", at(main, "Other", 2)))).toEqual([
      "/b.hex:Shade",
    ]);
    // The import clause itself has to agree with the use it binds, or the two
    // ends of one alias answer with two different types.
    expect(show(texts, session.definitions("/main.hex", at(main, "Other")))).toEqual([
      "/b.hex:Shade",
    ]);
    const fromClause = session.references("/main.hex", at(main, "Other"));
    const fromUse = session.references("/main.hex", at(main, "Other", 2));
    expect(fromClause).toEqual(fromUse);
  });

  test("options can be set after the session is open, and change the answers", () => {
    // A host learns what kind of project it has by reading a file *in* the
    // project, so the configuration arrives after the session does — and can
    // then change while it is open.
    const source = "let size(node: Node(Int)): Int = 0\n";
    const session = new AnalysisSession();
    session.setFile("/trie.hex", source);
    expect(session.diagnostics("/trie.hex").map(({ message }) => message)).toContain(
      "unknown generic type `Node`",
    );

    const before = session.version;
    session.configure({ runtimePaths: ["/trie.hex"] });
    expect(session.version).toBeGreaterThan(before);
    expect(session.diagnostics("/trie.hex")).toEqual([]);

    // `Node` is not merely accepted now; it is understood.
    expect(session.hover("/trie.hex", at(source, "node"))?.displayedType).toBe("Node(Int)");

    // Withdrawing the privilege has to withdraw the answer too.
    session.configure({});
    expect(session.diagnostics("/trie.hex").length).toBeGreaterThan(0);
  });

  test("reconfiguring with the same options keeps the analysis", () => {
    const session = new AnalysisSession({ runtimePaths: ["/a.hex", "/b.hex"] });
    session.setFile("/main.hex", "let value: Int = 1\n");
    const settled = session.version;
    session.configure({ runtimePaths: ["/a.hex", "/b.hex"] });
    expect(session.version).toBe(settled);
    // Order is not meaningful — `compileProject` reads the list as a set — so a
    // host that rebuilds it in a different order must not discard analysis it is
    // about to ask questions of.
    session.configure({ runtimePaths: ["/b.hex", "/a.hex"] });
    expect(session.version).toBe(settled);
  });

  test("paths arriving in Windows spelling are the same file", () => {
    const session = new AnalysisSession();
    session.setFile("\\main.hex", "let value: Int = 1\n");
    expect(session.paths).toEqual(["/main.hex"]);
    expect(session.hover("/main.hex", 4)?.name).toBe("value");
    expect(session.hover("\\main.hex", 4)?.name).toBe("value");
  });
});

/**
 * `spec/doc-comments.md` §8: attached documentation reaches hover, at every
 * documentable position — including the ones that reach neither emitted
 * artifact, which is the whole reason the attachment exists for them.
 */
describe("AnalysisSession.hover documentation", () => {
  const DOCUMENTED = [
    "(** A colour, as the light leaves it. *)",
    "export union Colour =",
    "    (** The warm one. *)",
    "    | Red",
    "    | Green",
    "",
    "(** Brightens a colour.",
    "",
    "    Twice, if you ask twice. *)",
    "export let brighten(colour: Colour): Colour = colour",
    "",
  ].join("\n");

  const USES = [
    'import {Colour, brighten, Red} from "./helper"',
    "",
    "let start: Colour = Red",
    "let finish: Colour = brighten(start)",
    "",
  ].join("\n");

  test("a declaration under the cursor carries its own documentation", () => {
    const { session } = sessionOf({ "/helper.hex": DOCUMENTED });
    const hover = session.hover("/helper.hex", at(DOCUMENTED, "brighten"));
    expect(hover?.name).toBe("brighten");
    expect(hover?.displayedType).toBe("Colour -> Colour");
    // Content arrives as the author wrote it, paragraph break included: it is
    // Markdown (§6), and rendering it is the client's job.
    expect(hover?.documentation).toBe(
      "Brightens a colour.\n\nTwice, if you ask twice.",
    );
  });

  test("a use carries what its declaration documents, across modules", () => {
    const { session } = sessionOf({ "/helper.hex": DOCUMENTED, "/main.hex": USES });
    expect(session.hover("/main.hex", at(USES, "brighten", 2))?.documentation)
      .toBe("Brightens a colour.\n\nTwice, if you ask twice.");
    expect(session.hover("/main.hex", at(USES, "Colour", 2))?.documentation)
      .toBe("A colour, as the light leaves it.");
    expect(session.hover("/main.hex", at(USES, "Red", 2))?.documentation)
      .toBe("The warm one.");
  });

  test("an undocumented declaration says nothing about documentation", () => {
    const { session } = sessionOf({ "/main.hex": "let value: Int = 1\n" });
    const hover = session.hover("/main.hex", 4);
    expect(hover?.name).toBe("value");
    expect(hover?.documentation).toBeUndefined();
  });

  test("an empty doc block is documentation nobody shows", () => {
    // §3.2: an empty block attaches and contributes empty content, which
    // tooling treats as absent — not as an empty hover section.
    const source = "(** *)\nlet value: Int = 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(session.hover("/main.hex", at(source, "value"))?.documentation).toBeUndefined();
  });

  test("a position the occurrence index cannot name is still answered", () => {
    // A record field, a `type` alias and an `honor` member have no identity in
    // the occurrence index — a field is not a symbol, an alias is expanded
    // away, and a member implementation's name is a bare string in the resolved
    // tree. Hover answers each with the documentation alone, which for these
    // three is the only thing anything can say about them.
    const source = [
      "constraint Sized<a> =",
      "    (** How big it is. *)",
      "    size(value: a): Int",
      "",
      "export record Box = {",
      "    (** How wide. *)",
      "    width: Int,",
      "}",
      "",
      "(** A width, named. *)",
      "export type Width = Int",
      "",
      "honor Sized<Box> =",
      "    (** A box is one wide. *)",
      "    size(value) = 1",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);

    const field = session.hover("/main.hex", at(source, "width"));
    expect(field?.name).toBe("width");
    expect(field?.target).toBeUndefined();
    expect(field?.documentation).toBe("How wide.");
    // Inclusive at the end, like every other position query here: the caret an
    // editor leaves after typing a name is one past it.
    expect(session.hover("/main.hex", at(source, "width") + "width".length)?.documentation)
      .toBe("How wide.");

    expect(session.hover("/main.hex", at(source, "Width"))?.documentation)
      .toBe("A width, named.");

    // The member implementation's own documentation, not the constraint
    // member's: the reader is pointing at the implementation.
    expect(session.hover("/main.hex", at(source, "size", 2))?.documentation)
      .toBe("A box is one wide.");
    // And the constraint member still answers with its own.
    expect(session.hover("/main.hex", at(source, "size"))?.documentation)
      .toBe("How big it is.");
  });

  test("an undocumented position with no identity is still nothing", () => {
    // The fallback reaches documented names only. Without that it would be a
    // second, weaker hover for everything the index has no answer for.
    const source = ["export record Box = {", "    width: Int,", "}", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.hover("/main.hex", at(source, "width"))).toBeUndefined();
  });

  test("an empty doc block does not conjure a hover where there was none", () => {
    // The same §3.2 rule as above, at the position that has nothing *but* the
    // documentation: empty content must leave the field as silent as an
    // undocumented one, not answer with an empty hover.
    const source = ["export record Box = {", "    (** *)", "    width: Int,", "}", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(session.hover("/main.hex", at(source, "width"))).toBeUndefined();
  });

  test("a destructuring `let` documents every binder it introduces", () => {
    // One block over several names: §4.2 makes the `let` documentable and says
    // nothing about arity. The binders are ordinary symbols — the resolver
    // declares one each — so each is reachable by name; what only the
    // attachment knows is which names one block covers.
    const source = [
      "(** Both halves. *)",
      "let (first, second) = (1, 2)",
      "",
      "export let use(): Int = first + second",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const binder = session.hover("/main.hex", at(source, "first"));
    // A real identity, not a documentation-only answer: this is the key the
    // documentation is filed under, and what makes completion find it too.
    expect(binder?.target?.kind).toBe("value");
    expect(binder?.documentation).toBe("Both halves.");
    expect(session.hover("/main.hex", at(source, "second"))?.documentation).toBe("Both halves.");
    // And at a use, which reaches the same block through the same key.
    expect(session.hover("/main.hex", at(source, "first", 2))?.documentation).toBe("Both halves.");
  });

  test("a pattern that binds nothing has no name to document", () => {
    // §5 does not fire — the block is followed by a declaration — and there is
    // no name to file the content under, so it reaches no reader. Pinned so the
    // silence stays a decision rather than becoming a surprise.
    const source = ["(** Nothing to point at. *)", "let (_, _) = (1, 2)", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(session.hover("/main.hex", at(source, "let"))).toBeUndefined();
    expect(session.hover("/main.hex", at(source, "_"))).toBeUndefined();
  });

  test("an `honor` block's documentation answers on the constraint it names", () => {
    // The block introduces no name of its own, so the constraint in its head is
    // where a reader points to ask what the instance is for. Answering there is
    // also what the lookup order is for: the same span is a *reference* to the
    // constraint, whose own documentation is the other answer, and the block the
    // cursor is inside wins.
    const source = [
      "(** Things with a size. *)",
      "constraint Sized<a> =",
      "    size(value: a): Int",
      "",
      "export record Box = { width: Int }",
      "",
      "(** A box sizes by its width. *)",
      "honor Sized<Box> =",
      "    size(value) = value.width",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(session.hover("/main.hex", at(source, "Sized", 2))?.documentation)
      .toBe("A box sizes by its width.");
    expect(session.hover("/main.hex", at(source, "Sized"))?.documentation)
      .toBe("Things with a size.");
  });

  test("a constraint does not borrow a namesake's documentation from another module", () => {
    // A constraint *is* its name project-wide (`targetKey`), so two unrelated
    // modules declaring `Shown` share one target and `byTarget` returns both
    // declarations. Answering with whichever is documented would put one
    // module's prose on another module's undocumented declaration.
    const documented = [
      "(** ALPHA doc. *)",
      "constraint Shown<a> =",
      "    render(value: a): Int",
      "",
    ].join("\n");
    const bare = [
      "constraint Shown<a> =",
      "    render(value: a): Int",
      "",
      "export record Box = { width: Int }",
      "",
      "honor Shown<Box> =",
      "    render(value) = value.width",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/alpha.hex": documented, "/beta.hex": bare });
    expect(session.diagnostics("/beta.hex")).toEqual([]);
    expect(session.hover("/beta.hex", at(bare, "Shown"))?.target?.kind).toBe("constraint");
    expect(session.hover("/beta.hex", at(bare, "Shown"))?.documentation).toBeUndefined();
    expect(session.hover("/alpha.hex", at(documented, "Shown"))?.documentation)
      .toBe("ALPHA doc.");
  });
});

/** Applies a plan to the files it names, so a test can read the result. */
function applied(
  texts: ReadonlyMap<string, string>,
  result: RenameResult | undefined,
): Record<string, string> {
  if (result === undefined || refused(result)) throw new Error(`no plan: ${JSON.stringify(result)}`);
  const byPath = new Map<string, { start: number; end: number }[]>();
  for (const edit of result.edits) {
    const bucket = byPath.get(edit.path) ?? [];
    bucket.push({ start: edit.span.start.offset, end: edit.span.end.offset });
    byPath.set(edit.path, bucket);
  }
  const output: Record<string, string> = {};
  for (const [path, spans] of byPath) {
    let text = texts.get(path)!;
    for (const { start, end } of [...spans].sort((left, right) => right.start - left.start)) {
      text = text.slice(0, start) + result.newName + text.slice(end);
    }
    output[path] = text;
  }
  return output;
}

/** The reason a rename was refused, failing loudly when it was not. */
function refusal(result: RenameResult | RenameSubject | undefined): string {
  if (result === undefined || !refused(result)) {
    throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  }
  return result.refused;
}

describe("AnalysisSession.rename", () => {
  test("rewrites the declaration, every use, and the import clauses that name it", () => {
    const { session, texts } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const plan = session.rename("/helper.hex", at(HELPER, "brighten"), "lighten");
    expect(applied(texts, plan)).toEqual({
      "/helper.hex": HELPER.replaceAll("brighten", "lighten"),
      "/main.hex": MAIN.replaceAll("brighten", "lighten"),
    });
  });

  test("a record's name moves as its type and its constructor together", () => {
    const source = [
      "record Box(a) = {",
      "    item: a,",
      "}",
      "",
      "let boxed: Box(Int) = Box(1)",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    // The declaration is one span carrying two identities. Moving only the type
    // would leave `Box(1)` calling a constructor that no longer exists.
    const plan = session.rename("/main.hex", at(source, "Box"), "Crate");
    expect(applied(texts, plan)["/main.hex"]).toBe(source.replaceAll("Box", "Crate"));
  });

  test("a namespace-qualified use is rewritten past its qualifier", () => {
    const helper = "export let two: Int = 2\n";
    const main = ['import * as H from "./helper"', "", "let four: Int = H.two + H.two", ""]
      .join("\n");
    const { session, texts } = sessionOf({ "/helper.hex": helper, "/main.hex": main });
    const plan = session.rename("/helper.hex", at(helper, "two"), "pair");
    // `H` names the module and does not move; only the member does.
    expect(applied(texts, plan)).toEqual({
      "/helper.hex": "export let pair: Int = 2\n",
      "/main.hex": main.replaceAll("H.two", "H.pair"),
    });
  });

  test("renaming a declaration rewrites an aliasing clause's imported name only", () => {
    const helper = "export let two: Int = 2\n";
    const main = ['import {two as deux} from "./helper"', "", "let four: Int = deux + deux", ""]
      .join("\n");
    const { session, texts } = sessionOf({ "/helper.hex": helper, "/main.hex": main });
    const plan = session.rename("/helper.hex", at(helper, "two"), "pair");
    // The clause goes on aliasing; it just aliases a differently-spelled
    // declaration. Rewriting `deux` as well would rename a name the user never
    // asked about, and leaving `two` alone would break the import outright.
    expect(applied(texts, plan)).toEqual({
      "/helper.hex": "export let pair: Int = 2\n",
      "/main.hex": main.replace("two as deux", "pair as deux"),
    });
  });

  test("renaming through the local alias leaves the declaration alone", () => {
    const helper = "export let two: Int = 2\n";
    const main = ['import {two as deux} from "./helper"', "", "let four: Int = deux + deux", ""]
      .join("\n");
    const { session, texts } = sessionOf({ "/helper.hex": helper, "/main.hex": main });
    const plan = session.rename("/main.hex", at(main, "deux"), "zwei");
    expect(applied(texts, plan)).toEqual({ "/main.hex": main.replaceAll("deux", "zwei") });
  });

  test("refuses a spelling that is not one identifier, and says which", () => {
    const source = "let value: Int = 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    const start = at(source, "value");
    // Every one of these is decided by the lexer rather than by a pattern kept
    // in the session, which is the only way the two cannot drift apart.
    expect(refusal(session.rename("/main.hex", start, "let"))).toContain("not a name Hexagon can read");
    expect(refusal(session.rename("/main.hex", start, "two words"))).toContain("one identifier");
    expect(refusal(session.rename("/main.hex", start, "a.b"))).toContain("one identifier");
    expect(refusal(session.rename("/main.hex", start, ""))).toContain("one identifier");
    expect(refusal(session.rename("/main.hex", start, "__hex_x"))).toContain("one identifier");
    expect(refusal(session.rename("/main.hex", start, "value "))).toContain("one identifier");
  });

  test("refuses to change a name's capitalization class", () => {
    const source = ["union Shade =", "    | Pale", "", "let tone: Shade = Pale", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(refusal(session.rename("/main.hex", at(source, "tone"), "Tone")))
      .toContain("two different kinds of name");
    expect(refusal(session.rename("/main.hex", at(source, "Shade"), "shade")))
      .toContain("two different kinds of name");
    // A non-ASCII capital is still a capital: the classification is the lexer's
    // Unicode one, not `A`-to-`Z`.
    expect(refusal(session.rename("/main.hex", at(source, "tone"), "Ünion")))
      .toContain("two different kinds of name");
  });

  test("refuses a name the project does not own", () => {
    const source = "let maybe: Option(Int) = None\n";
    const { session } = sessionOf({ "/main.hex": source });
    // `None` is the prelude's, injected rather than read; the workspace has no
    // file to edit and rewriting the use alone would break it.
    expect(refusal(session.rename("/main.hex", at(source, "None"), "Nothing")))
      .toContain("this project does not own");
  });

  test("rewrites a dot call, which only the checker knows the meaning of", () => {
    // `Pale.brighten()` is companion dispatch. The resolved tree has only an
    // `Access` whose field nobody has decided the meaning of yet — the checker
    // settles it by name — so without the typed tree in the index this call site
    // is a mention of nothing, and the rename walks straight past it.
    const source = [
      "union Shade =",
      "    | Pale",
      "",
      "fun brighten(s: Shade): Shade = s",
      "",
      "let x: Shade = Pale.brighten()",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const plan = session.rename("/main.hex", at(source, "brighten"), "lighten");
    expect(applied(texts, plan)["/main.hex"]).toBe(source.replaceAll("brighten", "lighten"));
  });

  test("refuses a rename that moves a dot call to a different function", () => {
    // The case no test confined to the renamed identity can see. `Pale.tag()`
    // resolves by name, so giving `/b.hex`'s function the name `tag` moves that
    // call from `/a.hex`'s function to `/b.hex`'s — with every type still
    // checking, no diagnostic anywhere, and the moved site spelled neither
    // `mark` nor `tag` in its own module. Verified by hand before this was
    // caught: the emitted `x` changed from `tag(Pale)` to `m(Pale)`.
    const a = ["export union Shade =", "    | Pale", "", "export fun tag(s: Shade): Int = 1", ""]
      .join("\n");
    const b = ['import {Shade} from "./a"', "", "export fun mark(s: Shade): Int = 2", ""].join("\n");
    const main = [
      'import {Shade, Pale, tag} from "./a"',
      'import {mark as m} from "./b"',
      "",
      "let x: Int = Pale.tag()",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/a.hex": a, "/b.hex": b, "/main.hex": main });
    expect(session.allDiagnostics().get("/main.hex")).toEqual([]);
    expect(refusal(session.rename("/b.hex", at(b, "mark"), "tag")))
      .toContain("would change what the code means");
  });

  test("a dot call reached through an alias keeps its own spelling", () => {
    // A dot call dispatches on the *declared* name, so `Pale.brighten()` is
    // legal in a module that imported `brighten as b` — and the checker's typed
    // name for it is the local spelling `b`, not the eight characters the source
    // wrote. Published under that name, the occurrence lands over the last
    // character of the field and every consumer reads a name that disagrees with
    // its own span.
    const helper = [
      "export union Shade =",
      "    | Pale",
      "",
      "export fun brighten(s: Shade): Int = 1",
      "",
    ].join("\n");
    const main = [
      'import {Shade, Pale, brighten as b} from "./helper"',
      "",
      "let x: Int = Pale.brighten()",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/helper.hex": helper, "/main.hex": main });
    expect(session.allDiagnostics().get("/main.hex")).toEqual([]);
    const call = at(main, "brighten", 2);
    expect(session.prepareRename("/main.hex", call)).toEqual({
      name: "brighten",
      span: expect.objectContaining({
        start: expect.objectContaining({ offset: call }),
        end: expect.objectContaining({ offset: call + "brighten".length }),
      }),
    });
    // Renaming the declaration moves the call with it. The alias does not move:
    // the clause goes on aliasing a differently-spelled declaration.
    const plan = session.rename("/helper.hex", at(helper, "brighten"), "lighten");
    expect(applied(texts, plan)).toEqual({
      "/helper.hex": helper.replace("fun brighten", "fun lighten"),
      "/main.hex": main
        .replace("brighten as b", "lighten as b")
        .replace("Pale.brighten()", "Pale.lighten()"),
    });
  });

  test("renaming the alias leaves the dot call alone", () => {
    // The mirror. `b` and `Pale.brighten()` name one thing under two spellings,
    // and only the one under the cursor moves.
    const helper = [
      "export union Shade =",
      "    | Pale",
      "",
      "export fun brighten(s: Shade): Int = 1",
      "",
    ].join("\n");
    const main = [
      'import {Shade, Pale, brighten as b} from "./helper"',
      "",
      "let x: Int = Pale.brighten()",
      "let y: Int = b(Pale)",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/helper.hex": helper, "/main.hex": main });
    const plan = session.rename("/main.hex", at(main, "b(Pale)"), "bb");
    expect(applied(texts, plan)["/main.hex"]).toBe(
      main.replace("brighten as b", "brighten as bb").replace("b(Pale)", "bb(Pale)"),
    );
  });

  test("a pre-existing error elsewhere that spells the new name is not breakage", () => {
    // The message is unchanged by the rename, but each side used to blank only
    // its own spelling, so an untouched `unknown name \`bar\`` read as new the
    // moment `bar` became the name being renamed to.
    const helper = "export fun foo(v: Int): Int = v\n";
    const other = "let q: Int = bar\n";
    const { session, texts } = sessionOf({ "/helper.hex": helper, "/other.hex": other });
    expect(session.diagnostics("/other.hex").map(({ message }) => message)).toEqual([
      "unknown name `bar`",
    ]);
    const plan = session.rename("/helper.hex", at(helper, "foo"), "bar");
    expect(applied(texts, plan)).toEqual({ "/helper.hex": "export fun bar(v: Int): Int = v\n" });
  });

  test("refuses when a name that resolved to nothing would start resolving", () => {
    // The other direction of the denotation comparison: a site that means
    // nothing today and would mean the renamed declaration afterwards. No
    // diagnostic *appears* — one disappears — so only this test sees it.
    const source = ["let colour: Int = 1", "let use: Int = tone", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "unknown name `tone`",
    ]);
    expect(refusal(session.rename("/main.hex", at(source, "colour"), "tone")))
      .toContain("would change what the code means");
  });

  test("a pre-existing error that mentions the name is not a reason to refuse", () => {
    // The error re-renders under the new spelling and looks new. Renaming while
    // a file holds an unrelated error mentioning that name is ordinary.
    const source = [
      "union Shade =",
      "    | Pale",
      "",
      "let bad: Int = Pale",
      "let ok: Shade = Pale",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex").map(({ message }) => message)).toContain(
      "type mismatch: expected Int, found Shade",
    );
    const plan = session.rename("/main.hex", at(source, "Shade"), "Tint");
    expect(applied(texts, plan)["/main.hex"]).toBe(source.replaceAll("Shade", "Tint"));
  });

  test("renaming to a spelling an importer already aliases it to is allowed", () => {
    // `import {two as deux}` becomes `import {deux as deux}` — legal, and the
    // same program. The alias's mentions already denoted this declaration, so
    // nothing merged with anything.
    const helper = "export let two: Int = 2\n";
    const main = ['import {two as deux} from "./helper"', "", "let four: Int = deux + deux", ""]
      .join("\n");
    const { session, texts } = sessionOf({ "/helper.hex": helper, "/main.hex": main });
    const plan = session.rename("/helper.hex", at(helper, "two"), "deux");
    expect(applied(texts, plan)).toEqual({
      "/helper.hex": "export let deux: Int = 2\n",
      "/main.hex": main.replace("two as deux", "deux as deux"),
    });
  });

  test("renames a constraint the project declared, everywhere it is named", () => {
    const source = [
      "constraint Same<a> =",
      "    same(left: a, right: a): Bool",
      "",
      "record Token = {value: Int}",
      "",
      "honor Same<Token> =",
      "    same(left, right) = left.value == right.value",
      "",
      "fun agrees<a: Same>(left: a, right: a): Bool = same(left, right)",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    const plan = session.rename("/main.hex", at(source, "Same"), "Alike");
    // The declaration, the `honor`, and the type-parameter bound. A constraint
    // has no identity beyond its name, so all three are one thing.
    expect(applied(texts, plan)["/main.hex"]).toBe(source.replaceAll("Same", "Alike"));
  });

  test("refuses a constraint the checker owns rather than Hexagon", () => {
    const source = ["union Shade derives (Eq) =", "    | Pale", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(refusal(session.rename("/main.hex", at(source, "Eq"), "Same")))
      .toContain("built into the compiler");
  });

  test("refuses a rename the compiler would reject, in the compiler's own words", () => {
    const source = ["let tone: Int = 1", "let colour: Int = 2", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const reason = refusal(session.rename("/main.hex", at(source, "colour"), "tone"));
    expect(reason).toContain("would break `/main.hex`");
    // The message is the compiler's, not a paraphrase invented here.
    expect(reason).toContain("tone");
  });

  test("refuses a capture that produces no diagnostic at all", () => {
    // The arm binder shadows the module-level `tone` legally (Statements §5.1
    // rule 2), so after the rename `tone + tone` type-checks perfectly and the
    // second `tone` has quietly stopped meaning the module-level one. Nothing
    // in the diagnostics changes; only the occurrence sets do.
    const source = [
      "let tone: Int = 1",
      "let f(x: Int): Int = match x",
      "    colour => colour + tone",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    const reason = refusal(session.rename("/main.hex", at(source, "colour"), "tone"));
    expect(reason).toContain("would change what the code means");
    expect(reason).toContain("line 3");
  });

  test("allows a shadowing rename that changes nothing", () => {
    // The mirror of the case above: the arm binder still shadows a module-level
    // `tone`, but nothing inside the arm refers to the outer one, so the rename
    // is meaning-preserving and must not be refused out of caution.
    const source = [
      "let tone: Int = 1",
      "let f(x: Int): Int = match x",
      "    colour => colour + 1",
      "",
    ].join("\n");
    const { session, texts } = sessionOf({ "/main.hex": source });
    const plan = session.rename("/main.hex", at(source, "colour"), "tone");
    expect(applied(texts, plan)["/main.hex"]).toBe(source.replaceAll("colour", "tone"));
  });

  test("refuses a collision whose message differs only by the line it names", () => {
    // The two spellings are blanked out of every message before it is counted,
    // so `\`q\` is already bound (line 2)` and `\`p\` is already bound (line 1)`
    // are the same sentence with one number of difference — and that number is
    // all that is left to tell a collision the rename caused from the one that
    // was already there. Positions are not decoration here.
    const source = [
      "let p: Int = 0",
      "let q: Int = 1",
      "let q: Int = 2",
      "export fun use(): Int = p",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(refusal(session.rename("/main.hex", at(source, "q", 2), "p")))
      .toContain("`p` is already bound (line 1)");
  });

  test("renaming to the same name is a plan with nothing in it", () => {
    const source = "let value: Int = 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    const plan = session.rename("/main.hex", at(source, "value"), "value");
    expect(plan).toEqual({ newName: "value", edits: [] });
  });

  test("prepareRename answers with the identifier, and says nothing where there is none", () => {
    const source = "let value: Int = 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    const subject = session.prepareRename("/main.hex", at(source, "value"));
    expect(subject).toEqual({
      name: "value",
      span: expect.objectContaining({
        start: expect.objectContaining({ offset: at(source, "value") }),
      }),
    });
    // On the `=`, where there is no name at all: an editor should say nothing
    // rather than report a problem, which is a different answer from a refusal.
    expect(session.prepareRename("/main.hex", at(source, "="))).toBeUndefined();
  });

  test("prepareRename refuses what rename would refuse, before the user types", () => {
    const source = "let maybe: Option(Int) = None\n";
    const { session } = sessionOf({ "/main.hex": source });
    expect(refusal(session.prepareRename("/main.hex", at(source, "None"))))
      .toContain("this project does not own");
  });

  test("leaves the session's own analysis untouched", () => {
    const source = ["let tone: Int = 1", "let colour: Int = 2", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const settled = session.version;
    session.rename("/main.hex", at(source, "colour"), "tone");
    session.rename("/main.hex", at(source, "colour"), "shade");
    // Verification compiles an edited copy of the project. Doing that on the
    // real file set would leave the user's session holding text they never
    // typed, and would invalidate analysis on a request that only asked.
    expect(session.version).toBe(settled);
    expect(session.diagnostics("/main.hex")).toEqual([]);
  });
});
