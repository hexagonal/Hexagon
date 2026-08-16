# Manuscript Continuity

This is the book's living continuity record. Consult it before planning or drafting a
chapter, update it when a chapter establishes something global, and use it during every
revision pass.

## Principal risk

The principal risk is **manuscript drift**: terminology, syntax, teaching order,
examples, inferred types, emitted JavaScript, and generated `.d.ts` output may each be
locally plausible while quietly contradicting another chapter or weakening the book's
overall explanation.

This is not deferred to a final copy-edit. The book should be written incrementally,
with frequent returns to its global commitments. Extra time spent checking continuity
is part of the work, not schedule overrun.

## Continuity practice

For each chapter:

1. read this record and the relevant earlier chapters before planning;
2. identify which established concepts the chapter uses, extends, or qualifies;
3. verify syntax, inferred types, JavaScript, and `.d.ts` examples against the
   specification and against earlier examples;
4. prefer deliberate callbacks to silently re-explaining an idea with different words;
5. record any new global terminology, convention, example, or promise here; and
6. propagate a changed decision through every affected chapter immediately.

After each small group of chapters, perform a continuity pass across the manuscript so
that contradictions are found while their context is still fresh.

Near the end of drafting, perform a separate **pedagogy pass** from the perspective of a
reader encountering Hexagon for the first time. Verify that every chapter depends only
on ideas already taught, and reorder dependent ideas toward the end where necessary.
Drafting order is not final reading order.

## Global commitments

- **Hexagon is an ML dialect that targets JavaScript** (#147, 2026-07-29 — the doctrine
  pivot that opened Draft 3). The book presents it as a member of the ML family whose
  compilation target is JavaScript, in the posture F# takes with Fable — not as a
  JavaScript-shaped language with types added. Readable emitted JavaScript and honest
  declarations are real achievements worth showing the reader, and the output chapters
  should show them; they are outcomes the compiler pursues, never the reason the
  language behaves as it does. Where an explanation reaches for a justification, the
  ML-family answer is the one to give, and a JavaScript-specific answer needs a
  JavaScript-specific fact behind it (zero-cost representation at the boundary, n-ary
  parameter passing, literal emission into JavaScript source). Phrases of the form
  "what a TypeScript author would hand-write" are retired as justifications.
- **The book's "primitive types" are defined by JavaScript representation** (#158,
  ruled 2026-07-30; the ruling is issue #158's comment 5127946331). In the book,
  *primitive types* means Hexagon types whose values compile to JavaScript primitive
  values: `Nat`, `Int`, `Float`, `Bool`, `String`, `BigInt`, `Unit`. The definition
  appears at first use in Primitive Types, and the book never uses "primitive" in the
  spec's type-system sense — where the classification difference matters, a chapter
  points at the owning chapter instead of asserting it in its own voice (`Bool` →
  Unions, `Unit` → Tuples). `Exn` is out: an `Error` object is not a JS primitive, and
  Exceptions owns it. This deliberately diverges from `spec/primitive-types.md`, whose
  term of art now covers five types (#147, #159); the divergence is recorded here,
  once, and nowhere else.
- The specification is normative; the book is explanatory.
- For planning and drafting, assume the specification is complete. If it changes,
  update affected book material at that time.
- Hexagon source, emitted JavaScript, and generated TypeScript declarations must tell
  the same story.
- Introduce a term once, use it consistently, and distinguish deliberate teaching
  simplifications from later qualifications.
- Record deliberately defined technical terms in `INDEX-CANDIDATES.md` as chapters are
  written. The final index should identify principal definitions and significant later
  discussions, not every occurrence.
- Examples must remain valid when reused or extended. A callback inherits the facts
  established by its earlier appearance.
- The book teaches the language and the ideas exposed by its standard library; it is
  not a library API catalogue.
- Prefer short, familiar noun or noun-phrase chapter titles. Add qualification only
  when it distinguishes the chapter from another central concept.
- Use **Summary** for the closing recap of each chapter. Prefer this familiar heading
  to instructional phrasing such as “What to carry forward.”
- Do not put numbered version labels in the book. State current behavior as the
  language's behavior. When a future possibility genuinely helps the reader, say that
  it may appear in a later version.

## Pending specification propagation

- **Contextual Int widening:** before the next explanatory book revision, teach that an
  established `Int` expression may widen through `Signed<a>.fromInt` when an annotation,
  operand, argument, branch, assignment, or already-constrained type variable
  independently establishes `a: Signed`. Use the banana calculation as the opening
  example: `count: Int`, `cost: Float`, and `count * cost : Float`. Contrast it with
  `count + count : Int` (exact matching wins), show generic `Int + a` becoming
  `dictSigned.fromInt(count) + value`, and explain that widening never manufactures
  polymorphism. Propagate the rule through Primitive Types, Operators, Polymorphism,
  Constraints, JavaScript Output, and Constraints in JavaScript; do not edit the
  generated whole-book draft independently of its chapter sources.

## Held front-matter decision

- Keep the **Introduction** small. It should contain a brief liveliness/story section
  followed by a compact introduction to the Hexagon language.
- Do not make that Introduction carry practical setup, root-module execution, and the
  first working program as well.
- Hold a separate **Getting Started** chapter as the likely new Chapter 1. It would
  provide the practical first contact and the minimal early module orientation needed
  by the existing feature chapters.
- The current 27 chapter files retain their numbers until that structural revision is
  undertaken deliberately; adopting Getting Started will shift them by one.

## Recurring examples and lively material

Record recurring examples, motifs, voices, and other lively material here when they are
designed. Repetition should create recognition and payoff—like a running joke or a
returning character—not accidental duplication. Each callback must remain consistent
with the technical and narrative facts established earlier.

The full first draft is followed by a dedicated liveliness pass. Do not require each
chapter's first draft to solve this locally. The working brief is
`LIVELINESS-PASS.md`.

- Leading story candidate: Lancelot, a Knight of the Round Table, must undertake a
  quest to defeat a dragon. Afraid of the unknown, he has only read about dragons in
  *The Dragon Book*. Merlin helps him learn the magical language Hexagon.
- The language's **constraint** and **honor** vocabulary provides a natural knightly
  resonance. The story may extend into quests, spells, inventories, parties, uncertain
  dangers, and pattern-matched dragons where those examples genuinely teach well.
- Move away from repeated accountancy examples during the later pass. Prefer examples
  that are a little sillier, memorable, and still immediately understandable.
- Treat the story as a source of recurring recognition rather than a theme imposed on
  every example. Specialist allusions must remain optional.

- `winGame implies getPizza` is the canonical implication example. Explain it as a
  promise: winning requires pizza; not winning makes no demand. A later callback may
  return to the pizza promise when it creates recognition or payoff.
- `dishes |> rinse |> wash |> dry` is the canonical pipe chain. Read it as a familiar
  left-to-right process; do not require associativity terminology.

## Pedagogical dependencies

Record what each drafted chapter assumes and what it prepares. This is evidence for the
late pedagogy pass, not a commitment to the current order.

### Expressions

- Assumes only general programming experience.
- Lightly previews function headers, `Int`, arithmetic, `Order`, exports, and type
  annotations as scaffolding; these must remain locally understandable before their
  dedicated chapters.
- Establishes bindings, expressions, blocks, final-expression results, `Unit`, and
  deliberate discarding for later chapters.
- Its JavaScript and `.d.ts` comparison assumes basic familiarity with those languages,
  matching the book's intended reader.

### Primitive Types

- Assumes the distinction between expressions and bindings and the established role of
  `Unit`.
- Lightly previews conditions, comparisons, numeric constraints, interpolation through
  `Show`, conversion, string indexing, and companion-module operations.
- Establishes the seven primitive types under the book's boundary definition (#158),
  their literal distinctions, and their native JavaScript/TypeScript faces for use
  throughout the book. `Bool` and `Unit` hold their rows by representation, each with
  a classification pointer: `Bool` is the prelude union met properly in Unions and
  introduced here only as far as conditions require; `Unit` is the empty tuple, met
  properly in Tuples.
- Prepares operator semantics, type inference, constraints, FFI, and collections.

### Functions

- Assumes expressions, bindings, blocks, primitive values, `Unit`, and the light
  conditional/arithmetic syntax already previewed.
- Lightly previews constraints, pipes, dot calls, and polymorphic
  generalization.
- Establishes lambdas, n-ary arity, calls, annotations, declared type variables
  as rigid definition contracts, subject-first order, the `let`/`fun`
  distinction, and recursion.
- Prepares type inference, operators and pipes, patterns, constraints, and modules.

### Operators

- Assumes primitive numeric distinctions, `Bool`, `String`, `Unit`, functions, blocks,
  n-ary calls, and subject-first parameter order.
- Lightly previews capability constraints, exceptions, ranges, indexing, assignment,
  and structured order data.
- Establishes the fixed operator vocabulary, comparison chains, word-based logic,
  expression-valued `if`, and first-argument pipe behavior.
- Completes the first four-chapter group and prepares type inference, constraints,
  loops, collections, and mutation.

### Layout

- Assumes the established block-final-value rule and familiar function/conditional
  forms.
- Establishes indentation as the only block syntax, same-line bodies, braces as records,
  semicolons as separators, leading-space discipline, and nested comments.
- Prepares every later layout-bodied declaration and the record chapter.

### Polymorphism

- Assumes functions, primitive types, operators, `ignore`, annotations, and recursion.
- Establishes inferred relationships, let-polymorphism, monomorphic lambda parameters,
  the value restriction, numeric defaulting, and monomorphic recursive calls.
- Lightly previews `Show`; prepares constraints and every later generic data type.

### Tuples

- Assumes inference, functions, primitive types, conditionals, and sequential `let`
  bindings.
- Establishes positional compound values, `itemN`, tuple destructuring, `_`, tuple
  returns, and the tuple-versus-arguments distinction deferred from Chapter 3.
- Prepares aliases, pattern matching, and structural products.

### Type Aliases

- Assumes tuples, type annotations, module-level exports, and inferred type variables.
- Lightly previews records, unions, constraints, and exceptions only to establish their
  related declaration shapes.
- Establishes transparent naming, parameterized aliases, full application,
  non-recursion, module-level placement, forward references, and boundary erasure.
- Completes the second four-chapter drafting group; its review is recorded in
  `reviews/02-types-and-structure.md`.

### Records

- Assumes tuples, inference, annotations, spread-shaped JavaScript objects, and simple
  `let` patterns.
- Establishes structural record literals/types, field access, construction punning,
  updates, open record requirements, `...` annotations, and plain-object emission.
- Introduces **row polymorphism** only after showing the useful behavior in ordinary
  code, then contrasts structural shape directly with nominal identity.
- Establishes record constructors, identity-preserving updates, the explicit
  `{...value}` structural crossing, parameterized records, and the ordinary exported
  boundary.
- Prepares constructor patterns, deriving, constraints, and dot calls.
- Opacity is deliberately deferred to the modules chapter, where exports, privacy,
  home modules, opaque records, and opaque unions can be taught together.

### Unions

- Assumes nominal declarations, functions and arity, type parameters, layout, and
  expression-valued control flow.
- Establishes closed alternatives, nullary and payload constructors, basic exhaustive
  `match`, recursive unions, `Option`, `Result`, `Bool`, tagged-object emission, and the
  all-nullary string representation.
- **`Bool` is taught here, not in Primitive Types** (#147): the prelude union
  `False | True`, ordinary in declaration, matching, exhaustiveness, and derivation, with
  one compiler privilege — its representation is pinned to the JavaScript `boolean`, the
  single exception to the all-nullary string rule, and unavailable to any user
  declaration. The pin is what licenses the logic operators and `if`/`while` conditions
  to eliminate a `Bool` without `match`; Operators carries the forward half of that.
- Prepares the full pattern language, exceptions, deriving, collections, and FFI
  conversions.

### Patterns

- Assumes tuples, structural and nominal records, unions, Boolean conditions,
  comparison chains, and simple destructuring.
- Establishes nested structural patterns, literals, or-patterns, as-patterns, guards,
  exact exhaustiveness/reachability, irrefutability, and patterned parameters.
- Completes the third three-chapter drafting group. Its review is recorded in
  `reviews/03-data-shapes-and-patterns.md`.

### Constraints

- Assumes polymorphism, operators, interpolation, nominal declarations, and only the
  light earlier preview that declarations live in modules.
- Establishes constraints, instances, default operations, `honor`, base constraints,
  coherence, the orphan rule, and the core prelude capability vocabulary.
- Introduces dictionaries as small operation objects only after ordinary concrete
  constraint use is understood; concrete calls remain direct.
- Prepares derivation, collection capabilities, implied types, and the final
  constrained JavaScript boundary.

### Derivation

- Assumes the complete constraint/instance model and nominal records and unions.
- Establishes the equivalent `derives` and `honor ... = derive` forms, structural
  meanings for `Eq`, `Ord`, `Show`, and `Hash`, and the conditions propagated from
  contained types.
- Prepares hashed collections while preserving the distinction between generated
  structural behavior and hand-written domain behavior.

### Modules

- Assumes module-level declarations and exports as light previews throughout the book,
  plus constraints, instances, derivation, nominal records/unions, and top-level
  `Unit` expressions.
- Establishes one-file/one-module identity, privacy by default, named/aliased/namespace
  and effect imports, named exports, module aliases, companion modules, prelude
  occlusion, acyclic loading, selected roots, and direct ESM emission.
- Introduces **opacity** for records and unions after privacy and home modules are
  available. Opacity hides structure but not lawful capabilities.
- Establishes that modules are namespaces rather than values and that Hexagon has no
  language-level `main` or mutable module cells.
- Prepares Dot Calls by establishing home modules, companion modules, exported
  subject-first operations, and qualified lookup.

### Dot Calls

- Assumes subject-first functions, pipes, nominal and structural records, constraints,
  and companion modules.
- Establishes qualified, pipe, and dot spellings as the same underlying call, with an
  independently known receiver type and explicit field/operation collision handling.
- Keeps constraint operations separate from companion lookup and preserves direct
  JavaScript function emission.
- Completes the capabilities-and-calls sequence recorded in
  `reviews/04-capabilities-and-calls.md`.

### Mutable Variables

- Assumes immutable bindings, `Unit`, block typing, functions, inference, record
  updates, and lambda capture.
- Establishes `var`, `:=`, monomorphic mutable bindings, name-only assignment, the
  lambda boundary, and immutable snapshots.
- Prepares loop accumulators while preserving the absence of mutable module state,
  fields, reference cells, and public mutable APIs.

### Loops and Ranges

- Assumes local mutation, `Bool`, blocks, comparison, `Unit`, patterns, constraints,
  and a light preview of `Seq(a)`.
- Establishes `for`, `while`, inclusive integer ranges, descending ranges, irrefutable
  loop patterns, static iteration resolution, and native-loop emission.
- Keeps implied types and user-defined `Iterable` machinery deferred. Reusable
  consumers take `Seq(a)` so the element type remains explicit.

### Sequences

- Assumes loops, ranges, `Option`, tuples, pattern matching, lambdas, pipes, and
  subject-first companion operations.
- Establishes `Seq(a)` as lazy, immutable, and possibly infinite; `Seq.next` as a
  persistent functional cursor; transformation callbacks as pure by construction;
  and `Seq` as the common iteration and collection-conversion currency, reached from
  any iterable value by the bare `toSeq` member.
- Prepares persistent collections and the `Iterable` recipe while avoiding a library
  API catalogue. Opens the purity seam the Effects chapter closes: the strict
  consumers are named as the one honest seat for an effectful callback, marks
  deferred one chapter.

### Effects

- Assumes sequences (`fold` is the linked-arrow specimen), lambdas, blocks,
  subject-first companion operations, and Mutable Variables' rule that a lambda
  cannot capture an outer `var`.
- Establishes the two-point effect doctrine (observable world interaction; throwing
  excluded), the arrow trio `->` / `->?` / `->!` and the call trichotomy bare / `!` /
  `?` as one alphabet, glued marks, the linked signature and its inlet, face
  enforcement in both directions, the four unmarkable call forms and the purity they
  demand, the extern door with `pure` as the trusted claim, and erasure — colours
  never reach the emitted JavaScript.
- Introduces `extern from` blocks ahead of the JavaScript chapters, deliberately and
  lightly: effects need the world's door on stage, and the full boundary treatment
  stays deferred.

### Streams

- Assumes the effects discipline (arrows and marks), `Seq` and its purity posture,
  `Option`, and `Vector` as pure data.
- Establishes `Stream(a)` as `Seq`'s impure nominal sibling: no tail, a pull is
  spent, `next` wears `!`; wiring (`map`, `filter`, `fromSeq`) stays bare while
  consumption (`next`, `collect`, `fold`, `forEach`, `find`) is marked; `collect!`
  freezes a bounded sample into a `Vector` — the one bridge back to pure data.
- Establishes that `Stream` has no `memoize` and no `toSeq`, on purpose: replay is a
  purity privilege.

### Exceptions

- Assumes module-level declarations, unions, `Result`, the full pattern language,
  blocks, and JavaScript/TypeScript boundary representations.
- Establishes the open `Exn` type, exception declarations, construction versus
  throwing, expression-valued `try`/`catch`, implicit rethrow, `JsError`,
  `Result.attempt`, and branded `Error` emission.
- Completes the fifth four-chapter drafting group. Its review is recorded in
  `reviews/05-state-iteration-and-failure.md`.

### Collections

- Assumes persistent record updates, vectors previewed only through `Seq`, maps and
  sets previewed by constraints, one-based indexing, patterns, `Hash`, loops, and dot
  calls.
- Establishes persistent `Vector`, `Map`, and `Set` values; vector literals and
  patterns; asserting brackets versus total `get`; map insertion/replacement; set
  membership; honest
  `Hash` requirements; unspecified hash traversal order; and `Seq` conversions.
- Ends with the minimum `Iterable<Bag(a)>` recipe. `type Item = a` is read only as
  “iterating `Bag(a)` produces `a`”; the following chapter owns implied types.
- Keeps the chapter example-led and deliberately excludes an API inventory.

### Implied Types

- Assumes constraints, instances, coherence, the orphan rule, concrete iteration,
  `Seq(a)`, and the `Bag(a)` preview at the end of Collections.
- Establishes an **implied type** as a type member declared by a constraint and
  chosen by each instance.
- Establishes declaration-side `type Name`, instance-side `type Name = T`, multiple
  type members, exact-once binding, owner-relative identity and scope, and ordinary
  coherence/orphan behavior.
- Uses `Conversion` with `Input` and `Output` to show that the feature is general rather
  than special `Iterable` syntax.
- Establishes the deliberate restrictions: no external implied-type reference, no
  implied-type obligations, and no implied-type-bearing constraint on an
  otherwise unknown type variable. Reusable iteration APIs continue to use `Seq(a)`.
- Implied types erase and add no runtime or `.d.ts` member machinery.

### JavaScript Output

- Assumes every preceding runtime representation and gathers them without replacing
  the feature chapters that established their local rules.
- Establishes **erasure** as removal of compile-time distinctions that need no runtime
  representation.
- Reaffirms native primitive/function/tuple/record output, readable tagged unions,
  direct rewrites for pipes and dot calls, test-and-binding emission for patterns,
  trailing dictionaries only for genuinely generic code, and explicit runtime support
  where native JS semantics would be false.
- Makes preserved evaluation order, ESM identity, and the implementation/API
  distinction visible before the declaration chapter.

### TypeScript Output

- Assumes the emitted JavaScript representations and module export rules.
- Establishes `.d.ts` as the supported typed public surface rather than an attempt to
  reproduce the Hexagon checker.
- Reaffirms primitive, n-ary function, tuple, structural record, discriminated-union,
  `Seq`, collection, and exception faces; lowercase source generic binders; public
  alias preservation; and private alias expansion.
- Establishes TypeScript-only `unique symbol` brands for opaque records and unions,
  while the JavaScript value remains representation-direct.
- Defers the deliberate dictionary and specialization surface of constrained exports to
  its later chapter rather than emitting an inaccurate ordinary signature.

### JavaScript Input

- Assumes modules, ordinary imports/exports, all established runtime representations,
  exceptions, sequences, collections, JavaScript output, and TypeScript declarations.
- Establishes `extern from` bindings as checked declarations under a trusted foreign
  implementation contract.
- Establishes extern-block `fun`/`let` as contextual callable/value vocabulary (extern
  declarations have no bodies), and extern `let` as a stability assertion over the
  foreign value.
- Establishes representation-direct values, `Nullable(a)` as the explicit nullish
  door, `Array(a)` as a readonly borrowed view, and top-level `Seq(a)` as an adapted
  persistent sequence.
- Establishes `method`, `get`, `set`, and extern `class` as descriptions of JavaScript
  calling conventions that produce ordinary subject-first Hexagon functions.
- Establishes representation-direct callbacks, shallow conversions, the nested-adapter
  restriction, `JsError` propagation, and explicit decoding of uncertain `JsValue`.
- Prepares Constraints in JavaScript by separating ordinary direct/adapted boundary
  calls from the dictionary arguments required by generic constrained functions.

### Constraints in JavaScript

- Assumes constrained polymorphism, dictionaries, coherence, derivation, modules,
  readable JavaScript output, `.d.ts`, and the trusted FFI boundary.
- Establishes direct named specializations for every lawful combination of the closed
  fundamental set and retains unconstrained variables as generic binders.
- Establishes the source base name as the conditional generic function with stable
  trailing dictionary parameters.
- Establishes constraint-qualified branded dictionary types, constraint-owned
  fundamental handles, type-owned user handles, parameterized factories, and nested
  base constraint dictionaries.
- Establishes that public declarations and public capability determine the foreign
  surface; private types and internal call sites never do.
- Establishes generated names, dictionary-parameter order, dictionary shape, and public
  factories as ABI commitments.

## Established chapter material

### Expressions

- Core formulation: **expressions produce values; bindings introduce names**.
- Core block formulation: **the final expression is the value of the block**.
- `Unit` explains why effectful expressions may be sequenced before a block's result.
- `ignore(auditOrder(order))` is the first intentional-discard example.
- `orderTotal(subtotal, delivery)` is the first drafted explicit
  Hexagon/JavaScript/`.d.ts` comparison. It takes and returns `Int`; JavaScript and
  TypeScript represent these as `number`. Reconsider its “first comparison” framing
  after the Introduction is written.
- `prepareOrder(order)` prints before returning the unchanged order. If reused, `Order`,
  `auditOrder`, and `AuditReport` must retain the facts established in the chapter.
- The full head-binder/sequential-binder distinction is deliberately previewed but
  deferred until functions and patterns provide concrete examples.

### Primitive Types

- Primitive boundary table (seven rows, #158): `Nat`/`Int`/`Float` → `number`,
  `Bool` → `boolean` (by the Unions representation pin), `String` → `string`,
  `BigInt` → `bigint`, and `Unit` → `undefined` (`void` in TS return position; the
  empty tuple, #159).
- Bare integer literals normally default to `Int`; decimal-point and exponent literals
  are `Float`; the `n` suffix selects `BigInt`.
- `Int` is exact only in JavaScript's safe-integer range and direct arithmetic may
  silently round beyond it.
- `Bool` has no truthiness conversion.
- `Bool` is the prelude union `False | True`; `True`/`False` are its constructors and the
  only spellings. Lowercase `true`/`false` are reserved words that error with a fixit.
  `show(True)` and `"${flag}"` produce `True`/`False`, not the JavaScript lowercase form.
- `orderSummary` extends `orderTotal` and is the first interpolation example:
  `"Order total: ${total}"`.
- Interpolation is display through `Show`, not universal coercion. Full constraint
  teaching remains deferred.
- `"🙂 Hi!"` is the canonical codepoint example: five Hexagon codepoints, six
  JavaScript UTF-16 code units. `👍` is one codepoint; `👍🏽` is two codepoints but one
  perceived grapheme. Hexagon has no `Char`; one codepoint is represented by `String`.

### Functions

- Core formulation: **ordinary functions use `let`; recursion uses `fun`**.
- Header definitions and explicitly bound lambdas are equivalent.
- Functions are genuinely n-ary; calls require parentheses and supply the declared
  number of arguments. Incomplete calls are errors.
- Define **arity** as the number of parts something takes and **n-ary** as “having *n*
  parts” when those terms first appear in Chapter 3; functions then make that concrete
  as a count of arguments.
- `withStandardDelivery = subtotal => orderTotal(subtotal, 5)` is the first adapting
  lambda and continues the order example. Explain it concretely as
  `withStandardDelivery(80)` → `orderTotal(80, 5)` before naming currying or partial
  application.
- `auditOrder(order) |> ignore` is the first pipe spelling and deliberately returns to
  Chapter 1's canonical discard example before multi-argument pipe insertion is shown.
- `factorial` is the canonical direct-recursion example. `isEven`/`isOdd` are the
  canonical mutual-recursion pair and must handle negative as well as positive `Int`
  values by stepping toward zero from either direction.
- Subject-first parameter order is introduced here and should recur in pipes,
  dot calls, constraints, and collection examples.
- A declared type variable such as `value: a` is a polymorphism firewall: it may
  collect inferred constraints but cannot collapse silently to a concrete type.
  An unannotated parameter remains flexible and may infer that concrete type.
  **Rigid** is established here as the bolded technical term for this (#317);
  `takesInt`/`inferred`/`rejected` is the canonical trio, and the Polymorphism
  chapter owns the deepening (constraint accumulation, the OCaml/F# contrast).
- `chooseFirst(first: a, second: a): a` is the canonical shared-type-variable example
  and is written binder-free: the first annotation introduces the variable, and a
  bare `<a>` binder is never written (S3 canon). Angle-bracket binders are previewed
  here as the constraint-attachment position only (`display<a: Show>`), with their
  meaning deferred to the Constraints chapter.
- JS emission convention established: `let` function → `const` arrow; `fun` → hoisted
  function declaration.
- Reader-facing capture rule: **captured values must be ready**. Keep temporal-dead-zone
  and capture-analysis explanations in specification/compiler material.
- Generalization, the value restriction, lambda-parameter monomorphism, and constrained
  functions are previewed but remain owned by later chapters.
- Monomorphic recursive calls and the rejection of polymorphic recursion are deferred
  entirely to the type-inference chapter.

### Operators

- Fixed vocabulary: symbols for algebra/comparison, words for logic; no user-defined
  operators.
- `/` is fractional. Integer `div`/`mod` are Euclidean; `quot`/`rem` are truncated,
  with `rem` matching JavaScript `%`.
- `0 <= discount <= 100` is the canonical comparison chain. Chain operands evaluate
  once; directions cannot mix; `!=` does not chain.
- `and`, `or`, and `implies` short-circuit; `iff` evaluates both operands.
- Teach `implies` through the promise `winGame implies getPizza`, not through the formal
  rewrite `not left or right`.
- Every `if` requires `then`; an effect-only (`Unit`) conditional may omit
  `else` (sugar for `else ()`), while a value-producing conditional states both
  branches. Multiline conditionals keep `then` on the condition line and indent
  each written branch.
- Canonical pipe continuation:
  `subtotal |> applyDiscount(discount) |> orderTotal(delivery)`. Pipe means
  first-argument insertion and relies on the subject-first convention.
- Canonical bare-function pipe chain: `dishes |> rinse |> wash |> dry`, equivalent to
  `dry(wash(rinse(dishes)))`.
- `-2 ** 2` means `-(2 ** 2)` and evaluates to `-4`.
- The chapter closes the first drafting group. Its review is recorded in
  `reviews/01-opening-foundations.md`.

### Layout

- Core formulation: **indentation is the block syntax**.
- Same-line bodies contain one expression; indentation is required for multiple items.
- Braces always begin records and never delimit blocks.
- Semicolons separate items at the same block level; they are not statement
  terminators and never open a body.
- Leading indentation contains spaces only. Line comments use `//`; block comments use
  nestable `(* ... *)` (#171 — the ML spelling; the JS spellings `/*` and `*/` are
  detected and redirected). `(** ... *)` is the documentation comment (#191): it
  attaches Markdown docs to the following declaration and flows to JSDoc; a doc
  comment that documents nothing is an error; `///` has no special meaning.

### Polymorphism

- `identity` used at `Int` and `String` is the canonical let-polymorphism example.
- `useAtTwoTypes(f)` uses `ignore(f(1))` before `f("hello")` to show that one lambda
  parameter cannot change type within a call.
- `makeIdentity()` is the canonical fixed-variable example: `a` appears on both sides
  of the returned function's arrow, so the binding holds one function of one type and
  a use fixes which. Written with an explicit signature (`let makeIdentity(): (a -> a)`)
  so the reader can see both occurrences.
- **Do not put `// error` on the second call.** The compiler currently reports the
  conflict against the *first* use, which #206 owns; the prose says the pair is
  rejected rather than naming a line the reader would not find it on.
- `Seq.empty` bound as `nothing` and reused at two element types is the canonical
  reference-is-a-value example (#205), and `makeEmpty(): Vector(a)` bound as `blank`
  is the canonical computed-but-still-reusable one.
- State the conceptual hinge explicitly: a value initializer is generalized in full,
  and a computed one is generalized in the parts nothing could have filled — a
  variable is fixed when the value could *consume* it, or when it carries a
  capability that was chosen while the initializer ran.
- The rationale is **not** mutation or foreign state. Hexagon has no mutable cells
  and no foreign function returns a type with a variable in it; what the restriction
  protects is the promise that an initializer runs exactly once (#205).
- Bare numeric literal defaulting is one-way to `Int`; explicit context may instead
  select another numeric type.
- Polymorphic recursion is rejected and taught here, after ordinary recursion and
  generalization are available.
- **Type hole** is established here as a bolded technical term, and **rigid**
  (established in Functions, #317) is deepened here: the shape claim holds while
  constraints still attach as the body demands (`increment(value: a) = value + 1`
  stays general). The OCaml/F# contrast — silent narrowing there, contract here —
  lives in this chapter. The rigid section calls back to Chapter 3's `rejected`
  rather than re-showing the trio.
- `identity` is written binder-free (`let identity(x: a): a = x`); `<...>` binders
  appear in this chapter only where they carry a constraint (S3 canon).
- A type hole `_` is an ordinary inference position inside a written annotation;
  `padded(entries: Vector(_)): Vector(Int) = entries.append(0)` is the canonical
  partial-claim example — chosen because its body *fixes* the element, the one
  position where a hole is canonical: a hole is never written where a type
  variable would hold (S12); `Vector(a)` is the canonical generic spelling. And
  `let answer: _ = 42` (fine, `Int`) versus `let general: a = 42` (error) is the
  canonical proof pair. **Written is claimed, unwritten is inferred** is this
  chapter's unifying formulation, restated in its Summary. A whole-annotation hole is legal but canonical
  Hexagon omits it; exported signatures never contain holes.
- A **constrained hole** extends `padded` to `Vector(_ : Num)` (#326): the written
  list is a floor the filled type must satisfy, never a ceiling, and the
  claim-ladder — variable over-claims, bare hole under-claims, constrained hole is
  the strongest true claim — is taught on the same example. "Write the strongest
  claim that is true" is the chapter's style rule for choosing among the three.
- The **complementary split** is taught here: a named variable gathers its
  constraints at the binder (`clamp<a: Ord>` — four positions, one statement),
  a hole carries its constraints inline; `Vector(a : Num)` is a parse error and a
  binder list cannot name a hole. `clamp` joins `display` as a provisional
  constraint preview deferring mechanism to the constraints chapter.

### Tuples

- `("Mira", 3)` is the first tuple: one `(String, Int)` value.
- A tuple never has exactly one position: `(x)` is grouping, and `()` is the empty
  tuple, better known as `Unit` (#159). The positional tuples the chapter teaches
  start at two.
- `itemN` is one-based in Hexagon and emits zero-based JS indexing.
- `minMax` is the canonical tuple-return example.
- `move(3.0, 4.0)` versus `move(coordinates)` pays off the deferred distinction between
  two arguments and one tuple value.
- `_` in a tuple pattern binds nothing and is distinct from the `ignore` function.

### Type Aliases

- `Coordinates = (Float, Float)` is the canonical transparent alias.
- `Entry(k, v) = (k, v)` is the canonical parameterized alias.
- `UserId` and `OrderId` demonstrate that aliases name but do not create identity.
- Aliases are fully applied, use every parameter, cannot be recursively expanded, and
  emit no JavaScript.
- Public useful alias names may remain in `.d.ts`; private aliases in public signatures
  expand rather than leak private names.
- Chapter 8 closes the second drafting group. Its review is recorded in
  `reviews/02-types-and-structure.md`.

### Records

- `reservation = {guest = "Mira", seats = 3, confirmed = False}` is the first structural
  record and grows naturally from Chapter 7's tuple example.
- Core reader rule: a function that reads particular fields can accept records
  containing at least those fields.
- **Row polymorphism** names that inferred flexibility only after the behavior is
  concrete. An annotation without `...` is closed; `...` permits additional fields.
- `{record with field = value}` is an update, not field addition; `with` is contextual, at
  least one override is required, and the head is a name or dotted path. `{...record}` is
  the bare shallow copy — the only surviving spread — and a spread carrying overrides, or
  two spreads, is a parse error with its own fixit.
- Construction and pattern punning use `{field}` for `{field = field}`.
- Core contrast: `type` gives a shape another name; `record` creates a distinct
  identity.
- `UserId`/`OrderId` demonstrate nominal separation; `Point` demonstrates the explicit
  structural crossing `Point({...})` in and `{...point}` out.
- A spread with overrides preserves nominal identity; a spread alone crosses to the
  closed structural record.
- Do not introduce `export opaque` here. Opacity belongs to the modules chapter and
  should cover records and unions together, including the TypeScript-only branded
  boundary face.

### Unions

- `DeliveryStatus = Pending | Dispatched(tracking: String) | Delivered` is the first
  union; `displayStatus` is the first exhaustive match.
- Nullary constructors are values without `()`; payload constructors follow ordinary
  n-ary function rules. Construction and patterns remain positional.
- `Option(a) = Some(value: a) | None` represents absence and does not erase to
  `a | undefined`.
- `Result(a, e) = Ok(value: a) | Err(error: e)` places success first and represents
  recoverable failure.
- Mixed/payload unions emit tagged POJOs; all-nullary unions emit string literals.

### Patterns

- Core formulation: **a pattern describes a shape and may bind names; a guard performs
  a runtime test**.
- Structural patterns nest. Record patterns are open and use no `...`; nominal records
  cross through constructor patterns such as `Point({x, y})`.
- Literal patterns admit `Int` and `String`, never `Float`. `True`/`False` are
  constructor patterns, and a `match` over both is exhaustive by ordinary closed-union
  checking, not by a finite-literal-domain rule.
- `()` is the sole `Unit` pattern and covers `Unit` exhaustively.
- Or-pattern alternatives bind the same names; as-patterns retain the whole value.
- Guards contribute nothing to exhaustiveness. Missing and unreachable cases are hard
  errors.
- **Irrefutable** means a pattern matches every value of its known type; only such
  patterns may appear in `let`, loop, and parameter binding positions.
- `(x, y) =>` remains two parameters; `((x, y)) =>` is one tuple-destructured
  parameter.
- **A `match` with nothing after it on the line is a function** (#505) — the unary
  function matching its argument, taught as the answer to the irrefutability gate in
  callback position. It *means* `x => match x` with those arms; exhaustiveness is
  demanded over the parameter type; the disambiguation is one token; it is a lambda
  literal, so `fun f = match` line-final is the recursive-matcher spelling; and it takes
  no `catch` clause (Chapter 21 carries the one-line callback).
- Vector patterns, loop patterns, and `catch` patterns are taught with collections,
  loops, and exceptions respectively as extensions of this same grammar.
- A lowercase pattern name binds, `_` ignores, and a name cannot be bound twice within
  one whole pattern.
- Chapter 11 closes the third drafting group. Its review is recorded in
  `reviews/03-data-shapes-and-patterns.md`.

### Constraints

- Assumes generic functions, explicit type-variable binders, operators, interpolation,
  nominal declarations, and modules only at the light “declaration has a home” level.
- Establishes constraints as type obligations, `honor` declarations as their answers,
  instances, base constraints, coherence, the orphan rule, the core prelude capability
  vocabulary, and dictionary erasure.
- Constraint operations without bodies are required; operations with bodies are
  inherited defaults that an instance may override. `Eq.equals` is required,
  `Eq.notEquals` defaults to its negation, and `!=` calls `notEquals`.
- `Area`/`Rectangle` is the canonical user-defined constraint and instance.
- Exported functions write maximal constraint contracts explicitly; private
  functions infer constraints. A body may not silently strengthen a written
  constraint list, and entailed base constraints are never restated.
- Constraint members are direct functions, never dot-call companion operations.
- Uses the final `honor` spelling throughout; older `implement` text in superseded spec
  passages must never leak into the book.
- Prepares deriving, collections, loops, and constrained exports.

### Derivation

- Assumes nominal records/unions and the full constraint/instance model.
- Establishes opt-in `derives` before `=`, and the equivalent
  `honor Eq<Point> = derive` core form.
- `Eq`, `Ord`, `Show`, and `Hash` are the derivable capabilities. `Ord` requires
  `Eq`; user-derived `Hash` requires a derived `Eq` and cannot be hand-written.
- Deriving `Eq` generates required `equals`; `notEquals` is inherited from the
  constraint default. Automatic structural instances complete defaults the same way.
- Structural tuples and records receive conditional structural capabilities
  automatically; nominal types opt in.
- Prepares hashed collections while keeping detailed collection mechanics deferred.

### Modules

- Core formulation: **a file is a module, and a module is a file**. There is no module
  header.
- Declarations are private by default. Hexagon has named exports only and no default
  export or re-export syntax in the current language.
- Four import forms are established: named, aliased named, namespace, and effect.
  Relative paths omit `.hex`.
- Module aliases are uppercase namespaces, never values. The same spelling may name a
  type/constructor and its companion module because positions select namespaces.
- `export opaque` is limited to nominal records and unions. It exports only the type,
  hiding record fields/constructor or union constructors outside the home module.
- A parameterized opaque type declares variance with `+a` / `-a`, verified against its
  representation at the declaration; a bare parameter claims nothing and behaves as
  invariant outside the module (#205). Transparent declarations take no sigil, and no
  use site ever carries one. `Box(a)` / `Box(+a)` is the chapter's worked pair, and
  `Sink(+a)` is its over-claim error — the quoted message is the compiler's exact text.
- Exported terms require complete annotations. Constrained exported functions write
  maximal constraint lists and omit entailed base constraints; private module-level
  function annotation remains a style convention.
- Private nominal types cannot appear in public signatures; private aliases expand.
- Instances are global once their module enters the import graph and are never
  imported/exported as source names.
- Imports are acyclic. Dependencies initialize depth-first before a module's top-level
  `Unit` effects; a host-selected root runs by ordinary ESM evaluation with no special
  `main`.
- One Hexagon module emits as one ESM module.

### Dot Calls

- Assumes subject-first functions, pipes, record fields, nominal types, constraints,
  and the complete home/companion-module account from Modules.
- Establishes the three equivalent spellings, type-directed companion lookup,
  exported subject-first eligibility, bare-dot field access, explicit collision
  resolution, and the independently-known receiver rule.
- Constraint members remain bare calls or pipes; dot-call syntax never searches
  instances.
- Dot calls erase to ordinary function calls and add nothing method-shaped to `.d.ts`.
- Constraints, Derivation, Modules, and Dot Calls have been reviewed as one sequence in
  `reviews/04-capabilities-and-calls.md`.

### Mutable Variables

- `var` is name-only, function-body-only, monomorphic, and never generalized.
- `:=` assigns only a bare `var` name, produces `Unit`, and cannot chain.
- Records, tuples, parameters, patterns, and `let` bindings remain immutable; record
  change uses an updated copy.
- A lambda may neither read nor assign an enclosing `var`; copying its current value to
  a `let` creates the canonical immutable snapshot.
- Emission is direct JavaScript `let` and assignment; nothing mutable reaches `.d.ts`.

### Loops and Ranges

- `for pattern in source` evaluates its source once; the pattern must be irrefutable
  and its binders are immutable head binders.
- `for`/`while` bodies and complete loop expressions have type `Unit`.
- `..` and `range` are inclusive ascending `Int` ranges; reversed bounds are empty.
  `rangeDown` is explicitly descending and follows the mirrored empty-range rule.
- There is no `break` or `continue`.
- Iteration resolves statically from a known outer type. Each concrete iterable has one
  element type, and `Seq(a)` is the reusable iteration parameter.
- The Patterns chapter's complete grammar supersedes the loops spec's original bare-name
  head: tuple, record, and other irrefutable patterns are legal.

### Sequences

- `Seq(a)` is the concrete lazy, immutable, possibly infinite iteration currency.
- `Seq.next : Seq(a) -> Option((a, Seq(a)))` does not consume the supplied position;
  traversal advances through the returned successor sequence.
- Transformation callbacks are pure by construction — `Seq.map` demands a pure
  function — so laziness never changes what the world observes. The strict consumers
  (`fold`, `forEach`, `find`, `any`, `all`) are the one seat for an effectful
  callback; their marks are deferred to the Effects chapter.
- Bare `toSeq(x)` is the universal conversion — the member of the prelude's
  `Iterable` constraint — and the per-collection `toSeq` spellings are its qualified
  reads; companion `toSeq`/`fromSeq` pairs connect collections without making the
  chapter an API inventory. `Seq.iterate` keeps its canonical seed/step producer
  name.
- `Seq(a)` faces JavaScript and TypeScript as `Iterable<a>`, with runtime adaptation
  preserving persistent sequence positions.

### Effects

- The tracked effect is observable interaction with the world; allocation, local
  `var`, and throwing are not effects. The lattice has two points, pure and impure,
  and purity is the silent claim.
- The arrow trio is `->` / `->?` / `->!` and the call trichotomy is bare / `!` / `?`
  — one alphabet: a call's mark reports the colour of the callee's outermost arrow
  at that call. Marks are written glued.
- Every `->?` in one signature is one linked effect variable; a `->?` needs an inlet
  and is an error where nothing can link to it — never a silent re-reading.
- Enforcement is symmetric and error-grade: wrong or missing marks at calls are
  errors in every direction, and a pure face over a body that performs effects is
  an error at the offending call. (The specification checks faces in both
  directions; the chapter stages the pure-face direction.)
- Operators, indexing, `for` heads, and interpolation have no mark seat, so
  everything they reach is pure; constraint members and `honor` bodies check pure.
- A user-written `extern fun` is effectful by default; `pure` is the trusted,
  believed-not-checked claim, with the specification's two narrow species. `extern
  from` appears here ahead of the JavaScript chapters, deliberately and lightly.
- Colours and marks erase; emitted JavaScript is identical with and without them.
  The purity guarantee leans on Mutable Variables' no-capture rule.

### Streams

- `Stream(a)` is `Seq`'s impure nominal sibling: `Stream.next : Stream(a) ->! Option(a)`,
  no tail, a pull is spent, and pulling an exhausted stream yields `None` again.
  (The chapter shows the companion face; the field's declared arrow is the
  specification's and the stdlib's.)
- Consumers (`next`, `collect`, `fold`, `forEach`, `find`) wear `->!` and their
  calls wear `!`; wiring (`map`, `filter`, `fromSeq`) builds without pulling and
  stays bare in ordinary bodies.
- `collect!` freezes a bounded sample into a `Vector(a)` — the one bridge back to
  pure data; `fromSeq` drives pure data in.
- There is no `Stream.memoize` and no `Stream.toSeq`, on purpose: replay is a purity
  privilege, and a sample exists only where the program collected it into data.

### Exceptions

- Predictable failure remains `Result`/union data; unpredictable failure uses the open
  `Exn` type.
- `exception` is module-level, has concrete payload types, and introduces first-class
  constructors. Construction is separate from `throw`.
- `try`/`catch` is expression-valued and uses the full pattern language, including
  module-qualified constructors in catch arms (`Vector.IndexError(i, s)`). Missing
  cases implicitly rethrow; unreachable arms remain hard errors.
- A `match` that begins its own line may take a `catch` clause at the head's column
  (#500). It is the same `catch` in a second seat, and its window is the *scrutinee's*
  evaluation alone — the contrast with `try match … catch`, which wraps the arms too,
  is the section's teaching point. Exhaustiveness stays with the data arms; a mid-line
  head takes no clause and rewraps by one indent; a scrutinee that cannot throw makes
  the clause a dead-code error.
- Throwing is not an effect: a pure function may throw and may catch. Chapter 21
  restates Chapter 19's cut in exception terms (`Int.div` stays pure-and-partial).
- There is no `finally`, by design; paired acquire-and-release is a future `use`
  binding's job, and the emitter keeps JS `try`/`finally` for internal lowering.
- `JsError` is the sole foreign-throwable door; ordinary catch/rethrow preserves the
  original foreign value.
- `Result.attempt : (() ->? a) ->? Result(a, Exn)` bridges exceptional computation
  back to data; linked arrows — the call is exactly as effectful as its thunk.
- Runtime values are branded JavaScript `Error` objects; the `$hex` brand names the
  declaring module, so identity is the (module, name) pair; nullary exceptions
  construct fresh values for useful stacks; exported faces are branded `Error`
  intersections.
- JS consumers discriminate with the generated `is` guards and `isHexError`; the
  recognized ``Throws `X` when <condition>.`` doc sentence derives `@throws` in
  emitted JSDoc.
- Chapter 21 (Exceptions) closes the fifth drafting group. Its review is
  recorded in `reviews/05-state-iteration-and-failure.md`. *(It was chapter 19 when
  that group was drafted; Streams took the number at the un-flagging milestone, #364,
  and the Effects insertion at #405 moved it again, to 21. The chapter is named here
  because the group is a fact about the drafting order, not about the numbers the
  manuscript ended up with.)*

### Collections

- Core formulation: **persistent means an update produces a new collection while the
  old value remains valid**; it does not mean automatic disk storage.
- `supplies = ["rope", "torch", "map"]` is the first collection example;
  `Vector.set(supplies, 2, "lantern")` demonstrates persistence and one-based update.
- `Vector` literals are homogeneous. Brackets assert presence and throw `IndexError`;
  `Vector.get` returns `Option`; `Vector.at` opts into signed addressing.
- Vector patterns use `...` for a rest. Fixed patterns partition by length; only
  `[...]` and `[...all]` are irrefutable vector shapes.
- `Map.fromVector` and `Set.fromVector` are the compact construction idioms. Map
  brackets throw `KeyError`; `Map.get` is total; `Map.set` inserts or replaces.
- `Map` and `Set` iteration order is deterministic for one value within one execution
  but is neither insertion/sorted order nor stable across executions.
- `Hash` is an explicit base constraint of `Eq`; nominal keys derive `(Eq, Hash)` so
  user hashing cannot disagree with equality.
- `Seq` is the collection conversion currency; every `fromSeq` is eager.
- `Bag(a)` briefly shows `type Item = a` and its member `toSeq` delegating to
  `Vector.toSeq`; the line is intentionally left for the immediately following
  chapter to explain.
- Persistent collection `.d.ts` faces are `Hex.Vector`, `Hex.Map`, and `Hex.Set`, not
  native mutable collection types.

### Implied Types

- `Iterable.Item` is the motivating implied type: the instance subject uniquely
  determines the item type instead of each caller choosing it.
- `Conversion<c>` is the general example and declares two members, `Input` and
  `Output`; `Conversion<ParsePort>` binds them to `String` and
  `Result(Int, String)`.
- Type members are owner-relative: two constraints may both declare `Item`, and neither
  claims a module-level type name.
- Every `honor` block binds every implied type exactly once; the binding may use the
  instance's type parameters and is in scope throughout that instance body.
- Implied types share the constraint instance's one coherence slot and orphan rule.
- External `Item(T)`/`Constraint.Item(T)` forms and `<c: Iterable>` binders are rejected;
  concrete operations and loops remain legal, while reusable consumers take `Seq(a)`.
- Implied types erase before JavaScript and TypeScript boundaries.
- Chapters 22–23 form the sixth drafting group. Their review is recorded in
  `reviews/06-collections-and-implied-types.md`. *(They were 20–21 when drafted;
  the Streams and Effects insertions moved them.)*

### JavaScript Output

- Core formulation: output tells the same story as the source while using helpers
  wherever superficially similar native JS would violate Hexagon semantics.
- **Erasure** removes annotations, aliases, and other compile-time distinctions that
  need no runtime value.
- Primitive values/functions stay native; tuples are arrays; records are POJOs;
  directly applied nominal constructors erase; mixed unions are tagged POJOs; and
  all-nullary unions are strings.
- Pipes and dot calls become direct function calls; matches become tests and bindings;
  derivation becomes ordinary generated operations.
- Genuinely generic constrained functions keep trailing dictionaries after their
  source parameters. Concrete uses stay direct.
- Persistent collections, persistent `Seq` positions, codepoint operations, and
  Hexagon exceptions use explicit runtime support rather than dishonest native forms.
- Single evaluation, left-to-right order, and the acyclic ESM graph remain visible.

### TypeScript Output

- Core formulation: JavaScript says how the module runs; `.d.ts` says what typed
  foreign callers are invited to use.
- Exported `let` functions retain the established `export declare const` callable
  shape; exported constructors are function-shaped where JS callers invoke them.
- `Unit` is `undefined` as a value and `void` as a function result. Hexagon-originated
  generic binders remain lowercase.
- Public aliases remain; private aliases expand. Ordinary exported nominal records
  expose honest structural POJO types and constructors.
- Mixed unions are discriminated TypeScript unions; all-nullary unions are string
  literal unions. Constructor exports match their runtime value/function forms.
- Opaque records/unions use private `unique symbol` brands in TypeScript, omit raw
  structure/constructors, and add no runtime wrapper.
- `Seq(a)` faces as `Iterable<a>`; collections use the `Hex` runtime type namespace.
- Declarations omit private and source-only machinery and do not attempt to encode all
  Hexagon checker guarantees.

### JavaScript Input

- Core formulation: **an extern declaration is checked; the foreign implementation is
  trusted to satisfy it**.
- `extern from` supplies named, aliased, default, type, value, and callable bindings;
  `extern import` supplies foreign effects.
- `Nullable(a)` is `a | null | undefined` and converts explicitly to `Option(a)` or
  `NullableCase(a)`.
- `Array(a)` is a zero-copy readonly borrow with a stability contract; conversions to
  `Vector(a)` and from `Seq(a)` are explicit and eager where they create ownership.
- Top-level `Seq(a)` receives one persistent memoizing adapter; hidden nested adapters
  and adapter-requiring callbacks are rejected.
- Foreign receiver calls, properties, and classes lower to subject-first companion
  functions; representation-direct callbacks retain function identity.
- Collection conversions are shallow; foreign throws use `JsError`; `JsValue` requires
  explicit checked decoding when a stronger invariant is wanted.

### Constraints in JavaScript

- The seven fundamental types form the closed named-specialization set. Each exported
  constrained function receives every lawful direct, dictionary-free fundamental
  edition.
- Specialization names append fundamental type names in declared constrained-variable
  order; unconstrained variables remain generic and add no suffix.
- The source base name is reserved for the generic function, which appears only when
  every required public dictionary is obtainable and at least one belongs to a
  non-fundamental type.
- `Constraint.Dictionary<a>` types expose completed member sets with TypeScript brands.
- Fundamental dictionaries are constraint-owned (Num.nat, `Signed.int`); user/runtime dictionaries
  are type-owned (`Rat.signed`); dependent dictionaries come from factories such as
  `Vector.show(Show.string)`.
- Dictionary parameters remain a stable trailing suffix, and base constraint
  dictionaries are nested.
- Public capability, never private implementation or internal calls, determines the
  JavaScript/TypeScript surface.
- Chapters 24–27 form the final feature-chapter drafting group. Their review is
  recorded in `reviews/07-javascript-boundaries.md`. *(They were 22–25 when drafted;
  the Streams and Effects insertions moved them.)*

## Review history

### Opening Foundations

- Chapters 1–4 reviewed together after their initial drafts.
- Result: coherent enough to continue; four small corrections integrated.
- Known pedagogy loops and later reconsiderations are recorded in
  `reviews/01-opening-foundations.md`.

### Types and Structure

- Chapters 5–8 reviewed together after reader review of the local drafts.
- Result: coherent enough to continue after correcting `chooseFirst`'s inferred type
  explanation and sharpening the value-restriction and arity definitions.
- Previews and later whole-book questions are recorded in
  `reviews/02-types-and-structure.md`.

### Data Shapes and Patterns

- Chapters 9–11 reviewed together after the structural and nominal record material
  was combined into one chapter.
- Result: coherent enough to continue after repairing the combined-chapter transition,
  stating the duplicate-pattern-binding rule, and completing the current pattern set
  with `Unit`.
- Later integrations and whole-book questions are recorded in
  `reviews/03-data-shapes-and-patterns.md`.

### Capabilities and Calls

- Constraints, Derivation, and Dot Calls were first reviewed together after the
  constraint-default design was completed; Modules was then inserted at Chapter 14
  and the four chapters were reviewed again as one sequence.
- Result: coherent enough to continue after correcting dictionary parameter order,
  sharpening derived record ordering and hashing language, and completing the
  transparent-alias rule for dot calls.
- A second pass after Modules was inserted defined home modules directly, aligned the
  import explanation with familiar ESM, and confirmed the four-chapter transition.
- Later integrations and whole-book questions are recorded in
  `reviews/04-capabilities-and-calls.md`.

### State, Iteration, and Failure

- Chapters 16–19 as then numbered (today 16–18 and 21) reviewed together after their
  initial reader review.
- Result: coherent enough to continue after making the lambda and loop-pattern examples
  self-contained, correcting the exported `Seq` declaration, simplifying chapter
  titles, and deferring implied types out of the ordinary loop narrative.
- Later integrations and whole-book questions are recorded in
  `reviews/05-state-iteration-and-failure.md`.

### Collections and Implied Types

- Chapters 20–21 as then numbered (today 22–23) were reviewed together after reader
  review of both local drafts.
- Result: coherent enough to continue after removing unnecessary **upsert**
  terminology and confirming the collection-to-implied-type hand-off against the
  governing specifications.
- Final-boundary promises and whole-book questions are recorded in
  `reviews/06-collections-and-implied-types.md`.

### JavaScript Boundaries

- Chapters 22–25 were reviewed together after reader review of the four local drafts.
- Result: the runtime-output, typed-output, foreign-input, and constrained-export
  sequence is coherent after clarifying checked BigInt conversion, fixed extern arity,
  JavaScript map-key identity, and generated multi-variable constraint names.
- The reader-facing constraint account now uses concrete dictionary-object vocabulary
  rather than type-theory **evidence** terminology.
- The heavier JavaScript Input chapter and final executable output checks are recorded
  for later passes in `reviews/07-javascript-boundaries.md`.

### Draft 1 Whole Book

- All 25 feature chapters as the manuscript then stood — before the Streams and
  Effects insertions — were read continuously after the seven group reviews.
- Result: the feature order and global language story are coherent; no wholesale
  chapter reorder is recommended.
- Clear drift corrections were integrated for transitions, title-based
  cross-references, dictionary vocabulary, dot-call receiver wording, displayed
  library types, the index ledger, and planning-document status.
- A short two-movement Introduction and a separate held **Getting Started** chapter
  now own orientation before the existing feature body.
- The complete findings and remaining pedagogy, liveliness, verification, and
  copy-editing work are recorded in `reviews/08-draft-1-whole-book.md`.
