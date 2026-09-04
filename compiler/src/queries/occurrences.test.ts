import { describe, expect, test } from "vitest";
import { compileFiles } from "../support/test-project.js";
import { collectOccurrences, targetKey, type Occurrence } from "./occurrences.js";
import type { CompiledProject } from "../project.js";

/** Compiles a project and indexes it, refusing sources the compiler rejected. */
function index(
  files: readonly (readonly [string, string])[],
): { readonly project: CompiledProject; readonly occurrences: Map<string, readonly Occurrence[]> } {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return {
    project,
    occurrences: new Map(
      project.modules.map((module) => [
        module.source.path,
        collectOccurrences(module),
      ]),
    ),
  };
}

/**
 * Renders occurrences as `role kind "text"`. Identities are deliberately absent:
 * symbol and union numbers move whenever the prelude does, and what a reader
 * needs to see is which name was found in which role. Identity sharing gets its
 * own assertions through `targetKey`.
 */
function render(
  occurrences: readonly Occurrence[],
  text: string,
  filter?: (occurrence: Occurrence) => boolean,
): readonly string[] {
  return occurrences
    .filter((occurrence) => filter?.(occurrence) ?? true)
    .map((occurrence) =>
      `${occurrence.role} ${occurrence.target.kind} ${JSON.stringify(
        text.slice(occurrence.span.start.offset, occurrence.span.end.offset),
      )}`
    );
}

/**
 * `spec/lexer.md` §3's identifier. Written from the spec rather than copied from
 * the implementation on purpose: an assertion that reuses the pattern under test
 * agrees with it by construction and cannot fail for the bug it is named after.
 */
const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$_\u200C\u200D]*$/u;

describe("collectOccurrences", () => {
  test("a span never covers more than the identifier", () => {
    const source = [
      "record Box(a) = {",
      "    item: a,",
      "}",
      "",
      "union Colour =",
      "    | Red",
      "    | Green",
      "",
      "let paint(b: Box(Colour)): Colour = b.item",
      "",
    ].join("\n");
    const { occurrences } = index([["/main.hex", "module Main\n\n" + source]]);
    const own = occurrences.get("/main.hex")!;
    for (const occurrence of own) {
      const text = source.slice(occurrence.span.start.offset, occurrence.span.end.offset);
      expect(text, `${occurrence.role} ${targetKey(occurrence.target)}`).toMatch(IDENTIFIER);
    }
    // `Box(Colour)` is a single annotation span; the index has to see the head
    // name and the argument as two separate occurrences.
    expect(render(own, source, (o) => o.role === "reference")).toEqual([
      'reference record "Box"',
      'reference union "Colour"',
      'reference union "Colour"',
      'reference value "b"',
    ]);
  });

  test("a record name denotes both its type and its constructor", () => {
    const source = [
      "record Box(a) = {",
      "    item: a,",
      "}",
      "",
      "let one = Box({item = 1})",
      "",
    ].join("\n");
    const { occurrences } = index([["/main.hex", "module Main\n\n" + source]]);
    const own = occurrences.get("/main.hex")!;
    const boxes = own.filter((occurrence) => occurrence.name === "Box");
    expect(render(boxes, source)).toEqual([
      'definition record "Box"',
      'definition value "Box"',
      'reference value "Box"',
    ]);
    // Both definitions sit on one span, which is what lets a request at that
    // position answer for either meaning rather than having to choose blind.
    const [type, constructor, use] = boxes;
    expect(type!.span.start.offset).toBe(constructor!.span.start.offset);
    expect(targetKey(constructor!.target)).toBe(targetKey(use!.target));
    expect(targetKey(type!.target)).not.toBe(targetKey(constructor!.target));
  });

  test("references reach across modules by shared identity", () => {
    const helper = ["export union Colour =", "    | Red", "    | Green", ""].join("\n");
    const main = [
      'import Helper',
      "",
      "let pick(c: Helper.Colour): Helper.Colour =",
      "    match c",
      "        Red => Helper.Red",
      "        other => other",
      "",
    ].join("\n");
    const { occurrences } = index([["/helper.hex", "module Helper\n\n" + helper], ["/main.hex", "module Main\n\n" + main]]);
    const helperOwn = occurrences.get("/helper.hex")!;
    const mainOwn = occurrences.get("/main.hex")!;

    const declaration = helperOwn.find(
      (occurrence) => occurrence.name === "Colour" && occurrence.role === "definition",
    )!;
    const colour = targetKey(declaration.target);
    // The declaring module publishes the definition and the importer publishes
    // only its own uses, so the two lists compose into the full reference set
    // without either module reporting a span it does not own.
    expect(render(mainOwn, main, (o) => targetKey(o.target) === colour)).toEqual([
      'reference union "Colour"',
      'reference union "Colour"',
    ]);
    expect(helperOwn.filter((o) => targetKey(o.target) === colour)).toHaveLength(1);

    // `Red` is a value symbol declared elsewhere: the arm's door-reached
    // pattern and the qualified expression are both references here, and the
    // definition stays in the declaring module.
    const red = mainOwn.filter((occurrence) => occurrence.name === "Red");
    expect(render(red, main)).toEqual([
      'reference value "Red"',
      'reference value "Red"',
    ]);
    const redKeys = new Set(red.map((occurrence) => targetKey(occurrence.target)));
    expect(redKeys.size).toBe(1);
    expect(
      helperOwn.some(
        (occurrence) =>
          occurrence.role === "definition" && redKeys.has(targetKey(occurrence.target)),
      ),
    ).toBe(true);
  });

  test("constraints are indexed by name, declaration and every mention", () => {
    const source = [
      "constraint Show2<a> =",
      "    show2(value: a): String",
      "",
      "honor Show2<Int> =",
      "    show2(value) = \"int\"",
      "",
      "let describe<a: Show2>(value: a): String = show2(value)",
      "",
    ].join("\n");
    const { occurrences } = index([["/main.hex", "module Main\n\n" + source]]);
    const own = occurrences.get("/main.hex")!;
    expect(render(own, source, (o) => o.target.kind === "constraint")).toEqual([
      'definition constraint "Show2"',
      'reference constraint "Show2"',
      'reference constraint "Show2"',
    ]);
    // The constraint members are ordinary value symbols, so a constraint's
    // declaration and its members are separate identities at separate spans.
    expect(render(own, source, (o) => o.name === "show2")).toEqual([
      'definition value "show2"',
      'reference value "show2"',
    ]);
  });

  test("`derives` is a constraint reference, not a self-reference", () => {
    const source = ["union Colour derives (Eq, Show) =", "    | Red", "    | Green", ""].join("\n");
    const { occurrences } = index([["/main.hex", "module Main\n\n" + source]]);
    const own = occurrences.get("/main.hex")!;
    // The resolver turns each `derives` entry into a synthesized `honor` whose
    // every span is the union declaration's. Publishing that would make `Colour`
    // a reference to itself, so the union must appear exactly once.
    expect(render(own, source, (o) => o.name === "Colour")).toEqual([
      'definition union "Colour"',
    ]);
    expect(render(own, source, (o) => o.target.kind === "constraint")).toEqual([
      'reference constraint "Eq"',
      'reference constraint "Show"',
    ]);
  });

  test("an extern block's type is a definition its uses point back to", () => {
    const source = [
      'extern from "./widget.js"',
      "    type Widget",
      "    fun widen(value: Widget): Widget",
      "",
    ].join("\n");
    const { occurrences } = index([["/main.hex", "module Main\n\n" + source]]);
    const own = occurrences.get("/main.hex")!;
    expect(render(own, source, (o) => o.target.kind === "extern-type")).toEqual([
      'definition extern-type "Widget"',
      'reference extern-type "Widget"',
      'reference extern-type "Widget"',
    ]);
    const keys = new Set(
      own
        .filter((occurrence) => occurrence.target.kind === "extern-type")
        .map((occurrence) => targetKey(occurrence.target)),
    );
    expect(keys.size).toBe(1);
  });

  test("the prelude's injected imports are not occurrences", () => {
    const source = "let flag = Some(1)\n";
    const { occurrences } = index([["/main.hex", "module Main\n\n" + source]]);
    const own = occurrences.get("/main.hex")!;
    // Every module carries the prelude's imports, whose names span the whole
    // module. Left in, `Some`, `None`, `True` and `False` would each claim the
    // entire file and swallow every request made anywhere in it.
    const wholeFile = own.filter(
      (occurrence) => occurrence.span.end.offset - occurrence.span.start.offset > 16,
    );
    expect(render(wholeFile, source)).toEqual([]);
    expect(render(own, source, (o) => o.name === "Some")).toEqual(['reference value "Some"']);
  });

  test("a non-ASCII name is one identifier, not its ASCII prefix", () => {
    // `spec/lexer.md` §3 admits any `ID_Start`/`ID_Continue`, and gives
    // `Résultat` and `δelta` as examples. An ASCII-only pattern matches such a
    // name *partially*, which is worse than not matching: the "not an
    // identifier" fallback never fires and the span is silently truncated.
    const source = [
      "record TRésultat(a) = {",
      "    item: a,",
      "}",
      "",
      "let unwrapδ(b: TRésultat(Int)): Int = b.item",
      "",
    ].join("\n");
    const { occurrences } = index([["/main.hex", "module Main\n\n" + source]]);
    const own = occurrences.get("/main.hex")!;
    expect(render(own, source, (o) => o.name === "TRésultat")).toEqual([
      'definition record "TRésultat"',
      'definition value "TRésultat"',
      'reference record "TRésultat"',
    ]);
    expect(render(own, source, (o) => o.name === "unwrapδ")).toEqual([
      'definition value "unwrapδ"',
    ]);
  });

  test("an import publishes nothing, having no names of its own", () => {
    const helper = "export let two: Int = 2\n";
    const main = ['import Helper as H', "", "let four: Int = H.two + H.two", ""].join("\n");
    const { occurrences } = index([["/helper.hex", "module Helper\n\n" + helper], ["/main.hex", "module Main\n\n" + main]]);
    const own = occurrences.get("/main.hex")!;
    // An import binds a module and nothing smaller (Modules §3, #762): the one
    // name on the line is the alias, which is a module and no term or type. The
    // resolver expands it into one entry per reachable member, each carrying the
    // whole import statement as its span; publishing those would put a member on
    // top of the `import` keyword and the specifier string.
    expect(render(own, main, (o) => o.span.start.line === 0)).toEqual([]);
    expect(render(own, main, (o) => o.span.start.line === 2)).toEqual([
      'definition value "four"',
      'reference value "two"',
      'reference value "two"',
    ]);
  });

  test("a type reached through an alias indexes at its own mention, not at the import", () => {
    // The specifier-resolving option this query once took is gone with the named
    // import (#762): no import line carries a type name, so nothing on it needs
    // a specifier resolved to be indexed, and the type's occurrences are the
    // annotations that mention it.
    const helper = ["export union Shade =", "    | Pale", "    | Deep", ""].join("\n");
    const main = ['import Helper as H', "", "let q(y: H.Shade): H.Shade = y", ""].join("\n");
    const project = compileFiles([["/helper.hex", "module Helper\n\n" + helper], ["/main.hex", "module Main\n\n" + main]]);
    expect(project.diagnostics).toEqual([]);
    const module = project.modules.find(({ source }) => source.path === "/main.hex")!;
    const own = collectOccurrences(module);
    expect(render(own, main, (o) => o.span.start.line === 0)).toEqual([]);
    expect(render(own, main, (o) => o.span.start.line === 2)).toEqual([
      'definition value "q"',
      'definition value "y"',
      'reference union "Shade"',
      'reference union "Shade"',
      'reference value "y"',
    ]);
  });

  test("every occurrence belongs to the module that published it", () => {
    const { project, occurrences } = index([
      ["/helper.hex", "module Helper\n\n" + "export let two: Int = 2\n"],
      ["/main.hex", "module Main\n\n" + 'import Helper as H\n\nlet four = H.two + H.two\n'],
    ]);
    for (const module of project.modules) {
      for (const occurrence of occurrences.get(module.source.path) ?? []) {
        expect(occurrence.span.fileId).toBe(module.resolved.fileId);
      }
    }
  });

  test("the prelude indexes without a span escaping its identifier or its file", () => {
    // The prelude is the largest real Hexagon corpus available: opaque records,
    // derived instances, an intrinsic extern block, qualified names, and deep
    // constraint hierarchies at once. Nothing here asserts counts; the point is
    // that the traversal stays total and keeps its file discipline on real code.
    // `compileProject` returns only the modules it emits, and a prelude module
    // is emitted only when something reaches it — so the corpus has to be pulled
    // in by using it.
    const project = compileFiles([[
      "/main.hex",
      "module Main\n\n" + [
        'import Seq as S',
        "",
        "let doubled = S.map(Seq.iterate(1, (n) => n + 1), (n) => n * 2)",
        "let maybe: Option(Int) = Some(1)",
        "",
      ].join("\n"),
    ]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(project.modules.length).toBeGreaterThan(1);
    let total = 0;
    for (const module of project.modules) {
      const own = collectOccurrences(module);
      total += own.length;
      for (const occurrence of own) {
        expect(occurrence.span.fileId).toBe(module.resolved.fileId);
        const text = module.source.text.slice(
          occurrence.span.start.offset,
          occurrence.span.end.offset,
        );
        expect(text, `${module.source.path}: ${targetKey(occurrence.target)}`).toMatch(IDENTIFIER);
      }
    }
    expect(total).toBeGreaterThan(100);
  });
});
