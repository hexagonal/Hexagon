# Hexagon Spec: Pattern Declarations

**Status:** Decided (September 2026; #834).
**Scope:** The `pattern` declaration — a named way of matching a value, written as two ordinary functions: a required, pure `view` and an optional `build`. The head and its member block; inference of an unheaded private pattern; the suffix form `(p1, …, pn)name` in pattern and expression position; the pattern namespace (own declarations, imported exports, the `pattern` alias as the rename) and the expected-type door; coverage; evaluation and purity; emission and the `.d.ts` face; diagnostics; rejected alternatives; the standard library's first pattern, `Rat.rat`.
**Companions:** Pattern Matching (the grammar this spec adds one form to; §2.8/§8's no-user-code rule, whose one exception this is; §5 irrefutability; §7 coverage and witness rendering), Modules (§3 the carve for the pattern namespace; §3.2 the alias row; §4.1 export; §4.1.1 complete exported signatures; §4.2 `opaque`; §5.1 the namespaces; §5.4/§5.5 occlusion and contests; §12.2 re-exports), Declarations Preamble (§7.1 inventory, §7.2 straddling), Functions (§7.1 header syntax; §7.2 top-down reading; §7.3 the member block and the head's binders; §4.2 binders), Constraints (§4.1 member checking — the `honor` precedent; §6.1 the evidence suffix, whose absence §2.1 prices), Effects (§4.3 the pure demand), Products (§2.6 the tuple representation; §5.3 the explicit crossing), Statements (§5.1 the sequential-binder rule), Doc Comments (§4.2; §6.1 the throws manifest), Lexer (§4.2 the contextual head word), Lexer & Layout (§2.1 the block-head row), FFI Part 7 (the exported face; §2.2 binder naming), `rat.md` (§3, §6).

---

## 1. Doctrine

- **A pattern is a published way of matching a value.** Outside its home module an `opaque` type is a black box (Modules §4.2): no constructor, no fields, no destructuring — its consumers inspect it through exported functions and guards. A `pattern` declaration is the home module's way of saying *this is how you may take one apart*: it names a view, gives it a shape, and lets the ordinary pattern engine — nesting, binders, or-patterns, `as`, `let`, exhaustiveness — run over that shape. It exposes an **author-defined view, never a representation**: the storage may be unrelated to the components, and changing the components is a visible API change, as changing a constructor's arity is.
- **A pattern is two ordinary functions.** `view` takes the subject to its components; `build`, where present, takes components to a subject. Both obey every rule an ordinary function obeys — typing, evaluation order, effects, exceptions. The compiler adds the invocation syntax and the coverage meaning of a total view; it derives nothing and **inverts nothing**. `build(view(v)) == v` is the law a bidirectional pattern documents; `view(build(parts)) == parts` is deliberately not required, because `build` may canonicalise — `Rat`'s does.
- **One spelling, two positions, and it reads like a literal.** `(n, d)rat` destructures a `Rat` in a pattern and `(6, 10)rat` builds one in an expression: the component list in parentheses, the pattern's name as a suffix. The precedent is `5n` (Numeric Literals §1): a suffix that says what the thing in front of it is — a letter there, a name here. The parentheses are the list's — an argument list, not a tuple (Functions §5), so `(n)id` is a one-component pattern and no 1-tuple question arises — and the suffix seat is the pattern namespace's own: the name is written **against** the closing parenthesis, no whitespace between, as `5n` writes its letter against its digits, and nothing else in the language stands there — not the `let` header, not a guard's `when`, not a call (§3.1, §8). "The constructor is the way in; the constructor pattern is the way out" — Pattern Matching §2.2's reading of Products §5.3's explicit crossing — is the doctrine; a pattern declaration is that pair, authored, in a spelling of its own.
- **One interpretation, or a refusal.** A pattern's name resolves in the pattern namespace — the module's own patterns and the exported patterns of the modules it imports, own occluding, contests refused at the use — or, in a pattern, through one closed drawer the expected type names, or not at all (§3.3). Nothing is ranked, nothing is derived from a naming convention, and no type is inspected to choose between readings — the shape Modules §5.4/§5.5 and Pattern Matching §2.2's door already have. Adding an import can newly refuse a program; it can never silently change what one means.
- **A pattern is a name of one seat.** It lives in a namespace of its own (§3.3), is not a term, and is not a value: nothing binds half of it, and nothing passes it. Where the build direction is wanted as a function, the lambda over the expression form is it.

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

A **`pattern` head** — the contextual head word (Lexer §4.2), the pattern's non-uppercase-start name and, **together or not at all**, a binder list (Functions §4.2), a **component list**, and a **result type** — the whole head, or the bare name: a head that writes a binder list or a component list without the result type is refused at the head — "a pattern head is whole or absent: write the result type, or drop the component list", the slot it lacks named — since §2.2 has two modes and no third (a result type alone, `pattern zero: Rat`, is a zero-arity head and the arity rule takes it first; binders alone lack the result type and draw this refusal) — ends its logical item and opens a **member block** (Lexer & Layout §2.1's row; Functions §7.3's shape): a declaration sequence with no value. The head word has one other form, the alias `pattern name = Alias.p` (§3.4), which opens no block. A block's members are:

| Member | Required | Type, at a head `p(c1: T1, …, cn: Tn): S` |
|---|---|---|
| `view` | yes | `S -> (T1, …, Tn)` for *n* ≥ 2; `S -> T1` for *n* = 1 |
| `build` | no | `(T1, …, Tn) -> S` for *n* ≥ 2; `T1 -> S` for *n* = 1 |

- **The component names are the face's, and bind nothing.** `top` and `bottom` in the head name the components — in diagnostics, in the doc comment, in the `.d.ts` face (§6), and in the opaque refusal that names the pattern (§3.3) — and are not in scope in the members, whose parameters are their own: `view(x)` binds `x`, a header-syntax `build(a, b)` binds `a` and `b`, and `Rat`'s head may name its components `top` and `bottom` beside the module's functions `top` and `bottom` with nothing shadowed. A `fun` header's parameters bind in its body; a pattern head's components are a signature, not a binder list.
- **The component list is the pattern's arity**, *n* ≥ 1. A list of one component is legal — `pattern id(n: Int): UserId` — and is the ordinary shape for an opaque newtype; the parenthesised list is an argument list, never a tuple (Functions §5), so no 1-tuple question arises. A head with no components, `pattern zero: Rat`, is refused: a total view with nothing to bind matches every value and distinguishes none — "a pattern has at least one component; a test with no components is a guard".
- **A member is written in one of two forms.** *Header syntax* — `view(x) = body`, Functions §7.1's form, one per block item, no `fun` word — or the **delegation line** `build = create`: the member name, `=`, and the **name of a function**, bare or qualified through a module alias (`build = Rat.create`), which the member then *is*. Either member takes either form — `view = channels` delegates the view as `build = create` delegates the build, and a delegated `view`'s face names its parameter `value`, the head naming no subject. The right side of a delegation line is a name and nothing else — no lambda, no call, no expression: the member *is* the named function, and the declaration evaluates nothing to say so. The name is a **term read at the declaration's own line** (below), so the function it names is declared above, and the emitted reference (§6) is safe by the enforced source order that keeps every term reference safe (Functions §7.2's first leg) — no capture analysis, no ordering rule of the pattern's own. Constraints §4.1's lambda-only rule for `honor` members is not loosened by this — an `honor` member's right side is still a lambda and never a name — and neither is Functions §7.3's ban on `name = lambda` member lines — a `fun` block's member line is still a header and never a lambda; the delegation line is the pattern block's own form, a name and never a lambda, and `name = widened` (Constraints §4.7) is not admitted here. An `=` followed by anything but a name is a parse error naming both forms.
- **`view` and `build` are the member names**, not keywords: the block admits exactly these two spellings; `view` missing is an error at the head ("a pattern declares `view`"); a member of any other name, or a second `view`, is an error at that line. Elsewhere both are ordinary names.
- **`view` is pure.** Its arrow is the pure constant `->`: the head writes no arrow, and none is admitted, because a pattern's matching direction is a demand for purity (Effects §4.3) — the one seat where a pattern runs user code (§5) runs only code that cannot be observed running. A `view` whose body solves to `->?` or `->!` is refused at the member with §4.3's clause for this seat, whose "the pattern head's" names the declaration — the unheaded pattern included. `build` is unconstrained: its arrow is whatever its body or delegate has, and an expression use of the pattern is an ordinary call that wears the mark that arrow demands (Effects §3). Throwing is not an effect: `Rat.create` throws on a zero bottom, and `build = create` is pure.
- **Module level only, and read top-down at its own line.** `pattern` joins the Declarations Preamble §7.1 inventory: inside a function body or block it draws that family's error, "declarations live at module level". Its head's *types* are order-insensitive as every type reference is (§7.2). Everything else about it is a **term**, read top-down like `widens` (§7.1) and the member definitions it stands among: a member body reads the terms above it (a later function is Functions §7.2's declared-later error, as in any `let`-bound body), a delegation line's name must be declared above the pattern, and the pattern's own name enters the pattern namespace (§3.3) from its line onward — a use above it, in a `match` arm or an expression, is the declared-later error under Modules §5.4's reservation, never a different reading. The pattern emits at its source position (§6), which is what makes that law the whole of its ordering.
- **The head's binders are the block's, and carry no constraints.** `pattern top<a>(x: a): Stack(a)` declares `a` rigid over both members (Functions §7.3); members take no binder lists of their own, and an exported pattern writes every binder its members need (Modules §4.1.1). A **constraint list is refused** on a pattern head — `pattern sorted<a: Ord>(…)` draws "a pattern's binders carry no constraints" — and a pattern whose members leave a constraint residual — an unheaded one inferring it, or a headed one whose members constrain the head's binders — is refused the same way, the head named as the seat where the constraint would have to be written. The reason is priced, not presumed: a pattern emits as an object (§6), not a function, and Constraints §6.1's trailing evidence suffix — the language's only evidence representation — has no seat in it; a dictionary-taking factory is the design that would give it one (§9), and it is not taken here. A view that needs evidence is written as a function the consumer calls.
- **The doc comment attaches at the head** (Doc Comments §4.2): the head is the pattern's exported surface, the name a reader will paste, and the one doc that reaches the book. The members may carry docs too, as an `honor` block's member implementations may (Doc Comments §4.2) — optional, never canonical, and emitted as JSDoc on the object's properties (§6) for the JavaScript reader who meets `view` and `build` there. The head's doc is where a bidirectional pattern's throws manifest is written (Doc Comments §6.1) — `Rat.rat`'s doc says ``Throws `DivideByZeroError` when the bottom is zero.``, since `build` throws as `create` does — and it is where the law `build(view(v)) == v` is stated (§5).

### 2.2 Typing and inference

- **With a head, members are checked, not inferred** — the `honor` posture (Constraints §4.1): the expected type of each member is fixed by the head, the body checks against it, and the member's lambda parameters take their types from the head before the body is inferred (Functions §4.3's supplying seat). Annotations on a member are optional and must match the head's type exactly. A `build` whose parameter count differs from the component list or whose result is not the subject, or a `view` whose result is not the head's component tuple, is an error at the member naming the head's shape.
- **Without a head, the pattern infers** — legal for a *private* pattern only (an exported one writes its head, §2.3). The block is inferred as **one group**: `view`'s parameter type, `build`'s result type, and nothing else are the subject, unified; `view`'s result and `build`'s parameters are the components, unified — **a tuple result is the component list**, its arity the pattern's arity; any other result is one component. The subject is what the members determine, no more: a `view` whose unannotated parameter is used only by field access infers a **row-polymorphic structural** subject (Products §3.2's field-access constraint on an unknown type), which no nominal type unifies with (Products §5.1) — so a view over an opaque record annotates its parameter, `view(u: UserId) = u.n`, and a `build` returning `UserId` beside an unannotated `view(u) = u.n` is the consistency error below, whose fixit is that annotation. The one shape inference cannot express — a one-component pattern whose sole component is a tuple type — writes the head, which says so directly: `pattern contents(c: (Int, String)): Box`, matched as `((a, b))contents`. An unheaded pattern generalises as an unannotated `let` does (Functions §8); its subject may be a type variable only where the view's body leaves it one.
- **Consistency is unification, reported once, at the declaration.** For a headed pattern the head fixes both faces, and a member that disagrees with it is the member-shape error above; the two-directions report is the **unheaded** pattern's, where nothing but the other member fixes a face. Where `build`'s result does not unify with `view`'s subject, or its parameters with `view`'s components, the error is at `build` and names both faces: "`build` returns `Color`; `view` takes `Rat` — a pattern's two directions share one subject".
- **The subject may be any type** — nominal or structural, the module's own or another's. A pattern over a type declared elsewhere is written from that type's exported surface, and needs no orphan rule: a pattern is reached by *name*, never dispatched by type, so two modules declaring patterns over one type contest nothing. Only the door (§3.3) cares where the subject lives: it opens on a nominal type's home module and never on a structural type, which has none.

### 2.3 Visibility

`pattern` takes the head's ordinary visibility slot (Modules §4): `export pattern` crosses the module boundary, a bare `pattern` is private. `opaque` is a type's word and is refused before `pattern` with Modules §4.2's parse error. What `export` exports is the pattern — both directions, where both exist (Modules §4.1's table). Two rules of the exported face follow from the corpus and are restated so that nothing is presumed inferred across a boundary:

- **An exported pattern writes its head** — Modules §4.1.1's complete exported signature: every component's type, the subject, and every binder its members need. The head is the pattern's face in the `.d.ts` (§6), the target of its doc comment, and the reader's contract; it is also what makes a change to the components a change the diff shows.
- **The private-in-public rule reads the head** (Modules §4.3): an exported pattern whose subject or component types mention a private nominal of this module is refused at the offending seat, as an exported function's signature is.

---

## 3. Using a pattern

### 3.1 In pattern position

```
match r
    (0, _)rat => Zero
    (n, 1)rat => Integer(n)
    (n, d)rat => Fraction(n, d)

let (n, d)rat = r                          -- irrefutable: the view is total
fun sign((n, _)rat) = n.compare(0n)        -- a lambda head; the §3.1 gate is satisfied
match c
    (0, 0, 0)rgb => "black"
    (_, 0, _)hsl | (255, 255, 255)rgb => "achromatic"
    (r, g, b)rgb as colour => ...
let (n)id = user                           -- one component: the parentheses are the list's
```

The form is `(p1, …, pn)name` — a parenthesised list of exactly *n* full sub-patterns, then the pattern's **name as a suffix**: a non-uppercase-start name, bare, always (§3.3). It joins Pattern Matching §2's inventory beside the constructor pattern and is a pattern everywhere a pattern may stand (Pattern Matching §6): `match` and `catch` arms, `let`, `for..in`, lambda parameters, the match function's arms.

- **The parentheses are the component list's**, never a tuple's: `(p)name` is the one-component form — a group followed by a name is no other pattern, so `(p)` here is the list, not grouping — and `((p, q))name` is one component that is a tuple. `()name` is refused as §2.1 refuses the arity it would need. **Arity must equal the declaration's** — the constructor family's errors and hints (Unions §4.2; Pattern Matching §2.2): `(n)rat` draws "`rat` has 2 components; write `(_, _)rat`".
- **The name is written against the parenthesis.** No whitespace and no comment stands between `)` and the name — the two tokens are adjacent in the source — the `n` of `5n` against its digits, and the rule, not a formatting preference: `(0, 0) when g => e` is a tuple pattern with its guard, `(r) as s` an as-pattern, `record Pair(a, b) derives (Eq, Show) = …` a header — the contextual words `when`, `as`, and `derives` (Lexer §4.2) stand after a parenthesis with whitespace before them, and adjacency is what tells the seats apart. `(0, 0)when` would name a pattern `when`, which nobody declares and canonical formatting never writes. **The seat is a parenthesised primary** — a group that begins an operand — and no other parenthesis: a call's, a constructor's, or a dot call's argument list is no seat, so `f(a, b)rat` is the ordinary no-juxtaposition error (Functions §5), never a suffix on a call. The other way about, in an expression, `(a, b)rat(c)` parses: a suffixed form is a primary, a call's parentheses follow any primary (Operators §10's postfix level), and the call fails as an ordinary call on a `Rat` does — the parenthesis after the name is an argument list, never a second seat.
- **The suffix binds tightest.** It is a structural form, so `(r, g, b)rgb as colour` binds `colour` to the `Color` — `as` binds the **subject**, never the component tuple — and `(_, 0, _)hsl | (255, 255, 255)rgb` is an or-pattern of two suffixed forms under the same-bindings rule. In a lambda head the suffixed group is **one parameter**: `(n, d)rat => e` takes one `Rat`, where `(n, d) => e` takes two — the name against the parenthesis closes the group before the head's own parentheses are read (Pattern Matching §6.5). At `let`, the names a suffixed pattern binds are sequential binders under Statements §5.1, as every `let` pattern's are.
- **Typing** (Pattern Matching §4's list gains the row): the name resolves per §3.3; the scrutinee unifies with the pattern's subject at a fresh instantiation of its binders; the sub-patterns check against the instantiated component types. A namespace-resolved name may thereby determine an undetermined scrutinee, exactly as a constructor's does; a door-resolved name was determined by it.
- **Irrefutability** (Pattern Matching §5.1's table gains the row): `(p1, …, pn)name` is irrefutable iff every `pi` is — the view is total (§5's first law), so the outer form is always "sole constructor". This is what admits `let (n, d)rat = r` and the lambda head above; refutability enters only through the components.
- **No seat has an occupant.** With the name against its parenthesis, the form contends with nothing: not the function header at `let` (`let plus(x, y) = …` keeps its one meaning, and `let (n, d)rat = r` is unmistakably a destructure), not a call (whose argument list is no seat), not a tuple (whose parenthesis is followed by anything but a non-uppercase-start name written against it), not a lambda head. The case rule is untouched: uppercase-start heads are constructors, non-uppercase-start names without parentheses are binders, and the suffix is neither.

### 3.2 In expression position

```
let half = (1, 2)rat
"Does six tenths equal three fifths? ${(6, 10)rat == (3, 5)rat}"
let user = (7)id
```

`(e1, …, en)name` is an **ordinary call to `build`**: the parenthesised list is its argument list — arguments evaluated left to right, each once, no tuple built, `(e)name` one argument and `((a, b))name` one argument that is a tuple — the call typed and marked as any call is (Effects §3), the result the subject type. `(6, 10)rat == (3, 5)rat` holds because `build` canonicalises, and nothing about the form is involved in that. A pattern with no `build` is **match-only**, and its expression use is refused at the name: "`rgb` is a match-only pattern: its declaration has no `build`" — with the declaration named, since the repair is there. The name resolves in the pattern namespace exactly as in a pattern (§3.3), with one difference: **in an expression there is no door.** No expected type stands at `let half = (1, 2)rat` to name a drawer, and a form whose meaning depended on the type of its own arguments would be the search the language refuses; the namespace is the whole of expression-side resolution, and a name it lacks is the unknown-name error, "no `rat` here; `import Rat`", the import named only where exactly one module this module may import (Packages §3.1's visible set) exports the spelling (§3.3's bound). The form is a primary: `(1, 2)rat.toFloat()` is a dot call on the built `Rat` (Method Syntax), `(1, 2)rat.top` is field access on it — a bare dot is field access, always (Method Syntax §1), and abroad an opaque `Rat`'s field draws Modules §4.2's refusal — as `.` follows any primary, and `-(1, 2)rat` negates one — there is no qualified suffix for a dot to spell (§8).

### 3.3 The pattern namespace

A pattern's name lives in the **pattern namespace** — a namespace of its own, beside the type, constraint, term, and module-alias namespaces of Modules §5.1 — and in no other. `let rat` and `pattern rat` in one module collide with nothing — save at the boundary, where an exported pair is refused (§6); a term `rat` in scope never blocks the suffix; and `Rat.rat` in term position is the ordinary refusal that the name is not there — "module `Rat` exports no term `rat`; `rat` is a pattern, written `(a, b)rat`" — with nothing to say about values, because a pattern is not one and was never in the namespace where values live. A pattern is no member either: it has no receiver, so `r.rat(…)` is Method Syntax's ordinary unknown-member refusal and the bare `r.rat` is field access's missing-field family (Products §3.2), or the opaque sentence abroad.

**What the namespace holds.** A module's pattern namespace is filled from two sources, and the suffix seat reads it — in a pattern and in an expression alike — before anything else:

- **The module's own declarations**: every `pattern` block and every alias (§3.4) it declares, from its line onward (§2.1's reading law), and reserved module-wide from the first line (Modules §5.4). Two own declarations of one spelling — two heads, or a head and an alias — are a hard error at the second, the Declarations Preamble §7.3 shape one namespace over.
- **Every pattern exported by a module it imports**, module-wide — an import's contribution is order-insensitive at the suffix seat in both positions, the carve Modules §3's reading-law sentence states, so the formatter floating an import changes no verdict; only the module's own declarations read from their line. And from an import only: the prelude seeds nothing. Prelude modules are in scope without an import (Modules §5.5), and their exported patterns enter no namespace on that account, the seeding bullet of Modules §5.5 saying so for the pattern namespace as for the others; a prelude module's patterns enter by an explicit import of it (`import Hex.Option as Opt`), as any module's do, and the door reaches them regardless. A refused import (Modules §2.3) contributes nothing, as it binds no alias. Under two aliases onto one module (`import Rat` and `import Rat as R`) the patterns are one module's and enter once. So: `import Rat` puts `rat` in the namespace, `import Color` puts `rgb` and `hsl`, wherever the lines stand. This is the one seat at which an import's exports appear bare (Modules §3 states the carve): a pattern name is non-uppercase-start, lives where nothing else lives, and stands where nothing else stands, so nothing an import binds elsewhere is touched — no term, no type, no constructor, no constraint member is lifted, and Modules §9.11's reasons for refusing the named import — per-name collisions at the import, alias start classes, the namespace question — have no purchase on a namespace that has one start class, one seat, and collisions refused at the use.

**Three rules, the first two Modules' own one level down:**

- **Own wins silently.** A pattern the module declares or aliases occludes an imported one of the same name — Modules §5.4's shape — with no collision and no refusal: a library adding a pattern cannot break a module that already has one.
- **A contest is refused at the use, never ranked.** Where two imported modules export a pattern of one name and the module declares none, the suffix is refused **at the use**, naming both — "`rgb` is exported by `Color` and `Paint`; declare `pattern rgb = Color.rgb` or `pattern rgb = Paint.rgb`" — Modules §5.5's contested-name rule, the alias its repair. The imports themselves are untouched: no import ever collides with another on a pattern's account (Modules §5.2), a contest exists only where a use meets it, and a module that never writes the contested suffix never hears of it. The property this buys is Modules §5.5's: **adding an import can newly refuse a program, and can never silently change what one means** — which the third rule is what makes true.
- **The home's export is a contestant.** The rule is keyed on declarations, never on the scrutinee: where the namespace's entry for a name is an **imported** pattern of another module, and that pattern's own **declared subject** is a nominal type whose home exports a pattern of the same name, the two contest and every use of the name is refused naming both — "`rgb` here is `Paint.rgb`, over `Color`, whose home exports its own `rgb` — `import Color`, then declare `pattern rgb = Color.rgb`, or declare `pattern rgb = Paint.rgb`" — the import named, with its applied edit, because the rule fires only where the home is not imported and an alias's right side is a module alias (§3.4): a diagnostic never signposts a spelling the reader cannot write (Pattern Matching §7.3's third tier). Where the entry *is* the home's export — the home imported, and no other import exporting the name — there is nothing to contest; where the home is one of two imports exporting it, that is the second rule's refusal, whichever of the two is the home. Where the entry is the module's **own** declaration or alias, own wins as above: the author named the view, and a subject the own pattern does not fit is the mismatch below, its message naming the home's pattern. Where several imports contest a name and the declared subject's home exports it too, the home's joins the list, so the refusal names and offers every one. Nothing here reads an inferred type — a use with an undetermined subject is judged by the same declarations and refused the same way — which is what keeps the rule from resolving at one `let` and not the next (Modules §3.2's #763 record). Without it an `import Paint` added for another reason would silently move a working `(r, g, b)rgb` from `Color`'s view to `Paint`'s; with it, the import turns the match into a refusal, loud, at the use, wherever the import line stands.
- **A subject the pattern does not fit** is the ordinary unification failure, and it names the route: where the scrutinee's home exports a pattern of the spelling the namespace answered with, "`rat` here is this module's `rat`, over `Foo`; this pattern matches a `Rat`, whose home exports its own `rat` — rename with `pattern ratOf = Rat.rat` (`import Rat` first, where the module has not)" — Pattern Matching §12's constructor-rival row, one namespace over; where no such home pattern exists, the plain type error stands.

**The door, in pattern position.** Where the namespace has nothing for the name — the home was never imported, and no alias stands — the expected type's door opens: Pattern Matching §2.2's door, one drawer over. Where the pattern's expected type is a **nominal** type (a record, a union, a nominal alias's target), the name resolves among the **exported patterns of that type's home module whose subject is that type**; the type carries its declaration site wherever it flows (Modules §2.3), so the drawer is named without consulting the reporting module's imports, and the drawer is closed — a set the checker can list. A value produced by a module this one imports, of a type from a module it does not, is the case: `let (n, d)rat = Mid.make()` with no `import Rat`. Every property Pattern Matching §2.2 states for constructors holds here, and is restated only where the pattern case differs:

- **The door answers, never ranks.** The namespace is read module-wide and answers first; the door answers only where it has nothing, the contest rule above having been judged on declarations before any type is read. Nothing is searched: the door reads one module the type names.
- **The expected type must be determined when the pattern is checked.** At the top of a `match`, `let`, or `for..in` pattern the subject is typed first, and `match` §6.1's abstract-type refusal already guarantees a known head, so the door at a top-level pattern is never order-dependent. Beneath the top, and at a lambda parameter no supplying seat typed (Functions §4.3), the door reads the type as it stands — the licence Pattern Matching §2.2 already grants — and where it is undetermined the door is **closed**: "no `rgb` here: its type is not determined at this pattern — `import Color`, or bind the function with its own annotated `let`" — reading "or ascribe the scrutinee" at a nested slot, and naming the import only where exactly one module this module may import (Packages §3.1's visible set) exports a pattern of the spelling, the annotation alone otherwise — a repair the tooling names from the exported inventory, Modules §5.1's applied-edit obligation, never a resolution. The repairs are an import or an annotation; there is no qualified suffix, and none is offered. One meaning fewer, never a different one.
- **A structural type has no home** (Modules §2.3), so the door never opens on a tuple, a structural record, or a function type: a pattern over one is reached through the namespace alone.
- **Only the home's exports are in the drawer.** A pattern over `Color` declared in a *third* module is not reached by the door — it enters a namespace by import or alias, as any pattern does — and an alias (§3.4) is never in a drawer, because the drawer holds declarations. A `Color` whose home exports no pattern of the spelling draws "`Color` has no pattern `rbg`" with the near miss, and one whose home exports none at all draws, for an opaque type, Modules §4.2's own sentence (below).
- **The door reaches through `opaque`.** Opacity hides the constructor and the fields; it does not hide an *exported* pattern — that is the pattern's purpose. Where an opaque type's home exports at least one pattern over it, the opaque-destructure refusal (Pattern Matching §2.4) **names them**: "cannot destructure opaque record `Rat`; match it with `(top, bottom)rat`" — the pattern's own spelling, its components as declared, one per exported pattern up to a small cap — since a diagnostic that could name the door the reader was meant to take, and instead says only that this one is locked, has withheld the repair. Where the home exports none, the sentence stands as it is.

### 3.4 The `pattern` alias

```
import Color
import Paint                               -- both export rgb
pattern rgb = Color.rgb                    -- own: occludes both, the contest is over
match c
    (r, g, b)rgb => ...
```

`pattern name = Alias.p` declares `name` in this module's pattern namespace as **the same pattern** — view and build together, one identity — under this module's spelling: Modules §3.2's `type Point = Geo.Point` row with the word changed, and the row that section's table gains. Its work is the **rename**: resolving a contest (§3.3), or giving an imported pattern a local name (`pattern ratio = Rat.rat`). It is not needed to bring a pattern into scope — the import does that — and the ordinary module writes none. The right side is `Alias.p`, a module alias and an exported pattern's name, resolved in the aliased module's exported pattern namespace, and nothing else: a bare name is refused ("`rgb` is already in scope; an alias renames a pattern of another module"), an expression is refused naming the form, and a name that is not a pattern is refused naming what it is. The alias is a declaration in the pattern namespace, read from its line (§2.1), and it is **private**: `export pattern rgb = Color.rgb` is refused with Modules §12.2 named — an exported alias is a re-export, deferred as source syntax — so an alias never enters a door's drawer and the door still finds the home's export. Two spellings of one pattern in one module are legal and mean one pattern.

---

## 4. Coverage

Pattern Matching §7's usefulness matrix treats a total view as a **one-constructor shape**. Three clauses say what that means — specialisation, completeness, and the witness — and Pattern Matching §7.1 carries them by reference:

- **Signatures.** In a column, the heads the arms write sort into **signatures**: the *constructor signature* — the constructors of the column's type present in the column, complete iff every constructor of the type is (Pattern Matching §7.1's ordinary rule) — and **one signature per declared pattern present**, each complete by itself, since a total view is a one-constructor shape. A pattern the arms do not write enters no column: **declaring a pattern over a type changes the verdict of no existing match.**
- **Specialising a column on a head `c` of a signature** replaces the column by `c`'s sub-columns — a pattern's *n* components, a constructor's payload. A row headed by `c` contributes its sub-patterns; a wildcard or variable row contributes wildcards; a row headed by **any other signature's head** — another pattern over the type, or a constructor where a pattern is the head specialised on — is **dropped**, unless the row's pattern is **irrefutable at this column's type** — Pattern Matching §5.1's judgment, whatever form satisfies it: a declared pattern's row whose components are all irrefutable, a sole-constructor row whose components are, an exhaustive or-pattern, a tuple or record row of irrefutable parts; never a constructor of a union with more than one, whose row is refutable there — in which case it matches every value here and contributes wildcards, as a wildcard row does. Dropping is sound: the checker knows nothing about how two views of one value relate, and a claim that `(_, 0, _)hsl` covers some `(…)rgb` case would be a claim it cannot verify. It is conservative: a `match` whose arms mix `(…)rgb` and `(…)hsl` is exhaustive only through a catch-all, and the home module matching a nominal record both ways — `Point({x, y})` and `(r, t)polar` — takes the same rule.
- **Completeness, and the verdict.** A wildcard is *useful* in a column — the match is not exhaustive there — iff it is useful under **every complete signature present**, which for each means useful in the specialisation on some head of it, **and**, where the constructor signature present is incomplete or no signature is present, useful in the default matrix of the wildcard rows (Pattern Matching §7's ordinary incomplete-signature clause). The match is exhaustive, then, iff *some* complete signature's every specialisation is exhaustive: a value matched through any one view is matched, and a value the constructor arms cover is covered whatever pattern arms stand beside them.
- **The witness is deterministic, and always pastable.** It is built from one signature, in a fixed order: the constructor signature where present, else the declared patterns in the order their names first appear in the arms, top to bottom — so a report names the type's own shape where the arms use it, and `(_, _, _)rgb` for arms that use only views. A pattern's name in a witness prints **as the arms wrote it**: a signature is built from names the arms resolved, every such name is bare (§3.1), and a name the arms resolved pastes back where they stand — Pattern Matching §7.3's first tier, and the only one a pattern ever needs.
- **Reachability** is the same usefulness judgment with the arm's own pattern as the query, and the specialisation clause serves it unchanged. An arm under one pattern is shadowed by an arm under another only where that arm is a catch-all at the column: `(_, _, _)hsl` after `(_, _, _)rgb` is **dead** — the first arm is irrefutable, and Pattern Matching §7.2's catch-all rule stands — while `(_, 0, _)hsl` after `(0, 0, 0)rgb` is live, and stays live even where every black colour has zero saturation: the relation between two views is not the checker's to decide, so a dead arm under another view is not reported — the posture Pattern Matching §7.2 takes for a guard it cannot prove total. Exactness holds over what the checker can decide, and a cross-view relation is outside it. What it can decide it does: a query, **whatever its head**, is judged in its own specialisation **and**, as the wildcard is, beneath every other complete signature present — where the rows above are exhaustive under any of them — the type's constructors, or another view's — the arm is dead, so `(0)p` after `A` and `B` of `union Shade = A | B` is reported, no arm named as its shadower, since the constructor arms cover it jointly (Pattern Matching §7.2), and `(0)size` after `(True)flag` and `(False)flag` is reported the same way — as is a constructor arm `True` beneath them: exhaustiveness under some complete signature present means no value reaches the arm, whatever the arm's head, and an or-pattern row expands per alternative before any of this is judged (Pattern Matching §7.1). A wildcard row above shadows every form, and `(n, d)rat` after `(_, _)rat` is dead as any covered arm is.
- **Irrefutability** needs no clause: it is single-row exhaustiveness (Pattern Matching §5.1), and a single row headed by `p` is its own complete signature, exhaustive iff its components are.

---

## 5. Evaluation and purity

- **The one exception.** Pattern Matching §2.8 and §8 say patterns contain no calls and never invoke user code beyond the `Eq` test behind a literal. A declared pattern is the one exception: matching `(…)name` applies `view`. That is why §2.1 demands purity of `view` and of nothing else: the exception admits code that cannot be observed running.
- **The count is fixed, and unobservable.** For one evaluation of a `match`, `let`, loop step, or call, `view` is applied to the value at a pattern position **at most once per pattern per position**, before the arms are tested, and its result is shared by every arm reading that pattern at that position; a position no arm reaches is never viewed. A pure, total `view` makes the count unobservable, so this is a promise about emitted shape (§6) and cost — whether the view runs at all at a position is fixed by §6's shape, and a pattern nested beneath a refutable outer pattern is viewed only where the outer pattern has matched.
- **Components are read, never reconstructed.** The result of `view` is a value; its components are read into the sub-patterns as a tuple's are. Nothing is copied.
- **`build` is an ordinary function** (§3.2) and may do what a function may: throw, canonicalise, carry an effect arrow and demand its mark.
- **The laws are the author's, and totality is the first of them.** A `view` is **total**: it returns for every value of its subject type. Purity does not exclude throwing (§2.1), so nothing checks this; a `view` that throws or diverges breaks the law the coverage judgment (§4) and the irrefutability gate (§3.1) read, and the author who writes one has made `let (n, d)rat = r` a binding that can fail. `build(view(v)) == v` for a bidirectional pattern is stated in the pattern's doc comment and never checked; no law is required of `view(build(parts))`.

---

## 6. Emission and the exported face

- **One binding per pattern, one shape, at its source position.** A pattern emits as a single module-level binding of its own name holding a plain object with a `view` property and, where declared, a `build` property: `export const rat = {view: (x) => [top(x), bottom(x)], build: create};` — `export` mapping to `export` (Modules §11.1) — header syntax emitting the function, and the delegation line emitting what a reference to the named function emits under Constraints §6.1: the bare name for an unconstrained delegate (`build: create`), and for a **constrained** one whose constraints the head's types discharge — `build = wrap` with `wrap<a: Show>(x: a): Box` under a ground head — the evidence-applied value, the lambda closing over the pinned instance (`build: (x) => wrap(x, __Show_Int)`, the instance under Constraints §6.1's minted spelling) — Constraints §6.1's governing sentence, the boundary being evidence dischargeability at the reference. A constraint the head's types leave undischarged is the head's own refusal (§2.1); a delegate has no refusal of its own. The head's doc comment rides the binding as JSDoc, and a member's doc rides its property — the record-field seat's shape (Doc Comments §7.1). It is emitted where the declaration stands, among the term bindings, and the direct reference `build: create` is safe there by the source order §2.1 enforces (Functions §7.2's first leg: the delegate is declared above) — no DAG ordering of the Constraints §6.3 kind is needed, because a pattern's emitted binding is an ordinary term binding, not evidence. Match-only and bidirectional patterns take the one shape, and a JavaScript reader finds both directions under the name the Hexagon reader uses.
- **Matching** hoists the view before the arm tests, once per pattern per position (§5), and destructures its result as a tuple's array (Products §2.6) — at arity one, the value itself:

  ```
  match r                                   //  const [n, d] = rat.view(r);
      (0, _)rat => Zero                     //  if (n === 0n) return Zero;
      (n, 1)rat => Integer(n)               //  if (d === 1n) return Integer(n);
      (n, d)rat => Fraction(n, d)           //  return Fraction(n, d);
  ```

  Binder names follow Pattern Matching's emission as for tuples; the illustration names the array slots for legibility only.
- **An expression use** emits the call `rat.build(1n, 2n)`. A pattern of another module is reached through that module's emitted namespace import (Modules §11): `Rat.rat.view(r)`, `Rat.rat.build(1n, 2n)`. A pattern the **door** resolved from a home this module never imported is reached the same way, through a namespace import the emitter adds for the home — Modules §11's second liberty, the one it grants a resolved companion dot call (§11 item 2; Method Syntax §8.2), exercised for a pattern the checker resolved; load order is unaffected, since the home is already in the graph of whichever module produced the value.
- **A term of the same name.** `let rat` and `pattern rat` in one module are two JavaScript bindings, and the **private** one takes the emitter's collision-only alias (`rat_1` — Modules §11 item 2's idiom) while an exported one keeps the plain name — a published name never moves (FFI Part 7 §1.1) — and where neither is exported the pattern yields; the one case a JavaScript reader meets the suffix, and only because the Hexagon reader wrote both. Where **both are exported** there is no alias to take: a published name is one name (FFI Part 7 §1.1), so `export pattern rat` beside `export let rat` is refused at the second declaration — "this module already exports `rat`; an exported pattern and an exported term cannot share a name" — the one collision the two namespaces have, and it is the boundary's, not the language's.
- **The alias emits nothing.** `pattern rgb = Color.rgb` is resolved statically; its uses emit the original's spelling, and an alias is never exported (§3.4).
- **The `.d.ts` face** (FFI Part 7): an exported pattern faces as its object — `export const rat: { view(x: Rat): [bigint, bigint]; build(top: bigint, bottom: bigint): Rat };` — the tuple as the array face Products §2.6 gives it, `build` absent from the face where absent from the declaration, and the subject's opaque brand crossing as Part 7 §5 says. A **polymorphic** pattern's head binders are bound **at each member**, as method-level type parameters — `export const top: { view<a>(x: Stack<a>): a; build<a>(x: a): Stack<a> };` — named as Part 7 §2.2 names Hexagon binders; this is the one place a non-function declaration's variables are bound rather than instantiated at `never` (Part 7 §14.1), because the members are the functions and the object is only their roof. A private pattern has no face.

---

## 7. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| `pattern` inside a function body or block | "declarations live at module level" (Declarations Preamble §7.1) |
| Head with no components; `()name` at a use | "a pattern has at least one component; a test with no components is a guard" (§2.1, §3.1) |
| Partial head — a component list without a result type; binders alone (a result type alone is a zero-arity head, and the arity row above leads) | "a pattern head is whole or absent: write the result type, or drop the component list", the missing slot named (§2.1) |
| Block without `view` | "a pattern declares `view`" at the head (§2.1) |
| Member of another name, or a duplicate `view`/`build` | error at the member line (§2.1) |
| Delegation line whose right side is not a name (`build = (a, b) => …`, `view = f(x)`) | parse error naming both forms on the offending member: "a pattern member is `build(a, b) = …` or `build = name`" (§2.1) |
| `view` solving to `->?` or `->!` | Effects §4.3's unwritten-demand clause: "a pattern's `view` is run by matching, so it is pure — the demand is the pattern head's, and this function's face is `->?` or `->!`" (§2.1) |
| Constraint list on a pattern head; a residual constraint inferred for an unheaded pattern | "a pattern's binders carry no constraints", the head named as the seat (§2.1) |
| Delegation line naming a function declared below the pattern; a member body reading a later term; a use of the pattern above its line | Functions §7.2's declared-later error (§2.1) |
| Member shape disagreeing with the head (arity, result) | error at the member naming the head's shape (§2.2) |
| `build`'s subject or components disagreeing with `view`'s | "`build` returns `Color`; `view` takes `Rat` — a pattern's two directions share one subject" (§2.2) |
| Exported pattern without a head | "an exported pattern writes its head: `pattern rat(top: BigInt, bottom: BigInt): Rat`" — Modules §4.1.1's #834 paragraph, the head as its fixit (§2.3) |
| `opaque pattern` | Modules §4.2's parse error (§2.3) |
| A pattern's name in term position (`Rat.rat`, `let x = Rat.rat`) | "module `Rat` exports no term `rat`; `rat` is a pattern, written `(a, b)rat`" (§3.3) |
| Dot on a pattern's name | `r.rat(…)`: Method Syntax's unknown-member refusal; bare `r.rat`: the missing-field family (Products §3.2), or the opaque sentence abroad (§3.3) |
| Arity mismatch at a use | the constructor family's message: "`rat` has 2 components; write `(_, _)rat`" (§3.1) |
| Expression use of a match-only pattern | "`rgb` is a match-only pattern: its declaration has no `build`", the declaration named (§3.2) |
| Exported pattern beside an exported term of one name | "this module already exports `rat`; an exported pattern and an exported term cannot share a name" at the second (§6) |
| Exported pattern whose head mentions a private nominal of this module | Modules §4.3's private-in-public refusal at the offending seat (§2.3) |
| Imported pattern whose declared subject's home exports a pattern of the same name | "`rgb` here is `Paint.rgb`, over `Color`, whose home exports its own `rgb` — `import Color`, then declare `pattern rgb = Color.rgb`, or declare `pattern rgb = Paint.rgb`" at every use, the import's applied edit attached; with several imports contesting, the home's joins the list (§3.3) |
| Two own declarations of one pattern name — two heads, or a head and an alias | hard error at the second (§3.3) |
| Own pattern that does not fit the subject, whose home exports one of the spelling | "`rat` here is this module's `rat`, over `Foo`; this pattern matches a `Rat`, whose home exports its own `rat` — rename with `pattern ratOf = Rat.rat` (`import Rat` first, where the module has not)" (§3.3) |
| Suffix contested by two imports, none own | "`rgb` is exported by `Color` and `Paint`; declare `pattern rgb = Color.rgb` or `pattern rgb = Paint.rgb`" at the use (§3.3) |
| Suffix in scope nowhere; expected type undetermined — a lambda parameter under no supplying seat, or a nested slot a later arm fixes (at a `match` scrutinee's own binder Pattern Matching §6.1's refusal leads) | "no `rgb` here: its type is not determined at this pattern — `import Color`, or bind the function with its own annotated `let`"; "or ascribe the scrutinee" at a nested slot; the import named only where exactly one visible module (Packages §3.1) exports the spelling (§3.3) |
| Suffix in scope nowhere; expected type's home exports no pattern of the spelling | "`Color` has no pattern `rbg`" + near miss (§3.3) |
| Suffix in scope nowhere in an expression | "no `rat` here; `import Rat`" — the unknown-name family, the home named where exactly one visible module (Packages §3.1) exports a pattern of the spelling — Modules §5.1's applied-edit obligation, a repair from the exported inventory, never a resolution — and the bare unknown-name report otherwise (§3.2, §3.3) |
| A pattern's name written off its parenthesis — `(n, d) rat` | Functions §5's no-juxtaposition error, with the adjacency clause: "a pattern's name is written against the parenthesis: `(n, d)rat`" (§3.1) |
| A contextual word against the parenthesis with no pattern of that name in scope — `(0, 0)when g`, `(r)as s`, `(a, b)derives` | "a guard's `when` stands off the parenthesis; write `(0, 0) when g`" — the near-miss row the adjacency rule creates, for `when`, `as`, and `derives` (§3.1) |
| Constructor or record pattern over an opaque type abroad whose home exports patterns | "cannot destructure opaque record `Rat`; match it with `(top, bottom)rat`" — every exported pattern's spelling, capped (§3.3) |
| Alias whose right side is bare, an expression, or not a pattern; `export` on an alias | the §3.4 refusals; the export refusal names Modules §12.2 |
| Non-exhaustive `match` mixing views | the ordinary missing-cases report, the witness as the arms wrote it (§4) |
| Arm, whatever its head, dead beneath a catch-all of another view or beneath a complete signature present in the column — the type's constructors, or another view's | Pattern Matching §7.2's report, naming the shadowing arm where one subsumes alone and none where several cover jointly (§4) |

---

## 8. Rejected alternatives (do not re-litigate without new information)

| Rejection | Reasoning |
|---|---|
| **The prefix spelling** `rat(n, d)`, constructor-shaped, in both positions | Its seat has an occupant: `let rat(n, d) = r` is already the header sugar for a function named `rat` (Functions §3.2), and the destructure could be read there only by a scope rule, with the door shut at `let` for good — the seat the importer wanted most. Written against its parenthesis, the suffix has no occupant anywhere (§3.1). The resemblance to a constructor was the argument for it, and it was an aesthetic one. |
| **A qualified suffix** `(n, d)Rat.rat` | It reads as a mistake, and it is never needed: the namespace is filled by imports and the door reaches an unimported home (§3.3). No spelling exists, and the closed-door refusal offers an import or an annotation, not a qualification. |
| **Deriving `view` from `build`**, or `build` from `view` | An arbitrary function is not invertible, and `Rat` shows why: `create(2, 4)` and `create(1, 2)` are one value. A union constructor does both because its declaration is constructor *metadata* — injective, argument-preserving — not a function; `create` is neither (§1). |
| **One function only** — F#'s active pattern, view alone | Subsumed: `build` is optional, and a pattern with only `view` *is* that design (§2.1). |
| **Always exported, never private** | Export is a declaration prefix, one rule (Modules §12.2); a private view is useful and costs nothing (§2.3). |
| **A selection list on the import** — `import Rat rat`, `import Rat (rat, rod)` | Ceremony over the automatic namespace: an import already says which module's patterns it means, and a list re-says it per name. The namespace takes every exported pattern and refuses contests at the use (§3.3), which is what the list would have bought, without the list. |
| **`let rat = Rat.rat` as an alias**, or patterns as values | A pattern is not a term (§3.3): a `let` binds a value, and the value would have been the build half alone. The lambda over the expression form covers every value use. |
| **A distinguished default pattern per type** (`(n, d)Rat`) | Helps only types with one natural view; `Color` has `rgb` and `hsl`. A pattern is named (§1). |
| **Discovering a name by lowercasing the module, or by ranking imports** | Action at a distance, and a ranking — the shape Modules §5.5 refuses. Own occludes, contests are refused, the door reads one drawer (§3.3). |
| **An expression-side door** | No expected type stands at `let half = (1, 2)rat`; a form whose meaning depended on its arguments' types would be a search (§3.2). |
| **Mixed views specialising against each other** | The checker cannot relate two views; a coverage claim it cannot verify is not made (§4). |

---

## 9. Deferred

1. **Partial views** — `view: S -> Option((T1, …, Tn))`, F#'s `|_|`. The cheap design is on the table when wanted: a partial pattern counts for **nothing** toward coverage, as a guarded arm does (Pattern Matching §7.1), so no theory is added. Deferred until a total view proves inadequate in the field; parsing-shaped uses ("this string, if it is an integer") are the likely customer.
2. **Multi-case partitions** (`(|Even|Odd|)`) and **parameterised patterns** — not planned. The first needs the checker to trust a user partition; the second has no seat in a form whose parentheses are the component list.
3. **Constrained pattern heads** — `pattern sorted<a: Ord>(…)`. Refused in §2.1 for want of an evidence seat. The design that would admit them is a dictionary-taking **factory** — the pattern emitting as `(dictOrd) => ({view, build})`, applied at each use with the site's evidence, a `match` site included; it is a second emitted shape and a second evidence route, and it waits for a pattern that needs it.
4. **A pattern in a `catch` arm over a domestic exception** — the arm matches the open `Exn` (Exceptions §5.2), so only a pattern whose subject is `Exn` could stand there; none is offered, and nothing is reserved.

---

## 10. Decisions log

| Decision | Where |
|---|---|
| A pattern is a required pure `view` plus an optional `build`; the compiler inverts nothing; the law is the doc comment's | §1, §2.1, §5 |
| Head + member block, the `fun`/`honor` shape; members in header syntax or the delegation line `build = name`; arity ≥ 1; `view`/`build` are member names, not keywords; the head's component names bind nothing; binders admitted, constraints refused (no evidence seat in an object) | §2.1 |
| A pattern is read top-down at its own line, like `widens` — members, delegate, and its name from there on; its head's types order-insensitive; emitted at its source position | §2.1, §6 |
| The head is the whole head or the bare name — no partial head; optional for a private pattern (subject and components inferred as one group, a tuple result the component list); written for an exported one (Modules §4.1.1) | §2.1, §2.2, §2.3 |
| Ordinary visibility slot; never `opaque`; the private-in-public rule reads the head; member docs optional beside the head's | §2.1, §2.3 |
| The suffix spelling `(p1, …, pn)name` in both positions, bare always — `5n`'s seat with a name in it, the name **against** the parenthesis (adjacency is the rule; `when`/`as`/`derives` stand off); the seat is a parenthesised primary, never a call's list; one parameter in a lambda head; the parentheses are the component list's; `(p)name` is one component; `as` binds the subject; irrefutable iff the components are | §1, §3.1, §3.2 |
| The pattern namespace: a namespace of its own, filled by the module's declarations (read from their line, reserved module-wide) and by every imported module's exported patterns (read module-wide, at the suffix seat in both positions — the carve in Modules §3's reading law) — the prelude seeds nothing; own occludes, contests refused at the use, **the home's export a contestant** (an imported pattern whose declared subject's home exports the name is refused at every use — keyed on declarations, never the scrutinee — so an added import can refuse but never re-mean); the one seat where an import's exports appear bare (Modules §3's carve) | §3.3 |
| The door, in pattern position only: an unimported home's exported patterns over the expected type; closed where the type is undetermined, with an import or an annotation as the repair; never on a structural subject; reaches through `opaque`, and the opaque refusal names the exported patterns | §3.3 |
| `pattern name = Alias.p` renames — a contest's repair; private, never exported (Modules §12.2) | §3.4 |
| Coverage: a total view is a one-constructor shape — one signature per pattern present; specialising drops other signatures' rows save those irrefutable at the column's type, which are wildcard rows (so a catch-all under one view shadows the next, and Pattern Matching §7.2 stands; cross-view relations are outside exactness); exhaustive iff some complete signature's every specialisation is; the witness from the constructor signature, else the first pattern written, always as the arms wrote it; an arm, whatever its head, dead beneath a complete signature present in the column, cross-view relations otherwise outside exactness; a pattern the arms do not write changes no verdict | §4 |
| The view is applied at most once per pattern per position, before the arms | §5 |
| One emitted object per pattern, `{view, build?}`, the collision-only alias on the private one where a term shares the name, an exported pair refused (one published name); a constrained delegate emits per Constraints §6.1; a door-resolved unimported home reached through an emitted namespace import; the `.d.ts` faces the object, a polymorphic pattern's binders bound per member | §6 |
| Prefix spelling, qualified suffix, derivation, selection list, `let` alias, default pattern, discovery by ranking, expression-side door, cross-view specialisation — rejected | §8 |
| Partial, multi-case, parameterised, constrained heads — deferred or not planned | §9 |

---

## 11. Acceptance tests (golden: parse, inferred types, verdicts, diagnostics, emitted JS)

```
-- (a) The stdlib's pattern, and its two directions, under import Rat
-- module Rat: export pattern rat(top: BigInt, bottom: BigInt): Rat
--                 view(x) = (top(x), bottom(x))
--                 build = create
import Rat
let r = (6, 10)rat                           -- emits: Rat.rat.build(6n, 10n)
let (n, d)rat = r                            -- irrefutable; n = 3n, d = 5n
let same = (6, 10)rat == (3, 5)rat           -- True
fun classify(r: Rat): String =
    match r
        (0, _)rat => "zero"
        (_, 1)rat => "integer"
        (n, d)rat => "${n}/${d}"
-- emits, in classify: const [n, d] = Rat.rat.view(r); if (n === 0n) …

-- (b) The door: an unimported home; a term of the same name blocks nothing
-- module Mid: import Rat; export fun make(): Rat = Rat.create(1, 3)
import Mid                                   -- Rat never imported here
let (n, d)rat = Mid.make()                   -- OK: the door, Rat being the subject's home
let x = (1, 3)rat                            -- ERROR: no rat here; import Rat
let rat = 3                                  -- a term; the pattern namespace is untouched
let (p, q)rat = Mid.make()                   -- OK

-- (c) Match-only, and the door on an opaque type abroad
-- module Color: opaque record Color = {...}
--               export pattern rgb(r: Int, g: Int, b: Int): Color
--                   view(c) = ...
--               export pattern hsl(h: Int, s: Int, l: Int): Color
--                   view(c) = ...
import Color
fun name(c: Color): String =
    match c
        (0, 0, 0)rgb => "black"
        (_, 0, _)hsl => "grey"
        _ => "colour"                        -- required: rgb and hsl rows never specialise together
fun bad(c: Color): String =
    match c
        (0, 0, 0)rgb => "black"
        (_, 0, _)hsl => "grey"               -- ERROR: match is missing cases: (_, _, _)rgb
fun any(c: Color): String =
    match c
        (0, 0, 0)rgb => "black"
        (_, _, _)hsl => "any"                -- OK: exhaustive — the hsl row is irrefutable
        (1, 1, 1)rgb => "never"              -- ERROR: this case is unreachable; the arm
                                             --   (_, _, _)hsl above already covers it
let x = (0, 0, 0)rgb                         -- ERROR: rgb is a match-only pattern: its
                                             --   declaration has no build
fun channels(c: Color): Int =
    match c                                  -- ERROR: cannot destructure opaque record Color;
        Color({channels}) => channels        --   match it with (r, g, b)rgb or (h, s, l)hsl

-- (d) The door is closed where the type is undetermined; contests; the alias
-- module Lone (sees Color, and no other module exporting rgb):
let g = ((r, _, _)rgb) => r                  -- ERROR: no rgb here: its type is not
                                             --   determined at this pattern — import Color,
                                             --   or bind the function with its own annotated let
-- module Paint: export pattern rgb(r: Float, g: Float, b: Float): Color
-- module Two:
import Color
import Paint                                 -- OK: imports never collide on a pattern
fun g(c: Color): Int =
    match c
        (r, _, _)rgb => r                    -- ERROR: rgb is exported by Color and Paint;
                                             --   declare pattern rgb = Color.rgb or
                                             --   pattern rgb = Paint.rgb
-- module Palette: import Color; export fun black(): Color = ...
-- module One:
import Paint                                 -- Color never imported: the contest is keyed on
import Palette                               --   Paint.rgb's declared subject, no type read
fun k(): Int =
    match Palette.black()
        (r, _, _)rgb => r                    -- ERROR: rgb here is Paint.rgb, over Color, whose
                                             --   home exports its own rgb — import Color, then
                                             --   declare pattern rgb = Color.rgb, or declare
                                             --   pattern rgb = Paint.rgb
-- module Named:
import Color
import Paint
pattern rgb = Color.rgb                      -- own: the contest is over (a use above this line
                                             --   would be the declared-later error, never a contest)
fun h(c: Color): Int =
    match c
        (r, _, _)rgb => r                    -- OK: Color.rgb
export pattern rgb2 = Paint.rgb              -- ERROR: an exported alias is a re-export;
                                             --   re-exports are deferred (Modules §12.2)

-- (e) A private, unheaded pattern; a one-component pattern; the purity demand
opaque record UserId = {n: Int}
pattern id                                   -- infers: subject UserId, one component Int
    view(u: UserId) = u.n                    --   (unannotated, u.n would infer a structural
    build(n) = UserId({n = n})               --   row, and build's UserId would not unify)
let (n)id = (7)id                            -- n = 7
let t = (7)id.n                              -- 7: the dot is on the built UserId, and this is its home
pattern noisy
    view(u) =                                -- ERROR: a pattern's view is run by matching, so it
        Debug.log!("viewed")                 --   is pure — the demand is the pattern head's, and
        u.n                                  --   this function's face is ->! (Effects §4.3)

-- (f) The declaration's own errors (module Fraction: opaque record Fraction = {top: BigInt, bottom: BigInt};
--     export let create/top/bottom as Rat's; record Box = {n: Int}; let box(a: BigInt, b: BigInt): Box = …; record Span(a) = {lo: a, hi: a})
pattern zero: Fraction                       -- ERROR: a pattern has at least one component;
    view(x) = ()                             --   a test with no components is a guard
pattern lonely(top: BigInt, bottom: BigInt): Fraction   -- ERROR: a pattern declares view
    build = create
pattern twisted                              -- unheaded: the members fix each other
    view(x) = (top(x), bottom(x))
    build = box                              -- ERROR: build returns Box; view takes Fraction —
                                             --   a pattern's two directions share one subject
pattern shaped(top: BigInt, bottom: BigInt): Fraction
    view(x) = (top(x), bottom(x))
    build = box                              -- ERROR: build returns Box; the head says Fraction
                                             --   (the member-shape error: the head fixes it)
export let rat(t: BigInt, b: BigInt): Fraction = create(t, b)
export pattern rat(top: BigInt, bottom: BigInt): Fraction   -- ERROR: this module already exports rat;
    view(x) = (top(x), bottom(x))            --   an exported pattern and an exported term
                                             --   cannot share a name
export pattern parts                         -- ERROR: an exported pattern writes its head:
    view(x) = (top(x), bottom(x))            --   pattern parts(c1: BigInt, c2: BigInt): Fraction
fun k() =
    pattern local                            -- ERROR: declarations live at module level
        view(x) = x
pattern sorted<a: Ord>(lo: a, hi: a): Span(a)  -- ERROR: a pattern's binders carry no constraints
    view(s) = (s.lo, s.hi)
pattern halves(top: BigInt, bottom: BigInt)  -- ERROR: a pattern head is whole or absent: write
    view(x) = (top(x), bottom(x))            --   the result type, or drop the component list
pattern early(top: BigInt, bottom: BigInt): Fraction
    view(x) = (top(x), bottom(x))
    build = later                            -- ERROR: later is declared later in this block;
let later(t: BigInt, b: BigInt): Fraction = create(t, b)   --   declarations are read top-down
let (n, d, e)rat = create(1, 2)              -- ERROR: rat has 2 components; write (_, _)rat

-- (g) The .d.ts face
-- export const rat: { view(x: Rat): [bigint, bigint]; build(top: bigint, bottom: bigint): Rat };
-- export const rgb: { view(c: Color): [number, number, number] };
```
