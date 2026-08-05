# Hexagon Spec: Type Ascription

**Status:** Decided (August 2026). Ruled on issue #307: the expression form `(e: Type)` — quintessential ML, previously absent from the language entirely — is active in v1, with the design settled in the #307 discussion: one element grammar, parens-only, rigid type variables.
**Scope:** The ascription form's grammar as an extension of the parenthesized element (§2); its typing as the annotation contract at expression granularity (§3); emission (§4); diagnostics (§5); interactions with dot-call dispatch, literal defaulting, and the lambda-header lookahead (§6); rejected and reserved alternatives (§7); edit notes (§8); implementation obligations (§9).
**Not in scope:** Binding, parameter, and return annotations — Functions §4 owns them, unchanged; ascription reuses their semantics rather than restating them. Pattern annotations — the parameter list's `pattern (: Type)?` element is Pattern Matching §6.5's and is untouched. Type-level parentheses — grouping `(T)`, tuple types, and parameter-list domains stay exactly as Products §2 and Functions §5 have them; ascription is a **term** form only. Type wildcards/holes (`_` in an ascribed type) — not in v1; the reserved seat for the exists-reading, see §7.
**Companions:** Functions §3.1 (grouping; no 1-tuples), §4.1 (the rigidity contract this form extends), §4.2 (constraint attachment stays the binder's job); Products §2.1 (the tuple side of the parenthesized form; edit note §8); Pattern Matching §6.5 (the parameter element this form rhymes with); Operators §10 (postfix positions; a parenthesized expression remains a level-1 operand); Method Syntax §3 (head evidence for dot-call goals); Numeric Literals §3–§4 (what an ascription settles before defaulting is consulted).

---

## 1. The ruling

> Inside parentheses, every element is `expression (: Type)?`. One unascribed element is grouping, as always. One **ascribed** element is the **ascription expression**: `(42: Nat)` means `42`, checked against and pinned to `Nat`. Two or more elements form a tuple whose components may each carry an ascription: `(a: Int, b)` is precisely `((a: Int), b)` with the inner parentheses dropped. Ascription has no other position in v1 — there is no bare `e : Type` in open expression space.

The form introduces **zero new semantics**. An ascription does to an expression exactly what a `let` annotation does to a binding: unify, pin, no coercion, no runtime content. Everything below is bookkeeping for that sentence.

---

## 2. Grammar

### 2.1 The element rule

The parenthesized expression production (`()` / group / tuple) gains one clause: after parsing an element expression, a `:` introduces a type annotation for that element. The type grammar is the annotation grammar (Functions §4.1's positions) — full types, arrows included: `(f : Int -> Int)`.

- `()` — the empty tuple; no element, so nothing to ascribe. `((): Unit)` needs no special rule: `()` is an expression and the group form ascribes it.
- `(e)` — grouping (Functions §3.1).
- `(e: T)` — the ascription expression, type `T`.
- `(e1: T1, e2, e3: T3)` — a 3-tuple; components 1 and 3 ascribed, each equivalent to its inner-parenthesized spelling.

**Why this is conflict-free:** there are no 1-tuples (Products §2.1). `(e)` is therefore always grouping, so `(e: T)` can only be ascription; with a top-level comma present, the tuple reading is forced and the `:` can only be ascribing a component. The two spellings that would collide in a language with 1-tuples simply never meet.

### 2.2 The colon ends the element

Within an element, `:` binds loosest: the entire element expression is ascribed. This is the element grammar's own rule, stated here as its owner: an element's delimiters — `,`, `)`, and now `:` — end whatever expression form is open, including the eats-right forms (Operators §3.2 — lambda, `if`, `match`, which that section bounds by closing delimiters and layout; the comma-stop inside brackets has always been the parenthesized form's own behavior, and the colon-stop joins it):

```
(x => x : a -> a)          -- the LAMBDA is ascribed: ((x => x) : a -> a)
(if p then 1 else 2 : Int) -- the if-expression is ascribed
```

To ascribe something *inside* such a form, parenthesize inside it: `x => (x: Int)`. This is the same resolution the comma already imposes on eats-right forms in tuples, applied to the same delimiter set.

### 2.3 The lambda-header lookalike

`(a: Int, b)` is also the prefix of a lambda header. The disambiguation doctrine is unchanged: the parser decides lambda-versus-expression on what follows the matching `)` — the arrow is the signal (the same doctrine as Pattern Matching §6.5's paren-free lookahead), and it never commits on a `name :` inside the parentheses. Parameter lists already parse each element as `pattern (: Type)?`, so after this spec the one spelling has two established readings distinguished by the token that already distinguishes them: annotated parameters before an arrow, ascribed components without one.

One piece of the *implementation* does change, recorded here because the doctrine sentence above previously oversimplified it: the lookahead's return-annotation arm (`(params): T => body`) scans from a post-`)` colon to a `=>` bounded only by the layout boundary. Today no inner `(...):` sequence is legal, so the arm cannot misfire; this spec makes such sequences legal — `((a, b): (Int, String)) |> map(x => x)` puts a colon after an inner `)` with an *unrelated* arrow later in the line. The scan must tighten to accept the arrow only when it immediately follows one well-formed type (§9.1); with that, the doctrine sentence is true again.

### 2.4 Parens-only, deliberately, v1

Ascription lives only in the parenthesized element grammar. A bare `e : Type` in open expression position remains a parse error. Ruled with the expansion door open: if safe contexts for a freer form come up later, the restriction is re-examined; until then the form is visually delimited, and no colon in expression space is ambiguous between ascription and the binding-annotation colons. (OCaml has the same restriction.)

---

## 3. Typing: the annotation contract at expression granularity

An ascription checks and pins exactly as a `let` annotation does (Functions §4.1):

- The ascribed expression's type unifies with the written type. Failure is an ordinary type mismatch reported at the ascription (§5).
- A successful ascription **pins**: `let n = (42: Nat)` gives `n : Nat`; the literal's `Num` variable was settled by unification, so Numeric Literals §4's defaulting never has a variable to consult (§6.2).
- There is **no coercion**. `(x : Float)` with `x : Int` is a type mismatch, not a conversion — conversions are named functions, as everywhere.
- **An ascription of a syntactic value is itself a syntactic value.** Functions §8's read-through includes the ascription wrapper alongside grouping parentheses (edit note, §8): `let id = (x => x : a -> a)` generalizes exactly as `let id = (x => x)` does. An ascription wraps; it does not evaluate.

### 3.1 Type variables are rigid — the annotation scope

A type variable written in an ascription is what it is in every other annotation: **rigid, a checked generality claim** — the contract reading of Functions §4.1, extended to this position by the same sentence.

> Type variables written anywhere in one declaration — parameter annotations, the return annotation, and ascriptions in its body — are the same variables. A name not written elsewhere in the declaration is introduced rigid, scoped to that declaration.

Consequences, in the order a reader meets them:

```
let f(x: a): a = (x : a)      -- the inner a IS the declaration's a; trivially fine
let n = (42 : a)              -- ERROR: 42 is not every type — exactly §4.1's rejected
let id = (x => x : a -> a)    -- fine: the identity genuinely is that general
let inc = (x => x + 1 : a -> a) -- ERROR: only Num types support +
```

Rigid ascription variables accumulate inferred constraints exactly as §4.1's do — rigidity pins structure, not demands. The scope rule above is stated for one declaration; the exact chaining across *nested* declarations (which enclosing scope a fresh name introduced inside an inner `let` joins, and how inner `<a: C>` binders shadow) is **deferred to the checker arc** — the implementation must surface the question rather than invent the answer silently.

This is a **deliberate divergence from OCaml**, whose annotation variables are uniformly unification holes (`(3 : 'a)` succeeds there, `'a` silently `int`). Hexagon's annotations are uniformly contracts; ascription joins them. One spelling, one meaning. (§7; the language-wide doctrine record is #315's.)

### 3.2 Constraints are not attachable here

`(e : a)` can name a variable; it cannot constrain one — there is no `(e : a: Ord)` form. Constraint attachment is the binder's one power (Functions §4.2) and stays in binder position. An ascription that needs a constrained variable names one the declaration's binder already declared.

---

## 4. Emission

Ascription **erases**. `(e: T)` emits exactly as `(e)` would: the expression, parenthesized only where precedence already demanded it. No wrapper, no comment, no `.d.ts` trace — the declaration surfaces of FFI Part 7 are computed from types, which the ascription only influenced through ordinary unification.

---

## 5. Diagnostics

- **Mismatch:** the ordinary type-mismatch report, primary span on the ascribed expression, phrased against the written type — the same family a `let` annotation's failure uses. No new diagnostic kind.
- **Rigid violation:** `(42 : a)` reports in §4.1's declared-type-variable family (the diagnostics say **declared type variable**, never *skolem*).
- **The parse error this spec retires:** `(42: Nat)` formerly died with ``expected `)` after expression`` at the colon. That token is now grammar. No compatibility shim — the spelling had no prior meaning.
- The Rewrite Rule imposes nothing new: no diagnostic in this spec names a rewrite that does not compile.

---

## 6. Interactions

### 6.1 Dot-call head evidence

An ascription is **independent evidence** in Method Syntax §3.1's sense: `(42: Nat)` is head-known `Nat` at the dot, so `(42: Nat).dotCall()` resolves through `CompanionOf(Nat)` — once the Primitive-row implementation lands and §3.4/§4.3 gain their `Nat` row (#304's arc, not this spec's). This spec only guarantees the receiver spelling exists and pins.

### 6.2 Literal defaulting

Numeric Literals §4 defaults a literal variable that is *still unresolved* at generalization. An ascribed literal never is: unification settled it at the ascription. No ordering rule is needed — pinning by unification is simply earlier than defaulting, as with any annotation.

### 6.3 The parameter-list rhyme

`(a: Int, b)` as an expression and `(a: Int, b)` as a lambda's parameters are deliberately the same surface shape with per-element colons; §2.3's arrow rule is the entire difference. This is recorded as a feature, not a hazard: the reader's one habit — "a colon after a thing types that thing" — is true in both readings.

---

## 7. Rejected and reserved alternatives

1. **Unifiable ascription variables** (OCaml: `(3 : 'a)` succeeds). Rejected, on consistency: every other Hexagon annotation is a contract, and the unifiable reading's lone power (asserting two positions share a type without claiming generality) is nearly always discovered by inference. The classic footgun — `(fun x -> x + 1 : 'a -> 'a)` looking like a polymorphism claim while OCaml silently monomorphizes `'a` — is the price of that convention, and Hexagon declines to pay it. The language-wide contracts-versus-constraints doctrine record is #315's business.
2. **General postfix ascription** (`e : T` anywhere). **Reserved, not rejected** — v1 is parens-only (§2.4); revisit on demonstrated safe contexts.
3. **Type holes** (partial annotations, the exists-reading — `(e : Vector(□))` for some hole spelling). **Reserved, spelling unsettled.** The leading candidate spelling `_` is **contested**: a forthcoming default-parameters proposal is a rival claimant for that token, so this spec deliberately reserves the *capability* without the *character*. Not in v1 either way; the design discussion is #315's.
4. **A dedicated AST-visible coercion or conversion reading.** Rejected without discussion — nothing in the ML family reads ascription as conversion, and Hexagon's conversions are named functions.

---

## 8. Edit notes

- **Products §2.1**: the arity bullet gains a pointer — the parenthesized form's element grammar (and the ascription reading of the one-element case) is this spec's.
- **Functions §4.1**: gains a sentence noting ascription (this spec) as a fourth annotation position sharing the same rigidity contract and the declaration-wide variable scope.
- **Functions §8 item 2**: the read-through clause ("parentheses only group…") gains the ascription wrapper — an ascription of a syntactic value is a syntactic value (§3 here).

Method Syntax and Numeric Literals are consulted by §6 but need no text: their rules already quantify over "head-known" and "still unresolved" without caring how the state arose.

---

## 9. Implementation obligations

1. **Parser:** the element rule in the parenthesized production — after the element expression, an optional `: Type` via the existing annotation-type parser, checked before the closing-paren expectation (the `Colon` token already halts the expression loop, so the load-bearing change is the new arm, not the stop set); a new `Ascription { expression, annotation }` expression node. The lambda lookahead's return-annotation arm **must tighten** per §2.3: accept the arrow only when it immediately follows one well-formed balanced type after the colon, so an inner `(...):` with an unrelated later `=>` on the line does not misparse as a lambda head. Tests: `(a: Int, b)` as tuple and `(a: Int, b) => e` as lambda; `((a, b): (Int, String)) |> map(x => x)` and `f(((a, b): (Int, String)), z => z)` parse as ascriptions, not lambda heads; `(params): T => body` still parses as an annotated lambda.
2. **Resolver:** walk the node; type names in the ascribed type resolve through the ordinary annotation path (occurrence identity included, for the LSP).
3. **Checker:** reuse the annotation path — elaborate the written type in the enclosing declaration's annotation-variable scope (introducing unseen names rigid, per §3.1), unify with the expression's type. No new unification machinery.
4. **Emitter:** erase (§4).
5. **LSP:** hover on `(e: T)` shows `T`'s expansion as any annotation does; go-to-definition and find-references reach type names inside ascriptions; semantic tokens classify them as type names.
6. **TextMate grammar:** the `:`-introduced type context inside parentheses must colour as type syntax in both readings (parameter annotation and ascription) — expected to already hold, since the grammar cannot and need not distinguish them; verify against the Playground and VS Code with the §2.3 pair.
7. **Tests:** the §3.1 four-example block verbatim; the §2.2 eats-right pair; the §2.3 tuple/lambda pair; `(42: Nat)` end-to-end (type, emission erasure, `.d.ts` absence); a tuple with mixed ascribed/plain components; the retired parse error's replacement behavior; mutation coverage on the rigid-scope join (a test that fails if ascription variables are fresh-per-ascription instead of declaration-scoped).
