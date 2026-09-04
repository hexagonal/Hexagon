import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for Pattern Matching §7.3's **constructor spelling** block
 * (#607): a witness is a pattern, so every constructor name in one prints in
 * the spelling the reporting module can lawfully write — and where no such
 * spelling exists, the message says where the constructor lives and names a
 * repair that works.
 *
 * Three tiers are judged per constructor *occurrence*, re-cut by #763 and
 * #762:
 *
 * 1. **bare**, the ordinary case and since the door nearly the whole of it —
 *    a spelling in scope that denotes this constructor, *or* a spelling scope
 *    has nothing for, which §2.2's door reaches from the expected type
 *    (#594/#600/#605's witness pins are the wall);
 * 2. **qualified**, where bare would be wrong — `Bool.True` past a local
 *    `True` that occludes the prelude's, `A.Off` past a local `Off` of this
 *    module's own;
 * 3. **bare with the route stated**, where neither exists — the taken-spelling
 *    case, whose route is the module import alone (#762), one clause per
 *    declaring module.
 *
 * The section's fourth clause is the **error-program obligation**, and it is
 * coverage behaviour rather than spelling: a pattern that failed to type must
 * not widen the witness's vocabulary, so it reads as `_` while its row's
 * well-typed columns stand as written. §7.2 takes the dual — a broken pattern
 * is never a shadower — which is the one part of the section whose correctness
 * is invisible in a well-typed program.
 */

/** Every diagnostic message a project produced, in order. */
function diagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** `union Flag = On | Off`, exported whole. */
const FLAGS = ["/flags.hex", "module Flags\n\n" + "export union Flag = On | Off\n"] as const;

/** Five constructors, so a report can list several and still have a tail. */
const WIDE = [
  "/flags.hex",
  "module Flags\n\n" + "export union Flag = On | Off | Dim | Warm | Cool\n",
] as const;

/** An opaque union abroad, with a maker and a pair-maker (#636's R2/R3 probes). */
const HANDLE = [
  "/h.hex",
  "module H\n\n" + "opaque union Handle = FileH(fd: Int) | NetH(sock: Int)\n" +
  "export let mkFile = (n: Int): Handle => FileH(n)\n" +
  "export let pair = (n: Int): (Handle, Bool) => (FileH(n), True)\n",
] as const;

describe("tier 1: the bare spelling, where it denotes this constructor", () => {
  test("an ordinary missing case is the bare declared name", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "module Main\n\n" + "export union Flag = On | Off\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Off`"]);
  });

  test("an imported union's constructor prints bare, which is what the door pastes", () => {
    // #763's widening of tier 1: nothing is in scope for `On`, and the door
    // reaches it from the scrutinee's type, so the barest spelling is the one
    // that works — and nothing about the witness changed byte for byte.
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags\n' +
        "export fun f(x: Flags.Flag): Int =\n" +
        "    match x\n" +
        "        Off => 0\n",
      ],
    ])).toEqual(["match is missing cases: `On`"]);
  });

  test("the printed spelling pastes", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags\n' +
        "export fun f(x: Flags.Flag): Int =\n" +
        "    match x\n" +
        "        Off => 0\n" +
        "        On => 1\n",
      ],
    ])).toEqual([]);
  });
});

describe("tier 2: the qualified spelling", () => {
  test("an occluded prelude constructor prints through its module's ambient name", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "module Main\n\n" + "union Flag = True | Maybe\n" +
        "export fun f(b: Bool): Int =\n" +
        "    match b\n" +
        "        False => 0\n",
      ],
    ])).toEqual(["match is missing cases: `Bool.True`"]);
  });

  test("and `Bool.True` pastes, which bare `True` did not", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "module Main\n\n" + "union Flag = True | Maybe\n" +
        "export fun f(b: Bool): Int =\n" +
        "    match b\n" +
        "        False => 0\n" +
        "        Bool.True => 1\n",
      ],
    ])).toEqual([]);
  });

  test("a spelling rule 3 answers for is taken, so a witness qualifies past it", () => {
    // §5.1 rule 3's fallback answers a bare spelling without *binding* it, so a
    // scope-derived table reads the word as free and offers it as pastable —
    // which it is not: bare `Box` under `import Box` means that
    // module's `Box`, not the constructor the witness is naming. The table
    // carries the fallback's answers, and tier 2 takes over.
    expect(diagnostics([
      ["/box.hex", "module Box\n\n" + "export union Box = Box(n: Int) | Lid\n"],
      ["/shapes.hex", "module Shapes\n\n" + "export union Shape = Box(n: Int) | Round\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Shapes\n' +
        'import Box\n' +
        "export fun f(s: Shapes.Shape): Int =\n" +
        "    match s\n" +
        "        Round => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Shapes.Box(_)`"]);
  });

  test("— and the control, with no rival alias, keeps the bare witness", () => {
    expect(diagnostics([
      ["/shapes.hex", "module Shapes\n\n" + "export union Shape = Box(n: Int) | Round\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Shapes\n' +
        "export fun f(s: Shapes.Shape): Int =\n" +
        "    match s\n" +
        "        Round => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Box(_)`"]);
  });

  test("a taken bare spelling prints through the alias that reaches the real one", () => {
    // Tier 2's surviving second case since the door: bare `Off` in this module
    // means the *local* union's constructor, so the witness would name the
    // wrong one — and an in-scope alias reaches the right one.
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as A\n' +
        "union Local = Off | Other\n" +
        "export fun f(x: A.Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual(["match is missing cases: `A.Off`"]);
  });

  test("and `A.Off` pastes, which bare `Off` would not", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as A\n' +
        "union Local = Off | Other\n" +
        "export fun f(x: A.Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        A.Off => 0\n",
      ],
    ])).toEqual([]);
  });
});

describe("the tiers reach the nominal record's constructor too", () => {
  const BOX = [
    "/h.hex",
    "module H\n\n" + "export record Box = {n: Int, m: Bool}\n" +
    "export let mk = (): Box => Box({n = 1, m = True})\n",
  ] as const;

  test("a record reached through an alias prints its witness bare, the door reaching it", () => {
    expect(diagnostics([
      BOX,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(b: H.Box): Int =\n" +
        "    match b\n" +
        "        H.Box({m = True}) => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Box({m = False})`"]);
  });

  test("and that spelling pastes — §2.2's door reaches a nominal record's constructor", () => {
    expect(diagnostics([
      BOX,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(b: H.Box): Int =\n" +
        "    match b\n" +
        "        H.Box({m = True}) => 1\n" +
        "        Box({m = False}) => 0\n",
      ],
    ])).toEqual([]);
  });

  test("a taken spelling sends the record's witness through the alias", () => {
    expect(diagnostics([
      BOX,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "record Box = {q: Int}\n" +
        "export fun f(b: H.Box): Int =\n" +
        "    match b\n" +
        "        H.Box({m = True}) => 1\n",
      ],
    ])).toEqual(["match is missing cases: `H.Box({m = False})`"]);
  });
});

describe("tier 3: the bare name with the route stated", () => {
  /**
   * The tier's one remaining shape since #763 and #762: a constructor the door
   * cannot reach because **this module binds another of its spelling**, and no
   * alias reaches the real one. The route is the module import alone — no
   * per-name import exists — and the witness pastes qualified through the alias
   * that edit binds.
   */
  const TAKEN = "union Local = Off | Other\n";

  test("a taken bare spelling routes through the module import", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as F\n' +
        TAKEN +
        "export fun f(x: F.Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        F.Off => 0\n" +
        "        Dummy => 2\n",
      ],
    ])[0]).toMatch(/no constructor `Dummy`/u);
    // The alias-less shape: nothing this module holds reaches `Off`.
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + "union Local = Off | Other\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])[0]).toMatch(/unknown type `Flag`/u);
  });

  test("the clause names the module import, and it compiles verbatim", () => {
    // The union arrives by an imported signature, so this module names no
    // alias for module `Flags` at all — and it binds another `Off`, so the door
    // does not open on the spelling.
    const files = (extra: string) => [
      FLAGS,
      ["/b.hex", "module B\n\n" + 'import Flags as F\nexport fun make(): F.Flag = F.On\n'],
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        TAKEN +
        extra +
        "export fun f(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n",
      ],
    ] as const;

    expect(diagnostics(files("") as never)).toEqual([
      "match is missing cases: `Off` — `Off` is declared in module `Flags`, and this " +
      "module binds another `Off`; `import Flags` and " +
      "spell it `Flags.Off`",
    ]);
    // The named edit, applied: the witness now pastes through the alias it
    // bound, which is the clause's own precondition.
    expect(diagnostics([
      FLAGS,
      ["/b.hex", "module B\n\n" + 'import Flags as F\nexport fun make(): F.Flag = F.On\n'],
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        TAKEN +
        'import Flags\n' +
        "export fun f(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n" +
        "        Flags.Off => 0\n",
      ],
    ])).toEqual([]);
  });

  test("the derived alias dodges a spelling already taken here", () => {
    expect(diagnostics([
      FLAGS,
      ["/b.hex", "module B\n\n" + 'import Flags as F\nexport fun make(): F.Flag = F.On\n'],
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "union Local = Off | Flags\n" +
        "export fun f(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off` — `Off` is declared in module `Flags`, and this " +
      "module binds another `Off`; `import Flags as Flags_1` and " +
      "spell it `Flags_1.Off`",
    ]);
  });

  test("a union reached only through an imported signature is spellable by the door (#605)", () => {
    // The signature route no longer needs a route clause at all: nothing in
    // this module binds either spelling, so the door reaches both.
    expect(diagnostics([
      FLAGS,
      ["/b.hex", "module B\n\n" + 'import Flags as F\nexport fun make(): F.Flag = F.On\n'],
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "export fun probe(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Off`"]);
    expect(diagnostics([
      FLAGS,
      ["/b.hex", "module B\n\n" + 'import Flags as F\nexport fun make(): F.Flag = F.On\n'],
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "export fun probe(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n" +
        "        Off => 0\n",
      ],
    ])).toEqual([]);
  });

  test("the shadowed-prelude corner has no import to name, so it names the shadowing", () => {
    expect(diagnostics([
      ["/bool.hex", "module Bool\n\n" + "export let x: Int = 1\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Bool\n' +
        "union Flag = True | Maybe\n" +
        "export fun f(b: Bool): Int =\n" +
        "    match b\n" +
        "        False => 0\n",
      ],
    ])).toEqual([
      "match is missing cases: `True` — `True` is declared in the prelude module " +
      "`Bool`, and this module's `Bool` alias shadows it; rename that alias to " +
      "spell it `Bool.True`",
    ]);
  });

  test("and the rename is the repair that works", () => {
    expect(diagnostics([
      ["/bool.hex", "module Bool\n\n" + "export let x: Int = 1\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Bool as Mine\n' +
        "union Flag = True | Maybe\n" +
        "export fun f(b: Bool): Int =\n" +
        "    match b\n" +
        "        False => 0\n" +
        "        Bool.True => 1\n",
      ],
    ])).toEqual([]);
  });
});

describe("aggregation: one clause per declaring module", () => {
  /** A module whose signature carries a union it does not re-export by name. */
  const WIDE_MAKER = [
    "/b.hex",
    "module B\n\n" + 'import Flags as F\nexport fun make(): F.Flag = F.On\n',
  ] as const;

  test("two unspellable names from one home share a clause", () => {
    expect(diagnostics([
      WIDE,
      WIDE_MAKER,
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "union Local = Off | Dim | Other\n" +
        "export fun f(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n" +
        "        Warm => 2\n" +
        "        Cool => 3\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off`, `Dim` — `Off` and `Dim` are declared in " +
      "module `Flags`, and this module binds another `Off` and another `Dim`; " +
      "`import Flags` and spell them `Flags.Off` and `Flags.Dim`",
    ]);
  });

  test("a name a shallower tier already spelled is not swept into the clause", () => {
    expect(diagnostics([
      WIDE,
      WIDE_MAKER,
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "union Local = Dim | Cool | Other\n" +
        "export fun f(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n" +
        "        Warm => 2\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off`, `Dim`, `Cool` — `Dim` and `Cool` are " +
      "declared in module `Flags`, and this module binds another `Dim` and another " +
      "`Cool`; `import Flags` and spell them `Flags.Dim` and " +
      "`Flags.Cool`",
    ]);
  });

  test("two homes in one witness draw two clauses", () => {
    // A row that wildcards the first column keeps the tail non-trivial, so the
    // shallowest witness names a constructor at *both* columns and each routes
    // to its own declaring module.
    expect(diagnostics([
      ["/a.hex", "module A\n\n" + "export union A = A1 | A2\n"],
      ["/b.hex", "module B\n\n" + "export union B = B1 | B2\n"],
      ["/mid.hex",
        "module Mid\n\n" + 'import A\nimport B\n' +
        "export fun x(): A.A = A.A1\nexport fun y(): B.B = B.B1\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Mid\n' +
        "union Local = A2 | B2\n" +
        "export fun f(): Int =\n" +
        "    match (Mid.x(), Mid.y())\n" +
        "        (A1, B1) => 1\n" +
        "        (_, B1) => 2\n",
      ],
    ])).toEqual([
      "match is missing cases: `(A2, B2)` — `A2` is declared in module `A`, and this " +
      "module binds another `A2`; `import A` and spell it `A.A2` — " +
      "`B2` is declared in module `B`, and this module binds another `B2`; " +
      "`import B` and spell it `B.B2`",
    ]);
  });

  test("two clauses, per-module name aggregation and the cap, together", () => {
    expect(diagnostics([
      WIDE,
      ["/other.hex", "module Other\n\n" + "export union G = G1 | G2\n"],
      ["/mid.hex",
        "module Mid\n\n" + 'import Flags as F\nimport Other as O\n' +
        "export fun x(): F.Flag = F.On\nexport fun y(): O.G = O.G1\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Mid\n' +
        "union Local = Off | Dim | Warm | G2\n" +
        "export fun f(): Int =\n" +
        "    match (Mid.x(), Mid.y())\n" +
        "        (On, G1) => 1\n" +
        "        (_, G1) => 2\n",
      ],
    ])).toEqual([
      "match is missing cases: `(Off, G2)`, `(Dim, G2)`, `(Warm, G2)` …and 1 " +
      "more — `Off`, `Dim` and `Warm` are declared in module `Flags`, and this " +
      "module binds another `Off`, another `Dim` and another `Warm`; " +
      "`import Flags` and spell them `Flags.Off`, `Flags.Dim` " +
      "and `Flags.Warm` — `G2` is declared in module `Other`, and this module binds " +
      "another `G2`; `import Other` and spell it `Other.G2`",
    ]);
  });

  test("the `…and N more` tail names no constructors, so it routes none", () => {
    expect(diagnostics([
      WIDE,
      WIDE_MAKER,
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "union Local = Off | Dim | Warm | Cool | Other\n" +
        "export fun f(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off`, `Dim`, `Warm` …and 1 more — `Off`, `Dim` " +
      "and `Warm` are declared in module `Flags`, and this module binds another " +
      "`Off`, another `Dim` and another `Warm`; `import Flags` " +
      "and spell them `Flags.Off`, `Flags.Dim` and `Flags.Warm`",
    ]);
  });
});

describe("the clause rides with the witness, not with one message", () => {
  test("the §5.3 `let` gate carries it", () => {
    expect(diagnostics([
      FLAGS,
      ["/b.hex", "module B\n\n" + 'import Flags as F\nexport fun make(): F.Flag = F.On\n'],
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "union Local = Off | Other\n" +
        "export fun f(): Int =\n" +
        "    let On = B.make()\n" +
        "    1\n",
      ],
    ])).toEqual([
      "this pattern can fail: `Off`; use `match` — `Off` is declared in " +
      "module `Flags`, and this module binds another `Off`; " +
      "`import Flags` and spell it `Flags.Off`",
    ]);
  });

  test("at a lambda parameter the clause stands before §6.7's own fixit", () => {
    expect(diagnostics([
      FLAGS,
      ["/b.hex",
        "module B\n\n" + 'import Flags as F\n' +
        "export type Flag = F.Flag\nexport fun make(): F.Flag = F.On\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import B\n' +
        "union Local = Off | Other\n" +
        "let g: (B.Flag) -> Int = (On) => 1\n" +
        "export let v: Int = g(B.make())\n",
      ],
    ])).toEqual([
      "this pattern can fail: `Off`; use `match` — `Off` is declared in " +
      "module `Flags`, and this module binds another `Off`; " +
      "`import Flags` and spell it `Flags.Off` — " +
      "for a match function, write `match` with arms",
    ]);
  });

  test("the gate takes the qualified spelling too", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "module Main\n\n" + "union Flag = True | Maybe\n" +
        "export fun f(b: Bool): Int =\n" +
        "    let False = b\n" +
        "    1\n",
      ],
    ])).toEqual(["this pattern can fail: `Bool.True`; use `match`"]);
  });
});

describe("the error-program obligation: a broken pattern must not widen the vocabulary", () => {
  test("an opaque union's constructors never enter a witness (#636 R2's blocker)", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(): Int =\n" +
        "    match H.mkFile(1)\n" +
        "        None => 1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Handle, found Option(a)",
    ]);
  });

  test("nor at the `let` gate", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(): Int =\n" +
        "    let None = H.mkFile(1)\n" +
        "    1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Handle, found Option(a)",
    ]);
  });

  test("nor at the `for..in` gate", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(): Int =\n" +
        "    for None in [H.mkFile(1)]\n" +
        "        ignore(1)\n" +
        "    1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Handle, found Option(a)",
    ]);
  });

  test("a literal arm is the same program (#636 R2's third shape)", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(): Int =\n" +
        "    match H.mkFile(1)\n" +
        "        0 => 1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Handle, found Int",
    ]);
  });

  test("only the broken column degrades; the row's well-typed columns stand", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(): Int =\n" +
        "    match H.pair(1)\n" +
        "        (None, True) => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `(_, False)`",
      "type mismatch: expected Handle, found Option(a)",
    ]);
  });

  test("the non-opaque half of the same path is cleared too", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as F\n' +
        "export fun f(x: F.Flag): Int =\n" +
        "    match x\n" +
        "        0 => 1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Flag, found Int",
    ]);
  });

  test("an arity-wrong arm takes its route clause with it", () => {
    // The coverage half of the same change, and the one program where it moves
    // a *route clause* off the output: at base this printed `match is missing
    // cases: `Off`` — under this PR's tiers, with the clause routing `Off` to
    // module `Flags` — beside the arity error. The broken arm now reads as `_`, so
    // `Flag` is covered under every repair and the deeper fault leads alone.
    // That is the block's named trade: coverage recomputes the moment the arity
    // is fixed.
    expect(diagnostics([
      ["/flags.hex", "module Flags\n\n" + "export union Flag = On(Int) | Off\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as F\n' +
        "export fun f(x: F.Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "constructor pattern `On` expects 1 arguments, got 0",
    ]);
  });

  test("the obligation never engages without a broken pattern", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "module Main\n\n" + "export fun f(n: Int): Int =\n" +
        "    match n\n" +
        "        0 => 1\n",
      ],
    ])).toEqual(["match is missing cases: `_`"]);
  });
});

describe("the obligation reaches the nominal record's constructor pattern too", () => {
  /** A foreign `Box`, so a local one can collide with it by spelling. */
  const FOREIGN_BOX = [
    "/h.hex",
    "module H\n\n" + "export record Box = {n: Int}\n" +
    "export let mk = (): Box => Box({n = 1})\n",
  ] as const;

  test("a local record constructor against a foreign one reports the fault alone", () => {
    // The double report the obligation was argued into the block to remove:
    // `match is missing cases: `Box(_)`` beside the arm's own error. Both walks
    // reach the record constructor through `#recordConstructorSlot`, so that is
    // where the verdict has to be taken.
    //
    // The arm's error is §12's rival-constructor sentence since #768 — the
    // same-name tell (`expected Box, found Box`) is exactly the report it
    // exists to replace. What this test pins is unchanged either way: **one**
    // report, and no witness beside it.
    expect(diagnostics([
      FOREIGN_BOX,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match H.mk()\n" +
        "        Box({n = 0}) => 1\n",
      ],
    ])).toEqual([
      "`Box` here is this module's `Box`; this pattern matches a `H.Box` — " +
        "write `H.Box({n = 0})`",
    ]);
  });

  test("and the §5.3 gate leaks nothing either", () => {
    expect(diagnostics([
      FOREIGN_BOX,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "record Local = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    let Local({n = q}) = H.mk()\n" +
        "    q\n",
      ],
    ])).toEqual(["type mismatch: expected Box, found Local"]);
  });
});

describe("§7.2 takes the dual: a broken pattern is never a shadower", () => {
  test("a broken arm above good arms kills nothing", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as F\n' +
        "export fun f(x: F.Flag): Int =\n" +
        "    match x\n" +
        "        0 => 1\n" +
        "        On => 2\n" +
        "        Off => 3\n",
      ],
    ])).toEqual(["type mismatch: expected Flag, found Int"]);
  });

  test("nor does a broken arm above a catch-all", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "module Main\n\n" + 'import H\n' +
        "export fun f(): Int =\n" +
        "    match H.mkFile(1)\n" +
        "        None => 1\n" +
        "        x => 2\n",
      ],
    ])).toEqual(["type mismatch: expected Handle, found Option(a)"]);
  });

  test("two broken arms report twice and nothing else", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as F\n' +
        "export fun f(x: F.Flag): Int =\n" +
        "    match x\n" +
        "        0 => 1\n" +
        "        1 => 2\n" +
        "        On => 3\n" +
        "        Off => 4\n",
      ],
    ])).toEqual([
      "type mismatch: expected Flag, found Int",
      "type mismatch: expected Flag, found Int",
    ]);
  });

  test("an arity-wrong pattern is not a shadower either", () => {
    // `On(3)` is not dead under *every* repair of `On` — repair it to `On(0)`
    // and `On(3)` is live — so §7.2's dual forbids the unreachable-arm error
    // this drew, whose fixit told the reader to delete a perfectly good arm.
    expect(diagnostics([
      [
        "/main.hex",
        "module Main\n\n" + "export union Flag = On(Int) | Off\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        On(3) => 2\n" +
        "        Off => 3\n",
      ],
    ])).toEqual([
      "constructor pattern `On` expects 1 arguments, got 0",
    ]);
  });

  test("and the `catch` seat's arity reads the same way", () => {
    // The same dual at the other arm seat, whose message differs: base drew
    // `exception `Bad` is already caught above` on an arm that is live under a
    // narrow repair of the one above it.
    expect(diagnostics([
      [
        "/main.hex",
        "module Main\n\n" + "exception Bad(Int)\n" +
        "export fun f(): Int =\n" +
        "    try 1\n" +
        "    catch\n" +
        "        Bad => 2\n" +
        "        Bad(n) => n\n",
      ],
    ])).toEqual([
      "exception pattern `Bad` expects 1 arguments, got 0",
    ]);
  });

  test("the control holds: a genuine catch-all still shadows a broken arm below", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "module Main\n\n" + 'import Flags as F\n' +
        "export fun f(x: F.Flag): Int =\n" +
        "    match x\n" +
        "        y => 2\n" +
        "        0 => 1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Flag, found Int",
      "this match arm is unreachable; an earlier pattern matches everything",
    ]);
  });
});
