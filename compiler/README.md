# Hexagon Compiler

This folder contains the beginning of `hexc`, the Hexagon compiler.

The platform-neutral TypeScript core now includes shared source coordinates,
structured diagnostics, the complete physical lexer, and the indentation layout
pass. Four vertical compiler slices, followed by the initial elaborator
and emitter slices, now carry the public pipeline through `Source.File -> Lexed.File
-> LaidOut.File -> Parsed.Module -> Resolved.Module -> Typed.Module -> Core.Module ->
Emitted output` for a deliberate language subset.

The initial parser supports module and nested block items, `let` bindings,
module-level exports, function-header sugar and lambdas, directly recursive `fun`
bindings, primitive parameter and result annotations, literals and string
interpolation, `then`-form and layout `if`, calls, field access,
indexing, assignment, and the complete operator precedence table. Declaration
families, patterns, and richer type syntax remain explicit future parser slices;
encountering one produces a recovery diagnostic rather than a misleading partial
tree.

The initial resolver assigns stable symbols to sequential `let` bindings, directly
recursive `fun` bindings, and lambda parameters. It implements lexical block scopes
and head-binder shadowing and resolves the six primitive annotation names. It
diagnoses illegal `let` self-reference, unknown names and types, rebinding, duplicate
parameters, and the deliberately deferred forward/mutual-recursion boundary.
Modules, imports, companions, declaration scopes, capture-set hoisting, and mutual
recursive groups remain later resolution slices.

The initial checker implements the Hindley–Milner core with private union-find
variables, n-ary function types, let-generalisation, the value restriction, lambda
monomorphism, primitive types, integer defaulting, operator and interpolation
constraints, conditionals, calls, first-argument pipe insertion, and block
sequencing. Typed syntax records an
immutable type for every expression and a scheme for every binding. Rows,
declarations, modules, mutation, richer annotations, full constraint evidence, and
the remaining surface forms are later checker slices. Primitive annotations
constrain inference and are erased after checking rather than leaking into Core.
Direct recursion uses one monotype inside its own body and generalizes only after
the recursive knot closes.

The initial elaborator receives pipes already rewritten to calls, removes grouping
and overloadable operator syntax, turns
integer conversion and interpolation into explicit semantic operations, selects
primitive or dictionary evidence, lowers derived logic, and preserves comparison
chains as a single-evaluation Core form. The Core IR remains typed and
source-attributed without copying JavaScript syntax. Evidence passing at generic
calls and the forms awaiting checker support remain later elaboration slices.

The experimental emitter produces deterministic readable ESM and `.d.ts` text
without performing filesystem writes. It emits private and exported bindings,
functions, blocks, primitive operations, dictionary-backed generic bodies,
conditionals, interpolation, semantic helpers, short-circuiting comparison chains,
and recursive `fun` bindings as hoisted function declarations. Declarations cover
exported primitives and unconstrained polymorphic functions. Source maps, generic
call-site evidence and specialization, constrained export ABI, imports, richer
types, and the finalized portable target profile remain later emission slices.

Interactive tools may additionally call `emitTypeScriptPreview` to inspect every
representable top-level binding without promoting private bindings into the public
module contract. Constrained bindings remain in the typed analysis but are withheld
from this preview until their dictionary-shaped TypeScript representation exists.

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
