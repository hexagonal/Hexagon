import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export const hexagonLanguage = "hexagon";

export const hexagonTokens: monaco.languages.IMonarchLanguage = {
  // Monarch rebuilds rule regexes using language-level flags, so the Unicode
  // flag must live here for the identifier property escapes to remain valid.
  unicode: true,
  keywords: [
    "else",
    "export",
    "false",
    "fun",
    "if",
    "let",
    "match",
    "then",
    "true",
    "union",
  ],
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
      [/[a-z][\p{L}\p{N}_]*/u, {
        cases: { "@keywords": "keyword", "@default": "identifier" },
      }],
      [/[A-Z][\p{L}\p{N}_]*/u, "type.identifier"],
      [/\d+(?:\.\d+)?n?/u, "number"],
      [/"(?:[^"\\]|\\.)*"/u, "string"],
      [/[()\[\]{},.:]/u, "delimiter"],
      [/[+*/<>=!|-]+/u, "operator"],
    ],
  },
};
