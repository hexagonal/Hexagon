# Hexagon Feature Catalogue

**Status:** Draft 1 coverage. Each numbered item now corresponds to the chapter with
the same number; later passes may still revise boundaries and order.

This catalogue describes Hexagon from a programmer's point of view. It deliberately
groups related syntax and rules into things a reader can learn and use; it is not an
index of compiler phases or specification files.

For planning purposes, this catalogue assumes the language specification is finished.
If the specification later changes, affected book material should be updated then;
open specification work does not make the book outline provisional.

## Language foundations

1. **Modules** — Source files are modules. Imports are
   acyclic, top-level effects run in dependency order, and the selected root module
   runs without a special `main` function. Modules support named, aliased, namespace,
   and effect imports, plus public and opaque exports. Opacity is taught here for both
   records and unions, after privacy and home modules are established.

2. **Layout** — Indentation defines blocks; braces are records,
   not block delimiters. Semicolons can separate statements explicitly. Hexagon has
   `//` line comments and nestable `/* ... */` block comments, while doc-comment
   spellings are reserved for later tooling.

3. **Expressions** — Programs are built primarily from values
   and expressions. `let` introduces immutable bindings, blocks take the type of their
   final expression, discarded non-`Unit` values are errors, and `ignore` makes
   intentional discarding explicit.

4. **Primitive types** — `Int`, `Float`, `BigInt`, `Bool`, `String`, and
   `Unit` map directly to familiar JavaScript values. This includes interpolation,
   multiline strings, numeric separators, codepoint-based string operations, and the
   deliberate distinction between integer and floating-point semantics.

5. **Operators** — Arithmetic, comparison chains, word-based
   Boolean logic, concatenation with `++`, pipes with `|>`, precedence, and
   `if ... then ... else` form one coherent expression language. Integer division and
   remainder use Euclidean semantics; floating-point division follows JavaScript.

## Functions and types

6. **Functions** — Lambdas, `let`-bound functions, recursive `fun`
   declarations, mutual recursion, nullary functions, annotations, and explicit type
   parameters. Functions are genuinely n-ary: Hexagon has neither automatic currying
   nor partial application.

7. **Polymorphism** — Hindley–Milner inference usually removes the
   need for annotations. Let-polymorphism, the ML value restriction, monomorphic
   recursion, type-variable naming, numeric-literal defaulting, and useful annotations
   explain both the power and the boundaries of inference.

8. **Type aliases** — Parameterized `type` aliases are transparent,
   fully applied, non-recursive, and preserved where practical in displayed and
   generated types. Type, record, union, constraint, and exception declarations share
   predictable header and module-level rules.

9. **Tuples** — Fixed-size positional products support construction, `itemN` access,
   destructuring, inference, and structural constraint behavior, while remaining
   ordinary JavaScript arrays at runtime.

10. **Records** — Structural records support field access, punning, spread updates,
    and functions that accept any record containing the fields they use. Row
    polymorphism provides this flexibility without a general subtyping relation.
    `record` adds nominal identity, a constructor, identity-preserving updates, and an
    explicit structural crossing while retaining the same plain-object runtime shape.

11. **Unions** — Nominal sum types model alternatives with constructors and optional
    payloads. Their JavaScript representation stays readable, and the prelude's
    `Option` and `Result` provide central examples covering absence and recoverable
    outcomes.

12. **Patterns** — `match` supports constructor, tuple, record, literal,
    vector, wildcard, variable, or-, and as-patterns, plus guards and construction
    punning. Exhaustiveness and unreachable arms are compile errors, and refutable
    patterns are restricted in binding positions.

13. **Constraints** — Constraints such as `Eq`, `Ord`, `Show`, `Num`,
    `Frac`, `Integral`, `Concat`, `Pow`, `Hash`, and `Iterable` express capabilities.
    Operations may provide overridable defaults; `honor` declarations provide coherent
    instances under an orphan rule. Constrained polymorphism compiles through dictionary
    passing while concrete code remains direct.

14. **Derivation** — Nominal records and unions can opt into lawful,
    structural instances with `derives` and `derive`. This chapter should explain what
    can be derived, the resulting equality, ordering, display, and hashing behavior,
    and when a hand-written instance is appropriate.

15. **Dot calls** — `value.operation(args)` is
    type-directed sugar for a subject-first companion function such as
    `Type.operation(value, args)`. It adds familiar chaining without objects, method
    tables, or hidden runtime dispatch, and has explicit rules for field collisions.

## State, effects, and flow

16. **Mutable variables** — `var` and `:=` provide local mutable state without
    making mutation the default. Mutable cells cannot cross a lambda boundary, so
    closures do not capture changing local variables and the compiler need not perform
    escape analysis.

17. **Loops and ranges** — `for ... in`, `while`, ascending and descending
    ranges, irrefutable loop patterns, and `Iterable` connect imperative-looking loops
    to typed functional iteration. Loop bodies return `Unit`, and iterable resolution is
    static.

18. **Sequences** — `Seq(a)` is Hexagon's lazy, immutable sequence and the common
    currency between collections. Its functional cursor supports effects and external
    iteration without exposing mutable JavaScript iterators as the language model.

19. **Exceptions** — `exception`, `throw`, and pattern-based
    `try`/`catch` handle exceptional control flow. Unmatched catches rethrow, Hexagon
    exceptions use branded JavaScript `Error` values, and foreign thrown values appear
    through `JsError`; `Result.attempt` provides a value-oriented alternative.

## Collections

20. **Collections** — A compact, example-led introduction to
    `Vector(a)`, `Map(k, v)`, and `Set(a)`. The chapter teaches the ideas that matter to
    ordinary Hexagon programs: persistent updates, iteration through `Seq`, partial
    bracket access versus total `get`, one-based sequence indexing and slicing, and the
    role of `Eq`, `Hash`, and `Iterable`. A small user-defined iterable may demonstrate
    extension through constraints. It should not inventory every operation, constructor,
    complexity row, or conversion; that belongs in generated API documentation or a
    future library manual.

21. **Implied types** — A constraint may declare types uniquely determined by each
    instance's subject type; each `honor` binds them exactly once. Implied-type names
    belong to their constraint, may be used inside its declaration and instances, and
    participate in ordinary coherence.
    Their deliberately restricted form supports concrete facilities such as
    `Iterable.Item` without adding general implied-type projection to inference.

## JavaScript and TypeScript integration

22. **JavaScript output** — Hexagon emits ESM intended for people as well as
    engines: native values and operations stay native, records stay plain objects,
    types erase where possible, and generated helpers remain explicit. Source, emitted
    JavaScript, and runtime representation should be compared throughout the book.

23. **TypeScript output** — Public Hexagon APIs produce accurate `.d.ts`
    declarations with idiomatic primitive, function, product, union, and opaque-type
    faces. The generated declaration is part of the language boundary, not incidental
    compiler metadata.

24. **JavaScript input** — Foreign declarations, boundary-only types such as
    `Nullable(a)` and `Array(a)`, foreign-backed enums, conversions, JavaScript calls,
    and imported values define how Hexagon enters an existing JS/TS application.

25. **Constraints in JavaScript** — Constrained polymorphic exports provide
    named, dictionary-free functions for lawful fundamental types and, when all needed
    public dictionaries exist, a generic dictionary-taking JavaScript function. This
    preserves
    zero-cost ordinary calls while keeping the TypeScript surface honest.

## Cross-cutting promises

These are not necessarily separate chapters. They are themes every relevant chapter
should make visible:

- strong types with annotations used for clarity rather than ceremony;
- plain data and functions instead of inheritance-heavy object models;
- persistent data with small, explicit islands of mutation and effects;
- readable emitted JavaScript and accurate TypeScript declarations;
- predictable evaluation order and no hidden dispatch; and
- diagnostics that identify invalid programs and offer concrete rewrites.
