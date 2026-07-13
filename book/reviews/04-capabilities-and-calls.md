# Group Review: Capabilities and Calls

**Chapters reviewed:** Constraints; Derivation; Dot Calls.

**Status:** Reviewed as a consistent drafting group. This is not the late whole-book
pedagogy pass, and chapter numbers remain provisional.

**Reordering note:** This review was performed before Modules was drafted and inserted
between Derivation and Dot Calls. The reviewed chapters now appear as Chapters 12, 13,
and 15. Their internal findings remain valid; the new four-chapter transition through
Modules still requires a later cross-chapter check.

## Coherence result

The group follows one clear progression:

1. constraints let generic code require named behavior;
2. deriving lets nominal data request lawful standard behavior without repeating its
   structure; and
3. method-style calls provide convenient access to ordinary subject-first companion
   functions without turning values into objects with methods.

The distinction between constraint operations and companion operations is the
load-bearing connection. Chapter 12 establishes that `show(value)` selects an
instance. Chapter 15 then explains that `value.operation()` selects an exported
function from a known type's companion and explicitly does not search instances. The
similar-looking conveniences therefore meet without being conflated.

## Integrated corrections

- Changed the generic JavaScript example in Constraints to carry its dictionary after
  the source arguments. Trailing evidence preserves the subject-first position and
  agrees with the established FFI direction.
- Replaced “stable hashing” with the narrower promise that hashing is consistent with
  equality. Hash values are deterministic within an execution, but collection table
  placement may be randomized and cross-execution stability is not promised here.
- Stated Hexagon's required-foundation rule for equality directly, without making
  understanding it depend on familiarity with Haskell.
- Clarified derived record ordering: fields are visited in field-name order and their
  values are compared lexicographically.
- Corrected the nested function type example from `Box(Int -> Int)` to
  `Box((Int) -> Int)`.
- Added the transparent-alias rule to Dot Calls: an alias creates no new
  companion and uses the companion of its expanded type.
- Added principal index entries for derivation, method-style calls, and subject-first
  style.

## Pedagogical dependency check

Constraints arrives only after ordinary polymorphism, operators, nominal types, and
direct function calls are familiar. The `Show` example makes constrained polymorphism
concrete before the chapter names dictionaries or discusses coherence. `Area` then
introduces user-defined constraints, required operations, defaults, and instances in
one small domain. Superconstraints, coherence, and the orphan rule follow only after
the reader knows what an instance supplies.

Deriving depends on that full instance model. Its two spellings are shown together,
so `derives` is understood as concise instance generation rather than a separate
feature. Records precede unions, matching their earlier teaching order. Hashing is
explained only far enough to justify the equality law and the derived-only rule;
collection mechanics remain deferred.

Method-style calls reuse the subject-first convention and pipes from the opening
chapters. The three-spelling example gives the entire feature before companion-module
rules add precision. The chapter now follows Modules and can rely on its full account
of home modules, companion modules, and exported operations. This review originally
assessed the chapter's smaller local definitions before that move.

No idea in the group needs to move later. The late pedagogy pass should nevertheless
test whether the orphan rule and the unknown-receiver fallback need more breathing
room for a reader encountering type-directed lookup for the first time.

## Terminology and index check

- **Constraint**, **instance**, and **constrained polymorphism** are defined together
  at first use.
- **Default operation**, **superconstraint**, **coherence**, **orphan rule**, and
  **dictionary** each receive a direct definition where their purpose is visible.
- **Derivation** is presented through `derives` and `derive`; its index entry points
  back to instances rather than treating it as unrelated machinery.
- **Home module**, **companion module**, **subject-first**, and **method-style call**
  form one vocabulary across Modules and Chapter 15. The later insertion preserves the
  reviewed meanings while giving the module terms their proper principal definitions.
- Principal definitions and useful lookup forms are represented in
  `INDEX-CANDIDATES.md`.

## Example continuity

`Show` moves from interpolation and inferred obligations to a parameterized
`Show<Box(a)>` instance, then returns in the distinction between `show(value)` and a
dot call. `Eq` moves from operators to a required `equals` foundation and inherited
`notEquals`, then into derived equality. No returning example changes the operation an
operator selects.

`Point`, records, and unions reuse data shapes already established in Chapters 9–11.
`Option.getOrElse(possibleName, "Guest")` connects the earlier subject-first and pipe
material to the method-style spelling in one compact example. Its clarity also makes
it suitable for the repository README without requiring the surrounding chapter.

## Technical surface check

- Required and defaulted constraint operations, completed-instance dispatch,
  superconstraints, coherence, orphan placement, simple instance heads, and global
  instance participation agree with the constraints specification.
- `Eq.notEquals` inherits from required `equals`; circular user defaults remain
  possible ordinary recursion and receive an appropriately brief warning.
- Genuinely polymorphic emitted functions carry trailing dictionary evidence;
  concrete operations may still specialize away dictionary plumbing.
- Nominal opt-in derivation, automatic structural instances, record field ordering,
  union declaration ordering, parameter obligations, and the derived-`Eq` requirement
  for `Hash` agree with the data and collections specifications.
- Method lookup uses the independently known receiver type and its single companion;
  bare dots remain fields, collisions require explicit spelling, and abstract
  constraint dispatch remains a direct call.
- The JavaScript and `.d.ts` accounts remain consistent: derivation creates ordinary
  generated operations, dot calls erase to function calls, and neither feature adds
  runtime methods or TypeScript method members.

## Deferred to later reviews

- Chapter 14 now gives the full import, export, home-module, companion-module,
  instance-globality, and opacity account promised by these chapters. Its integration
  with this group remains to be checked after reader review.
- Collections must make `Hash` and `Iterable` concrete without turning this book into
  a library manual, and must preserve the equality/hash law stated here.
- Later collection-extension or advanced material must explain associated types and
  user-defined `Iterable`; the ordinary loops chapter deliberately teaches only the
  concrete element-type relationship and `Seq(a)` consumer idiom.
- The FFI chapters must reconcile internal trailing evidence with exported dictionary
  types and explain the qualified dictionary surface without contradicting the plain
  `.d.ts` statements here.
- The late pedagogy pass should reconsider pacing, final cross-references, index
  locators, and whether any coherence material belongs in an advanced aside.

## Review result

After the integrated corrections, no known technical contradiction remained in the
three chapters reviewed here or between that group and Chapters 1–11. The sequence gives one account
of capability requirements, generated capability instances, and convenient ordinary
function calls while maintaining their distinct dispatch rules. The modules,
collections, loops, and FFI chapters now have explicit promises to discharge in later
group reviews.
