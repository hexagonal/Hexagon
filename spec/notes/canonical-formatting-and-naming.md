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
  explicit `else ()` is non-canonical ceremony. A value-producing
  conditional writes both branches. A conditional, with or without `else`,
  stays on one line up to 60 wide; otherwise the multiline form (H9). An
  `else if` chain is never on one line, nor is a conditional that holds
  another. A chain keeps each `else` and its `if` together on a line,
  aligned with the first `if`; each branch body indents one level,
  except a branch that begins with spread brackets, which opens them on
  its `then` or `else` line (H11). (Operators §11.2–§11.3; Canonical Layout §15; canonical-formatting-plan §5
  restates)
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
the Book, the Playground's tutorials and the spec's own examples. One
test, the house test, holds each to this section: Format document at the
house settings changes nothing, and the test checks what the formatter
does not make, which is H6's loops, H9, H10 and N6. It reads every example
that parses; an example with a line the compiler refuses does not parse,
and of it the test reads only the comments, for H10. The examples left as
written stand in its baseline, each beneath its reason. The spec's
decision records keep their history as written, and the examples of
Canonical Layout and Lexer & Layout are the layouts those chapters change
or refuse, so the test reads neither; nor does it read the notes.

- **H1** House text is formatted at Maximum line length 100. A line that
  cannot be broken, such as one holding a long string or a comment that
  begins its line, stays longer; a comment that ends a line does not (H10).
  (Canonical Layout §3.1, §9)
- **H2** It is formatted with Collapse extra spaces on: the house never
  lines things up with spaces. (Canonical Layout §3.2)
- **H3** In house text, a function with a doc comment has a blank line
  above the doc comment and a blank line below the function. The
  formatter never adds one because of the doc comment: for it, a doc
  comment does not change where blank lines go. (Canonical Layout
  §6.2, §6.3)
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
  its own beneath, one level in, unless it begins with brackets that are
  spread, which open on its `=`, `:=` or `=>` line (H11).
  Format document also puts a value too long for its line beneath its
  `=` or `:=` before it opens any brackets, but keeps it on the `=`'s line
  where the brackets it begins with would open beneath it (H11). An
  `else if` stays on one line (F3), and a match function or lambda keeps
  its head where H7 puts it. (Canonical Layout §9.4, §13)

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
  A `for` or `while` loop always begins its own line as well: H5 places a
  value, and a loop has none to place. So a loop never follows an `=`,
  `:=`, `=>`, `then` or `else` on its line, even where it would fit.
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
  let kept =
      keepsEverySlot(
          Node.get(children, index),
          Node.get(newChildren, index),
          hashOf,
          equal,
      )
  ```

- **H9** House text is formatted with Apply width limits on, and writes
  each kind of construct on one line or spread as the table below says.
  Canonical Layout §15 owns the table and its measure; this restates them.
  Format document spreads a construct on one line that is wider than its
  width limit, or whose kind is never on one line. The other half is made
  by hand, as H5's move is, since the formatter never joins lines: a
  construct within its width limit, or of a kind with no width limit, is
  written on one line wherever that line fits, even where it was written
  spread. For a call's arguments and a record, on one line means their
  brackets are; for a declaration, its braces or its alternatives
  (Canonical Layout §15.2). The house test holds house text to both
  halves, and names each construct in the wrong shape (#1602). (Canonical
  Layout §3.5, §12, §15)

  | Kind | On one line |
  |---|---|
  | A conditional, with or without `else` | up to 60 |
  | A loop with a one-line body | up to 60 |
  | A chain of two or more links, dot calls or `\|>` stages | up to 60 |
  | The arguments of a call or constructor, two or more | up to 60 |
  | A record literal | up to 60 |
  | A record declaration | up to 60 |
  | A union declaration | up to 60 |
  | A lambda | up to 60 |
  | A match arm | up to 80 |
  | An `and` or `or` expression | up to 80 |
  | An `else if` chain; a conditional that holds another conditional; a loop whose body is a loop or a conditional | never |
  | A vector, a tuple, a call with one argument, arithmetic and `++`, a function header, and anything not named here | no width limit: the line limit decides |

  A width limit counts the code points of the construct's own text as it
  would read on one line, with its tokens spaced as §7 of Canonical Layout
  spaces them and no trailing comma. Its indentation and the rest of its
  line do not count. A call counts its arguments alone; every other kind
  counts whole, from its first token to its last, a declaration's `export`
  and `derives` included. Each construct is held to its own row, so an arm
  whose body is a conditional stays on one line while the arm is within 80
  and the conditional within 60 (H7's example).

  A construct is still spread where something in it must be: a construct
  the table spreads, a block of two or more items, a `match` with its arms
  (H6), a comment that ends its line, or a string written over several
  lines. So is a lambda that ends a call or record the table spreads,
  keeping its head on that call's line (H7). An expression the table
  spreads runs on over further lines, so H5 puts it on a line of its own
  beneath its `=`, `:=` or `=>`, unless it is a lambda, whose head H7
  keeps where it stands, or begins with brackets that are then spread,
  which H11 opens on that line. A union whose alternatives stand beneath
  its `=`, one to a line, leads every alternative with `|`, its first
  included and a lone one too (Unions §2), as Format document writes it
  (Canonical Layout §16). An `else if` chain is spread however short, so
  `if a then 1 else if b then 2 else 3` takes six lines.

  ```
  let scale = if aligned > 1074 then 1074 else aligned

  let label =
      if count > 1000 then
          "many thousands of items"
      else
          "only a few items"
  ```

- **H10** A comment that ends a line has exactly one space before it: the
  house lines nothing up, comments included (H2). The whole line, comment
  included, fits within 100. Format document keeps the gap as written
  (Canonical Layout §8.3), and its own measure of a line leaves a trailing
  comment out (§9.2), so house text keeps both by hand. A note that would
  pass 100, or that needs more than one line, goes above its code as
  comments that begin their lines, at the code's indentation (Canonical
  Layout §8.2), filled to 100, and is never carried on in comments beneath
  the line it ends. Where the code has a doc comment, the note goes above
  the doc comment, which stays against its declaration. A comment that
  begins its line is not otherwise this rule's. (Canonical Layout §8.2,
  §8.3, §9.2)

  ```
  let total = subtotal + shipping -- before tax
  -- The rate is the one in force on the day the order was placed, not the day it ships, so an order
  -- placed before a change and shipped after it keeps the old rate.
  let taxed = total * rate
  ```

- **H11** A value's opening bracket goes on the line that introduces the
  value. A value that begins with an opening bracket, `(`, `[` or `{`,
  and whose brackets are spread over lines, begins after its `=`, `:=` or
  `=>`, or after a branch's `then` or `else`, and its opening bracket ends
  that line. Its contents go beneath, one level in, and its closing
  bracket begins the line after them, at the indentation of the line the
  opening bracket ends. The rest of the expression may follow the closing
  bracket on its line, as in `).gcd(s)` and `])`, while an `else` still
  begins a line of its own (F3). The opening bracket has a line to join,
  and the closing bracket has none: at the end of the last item's line it
  would leave that item no trailing comma (H8), and nothing would show
  where the value ends. Three things begin a line with nothing before
  them to join: an arm's pattern; a statement of a block, unless it is
  the whole of a value or branch after `=`, `:=`, `=>`, `then` or `else`;
  and an item that begins a line of its own between open brackets, unless
  it is their only item and is itself a vector, a record or a tuple,
  which opens and closes with them (Canonical Layout §9.4 rule 2). Where
  one of them begins with an opening bracket, that bracket begins its
  line and may stand alone there: one item to a line outranks keeping an
  opening bracket off a line of its own (Canonical Layout §5.1–§5.2,
  §9.4).
  A value that begins otherwise, such as
  `Map.fromVector([`, has more than a bracket on its first line, and runs
  on beneath its `=` as H5 says (H5's example); so does a value whose
  first brackets open and close on one line, such as `(a + b)` carried on
  at an operator. Format document writes this shape where it moves a
  value itself, but leaves a value the author began beneath its `=` there,
  since it never joins lines, so that value's brackets may open beneath
  it; house text makes the move by hand, as it does H5's. (Canonical
  Layout §5.1–§5.2, §9.4, §13, §14)

  ```
  let reservation = {
      guest = "Mira Castellanos",
      seats = 3,
      table = Some(tableFor(party)),
  }

  let settings =
      if compact then
          {width = 40, margin = 1}
      else {
          width = preferredWidth(screen),
          margin = 4,
          title = Some("Full report"),
      }

  let n: BigInt = (
      if c then
          let z = p.add(q)
          z.abs()
      else
          p
  ).gcd(s)
  ```

---

*Companion: `canonical-formatting-plan.md` holds the rollout plan and the
fuller rationale for §2's boundary doctrine; this file is the distilled
per-segment check.*
