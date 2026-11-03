# Stdlib listing: memoization

**Status:** Decided 2026-11-03, ruled by James in four questions (`notes/memoization-deliberation.md` is the deliberation record). Spec-only; implementation #1445. This document discharges the "`memoFix` / open-recursion support surface" row of `stdlib-roadmap.md` §2. Its companion edits are:
- Effects §6.2, where species (d) states its obligation in closed form;
- Collections Part 2 §2, §3.2 and §4.4, where `Hash` gains `same`, with its rows in Parts 3 and 4 and Dec §8;
- FFI Part 3 §7.4, where `ReentrancyFault` gains a second raiser;
- Functions §7.5, which is corrected;
- Intrinsics §4.1's inventory.

**Home:** `stdlib/Function.hex`, a prelude module holding combinators over function values. Like `Math`, it introduces no type and no bare term name. Prelude injection supplies the module alias, and calls stay qualified: `Function.memoize(f)`.

**Not in scope:**
- `Hash.same` itself, which Collections Part 2 owns.
- Species (d) beyond the memo shape (Effects §6.2).
- `Seq.memoize`, which remains the foreign-iterator launder of FFI Part 3 and Loops §6.4.
- A size-bounded memo.
- `Function.identity`, a later decision of its own.

**Companions:**
- Functions §7.1 and §7.5 (the restricted pattern and its blessed idiom).
- Statements §6.2 and §6.4 (why the table cannot be written in Hexagon).
- Effects §2.1, §2.4 and §6.2.
- Exceptions §1 (catching in pure code).
- Collections Part 2 §2 (`Hash`, `same`).
- Intrinsics §3.4 and §4.2 (constrained intrinsic rows, parametricity).
- FFI Part 3 §7.3 and §7.4 (`ReentrancyFault`).
- Method Syntax §4.2 (no dot dispatch on a function).

---

## 1. Doctrine

- **The blessed idiom gets its function.** Functions §7.5 sends memoised recursion through open recursion: the function takes "itself" as a parameter, and a combinator ties the knot. That combinator cannot be written in Hexagon. Statements §6.2 forbids a lambda that touches an outer `var`, and §6.4 provides no ref cell, which is what makes a `->` face a fact (Effects §7). So the compiler provides it.
- **One test decides every design point: is a hit indistinguishable from a miss?** That is Effects §6.2's transparency obligation for an owned memo. Each rule in §3 exists so that the memoised function is a value function of its argument, and its `->` face stays a fact.
- **The surface is the word developers already know.** `memoize` is the name TypeScript developers meet in lodash. The recursive form says what it is for in the same word. The Haskell `memoFix`, from the fixed-point combinator, is the lineage Collections Part 1 §3.1 avoids where an ordinary word exists.

## 2. The surface

```hexagon
module Function

extern from "hex:intrinsic"
    export fun functionMemoizeRecursive as memoizeRecursive<a: Hash>(body: ((a) -> b, a) -> b) -> (a) -> b

export let memoize<a: Hash>(f: (a) -> b): (a) -> b =
    memoizeRecursive((_, key) => f(key))
```

- **`memoizeRecursive(body)`** returns a function that answers `body(self, key)` for each key, where `self` is that same memoised function. So the recursive calls `body` makes through `self` are memoised too.
- **`memoize(f)`** remembers the answers of a function that does not call itself. It is `memoizeRecursive` with `self` ignored: one line of ordinary Hexagon over the intrinsic row, not a second intrinsic.
- **Both take only `->` functions (§4).**
- **Both need the key to honor `Hash`.** A function of several arguments is memoised over a tuple, whose `Hash` is structural (Collections Part 2 §2.5).

```hexagon
let digits(n: Int): Int =
    var count = 1
    var rest = n
    while rest >= 10
        rest := rest.quot(10)
        count := count + 1
    count

let blinkOpen(self: ((Int, Int)) -> Int, key: (Int, Int)): Int =
    let (stone, steps) = key
    if steps == 0 then 1
    else if stone == 0 then self((1, steps - 1))
    else if digits(stone).mod(2) == 0 then
        let half = 10 ** digits(stone).quot(2)
        self((stone.quot(half), steps - 1)) + self((stone.rem(half), steps - 1))
    else self((stone * 2024, steps - 1))

let blink = Function.memoizeRecursive(blinkOpen)
let cheap = Function.memoize(expensive)
```

- **No dot call.** A function value has no companion (Method Syntax §4.2), so these are always written qualified, never `f.memoize()`.
- **`Seq.memoize` shares the word in the same sense,** keeping what has been computed, and lives in another module.

## 3. Meaning

### 3.1 One table per memoised function

Each evaluation of `memoizeRecursive(body)` creates a new function with a table of its own. The table starts empty and is reachable from nothing else. Two evaluations with the same `body` give two independent tables, and a function has no `Eq`, so their distinct identities are unobservable.

**The table lives as long as the function does.** Entries are never evicted. This is documented the way `Seq.memoize`'s retention is: "at the cost of retaining what has been produced". To memoise once, bind the result with `let`. `fun f(n) = Function.memoize(g)(n)` builds a new table on every call and remembers nothing (§8's book note).

### 3.2 A call

A call `g(key)` of a memoised function `g` proceeds in this order:

1. **Look up.** The table places keys by `Hash.hash(key)`. An entry answers this key when its key is `Hash.same` as `key` (Collections Part 2 §2.3), and then the call returns the filed answer. `==` decides nothing here: two keys `==` can't tell apart may still differ in a way a function can see (Collections Part 2 §2.3's examples).
2. **Refuse a cycle.** If a key `same` as `key` is in progress in this table (an enclosing call of `g` is computing its answer), the call throws `ReentrancyFault` (FFI Part 3 §7.4). Plain recursion would never return here, because a pure `body` asked for the same key again repeats the same calls.
3. **Compute.** Otherwise the key is marked in progress, and `body(g, key)` is evaluated.
   - If it returns an answer, the mark is removed and the answer is returned. The answer is filed **unless a `ReentrancyFault` was raised while it was being computed** (§3.3).
   - If it throws, the mark is removed, nothing is filed, and the throw propagates. Under `->` that is a fault, or a foreign throw that broke a row's claim (Exceptions §6).

Each write files one finished answer, so a call that comes back into the table sees either no entry or a finished one, never one half made.

### 3.3 Why a cycle files nothing that was in progress

Faults are catchable in pure code (Exceptions §1: "Catching is legal anywhere, pure code included"), so a `body` may catch `ReentrancyFault` and answer something else. Where a cycle is detected depends on which call came first and what was already in progress. An answer computed across such a refusal is therefore a fact about the call history, not about its key, and filing it would let that history show through every later hit.

So an answer is filed only if **no `ReentrancyFault` was raised, by any memoised function or by any memoizing `Seq` spine, while it was being computed.**
- The rule counts raises, not catches. A refusal caught deep inside one `body` still keeps every enclosing computation's answer unfiled.
- It spans tables. A `body` of one memoised function may call another, and a refusal in the inner one keeps the outer one's answers unfiled too.

The implementation keeps one runtime-wide count of `ReentrancyFault` raises. A computation compares the count when it starts with the count when it finishes.

Any other fault needs no such rule. A pure `body` reaches the same fault for a key whichever call comes first, so filing nothing for the failed key is enough.

### 3.4 What the memoised function equals

Compare `g` with plain recursion, `fun go(key) = body(go, key)`:

- **Where plain recursion returns an answer, `g` returns the same answer, in any table state and any context.**
  - Plain recursion returning means no key repeats on any path from this key.
  - So `g`'s computation meets no cycle.
  - Every hit it takes is an answer filed by an earlier computation that met no cycle either, which by induction is plain recursion's answer.
- **Where plain recursion throws a fault, `g` throws the same fault.** The path is the same, its hits are plain recursion's answers, and the fault is reached at the same step.
- **Where plain recursion never returns because a key repeats,** `g` throws `ReentrancyFault` at the first repeat, and a `body` may catch it. Such a key is never filed (§3.3). At the outermost call, what `g` answers is a function of the key alone: the only steps that depend on the table are hits, and hits occur only at keys whose plain answer exists and equals what a miss computes.
- **Where plain recursion never returns for any other reason,** such as infinitely many distinct keys, `g` doesn't either.

So a hit and a miss are indistinguishable to every caller. That is species (d)'s obligation (Effects §6.2), discharged in closed form.

**Stack exhaustion is outside this argument, as it is outside plain recursion's.** A `body` that catches the platform's stack-overflow error depends on how deep it was called, memoised or not. Hexagon's purity does not model stack depth.

### 3.5 The lowering reads only its evidence

The table is ordered by `Hash.hash` and decides hits by `Hash.same`, both read from the `Hash` dictionary the call passes (Intrinsics §3.4). The lowering never inspects a key's representation, so Intrinsics §4.2's parametricity holds as written.

## 4. The function handed in is `->`

`body` and `f` are pure and cannot fail (Effects §2.1). An argument that is impure or may fail is refused by ordinary unification, with the ordinary colour refusal (Effects §4.3).

- **Faults still pass through.** They are untracked (Exceptions §1), and §3.2 files nothing for a failed key.
- **A computation that may find no answer returns an `Option`.** It is Hexagon's channel for "not there", and an `Option` answer is filed and reused like any other. A thrown exception would be recomputed every time its key was reached, because failures are never filed, so memoising it buys nothing. §10.5 records the rejected failing sibling.
- **A failing signature cannot express this.** A signature where failure passes through, `((a) ->^ b, a) ->^ b`, would force every call, pure bodies included, to wear `^`. The arrow on `self` sits in a callback's own parameters, and Effects §2.4 makes it a constant there, so it cannot follow `body`'s own colour.

## 5. Costs

- **A call** costs one `hash` of the key, a search of its bucket comparing with `same`, and on a miss one insertion after the answer is computed.
  - `same` replaces `==` in the bucket search and does the same amount of work.
  - The in-progress check and the raise count are one set membership and two integer reads.
- **Memory** is one entry per distinct key ever asked for, kept for the function's lifetime (§3.1).
- **Measured** on Advent of Code 2024 day 11 (75 blinks), with a JavaScript table standing in for the lowering around the compiled body. On main with this branch's compiler, before this design:

  | Version | Lines | Time |
  |---|---|---|
  | Simulated memo | about 13 | 0.11 to 0.20 s |
  | Threading a persistent `Map` cache by hand | 26 | about 0.58 s |
  | A loop over a `Map` of counts | 18 | about 0.36 s |

  The threaded version can also be written with a silent mistake that leaves its answers right and its time unbounded. The deliberation record keeps the probe.

## 6. Diagnostics

| Condition | Report | § |
|---|---|---|
| `body` or `f` is impure or may fail | the ordinary colour refusal at the argument (Effects §4.3), unchanged | §4 |
| The key type has no `Hash` | the ordinary unsatisfied-`Hash` report (Collections Part 2 §9), unchanged | §2 |
| `let g = Function.memoize(…)` or `let g = Function.memoizeRecursive(…)` whose argument names `g` | The self-reference refusal (Functions §6) gives the open-recursion rewrite in place of its "use `fun`" advice, which here would lead to a table rebuilt on every call: "`fib` is not in scope in its own `let` definition; to memoise a function that calls itself, take it as a parameter: `let fib = Function.memoizeRecursive((self, n) => …)`, calling `self` where the lambda calls `fib`". At `memoizeRecursive`, it names the lambda's own first parameter. The advice is chosen by the right-hand side's text: a call, or pipe stage, that resolves to one of the two. | §1 |

No new refusal is introduced. The third row changes only the wording of an existing one, as the Rewrite Rule (Declarations Preamble §1.1) asks: a refusal names the local rewrite that keeps the writer's intent.

## 7. Implementation requirements

- **One intrinsic row** in `stdlib/Function.hex`, key `functionMemoizeRecursive` (Intrinsics §4.1).
  - Its lowering is a compiler helper (Intrinsics §4.1's helper family) holding the table in a closure, which no program and no foreign code can reach.
  - It receives the `Hash` evidence by the compiler's own convention (Intrinsics §3.4).
  - It is held to §3 as a conformance obligation (Intrinsics §4.2), and its species is Effects §6.2's (d).
- **`memoize` is ordinary Hexagon** in the same module.
- **`ReentrancyFault` is raised as FFI Part 3 §7.4 constructs it:** the branded representation built at the raise site, with this raiser's own message: "a memoised function's answer for this key depends on itself".
  - The runtime-wide raise count of §3.3 is incremented by every raise, including the `Seq` spine's. Helpers are emitted per module (FFI Part 3 §7.4), so the count lives in one place that every module's copy of both helpers reaches.
- **The table, the in-progress marks and the count are the helper's own state,** as the `Seq` spine's memo is. No program can name them, so Statements §6.4 (no ref cell a program can spell) is untouched, and so is the rule against module-level `var` (§6.4's last bullet), which is about state a program can observe: §3.4 shows the count changes nothing a caller can see.
- **The seat.** `Function.hex` is seated in the prelude after `Hash.hex`, the only prelude declaration it names.
- **Emission.** Zero-Cost Fundamental Exports (FFI Part 8) applies to `memoizeRecursive` and `memoize` as to any exported function with one constrained variable, as it does to `Map.get`'s constrained row.

## 8. The book

- **Chapter 3, after "Mutual recursion".** A short section teaches Functions §7.5's idiom:
  - write the function taking itself, and hand it to `Function.memoizeRecursive`;
  - `Function.memoize` for a function that doesn't call itself;
  - memoise once, at a `let`.
- **Chapter 13, "Hashing is derived together with equality".** The section teaches `same` beside `hash`.
- **Chapter 12's constraint table.** The `Hash` row mentions `same`.
- **`CONTINUITY.md`** records both, and that `Dec.same` is the member.

## 9. Acceptance tests

- **(a) Day 11.** Open recursion over `(stone, steps)`, splitting digits arithmetically, gives 237149922829154 for the 75-blink input, with each key's `body` evaluated once.
- **(b) `memoize`.** A counted `f` behind `Function.memoize` runs once per distinct key across repeated calls.
- **(c) Separate tables.** Two `memoizeRecursive(body)` results share no entries.
- **(d) Hits use `same`.** Over `Float` keys, `g(0.0)` then `g(-0.0)` evaluates `body` twice, and each answers what plain recursion answers. In the other order it does the same. A `Dec` pair `1.0` and `1.00` does likewise.
- **(e) A cycle.** A key whose body asks for itself, directly or through other keys, throws `ReentrancyFault`, where plain recursion would loop forever.
- **(f) Catching a cycle files nothing.** A body that catches `ReentrancyFault` and answers `-1`:
  - the keys in progress at the raise are unfiled;
  - asking for them afterwards, in either order, gives the same answers as in a fresh table;
  - the same holds when the cycle runs through a second memoised function.
- **(g) A failed key files nothing.** A body that faults for one key faults again on the next call for that key, and its siblings' answers are filed.
- **(h) Colour.** A `body` that throws a tracked exception is refused with the colour refusal, and a pure one gives bare calls.
- **(i) The rewrite.** `let fib = Function.memoize((n: Int) => if n <= 1 then n else fib(n - 1) + fib(n - 2))` draws §6's rewrite naming `Function.memoizeRecursive`. `let fib = Function.memoizeRecursive((me: (Int) -> Int, n: Int) => … fib(n - 1) …)` draws the advice naming `me`. A self-reference under any other right-hand side keeps "use `fun`".

## 10. Rejected alternatives (do not re-litigate)

### 10.1 No memoisation, Elm's answer

Teach threading a cache by hand, or a loop. Rejected: it costs about twice the code and three to five times the run time on the probe (§5). The threaded form also has a silent mistake no diagnostic can see, and §7.5's idiom would point at nothing.

### 10.2 Hits decided by `==`

This is what Core, the WWDC 2014 Swift `memoize` and Python's `functools.cache` do. Rejected: `==` is coarser than what functions can observe:
- `Float`'s `0.0` and `-0.0`;
- `Dec`'s `1.0` and `1.00`;
- `Map` and `Set` with colliding keys, which iterate in insertion order.

Call order would then show through a `->` face. Python's `lru_cache` has its `typed` flag for exactly this reason.

### 10.3 A representation walk in the lowering

Rejected: it breaks Intrinsics §4.2's parametricity, which Collection combinators §12.5 already enforces. It would need a runtime walker that knows every representation, and it would give developers no way to ask the same question. `Hash.same` (Collections Part 2 §2.3) answers it through evidence instead.

### 10.4 A key constraint whose `==` misses nothing

Rejected: it adds a new kind of constraint, and refuses `Float`, `Dec`, `Map` and `Set` keys and anything holding them. Advent of Code 2022 day 16's natural key, which holds a set of opened valves, would be refused.

### 10.5 A failing sibling, or failure passing through

Rejected, not deferred. Memoising a computation that fails is wasteful, because failures are not filed. The shape for "no answer" is an `Option` (§4). Failure passing through cannot be written without making every call wear `^` (§4).

### 10.6 The name `memoFix`, a `Memo` module, or a bare prelude function

- `memoFix` is Haskell lineage where an ordinary word exists (Collections Part 1 §3.1).
- `memoizeRec` reads as "memoize a record" in a language with `record`, and brings back the retired `let rec`.
- A `Memo` module is named for a technique, not a kind of value, and `Memo.function` reads awkwardly.
- A bare function would need a ruling against Modules §5.5's closed bare set.
- The name `Fun` reads as the `fun` keyword.
- Homes in `Hash`, `Map` or `Prelude.hex` put the function where nobody would look.
- No `compose` joins this module (settled; a pipeline writes `a |> b`).

## 11. Precedents consulted

| Language | Memoised recursion | Cycles |
|---|---|---|
| OCaml (Jane Street Core) | `Memo.recursive`, keyed by a hashable | "does not detect or prevent infinite loops" |
| Haskell | MemoTrie's `memoFix`, trie-keyed | the runtime may report `NonTermination`, with no guarantee |
| Swift | WWDC 2014's `memoize<T: Hashable, U>(body: ((T) -> U, T) -> U)`, non-throwing | none |
| Python | `functools.cache` and `lru_cache`, through the decorated name | none documented |
| Elm, Rust, F#, TypeScript | none in the standard library | |

`functools`, OCaml's `Fun` and Haskell's `Data.Function` are the precedents for a module of function tools.
