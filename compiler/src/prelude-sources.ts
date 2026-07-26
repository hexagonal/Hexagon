/**
 * Embedded copies of the canonical `stdlib/` prelude sources. Do not edit by hand.
 * Regenerate with `npm run generate:prelude`; a conformance test asserts these
 * never drift from the originals.
 */

export const PRELUDE_SOURCES: Readonly<Record<string, string>> = {
  "Prelude.hex":
    "// Prelude nominals that are implicitly in scope in every Hexagon module.\n"
    + "//\n"
    + "// This file is the canonical, human-facing source of the prelude. The compiler\n"
    + "// embeds an identical copy in `compiler/src/prelude.ts` so that `compileProject`\n"
    + "// stays filesystem-free; a test asserts the two never drift.\n"
    + "export union Ordering derives (Eq, Show) =\n"
    + "    | Less\n"
    + "    | Equal\n"
    + "    | Greater\n",
  "Option.hex":
    "// The canonical optional-value union used by total standard-library accessors.\n"
    + "export union Option(a) derives (Eq, Show) =\n"
    + "    | Some(value: a)\n"
    + "    | None\n",
  "Result.hex":
    "// The canonical success-or-error union used across the standard library.\n"
    + "// Success type first, per the subject-first convention (Functions §5.3).\n"
    + "export union Result(a, e) =\n"
    + "    | Ok(value: a)\n"
    + "    | Err(error: e)\n",
};
