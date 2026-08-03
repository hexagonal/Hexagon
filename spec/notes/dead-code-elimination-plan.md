# Dead code elimination — speculative work order

**Status:** Speculative (2026-08-03, Opus in conversation with James). This note
decides nothing and states no language rule. It records an emitter/resolver
optimization, the observations it rests on, and — separately and explicitly —
the claims that were *not* verified and must be confirmed before any
implementation begins. Next step is Fable's fundamental spec analysis.
Implementation follows only after that.

**Authorities on any conflict:** `modules.md` (§3.4 effect imports, §7
instances and coherence, §8 loading and top-level effects, §11 emission),
`functions.md` §8 (the value restriction), `constraints.md` §5 (coherence) and
§6.3 (evaluation-freeness). This note navigates; it never overrides.

**Companion note:** `dictionary-cse-plan.md`. The two plans both change a
module's top-level binding set and must not land against the same pinning
corpus at the same time (§8).

---

## 1. What this is

Hexagon's module graph is **exact**, not approximated. There are no import
cycles (Modules §8.1), no first-class modules (§3.3 — "modules are not
values"), no dynamic import, and every qualified name resolves at compile time
to a specific export (§11.2). A JavaScript bundler spends most of its
complexity budget reconstructing, heuristically and incompletely, the graph
this compiler is simply handed.

That is an unclaimed payoff, and there is already a bug in the emitted output
proving it is unclaimed (§3.1).

Like the CSE plan, this is **semantics-preserving and confined to the compiler's
back half**: no new syntax, no type-system change, no `.d.ts` surface change, no
book text. Unlike the CSE plan, it is *not* uniformly free — the third tier
(§4.3) needs a ruling, and this note recommends against pursuing it now.

## 2. Current emitted shapes

All of the following were compiled through `compileProject` on
`notes-dictionary-cse-plan` and are **verified** — each is the actual emitted
text, not an inference from the code.

**Prelude imports are already pruned to used names.** The resolver synthesizes
"a used-names-only import per prelude module that a module references, so
emission stays free of unused prelude imports" (`resolver.ts:99-100`;
`#preludeImport` at `:2496`). A module with no prelude reference emits no
prelude import at all:

```hexagon
export fun run(x: Int): Int = x + 1
```
```js
function run(x) { return x + 1; }
export { run };
```

**But dispatch candidates are registered from syntax alone.**
`#noteCompanionCandidate` (`resolver.ts:387`, called at `:1581`) marks a prelude
term reachable from the bare shape `receiver.field(…)`, because whether that is
a companion dispatch depends on the receiver's **type** — which the checker
decides long after the import list is built. The comment there is explicit that
this is "conservative in one direction only."

`#routesToCollectionCore` (`:413`) later removed the subset that *is*
syntactically decidable — receivers spelled `Map`, `Set`, `Vector`, `Node` —
which is the `Vector.length(v)` sting recorded in Collections Part 1 §10.

**The residue is everything else with that shape.** Verified, on a module with
zero diagnostics:

```hexagon
export record Box = {map: (Int) -> Int}
export fun run(b: Box): Int = b.map(3)
```
```js
import { map } from "./Seq.js";
import { __hex_imported_3___hex_instance_Eq_Option as __hex_imported_4___hex_imported_3___hex_instance_Eq_Option,
         __hex_imported_3___hex_instance_Show_Option as __hex_imported_4___hex_imported_3___hex_instance_Show_Option } from "./Seq.js";
const Box = __hex_record => __hex_record;
function run(b) { return (b.map)(3); }
export { __hex_imported_4___hex_imported_3___hex_instance_Eq_Option };
export { __hex_imported_4___hex_imported_3___hex_instance_Show_Option };
export { Box };
export { run };
```

`b.map` is a **record field of function type**. It is not a dispatch, the
checker knows it is not a dispatch, and the emitted module still imports
`Seq.map` — pulling `Seq.hex`, and `Bool.hex` behind it, into the graph — and
then **re-exports the two dead instances**.

**Unreferenced private bindings are emitted.** Both forms, verified:

```js
function unusedHelper(x) { return x * x; }   // never referenced, never exported
const table = 42;                            // likewise
```

**An unreferenced private binding may still carry an effect.** Also verified,
and the reason §4.1 is a predicate rather than a sweep:

```hexagon
let noise: Unit = console.log("hi")
```
```js
const noise = console.log("hi");
```

**Exported-but-never-imported bindings are emitted**, which is correct at the
module tier and is only a question at all under §4.3.

## 3. The defects

### 3.1 The resolver must guess what the checker already knows

Load-bearing and **verified** (§2). This is an *ordering* problem, not an
analysis problem: no cleverness is missing, the answer simply is not available
yet at the point the import list is built. Every `x.f(…)` in the program whose
`f` collides with a prelude export costs a dead import and, transitively, dead
modules in the emitted graph. Collections Part 1 §3.1's naming doctrine makes
the collisions *deliberate and increasing* — `length`, `prepend`, `map` are
shared vocabulary on purpose — so this gets worse as the collection APIs
converge, exactly as the #219 record predicted.

### 3.2 Dead evidence is re-exported

Worse than the dead import, and the part that was not anticipated. A dead
instance import becomes part of the emitted module's **public ESM surface**
(`emitter.ts:595-599`). A downstream bundler cannot drop what a module exports,
so the leak is not merely un-eliminated — it is *pinned against* elimination by
anything downstream.

### 3.3 Unreferenced private bindings are emitted

**Verified.** Privacy is enforced by the checker and the emitted JS "simply
doesn't export what wasn't exported" (Modules §11.1). So a private binding no
one in its own module references is unreachable by construction, with no
whole-program reasoning required. This is the cheapest tier and the only one
with no spec question attached.

### 3.4 Unreachable exports survive — but this may not be a defect

**Verified** that they are emitted; **not established** that they should not
be. Modules §8.3 has no privileged `main`, and "library versus application is
not a distinction in Hexagon module semantics." An export nobody imports *in
this build* is exactly what a library is. Recorded to be ruled on, not assumed.

## 4. Proposed mechanism — three tiers, increasing cost

Deliberately separable. Tier 1 can land alone and is worth landing alone.

### 4.1 Tier 1 — module-local private-binding elimination

Drop a top-level binding when **both** hold:

1. It is not exported and not referenced anywhere in its own module, and
2. its right-hand side is a **syntactic value** (Functions §8).

Condition 2 is the whole subtlety, and Hexagon supplies it for free: the
checker *already* computes "is this RHS a syntactic value" to decide
generalization. A syntactic value is a variable, constant, lambda, or
constructor applied to values — evaluating it is total and effect-free, so
deleting it is unobservable. `let noise = console.log("hi")` fails condition 2
and stays. No new analysis is written; an existing predicate is read a second
time.

No whole-program view, no spec question, no boundary interaction — but see
**§9**, which is the reason this tier cannot simply be switched on everywhere.

### 4.2 Tier 2 — rebuild the synthesized import list after checking

The conservative candidate set of §3.1 is intersected with what the checker
actually resolved: a `receiver.field(…)` the checker typed as an ordinary field
access contributes nothing. The resolver's over-approximation stays exactly as
it is (it must — it guards against the silent failure recorded at
`resolver.ts:382-385`); a later pass narrows it.

**This tier has a recorded objection against it and must answer it.**
`resolver.ts:2527-2532` states that prelude *instances* are dropped before
checking rather than after, deliberately, because "consumers build their own
import lists from [the module interface], so an instance pruned later would be
a name a consumer asks for and the producer no longer emits." Any post-check
narrowing must show either that it never touches the interface consumers read,
or that it re-derives consumer import lists consistently. The term half
(`import { map }`) and the instance half (§3.2) may well differ here; they are
not one change.

### 4.3 Tier 3 — whole-program reachability from roots

Compute reachability from the host-selected root modules (Modules §8.3) and
drop unreachable exports. **Recommended against, for now.** It needs the §3.4
ruling first, it dies the moment packages arrive (§12.1, and §7.5 already
records that whole-program coherence has the same expiry), and it buys least.
Recorded so it is not rediscovered as an obvious win.

## 5. Why Hexagon can do this

| Restriction | What it buys here |
|---|---|
| Value restriction (Functions §8) | The effect-freeness predicate §4.1 needs is **already computed** for generalization |
| Acyclic imports (Modules §8.1) | The graph is a **DAG**, so reachability is one topological sweep — no fixpoint, no cycle-initialization hazard |
| No first-class modules (Modules §3.3) | Every name resolves at compile time; there is **no dynamic lookup** to defeat the analysis |
| Global coherence (Constraints §5.1) | Instance liveness is a **table lookup** on (constraint, constructor), never a search |
| Instances are evaluation-free (Constraints §6.3) | Dropping an unselected instance **cannot drop an effect** |

The first row is the interesting one and the reason this note exists. The
value restriction is filed in the corpus as a soundness rule about
generalization (Functions §8.2 calls it "Hexagon's monomorphism restriction").
It is also, unclaimed, an **emission license**: it partitions top-level
bindings into ones whose evaluation is observable and ones whose evaluation is
not, which is precisely the partition a dead-code pass needs and normally has
to compute for itself.

## 6. What must be confirmed before implementation

Recorded separately and deliberately. None of the following was verified.

1. **That the checker's dot-call resolutions are reachable in a form the import
   list can be rebuilt from** (§4.2). The narrowing is only as good as the
   `DotCall` goal's recorded answer, and Method Syntax §10's Deferred-Goals
   Doctrine means some answers land late. Confirm *when* the last one lands.

2. **That the `resolver.ts:2527-2532` interface-honesty objection does not sink
   §4.2**, or that it scopes to instances only. This is the single most likely
   reason Tier 2 is wrong, and it is written down in the source by whoever last
   thought about it.

3. **That nothing outside the reference graph reaches a private binding.** The
   intrinsic door (`intrinsics.md`), the `#runtime` manifest privilege, and the
   conformance harness all reach into modules by means other than an ordinary
   reference. Tier 1's condition 1 is only sound if `#declare` and the
   reference graph together see all of them.

4. **That pruning cannot recreate #153.** That open defect — a prelude module
   named only through its *types* strands its instances — is the observed
   **under**-inclusion failure of exactly this machinery. Any change here must
   be tested against it, and §4.2 moves in the direction that makes it worse.
   Fix or characterize #153 first.

5. **That `.js` and `.d.ts` cannot diverge** under any tier. Modules §11.4
   fixes what appears in the declarations; a binding dropped from one and not
   the other is a silent boundary defect.

6. **Whether an unused *explicit* import is in scope at all.** `import
   { area, perimeter }` with `perimeter` unused emits both (verified). That
   reads as a lint the user should see rather than something the emitter should
   quietly repair — and Modules §12.5 parks lint policy outside spec scope.
   Decide it, don't drift into it.

7. **The root set of every consumer** (§9.5), and the reference graph's
   treatment of recursion (§9.3). Both were added after the rest of this list
   and both gate Tier 1 harder than anything above it.

## 7. Non-goals

- Re-implementing a bundler. This plan makes the emitted graph honest; it does
  not concatenate, minify, or rewrite across module boundaries.
- Touching effect imports (Modules §3.4). `import "./telemetry"` exists
  precisely to be unreferenced; it is never dead.
- Dropping any module with top-level effects (Modules §8.2). Legal, ordered,
  and observable.
- Changing what a module exports, or any `.d.ts` face.
- Instance *selection*. Like the CSE plan: this changes what is emitted, never
  which instance is chosen.
- Tier 3 (§4.3), for this pass.

## 8. Expected blast radius

Output-pinning tests churn, for the same structural reason as the CSE plan §8 —
this changes emitted text broadly by construction. Budget for it rather than
meeting it mid-change, and settle how intended churn will be distinguished from
unintended **before** starting.

Two specific hazards:

- **Sequencing against the CSE plan.** That plan *adds* module-level bindings;
  Tier 1 *removes* them. Landing both against one pinning corpus makes each
  change's diff unreadable. One at a time, corpus re-pinned between.
- **#218 blinds the stdlib.** `stdlib/Vector.hex` "is compiled by nothing: no
  test, no CI path, no prelude embedding." The corpus therefore cannot be
  trusted to catch a regression there, which is unfortunate given that
  `Vector`'s shared vocabulary is what produced §3.1 in the first place.

**Which corpus churns is not uniform, and §10 measures it.** The short version:
the conformance corpus is largely safe and the emitter's unit tests are not.

Tier 1 fails loudly (a dropped binding that was needed is a `ReferenceError` at
load, or a missing export at check). Tier 2 fails the same way in one direction
— and **silently** in the other, since an over-pruned instance is a missing
dictionary, which is #153's shape.

## 9. Who is looking at the output

*(Added 2026-08-03, on James's question. This section changes §4.1's default
and is the most consequential part of the note.)*

The plan above is written as though emitted JavaScript has one audience. It
does not. The Playground's JS pane exists so a reader can see **what their code
became**, and Tier 1 is defined to delete code precisely when nothing has yet
used it — which is the normal state of a snippet someone is part-way through
writing.

### 9.1 The Playground will see this immediately

**Verified.** `playground/src/compile.ts:41` calls `compileProject(files)` with
no options and emits with `emitJavaScript(module.core, {…})`. Nothing in that
path would suppress a pass added inside the compiler; DCE arrives in the pane
the moment it lands.

### 9.2 Measured on the shipped examples

Each example in `playground/src/examples/` was compiled and its emitted JS read.
*(Measured 2026-08-03. Two examples — `polymorphism` and `vectors` — could not
be measured: compiled outside the Playground's own `layOutWorkspace`, they crash
the checker in `#materializeUnwidenedExpr`. Three others need the workspace's
module wrapper or hosted libraries. Whether the crash is a real defect or an
artifact of compiling them bare was **not** established and is not claimed here.)*

The first claim this note made — that the tour "loses most of its content" —
was **wrong, and the corrected version is a better argument.** In
`hello-world.ts` ("A Tour of Hexagon", the default snippet), most bindings
survive, but they survive **by accident**:

| Binding | Fate under §4.1 | Why |
|---|---|---|
| `greet`, `greet2` | survive | only because the file ends with `console.log(greet("Hexagon"))` |
| `card` | survives | `let (rank, suit) = card` reads it |
| `rank`, `suit` | **dropped** | destructured, never read |
| `plus` | **dropped** | private, unreferenced, a lambda → a syntactic value |
| `color` | **dropped** | ditto |
| `factorial` | **dropped**, but only if §9.3 is handled | referenced *solely by itself* |

So the tour loses its `match` demonstration, its recursion demonstration, and
its "private return types remain inferred" demonstration — three of the eight
commented sections, each one a headline feature with an explanatory comment
above it. And `greet`/`greet2` survive only because the author happened to end
the file with two `console.log` lines. **Delete those two lines and half the
tour evaporates.** A teaching example should not depend on that.

There is a second-order ugliness worth recording because it will be seen before
anyone reasons about it. Comments are emitted (verified — they appear in the
output above their code). Dropping `plus` and `color` leaves:

```js
// Private return types remain inferred.
// Match handles every union alternative.
console.log(greet("Hexagon"));
```

Orphaned explanatory prose with nothing underneath it.

### 9.3 Recursion: the reference graph must work on components, not bindings

**Found while measuring, and it is a correctness point, not a Playground one.**
`factorial` references only itself. A naive "is this name referenced anywhere?"
pass sees a reference and keeps it forever — a recursive dead binding holds
itself alive. Tier 1 must therefore ask whether a **strongly connected
component** of the reference graph is reachable from a root, not whether an
individual binding is referenced.

That is more work, and Hexagon has already paid for it: `checker.ts:958-965`
computes exactly these components for generalization. This is the same shape as
§5's first row — machinery built for the type system, reusable verbatim by the
emitter. Worth confirming the component structure is reachable from where a DCE
pass would run, which was **not** checked.

### 9.4 It would drop things *erratically*, which is the real objection

If Tier 1 simply hid every unreferenced binding, a reader would learn the rule
in one sitting. It does not. Condition 2 is Functions §8.2's syntactic-value
test — "a lambda literal, a literal, a reference to an immutable term binding, a
constructor application of values, a record literal whose field values are
values, or a tuple of values. A function *call* is not a value" — and that line
falls in a place with **no relationship to what the reader is looking at**. Two
unreferenced private bindings from the shipped examples — `card` in
`hello-world`, `numbers` in `polymorphism`:

```hexagon
let card = (10, Hearts)                  -- tuple of values → a value → VANISHES
let numbers = Seq.prepend(nothing, 42)   -- a call → not a value → SURVIVES
```

Both private, both unused, both looking identical to anyone who has not read
§8.2. The predicate that makes Tier 1 *sound* makes it *unteachable* as an
inspection experience.

*(`card` is in fact referenced in `hello-world` as written, by the destructuring
on the next line; it is used here for the shape of its right-hand side, which is
what the contrast is about.)*

### 9.5 The line, and it runs between the tiers

> **Tier 1 removes what the user wrote. Tier 2 removes what the compiler added.**

An inspection host must never do the first and should always do the second.
This is not a compromise between them — the two tiers want opposite defaults,
and noticing that is the main thing §9 contributes.

Tier 2 is not merely *safe* in the Playground; the Playground is its
**highest-value** venue. §3.1's spurious `import { map } from "./Seq.js"` is
noise the user did not write, appearing in the exact pane the project's
positioning is staked on. Ship Tier 2 there deliberately, not incidentally.

### 9.6 Preferred mechanism: a root set, not a suppression flag

There is a precedent for a flag, and it is a good one:
`previewPrivateSpecializations` — "Includes private editions for inspection
tools; ordinary builds omit them" (`emitter.ts:25`) — exists for exactly this
class of concern, in exactly this direction, and the Playground already passes
it.

Even so, prefer deriving the behaviour over flagging it. Modules §8.3 already
gives root selection to the **compiler host** and states that "library versus
application is not a distinction in Hexagon module semantics." A host whose
purpose is displaying one module declares **every top-level binding a root**.
Tier 1 then does nothing there by the ordinary rule rather than by an exception
to it, and no second code path exists to drift. A flag says "the Playground is
special"; a root set says "the Playground is a host, and this is its root set" —
which is already true.

### 9.7 Owed: a consumer inventory

The note had been assuming one consumer and there are at least six. Each needs
its root set stated before Tier 1 lands: the Playground JS pane, the Playground
`.d.ts` pane, the book's emitted-output samples, the LSP, the test corpora
(§10), and ordinary `hexc` builds.

---

## 10. The two test corpora behave oppositely

*(Added 2026-08-03. §6 item 7 and §9.7 originally guessed that the conformance
corpus was the thing at risk. **That guess was wrong**, and measuring it found
the real casualty somewhere else. Recorded in full because the reasoning that
produced the wrong guess is the reusable part.)*

### 10.1 The conformance corpus is largely safe

`compiler/src/conformance/` is **execution**-based, not text-pinning:
`emission-shapes.test.ts` opens by saying each case "executes the emitted
module, so a wrong shape shows up as a wrong value rather than as a text
mismatch," and the cases assert on `m.out`, `m.nothingCase`, and friends.

That harness shape is what protects it. **The export is the observation
channel**, so every fixture is written as private helpers feeding an exported
observable:

```hexagon
record Box = { value: Int }
let wrapper: Int -> Box = value => Box({ value = value })
export let out: Int = (wrapper(7)).value
```

`wrapper` is private, but `out` reads it, so it is reachable from a root under
any tier. A fixture whose private binding were genuinely unreferenced would be
a fixture testing nothing — the harness cannot observe it. Tier 1 is close to
a no-op here **by construction**, not by luck.

### 10.2 The emitter's unit tests are the casualty

`passes/emitter/emitter.test.ts` inspects **text**, so it needs no observation
channel — and its fixtures are therefore written as minimally as possible: one
private binding exhibiting one emitted shape, with nothing calling it. That is
precisely Tier 1's deletion criterion.

Verified, `emitter.test.ts:1593-1605`:

```hexagon
export let plus<a: Num>(left: a, right: a): a = left + right
let double = value => plus(value, value)
```
```js
// asserted:
const double = (value, __hex_dictNum_7) => plus(value, value, __hex_dictNum_7);
```

`double` is private, unreferenced, and a lambda literal — a syntactic value on
Functions §8.2's list. **Tier 1 deletes the binding the test exists to
inspect**, and the assertion fails against an absent line. `:1607-1611`'s
`display` is the same shape, and it will not be the last.

### 10.3 What this means for sequencing

The corpora are not one budget. §8's "churn" advice holds for the conformance
side; the emitter side needs a **decision**, not a budget:

1. Rewrite the affected fixtures to export what they inspect — honest, and it
   makes each test say what it observes, but it is a wide mechanical edit and
   it changes every asserted string from `const double = …` to an exported
   form.
2. Emit the emitter's unit tests under the same all-bindings-are-roots host as
   the Playground (§9.6) — no fixture edits at all, and it keeps the tests
   testing emission rather than reachability.

**Option 2 is the recommendation**, and it is an argument for §9.6's framing
over a Playground-specific flag: the moment a *second* consumer wants
all-bindings-are-roots, "the Playground is special" stops being the right
model. The emitter's own test suite is that second consumer, and it turned up
within an hour of the first.

### 10.4 How the wrong guess happened

Recorded per the house habit. The guess — "the conformance corpus's fixtures
are mostly private and unreferenced" — was extrapolated from the *word*
"conformance" and from #218's note that `stdlib/Vector.hex` is compiled by
nothing, without opening a single fixture. Reading one file falsified it in
under a minute, and reading a second found the real casualty. The tell is that
the claim was about a corpus's *shape* while the evidence was about its
*name*.
