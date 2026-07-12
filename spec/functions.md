# Hexagon Spec: Functions

**Status:** Settled design. Written for Claude-as-implementer.
**Scope:** Function definition, lambdas, `let`/`fun` binding of functions, application, arity, generalization, naming, and JS emission.
**Out of scope (own specs):** modules, operators (including `|>` details), constraints (touched only where syntax demands), tuples, FFI/extern, LSP display format, pattern matching.

---

## 1. Design stance

Hexagon targets JS developers with moderate FP capability and compiles to idiomatic, readable JavaScript. The function design follows from decisions already fixed elsewhere:

- **No currying.** All arguments are supplied at once.
- **Functions are genuinely n-ary.** Internally `TFun([A, B], C)`; emitted as n-ary JS functions; arity is a property of the function, checked at every call site.
- **Types are optional.** Untyped definitions are the primary form; inference (HM, Algorithm J) supplies types. Annotations exist for comprehension and for constraining, not because the compiler needs them.
- **SML as flavor, not semantics.** Surface conventions are borrowed from Standard ML's uncurried style — `()` for the nullary case, no 1-tuples, tuple-shaped parameter lists — but the parameter list is *not* a tuple value. See §5.

---

## 2. Naming

Function names (like all term-level bindings) **must begin with a lowercase letter**. An uppercase-initial name in term-binding position is a **hard compile error**, not a warning. Uppercase initials are reserved for types and constructors (the Haskell rule). This gives the resolver a free syntactic distinction between binders and constructors, which pattern matching will later rely on.

---

## 3. The primary (type-free) forms

These are the forms users should reach for first. Everything in this section typechecks by inference alone.

### 3.1 Lambdas

```
x => body                 -- one parameter, no parens needed
(x) => body               -- identical; parens are grouping, not a 1-tuple
(x, y) => body            -- two parameters
() => body                -- zero parameters
```

- Parameters are comma-separated inside parens; a **single parameter may omit the parens**. `(x) => e` and `x => e` are the same term — `(x)` is redundant grouping, consistent with "there is no 1-tuple."
- Body is an expression. Block bodies use the language's ordinary block form; the block's final expression is the lambda's value.
- A lambda is a *syntactic value*: constructing it evaluates nothing. This property is load-bearing for §7 (`fun` hoisting) and §8 (value restriction).

### 3.2 `let`-bound functions

**Prefer `let` over `fun` whenever there is a choice.** `fun` exists for recursion (self- or mutual); everything else is a `let`.

```
let double = x => x * 2
let plus = (x, y) => x + y
let plus(x, y) = x + y          -- header sugar: same AST node as the line above
```

Header syntax (`let f(params) = body`) is pure sugar for `let f = (params) => body`. The parser produces the **identical AST node** for both — equivalence is by construction, not by two code paths agreeing.

### 3.3 `fun`-bound functions (recursion)

```
fun fact(n) = if n <= 1 then 1 else n * fact(n - 1)
fun fact = (n) => if n <= 1 then 1 else n * fact(n - 1)   -- same AST node, same emission
```

Same header/lambda sugar equivalence as `let`. The differences from `let` are scoping and recursion, specified in §7.

---

## 4. Typed forms

Annotations serve comprehension and constraint-attachment. They never change what inference *could* derive except by restricting it.

### 4.1 Parameter and return annotations

```
let plus(x: Int, y: Int): Int = x + y
let log(msg: String): Unit = print(msg)
let plus = (x: Int, y: Int): Int => x + y
```

- Parameter annotations: `name: Type` inside the parameter list.
- Return annotation: **colon after the parameter list** — TypeScript/C#/Scala/Kotlin style. There is no `->` in source; arrow notation is an LSP display dialect only (specified elsewhere).
- Any subset of annotations may be given; inference fills the rest.
- **No standalone signature lines.** Types are written only on definitions.

### 4.2 Explicit type parameters

Angle-bracket syntax, settled form:

```
let plus<a: Num>(x: a, y: a): a = x + y
let plus = <a: Num>(x: a, y: a): a => x + y      -- equivalent, same AST node
```

- Form: `<typevar: constraintList>` where `constraintList` is a single constraint or a parenthesized list `(C1, C2, ...)` meaning *all* listed constraints hold. The tuple notation is suggestive (conjunction is a product); it is not a real tuple. Example: `<a: (Eq, Show)>`.
- Multiple type variables: `<a: Num, b: Show>` etc.
- An unconstrained variable may be written bare: `<a>`.
- Type variables are **lowercase** (ML convention); this is consistent with §2's case rule at the type level.
- **Explicit type parameters do not create polymorphism** — inference generalizes anyway (§8). They (a) name the variables for documentation and (b) attach constraints. If the declared type is *less* general than the body supports, the declaration wins (the function is deliberately restricted). If it is *more* general than the body supports, that is a type error.
- **Position restriction:** `<...>` type parameters are syntactically permitted only on lambdas in `let`/`fun` RHS position (equivalently, in header sugar). A `<...>`-annotated lambda anywhere else is a parse error. This prevents rank-2 types from being *expressed* here; rank-2 has its own annotation-gated pathway outside this spec's scope.

Constraint semantics (what `Num` means, superconstraints, `implement`) are the constraints spec's business. This spec fixes only the syntax above.

---

## 5. Application and arity

```
f()          -- call with zero arguments
f(x)         -- one argument
f(x, y)      -- two arguments
```

- Parentheses at the call site are **required**. There is no juxtaposition application.
- **Arity mismatch is a compile-time error**, reported directly: "`f` expects 2 arguments, got 1." Unification of function types checks arity first, then unifies parameters pointwise.
- **No partial application.** Wrap in a lambda: `y => f(1, y)`.
- **No placeholder shorthand** (`f(_, 2)` etc.). Explicitly none, for now; may be revisited at FFI time.
- **No splatting / no tuple application.** Given `let t = (3, 7)`, the call `plus(t)` is an arity error (one argument supplied, two expected). Parameter lists *resemble* tuples but are not tuple values; there is no implicit conversion in either direction. Someone holding a tuple destructures it: `let (x, y) = t` then `plus(x, y)` (destructuring per the tuples spec).
- **No optional, default, or named parameters** in pure Hexagon functions. (The FFI boundary may need its own story — `Nullable(a)` etc. — but that is the FFI spec's problem and must not leak into these semantics.)

### 5.1 The SML reading (pedagogy only)

The informal model "every function takes one thing — a single value, a tuple-shaped list of values, or nothing (`()`)" is a legitimate way to *teach* the syntax, and the Unit/Numeric spec's remarks about `()` are consistent with it. But the implementer must not encode it: function types are n-ary, calls are checked by arity, and no unit value is passed to `f()`.

### 5.2 Nullary functions and `Unit`

- `() => body` is a **zero-parameter function**. No argument (unit or otherwise) is passed; emitted JS takes no parameters.
- `Unit` appears in this spec only as a **return type** for effect-only functions: `let log(msg: String): Unit = ...`. Its literal `()`, JS representation (`undefined`), and constraint memberships are fixed in the Numeric spec.
- The parser must keep `()` (unit literal / nullary call syntax) unambiguous against grouping parens; coordinate with the tuples spec rather than special-casing.

### 5.3 Parameter order convention

Because the pipe operator inserts its left operand as the **first argument** of the call on its right (details in the operators spec), the standard library and idiomatic user code should put the "subject" — the value being operated on — **first**: `map(list, f)`, not `map(f, list)`. This spec records the convention; the operator itself is specified elsewhere.

---

## 6. `let` is non-recursive

Inside the RHS of `let x = ...`, any reference to `x` — at any nesting depth, **including inside lambdas** — is a compile error:

> `x` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`.

Implementation: a **pending-binder stack** in the name resolver. The binder name is pushed while its RHS is resolved and added to the environment only afterward; a lookup that hits the pending stack produces the targeted diagnostic above rather than a generic "unbound name."

Consequences:

- `let` permits no shadowing games via self-reference; the name simply does not exist yet.
- Recursion, including through a lambda (`let f = n => ... f(n-1) ...`), is impossible with `let` by design. This is what `fun` is for.

---

## 7. `fun`: recursive, hoisted, syntactically restricted

### 7.1 RHS restriction

The RHS of `fun` **must be syntactically a lambda literal** — written directly (`fun f = (n) => body`) or via header sugar (`fun f(n) = body`). Anything else is a compile error:

```
fun f(n) = body            -- allowed (header syntax)
fun f = (n) => body        -- allowed (lambda literal; identical AST, identical emission)
fun x = 5                  -- error
fun fib = memoize(...)     -- error
```

The check is **syntactic** (is the RHS node a lambda?), not semantic ("is this expression of function type?") — the latter cannot be checked before evaluation, which is exactly what hoisting must avoid.

Rationale: a `fun` is hoisted (usable block-wide, §7.2), and hoisting is only sound if creating the function requires **zero evaluation**. A lambda literal has that property; `memoize(...)` does not — it would have to *run* first.

### 7.2 Scope, capture sets, and the usable-from point

A `fun`'s **name** is in scope for its entire enclosing block. Whether it may be *used* (called, or referenced as a value) at a given point is governed by its capture set:

- Each `fun` has a **capture set**: the outer-block `let`/`var` bindings its body references, computed **transitively** — if `f` calls `g` (a `fun` in the same block), `f` inherits `g`'s captures.
- Using a `fun` before the textual point at which **all** its captured bindings are initialized is a **compile error**.
- Computed during name resolution: record outer-block `let`/`var` references per `fun`, then close transitively over the within-block `fun` call graph. This reuses the SCC grouping already needed for typechecking mutual recursion.

This is a compile-time guarantee against what would otherwise surface as runtime TDZ errors in the emitted JS.

```
fun greet() = print(message)   -- closes over message
greet()                        -- ERROR: message not yet initialized
let message = "hi"

fun greet() = print(message)
let message = "hi"
greet()                        -- fine — message initialized above
```

A `fun` with an empty capture set is usable anywhere in its block, including before its textual definition.

### 7.3 Mutual recursion

Mutually recursive `fun`s form a group (an SCC of the call graph):

- The group shares **one combined capture set**.
- The usable-from point for *every* member is where the **whole group's** captures are initialized.
- References between members **inside their own bodies** are always fine; the restriction applies only to references from ordinary block code.

### 7.4 Recursion is monomorphic

`fun` accepts type parameters freely and generalizes like `let` (§8). But **recursive calls — direct or mutual, within the SCC — are at the definition's own monomorphic type**; no polymorphic recursion. This requires no special enforcement: within the SCC the function's type is a not-yet-generalized monotype, so a recursive use at a different instantiation fails ordinary unification. Generic recursive functions (`map`, `fold`) work fine — the *outside world* instantiates them freshly; only the recursive knot is monomorphic.

### 7.5 Memoized recursion (the one restricted pattern)

`memoize` itself is an ordinary higher-order function and fully writable in Hexagon; `let cheap = memoize(expensive)` is unremarkable. The only restricted pattern is the self-referential one-liner `fun fib = memoize((n) => ... fib ...)` — rejected by §7.1, for the same reason OCaml's `let rec` rejects non-lambda RHSes. The blessed idiom is **open recursion**: write the function taking "itself" as a parameter, and tie the knot with a stdlib `memoFix`:

```
fun fibOpen(self, n) = if n <= 1 then n else self(n - 1) + self(n - 2)
let fib = memoFix(fibOpen)
```

(`memoFix` builds a map, defines a local `fun go(n)` that consults the map and calls `f(go, n)` on miss, and returns `go` — all expressible under these rules.) The spec-level summary: Hexagon supports memoization of any function and memoized recursion via open recursion; it rules out only the self-referential single binding.

---

## 8. Generalization (observable rules)

The inference engine is Algorithm J with union-find type variables and level-based generalization; those internals belong to the type-system spec. What this spec fixes is the observable behavior:

1. **Generalization happens at `let`/`fun` bindings** (and at module export, per the modules spec). A generalized binding is polymorphic; each *use* instantiates fresh type variables.
2. **Value restriction (ML-style):** a `let` RHS is generalized **only if it is a syntactic value** — a lambda literal, a literal, a constructor application of values, or a tuple of values. A function *call* is not a value:
   ```
   let xs = emptyList()
   ```
   `xs` gets a monomorphic type `List<?1>` with `?1` unsolved; the first use fixes it, permanently. Rationale: soundness once mutable cells or effectful FFI calls exist (`let r = makeRef(...)` generalized to `Ref<List<a>>` is the classic hole); adopting the restriction now avoids breaking code by retrofitting it later. The workaround is the familiar ML one: call the producer where the element type is known, or annotate.
3. **`fun` generalizes exactly like `let`** — its RHS is always a lambda (§7.1), hence always a value, so `fun` bindings always generalize. Recursive uses are monomorphic per §7.4.
4. **`var` never generalizes.** This is its own rule, independent of the value restriction.
5. **Lambda parameters are monomorphic within their scope.** Inside `(f) => ...`, the parameter `f` has one type per instantiation of the enclosing function; it cannot be used at two different types. The classic demonstration:
   ```
   let id = x => x
   (id(1), id("a"))                    -- fine: id is let-bound, each use instantiates fresh

   let apply = f => (f(1), f("a"))     -- ERROR: f is lambda-bound, monomorphic;
                                       -- cannot be both Int -> ? and String -> ?
   ```
   This is HM's let-polymorphism / lambda-monomorphism split and is the single most surprising rule for the target audience; diagnostics should be written with care here.
6. Header sugar and explicit-lambda forms generalize identically **by construction** (one AST node, §3.2).

There is a pleasing symmetry the implementer can lean on: hoisting (§7) and generalization (§8.2) are both privileges of syntactic values — of code that has not executed yet.

---

## 9. JS emission

Readable, idiomatic output is a language goal; emission shape is part of the contract.

| Hexagon | JS |
|---|---|
| `fun f(n) = body` / `fun f = (n) => body` | `function f(n) { ... }` — a hoisted function declaration |
| `let f = () => body` / `let f() = body` | `const f = () => ...` at its textual position |
| `let f = x => body` / `let f(x) = body` | `const f = x => ...` at its textual position |
| `let f = (x, y) => body` / `let f(x, y) = body` | `const f = (x, y) => ...` at its textual position |
| anonymous lambda in expression position | JS arrow function |
| `f(x, y)` | `f(x, y)` — n-ary call, no tuple/array allocation, no spread |
| `let log(msg): Unit = ...` | a JS function that simply returns nothing (`Unit` ↔ `undefined`, per the Numeric spec; `void` in `.d.ts` return position) |

Notes:

- The `fun` → `function` mapping is sound *because of* §7.1: the lambda-literal restriction guarantees the RHS is evaluation-free, so JS's hoisting of `function` declarations is a faithful translation of `fun`'s block-wide scope. §7.2's capture-set check then guarantees the emitted code never trips a TDZ error at runtime.
- The same lambda AST node emits differently depending on its binding (`function` under `fun`, `const` + arrow under `let`); the emitter dispatches on the binding form, not the RHS shape.
- Arrow emission preserves the zero/one/many visual model: `() =>` for no parameters, `x =>` for one, `(x, y) =>` for several. A grouped unary source lambda, `(x) =>`, and unary header sugar, `f(x)`, therefore emit the canonical `x =>` form; the redundant grouping is not preserved. TypeScript function types still use their grammatically required parenthesized parameter list in `.d.ts`.
- Names pass through unchanged (lowercase-initial Hexagon names are valid JS identifiers; reserved-word collisions are the emitter's problem to mangle, out of scope here).

---

## 10. Diagnostics checklist (implementer-facing)

| Situation | Error |
|---|---|
| Uppercase-initial function/binding name | hard error: names of term bindings must start lowercase (§2) |
| Self-reference in `let` RHS (any depth) | "`x` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`" (§6) |
| `fun` RHS not a lambda literal | error, syntactic check (§7.1) |
| Use of a `fun` before its (group's) captures are initialized | compile error naming the uninitialized capture (§7.2–7.3) |
| Call with wrong number of arguments | "`f` expects N arguments, got M" (§5) |
| Passing a tuple where multiple arguments are expected | arity error (§5); consider a hint suggesting destructuring |
| Polymorphic recursion | ordinary unification failure at the recursive call site (§7.4); consider a hint when the failing call is a self/SCC reference |
| Lambda parameter used at two types | unification failure (§8.5); diagnostic should distinguish this from other type errors if feasible |
| `<...>` type parameters on a lambda outside `let`/`fun` RHS position | parse error (§4.2) |

---

## 11. Deferred / cross-references

- **Tuples** (C#-value-tuple-flavored syntax, destructuring): own spec. This spec depends only on: no 1-tuples, `()` is the nullary case, no tuple↔argument-list conversion.
- **Operators**, including `|>` first-argument insertion: own spec. This spec contributes only the subject-first parameter-order convention (§5.3). Note for reading the examples: Hexagon prefers English logical operators (`not`, `and`, `or`, `implies`, `iff`) and uses `if ... then ... else ...` as its conditional expression — there is no C-style `? :` ternary.
- **Constraints** (`Num`, `implement`, superconstraints): own spec. This spec fixes only the `<a: C>` / `<a: (C1, C2)>` syntax.
- **FFI**: `Nullable(a)`, extern functions, possible revisiting of placeholders/optional parameters. Nothing here leaks into pure Hexagon function semantics.
- **LSP display format** (arrow notation, canonicalized constraint display): own spec; display-only, no round-tripping requirement.
- **Type-system internals** (Algorithm J, levels, union-find, bidirectional checking for rank-2): own spec. §8 states only the observable rules.
