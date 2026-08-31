import { describe, expect, test, vi } from "vitest";

import { helloWorld } from "./examples/hello-world";
import { internationalIdentifiers } from "./examples/international-identifiers";
import { payloadUnions } from "./examples/payload-unions";
import { specializations } from "./examples/specializations";
import { rat } from "./examples/rat";
import { vectors } from "./examples/vectors";
import { compileSource } from "./compile";
import { linkModule } from "./module-execution";

describe("compileSource", () => {
  test("compiles the canonical Vector module surface", () => {
    const response = compileSource(5, vectors.source);

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    // `Vector` is a prelude module, not Playground equipment, so nothing
    // prepends `import module Vector`: the members arrive named, through the same
    // channel `Seq`'s `take`/`iterate` arrive on, and the calls are bare.
    expect(response.javascript).toContain(
      'import { fromSeq, append, set, at, get } from "./stdlib/Vector.js";',
    );
    expect(response.javascript).not.toContain("import * as Vector");
    expect(response.javascript).toContain("append(numbers, 40)");
    expect(response.javascript).toContain("set(extended, 2, 25)");
    expect(response.javascript).toContain("at(updated, -1)");
    expect(response.javascript).toContain("get(updated, 5)");
    const vectorModule = response.executionModules.find(({ path }) =>
      path === "/stdlib/Vector.hex"
    );
    expect(vectorModule?.javascript).not.toContain(
      "const __persistentCollections",
    );
    // `Option`/`Some`/`None` are implicit via the prelude; Vector imports only
    // the constructors it uses, ordered by first reference.
    expect(vectorModule?.javascript).toContain(
      'import { None, Some } from "./Option.js";',
    );
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
    const response = compileSource(5, "let impossible = Vector.at([10, 20], -3)\n");

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
      $hex: "Vector",
      index: -3,
      size: 2,
    });
  });

  test("shows idiomatic payload-union constructors in JavaScript output", () => {
    const response = compileSource(6, payloadUnions.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain(
      'const Circle = radius => ({ tag: "Circle", radius });',
    );
    expect(response.javascript).not.toContain("const Circle = (radius) =>");
    expect(response.javascript).not.toContain("radius: radius");
  });

  test("compiles international JavaScript-compatible identifiers without mangling", () => {
    const response = compileSource(6, internationalIdentifiers.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain(
      "const Tउपयोगकर्ता = __record => __record;",
    );
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
    // This source names neither companion, so no equipment import is prepended
    // — and `/stdlib/Vector.hex` drops out with it, because a prelude module is
    // emitted only where something imports it. `/stdlib/Rat.hex` stays: hosting
    // is unconditional, and Rat is no prelude member, so its file is compiled
    // and emitted whether or not the buffer reaches it. `/Prelude.hex` is
    // emitted because `Rat.hex` uses `Ordering`, and `/BigInt.hex` since #344
    // because `Rat.hex` normalizes through `Integral<BigInt>`'s members — so
    // the companion's dictionary and the constraint homes that declare what it
    // throws (`/Integral.hex`, `/Pow.hex`) are emitted with it. `/Float.hex`
    // and `/Int.hex` ahead of it joined at #526: `Rat.toFloat` names `Float`
    // and throws `Float.hex`'s `FloatRangeError`, and `Float.hex`'s composed
    // `fromNat` reaches `Int.fromNat`. Those two now precede `/BigInt.hex`,
    // which #533 seated after `Float.hex` for a `FloatRangeError` of its own.
    // `/Debug.hex`
    // joins wherever a source writes a line, which since #407 is every sample.
    // `/String.hex` rode in behind it while #419's widened `log<a: Show>` made
    // the site carry `Show<String>`, and left again at #440: a line written at
    // `String` reaches `logString` and needs no companion dictionary at all.
    expect(response.executionModules.map(({ path }) => path)).toEqual([
      "/Pow.hex",
      "/Prelude.hex",
      "/Integral.hex",
      "/stdlib/Option.hex",
      "/Int.hex",
      "/Float.hex",
      "/BigInt.hex",
      "/Debug.hex",
      "/stdlib/Rat.hex",
      "/Mगणित.hex",
      "/main.hex",
    ]);
  });

  test("maps virtual-module diagnostics back into the combined workspace document", () => {
    const source =
      "module Repo\n" +
      "export let broken = missing\n" +
      "end module Repo\n" +
      "log(Repo.broken)\n";
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
    const response = compileSource(11, "let plus(x, y) = x + y\n");

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
      const response = compileSource(40, `${weighty}${heaviest}\n${stamp}`);

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
      const response = compileSource(41, `${weighty}${heaviest}`);

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
      const response = compileSource(42, "export fun plain(x: Int): Int = x + 1\n");

      expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (response.kind !== "compile-success") return;

      // `plain` carries no constrained variable, so §3.1 never made it eligible.
      // A list phrased on "published no face" alone would name it here.
      expect(response.generatedJavaScript).toEqual([]);
      expect(response.generatedDeclarations).toEqual([]);
      expect(response.zeroEntryPointExports).toEqual([]);
    });

    /**
     * A `.d.ts` row spans the edition's own documentation block, so an author's
     * prose is inside the measurement — and prose is where the file stops being
     * ASCII. `bytes` is UTF-8 and the offsets index the text as JavaScript does,
     * so a panel that labelled a region with `endOffset - startOffset` would
     * under-report every documented module written in a language with accents.
     */
    test("measures a documented edition in UTF-8 bytes, not in string offsets", () => {
      const response = compileSource(
        43,
        "(** Mélange un sel — «précision» — pour séparer deux valeurs égales. *)\n" + stamp,
      );

      expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
      if (response.kind !== "compile-success") return;

      for (const section of response.generatedDeclarations) {
        expect(section.bytes).toBeGreaterThan(section.endOffset - section.startOffset);
      }
      // The JavaScript side is where the two agree, and it agrees for a reason
      // rather than by luck: the item's documentation precedes the whole
      // rendered block once there, so no edition's body carries any of it.
      for (const section of response.generatedJavaScript) {
        expect(section.bytes).toBe(section.endOffset - section.startOffset);
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
    expect(response.javascript).not.toContain("log(String(plus(20, 22,");
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
    expect(response.javascript).toContain('import * as Rat from "./stdlib/Rat.js";');
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
      "/stdlib/Rat.hex",
    );
    const ratModule = response.executionModules.find(({ path }) =>
      path === "/stdlib/Rat.hex"
    );
    expect(ratModule?.javascript).toContain('bottom === 0n');
    expect(ratModule?.javascript).toContain('reducedBottom < 0n');
    // The brand is `Integral.hex`'s `exception` declaration now, reached by
    // import (#344), rather than a helper branding an `Error` in place. The
    // observable — name, message, `$hex` — is pinned by the executed test
    // below, which is where it belongs.
    expect(ratModule?.javascript).toContain("DivideByZeroError(\"Rat.create: bottom is zero\")");
    expect(ratModule?.javascript).toContain('from "../Integral.js"');
    expect(ratModule?.javascript).toContain(
      "const __Frac_Rat = { signed: __Signed_Rat, divide:",
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
      $hex: "Integral",
    });
  });

  test("leaves equipment out of a program that names no companion", () => {
    const response = compileSource(16, "log(\"hello\")\n");

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    // #429's complaint: a one-line program opened with three import lines it
    // never asked for — a `Rat` namespace, the eight-instance inventory a
    // non-prelude import carries, and a `Vector` namespace that did nothing.
    expect(response.javascript).not.toContain("./stdlib/Rat.js");
    expect(response.javascript).not.toContain("./stdlib/Vector.js");
    expect(response.javascript).not.toContain("__Eq_Rat");
  });

  test("prepends the Rat equipment import for a program that does name it", () => {
    const response = compileSource(
      17,
      "let third = Rat.create(1, 3)\nlog(\"\${Rat.reciprocal(third)}\")\n",
    );

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain(
      'import * as Rat from "./stdlib/Rat.js";',
    );
    expect(response.javascript).toContain("Rat.reciprocal(third)");
  });

  test("a written `Rat` face selects exact arithmetic, with no import to write", () => {
    const response = compileSource(
      18,
      "let exact(f: Int): Rat = (f - 32) * 5 / 9\nlog(\"${exact(98)}\")\n",
    );

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    // The one injected line is what makes the annotation writable: Modules
    // §5.1 rule 2's companion fallback (#531) lets the namespace alias answer
    // the bare `Rat` face, so the named half the equipment used to carry beside
    // it is gone and nothing here reads any differently. The lift is what makes
    // the whole tree `Rat` arithmetic rather than an `Int` division converted
    // after the damage.
    expect(response.javascript).toContain('import * as Rat from "./stdlib/Rat.js";');
    expect(response.javascript).toContain("__Frac_Rat.divide(__Num_Rat.multiply(");
    expect(response.javascript).not.toContain("/ 9");
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "exact",
      displayedType: "Int -> Rat",
    }));
  });

  test("a buffer declaring its own `Rat` collides with no injected import", () => {
    const response = compileSource(
      19,
      "record Rat = {top: Int, bottom: Int}\n" +
        "let half = Rat({top = 1, bottom = 2})\n" +
        "log(\"${half.top}/${half.bottom}\")\n",
    );

    // The collision this used to need a guard for — `record Rat` beside
    // `import { Rat }`, a same-namespace duplicate reported at an import line
    // the buffer neither wrote nor can see — is now unreachable by
    // construction: the injected line binds only a module alias, and Modules
    // §5.1 rule 2's fallback answers nothing where a declaration already does.
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).not.toContain("import { Rat }");
  });

  test("compiles a buffer that writes the equipment import itself", () => {
    const response = compileSource(
      20,
      "import module Rat from \"./stdlib/Rat\"\n" +
        "let half = Rat.create(1, 2)\n" +
        "log(\"${half}\")\n",
    );

    // #537: the equipment used to arrive on top of this and report the alias
    // namespace's collision — two module aliases of one name — at the line the
    // user wrote, under a line no buffer shows. It stands down instead, and the
    // program compiles as the ordinary Hexagon file it already was.
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain('from "./stdlib/Rat.js"');
  });

  test("compiles the alias import in every shape the grammar allows it", () => {
    // A comment is trivia between an import's tokens, and the head may break
    // across lines: all three of these bind `Rat` exactly as the plain
    // spelling does, and each drew the collision back when the equipment read
    // the buffer's lines instead of its tokens.
    const shapes = [
      "import (* the exact one *) module Rat from \"./stdlib/Rat\"\n",
      "import module (* the exact one *) Rat from \"./stdlib/Rat\"\n",
      "import\n    module Rat from \"./stdlib/Rat\"\n",
    ];

    for (const head of shapes) {
      const response = compileSource(
        23,
        head + "let half = Rat.create(1, 2)\nlog(\"${half}\")\n",
      );

      expect(response).toMatchObject({
        kind: "compile-success",
        diagnostics: [],
      });
    }
  });

  test("compiles a buffer aliasing another module as an equipment name", () => {
    const response = compileSource(
      21,
      "module Helper\n" +
        "    export let twice(n: Int): Int = n * 2\n" +
        "end module Helper\n" +
        "import module Rat from \"./Helper\"\n" +
        "log(\"${Rat.twice(3)}\")\n",
    );

    // The name is what collides, not the module behind it, so the gate is
    // keyed on the alias: `Rat` here is `/Helper.hex`, and it answers.
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).not.toContain("./stdlib/Rat.js");
  });

  test("compiles a buffer whose own import is the companion's named half", () => {
    const response = compileSource(
      22,
      "import { Rat } from \"./stdlib/Rat\"\n" +
        "let half: Rat = Rat.create(1, 2)\n" +
        "log(\"${half}\")\n",
    );

    // #537's headline case, and the half the fix deliberately does not cover:
    // the named import binds a type, the injected line binds an alias, and
    // `Rat.create` needs the alias. Both faces are used above, and the two
    // lines sit together with nothing between them to collide.
    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain('from "./stdlib/Rat.js"');
  });

  test("lets a workspace Rat module occlude the fundamental companion", () => {
    const source =
      "module Rat\n" +
      "export let create(value: Int): Int = value\n" +
      "end module Rat\n" +
      "let answer = Rat.create(42)\n";
    const response = compileSource(15, source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    // The shadow is what keeps `/stdlib/Rat.hex` out — it is unhosted here, not
    // merely un-imported, which is the one case where hosting is conditional.
    // Nothing else survives: the buffer names no prelude module, and a prelude
    // module with no importer is not emitted.
    expect(response.executionModules.map(({ path }) => path)).toEqual([
      "/Rat.hex",
      "/main.hex",
    ]);
    expect(response.javascript).toContain('import * as Rat from "./Rat.js";');
    expect(response.javascript).not.toContain("./stdlib/Rat.js");
  });

  test("returns exact binding spans for editor hovers", () => {
    const source = "let answer = 42\n";
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
    const source = "let card = (10, \"hearts\")\nlet (rank, suit) = card\n";
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
    const source = "let broken = missing\n";
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
