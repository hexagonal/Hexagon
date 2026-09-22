# Bare data imports

**Status:** Normative design (September 2026). Implementation and conformance
validation accompany the feature; this status records the language contract,
not a claim that an unmerged implementation has shipped.

**Purpose:** Let a module use another module's data definition without depending
on its companion implementation. This is not a general partial-code import,
recursive-module facility, new type identity, or new producer declaration form.

**Related:** [Modules](modules.md), [Declarations Preamble](declarations-preamble.md),
[Method Syntax](method-syntax.md), and [Constraints](constraints.md).

## 1. Source form and selection

```hexagon
import bare Shape from Geometry
```

The first name selects an exported data declaration; the second resolves its
module through the existing package/module rules. The producer has no new
modifier and remains ordinary `.hex` source. Imports remain module-level.

The initial form selects one declaration per import. `bare` is contextual after
`import`; `from` separates the selected declaration from its module, not from a
filesystem path or JavaScript specifier. Ordinary `import Geometry` is unchanged.
A missing module uses the existing module-resolution diagnostics. A missing,
private, or ineligible selection is refused as such, not treated as a full
import. No function, value, or constraint may be selected through this form.

The initial feature specifies the single-name form above, without wildcard imports,
selection lists, or a new aliasing syntax. Those are not prerequisites for the
feature. Existing local module-alias collisions must still be diagnosed.

### 1.1 One import mode per source module

Within one importing module, bare selections and a full import of the same
resolved source module are mutually exclusive. The rule is keyed by package
and module identity, not the spelling of an alias or the selected type. Either
source order is refused, and `import Geometry as G` does not evade the rule.

Multiple different bare selections from one source module are allowed:

```hexagon
import bare Shape from Geometry
import bare Point from Geometry
```

Adding `import Geometry` to that importing module is an error even if no cycle
would result in that particular program. To switch to full access, replace the
bare selections with the full import and use its existing qualification rules.
The restriction is local to the importing module: another module can import
full Geometry normally. It is not a program-wide prohibition on mixed use.
Implicit prelude availability is not a written full import for this conflict: an
explicit bare selection restricts that consumer's access to its source module
without changing what other consumers can access (sections 7 and 9).

## 2. What the selected view provides

| Declaration | Available through the import |
|---|---|
| Exported union | The type and its public constructors, for construction, first-class constructor references, and constructor matching |
| Exported record | The type and public constructor; ordinary public field access, updates, copying, and destructuring remain available |
| Exported type alias | The transparent alias and its existing type meaning; an alias creates no constructors or instances of its own |
| Opaque record or union | The type name, preserving hidden constructors, fields, and representation |

Constraints, exceptions, foreign/intrinsic declarations, named functions,
ordinary values, `pattern` declarations, and instances are not selectable. A
record constructor is generated support for the selected data declaration,
not an independently selectable ordinary function.

`import bare Shape from Geometry` introduces a restricted module view under the
name `Shape`. It exposes the selected type as `Shape.Shape`, with the existing
same-name type fallback allowing simply `Shape`. The view contains only public
names introduced by that declaration. Thus `Shape.Circle(...)` constructs a
public Circle case of Shape. It does not expose another type or function merely
because Geometry also exports it. This is an import view of Geometry, not a new
home module for the selected type.

For a selected record Point, the existing same-name constructor fallback permits
`Point({ x = 1.0, y = 2.0 })`. No new unqualified constructor bindings are seeded
by the import. Bare consumers and other modules importing full Geometry refer
to the same declaration and constructor identities, despite section 1.1's
prohibition on mixing both forms in a single consumer.

The modifier does not alter a declaration's public face. In particular, an
opaque import cannot construct, destructure, update, or inspect hidden data.
Alias expansion does not remove opacity or grant access to a hidden constructor.

## 3. Existing expression and pattern rules

A known scrutinee type continues to supply its constructors in constructor
patterns under Pattern Matching's existing rules:

```hexagon
import bare Shape from Geometry

let shape = Shape.Circle(2.0)

let radius = match shape
    Circle(r) => r
    Rectangle(_, _) => 0.0
```

The example presumes those two public cases. Expression-side construction does
not gain expected-type constructor lookup: outside a pattern the ordinary
qualified expression spelling is still required unless another existing rule
supplies an unqualified binding.

The prelude already supplies Some and None unqualified in expressions and
patterns. That existing convention survives a bare Option dependency. Seq can
continue constructing Some/None and matching them without a source-wide
qualification edit. Non-prelude types gain no equivalent ambient bindings.

The selected view does not include user-defined `pattern` operations. Built-in
constructor matching and public record destructuring are data operations and
remain available independently of those declarations.

## 4. Function-valued data

```hexagon
// Producer, unchanged ordinary source:
export record Transformer(a) = { apply: a -> a }
```

A consumer can import this record bare, construct a value with a function it
supplies, and call a public function-valued field. No function body is supplied
by the record declaration. The producer of a value retains any dependencies
needed to obtain that function; consumers can call the passed value without
statically importing the function's implementation module.

The same rule covers function-valued union payloads and function aliases.
Function signature components remain type dependencies. Existing restrictions
on effect annotations, polymorphism, and declaration parameters are unchanged.
Bare imports neither make effects pure nor erase call marks.

## 5. Instances and derivation

```hexagon
export union Option(a) derives (Eq, Show) =
    | Some(value: a)
    | None
```

A bare import selects Option and its public constructors, not the Eq/Show
instances. `derives` remains authoritative source syntax and elaborates to
ordinary instances in the full implementation. It does not attach an instance
provider or its implementation dependency to the bare data view.

Derived and handwritten instances have exactly the same activation boundary:
a bare import activates neither. The type is not copied into a version with
fewer intrinsic capabilities; instances are separate declarations associated
with the same type identity. Orphan ownership stays at the original source
module, and the existing one-instance-per-constraint/type rule remains global.

For a record Wrapper containing concrete Payload, Wrapper's bare data definition
requires Payload's data definition. Its derived Eq instance belongs to the full
part and acquires the dependency on Eq<Payload> there. That dependency does not
make the bare record invalid. Pattern matching on constructors needs no Eq
instance. No derived instance may be synthesized merely to satisfy a bare
consumer's equality, showing, or other constraint demand.

An independently activated full module can make its instances globally
available under the existing globality rule; a bare import does not suppress
those instances program-wide or choose alternatives. A concrete use still
needs its actual full-provider dependency, including operator elaboration,
interpolation, honored-member dispatch, and generated dictionary references.
Section 7 applies the same source-module restriction to implicit provider
dependencies. Another module loading the provider does not permit a consumer
with bare access to acquire a forbidden full-provider dependency. Any permitted edge also participates in
cycle checking. Omitting a provider from written imports never erases an edge.

## 6. Data dependencies and scope

Selecting a definition also requires enough supporting type information to
interpret it. Nested fields, constructor slots, function signatures, transparent
alias expansions, and required representation metadata must resolve to their
original declarations. Supporting definitions do not acquire local names in
the consumer, and their presence grants no extra public constructors or exports.

The compiler follows data-definition references without automatically following
implementation references or loading the implementation's imports and effects.
This separation cannot be decided by a lexical scan or by dead-code elimination.
The producer's normal module/package resolution determines which declarations
its written names denote; bare selection does not reinterpret those names in
the consumer's environment.

Compiler-provided primitive types retain their established identities and need
no load of an ordinary companion merely to be used as types. References to
ordinary data declarations retain their data dependencies. Supporting metadata
needed to interpret an otherwise legal type expression does not export the
referenced names or activate their implementations. In particular, this is not
permission to select a constraint, import its default bodies, or obtain evidence
through the restricted view. No new type-expression form is introduced. Private
supporting data stays private, and existing private-in-public checks still apply.

Mutually recursive data declarations already legal within one module remain
legal. This does not introduce mutually recursive modules; actual cross-module
data cycles must be rejected. Aliases retain their existing recursion rules.
Section 10 records remaining precision needed for this data-closure contract.

## 7. Full operations and dependency checking

A restricted alias contains only its selected data exports: `Shape.area` is not
made available because another module reaches full Geometry. Replacing the bare
selections with an ordinary full import allows full access through Geometry.
Nominal identity, companion ownership, and the meaning of a resolved call never
vary by importer.

Dot-call and instance resolution must account for the actual implementation
provider. A call does not become a record-field call, select a rival method, or
invent a new companion merely because its intended full operation is unavailable.
A bare import alone must not activate a missing full companion through lookup.
An independently available full provider can be used only with its real checked
dependency edge. A genuine full dependency is allowed when acyclic; bare imports
are not an escape from cycle checking.

For each consumer, record the resolved source-module identities of its bare
selections. A full companion operation or concrete instance provider whose home
is in that set remains the same candidate but is unavailable to that consumer.
The checker refuses the full-provider use and names its actual owner; it does
not reinterpret a dot call, choose another instance, or activate the full part.
This covers operators, interpolation, implicit dictionaries, aliases, and
compiler-generated imports as well as explicit qualified calls. A full provider
active through another root or module does not bypass the restriction.

The repair is to replace the bare selections with a full import, not to add a
full import beside them. For a full operation requiring a different provider,
existing lookup rules apply and the real provider edge is checked for cycles.
This is an availability check, not a new operation-selection or instance-
coherence rule. The per-consumer restriction does not hide an instance from
other modules or remove it from global duplicate-instance checking.

Calling a supplied function value or using evidence supplied as a parameter
creates no static reference to that implementation's home by itself. These
ordinary value operations remain allowed; a concrete compiler-selected instance
or named companion call is different because it identifies a fixed provider.

The central accepted shape is:

```text
Option full -> Seq full -> Option data
```

A call from Seq to Option.toSeq would require Seq full -> Option full, closing
the cycle. It must be rejected. The same applies to an implicit full-provider
edge introduced by an instance use. The diagnostic must describe the parts and
source uses forming the cycle, rather than claiming the data-only path alone
is cyclic.

Explicit full imports still create full dependencies even when their aliases
are unused, preserving the existing load-order promise. Source full cycles are
not removed by noticing that a particular compilation could optimize away calls.

## 8. Output and initialization

Logical module identity remains the declared package/module name. Bare imports
require separate compilation/emission units for data support and full code;
they do not require separate source files or author-written interfaces.

The emitted data unit owns the necessary constructor support and TypeScript
data identities. Full output references/re-exports those same definitions and
adds the module's ordinary exports. Public opaque brands are declared once.
No equality/showing implementation, constraint default, companion operation, or
public evidence handle/factory belongs in the data output.

Bare consumers import the data output directly, not through a full facade that
would recreate the dependency. Full public JavaScript and `.d.ts` entry points
retain the usual module names and expose the complete public API. Public evidence
obligations remain obligations of full output, including when no Hexagon call
currently consumes the evidence; they cannot force full output into a bare-only
runtime dependency.

TypeScript declaration references must resolve to emitted files and preserve
one identity under both routes. Internal linkage may carry private support
between generated units, but it must not leak through the selected Hexagon view
or full public declaration surface. Internal filenames must be deterministic,
collision-free, and separate from user-declared module output names.

A bare import initializes data support only. It does not execute top-level
expressions or initialize values from the full implementation. Full initialization
initializes its data support first and retains source order among its ordinary
imports and top-level executable items. Each generated unit initializes once.
Foreign declarations in the full part are not moved into data support.

## 9. Prelude integration

The prelude remains implicit for ordinary user code. Its ordered availability
must distinguish a data definition from the full module that provides instances
and functions. The inventory makes Option's data available
at its earlier data seat and its full implementation available immediately
after Seq. The Option data selection is the canonical Option union; other
prelude entries retain their order unless a stated dependency requires a change.
All later ordinary consumers obtain full Option as before; Seq uses only its
data view. Its existing Some/None expressions stay unchanged.

"Later" here means after the full availability seat. Modules between Option's
data seat and full seat see its data definitions only. Each part is checked
against the prefix at that part's own seat: Option's full body sees Seq because
its full seat follows Seq. It is not checked against the earlier data seat's
scope. Own declarations retain their existing source-order and privacy rules;
the earlier data check and later full check refer to the same symbol identities.
This is an explicit amendment to the old module-wide predecessor rule, not an
undocumented forward lookup from the early Option seat.

`import bare Option from Option` in Seq source must be permitted as an explicit
statement of this restricted dependency. This amends Modules section 5.5's ban
on imports in prelude source for the new form. It does not permit arbitrary
forward full-module access or move all prelude declarations into one scope.
An early data seat grants no instances. The full seat checks/activates the
instances, including the derives clauses retained on the source declaration.

Prelude name availability is not an instruction to initialize every full
prelude module. Runtime loading follows explicit imports and actually required
provider edges. An explicit bare selection of a prelude type in ordinary user
source occludes the corresponding ambient full view for that consumer and
blocks its full providers under section 7. Existing unqualified prelude
constructors remain available and resolve to data support. An independently
required full provider can initialize normally for other consumers; bare access
does not cancel someone else's full dependency.

The same mechanism must work for a user module without prelude privileges.
Data selection, identity, and emission must not be implemented as an Option
special case. The inventory is special only in choosing what is available
implicitly and when.

## 10. Checking and data-unit construction

### 10.1 Resolved data closure

Begin at the selected declaration and follow the resolved types in its public
face: record fields, union payloads, alias expansions, nested function signatures,
and other metadata necessary to interpret an existing legal type expression.
The closure carries identities, arity, visibility, and variance, not names added
to the consumer's scope. Opaque selection carries the public type shell and its
promised variance; it does not require its hidden representation in data output.
The full source check still verifies opacity and representation claims.

Same-module recursive data declarations are handled together under existing
recursion rules. A strongly connected group crossing module boundaries is a
cross-module data cycle and is refused. Only supporting declarations reachable
from a selection enter its data closure; unrelated exported types in the same
source module must not introduce dependencies into that selection. Transparent
aliases preserve their existing expansion and recursion semantics.

Excluded implementations do not become data merely because their signatures
are visited. Private supporting metadata stays private. Any compiler-held or
foreign type metadata required to interpret a legal face carries no permission
to initialize a foreign binding or expose its constructor through the view.
Existing FFI face restrictions continue to apply.

### 10.2 Validation is not activation

Selecting a type does not license a broken producer. The producer source is
parsed and checked, including its full declarations, derives clauses, and
function bodies, with its ordinary name resolution and dependency contracts.
An invalid declaration or body is an error even if this consumer selected only
a type. Explicit full-import cycles in producer source are not erased merely
because a particular runtime slice would not execute them.

This validation is separate from program activation. Reading or checking a
full declaration does not add its instances to the active program or execute
its imports and effects. The validation context checks the producer's own
obligations without treating dormant providers as available to bare consumers.
Program-wide instance activation and duplicate checks follow the full nodes
actually activated in the program; every selected concrete provider must have
an allowed checked dependency. No check may accept a bare consumer using an
instance merely because validating the producer encountered that instance.

Provider recognition must not depend on which full body is checked first. In
`A full -> B full -> A data`, B must still recognize A's otherwise applicable
companion operations and instance heads as unavailable providers under section 7.
The implementation must resolve the necessary provider interfaces before deciding
those uses, or reconcile deferred uses against the resolved providers before
accepting the program. This metadata preserves declaration identity, resolved
signature types and aliases, instance heads, and actual provider ownership;
collecting names lexically is insufficient. Discovering a provider neither
activates it nor permits a fallback that its unavailability would otherwise
forbid. No author-written signature file is required.

### 10.3 Stable data units

The emitter may group a selected declaration with its same-module recursive
data group. It must not replace selection with whole-module data emission where
that introduces unrelated dependencies. Each declaration/recursive group has
one data owner within a compilation, shared by all selections and full users.
Adding an unrelated selection must not duplicate or rename an existing owner's
constructor/brand identity. Internal paths are deterministic and reserved
against collision with valid user module paths.

Metadata-only links between declaration files must not become full JavaScript
imports. Full public entry points re-export the same public types and constructor
values; instances and their public evidence remain in full output. Opaque brands
have one declaration site, and private linkage is absent from public faces.

The combination of the allowed source-part graph and emitted graph must be
acyclic. No optimization, generated wrapper, or public facade may bypass a
forbidden full-provider edge. A diagnostics-only metadata traversal is not a
runtime load, and a runtime import cannot be excused as merely metadata.

## 11. Diagnostics and conformance requirements

The implementation must cover at least:

- Selection of each eligible declaration form; rejection of every excluded form
  with a message naming the selection and a valid full-import route.
- Multiple bare selections from one source module; rejection of mixed bare/full
  imports in either order and under alternate full aliases. Separate consumers
  may use different modes while preserving common nominal/constructor identity.
- Selected type/constructor qualification and the normal same-name fallbacks;
  no unqualified constructor injection except existing prelude/pattern rules.
- Nominal identity under bare and full imports, including opaque brands and
  generic records/unions crossing module and package boundaries.
- Public field operations and function-valued data; refusal of hidden opaque
  construction, field access, update, and destructuring.
- No activation of either derived or handwritten instances through a bare import.
  Full activation, global coherence, missing-provider diagnostics, and the
  cycle introduced by a statically selected full instance must be covered.
- Aliases, nested type dependencies, private support, and existing same-module
  recursive types; rejection of genuine cross-module data cycles.
- A working Option full -> Seq full -> Option data graph and a refused actual
  reverse implementation call; no implicit full facade edge in emitted output.
- A top-level-effect probe proving that bare imports do not initialize full code
  and mixed full/bare imports initialize each necessary unit only once.
- JavaScript runtime execution and TypeScript declaration checking, including
  first-class constructors, direct constructor calls, public re-exports, and
  bare-only output without dangling declaration imports or instance factories.
- Preservation of normal behavior for modules/programs using only full imports.

These are requirements for executable tests, not a report of passing tests.

## 12. Required specification amendments

This feature amends the corresponding rules in the authoritative documents:

- Modules: import grammar/views, prelude availability, part-level loading and
  cycles, global provider dependencies, and multi-unit emission.
- Lexer: the new contextual import modifiers/separator positions.
- Declarations Preamble and Constraints: type selection versus full derivation
  validation/activation; unchanged data syntax and instance ownership.
- Method Syntax and Pattern Matching: restricted availability, unchanged
  constructor lookup, and checked synthesized implementation dependencies.
- Packages and FFI declaration/evidence rules: emitted part reachability,
  stable public module paths, nominal/opaque identity, and full-only evidence.

Terminological edits use "unqualified" for names without module qualification,
with "plain name" acceptable in explanatory prose. Historic uses of "bare" in
that sense must not be read as the new import modifier. Avoid a blind global
replacement: existing uses such as a bare expression or an unconstrained binder
may have a different meaning.
