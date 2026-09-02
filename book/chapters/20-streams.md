# Streams

A `Seq` can promise that observing an element changes nothing because every element is
computed. Some element producers cannot make that promise. A random generator answers
differently each time it is asked. User input arrives once. A clock never gives the same
reading twice. `Stream(a)` is the sequence type for exactly these producers: elements
arrive one at a time, and asking for one is an action in the world, not a calculation.

`Seq` and `Stream` are siblings, not modes of one type. Choosing between them is
declaring whether the elements are computed or drawn.

`Stream` is the standard library's first type whose every use is spelled with the
effect marks of the previous chapter, and it is where those marks earn their keep. All
three arrows appear in this chapter doing their jobs: `->` on the pure operations that
build a stream, `->!` on every consumer that pulls, and `->?` on the callback slots that
let the caller decide.

## The protocol: no tail

The fundamental operation looks almost like `Seq.next`, and the difference is the whole
type:

```text
Seq.next    : Seq(a)    ->  Option((a, Seq(a)))
Stream.next : Stream(a) ->! Option(a)
```

`Seq.next` returns the element *and the rest of the sequence*, because a pure sequence
can hand out its own future as a value. A stream cannot — its next element does not
exist until the world is asked — so `Stream.next` returns only the element, and the
stream advances. A pull is spent. There is no going back to a stream position, because
a stream position is not a value.

`Some(value)` is the next element; `None` means the stream is exhausted, and stays
`None` on every later pull.

## Feeding a stream from pure data

Streams normally enter a program from the world — the standard library's ambient
sources and the JavaScript boundary both arrive in later contexts. But any pure
sequence can be driven as a stream, and this is how stream code is exercised without
touching the world at all — here over `Seq.iterate`, the standard library's
step-by-step producer (`1`, then `n * 2` of each element, without end):

```hexagon
let script: Stream(Int) = Stream.fromSeq(Seq.iterate(1, n => n * 2))
```

`fromSeq` wraps the sequence with a cursor: each pull takes one step and remembers
where it stopped. Building the stream touches nothing — the call is bare — but pulling
from it is a real effect: the cursor advances, and a second pull cannot observe what
the first one saw.

This injection is more than a convenience. A function written against `Stream(a)`
accepts a scripted stand-in as readily as a live source, which is how stream-consuming
code is tested: replace the clock with `Stream.fromSeq(Seq.iterate(t0, tick))` and the test is
deterministic.

## Consuming a stream

Consumption is where pulls happen, so every consumer wears `->!` and every consumption
is spelled with `!`:

```hexagon
let firstTen = Stream.collect!(script, 10)
```

`collect` pulls at most `count` elements into a `Vector(a)` — fewer if the stream ends
first. The result is **the frozen sample**: ordinary pure data, the stream's one bridge
back into the pure world. Everything downstream of a `collect!` is ordinary Hexagon.

`fold` aggregates, and its signature is worth reading closely because all three arrows
appear in it:

```text
Stream.fold : (Stream(a), b, (b, a) ->? b) ->! b
```

The outer arrow is `->!`: folding pulls, unconditionally. The callback's arrow is `->?`:
pass a pure combiner or an impure one — the fold is exactly as effectful as its pulls
plus whatever the callback adds. That callback is also the inlet that makes the `->?`
legal here, which is the shape the previous chapter described. A pure combiner is the
common case:

```hexagon
let total = Stream.fold!(script, 0, (sum, value) => sum + value)
```

`find` pulls until an element matches and returns `Some` of it, or `None` at
exhaustion. `forEach` runs an action for every element. Both `fold` and `forEach` drive
the stream to exhaustion, so neither returns when the source never ends — an ambient
source like a clock has no `None`. `find` stops at the first match, which makes it the
safe consumer on a source that contains one.

Manual consumption is a `while` loop around `next!`:

```hexagon
let sumFirstNegative(readings: Stream(Int)): Int =
    var found = 0
    var searching = True
    while searching
        match Stream.next!(readings)
            Some(value) =>
                if value < 0 then
                    found := value
                    searching := False
                else
                    ()
            None => searching := False
    found
```

The loop body is a block, so it marks its own calls — the `!` on `next` is the loop's
honest record that each iteration spends a pull.

There is no `for value in stream`. A `for` head promises pure iteration, and a stream
cannot keep that promise; consumption is the consumers above or the `while` idiom.

## Transforming without pulling

`map` and `filter` exist for streams, and building one is not an effect:

```hexagon
let doubled = Stream.map(script, n => n * 2)
```

The call is bare. Evaluating `Stream.map` builds a derived stream and pulls nothing;
the effect happens later, at whatever `!`-marked consumption drives the result. A
derived stream shares its source's cursor — pulling `doubled` advances `script` —
because there is no independence to promise and none is promised.

There is no `take` or `drop`, and the absence is the design speaking: a transformer
that counts needs memory that survives between pulls, which is exactly the statefulness
Hexagon closures refuse. Bounded consumption is what `collect!` is for.

## No replay, on purpose

`Seq` has `memoize`; `Stream` has nothing of the kind — no `Stream.memoize`, no
`Stream.toSeq`, no way to replay a pull. This is not a missing feature. Replay would
promise that a drawn element can be observed again, and for entropy, input, or time
that promise is a lie. A sample exists only where the program `collect!`ed it into data
on purpose.

The two honest bridges are the ones this chapter has already used: `fromSeq` carries
pure data into the stream world, and `collect!` carries a bounded sample back out.

## Choosing between `Seq` and `Stream`

| Question | `Seq(a)` | `Stream(a)` |
| --- | --- | --- |
| Where do elements come from? | computed | drawn from the world |
| Does observing change anything? | never | always — a pull is spent |
| Can a position be revisited? | yes, positions are values | no |
| Effect spelling | marks only when an effectful callback reaches a strict consumer | `!` at every consumption |

The choice shows up concretely with randomness: a seeded generator is deterministic
computation, so it is a `Seq` — same seed, same elements, replayable. Entropy is a
`Stream` — each draw is spent. A frozen sample of either is a `Vector`.

At the JavaScript boundary the same choice appears as a declared position: a foreign
iterator crossing as `Stream(a)` crosses raw — JavaScript's stateful `next()` protocol
*is* the tailless pull — while crossing as `Seq(a)` makes Hexagon manufacture purity by
remembering. That choice belongs to the boundary chapters.

## Summary

- `Stream(a)` is the effectful pull sequence — `Seq`'s sibling for elements that are
  drawn, not computed;
- calling an effectful function requires the glued `!` mark, and silence means pure;
- `Stream.next` returns `Option(a)` with no tail: a pull is spent and positions are
  not values;
- `fromSeq` drives pure data as a stream, which is also the testing idiom for
  stream-consuming code;
- consumers — `collect`, `fold`, `forEach`, `find`, `next` — wear `->!` and their
  calls wear `!`; `collect!` produces the frozen sample that re-enters the pure world;
- `map` and `filter` build derived streams without pulling, sharing the source's
  cursor; and
- there is no `for` over a stream, no `take`/`drop`, and no replay of any kind — each
  refusal is the type telling the truth.

A stream can end, and `None` says so honestly. What streams do not model is failure —
a pull that goes *wrong* rather than running dry. The next chapter separates
predictable failure, which belongs in `Result`, from exceptional control flow that may
cross module and JavaScript boundaries.
