# Source-defined standard Iterable instances — proposal for Fable

**Status:** Proposed, non-normative; 2026-09-07. This note requests specification
adoption and subsequent implementation. It claims neither has landed.
**Sequence:** Follow the effects arc. Foreign collection instances depend on
their adopted snapshot contracts and conforming implementations.

## 1. Principle

Standard collections should demonstrate the same `honor Iterable` mechanism
that ordinary library authors use. The collection's home module should own its
instance in readable `.hex` source; the compiler should not provide a parallel,
invisible declaration of the same contract.

[`Iterable.hex`](../../stdlib/Iterable.hex) already declares the constraint.
The missing source declarations are the standard instances currently supplied
by the compiler. This proposal moves that authority into source, not merely
adds examples mirroring a compiler table.

The effect contract remains pure. Under the effects arc's header syntax:

```hex
export constraint Iterable<c> =
    type Item
    toSeq(values: c) -> Seq(Item)
```

An implementation infers its effect and must satisfy that contract. No effectful
`Iterable` or marked `for` form is introduced. `Stream` remains separate.

## 2. Instances belong beside the collections

The intended declarations are ordinary instance bodies:

```hex
// Map.hex
honor Iterable<Map(k, v)> =
    type Item = (k, v)
    toSeq(map) = entries(map)
```

```hex
// Vector.hex
honor Iterable<Vector(a)> =
    type Item = a
    toSeq(values) = elements(values)
```

```hex
// Set.hex
honor Iterable<Set(a)> =
    type Item = a
    toSeq(values) = elements(values)
```

These are proposed migrations, not claims that today's compiler accepts these
standard instances. `entries` and the private `elements` traversal helpers
already exist in their respective source modules. Reuse them without adding
`Hash` or another prerequisite to traversal.

Apply the same ownership rule across the existing provided-instance inventory:

| Subject | Source ownership and behaviour |
|---|---|
| `Map(k, v)` | `Map.hex`; existing entries traversal |
| `Set(a)` | `Set.hex`; existing element traversal |
| `Vector(a)` | `Vector.hex`; existing ordered traversal |
| `Seq(a)` | `Seq.hex`; identity conversion |
| `String` | `String.hex`; existing Unicode codepoint traversal |
| `Range` | Its canonical stdlib home; existing progression semantics |
| `Array(a)` | `Array.hex`; traversal of the acquired stable contents |
| `JsMap(k, v)` | `JsMap.hex`; stable entries with the adopted native-key semantics |
| `JsSet(a)` | `JsSet.hex`; stable elements with the adopted native-equality semantics |

`Range` currently has no `stdlib/Range.hex`; establish its canonical source home
as part of migration rather than inventing a second instance registration path.
This does not give `Range` a `fromSeq` operation. The existing distinction between
an iterable type and membership of the finite-collection conversion suite stays.

Public member access remains through the existing dot and qualified forms,
such as `values.toSeq()` and `Vector.toSeq(values)`. Do not add a second exported
ordinary `toSeq` beside its `honor` member. Replace comments claiming that the
instance must permanently remain compiler-provided.

## 3. Snapshot semantics and sequencing

`Map`, `Set`, and `Vector` already have pure collection semantics. Moving their
instances into source does not require snapshots to make them pure; their
current obstacle is the provided-instance architecture.

For `Array`, `JsMap`, and `JsSet`, follow the separately adopted FFI direction:
a Hexagon collection denotes stable contents, foreign mutation does not change
a retained collection, and derived lazy sequences traverse those same contents.
Snapshots establish that guarantee; source `honor` blocks expose it through the
ordinary constraint mechanism. Neither change substitutes for the other.

This note does not specify acquisition, nested conversion, identity, outbound
alias protection, or capture-time effects. Those are the FFI snapshot work's
obligations. In particular, do not silently turn `JsMap` into structural-key
`Map`, or claim a pure live mutable view while snapshot work is unfinished.

The work may be delivered in slices after the effects arc: domestic instances
first, then foreign collection instances once each snapshot implementation is
ready. The end state is one source-owned mechanism for the full inventory.

## 4. Compiler support remains, declaration duplication does not

This proposal does not require opaque storage traversal to be implemented
without intrinsics. A source instance may call a private, explicitly typed
intrinsic when accessing the representation requires it.

Retain ordinary constraint resolution, implied-type checking, coherence,
dictionary emission, and the existing standard-library privilege for declaring
instances in canonical homes. Remove the corresponding compiler-provided
instance as each source instance becomes authoritative. Do not retain a hidden
fallback or allow two providers for one `(constraint, subject)` instance.

Native loop emission and other traversal optimizations may remain. They must
implement the resolved source instance's semantics, including order, laziness,
effects, exceptions, and snapshot behaviour. A familiar spelling alone is not
proof that an arbitrary user instance admits a built-in lowering.

This does not broaden implied-type inference or adopt an unrelated conversion
feature. Generic `Iterable` uses and any Iterable-to-Seq adaptation follow their
own adopted rules; the change here is who declares the standard instances.

## 5. Adoption and verification

Fable should amend the provided-instance inventory and source-ownership rules
in Collections Parts 2 and 5, the collection/FFI owners, constraints, intrinsics,
and stdlib listing guidance consistently. Record source `honor` instances as
authoritative and distinguish them from any remaining storage intrinsics.

Implementation work must:

1. Support ordinary source instance checking for these standard subjects and
   resolve `Item` from each declaration, without duplicate compiler evidence.
2. Migrate the source blocks and remove their old provided rows together;
   preserve prelude loading, canonical declaration identity, and instance
   discovery. Handle bootstrap ordering explicitly rather than retaining a
   second declaration path to make loading work.
3. Verify `for`, explicit `toSeq`, qualified/dot member references, and applicable
   generic evidence paths all reach the same canonical instance.
4. Check rejection of an effectful `toSeq` body and of duplicate instances;
   verify parameterized collections iterate without unnecessary `Hash` bounds.
5. Exercise optimized and ordinary traversal paths for every migrated subject:
   identical items/order, persistent replay, String codepoints, Range bounds,
   and foreign snapshots surviving source mutation and escaped lazy traversal.
6. Update documentation examples and source comments, and report normative
   adoption separately from compiler/runtime conformance.

The intended result is that opening a collection's source shows how it honors
`Iterable`, and that declaration is the one the compiler actually uses.
