# Hexagon Spec: Decisions — The `fun` Block

**Status:** Decided (August 2026; ruling on #700, closing the design question #368's review opened). Closure document, authoritative until consolidated into host specs per README authority rule 3 — this document is added to rule 3's closure-document list in this same change; the standing is conferred there, not claimed here. The construct is the headline of Hexagon v1.2.
**Scope:** the `fun` block — mutual recursion's one spelling (§2); the head and its binder (§3); per-member export (§4); the header-only rule for `fun`, everywhere (§5); the retirement of adjacency runs (§6); the `var` function-type ban (§7); emission (§8); diagnostics (§9); rejected alternatives (§10); the edit-notes ledger (§11); conformance obligations (§12); implementation notes (§13).
**Not in scope:** the monomorphic knot's typing and evidence (Functions §7.4 owns it; nothing here changes typing power — §3.4 states the invariance), the derivability doctrine (`decisions-ml-dialect-annotations-2026-08.md` §2.4/§9.11 — reaffirmed, not reopened), the match function's own semantics (Pattern Matching §6.7; §5 here retires only its `fun`-RHS seat), open defects in the same terrain (#702, #703, #704, #699, #705 — their records stand).
**Companions:** Functions §3.3, §4.2, §4.3, §7, §8, §9, §10; Modules §4.1.1; Statements & Mutability §2, §6; Pattern Matching §6.7; Lexer & Layout §2.1; Method Syntax §4.4; Doc Comments §4.2; `notes/canonical-formatting-and-naming.md`.

---

## 1. The ruling

> **Mutual recursion demands the `fun` block.** A `fun` head — the keyword alone, or carrying a binder list, `fun<a: Eq>` — opens a layout block of **members**: header-syntax function definitions that see one another, earlier and later alike. A lone `fun f(…) = …` is the fused spelling of the one-member block. The contiguous-run rule (formerly Functions §7.3) is **retired**: two adjacent `fun` declarations are two blocks, and a mutual reference between them is a hard error with the mechanical rewrite — make both members of one block (§6).
>
> **Export is per member.** An `export` marker sits at the member's left margin and exports that member. There is no head-export sugar (§4).
>
> **The head's binder is the block's.** Its type variables are rigid, scoped over every member, shared by exactly the members that write them — sharing is opt-in by placement — and its constraint list is the §4.2 contract for every member that mentions the variable. Members carry no binder lists of their own in v1 (refused, non-foreclosing — §3.3). An exported member's binder requirement (Modules §4.1.1) is satisfied by the head (§4.1).
>
> **`fun` is header-only, everywhere.** A member — fused or in a block — is written in header syntax only: `name(params)` with optional annotations, `=`, body. The lambda-RHS spelling (`fun f = (n) => …`) and the match-function RHS (`fun f = match …`) are retired — parse errors with mechanical rewrites (§5).
>
> **`var` may not have a function type.** Vars are data accumulators, not functions. The ban is type-level and fires wherever the `var`'s monotype resolves to an arrow — at the declaration or at the pinning use. Functions inside data are data and stay legal (§7).
>
> The block changes **no typing power**: it is pure scoping. The knot is still the strongly-connected component of actual references, still typed dependencies-first, still monomorphic (Functions §7.4); the derivability principle stands untouched (§3.4).

James's frame, recorded as the ruling's spine: **the special-purpose keywords get more specialised** — `let` stays general (values, lambdas, match functions), `fun` always shows its header, `var` accumulates data.

---

## 2. The construct

```
fun
    even(n: Int): Bool = if n == 0 then True else odd(n - 1)
    odd(n: Int): Bool = if n == 0 then False else even(n - 1)
```

```
fun<a: Eq>
    contains(xs: Vector(a), x: a): Bool = ...
    export containsAll(xs: Vector(a), ys: Vector(a)): Bool = ... contains(...) ...
```

- **The head** is `fun`, optionally followed — glued, no space — by a binder list in Functions §4.2's form, and nothing else on the logical item. It opens a layout block (Lexer & Layout §2.1 gains the row). An empty block is a parse error.
- **Members** are header-syntax definitions, one per block item: `name(params)[: Result] = body`, each opening its ordinary binding-body block. No `fun` repetition on member lines, and no `name = lambda` member lines (§5). Doc comments attach per member (Doc Comments §4.2).
- **Member names bind at the enclosing scope** — module level or the enclosing block — and are usable *after* the block per Functions §7.2. The block binds no name of its own; it scopes only the head's type variables. To code outside it, a block is ordinary.
- **Inside the block, every member's body sees every member**, earlier and later alike — the language's only forward visibility among terms, and it exists because mutual recursion cannot be spelled without it.
- **Non-cross-referencing members are legal** (SML: one declaration regardless). **Grouping bounds visibility, not typing**: the knot is the SCC of actual references, computed within the block, typed dependencies-first — two independent members do not restrict each other's generality.
- **The fused spelling.** A lone `fun f(…) = …` (binder, when present, in its Functions §4.2 position after the name) **is** the one-member block — identity on every axis: visibility (self-reference legal), typing (§7.4's knot at its smallest), binder (the §4.2 list is the head's list), emission (§8), and the header-only rule (§5). A single-member block is also legal; canonical formatting rewrites neither spelling into the other (§11, formatting note).
- Blocks are legal wherever `fun` is legal — module level and inner blocks alike (Statements §7.3).

### 2.1 The SML ground

SML's `fun f … and g …` is **one declaration** whose tyvarseq scopes over the whole chain; C2 is that construct with **layout playing the role of `and`** — the `fun` head line is SML's special first `fun`. Because sharing the head's variable is opt-in by placement (a member that does not write `a` does not touch it), the two warts that killed the zero-syntax alternative (§10.1) are structurally absent, and renames stay local because the block has exactly one binding site for the variable.

Backward references need **nothing** (measured: mismatched head spellings across non-mutual `fun`s compile clean): outside the knot, functions meet through generalized schemes; inside it, through live rigids. The block earns its place exactly where generalization cannot come first.

---

## 3. The head's binder

### 3.1 Scope and sharing

The head's type variables are declared type variables in Functions §4.1's sense — rigid while the block is checked — scoped over every member. A member that writes `a` in an annotation uses *the* block variable; two members that both write it thereby share one rigid, which is what makes a constrained knot spellable at all (two per-member binders could never be one variable — Functions §7.4). A member that does not write it is untouched by it.

### 3.2 The contract

The head's constraint list is the block-wide **§4.2 contract**: for every member that mentions the variable, every constraint the member's body demands on it must be entailed by the head's list, and the checker must not silently strengthen the list. One list, stated once, checked per member.

A head variable that **no member mentions** draws exactly what the fused spelling's unused binder draws today (Functions §4.2's contract machinery); the block adds no new case.

### 3.3 Member-private binders: refused in v1 (non-foreclosing)

A binder list on a member line (`parse<b: Show>(…)`) is refused: "members take no binder lists; declare the variable on the block head." Refused, not rejected — the door stays open should field evidence want a member-private variable alongside the shared one. Until then the head's list is the block's whole binder story, which keeps the sharing rule readable off one line.

### 3.4 Typing power: none added, none removed

The block is **pure scoping**. Generalization is per member, at the member's SCC, exactly as Functions §7.4 and §8 already rule; recursive references stay at not-yet-general monotypes; a member reaches a sibling's head variable only through inference variables that unify into the rigid; a concrete use from inside the knot is refused as ever. The derivability principle (`decisions-ml-dialect-annotations-2026-08.md` §2.4) is untouched: no annotation becomes load-bearing for typability — the head's binder attaches constraints and scopes a name, precisely what the fused binder already did, and Haskell's signature rule remains rejected doctrine (§9.11 there).

What *dissolves* is a spelling gap, not a typing rule: before this ruling, two exported members of one constrained knot had no headed spelling (two heads cannot meet — #700's filing), and Functions §7.4 sent them to a non-recursive wrapper. The block head **is** the shared head, so the knot exports directly (§4.1); the wrapper remains legal and stops being the only spelling.

---

## 4. Export

**Per-member markers.** `export` at the member's left margin exports that member, and nothing else does:

```
fun<a: Eq>
    walk(x: a, n: Int): Int = ...          -- private worker
    export search(x: a): Int = walk(x, 0)  -- the public face
```

All-or-nothing head export was rejected: the common real shape is a public face over private workers, every ML with the construct filters visibility per name, and #590's left-margin-legibility principle wants the marker on the line that names what crosses. **Head-export sugar is binned** — `export` before a block head is a parse error with the per-member advice (§9).

### 4.1 Modules §4.1.1 is satisfied by the head

An exported member writes every parameter and result annotation as any exported function does. Its **constraint binders are the head's**: the block head's list supplies the written, maximal-under-entailment constraint list Modules §4.1.1 requires, for every exported member that mentions the head's variables. This is how the wrapper-only rule of Functions §7.4 (written by #698) dissolves — and with it #700's diagnostic trap: the §4.1.1 advice for an incomplete signature on a knot member now names the block-head spelling, never a head the knot would refuse (§9).

---

## 5. `fun` is header-only, everywhere

The retired spellings, with their rewrites:

```
fun fact = (n) => if n <= 1 then 1 else n * fact(n - 1)   -- ERROR; write:
fun fact(n) = if n <= 1 then 1 else n * fact(n - 1)

fun size = match                                           -- ERROR; write:
    ...
fun size(shape) = match shape
    ...
```

- The check is the grammar: after `fun`, either a block head (§2) or a member header — `name`, parameter list, optional annotations, `=`, body. There is no `fun name =` production.
- The old §7.1 asked "is the RHS a lambda literal?" because block binding is sound only if creating each member evaluates nothing. The header form has that property **by construction** — it can only denote a lambda — so the rationale survives with the check subsumed into the grammar. (SML's precedent: `fun` is clausal-only; `val rec` is the language that kept a lambda-RHS spelling, and Hexagon declines the second spelling rather than the property.)
- **`fun f = match` is retired with the rest.** The rewrite names the parameter and the scrutinee. Match functions remain legal at every *expression* seat — `.map(match | …)`, the annotated `let`, the pipe, the ascription — where Functions §4.3's supplying seats hand them their parameter type; the retirement touches only the `fun` RHS seat. (Ruled with eyes open: the spelling was liked, and ruled away for the uniform header — one `fun` shape, no exceptions.)
- `let` is deliberately untouched: it keeps the lambda spelling, the header sugar, and the match function. The asymmetry is the ruling's spine (§1) — `let` is the general binder; `fun`'s one job is recursion, and it always shows its header.
- A consequence for rules that read written forms: Functions §7.1 no longer *has* a written-form question to ask — the grammar admits only headers — so Lexer & Layout §2.1's "the one exception is Functions §7.1" paragraph and Functions §8.2's "§7.1 is the one rule that does not read through" sentence retire with it. Pattern Matching §6.7's match function loses its `fun`-RHS acceptance clause and keeps everything else (lambda literal for §8.2 value-ness; every expression seat).

---

## 6. Adjacency runs retire

An unbroken run of `fun` declarations is no longer a group. Each `fun` — fused, or a block — stands alone; a reference from one to a *later* one is Functions §7.2's declared-later error, extended with the block rule and the mechanical wrap rewrite:

> only members of one `fun` block recurse together; wrap both definitions as its members

Backward references between separate `fun`s stay legal, as between any generalized bindings (§2.1). Corpus impact was measured at **zero** before ruling: all 34 shipped `fun`s are self- or backward-pointing; no stdlib or runtime module spells a cross-referencing run.

The retirement buys the reader a guarantee the run rule could not give: adjacency is no longer load-bearing, so moving a declaration between two `fun`s can no longer silently change what they mean — it can only surface the wrap error where a knot actually existed.

---

## 7. `var` may not have a function type

**Vars are data accumulators, not functions.** A `var` whose type is a function type is refused:

- **Type-level, not spelling-level.** A spelling ban (no lambda RHS on `var`) would be a leaky speed bump — `var f = identity(lambda)` walks past it. The rule reads the type: the ban fires wherever the `var`'s monotype **resolves to an arrow** — at the declaration (annotated or inferred from the initializer) or at the pinning use that settles an unsolved variable to a function type (Statements §6.1's first-use-pinning).
- **The ban is on the `var`'s own top-level type.** Functions inside data are data: `var handlers = [onOpen, onClose]` (a `Vector((a) -> b)`) is legal, as is a record holding functions. Only the var itself may not *be* a function.
- **Rewrite advice:** model changing behavior as data — a union the code matches on: declare the states, `var mode = Fast`, and `match mode` at the use site. The diagnostic names this spelling (§9).
- Non-foreclosing: refused in v1, reopenable on field evidence.
- **Consequence for Functions §4.3:** the supplying-seat list drops its "annotated `var` and every `:=` right-hand side" entry and its conformance pins — the only lambda that seat could land is a function-typed `var`'s, which no longer exists. Numeric Literals §5.1's own list is untouched: an assignment boundary still establishes the expected type for the *numeric* channel, which is about data.

---

## 8. Emission

The block is **invisible in JavaScript**. Each member emits as a `function` declaration at the block's textual position, in member order — exactly what the fused `fun` already emits — module-level or inside an enclosing function body alike. Exported members take the ordinary `export` emission. The soundness note transfers wholesale: header-only members are evaluation-free (§5), so every member exists before any member's body runs, which is what the block's mutual visibility needs; JavaScript hoists `function` declarations further than the language grants, and Functions §7.2's top-down law keeps the difference unobservable.

`.d.ts`: nothing new — exported members are exported functions; the block does not cross.

---

## 9. Diagnostics

The family, all under the Rewrite Rule (Declarations Preamble §1.1):

| Situation | Error |
|---|---|
| `fun f = (n) => …` (lambda RHS) | parse error: "`fun` defines functions by header; write `fun f(n) = …`" — the rewrite is mechanical from the lambda's own parameters |
| `fun f = match …` | parse error: the header rewrite naming parameter and scrutinee: "write `fun f(x) = match x` — a match function stays legal on a `let` or at a call site" |
| `fun x = 5`, `fun fib = memoize(…)` — any other `fun name =` | parse error: "`fun` defines functions by header; write `fun fib(n) = …`, or bind the value with `let`" |
| Mutual reference between two separate `fun`s (the retired run) | Functions §7.2's declared-later family, extended: "only members of one `fun` block recurse together; wrap both definitions as its members" |
| `export` before a block head | parse error: "`export` marks members: put it on each member to export" |
| Binder list on a member line | parse error: "members take no binder lists; declare the variable on the block head: `fun<b: Show>`" (§3.3) |
| Empty `fun` block | parse error: a block head with no members |
| Incomplete exported signature on a member of a recursive knot (Modules §4.1.1) | the completeness advice names the block-head spelling — "declare the constraint on the block head: `fun<a: Eq>`" — never a per-member head (#700's carve-out, reshaped) |
| Function-typed `var` (declaration or pinning use) | "`step` is a `var`, and a `var` cannot hold a function — vars accumulate data; model changing behavior as a union and `match` on it" (Statements §9.3) |
| Knot-collision family (checker's message, three arms as of #701) | the wrapper advice respells to the block: "declare one head on the `fun` block" first, the wrapper as the remaining alternative; the rigid-vs-rigid arm now qualifies each side by its declaring block head (reachable only through *nested* blocks — one block has one head) |

---

## 10. Rejected alternatives (do not re-litigate)

1. **B — same spelling in one SCC = one rigid, zero syntax.** Killed on two warts, the second decisive: (i) rename-locality — alpha-renaming one member's head variable, a no-op everywhere else in the language, turns a compiling knot into a refused one (Functions §4.1's rename-locality invariant breaks even with fixits); (ii) **accidental capture** — coincidentally same-spelled heads whose variables the knot never links would be identified anyway, silently strengthening each member's constraint list (§4.2 forbids) or refusing innocent code that compiles both headless and with distinct spellings. No fixit repairs intent. C2 is structurally immune to both: sharing is opt-in by placement, and the variable has one binding site.
2. **C1 — `and`-joined group.** `and` is the boolean operator; a second job for the word cuts against the keyword stance (`hexagon-keyword-stance`: one word, one job).
3. **C3 — named group keyword.** Three grouping signals (keyword, block, adjacency) for one concept.
4. **All-or-nothing head export.** Rejected for the public-face-plus-private-workers shape; §4.
5. **Head-export sugar** (`export fun` distributing over members). Binned; the marker belongs on the line that names what crosses (#590).
6. **Member-private binders.** Refused v1, non-foreclosing; §3.3.
7. **Keeping `fun f = match`.** Ruled away for the uniform header despite its charm; §5.
8. **A spelling-only `var` lambda ban.** A leaky speed bump; the type-level rule was chosen; §7.

---

## 11. Edit-notes ledger

Applied in this same change unless marked otherwise:

- **Functions** — §3.1 (match-function bullet: written-form parenthetical respelled), §3.3 (header-only; block pointer), §4.3 (supplying seat list and conformance pins drop the `var`/`:=` entry), §7 (restructured: §7.1 header-only, §7.2 exception respelled, §7.3 the block, §7.4 block wording + the export paragraph superseded, §7.5 respelled), §8 items 2/3 (wrapper-reading sentence; `fun` value-ness via headers), §9 (emission rows + soundness note), §10 (rows per §9 here).
- **Modules** — §4.1.1 (the head-satisfies paragraph + advice carve-out, §4.1 here); §5.2/§5.3 occlusion prose: "contiguous `fun` group" → "`fun` block".
- **Statements & Mutability** — §2 table (`fun` row), §6.1 (the function-type ban), §6.2/§7.3 (corollary rewording), §9.3 (the ban's row), §11 log.
- **Pattern Matching** — §6.7 (the `fun`-RHS clause removed; retirement noted), decisions-log row amended inline.
- **Lexer & Layout** — §2.1 (block-head row; the §7.1 exception paragraph retired).
- **Method Syntax** — §4.4/§9/§10: "`fun` group" → "`fun` block" (rule and message).
- **Effects §3.5** — knot wording: group → block.
- **Declarations Preamble §7.2** — forward-visibility sentence: group → block.
- **Doc Comments** — §4.2: members documentable; attachment per member; a doc comment on a block head is an error naming the member rule.
- **`decisions-ml-dialect-annotations-2026-08.md`** — §9.11's neighbor list and §10's Modules ledger item updated to the block world (the rejection itself unchanged).
- **`decisions-ml-dialect-generalization-2026-08.md`** — §2.2's "`fun` RHSs are always lambdas (§7.1)" respelled to headers.
- **`notes/canonical-formatting-and-naming.md`** — v1 stance: fused and single-member block both legal; the formatter rewrites neither into the other.
- **`notes/hexagon-for-typescript-coders.md`** — the recursion paragraph respelled to the block.
- **README** — rule 3's closure-document list gains this document.
- **Book** *(rider PR)* — chapters 3 (recursion sections), 6 (knot wording), 11 (the `fun size = match` example rewrites to scrutinee form), 15 (dot-call wording); FRONTMATTER bumps the title to **v1.2**.

## 12. Conformance obligations

Pinned on parse/type verdicts, and on **emitted JS plus execution** wherever a knot's evidence is in play (the #368 lesson; the suite extends `recursion-knot.test.ts`'s machinery, not a new harness):

1. The block parses: bare head; binder head; members with annotations; `export` members; nested blocks; blocks in inner scopes.
2. Mutual recursion through a block compiles and **runs** (the even/odd pair; a constrained knot under a binder head, run at a ground type).
3. The head's variable is one rigid: two members writing `a` share it (a knot linking them compiles; the §4.2 contract refuses a member whose body exceeds the head's list, naming the member).
4. Sharing is opt-in: a member not writing `a` generalizes independently; non-cross-referencing members do not restrict each other (the §7.3 "bounds visibility, not typing" pin, re-aimed at the block).
5. An exported constrained knot: two `export` members under one binder head compile, emit complete `.d.ts`, and **run** — the spelling #700 filed as unwritable.
6. Every §9 row fires with its wording: the three retired-RHS rewrites, the wrap rewrite on the retired run, head-export, member binder, empty block, the §4.1.1 block advice, the var ban at declaration **and** at pinning use (`var f = identity` shapes included), with function-in-data vars still legal.
7. The fused/block identity: `fun f(…) = …` and the one-member block agree on inferred scheme, emitted JS, and self-recursion.
8. Emission goldens: block members as `function` declarations in member order at the block's position; the retired forms produce no emission (parse errors).
9. Existing §7.4 pins (identity suffix, concrete-use refusal) keep passing with knots respelled as blocks — the #701 substrate extends, unrebuilt.

## 13. Implementation notes (for `hexc`)

- The parser gains the head production and member lines; the layout pass gains the §2.1 row (a `fun` head ending its logical item opens a block). `fun` followed by a name on the same line is the fused member, unchanged.
- The resolver: member names bind at the enclosing scope; block-internal forward visibility replaces run-detection (the run machinery's group boundary becomes the block boundary — a shrink, not a rebuild). Method Syntax §4.4's own-group dot-call check reads the block.
- The checker: the head's binders enter as rigids scoped to the block; SCC computation within the block; `#knots`/`#knotEvidence`/`#errorKnotHeads` and the collision message (#701's machinery) extend to the block head; the §4.1.1 advice reads knot membership (#700's carve-out, now the block advice).
- The `var` ban: a monotype-resolution check at declaration and pinning-use sites (Statements §6.1's existing pinning machinery is the hook).
- TextMate grammar + LSP: the head line, member `export` markers, member-aware outline/hover.
