# Seq core representation — decision note

**Status:** Reviewed and closed (Fable, 2026-07-26). The review ratified the
representation, decided the delegated §6 memoization question, and promoted the
outcomes into the owning specs — see **§9** for the disposition of every
decision. This note is now the **rationale archive**; on any point of substance
the owners govern: **Loops §6** (the type, protocol, representation §6.6, and
persistence policy §6.4), **Modules §5.5** (the prelude mechanism),
**stdlib-roadmap.md** (the `Seq.hex` obligation and ship-list), **FFI Part 3**
(boundary crossing), and `compiler-conformance-defects.md` +
`seq-deintrinsification-plan.md` (the compiler-alignment record and work order).

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
let empty: Seq(a) = Seq({ pull = () => None })

let singleton(value: a): Seq(a) = Seq({ pull = () => Some((value, empty)) })

fun successors(seed: a, step: a -> a): Seq(a) =
    Seq({ pull = () => Some((seed, successors(step(seed), step))) })

fun map(source: Seq(a), transform: a -> b): Seq(b) =
    Seq({ pull = () => match next(source)
        None => None
        Some((value, rest)) => Some((transform(value), map(rest, transform))) })

fun take(source: Seq(a), count: Int): Seq(a) =
    if count <= 0 then
        empty
    else
        Seq({ pull = () => match next(source)
            None => None
            Some((value, rest)) => Some((value, take(rest, count - 1))) })
```

Same shape: `prepend` (`cons` until the 2026-08-02 rename, Collections Part 1 §10.1), `unfold`, `takeWhile`, `zip`/`zipWith`, `concat` (its
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
    Seq({ pull = () => filterFrom(source, keep) })
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
        if index > Vector.length(values) then None else Some((values[index], index + 1)))

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

## 8. Implementation findings (added 2026-07-26)

The core is now built as `runtime/SeqCore.hex`, with behavioural conformance in
`compiler/src/conformance/seq.test.ts`. §§1–7 above are the design as proposed
and are left unedited so the review has the original to judge; this section
records where the implementation had to depart from them and why. Nothing here
changes a design decision — every departure is a compiler limitation, and all
five are logged with reproductions in `compiler-conformance-defects.md`.

- **The type cannot *yet* be named `Seq`, and `SeqCore` is a temporary name.**
  `Seq` is an intrinsic type constructor the resolver claims ahead of any user
  record, so `record Seq(a)` declares a record that no `Seq(a)` annotation can
  ever refer to — the annotation keeps resolving to the intrinsic and the two
  never unify. `SeqCore` is therefore scaffolding, not an architecture: the
  decided direction (James, 2026-07-26) is that **this record becomes `Seq`** —
  the intrinsic is retired and its producers (`Map.keys`/`values`/`entries`,
  `Set.toSeq`, `Vector.toSeq`/`fromSeq`, and the `for x in` desugaring) are
  rebased onto it. `SeqCore` and the workarounds below are deleted in that same
  change.
- **`Seq` de-intrinsifies before `Vector`, and is the pilot for it.** This
  reverses the reading in an earlier draft of this section, which treated
  `SeqCore`-under-`Seq` as following the `TrieVector`-under-`Vector` precedent.
  It does not: `Vector` follows `Seq`. The ordering is deliberate — `Vector`
  carries real compiler surface (literal syntax, bracket indexing, slicing, rest
  patterns) while `Seq`'s is thin (essentially the `for x in` desugaring), so the
  cheaper type proves the pattern that the expensive one then inherits. This is
  also what §1's "`Seq` is more fundamental than `Array`" implies once taken
  seriously.
- **Because it is a pilot, the two blocking defects are prerequisites, not
  follow-ups.** An opaque `Seq` is reachable *only* through `next` and through
  destructuring `Option((a, Seq(a)))`. Inside this module both are dodged by
  touching `pull` directly; no consumer of an opaque type can do that. Shipping
  the unification before those two fixes would bake the workarounds into the
  template `Vector` inherits.
- **§3's `toJsIterable` conflicts with FFI Part 3 §9.1 under re-derivation.**
  Part 3 §9.1 has already decided that an *exported* `Seq` memoizes: "repeated
  JavaScript traversals observe the same memoized Hexagon sequence rather than
  re-running its lazy computation and effects." §3 describes `toJsIterable` as a
  generator driving `next`, which under a re-deriving `Seq` re-runs the pipeline
  and replays effects on every `[Symbol.iterator]()` call — the thing §9.1
  forbids. Either `toJsIterable` memoizes internally or export memoizes first.
  This does not settle §6's *internal* default, but it does mean the export
  boundary is already fixed as memoizing, which §6 should have said.
- **§4.1's inline `match` does not parse.** A multi-line `match` as a
  record-field value makes layout close the record literal at the first arm.
  Each combinator instead binds its step to a local `let` and wraps that.
- **§4.2's annotated `...From` helpers do not typecheck.** Annotating both sides
  of a mutually recursive pair introduces two rigid type variables the body then
  requires to be equal. The helpers are gone entirely: binding the step locally
  makes each combinator a single self-recursive `fun`, which is simpler than the
  note proposed and sidesteps the problem rather than working around it.
- **`Some((value, rest))` is rejected everywhere.** A tuple pattern directly
  beneath a constructor pattern is not counted as covering its case. Every arm
  binds the payload whole and destructures it on the next line.
- **Recursive combinators cannot call `next`.** A recursive function does not
  instantiate a generic annotated callee's scheme, so `next` inside `map` fuses
  its `a` with `map`'s. Recursive bodies drive the thunk inline as
  `(source.pull)()`; `next` stays the §6.2 protocol and the non-recursive
  consumers do call it.
- **`empty` is split in two.** An annotated `empty: SeqCore(a)` is rigid, not
  generalized, so the first use fixes the element type. The generalized binding
  is private and carries the internal uses; the export is a thin annotated alias.
- **Scope actually delivered.** The pure core only: §4.1, §4.2, and §4.3, plus
  `prepend` (then `cons`) and `zip`. The two §3 foreign shims and the §6 `memoize` are *not* in
  `.hex` and cannot be — all three need a mutable buffer and Statements §6.2
  forbids mutable capture in closures. They remain compiler/runtime-provided, as
  §3 says. §5's Vector bridge waits on milestone 3.
- **§6 is untouched.** The implementation is re-derivation, the note's proposed
  default, because that is what pure `.hex` yields; it is not a ratification of
  that default. The memoization decision is still open and still Fable's.

## 9. Review outcome (Fable, 2026-07-26)

The review was conducted with James across one session; §8's findings were input
to it. Every decision below is now recorded in an owning spec; this section is
the map.

**Ratified:**

- The record-of-closure representation, verbatim from §2 → **Loops §6.6**.
- The three combinator classes and constant-stack while-pull discipline → Loops
  §6.6 (bullet), ship-list still owed to the ledger.
- The two-shim foreign surface (§3) — unchanged, still runtime-provided; FFI
  Part 3 untouched.

**Decided beyond the proposal:**

- **`Seq(a)` is a declared prelude type, not a compiler intrinsic.** `Seq.hex`
  declares `export opaque record Seq(a)` and its companions in one module, joins
  the prelude set after `Option.hex`, and the intrinsic is retired. `Seq`
  de-intrinsifies **before `Vector`** and pilots the pattern `Vector`/`Set`/
  `Map` inherit → Loops §6.1/§6.6, Modules §5.5, ledger §2 row + §5.2.
- **Opacity is load-bearing:** `pull` is private to the home module; the §6.2
  protocol is the entire public face → Loops §6.6.
- **Resolution order:** declarations before intrinsics; the current
  intrinsic-first order is a conformance defect against Modules §5.4, logged as
  defect 6 in `compiler-conformance-defects.md`. Surviving boundary intrinsics
  (`Array`, `Nullable`, `Node`) become fallback-only → Modules §5.5.
- **Prelude mechanism:** ordered intra-prelude visibility; **no `import` lines
  in prelude source** (James's pedagogy argument prevailed over explicit-imports
  review preference — stdlib is read as exemplary code); header-comment
  convention per `stdlib/Vector.hex` → Modules §5.5.

**The delegated §6 question, decided (Fable):** re-derivation is the internal
default; `memoize : Seq(a) -> Seq(a)` is the explicit opt-in; the export
boundary memoizes unconditionally — FFI Part 3 §9.1 had already fixed that end,
which §6 as posed failed to note, so §3's `toJsIterable` composes with the
memoizing export spine rather than driving a re-deriving pipeline directly →
Loops §6.4 ("Persistence policy").

**Implementation consequences** (owned by `seq-deintrinsification-plan.md`):
checker defects 1 and 2 are prerequisites; `SeqCore.hex` is scaffolding deleted
by the migration; §8's workarounds must not survive into the shipped `Seq.hex`.

---

*Canonical formatting pass applied to every example: `let`/`fun` split by
recursion (N6), no bare binders (S3), subject-first parameters (N5), private
helper return inferred (S4), four-space layout (F1), mandatory `then`/`else` on
value-typed conditionals (F2). The one local annotation (`result`) is the
genuine-inference-need exception, not a style lapse.*
