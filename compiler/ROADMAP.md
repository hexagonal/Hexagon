# Hexagon Compiler Roadmap

**Status:** Forty-one vertical slices now extend the original expression, pattern, mutation, Range, and loop pipeline with generic nominal unions and records, full-pattern guarded exception handling, nominal companion dot calls, completed internal constraint dictionaries, owner-scoped implied types, lazy `Seq`, structural hashing, vectors, Map/Set core operations, generalized concrete `Iterable`, initial Array/Nullable boundary types, relative module graphs with cross-module coherent evidence, direct fundamental specializations with navigable generated-code metadata, transparent aliases, mutual recursion, qualified types, opaque module abstractions, explicit n-ary function-type annotations, module-level foreign bindings with opaque foreign types, Euclidean primitive division families, exact `Rat` conformance over `BigInt`, and canonical `Rat` loading in the Playground's provisional fundamental stdlib.

The compiler is built as a sequence of typed phase transformations. Each milestone must preserve the global naming doctrine in `architecture/naming.md` and the readability and commenting doctrine in `architecture/readability-and-comments.md`.

## 0. Foundation

**Implemented.**

Use TypeScript 7 or later, compiled with its native Go-based toolchain. Decide the remaining package, formatting, and bundling tools. Establish source files, positions and spans, diagnostics and fix-its, Vitest infrastructure, explicit golden fixtures, fast-check properties, and a platform-neutral compiler API usable by both the Node CLI and the future browser playground. Establish module introductions and conceptual function comments from the first source file rather than retrofitting them after implementation. Follow `architecture/environment.md`, `architecture/testing.md`, and `architecture/readability-and-comments.md`.

## 1. Lexer

**Implemented.**

Transform source text into physical tokens with exact spans and physical newline/indentation information. Cover identifiers, keywords, literals, punctuation, operators, comments, escapes, invalid characters, and lexical diagnostics.

## 2. Layout

**Implemented.**

Transform physical tokens into a layout-aware stream containing virtual open, separator, and close tokens. Own indentation stacks, continuation lines, blank/comment lines, explicit semicolons, EOF closure, and layout diagnostics. The parser must not accept `Lexed.File` directly.

## 3. Parser

**The existing expression and pattern grammar plus vector literals/rest patterns, generic unions, nominal records, transparent parameterized aliases, opaque exports, exceptions and guarded full-pattern `try`/`catch`, constraints with implied types/defaults/derivation, ground and parameterized `honor`, explicit constrained binders, explicit zero-/one-/many-parameter function types, `Seq(a)`, collection/FFI type applications, qualified type paths, relative imports, and module-level `extern` declarations are implemented; `finally` and later foreign receiver/class/enum forms have targeted diagnostics.**

Transform layout-aware tokens into the parsed syntax tree. Implement declarations, expressions, patterns, type syntax, precedence, contextual forms, recovery, and source attribution.

## 4. Resolution and modules

**Stable local, imported, and foreign identities, order-independent type declarations, generic nominal declarations, transparent-alias expansion and cycle checks, exception and constraint members, owner-relative implied type scope, relative named/aliased/namespace/effect imports, qualified type paths, acyclic dependency ordering, imported schemes, nominal companion lookup, mutual recursive function groups, capture availability, and opaque representation visibility are implemented. Re-exports and packages are post-v1 package-system work.**

Replace textual references with stable symbols. Implement scopes, imports, exports, companions, duplicate detection, shadowing rules, module graphs, cycle diagnostics, and topological ordering.

## 5. Type-system core

**The HM and row core now includes generic nominal unions and records, `Exn`, `Seq(a)`, Vector/Map/Set and Array/Nullable types, inferred and explicitly annotated n-ary functions, rigid declared type variables, declared-constraint completeness checking, explicit/inferred constraints, structural hashing, maximal trailing evidence, required/default members, nested base constraints, coherent ground and parameterized instances, concrete `Iterable` selection, nominal derivation, implied type substitution at concrete calls, and the v1 projection-bearing binder ban; the conditional public dictionary ABI remains with later FFI integration work.**

Implement Algorithm J, union-find type variables, levels and generalisation, type schemes, unification, rows, constraints, and stable type rendering for diagnostics.

## 6. Semantic checking

**Expression-and-binding checks, monomorphic local mutation, inclusive `Range`, `while` condition/body checks, `for..in` over `Range` and `String` with irrefutable loop patterns, nested tuple/open-record/Unit/as-pattern irrefutability, single-constructor union and exhaustive Bool/closed-union or-pattern irrefutability, payload-sensitive exhaustive union, Bool, Unit, and nested or-pattern matches, catch-all enforcement for Int/String and refutable structural matches, guarded-arm coverage and reachability, full nested/or/as exception patterns, concrete exception payload enforcement, nested tuple/record payload destructuring, constructor arity, annotations, tuple and record access/update, direct recursive functions, monomorphic annotated foreign signatures, `console.log` as a variadic `Unit` effect, and pre-inference pipe rewriting implemented; full language in progress.**

Type-check expressions and declarations. Enforce value restriction, recursion, exhaustiveness, mutability and capture, constraints and instances, whole-program coherence, and FFI declaration validity.

## 7. Elaboration

**Primitive, structural and nominal data, vector patterns and checked access, collection operations, matches, exceptions, constraint evidence, dot-call rewriting, mutation, range, while, and generalized for-loop slices implemented.**

Remove surface conveniences and make semantics explicit. Pipes have already become calls before inference; operators become constraint operations; numeric literals elaborate through `Num.fromNat`; evidence becomes explicit where required; patterns lower to tests and bindings; high-level control forms reduce to the core language.

## 8. Core IR

**Typed representation includes vector/rest patterns, structural and generic nominal data, collection and FFI boundary types, exceptions, modules, constraint dictionaries and erased implied type bindings, matches, mutation, ranges, loops, and recursive functions.**

Define a small typed representation oriented toward readable JavaScript without merely copying JavaScript syntax. Preserve resolved bindings, representation decisions, explicit evidence, control flow, and source attribution.

## 9. JavaScript emission

**Readable ESM emission covers the implemented language, including generic nominal data, branded Error exceptions with nested guarded catch tests and implicit rethrow, completed internal constraint dictionaries and factories, structural hashes, checked Vector/String/Map access, hash-evidence-driven persistent Map/Set tries with extensional `Eq`, constructor-shaped `Show`, permutation-invariant `Hash`, traversals and set algebra, companion calls, Euclidean `Int`/`BigInt` division and remainder, exact `gcd`/`lcm`, Float remainder variants, imports, replayable ranges, persistent generator-backed sequences, provided and user-instance iteration, direct dictionary-free fundamental specializations, direct foreign ESM bindings, and stable `Seq`/`Unit` boundary adapters.**

Emit readable ESM, source maps, direct primitive operations, records and unions, helpers, runtime imports, specialization, and deterministic output.

## 10. TypeScript declaration emission

**Primitive, tuple, Vector/Map/Set, Array/Nullable, structural/nominal-record, generic discriminated-union, exception, constructor, opaque foreign type, foreign value/function, `Range`/`Seq` as `Iterable<T>`, unconstrained-function, and fundamental-specialization declarations implemented.**

Emit the checked public surface as `.d.ts`: generics, records, unions, opaque types, runtime-owned values, FFI signatures, fundamental specializations, and public dictionaries.

## 11. Project system and CLI

**The platform-neutral `compileProject` API loads supplied relative module graphs, rejects cycles, preserves dependency order, and emits every module; filesystem loading, options, output management, and the CLI remain.**

Load source graphs from selected root modules, coordinate whole-program compilation, manage outputs and options, format diagnostics, and expose build and run operations through a thin CLI over the platform-neutral compiler API. Running evaluates the selected root's ordinary ESM top level; it never searches for or invokes a special `main`. Follow `architecture/compilation-roots.md`.

## 12. Conformance and integration

Turn normative spec examples into golden tests, add end-to-end fixtures, integrate the runtime and standard library, measure generated output, and expose the compiler core to the playground.

## Delivery strategy

The architectural stages remain strict, but implementation proceeds through thin vertical slices. The first slice should lex, lay out, parse, type, and emit a tiny valid program before every surface form is implemented. Each later slice expands conformance without weakening phase boundaries.
