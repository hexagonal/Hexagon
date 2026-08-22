# Constraint Members Are Values — Direction Note

**Status:** Proposed and non-normative. This note decides nothing. It exists to be
read, poked, and either graduated into the #304 ruling or corrected by it. All
measurements were taken 2026-08-06 on main `846fb4f`, each probe run against a
known-failing control program.

**Graduation record:** PR α (#336) landed the steal for `Show`; PR β (#339) the
remaining declaring modules, consequence 3, and the `Rat.hex` fold-in. **PR γ
graduated the dispatch half into normative text (2026-08-07):** §5 items 1–2 and
consequence 4 into Method Syntax §3.4/§3.5/§4.2/§7 (reversal record §16.2) and
Modules §5.3; item 8's own-name refusal and the member-binding law into
Constraints §4.6. One extension beyond this note, ruled by James on the
parameterized-recursion exhibit: **dot calls dispatch bound members on declared
type variables** (the note's §1 table listed that row as refused; the book's
nested-example rewrite silently required it — Method Syntax §16.2 records the
forcing argument). The companion arc (PR δ) remains.

## 1. The problem, measured

A constraint member currently has no spelling in term position. Every route a
programmer would reach for is closed:

| Program | Diagnostic |
|---|---|
| `show(value)` under `a: Show` | ``unknown name `show` `` |
| `42 \|> show` | ``unknown name `show` `` |
| `Show.show(value)` | ``unknown name `Show` `` |
| `Ord.compare(x, y)` under `a: Ord` | ``unknown name `Ord` `` |
| `value.show()` under `a: Show` | declared-type-variable refusal (Method Syntax §3.4, last row) |
| `x.compare(y)` under `a: Ord` | same |

Only the evidence-driven forms work: string interpolation (`"${value}"`) and the
operator faces (`x < y`, `x + y`). A generic `compare`, `div`, or `gcd` call has
**no spelling at all**; a generic `show` exists only because interpolation happens
to reach the same evidence.

The book teaches otherwise at six sites — `let display<a: Show>(value: a): String
= show(value)`, the pipe form `value |> show`, and `show(box.value)` inside an
instance body among them. None compile. The book has been describing a rule the
language never adopted.

#304's expected-outcome table sits downstream of the same gap: `42.show()`,
`(42: Nat).show()`, `42n.show()`, `42.0.show()` all fail today, and the dispatch
they need has nothing to dispatch *to*.

## 2. What was stolen, and what was not

`constraint`/`honor` lifts the type-class system: constraint declarations,
instances, evidence selection, derivation, coherence. It did not lift the other
half of the design. In the source language, **a class method is an ordinary
module-level value.** Declaring `class Show a where show :: a -> String` puts
`show` into the module namespace as a plain exported function of qualified type
`Show a => a -> String` — importable, pipeable, passable to `map`, shadowable,
qualifiable. There is no separate access system for members, and no distinction
between a "polymorphic face" and a "monomorphic face": the monomorphic use *is
the same value instantiated at a type*, which inference or an ascription performs
without ceremony. When two imported modules both export a `show`, a bare use is
an ambiguous-occurrence error and qualification resolves it — which is exactly
the posture Modules §5.5 already takes for collided prelude exports.

There is precedent for finishing a theft rather than patching around an
incomplete one. `fun` was lifted from `let rec` and ran into hoisting trouble;
the repair was to become *more* like the source (top-down law, contiguous groups)
— and the result was simpler than the original, needing no `and`. The present
case has the same shape.

The language's own bones already half-agree:

- A member **is** a binding of its declaring module. Declaring two constraints
  with same-spelled members in one module is refused today: ``​`volume` is
  already bound; Hexagon does not allow rebinding``.
- A member already resolves qualified through the declaring module's alias
  (resolver: constraint members are read after `terms` on qualified access).
  Measured: `import * as Loud from "./loud"` then `Loud.volume(x)` in generic
  code compiles and dispatches through evidence, today. *(Era spelling — the
  run predates #565's `import module` head, Modules §3.3.)*
- What members lack is exactly what this note proposes: export status.

## 3. The proposal

> **A constraint member is an export of its declaring module.**

Nothing more. The consequences do the rest:

1. **The shipped constraints get declaring modules** — `Show.hex`, `Eq.hex`,
   `Ord.hex`, `Num.hex`, `Hash.hex`, `Signed.hex`, `Frac.hex`, `Pow.hex`,
   `Concat.hex` (the `++` face; the ninth compiler-held declaration, which an
   earlier draft omitted) — `Integral.hex` already exists; `Iterable` stays
   name-only per #283, collections-owned — and those modules join the prelude. This is
   stdlib-roadmap §5.2 preferred-order **item 1**, the oldest unpaid item in the
   migration plan, arriving with a purpose rather than as hygiene: prelude
   membership is what puts `show` into bare scope everywhere.
2. **One system.** `show(42)` bare (defaulting settles Int), `show(v)` at
   `Vector`, `values.toSeq().map(show)` (spelled through `Seq` — `Vector` has
   no `map` combinator yet; its ship-list is the listing session's separate
   obligation), `42 |> show`, `Show.show` qualified — all the same value,
   instantiated per use. There is no second, monomorphic access
   system to design, name, or keep coherent with the first.
3. **An honored member's spelling is claimed against ordinary bindings.**
   Hexagon has no overloading: honoring a constraint claims each member's name
   in the module's term space, so an *ordinary* module-level binding of that
   spelling — a `let`, exported or private — is the ordinary rebinding error,
   no new rule needed. The claim is against ordinary bindings only: member
   definitions from *distinct honor blocks* **coexist** — one module honoring
   two constraints with same-spelled members (consequence 5's cross-module
   case) is legal today and stays legal, disambiguated by evidence at use, by
   qualification, or by the §5.5 refusal where a bare use is genuinely
   ambiguous. *(Cold-review repair: an earlier draft said "any module-level
   binding," which would have refused consequence 5's measured-legal program
   and made consequence 4's several-types ambiguity unreachable.)* This makes the current delegation
   pattern (`add(left, right) = add(left, right)` beside a module-level `let
   add`) ill-formed, not merely unfashionable: the member's body is written in
   the honor block, and a genuinely shared helper takes a different name. It
   also retires, by construction, a defect expressible today: a module can
   currently export `show(box) = "export"` *while* honoring `Show<Box>` with
   `show(box) = "member"` — it compiles with no diagnostic, and the spellings
   split (dot call and in-module bare use take the export; interpolation takes
   the member). Two meanings, silently. Under this proposal that program is
   refused where all rebindings are refused, with the diagnostic the language
   already owns.
4. **Qualified access through an honoring module reaches the honored member.**
   `Rat.add(r1, r2)` resolves — there is no export `add` to conflict with, and it
   denotes the `Num<Rat>` member. Likewise `Int.show(42)` denotes `Show<Int>`'s
   member once dispatch lands. The design motto here is the **uniform access
   principle**: a consumer's spelling `M.f(…)` must survive `f` migrating
   between a plain module function and a constraint member, in either direction,
   without any call site changing. (One detail this requires: `M.f` denotes the
   member *at the type `M` honors*; a module honoring the same constraint at
   several of its own types makes `M.f` ambiguous and takes the §5.5 refusal
   posture. Companions honor at one type, so the common case is never
   ambiguous. And the member→function direction can narrow a signature — call
   sites at the module's own type survive; that is the set `M.f` addresses.)
   On the declaring module itself the polymorphic read wins: `Show.show`
   denotes the declaration's export even if `Show.hex` also comes to hold
   honor blocks (§5 item 4). This consequence is implementation work and has a
   home: it lands with PR γ's dispatch, and the §5 item 8 own-name refusal is
   sequenced after it for that reason.
5. **Same-spelled members across modules are ordinary collisions.** Measured:
   two constraints in separate modules, both with `volume`, one type honoring
   both — legal, and `Loud.volume` / `Soft.volume` select correctly. A bare use
   where both are visible takes Modules §5.5's existing law: refuse, name the
   qualified homes. No renaming, no priority order, no resolution order to
   specify. *(PR β measurement repair: the measured-legal program is
   namespace-import-shaped — `import * as Loud` *(era spelling; #565)* — and that is the shape the
   coexistence claim covers. Importing both constraints by* name *collides at
   the second import item, because a named constraint import carries its
   members and an arriving member name that meets another module-level term is
   the Constraints §2.2 hard-error family reported at the import — Modules
   §3.1's named-import rule. Two same-spelled members declared in one module
   collide the same way at the second declaration. Neither refusal is new law,
   and neither dents the consequence: the qualified spellings are the
   namespace ones. One more consequence of the shapes: the "bare use where
   both are visible" refusal above is realizable only at the prelude layer —
   which is §5.5's actual jurisdiction — since namespace imports put no
   member in bare scope and named imports refuse before any use.)*

## 4. What is fixed

- The six book sites compile as written; the book's rule becomes the language's
  rule rather than an aspiration.
- Generic constraint-member calls exist: `display`, a generic `compare`, a
  generic `div` — previously unspellable in any form.
- Higher-order and pipe positions work: `values.toSeq().map(show)`, `x |> show`.
- Method Syntax's own broken promises are discharged: §7's closing sentence
  already teaches "prelude constraint members are called bare (`show(x)`) or
  piped (`x |> show`)", and §9 row 6's redirect tells the user to "call it
  directly: `compare(x, y)`" — both spellings are `unknown name` today, so the
  *spec*, not just the book, asserts the rule this note adopts.
- The polymorphic/monomorphic split disappears as an architecture (consequence 2
  above).
- The silent export/member divergence becomes unwritable (consequence 3).
- **#304's table needs no companion modules to go green.** `n.div(2)` is
  `Integral`'s member at `Int` via the honored instance; `42n.show()` is `Show`'s
  member at `BigInt`; `(42: Nat).show()` is `Show`'s member at `Nat` (Nat already
  honors Show). The companion files (`Int.hex`, `BigInt.hex`, …) remain owed for
  their *non-member* operations and for guard retirement — a cleanup arc,
  decoupled from the table.

## 5. What still breaks, or is not yet designed

Each item here needs either a bit more stealing or a deliberate extension.

1. **Dot-call dispatch does not see members.** The companion operation set
   (Method Syntax §4.2) is exports-of-the-companion only; measured, a dot call
   on a type whose `Show` instance exists but whose companion exports no `show`
   is refused ("the companion of `Box` has no operation `show`"). For
   `42.show()` and `n.div(2)` the operation set must extend to *members of
   constraints the receiver's type honors*, with the §5.5 refusal posture at
   ambiguity. This is #304's own dispatch work, unchanged in kind.
2. **Bare-literal receivers still need the defaulting amendment.** `42.show()`
   requires Numeric Literals §4's defaulting to settle the receiver *before*
   Method Syntax §3.5's row fallback fires (the receiver is otherwise imposed to
   be a record and dies at the `Num` collision). Orthogonal to this note;
   already specified in #304's discussion; only touches programs that are
   guaranteed errors today.
3. **Prelude ordering.** The constraint modules sit early (nearly everything
   uses them), and among themselves need a seats-before-uses order (`Eq` before
   `Ord`; `Ord` answers with `Ordering`, which lives in `Prelude.hex`). The
   pilot already seated `Show.hex` *first* — before `Bool.hex`, which derives
   Show two lines in — so the weave design PR β owes starts from that fait
   accompli, not from Bool-first. Needs the usual weave design, not just a
   list.
4. **Where primitive instances live.** The roadmap's row says constraint sources
   carry "declarations and primitive `honor` blocks"; whether `Show<Int>` lands
   in `Show.hex` or waits for `Int.hex` must be decided per constraint — and it
   is a *design* interaction, not mere file placement *(cold-review repair)*:
   a declaring module that also honors holds the member spelling twice (the
   declaration's export and the instance's binding), which consequence 3's
   coexistence carve-out permits and consequence 4's precedence sentence
   resolves (the polymorphic read wins on the declaring module). The pilot
   answered "wait" for Show: primitive instances stay compiler-wired,
   `Show.hex` carries no honor blocks, and nothing observable depended on the
   choice.
5. **The JS/`.d.ts` face.** A member call in emitted JS goes through evidence
   (`__hex_instance_…`); what a TypeScript consumer sees when the flat export no
   longer exists needs measuring against the exported-dictionary machinery
   (FFI Part 9 / the #276–#282 arc). Likely already answered there; unverified.
6. **Occlusion and shadowing.** A user module that exports its own `show`
   occludes the prelude member under §5.4 (layer test) — this appears correct
   and needs pinning, not design. A parameter or other head binder likewise
   shadows (Statements §5.1); a function-local `let show` is the ordinary
   rebinding refusal, prelude membership notwithstanding (§5.4: "a
   function-local binder may occlude nothing") — *(cold-review repair: an
   earlier draft wrongly said a local `let` shadows lexically)*.
7. **Existing corpus contact points.** `Rat.hex` exports `add`/`subtract`/
   `multiply`/`divide`/`negate` while honoring `Num`/`Signed`/`Frac` at `Rat` —
   legal today via the delegation pattern, refused under consequence 3. The
   repair is mechanical and fully determined: **fold the bodies into the honor
   blocks**, as `compare` and `show` already do — the delegation shims are
   ill-formed under consequence 3 (rebinding), so there is no half-repair to
   drift into. Consumers keep every spelling: `r1 + r2`, bare `add(r1, r2)` (post-steal), `Rat.add(r1, r2)`
   (consequence 4), `r1.add(r2)` (post-dispatch). `Rat.hex` is the migration's
   worked example.
8. **Scoping inside an honor block — ruled by the letrec law.** With members in
   bare scope, what does `show` mean *inside the block defining it*? Three
   readings were litigated: (i) the block binds nothing, so bare `show` is the
   polymorphic export even in its own body — but then the same spelling
   evidence-selects *different instances* depending on the argument's type
   inside its own definition, a subtlety wearing an innocent face; (ii) the
   block binds its member names `fun`-group style, monomorphically — which
   turns the book's nested `show(box.value)` into a type error. The ruling is
   (iii), and it is not new law: **a member definition is a `let`-header, not a
   `fun`, and a non-`fun` binding cannot call its own name.** The top-down
   ruling (#293) already decided this for every other binding in the language;
   honor blocks simply inherit it. Within a member's body its own spelling is
   refused, with a rewrite diagnostic naming the sanctioned forms:

   ```text
   honor Show<Box> =
       show(box) = "Box(${box.value.show()})"      -- dot call, or
       show(box) = "Box(${Int.show(box.value)})"   -- qualified
   ```

   Recursion is spelled, not implied: `Tree.show(kid)` or `kid.show()` — the
   writer names which instance they mean, where reading (i) would have left it
   to evidence selection to decide silently. No `fun`-member form is added;
   the explicit spellings are the recursion story. The book's nested example
   is invalid as written and rewrites to the dot-call form.

   **Sequencing (cold-review repair).** The refusal's sanctioned rewrites do
   not exist until PR γ lands member dot-call dispatch (§5 item 1) and
   consequence 4's qualified access — so the refusal itself belongs to PR γ,
   *after* both, or source-declared constraints are left with no recursion
   spelling at all. PR α therefore pins today's behavior as an explicit
   baseline (bare own-name inside a member body is the polymorphic export,
   reading (i)) that PR γ deliberately flips, rewriting the baseline pins and
   the pre-existing evidence-threading pin (`emitter.test.ts` ~1775, whose
   `Describe<Tree(a)>` instance uses exactly the spelling the ruling refuses)
   to the sanctioned forms. The declaring-module qualified spelling
   (`Show.show(kid)`) and interpolation both exist at PR α and serve as
   interim spellings, with the caveat that both re-enter evidence selection —
   acceptable in a pinned baseline, not as the end state.

   **The ordering half, ruled:** member bindings enter the module's top-down
   order *at their honor block's textual position*. A member is a `let`
   function; a `let` function's body may name only bindings that precede it;
   honor blocks are ordered like any other declarations. A `Frac<Rat>` block
   above the `Num<Rat>` block may **not** name `multiply` — the ordinary
   declared-later error, and the fix is the ordinary one: order the blocks.
   (`Rat.hex`'s existing order — Num before Signed before Frac — already
   complies; the fold-in migration needs no reordering.) The law governs
   *name references* only: mutually referencing instances reach each other
   through evidence — interpolation today, dispatch at PR γ — which names no
   binding and evaluates at call time, so instance-level mutual recursion
   (the item 9 pins) was never inside this ruling's jurisdiction. The
   dot-call-vs-own-position interplay (#293 ruled a group-wide dot ban for
   `fun` groups; whether an honor block needs its analog) is PR γ's spec
   work.

   The same ruling settles what a member's spelling means in the *rest* of the
   honoring module: **a member definition is a module-level binding**, and
   every consequence is an existing law applied to that one sentence. Its
   spelling cannot be taken by an ordinary binding (the claim — consequence 3,
   which also states the member-vs-member coexistence carve-out). Its own
   body cannot call its own name (#293's non-`fun` law — this item). A
   sibling member or any other code in the module using the bare spelling gets
   *this* binding — `divide(left, right) = multiply(left, reciprocal(right))`
   in `Frac<Rat>` means the `Num<Rat>` member, monomorphic, occluding the
   prelude's polymorphic export exactly as Modules §5.4's layer law already
   occludes any prelude name a module binds locally. And it is what qualified
   access reaches from outside (consequence 4). There is only one `multiply`
   at `Rat`; bare-in-module, `Rat.multiply`, and evidence dispatch all reach
   it. The alternative reading — the spelling merely *reserved* in the module,
   binding nothing, bare use still meaning the polymorphic export — was
   considered and rejected: a reservation that binds nothing is a mechanism
   with no precedent in the language, and it splits one spelling into two
   denotations inside a single file.

   One boundary must hold for the collision arithmetic of consequence 2:
   **the honoring module's member binding is qualifiable but is not a bare
   export.** If companion modules in the prelude poured their member bindings
   into consumers' bare scope, `show` would have six exporters and Modules
   §5.5 would refuse the bare name everywhere — recreating the collision
   explosion this design eliminates. Bare `show` in consumer code has exactly
   one exporter, `Show.hex`; the honoring module's binding is reached bare
   only from inside that module (§5.4 layering) and by qualification from
   anywhere. This mirrors the existing rule that a member is not an
   independently importable name.
9. **The emission fault line for recursive instances.** Evidence-dispatched
   recursion means an instance references itself. The governing line,
   illustrated by the `Vector(Vector(a))` faults (commit `6a34584` — those
   were generated-binder TDZ, a cousin, not this law itself): **anything an
   instance
   needs before its own `const` finishes initializing is a fault; anything
   inside a member's lambda is safe** (lambdas evaluate at call time). Plain
   self-recursion and mutual recursion between members sit on the safe side.
   The dangerous cousin is a *parameterized* recursive instance
   (`Show<Tree(a)>` needing itself for a `kids` component): kept inside the
   lambda it is safe; pre-composed outside it, it is the #306 crash wearing
   evidence clothes — a clean compile and a load-time `ReferenceError`. Both
   #306 faults were clean compiles found only when a pin finally executed the
   nested shape, and one of the two (`Hash`) was pre-existing and never
   executed by a test. The step-2 pilot therefore owes three **executed** conformance
   pins before anything ships: a recursive member, mutually recursive members
   of one block, and a recursive parameterized instance. The last may well
   catch a real pre-existing defect, as the equality pin caught `Hash`.
10. **The transitional guard.** `Int.div`/`BigInt.div`/`Float.div` (the
   resolver's primitive-operation guard) remains until the companion arc retires
   it per intrinsics §9.2. Under this note the qualified *polymorphic* spelling
   `Integral.div(n, 2)` also becomes available once `Integral.hex` is reachable;
   the two coexist on the §9.2 schedule, bounded as before.

## 6. Pathway

Each step lands alone, measurable, and reversible before the next.

1. **This note bakes.** Read, poke, amend.
2. **PR α — the steal, piloted on one constraint.** `Show.hex` declares `Show`
   with `show` as an export; joins the prelude; the checker treats it as the
   canonical `Show` (the intrinsic-door pattern, applied to a constraint
   declaration). Acceptance: the book's `display` compiles; higher-order use
   compiles as `values.toSeq().map(show)`; `show(42)` compiles and means `Int`
   by defaulting; and the three executed recursion pins of §5 item 9 pass,
   spelled in the interim forms item 8's sequencing paragraph sanctions. The
   fixed/broken report from this pilot decides whether the design generalizes
   as-is.
3. **PR β — the remaining constraint modules**, one weave, same pattern, plus
   the redeclaration refusal (consequence 3) and the `Rat.hex` migration as its
   worked example.
4. **PR γ — #304 dispatch.** The §3.5 defaulting amendment; the operation-set
   extension to honored members; consequence 4's qualified access through
   honoring modules; then — after both spellings exist — the §5 item 8
   own-name refusal, flipping PR α's reading-(i) baseline pins and rewriting
   the pre-existing `Describe` evidence-threading pin to the sanctioned
   spellings. The refusal diagnostics name qualified homes throughout. The
   four-row table goes green here.
5. **PR δ — the companion arc** (`BigInt.hex`, `Int.hex`, `Float.hex`,
   `String.hex`, `Nat.hex`): non-member operations, intrinsic-door migration,
   guard retirement per intrinsics §9.2, doc comments per house canon. Smaller
   than originally scoped, because the members no longer live here.

## 7. Relation to #304's expected-outcome table

| Program | After PR γ | Mechanism |
|---|---|---|
| `42.show()` | `"42"` | defaulting settles `Int` (step 4's amendment), `Show<Int>` member |
| `(42: Nat).show()` | `"42"` | head-known `Nat` (#307), `Show<Nat>` member |
| `42n.show()` | `"42"` | head-known `BigInt`, `Show<BigInt>` member |
| `42.0.show()` | `"42"` | head-known `Float`, `Show<Float>` member |

No row waits for a companion module.
