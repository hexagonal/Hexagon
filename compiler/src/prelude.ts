/**
 * The implicit prelude injected into every compiled project.
 *
 * Each entry's `source` is an exact copy of the canonical, human-facing file in
 * `stdlib/`. They are embedded here so that `compileProject` stays
 * filesystem-free; when a project supplies its own copy at the injection path
 * (e.g. compiling the stdlib itself) that copy wins and the embedded fallback is
 * unused. Keep the embedded text in sync with the `stdlib/` originals.
 */

export interface PreludeModule {
  /** Basename placed at the common root of a project's sources. */
  readonly basename: string;
  /** Embedded fallback source, used only when the project supplies no file at the path. */
  readonly source: string;
}

const PRELUDE_SOURCE =
  "// Prelude nominals that are implicitly in scope in every Hexagon module.\n" +
  "//\n" +
  "// This file is the canonical, human-facing source of the prelude. The compiler\n" +
  "// embeds an identical copy in `compiler/src/prelude.ts` so that `compileProject`\n" +
  "// stays filesystem-free; a test asserts the two never drift.\n" +
  "export union Ordering derives (Eq, Show) =\n" +
  "    | Less\n" +
  "    | Equal\n" +
  "    | Greater\n";

const OPTION_SOURCE =
  "// The canonical optional-value union used by total standard-library accessors.\n" +
  "export union Option(a) derives (Eq, Show) =\n" +
  "    | Some(value: a)\n" +
  "    | None\n";

const RESULT_SOURCE =
  "// The canonical success-or-error union used across the standard library.\n" +
  "// Success type first, per the subject-first convention (Functions §5.3).\n" +
  "export union Result(a, e) =\n" +
  "    | Ok(value: a)\n" +
  "    | Err(error: e)\n";

/**
 * The prelude module set (Modules §5.5). **This order is normative, not
 * incidental.** Every module here is implicitly in scope in every non-prelude
 * module, and in the prelude modules *after* it — each member sees the members
 * before it, and only those, which is what makes cycles impossible by
 * construction. Adding a member means placing it after everything it uses.
 *
 * A consumer imports only the names it actually references, and a module nothing
 * reachable touches is not emitted.
 */
export const PRELUDE_MODULES: readonly PreludeModule[] = [
  { basename: "Prelude.hex", source: PRELUDE_SOURCE },
  { basename: "Option.hex", source: OPTION_SOURCE },
  { basename: "Result.hex", source: RESULT_SOURCE },
];
