# Hexagon Spec: Type Ascription

**Status:** Decided (August 2026). Ruled on issue #307: the expression form `(e: Type)` — quintessential ML, previously absent from the language entirely — is active in v1. The design settled across the #307 discussion and its resume after the type-holes arc: one element grammar, parens-only, and ascription as a fourth annotation position under Functions §4.1's one contract — rigid variables that accumulate inferred constraints, holes legal by the annotation doctrine's own rule.
**Scope:** The ascription form's grammar as an extension of the parenthesized element (§2); its typing as the annotation contract at expression granularity, variables and holes included (§3); emission (§4); diagnostics (§5); interactions with dot-call dispatch, literal defaulting, and the lambda-header lookahead (§6); rejected and reserved alternatives (§7); edit notes (§8); implementation obligations (§9).
**Not in scope:** Binding, parameter, and return annotations — Functions §4 owns them, unchanged; ascription reuses their semantics rather than restating them. Pattern annotations — the parameter element (Pattern Matching §6.5's pattern, Functions §4.1's annotation) is untouched. Type-level parentheses — grouping `(T)`, tuple types, and parameter-list domains stay exactly as Products §2 and Functions §5 have them; ascription is a **term** form only. Type-hole semantics — `decisions-ml-dialect-annotations-2026-08.md` owns them entirely; §3.2 here only records that ascription is one of its positions.
**Companions:** Functions §3.1 (grouping; no 1-tuples), §4.1 (the rigidity-with-accumulation contract this form extends), §4.2 (constraint attachment on names stays the binder's job), §8 (generalization and the evidence seat, which decide what an ascription's accumulated constraints become); `decisions-ml-dialect-annotations-2026-08.md` (holes, constrained holes, S11/S12 style); Products §2.1 (the tuple side of the parenthesized form; edit note §8); Pattern Matching §6.5 (the parameter element this form rhymes with); Operators §10 (postfix positions; a parenthesized expression remains a level-1 operand); Method Syntax §3 (head evidence for dot-call goals); Numeric Literals §3–§4 (what an ascription settles before defaulting is consulted).

---

## 1. The ruling

> Inside parentheses, every element is `expression (: Type)?`. One unascribed element is grouping, as always. One **ascribed** element is the **ascription expression**: `(42: Nat)` means `42`, checked against and pinned to `Nat`. Two or more elements form a tuple whose components may each carry an ascription: `(a: Int, b)` is precisely `((a: Int), b)` with the inner parentheses dropped. Ascription has no other position in v1 — there is no bare `e : Type` in open expression space.

The form introduces **zero new semantics**. An ascription does to an expression exactly what a `let` annotation does to a binding: unify, pin, no coercion, no runtime content. Everything below is bookkeeping for that sentence.

---

## 2. Grammar

### 2.1 The element rule

The parenthesized expression production (`()` / group / tuple) gains one clause: after parsing an element expression, a `:` introduces a type annotation for that element. The type grammar is the annotation grammar (Functions §4.1's positions) — full types, arrows included (`(f : Int -> Int)`), holes included (§3.2).

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

`(a: Int, b)` is also the prefix of a lambda header. The disambiguation doctrine is unchanged: the parser decides lambda-versus-expression on what follows the matching `)` — the arrow is the signal (the parser applies the same doctrine to Pattern Matching §6.5's paren-free parameter form), and it never commits on a `name :` inside the parentheses. Parameter lists already parse each element as `pattern (: Type)?`, so after this spec the one spelling has two established readings distinguished by the token that already distinguishes them: annotated parameters before an arrow, ascribed components without one.

One piece of the *implementation* does change, recorded here because the doctrine sentence above previously oversimplified it: the lookahead's return-annotation arm (`(params): T => body`) scans from a post-`)` colon to a `=>` bounded only by the layout boundary. Today every legal inner `(...):` sequence is itself a lambda head's own return annotation — `f((x, y): Int => e)` — so the loose scan cannot give a wrong answer on legal code; this spec makes non-lambda ones legal — `((a, b): (Int, String)) |> map(x => x)` puts a colon after an inner `)` with an *unrelated* arrow later in the line. The scan must tighten to accept the arrow only when it immediately follows one well-formed type (§9.1); with that, the doctrine sentence is true again.

### 2.4 Parens-only, deliberately, v1

Ascription lives only in the parenthesized element grammar. A bare `e : Type` in open expression position remains a parse error. Ruled with the expansion door open: if safe contexts for a freer form come up later, the restriction is re-examined; until then the form is visually delimited, and no colon in expression space is ambiguous between ascription and the binding-annotation colons. (OCaml has the same restriction.)

---

## 3. Typing: the annotation contract at expression granularity

An ascription checks and pins exactly as a `let` annotation does (Functions §4.1):

- The ascribed expression's type unifies with the written type. Failure is an ordinary type mismatch reported at the ascription (§5).
- A successful ascription **pins**: `let n = (42: Nat)` gives `n : Nat`; the literal's `Num` variable was settled by unification, so Numeric Literals §4's defaulting never has a variable to consult (§6.2).
- There is **no coercion**. `(x : Float)` with `x : Int` is a type mismatch, not a conversion — conversions are named functions, as everywhere.
- **An ascription of a syntactic value is itself a syntactic value.** Functions §8's read-through includes the ascription wrapper alongside grouping parentheses (edit note, §8): `let id = (x => x : a -> a)` generalizes exactly as `let id = (x => x)` does. An ascription wraps; it does not evaluate.

### 3.1 Type variables: rigid, accumulating — the annotation scope

A type variable written in an ascription is what it is in every other annotation: **rigid, a checked structure claim that accumulates inferred constraints** — Functions §4.1's contract, extended to this position by that section's own sentence. Rigidity pins type structure; it does not suppress demands discovered in the body.

> Type variables written anywhere in one declaration — parameter annotations, the return annotation, and ascriptions in its body — are the same variables. A name not written elsewhere in the declaration is introduced rigid, scoped to that declaration.

Consequences, in the order a reader meets them:

```
let f(x: a): a = (x : a)        -- the inner a IS the declaration's a; trivially fine
let id = (x => x : a -> a)      -- fine: the identity genuinely is that general
let inc = (x => x + 1 : a -> a) -- fine: Num is inferred for a; inc : Num a => a -> a
let n = (42 : a)                -- ERROR — defaulting reaches declared a; rigidity refuses
```

The third line is the accumulation contract at work, and it is deliberately not an error: `+` demands `Num`, the demand accumulates on rigid `a`, and `inc` elaborates constrained-polymorphic — usable at `Int` and `Float` alike. Nothing was silently concretized; the structure claim `a -> a` was checked and holds. This is precisely `let numeric(value: a) = value + 1` (Functions §4.1, legal) restated at expression granularity — one spelling, one meaning. A reader who wants a written floor without a generality claim has the constrained-hole spelling — `(x => x + 1 : (_ : Num) -> _)`, the annotation doctrine's floor form (§3.2); where the variable claim is true and meant, as here, the variable is the canonical spelling (S12, §3.2).

The fourth line is the closure doc's proof pair (`decisions-ml-dialect-annotations-2026-08.md` §6.2) met at expression granularity: `let n = (42 : a)` is `let n: a = 42` with the claim moved inside the parentheses, and it fails the same way — at a non-function value binding, Numeric Literals §4's defaulting reaches the declared variable, and rigidity refuses the narrowing: the attempted `a := Int` is Functions §10's *forced-to-a-concrete-type* row, reported at the binding. A rigid variable introduced by an ascription is a *declared* variable everywhere the corpus says *declared* — the ascription is how `a` was declared (edit note §8: Functions §8's annotated arms key on the variable's declaredness, not the binder's own annotation). Constraints defaulting cannot discharge answer instead to Functions §8's evidence-seat rule at a non-function value binding — the different member of the declared-variable family, exactly as the closure doc's §6.2 fences the two. A destructuring `let` closes the last door: its components never quantify constrained variables (Functions §8), and a rigid variable cannot be pinned, so an ascription-declared variable the destructuring sentence would otherwise pin is the same hard error — `let (g, n) = ((describe : a -> String), 1)` with `describe`'s non-defaultable `Tag` on rigid `a` (edit note, §8). Inside a function the same accumulation is unremarkable: in `let first(xs: Vector(a)): a = ...(head : a)...` the ascribed `a` is the declaration's, and demands ride the function's evidence suffix as always.

One corner is newly reachable and ruled here: a declared variable that **occurs nowhere in the declaration's type** — `let f() = ignore((42 : a))` — accumulates a constraint that would quantify with the function, yet no call site could ever determine its evidence. Ruled: an error at the declaration, in §4.1's declared-type-variable family — the checker must surface it, never quietly default a declared variable to escape it. Before ascription no annotation position could orphan a variable this way, which is why no earlier spec had to say so.

The scope rule above is stated for one declaration; the exact chaining across *nested* declarations (which enclosing scope a fresh name introduced inside an inner `let` joins, and how inner `<a: C>` binders shadow) is **deferred to the checker arc** — the implementation must surface the question rather than invent the answer silently.

This is a **deliberate divergence from OCaml**, whose annotation variables are uniformly unification holes (`(3 : 'a)` succeeds there, `'a` silently `int`). Hexagon's annotations are uniformly contracts with accumulation; ascription joins them (§7 item 1; the doctrine record is `decisions-ml-dialect-annotations-2026-08.md` §2–§3).

### 3.2 Holes in ascribed types

An ascription is an **inference-checked annotation position**, so type holes apply by the annotation doctrine's own rule (`decisions-ml-dialect-annotations-2026-08.md` §5.1, whose §5.5 records this position explicitly): every type position inside the ascribed type admits `_`, and a hole may carry a constraint list.

```
(parse(raw) : Vector(_))         -- claim the constructor, infer the element
(scores : Map(String, _))
(x => x + 1 : (_ : Num) -> _)    -- the written floor; see §3.1
((v.sum()) : _ : Num)            -- whole-type constrained hole: floor with no structure claim
```

Nothing here is this spec's to define: hole semantics (fresh metavariable, monotype fill, floor-never-cap constraint seeding, substitution sharing) are the closure doc's, unchanged. Two consequences are worth recording in place:

- **The fence never fires here.** An ascription is a body position — the total-contract fence (no holes in exported signatures or declaration surfaces) governs export and declaration surfaces, which an expression is not. An ascription inside an exported definition's *body* admits holes exactly as a private one does; the export's own signature (Modules §4.1.1) remains hole-free, as before.
- **The degenerate whole-type hole is inert, and canonical formatting normalizes it** — S11 extended by its own words: `(e : _)` means exactly what `(e)` means, and the formatter drops the degenerate annotation, leaving the group `(e)` (whether the group itself is redundant is ordinary parenthesis formatting, not this rule). A **constrained** whole-type hole is not inert and is kept — `(e : _ : Num)` carries a claim (closure doc §5.2, §4.4). S12 likewise extends verbatim: where a declaration-scoped variable states the truth, write the variable; the constrained hole is canonical exactly where a variable would over-claim.

### 3.3 Constraints attach to holes, not to names

`(e : a)` can name a variable; it cannot constrain one — there is no `(e : a : Ord)` form. This is the complementary split (closure doc §4.4): a **name's** one constraint home is the binder (Functions §4.2), where several occurrences share one statement; a **hole's** one constraint home is inline, because no binder can reach the nameless. An ascription that needs a constrained named variable names one the declaration's binder already declared; an ascription that needs an inline floor writes it on a hole (§3.2).

---

## 4. Emission

Ascription **erases**. `(e: T)` emits exactly as `(e)` would: the expression, parenthesized only where precedence already demanded it. No wrapper, no comment, no `.d.ts` trace — the declaration surfaces of FFI Part 7 are computed from types, which the ascription only influenced through ordinary unification.

---

## 5. Diagnostics

- **Mismatch:** the ordinary type-mismatch report, primary span on the ascribed expression, phrased against the written type — the same family a `let` annotation's failure uses. No new diagnostic kind.
- **Declared-variable errors:** rejections arising from a rigid variable report in §4.1's declared-type-variable family (the diagnostics say **declared type variable**, never *skolem*), at the position the corpus already assigns — the structure-mismatch case at the ascription; the defaulting-refusal case at the binding, Functions §10's *forced-to-a-concrete-type* row (§3.1 here); the declined-seat case for constraints defaulting cannot discharge at a non-function value binding (Functions §8); the orphaned-variable case at the declaration (§3.1).
- **The diagnostic this spec re-mechanizes:** Products §2.2's C#-named-tuple error (`(x: 1, y: 2)`) survives with its hint intact; the failure now arises one token later — the element colon is grammar, and `1` is a term where a type must stand (edit note, §8). The flip side is deliberate: `(x: Int, y: String)` now parses, as a tuple of ascribed components — the ascription reading, not named elements.
- **Hole diagnostics** are the closure doc's (§6 there), unchanged: fills surface by hover, not diagnostics; there is no warning tier.
- **The parse error this spec retires:** `(42: Nat)` formerly died with ``expected `)` after expression`` at the colon. That token is now grammar. No compatibility shim — the spelling had no prior meaning.
- The Rewrite Rule imposes nothing new: no diagnostic in this spec names a rewrite that does not compile.

---

## 6. Interactions

### 6.1 Dot-call head evidence

An ascription is **independent evidence** in Method Syntax §3.1's sense: `(42: Nat)` is head-known `Nat` at the dot, so `(42: Nat).dotCall()` resolves through `CompanionOf(Nat)` — once the Primitive-row implementation lands and §3.4/§4.1 gain their `Nat` row (#304's arc, not this spec's). This spec only guarantees the receiver spelling exists and pins.

### 6.2 Literal defaulting

Numeric Literals §4's rule is untouched, and its existing arms already cover every ascribed literal. Ascribed to a concrete type — `(42: Nat)` — unification settled the literal's variable at the ascription, so defaulting has nothing to consult. Ascribed to a hole — `let n = (42 : _)` — the hole is an ordinary inference variable and the literal defaults through it exactly as `let n: _ = 42` does (closure doc §4.1): `n : Int`. Ascribed to a declared variable, the closure doc's proof pair answers (§3.1 here): at a non-function value binding defaulting reaches the rigid variable and rigidity refuses the narrowing; where the binding's type is a function the variable generalizes with its accumulated constraints (Functions §4.1's `numeric`, §3.1's `inc`), and defaulting never narrowed anything. No new ordering rule anywhere — one defaulting rule, met by *written is claimed, unwritten is inferred*.

### 6.3 The parameter-list rhyme

`(a: Int, b)` as an expression and `(a: Int, b)` as a lambda's parameters are deliberately the same surface shape with per-element colons; §2.3's arrow rule is the entire difference. This is recorded as a feature, not a hazard: the reader's one habit — "a colon after a thing types that thing" — is true in both readings.

---

## 7. Rejected and reserved alternatives

1. **Unifiable ascription variables** (OCaml: `(3 : 'a)` succeeds, `'a` silently `int`). Rejected, on consistency: every other Hexagon annotation variable is rigid, and one spelling must not carry two meanings by position. The comparison is sharpened by accumulation: OCaml's `(fun x -> x + 1 : 'a -> 'a)` *looks* like a polymorphism claim while the compiler silently monomorphizes `'a` — the classic footgun. Hexagon's `(x => x + 1 : a -> a)` is a checked structure claim that elaborates genuinely polymorphic (`Num a => a -> a`, §3.1): the demand becomes a constraint, never a quiet concretization. The unifiable reading's lone power — linking two positions without claiming generality — is discovered by inference anyway, and the doctrine record (closure doc §2.3, §9.6) rejects a linking-only form permanently.
2. **General postfix ascription** (`e : T` anywhere). **Reserved, not rejected** — v1 is parens-only (§2.4); revisit on demonstrated safe contexts.
3. **Type holes in ascribed types** — *formerly reserved here while the `_` spelling was contested; the reservation is discharged.* The type-holes arc (#317) and constrained holes (#326) shipped, the rival term-position claim on `_` died with the default-parameters plan's own §7.1, and the closure doc's §5.5 records ascription as a hole position. Active in v1 — §3.2.
4. **A dedicated AST-visible coercion or conversion reading.** Rejected without discussion — nothing in the ML family reads ascription as conversion, and Hexagon's conversions are named functions.

---

## 8. Edit notes

- **Products §2.1**: the arity bullet gains a pointer — the parenthesized form's element grammar (and the ascription reading of the one-element case) is this spec's.
- **Products §2.2**: the C#-named-tuple ruling stands; a sentence notes the new mechanism — the failure is the type parse after a now-legal element colon, hint unchanged (§5 here).
- **Functions §4.1**: gains a sentence noting ascription (this spec) as a fourth annotation position sharing the same rigidity contract and the declaration-wide variable scope.
- **Functions §8 item 2**: the read-through clause ("parentheses only group…") gains the ascription wrapper — an ascription of a syntactic value is a syntactic value (§3 here).
- **Functions §8 item 2's evidence-seat arm and item 7, and §10's two annotated-binding rows**: the arms that key on an *annotated* binding's declared variable extend to variables an RHS ascription declared — declaredness, not the binder's own annotation, is the key — and item 2's destructuring sentence gains the same extension, since an ascription can now declare a rigid variable under a destructuring `let` (§3.1 here).
- **`decisions-ml-dialect-annotations-2026-08.md`**: §5.1's inference-checked-position list gains the ascription position; §5.2's proof-pair-spelling parenthetical acknowledges the ascription spelling now exists; §5.5's prospective sentence ("when the paused arc resumes…") rewrites to the standing fact; the header's not-in-scope pause language updates. Semantics unchanged — §5.5 pre-committed the rule this spec now cites.
- **`notes/canonical-formatting-and-naming.md`**: S11 gains the ascription's degenerate spelling (`(e : _)` normalizes to `(e)`); S12 notes its rule reaches ascribed types (§3.2 here).

Method Syntax and Numeric Literals are consulted by §6 but need no text: their rules already quantify over "head-known" and "still unresolved" without caring how the state arose.

---

## 9. Implementation obligations

1. **Parser:** the element rule in the parenthesized production — after the element expression, an optional `: Type` via the existing annotation-type parser (holes and constrained holes come free with it), checked before the closing-paren expectation (the `Colon` token already halts the expression loop, so the load-bearing change is the new arm, not the stop set); a new `Ascription { expression, annotation }` expression node. The lambda lookahead's return-annotation arm **must tighten** per §2.3: accept the arrow only when it immediately follows one well-formed balanced type after the colon, so an inner `(...):` with an unrelated later `=>` on the line does not misparse as a lambda head. Tests: `(a: Int, b)` as tuple and `(a: Int, b) => e` as lambda; `((a, b): (Int, String)) |> map(x => x)` and `f(((a, b): (Int, String)), z => z)` parse as ascriptions, not lambda heads; `(params): T => body` still parses as an annotated lambda; `(x: 1, y: 2)` still errors with Products §2.2's record hint, and `(x: Int, y: String)` parses as a tuple of ascribed components.
2. **Resolver:** walk the node; type names in the ascribed type resolve through the ordinary annotation path (occurrence identity included, for the LSP); holes receive resolver-assigned hole ids through the same path, so alias substitution shares seed and id exactly as in binding annotations.
3. **Checker:** reuse the annotation path — elaborate the written type in the enclosing declaration's annotation-variable scope (introducing unseen names rigid, per §3.1), unify with the expression's type; accumulation then proceeds as for any rigid variable, and what the accumulated constraints become is Functions §8's existing business at the declaration. Four error paths must exist and be tested: the defaulting-refusal case (`let n = (42 : a)`, the closure doc §6.2 proof pair's second half at expression granularity — hard error at the binding, Functions §10's forced-to-a-concrete-type row); the declined-seat case for a non-defaultable accumulated constraint at a non-function value binding (`let holder = { f = (describe : a -> String) }` with `describe`'s `Tag` on rigid `a` — Functions §8's arm must recognize ascription-declared variables as declared); the destructuring case (`let (g, n) = ((describe : a -> String), 1)` — the component cannot pin a rigid variable, same hard error, §3.1); and the orphaned-variable case (`let f() = ignore((42 : a))`, error at the declaration; must not default). Hole seeding uses the existing floor mechanism unchanged. No new unification machinery.
4. **Emitter:** erase (§4).
5. **LSP:** hover on `(e: T)` shows `T`'s expansion as any annotation does — hole fills included, per the closure doc's hover-not-diagnostics rule; go-to-definition and find-references reach type names inside ascriptions; semantic tokens classify them as type names.
6. **Formatter:** the degenerate `(e : _)` normalizes to `(e)` (§3.2, S11 extended); a constrained whole-type hole is kept.
7. **TextMate grammar:** the `:`-introduced type context inside parentheses must colour as type syntax in both readings. Do **not** assume the existing parameter-annotation rule covers it — the constrained-holes arc falsified exactly this "expected already covered" claim once, and that rule likely keys on an identifier before the colon, which `(42 : Nat)` and `((a, b) : T)` do not satisfy. Verify against the Playground and VS Code with the §2.3 pair and a literal receiver; add a rule if needed.
8. **Tests:** the §3.1 four-example block verbatim, including the scheme assertion `inc : Num a => a -> a` and calls at two numeric types; the §2.2 eats-right pair; the §2.3 tuple/lambda pair; `(42: Nat)` end-to-end (type, emission erasure, `.d.ts` absence); a tuple with mixed ascribed/plain components; a hole ascription `(e : Vector(_))` (compile + hover fill), a constrained-hole ascription exercising the floor, and the hole-ascribed literal `let n = (42 : _)` defaulting to `Int`; the four §9.3 error paths; the retired parse error's replacement behavior; mutation coverage on the rigid-scope join (a test that fails if ascription variables are fresh-per-ascription instead of declaration-scoped).
