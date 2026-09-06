# Effect contracts and inference — proposal for Fable

**Status:** Proposed, non-normative; 2026-09-06. No compiler changes or soundness
proof are claimed. This records the design direction agreed in discussion and
the checks needed before adoption.

## 1. Two levels: implementation and interface

Ordinary functions, including `honor` implementations, retain inferred effects.
A constraint member explicitly declares what callers may assume and what
implementations must satisfy:

> Accept everything the interface promises to accept, and perform no more
> effects than the interface permits.

For constant outer effects:

| Inferred implementation | Pure contract | Effectful contract |
|---|---|---|
| Pure | Accepted | Accepted |
| Effectful | Rejected | Accepted |

This is directional compatibility at the implementation/interface boundary,
not equality-based unification. It does not introduce general function
subtyping or change ordinary function-argument checking. The implementation
keeps its inferred effect; the member exposed through the interface has the
declared contract.

## 2. Explicit constraint headers; inferred ordinary headers

Explicit effect contracts already coexist with inferred function effects.
The existing [`Seq.map`](../../stdlib/Seq.hex) demonstrates the distinction:

```hex
export fun map(source: Seq(a), transform: a -> b): Seq(b) =
    Seq({ pull = () =>
        match next(source)
            None => None
            Some((value, rest)) => Some((transform(value), map(rest, transform)))
    })
```

`transform: a -> b` explicitly requires a pure transform; an effectful function
is rejected. The `Seq` field type independently requires `pull` to be pure.
`map`'s own invocation effect is inferred from its body. These existing demands
keep deferred sequence production pure and compatible with memoization.

Thus "inferred ordinary headers" means the function's own effect is inferred,
not that all arrows inside its parameter types are inferred. This proposal
extends the existing explicit arrow vocabulary to constraint member headers;
it does not introduce explicit effect contracts for the first time. The new
semantic rule is directional satisfaction at the constraint boundary, including
a pure implementation satisfying an effectful member contract. Ordinary
function-argument checking, including `Seq.map`'s purity demand, stays unchanged.

Proposed syntax:

```hex
constraint Show<a> =
  show(value: a) -> String

constraint Readable<a> =
  read(source: a) ->! String

constraint Runner<r> =
  run(runner: r, action: () ->? Unit) ->? Unit

constraint Transactional<t> =
  run(transaction: t, action: () ->? Unit) ->! Unit
```

Examples are independent declarations, not a proposed set of same-module
member names. The outer arrow is mandatory, including on members with default
bodies. Parameters keep `:`. Existing pure member headers migrate from
`name(params): Result` to `name(params) -> Result`.

The syntax follows one distinction: **implementations infer their invocation
effect; function types and member contracts state it.**

| Position | Spelling | Invocation effect |
|---|---|---|
| Ordinary function implementation, including `honor` and `widens` implementation headers | `: Result` when a result annotation is written | Inferred, then checked against any required contract |
| Constraint member contract, including one with a default body | Mandatory `-> Result`, `->! Result`, or `->? Result` | Explicit contract; any default body is checked against it |
| Extern callable contract, including intrinsic declarations | Mandatory effect arrow before result | Explicit contract; responsibility depends on boundary ownership (§7) |
| Written function type, including a callback parameter's type | `->`, `->!`, or `->?` | Explicit in the type |
| Inline lambda implementation | Existing term arrow `=>`; `: Result` if annotated | Inferred from its body, subject to any required type |

An implementation header never substitutes an effect arrow for its return
annotation's `:`. A constraint member header never substitutes `:` for its
outer effect arrow. Existing annotation requirements remain; this proposal does
not make currently required result annotations optional. Delegation forms
without implementation headers need no new punctuation.

The distinction is about the outer separator, not arrows nested inside types:

```hex
let defer(action: () ->? Unit): (() ->? Unit) =
  () => action?()
```

The return annotation describes the returned function's effect, not `defer`'s
own effect. Callback type annotations are explicit function types; inline
lambdas are implementations. Their `=>` introduces a body and is never an
effect arrow. No mandatory effect marks are added to lambda syntax.

This separates source contracts from inferred implementation behaviour, not
effect inference from type inference: effects remain components of function
types, and linked variables must participate in checking and generalization.
Existing full function-type annotations/ascriptions remain available for
deliberately protected boundaries; the implementation's inferred effect must
still satisfy them.

Extern callable declarations have no body to infer from and belong to the
explicit-contract side. Section 7 replaces their implicit effectful default and
special effect modifiers with mandatory arrows, preserving boundary ownership.

This incurs a pre-release migration, but subsequent contract annotation changes
are needed only when the interface changes, not when an implementation becomes
more or less effectful within its allowance.

## 3. Calls use the exposed contract

```hex
let readLength<a: Readable>(source: a): Int =
  source.read!().length()
```

`Readable` permits effects; this caller cannot assume purity. `readLength` is
therefore inferred effectful, even if a particular instance reads immutable
in-memory text purely.

Every call resolved through the member uses its declared effect, including
calls on known concrete instances and qualified companion calls. Specialization
must not change required source marks. Member references remain unmarked and
carry the interface's callable type; a separately exposed ordinary helper can
retain its more precise inferred type.

### `widens` preserves the interface effect

There is no `widens` exception to this rule. If the supplied constraint member
permits effects, calls to its `widens` implementation require `!`, including
direct qualified and dot calls, even when the body is pure. References to the
widened binding likewise expose that interface effect. Knowing the concrete
implementation does not grant a purer callable contract.

The body's effect is still inferred, then checked for compatibility. A
`widens` header continues to use `: Result` when a result annotation is written;
it need not repeat the member's effect. Separate the body's inferred behaviour
from the effect exposed by the binding. The public argument seats remain wider,
but the public invocation effect comes from the constraint contract.

This deliberately qualifies the existing generalisation law in Constraints
§4.7, Modules §5.3, and Method Syntax §6.1: exposing the operation's widest
argument face does not expose a more precise implementation effect. Those
specifications must be revised together; this is an intended semantic ruling,
not an implementation detail to resolve by inference.

The rationale is minimal churn under a stable interface:

| Body change under an effectful member contract | Agreed public effect | Rejected inferred-effect exception |
|---|---|---|
| Pure to effectful | Calls remain `!` | Direct calls change from bare to `!` |
| Effectful to pure | Calls remain `!` | Direct calls change from `!` to bare |

Under the rejected exception, changes can propagate through callers' inferred
effects as well. Under this agreement, changing an implementation within the
interface's allowance does not change those callers' effect classification.
The cost is intentional: a pure implementation behind an effectful member
cannot be used as pure through that member or its widened binding. A separately
named ordinary helper may expose a pure operation when that is part of the
author's intended API; the compiler does not expose one automatically.

### Meaning of the call marks

The readings are:

- Bare: invocation is statically guaranteed pure.
- `!`: invocation may perform effects; the exposed type gives no purity guarantee.
- `?`: invocation carries the enclosing signature's linked effect variable.

`!` does not promise an observable action on every execution. A conditional or
a pure implementation behind an effectful interface may perform none. Exact
mark checking remains: the required mark matches the exposed arrow.

## 4. Callback effects preserve a relationship

`Runner.run` promises to accept both callback effects. Its outer allowance is
the same variable as its callback's effect:

| Callback supplied | Allowed implementation effect |
|---|---|
| Pure | Pure only |
| Effectful | Pure or effectful |

Calling the callback, conditionally calling it, and ignoring it all satisfy this
effect contract. Ignoring it may violate a separate behavioural law. Independent
I/O fails because the implementation must also satisfy the pure instantiation.

By contrast, `Transactional.run` accepts either callback effect but permits
independent effects; its calls always require `!`.

Each member owns one implicitly quantified effect variable, shared by its
written `->?` occurrences and freshly instantiated per call. It is not fixed
per instance. The existing inlet requirement remains. This is a deliberate
extension to the current member-polymorphism rules, not permission for arbitrary
member-specific type parameters.

Compatibility must preserve input acceptance. A member accepting either callback
effect cannot be implemented by a function that only accepts pure callbacks.
Do not implement compatibility by indiscriminately allowing pure-to-effectful
replacement at every nested arrow. Higher-order inputs and returned functions
need a precise directional rule; checking both substitutions of the single
contract effect variable is the basic obligation, not a complete algorithm.

## 5. Give `?` one meaning; fix inference separately

`?` names a preserved type-level effect dependency. At an inferred function it
records that function's dependency; at an interface it declares the relationship
callers may rely on. It does not assert that every implementation executes the
callback, and it must not mean merely "inference is unresolved here."

Withdraw Effects §3.3–3.4's rule that an undetermined call inside an inlet-bearing
body conservatively conducts solely because that body has an inlet.

```hex
let apply(action: () ->? Unit) =
  action?()

let defer(action: () ->? Unit) =
  () => action?()
```

Intended inferred types:

```text
apply : (() ->? Unit) ->? Unit
defer : (() ->? Unit) -> (() ->? Unit)
```

Accepting, capturing, or returning a callback does not itself invoke it.
Closure construction stays pure in both ordinary and inlet-bearing contexts.
The same correction applies to `compose` and `Stream.map`/`filter` construction.

This requires a specification and inference change, not new header syntax.
Distinguish proven absence of effects from an unsolved effect; do not simply
default unresolved variables to pure earlier. Recursive groups, body-close
settling, expected types, and escaping closures need explicit validation.

## 6. Keep pure protocols pure

The current blanket restriction on constraint effects is stronger than its
rationale. Unmarked implicit invocations require pure contracts; that does not
require every explicitly callable member to be pure.

Preserve pure arithmetic, indexing, `Show`, pattern views, and `Iterable`.
`Stream` is not an `Iterable`: its traversal is effectful. No marked `for`
syntax or relaxation of those protocols is proposed.

## 7. Extern contracts: calling convention and effect are independent

The foreign declaration keyword specifies **how JavaScript is invoked**; its
effect arrow specifies **what effects Hexagon callers must accommodate**.
Every callable extern header writes `->`, `->!`, or `->?` before its result.
There is no omitted-effect form and no return-separator `:` on these headers.

```hex
extern from "./operations.js"
    export fun trim(text: String) -> String
    export fun read(path: String) ->! String
    export fun run(action: () ->? Unit) ->? Unit
    export fun defer(action: () ->? Unit) -> (() ->? Unit)
    export fun transaction(action: () ->? Unit) ->! Unit
```

These are illustrative contracts, not assertions about an existing library.
The old effectful default becomes an explicit `->!`; `pure` becomes `->`;
`conduit` becomes `->?`. Retire those two effect modifiers in this declaration
role. The inlet and one-linked-variable rules still apply. This does not enable
arbitrary foreign type polymorphism, which remains separately restricted.

**When the author does not know the effect, recommend `->!`.** This is conservative
author guidance, not a language default. It promises neither purity nor a linked
dependency. Omission is an error, never an accidental pure claim. Requiring an
arrow loses no effect expressiveness; it costs a pre-release migration and makes
every callable boundary contract explicit.

### Receiver members and statics

The same rule applies to `method`, `get`, and `set`, and their static forms:

```hex
method trim(text: String) -> String
method send(socket: Socket, text: String) ->! Unit
get status(response: Response) ->! Int
set timeout as setTimeout(request: Request, value: Int) ->! Unit
```

Receiver parameters, aliases, arity rules, and convention-preserving wrappers
stay unchanged. All these forms expose ordinary Hexagon functions. A getter is
invoked as `response.status!()`, not a bare field access; a setter is invoked as
`request.setTimeout!(5000)`. References remain unmarked.

`get` specifies a foreign property read, not a purity guarantee. A mutable read,
getter, or proxy interaction requires an effectful allowance unless a stronger
contract can be justified. A truthful pure declaration over stable foreign data
may use `->`.

Reconcile FFI Part 5 §3.1's unconditional fresh-read/no-hoisting rule with this
contract: lowering performs a property read per surviving invocation, while
the declared effect governs legal purity-based transformations. A read whose
freshness is observable must use `->!`; `get` carries no additional hidden effect
that overrides an explicitly pure contract.

`set` still requires a `Unit` result. Ordinary foreign-state mutation must use
`->!`. Do not force the arrow from the calling-convention keyword alone: a
foreign accessor setter could discard its input or invoke a supplied callback.
A pure or linked setter declaration is permitted only under its corresponding
trusted obligation. Static members follow the same rules with their existing
receiver/parameter conventions.

### Constructors

Replace the implicit-result constructor header with a complete arrow contract:

```hex
extern from "./channel.js"
    export class Channel
        new as create(address: String) ->! Channel
```

The result must be the enclosing class's declared type; check it rather than
allowing an arbitrary result. This deliberately repeats the known result to
retain ordinary effect-arrow grammar. Each constructor alias declares its own
contract. Allocation alone is not an effect: a constructor satisfying purity may
use `->`, while opening a connection requires `->!`. Linked constructors must
satisfy the same inlet and dependency rules as other callable contracts.

### Ownership and non-callable declarations

User extern contracts remain trusted author assertions. Explicit arrows do not
prove the foreign code correct. Intrinsic contracts use the same explicit syntax,
but satisfying them remains the compiler implementer's conformance obligation.
The ownership distinction does not need different effect notation.

Non-callable values retain `let version: String`; type and class declarations
have no invocation effect of their own. Function-typed fields retain their
existing type-arrow rules. Foreign module initialization and `extern import`
effects are separate from invoking declared callables and are unchanged here.

## 8. Fable review and adoption checks

Before promoting this proposal:

1. Specify implementation/member compatibility, especially nested arrows,
   returned functions, callback acceptance, and per-member effect quantification.
   Validate the pure implementation of an effectful contract without making
   equality-based unification silently directional elsewhere.
2. Verify dictionary representation and extraction preserve the declared member
   face, including known instances, aliases, defaults, recursive member calls,
   derived implementations, and exported semantic interfaces. Any adaptation
   must preserve invocation timing and multiplicity.
   Include direct `widens` calls and references: their wider argument types must
   retain the interface effect even for pure bodies. Specify compatibility for
   a single `widens` binding supplying multiple member contracts; conflicting
   effect contracts must not silently select a public effect or restore the
   rejected inferred-effect exception.
3. Validate the inference correction on immediate versus deferred callback calls,
   `compose`, Stream construction, recursive groups, and expected-type propagation.
4. Add conformance cases for the constant compatibility table; linked members
   accepting both callback effects on the same instance; rejection of independent
   I/O under a linked outer contract; rejection of pure-only callback acceptance;
   and stable call marks through generic and concrete member access. Include
   pure/effectful body changes beneath an unchanged effectful `widens` contract:
   qualified calls, dot calls, and aliases must retain `!` in both versions.
5. Validate extern parsing and displayed faces for all three arrows on functions,
   receiver/static members, and constructors; retain `Unit` setter and enclosing
   class result checks. Test omission diagnostics, modifier migration, linked
   inlets, wrappers, and marked calls. Audit fresh-read semantics against the
   declared effects and ensure no foreign runtime verification is implied.
6. Update `constraints.md`, `effects.md`, `functions.md`, `stream.md`, relevant
   dictionary/interface specifications, diagnostics, stdlib declarations, and
   examples together. Existing claims that all constraint arrows are pure and
   that interface/body effects must always match exactly need scoped revisions.
   Include FFI Parts 4–5, `intrinsics.md`, generated declarations, and the removal
   of extern effect defaults/modifiers and implicit constructor results.

The proposed direction retains inferred implementations and exact call marks,
adds explicit effect allowances at constraint and extern boundaries, and removes
contextual uncertainty as a second meaning of `?`. It improves contract clarity;
soundness of the new compatibility and inference rules remains to be validated.
