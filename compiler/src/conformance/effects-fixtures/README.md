# `#355` effects-prototype fixtures

Scratch Hexagon modules for the flag-gated effects prototype. They are **not**
stdlib: `Seq.hex` here is a copy of `stdlib/Seq.hex` carrying the migration the
issue's session-2 consolidation inventories (five signature flips, six `?`
marks), and everything else is a scratch module that exists only to exercise one
ruling. The real `stdlib/` is untouched.

`Seq.hex` is named for its basename on purpose: `compileProject` injects a
prelude member only when the project does not already supply a file with that
name, so compiling this copy at the project root makes it *the* `Seq` for that
compilation — the same path by which the stdlib develops itself.
