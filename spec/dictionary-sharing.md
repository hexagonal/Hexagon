# Hexagon Dictionary Sharing: Module-Level Evidence Materialization

**Status:** Decided (August 2026). Normative promotion of `spec/notes/dictionary-cse-plan.md`, which this document supersedes (§12). Decisions fixed by James 2026-08-05: the sharing rule is a **pinned, normative emitted shape**, not an emitter liberty; placement is **module-level**, with the recursive case bound by a self-reference inside a closure body; sharing is **per module** — program-level deduplication is rejected (§10.1). Authored against the post-#271 baseline (PR #272, merged as `43f2625`); every emitted shape cited as current was probed on that commit.
**Scope:** where constructed constraint evidence is materialized in emitted JavaScript: module-level sharing of ground evidence applications, the factory-local fixpoint for self-referential instances, the canonical key, naming, emission order, and cross-module policy.
**Not in scope:** which dictionary is selected (Constraints §4–§5 own selection and coherence; nothing here touches them); the specialization set and monomorphic erasure (`ffi-zero-cost-fundamental-exports.md` §2.1, Constraints §6.1 — erasure remains the norm and this document governs only evidence that survives it); the public evidence surface (FFI Part 9 owns handles, factories, and `Dictionary<a>` faces); structural (`derives`-shaped) evidence at use sites (§9.1 defers it with evidence).
**Companions:** Constraints §5 (coherence — the premise, §6.1), §6.1 (dictionary shapes), §6.3 (evaluation-freeness — the license, and the target of this document's one edit note, §12); Functions §8 (generalization; why no dictionary reappears after erasure); FFI Part 9 §6/§13 (evidence ordering; home modules); issues #271 (the miscompilation fixed beneath this ruling), #274 (recursive `derives`, which wants §3.2's shape).

---

## 1. Doctrine

**Within one emitted module, semantically identical ground evidence is materialized at most once, as a named module-level constant.** A use site references the binding; it never rebuilds the value.

This is a semantics-preserving change of *where* a dictionary is built, never *which* dictionary is chosen. It is pinned as a normative emitted shape for the same reason the trailing evidence suffix is (Constraints §6.1): the readable `.js` is the product surface, and `render(boxed, __hex_instance_Render_Box(__hex_instance_Render_Box(__hex_instance_Render_Int)))` — today's real shape at depth 2, duplicated verbatim at every use site — is the point at which generated output stops looking like something a person wrote.

There is no language-surface component: no syntax, no type-system change, no diagnostic, no `.d.ts` change. The observable differences are the emitted text and the number of objects allocated at runtime.

## 2. The baseline this rules on

All of the following are current emitted shapes, probed on `43f2625`:

1. **Zero-argument instances are already named module-level constants** (`__hex_instance_Eq_Point`), including derived ones. Nothing changes for them; the rule restates their placement.
2. **Parameterized instances are factories** applied at use sites: `__hex_instance_Render_Box(__hex_instance_Render_Int)`. Applications appear inline, duplicated per use site, at every depth.
3. **A recursive instance re-applies its own factory per recursive call**: `Show<Tree(a)>`'s body emits `show(left, __hex_instance_Show_Tree(__hex_dictShow_N))` — one dictionary allocation per node visited, per traversal. (Before #271 this case did not run at all; the planning note's §3.2 feared the allocation and found the miscompilation.)
4. **Mutually recursive instances construct each other's evidence per call**, inside factory bodies, from their own parameters. Correct, allocating, verified running.

## 3. The rule, in three parts

### 3.1 Ground applications hoist to module level

Every distinct ground evidence tree — an instance application whose leaves are named instances or primitive dictionaries, with **no free evidence parameter** — becomes one module-level `const` in the `__hex_instance_*` family, emitted once, referenced by name at every use site:

```js
const __hex_instance_Render_Box_Int = __hex_instance_Render_Box(__hex_instance_Render_Int);
const __hex_instance_Render_Box_Box_Int = __hex_instance_Render_Box(__hex_instance_Render_Box_Int);
// ...
const one = render(boxed, __hex_instance_Render_Box_Box_Int);
const two = render(boxed, __hex_instance_Render_Box_Box_Int);
```

A nested application's argument subtrees are themselves hoisted bindings (as above), so every hoisted initializer is a single application of a factory to names.

### 3.2 Self-evidence is the instance record under construction

Inside a parameterized instance's factory body, evidence for **this same instance at the factory's own parameters** is the local instance record being defined — not a fresh application:

```js
const __hex_instance_Show_Tree = __hex_dictShow_N => {
  const __hex_instance0 = { show: tree => {
    /* ... */ show(left, __hex_instance0) /* ... */
  } };
  return __hex_instance0;
};
```

This is the ruling's letrec: a self-reference that is legal precisely because it sits **inside a member's closure body** and is therefore never evaluated during the factory's application. It is strictly better than sharing a hoisted application: a recursive traversal allocates **zero** additional dictionaries, not one shared one, and the shape is available even when the instantiation is not ground (any caller's `__hex_dictShow_N`).

The replacement is total for self-evidence: within an instance body, a demand for this instance's own constraint at its own type is always at the factory's exact parameters, because a demand at any other instantiation is polymorphic recursion, which the checker forecloses structurally (§6.2). Issue #274's fix (recursive parameterized `derives` currently overflows the emitter) wants exactly this shape and should cite this section.

### 3.3 Cross-instance evidence inside factory bodies stays call-time

Inside a factory body, evidence for a **different** instance applied to the factory's parameters (`Show<Forest(a)>`'s body needing `Show<Tree2(a)>`) is not hoistable: module level cannot name the factory's parameter, and hoisting it factory-locally — evaluating the other factory at this factory's application — diverges the moment the recursion is mutual (§10.3). It remains constructed at the call, exactly as today.

This is the rule's one allocation residue, and it is bounded: it arises only inside parameterized instance bodies referencing *other* parameterized instances over the same variable, mutual recursion being the canonical case. Self-recursion — the common case — is fully covered by §3.2. The residue is recorded, not scheduled; a future ruling may close it with lazy slots if a real program ever pays for it.

## 4. The canonical key

Two evidence constructions are "semantically identical" (§1) exactly when their evidence trees are equal: same selected instance at the root and, recursively, equal argument trees per evidence argument. The compiler's evidence representation (`Core.Evidence`) is a small ground algebraic tree — instance references carry the dictionary's name and their argument evidence; primitive evidence carries the primitive's name — so the key is the tree serialized, and equality is structural. No unification, no type comparison, and no search participates: selection already happened (Constraints §5.4 made it a table lookup), and the key is computed from its result.

Evidence containing a free dictionary parameter (`Core`'s `Dictionary` kind) is not ground and never hoists (§3.3); error evidence never hoists. Structural evidence is out of scope (§9.1).

## 5. Naming and emission order

**Naming.** A hoisted binding's name is derived deterministically from its evidence tree, in the `__hex_instance_*` family — representative scheme: the factory's name followed by the flattened spelling of its argument instances (`__hex_instance_Render_Box_Int`), disambiguated by the emitter's existing fresh-name discipline on collision. The determinism is normative (same module, same names, every compile); the exact spelling is representative, per the Part 9 precedent (specifier layout representative, qualification pattern normative). The families themselves are pinned: no new prefix is introduced (planning-note non-goal, kept).

**Order.** Hoisted bindings are emitted in dependency order after the factories and zero-argument instances they reference. Dependency order always exists and is acyclic **by construction**: a hoisted binding's initializer references only factory names and its own proper evidence subtrees, and a tree is strictly larger than its subterms — so the ground layer is a DAG regardless of how instances recurse. The letrec never appears at module level (this corrects the planning note's §4.3 sketch, which imagined a module-level self-referential binding; §12). Consequently the temporal-dead-zone hazard the note's §4.4 called the hardest part of the change does not exist in the decomposition ruled here: every module-level initializer evaluates references to bindings already initialized, and the only self-reference in the system sits under a closure body (§3.2).

## 6. Soundness

### 6.1 Coherence licenses the sharing

Recorded first because everything else sits on it. Constraints §5.1 fixes at most one instance per (constraint, type constructor) program-wide; §5.2 admits no local and no overlapping instances, so no scope exists in which one use site could lawfully see different evidence than another. That — and only that — is why two occurrences of the same evidence tree denote the same value and may be replaced by one reference to one binding. Constraints §6.3 makes instance construction evaluation-free (a record of lambdas evaluates nothing), which is why *when* the record is built — once at module load rather than per use — is unobservable. Under Scala-style implicits or ML functors the same rewrite is unsound, not merely different.

### 6.2 The evidence family is finite

Hexagon bans polymorphic recursion structurally: the checker installs provisional monotypes for a strongly-connected component's members before any body is checked, so a recursive occurrence sees a monotype and cannot be instantiated at a second type — and a polymorphic annotation does not reopen the door (a recursive body demanding a different instantiation reports "`a` is a declared type variable, but the body requires `Vector(…)`"; probed). A module's demanded ground evidence trees are therefore a finite set, every one hoistable. Under polymorphic recursion the family `Show<Tree(a)>`, `Show<Tree(Tree(a))>`, … is infinite and constructed at runtime; §3.1 could not terminate and §3.2's totality claim would be false.

### 6.3 The remaining restrictions

No higher-kinded types: evidence is a ground first-order tree, which is what makes §4's key a serialization rather than a normalization. No currying: a factory is an n-ary function, so a hoisted application is a textual lift, not an unpicked closure chain.

## 7. Sharing is per module

Each module materializes its own hoisted bindings. Two modules demanding `Show<Tree(Int)>` each hold one binding; the duplicate constants are semantically identical by coherence (§6.1) and cost a few small records per module, built once at load — matching the emitter's standing choice to inline the persistent-collections runtime per module rather than couple modules to a shared artifact.

**Dictionary identity is unspecified across modules and unobservable within Hexagon.** Dictionaries are unnameable in source (Constraints §6.4), so no Hexagon program can compare them; a JavaScript consumer observing `===` across module boundaries is reading an accident, not a contract. Within one module the rule of §3.1 makes same-tree evidence reference-identical as a consequence, and that consequence is likewise not a contract: conformance pins the binding shapes, not identity.

## 8. The exported surface does not grow

Hoisted bindings are internal. They join the module's top-level `const` set but not its export set: FFI Part 9's public evidence closure (handles, factories, `Dictionary<a>` faces, home-module placement per its §13) is computed from the same inputs as before and is unchanged by this ruling. A hoisted application is reachable from an export only in the sense that any internal binding is — through the functions that close over it. Emitted-only-when-needed is preserved: a hoisted binding exists only because a use site demanded its tree (Constraints §6.1's materialization condition, inherited).

## 9. Deferrals and non-goals

### 9.1 Structural evidence at use sites — deferred, with evidence

Derived dictionaries for **declared** types are already named module constants (§2 item 1). But structural evidence for anonymous shapes is rebuilt inline per use site today: `(1, 2) == (1, 2)` twice in one module emits the full `({ equals: …, notEquals: … })` record twice, verbatim (probed on `43f2625`). This is the same defect class as §3.1 in a different evidence kind — its key would need a canonical *type* spelling rather than an instance-name tree, which is why it is not folded in here. Deferred to its own ruling; recorded so the boundary is a decision, not an oversight.

### 9.2 Non-goals, kept from the planning note

- Removing the evidence parameter from a genuinely polymorphic exported function — irreducible.
- Extending the specialization set beyond the enumerated fundamentals — owned by `ffi-zero-cost-fundamental-exports.md` §2.1, not to be widened as an emitter side effect.
- Any change to instance selection, coherence, or which dictionary is chosen.
- Renaming the `__hex_dict*` / `__hex_instance_*` families.

## 10. Rejected alternatives (do not re-litigate)

### 10.1 Program-level deduplication

Rejected by James, 2026-08-05, after analysis. One binding per program breaks per-module compositional emission (which applied dictionaries exist is driven by use sites, so a library module's emitted text would change when a distant consumer adds one — the same instability class as `hex.d.ts`'s `commonRoot` path, made worse by landing in runtime code); it can force import edges between instance home modules that source never had, against acyclicity (Modules §8); it makes cross-module dictionary `===` observable and therefore de-facto ABI at the JS boundary; and it needs a home-module doctrine extension to FFI Part 9 §13 for trees spanning modules. What it buys is the removal of a few duplicated small records per module. Within-module deduplication — where all the readability and allocation cost actually accrues — is the rule (§1).

### 10.2 Dominance-scoped placement

Bind each shared tree at the innermost dominator of its use sites (proposed by Sol against the planning note). Sound, and strictly weaker: dominance is the right bound when a repeated expression may read mutable state, and evidence reads none (Constraints §6.3), so the bound is the module. It cannot express §3.2's fixpoint, leaving the recursive case allocating per call, and "dominance scope" exists nowhere else in the corpus or compiler. Declined with the placement decision (James, 2026-08-05).

### 10.3 Eager factory-local hoisting of cross-instance evidence

Hoisting `Show<Tree2(a)>`'s construction to a factory-local `const` of `Show<Forest(a)>`'s factory evaluates the other factory at application time; when the recursion is mutual, each application eagerly applies the other and diverges before any member is called. The current call-time shape is the correct one for v1 (§3.3). Any future closure of the residue must be lazy by construction.

### 10.4 The planning note's module-level letrec

The note's §4.3 sketched the recursive case as a module-level binding whose initializer mentions its own name inside a closure. Superseded: a factory is shared by every instantiation, so its body cannot name any one instantiation's binding — the self-reference belongs to the factory-local instance record (§3.2), and the module level stays a DAG (§5). Recorded because the note's sketch reads plausibly and rebuilding it would reintroduce §4.4's TDZ analysis for nothing.

## 11. Conformance obligations

1. **Sharing:** a module demanding the same ground tree at two use sites emits one binding and two references; the inline-application shape (`render(x, __hex_instance_Render_Box(…))`) does not appear. Depth ≥ 2 covered explicitly.
2. **Fixpoint:** a recursive instance's emitted factory contains the self-reference of §3.2 and no application of its own factory name; a traversal of an N-node structure allocates no dictionary in the loop (behavioral pin, `runMain`).
3. **Mutual recursion:** the §3.3 residue shape compiles and runs (the existing baseline behavior, now pinned so the fixpoint change cannot silently regress it).
4. **Determinism:** two compiles of one module yield identical hoisted names and order.
5. **No export growth:** the hoisted bindings appear in no export list and no `.d.ts`.

Blast radius, budgeted rather than met mid-change: output-pinning tests churn broadly by construction — the parameterized-honor shapes in `emitter.test.ts` and any conformance pin carrying an inline application must move to the hoisted shapes in the same commit that changes the emitter, and the churn degrades the corpus's regression value for the duration (planning note §8, confirmed). The `instance-evidence-threading` behavioral tests survive unchanged.

## 12. Supersession and edit notes

`spec/notes/dictionary-cse-plan.md` is superseded by this document: its §6 confirmation list is discharged (items 1–4 verified 2026-08-05 — item 1 by finding and fixing #271 under it; item 5 answered by §8), its §4.3/§4.4 mechanism is corrected by §3.2/§5/§10.4, and its non-goals are carried in §9.2. The note keeps its Status line plus a pointer here and is not edited further.

**Edit note → Constraints §6.3** (apply on next touch of `constraints.md`): the sentence "composition happens at use sites, not declaration sites" predates this ruling; composition is now *demanded* at use sites and *materialized* once per module (Dictionary Sharing §3.1). The order-independence claim it supports is unaffected.

**Edit note → FFI Part 9 §13** (apply on next touch): add a cross-reference that internal hoisted applications (Dictionary Sharing §3.1) are not part of the public evidence closure and carry no home-module obligation.
