# Friendly Sequences — proposal

**Status:** Adopted; promoted 2026-09-28. Written 2026-09-06; revised 2026-09-23
following the simplified design discussion; §6's obligations reviewed
2026-09-28, with its rulings folded into §2–§7. This note is the record of the
design; the normative rule lives in its owners. **Promotion record:** §1–§5 are
Collections Part 5 §3 (§3.1's loop head, §3.4 the seats and the adaptation,
§3.5 a source whose head is not yet known and the close, §3.6 meaning and
exclusions), with Part 2 §7.2.1's deadline and demand bullets and Loops §7.1;
§6.1's deferred-goal itemisation is Method Syntax §10; §6.2 is Functions §4's
preamble and annotations closure doc §2.4 and §9.11; §6.3 is Functions §8
item 2 and Ascription §3; §6.4's timing, channels and forwarding are Functions
§4.3; §6.5's deadline sentence is friendly-numerics §4's third rule, and the
Deferred-Goals Doctrine's permanent list (Declarations Preamble §1.2) names
the waiting sequence source. Collections Part 5
§17 and Functions §4.3's conformance obligations carry the goldens; §7 here
remains the implementation's acceptance list (#1152).

This revision supersedes the earlier framing of this note. Generic implied
types remain abandoned; no part of that investigation is revived here.

## 1. Principle

> Both loops and sequence parameters require a sequence, and the same
> adaptation rule supplies one from an iterable value.

An explicit sequence annotation supplies the same requirement. The consumer
establishes that a sequence is needed; the source type establishes which
`Iterable` instance supplies it.

A function that needs only sequential traversal takes `Seq(a)`. A collection
provides its sequence view by honoring `Iterable`, whose `Item` is the element
type and whose `toSeq` member produces that view. The compiler inserts that
member call at the boundaries specified below. Consumer authors need no second
`fromIterable` entry point beside `fromSeq`.

```hex
let words = ["red", "green", "blue"]
String.fromSeq(words)
```

The call means:

```hex
String.fromSeq(Iterable.toSeq(words))
```

This applies to user functions as well as standard-library functions. Functions
that need indexing, keyed lookup, updates, or a particular collection result
continue to use the appropriate collection type; this proposal does not replace
all collection APIs with sequence APIs.

`Iterable` is a constraint, not a common value type or a supertype of all
collections. `Seq(a)` is an immutable, lazy, possibly infinite sequence. Its
`next` operation returns an element and a successor sequence without consuming
the original. It therefore serves as a reusable sequence input, not a shared
mutable iterator. [Loops §6](../loops-ranges-iteration.md) owns that contract.

## 2. Where adaptation applies

The proposed supplying contexts are:

| Context | Source of the sequence requirement |
|---|---|
| `for pattern in source` | The loop construct requires sequential traversal |
| An argument to a known function parameter `Seq(a)` | The resolved parameter type |
| An immutable binding annotated `Seq(a)` | The binding annotation |
| A function body with a declared result `Seq(a)` | The result declaration |
| A constraint member's body whose contract's result is `Seq(a)` | The member header (Functions §4.3's fifth seat; §5's one exclusion) |

A known parameter type may come from an instantiated inferred signature; it
need not be written on the callee. Constructor parameters are function
parameters too. Qualified calls, aliases with known signatures, pipes, and
resolved dot-call argument positions share the rule after ordinary resolution.
Conversion does not participate in choosing the callee or resolving a dot.

```hex
let words = ["red", "green"]
let view: Seq(String) = words       // adapt through Iterable.toSeq
let same = words                   // retain Vector(String)

let colors(): Seq(String) =
    ["red", "green"]               // adapt at the declared result
```

Existing expected-type forwarding from [Functions §4.3](../functions.md)
applies within these contexts: grouping, final expressions of blocks,
conditional and match result branches, and lambda bodies where the known
function expectation supplies a sequence result — and the channels Functions
§4.3 already gives an expected type: a constructor application's arguments, a
literal form's parts, an argument's spine (§6.4). It does not invent new
forwarding through arbitrary data structures. The result declaration above is
one direct way to supply the body expectation, not a restriction to named
functions.

The same written `Seq(a)` expectation in an expression ascription is treated
like a binding annotation, using the existing ascription supplying context in
Functions §4.3. This is spelling consistency for an explicit sequence demand,
not general propagation into existing values. Mutable bindings and assignment
are outside this proposal's supplying contexts; any extension there requires
separate review.

### 2.1 Branches adapt independently

Suppose `firstCollection: Seq(String)` and
`secondCollection: Vector(String)`:

```hex
let colors: Seq(String) =
    if useFirst then firstCollection else secondCollection
```

Its meaning is:

```hex
let colors: Seq(String) =
    if useFirst then firstCollection
    else Iterable.toSeq(secondCollection)
```

The destination comes from the annotation, before either branch supplies its
value. Each branch is checked against it independently. Only the selected
branch is evaluated, and its conversion occurs there. Both branches may instead
be different iterable collection types with the same element type.

The destination's **head** is what must be supplied independently; its element
may be left open, as a generic `Seq(a)` parameter leaves it. Then the paths first
agree on their **element types** — each path's own, or its `Iterable` instance's
`Item` — joined as Functions §4.3 joins the paths of a form whose expectation
leaves a part open (#1107), and reported where that join reports: at an `if`,
the `if`; at a `match` or `try`, each later arm that disagrees; in a vector
literal, the later element. Each path is then adapted on its own. A path whose
head has no `Iterable` instance is refused where it stands (§3 step 4), not
joined; a path whose head is not yet known contributes only its pending `Item`
(§3) and never takes a sibling's head — it is decided at the close like any
unknown source:

```hex
Seq.length(if useFirst then names else moreNames)
// names : Vector(String), moreNames : Set(String) — the elements agree on
// String, so a = String, and each branch converts through its own instance
```

`Vector(Int)` against `Set(String)` is refused at the `if`: no one `Seq` holds
both. The same holds for `match` and `try` arms, and for the elements of a
vector literal read against `Vector(Seq(_))`. And in `fun f(c, xs, names:
Vector(String)) = Seq.length(if c then xs else names)`, `xs` is `Seq(String)` by
the close's default, never `names`'s `Vector`.

Without an independently supplied sequence expectation, a sequence-valued
branch does not authorize conversion of its sibling. Ordinary branch inference
and unification apply; inference does not invent `Seq` as a common collection
type. Nor does this proposal make existing tuple, record, or other container
values forward expectations into their contents.

## 3. One adaptation rule

At an eligible expression boundary, under the existing deterministic checking
schedule:

1. Read the independently supplied destination. Its outer constructor must
   already be `Seq`; its element type may be an unsolved inference variable.
2. Establish the source expression's type once, preserving its own collection
   constructor. Do not first force that constructor to unify with `Seq`, retry
   the expression with a different interpretation, or use the sequence demand
   to select an overloaded meaning.
3. If the source is `Seq(b)`, unify `b` with the expected element type using
   ordinary unification. Use the original sequence unchanged.
4. Otherwise, the source's outer constructor being known (a source whose type
   is not yet known waits, below), resolve its unique global `Iterable`
   instance through the existing instance-resolution rules; a head with no
   instance is refused, never passed through.
   Substitute the source type arguments into its `Item` binding and discharge
   the instance's prerequisites. Prerequisites never select among candidates.
5. Unify the resulting `Item` with the expected element type using ordinary
   unification. If successful, insert a call to the resolved `toSeq` member.
   Otherwise report the mismatch; there is no second conversion route.

`Vector(a)` has a known constructor even when its element type is generic.

**A source whose type is not yet known at the seat** — an unannotated parameter
nothing has described yet — has only its **head** decided when its owner region
closes. The seat makes, at its own turn, the demand the explicit call makes:
`Iterable` on the source, its `Item` the expected element type — the subject's
one demand (Collections Part 2 §7.2.1), which every seat and explicit call on
it joins. So the element is linked at once, whatever collection the source turns
out to be: after `sumInts(v)`, `Seq.map(v, …)`'s callback reads `Int`. Only the
head waits. If the region establishes it, steps 3–5 decide at that moment — so
`String.fromSeq(xs)` followed by `Vector.length(xs)` converts `xs`, in either
statement order. If the head is still unknown at the close, the source **is** the
sequence a seat asked for: it takes the `Seq` reading, one defaulting step,
which is the typing the checker gives such a source today (`let f(xs) =
String.fromSeq(xs)` is `(Seq(String)) -> String`), and an explicit
`Iterable.toSeq` demand on the same subject settles with it. The default belongs
to seats: an explicit call alone on a subject nothing describes keeps its
refusal (`let t(x) = Iterable.toSeq(x)` is refused, as #1070 ruled). A source
that is a **declared** type variable provides no head and never will: it is
refused as the explicit call is, with the rewrite to a `Seq(a)` parameter.

**The close** runs in one order. Dot-call goal resolution and the seats' `Seq`
defaults run to a single fixpoint — a goal resolved at the close meets its
arguments then, and may meet an unknown source at a `Seq` parameter, which joins
the fixpoint; the goals' own `Int` defaulting step stays inside it (Method Syntax
§3.3) — and only then does the row fallback apply (§3.5), then the region's
ordinary defaulting and §7.2.1's refusal of what remains. A default taken at the
close is one decision on a variable nothing informed, never a revision: nothing
before it committed the source to any head. This rule neither infers a generic
`Iterable` bound nor adds support for symbolic associated-type projections: the
demand is the one v1 already settles by its deadline, and the default replaces
its refusal only where a seat asked for the sequence.

A destination `Seq(?a)` is sufficient: a `Vector(String)` source can establish
`?a = String`. A destination that is only `?t` is not sufficient. A later
argument or sibling expression establishing `?t = Seq(String)` does not cause
an earlier expression to be checked again. Follow Functions §4.3's existing
elaboration schedule; do not change runtime evaluation order.

Instance identity, prerequisites, visibility, and provider availability are
exactly those of the explicit member call. Adaptation grants no access to an
unavailable implementation or a provider imported only through a bare view.
A plain function named `toSeq` does not establish `Iterable` capability.

## 4. Loops use the same sequence supply

For `for pattern in source`, the loop itself supplies the sequence requirement.
Establish the source type and resolve its instance as in §3. The instance's
`Item` supplies the loop's element type; no element annotation is required.
An existing `Seq` passes through unchanged. A source whose type is not yet known
at the loop head has its head decided at its owner region's close, as §3 decides
any seat's, so whether the loop is accepted no longer depends on whether a later
or an earlier statement describes the source (#1118); one nothing describes is a
`Seq`. The loop's element is the subject's one `Item` (§3): known in the body when
an earlier seat or statement fixed it, and otherwise an inference variable there —
so a body that must dispatch on the element (a `match` on it) still reads it as
the schedule has solved it. Loop pattern checking,
irrefutability, scope, body type, and result type remain as specified by
[Collections Part 5 §3](../collections-part5-iterable.md) and
[Loops §2](../loops-ranges-iteration.md).

Conceptually the loop traverses the sequence supplied by `Iterable.toSeq(source)`.
This unifies the capability lookup and conversion meaning of loops and
ordinary sequence consumers; it does not turn a function call into a loop.
The current loop specification already uses this conversion conceptually.

Retain native traversal optimizations where canonical instance provenance
licenses them. A semantic sequence requirement does not require allocating a
sequence wrapper or replacing an existing native loop with cursor calls.
Optimized traversal must preserve the resolved instance's behaviour and the
source-defined-instance migration's cost requirements.

## 5. Meaning and deliberate limits

An inserted conversion behaves exactly like an explicit call to that resolved
`Iterable.toSeq` at the same boundary. Evaluate the source once and preserve
runtime evaluation order, exceptions, traversal order, laziness, and cost.
Do not add eager traversal, copying, memoization, or another foreign snapshot.
Foreign sequences observe the captured contents established by their existing
boundary contracts.

`Iterable.toSeq` has a pure constraint contract. Its source instance body has
inferred effects and must satisfy that contract. Automatic adaptation adds no
effect mark and does not hide effects from evaluating the source expression.
Effectful `Stream` remains outside `Iterable`.

The following are excluded:

- **Element conversion:** an established `Vector(Int)` supplies `Seq(Int)`,
  not `Seq(Float)`. No numeric conversion is mapped over elements; no new
  sequence-element expectation is pushed inward to retarget collection
  literals. Existing literal typing otherwise remains unchanged.
- **Structural conversion:** an existing `Option(Vector(a))` does not become
  `Option(Seq(a))`. A newly written constructor argument whose parameter is
  `Seq(a)` — by its signature, or by the constructor's expected type (Functions
  §4.3) — is an ordinary eligible argument, as is a newly written literal's part
  (§6.4).
- **Function conversion:** an existing function returning a vector does not
  become a function returning a sequence. Checking a newly written lambda
  body against a known sequence result is the ordinary body case in §2.
- **Method search:** a vector does not acquire `Seq` methods. A resolved
  `Seq.map(values, transform)` can adapt its argument; this rule does not make
  `values.map(transform)` resolve to `Seq.map`.
- **Other destinations:** no reverse conversion, automatic collection
  materialization, conversion chains, subtyping, or changes to `widens`.
- **An instance converting its own subject:** inside an `Iterable` instance's
  own `toSeq`, a value whose head is the instance's subject head is never adapted
  — `b` itself, a `Bag(Int)` inside `honor Iterable<Bag(a)>`, a child `k: Bag(a)`
  in a tree's flatten (`Seq.flatMap(kids, (k) => k)`) — since the only conversion
  there would be the member being defined, a call to itself the source never
  wrote. It is refused as today, with the rewrite named: convert
  its contents (`toSeq(b) = b.items`), or write the call where recursion on a
  smaller value is meant. The exclusion is the member's own body, not what it
  calls: a helper whose written result is `Seq(a)` — `let flat(b: Bag(a)):
  Seq(a) = b`, called as `toSeq(b) = flat(b)` — adapts `b` through the instance
  being defined, exactly as `Iterable.toSeq(b)` written in `flat` would, and the
  recursion is the program's, visible at a named function; the repair is the
  same, `b.items`.

All lawful instances follow the same rule. Strings supply codepoint strings;
maps supply entry tuples; sets preserve their specified traversal order. There
are no consumer-specific exceptions. An exhaustive consumer of an infinite
sequence can still fail to terminate.

Explicit `toSeq` remains useful when a programmer wants to establish a sequence
without a supplying context or select sequence operations explicitly. Reducing
its routine use does not remove the member or its existing spellings.

## 6. Hindley–Milner and elaboration obligations

Preserving Hexagon's Hindley–Milner inference discipline is a requirement of
adoption. The proposed rule introduces deterministic elaboration at a known
sequence demand; it must not introduce conversion search into unification.

The local type-preservation argument is simple: the selected instance supplies
`toSeq: c -> Seq(Item)`, the expression has type `c`, and ordinary unification
establishes `Item = a`. The inserted application therefore has type `Seq(a)`.
That argument alone is not a proof of principal inference. The design review
below accounts for the five obligations the promotion owes; it was carried out
against the checker on `108a58ac`, with the probes and a prototype of §3's
unknown-source rule named in §6.6.

### 6.1 Principal inference, rigid variables, constraint inference

**What the rule adds to the type system: nothing.** Every adaptation is an
application of a constraint member at an instance resolved at a known head, its
`Item` substituted there; no variable acquires an `Iterable` bound, no
projection is left symbolic, no subtyping or conversion search enters
unification. The elaborated program is an ordinary program of the language, and
its schemes are the ones inference derives for that program.

**What it keeps.** An adaptation fires only where the source's head is known,
is not `Seq`, and meets a `Seq`-headed destination — exactly where the checker
reports a mismatch today. A source nothing describes takes, at its owner's
close, the `Seq` reading, which is the unification the seat performs today. So
every program accepted today is accepted with the same types, with one class of
exception, recorded because it is the price of §3's timing. The element is linked
at the seat's turn (§3), so what reads a waiting source's *element* reads it as
today — `Seq.map(v, match …)`, `Seq.fold(v, 0.5, …)` and a generic sibling beside
`v` are unchanged. What reads its **head** before the owner's close sees it open
where today it saw `Seq`:

- a dot call on the source, which must know the head to find its member — its
  arguments meet no expectation meanwhile (Method Syntax §11.3's residue), so a
  match function, or a literal widening into the element, among them is checked
  blind:

  ```hex
  fun go(v) =
      let total = sumInts(v)          // sumInts : (Seq(Int)) -> Int
      v.map(match
          n when n < 0 => "negative"
          _ => "other")               // accepted today; refused under §3
  ```

- a `match` on the source itself (Pattern Matching §6.1's abstract-type refusal).

The repair is to annotate the source. A prototype of §3 — the element linked at
the seat's turn, the head at the close — changes one of the compiler's 7049 tests
(the standard library included): a pinned refusal the rule retires, a loop over
an unknown value. Neither shape above occurs in those tests, the book's 483 code
blocks, or the playground's examples. (A first prototype that linked the element
only at the call's end also broke qualified calls; and without #378's fix,
§8, it lost an effect.)

**What is not claimed: principality of the source program.** `let f(xs) =
String.fromSeq(xs)` has two typings, `(Seq(String)) -> String` and
`(Vector(String)) -> String`, and their common generalization would be an
`Iterable`-bounded variable with a projected element — the abandoned generic
implied types. The checker gives the `Seq` one, by §3's default. This is the
concession Numeric Literals §5.1 already makes (`let g(v) = useFloat(v)` is
`(Float) -> Float`, not "any type that widens to `Float`"), and it is taken on
the same terms: the typing is the one the normative schedule determines,
uniquely.

**The deferred decision is the Deferred-Goals Doctrine's kind** (Method Syntax
§10), itemised as the dot call's is: one source variable per demand; one member;
resolution by the coherence-keyed instance table, never a search; a finite,
deterministic rule — §3's close order, in which the `Seq` default and the dot's
`Int` step never apply to one variable (a waiting source's `Iterable` demand
blocks `Int`); no survival past the owner's finalisation (the default, then
ordinary unification); and
principal types preserved in the doctrine's sense — the unresolved form's
defined meaning, the `Seq` reading, is the language's meaning without the
feature, and resolution when the head arrives agrees with resolution at the
deadline, head-knownness being monotone under unification. One clause differs
from the dot's, and is stated rather than claimed away: the dot's deferral
reclassifies only programs that were errors, while this one also refuses the
accepted programs above, whose head a judgment needed before the close. The
demand itself is the one `Iterable.toSeq(xs)` makes today (#1070); the default at
the close replaces its refusal only where a seat asked for the sequence.

**Rigid variables.** A source that is a declared variable is refused, as the
explicit call is (Collections Part 2 §7.2.1; Part 5 §3.2's rewrite to a
`Seq(a)` parameter). A declared variable in the element passes through ordinary
unification — `let f(xs: Vector(a)): Seq(a) = xs` adapts, and `Item = a` meets
the result's `a` — so rigidity never selects between readings: only the source's
head does. **Constraint inference**: the instance's prerequisites are the
explicit call's, accumulating on variables as any demand does, and never
selecting among instances.

### 6.2 Annotations and derivability

Functions §4's preamble says annotations "never change what inference *could*
derive except by restricting it". Numeric Literals §5.1 already makes that
sentence untrue as written — `let x: Float = n` (`n : Int`) binds `x : Float`,
where `let x = n` binds `Int` — and this rule adds a second case: `let view:
Seq(String) = words` binds a `Seq`, `let view = words` a `Vector`.

The doctrine's own statement already carries the idea that reconciles both
(annotations closure doc §2.4): the claim is about derivation power, and "the
type the written form supplies is one inference works with wherever the same
information arrives by any other route". An annotated binding is one supplying
seat among several; the conversion it elaborates is the one every seat with the
same expected type elaborates (`String.fromSeq(words)` converts `words` the same
way), and the explicit call — `Iterable.toSeq(words)`, `Float.fromInt(n)` — is
always an equivalent spelling. So no program is typable only because a type was
written, and no annotation supplies a scheme.

Promotion amends Functions §4's preamble and closure doc §2.4 together, for both
conversions, rather than claiming the behaviour is ordinary unification. The
amendment names them as **specified conversions** — a closed list, the language's
own, so that an annotation is never read as licensing conversion in general:

> They never change what inference *could* derive except by restricting it — or
> by being a seat. A written type is a seat's expected type, and a value meets it
> exactly as it would meet that type at any other seat: where the language
> specifies a conversion into that type at that seat — Numeric Literals §5.1's
> three widenings, an iterable's adaptation to `Seq` — the written type
> elaborates that specified conversion into the value it faces, and no other
> conversion ever happens. Where a written type elaborates a specified
> conversion, the program stays typable with the type deleted and the conversion
> written out; and no annotation ever supplies a scheme.

"At that seat" is load-bearing: the specified conversions are not uniform
across seats — `var s: Seq(String) = words` does not adapt (§2), though numeric
widening reaches the assignment boundary. Closure doc §2.4 gains the matching
sentence — an annotated binding is one supplying seat among several, and each
specified conversion is the same at every seat that specifies it — and its title
("annotations refuse, they never enable") and §9.11's test are read as the
paragraph above states them: an annotation may elaborate a specified conversion,
never make a program typable that its deletion plus the written conversion
would not.

### 6.3 Generalization and the value restriction

An inserted conversion is an application. A right-hand side with an adaptation
anywhere on its value tree therefore generalizes exactly as its explicit spelling
does — `Some(words)` or `(words, 1)` adapted is `Some(Iterable.toSeq(words))`,
no longer a syntactic value — under Functions §8 item 7's relaxed rule, never
item 2's value list, whose read-through covers pure wrappers (grouping,
ascription, a one-item layout block) and not an elaborated call. A user
instance's prerequisites can constrain an element variable only in the
elaborated form; the conclusion is the same, the explicit spelling's verdict.

In the everyday case the verdict is the one the value reading would give:
`Seq` is covariant (generalization closure doc §5.5), so an unconstrained element
variable generalizes either way (`let e: Seq(a) = Vector.empty` is
`Seq(a)`), and a non-function binding never quantifies a constrained variable
(the evidence-seat rule), so a constrained one is declined either way. The two
readings differ only for an element type with a variable in a contravariant or
invariant position (`Seq((a) -> Int)`); there the explicit spelling's answer —
the variable declined, or §8's hard error at an annotated binding — is the one
taken. No variable gains polymorphism by hiding the call, and none is lost that
the explicit call keeps.

*Implementation note.* The checker's value classifier reads the resolved tree,
where a conversion kept in a side table (as numeric widenings are) is
invisible; the adaptation must be visible to it. Numeric widenings are invisible
to it today, harmlessly, their results carrying no type variable.

### 6.4 The insertion point

The adaptation is decided at the **seat's final check**: where a value that has
closed meets its seat's expected type — the point Numeric Literals §5.1's value
widening is elaborated. The destination is read as the schedule has solved it at
that moment (§3); a dot call that resolves late still meets its arguments there,
as its widening does. One departure: a source whose type is still a variable
meets its seat at **its own turn**, not at the call's end, after its callbacks,
where such an argument's check otherwise waits — its demand links the element
then (§3), so the callbacks read it, and only the head waits for the close. The conversion itself, where
there is one, is elaborated once, when the head is known; the value is never
checked again.

**Source constructor inference is preserved by the existing channels, with no
new rule.** A `Seq` expectation never fixes a source's constructor while the
source elaborates: a lambda declines it (not a function type), a constructor
application unifies its result early only where the heads match (Functions §4.3),
a literal form hands parts only where its written shape matches (a vector
literal meets `Vector(t)`, never `Seq(t)`), and no other call's result meets its
expected type ahead of its arguments. The expectation reaches the source only as
the value it must adapt into.

**Forwarding forms**: a closed destination (`Seq(String)`) meets each path at
its own turn, as #1107 does; an open element is §2.1's element join, then each
path's adaptation. **Siblings**: a value at a callee's bare type variable never
adapts, whatever the group holds — no path, argument or element establishes `Seq`
for another (`pick(seq, vec)` at `pick<a>(x: a, y: a)` stays refused).

**Every channel an expected type already takes adapts**, as it widens: a
constructor argument whose parameter the expectation solves (`let o:
Option(Seq(String)) = Some(words)`), a literal form's parts (`let p:
(Seq(String), Int) = (words, 1)`, a record field, a vector literal's elements, a
`with` update's overrides), an argument's spine (`usePair((words, 1))`), a dot
call's arguments where it resolves late, and a constraint member's body against
its contract's result — save §5's one exclusion, an `Iterable` instance's own
subject inside its own `toSeq`. Nothing is invented: these are Functions §4.3's channels, read
from written shapes, never from inferred types. What never adapts is an
**existing** value — an `Option(Vector(String))` already held does not become an
`Option(Seq(String))` (§5): only a newly written literal or constructor
application adapts, part by part.

**Profile.** A prototype of §3 at the seat's final check — the known-head
adaptation and the unknown-source rule, over every channel above but a vector
literal's elements — was measured on `108a58ac` with #378's fix under it: the
book's and playground's 499 programs, which use no adaptation, check in the same
time with the rule off and on (2543 ms against 2409 ms, within noise); a module of
400 functions, each with five adaptation sites and an unknown source, checks
about 25% faster written implicitly than with explicit `.toSeq()` (151 ms against
203 ms — the explicit spelling is a dot call the checker resolves, the adaptation
an instance lookup), and scales linearly. The figures are indicative, not a
bound: the prototype does less than the rule — no §2.1 element join, no vector
elements, no binding publishing the destination type, no emitted conversion —
and adapts at a `var` annotation, which §2 excludes; the implementation repeats
the profile against the same two criteria (§7 item 13). At run time an
adaptation is its explicit call (§5): the collection's lazy view, and a native
loop where §4 keeps one.

### 6.5 Independence from the checker's traversal

Each seat decides once. A source whose head is known when the seat is checked
is decided there; one whose head is not is decided at its owner region's close
(§3), from its final type, so no statement order within the region changes
whether it adapts — the loop head included (#1118). Nothing replays: a later
constraint never revisits a decision made, and none is made before its
information can arrive. No head is guessed: an unknown source keeps no
provisional reading, and its default is taken only at the close. No projection is
deferred beyond the one v1 already settles by that deadline.

What remains order-sensitive is Functions §4.3's schedule residue, unchanged: the
destination is read as the schedule solved it when the seat is checked, so a
`Seq` a later sibling establishes for an earlier seat does not reach it (§3), as
for widening; and a judgment that needs a waiting source's head — §6.1's dot
call and `match` — or, in a loop body, an element nothing has fixed yet, reads
it as the schedule has solved it.

**Where a conversion may look** (friendly-numerics §4). The rule clears the three
bounds every conversion clears. *One expression, one home*: §2.1's element join
is its analogue, the paths' elements chosen together, once — a disagreement
reported where #1107's join reports it, and only a path with no instance refused
where it stands. *A written face binds*: a written `Seq` seat — an
annotation, a parameter, a declared result — is the face the value meets, and
a value that cannot enter it is refused, never read at another type. *Inferred
types choose where, never what*: an adaptation's reading follows from its
source's head once that head is final, as a dot call's member follows from its
receiver's — at the seat where the head is known, or when it arrives later, by
the region's deadline at the latest, the dot's own shape (Method Syntax §3). Nothing is
elaborated twice, speculated and undone, or read ahead by a pass; the one
default is taken where no information exists. Promotion states the deadline case
in §4's third rule, one sentence: a part whose type arrives later closes first
by its region's deadline, as a dot call's receiver does.

### 6.6 Evidence and what promotion amends

The review ran against `108a58ac`: probe programs for each paragraph above, and
a prototype of §3 measured against the compiler suite, the book's code blocks and
the playground (§6.1, §6.4; `~/Projects/hexagon-handoffs/friendly-sequences/`).
The prototype also found #378 live: a dot call settled after its body had closed
lost its effect. #378's fix (#1148, `231bae63`) holds such a body until the
goal's deadline; with it under the prototype, the effect is kept.

Promotion amends: Functions §4's preamble, closure doc §2.4 and its §9.11 test
(§6.2); Functions §4.3's seats, forwarding forms and channels, and the timing
of a waiting source's argument — both the baseline wait, which today is checker
behaviour the section never states, and this rule's departure from it (§2, §2.1,
§6.4); Functions §8 item 2
(§6.3); friendly-numerics §4's third rule (§6.5); Collections Part 2 §7.2.1 —
the default at the close, and its bullet that a loop head is not such a demand
(§3, §4); Collections Part 5 §3.1–§3.2 and Loops §7.1 (the loop head, §4);
Method Syntax §10's list of deferred decisions and its Loops §7 clause (§6.1).

## 7. Acceptance evidence

Promotion and subsequent implementation must distinguish specification review
from executable conformance. The implementation acceptance suite must cover:

1. Library and user `Seq(a)` consumers accepting standard and user iterable
   collections; element inference from `Item`; identity for an existing `Seq`.
2. Equivalent resolved call spellings, annotated bindings, declared results,
   ascriptions, forwarded blocks/branches, and expected lambda results.
3. A `Seq` branch and a non-`Seq` iterable branch under an independent `Seq`
   expectation; different iterable branches; only the selected branch running.
4. Unannotated bindings retaining their collection types and mixed branches
   without a sequence expectation receiving ordinary typing, not adaptation.
5. Missing instances, unavailable providers, unsatisfied prerequisites,
   mismatched elements, declared-variable sources, and destinations fixed too
   late.
6. Refusal of element, nested-container, existing-function, and method-search
   adaptations; rejection of effectful `toSeq` instances and `Stream` sources.
7. The existing checking order, generalization, rigid-variable, and recursion
   rules, including examples that would expose unsound extra polymorphism.
8. Exactly-once source evaluation, evaluation order, exception timing,
   persistence, laziness, and equivalence to explicit conversion.
9. Loop behaviour and native optimization costs, with canonical and user
   instances distinguished by provenance rather than spelling.
10. Foreign snapshots remaining stable after mutation on the JavaScript side,
    including lazy sequences retained beyond the crossing that captured them.
11. An unknown source decided at its owner's close (§3), in either statement
    order — `String.fromSeq(xs)` beside `Vector.length(xs)`, a loop head beside
    it (#1118) — its element linked at the seat's turn (`Seq.map(v, match …)`
    and `Seq.fold(v, 0.5, …)` after `sumInts(v)` typed as today), the `Seq`
    default where nothing describes it, an explicit `Iterable.toSeq(x)` alone
    still refused, a declared variable refused with the `Seq(a)` rewrite, the
    order of the close (§3: a goal resolved there meeting a new waiting source),
    and §6.1's two shapes refused that today accepts — a dot call and a `match`
    on a waiting source — pinned with their repair.
12. A form's paths under an open `Seq` element (§2.1): mixed collections agreeing
    on their elements adapt, in either path order; disagreeing elements are
    reported where #1107's join reports (the `if`; a later arm; a later
    element); a path with no instance refused where it stands; a path of unknown
    head contributing only its element and defaulting to `Seq`.
13. Every channel of §6.4, an existing value refused at each, and the profile's
    two criteria: no measurable cost where nothing adapts, and an implicit
    adaptation checking no slower than its explicit spelling.
14. A value headed by an `Iterable` instance's own subject never adapted inside
    its own `toSeq` (§5) — `toSeq(b) = b`, `toSeq(b) = Seq.map(b, f)` and a
    child in `Seq.flatMap(kids, (k) => k)` refused with the rewrite — while
    `toSeq(b) = b.items` adapts, and an explicit recursive call is accepted.

## 8. Prerequisites and promotion

The agreed delivery order is:

1. **Boundary snapshots implemented.** Captured `Array`, `JsMap`, and `JsSet`
   behaviour must be implemented and verified, not merely specified. The
   owners are [FFI boundary](../ffi-part1-boundary.md),
   [Array](../ffi-part2-nullable-array.md), and
   [JsMap/JsSet](../ffi-part10-js-map-set.md). Domestic immutable collections
   do not need new snapshots to make their traversal pure.
   *(Met: the capture walk of #945 copies at every declared crossing — extern
   parameters and results, `extern let`, Part 5's receiver members, exported
   functions' wrappers, callbacks' conversion wrappers, `JsValue.toArray` and
   `JsValue.from`. Verified by execution on `108a58ac`: a `Seq` taken over a
   captured `Array`, `JsMap` or `JsSet` — lazily, returned to JavaScript, or
   held by a callback's result — traverses the snapshot after the foreign
   original changes, and no captured storage is reachable by property from a
   `Seq`'s JavaScript face. Two residues are not holes this rule can use: #992
   (Part 9's handle wrappers, whose positions do not exist yet) and #984 (a walk
   budget exhausted silently by an absurdly deep type).)*
2. **Effect marking aligned with the contract/implementation distinction.**
   Constraint members state their effect contracts; instance bodies infer
   their effects and are checked against those contracts. See the
   [effect-contract proposal](constraint-effects-proposal-fable-2026-09.md)
   and its promotion record pointing to [Effects §13](../effects.md).
   *(Met: #867, #868, #869 and #947. `Iterable.toSeq`'s contract is `->`, and
   an `honor Iterable` body that performs effects is refused at the seat —
   directly, through a held `->!` field, or in a lazy `Seq`'s pull. The Effects
   redesign (#1144) keeps a `->` member a pure contract. Implementation
   prerequisite, found by this review: **#378** — a dot call settled after its
   body closed lost its effect, a loss §3's timing would multiply — fixed by
   #1148 (`231bae63`).)*
3. **Standard Iterable instances authoritative in Hexagon source.** Complete
   the [source-defined Iterable proposal](source-defined-iterable-proposal-2026-09.md):
   each standard collection's canonical home owns its `honor Iterable` block
   and `toSeq` implementation, replacing the corresponding hidden provided
   row. Private storage intrinsics and justified native optimizations remain
   permitted. Resolve the `Seq`/`Iterable` loading dependency, `Range`'s source
   home, and the `JsMap.entries` delegation cycle as that proposal requires.
   *(Met: `String`, `Range` (#1073), the foreign `Array`, `JsMap`, `JsSet`
   (#1076), with the `entries` cycle resolved, and `Vector`, `Map`, `Set` and
   `Seq` (#1141) are source-owned; the `Seq`/`Iterable` dependency is resolved
   by writing `Seq`'s row in `Iterable.hex`. No provided row remains.)*
4. **Review and promote Friendly Sequences.** After those implementation gates
   and §6's design obligations are satisfied, promote the rule into Functions,
   Collections Part 5, Loops, and the affected annotation/generalization
   owners. Then implement and verify the full bounded rule.
   *(Promoted: see the status line's record. Implementation: #1152.)*

This is a dependency plan, not a claim that all earlier implementation work is
missing. As inspected on 2026-09-23, the constraint is already declared in
[`Iterable.hex`](../../stdlib/Iterable.hex), and
[`String.hex`](../../stdlib/String.hex) already owns `honor Iterable<String>`.
The source-defined-instance note records that first slice as adopted and the
remaining rows as proposed. The snapshot and effect notes likewise record
normative promotions; those records alone do not establish complete runtime
conformance. Verify completion against the implementation when advancing a gate.

In particular, “source-defined `Iterable.toSeq`” means the actual instance
member bodies in collection homes, not moving the constraint out of
`Iterable.hex` or adding ordinary exported functions alongside its members.
With promotion, the owners named in the status line are normative; where this
note's wording and theirs differ, theirs governs.
