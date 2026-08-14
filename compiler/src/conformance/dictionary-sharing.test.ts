import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for `spec/dictionary-sharing.md` §3 and its §11 obligations 1–5
 * (#449).
 *
 * §3 is three rules over one channel:
 *
 * - **§3.1** every distinct *ground* evidence tree is one module-level `const`,
 *   emitted once and referenced by name at every use site — nested applications
 *   hoisting their own subtrees, so every hoisted initializer is one factory
 *   applied to names;
 * - **§3.2** inside a parameterized instance's factory, evidence for **this**
 *   instance at the factory's own parameters *in order* is the local record
 *   under construction, so a regular recursive traversal allocates nothing;
 * - **§3.3** every other shape inside a factory body — a different instance
 *   over the parameters, this one deeper, this one permuted — stays a call-time
 *   application, which is what §10.3 shows must not be hoisted eagerly.
 *
 * Obligations 6 (collision-only aliasing) and 7 (literal-member reduction)
 * landed with #425 and are pinned by `dictionary-names.test.ts` and
 * `literal-member-peephole.test.ts` respectively; they are not rebuilt here.
 */

function emitted(source: string): string {
  const project = compileMain(source);
  // A pin on emitted text means nothing if the module was rejected: a refused
  // program emits little and satisfies every `not.toContain` for free.
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source: file }) => file.path === "/main.hex");
  if (module === undefined) throw new Error("/main.hex was not emitted");
  return module.javascript.text;
}

function emittedFrom(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** How many times `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The offset of `needle`, asserted present so -1 cannot satisfy an ordering pin. */
function offsetOf(text: string, needle: string): number {
  const offset = text.indexOf(needle);
  expect(offset, `${needle} was not emitted`).toBeGreaterThanOrEqual(0);
  return offset;
}

/**
 * A constraint, a nullary instance for it, and a parameterized container — the
 * smallest program with a ground application in it, shared by the §3.1 pins so
 * each one differs only in its use sites.
 */
const RENDER_PRELUDE =
  "constraint Render<a> =\n" +
  "    render(value: a): String\n" +
  "honor Render<Int> =\n" +
  '    render(value) = "${value}"\n' +
  "record Box(a) = {value: a}\n" +
  "honor<a: Render> Render<Box(a)> =\n" +
  '    render(box) = "Box(${box.value.render()})"\n';

describe("§3.1 — ground applications hoist to module level", () => {
  test("two use sites of one tree emit one binding and two references", () => {
    const text = emitted(
      RENDER_PRELUDE +
        "let boxed: Box(Int) = Box({value = 42})\n" +
        "export let one: String = render(boxed)\n" +
        "export let two: String = render(boxed)\n",
    );

    expect(text).toContain("const __Render_Box_Int = __Render_Box(__Render_Int);");
    expect(occurrences(text, "const __Render_Box_Int =")).toBe(1);
    expect(text).toContain("const one = render(boxed, __Render_Box_Int);");
    expect(text).toContain("const two = render(boxed, __Render_Box_Int);");
    // §11.1's banned shape: the inline application at a use site.
    expect(text).not.toMatch(/render\(boxed, __Render_Box\(/u);
  });

  test("depth 2 hoists its own subtree, so every initializer is one application to names", () => {
    const text = emitted(
      RENDER_PRELUDE +
        "let nested: Box(Box(Int)) = Box({value = Box({value = 42})})\n" +
        "export let one: String = render(nested)\n" +
        "export let two: String = render(nested)\n",
    );

    expect(text).toContain("const __Render_Box_Int = __Render_Box(__Render_Int);");
    expect(text).toContain(
      "const __Render_Box_Box_Int = __Render_Box(__Render_Box_Int);",
    );
    expect(text).toContain("const one = render(nested, __Render_Box_Box_Int);");
    expect(text).toContain("const two = render(nested, __Render_Box_Box_Int);");
    // The nesting the ruling names in §1 as the point at which output stops
    // reading like something a person wrote.
    expect(text).not.toContain("__Render_Box(__Render_Box(");
    // §5: the subtree's binding precedes the tree's, which is what makes the
    // module level a DAG rather than a letrec (§10.4).
    expect(offsetOf(text, "const __Render_Box_Int =")).toBeLessThan(
      offsetOf(text, "const __Render_Box_Box_Int ="),
    );
  });

  test("the hoisted binding is emitted after its factory and before the term bindings", () => {
    const text = emitted(
      RENDER_PRELUDE +
        "let boxed: Box(Int) = Box({value = 42})\n" +
        "export let one: String = render(boxed)\n",
    );

    // §5, and Constraints §6.3's emission obligation: after the factories and
    // zero-argument instances it references, before every term binding that
    // demands it. Both edges, because either one alone is a load-time
    // `ReferenceError` in the other direction.
    expect(offsetOf(text, "const __Render_Box = ")).toBeLessThan(
      offsetOf(text, "const __Render_Box_Int ="),
    );
    expect(offsetOf(text, "const __Render_Int = ")).toBeLessThan(
      offsetOf(text, "const __Render_Box_Int ="),
    );
    expect(offsetOf(text, "const __Render_Box_Int =")).toBeLessThan(
      offsetOf(text, "const one ="),
    );
  });

  test("the sharing is semantics-preserving, at both depths", async () => {
    const main = await runMain(
      RENDER_PRELUDE +
        "let a: Box(Int) = Box({value = 42})\n" +
        "let b: Box(Int) = Box({value = 7})\n" +
        "let c: Box(Box(Int)) = Box({value = Box({value = 5})})\n" +
        "export let one: String = render(a)\n" +
        "export let two: String = render(b)\n" +
        "export let deep: String = render(c)\n",
    );

    expect(main["one"]).toBe("Box(42)");
    expect(main["two"]).toBe("Box(7)");
    expect(main["deep"]).toBe("Box(Box(5))");
  });

  test("a prelude tree hoists across the import channel too", () => {
    // The issue's own example. `Option`'s factory and `Int`'s dictionary are
    // both imported, so this is the shape a real module has.
    const text = emitted(
      "export let f(x: Int): String = show(Some(x))\n" +
        'export let g(x: Int): String = show(Some(x)) ++ show(Some(0))\n',
    );

    expect(text).toContain("const __Show_Option_Int = __Show_Option(__Show_Int);");
    expect(occurrences(text, "const __Show_Option_Int =")).toBe(1);
    expect(occurrences(text, "__Show_Option(__Show_Int)")).toBe(1);
    expect(text).toContain("const f = x => show(Some(x), __Show_Option_Int);");
  });

  test("free-parameter evidence never hoists", () => {
    // §4: evidence containing a free dictionary parameter is not ground. A
    // module-level binding cannot name a caller's dictionary at all.
    const text = emitted(
      RENDER_PRELUDE +
        "export let twice<a: Render>(value: a): String = render(Box({value = value}))\n",
    );

    expect(text).toContain("__Render_Box(__Render_a)");
    expect(text).not.toMatch(/^const __Render_Box_a /mu);
  });
});

describe("§3.2 — self-evidence is the instance record under construction", () => {
  const TREE =
    "constraint Describe<a> =\n" +
    "    describe(value: a): String\n" +
    "honor Describe<Int> =\n" +
    '    describe(value) = "${value}"\n' +
    "union Tree(a) = Leaf | Node(left: Tree(a), item: a, right: Tree(a))\n" +
    "honor<a: Describe> Describe<Tree(a)> =\n" +
    "    describe(tree) = match tree\n" +
    '        Leaf => "leaf"\n' +
    '        Node(left, item, right) => "(${left.describe()}${item.describe()}${right.describe()})"\n';

  test("the factory body names its own record and never re-applies itself", () => {
    const text = emitted(
      TREE +
        "let tree: Tree(Int) = Node(Leaf, 1, Leaf)\n" +
        "export let text: String = describe(tree)\n",
    );

    // The letrec of §3.2, legal because every reader sits inside a member's
    // closure body and so is never evaluated during the factory's application.
    expect(text).toMatch(
      /const __Describe_Tree = __Describe_a => \{\n\s*const (__instance\w*) = \{/u,
    );
    expect(text).toContain("describe(left, __instance)");
    expect(text).toContain("describe(right, __instance)");
    // §11.2's textual half — this is what makes a regular traversal allocate
    // zero dictionaries rather than one shared one.
    expect(text).not.toContain("__Describe_Tree(__Describe_a)");
    // The binder's own evidence is untouched: `item` is the declared variable.
    expect(text).toContain("describe(item, __Describe_a)");
  });

  test("an N-node traversal still runs", async () => {
    const main = await runMain(
      TREE +
        "let tree: Tree(Int) = Node(Node(Leaf, 1, Leaf), 2, Node(Leaf, 3, Node(Leaf, 4, Leaf)))\n" +
        "export let text: String = describe(tree)\n",
    );

    expect(main["text"]).toBe("((leaf1leaf)2(leaf3(leaf4leaf)))");
  });

  test("#274's own repro emits the self-referential dictionary it predicted", async () => {
    // The shape #274's body asked for: "a dictionary whose member refers to the
    // dictionary being defined (legal under a closure body), not inline the
    // component's equality forever". It has compiled since the #278/#282
    // component-dispatch arc; §3.2 is what makes it the *ruled* shape rather
    // than a happy accident, and this is the regression pin that issue asked
    // for. `derives Hash` on the same union is a separate defect (a missing
    // cycle guard in the structural hash walk) and is #274's live residue.
    const source =
      "union Tree(a) derives Eq = Leaf | Node(left: Tree(a), item: a, right: Tree(a))\n" +
      "let t: Tree(Int) = Node(Node(Leaf, 1, Leaf), 2, Leaf)\n" +
      "let u: Tree(Int) = Node(Node(Leaf, 9, Leaf), 2, Leaf)\n" +
      "export let same: Bool = t == t\n" +
      "export let differ: Bool = t == u\n";
    const text = emitted(source);

    expect(text).toContain("__instance.equals(__left.left, __right.left)");
    expect(text).not.toContain("__Eq_Tree(__Eq_a)");

    const main = await runMain(source);
    expect(main["same"]).toBe(true);
    expect(main["differ"]).toBe(false);
  });

  test("a recursive parameterized `derives` takes the same shape (#274)", async () => {
    const source =
      "union Tre(a) derives Show = Lf | Nd(left: Tre(a), item: a, right: Tre(a))\n" +
      'export let text: String = "${Nd(Nd(Lf, 1, Lf), 2, Lf)}"\n';
    const text = emitted(source);

    expect(text).toContain("__instance.show(__value.left)");
    expect(text).toContain("__instance.show(__value.right)");
    expect(text).not.toContain("__Show_Tre(__Show_a)");
    expect((await runMain(source))["text"]).toBe("Nd(Nd(Lf, 1, Lf), 2, Lf)");
  });

  test("a nullary instance is unaffected — it is already its own module constant", () => {
    // §2 item 1: the rule restates their placement and changes nothing. The
    // replacement is scoped to factories, so a zero-parameter honor must not
    // grow a local record it did not have.
    const text = emitted(
      "constraint Render<a> =\n" +
        "    render(value: a): String\n" +
        "record Point = {x: Int}\n" +
        "honor Render<Point> =\n" +
        '    render(value) = "${value.x}"\n' +
        "export let one: String = render(Point({x = 1}))\n",
    );

    expect(text).toMatch(/^const __Render_Point = \{ render:/mu);
    expect(text).not.toContain("__instance");
  });
});

describe("§3.3 — non-identity evidence inside a factory body stays call-time", () => {
  /**
   * The three shapes §3.3 enumerates, each pinned textually *and* run. The
   * textual half is the load-bearing one: §3.2's replacement is keyed on the
   * identity arrangement, and a rewrite that misfired on one of these would
   * substitute the wrong instance's record — a silent miscompile, not a crash.
   * The eager alternative §10.3 rejects would instead diverge at load.
   */

  test("mutual recursion: a different instance over the parameters", async () => {
    const source =
      "constraint Rend<a> =\n" +
      "    rend(value: a): String\n" +
      "honor Rend<Int> =\n" +
      '    rend(value) = "${value}"\n' +
      "union Tree2(a) = Tip(item: a) | Branch(kids: Forest(a))\n" +
      "union Forest(a) = Nil2 | More(head: Tree2(a), rest: Forest(a))\n" +
      "honor<a: Rend> Rend<Tree2(a)> =\n" +
      "    rend(t) = match t\n" +
      "        Tip(v) => v.rend()\n" +
      '        Branch(f) => "[${f.rend()}]"\n' +
      "honor<a: Rend> Rend<Forest(a)> =\n" +
      "    rend(f) = match f\n" +
      '        Nil2 => ""\n' +
      '        More(h, r) => "${h.rend()}${r.rend()}"\n' +
      "let forest: Tree2(Int) = Branch(More(Tip(1), More(Tip(2), Nil2)))\n" +
      "export let text: String = rend(forest)\n";
    const text = emitted(source);

    // Each factory constructs the *other* one's evidence at the call, from its
    // own parameter — unchanged, and it must stay that way: eagerly hoisting
    // either one diverges around the cycle before any member is called (§10.3).
    expect(text).toContain("rend(f, __Rend_Forest(__Rend_a))");
    expect(text).toContain("rend(h, __Rend_Tree2(__Rend_a))");
    // Each factory's own self-demand is still the identity arrangement, so §3.2
    // does apply to it — the two rules coexist inside one body.
    expect(text).toContain("rend(r, __instance");

    expect((await runMain(source))["text"]).toBe("[12]");
  });

  test("deeper: this instance at a constructed argument (non-regular recursion)", async () => {
    const source =
      "record Box2(a) = {value: a}\n" +
      "constraint Dsc<a> =\n" +
      "    dsc(value: a): String\n" +
      "honor Dsc<Int> =\n" +
      '    dsc(value) = "${value}"\n' +
      "honor<a: Dsc> Dsc<Box2(a)> =\n" +
      '    dsc(b) = "B(${b.value.dsc()})"\n' +
      "union Weird(a) = End | W(inner: Weird(Box2(a)))\n" +
      "honor<a: Dsc> Dsc<Weird(a)> =\n" +
      "    dsc(w) = match w\n" +
      '        End => "end"\n' +
      '        W(inner) => "W(${inner.dsc()})"\n' +
      "let w: Weird(Int) = W(W(End))\n" +
      "export let text: String = dsc(w)\n";
    const text = emitted(source);

    // §3.2's "in order" clause excludes this: the self-demand applies the
    // factory to *constructed* argument evidence, not to its own parameter.
    expect(text).toContain("dsc(inner, __Dsc_Weird(__Dsc_Box2(__Dsc_a)))");
    // And it is not ground, so §3.1 does not reach it either.
    expect(text).not.toMatch(/^const __Dsc_Weird_Box2\w* =/mu);

    expect((await runMain(source))["text"]).toBe("W(W(end))");
  });

  test("permuted: this instance over its own parameters, reversed", async () => {
    const source =
      "constraint Dsp<a> =\n" +
      "    dsp(value: a): String\n" +
      "honor Dsp<Int> =\n" +
      '    dsp(value) = "${value}"\n' +
      "honor Dsp<String> =\n" +
      "    dsp(value) = value\n" +
      "union Swap(a, b) = Stop | Go(one: a, rest: Swap(b, a))\n" +
      "honor<a: Dsp, b: Dsp> Dsp<Swap(a, b)> =\n" +
      "    dsp(s) = match s\n" +
      '        Stop => "stop"\n' +
      '        Go(one, rest) => "${one.dsp()}${rest.dsp()}"\n' +
      'let s: Swap(Int, String) = Go(1, Go("x", Stop))\n' +
      "export let text: String = dsp(s)\n";
    const text = emitted(source);

    // The arrangement is the classifier, not the instance name: this *is* the
    // factory, over its own parameters, and it is still not the replacement.
    expect(text).toContain("dsp(rest, __Dsp_Swap(__Dsp_b, __Dsp_a))");
    expect(text).not.toContain("dsp(rest, __instance");
    // The ground use site at the top is hoisted as usual, in argument order.
    expect(text).toContain("const __Dsp_Swap_Int_String = __Dsp_Swap(__Dsp_Int, __Dsp_String);");

    expect((await runMain(source))["text"]).toBe("1xstop");
  });
});

describe("§4, §5, §8 — the key, determinism, and the exported surface", () => {
  test("two compiles of one module agree on the hoisted names and their order", () => {
    const source =
      RENDER_PRELUDE +
      "let boxed: Box(Int) = Box({value = 1})\n" +
      "let nested: Box(Box(Int)) = Box({value = boxed})\n" +
      "export let one: String = render(boxed)\n" +
      "export let two: String = render(nested)\n";

    // §5: "same module, same names, every compile" is normative. Whole-text
    // equality is the strongest form of it and costs nothing here.
    expect(emitted(source)).toBe(emitted(source));
    const hoisted = (text: string) =>
      text.split("\n").filter((line) => /^const __Render_\w+ = __Render_\w+\(/u.test(line));
    expect(hoisted(emitted(source))).toEqual([
      "const __Render_Box_Int = __Render_Box(__Render_Int);",
      "const __Render_Box_Box_Int = __Render_Box(__Render_Box_Int);",
    ]);
  });

  test("hoisted bindings appear in no export list and no `.d.ts`", () => {
    const source =
      RENDER_PRELUDE +
      "let boxed: Box(Int) = Box({value = 1})\n" +
      "export let one: String = render(boxed)\n";
    const project = compileFiles([["/main.hex", source]]);
    expect(project.diagnostics).toEqual([]);
    const module = project.modules.find(({ source: file }) => file.path === "/main.hex")!;

    // §8: they join the module's top-level `const` set but not its export set,
    // and FFI Part 9's public evidence closure is computed from the same inputs
    // as before. The declared instances still export; the application does not.
    expect(module.javascript.text).toContain("const __Render_Box_Int =");
    expect(module.javascript.text).toContain("export { __Render_Box };");
    expect(module.javascript.text).not.toContain("__Render_Box_Int };");
    expect(module.javascript.text).not.toMatch(/export \{[^}]*__Render_Box_Int/u);
    expect(module.declarations.text).not.toContain("__Render_Box_Int");
  });

  test("sharing is per module — each consumer materializes its own binding", () => {
    // §7: two modules demanding one tree each hold one binding, and neither
    // reaches for the other's. The consumer imports the *factory*, not an
    // application of it.
    const files = [
      [
        "/lib.hex",
        "export constraint Render<a> =\n" +
          "    render(value: a): String\n" +
          "honor Render<Int> =\n" +
          '    render(value) = "${value}"\n' +
          "export record Box(a) = {value: a}\n" +
          "honor<a: Render> Render<Box(a)> =\n" +
          '    render(box) = "Box(${box.value.render()})"\n',
      ],
      [
        "/main.hex",
        'import { Render, Box } from "./lib"\n' +
          "let boxed: Box(Int) = Box({value = 1})\n" +
          "export let one: String = render(boxed)\n",
      ],
    ] as const;

    const main = emittedFrom(files, "/main.hex");
    expect(main).toContain("const __Render_Box_Int = __Render_Box(__Render_Int);");
    expect(emittedFrom(files, "/lib.hex")).not.toContain("__Render_Box_Int");
  });
});

/**
 * §5's flattening is not injective — underscores are legal in constraint and
 * type-constructor names — so a hoisted spelling can be contested. These pin
 * what this implementation does, which is Lexer §3.2's probe: the hoisted
 * binding steps aside, and the seat the resolver already assigned
 * (`nameDictionaries`, #425) keeps its spelling.
 *
 * That is **narrower than §5's stated discipline**, which suffixes *every*
 * contestant from `_1` and leaves none bare. The gap is structural rather than
 * an oversight: `nameDictionaries` runs in the resolver, over declared
 * instances and imports, and a hoisted binding does not exist until emission
 * has walked the checker's evidence trees — so the two assignments cannot be
 * one pass without renaming a name the resolver has already baked into
 * `Core.InstanceEvidence`. Recorded here so the boundary is a decision. Nothing
 * observable rides on it: every spelling below is internal, unexported, and the
 * assignment is deterministic either way.
 */
describe("§5 — a contested hoisted spelling", () => {
  const CONTEST =
    "constraint Render<a> =\n" +
    "    render(value: a): String\n" +
    "honor Render<Int> =\n" +
    '    render(value) = "${value}"\n' +
    "record Box(a) = {value: a}\n" +
    "record Box_Int = {n: Int}\n" +
    "honor<a: Render> Render<Box(a)> =\n" +
    '    render(box) = "Box(${box.value.render()})"\n' +
    "honor Render<Box_Int> =\n" +
    '    render(v) = "BI(${v.n})"\n' +
    "let boxed: Box(Int) = Box({value = 1})\n" +
    "export let one: String = render(boxed)\n" +
    "export let two: String = render(Box_Int({n = 2}))\n";

  test("a declared instance keeps its seat and the hoisted binding suffixes", async () => {
    const text = emitted(CONTEST);

    expect(text).toContain('const __Render_Box_Int = { render: v => "BI(');
    expect(text).toContain("const __Render_Box_Int_1 = __Render_Box(__Render_Int);");
    expect(text).toContain("render(boxed, __Render_Box_Int_1)");
    // §8 is unaffected: the declared instance's interface spelling is bare
    // because no other *declared* instance contests it.
    expect(text).toContain("export { __Render_Box_Int };");

    const main = await runMain(CONTEST);
    expect(main["one"]).toBe("Box(1)");
    expect(main["two"]).toBe("BI(2)");
  });

  test("two hoisted bindings that flatten alike separate, and both run", async () => {
    const source =
      "constraint Render<a> =\n" +
      "    render(value: a): String\n" +
      "record B_C = {p: Int}\n" +
      "record C = {q: Int}\n" +
      "record A(a) = {value: a}\n" +
      "record A_B(a) = {value: a}\n" +
      "honor Render<B_C> =\n" +
      '    render(v) = "BC${v.p}"\n' +
      "honor Render<C> =\n" +
      '    render(v) = "C${v.q}"\n' +
      "honor<a: Render> Render<A(a)> =\n" +
      '    render(x) = "A(${x.value.render()})"\n' +
      "honor<a: Render> Render<A_B(a)> =\n" +
      '    render(x) = "AB(${x.value.render()})"\n' +
      "let l: A(B_C) = A({value = B_C({p = 1})})\n" +
      "let r: A_B(C) = A_B({value = C({q = 2})})\n" +
      "export let one: String = render(l)\n" +
      "export let two: String = render(r)\n";
    const text = emitted(source);

    // `__Render_A(__Render_B_C)` and `__Render_A_B(__Render_C)` both prefer
    // `__Render_A_B_C`. They must not share a binding: they are different
    // dictionaries, and one `const` for both is a miscompile, not a cosmetic
    // defect.
    expect(text).toContain("const __Render_A_B_C = __Render_A(__Render_B_C);");
    expect(text).toContain("const __Render_A_B_C_1 = __Render_A_B(__Render_C);");
    expect(text).toContain("render(l, __Render_A_B_C)");
    expect(text).toContain("render(r, __Render_A_B_C_1)");

    const main = await runMain(source);
    expect(main["one"]).toBe("A(BC1)");
    expect(main["two"]).toBe("AB(C2)");
  });
});

describe("the ruling's runtime consequence", () => {
  test("one dictionary is allocated for a shared tree, however many calls run", async () => {
    // §1: "the observable differences are the emitted text and the number of
    // objects allocated at runtime." Counted by instrumenting the emitted
    // factory itself, which is the only place a dictionary for `Box` is built.
    const source =
      RENDER_PRELUDE +
      "export fun loop(n: Int): String =\n" +
      "    if n <= 0 then \"\" else render(Box({value = n})) ++ loop(n - 1)\n";

    const main = await runProject([["/main.hex", source]], {
      transform: (path, javascript) =>
        path !== "/main.hex" ? javascript : javascript.replace(
          "const __Render_Box = ",
          "globalThis.__hexBoxBuilds = 0;\nconst __Render_Box = ",
        ).replace(
          "__Render_a => {",
          "__Render_a => { globalThis.__hexBoxBuilds += 1;",
        ),
    });

    expect((main["loop"] as (n: number) => string)(5)).toBe(
      "Box(5)Box(4)Box(3)Box(2)Box(1)",
    );
    expect((globalThis as Record<string, unknown>)["__hexBoxBuilds"]).toBe(1);
  });
});
