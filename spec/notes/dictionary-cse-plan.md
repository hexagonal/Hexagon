# Dictionary CSE and letrec-bound evidence — speculative work order

**Status:** Speculative (2026-08-03, Opus in conversation with James). This note
decides nothing and states no language rule. It records an emitter optimization,
the observations it rests on, and — separately and explicitly — the claims that
were *not* verified and must be confirmed before any implementation begins.
Next step is Fable's fundamental spec analysis. Implementation follows only
after that.

**Authorities on any conflict:** `constraints.md` (dictionaries, coherence,
`honor` instances), `functions.md` §4.1/§4.2 and §8 (dependency-order checking,
generalization), `ffi-part9-exported-dictionaries.md` (exported faces),
`ffi-zero-cost-fundamental-exports.md` §2.1 (the fundamental set). This note
navigates; it never overrides.

---

## 1. What this is

A semantics-preserving change confined to the emitter. Two defects, one
mechanism.

There is **no language-surface component**: no new syntax, no type-system
change, no diagnostic, no `.d.ts` change, no Playground or LSP change, no book
text. If it lands correctly the only observable differences are the text of the
emitted JavaScript and the number of objects allocated at runtime.

That is the whole reason this is attractive relative to the other items in the
queue. It buys an improvement in the artifact the project has staked its
positioning on — readable output — without spending any surface commitment.

## 2. Current emitted shapes

All of the following were read from the tree on `defect-254-caret-hover-gate`
and are **verified**.

**Specialization already removes evidence at the fundamental types.**
`compiler/src/passes/emitter/specializations.ts` plans a closed family of
editions over an *enumerated* fundamental set — `Nat`, `Int`, `Float`,
`BigInt`, `Bool`, `String`, `Unit` (the comment there is explicit that
membership is a language category, not an inference from type classification).
So:

```hexagon
export let plus<a: Num>(x: a, y: a): a = x + y
let answer = plus(20, 22)
```

emits `function plusInt(x, y) { return x + y; }` and `const answer =
plusInt(20, 22);` — a native operator with no dictionary in sight
(`emitter.test.ts:1874-1888`, `:1563-1577`). The same test asserts *negatively*
that `plus(20, 22, ({` does not appear: the inline-dictionary-object shape is
already a pinned non-goal.

**The generic edition is still emitted alongside it** when the function is
exported, and takes evidence as a trailing parameter:

```js
const plus = (left, right, __hex_dictNum_7) => __hex_dictNum_7.add(left, right);
```

Parameter naming is `__hex_dict${constraint}_${variable}`
(`emitter.ts:5091`).

**Instances are already named module-level constants, not inline literals:**

```js
const __hex_instance_Labeled_Token = { same: __hex_instance_Same_Token, label: value => "token" };
```

**Base constraints are a field holding the base instance**, so access is one
hop (`dict.same`) rather than a projection chain (`emitter.test.ts:1670-1692`).

**Parameterized honors emit as factories, applied at the use site:**

```js
const __hex_instance_Render_Box = __hex_dictRender_3 => { ... };
// ...
__hex_instance_Render_Box(__hex_instance_Render_Int)
```

(`emitter.test.ts:1694-1720`.)

The first three of these are the work a naive version of this plan would have
proposed doing. It is already done. **The residue is the last one: the
*application* of a factory is not hoisted.**

## 3. The two defects

### 3.1 Constructed evidence appears inline at use sites

`__hex_instance_Render_Box(__hex_instance_Render_Int)` reads acceptably at one
level. At two — `Render<Box(Box(Int))>` — the use site carries a nested
construction expression, and that is the shape at which generated output stops
looking like something a person wrote. The cost is borne exactly where the
project's positioning is most exposed: in the readable `.js` a TypeScript
consumer opens.

### 3.2 A recursive instance may rebuild its dictionary per recursive call

**This is the load-bearing claim of the plan and it is NOT verified.** See §6.

Given a recursive type and a parameterized honor over it:

```hexagon
union Tree(a) = Leaf | Node(Tree(a), a, Tree(a))
honor<a: Show> Show<Tree(a)> =
    show(tree) = ...   // the recursive occurrence needs Show<Tree(a)> again
```

the evidence the body needs for its recursive call is *the dictionary currently
being defined*. If the emitter re-applies the factory at each such call, the
program allocates one dictionary **per node visited**, not one per traversal.

That would be a genuine performance defect hiding behind a cosmetic complaint,
and it is the reason this plan is worth more than tidying.

## 4. Proposed mechanism

> **Claim by Sol:** Within one dominance scope, semantically identical evidence
> construction is materialized at most once.

**Response (2026-08-04, Opus).** Sound, and strictly weaker than §4.2. Dominance
is the right bound when a repeated expression may read mutable state; evidence
reads none (`constraints.md` §6.3, evaluation-free) and is coherent (§5.1), so
the bound is the **module**. §5.1 reaches this from the other side in the same
words — module level "rather than to the innermost scope dominating the use
sites" — so the claim confirms the fork rather than moving it.

**The part that is not redundant:** dominance-scoped placement would eliminate
**§4.4 entirely.** A binding at the dominator of its use sites sits after
everything it depends on — no letrec, no emission order, no TDZ. That names a
safe fallback for the plan's single hardest risk, and the note did not previously
consider *not* hoisting to module level.

It cannot replace §4.2, because it does not reach §3.2: a self-referential
dictionary is a fixpoint, and no dominance-scoped placement constructs one.
Taking it as *the* mechanism shrinks this plan to §3.1 — the same outcome §6
item 1 describes by another route. It also presupposes the recognition problem
(§4.1, §6 item 4) rather than answering it. Terminology flag: "dominance scope"
appears nowhere else in `spec/` or `compiler/src/`; it needs a definition and an
owner before it survives into a ruling.

### 4.1 A canonical key for evidence

CSE requires that two occurrences of the same evidence be recognisable as the
same. The key is the structural evidence tree — the selected instance plus,
recursively, the keys of its argument dictionaries.

This is expected to be cheap because the tree is always **ground** (§5). The
selection machinery already canonicalizes enough to choose an instance; the
plan assumes, but does not prove, that the same representation can be hashed.

### 4.2 Hoist each distinct application to a module-level binding

Every distinct key becomes one module-level `const` with a derived name in the
existing `__hex_instance_*` family, and every use site becomes a reference to
it. `Render<Box(Box(Int))>` yields one binding, referenced by name, however
many times it is needed.

### 4.3 Self-reference for recursive instances

The §3.2 case makes the hoisted binding refer to itself: the factory's body
mentions the very constant its application defines. In JavaScript this is
sound *provided the reference sits inside a closure body* and is therefore not
evaluated at definition time — but it means the emitter is now generating a
letrec-shaped binding, not a straight-line one, and must know it.

### 4.4 Emission order and the temporal dead zone

Hoisted bindings must be emitted in dependency order. Self-referential ones
must be emitted such that no reference is *evaluated* before initialization
completes. This is the only genuinely hard part of the change, and the only
place a subtle failure could hide: a TDZ violation here is a runtime
`ReferenceError` at module load, not a compile error.

## 5. Why Hexagon can do this

Four of the language's standing restrictions are what make the optimization
sound. This is the argument worth checking hardest, because if it is wrong the
plan is unsound rather than merely incomplete.
*(Coherence row and §5.1 added 2026-08-03: as first written this section
credited three restrictions, all of which bear on cost and termination and none
of which licenses sharing at all.)*

| Restriction | What it buys here |
|---|---|
| Global coherence | Two occurrences of the same evidence **are the same value**, so sharing one binding between them is semantics-preserving |
| No polymorphic recursion | The evidence family is **finite**, so every dictionary is hoistable |
| No higher-kinded types | Evidence is a **ground term**, so it canonicalizes into a hashable key |
| No currying | A factory is an n-ary function, so hoisting is a textual lift rather than an unpicked closure chain |

### 5.1 Coherence is what makes the sharing legal

Recorded first because it is the premise the other three sit on top of. They
answer *can the hoisting be computed, and cheaply*; only coherence answers *may
two use sites be given one dictionary at all*.

`constraints.md` §5.1 fixes **at most one instance per (constraint, type
constructor), program-wide**, and §5.2 admits no local and no overlapping
instances — `honor` is a module-level declaration, so there exists no scope in
which a use site could see a different instance than another use site sees.
That, and only that, is why two occurrences of `Show<Int>` denote the same
value and may be replaced by one reference to one binding. Under Scala-style
implicits or ML functors the same two occurrences may lawfully select different
evidence, and this entire plan is unsound rather than merely more expensive.

Coherence is also why hoisting to **module level** specifically is available
(§4.2), rather than to the innermost scope dominating the use sites: there is
no enclosing-scope subtlety to respect, because instance visibility does not
vary by scope. And §5.4's instance-head restriction — one type constructor
applied to distinct type variables — is what makes selection "a table lookup
keyed on (constraint, constructor) rather than a search", which is the property
§4.1's canonical key inherits.

Consequence for §6: coherence is not on the confirm-before-implementing list
and should not be added to it. It is decided, it is enforced, and it is cited
here as an authority rather than an assumption. What §6 must still confirm is
narrower and already listed — that the *representation* selection uses can be
canonicalized (§6.4). Coherence guarantees the two dictionaries are the same
value; it does not by itself guarantee the emitter can *recognise* that they
are.

The second restriction is decisive for termination. Under polymorphic
recursion a function may call itself
at a *different* instantiation — `f` at `Tree(a)` calling itself at
`Tree(Tree(a))` — requiring `Show<Tree(a)>`, `Show<Tree(Tree(a))>`, and so on
without bound. That family is infinite and constructed at runtime; it has no
fixpoint, so §4.3 does not apply to it and §4.2 cannot terminate. GHC's
inability to always specialize nested datatypes is the same phenomenon.

Ban polymorphic recursion and a recursive occurrence needs *the same*
dictionary, which is precisely a fixpoint of a single value — what §4.3 binds.

Hexagon bans it structurally rather than by convention. `checker.ts:958-965`
checks functions in the strongly-connected components of the function-reference
graph, and installs **provisional monotypes** for a component's members
together, before any body is checked; generalization happens afterward. A
recursive occurrence therefore sees a monotype, not a scheme, and cannot be
instantiated at two types. `checker.test.ts:564` pins direct recursion
(`choose` recurses, checks monomorphically, generalizes to `a -> a`, and both
`choose(1)` and `choose("a")` typecheck after); `checker.test.ts:132` pins that
genuine mutual recursion shares one monomorphic component.

Worth recording that the corpus already reasons in this currency. The
placeholder comment at `checker.ts:944-954` rejects a design on the grounds
that it would hand "the single runtime value out at two types, with two
evidence dictionaries at constrained types." That is the same argument as this
plan's, arrived at independently and for a different purpose.

## 6. What must be confirmed before implementation

Recorded separately and deliberately. None of the following was verified; the
plan is written as though they hold, and it does not survive all of them being
false.

1. **That §3.2 is real.** No test exercises a recursive parameterized instance,
   and the per-node-allocation claim was inferred from the emitted shape of a
   *non*-recursive one (`Render<Box(a)>`), not observed. Write the specimen and
   read the output first. If the emitter already shares that dictionary, §3.2
   evaporates and the plan shrinks to §3.1 — still worth doing, worth much
   less.

2. **That nested applications actually appear inline at depth > 1.** Verified
   at depth 1 only. Depth 2 was extrapolated.

3. **That no rigid annotation reopens polymorphic recursion.** §5's argument
   rests on component members being installed as monotypes. Nothing observed
   installs a *quantified* scheme for a component member, and the annotated
   recursion test that exists (`fact(n: Int): Int`) is monomorphic and so
   proves nothing either way. The question is whether a *polymorphic*
   annotation on a recursive `fun` causes the recursive occurrence to be typed
   at the annotated scheme rather than at a fresh monotype. Haskell's
   polymorphic recursion is exactly this door, added deliberately to a checker
   that otherwise behaves as Hexagon's does. Confirm it is shut.

4. **That the evidence representation can be canonicalized into a hash key**
   (§4.1), rather than merely compared during selection.

5. **The interaction with exported dictionary faces.** FFI Part 9 owns what
   crosses the boundary. Hoisting changes the module's top-level binding set,
   and whether any hoisted binding is or must be reachable from an export is
   not addressed here.

## 7. Non-goals

- Removing the evidence parameter from a genuinely polymorphic exported
  function. That is irreducible; no technique in this note touches it.
- Extending the specialization set beyond the enumerated fundamentals. That set
  is a language category owned by `ffi-zero-cost-fundamental-exports.md` §2.1
  and is not to be widened as a side effect of an emitter optimization.
- Any change to instance selection, coherence, or which dictionary is chosen.
  This plan changes *where a dictionary is built*, never *which one*.
- Renaming the `__hex_dict*` / `__hex_instance_*` families.

## 8. Expected blast radius

Output-pinning tests will churn hard — the byte-identical corpus compares
emitted text, and this change alters emitted text broadly by construction. That
is mechanical rather than risky, but it should be budgeted for rather than met
mid-change, and it degrades the corpus's value as a regression signal for the
duration of the change. Consider how to distinguish intended churn from
unintended before starting, not after.

The realistic risk concentrates in §4.4. Everything else fails loudly; a TDZ
ordering mistake fails at module load, possibly only for one instance shape.
