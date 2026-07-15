# Compiler Global Naming Doctrine

**Status:** Initial architecture decision. Binding on compiler code and compiler documentation; revisable through an explicit recorded change.

## 1. Purpose

Compiler passes repeatedly represent similar concepts: tokens, names, expressions, declarations, modules, and types. Ad hoc suffixes and optional fields make it unclear which invariants hold at a given point in the pipeline.

Hexagon therefore names representations by their compiler phase from the beginning.

## 2. Canonical phases

The canonical phase vocabulary is:

```text
Source
Lexed
LaidOut
Parsed
Resolved
Typed
Core
Emitted
```

These names describe representations, not algorithms. Transforming passes use verbs:

```text
lex
applyLayout
parse
resolve
check
elaborate
emitJavaScript
emitDeclarations
emitTypeScriptPreview
```

The pipeline reads:

```text
Source.File
  -> Lexed.File
  -> LaidOut.File
  -> Parsed.Module
  -> Resolved.Module
  -> Typed.Module
  -> Core.Module
  -> Emitted output
```

## 3. Phase qualification

Each phase owns short semantic nouns:

```text
Lexed.Token
LaidOut.Token
Parsed.Expr
Resolved.Expr
Typed.Expr
Core.Expr
```

Code outside a phase qualifies the noun with its phase. Do not encode the entire transformation history into a flattened name such as `TypeCheckedResolvedParsedExpression`.

Where the implementation language uses filesystem modules rather than namespaces, imports must preserve visible phase qualification at boundaries. The exact import syntax is chosen with the implementation language; the conceptual spelling above is normative architecture vocabulary.

## 4. Pass contracts

Every major pass declares one phase input and one phase output. A pass must not silently accept an earlier representation or return a partly transformed hybrid.

Conceptually:

```text
lex(Source.File) -> Result(Lexed.File)
applyLayout(Lexed.File) -> Result(LaidOut.File)
parse(LaidOut.File) -> Result(Parsed.Module)
resolve(Parsed.Module) -> Result(Resolved.Module)
check(Resolved.Module) -> Result(Typed.Module)
elaborate(Typed.Module) -> Core.Module
emitJavaScript(Core.Module) -> Emitted.JavaScript
emitDeclarations(Core.Module) -> Emitted.Declarations
emitTypeScriptPreview(Core.Module) -> Emitted.TypeScriptPreview
```

The parser cannot consume `Lexed.File`; layout is not an optional parser mode. The checker cannot consume `Parsed.Module`; resolution is not performed opportunistically during inference.

## 5. Representation rules

1. A representation contains only states legal in its phase.
2. Later-phase facts are not optional fields on earlier nodes.
3. Textual parsed names become stable symbol identities during resolution.
4. Types become attached to expressions in the typed representation, not gradually through nullable fields on the parsed tree.
5. Surface-only constructs disappear during elaboration; the emitter does not learn to interpret arbitrary parsed syntax.
6. A little repeated structure between phase types is preferable to one universal tree containing impossible states.

## 6. Shared types

A type is shared across phases only when its meaning and invariants are genuinely unchanged.

Expected shared examples:

```text
Source.FileId
Source.Position
Source.Span
Source.Comment
Diagnostics.Diagnostic
Resolved.SymbolId   -- created by resolution, carried by later phases
```

Structural similarity alone is not sufficient reason to share a type.

## 7. Forbidden naming patterns

Do not introduce:

```text
Token2
NewToken
OldExpression
ExpressionNode2
FinalAst
ProcessedModule
TypedExpressionMaybeResolved
```

Avoid bare `AST` where a phase name is available. `Parsed.Module`, `Typed.Module`, and `Core.Module` say which tree and which invariants are meant.

Do not use `raw` as a substitute for identifying the actual phase. `RawToken` is ambiguous between characters, physical tokens, and pre-layout tokens; `Lexed.Token` is not.

## 8. Files and folders

Representations and transforming algorithms remain visibly distinct:

```text
src/
  syntax/
    lexed/
    laid-out/
    parsed/
    resolved/
    typed/
    core/

  emission/
    emitted.ts

  passes/
    lexer/
    layout/
    parser/
    resolver/
    checker/
    elaborator/
    emitter/
```

This is the default structure, subject to adjustment when the implementation language and module system are selected. Any adjustment must preserve the phase vocabulary and pass boundaries.

## 9. Local helper names

Inside a module dedicated to one phase, short names such as `Expr`, `Name`, and `Module` are preferred. At cross-phase boundaries, qualification is required.

Transforming functions use verbs; data uses nouns. Avoid classes or services named after vague activity, such as `Processor`, `Manager`, or `Handler`, when a precise compiler term exists.

## 10. Diagnostics vocabulary

User-facing diagnostics describe Hexagon source concepts, not internal phase names, unless reporting an internal compiler error. A user sees “unknown name” rather than “unresolved `Parsed.Name`.” Internal diagnostics and debug dumps may name phases explicitly.

## 11. Evolution rule

This doctrine may change as implementation provides evidence. Changes must be deliberate:

1. state the naming or phase-boundary problem;
2. show a concrete compiler example;
3. update this document before or with the code;
4. migrate existing names consistently rather than adding a local exception; and
5. record the change below.

Temporary local suffixes are not an acceptable substitute for revising the global doctrine.

## 12. Decision record

### Initial decision

- Compiler representations are phase-owned.
- Phase modules own short nouns; cross-phase code qualifies them.
- Passes have explicit typed phase boundaries.
- Universal optional-field ASTs, numeric suffixes, and vague transformation-state names are rejected.
- The doctrine is binding but intentionally revisable through the evolution rule.

### Layout retention clarification (July 2026)

`LaidOut.Token` is the union of unchanged `Lexed.Token` values and
`LaidOut.VirtualToken`. Layout does not reinterpret or mutate physical token
payloads; it only interleaves virtual delimiters. This is legitimate shared
retention under §6, not a partly transformed hybrid: the owning file and public
pass boundary remain distinctly `Lexed.File -> LaidOut.File`, and the parser
accepts only the latter.

### Emitted output clarification (July 2026)

`Emitted.JavaScript` and `Emitted.Declarations` are final text artefacts rather
than syntax trees, so their representation lives under `src/emission/` rather
than `src/syntax/emitted/`. The transforming algorithms remain under
`src/passes/emitter/` and expose the distinct verb contracts
`emitJavaScript(Core.Module) -> Emitted.JavaScript` and
`emitDeclarations(Core.Module) -> Emitted.Declarations`. These outputs retain
unchanged source identity and diagnostics, but none exposes or accepts an earlier
compiler representation.

`Emitted.TypeScriptPreview` is a separate inspection artefact rather than a
weakened `Emitted.Declarations`. It may describe non-exported top-level bindings
for interactive tools, while `Emitted.Declarations` remains the public module
contract. Its transforming verb is
`emitTypeScriptPreview(Core.Module) -> Emitted.TypeScriptPreview`.

### Source-comment retention clarification (July 2026)

`Source.Comment` records source spelling and position rather than a semantic node
owned by any compiler tree. The lexer creates it and each phase file carries it
unchanged until readable JavaScript emission. This is legitimate shared source
metadata under §6, like `Source.Span`; it does not make comments part of parsed,
resolved, typed, or Core semantics.
