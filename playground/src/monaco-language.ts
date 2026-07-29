import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export const hexagonLanguage = "hexagon";

export const hexagonTokens: monaco.languages.IMonarchLanguage = {
  // Monarch rebuilds rule regexes using language-level flags, so the Unicode
  // flag must live here for the identifier property escapes to remain valid.
  unicode: true,
  // NOTE for whoever adds the multi-line constructs #145 lists (block comments,
  // strings spanning newlines): every state below opens with a `^` rule that pops
  // the whole stack, because a type context must not outlive its line and Monarch
  // cannot observe end of line. A construct that is *meant* to span lines must NOT
  // carry that rule, or it will be torn open at each line start.
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
      // A `constraint` or `honor` head names a constraint (spec/constraints.md \u00A74.1).
      // The subject inside the following `<...>` is a type and is left to the ordinary
      // uppercase rule, which is what keeps `honor Show<Rat>`'s `Rat` nominal.
      [
        /(constraint|honor)([ \t]+)([\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*)/u,
        ["keyword", "white", "type.constraint"],
      ],
      // `derives Eq` and `derives (Eq, Show)` \u2014 Declarations Preamble \u00A72.3. Everything
      // the clause lists is a constraint, so the tuple form opens a short state.
      [/derives(?=[ \t]*\()/u, { token: "keyword", next: "@derivesList" }],
      [
        /(derives)([ \t]+)([\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*)/u,
        ["keyword", "white", "type.constraint"],
      ],
      // A binder's bound: `<a: Ord>` and `<a: (Num, Ord)>` (spec/constraints.md \u00A73).
      // This is the one constraint position with no keyword to announce it.
      [/<(?=[$_\p{ID_Start}][^<>\n]*>[ \t]*(?:\(|=|[\p{Uppercase}\p{Lt}]))/u, {
        token: "operator",
        next: "@typeParameters",
      }],
      // A data declaration's parameter list is a closed type position, so every name
      // in it is a type variable (Declarations Preamble \u00A72.1).
      [
        /(record|union)([ \t]+)([\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*)([ \t]*)(\()/u,
        [
          "keyword",
          "white",
          "type.identifier",
          "white",
          { token: "delimiter", next: "@declarationParameters" },
        ],
      ],
      // A `type` alias has a type expression as its whole right-hand side, so the
      // header opens a context that reaches the `=` and then keeps going.
      [
        /(type)([ \t]+)([\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*)/u,
        ["keyword", "white", { token: "type.identifier", next: "@aliasHeader" }],
      ],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      // A colon that is not `:=` opens a type annotation: parameters, record-type
      // fields, union payloads, and result types. Names inside are types or type
      // variables, never terms \u2014 which is what makes the `a` in `value: a` nominal.
      [/:(?!=)/u, { token: "delimiter", next: "@annotation" }],
      // A call head or a bodyless constraint-member header. Keywords are checked first
      // so that `if (x)` and `match (y)` keep their keyword colour.
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*(?=[ \t]*\()/u, {
        cases: {
          "@redirectWords": "invalid",
          "@keywords": "keyword",
          "@default": "entity.function",
        },
      }],
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/u, {
        cases: { "@redirectWords": "invalid", "@keywords": "keyword", "@default": "identifier" },
      }],
      [/\d+(?:\.\d+)?n?/u, "number"],
      [/"(?:[^"\\]|\\.)*"/u, "string"],
      [/[()\[\]{},.:]/u, "delimiter"],
      [/[+*/<>=!|-]+/u, "operator"],
    ],

    derivesList: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      [/\)/u, { token: "delimiter", next: "@pop" }],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.constraint"],
      [/[(,]/u, "delimiter"],
      [/[ \t]+/u, "white"],
      [/./u, { token: "delimiter", next: "@pop" }],
    ],

    typeParameters: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      // A parameterized instance head puts its binders before the constraint name
      // (spec/constraints.md §4.3: `honor<a: Show> Show<Vector(a)>`). The name is not
      // adjacent to `honor`, so it has to be claimed as this binder list closes —
      // by the time control returns to `root` the `>` has already been consumed.
      [
        /(>)([ \t]+)([\p{Uppercase}\p{Lt}][$‌‍_\p{ID_Continue}]*)(?=<)/u,
        ["operator", "white", { token: "type.constraint", next: "@pop" }],
      ],
      [/>/u, { token: "operator", next: "@pop" }],
      // After the colon every uppercase name is an obligation, up to the next binder.
      [/:/u, { token: "delimiter", next: "@typeParameterBound" }],
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/[()\[\]{},.]/u, "delimiter"],
      [/[ \t]+/u, "white"],
    ],

    typeParameterBound: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      [/(?=[,>])/u, { token: "@rematch", next: "@pop" }],
      // The tuple form's own parens open a group, so the comma inside `(Num, Ord)`
      // separates obligations instead of ending the bound.
      [/\(/u, { token: "delimiter", next: "@typeParameterBoundGroup" }],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.constraint"],
      [/[ \t]+/u, "white"],
      [/./u, "delimiter"],
    ],

    typeParameterBoundGroup: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      [/\)/u, { token: "delimiter", next: "@pop" }],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.constraint"],
      [/,/u, "delimiter"],
      [/[ \t]+/u, "white"],
      [/./u, "delimiter"],
    ],

    declarationParameters: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      [/\)/u, { token: "delimiter", next: "@pop" }],
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/,/u, "delimiter"],
      [/[ \t]+/u, "white"],
      [/./u, { token: "@rematch", next: "@pop" }],
    ],

    aliasHeader: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      [/\(/u, { token: "delimiter", next: "@declarationParameters" }],
      // `switchTo` rather than `next` so the alias body replaces this header instead
      // of stacking on it, letting one `@pop` at end of line return to `root`.
      [/=(?!=)/u, { token: "operator", switchTo: "@annotation" }],
      [/[ \t]+/u, "white"],
      [/./u, { token: "@rematch", next: "@pop" }],
    ],

    // A type expression. Everything named inside is a type or a type variable, so both
    // casings reach `type.identifier` \u2014 matching the VS Code side, where they carry
    // distinct scopes but one colour. Mirrors the grammar's `annotation-type`, which
    // likewise ends at the terminator its surrounding syntax supplies.
    annotation: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      [/[ \t]+/u, "white"],
      [/=>/u, { token: "@rematch", next: "@pop" }],
      [/=(?!=)/u, { token: "@rematch", next: "@pop" }],
      [/(?=[,)}\]>|])/u, { token: "@rematch", next: "@pop" }],
      // A record type's field name is the one lowercase role here that is not a type.
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*(?=[ \t]*:(?!=))/u, "identifier"],
      [/:(?!=)/u, "delimiter"],
      [/->/u, "operator"],
      [/[({\[]/u, { token: "delimiter", next: "@annotationGroup" }],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/[.]/u, "delimiter"],
      [/./u, { token: "@rematch", next: "@pop" }],
    ],

    // Inside a bracketed group within a type, where a comma separates arguments
    // rather than ending the annotation.
    annotationGroup: [
      // Monarch cannot observe end of line — the tokenizer loop breaks before a
      // zero-width `$` rule is ever tried — so a type context is closed at the start
      // of the next line instead. `^` rules are evaluated only at position 0, which is
      // the one position the loop force-evaluates. Without this a single annotated line
      // repaints the whole rest of the file.
      [/^(?=.)/u, { token: "@rematch", next: "@popall" }],
      [/[ \t]+/u, "white"],
      [/[)}\]]/u, { token: "delimiter", next: "@pop" }],
      [/[({\[]/u, { token: "delimiter", next: "@annotationGroup" }],
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*(?=[ \t]*:(?!=))/u, "identifier"],
      [/->/u, "operator"],
      [/[\p{Uppercase}\p{Lt}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/(?![\p{Uppercase}\p{Lt}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/u, "type.identifier"],
      [/[,.:]/u, "delimiter"],
      [/./u, "delimiter"],
    ],
  },
};
