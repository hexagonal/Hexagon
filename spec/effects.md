# Hexagon Spec: Effects

**Status:** Decided (September 2026): Swift-style marks over one colour per callback (#1144). This replaces the design with one colour per signature and three call marks (bare, `!`, `?`). The two-point effect discipline ships in v1, unconditionally: colours are part of the language, not an option. Nothing here has a warning tier.
**Scope:** What an effect is. The three arrows (`->`, `->!`, `->?`) and where each may be written. One colour per callback parameter, and joins of them. The two call marks (bare and `!`). Colours in inference, including fitting. Symmetric enforcement at calls and faces. The extern ownership split and the trusted arrows on boundary rows. The `Seq`/`Stream` posture. Effect contracts at the constraint seat, and calls at a known instance (§13).
**Not in scope:** Exceptions, which are deliberately outside the effect (§1). `Stream`'s module surface (`stream.md`). Token shapes (Lexer §8). The pipe rewrite (Operators §8). The dot-call form (Method Syntax §2). The display grammar for arrows (Functions §5.1).
**Companions:** Functions (§4.1 annotations, §5.1 displayed types, §7.4 the monomorphic knot, §8 generalization). Statements, Blocks & Mutability (§6.2, the coupling §7's last bullet names). Constraints (§2 member headers are contracts; §4.1 the seat; §4.7 doors; §7 the prelude's members write `->`). Declarations Preamble (§4 transparent aliases). Intrinsics (§4.2 verification). FFI Part 4 (extern bindings; §4.5 the arrow every callable row writes). FFI Part 3 (the `Seq` launder; the `Stream` crossing). Loops (§6 `Seq`, §7 `Iterable`). `stream.md`.

---

## 1. Doctrine

- **The tracked effect is observable interaction with the world.** Reading input, writing output, consulting a clock or an entropy source, mutating foreign state. Nothing else is an effect:
  - allocation is not;
  - `var` inside a function body is not, because it cannot escape (Statements §6.2);
  - the storage a pure-faced lowering allocates and no program can address is not, whether scratch, frozen or memo (§6.2 species (d));
  - **throwing is not.** Exceptions are the partiality and defect channel (Exceptions spec): `Int.div` throwing `DivideByZeroError` does not make division effectful, and `Result` is untouched. Without this cut, the doctrine of throwing companions would make the whole prelude impure.
- **The lattice has two points: pure and impure.** There are no effect rows, no effect families and no user-declared effect kinds. A design that wants to know "which effect" is a different language; Hexagon asks only "does the world notice".
- **Purity is the silent one.** A bare call, an unmarked body and a `->` arrow are all silent, and silence is the strongest claim. Effects are what get spelled, in **one alphabet**:
  - a call wears `!` or nothing;
  - an arrow is `->`, `->!` or `->?`.

  `!` means *may touch the world* wherever it is written. A reader who sees no mark may assume the world is untouched.
- **`!` promises "may", never "does".** A marked call may perform no effect on a given run, and an arrow written `->!` may stand over a pure body. The one exact promise in the language is silence.
- **The system is Hindley–Milner all the way down.** A colour is one more unifiable component of every function type. Colour variables are ordinary type variables, and a colour may be a *join* of them: "as effectful as any of these" (§2.4). There is no row polymorphism and no subsumption relation in the types.
  - A function fits wherever a function is expected by **instantiation**. Each use reads its outer arrow as "its colour, or more", and unification decides the "more" (§2.6, §3.4).
  - One seat **compares** colours instead of unifying them: an instance meeting a constraint member's contract (§13). Everywhere else, colours unify or they do not.
- **Asynchrony is out of scope, permanently for this ruling.** `async` is a separate axis, not a point on this lattice. v1 is synchronous, and the async question files its own issue when it arises.

### 1.1 The model in brief

1. **Arrows.**
   - `->` is pure.
   - `->!` may touch the world. On a callback parameter's own arrow it is that callback's **colour**: the parameter accepts any function, and the function taking it is as effectful as what it is handed. Everywhere else it is the impure constant.
   - `->?` is written only in types. It means "only as effectful as everything this signature is handed" (§2).
2. **Colours.** Every callback parameter has its own colour. A function's colour is what its body does: impure if it touches the world on its own account; otherwise the join of the colours of the callbacks it runs; otherwise pure. A finished face depends on all of its callbacks or on none of them (§2.4, §3.4).
3. **Calls.** A call is bare where the callee's colour at this instantiation is pure, and `!` otherwise. Any other mark is an error, in both directions (§3, §4.1).
4. **Fitting.** A function the program's text decides fits wherever a function is expected. A pure function fits anywhere, and any function fits `->!` (§2.6, §3.4).
5. **Untyped parameters.** A parameter with no written type that the body uses as a function is decided by the marks of the calls it flows into: `!` makes its colour the caller's, and bare makes it pure (§3.4).
6. **Faces.** A written face may claim more effect than its body performs, never less (§4.2).
7. **Contracts.** A constraint member's arrows are bounds that an instance's inferred body is compared against. A call at a known instance follows that instance's face; a generic call follows the contract (§13).

## 2. The three arrows

Function types carry a colour on every arrow. The display grammar (zero, one or many domains, right association) is Functions §5.1's, unchanged. This section fixes what each arrow means. Examples throughout use `noop(): Unit = ()`; `save0(): Unit = save!("x")`, a function that touches the world; `pureOnly(f: () -> Unit) = f()`; and `apply2(f: () ->! Unit, g: () ->! Unit)`, which runs `f` and then `g`.

```text
->     pure: this function touches nothing the world can observe
->!    may touch the world
->?    only as effectful as what this signature is handed
```

**The mark is the call mark.** `!` on an arrow and `!` at a call say the same thing: a call through a `->!` arrow wears `!`, and a call is `!` exactly where the callee's arrow is not pure (§3.1). `->?` has no call counterpart. Where a function depends on what it is handed, a call to it may touch the world when what it is handed may, so the call wears `!` in that case and nothing otherwise.

The fat arrow `=>` is not a token of the type grammar. It is a term-level arrow only (the lambda's, and the `match`/`catch` arm's; Lexer §8.1). So Functions §4.1's return-annotation slot needs no parenthesization rule (§2.6), and a displayed type contains no `=>` at any depth: constrained faces wear their constraints as a bracket prefix (§10).

### 2.1 `->`: the pure arrow

A `->` function performs no observable effect at any instantiation. As a demand (a `->` arrow in a parameter annotation, or an ascription), it refuses effectful functions by ordinary unification (§4.3). `memoize`-shaped functions get their purity guarantee from the type, with no new mechanism. On a face, `->` is exact: a `->` face over a body that may touch the world is an error (§4.2).

### 2.2 `->?`: only as effectful as what this signature is handed

A `->?` denotes the **join** of the colours of every callback the signature it stands in has been handed by the time that arrow runs (§2.4). In other words, the arrow is as effectful as any of those callbacks. This is the arrow of a function that runs what it is handed and touches the world through nothing else:

```text
fold : (Seq(a), b, (b, a) ->! b) ->? b
defer : (() ->! Unit) -> (() ->? Unit)
```

- `fold` is as effectful as its `combine`.
- `defer` builds a closure without running anything, so it is pure, and the closure it returns is as effectful as the action it was handed (§3.3).

"By the time that arrow runs" reads a curried face step by step. In `(a: () ->! Unit) ->? ((g: () ->! Unit) ->? Unit)`:
- the first `->?` is `a`'s colour, since `g` has not been handed over when the first application runs;
- the second `->?` is the join of `a`'s colour and `g`'s.

An arrow in a component of a result (a tuple's or a record's function, say) runs only after the applications that produced the result. So it depends on the callbacks those applications were handed.

**`->?` is a type-only spelling.** Calls are bare or `!` (§3.1), and a declaration's header never writes its outer arrow (Functions §4.1). So an ordinary function, even an exported one, never writes `?`; hover shows its `->?` (§10). `->?` is written where a function type is written whole:
- a function-valued return annotation (`let defer(action: () ->! Unit): () ->? Unit = …`);
- a binding annotation or an ascription whose type is a function with callbacks of its own;
- a lambda's own return annotation;
- a constraint member header (§13.4);
- an extern callable row (§6.1).

#### 2.2.1 Something must be handed: the inlet rule

`->?` is legal **only where the join it denotes contains at least one callback's colour**: somewhere at or before the application that arrow belongs to, the signature has a callback parameter whose own arrow is written `->!` (§2.4). A callback written `->` has no colour, so `(f: () -> Unit) ->? Unit` has nothing to depend on. The test is syntactic. It reads written parameter types, and a parameter with no written type is not a callback for this rule (§3.4). Everywhere else, a `->?` is refused (§4.4) and never given a second reading:

- **a face with no callbacks** by the time the arrow runs:
  - `(seed: String) ->? Int`;
  - the first arrow of `(n: Int) ->? ((cb: () ->! Unit) ->? Unit)`;
  - a header whose parameters are all untyped or data (`let defer(action): () ->? Unit` is refused: write the parameter's type);
- **inside a parameter type**, the callback's own arrows included. A callback's arrow is its colour and is written `->!` or `->` (§2.4), so the fixit is `->!`;
- **a data field** (§2.5) and **a `type` alias body** (Declarations Preamble §5.1.1). Neither has a signature, so nothing is handed to them;
- **an annotation that is not a function type with callbacks of its own**:
  - a non-function binding annotation;
  - an `extern let` (FFI Part 4 §4.5's posture: it declares a foreign value, not a callable row);
  - a **local** annotation, ascription, header or lambda annotation that has no callbacks of its own, whatever the enclosing function has. A local `->?` never borrows an enclosing function's colour. A local binding that should follow the enclosing function's callbacks leaves its type to inference, and `let g = action` does (§3.4, §10).

The rule's shape is the call side's. A mark with nothing to report is an error, not a re-reading (§4.1), and a `->?` with nothing to depend on is refused for the same reason. **One spelling, one meaning, everywhere it is legal.** Where the meaning is unavailable, there is a diagnostic rather than a substitute.

### 2.3 `->!`: may touch the world

`->!` is one token (Lexer §8.1). The bang trails the arrow, matching the call mark's postfix position; `!->` is not a token and cannot become one (Lexer §8.2). It has one meaning, *may touch the world*, read in two ways by position:

- **On a callback parameter's own arrow** (§2.4), `->!` is that callback's colour. The parameter **accepts any function**, and the function that takes it is as effectful as what it is handed wherever it runs it:

  ```text
  let run(action: () ->! Unit) = action!()
  run : (() ->! Unit) ->? Unit
  run(() => ())        -- bare: the action handed is pure
  run!(save0)          -- the action handed may touch the world
  ```

- **Everywhere else**, `->!` is the **impure constant**. That covers:
  - the outer arrow a face writes;
  - a result type;
  - a data field;
  - an arrow in a callback's own parameters;
  - an arrow under a type constructor, in a tuple or in a record written inside a parameter type;
  - a boundary row's outer arrow.

  What stands there may touch the world, and a call through it wears `!`.

Either way, any function fits: a callback's colour takes what it is handed, and the constant is the top of the lattice (§2.6). A face writing `->!` over a body that performs no effect is no error. It reserves the right to touch the world (§4.2).

### 2.4 One colour per callback parameter

A **callback parameter** is a parameter, of any arrow on the signature's application spine, whose written type is a function type, directly or through a transparent alias (Declarations Preamble §4). The spine is the chain of arrows reached from the signature's root through results.

- **Each callback parameter whose own arrow is written `->!` has a colour of its own.** It is quantified with the signature, like a type variable, and instantiated fresh at every call. `apply2(f: () ->! Unit, g: () ->! Unit)` has two colours. At a call, each argument decides its own: inside `outer(action: () ->! Unit)`, `apply2!(action, () => ())` is as effectful as `action`, and the pure function constrains nothing.
- **The colour lives on the arrows of the callback's own function type.** That means the arrow the function calls, and the arrows of any function the callback returns. `step: () ->! (() ->! Unit)` carries one colour on both arrows. A callback written `->` is pure and has no colour.
- **Every other arrow inside a parameter type means exactly what it says** (§2.3's constant reading):
  - **An arrow in the callback's own parameters** describes a function the body hands to the callback. `k: (() ->! Unit) -> Unit` demands a `k` that accepts a function that may touch the world. A body that hands `k` only pure functions writes `k: (() -> Unit) -> Unit`.
  - **An arrow under a type constructor, in a tuple or in a record** is a constant. `actions: Vector(() ->! Unit)`, `onDone: Option(() ->! Unit)` and `h: { step: () ->! String }` all hold functions that may touch the world, so a body that runs one is effectful: `runAll(actions: Vector(() ->! Unit))` wears `!` at every call. The idiom for an optional callback is a plain callback parameter, to which callers with nothing to do hand `() => ()`. A pure function fits (§2.6), and the call stays bare.

  So a face is exactly what it accepts. At a callback's own arrow, `->!` accepts any function whether or not the body follows it, and every other arrow inside a parameter is the constant it spells.
- **A function's colour is a join.** A body that runs several callbacks is as effectful as any of them (§3.4), and a written `->?` is the join of the callbacks handed so far (§2.2). A join is pure when every part is pure and impure when any part is. At a call, it is the join of what each argument brought: `apply2(noop, noop)` is bare, and `apply2!(noop, save0)` is not.
- **A finished face depends on all of its callbacks or on none of them.** Where a binding generalizes, each colour on its face that depends on some of the callbacks handed by the time it runs is **widened** to depend on all of them. That is the colour a written `->?` there denotes. The callbacks' own arrows are the colours themselves, and are not widened. Colours captured from an enclosing function (§3.4) are that function's, and are not widened either. Every occurrence the caller receives is widened together, so the face stays consistent: what a caller may put into a returned value is what that value's functions are said to run. Widening claims more effect of what the caller receives, as a face may (§4.2). For example:

  ```text
  let later(a: () ->! Unit, b: () ->! Unit) =
      a!()
      () => b!()
  later : (() ->! Unit, () ->! Unit) ->? (() ->? Unit)
  ```

  `later(noop, noop)` and a call of the closure it returns are both bare. `later!(noop, save0)` wears `!`, and so does its closure's call.

### 2.5 Data-field arrows: constants only

A function-typed field of a `record` or `union` declaration carries `->` (a pure field) or `->!` (a field that may touch the world), and means it. **A data declaration has no signature, so nothing is handed to it**, and a `->?` there is refused (§4.4), with the fixit `->!`. A record *type* written inside a parameter annotation is data in the same sense: its arrows are constants (§2.4).

This is the sentence `Stream` stands on. `Stream(a)`'s field `next: () ->! Option(a)` is pull-impure by declaration (`stream.md`), and `Seq(a)`'s field `pull: () -> Option((a, Seq(a)))` is pure by declaration. That is the two-type split of §7.

### 2.6 Values wear no colours

- **Lambdas are always written with the term arrow `=>`**, pure ones included (Functions §3.1). A lambda's colour is inferred from its body. There is no pure-asserting term arrow.
- **A function's colour is what its body does**, a lambda's exactly as a named function's. It is decided when the body closes, or, where the body is held for a colour decided later, at that colour's deadline (§3.4), before any demand, argument or branch meets it. A demand is then checked against that colour, never used to choose it. The one place a mark decides a colour is a parameter with no written type, where the call marks are the only text there is (§3.4).
- **A function the text decides fits wherever a function is expected.** Each use reads its outer arrow as its colour **or more**: the colour joined with a fresh *slack* colour, which the seat it meets decides by unification (§3.4). So:
  - **a pure function fits anywhere.** `apply2!(action, () => ())`; `Button({ onClick = () => () })` under `onClick: () ->! Unit`; and `if flag then save0 else () => ()`, which is typed `() ->! Unit`;
  - **any function fits `->!`.** A lambda that runs two callbacks, stored in `Holder`'s field `run: () ->! Unit`, is accepted, and the field keeps its constant.

  The function's own colour is untouched, and hover shows it. The fit is made at each use, not on the function, and it is an instantiation, not a subsumption (§1).
- **The reverse stays refused.** An effectful function where purity is demanded is an error (§4.3).
- **A face a function writes for itself may claim more effect than its body performs, never less** (§4.2). `let h: () ->! Unit = () => ()` is `->!`, and its calls wear `!`. A `->` face over a body that may touch the world is refused.
- **References are colourless.** A name, a field access or a stored function carries no mark (no argument list, no mark: §3.2). Storing a function that may touch the world is not an effect; calling it is.
- **The term-level purity demand is the ascription** `(f : a -> b)`, rigid per the Ascription spec. A signature demand (`->` in a parameter annotation) refuses effectful arguments by unification. There is no other demand form.
- **The two levels share no token, so a lambda's return annotation needs no parenthesization rule.** `=>` is a term arrow and the `->` family is a type arrow, so the annotation grammar can be right-associative and greedy without hazard (Functions §4.1):

  ```text
  (x): A ->! B => body      -- annotation `A ->! B`, body `body`
  (x): a => y => x          -- annotation `a`, body `y => x`
  ```

## 3. Calls: two marks

### 3.1 Bare and `!`

Every call wears one of two states:

```text
f(x)      bare: this call is pure
f!(x)     this call may touch the world
```

**The required mark is computed from the callee's outermost colour at this instantiation.** Pure means bare. Anything else means `!`: the impure constant, a callback's colour, a join of callback colours, a captured colour, or a knot sibling's colour once the knot has solved it to anything but pure. The teaching model is that **every call is a pipe**, clean or possibly dirty. A function that reads the world is a *source*, and one that runs what it was handed is a *conduit*. At the call, both wear `!`. The difference shows on the enclosing function's face: a source is `->!`, and a conduit is `->?` (§3.4).

A `!` promises no effect. Inside `run(action: () ->! Unit) = action!()`, the call touches the world exactly when `run`'s caller handed it an action that does. The mark reads the same as it does at a call to `save`. **The marks are the arrows' marks** (§2): a call and the callee's outer arrow say the same thing at this instantiation.

`?` is not a mark, and not a token (Lexer §8.3): `f?(x)` is an unexpected character. The one mark is the Swift gesture: `!` in `try`'s place, meaning "this line may touch the world".

### 3.2 The mark's anchor is the argument list

A mark governs **an argument list**, whatever the callee expression:

```text
save!(document)          -- ordinary call
(source.step)!()         -- parenthesized field access, then a marked call
document.show()          -- a dot call marks its own argument list (bare here: show is pure)
stream.next!()           -- dot call, marked
maker("s")!(document)    -- each argument list marks its own call
```

- **The mark is written glued on both sides**: against the callee expression it follows, and against the `(` it governs (Lexer §8.1). A floating mark reads as an operator, and no such operator exists: `readLine ! ()`, `readLine! ()` and `readLine !()` all take §9's mark-position error. Dot calls (Method Syntax §2.1) and the `(e.name)(…)` opt-out each anchor the mark to their own list, and a chain marks each link for what that link's call is.
- **A pipe stage is a call, so it takes a mark.** In `x |> save!`, the bare-stage form's mark stands glued at the end of the stage, and the rewrite carries it onto the call it builds: `save!(x)`. Operators §8 owns the rewrite. A stage with its own argument list marks that list as usual (`x |> take!(3)` becomes `take!(x, 3)`).
- **A suffix construction anchors its mark after the pattern name**: `(x)name!` (Pattern Declarations §14). It reports the build call's outer colour at this instantiation. The suffix owns an immediately trailing mark, so `(x)factory!(y)` marks the construction and then calls its result bare; `((x)factory)!(y)` marks the call on the constructed function instead. Matching remains unmarked.
- **A mark anywhere else** (on a reference, or mid-expression) is a parse error (§9). A reference carries no colour.
- **A dot call whose goal defers to its owner region's deadline** (Method Syntax §3.1) anchors its mark to the same argument list, read off whatever colour the deadline produces. A goal that falls to the imposed row (Method Syntax §3.5) is a pure call: the imposed row's arrow is written `->` there, and a row is data (§2.5). So a mark on such a call is refused like any other mark on a pure call, and the effectful reading needs an annotation on the receiver.

### 3.3 The outermost arrow: a mark describes this call only

**A mark speaks about the colour of the outermost arrow of the callee's type, at this instantiation, and nothing more.** A call whose *evaluation* touches nothing is bare, whatever it returns:

```text
let wired = compose(save2, audit2)    -- bare: evaluating compose builds a closure
wired!(document)                      -- the composite's own invocation is the effect
compose(save2, audit2)!(document)     -- both in one expression: outer call bare, inner list marked
```

Evaluating `compose` allocates a closure and touches nothing: its body runs no callback, so its own colour is pure (§3.4's third arm), and the call is bare even when the composite it returns is effectful. The effect surfaces where the composite is *invoked*, and the mark surfaces with it. Each argument list is marked for the arrow it discharges. The same holds of every closure builder, including `defer(action)` and `Stream.map(randoms, double)` (`stream.md` §4.2):

```text
let defer(action: () ->! Unit) = () => action!()
defer : (() ->! Unit) -> (() ->? Unit)       -- defer is pure; the closure follows the action
defer(() => ())()                            -- both calls bare
defer(save0)!()                              -- the closure's call may touch the world
```

### 3.4 Colours are type variables

The colour component rides the ordinary machinery (unification, levels, generalization; Functions §8), with no parallel solver.

- **A colour is pure, impure, a variable, or a join of variables.** Joins are kept normalized:
  - pure parts drop out;
  - an impure part absorbs the whole join;
  - nested joins flatten;
  - repeated parts merge;
  - a join of one part is that part.

  A callback's colour, the slack a use adds (§2.6), and a body's colour while it infers are all variables.
- **Unification of joins uses one small fragment.** Where a join meets a colour:
  1. **A join meeting pure** makes every part pure.
  2. **A join meeting the impure constant** gives the impurity to its slack, where it has one.
  3. **A join meeting a free variable** binds the variable to the join. A variable `x` meeting a join that contains it, `x`-or-`r`, says only that `r` is at most `x`: a remainder of slacks each takes `x`, and otherwise `x` is rebound to a fresh variable joined with `r`, the most general answer.
  4. **A join meeting a join** cancels the parts they share. Where one remainder is a single slack, that slack takes the other remainder. Where both remainders hold a slack, one fresh slack is shared between them.

  Everything else is a **hard case**, and hard cases wait. The equation is recorded, and it lowers its parts to the outermost level among them, so none of them generalizes early. It is settled where that level closes:
  - it is satisfied if the colours have since made it true;
  - it is the ordinary refusal if its constants contradict;
  - otherwise every part still undecided becomes the impure constant.

  That last answer is the one Swift gives a function it cannot follow (§11). Settling late is what keeps the answer independent of line order. Making a part impure the moment the case appears would refuse a program whose later line makes another part pure, and accept the same lines in the other order.
- **A body's colour is settled at its close.** A declaration's own colour and its calls' colours are decided when its body closes, not at module end: under end-of-module settling, a module-internal call to a not-yet-generalized neighbour would see a colour that is not yet solved. At a body's close, in order:
  1. the three arms run (next bullet);
  2. the hard cases whose level closes there settle (above);
  3. what nothing claimed defaults pure: slacks only other slacks reached, the body's own colour, its unclaimed untyped parameters' colours, and its calls' undetermined colours (the bullets below);
  4. its untyped callbacks are finished (below).

  Where the binding generalizes, the dot-call goals its region owns settle next (Method Syntax §3.1), then the bodies held for them settle by the same four steps, then the faces widen (§2.4), and then the scheme is built. Mark obligations are read once every colour they depend on has settled.
- **A body that uses a colour decided later than its own close is held until that colour's deadline**, as a knot holds a lambda. There are four such colours:
  - **a knot sibling's**, decided at the knot's close (the knot bullet below);
  - **a pending dot call's**: a dot call written in the body whose goal is still waiting when the body closes, decided at that goal's owner region's deadline, right after the goals settle. The goal's call may be the one that makes the body a source;
  - **an open subject's**: a member call whose subject type is still open when the body closes, decided when the subject variable's level closes. By then it is a call at a known instance, which follows that instance's face, or the variable has generalized and the call is generic, which follows the contract (§13.3);
  - **an instance's**: a call at a known instance whose honor has not settled, decided when the module's honors settle (§13.3).

  A held body's colour and its calls' colours are decided at the deadline, after what they wait for, by the steps of the previous bullet. A body that calls a held body joins its hold, and one that reaches several holds waits for all of them. A held colour stands at the hold's level, so nothing inside the owner generalizes it meanwhile: its uses share one colour until it settles. A demand it meets meanwhile is recorded, never choosing it, and is compared once it settles, so a refusal stands at the demand. At every deadline, types settle before colours. Dispatch reads a receiver's type, never a colour, so the staging cannot loop.
- **A body's own colour is solved by three arms, in order.**
  1. **A source.** A body that calls a callee whose colour is the impure constant is a source. Its own colour is the impure constant. If its written face is `->`, that is §4.2's pure-face error, at the offending call.
  2. **A conduit.** Otherwise, a body that calls callees whose colours are variables or joins (a callback's, a captured one, a sibling's) is a conduit of them. Its own colour is **the join** of what it runs: `run(action) = action!()` is `->?`, and a body running `f` and `g` is as effectful as either.
  3. **Unconstrained.** Otherwise the body's colour **defaults to pure before generalization, whatever its callbacks**. Constructing a closure that will run a callback is not running it: `store(callback: () ->! String) = 1` is `(() ->! String) -> Int`, and `defer` is pure (§3.3).

  The defaulting runs after the body's dependencies are resolved (its callees settled, its conducted colours joined) and before its scheme is built. That is at body close for a lone binding and for every lambda, and at the knot's close for a `fun` block member (below). At a constraint seat it runs after the comparison (§13.2).
- **What the defaulting never touches is a dependency.** There are four:
  - a callback's colour, whether written or claimed by a mark (next bullet). It generalizes with the binding, which is what keeps `store` polymorphic;
  - a body's colour once conducting has joined it;
  - a colour a written `->?` has joined. `let f: (() ->! Unit) ->? Int = (action) => 1` keeps the face it writes;
  - a knot member's colour once a sibling call has joined it.

  The defaulting reaches only what nothing has claimed.
- **A parameter with no written type is decided by its call marks.** A parameter the body uses as a function, with no written type, has a colour of its own. A `!` call **claims** the colour of every such parameter that flows into it, as a written `->!` on the parameter would: the parameter called, a value made from it called, or the parameter handed to one of the callee's callback parameters. A colour no `!` call claims is pure where the body settles, so a bare call on it is pure. Anything that decides the colour otherwise wins as it would against a written type: a `->` demand, a data field, a written annotation. A claimed colour is a callback's colour from then on: it is a dependency, it generalizes, it displays `->!` (§10), and a bare call on it is the ordinary missing-mark report. For example:

  ```text
  let twice(f) =                                -- (() ->! Unit) ->? Unit
      f!()
      f!()
  let twicePure(f) =                            -- (() -> Unit) -> Unit
      f()
      f()
  let fwd(x, cb) = apply2!(x, cb)               -- (() ->! Unit, () ->! Unit) ->? Unit
  let fwdPure(cb) = apply2(() => (), cb)        -- (() -> Unit) -> Unit
  ```

  A claimed colour that something else then pins pure (`pinned(f)`, which hands `f` to `pureOnly` and then calls `f!()`) is pure. The `->` demand decides it, and the `!` call draws the ordinary mark report, "this call is pure, so `f` wants no mark"; there is no written arrow for a lie-of-generality report to name. Claims are read from the marks, which are written, and the defaulting runs only once the body settles, so neither the verdict nor the report depends on the order of the lines.
- **An untyped callback is finished as a written one reads.** Where its body settles, each untyped parameter's inferred function type is finished to the shape a written type has:
  - its own arrows carry its own colour, independent of every other callback's, so a tie a merge made (`if c then a else g`) is released;
  - every other arrow inside it (its own parameters, anything under a type constructor) whose colour is still a variable becomes the impure constant.

  Both steps claim more. They stay sound for the reason widening does (§2.4): everything the caller receives, including the finished face's own result, depends on all of the callbacks. So the displayed face is exact (§10). `relay(f: () ->! Unit, g) = g!(f)` is `(() ->! Unit, (() ->! Unit) ->! Unit) ->? Unit`, exactly as with `g`'s type written, and `relay(noop, pk)`, for a `pk` that accepts only pure functions, is refused.
- **A function the text decides is re-opened where it is used.** Where a function value is used (handed as an argument, stored in a field or a literal, returned, or joined by a form), its outer colour is read as that colour joined with a fresh slack, unless the colour is the impure constant, which has nothing above it. The seat the use meets decides the slack by the unification above: a callback's colour, a written `->?`, the impure constant, or pure. A callee is applied rather than handed anywhere, and is not re-opened.

  The function's own colour is untouched. It is what its body does (§2.6), and it is what hover shows. A slack that only other slacks reached is no information: it is pure where its level closes, at a body's close or at the generalization of the binding whose right-hand side minted it. That includes the colour of a parameter with no written type whose type met only openings. So a slack never reaches a scheme. Three limits keep this exact:
  - **Only a colour the program's text decides is re-opened.** It is read from syntax and declarations, never from where inference stands at the use, so no verdict follows the order the lines come in. The text decides:
    - a lambda's colour and a named function's, which is what the body does, decided where the body closes (§2.6);
    - a name with a written type, written whole (no hole, no implied type, no open record row): a parameter's, a `let`'s or an ascription's;
    - a name no local binding introduces: a module's, an import's, a constructor, an extern;
    - the untyped parameter of a lambda written as a call's argument, where the callee is itself so decided and its generalized signature writes that parameter's type whole, with no variable an argument or a later line could fill. A member of a knot still open has no generalized signature, so nothing lands from it until the knot closes;
    - a value **made from the text**: a `let`'s right-hand side, a call, a field read, or the part of a value a pattern takes apart, where every name it uses and does not bind itself is so decided. A call counts if the function called has a written result arrow that is a constant, or if every value path of its body is a lambda, whatever that function captured or is handed.

    The following are **inferred from their uses**, and every use of one is ordinary unification:
    - a parameter with no written type and no such signature;
    - a `var`;
    - everything made from one of those (an alias, a destructure, a match, a field, a call's result, a function that returns it).

    So a use that needs such a value pure pins it (§4.2), and a use beside a callback's colour, before the pin or after, meets that pin. A binding whose type, where it is bound, keeps a part no generalization settled (`let m = JsMap.fromSeq(Seq.empty)`, whose value type the lines after it fill) is inferred from its uses too. A use does not re-open it where that part is its outer arrow, and nothing made from its parts is decided.

    A `match` whose scrutinee's type is unsettled where the match reads it makes every arm's pattern variables inferred, whatever order the arms come in. A value written in place as a `match` scrutinee or a `for` iterable is read at the form's own level, not settled as a `let`'s right-hand side is. So its openings are still open where the form reads it, closing only where the body or the binding around it settles:
    - a `match` over it makes every arm's pattern variables inferred, including any part holding no opening;
    - a `for` makes a loop variable inferred where the variable's own type holds an opening.

    Two uses that decide such a part's colour differently then meet, where the same value bound by a `let` would first fit.
  - **Only the outermost arrow is re-opened.** A function already held inside a value keeps the type the value was built with: `let p = Some(noop)` joined with `Some(save0)` meets a constant it cannot weaken (§4.3's reverse sentence), while `Some(noop)` written in place fits.
  - **A knot's colours are re-opened at its close.** A sibling's own colour, or a held lambda's, met as a value while the knot is open (at a demand, a field or a join) fits there once the knot's close has decided it.

  This is Koka's re-opening at instantiation and closing at generalization, over a two-point lattice with joins. It is instantiation, not subsumption (§1). Colours erase (§8), so nothing is inserted at the use.
- **A captured colour never generalizes at the binding that captures it.** Levels decide (Functions §8). An enclosing function's callback colour belongs to the enclosing body's environment, so a nested binding whose face carries it quantifies its own variables and leaves that one free. `fun h(): Unit = action!()` inside `outer(action: () ->! Unit)` has `outer`'s colour, and pinning `h` pins `outer`'s callback. A nested helper that runs a captured colour and callbacks of its own has the join of them. Widening (§2.4) reaches only its own callbacks. Display names the owner of a captured colour (§10).
- **The defaulting clause at calls.** A call's colour still undetermined when marks are checked defaults to **pure** (bare), in every body, with one exception: a held colour (the hold bullet above), which the clause never pins. Everywhere else, a callee's undetermined colour is a fresh instantiation of an unconstrained variable, which nothing binds. Pinning it pure weakens no face, because no face depended on it.
- **Knot colours and obligations settle at the knot's close.** Within a `fun` block's strongly-connected component, a sibling's colour is a not-yet-generalized monotype (Functions §7.4), and recursive calls share it. A call to a sibling may meet a colour that is undetermined now and solved by a body not yet checked. The colour is left as it is, and the call's mark obligation is **recorded and settled when the knot closes**.

  The knot's close runs the arms over the whole component, stratified, each to a fixpoint, before anything defaults:
  1. The **source arm** first. A member whose sibling call reaches a source is a source in turn, until no member changes.
  2. Then the **conduit arm** over what remains. A member whose sibling call reaches a colour the knot has joined to callbacks is a conduit of it, its colour the join.
  3. Then the colours still unconstrained default pure.
  4. Faces are widened (§2.4).
  5. Only then are the recorded obligations read, against the widened faces, so a sibling call and an outside call to the same member wear the same mark.

  Source before conduit is what makes the answer independent of the members' order. The close needs no re-inference: it is a closure over the sibling-call edges the bodies already recorded.

  A lambda written inside a member whose calls reach a sibling's colour is held by the knot as a member is. A demand met by any colour of the knot while it is open is held and compared after the defaulting, so the demand is what a refusal names. For example:
  - `a(cb: () ->! Unit) = b(cb)` beside `b(cb: () ->! Unit): Int = if True then 1 else a(cb)` is two bare calls and two pure faces;
  - `even`/`odd` passing a callback down and calling it at the base are conduits, with `!` on the sibling calls as on the callback;
  - a sibling that turns out to be a source makes every member that calls it a source.

  A sibling pinned pure by a `->` demand, which the source arm then claims, is §4.3's refusal at that demand. Generalization is still per member at its SCC (Functions §7.3, §7.4, §8). A knot nested in a body captures as a lone binding does.
- **Expected types carry the colour too** (Functions §4.3). An expectation's arrows arrive with their colours as ordinary components. A lambda's own colour is still inferred from its body (§2.6), and nothing colour-specific is added or bypassed. There are two exceptions, each because colours are compared afterwards instead of unified where the expectation arrives:
  - At a constraint member's honor seat, the expectation's colours are replaced by fresh variables before propagation (§13.2).
  - An expectation carried into a literal form's components or a constructor application's arguments, or handed through a forwarding form to its value paths, reaches a lambda literal among them whole: each unannotated parameter takes its component, colours included. Every other value, and the constructor's own result, meets it with its colours replaced by fresh variables. The types meet at the value's turn, and the colours meet where the whole literal, application or form meets its seat, a form's paths merging theirs at the form first.

  A report that shows such a type while a replaced colour is unsolved shows the colour written.
- **Every occurrence walk counts the effect slot**, at the arrow's own sign, and a join's parts are occurrences. A colour is a fact about invoking the function, which is what the result position already means, so a parameter arrow's colour is contravariant with the parameter arrow. Skipping the slot makes every colour variable read as absent to the variance analysis (`decisions-ml-dialect-generalization-2026-08.md` §4.1, §6.2), which would pin faces monomorphic that the arms above keep polymorphic.

## 4. Enforcement is symmetric, and error-grade

### 4.1 At calls: two directions, one-token fixits

The required mark at a call is computed from the callee's outermost colour at this instantiation (§3.1): pure means bare, and anything else means `!`. A colour still undetermined when the mark is checked is pure (§3.4's defaulting clause). A knot sibling's colour is checked at the knot's close. **Any other mark is an error, including a mark on a provably pure call.** A tolerated-but-wrong mark would rot into noise; symmetric enforcement is what keeps silence meaningful. The two directions share one frame, each with a one-token fixit:

> this call may touch the world, so `save` wants `!`, not no mark

> this call is pure, so `next` wants no mark, not `!`

A failed constraint seat holds back mark reports on the colours it condemned (§13.2).

### 4.2 At faces: never less than the body does

This section governs an implementation's **own written face**: a return annotation, a binding annotation, a parameter's arrow, an ascription (Functions §4.1; the Ascription spec). A constraint member header is a contract, not a face of the instance bodies beneath it, and §13 owns that seat. A face such a body writes for itself is checked here as any face is.

**A written face may claim more effect than the body performs**: a `->!` over a body that performs no effect, or a `->?` over a body that runs fewer of its callbacks than it is handed, or none. It **may never claim less.** What claims less is an error:

- **A `->` face over a body that may touch the world** is reported at the offending call: "this call may touch the world, and the enclosing function's face is the pure arrow `->` — a pure face cannot run effects". The span names which call broke the promise.
- **A `->?` face over a body that touches the world on its own account** is reported at the offending call: "this call touches the world on its own account, and this face's `->?` promises the function is only as effectful as what it is handed — write `->!`". There is a label at the `->?`, and a fixit rewriting it to `->!`. A body that runs a colour the signature is not handed (a captured one, §3.4) takes the same report, its clause reading "this call runs `outer`'s `action`, which this signature is not handed".
- **A callback written `->!` over a body that accepts only a pure one** is the **lie of generality**. The face promises every caller that any function is accepted, and the body accepts only a pure one, typically by handing the callback to a `->` demand. It reads "the parameter `f` is written `->!`, which accepts any function, and this accepts only a pure one — write `f`'s arrow `->`". The report's primary span is the **pin**: the demand, annotation or supplied argument whose unification made the colour pure. There is a label at the parameter's `->!`, and a fixit rewriting it to `->`.
  - At an argument, the pin is the argument handed, whole: a literal or a constructor application is one value, callbacks inside it included. A decided function handed as an argument pins nothing, because it is re-opened where it is used (§3.4).
  - At an annotation, the pin is the side that brought the constant. It is the annotation where it writes the constant (`let p: () -> Unit = action` stands at the annotation), and the value where it writes the colour (`let g: (() ->! Unit) -> Unit = pureOnly` stands at `pureOnly`).
  - One report stands however many signatures share the colour, because a captured colour can be several nested faces' colour at once (§3.4).

A body that fixes a callback's colour impure draws no report. The parameter still accepts any function, and the face the function publishes, now `->!` where it would have followed with `->?`, says so. A face that claims more is an allowance, as it is at every position a function fits (§2.6) and under a constraint member's contract (§13.1). A stub written against the face it will have, `let fetch: (Id) ->! User = (id) => guest`, is accepted, and its callers already wear the `!` its finished body will need.

### 4.3 The pure demand

An effectful function meeting a `->` demand is an ordinary unification failure with a dedicated report:

> a `->` arrow promises purity, and this function may touch the world — the demand is written `->`, the function's face `->!` or `->?`

This is the whole enforcement of `memoize`-class contracts and of `Seq`'s §7 posture; nothing beyond unification is involved. A declared pattern's `view` is one more seat of the demand. It writes no `->` (the head carries no arrow), so it takes a clause of its own: "a pattern's `view` is run by matching, so it is pure — the demand is the pattern head's, and this function's face is `->!` or `->?`" (Pattern Declarations §2.1, §5).

**The reverse direction is no failure.** A function where the impure constant stands fits (§2.6), and the position keeps its constant. A pure arrow meets the constant and fails only where it was fixed before it arrived:
- nested inside a value already built, since a use re-opens the outermost arrow alone (`let p = Some(noop)` joined with `Some(save0)`);
- a colour inferred from its uses that one of them pinned, which no use re-opens (§3.4).

The report above speaks of a written `->` *demand*, and here the demand wrote no `->`, so the reverse report says what is true:

> this position's arrow is the impure constant, and the pure `->` meeting it was fixed before it arrived — inside a value already built, or by another use — so it cannot fit as a function used here does; write the arrow where it was fixed

**At a parameter's arrow, the two roles turn over.** The arrow a function writes on its parameter is its demand on what it is handed, and the arrow the position writes there is what the position will supply:
- A **callback's** arrow is its colour, which accepts either, so no function fails there for its callback's colour alone: `let g: (() -> Unit) ->! Unit = run`, with §2.3's `run`, is accepted.
- The constant arrows inside a parameter type (a callback's own parameters, and arrows under a constructor; §2.4) meet by ordinary unification. A mismatch there draws the first report where the side writing `->` is demanding purity of what it will be handed, and the reverse where the side writing `->` is what will be supplied.

A constraint member's contract is neither direction of this section. An instance is **compared** against it, not demanded (§13.2).

### 4.4 Where `->?` is refused, and what a refusal reads as

A `->?` written where §2.2.1 does not admit one is an error at the arrow, never a re-reading of it. The report names the position's reason and offers `->!`, because that is what the writer almost always meant:

> `->?` means only as effectful as what it is handed, and nothing is handed here — a `record` field is data, not a signature; write `->!` for a function that may touch the world, or `->` for one that does not

Each refusing position has its own middle clause, and §9 tabulates them:
- a `union` field says `union`;
- a `type` alias says "an alias is a type fragment, not a signature";
- a face with no callbacks by then says "no callback of this signature has been handed over by the time this arrow runs". It adds "write the parameter's type" where the signature's only candidates are untyped parameters, and FFI Part 4 §4.5's advice at an extern callable row;
- a non-function annotation, or an `extern let`, says "this annotation is not a function signature";
- a local annotation says "this annotation has no callbacks of its own, and a local `->?` does not borrow the enclosing function's — leave its type to inference, or write `->!`".

A `->?` inside a parameter type takes one of two frames. On a callback's own arrow it reads "a callback's arrow is its own colour, spelled `->!` — it accepts any function, and the function follows it — or `->` for a pure one". Anywhere else inside a parameter type (in a callback's own parameters, or under a constructor), the ordinary frame's clause is "an arrow inside a parameter type, other than a callback's own, is a constant". The fixit is `->!` in every case. A writer who wanted purity reaches for `->` without prompting.

**A refusal reads as its fixit, unmarked:**
- a `->?` on a callback's own arrow reads as that callback's `->!`, its colour;
- a `->?` anywhere else reads as the impure constant `->!`.

Nothing downstream is suppressed or re-read. Every further report is one the program with the fix applied also draws, and the refused arrow is an ordinary colour, so no verdict depends on the order its uses come in. A writer who meant `->` where the fixit writes `->!` sees, until they write it, the mark reports a `->!` there implies.

## 5. Calls with no mark seat

Four call forms have no position for a mark, by grammar:

1. **Operator applications.** `x + y` elaborates to a constraint member call (Operators §1.1) with no bang position. `x +! y` is not grammar, and negation is the word `not`.
2. **Bracket indexing.** `xs[i]` is `at`, definitionally (Collections Part 3 §5).
3. **`for` heads.** `for x in xs` desugars through the iteration protocol (Loops §2.3, §7.1).
4. **String interpolation.** `"${x}"` renders its holes through `Show` (Primitive Types §5).

The consequence is a demand, not an accident: **everything these forms dispatch to must be pure.**

- **The members these forms reach are the prelude's, and every prelude member's contract is `->`.**
  - Operators elaborate to `Num`, `Signed`, `Frac`, `Pow`, `Eq`, `Ord`, `Concat`, `Integral` and `Bitwise` members; `for` heads to `Iterable.toSeq`; and interpolation to `Show.show`. All of this is by identity, never by spelling.
  - Every member of every prelude constraint writes `->` on its outer arrow and, as standard-library policy, on every arrow beneath it (Constraints §7 lists them).
  - Brackets elaborate to a compiler-known lookup rather than a member: `Vector`'s and `String`'s `at`, a companion operation the bracket form demands pure (Collections Part 3 §5, §9; §4.3), and `Map`'s keyed read over `Hash` (Collections Part 4 §4.1), pure by construction.

  That is a **compile-breaking standard-library constraint**, of the kind the prelude seat order already is: a prelude header written `->!` would put an unmarkable call on an effectful member. The conformance suite is to pin each header. An `honor` body under a `->` contract must solve pure (§13.2), and derived instances are pure by construction, because their generated bodies call members. A *user* constraint may declare an effectful member (§13); no unmarkable form reaches one, because no unmarkable form reaches a user constraint.
- **`Iterable` can never have an effectful instance.** `toSeq`'s contract is `->`, so every instance's body must solve pure. A type whose traversal performs effects cannot honor `Iterable`, and cannot stand in a `for` head.
- **`for` headers are never marked, and loop bodies may be impure.** The head is protocol, pure by the above. The body is a block, not a lambda, and its statements mark their own calls as usual.

## 6. The world's doors

### 6.1 The extern ownership split

Purity at a boundary declaration splits by **who owns the implementation**, and every boundary row writes the arrow the split is about:

- **Every callable boundary row writes its arrow** (`->`, `->!` or `->?`) between its parameters and its result, as a constraint member header does (§13.1). A row is a contract with no body to infer from. FFI Part 4 §4.5 owns the form. The arrows read as they read everywhere:
  - a row's callback parameter written `->!` has its own colour (§2.4);
  - a `->?` outer arrow is the **declared conduit**: only as effectful as what the row is handed;
  - a `->!` outer arrow is the constant;
  - a `->` outer arrow is a purity claim.
- **Compiler-owned intrinsic rows** (`extern from "hex:intrinsic"`) have their arrows **verified**. The compiler is the implementer and is held to the declared scheme, parametricity obligation included (Intrinsics §4.2). Nearly every prelude intrinsic row writes `->`; the two guarded property reads beneath `JsError.message` and `JsError.stack` write `->!` (FFI Part 11 §7). That is an inventory, not a rule of this section: an intrinsic row may write any of the three, and each is verified (vacuously at `->!`).
- **User-written rows have their arrows trusted.** A foreign function is trust territory (FFI Part 1 §3.1).
  - `->!` is the honest arrow for the unknown, and for a row that touches the world on its own account.
  - `->` is the **trusted purity claim**: believed, never checked, the module author answering for it. It is sound only under §6.2's species, or for a function that genuinely computes.
  - `->?` is the **trusted conduit claim**: the row runs its callbacks and touches the world through nothing else. Its callers' calls wear `!` exactly where what they hand it may touch the world.
  - A row unwilling to claim purity or a dependency writes `->!`.

### 6.2 The trusted-purity species

A `->` on a boundary row, user-written or intrinsic, whose implementation does touch the world is unsound, except for four shapes where the claim is *sound*, not merely customary. The ruling names them, so every future claim can be tested against one of them:

- **Species (a): unobservable world-writes.** A write-only channel the program cannot read back. That is never a foreign property write: a `set` row is the write capability it grants, and is declared `->!` regardless (FFI Part 5 §4.1), because a property the foreign side can read is not write-only from the world's point of view.
  - The debug probe is the member. A pure-faced `log` that writes to the console changes nothing any Hexagon expression can observe.
  - What it forfeits is multiplicity and ordering. Under the per-instantiation contract, a probe in a pure producer may print once, many times or never (a memoized `Seq` step prints once, however often it is traversed). Fine for debugging, and disqualifying for real logging, which belongs behind a banged extern.
  - **The caveat:** `console.log` is replaceable, and a replaced sink is a read path. A conforming debug probe captures its sink at initialization.
- **Species (b): owned, memoized, at-most-once world-reads.** A read the runtime performs at most once and then owns: the result is a value, and the world can no longer vary it.
  - `seqMemoize` is the member, and so is FFI Part 3's inbound adapter. Memoization makes the foreign iterator's mutability invisible (Part 3 §4): that is the launder that lets an effectful JavaScript iterable become a pure-faced `Seq` at the boundary.
  - The hash-table placement mix (`hashTrieMix`) is the third member. Its lowering reads the per-process placement seed (Collections Part 2 §2.4) at most once and owns it thereafter, so placement is a value function for the life of the process. That is precisely the within-execution iteration-order determinism §2.4 promises, and nothing more.
- **Species (c): reads of stable data.** A pure collection denotes stable contents, and a read of foreign data that cannot vary while Hexagon holds it is a read of a value. There are two shapes:
  - contents **captured at acquisition**: the snapshot semantics `Array` (FFI Part 2 §6.2) and `JsMap`/`JsSet` (FFI Part 10 §2) have under FFI Part 1 §2.2 and §5.4, whose `length`/`size`/element reads are then reads of a value;
  - data a **stability contract** binds the foreign side to hold still for as long as Hexagon may observe it, whose violation is an FFI Part 1 §3.1 contract violation like any other. A user row's `->` over foreign data (FFI Part 4 §4.5), or a `->` getter (FFI Part 5 §3.1), is such a claim, and is tested against exactly this: which contract holds the data still.

  What makes the face sound is the stability of the data, never a rule that forbids the compiler to share the read. A replayable read of data foreign code may vary is `->!`, which is where `JsError.message`/`stack` stand (FFI Part 11 §7). For a captured collection, the capture holds the *value* still, not the *source*: a `->` row returning one is a separate claim that the source does not vary between calls, and a row that cannot make it writes `->!` (FFI Part 1 §5.4).
- **Species (d): owned scratch.** A `->` intrinsic row whose lowering is a **compiled `->!` body of a runtime module**, writing to nothing but storage no program can address: buffers of a confined type (Intrinsics §3.3) that it allocates and no later call reads, storage it **freezes** before it returns, or an **owned memo** (the last two admissible on the terms below).
  - The linkage is the shape `Map`'s keys already take over `Hex.Runtime.HashTrie` (Intrinsics §3.4), whose bodies are pure Hexagon; the colour crossing is what this species licenses.
  - The rows of the confined type itself write the honest arrow: `Buffer`'s `create`, `read` and `write` are `->!`, and its `length` is `->`. The engine over them is `->!` wherever it touches a buffer's contents. Purity is claimed once, at the sealed row, never at the storage.
  - That is also why this species never meets §7: a sealed row that is a value function may be shared, hoisted or dropped like any pure call, and the `->!` code beneath it is never reordered at all.
  - The first members are `Regex.hex`'s `compileProgram` and `searchProgram` rows (keys `regexCompile` and `regexSearch`, `regex.md` §7) over `Hex.Runtime.Regex`. The program the first answers carries the two memos a compiled `Regex` owns: the lazy-DFA cache and the resolved classes.

**What a species-(d) row must prove** is that it is a **value function of its arguments**. Its three shapes discharge that differently:
- **Scratch** discharges it by construction: storage no later call reads cannot carry anything between calls.
- **Frozen storage** discharges it by construction too, one step on. Storage the row allocates and fills before it returns, and that no lowering writes afterwards (its memos excepted, on the memo terms next), is a value from the moment it is handed out. So every later read is a read of a value, and the fresh identity each call hands out is unobservable through any row: a confined type has no pattern and no derived instance, and has `Eq`, `Ord`, `Hash` and `Show` only where its own block declares the rows that honor them (Intrinsics §3.3), which a frozen-storage member's block does not. That is the difference between `Buffer`'s `create`, which is `->!` because a write to one fresh buffer and a read of another tells them apart, and `Regex.hex`'s `compileProgram`, which is `->` because nothing writes a program's frozen part. The construction is not an effect, exactly as building a record is none. The obligation it carries is the lowering module's, on every lowering: never write frozen storage again.
- **An owned memo** discharges it only by being *semantically transparent*. Every entry must be a value function of the key it is filed under, so that a hit and a miss are indistinguishable to every caller, and nothing the memo records is an observation of call history.
  - Confinement is the second half of that argument, not the first. It rules out interference from outside the named declarers, since the storage a value carries is addressable only from the modules the type's inventory entry names (Intrinsics §3.3). Transparency is what rules out the declaring module's own interference across calls.
  - A memo that cannot claim transparency is not this species, and its row writes `->!`.

**A species-(d) row runs no Hexagon code but its own lowering.** It takes no function-typed parameter of any colour, pure callbacks included, since a pure Hexagon function may call the row again. So nothing can re-enter it and observe storage mid-write, which is what makes "at most once" structural here rather than enforced, as it is at FFI Part 3 §7.3. A row that would need a callback is not this species.

**The caveat:** opacity is a TypeScript fact (FFI Part 7 §5). Foreign code holding an exported value reaches its representation, and mutating it is an FFI Part 1 §3.1 contract violation like any other.

Each species admits only what it names:
- Species (a) permanently excludes a pure-faced `random()` or `readLine()`: a read the program observes is never unobservable.
- Species (b) excludes any *replayable* read: replay is exactly what at-most-once forbids.
- Species (c) admits a replayable read only of data a contract or a capture holds still.
- Species (d) admits a lowering's writes only to storage no program can address, frozen storage only where nothing writes it again, and a memo only where it is transparent. The row over it is a value function of its arguments, or the claim is false.

The slogan survives these doors amended once: **silence means nothing the program can observe.**

### 6.3 What the claim costs

A trusted claim is per-module-author accountability, the same currency as every extern type. The compiler does not verify species membership. It verifies intrinsic rows (§6.1) and believes user rows. A claims audit belongs to review, not the checker.

## 7. The sequence posture

- **`Seq` is pure by construction.** Its field is `pull: () -> Option((a, Seq(a)))`, a pure thunk by §2.5. Every producer and combinator is pure, and building a pipeline is pure. *The five strict consumers* (`fold`, `forEach`, `find`, `any` and `all`) are the only doors effects enter through. Each takes a `->!` callback, and each is only as effectful as it: `fold : (Seq(a), b, (b, a) ->! b) ->? b`.
  - An effectful step function cannot be smuggled into a lazy pipeline at all: `Seq.unfold`'s producer is written `->`, so an effectful one is §4.3's refusal.
  - The `memoize` landmine (memoization observably changing how many times effects run, with no type-level story) is dissolved rather than patched. The producer position demands purity, and what remains for `memoize` to claim is species (b).
- **Effectful sequences are nominal siblings, never effect parameters.** The two-point lattice degenerates "a type parameterized by effect" into "two types". So Hexagon ships two types, on the Kotlin `Sequence`/`Flow` and F# `Seq`/`AsyncSeq` precedent, and no colour ever appears in a type constructor's arguments. `Stream(a)` is the pull-impure sibling: it has no tail, its field arrow is the impure constant, and its consumers are `->!` (`stream.md`, the owning spec). A push sibling (`Observable`) is future work; async is out of scope (§1).
- **The FFI gains a declared choice at the boundary.** A foreign iterable at a `Seq(a)` position takes Part 3's launder: adaptation plus at-most-once memoization, species (b), purity manufactured honestly. The same object at a `Stream(a)` position crosses raw, protocol to protocol, with no adapter and no memoization: impurity declared instead (FFI Part 3's `Stream` section).
- **The coupling that makes purity true.** Statements §6.2 (a lambda cannot touch an outer `var`) and §6.4 (no ref cells, no mutable fields) are what make a `->` face a *fact* rather than a convention. There is no mutable capture for a pure-faced closure to smuggle. That same fence is why a compiler may treat pure instantiations as free for fusion and reordering within the semantics those sections fix. The effects discipline leans on those sections, and weakening them re-opens this ruling. Statements §6.4's one exception, confined storage behind the intrinsic door (`->!`-faced at every row that touches its contents, and addressable by no program; §6.2 species (d)), weakens neither fence: no pure-faced closure can capture what no program can name.

## 8. Emission

Colours and marks erase. Arrows, `!`, and the trusted arrows on boundary rows exist for the checker and the reader. Emitted JavaScript is identical with and without them, and no runtime representation of colour exists. The debug probe's captured sink (§6.2) is the probe's own implementation detail, not a colour representation.

## 9. Diagnostics checklist (implementer-facing)

Messages are normative in shape.

| Situation | Error |
|---|---|
| Bare call, `!` required | "this call may touch the world, so `save` wants `!`, not no mark" + fixit: mark the call `!` (§4.1) |
| `!` written, call pure | "this call is pure, so `next` wants no mark, not `!`" + fixit: remove the mark (§4.1) |
| Non-identifier callee | The frame's subject adapts. A dot call is named by its member ("…so `.next` wants `!`…"), and any other compound callee degrades to "this call": "this call may touch the world, so this call wants `!`, not no mark" |
| `->` face, body may touch the world | "this call may touch the world, and the enclosing function's face is the pure arrow `->` — a pure face cannot run effects", at the offending call (§4.2) |
| Written `->?` face, body touches the world on its own account, or runs a colour the signature is not handed | "this call touches the world on its own account, and this face's `->?` promises the function is only as effectful as what it is handed — write `->!`", at the offending call, with a label at the `->?` and a fixit rewriting it to `->!`. The captured form's clause is "this call runs `outer`'s `action`, which this signature is not handed" (§4.2) |
| A callback written `->!` whose body accepts only a pure one | "the parameter `f` is written `->!`, which accepts any function, and this accepts only a pure one — write `f`'s arrow `->`", primary at the pin (§4.2's placement), with a label at the `->!` and a fixit rewriting it to `->`. One report however many signatures share the colour |
| Effectful argument at a `->` demand | "a `->` arrow promises purity, and this function may touch the world — the demand is written `->`, the function's face `->!` or `->?`" (§4.3) |
| A pattern's `view` that may touch the world | "a pattern's `view` is run by matching, so it is pure — the demand is the pattern head's, and this function's face is `->!` or `->?`" (§4.3; Pattern Declarations §2.1) |
| A pure arrow fixed before it arrived (nested in a value already built, or pinned by another use) meeting the impure constant | "this position's arrow is the impure constant, and the pure `->` meeting it was fixed before it arrived — inside a value already built, or by another use — so it cannot fit as a function used here does; write the arrow where it was fixed" (§4.3) |
| `->?` in a `record` field | "`->?` means only as effectful as what it is handed, and nothing is handed here — a `record` field is data, not a signature; write `->!` for a function that may touch the world, or `->` for one that does not" + fixit `->!` (§4.4) |
| `->?` in a `union` field | same frame, "a `union` field is data, not a signature" + fixit `->!` |
| `->?` in a `type` alias body | same frame, "an alias is a type fragment, not a signature" + fixit `->!` (Declarations Preamble §5.1.1) |
| `->?` where no callback has been handed by the time the arrow runs | same frame, "no callback of this signature has been handed over by the time this arrow runs", adding "write the parameter's type" where the only candidates are untyped parameters + fixit `->!`. At an extern callable row, the clause carries FFI Part 4 §4.5's advice besides (§2.2.1) |
| `->?` in a non-function annotation or an `extern let` | same frame, "this annotation is not a function signature" + fixit `->!` (a callable-intended `extern let` takes FFI Part 4 §13's row) |
| `->?` in a local annotation, ascription, header or lambda annotation with no callbacks of its own | same frame, "this annotation has no callbacks of its own, and a local `->?` does not borrow the enclosing function's — leave its type to inference, or write `->!`" + fixit `->!` (§2.2.1) |
| `->?` on a callback's own arrow | "a callback's arrow is its own colour, spelled `->!` — it accepts any function, and the function follows it — or `->` for a pure one" + fixit `->!`; read as that callback's colour (§4.4) |
| `->?` elsewhere inside a parameter type (in a callback's own parameters, or under a constructor) | the `record` field's frame, "an arrow inside a parameter type, other than a callback's own, is a constant" + fixit `->!`; read as the impure constant (§2.4, §4.4) |
| An instance body does more than its contract permits (§13.2) | "this call may touch the world, and `read`'s contract is the pure arrow `->` — an instance does no more than its contract permits — keep this body pure, or, if the constraint is yours, write `->!` on the member". Under a `->?` contract: "this call touches the world on its own account, and `run`'s contract is `->?` — an instance is only as effectful as what it is handed — move the effect behind a callback, or, if the constraint is yours, write `->!` on the member". At the offending call (the first in source order), with the contract's failing arrow as a related location. Where the failing arrow is not the outer one, the frame names its position: "the function this instance returns …" through results alone, and "… inside the parameter `k`" or "inside its result" otherwise; the advice names the same arrow |
| An instance body accepts less than its contract promises (§13.2) | "`run`'s contract accepts any `action`, and this instance accepts only a pure one — an instance accepts everything its contract promises to accept — do not narrow `action` here, or, if the constraint is yours, write the member's `action` arrow `->`", at the pin that narrowed it (the first in source order), with the contract's arrow as a related location, and the same position forms |
| Mark not glued into its seat (not against both callee and `(`, and not glued at a bare pipe stage's end) | parse error: "a call mark governs an argument list; write it immediately before `(`, or (in a `\|>` stage) at the end of the stage — a reference carries no colour" (§3.2) |
| Prefix `!` on an expression (negation intent) | "Hexagon spells logical negation `not`", position-selected by the parser (Lexer §10's row) |
| `=>` (or the retired `=>!`) after a complete type operand, in a type position where a fat arrow can have no other reading | the type-arrow redirect: "Hexagon's type arrows are `->`, `->!`, `->?`; `=>` is the lambda arrow — for a function type write `Int -> Int` (or `->!` / `->?` for its colour)" + fixit `->` (`->!` for `=>!`). Recovery resolves the arrow to that spelling, so one typo yields one report. The redirect is position-selected by the parser, and **silent** where the fat arrow competes: in a lambda's return annotation, where it is the body's (§2.6), and in a `let`/`var` annotation, where it may be a mis-typed `=` |
| A callable extern row written with `:` before its result, or any extern row written with the retired `pure`/`conduit` modifier | FFI Part 4 §4.5's redirect: the arrow that says what the old form said on a callable row, or the drop-the-word refusal before a row that declares nothing invocable; `->!` as the fixit for the colon (§6.1) |
| A `set` row, instance or static, with an arrow other than `->!` | "an extern `set` grants write capability, and a write to foreign state is an effect — its arrow is `->!`" + fixit `->!` (FFI Part 5 §4.1) |

## 10. Display

Display is part of the contract: a signature a reader cannot see is not a face. Functions §5.1 owns the display grammar; this section owns what is specific to colour.

- **The three arrows render everywhere a face does**: hover, diagnostics, completion detail, and the generated `.d.ts`. A TypeScript face has one function arrow, so the declaration file carries the Hexagon signature as a generated documentation line (`` Hexagon: `face` ``). It is merged into the author's block per Doc Comments §7.3, and emitted only where the face carries a colour: purity is the silent one (§1).
- **A displayed face is a face the grammar can write.** Each arrow is shown in the spelling that, written at that position, denotes its colour:
  - a callback's colour shows `->!` on the callback's own arrows;
  - a pure callback shows `->`;
  - a colour that depends on callbacks shows `->?`. A finished face depends on all of its callbacks or on none (§2.4), so a pasted `->?` is exact;
  - the constants show `->` and `->!`.

  An untyped callback's face is exact too, because it is finished as a written one reads (§3.4). There is no display-only colour decoration: no numbering, and no second spelling. `run : (() ->! Unit) ->? Unit`; `apply2 : (() ->! Unit, () ->! Unit) ->? Unit`; `withTransaction : ((String) ->! String) ->! String`.
- **A captured colour shows `->?`, and tooling names its owner.** A local face carrying an enclosing function's colour (§3.4) displays `->?` where the face depends on it. Hover, completion detail and diagnostics name whose callbacks it depends on: "depends on `outer`'s `action`". A nested helper with callbacks of its own and a captured colour shows `->?`, and the owner line names what else it depends on. The owner line is information, not grammar. A paste of such a face where it cannot mean the same thing is caught by a teaching refusal (§4.4's local-annotation row, or §4.2's claims-less report), never re-read silently.
- **Display reads settled colours.** A report that shows a colour still unsolved shows the arrow written there, and `->` where nothing wrote one (§3.4).
- **A member at a known instance displays the instance's face; at its declaration and in generic code, the contract** (§13.3, §13.6).
- **A constrained face wears its constraints as a bracket prefix**, `<a: Show> (Seq(a), (a) ->! Unit) ->? Unit`, per Functions §5.1. It is display-only, and a paste into an annotation position is refused there (Functions §5.1). No `=>` appears anywhere in a displayed type (§2).
- **A machine-written annotation writes the face as displayed, where the grammar admits it there.** An `->?` is written only into a signature with callbacks of its own by then (§2.2.1). A face that depends on a captured colour is not written at all: the tool leaves the type to inference, which is the only spelling of that dependency. Both constants write freely, and a machine-written impure return annotation is spelled `->!` and needs no parentheses (§2.6).

## 11. Rejected alternatives (do not re-litigate without new information)

- **One colour per signature**, with every `->?` in a signature one variable and a conducting call mark `?`: superseded. It forced callbacks handed to one call to share a colour, so a pure or pinned callback dragged its neighbour's colour with it, and a pure function beside a callback had to be made to fit by re-reading. Swift computes `rethrows` from each argument separately, and one colour per callback parameter does the same (§2.4).
- **`?` as a second call mark** ("conducts the caller's colour"): retired, and `?` is no token at all. At a call, "may touch the world through what I was handed" and "may touch the world" ask the reader the same question, and the difference is already on the enclosing face (`->?` against `->!`). **`?` as a synonym for `!`**: refused as well. One spelling, one meaning; `?` stays a type-only letter (§2.2).
- **Flix-strict: nothing fits**: refused. `orNoop`, a pure function at a `->!` field, and a pure function handed beside a callback would all need rewriting. A pure function fits anywhere, and any function fits `->!` (§2.6).
- **Full Boolean unification of colours** (Flix): refused. Its most general answers use "and" and "not", which no arrow spells. The join fragment, fitting, and late settling of hard cases reach the answers Swift gives (§3.4).
- **Making a hard case's parts impure the moment it appears**: refused. The answer would follow the order of the lines (§3.4).
- **Faces that depend on only some of their callbacks**, shown with numbered colours: refused for now. `->?` means one thing, written or shown (§2.4, §10). A written spelling for "depends on these callbacks" (`->?[b]`) may be added on field evidence; it would make some marks unnecessary on code that compiles today.
- **The variable reading of an arrow in a callback's own parameters or under a type constructor**: refused. One spelling cannot name both a variable and the constant, so the face would not be what it accepts (§2.4). **Following an `Option` of a callback** (Swift follows an optional function parameter): deferred, not refused. It may be added; until then the idiom is a plain callback, to which callers with nothing to do hand `() => ()` (§2.4).
- **An untyped parameter handed on, but never called, defaulting pure**: refused. The writer's `!` on the forwarding call would be refused as a mark on a pure call. The mark decides every colour it reaches (§3.4).
- **Declared honor colours**: refused. Nobody writes new syntax; a known instance's colour is what its body does (§13.3).
- **Generic functions carrying instance colours** ("effectful through `s`"): refused for now. A generic call to a `->!` member wears the ceiling, and the function that makes it is a source (§13.3). An explicit spelling in the spirit of Swift's typed throws may be added on field evidence.
- **A `widens` door wearing the member's contract at its known type**: refused. It would give one operation at one type two marks, `m.put!("k")` beside `put(m, "k")` (§13.3; Constraints §4.7).
- **A local `->?` borrowing the enclosing function's colour**: refused. A local binding that should follow the enclosing callbacks leaves its type to inference (§2.2.1).
- **A marked recovery colour for a refused `->?`**, one that suppresses what it reaches and binds nothing: refused. A refusal reads as its fixit, as Swift reads a misplaced `rethrows` as `throws` (§4.4).
- **Effect-parameterized types** (`Seq(a, e)`, Koka-style rows): refused. This reintroduces the machinery HM-nativeness exists to avoid, and the two-point lattice makes the nominal split (§7) strictly cheaper.
- **The impure constant as a multi-member door's licence**: refused. A `widens` door whose listed members' contracts disagree would publish a face no member wrote (Constraints §4.7).
- **Marks on references** ("effectful values"): values wear no colours (§2.6); the effect happens at the call.
- **`!->`**: not a token. The mark trails what it condemns, on arrows exactly as at calls (§2.3).
- **The `->` / `=>` / `=>!` spelling**: superseded. It split three spellings over two axes, and left `=>` serving as lambda arrow, arm arrow and effect arrow at once (§2).
- **A `->?` with nothing handed read as the constant**: refused. One spelling would have two meanings, selected by position (§2.2.1). Do not restore it to spare a writer three keystrokes: the keystrokes are the point.
- **A pure-asserting term lambda arrow** (`x -> body`): dropped. Inference from the body plus the ascription demand covers it with zero new syntax.
- **Holding an unconstrained body colour open for the caller**, so that constructing a closure would count as running it: refused. A colour nothing constrains is not a dependency; the callback's colour it feared losing is the parameter's own, which the defaulting never touches (§3.4).
- **Context choosing a function's colour** (Koka's open effects in full): refused. Koka keeps a body's effect open while it infers, so the context chooses the lambda's own effect. A function's colour is its body's (§2.6). What Hexagon takes from Koka is the other half, which never holds a function's colour open: re-opening a function's arrow at each use and closing whatever nothing claimed (§3.4).
- **Stopping the fit short of the impure constant**: refused. With the fit an instantiation, a function at a `->!` position costs nothing more than one at a callback's colour, and refusing it would take a rule against something sound.
- **Re-opening a colour inference is still working out**: refused. Koka re-opens whatever is closed at the moment of the use, so the verdict follows line order. Hexagon re-opens only what the program's text decides (§3.4).
- **Faces exact in the effect direction**: refused. It would make a function's own face the one place `->!` means *does* rather than *may*, and would refuse a stub written against the face it will have. `->` stays exact: silence is the strong claim (§1).
- **Re-opening beneath the outermost arrow**: refused. It needs a variance walk at every unification; a value already built keeps its type, and building it where it is used fits (§4.3).
- **Exact matching at the constraint seat**: refused. A pure instance cannot manufacture the effect a `->!` member's exactness would demand, so effectful members would be unhonorable at any in-memory type (§13.2).

## 12. Decisions log

| Decision | Where |
|---|---|
| Two-point lattice; effect = observable world interaction; exceptions and `Result` outside; async out of scope | §1 |
| One alphabet: calls bare or `!`; arrows `->`, `->!`, `->?`; `!` means "may"; silence is the one exact promise | §1, §2, §3.1 |
| `->!` is a callback's colour on its own arrows, and the impure constant everywhere else; any function fits it | §2.3, §2.6 |
| `->?` is type-only: the join of the callbacks handed by the time the arrow runs; a declaration never writes its outer arrow; legal only where some callback has been handed (the inlet rule, syntactic); never inside a parameter type, never borrowed locally | §2.2, §2.2.1 |
| One colour per callback parameter, living on the callback's own function type; every other arrow inside a parameter type means what it says; aliases transparent; no `Option` exception (deferred) | §2.4 |
| A function's colour is a join; a finished face depends on all of its callbacks or none (widened at generalization) | §2.4, §3.4 |
| Data-field arrows are constants; `->?` there is refused | §2.5 |
| A function's colour is what its body does, decided at its close; demands are checked, never used to choose; fitting re-opens a text-decided function as "its colour or more"; a face may claim more, never less | §2.6, §3.4, §4.2 |
| Call marks: bare or `!`, computed from the callee's outer colour; `?` is no mark and no token | §3.1, §4.1 |
| Mark anchors the argument list; pipe stages and suffix constructions are calls; the outermost-arrow sentence | §3.2, §3.3 |
| Colours are HM components; joins normalized; the join fragment for unification; hard cases settled late (Swift's collapse at settling), never Boolean unification | §3.4 |
| Body colour: source, then the join of what it runs, then pure (the defaulting, whatever the callbacks); dependencies never defaulted | §3.4 |
| An untyped parameter used as a function is decided by the marks of the calls it flows into: `!` claims its colour, bare leaves it pure | §3.4 |
| Captured colours never generalize at the capturing binding; knots settle at their close (source, conduit, default, widen, then obligations) | §3.4 |
| A body's close runs the arms, then the hard cases, then the defaulting, then finishes its untyped callbacks; a body that uses a colour decided later (a knot sibling's, a pending dot call's, an open subject's, an instance's) is held until that colour's deadline, joined by its callers, its colour not generalized before it settles, types settling before colours | §3.4 |
| An untyped callback is finished as a written one reads: its own colour independent, every other colour inside it the impure constant | §3.4, §10 |
| Symmetric enforcement, error-grade; the lie of generality at a `->!` callback reported at the pin; an impure pin draws no report | §4 |
| A refused `->?` reads as its fixit, unmarked | §4.4 |
| Four unmarkable forms: prelude members `->`; `Iterable` instances pure; `for` heads never marked | §5, §13.5 |
| Extern ownership split: intrinsics verified, user rows trusted (`->` the purity claim, `->?` the conduit claim, `->!` the unknown); four trusted-purity species | §6 |
| `Seq` pure by construction; `Stream` the nominal sibling; FFI position choice | §7 |
| Colours and marks erase | §8 |
| Display writes only what the grammar writes, with no numbering; captured colours carry an owner line; a member at a known instance shows the instance's face | §10 |
| A constraint member header is an effect contract; the seat compares, at every choice of the member's callback colours | §13.1, §13.2 |
| A call at a known instance follows the instance's face, a generic call the contract, the choice made once the subject settles; `widens` doors follow their bodies; generic functions carry no instance colour; the module's honors and the bodies waiting on them close as one knot, so recursive instances settle by what they do; instance faces are published | §13.3, §13.6 |
| In a member, `->?` is "through the callbacks only", `->!` "the instance decides", and `->` "every instance is pure"; one colour per callback parameter | §13.4 |

## 13. Effect contracts at the constraint seat

A constraint member header is the one function header in the language with no body beneath it to infer from, so it is the one that **writes its own outer arrow**: `show(value: a) -> String`, `read(source: a) ->! String`, `run(runner: r, action: () ->! Unit) ->? Unit` (Constraints §2 owns the form; implementation headers keep `:` and keep inferring, Functions §4.1). What the header writes is a **contract**: what a caller may assume, and what an instance must satisfy.

### 13.1 Two levels

- **An instance is an implementation, and its colour is inferred.** An `honor` member body, a default body and a `widens` door body each solve their own colour by §3.4's arms, exactly as any body does. The header such a body hangs under writes `:` where it writes anything, and never an outer arrow (Constraints §4.1, §4.7).
- **Every arrow a contract writes is a bound**, and the seat is a comparison, not a unification:
  - an arrow the caller invokes (the outer arrow first of all) is a **ceiling**;
  - an arrow the caller supplies (a callback's) is a **floor**: the instance must accept at least what the contract promises;
  - an invariant arrow is both.

  This is the one seat where §1's "colours unify or they do not" gives way to an ordering.
- **What each outer arrow promises:**
  - `->`: every instance is pure;
  - `->!`: **the instance decides**; each instance's colour is what its body does (§13.3);
  - `->?`: **only through the member's callbacks**; an instance adds nothing of its own (§13.4).

  A callback parameter written `->!` accepts any function, and one written `->` accepts only pure ones (§2.4).

### 13.2 The seat check

In one sentence: **an instance accepts everything its contract promises to accept, and does no more than its contract permits.**

- **The body is inferred over the contract's shape with its colours freshened.** The contract's *types* reach the body as Constraints §4.1's expected type (Functions §4.3), with every colour replaced by a fresh variable of the body's own, one per arrow. That is the first of §3.4's expected-type exceptions. The body then infers as any body does: a call on a callback's slot is a conduit of it, and a merge of two slots unifies them.
- **The inferred type is compared against the contract at every choice of pure and impure for the member's callback colours.** At each choice:
  - every slot the body left free takes the least colour the comparison allows: the join of the contract's colours at the supplied and invariant arrows it stands at, or pure where it stands at none;
  - every supplied arrow's body colour must then be at least the contract's;
  - every invoked arrow's body colour must be at most the contract's;
  - every invariant arrow's body colour must equal the contract's.

  The walk reads each arrow's sign as the variance analysis computes it (`decisions-ml-dialect-generalization-2026-08.md` §5; §3.4's occurrence walk). An arrow the analysis's unused point erases is compared with nothing. Every comparison is then an inclusion between joins of the callback colours, so three kinds of choice decide every seat: all pure, all impure, and each callback impure with the rest pure. **The all-pure choice is compared first**, so an instance is told what its pure obligation costs before anything else.
- **A failed seat reports once.** The report names the first failing arrow in walk order: the outer arrow before any nested one, parameters left to right before the result, and components in declaration order. It uses §9's two seat rows:
  - **The body does more than the contract permits.** That is an effect under a `->` arrow, or the body's own effect under `->?`, including a default body's call on a `->!` sibling, which is generic and so at its ceiling (§13.3). The report stands at the offending call, the first in source order.
  - **The body accepts less than the contract promises.** That is a `->!` callback handed to a `->` demand or pinned by an annotation, or a constant arrow inside a parameter that the body fixes to the other constant. The report stands at the pin, the first in source order.

  A failed seat holds back mark reports on the colours it condemned. A mark read off a refused colour would restate the refusal in the wrong words. The body's defaulting and generalization still run, so the binding keeps a scheme and its other calls still check.
- **A consistent seat then fixes the body's colours for its marks.**
  - A slot at a supplied or invariant arrow takes the contract's colour there. That is the constant the contract writes, so a `->` callback's calls are bare, or, at a `->!` callback's own arrow, the member's callback colour, quantified at the member, so calls on it wear `!`. A slot the body merged across several such arrows takes the join of their colours.
  - Every other slot is what the body made it, and pure where nothing did (§3.4's defaulting). An invoked arrow the body leaves pure stays pure, so a call at this instance can be bare where the contract says `->!` (§13.3).
  - The instance's own colour is its body's outer colour, finished as any face is (§2.4). That is the colour a call at this instance follows (§13.3).

For a constant outer arrow, the rule is a table:

| Body solves to | `->` contract | `->!` contract |
|---|---|---|
| pure | accepted | accepted |
| impure | refused | accepted |

The lower-right cell is what the ordering buys: a `->!` member honored at an in-memory type by a body that reads nothing. Its calls at that instance are bare (§13.3).

### 13.3 Member calls: the instance at a known instance, the contract in generic code

- **A call at a known instance follows the instance's face.** An instance is known where the call's subject type selects one `honor` once the subject is settled. A subject still open when the body closes holds the body until the subject variable's level closes (§3.4), so whether a call is known or generic never depends on the order of the lines. Every spelling of the call follows it alike: the bare member call, the qualified call, the dot call (Method Syntax §7), and the `widens` door, which *is* the instance at its type. The derived member is the door restricted, so a door under a `->!` member wears its body's colour (Constraints §4.7). Under `read(source: a) ->! String`:
  - `Mem.read(m)`, `m.read()` and `read(m)` are bare at an instance whose body reads nothing;
  - `Disk.read!(d)` wears `!` at one that reads the disk.

  References carry the face of what they name.
- **A generic call follows the contract.** A call through evidence under a bound (`<s: Store>`, or a constraint inferred on a variable that is still open when the body settles) wears the contract's outer arrow at this instantiation:
  - `!` for a `->!` member, the ceiling: *may*;
  - the callbacks' join for a `->?` member: `quiet<c: Each>(c: c) = each(c, (x) => ())` is bare;
  - bare for a `->` member.

  A call is generic when its subject variable generalizes: it is a type variable of the function's scheme, answered by evidence. A generic function is then as effectful as those calls. One that calls a `->!` member through its bound is a source, so `saveAll<s: Store>(st: s) = put!(st, "x")` is `->!`, and `saveAll!(mem)` wears `!` at every instance. The function carries no instance colour. An author who wants the pure instance's calls bare calls the member at the known type, or writes a function at that type.
- **An instance's face settles order-free, as a knot does.** An `honor` has no source-ordering law (Declarations Preamble §7.2), so a known-instance call may stand before the honor that answers it. An honor's body may itself call its own instance, or another, at a known type: recursive instances over lists and trees do.
  - The module's honors, and every body that waits on their colours, directly or through a body it calls, form one component. It closes once every honor in the module has been checked, by §3.4's knot close: the source arm to its fixpoint, then the conduit arm, then the colours still undecided default pure, then the faces widen and the recorded obligations and demands are read. So a recursive instance that touches nothing is pure, and its calls are bare; one that touches the world anywhere in its recursion is effectful.
  - Until the component closes, a body that uses an instance's colour is held (§3.4). A demand such a colour meets is compared afterwards, and a refusal names the demand.
  - An instance that uses the member's default body has the default's face, checked in the constraint's generic context.
  - A derived instance is pure by construction.
  - An instance's face for each member is part of its module's interface, published with the instance, so an importing module's known-instance call follows it too. An imported instance's face is already settled, so the component never crosses a module boundary.
- **What `!` means, restated.** A bare member call is statically pure. A `!` call *may* touch the world, and does not promise that it does on this execution. Mark checking stays exact (§4.1): the required mark is the colour this call follows, and any other mark is the error it always was.
- **The price.** An instance's face is its body's, so changing the body can change the marks and colours of its known-instance callers, in its own module and in importers, exactly as changing any function's body can. Generic callers never change: they wear the contract. Changing an instance within its contract's allowance never changes whether a program is well-formed, only which of its known-instance calls are bare.

### 13.4 Member colours: one per callback parameter

A member header is a **signature** under §2.2.1.
- Every callback parameter it writes has a colour of its own, quantified **at the member** and instantiated fresh at every call. It is not fixed per instance. This is the one member-level quantifier the language admits: Constraints §2's ban on member type parameters stands (Constraints §9.6), and these colours are not a door to them.
- An outer-only `->?`, as in `read(source: a) ->? String`, is §4.4's refusal: nothing is handed.
- The arrows inside a callback's own parameters, and under constructors, mean what they say (§2.4).

**`->?` on a member means only through its callbacks.** An instance under `run(runner: r, action: () ->! Unit) ->? Unit` may:

| Callback supplied | What the instance may do |
|---|---|
| pure | nothing the world observes |
| may touch the world | anything, or nothing |

Calling the callback, calling it conditionally and ignoring it all satisfy the contract. Ignoring it may break a behavioural law, which is the constraint author's business, not the checker's. An honoring body writes no arrow and needs none:

```
honor Runner<Job> =
    run(job, action) = action!()
```

A body that performs its own effect fails the all-pure choice (§13.2). A contract that wants both a callback and a licence for its own effects writes `->!` on its outer arrow, `run(transaction: t, action: () ->! Unit) ->! Unit`. That is `withTransaction`'s shape as a contract, and each instance's calls then follow what its body does (§13.3).

**A default body** is checked once, in the constraint's generic context (Constraints §2). Its calls on sibling members are generic, and so wear their contracts (§13.3), and it is compared against its own contract like any body:
- a default under `->` cannot call a `->!` sibling;
- a default under `->?` may run the member's callbacks, and siblings through them, but cannot call a `->!` sibling;
- a default under `->!` may call anything.

This is Swift's protocol-extension reading, where a requirement that *may* throw is throwing to the code that calls it generically.

### 13.5 The unmarkable forms

§5's four forms stay pure, because they elaborate to prelude members by identity (brackets to a compiler-known lookup: `Vector`'s and `String`'s `at`, or `Map`'s keyed read, each pure; Collections Part 3 §5, §9; Collections Part 4 §4.1), and **every member of every prelude constraint writes `->` on its outer arrow**. That is what the four forms need. As standard-library policy, prelude members write `->` on every arrow beneath the outer one too: no prelude member takes an effectful callback (Constraints §7 lists them). That is a compile-breaking standard-library constraint, which the conformance suite is to pin alongside the prelude seat order. A user constraint's effectful member reaches no unmarkable form, because no unmarkable form reaches a user constraint. `Iterable` therefore still admits no effectful instance, and `Stream` still has no instance (`stream.md` §4.5). A pattern's `view` is §4.3's demand, unchanged (Pattern Declarations §2.1).

### 13.6 Evidence, emission, display

- **A dictionary is a value.** Instance construction is evaluation-free (Constraints §6.3), and an effectful member's effect happens at the call, where its mark is, never at the dictionary. Nothing about evidence, sharing or CSE reads a member's colour.
- **§8 stands.** The seat holds the body whatever its colour, and colours erase.
- **A member displays its contract at its declaration and in generic code, and the instance's face at a known instance** (§10), so hover explains the mark the call wears. The `.d.ts` dictionary interface carries a coloured member's Hexagon face on the documentation line §10 already emits (FFI Part 9 §2.2).
