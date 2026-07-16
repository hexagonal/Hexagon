# Hexagon Compiler Roadmap

**Status:** Vertical slices now include payload unions, nested constructor-payload patterns with payload-sensitive coverage, structural records with construction punning, inferred open rows, anonymous/named-tail annotations, immutable updates, nested record destructuring, negative Int patterns, nested or-patterns, exhaustive Bool/closed-union or-pattern bindings, irrefutable single-constructor union bindings, primitive and Unit literal matches, as-patterns, direct tuple/record matches, and guarded arms.

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

**Expressions, bindings, nested tuple, record, payload-constructor, negative Int/String/Bool literal, Unit, nested or-, and as-patterns, guarded payload-union and primitive matches plus direct structural tuple/record matches, primitive, tuple, and structural-record annotations including named tails, tuple and punned record values, immutable record updates, and direct recursive `fun` implemented; full grammar in progress.**

Transform layout-aware tokens into the parsed syntax tree. Implement declarations, expressions, patterns, type syntax, precedence, contextual forms, recovery, and source attribution.

## 4. Resolution and modules

**Local, tuple-pattern, and record-pattern bindings, payload union constructors, direct self-recursion, the `console.log` host operation, and primitive, tuple, structural-record, and union annotations implemented; hoisting, mutual recursion, modules, and remaining declarations in progress.**

Replace textual references with stable symbols. Implement scopes, imports, exports, companions, duplicate detection, shadowing rules, module graphs, cycle diagnostics, and topological ordering.

## 5. Type-system core

**Primitive, tuple, structural-record with inferred open rows, closed/open structural-record annotations with shared named tails, immutable same-shape updates, nominal payload-union, and function inference plus monomorphic direct recursion implemented; full constraints remain in progress.**

Implement Algorithm J, union-find type variables, levels and generalisation, type schemes, unification, rows, constraints, and stable type rendering for diagnostics.

## 6. Semantic checking

**Expression-and-binding checks, nested tuple/open-record/Unit/as-pattern irrefutability, single-constructor union and exhaustive Bool/closed-union or-pattern irrefutability, payload-sensitive exhaustive union, Bool, Unit, and nested or-pattern matches, catch-all enforcement for Int/String and refutable structural matches, guarded-arm coverage and reachability, nested tuple/record payload destructuring, constructor arity, annotations, tuple and record access/update, direct recursive functions, `console.log` as a variadic `Unit` effect, and pre-inference pipe rewriting implemented; full language in progress.**

Type-check expressions and declarations. Enforce value restriction, recursion, exhaustiveness, mutability and capture, constraints and instances, whole-program coherence, and FFI declaration validity.

## 7. Elaboration

**First-round primitive, tuple, record, payload-union, Unit/as/literal/guarded match, operator, interpolation, logic, and pipe slice implemented.**

Remove surface conveniences and make semantics explicit. Pipes have already become calls before inference; operators become constraint operations; numeric literals elaborate through `fromInt`; evidence becomes explicit where required; patterns lower to tests and bindings; high-level control forms reduce to the core language.

## 8. Core IR

**Typed expression-and-binding representation, including patterns, structural tuples and records, nominal payload unions, matches, and recursive functions, implemented.**

Define a small typed representation oriented toward readable JavaScript without merely copying JavaScript syntax. Preserve resolved bindings, representation decisions, explicit evidence, control flow, and source attribution.

## 9. JavaScript emission

**Experimental primitive, tuple, punned record, payload-union, ordered negative-literal/guarded/structural/nested-or-pattern match, exhaustive or-pattern and irrefutable single-constructor destructuring, as-pattern, function, and host-console slice, including function-declaration emission for direct recursion, implemented.**

Emit readable ESM, source maps, direct primitive operations, records and unions, helpers, runtime imports, specialization, and deterministic output.

## 10. TypeScript declaration emission

**Primitive, tuple, structural-record, discriminated-union, constructor, and unconstrained-function declarations implemented.**

Emit the checked public surface as `.d.ts`: generics, records, unions, opaque types, runtime-owned values, FFI signatures, fundamental specializations, and public dictionaries.

## 11. Project system and CLI

Load source graphs from selected root modules, coordinate whole-program compilation, manage outputs and options, format diagnostics, and expose build and run operations through a thin CLI over the platform-neutral compiler API. Running evaluates the selected root's ordinary ESM top level; it never searches for or invokes a special `main`. Follow `architecture/compilation-roots.md`.

## 12. Conformance and integration

Turn normative spec examples into golden tests, add end-to-end fixtures, integrate the runtime and standard library, measure generated output, and expose the compiler core to the playground.

## Delivery strategy

The architectural stages remain strict, but implementation proceeds through thin vertical slices. The first slice should lex, lay out, parse, type, and emit a tiny valid program before every surface form is implemented. Each later slice expands conformance without weakening phase boundaries.
