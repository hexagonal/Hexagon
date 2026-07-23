# Hexagon Glossary — Canonical Terminology

**Status:** Living document. Every terminology ruling lands here on adoption.

**Authority:** This glossary is the single lookup for “what do we call this?”
across spec prose, diagnostics, and pedagogy. Where a spec document and this
glossary disagree, the glossary reflects the later ruling; file an edit note
against the spec.

## 1. Purpose and scope

### 1.1 Hexagon-speak

Hexagon-speak is a controlled vocabulary: each relationship or concept gets
exactly one term per register, and banned near-synonyms are recorded with
do-not-relitigate markers. This document is the artifact form of that
vocabulary.

### 1.2 Scope

Terminology only. Syntax and semantics live in their owning specs; this
document records what things are called and cross-references the owner.

### 1.3 Entry contents

A term’s entry records: definition, register or registers, precedent cited at
adoption, and banned or rejected near-synonyms.

## 2. Registers

### 2.1 Three registers

A term may be legal in one register and banned in another.

| Register | Audience | Character |
| --- | --- | --- |
| Spec prose | Language designers, reviewers | May cite literature terms once for anchoring |
| Diagnostics | Working Hexagon developers | Requirements language; zero jargon; every banned-in-diagnostics term applies here |
| Pedagogy | Senior TS/C# developers learning Hexagon | Leads with the reader’s own vocabulary, then corrects the one wrong association |

### 2.2 Constraint word-family

The register table for the constraint word-family is the canonical example of
the system:

| Context | Canonical phrasing |
| --- | --- |
| Declaration, spec prose | “Hash extends Eq”; “Eq is Hash’s base constraint” |
| Signature, spec prose | “a must honor Eq” |
| Diagnostics | “requires Eq<...>, which is not honored” |
| Pedagogy | “extends here works like interface extends: more obligations, no inherited code” |

## 3. Constraint vocabulary

### 3.1 constraint

The Hexagon mechanism for ad-hoc polymorphism, declared with the `constraint`
keyword and discharged with `honor`. Compiled via dictionary-passing with
monomorphic erasure; that is implementation vocabulary, not user-facing
vocabulary.

**Rejected: interface (do not relitigate).** Dangerous false friend; imports
TypeScript/C# structural and object-oriented expectations that do not hold.

**Rejected: typeclass, trait.** Literature terms; may appear once in spec prose
when citing Haskell or Rust precedent, never in diagnostics or pedagogy as the
name of the Hexagon feature.

### 3.2 honor

Keyword and verb. A type discharges a constraint’s obligations: “Point honors
Eq.”

**Rejected: implement (do not relitigate).** `honor` reads as discharging an
obligation, which is the correct mental model; `implement` imports
object-oriented implementation inheritance.

### 3.3 base constraint

The constraint that another constraint builds on. In `Hash<a: Eq>`, `Eq` is the
base constraint of `Hash`. To honor the extending constraint, the base must
already be honored; the extending constraint’s dictionary entails the base’s
dictionary.

**Precedent: C# base.** The weaker, more general contract built upon; imports
the correct direction for the target audience. The C# colon
(`class Derived : Base`) also matches Hexagon’s surface syntax, so the bound
reads as extension to C# eyes with zero training.

**Banned: superconstraint (do not relitigate).** Direction-inverting jargon;
“super” requires set-containment reasoning to decode and confused the
language’s own designer, which is the canary for confusing the audience. Banned
from spec and diagnostics alike. May be mentioned only when quoting external
literature, immediately glossed as “base constraint.”

**Rejected: derived constraint (do not relitigate)** as the name for the
extending side. It collides with `derive` and derived honors, which are
load-bearing. The extending side has no noun; use verb forms: “Hash extends Eq”
or “constraints that require Eq.”

### 3.4 extends

Verb, for the constraint-to-constraint relationship only. Read from the
extending side: “Hash extends Eq.” Prose and pedagogy vocabulary only; the
grammar spells it `<a: Eq>` and no `extends` keyword exists or is planned.

**Precedent: TypeScript `interface X extends Y`.** Obligation extension with no
implementation flow, which is exactly the Hexagon semantics.

**Scope limit:** Never used for a type variable against a constraint; that is
`honors` (§3.2). Keeping `extends` to one relationship protects it from
vagueness.

### 3.5 builds on

Informal synonym for `extends` in spec prose where repetition would grate. No
standing in diagnostics.

### 3.6 requires / required

Diagnostic-register vocabulary for the base-constraint relationship and all
constraint obligations as seen from a use site. Canonical diagnostic shape:
“Hash<Point> requires Eq<Point>, which is not honored.”

### 3.7 implies / implied

Reserved exclusively for functional determination of a constraint’s type
members (§4). Retired from the base-constraint context, formerly phrased
informally as “Hash implies Eq,” which is fully served by `extends`, `builds
on`, and `requires`. One verb, one relationship.

## 4. Type members

### 4.1 implied type

A type member of a constraint, functionally determined by the honoring type:
the constraint honor implies the type. Reference syntax: `Elem(c)`. Identity is
owner-scoped—the owner constraint plus member name—not a global namespace.

The term uses the logic sense of implication: given the honor, the member type
follows. It is more precise than the literature term, which says only that the
type is nearby, not that the honor pins it down.

**Literature cross-reference: associated type (Rust, Swift).** Legal in spec
prose when citing precedent, glossed on first use; not the Hexagon-speak name.

**Status:** Type members in constraints are formally deferred to v2; design
decided in principle. This entry fixes the vocabulary ahead of the feature.

### 4.2 declared type variable

A type variable deliberately written in a function annotation, such as `a` in
`thing: a`. It is rigid while the definition is checked: repeated uses of the
same name denote the same type, inferred constraints may attach to it, and it
cannot silently become a concrete type.

**Diagnostics and pedagogy:** “declared type variable.” Explain the source
contract directly: “`a` is a declared type variable, but the body requires
`Int`.”

**Spec and implementation:** “rigid annotation type variable” is legal when the
rigidity distinction matters.

**Literature cross-reference: skolem.** Legal once in spec prose when anchoring
the implementation technique. Never use `skolem` in diagnostics or as the
pedagogical name of the Hexagon feature.

## 5. Feature names

### 5.1 type-directed companion dispatch

The canonical name for the `receiver.name(args)` rewrite to
`CompanionOf(receiverType).name(receiver, args)`.

**Rejected (do not relitigate): UFCS, methods / method call** as the feature
name. “Method syntax” survives only as an informal file or section label; the
feature name is as above. Hexagon has no methods; constraint members are never
dot-callable.

### 5.2 Named doctrines

Canonical names; definitions live in their owning specs.

- **Rewrite Rule** — every restrictive error has a local, obvious rewrite.
- **Deferred-Goals Doctrine** — inference goals anchor to the receiver type
  variable’s inference region; the pinning rule prevents inner generalization
  boundaries from quantifying goal-entangled variables.
- **Boundary Annotation Doctrine** — annotate where types flow in
  (module-level function parameters and exported surfaces), and infer where
  types flow out (return types and constraints of non-exported functions,
  locals, lambdas, and pattern binders). Exported functions explicitly publish
  their constraints, listing only the strongest constraints and never
  restating an entailed base constraint. Declarations are total; consumption is
  free.
- **Head Binder Shadowing rule** — sequential binders never reuse an in-scope
  name; head binders may shadow freely.

## 6. Standard-library naming conventions

### 6.1 try prefix

Reserved standard-library-wide for non-throwing variants. No other use of the
prefix is permitted in standard-library naming.

### 6.2 Accessor Doctrine vocabulary

`[]` is the throwing accessor (`IndexError` / `KeyError`); `get` is always total
and returns `Option`. “Total” and “throwing” are the canonical adjectives; avoid
“safe” and “unsafe,” which import memory-safety connotations from Rust.

### 6.3 Vector

The workhorse persistent sequence. `List` is reserved for a possible future
cons list and is never used loosely to mean “sequence” in prose or
documentation.

## 7. Banned-terms index

The diagnostic register applies unless noted otherwise.

| Term | Ruling | Replacement |
| --- | --- | --- |
| superconstraint | banned, spec + diagnostics (§3.3) | base constraint |
| interface | rejected as feature name (§3.1) | constraint |
| implement | rejected (§3.2) | honor |
| derived constraint | rejected (§3.3) | verb forms: extends / requires |
| row | banned from all user-facing diagnostics (standing ruling) | phrase in terms of record fields |
| UFCS / methods | rejected as feature name (§5.1) | type-directed companion dispatch |
| associated type | not banned; literature cross-reference only (§4.1) | implied type |
| implies (for base constraints) | retired (§3.7) | extends / builds on / requires |
| skolem | literature cross-reference only (§4.2); banned in diagnostics and pedagogy | declared type variable |
