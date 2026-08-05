# Hexagon Spec: The Intrinsic Door

**Status:** Decided (ruling on issue #125, 2026-07-28, Fable in the spec seat). Discharges the "narrow private intrinsic door" obligation written in `stdlib-roadmap.md` §5.2 items 2 and 6, whose words existed with nothing built behind them. **Implemented 2026-07-28** — the declaration form (§3), keys and verification (§4), the gate (§5), typing (§6), and emission (§8.3) are in the compiler, with `Seq.memoize` as the first customer (§3.2). Conformance: `compiler/src/conformance/intrinsic-door.test.ts` (the door) and `seq-memoize.test.ts` (its first customer's semantics). Two parts of this ruling are **not** implemented, because nothing yet needs them: §7's self-declaration fallback (`Seq.hex`'s own door needs no compiler-side naming of `Seq`, exactly as §6 predicted) and §9's per-companion conversions, which are bound to arcs that have not run.
**Scope:** The declaration form by which privileged standard-library source names a compiler-provided implementation of an operation it publicly owns — spelling (§3), keys and verification (§4), the gate (§5), typing (§6), the self-declaration fallback for compiler-known records (§7), companion dispatch, visibility, and emission (§8), and the binding deprecation schedule for the transitional public-name and primitive doors (§9).
**Not in scope:** Defect 12 (the exported-`Seq`-as-`Iterable` divergence) — a separate ruling, deliberately not presupposed here (§8.3). `Seq.memoize`'s implementation (ready, blocked on this ruling; §3.2 is its declaration). Foreign extern semantics — FFI Part 4 is unchanged, including its §12.4 monomorphism (§3.4). The companion-module idiom — examined and retained, not reopened (§2).
**Companions:** Modules §5.2/§5.3/§5.5 (the idiom; resolution by position; compiler resolution never outranks declarations), Method Syntax §4 (`CompanionOf`), FFI Part 4 (the `extern from` block grammar this form reuses), FFI Part 3 (the memoizing spine's semantics), Loops §6.4/§6.6, stdlib-roadmap §5 (the migration template this door serves), Declarations Preamble §1.1 (Rewrite Rule).

---

## 1. Doctrine

> **Intrinsic linkage is a declaration, not a meaning of a name.** `Name.` has exactly two positional meanings — module and constructor (Modules §5.1–§5.2) — and this ruling adds no third. The compiler-provided implementation of a companion operation enters the language the way every other externally-implemented operation does: through a bodyless, fully-typed declaration in the module that owns the operation.

The gap this closes (issue #125): `Vector.at(values, index)` inside `stdlib/Vector.hex` today means "the compiler's `at`" — a third meaning riding on whichever of the two blessed positions happens to be unbound in that file. It reads as infinite self-recursion, and it dies the moment the companion declares its own type, because the constructor then claims the name. `Seq.hex` self-declares, so `Seq` is where the bill came due — as the pilot was intended to make it.

The prior art is uniform on both halves. OCaml's `Seq` owns `type 'a t` and reaches primitives via `external length : 'a t -> int = "%seq_length"`; Haskell has `foreign import`; Rust has `extern "rust-intrinsic"`, legal only in perma-unstable standard-library source; Scala companions share their class's name and reach natives separately. **All of them spell the primitive as a declaration carrying the full type; none spells it as `Self.publicName`; and inside the owning module the operation is referred to unqualified** — qualification is a consumer affordance. This ruling brings Hexagon to the same shape with machinery it already has: the FFI Part 4 block, whose doctrine ("typed assertions about an implementation the compiler does not inspect") is exactly what an intrinsic declaration is, with one inversion — here the implementer is the compiler itself, so trust is replaced by verification (§4.2).

---

## 2. The companion idiom, examined and retained

James's instruction widened this ruling's scope: the companion-module idiom (Modules §5.2/§5.3) was reopenable, on the instinct that a design in which module, type, and constructor share a spelling "resolved by position" is what left the third meaning homeless. The instinct was examined and the idiom is **retained**, for a reason stronger than incumbency:

**Separately-spelled modules and types would not house the intrinsic either.** OCaml names its module `Seq` and its type `'a Seq.t` — no shared spelling, no resolution by position — and still needs `external`, because the intrinsic is not a *meaning of any name*; it is a *linkage* for a declared operation. Every language in the comparison set, whatever its naming regime, houses that linkage in a declaration form. Renaming Hexagon's positions would therefore pay the full price of reopening — re-rooting `Seq.hex`'s 22 green exports, churning every consumer spelling (`Seq.map`, `Vector.at`, `Int.div`), and re-founding `CompanionOf`, whose substrate Modules §5.3 explicitly makes the idiom — and buy nothing toward the gap. The narrower answer (leave the idiom, add the missing declaration form) was available, solves the whole stated problem, and is taken.

What the evidence actually indicts is narrower than the idiom: the *transitional* practice of spelling the intrinsic as the companion's own public qualified name. That practice is deprecated with a terminus (§9); the idiom's two positions are untouched.

---

## 3. The declaration form

### 3.1 The block

An intrinsic declaration appears in an `extern from` block whose specifier is the reserved string `"hex:intrinsic"`:

```hexagon
extern from "hex:intrinsic"
    export fun seqMemoize as memoize<a>(source: Seq(a)): Seq(a)
```

The block reuses FFI Part 4's grammar and rules wholesale except where §3.3–§3.4 state a delta: bodyless declarations, one per line under ordinary layout; full type annotations (nothing to infer from); the foreign-name-first `as` order (Part 4 §3.1), where the left side is the intrinsic **key** (§4) and the right side — or the sole name, when no `as` appears — is the ordinary local Hexagon binding; the per-declaration `export` modifier (Part 4 §7). After the declaration, the binding is an **ordinary module-level binding**: same typing, visibility, collision, and occlusion rules as any other. Inside the module it is referred to unqualified, matching the prior art; consumers reach it qualified through the companion idiom exactly as before.

### 3.2 Worked examples — the two live customers

`Seq.hex` gains `memoize` (the decided Loops §6.4 obligation) as the single declaration above. No wrapper, no body, nothing that reads as self-recursion; the implementation is the runtime's memoizing spine (FFI Part 3 §4–§7), and the declaration is the canonical `.hex` spelling stdlib-roadmap §5.1 requires the module to own.

`stdlib/Vector.hex` declares its seven boundary operations this way — Collections Part 3 §7's crossing set, converted from public-name-door wrappers at its §9 milestone. What was

```hexagon
export fun at<a>(values: Vector(a), index: Int): a = Vector.at(values, index)
```

is

```hexagon
extern from "hex:intrinsic"
    export fun vectorAt as at<a>(values: Vector(a), index: Int): a
```

A wrapper whose body is exactly the door call collapses to its declaration. A wrapper with Hexagon-expressible logic on top keeps that logic in ordinary source and declares the door **unexported** beneath it — the roadmap's "visible call into the narrow private boundary" (§5.1). Which shape to use is the ordinary §5.1 doctrine, not a new rule.

### 3.3 What the block admits

`fun` declarations only, in v1. `let`, `type`, `default`, `method`, `get`, `set`, `class`, and `enum` are hard errors inside a `"hex:intrinsic"` block (§11) — no current customer needs them, and the house bar for adding a form is concrete demand (Part 4 §11's own posture). Compiler-owned *types* in particular do not enter here: the four collection companions declare ordinary (`export opaque`) records, and the deliberate non-declared boundary types (`Array`, `Nullable`, `Node`) remain fallbacks per Modules §5.5.

### 3.4 Genericity — granted inside this boundary only

Intrinsic declarations may be type-parameterized (`<a>` on the local name, as in §3.1). This does **not** reopen FFI Part 4 §12.4, which defers generic *foreign* externs over a real representation question: a polymorphic contract with an untrusted foreign implementer requires a representation story for unknown instantiations. Here the implementer is the compiler, which owns the representation of every Hexagon type because it emits them; the question §12.4 defers does not arise inside the trust boundary. Foreign extern declarations remain monomorphic in v1.

---

## 4. Keys and verification

### 4.1 Keys are flat and compiler-global

The intrinsic key (the left side of `as`, or the sole name) names an entry in the compiler's **intrinsic inventory** — a flat, compiler-global identifier space, deliberately mirroring the runtime helper family (`seqMemoize` ↔ the memoizing spine, `vectorAt` ↔ `__hex_vectorAt`). Convention: `<companion><Operation>`, lowerCamel. Flat keys survive module and operation renames — the local name is the module's business; the key is the compiler's.

### 4.2 Verification replaces trust

At a foreign extern boundary the declaration is believed (FFI Part 1 §3.1). At this boundary it is **checked**, because the compiler is the implementer and can be held to it:

- **Key existence** is verified at the declaration site. An unknown key is a hard error naming the nearest inventory member (§11).
- **Arity** is verified against the inventory. A mismatch is a declaration-site hard error stating the inventory arity (§11).
- **Types are normative in the declaration**, not in any compiler-side table. The checker types every use — module-internal, consumer, and dot-call — from the declared scheme, exactly as for any annotated export. The compiler's lowering must satisfy that scheme and the operation's owning spec (for `seqMemoize`: every Loops §6.4 property, inheriting FFI Part 3 §7.1 failure memoization); a divergence is a **compiler conformance defect**, testable and loggable, never a user diagnostic.
- *(Added 2026-08-01, #205.)* **Parametricity is part of the contract.** A generic intrinsic's implementation may move, store, and return values at its type parameters; it must never fabricate them, coerce them, or inspect them by type. Consequence: the variance of the declared scheme is semantically true of the implementation — the third soundness leg of the relaxed value restriction (Functions §8.7; closure doc `decisions-ml-dialect-generalization-2026-08.md` §7). The analysis reads only Hexagon-visible definitions, and intrinsics are precisely the values the checker trusts beyond them (§3.4), so this obligation is what keeps a `+` claim on an intrinsically implemented type from being a lie no analysis could catch; the closure doc's §5.3 compiler-side claim-table **trusted rows** ride the same obligation (its verified rows are checked against their visible representations instead). The table does not reverse this section's "types are normative in the declaration, not in any compiler-side table": that clause governs constructors that *have* a declaration; the table holds only what no declaration can hold yet, and its rows die at §9's self-declaration milestones as claims move into source. The v1 inventory holds one entry, `seqMemoize` — the sharpest case (stateful, generic, covariant result); whether its lowering satisfies the obligation is a **conformance-suite item** (closure doc §11.1), per this section's own posture that lowering divergence is a testable compiler conformance defect. Each future inventory entry accepts this obligation alongside key and arity.

The consequence worth stating architecturally: the checker's parallel row tables for door operations (`#collectionOperationType` and kin) become deletable per companion as declarations take over (§9) — the declaration owns the type, which is what "canonical source owns the public surface" (§5.1) meant all along.

---

## 5. The gate

### 5.1 The `hex:` scheme is reserved

The specifier scheme `hex:` is reserved in every `extern from` specifier position, corpus-wide. `"hex:intrinsic"` is its only v1 member. In **unprivileged source**, any `hex:`-scheme specifier is a hard error with a named rewrite (§11); the block never resolves, so no user program can reach the inventory.

*(Edit note, 2026-07-28, on implementation review.)* The reservation extends to **every extern specifier position, not only `extern from`** — `extern import "hex:intrinsic"` is refused too. The scheme is reserved as a scheme; a reservation that held for one block form and not the other would let unprivileged source emit `import "hex:intrinsic";` into the output, a specifier no loader resolves. In privileged source the specifier is legal but the *form* is not, because §8.3 emits no import: there is no foreign module to run for its effects. Both messages are in §11.

### 5.2 Privileged source

A `"hex:intrinsic"` block is legal only in modules compiled as **standard-library source**:

- **v1:** members of the prelude set (`PRELUDE_MODULES`, Modules §5.5) — including a project-supplied file at a prelude injection path, which the loader already lets win over the embedded copy. That affordance is the stdlib-developing-itself path and carries the same trust model as the `Node` runtime flag precedent: privilege attaches to *how the module is compiled*, not to its text.
- **When stdlib-roadmap §5.2 stage 1's package/prelude loader boundary lands:** modules the loader designates as canonical companion source (`BigInt.hex` is the worked example). The block declared here is exactly the door §5.2 item 2 demanded for that stage; BigInt's arc uses this form and needs no further ruling on spelling.

### 5.3 Why the gate is a compilation privilege, not a hidden name

Spike 2 on #125 demonstrated the failure mode of the alternative: a bare private qualifier (`SeqSpine.memoize`) resolves in any consumer module unless gated name-by-name — a leak by default. This design has **no expression-position name to leak**: the door is a declaration form, consumers see only the module's ordinary exports, and the only new surface a user can even type is the reserved specifier string, which fails closed with an explanation. That is the `Node` model's outcome (unimportable, invisible machinery) achieved without the `Node` model's secrecy — the reservation is discoverable and its diagnostic says what it is.

---

## 6. Typing

An intrinsic declaration is typed **from its annotation, in the declaring module's own scope**. This dissolves the larger half of #125's second obstacle by construction: inside `Seq.hex`, the annotation `Seq(a)` resolves through the ordinary record table to the module's own declaration — no compiler-side naming of `Seq` is involved in typing the door, its module-internal uses, or its consumers. The door needs no `#sequence`, no `#seqRecord`, and no fallback *for itself*.

Calls to an intrinsic binding are ordinary Hexagon calls: ordinary evaluation order, ordinary generalisation and instantiation (Functions §8), ordinary constraint discharge. No foreign calling convention applies (FFI Part 6 governs foreign boundaries; this is not one).

---

## 7. The self-declaration fallback (decision point 4)

Compiler-side machinery must still *speak* compiler-known prelude record types on its own account — the `for x in` desugaring yields `Seq(a)`; the transitional producer rows (`Map.keys`, `Vector.toSeq`, …) are typed against the prelude `Seq` identity (checker `#sequence`/`#seqRecord`). That machinery reads `module.preludeRecords`, which is empty in the very module that declares the record, so today the checker cannot name `Seq(a)` while checking `Seq.hex`. The rule:

> While checking a **privileged module** (§5.2) that itself declares the record published to later modules under a compiler-known name, compiler-side machinery needing that type uses **the module's own declaration**. This is not a second identity: a prelude member's record ids are minted in the reserved prelude range and are the very ids later modules receive in `preludeRecords` — the declaration *is* the prelude record.

The gate is **privilege, never the name**. An unprivileged module declaring its own `record Seq(a)` occludes the name (Modules §5.4) and redirects nothing — `Map.keys` still yields the prelude's `Seq` — preserving verbatim the occlusion property documented at the checker's `#sequence` site. The fallback generalizes by construction: it is stated per compiler-known record name, so `Vector`, `Map`, and `Set` inherit it at their self-declaration milestones (§9) with no new ruling. And its remit *shrinks* as §9 proceeds: door rows type from declarations (§6), transitional producer rows are deleted per companion, and at the end state the fallback serves only genuine compiler machinery such as desugarings.

---

## 8. Companion dispatch, visibility, and emission

### 8.1 `CompanionOf` is unperturbed

An exported intrinsic declaration is an exported function of its module — nothing more. Method Syntax §4.2's operation set ("functions exported by `CompanionOf(T)` whose first parameter is `T`-headed") reads its annotation like any other; `source.memoize()` dispatches to `Seq.hex`'s `memoize` because `Seq.hex` is `Seq`'s home module, unconditionally, exactly as before. The precedent is already normative: FFI Part 5 §9 makes extern declarations companion operations; intrinsic declarations follow identically.

### 8.2 What consumers see

Nothing new. Consumers name the operation qualified (`Seq.memoize(steps)`), unqualified via the prelude layer where applicable, or via dot-call — all pre-existing mechanisms over an ordinary export. No consumer spelling changes at any point in §9's schedule; that invariance is the idiom doing its job and is the reason the migration's consumer-facing price is zero.

### 8.3 Emission

An intrinsic declaration is emitted as an **ordinary binding of the declaring module's output** (an ESM named export when exported), so cross-module linkage is ordinary ESM exactly like every other prelude function; the binding's body is the compiler's lowering (for `seqMemoize`, the R1 memoizing spine). Call-site inlining and specialization remain latitude (stdlib-roadmap §5.1); representative emission is not normative, the declared scheme and the owning spec's semantics are. A `"hex:intrinsic"` block emits **no import** — there is no foreign module.

Two non-perturbations, stated so they are checkable: the block is not an `import` line, so Modules §5.5's no-import-lines pedagogy for prelude source is intact — and the lesson the block teaches a reader is true (this operation is compiler-provided). And nothing here decides defect 12: `memoize`'s declared type is `Seq(a) -> Seq(a)`; whatever that ruling makes of an exported `Seq`'s JavaScript face applies to `memoize`'s results uniformly with every other combinator's.

*(Edit note, 2026-08-02, defect 12's implementation.)* **The `Seq`-parameter caveat, now settled.** The paragraph above says nothing here decides defect 12, and it did not; the ruling decided it, and one consequence lands on this section. An exported intrinsic whose declared type has a top-level `Seq(a)` **parameter** takes FFI Part 7 §7 occasion 1's stable wrapper at its export site, exactly as an exported `.hex` function with that signature does — `memoize` being the whole of today's inventory. That does not make the linkage special: it is still one ESM named export of one module-level binding whose body is the lowering, and Hexagon importers reach it through the identity pass-through of Part 3 §2.2's door. It is load-bearing rather than cosmetic here for a sharper reason than elsewhere: an intrinsic's lowering is a compiler helper that drives the record's `pull`, so without the door a JavaScript caller following the published `Iterable<a>` face would not merely observe a dishonest value — it would crash. The internal binding is unchanged and still applies no bridge, because that is not a crossing.

*(Edit note, 2026-07-28, on implementation review.)* **What a refused block emits.** A `hex:`-scheme block the gate rejected (§5) emits an **inert binding** — bound to nothing, exported if it said `export` — and never the lowering, never an import, and never the reserved specifier itself. This is stated because §5.3's "no user program can reach the inventory" is a claim about the *artifact*, not only about the diagnostics: a module carrying a hard error is still emitted (so that a broken module cannot report success silently), so what it emits has to fail closed too. Lowering it would hand back a working door beside the diagnostic forbidding it; emitting it as an ordinary foreign block would write `import … from "hex:intrinsic"` into user output, teaching the one specifier the reservation exists to keep out. An inert binding is neither, and leaves the errored module's other output readable rather than referring to a missing name. *(A binding that throws when called was considered and declined: diagnostics are the contract, and executing an errored module's output is already off-book, so the extra machinery buys a better message in a situation that should not arise.)*

---

## 9. Deprecation of the transitional doors (decision point 5)

### 9.1 The ruling

The **public-name door** (a companion operation reached by spelling the companion's own qualified name inside its module, or by a consumer while no module claims the name — the resolver's `Map`/`Set`/`Vector` guard) and the **primitive door** (the `Int`/`BigInt`/`Float` operation guard, same idiom) are **deprecated as of this ruling and removed per companion at that companion's self-declaration milestone**. Hexagon has no warning tier; deprecation here is a spec status with a bound terminus, not a diagnostic. Until its milestone, each companion's existing door keeps working unchanged — the coexistence of two spellings is real but bounded, ending per companion, never indefinite.

### 9.2 The binding schedule

Conversion to the intrinsic door is a **prerequisite step of each companion's self-declaration milestone**, ordered before the self-declaration commit within the same arc — because declaring the record closes the old door in the same file, the conversion must land first (or in the same change), never after. The milestones are bound to the already-sequenced arcs:

| Companion | Today's door | Milestone (bound to) | What is removed at the milestone |
| :--- | :--- | :--- | :--- |
| `Seq` | none — already self-declared; the old door is closed to it by construction | **immediate**: this ruling unblocks `memoize`, which lands through §3.2's declaration | nothing to remove; `Seq` never gets the old door |
| `Vector` | none — **landed**; the door closed at its milestone | the `Vector` arc — discharged: `stdlib/Vector.hex` is the last prelude member and declares the seven boundary operations through §3.2's form (`vectorLength` … `vectorFromSeq`, §4.1 keys) | removed as scheduled: `"Vector"` left the resolver guard list, Vector's checker rows died (§4.2), the emitter rows re-keyed to flat inventory keys (§9.3). One consequence was ruled at landing: `Seq.hex` and `Vector.hex` collide on four bare names, and a collided bare prelude name is refused in favor of the qualified spellings and dot call (Modules §5.5) |
| `Map`, `Set` | consumer-side guard rows (no `.hex` companions yet) | the Map/Set arc — after `Vector`, per James's sequencing (2026-07-28), which for the collection companions **supersedes the ledger's preferred-order list** (whose item 3 placed Map/Set before `Vector`, which that list reaches only at item 5); the supersession is recorded as an edit note at stdlib-roadmap §5.2 | their guard entries and the `Map`/`Set`/`Vector` collection rows. The `CollectionOperation` *family* does **not** die with them: `Node` also resolves through it (the resolver's `runtime`-gated guard), and **§3.3 keeps `Node` out of the block** — it remains a deliberate non-declared fallback under Modules §5.5. So the family stands past the Map/Set milestone with `Node` as its sole member, and Modules §5.5's loop closes for the four companions and stays open exactly for `Node`. Whether a one-member family is the intended terminus is **#223** *(corrected 2026-08-02, #223 — this row previously made full-family deletion conditional on #126, which asked whether `Node` should move into the door; #126 closed without moving §3.3)* |
| `BigInt` | the primitive-operation guard (`div`/`mod`/`quot`/`rem`/`gcd`/`lcm`) | stdlib-roadmap §5.2 stages 1–2 — the worked example; item 2's door *is* this door, so no separate design exists to wait for | `BigInt`'s `PrimitiveOperation` guard rows |
| `Int`, `Float` | the same primitive-operation guard | §5.2 item 7's per-companion template application (preferred-order items 1 and 5). These two have **no independent milestone**: they are bound to the template's one-companion-at-a-time rule, which is bounded but unordered beyond BigInt-first. The fact that would fix an independent milestone is James's sequencing of the primitive arcs after `BigInt.hex`, not yet given | their `PrimitiveOperation` guard rows, per companion as each arc lands; the family dies with the last of them |

No calendar dates are fixable in this corpus — the project schedules by arcs, and every milestone above is bound to an arc. Where an arc's own position is already decided (`Seq`, `Vector`, Map/Set, `BigInt`), the milestone is as fixed as the repo's scheduling admits. Where it is not, the row says so and names the one fact that would fix it: `Int`/`Float` await James's sequencing of the primitive arcs after `BigInt.hex`, and the family-terminal claim for `CollectionOperation` awaits **#223**'s disposition of the family once `Node` is its only member. Those two are the entire residue; nothing else is handed back.

### 9.3 The migration's price, itemized

Per companion: one mechanical conversion commit (wrapper → declaration, §3.2's two shapes), one resolver-guard deletion, one checker-row deletion, and re-keying the emitter rows from `(collection, operation)` pairs to flat inventory keys (§4.1) — all behavior-pinned by the existing suites, since no consumer spelling changes (§8.2). The alternative — leaving the public-name door undeprecated — was rejected: it preserves indefinitely a mechanism whose correct use is indistinguishable from an obvious defect (#125's "reads as a bug"), and it silently breaks anyway at each self-declaration, which is the worst possible removal schedule: unscheduled.

---

## 10. Rejected alternatives (do not re-litigate)

1. **A single reserved qualifier in expression position** (`Intrinsic.seqMemoize(...)`). Puts a new name into term-position resolution that must be gated or it is namable from user code; leaves every row's type in a compiler-side table forever, against §5.1's source-ownership doctrine; and reads as a call to a mystery module inside files meant as exemplary source. Rejected — the intrinsic is a linkage, and no prior-art language spells linkage as resolution.
2. **A per-companion private qualifier by convention** (`SeqSpine.memoize`). Everything in (1), plus a naming convention to police per companion, plus spike 2's demonstrated consumer-scope leak. Rejected.
3. **Reopening the companion idiom.** Examined under James's explicit widening and retained — §2 carries the argument (separately-spelled modules and types still need a declaration form; the reopening price is total and its purchase toward the gap is zero) and the migration price it avoids.
4. **Keeping the public-name door alongside the new spelling indefinitely.** Rejected in §9.3 — the door removes itself unscheduled at each self-declaration; this ruling only replaces an unscheduled break with a scheduled removal.
5. **Extending genericity to foreign externs while touching the block grammar.** Out of scope and rejected on its own terms — Part 4 §12.4's representation question is real at foreign boundaries and absent here (§3.4).

---

## 11. Diagnostics checklist

All hard errors, each with its named rewrite per the Rewrite Rule (Declarations Preamble §1.1):

- **Reserved scheme in unprivileged source** — `extern from "hex:intrinsic"` (or any `hex:`-scheme specifier) outside privileged stdlib source: "the `hex:` specifier scheme is reserved to standard-library source; to bind your own JavaScript implementation, use an ordinary `extern from` block naming your module." The rewrite is the ordinary extern block the user's intent wants.
- **Reserved scheme in an effect import** *(added 2026-07-28 with §5.1's edit note)* — `extern import "hex:…"` in unprivileged source: the same reservation, with the rewrite naming the form the author was already writing — "to run your own JavaScript module for its effects, use an ordinary `extern import` naming your module." Pointing an effect import at an `extern from` block would rewrite the wrong half of what they typed.
- **The door imported as a module** *(added 2026-07-28 with §5.1's edit note)* — `extern import "hex:intrinsic"` in *privileged* source, where the specifier is legal but the form is not: "the intrinsic door has no foreign module to import; declare the operations you need in an `extern from \"hex:intrinsic\"` block." The rewrite is the block form, which is what the author needs to reach the inventory at all.
- **Unknown intrinsic key** — declaration-site, verified against the inventory (§4.2): "the compiler provides no intrinsic `seqMemoise`; the nearest provided key is `seqMemoize`." The rewrite is the corrected key. *(2026-07-28: when no key is close enough for a suggestion to be anything but a guess, the rewrite is the inventory itself — "the keys it provides are …" — which is exhaustive rather than speculative, the flat compiler-global key space paying off.)*
- **Intrinsic arity mismatch** — declaration-site: "intrinsic `vectorAt` takes 2 parameters, but this declaration has 3." The rewrite is the inventory arity, stated in the message.
- **Inadmissible declaration form in the block** (§3.3) — `let`, `type`, `default`, `method`, `get`, `set`, `class`, or `enum` under `"hex:intrinsic"`: "the intrinsic boundary provides operations only; declare `fun` here, and declare types as ordinary (`export opaque`) declarations in this module." The rewrite is the ordinary declaration the form should have been.
- **Generic foreign extern** — unchanged Part 4 behavior; not restated here (§3.4 grants genericity inside the reserved boundary only).

---

## 12. Edit notes applied elsewhere by this ruling

- `spec/modules.md` §5.3 — note: the intrinsic is not a third meaning of the shared name; pointer here. §14 — decisions-log row.
- `spec/stdlib-roadmap.md` §5.2 — note at item 2: the "narrow private intrinsic door" now has its normative spelling and schedule here. Note after the preferred-order list: James's sequencing supersedes it for the collection companions (`Vector` before Map/Set), which §9.2's milestones are bound to.
- `spec/ffi-part4-extern-bindings.md` §2.1 — note: the `hex:` scheme is reserved in specifiers; this file owns the reserved boundary. §11 item 7 and §12.4 — notes: foreign-extern monomorphism unchanged; genericity exists only inside the reserved boundary (§3.4).
- `spec/loops-ranges-iteration.md` §6.4 — note on the `memoize` bullet: the spine remains runtime-provided; its declaration is now canonical `.hex` through this door.
- `spec/README.md` — ownership-map row for this file; added to the Resolver / checker, Modules work, and Stdlib work reading sets (deliberately not Emitter: §8.3 is one paragraph of latitude, reachable through the other sets).

---

## 13. Decisions log

| Decision | Where |
|---|---|
| Intrinsic linkage is a declaration, never a resolution meaning; `Name.` keeps exactly two positions | §1 |
| Companion idiom examined under widened scope and retained; renaming positions would not house the intrinsic (OCaml argument) | §2 |
| Spelling: `extern from "hex:intrinsic"` block reusing Part 4 grammar; foreign-name-first `as` binds flat key to local name; `fun` only in v1 | §3.1–§3.3 |
| Genericity granted inside the reserved boundary only; Part 4 §12.4 not reopened | §3.4 |
| Keys are flat and compiler-global, mirroring the runtime helper family; key and arity verified at declaration site; declared types normative; lowering divergence is a compiler conformance defect | §4 |
| Gate: `hex:` scheme reserved corpus-wide; block legal only in privileged stdlib source (v1: prelude members incl. injection-path override; later: loader-designated canonical companions) | §5 |
| No new expression-position name exists; nothing to leak; reservation fails closed with a named rewrite | §5.3, §11 |
| Doors type from their annotations in module scope; no compiler-side naming of the record is involved | §6 |
| Self-declaration fallback: privilege-gated, identity-preserving (the declaration *is* the prelude record), occlusion untouched, generalizes per compiler-known record name | §7 |
| `CompanionOf` unperturbed; consumers see ordinary exports; consumer spellings never change across the migration | §8.1–§8.2 |
| Intrinsic bindings emit as ordinary module bindings; call-site specialization stays latitude; defect 12 not presupposed. *(2026-08-02, defect 12's implementation:)* an exported intrinsic with a top-level `Seq(a)` parameter takes occasion 1's export wrapper like any other exported function; the internal binding still applies no bridge | §8.3 |
| Public-name and primitive doors deprecated with per-companion termini; conversion is a prerequisite step of each self-declaration milestone; James's sequencing supersedes the ledger's collection order (edit note at stdlib-roadmap §5.2); `PrimitiveOperation` dies with the last primitive arc (`Int`/`Float` bound to §5.2 item 7, no independent milestone); `CollectionOperation`'s companion rows die at the Map/Set milestone, after which the family stands with `Node` alone (§3.3 keeps it out of the door); its terminal state is #223 | §9 |
| Five alternatives rejected with prices recorded | §10 |
| Generic intrinsics carry a parametricity obligation (move/store/return only — never fabricate, coerce, or type-inspect); declared-scheme variance thereby semantically true; `seqMemoize`'s conformance routed to the test suite; claim-table rows ride the same obligation (#205) | §4.2 |
