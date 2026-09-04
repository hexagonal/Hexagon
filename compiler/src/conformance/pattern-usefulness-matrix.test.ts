import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **Pattern Matching §7's usefulness matrix** — the one
 * algorithm §5.1 and §7 both name, and #594's repair.
 *
 * "The algorithm is Maranget-style usefulness checking (the standard matrix
 * construction); implement it once and derive all three judgments from it:
 * exhaustiveness (is `_` useful after all arms?), reachability (is arm *k*
 * useful after arms 1..k−1?), irrefutability (is the single-row matrix
 * exhaustive? — §5.1)."
 *
 * What stood before was three approximations that consulted a union's
 * constructor set and nothing else: a record's field space never decomposed, a
 * structural scrutinee was made to write a catch-all outright, and a
 * constructor's slot was read off the *declaration*, where a generic slot is a
 * bare variable carrying no shape. The two halves are one missing consultation,
 * which is why #594 filed them together.
 *
 * The flips run in both directions and both are the ruling's:
 *
 * - Programs the old checker refused are exhaustive and now compile — every
 *   finite-shape domain "and tuples/records thereof" is checked exactly (§7.1).
 * - Programs it accepted carry dead arms and are now hard errors (§7.2),
 *   including catch-alls the old checker itself demanded.
 */

const BOOL_RECORD = "export record R = {b: Bool}\n";

describe("finite shapes are checked exactly (§7.1)", () => {
  test("a nominal record's field space decomposes", () => {
    expect(projectDiagnostics(
      BOOL_RECORD +
      "export fun pick(r: R): Int =\n" +
      "    match r\n" +
      "        R({b = True}) => 1\n" +
      "        R({b = False}) => 0\n",
    )).toEqual([]);
  });

  test("a structural record's field space decomposes", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(r: {b: Bool}): Int =\n" +
      "    match r\n" +
      "        {b = True} => 1\n" +
      "        {b = False} => 0\n",
    )).toEqual([]);
  });

  test("a tuple's components combine, exactly and at every depth", async () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun corner(p: (Bool, Bool)): Int =\n" +
      "    match p\n" +
      "        (True, True) => 3\n" +
      "        (True, False) => 2\n" +
      "        (False, True) => 1\n" +
      "        (False, False) => 0\n",
    )).toEqual([]);

    // The coarser split covers just as exactly: the second component is `_` in
    // both arms, so the matrix never has to look at it.
    expect(projectDiagnostics("module Main\n\n" + "export fun left(p: (Bool, Bool)): Int =\n" +
      "    match p\n" +
      "        (True, _) => 1\n" +
      "        (False, _) => 0\n",
    )).toEqual([]);

    // And the acceptance runs: the emitter's chain closes on the unreachable
    // fallthrough it has always closed on, so an exhaustive match with no
    // catch-all answers every input.
    const exports = await runMain("module Main\n\n" + "fun corner(p: (Bool, Bool)): Int =\n" +
      "    match p\n" +
      "        (True, True) => 3\n" +
      "        (True, False) => 2\n" +
      "        (False, True) => 1\n" +
      "        (False, False) => 0\n" +
      "export let tt: Int = corner((True, True))\n" +
      "export let tf: Int = corner((True, False))\n" +
      "export let ft: Int = corner((False, True))\n" +
      "export let ff: Int = corner((False, False))\n",
    );
    expect([exports.tt, exports.tf, exports.ft, exports.ff]).toEqual([3, 2, 1, 0]);
  });

  test("a constructor's slot is read instantiated, not declared (#594's second half)", async () => {
    // `Some(value: a)` declares its slot as the union's own parameter. Read off
    // the declaration it is a bare variable carrying no shape, and every
    // sub-pattern under it decomposed nothing; instantiated at the scrutinee it
    // is `Bool`, and `True`/`False` cover it between them.
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(o: Option(Bool)): Int =\n" +
      "    match o\n" +
      "        Some(True) => 1\n" +
      "        Some(False) => 0\n" +
      "        None => -1\n",
    )).toEqual([]);

    const exports = await runMain("module Main\n\n" + "fun pick(o: Option(Bool)): Int =\n" +
      "    match o\n" +
      "        Some(True) => 1\n" +
      "        Some(False) => 0\n" +
      "        None => -1\n" +
      "export let yes: Int = pick(Some(True))\n" +
      "export let no: Int = pick(Some(False))\n" +
      "export let absent: Int = pick(None)\n",
    );
    expect([exports.yes, exports.no, exports.absent]).toEqual([1, 0, -1]);
  });

  test("a sole-constructor newtype under a generic slot covers, in both spellings", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union UserId = UserId(Int)\n" +
      "export fun pick(o: Option(UserId)): Int =\n" +
      "    match o\n" +
      "        Some(UserId(n)) => n\n" +
      "        None => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export record Crate = {n: Int}\n" +
      "export fun pick(o: Option(Crate)): Int =\n" +
      "    match o\n" +
      "        Some(Crate({n})) => n\n" +
      "        None => 0\n",
    )).toEqual([]);
  });

  test("the decomposition nests: a record inside a union inside a union", () => {
    expect(projectDiagnostics(
      BOOL_RECORD +
      "export union V = V(R)\n" +
      "export fun pick(v: V): Int =\n" +
      "    match v\n" +
      "        V(R({b = True})) => 1\n" +
      "        V(R({b = False})) => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export union P = P((Bool, Bool))\n" +
      "export fun pick(p: P): Int =\n" +
      "    match p\n" +
      "        P((True, True)) => 3\n" +
      "        P((True, False)) => 2\n" +
      "        P((False, True)) => 1\n" +
      "        P((False, False)) => 0\n",
    )).toEqual([]);
  });

  test("multi-slot constructors combine across arms, at any arity", () => {
    // The retired rule completed a constructor only at arity one, by folding its
    // sub-patterns into a synthesized or-pattern. The matrix has no arity in it.
    expect(projectDiagnostics("module Main\n\n" + "export union T = T(Bool, Bool)\n" +
      "export fun pick(t: T): Int =\n" +
      "    match t\n" +
      "        T(True, True) => 3\n" +
      "        T(True, False) => 2\n" +
      "        T(False, True) => 1\n" +
      "        T(False, False) => 0\n",
    )).toEqual([]);
  });

  test("record coverage is over the mentioned fields, unioned across arms (§7.1)", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(r: {a: Bool, b: Bool}): Int =\n" +
      "    match r\n" +
      "        {a = True} => 2\n" +
      "        {a = False, b = True} => 1\n" +
      "        {a = False, b = False} => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export fun pick(r: {a: Bool, b: Bool}): Int =\n" +
      "    match r\n" +
      "        {a = True} => 2\n" +
      "        {b = True} => 1\n",
    )).toEqual(["match is missing cases: `{a = False, b = False}`"]);
  });
});

describe("dead arms are hard errors, including ones the old checker demanded (§7.2)", () => {
  test("a duplicate sub-pattern under one constructor is unreachable", () => {
    // The two-arm form was always exhaustive — a single-constructor union whose
    // slot is `Bool` is the one shape the old rule *could* complete, by folding
    // the sub-patterns into a synthesized or-pattern. It still is.
    expect(projectDiagnostics("module Main\n\n" + "export union W = W(Bool)\n" +
      "export fun pick(w: W): Int =\n" +
      "    match w\n" +
      "        W(True) => 1\n" +
      "        W(False) => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export union W = W(Bool)\n" +
      "export fun pick(w: W): Int =\n" +
      "    match w\n" +
      "        W(True) => 1\n" +
      "        W(True) => 2\n" +
      "        W(False) => 0\n",
    )).toEqual(["this case is unreachable; the patterns above already cover it"]);
  });

  test("a catch-all behind arms that now exhaust the domain is unreachable", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun corner(p: (Bool, Bool)): Int =\n" +
      "    match p\n" +
      "        (True, True) => 3\n" +
      "        (True, False) => 2\n" +
      "        (False, True) => 1\n" +
      "        (False, False) => 0\n" +
      "        _ => -1\n",
    )).toEqual(["this case is unreachable; the patterns above already cover it"]);
  });

  test("a constructor handled above in full is named", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(_) => 1\n" +
      "        Some(x) => x\n" +
      "        None => 0\n",
    )).toEqual(["this case is unreachable; `Some` is already handled above"]);
  });

  test("anything behind an arm that covers everything is unreachable", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        _ => 1\n" +
      "        None => 0\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("a duplicate literal is unreachable; literals never complete their domain", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun name(n: Int): String =\n" +
      "    match n\n" +
      "        0 => \"none\"\n" +
      "        0 => \"zero\"\n" +
      "        _ => \"many\"\n",
    )).toEqual(["this literal case is unreachable; it is already handled above"]);

    expect(projectDiagnostics("module Main\n\n" + "export fun name(n: Int): String =\n" +
      "    match n\n" +
      "        0 => \"none\"\n" +
      "        1 => \"one\"\n",
    )).toEqual(["match is missing cases: `_`"]);

    expect(projectDiagnostics("module Main\n\n" + "export fun name(s: String): Int =\n" +
      "    match s\n" +
      "        \"yes\" => 1\n",
    )).toEqual(["match is missing cases: `_`"]);
  });
});

describe("guards contribute nothing, and are not subsumed by each other (§7.1, §7.2)", () => {
  test("a guarded arm covers nothing — `when True` included", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(b: Bool): Int =\n" +
      "    match b\n" +
      "        True => 1\n" +
      "        False when True => 0\n",
    )).toEqual(["match is missing cases: `False`"]);
  });

  test("two arms with the same pattern and different guards are both reachable", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(n: Int): Int =\n" +
      "    match n\n" +
      "        v when v > 0 => 1\n" +
      "        v when v < 0 => -1\n" +
      "        _ => 0\n",
    )).toEqual([]);
  });

  test("a guarded arm fully covered by an earlier unguarded one is unreachable", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(_) => 1\n" +
      "        Some(x) when x > 0 => x\n" +
      "        None => 0\n",
    )).toEqual(["this case is unreachable; `Some` is already handled above"]);
  });
});

describe("§7.3's witnesses", () => {
  test("a constructor's slots render as `_`, and a nullary renders bare", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union Tree = Leaf | Node(Tree, Int, Tree)\n" +
      "export fun size(t: Tree): Int =\n" +
      "    match t\n" +
      "        Leaf => 0\n",
    )).toEqual(["match is missing cases: `Node(_, _, _)`"]);

    expect(projectDiagnostics("module Main\n\n" + "export fun pick(b: Bool): Int =\n" +
      "    match b\n" +
      "        True => 1\n",
    )).toEqual(["match is missing cases: `False`"]);
  });

  test("a tuple renders with `_` holes", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(p: (Option(Int), Int)): Int =\n" +
      "    match p\n" +
      "        (Some(x), _) => x\n",
    )).toEqual(["match is missing cases: `(None, _)`"]);
  });

  test("a record renders only the discriminating fields, never invented mentions", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union Status = Queued | Running | Done\n" +
      "export fun pick(r: {status: Status, id: Int}): Int =\n" +
      "    match r\n" +
      "        {status = Running} => 1\n" +
      "        {status = Done} => 2\n",
    )).toEqual(["match is missing cases: `{status = Queued}`"]);
  });

  test("the list is capped at three, then counted", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union Six = A | B | C | D | E | F\n" +
      "export fun pick(s: Six): Int =\n" +
      "    match s\n" +
      "        A => 0\n",
    )).toEqual(["match is missing cases: `B`, `C`, `D` …and 2 more"]);
  });

  test("`_` where any value works — the shallowest genuinely missing witness", () => {
    // No unguarded arm has split the domain, so nothing deeper than `_` is true
    // of the uncovered values: every value is one.
    expect(projectDiagnostics("module Main\n\n" + "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(x) when x > 0 => x\n",
    )).toEqual(["match is missing cases: `_`"]);
  });
});

describe("§5.1's gate is the single-row matrix, and §5.3 is its one sentence", () => {
  test("a sole-constructor chain destructures at any depth, through generic slots", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union UserId = UserId(Int)\n" +
      "export union Box(a) = Box(a)\n" +
      "export record Crate = {n: Int}\n" +
      "export fun total(id: UserId, b: Box(UserId), c: Box(Crate)): Int =\n" +
      "    let UserId(n) = id\n" +
      "    let Box(UserId(m)) = b\n" +
      "    let Box(Crate({n = k})) = c\n" +
      "    n + m + k\n",
    )).toEqual([]);
  });

  test("a refutable pattern names its counterexample, at every gated seat", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun get(o: Option(Int)): Int =\n" +
      "    let Some(n) = o\n" +
      "    n\n",
    )).toEqual(["this pattern can fail: `None`; use `match`"]);

    expect(projectDiagnostics("module Main\n\n" + "export union Box(a) = Box(a)\n" +
      "export fun get(b: Box(Option(Int))): Int =\n" +
      "    let Box(Some(n)) = b\n" +
      "    n\n",
    )).toEqual(["this pattern can fail: `Box(None)`; use `match`"]);

    expect(projectDiagnostics("module Main\n\n" + "export union Box(a) = Box(a)\n" +
      "export fun get(b: Box(Int)): Int =\n" +
      "    let Box(0) = b\n" +
      "    1\n",
    )).toEqual(["this pattern can fail: `Box(_)`; use `match`"]);

    // The loop seat and the lambda seat draw the same sentence, the lambda's
    // with §6.7's fixit.
    expect(projectDiagnostics("module Main\n\n" + "export fun count(xs: Vector(Option(Int))): Int =\n" +
      "    var total = 0\n" +
      "    for Some(n) in xs\n" +
      "        total := total + n\n" +
      "    total\n",
    )).toEqual(["this pattern can fail: `None`; use `match`"]);

    expect(projectDiagnostics("module Main\n\n" + "let unwrap: (Option(Int)) -> Int = Some(n) => n\n" +
      "export let v: Int = unwrap(Some(1))\n",
    )).toEqual([
      "this pattern can fail: `None`; use `match` — for a match function, write `match` with arms",
    ]);
  });

  test("or-pattern coverage decides, not syntax (§5.1's `True | False` row)", async () => {
    const exports = await runMain("module Main\n\n" + "let True | False = True\n" +
      "let flip: (Bool) -> Int = (True | False) => 1\n" +
      "export let v: Int = flip(True)\n",
    );
    expect(exports.v).toBe(1);

    expect(projectDiagnostics("module Main\n\n" + "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(_) | None => 1\n",
    )).toEqual([]);
  });
});

/**
 * Collections Part 3 §3.3, joined to the matrix at #600: "vector patterns
 * partition by length (the Rust slice-pattern treatment), integrated into the
 * one Pattern Matching §7 algorithm — no second machinery".
 *
 * The machinery it replaces partitioned by length and stopped there: it read
 * every arm's slot count, never its element sub-patterns, and so blessed
 * `[True, ...rest]` + `[]` over `Vector(Bool)` as exhaustive — a match `[False]`
 * falls straight through at run time. Lengths are now one column's signature,
 * and elements decompose under it like every other slot.
 */
describe("the vector's lengths are a signature (Collections Part 3 §3.3)", () => {
  test("element sub-patterns decide too, so a partial length is not covered (#600)", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      "        [True, ...rest] => 1\n" +
      "        [] => 2\n",
    )).toEqual(["match is missing cases: `[False]`, `[False, _]`"]);

    // Two witnesses because the arms miss two of the column's heads: length 1,
    // and the variadic head standing for every length ≥ 2, printed at its own
    // shortest length. Both are values the arms really miss.
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [True] => 1\n" +
      "        [_, _, ...rest] => 2\n",
    )).toEqual(["match is missing cases: `[False]`"]);

    // The elements alone can complete the lengths above zero.
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [True, ...] => 1\n" +
      "        [False, ...] => 2\n",
    )).toEqual([]);
  });

  test("decomposition nests: a union inside a length decomposes as itself", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Option(Bool))): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [Some(True), ...] => 1\n" +
      "        [Some(False), ...] => 2\n" +
      "        [None, ...] => 3\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Option(Bool))): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [Some(True), ...] => 1\n" +
      "        [None, ...] => 3\n",
    )).toEqual(["match is missing cases: `[Some(False)]`, `[Some(False), _]`"]);
  });

  test("a missed length is still reported as a length", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [_] => 1\n",
    )).toEqual(["match is missing cases: `[_, _]`"]);

    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [_] => 1\n",
    )).toEqual(["match is missing cases: `[]`, `[_, _]`"]);
  });

  /** §3.3's own examples, none of which moves. */
  test("a rest covers every length at or above its slot count", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun size(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [_, ...rest] => 1\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export fun size(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [x] => x\n" +
      "        [x, y, ...rest] => x + y\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export fun size(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [...rest] => 1\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export fun size(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [...] => 1\n",
    )).toEqual([]);
  });

  /** §3.1: "slots after the rest count from the end". */
  test("a rest at either end, or in the middle, aligns its slots", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [...init, x] => x\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [x] => x\n" +
      "        [a, ..., z] => a + z\n",
    )).toEqual([]);

    // A front slot and a back slot constrain different ends, so the two arms
    // meet only at length 1: `[False, …, True]` is uncovered above it, and the
    // witness says so at the shortest length that shows it.
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [True, ...rest] => 1\n" +
      "        [...init, False] => 2\n",
    )).toEqual(["match is missing cases: `[False, True]`"]);
  });

  /**
   * The two ends are measured across the column, not per pattern. A rest
   * pattern's front and back regions stop overlapping only at
   * `maxFront + maxBack`, and those maxima can belong to *different* arms: the
   * arms below carry two slots each, so a bound of `widest + 1 = 3` would read
   * the front-heavy arm's second slot and the back-heavy arm's second-from-last
   * slot as the same position, and every length above 3 would be decided by a
   * coincidence that holds only at 3. `bound = max(widest + 1, maxFront +
   * maxBack) = 4` is where the two ends are genuinely apart, and it is the
   * length the witnesses below are printed at.
   */
  test("the variadic bound counts both ends independently", async () => {
    const ENDS =
      "        [] => 0\n" +
      "        [_] => 1\n" +
      "        [_, _] => 2\n" +
      "        [_, True, ...rest] => 3\n" +
      "        [...rest, False, _] => 4\n";

    // At length 3 the two rest arms constrain the *same* position (1 and
    // n - 2 coincide) and `True`/`False` cover it between them. At length 4
    // they separate, and everything with `False` there and `True` two from the
    // end escapes both.
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      ENDS,
    )).toEqual(["match is missing cases: `[_, False, True, _]`"]);

    // And the witness is a real escapee, not a bound artefact: with a sentinel
    // arm below, an instance of it reaches the sentinel.
    const escapes = await runMain("module Main\n\n" + "fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      ENDS +
      "        _ => -1\n" +
      "export let w: Int = f([True, False, True, True])\n",
    );
    expect(escapes.w).toEqual(-1);

    // The dual, and the direction that must never regress: completing those
    // arms with a catch-all leaves the catch-all *live*, because its first
    // witness is a length-4 value. A variadic head read at 3 calls it dead and
    // turns a correct program into a hard error.
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      ENDS +
      "        _ => 5\n",
    )).toEqual([]);

    const completed = await runMain("module Main\n\n" + "fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      ENDS +
      "        _ => 5\n" +
      "export let w: Int = f([False, False, True, True])\n",
    );
    expect(completed.w).toEqual(5);
  });

  test("both ends covered in that regime is exhaustive, at every length", async () => {
    // `maxFront = 2` and `maxBack = 2` against `widest = 2`, so `bound = 4`
    // again — but here the second-from-last position is covered by `False` and
    // `True` both, so every length from 2 up is covered without a catch-all.
    // The last arm's first witness is a length-4 value too: at length 3 its
    // constrained position is the one the front-heavy arm already claims, so a
    // column that stopped at 3 would call it dead.
    const COVERING =
      "        [] => 0\n" +
      "        [_] => 1\n" +
      "        [_, _] => 2\n" +
      "        [_, True, ...rest] => 3\n" +
      "        [...rest, False, _] => 4\n" +
      "        [...rest, True, _] => 5\n";

    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      COVERING,
    )).toEqual([]);

    // The acceptance runs, at `bound - 1` through `bound + 2`, over both values
    // of each position any arm here looks at — position 1 for the front-heavy
    // arm, position `n - 2` for the back-heavy ones. Nothing falls through to
    // the emitter's unreachable-pattern throw, and each length answers with the
    // arm the lengths and the elements together pick.
    const exports = await runMain("module Main\n\n" + "fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      COVERING +
      "export let threeFront: Int = f([False, True, False])\n" +
      "export let threeBack: Int = f([False, False, False])\n" +
      "export let fourFront: Int = f([False, True, False, False])\n" +
      "export let fourBackFalse: Int = f([False, False, False, False])\n" +
      "export let fourBackTrue: Int = f([False, False, True, False])\n" +
      "export let fiveFront: Int = f([False, True, False, False, False])\n" +
      "export let fiveBackFalse: Int = f([False, False, False, False, False])\n" +
      "export let fiveBackTrue: Int = f([False, False, False, True, False])\n" +
      "export let sixFront: Int = f([False, True, False, False, False, False])\n" +
      "export let sixBackFalse: Int = f([False, False, False, False, False, False])\n" +
      "export let sixBackTrue: Int = f([False, False, False, False, True, False])\n",
    );
    expect([exports.threeFront, exports.threeBack]).toEqual([3, 4]);
    expect([exports.fourFront, exports.fourBackFalse, exports.fourBackTrue])
      .toEqual([3, 4, 5]);
    expect([exports.fiveFront, exports.fiveBackFalse, exports.fiveBackTrue])
      .toEqual([3, 4, 5]);
    expect([exports.sixFront, exports.sixBackFalse, exports.sixBackTrue])
      .toEqual([3, 4, 5]);
  });

  test("reachability over the lengths is exact (§7.2)", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [_, ...rest] => 1\n" +
      "        [_, _] => 2\n",
    )).toEqual(["this case is unreachable; the patterns above already cover it"]);

    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [...rest] => 1\n" +
      "        [] => 2\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);

    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Bool)): Int =\n" +
      "    match v\n" +
      "        [_] => 1\n" +
      "        [True] => 2\n" +
      "        _ => 0\n",
    )).toEqual(["this case is unreachable; the patterns above already cover it"]);
  });

  test("guarded arms contribute nothing here either (§7.1)", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [x, ...rest] when x > 0 => 1\n",
    )).toEqual(["match is missing cases: `[_]`"]);
  });

  test("a vector column inside another column decomposes the same way", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union Wrap = W(Vector(Bool))\n" +
      "export fun f(w: Wrap): Int =\n" +
      "    match w\n" +
      "        W([]) => 0\n" +
      "        W([True, ...]) => 1\n",
    )).toEqual(["match is missing cases: `W([False])`, `W([False, _])`"]);

    expect(projectDiagnostics("module Main\n\n" + "export fun f(p: (Vector(Bool), Bool)): Int =\n" +
      "    match p\n" +
      "        ([], _) => 0\n" +
      "        ([True, ...], _) => 1\n",
    )).toEqual(["match is missing cases: `([False], _)`, `([False, _], _)`"]);
  });

  /**
   * §3.4: irrefutable iff it matches every length — exactly `[...rest]` and
   * `[...]`. The gate's witness is now the length the pattern misses, which is
   * §3.4's own `[]`, rather than the `_` a signature-less domain could offer.
   */
  test("§3.4's gate names the length the pattern can fail on", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun first(vs: Vector(Vector(Int))): Int =\n" +
      "    var total = 0\n" +
      "    for [...rest] in vs\n" +
      "        total := total + 1\n" +
      "    total\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "export fun first(vs: Vector(Vector(Int))): Int =\n" +
      "    var total = 0\n" +
      "    for [a] in vs\n" +
      "        total := total + a\n" +
      "    total\n",
    )).toEqual(["this pattern can fail: `[]`; use `match`"]);

    expect(projectDiagnostics("module Main\n\n" + "let head: (Vector(Int)) -> Int = [x, ...rest] => x\n" +
      "export let v: Int = head([1])\n",
    )).toEqual([
      "this pattern can fail: `[]`; use `match` — for a match function, write `match` with arms",
    ]);

    expect(projectDiagnostics("module Main\n\n" + "let all: (Vector(Int)) -> Int = [...xs] => Vector.length(xs)\n" +
      "export let v: Int = all([1])\n",
    )).toEqual([]);
  });
});

describe("the domains the matrix defers on", () => {
  test("`Exn` stays open: catch arms demand nothing, but dead ones still error", () => {
    expect(projectDiagnostics("module Main\n\n" + "exception Boom(line: Int)\n" +
      "export fun guard(): Int =\n" +
      "    try\n" +
      "        1\n" +
      "    catch\n" +
      "        Boom(_) => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics("module Main\n\n" + "exception Boom(line: Int)\n" +
      "export fun guard(): Int =\n" +
      "    try\n" +
      "        1\n" +
      "    catch\n" +
      "        Boom(_) => 0\n" +
      "        Boom(n) => n\n",
    )).toEqual(["exception `Boom` is already caught above"]);

    expect(projectDiagnostics("module Main\n\n" + "exception Boom(line: Int)\n" +
      "export fun guard(): Int =\n" +
      "    try\n" +
      "        1\n" +
      "    catch\n" +
      "        _ => 0\n" +
      "        Boom(_) => 1\n",
    )).toEqual(["this catch arm is unreachable because an earlier arm catches everything"]);
  });
});

describe("the witness printer keeps a record's private fields at home (Modules §4.2)", () => {
  const GEO = "opaque record Crate = {n: Bool}\n" +
    "export fun make(b: Bool): Option(Crate) = Some(Crate({n = b}))\n";

  test("outside the home module the witness never names a field", () => {
    const messages = runProjectDiagnostics([
      ["/geo.hex", "module Geo\n\n" + GEO],
      ["/main.hex",
        "module Main\n\n" + 'import Geo\n' +
        "export fun pick(o: Option(Geo.Crate)): Int =\n" +
        "    match o\n" +
        "        None => 0\n"],
    ]);
    // Constructor granularity, and no `n` anywhere: a diagnostic never signposts
    // a spelling the reader cannot write, and never publishes a field §4.2 hid.
    expect(messages).toEqual(["match is missing cases: `Some(_)`"]);
    expect(messages.some((message) => message.includes("n ="))).toBe(false);
  });

  test("inside the home module `opaque` changes nothing, and the row prints", () => {
    expect(projectDiagnostics("module Main\n\n" + "opaque record Crate = {n: Bool}\n" +
      "export fun pick(c: Crate): Int =\n" +
      "    match c\n" +
      "        Crate({n = True}) => 1\n",
    )).toEqual(["match is missing cases: `Crate({n = False})`"]);
  });
});

/**
 * A constraint default body is a body like any other (#599).
 *
 * It used to be typed by a pre-pass that ran before the checker had registered
 * the module's unions, records, and exceptions, and before any module binding
 * had a scheme — so §7's judgments had no signature to judge against, a `catch`
 * arm had no exception table to read, and a call to a binding declared above
 * the constraint met `ERROR`, which unifies with anything. Constraints §2 says
 * what is in scope there — "the constraint subject, its base constraint
 * operations, module-scope names, and all members of the same constraint" — and
 * the body is now checked at the declaration's own seat, where all of it is.
 *
 * Every row below states the same demand: what the body gets is what the same
 * code gets at the top level, verbatim, message for message.
 */
describe("a constraint's default body is checked like any other body (#599)", () => {
  const FLAG = "union Flag = On | Off\n";
  const PICK = "constraint Pick<a> =\n" +
    "    pick(value: a): a\n";

  test("a non-exhaustive match reports the missing case (§7.1, §7.3)", () => {
    expect(projectDiagnostics(
      FLAG + PICK +
      "    rank(flag: Flag): Int =\n" +
      "        match flag\n" +
      "            On => 1\n",
    )).toEqual(["match is missing cases: `Off`"]);
  });

  test("an arm from the wrong union is refused as it is at the top level", () => {
    const inDefault = projectDiagnostics(
      FLAG + "union Other = Thing\n" + PICK +
      "    rank(flag: Flag): Int =\n" +
      "        match flag\n" +
      "            Thing => 1\n",
    );
    const atTopLevel = projectDiagnostics(
      FLAG + "union Other = Thing\n" +
      "fun rank(flag: Flag): Int =\n" +
      "    match flag\n" +
      "        Thing => 1\n",
    );
    // #607: the missing-cases report that used to ride beside the type error is
    // gone at both seats. Pattern Matching §7.3's error-program obligation reads
    // the broken `Thing` arm as `_`, so `Flag` is covered under every repair of
    // it and there is nothing left to report but the deeper fault.
    expect(inDefault).toEqual(["type mismatch: expected Flag, found Other"]);
    expect(inDefault).toEqual(atTopLevel);
  });

  test("a live trailing `_` is live", () => {
    // The regression the assumed column caused (#598): taking the written heads
    // *as* the signature made `On` complete on its own, so the wildcard that
    // covers `Off` read as dead.
    expect(projectDiagnostics(
      FLAG + PICK +
      "    rank(flag: Flag): Int =\n" +
      "        match flag\n" +
      "            On => 1\n" +
      "            _ => 2\n",
    )).toEqual([]);
  });

  test("a repeated constructor is a dead arm (§7.2)", () => {
    expect(projectDiagnostics(
      FLAG + PICK +
      "    rank(flag: Flag): Int =\n" +
      "        match flag\n" +
      "            On => 1\n" +
      "            On => 2\n" +
      "            Off => 3\n",
    )).toEqual(["this case is unreachable; `On` is already handled above"]);
  });

  test("a call to a binding above the constraint is typed against its scheme", () => {
    expect(projectDiagnostics("module Main\n\n" + "fun helper(n: Int): Int = n\n" + PICK +
      "    rank(): Int = helper(True)\n",
    )).toEqual(["type mismatch: expected Int, found Bool"]);
  });

  test("a binding below the constraint is still the resolver's refusal", () => {
    // The top-down law is unchanged, and is exactly why the seat can be this
    // late: the names a default body may reach are the ones already seeded.
    expect(projectDiagnostics(
      PICK +
      "    rank(): Int = helper(1)\n" +
      "fun helper(n: Int): Int = n\n",
    )).toEqual([
      "`helper` is declared later in this block; declarations are read top-down — " +
      "move its declaration above this use",
    ]);
  });

  test("a `catch` arm reads the module's exception table", () => {
    expect(projectDiagnostics("module Main\n\n" + "exception Boom(message: String)\n" +
      "fun blow(): Int = throw(Boom(\"no\"))\n" + PICK +
      "    rank(): Int =\n" +
      "        try\n" +
      "            blow()\n" +
      "        catch\n" +
      "            Boom(_) => 0\n",
    )).toEqual([]);
  });

  test("the prelude's unions are visible too", () => {
    expect(projectDiagnostics(
      PICK +
      "    rank(flag: Bool): Int =\n" +
      "        match flag\n" +
      "            True => 1\n",
    )).toEqual(["match is missing cases: `False`"]);

    expect(projectDiagnostics(
      PICK +
      "    rank(held: Option(Int)): Int =\n" +
      "        match held\n" +
      "            Some(n) => n\n",
    )).toEqual(["match is missing cases: `None`"]);
  });
});

function runProjectDiagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}
