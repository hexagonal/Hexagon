# Hexagon Spec: Effects

**Status:** Decided (#355; arrows respelled and the else-constant rule withdrawn, #405; the inlet rule widened to the application spine and local type positions ruled, #408; an unconstrained own colour defaults pure before generalization whatever the signature's inlets, knot mark obligations settle at the knot's close, and `?` has one meaning, #868; constraint member headers are effect contracts, compared rather than unified at the seat that honors them, #867 — §13; every callable boundary row writes its arrow, #869). The two-point effect discipline ships in v1, unconditionally — colours are part of the language, not an option. Nothing here has a warning tier.
**Scope:** What an effect is; the three arrows (`->`, `->?`, `->!`) and their readings; where `->?` is legal; the call-mark trichotomy (bare, `!`, `?`); effect variables in inference; symmetric enforcement at calls and faces; the extern ownership split and the trusted arrows on boundary rows; the `Seq`/`Stream` posture; effect contracts at the constraint seat (§13).
**Not in scope:** Exceptions — deliberately outside the effect (§1); `Stream`'s module surface (`stream.md`); token shapes (Lexer §8); the pipe rewrite (Operators §8); the dot-call form (Method Syntax §2); display grammar for arrows (Functions §5.1).
**Companions:** Functions (§4.1 annotations, §5.1 displayed types, §7.4 the monomorphic knot, §8 generalization), Statements, Blocks & Mutability (§6.2 — the coupling §7's last bullet names), Constraints (§2 — member headers are contracts; §4.1 the seat; §7 the prelude's members write `->`), Intrinsics (§4.2 verification), FFI Part 4 (extern bindings; §4.5 the arrow every callable row writes), FFI Part 3 (the `Seq` launder; the `Stream` crossing), Loops (§6 `Seq`, §7 `Iterable`), `stream.md`.

---

## 1. Doctrine

- **The tracked effect is observable interaction with the world.** Reading input, writing output, consulting a clock or an entropy source, mutating foreign state. Nothing else is an effect: allocation is not, `var` inside a function body is not (it cannot escape — Statements §6.2), and **throwing is not**. Exceptions are the partiality/defect channel (Exceptions spec), the Rust cut: `Int.div` throwing `DivideByZeroError` does not make division effectful, and `Result` is untouched. Without this cut the doctrine of throwing companions would make the whole prelude impure.
- **The lattice has two points: pure and impure.** There are no effect rows, no effect families, no user-declared effect kinds. A design that wants "which effect" is a different language; Hexagon asks only "does the world notice".
- **Purity is the silent one.** A bare call, an unmarked body, a `->` arrow — silence is the strongest claim. Effects are what get spelled, and **one alphabet spells them in both places**: the marks `!` and `?` ride the call they describe and the arrow they colour alike. A reader who sees nothing may assume the world is untouched.
- **The system is Hindley–Milner all the way down.** The effect is one more unifiable component of every function type, ranging over the two-point lattice; effect variables are ordinary type variables (§3.4). This is the effects system reached by *refusing to leave* HM — the same commitment that fixed the rest of the type system. There is no subeffecting, no row polymorphism, no effect subsumption: colours unify or they do not. One seat compares them instead *(#867)*: an instance meeting a constraint member's contract, where every arrow the header writes is a bound — a pure body may stand under an effectful header, and an instance may accept more than the header promises (§13). That is the whole exception — at calls, at demands, at data fields, and on every implementation's own written face, colours still unify or they do not.
- **Asynchrony is out of scope, permanently for this ruling.** `async` is a separate axis, not a point on this lattice; v1 is synchronous, and the async question files its own issue when it arises. Nothing here pre-decides it.

## 2. The three arrows

Function types carry a colour on every arrow. The display grammar (zero/one/many domains, right association) is Functions §5.1's, unchanged; this section fixes what each arrow means.

```text
->     pure: this function touches nothing the world can observe
->?    linked: this signature's one effect variable — the caller's instantiation decides
->!    the impure constant: this function performs effects, unconditionally
```

**There is one arrow, and the colour is a mark on it.** The three spellings differ only in the mark they carry, and the marks are the call trichotomy's own (§3.1) — `f(x)` / `f?(x)` / `f!(x)` against `->` / `->?` / `->!`, the same three symbols answering the same three-valued question. §3.3 makes the correspondence exact: a call's mark reports the colour of the outermost arrow of the callee's type at that instantiation, so `save!(document)` asserts precisely that `save`'s outer arrow is `->!` here. A reader learns the alphabet once.

The consequence for the *type* grammar is that the fat arrow `=>` is not one of its tokens. `=>` is a term-level arrow only — the lambda's and the `match`/`catch` arm's (Lexer §8.1) — and Functions §4.1's return-annotation slot needs no parenthesization rule as a result (§2.6).

It also settles a collision inside the display itself. Under the predecessor spelling a constrained higher-order face used one symbol for two unrelated jobs in a single line — the arrows, and a constraint separator borrowed from Haskell:

```text
Show a => (Seq(a), (a) => Unit) => Unit       -- predecessor: three `=>`, two meanings
<a: Show> (Seq(a), (a) ->? Unit) ->? Unit     -- now: no `=>` at all
```

The arrows gave up `=>` because they never needed it, and the separator went with them *(#410)*: a displayed scheme now spells its constraints source-shaped, with §4.2's binder bracket as a quantifier prefix (Functions §5.1). So `=>` appears nowhere in a displayed type, and the token has exactly one reading language-wide — the term-level one.

### 2.1 `->` — the pure arrow

A `->` function performs no observable effect at any instantiation. As a demand — a `->` arrow in a parameter annotation — it refuses impure arguments by ordinary unification (§4.3): `memoize`-shaped functions get their purity guarantee from the type, with no new mechanism.

### 2.2 `->?` — the linked arrow

Every `->?` written in one signature denotes **the same, single, implicitly quantified effect variable** — the signature's colour. One variable per signature, never two (§2.4). The linked reading is what makes higher-order functions effect-polymorphic for free:

```text
fold : (Seq(a), b, (b, a) ->? b) ->? b
```

`fold`'s callback arrow and every other `->?` in its signature — here, its own outer arrow — share one colour. The outer arrow is linked because `fold`'s body is a conduit: its `?` call on the callback (§3.1) joins the body's own colour to the signature's variable, so running `fold` is exactly as effectful as the callback makes it. Instantiated with a pure `combine`, the whole call is pure and bare; instantiated impure, the call is impure and wears `!` (§3.3, §4.1). The signature never says "impure"; it says "as impure as you make it".

The mark is the call mark, and it reads as the call mark reads: *this arrow defers to my caller.* One `?` inside a body and one `?` on an arrow name the same variable — in `fold`, both signature arrows and the body's `combine?(accumulator, value)` are three occurrences of one colour.

#### 2.2.1 Where `->?` is legal — the inlet rule

`->?` is legal **only within a function signature, and only when that signature has at least one inlet.** Anywhere else it is an error (§4.4); it is never given a second reading.

An **inlet** is an occurrence of the signature's colour inside a **parameter type of any arrow on the signature's application spine** — the chain of arrows reached from the signature's root by descending through results — **at any nesting depth and at any polarity within that parameter type**. Depth and polarity are irrelevant because the caller supplies the whole argument value and therefore pins every colour inside it, at whichever application step it supplies it: `(step: () ->? String) -> Int`, `(pair: (Int ->? Int, Int)) -> Int`, and `(f: (Int ->? Int) -> Int) -> Int` all have an inlet; so does a `->?` inside a record *type* standing in a parameter annotation — `(handler: { step: () ->? String }) -> Int`; and so does `() -> ((Int ->? Int) ->? Int)`, whose inlet the caller reaches at the **second** application — a curried signature is applied step by step, and each step's arguments are supplied by a caller. The occurrence walk is §3.4's, which already counts the effect slot as a component at the arrow's own sign; the inlet test reads that walk and asks only whether some spine arrow's parameter type contains the variable — sign and depth discarded, because a supplied argument pins what it contains however deeply and in whatever position.

A signature with no inlet has a variable no caller can pin: **the caller pins exactly what it supplies, and an occurrence it only receives pins nothing.** Two face shapes take the error on that ground, and two positions take it for having no signature at all:

- an **outer-only face** — `(seed: String) ->? Int`: the variable is only a spine arrow's own colour, and no supplied argument contains it. A spine arrow's colour is not an inlet; only occurrences inside a parameter type are. Nothing instantiates it, so the callee would have to satisfy every colour at once — not a claim a body can meet;
- a **received-only face** — `(): Int -> (Int ->? Int)`: the variable stands only in what every application hands *back*. Inference never produces this face generalized — a real body pins the returned function's colour, or links it through an inlet — so the refusal costs no writable program;
- a **data-declaration field** (§2.5) — a `record` or `union` has no signature at all, so there is no variable to link to;
- a **`type` alias body** (Declarations Preamble §4) — likewise a fragment with no enclosing quantifier.

A `->?` in *parameter* position is always linked, even when it is the signature's only one: `store(callback: () ->? String): Int` is polymorphic in `callback`'s colour and accepts pure and impure arguments alike — the variable, if nothing ever observes it, simply generalizes unconstrained (§3.4). It is never rounded up to the constant, which is §2.4's own rationale applied. `store`'s own arrow, which nothing in its body constrains either, is pure: `store : (() ->? String) -> Int` *(#868 — §3.4's defaulting)*. The parameter's variable is preserved because a caller supplies it; the outer colour is defaulted because nobody does.

The rule's shape is deliberately the call side's. A `?` at a call with nothing to conduct is an error (§4.1) rather than a call quietly re-read as `!`; a `->?` on an arrow with nothing to link is an error for the same reason and with the same sentence behind it. **One spelling, one meaning, everywhere it is legal** — and where the meaning is unavailable, a diagnostic rather than a substitute.

#### 2.2.2 Local type positions

Inside a body, a `->?` written in a **local type position** — a binding annotation or an ascription — denotes **the enclosing signature's variable**. A body has exactly one non-constant colour in scope (§3.1), and a local spelling of `->?` names it: `let h: () ->? String = g` and `let h = (g : () ->? String)` are the same claim, and both link. The legality condition is the enclosing signature's own (§2.2.1) — a local `->?` is legal exactly where the enclosing signature admits one, and it never *supplies* the inlet it needs: inlets are the signature's, not the body's.

Two boundaries keep this exact:

- **A local function type that carries its own inlet is its own signature.** `let f: (Tx ->? a) ->! a = …` quantifies its own colour, exactly as before; only an inlet-less local `->?` reaches out to the enclosing signature. The variable a fragment names is the nearest enclosing signature that can own one.
- **Where there is no signature at all**, §4.4's own clause says so: the annotation is not part of any function signature. The clause is about shape and doctrine, not merely position. A binding annotation that is itself a **function type** is a signature *wherever it stands* — a module-level `let f: (Tx ->? a) ->! a = …` quantifies its own colour exactly as a local one does, and an inlet-less module-level function-type annotation takes §2.2.1's *signature* clause, not this one. What takes the no-signature clause is a `->?` inside a **non-function-type** annotation with no enclosing signature (a module-level `let` or `var` whose annotation is not a function type — shape decides for a `var` exactly as for a `let`), and any **`extern let`** annotation — an extern `let` declares a foreign *value*, not a callable row (FFI Part 4 §4.5's posture; the callable form with a signature of its own is `extern fun`).

The ascription's rigid purity demand (§2.6, the Ascription spec) is unchanged: `(f : a -> b)` still demands the pure constant. What this section fixes is the linked spelling's meaning in that seat, which previously diverged between the ascribed and annotated forms of one intent.

### 2.3 `->!` — the impure constant

`->!` is one token (Lexer §8.1); the bang trails the arrow it condemns, matching the call mark's postfix position. `!->` is not a token and cannot become one — the mark trails, on arrows as at calls (Lexer §8.2).

`->!` names the impure constant, and it is the **only** spelling of it. Every position whose colour is constantly impure writes it: a function that performs its own unconditional effects (§2.4's join), a data field that pulls the world (§2.5), an inlet-less face (§2.2.1's refusals), a boundary row that writes it (§6.1). There is no position where the constant may be left implicit and no second spelling that coincides with it — the abolition of the else-constant rule (§2.2.1) is exactly the removal of that coincidence.

One kind of position reads the spelling as a bound rather than a claim *(#867)*: an arrow a constraint member's header writes is a **contract** — a ceiling where the caller invokes it, a floor where the caller supplies it — and `->!` on the member's outer arrow licenses an instance to perform effects without asserting that any instance does (§13.1). The constant is unchanged — it is still the top of the lattice, still the mark every call through the member wears — and what differs is only that the seat honoring the contract compares against it rather than unifying with it (§13.2).

### 2.4 The conservative join — one variable, ever

A body that both performs its own unconditional effects and forwards a callback's colour does **not** get a second effect variable. Its own colour is the conservative join: constant-impure — counting impure is fine, and the join is what `->!` spells.

**The join governs the function's *own* colour only.** The callback arrows it forwards **keep their linked variable**:

```text
withTransaction : (String ->? String) ->! String
```

The outer arrow is `->!` — `withTransaction` writes to the world on its own account, so every call to it wears `!` (§3.3). The callback's arrow stays `->?` — a *pure* callback is accepted, and stays pure in the caller's accounting. Rounding the callback's arrow up to `->!` would refuse pure callbacks outright: purity-as-polymorphism works through variables, and `->!` is not one.

The callback's `->?` is also this signature's inlet (§2.2.1), which is what keeps the face legal: a signature may carry a linked arrow while its own outer arrow is a constant, and `withTransaction` is the everyday shape that does.

### 2.5 Data-field arrows: the constants only

A function-typed field of a `record` or `union` declaration carries `->` (a pure field) or `->!` (an impure one). **A data declaration has no signature, so its arrows have no variable to link to** — and `->?` there is therefore the §2.2.1 error, with the fixit `->!`.

The position still matters, but it now selects between *legal* and *rejected* rather than between two meanings. `{ step: () ->? String }` **in a parameter annotation** is part of that function's signature, so its arrow links and supplies an inlet — the enclosing function is polymorphic in the field's colour. The identical text **in a `record` declaration** is data, and is refused. A record type is a set of values with no enclosing quantifier; a signature is a quantified contract. Both outcomes are pinned in the conformance suite.

That is the whole of the old divergence: no written shape reads two ways any more, and the reader who learns "`->?` means my caller chooses" never meets a position that quietly means something else.

This is the sentence `Stream` stands on: `Stream(a)`'s field `next: () ->! Option(a)` is pull-impure by declaration (`stream.md`), and `Seq(a)`'s field `pull: () -> Option((a, Seq(a)))` is pure by declaration — the two-type split of §7.

### 2.6 Values wear no colours

- **Lambdas are always written with the term arrow `=>`**, pure ones included. The term-level `=>` is the lambda syntax (Functions §3.1) and says nothing about colour; a lambda's colour is **inferred from its body's marks**. There is no pure-asserting term arrow.
- **References are colourless.** A name, a field access, a stored function — none carries a mark (§3.2's corollary: no argument list, no mark). Storing an impure function is not an effect; calling it is.
- A **term-level purity demand** is the existing ascription: `(f : a -> b)` — rigid, per the Ascription spec. A **signature demand** (`->` in a parameter annotation) refuses impure arguments by unification. No new demand form exists. A term-level `->?` in an ascription is §2.2.2's local position: it names the enclosing signature's variable, under that signature's own legality.
- **The two levels no longer share a token, and a lambda return annotation therefore needs no parenthesization rule.** `=>` is a term arrow and the `->` family is a type arrow; the annotation grammar can be right-associative and greedy without hazard, because the token that ends it cannot be one of its own:

  ```text
  (x): A ->! B => body      -- annotation `A ->! B`, body `body`
  (x): a => y => x          -- annotation `a`, body `y => x` — the curried lambda, unchanged
  ```

  Both parse unambiguously and mean what they read as. The predecessor of this bullet gave an unparenthesized `=>` in that slot to the body and required `(x): (A => B) => body`; that rule, its diagnostic, and the diagnostic-suppression machinery it needed are all withdrawn — the ambiguity they managed was token overloading and no longer exists. Functions §4.1 owns the annotation grammar.

## 3. The call trichotomy

### 3.1 Three marks, one question

Every call wears exactly one of three states:

```text
f(x)      bare — this call is pure
f!(x)     dirty — this call performs effects
f?(x)     conducting — this call is as effectful as the enclosing instantiation makes it
```

The teaching model: **every call is a pipe.** A pipe is clean, dirty, or conducting. The developer's question at each call: *is this a source, or just a conduit?* A function that reads the world is a source — its calls wear `!`. A function that merely runs what it was handed conducts — its call on the handed-in value wears `?`, and the conduit is only live when the far end is: `combine?(accumulator, value)` inside `fold` runs effects exactly when the caller instantiated `combine` impure. References are colourless as a corollary, not a fence: no pipe, no mark.

**The marks are the arrows' marks** (§2). A call's mark and the callee's arrow mark are the same symbol reporting the same colour, and §3.3 is what makes that identity exact rather than mnemonic. The three questions a reader ever asks — of an arrow, of a call — have one alphabet of answers.

The trichotomy is exhaustive *because* of one-variable-per-signature (§2.2): inside a body, the only possible non-constant colour is the enclosing signature's variable, so pure / impure / the-variable covers every call. The one apparent exception — a body storing a lambda into a function-typed field — is resolved by §2.5: a data field's arrow is a constant (and `->?` there is refused outright), so no second variable ever enters scope.

A `?` call is legal on the same condition its arrow is: only inside a body whose signature has an inlet (§2.2.1). A body with no inlet has no variable for a `?` to name, and §4.1's table is what refuses it there.

`?` is the deliberate pun on Rust's trained gesture: this line defers to my caller.

### 3.2 The mark's anchor is the argument list

A mark governs **an argument list**, whatever the callee expression:

```text
save!(document)          -- ordinary call
(source.step)!()         -- parenthesized field access, then a marked call
document.show()          -- a dot call marks its own argument list (bare here: show is pure)
stream.next!()           -- dot call, marked
maker("s")!(document)    -- each argument list marks its own call
```

- The mark is written glued on both sides — against the callee expression it follows and against the `(` it governs (Lexer §8.1). A floating mark reads as an operator, and no such operator exists: `readLine ! ()`, `readLine! ()`, and `readLine !()` all take §9's mark-position error. Dot calls (Method Syntax §2.1) and the `(e.name)(…)` opt-out each anchor the mark to their own list; a chain marks each link for what that link's call is.
- A **pipe stage** is a call, so it takes a mark: `x |> save!` — the bare-stage form's mark stands glued at the end of the stage, and the rewrite carries it onto the call it builds: `save!(x)`. Operators §8 owns the rewrite; a stage with its own argument list marks that list as usual (`x |> take!(3)` → `take!(x, 3)`).
- A mark anywhere else — on a reference, mid-expression — is a parse error (§9): a reference carries no colour.
- A dot call whose goal defers to its owner region's deadline (Method Syntax §3.1) anchors its mark to the same argument list, read off whatever colour the deadline produces. A goal that falls to the imposed row (Method Syntax §3.5) is a pure call: the imposed row's arrow is written `->` there, and a row is data (§2.5) — so a mark on such a call is refused like any other mark on a pure call, and the impure reading needs an annotation on the receiver.

### 3.3 The outermost arrow: a mark describes this call only

**A mark speaks about the colour of the outermost arrow of the callee's type, at this instantiation — nothing more.** A call whose *evaluation* touches nothing is bare, whatever it returns:

```text
let wired = compose(save2, audit2)    -- bare: evaluating compose builds a closure
wired!(document)                      -- the composite's own invocation is the effect
compose(save2, audit2)!(document)     -- both in one expression: outer call bare, inner list marked
```

Evaluating `compose` allocates a closure and touches nothing — its body is neither a source nor a conduit, so its own colour is unconstrained and therefore pure (§3.4's third arm) — the call is bare even when the composite it returns is impure. The effect surfaces where the composite is *invoked*, and the mark surfaces with it. Read it as order of operations for marks: each argument list is marked for the arrow it discharges.

The example holds in every body, inlet-bearing ones included *(#868)*: constructing a closure is not invoking it, and a colour nothing in `compose`'s body constrains is pure (§3.4's third arm). The same holds of every closure builder — `defer(action)`, `Stream.map(randoms, double)` (`stream.md` §4.2) — and of the function that returns one:

```text
let defer(action: () ->? Unit) = () => action?()
defer : (() ->? Unit) -> (() ->? Unit)      -- the outer arrow pure; the callback's colour preserved through to the closure's
```

`?` names a preserved dependency and nothing else; the rule that once read an undetermined call inside an inlet-bearing body as a conduit is withdrawn (§11).

### 3.4 Effect variables are type variables

The effect component rides the ordinary machinery — unification, levels, generalization (Functions §8) — with no parallel solver:

- **Monomorphic in the knot.** Within a `fun` block's strongly-connected component, a signature's effect variable is a not-yet-generalized monotype like every other variable (Functions §7.4); recursive calls share it. It generalizes per member, when that member's binding generalizes.
- **Settled at body close.** A declaration's own colour and its calls' mark obligations are resolved when its body closes, not at module end — a `fun` knot's members excepted, whose own colours and sibling-call obligations alike wait for the knot's close (the knot bullet below, #868). This is required, not latitude: under end-of-module settling, a module-internal call to a not-yet-generalized neighbour would see a still-linked variable, and the pure corpus would read as conduits — every bare call in `Seq.hex` would demand `?`.
- **A body's own colour is solved by three arms, in order.** A body that absorbs an impure-constant call is a **source**: its own colour is the impure constant (and if its written face is `->`, that is §4.2's pure-face error, at the offending call). A body whose `?` call absorbs the signature's variable is a **conduit**: its own colour *unifies with* that variable — this is how one-variable-per-signature emerges rather than being imposed, and why `fold`'s outer arrow is linked (§2.2). A body that is neither has an **unconstrained** colour, and it **defaults to pure before generalization, whatever the signature's inlets** *(#868)* — after the body's dependencies are resolved (its callees settled, its `?` calls joined) and before the binding's scheme is built: at body close for a lone binding, at the knot's close for a `fun` block member, and for a lambda that is no binding's right-hand side, where the binding whose body holds it closes. Nothing observed the colour, so pure is what it is: constructing a closure that will run a callback is not running it. `store : (() ->? String) -> Int`; `defer : (() ->? Unit) -> (() ->? Unit)`, the returned closure's arrow linked to the callback's through the body's `?` call and the outer arrow pure.
- **What the defaulting never touches is a dependency**, and four things are dependencies: a signature parameter's variable (next bullet); a body's own colour once a `?` call has joined it; a body's own colour once a **written `->?`** has joined it — a `->?` on the outer arrow of a binding annotation that is itself a function type — its own signature where it carries an inlet, the enclosing signature's fragment where a local one does not (§2.2.2) — links the colour to that signature's variable exactly as a `?` call does, so `let f: (() ->? Unit) ->? Int = (action) => 1` keeps the face it writes rather than defaulting under it (a written `->` or `->!` joins nothing: it is checked against the solved colour, §4.2); and a knot member's own colour once a sibling call has joined it (the knot bullet). The linked faces are what the language exists to keep; the defaulting reaches only what nothing has claimed.
- **The defaulting clause, at calls.** A call's colour still undetermined when marks are checked defaults to **pure** (bare), in every body *(#868)* — except on a **knot sibling's colour, which the clause never pins**: that colour is a live monotype another member's body will solve, and both its value and the call's mark obligation wait for the knot's close (next bullet). Everywhere else a callee's undetermined colour is a fresh instantiation of a generalized unconstrained variable, which nothing binds, and pinning it pure weakens no face because no face depended on it — the enclosing body's own colour is defaulted by the arm above on the same ground. A **signature parameter's** effect variable is never defaulted by either clause: it generalizes with the binding like any type variable, which is exactly what keeps `store(callback: () ->? String)` polymorphic (§2.2).
- **Knot colours and obligations settle at the knot's close** *(#868)*. Within a `fun` block's strongly-connected component a sibling's colour is a not-yet-generalized monotype (the first bullet), so a call to a sibling may meet a colour that is undetermined now and solved by a body not yet checked. The colour is left as it is, and the call's mark obligation is **recorded and settled when the knot closes**, never at the caller's body close, and never by conducting or by pinning because the colour was unsolved at the time. The knot's close runs the arms **over the whole component, stratified, to a fixpoint** before anything defaults — the source arm first, to its own fixpoint: a member whose sibling call absorbs a source is a source in turn, and so on until no member changes, each such member taking §2.4's join — its own colour the impure constant, its inlets untouched, since the join governs a member's own colour only and an inlet already pinned stays pinned; then the conduit arm over what remains: a member whose sibling call absorbs a colour the knot has joined to a signature variable is a conduit of it; then the colours still unconstrained default pure; and only then are the recorded obligations read. Source before conduit is what makes the answer independent of the members' order — a member that is both reached by a source and reaching a conduit is a source, never a conduit whose inlet the source would constantify. The close needs no re-inference: it is a closure over the sibling-call edges the bodies already recorded. `a(cb: () ->? Unit) = b(cb)` beside `b(cb: () ->? Unit): Int = if True then 1 else a(cb)` — one component, each member calling the other — is two bare calls and two pure faces, `(() ->? Unit) -> Int` each; `even`/`odd` passing a callback down and calling it at the base are conduits, `?` on the sibling calls as on the callback, because the knot's colour joined the signature's — and so is a member that never calls the callback itself but calls the sibling that does; a sibling that turns out to be a source makes every member that calls it a source in turn — every sibling call to it `!`, the caller's own face `->!` — however early that member's body closed. A sibling whose colour a caller's body pinned pure by ordinary unification (a `->` demand the sibling was handed to as a value) and that the source arm then claims is §4.3's refusal, reported at that demand: the demand is what the report names as violated, the arm's constant is the face the sibling keeps (`->!`, as hover shows it), and the knot's close is where the two are compared. Generalization is still per member at its SCC (Functions §7.3, §7.4, §8); only the *timing* of the sibling colours and obligations moves, and only to where the knot's colours exist to read.
- **Expected types carry the slot too** (#513). Functions §4.3's expected-type propagation moves a seat's unifications ahead of body inference, and an expectation's arrows arrive with their colours as ordinary components — nothing colour-specific is added or bypassed: a lambda's own colour is still inferred from its body (§2.6), face checks (§4.2) and mark computation (§4.1) read what they always read, and propagation reports nothing of its own. One seat is excepted *(#867)*: at a constraint member's honor seat the expectation's colours are replaced by fresh variables before propagation, because §13.2 compares them afterwards instead of unifying them.
- **Every occurrence walk counts the effect slot.** Analyses that walk a function type's components — declaration-site variance foremost — treat the effect slot as one more component, **at the arrow's own sign**: a colour is a fact about invoking the function, which is what the result position already means, so a parameter arrow's colour is contravariant with the parameter arrow. Skipping the slot makes every effect variable read as absent, and an absent variable's default (invariant) pins faces monomorphic that the arms above worked to keep polymorphic. §2.2.1's inlet test is a second client of this walk, and reads it at its coarsest: *does some application-spine arrow's parameter type contain the variable* — sign and depth discarded, because a supplied argument pins what it contains however deeply and in whatever position.

## 4. Enforcement is symmetric, and error-grade

### 4.1 At calls: six directions, one-token fixits

The required mark at a call is computed from the callee's outermost arrow colour at this instantiation: impure constant → `!`; the enclosing signature's variable → `?`; pure → bare. A colour still undetermined when the mark is checked is pure — inside an inlet-bearing body as anywhere (§3.4's defaulting clause, #868) — and a knot sibling's is checked at the knot's close, when it is no longer undetermined. **Any other mark is an error — including a mark on a provably pure call.** A tolerated-but-wrong mark would rot into noise; symmetric enforcement is what keeps silence meaningful. All six wrong-mark directions report the same shape, each with a one-token fixit:

> this call runs effects, so `save` wants `!`, not no mark
> this call is as effectful as the enclosing instantiation makes it, so `combine` wants `?`, not `!`
> this call is pure, so `next` wants no mark, not `?`

(the remaining three directions permute the same sentence; §9 tabulates.)

### 4.2 At faces: both directions

This section governs an implementation's **own written face** — a return annotation, a parameter's arrow, an ascription (Functions §4.1; the Ascription spec). A constraint member header is a **contract**, not the face of the instance body that honors it — an `honor` member's, a default's, or a `widens` door's: none of the four bullets below fires against the contract, a pure body under a `->!` or `->?` member being neither the third nor the fourth bullet's error, and §13.2 owns that seat *(#867)*. A face such a body writes for itself — a member's optional annotation, a door's own signature, an ascription inside it — is checked here as any face is.

A written arrow that contradicts the body's solved colour is an error **in both directions**:

- `->` over a body that performs effects: reported at the offending call — *"this call performs effects, and the enclosing function's face is the pure arrow `->` — a pure face cannot run effects"* — the span that names which call broke the promise.
- `->?` over a body solved to the impure constant: *"this signature's `->?` promises a colour the caller chooses, but the body solves it to the impure constant — a function that performs its own unconditional effects rounds up, and its face is `->!`"* — fixit `->!` (§2.4's join, surfaced).
- `->?` over a body that pins the variable pure — through a `->` demand it hands the callback to, say — *"…but the body solves it to the pure constant — the honest face is `->`"* — fixit `->`. This is the **lie of generality**, mechanized: a pure function wearing `->?` would force `!`-or-`?` ceremony onto every caller for effects that cannot occur. A body that merely leaves the variable unconstrained does not fire it: the written `->?` joins the colour (§3.4), and the face is what it writes.
- `->!` over a body that performs no unconditional effect: when the body conducts, *"this face is the impure constant `->!`, but the body performs no unconditional effect — it is effect-polymorphic, and its face is `->?`"* — fixit `->?`; when the body's colour is pure, *"…but the body performs no effect — its face is `->`"* — fixit `->` *(#868: a pure body is pure, not polymorphic; the advice names the face the body has)*.

The pure direction matters as much as the impure one: over-claiming and under-claiming both break the reader's contract, and neither is a style matter.

The linked-face reports stand **at the signature's written `->?`**, not presumptively at the outer arrow: the constantified variable may be spelled only on a nested arrow — `(h: ((Int) ->? Int) -> Int)` over a body that pins `h`'s callback impure — while the outer arrow is honestly `->` or `->!`. The advice never tells the writer to change an arrow that is not there.

**The impure direction's fixit repairs the arrow that lied, and the join decides which that is** (§2.4). When the *outer* arrow is among the written `->?` occurrences, the honest repair is the join itself: the outer arrow alone becomes `->!`, and the signature's inlets keep their `->?` — they re-link as the constant-outer signature's variable, which is exactly `withTransaction`'s face, and rewriting them too would refuse the pure callbacks §2.4 exists to keep. Only when the outer arrow is *not* a written `->?` are the nested occurrences the condemned colour's whole spelling, and the fixit then rewrites each of them. The pure direction has no join to preserve: every written `->?` becomes `->`.

### 4.3 The pure demand

An impure function meeting a `->` demand is an ordinary unification failure with a dedicated report:

> a `->` arrow promises purity, and this function performs effects — the demand is written `->`, the function's face `->?` or `->!`

This is the whole enforcement of `memoize`-class contracts and of `Seq`'s §7 posture; nothing beyond unification is involved. A declared pattern's `view` is one more seat of the demand, and it writes no `->` — the head carries no arrow — so it takes a clause of its own: "a pattern's `view` is run by matching, so it is pure — the demand is the pattern head's, and this function's face is `->?` or `->!`" (Pattern Declarations §2.1, §5).

The failure has a reverse direction, and it needs its own sentence: a *pure* function refused where the impure constant is demanded — a `->!` data field (§2.5), an inlet-less face, any written `->!`. The report above speaks of a written `->` *demand* in every clause, and in the reverse direction the demand wrote no `->` — each clause misdescribes the program. The reverse report says what is actually true:

> this position's arrow is the impure constant — its colour is fixed where the type is declared, and this function's face is the pure `->`; the demand cannot weaken — change the position's declared arrow, or supply the effectful function the position promises

The constraint seat is neither direction of this section *(#867)*: an instance under a member's contract is **compared**, not demanded (§13.2), so a pure body under a `->!` member passes exactly where a pure function at a `->!` field is refused. A field, a parameter arrow outside a contract, a written `->!` in an annotation — these are *types*, and a type unifies; a member header is a *contract*, and a contract is a bound.

### 4.4 At `->?`: the inlet rule, enforced

A `->?` written where §2.2.1 does not admit one is an error at the arrow, never a re-reading of it. The report names the position's reason and offers the constant, because the constant is what the writer of a data field or an inlet-less face almost always meant:

> `->?` is the caller's colour, and this position has no caller to choose it — a `record` field is data, not a signature; write `->!` for a function that pulls the world, or `->` for one that does not

The refusing positions each get their own middle clause — a `union` field says `union`, a `type` alias says *"an alias is a type fragment, not a signature"*, an inlet-less signature (an outer-only or received-only face, §2.2.1) says *"nothing a caller of this signature supplies carries `->?`, so nothing instantiates it"*, and a type position outside any function signature (a module-level binding annotation, an `extern let`, a module-level `var` — §2.2.2) says *"this annotation is not part of a function signature"*. §9 tabulates all five. The fixit is `->!` in every case; a writer who wanted purity reaches for `->` without prompting, and a writer who wanted polymorphism has to add the parameter that would supply it — which is the design conversation the error exists to start.

A refused `->?` recovers as the impure constant, and the recovery is marked as such: mark obligations and face checks whose colour traces to a §4.4 recovery are suppressed. The one report is the ruling; the constant is scaffolding that keeps the rest of the body checkable, not a claim to re-litigate downstream.

## 5. Calls with no mark seat

Four call forms have no position for a mark, by grammar:

1. **Operator applications** — `x + y` elaborates to a constraint member call (Operators §1.1) with no bang position; `x +! y` is not grammar, and negation is the word `not`.
2. **Bracket indexing** — `xs[i]` is `at`, definitionally (Collections Part 3 §5).
3. **`for` heads** — `for x in xs` desugars through the iteration protocol (Loops §2.3, §7.1).
4. **String interpolation** — `"${x}"` renders its holes through `Show` (Primitive Types §5).

The consequence is a demand, not an accident: **everything these forms dispatch to must be pure.**

- **The members these forms reach are the prelude's, and every prelude member's contract is `->`** *(narrowed by #867 from a rule about every constraint; §13.5)*. Operators elaborate to `Num`, `Signed`, `Frac`, `Pow`, `Eq`, `Ord`, `Concat`, and `Integral` members, `for` heads to `Iterable.toSeq`, interpolation to `Show.show` — by identity, never by spelling — and every member of every prelude constraint writes `->` on its outer arrow and, as standard-library policy, on every arrow beneath it (Constraints §7 lists them); brackets elaborate to a compiler-known lookup rather than a member — `Vector`'s and `String`'s `at`, a companion operation the bracket form demands pure (Collections Part 3 §5, §9; §4.3), and `Map`'s keyed read over `Hash` (Collections Part 4 §4.1), pure by construction. That is a **compile-breaking standard-library constraint**, of the kind the prelude seat order already is: a prelude header written `->!` would put an unmarkable call on an effectful member, and the conformance suite is to pin each header. An `honor` body under a `->` contract must solve pure — §13.2's seat check, the mechanism behind Constraints §2's sentence — and derived instances are pure by construction (their generated bodies call members). A *user* constraint may declare an effectful member (§13); no unmarkable form reaches one, because no unmarkable form reaches a user constraint.
- **`Iterable` can never have an effectful instance.** `toSeq`'s contract is `->`, so every instance's body must solve pure; a type whose traversal performs effects cannot honor `Iterable` and cannot stand in a `for` head. This lands exactly where it will matter next: `Map`/`Set` iteration is pure by this sentence.
- **`for` headers are never marked, and loop bodies may be impure.** The head is protocol (pure by the above); the body is a block, not a lambda, and its statements mark their own calls as usual (ruling: iteration protocol is pure; effects live in the body).

## 6. The world's doors

### 6.1 The extern ownership split

Purity at a boundary declaration splits by **who owns the implementation**, and every boundary row writes the arrow the split is about:

- **Every callable boundary row writes its arrow** *(#869)* — `->`, `->!`, or `->?`, between its parameters and its result, as a constraint member header does (§13.1): a row is a contract with no body to infer from. FFI Part 4 §4.5 owns the form and the three readings at the boundary; what this section owns is who answers for the arrow.
- **Compiler-owned intrinsic rows** (`extern from "hex:intrinsic"`) have their arrows **verified**: the compiler is the implementer and is held to the declared scheme, parametricity obligation included (Intrinsics §4.2). Nearly every prelude intrinsic row writes `->`; the two guarded property reads beneath `JsError.message` and `JsError.stack` write `->!` (FFI Part 11 §7). That is an inventory, not a rule of this section: an intrinsic row may write any of the three, and each is verified — vacuously at `->!`.
- **User-written rows have their arrows trusted.** A foreign function is trust territory (FFI Part 1 §3.1). `->!` is the honest arrow for the unknown, and the join for a row that touches the world on its own account (§2.4); `->` is the **trusted purity claim** — believed, never checked, the module author answering for it, sound only under §6.2's species or for a function that genuinely computes; `->?` is the **declared conduit** — one colour variable at the outer arrow and at every `->?` the signature writes, an ordinary linked face under the inlet rule (§2.2.1), with §3.3 and §3.4 unchanged at the call. A row unwilling to claim purity or a dependency writes `->!`. *(The impure default and the contextual `pure`/`conduit` modifiers this section once described are retired; the arrows say what they said.)*

### 6.2 The trusted-purity species

A `->` on a boundary row — user-written or intrinsic — whose implementation does touch the world is unsound, except for three shapes where the claim is *sound*, not merely customary. The ruling names them so every future claim can be tested against one of them:

- **Species (a): unobservable world-writes.** A write-only channel the program cannot read back — never a foreign property write: a `set` row is the write capability it grants and is declared `->!` regardless (FFI Part 5 §4.1, #869), because a property the foreign side can read is not write-only from the world's point of view. The debug probe is the member: a pure-faced `log` that writes to the console changes nothing any Hexagon expression can observe. What it forfeits is multiplicity and ordering — under the per-instantiation contract a probe in a pure producer may print once, many times, or never (a memoized `Seq` step prints once however often traversed). Fine for debugging; disqualifying for real logging, which belongs behind a banged extern. **The caveat:** `console.log` is replaceable, and a replaced sink is a read path; a conforming debug probe captures its sink at initialization.
- **Species (b): owned, memoized, at-most-once world-reads.** A read the runtime performs at most once and then owns — the result is a value; the world can no longer vary it. `seqMemoize` is the member, and so is FFI Part 3's inbound adapter: *memoization makes the foreign iterator's mutability invisible* (Part 3 §4) — the launder that lets an effectful JavaScript iterable become a pure-faced `Seq` at the boundary, unchanged in v1. The hash-table placement mix (`hashTrieMix`, #365) is the third member: its lowering reads the per-process placement seed (Collections Part 2 §2.4) at most once and owns it thereafter, so placement is a value function for the life of the process — which is precisely the within-execution iteration-order determinism §2.4 promises and nothing more.
- **Species (c): reads of stable data** *(#869)*. A pure collection denotes stable contents, and a read of foreign data that cannot vary while Hexagon holds it is a read of a value: contents **captured at acquisition** — the snapshot semantics `Array`, `JsMap`, and `JsSet` adopt under #876 and #875, whose `length`/`size`/element reads are then reads of a value — or data a **stability contract** binds the foreign side to hold still for as long as Hexagon may observe it, of the shape FFI Part 2 §6.2 and FFI Part 10 §2 write, whose violation is an FFI Part 1 §3.1 contract violation like any other (a user row's `->` over foreign data, FFI Part 4 §4.5; a `->` getter, FFI Part 5 §3.1, is such a claim and is tested against exactly this: which contract holds the data still). What makes the face sound is the stability of the data, never a rule that forbids the compiler to share the read: a replayable read of data foreign code may vary is `->!`, which is where `JsError.message`/`stack` stand (FFI Part 11 §7). Until each snapshot contract lands, the standing borrow contracts (Part 2 §6.2, Part 10 §2) are the stability this species reads, unchanged.

Species (a) permanently excludes a pure-faced `random()` or `readLine()` — a read the program observes is never unobservable. Species (b) excludes any *replayable* read — replay is exactly what at-most-once forbids. Species (c) admits a replayable read only of data a contract or a capture holds still. The slogan survives these doors amended once: **silence means nothing the program can observe.**

### 6.3 What the claim costs

A trusted claim is per-module-author accountability, the same currency as every extern type. The compiler does not verify species membership; it verifies intrinsic rows (§6.1) and believes user rows. A claims audit belongs to review, not the checker.

## 7. The sequence posture

- **`Seq` is pure by construction.** Its field is `pull: () -> Option((a, Seq(a)))` — a pure thunk, by §2.5. Every producer and combinator is pure; building a pipeline is pure; *the five strict consumers* — `fold`, `forEach`, `find`, `any`, `all` — are the only doors effects enter through, each with a linked-`->?` callback and a `?`-marked body call. An effectful step function can no longer be smuggled into a lazy pipeline at all: `Seq.unfold` with an impure producer is §4.3's unification refusal. The `memoize` landmine — memoization observably changing how many times effects run, with no type-level story — is dissolved rather than patched: the producer position demands purity, and what remains for `memoize` to claim is species (b).
- **Effectful sequences are nominal siblings, never effect parameters.** The two-point lattice degenerates "a type parameterized by effect" into "two types" — so Hexagon ships two types, on the Kotlin `Sequence`/`Flow` and F# `Seq`/`AsyncSeq` precedent, and no effect variable ever appears in a type constructor's arguments. `Stream(a)` is the pull-impure sibling: no tail, field arrow the impure constant, consumers `->!` (`stream.md`, the owning spec). A push sibling (`Observable`) is future work; async is out of scope (§1).
- **The FFI gains a declared choice at the boundary.** A foreign iterable at a `Seq(a)` position takes Part 3's launder — adaptation plus at-most-once memoization, species (b), purity manufactured honestly. The same object at a `Stream(a)` position crosses raw, protocol to protocol, no adapter and no memoization — impurity declared instead (FFI Part 3's `Stream` section). Nothing about the v1 `Seq` boundary changes.
- **The coupling that makes purity true.** Statements §6.2 (a lambda cannot touch an outer `var`) and §6.4 (no ref cells, no mutable fields) are what make a `->` face a *fact* rather than a convention — there is no mutable capture for a pure-faced closure to smuggle. That same fence is why a compiler may treat pure instantiations as free for fusion and reordering within the semantics those sections fix. The effects discipline leans on those sections; weakening them re-opens this ruling.

## 8. Emission

Colours and marks erase. Arrows, `!`, `?`, and the trusted arrows on boundary rows exist for the checker and the reader; emitted JavaScript is identical with and without them, and no runtime representation of colour exists. (The debug probe's captured sink, §6.2, is the probe's own implementation detail, not a colour representation.)

## 9. Diagnostics checklist (implementer-facing)

Messages are normative in shape; the mark table's six rows share one sentence frame.

| Situation | Error |
|---|---|
| A pattern's `view` solving to `->?` or `->!` | "a pattern's `view` is run by matching, so it is pure — the demand is the pattern head's, and this function's face is `->?` or `->!`" (§4.3; Pattern Declarations §2.1) |
| Bare call, `!` required | "this call runs effects, so `save` wants `!`, not no mark" + fixit: mark the call `!` |
| Bare call, `?` required | "this call is as effectful as the enclosing instantiation makes it, so `combine` wants `?`, not no mark" + fixit: mark the call `?` |
| `!` written, `?` required | same frame: "…so `combine` wants `?`, not `!`" |
| `?` written, `!` required | "this call runs effects, so `save` wants `!`, not `?`" |
| `!` written, call pure | "this call is pure, so `next` wants no mark, not `!`" + fixit: remove the mark |
| `?` written, call pure | "this call is pure, so `next` wants no mark, not `?`" |
| Non-identifier callee | the frame's subject adapts: a dot call is named by its member — "…so `.next` wants `!`…" — and any other compound callee degrades to "this call": "this call runs effects, so this call wants `!`, not no mark" |
| `->` face, body performs effects | "this call performs effects, and the enclosing function's face is the pure arrow `->` — a pure face cannot run effects" — at the offending call (§4.2) |
| `->?` face, body impure-constant | "this signature's `->?` promises a colour the caller chooses, but the body solves it to the impure constant — a function that performs its own unconditional effects rounds up, and its face is `->!`" + fixit `->!` (§4.2) |
| `->?` face, body pins the variable pure | "…solves it to the pure constant — the honest face is `->`" + fixit `->` (§4.2) |
| `->!` face, body effect-polymorphic (a conduit) | "this face is the impure constant `->!`, but the body performs no unconditional effect — it is effect-polymorphic, and its face is `->?`" + fixit `->?` (§4.2) |
| `->!` face, body pure | same frame, "…but the body performs no effect — its face is `->`" + fixit `->` (§4.2, #868) |
| An instance body (an `honor` member, a default body, a `widens` door) performs effects at an invoked `->` arrow of its contract — the outer arrow, or a nested one, where the frame's subject adapts to the arrow: "the function this instance returns performs effects, and `make`'s contract returns a `->` function" (§13.2) | "this call performs effects, and `read`'s contract is the pure arrow `->` — an instance performs no more than its contract permits — keep this body pure, or, if the constraint is yours, write `->!` on the member" — §4.2's pure-face frame with the contract named as such, at the offending call (§13.2; Constraints §8) |
| An instance body performs its own unconditional effect under a linked (`->?`) contract | "this call performs effects unconditionally, and `run`'s contract is linked `->?` — an instance must be pure whenever what it is handed is pure, so its effects may come only from what it is handed — move this effect behind the callback, or write `->!` on the member" — at the offending call (§13.4) |
| An instance body accepts less than its contract promises at a supplied arrow, at any instantiation (a `->?` callback handed to a `->` demand, say; a `->!` callback met by a body accepting only pure ones) | "`run`'s contract accepts an `action` of either colour, and this instance accepts only a pure one — an instance accepts everything its contract promises to accept — call the callback with `?` instead of handing it to a `->` demand, or, if the constraint is yours, write the member pure-only — the callback `->` and the outer arrow `->`" — the seat's refusal, reported at the demand that narrowed it (§13.2) |
| `->?` on a member's outer arrow with no inlet in the header | the inlet-less-signature row below, unchanged — a member header is a signature (§13.4) |
| Impure argument at a `->` demand | "a `->` arrow promises purity, and this function performs effects — the demand is written `->`, the function's face `->?` or `->!`" (§4.3) |
| Pure function at an impure-constant demand (a `->!` data field, an inlet-less face, any written `->!`) | "this position's arrow is the impure constant — its colour is fixed where the type is declared, and this function's face is the pure `->`; the demand cannot weaken — change the position's declared arrow, or supply the effectful function the position promises" (§4.3) |
| `->?` in a `record` field | "`->?` is the caller's colour, and this position has no caller to choose it — a `record` field is data, not a signature; write `->!` for a function that pulls the world, or `->` for one that does not" + fixit `->!` (§4.4) |
| `->?` in a `union` field | same frame, "a `union` field is data, not a signature" + fixit `->!` (§4.4) |
| `->?` in a `type` alias body | same frame, "an alias is a type fragment, not a signature" + fixit `->!` (§4.4) |
| `->?` in a signature with no inlet (an outer-only or received-only face — §2.2.1) | same frame, "nothing a caller of this signature supplies carries `->?`, so nothing instantiates it" + fixit `->!` (§4.4) |
| `->?` in a type position outside any function signature (a module-level binding annotation, an `extern let`, a module-level `var`) | same frame, "this annotation is not part of a function signature" + fixit `->!` (§4.4, §2.2.2) |
| Mark not glued into its seat (not against both callee and `(`, and not glued at a bare pipe stage's end) | parse error: "a call mark governs an argument list; write it immediately before `(`, or (in a `|>` stage) at the end of the stage — a reference carries no colour" (§3.2) |
| Prefix `!` on an expression (negation intent) | the `not` redirect survives the token change: "Hexagon spells logical negation `not`" — position-selected by the parser now that `!` lexes (Lexer §10's row) |
| `=>` (or the retired `=>!`) after a complete type operand, in a type position where a fat arrow can have no other reading | the type-arrow redirect: "Hexagon's type arrows are `->`, `->?`, `->!`; `=>` is the lambda arrow — for a function type write `Int -> Int` (or `->?` / `->!` for its colour)" + fixit `->` (`->!` for `=>!`), and recovery resolves the arrow to that spelling so one typo yields one report. Position-selected by the parser, and **silent** where the fat arrow competes — a lambda's return annotation, where it is the body's (§2.6), and a `let`/`var` annotation, where it may be a mis-typed `=` *(#410)* |
| Prefix `?` on an expression | the mark-position row above — `?` never had a negation reading, so there is no redirect to give it |
| A callable extern row written with `:` before its result, or with the retired `pure`/`conduit` modifier | FFI Part 4 §13's redirects — the arrow that says what the old form said, `->!` as the fixit for the colon (§6.1, #869) |
| A `set` row, instance or static, with an arrow other than `->!` | "an extern `set` grants write capability, and a write to foreign state is an effect — its arrow is `->!`" + fixit `->!` (FFI Part 5 §4.1, #869) |
| `->?` on a callable extern row whose parameters carry no `->?` | the inlet-less-signature row above, unchanged (FFI Part 4 §4.5) |

## 10. Display

Display is part of the contract: a signature a reader cannot see is not a face. Functions §5.1 owns the display grammar; this section owns what is specific to colour.

- **The trio renders everywhere a face does** — hover, diagnostics, completion detail, and the generated `.d.ts`. A TypeScript face has one function arrow, so the declaration file carries the Hexagon signature as a generated documentation line (`` Hexagon: `face` ``), merged into the author's block per Doc Comments §7.3 and emitted only where the face carries a colour — purity is the silent one (§1).
- **Distinguish, and only where the grammar cannot spell it.** A face carrying **exactly one** distinct effect variable displays it undecorated, `->?`, wherever that variable stands. A face carrying **more than one** — inference produces these; the written grammar, which links every `->?` in a signature into one colour, cannot — numbers them in order of first appearance, `->?¹`, `->?²`. Constants are never numbered: `->` and `->!` mean what they say in every position. The numbering's unit is the one displayed type expression, nested function types included. The decoration is display-only, not grammar: pasted into source it fails at the lexer.

  The predecessor rule also numbered a *lone* variable with no inlet occurrence, because an undecorated write-back would there have taken the else-constant reading and silently meant `=>!`. With that reading abolished (§2.2.1) the case is no longer a silent one: the undecorated spelling is exactly right about the colour — one variable — and a paste into a position that cannot host it is caught by §4.4, which explains why in a sentence. **Numbering marks what the grammar cannot express, not what the checker will refuse**; a legality error with a teaching message is a better outcome than a token failure, so the lone-variable case now displays plainly.

- *(#410.)* **A constrained face wears its constraints as a bracket prefix**, `<a: Show> (Seq(a), (a) ->? Unit) ->? Unit` — Functions §5.1 owns the grammar. It is display-only under exactly this section's licence: a paste into an annotation position is refused there as numbering is refused at the lexer, and for the same reason — display marks what the grammar cannot express. With the separator gone, a displayed type contains no `=>` at any depth (§2).
- **A machine-written annotation never spells a variable colour.** What an annotation writer spells is one type torn out of its signature, and whether the fragment's new home offers an inlet is not a question the fragment answers. Both constants write freely; a machine-written impure return annotation is spelled `->!` and needs no parentheses (§2.6).

## 11. Rejected alternatives (do not re-litigate without new information)

- **Effect-parameterized types** (`Seq(a, e)`, Koka-style rows): refused — it reintroduces the machinery HM-nativeness exists to avoid, and the two-point lattice makes the nominal split (§7) strictly cheaper.
- **The Swift collapse** — weakening `!` to "possibly impure" and dropping `?`: the recorded fallback if the trichotomy had failed its bake. It failed the other way: `!` on a body's forwarded-callback call would constantify the variable and kill the pure face. Not adopted; recorded because it is the natural simplification a future reader will propose.
- **A second effect variable for const ⊔ var bodies**: never — §2.4's join.
- **Marks on references** ("effectful values"): values wear no colours (§2.6); the effect happens at the call.
- **`^` or `~` as the conducting mark**: `?` won on the trained gesture — "this line defers to my caller."
- **`!->`**: not a token; the mark trails what it condemns, on arrows exactly as at calls (§2.3).
- **The `->` / `=>` / `=>!` spelling**: superseded. It distinguished constant-from-variable by the arrow *head* and variable-from-constant by the *tail* — two axes for three spellings — and the head grouping paired `=>` with `=>!` when the semantic pairing is `->` with `=>!`, both being constants. It also left `=>` serving four roles at once — lambda arrow, `match`/`catch` arm arrow, effect arrow, and the displayed scheme's constraint separator *(the fourth has since gone the same way, #410: the display is source-shaped, §10)*. The third role is the sole cause of the withdrawn return-annotation parenthesization rule (§2.6), and the third against the fourth put two meanings of one symbol in a single displayed line (§2). One arrow with the call trichotomy's own marks fixes all of it.
- **The else-constant rule**: withdrawn. It read a `=>` with nothing to link to as the impure constant, which gave one spelling two meanings selected by position — the divergence §2.5 had to say out loud — and put the arrow side out of step with the call side, where a `?` with nothing to conduct has always been an error rather than a re-reading. Its two clients, the data field and the result-only face, are better served by writing `->!`, which is what they meant. Do not restore it to spare a writer three keystrokes: the keystrokes are the point.
- **Numbering a lone inlet-less variable in the display** (§10): dropped with the else-constant rule, whose silent re-reading was its only justification. A face the grammar *can* spell displays plainly even when this position will refuse it; §4.4 explains the refusal better than a lexer failure does.
- **A pure-asserting term lambda arrow** (`x -> body`): dropped — inference from the body plus the ascription demand covers it with zero new syntax.
- **Exact matching at the constraint seat** *(#867)*: refused. A pure instance cannot manufacture the effect a `->!` member's exactness would demand, so effectful members would be unhonorable at any in-memory type; the seat compares (§13.2).
- **A `widens` door showing its body's inferred colour** *(#867)*: refused. It would let a body change flip every direct caller's marks and inferred colours under an unchanged interface, and it would hang two colours on one operation (§13.3).
- **The conservative-conduct rule** *(#868)* — an undetermined call inside an inlet-bearing body conducts, and an inlet-bearing body's unconstrained colour is not defaulted: withdrawn. It gave `?` a second meaning, "inference has not resolved this here", beside its one meaning, a preserved dependency; it minted a second effect variable on every closure builder — `defer : (() ->?¹ Unit) ->?² () ->?¹ Unit`, a face the grammar cannot spell and no header could correct, since a header has no outer-arrow seat — the only repair was abandoning header syntax for a binding annotation restating the whole signature — and it forced `?` between knot siblings that perform nothing. The face it guarded was never at risk: a colour nothing constrains is not a dependency, and the caller-supplied colour it feared losing is the parameter's own variable, which the defaulting never touches. Do not restore it for the knot's sake: the knot's remedy is settling at its close (§3.4), not conducting.

## 12. Decisions log

| Decision | Where |
|---|---|
| Two-point lattice; effect = observable world interaction; exceptions and `Result` outside; async out of scope | §1 |
| Arrow trio `->` / `->?` / `->!` — one arrow, the call trichotomy's marks; one linked variable per signature; `=>` is a term arrow only | §2, §2.1–§2.3 |
| The inlet rule: `->?` is legal only in a signature with an inlet — an occurrence of the colour inside a parameter type of any application-spine arrow, at any depth and any polarity; outer-only and received-only faces refused; elsewhere an error, never a second reading | §2.2.1, §4.4 |
| Local type positions (binding annotations, ascriptions) name the enclosing signature's variable; a fragment with its own inlet is its own signature; no-signature positions take §4.4's own clause | §2.2.2 |
| §4.4 recovery is marked; downstream obligations tracing to it are suppressed | §4.4 |
| Linked-face reports stand at the written `->?`; the impure fixit is join-shaped (outer alone when the outer is written `->?`, else every nested occurrence); the pure fixit rewrites all | §4.2 |
| Conservative join governs the function's own colour only; forwarded callback arrows keep their variable; `->!` spells the join | §2.4 |
| Data-field arrows: `->` or `->!`, never linked; `->?` in a data declaration is refused, not re-read | §2.5 |
| Lambdas always the term `=>`; colour inferred; references colourless; demands via ascription/unification; **no return-annotation parenthesization rule** — the levels no longer share a token | §2.6 |
| Call trichotomy bare/`!`/`?`; pipe teaching model; mark anchors the argument list; pipe stages are calls | §3.1–§3.2 |
| The outermost-arrow sentence: a mark describes this call only | §3.3 |
| Effect variables are tyvars: monomorphic in the SCC knot, settled at body close (a knot's members at the knot's close); source/conduit/unconstrained arms | §3.4 |
| **An unconstrained own colour defaults to pure before generalization, whatever the signature's inlets** — after the body's dependencies are resolved, at body close for a lone binding and at the knot's close for a `fun` member; a parameter's variable and a colour joined by a `?` call, a written `->?`, or a sibling call are dependencies and are never defaulted; an undetermined call is bare in every body, a knot sibling's colour never pinned by the defaulting; the knot's close runs the source arm then the conduit arm to a fixpoint over the component, then defaults, then reads the recorded obligations; `?` has one meaning (#868) | §3.3, §3.4, §4.1, §4.2, §11 |
| Symmetric enforcement, error-grade, at calls (six directions) and faces (both directions) | §4 |
| Four unmarkable call forms ⇒ constraint members `->`-demanded; `Iterable` instances pure; `for` heads never marked *(narrowed by #867: the demand is on the prelude's members, which is what the four forms reach — §13.5)* | §5 |
| Extern ownership split: intrinsics verified, user externs impure by default with contextual `pure` claim, and the contextual `conduit` claim beside it — one variable at the outer arrow and every `->?`, an ordinary linked face, no FFI-specific rule at the call *(superseded by #869, next row)* | §6.1, FFI Part 4 §4.5 |
| Every callable boundary row writes its arrow; intrinsic arrows verified, user arrows trusted — `->` the purity claim, `->?` the conduit, `->!` the unknown and the join; the impure default and `pure`/`conduit` retired (#869) | §6.1, FFI Part 4 §4.5 |
| Two trusted-purity species: unobservable world-writes; owned at-most-once world-reads; captured-sink caveat *(#869: a foreign property write is never species (a); species (c), reads of stable data — captured at acquisition or held still by a stability contract — added)* | §6.2 |
| `Seq` pure by construction; effectful sequences are nominal siblings (`Stream`); FFI position choice | §7 |
| Colours and marks erase at emission | §8 |
| Display: the trio everywhere a face renders; the `.d.ts` documentation channel; machine-written annotations refuse variable colours | §10 |
| Display distinguishes only what the grammar cannot spell: one variable displays undecorated `->?`, multi-variable faces are numbered `->?¹`/`->?²`, display-only | §10, Functions §5.1 |
| A constrained face displays its constraints source-shaped, as a binder-bracket prefix, under the same display-only licence; no `=>` survives anywhere in a displayed type | §2, §10, Functions §5.1 |
| Variance and every occurrence walk count the effect slot, at the arrow's own sign | §3.4 |
| **A constraint member header is an effect contract** (#867): it writes its outer arrow; an instance body infers its colour; the seat *compares* — pure below impure, at the arrow's own sign, at each instantiation of the member's variable — instead of unifying, the one exception to §1; every arrow a contract writes is a bound — a ceiling where the caller invokes it, a floor where the caller supplies it — and outside a contract the arrows are exact | §13.1–§13.2, §1, §2.3, §4.2, §4.3 |
| Every spelling of a member call — bare, qualified, dot, at a known instance, through evidence, a `widens` door — marks by the contract, never by the body; a door shows the member's contract colour over its wider seats; `!` promises no purity and asserts no effect (#867) | §13.3 |
| One effect variable per member, quantified at the member and instantiated per call; a member header is a signature under the inlet rule; an instance must satisfy both instantiations (#867) | §13.4 |
| The four unmarkable forms stay pure because every prelude member writes `->` — a compile-breaking standard-library constraint; a user constraint may declare an effectful member (#867) | §5, §13.5 |

## 13. Effect contracts at the constraint seat *(#867)*

A constraint member header is the one function header in the language with no body beneath it to infer from, and it is therefore the one that **writes its own outer arrow**: `show(value: a) -> String`, `read(source: a) ->! String`, `run(runner: r, action: () ->? Unit) ->? Unit` (Constraints §2 owns the form; Functions §4.1's implementation headers keep `:` and keep inferring). What the header writes is a **contract** — what a caller may assume, and what an instance must satisfy — and this section fixes how the two sides meet. Every rule elsewhere in this document stands; §13 adds one seat and says exactly what happens there.

### 13.1 Two levels

- **An instance is an implementation, and its colour is inferred.** An `honor` member body, a default body, and a `widens` door body solve their own colour by §3.4's three arms, exactly as any body does. The header such a body hangs under writes `:` where it writes anything and never an outer arrow (Functions §4.1; Constraints §4.1, §4.7). Of one constraint's instances some are pure and some are not, and nothing written at the constraint says which.
- **The contract never learns the instance's colour.** It knows only what it refuses: a pure contract cannot be met by an impure instance. Reading a contract tells a caller the most an instance may do, never what a given instance does.
- **So every arrow a contract writes is a bound, and the seat is a comparison, not a unification.** An arrow the caller invokes — the outer arrow first of all — is a ceiling: `->!` there means *an instance may perform effects*, and a pure body beneath it is not §4.2's lie, because the header is not that body's face. An arrow the caller supplies — a callback's — is a floor: the instance must accept at least what the contract promises (§13.2). This is the one seat where §1's "colours unify or they do not" gives way to an ordering, and it is the whole of the exception: at calls (§4.1), at demands and fields (§4.3), and on every implementation's own written face (§4.2), the arrows are exact.

### 13.2 The seat check

In one sentence: **an instance accepts everything its contract promises to accept, and performs no more effects than its contract permits.** The mechanism is Constraints §4.1's checking posture with the effect slot compared instead of unified — no search, no second reading, one committed answer per seat:

- **The contract is instantiated at each colour its variable can take** — once, if the header writes no `->?`; twice, pure and impure, if it does (§13.4).
- **The body is inferred on its own, then compared.** The contract's *types* reach the body as Constraints §4.1's expected type (Functions §4.3) with **every effect slot replaced by a fresh variable of the body's own**, one per slot — the one place §3.4's expected-types bullet is qualified: an expectation's colours do not arrive here, because the seat is about to compare them. The body's `?` calls then join what they absorb as inference always joins (§3.4), so a body that runs two callbacks makes them one colour, and a body that runs neither may keep two, displayed as §10 displays any inferred face. The body then infers and generalizes as any body does (§3.4), and its scheme is instantiated fresh against each instantiation of the contract. For a `widens` door the scheme compared is the member's **derived restriction** (Constraints §4.7) — the door at the member's own seats — since the door's wider seats are not the contract's; the door's own written signature is its face, checked by §4.2 as any written face is.
- **The two are walked together, and colours are ordered, pure below impure, at each arrow's sign.** The sign is the **product** the variance analysis already computes (`decisions-ml-dialect-generalization-2026-08.md` §5; §3.4's occurrence walk counts the effect slot at it): the walk starts covariant at the outer arrow; descending into a parameter flips the sign, descending into a result, a tuple component, a record field, or a union payload keeps it, and descending into a constructor's argument multiplies by that constructor's variance — inferred for a transparent type, declared for an opaque one, the compiler-side table for a compiler-known one. Where the product is **covariant** the caller invokes the arrow and the body's colour must be at most the contract's; where it is **contravariant** the caller supplies it and the contract's colour must be at most the body's; where it is **invariant** the colours must be equal. One sign per arrow, so `make: (Int) -> (() ->? Unit)` in a parameter is contravariant at both its arrows — reached through a result, but of a supplied function. Non-effect structure checks as Constraints §4.1 already checks it.
- **A body colour still a variable collects the bounds the walk imposes**, over the whole walk at one instantiation of the contract, and the seat passes when every variable's bounds are consistent — on a two-point lattice, one test per variable. A failed seat names the arrow that failed and the direction it failed in. Which of §9's three contract rows reports is decided by the **failing arrow's** contract colour and direction, whatever the outer arrow: an invoked arrow whose contract colour is `->` and whose body colour is impure takes the pure-contract row, its frame naming the arrow when it is nested ("the function this instance returns performs effects, and `make`'s contract returns a `->` function"); an invoked arrow whose contract colour is `->?` failing at the pure instantiation takes the linked-contract row; a supplied arrow failing at any instantiation takes the narrower-acceptance row; an invariant arrow, whose colours must be equal, takes the pure-contract row when the body's colour is above the contract's and the narrower-acceptance row when it is below. The refusal is the seat's even when its span lies inside the body: a body that hands the contract's callback to a `->` demand infers cleanly, the callback's fresh colour pinned pure by ordinary unification (§2.1), and it is the seat — never §4.3's demand row — that refuses it, reporting at the demand that pinned the colour, because that is where the narrowing happened.

For a constant outer arrow the rule is a table:

| Body solves to | `->` contract | `->!` contract |
|---|---|---|
| pure | accepted | accepted |
| impure | refused | accepted |

The refused cell is Constraints §2's standing sentence — member bodies under a pure contract solve pure — given its mechanism, reported in §4.2's pure-face frame with the contract named as such, at the offending call. The lower-right cell is what the ordering buys: a `->!` member honored at an in-memory type by a body that reads nothing.

The supplied direction is what keeps callbacks honest. A contract accepting either colour of callback — `action: () ->? Unit` — cannot be honored by a body that accepts only a pure one (a body handing the callback to a `->` demand, say): at the contract's impure instantiation `->!` is not at most the body's `->`. The reverse widening is free — a body may accept more than its contract promises, and §13.4's worked example is one. Compatibility is never "pure-for-effectful at every nested arrow"; it is the sign, read once.

### 13.3 Every spelling wears the contract's mark

**A call resolved through a member marks by the contract's outer arrow at this instantiation, never by the instance's body** — the bare member call, the qualified call, the dot call (Method Syntax §7), a call at a known concrete instance, a call through evidence under a bound, and a call to a `widens` door (Constraints §4.7; Modules §5.3; Method Syntax §6.1) alike; references to any of them carry the contract's callable type (§2.6 — references are colourless). Knowing which instance answers grants no purer face: `Path.read!(p)` wears `!` at an instance whose body is pure, exactly as `source.read!()` does under `a: Readable`.

- **The door is no exception.** A `widens` binding shows the operation's widest *argument* face and the member's *contract* colour — one operation wearing two widths, never two colours. Its declaration's header writes `:` and its body is inferred and compared at the seat like any instance's, through the member's derived restriction (§13.2). The alternative is recorded in §11; what this costs is stated once, below.
- **What `!` means, restated.** A bare call is statically pure. A `!` call *may* perform effects — the contract grants no purity — and it does not promise that an effect occurs on this execution: a conditional body, or a pure body under an effectful contract, may perform none. A `?` call carries the enclosing signature's variable. Mark checking stays exact (§4.1): the required mark is the contract's arrow, and any other mark is the error it always was.
- **The price.** A pure body behind an effectful contract cannot be used as pure *through the member or its door*. An author who wants a pure operation available names one — an ordinary function beside the instance — and the compiler never exposes one on the author's behalf.

The churn this buys, under a `->!` contract:

| Body change | Calls through the member and its door | Refused alternative (door shows the body's colour) |
|---|---|---|
| pure → effectful | stay `!` | direct calls change from bare to `!`, and their callers' colours may follow |
| effectful → pure | stay `!` | direct calls change from `!` to bare, likewise |

Changing an instance within its contract's allowance changes no caller.

### 13.4 One effect variable per member

A member header is a **signature** in §2.2.1's sense: every `->?` it writes denotes one implicitly quantified effect variable, the member's own, and the inlet rule applies unchanged — an outer-only member face, `read(source: a) ->? String`, is §4.4's inlet-less refusal. The variable is quantified **at the member and instantiated fresh at every call**; it is not fixed per instance. This is the one member-level quantifier the language admits — Constraints §2's ban on member type parameters stands (§9.6 there), and this variable is not a door to them.

An instance must satisfy the contract at *both* instantiations (§13.2). For `run(runner: r, action: () ->? Unit) ->? Unit`:

| Callback supplied | What the instance may do |
|---|---|
| pure | nothing the world observes |
| impure | anything, or nothing |

Calling the callback, calling it conditionally, and ignoring it all satisfy the contract (ignoring it may break a behavioural law, which is the constraint author's business, not the checker's). An honoring body writes no arrow and needs none:

```
honor Runner<Job> =
    run(job, action) = action?()
```

The body's signature is the contract's shape with fresh colours (§13.2), so the contract's callback parameter is the body's inlet (§2.2.1) and `action?()` is §3.1's ordinary conduct — the `?` names the body's own variable, which the seat then compares. A **default body** is the same case checked once in the constraint's generic context (Constraints §2): it calls its sibling members at *their* contracts' marks and is compared against its *own* contract like any body — a default under `->` cannot call a `->!` sibling (a source under a pure contract), a default under `->?` may conduct a `->?` sibling but not call a `->!` one, and a default under `->!` may call anything. A body that performs its own unconditional effect fails the pure instantiation: its outer colour is the join (§2.4), and `->!` is not at most `->`. A body that accepts only pure callbacks fails the supplied direction (§13.2). A contract that wants both — a linked callback *and* a licence for its own effects — writes the join on its outer arrow, `run(transaction: t, action: () ->? Unit) ->! Unit`: §2.4's `withTransaction` shape as a contract, whose calls always wear `!`.

### 13.5 The unmarkable forms

§5's four forms stay pure, and the ground moves from a rule about every constraint to a fact about the prelude's: operators, `for` heads, and interpolation elaborate to prelude members by identity — brackets to a compiler-known lookup, `Vector`'s and `String`'s `at` or `Map`'s keyed read, each pure (Collections Part 3 §5, §9; Collections Part 4 §4.1) — and **every member of every prelude constraint writes `->` on its outer arrow** — what the four forms need — and, as standard-library policy, on every arrow beneath it: no prelude member is effect-polymorphic (Constraints §7 lists them; the focused owners list the rest). That is a compile-breaking standard-library constraint, which the conformance suite is to pin alongside the prelude seat order. A user constraint's effectful member reaches no unmarkable form, because no unmarkable form reaches a user constraint. `Iterable` therefore still admits no effectful instance and `Stream` still has no instance (`stream.md` §4.5); a pattern's `view` is §4.3's demand, unchanged (Pattern Declarations §2.1).

### 13.6 Evidence, emission, display

- **A dictionary is a value.** Instance construction is evaluation-free (Constraints §6.3), and an effectful member's effect happens at the call — where its mark is — never at the dictionary. Nothing about evidence, sharing, or CSE reads a member's colour.
- **§8 stands.** The seat holds the body whatever its colour, and colours erase.
- **A member's face displays its contract arrows** (§10), and the `.d.ts` dictionary interface carries a coloured member's Hexagon face on the documentation line §10 already emits (FFI Part 9 §2.2).
