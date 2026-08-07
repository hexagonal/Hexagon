# Hexagon Spec: Constraints

**Status:** Decided (July 2026). The keyword pair is **`constraint` / `honor`** (naming record and anti-relitigation anchors: §11; completed rename propagation record: §12). Section numbering §1–§10 is stable; §9 holds resolved anchors plus two open items, none blocking §1–§8.
**Scope:** The `constraint` declaration (members, subjects, base constraints), the `honor` declaration (ground and parameterized instances, base constraint checking, coherence, orphan rule, instance-head restriction), the derivation mechanism (`honor C<T> = derive`, §4.5), constraint-member call style (§2.2), dictionary compilation, and the member lists of the constraints this spec owns (§7 — focused specs own the rest).
**Not in scope:** derived structural instances' *semantics* (fixed in Products §2.5/§3.4 and Unions §7; the invocation mechanism is §4.5 here), the numeric-literal elaboration and defaulting machinery (Numeric Literals spec, authoritative), `Eq<Float>`/`Ord<Float>` semantics (decided — Decisions Batch §1, en route to Primitive Types; §9.5), LSP display of constraints (open, §9.4), modules and instance visibility (Modules; the orphan rule §5.3 constrains it), `Hash`/`Iterable`/`Integral` member semantics (their focused owners, §7).
**Companions:** Functions spec (§4.2 angle-bracket type parameters — this doc reuses that grammar wholesale), Numeric Literals spec (`fromNat`, `fromInt`, defaulting, dictionary erasure), Primitive Types §7 (Show contract), Products/Unions specs (derived-instance semantics), Declarations Preamble (declaration inventory; `derives` header sugar §2.3; alias-instance rule §4; Rewrite Rule §1.1), Collections Part 2 (`Hash`, implied type members), Method Syntax §7 (constraint-member dot dispatch — through instances and bounds, never search; reversed for #304/#335, §16.2 there), `stdlib-roadmap.md` (hostile-specimen exercise; prelude inventory).

**Vocabulary, fixed for docs and diagnostics:** the declared obligation is a **constraint**; the declaration that discharges it is an **`honor` declaration**; the thing an `honor` declaration produces is an **instance**. The words "implement"/"implementation" are avoided in user-facing diagnostics and reference material for this mechanism — they are generic, OO-flavored, and name nothing this design has. ("Implementation" remains fine as an ordinary English word for the compiler itself.)

---

## 1. Doctrine

- **Constraints are the type of a type.** The angle-bracket binder `<a: Signed>` reads uniformly everywhere it appears: "a type variable, with obligations." Scala's context bounds (`[A: Signed]`) and Rust's trait bounds (`fn f<T: Signed>`) are the acknowledged lineage; Hexagon follows the **Rust** reading — the dictionary is compiler plumbing, never a user-nameable or user-passable value. Scala's "reach in and grab the implicit" power is deliberately absent: it is the door to incoherence.
- **A constraint states an obligation; an `honor` declaration discharges it.** The keyword pair is a matched semantic pair, deliberately: `honor` (in its performative, commercial sense — one honors a warranty by paying out) names the constructive act of supplying the members, and every use of the keyword points the reader back at the constraint it answers. See §11 for the full naming record.
- **One grammar for binders.** `constraint`, `honor`, and function definitions all introduce type variables with the same `<var: constraintList>` form from Functions §4.2 — a single constraint, or a parenthesized conjunction `(C1, C2)`. Bare `<a>` is the unconstrained case; legal everywhere, *required* in `constraint` heads (§2), never required on functions — nor canonical there (Functions §4.2.1).
- **Extension reads left to right.** `constraint Ord<a: Eq>` means “Ord extends Eq.” No Haskell-style `Eq a => Ord a` with its backwards arrow, and no third meaning for `=>` (which is already the lambda and match-arm arrow).
- **Coherence is global and non-negotiable** (§5). One instance per (constraint, type constructor), enforced by an orphan rule. This is what keeps `Ord`-backed collections sound and monomorphic code dictionary-free — the readable-JS goal is downstream of coherence.
- **Angle brackets vs. parens encode a kind distinction.** Parens after an uppercase-start name are type parameters of a type constructor (`Option(a)`); angle brackets are constrained/introduced type variables. A constraint's subject is not a type parameter — `Ord` is not a type — so it is `Ord<a>`, never `Ord(a)`.

---

## 2. The `constraint` declaration

```
constraint Show<a> =
    show(x: a): String

constraint Eq<a> =
    equals(x: a, y: a): Bool
    notEquals(x: a, y: a): Bool = not equals(x, y)

constraint Ord<a: Eq> =
    compare(x: a, y: a): Ordering

constraint Num<a> =
    add(x: a, y: a): a
    multiply(x: a, y: a): a
    fromNat(n: Nat): a

constraint Signed<a: Num> =
    subtract(x: a, y: a): a
    negate(x: a): a
    fromInt(n: Int): a

constraint Frac<a: Signed> =
    divide(x: a, y: a): a
```

*(Member inventories above are illustrative of the shape; the authoritative member lists for the prelude constraints are §7. `Ordering` is the prelude union `Less | Equal | Greater`.)*

- **Head:** `constraint Name<subject>` where `Name` is uppercase-start (it lives in its own namespace — see §2.2) and the subject is exactly one type variable, non-uppercase-start, using the standard binder grammar. The subject binder is **mandatory** — this is the one position where bare `<a>` is load-bearing rather than optional.
- **Base constraints** are the obligations on the subject: `constraint Ord<a: Eq>` requires every type honoring `Ord` to have (or derive) `Eq`. Conjunctions per the standard form: `constraint C1<a: (C2, C3)>`. Terminology, fixed for diagnostics and docs: if `Ord` extends `Eq`, then `Eq` is the **base constraint**. The extending side has no noun.
- **Base constraint cycles are a hard error** at declaration (`C1<a: C2>`, `C2<a: C1>`). The base constraint relation must be a DAG.
- **Members are fully typed function headers, optionally with a default body.** A required member omits the body: `name(params): ReturnType`. A defaulted member appends `= body`. The bodiless form remains legal only here: a constraint member is the declaration itself, not a standalone signature for some later definition. No `->` appears in source.
- A constraint body may also declare an **implied type member** as `type Name`. Its owner-scoped identity, grammar, and v1 restrictions are owned by Collections Part 2 §§5–8; it claims no module-level namespace slot.
- Member headers must mention the subject variable; annotations on member parameters/returns are **required** even when a default body is present. The subject `a` is in scope in every member; members may not introduce their own `<...>` type parameters in v1 (no polymorphic methods; flagged, not needed by any planned prelude constraint).
- Members are one per layout line (VSEP/`;` per Lexer & Layout); duplicate member names within one constraint: hard error.
- Member names are non-uppercase-start term names. They enter scope per §2.2.

### Default member bodies

- A member without a body is **required**. Every `honor` declaration must supply it.
- A member with a body is **defaulted**. An `honor` declaration may omit it and inherit the default, or supply a member of the same name to override it.
- A constraint must declare at least one required member: either a bodyless function member or an implied type member (Collections Part 2 §5). Implied type members are always required and bound exactly once; they have no default-body form. Defaults supplement an obligation; they do not create marker constraints or Haskell-style "supply either member" minimal-definition alternatives.
- A default body is checked once in the constraint's generic context against its declared return type. The constraint subject, its base constraint operations, module-scope names, and all members of the same constraint are in scope.
- Calls from a default to another member dispatch through the completed instance. An override is therefore respected by defaults that call it. Ordinary recursion rules apply if defaults call themselves or one another; the compiler adds no separate termination analysis.
- `Eq` is the first prelude use: `equals` is required and `notEquals` defaults to `not equals(x, y)`. An override of `notEquals` is permitted for efficiency but must obey the law `notEquals(x, y) == not equals(x, y)`.
- Derivation supplies the required members fixed by the structural semantics, then inherits every defaulted member. Thus `honor Eq<Point> = derive`, `derives Eq`, and the automatic `Eq` instances for tuples and structural records generate `equals` and inherit the standard `notEquals` default.

The Haskell `Eq` design, in which equality and inequality default recursively to each other and an instance must supply either one, is deliberately not copied. It requires a separate minimal-complete-definition rule to prevent an instance from inheriting an infinite loop. Hexagon keeps one required semantic foundation (`equals`) and one overridable convenience (`notEquals`): the same optimization door, with no alternative-completeness grammar and no warning-tier trap.

### 2.1 Base constraints and constraint-use semantics

Where a function demands `<a: Ord>`, the callee may use both `Ord` members and `Eq` members on `a` — base-constraint members are reachable through the extending constraint. Conversely a caller discharging `Ord<T>` has by construction discharged `Eq<T>` (§4.2 guarantees the instance exists). One dictionary-design consequence in §6.2.

### 2.2 Namespacing of members

Constraint members are module-scope term names (like constructors, Unions §2). Two in-scope constraints declaring the same member name: error at the point that makes it ambiguous; two constraints in one module sharing a member name: hard error at the second declaration — the same rule family as constructor names. Qualified access (`Ord.compare`) and import-driven disambiguation are the modules spec's business.

**Call style (doctrine, absorbed from the July 2026 review closures §A):**

- **Bare constraint-member calls are the idiom when unambiguous**: `show(x)`, `compare(a, b)`, `x |> show`. Members are ordinary module-scope terms; nothing about being a constraint member demands ceremony.
- **Qualification is the ordinary collision resolution, not an apology.** When two in-scope constraints share a member name, the qualified spelling (`Ord.compare(a, b)`) resolves it through **normal module aliases** (Modules §5) — the same machinery as any other name collision. **There is no constraint-specific member namespace** and no special qualification syntax.
- **Constraint members are reachable through dot-call syntax on known types and bounded variables** *(reversed for #304/#335 — Method Syntax §7/§16.2 own the mechanism, its limits, and the reversal record)*: `r1.add(r2)` is `Num`'s member at `Rat`; `x.compare(y)` under `a: Ord` dispatches through the binder's evidence. The dot never *discovers* a member — flexible receivers take Method Syntax §3.5's defaulting step and fallback, and no member name ever nominates a type. Inside a member's own body the dot spelling is the sanctioned recursion form (§4.6).
- The revisit bar for qualified-as-default — the **hostile-specimen exercise** (ten unrelated user constraints; collision-pressure measurement) — is a stdlib-listing obligation, routed through `stdlib-roadmap.md` §2, not restated here. If collisions prove constant in practice, the qualified-as-default position returns there.

---

## 3. Constrained functions (restated for closure)

Unchanged from Functions §4.2; recorded here because this spec is where a reader will look:

```
let plus<a: Num>(x: a, y: a): a = add(x, y)
let member<a: (Eq, Show)>(xs: Vector(a), x: a): Bool = ...
```

Inference attaches constraints without annotation (`fun plus(x, y) = add(x, y)` infers the `Num` constraint from `add`'s type); the explicit `<...>` form attaches those constraints for documentation and restriction. It does not exist to name the variables — the lowercase spelling already does that, so an unconstrained binder is never written on a function (Functions §4.2.1). Generalisation of constrained type variables follows Functions §8 plus the Numeric Literals §4 defaulting rule, both unchanged by this spec.

---

## 4. The `honor` declaration

### 4.1 Ground instances

```
honor Show<Point> =
    show(p) = "(${p.x}, ${p.y})"

honor Ord<Point> =
    compare(p, q) = ...
```

- **Head:** `honor ConstraintName<Type>`. The subject slot that held a variable-being-introduced in `constraint` holds a concrete-type-being-supplied in `honor`. Declaration/use duality, deliberately.
- **Members are ordinary function definitions** (header sugar, or explicit-lambda form — same AST equivalence as everywhere). Every required member must be supplied exactly once. A defaulted member may be omitted or supplied once as an override. A missing required member is an error naming it; an extra or duplicate name is an error.
- An implied type member is instead supplied exactly once as `type Name = τ`; Collections Part 2 §5.3 owns its RHS scope and exactly-once rules.
- **Member typing is checking, not inference.** The expected type of each member is fully determined by the constraint definition with the subject substituted; the body checks against it. Annotations on members are optional; if present they must match the expected type exactly — a *less general* annotation is an error here (unlike on free functions), because the dictionary slot's type is fixed.
- Member RHSs must be **syntactic lambdas** (directly or via header sugar) — the `fun` §7.1 rule, for the same reason: instance construction must be evaluation-free (§6.3).

### 4.2 Base constraint obligations: checked, never restated

`honor Ord<Point>` does **not** name or restate the `Eq<Point>` instance. The compiler checks that the base constraint instance *exists* (ground case) or *is derivable from the instance's own binders* (parameterized case, §4.3), and errors otherwise:

> cannot honor `Ord<Point>`: `Ord` requires `Eq`, and no `Eq<Point>` instance exists.

Naming instances would only make sense under multiple candidate instances, which coherence (§5) forbids; existence-checking is therefore complete.

### 4.3 Parameterized instances

```
honor<a: Show> Show<Vector(a)> =
    show(xs) = ...

honor<a: Eq, b: Eq> Eq<Pair(a, b)> =
    equals(p, q) = ...
```

- The prefix `<...>` is the standard binder grammar again — introduce variables, attach obligations — in yet another position, with identical meaning. An `honor` head's subject may then mention those variables.
- Base constraint checking in this case: `honor<a: Ord> Ord<Vector(a)>` requires `Eq<Vector(a)>` to be derivable — i.e. an `honor ... Eq<Vector(_)>` exists whose own obligations are entailed by this instance's binders (`a: Ord` entails `a: Eq` via the base constraint DAG). Entailment here is simple: walk the DAG; no backtracking search arises under §5.4.

### 4.4 What `honor` is not

- Not first-class: an instance is not a value, cannot be named, passed, or locally shadowed. (Contrast Scala; see §1.)
- Not conditional on anything but its `<...>` binders: no where-clauses, no negative constraints, no overlap resolution.
- Not open: all members supplied in one block; no splitting an instance across declarations.

### 4.5 Derivation: `honor C<T> = derive`

Derived instances for **nominal** types (`record`, `union`) are **opt-in** — "nominal means you control the surface." Two spellings, one meaning:

```
honor Eq<Point> = derive              -- core form: the RHS is exactly the keyword `derive`
record Point derives (Eq, Show) = ...  -- header sugar, owned by Declarations Preamble §2.3,
                                       --   elaborating to one core-form instance per constraint
```

- **A derived instance is an ordinary instance thereafter**: it occupies the (constraint, constructor) coherence slot (§5.1), obeys the orphan rule (header sugar is necessarily in the type's home; the core form may appear in either legal home), is existence-checked for base constraints (§4.2), supplies the required members fixed by the structural semantics (Products §2.5/§3.4; Unions §7), and inherits every defaulted member (§2) — `derives Eq` generates `equals` and inherits the standard `notEquals`.
- **`derive` is a keyword valid only as the complete RHS of an `honor`** (parallel to §4.1's lambda-literal rule); anywhere else it is a parse error with the fixit "`derive` is only legal as the body of an `honor`".
- **Derivable in v1: `Eq`, `Ord`, `Show`** (structural semantics fixed by Products/Unions) **and `Hash`** — which is *derivable-only*: `Hash` instances cannot be hand-written, and deriving `Hash<T>` additionally requires a derived `Eq<T>` (Collections Part 2 §4 owns both rules and `Hash`'s semantics). *(Carve-out, #344: **privileged prelude companion source honoring at its own primitive** — a primitive has no declaration to hang `derives` on, so its companion hand-writes `honor Hash<P>` with a door-backed body; the hash-agrees-with-`Eq` obligation transfers to that file, where both instances sit side by side. User modules keep the refusal unchanged — the carve-out follows compilation privilege, exactly as the intrinsic door's gate does.)*
- **Structural types are untouched and user-closed**: tuples and structural records keep their automatic compiler-derived instances — they have no constructor name to key an instance on (§5.4) and no home module for the orphan rule (Modules §2: structural types belong to no module). Users cannot write instances for them (§9.3, resolved).
- Derivation on a parameterized nominal type produces the expected parameterized instance (slot types' instances become instance-context obligations, §4.3). Emission is exactly what the structural semantics dictate — and what that dictates is owned by Products §2.5's implementer note (a component means its *instance*; emission must render the checker's selection); nothing new.

### 4.6 Member bindings in the honoring module *(#304/#335 — graduating the members-as-values ruling's honor-block law; `spec/notes/constraint-members-are-values.md` §5 item 8 is the deliberation record)*

**A member definition is a module-level binding.** One sentence; every rule below is an existing law applied to it. There is only one `multiply` at `Rat` — bare-in-module, `Rat.multiply`, and evidence dispatch all reach the same binding.

- **Its spelling is claimed against ordinary bindings** *(in force since PR β, #339)*. Honoring a constraint claims each member's name in the module's term space: an ordinary module-level binding of that spelling — `let`, exported or private — is the ordinary rebinding error. The claim is against ordinary bindings only: member definitions from **distinct honor blocks coexist** (one module honoring two constraints with same-spelled members stays legal, disambiguated by evidence, by qualification, or by dot dispatch where unambiguous), and the declaring module's own declaration-plus-honor coexists the same way. Where the coexistence puts **two member bindings of one spelling** in the module, a bare in-module use of that spelling is refused naming the routes that remain — the refusal family Modules §5.5 uses for collided prelude exports, owned here for the in-module case, since neither binding outranks the other and the fourth bullet's "this binding" has no single referent. The delegation pattern (`add(l, r) = add(l, r)` beside a module-level `let add`) is therefore ill-formed, not unfashionable; a shared helper takes a different name.
- **It enters the module's top-down order at its own line.** Honor blocks are ordered like any other declarations, and members order by their lines within the block. A bare reference to a member — from a sibling member or any other module code — is legal exactly where any binding reference is legal: at a point after the member's line. A `Frac<Rat>` block above the `Num<Rat>` block may not name `multiply` (the ordinary declared-later error; the fix is the ordinary one — order the blocks). The law governs **name references only**: evidence routes — interpolation, operator faces, member-resolved dot calls (Method Syntax §4.4) — name no binding and evaluate at call time, so mutually referencing instances remain legal in either order, and no honor-block analogue of the `fun`-group dot ban exists.
- **Its own body cannot call its own name** (#293's non-`fun` law — a member is a `let` header, not a `fun`). Within a member's body the member's own spelling is refused with a rewrite diagnostic naming the sanctioned forms — the dot call (preferred) or the qualified spelling:

  ```text
  honor Show<Box> =
      show(box) = "Box(${show(box.value)})"
  -- ERROR: `show` is this member's own name and a member cannot call itself bare;
  --   recursion is spelled through dispatch — write `box.value.show()`, or qualify
  --   the instance you mean: `Int.show(box.value)`
  ```

  Recursion is spelled, not implied: `kid.show()` names the dispatch route where the bare form would have left instance selection silent. In a parameterized instance the recursive position has the declared variable's type, and the dot call dispatches through the instance's own binder evidence (Method Syntax §3.4's bounds row — whose forcing case is exactly this position in an instance of a *same-module-declared* constraint, where no qualified fallback exists; Method Syntax §16.2). Constraint-declaration **default bodies are outside this rule, and the ground is the evidence-route category, not mere location**: a default body is checked in the constraint's generic context, and every member reference in it — another member's or its own name — is a dictionary-slot read against the completed instance at call time (§2: "calls from a default to another member dispatch through the completed instance"). It never references the forwarder binding the honoring module holds, so #293's non-`fun` law has no binding reference to refuse; §2's recursion sentence keeps governing, self-reference included.
- **A bare use elsewhere in the module means this binding** — monomorphic, at the honored type — occluding the prelude's polymorphic export exactly as Modules §5.4 already occludes any prelude name a module binds. `divide(left, right) = multiply(left, reciprocal(right))` inside `Frac<Rat>` means the `Num<Rat>` member. (Two member bindings of one spelling → the first bullet's refusal; "this binding" presumes the ordinary single-binding case.)
- **The binding is qualifiable but is not a bare export** (Modules §5.3). If honoring modules poured member bindings into consumers' bare scope, `show` would have as many exporters as the prelude has companions and Modules §5.5 would refuse the bare name everywhere. Bare `show` in consumer code has exactly one exporter — `Show.hex`; the honoring module's binding is reached bare only from inside that module and by qualification (`Rat.add`, `Int.show`) from anywhere. This mirrors the existing rule that a member is not an independently importable name.

---

## 5. Coherence

### 5.1 The rule

**At most one instance per (constraint, type constructor), program-wide.** A second `honor Ord<String>` anywhere in the program is a hard error at the second declaration; cross-module duplicates report at whole-program check, when the second module enters the import graph, naming both declaration sites (reporting point fixed by Modules §7; the *rule* is fixed here).

Rationale, recorded so it is not re-litigated: (1) `Ord` feeds sorted collections — two `Ord<String>` instances mean a set built under one and queried under the other is silently corrupt; this is why Primitive Types §5 insists `Ord String` is permanent. (2) Dictionary selection stays trivially decidable at every call site, which is what lets monomorphic code erase dictionaries entirely (Numeric Literals §5); the readable-JS goal is downstream of coherence. (3) No modular-implicits/named-instance machinery, which is a research tarpit.

### 5.1.1 Constraint identity

A constraint **is its declaration**. The (constraint, type constructor) key above holds declarations, not spellings: two `constraint` declarations that happen to share a name are distinct constraints, each honored, entailed, and dispatched independently, and their instances never collide. This mirrors nominal type identity (Modules §6.2 — declaration-site, §2 there), and it is what keeps coherence a property of the program rather than of its vocabulary: no module can invalidate another's instances by choosing the same word.

Consequences, pinned so the implementation cannot drift back to name-keying:

- **Instance identity keys on the declaration.** An `honor Describe<Int>` answering one module's `Describe` and an `honor Describe<Int>` answering another's coexist in one program; §5.1's duplicate error fires only when two instances answer the *same* constraint declaration. In particular, two modules that each declare a private `Describe` and honor it for the same type are both lawful, and a third module importing both compiles — it could not even name either constraint.
- **Diagnostics disambiguate by home module.** A message that must mention two same-named constraints qualifies each by its declaring module; a message mentioning one constraint uses the bare name. Never report two *distinct declarations* as duplicates because they share a name — under this section there is no name-level duplicate across modules. (Two source declarations landing on one shared identity — the name-only case below — are not a same-name pair of distinct constraints; their collisions are genuine.)
- **Pre-registered constraints are declarations too.** The compiler pre-registers eleven constraint names — `Num`, `Signed`, `Frac`, `Pow`, `Concat`, `Eq`, `Ord`, `Show`, `Hash`, `Iterable`, `Integral`; that inventory's normative home is this section — and each denotes exactly one compiler-global identity, in every module, with no import. For the ten whose declarations the compiler holds (all but `Iterable`), the name is non-redeclarable: a module-level `constraint Eq<a> = ...` is an error naming the pre-registered constraint, not a second `Eq`. The wired-in machinery (operator routing, derivation, collection contracts) reaches these constraints by their one identity, and a user-spelled twin would be unreachable by that machinery, so it is refused rather than admitted as a trap. The refusal is a declaration-form error, not a resolution priority: no name ever resolves *past* a user declaration to compiler machinery (Modules §5.5's no-outranking rule is untouched — the declaration is simply not available to write), and such a name is not a prelude name for Modules §5.4's occlusion rule — the refusal leaves nothing an occlusion could mean. Member names are unaffected either way: `show` the term occludes per §5.4 as it always did; `Show` the constraint is what this bullet governs.
- **One pre-registration is name-only in v1**: for `Iterable` the compiler holds the name but no declaration, so a source `constraint Iterable<c> = ...` lands on the pre-registered identity rather than minting a rival — identification, not occlusion, and the module's own text is the member list the checker reads (there is no compiler-held list to check it against). Two sharp edges follow from the gap, recorded rather than blessed (#283): *concurrent supply* — two modules may each declare the name-only constraint with different member lists, and both land on the one identity, making them the same constraint with unreconciled members, whose honors for one type collide as genuine §5.1 duplicates; and *orphan-rule license* — any module whose text declares the name-only constraint is "the module that declares `C`" for §5.3, an authority the pre-registration was never meant to hand out per module. The redeclaration ban extends to it when the compiler holds its declaration; the name-only state is a compiler gap, not a spec freedom, and no third kind of pre-registration exists. (`Integral` was the other name-only registration until `stdlib/Integral.hex` joined the prelude and its ban landed with its declaration; #283's remnant is `Iterable`, owed to the collections arc.)

### 5.2 No local instances, no overlapping instances

No instance may be declared inside a function or block; `honor` is a module-level declaration only. No two instances may overlap (which, given §5.4, reduces to: same constraint + same outermost constructor = duplicate = error).

### 5.3 Orphan rule

An `honor C<T>` must appear in **the module that declares `C` or the module that declares `T`** (for parameterized heads: the module declaring `T`'s outermost type constructor). Otherwise two independent libraries could each honor `Show<SomeDepType>` and a downstream importer of both would hold an unresolvable conflict they didn't write. Violation is a hard error at declaration.

*(Preserved by Modules §1/§7, as demanded: instances are global once their module is in the import graph — never imported, never exported, never hidden; `export honor` is illegal.)*

*(#344, the companion arc.)* **A primitive type's home module is its fixed prelude companion** (Method Syntax §4.1's fixed prelude companions, tabled in its §5: `Int` → `Int.hex`, `Nat` → `Nat.hex`, `BigInt` → `BigInt.hex`, `Float` → `Float.hex`, `String` → `String.hex`). `honor Integral<BigInt>` is therefore legal in exactly two files — `Integral.hex` and `BigInt.hex` — and in no user module, which is this rule doing for primitives precisely what it already does for nominal types; §5.4's own examples (`Show<Int>`) always contemplated primitive heads, and this sentence supplies the home the rule reads. Two types stand outside it deliberately: `Bool` is a prelude union whose instances derive in its declaring module, and `Unit` is the empty tuple, covered by the automatic structural instances (§4.5's structural bullet; Modules §2 — no home, and none needed).

**Wired rows retire as source claims them** *(#344; the migration is **complete**)*. While a primitive's companion module did not yet exist as canonical source, its instances were compiler-wired (Modules §5.3's transitional note). At each companion's migration milestone (stdlib-roadmap §5.2; intrinsics §9.2) the companion declared its primitive's instances as ordinary `honor` blocks — member bodies folded in per §4.6, Hexagon-expressible bodies in ordinary source, inexpressible bodies crossing the intrinsic door unexported beneath the member that owns them — and the wired rows for that primitive retired **in the same change**. With `Float.hex` and `String.hex` landed, no wired instance row remains for any primitive. The law it enforced survives as the standing coherence claim: a wired row and a source instance never coexist for one (constraint, type) pair — §5.1's coherence applied to the compiler itself — and a compile in which any retired machinery answers beside a companion is a conformance defect, not a resolution order.

### 5.4 Instance-head restriction

An instance head is **one type constructor applied to distinct type variables**: `Show<Int>`, `Show<Vector(a)>`, `Eq<Pair(a, b)>`. Not legal: `Show<Vector(Int)>` ("instances are per type constructor; this one must cover `Vector(a)` for all `a`"), `Eq<Pair(a, a)>` (repeated variable), instances headed by a bare type variable (`Show<a>` — "an instance must name a type"). This is (roughly) the Haskell 98 rule; it makes instance lookup a table lookup keyed on (constraint, constructor) rather than a search, keeps §4.3 entailment search-free, and closes the road to overlapping-instance resolution.

---

## 6. Compilation

### 6.1 Dictionaries

Nothing beyond what Numeric Literals §5 already assumes, now stated in general:

- A **ground instance** is a module-level record of its completed member set: supplied members plus inherited defaults. For example, `const Num_Int = { add: (x, y) => x + y, fromNat: x => x, ... };` and `const Signed_Int = { num: Num_Int, subtract: ..., fromInt: ... };` are materialised only if some polymorphic use actually needs them (see erasure below).
- A **parameterized instance** is a dictionary-producing function: `const Show_Vector = dictA => ({ show: xs => ... });`
- A constrained function takes its dictionaries as a **trailing evidence suffix**, after every source parameter (FFI Part 9 §6). Per generalized variable, constraints transitively supplied by a more specific declared constraint are eliminated first; the remaining maximal constraints are ordered by `(type-variable ordinal, constraint name)`. Ordinals, not binder spellings, keep alpha-renaming ABI-neutral. The same convention is internal and public, so a matching generic edition can export directly.
- **Monomorphic erasure is the norm and the point:** at a call site where the constrained variable is resolved to a concrete type, the dictionary is selected at compile time and known slots are inlined — `add` at `Int` emits `x + y`, `show` at `Int` emits `String(x)` (Primitive Types §7 table), and contextual `fromInt` erases for `Int -> Float` while emitting the selected concrete conversion for other subjects (Numeric Literals §5). Dictionary records and `dict.member(...)` calls appear **only** inside genuinely polymorphic functions, which already carried them. *(Cross-reference added 2026-08-01, recorded in the #205 closure doc §10 and applied on this touch:)* that only-inside-polymorphic-functions property is protected by Functions §8's generalization rules — the value restriction is Hexagon's monomorphism restriction (Functions §8.2's corrected rationale), and its item-7 relaxation quantifies only **unconstrained** variables, so no code that erased its dictionaries can later come to need them.
- **A constrained function referenced as a value** emits by where its evidence can come from, and the shape is part of the contract (Functions §9) *(added 2026-08-01, #205/#207)*. At a binding that discharges **none** of the reference's constraints — the generalized alias, `let twice = double` with `double : Num a => (a) -> a` — the reference shares the unapplied entity (#205 closure doc §2.2): it emits as the **bare name**, `const twice = double;`, and every consumer appends the same trailing evidence suffix it would have appended to `double`. Where evidence for the reference's constraints **is** in scope — a constrained function used as a value inside a genuinely polymorphic function whose own evidence suffix supplies the dictionaries — the reference denotes the evidence-applied value and emits, as before, as the **eta-expansion closing over that evidence**. The boundary is evidence dischargeability at the reference, never the reference's syntax. The rejected shape is recorded so it is not rebuilt: eta-expanding the no-evidence case manufactures a wrapper of the *unsuffixed* arity, which silently drops the dictionaries its callers pass.
- **A constrained scheme is a function scheme** *(added 2026-08-01, #205/#207 — closure doc §13.6)*. The trailing suffix is the language's **only** evidence representation, and Functions §8.2's evidence-seat rule keeps generalization inside it: a variable still constrained after defaulting is quantified only at a binding whose **one evaluated value — the right-hand side as a whole, never a component a destructuring pattern projects from it** — has a function type *(reading corrected 2026-08-02, closure doc §13.6 round 4)*; at any other value binding it declines and is pinned by its first use, so a destructuring `let` never quantifies a constrained variable. Consequence for this section, normative and mutation-testable: every scheme that reaches emission carrying a residual constraint set describes its binding's entire evaluated value and is function-typed, so the bare-name and eta-expansion shapes above are total over their domain — the whole-binding half is load-bearing, because a function-typed scheme peeled off an aggregate by a pattern would put the bare evidence-taking function inside a construction the suffix cannot reach. The emission guarantee is **scoped** *(corrected 2026-08-02 — as first shipped this sentence declared the two emission-time messages retired while both were live, and claimed unconditional unreachability, which `let g = Some(describe)` with `g` unused already defeated on `main`)*: on a module the checker accepts, an emitter path asked for evidence at a non-function value is a compiler conformance defect and may assert — never a user diagnostic; on a module the checker has already diagnosed, the path is reachable and the emitter stays quiet — the checker's diagnostic (for that shape, the non-defaultable-constraint error) is the sole user surface, and the two emission-time messages the pre-ruling implementation surfaced there are retired into exactly this split *(scope bounded 2026-08-02, round 5: the quiet half governs **every** missing-evidence occurrence during emission on an already-diagnosed module — function-typed values and derived evidence included; the assert half is this ruling's guarantee only for the non-function-value case, and whether the implementation also asserts elsewhere on checker-clean modules is its own discipline, unconstrained here)* (closure doc §13.6's retirement paragraph, which records the one-diagnostic change as the already-diagnosed class, `Some(describe)` its canonical member).

- **A constraint member's module-level seat is a forwarder** *(the shape §6.5 exports)*. Each member of a module-declared constraint emits one module-level binding — source parameters followed by the member's trailing evidence suffix, the body a single dictionary slot read: `const show = (x, dictShow) => dictShow.show(x);`. A member call is a call *into* that genuinely polymorphic forwarder even at a concrete type: the **selection** erases — the instance is chosen at compile time and its dictionary passed directly, the call never searches — but no slot is inlined; slot inlining belongs to the operator and comparison routes above, and the passed dictionary is materialised exactly as any polymorphic use materialises one. The forwarder is the seat the member name denotes as a module-scope term. *(Superseded in part by #335/#344, on this touch:)* every pre-registered constraint with a compiler-held declaration now **has** canonical prelude source, so the forwarder shape above is simply its shape too; what remained wired-in was per-instance, not per-constraint — and those primitive instances have all retired per companion on stdlib-roadmap §5.2's schedule (§5.3's wired-row-retirement law, complete since `Float.hex` and `String.hex` landed, #344).

- **A primitive companion's member bodies: door-backed at the bottom, ordinary Hexagon above it** *(#344; formulation corrected on cold review — the first draft blessed operator-form bodies via erasure, which is circular)*. Operators and interpolation are member sugar in this language, so an own-operation body — `add(left, right) = left + right`, `show(value) = "${value}"` — would denote only itself: the sugar selects the very slot being defined, and any meaning it has comes from a compiler table, not from source. Such bodies are refused as stdlib practice. The law: a member whose operation the language cannot express **below** itself takes a one-line delegation to an unexported intrinsic-door binding (intrinsics §3 — the primop shape); a member expressible over **strictly simpler operations** — sibling members included — is ordinary Hexagon (`div` over `quot`/`mod`, `gcd`'s loop over `mod`). Sibling-member calls at the instance's own concrete head statically erase to direct calls to the module's member bindings (the selection erasure above; no dictionary materialises), so the division shapes are lawful as written and terminate because the call graph bottoms out at the door; a member's **own** spelling in its body remains refused by §4.6's letrec law, unchanged. The monomorphic lowering tables for operators and interpolation at primitives (Primitive Types §7; Operators spec) remain true as **inlining of the door-backed slots** — quality-of-implementation over one implementation, never a second definition.

### 6.2 Base constraint dictionaries

An extending constraint’s dictionary carries its base-constraint dictionaries as slots (`Ord_Int = { eq: Eq_Int, compare: ... }`; `Signed_Int = { num: Num_Int, ... }`), so a function constrained `<a: Ord>` receives one dictionary and reaches `equals` as `dict.eq.equals`, while `<a: Signed>` reaches addition as `dict.num.add`. Chosen over passing separate flattened dictionaries because it keeps the “one constraint = one parameter” rule stable under base-constraint changes to a constraint’s definition. Slot name for a base constraint: the constraint’s name, lowercased (`eq`, `signed`) — collision with a member name is impossible only by luck, so: **a member whose name equals the lowercased name of a base constraint of the same constraint is a hard error** (obscure, cheap to check, prevents a codegen landmine).

### 6.3 Evaluation-freeness and ordering

Instance construction is evaluation-free by construction (§4.1: supplied member RHSs are syntactic lambdas, and default bodies elaborate to lambdas; a record of lambdas evaluates nothing). A default that calls another member reads that slot when the function is called, after the dictionary is complete. Instances are therefore order-independent within a module and require no initialisation-order story (contrast term bindings, which evaluate and are read top-down — Functions §7.2). Instances may reference each other freely (e.g. `Show_Vector` using `dictA` which might be `Show_Vector(Show_Int)` at some call site — composition happens at use sites, not declaration sites).

Order-independence at the source level creates an emission obligation. An `honor` may sit below a term binding whose evaluation demands its evidence, so **instance dictionaries and instance factories (parameterized instances, §4.3) are emitted before the module's term bindings** — legal precisely because constructing either evaluates nothing: a dictionary is a record of lambdas and a factory is a lambda. Dictionary-sharing's hoisted ground applications ride with them, in that spec's own dependency order (dictionary-sharing §5), so every evidence binding a term binding can reference is initialized first. Among the dictionaries and factories themselves, any direct (non-lambda-deferred) reference is emitted DAG-ordered, dependencies first; references inside member lambdas are read at call time and constrain nothing. This is the second leg of Functions §7.2's temporal-dead-zone guarantee: term bindings are safe by enforced source order, evidence by emission position.

Two boundaries keep the freedom exactly instance-shaped. An instance **member body** is an ordinary reference site: its term references obey Functions §7.2 like any lambda body — the freedom of placement belongs to the `honor` declaration and the evidence channel, never to names a member body mentions. And a **use** of a member (`render(x)`, or evidence demanded by any call) is an ordinary term-level event that may sit anywhere its own enclosing binding may: it needs no ordering relative to the `honor`, which is the point of the emission obligation above.

### 6.4 `.d.ts`

Constraint and `honor` declarations have no ordinary JavaScript or `.d.ts` export face, and instances remain unnameable in Hexagon source. The JavaScript boundary has one deliberate public evidence surface (FFI Parts 8–9): a generic constrained export exposes trailing `Constraint.Dictionary<a>` parameters; public nameable instances produce generated handles/factories such as `Signed.int`, `Rat.signed`, and `Vector.show(...)`; dictionary interfaces carry non-exported-symbol TypeScript brands. Fundamental specializations remain dictionary-free. No other constraint machinery appears in `.d.ts`. (The ESM exports §6.5 adds for exported constraints are plumbing with no `.d.ts` face — not an "ordinary export face" in this paragraph's sense.)

### 6.5 Exported constraints

Exporting a constraint (Modules §4.1) adds cross-module plumbing to the shapes above; it changes no semantics.

- **Member forwarders are exported.** The per-member forwarder (§6.1) gains an ESM export in the constraint's home module, and an importing module that calls the member imports it. This is Hexagon-to-Hexagon evidence plumbing in the same class as the `__hex_instance_*` exports (Dictionary Sharing §8), and it carries no `.d.ts` face of its own. The public face is a different matter with an existing owner: an exported constraint is a **public constraint**, so FFI Part 9's public-evidence closure (§5 there; Modules §11.5) applies to it exactly as to any other public constraint — `Constraint.Dictionary<a>` declarations, handles, and factories are that surface, owned there, neither added to nor subtracted from here. §6.4 stands as written.
- **Default bodies emit once, at home.** For an exported constraint, each default member body is hoisted to a single module-level helper in the home module, exported alongside the forwarders and taking the instance dictionary as a parameter. Every honor that inherits the default — in the home module or an importing one — fills the slot by reference to that helper rather than by re-emitting the body. The body thereby stays where its free names resolve (a default may use its module's private bindings), and §6.3 is preserved unchanged: the slot's reference applies the helper at call time, sibling members are reached through the completed dictionary, and nothing is captured while the dictionary literal is still under construction. For an unexported constraint nothing changes: defaults materialize into each honoring dictionary as before.

---

## 7. Prelude constraints owned here (member lists) — and the ones owned elsewhere

This section owns the member lists of **six** constraints. It is deliberately **not** the complete prelude-constraint inventory: focused specs own the rest (registry below), and the full inventory is the stdlib listing's (`stdlib-roadmap.md`).

| Constraint | Base constraints | Members | Notes |
|---|---|---|---|
| `Eq<a>` | — | required `equals`; defaulted `notEquals` | `notEquals(x, y) = not equals(x, y)`; `Eq<Float>` = SameValueZero (Decisions Batch §1 → Primitive Types; §9.5) |
| `Ord<a: Eq>` | `Eq` | `compare(x: a, y: a): Ordering` | `Ordering` is the prelude all-nullary union `Less \| Equal \| Greater` |
| `Show<a>` | — | `show(x: a): String` | contract per Primitive Types §7 |
| `Num<a>` | — | `add`, `multiply`, `fromNat(n: Nat): a` | Nat honors Num; literal and exactness laws per Numeric Literals §5 |
| `Signed<a: Num>` | `Num` | `subtract`, `negate`, `fromInt(n: Int): a` | `fromInt` law per Numeric Literals §5; no `divide` |
| `Frac<a: Signed>` | `Signed` | `divide(x: a, y: a): a` | lawful up to rounding (Float); exact (Rat) |

**Owned by focused specs (registered, not restated):** `Hash` — Collections Part 2 (derivable-only; §4.5 here); `Iterable` — Collections Parts 2/5 (implied `type Item`; `iterate` member; restricted v1 user instances); `Integral` — `integral-constraint.md`. Their instances obey every rule of §§4–6 unchanged.

`Signed` extends `Num`, but neither numeric tier additionally extends `Eq` or `Show` — a numeric type without decidable equality (for example, a lazy or symbolic instance) should not be ruled out by arithmetic. Types that provide those capabilities honor them separately.

Comparison/`equals` operator sugar (`==`, `<`, etc. dispatching to these members) is the **operators spec's** business; this spec fixes only the members.

---

## 8. Diagnostics checklist

Diagnostic noun policy (restated from the preamble): the noun is **instance**, the verb is **honor**; "implement"/"implementation" do not appear in this mechanism's diagnostics.

| Situation | Error / hint |
|---|---|
| Missing member in `honor` | "the `Ord<Point>` instance is missing `compare`" |
| Omitted defaulted member | accepted; the constraint body supplies it |
| Override of a defaulted member | accepted when its type matches the declared member type |
| Extra member | "`Ord` has no member `compere`" (+ near-miss suggestion) |
| Member type mismatch | ordinary type error, phrased against the constraint's declared header |
| Missing base constraint instance | "cannot honor `Ord<Point>`: `Ord` requires `Eq`, and no `Eq<Point>` instance exists" (§4.2) |
| Duplicate instance | hard error at second declaration, naming the first (§5.1); remove one or delete the duplicate module's copy |
| Orphan instance | hard error: "honor `C<T>` in the module declaring `C` or the module declaring `T` — move this declaration there" (§5.3) |
| Non-constructor or repeated-variable instance head | §5.4 messages, each naming the general head to write (`Show<Vector(a)>`) |
| Instance head on a bare type variable | "an instance must name a type; constrain the variable at the use site instead (`<a: Show>`)" (§5.4) |
| `honor` body demands a constraint its binder does not declare | "`a` is declared to honor `Describe`, but the body requires `Num`; write `<a: (Describe, Num)>` on the `honor` header" (#271) |
| Default member body demands a constraint the subject does not reach | "`a` is `Labelled`'s subject, so the body reaches only `Labelled` and its base constraints, but it requires `Eq`; add `Eq` as a base constraint — write `constraint Labelled<a: Eq>`" — the rewrite merges into the declared base list, since a constraint cannot list itself as a base (#271) |
| Base constraint cycle | hard error at declaration; remove one of the cycle's base constraint obligations (§2) |
| Duplicate member name within a constraint / across a module's constraints | hard error, constructor-rule family; rename one member (§2, §2.2) |
| Member name = lowercased base constraint name | hard error; rename the member (§6.2) |
| Non-lambda member RHS in `honor` | the `fun` §7.1-style syntactic error; write the member as a lambda or header-sugar definition (§4.1) |
| Unsatisfied constraint at a call site | phrased per Numeric Literals §6 where a literal is involved; otherwise "`T` has no `Ord` instance, required by `sort`" — with the derivation fixit where `Ord` is derivable: "add `derives Ord` to the declaration of `T`" (§4.5) |
| Redeclaring a pre-registered constraint name | hard error: "constraint `Hash` is pre-registered and cannot be redeclared" (§5.1.1; the ten compiler-held names — name-only `Iterable` excepted until #283 closes) |
| Ordinary binding takes an honored member's spelling | the ordinary rebinding error, in `#reportRebinding`'s house form (§4.6, in force since #339) |
| Member's own name called bare in its own body | the §4.6 rewrite diagnostic: name the dot-call and qualified forms — "recursion is spelled through dispatch — write `box.value.show()`, or qualify the instance you mean" |
| Bare member reference above its honor block's line | the ordinary declared-later error; fix by ordering the blocks (§4.6) — never "unknown name", which would be false |
| A message naming two same-named constraints | qualify each by its declaring module; a message naming one constraint keeps the bare name (§5.1.1) |
| Instance for a structural type (tuple / structural record) | "instances are keyed on type constructors; tuples and structural records have compiler-derived instances only — declare a nominal `record` or `union` for a type you control" (§5.4, §9.3) |
| `honor C<Alias>` on a transparent alias | "`Meters` is an alias of `Float`; aliases cannot carry their own instances — use a `record` or a single-constructor `union`" (Declarations Preamble §4 owns) |
| `derive` for a non-derivable constraint | "`Num` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms" (§4.5; likewise for `Signed`) |
| Underivable slot/field | "cannot derive `Eq<Point>`: field `f` has type `T`, which has no `Eq` instance" — fix the field's type or drop the derivation (§4.5) |
| `derives Ord` without `Eq` | the §4.2 error for a missing base constraint + hint: "add `Eq` to the `derives` list" (§4.5) |
| `derive` outside an `honor` RHS | parse error: "`derive` is only legal as the body of an `honor`" (§4.5) |
| Missing, extra, or duplicate implied type binding | the owner-aware diagnostics in Collections Part 2 §9; supply exactly one `type Name = τ` line for each declared implied type |
| Projection-bearing constraint on a type-variable binder | the focused error and rewrite in Collections Part 2 §9 |
| Implied type name used in a type expression | the owner-aware error in Collections Part 2 §9; v1 has no projection syntax |

---

## 9. Resolved anchors and open items (numbering preserved)

Numbers are kept because companion specs cite them; §§9.1–9.3, 9.5, 9.7 are **resolved anchors**, not live questions. §§9.4 and 9.6 remain open.

1. **Resolved — default member bodies.** Bodiless members required; bodied members inherited/overridable defaults. The complete rule: §2.
2. **Resolved — derivation invocation.** Opt-in: core form `honor C<T> = derive`; header `derives` sugar (Declarations Preamble §2.3). Mechanism: §4.5. The record-`Ord` shipping question dissolved with opt-in (nobody receives it unwritten).
3. **Resolved — no user instances for structural types.** Instances are keyed on type constructors (§5.4); structural types have no constructor name and no home module (Modules §2), so their instances are exclusively compiler-derived (§4.5). The old presumption is now the rule.
4. **Open — LSP display of constraints.** Haskell-flavored `Signed a => a -> a -> a` (currently in Numeric Literals §6) vs source-shaped `<a: Signed>(a, a): a`. Leaning source-shaped for round-trip consistency; Numeric Literals §6 updates when decided. Display-only; decide with LSP implementation work.
5. **Resolved — `Eq<Float>`/`Ord<Float>`.** SameValueZero equality; total order with `NaN` after `+Infinity` (Decisions Batch §1, whose eventual host is Primitive Types per the consolidation ledger).
6. **Open — polymorphic constraint members** (members introducing their own type variables). Banned in v1 (§2); no planned prelude constraint needs one. Revisit bar: concrete demand from a real constraint design.
7. **Resolved — `Ordering` spelling.** `Ordering = Less | Equal | Greater` (Decisions Batch §3); final.

---

## 10. Decisions log

| Decision | Where |
|---|---|
| One binder grammar everywhere: `<a: C>` / `<a: (C1, C2)>` / bare `<a>`; Rust-reading (dictionaries never user-visible) | §1 |
| `constraint Name<a>` head; subject binder mandatory; bare `<a>` load-bearing here | §2 |
| Base constraints as subject obligations: `Ord<a: Eq>`; left-to-right extension; no `=>` spelling | §1, §2 |
| Terminology: **base constraint** for the constraint built upon; no noun for the extending side; noun for an honored constraint is **instance** | §2, preamble |
| Function members = fully typed headers; bodyless members required, bodies provide overridable defaults; implied type members use `type Name`; at least one required member; no `->` in function headers | §2; Collections Part 2 §§5–8 |
| Members are module-scope terms, constructor-style collision rules | §2.2 |
| `honor C<T>` head; function members are ordinary definitions, checked not inferred, with the lambda-literal RHS rule; implied types bind as `type Name = τ` | §4.1; Collections Part 2 §5.3 |
| Base constraint obligations existence-checked, never restated | §4.2 |
| Parameterized instances via prefix `<...>` binders; entailment via base constraint DAG, search-free | §4.3 |
| Global coherence: one instance per (constraint, constructor); no local/overlapping/named instances | §5.1–5.2 |
| A constraint is its declaration: same-name constraints are distinct, coherence and instance identity key on the declaration, pre-registered names non-redeclarable (name-only `Iterable` excepted until compiler-held) | §5.1.1 |
| Orphan rule (Rust-style); instances global, never imported/hidden | §5.3 |
| Instance heads: one constructor, distinct variables (H98-style) | §5.4 |
| Dictionaries: records / dictionary-functions; trailing maximal-evidence suffix ordered by type-variable ordinal then constraint name; monomorphic erasure | §6.1; FFI Part 9 §6–§7 |
| `Eq.equals` required; `Eq.notEquals` defaults to its negation and may be lawfully overridden; `!=` targets `notEquals` | §2, §7; Operators §5.1 |
| Derivation supplies required structural members, then inherits defaults; automatic structural instances do the same | §2 |
| Base constraint dictionaries nested as slots; lowercased-name slot rule | §6.2 |
| Instances evaluation-free, order-independent, no capture analysis | §6.3 |
| `.d.ts` exposes only Parts 8–9's deliberate dictionary surface for generic editions and public evidence; all other constraint machinery stays absent | §6.4 |
| Exported constraints: member forwarders and hoisted default helpers exported as internal plumbing (defaults emit once, at home); an exported constraint is a public constraint for FFI Part 9's closure — the `.d.ts` surface stays owned there | §6.5 |
| Prelude member lists for the six constraints owned here; `Signed` extends `Num` and neither additionally extends `Eq` or `Show`; `Hash`/`Iterable`/`Integral` registered to their focused owners | §7 |
| Derivation: opt-in `honor C<T> = derive`; header `derives` = Preamble sugar; derived instances are ordinary instances; derivable v1 set = `Eq`/`Ord`/`Show`/`Hash` (`Hash` derivable-only and requiring derived `Eq`, per Collections Part 2); structural instances automatic and user-closed | §4.5 |
| Call style: bare member calls idiomatic when unambiguous; qualification = ordinary module aliases (no constraint-specific namespace); members dot-callable on known types and bounded variables (#304/#335; Method Syntax §7/§16.2 — was "not dot-callable"); hostile-specimen bar routed to `stdlib-roadmap.md` | §2.2 |
| **A member definition is a module-level binding** (#304/#335): spelling claimed against ordinary bindings (distinct-block coexistence carved out); top-down order at its own line, evidence routes exempt; own body cannot call its own name (#293's non-`fun` law — rewrite diagnostic names dot-call and qualified forms; default bodies exempt); bare use in-module = this binding, monomorphic (Modules §5.4 occlusion); qualifiable but not a bare export (one-exporter law) | §4.6 |
| §9: five resolved anchors (9.1–9.3, 9.5, 9.7), two open (9.4 LSP display, 9.6 polymorphic members) | §9 |
| **Keyword pair is `constraint` / `honor`**; naming record with anti-relitigation anchors | §11 |
| Constrained value references: bare-name emission when the binding discharges no evidence (the generalized alias shares the unapplied entity); eta-expansion only where in-scope evidence is closed over; boundary = dischargeability, never syntax (2026-08-01, #205/#207) | §6.1; Functions §9 |
| A constrained scheme is a whole-binding function scheme: the trailing suffix is the only evidence representation, Functions §8.2's evidence-seat rule keeps generalization inside it — the seat read at the binding's evaluated RHS, so a destructuring `let` never quantifies a constrained variable — and evidence-at-a-non-function during emission is a conformance assertion on checker-clean modules, silence on already-diagnosed ones — the silence class-wide over the whole missing-evidence path, the assertion guaranteed only at the non-function case — never a user diagnostic (2026-08-01, #205/#207; corrected and scoped 2026-08-02, rounds 4–5) | §6.1; Functions §8.2; closure doc §13.6 |
| **A primitive's home module is its fixed prelude companion** (#344): `honor C<P>` legal in `C`'s home or `P`'s companion, nowhere else; `Bool` (declaring union) and `Unit` (empty tuple, structural) stand outside | §5.3 |
| **Wired rows retire as source claims them** (#344): per-companion migration, wired row and source instance never coexist for one (constraint, type) pair — coherence applied to the compiler itself | §5.3; stdlib-roadmap §5.2; intrinsics §9.2 |
| **Companion member bodies: door-backed own-operations, Hexagon above them** (#344): operator/interpolation forms refused as own-operation bodies (member sugar would denote only itself); sibling calls erase to direct calls; the monomorphic lowering tables read as inlining of door-backed slots, never a second definition. `Hash`'s derivable-only law takes a privileged carve-out at a companion's own primitive (§4.5) | §6.1; §4.5; intrinsics §3.2 |

---

## 11. The keyword pair — naming record (do not relitigate)

The pair is **`constraint` / `honor`**. The anchors below preserve the load-bearing rationale.

### 11.1 Why `constraint`

The keyword's high-traffic site is the **binder** — `<a: Ord>` — and its diagnostic echo ("unsatisfied constraint `Signed`"); any candidate must read as an *obligation* there. `constraint` is TypeScript's own name for exactly this position (a `<T extends X>` bound is officially a *generic constraint*), carries the C++20 lineage (predicates on type parameters, not value types), and coincides with the diagnostic noun — declaration, binder, and error message use one word.

**The one rejection that must stay loud — `interface`** (and its siblings `class`, `protocol`): in every language the audience knows, an `interface` is a **type of values** — usable in value positions, dynamically dispatched. Hexagon constraints are deliberately neither (`xs: Vector(Show)` is unwritable; no existential/`dyn` hatch exists). The keyword would teach precisely the model the language rejects. **`trait`** was the only defensible rename (Rust lineage) and still over-promises (`dyn Trait`/`impl Trait` are types) while forfeiting the keyword-equals-diagnostic-noun coincidence. `concept`, `rule`, and the vocabulary-family words (`signature`, …) all failed at the binder: `<a: Ord>` must read "obligated to Ord."

### 11.2 Why `honor`

The instance declaration's job is **constructive** — it supplies member bodies. Judgment-register candidates (`satisfies`, `conforms`, …) assert what the *checker* concludes, not what the *author* performs; TS's actual `satisfies` operator means "check, contributing nothing" — the exact opposite half. `honor`, in its commercial/performative sense (honoring a warranty *is* paying out), names the constructive act and completes the matched pair: **a `constraint` states an obligation; an `honor` declaration discharges it** — every `honor` in source points back at the constraint it answers, which `implement` (the superseded v1 keyword: maximally generic, OO-flavored, pairing with nothing) never did. **`fulfill`** was the strongest challenger — equally constructive and paired — rejected on regional spelling instability against `honor`'s entrenched American form. `prove`/`witness` were semantically deepest and audience-inappropriate. American spelling; `honour` is the ordinary unknown-keyword error.

### 11.3 The bar for any future candidate

The declaration site is keyword-tolerant; the binder site is keyword-hostile; the two keywords rightly live in different registers. A future candidate must read as an obligation at `<a: X>` (first keyword) or as a constructive act heading definitions (second), without importing a value-type or check-only false friend from the audience's home languages.

---

## 12. Rename propagation record

Keyword occurrences of `implement` become `honor`; **prose uses of "implement" as an ordinary English verb are untouched**; diagnostic strings using "implementation" as the instance-noun move to "instance." Applied at consolidation targets 1–3: declarations-preamble.md, statements-blocks-mutability.md, pattern-matching.md (prose-verb only, verified). `lexer.md` was already discharged (`honor` is the hard keyword; `honour` gets no privilege). Historical/superseded material (imported chats, the retired overview, archived roadmaps/notes) is excluded from propagation — it is not normative and is not edited.

The live-target propagation is complete. The final audit discharged the authoritative
Decisions Batch derivation examples and verified the remaining named targets already
use `honor` and `instance`.

Sweep rule: grep `implement` per file; mechanically rename code-fenced/backticked keyword uses; leave prose verbs; retag instance-noun diagnostics.
