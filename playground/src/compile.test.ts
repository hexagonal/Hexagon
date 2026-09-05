import { describe, expect, test, vi } from "vitest";

import { helloWorld } from "./examples/hello-world";
import { internationalIdentifiers } from "./examples/international-identifiers";
import { payloadUnions } from "./examples/payload-unions";
import { specializations } from "./examples/specializations";
import { rat } from "./examples/rat";
import { vectors } from "./examples/vectors";
import { compileSource } from "./compile";
import { linkModule } from "./module-execution";
import type { GeneratedSection } from "./protocol";

/**
 * The header every buffer declares since #829 (Modules §2.1).
 *
 * Written into each source below rather than added by a helper, because these
 * tests assert offsets into the text the user has, and because a Playground
 * buffer *is* an ordinary `.hex` file now — the header is part of the program
 * each case is about, not scaffolding around it.
 */
const MAIN = "module Main\n\n";

describe("compileSource", () => {
  test("compiles the canonical Vector module surface", () => {
    const response = compileSource(5, vectors.source);

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    // `Vector` is a prelude module, so its members are in scope with no import
    // to write: they arrive named, through the same channel `Seq`'s
    // `take`/`iterate` arrive on, and the calls are bare.
    expect(response.javascript).toContain(
      'import { fromSeq, append, set, at, get } from "./Hex/Vector.js";',
    );
    expect(response.javascript).not.toContain("import * as Vector");
    expect(response.javascript).toContain("append(numbers, 40)");
    expect(response.javascript).toContain("set(extended, 2, 25)");
    expect(response.javascript).toContain("at(updated, -1)");
    expect(response.javascript).toContain("get(updated, 5)");
    const vectorModule = response.executionModules.find(({ path }) =>
      path === "/Hex/Vector.hex"
    );
    expect(vectorModule?.javascript).not.toContain(
      "const __persistentCollections",
    );
    // `Option`/`Some`/`None` are implicit via the prelude; Vector imports only
    // the constructors it *names*, and since #770 a `Some(...)` application
    // names none — it erases into its object literal — so only the shared
    // `None` constant is left to bind.
    expect(vectorModule?.javascript).toContain(
      'import { None } from "./Option.js";',
    );
    expect(vectorModule?.javascript).toContain('{ tag: "Some", value: ');
  });

  // The observation channel is an export, not a sink (#417): the assertions
  // below read the crossed `Vector` values themselves, and `log` renders a
  // `String`. An exported binding hands them over unrendered, which is what
  // this test is about, and it is what a consumer of the emitted module reads.
  // The written signature is the price of exporting (Modules §4.1.1) — and it
  // is also what pins `Vector.empty`'s element, which nothing else here does.
  test("executes the complete canonical Vector core API", async () => {
    const response = compileSource(
      5,
      MAIN +
        "let values = [10, 20, 30]\n" +
        "let updated = Vector.set(values, 2, 25)\n" +
        "export let crossed: (Vector(Int), Vector(Int), Bool, Int, " +
        "Vector(Int), Vector(Int), Option(Int), Option(Int), Vector(Int), " +
        "Vector(Int), Option(Int), Option(Int), Int, Vector(Int), " +
        "Vector(Int), Vector(Int)) = (\n" +
        "    Vector.empty,\n" +
        "    Vector.singleton(7),\n" +
        "    Vector.isEmpty([]),\n" +
        "    Vector.length(values),\n" +
        "    Vector.append(values, 40),\n" +
        "    Vector.prepend(values, 0),\n" +
        "    Vector.first(values),\n" +
        "    Vector.last(values),\n" +
        "    Vector.dropFirst(values),\n" +
        "    Vector.dropLast(values),\n" +
        "    Vector.get(values, 2),\n" +
        "    Vector.get(values, 9),\n" +
        "    Vector.at(values, -1),\n" +
        "    updated,\n" +
        "    values,\n" +
        "    Vector.fromSeq(Vector.toSeq(values))\n" +
        ")\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    const moduleUrls = new Map<string, string>();
    for (const module of response.executionModules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
      );
    }
    const entry = await import(
      /* @vite-ignore */ moduleUrls.get(response.entryPath)!
    ) as { readonly crossed: unknown[] };
    // The tuple crosses as a JavaScript array, but each `Vector` in it is the
    // Collections Part 3 §4 trie, so the vector-valued slots are read through
    // the representation contract's `[Symbol.iterator]` — which is the same
    // spread a user of the emitted program would write.
    const crossed = entry.crossed;
    const vector = (index: number): unknown[] => [...(crossed[index] as Iterable<unknown>)];
    expect([
      vector(0),
      vector(1),
      crossed[2],
      crossed[3],
      vector(4),
      vector(5),
      crossed[6],
      crossed[7],
      vector(8),
      vector(9),
      crossed[10],
      crossed[11],
      crossed[12],
      vector(13),
      vector(14),
      vector(15),
    ]).toEqual([
      [],
      [7],
      true,
      3,
      [10, 20, 30, 40],
      [0, 10, 20, 30],
      { tag: "Some", value: 10 },
      { tag: "Some", value: 30 },
      [20, 30],
      [10, 20],
      { tag: "Some", value: 20 },
      { tag: "None" },
      30,
      [10, 25, 30],
      [10, 20, 30],
      [10, 20, 30],
    ]);
  });

  test("preserves the original signed index in Vector.at failures", async () => {
    const response = compileSource(5, `${MAIN}let impossible = Vector.at([10, 20], -3)\n`);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    const moduleUrls = new Map<string, string>();
    for (const module of response.executionModules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
      );
    }
    let thrown: unknown;
    try {
      await import(/* @vite-ignore */ moduleUrls.get(response.entryPath)!);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: "IndexError",
      message: "index -3 out of bounds for size 2",
      $hex: "Hex.Vector",
      index: -3,
      size: 2,
    });
  });

  test("shows idiomatic payload-union constructions in JavaScript output", () => {
    const response = compileSource(6, payloadUnions.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    // Unions §6.4, since #770: an applied constructor *is* its object literal,
    // and this example applies its constructors and never hands one on — so no
    // function is materialised for any of them. The nullary constant stays,
    // because a construction of it is a read of the constant.
    expect(response.javascript).toContain(
      'preserve({ tag: "Circle", radius: 3.0 })',
    );
    expect(response.javascript).toContain(
      'describe({ tag: "Accepted", details: ["Ada", 2] })',
    );
    expect(response.javascript).toContain('const Point = { tag: "Point" };');
    expect(response.javascript).not.toContain("const Circle = ");
    expect(response.javascript).not.toContain("Circle(");
    expect(response.javascript).not.toContain("radius: radius");
  });

  test("compiles international JavaScript-compatible identifiers without mangling", () => {
    const response = compileSource(6, internationalIdentifiers.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    // The record constructor is applied and never handed on, so Products §5.4's
    // on-demand rule materialises no identity function for it (#770); the
    // construction below is the whole of what it emitted.
    expect(response.javascript).not.toContain("const Tउपयोगकर्ता = ");
    expect(response.javascript).toContain(
      "const __C可显示_Tउपयोगकर्ता",
    );
    expect(response.javascript).toContain("const 用户 = { नाम: \"अनाया\", 城市: \"上海\" };");
    expect(response.javascript).toContain("const $税率 = 0.10;");
    expect(response.javascript).toContain("const _折扣 = 5;");
    expect(response.javascript).toContain('import * as Mगणित from "./Mगणित.js";');
    // #440: the interpolation is at `String`, so the probe call reaches
    // `Debug.hex`'s own `logString` edition and hands it no dictionary.
    expect(response.javascript).toContain("logString(展示(用户,");
    expect(response.javascript).toContain("Mगणित.जोड़(20, 22)");
    // **What a program pays for is what it reaches** (Packages §6). This source
    // imports no library module, so none of `Hex` is emitted but `Debug.hex`,
    // where the probe line lands (#407 puts one in every sample). `/Debug.hex`
    // alone, and not `/String.hex` behind it: #419's widened `log<a: Show>`
    // made the site carry `Show<String>` and #440 took it back, because a line
    // written at `String` reaches `logString` and needs no companion dictionary.
    //
    // Eight of these paths left the list at #829's Ruling B, and their leaving
    // is the ruling. `Rat` used to be a file of the **compiled project** — the
    // Playground handed it over from `stdlib/` — and a project module is
    // emitted whether or not anything reaches it, dragging `Ordering`,
    // `BigInt`, `Integral`, `Pow`, `Float`, `Int` and `Option` behind it into
    // the output of a program that never mentioned a rational number. `Rat` is
    // `Hex.Rat` now, so it is emitted where it is imported and nowhere else.
    //
    // Every path is a module's **layout** path (Packages §6) — its full name
    // laid out — and not the file it was supplied under: `Hex`'s modules sit
    // under `Hex/`, and the project's own at the root by their declared names.
    expect(response.executionModules.map(({ path }) => path)).toEqual([
      "/Hex/Debug.hex",
      "/Mगणित.hex",
      "/Main.hex",
    ]);
  });

  test("reports a diagnostic from any module at the offset the buffer shows", () => {
    const source =
      "module Repo\n" +
      "\n" +
      "export let broken = missing\n" +
      "\n" +
      "end module Repo\n" +
      "\n" +
      "module Main\n" +
      "\n" +
      "import Repo\n" +
      "\n" +
      "Debug.log(Repo.broken)\n";
    const response = compileSource(7, source);

    expect(response.kind).toBe("compile-failure");
    if (response.kind !== "compile-failure") return;
    expect(response.diagnostics).toContainEqual({
      severity: "error",
      message: "unknown name `missing`",
      startOffset: source.indexOf("missing"),
      endOffset: source.indexOf("missing") + "missing".length,
    });
  });

  /**
   * The header is the buffer's own text now, so nothing about a module's body
   * has to be measured to write one: the two cases that used to break the
   * minting — a comment above an indented body, and a body indented with a tab
   * — are a comment and a tab, read by the lexer as it reads any other.
   */
  test("a module's body is laid out at its own margin, comments and all", () => {
    const source = "module Geo\n" +
      "\n" +
      "(* a note *)\n" +
      "export let a: Int = 1\n" +
      "\n" +
      "end module Geo\n" +
      "\n" +
      "module Main\n" +
      "\n" +
      "import Geo\n" +
      "\n" +
      "Debug.log(\"${Geo.a}\")\n";

    expect(compileSource(7, source)).toMatchObject({ kind: "compile-success", diagnostics: [] });
  });

  test("previews private bindings through JavaScript and TypeScript emission", () => {
    const response = compileSource(7, helloWorld.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.version).toBe(7);
    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain(
      "// Unions describe a closed set of alternatives.",
    );
    expect(response.javascript).toContain("const card = [10, Hearts];");
    expect(response.javascript).toContain("const greet =");
    expect(response.javascript).toContain("const plus =");
    expect(response.javascript).toContain("function factorial(n)");
    expect(response.javascript).toContain("const color =");
    // #419 made the probe `log<a: Show>`, so the site took a trailing
    // dictionary; #440 makes it concrete at `String`, so it reaches the
    // `logString` edition instead and takes none. The binding this line is
    // really about is `greet`.
    expect(response.javascript).toContain('logString(greet("Hexagon"));');
    expect(response.javascript).not.toContain("export { greet }");
    expect(response.typeScriptPreview).toContain("declare const greet");
    expect(response.typeScriptPreview).toContain("declare function factorial");
    expect(response.typeScriptPreview).not.toContain(
      "export declare const greet",
    );
    expect(response.types.map(({ name, displayedType }) => ({ name, displayedType }))).toEqual([
      { name: "card", displayedType: "(Int, Suit)" },
      { name: "rank", displayedType: "Int" },
      { name: "suit", displayedType: "Suit" },
      { name: "greet", displayedType: "String -> String" },
      { name: "greet2", displayedType: "<a: Show> a -> String" },
      { name: "plus", displayedType: "(Int, Int) -> Int" },
      { name: "factorial", displayedType: "Int -> Int" },
      { name: "color", displayedType: "Suit -> String" },
    ]);
  });

  test("compiles the canonical multiline conditional", () => {
    const response = compileSource(
      8,
      MAIN +
        "fun fact(n: Int): Int =\n" +
        "    if n <= 1 then\n" +
        "        1\n" +
        "    else\n" +
        "        n * fact(n - 1)\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain("function fact(n)");
    expect(response.typeScriptPreview).toContain(
      "declare function fact(n: number): number",
    );
    expect(response.types.map(({ name, displayedType }) => ({ name, displayedType }))).toEqual([
      { name: "fact", displayedType: "Int -> Int" },
    ]);
  });

  test("compiles first-argument pipe insertion through the worker pipeline", () => {
    const response = compileSource(
      9,
      MAIN +
        "let add(x: Int, y: Int) = x + y\n" +
        "let answer = 1 |> add(2) |> add(3)\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain("const answer = add(add(1, 2), 3);");
    expect(response.types.map(({ name, displayedType }) => ({ name, displayedType }))).toEqual([
      { name: "add", displayedType: "(Int, Int) -> Int" },
      { name: "answer", displayedType: "Int" },
    ]);
  });

  test("returns private specialization regions for compact JavaScript views", () => {
    const response = compileSource(11, `${MAIN}let plus(x, y) = x + y\n`);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.javascript).toContain("function plusNat(x, y)");
    expect(response.javascript).toContain("function plusInt(x, y)");
    expect(response.javascript).toContain("function plusFloat(x, y)");
    expect(response.javascript).toContain("function plusBigInt(x, y)");
    expect(response.generatedJavaScript).toMatchObject([
      { generatedName: "plusNat", typeArguments: ["Nat"] },
      { generatedName: "plusInt", typeArguments: ["Int"] },
      { generatedName: "plusFloat", typeArguments: ["Float"] },
      { generatedName: "plusBigInt", typeArguments: ["BigInt"] },
    ]);
    for (const section of response.generatedJavaScript) {
      expect(response.javascript.slice(section.startOffset, section.endOffset)).toContain(
        `function ${section.generatedName}`,
      );
      expect(section.bytes).toBeGreaterThan(0);
    }
    expect(response.typeScriptPreview).toContain(
      "declare function plusInt(x: number, y: number): number;",
    );
    // The private half of §10's two-artefact accounting: `plus` is not
    // exported, so the ordinary emission's declarations carry no face for any of
    // these four bodies. The pane previews the bodies anyway, and the report
    // says the faces are absent rather than weightless.
    expect(response.generatedDeclarations).toEqual([]);
    expect(response.zeroEntryPointExports).toEqual([]);
  });

  /**
   * Zero-Cost Fundamental Exports §10's two obligations, as the Playground's
   * generated-sections panel reads them: the `.d.ts` size beside the JS size for
   * every edition, and §3.4's list of the exports that published no typed entry
   * point.
   */
  describe("the build report's two obligations", () => {
    /** §16(h)'s constraint: no fundamental type honors it, so no tuple is lawful. */
    const weighty = "constraint Weighty<a> =\n    weight(subject: a): Float\n\n";
    const heaviest = "export fun heaviest<a: Weighty>(x: a, y: a): Float =\n" +
      "    if x.weight() > y.weight() then x.weight() else y.weight()\n";
    const stamp = "export fun stamp<a: Hash>(x: a, salt: Int): Int = x.hash() + salt\n";

    test("reports both artefacts' sizes and the zero-entry-point export beside them", () => {
      const response = compileSource(40, `${MAIN}${weighty}${heaviest}\n${stamp}`);

      expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (response.kind !== "compile-success") return;

      // `stamp` mints one edition per fundamental — every one of the seven holds
      // a lawful `Hash` — and `heaviest` mints none at all. One module, both
      // halves of the report.
      expect(response.generatedJavaScript.map(({ generatedName }) => generatedName)).toEqual([
        "stampNat",
        "stampInt",
        "stampFloat",
        "stampBigInt",
        "stampBool",
        "stampString",
        "stampUnit",
      ]);
      expect(response.generatedDeclarations.map(({ generatedName }) => generatedName)).toEqual(
        response.generatedJavaScript.map(({ generatedName }) => generatedName),
      );
      expect(response.zeroEntryPointExports).toEqual(["heaviest"]);

      // The two lists are the same plan read twice and they disagree about size,
      // which is why §10 asks for both rather than a total: `stampFloat` weighs
      // more as a body than as a face. Every row of both carries a size.
      const javaScriptBytes = response.generatedJavaScript.map(({ bytes }) => bytes);
      const declarationBytes = response.generatedDeclarations.map(({ bytes }) => bytes);
      expect(javaScriptBytes.every((bytes) => bytes > 0)).toBe(true);
      expect(declarationBytes.every((bytes) => bytes > 0)).toBe(true);
      expect(declarationBytes).not.toEqual(javaScriptBytes);
    });

    /**
     * §16(h) exactly: legal, visible, and still a working Hexagon export. The
     * module generates nothing, so a panel gated on the edition list would show
     * the author nothing — in the one case where the absence is the whole news.
     */
    test("lists an export with no entry points even where nothing was generated", () => {
      const response = compileSource(41, `${MAIN}${weighty}${heaviest}`);

      expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (response.kind !== "compile-success") return;

      expect(response.generatedJavaScript).toEqual([]);
      expect(response.generatedDeclarations).toEqual([]);
      expect(response.zeroEntryPointExports).toEqual(["heaviest"]);
      // §3.4's second bullet: the typed surface is what the exception removes.
      // The ESM still carries the evidence-taking form as plumbing, which is
      // what keeps the export callable from another Hexagon module.
      expect(response.javascript).toContain("heaviest");
      expect(response.typeScriptPreview).not.toContain("heaviest");
    });

    test("reports nothing at all for a module whose exports are unconstrained", () => {
      const response = compileSource(42, `${MAIN}export fun plain(x: Int): Int = x + 1\n`);

      expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (response.kind !== "compile-success") return;

      // `plain` carries no constrained variable, so §3.1 never made it eligible.
      // A list phrased on "published no face" alone would name it here.
      expect(response.generatedJavaScript).toEqual([]);
      expect(response.generatedDeclarations).toEqual([]);
      expect(response.zeroEntryPointExports).toEqual([]);
    });

    /**
     * `bytes` is UTF-8 and the offsets index the text as JavaScript does, so a
     * panel that labelled a region with `endOffset - startOffset` would
     * under-report the file on disk.
     *
     * Which artefact diverges is a property of where the author's non-ASCII text
     * sits, not of either artefact, and the two sources below are measured
     * against each other to say so. Neither list may be assumed to agree: an
     * accented doc comment separates the `.d.ts` rows while the JavaScript rows
     * match, and an accented string literal in the body does the reverse.
     */
    test("measures every edition in UTF-8 bytes, whichever artefact holds the prose", () => {
      const documented = compileSource(
        43,
        `${MAIN}(** Mélange un sel — «précision» — pour séparer deux valeurs égales. *)\n${stamp}`,
      );
      // No doc block at all, and the accents inside the body's own literal.
      const accentedBody = compileSource(
        44,
        MAIN +
          "export fun label<a: Show>(x: a): String = \"Mélange «précision» — ${x}\"\n",
      );

      expect(documented).toMatchObject({ kind: "compile-success", diagnostics: [] });
      expect(accentedBody).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (documented.kind !== "compile-success") return;
      if (accentedBody.kind !== "compile-success") return;

      const span = ({ startOffset, endOffset }: GeneratedSection): number =>
        endOffset - startOffset;

      // A `.d.ts` row spans the edition's own documentation block, so the
      // author's prose is inside that measurement — 148 bytes across a
      // 138-index span here — while the bodies beside it stay ASCII.
      expect(documented.generatedDeclarations.every((s) => s.bytes > span(s))).toBe(true);
      expect(documented.generatedJavaScript.every((s) => s.bytes === span(s))).toBe(true);

      // The same two claims, exchanged. The `.d.ts` face renders the signature
      // and not the literal, so it is the JavaScript that carries the accents:
      // 77 bytes across a 71-index span, with the faces exact.
      expect(accentedBody.generatedJavaScript.every((s) => s.bytes > span(s))).toBe(true);
      expect(accentedBody.generatedDeclarations.every((s) => s.bytes === span(s))).toBe(true);

      // What holds of both, and the only relation the panel may rely on.
      for (const response of [documented, accentedBody]) {
        for (const section of [...response.generatedJavaScript, ...response.generatedDeclarations]) {
          expect(section.bytes).toBeGreaterThanOrEqual(span(section));
        }
      }
    });
  });

  test("routes the specialization example's concrete calls through its editions", () => {
    const response = compileSource(12, specializations.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    // The claim is the routing — each concrete call reaches its own edition
    // rather than the generic `plus`. Since #440 the probe wrapping them is
    // routed too: the interpolation is at `String`, so `log` reaches its own
    // edition and no dictionary is left anywhere on these lines.
    expect(response.javascript).toContain("logString(String(plusInt(20, 22)));");
    expect(response.javascript).toContain("logString(String(plusFloat(20.0, 1.5)));");
    expect(response.javascript).toContain("logString(String(plusBigInt(10n, 20n)));");
    expect(response.javascript).not.toContain("Debug.log(String(plus(20, 22,");
    expect(response.javascript).toContain("const count = 3;");
    expect(response.javascript).toContain("const cost = 1.50;");
    expect(response.javascript).toContain("const total = count * cost;");
    expect(
      response.types.slice(-3).map(({ name, displayedType }) => ({
        name,
        displayedType,
      })),
    ).toEqual([
      { name: "count", displayedType: "Int" },
      { name: "cost", displayedType: "Float" },
      { name: "total", displayedType: "Float" },
    ]);
  });

  test("compiles the Rat example through exact BigInt arithmetic", () => {
    const response = compileSource(13, rat.source);

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain('import * as Rat from "./Hex/Rat.js";');
    expect(response.javascript).toContain(
      "const fiveSixths = __Num_Rat.add(half, third);",
    );
    expect(response.javascript).toContain(
      "const threeHalves = __Frac_Rat.divide(half, third);",
    );
    expect(response.javascript).toContain("const half = Rat.create(1n, 2n);");
    expect(response.javascript).toContain("const tenTwelfths = Rat.create(10n, 12n);");
    expect(response.javascript).toContain("tenTwelfths, fiveSixths");
    expect(response.javascript).not.toContain("opaque record Rat");
    expect(response.executionModules.map(({ path }) => path)).toContain(
      "/Hex/Rat.hex",
    );
    const ratModule = response.executionModules.find(({ path }) =>
      path === "/Hex/Rat.hex"
    );
    expect(ratModule?.javascript).toContain('bottom === 0n');
    expect(ratModule?.javascript).toContain('reducedBottom < 0n');
    // The brand is `Integral.hex`'s `exception` declaration now, reached by
    // import (#344), rather than a helper branding an `Error` in place. The
    // observable — name, message, `$hex` — is pinned by the executed test
    // below, which is where it belongs.
    expect(ratModule?.javascript).toContain("DivideByZeroError(\"Rat.create: bottom is zero\")");
    // One directory down now, because `Hex.Rat` is laid out under `Hex/` with
    // the prelude modules it names (Packages §6).
    expect(ratModule?.javascript).toContain('from "./Integral.js"');
    expect(ratModule?.javascript).toContain(
      "const __Frac_Rat = { Signed: __Signed_Rat, divide:",
    );
    expect(ratModule?.javascript).toContain("export { __Frac_Rat };");
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "fiveSixths",
      displayedType: "Rat",
    }));
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "threeHalves",
      displayedType: "Rat",
    }));
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "tenTwelfths",
      displayedType: "Rat",
    }));
  });

  test("executes the real stdlib Rat module through imported Num and Frac evidence", async () => {
    const response = compileSource(14, rat.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    const moduleUrls = new Map<string, string>();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      for (const module of response.executionModules) {
        const linked = linkModule(module.javascript, module.path, moduleUrls);
        moduleUrls.set(
          module.path,
          `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
        );
      }
      await import(/* @vite-ignore */ moduleUrls.get(response.entryPath)!);
      expect(log).toHaveBeenCalledWith("1/2 + 1/3 = 5/6");
      expect(log).toHaveBeenCalledWith("1/2 / 1/3 = 3/2");
      // `True`, not `true` (#147): interpolating a `Bool` shows its constructor
      // name, the ruling's one silent behaviour change. Pinned here on purpose.
      expect(log).toHaveBeenCalledWith("Does 10/12 = 5/6? True");
    } finally {
      log.mockRestore();
    }
  });

  test("brands exact Rat division by zero through imported Frac evidence", async () => {
    const response = compileSource(
      15,
      MAIN +
        "import Rat\n" +
        "\n" +
        "let half = Rat.create(1, 2)\n" +
        "let zero = Rat.create(0, 1)\n" +
        "let impossible = half / zero\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain(
      "__Frac_Rat.divide(half, zero)",
    );
    const moduleUrls = new Map<string, string>();
    for (const module of response.executionModules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
      );
    }
    let thrown: unknown;
    try {
      await import(/* @vite-ignore */ moduleUrls.get(response.entryPath)!);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: "DivideByZeroError",
      message: "Rat.divide: divisor is zero",
      $hex: "Hex.Integral",
    });
  });

  /**
   * Modules §8.3: the language has no entry function, so the host says which
   * module is the root — and §8.3 says a host selects it **by name**. The
   * Playground reads `Main` wherever the buffer writes it, which is the half of
   * the rule that survives a program written above its helper.
   */
  test("runs the module named `Main` wherever the buffer writes it", () => {
    const response = compileSource(
      33,
      "module Main\n" +
        "\n" +
        "import Helper\n" +
        "\n" +
        'Debug.log("${Helper.twice(3)}")\n' +
        "\n" +
        "end module Main\n" +
        "\n" +
        "module Helper\n" +
        "\n" +
        "export let twice(n: Int): Int = n * 2\n",
    );

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    // `Helper` is both the buffer's last module and the compile order's last
    // module (nothing imports `Main`), so only the *name* rule roots `Main`.
    expect(response.entryPath).toBe("/Main.hex");
    expect(response.javascript).toContain('import * as Helper from "./Helper.js";');
  });

  /**
   * The fallback, and the justification its comment states: the parse order,
   * never the compile order.
   *
   * `compileProject` answers dependency-first, so this buffer — the program
   * written first, its helper last, neither called `Main` — comes back as
   * `[Helper, Program]`. The two rules disagree here and nowhere the earlier
   * cases reach: position roots `Helper`, the compile order's last module would
   * root `Program`. This is also the silent failure the README states, pinned
   * as behaviour: the compile succeeds and runs the helper.
   */
  test("falls back to the buffer's last module by parse order, not compile order", () => {
    const response = compileSource(
      34,
      "module Program\n" +
        "\n" +
        "import Helper\n" +
        "\n" +
        'Debug.log("${Helper.twice(3)}")\n' +
        "\n" +
        "end module Program\n" +
        "\n" +
        "module Helper\n" +
        "\n" +
        "export let twice(n: Int): Int = n * 2\n",
    );

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.entryPath).toBe("/Helper.hex");
    // The helper's own emission, which prints nothing: the failure mode stated.
    expect(response.javascript).not.toContain("Debug");
    expect(response.javascript).toContain("twice");
  });

  /**
   * Modules §8.3: the language has no entry function and no privileged name, so
   * the host says which module is the root. The Playground's fallback is the
   * buffer's **last** module, and the two facts that follow from it are both
   * here — which module's JavaScript the JS pane shows, and which module the
   * worker is told to evaluate.
   */
  test("runs the buffer's last module, whatever it is called", () => {
    const response = compileSource(
      30,
      "module Helper\n" +
        "\n" +
        "export let twice(n: Int): Int = n * 2\n" +
        "\n" +
        "end module Helper\n" +
        "\n" +
        "module Demo\n" +
        "\n" +
        "import Helper\n" +
        "\n" +
        "Debug.log(\"${Helper.twice(3)}\")\n",
    );

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    // Not `Main`: nothing consults the name. `Demo` is last, so `Demo` is the
    // root — its emission is the pane's, and its layout path is the entry.
    expect(response.entryPath).toBe("/Demo.hex");
    expect(response.javascript).toContain('import * as Helper from "./Helper.js";');
    expect(response.javascript).toContain("Helper.twice(3)");
    // The helper is a module of the same file and a separate emitted file.
    expect(response.executionModules.map(({ path }) => path))
      .toEqual(expect.arrayContaining(["/Helper.hex", "/Demo.hex"]));
  });

  /**
   * The one thing a *helper* module in the buffer owes its root: the reserved
   * evidence handles a generic call across the module boundary reaches through
   * (`exportInstanceEvidence`). Every module but the root is emitted with them —
   * the root's own pane stays clean, and nothing imports the root.
   *
   * Run, not merely compiled: a missing handle is an emission that type-checks
   * and dies at load, which is the failure this pane exists to catch.
   */
  test("a helper module exports the evidence the root's generic call reaches", async () => {
    const response = compileSource(
      31,
      "module Shapes\n" +
        "\n" +
        "export record Box = {size: Int}\n" +
        "\n" +
        "honor Show<Box> =\n" +
        '    show(box) = "box ${box.size}"\n' +
        "\n" +
        "end module Shapes\n" +
        "\n" +
        "module Main\n" +
        "\n" +
        "import Shapes\n" +
        "\n" +
        "export let describe<a: Show>(x: a): String = x.show()\n" +
        "\n" +
        "export let shown: String = describe(Shapes.Box({size = 3}))\n",
    );

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    const shapes = response.executionModules.find(({ path }) => path === "/Shapes.hex");
    expect(shapes?.javascript).toContain("__Show_Box");

    const moduleUrls = new Map<string, string>();
    for (const module of response.executionModules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
      );
    }
    const entry = await import(
      /* @vite-ignore */ moduleUrls.get(response.entryPath)!
    ) as { readonly shown: string };
    expect(entry.shown).toBe("box 3");
  });

  test("refuses a buffer that declares no module, naming the one to write", () => {
    const source = 'Debug.log("hi")\n';
    const response = compileSource(32, source);

    // The seat the minted header stood at. The Playground writes no header for
    // the user: a buffer with none is the language's own refusal (Modules
    // §2.1), and the name it offers is derived from the path the buffer is
    // handed under — `/main.hex`, so `module Main`.
    expect(response).toMatchObject({
      kind: "compile-failure",
      diagnostics: [{
        severity: "error",
        message: "every file declares its module; write `module Main`",
        startOffset: 0,
      }],
    });
  });

  /**
   * A buffer with **no root** must show the compiler's report, not a written
   * line standing in for it.
   *
   * `module Hex.Option` is refused by Modules §2.2's first-segment rule, and
   * the refused header still lays the module out at `/Hex/Option.hex` — the
   * address the injected standard-library module holds — so nothing of the
   * buffer's is seated and there is no root to run. The arm that answers there
   * used to discard `project.diagnostics` and write "this buffer declares no
   * module to run", which is false twice over: the buffer declares one, and the
   * repair it named was not the repair. The rule the Errors tab lives by is
   * `WorkspaceMap.anchor`'s own — source that will not compile never leaves the
   * tab claiming nothing is wrong.
   */
  test("shows the compiler's own report for a buffer with no module to run", () => {
    const response = compileSource(
      35,
      "module Hex.Option\n\nexport let create(v: Int): Int = v\n",
    );

    expect(response.kind).toBe("compile-failure");
    if (response.kind !== "compile-failure") return;
    expect(response.diagnostics.map(({ message }) => message)).toContain(
      "`Hex.Option` begins with the name of the package `Hex`; a dotted " +
        "module's first segment cannot name a package in the program; rename the module",
    );
    expect(response.diagnostics.map(({ message }) => message)).not.toContain(
      "this buffer declares no module to run: write `module Main`",
    );
  });

  test("carries no library import into a program that writes none", () => {
    const response = compileSource(16, `${MAIN}Debug.log("hello")\n`);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    // #429's complaint, and #831's answer to it: a one-line program opened with
    // three import lines it never asked for — a `Rat` namespace, the
    // eight-instance inventory a non-prelude import carries, and a `Vector`
    // namespace that did nothing. Now nothing is prepended to any buffer, so
    // there is nothing to gate: what the program imports is what it wrote.
    expect(response.javascript).not.toContain("./Rat.js");
    expect(response.javascript).not.toContain("./Hex/Vector.js");
    expect(response.javascript).not.toContain("__Eq_Rat");
  });

  test("refuses a buffer that names `Rat` and imports nothing", () => {
    const source = `${MAIN}let third = Rat.create(1, 3)\n`;
    const response = compileSource(17, source);

    // The seat the equipment stood at (#831). `Rat` is an ordinary module of
    // the standard library, so a buffer that never imports it has an unknown
    // name, reported where the name is written — the answer any `.hex` file
    // gets, in a Playground that no longer writes lines for the user.
    expect(response).toMatchObject({
      kind: "compile-failure",
      diagnostics: [{
        severity: "error",
        message: "unknown name `Rat`",
        startOffset: source.indexOf("Rat"),
        endOffset: source.indexOf("Rat") + "Rat".length,
      }],
    });
  });

  test("compiles the ordinary `import Rat`, in every shape the grammar allows", () => {
    // A comment is trivia between an import's tokens, and the head may break
    // across lines: all of these bind `Rat` exactly as the plain spelling does.
    const heads = [
      "import Rat\n",
      "import (* the exact one *) Rat\n",
      "import\n    Rat\n",
    ];

    for (const head of heads) {
      const response = compileSource(
        17,
        `${MAIN}${head}\nlet third = Rat.create(1, 3)\nDebug.log("\${Rat.reciprocal(third)}")\n`,
      );

      expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (response.kind !== "compile-success") continue;
      expect(response.javascript).toContain('import * as Rat from "./Hex/Rat.js";');
      expect(response.javascript).toContain("Rat.reciprocal(third)");
    }
  });

  test("a written `Rat` face selects exact arithmetic under the module's own import", () => {
    const response = compileSource(
      18,
      MAIN +
        "import Rat\n" +
        "\n" +
        "let exact(f: Int): Rat = (f - 32) * 5 / 9\n" +
        "Debug.log(\"${exact(98)}\")\n",
    );

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    // One line for both faces: Modules §5.1 rule 2's companion fallback (#531)
    // lets the module alias answer the bare `Rat` in the annotation, and the
    // lift is what makes the whole tree `Rat` arithmetic rather than an `Int`
    // division converted after the damage.
    expect(response.javascript).toContain('import * as Rat from "./Hex/Rat.js";');
    expect(response.javascript).toContain("__Frac_Rat.divide(__Num_Rat.multiply(");
    expect(response.javascript).not.toContain("/ 9");
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "exact",
      displayedType: "Int -> Rat",
    }));
  });

  test("a buffer declaring its own `Rat` type keeps it, and imports nothing", () => {
    const response = compileSource(
      19,
      MAIN +
        "record Rat = {top: Int, bottom: Int}\n" +
        "let half = Rat({top = 1, bottom = 2})\n" +
        "Debug.log(\"${half.top}/${half.bottom}\")\n",
    );

    // The collision this used to need a guard for — a `record Rat` beside an
    // import line the buffer neither wrote nor can see — cannot arise: no line
    // is written for the user at all.
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).not.toContain("./Rat.js");
  });

  test("compiles a buffer aliasing another module as `Rat`", () => {
    const response = compileSource(
      21,
      "module Helper\n" +
        "\n" +
        "export let twice(n: Int): Int = n * 2\n" +
        "\n" +
        "end module Helper\n" +
        "\n" +
        "module Main\n" +
        "\n" +
        "import Helper as Rat\n" +
        "\n" +
        "Debug.log(\"${Rat.twice(3)}\")\n",
    );

    // `Rat` names whatever the buffer binds it to (Modules §3.1) — here the
    // module above it — and the library copy is neither reached nor in the way.
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).not.toContain("./Rat.js");
  });

  test("a buffer declaring its own `module Rat` occludes `Hex.Rat`, silently", () => {
    const source = "module Rat\n" +
      "\n" +
      "export let create(value: Int): Int = value\n" +
      "\n" +
      "end module Rat\n" +
      "\n" +
      "module Main\n" +
      "\n" +
      "import Rat\n" +
      "\n" +
      "Debug.log(\"${Rat.create(42)}\")\n";
    const response = compileSource(15, source);

    // Packages §3.2, and the wart #831 pinned here is gone: the standard
    // library is the package `Hex`, so a buffer's own `module Rat` is a module
    // of the *project* and collides with nothing. The resolving package's own
    // module wins, silently — no report, and `create` takes one argument, which
    // `Hex.Rat`'s takes two of.
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain('import * as Rat from "./Rat.js";');
    expect(response.javascript).not.toContain("./Hex/Rat.js");
  });

  /**
   * The full-name spelling, which the Playground could not answer before
   * #829's Ruling B: the library was three files handed to the compiler as the
   * project's own, so `Hex.Rat` named no module at all.
   */
  test("compiles `import Hex.Rat`, and `import Rat` reaches the same module", () => {
    for (const head of ["import Hex.Rat\n", "import Rat\n"]) {
      const response = compileSource(
        22,
        `${MAIN}${head}\nDebug.log("${"$"}{Rat.create(1, 3)}")\n`,
      );
      expect(response, head).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (response.kind !== "compile-success") continue;
      // One module, one emitted file, whichever spelling reached it (§2.3).
      expect(response.javascript, head)
        .toContain('import * as Rat from "./Hex/Rat.js";');
      expect(response.executionModules.map(({ path }) => path), head)
        .toContain("/Hex/Rat.hex");
    }
  });

  /**
   * Ruling B's other half, measured rather than assumed: a `Hex` module the
   * program never imports writes no file (Packages §6). The whole standard
   * library is compiled with every program now, so this is the line between
   * "embedded" and "emitted".
   */
  test("a program that imports no `Rat` emits no `Hex/Rat.js`", () => {
    const response = compileSource(23, `${MAIN}Debug.log("hello")\n`);
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.executionModules.map(({ path }) => path)).not.toContain("/Hex/Rat.hex");
    expect(response.javascript).not.toContain("Rat.js");
  });

  test("returns exact binding spans for editor hovers", () => {
    const source = `${MAIN}let answer = 42\n`;
    const response = compileSource(10, source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.types[0]).toMatchObject({
      name: "answer",
      displayedType: "Int",
      startOffset: source.indexOf("answer"),
      endOffset: source.indexOf("answer") + "answer".length,
    });
  });

  test("returns inferred types and hover spans for tuple pattern bindings", () => {
    const source = `${MAIN}let card = (10, "hearts")\nlet (rank, suit) = card\n`;
    const response = compileSource(11, source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.types.slice(1)).toEqual([
      {
        name: "rank",
        displayedType: "Int",
        startOffset: source.indexOf("rank"),
        endOffset: source.indexOf("rank") + "rank".length,
      },
      {
        name: "suit",
        displayedType: "String",
        startOffset: source.indexOf("suit"),
        endOffset: source.indexOf("suit") + "suit".length,
      },
    ]);
  });

  test("a contested program's execution set carries the runtime module, and runs", async () => {
    // FFI Part 7 §1.2's execution-set obligation, and §14.7 names this pane as
    // its live instance: `hex.js` belongs to no source file, so an execution set
    // built from the compiled modules alone would omit it — and unlike the
    // type-only `hex.d.ts` this artefact is *executable*, so the program would
    // die at its first import with a clean compile behind it.
    const response = compileSource(9, [
      "module Main",
      "",
      "record Error = {code: Int}",
      "exception Boom(value: Int)",
      "export let caught(): Int =",
      "    try",
      "        throw(Boom(3))",
      "    catch",
      "        Boom(value) => value",
      "",
    ].join("\n"));

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain('import { __Error } from "./hex.js";');
    expect(response.executionModules.map(({ path }) => path)).toContain("/hex.hex");

    const moduleUrls = new Map<string, string>();
    for (const module of response.executionModules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
      );
    }
    const entry = await import(
      /* @vite-ignore */ moduleUrls.get(response.entryPath)!
    ) as { readonly caught: () => number };
    expect(entry.caught()).toBe(3);
  });

  test("returns bounded, de-duplicated diagnostics instead of partial output", () => {
    const source = `${MAIN}let broken = missing\n`;
    const response = compileSource(8, source);

    expect(response.kind).toBe("compile-failure");
    if (response.kind !== "compile-failure") return;

    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]).toMatchObject({
      severity: "error",
      message: "unknown name `missing`",
    });
    expect(response.diagnostics[0]?.startOffset).toBeGreaterThanOrEqual(0);
    expect(response.diagnostics[0]?.endOffset).toBeLessThanOrEqual(source.length);
  });
});
