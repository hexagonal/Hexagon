# Hexagon Dictionary Sharing: Module-Level Evidence Materialization

**Status:** Decided (August 2026). Normative promotion of `spec/notes/dictionary-cse-plan.md`, which this document supersedes (§12). The sharing rule is a **pinned, normative emitted shape**, not an emitter liberty; placement is **module-level**, with recursion bound by a self-reference inside a closure body; sharing is **per module** (§10.1 records the rejected alternative).
**Scope:** where constructed constraint evidence is materialized in emitted JavaScript: module-level sharing of ground evidence applications, the factory-local fixpoint for self-referential instances, the canonical key, naming, emission order, and cross-module policy.
**Not in scope:** which dictionary is selected (Constraints §4–§5 own selection and coherence; nothing here touches them); the specialization set and monomorphic erasure (`ffi-zero-cost-fundamental-exports.md` §2.1 and Constraints §6.1 own them — this document governs evidence as it reaches emission, whatever erasure has removed); the public evidence surface (FFI Part 9 owns handles, factories, and `Dictionary<a>` faces); structural evidence for anonymous shapes at use sites (§9.1 defers the sharing question and rules the literal-member spelling; #425).
**Companions:** Constraints §5 (coherence — the premise, §6.1), §6.1 (dictionary shapes), §6.3 (evaluation-freeness — the license, and the target of this document's one edit note, §12); Functions §8 (generalization; why no dictionary reappears after erasure); FFI Part 9 §6/§13 (evidence ordering; home modules); issues #271 (the miscompilation fixed beneath this ruling), #274 (recursive `derives`, which wants §3.2's shape).

---

## 1. Doctrine

**Within one emitted module, semantically identical ground evidence is materialized at most once, as a named module-level constant.** A use site references the binding; it never rebuilds the value.

This is a semantics-preserving change of *where* a dictionary is built, never *which* dictionary is chosen. It is pinned as a normative emitted shape for the same reason the trailing evidence suffix is (Constraints §6.1): the readable `.js` is the product surface, and `render(boxed, __Render_Box(__Render_Box(__Render_Int)))` — the unhoisted shape at depth 2 (§2's baseline, transcribed into #425's spellings), duplicated verbatim at every use site — is the point at which generated output stops looking like something a person wrote.

There is no language-surface component: no syntax, no type-system change, no diagnostic, no `.d.ts` change. The observable differences are the emitted text and the number of objects allocated at runtime.

## 2. The baseline this rules on

The emitted shapes this ruling starts from — measured under the pre-#425 `__hex_` names and transcribed here into the current spellings (§5), the evidence-parameter scheme included:

1. **Zero-argument instances are already named module-level constants** (`__Eq_Point`), including derived ones. Nothing changes for them; the rule restates their placement.
2. **Parameterized instances are factories** applied at use sites: `__Render_Box(__Render_Int)`. Applications appear inline, duplicated per use site, at every depth.
3. **A recursive instance re-applies its own factory per recursive call**: `Show<Tree(a)>`'s body emits `show(left, __Show_Tree(__Show_a))` — one dictionary allocation per node visited, per traversal.
4. **Mutually recursive instances construct each other's evidence per call**, inside factory bodies, from their own parameters. Correct, allocating.

## 3. The rule, in three parts

### 3.1 Ground applications hoist to module level

Every distinct ground evidence tree — an instance application whose leaves are named instances or primitive dictionaries, with **no free evidence parameter** — becomes one module-level `const` in the dictionary family (§5), emitted once, referenced by name at every use site:

```js
const __Render_Box_Int = __Render_Box(__Render_Int);
const __Render_Box_Box_Int = __Render_Box(__Render_Box_Int);
// ...
const one = render(boxed, __Render_Box_Box_Int);
const two = render(boxed, __Render_Box_Box_Int);
```

A nested application's argument subtrees are themselves hoisted bindings (as above), so every hoisted initializer is a single application of a factory to names.

### 3.2 Self-evidence is the instance record under construction

Inside a parameterized instance's factory body, evidence for **this same instance at the factory's own parameters** is the local instance record being defined — not a fresh application:

```js
const __Show_Tree = __Show_a => {
  const __instance0 = { show: tree => {
    /* ... */ show(left, __instance0) /* ... */
  } };
  return __instance0;
};
```

This is the ruling's letrec: a self-reference that is legal precisely because it sits **inside a member's closure body** and is therefore never evaluated during the factory's application. It is strictly better than sharing a hoisted application: a recursive traversal allocates **zero** additional dictionaries, not one shared one, and the shape is available even when the instantiation is not ground (any caller's `__Show_a`).

The replacement covers exactly the demands whose evidence is the factory's **identity arrangement** — this instance's dictionary applied to the factory's own parameters, in order. For a regular recursive type, that is every self-demand. It is not total in general: a non-regular union (`union Weird(a) = End | W(inner: Weird(Box(a)))` — legal, Unions §2 places no regularity restriction on payload recursion) yields a body whose self-demand is at `Weird(Box(a))`; that evidence applies this factory to constructed argument evidence, is not ground, and remains a call-time application (§3.3). The polymorphic-recursion ban (§6.2) does not reach it: the demand rides the generalized constraint member, which every call instantiates fresh, not a recursive function occurrence. Issue #274's fix (recursive parameterized `derives` currently overflows the emitter) wants exactly the identity-arrangement shape and should cite this section.

### 3.3 Non-identity evidence inside factory bodies stays call-time

Inside a factory body, evidence over the factory's parameters at anything other than the identity arrangement is not hoistable: module level cannot name the factory's parameter, and hoisting it factory-locally — evaluating a factory at this factory's application — diverges whenever the eager construction reaches this factory again: immediately for the self shapes, around the cycle when the recursion is mutual (§10.3). It remains constructed at the call, exactly as today. Three shapes fall here: a **different** instance over the parameters (`Show<Forest(a)>`'s body needing `Show<Tree2(a)>` — mutual recursion); **this** instance at a deeper instantiation (`Describe<Weird(a)>`'s body needing `Describe<Weird(Box(a))>` — non-regular recursion, §3.2); and **this** instance at a permuted arrangement (`Swap(a, b)` recursing through `Swap(b, a)`, whose self-demand is the factory over its own parameters reversed — §3.2's "in order" clause is what excludes it from the replacement). The shapes compose — a self-demand may be deeper and permuted at once (`Twist(a, b)` recursing through `Twist(Box(b), a)`); the identity-arrangement test, not this list, is the classifier.

This is the rule's one allocation residue, and it is bounded: it arises only inside parameterized instance bodies, and regular self-recursion — the common case — is fully covered by §3.2. The residue is recorded, not scheduled; a future ruling may close it with lazy slots if a real program ever pays for it.

## 4. The canonical key

Two evidence constructions are "semantically identical" (§1) exactly when their evidence trees are equal: same selected instance at the root and, recursively, equal argument trees per evidence argument. The compiler's evidence representation (`Core.Evidence`) is a small ground algebraic tree — instance references carry the dictionary's name and their argument evidence; primitive evidence carries the primitive's name — so the key is the tree serialized, and equality is structural. No unification, no type comparison, and no search participates: selection already happened (Constraints §5.4 made it a table lookup), and the key is computed from its result.

Evidence containing a free dictionary parameter (`Core`'s `Dictionary` kind) is not ground and never hoists (§3.3); error evidence never hoists. Structural evidence is out of scope (§9.1).

## 5. Naming and emission order

**Naming.** A hoisted binding's name is derived deterministically from its evidence tree, in the dictionary family `__<Constraint>_<Subject>` — representative scheme: the factory's name followed by the flattened spelling of its argument instances (`__Render_Box_Int`). Evidence parameters spell the constraint and the source type variable (`__Show_a`). The determinism is normative (same module, same names, every compile); the exact spelling is representative, per the Part 9 precedent (specifier layout representative, qualification pattern normative). The family sits directly under Lexer §3.2's reserved `__` prefix, like every generated name — one prefix, no second family (#425; §9.2 records the reversal of the planning note's renaming non-goal).

**Collisions.** When more than one dictionary in a module contests one spelling — flattening is not injective (underscores are legal in constraint and type-constructor names), and an imported dictionary's interface name can match a local one — **all** contestants take numeric suffixes, `_1` upward, and none keeps the bare spelling *(replaces the occupant-keeps probe this section previously cited; #425)*. Among module-scope bindings and their references, a bare dictionary name therefore certifies its spelling is uncontested and a suffixed one marks a collision (§8's export clause may still carry a bare spelling over a suffixed local). Suffixes are assigned in a canonical order over the contestants — declared instances in declaration order, then hoisted bindings in this section's emission order, then imports in specifier order — so the assignment is as deterministic as the names themselves. The discipline — aliasing only on collision, every contestant suffixed, none bare — is normative like the determinism; the suffix spellings are representative with the rest of the scheme. Lexer §3.2's probe is unchanged for the occupancy no rename can resolve — a foreign name: it keeps its spelling and the dictionary family numbers around it, the same rule — rename everything renameable, never the thing that is not.

**Imported names.** A consumer binds an imported dictionary under the exporter's interface name read from the resolved interface, unaliased, whenever that spelling is uncontested in the consumer; a contest falls under the collision rule above. Aliasing is therefore collision-only — the unconditional per-file alias prefix is gone, and a re-export chain re-binds the exporter's interface name at each hop (renamed at a hop only when a declared instance or another transit copy contests it there — the transit copy then carries its §5 suffix at the interface; an internal-only contest renames the local binding, not the interface — §8), so transit names no longer compound *(the dead-code-elimination plan's §2 measured the compounding; #425)*.

**Order.** Hoisted bindings are emitted in dependency order after the factories and zero-argument instances they reference. Dependency order always exists and is acyclic **by construction**: a hoisted binding's initializer references only factory names and its own proper evidence subtrees, and a tree is strictly larger than its subterms — so the ground layer is a DAG regardless of how instances recurse. The letrec never appears at module level (this corrects the planning note's §4.3 sketch, which imagined a module-level self-referential binding; §12). Consequently the temporal-dead-zone hazard the note's §4.4 called the hardest part of the change does not exist in the decomposition ruled here: every module-level initializer evaluates references to bindings already initialized, and the only self-reference in the system sits under a closure body (§3.2).

## 6. Soundness

### 6.1 Coherence licenses the sharing

Recorded first because everything else sits on it. Constraints §5.1 fixes at most one instance per (constraint, type constructor) program-wide; §5.2 admits no local and no overlapping instances, so no scope exists in which one use site could lawfully see different evidence than another. That — and only that — is why two occurrences of the same evidence tree denote the same value and may be replaced by one reference to one binding. Constraints §6.3 makes instance construction evaluation-free (a record of lambdas evaluates nothing), which is why *when* the record is built — once at module load rather than per use — is unobservable. Under Scala-style implicits or ML functors the same rewrite is unsound, not merely different.

### 6.2 The hoistable family is finite — syntactically

Hoisting is keyed on ground evidence trees (§4), and a module has finitely many use sites, each demanding a fixed, finite set of static trees — so the set of hoisted bindings is finite by construction, independent of how types recurse. The polymorphic-recursion ban buys something narrower and function-shaped: the checker installs provisional monotypes for a strongly-connected component's members before any body is checked, so a recursive **function** occurrence sees a monotype and cannot demand new instantiations — and a polymorphic annotation does not reopen that door (a recursive body demanding a different instantiation reports "`a` is a declared type variable, but the body requires `Vector(…)`"). The ban does not reach demands riding a generalized constraint member: an unbounded *dynamic* evidence family such as `Describe<Weird(a)>`, `Describe<Weird(Box(a))>`, … is legal today (§3.2's non-regular case), constructed call-by-call in the residue (§3.3), and never hoisted — which is why §3.2's identity-arrangement scope is load-bearing rather than decorative.

### 6.3 The remaining restrictions

No higher-kinded types: evidence is a ground first-order tree, which is what makes §4's key a serialization rather than a normalization. No currying: a factory is an n-ary function, so a hoisted application is a textual lift, not an unpicked closure chain.

## 7. Sharing is per module

Each module materializes its own hoisted bindings. Two modules demanding `Show<Tree(Int)>` each hold one binding; the duplicate constants are semantically identical by coherence (§6.1) and cost a few small records per module, built once at load — matching the emitter's standing choice to inline the persistent-collections runtime per module rather than couple modules to a shared artifact.

**Dictionary identity is unspecified across modules and unobservable within Hexagon.** Dictionaries are unnameable in source (Constraints §6.4), so no Hexagon program can compare them; a JavaScript consumer observing `===` across module boundaries is reading an accident, not a contract. Within one module the rule of §3.1 makes same-tree evidence reference-identical as a consequence, and that consequence is likewise not a contract: conformance pins the binding shapes, not identity.

## 8. The exported surface does not grow

Hoisted bindings are internal. They join the module's top-level `const` set but not its export set: FFI Part 9's public evidence closure (handles, factories, `Dictionary<a>` faces, home-module placement per its §13) is computed from the same inputs as before and is unchanged by this ruling. (The emitter presently exports the declared-instance dictionaries unconditionally — its own and, in transit, every imported one — as cross-module evidence plumbing, keyed on instance declarations; hoisted applications join neither that sweep nor Part 9's closure.) A hoisted application is reachable from an export only in the sense that any internal binding is — through the functions that close over it. Emitted-only-when-needed is preserved: a hoisted binding exists only because a use site demanded its tree (Constraints §6.1's materialization condition, inherited).

**Exported spellings under collision.** An instance's exported name is its bare flattened spelling; §5's collision rule renames local bindings, not the interface. When no other **declared** instance of the module contests the spelling, the export re-binds the bare spelling over the suffixed local — `export { __Eq_Rat_1 as __Eq_Rat }` — so consumers see the uncontested interface name. Internal names and transit re-exports (the plumbing sweep above re-exports every imported dictionary) never outrank a declared instance for its bare interface spelling: a transit copy carries its §5 suffix at the interface instead, so adding an unrelated import cannot rename a module's own instance out from under its consumers *(#425)*. A transit copy re-binds its incoming interface name when contested only by internal names; it carries its §5 suffix at the interface when a declared instance or another transit copy contests the spelling. Only a declared-vs-declared contest puts a **declared instance's** suffix on the interface: every such contestant's exported name is its §5-assigned suffixed name, and consumers read them from the resolved interface as with any exported name — no consumer-side prediction, per §5's imported-names rule.

## 9. Deferrals and non-goals

### 9.1 Structural evidence at use sites — deferred

Derived dictionaries for **declared** types are already named module constants (§2 item 1). But structural evidence for anonymous shapes is rebuilt inline per use site today: `(1, 2) == (1, 2)` twice in one module emits the full `({ equals: …, notEquals: … })` record twice, verbatim. This is the same defect class as §3.1 in a different evidence kind — its key would need a canonical *type* spelling rather than an instance-name tree, which is why it is not folded in here. Deferred to its own ruling; recorded so the boundary is a decision, not an oversight.

One spelling rule for these inline literals **is** ruled *(#425, item C)*: when the emitter itself builds a derived-dictionary literal and the surrounding expression immediately selects one member and applies it, the emitted spelling is the member's body with the arguments substituted — member selection out of the compiler-built literal (unobservable because construction evaluates nothing — Constraints §6.3), then beta-reduction of the immediately-applied arrow. `({ show: __value => (__value ? "True" : "False") }).show(e)` emits as `(e ? "True" : "False")` — parenthesized so the reduced expression re-enters its context as one atomic operand, a pair the body already carries or a call's own shape sufficing (no second pair is added): a bare ternary dropped into `+`-concatenation reads the string prefix as its condition, the hazard memorialized at the emitter's Bool `Show` arm. The reduction fires only when each parameter occurs exactly once in the member's body, the occurrences read in parameter order, and each occurrence sits where the body evaluates it exactly once, unconditionally, with nothing effectful evaluated ahead of it — never under a deferred lambda or in a conditionally-evaluated branch — so argument expressions are never duplicated, dropped, or reordered; and only on a compiler-built literal selected in place: a named instance is already the reduced form, and a whole record passed as trailing evidence to a polymorphic call is genuinely needed and untouched. A member that is a bare function reference rather than an arrow takes the selection alone — `({ toSeq: __seqFromIterable }).toSeq(e)` emits as `__seqFromIterable(e)`. This is a spelling rule, not an evidence change: which dictionary is chosen, and the sharing question above, are unaffected.

### 9.2 Non-goals, kept from the planning note

- Removing the evidence parameter from a genuinely polymorphic exported function — irreducible.
- Extending the specialization set beyond the enumerated fundamentals — owned by `ffi-zero-cost-fundamental-exports.md` §2.1, not to be widened as an emitter side effect.
- Any change to instance selection, coherence, or which dictionary is chosen.
- Renaming the dictionary families *(kept from the planning note; since reversed by #425, which widened Lexer §3.2's reservation to leading `__` and respelled every generated name under it — `__hex_instance_Eq_Point` → `__Eq_Point`, `__hex_dictShow_N` → `__Show_a`. The non-goal's substance stands: one prefix, no structural change to the families; the spelling is §5's business)*.

## 10. Rejected alternatives (do not re-litigate)

### 10.1 Program-level deduplication

One binding per program breaks per-module compositional emission (which applied dictionaries exist is driven by use sites, so a library module's emitted text would change when a distant consumer adds one — the same instability class as `hex.d.ts`'s `commonRoot` path, made worse by landing in runtime code); it can force import edges between instance home modules that source never had, against acyclicity (Modules §8); it makes cross-module dictionary `===` observable and therefore de-facto ABI at the JS boundary; and it needs a home-module doctrine extension to FFI Part 9 §13 for trees spanning modules. What it buys is the removal of a few duplicated small records per module. Within-module deduplication — where all the readability and allocation cost actually accrues — is the rule (§1).

### 10.2 Dominance-scoped placement

Bind each shared tree at the innermost dominator of its use sites. Sound, and strictly weaker: dominance is the right bound when a repeated expression may read mutable state, and evidence reads none (Constraints §6.3), so the bound is the module. It cannot express §3.2's fixpoint, leaving the recursive case allocating per call, and "dominance scope" exists nowhere else in the corpus or compiler.

### 10.3 Eager factory-local hoisting of §3.3 evidence

Hoisting a §3.3 construction to a factory-local `const` evaluates a factory at application time; the moment that evaluation reaches the enclosing factory again — immediately for a non-identity self-demand, around the cycle when the recursion is mutual (`Show<Forest(a)>` and `Show<Tree2(a)>` eagerly applying each other) — it diverges before any member is called. The current call-time shape is the correct one for v1 (§3.3). Any future closure of the residue must be lazy by construction.

### 10.4 The planning note's module-level letrec

The note's §4.3 sketched the recursive case as a module-level binding whose initializer mentions its own name inside a closure. Superseded: a factory is shared by every instantiation, so its body cannot name any one instantiation's binding — the self-reference belongs to the factory-local instance record (§3.2), and the module level stays a DAG (§5). Recorded because the note's sketch reads plausibly and rebuilding it would reintroduce §4.4's TDZ analysis for nothing.

## 11. Conformance obligations

1. **Sharing:** a module demanding the same ground tree at two use sites emits one binding and two references; the inline-application shape (`render(x, __Render_Box(…))`) does not appear. Depth ≥ 2 covered explicitly.
2. **Fixpoint:** a recursive instance's emitted factory contains the self-reference of §3.2 and no application of its own factory name **as self-evidence at the factory's own parameters** (textual pin — this is what makes a regular traversal allocation-free); an N-node traversal still runs correctly (behavioral, `runMain`).
3. **Residue:** the §3.3 shapes — mutual recursion and the non-identity self-demands (deeper: `Weird`; permuted: `Swap`) — compile and run (the existing baseline behavior, now pinned so the fixpoint rewrite cannot misfire on a self-demand that is not the identity arrangement).
4. **Determinism:** two compiles of one module yield identical hoisted names and order.
5. **No export growth:** the hoisted bindings appear in no export list and no `.d.ts`.
6. **Collision-only aliasing:** an uncontested import binds unaliased under the exporter's interface name; a contested spelling suffixes every contestant from `_1` with no bare survivor, a renamed exported instance re-exports its bare spelling unless another declared instance contests it (§8: declared-vs-declared contests carry suffixes to the interface; transit re-exports never outrank a declared instance), and two compiles agree on the assignment (§5, §8; #425).
7. **Literal-member reduction:** an immediately-selected-and-applied compiler-built dictionary literal emits the member body with arguments substituted, atomic in its context (parenthesized unless a body-carried pair or a call's own shape already binds it whole) — the literal shape (`({ show: … }).show(…)`) does not appear at such a site; a member whose body reads a parameter twice or not at all, and a whole record passed as trailing evidence, keep today's shapes; a bare-function-reference member takes selection alone; the reduced expression evaluates its argument expressions exactly once, in order (§9.1; #425).

Blast radius, budgeted rather than met mid-change: output-pinning tests churn broadly by construction — the parameterized-honor shapes in `emitter.test.ts` and any conformance pin carrying an inline application must move to the hoisted shapes in the same commit that changes the emitter, and the churn degrades the corpus's regression value for the duration (planning note §8, confirmed). The `instance-evidence-threading` behavioral tests survive unchanged.

## 12. Supersession and edit notes

`spec/notes/dictionary-cse-plan.md` is superseded by this document: its §6 confirmation list is discharged (#271 settled item 1; §2 item 2, §6.2, and §4 carry items 2–4's confirmations; §8 answers item 5), its §4.3/§4.4 mechanism is corrected by §3.2/§5/§10.4, and its non-goals are carried in §9.2. The note keeps its Status line plus a pointer here and is not edited further.

**Edit note → Constraints §6.3** (apply on next touch of `constraints.md`): the sentence "composition happens at use sites, not declaration sites" predates this ruling; composition is now *demanded* at use sites and *materialized* once per module (Dictionary Sharing §3.1). The order-independence claim it supports is unaffected.

**Edit note → FFI Part 9 §13** (apply on next touch): add a cross-reference that internal hoisted applications (Dictionary Sharing §3.1) are not part of the public evidence closure and carry no home-module obligation.
