# Hexagon Compiler

This folder contains the beginning of `hexc`, the Hexagon compiler.

The platform-neutral TypeScript core now includes shared source coordinates,
structured diagnostics, the complete physical lexer, and the indentation layout
pass. Twenty-three vertical compiler slices now carry the public pipeline through `Source.File -> Lexed.File
-> LaidOut.File -> Parsed.Module -> Resolved.Module -> Typed.Module -> Core.Module ->
Emitted output` for a deliberate language subset.

The initial parser supports module and nested block items, `let` and local `var` bindings,
module-level exports, function-header sugar and lambdas, directly recursive `fun`
bindings plus nested tuple and structural-record patterns, primitive, tuple, structural-record,
and declared union annotations, tuple and structural-record literals with construction
punning, immutable record spread updates, payload union declarations and constructor
patterns, primitive and negative Int/String/Bool pattern literals, Unit, nested
or-patterns with shared bindings, and as-patterns,
guarded match arms, direct tuple/record matching, inclusive ranges, `while`, `for..in`
over `Range` and `String`, and
string interpolation, `then`-form and layout `if`, calls, field access,
indexing, assignment, generic unions, nominal records, exception declarations and
`try`/`catch`, user constraints and ground instances, explicit constrained binders,
relative imports, and the complete operator precedence table. Type aliases, derived
and parameterized instances, remaining declarations, and richer type syntax remain explicit future parser slices;
encountering one produces a recovery diagnostic rather than a misleading partial
tree.

The initial resolver assigns stable symbols to sequential `let` bindings, directly
recursive `fun` bindings, local `var` bindings, loop-head patterns, and lambda parameters. It implements lexical block scopes
and head-binder shadowing, resolves primitive, tuple, record, and union annotations, and
assigns stable identities to generic unions, nominal records, their constructors,
exception constructors, constraint members, and imported bindings. It
diagnoses illegal `let` self-reference, unknown names and types, rebinding, duplicate
parameters, mutable-capture rejection, and the deliberately deferred forward/mutual-recursion boundary.
Relative named, aliased, namespace, and effect imports plus nominal companion lookup
are implemented; qualified type syntax, capture-set hoisting, and mutual recursive
groups remain later resolution slices.

The initial checker implements the Hindley–Milner core with private union-find
variables, n-ary function types, structural tuple and open-row record types,
generic nominal union and record types, nested constructor-payload and record-pattern binding,
primitive literal, Unit, structural, nested or-, and as-patterns, guarded arms,
irrefutable single-constructor and exhaustive Bool/closed-union or-pattern
destructuring, payload-sensitive exhaustive union/Bool/Unit matching with
structural catch-all enforcement,
let-generalisation, the
value restriction, lambda monomorphism, primitive types, integer defaulting,
operator and interpolation constraints, tuple and record access, exact/open record
annotations with anonymous or named additional-field tails, immutable record updates,
conditionals, calls, monomorphic assignment, inclusive `Range`, `while`, and
concrete `Range`/`String` iteration,
first-argument pipe insertion, and block sequencing. Typed syntax records an
immutable type for every expression and a scheme for every binding. Declarations,
generic call-site evidence, explicit and inferred constraints, required-member user
constraints, ground instances, exceptions, imported schemes, and nominal dot-call
resolution. Superconstraints, defaults, derivation, parameterized instances, richer annotations, and
the remaining surface forms are later checker slices. Primitive annotations
constrain inference and are erased after checking rather than leaking into Core.
Direct recursion uses one monotype inside its own body and generalizes only after
the recursive knot closes.

The initial elaborator receives pipes already rewritten to calls, removes grouping
and overloadable operator syntax, turns
integer conversion and interpolation into explicit semantic operations, selects
primitive or dictionary evidence, lowers derived logic, and preserves comparison
chains as a single-evaluation Core form. The Core IR remains typed and
source-attributed without copying JavaScript syntax. Generic calls carry their
trailing evidence explicitly; forms awaiting checker support remain later slices.

The experimental emitter produces deterministic readable ESM and `.d.ts` text
without performing filesystem writes. It emits private and exported bindings,
functions, blocks, primitive operations, dictionary-backed generic bodies,
conditionals, interpolation, tuple arrays and positional indexing, record objects
and field access, nullary union strings, tagged payload unions and their
single-constructor and exhaustive or-pattern destructuring, compact `switch`
matches and ordered guarded/literal/structural/nested-or-pattern tests, semantic helpers,
short-circuiting comparison chains,
and recursive `fun` bindings as hoisted function declarations, generic nominal data,
branded real-`Error` exceptions, constraint dictionaries, imported ESM graphs, local mutation as
JavaScript `let`/assignment, replayable iterable ranges, `while`, and native
`for..of` loops for Range/String iteration. Exported constrained functions receive
direct dictionary-free fundamental editions, with deterministic names, collision
diagnostics, and byte-counted generated regions. Declarations cover
exported primitives, tuples, structural records, discriminated payload unions and
their constructors, nominal records, exceptions, unconstrained polymorphic functions,
and fundamental specializations.
Source maps, the conditional generic constrained edition, public dictionaries, richer types, and the
finalized portable target profile remain later emission slices.

Interactive tools may additionally call `emitTypeScriptPreview` to inspect every
representable top-level binding without promoting private bindings into the public
module contract. Constrained bindings remain in the typed analysis without exposing
their generic dictionary surface; lawful fundamental editions appear as ordinary
non-exported preview declarations.

Development commands, run from this folder:

```text
npm ci
npm run check
npm test
npm run build
```

- [Roadmap](ROADMAP.md)
- [Global naming doctrine](architecture/naming.md)
- [Readability and commenting doctrine](architecture/readability-and-comments.md)
- [Testing doctrine](architecture/testing.md)
- [Implementation and environment](architecture/environment.md)
- [Compilation roots and running modules](architecture/compilation-roots.md)
- [JavaScript target doctrine](architecture/javascript-target.md)

The implementation language is TypeScript 7 or later.
