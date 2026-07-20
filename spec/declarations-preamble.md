# Hexagon Spec: Declarations Preamble

**Status:** Decided (July 2026). **Permanent host of two corpus-wide doctrines: the Rewrite Rule (§1.1) and the Deferred-Goals Doctrine (§1.2).**
**Scope:** Corpus doctrine: the Rewrite Rule and the Deferred-Goals Doctrine (§1.1–§1.2). The shared header grammar for the type-introducing declarations (`record`, `union`, `type`): parameter form, the `derives` clause's header position, layout continuation for multi-line declarations. The `type` alias declaration in full: transparency, parameterization, the recursion ban, the no-instances rule, display stickiness, `.d.ts` emission. Consolidation: the module-level declaration inventory and site rule, order-insensitivity and mutual recursion among declarations, the type-namespace duplicate rule.
**Not in scope:** `derives` *semantics* — the derivable set, superconstraint checks, coherence, per-constraint generated code (Decisions Batch §2, unchanged; this doc fixes only the clause's position), the constraint mechanism and `honor` (Constraints spec), constructor semantics and payload grammar (Unions §2, Products §5 — this doc fixes only their shared header), cross-module name management, imports, qualification (Modules), implied `type` members in `constraint`/`honor` bodies (Collections Part 2 §§5–8 owns their v1 grammar and rules).
**Companions:** Products §5 (nominal `record` semantics; the header was deferred here), Unions §2 (union semantics; header and layout-continuation note deferred here), Constraints (angle-brackets-vs-parens kind distinction §1; instance machinery), Decisions Batch 2026-07 §2 (derivation mechanism; placement superseded), Exceptions §2 (module-level-only rule, generalized here), Lexer & Layout (offside continuation), `method-syntax.md` §10 (the Deferred-Goals Doctrine's first citing feature).

---

## 1. Doctrine

- **One header grammar for the three type-introducing declarations.** `record`, `union`, and `type` share `keyword Name [(params)] [derives ConstraintList] =` followed by the form's own body. One rule, three keywords; no per-keyword header dialects.
- **Header parameters are bare type variables.** No constraints in data-declaration headers, permanently (§2.2). Constraints do their work at functions, instances, and `constraint` declarations; parens after an uppercase-start name remain exclusively "type parameters of a type constructor" (Constraints §1's kind distinction), and `<>` never appears in a data header.
- **`derives` lives in the header, before `=` — the only position.** Capabilities read before representation; the clause is a statement about what you can *do* with the type and precedes the statement of what the type *is*. This supersedes the body-trailing placement of Decisions Batch §2.5 (edit note §10). Semantics are untouched: the clause remains pure sugar for a bundle of `honor C<Name> = derive` instances.
- **`type` is the transparent half of a deliberate pair.** The language now has both tools and the docs must present them together: `type` for "same type, better name" (expanded away by the unifier, no instances, no runtime anything) and `record`/single-constructor `union` for "genuinely new type" (nominal wall, instance-capable, pattern-destructurable). Half the diagnostics in §5 exist to route users from the first tool to the second at the moments they reach for nominal power through an alias.
- **Module-level declarations are order-insensitive and may be mutually recursive** where their semantics permit (§7) — mirroring `fun` hoisting at the term level. Aliases are the exception that proves it: their expansion-based semantics is exactly why *their* recursion is banned (§5.4).

### 1.1 The Rewrite Rule (corpus doctrine; permanent home)

> **Every restrictive hard error must have a local, obvious rewrite — and the diagnostic must name it.**

Hexagon has **no warning tier**; everything it rejects, it rejects fully. That posture is only humane if the path from any rejection to legal code is short and visible from the error itself — the Rewrite Rule is what completes the no-warning-tier stance rather than merely accompanying it.

Operational form, binding on every spec session:

1. Any new hard error enters its spec's **diagnostics checklist with its rewrite in the message or fixit**. A restriction whose row cannot name a local rewrite is **returned to design or recorded as an open question** — it does not ship as a bare rejection.
2. **Where no simple rewrite exists, the restriction itself is suspect.** "Restructure your program" is not a local rewrite.

**"Local" means: at the error site, using constructs already in the language.** The rule does not require the rewrite to be pleasant — only present, nameable, and applicable where the error points.

### 1.2 The Deferred-Goals Doctrine (corpus doctrine; permanent home)

> **Deferred inference goals are exceptional.** Each deferred-goal kind must have a **finite, deterministic resolution rule**; must **not search globally**; must **not survive generalisation**; and must **preserve principal types**.

Any feature that wants the inferencer to postpone a decision cites this doctrine and demonstrates compliance on all four points, or returns to design. The doctrine describes machinery the corpus already has — which is the mark of a doctrine rather than a patch. Its owned instances, cited not reproduced:

- **literal defaulting** — `numeric-literals.md` §4 (deterministic rule at generalisation);
- **the compiler-known `Iterable` table** — `loops-ranges-iteration.md` §7 (unsolved boundary tyvar is an annotation-required error, never a search);
- **the projection-bearing-constraint ban** — `collections-part2-hash-and-type-members.md` §7 (v1 refuses the goal category it cannot yet resolve this way);
- **DotCall** — `method-syntax.md` (its §10 itemizes the feature's compliance; its resolution machinery lives there).

It also sets the bar any v2 implied-type projection inference must clear before it exists.

---

## 2. The shared header grammar

```
record Point = {x: Float, y: Float}
record Pair(a, b) derives (Eq, Show) = {first: a, second: b}

union Option(a) derives (Eq, Show) = Some(value: a) | None
union Shape
    derives (Eq, Show) =
  | Circle(radius: Float)
  | Rect(width: Float, height: Float)
  | Point

type UserName = String
type Handler(a) = a -> Unit
```

The grammar, uniformly:

```
("record" | "union" | "type") Name [ "(" a, b, ... ")" ] [ "derives" DeriveList ] "=" body
DeriveList  =  ConstraintName  |  "(" ConstraintName ("," ConstraintName)* ")"
```

### 2.1 Name and parameters

- `Name` is uppercase-start and enters the **type namespace** (constructors introduced by the body enter the term namespace per Unions §2 / Products §5.1; constraint names live in their own namespace per Constraints §2.2).
- Parameters are **parenthesised, comma-separated, non-uppercase-start type variables**, matching use-site shape exactly: you declare `Option(a)` the way you write `Option(Int)`. Parameters must be distinct: `Pair(a, a)` errors at the second `a` with "parameter `a` appears more than once; rename or remove the duplicate parameter." Arity is fixed; every use site must apply the constructor to exactly that many arguments (the existing use-site rule, now anchored to its declaration).
- Zero parameters is spelled by omission: `record Point = ...`, never `record Point() = ...` (parse error, "remove the empty parameter list" — parallel to the nullary-constructor parens hint, Unions §2.2).
- Parameters scope over the entire RHS (body and, for the elaborated `derives` instances, the instance head — §3).

### 2.2 No constrained parameters (decided; do not re-litigate)

`record Sorted(a: Ord) = ...` is a **parse error**: "type parameters of a declaration are unconstrained; constrain them where they're used." Rationale: this is Haskell's deprecated "datatype contexts" — the constraint on the declaration buys nothing (uses would still demand it independently or not benefit), while functions, `honor` heads, and `constraint` declarations are where constraints already do all real work. Derived instances get their per-parameter obligations through instance contexts (Constraints §4.3), not through the data header. Consequence, restated from §1: `<>` never appears in a data-declaration header, keeping the parens/angle-bracket kind distinction absolute.

### 2.3 The `derives` clause — header position

- **Position:** after the (possibly absent) parameter list, before `=`. This is the *only* position; a `derives` after the body is a parse error with a move-it fixit (transition aid; the clause never shipped in the old position, but the Decisions Batch text did).
- **Form:** a single constraint name (`derives Eq`) or the tuple form (`derives (Eq, Show)`) — deliberately mirroring the `<a: Eq>` / `<a: (Eq, Show)>` convention. A duplicate errors at its second occurrence: "`Eq` appears more than once in `derives`; remove the duplicate `Eq`."
- **Meaning (unchanged, restated):** pure sugar. `record Pair(a, b) derives (Eq, Show) = ...` elaborates to the declaration plus `honor Eq<Pair> = derive` and `honor Show<Pair> = derive`, each a full citizen of the instance system — coherence slot, orphan rule (trivially satisfied: the declaration site is the home module), superconstraint checks, parameter obligations as instance context per Constraints §4.3. All Decisions Batch §2 semantics and §2.6 diagnostics stand; the "add `derives Eq` to the declaration of `Point`" fixit now points at an insertion site adjacent to the name the error already mentions.
- `derives` remains a **contextual keyword**, and header position makes the context sharper still: between a type header and its `=`, nothing else can legally appear.
- `derives` on an `exception` declaration remains the Decisions Batch error ("exceptions have no derived instances") — position-independent, unchanged. `exception` headers otherwise share this grammar's shape trivially (name, payload — Exceptions §2 is authoritative for the payload; exceptions take no type parameters, per their concrete-payload rule).
- Why header-over-trailing, recorded: the trailing form needed three caveats (visual attachment to the final union alternative; diff-collision when appending a constructor; the clause buried after long record bodies) — all of which vanish in header position; and capabilities-before-representation matches how the declaration is read. Rust's derive-before-body and F#'s attributes-before-declaration are the lineage; Haskell's trailing `deriving` is the rejected outlier.

### 2.4 Layout continuation (discharging the Unions §2 note)

A declaration's header and RHS are **one logical line under ordinary offside handling**: continuation lines indented strictly deeper than the header's start column do not trip VSEP, so the declaration is never split. This single rule covers all the multi-line shapes:

```
union Shape
    derives (Eq, Show) =        -- derives on its own continuation line
  | Circle(radius: Float)        -- alternatives are continuations, not a block
  | Rect(width: Float, height: Float)
  | Point

record Config derives (Eq) = {
  host: String,                  -- record braces may span lines; braces make this
  port: Int,                     -- trivially a continuation regardless
  verbose: Bool
}
```

- The `|` alternatives of a multi-line union are a **continuation of the declaration, not a layout block** — no VOPEN is emitted after `=`. This is the confirmation Unions §2 requested; it falls out of the offside rule with no special case.
- Nothing about `;` changes: `;` is a newline-at-indentation equivalent inside blocks (Lexer & Layout) and has no role inside a declaration.

---

## 3. Parameterized declarations — the semantics anchor

The header grammar being shared, each form's spec already fixed its parameterized semantics by reference ("the parameterised case must behave identically to the monomorphic case with the parameters instantiated" — Unions §2, Products §5.1). This doc anchors the shared part:

- Parameters are ordinary type variables scoped over the RHS; the declaration introduces a **type constructor** of the declared arity. Use-site instantiation, generalisation of constructor types, and unification behaviour are as the form specs already state (`Tree(a)` unifies with `Tree(b)` by `a := b`; nominal names never unfold).
- A `derives` clause on a parameterized declaration produces parameterized instances with the expected instance contexts (Decisions Batch §2.5's note, now with its header grammar delivered): `record Pair(a, b) derives (Eq)` yields the instance whose obligations are `Eq<a>, Eq<b>`.
- Phantom parameters (declared, not used in the body) are **legal on nominal declarations** — `union P(a) = X | Y` (already noted in Unions §6.2); the nominal wall is what makes them do work — and **illegal on aliases** (§5.3).

---

## 4. `type` aliases — declaration and transparency

```
type UserName = String
type Point2D = (Float, Float)
type Handler(a) = a -> Unit
type Lookup(k, v) = k -> Option(v)
```

- **Fully transparent.** The alias and its expansion are *the same type*: the checker expands aliases away before (or during) unification; `UserName` and `String` unify, interconvert with no ceremony, and are indistinguishable to every semantic judgment. No nominal wall, no runtime representation, no constructor.
- The RHS is any type expression: primitives, tuples, records (structural rows, including `...` forms), function types, applied nominal constructors, other aliases (acyclically — §5.4).
- **Aliases carry no instances.** `honor Show<UserName>` is `honor Show<String>` after expansion — and therefore collides with the prelude instance under coherence. The error must teach the model: "`UserName` is an alias of `String`; aliases cannot carry their own instances — for a distinct type with its own instances, use a `record` or a single-constructor `union`." Likewise a `derives` clause on a `type` declaration is a hard error with the same redirect ("aliases are transparent and share their expansion's instances; `derives` belongs on `record` and `union`"). This pair of diagnostics is the newtype signpost and half the reason the alias/nominal pairing is teachable.

---

## 5. Alias restrictions

### 5.1 Fully applied, always

A parameterized alias must be applied to exactly its declared arity at every use. `Handler` bare — as a type argument, in an annotation, anywhere — is a hard error: "`Handler` takes 1 type parameter; aliases must be fully applied." Partial application of aliases is higher-kinded programming through the back door and wrecks inference; the restriction is standard (Haskell imposes the same) and permanent for v1.

### 5.2 (Nominal constructors, for contrast)

The same fully-applied rule already holds for `record`/`union` constructors at use sites; stated here once so the diagnostic family is shared ("`Tree` takes 1 type parameter").

### 5.3 Unused alias parameters are a hard error

```
type Tagged(tag, a) = a        -- ERROR
```

"parameter `tag` is unused in the alias body; type aliases are transparent, so unused parameters have no effect — for phantom typing use a `record` or `union`."

- **Why an error, not a lint:** transparency makes the phantom parameter *deceptive*, not merely inert — `Tagged(Metres, Float)`, `Tagged(Feet, Float)`, and bare `Float` all unify, silently defeating exactly the units-style discipline the author was reaching for. A construct that is never what the author wanted cannot be a warning under the no-warning-tier doctrine (§1.1). (Deliberately stricter than Haskell, which permits-and-inerts; same move as upgrading the incomplete-match warning.)
- **The check is syntactic occurrence in the RHS as written — and that is provably sufficient.** The worry: `type Weird(x) = Const(Int, x)` "uses" `x` syntactically while expansion could erase it, *if* `type Const(a, b) = a` existed. It cannot: `Const` fails this same check first (`b` unused). Inductively, if every alias in scope uses all its parameters syntactically, syntactic occurrence implies post-expansion occurrence — the local check delivers the semantic guarantee. Implement the cheap check; record the induction as why it's complete.

### 5.4 The recursion ban

```
type T = Option(T)             -- ERROR
type A = B; type B = A         -- ERROR (mutual)
```

"type aliases cannot be recursive; use a `union` or `record` for recursive types." Direct and mutual, detected by an SCC check over the alias-dependency graph at module check time (cheap; the graph is small). The rationale is the one Unions §2 recorded from the other side: nominal names are constants to the unifier, so nominal recursion is just another mention of a constant — aliases have no such indirection, and recursion means infinite expansion. The fixit **names the nominal escape**; that is the point of the message.

Aliases may freely *mention* nominal names declared later in the module, and recursive nominal types may mention aliases — only cycles **through aliases alone** are banned. (`type Forest(a) = List(Tree(a))` with `union Tree(a) = Node(a, Forest(a))` is legal: the cycle passes through the nominal `Tree`, which breaks it.)

---

## 6. Display and `.d.ts`: alias stickiness

**Aliases are display-sticky, never display-synthesized.**

- A type that reached the checker **through an alias the user wrote** (an annotation, a declared signature, a constructor's declared field) displays as the alias in hovers, errors, and inferred-signature printing. Mechanically: the type node carries a display name; any unification step that changes the node's structure drops it.
- A type **built up by inference** displays structurally. The checker never reverse-searches in-scope aliases to "helpfully" name a synthesized type — with two aliases of the same expansion the choice would be nondeterministic, and a wrong guess is a lie in a diagnostic.
- Consistency note: this is the same policy family as the implied-types display rule (Loops §7.2 — `Item(List(Int))` expands in hovers once resolved): expansion whenever resolution is complete and the user didn't write the name; the written name wherever they did.

**`.d.ts` follows the same rule.** An exported alias emits the corresponding TS alias declaration and is *used* where the Hexagon source used it:

```
export type UserName = String
export fun greet(name: UserName): String = ...
```

```ts
export type UserName = string;
export declare function greet(name: UserName): string;
```

TS aliases are equally transparent, so semantics are preserved exactly; the emitted declarations are what a TS author would hand-write, and the output is diff-stable when an alias's expansion changes. Positions where inference produced the type (no alias written) emit expanded — same stickiness. **Visibility is Modules' (§4.3/§11.4), and stickiness yields to it: an exported alias emits the corresponding TS alias declaration; a *private* alias appearing in an exported signature emits as its expansion** — it is not emitted privately.

---

## 7. Module-level consolidation

### 7.1 The declaration inventory and site rule

Module level only: `record`, `union`, `type`, `constraint`, `honor`, `exception`. Any of these inside a function body or block is a hard error, one message family: "declarations live at module level" (generalizing Exceptions §2's rule; the exceptions-specific phrasing may remain as its instance). Block-local binders remain exactly `let` / `var` / `fun` (Statements §1).

### 7.2 Order-insensitivity and mutual recursion

Module-level declarations are **order-insensitive among themselves**: a declaration may reference names declared later in the module. Unions may be mutually recursive through payloads (Unions §2); records through field types; aliases may reference later nominal names (§5.4); `honor` may precede or follow the declarations it mentions; `fun` hoisting (Functions) is this same policy at the term level. The only ordering-adjacent error is the alias SCC check (§5.4). Checking strategy (declaration-graph SCC processing vs. two-pass name collection) is the implementer's; the observable rule is: order never matters, cycles-through-aliases-alone are errors, everything else that each form's spec permits is legal in any arrangement.

### 7.3 Type-namespace duplicates

Two type-namespace declarations of the same name in one module — any mix of `record`/`union`/`type`/primitive shadowing — is a hard error at the second declaration, naming the first and saying "rename this declaration or remove the duplicate" (parallel to the constructor-collision rule, Unions §2). Constraint names live in their own namespace (Constraints §2.2) and collide only with each other. Cross-module shadowing, imports, and whether user modules may shadow prelude type names: modules spec, as ever.

---

## 8. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Constrained header parameter (`record S(a: Ord)`) | "type parameters of a declaration are unconstrained; constrain them where they're used" (§2.2) |
| Empty parameter list (`record Point()`) | "remove the empty parameter list" (§2.1) |
| Duplicate header parameter (`Pair(a, a)`) | "parameter `a` appears more than once; rename or remove the duplicate parameter" (§2.1) |
| `derives` after the body | parse error + move-to-header fixit (§2.3) |
| Duplicate constraint in one `derives` list | "`Eq` appears more than once in `derives`; remove the duplicate `Eq`" (§2.3) |
| `derives` on `type` | "aliases are transparent and share their expansion's instances; `derives` belongs on `record` and `union`" (§4) |
| `derives` on `exception` | Decisions Batch §2.6 error, unchanged (§2.3) |
| `honor C<Alias>` | "`UserName` is an alias of `String`; aliases cannot carry their own instances — use a `record` or a single-constructor `union`" (§4) |
| Under-/over-applied alias or nominal constructor | "`Handler` takes 1 type parameter…" family (§5.1–5.2) |
| Unused alias parameter | "parameter `tag` is unused… for phantom typing use a `record` or `union`" (§5.3) |
| Recursive alias (direct or mutual) | "type aliases cannot be recursive; use a `union` or `record` for recursive types" (§5.4) |
| Declaration inside a block | "declarations live at module level" (§7.1) |
| Duplicate type-namespace name in one module | error at the second, naming the first: "rename this declaration or remove the duplicate" (§7.3) |
| Unsatisfied constraint on a nominal type | existing Decisions Batch §2.6 message; the `derives` fixit now points at the header insertion site (§2.3) |

---

## 9. Decisions log

| Decision | Where |
|---|---|
| **Rewrite Rule hosted permanently**: restrictive hard errors carry named local rewrites; no warning tier; rewrite-less restrictions return to design | §1.1 |
| **Deferred-Goals Doctrine hosted permanently**: finite deterministic resolution, no global search, no surviving generalisation, principal types preserved; four owned instances cited | §1.2 |
| One header grammar: `keyword Name [(params)] [derives List] = body`, three keywords | §2 |
| Parameters: parens, matching use sites; distinct; fixed arity; no empty list | §2.1 |
| No constrained header parameters, permanently (datatype-contexts rejection); `<>` never in data headers | §2.2 |
| `derives` in header position, before `=`, sole position; supersedes Decisions Batch §2.5 placement; semantics untouched | §2.3 |
| `derives Eq` / `derives (Eq, Show)` mirroring binder conjunction forms | §2.3 |
| Multi-line declarations = offside continuation; union alternatives are not a block; no VOPEN after `=` | §2.4 |
| Phantom parameters legal on nominal declarations, illegal on aliases | §3, §5.3 |
| `type` = fully transparent alias; no instances; `honor`-on-alias and `derives`-on-alias both redirect to newtypes | §4 |
| Parameterized aliases: fully applied always | §5.1 |
| Unused alias parameters: hard error; syntactic check, proven sufficient by induction; stricter than Haskell on purpose | §5.3 |
| Alias recursion (direct/mutual through aliases alone) banned via SCC; cycles through nominal names legal; fixit names the nominal escape | §5.4 |
| Display: alias-sticky, never synthesized; drop the name when structure changes; consistent with implied-type display policy | §6 |
| `.d.ts`: exported aliases emitted and used per stickiness; expansion where inference produced the type; private aliases in exported signatures emit as their expansion (visibility owned by Modules §4.3/§11.4) | §6 |
| Declaration inventory module-level only; one diagnostic family | §7.1 |
| Module-level declarations order-insensitive; mutual recursion per each form's rules; alias SCC the only cycle error | §7.2 |
| Type-namespace duplicates: hard error at second declaration | §7.3 |

---

## 10. Edit notes to existing specs

Apply on next touch; until then this doc governs.

1. **Decisions Batch §2.5** → the `derives` placement sentence ("must follow the complete type body…") is superseded: the clause precedes `=`, header position, sole position (§2.3 here). The contextual-keyword note, the `derive`-as-`honor`-body core form, the derivable set, and all §2.6 diagnostics stand. **§10.4** ("`derives` clause placement…") → resolved, strike.
2. **Unions §2** → the deferred header grammar and the layout-continuation note are discharged (§2, §2.4 here); example declarations in that spec showing `derives` should be spelled header-position when touched. The parameterised-case behavioural requirement is anchored by §3 here.
3. **Products §5.1** → the deferred `record` header grammar is discharged (§2 here). §3.4/§5.2's instance hooks unchanged.
4. **Exceptions §2** → the module-level-only rule is now an instance of §7.1's general family; optional cross-reference.
5. **Constraints** → no semantic change; the instance-on-alias error (§4 here) joins its diagnostics neighborhood on next touch.
6. **Loops §7.2 / future implied-types spec** → replace its stale `Elem` spelling with final `Item`; keyword sharing is compatible: module-level `type` (here), `constraint`-body `type Item`, `honor`-body `type Item = ...` — three positions, one keyword, position disambiguates. The alias recursion ban's non-transfer to implied types (recorded there) is consistent with §5.4's rationale.
7. **hexagon-for-typescript-coders** → introduce the alias/nominal pairing ("`type` renames; `record`/`union` create") and frame `derives` as "like `implements`, except the compiler writes the body."

---

## 11. Acceptance tests (golden: parse tree, checked types, `.d.ts`)

```
-- (a) Header grammar tour
record Pair(a, b) derives (Eq, Show) = {first: a, second: b}
union Option(a) derives (Eq, Show) = Some(value: a) | None
type Lookup(k, v) = k -> Option(v)

-- (b) Multi-line union with header derives on a continuation line
union Shape
    derives (Eq, Show) =
  | Circle(radius: Float)
  | Rect(width: Float, height: Float)
  | Point
-- one declaration; no VSEP fires; adding `| Ring(inner: Float, outer: Float)`
-- is a one-line diff that does not touch the derives clause

-- (c) Constrained header parameter
record Sorted(a: Ord) = {items: List(a)}
-- ERROR: type parameters of a declaration are unconstrained

-- (d) derives elaboration is ordinary instances
record Point derives (Eq) = {x: Float, y: Float}
-- ≡ record Point = {...}; honor Eq<Point> = derive
-- coherence: a later hand-written `honor Eq<Point> = ...` is the duplicate-instance error

-- (e) Alias transparency round trip
export type UserName = String
export fun greet(name: UserName): String = "hi ${name}"
greet("ada")                         -- OK: String is UserName
-- .d.ts: export type UserName = string;
--         export declare function greet(name: UserName): string;

-- (f) Aliases carry no instances
type Meters = Float
honor Show<Meters> = ...
-- ERROR: `Meters` is an alias of `Float`; aliases cannot carry their own
-- instances — use a `record` or a single-constructor `union`

-- (g) Unused alias parameter (and why the syntactic check suffices)
type Tagged(tag, a) = a              -- ERROR: parameter `tag` is unused
type Const(a, b) = a                 -- ERROR first: `b` unused — so no alias can
type Weird(x) = Const(Int, x)        -- ever launder another's parameters

-- (h) Recursion ban vs. the nominal escape
type T = Option(T)                   -- ERROR: aliases cannot be recursive
type Forest(a) = List(Tree(a))       -- OK: cycle passes through nominal Tree
union Tree(a) = Node(a, Forest(a)) | Leaf

-- (i) Fully applied
type Handler(a) = a -> Unit
fun register(h: Handler): Unit = ... -- ERROR: `Handler` takes 1 type parameter

-- (j) Order-insensitivity
fun area(s: Shape): Float = ...      -- Shape declared below: legal
union Shape derives (Eq) = Circle(radius: Float) | Point

-- (k) Display stickiness
let f = (name: UserName) => name ++ "!"
-- hover on f: UserName -> String   — parameter sticky, result inferred/structural
```
