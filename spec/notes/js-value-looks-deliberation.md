# Looking inside a foreign value once: the deliberation record

**Status:** Notes, not normative. The write-up James ruled on for #1447, 2026-11-03, kept verbatim as it stood at the ruling. The decided text is Exceptions §7.1 and §7.4, FFI Part 11 §1, §3, §4.2 and §7, Effects §6.2 and FFI Part 3 §7.4 and §7.5. During the deliberation it was the file `HOSTILE-READS-1447.md`.

---

## #1447: pure functions that read a foreign value twice

**Status:** Ruled (1A) and (2A) by James on 2026-11-03: a `catch` reads a thrown value's brand through Part 11 §7's kept read, and Hexagon keeps what it first saw inside a `JsValue`. His words: "Knowing that `toArray` doesn't change after first read, is kind of Hexagon's culture." Updated the same day for the decoders ruling (see "Since the decoders ruling").

### The short answer

- **Today, three pure functions can give two answers for one argument.** Each reads inside a JavaScript object again on every call, and foreign code can change what it finds there:
  - a `catch` checking whether a thrown value is a Hexagon error;
  - `JsValue.toArray`;
  - `JsValue.kind`, in one corner. The review didn't report this one; I found it while checking.
- **Hexagon already has the fix, in the same spec.** FFI Part 11 §7 reads each property of a thrown value once and keeps the answer, so `JsError.message` can't change its mind. I recommend one rule for every place Hexagon looks inside a foreign object: **look once, and keep what you saw.**
- **For the `catch`, that costs little and changes nothing for ordinary programs.**
- **For `toArray`, it's a real trade.** Suppose JavaScript changes an array after Hexagon first decodes it. Decoding it again shows the old contents. The alternative is to mark decoding as impure everywhere. I recommend keeping, and say why below.

### What happens today

These were measured on main at 708378db with the compiled program:

```text
catch: THREW Error: getter | 1 | 1        a `$hex` getter that throws once, then not
toArray: 1 | 2 | 3                        a proxy whose `length` grows on each read
kind before/after revoke: 1 | 0           a revocable proxy over an array
message: "m1" | "m1" | "m1"               JsError.message: kept, already right
```

In the first case, the getter's error escapes even a catch-all `_` arm. A revoked proxy does the same to every `catch`, because reading any property of one throws.

**Why it matters.** Effects §6.2: "A replayable read of data foreign code may vary is impure; read once and kept, it is species (b) instead." The `catch` and `toArray` make replayable reads behind a pure face. The compiler may share, hoist or drop pure calls, so a program's answer could depend on optimisation. Memoised functions (#1446) also take a pure body to be a value function, so they inherit the problem, though they don't cause it.

### Since the decoders ruling

The Option/Result thread's ruling (a), 2026-11-03, makes the `JsValue` decoders throw a tracked `JsConversionError(reason, path)` instead of returning `Result`. Here is how it meets the two decisions:
- **Decision 1 matters more now.** A failed decode is caught on an ordinary path, with `?`, `try` or a library `oneOf` trying alternatives, and every one of those catches runs the brand test. Under 1A a failed decode costs about 5.5 µs instead of about 4 µs; dispatching on `kind()` first avoids both. Without 1A, a hostile value can make one of those catches pick a different arm on different calls.
- **Decision 2 composes with it.** Under 2A the kept answer for an object is its `isArray` verdict and its copy, so `toArray` gives the same copy, or throws the same `JsConversionError(Shape)`, every time. Under 2B, a decoder would be impure as well as failing, so it would be `->!` rather than `->^`.
- **The two edits don't overlap in substance.** The decoders' failure channel is that thread's; whether a look inside is kept is this one's. They touch the same lines of Part 11 §4.2 and `JsValue.hex`, so whichever lands second rebases. Neither has to wait for the other's ruling.
- **#1450**, the bare `show` that another prelude constraint's member can capture, is about name resolution and doesn't touch either decision.

### The three checks, up front

- **Fits doctrine?** Yes, both recommendations do. Effects §6.2 gives three honest answers to a read that foreign code can vary: keep it (species (b)), hold the data still by contract (species (c)), or mark the read impure. Keeping is what Part 11 §7, `Show<Exn>` and the inbound `Seq` adapter already do. The contract (option 2C below) contradicts Part 11 §1, which says a `JsValue` may be anything.
- **Colleague languages considered?**
  - **ReScript's `catch`** does what Hexagon does today. Its runtime tests `typeof e.RE_EXN_ID === "string"` with a raw read; I checked this in the ReScript 11.1.4 package.
  - **Class-based compilers** use `instanceof`, whose prototype walk runs a proxy's trap.
  - **OCaml** compares exception constructors by identity, so no foreign code runs, but it has no foreign objects to meet.
  - **None of these catches in pure code**, so none has Hexagon's problem.
  - **For decoding,** Haskell's GHCJS and jsaddle put `fromJSVal` in `IO`/`JSM`, which is option 2B. PureScript's `Foreign` and Elm's decoders are pure and copy nothing, which treats foreign values as unchanging without saying so. That is option 2C.
- **HM?** No change under 1A or 2A. Option 2B changes arrows, but not types.

### Decision 1: how a `catch` reads a thrown value

Today a `catch` reads `err.$hex` to ask "is this a Hexagon error?", then `$hex` and `name` again to pick an arm (Exceptions §7.4). `attempt`, `assume` and the reading `?` use the same test. A getter there runs on every catch, and it can make the catch choose a different arm, or escape the catch, each time.

#### (1A) Read through Part 11 §7's kept read (recommended)

The `catch` reads `$hex` and `name` exactly as `Show<Exn>` already does: guarded, at most once per thrown value, and kept beside the value.
- A read that throws counts as "no brand", so the value takes the foreign branch, where `_` and `JsError` arms catch it.
- Then a `catch` and a later `show` of the same value can never disagree. Today they can: Part 11 §7 notes that the two read the brand separately.

**What it costs.**
- **Speed.** About 1.5 µs more per caught throw, on top of about 4.2 µs to build and throw an error, so roughly a third more on a path Exceptions §7.3 already calls cold. That's from a JavaScript benchmark of the emitted shapes.
- **One implementation point.** The kept table has to be one per program. Today's helper is copied into each module, and to cope, each property is read in only one module. The runtime-wide place #1445 adds for the cycle rule can hold this table too.

**One more piece, so the purity claim has no hidden hole.** A JavaScript library that deliberately throws `{ $hex: "Parser", name: "ParseError", … }` impersonates a Hexagon error. Exceptions §7.1 already records this as accepted residue, like a fake `{ tag: "Some" }`. Under 1A, the payload fields of a branded value are still read as written. I'd name the residue as an FFI Part 1 §3.1 contract violation, which is what a fake `{ tag: "Some" }` already is. This is part of 1A, not a separate decision.

What would bring it back: a program where caught throws are hot enough for the third to matter.

#### (1B) A registry of Hexagon's own errors

Every Hexagon error is registered when it's built, and the `catch` asks the registry, reading nothing foreign. It measured slower than 1A, about 2.2 µs per throw. Its real cost is that a Hexagon error from another realm (an iframe, say) would count as foreign. Exceptions §7.1 chose the brand so that recognition survives realms and bundled duplicates, so 1B undoes a recorded decision.

#### (1C) Call a hostile thrown value a contract violation

This doesn't work. A revoked proxy is a legal JavaScript value that claims nothing, and Part 11 §7 already treats hostile thrown values as legitimate.

### Decision 2: looking inside a `JsValue`

- **`toArray`** copies the array again on every call.
- **`kind`'s** answer for a proxy over an array is `Array` until the proxy is revoked, and `Object` after.

The decoder library's field reads (Part 11 §13.2, not yet designed) will meet the same question, so this ruling sets the rule for all of them. It's only about purity, so it doesn't overlap the decoders' failure-channel question that the paused Option/Result thread owns.

#### (2A) Keep what Hexagon first saw (recommended)

The first time Hexagon looks inside an object, what it saw is kept beside that object for the object's lifetime:
- `toArray`'s copy;
- `kind`'s `Array` answer.

Later calls answer from what was kept. This is Part 11 §7's rule and the `Seq` adapter's: species (b).

**What it costs.**
- **Stale contents.** If JavaScript changes an array after Hexagon first decodes it, decoding it again gives the old contents. Part 11 §7 already says this of thrown values: "A foreign write to the property after the first read is not seen."
  - A dev who needs fresh reads has two honest doors: an extern row of their own marked impure, or an `Array(a)` parameter, which captures afresh at each crossing.
  - The common case, decoding the result of `JSON.parse`, never notices.
- **Speed.** About 1.4 µs for each array decoded for the first time. Copying an 8-element array alone costs about 27 ns, so that's about 50 times the copy. A second decode of the same array is faster than today. `kind` gains about 12 ns per object.
- **Memory.** The kept copy lives as long as the source array.

What would bring it back: a real program that decodes a live JavaScript array more than once and needs fresh contents, or decoding where 1.4 µs per array matters.

#### (2B) Decoding is impure

`toArray` and `kind` become impure (`->~`). That is GHCJS's answer.
- Every decode wears a `~` mark, and decoding can't happen in pure code: memoised bodies, `Seq` callbacks, comparators.
- `kind` sits under every scalar decoder (`toInt`, `toString` and the rest), so all of them become impure too.
- Part 11 would then have two rules: thrown values kept, other values impure.

#### (2C) A stability contract

Foreign code must not change a value Hexagon might look at again; if it does, that's a contract violation. This is what PureScript and Elm assume without saying. It contradicts Part 11 §1, which says a `JsValue` may be anything. It would also make a revoked proxy, or a buffer that a library reuses, a contract violation.

### What changes if you choose 1A and 2A

- **Spec:**
  - Exceptions §7.1 (the residue as a contract violation) and §7.4 (the `catch` reads through the kept read);
  - Part 11 §3 (`kind` keeps its `Array` answer), §4.2 (`toArray` keeps its copy) and §7 (the `catch` joins the kept reads);
  - Effects §6.2's species (b) list.
- **Code:**
  - the emitted `catch`, `attempt`, `assume` and `?`;
  - one runtime-wide kept table, shared with `JsError.message`, `Exn.stack` and `Show<Exn>`;
  - `toArray` and `kind`'s lowerings;
  - tests from the three probes above.

I'd send a spec PR first, then an implementation PR.
