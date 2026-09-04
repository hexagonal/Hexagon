# Hexagon Spec: Pattern Declarations

**Status:** Decided (September 2026; #834).
**Scope:** The `pattern` declaration — a named way of matching a value, written as two ordinary functions: a required, pure `view` and an optional `build`. The head and its member block; inference of an unheaded private pattern; the constructor-shaped use in pattern and expression position; resolution (in scope, qualified, the `pattern` alias, and the expected-type door); coverage; evaluation and purity; emission and the `.d.ts` face; diagnostics; rejected alternatives; the standard library's first pattern, `Rat.rat`.
**Companions:** Pattern Matching (the grammar this spec adds one form to; §2.8/§8's no-user-code rule, whose one exception this is; §5 irrefutability; §7 coverage and witness rendering), Modules (§3.2 the alias row; §4.1 export; §4.1.1 complete exported signatures; §4.2 `opaque`; §5.1 term-position resolution; §3.1 "modules are not values", whose sibling §2.4 here is), Declarations Preamble (§7.1 inventory, §7.2 straddling), Functions (§7.1 header syntax; §7.3 the member block and the head's binders; §4.2 binders), Constraints (§4.1 member checking — the `honor` precedent), Effects (§4.3 the pure demand), Products (§5.3 the explicit crossing), Doc Comments (§4.2), Lexer (§4.2 the contextual head word), FFI Part 7 (the exported face), `rat.md` (§3, §6).

---

## 1. Doctrine

- **A pattern is a published way of matching a value.** Outside its home module an `opaque` type is a black box (Modules §4.2): no constructor, no fields, no destructuring — its consumers inspect it through exported functions and guards. A `pattern` declaration is the home module's way of saying *this is how you may take one apart*: it names a view, gives it a shape, and lets the ordinary pattern engine — nesting, binders, or-patterns, `as`, `let`, exhaustiveness — run over that shape. It exposes an **author-defined view, never a representation**: the storage may be unrelated to the components, and changing the components is a visible API change, as changing a constructor's arity is.
- **A pattern is two ordinary functions.** `view` takes the subject to its components; `build`, where present, takes components to a subject. Both obey every rule an ordinary function obeys — typing, evaluation order, effects, exceptions. The compiler adds the invocation syntax and the coverage meaning of a total view; it derives nothing and **inverts nothing**. `build(view(v)) == v` is the law a bidirectional pattern documents; `view(build(parts)) == parts` is deliberately not required, because `build` may canonicalise — `Rat`'s does.
- **The constructor is the way in, the constructor pattern the way out** (Products §5.3). A pattern declaration is that pair, authored: `rat(n, d)` is spelled like a constructor in an expression and in a pattern, and the reader learns nothing new. One spelling, two positions, as every constructor already has.
- **One interpretation, or a refusal.** A bare pattern head resolves in scope, or through one closed drawer the expected type names (§3.3), or not at all. Nothing is searched across imports, nothing is derived from a naming convention, and no type is inspected to choose between readings — the shape Modules §5.1's fallbacks and Pattern Matching §2.2's door already have.
- **Patterns are declarations, not values** (§2.4): the sentence Modules §3.1 states for module aliases, one namespace over. What keeps an alias from silently carrying half a pattern.

---

## 2. The declaration

### 2.1 The head and the member block

```
export pattern rat(top: BigInt, bottom: BigInt): Rat
    view(x) = (top(x), bottom(x))
    build = create

pattern parts                                 -- private: the head infers (§2.2)
    view(x) = (top(x), bottom(x))

export pattern rgb(r: Int, g: Int, b: Int): Color
    view(c) = channels(c)                     -- match-only: no build
```

A **`pattern` head** — the contextual head word (Lexer §4.2), the pattern's non-uppercase-start name, an optional binder list (Functions §4.2), an optional **component list** with its result type — ends its logical item and opens a **member block** (Lexer & Layout §2.1's kind; Functions §7.3's shape): a declaration sequence with no value. Its members are:

| Member | Required | Type, at a head `p(c1: T1, …, cn: Tn): S` |
|---|---|---|
| `view` | yes | `S -> (T1, …, Tn)` for *n* ≥ 2; `S -> T1` for *n* = 1 |
| `build` | no | `(T1, …, Tn) -> S` |

- **The component names are the face's, and bind nothing.** `top` and `bottom` in the head name the components — in diagnostics, in the doc comment, in the `.d.ts` face (§6), and in the opaque refusal that names the pattern (§3.3) — and are not in scope in the members, whose parameters are their own: `view(x)` binds `x`, a header-syntax `build(a, b)` binds `a` and `b`, and `Rat`'s head may name its components `top` and `bottom` beside the module's functions `top` and `bottom` with nothing shadowed. A `fun` header's parameters bind in its body; a pattern head's components are a signature, not a binder list.
- **The component list is the pattern's arity**, *n* ≥ 1. A list of one component is legal — `pattern id(n: Int): UserId` — and is the ordinary shape for an opaque newtype; the parenthesised list is an argument list, never a tuple (Functions §5), so no 1-tuple question arises. A head with no components, `pattern zero: Rat`, is refused: a total view with nothing to bind matches every value and distinguishes none — "a pattern has at least one component; a test with no components is a guard".
- **A member is written in one of two forms.** *Header syntax* — `view(x) = body`, Functions §7.1's form, one per block item, no `fun` word — or the **delegation line** `build = create`: the member name, `=`, and the **name of a function**, bare or qualified through a module alias (`build = Rat.create`), which the member then *is*. The right side of a delegation line is a name and nothing else — no lambda, no call, no expression: a name is **resolved**, never evaluated, so the declaration stays evaluation-free as `honor` blocks are (Constraints §4.1, §6.3), and the ordering laws are untouched — the named function is read at the pattern's use sites, not at the declaration. Constraints §4.1's lambda-only rule for `honor` members is not loosened by this: it governs `honor`; the delegation line is the pattern block's own form, and `name = widened` (Constraints §4.7) is not admitted here. An `=` followed by anything but a name is a parse error naming both forms.
- **`view` and `build` are the member names**, not keywords: the block admits exactly these two spellings; `view` missing is an error at the head ("a pattern declares `view`"); a member of any other name, or a second `view`, is an error at that line. Elsewhere both are ordinary names.
- **`view` is pure.** Its arrow is the pure constant `->`: the head writes no arrow, and none is admitted, because a pattern's matching direction is a demand for purity (Effects §4.3) — the one seat where a pattern runs user code (§5) runs only code that cannot be observed running. A `view` whose body solves to `->?` or `->!` is refused at the member with §4.3's report, the demand being the head's. `build` is unconstrained: its arrow is whatever its body or delegate has, and an expression use of the pattern is an ordinary call that wears the mark that arrow demands (Effects §3). Throwing is not an effect: `Rat.create` throws on a zero bottom, and `build = create` is pure.
- **Module level only.** `pattern` joins the Declarations Preamble §7.1 inventory: inside a function body or block it draws that family's error, "declarations live at module level". It is order-insensitive among declarations (§7.2), and its name straddles as a constructor's does — the declaration rule in the head's own types, the term rule at a use in value or pattern position, so a use above the declaration is Functions §7.2's declared-later error under Modules §5.4's reservation, never a different reading.
- **The head's binders are the block's** (Functions §7.3): `pattern top<a>(x: a): Stack(a)` declares `a` rigid over both members; members take no binder lists of their own. An exported pattern writes every binder and constraint its members need (Modules §4.1.1).
- **The doc comment attaches at the head** (Doc Comments §4.2): the head is the pattern's exported surface. The members take none — the pattern is documented once, at the name a reader will paste — with a dedicated message at a member: "document the pattern at its head".

### 2.2 Typing and inference

- **With a head, members are checked, not inferred** — the `honor` posture (Constraints §4.1): the expected type of each member is fixed by the head, the body checks against it, and the member's lambda parameters take their types from the head before the body is inferred (Functions §4.3's supplying seat). Annotations on a member are optional and must match the head's type exactly. A `build` whose parameter count differs from the component list, or a `view` whose result is not the head's component tuple, is an error at the member naming the head's shape.
- **Without a head, the pattern infers** — legal for a *private* pattern only (an exported one writes its head, §2.3). `view`'s type is inferred as a `let`'s would be; its parameter type is the subject; its result fixes the components: **a tuple result is the component list**, its arity the pattern's arity; any other result is one component. `build`, if present, is then checked against those. The one shape inference cannot express — a one-component pattern whose sole component is a tuple type — writes the head, which says so directly: `pattern contents(c: (Int, String)): Box`. An unheaded pattern generalises as an unannotated `let` does (Functions §8); its subject may be a type variable only where the view's body leaves it one.
- **Consistency is checked once, at the declaration.** Where `build`'s result does not unify with `view`'s subject, or its parameters with `view`'s components, the error is at `build` and names both faces: "`build` returns `Color`; `view` takes `Rat` — a pattern's two directions share one subject".
- **The subject may be any type** — nominal or structural, the module's own or another's. A pattern over a type declared elsewhere is written from that type's exported surface, and needs no orphan rule: a pattern is reached by *name*, never dispatched by type, so two modules declaring patterns over one type contest nothing. Only the door (§3.3) cares where the subject lives: it opens on a nominal type's home module and never on a structural type, which has none.

### 2.3 Visibility

`pattern` takes the head's ordinary visibility slot (Modules §4): `export pattern` crosses the module boundary, a bare `pattern` is private. `opaque` is a type's word and is refused before `pattern` with Modules §4.2's parse error. What `export` exports is the pattern — both directions, where both exist (Modules §4.1's table). Two rules of the exported face follow from the corpus and are restated so that nothing is presumed inferred across a boundary:

- **An exported pattern writes its head** — Modules §4.1.1's complete exported signature: every component's type, the subject, every binder and constraint. The head is the pattern's face in the `.d.ts` (§6), the target of its doc comment, and the reader's contract; it is also what makes a change to the components a change the diff shows.
- **The private-in-public rule reads the head** (Modules §4.3): an exported pattern whose subject or component types mention a private nominal of this module is refused at the offending seat, as an exported function's signature is.

### 2.4 Patterns are not values

A pattern's name is a declaration in the term namespace (§3.3) and **is not a value**. In term position it stands only as the head of an application — `rat(1, 2)` (§3.2) — or to the right of `pattern` in an alias (§3.4). A bare reference anywhere else is refused:

```
let rat = Rat.rat          -- ERROR: patterns are not values; write
                           --   pattern rat = Rat.rat to alias it, or
                           --   Rat.rat(a, b) to build one
let f = Rat.rat            -- the same
apply(Rat.rat)             -- the same; pass (a, b) => Rat.rat(a, b)
```

The report names the two things the author could have meant, in that order; the lambda is the third, and the fixit offers it only at an argument seat. The rule is Modules §3.1's "modules are not values" one namespace over, and it exists for one reason: a `let` binds a *value*, and the value a bidirectional pattern would yield is its `build` half — a `let` alias would silently drop the view, and `rat(n, d)` in a `match` beneath it would be a lowercase head with nothing pattern-shaped behind it. The `pattern` alias (§3.4) is the form that carries the whole declaration. Constructors are not affected: `let mk = Tag` stays legal (Modules §13's test *k*), because a constructor *is* a function value and its pattern face rides the type, not the binding. A pattern is likewise **no member**: it has no receiver, and `r.rat` is Method Syntax's ordinary unknown-member refusal.

---

## 3. Using a pattern

### 3.1 In pattern position

```
match r
    rat(0, _) => Zero
    rat(n, 1) => Integer(n)
    rat(n, d) => Fraction(n, d)

let rat(n, d) = r                          -- irrefutable: the view is total
fun sign(rat(n, _)) = n.compare(0n)        -- a lambda head; the §5 gate is satisfied
match c
    rgb(0, 0, 0) => "black"
    hsl(_, 0.0, _) | rgb(255, 255, 255) => "achromatic"
    rgb(r, g, b) as colour => ...
```

The form is `p(p1, …, pn)` — a **non-uppercase-start head**, bare or qualified `Alias.p` (Modules §3.1 admits the form in patterns, as for constructors), applied to exactly *n* full sub-patterns. It joins Pattern Matching §2's inventory beside the constructor pattern and is a pattern everywhere a pattern may stand (Pattern Matching §6): `match` and `catch` arms, `let`, `for..in`, lambda parameters, the match function's arms.

- **Arity must equal the declaration's** — the constructor family's errors and hints (Unions §4.2; Pattern Matching §2.2): `rat =>` draws "`rat` has 2 components; write `rat(_, _)`", and `id()` the nullary-parens hint.
- **Typing** (Pattern Matching §4's list gains the row): the head resolves per §3.3; the scrutinee unifies with the pattern's subject at a fresh instantiation of its binders; the sub-patterns check against the instantiated component types. A scope-resolved or qualified head may thereby determine an undetermined scrutinee, exactly as a constructor's does; a door-resolved head was determined by it.
- **`as` binds the subject**, never the component tuple: `rgb(r, g, b) as colour` binds `colour` to the `Color`. Or-patterns take the form as any other alternative, under the same-bindings rule.
- **Irrefutability** (Pattern Matching §5.1's table gains the row): `p(p1, …, pn)` is irrefutable iff every `pi` is — the view is total, so the outer form is always "sole constructor". This is what admits `let rat(n, d) = r` and the lambda head above; refutability enters only through the components.
- **The case rule is untouched.** A non-uppercase-start name *without* parentheses is a binder; *with* them it is a pattern head, a shape no binder has. Uppercase-start heads are constructors, resolved as Pattern Matching §2.2 says. The two never contend.

### 3.2 In expression position

`p(e1, …, en)` is an **ordinary call to `build`**: arguments evaluated left to right, each once, the call typed and marked as any call is (Effects §3), the result the subject type. `rat(6, 10) == rat(3, 5)` holds because `build` canonicalises, and nothing about the pattern form is involved in that. A pattern with no `build` is **match-only**, and its expression use is refused at the head: "`rgb` is a match-only pattern: its declaration has no `build`" — with the declaration named, since the repair is there. No expression-side door exists (§3.3): in an expression the head is in scope, or qualified, or aliased — Modules §9.13's asymmetry, unchanged.

### 3.3 Resolution

A pattern's name lives in the **term namespace** (Modules §5.1 rule 3) — beside constructors, constraint members, and bindings — and collides there under the Declarations Preamble §7.3 family: a module declaring both `pattern rat` and `let rat` is refused at the second. It resolves, in an expression and in a pattern alike, **in scope first**: the module's own declarations, and a qualified spelling `Alias.rat` in the aliased module's exported term namespace. Modules §5.1 rule 3's companion fallback never answers for a pattern — it reads a *constructor spelled like the alias*, and a pattern's name is non-uppercase-start.

**In pattern position, where scope has nothing for a bare head, the expected type's door opens** — Pattern Matching §2.2's door, one drawer over. Where the pattern's expected type is a **nominal** type (a record, a union, a nominal alias's target), the head resolves among the **exported patterns of that type's home module whose subject is that type**; the type carries its declaration site wherever it flows (Modules §2.3), so the drawer is named without consulting the reporting module's imports, and the drawer is closed — a set the checker can list. Every property §2.2 states for constructors holds here, and is restated only where the pattern case differs:

- **The door answers, never ranks.** "In scope" reads module-wide: a spelling this module declares or binds in the term namespace is in scope everywhere in it, and the door never answers for that spelling. Under `let rgb = …` in the module, a bare `rgb(r, g, b)` in an arm is the type error naming the qualified spelling: "`rgb` here is a binding of this module; this arm matches a `Color` — write `Color.rgb(r, g, b)`". A use above the declaration is the declared-later error, never the door's meaning.
- **The expected type must be determined when the pattern is checked.** At the top of a `match`, `let`, or `for..in` pattern the subject is typed first, and `match` §6.1's abstract-type refusal already guarantees a known head, so the door at a top-level pattern is never order-dependent. Beneath the top, and at a lambda parameter no supplying seat typed (Functions §4.3), the door reads the type as it stands — the licence §2.2 already grants — and where it is undetermined the door is **closed**: "no bare `rgb` here: its type is not determined at this pattern — write `Color.rgb(r, g, b)`, or bind the function with its own annotated `let`". One meaning fewer, never a different one.
- **A structural type has no home** (Modules §2.3), so the door never opens on a tuple, a structural record, or a function type: a pattern over one is bare in its declaring module and qualified or aliased elsewhere.
- **Only the home's exports are in the drawer.** A pattern over `Color` declared in a *third* module is not reached by the door — it is that module's own, bare there, qualified or aliased abroad — and an *alias* (§3.4) is never in a drawer, because the drawer holds declarations. A `Color` whose home exports no pattern of the spelling draws "`Color` has no pattern `rbg`" with the near miss, and one whose home exports none at all draws, for an opaque type, Modules §4.2's own sentence (below).
- **The door reaches through `opaque`.** Opacity hides the constructor and the fields; it does not hide an *exported* pattern — that is the pattern's purpose. Where an opaque type's home exports at least one pattern over it, the opaque-destructure refusal (Pattern Matching §2.4) **names them**: "cannot destructure opaque record `Rat`; match it with `Rat.rat(top, bottom)`" — the pattern's own spelling, its components as declared, one per exported pattern up to a small cap — since a diagnostic that could name the door the reader was meant to take, and instead says only that this one is locked, has withheld the repair. Where the home exports none, the sentence stands as it is.
- **In an expression there is no door** — Modules §9.13, restated: `Rat.rat(1, 2)`, or the alias.

### 3.4 The `pattern` alias

```
import Rat
pattern rat = Rat.rat

let rat(n, d) = r                          -- bare, both faces
let half = rat(1, 2)
```

`pattern name = Alias.p` declares `name` in this module's term namespace as **the same pattern** — view and build together, one identity — under a second spelling: Modules §3.2's `type Point = Geo.Point` row with the word changed, and the row that section's table gains. The right side is a **qualified pattern name** and nothing else: a bare name is refused ("the pattern is already in scope by that name; an alias renames a pattern of another module"), an expression is refused with the two-form message, and a name that is not a pattern is refused naming what it is. The alias is a declaration — order-insensitive, straddling as the original does — and may be exported (`export pattern rat = Rat.rat`), which exports the same pattern under this module's roof, as an exported `type` alias does; it never enters a door's drawer (§3.3), and the door still finds the home's export. Two spellings of one pattern in one module are legal and mean one pattern; an alias of an alias is legal and means the original. The alias is what the door makes unnecessary in a pattern and what remains the one route to a bare *expression* use abroad.

---

## 4. Coverage

Pattern Matching §7's usefulness matrix treats a total view as a **one-constructor shape** — the row Pattern Matching §7.1 gains:

- **Specialising a column on a pattern `p` of arity *n*** replaces the column by *n* component columns. A row whose head in that column is `p(q1, …, qn)` contributes `q1, …, qn`; a row whose head is a wildcard or a variable contributes *n* wildcards; a row whose head is **any other form** — another pattern over the same type, or a real constructor of the type where the home module can write one — is **dropped**. Dropping is sound: the checker knows nothing about how two views of one value relate, and a claim that `hsl(_, 0.0, _)` covers some `rgb(…)` case would be a claim it cannot verify. It is conservative: a `match` whose arms mix `rgb(…)` and `hsl(…)` heads is exhaustive only through a catch-all, and the missing-cases report names `rgb(_, _, _)` (or the other) as its witness. The home module matching a nominal record both ways — `Point({x, y})` and `polar(r, t)` — takes the same rule.
- **Reachability** reads the same specialisation: an arm under one pattern is never shadowed by arms under another, and `rat(n, d)` after `rat(_, _)` is dead as any covered arm is.
- **Irrefutability** needs no clause: it is single-row exhaustiveness (Pattern Matching §5.1), and a single row headed by `p` specialises to its components.
- **Witnesses render in the pattern's spelling** (Pattern Matching §7.3's tiers, judged per head occurrence): bare where the bare spelling pastes back — in scope, or reachable through §3.3's door, which is every exported pattern of the scrutinee's own home; qualified through an in-scope alias otherwise; and with the route clause where the module has no pastable spelling — the bare name taken by a binding of this module's own and no alias in scope: "match is missing cases: `Rat.rat(_, 1)` — `rat` is declared in module `Rat`, and this module binds another `rat`; `import Rat` and spell it `Rat.rat`".

---

## 5. Evaluation and purity

- **The one exception.** Pattern Matching §2.8 and §8 say patterns contain no calls and never invoke user code beyond the `Eq` test behind a literal. A declared pattern is the one exception: matching `p(…)` applies `view`. That is why §2.1 demands purity of `view` and of nothing else: the exception admits code that cannot be observed running.
- **The count is fixed, and unobservable.** For one evaluation of a `match`, `let`, loop step, or call, `view` is applied to the value at a pattern position **at most once per pattern per position**, before the arms are tested, and its result is shared by every arm reading that pattern at that position; a position no arm reaches is never viewed. A pure `view` makes the count unobservable, so this is a promise about emitted shape (§6) and cost, not about meaning — a pattern nested beneath a refutable outer pattern is viewed only where the outer pattern has matched.
- **Components are read, never reconstructed.** The result of `view` is a value; its components are read into the sub-patterns as a tuple's are. Nothing is copied.
- **`build` is an ordinary function** (§3.2) and may do what a function may: throw, canonicalise, carry an effect arrow and demand its mark.
- **The laws are the author's.** `build(view(v)) == v` for a bidirectional pattern is stated in the pattern's doc comment and never checked; no law is required of `view(build(parts))`.

---

## 6. Emission and the exported face

- **One binding per pattern, one shape.** A pattern emits as a single module-level binding of its own name holding a plain object with a `view` property and, where declared, a `build` property: `const rat = {view: (x) => [top(x), bottom(x)], build: create};` — the delegation line emitting the delegate's name, header syntax emitting the function. Match-only and bidirectional patterns take the one shape, and a JavaScript reader finds both directions under the name the Hexagon reader uses.
- **Matching** hoists the view before the arm tests, once per pattern per position (§5), and destructures its result as a tuple's array (Products §2.6) — at arity one, the value itself:

  ```
  match r                                   //  const [top, bottom] = rat.view(r);
      rat(0, _) => Zero                     //  if (top === 0n) return Zero;
      rat(n, 1) => Integer(n)               //  if (bottom === 1n) return Integer(top);
      rat(n, d) => Fraction(n, d)           //  return Fraction(top, bottom);
  ```

  Binder names follow Pattern Matching's emission as for tuples; the illustration names the array slots for legibility only.
- **An expression use** emits the call `rat.build(1n, 2n)`. Cross-module uses qualify through the emitted namespace import (Modules §11): `Rat.rat.view(r)`, `Rat.rat.build(1n, 2n)`.
- **The alias emits nothing.** `pattern rat = Rat.rat` is resolved statically; its uses emit the original's spelling. An *exported* alias emits a re-export of the original binding under the alias's name, so the `.d.ts` face below is the same object under two names.
- **The `.d.ts` face** (FFI Part 7): an exported pattern faces as its object — `export const rat: { view(x: Rat): [bigint, bigint]; build(top: bigint, bottom: bigint): Rat };` — the tuple as the array face Products §2.6 gives it, `build` absent from the face where absent from the declaration, and the subject's opaque brand crossing as Part 7 §5 says. A private pattern has no face.

---

## 7. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| `pattern` inside a function body or block | "declarations live at module level" (Declarations Preamble §7.1) |
| Head with no components | "a pattern has at least one component; a test with no components is a guard" (§2.1) |
| Block without `view` | "a pattern declares `view`" at the head (§2.1) |
| Member of another name, or a duplicate `view`/`build` | error at the member line (§2.1) |
| Delegation line whose right side is not a name (`build = (a, b) => …`, `build = create(1, 2)`) | parse error naming both forms: "a pattern member is `build(a, b) = …` or `build = name`" (§2.1) |
| `view` solving to `->?` or `->!` | Effects §4.3's pure-demand report, the demand being the head's (§2.1) |
| Member shape disagreeing with the head (arity, result) | error at the member naming the head's shape (§2.2) |
| `build`'s subject or components disagreeing with `view`'s | "`build` returns `Color`; `view` takes `Rat` — a pattern's two directions share one subject" (§2.2) |
| Exported pattern without a head | Modules §4.1.1's complete-signature error, the head as its fixit (§2.3) |
| `opaque pattern` | Modules §4.2's parse error (§2.3) |
| Bare pattern name in term position (`let x = Rat.rat`, an argument, a field) | "patterns are not values; write `pattern x = Rat.rat` to alias it, or `Rat.rat(a, b)` to build one"; at an argument seat the lambda is offered too (§2.4) |
| Dot on a pattern's name | Method Syntax's unknown-member refusal (§2.4) |
| Arity mismatch at a use; `rat =>` bare; `id()` | the constructor family's messages and hints (§3.1) |
| Expression use of a match-only pattern | "`rgb` is a match-only pattern: its declaration has no `build`", the declaration named (§3.2) |
| Bare head scope binds to a non-pattern; expected type's home holds the spelling | "`rgb` here is a binding of this module; this arm matches a `Color` — write `Color.rgb(r, g, b)`" (§3.3) |
| Bare head scope does not bind; expected type undetermined | "no bare `rgb` here: its type is not determined at this pattern — write `Color.rgb(r, g, b)`, or bind the function with its own annotated `let`"; "or ascribe the scrutinee" at a nested slot (§3.3) |
| Bare head scope does not bind; home exports no pattern of the spelling | "`Color` has no pattern `rbg`" + near miss (§3.3) |
| Constructor or record pattern over an opaque type abroad whose home exports patterns | "cannot destructure opaque record `Rat`; match it with `Rat.rat(top, bottom)`" — every exported pattern's spelling, capped (§3.3) |
| Alias whose right side is bare, an expression, or not a pattern | the three §3.4 refusals |
| Non-exhaustive `match` mixing views | the ordinary missing-cases report, the witness in the pattern's spelling (§4) |
| Doc comment on a member | "document the pattern at its head" (§2.1) |

---

## 8. Rejected alternatives (do not re-litigate without new information)

| Rejection | Reasoning |
|---|---|
| **The suffix seat** `(n, d)rat` — a tuple followed by the pattern's name, in both positions | Charming as a `Rat` literal, wrong as a general form. Hexagon has no 1-tuples, so a one-component view — an opaque newtype's, the commonest case — was unspellable. The expression side bought nothing: `rat(6, 10)` is an ordinary call. And it introduced an adjacency-sensitive seat to a language with no juxtaposition, for a reading the constructor pattern already teaches (§1). |
| **Deriving `view` from `build`**, or `build` from `view` | An arbitrary function is not invertible, and `Rat` shows why: `create(2, 4)` and `create(1, 2)` are one value. A union constructor does both because its declaration is constructor *metadata* — injective, argument-preserving — not a function; `create` is neither (§1). |
| **One function only** — F#'s active pattern, view alone | Subsumed: `build` is optional, and a pattern with only `view` *is* that design (§2.1). |
| **Always exported, never private** | Export is a declaration prefix, one rule (Modules §12.2); a private view is useful and costs nothing (§2.3). |
| **An import list for patterns** — `import Rat rat`, `import Rat (rat, rod)` | Reopens Modules §3's "a module and nothing smaller" (#762, #829) for a need the corpus already meets: the `pattern` alias is the `type` alias row (§3.4), and the door makes the line unnecessary in a pattern (§3.3). |
| **`let x = Rat.rat` as the alias** | It carries the build half and drops the view (§2.4). |
| **A distinguished default pattern per type** (`Rat(n, d)`) | Helps only types with one natural view; `Color` has `rgb` and `hsl`. A pattern is named (§1). |
| **Discovering the bare name by lowercasing the module, or by searching imports** | Action at a distance, ambiguity, and a search — the shape Modules §5.1 and Pattern Matching §2.2 refuse. The door reads one drawer the type names (§3.3). |
| **Patterns as first-class values** | Closes the alias hazard by construction and keeps the namespace story honest; the lambda over `build` covers every value use (§2.4). |
| **Mixed views specialising against each other** | The checker cannot relate two views; a coverage claim it cannot verify is not made (§4). |

---

## 9. Deferred

1. **Partial views** — `view: S -> Option((T1, …, Tn))`, F#'s `|_|`. The cheap design is on the table when wanted: a partial pattern counts for **nothing** toward coverage, as a guarded arm does (Pattern Matching §7.1), so no theory is added. Deferred until a total view proves inadequate in the field; parsing-shaped uses ("this string, if it is an integer") are the likely customer.
2. **Multi-case partitions** (`(|Even|Odd|)`) and **parameterised patterns** — not planned. The first needs the checker to trust a user partition; the second has no seat in a form whose parentheses are the component list.
3. **A pattern in a `catch` arm over a domestic exception** — the arm matches the open `Exn` (Exceptions §5.2), so only a pattern whose subject is `Exn` could stand there; none is offered, and nothing is reserved.

---

## 10. Decisions log

| Decision | Where |
|---|---|
| A pattern is a required pure `view` plus an optional `build`; the compiler inverts nothing; the law is the doc comment's | §1, §2.1, §5 |
| Head + member block, the `fun`/`honor` shape; members in header syntax or the delegation line `build = name`; arity ≥ 1; `view`/`build` are member names, not keywords | §2.1 |
| Head optional for a private pattern (subject and components inferred, a tuple result the component list); written for an exported one (Modules §4.1.1) | §2.2, §2.3 |
| Ordinary visibility slot; never `opaque`; the private-in-public rule reads the head | §2.3 |
| Patterns are not values; `let x = M.p` refused with the alias and the call named | §2.4 |
| Constructor-shaped in both positions; `as` binds the subject; irrefutable iff the components are; the case rule untouched | §3.1, §3.2 |
| Term-namespace name; in scope, qualified, aliased, or — in a pattern only — through the expected type's door, reading the home's exported patterns over the type; closed where the type is undetermined; never on a structural subject; reaches through `opaque`, and the opaque refusal names the exported patterns | §3.3 |
| `pattern name = Alias.p` aliases the whole pattern; exportable; never in a drawer | §3.4 |
| Coverage: a total view is a one-constructor shape; other forms in the column are dropped (sound, conservative); witnesses in the pattern's spelling | §4 |
| The view is applied at most once per pattern per position, before the arms | §5 |
| One emitted object per pattern, `{view, build?}`; the `.d.ts` faces it | §6 |
| Suffix seat, derivation, import list, `let` alias, default pattern, discovery, first-class patterns, cross-view specialisation — rejected | §8 |
| Partial, multi-case, parameterised — deferred or not planned | §9 |

---

## 11. Acceptance tests (golden: parse, inferred types, verdicts, diagnostics, emitted JS)

```
-- (a) The stdlib's pattern, and its two directions
-- module Rat: export pattern rat(top: BigInt, bottom: BigInt): Rat
--                 view(x) = (top(x), bottom(x))
--                 build = create
import Rat
let r = Rat.rat(6, 10)                       -- build: Rat.create(6n, 10n)
let Rat.rat(n, d) = r                        -- irrefutable; n = 3n, d = 5n
fun classify(r: Rat): String =
    match r
        rat(0, _) => "zero"                  -- bare: the door, Rat being r's type
        rat(_, 1) => "integer"
        rat(n, d) => "${n}/${d}"
-- emits, in classify: const [top, bottom] = Rat.rat.view(r); if (top === 0n) …

-- (b) The alias carries both faces; a let does not
import Rat
pattern rat = Rat.rat
let half = rat(1, 2)                         -- OK: build
let rat(n, d) = half                         -- OK: view
let mk = Rat.rat                             -- ERROR: patterns are not values; write
                                             --   pattern mk = Rat.rat to alias it, or
                                             --   Rat.rat(a, b) to build one

-- (c) Match-only, and the door on an opaque type abroad
-- module Color: opaque record Color = {...}
--               export pattern rgb(r: Int, g: Int, b: Int): Color
--                   view(c) = ...
--               export pattern hsl(h: Float, s: Float, l: Float): Color
--                   view(c) = ...
import Color
fun name(c: Color): String =
    match c
        rgb(0, 0, 0) => "black"
        hsl(_, 0.0, _) => "grey"
        _ => "colour"                        -- required: rgb and hsl rows never specialise together
fun bad(c: Color): String =
    match c
        rgb(0, 0, 0) => "black"
        hsl(_, _, _) => "any"                -- ERROR: match is missing cases: rgb(_, _, _)
let x = Color.rgb(0, 0, 0)                   -- ERROR: rgb is a match-only pattern: its
                                             --   declaration has no build
match c                                      -- ERROR: cannot destructure opaque record Color;
    Color({channels}) => ...                 --   match it with Color.rgb(r, g, b) or Color.hsl(h, s, l)

-- (d) The door is closed where the type is undetermined; scope wins over the door
let f = c => match c
    rgb(r, _, _) => r                        -- ERROR: no bare rgb here: its type is not
                                             --   determined at this pattern — write
                                             --   Color.rgb(r, _, _), or bind the function
                                             --   with its own annotated let
let rgb = 3
fun g(c: Color): Int =
    match c
        rgb(r, _, _) => r                    -- ERROR: rgb here is a binding of this module;
                                             --   this arm matches a Color — write Color.rgb(r, _, _)

-- (e) A private, unheaded pattern; a one-component pattern; the purity demand
opaque record UserId = {n: Int}
pattern id                                   -- infers: subject UserId, one component Int
    view(u) = u.n
    build(n) = UserId({n = n})
let id(n) = id(7)                            -- n = 7
pattern noisy
    view(u) =                                -- ERROR: a -> arrow promises purity, and this
        Debug.log!("viewed")                 --   function performs effects (Effects §4.3)
        u.n

-- (f) The declaration's own errors
pattern zero: Rat                            -- ERROR: a pattern has at least one component;
    view(x) = ()                             --   a test with no components is a guard
pattern lonely(n: Int): UserId               -- ERROR: a pattern declares view
    build(n) = UserId({n = n})
pattern twisted(top: BigInt, bottom: BigInt): Rat
    view(x) = (top(x), bottom(x))
    build = Color.mix                        -- ERROR: build returns Color; view takes Rat —
                                             --   a pattern's two directions share one subject
export pattern parts                         -- ERROR: exported pattern writes its head
    view(x) = (top(x), bottom(x))            --   (Modules §4.1.1)
fun h() =
    pattern local                            -- ERROR: declarations live at module level
        view(x) = x

-- (g) The .d.ts face
-- export const rat: { view(x: Rat): [bigint, bigint]; build(top: bigint, bottom: bigint): Rat };
-- export const rgb: { view(c: Color): [number, number, number] };
```
