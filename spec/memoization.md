# Stdlib listing: memoization

**Status:** Decided 2026-11-03, ruled by James in four questions, a fifth on what a call answers after a caught cycle, and a sixth on which computations a cycle ends (`notes/memoization-deliberation.md` is the deliberation record). Spec-only; implementation #1445. Amended 2026-11-03 (#1447): `JsValue.toArray`'s look joins the keepers a cycle can run through (§3.3, §3.4). This document discharges the "`memoFix` / open-recursion support surface" row of `stdlib-roadmap.md` §2. Its companion edits are:
- Effects §6.2, where species (d) states its obligation in closed form and every keeper gains one rule for cycles, and §7's coupling paragraph;
- Collections Part 2 §2, §3.2 and §4.4, where `Hash` gains `same`, with its rows in Parts 3 and 4 (Part 4 also gains a runtime obligation) and Dec §8;
- FFI Part 3 §4 and §7.1 to §7.5, where `ReentrancyFault` gains a second raiser and every keeper gains one rule for cycles (§7.5), with §9.4, and FFI Part 11 §7's guarded reads;
- Functions §6, whose self-reference refusal gains the open-recursion rewrite, and §7.5, which is corrected;
- Loops §6.4, where `Seq.memoize` gains its cycle sentence;
- `stdlib-roadmap.md` §2's row and §5's migration table;
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
- FFI Part 3 §7.3 to §7.5 (`ReentrancyFault`, and what a cycle leaves behind).
- Method Syntax §5 (no dot dispatch on a function).

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
    memoizeRecursive((_, key: a) => f(key))
```

- **`memoizeRecursive(body)`** returns a function that answers `body(self, key)` for each key, where `self` is that same memoised function. So the recursive calls `body` makes through `self` are memoised too.
- **`memoize(f)`** remembers the answers of a function that does not call itself. It is `memoizeRecursive` with `self` ignored: one line of ordinary Hexagon over the intrinsic row, not a second intrinsic.
- **Both take only `->` functions (§4).**
- **Both need the key to honor `Hash`.** A function of several arguments is memoised over a tuple, whose `Hash` is structural (Collections Part 2 §2.5).
- **A lambda handed straight to either one writes its key's type, unless the key is an `Int`.** The key reaches only the lambda's input, so Numeric Literals §4's box rule makes an unwritten one `Int` before the body is read: `Function.memoizeRecursive((self, word: String) => …)`. A named function, like `blinkOpen` below, writes its parameter types anyway.

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

- **No dot call.** A function value has no companion (Method Syntax §5), so these are always written qualified, never `f.memoize()`.
- **`Seq.memoize` shares the word in the same sense,** keeping what has been computed, and lives in another module.

## 3. Meaning

### 3.1 One table per memoised function

Each evaluation of `memoizeRecursive(body)` creates a new function with a table of its own. The table starts empty and is reachable from nothing else. Two evaluations with the same `body` give two independent tables, and a function has no `Eq`, so no Hexagon program can tell them apart, unless foreign code calls one of them in particular (FFI Part 3 §7.5).

**The table lives as long as the function does.** Entries are never evicted. This is documented the way `Seq.memoize`'s retention is: "at the cost of retaining what has been produced". To memoise once, bind the result with `let`. `fun f(n) = Function.memoize(g)(n)` builds a new table on every call and remembers nothing (§8's book note).

### 3.2 A call

A call `g(key)` of a memoised function `g` proceeds in this order:

1. **Look up.** The table places keys by their `Hash.hash`, mixed with the per-process seed as `Map` places them (Collections Part 2 §2.4). An entry answers this key when its key is `Hash.same` as `key` (Collections Part 2 §2.3), and then the call returns the filed answer. `==` decides nothing here: two keys `==` can't tell apart may still differ in a way a function can see (Collections Part 2 §2.3's examples).
2. **Refuse a cycle.** If a key `same` as `key` is in progress in this table (an enclosing call of `g` is computing its answer), the call throws `ReentrancyFault` (FFI Part 3 §7.4). Plain recursion would never return here, because a pure `body` asked for the same key again repeats the same calls. The request closes a cycle (§3.3).
3. **Compute.** Otherwise the key is marked in progress, and `body(g, key)` is evaluated. When it finishes, the mark is removed, and then:
   - **If the key is not on a cycle** (§3.3), an answer is filed and returned, and a throw files nothing and propagates. Under `->` a throw is a fault, or a foreign throw that broke a row's claim (Exceptions §6).
   - **If it is on a cycle,** nothing is filed, and the call throws `ReentrancyFault` in place of whatever `body` returned or threw.

Each write files one finished answer, so a call that comes back into the table sees either no entry or a finished one, never one half made.

### 3.3 Which computations end in the refusal

Faults are catchable in pure code (Exceptions §1: "Catching is legal anywhere, pure code included"), so a `body` may catch `ReentrancyFault` and answer something else. But where a cycle is refused depends on which key it was entered from. Two keys that each ask for the other, and fall back when the request is refused, show it:

```hexagon
let open(self: (Int) -> Int, key: Int): Int =
    try
        self(1 - key)
    catch
        ReentrancyFault => -1 - key
```

Entered at `0`, the request for `0` made inside key `1`'s computation is refused, and that computation answers `-2`. Entered at `1`, the same computation is the outer one, and the inner request for `1` is refused instead. An answer computed on a cycle after catching its refusal is a fact about the call history, not about its key: filed, it would show that history through every later hit, and returned, it would show it to the caller.

So **every key on the cycle a refusal closes files nothing and ends in `ReentrancyFault`, and so does every later call for it** (§3.2). This is FFI Part 3 §7.5's rule for every keeper, which the table follows:
- The cycle is the key asked for and every computation in progress inside it: of this memoised function, of another, of a memoizing `Seq` spine, of a guarded read (FFI Part 11 §7), or of `JsValue.toArray`'s look (FFI Part 11 §4.2).
- Cycles that share an entry are one cycle.
- A computation that reads a refusal or swallowed answer kept by an entry of a cycle, while an entry of that cycle is in progress, ends the outermost entry of that cycle in progress, and every computation in progress inside it, in the refusal, and they join the cycle.

In `open`, both keys are on the cycle whichever is entered first, so `g(0)` and `g(1)` both throw `ReentrancyFault`, in either order. Catching works on a cycle, but it cannot turn the cycle into an answer. A search in which a cycle means "no answer" carries what it has visited in its key and returns an `Option` (§4).

**A computation that encloses a cycle is not on it.** It meets the refusal as it meets any other fault, and may catch it and answer:

```hexagon
let probe(self: (Int) -> Int, key: Int): Int =
    if key == 0 then
        try
            self(1)
        catch
            ReentrancyFault => 7
    else self(key)
```

Key `1` asks for itself, so it is on a cycle, and every call for it throws `ReentrancyFault`. Key `0` asks for key `1` and is never asked for in return, so it only encloses that cycle. It catches the refusal and answers `7`, in a fresh table and after a call for key `1` alike, and that answer is filed. Filing it is safe, because key `1` ends the same way whichever key its cycle was entered from. For the same reason `Function.memoize(f)` answers as `f` does when `f` catches the refusal of another memoised function's cycle.

Any other fault needs no such rule. A pure `body` reaches the same fault for a key whichever call comes first, so filing nothing for the failed key is enough.

### 3.4 What the memoised function equals

A computation **requests** an entry when it calls a memoised function for a key, pulls a position of a memoizing sequence, makes a guarded read, or asks `JsValue.toArray` for an object's look: the keepers of FFI Part 3 §7.5. A key is **on a cycle** when some chain of requests from its computation comes back to that key, each request being answered by the rule below before the computation makes its next one. These are the keys the runtime finds on a cycle (§3.2, §3.3), whichever key is asked for first. Then every call `g(key)`, in any table state and in any context, inside other calls of `g` or not, does one of two things:

- **If `key` is on a cycle, the call throws `ReentrancyFault`,** or never returns, where a computation on the cycle catches the refusal and then never finishes.
- **Otherwise it does what `body(g, key)` does,** with every request `body` makes answered by this same rule.

The runtime of §3.2 and FFI Part 3 §7.5 gives exactly this:
- **A key on no cycle never reaches a computation in progress around it.** A computation in progress around it has a chain of requests that reached this key, so a request back to it would make a chain from this key to itself. So no cycle passes through this key, and the rule never ends its computation in the refusal: a refusal that reaches it is an ordinary throw. Every hit it takes is an answer filed by a computation on no cycle. Every refusal it meets comes from an entry on a cycle this key is not on, which answers the refusal by this same rule. By induction, the computation does what `body(g, key)` does, and an answer is filed.
- **A key on a cycle ends in the refusal at every call.** Its computation follows its chain back to the key, which it reaches either still in progress, closing a cycle through it (§3.2), or through an entry of the key's cycle that kept the refusal, which ends the outermost entry of that cycle in progress, and every computation in progress inside it, the key's own included (FFI Part 3 §7.5). Either way the key files nothing, so the next call computes it again and meets the same cycle.

**Compared with plain recursion.** In a program without foreign code, replace `g` by `fun go(key) = body(go, key)`, every other memoised function by its own plain recursion, and every `Seq.memoize(s)` by `s`, which Loops §6.4 makes the same sequence wherever re-deriving it finishes. Then nothing keeps anything, and:
- **Where plain recursion returns an answer or throws a fault, `g` does the same.** Plain recursion would follow a chain of requests that comes back round for ever, so its finishing means no chain from the key comes back to anything on it. The key is on no cycle, nor is any key it reaches, and by induction each call answers as plain recursion does.
- **Where plain recursion never returns, `g` throws `ReentrancyFault`, never returns, or answers or fails as an enclosing catch makes it.** A key on a cycle throws the refusal, or never returns. A key on no cycle follows plain recursion's path, so it never returns either, unless that path reaches a key on a cycle and the key's own computation catches the refusal, as `probe`'s key `0` does (§3.3), and then answers or throws as its catch makes it.

So each key has one answer, or one fault, or the refusal, whatever the table holds and wherever the call is made, or it never returns. Which of the last two a key on a cycle does can depend on where the cycle was entered, and neither is an answer. No program can observe `g` answer one key two ways, and a hit and a miss are indistinguishable to every caller. That is species (d)'s obligation (Effects §6.2), discharged in closed form.

**Stack exhaustion is outside this argument, as it is outside plain recursion's.** A `body` that catches the platform's stack-overflow error depends on how deep it was called, memoised or not. Hexagon's purity does not model stack depth, nor the stack text `Exn.stack` reads from a caught refusal, which depends on where it was raised.

### 3.5 The lowering reads only its evidence

The table is placed by `Hash.hash` and decides hits by `Hash.same`, both read from the `Hash` dictionary the call passes (Intrinsics §3.4). The lowering never inspects a key's representation, so Intrinsics §4.2's parametricity holds as written.

## 4. The function handed in is `->`

`body` and `f` are pure and cannot fail (Effects §2.1). An argument that is impure or may fail is refused by ordinary unification, with the ordinary colour refusal (Effects §4.3).

- **Faults still pass through.** They are untracked (Exceptions §1), and §3.2 files nothing for a failed key.
- **A computation that may find no answer returns an `Option`.** It is Hexagon's channel for "not there", and an `Option` answer is filed and reused like any other. A thrown exception would be recomputed every time its key was reached, because failures are never filed, so memoising it buys nothing. §10.5 records the rejected failing sibling.
- **A failing signature cannot express this.** A signature where failure passes through, `((a) ->^ b, a) ->^ b`, would force every call, pure bodies included, to wear `^`. The arrow on `self` sits in a callback's own parameters, and Effects §2.4 makes it a constant there, so it cannot follow `body`'s own colour.

## 5. Costs

- **A call** costs one `hash` of the key, a search of its bucket comparing with `same`, and on a miss one insertion after the answer is computed.
  - `same` replaces `==` in the bucket search and does the same amount of work.
  - The in-progress check is one set membership, and taking part in FFI Part 3 §7.5's record of entries in progress is a push, a pop and a flag. Merging cycles costs something only on a refusal.
- **Memory** is one entry per distinct key ever asked for, kept for the function's lifetime (§3.1).
- **A refusal ends every computation on its cycle,** in this table and in others (§3.3). A search whose steps lie on a cycle gains nothing from catching the refusal, and writes what it has visited into its key.
- **Measured** on Advent of Code 2024 day 11 (75 blinks), with a JavaScript table standing in for the lowering around the compiled body:

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
| `let g = Function.memoize(…)` or `let g = Function.memoizeRecursive(…)` whose argument names `g` | The self-reference refusal (Functions §6) gives the open-recursion rewrite in place of its "use `fun`" advice, which here would lead to a table rebuilt on every call. At `memoize`, it repeats the lambda's own parameters, as written, after a new first parameter: "`fib` is not in scope in its own `let` definition; to memoise a function that calls itself, take it as a parameter: `let fib = Function.memoizeRecursive((self, n: Int) => …)`, calling `self` where the lambda calls `fib`". The new parameter is `self`, or another name where the lambda already binds `self`. At `memoizeRecursive`, it names the lambda's own first parameter ("call `me` where the lambda calls `fib`"), or, where that parameter is `_` or a pattern, says to name it. The advice is chosen by the right-hand side's text: a call, or pipe stage, that resolves to one of the two. | §1 |

No new refusal is introduced. The third row changes only the wording of an existing one, as the Rewrite Rule (Declarations Preamble §1.1) asks: a refusal names the local rewrite that keeps the writer's intent.

## 7. Implementation requirements

- **One intrinsic row** in `stdlib/Function.hex`, key `functionMemoizeRecursive` (Intrinsics §4.1).
  - Its lowering is a compiler helper (Intrinsics §4.1's helper family) holding the table in a closure, which no program and no foreign code can reach.
  - It receives the `Hash` evidence by the compiler's own convention (Intrinsics §3.4).
  - It is held to §3 as a conformance obligation (Intrinsics §4.2), and its species is Effects §6.2's (d).
- **`memoize` is ordinary Hexagon** in the same module.
- **`ReentrancyFault` is raised as FFI Part 3 §7.4 constructs it:** the branded representation built at the raise site, with this raiser's own message: "a memoised function's answer for this key depends on itself".
  - The helper takes part in FFI Part 3 §7.5's record of entries in progress. Helpers are emitted per module (FFI Part 3 §7.4), so the record lives in one place that every module's copy of the memo and spine helpers reaches, and Part 11's guarded-read lowering too.
  - A key on a cycle has its cycle recorded in the table, found by `same`, so a later computation of it that reads a refusal its cycle kept ends in the refusal (FFI Part 3 §7.5).
- **The table and the in-progress marks are the helper's own state, and the record of entries in progress is the runtime's,** as the `Seq` spine's memo is. No program can name them, so Statements §6.4 (no ref cell a program can spell) is untouched, and so is the rule against module-level `var` (§6.4's last bullet), which is about state a program can observe: §3.4 shows the record changes nothing a caller can see.
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
- **(d) Hits use `same`.** Over `Float` keys, `g(0.0)` then `g(-0.0)` evaluates `body` twice, and each answers what plain recursion answers. In the other order it does the same. A `Dec` pair `1.0` and `1.00` does likewise, and so does an `Int` `0` beside the `-0` that `0 * -1` leaves (Collections Part 2 §2.3).
- **(e) A cycle.** A key whose body asks for itself, directly or through other keys, throws `ReentrancyFault`, where plain recursion would loop forever.
- **(f) Catching on a cycle rescues nothing.** With §3.3's `open`:
  - `g(0)` and `g(1)` each throw `ReentrancyFault`, in either order and in a fresh table, and no key is filed;
  - a body that catches the refusal and then throws another fault still ends in `ReentrancyFault`;
  - the same holds when the cycle runs through a second memoised function, through a memoizing `Seq`, or through a guarded read whose getter calls `g`;
  - a key whose plain recursion returns, asked for after the refusal, answers as in a fresh table.
- **(g) A failed key files nothing.** A body that faults for one key faults again on the next call for that key, and its siblings' answers are filed.
- **(h) Colour.** A `body` that throws a tracked exception is refused with the colour refusal, and a pure one gives bare calls.
- **(i) The rewrite.** `let fib = Function.memoize((n: Int) => if n <= 1 then n else fib(n - 1) + fib(n - 2))` draws §6's rewrite naming `Function.memoizeRecursive` and writing `(self, n: Int)`. A lambda whose first parameter is `_` draws the advice to name it. `let fib = Function.memoizeRecursive((me: (Int) -> Int, n: Int) => … fib(n - 1) …)` draws the advice naming `me`. A self-reference under any other right-hand side keeps "use `fun`".
- **(j) Enclosing a cycle is not being on it.**
  - With §3.3's `probe`, `g(0)` answers `7` and `g(1)` throws `ReentrancyFault`, in either order, and key `0` is filed.
  - With `let loop = Function.memoizeRecursive((self, x: Int) => self(x))`, and an `f(x: Int): Int` whose body is `loop(x)` inside a `try` whose one catch arm is `ReentrancyFault => 0`, each of `f(1)`, `Function.memoize(f)(1)`, and the first element of `Seq.memoize` over a sequence whose first element is `f(1)`, is `0`, in any order.
- **(k) One outcome in every order.**
  - Take a body whose answer for each key is a `Seq.memoize`d sequence whose first element, when read, is the first element of `self(1 - key)`, or `-1 - key` where that read throws `ReentrancyFault`. In each of two tables built from it, reading the first element of either key's sequence throws `ReentrancyFault`, whichever is read first, and the two tables agree.
  - Take a body in which key `1`'s answer is such a sequence whose first element calls `self(0)`, and key `0` reads that first element and answers `0` where the read throws `ReentrancyFault`. `g(0)` throws `ReentrancyFault` on its first call and on every later one, and reading the first element of key `1`'s sequence throws `ReentrancyFault`.

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

### 10.7 Returning an answer computed on a cycle

Filing nothing, but returning what a key on the cycle answered after catching the refusal. Rejected: that answer depends on which key the cycle was entered from (§3.3's example), so `g` would answer one key two ways, and species (d)'s obligation (Effects §6.2) would need an exception naming it, beside stack exhaustion. GHC gets the same guarantee by letting no pure code catch its `NonTermination`. Hexagon lets pure code catch, so a key on the cycle ends in the refusal instead.

### 10.8 Ending every computation in progress

Ending in the refusal every computation during which a refusal was raised, on the cycle or not, with one runtime-wide count of raises. Rejected: it changes answers off a cycle. A computation that only encloses a cycle and catches its refusal, as `probe`'s key `0` does (§3.3), does not depend on where the cycle was entered, yet would end in the refusal. `Function.memoize(f)` would then refuse where `f` answers, and `Seq.memoize(s)` would fail where `s` reads (Loops §6.4), wherever `f` or `s` catches another memoised function's cycle.

## 11. Precedents consulted

| Language | Memoised recursion | Cycles |
|---|---|---|
| OCaml (Jane Street Core) | `Memo.recursive`, keyed by a hashable | "does not detect or prevent infinite loops" |
| Haskell | MemoTrie's `memoFix`, trie-keyed | the runtime may report `NonTermination`, with no guarantee |
| Swift | WWDC 2014's `memoize<T: Hashable, U>(body: ((T) -> U, T) -> U)`, non-throwing | none |
| Python | `functools.cache` and `lru_cache`, through the decorated name | none documented |
| Elm, Rust, F#, TypeScript | none in the standard library | |

`functools`, OCaml's `Fun` and Haskell's `Data.Function` are the precedents for a module of function tools. GHC's thunks are the precedent for §3.3: when the runtime finds a thunk demanding itself it raises `NonTermination` (`<<loop>>`), every thunk under evaluation that the exception passes through is suspended where it stood, so demanding it again meets the loop again, and pure code cannot catch the exception, so nothing that depends on where the loop was entered reaches a value. OCaml's `Lazy` is the precedent for letting the code around a cycle catch its refusal and carry on: forcing a suspension that is already being forced raises `Lazy.Undefined`, and a suspension whose forcing raised raises the same exception again. OCaml keeps whatever a suspension's own forcing produced, caught or not, which FFI Part 3 §7.5 rejects for an entry on the cycle.
