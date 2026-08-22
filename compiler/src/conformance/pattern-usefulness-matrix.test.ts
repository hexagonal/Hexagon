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
    expect(projectDiagnostics(
      "export fun pick(r: {b: Bool}): Int =\n" +
      "    match r\n" +
      "        {b = True} => 1\n" +
      "        {b = False} => 0\n",
    )).toEqual([]);
  });

  test("a tuple's components combine, exactly and at every depth", async () => {
    expect(projectDiagnostics(
      "export fun corner(p: (Bool, Bool)): Int =\n" +
      "    match p\n" +
      "        (True, True) => 3\n" +
      "        (True, False) => 2\n" +
      "        (False, True) => 1\n" +
      "        (False, False) => 0\n",
    )).toEqual([]);

    // The coarser split covers just as exactly: the second component is `_` in
    // both arms, so the matrix never has to look at it.
    expect(projectDiagnostics(
      "export fun left(p: (Bool, Bool)): Int =\n" +
      "    match p\n" +
      "        (True, _) => 1\n" +
      "        (False, _) => 0\n",
    )).toEqual([]);

    // And the acceptance runs: the emitter's chain closes on the unreachable
    // fallthrough it has always closed on, so an exhaustive match with no
    // catch-all answers every input.
    const exports = await runMain(
      "fun corner(p: (Bool, Bool)): Int =\n" +
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
    expect(projectDiagnostics(
      "export fun pick(o: Option(Bool)): Int =\n" +
      "    match o\n" +
      "        Some(True) => 1\n" +
      "        Some(False) => 0\n" +
      "        None => -1\n",
    )).toEqual([]);

    const exports = await runMain(
      "fun pick(o: Option(Bool)): Int =\n" +
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
    expect(projectDiagnostics(
      "export union UserId = UserId(Int)\n" +
      "export fun pick(o: Option(UserId)): Int =\n" +
      "    match o\n" +
      "        Some(UserId(n)) => n\n" +
      "        None => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics(
      "export record Crate = {n: Int}\n" +
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

    expect(projectDiagnostics(
      "export union P = P((Bool, Bool))\n" +
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
    expect(projectDiagnostics(
      "export union T = T(Bool, Bool)\n" +
      "export fun pick(t: T): Int =\n" +
      "    match t\n" +
      "        T(True, True) => 3\n" +
      "        T(True, False) => 2\n" +
      "        T(False, True) => 1\n" +
      "        T(False, False) => 0\n",
    )).toEqual([]);
  });

  test("record coverage is over the mentioned fields, unioned across arms (§7.1)", () => {
    expect(projectDiagnostics(
      "export fun pick(r: {a: Bool, b: Bool}): Int =\n" +
      "    match r\n" +
      "        {a = True} => 2\n" +
      "        {a = False, b = True} => 1\n" +
      "        {a = False, b = False} => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics(
      "export fun pick(r: {a: Bool, b: Bool}): Int =\n" +
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
    expect(projectDiagnostics(
      "export union W = W(Bool)\n" +
      "export fun pick(w: W): Int =\n" +
      "    match w\n" +
      "        W(True) => 1\n" +
      "        W(False) => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics(
      "export union W = W(Bool)\n" +
      "export fun pick(w: W): Int =\n" +
      "    match w\n" +
      "        W(True) => 1\n" +
      "        W(True) => 2\n" +
      "        W(False) => 0\n",
    )).toEqual(["this case is unreachable; the patterns above already cover it"]);
  });

  test("a catch-all behind arms that now exhaust the domain is unreachable", () => {
    expect(projectDiagnostics(
      "export fun corner(p: (Bool, Bool)): Int =\n" +
      "    match p\n" +
      "        (True, True) => 3\n" +
      "        (True, False) => 2\n" +
      "        (False, True) => 1\n" +
      "        (False, False) => 0\n" +
      "        _ => -1\n",
    )).toEqual(["this case is unreachable; the patterns above already cover it"]);
  });

  test("a constructor handled above in full is named", () => {
    expect(projectDiagnostics(
      "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(_) => 1\n" +
      "        Some(x) => x\n" +
      "        None => 0\n",
    )).toEqual(["this case is unreachable; `Some` is already handled above"]);
  });

  test("anything behind an arm that covers everything is unreachable", () => {
    expect(projectDiagnostics(
      "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        _ => 1\n" +
      "        None => 0\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("a duplicate literal is unreachable; literals never complete their domain", () => {
    expect(projectDiagnostics(
      "export fun name(n: Int): String =\n" +
      "    match n\n" +
      "        0 => \"none\"\n" +
      "        0 => \"zero\"\n" +
      "        _ => \"many\"\n",
    )).toEqual(["this literal case is unreachable; it is already handled above"]);

    expect(projectDiagnostics(
      "export fun name(n: Int): String =\n" +
      "    match n\n" +
      "        0 => \"none\"\n" +
      "        1 => \"one\"\n",
    )).toEqual(["match is missing cases: `_`"]);

    expect(projectDiagnostics(
      "export fun name(s: String): Int =\n" +
      "    match s\n" +
      "        \"yes\" => 1\n",
    )).toEqual(["match is missing cases: `_`"]);
  });
});

describe("guards contribute nothing, and are not subsumed by each other (§7.1, §7.2)", () => {
  test("a guarded arm covers nothing — `when True` included", () => {
    expect(projectDiagnostics(
      "export fun pick(b: Bool): Int =\n" +
      "    match b\n" +
      "        True => 1\n" +
      "        False when True => 0\n",
    )).toEqual(["match is missing cases: `False`"]);
  });

  test("two arms with the same pattern and different guards are both reachable", () => {
    expect(projectDiagnostics(
      "export fun pick(n: Int): Int =\n" +
      "    match n\n" +
      "        v when v > 0 => 1\n" +
      "        v when v < 0 => -1\n" +
      "        _ => 0\n",
    )).toEqual([]);
  });

  test("a guarded arm fully covered by an earlier unguarded one is unreachable", () => {
    expect(projectDiagnostics(
      "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(_) => 1\n" +
      "        Some(x) when x > 0 => x\n" +
      "        None => 0\n",
    )).toEqual(["this case is unreachable; `Some` is already handled above"]);
  });
});

describe("§7.3's witnesses", () => {
  test("a constructor's slots render as `_`, and a nullary renders bare", () => {
    expect(projectDiagnostics(
      "export union Tree = Leaf | Node(Tree, Int, Tree)\n" +
      "export fun size(t: Tree): Int =\n" +
      "    match t\n" +
      "        Leaf => 0\n",
    )).toEqual(["match is missing cases: `Node(_, _, _)`"]);

    expect(projectDiagnostics(
      "export fun pick(b: Bool): Int =\n" +
      "    match b\n" +
      "        True => 1\n",
    )).toEqual(["match is missing cases: `False`"]);
  });

  test("a tuple renders with `_` holes", () => {
    expect(projectDiagnostics(
      "export fun pick(p: (Option(Int), Int)): Int =\n" +
      "    match p\n" +
      "        (Some(x), _) => x\n",
    )).toEqual(["match is missing cases: `(None, _)`"]);
  });

  test("a record renders only the discriminating fields, never invented mentions", () => {
    expect(projectDiagnostics(
      "export union Status = Queued | Running | Done\n" +
      "export fun pick(r: {status: Status, id: Int}): Int =\n" +
      "    match r\n" +
      "        {status = Running} => 1\n" +
      "        {status = Done} => 2\n",
    )).toEqual(["match is missing cases: `{status = Queued}`"]);
  });

  test("the list is capped at three, then counted", () => {
    expect(projectDiagnostics(
      "export union Six = A | B | C | D | E | F\n" +
      "export fun pick(s: Six): Int =\n" +
      "    match s\n" +
      "        A => 0\n",
    )).toEqual(["match is missing cases: `B`, `C`, `D` …and 2 more"]);
  });

  test("`_` where any value works — the shallowest genuinely missing witness", () => {
    // No unguarded arm has split the domain, so nothing deeper than `_` is true
    // of the uncovered values: every value is one.
    expect(projectDiagnostics(
      "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(x) when x > 0 => x\n",
    )).toEqual(["match is missing cases: `_`"]);
  });
});

describe("§5.1's gate is the single-row matrix, and §5.3 is its one sentence", () => {
  test("a sole-constructor chain destructures at any depth, through generic slots", () => {
    expect(projectDiagnostics(
      "export union UserId = UserId(Int)\n" +
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
    expect(projectDiagnostics(
      "export fun get(o: Option(Int)): Int =\n" +
      "    let Some(n) = o\n" +
      "    n\n",
    )).toEqual(["this pattern can fail: `None`; use `match`"]);

    expect(projectDiagnostics(
      "export union Box(a) = Box(a)\n" +
      "export fun get(b: Box(Option(Int))): Int =\n" +
      "    let Box(Some(n)) = b\n" +
      "    n\n",
    )).toEqual(["this pattern can fail: `Box(None)`; use `match`"]);

    expect(projectDiagnostics(
      "export union Box(a) = Box(a)\n" +
      "export fun get(b: Box(Int)): Int =\n" +
      "    let Box(0) = b\n" +
      "    1\n",
    )).toEqual(["this pattern can fail: `Box(_)`; use `match`"]);

    // The loop seat and the lambda seat draw the same sentence, the lambda's
    // with §6.7's fixit.
    expect(projectDiagnostics(
      "export fun count(xs: Vector(Option(Int))): Int =\n" +
      "    var total = 0\n" +
      "    for Some(n) in xs\n" +
      "        total := total + n\n" +
      "    total\n",
    )).toEqual(["this pattern can fail: `None`; use `match`"]);

    expect(projectDiagnostics(
      "let unwrap: (Option(Int)) -> Int = Some(n) => n\n" +
      "export let v: Int = unwrap(Some(1))\n",
    )).toEqual([
      "this pattern can fail: `None`; use `match` — for a match function, write `match` with arms",
    ]);
  });

  test("or-pattern coverage decides, not syntax (§5.1's `True | False` row)", async () => {
    const exports = await runMain(
      "let True | False = True\n" +
      "let flip: (Bool) -> Int = (True | False) => 1\n" +
      "export let v: Int = flip(True)\n",
    );
    expect(exports.v).toBe(1);

    expect(projectDiagnostics(
      "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(_) | None => 1\n",
    )).toEqual([]);
  });
});

describe("the domains the matrix defers on", () => {
  test("the vector keeps Collections Part 3 §3's length judgment", () => {
    expect(projectDiagnostics(
      "export fun size(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [] => 0\n" +
      "        [_, ...rest] => 1\n",
    )).toEqual([]);

    expect(projectDiagnostics(
      "export fun size(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [_] => 1\n",
    )).toEqual(["match is missing a vector length case"]);

    // The rest form at length zero is the vector's one irrefutable shape, so
    // it passes the gate; a fixed-length pattern does not, and draws §5.3's
    // sentence with the witness the signature-less domain can offer.
    expect(projectDiagnostics(
      "export fun first(vs: Vector(Vector(Int))): Int =\n" +
      "    var total = 0\n" +
      "    for [...rest] in vs\n" +
      "        total := total + 1\n" +
      "    total\n",
    )).toEqual([]);

    expect(projectDiagnostics(
      "export fun first(vs: Vector(Vector(Int))): Int =\n" +
      "    var total = 0\n" +
      "    for [a] in vs\n" +
      "        total := total + a\n" +
      "    total\n",
    )).toEqual(["this pattern can fail: `_`; use `match`"]);
  });

  test("`Exn` stays open: catch arms demand nothing, but dead ones still error", () => {
    expect(projectDiagnostics(
      "exception Boom(line: Int)\n" +
      "export fun guard(): Int =\n" +
      "    try\n" +
      "        1\n" +
      "    catch\n" +
      "        Boom(_) => 0\n",
    )).toEqual([]);

    expect(projectDiagnostics(
      "exception Boom(line: Int)\n" +
      "export fun guard(): Int =\n" +
      "    try\n" +
      "        1\n" +
      "    catch\n" +
      "        Boom(_) => 0\n" +
      "        Boom(n) => n\n",
    )).toEqual(["exception `Boom` is already caught above"]);

    expect(projectDiagnostics(
      "exception Boom(line: Int)\n" +
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
  const GEO = "export opaque record Crate = {n: Bool}\n" +
    "export fun make(b: Bool): Option(Crate) = Some(Crate({n = b}))\n";

  test("outside the home module the witness never names a field", () => {
    const messages = runProjectDiagnostics([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import { Crate, make } from "./geo"\n' +
        "export fun pick(o: Option(Crate)): Int =\n" +
        "    match o\n" +
        "        None => 0\n"],
    ]);
    // Constructor granularity, and no `n` anywhere: a diagnostic never signposts
    // a spelling the reader cannot write, and never publishes a field §4.2 hid.
    expect(messages).toEqual(["match is missing cases: `Some(_)`"]);
    expect(messages.some((message) => message.includes("n ="))).toBe(false);
  });

  test("inside the home module `opaque` changes nothing, and the row prints", () => {
    expect(projectDiagnostics(
      "export opaque record Crate = {n: Bool}\n" +
      "export fun pick(c: Crate): Int =\n" +
      "    match c\n" +
      "        Crate({n = True}) => 1\n",
    )).toEqual(["match is missing cases: `Crate({n = False})`"]);
  });
});

function runProjectDiagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}
