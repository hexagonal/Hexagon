# Canonical formatting and naming — review package

**Status:** Review package (July 2026). A restatement, not an owner: every
check cites the spec section whose text is authoritative, and on any
discrepancy the cited owner wins and this file is the one to fix. Assembled
from Functions, Modules, Constraints, Lexer, Lexer Layout, Numeric Literals,
and `canonical-formatting-plan.md`.

**Purpose:** the end-of-segment check. After implementing a feature
increment — compiler code with embedded `.hex` fixtures, stdlib modules,
spec examples, book snippets, Playground samples — run the changed
declarations through this list before considering the segment done.

**How to run:**

1. Scope is the segment's diff: new or changed Hexagon declarations only.
2. **[enforced]** items are compile errors. For code that compiles in CI they
   need no hand-check; they are listed so that *non-compiled* Hexagon text
   (spec examples, book snippets, doc comments, diagnostics templates) is
   held to the same bar.
3. **[canonical]** items are style. The compiler accepts both spellings; the
   corpus writes exactly one. These are the real review surface.
4. Report a deviation with its owning § citation, not this file.

---

## 1. Naming

- **N1 [enforced]** Term bindings — `let`, `fun`, `var`, parameters — are
  non-uppercase-start. Uppercase-start in term-binding position is a hard
  error. (Functions §2)
- **N2 [enforced]** Uppercase-start names serve the type, union-case,
  constraint, implied-type, exception, and module-alias roles;
  non-uppercase-start names serve term and binder roles. (Lexer §3)
- **N3 [canonical]** Type variables are lowercase; `a`, `b`, `k`, `v` are
  the cultural spellings. (Functions §4.2)
- **N4 [canonical]** Caseless-script identifiers wanting an uppercase role
  take one mnemonic Latin prefix per role: `T`/`U`/`C`/`I`/`E`/`M`.
  (Lexer §3)
- **N5 [canonical → normative in stdlib]** Subject-first parameter order:
  the value being operated on is the first parameter — `map(xs, f)`, never
  `map(f, xs)`. Normative for prelude and stdlib; determines dot-callability.
  (Functions §5.4; Operators §8; Method Syntax §4.2)
- **N6 [canonical]** Prefer `let` over `fun`; `fun` is for recursion only.
  (Functions §3.2)
- **N7 [enforced]** Module aliases are uppercase-start, mandatorily
  (`import module Geo`). An import alias's start class matches what it names.
  (Modules §3.3, §3.2)
- **N8 [canonical]** `create` for smart constructors is cultural guidance,
  never a compiler-special name. (FFI Part 5)

## 2. Signatures and annotations (boundary-first)

- **S1 [enforced]** An exported function annotates every parameter and its
  result; an exported value binding annotates its type. (Modules §4.1.1)
- **S2 [enforced]** A constrained exported function writes a binder per
  *constrained* variable; the list is maximal under base-constraint
  entailment — strongest constraints only, no restated bases:
  `<a: Hash>`, never `<a: (Eq, Hash)>`. (Modules §4.1.1)
- **S3 [canonical]** No function header, exported or private, writes a bare
  `<a>` binder. The binder attaches constraints; case already classifies
  `a` as a variable (Lexer §3), and the annotation `x: a` introduces it.
  `export let id(x: a): a = x`, never `export let id<a>(x: a): a = x`.
  A mixed binder list drops its unconstrained elements the same way:
  `tag<a: Show>(x: a, y: b)`, never `tag<a: Show, b>(x: a, y: b)`.
  Signature and scheme notation follow the same rule — the canonical
  cannot abide the redundant, and a `<a>` that only repeats what an
  annotation introduces is redundant in any notation:
  `JsValue.from(value: a) -> JsValue`, never
  `JsValue.from<a>(value: a) -> JsValue`.
  Spec and conformance specimens carry no exemption: a specimen writes a
  bare binder only where the bare form is itself the demonstrated subject
  (a rule naming it to license or reject it); demonstrating anything else,
  the specimen is written canonically.
  (Functions §4.2.1)
- **S4 [canonical]** A private module-level function annotates every
  parameter — including generic structure, `xs: Vector(a)` — and leaves
  the return type and constraints to inference. (Functions §4.2.1;
  canonical-formatting-plan §1)
- **S5 [canonical]** Lambdas and local bindings carry no annotations.
  (canonical-formatting-plan §1)
- **S6 [canonical]** An exported signature names a type alias rather than
  spelling an inline structural type. Intent-sensitive: an explicitly open
  row stays written when open-row genericity is the point.
  (canonical-formatting-plan §1, §2)
- **S7 [canonical]** Declarations are total; consumption is free: no
  annotations on destructuring patterns, pattern binders, constructor
  arguments, checked record literals, or `honor` member implementations.
  (canonical-formatting-plan §2)
- **S8 [canonical]** Annotation repair inserts the inferred concrete type,
  never a placeholder type variable. A rigid-annotation error (`value: a`
  where the body needs `Int`) is repaired to `value: Int`.
  (canonical-formatting-plan §1.1; Functions §4.1)
- **S9 [enforced]** No standalone signature lines; types are written only on
  definitions. (Functions §4.1)
- **S10 [canonical]** `Unit` is never written in parameter position. A thunk's
  type is `() -> T`, never `Unit -> T` — the two differ, and only the first is
  zero-parameter. A `Unit`-typed parameter is legitimate when it *arises* from
  instantiating a generic at `Unit`; it is not written by hand. Where a thunk
  must reach a generic `a -> b` slot, the bridge is the eta-wrap
  `_ => thunk()`.
  (Functions §5.3)
- **S11 [canonical]** A degenerate whole-type hole is normalized to omission:
  `x: _` and `let n: _ = ...` are legal and inert, and the formatter drops
  the annotation, leaving the bare binder — `f(x: _, y)` becomes `f(x, y)`,
  `let n: _ = ...` becomes `let n = ...`. Holes *inside* a written type —
  `xs: Vector(_)` — are ordinary canonical Hexagon and stay written. A
  **constrained** hole is never inert and is never dropped: `x: _ : Show`
  carries a claim and stays written. The ascription's degenerate spelling
  normalizes the same way: `(e : _)` becomes `(e)` (Ascription spec §3.2).
  (`decisions-ml-dialect-annotations-2026-08.md` §5.2, §4.4)
- **S12 [canonical]** A hole is never written where a type variable would
  hold. If the position is genuinely generic, write the variable — the
  claim is checked, and the signature is export-ready: `xs: Vector(a)`,
  never `xs: Vector(_)`. A hole is the canonical spelling exactly where a
  variable would be refused — the concrete-but-inferred position:
  `rows: Vector(_)` whose body fixes the element. The same rule governs
  constrained holes: where `_ : C` would generalize, write the binder and
  the variable (`f<a: Show>(x: a)`, never `f(x: _ : Show)`); `_ : C` is
  canonical exactly where the variable is refused. The formatter never
  rewrites one into the other — that transform invents a name, which is
  authorship, not formatting. Constraint-colon spacing: `x: _ : Num`,
  never `x: _: Num` — the annotation colon hugs its binder, the constraint
  colon stands off; binder lists are untouched (`<a: Num>`). The rule
  reaches ascribed types (Ascription spec §3.2).
  (`decisions-ml-dialect-annotations-2026-08.md` §5.6, §4.4)

## 3. Literals

- **L1 [canonical]** Every non-negative whole-number literal uses the bare
  integer spelling; a checked context resolves it (`0`, not `0.0`, in a
  `Float` arm the scrutinee already pins). Write the target-imitating
  spelling only where inference genuinely lacks the information.
  (canonical-formatting-plan §3; Numeric Literals §1)
- **L2 [canonical]** Fractional literals keep their decimal spelling; `1n`
  is written only when `BigInt` is the intended monomorphic type.
  (Numeric Literals §1)

## 4. Layout and conditionals

- **F1 [canonical]** Four spaces per indentation level. (Lexer Layout §1)
- **F2 [enforced]** Conditionals carry mandatory `then` (parse error without).
  An else-less `if` is sugar for `else ()` and its `then` branch must be
  `Unit`; an else-less `if` producing a value is a type error with the
  add-an-else fixit. (Operators §11.2; canonical-formatting-plan §5 restates)
- **F3 [canonical]** An effect-position (`Unit`) conditional omits `else`;
  explicit `else ()` is non-canonical ceremony. A value-producing conditional
  writes both branches. A genuinely short conditional stays on one line;
  otherwise the multiline form. A nested false-branch conditional indents
  beneath `else`; `else if` only for a complete one-line conditional.
  (Operators §11.2–§11.3; canonical-formatting-plan §5 restates)

---

*Companion: `canonical-formatting-plan.md` holds the rollout plan and the
fuller rationale for §2's boundary doctrine; this file is the distilled
per-segment check.*
