# Default parameters — proposed ruling

**Status:** Proposed ruling (2026-08-04, Opus in conversation with James). This
note decides nothing; it records a design, the argument that admits it, the
alternatives rejected along the way, and — separately and explicitly — what was
not verified. It supersedes an earlier unwritten sketch, summarized and declined
at §7.1.

**Authorities on any conflict:** `functions.md` §5 (call syntax, arity, the
current prohibition), §5.1 (displayed function types), §5.2 (the n-ary
departure; parameter-list polymorphism), §5.3 (the zero-parameter domain);
`type-system-overview.md` §2.6 (no subtyping); `ffi.md` §9.2 (the post-v1
deferral); `ffi-part6-functions-callbacks.md` (boundary calling convention);
`ffi-part7-exports.md` (exported faces); `constraints.md` §6.1 (the
function-as-value precedent); `modules.md` §5 (namespaces); `products.md` §2.6
(arity-indexed rules). This note navigates; it never overrides.

---

## 1. The question, and why it has felt stuck

Should Hexagon have default parameter expressions — `connect(host, port = 8080)`
— callable as `connect("db.internal")`?

The design has been hard to start because the corpus holds the question in two
places under **two different locks**, and work that does not first pick a lock
goes in circles.

| Where | Status | Lock |
|---|---|---|
| Pure Hexagon functions | **Decided against.** `functions.md` §5: "No optional, default, or named parameters in pure Hexagon functions." | A standing decision. Reopening needs an argument that was not available when it was made. |
| The JavaScript boundary | **Deferred post-v1.** `ffi.md` §9.2: "Overloads; rest/variadic; optional/default parameters (Part 4 §11; Part 6 §8)." | A recorded deferral with an owner and a revisit bar. Reopening needs the bar met. |

The two are not the same question and do not carry the same burden of proof.
§3 supplies the argument the first lock needs; §5.1 supplies the fact that
turns the second.

## 2. What the obstacle is not

Recorded first because the opposite framing sent an earlier round of this design
down the wrong path, and it will recur.

Defaults look like they fight Hexagon's ML nature. **They do not.** The ML
precedent — OCaml's `?x:` optional arguments — rides on *currying*: an omitted
argument is erased by the application of a following positional one, which is
why OCaml warns that an optional argument "cannot be erased" in trailing
position. Hexagon deleted currying, so the OCaml mechanism does not port. But
what it collides with is `functions.md` §5.2, which is explicit that n-ary
functions are Hexagon's departure **from** ML:

> **Hexagon departed deliberately, and the departure is load-bearing** — it is
> what buys n-ary JS-native emission.

So a JavaScript-shaped feature is obstructed by a JavaScript-shaped decision.
Nothing in Hindley–Milner, the value restriction, coherence, or row
polymorphism is implicated. Whatever else this design costs, it does not cost
the ML core, and an objection phrased as "this is un-ML" is answering the wrong
question.

## 3. The admitting argument: bounded overloading

Full overloading is rejected in languages of this family for a specific reason:
**resolution needs types, and under Hindley–Milner the types are not available
at the point resolution must happen.** That circularity is why Haskell has type
classes rather than overloading, and why Hexagon has `honor`.

Defaults resolve on **arity**, and arity is a syntactic fact known at parse
time — before inference runs at all. The objection that kills overloading
therefore does not reach defaults. This is not a weaker form of the same
feature; it is a different question that happens to share a surface.

That yields a clean division of labour, worth stating in the ruling so the two
are never confused:

- **`honor` owns the type-indexed slice** of ad-hoc polymorphism.
- **Defaults would own the arity-indexed slice**, and nothing else.

**This is the argument that earns the feature its place under #147**, and the
reason the motivating sentence must not be "JavaScript uses defaults
constantly." Under the doctrine pivot (`decisions-ml-dialect-bool-2026-07.md`
§1.1) the ML answer wins by default and a JS-native answer must point at
something JavaScript-specific. "JS uses it constantly" is a habit, not a fact
about JavaScript, and it does not clear that bar. "Arity is decidable before
inference, and types are not" is a fact about **Hexagon's own inference**, and
it clears a higher one.

**Precedent: arity is already an admitted indexing axis.** `products.md` §2.6,
under #159: "The representation rule is **arity-indexed**" — at arity ≥ 2 an
array, at arity 0 `undefined` — and the ruling is explicit that this is "a
clause, not a pin: there is no declaration to privilege and no exception being
carved." Indexing a rule by arity is something this language already does
without treating it as a special case.

## 4. Scope

Optional parameters with declared default expressions, in ordinary Hexagon
`fun`/`let` declarations and at the extern boundary. **Named arguments are not
in scope** and are not implied: everything below is positional, and defaults
apply to a **trailing** run of parameters only. Rest/variadics remain deferred
(`ffi.md` §9.2); parameter-list polymorphism remains the post-v1 form for arity
*abstraction* (`functions.md` §5.2) and is a different feature in the opposite
direction — it lets a caller abstract over arity, where this lets a callee
require less of one.

## 5. Mechanism

### 5.1 Optionality is part of the type — because exports require it

The decisive fact, and the one that turns §1's second lock.

A default could in principle be pure call-site sugar: the type stays exactly
n-ary and the compiler fills omitted slots at each call. That serves pure
Hexagon call sites and **cannot reach the boundary at all.** A JavaScript
caller has no Hexagon compiler to do the elaborating. For an exported function
the default must live in the emitted `function connect(host, port = 8080)`, and
the `.d.ts` must read `port?: number`, or the JS consumer simply cannot omit
the argument.

Optionality that survives export *is* optionality in the type. So the type
carries it:

```
connect : (String, ?Int) -> Connection
```

*(Spelling of `?` is a surface question, §8 item 1; the semantics below do not
depend on it.)*

### 5.2 Optionality is invariant — this is what preserves pillar 6

`type-system-overview.md` §2.6:

> **No subtyping.** Rows give the "this function accepts any record with at
> least field x" ergonomics without a subsumption relation. Unification-only.

The natural next wish, once optionality is in the type, is for
`(String, ?Int) -> C` to be usable wherever `(String) -> C` is expected. **That
wish is a subsumption relation**, and granting it introduces subtyping into a
language that has deliberately spent that budget on row polymorphism instead.
TypeScript can afford it; Hexagon cannot.

So: `(String, ?Int) -> C` is a **distinct type** from both `(String) -> C` and
`(String, Int) -> C`. No subsumption, no coercion, no implicit adaptation.
`functions.md` §5's rule survives with one word changed — unification compares
arity **ranges** for equality rather than arity numbers, then unifies parameters
pointwise as before.

The cost is that passing `connect` where a one-parameter function is expected
requires an eta-wrap, `host => connect(host)`. That is precisely the seam
§5.2/§5.3 already establishes and defends for the nullary case. This extends an
existing posture rather than carving an exception — which is the whole reason
it is affordable.

### 5.3 Optionality is declared-only, never inferred

A lambda has no parameter declarations and therefore no defaults. Optionality
enters the type only where a declaration writes it. Nothing in Algorithm J is
asked to infer an arity range, and no unsolved type variable can acquire one.
Inference is untouched.

### 5.4 Defaults evaluate per call, at call time

JavaScript evaluates a default expression on each call where the slot is
omitted. Python evaluates at declaration time and the resulting shared-mutable
bug is among the most famous in the language. Hexagon matches JavaScript.

**This is a legitimately JavaScript-specific argument** and clears #147's bar on
its own terms: the emitted artifact is a JS function whose default expression
sits in the parameter list, and any other timing would require the emitter to
stop using JavaScript's own construct and hand-roll the fill-in — losing the
readable-output property the emission is there to serve.

Whether a default may reference an earlier parameter (`f(a, b = a + 1)`, legal
in JavaScript) is left to §8 item 2.

### 5.5 Emission and the `.d.ts`

The point of §5.1 is that both faces are the JavaScript-native ones:

```js
function connect(host, port = 8080) { … }
```
```ts
declare function connect(host: string, port?: number): Connection;
```

No wrapper, no arity adapter, no sentinel. Zero-cost erasure (pillar 8) is
preserved because there is nothing to erase — the construct survives to the
target verbatim.

## 6. Do not relitigate: no subsumption

Recorded as its own section because it is the sentence the ruling lives or dies
on, and because the argument against it is ergonomic, obvious, and will be
raised by every reviewer who has written TypeScript.

**A function type with an optional parameter is not usable where a function type
of the shorter arity is expected.** Not by coercion, not by implicit
eta-expansion, not by a special case in unification, not "only at
non-higher-order positions." The eta-wrap (§5.2) is the seam, and it is the same
seam the language already asks for elsewhere.

Granting subsumption here would make optional parameters the language's **first
subtyping relation**, and it would arrive by convenience rather than by design.
Pillar 6 is not a preference; rows exist *because* it holds.

## 7. Rejected alternatives

### 7.1 The earlier sketch: underscore placeholders at fixed arity

**Summary** *(reconstructed from James's description — no document for it exists
in `spec/notes/`, and this section is the only record)*: keep arity exactly
fixed, and let a caller write a placeholder in a slot to request its default —
`connect("db.internal", _)`. Every call still passes syntactically N arguments,
so `functions.md` §5's arity rule needs no change at all.

**Declined, on four grounds, the last of which is fatal:**

1. **It reopens a separately decided question.** `functions.md` §5 already
   rejects placeholder shorthand outright — "No placeholder shorthand
   (`f(_, 2)` etc.). None; the completed FFI did not reopen this, and no other
   pressure has." The sketch would have to win *that* argument first, and on
   its own merits, not as a side effect.
2. **It overloads a token that already means something adjacent.** `_` is the
   pattern wildcard, "matches anything, binds nothing"
   (`pattern-matching.md`:26). Giving it a second, unrelated meaning — "supply
   the declared default here" — in argument position puts two readings of one
   token within a few characters of each other in the grammar.
3. **It cannot reach the boundary.** A JavaScript caller cannot write `_`. So
   exported functions gain nothing, and `ffi.md` §9.2's deferral — the door
   with an actual revisit bar — stays shut. This is the same wall call-site
   elaboration hits (§7.2).
4. **It buys nothing at the call site, which is the entire point of the
   feature.** `connect("db.internal", _)` is not shorter, clearer, or more
   robust than `connect("db.internal", 8080)`. Defaults are valuable *because
   the slot is not written*; a design that still requires writing the slot has
   kept the cost and discarded the benefit.

Ground 4 is the one to remember. The sketch preserved the arity invariant
perfectly and, in doing so, preserved exactly the thing the feature exists to
relax.

### 7.2 Call-site elaboration only (type stays n-ary)

The type keeps its exact arity; the compiler fills omitted trailing slots at
each call from the callee's declaration. **Attractive and nearly free** — no
type-system change whatever, §5's rules untouched, pillar 6 not even in the
conversation.

Declined because it cannot serve exports (§5.1). It also loses defaults for a
function referenced as a value, since there is no call site to elaborate. Kept
on record because if §8's confirmations go badly it is the fallback, and
because it remains the correct mechanism for any *inbound-only* subset someone
later wants to ship early.

### 7.3 Arity clauses (overload by arity)

```hexagon
fun connect(host: String) = connect(host, 8080)
fun connect(host: String, port: Int) = …
```

Declined. Two declarations sharing one name collides with `modules.md` §5's
namespace rules, and it reintroduces genuine overloading machinery — name
resolution producing a *set* of candidates — which §3's argument was careful to
avoid. Note the asymmetry deliberately: this design takes the **overloading
argument** (§3) while declining the **overloading syntax**. The justification
and the spelling come from different places, which is unusual enough to state.

### 7.4 Status quo: model the slot honestly with `Nullable`

What the corpus does today at the boundary
(`notes/ffi-proto-spec-questions.md`:641): "V1 extern callables have fixed
visible arity; an API's explicit nullish slot is modeled honestly", with callers
passing `Nullable.undefined` for the omitted case.

Not *wrong*, and it stays correct for APIs that genuinely distinguish `null`
from `undefined` from absent. Declined as the general answer because it forces
every caller of every defaulted JS API to write a sentinel the API's own users
never write, and because it cannot express an outbound default at all.

## 8. What must be confirmed before implementation

None of the following was verified.

1. **The surface spelling**, in both positions: the declaration
   (`port: Int = 8080`) and the type (`(String, ?Int) -> C`). `?` is used above
   for readability only. Check it against `lexer.md` for conflicts, and against
   `functions.md` §5.1's display rules, which currently have no way to render an
   optional slot.
2. **Whether a default may reference an earlier parameter.** JavaScript allows
   it; it makes the parameter list a scope, which it currently is not.
3. **Whether the arity-range change actually is one word in unification.** §5.2
   asserts this; the checker's arity-first rule was not read.
4. **The interaction with `products.md` §2.6's safety condition.** That
   arity-indexed clause was audited on "nothing consumes a tuple arity-generically
   at runtime," and names parameter-list polymorphism as its pre-registered
   reopener. Parameter lists are not tuples (§5's no-splatting rule is explicit),
   so this is expected to be clear — but the two are adjacent enough to check
   rather than assume.
5. **The function-as-value seam**, which §5.2 answers by eta-wrap. Confirm that
   answer against `constraints.md` §6.1's treatment of a *constrained* function
   referenced as a value (#205/#207), which settled a structurally identical
   problem on "evidence dischargeability at the reference, never the reference's
   syntax." If that ruling's shape applies, reuse it rather than inventing a
   second story.
6. **What the boundary does with a foreign optional parameter inbound** —
   whether an extern declaration may declare a default at all, or only declare
   the slot optional and leave the default to the foreign implementation. FFI
   Part 6 owns the calling convention and was not read for this.
7. **Whether defaults may appear on constraint members**, whose dictionaries
   have a fixed shape (`constraints.md` §6.1). Presumed no; not checked.

## 9. Expected blast radius

Larger than either the CSE or DCE work orders, and of a different kind: this one
**has a language surface**. New syntax, a type-system-visible change, new
diagnostics, `.d.ts` changes, LSP display changes, and book text. It is not in
the same class as an emitter optimization and should not be scheduled as though
it were.

Specifically touched: `functions.md` §5 (three bullets, one of which is a
decision reversal), §5.1 (display), the arity diagnostic family; `ffi.md` §9.2
(a deferral discharged in part); FFI Parts 6 and 7; `modules.md` §4.1 (exported
signatures); the checker's arity path; the emitter; the `.d.ts` emitter; the
grammar and the TextMate grammar; hover and completion.

The correction record obligation is real: `functions.md` §5's "No optional,
default, or named parameters" is a standing decision being reversed in part, and
`decisions-*` house style requires the reversal be recorded where the original
was stated, not only here.
