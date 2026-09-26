/**
 * **A contract refusal advises the whole list** *(#1098; Functions §4.2 and
 * §10's row, Constraints §8's `honor` and subject rows)*.
 *
 * A body that demands two constraints its binder does not declare draws two
 * refusals, one at each demand. Each used to advise its own constraint added
 * to the written list, so neither rewrite compiled: applying one left the
 * other's refusal behind. Every report about one variable now advises the same
 * list — the written constraints and every demand they do not entail, maximal
 * under entailment — decided once every demand is known.
 *
 * Each advised list here is discharged, not asserted: the rewrite is written
 * out verbatim and compiled, since the Rewrite Rule's whole claim is that the
 * next compile accepts it. The one exception is the refused literal pattern,
 * which pins when a refusal counts as reported. Its list leaves none of this
 * row's refusals behind, but the literal then meets Pattern Matching §2.5's
 * refusal, which is another row's.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

function verdict(source: string): readonly string[] {
  return projectDiagnostics("module Main\n\n" + source);
}

function graphDiagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** The carets, in report order, as the source text each one covers. */
function carets(source: string): readonly string[] {
  const text = "module Main\n\n" + source;
  return compileFiles([["/main.hex", text]]).diagnostics.map(({ primary }) =>
    text.slice(primary.start.offset, primary.end.offset)
  );
}

function binderRefusal(declared: string, required: string, list: string): string {
  return `\`a\` is declared to honor ${declared}, but the body requires \`${required}\`; ` +
    `write \`<a: ${list}>\`, or remove the constraint annotation to let it be inferred`;
}

describe("a function binder's refusals advise one list", () => {
  test("two demands copied at one use: both reports advise both constraints", () => {
    const callee = "let st<a: (Show, Hash)>(x: a): String = show(x)\n";
    const source = callee + "export let f<a: Eq>(x: a): String = st(x)\n";
    expect(verdict(source)).toEqual([
      binderRefusal("`Eq`", "Show", "(Hash, Show)"),
      binderRefusal("`Eq`", "Hash", "(Hash, Show)"),
    ]);
    expect(carets(source)).toEqual(["st", "st"]);
    expect(verdict(callee + "export let f<a: (Hash, Show)>(x: a): String = st(x)\n")).toEqual([]);
  });

  test("demands at separate carets: an earlier report names a later demand", () => {
    // The first report is decided before `show` is checked, which is why the
    // wording waits for the module to close.
    const source = 'export let f<a: Eq>(x: a): String = if x < x then show(x) else ""\n';
    expect(verdict(source)).toEqual([
      binderRefusal("`Eq`", "Ord", "(Ord, Show)"),
      binderRefusal("`Eq`", "Show", "(Ord, Show)"),
    ]);
    expect(carets(source)).toEqual(["x < x", "show"]);
    expect(verdict('export let f<a: (Ord, Show)>(x: a): String = if x < x then show(x) else ""\n'))
      .toEqual([]);
  });

  test("the list stays maximal: a written entry a demand entails is dropped", () => {
    // `Ord` and `Hash` both entail `Eq`; neither entails the other.
    const body = "(x: a): String = if x < x then show(x) else Hash.hash(x).show()\n";
    expect(verdict(`export let f<a: (Eq, Show)>${body}`)).toEqual([
      binderRefusal("`Eq` and `Show`", "Ord", "(Hash, Ord, Show)"),
      binderRefusal("`Eq` and `Show`", "Hash", "(Hash, Ord, Show)"),
    ]);
    expect(verdict(`export let f<a: (Hash, Ord, Show)>${body}`)).toEqual([]);
  });

  test("an unconstrained binder's list is the demands alone", () => {
    const body = "(x: a): String = if x < x then show(x) else \"\"\n";
    expect(verdict(`export let f<a>${body}`)).toEqual([
      "`a` is declared without constraints, but the body requires `Ord`; write `<a: (Ord, Show)>`, " +
        "or remove the explicit type parameter to let it be inferred",
      "`a` is declared without constraints, but the body requires `Show`; write `<a: (Ord, Show)>`, " +
        "or remove the explicit type parameter to let it be inferred",
    ]);
    expect(verdict(`export let f<a: (Ord, Show)>${body}`)).toEqual([]);
  });

  test("two variables' lists stay apart", () => {
    const body = "(x: a, y: b): String = if x < x then show(y) else show(x)\n";
    expect(verdict(`export let f<a: Eq, b: Eq>${body}`)).toEqual([
      binderRefusal("`Eq`", "Ord", "(Ord, Show)"),
      "`b` is declared to honor `Eq`, but the body requires `Show`; write `<b: (Eq, Show)>`, " +
        "or remove the constraint annotation to let it be inferred",
      binderRefusal("`Eq`", "Show", "(Ord, Show)"),
    ]);
    expect(verdict(`export let f<a: (Ord, Show), b: (Eq, Show)>${body}`)).toEqual([]);
  });

  test("a refused literal pattern still counts as reported where it is refused", () => {
    // The refusal is worded at the end of the module, but the pattern it
    // breaks is judged at once: a broken literal reads as `_` for coverage
    // (Pattern Matching §7.3), so no second report claims `(_, _)` is missing.
    // Not discharged: under `<a: (Eq, Num, Show)>` the literal meets §2.5's
    // "`0` is not a pattern at `a`", which is not this row's refusal.
    expect(verdict(
      "export let f<a: Show>(x: a): String =\n" +
      "    match (x, 1)\n" +
      '        (0, _) => "zero"\n' +
      '        (_, 1) => "one"\n',
    )).toEqual([
      binderRefusal("`Show`", "Eq", "(Eq, Num, Show)"),
      binderRefusal("`Show`", "Num", "(Eq, Num, Show)"),
    ]);
  });
});

describe("a block head's refusals advise one head", () => {
  test("members exceeding the head in different ways share the widened head", () => {
    const members =
      "    p(x: a, n: Int): Int = if n > 0 then q(x, n) else 0\n" +
      '    q(x: a, n: Int): Int = if x < x then 1 else if show(x) == "" then 2 else p(x, n - 1)\n';
    expect(verdict("fun<a: Eq>\n" + members)).toEqual([
      "`a` is declared to honor `Eq` on the block head, but `q`'s body requires `Ord`; widen the head: " +
        "`fun<a: (Ord, Show)>`, or remove the head's constraint to let it be inferred",
      "`a` is declared to honor `Eq` on the block head, but `q`'s body requires `Show`; widen the head: " +
        "`fun<a: (Ord, Show)>`, or remove the head's constraint to let it be inferred",
    ]);
    expect(verdict("fun<a: (Ord, Show)>\n" + members)).toEqual([]);
  });
});

describe("an `honor` header's refusals merge into the written list (Constraints §8)", () => {
  const box = "constraint Sh<a> =\n    sh(x: a) -> String\nrecord Box(a) = {value: a}\n";
  const body = ' Sh<Box(a)> =\n    sh(x) = if x.value < x.value then Show.show(x.value) else ""\n';

  test("the written entries hold their places, and the demands follow alphabetically", () => {
    // The written `Hash` keeps its place. That the demands follow in
    // alphabetical rather than arrival order is the next test's to show,
    // where they arrive `Ord` before `Hash`.
    const refusal = (required: string) =>
      `\`a\` is declared to honor \`Hash\`, but the body requires \`${required}\`; ` +
      "write `<a: (Hash, Ord, Show)>` on the `honor` header";
    expect(verdict(box + "honor<a: Hash>" + body)).toEqual([refusal("Ord"), refusal("Show")]);
    expect(verdict(box + "honor<a: (Hash, Ord, Show)>" + body)).toEqual([]);
  });

  test("a written entry a demand entails is dropped, and the rest append after it", () => {
    // The written `Show` stays first although it sorts last: its slot is the
    // author's (Constraints §6.2). `Eq` goes, since `Ord` provides it.
    const refusal = (required: string) =>
      `\`a\` is declared to honor \`Show\` and \`Eq\`, but the body requires \`${required}\`; ` +
      "write `<a: (Show, Hash, Ord)>` on the `honor` header";
    const hashing = ' Sh<Box(a)> =\n    sh(x) = if x.value < x.value then Int.show(Hash.hash(x.value)) else Show.show(x.value)\n';
    expect(verdict(box + "honor<a: (Show, Eq)>" + hashing)).toEqual([refusal("Ord"), refusal("Hash")]);
    expect(verdict(box + "honor<a: (Show, Hash, Ord)>" + hashing)).toEqual([]);
  });

  test("a header with no binder written takes the demands alone", () => {
    const refusal = (required: string) =>
      `\`a\` is declared without constraints, but the body requires \`${required}\`; ` +
      "write `<a: (Ord, Show)>` on the `honor` header";
    expect(verdict(box + "honor" + body)).toEqual([refusal("Ord"), refusal("Show")]);
    expect(verdict(box + "honor<a: (Ord, Show)>" + body)).toEqual([]);
  });
});

describe("a subject's refusals merge into the written base list (Constraints §8)", () => {
  test("the written bases hold their places, and the demands follow alphabetically", () => {
    const myEq = "constraint MyEq<a> =\n    eq(left: a, right: a) -> Bool\n";
    const members = "    label(value: a) -> String\n" +
      '    shown(value: a) -> String = if value < value then "${value}" else ""\n';
    const refusal = (required: string) =>
      "`a` is `Labelled`'s subject, so the body reaches only `Labelled` and its base constraints, " +
      `but it requires \`${required}\`; add \`${required}\` as a base constraint — ` +
      "write `constraint Labelled<a: (MyEq, Ord, Show)>`";
    expect(verdict(myEq + "constraint Labelled<a: MyEq> =\n" + members))
      .toEqual([refusal("Ord"), refusal("Show")]);
    expect(verdict(myEq + "constraint Labelled<a: (MyEq, Ord, Show)> =\n" + members)).toEqual([]);
  });

  test("demands across default members share the list, and an entailed base is dropped", () => {
    const members = "    label(value: a) -> String\n" +
      "    shown(value: a) -> String = show(value)\n" +
      "    hashed(value: a) -> Int = Hash.hash(value)\n";
    const refusal = (required: string) =>
      "`a` is `Labelled`'s subject, so the body reaches only `Labelled` and its base constraints, " +
      `but it requires \`${required}\`; add \`${required}\` as a base constraint — ` +
      "write `constraint Labelled<a: (Hash, Show)>`";
    expect(verdict("constraint Labelled<a: Eq> =\n" + members))
      .toEqual([refusal("Show"), refusal("Hash")]);
    expect(verdict("constraint Labelled<a: (Hash, Show)> =\n" + members)).toEqual([]);
  });
});

/** A private constraint gating an export — Modules §4.3's sealing idiom. */
const GATE_LIB = [
  "module Lib",
  "",
  "constraint Gate<a> =",
  "    gate(value: a) -> a",
  "",
  "honor Gate<Int> =",
  "    gate(n) = n + 1",
  "",
  "export let use<a: Gate>(x: a): a = gate(x)",
  "export let keep: Int = 0",
  "",
].join("\n");

const KEEP = "export let keep: Int = 0\n";

describe("a demand no list can spell leaves no list to advise", () => {
  test("every report about the variable names the gate, and keeps only the inference exit", () => {
    const gate = "the constraint `Gate`, declared in module `Lib` and not exported; " +
      "no constraint list here can name it — remove the constraint annotation to let it be inferred";
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex",
        "module Main\n\nimport Lib\n" +
        'let g<a: Ord>(x: a): a = if show(x) == "" then Lib.use(x) else x\n' + KEEP],
    ])).toEqual([
      // Its list would have to name `Gate` too, so `write <a: (Ord, Show)>`
      // would only leave the `Gate` report behind.
      `\`a\` is declared to honor \`Ord\`, but the body requires \`Show\`, and also ${gate}`,
      `\`a\` is declared to honor \`Ord\`, but the body requires ${gate}`,
    ]);
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex",
        "module Main\n\nimport Lib\n" +
        'let g(x) = if show(x) == "" then Lib.use(x) else x\n' + KEEP],
    ])).toEqual([]);
  });

  test("an unmentioned variable's report then drops the rewrite that would need the list", () => {
    // Functions §10's unmentioned row absorbs the refusal, and its first
    // rewrite — use the variable and write the list — has no list to write.
    const main = (source: string) => [
      ["/lib.hex", GATE_LIB],
      ["/main.hex", "module Main\n\nimport Lib\n" + source + KEEP],
    ] as const;
    expect(graphDiagnostics(main(
      "let g<a: Ord>(x: Int): Int =\n    let h = (y: a) => Lib.use(y)\n    x\n",
    ))).toEqual([
      "`a` is a declared type variable, but this declaration's type does not mention it, so no " +
        "call can choose it or supply its `Gate`, `Ord` evidence; remove `a` from the binder list " +
        "and write a concrete type where the body names `a`",
    ]);
    expect(graphDiagnostics(main(
      "let g(x: Int): Int =\n    let h = (y: Int) => Lib.use(y)\n    x\n",
    ))).toEqual([]);
  });
});

/** Two modules exporting one word for two declarations, and one function over both. */
const DESCRIBE_ONE = "module Lib1\n\nexport constraint Describe<a: Num> =\n    one(value: a) -> a\n" +
  "export let useOne<a: Describe>(v: a): a = one(v)\n";
const DESCRIBE_TWO = "module Lib2\n\nexport constraint Describe<a: Num> =\n    two(value: a) -> a\n" +
  "export let useTwo<a: Describe>(v: a): a = two(v)\n";
const DESCRIBE_BOTH = "module Both\n\nimport Lib1\nimport Lib2\n" +
  "export let useBoth<a: (Lib1.Describe, Lib2.Describe)>(v: a): a = Lib1.useOne(Lib2.useTwo(v))\n";

describe("two demands that share a word", () => {
  const files = (main: string) => [
    ["/lib1.hex", DESCRIBE_ONE],
    ["/lib2.hex", DESCRIBE_TWO],
    ["/both.hex", DESCRIBE_BOTH],
    ["/main.hex", "module Main\n\nimport Both\n" + main + KEEP],
  ] as const;

  test("at one caret, read alike, so they are one report (Functions §10's once per place)", () => {
    expect(graphDiagnostics(files("let g<a: Ord>(x: a): a = Both.useBoth(x)\n"))).toEqual([
      "`a` is declared to honor `Ord`, but the body requires `Describe`; " +
        "write `<a: (Lib1.Describe, Lib2.Describe, Ord)>` — `Describe` is declared in module `Lib1`; " +
        "`import Lib1` and spell it `Lib1.Describe` — `Describe` is declared in module `Lib2`; " +
        "`import Lib2` and spell it `Lib2.Describe`, or remove the constraint annotation to let it be inferred",
    ]);
    expect(graphDiagnostics(files(
      "import Lib1\nimport Lib2\nlet g<a: (Lib1.Describe, Lib2.Describe, Ord)>(x: a): a = Both.useBoth(x)\n",
    ))).toEqual([]);
  });
});

/** An exported constraint in another module, reached through a second hop. */
const HEFT_LIB = [
  "module Lib",
  "",
  "export constraint Heft<a> =",
  "    heft(value: a) -> a",
  "export let useHeft<a: Heft>(n: a): a = heft(n)",
  "",
].join("\n");
const HEFT_MID = [
  "module Mid",
  "",
  "import Lib",
  "export let useHeft<a: Lib.Heft>(n: a): a = Lib.useHeft(n)",
  "",
].join("\n");
const TALLY_LIB = [
  "module Tally",
  "",
  "export constraint Tally<a> =",
  "    tally(value: a) -> a",
  "export let useTally<a: Tally>(n: a): a = tally(n)",
  "",
].join("\n");
const TALLY_MID = [
  "module Count",
  "",
  "import Tally",
  "export let useTally<a: Tally.Tally>(n: a): a = Tally.useTally(n)",
  "",
].join("\n");

describe("the unmentioned row over a same-spelled pair", () => {
  // Constraints §5.1.1's disambiguation bullet: a message that mentions two
  // same-named constraints qualifies each by its declaring module, as the
  // contract row does — never the one word twice.
  test("qualifies each by its declaring module", () => {
    const files = (main: string) => [
      ["/lib.hex", HEFT_LIB],
      ["/mid.hex", HEFT_MID],
      ["/main.hex", "module Main\n\nimport Mid\n" + main + KEEP],
    ] as const;
    const local = "constraint Heft<a> =\n    other(value: a) -> a\n";
    expect(graphDiagnostics(files(
      local + "fun f<a: Heft>(x: Int): Int =\n    let g = (y: a) => Mid.useHeft(y)\n    x\n",
    ))).toEqual([
      "`a` is a declared type variable, but this declaration's type does not mention it, so no call " +
        "can choose it or supply its evidence for this module's `Heft` and the `Heft` declared in module " +
        "`Lib`; use `a` in a parameter or result type " +
        "and write `<a: (Heft, Lib.Heft)>` — `Heft` is declared in module `Lib`, and this module binds " +
        "another `Heft`; `import Lib` and spell it `Lib.Heft`, or remove `a` from the binder list and " +
        "write a concrete type where the body names `a`",
    ]);
    expect(graphDiagnostics(files(
      "import Lib\n" + local + "fun f<a: (Heft, Lib.Heft)>(x: a): Int =\n    let g = (y: a) => Mid.useHeft(y)\n    0\n",
    ))).toEqual([]);
  });
});

describe("the unmentioned row's evidence clause", () => {
  test("qualifies a sealed constraint too, which no list spelling could name", () => {
    const sealedHeft = "module Lib\n\nconstraint Heft<a> =\n    heft(value: a) -> a\n" +
      "honor Heft<Int> =\n    heft(n) = n\nexport let use<a: Heft>(x: a): a = heft(x)\n";
    expect(graphDiagnostics([
      ["/lib.hex", sealedHeft],
      ["/main.hex",
        "module Main\n\nimport Lib\nconstraint Heft<a> =\n    other(value: a) -> a\n" +
        "fun f<a: Heft>(x: Int): Int =\n    let g = (y: a) => Lib.use(y)\n    x\n" + KEEP],
    ])).toEqual([
      "`a` is a declared type variable, but this declaration's type does not mention it, so no call " +
        "can choose it or supply its evidence for this module's `Heft` and the `Heft` declared in module " +
        "`Lib`; remove `a` from the binder list and write a concrete type where the body names `a`",
    ]);
  });

  test("names a written constraint by the author's word, whether or not the body demanded more", () => {
    const files = (body: string) => [
      ["/lib.hex", HEFT_LIB],
      ["/main.hex",
        "module Main\n\nimport Lib\nfun f<a: Lib.Heft>(x: Int): Int =\n" +
        `    let g = (y: a) => ${body}\n    x\n` + KEEP],
    ] as const;
    const unmentioned = (evidence: string, widen: string) =>
      "`a` is a declared type variable, but this declaration's type does not mention it, so no call " +
        `can choose it or supply its ${evidence} evidence; use \`a\` in a parameter or result type${widen}, ` +
        "or remove `a` from the binder list and write a concrete type where the body names `a`";
    expect(graphDiagnostics(files("Lib.useHeft(y)"))).toEqual([unmentioned("`Lib.Heft`", "")]);
    expect(graphDiagnostics(files("show(y)")))
      .toEqual([unmentioned("`Lib.Heft`, `Show`", " and write `<a: (Lib.Heft, Show)>`")]);
  });
});

describe("route clauses over a whole list", () => {
  test("only the module the collision named drops its \"declared in\" half", () => {
    // The `Heft` report qualifies the required `Heft` by its module, so the
    // `Lib` route may elide what the sentence already said. The `Tally` route
    // rides the same list, and nothing in that sentence named its module.
    const files = (main: string) => [
      ["/lib.hex", HEFT_LIB],
      ["/mid.hex", HEFT_MID],
      ["/tally.hex", TALLY_LIB],
      ["/count.hex", TALLY_MID],
      ["/main.hex", "module Main\n\nimport Mid\nimport Count\n" + main + KEEP],
    ] as const;
    const local = "constraint Heft<a> =\n    other(value: a) -> a\n";
    const list = "`<a: (Heft, Lib.Heft, Tally.Tally)>`";
    const tally = "`Tally` is declared in module `Tally`; `import Tally` and spell it `Tally.Tally`";
    expect(graphDiagnostics(files(local + "let g<a: Heft>(x: a): a = Mid.useHeft(Count.useTally(x))\n")))
      .toEqual([
        "`a` is declared to honor this module's `Heft`, but the body requires the `Heft` declared " +
          `in module \`Lib\`; write ${list} — ${tally} — \`import Lib\` and spell it \`Lib.Heft\`, ` +
          "or remove the constraint annotation to let it be inferred",
        `\`a\` is declared to honor \`Heft\`, but the body requires \`Tally\`; write ${list} — ${tally} — ` +
          "`Heft` is declared in module `Lib`, and this module binds another `Heft`; " +
          "`import Lib` and spell it `Lib.Heft`, " +
          "or remove the constraint annotation to let it be inferred",
      ]);
    expect(graphDiagnostics(files(
      "import Lib\nimport Tally\n" + local +
        "let g<a: (Heft, Lib.Heft, Tally.Tally)>(x: a): a = Mid.useHeft(Count.useTally(x))\n",
    ))).toEqual([]);
  });
});
