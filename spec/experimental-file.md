# Experimental synchronous text files

**Status:** Experimental implementation for review. These modules are outside
the prelude and book; this contract does not promise a stable library API.

## 1. Modules and interface

`stdlib/Experimental/File.hex` declares `Experimental.File` and is imported as
`Hex.Experimental.File`. `stdlib/Experimental/Node/File.hex` declares
`Experimental.Node.File` and is imported as `Hex.Experimental.Node.File`.
The `Hex` package prefix is supplied by the package, not repeated in source
headers. Within `Hex`, the wrapper imports its adapter by its declared name,
`import Experimental.Node.File as NodeFile`. Both modules require an explicit
import and export only:

```text
readText: String ->! String
writeText: (String, String) ->! Unit
```

The arguments are `path`, and for writing, `text`. Both functions perform
synchronous whole-file I/O and require `!` at call sites. Their ordinary
Hexagon bodies infer these effects; the private extern declarations write
`->!` explicitly. No compiler intrinsic, new type, or new exception is added.

```hexagon
module Main

import Hex.Experimental.File as File

export let copy(source: String, destination: String): Unit =
    let text = File.readText!(source)
    File.writeText!(destination, text)
```

## 2. Text semantics

`Experimental.Node.File.readText` delegates to
`node:fs.readFileSync(path, "utf8")`. It preserves an initial U+FEFF and uses
the host's UTF-8 replacement decoding for malformed input, not strict decoding.
It does not detect UTF-16 or UTF-32.

`Experimental.File.readText` calls that adapter and removes exactly one initial
U+FEFF. An empty file and a BOM-only file both yield the empty string. Two
initial BOMs leave one; an interior U+FEFF remains. All other decoded text is
preserved, including CRLF, LF, NUL, and a missing final newline. There is no
Unicode normalization or whitespace trimming.

Both `writeText` operations ultimately call
`node:fs.writeFileSync(path, text, "utf8")`. They create a missing file or
truncate and overwrite an existing file, returning Unit on success. They add
neither a BOM nor a newline, but preserve a U+FEFF supplied in `text`. Lone
surrogates use the host UTF-8 encoder's replacement behavior. Parent directories
are not created. There is no atomic replacement or durable-storage guarantee;
a failed write may already have changed the destination.

Consequently the usual reader is not a lossless byte round trip: it consumes
the signature, and UTF-8 replacement decoding can lose malformed bytes.

## 3. Paths, errors, and runtimes

Paths are passed unchanged to the host. Relative paths use the process working
directory. There is no expansion of `~`, URL parsing, path normalization, or
portable policy for symlinks or directory reads beyond the host API.

File and permission failures propagate under the existing foreign-exception
rules (see [Exceptions](exceptions.md)); these modules neither catch them nor
introduce a normalized filesystem error taxonomy.

The adapter targets the `node:fs` API implemented by Node, Bun, and Deno.
Its name denotes the API, not an exclusive runtime requirement. Browser
execution is unsupported. Programs that do not import these modules must not
emit or load them or acquire a `node:fs` dependency.

Deno requires version 2.4.0 or later for this contract. Deno 2.1.2 strips a
leading BOM in `node:fs` UTF-8 decoding, unlike Node, causing the outer reader
to remove a second initial BOM. Deno's
[2.4.0 release](https://github.com/denoland/deno/releases/tag/v2.4.0) includes
the BOM-preservation fix (#29896); the emitted-module harness passes on 2.4.0.
The adapter does not introduce a workaround for older Deno releases.

Deno permissions belong to application launch configuration. For example,
with compiled JavaScript at `Main.js`:

```sh
deno run --no-prompt --allow-read=./input --allow-write=./output Main.js
```

The modules do not request, inspect, or grant Deno permissions. Denied access
propagates as a host exception. A Hexagon effect mark is not a permission grant.

References: [Node filesystem API](https://nodejs.org/api/fs.html),
[Bun node:fs](https://bun.sh/reference/node/fs),
[Deno node:fs](https://docs.deno.com/api/node/fs/), and
[Deno permissions](https://docs.deno.com/runtime/reference/permissions/).

## 4. Validation

Compiler conformance covers explicit imports, inferred effects, private externs,
embedded source parity, and absence from programs that do not use the modules.
The library dependency ordering required for the wrapper follows Packages §2.4;
cache reuse and invalidation are covered by the compiler's cache tests.
The runtime harness compiles the actual modules and exercises their emitted ESM
against real temporary files: BOM cases, Unicode and line endings, malformed
UTF-8, creation and truncation, exact written bytes, and failures. Deno runs
also exercise denied read and write permissions without prompting.

From `compiler/`, build once with `npm run build`, then run:

```sh
node scripts/test-experimental-file.mjs node
node scripts/test-experimental-file.mjs deno
node scripts/test-experimental-file.mjs bun
```

Each command requires that runtime on PATH; an unavailable runtime is a failed
invocation, not a passing compatibility result. Use Deno 2.4.0 or later as
required above. Node and Bun minimum versions are not established by this
experimental contract.
