# Planning note: Package Constraint Interfaces (speculative draft)

**Status:** **Non-normative planning note.** Drafted by Sol in September 2026 as a speculative closure document and demoted here unratified: it decides nothing. The package design it anticipated is `packages.md` (#829), whose stage one ships packages as source and needs none of the machinery below; this note is the **seed for stage two** — compiled distribution with a generated interface — which `packages.md` §5.2 records and does not design. Where this note and `packages.md` or `modules.md` disagree, those specs govern. Its `Show(a)` notation is not Hexagon's (`Show<a>`), and its implementation handoff names the wrong seat; both are left as drafted. The original text follows unchanged.

---

**Original status line:** Decided (September 2026). Cross-cutting closure document, authoritative until consolidated into `modules.md`, `constraints.md`, and the eventual package-system specification per README authority rule 3. This ruling closes only the constraint-coherence portion of Modules §12.1; package syntax and resolution remain open.
**Scope:** separately compiled native Hexagon modules; compiler-inferred coherence interfaces; declaration and instance identity across package boundaries; per-module activation; evidence-provider linkage; final-program coherence checking; source/interface equivalence; compatibility events, diagnostics, and conformance obligations.
**Not in scope:** manifest syntax, package names, registries, version-selection policy, lockfile representation, bare-specifier spelling, package entry-point or re-export syntax, the physical interface-file format or extension, artifact signing, JavaScript-only packages, or any new source-level constraint syntax.
**Companions:** Modules §2, §3, §7, §11, §12.1–§12.2; Constraints §4.3, §5, §6; FFI Part 9 §§3–4, §11; the eventual package-system specification.

---

## 1. The ruling

> **A native Hexagon package need not distribute source, but separately compiled modules must distribute a compiler-produced semantic interface sufficient to reproduce whole-program `honor` selection.** JavaScript and `.d.ts` output alone are not a native Hexagon package interface.
>
> **The interface is inferred.** `honor` remains the only source declaration of an instance. There is no `export honor`, `import honor`, `provides`, `requires`, instance manifest, or other author-written duplicate of facts the checker already knows.
>
> **The unit is a module, not a package-wide bag.** Importing one module activates that module's semantic dependency closure and no unrelated module in the same package. Merely declaring, resolving, downloading, or locking a package activates no instance.
>
> **Final-program coherence remains closed-world.** The compiler/linker combines the inferred interfaces of the activated module graph, checks at most one instance for each `(constraint declaration, type-constructor declaration)` pair, verifies every recorded evidence selection, and only then emits or links the program.
>
> **Interfaces are semantic caches for source.** Replacing a compiled module by its source and recompiling must preserve the selected instances and coherence diagnostics. Optimization may erase runtime dictionaries but never their semantic interface records.

Package boundaries therefore transport modules; they do not create a second instance-visibility regime. The package design submits to the existing `honor` semantics rather than reinterpreting them as Scala-style imported candidates or Cargo-style independently trusted implementation sets.

---

## 2. No new user syntax

The author writes the existing declaration once:

```hex
honor<a: Show> Show<Box(a)> =
    show(box) = ...
```

The compiler infers the corresponding provider rule:

```text
forall a. Show(a) => Show(Box(a))
evidence factory = <compiler-owned symbol>
```

An exported generic function already publishes its evidence requirement in its ordinary Hexagon type:

```hex
export let render<a: Show>(value: a): String = show(value)
```

No package-level `requires Show<a>` line repeats it. A concrete call compiled against `Show<Customer>` has already selected one provider; the module interface records that **selection** as a use edge rather than asking a later linker to choose among candidates. A parameterized instance records its binder obligations (`Show(a)` above) as part of its provider rule. These are the only three cases:

1. exported polymorphic requirements remain in exported function schemes;
2. parameterized-provider prerequisites remain in the inferred provider rule;
3. concrete evidence uses record the provider selected during checking.

Generated interfaces are not source and are never hand-authored. Diagnostics must direct the user to an `honor`, import, declaration, dependency, or package-version decision — never to editing generated metadata.

---

## 3. Logical interface contents

The physical encoding and filename are deliberately unspecified. Logically, each separately compiled module carries two faces which may share one artifact:

### 3.1 Public type face

The existing module interface information:

- exported term schemes, including declared constraint binders;
- exported nominal types, constraints, constructors, and opacity;
- declaration provenance and the dictionary ABI version required by FFI Part 9 §11.

### 3.2 Link/coherence face

Compiler-only metadata:

- the module's semantic identity and interface fingerprint;
- semantic dependencies on other modules;
- identities and provenance for every constraint declaration and nominal type constructor mentioned by the remaining entries;
- every local `honor` provider, with its normalized head, parameter binders, prerequisite constraints, and evidence handle or factory linkage;
- every concrete evidence selection made by typed Core, including the selected provider identity;
- enough source-origin metadata to diagnose a conflict in source terms when available.

The coherence face is not an export surface. Recording a private declaration or compiler-owned evidence symbol does not make it nameable from Hexagon or JavaScript. It gives the linker identity and consistency facts, not user access.

An implementation may omit a private provider whose type and constraint cannot escape its compiled closure and whose evidence is entirely internal, but only after proving that omission cannot affect final-program coherence, evidence verification, diagnostics, or source/interface equivalence. The required initial implementation records the complete local provider inventory; minimization is a later optimization.

---

## 4. Identity

Names do not establish cross-package identity. The package resolver supplies an opaque **resolved package identity** which distinguishes incompatible versions or sources. Within it, the compiler assigns semantic module and declaration identities. Logically:

```text
ConstraintId  = (ResolvedPackageId, ModuleId, DeclarationId)
ConstructorId = (ResolvedPackageId, ModuleId, DeclarationId)
HonorKey      = (ConstraintId, ConstructorId)
ProviderId    = (ModuleId, HonorKey)
```

The concrete representation is not fixed. The following properties are:

1. Two spellings or re-export routes to one declaration retain one identity.
2. Coincidentally same-named declarations retain distinct identities.
3. Incompatible resolved package instances cannot silently share declaration identity.
4. A compiled module records the exact dependency-interface fingerprints against which its identities and selections were checked; a mismatch requires recompilation or a hard compatibility error, never name-based repair.
5. Instance heads and selections key on declarations exactly as Constraints §5.1.1 requires, not on rendered package/module/type names.

Whether the package resolver initially permits several resolved versions of one published package is still a package-policy question. If it does, their nominal declarations and constraints are distinct, and diagnostics must expose the version/source split. A conservative first resolver may require one resolved package identity per package name; this ruling neither requires nor forbids that simplification.

---

## 5. Inference from the compiler pipeline

The interface is produced after resolution and checking, from the same typed representation that drives emission:

1. **Declarations:** serialize the stable semantic identities and public faces of referenced/exported nominal types and constraints.
2. **Providers:** collect local `honor` declarations; normalize each to its `(ConstraintId, ConstructorId)` key; preserve parameter order, prerequisite evidence, and the generated handle/factory linkage.
3. **Selections:** traverse typed Core's evidence nodes and record every concrete selected `ProviderId`, including selections whose runtime dictionary is later specialized, inlined, shared, or erased.
4. **Generic boundaries:** retain declared constraint binders on exported schemes and provider prerequisites; do not turn them into premature concrete selections.
5. **Dependencies:** preserve every source import edge, including an explicitly imported module whose alias is unused, because Modules §8/§11 still gives that edge load-order and top-level-effect meaning. Also record any compiler-synthesized semantic edge required by resolved companion/evidence linkage. These edges are never reconstructed later from ESM text.
6. **Fingerprint:** hash or otherwise identify the complete semantic interface so consumers cannot combine metadata checked against a different dependency face.

The compiler must not reconstruct this information from emitted JavaScript, `.d.ts`, symbol-name conventions, documentation, or package manifests. Those surfaces cannot express declaration identity, private coherence facts, or erased evidence reliably.

---

## 6. Activation and composition

Three operations remain separate:

| Operation | Effect |
|---|---|
| Declare/resolve a package dependency | makes package modules available to resolution; activates nothing |
| Import a module | adds that module and its semantic dependency closure to the program graph |
| Bind a local term alias | changes only the local term vocabulary; adds no module or evidence |

For an imported compiled module `M`, the compiler reads `M`'s interface and recursively loads its recorded semantic module dependencies. It then:

1. unions the providers in that activated closure;
2. rejects duplicate `HonorKey`s, naming both provider origins;
3. verifies that each concrete selection names the unique active provider for its key and was checked against compatible declaration/interface identities;
4. validates provider prerequisites and exported evidence conventions — a generic provider remains conditional, while each concrete recorded selection verifies the recursively selected prerequisite evidence it actually uses;
5. connects the compiler-owned ESM evidence handles/factories required by generated code.

The check occurs over the final root graph even when every dependency was checked independently. A package compiler may cache the result for a closed dependency subtree, but no cache entry outranks the final graph's identities.

### 6.1 Re-exports and facades

A future re-export may change the public route to a declaration but may not sever its provenance or semantic dependency edge. Importing a facade that exposes `Customer` must retain the original `Customer` declaration identity and bring the semantic closure needed for its lawful instances exactly as source compilation would.

A flattened list of facade names is therefore an insufficient interface. Re-export syntax remains Modules §12.2's question; whatever spelling lands must obey this rule.

### 6.2 No package-wide activation

An artifact may contain interfaces for every module in a package, but they remain independently addressable. Importing `geometry/shape` does not activate an `honor` declared only in `geometry/database`, unless the former's recorded semantic closure actually depends on the latter. Package installation, workspace membership, lockfile presence, and registry metadata likewise activate nothing.

---

## 7. Why the orphan rule composes across packages

Suppose package `A` declares constraint `C` and package `B` declares type constructor `T`.

- For `A` to declare `honor C<T>`, `A` must depend on the module/package that declares `T`.
- For `B` to declare it, `B` must depend on the module/package that declares `C`.
- An acyclic semantic dependency graph prevents both directions simultaneously.
- A third package may depend on both but cannot declare the instance because it owns neither declaration.

If both declarations share a package, that package's own compile catches duplicate providers before publication. Thus the existing two-home orphan rule plus acyclic dependencies gives one possible ownership site for a cross-package pair. The final-program check remains mandatory as validation against malformed, stale, incompatible, or incorrectly summarized artifacts.

This is the boundary between Hexagon's design and Scala-style contextual search. Hexagon has no imported candidate set, ranking, local instance, or shadowing rule: the interface transports one globally coherent provider table and verifies prior selections against it.

---

## 8. Runtime linkage and optimization

An interface provider points to the evidence representation FFI Part 9 already defines:

- a ground instance uses a stable module-level evidence handle when it must cross the compiled boundary;
- a parameterized instance uses a factory with the canonical prerequisite-evidence argument order;
- exported generic functions use their canonical trailing evidence suffix;
- fundamental specializations may remain dictionary-free.

The surface may be a compiler-owned ESM export/import not present as an ordinary Hexagon binding. Its exact emitted name follows the existing dictionary ABI and collision rules; the interface records the mapping rather than asking consumers to derive it from strings.

Optimization is representation-only. Inlining a member, specializing a call, constant-folding it, sharing dictionaries, or erasing a known-concrete dictionary does not remove the provider or selection from the coherence face. Optimized and unoptimized builds must accept and reject the same activated graphs.

JavaScript-only packages carry no native coherence interface and cannot declare or provide Hexagon `honor` instances. They enter through `extern`/FFI. A package advertised as compiled native Hexagon but missing a compatible semantic interface is rejected before type checking or linking; `.d.ts` is not a fallback.

---

## 9. Compatibility events

The eventual package-version policy owns which version increment each event demands. The interface must nevertheless expose these semantic changes so tooling can classify them. Potentially source- or ABI-breaking events include:

- removing an active provider;
- adding an active provider (although the orphan rule prevents a same-key downstream provider, a new honored constraint can introduce a same-spelled dot-member ambiguity or otherwise expand resolution);
- changing an instance head, parameter order, or prerequisite constraints;
- moving a provider between its two legal homes;
- changing the identity of a referenced constraint or type constructor;
- changing a module's semantic dependency closure so different providers activate;
- changing an evidence handle/factory, suffix ordering, base-constraint layout, dictionary ABI version, or provider symbol;
- making a re-export gain or lose the original declaration's semantic closure.

At minimum, interface fingerprints make every such change observable and prevent stale dependents from linking silently. A future compatibility checker may prove a narrower event additive; absence of that proof is never permission to reuse incompatible metadata.

---

## 10. Diagnostics

Required diagnostic families:

| Situation | Required report |
|---|---|
| Duplicate cross-package `HonorKey` | name the constraint and type in source vocabulary, both package/module origins, and both declaration locations where metadata carries them |
| Recorded selection's provider absent | name the consuming package/module, required `C<T>`, and the provider identity/version it was compiled against; require compatible dependency resolution or recompilation |
| Provider present under incompatible declaration identities | expose the package/version/source split; never compare names as repair |
| Interface fingerprint mismatch | name the consuming and changed dependency modules and require recompilation; do not continue with stale selections |
| Dictionary ABI mismatch | FFI Part 9 §11's report naming both packages and ABI versions |
| Native Hexagon dependency has JS/`.d.ts` but no coherence interface | "compiled Hexagon package `<name>` has no compatible semantic interface; install a Hexagon package artifact or bind the JavaScript package through `extern`" |
| Package is resolved but its module is not imported | no instance activation and no diagnostic merely for being installed |
| User attempts future metadata-like source syntax | retain the existing language surface: `honor` declares an instance; generated package metadata is not source syntax |

---

## 11. Conformance obligations

Before separately compiled native packages ship, tests must demonstrate:

1. **Source/interface equivalence:** compile the same dependency from source and from its inferred interface; compare selected provider identities, success/failure, and observable results.
2. **Ground provider:** a package-owned `honor Ord<Customer>` is selected by a separately compiled consumer and linked to the recorded handle.
3. **Parameterized provider:** `honor<a: Show> Show<Box(a)>` crosses the boundary as a factory with the canonical prerequisite order.
4. **Generic export:** an exported `<a: Show>` function remains evidence-polymorphic and gains no package-level handwritten requirement.
5. **Concrete selection:** a compiled concrete call records and verifies its selected provider.
6. **Erasure invariance:** dictionary-free specialization still records the semantic selection and rejects an incompatible graph exactly as an unoptimized build does.
7. **Per-module activation:** importing one package module does not activate an unrelated module's provider.
8. **Manifest non-activation:** resolving/installing a package without importing its module changes no honor table.
9. **Orphan ownership:** the legal constraint-home and type-home package arrangements compile; a third integration package is refused.
10. **Forged/stale duplicate:** final linking rejects duplicate provider metadata even if each artifact claims prior successful compilation.
11. **Re-export provenance:** a facade preserves the original declaration identity and semantic closure once re-exports exist.
12. **Version/source split:** incompatible resolved package identities never unify by spelling and produce an origin-rich diagnostic.
13. **ABI mismatch:** incompatible dictionary ABI versions fail before generated evidence calls execute.
14. **No-interface refusal:** plain JS plus `.d.ts` cannot masquerade as a native Hexagon dependency.
15. **Incremental invalidation:** changing a provider, prerequisite, declaration identity, dependency closure, or interface fingerprint invalidates every compiled consumer whose recorded selections or faces depend on it.

These are release gates, not aspirational examples. Source-only packages may ship earlier by continuing to compile the complete source graph; separately compiled native packages may not.

---

## 12. Implementation handoff

Fable should treat this as a vertical compiler/package slice, in this order:

1. Define internal `ResolvedPackageId`, `ModuleId`, `ConstraintId`, `ConstructorId`, `HonorKey`, and `ProviderId` representations without exposing their physical serialization as language syntax.
2. Define a versioned logical module-interface schema containing §3's two faces and the FFI Part 9 dictionary ABI version.
3. Emit provider and concrete-selection records from resolved/typed/Core identities, never names alone.
4. Read dependency interfaces into resolution/checking so ordinary constraint solving sees their declarations and provider rules exactly as source declarations.
5. Build the activated per-module semantic closure and perform §6's final union, duplicate, fingerprint, prerequisite, and selection checks.
6. Connect provider records to emitted evidence handles/factories under the existing dictionary ABI.
7. Make optimizer passes preserve semantic provider/selection metadata even when evidence code erases.
8. Add §10 diagnostics and §11 acceptance tests, including source/interface differential tests.
9. Only then allow a package resolver to classify an artifact as separately compiled native Hexagon.

The implementation may begin with an in-memory or JSON test schema. No file extension, registry layout, or manifest spelling should be committed merely to exercise the semantic core.

---

## 13. Decisions log

| Decision | Where |
|---|---|
| No source distribution requirement; compiled native modules require a semantic coherence interface | §1 |
| No new user syntax; `honor` and exported schemes are the sole source facts | §2 |
| Logical public-type and link/coherence faces; initial implementation records complete local providers | §3 |
| Instance and selection identity keys on resolved declaration identity, never names | §4 |
| Interface inferred after checking from declarations, `honor` items, and typed Core evidence nodes | §5 |
| Dependency availability activates nothing; module import activates only its semantic dependency closure | §6 |
| Re-exports preserve provenance; package-wide flattening/activation forbidden | §6.1–§6.2 |
| Existing two-home orphan rule composes through an acyclic dependency graph; final validation still mandatory | §7 |
| Evidence linkage follows FFI Part 9; optimization never erases coherence metadata; plain JS is FFI-only | §8 |
| Semantic compatibility events must be observable through versioned interfaces and fingerprints | §9 |
| Diagnostics and fifteen conformance gates fixed before separately compiled native packages ship | §10–§11 |
| Fable implementation order begins with identities/schema and may avoid premature package/file syntax | §12 |
