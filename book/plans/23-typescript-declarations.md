# Chapter Brief: TypeScript Declarations

## Purpose

Consolidate the generated `.d.ts` surface as the public, typed description of emitted
ESM. Explain common type mappings, exported data declarations and constructors,
transparent aliases, opaque brands, runtime-owned collection types, and the deliberate
limits of what TypeScript declarations can promise.

## Reader outcome

The reader can predict the declaration generated for an ordinary Hexagon export,
understand which source distinctions remain visible, and recognize `.d.ts` changes as
public boundary changes.

## Teaching order

1. One public ESM surface, two matching build products.
2. Primitive, function, tuple, record, union, sequence, collection, and exception
   mappings.
3. Public aliases remain useful; private aliases expand.
4. Non-opaque nominal records are structurally visible to TypeScript.
5. Opaque records and unions receive TypeScript-only brands.
6. Private declarations and source-only mechanisms stay absent.
7. `.d.ts` describes the supported boundary but does not reproduce Hexagon's checker.

## Continuity constraints

- Preserve the established `export declare const` face for exported `let` bindings.
- Keep constructor exports function-shaped where JavaScript calls them.
- Use lowercase generic binders originating in Hexagon.
- Preserve `Unit` as `undefined` in value position and `void` in return position.
- Keep `Seq(a)` as `Iterable<a>` and persistent collections under `Hex.*`.
- Defer constrained-export dictionary and specialization details to their dedicated
  later chapter.
