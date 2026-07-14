# Hexagon Compiler

This folder contains the beginning of `hexc`, the Hexagon compiler.

The platform-neutral TypeScript core now includes shared source coordinates,
structured diagnostics, the complete physical lexer, and the indentation layout
pass. Its public pipeline currently reaches
`Source.File -> Lexed.File -> LaidOut.File`; the parser is the next phase.

Development commands, run from this folder:

```text
npm ci
npm run check
npm test
npm run build
```

- [Roadmap](ROADMAP.md)
- [Global naming doctrine](architecture/naming.md)
- [Readability and commenting doctrine](architecture/readability-and-comments.md)
- [Testing doctrine](architecture/testing.md)
- [Implementation and environment](architecture/environment.md)
- [Compilation roots and running modules](architecture/compilation-roots.md)
- [JavaScript target doctrine](architecture/javascript-target.md)

The implementation language is TypeScript 7 or later.
