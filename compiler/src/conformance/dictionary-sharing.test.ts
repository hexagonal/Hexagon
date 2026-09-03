import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for `spec/dictionary-sharing.md` §3 and its §11 obligations 1–5
 * (#449) and 8 (#446).
 *
 * §3 is four rules over one channel:
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
 *   application, which is what §10.3 shows must not be hoisted eagerly;
 * - **§3.4** a *structural* dictionary — compiler-built evidence for an
 *   anonymous shape, or for `Bool` — takes §3.1's rule too when it is ground,
 *   keyed by §4's constraint-plus-type extension rather than by a rendering.
 *
 * Obligation 6 (collision-only aliasing) landed with #425 and is pinned by
 * `dictionary-names.test.ts`. Obligation 7 (literal-member reduction) landed
 * there too and is pinned by `literal-member-peephole.test.ts`, which also
 * carries #446's amendment to it — where the reduction declines at a ground
 * shape, the selection reads off the §3.4 binding. Neither is rebuilt here.
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
    // The use site reads the member off the binding since #444 — a
    // parameterized instance at a ground head has no seat to call (Constraints
    // §6.1's second arm) — and what §3.1 pins is that both sites name the one
    // binding rather than rebuilding the application.
    expect(text).toContain("const one = __Render_Box_Int.render(boxed);");
    expect(text).toContain("const two = __Render_Box_Int.render(boxed);");
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
    expect(text).toContain("const one = __Render_Box_Box_Int.render(nested);");
    expect(text).toContain("const two = __Render_Box_Box_Int.render(nested);");
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
    expect(text).toContain(
      'const f = x => __Show_Option_Int.show({ tag: "Some", value: x });',
    );
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
    //
    // `/main.hex` reaches `honor<a: Render> Render<Box(a)>` only through
    // `Lib.render`/`Lib.Box`, never a bare name, and that instance's own binder
    // list in turn demands `Render<Int>`. Since #762 this module has no
    // spelling for `Render` at all, so the binder's constraint travels by the
    // identity it resolved to at home (`Resolved.TypeParameter`'s
    // `constraintIdentities`) rather than being re-resolved here against a word
    // nothing binds.
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
        'import Lib from "./lib"\n' +
          "let boxed: Lib.Box(Int) = Lib.Box({value = 1})\n" +
          "export let one: String = Lib.render(boxed)\n",
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

    expect(text).toContain("const __Render_Box_Int = { render: __Render_Box_Int_render };");
    expect(text).toContain('const __Render_Box_Int_render = v => "BI(');
    expect(text).toContain("const __Render_Box_Int_1 = __Render_Box(__Render_Int);");
    expect(text).toContain("__Render_Box_Int_1.render(boxed)");
    // The declared instance's own seat is in the same first-phase rank (§5, as
    // amended for #444), so it is one more contestant the hoisted binding had
    // to probe past — and the concrete call to it reaches the seat directly.
    expect(text).toContain("__Render_Box_Int_render({ n: 2 })");
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
    expect(text).toContain("__Render_A_B_C.render(l)");
    expect(text).toContain("__Render_A_B_C_1.render(r)");

    const main = await runMain(source);
    expect(main["one"]).toBe("A(BC1)");
    expect(main["two"]).toBe("AB(C2)");
  });
});

/**
 * §3.4 and §11 obligation 8 (#446) — ground **structural** dictionaries hoist
 * by their shape.
 *
 * The rule is §3.1's, in the other evidence kind: a compiler-built dictionary
 * for an anonymous shape (a tuple, `Unit` the arity-0 tuple) or for `Bool`,
 * whose per-component evidence is itself ground, is one module-level `const`
 * referenced by name. What differs is only the key — a structural node has no
 * application to render, so §4 keys it on the demanded constraint, a canonical
 * serialization of the ground type, and its components in order.
 *
 * Obligation 8's own wording carries the precedence: a site §9.1's reduction
 * *discharges* materializes nothing and so has nothing to hoist, which is why
 * every pin below is at a site where the reduction declines or where the record
 * rides whole as trailing evidence. `literal-member-peephole.test.ts` owns the
 * reduction's conditions; the one pin here is that they did not move.
 */
describe("§3.4 — ground structural dictionaries hoist by their shape", () => {
  test("two declining sites of one tuple shape emit one binding and two references", async () => {
    const source =
      "let tupleShape = 0\n" +
      "export let shown: String = show((1, 2))\n" +
      'export let interpolated: String = "pair ${(3, 4)}"\n';
    const text = emitted(source);

    // §5's spelling: the tuple contributes its element spellings in order, the
    // anonymous constructor contributing nothing.
    expect(text).toContain(
      'const __Show_Int_Int = ({ show: __value => "(" + String(__value[0]) + ", " +' +
        ' String(__value[1]) + ")" });',
    );
    // One binding, two references — one a source-written member call at a
    // compiler-built ground demand (Constraints §6.1's third arm, #444), one an
    // interpolation reading a member off it after §9.1 declined.
    expect(occurrences(text, "const __Show_Int_Int =")).toBe(1);
    expect(text).toContain("const shown = __Show_Int_Int.show([1, 2]);");
    expect(text).toContain('const interpolated = "pair " + __Show_Int_Int.show([3, 4]);');
    // §3.4's last sentence: "the inline literal shape appears at no ground site."
    expect(occurrences(text, "({ show:")).toBe(1);

    const main = await runMain(source);
    expect(main["shown"]).toBe("(1, 2)");
    expect(main["interpolated"]).toBe("pair (3, 4)");
  });

  test("`Unit` takes the same rule, and its declined selection reads off the binding", async () => {
    const source =
      "let unitShape = 0\n" +
      "export let shown: String = show(())\n" +
      'export let interpolated: String = "u ${()}"\n';
    const text = emitted(source);

    expect(text).toContain('const __Show_Unit = ({ show: __value => "()" });');
    expect(occurrences(text, "const __Show_Unit =")).toBe(1);
    expect(text).toContain("const shown = __Show_Unit.show(undefined);");
    // §3.4's worked example, verbatim: `({ show: __value => "()" }).show(value)`
    // becomes `__Show_Unit.show(value)`.
    expect(text).toContain('const interpolated = "u " + __Show_Unit.show(undefined);');
    expect(occurrences(text, "({ show:")).toBe(1);

    const main = await runMain(source);
    expect(main["shown"]).toBe("()");
    expect(main["interpolated"]).toBe("u ()");
  });

  /**
   * §5's emission order, in the kind that made it a question again. A structural
   * binding's initializer names its components' own bindings, so it must be
   * emitted after them — and §3.4 says the DAG argument "carries over verbatim,
   * a component tree being a proper subterm of the tree that contains it".
   *
   * The property that makes insertion order *be* dependency order is that the
   * initializer is rendered before the binding is interned. Interning first —
   * the shape a naive implementation reaches for, since it is what makes a
   * recursive walk terminate — would put this binding ahead of the application
   * it reads, and a module-level `const` reading a later `const` is a temporal
   * dead zone, not a cosmetic defect. The `runMain` below is what makes that
   * concrete: under the inverted order the module throws on load.
   *
   * The whole-record site comes **first** on purpose. A site that selects a
   * member renders the dictionary's slots before it asks for a binding at all,
   * so it interns the components either way; only a site that hands the record
   * over whole leaves the rendering to the interning step, which is where the
   * order is actually decided.
   */
  test("a structural binding is emitted after the application its component hoisted", async () => {
    const source =
      "let dependencyOrder = 0\n" +
      "record Box(a) derives Show = {value: a}\n" +
      "export let two: String = show((Box({value = 3}), 4))\n" +
      'export let one: String = "${(Box({value = 1}), 2)}"\n';
    const text = emitted(source);

    expect(text).toContain("const __Show_Box_Int = __Show_Box(__Show_Int);");
    expect(text).toContain(
      'const __Show_Box_Int_Int = ({ show: __value => "(" + __Show_Box_Int.show(__value[0])',
    );
    expect(offsetOf(text, "const __Show_Box_Int =")).toBeLessThan(
      offsetOf(text, "const __Show_Box_Int_Int ="),
    );

    const main = await runMain(source);
    expect(main["one"]).toBe("({value = 1}, 2)");
    expect(main["two"]).toBe("({value = 3}, 4)");
  });

  /**
   * §4's structural key is the **full application**, never the bare type. A
   * zero-component shape's type alone cannot tell `Show<Unit>`'s dictionary from
   * `Eq<Unit>`'s — both are the arity-0 tuple — so a key without the constraint
   * would share one binding between two different records, and the first slot
   * read at the second site would be a `TypeError`.
   */
  test("one type under two constraints keys distinctly", async () => {
    const source =
      "let twoConstraints = 0\n" +
      "export let shown: String = show(())\n" +
      "export let same: Bool = () == ()\n";
    const text = emitted(source);

    expect(text).toContain('const __Show_Unit = ({ show: __value => "()" });');
    expect(text).toContain("const __Eq_Unit = ({ equals: (__left, __right) => true,");
    expect(text).toContain("const shown = __Show_Unit.show(undefined);");
    expect(text).toContain("const same = __Eq_Unit.equals(undefined, undefined);");

    const main = await runMain(source);
    expect(main["shown"]).toBe("()");
    expect(main["same"]).toBe(true);
  });

  /**
   * §3.4's second paragraph, and obligation 7's "keep today's literal only under
   * a free component". Groundness is about the *components*, not about the
   * enclosing body: `Show<Bool>` inside a polymorphic function still hoists,
   * while a tuple whose elements are the body's own evidence parameters cannot.
   */
  test("a free component keeps the literal; a ground one beside it still hoists", async () => {
    const source =
      "let freeComponent = 0\n" +
      "let showPair<a: Show, b: Show>(x: a, y: b): String = show((x, y))\n" +
      "let tagged<a: Show>(x: a): String = show(True) ++ show(x)\n" +
      "export let one: String = showPair(1, 2)\n" +
      "export let two: String = tagged(3)\n";
    const text = emitted(source);

    // Not ground: the elements' evidence is the body's own parameters, so the
    // record stays where it is written.
    // The call keeps the forwarder and its trailing evidence: the head is a
    // tuple of the body's own type variables, so it is not concrete and #444's
    // clause does not describe it.
    expect(text).toContain(
      'const showPair = (x, y, __Show_a, __Show_b) => show([x, y], ({ show: __value => "(" +' +
        ' __Show_a.show(__value[0]) + ", " + __Show_b.show(__value[1]) + ")" }));',
    );
    // Ground, in the very same kind of body: `Show<Bool>` has no component at
    // all, so nothing about `tagged`'s type variable reaches it.
    expect(text).toContain(
      'const __Show_Bool = ({ show: __value => (__value ? "True" : "False") });',
    );
    expect(text).toContain("__Show_Bool.show(true)");

    const main = await runMain(source);
    expect(main["one"]).toBe("(1, 2)");
    expect(main["two"]).toBe("True3");
  });

  /**
   * The `Hash`-shaped sub-dictionary the emitter synthesizes for a `Set`/`Map`
   * element carries `components: []` — no component demand was recorded, and the
   * walk beneath it is licensed to stay structural (Collections Part 2 §4.3).
   * Its groundness is therefore a question about its *type*: a variable-free one
   * walks to module-level names only, and hoists.
   *
   * It is also where the key's leaf normalization earns its place. These three
   * demands are one `Hash<(Int, Int)>`, and the checker hands `Hash<Int>` to
   * some as `Primitive` evidence and to others as the migrated companion's
   * `Instance` evidence — one dictionary, two spellings. A key over the raw
   * kinds split it into two bindings.
   */
  test("the synthesized `Hash`-shaped dictionary hoists once across three demands", async () => {
    const source =
      "let hashShape = 0\n" +
      "export let seen: Set((Int, Int)) = Set.add(Set.add(Set.empty, (1, 2)), (1, 2))\n" +
      "export let table: Map((Int, Int), Int) = Map.set(Map.empty, (1, 2), 3)\n" +
      "export let seenSize: Int = Set.size(seen)\n" +
      "export let tableSize: Int = Map.size(table)\n";
    const text = emitted(source);

    expect(occurrences(text, "const __Hash_Int_Int =")).toBe(1);
    expect(text).not.toContain("__Hash_Int_Int_1");
    expect(occurrences(text, "__Hash_Int_Int")).toBe(4);
    // One binding, three references: the literal survives only as the
    // initializer, at no use site.
    expect(occurrences(text, "({ Eq: {")).toBe(1);

    const main = await runMain(source);
    // The behavioral half: one binding for three demands must still hash and
    // compare a tuple key correctly, so the duplicate insert collapses.
    expect(main["seenSize"]).toBe(1);
    expect(main["tableSize"]).toBe(1);
  });

  /**
   * The other half of the `components: []` question, and the one that decides
   * the groundness test. `Set`/`Map`'s synthesized sub-dictionary records no
   * component demand, so "every component is ground" is *vacuously true* for
   * it — including when the shape beneath it is `(a, Int)` inside a polymorphic
   * body, whose walk reaches the body's own `__Hash_a`. Hoisting on the
   * components alone would put a free evidence parameter in a module-level
   * initializer: a `ReferenceError` before the first call. The type must be
   * variable-free too, which is what keeps §3.4's invariant — a hoisted
   * initializer references only module-level names — an invariant rather than a
   * hope.
   */
  test("a variable under a componentless synthesized shape keeps the literal", () => {
    const source =
      "let componentless = 0\n" +
      "export let nest<a: Hash>(s: Set((a, Int))): Set(Set((a, Int))) =\n" +
      "    Set.add(Set.empty, s)\n";
    const text = emitted(source);

    // The walk names the body's evidence parameter, so the dictionary stays
    // where it is written and no module-level binding mentions `__Hash_a`.
    expect(text).toContain("const nest = (s, __Hash_a) => {");
    expect(text).toContain("return add(empty, s, ({ Eq: {");
    expect(text).not.toMatch(/^const __\w+ = .*__Hash_a/mu);
  });

  /**
   * The eagerly-read position, which §3.4 inherits from §3.1 rather than
   * escaping. §5 places the hoisted block **after** the instances, so a slot an
   * instance reads *while its own `const` initializes* may not be a hoisted
   * name — it would be in that binding's temporal dead zone.
   *
   * Structural evidence reaches such a position in exactly one place, and it is
   * the prelude's own: `Bool`'s evidence is compiler-built rather than a source
   * honor block (#441), so `Ord<Bool>`'s and `Hash<Bool>`'s inherited `eq` slots
   * — base constraints, filled at construction — are `Eq<Bool>` structural
   * literals. They are ground, and hoisting them would emit
   * `const __Ord_Bool = { Eq: __Eq_Bool_1, … }` above the `const __Eq_Bool_1`
   * it names: a `ReferenceError` on the first import of the module.
   *
   * Compiling the stdlib itself is the one way to reach `Bool.hex`'s emitted
   * text (`injectPrelude` prefers a project file at the injection path), which
   * is what `bool-union.test.ts` uses to prove its integrity check runs.
   */
  test("an eagerly-read base-constraint slot keeps its literal", () => {
    const files = [
      [
        "/Bool.hex",
        "export union Bool derives (Eq, Ord, Show, Hash) =\n    | False\n    | True\n",
      ],
      // The import is what keeps `/Bool.hex` in the emitted graph: nothing
      // reaches its dictionaries by the ordinary route, since `Bool`'s evidence
      // is compiler-built at every use site (#441).
      [
        "/main.hex",
        'import Boolean from "./Bool"\nlet eagerSlot = 0\nexport let flag: Bool = True\n',
      ],
    ] as const;
    const project = compileFiles(files);
    expect(project.diagnostics).toEqual([]);
    const text = emittedFrom(files, "/Bool.hex");

    expect(text).toContain(
      "const __Ord_Bool = { Eq: ({ equals: (__left, __right) => __left === __right,",
    );
    expect(text).toContain(
      "const __Hash_Bool = { Eq: ({ equals: (__left, __right) => __left === __right,",
    );
    // The invariant behind the pin, stated so a future reader sees what broke:
    // no `const` in this module names a binding declared after it.
    expect(text).not.toContain("__Eq_Bool_1");
  });

  test("a structural binding joins no export list and no `.d.ts`", () => {
    const source =
      "let structuralExports = 0\n" +
      'export let interpolated: String = "u ${()}"\n';
    const project = compileFiles([["/main.hex", source]]);
    expect(project.diagnostics).toEqual([]);
    const module = project.modules.find(({ source: file }) => file.path === "/main.hex")!;

    // Obligation 5, over the §3.4 family: it joins the top-level `const` set and
    // nothing else.
    expect(module.javascript.text).toContain("const __Show_Unit =");
    expect(module.javascript.text).not.toMatch(/export \{[^}]*__Show_Unit/u);
    expect(module.declarations.text).not.toContain("__Show_Unit");
  });

  test("two compiles agree on the structural bindings and their order", () => {
    const source =
      "let structuralDeterminism = 0\n" +
      'export let one: String = "${(1, 2)}"\n' +
      'export let two: String = "${()}"\n' +
      "export let three: Bool = (1, 2) == (3, 4)\n";

    // Obligation 4, over the §3.4 family. Whole-text equality is the strongest
    // form of §5's normative determinism.
    expect(emitted(source)).toBe(emitted(source));
    expect(
      emitted(source)
        .split("\n")
        .filter((line) => /^const __\w+ = \(\{/u.test(line))
        .map((line) => line.slice(0, line.indexOf(" ="))),
    ).toEqual(["const __Show_Int_Int", "const __Show_Unit", "const __Eq_Int_Int"]);
  });

  /**
   * §7 in the structural kind: sharing is per module. `stdlib/Debug.hex` is the
   * one in the tree that demands `Show<Unit>` on its own account — `logUnit` and
   * `traceUnit` are its `Unit` editions, and both decline §9.1's reduction
   * because `Show<Unit>`'s body names its parameter nowhere.
   */
  test("a prelude module hoists its own binding for the shape it demands", async () => {
    const files = [["/main.hex", "let perModule = 0\nDebug.log(())\n"]] as const;
    const debug = emittedFrom(files, "/Debug.hex");

    expect(occurrences(debug, "const __Show_Unit =")).toBe(1);
    expect(debug).toContain(
      "function logUnit(value) {\n  return writeLine(__Show_Unit.show(value));\n}",
    );
    expect(debug).toContain('logString(label + ": " + __Show_Unit.show(value));');
    expect(occurrences(debug, "({ show:")).toBe(1);

    // And the probe still prints what it printed.
    const lines: unknown[] = [];
    const host = globalThis as unknown as { console: { log: (...v: unknown[]) => void } };
    const original = host.console.log;
    host.console.log = (...values: unknown[]) => void lines.push(values[0]);
    try {
      await runProject([["/main.hex", "let perModuleRun = 0\nDebug.log(())\n"]]);
    } finally {
      host.console.log = original;
    }
    expect(lines).toEqual(["()"]);
  });

  /**
   * The precedence, from the other side: where §9.1's reduction fires nothing is
   * materialized, so a ground shape it discharges must produce **no** binding.
   * `Eq<{n: Int}>`'s `equals` reads each parameter exactly once, in order — the
   * reduction's conditions, unchanged by the graduation.
   */
  test("a reduction site materializes nothing to hoist", async () => {
    const source =
      "let reductionFirst = 0\n" +
      "export let same: Bool = {n = 1} == {n = 1}\n" +
      "export let differ: Bool = {n = 1} == {n = 2}\n";
    const text = emitted(source);

    expect(text).toContain("const same = (({ n: 1 }).n === ({ n: 1 }).n);");
    expect(text).not.toContain("({ equals:");
    expect(text).not.toMatch(/^const __Eq_n\b/mu);

    const main = await runMain(source);
    expect(main["same"]).toBe(true);
    expect(main["differ"]).toBe(false);
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
