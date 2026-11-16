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
  (`import Geometry as Geo`); an import binds nothing else.
  (Modules §3.1)
- **N8 [canonical]** `create` for smart constructors is cultural guidance,
  never a compiler-special name. (FFI Part 5)

## 2. Signatures and annotations (boundary-first)

- **S1 [enforced]** An exported function annotates every parameter and its
  result, or, as a `let` whose value is a lambda, writes its whole type on its
  name; an exported value binding annotates its type. (Modules §4.1.1)
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
- **S11 [canonical]** A degenerate whole-type hole is omitted: `x: _` and
  `let n: _ = ...` are legal and inert, and canonical Hexagon writes the
  bare binder — `f(x, y)`, not `f(x: _, y)`; `let n = ...`, not
  `let n: _ = ...`. Format document changes whitespace only and leaves a
  written `x: _` as it stands, since its author may be on the way to
  `x: _: Num` (Canonical Layout §13). Holes *inside* a written type —
  `xs: Vector(_)` — are ordinary canonical Hexagon and stay written. A
  **constrained** hole is never inert and is never dropped: `x: _: Show`
  carries a claim and stays written. The ascription's degenerate spelling
  is omitted the same way: `(e)`, not `(e: _)` (Ascription spec §3.2).
  So is a typed pattern's: `p`, not `(p: _)`, its parentheses with it
  where they group nothing else (Pattern Matching §2.9).
  (`decisions-ml-dialect-annotations-2026-08.md` §5.2, §4.4)
- **S12 [canonical]** A hole is never written where a type variable would
  hold. If the position is genuinely generic, write the variable — the
  claim is checked, and the signature is export-ready: `xs: Vector(a)`,
  never `xs: Vector(_)`. A hole is the canonical spelling exactly where a
  variable would be refused — the concrete-but-inferred position:
  `rows: Vector(_)` whose body fixes the element. The same rule governs
  constrained holes: where `_: C` would generalize, write the binder and
  the variable (`f<a: Show>(x: a)`, never `f(x: _: Show)`); `_: C` is
  canonical exactly where the variable is refused. The formatter never
  rewrites one into the other — that transform invents a name, which is
  authorship, not formatting. Every colon is written tight on its left
  with one space after: `x: _: Num`, never `x: _ : Num`, and `(e: T)`,
  never `(e : T)` (Canonical Layout §7.1). The rule reaches ascribed
  types (Ascription spec §3.2).
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

- **F1 [canonical]** Four spaces per indentation level. (Lexer Layout §1;
  Format document writes it, Canonical Layout §5)
- **F2 [enforced]** Conditionals carry mandatory `then`, loops `do`, and a
  `match` with a scrutinee `with` (parse error without; Lexer & Layout §2.4).
  An else-less `if` is sugar for `else ()` and its `then` branch must be
  `Unit`; an else-less `if` producing a value is a type error with the
  add-an-else fixit. (Operators §11.2; canonical-formatting-plan §5 restates)
- **F3 [canonical]** An effect-position (`Unit`) conditional omits `else`;
  explicit `else ()` is non-canonical ceremony. A value-producing conditional
  writes both branches. A genuinely short conditional stays on one line;
  otherwise the multiline form. A chain uses `else if` on one line even in multiline code, aligned
  with the first `if`; each branch body indents one level.
  (Operators §11.2–§11.3; canonical-formatting-plan §5 restates)
- **F4 [canonical, v1 stance]** *(#700.)* The fused `fun f(…) = …` and the
  single-member `fun` block are both legal, and the formatter rewrites
  neither into the other — the fused spelling is idiomatic for one member,
  the block earns its place at two, but neither is enforced. Revisit with
  field evidence. (Functions §7.3)
- **F5 [canonical]** A head's closing word ends the head's last line. A head
  too long for its line is carried on at two levels, each carried-on line
  beginning with its operator; a `then`, `do` or `with` that begins a line of
  its own is legal but not canonical. (Lexer & Layout §2.4; Canonical Layout
  §9.3–§9.4; Operators §11.3)

## 5. House settings

This section is the house style's own record, not a restatement. The
formatter leaves these choices to the author (Canonical Layout §13), and
house text makes them this way. **House text** is the standard library,
the Book, the Playground's tutorials and the spec's own examples.

- **H1** House text is formatted at Maximum line length 100. A line that
  cannot be broken, such as one holding a long string or comment, stays
  longer. (Canonical Layout §3.1, §9)
- **H2** It is formatted with Collapse extra spaces on: the house never
  lines things up with spaces. (Canonical Layout §3.2)
- **H3** In house text, a function with a doc comment has a blank line
  above the doc comment and a blank line below the function. The
  formatter adds neither for this reason: for it, a doc comment does not
  change where blank lines go. (Canonical Layout §6.3)
- **H4** A line carried on at an operator begins with the operator, as
  each line Format document breaks at one does. An operator written at
  the end of a line is legal and the formatter leaves it there, but house
  text does not write it. A head carried on to its closing word is no
  exception (F5). (Canonical Layout §9.4, §9.5, §13)

  ```
  let same =
      left.negated == right.negated
              and left.folded == right.folded
              and Vector.length(left.items) == Vector.length(right.items)
  ```

- **H5** An expression that fits on its line is written there, after its
  `=`, `:=` or `=>`, even where it was written beneath: the formatter
  never joins lines, so house text makes this move by hand. A doc comment
  changes nothing here (H3), and a conditional's branches take F3's
  shape. An expression that runs on over further lines begins a line of
  its own beneath, one level in, brackets and all.
  Format document also puts a value too long for its line beneath its
  `=` or `:=`, before it opens any brackets. An `else if` stays on one line
  (F3), and a match function or lambda keeps its head where H7 puts it.
  (Canonical Layout §9.4, §13)

  ```
  let scriptNames: Map(String, String) =
      Map.fromVector([
          ("Adlm", "Adlam"),
          ("Ahom", "Ahom"),
          ("Arab", "Arabic"),
      ])
  ```

- **H6** A `match … with` always begins its own line, since its arms are
  always a block beneath it. So it goes beneath a binding's `=`, an
  assignment's `:=`, and an arm's or a lambda's `=>` (H5), and it
  begins its own line after `try` and as a call's argument too.
  `if` and `try` follow H5:
  one that fits on its line is written after its `=`, `:=` or `=>`, and
  one that runs on begins its own line. A conditional's shape is F3's, and a
  condition carried on ends its last line with `then` (F5). (Canonical
  Layout §13)

  ```
  export let first(values: Vector(a)): Option(a) =
      match values with
          [] => None
          [value, ...] => Some(value)

  let scale = if aligned > 1074 then 1074 else aligned

  let counted =
      if point == "{" then
          braceCount(text, position)
      else
          let width = simpleWidth(point)
          Read((width, None, position + 1))
  ```

- **H7** A head stays on the line where it stands: the bare `match` of a
  match function, where the function is bound or passed; a lambda's
  `(params) =>`; and an arm's `pattern =>`. So a match function or a
  lambda bound by a `let` keeps its head on the `let`'s line, and a call
  that passes one moves beneath its `=` whole, the head staying on the
  call's line. A head's body follows H5: a body that fits stays after
  the `=>`, and one that runs on goes beneath it, one level in. (Pattern
  Matching §6.7; Canonical Layout §13)

  ```
  let label = match
      Some(value) => value
      None => "missing"

  let labels =
      Vector.map(options, match
          Some(value) => value
          None => "missing"
      )

  let doubled = values.map(value => value * 2)

  let largest =
      Vector.fold(values, None, (best, value) =>
          match best with
              Some(kept) => if value > kept then Some(value) else best
              None => Some(value)
      )
  ```

- **H8** A list whose closing bracket begins its line ends with a comma
  after its last item, as Format document writes it at the house
  settings, where Leave trailing commas as written is off. A list on one
  line has none, and neither does a list whose last item ends in a
  block, such as a lambda whose body is beneath its `=>` (H7's
  examples), since no comma can stand there. (Canonical Layout §3.4,
  §14; Lexer & Layout §7)

  ```
  let scaled =
      create(
          decimal.unscaled * tenTo(checked - decimal.places),
          checked,
      )
  ```

---

*Companion: `canonical-formatting-plan.md` holds the rollout plan and the
fuller rationale for §2's boundary doctrine; this file is the distilled
per-segment check.*
