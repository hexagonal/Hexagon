import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export const hexagonLanguage = "hexagon";

export const hexagonTokens: monaco.languages.IMonarchLanguage = {
  // Monarch rebuilds rule regexes using language-level flags, so the Unicode
  // flag must live here for the identifier property escapes to remain valid.
  unicode: true,
  keywords: [
    "and",
    "catch",
    "constraint",
    "derive",
    "else",
    "exception",
    "export",
    "extern",
    "finally",
    "for",
    "fun",
    "honor",
    "iff",
    "if",
    "implies",
    "import",
    "in",
    "let",
    "match",
    "not",
    "or",
    "record",
    "then",
    "try",
    "type",
    "union",
    "var",
    "while",
  ],
  // spec/lexer.md §4.1 reserved redirect words (#147). Still hard keywords — they can
  // never be names — but they no longer denote values: Bool is the prelude union
  // `False | True`. Every occurrence is an error carrying a one-token fixit, so they
  // are painted as errors rather than keywords, matching the VS Code grammar. The
  // constructors need no entry: `True`/`False` are uppercase-start names and already
  // reach `type.identifier` through the rule that paints `None`.
  redirectWords: ["false", "true"],
  operators: [
    "+",
    "-",
    "*",
    "/",
    "++",
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "|>",
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/u, "comment"],
      [/^module(?=[ \t]+[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*[ \t]*$)/u, "keyword"],
      [/^end[ \t]+module(?=[ \t]+[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*[ \t]*$)/u, "keyword"],
      [/__hex_[$\u200C\u200D_\p{ID_Continue}]*/u, "invalid"],
      [/_(?![$\u200C\u200D_\p{ID_Continue}])/u, "delimiter"],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/u, {
        cases: { "@redirectWords": "invalid", "@keywords": "keyword", "@default": "identifier" },
      }],
      [/\d+(?:\.\d+)?n?/u, "number"],
      [/"(?:[^"\\]|\\.)*"/u, "string"],
      [/[()\[\]{},.:]/u, "delimiter"],
      [/[+*/<>=!|-]+/u, "operator"],
    ],
  },
};
