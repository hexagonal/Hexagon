/**
 * Conformance for `ignore` — `stdlib/Prelude.hex`'s one-line discard idiom and
 * the position-sensitive erasure Statements §3.3 makes of its applied call
 * (#313).
 *
 * The defect this closes was the embarrassing kind: §3.2's discarded-value
 * diagnostic told the reader to "wrap it in `ignore(...)`", and no `ignore`
 * existed anywhere in the language, so the compiler's own fixit named a rewrite
 * it would then refuse. The ruling makes the binding **ordinary source** rather
 * than a door key (Constraints §6.1's strictly-simpler law), so most of what is
 * asserted below is that nothing special happens: the qualified home resolves,
 * the value reference is an ESM import, an occluding module keeps its own
 * function.
 *
 * What *is* special is the applied call's cost, and it is position-sensitive, so
 * the two positions are asserted separately and against each other:
 *
 * - **Discarding position** — its own JS statement — erases to the bare
 *   expression statement. Mandatory: the language's single sanctioned discard
 *   idiom must cost nothing.
 * - **Value position** — the `Unit` result is consumed — must evaluate the
 *   operand exactly once and answer `undefined`, **never the operand's value**.
 *   That is the failure mode a careless erasure produces, and it is silent, so
 *   every value-position assertion below reads the answer rather than the text.
 *
 * The operand's value is `17` throughout for exactly that reason: `undefined`
 * and `17` are distinguishable, where `undefined` and a `Unit`-valued operand
 * would not be.
 *
 * **Every graph below is made byte-distinct** through `distinct`. Emitted
 * modules mount as `data:` URLs and the registry caches those by their full
 * text, so two tests compiling the same program would share one instance — and
 * one probe collector, taken by whichever test ran first.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so each test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

/**
 * The sink `stdlib/Debug.hex`'s probe captures, reached off `globalThis` because
 * `lib` is `ES2024` and declares no console.
 */
const host = globalThis as unknown as {
  console: { log: (...values: unknown[]) => void };
};

/** What the probe wrote while `body` ran, with the global restored after. */
async function written(body: () => Promise<void>): Promise<unknown[]> {
  const lines: unknown[] = [];
  const original = host.console.log;
  host.console.log = (...values: unknown[]) => {
    lines.push(values[0]);
  };
  try {
    await body();
  } finally {
    host.console.log = original;
  }
  return lines;
}

/**
 * The effect every test below counts: one probe line per evaluation, answering a
 * value (`17`) that is not `Unit`, so "was the operand's value leaked?" and "how
 * many times did it run?" are both readable.
 */
const audit = 'let audit(label: String): Int =\n' +
  '    Debug.log(label)\n' +
  '    17\n';

/** `/main.hex`'s emitted JavaScript, with the project asserted clean. */
function emitted(source: string): string {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

/** Every diagnostic `/main.hex` produced, in order. */
function diagnostics(source: string): readonly string[] {
  return compileFiles([["/main.hex", "module Main\n\n" + source]]).diagnostics.map(({ message }) => message);
}

/**
 * Whether the text applies `ignore` to anything. The import line
 * `import { ignore } from "./Hex/Prelude.js";` is deliberately not matched: a value
 * reference is the ordinary ESM export and is never what erasure removes.
 */
function callsIgnore(javascript: string): boolean {
  return /\bignore\s*\(/u.test(javascript);
}

describe("the declaration (Statements §3.3)", () => {
  test("`ignore` is in bare scope with no import written", () => {
    expect(diagnostics(
      audit + 'export let go(): Int =\n    ignore(audit("scope"))\n    1\n',
    )).toEqual([]);
  });

  test("it is `a -> Unit`: any operand type, and the answer is `Unit`", () => {
    expect(diagnostics(
      'export let a: Unit = ignore(1)\n' +
      'export let b: Unit = ignore("text")\n' +
      'export let c: Unit = ignore((1, "text"))\n',
    )).toEqual([]);
  });
});

describe("discarding position erases (§3.3, mandatory)", () => {
  test("a non-final block item emits the bare expression statement", () => {
    const javascript = emitted(
      audit + 'export let prepare(): Int =\n    ignore(audit("statement"))\n    1\n',
    );
    // The whole statement, indent to semicolon: `void audit(…)` would satisfy a
    // `toContain` of the call alone, and `void` is the *value*-position spelling.
    expect(javascript).toContain('\n  audit("statement");\n');
    expect(javascript).not.toContain("void");
    expect(callsIgnore(javascript)).toBe(false);
    // The whole point of erasing: no import survives for a call that is gone.
    expect(javascript).not.toContain("./Prelude.js");
  });

  test("the operand runs exactly once, and the block goes on", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit + 'export let prepare(): Int =\n' +
          '    ignore(audit("erased-once"))\n' +
          '    1\n']],
        { transform: distinct("erased-once") },
      );
      expect((module["prepare"] as () => number)()).toBe(1);
    });
    expect(lines).toEqual(["erased-once"]);
  });

  test("`e |> ignore` erases like the direct spelling", () => {
    // Operators §8 desugars the pipe before inference, so the stage *is* the
    // applied call and needs no rule of its own. This is the assertion that it
    // really does arrive that way — ch.17's `item |> ignore` was #313's
    // discovery site.
    const javascript = emitted(
      audit + 'export let piped(): Int =\n    audit("piped") |> ignore\n    1\n',
    );
    expect(javascript).toContain('\n  audit("piped");\n');
    expect(javascript).not.toContain("void");
    expect(callsIgnore(javascript)).toBe(false);
  });

  test("the piped form runs its operand once", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit + 'export let piped(): Int =\n' +
          '    audit("piped-once") |> ignore\n' +
          '    1\n']],
        { transform: distinct("piped-once") },
      );
      expect((module["piped"] as () => number)()).toBe(1);
    });
    expect(lines).toEqual(["piped-once"]);
  });

  test("the erased operand inherits the position: a conditional stays a statement", () => {
    // The reason the erasure recurses into `#emitStatement` rather than pasting
    // `${operand};`: the operand takes the position the call vacated, so a
    // conditional lowers to `if`/`else` and not to a ternary.
    const javascript = emitted(
      audit + 'export let go(value: Int): Int =\n' +
      '    ignore(if value > 0 then audit("positive") else audit("other"))\n' +
      '    1\n',
    );
    expect(javascript).toContain("if (");
    expect(javascript).toContain("} else {");
    expect(javascript).not.toContain("?");
    expect(callsIgnore(javascript)).toBe(false);
  });

  test("a record operand is parenthesized, not read as a block", () => {
    // `{ x: 1 };` is a JavaScript *block* holding a labelled statement. Nothing
    // could put a record in statement position before #313, so this is the one
    // emission the erasure had to learn to parenthesize.
    const javascript = emitted(
      'record Point = {x: Int}\n' +
      'export let go(): Int =\n' +
      '    ignore(Point({x = 1}))\n' +
      '    1\n',
    );
    expect(javascript).toContain("\n  ({ x: 1 });\n");
    expect(javascript).not.toContain("void");
    expect(callsIgnore(javascript)).toBe(false);
  });

  test("an assignment operand loses the `void` an expression assignment carries", () => {
    // An assignment in *expression* position emits `void (count = 1)`, because
    // its own value is `Unit`. Erased into statement position it is the plain
    // assignment statement, which is what the operand inheriting the position
    // means concretely.
    const javascript = emitted(
      'export let go(): Int =\n' +
      '    var count: Int = 0\n' +
      '    ignore(count := 1)\n' +
      '    count\n',
    );
    expect(javascript).toContain("\n  count = 1;\n");
    expect(javascript).not.toContain("void");
    expect(callsIgnore(javascript)).toBe(false);
  });

  test("the record-operand program actually parses and runs", async () => {
    // **Two** fields, deliberately. Unparenthesized, `{ x: 2 }` is a block whose
    // one labelled statement happens to be legal JavaScript, so a one-field
    // record would load and quietly do the wrong thing; `{ x: 2, y: 3 }` is a
    // syntax error, and the module fails to load at all.
    const module = await runProject(
      [["/main.hex",
        "module Main\n\n" + 'record Point = {x: Int, y: Int}\n' +
        'export let go(): Int =\n' +
        '    ignore(Point({x = 2, y = 3}))\n' +
        '    9\n']],
      { transform: distinct("record-operand") },
    );
    expect((module["go"] as () => number)()).toBe(9);
  });
});

describe("value position yields `Unit`, never the operand (§3.3)", () => {
  test("`let u = ignore(e)` binds `Unit`, and `e` runs once", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit + 'export let bound(): Unit =\n' +
          '    let u: Unit = ignore(audit("bound"))\n' +
          '    u\n']],
        { transform: distinct("bound") },
      );
      // `17` here would be the erasure leaking the operand — the silent failure.
      expect((module["bound"] as () => unknown)()).toBeUndefined();
    });
    expect(lines).toEqual(["bound"]);
  });

  test("a block-final `ignore(e)` hands its caller `Unit`, not `e`", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit + 'let step(): Unit =\n' +
          '    Debug.log("step")\n' +
          '    ignore(audit("tail"))\n' +
          'export let consumed(): Unit = step()\n']],
        { transform: distinct("tail") },
      );
      expect((module["consumed"] as () => unknown)()).toBeUndefined();
    });
    expect(lines).toEqual(["step", "tail"]);
  });

  test("the emitted value form is `void`, and the operand survives it", () => {
    const javascript = emitted(
      audit + 'export let bound(): Unit =\n' +
      '    let u: Unit = ignore(audit("void"))\n' +
      '    u\n',
    );
    expect(javascript).toContain('void audit("void")');
  });

  test("the `Unit` that flows into an argument is `Unit`, not the operand", async () => {
    // The same claim as the binding above, one hop further out: value position
    // is wherever `#emitStatement` did not claim the call, and an argument list
    // is one of those places. `17` here is the leak.
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit + 'let passThrough(u: Unit): Unit = u\n' +
          'export let nested(): Unit = passThrough(ignore(audit("nested")))\n']],
        { transform: distinct("nested") },
      );
      expect((module["nested"] as () => unknown)()).toBeUndefined();
    });
    expect(lines).toEqual(["nested"]);
  });
});

describe("referenced as a value: the ordinary ESM export (§3.3)", () => {
  test("a higher-order call across a module boundary works", async () => {
    const module = await runProject(
      [
        ["/apply.hex",
          "module Apply\n\n" + "export let applyTo(value: Int, action: (Int) -> Unit): Unit = action(value)\n"],
        ["/main.hex",
          "module Main\n\n" + 'import Apply\n' +
          "export let handed(): Unit = Apply.applyTo(3, ignore)\n"],
      ],
      { transform: distinct("first-class") },
    );
    // A missing import line is a `ReferenceError` here, not a wrong answer:
    // erasure must not remove the reference that makes the export reachable.
    expect((module["handed"] as () => unknown)()).toBeUndefined();
  });

  test("the reference emits an import of the prelude module", () => {
    const javascript = emitted("export let f: (Int) -> Unit = ignore\n");
    expect(javascript).toContain('import { ignore } from "./Hex/Prelude.js";');
    expect(javascript).toContain("const f = ignore;");
  });
});

describe("the qualified home `Prelude.ignore` (Modules §6.4)", () => {
  test("it compiles, and erases exactly as the bare spelling does", () => {
    const javascript = emitted(
      audit + 'export let qualified(): Int =\n' +
      '    Prelude.ignore(audit("qualified"))\n' +
      '    1\n',
    );
    expect(javascript).toContain('\n  audit("qualified");\n');
    expect(javascript).not.toContain("void");
    expect(callsIgnore(javascript)).toBe(false);
  });

  test("it runs, and its operand runs once", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit + 'export let qualified(): Int =\n' +
          '    Prelude.ignore(audit("qualified-run"))\n' +
          '    5\n']],
        { transform: distinct("qualified-run") },
      );
      expect((module["qualified"] as () => number)()).toBe(5);
    });
    expect(lines).toEqual(["qualified-run"]);
  });

  test("the qualified value reference is the same ordinary export", () => {
    const javascript = emitted("export let f: (Int) -> Unit = Prelude.ignore\n");
    expect(javascript).toContain('import { ignore } from "./Hex/Prelude.js";');
  });
});

describe("occlusion: the erasure is keyed on the binding (Modules §5.4)", () => {
  test("a module's own `ignore` is called, not erased", () => {
    const javascript = emitted(
      audit +
      'export let ignore(value: Int): Unit =\n' +
      '    Debug.log("user ignore ran")\n' +
      'export let go(): Int =\n' +
      '    ignore(audit("occluded"))\n' +
      '    1\n',
    );
    expect(javascript).toContain('ignore(audit("occluded"));');
  });

  test("the user's body runs — the observation the emitted text cannot make", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit +
          'export let ignore(value: Int): Unit =\n' +
          '    Debug.log("user ignore ran")\n' +
          'export let go(): Int =\n' +
          '    ignore(audit("occluded-run"))\n' +
          '    1\n']],
        { transform: distinct("occluded-run") },
      );
      expect((module["go"] as () => number)()).toBe(1);
    });
    // Erasing here would drop the user's function body on the floor, and the
    // second line is the only witness.
    expect(lines).toEqual(["occluded-run", "user ignore ran"]);
  });

  test("an occluding module still reaches the prelude's version qualified", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [["/main.hex",
          "module Main\n\n" +
          audit +
          'export let ignore(value: Int): Unit =\n' +
          '    Debug.log("user ignore ran")\n' +
          'export let go(): Int =\n' +
          '    Prelude.ignore(audit("qualified-past-occlusion"))\n' +
          '    1\n']],
        { transform: distinct("qualified-past-occlusion") },
      );
      expect((module["go"] as () => number)()).toBe(1);
    });
    expect(lines).toEqual(["qualified-past-occlusion"]);
  });

  test("an occluding module's own calls are untouched across a boundary", async () => {
    const lines = await written(async () => {
      const module = await runProject(
        [
          ["/mine.hex",
            "module Mine\n\n" + 'export let ignore(value: Int): Unit =\n' +
            '    Debug.log("imported ignore ran")\n'],
          ["/main.hex",
            "module Main\n\n" +
            audit +
            'import Mine\n' +
            'export let go(): Int =\n' +
            '    Mine.ignore(audit("imported"))\n' +
            '    1\n'],
        ],
        { transform: distinct("imported-ignore") },
      );
      expect((module["go"] as () => number)()).toBe(1);
    });
    expect(lines).toEqual(["imported", "imported ignore ran"]);
  });
});

describe("§3.2's fixit now names a rewrite the language accepts (#313)", () => {
  test("the unwrapped discard still errors, with the same message", () => {
    expect(diagnostics(
      audit + 'export let prepare(): Int =\n    audit("bare")\n    1\n',
    )).toEqual([
      "this expression's value is discarded — its type is `Int`; " +
      "wrap it in `ignore(...)` if discarding is intentional",
    ]);
  });

  test("applying the fixit compiles — the headline defect", () => {
    // Before #313 this reported "unknown name `ignore`": the compiler suggested
    // a rewrite it then refused.
    expect(diagnostics(
      audit + 'export let prepare(): Int =\n    ignore(audit("fixed"))\n    1\n',
    )).toEqual([]);
  });

  test("the loop-body fixit compiles too", () => {
    // The second message naming `ignore(...)` (Loops), and ch.17's discovery
    // site: a loop body whose final expression produces a value.
    expect(diagnostics(
      audit + 'export let go(): Unit =\n' +
      '    for value in 1..3\n' +
      '        audit("loop")\n',
    )).toEqual([
      "the final expression of a loop body produces a value that is discarded " +
      "on every iteration; use `ignore(...)` if intended",
    ]);
    expect(diagnostics(
      audit + 'export let go(): Unit =\n' +
      '    for value in 1..3\n' +
      '        ignore(audit("loop"))\n',
    )).toEqual([]);
  });
});

describe("the book's `ignore` examples compile (ch.1, 3, 6, 7, 17)", () => {
  test("ch.1's deliberate discard", () => {
    expect(diagnostics(
      "export record Order = {total: Int}\n" +
      "export record AuditReport = {lines: Int}\n" +
      "let auditOrder(order: Order): AuditReport = AuditReport({lines = 1})\n" +
      "export let prepareOrder(order: Order): Order =\n" +
      "    ignore(auditOrder(order))\n" +
      '    Debug.log("Preparing order")\n' +
      "    order\n",
    )).toEqual([]);
  });

  test("ch.3's pipe spelling", () => {
    expect(diagnostics(
      "export record Order = {total: Int}\n" +
      "export record AuditReport = {lines: Int}\n" +
      "let auditOrder(order: Order): AuditReport = AuditReport({lines = 1})\n" +
      "export let prepareOrder(order: Order): Order =\n" +
      "    auditOrder(order) |> ignore\n" +
      "    order\n",
    )).toEqual([]);
  });

  test("ch.6's two-types example still fails for its own reason", () => {
    // The chapter's point is that `f` has one type per call. `ignore` must not
    // rescue it, and the diagnostic must not be about `ignore`.
    const messages = diagnostics(
      "export let useAtTwoTypes(f) =\n" +
      "    ignore(f(1))\n" +
      '    f("hello")\n',
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join("\n")).not.toContain("ignore");
  });

  test("ch.7's `ignore` versus `_` contrast", () => {
    expect(diagnostics(
      "export let go(reservation: (String, Int)): String =\n" +
      "    let (guest, _) = reservation\n" +
      "    ignore(reservation)\n" +
      "    guest\n",
    )).toEqual([]);
  });

  test("ch.17's loop example — #313's discovery site", () => {
    expect(diagnostics(
      "export let consume(source: Seq(a)): Unit =\n" +
      "    for item in source\n" +
      "        item |> ignore\n",
    )).toEqual([]);
  });
});
