# Seq core representation — decision note

**Status:** Design decision note (July 2026), for Fable review. Proposes a
representation for `Seq(a)` and its combinator core; **does not** amend spec.
The owners are **Loops §6** (the `Seq` type and the §6.2 `next` protocol) and
**Collections Part 5** (the Iterable table); the combinator ship-list is owed to
**stdlib-roadmap.md**; foreign boundary crossing is **FFI Part 3**. Nothing here
overrides those — on any conflict the cited owner wins.

**One open decision is delegated to Fable: the memoization policy (§6).**

## 1. The requirement

`Seq(a)` must **work in Hexagon** and **work well-enough in JS**.

- *In Hexagon* — expressible in the actual language: HM types (no existentials
  in unions), constant-stack iteration (Loops §6.5 promises no TCO), and no
  mutable capture in closures (Statements §6.2). The representation below is
  chosen precisely to satisfy these, not in spite of them.
- *Well-enough in JS* — the emitted code interoperates with JS's native
  iterable protocol (§6.5), reads like the generator-library code a JS developer
  knows, and carries no pathological cost. It need not beat a hand-written
  generator; it must not embarrass one. Hot monomorphic loops bypass the
  machinery entirely (§6.5, §8), so the generic path only has to be decent.

The guiding idea: **`Seq` is more fundamental than `Array`.** `Array` is an FFI
boundary type (FFI Part 2); `Seq` is Hexagon's native lazy sequence. It deserves
a principled `.hex` core over a minimal foreign surface — the same shape the
Vector trie took over the `Node` intrinsic.

## 2. Representation

Loops §6.2 fixes the protocol as one function,
`Seq.next : Seq(a) -> Option((a, Seq(a)))`. Realize a `Seq` as a nominal record
carrying its own deferred pull thunk (OCaml `Seq`'s `unit -> node`, §6.1):

```
record Seq(a) = { pull: () -> Option((a, Seq(a))) }

let next(source: Seq(a)): Option((a, Seq(a))) = (source.pull)()
```

- The thunk is what **defers**: constructing a combinator runs nothing, so an
  infinite `Seq` is a finite value. Driving one step is O(1).
- `next` is the §6.2 protocol, thin over the field. It is not recursive, so it
  is a `let` (N6). The field is named `pull`, not `next`, so the field access
  never shadows the protocol; the call is written `(source.pull)()` because a
  bare `source.pull(...)` on a nominal head is a companion dispatch, not a field
  read (Products §3.2).
- **Why a record-of-closure, not a union of cases.** A defunctionalized
  `union Seq(a) = Mapped(source: Seq(b), f: b -> a) | Filtered(...) | ...` cannot
  be written: `b` would be an existential in the union, which Hexagon's HM does
  not express. Hiding the source and transform *inside a closure* keeps that
  type from escaping into `Seq(a)`. This is the load-bearing decision — it is
  what makes the whole design fit the language.
- The protocol keeps `Option((a, Seq(a)))` spelled inline, matching §6.2
  verbatim rather than aliasing it (S6 would prefer an alias, but a *parametric*
  alias is both less faithful to the owning spec and the shakier checker path).

## 3. The foreign surface — exactly two shims

Everything mutable or effectful is quarantined here; both are
compiler/runtime-provided (not Hexagon source), living at the FFI Part 3
boundary. They are the only non-`.hex` pieces of `Seq`.

```
Seq.fromJsIterator : JsIterator(a) -> Seq(a)      -- bridge IN, memoizing spine
Seq.toJsIterable   : Seq(a) -> JsIterable(a)       -- bridge OUT, driving generator
```

- **`fromJsIterator`** wraps a single-shot, mutable JS iterator into a
  *persistent* `Seq`: its `pull` memoizes-and-replays so `next` never consumes
  the caller's value (§6.5's "must not consume `s`"). This is the one place a
  mutable buffer lives; it is today's `seq` helper, repackaged as the primitive.
  Every genuinely foreign source (an FFI `Seq`, an `Array` view, a file) enters
  here.
- **`toJsIterable`** is a JS generator that drives `Seq.next` in a constant-stack
  loop and yields, so `for (const x of s)` works on the JS side and the `.d.ts`
  face is `Iterable<a>` (§6.5).
- `for x in seq` *inside* Hexagon needs neither: it is the emitter's
  constant-stack `next`-loop desugaring, and monomorphic loops inline past the
  machinery (§8).

## 4. The combinator core

Three categories. Every example is canonical per the formatting checklist:
`fun` only where the body self-references, `let` otherwise (N6); no bare `<a>`
binders — the type variables are introduced by the annotations (S3); subject
first (N5).

### 4.1 Pure `.hex`, one-step `pull` (one input → one output)

```
let empty: Seq(a) = Seq({ pull: () => None })

let singleton(value: a): Seq(a) = Seq({ pull: () => Some((value, empty)) })

fun iterate(seed: a, step: a -> a): Seq(a) =
    Seq({ pull: () => Some((seed, iterate(step(seed), step))) })

fun map(source: Seq(a), transform: a -> b): Seq(b) =
    Seq({ pull: () => match next(source)
        None => None
        Some((value, rest)) => Some((transform(value), map(rest, transform))) })

fun take(source: Seq(a), count: Int): Seq(a) =
    if count <= 0 then
        empty
    else
        Seq({ pull: () => match next(source)
            None => None
            Some((value, rest)) => Some((value, take(rest, count - 1))) })
```

Same shape: `cons`, `unfold`, `takeWhile`, `zip`/`zipWith`, `concat` (its
exhaust-then-switch is one bounded extra `next`, not a skip loop).

### 4.2 Pure `.hex`, but `pull` needs a constant-stack `while`

When a combinator may consume many source elements to yield one, the step is a
`while` loop threading a `var` cursor — never self-recursion (Loops §6.5). The
loop-bearing step is a private helper (`fun`, because it is mutually recursive
with its combinator; its return type is inferred, S4):

```
fun filterFrom(source: Seq(a), keep: a -> Bool) =
    var current = source
    var result: Option((a, Seq(a))) = None
    var searching = true
    while searching
        match next(current)
            None => searching := false
            Some((value, rest)) =>
                if keep(value) then
                    result := Some((value, filter(rest, keep)))
                    searching := false
                else
                    current := rest
    result

fun filter(source: Seq(a), keep: a -> Bool): Seq(a) =
    Seq({ pull: () => filterFrom(source, keep) })
```

(The sentinel `var searching` stands in for the absent `break`, Loops §9.4; the
one annotation, on `result`, is the genuine-need exception since `None` is
otherwise ambiguous.) Same treatment: `drop`, `dropWhile`, and the hardest,
`flatMap` — draining empty sub-sequences to find the next element is still one
`while`, never a stack.

### 4.3 Pure `.hex` consumers (drive a `Seq` to a value)

```
let fold(source: Seq(a), initial: b, combine: (b, a) -> b): b =
    var accumulator = initial
    var current = source
    var running = true
    while running
        match next(current)
            None => running := false
            Some((value, rest)) =>
                accumulator := combine(accumulator, value)
                current := rest
    accumulator
```

The §6.3 "external iteration" idiom, exactly. Same shape: `length`, `forEach`,
`find`, `any`/`all`, `toVector`.

## 5. The Vector bridge (why this pays off at milestone 3)

With this core, `Vector`↔`Seq` is pure `.hex` — no generator, no foreign shim,
because the trie is immutable and a walk is persistent by re-derivation:

```
let toSeq(values: Vector(a)): Seq(a) =
    unfold(1, index =>
        if index > Vector.size(values) then None else Some((values[index], index + 1)))

let fromSeq(source: Seq(a)): Vector(a) = fold(source, Vector.empty, Vector.append)
```

So the milestone-3 `Vector.toSeq`/`fromSeq` that the current plan defers reduce
to two `.hex` lines over this core; `fromJsIterator` is never reached for a
Vector. (An O(n) leaf-walk `unfold` can replace the O(n log n) index walk later;
same shape, better constant.)

## 6. The open decision — memoization (Fable to decide)

A pure `.hex` `Seq` is persistent by **re-derivation**: re-driving recomputes.
Today's `Seq` is persistent by **memoization**: a growing buffer replays cheaply.
Loops §6.5 explicitly permits either ("memoize *or* re-derive"). The two are not
equal in cost, and the choice is exactly the "well-enough in JS" call:

- **Re-derive (proposed default).** Simplest and purest; zero buffer. Cheap to
  replay for `iterate`, `map`, and Vector walks (a step is a cheap function).
  But a `filter`/`flatMap` traversed twice repeats its skipping, and a deep
  pipeline replays every layer — and each layer already allocates an `Option`, a
  tuple, and a successor closure per element, so replay multiplies real JS
  allocation.
- **Memoize always.** Matches today's behavior and FFI Part 3's "one spine";
  replay is O(1) per cached element. But it forces the mutable buffer under
  *every* `Seq`, including the pure ones that do not need it, and pins retention.

**Proposed resolution (for Fable to confirm or overturn):** default to
re-derivation, and expose one explicit combinator —
`let memoize(source: Seq(a)): Seq(a)` — that wraps any `Seq` in the §3
memoizing spine for the replay-heavy cases. This keeps the pure core pure, quarantines the buffer to opt-in, and still honors §6.5. The question for Fable
is whether "well-enough in JS" tolerates re-derivation as the default, or whether
the replay/allocation cost of un-memoized pipelines is bad enough that
memoization must be the default (with the buffer everywhere) — and if the
explicit `memoize` is the right escape hatch either way.

## 7. What this note does not decide

- The full v1 combinator ship-list and its names (→ stdlib-roadmap.md, under the
  collections naming doctrine).
- Foreign adapter identity, retention, and foreign-throw behavior at the crossing
  (→ FFI Part 3; §3's shims are the Hexagon-facing view only).
- No `seq { yield }` comprehension syntax (Loops §11.3, unchanged).
- Any change to the §6.2 protocol itself — this note *implements* it, it does not
  revise it.

---

*Canonical formatting pass applied to every example: `let`/`fun` split by
recursion (N6), no bare binders (S3), subject-first parameters (N5), private
helper return inferred (S4), four-space layout (F1), mandatory `then`/`else` on
value-typed conditionals (F2). The one local annotation (`result`) is the
genuine-inference-need exception, not a style lapse.*
