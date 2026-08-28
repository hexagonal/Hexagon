import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for Pattern Matching §7.3's **constructor spelling** block
 * (#607): a witness is a pattern, so every constructor name in one prints in
 * the spelling the reporting module can lawfully write — and where no such
 * spelling exists, the message says where the constructor lives and names a
 * repair that works.
 *
 * Three tiers are judged per constructor *occurrence*:
 *
 * 1. **bare**, the ordinary case, byte-identical to what the reporter said
 *    before this rule (the #594/#600/#605 witness pins are the wall);
 * 2. **qualified**, where bare would be wrong or absent — `Bool.True` past a
 *    local `True` that occludes the prelude's, `A.Off` through a module alias;
 * 3. **bare with the route stated**, where neither exists — one clause per
 *    declaring module, the exported inventory choosing between the named
 *    import and the module import.
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
const FLAGS = ["/flags.hex", "export union Flag = On | Off\n"] as const;

/** Five constructors, so a report can list several and still have a tail. */
const WIDE = [
  "/flags.hex",
  "export union Flag = On | Off | Dim | Warm | Cool\n",
] as const;

/** An opaque union abroad, with a maker and a pair-maker (#636's R2/R3 probes). */
const HANDLE = [
  "/h.hex",
  "opaque union Handle = FileH(fd: Int) | NetH(sock: Int)\n" +
  "export let mkFile = (n: Int): Handle => FileH(n)\n" +
  "export let pair = (n: Int): (Handle, Bool) => (FileH(n), True)\n",
] as const;

describe("tier 1: the bare spelling, where it denotes this constructor", () => {
  test("an ordinary missing case is the bare declared name", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "export union Flag = On | Off\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Off`"]);
  });

  test("a renamed import prints the name the import bound, which is what pastes", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On as Yes, Off } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        Off => 0\n",
      ],
    ])).toEqual(["match is missing cases: `Yes`"]);
  });

  test("the printed spelling pastes", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On as Yes, Off } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        Off => 0\n" +
        "        Yes => 1\n",
      ],
    ])).toEqual([]);
  });
});

describe("tier 2: the qualified spelling", () => {
  test("an occluded prelude constructor prints through its module's ambient name", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "union Flag = True | Maybe\n" +
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
        "union Flag = True | Maybe\n" +
        "export fun f(b: Bool): Int =\n" +
        "    match b\n" +
        "        False => 0\n" +
        "        Bool.True => 1\n",
      ],
    ])).toEqual([]);
  });

  test("a constructor reached through a module alias prints through the alias", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import module A from \"./flags\"\n" +
        "export fun f(x: A.Flag): Int =\n" +
        "    match x\n" +
        "        A.On => 1\n",
      ],
    ])).toEqual(["match is missing cases: `A.Off`"]);
  });

  test("and `A.Off` pastes", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import module A from \"./flags\"\n" +
        "export fun f(x: A.Flag): Int =\n" +
        "    match x\n" +
        "        A.On => 1\n" +
        "        A.Off => 0\n",
      ],
    ])).toEqual([]);
  });
});

describe("the tiers reach the nominal record's constructor too", () => {
  const BOX = [
    "/h.hex",
    "export record Box = {n: Int, m: Bool}\n" +
    "export let mk = (): Box => Box({n = 1, m = True})\n",
  ] as const;

  test("a record reached through an alias prints its witness through the alias", () => {
    expect(diagnostics([
      BOX,
      [
        "/main.hex",
        "import module H from \"./h\"\n" +
        "export fun f(b: H.Box): Int =\n" +
        "    match b\n" +
        "        H.Box({m = True}) => 1\n",
      ],
    ])).toEqual(["match is missing cases: `H.Box({m = False})`"]);
  });

  test("and that spelling pastes, which the bare one would not", () => {
    expect(diagnostics([
      BOX,
      [
        "/main.hex",
        "import module H from \"./h\"\n" +
        "export fun f(b: H.Box): Int =\n" +
        "    match b\n" +
        "        H.Box({m = True}) => 1\n" +
        "        H.Box({m = False}) => 0\n",
      ],
    ])).toEqual([]);
  });
});

describe("tier 3: the bare name with the route stated", () => {
  test("a partially imported union routes through the named import", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off` — `Off` is declared in `./flags`; " +
      "`import { Off } from \"./flags\"` to spell it here",
    ]);
  });

  test("and the named import the clause prints is accepted", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On } from \"./flags\"\n" +
        "import { Off } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        Off => 0\n",
      ],
    ])).toEqual([]);
  });

  test("a taken bare spelling routes through the module import instead", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On } from \"./flags\"\n" +
        "union Local = Off | Other\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off` — `Off` is declared in `./flags`, and this " +
      "module binds another `Off`; `import module Flags from \"./flags\"` and " +
      "spell it `Flags.Off`",
    ]);
  });

  test("and that repair compiles verbatim, where the named import would not", () => {
    const taken = "import { Flag, On } from \"./flags\"\nunion Local = Off | Other\n";
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        `${taken}import module Flags from "./flags"\n` +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        Flags.Off => 0\n",
      ],
    ])).toEqual([]);
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        `${taken}import { Off } from "./flags"\n` +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        Off => 0\n",
      ],
    ])[0]).toMatch(/already bound/u);
  });

  test("the derived alias dodges a spelling already taken here", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On } from \"./flags\"\n" +
        "union Local = Off | Flags\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off` — `Off` is declared in `./flags`, and this " +
      "module binds another `Off`; `import module Flags_1 from \"./flags\"` and " +
      "spell it `Flags_1.Off`",
    ]);
  });

  test("a union reached only through an imported signature routes the same way (#605)", () => {
    expect(diagnostics([
      FLAGS,
      ["/b.hex", "import { Flag, On } from \"./flags\"\nexport fun make(): Flag = On\n"],
      [
        "/main.hex",
        "import { make } from \"./b\"\n" +
        "export fun probe(): Int =\n" +
        "    match make()\n" +
        "        _ => 1\n" +
        "        _ => 2\n",
      ],
    ])[0]).toMatch(/unreachable/u);
    expect(diagnostics([
      FLAGS,
      ["/b.hex", "import { Flag, On } from \"./flags\"\nexport fun make(): Flag = On\n"],
      [
        "/main.hex",
        "import { make } from \"./b\"\n" +
        "export fun probe(): Bool =\n" +
        "    match make()\n" +
        "        x => True\n",
      ],
    ])).toEqual([]);
  });

  test("the shadowed-prelude corner has no import to name, so it names the shadowing", () => {
    expect(diagnostics([
      ["/bool.hex", "export let x: Int = 1\n"],
      [
        "/main.hex",
        "import module Bool from \"./bool\"\n" +
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
      ["/bool.hex", "export let x: Int = 1\n"],
      [
        "/main.hex",
        "import module Mine from \"./bool\"\n" +
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
  test("two unspellable names from one home share a clause", () => {
    expect(diagnostics([
      WIDE,
      [
        "/main.hex",
        "import { Flag, On, Warm, Cool } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        Warm => 2\n" +
        "        Cool => 3\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off`, `Dim` — `Off` and `Dim` are declared in " +
      "`./flags`; `import { Off, Dim } from \"./flags\"` to spell them here",
    ]);
  });

  test("a name a shallower tier already spelled is not swept into the clause", () => {
    expect(diagnostics([
      WIDE,
      [
        "/main.hex",
        "import { Flag, On, Off, Warm } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n" +
        "        Warm => 2\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off`, `Dim`, `Cool` — `Dim` and `Cool` are " +
      "declared in `./flags`; `import { Dim, Cool } from \"./flags\"` to spell " +
      "them here",
    ]);
  });

  test("the `…and N more` tail names no constructors, so it routes none", () => {
    expect(diagnostics([
      WIDE,
      [
        "/main.hex",
        "import { Flag, On } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off`, `Dim`, `Warm` …and 1 more — `Off`, `Dim` " +
      "and `Warm` are declared in `./flags`; " +
      "`import { Off, Dim, Warm } from \"./flags\"` to spell them here",
    ]);
  });
});

describe("the clause rides with the witness, not with one message", () => {
  test("the §5.3 `let` gate carries it", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    let On = x\n" +
        "    1\n",
      ],
    ])).toEqual([
      "this pattern can fail: `Off`; use `match` — `Off` is declared in " +
      "`./flags`; `import { Off } from \"./flags\"` to spell it here",
    ]);
  });

  test("at a lambda parameter the clause stands before §6.7's own fixit", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On } from \"./flags\"\n" +
        "let g: (Flag) -> Int = (On) => 1\n" +
        "export let v: Int = g(On)\n",
      ],
    ])).toEqual([
      "this pattern can fail: `Off`; use `match` — `Off` is declared in " +
      "`./flags`; `import { Off } from \"./flags\"` to spell it here — " +
      "for a match function, write `match` with arms",
    ]);
  });

  test("the gate takes the qualified spelling too", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "union Flag = True | Maybe\n" +
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
        "import { mkFile } from \"./h\"\n" +
        "export fun f(): Int =\n" +
        "    match mkFile(1)\n" +
        "        None => 1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Handle, found Option(?443)",
    ]);
  });

  test("nor at the `let` gate", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "import { mkFile } from \"./h\"\n" +
        "export fun f(): Int =\n" +
        "    let None = mkFile(1)\n" +
        "    1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Handle, found Option(?442)",
    ]);
  });

  test("nor at the `for..in` gate", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "import { mkFile } from \"./h\"\n" +
        "export fun f(): Int =\n" +
        "    for None in [mkFile(1)]\n" +
        "        ignore(1)\n" +
        "    1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Handle, found Option(?443)",
    ]);
  });

  test("a literal arm is the same program (#636 R2's third shape)", () => {
    expect(diagnostics([
      HANDLE,
      [
        "/main.hex",
        "import { mkFile } from \"./h\"\n" +
        "export fun f(): Int =\n" +
        "    match mkFile(1)\n" +
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
        "import { pair } from \"./h\"\n" +
        "export fun f(): Int =\n" +
        "    match pair(1)\n" +
        "        (None, True) => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `(_, False)`",
      "type mismatch: expected Handle, found Option(?445)",
    ]);
  });

  test("the non-opaque half of the same path is cleared too", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
        "    match x\n" +
        "        0 => 1\n",
      ],
    ])).toEqual([
      "type mismatch: expected Flag, found Int",
    ]);
  });

  test("the obligation never engages without a broken pattern", () => {
    expect(diagnostics([
      [
        "/main.hex",
        "export fun f(n: Int): Int =\n" +
        "    match n\n" +
        "        0 => 1\n",
      ],
    ])).toEqual(["match is missing cases: `_`"]);
  });
});

describe("§7.2 takes the dual: a broken pattern is never a shadower", () => {
  test("a broken arm above good arms kills nothing", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On, Off } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
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
        "import { mkFile } from \"./h\"\n" +
        "export fun f(): Int =\n" +
        "    match mkFile(1)\n" +
        "        None => 1\n" +
        "        x => 2\n",
      ],
    ])).toEqual(["type mismatch: expected Handle, found Option(?443)"]);
  });

  test("two broken arms report twice and nothing else", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On, Off } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
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

  test("the control holds: a genuine catch-all still shadows a broken arm below", () => {
    expect(diagnostics([
      FLAGS,
      [
        "/main.hex",
        "import { Flag, On, Off } from \"./flags\"\n" +
        "export fun f(x: Flag): Int =\n" +
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
