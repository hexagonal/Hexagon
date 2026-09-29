import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for **a refused `->?` reads as its fixit** (Effects §4.4, #1145).
 *
 * A `->?` written where nothing is handed is refused at the arrow, and the
 * arrow then reads as what the fixit writes, unmarked: on a callback's own
 * arrow, that callback's colour; anywhere else, the impure constant. Nothing
 * downstream is suppressed or re-read, so every further report is one the
 * program with the fix applied also draws, and no verdict depends on the order
 * the refused arrow's uses come in.
 *
 * Each program below is checked twice — with the fixture's alias refused, and
 * with the fix applied — and the two must agree in everything but the one
 * refusal. The corpus is the one #1115's recovery was measured on; the recovery
 * itself is gone.
 */

const HEADER = "module Main\n\n";
const fixtures = (step: string): string =>
  'extern from "./world.js"\n    export fun save(document: String) ->! Unit\n' +
  `type Step = () ${step} Unit\n` +
  'let save0(): Unit = save!("x")\n' +
  "export let apply2(f: () ->! Unit, g: () ->! Unit): Unit =\n    f!()\n    g!()\n" +
  "export let pick(f: () ->! Unit): () ->? Unit = f\n";

const REFUSED = fixtures("->?");
const FIXED = fixtures("->!");

const files = (prefix: string, source: string): [string, string][] => [
  ["/main.hex", HEADER + prefix + source],
  ["/world.js", ""],
];

/** Each report as `[the text its primary spans, its message]`. */
function reports(prefix: string, source: string): readonly (readonly [string, string])[] {
  const text = HEADER + prefix + source;
  return compileFiles(files(prefix, source)).diagnostics.map(({ primary, message }) =>
    [text.slice(primary.start.offset, primary.end.offset), message] as const
  );
}

/** What a hover at the last place `needle` is written shows as the type there. */
function hovered(prefix: string, source: string, needle: string): string | undefined {
  const text = HEADER + prefix + source;
  const session = new AnalysisSession();
  session.setFile("/world.js", "");
  session.setFile("/main.hex", text);
  return session.hover("/main.hex", text.lastIndexOf(needle))?.displayedType;
}

/** §4.4's alias refusal — the fixture's `type Step`. */
const REFUSAL = [
  "->?",
  "`->?` means only as effectful as what it is handed, and nothing is handed here — " +
  "an alias is a type fragment, not a signature; " +
  "write `->!` for a function that may touch the world, or `->` for one that does not",
] as const;

/** The refused program draws the refusal and exactly what the fixed one draws. */
function readsAsFix(source: string, ...needles: string[]): void {
  expect(reports(REFUSED, source)).toEqual([REFUSAL, ...reports(FIXED, source)]);
  for (const needle of needles) {
    expect(hovered(REFUSED, source, needle), needle).toBe(hovered(FIXED, source, needle));
  }
}

describe("an annotation that wrote the refused arrow declares the name at its fixit", () => {
  test("a binding annotated with the refused alias", () => {
    const source = `export let outer(action: () ->! Unit): Unit =
    let s: Step = action
    s!()
`;
    readsAsFix(source, "s!()");
    expect(hovered(REFUSED, source, "s!()")).toBe("() ->! Unit");
  });

  test("one in an instance body, under a contract that follows its callbacks", () => {
    readsAsFix(`constraint Runner<r> =
    run(runner: r, action: () ->! Unit) ->? Unit

export record Job = { id: Int }

honor Runner<Job> =
    run(job, action) =
        let s: Step = action
        s!()
        action!()
`);
  });

  test("a return annotation, a block's final value, and an ascription", () => {
    readsAsFix(
      `export let outer(n: Int): Int =
    fun h(): Step = () => ()
    h()!()
    n
`,
      "h()!",
    );
    readsAsFix(`export let outer(n: Int): Int =
    let mk = (): Step => () => ()
    mk()!()
    n
`);
    readsAsFix(`export let outer(n: Int): Int =
    let h: Step =
        let x = 1
        () => ()
    h!()
    n
`);
    readsAsFix(
      `export let outer(n: Int): Int =
    let h = ((() => ()) : Step)
    h!()
    n
`,
      "h!()",
    );
  });

  test("the annotation over a real value's colour", () => {
    readsAsFix(`export let outer(n: Int): Unit =
    let s: Step = save0
    s()
`);
  });

  test("an arrow inside a written container, and an annotated `var`", () => {
    readsAsFix(
      `export let outer(action: () ->! Unit): Unit =
    let o: Option(Step) = Some(action)
    match o
        Some(g) => g!()
        None => ()
`,
      "o:",
    );
    readsAsFix(
      `export let outer(action: () ->! Unit): Unit =
    let p: (Step, Int) = (action, 1)
    ()
`,
      "p:",
    );
    readsAsFix(`export let outer(action: () ->! Unit): Unit =
    var r: Option(Step) = Some(action)
    match r
        Some(g) => g!()
        None => ()
`);
  });
});

describe("a parameter typed by the refused alias is the callback its fixit writes", () => {
  test.each([
    ["apply2(s, save0)", "apply2(save0, s)"],
    ['apply2(s, () => save!("y"))', 'apply2(() => save!("y"), s)'],
    ["apply2!(s, save0)", "apply2!(save0, s)"],
  ])("a call in either order: %s", (first, second) => {
    for (const call of [first, second]) {
      readsAsFix(`export let go(s: Step): Unit = ${call}\n`, "go(");
    }
  });

  test("a callback beside it, and the face published", () => {
    for (const call of ["apply2!(s, action)", "apply2!(action, s)"]) {
      readsAsFix(`export let outer(action: () ->! Unit, s: Step): Unit = ${call}\n`, "outer(");
    }
  });

  test.each([
    ["if True then s else save0", "if True then save0 else s"],
    ["match True\n        True => s\n        False => save0", "match True\n        True => save0\n        False => s"],
    ["try s catch\n        _ => save0", "try save0 catch\n        _ => s"],
  ])("a form's paths in either order: %s", (first, second) => {
    for (const form of [first, second]) {
      readsAsFix(`export let go(s: Step): Unit =
    let g = ${form}
    g!()
`);
    }
  });

  test("inside the containers a form joins, and among a vector literal's elements", () => {
    for (const form of ["if True then Some(s) else Some(save0)", "if True then Some(save0) else Some(s)"]) {
      readsAsFix(`export let go(s: Step): Unit =
    let o = ${form}
    match o
        Some(g) => g!()
        None => ()
`);
    }
    for (const elements of ["[s, save0]", "[save0, s]", '[() => s!(), () => save!("y")]']) {
      readsAsFix(`export let go(s: Step): Unit =
    match ${elements}
        [g, _] => g!()
        _ => ()
`);
    }
  });

  test("under written faces", () => {
    for (const form of ["if True then s else save0", "if True then save0 else s"]) {
      readsAsFix(`export let outer(action: () ->! Unit, s: Step): Unit =
    let g: () ->! Unit = ${form}
    action!()
`);
    }
    for (const elements of ["[s, save0]", "[save0, s]", "[s, () => ()]"]) {
      readsAsFix(`export let outer(action: () ->! Unit, s: Step): Unit =
    let v: Vector(() ->! Unit) = ${elements}
    action!()
`);
    }
  });

  test("through a knot, a module-level binding, and a later use", () => {
    readsAsFix(
      `fun
    a(s: Step, m: Int): Unit = if m == 0 then apply2!(s, s) else b!(s, m)
    b(s: Step, m: Int): Unit = a!(s, m - 1)
`,
      "b(s",
    );
    readsAsFix(`let sTop: Step = save0
let r = apply2!(sTop, sTop)
`);
    readsAsFix(
      `export let go(s: Step): Unit =
    let k = pick(s)
    k!()
`,
      "k!()",
    );
  });

  test("a body's own colour, whichever call comes first", () => {
    for (const body of ['s!()\n        save!("x")', 'save!("x")\n        s!()']) {
      readsAsFix(
        `export let outer(s: Step): Unit =
    let f = () =>
        ${body}
    f!()
`,
        "f!()",
      );
    }
  });
});
