# Effects

Every function this book has written so far has been a calculation. Give it the same
arguments and it gives back the same answer, and running it changes nothing you could
afterwards observe. That property is what has made the earlier chapters' reasoning
work: a `Seq` transformation can run its callback any number of times because nobody
can count; a `let` binding can be read twice because reading is free.

Real programs eventually stop calculating. They print, they read a file, they ask a
clock what time it is, they draw a random number. Hexagon calls exactly that —
**observable interaction with the world** — an *effect*, and it tracks it in the type
system.

The tracking is not a warning tier or a lint. Effects are part of a function's type,
and the compiler checks them in both directions.

## Silence means pure

The governing convention is the one the book has been relying on without saying so:

> **Silence means pure.**

A function type written with the plain arrow performs no observable effect at any
instantiation:

```text
firstOrZero : Seq(Int) -> Int
```

That is a promise, not a default. A `->` face over a body that touches the world is a
compile error, so the plain arrow you have read in every earlier chapter has been
carrying a real guarantee the whole time.

Two marks spell the two ways a function can fail to be pure. Both ride the arrow:

```text
->     pure: this function touches nothing the world can observe
->?    the caller decides: as effectful as whatever is passed in
->!    impure: this function performs effects, unconditionally
```

Read them as one arrow with a mark on it, not as three unrelated symbols. Which mark is
the only question, and the marks are the same two characters you are about to meet at
call sites.

## What counts, and what does not

The lattice has exactly two points — pure and impure. Hexagon never asks *which* effect,
only whether the world notices. There is no `IO` versus `State` versus `Console`; a
design that wants that distinction is a different language.

Several things that look like effects are deliberately not:

- **Allocation is not an effect.** Building a record, a `Vector`, a closure — the world
  cannot see it.
- **A `var` inside a function body is not an effect.** It cannot escape, because a
  lambda cannot touch an outer `var` (Chapter 16). Local mutation is private
  bookkeeping, and privacy is exactly what makes it invisible.
- **Throwing is not an effect.** An exception is failure, not interaction — Hexagon
  keeps the two channels separate, and Chapter 21 is about the other one. If throwing
  were an effect, `Int.div` would be impure and the whole prelude would go with it.

What *is* an effect: reading input, writing output, consulting a clock or an entropy
source, mutating foreign state. The rule of thumb is a question about observation —
*can anything outside this call tell that it ran?*

## The mark at the call

The half of the discipline you see most is at call sites. Every call wears exactly one
of three states, and the mark is written **glued** between the callee and its argument
list:

```hexagon
firstOrZero(readings)          // bare: this call is pure
save!(document)                // this call performs effects
combine?(total, value)         // as effectful as my caller makes it
```

The marks answer the same question the arrows do, about the same thing: `save!(…)` says
precisely that `save`'s outer arrow is `->!` here. Learn the alphabet once and it reads
the same in a signature and at a call.

Enforcement is symmetric and it is an error in every direction. Omitting a required mark
is an error; writing `!` on a provably pure call is also an error:

```hexagon
let clean = trim!(document)
```

> this call is pure, so `trim` wants no mark, not `!`

That symmetry is the whole point. A mark that were merely tolerated would rot into
noise, and then silence would stop meaning anything. Because the marks are exact,
reading an unfamiliar function tells you something real: **the bare calls are the ones
that cannot matter to the outside world.**

The teaching model is a pipe. Every call is clean, dirty, or conducting, and the
question at each one is *am I a source, or just a conduit?*

## `->?` — letting the caller decide

A higher-order function usually has no business deciding whether it is effectful. Its
callback decides. That is what the middle arrow is for:

```text
Seq.fold : (Seq(a), b, (b, a) ->? b) ->? b
```

Both `->?` in that signature are **the same effect variable** — one per signature,
always. `fold` is as effectful as the callback makes it: pass a pure combiner and the
whole call is pure and bare; pass an impure one and the call is impure and wears `!`.
The signature never claims "impure". It says *as impure as you make it*.

Inside such a body, the call on the handed-in function conducts:

```hexagon
export fun runAll(source: Seq(a), action: a ->? Unit): Unit =
    match Seq.next(source)
        Some((value, rest)) =>
            action?(value)
            runAll?(rest, action)
        None => ()
```

The `?` on `action` is the honest record: this line runs effects exactly when the caller
supplied something that does. Read `?` as *this line defers to my caller*.

The recursive call wears `?` for the same reason — `runAll` is exactly as effectful as
its own `action`, so a call to it inside its own body conducts like any other.

A function that performs effects on its own account does not get to hide behind `->?`.
Its own arrow rounds up to the constant, while the callback it forwards keeps its
variable:

```text
withTransaction : (String ->? String) ->! String
```

Every call to `withTransaction` wears `!`, because it writes whatever the callback does.
But a *pure* callback is still accepted, and stays pure in the caller's accounting.
Rounding that inner arrow up too would refuse pure callbacks outright — purity-as-
polymorphism works through variables, and `->!` is not one.

### `->?` needs something to link to

`->?` means *my caller chooses*, so it is only legal where there is a caller who can:
inside a function signature, where at least one `->?` sits in something a caller
supplies — a parameter, at any depth, including a parameter of a function the
signature returns. That occurrence is the slot the choice arrives through.

Where there is no such slot, `->?` is not quietly re-read as something else — it is
refused:

```hexagon
export record Source = { step: () ->? String }
```

> `->?` is the caller's colour, and this position has no caller to choose it — a
> `record` field is data, not a signature; write `->!` for a function that pulls the
> world, or `->` for one that does not

A record declaration has no signature to quantify over, so there is no variable for the
arrow to name. The same refusal covers a `union` field and a `type` alias body. The fix
is almost always `->!`: a field that pulls the world says so.

The identical text in a *parameter annotation* is a different matter, because there it
is part of a signature:

```hexagon
export let drive(source: { step: () ->? String }): String = (source.step)?()
```

Here the arrow links, and it is its own inlet. Position decides whether `->?` is legal —
never what it means.

## Where marks cannot go

Four call forms have no room for a mark, by grammar: operators (`x + y`), indexing
(`xs[i]`), `for` heads, and string interpolation. Operators, `for` heads, and
interpolation each dispatch to a constraint member; `xs[i]` is the companion operation
`at`, definitionally.

The consequence is a rule worth remembering: **everything those forms reach must be
pure.** Every member of every constraint — `show`, `compare`, `hash`, `add`, `toSeq` —
has pure arrows, and an `honor` instance's bodies must check pure; `at` wears a pure
face the same way. A type whose traversal performs effects therefore cannot honor
`Iterable`, and cannot stand in a `for` head at all.

Loop *bodies* are a different matter. A `for` head is protocol and is pure; the body is
an ordinary block, and its statements mark their own calls as usual.

## Where effects come from

If the prelude is pure and constraint members are pure, effects have to enter somewhere.
They enter at the JavaScript boundary, and the default there is honest about what it does
not know:

```hexagon
extern from "./world.js"
    export fun readLine(): String
    export fun save(document: String): Unit
    export pure fun trim(document: String): String
```

A user-written `extern fun` is **effectful by default** — its arrows are `->!` and every
call wears `!`. Foreign code is trust territory, and the honest default for the unknown
is that the world notices.

`pure` is the trusted claim that says otherwise. It is believed, not checked, and the
module author answers for it. Claiming `pure` on something that touches the world is
simply a lie, with two narrow exceptions the specification names: a write-only channel
the program cannot read back (a debug probe), and a read the runtime performs at most
once and then owns.

There is a second claim in the same slot, for the shape `pure` cannot describe. A foreign
function that *runs* the callback you hand it is exactly as effectful as that callback —
`Array.prototype.forEach` is the everyday example. `pure` would be a lie about it, and the
default charges a `!` even when the callback you supply is pure. `conduit` says the honest
thing instead:

```hexagon
extern from "./world.js"
    export conduit fun each(step: (String) ->? Unit): Unit
```

`each`'s face is `(String ->? Unit) ->? Unit` — one colour, worn by the callback and by
`each` itself. Hand it a pure step and the call is bare; hand it one that saves, and the
call wears `!`. Nothing new happens at the call site: that is the linked arrow you already
know, declared rather than inferred, because a declaration header has no outer arrow to
write it on. Like `pure`, it is believed rather than checked.

That is the whole story of how a pure corpus stays pure. Nothing in the standard library
manufactures an effect; effects arrive through declared doors.

### The debug probe

The first of those two exceptions is a function you have been calling since Chapter 1.
`Debug.log` is ordinary Hexagon, declared in the standard library's `Debug.hex`; like the rest
of the prelude it needs no import, and the qualifier is the spelling — `log` alone is a
word the language leaves to you. It writes to the debugging console, which is a channel
no Hexagon expression can read back — and that unreadability is the entire reason its
face may be `->`, and the reason every `Debug.log(…)` call in this book has been bare.

It takes any value that honors `Show`, rendering it exactly as interpolation would. Its
companion `Debug.trace` writes `label: value` and then hands the value straight back, so a step
can be watched without taking the surrounding expression apart:

```hexagon
Debug.log("Preparing order")            // a String is written as itself
Debug.log(order.total)                  // any showable value, rendered by its own `Show`

let scaled = 2 * Debug.trace("subtotal", subtotal)
```

With `subtotal` at 120, the last line writes `subtotal: 120` and computes 240. A value
with no `Show` — a function, say — is refused at compile time, where the host would
cheerfully have printed something: this is Hexagon's version of `console.log`, not
`console.log` precisely.

The pure face has a price, and the price is the accounting of Chapter 18. Because a probe
is pure it may sit anywhere a calculation may, a lazy producer's step included, and there
it writes when that step runs. Chapter 18 said that a callback which printed would turn
*how many times does this run?* into a question about observable behaviour; a probe is
admitted there anyway, because nothing in the program can observe its writing — but the
question keeps a calculator's answers, and the writing follows them rather than
overriding them.

Fold a three-element probed sequence twice and the probe writes six lines; put
`Seq.memoize` in front of it and the second traversal writes nothing; demand no elements
and it writes nothing at all. That is fine for a probe and disqualifying for a log.
Output that must appear a known number of times in a known order is the other job this
chapter has already taught: an extern that wears `!`.

## Colours are a compile-time story

Arrows and marks erase completely. The emitted JavaScript is identical with and without
them, and no runtime representation of an effect colour exists. This is a discipline for
the checker and the reader, and it costs nothing at run time.

One coupling is worth naming, because it is what makes a pure face a *fact* rather than
a convention: a lambda cannot capture an outer `var`, and Hexagon has no reference cells
or mutable fields. There is no back door for a pure-faced closure to smuggle state
through. The guarantee holds because the language elsewhere refuses to offer the
loophole.

## Summary

- an effect is **observable interaction with the world**; allocation, a local `var`, and
  throwing are all deliberately not effects;
- the lattice has two points, pure and impure — Hexagon asks whether the world notices,
  never which effect;
- one arrow carries three marks: `->` pure, `->?` the caller's choice, `->!`
  unconditionally impure, and calls wear the same marks — bare, `?`, `!`;
- silence means pure, and enforcement is symmetric: a missing mark and a spurious one
  are both errors, which is what keeps silence meaningful;
- `->?` denotes one effect variable per signature and is legal only where a parameter
  offers the caller a slot; elsewhere it is refused rather than re-read;
- operators, indexing, `for` heads, and interpolation have no seat for a mark, so
  everything they dispatch to is pure — constraint members included; and
- effects enter through user-written externs, which are impure by default and may claim
  either `pure` — it never touches the world — or `conduit` — it is exactly as effectful
  as the callbacks it is handed — as trusted, unchecked promises; and
- the standard library's own exception is the debug probe — `Debug.log` and `Debug.trace`, from
  `Debug.hex` — pure-faced because the console cannot be read back, and therefore
  indifferent to how many times it runs; counted, ordered output belongs behind a `!`.

Effects explain why `Seq` can promise so much: its producers and combinators are pure by
construction, so a lazy pipeline can run a callback any number of times without anyone
being able to count. Some producers cannot make that promise. The next chapter
introduces `Stream`, `Seq`'s sibling for elements that are drawn from the world rather
than computed — and the arrows in this chapter are what keep the difference visible.
