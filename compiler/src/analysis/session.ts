/**
 * A persistent analysis session: the compiler-side service an editor talks to.
 *
 * `compileProject` is a batch: hand it every file, get a whole project back. An
 * editor instead holds a file set that changes one keystroke at a time and asks
 * questions about positions. This class is the adapter between those two shapes,
 * and it is the API `language-server/README.md` reserves for the compiler — the
 * server owns the protocol, this owns the language.
 *
 * It is deliberately free of any filesystem or process API. The host decides
 * what a workspace contains and pushes text in; the session never reads a file.
 *
 * ## Positions
 *
 * Every position crossing this API is a UTF-16 offset into the named file, which
 * is the compiler's own coordinate system (`Source.File`). Converting an editor's
 * line/character pair happens once, in the host, so this layer never carries two
 * coordinate systems at the same time.
 *
 * ## Staleness
 *
 * Analysis is recomputed lazily and wholly: any file change discards it, and the
 * next question rebuilds it. `version` increments on every mutation, so a host
 * that started a request before an edit can tell that the answer it is holding
 * no longer describes the text the user is looking at.
 *
 * Whole-project recompilation is the deliberate starting point rather than a
 * placeholder. Reanalyzing this repository's own `stdlib/` and `runtime/` after
 * an edit measures a median of about 40ms, well inside the delay diagnostics are
 * debounced by, so incremental reuse would buy nothing yet and would have to
 * guess at what is worth keeping before any query exists to say. When a real
 * workspace makes that false, the seam is here: only `#analyze` decides what to
 * rebuild.
 */

import * as Diagnostics from "../support/diagnostics.js";
import * as Source from "../support/source.js";
import type * as LaidOut from "../syntax/laid-out/index.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import * as Typed from "../syntax/typed/index.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { codePointBefore, isIdentifierContinue } from "../support/identifiers.js";
import {
  compileProject,
  resolveSpecifier,
  specifierFor,
  type CompiledModule,
  type ProjectOptions,
} from "../project.js";
import { moduleInterface } from "../passes/resolver/resolver.js";
import {
  collectOccurrences,
  targetKey,
  type Occurrence,
  type Target,
} from "../queries/occurrences.js";
import { collectTypeOccurrences, type TypeOccurrence } from "../queries/type-occurrences.js";
import { DocumentationIndex } from "../queries/documentation.js";
import { collectSemanticTokens, type SemanticToken } from "../queries/semantic-tokens.js";
import { collectSymbolFacts, type SymbolFacts } from "../queries/symbol-facts.js";
import {
  parameterSites,
  siteAt,
  underClaims,
  underClaimTitle,
  varianceHover,
} from "../queries/variance-claims.js";
import { collectCompletions, type Completion } from "../queries/completions.js";
import {
  planReturnAnnotation,
  refusedAnnotation,
  type ReturnAnnotationPlan,
  type ReturnAnnotationResult,
} from "../queries/return-annotation.js";

/** A span together with the path of the file it lies in. */
export interface Location {
  readonly path: string;
  readonly span: Source.Span;
}

export interface Definition extends Location {
  readonly target: Target;
  readonly name: string;
}

export interface Reference extends Location {
  readonly target: Target;
  readonly name: string;
  readonly isDefinition: boolean;
}

export interface Hover {
  readonly name: string;
  /**
   * What the name denotes, absent for a name the occurrence index has no
   * identity for — an `honor` member, a record field, a `type` alias, a
   * constraint's `type` member, an implied-type binding. Those are
   * documentable positions (`spec/doc-comments.md` §4.2) whose documentation is
   * the whole of what there is to say about them; see `hover`.
   */
  readonly target?: Target;
  /** Present for values the checker gave a scheme; absent for types themselves. */
  readonly displayedType?: string;
  /** The declaration's documentation as Markdown, when it carries any. */
  readonly documentation?: string;
  /** The identifier the answer describes, for the editor to highlight. */
  readonly span: Source.Span;
}

/** One replacement, and the file it lies in. An insertion is an empty span. */
export interface ActionEdit extends Location {
  readonly replacement: string;
}

/**
 * A repair the session offers against a diagnostic.
 *
 * `disabled` is the code-action shape of a `RenameRefusal`, and exists for the
 * same reason: the interesting answers are the ones where the repair is real,
 * obvious to the user, and not safe to make. Dropping those silently leaves a
 * user waiting for a lightbulb that never comes with nothing to explain why, so
 * a refused action is still returned, carrying the sentence that says what
 * stopped it. An action that carries `disabled` carries no edits.
 */
export interface CodeAction {
  readonly title: string;
  /**
   * The diagnostic this answers, for a host that shows the two together.
   *
   * Absent for an action that answers no diagnostic. There is exactly one such
   * action, and it exists because Hexagon has no warning tier: an opaque type
   * that under-claims its variance is not wrong, so nothing reports it, and the
   * offer to claim more has nothing to attach itself to (closure doc §8.2).
   */
  readonly diagnostic?: Diagnostics.Diagnostic;
  /**
   * Which family the action belongs to. A repair for a diagnostic is a quick
   * fix; the variance offer is a refactor, since it changes what a declaration
   * promises rather than fixing something broken.
   */
  readonly kind?: "quickfix" | "refactor";
  readonly edits: readonly ActionEdit[];
  readonly disabled?: string;
}

/**
 * A region of one file, in the session's own coordinates, closed at both ends —
 * a caret is `start === end`, and one sitting immediately after a name is still
 * on it, as everywhere else here.
 */
export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

/**
 * A rename the session will not perform, with the reason to show the user.
 *
 * A refusal is a result, not an error: every one of them describes something the
 * user can act on — a name the project does not own, a spelling Hexagon will not
 * read as the same kind of name, an edit that would change what the code means.
 * Silently doing the rename anyway is the failure mode this type exists to
 * prevent, because a rename is the one request whose damage is invisible until
 * much later.
 */
export interface RenameRefusal {
  readonly refused: string;
}

/** One span to replace, and the file it lies in. */
export interface RenameEdit extends Location {}

export interface RenamePlan {
  readonly newName: string;
  /** Ordered by file, then by position; never overlapping. */
  readonly edits: readonly RenameEdit[];
}

export type RenameResult = RenamePlan | RenameRefusal;

/** The identifier a rename would start from, for the editor to pre-fill. */
export interface RenameSubject {
  readonly name: string;
  readonly span: Source.Span;
}

export function refused(result: RenameResult | RenameSubject): result is RenameRefusal {
  return "refused" in result;
}

export interface SessionOptions extends ProjectOptions {}

export class AnalysisSession {
  #options: SessionOptions;
  readonly #texts = new Map<string, string>();
  /**
   * One identity per path, held even across a removal. Spans are compared by
   * file id all through the compiler, so a path that changed identity whenever
   * it was closed and reopened would make two spans in the same file look like
   * spans in different ones. Staleness is `version`'s job, not the id's.
   */
  readonly #fileIds = new Map<string, Source.FileId>();
  #nextFileId = 0;
  #version = 0;
  #analysis: Analysis | undefined;

  constructor(options: SessionOptions = {}) {
    this.#options = options;
  }

  /** Increments on every file-set mutation; stable while only queries run. */
  get version(): number {
    return this.#version;
  }

  /**
   * Replaces the compilation options.
   *
   * A host usually learns what kind of project it has *after* opening a session
   * on it — the configuration is a file in the workspace, so it has to be read
   * like any other — and that file can then change while the session is open.
   * Options are therefore not fixed at construction. Changing them invalidates
   * analysis exactly as a file change does, because they can change what every
   * answer is: `runtimePaths` decides which modules may name `Node(a)` at all.
   */
  configure(options: SessionOptions): void {
    if (sameOptions(this.#options, options)) return;
    this.#options = options;
    this.#invalidate();
  }

  get paths(): readonly string[] {
    return [...this.#texts.keys()];
  }

  /** Adds a file or replaces its text. A no-op change still invalidates nothing. */
  setFile(path: string, text: string): void {
    const normalized = normalizePath(path);
    if (this.#texts.get(normalized) === text) return;
    this.#texts.set(normalized, text);
    if (!this.#fileIds.has(normalized)) {
      this.#fileIds.set(normalized, Source.fileId(this.#nextFileId));
      this.#nextFileId += 1;
    }
    this.#invalidate();
  }

  removeFile(path: string): void {
    const normalized = normalizePath(path);
    if (!this.#texts.delete(normalized)) return;
    this.#invalidate();
  }

  /**
   * The path a compiler file identity belongs to. Spans name files by number,
   * so a host rendering a span that points somewhere else — a diagnostic's
   * secondary label, most often — needs this to say where.
   */
  pathOfFile(fileId: Source.FileId): string | undefined {
    return this.#analyze().pathOf(fileId);
  }

  /** Diagnostics for one file, empty for a file the session does not hold. */
  diagnostics(path: string): readonly Diagnostics.Diagnostic[] {
    return this.#analyze().diagnosticsByPath.get(normalizePath(path)) ?? [];
  }

  /**
   * Diagnostics for every file the session holds, including the files that
   * produced none. A host publishing diagnostics needs the empty entries too:
   * they are how an editor learns that a file's previous errors are gone.
   */
  allDiagnostics(): ReadonlyMap<string, readonly Diagnostics.Diagnostic[]> {
    const analysis = this.#analyze();
    const result = new Map<string, readonly Diagnostics.Diagnostic[]>();
    for (const path of this.#texts.keys()) {
      result.set(path, analysis.diagnosticsByPath.get(path) ?? []);
    }
    return result;
  }

  /**
   * Where the name at this offset is declared.
   *
   * More than one answer is possible and correct: a record name denotes both a
   * type and its constructor, and a constraint name can in principle be declared
   * in several modules. Returning both beats picking one silently.
   */
  definitions(path: string, offset: number): readonly Definition[] {
    const analysis = this.#analyze();
    const found: Definition[] = [];
    const seen = new Set<string>();
    for (const occurrence of analysis.occurrencesAt(normalizePath(path), offset)) {
      for (const definition of analysis.byTarget(occurrence.target)) {
        if (definition.role !== "definition") continue;
        const key = `${targetKey(definition.target)}@${spanKey(definition.span)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          target: definition.target,
          name: definition.name,
          path: analysis.pathOf(definition.span.fileId) ?? "",
          span: definition.span,
        });
      }
    }
    return found.filter(({ path: found }) => found !== "");
  }

  /** Every occurrence of what the name at this offset denotes, declaration included. */
  references(
    path: string,
    offset: number,
    options: { readonly includeDeclaration?: boolean } = {},
  ): readonly Reference[] {
    const includeDeclaration = options.includeDeclaration ?? true;
    const analysis = this.#analyze();
    const found: Reference[] = [];
    const seen = new Set<string>();
    for (const occurrence of analysis.occurrencesAt(normalizePath(path), offset)) {
      for (const other of analysis.byTarget(occurrence.target)) {
        const isDefinition = other.role === "definition";
        if (isDefinition && !includeDeclaration) continue;
        const key = `${targetKey(other.target)}@${spanKey(other.span)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const owner = analysis.pathOf(other.span.fileId);
        if (owner === undefined) continue;
        found.push({ target: other.target, name: other.name, path: owner, span: other.span, isDefinition });
      }
    }
    return found.sort((left, right) =>
      left.path.localeCompare(right.path) ||
      left.span.start.offset - right.span.start.offset
    );
  }

  /**
   * What the name at this offset is. When several occurrences share the offset —
   * a record's name is its type and its constructor — the one carrying a type
   * wins, because that is the answer with something to say.
   *
   * Documentation joins whatever the occurrence index found: the declaration
   * under the cursor when the cursor is on one, and otherwise the declaration
   * this name denotes, so a use site shows what its definition documents
   * (`spec/doc-comments.md` §8). The order matters because the second question
   * is answered by identity, and one identity in Hexagon is not always one
   * declaration: a constraint *is* its name project-wide (`targetKey`), so
   * `byTarget` on one returns every same-named constraint in the workspace. It
   * also matters where the two disagree honestly — the constraint in an `honor`
   * head is a reference to the constraint *and* the name the block's own
   * documentation is filed under, and the block the cursor is inside wins.
   *
   * A documented name the index has no identity for is still answered, with the
   * documentation alone. That is the only way §8's "every documentable
   * position" holds: an `honor` member, a record field, a `type` alias, and an
   * implied type's name on either side of `honor` all
   * resolve to nothing the index can name, so hover would otherwise be silent
   * exactly where the `.d.ts` is silent too and documentation is all there is.
   */
  hover(path: string, offset: number): Hover | undefined {
    const normalized = normalizePath(path);
    const analysis = this.#analyze();
    const candidates = analysis.occurrencesAt(normalized, offset);
    // Ahead of the occurrence index because a type parameter in a declaration
    // head has no occurrence identity at all — it is a name in a binder, not a
    // reference — so nothing else here can answer about one. Hover shows both
    // facts: the declared claim, and what the representation supports (§8.2).
    const variance = this.#varianceHover(analysis, normalized, offset);
    if (variance !== undefined) return variance;
    // For the same reason: a hole is not a name, so nothing in the occurrence
    // index denotes one, and hover is the hole's only reporting channel.
    const hole = this.#holeHover(analysis, normalized, offset);
    if (hole !== undefined) return hole;
    if (candidates.length === 0) return this.#documentedName(analysis, normalized, offset);
    const typed = candidates
      .map((occurrence) => ({
        occurrence,
        displayedType: analysis.displayedTypeAt(normalized, occurrence.span),
      }))
      .sort((left, right) => Number(right.displayedType !== undefined) - Number(left.displayedType !== undefined));
    const best = typed[0]!;
    const documentation = analysis.documentation.at(best.occurrence.span) ??
      this.#documentationOf(analysis, best.occurrence.target, best.occurrence.span.fileId);
    return {
      name: best.occurrence.name,
      target: best.occurrence.target,
      span: best.occurrence.span,
      ...(best.displayedType === undefined ? {} : { displayedType: best.displayedType }),
      ...(documentation === undefined ? {} : { documentation }),
    };
  }

  /**
   * A parameterized `opaque` declaration's parameter, hovered.
   *
   * Only for a declaration written in *this* file: the spans come from the
   * declaration head, and an imported declaration's head is in another file.
   */
  #varianceHover(analysis: Analysis, path: string, offset: number): Hover | undefined {
    const fileId = this.#fileIds.get(path);
    const typed = analysis.typedOf(path);
    if (fileId === undefined || typed === undefined) return undefined;
    const site = siteAt(typed, fileId, offset);
    if (site === undefined) return undefined;
    return {
      name: site.parameter.name,
      span: site.span,
      documentation: varianceHover(site),
    };
  }

  /**
   * A type hole, hovered: what inference filled it with
   * (`decisions-ml-dialect-annotations-2026-08.md` §7).
   *
   * The answer has no `target` — a hole denotes nothing the index can name — so
   * it renders as the bare `_: T`, which is exactly the sentence wanted. There
   * is no documentation to attach: a hole is not a declaration.
   */
  #holeHover(analysis: Analysis, path: string, offset: number): Hover | undefined {
    const fileId = this.#fileIds.get(path);
    const typed = analysis.typedOf(path);
    if (fileId === undefined || typed === undefined) return undefined;
    const hole = typed.typeHoles.find(({ span }) =>
      span.fileId === fileId &&
      offset >= span.start.offset && offset <= span.end.offset
    );
    if (hole === undefined) return undefined;
    return {
      name: "_",
      span: hole.span,
      displayedType: Typed.displayScheme(hole.scheme),
    };
  }

  /**
   * What the declaration of an identity documents, wherever it was declared.
   *
   * The asking file's own declarations are preferred over any other file's, and
   * that is not a tie-break for tidiness. A value, a union, a record and a
   * foreign type each have an identity minted once for the project, so their
   * `byTarget` sets name one declaration and the preference never fires. A
   * *constraint* has no identity beyond its spelling — `targetKey` keys it by
   * name — so two unrelated modules declaring `Shown` share one target, and
   * without this an undocumented constraint would hover with a stranger's
   * documentation, which is worse than hovering with none. A file that declares
   * the name nowhere still falls back to the rest, since that is the only
   * reading under which the compiler resolved the name at all.
   */
  #documentationOf(
    analysis: Analysis,
    target: Target,
    asking: Source.FileId,
  ): string | undefined {
    const definitions = analysis
      .byTarget(target)
      .filter(({ role }) => role === "definition");
    const here = definitions.filter(({ span }) => span.fileId === asking);
    for (const occurrence of here.length > 0 ? here : definitions) {
      const found = analysis.documentation.at(occurrence.span);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /**
   * A documented declaration's own name at this offset, and nothing else.
   *
   * The name is read from the text rather than carried on the documentation:
   * the span is the name, so slicing it is not a guess about meaning — and a
   * file this session no longer holds is answered with nothing rather than with
   * an empty name.
   */
  #documentedName(analysis: Analysis, path: string, offset: number): Hover | undefined {
    const fileId = this.#fileIds.get(path);
    const text = this.#texts.get(path);
    if (fileId === undefined || text === undefined) return undefined;
    const found = analysis.documentation.covering(fileId, offset);
    if (found === undefined) return undefined;
    return {
      name: text.slice(found.span.start.offset, found.span.end.offset),
      span: found.span,
      documentation: found.content,
    };
  }

  /**
   * Where in one file `hover` has something to say — the whole set, so a host
   * can ask once instead of once per position.
   *
   * For a host with a pointer this is not needed: the user hovers, the provider
   * asks, and an empty answer draws nothing. It exists for a host that has to
   * open the hover *itself* — the Playground on iPadOS, where there is no
   * pointer and the caret is the only thing that moves — and which therefore has
   * to decide whether to open one before it has an answer to show.
   *
   * The four sources below are `hover`'s own four, read from the same arrays
   * with the same containment rule, so the two agree by construction. That is
   * the whole point of the method: the Playground previously gated on the type
   * occurrence table, which answers a different question and so both over- and
   * under-fired (#254). A gate derived from anything but the answer drifts from
   * it, and this one cannot be derived from anything else without saying so
   * here.
   *
   * Order is not reproduced. `hover` short-circuits — a variance site wins
   * outright, and a documented name is consulted only where the occurrence index
   * is silent — but the *set of offsets it answers at* is the plain union of the
   * four, and that set is all a gate needs.
   *
   * Every span returned lies in the queried file, which is worth knowing rather
   * than assuming: `collectOccurrences` drops any span whose file is not the
   * module's (`#publish`), a variance site's span is checked against `fileId`,
   * and the documentation index is bucketed by file. A host may therefore map
   * these back to its own coordinates using the path it asked about. They are
   * not deduplicated or merged: a record's name is both a type and a
   * constructor, so overlap is normal and a gate does not care.
   */
  hoverSpans(path: string): readonly OffsetRange[] {
    const normalized = normalizePath(path);
    const analysis = this.#analyze();
    const spans: OffsetRange[] = [];
    const fileId = this.#fileIds.get(normalized);
    if (fileId !== undefined) {
      // Each branch carries the guard its answer carries — `#varianceHover` and
      // `#holeHover` need the typed tree, `#documentedName` needs the text it
      // slices the name out of — rather than one guard covering both, so a file
      // the session holds only half of gates exactly where it would answer.
      const typed = analysis.typedOf(normalized);
      if (typed !== undefined) {
        for (const site of parameterSites(typed, fileId)) spans.push(offsetsOf(site.span));
        for (const hole of typed.typeHoles) {
          if (hole.span.fileId === fileId) spans.push(offsetsOf(hole.span));
        }
      }
      if (this.#texts.has(normalized)) {
        for (const name of analysis.documentation.namesIn(fileId)) {
          spans.push(offsetsOf(name.span));
        }
      }
    }
    for (const occurrence of analysis.occurrencesIn(normalized)) {
      spans.push(offsetsOf(occurrence.span));
    }
    return spans;
  }

  /**
   * What each name in one file means, for colouring by resolution.
   *
   * Empty for a file the session does not hold, which is the same answer a file
   * with no names gives — an editor that asked about a file this session has
   * never seen should get its grammar's colours, not an error.
   */
  semanticTokens(path: string): readonly SemanticToken[] {
    const analysis = this.#analyze();
    return collectSemanticTokens(
      analysis.occurrencesIn(normalizePath(path)),
      analysis.symbolFacts,
    );
  }

  /**
   * What could be written at this offset.
   *
   * Answered against whatever the last analysis produced, which for a buffer
   * mid-keystroke is a tree with errors in it — that is the normal case for this
   * request rather than a degraded one, and the scope record survives it because
   * the resolver writes each region down as it opens it.
   */
  completions(path: string, offset: number): readonly Completion[] {
    const normalized = normalizePath(path);
    const text = this.#texts.get(normalized);
    if (text === undefined) return [];
    const analysis = this.#analyze();
    const resolved = analysis.resolvedOf(normalized);
    if (resolved === undefined) return [];
    return collectCompletions({
      text,
      offset,
      resolved,
      facts: analysis.symbolFacts,
      docs: analysis.documentation,
    });
  }

  /**
   * What could be repaired in this region of one file.
   *
   * Every action here answers a diagnostic — this is the diagnostic-driven half
   * of code actions, not the refactoring half — so the work is bounded by the
   * errors the user can already see. That bound is what makes the expensive one
   * affordable: an inferred return type is offered only after being compiled and
   * compared, and nothing compiles unless the caret is on the error it fixes.
   *
   * Two sources feed it. A diagnostic may carry its own `fixes`, written where
   * the problem was found — the lexer's redirect from a JavaScript-spelled block
   * comment to `(* … *)` is one — and those are decided already, so they pass
   * straight through. The rest are computed here, needing the whole project.
   */
  codeActions(path: string, range: OffsetRange): readonly CodeAction[] {
    const normalized = normalizePath(path);
    const analysis = this.#analyze();
    const here = analysis.diagnosticsByPath.get(normalized) ?? [];
    const actions: CodeAction[] = [];
    const asked = here.filter((diagnostic) => touches(diagnostic.primary, range));

    // The import insert is asked once per *spelling*, the way the annotation
    // planner below is asked once per place: one range can hold several
    // refusals of one name — `<a: Scale, b: Scale>` is two, and a file with
    // three uses of an unimported type is three — and every one of them wants
    // the identical line. Keeping the **first** is what makes the dedupe more
    // than tidying: `asked` is in source order, so the surviving offer is the
    // one seated above the earliest refused use, and therefore above all of
    // them (see `importInsertionOffset` on the local reading of §5.1).
    const offered = new Set<string>();
    for (const diagnostic of asked) {
      for (const fix of diagnostic.fixes ?? []) {
        const edits = locate(analysis, fix.edits);
        if (edits !== undefined) actions.push({ title: fix.message, diagnostic, edits });
      }
      const repair = diagnostic.importModuleRepair;
      if (repair === undefined) continue;
      const spelling = `${repair.namespace}:${repair.name}`;
      if (offered.has(spelling)) continue;
      offered.add(spelling);
      const insert = this.#importModuleAction(analysis, normalized, diagnostic);
      if (insert !== undefined) actions.push(insert);
    }

    // Asked once per *place* rather than once per diagnostic. More than one
    // error can caret one declaration — a missing signature and an undeclared
    // constraint both do — so the same repair is reachable from either, and
    // computing it twice would mean lexing and compiling twice to offer it once.
    const planning = this.#annotationPlanner(analysis, normalized, here);
    const planned = new Set<number>();
    for (const diagnostic of asked) {
      const plan = planning(diagnostic.primary.start.offset);
      if (plan === undefined || !plan.exported) continue;
      if (planned.has(plan.binding.start.offset)) continue;
      planned.add(plan.binding.start.offset);
      if (refusedAnnotation(plan)) {
        actions.push({ title: RETURN_ANNOTATION_TITLE, diagnostic, edits: [], disabled: plan.refused });
        continue;
      }
      const objection = this.#verifyAnnotation(normalized, plan);
      actions.push({
        title: RETURN_ANNOTATION_TITLE,
        diagnostic,
        edits: objection === undefined
          ? plan.edits.map((edit) => ({ path: normalized, ...edit }))
          : [],
        ...(objection === undefined ? {} : { disabled: objection }),
      });
    }

    // The one action with no diagnostic behind it (closure doc §8.2). The fix
    // text is the computed truth the compiler already holds from §6.3's
    // machinery, so applying it is one keystroke and cannot be wrong: the claim
    // being offered is exactly the one verification would accept.
    const fileId = this.#fileIds.get(normalized);
    const typed = analysis.typedOf(normalized);
    if (fileId !== undefined && typed !== undefined) {
      for (
        const site of underClaims(
          typed,
          fileId,
          (span) => touches(span, range),
        )
      ) {
        actions.push({
          title: underClaimTitle(site),
          kind: "refactor",
          edits: [{
            path: normalized,
            span: site.span,
            replacement: `${site.parameter.computed === "co" ? "+" : "-"}${site.parameter.name}`,
          }],
        });
      }
    }
    return actions;
  }

  /**
   * The workspace tier of Modules §5.1's **`import module` repair family** — the
   * one code action all three seats share (#577).
   *
   * The split the two tiers are drawn on is what makes this method small. The
   * compiler already decided that this refusal names `import module` as a
   * repair, and said so in a marker rather than in a sentence to be re-read
   * (`Diagnostics.Diagnostic.importModuleRepair`); the only thing left that the
   * compiler could not know is *which module* — a question about the workspace,
   * which is exactly what a session holds and a batch compile does not.
   *
   * The inventory rule is the family's own, followed here as it is in every
   * message that names repairs: **one** exporter is the case worth acting on,
   * and the edit is offered applied. Several make the choice the author's, so
   * the action is returned refused rather than dropped, naming the candidates —
   * the `disabled` shape this file already uses for a repair that is real,
   * obvious, and not the tooling's to make. None at all is silence: there is no
   * import line to write, and a wrong guess would be worse than a lightbulb that
   * never comes.
   *
   * **A candidate is a file the workspace supplied.** `#texts` is exactly that
   * set, and testing membership in it is the filter — not `isInjectedModule`,
   * which classifies by *basename* and would drop a user's own `/lib/Prelude.hex`
   * along with the compiler's. The distinction is load-bearing rather than
   * defensive: `compileProject` returns every module the program *reached*, and
   * a program that reaches `Prelude.hex` — one mention of a prelude name does
   * it — puts a compiler-injected module in the inventory. Offering it would
   * write `import module Ordering from "./Prelude"` into the user's source,
   * which repairs nothing (`` module `Ordering` does not export `rank` ``) and
   * emits `import * as Ordering from "./Prelude.js"` into their JavaScript.
   * Injected sources are not what the user wrote (`isInjectedModule`'s own
   * rule), and nothing here may hand one to them to type.
   *
   * The module being edited is never its own candidate either. A module cannot
   * import itself, and a spelling it exports *and* fails to resolve is a
   * different fault than a missing import (a `Name.` seat over its own type is
   * rule 1's message, and its repair is not an import at all).
   */
  #importModuleAction(
    analysis: Analysis,
    path: string,
    diagnostic: Diagnostics.Diagnostic,
  ): CodeAction | undefined {
    const repair = diagnostic.importModuleRepair;
    const text = this.#texts.get(path);
    if (repair === undefined || text === undefined) return undefined;
    const exporters = analysis
      .exportersOf(repair.name, repair.namespace)
      .filter((exporter) => exporter !== path && this.#texts.has(exporter));
    if (exporters.length === 0) return undefined;
    const title = `import module \`${repair.name}\``;
    if (exporters.length > 1) {
      return {
        title,
        diagnostic,
        kind: "quickfix",
        edits: [],
        disabled: `${exporters.length} modules export a ${repair.namespace} ` +
          `\`${repair.name}\`: ` +
          exporters.map((exporter) => `\`${specifierFor(path, exporter)}\``).join(", ") +
          " — write the import for the one you mean",
      };
    }
    const specifier = specifierFor(path, exporters[0]!);
    const offset = importInsertionOffset(
      analysis.resolvedOf(path),
      text,
      diagnostic.primary.start.offset,
    );
    const file = new Source.File(this.#fileIds.get(path)!, path, text);
    return {
      title,
      diagnostic,
      kind: "quickfix",
      edits: [{
        path,
        span: file.span(offset, offset),
        replacement: `import module ${repair.name} from ${JSON.stringify(specifier)}\n`,
      }],
    };
  }

  /**
   * Asks about the return type of the declaration at an offset, lexing the file
   * at most once however many times it is asked.
   *
   * The token stream is the only record of where a parameter list closes and
   * nothing keeps one: compilation discards it, and holding every file's would
   * cost the whole workspace to answer about one line. Once per request is the
   * middle position, and it is not paid at all by a request that turns out to
   * have no declaration under it.
   */
  #annotationPlanner(
    analysis: Analysis,
    path: string,
    diagnostics: readonly Diagnostics.Diagnostic[],
  ): (offset: number) => ReturnAnnotationResult | undefined {
    const text = this.#texts.get(path);
    const fileId = this.#fileIds.get(path);
    const resolved = analysis.resolvedOf(path);
    const typed = analysis.typedOf(path);
    if (text === undefined || fileId === undefined) return () => undefined;
    if (resolved === undefined || typed === undefined) return () => undefined;
    let lexed: Lexed.File | undefined;
    let laidOut: LaidOut.File | undefined;
    return (offset) => {
      lexed ??= lex(new Source.File(fileId, path, text));
      laidOut ??= applyLayout(lexed);
      return planReturnAnnotation({
        resolved,
        typed,
        lexed,
        laidOut,
        diagnostics,
        offset,
        fileOfSpecifier: (specifier) => analysis.fileIdOf(resolveSpecifier(path, specifier)),
      });
    };
  }

  /**
   * Re-analyses the project with the annotation written, and objects unless it
   * changed nothing but the error it repairs.
   *
   * The same doctrine as `#verifyRename`, for a related reason. A type
   * annotation is not a comment: **a type variable written in an annotation is
   * rigid while that definition is checked** (Functions §4.1), so writing down
   * what inference derived can restrict what the definition is allowed to mean.
   * Deciding by hand when that matters means reimplementing generalization in a
   * place nothing keeps honest, so the edit is made and the compiler is asked.
   *
   * Two things have to hold. **The function's type must not change** — compared
   * as the checker renders it, which normalizes variable names, so an
   * alpha-equivalent scheme compares equal. And **no diagnostic may appear that
   * was not there before**, anywhere in the project, since a signature is a
   * promise to every caller.
   *
   * Diagnostics carreting the declaration's own name are the exception, and are
   * counted rather than compared: the whole point of the edit is to change one
   * of them, since the checker's message names what is *still* missing, so
   * completing a signature that also lacks parameter types rewrites the message
   * instead of removing it. Comparing those messages would read the repair as a
   * new error every time it half-worked.
   *
   * The count is what keeps that exception from being a hole, and it is a weak
   * guard rather than a strong one: an error that *replaced* another on the same
   * name passes it. Telling the two apart means knowing which diagnostic is the
   * one being repaired, and a `Diagnostic` has no identity beyond its text — so
   * the honest fix is a code on the diagnostic itself, which is worth having for
   * more than this and belongs to no one slice. No input found so far reaches
   * even the weak version; it is here because the exception above is real, not
   * because a failure was observed.
   */
  #verifyAnnotation(path: string, plan: ReturnAnnotationPlan): string | undefined {
    const probe = new AnalysisSession(this.#options);
    for (const [owner, text] of this.#texts) {
      probe.setFile(owner, owner === path ? applyEdits(text, plan.edits) : text);
    }
    const written = `writing \`: ${plan.annotation}\``;

    const declaration = plan.binding.start.offset;
    // Both halves matter, though only one of them can be reached today: an
    // offset names a place only together with a file, and a diagnostic in
    // another module can start at the same one. Nothing currently gets there,
    // because an edit that leaves this function's type alone cannot add a
    // diagnostic to a module that only sees the type.
    const onDeclaration = (owner: string, diagnostic: Diagnostics.Diagnostic): boolean =>
      owner === path && diagnostic.primary.start.offset === declaration;
    const split = (all: ReadonlyMap<string, readonly Diagnostics.Diagnostic[]>) => {
      const elsewhere = new Map<string, readonly Diagnostics.Diagnostic[]>();
      const here: string[] = [];
      for (const [owner, diagnostics] of all) {
        elsewhere.set(owner, diagnostics.filter((diagnostic) => !onDeclaration(owner, diagnostic)));
        for (const diagnostic of diagnostics) {
          if (onDeclaration(owner, diagnostic)) here.push(diagnostic.message);
        }
      }
      return { elsewhere, here };
    };

    const before = split(this.allDiagnostics());
    const after = split(probe.allDiagnostics());
    const was = diagnosticTally(before.elsewhere, []);
    for (const [key, appearance] of diagnosticTally(after.elsewhere, [])) {
      if ((was.get(key)?.count ?? 0) >= appearance.count) continue;
      return `${written} would break \`${appearance.path}\`: ${appearance.message}`;
    }
    if (after.here.length > before.here.length) {
      const fresh = after.here.find((message) => !before.here.includes(message));
      return `${written} would report a new problem with \`${plan.name}\`` +
        (fresh === undefined ? "" : `: ${fresh}`);
    }

    const now = probe.#analyze().schemeAt(path, declaration);
    const meant = this.#analyze().schemeAt(path, declaration);
    if (now === undefined) {
      // The declaration stopped existing: no input reaches this, since a broken
      // body is refused before any of it is compiled, and the two shapes of edit
      // add an annotation to a signature that already parsed. It is the answer
      // to "compare the two types" when there is no second type, and guessing
      // that no news is good news is the wrong default for that question.
      return `${written} would leave \`${plan.name}\` without a type at all`;
    }
    if (meant !== undefined && now !== meant) {
      return `${written} would change the type of \`${plan.name}\` from \`${meant}\` to \`${now}\``;
    }
    return undefined;
  }

  /**
   * The identifier a rename at this offset would rewrite, or the reason it
   * cannot be.
   *
   * `undefined` and a refusal are different answers and the host must keep them
   * apart: `undefined` means there is no name here, where an editor should say
   * nothing at all, while a refusal means there is one and something is wrong
   * with renaming it, which the user needs told.
   */
  prepareRename(path: string, offset: number): RenameSubject | RenameRefusal | undefined {
    const subject = this.#renameSubject(path, offset);
    if (subject === undefined || "refused" in subject) return subject;
    return { name: subject.name, span: subject.span };
  }

  /**
   * Every edit that renaming the name at this offset would make, or the reason
   * the session will not make them.
   */
  rename(path: string, offset: number, newName: string): RenameResult | undefined {
    const subject = this.#renameSubject(path, offset);
    if (subject === undefined || "refused" in subject) return subject;
    if (newName === subject.name) return { newName, edits: [] };

    const spelling = checkNewName(subject.name, newName);
    if (spelling !== undefined) return spelling;

    const byPath = new Map<string, Source.Span[]>();
    for (const mention of subject.mentions) {
      const bucket = byPath.get(mention.path);
      if (bucket === undefined) byPath.set(mention.path, [mention.span]);
      else bucket.push(mention.span);
    }
    for (const spans of byPath.values()) {
      spans.sort((left, right) => left.start.offset - right.start.offset);
    }

    const objection = this.#verifyRename(subject.name, byPath, newName);
    if (objection !== undefined) return objection;

    return {
      newName,
      edits: [...byPath]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([owner, spans]) => spans.map((span) => ({ path: owner, span }))),
    };
  }

  /**
   * What a rename at this offset would move: the identities under the cursor and
   * every mention of them this project owns.
   */
  #renameSubject(path: string, offset: number): SubjectOfRename | RenameRefusal | undefined {
    const analysis = this.#analyze();
    const innermost = analysis.occurrencesAt(normalizePath(path), offset)[0];
    if (innermost === undefined) return undefined;
    const name = innermost.name;
    // One offset can carry more than one identity — a record's name is its type
    // and its constructor — and both have to move, or the declaration stops
    // agreeing with itself.
    const targets = analysis
      .occurrencesAt(normalizePath(path), offset)
      .filter((occurrence) => occurrence.name === name)
      .map(({ target }) => target);
    const mentions: RenameEdit[] = [];
    const seen = new Set<string>();
    // Asked of every spelling, not only the one under the cursor. An alias's
    // declaration is spelled differently *by definition* — that is what makes it
    // an alias — so testing the filtered set would report `import {two as deux}`
    // as having no declaration and refuse a rename that is perfectly ordinary.
    const declared = targets.some((target) =>
      analysis.byTarget(target).some(({ role }) => role === "definition")
    );
    for (const target of targets) {
      for (const occurrence of analysis.byTarget(target)) {
        // An alias gives one identity two spellings. `import {Shade as Other}`
        // makes `Other` a mention of `Shade`, but renaming `Shade` must leave it
        // alone: the clause goes on aliasing, it just aliases a declaration that
        // is now spelled differently. Restricting to the spelling under the
        // cursor is exactly what makes each of the two sets complete on its own,
        // rather than making this a partial rename.
        if (occurrence.name !== name) continue;
        const owner = analysis.pathOf(occurrence.span.fileId);
        if (owner === undefined) continue;
        if (!this.#texts.has(owner)) {
          return {
            refused:
              `\`${name}\` is declared in \`${owner}\`, which this project does not own`,
          };
        }
        const key = `${owner}@${occurrence.span.start.offset}:${occurrence.span.end.offset}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mentions.push({ path: owner, span: occurrence.span });
      }
    }
    // `Eq`, `Ord`, `Show` and `Hash` are known to the checker rather than
    // declared in Hexagon, so every mention of one is a reference and there is
    // nothing to rewrite. Renaming them would silently detach every instance.
    if (!declared) {
      return { refused: `\`${name}\` is built into the compiler, so it has no declaration to rename` };
    }
    return { name, span: innermost.span, targets, mentions };
  }

  /**
   * Re-analyses the project with the rename applied, and refuses unless the
   * result means exactly what the original did.
   *
   * This is why a rename from this session can be trusted, and it is
   * deliberately not a scope calculation. Working out by hand which binder a
   * moved name would fall under means writing Hexagon's scoping rules a second
   * time, in a place nothing keeps honest — the copy that matters is the
   * resolver's. So the edit is made and the compiler is asked what it now sees.
   *
   * Two things have to hold. **No diagnostic may appear that was not there
   * before**: Statements §5.1 makes most collisions an error, so this catches
   * them in the compiler's own words rather than in a paraphrase. And **every
   * name in the project must go on denoting what it denotes now**. That second
   * test is the one that matters, because capture produces no diagnostic at all.
   *
   * It is deliberately asked of *every* site rather than only of the renamed
   * identity's own mentions. A site that mentions neither spelling can still
   * change meaning: shadowing moves a reference to an *outer* binding the moment
   * a rename gives an inner one that name, and the moved reference spells only
   * the new name, never the old.
   *
   * The case that originally motivated the width was narrower and no longer
   * exists: `x.op()` used to be settled **by name** against every operation in
   * scope, so introducing a second `tag` anywhere moved `Pale.tag()` from one
   * function to another. #267 made dispatch type-directed — one companion,
   * decided by the receiver's head — so no rename outside the receiver's home
   * module can reach a dot call at all.
   */
  #verifyRename(
    name: string,
    byPath: ReadonlyMap<string, readonly Source.Span[]>,
    newName: string,
  ): RenameRefusal | undefined {
    const probe = new AnalysisSession(this.#options);
    for (const [owner, text] of this.#texts) {
      const spans = byPath.get(owner);
      probe.setFile(owner, spans === undefined ? text : replaceSpans(text, spans, newName));
    }

    // Both spellings are blanked from both sides. Blanking only each side's own
    // name would key an *unchanged* message differently on the two runs: a
    // pre-existing `unknown name \`bar\`` elsewhere in the project survives the
    // rename untouched, yet reads as new the moment `bar` is the name being
    // renamed to.
    const spellings = [name, newName];
    const before = diagnosticTally(this.allDiagnostics(), spellings);
    for (const [key, appearance] of diagnosticTally(probe.allDiagnostics(), spellings)) {
      if ((before.get(key)?.count ?? 0) >= appearance.count) continue;
      return {
        refused:
          `renaming \`${name}\` to \`${newName}\` would break \`${appearance.path}\`: ` +
          appearance.message,
      };
    }

    // Every rewritten span moves everything after it in its own file by the same
    // amount, so an old offset maps forward by the number of edits that begin
    // before it. Lines do not move: an identifier replaces an identifier and
    // neither contains a line break.
    const delta = newName.length - name.length;
    const moved = (owner: string, offset: number): number => {
      const spans = byPath.get(owner);
      if (spans === undefined) return offset;
      let earlier = 0;
      for (const span of spans) if (span.start.offset < offset) earlier += 1;
      return offset + delta * earlier;
    };

    const wasMeant = this.#denotations(this.#analyze(), moved);
    const isMeant = this.#denotations(probe.#analyze(), () => 0, true);
    for (const [site, meaning] of wasMeant) {
      const now = isMeant.get(site);
      if (now === meaning) continue;
      const [owner, line] = readSite(site);
      return {
        refused:
          `renaming \`${name}\` to \`${newName}\` would change what the code means: ` +
          `the name at \`${owner}\` line ${line} would stop meaning what it means now`,
      };
    }
    for (const site of isMeant.keys()) {
      if (wasMeant.has(site)) continue;
      const [owner, line] = readSite(site);
      return {
        refused:
          `renaming \`${name}\` to \`${newName}\` would change what the code means: ` +
          `\`${owner}\` line ${line} would become a name the compiler resolves, ` +
          "where today it resolves to nothing",
      };
    }
    return undefined;
  }

  /**
   * What every name in the project's own files denotes, keyed by where it is.
   *
   * A denotation is written as the *place its declaration sits*, not as a symbol
   * number: identities are minted per compilation, so two runs cannot be
   * compared by them. Declarations move under a rename like everything else, so
   * both sides of the comparison are put through the same offset mapping and the
   * two agree exactly when nothing changed meaning.
   *
   * Prelude files are left out. They are not the project's to edit, they cannot
   * be reached by any offset mapping, and a prelude module that a rename makes
   * unreferenced simply stops being compiled — a difference about reachability
   * rather than about meaning.
   */
  #denotations(
    analysis: Analysis,
    moved: (path: string, offset: number) => number,
    identity = false,
  ): ReadonlyMap<string, string> {
    const place = (path: string, span: Source.Span): string =>
      `${path}@${identity ? span.start.offset : moved(path, span.start.offset)}` +
      `:${identity ? span.end.offset : moved(path, span.end.offset)}#${span.start.line + 1}`;
    const declaredAt = new Map<string, string>();
    const declarationsOf = (target: Target): string => {
      const key = targetKey(target);
      const known = declaredAt.get(key);
      if (known !== undefined) return known;
      const places: string[] = [];
      for (const occurrence of analysis.byTarget(target)) {
        if (occurrence.role !== "definition") continue;
        const owner = analysis.pathOf(occurrence.span.fileId);
        // A declaration outside the project is still a stable answer: the path
        // does not move, so naming it unmapped compares correctly on both sides.
        if (owner === undefined) continue;
        places.push(
          this.#texts.has(owner)
            ? place(owner, occurrence.span)
            : `${owner}@${occurrence.span.start.offset}`,
        );
      }
      places.sort();
      const answer = places.join(",");
      declaredAt.set(key, answer);
      return answer;
    };

    const denotations = new Map<string, string>();
    for (const path of this.#texts.keys()) {
      for (const occurrence of analysis.occurrencesIn(path)) {
        const site = place(path, occurrence.span);
        const meaning = declarationsOf(occurrence.target);
        const existing = denotations.get(site);
        // One span can carry more than one identity — a record's name is its
        // type and its constructor — so the site's meaning is all of them.
        denotations.set(site, existing === undefined ? meaning : `${existing}|${meaning}`);
      }
    }
    return denotations;
  }

  #invalidate(): void {
    this.#version += 1;
    this.#analysis = undefined;
  }

  #analyze(): Analysis {
    if (this.#analysis === undefined) {
      const files = [...this.#texts].map(([path, text]) =>
        new Source.File(this.#fileIds.get(path)!, path, text)
      );
      this.#analysis = new Analysis(compileProject(files, this.#options));
    }
    return this.#analysis;
  }
}

/** One whole-project compilation, indexed for position and identity lookup. */
class Analysis {
  readonly diagnosticsByPath = new Map<string, Diagnostics.Diagnostic[]>();
  readonly #pathsByFileId = new Map<number, string>();
  readonly #occurrencesByPath = new Map<string, readonly Occurrence[]>();
  readonly #resolvedByPath = new Map<string, Resolved.Module>();
  readonly #occurrencesByTarget = new Map<string, Occurrence[]>();
  readonly #typesByPath = new Map<string, Map<string, TypeOccurrence>>();
  readonly #typedByPath = new Map<string, Typed.Module>();
  readonly #fileIdsByPath: ReadonlyMap<string, Source.FileId>;
  /** The project's modules, for the export inventory built on demand below. */
  readonly #modules: readonly CompiledModule[];
  #exporters: Map<string, readonly string[]> | undefined;
  /** Gathered once for the whole project — see `collectSymbolFacts`. */
  readonly symbolFacts: ReadonlyMap<number, SymbolFacts>;
  /** Attached documentation, indexed for lookup by name and by position. */
  readonly documentation: DocumentationIndex;

  constructor(project: { readonly modules: readonly CompiledModule[]; readonly diagnostics: readonly Diagnostics.Diagnostic[] }) {
    // Before the facts, which carry each symbol's documentation with them: a
    // completion asks about a symbol, not about a place.
    this.documentation = DocumentationIndex.of(project.modules.map(({ typed }) => typed));
    this.symbolFacts = collectSymbolFacts(project.modules, this.documentation);
    // Built before the indexing loop: an import may name a module compiled after
    // this one, and a type name in an import list can only be resolved once the
    // specifier's target file is known.
    const fileIdsByPath = new Map(
      project.modules.map((module) => [module.source.path, module.source.id]),
    );
    this.#fileIdsByPath = fileIdsByPath;
    this.#modules = project.modules;
    for (const module of project.modules) {
      const path = module.source.path;
      this.#pathsByFileId.set(Number(module.source.id), path);
      this.#typedByPath.set(path, module.typed);
      const types = collectTypeOccurrences(module.typed);
      const occurrences = collectOccurrences(module, {
        fileOfSpecifier: (specifier) => fileIdsByPath.get(resolveSpecifier(path, specifier)),
        typeOccurrences: types,
      });
      this.#occurrencesByPath.set(path, occurrences);
      this.#resolvedByPath.set(path, module.resolved);
      for (const occurrence of occurrences) {
        const key = targetKey(occurrence.target);
        const bucket = this.#occurrencesByTarget.get(key);
        if (bucket === undefined) this.#occurrencesByTarget.set(key, [occurrence]);
        else bucket.push(occurrence);
      }
      this.#typesByPath.set(
        path,
        new Map(types.map((type) => [spanKey(type.span), type])),
      );
    }
    // A diagnostic belongs to the file its primary span names, which is not
    // always the file being edited: a module rejects an import by pointing at
    // its own text, but a checker error can caret a declaration a dependency
    // owns. Grouping by the span keeps each diagnostic where a user can see it.
    for (const diagnostic of project.diagnostics) {
      const path = this.#pathsByFileId.get(Number(diagnostic.primary.fileId));
      if (path === undefined) continue;
      const bucket = this.diagnosticsByPath.get(path);
      if (bucket === undefined) this.diagnosticsByPath.set(path, [diagnostic]);
      else bucket.push(diagnostic);
    }
  }

  pathOf(fileId: Source.FileId): string | undefined {
    return this.#pathsByFileId.get(Number(fileId));
  }

  /** One file's occurrences in source order, empty for a file not compiled. */
  occurrencesIn(path: string): readonly Occurrence[] {
    return this.#occurrencesByPath.get(path) ?? [];
  }

  /** One file's resolved tree, absent for a file that was not compiled. */
  resolvedOf(path: string): Resolved.Module | undefined {
    return this.#resolvedByPath.get(path);
  }

  /** One file's typed tree, absent for a file that was not compiled. */
  typedOf(path: string): Typed.Module | undefined {
    return this.#typedByPath.get(path);
  }

  /** The compiler identity of a path, for reading a span's file back. */
  fileIdOf(path: string): Source.FileId | undefined {
    return this.#fileIdsByPath.get(path);
  }

  /**
   * Which of the project's modules **export** a type or constraint of this
   * spelling, in path order (#577's workspace tier).
   *
   * Read through `moduleInterface`, which is the compiler's own answer to what a
   * module exports, rather than through a second reading of the items: an
   * inventory that drifted from the resolver's would offer an import line for a
   * name no importer could bind.
   *
   * **Every** module the project compiled is read, injected sources included:
   * `compileProject` returns the modules the program *reached*, which drops only
   * the injected sources nothing reached, so `Prelude.hex` is in here the moment
   * one prelude name is mentioned. This index therefore answers about the module
   * graph and nothing else — deciding which of its answers a *user* may be
   * offered is `#importModuleAction`'s, which keeps that decision next to the
   * edit it governs and next to the `#texts` set that settles it.
   *
   * Built on the first ask and kept for the life of the analysis. Nothing else
   * needs it, and a workspace's whole export surface is not worth computing for
   * the hovers and completions that make up nearly every request.
   */
  exportersOf(name: string, namespace: "type" | "constraint"): readonly string[] {
    if (this.#exporters === undefined) {
      const exporters = new Map<string, string[]>();
      for (const module of this.#modules) {
        const iface = moduleInterface(module.resolved);
        const seen = new Set<string>();
        const record = (namespaceKey: string, spelling: string): void => {
          const key = `${namespaceKey}:${spelling}`;
          if (seen.has(key)) return;
          seen.add(key);
          const bucket = exporters.get(key);
          if (bucket === undefined) exporters.set(key, [module.source.path]);
          else bucket.push(module.source.path);
        };
        for (const spelling of iface.unions.keys()) record("type", spelling);
        for (const spelling of iface.records.keys()) record("type", spelling);
        for (const spelling of iface.aliases.keys()) record("type", spelling);
        for (const spelling of iface.externTypes.keys()) record("type", spelling);
        for (const spelling of iface.constraints.keys()) record("constraint", spelling);
      }
      for (const bucket of exporters.values()) bucket.sort();
      this.#exporters = exporters;
    }
    return this.#exporters.get(`${namespace}:${name}`) ?? [];
  }

  /**
   * The type of the value declared at this offset, as the checker renders it.
   *
   * Rendered rather than returned, because it exists to be *compared* across two
   * compilations: type identities are minted per run, where `displayScheme`
   * names variables by the order they appear and so compares equal for schemes
   * that differ only in which variables they happened to allocate.
   */
  schemeAt(path: string, offset: number): string | undefined {
    const typed = this.#typedByPath.get(path);
    const symbol = typed?.symbols.find(({ bindingSpan }) =>
      bindingSpan.fileId === typed.fileId && bindingSpan.start.offset === offset
    );
    return symbol === undefined ? undefined : Typed.displayScheme(symbol.scheme);
  }

  /**
   * Occurrences covering an offset, innermost first. The range is half-open at
   * the end *except* that the caret sitting just past an identifier still counts
   * as being on it, which is where an editor leaves the cursor after typing a
   * name and where users expect a request to answer.
   */
  occurrencesAt(path: string, offset: number): readonly Occurrence[] {
    const occurrences = this.#occurrencesByPath.get(path) ?? [];
    return occurrences
      .filter(({ span }) => offset >= span.start.offset && offset <= span.end.offset)
      .sort((left, right) =>
        (left.span.end.offset - left.span.start.offset) -
        (right.span.end.offset - right.span.start.offset)
      );
  }

  byTarget(target: Target): readonly Occurrence[] {
    return this.#occurrencesByTarget.get(targetKey(target)) ?? [];
  }

  displayedTypeAt(path: string, span: Source.Span): string | undefined {
    return this.#typesByPath.get(path)?.get(spanKey(span))?.displayedType;
  }
}

function spanKey(span: Source.Span): string {
  return `${Number(span.fileId)}:${span.start.offset}:${span.end.offset}`;
}

/** What `#renameSubject` works out, of which only part is the host's business. */
interface SubjectOfRename extends RenameSubject {
  readonly targets: readonly Target[];
  /** Every mention this project owns, spelled as the cursor spells it. */
  readonly mentions: readonly RenameEdit[];
}


/**
 * Whether a proposed spelling is a name at all, and the same *kind* of name as
 * the one it replaces — decided by lexing both rather than by restating
 * `spec/lexer.md` §3 here.
 *
 * The lexer is where a keyword and the capitalized/uncapitalized split are
 * actually decided. A copy of those rules in this file would be one more thing
 * to keep in step, and the copy is the one that would silently fall behind —
 * which is how `TRésultat` came to truncate to `TR` in the first slice's index.
 *
 * Lexer §3.2's reserved `__` prefix is the one rule that cannot be borrowed that
 * way. It is position-dependent — the foreign side of an FFI `as` alias is
 * exempt — so the lexer emits the token and a *parser* selects the message
 * (#425), and a bare name in isolation has no position to read. A rename target
 * is unambiguously a Hexagon name seat, so the answer here is a flat refusal
 * with its own sentence.
 */
function checkNewName(current: string, proposed: string): RenameRefusal | undefined {
  const token = soleNameToken(proposed);
  if (token === undefined) {
    return {
      refused:
        `\`${proposed}\` is not a name Hexagon can read: it has to be one identifier, ` +
        "and not a keyword",
    };
  }
  if (token.text.startsWith("__")) {
    return {
      refused:
        `\`${proposed}\` begins with \`__\`, which is reserved for compiler-generated ` +
        "names — a binding spelled that way could collide with one the compiler writes",
    };
  }
  const existing = soleNameToken(current);
  if (existing === undefined || existing.kind === token.kind) return undefined;
  const [capitalized, plain] = token.kind === "UpperName"
    ? [proposed, current]
    : [current, proposed];
  return {
    refused:
      `\`${capitalized}\` starts with a capital letter and \`${plain}\` does not. ` +
      "Hexagon reads those as two different kinds of name, so this would not be " +
      "a rename but a different declaration",
  };
}

/** The one name token a string consists of, or nothing if it is anything else. */
function soleNameToken(candidate: string): Lexed.NameToken | undefined {
  const lexed = lex(new Source.File(Source.fileId(0), "<name>", candidate));
  if (lexed.diagnostics.length > 0) return undefined;
  const [token, ...rest] = lexed.tokens;
  if (token === undefined) return undefined;
  if (token.kind !== "NonUpperName" && token.kind !== "UpperName") return undefined;
  // Whitespace lexes to nothing, so `"foo "` produces the same single token as
  // `"foo"`; comparing the text is what tells them apart. Anything else that
  // lexed — `a b`, `a.b` — leaves a token behind after the name.
  if (token.text !== candidate) return undefined;
  return rest.every(({ kind }) => kind === "Eof") ? token : undefined;
}

/**
 * One title for the repair, wherever it is offered from.
 *
 * Named for what it does rather than for what it produces: the type itself is in
 * the edit the editor previews, and a title that carried it would change every
 * time the body did, which is not what a menu entry is for.
 */
const RETURN_ANNOTATION_TITLE = "Infer return type";

/**
 * Whether a diagnostic's span is close enough to the region the host asked
 * about to be what the user means.
 *
 * Inclusive at both ends, like every other position query here: a caret is an
 * empty range, and one sitting immediately after a name is still on it.
 */
function touches(span: Source.Span, range: OffsetRange): boolean {
  return span.start.offset <= range.end && span.end.offset >= range.start;
}

/**
 * A compiler-authored fix's edits, addressed by path.
 *
 * All or nothing: an edit naming a file this session cannot place would produce
 * a partial repair, which for a fix that spans two points — the lexer's comment
 * redirect rewrites an opener and its closer — leaves the source worse than it
 * found it. No fix today reaches outside the file its diagnostic is reported
 * against, so nothing currently takes that branch; it is here because the
 * property is about the *fixes*, which are written elsewhere and will grow.
 */
function locate(
  analysis: Analysis,
  edits: readonly Diagnostics.Edit[],
): readonly ActionEdit[] | undefined {
  const located: ActionEdit[] = [];
  for (const edit of edits) {
    const path = analysis.pathOf(edit.span.fileId);
    if (path === undefined) return undefined;
    located.push({ path, span: edit.span, replacement: edit.replacement });
  }
  return located;
}

/**
 * Where an inserted `import module` line goes in a file that already has text
 * in it (Modules §5.1's "placed so the file stays well-formed and any
 * term-position use sits below it", #577).
 *
 * Two placements, and the second is the one that needs saying. **After the last
 * import line above the use** is the natural one — the new alias joins the ones
 * already there, and §3's top-down half is satisfied by construction, since the
 * imports considered are only those the use is already below. **The top of the
 * file** is the fallback, and it is chosen rather than settled for: an insert at
 * offset zero is above every declaration, so it can split nothing — in
 * particular it can never come between a doc comment and the declaration the
 * comment documents, which is the one placement that would change what the file
 * means rather than merely how it reads (`spec/doc-comments.md` §2.1: a doc
 * comment attaches to what *immediately* follows it).
 *
 * Synthesized imports are not lines: the resolver writes one for the prelude
 * names a module used (Modules §5.5, §6.4), and it has no text to sit under.
 *
 * **"Any term-position use" is read locally — the use being repaired.** The
 * universal reading is available and is deliberately not taken. It differs only
 * where imports are *interleaved* between declarations and two refused uses of
 * one spelling straddle one: repairing the lower use seats the alias below the
 * upper one, which then draws its own declared-later error rather than being
 * fixed by the same edit. Three reasons for the local reading. It is what the
 * author asked for — the caret is on one use, and an edit that jumped above an
 * import line the author wrote between two declarations would be reordering
 * their file, not adding to it. It never makes a file worse: the upper use was
 * already refused and is now refused with a fixit of its own. And the shape is
 * reachable only through interleaved imports, which the top-down half of §3
 * exists to make legible rather than to encourage. The universal reading is
 * satisfied anyway wherever a request covers both uses, because `codeActions`
 * dedupes to the *first* refusal of a spelling and so places the line above the
 * earliest one.
 */
function importInsertionOffset(
  resolved: Resolved.Module | undefined,
  text: string,
  before: number,
): number {
  let offset = 0;
  for (const item of resolved?.items ?? []) {
    if (item.kind !== "Import" || item.synthesized) continue;
    if (item.span.end.offset > before) continue;
    offset = Math.max(offset, pastLineEnd(text, item.span.end.offset));
  }
  return offset;
}

/** The offset just past the line break that ends the line `offset` is on. */
function pastLineEnd(text: string, offset: number): number {
  const index = text.indexOf("\n", offset);
  return index === -1 ? text.length : index + 1;
}

/** Applies edits back to front, so an earlier one cannot move a later one. */
function applyEdits(text: string, edits: readonly Diagnostics.Edit[]): string {
  const ordered = [...edits].sort((left, right) =>
    left.span.start.offset - right.span.start.offset
  );
  let result = text;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const { span, replacement } = ordered[index]!;
    result = result.slice(0, span.start.offset) + replacement + result.slice(span.end.offset);
  }
  return result;
}

/** Replaces spans back to front, so an earlier edit cannot move a later one. */
function replaceSpans(
  text: string,
  spans: readonly Source.Span[],
  replacement: string,
): string {
  let result = text;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index]!;
    result = result.slice(0, span.start.offset) + replacement + result.slice(span.end.offset);
  }
  return result;
}

/**
 * A diagnostic's message with one identifier blanked out.
 *
 * Whole occurrences only: a message saying `Shade` must lose that word, while
 * one saying `Shades` keeps it, or two genuinely different diagnostics would
 * count as one. Messages quote identifiers in several ways — inside backticks,
 * and bare, as in "expected Int, found Shade" — so the test is on the characters
 * either side rather than on any quoting convention.
 */
function withoutName(message: string, spelling: string): string {
  if (spelling === "") return message;
  let result = "";
  let at = 0;
  for (;;) {
    const found = message.indexOf(spelling, at);
    if (found < 0) return result + message.slice(at);
    const after = found + spelling.length;
    const before = codePointBefore(message, found)?.character ?? "";
    const following = String.fromCodePoint(message.codePointAt(after) ?? 32);
    const bounded = !isIdentifierContinue(before) &&
      (after >= message.length || !isIdentifierContinue(following));
    result += message.slice(at, found) + (bounded ? "‹renamed›" : spelling);
    at = after;
  }
}

/**
 * A message with any *column* it quotes blanked out, and every line number left
 * exactly as it is.
 *
 * A diagnostic that names where something started — `unterminated block comment;
 * opened at line 1, column 26` — re-renders with a different column when an edit
 * earlier on that line moves what it points at, although it is the same
 * diagnostic and just as pre-existing. Counted without this, that reads as a
 * diagnostic the edit introduced, and a repair is refused for breaking something
 * it never touched.
 *
 * The line is a different matter and is load-bearing. Neither edit this session
 * makes — an identifier for an identifier, a type annotation with no newline in
 * it — moves anything to another line, so a line number that changed means a
 * genuinely different diagnostic. `\`x\` is already bound (line 3)` is the case
 * that proves it: renaming `q` to `p` where `p` is already bound produces a
 * collision quoting a different line from the one the file had before, and with
 * both spellings already blanked out of the message, that number is the only
 * thing left distinguishing the new error from the old.
 *
 * One singular `column`, deliberately. The layout pass writes a plural — `expected
 * one of columns 1, 5` — about *indentation*, which is a property of a line and
 * so is exactly as immovable as the line itself. Widening this to catch it would
 * blank a number that cannot change.
 */
function withoutPositions(message: string): string {
  return message.replaceAll(/\bcolumn \d+/g, "column ‹moved›");
}

/** The file and one-based line a denotation key names. */
function readSite(site: string): readonly [string, string] {
  const [place = "", line = "?"] = site.split("#");
  return [place.slice(0, place.lastIndexOf("@")), line];
}

/**
 * How many times each diagnostic is reported against each file, counted rather
 * than collected: an edit shifts positions, so two runs are compared by what
 * they say and where, never by the exact span they said it at.
 *
 * Diagnostics quote identifiers, so the renamed one is blanked out of the
 * message before counting. Without that, a *pre-existing* error that happens to
 * mention the name re-renders under the new spelling, looks like a diagnostic
 * that was never there before, and the rename is refused although nothing broke.
 * Renaming while a file holds an unrelated error mentioning that name is an
 * ordinary thing to be doing.
 *
 * A diagnostic that quotes the *column* something opened at moves the same way
 * and with the same consequence, so that number is blanked too — but only that
 * one, and never a line. See `withoutPositions`. Counting is what makes both
 * blankings safe: two diagnostics differing only in the blanked part collapse to
 * one key, and a genuinely new one still raises that key's count.
 */
function diagnosticTally(
  all: ReadonlyMap<string, readonly Diagnostics.Diagnostic[]>,
  spellings: readonly string[],
): ReadonlyMap<string, { readonly path: string; readonly message: string; count: number }> {
  const tally = new Map<string, { path: string; message: string; count: number }>();
  const blanked = (message: string): string =>
    withoutPositions(spellings.reduce((text, spelling) => withoutName(text, spelling), message));
  for (const [path, diagnostics] of all) {
    for (const { severity, message } of diagnostics) {
      const key = `${path} ${severity} ${blanked(message)}`;
      const entry = tally.get(key);
      if (entry === undefined) tally.set(key, { path, message, count: 1 });
      else entry.count += 1;
    }
  }
  return tally;
}

/**
 * Whether two option sets would compile the same way. Order within
 * `runtimePaths` is not meaningful — `compileProject` reads it as a set — so
 * reordering must not throw away analysis a host is about to ask questions of.
 *
 * The destructuring is load-bearing rather than stylistic. A field added to
 * `ProjectOptions` and not handled here would compare equal to itself forever:
 * `configure` would return early, the host would get answers from the old
 * options, and nothing would report it — the worst shape a cache bug takes.
 * Binding the rest to `Record<string, never>` makes that a compile error at the
 * moment the field is added, which is the only moment anyone is looking.
 */
function sameOptions(left: SessionOptions, right: SessionOptions): boolean {
  const compared = (
    { runtimePaths, ...rest }: SessionOptions,
  ): readonly string[] => {
    const exhaustive: Record<string, never> = rest;
    void exhaustive;
    return [...[...(runtimePaths ?? [])].sort()];
  };
  const [before, after] = [compared(left), compared(right)];
  return before.length === after.length && before.every((path, at) => path === after[at]);
}

/** A span as the closed offset range every position query here compares against. */
function offsetsOf(span: Source.Span): OffsetRange {
  return { start: span.start.offset, end: span.end.offset };
}

/**
 * The compiler's module graph resolves specifiers against `/`-separated paths,
 * so a host on Windows has to arrive in that shape. Normalizing here rather than
 * asking every caller to keeps one spelling of a file inside the session.
 */
function normalizePath(path: string): string {
  const absolute = path.startsWith("/") || path.replaceAll("\\", "/").startsWith("/");
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
