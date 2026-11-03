# Memoization: the deliberation record

**Status:** Notes, not normative. The five write-ups James ruled on, 2026-11-03, kept verbatim as they stood at each ruling. `spec/memoization.md` is the decided text. The parts were separate files during the deliberation, `MEMOFIX.md` (question 1), `MEMOFIX-Q2.md` to `MEMOFIX-Q4.md`, and `MEMOFIX-CYCLE.md` (raised by the spec's review), and refer to each other by those names. The probes they cite were run on the deliberation's branch and are not kept in the repository.

---

## memoFix: memoised recursion in v1

**Status:** decision 5 of the Advent of Code survey (`STDLIB-V1-GAPS.md`, item 5). Question 1 ruled (a) by James on 2026-11-03: ship `memoFix`. The representation rule for hits described below collides with Intrinsics §4.2, so question 2 (`MEMOFIX-Q2.md`) decides how hits are made instead.

### The question

Should v1 ship `memoFix`, the function the spec already promises for memoised recursion?

The language can't express it, so it would have to be a function the compiler provides, running over a table no program can name. That needs one sentence of doctrine sharpened in Effects §6.2.

The other answer is to drop it, as Elm does, and teach devs to pass the cache along by hand or to write a loop.

### The three checks, up front

- **Fits doctrine?**
  - Option (a) fits with one sharpening. Species (d) already admits an "owned memo" when the memo is transparent. What it forbids is a callback, and this write-up argues the callback ban is one way of meeting the real obligation rather than the obligation itself. Purity stays a fact about values, and Statements §6.2 and §6.4 are untouched.
  - Option (b) fits with no change, but it withdraws two sentences of Functions §7.5 and a ledger row, all three written on a premise that turned out to be false.
- **Colleague languages considered?** Yes; the table is at the end.
  - Every colleague that offers memoised recursion uses this shape, a function handed "itself" plus a hashable key: OCaml's Jane Street `Core.Memo.recursive`, the `memoize` from Apple's own WWDC 2014 Swift session, and GHC's `memoFix` in the MemoTrie package. Python's `functools.cache` gets the same effect by rebinding the function's global name.
  - Elm, the colleague whose purity matches Hexagon's, offers no memoisation at all.
- **HM?** `memoFix<a: Hash>(open: ((a) -> b, a) -> b): (a) -> b` is an ordinary rank-1 scheme with one constraint, like `Map.get`. Inference changes under neither option.

### Why this comes back to you

The spec promises `memoFix` as ordinary Hexagon code. Functions §7.5:

> `memoize` itself is an ordinary higher-order function and fully writable in Hexagon … tie the knot with a `memoFix` combinator (a v1 listing obligation at `stdlib-roadmap.md` §2; fully expressible in Hexagon) … (`memoFix` builds a map, defines a local `fun go(n)` that consults the map and calls `f(go, n)` on miss, and returns `go` — all expressible under these rules.)

Statements §6.2 says the opposite:

> A lambda may not reference a `var` declared outside itself — neither reading it nor assigning it.

Statements §6.4 adds that there are no ref cells. The compiler agrees with Statements. Written exactly as §7.5 describes, `memoFix` is refused three times, once at each use of the cache:

```
`cache` is a `var` and cannot be used inside a lambda; copy it to a `let` first
```

So neither `memoFix` nor §7.5's general `memoize` can be written in Hexagon, and that is by design. Effects §7 says this fence is what makes a `->` face a fact rather than a convention. The ledger row (`stdlib-roadmap.md` §2, "listing: prelude functions") was ruled on the belief that `memoFix` was a library function like any other. That belief is false, so the row needs your decision again before anyone implements it.

### What devs need it for

Memoised recursion is a staple of Advent of Code: 2020 day 10, 2022 day 16, 2023 day 12, and 2024 days 11 and 19. I measured 2024 day 11 (count the stones after 75 blinks) three ways, on main with this branch's compiler. The program run was about 45 ms of Node startup, subtracted below.

| How it's written | Lines | 75 blinks |
|---|---|---|
| Recursion that passes a persistent `Map` cache in and out of every call (what v1 allows today) | 26 | about 0.58 s |
| A loop over a `Map` from stone to count (the puzzle's loop answer) | 18 | about 0.36 s |
| The same recursion through `memoFix`, simulated by a JavaScript table around the compiled open function | about 13 | 0.11 to 0.20 s, depending on how the key is hashed |

The threaded version also has a trap. In the branch where a stone splits, the second recursive call has to receive the cache the first call returned. If it is handed the older cache instead, the answers stay right, but every entry the first call made is lost:

- at 35 blinks it ran in 5.7 s instead of 0.15 s;
- at 75 blinks it hadn't finished after two minutes.

Nothing in the language or the compiler can point at the mistake, because the program is correct. `memoFix` has no such trap, since there is no cache to pass.

The loop answer is a real option for this puzzle, and the book should teach it whichever way you decide. It isn't available everywhere. 2022 day 16 and 2023 day 12 are searches over states, and their natural answer is recursion that memoises.

### Option (a): a compiler-provided `memoFix`

What a dev writes:

```
fun blinkOpen(self: ((Int, Int)) -> Int, key: (Int, Int)): Int =
    let (stone, steps) = key
    if steps == 0 then 1
    else if stone == 0 then self((1, steps - 1))
    else ... self((stone * 2024, steps - 1))

let blink = memoFix(blinkOpen)
```

How it behaves:

- **Its own table.** `memoFix(open)` returns a function with a table of its own, which nothing else can reach.
- **A call.** A call looks its key up. On a miss it runs `open(self, key)`, files the answer and returns it. `self` is the memoised function, so the recursive calls are memoised too.
- **Failure files nothing.** A fault or exception thrown by `open` propagates, and its key stays unfiled.
- **A cycle is a fault.** If a key is asked for while its own answer is still being computed, plain recursion would never finish. `memoFix` raises a fault there instead. Seq's memoising spine already does exactly this, with the message "a sequence position cannot depend on its own value".
- **The table is kept.** It lives as long as the function does. That is documented the way `Seq.memoize`'s retention is: "at the cost of retaining what has been produced".

**Why the face is honestly pure.** Effects §6.2 species (d) already admits an *owned memo*, on one condition: it must be semantically transparent, meaning "every entry must be a value function of the key it is filed under, so that a hit and a miss are indistinguishable to every caller". `memoFix` meets that by construction:

- `open` sits at a `->` seat, so its purity is checked by the compiler, not trusted.
- A miss computes `open(self, key)`, which is the answer plain recursion gives.
- Every write files one answer that is already finished, so a call made back into the table sees either no entry or a finished one.

Transparency needs one more thing than purity: a hit has to be for a key that no Hexagon function can tell apart from the key that was filed. `Eq` doesn't promise that. Measured on main, Float's `0.0 == -0.0` is `True` and both hash to 48, yet `1.0 / 0.0` is `Infinity` and `1.0 / -0.0` is `-Infinity`. A hand-written `Eq` that compares only an `id` field is lawful too. A table that trusted `Eq` alone would let the order of earlier calls show through: ask for `0.0` first and `-0.0` gets its answer. So a hit also requires the two keys to have the same representation. An `Eq`-equal key with a different representation is a miss, computed and filed beside the first. With derived equality that never happens, and the details belong to question 2.

**The one sentence it conflicts with.** Effects §6.2:

> A species-(d) row runs no Hexagon code but its own lowering. It takes no function-typed parameter of any colour, pure callbacks included, since a pure Hexagon function may call the row again. So nothing can re-enter it and observe storage mid-write …

That sentence protects against code that calls back in and sees storage half-written. `memoFix` can't be seen half-written, because each write files one finished answer, and a key still being computed is refused. The ban is a means. What it secures, a value function of the row's arguments, is the obligation.

So I'd state the obligation in closed form instead of adding an exception for `memoFix`:

> **A species-(d) row is a value function of its arguments under every call its own callbacks can make back into it.** Scratch and frozen storage meet that by taking no callback. An owned memo may take a callback that is pure and cannot fail, provided each of its writes files one finished entry, a hit is for a key of the same representation as the one filed, and a key asked for while its entry is being computed is refused with a fault.

Two things about that rewording:

- The three members species (d) has today (`Regex.hex`'s `compileProgram` and `searchProgram`, and the confined `Buffer`) are unaffected.
- Species (d) stays intrinsic-only, so a dev's own extern row can't claim the memo shape. That keeps the claim where the compiler verifies the row.

**It is not new ground.** `seqMemoize`, filed under species (b), already runs pure Hexagon thunks when its source is a Hexagon sequence. It keeps their results and refuses a re-entrant force with `ReentrancyFault`. `memoFix` is that, keyed by value instead of by position.

**What it costs:**

- Effects §6.2's sentence as above.
- A spec home for `memoFix`, with the cycle fault and the representation rule.
- Corrections to Functions §7.5's two sentences.
- The intrinsic and its lowering.
- A book section.
- Memory: a table is kept for as long as its function lives.
- One more place where the runtime is impure under a pure face, which review has to hold to the transparency argument on every change.

### Option (b): Elm's answer, no `memoFix`

Devs pass the cache along by hand, or write the loop.

- Functions §7.5 is corrected to say that memoised recursion threads its cache, and the ledger row is retired.
- The book teaches threading and the loop answer side by side.
- `fun fib = memoize(...)` stays refused, as it rightly is today, and its rewrite still works.

What it costs, measured above:

- about twice the code;
- a mistake that is silent and can make a run hundreds of times slower;
- three to five times the run time of option (a) on the probe;
- the language's one restricted recursion pattern, the one §7.5 is about, loses the idiom it points devs to.

What it saves: no doctrine sentence, no intrinsic, and nothing new for review to watch.

### What would bring this back

- **Additions are safe under (a).** A size bound (Core's `cache_size_bound`, Python's `lru_cache(maxsize)`) or a callback that may fail (a following arrow on the failure colour) could come later without breaking anyone's code.
- **(b) can be reversed.** Shipping (a) later is purely additive. Choosing (b) now forecloses nothing.
- **Threads or shared memory.** If Hexagon ever gets them, the table needs a lock or a per-thread copy. Core's documentation says its memo "is not thread-safe".
- **A memo-cell type.** A `Lazy` value, if one is ever designed, would fall under the same species sentence rather than needing its own.

### Recommendation: (a)

Ship `memoFix`, with the closed-form species sentence.

- **Transparency is the test the species already use.** Here it holds by construction, purity of the callback checked and every write finished. It isn't a promise about what the compiler refrains from doing.
- **The obligation was ruled for v1, and §7.5 points devs at it.** The language's one restricted recursion pattern would otherwise send them to a combinator that doesn't exist.
- **The cost of (b) falls on devs, silently.** The probe's slip gives right answers slowly, and no diagnostic can see it.
- **Colleagues agree on the shape, and differ on the cycle.** Every colleague that offers memoised recursion offers this one. None of them detect a cycle; Core says so outright. (a) would refuse one with a fault, which is the Hexagon-shaped improvement.

### If you choose (a), the questions after this one

2. **The signature and semantics:**
   - the key constraint (`Hash`, as `Map` has);
   - the representation rule for hits;
   - the callback's colour (`->` only in v1, or failure passing through);
   - the cycle fault (reuse `Seq.ReentrancyFault`, or a new fault named for the cycle).
3. **The name and home:**
   - where `memoFix` lives (there is no `Function` module yet);
   - whether `memoize` for a plain function ships beside it. It is `memoFix` with `self` ignored, and §7.5 promises it too.

### Colleagues

| Language | Memoised recursion | Shape | Cycles |
|---|---|---|---|
| OCaml (Jane Street Core) | `Memo.recursive : hashable:'a Hashable.t -> ?cache_size_bound:int -> (('a -> 'b) -> 'a -> 'b) -> ('a, 'b) fn` | open recursion, hashable key | "does not detect or prevent infinite loops"; "not thread-safe" |
| OCaml (stdlib), SML | none; a `Hashtbl` and a ref by hand | | |
| Swift | no stdlib function; Apple's WWDC 2014 "Advanced Swift" session presented `memoize<T: Hashable, U>(body: ((T) -> U, T) -> U) -> (T) -> U` | open recursion, `Hashable` key | none |
| GHC | none in `base`; MemoTrie's `memoFix :: HasTrie a => ((a -> b) -> (a -> b)) -> (a -> b)`, and laziness memoises lazily built tables | open recursion, trie-keyed | a self-dependent lazy entry can meet the runtime's `NonTermination` ("thrown when the runtime system detects that the computation is guaranteed not to terminate", with no guarantee it notices) |
| Python | `functools.cache` / `lru_cache`; the recursive call goes through the decorated global name | name rebinding, hashable arguments | none documented; deep recursion meets `RecursionError` |
| Rust | none in std; the `cached` crate, or a `&mut HashMap` passed down by hand | | |
| F#, TypeScript | none; a `Dictionary` or `Map` closure by hand (lodash's `_.memoize` isn't recursion-aware) | | |
| Elm | none, and no mutable state to build one from; devs thread a `Dict` | | |

Sources:
- [Core.Memo](https://ocaml.org/p/core/latest/doc/Core/Memo/index.html)
- [MemoTrie source](https://hackage.haskell.org/package/MemoTrie-0.6.9/docs/src/Data-MemoTrie.html)
- [the WWDC 2014 memoize](https://gist.github.com/natecook1000/58e61d492fd09efe3d9d) (the gist cites session 404)
- [functools](https://docs.python.org/3/library/functools.html)
- [Control.Exception](https://hackage.haskell.org/package/base/docs/Control-Exception.html)

### Probes

The probes are Hexagon programs, run with this thread's runner on main with this branch's compiler. They are in the thread's scratchpad `memo/`:

- `Thread.hex`, the threaded cache;
- `Freq.hex`, the loop;
- `Open.hex` with `harness.mjs`, the simulated `memoFix`;
- `Slip*.hex`, the older-cache mistake;
- `UserMemo.hex`, §7.5's `memoFix` refused;
- `Zero.hex`, Float's two zeros.

All three ways of writing day 11 give 237149922829154 for the 75-blink input.

---

## memoFix, question 2: when is a call a hit?

**Status:** decision 5 of the Advent of Code survey. Question 1 was ruled (a) by James on 2026-11-03: ship `memoFix` in v1 (`MEMOFIX.md`). This is question 2. Nothing here is decided yet.

### The question

When a call to a memoised function finds an entry already filed, how does `memoFix` decide that the entry answers this key?

The answer has to keep the memoised function honestly pure. Effects §6.2 asks that of an owned memo: "a hit and a miss are indistinguishable to every caller".

### Why this is a question and not a detail

`MEMOFIX.md` said a hit needs "a key of the same representation as the one filed". Written into the lowering, that check collides with Intrinsics §4.2:

> **Parametricity is part of the contract.** A generic intrinsic's implementation may move, store, and return values at its type parameters; it must never fabricate them, coerce them, or inspect them by type.

That rule is already enforced. Collection combinators §12.5 refuses to let `sortUsing` sort elements directly, because the platform's sort moves `undefined` to the end, and "sorting the elements would therefore inspect them by representation, which Intrinsics §4.2's parametricity forbids". The same reading closed the comparison door in `Map.map`.

So the rule I wrote in question 1 can't be built the way I described it without changing §4.2. This question picks how hits are decided instead.

### The three checks, up front

- **Fits doctrine?**
  - (A) fits with no doctrine change. The lowering uses only the evidence it is handed.
  - (B) needs an amendment to Intrinsics §4.2.
  - (C) fits, but needs a new kind of constraint.
  - (D) breaks species (d).
- **Colleague languages considered?** Yes, below.
  - OCaml's Core, Apple's WWDC 2014 Swift `memoize` and Python's `functools.cache` all key the memo by equality, and none of them guards against what this question is about.
  - Python documents the problem: `lru_cache` has a `typed` flag because by default `f(3)` and `f(3.0)` share one entry.
  - Rust avoids it another way: `f64` has no `Hash`, so a float can't be a `HashMap` key at all.
- **HM?** None of the options changes inference. (A) adds a member to an existing constraint, and (C) adds a constraint.

### What `==` can't see, measured

`Hash` keys, and so `memoFix` keys, are compared with `Eq`. Collections Part 2 §4.3 makes every user type's `Hash` derived, and requires its `Eq` to be derived too. So in user types, `==` compares field by field and misses nothing of its own. The gaps are all at the bottom, in instances the standard library writes.

I probed main with this branch's compiler, and each pair below is `==`-equal:

| Key type | Two equal values | What tells them apart |
|---|---|---|
| `Float` | `0.0` and `-0.0` | `1.0 / x` is `Infinity` and `-Infinity` (ruled: `Eq<Float>` is SameValueZero) |
| `Dec` | `Dec.create(10, 1)` and `Dec.create(100, 2)` | they show as `1.0` and `1.00`, and `places` gives 1 and 2 |
| `Map`, `Set` | the same two entries, `"Aa"` and `"BB"` (equal hashes, 2112), added in opposite orders | `Map.keys` gives `Aa;BB` and `BB;Aa` |
| `Int` | `0` and `0 * -1` | converted to `Float`, `1.0 / x` gives `-Infinity`. This one is a bug, open as #1277 |

The `Map` row is by design. Collections Part 2 §2.4 says iteration order "is not a function of the collection's contents".

A table that trusted `==` would let call order show through any of these. Ask for `g(0.0)` first and `g(-0.0)` gets its answer; ask in the other order and it doesn't.

### The options

#### (A) `Hash` gains a second member, `same`

```
export constraint Hash<a: Eq> =
    hash(value: a) -> Int
    same(left: a, right: a) -> Bool
```

The law: `same(x, y)` is true exactly when no Hexagon function can tell `x` and `y` apart. So `same(x, y)` implies `x == y`, and so `hash(x) == hash(y)`.

`memoFix<a: Hash>` places keys by `hash` and decides hits by `same`. It reads nothing but the dictionary it is handed, as `Map.get` does, so §4.2 holds unchanged.

Who writes `same`:
- **Every user type: the compiler.** Collections Part 2 §4.1 makes `Hash` derivable-only in user source, so `derives Hash` derives `same` field by field. No dev ever writes it, so no dev can write it wrong.
- **Tuples, structural records and `Unit`: the compiler**, automatically, as it does `Hash` today.
- **The standard library's own instances, under review:**
  - `Float`: SameValue (`Object.is`), so `0.0` and `-0.0` differ and every `NaN` is the same.
  - `Int` and `Nat`: SameValue too, which stays right before and after #1277.
  - `Dec`: the stored integer and the places. `Dec.same` already exists with exactly this meaning, so it becomes the instance.
  - `String` and `BigInt`: `==`.
  - `Map` and `Set`: the same entries in the same order, each compared with `same`.
  - `Vector`: element by element.
  - `Rat` and `Bool` are derived.

What it costs:
- one member on `Hash` and its law (Collections Part 2 §2.1 to §2.3);
- its derivation (§3);
- a `same` in each hand-written instance;
- the dictionary's TypeScript face (FFI Part 9);
- a sentence in the book.

A hit costs what it costs today, one comparison per entry in the bucket. `same` replaces `==` there and does no more work, though I'm reasoning that, not measuring it.

What devs get besides `memoFix`: an honest way to ask whether two equal values are interchangeable, such as `0.0.same(-0.0)`, which is `False`.

#### (B) The lowering compares representations, and Intrinsics §4.2 is amended to allow it

The runtime walks both keys' JavaScript representations. To avoid false misses, it reads a `Map` or `Set` by its iteration order rather than its internal shape. §4.2 would gain a closed-form exception: a lowering may compare values at a type parameter by representation where the comparison only chooses between two paths no Hexagon function can tell apart.

What it costs:
- It weakens a rule review has enforced twice this month.
- It puts a walker in the runtime that must know every representation the compiler emits, now and later.
- No dev can ask the same question the runtime asks.

The `Map.map` door would stay closed: that comparison chose which key was kept, which a program can see.

#### (C) Only keys whose `==` misses nothing

A new compiler-known constraint, say `Key<a>`, derived wherever every part's `==` is identity. `memoFix` would take `Key` keys.

What it costs:
- A new kind of constraint, its derivation and its diagnostics.
- Refusals for `Float`, `Dec`, `Map` and `Set` keys, and anything holding them. The natural key for 2022 day 16 is the valve, the set of opened valves and the minutes left, so it would be refused.

#### (D) `==` decides

This is what Core, the Swift `memoize` and Python do. The function's `->` face would stop being a fact for every key type in the table above.

It is ruled out by species (d) as written. I list it only so the choice is visible.

### Recommendation: (A)

- **Transparency holds by construction, through evidence alone.** Nothing in the lowering looks at a representation, so §4.2 keeps its full force.
- **It is the only option with no refusals and no doctrine change.** (B) changes doctrine, and (C) refuses keys devs will write.
- **The law sits where the gaps are.** Every gap is in a standard-library instance that review already holds to the `Hash` law (Collections Part 2 §4.4). User types inherit `same` from their fields with no new rule.
- **It matches a word Hexagon already uses.** `Dec.same` is exactly this question, asked of one type.

What would bring it back: v2's `derive via` (Collections Part 2 §11). If `Hash` ever gets instances that aren't derived, each must discharge `same`'s law as it does `hash`'s.

### What doctrine already decides (confirm only)

**1. The cycle fault is `Seq.ReentrancyFault`.** FFI Part 3 §7.4 settled this when it declared the fault:

> **The name is general, on `IndexFault`'s precedent** … Future machinery that must refuse re-entry into its own in-flight operation raises the same constructor rather than minting a sibling.

Only its doc comment changes, from "a sequence position" to its general meaning, and `memoFix` gets its own message.

**2. A cycle files nothing that was in progress.** Faults are catchable in pure code (Exceptions §1: "Catching is legal anywhere, pure code included"), so an `open` could catch `ReentrancyFault` and return a fallback. Where the cycle is found depends on which call came first. If the fallback were filed, call order would show through. So when `memoFix` raises the fault, every key still being computed is marked. Each one returns its answer to its caller but is never filed.
- Entries that are filed come only from computations that met no cycle, and those agree with plain recursion.
- Any other fault needs no such rule. It is the same for a key whichever call reaches it first, so filing nothing for the failed key is enough, as question 1 said.

**3. The cycle check uses the same test as a hit.** A key counts as being computed again only if it is `same` as one in progress. So the fault comes exactly where plain recursion would loop forever. Under `==`, `0.0` asking for `-0.0` would be refused, even though plain recursion might finish.

### What comes next

- **Question 3: the callback's colour.** My lean is `->` in v1, with `>^>` (pure, may fail) as a later addition that breaks nothing.
- **Question 4: the name and home**, and whether `memoize` ships beside `memoFix`.

### Probes

`Zero.hex` in the thread's scratchpad `memo/` gives the `Float` row. The other rows come from one compiler-test probe on main with this branch's compiler. Its output:

```
{"decEqual":true,"decPlaces":"1 2","decShow":"1.0 1.00","intEqual":true,"intRecip":"-Infinity","intShow":"0","mapEqual":true,"mapHash":"2112 2112","mapKeysAb":"Aa;BB","mapKeysBa":"BB;Aa"}
```

---

## memoFix, question 3: may the open function fail?

**Status:** decision 5 of the Advent of Code survey.
- Question 1 ruled 2026-11-03: ship `memoFix`.
- Question 2 ruled 2026-11-03: hits are decided by `Hash.same`, which stays a required member.
- Question 3 ruled (A) by James on 2026-11-03: `->` only. (B) is explicitly disfavoured, not deferred: memoising a failing computation is wasteful, so the shape for "no answer" is an `Option` result.

### The question

The open function is the one a dev writes and hands to `memoFix`.
- **Pure only:** must it be pure and unable to fail (`->`)?
- **Failures pass through:** or may it throw a tracked exception, with the memoised function then failing where the open one does?

A world colour that passes through isn't on the table. A memo that skips effects on a hit is not transparent, so species (d) rules it out.

Faults aren't part of the question. They are untracked (Exceptions §1), so a `->` open may already raise `IndexFault` or `KeyFault`, and question 1 already says a failed key files nothing.

### The three checks, up front

- **Fits doctrine?**
  - All three options keep the memo transparent. An exception from a pure function depends only on its key, so filing nothing on failure is enough, just as for faults.
  - (A) needs nothing new.
  - (B) adds a second name.
  - (C) changes the Effects grammar.
- **Colleague languages considered?**
  - Swift is the colleague whose failures are tracked like Hexagon's. Apple's WWDC 2014 `memoize` takes a non-throwing body.
  - Swift's `rethrows` can't express "throws where the body throws" here, because the body is also handed the memoised function itself, so its `self` parameter would have to be marked `throws`. That is the same knot as below.
  - Core (OCaml), MemoTrie (GHC) and Python don't track failure, so the question doesn't arise for them.
- **HM?** No change under any option.

### What I measured

I wrote `memoFix`'s shape as a plain fixed-point combinator (`go(n) = open(go, n)`, no table) and tried it on main with this branch's compiler.

- **Pure signature:** `fix(open: ((Int) -> Int, Int) -> Int): (Int) -> Int`.
  - A pure factorial compiles, and its call is bare.
  - An open that throws is refused with the ordinary colour refusal (Effects §4.3): "a `->` arrow promises the function cannot fail, and this function may fail — the demand is written `->`".
- **Signature where failure passes through:** `fix(open: ((Int) ->^ Int, Int) ->^ Int): (Int) >^> Int`.
  - A pure factorial written with `self: (Int) -> Int` is refused: "a `->` arrow promises the function cannot fail, and this function may fail".
  - Written with `self: (Int) ->^ Int`, it compiles. But every call to it is then refused without a mark: "this call may fail, so this call wants `^`".
  - With `self` left untyped, it is refused.

The cause is in Effects §2.4. An arrow in a callback's own parameters "describes a function the body hands to the callback", and it is a constant. The function `memoFix` hands to `open` is the memoised function itself. So `self`'s arrow would have to follow `open`'s own colour, and no written signature can say that. The failing signature therefore makes every caller pay for failure, pure callers included.

### The options

#### (A) `->` only in v1

`memoFix<a: Hash>(open: ((a) -> b, a) -> b): (a) -> b`.

An open that can throw catches the failure inside itself, or does the throwing work before the memo (parsing, say).

What it costs:
- A dev whose recursion throws a tracked exception has to restructure it before handing it to `memoFix`. The usual fix is to return an `Option` for "no answer", which is Hexagon's channel for something that isn't there, or to do the throwing work, such as parsing, first. That is the whole cost: a rewrite in that case, never a wrong answer. In the Advent of Code puzzles surveyed, the throwing work (`Int.parse`) already happens before the memo.

Is memoising something that throws sound at all? It is, but it's wasteful.
- **Sound.** For a pure function, an exception is just another outcome its key decides. Filing nothing on failure means a later call recomputes it and throws the same exception again, which is what plain recursion does.
- **Wasteful.** Because a failure isn't filed, a search that keeps reaching a failing key recomputes it every time, and memoising it buys nothing there. An `Option` result is filed like any value and reused, so it is the better shape on both counts.

#### (B) A second, failing sibling beside `memoFix`

The sibling has every arrow `->^` and every call marked `^`.

What it costs:
- A second name for the same idea.
- Its calls are marked even where nothing fails.

It can be added later without touching `memoFix`, so it isn't needed now.

#### (C) Let a callback's parameter follow its own colour

This changes Effects §2.2.1 and §2.4, which keep every arrow inside a parameter a constant.

What it costs:
- It reopens a grammar rule for one function. Effects is merged and settled.

### Recommendation: (A)

- **It's what the measured shape supports** with no new grammar and no second name.
- **Pure callers keep bare calls**, which is the common case: every probe in this survey is pure.
- **(B) remains an additive option later** if field use asks for it, as `MEMOFIX.md` said. The cost of waiting is only that a throwing search is written to catch its failures inside.

What would bring it back:
- programs that need a memoised search to propagate a tracked exception;
- a future Effects change that lets a callback's parameter follow its own colour.

### Next

Question 4: the name and the home, and whether `memoize` for a non-recursive function ships beside `memoFix`.

### Probe

`memo2/zz-colour.test.ts` in the thread's scratchpad. These are its results, quoted as the compiler printed them:

```
pureFix + open(self: ->), bare call         (clean)
pureFix + throwing open                     a `->` arrow promises the function cannot fail, and this function may fail — the demand is written `->`
failFix + open(self: ->), bare call         a `->` arrow promises the function cannot fail, and this function may fail — the demand is written `->`
failFix + open(self: ->^), bare call        this call may fail, so this call wants `^`, not no mark
failFix + open untyped self, bare call      this function may fail, where the function handed must be unable to fail — `self` is called bare, which makes it unable to fail
```

---

## memoFix, question 4: what is it called, and where does it live?

**Status:** decision 5 of the Advent of Code survey.
- Question 1, ruled 2026-11-03: ship it.
- Question 2, ruled 2026-11-03: hits are decided by `Hash.same`, which is required.
- Question 3, ruled 2026-11-03: `->` only, and a failing sibling is rejected.
- This is question 4, the last. Nothing here is decided yet.

### The question

The function needs three things settled:
1. **A home.** It can't be bare: Modules §5.5 closes the bare set, and functions get none.
2. **A name.** `memoFix` is what the spec says today.
3. **A sibling.** Should `memoize`, for a function that doesn't call itself, ship beside it?

The spec mentions `memoFix` in only two places: Functions §7.5 and the ledger row in `stdlib-roadmap.md` §2, "listing: prelude functions". Nothing in the book, the stdlib or the compiler uses the name, so renaming it costs those two edits. §7.5 needs rewriting anyway, since it claims the function is "fully writable in Hexagon".

### The three checks, up front

- **Fits doctrine?**
  - Every option keeps the bare set closed.
  - The naming doctrine (Collections Part 1 §3.1) bans "Haskell lineage where an ordinary word exists". Its rationale, a senior TypeScript developer reading the name on first contact, is the stdlib's general voice, though the section is written for collections.
  - `Fix` is Haskell lineage: the fixed-point combinator, via MemoTrie's `memoFix`.
- **Colleague languages considered?**

  | Language | Home | Names |
  |---|---|---|
  | Python | `functools` | `cache`, `lru_cache` |
  | OCaml stdlib | `Fun` | `id`, `const`, `flip`, `protect`; nothing for memoising |
  | OCaml (Jane Street Core) | `Memo` | `Memo.general`, `Memo.recursive` |
  | Haskell | `Data.Function` (`fix`); MemoTrie | `memo`, `memoFix` |
  | Swift | global, in the WWDC 2014 talk | `memoize`, for the recursive form |
  | TypeScript | lodash | `_.memoize` (not recursive) |

  `memoize` is the word a TypeScript developer already knows.
- **HM?** Names and homes don't touch inference.

### The options

#### (A) A new prelude module, `Function`, holding `memoize` and `memoizeRecursive`

```
fun fibOpen(self: (Int) -> Int, n: Int): Int =
    if n <= 1 then n else self(n - 1) + self(n - 2)

let fib = Function.memoizeRecursive(fibOpen)
let cheap = Function.memoize(expensive)
```

- **`Function` is the home for combinators that take and return functions.** It follows OCaml's `Fun`, Python's `functools` and Haskell's `Data.Function`. Its first two members are these, and nothing else is implied.
- **`memoizeRecursive` replaces `memoFix`.** It states what it is for in the word developers already know.
- **`memoize(f)` is `memoizeRecursive((self, x) => f(x))`.** It is one line of Hexagon over the intrinsic, not a second intrinsic. §7.5 already promises it, and `let cheap = memoize(expensive)` is its own example.

What it costs:
- a new prelude module and its seat;
- renaming `memoFix` in §7.5 and the ledger;
- one more export (`memoize`) to document and test.

`Seq.memoize` already shares the word, but in the same sense: keep what has been computed. The two never meet: a dot call on a function is never companion dispatch, since Method Syntax lists function types as ineligible, so `memoize` on a function is always written `Function.memoize(f)`.

#### (B) The same module, keeping the spec's names: `Function.memoFix` and `Function.memoize`

What it costs:
- No rename.
- It keeps a name the naming doctrine bans where an ordinary word exists. `memoize` and `memoFix` would read as two unrelated words for one idea.

#### (C) A `Memo` module, after Core: `Memo.recursive` and `Memo.function`

What it costs:
- It is a module named for a technique rather than a kind of value.
- `Memo.function` reads awkwardly.
- It leaves no home for a future `identity` or `compose`, which would need a third module.

#### What I set aside

- Putting it in `Hash` (`Hash.memoize`): what you'd look up is the function, not the key's constraint.
- Putting it in `Map`: the table is private, and nothing here is a `Map`.
- Putting it in `Prelude.hex`: that module homes the language forms' companions (`ignore`, `AssumptionFault`), not library functions.

### Recommendation: (A)

- **The name tells a TypeScript developer what it does.** `memoize` is already their word, and `Recursive` says which kind.
- **The home is where colleague languages put function tools**, and it reads naturally when qualified: `Function.memoize(f)`.
- **The rename is nearly free.** It is two spec edits before anything ships, and §7.5 is being rewritten anyway.
- **Shipping `memoize` keeps §7.5's promise.** It costs one line over the intrinsic.

What would bring it back: a second kind of memo, such as one with a size bound. That would decide whether `Function` keeps growing or memoising earns a module of its own.

### After this

With question 4 ruled, the decision is complete. Next come:
1. **A spec PR.** It covers:
   - Effects §6.2's species sentence;
   - `Hash.same` (Collections Part 2, and its FFI Part 9 face);
   - the new `Function` module's two entries, with the cycle rule and the in-progress rule;
   - `Seq.ReentrancyFault`'s generalised doc;
   - Functions §7.5 corrected;
   - the ledger row;
   - a book section.
2. **The same-day SPEC-ONLY implementation issue.**
3. **The implementation.**

---

## Memoization: what does a call answer after a caught cycle?

**Status:** Raised by the independent review of PR #1446 on 2026-11-03. Ruled (B) by James the same day, who asked that the doctrine be worded so that it stays true: Effects §6.2 now says a species-(d) row, and any function it returns, is a value function of its arguments, so that no program can observe it answer one argument two ways, and the memo's fourth term is what keeps that true.

### The question

Question 2's rulings cover two things when a key is asked for while its own answer is being computed:
- the request raises `ReentrancyFault`;
- an answer computed while a refusal was raised is not filed.

They don't say what such a call **returns**. The spec as I wrote it returns the answer. The review found that this breaks the claim the design rests on: that the memoised function is a value function of its argument.

The cause is that faults can be caught in pure code (Exceptions §1). When a body catches the refusal, what the inner call answers depends on which key the cycle was entered from. Here are two keys, each asking for the other and falling back if it catches the refusal:

```hexagon
let open(self: (Int) -> Int, key: Int): Int =
    try
        self(1 - key)
    catch
        ReentrancyFault => -1 - key

let g = Function.memoizeRecursive(open)
```

- **`g(0)`.** Key 0 asks for key 1, which asks for key 0. That last request is refused. Key 1 catches it and answers `-2`, and key 0 passes that on. So `g(0)` is `-2`, and inside it, `self(1)` answered `-2`.
- **A fresh `g(1)`.** The same happens the other way round, and `g(1)` is `-1`.

So `g(1)` answers `-2` inside one computation and `-1` outside. A body that returned what `self(1)` said, as part of its answer, would let a caller see both. (The example compiles today with a stand-in for `Function.memoizeRecursive`.)

### The three checks, up front

- **Fits doctrine?**
  - Effects §6.2 says of species (d): "The row over it is a value function of its arguments, or the claim is false."
  - Question 1 was ruled on the sharpened sentence: a row is a value function of its arguments under every call its callbacks make back into it.
  - The spec as written fails that inside a caught cycle. (B) below meets it. (A) keeps the current behaviour by writing an exception into the obligation.
- **Colleague languages considered?**
  - **GHC** is the close precedent. Forcing a thunk that is already being forced raises `NonTermination` (the `<<loop>>` error), and the thunk is left unevaluated, like our unfiled key. Pure code can't catch it, because `catch` lives in `IO`. So nothing that depends on where the loop was entered can leak into a value. Hexagon lets pure code catch faults, so it has to get the same guarantee another way, which is (B).
    *(Corrected 2026-11-03: "the thunk is left unevaluated" is loose. GHC raises `NonTermination` when its runtime finds a thread blocked on a thunk it is itself evaluating, and every thunk under evaluation that the exception passes through is suspended where it stood, so demanding it again meets the loop again. The precedent stands: pure code cannot catch the exception.)*
  - **Rust's `OnceCell::get_or_init`** panics on a re-entrant initialisation and leaves the cell empty. Catching a panic (`catch_unwind`) is outside ordinary code.
    *(Corrected 2026-11-03: this is wrong. Re-entrant `get_or_init` lets the inner initialisation finish and fill the cell, and the outer one then panics; it does not leave the cell empty. The point that catching a panic is outside ordinary code stands.)*
  - **Core's `Memo` and Python's `functools.cache`** don't detect cycles at all.
- **HM?** No change under either option.

### The options

#### (A) Keep returning the answer, and name the limitation

This is a text change only.
- **What the spec would claim:** the memoised function is a value function of its key at every call made while none of its table's keys is in progress, and every hit is such an answer.
- **The limitation:** inside a cycle, a body that catches the refusal sees where the cycle was entered. That puts it on the same footing as a body that catches stack exhaustion, which is how plain recursion answers a cycle.

What it costs:
- Species (d)'s obligation gets an exception, so the `->` face is no longer quite a fact.
- A dev can write a memoised function whose inner answers disagree with its outer ones, as in the example.

#### (B) A call whose computation spans a refusal ends in the refusal

**What changes.** As ruled, nothing is filed. In addition, the call throws `ReentrancyFault` in place of whatever it computed, whether it would have returned or thrown something else. Catching still works inside the body, but it can't rescue the answer: every computation around the refusal, out to the outermost, ends in it.

**What that buys, in closed form.** Every call of the memoised function, in any table state and any context, gives one of three results:
- what plain recursion answers, where plain recursion returns;
- the same fault, where plain recursion faults;
- `ReentrancyFault`, where plain recursion repeats a key.

Only calls inside a computation that is already ending in the refusal can depend on context, and nothing they see escapes.

What it costs:
- **Catching the refusal can't turn a cycle into an answer.** A search where a cycle means "no path" carries the path or visited set in its key, or is written as a loop. That's the rewrite question 3 asked for a failing body: "no answer" is data, an `Option`, rather than a caught failure. Plain recursion never answers there either, since it never returns.
- **A refusal from a `Seq` spine counts too.** Suppose a memoizing `Seq`'s spine refuses re-entry while a memoised body is running, and foreign code catches that refusal. The body's computation still ends in `ReentrancyFault`, where plain recursion might have answered. The result is a refusal, never a different answer. Reaching that case needs a foreign iterator re-entering its own sequence inside a memoised body.

### What I measured

The reviewer wrote a JavaScript simulation of the spec's algorithm, with random bodies that catch the refusal: 4,000 programs, and 48,000 outermost calls after random call histories. This is a simulation, not compiled Hexagon.

- **The spec as written.** In 524 programs, an inner call of a cycle key answered differently from the same key's outermost call. No outermost answer differed from a fresh table's, and no key whose plain recursion returns ever answered differently.
- **The same check with (B).** It found no problems of any kind. It also confirmed two further things:
  - every outermost call of a key whose plain recursion repeats throws `ReentrancyFault`;
  - every inner call made before any refusal answers what a fresh table answers.

### Recommendation: (B)

- **Doctrine decides it.** Species (d)'s obligation is a value function, and question 1 was ruled on that sentence. (A) keeps the obligation only by listing an exception.
- **It is GHC's guarantee,** reached the way Hexagon has to reach it, since pure code here can catch.
- **It takes away nothing plain recursion gives.** Catching a cycle inside a memo was never a way to reach an answer plain recursion reaches, because plain recursion never returns there.
- **Question 2's three confirmed points are unchanged:** the cycle raises `ReentrancyFault`, keys in progress stay unfiled, and the check uses `same`.

What would bring it back: a real program that needs to recover from a cycle inside a memoised function and can't carry the path in its key.

### What changes in PR #1446 if you confirm (B)

- `memoization.md`: §3.2's third step, §3.3, §3.4, test (f), and a new §10 entry recording (A).
- Effects §6.2's fourth term.
- FFI Part 3 §7.4's recognition bullet.

I've written (B) into the PR so you can read it in place. The PR won't merge until you rule.

---

## Memoization: what the runtime may keep after a cycle

**Status:** Ruled (C) by James on 2026-11-03: a refusal ends exactly the cycle it closes, in every keeper. That settles #232 as the (C) section describes, narrows (B)'s wording and question 2's "every in-progress key" to keys on the cycle, and changes #123's second consequence. Written for his two questions on `MEMOFIX-CYCLE-SPINE.md`. Two independent reviews found no counterexample, and their refinements are folded in below. #1447 follows.

### The short answer

- **The mark only moved the problem.** You were right to be nervous.
- **The design was wrong in one place.** The runtime has three places where it works something out once and keeps the answer. Each was given its own rule, at a different time, for a request that arrives while that answer is still being worked out. Patching one place at a time finds the next place.
- **The spine has to keep the refusal.** Today a foreign iterator can swallow the refusal and carry on (#123). No closed rule can keep that behaviour, and I measured it on the shipped compiler: it already depends on the order things are traversed in.
- **There are two ways to write the one rule, and I recommend the precise one.**
  - The broad way ends everything that was in progress when the refusal was raised. (B) as you ruled it is the memo half of the broad way.
  - The precise way ends exactly the cycle the refusal closes.
  - The broad way has a cost I didn't show you when you ruled (B): `Function.memoize(f)` can disagree with `f`. The precise way removes that cost.
- **The independent reviewer also found a separate bug,** which has nothing to do with memoization. I filed it as #1447.

### Path 1: does the mark solve it, or only move it?

It only moves it. There are two pieces of evidence.

**Round 3 needs no memoised computation at all.**
- The mark changed what a memoised computation does when it reads a marked position. It left the position itself holding the value computed after the catch.
- Round 3 reads that position from ordinary code, after every memoised call has finished, and sees where the cycle was entered.
- Two memoised functions built from the same body, in one program, give one key's first element as `-2` and `-1`.

**A third place has the same hole, and none of the rounds looked at it.** When a program asks for a thrown JavaScript value's message, stack or name, the runtime reads the property once, guarded, and keeps the answer (FFI Part 11 §7). The guard swallows any throw into `""`, a cycle refusal included.
- A memoised call reads a thrown value's message. The value's getter calls an exported Hexagon function, which asks the same memoised function for the same key. That request is refused.
- The guard swallows the refusal and keeps `""`. The memoised call met a refusal, so by (B) it ends in `ReentrancyFault`.
- The next call of the same key reads the kept `""`, meets no refusal, and files an answer.

So one key answers `ReentrancyFault` and then a value, in one program. No catch in the dev's code is needed, because the guard is the catch. Part 11 lets a getter do anything, so no foreign code broke a contract.

**Measured.** I extended the reviewer's JavaScript model of the spec to cover all three keepers. Each run is 3,000 random programs and about 390,000 memoised calls. Bodies, sequence steps and getters may all catch the refusal. The numbers are programs, on three seeds.

| Rules | One key answered two ways in one program | Answers that depend on call order |
|---|---|---|
| The PR as it stands: (B) plus the mark | 750, 691, 683 | 801, 762, 749 |
| The precise rule, (C) below | 0, 0, 0 | 0, 0, 0 |
| The broad rule, (U) below | 0, 0, 0 | 0, 0, 0 |

This is a model of the spec, not compiled Hexagon, because `Function.memoizeRecursive` isn't implemented yet.

### What was actually wrong

I'll call these three places keepers. Here is what each does today when asked for an entry that is still being worked out:

| Keeper | Can Hexagon code run inside it? | What it does when asked again mid-computation |
|---|---|---|
| A memoised function's table | yes, the `body` | refuses, and keeps nothing (question 2 and (B)) |
| A memoizing `Seq` spine: the inbound adapter, `Seq.memoize`, and the view JavaScript traverses | yes, sequence steps and anything a foreign iterator calls | refuses, but keeps whatever the code that caught the refusal produced (#123) |
| A guarded read of a thrown value | yes, anything a getter calls | swallows the refusal into `""`, and keeps it |

The list is closed. Effects §6.2's species are the register of everything the runtime keeps under a pure face, and the reviewer checked the rest of the spec as well. The other members run no Hexagon code inside, so nothing can come back into them: the placement seed, a compiled `Regex`'s caches, frozen storage, scratch buffers, and the string position cache.

Three keepers gave three different answers. Any of them that keeps a value worked out after the refusal shows where the cycle was entered.

### Path 2: changing what the spine keeps

A spine position whose forcing met a refusal could keep one of four things.

**What the catching code produced (today, #123).** This is round 3. It is also order-dependent without any memoisation. I ran #123's own headline program on the shipped compiler, changing only the order:
- **Hexagon traverses first:** the sequence is `[10, 20, 30, 40]`, and its JavaScript face fails for good. That is the order the conformance test pins.
- **JavaScript traverses first:** the sequence is `[10, 20, 30, 40]`, and so is the JavaScript face, every time.

JavaScript reaches a `Seq` through its face, and the face is a second spine. So every foreign re-entry is a cycle through two spines, and which one refuses depends on which was entered first.

**What was produced, plus a mark (round 2).** This moves the problem, as Path 1 shows.

**Nothing, so the position is forced again later.**
- For a foreign iterator this is impossible. Each forcing consumes one element, so a second forcing loses or reorders one. That is #123's own impossibility argument.
- For a spine over a Hexagon sequence, #232's hand-written cursor would make it possible. But every later forcing meets the same cycle, so it answers what keeping the refusal answers, and it pays for the recomputation.

**The refusal.** Every later pull raises it again. This is the one that works.

I also tried exemptions, such as keeping what was produced when the only refusal was the spine's own. Each one brings back order dependence, because of the two-spine shape above.

### Which computations end in the refusal?

That leaves one question for every keeper: when a refusal is raised, which computations end in it?

**(U), the broad way: every computation in progress.** This is simple to build, with one counter. But it also reaches computations that only *enclose* a cycle, without being on it. The reviewer's example:
- `loop` is a memoised function whose body asks for its own key, so it always refuses.
- `f(x) = try loop(x) catch ReentrancyFault => 0`.
- **Plain `f(1)`** is `0`, every time.
- **`Function.memoize(f)(1)`** is `ReentrancyFault`. That is already true under (B) as you ruled it.
- **`Seq.memoize` over a sequence that applies `f`** is also `ReentrancyFault` under (U).

So memoising changes the answer, against Loops §6.4 ("recomputation is unobservable") and Effects §7. `f` isn't on any cycle. It only catches a refusal from `loop`'s cycle, which ends the same way whoever asks. I should have shown you this cost when you ruled (B).

**(C), the precise way: exactly the cycle the refusal closes.**
- When a request reaches an entry that is still being worked out, that entry and every entry being worked out inside it each asked, directly or through others, for the next. They form a cycle, and they all end in the refusal.
- Computations that enclose the cycle aren't on it. They see the refusal like any other fault, and may catch it and answer.
- That is safe, because every entry on the cycle ends the same way whichever entry the cycle was entered from, so an enclosing computation sees the same thing in every history.
- Cycles that share an entry count as one cycle. The model needs this: without it, 1 to 15 programs per seed depended on call order, because a cycle grew after part of it had already been kept.

In the example above, (C) gives `0` for all three.

### The options

#### (C) A refusal ends exactly the cycle it closes (recommended)

**The rule.** Every entry on the cycle a refusal closes ends in the refusal, and so does every later request for it. Cycles that share an entry are one cycle. Each keeper says this in its own terms:
- **A memo entry** files nothing and throws `ReentrancyFault`. Asking again meets the same cycle, or the refusal a spine or guarded read on that cycle kept.
- **A spine position** keeps `ReentrancyFault` as its outcome, in place of any value or foreign throw. Every later pull raises it again.
- **A guarded read** can't fail (Part 11), so it keeps its swallowed answer, `""` or `None`. Being asked for itself mid-read already makes it give that answer.

A memo entry on a cycle keeps nothing, so it is worked out again when next asked. If it then reads a refusal kept by another entry on its cycle, it is on that cycle again. So it ends in the refusal too, along with every entry being worked out inside it, and they join the cycle. The review measured that both halves are needed:
- this must start from the outermost such entry;
- and the entries it ends must join the cycle.

An entry that encloses a cycle, without being on it, answers as it would anywhere else.

**What it buys.** A key of a memoised function either is on a cycle or isn't:
- **On a cycle** means its computation asks for itself, through any chain of memoised functions, sequences and guarded reads. Such a key throws `ReentrancyFault` on every call.
- **Not on a cycle**, it does what its body does, with every call the body makes answered by this same rule. Where plain recursion (this function's table removed, every other keeper as it is) returns or faults, that is the same outcome. Where plain recursion never returns, a key that only encloses a cycle can still answer, if its body catches that cycle's refusal: a key 0 that asks for a self-looping key 1 inside `try … catch ReentrancyFault => 7` answers 7, in either order. *(Corrected 2026-11-03: this bullet first said such a key always answers what plain recursion answers, which is wrong for that case. The rule is unchanged.)*

The same holds for every spine position and guarded read: a keeper changes nothing except that it refuses on its own cycles, where working the answer out again would never finish.

Within one program, no keeper's entry is ever seen two ways. Two tables built from the same body agree too, unless foreign code calls one specific table or sequence. A getter that calls `g` puts `g`'s key on a cycle and not `h`'s, and Hexagon code can then see the difference. Effects §6.2's sentence stays as written, and Loops §6.4's "recomputation is unobservable" stays true, with the one carve-out §7.3 already makes for cycles.

**Measured.**
- In my model, (C) shows 0 on every count above, with and without guarded reads.
- The reviewer extended the model with sequences of up to four positions, catches that rethrow after asking for more, refusals the dev throws by hand, and up to seven keys. Over about 75,000 programs on ten seeds, there were 0 differences within a program and 0 that depend on call order.
- The reviewer also checked transparency directly, over more than 200,000 checks with 0 failures. Every filed memo answer equals its body re-run at top level, and every sequence position off a cycle equals a fresh re-derivation of its step. The same checker finds 3,603 failures for (U) on one seed, so it can fail.
- Keys on no cycle matched plain recursion on every call where plain recursion finished.
- Round 3's two-table example gives `ReentrancyFault` for both tables, in both orders.
- #123's headline program gives `ReentrancyFault` for both faces, in both orders.

**What it costs.**
- **(B)'s wording narrows.** "A computation during which a refusal was raised" becomes "a computation on the cycle the refusal closes". Your example in `MEMOFIX-CYCLE.md` comes out the same, because both keys there are on the cycle.
- **Question 2's confirmed point narrows.** "A cycle leaves every in-progress key unfiled" becomes "every key on the cycle". An enclosing key that catches the refusal files its answer.
- **#123's second consequence changes.** A foreign iterator that re-enters its own sequence and swallows the refusal no longer carries on. That position fails with `ReentrancyFault` on every traversal, from Hexagon and from JavaScript alike. Four conformance tests change what they expect: the headline test, the generator test, the `[Symbol.iterator]()` test, and the JavaScript face test.
- **It settles #232,** which is recorded but not ruled. #232 asks whether a refusal should end a value's JavaScript face while the Hexagon side carries on. Under (C), the value itself has a failed position, so both faces agree. That's a ruling on #232, so it's yours.
- **Other spine text changes for positions on a cycle.** FFI Part 3 §7.1, §7.2 step 6 and §9.4 property 4 say a foreign throw is kept and replayed. For a position on a cycle, the refusal is kept instead.
- **Part 11 §7 changes in one case.** A getter on a cycle keeps `""`, not what it returned.
- **Runtime cost.**
  - A stack of the entries being worked out, shared by all three keepers and by every module's copy of the helpers. Each memoised computation, forcing and guarded read costs one push, one pop and one flag.
  - On refusal paths only: merging cycles, and remembering which cycle each kept refusal belongs to. When a kept refusal is read again, the runtime looks down the stack for a member of its cycle.
  - The cycle is recorded beside the kept refusal, never on it, because `ReentrancyFault` carries no payload.
  - A memo key's cycle is recorded in its own table, so it is found by `same` and goes when the table goes. Nothing keeps a key, a table or a thrown value alive.
  - It's more machinery than (U)'s counter, and it all folds into #1445.

What would bring it back: a real program where the merging costs more than it saves, or a foreign iterator that needs to recover from re-entering its own sequence.

#### (U) Everything in progress ends in the refusal

This is (B)'s rule, extended to spines and guarded reads, with one counter.

What it costs:
- Everything (C) costs, except the two narrowings.
- `Function.memoize` and `Seq.memoize` stop being transparent wherever a computation catches a refusal from a cycle it isn't on, as the example shows. Loops §6.4 and Effects §7 would each need an exception for that.

#### (G) GHC's route: pure code cannot catch `ReentrancyFault`

What it costs:
- **Exceptions §1 changes.** It says "catching is legal anywhere, pure code included". This would add a fault that some catches skip, so a catch-all would no longer catch everything.
- **It doesn't close foreign catches.** A getter or foreign iterator that catches the refusal still keeps a value. So either (U) or (C) is needed anyway, or foreign code that catches the refusal becomes a contract violation. The second overturns #123's "not a contract violation", so #123 changes on this route too.

#### (R) Name the limitation

Effects §6.2 would list where its sentence fails. You asked for doctrine that stays true, and this is the exception-list shape.

#### Keep patching

This means the mark, plus another mark for guarded reads. Path 1's numbers show it keeps finding the next place.

### The three checks

**Fits doctrine?**
- (C) keeps Effects §6.2's sentence literally true with one rule for every keeper.
- Catching stays legal anywhere (Exceptions §1).
- Memoising stays unobservable, except that it refuses on a cycle where working the answer out again would never finish.
- The doctrine change is one paragraph in Effects §6.2, which the memo's fourth term then cites. Proposed wording:

> **Nothing kept depends on where a cycle was entered.** A memo's table, a memoizing `Seq` spine and a guarded read can each be asked, through code they run, for an entry they are still working out. That request closes a cycle: the entry asked for, and every entry being worked out inside it. They answer it with `ReentrancyFault`, or, where they cannot fail, with their swallowed answer. Every entry on a cycle, or on a cycle that shares an entry with it, ends in the refusal: a memo files nothing, a spine keeps the refusal as the position's outcome, and a guarded read keeps its swallowed answer. Every later request for such an entry meets the refusal again. An entry that encloses a cycle is not on it, and may catch the refusal and answer, because every entry on the cycle ends the same way whichever entry the cycle was entered from.

**Colleague languages considered?**
- **OCaml's `Lazy`, an ML.** It is the closest match to a spine.
  - Forcing a suspension from inside its own forcing raises `Lazy.Undefined`.
  - A suspension whose forcing raised keeps the exception and raises it again on every later force.
  - An enclosing computation may catch `Undefined` and carry on, as under (C).
  - But a suspension *on* the cycle that catches it keeps what it then computes, which is #123's behaviour. OCaml makes no purity claim, so it can.
- **GHC.** Its thunks are the purity precedent. A thunk re-entered during its own evaluation raises `NonTermination` (`<<loop>>`). Every thunk the exception passes through is left so that forcing it again meets the loop again. Pure code can't catch the exception, so nothing computed after catching it is kept.
- **(C) is OCaml's treatment of enclosing computations with GHC's guarantee on the cycle,** reached without forbidding the catch.
- **A correction.** `MEMOFIX-CYCLE.md` said Rust's `OnceCell` leaves the cell empty after a re-entrant initialisation. It doesn't: it lets the inner initialisation finish and panics in the outer one. I'll correct the deliberation notes. It wasn't a reason for (B).

**HM?** No change.

### What changes in PR #1446 if you choose (C)

- **Effects §6.2:** the paragraph above, and the memo's fourth term shortened to cite it.
- **FFI Part 3:**
  - §7.3's second consequence is rewritten.
  - The #232 paragraph becomes the ruling.
  - §7.1, §7.2 and §9.4 get the on-a-cycle case.
  - §7.4's count paragraph is replaced, and the mark goes.
- **FFI Part 11 §7:** the cycle case, two sentences.
- **FFI Part 3, further text the review found:**
  - §4's "exactly one outcome" gains the refusal.
  - §7.3's "Replay is untouched" and "touches nothing" are qualified.
  - §7.4's count paragraph becomes the shared stack.
  - §7.4's recognition bullet stops saying that every memoised computation across a refusal ends in it.
- **`memoization.md`:**
  - §3.1: distinct tables can't be told apart, except by foreign code that calls one of them.
  - §3.2 and §3.3 state the rule. This drops "out to the outermost" and "it spans tables", which belong to the broad way.
  - §3.4 states the claim above, and drops the "up to its spine" paragraph.
  - §10.7 narrows to entries on the cycle.
  - §5, §7 and §9 change to match, and (U) goes into the rejected alternatives.
- **Notes:** the deliberation notes, with the `OnceCell` correction.
- **#1445** gains the spine, guarded-read and conformance-test changes, since the spec PR changes only text.

### Separately: #1447

The reviewer found two places where a pure function reads foreign data afresh on every call: a `catch`'s own check of a thrown value's brand, and `JsValue.toArray`. On today's compiler, a pure `(JsValue) -> Int` answers one argument in different ways on different calls. That's a soundness bug in the FFI, with or without memoization, so it's filed on its own as #1447. A memoised function can't be more of a value function than its body, so (C)'s claim assumes the program's pure faces are true, as every purity claim in Hexagon does.
