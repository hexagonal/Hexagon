import { describe, expect, test } from "vitest";
import { AnalysisSession } from "./session.js";

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
    expect(hover?.target.kind).toBe("value");
    expect(hover?.displayedType).toBe("Colour -> Colour");
  });

  test("hover on a type names the type without inventing one", () => {
    const { session } = sessionOf({ "/helper.hex": HELPER, "/main.hex": MAIN });
    const hover = session.hover("/main.hex", at(MAIN, "Colour", 2));
    expect(hover?.name).toBe("Colour");
    expect(hover?.target.kind).toBe("union");
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
    expect(session.hover("/main.hex", fromBound)?.target.kind).toBe("constraint");
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
