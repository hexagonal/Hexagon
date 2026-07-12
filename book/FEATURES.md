# Hexagon Feature Catalogue

**Status:** Proposed book coverage. Each numbered item is a candidate chapter, not a
fixed chapter boundary or final reading order.

This catalogue describes Hexagon from a programmer's point of view. It deliberately
groups related syntax and rules into things a reader can learn and use; it is not an
index of compiler phases or specification files.

For planning purposes, this catalogue assumes the v1 language specification is
finished. If the specification later changes, affected book material should be updated
then; open specification work does not make the book outline provisional.

## Language foundations

1. **Programs, modules, and execution** — Source files are modules. Imports are
   acyclic, top-level effects run in dependency order, and the selected root module
   runs without a special `main` function. Modules support named, aliased, namespace,
   and effect imports, plus public and opaque exports.

2. **Layout, blocks, and comments** — Indentation defines blocks; braces are records,
   not block delimiters. Semicolons can separate statements explicitly. Hexagon has
   `//` line comments and nestable `/* ... */` block comments, while doc-comment
   spellings are reserved for later tooling.

3. **Values, bindings, and expressions** — Programs are built primarily from values
   and expressions. `let` introduces immutable bindings, blocks take the type of their
   final expression, discarded non-`Unit` values are errors, and `ignore` makes
   intentional discarding explicit.

4. **Primitive values and strings** — `Int`, `Float`, `BigInt`, `Bool`, `String`, and
   `Unit` map directly to familiar JavaScript values. This includes interpolation,
   multiline strings, numeric separators, codepoint-based string operations, and the
   deliberate distinction between integer and floating-point semantics.

5. **Operators and control expressions** — Arithmetic, comparison chains, word-based
   Boolean logic, concatenation with `++`, pipes with `|>`, precedence, and
   `if ... then ... else` form one coherent expression language. Integer division and
   remainder use Euclidean semantics; floating-point division follows JavaScript.

## Functions and types

6. **Functions and application** — Lambdas, `let`-bound functions, recursive `fun`
   declarations, mutual recursion, nullary functions, annotations, and explicit type
   parameters. Functions are genuinely n-ary: Hexagon has neither automatic currying
   nor partial application.

7. **Type inference and polymorphism** — Hindley–Milner inference usually removes the
   need for annotations. Let-polymorphism, the ML value restriction, monomorphic
   recursion, type-variable naming, numeric-literal defaulting, and useful annotations
   explain both the power and the boundaries of inference.

8. **Type aliases and declarations** — Parameterized `type` aliases are transparent,
   fully applied, non-recursive, and preserved where practical in displayed and
   generated types. Type, record, union, constraint, and exception declarations share
   predictable header and module-level rules.

9. **Tuples** — Fixed-size positional products support construction, `itemN` access,
   destructuring, inference, and structural constraint behavior, while remaining
   ordinary JavaScript arrays at runtime.

10. **Structural records and row polymorphism** — Plain records support field access,
    punning, spread updates, and functions that accept any record containing the fields
    they use. Row polymorphism provides this flexibility without a general subtyping
    relation.

11. **Nominal records and opacity** — `record` introduces a distinct named data type
    while retaining an explicit relationship with plain record data. `export opaque`
    hides representation across module boundaries and supports stable public APIs.

12. **Unions, `Option`, and `Result`** — Nominal sum types model alternatives with
    constructors and optional payloads. Their JavaScript representation stays readable,
    and the prelude's `Option` and `Result` cover absence and recoverable outcomes.

13. **Pattern matching** — `match` supports constructor, tuple, record, literal,
    vector, wildcard, variable, or-, and as-patterns, plus guards and construction
    punning. Exhaustiveness and unreachable arms are compile errors, and refutable
    patterns are restricted in binding positions.

14. **Constraints and instances** — Constraints such as `Eq`, `Ord`, `Show`, `Num`,
    `Frac`, `Integral`, `Concat`, `Pow`, `Hash`, and `Iterable` express capabilities.
    `honor` declarations provide coherent instances under an orphan rule; constrained
    polymorphism compiles through dictionary passing while concrete code remains direct.

15. **Deriving capabilities** — Nominal records and unions can opt into lawful,
    structural instances with `derives` and `derive`. This chapter should explain what
    can be derived, the resulting equality, ordering, display, and hashing behavior,
    and when a hand-written instance is appropriate.

16. **Method-style calls and companion modules** — `value.operation(args)` is
    type-directed sugar for a subject-first companion function such as
    `Type.operation(value, args)`. It adds familiar chaining without objects, method
    tables, or hidden runtime dispatch, and has explicit rules for field collisions.

## State, effects, and flow

17. **Controlled local mutation** — `var` and `:=` provide local mutable state without
    making mutation the default. Mutable cells cannot cross a lambda boundary, so
    closures do not capture changing local variables and the compiler need not perform
    escape analysis.

18. **Loops, ranges, and iteration** — `for ... in`, `while`, ascending and descending
    ranges, irrefutable loop patterns, and `Iterable` connect imperative-looking loops
    to typed functional iteration. Loop bodies return `Unit`, and iterable resolution is
    static.

19. **Lazy sequences** — `Seq(a)` is Hexagon's lazy, immutable sequence and the common
    currency between collections. Its functional cursor supports effects and external
    iteration without exposing mutable JavaScript iterators as the language model.

20. **Exceptions and foreign errors** — `exception`, `throw`, and pattern-based
    `try`/`catch` handle exceptional control flow. Unmatched catches rethrow, Hexagon
    exceptions use branded JavaScript `Error` values, and foreign thrown values appear
    through `JsError`; `Result.attempt` provides a value-oriented alternative.

## Collections

21. **Persistent collections in practice** — A compact, example-led introduction to
    `Vector(a)`, `Map(k, v)`, and `Set(a)`. The chapter teaches the ideas that matter to
    ordinary Hexagon programs: persistent updates, iteration through `Seq`, partial
    bracket access versus total `get`, one-based sequence indexing and slicing, and the
    role of `Eq`, `Hash`, and `Iterable`. A small user-defined iterable may demonstrate
    extension through constraints. It should not inventory every operation, constructor,
    complexity row, or conversion; that belongs in generated API documentation or a
    future library manual.

## JavaScript and TypeScript integration

22. **Readable JavaScript output** — Hexagon emits ESM intended for people as well as
    engines: native values and operations stay native, records stay plain objects,
    types erase where possible, and generated helpers remain explicit. Source, emitted
    JavaScript, and runtime representation should be compared throughout the book.

23. **TypeScript declaration output** — Public Hexagon APIs produce accurate `.d.ts`
    declarations with idiomatic primitive, function, product, union, and opaque-type
    faces. The generated declaration is part of the language boundary, not incidental
    compiler metadata.

24. **JavaScript interoperation** — Foreign declarations, boundary-only types such as
    `Nullable(a)` and `Array(a)`, conversions, JavaScript calls, and imported values will
    define how Hexagon enters an existing JS/TS application.

25. **Exporting constrained functions** — Constrained polymorphic exports provide
    named, dictionary-free specializations for lawful fundamental types and, when public
    evidence exists, a generic dictionary-taking JavaScript entry point. This preserves
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
