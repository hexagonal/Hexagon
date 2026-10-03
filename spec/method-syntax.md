# Hexagon Spec: Method Syntax (Type-Directed Dot Calls)

**Status:** Decided (July 2026; the collection companions' types are declared by public intrinsic `type` rows as each lands — #1071, #1073, #1076 — Intrinsics §3.3) — and **amended August 2026 for constraint-member dispatch** (#304/#335, the members-as-values ruling) — see **reversal record §16.2** — and **amended September 2026 for tower-member widening** (#808: the dot on a tower member is the open member call, widened and lifted as the operator is) — see **amendment record §16.3** — and its receiver stand-down **retracted** (#821: the forwarded face is binding — §16.3's second record) — and **amended October 2026: a dot call's subject is decided by the program's text, or the dot is refused** (§3; the waiting goal, its deadline, and the row fallback are gone — §16.4). A **hanging-questions** section (§12) remains; nothing there blocks implementation of §1–§11.
**Scope:** The dot-call form `e.name(args…)`; its semantics as companion-module dispatch **and, since the #335 steal, constraint-member dispatch** (honored members on head-known receivers; bound members on declared type variables); the subject the program's text decides, and the refusal where it does not; the definition of a type's companion operation set; coverage (eligible and ineligible receiver types); field/method collision rules; interaction with row polymorphism, tuples' `itemN`, opaque types, and transparent aliases; emission; LSP completion obligation; diagnostics; rejected alternatives; edit notes.
**Not in scope:** the pipe (`|>` — Operators §8, unchanged); the bare and qualified constraint-member call forms themselves (Constraints §2.2 owns the call-style doctrine; this spec owns only the dot spelling's reach); the stdlib inventory of companion operations (stdlib listing; this spec fixes the *rule* that determines which exports are dot-callable); `.d.ts` (nothing method-shaped exists to represent, §8.3); bound-method values (rejected, §11.6).
**Companions:** Products spec (§3.2 field access, §4 row tiers, §5 nominal records — the record spelling keeps all of it, §3.6), Modules spec (§5.3 companion idiom, §7.2 home module — the dispatch target; §4.2 `opaque`), FFI Part 5 (§9 — extern nominal types and receiver-member linkage), Constraints spec (§2.2 member namespacing and call style; §4.6 member bindings in the honoring module — the dot's exemptions and the own-name refusal), Operators spec (§10 postfix forms — the dot-call is level 1), Loops spec (§7 — the compiler-known Iterable table), Functions spec (§4.3 the elaboration schedule and the landing; §8 generalisation), Sol-review closure (§E Rewrite Rule — cited throughout), Decisions Batch — Sol Review 2 (this spec's origin session).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, whole-program compilation from an entry point, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **The semantics is one rewrite.** For a receiver of known companion-bearing type:

  ```
  receiver.name(args…)   ⇒   CompanionOf(receiverType).name(receiver, args…)
  ```

  After resolution, a dot call **is** an ordinary qualified function call. No runtime methods, no `this`, no prototype, no wrapper object, no dynamic property lookup, no method table exists at any point. *(Rewrite formulation: Sol.)*
- **One operation, its own elaboration.** *(#808.)* `receiver.name(args…)` is the one operation `name` the receiver's type owns, applied to `(receiver, args…)` and elaborated exactly as that operation's own spelling would be. For a companion export the subject seat is written, so the call runs at the receiver's type and the rewrite above is the whole story. For a constraint member the subject is polymorphic, so the call is the **open member call**: it runs where its operands establish it, the receiver being one operand among the others. At a **tower member** — a subject-first member of `Num`, `Signed`, `Frac`, `Pow`, `Integral`, or `Bitwise`, the closed list Numeric Literals §5.1 fixes — the seat's written face joins the operands through the expected-type lift, and the tower's contextual widening carries the operands to that home: `count.multiply(price)` is `Float` multiplication for `count : Int` and `price : Float`, and `let r: BigInt = i.add(j)` is `BigInt` addition of two injected `Int`s, exactly as `count * price` and `let r: BigInt = i + j` are. **The receiver decides *what* is called; the operation decides *where it runs*.** The receiver is the operation's first operand and takes what that seat expects (§2.2's receiver rule), so a dot chain lifts exactly as an operator chain does, and the face it forwards is binding: a receiver whose lift stands down there is refused, never accepted at the type it kept (#821). The one divergence is the receiver's own: it closes before the dot resolves, taking only its seat's expected type, so without one `(n * 1.5).multiply(price)` is refused where `n * 1.5 * price` is `Dec` (§2.2, #1062). Before this amendment §3.4's nominal row pre-selected the instance at the receiver's type, which read the dot as the *pinned* companion spelling `Int.add(i, b)` and refused a widening every other spelling of the same member performed (§16.3).
- **This is not UFCS.** Resolution is type-directed, never lexical. `v.at(3)` consults `v`'s inferred type, not the names in scope (rejected alternative §11.1). The lineage statement, when one is wanted: *Rust-shaped dot-call syntax with a much smaller resolution model* — one candidate set, no ladder, no traits, no search (§11.2).
- **Member names never nominate nominal types.** A dot call is resolved *from* the receiver's type; the receiver's type is never inferred *from* the member name. `let f(x) = x.at(3)` does not search companion modules for an `at` and conclude `Vector`. This sentence is the guardrail that keeps the feature a resolution rule rather than global overload search, and it is doctrine. *(Phrasing: Sol.)*
- **Bare dot is field access, always.** `e.name` without an argument list is record field access (or tuple `itemN`) and nothing else — never a method reference, never a bound method, never `() => Module.name(e)`. Companion dispatch exists only in the syntactic call form `e.name(args…)` (§2.1, §11.6).
- **The subject is decided by the text, or the dot is refused.** A dot call is sugar for its companion's function, `CompanionOf(T).name(subject, …)`, and it chooses that function from its subject's type. So the type must be one the **program's text decides** (§3.1) — written, a literal, a name from outside the function, or made from such — never one a later or an earlier line happens to supply. Where the text does not decide it, the call is refused at the dot (§3.5), and the fundamental spellings remain: write the subject's type, call the function by its module, or call a record's field as `(e.name)(…)`. Every dot-call form has one meaning, decided where it is written; nothing waits for evidence, and nothing is read as a field because a type was unknown.
- **One companion, no search.** `CompanionOf` is a total, trivial function of the receiver's head constructor — the home module (Modules §7.2) for user nominal types, a fixed prelude companion for built-ins (§4). No import adds or removes a dot-callable operation. *(Amended for #304/#335 — see §16.2.)* The operation set now unions the receiver type's **honored constraint members** (§4.2), which preserves both properties: coherence keys instances program-wide, so membership is as import-insensitive and search-free as the export set — but two candidate *sources* can now claim one spelling, and where they do the call is refused naming every qualified home (§6). Refusal, never ranking; the no-ranking doctrine survives the union — and survives §6.1's generalisation-law carve too, which refuses to rank by recognizing a widens binding and its derived member as one claimant rather than two.
- **Three spellings, one canonical form.** `Vector.at(v, 3)`, `v |> Vector.at(3)`, and `v.at(3)` all elaborate to the same call. The qualified spelling is canonical (it is what everything elaborates to); dot is the daily idiom for a value's own companion operations; the pipe is the idiom for transformation chains, polymorphic functions, and operations owned by another module (§9). Dot syntax does not replace pipes; it supplies discoverable companion operations, pipes express explicit flow. *(Doctrine wording: Sol, adopted.)* Since the prelude seeds no function or member bare but `ignore` and `show` (Modules §5.5), the dot is the prelude's **everyday** surface and the qualified spelling its explicit and polymorphic one — the sentence above states a preference; §5.5 makes it the shape, and the stdlib's own source writes the dot wherever it resolves (`stdlib-roadmap.md` §1). *(#808.)* For a tower member the spellings are more than convergent: operator, bare, qualified through the constraint, pipe stage, and dot all elaborate through the same operand widening and the same expected-type lift (Numeric Literals §5.1) — one operation, one algebra, whichever spelling the reader meets, save that a dot call's receiver closes before the dot resolves (§2.2, #1062). The **companion**-qualified spelling of a tower member (`Float.multiply`, `Int.multiply`) is a written face rather than a further spelling: operands widen *into* it, so `Float.multiply(count, price)` is `Float` and `Int.multiply(count, price)` refuses, Modules §5.3's migration principle keeping the companion read substitutable for a plain `Int.multiply(a: Int, b: Int): Int`.
- **A dot call is not a deferred goal** (§10). It is decided where it is written, from the text; the Deferred-Goals Doctrine (Declarations Preamble §1.2) has no dot-call instance.

---

## 2. Syntax and resolution at the dot

### 2.1 The form

```
e.name(args…)        -- dot call: decided at the dot (§2.2, §3)
e.name               -- bare dot: field access (Products §3.2) / itemN (Products §2.3), always
(e.name)(args…)      -- parenthesized: field access, then an ordinary call — no dispatch
```

- The dot-call form is precisely: a level-1 postfix expression (Operators §10), a `.`, a **non-uppercase-start** term name, and an **immediately following argument list**. It is a dot call only in this exact shape.
- Parenthesizing the field access — `(e.name)(args…)` — is the opt-out: no dispatch is attempted; this is field access followed by an ordinary call — the record spelling (§3.6) — and it is the disambiguation spelling the collision diagnostic offers (§6). It falls out of the grammar; no new form is introduced.
- `e.name` bound and called later (`let f = e.name` … `f()`) is likewise plain field access; dispatch never sees it.
- Uppercase after the dot is not this feature: `Alias.Name(args…)` is module-qualified access (Modules §5.1), resolved positionally as today. The `.` token remains the single token of Operators §10, resolved by what the left side names; nothing changes there.
- Dot calls interleave freely with the other level-1 postfix forms: `v.slice(1..3)[2].show()` parses as postfix chains always have. (Whether each link *resolves* is §3's business.)
- *(#355.)* **A call mark anchors the argument list, whatever the callee expression** (Effects §3.2). A dot call marks its own list — `stream.next!()` — and the parenthesized opt-out marks its ordinary call the same way: `(source.step)!()`. In a postfix chain each argument list is marked for the arrow *it* discharges (Effects §3.3); the bare dot `e.name` remains field access and remains colourless — no argument list, no mark. A dot call refused at the dot (§3.5) owes no mark: no operation was chosen, so there is no arrow to mark.
- In a multiline chain, a leading dot is a postfix continuation. The canonical layout aligns each leading dot with the receiver, just as a leading `|>` aligns with the value in a multiline pipe:

  ```hexagon
  let selected =
      numbers
      .filter(number => number > 3)
      .map(number => number * 10)
      .take(5)
  ```

### 2.2 Resolution at the dot

On elaborating `e.name(args…)`, the subject `e` is elaborated first (§2.3), taking what its seat expects (the receiver rule, below), and then the dot is decided, once, there:

- **Where the program's text decides the subject's type (§3.1)**, the call resolves by §3.4's table on the spot, before the arguments are elaborated, and then checks as a named call to the resolved operation, its signature supplying each argument's expected type (Functions §4.3), pointwise. *(#808.)* Where the resolved operation is a **constraint member**, the named call it checks as is the member's *open* call over `(receiver, args…)` (§3.4). Resolution fixes the **name** — which member, of which constraint — and the member's signature supplies every non-subject seat pointwise (a written `Int` exponent seat; a function-typed parameter that lands a lambda). The **subject** seats are established together, after their operands are in, exactly as the bare call establishes them — the receiver, already elaborated, one operand among them — by Numeric Literals §5.1: exact unification where the operands agree; the widest operand where an established `Nat`/`Int` meets a wider one (`i.compare(b)` is `compare(BigInt(i), b)`, as `Ord.compare(i, b)` is); and, at a tower member, the seat's written face where one lands, through the lift. The instance is then selected by coherence at the subject so established. What the dot inherits is Functions §4.3's ordering pin, as the operator has it: receiver first, then the arguments on the schedule; siblings sharing an undetermined variable may widen differently by position, by design. Evaluation order (§2.3) is inference-independent and unchanged.
- **Where it does not**, the dot is refused there (§3.5). Nothing about the call waits for a later line to say what the subject is.

**The receiver seat** *(#808; ruled after #815's review)*. The receiver of a dot call is the operation's **first operand** and takes what that operand seat expects — the general principle, of which the rest of this paragraph is the only case with content. *(#1062.)* It is also a **seat** in Numeric Literals §5.1's sense: its expression tree closes before the dot resolves, because the dot must know what its receiver is to know what it calls, and it takes from outside only what this paragraph forwards — its seat's expected type, as it stands when the call is checked — never the home of the tree the call sits in (friendly-numerics §4). Without such a face it closes from its own contents alone; a receiver that is a literal — decimal or integer, negated or not, through any grouping — is a value, nothing having settled it, so it closes to nothing (ruling b′: `(1.5).multiply(price)` runs at `Dec`, as `2.multiply(price)` does), while any other receiver, a form of literals included, closes to the type its tree chose. The operation §3.4's table then selects at the closed type takes the receiver's value as a part, the member's other subject operands — an open member's, a tower member's or `compare`'s alike — being its siblings, so `price.compare(n * 1.5)` compares at `Dec`. Two sibling arguments of one call can differ here only by the expectation each received at its turn (Functions §4.3's schedule residue). So `price.multiply(n * 1.5)` runs at `Dec`, `(n * 1.5).multiply(price)` is refused — its receiver closed at `Float`, the report naming the operator spelling and the annotation (Numeric Literals §6) — and a receiver still unsolved when it closes is a literal's, which takes its literal's default at the dot before the dot resolves (§3.3), the literal remaining a value of the call it sits in. For a companion export the seat is headed by the receiver's own type (§4.2), and for a member outside the tower the subject is a variable no lift reaches, so at both the seat's expectation is either the receiver's own head or nothing, and forwarding it changes nothing. At a **tower member** the subject seat is the result seat, so under a written face the seat's expectation is the call's, and the receiver's arithmetic must run there: `let r: BigInt = a.add(b).multiply(c)` and `(a + b).multiply(c)` run both operations at `BigInt`, as `(a + b) * c` and `a.add(b) |> Num.multiply(c)` do — before this rule the receiver ran at `Int` and only its finished value was injected, the silent overflow Numeric Literals §5.1 exists to prevent, surviving in one spelling. Because the receiver must elaborate before the call can resolve, the dot cannot ask the operation; it asks the **spelling**, and the spelling answers only through its rung: **the call's expected type is handed to the receiver before it elaborates when the member name is a tower member's spelling and the expected type is a concrete type honoring that spelling's rung** — `add`/`multiply` → `Num`, `subtract`/`negate` → `Signed`, `divide` → `Frac`, `pow` → `Pow`, `div`/`mod`/`quot`/`rem`/`gcd` → `Integral`, `bitAnd`/`bitOr`/`bitXor`/`bitNot`/`shiftLeft`/`shiftRight` → `Bitwise` (Numeric Literals §5.1 fixes the list). The gate is what keeps the stand-in from being wrong. A module that honors a rung cannot export that rung's spellings (Constraints §4.6 — the `widens` door is no export either), so a receiver that lifts to the face always dispatches the rung's own operation there: the member, or the `widens` door that generalises it (§6.1; Constraints §4.7). A face that does not honor the spelling's rung forwards nothing: `let f: Float = (i + j).rem(k)` runs `i + j` at `Int` and dispatches `Integral<Int>`'s guarded `rem`, as `Integral.rem(i + j, k)` does — never `Float.hex`'s exported `rem`, which a companion may export precisely because `Float` honors no `Integral`. **The forwarded face is binding** *(#821)*. It governs every tower member call the face reaches, and the face reaches: the receiver itself; the operand seats Numeric Literals §5.1's lift governs at a tower member call it governs — at `**` the base seat only, the written `Int` exponent seat taking `Int` as its own face and never the outer one (Operators §6.3); whatever a forwarding form hands it to (Functions §4.3); and the receiver of a dot call it has reached, by this rule again. Each governed call runs at the face as an operand seat's face governs its operand, and wherever among them §5.1's lift stands down instead, the receiver is refused — at the **outermost** stood-down call among those the face reached (the one whose result meets the refusing seat; at a receiver-level stand-down, the receiver itself), with a fixit ascribing that call at the type it kept — the receiver itself where they coincide, the call inside the form where they do not, since an ascription of a whole receiver whose own type is not the kept type would supply its face back down this very reach — offered only where that call would compile at the type it kept (with `Foo` honoring no `Pow`, `(p ** i).gcd(s)` is refused with no repair, neither the ascription nor a binding running the power at `Foo`), where the dot's claimant lies outside the spelling's rung; at the enclosing seat where it is the rung's own member — never accepted at the type it kept. `let n: BigInt = p.add(q).gcd(s)`, with `p, q : Foo` a user type honoring `Num` whose companion exports `gcd(Foo, Foo): BigInt`, forwards `BigInt` into `p.add(q)`, where `Foo` cannot enter it — the lift stands down, and the dot, which would resolve to the export at `Foo`, refuses (§9 row 16): the ending every stand-down has (Numeric Literals §5.1: a home is never given up for another). On the way it travels as any expectation does, through Functions §4.3's forwarding forms — grouping, a block's final expression, both branches of `if`, a `try`'s body block, the arm bodies of `match` and `try` — so `(if c then x + y else b).multiply(z)` under `BigInt` runs `x + y` at `BigInt` inside its branch, as `(x + y).multiply(z)` does. It crosses no written boundary: an ascription, a separate binding, and the companion-qualified spelling — a written face that lifts nothing beyond itself (Numeric Literals §5.1) — each stop it, so `(p.add(q): Foo).gcd(s)`, `let t = p.add(q)` followed by `t.gcd(s)`, and `Foo.add(p, q).gcd(s)` all dispatch `Foo.gcd`; and where it arrives at no tower member call — a variable, an ordinary call, a field — it is an expectation and no annotation (Functions §4.3), and changes nothing. A forwarding form is no tower member call and has no lift of its own; what it hands the face to may, and the reach above follows it all the way down — into a branch that is itself a forwarding form, a block's final expression, a `try`'s body, an operand of a tower operation in the branch, or the receiver of a dot chain in the branch. Two illustrations, and the order between them. Where the face reaches a tower member call inside the receiver — in a branch, or as an operand — and its lift stands down while the form still joins at the kept type — `(if c then p.add(q) else p).gcd(s)`, `((if c then p.add(q) else p) + q).gcd(s)`, `(p.add(q) + q).gcd(s)` — the stand-down refuses exactly as at the receiver itself: row 16 at the outermost stood-down call, its fixit ascribing that call at the type it kept — `(if c then (p.add(q): Foo) else p).gcd(s)`, and for the dot chain in a branch `(if c then (p.add(q): Foo).gcd(s) else b).multiply(b)`, where the receiver's own type is `BigInt` and ascribing it whole would send the face back down; a stand-down that joined instead would be the retracted behaviour four tokens away. `(if c then p else q).gcd(s)`, whose branches are variables, dispatches `Foo.gcd` as before. Where the form's own parts disagree — `(if c then i + j else p).gcd(s)`, whose `i + j` lifts to `BigInt` and whose `p` is a `Foo`; `(if c then p.add(q) else b).gcd(s)`, whose stood-down branch meets a `BigInt` one — the form's own disagreement is the report and row 16 stands down, whether or not a lift stood down inside: Operators §11's report at the `if` (Pattern Matching §6.2's at the arm body for `match` and `try`), naming the branch that cannot enter the face and saying that the face descended into the other — the form joins with no face, so the disagreement is the face's own doing. That report carries the boundary fixit only where the boundary repairs — `(if c then i + j else p: Foo).gcd(s)` compiles, `(if c then p.add(q) else b: Foo).gcd(s)` does not, and an offer that does not compile is no fixit (Operators §6.3; the Rewrite Rule) — and this paragraph is the licence for it, the report itself being the form's own. A branch the face reaches no tower member call inside contributes nothing of its own. The whole-receiver ascription `(if c then p.add(q) else p: Foo).gcd(s)` also compiles where the receiver's own type is the kept type; the fixit names the smaller, always-repairing one. The refusal is one report of three facts: the face reached the receiver because `gcd` is a member of `Integral` and `BigInt` honors it; `p` cannot enter `BigInt`, so the addition could not run there; and an ascription, `(p.add(q): Foo).gcd(s)`, or a separate binding keeps the receiver at `Foo` (Numeric Literals §5.1's no-face boundary; Ascription §3). It is one report because the receiver's subject seats are established together after every operand is in (above), exactly as the operator's are — no operand refuses at its own seat before the stand-down is decided, and nothing is buffered or discarded; the member spellings — bare, qualified through the constraint, and the pipe stage, which is the bare call (Operators §8) — reported three times by binding the subject early, and the dot twice; `(p + q).gcd(s)` beside `Num.add(p, q).gcd(s)` isolates the cause, one operation, one face, one claimant, and only the spelling differing. At a nested receiver, `(p + (i + j)).gcd(s)`, the inner `i + j` reaches the face and runs there while `p` does not, so the outer addition stands down and the one report is this row's, naming `p` (Numeric Literals §6's note names the first value that declined) — never the two types, `Foo` and `BigInt`, that the face's descent left the addition holding: which operand the face entered first is the descent order, and the report does not speak it, in any spelling, whether or not the declining operand's type carries the call's rung: under `BigInt`, with `Foo` honoring no `Integral`, `Integral.gcd(s, i + j)`, `Integral.gcd(i + j, s)`, and `(i + j).gcd(s)` each report `s` once, every spelling of the call being a node of its expression tree (Numeric Literals §5.1, #1062) and no evidence being selected at the `Foo` the call kept. A single-operand tower call — a negation, `bnot`, or `**`'s base — stands down exactly as a binary one does: `(-p).gcd(s)` is this row at `-p`. The class this clause newly refuses is nameable exactly: a receiver that is a tower member call the face reaches, whose lift stands down, at a dot that then resolves to a **non-rung claimant bearing a rung spelling** — a companion export, an honored member of a user constraint, or a function-typed field. Where the claimant is the rung's own member — `let n: BigInt = p.add(q).multiply(s)` — the program is refused before this clause and after it, at the enclosing seat with the enclosing seat's report, and no receiver fixit is offered: the ascription would repair nothing. Every program in the class compiles with the ascription, through a binding, or unannotated; inline under its true annotation it refuses, loudly, because the dot must ask the spelling before it can know the claimant, and the spelling can be wrong about the claimant only in this direction — a receiver that *does* enter the face meets the rung's own operation there, or §6's collision where the author has honored a user constraint with the spelling at that type. The alternative — letting a stood-down receiver keep its own type and dispatch there — would make the receiver the one seat where a stand-down succeeds, and the order in which the face descends into a nested receiver would then be meaning; deciding it correctly needs the receiver's type *without* the face before it elaborates *with* the face, the re-elaboration §16.3 rejects (recorded there). A spelling decides only that an expectation may *travel*; the receiver's head still selects the operation, at the same moment, by §3.4's table — the head may now be the face rather than the receiver's own type, and the gate guarantees the table there carries the same rung operation, or §6's collision where one is honored. Two things ride on that besides where the arithmetic runs: a guard — `let f: Float = (i + j).pow(k)` with `k` negative once threw `Pow<Int>`'s `NegativeExponentError` and now yields the reciprocal, as `let x: Float = 2 ** negOne` always did (Numeric Literals §5.1) — and, where an author has honored a user constraint with a rung spelling at a tower type, §6's collision, which the face can now move a call into or out of; both are the dot converging on the operator. The gate reads no inference state, so §11.3's rejection of eager resolution is untouched. An expectation is not an annotation (Functions §4.3): at a subject the text does not decide, it decides nothing, and the dot is refused (§3.5).

### 2.3 Evaluation order

The receiver is evaluated first, then the arguments left to right — identical to the rewritten form's behaviour (`Vector.at(e, args…)` evaluates the import binding, which is effect-free, then `e`, then `args`), and identical to what a JS reader expects of the emitted code. No temporary is ever needed; the single-evaluation rule (Operators §5.4) has no client here.

---

## 3. The subject the text decides

### 3.1 What the text decides

A dot call resolves from its subject's type, so it asks one question of the subject first: **does the program's text decide its type?** The answer is read from syntax, from declarations, and from facts fixed where a binding is made — never from where inference stands when elaboration reaches the dot — so the answer, and with it the call's meaning, cannot follow the order the program's lines come in.

The question has two strengths. The **head** of the subject's type, its outermost constructor, is what dispatch reads (§3.4). The **whole** type is what a value taken apart hands on to its parts. The text decides:

- a **literal**: a number, a string, `()`, a lambda, and a vector, tuple, or record literal — its head always, the whole where its parts are decided. A numeric literal's type is fresh and its own, and takes its default at the dot (§3.3);
- a name with a **written type**: a parameter's, a `let`'s, a `var`'s, or an ascription's annotation — its head where the annotation writes the head, the whole where it writes every part (no hole, no implied type);
- a **name no local binding introduces**: a module's, an import's, a constructor, an extern;
- an **honor member's or a constraint default's parameter**: the contract writes its type (Constraints §4);
- a **`let`** made from what the text decides: its head is its right-hand side's, and so is the whole, except where its type kept a part of its shape no generalization settled, which later lines fill (`let held = ident(Vector.empty)`);
- a **`var`**: its head is its initializer's, except where the initializer leaves the type itself unsolved — a numeric literal, or a form or call that hands one back — whose type the `var`'s assignments choose (Numeric Literals §5.1); and the whole only where the initializer is decided wholly and left no part open, a part its assignments would fill (`var acc = []`);
- a **`fun` inside a body**: its head is a function's, and the whole is decided where its signature is written whole, or where every name it captures is decided;
- the **parameter of a lambda** with no written type, in two places only — its head where its type lands there with a known head, and the whole only where it also lands with no part of its shape open: a hole beneath the written head, or a polymorphic value's instance in the call (`Seq.map(Seq.singleton(Vector.empty), (x) => …)`), leaves that part to whichever line of the lambda's body comes first:
  - **under a written type**, where a written type whose head is written reaches the lambda — a `let`'s annotation, an ascription, or a written result type, through grouping, a literal's matching parts, a branch form's value paths, a block's final expression, and a curried lambda's result. The slot written for the parameter decides it: its head where the slot writes a head, and the whole where the slot is written whole. A hole decides nothing, whatever fills it: in `let h: Vector((_) -> Int) = [g, (x) => x.length()]`, `g`'s type fills the hole before `x` lands, and `g`'s type may come from any line. At a record's construction, a field's declared type decides where it writes the parameter's slot whole (`Q({f = (x) => x.length()})` with `f: (Vector(Int)) -> Int`); a slot holding the record's own parameters, `(Wr(a)) -> b`, decides nothing until a written type reaches the construction, and a union constructor's slots decide nothing until one reaches the application. Where a written type reaches a constructor's application, the lambdas among its arguments land from that type and the other arguments, read as the next bullet reads a call (`let k: Option((Vector(Int)) -> Int) = if c then Some((x) => x.length()) else None`) — but not where the type holds a hole and reaches the constructor through a vector's elements or a branch form's paths, which share the hole and fill it from an earlier element or path;
  - **in a named function's call**, where the lambda is an argument of a call whose callee is a named function — a name or a dot call, never a constructor — directly or on the argument's spine (through grouping, a vector's, tuple's or record's parts, a branch form's value paths, a `try`'s included, and a block's final expression), and its type lands there (Functions §4.3). The call is read wholly: its callee, a dot callee's subject, the value a pipe hands a pipe stage, and every argument except the lambda asked about and the lambdas after it, which the schedule elaborates later (Functions §4.3). An earlier sibling lambda is read, what it captures included, since its body can settle a type variable the asked lambda's parameter shares (`both((a) => a == q, (b) => b.length())` does not decide `b`). A sibling's *result* does not reach the lambda asked about: in `using(() => [1, 2], (h) => h.length())`, `h`'s type is the first lambda's result, and the text does not decide it there.

  Outside those two places the parameter is not decided, whatever the types around the lambda: on a pipe's right (`v |> (x) => x.length()`), in a constructor's application no written type reaches (`Col({values = vs, format = (e) => e.show()})`), handed back by another lambda, applied where it is written, as a `with` override's value, or assigned. An expectation reaches a lambda there through its position — a pipe's left operand, where a constructor stands, an assignment's target — and the text decides only the two positions above. The parameter's written type is the spelling there (`(e: Int) =>`), as are the module's function (`Vector.length(x)`) and the bare member (`show(e)`);
- a **pattern's part or a loop variable**, where the value it is taken from is decided wholly and its type kept no unsettled part of its shape;
- a **call to a function the module or an import declares**, whose generalized signature gives its result whatever it is handed: its head where the signature's result has one, and the whole where the result holds no type variable — `Vector.length(p)` is an `Int` whatever `p` is. A local function's signature may hold what it captures, so it is read as the next bullet reads a call;
- a value **made from** what the text decides: an arithmetic operation's type is its operands', a comparison and a logical operation are `Bool`, a range is a `Range` whose element is its operands', an `if` is decided where both branches are, a block where its final expression is, a call wholly where its callee and every argument are, a field read where the value read is, and anything else — a `match`, a pipe — where every name it uses and does not bind itself is decided wholly.

The text does **not** decide a parameter with no written type that nothing lands one on, a `var` whose initializer leaves its type to its assignments, or anything made from one of those. A numeric literal that reaches a binder — a parameter, a loop variable, a pattern's part — is such a type: `for x in [1, 2, 3]` leaves `x`'s type to its uses, so `x.show()` there is refused, as `xs.fold(0, (acc, x) => acc.add(x))`'s `acc` is; `let xs = [1, 2, 3]` first, which takes the literals' default at the `let`, decides it. Nor does it decide the result of a call to a member of a `fun` block whose knot is still open, whatever that member's signature writes: a member's type meets its written signature only where its own body is checked, so reading it at the dot would follow the order the members are declared in. `Vector.isEmpty(b(n))`, or a binding with its type written, is the spelling inside the block. A lambda in a call such a result is handed to (`Seq.any(b(n), (k) => k.show() == "1")`) is not decided either, and nor is a lambda handed to an open member itself, whatever its signature writes: inside `fun go(n: Int, k: (Vector(Int)) -> Int): Int = … go(n - 1, (r) => k(r.append(n)))`, the call to `go` is not decided, so `(r: Vector(Int)) =>` is the spelling.

### 3.2 Why the text, and not the lines

"Known at the dot", read from inference, makes a program's meaning follow its line order: `Vector.length(v)` above `v.at(3)` would dispatch, and below it would not — the defect §11.3 disqualifies. Waiting for evidence from the whole region keeps the order out of the verdict, at a price paid everywhere else (§11.10): a body that calls a waiting dot call cannot know its own colour until the deadline (Effects §3.4), a goal the deadline never reached left a clean compile calling `undefined` (#1182), and the deadline's field reading gave one spelling two meanings, chosen by what inference happened to know (§11.8). Reading the text decides the same program the same way in every order, at the dot, and asks only for what the fundamental spellings always asked: a written type, or the module's name.

### 3.3 A numeric literal subject

A numeric literal's type is fresh and its own: no other line can name it. So where a literal, or a literal's arithmetic (`(40 + 2)`), is a dot call's subject and no face reached it through the receiver rule (§2.2), it takes Numeric Literals §4's default at the dot. `42.show()` is `Show`'s member at `Int`, exactly as bare `show(42)` is, and `7.div(2)` is `Integral`'s at `Int`. A subject the text decides whose head is still open at the dot for any other reason — a call to a function whose result is a bare type variable no argument fixes — is refused (§3.5): the text names no type there either.

### 3.4 Resolution by receiver shape

Where the text decides the subject (§3.1), the head of its type determines the call's meaning:

| Receiver's type | Meaning |
|---|---|
| **Structural record** (closed or open row) with field `name` | Field access, then an ordinary call: elaborate as `(e.name)(args…)`. The field must be function-typed with matching arity — failures are the ordinary type/arity errors, phrased against the field. |
| **Structural record without field `name`** | The standard missing-field error naming the known fields (Products §3.2 family). Companion dispatch is never attempted — structural types have no home module (Modules §2). |
| **Nominal type `T`** (record, union, opaque, built-in collection) | **Collision check first** (§6): if `name` is claimed by more than one of — a field of `T` *visible at this site*, an exported companion operation of `T`, an honored constraint member of `T` (§4.2) — hard error naming every claimant. Exactly a visible field → field call, as the structural case. Exactly a companion operation → **rewrite**: `CompanionOf(T).name(e, args…)`, thereafter an ordinary qualified call — arity, types, constraints, dictionaries all proceed as if the user had written it, its argument seats widening exactly as the qualified spelling's do (Numeric Literals §5.1 — `b.bump(p)` for `bump(box: Box, k: BigInt)` and `p : Int` is `bump(b, BigInt(p))`, #783), and a `Seq` parameter adapting its argument as the qualified spelling's does (Collections Part 5 §3.4). Exactly an honored member → **member dispatch**: the call elaborates as the member's **open** call applied to `(e, args…)` — exactly the elaboration the bare or constraint-qualified spelling takes with `e` in the subject seat (Constraints §6.1) *(#808; this cell once pre-selected the `C<T>` instance at the receiver — §16.3)*. The subject is established from the operands, an established `Nat`/`Int` operand injecting where another operand establishes a wider type (Numeric Literals §5.1's seat widening — `i.compare(b)` is `compare(BigInt(i), b)`, as `Ord.compare(i, b)` is), and, at a **tower member**, from the seat's written face through the expected-type lift; the instance is then selected by coherence at the subject so established. Where no numeric widening applies that is the instance at the receiver's type, as it always was; where a wider operand or face stands, the receiver widens into it — `r.add(i)` at `Rat` injects the `Int`, `count.multiply(price)` runs at `Float`. The receiver names the operation; it does not pin the algebra. None → the neither-error (§9, row 4), with near-miss suggestions drawn from the field, companion, and member sets. |
| **Primitive** (`Int`, `Nat`, `BigInt`, `Float`, `String`, and compiler-known nominals like `JsValue` — added with #511, classification only: its companion ties by rule, §4.1's boundary row, not by the five primitives' source-migration story below) *(`Bool` moved to the nominal row — reclassified as a prelude union 2026-07-29, #147; see the note under §4.1. `Nat` and `BigInt` added to this row with #304/#335 — the rows ascription.md §6.1 recorded as this arc's debt. `Unit` retired to the tuple row with #344 — it is the empty tuple (#159), and its listing here was a pre-#159 anomaly; no `Unit.hex` exists or ever will)* | As the nominal case, with `CompanionOf` the fixed prelude companion (§4.1). `Range` left this row with #1073: its companion, `stdlib/Range.hex`, declares it by a public row, so it is §4.1's prelude-nominal case. `Seq` left this row's examples with #932: it is declared in `stdlib/Seq.hex`, and its companion is the ordinary home-module rule of §4.1's prelude-nominal row. No fields exist, so the collision surface is export-vs-member only. *(#808.)* `Nat` and `Int` receivers also **own** the tower members their type cannot honor — §4.2's ownership clause — so `n.subtract(m)` and `i.divide(j)` resolve as the open call and take a written face, refusing without one exactly as `n - m` and `i / j` do. Every companion supplies both halves as ordinary source (`BigInt.hex`, then `Int.hex` and `Nat.hex`, then `Float.hex` and `String.hex` — #344, migration complete): `42n.show()` is `Show`'s member at `BigInt`, `n.div(2)` is `Integral`'s member at `Int`, `1.5.show()` is `Show`'s member at `Float` through `stdlib/Float.hex`'s own `honor` block. |
| **Tuple** (including `Unit`, the empty tuple — #159, #344) | `name` of the form `itemN` → the existing positional interpretation (Products §2.3) followed by a call, i.e. `(t.itemN)(args…)`; the component must be callable. Any other name → the existing tuple-dot errors. Tuples have no companions (§5); nothing new. |
| **Function type** | Error: functions have no fields and no companion (§5). |
| **Declared type variable** *(row amended for #304/#335 — see §16.2; was a blanket refusal)* | **Bound-member dispatch.** If `name` matches exactly one subject-first member of the variable's declared bound constraints (bases included, Constraints §2.1), the call elaborates as that member applied to `(e, args…)`, evidence-dispatched through the binder's dictionary — `x.compare(y)` under `a: Ord` is `compare(x, y)`. More than one match → the §6-family refusal naming each member's qualified home (the unqualified spelling where a home is the current module — §6). No match → the bespoke type-variable diagnostic (§9, row 7): the bounds are the *entire* candidate set — no instance search, no companion consultation — so no row is ever imposed on a declared variable. |

### 3.5 The refusal

A dot call whose subject's type the program's text does not decide is refused, at the dot's name:

> the program's text does not decide `v`'s type here, so `.at(…)` cannot tell whose `at` it is — write `v`'s type, or call the operation by its module (`Module.at(v, …)`); a record's field is called as `(v.at)(…)`

Where the subject is not a name, the report says "the subject's". It carries **no fixit**: the text says neither the type nor the module meant, and a member name never nominates one (§1). It names the three fundamental spellings and leaves the choice to the writer.

- The arguments are still elaborated, without expectations, so their own reports stand beside the refusal.
- The call is typed as an error, so an enclosing dot call says nothing more.
- Where the subject's own elaboration already reported — an unknown name, a refused operation, a name used above its import — or where its names take their types from a call or value already refused (a lambda parameter of a refused call, a part of a refused dot call), the refusal adds nothing.
- A refused dot call owes no mark (§2.1).

Every refused dot call compiles with its subject's type written, through its module's function (`Vector.at(v, 3)`, the canonical spelling, §1), or, where a record was meant, through the record spelling (§3.6).

### 3.6 The record spelling

`(e.name)(args…)` is field access followed by an ordinary call, and it is how a record's callable field is called on a subject whose type the text does not decide: `fun f(r) = (r.callback)(3)` infers `{callback: (Int) -> a, ...} -> a`, the row-polymorphic type (Products §3.2, §4). The dot itself never imposes a row. A row the field spelling imposes meets a nominal type at a use as any row does, and where the field's name matches an exported companion operation of that type, or a subject-first member honored at it, the report names the operation (§9 row 8). On a subject the text decides is a structural record, the dot call is a field call (§3.4's first row): `fun f(r: {callback: (Int) -> Int, ...}) = r.callback(3)`.

---

## 4. `CompanionOf` — definition

### 4.1 The function

`CompanionOf` is total over eligible receiver heads and requires no search:

| Receiver head | Companion |
|---|---|
| User nominal type (`record`/`union`, incl. `opaque`) | The type's **home module** — the module whose text contains its declaration (Modules §7.2). Not the importer's alias, not any import path: the declaration site, unconditionally. Diagnostics and hovers *spell* it using the companion idiom (`Box.size`), which Modules §5.3 blesses. |
| Extern nominal type (`extern type` or `extern class`) | Its **binding module** — the module whose text contains the extern declaration, hence its foreign type home. Exported subject-first receiver members form its companion operation set under §4.2 exactly like Hexagon-defined operations (FFI Part 5 §9). |
| `Int`, `Nat`, `BigInt`, `Float`, `String` | The fixed prelude companion of the same name (Modules §5.3: `Int.div` etc. — "one reading, not a special prelude device"). *(`Nat`/`BigInt` rows added with #304/#335; `Unit` left this row with #344 — the empty tuple takes the tuple story, §3.4.)* All five companions exist as source (#344 — `Float.hex` and `String.hex` completed the fixed migration order) and are the ordinary nominal case in every respect; Modules §5.3's transitional machinery retired with the last landing, and §6.4's qualified-home guarantee held throughout the migration. |
| Prelude nominal types (`Vector`, `Map`, `Set`, `Option`, `Result`, `Bool`, `Range`, `Seq`, `Ordering`, `Array(a)`, `JsMap(k, v)`, `JsSet(a)`, …) | Their prelude companion modules — the same rule as user nominals for a prelude type declared in source (`Option`, `Result`, `Bool`, `Seq`, `Ordering`, …), whose home is the prelude module that declares it; and `Vector`, `Map`, `Set`, `Range`, and the captured `Array`, `JsMap`, and `JsSet` are declared by public intrinsic `type` rows in their companions *(Intrinsics §3.3; #1071, #1073, #1076)*, which reads the same rule. The public row's type is tied by name to the module addressable under the name, the boundary row's mechanism, and no dispatch outcome turns on which tie applies: `xs.length()` is `Array.length(xs)` (FFI Part 2 §13.1), and each further `Array` companion operation joins the set as it ships (Part 2 §9.1); `m.get(k)` and `s.contains(x)` are `JsMap.get(m, k)` and `JsSet.contains(s, x)` (FFI Part 10 §3); `xs.toSeq()` and `m.toSeq()` are the companion's `Iterable` member, not an export. Listed separately only to record that built-ins are *not* special-cased in dispatch. The authoritative inventory is the stdlib listing's. |
| `JsValue` *(#511)*; non-absorbed `Nullable(a)` *(#786)* | The fixed prelude companion of the same name. These boundary types are compiler-provided, so the tie is by rule — the primitive row's pattern: `v.kind()` and `v.toInt()` are `JsValue.kind(v)` and `JsValue.toInt(v)`. At a non-absorbed `Nullable(a)`, `value.toOption()` is `Nullable.toOption(value)` (#786). If the type has collapsed to `JsValue` or a both-nullish enum, dispatch uses that resulting type's ordinary companion; write `Nullable.toOption(value)` for the nullish projection. No fields exist on these boundary values, so the collision surface is export-vs-member only. |

*(Amended 2026-07-29, #147.)* `Bool` moved from the fixed-primitive-companion row to the prelude-nominal row here, and out of §3.4's **Primitive** row: since the ML-dialect ruling it is the prelude union `union Bool derives (Eq, Ord, Show, Hash) = False | True` (Unions §8), and its declaration lives in real prelude source whose home is the `Bool` companion module itself — the `Seq.hex` model (`decisions-ml-dialect-bool-2026-07.md` §3.5) — making this row's "built-ins are not special-cased" rule literally true of it. `CompanionOf(Bool)` is the same `Bool` companion module as before, and every dot call on a `Bool` receiver resolves exactly as before: **no dispatch outcome changes**. The move is recorded anyway because dot-call dispatch has proven sensitive to symbol classification (the #134 fun-versus-extern lesson): a resolver that classifies `Bool` by the wrong row is one refactor away from a real defect, and these tables are what it gets checked against.

### 4.2 The companion operation set

The dot-callable operations of a type `T` are exactly *(second clause added for #304/#335 — see §16.2)*:

> the functions **exported** by `CompanionOf(T)` whose **first parameter's type is `T`-headed**, **unioned with** the **subject-first members of every constraint honored at `T`** — and, for `Nat`, `Int`, and `BigInt` alone, the subject-first members of the tower rungs they do not honor (the ownership clause below, #808).

**A subject-first member** is one whose first parameter's declared type is the constraint's subject variable itself — `show(value: a)`, `compare(left: a, right: a)`, `div(left: a, right: a)` qualify; `fromNat(value: Nat) -> a` does not (the subject appears only in the return), so `42.fromNat(…)` is not a spelling and never will be. This is the member-side analogue of the `T`-headed test below, and equally syntactic: decidable per declaration, no unification consulted.

**The ownership clause** *(#808; exact BigInt source extension, September 2026)*.
A `Nat`, `Int`, or `BigInt` receiver — the three exact sources of Numeric Literals
§5.1 — also owns subject-first members of the closed tower rungs it does not
honor (`Num`, `Signed`, `Frac`, `Pow`, `Integral`, `Bitwise`). Thus Nat gains Signed's
`subtract`/`negate`, Frac's `divide`, and Bitwise's six members (`bitwise.md` §5.1);
Int and BigInt gain Frac's `divide`.
Honored and owned-but-unhonored are disjoint member sources; a spelling is not
added twice. Existing members and `widens` doors keep their ordinary treatment,
including BigInt's wider `pow` companion.

An owned member resolves as an open tower call. An expected Rat home makes
`big.divide(otherBig)` exact Rat division after FromBigInt conversion, just as
`big / otherBig` does there. Without a legal independently established home,
BigInt division is refused for missing `Frac<BigInt>`; it never guesses Rat or
Float. Nat/Int examples and their existing diagnostic repairs are unchanged.
For BigInt, do not suggest Float as a wider face: Float lacks FromBigInt.

The clause reaches only these fixed source types and the canonical tower rungs.
It never searches a destination's companion or grants an unhonored user-constraint
member merely because conversion is available. User constraints may still create
ordinary honored-member collisions, under §6 and the orphan rule. An ordinary
export in any of the three source companions with an owned tower spelling would
be a second claimant, subject to the same refusal; a declared `widens` door uses
its existing carve. LSP completion lists owned-but-unhonored members as needing
a face (§8.4). `FromBigInt` is not a tower rung, and its source-first conversion
member is not subject-first.

**Membership stays a declaration-indexing operation.** Coherence (Constraints §5.1) keys instances on (constraint, constructor) program-wide, so "constraints honored at `T`" is a table lookup with at most one instance per key — as total, deterministic, and import-insensitive as the export set. Where the two clauses (or two honored constraints) put one spelling in the set twice, the fused call form is refused naming every qualified home (§6); no ranking exists. Member dispatch elaborates as the bare member call with the receiver in the subject seat — §3.4's open call: evidence selected by coherence at the subject the operands and face establish, which is the receiver's own type wherever no numeric widening applies, erased where monomorphic uses erase (Constraints §6.1); the companion clause's rewrite target is `CompanionOf(T).name(…)` as before.

**`T`-headed is a syntactic test, not a unification question**: after expanding transparent aliases, the first parameter's outermost type constructor is `T` itself. Constructing the candidate set is therefore a **declaration-indexing operation** — decidable per declaration, once, with no speculative unification anywhere (many types *unify* with `T(…)`, starting with a fresh variable; none of that is consulted). *(Syntactic formulation: Sol.)* Worked examples:

```
map(v: Vector(a), f: a -> b): Vector(b)    -- included: outermost constructor is Vector
empty(): Vector(a)                           -- excluded: no first parameter
make(x: Float, y: Float): Point              -- excluded: first parameter not Point-headed
identity(x: a): a                            -- excluded: bare type variable, no constructor
```

- **Exported only, uniformly** — including inside the home module itself. Making private functions dot-callable inside-only would give a type a visibility-dependent method set; inside the home module bare calls are available anyway. (Alternative rejected, §11.9.)
- **The subject-first filter is nearly free**: the stdlib convention (Operators §8 — first parameter is the subject, normative) means companion modules are already shaped for this. `Vector.empty` is correctly invisible after a dot, per the table above.
- **No overloading exists** (one function per name per module — Modules §5.2), so each *clause* yields at most one candidate per name; where the union holds two, the call is refused naming both homes (§6) — never ranked. Arity and argument types are checked *after* resolution as an ordinary call, with ordinary errors. Resolution is by name; typing is by the resolved function or member. Within the honoring module itself the two clauses cannot even collide: an ordinary binding of a member's spelling is the rebinding error (Constraints §4.6), so an export-vs-member split there is unwritable — the cross-source collision requires the instance to live in the *constraint's* home under the orphan rule.
- The set is **import-insensitive**: whether the *call site's module* imported the companion is irrelevant to resolution (the compiler is whole-program; the home module is in the graph by reachability of the type, and instances are global once their module is — Modules §7.1). No `use`-changes-methods spookiness, by construction. Emission handles the import (§8.2).

### 4.3 Transparent aliases and `opaque`

- **A transparent alias inherits the expansion's companion.** `type Name = String` gives `Name`-typed values `String`'s operations, because a `Name` value *is* a `String` (aliases are transparent everywhere — Modules §6.2). An alias never introduces a companion identity of its own; a module declaring `type Name = String` contributes nothing dot-callable to `Name`. *(Clarification: Sol.)*
- **`opaque` types are the pattern working at its best**: outside the home module the fields are invisible (Modules §4.2), so no field/companion collision is even possible there, and every dot call is companion dispatch against the exported surface. Inside the home module fields are visible and the collision rule (§6) applies as usual.

### 4.4 Declaration order within the home module

§4.2's candidate set is indexed from declarations and is order-independent — *what* is dot-callable never depends on where in the home module an operation sits. Whether a given call site may **reach** a candidate is a separate question, and it has the same answer as every other reference (Functions §7.2):

- **A dot call is legal exactly where a reference to the operation is legal.** §1's rewrite makes this forced rather than chosen: `e.name(args…)` *is* a call of the companion operation — spelled qualified from other modules, bare in the home module, which cannot name itself — and that callee must be declared above the call site like any reference. Within the home module, then, a dot call may target only an operation declared **above** it. Call sites in other modules see the whole exported surface, as always — §4.2's import-insensitivity is untouched.
- **A dot call never targets a member of the caller's own `fun` block** (Functions §7.3): calls within a block are spelled by name. "Within" reads textually and at any depth — a dot call anywhere inside a member's body, a nested lambda or inner `fun` included, never targets that block, because any such call is a block edge the reference graph cannot see. Recursion, direct or mutual, therefore never hides behind a dot — and dispatch can never create a reference-graph cycle the resolver cannot see, which is what keeps §4.2 a declaration-indexing operation with no type-directed feedback into dependency analysis.

**Member-resolved dot calls are exempt from both rules** *(#304/#335)*. A dot call that resolves to an honored constraint member is an **evidence route**: it names no binding — elaboration reads a dictionary slot at call time — so it creates no reference-graph edge, and the top-down law governs name references only (Constraints §4.6). A member-resolved dot call is therefore legal anywhere in the honoring module: below the honor block, inside a sibling member, and inside the member's **own body**, where it is the sanctioned recursion spelling (`kid.show()` — the own-name refusal, Constraints §4.6, is what forces recursion out of the bare form). No honor-block analogue of the `fun`-block dot ban exists, and the asymmetry is principled, not an oversight: the block's ban protects the resolver's reference graph from edges dispatch would hide, and member dispatch never enters that graph — mutually referencing instances were already legal through interpolation for the same reason. The emission fault line for instance recursion (safe inside member lambdas, a fault before the instance's own `const` initializes) is Constraints' §6.3 territory and is unchanged by the spelling.

Neither rule disturbs §3: whether the text decides a subject is read from syntax and declarations, and declaration order constrains which declarations a resolved call may name, not how the subject's type is known.

Diagnostics: an operation that exists in the companion but sits below the call site, or inside the caller's own group, is reported as exactly that (§9 rows 12–13) — never as "the companion has no operation", which would be false.

---

## 5. Coverage

*(Category list: Sol's formulation, adopted with the tuple/record clarifications.)*

**Eligible receivers (companion dispatch can fire):**

- nominal records — including `opaque`;
- nominal unions — no field access exists on union values, so no collision surface; the cleanest receivers the feature has (`option.defaultValue(default)`, `result.map(f)` — still static companion calls, not object methods);
- extern nominal types and extern class types — their binding module is the companion, and their opaque values expose no Hexagon fields (FFI Part 5 §9);
- prelude nominal collection and utility types (`Vector`, `Map`, `Set`, `Range`, `Option`, `Result`, `Seq`, `Array(a)`, `JsMap(k, v)`, `JsSet(a)`, …) — `r.toSeq()` at a `Range` and `xs.toSeq()` at an `Array` are their companions' honored members, and `s.toSeq()` at a `Seq` is `stdlib/Iterable.hex`'s (Collections Part 5 §4) — an honored member is found by coherence wherever its instance is declared (§4.2), so it needs no companion to hold it; `xs.length()` (Part 2 §13.1), `m.get(k)`, and `s.contains(x)` (FFI Part 10 §3's surfaces) are companion exports (§4.1's authoritative inventory is the stdlib listing's);
- primitives, through the fixed prelude companions (`"a,b".split(",")`, `n.toFloat()` — inventory per stdlib listing) and their constraint instances — all source since the migration completed, #344 (`42n.show()`, `n.div(2)` — §3.4's primitive row);
- `JsValue` and non-absorbed `Nullable(a)` — compiler-provided boundary types tied to their fixed prelude companions by rule *(#511, #786; §4.1's row)*: `v.kind()`, `v.toInt()`; their values expose no Hexagon fields, so no collision surface; `value.toOption()` at a non-absorbed `Nullable(a)` calls its fixed `Nullable` companion (#786), with absorption following §4.1's resulting-type rule;
- **declared type variables, for bound-member dispatch only** *(moved from the ineligible list for #304/#335 — §16.2)*: `x.compare(y)` under `a: Ord` dispatches through the binder's evidence; the candidate set is the declared bounds and nothing else — no companion exists or is consulted;
- transparent aliases of any of the above, via expansion (§4.3).

**Ineligible (dot never means companion dispatch):**

- structural records — dot is field access there, full stop; "excluded" means excluded from *companion dispatch*, while `x.run(3)` on a callable field of a subject the text decides is a field call, and `(x.run)(3)` calls one on any subject (§3.6);
- tuples — except the existing compiler-defined `itemN` positional access (Products §2.3), which §3.4 folds in unchanged;
- function types;
- a subject whose type the program's text does not decide — refused (§3.5); a declared variable whose bounds hold no matching member is refused too (§3.4);
- structural aliases *as such* (they defer to their expansion — §4.3).

---

## 6. Field/method collision — hard error at the use site

*(Extended for #304/#335: the honored-member clause of §4.2 adds a third candidate source. The law is unchanged in kind — any two of {visible field, companion export, honored member} claiming the fused call form is the same hard error, naming every claimant with its disambiguating spelling: the qualified companion call, the field spellings below, the member's qualified home (its declaring module — `Show.show(x)`), or, where two honored constraints collide, each declaring module's spelling. Where a claimant's declaring module **is the current module**, no qualified spelling exists — a module cannot name itself — and the refusal names the unqualified spelling in its place, which is unambiguous there: the declaration's member is the module's own binding, and consequence-5's import shapes keep any rival out of unqualified scope. Member-vs-member ambiguity on a declared type variable takes the same refusal shape, §3.4.)*

For a nominal type `T` with transparent (or locally visible) fields, `name` may be both a field of `T` and an exported subject-first operation of `CompanionOf(T)`. The declarations are **legal to coexist** — no declaration-time restriction — and the ambiguous *spelling* is a hard error where it appears:

```
box.size()
-- ERROR: `box.size()` is ambiguous.
--   `Box` has:
--     • a field `size`
--     • a companion operation `Box.size`
--   Write `Box.size(box)` to call the companion operation.
--   [field callable]      Write `(box.size)()` to call the stored field.
--   [field not callable]  Write `box.size` to access the field.
```

**The fixits are conditional on the field's type.** `Box.size(box)` is always offered; the field-side fixit is `(box.size)()` only when the field is function-typed — for a non-callable field (`size: Int`), that spelling is not a fix, and the message instead points at bare `box.size` for the access. *(Error shape and the conditionality: Sol; both offered forms are pre-existing grammar, per §2.1.)*

- **Resolution is name-based, not type-based**: a *non-callable* field named `size` still collides with a companion `size` at the call form. Otherwise `e.name` and `e.name(…)` would resolve `name` through unrelated mechanisms depending on the field's type, and changing a field's type would silently change which mechanism a call site uses. *(Rule and rationale: Sol, confirmed.)*
- **Visibility-scoped**: the collision requires the field to be *visible at the call site*. For an `opaque` type, call sites outside the home module see no fields and cannot collide (§4.3).
- The bare form `box.size` and the parenthesized form `(box.size)()` are never ambiguous — they are field access by grammar (§2.1). Only the fused dot-call form carries the question, so only it can error.
- **Consequence, chosen with eyes open** (recorded from the decision session): use-site collision makes dot-call availability fragile under library evolution — an upstream module adding a field named `size` breaks downstream `box.size()` call sites. The breakage is loud, local, and mechanically fixable (Rewrite Rule holds; both fixits are in the message), and it lands on call sites that add a qualifier rather than forcing the upstream author to rename a *public* export — which is why use-site beat the declaration-time ban (§11.5).

### 6.1 One claimant under the generalisation law *(#541)*

The refusal above counts **claimants**, and Modules §5.3's generalisation law changes what counts as one: a companion's `widens` binding and the member it supplies (Constraints §4.7 — the member is the binding's derived restriction) are **one claimant, not two**. They are one operation wearing two widths, so there is nothing to disambiguate and nothing to rank: the dot call resolves as the companion-operation rewrite, `CompanionOf(T).name(e, args…)`, which under Modules §5.3's resolution order is the **widens binding** — the operation's widest face, worn with the face the door's body solved to, as every call of the member at that type is *(#867; #1144; Effects §13.3)*. `x.pow(0.5)` at `Float` and `x.pow(2n)` at `BigInt` are therefore ordinary dot calls, not collisions (Operators §6.3.1). A list-form declaration (`widens Pow.pow, Mul.pow(…)`) is the same fact at more members: every listed member is the one body's restriction, so the whole family is one claimant and the dot shows the one widest face. The no-ranking doctrine (§1) is untouched: it refuses genuinely rival sources, and the law's whole content is that these are not rivals — same-spelled members from distinct honor blocks with no `widens` declaration over them remain genuine rivals, count their full number of claimants, and are refused exactly as before.

*(#808.)* A door is a **written face**, not a member spelling: the dot addresses it by the receiver's type (`x.pow(2n)` at `BigInt`, `x.pow(0.5)` at `Float`), and its argument seats widen *into* it by Numeric Literals §5.1's ordinary seat widening — `b.pow(i)` for `i : Int` is `pow(b, BigInt(i))`, as the qualified `BigInt.pow(b, i)` always was (#783, folded here). The member the door restricts keeps its own reading at its own types: `i.pow(2n)` at `Int` refuses with the exponent seat's fixit naming the door (§9 row 14), matching `i ** 2n` and `Pow.pow(i, 2n)` — the dot shows a door only at the door's own type. The principle, stated once: **members widen by their operands; doors are addressed by the receiver.**

---

## 7. Constraint members are dot-callable — through instances and bounds, never through search

*(Rewritten for #304/#335 — this section previously excluded members from dot syntax entirely; §16.2 records the reversal and what made it sound. The exclusion's real target — instance search on unknown types, import-sensitive method sets — remains excluded below.)*

`show`, `compare`, `div`, `add`, … are constraint members, and since the members-as-values ruling (Constraints §2.2) they are ordinary module-scope values with declaring-module homes. Dot syntax reaches them through exactly two doors, both already open in the resolution table (§3.4):

- On a **head-known receiver**, the operation set includes the subject-first members of constraints the receiver's type honors (§4.2). `42.show()` (the literal's default, taken at the dot, §3.3), `(42: Nat).show()`, `42n.show()`, `42.0.show()`, `n.div(2)`, `r1.add(r2)` — each is the member with the receiver in the subject seat, elaborated exactly as the bare call `show(42)`, `div(n, 2)`, `add(r1, r2)` would be (§3.4's open call), the instance selected by coherence at the subject the operands establish. No companion module is consulted or required.
- On a **declared type variable**, the candidate set is the variable's declared bounds — `x.compare(y)` under `a: Ord` dispatches `compare` through the binder's dictionary (§3.4's amended row). The bounds are written in the header; nothing is searched, nothing is imported, and an unbounded or unmatched variable is refused with the options message (§9 row 7), never row-constrained.

What stays excluded, and the sentence that guards it: **dot syntax never *discovers* a member — it dispatches members the receiver's type or bounds already own.** A subject the text does not decide is refused (§3.5); no instance table is scanned to guess a receiver type (member names never nominate — §1); no import adds or removes a member from any receiver's set (coherence is whole-program). The §11.7 rejection was of extension-trait machinery; bounds and honored instances are the opposite of that machinery — closed, declared, orphan-ruled sets.

**Tower members widen through the dot** *(#808)*. `add`, `multiply`, `subtract`, `negate`, `divide`, `pow`, `div`, `mod`, `quot`, `rem`, `gcd`, and `Bitwise`'s `bitAnd`, `bitOr`, `bitXor`, `bitNot`, `shiftLeft`, `shiftRight` — the subject-first members of the tower's closed rungs (Numeric Literals §5.1) — reach the dot as the **open** member call, not the instance at the receiver's type: `count.multiply(price)` and `price.multiply(count)` are both `Float`; `i.add(b)` and `b.add(i)` are both `BigInt`; `i.compare(b)` widens too, though by the injection layer at the seat rather than the lift (`Eq`/`Ord` are not rungs). One exception, by §6.1: where the receiver's type declares a door for the member (`pow` at `BigInt` and `Float`), the dot addresses the door — a written face whose seats the arguments widen into — not the open member. The expected-type lift reaches every spelling of a tower member call with a subject-typed result — `let r: BigInt = i.add(j)`, `i |> Num.add(j)`, and `Integral.div(i, j)` alike — so the silent-overflow case the lift exists to prevent has no spelling left to hide in. §4.2's ownership clause supplies the three source types with the rungs they do not honor; on a declared type variable the bound-member row already dispatches through evidence, and an `Int` operand injects there through the binder's `fromInt` exactly as it does under the operator (`count.multiply(value)` under `a: Signed`).

Two footnotes the old text carried, updated: a companion cannot export a monomorphic subject-first `show(x: Int): String` at all — inside the honoring module that spelling is the unconditional rebinding error (Constraints §4.6, #546); the member's wider face, where one exists, is a `widens` declaration (Constraints §4.7), which the dot reaches as one claimant (§6.1). The stdlib-listing question "monomorphic `show` companions?" (§12.4) is settled by construction: the member **is** the operation — identically, or as the widens binding's derived restriction — and a duplicate export is unwritable. The guide's teaching gains a spelling rather than changing: bare (`show(x)`), piped (`x |> show`), qualified (`Show.show`, `Int.show`), and — on known types and bounded variables — the dot.

---

## 8. Emission, `.d.ts`, and the LSP

### 8.1 Dot calls vanish

Resolved companion dispatch is an ordinary qualified call before lowering; **the dot-call node does not survive into codegen**. Emission is whatever the equivalent hand-written call emits:

```
v.at(3)          -- emits: at(v, 3)         (named import per Modules §11)
opt.defaultValue(0) -- emits: defaultValue(opt, 0), or its established inlining
r.callback(3)    -- (field call) emits: r.callback(3)   — the honest POJO read
```

Field-resolved dot calls emit *as themselves* — a JS property access and call on a POJO, which is exactly what the semantics is. Companion-resolved calls retain the resolved declaration's ordinary lowering: a Hexagon-defined operation emits the named-import call, subject to established inlining rights, while an extern receiver member retains its FFI linkage and may emit a receiver call or property access directly (FFI Part 5 §9). **Member-resolved calls emit exactly what the constraint-qualified member call — or the bare one, where the prelude seeds it — emits at the same type** (Constraints §6.1/§6.5): the concrete instance's slot where selection erases, the forwarder with passed evidence where it does not — the dot spelling adds no emission shape of its own. Method Syntax itself adds no runtime method, prototype change, or hidden `this`.

*(#808.)* **A member call at a type JavaScript represents by a primitive value emits what a person would write in JavaScript** for that operation — in every spelling: operator, bare where the prelude seeds one, constraint-qualified, pipe stage, or dot; a companion-qualified spelling is a written face (§1) and emits what its face's operation emits. The principle is general, above the numeric tower: **where a person would write a JavaScript operator, the compiler writes that operator** — Constraints §6.1 owns the rule, and Operators §5.1, §4.5, and §6 own the lowerings it copies. "Primitive" here names a representation, not §3.4's classification: the rule reaches `Int`, `Nat`, `Float`, `BigInt`, `String`, and `Bool` — a prelude union whose representation is pinned to `boolean` (Operators §4.5) — because JavaScript's operators carry a member's meaning only on the values it represents natively; a `Rat` or a user record is an object, on which `+` and `===` mean the wrong thing, so there the same test answers "a call": the seat call the member spellings already emit, and the call the operator spelling owes as well (#810). The rule: **wherever the operator spelling of a member lowers to a JavaScript operator at the type — Operators §1.1's table read backwards: `add`, `multiply`, `subtract`, `negate`, `divide`, `pow`, `concat`, `equals`, `notEquals` — every other spelling of that member produces the operator spelling's lowering, verbatim, helper and all.** `i.add(b)` emits `BigInt(i) + b`; `Num.add(i, j)` at `Int` emits `i + j`, where before this amendment only the operator spelling did and the member spellings emitted `add(i, j)`; `Float.multiply(count, price)` emits `count * price`; `i.negate()` emits `-i`; `f.divide(g)` emits `f / g`; `Pow.pow(f, i)` at `Float` emits `f ** i` — `Float`'s power is total and its `**` lowers natively — while `f.pow(g)` and `Float.pow(f, g)` address the **door** (§6.1), a written face with its own `Float` exponent seat and no operator spelling, and stay its call; `i.equals(j)` emits `i === j`, `i.equals(b)` emits `BigInt(i) === b`, and `p.equals(q)` at `Bool` emits `p === q`; `s.concat(t)` at `String` emits `s + t`. Verbatim means the lowering as Operators §5.1 fixes it, not the slogan: `i.notEquals(j)` emits `!(i === j)`, exactly what `i != j` emits, never a `!==` this clause would have to invent — whether `!=` itself should read `!==` is the operator side's question (#810); `f.equals(g)` at `Float` emits the SameValueZero form `f == g` emits, helper included. Where the operator spelling does **not** lower to a JavaScript operator — `pow` at `Int`, `Nat`, and `BigInt`, guarded members whose `**` is itself a call; every `Integral` member, Hexagon-defined conventions; every `Bitwise` member at `Int`, whose true-integer semantics no JavaScript operator carries (at `BigInt` they lower to `&`, `|`, `^`, `~`, `<<`, `>>` — the shifts too, though no Hexagon operator spells them: `bitwise.md` §6 owns that lowering); `compare`, whose result is an `Ordering` no operator carries — every spelling emits the direct call to the member seat, `pow(i, j)`, which is what the member spellings emit today; that the operator spelling `i ** j` reads a dictionary slot instead is #810's business, not this clause's. `compare` thereby leaves two shapes in one file — `s < t` an inline `__compareString(s, t) < 0`, `s.compare(t)` the seat call — seen and accepted: the relational operators are tests on `compare`'s result (Operators §5.1), not spellings of it. The rule is about text, never meaning — the elaboration is one whichever spelling was written. A literal operand earns no shape a variable of the same type would not (Constraints §6.1: a shape is decided by the operation and its type, never by an operand's value). The conformance check at these sites is one text per operation across its spellings, and one value — where Constraints §6.1 allows two texts for one shape (an inline `Eq<Float>` test or its helper), the choice is made per site, never per spelling. Emission at object-represented instances (`Rat`, user types, parameterized and derived instances) is untouched by this clause.

### 8.2 Imports

If a call site's module never textually imported the companion, the emitter adds whatever dependency the resolved declaration's lowering requires — normally the companion's named import under Modules §11. An extern receiver member needs nothing for an instance call, which emits its receiver call inline in any module, and its binding module's `__class_<Type>` re-export for a static member or constructor — reached only by a qualified call, since neither has a subject (FFI Part 5 §2.2, §7) — never the foreign module's own import, whose relative specifier resolves only from the binding module's emitted place (FFI Part 4 §2.1). Emitted-name collisions are the emitter's ordinary renaming problem, not a semantics question.

### 8.3 `.d.ts`

Nothing to represent: the emitted functions have the signatures they always had, and no method appears on any emitted type. The `.d.ts` story is byte-for-byte what it was before this spec.

### 8.4 LSP obligation

Completion after `receiver.` must be driven by **the same resolution model**, at the current inference state: head-known nominal → visible fields ∪ companion operation set — honored members included, marked as members (§4.2); declared type variable → the subject-first members of its bounds; record row → known fields; a subject the text does not decide → no companion candidates, and the refusal (§3.5) says what to write. *(#808.)* After a `Nat` or `Int` receiver, completion also lists the tower members the type owns but does not honor (§4.2's ownership clause), marked as needing a written face. Resolution at the dot (§2.2) is what makes mid-chain completion (`v.map(f).|`) work — each link's subject is the call before it, which the text decides where its own subject is; this is a design requirement on the checker's incremental behaviour, not a nicety. The discoverability payoff for the target audience is a first-class motivation of the feature and the LSP row is therefore normative, not advisory.

---

## 9. Diagnostics checklist

| # | Situation | Error / hint |
|---|---|---|
| 1 | Field/method collision at dot-call form | the §6 message: name both interpretations; always offer `T.name(e)`; offer `(e.name)()` only if the field is callable, else point at bare `e.name` for the access |
| 2 | Structural receiver, no such field | existing missing-field error (Products §3.2 family) — companion dispatch never mentioned |
| 3 | Field resolved but not callable / wrong arity | the not-callable report, phrased against the field the way the mark reports name it — "`.at` is not a function — it has type `Int`, and this call supplies 1 argument" (#385; no arrow appears — a demanded arrow's colour is a claim about a call that does not exist); wrong arity keeps the ordinary arity error |
| 4 | Nominal receiver, name is no field, companion op, or honored member | "`Vector` has no field `at2`, module `Vector` exports no operation `at2`, and no constraint honored at `Vector` has a member `at2`" + near-miss suggestions from all three sets. A `Nat`/`Int` receiver owns every tower member (§4.2), so `n.subtract(m)` never takes this row — row 15 |
| 5 | Companion op exists but first parameter is not `T`-headed; or a member exists but is not subject-first | treated as row 4 (neither is in the operation set) — but hint at the near-miss: "`Vector.empty` does not take a `Vector` as its first argument; call it as `Vector.empty(…)`" / "`fromNat` does not take its constraint's subject first; call it as `Num.fromNat(…)`" |
| 6 | Dot call resolves to two claimants (field/export/member, member/member — head-known or declared-variable receiver) | the §6-family refusal: name every claimant with its disambiguating spelling — `Box.size(box)`, the field spellings, the member's declaring-module home (`Show.show(box)`), or the unqualified spelling where a claimant is declared in the current module (§6) *(row repurposed by #304/#335 — the old row-6 redirect died with §3.4's amended row: that case now dispatches)* |
| 7 | Dot call on declared type variable, no subject-first member in its bounds | "`a` is a declared type variable, so `.process` can only be one of its constraints' members, and none of `a`'s constraints has a subject-first member `process`; add the constraint to the parameter's binder, use a concrete nominal type, or call a qualified function" (§3.4, §7) |
| 8 | A row the record spelling imposed (§3.6) meeting a nominal type at a use — same module or across the program — where the field's name matches an exported companion operation of, or a subject-first member honored at, the nominal type | the enriched message: "this value's type was inferred as a record with a `length` field because its type was unknown where it was written; `Vector(Int)` is not a record. Annotate it to use dispatch, or call `Vector.length(…)` directly" — the companion named by the type's head, never its display; a member by its qualified home |
| 9 | Tuple receiver, non-`itemN` name | existing tuple-dot errors (Products §2.3), unchanged |
| 10 | Function-typed receiver | "functions have no fields or companion operations" |
| 11 | Uppercase name after dot with an argument list where left side is not a module alias | existing Modules §5.1 resolution/errors, unchanged — not this feature |
| 12 | Companion op exists but is declared below the call site (home module only) | "`Box`'s companion declares `twice` below this call; declarations are read top-down — move the declaration above this call" (§4.4; Functions §7.2 family). Never row 4's "no operation" |
| 13 | Dot call targets a member of the caller's own `fun` block | "a dot call cannot target its own `fun` block; spell the call by name: `map(s, f)`" (§4.4; Functions §7.3) |
| 14 | *(#808)* Tower member call, by the dot or in any other spelling, whose argument seat cannot widen — the member's written `Int` exponent seat at `i.pow(2n)`, `i.pow(0.5)` | Operators §6.3's mandatory fixit, branched on the exponent's type and naming the door (`BigInt.pow(value, exponent)` / `Float.pow(value, exponent)`), identical to `i ** 2n`'s; the span is the offending argument and the message names the seat and the conversion that could not apply — never the whole dot call, never a bare "type mismatch" (#783's second finding) |
| 15 | *(#808)* Owned tower member at a `Nat`/`Int` receiver with no written face (`n.subtract(m)`, `i.divide(j)` unannotated) | exactly the operator's refusal — `n - m`'s no-`Signed` diagnostic; `i / j`'s no-`Frac` diagnostic with the `Int.div`/`Int.mod` fixit (Operators §15) — carrying the rider both spellings owe since the lift admits them: name the written face that runs the operation (`let d: Int = …` for `Signed`'s members at `Nat`; a `Float` or `Rat` face for `Frac`'s at `Int`). The rider is keyed to the constraint-and-type pair (`Signed` or `Frac` at `Nat` or `Int`, and `Bitwise` at `Nat` — `let bits: Int = …`, `bitwise.md` §5.1) and rides the missing-instance report (Modules §7.6) at every expression seat that draws it; in **pattern position** it is omitted and nothing is offered in its place — a literal pattern at `Nat` (Pattern Matching §2.5) takes the report bare, a repair that is not valid at that position being one the seat does not name |
| 16 | *(#808, #821)* Tower-spelled dot call under a face honoring the spelling's rung, whose receiver is, or through Functions §4.3's forwarding forms hands the face to, a tower member call whose lift stands down — no ascription, binding, or companion-qualified spelling between — **and whose dot then resolves to a claimant outside the spelling's rung**: a companion export (`let n: BigInt = p.add(q).gcd(s)`, `Foo` honoring `Num`, its companion exporting `gcd(Foo, Foo): BigInt`), an honored member of a user constraint, or a function-typed field | the **receiver refusal** — one report, three facts, at the span of the outermost stood-down call the face reached, the fixit ascribing that call at the type it kept (the receiver itself where they coincide), offered only where that call would compile at the kept type — with `Foo` honoring no `Pow`, `(p.add(q) ** i).gcd(s)` gives the first two facts and no repair, since neither `(p.add(q) ** i: Foo)` nor a binding runs the power at `Foo`: "`gcd` is a member of `Integral` and `BigInt` honors `Integral`, so the `BigInt` here reached the receiver `p.add(q)`; `p` is a `Foo` and cannot enter `BigInt`, so the addition could not run at `BigInt`. To keep the receiver at `Foo`, ascribe it — `(p.add(q): Foo).gcd(s)` — or bind it first." Inside a form the ascribed expression is the stood-down call, `(if c then (p.add(q): Foo) else p).gcd(s)`, a repair by construction inside this row's scope. Never a second report at the binding, and none from inside the receiver (§2.2: the subject seats are established after every operand is in). The operand named is the one Numeric Literals §6's stand-down note carries; the type is spelled as it is spelled at the site (`Foo.Foo` across modules), and where it has no spelling in scope only the binding repair is offered. Where the claimant is the rung's own member (`p.add(q).multiply(s)`) the enclosing seat's ordinary stand-down report fires as today and no receiver fixit is offered — the ascription would repair nothing. A nested receiver (`(p + (i + j)).gcd(s)`) is this row at the outer addition, naming `p`, the first value that declined — never the pair `Foo` and `BigInt` the face's descent left behind — and a single-operand call (`(-p).gcd(s)`, `(p ** i).gcd(s)`) is this row at that call. A forwarding-form receiver whose parts disagree is not this row, whether or not a lift stood down inside it: the form's own report (Operators §11's, at the `if`; Pattern Matching §6.2's, at the arm body) names the branch that cannot enter the face and carries the boundary fixit under §2.2's licence only where that ascription compiles (`(if c then i + j else p: Foo)` does, `(if c then p.add(q) else b: Foo)` does not) — this row's branch case fires only where the form joins at the kept type |
| 17 | Dot call whose subject's type the program's text does not decide (§3.1) | the refusal at the dot's name (§3.5): "the program's text does not decide `v`'s type here, so `.at(…)` cannot tell whose `at` it is — write `v`'s type, or call the operation by its module (`Module.at(v, …)`); a record's field is called as `(v.at)(…)`", "the subject's" where the subject is not a name; no fixit (a member name never nominates, §1); nothing where the subject's own elaboration already reported |

Vocabulary rules: diagnostics say **companion operation** and **constraint member** (never "method" — nothing method-like exists at runtime, and the noun would teach the wrong model) and never say "row" (Products §4 ban, still in force). "Dot call" is acceptable in hovers and docs.

---

## 10. Dot calls are not deferred goals

A dot call is decided where it is written (§2.2), from the program's text (§3.1). It has no goal, no owner region, no deadline, and no fallback, so the Deferred-Goals Doctrine (Declarations Preamble §1.2) has no dot-call instance; its remaining instances — literal defaulting, the waiting sequence source, and the projection-bearing-constraint ban — are itemised there. A dot call meets a waiting sequence source only by being refused: a source whose head is not yet known is a subject the text does not decide (§3.5).

---

## 11. Rejected alternatives

1. **Lexical UFCS (D-style: `v.at(3)` → bare-scope `at(v, 3)`).** Rejected: Hexagon's collection operation names deliberately collide across companion modules and are normally module-qualified, so the unqualified name is usually absent or wrong; resolution would become import-sensitive; the pipe already serves bare functions; and lexical lookup provides no receiver-based completion — the feature's chief payoff. *(Rationale list: Sol.)* **Do not relitigate.**
2. **Rust's resolution machinery.** Recorded with the free/real split so the spec claims credit only where restraint was exercised. *Structurally inapplicable (free):* the deref/auto-ref ladder (no references exist), inheritance (none exists), implicit borrowing (none exists). *Genuinely rejected (real):* trait-method candidates / extension traits — the source of Rust's import-changes-methods spookiness; one candidate set here, ever — and any ranking of multiple candidates (none can exist, §4.2). **Do not relitigate the extension-trait exclusion**; it protects the Sol-review §B invisible-instance analysis.
3. **Eager resolution at the dot** ("dispatch if the receiver's type happens to be concrete when elaboration reaches the expression"). Rejected: makes meaning depend on Algorithm J's traversal order, and so on the order the program's lines come in — `Vector.length(v)` above `v.at(3)` dispatching, below it not. Disqualified, not merely disfavoured. **Do not relitigate.** **[Not what §3 does.** §3 also decides at the dot, but from the program's text (§3.1), which no line order changes: a subject is decided or not whatever the lines around it say, so a dot call means the same thing in every order. *(#808.)* The instance a member-resolved call selects is coherence's choice at the subject the operands' final types and the face establish (§2.2, §3.4).**]**
4. **Fields-win silent priority** at collisions. Rejected: adding or exposing a field would silently change which operation an existing call invokes, and a new companion export could be invisibly masked. Loud beats silent; no-warning-tier temperament. *(Consequence analysis: Sol.)*
5. **Declaration-time collision ban** (home module may not export a subject-first function named like a field). Rejected in favour of use-site (§6): it charges library authors for a feature their consumers may never use, breaks at a distance when a field is added, and its only cure is renaming a *public* export — worse churn than call sites qualifying. Revisit only with field evidence that use-site breakage under library evolution (§6, last bullet) is a real ecosystem pain.
6. **Bound-method values** (`v.at` as `() => Vector.at(v)`-ish, or any method reference). Rejected: implicit closure allocation, hidden receiver capture, equality-of-bound-methods questions, and a reintroduction of partial application through the back door. Not merely "Hexagon lacks currying" — a non-curried language *could* invent bound methods; Hexagon has no reason to. `map(vs, Vector.reverse)` stays qualified. *(Rationale: Sol.)* **Do not relitigate.**
7. **Constraint-member dispatch through dot** (`x.show()` resolving via instances on unknown or known types). Rejected for v1 and pre-registered as the feature's slippery slope: it is precisely extension-trait machinery, makes the method set depend on constraint solving, and taxes the bare-call doctrine (Sol-review §A) for nothing the LSP doesn't already provide. Revisit bar: §12.1. **[Reversed in part — §16.2.** The members-as-values ruling (#335) gave members declaring-module identities and export status, which is what this rejection said no scheme had: dispatch on *head-known* types and *declared bounds* is now table-lookup against coherence-keyed instances and written binders — no unknown-type dispatch, no constraint solving in the method set, no import sensitivity. The **unknown-type half stands rejected**: a subject the text does not decide is refused (§3.5), and member names still never nominate.**]**
8. **Reading an undecided subject as a record field** (the row fallback, this form's meaning before §3: "where the receiver's head is not known at the deadline, `e.name(args…)` *means* row-constrained field access"). Rejected: one spelling had two meanings, chosen by what inference happened to know — `fun f(v) = v.at(3)` a record function, `fun g(v: Vector(Int)) = v.at(3)` the companion's — and the contradiction surfaced at a use, at maximal distance from its cause. A dot call that cannot tell whose operation it names is refused at the dot (§3.5), and the record spelling says the field outright (§3.6). **Do not relitigate.**
9. **Private functions as dot-callable inside the home module.** Rejected: a visibility-dependent operation set; bare calls are available there anyway. Exported-only, uniformly (§4.2).
10. **Waiting for later evidence** (this form's lifecycle before §3: a receiver unsolved at the dot left a goal, resolved by unification anywhere in the receiver's owner region, at that region's finalisation at the latest, with the row fallback for survivors). Rejected: it kept line order out of dispatch at a price paid everywhere else — a body calling a waiting dot call could not know its colour until the deadline, so the effects machinery held bodies and settled their colours at the wrong moment (#1173); a goal the deadline never reached left a clean compile calling `undefined` (#1182); and its fallback was alternative 8. The text decides the subject at the dot, or the dot is refused (§3). **Do not relitigate.**

---

## 12. Hanging questions

1. **Dot access to constraint members, ever?** ~~Closed for v1 (§7, §11.7).~~ **Answered (#304/#335): yes, through instances and bounds** (§7, §16.2). The reopen bar this item set — a design satisfying §10's no-global-search, no-import-sensitivity test — was met not by a dispatch scheme but by the members-as-values ruling changing what members *are*. The predicted audience pressure arrived on schedule (#304's table was the forcing exhibit); the answer it got is narrower than the Rust machinery this item feared, and the unknown-type case stays closed.
2. **Method references / bound methods** (`v.at` as a value). Rejected (§11.6); recorded here only because TS users will ask. Reopen condition: none foreseeable; the pipe and lambdas (`x => Vector.at(v, x)`) cover every use.
3. **Companion operations on `Range`/`Seq` inventory** — which exports exist is the stdlib listing's; this spec only guarantees the mechanism reaches them (§4.1).
4. **Monomorphic prelude `show`/`toString`-style companions** (`3.show()` via `Int.show : Int -> String`) — **settled by construction (#304/#335)** (§7): `3.show()` is `Show`'s member at `Int`, and `Int.show` is the member's qualified spelling through the honoring companion (Modules §5.3); a duplicate monomorphic export is the rebinding error in the honoring module and the §6 refusal across modules. Nothing is left for the stdlib listing to decide here.
5. **The three-spellings style question at scale.** §1/§9 fixes the doctrine; whether real codebases fragment anyway is empirical. Watch during dogfooding; the formatter/linter (if one ever exists — there is no warning tier) is *not* the answer; guide pressure is.

---

## 13. Decisions log

| Decision | Where |
|---|---|
| **A dot call's subject is decided by the program's text, or the dot is refused** (October 2026): the head for dispatch, the whole for parts and landing contexts (§3.1); a numeric literal subject takes its default at the dot (§3.3); the refusal names the fundamental spellings and carries no fixit (§3.5); the record spelling `(e.name)(…)` is the row-polymorphic call (§3.6); no goal, deadline, pinning rule, fallback, or held body exists — a dot call is sugar for its module's function, and where the text cannot say which, the writer does | §1, §2.2, §3, §9 row 17, §10, §11.8, §11.10, §16.4 |
| Semantics = one rewrite to companion call; static, erased, no runtime methods/`this`/prototypes | §1, §8 |
| Home-module dot calls obey declaration order — legal exactly where the qualified spelling is; a dot call never targets the caller's own `fun` block | §4.4 |
| Type-directed, not lexical; lexical UFCS rejected with reasons | §1, §11.1 |
| **Member names never nominate nominal types** (doctrine; the anti-overload-search guardrail) | §1, §3.5 |
| Bare `e.name` is field access always; dispatch exists only in the fused call form; `(e.name)()` is the grammar-level opt-out | §2.1, §11.6 |
| ~~Goal created uniformly; receiver-first evaluation order, no temporaries~~ **Superseded** by the first row (§3, §16.4) | §2.2–2.3 |
| ~~Goal owned by the **receiver tyvar's region**; deadline = that region's finalisation boundary, effective even under the value restriction; **pinning rule** keeps goal-entangled tyvars out of inner quantification; per-binding deadline rejected~~ **Superseded** by the first row (§3, §16.4) | §2.2, §3.1, §11.10 |
| ~~Opportunistic resolution on head-known trigger; **monotonicity argument normative**; fallback deadline-only~~ **Superseded** by the first row (§3, §16.4) | §3.2 |
| ~~Deadline is a fixpoint (chains); termination trivial; after the fallback, ordinary inference resumes to stability before generalising~~ **Superseded** by the first row (§3, §16.4) | §3.3 |
| Resolution table by receiver shape; nominal case checks collision first | §3.4 |
| ~~**Row fallback is the form's defined meaning**; never rejects; Tier-0 row polymorphism byte-for-byte preserved; asymmetry is cross-region only, owned with the mandatory post-finalisation diagnostic~~ **Superseded** by the first row (§3, §16.4) | §3.5–3.6 |
| `CompanionOf` = home module (declaration site) / fixed prelude companions; total, search-free, import-insensitive | §4.1–4.2 |
| Operation set = exported ∧ subject-first (unioned with honored subject-first members since #304/#335 — row below); **`T`-headed is syntactic** (outermost constructor after alias expansion; declaration-indexing, no speculative unification); uniform inside/outside home; duplicate claimants refuse, never rank | §4.2 |
| Transparent aliases inherit the expansion's companion; aliases introduce no companion identity; `opaque` collision-free outside home | §4.3 |
| Coverage: nominal records/unions/prelude nominals/primitives/aliases in; declared tyvars in for bound-member dispatch (#304/#335, §16.2); structural records (fields only), tuples (`itemN` only), functions out; a subject the text does not decide refused (§3.5) | §5 |
| Collision: **hard error at use-site**, name-based (non-callable fields collide too), visibility-scoped; **fixits conditional on field callability**; declaration-time ban rejected; evolution fragility recorded eyes-open | §6, §11.4–11.5 |
| ~~Constraint members not dot-callable; companion dispatch cannot be selected through an abstract receiver type; rigid-tyvar redirect; monomorphic `show` exports stdlib-listing's call~~ **Superseded** by the three member-dispatch rows above (#304/#335, §16.2) — the never-nominate and flexible-receiver halves survive in them | §7, §16.2 |
| Emission: dot node dead before lowering; field calls emit as themselves; companion calls emit named-import calls; emitter may add imports; `.d.ts` unchanged | §8.1–8.3 |
| LSP completion driven by the same resolution model — normative | §8.4 |
| Diagnostic noun: "companion operation", never "method"; "row" ban still holds | §9 |
| ~~**Deferred-Goals Doctrine adopted**; DotCall's compliance itemised; hosted here pending Preamble consolidation~~ **Superseded**: a dot call is not a deferred goal; the doctrine and the waiting sequence source's compliance live in the Declarations Preamble §1.2 | §10 |
| Ten rejected alternatives incl. eager resolution, fields-win, bound methods, the field reading of an undecided subject, and waiting for later evidence | §11 |
| `Bool` reclassified out of the Primitive rows to the prelude-nominal path (#147); `CompanionOf(Bool)` = the `Bool` companion module, now also the declaration's home; dispatch outcomes unchanged — classification hygiene, recorded against the #134 lesson | §3.4, §4.1 |
| **Operation set unions honored subject-first members** (#304/#335); membership stays declaration-indexed via coherence; two claimants on one spelling refuse naming homes — no ranking | §4.2, §6, §16.2 |
| **Declared type variables dispatch bound members** (`x.compare(y)` under `a: Ord`); bounds are the entire candidate set; no match refuses, never row-constrains; old blanket refusal reversed | §3.4, §7, §16.2 |
| ~~**Defaulting step precedes the row fallback** at the deadline (`42.show()` is `Show<Int>`'s member); reorders two boundary rules; reclassifies only guaranteed-error programs~~ **Superseded**: a numeric literal subject takes its default at the dot (§3.3) | §3.3, §3.5 |
| **Member-resolved dot calls are evidence routes**: exempt from declaration order and the own-block ban; the sanctioned recursion spelling inside member bodies; no honor-block dot ban exists | §4.4; Constraints §4.6 |
| Member dispatch emits what the bare member call emits; the dot adds no emission shape | §8.1 |
| `Unit` retired from the Primitive rows to the tuple row (#344): the empty tuple (#159) takes the tuple story; no `Unit.hex` exists or ever will | §3.4, §5 |
| Primitive companions become source per companion (#344): each migrated companion is the ordinary nominal case; the fixed migration order (`BigInt.hex`, then `Int.hex`+`Nat.hex`, then `Float.hex`+`String.hex`) is **complete** and no wired instance remains | §3.4, §5; Modules §5.3; Constraints §5.3 |
| ~~Head-known-at-the-dot resolution precedes argument elaboration (#513): the resolved member's signature supplies argument expectations (Functions §4.3); unsolved receivers keep the pending-goal path with synthesized arguments; dispatch outcome unchanged in both moments, §11.3's rejection intact~~ **Superseded** in part: resolution at the dot is the only moment (§2.2); the expectations the resolved signature supplies are unchanged | §2.2, §3.2, §11.3 |
| **A dot call is the receiver's one operation, elaborated as its own spelling would be** (#808): companion export → written subject seat, runs at the receiver's type, argument seats widening as the qualified spelling's do; constraint member → the open call, subject established by operands and (at a tower member) face (Numeric Literals §5.1) — dot, bare, qualified, pipe, and operator spellings of a tower member are one elaboration, save that the dot's receiver closes before the dot resolves (§2.2, #1062); the companion-qualified spelling is a written face | §1, §2.2, §3.4, §7, §16.3 |
| **The receiver is the operation's first operand and takes what that seat expects** (#808, post-review ruling): at a tower member under a face that honors the spelling's rung, the call's expectation reaches the receiver before it elaborates, so a dot chain lifts as an operator chain does; the gate is spelling → rung, a spelling decides that an expectation travels, never what is dispatched; the forwarded face is binding — a receiver that cannot enter it is refused at the dot with the three-fact report (§9 row 16), never dispatched at its own type (#821) | §1, §2.2, §16.3; Numeric Literals §5.1; Functions §4.3 |
| `Nat`/`Int` receivers own the tower members of the rungs they do not honor — the ownership clause, disjoint from the honored set; owned spellings reserved in `Nat.hex`/`Int.hex`; the rungs are closed (Numeric Literals §5.1), so the owned set is finite | §3.4, §4.2, §8.4 |
| Members widen by their operands; doors are addressed by the receiver — a door's argument seats widen into it (`b.pow(i)`, #783 folded), the member's written seat refuses with the door-naming fixit (`i.pow(2n)`) | §6.1, §9 rows 14–15 |
| A member call at a type JavaScript represents by a primitive value (`Int`, `Nat`, `Float`, `BigInt`, `String`, `Bool`) emits what a person would write in JavaScript, in every spelling — the operator spelling's lowering, verbatim, wherever that spelling lowers to a JavaScript operator (Operators §1.1's table read backwards), the seat call otherwise (`pow` at the guarded instances, `Integral`, `compare`); one text per operation across its spellings is the check; a general principle above the tower, stated over representations | §8.1; Constraints §6.1 |
| `JsValue` is an eligible receiver through its fixed prelude companion (#511) — these compiler-provided boundary types tie to companions by rule, the primitive pattern; `Array(a)`'s clause records the eligibility Part 2 §13.1 already reads; `JsMap(k, v)` and `JsSet(a)` joined when their companions shipped (#792); non-absorbed `Nullable(a)` joins through `Nullable.hex` (#786), with absorbed types retaining their ordinary companions | §3.4, §4.1, §5 |

Credit: the rewrite formulation, opportunistic timing, name-based collision rule, nominal-union inclusion, alias clarification, the never-nominate phrasing, and the Deferred-Goals Doctrine originate with Sol's first review; the region correction (with the value-restriction finalisation sentence), conditional collision fixits, syntactic `T`-headed test, post-fallback resumption note, split rigid diagnostics, and the abstract-receiver doctrine sentence originate with Sol's second review. The fixpoint/monotonicity argument, fallback-as-defined-semantics framing, deletion of the fallback pre-check, use-site ruling, the post-finalisation diagnostic obligation, the receiver-level owner (replacing Sol's per-binding formulation), and the pinning rule are this session's.

---

## 14. Acceptance tests

```
-- (a) The three spellings converge
let v: Vector(Int) = Vector.of(1, 2, 3)
Vector.at(v, 2)                    -- OK : Int
v |> Vector.at(2)                  -- OK : Int, same elaboration
v.at(2)                            -- OK : Int, same elaboration

-- (b) Chain: left to right at the dot, no annotations beyond the first subject's
v.map(x => x * 2).take(2).at(1)    -- OK : Int  (each link's subject is the call before
                                   --   it, which the text decides where v is decided)

-- (c) Tier-0 row polymorphism: the record spelling (§3.6)
fun f(r) = (r.callback)(3)         -- OK : {callback: Int -> a, ...} -> a
f({callback = n => n + 1})          -- OK : Int
fun f2(r) = r.callback(3)          -- ERROR (row 17): the text does not decide `r`'s type

-- (d) Evidence from another line never decides a subject, in either order (§3.1)
fun g(v) =
    let x = v.at(3)                  -- ERROR (row 17): `v` has no written type
    Vector.length(v)
    x
fun g2(v) =
    Vector.length(v)
    v.at(3)                          -- ERROR (row 17): the same — the line above is
                                   --   inference, not text
fun g3(v: Vector(a)) = v.at(3)     -- OK — written; or Vector.at(v, 3), the module's spelling

-- (e) Annotated form dispatches; no other evidence needed
fun h(v: Vector(Int)) = v.at(3)    -- OK: Vector.at(v, 3)

-- (f) Member names never nominate
let k(x) = x.at(3)                 -- ERROR (row 17): `at` chooses neither a type nor a module

-- (g) The record spelling's row meeting a nominal: the enriched report (row 8)
fun first(v) = (v.at)(1)           -- OK : {at: Int -> a, ...} -> a, the row type
first(Vector.of(9))                -- ERROR (row 8): this value's type was inferred as a
                                   --   record with a `at` field because its type was
                                   --   unknown where it was written; `Vector(Int)` is
                                   --   not a record. Annotate it to use dispatch, or
                                   --   call `Vector.at(…)` directly

-- (h) Collision, use-site, both fixits
-- box.hex: export record Box = {size: Int}
--          export fun size(b: Box): Int = b.size * 2
let b = Box({size = 3})
b.size                             -- OK : Int      (bare dot = field, always)
(b.size)                           -- OK : Int
b.size()                           -- ERROR (row 1): ambiguous — field `size` /
                                   --   companion `Box.size`. Write `Box.size(b)` to
                                   --   call the companion operation; write `b.size`
                                   --   to access the field.  [field is Int — not
                                   --   callable, so `(b.size)()` is NOT offered (§6)]
Box.size(b)                        -- OK : Int

-- (i) Non-subject-first export is invisible after the dot
v.empty()                          -- ERROR (row 5): `Vector` has no field `empty`;
                                   --   `Vector.empty` does not take a `Vector` as its
                                   --   first argument; call it as `Vector.empty()`

-- (j) Declared type variable with a matching bound member: dispatch
--     [flipped by #304/#335 — was the row-6 redirect; §16.2]
fun cmp<a: Ord>(x: a, y: a) =
    x.compare(y)                     -- OK : Ordering — `compare` dispatched through
                                   --   the binder's `Ord` evidence; same elaboration
                                   --   as the qualified call at that type

-- (j2) Declared type variable, no matching member: the options message
fun go(x: a) =
    x.process()                      -- ERROR (row 7): `a` is a declared type variable,
                                   --   so `.process` can only be one of its
                                   --   constraints' members, and none of `a`'s
                                   --   constraints has a subject-first member
                                   --   `process`; add the constraint to the
                                   --   parameter's binder, use a concrete nominal
                                   --   type, or call a qualified function

-- (j3) The four-row #304 table: member dispatch on primitives
42.show()                          -- OK : "42"  — the literal's default, Int, taken at the
                                   --   dot (§3.3); Show<Int>'s member
(42: Nat).show()                   -- OK : "42"  — head-known Nat, Show<Nat>'s member
42n.show()                         -- OK : "42"  — head-known BigInt, Show<BigInt>'s member
42.0.show()                        -- OK : "42"  — head-known Float, Show<Float>'s member
7.div(2)                           -- OK : 3     — Int at the dot; Integral's member at
                                   --   Int, no companion module involved

-- (j4) Member ambiguity: two honored constraints claim one spelling
-- loud.hex: constraint Loud<a> = volume(x: a) -> Int ;  honor Loud<Gauge> = ...
-- soft.hex: constraint Soft<a> = volume(x: a) -> Int ;  honor Soft<Gauge> = ...
g.volume()                         -- ERROR (row 6): both `Loud`'s member and `Soft`'s
                                   --   member claim `volume` at `Gauge`; write
                                   --   `Loud.volume(g)` or `Soft.volume(g)`

-- (k) Nominal union receiver (no field surface, no collision possible)
let o: Option(Int) = Some(3)
o.defaultValue(0)                     -- OK : Int   (companion: Option.defaultValue)

-- (l) Transparent alias inherits companion
type Name = String
let n: Name = "hex"
n.length()                         -- OK : Int   (String's companion; `Name` adds none)

-- (m) Opaque outside home: pure companion surface
-- point.hex: opaque record Point = {x: Float, y: Float}
--            export fun getX(p: Point): Float = p.x
p.getX()                           -- OK : Float  (outside home; field x invisible,
                                   --   no collision possible)
p.x                                -- ERROR: existing opacity error (Modules §4.2)

-- (n) A literal subject and an unknown name: the refusal is phrased against Int
let n = 7.total(1)                 -- ERROR (row 4): Int at the dot (§3.3), and `total` is
                                   --   no field, companion operation, or honored member
                                   --   of Int
fun m(x) = Num.multiply(x, x.total(1)) -- ERROR (row 17): `x` has no written type

-- (o) Field-resolved dot call emits as itself
fun run(r: {step: Int -> Int, ...}) = r.step(1)
                                   -- emits: r.step(1)   — POJO read, honest JS

-- (p) A member of an open `fun` block: its result is not decided inside the block (§3.1)
fun
    a(n: Int): Bool = if n > 3 then b(n).isEmpty() else a(n + 1)
                                   -- ERROR (row 17), in either member order
    b(n: Int): Vector(Int) = if n > 9 then [n] else (if a(n) then [] else [1])
--  Vector.isEmpty(b(n)) — the module's spelling — is OK

-- (q) Rows connect by ordinary unification through the record spelling (§3.6)
fun w(x) = ((x.make)().run)()      -- OK — make's result row unifies with run's
                                   --   receiver row; w is row-polymorphic

-- (r) Home-module declaration order (§4.4): declared-below is its own error
-- box.hex: export record Box = {value: Int}
--          export let use(b: Box): Int = b.twice()   -- ERROR (row 12): `Box`'s
--                                                    --   companion declares `twice`
--                                                    --   below this call; move it above
--          export let twice(b: Box): Int = b.value * 2
-- Reordered (twice above use): OK — and from any OTHER module, b.twice()
-- is OK regardless of where twice sits in box.hex (§4.2 import-insensitivity).

-- (s) Own-block dispatch ban (§4.4): recursion is spelled by name
-- seq.hex (home of Seq):
-- export fun map(s: Seq(a), f: a -> b): Seq(b) =
--     ... s.map(f) ...                               -- ERROR (row 13): a dot call
--                                                    --   cannot target its own `fun`
--                                                    --   group; spell it map(s, f)

-- (t) Tower members widen through the dot, in every spelling (#808)
--     count : Int, price : Float, i, j : Int, b : BigInt, n, m : Nat
count * price                      -- OK : Float
Num.multiply(count, price)         -- OK : Float
count |> Num.multiply(price)       -- OK : Float — widening and the lift reach through the pipe
count.multiply(price)              -- OK : Float   [was refused: "expected Int, found Float"]
price.multiply(count)              -- OK : Float   [was refused]
Float.multiply(count, price)       -- OK : Float — a written face; the Int widens into it
Int.multiply(count, price)         -- ERROR: a written face; a Float cannot enter Int
let total: Rat = count * price     -- ERROR, in every spelling — a Float never enters Rat
let r: BigInt = i.add(j)           -- OK — emits BigInt(i) + BigInt(j)
                                   --   [was BigInt(add(i, j)): Int addition, then injection]
let s: BigInt = i |> Num.add(j)    -- OK — the same   [was BigInt(add(i, j)) likewise]
let q: BigInt = i.div(j)           -- OK — Integral.div lifted; no operator spells it
                                   --   [was BigInt(div(i, j)): Int division, then injection]
i.add(b)                           -- OK : BigInt — emits BigInt(i) + b   [was refused]
b.add(i)                           -- OK : BigInt — emits b + BigInt(i)   [was refused]
i.compare(b)                       -- OK : Ordering — Ord is no rung; the seat injects i
                                   --   [was refused: "expected Int, found BigInt"]
i.equals(b)                        -- OK : Bool — likewise; emits BigInt(i) === b (§8.1)   [was refused]
let d: Int = n.subtract(m)         -- OK — Nat owns Signed's members (§4.2); runs at Int
                                   --   [was refused: no member `subtract` at Nat]
n.subtract(m)                      -- ERROR (row 15): exactly `n - m`'s refusal — no face
i.pow(2n)                          -- ERROR (row 14): the exponent seat is Int; the fixit
                                   --   names BigInt.pow — as `i ** 2n` and Pow.pow(i, 2n)
b.pow(i)                           -- OK — the door; i injected: pow(b, BigInt(i))   [was refused]
fun scale<a: Signed>(count: Int, value: a): a = count.multiply(value)
                                   -- OK — one Signed<a> dictionary, count injected through
                                   --   fromInt; value.multiply(count) and count * value
                                   --   elaborate identically   [was refused]

-- (u) Every spelling of an operator-backed member at a primitive representation emits
--     the operator's lowering (#808 rider; §8.1) — i, j : Int, f, g : Float, s, t : String,
--     p, q : Bool, r : Rat
i.equals(j)                        -- emits i === j            [was equals(i, j)]
i.notEquals(j)                     -- emits !(i === j)         [was notEquals(i, j)] — the
                                   --   lowering `i != j` has, verbatim; not `!==`
f.equals(g)                        -- emits what `f == g` emits (SameValueZero, helper and all)
p.equals(q)                        -- emits p === q            [was __Eq_Bool.equals(p, q)]
s.concat(t)                        -- emits s + t              [was concat(s, t)]
i.negate()                         -- emits -i                 [was negate(i)]
f.divide(g)                        -- emits f / g              [was divide(f, g)]
Pow.pow(f, i)                      -- emits f ** i             [was pow(f, i)] — the member at
                                   --   Float, total; its `**` lowers natively
f.pow(g)                           -- stays the door's call (§6.1, §14(t)) — a written face with a
                                   --   Float exponent seat; no operator spells it (`f ** g` refuses)
i.pow(j)                           -- emits pow(i, j)          — guarded; `**` is no operator here
i.compare(j)                       -- emits compare(i, j)      — no operator carries compare
r.add(r)                           -- emits add(r, r)          — object representation; untouched
                                   --   (multi-module fixture: `Rat` is imported, not prelude)
-- (v) The receiver seat (#808, ruled after #815's review) — x, y, z : Int with
--     x = 9007199254740991, y = 2, z = 3; i, j, k, negOne : Int, negOne = -1; p, q, s : Foo, a user record
--     honoring Num and Signed whose companion exports gcd(Foo, Foo): BigInt; b1, b2, b3 : Bar and
--     z1, z2, z3 : Baz, user records honoring Num and Signed as Foo does, Bar honoring a user
--     constraint Gcdish<a: Num> with member gcd(a, a): BigInt, Baz carrying a field gcd: (Baz) -> BigInt
let r: BigInt = x.add(y).multiply(z)  -- OK — both operations at BigInt; value-checked past 2^53:
                                   --   27021597764222979n, as (x + y) * z and
                                   --   x.add(y) |> Num.multiply(z) give   [was …976n: inner at Int]
let r: BigInt = (x + y).multiply(z)   -- OK — the same; emits (BigInt(x) + BigInt(y)) * BigInt(z)
let r: BigInt = (x + y).pow(z)        -- OK — the base lifts to BigInt, so the dot addresses the
                                   --   door (§6.1) and z injects: pow(BigInt(x) + BigInt(y), BigInt(z))
let f: Float = (i + j).pow(negOne)    -- OK — Float honors Pow: the base lifts to Float and the dot
                                   --   addresses Float's door; yields the reciprocal, 0.5 for
                                   --   i + j = 2, where Pow<Int> threw   [was NegativeExponentError]
let f: Float = (i + j).rem(k)         -- OK — Float honors no Integral: nothing forwards; i + j runs
                                   --   at Int, Integral<Int>'s guarded rem dispatches, the result
                                   --   widens — as Integral.rem(i + j, k) does
let n: BigInt = p.add(q).gcd(s)       -- ERROR (row 16) — BigInt honors Integral, so BigInt is forwarded
                                   --   and is binding; Foo cannot enter it, the lift stands down, and
                                   --   the dot, resolving to the export, refuses: one report   [was OK]
let n: BigInt = (p.add(q): Foo).gcd(s)
                                   -- OK — the ascription is the boundary; Foo.gcd answers
let n: BigInt = Foo.add(p, q).gcd(s)  -- OK — the companion-qualified spelling is a written face: it
                                   --   lifts nothing, stands down nowhere, and Foo.gcd answers
let n: BigInt = Num.add(p, q).gcd(s)  -- ERROR (row 16) — the constraint-qualified spelling is the open
                                   --   call, no face; one report   [was refused three times]
let n: BigInt = (p + q).gcd(s)        -- ERROR (row 16) — the purest newly refused shape   [was OK]
let n = p.add(q).gcd(s)               -- OK : BigInt — no face, nothing forwards; Foo.gcd answers
let t = p.add(q)
let n: BigInt = t.gcd(s)              -- OK — a binding is the boundary (Numeric Literals §5.1)
let n: BigInt = p.gcd(s)              -- OK — no tower member call: the expectation is no annotation
let n: BigInt = p.add(q).multiply(s)  -- ERROR — the rung's own member: refused at the binding, before
                                   --   this clause and after it; not row 16, no receiver fixit — the
                                   --   ascribed receiver's multiply still yields the Foo the binding refuses
let n: BigInt = i.add(p).gcd(s)       -- ERROR (row 16) — one operand reaches, one does not; one report,
                                   --   naming p   [was refused twice]
let n: BigInt = (i + p).gcd(s)        -- ERROR (row 16) — the operator receiver; the same report   [was OK]
let n: BigInt = (p |> Num.add(q)).gcd(s)
                                   -- ERROR (row 16) — the pipe stage is the bare call; one report
                                   --   [was refused three times]
let n: BigInt = (p + (i + j)).gcd(s)  -- ERROR (row 16) — the nested i + j runs at BigInt, p does not
                                   --   enter it, and the outer addition stands down; one report,
                                   --   naming p, carrying the boundary fixit
let n: BigInt = (p ** i).gcd(s)       -- ERROR (row 16) — the base stands down like any operand; with
                                   --   Foo honoring no Pow, no repair is offered: none would compile
let n: BigInt = (if c then i + j else p).gcd(s)
                                   -- ERROR — not row 16: the face travels into both branches
                                   --   (Functions §4.3), i + j lifts to BigInt, and the else branch p
                                   --   cannot enter it — one report, Operators §11's own at the if,
                                   --   naming p, carrying the boundary fixit; nothing stood down
                                   --   [was refused twice]
let n: BigInt = (if c then p else q).gcd(s)
                                   -- OK — variables in both branches, nothing to lift; Foo.gcd answers
let n: BigInt = (if c then p.add(q) else p).gcd(s)
                                   -- ERROR (row 16) — the then branch is a tower member call the form
                                   --   handed the face to, and it stands down; refused at that call,
                                   --   the fixit ascribing it   [was OK: the branches joined at Foo
                                   --   and Foo.gcd answered — the retracted behaviour]
let n: BigInt = (if c then (p.add(q): Foo) else p).gcd(s)
                                   -- OK — the fixit's repair: the boundary at the stood-down call
let n: BigInt = (if c then p.add(q) else p: Foo).gcd(s)
                                   -- OK — the whole-receiver ascription also repairs here, the
                                   --   receiver's own type being the kept type
let n: BigInt = (if c then
        let z = 1
        p.add(q)
    else p).gcd(s)                    -- ERROR (row 16) — the reach follows a block's final expression   [was OK]
let n: BigInt = (if c then
        let inner = p.add(q)
        inner
    else p).gcd(s)                    -- OK — one line apart: the binding inside the block is the
                                   --   boundary, and its final expression is a variable
let n: BigInt = (if c then p.add(q) else b).gcd(s)
                                   -- ERROR — not row 16: the branches disagree (Foo against b : BigInt),
                                   --   so the if's own report wins and no receiver fixit is offered —
                                   --   the ascription would not compile   [unchanged]
let n: BigInt = (p.add(q) + q).gcd(s)  -- ERROR (row 16) — the face reaches the inner call as an operand;
                                   --   it stands down, the outer runs at Foo, and the outer is the
                                   --   outermost stood-down call   [was OK]
let n: BigInt = (if c then (if c then p.add(q) else p) else q).gcd(s)
                                   -- ERROR (row 16) — the reach follows the nested form   [was OK]
let n: BigInt = (if c then p.add(q).gcd(s) else b).multiply(b)
                                   -- ERROR (row 16) — the reach follows the dot chain's receiver into
                                   --   the branch; p.add(q) stands down under the forwarded BigInt; the
                                   --   fixit ascribes p.add(q) — the receiver's own type is BigInt, so
                                   --   ascribing it whole would send the face back down   [was OK]
let n: BigInt = (try p.add(q)
catch
    JsError(e) => p).gcd(s)             -- ERROR (row 16) — a try body is a forwarding form   [was OK]
let n: BigInt = (i.add(p): Foo).gcd(s)
let n: BigInt = (p + (i + j): Foo).gcd(s)
let n: BigInt = (if c then i + j else p: Foo).gcd(s)
                                   -- OK, all three — the ascription repairs every refused shape above
let n: BigInt = (1 + 2).gcd(s)        -- ERROR — literals reach anything: the receiver lifts to BigInt
                                   --   and Integral<BigInt>'s gcd refuses s; unannotated, the literals
                                   --   take s's Foo and Integral<Foo> is missing — refused either way,
                                   --   and neither is row 16: no lift stood down
let n: BigInt = b1.add(b2).gcd(b3)    -- ERROR (row 16) — Gcdish.gcd, the honored member, is a
                                   --   non-rung claimant exactly as the export is
let n: BigInt = z1.add(z2).gcd(z3)    -- ERROR (row 16) — the field is one too
let n: BigInt = (z1.add(z2): Baz).gcd(z3)
                                   -- OK — (add(z1, z2).gcd)(z3), the field call
fun g(v): BigInt = v.multiply(2)      -- ERROR (row 17): the face decides nothing about `v`
```

---

## 15. Edit notes to companion documents

*(House rule: pending notes live here; applied on next touch of the target.)*

- ~~**declarations-preamble.md** — host the **Deferred-Goals Doctrine** (§10) alongside the Rewrite Rule on consolidation, citing literal defaulting, the waiting sequence source, the projection ban, and DotCall as its instances.~~ *(Applied: the Preamble §1.2 hosts it, with the waiting sequence source's compliance; a dot call is not an instance, §10.)*
- ~~**operators-logic-precedence.md** — §10 (postfix forms): note that `e.name(args…)` with non-uppercase-start `name` creates the DotCall goal of this spec; `(e.name)(args…)` remains two postfix operations. §14 (`.` token): one cross-reference line; token unchanged.~~ *(Applied with the #808 rider: Operators §10's `.` bullet carries both sentences — the token line lives there since the section moved.)*
- ~~**products.md** — §3.2: one line — the fused dot-call form defers via this spec's goal and *means* field access whenever the receiver is not head-known-nominal; Tier-0 inference results are unchanged. §2.3: `itemN` folded into the goal's resolution table with identical behaviour.~~ *(Applied, and restated for §3: Products §3.2 now says the dot is decided from the text or refused, and the record spelling carries Tier-0 row inference.)*
- **modules.md** — §5.3 (companion idiom): note that method syntax makes the idiom load-bearing — `CompanionOf` targets the home module of §7.2. §11: emitter may add named imports for companion-resolved calls at sites that never textually imported the companion.
- **constraints.md** — §2.2: the call-style doctrine now names four spellings (bare, piped, qualified, dot — this spec §7 owns the dot's mechanics); §4.6 hosts the member-binding law the dot's exemptions cite. *(Applied with this amendment.)*
- ~~**loops-ranges-iteration.md** — §7: note the Iterable table is now one instance of the Deferred-Goals Doctrine; behaviour unchanged.~~ *(Superseded: a loop head over a source whose head is not yet known is the waiting sequence source, Collections Part 5 §3.5, which Loops §7.1 states.)*
- **stdlib listing (on creation)** — inherits: (i) the subject-first convention now also determines dot-callability (§4.2); (ii) ~~decide the monomorphic per-type `show`-style companion exports question~~ *settled by construction (§7, §12.4, #304/#335)*; (iii) companion inventories for `Range`, `Seq`, primitives — member spellings excluded, they are the constraints' own (§4.2).
- **hexagon-for-typescript-coders.md** — new chapter after Pipes: dot calls as "the method syntax you expected, without the objects" — teach the rewrite, the three-spellings doctrine for companion operations (§1/§9 wording) and the member four-spellings beside it (§7's closing sentence), the subject the text decides with examples §14(d)/(e), the refusal and its three fundamental spellings (§3.5), the record spelling (§3.6, §14(c)), and member dispatch per §7: the dot works on subjects the text decides and on bounded variables. *(Clause updated with #304/#335, and again for §3 — discharging an older version of the note would ship a reversed rule.)* Permitted guide phrasing (Sol): *"Hexagon's method syntax provides a UFCS-like surface, but uses type-directed companion lookup rather than lexical UFCS"* — the spec's flat "this is not UFCS" stays in the spec. Parallel examples must mirror pipe-chapter conventions.
- **spec-roadmap.md / collections specs (Parts 3–5, on next touch)** — collection operation examples may add the dot spelling beside qualified/pipe forms where it aids the reader; the qualified form remains the canonical citation form in specs.

---

## 16. Correction and reversal records

Recorded per house rule: defect origin, rationale, rejected alternative marked do-not-relitigate. Each correction is applied **in place** above and the touched sections are marked — §16.2 (August 2026): §1, §3.3–§3.5, §4.2, §4.4, §5, §6, §7, §8, §9, §11.7, §12.1/§12.4, tests §14(j)–(j4)/(n); §16.3 (September 2026): §1, §2.2, §3.4, §4.2, §6.1, §7, §8.1, §8.4, §9 rows 4/14/15, §11.3 (note), §13, tests §14(t)/(u)/(v).

### 16.2 Reversal record (August 2026, #304/#335): constraint members join the dot

- **What changed:** §7's total exclusion of constraint members from dot syntax is reversed for two receiver classes — head-known types (dispatch through the honored instance, §3.4/§4.2) and declared type variables (dispatch through the written bounds, §3.4). Flexible receivers are untouched: defaulting step, then fallback; no instance is ever consulted to *identify* a receiver. *(Since §16.4 there is no fallback: a subject the text does not decide is refused.)* §9 row 6's redirect died with the flip (its case now compiles); §12.1 and §12.4 closed; §11.7 is reversed in part and annotated in place.
- **Why the original rejection was right when made:** in July 2026 a constraint member had no term-position identity — no declaring module, no export status, no qualified home. Any dot dispatch to one would have been a name-keyed search of the instance tables: extension-trait machinery, exactly as §11.7 said. The rejection's stated bar (§12.1: no global search, no import-sensitivity) was unmeetable *by a dispatch scheme* because the deficiency was in what members were, not in how dispatch might find them.
- **What changed the ground:** the members-as-values ruling (#335; Constraints §2.2/§4.6, `spec/notes/constraint-members-are-values.md`). Members are exports of their declaring modules; instances are coherence-keyed program-wide; honored spellings are claimed against rebinding. Dispatch is now a lookup in tables that already exist for other reasons, and the §10 doctrine test passes where it could not before.
- **The forcing exhibit:** the own-name refusal (Constraints §4.6, #293's non-`fun` law applied to members) removes the unqualified spelling inside a member's own body, and its ruled rewrite is the dot call. In a *parameterized* instance the recursive position has the declared variable's type — `box.value.show()` inside `honor<a: Show> Show<Box(a)>`. For a prelude constraint the declaring-module spelling (`Show.show(box.value)`) survives as a fallback, evidence-selected; the forcing case is the **conjunction**: a parameterized instance of a constraint *declared in the honoring module itself* — `constraint Describe` and `honor<a: Describe> Describe<Tree(a)>` in one file — where no qualified spelling exists at all (a module cannot name itself). Without bound-member dispatch the refusal would leave that recursion with no spelling. The bounds row is therefore not ergonomic sugar; it is what makes the refusal's sanctioned forms total. (Ruled on exactly this exhibit — #304.)
- **What §11.7 still rejects, permanently:** dispatch that *discovers* a receiver's type from a member name (never-nominate, §1), dispatch on a subject the text does not decide (§3), and any import-sensitive member set. The slippery slope was real; the fence moved to where the slope actually starts.

### 16.3 Amendment record (September 2026, #808): the dot on a tower member is the open member call

- **What changed:** §3.4's nominal and primitive rows no longer pre-select the `C<T>` instance at the receiver: a member-resolved dot call is the member's open call with the receiver in the subject seat, its subject established by operands (any member) and by the written face (a tower member, through the lift — Numeric Literals §5.1, which now fixes the tower as a closed list and extends the expected-type lift to every spelling of a tower member call). §1 states the one-operation sentence; §2.2 the entry moment and the inherited ordering pin; §4.2 gains the ownership clause; §6.1 the member/door principle; §8.1 the primitive-instance emission rule; §9 rows 14–15. #783 is folded in on both halves: the door's argument seat by §6.1, and the plain companion export's (`b.bump(p)` at a written `BigInt` seat, which #783 showed refusing where the qualified spelling widened) by §3.4's rewrite sentence, which always required the rewritten call to widen as the qualified one does and now says so.
- **The defect, measured** before the amendment (`i, j : Int`, `b : BigInt`; issue #808's table, re-measured at this record's base): `i + b` and `Num.add(i, b)` widened; `i.add(b)` and `b.add(i)` refused "type mismatch". `let r: BigInt = i + j` ran at `BigInt`; the same binding spelled `Num.add(i, j)`, `i |> Num.add(j)`, or `i.add(j)` ran at `Int` and injected the finished sum — the silent overflow Numeric Literals §5.1 exists to prevent, reachable through three spellings the lift did not govern.
- **Origin:** the nominal row's "with the `C<T>` instance selected by coherence" read the dot as the *pinned* companion spelling `Int.add(i, b)`, a written face; but the dot writes no face — it names an operation, and a member's operation runs where its operands establish it. The row was right wherever the receiver's type was the only subject in question — every single-operand member, every same-typed call — and wrong wherever another operand or a written face establishes a wider subject: the tower members under the lift, and `Eq`/`Ord`'s members across widths, `i.compare(b)` refusing where `Ord.compare(i, b)` widened.
- **The ruling** (#808): numeric widening is the canonical interpretation of a tower member call, whatever its spelling; the receiver decides *what*, the operation decides *where it runs*. The companion-qualified spelling is excluded as a written face, on Modules §5.3's migration principle. The tower's rungs are the language's own, a closed list — a type joins by honoring them, never by adding one — which is what keeps the ownership clause finite and makes any collision at the source types the author's own honoring. Emission was ruled as JavaScript text only: where a person would write an operator, the compiler writes an operator (§8.1) — and, on the follow-up question whether `Eq`'s members at primitives take the same rule, ruled general: it is a principle for every JavaScript operator the compiler produces, above the numeric tower (Constraints §6.1).
- **The receiver seat, measured and ruled** (after #815's review): `let r: BigInt = a.add(b).multiply(c)` with `a = 9007199254740991, b = 2, c = 3` gave `27021597764222976n` where `(a + b) * c`, `Num.multiply(a.add(b), c)`, and the pipe gave `27021597764222979n` — the receiver elaborated at `Int` before the member was known. Ruled: the receiver is the operation's first operand and takes what that seat expects (§2.2's receiver rule), gated on spelling → rung with the face honoring the rung; the forwarded face is binding (the receiver stand-down that first shipped with the rule is retracted in the next record). One behaviour the rule changes on purpose: `let f: Float = (i + j).pow(k)` with a negative `k` threw `Pow<Int>`'s guard and now yields the reciprocal at `Float`'s door, the dot converging on `let x: Float = 2 ** negOne` (§14(v)). Rejected: re-elaborating the receiver once the member is known (needs unification undo Algorithm J does not have); accepting the asymmetry (one spelling keeps the silent overflow); refusing the shape (refuses a program every type admits); and the rule's first form, a gate on the spelling alone, which #818's review showed re-dispatching `(i + j).rem(k)` under a `Float` face to `Float.hex`'s exported `rem` and refusing `p.add(q).gcd(s)` at a user companion export — a spelling stands in for the operation only through its rung.
- **The receiver stand-down, retracted** (#821). The rule first shipped let a receiver that could not enter the forwarded face keep its own type and dispatch there, so `let n: BigInt = p.add(q).gcd(s)` at a user companion export compiled. Measured at that implementation, the same shape refused whenever the receiver had a mixed operand (`i.add(p).gcd(s)`), a nested operation (`(p + (i + j)).gcd(s)`), a forwarding form (`(if c then i + j else p).gcd(s)`), or a pipe stage (`(p |> Num.add(q)).gcd(s)`, three reports) — while `(p + q).gcd(s)` compiled where `Num.add(p, q).gcd(s)`, the same operation under the same face at the same claimant, reported three times, the member spelling binding its subject before its operands were in: the lift descends eagerly and decides its stand-down after the operands are in, which is invisible in every verdict *while a stand-down always refuses* (Numeric Literals §5.1: a home is never given up for another) and becomes meaning the moment one can succeed. Deciding those shapes as the `let`-bound control does needs the receiver's type with no face before it elaborates with the face — infer twice, speculate and roll back, or carry every tower operation's home as a pending obligation solved at the receiver — and the first two are the re-elaboration the record above rejects (a "side-effect-free own-type pre-pass" is the first in another coat: it must duplicate widening, forwarding-form joins, provisional subjects, dispatch, and defaulting), while the third leaves eager elaboration for a cost nothing planned justifies. Ruled instead: the forwarded face is binding at every tower member call it reaches — the receiver's own, or one a forwarding form hands it to (§2.2); every stand-down ends in refusal, the theorem without exception; the refusal is one report of three facts (§9 row 16). Price, stated plainly: a non-rung claimant bearing a rung spelling — a companion export, an honored member of a user constraint, or a function-typed field — at a tower-expression receiver that cannot enter the face is refused inline under its true annotation, and accepted with the ascription, through a binding, or unannotated (§14(v)). **Rejected:** withholding the face from the receiver altogether, which leaves the silent overflow in the dot chain's receiver — the one spelling the rule exists to close; refusing every `Nat`/`Int`-typed tower receiver under a wider face, which refuses the common shape to protect the rare one; and a syntactic leaf gate that withholds the face when a written-typed part of the receiver cannot reach it — declined because a walker that answers what the receiver would be without the face, from its leaves, is the own-type question again and the first step back onto the re-elaboration path. **Declined for its cost, not rejected on principle:** carrying every tower operation's home as a pending obligation solved at the receiver boundary, with conversions, evidence, door dispatch, and diagnostics materialised after the solve — the one route that would remove the refused class, a departure from eager elaboration that nothing planned needs; it stays available should such a need arrive, and it, not a probe, is what any future reopening must cost out.
- **Rejected alternative (do not relitigate):** widening the dot's *argument* seat alone, leaving the receiver pinned (#783's first reading). It repairs `b.add(i)` and leaves `i.add(b)`, `i.compare(b)`, and the lift untouched — three spellings of one member still disagreeing. Also rejected: an open tower, where any user constraint bounded on `Num` joins the rungs and its members are owned at `Nat`/`Int` — a user member spelled `add`, declared anywhere in the program and honored nowhere, would then make `i.add(j)` a two-claimant refusal for every module. (An author who *honors* such a constraint at `Int` takes that collision under §6 today, closed tower or open; closure keeps the collision the author's own declaration.)

### 16.4 Amendment record (October 2026): a dot call's subject is decided by the text, or the dot is refused

- **What changed:** §3 is replaced. A dot call no longer waits: it is decided at the dot, from what the program's text says about its subject's type (§3.1) — an untyped lambda parameter's only under a written type or in a named function's call — and refused where the text does not decide it (§3.5, §9 row 17). The goal, its owner region and deadline, the pinning rule, the opportunistic trigger, the deadline fixpoint, the defaulting step, and the row fallback are gone; a numeric literal subject takes its default at the dot (§3.3); the record spelling `(e.name)(…)` is the row-polymorphic call (§3.6), and §9 row 8's enriched report now serves the rows it imposes. Touched: §1, §2.1, §2.2, §3, §4.4, §5, §7, §8.4, §9 rows 8 and 17, §10, §11.3, §11.7, §11.8, §11.10, §13, §14(b)–(g)/(j3)/(n)/(p)/(q)/(v), §15. The earlier goal-ownership correction record (July 2026) is withdrawn with its subject. Outside this spec: Effects §3.2 and §3.4 (a waiting dot call is no longer a colour that waits, and no body is held for one), Collections Part 5 §3.5 (the waiting source's owner and deadline are stated there), Products §3.2, Numeric Literals §4's ordering note, Functions §4.3's decline paths, Operators §10, and the Declarations Preamble §1.2, which now itemises the waiting sequence source's compliance.
- **Why:** a dot call is sugar for its module's function. Waiting for evidence kept line order out of dispatch, at a cost the language paid elsewhere — bodies held for a waiting call settled colours at the wrong moment (#1173), a goal the deadline never reached left a clean compile calling `undefined` (#1182), and the fallback gave one spelling two meanings. Where sugar cannot decide, the writer spells the fundamental: the type, or the module.
- **Rejected:** the field reading of an undecided subject at the dot (§11.8): order-free, but it kept the two meanings and the far report; deciding from what inference knows at the dot (§11.3), which follows line order; and deciding a lambda's parameter wherever an expectation reaches it, channel by channel — a pipe's left operand, a constructor's position, an assignment's target — since each channel a rule leaves unread lets a later line choose.
