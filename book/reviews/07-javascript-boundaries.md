# Group Review: JavaScript Boundaries

**Chapters reviewed:** JavaScript Output; TypeScript Output; JavaScript Input;
Constraints in JavaScript.

**Status:** Reviewed as a consistent drafting group after reader review. This is not
the late whole-book pedagogy or liveliness pass.

## Coherence result

The four chapters now form one clear movement across the language boundary:

1. JavaScript Output shows what a Hexagon program becomes at runtime;
2. TypeScript Output describes the supported typed surface of that JavaScript;
3. JavaScript Input explains how existing foreign values enter Hexagon; and
4. Constraints in JavaScript handles the exceptional case where an exported function
   still needs constraint operations at its foreign boundary.

The sequence moves from the familiar to the specialized. Ordinary values and calls
receive their complete account before constraint dictionaries appear, and the final
chapter can therefore concentrate on one difficult API rule without reopening the
whole FFI.

## Integrated corrections

- Replaced a standalone `BigInt.toInt` type signature in JavaScript Input with an
  actual conversion call and stated its inferred `Option(Int)` result.
- Connected fixed extern arity to the explicit `Nullable.undefined` value used for a
  JavaScript API's omitted-argument case.
- Added the important `Map` boundary warning: object-shaped JavaScript keys use
  reference identity, while several JavaScript keys may collapse to one
  Hexagon-equal key during conversion, with the later entry retained.
- Tightened the transition from TypeScript Output so that it leads specifically into
  importing JavaScript values rather than prematurely describing both directions.
- Gave the generated two-variable constraint examples enough context to show which
  fundamental types each variable admits.
- Replaced the type-theory word **evidence** with the concrete reader-facing model of
  dictionary objects, dictionary arguments, handles, and factories.

## Pedagogical dependency check

JavaScript Output deliberately gathers rules already taught feature by feature. Its
new term, **erasure**, names a behavior the reader has repeatedly seen rather than
introducing a new programming mechanism.

TypeScript Output depends on those runtime representations and distinguishes the
runtime product from the public typed contract before presenting individual mappings.
It does not claim that TypeScript reproduces Hexagon's nominality, arithmetic rules,
or checker.

JavaScript Input has the densest dependency surface: modules, primitive
representations, `Option`, sequences, exceptions, collections, and subject-first
calls. All have already received their principal explanations. The chapter introduces
only the boundary distinctions: trusted extern declarations, `Nullable`, borrowed
arrays, controlled sequence adaptation, and foreign receiver conventions.

Constraints in JavaScript comes last for good reason. A reader already understands
constraints, dictionaries inside generic emitted code, ESM exports, and `.d.ts`
output. The chapter begins with a plain JavaScript object and only then builds the
direct-function and generic-function API rules around it.

No chapter in this group needs to move earlier. JavaScript Input remains the strongest
candidate for rewriting during the late pedagogy pass because it necessarily combines
many distinct foreign-boundary forms.

## Terminology and index check

- **Erasure**, **extern declaration**, **trusted boundary**, **representation-direct**,
  **Nullable**, **constraint dictionary**, and **constrained export** have deliberate
  definitions and provisional index entries.
- **Dictionary** is explicitly a description of an ordinary JavaScript object's job,
  not a special JavaScript object kind.
- Reader-facing prose avoids **evidence**, **monomorphization**, and similar compiler or
  type-theory vocabulary where concrete JavaScript language is sufficient.
- JavaScript Output, TypeScript Output, and JavaScript Input retain the parallel,
  short chapter-title scheme; Constraints in JavaScript names the special final case.

## Example continuity

The examples preserve the established runtime shapes: tuples are arrays, records are
plain objects, mixed unions are tagged objects, all-nullary unions are strings,
persistent collections use runtime-owned types, and `Seq` uses the iterable boundary.

Pipes and dot calls continue to produce subject-first ordinary calls. The exported
constraint examples preserve ordinary argument order and append dictionary parameters
only to the generic JavaScript form. The `Eq<Float>` warning also prevents the direct
code story from quietly replacing SameValueZero with bare JavaScript equality.

## Technical surface check

- Primitive, function, tuple, record, union, exception, sequence, collection, module,
  and evaluation-order emission agrees with the governing feature specifications.
- Public and private aliases, nominal-record constructors, opaque brands, collection
  runtime names, and union constructors receive honest TypeScript declarations.
- Extern imports, nullability, readonly arrays, memoized sequence adaptation, receiver
  operations, callbacks, shallow conversions, and foreign throws retain their stated
  costs and trust boundaries.
- Constraint dictionaries expose completed member sets; direct fundamental functions
  remain dictionary-free; generic functions use a stable trailing dictionary suffix.
- `Eq<Float>` direct output preserves SameValueZero, including `NaN` equality.
- Generated constrained-export names and dictionary shapes are correctly identified as
  public compatibility commitments.

## Deferred to the whole-book passes

- Reconsider the pacing and subdivision of JavaScript Input after reading the entire
  manuscript as a newcomer. It is accurate, but it carries more distinct mechanisms
  than the neighboring chapters.
- Check every emitted JavaScript and `.d.ts` example against the implemented compiler
  once those outputs are available as executable golden tests.
- Add the planned liveliness thread without making boundary examples less precise;
  this group especially needs memorable names because its rules are necessarily
  detailed.
- Complete the final introduction, cross-references, glossary/index, and version-free
  wording passes across the whole manuscript.

## Review result

After the integrated corrections, the final four chapters are coherent with one
another and with Chapters 1–21. They distinguish runtime representation, typed public
surface, trusted foreign input, and constrained foreign APIs without collapsing those
four questions into a single library manual. The first feature draft therefore has a
complete final boundary sequence; the known remaining work belongs to the planned
whole-book passes rather than another missing feature chapter.
