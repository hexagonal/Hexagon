import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for FFI Part 10 §5 and §11's row `bracket on `JsSet``: the
 * dedicated refusal of `jsSet[x]`, which names its rewrite (#794).
 *
 * §5 is a *recorded rejection* rather than a missing feature. Four bracket
 * readings were considered and each has its own defect — the Boolean predicate
 * forks `[]`'s meaning by receiver type, the echoed query hands back its own
 * argument, the stored representative cannot be produced without an O(n) scan
 * over a native `Set`, and the positional index invents structure insertion
 * order does not carry. No bracket is coming, so the diagnostic is not an
 * interim "not available yet": it is the permanent answer, and its job is to
 * hand the author the spelling that answers what they asked.
 *
 * **What is pinned here is the message and only the message.** There is no
 * emission to measure — the arm is a refusal, so nothing lowers — and the two
 * things about it that can silently rot are its *text* (the rewrite is meant to
 * be pasted, so a drifting spelling is a broken promise) and its *reach* (the
 * generic enumeration must no longer be what a `JsSet` receiver gets, while the
 * persistent `Set` must still get exactly that). Both are diagnostics.
 *
 * The exception is the last block, which executes. That is the #715/#716
 * obligation: an advised spelling has to resolve to the declaration meant, and
 * the only evidence for "resolves to the declaration meant" that cannot be
 * faked is compiling the advice and running it. So the advice is not written
 * out there by hand — it is *extracted from the diagnostic* and pasted into a
 * program, against a genuine native `Set` that crossed a genuine boundary.
 *
 * **The persistent `Set` is deliberately not given a sibling message.**
 * Collections Part 4's diagnostics table says no special diagnostic is owed for
 * `s[x]` on a `Set`, and Part 10 §5's text covers `JsSet` only; the contrast is
 * pinned below rather than smoothed away.
 */

/** Minimal ESM linker: rewrite compiler-owned relative imports to data-URL modules. */
function resolveModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
}

function link(
  javascript: string,
  importerPath: string,
  moduleUrls: ReadonlyMap<string, string>,
): string {
  return javascript.replace(
    /^(\s*(?:import|export)(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/**
 * A `data:` URL is a module *identity*, so two runs whose emitted text is
 * byte-identical share one instantiated module. Nothing here records state
 * across runs, but the tag costs nothing and keeps that from becoming a trap
 * for the next test added to the file.
 */
let runTag = 0;

/**
 * Compiles a whole project — prelude included — with foreign `data:` modules
 * beside it, and executes it, returning the entry module's exports.
 *
 * `runProject` in `support/test-project.ts` cannot serve here: the pin needs a
 * *foreign* `Set` to cross the boundary, which means a foreign module, and that
 * helper links only the compiler's own graph.
 */
async function run(
  files: readonly (readonly [string, string])[],
  foreign: Readonly<Record<string, string>> = {},
  entry = "Main",
): Promise<Record<string, unknown>> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#set-bracket${runTag}`;
  const moduleUrls = new Map<string, string>();
  for (const [specifier, text] of Object.entries(foreign)) {
    moduleUrls.set(specifier, url(text));
  }
  const runtimeGlobals = project.runtimeGlobals;
  if (runtimeGlobals !== undefined) {
    moduleUrls.set(runtimeGlobals.path.replace(/\.js$/u, ".hex"), url(runtimeGlobals.text));
  }
  for (const data of project.dataUnits) {
    moduleUrls.set(data.path, url(link(data.javascript.text, data.path, moduleUrls)));
  }
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.path, moduleUrls).replace(
      /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
      (statement, prefix: string, _quote: string, specifier: string) => {
        const target = moduleUrls.get(specifier);
        return target === undefined ? statement : `${prefix}${JSON.stringify(target)};`;
      },
    );
    moduleUrls.set(module.path, url(linked));
  }
  const root = project.modules.find(({ name }) => name === entry);
  if (root === undefined) throw new Error(`no module \`${entry}\` in the compiled project`);
  return (await import(/* @vite-ignore */ moduleUrls.get(root.path)!)) as Record<
    string,
    unknown
  >;
}

/** The program the operand pins share: a `JsSet(Int)` and an `Int`, both named. */
const named = "module Main\n\n" +
  "let s: JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1, 2]))\n" +
  "let x: Int = 1\n";

describe("the bracket on a `JsSet` is refused by name (§5, §11)", () => {
  /**
   * The row, whole: the reason a set cannot have a bracket, and the spelling
   * that answers the question the bracket was asking — with both operands
   * spelled as the author wrote them, so the second half is pasteable.
   *
   * `toEqual` on the whole list, not `toContain`, because **one bracket owes one
   * diagnostic**. The refusal yields the error type, so the `Int` annotation it
   * flows into reports nothing of its own; a second message here would mean the
   * arm had left a live type behind and the seat had gone on to complain about
   * it.
   */
  test("a bare-reference site names both operands, exactly once", () => {
    expect(projectDiagnostics(named + "export let bad: Int = s[x]\n")).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(s, x)`",
    ]);
  });

  /**
   * The caret, measured rather than inferred. It covers the **whole `s[x]`** —
   * the text `JsSet.contains(s, x)` replaces — and not the receiver, which is
   * where the generic enumeration this arm displaces points. That choice is
   * load-bearing and would otherwise be invisible: the author is not wrong
   * about `s`, they are wrong about the form, and a caret under `s` alone
   * underlines the one part of the expression that survives the rewrite.
   *
   * Pinned directly because nothing else here can see it. A span mutation
   * changes no message text at all; it surfaces only as a *re-ordering* of a
   * multi-diagnostic list, which is an accident of how the write-position pin
   * happens to sort, not a claim anyone wrote down.
   */
  test("the caret covers the whole bracket expression", () => {
    const source = named + "export let bad: Int = s[x]\n";
    const reported = compileFiles([["/main.hex", source]]).diagnostics;
    expect(reported).toHaveLength(1);
    expect(reported[0]!.severity).toBe("error");
    expect(source.slice(reported[0]!.primary.start.offset, reported[0]!.primary.end.offset))
      .toBe("s[x]");
  });

  /**
   * The same, at an annotation the rewrite could not satisfy either. `Bool` is
   * what `JsSet.contains` actually returns and `Int` is what the test above
   * asks for: neither produces a second message, which is the claim — the
   * refusal is terminal, not a type the rest of the check then argues with.
   */
  test("the annotation it flows into adds nothing", () => {
    expect(projectDiagnostics(named + "export let bad: Bool = s[x]\n")).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(s, x)`",
    ]);
  });

  /**
   * #744's lesson, at both operands. `stock!()` and `f(1)` have no names, and
   * the message refuses to invent any: an advised `JsSet.contains(stock, n)`
   * would name whatever `stock` and `n` the module happens to bind and could
   * hand back a *working program answering a different question*. The neutral
   * placeholder does not resolve, so the reader edits it.
   */
  test("compound operands take the neutral placeholder, on both sides", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
        'extern from "stock"\n' +
        "    fun stock() ->! JsSet(Int)\n" +
        "\n" +
        "fun f(n: Int): Int = n\n" +
        "export fun bad(): Int = stock!()[f(1)]\n",
    )).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(…, …)`",
    ]);
  });

  /**
   * The halves are decided independently — the receiver is a name here and the
   * element is not, and each is spelled by what it is. One operand without a
   * name does not cost the other its own text.
   */
  test("the two operands are spelled independently", () => {
    expect(projectDiagnostics(
      named + "fun f(n: Int): Int = n\n" + "export let bad: Int = s[f(1)]\n",
    )).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(s, …)`",
    ]);
    expect(projectDiagnostics(
      "module Main\n\n" +
        "let x: Int = 1\n" +
        "fun set(): JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1, 2]))\n" +
        "export let bad: Int = set()[x]\n",
    )).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(…, x)`",
    ]);
  });

  /**
   * A **qualified** reference keeps its qualifier, at either operand, and the
   * strongest evidence in this file that the spelling is the *source text the
   * author wrote* rather than a name recovered from the binding. `Other.x`
   * resolves to a symbol whose declared name is `x`; an implementation that
   * reached for that name, or for the emitted one, would advise
   * `JsSet.contains(s, x)` — which does not resolve in this module at all, and
   * is exactly the pasteable-looking wrong rewrite #744 is about.
   *
   * The receiver half is measured on the next test rather than here, because a
   * qualified `JsSet` receiver cannot appear in a clean program.
   */
  test("a qualified element keeps its qualifier", () => {
    // Two modules, so `compileFiles` rather than `projectDiagnostics`: a
    // qualifier needs something to qualify.
    const source = "module Main\n\n" +
      "import Other\n" +
      "let s: JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1, 2]))\n" +
      "export let bad: Int = s[Other.x]\n";
    expect(
      compileFiles([
        ["/other.hex", "module Other\n\nexport let x: Int = 1\n"],
        ["/main.hex", source],
      ]).diagnostics.map(({ message }) => message),
    ).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(s, Other.x)`",
    ]);
  });

  /**
   * The receiver half of the same claim, and the reason it needs its own
   * fixture: a module-qualified `JsSet` *receiver* cannot occur in a program
   * that compiles, because FFI Part 1 §5.4 refuses an exported value binding of
   * a captured collection outright — one ESM binding shared by every importer
   * is exactly what a capture cannot survive. So the qualified spelling is real
   * source a reader can type and a refusal they can meet, but never alone; the
   * export refusal is filtered out rather than smoothed away, and the second
   * half pins the alias, which is the spelling *this module* would have to
   * paste.
   */
  test("a qualified receiver keeps its qualifier, alias included", () => {
    const other = ["/other.hex",
      "module Other\n\n" +
        "export let s: JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1, 2]))\n"] as const;
    const refusals = (importLine: string, receiver: string): readonly string[] =>
      compileFiles([
        other,
        ["/main.hex",
          "module Main\n\n" +
            `${importLine}\n` +
            "let x: Int = 1\n" +
            `export let bad: Int = ${receiver}[x]\n`],
      ]).diagnostics
        .map(({ message }) => message)
        .filter((message) => message.startsWith("a set has no payload"));
    expect(refusals("import Other", "Other.s")).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(Other.s, x)`",
    ]);
    expect(refusals("import Other as O", "O.s")).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(O.s, x)`",
    ]);
  });

  /**
   * A literal element is not a bare reference either, and the rule does not
   * make an exception for it. Pasting `JsSet.contains(s, 1)` would in fact have
   * been correct — but the rule that would license it is "spell an operand
   * whose text is safe to reproduce", which is a second rule, and the corpus
   * has one.
   */
  test("a literal element is not a name", () => {
    expect(projectDiagnostics(named + "export let bad: Int = s[1]\n")).toEqual([
      "a set has no payload to retrieve; membership is `JsSet.contains(s, …)`",
    ]);
  });
});

describe("the refusal replaces the generic enumeration, and only for `JsSet`", () => {
  /**
   * The negative half of the arm: the enumeration `indexing requires a Vector,
   * String, Map, JsMap, or Array value` is *unreachable* for a `JsSet`
   * receiver now. Pinned separately from the message above because the two can
   * fail apart — an arm placed after the fall-through would still produce the
   * right text at a site the generic message also reached.
   */
  test("a `JsSet` receiver never reaches the generic message", () => {
    expect(projectDiagnostics(named + "export let bad: Int = s[x]\n").join("\n"))
      .not.toContain("indexing requires");
  });

  /**
   * The contrast the ruling draws, and the reason this file does not touch
   * Collections Part 4: the persistent `Set` carries §5's rejection for the same
   * reason the foreign one does, but Part 4's diagnostics table says no special
   * diagnostic is owed for it, so it stays on the enumeration. `Set` and
   * `JsSet` answering differently is the decision, not an oversight.
   *
   * `set-prelude-companion.test.ts` §16 (d) owns this claim from the `Set` side;
   * it is restated here because it is *this* arm that could break it, by being
   * written against the element type rather than the receiver kind.
   */
  test("a persistent `Set` still takes the generic refusal", () => {
    const messages = projectDiagnostics(
      "module Main\n\n" +
        "let s: Set(Int) = Set.fromVector([1, 2])\n" +
        "let x: Int = 1\n" +
        "export let bad: Int = s[x]\n",
    );
    expect(messages.join("\n")).toContain(
      "indexing requires a Vector, String, Map, JsMap, or Array value",
    );
    expect(messages.join("\n")).not.toContain("JsSet.contains");
  });

  /**
   * And the enumeration is otherwise untouched — no receiver was added to it
   * and none removed, since `JsSet` never belonged to it.
   */
  test("the enumeration's own text is unchanged", () => {
    expect(projectDiagnostics(
      "module Main\n\n" + "let b: Bool = True\n" + "export let bad: Int = b[1]\n",
    )).toContain("indexing requires a Vector, String, Map, JsMap, or Array value");
  });
});

describe("the write position is untouched (§4.5, §11)", () => {
  /**
   * `jsSet[x] := v` was already refused three times over and still is: the
   * bracket has no write meaning anywhere in the corpus, and the target is not
   * a `var`. This arm replaces the *first* of those three — the one the read
   * position owns — and adds nothing to the write position, which was never
   * this issue's business.
   *
   * Pinned as the whole list, in order, because the thing that could go wrong
   * here is a fourth message appearing: an arm that left a live type behind
   * would give the assignment something new to unify against.
   */
  test("`jsSet[x] := v` keeps the refusals it already had", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
        "let s: JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1, 2]))\n" +
        "let x: Int = 1\n" +
        "export fun bad(): Unit =\n" +
        "    s[x] := 2\n",
    )).toEqual([
      "assignment targets a bare name; records and tuples are immutable",
      "a set has no payload to retrieve; membership is `JsSet.contains(s, x)`",
      "assignment requires a `var` binding",
    ]);
  });
});

describe("the advised spelling resolves to the declaration meant (#715/#716)", () => {
  /**
   * The obligation that gated this issue on #792, discharged the only way it
   * can be: the advice is **taken from the diagnostic**, not retyped, and
   * compiled. A message advising a spelling the language does not have is worse
   * than the generic enumeration it replaced, and a hand-written copy of the
   * advice in a test would pass whether or not the message still said it.
   *
   * It then *runs*, against a native `Set` built by foreign code and captured at
   * the crossing (§2), because "resolves to the declaration meant" is a claim
   * about which `contains` — and `stdlib/JsSet.hex`'s is the one that reads the
   * native set's own `has` through the intrinsic door (#792). Both answers are
   * measured: a member and a non-member, so a `contains` that resolved to
   * something constant could not pass.
   */
  test("the advice, extracted and pasted, compiles and answers membership", async () => {
    const [message] = projectDiagnostics(
      "module Main\n\n" +
        "export fun probe(s: JsSet(Int), x: Int): Bool = s[x]\n",
    );
    const advice = /`([^`]+)`$/u.exec(message ?? "")?.[1];
    expect(advice).toBe("JsSet.contains(s, x)");
    const main = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun stock() ->! JsSet(Int)\n" +
          "\n" +
          `fun member(s: JsSet(Int), x: Int): Bool = ${advice!}\n` +
          "\n" +
          "export fun probe(x: Int): Bool = member(stock!(), x)\n"]],
      { stock: "export function stock() { return new Set([1, 2, 3]); }\n" },
    );
    const probe = main["probe"] as (x: number) => boolean;
    expect([probe(2), probe(9)]).toEqual([true, false]);
  });
});
