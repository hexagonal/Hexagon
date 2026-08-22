/** Whole-project orchestration for Hexagon's acyclic relative module graph. */

import * as Diagnostics from "./support/diagnostics.js";
import { relativeSpecifier } from "./support/paths.js";
import * as Source from "./support/source.js";
import type * as Parsed from "./syntax/parsed/index.js";
import type * as Resolved from "./syntax/resolved/index.js";
import type * as Typed from "./syntax/typed/index.js";
import type * as Core from "./syntax/core/index.js";
import type * as Emitted from "./emission/index.js";
import { lex } from "./passes/lexer/lexer.js";
import { applyLayout } from "./passes/layout/layout.js";
import { parse } from "./passes/parser/parser.js";
import { internalNameInputs, moduleInterface, resolve } from "./passes/resolver/resolver.js";
import {
  check,
  homeCompanionOperations,
  type ProgramOperation,
} from "./passes/checker/checker.js";
import { elaborate } from "./passes/elaborator/elaborator.js";
import {
  emitDeclarations,
  emitJavaScript,
  emittedModuleSpecifier,
  runtimeDeclarationsText,
  RUNTIME_DECLARATIONS_STEM,
  RUNTIME_WIRINGS,
} from "./passes/emitter/emitter.js";
import type { PreludeImport } from "./passes/resolver/resolver.js";
import type { RuntimeLocations } from "./passes/emitter/emitter.js";
import { PRELUDE_MODULES, PRIMITIVE_COMPANION_BASENAMES } from "./prelude.js";
import { RUNTIME_MODULES } from "./runtime-modules.js";

export interface CompiledModule {
  readonly source: Source.File;
  readonly parsed: Parsed.Module;
  readonly resolved: Resolved.Module;
  readonly typed: Typed.Module;
  readonly core: Core.Module;
  readonly javascript: Emitted.JavaScript;
  readonly declarations: Emitted.Declarations;
  /**
   * Where this module's emission found each runtime module, so a host that
   * re-emits it (the Playground, for its private-specialization preview) gets
   * the same answer rather than the same-directory default.
   *
   * Carried rather than recomputed because only `compileProject` knows where
   * the runtime modules were injected, and a host that guessed would emit a
   * runtime module with no export list, or a consumer importing a path that
   * does not exist — both of which compile clean and fail at load.
   */
  readonly runtimes: RuntimeLocations;
}

/**
 * Whether a module is an injected one the host should treat as compiler-owned
 * rather than as the user's source: the prelude members and the runtime
 * modules. A host presenting declarations, bindings, or an outline lists what
 * the user wrote, and these are not that.
 */
export function isInjectedModule(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return PRELUDE_MODULES.some((module) => module.basename === basename) ||
    RUNTIME_MODULES.some((module) => module.basename === basename);
}

export interface CompiledProject {
  readonly modules: readonly CompiledModule[];
  /**
   * The program's runtime declaration module (FFI Part 1 §8.3), or `undefined`
   * when no generated `.d.ts` mentions a `Hex.*` face.
   *
   * This is the first emission artefact belonging to no source file, which is
   * why it sits beside `modules` rather than inside one: the compiled project
   * was strictly per-module until §8.3 needed a program-scoped seat, and
   * obligation 3 is what grows it. The compile stays filesystem-free — the
   * artefact carries its intended path for a host to write it to. No host in
   * this repo does; see `Emitted.RuntimeDeclarations` for what that means.
   */
  readonly runtimeDeclarations: Emitted.RuntimeDeclarations | undefined;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export interface ProjectOptions {
  /**
   * Paths compiled as privileged **runtime** modules — the ones allowed to spell
   * `Node(a)` (`resolve`'s `runtime` flag). Separate from prelude privilege,
   * which follows the injection path. A runtime module still sees the prelude,
   * which is what lets it name `Bool` at all since #147 made `Bool` a prelude
   * declaration rather than a primitive.
   */
  readonly runtimePaths?: readonly string[];
}

/** Compiles every supplied file in dependency-first order without filesystem access. */
export function compileProject(
  files: readonly Source.File[],
  options: ProjectOptions = {},
): CompiledProject {
  const runtimePaths = new Set((options.runtimePaths ?? []).map(normalizePath));
  const diagnostics = new Diagnostics.Bag();
  const sources = new Map(files.map((file) => [normalizePath(file.path), file]));
  const root = commonRoot([...sources.keys()]);
  // One injected list, prelude and runtime members woven together, in the order
  // that makes each see the members before it and only those (Modules §5.5, and
  // `RuntimeModule.precedes` for what the runtime seats decide).
  const injectedModules = weaveInjected(PRELUDE_MODULES, RUNTIME_MODULES);
  const injectedPaths = injectEmbedded(sources, root, injectedModules);
  const preludePaths = injectedPaths.filter((_, index) => !injectedModules[index]!.runtime);
  const preludeSet = new Set(preludePaths);
  const runtimeModulePaths = injectedPaths.filter((_, index) => injectedModules[index]!.runtime);
  const runtimeModuleSet = new Set(runtimeModulePaths);
  /** Each injected path's seat, for the "sees only what precedes it" slice. */
  const injectedSeats = new Map(injectedPaths.map((path, index) => [path, index]));
  /**
   * Where each wired runtime module was injected, by basename. A wiring whose
   * module is absent from the project — which is only an empty project — has no
   * entry, and emission falls back to the same-directory default.
   */
  const runtimeModulePathsByBasename = new Map(
    RUNTIME_WIRINGS.flatMap(({ basename }) => {
      const path = injectedPaths.find((candidate, index) =>
        injectedModules[index]!.runtime && candidate.endsWith(`/${basename}`)
      );
      return path === undefined ? [] : [[basename, path] as const];
    }),
  );
  // The runtime declaration module's basename, settled before any module is
  // emitted because every importer has to spell the same one (FFI Part 1 §8.3).
  const runtimeBasename = runtimeDeclarationsBasename(sources.keys(), root);
  const parsed = new Map<string, Parsed.Module>();
  for (const [path, file] of sources) {
    parsed.set(path, parse(applyLayout(lex(file))));
  }

  const ordered: string[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    const cycleStart = visiting.indexOf(path);
    if (cycleStart >= 0) {
      const module = parsed.get(path);
      if (module !== undefined) {
        diagnostics.add({
          severity: "error",
          message: `import cycle: ${[...visiting.slice(cycleStart), path].join(" -> ")}`,
          primary: module.span,
        });
      }
      return;
    }
    const module = parsed.get(path);
    if (module === undefined) return;
    visiting.push(path);
    for (const item of module.items) {
      if (
        (item.kind === "ExternBlock" || item.kind === "ExternImport") &&
        (item.specifier.startsWith("./") || item.specifier.startsWith("../")) &&
        sources.has(resolveSpecifier(path, item.specifier))
      ) {
        diagnostics.add({
          severity: "error",
          message: "use `import` for Hexagon modules; `extern from` is for foreign JavaScript",
          primary: item.span,
        });
        continue;
      }
      if (item.kind !== "Import") continue;
      const target = resolveSpecifier(path, item.specifier);
      if (!sources.has(target)) {
        diagnostics.add({
          severity: "error",
          message: `cannot resolve module \`${item.specifier}\` from \`${path}\``,
          primary: item.span,
        });
      } else {
        visit(target);
      }
    }
    visiting.pop();
    visited.add(path);
    ordered.push(path);
  };
  for (const path of sources.keys()) visit(path);
  // Prelude modules compile before their consumers, and their identities live in a
  // reserved high range so consumer ids stay stable whether or not a prelude is present.
  // The runtime modules sit among them on both counts, for the same reasons: a
  // module has to compile behind everything it sees, and a project's own symbol
  // ids must not shift because the compiler injects a trie the project may not
  // even reach.
  for (const path of injectedPaths) {
    const index = ordered.indexOf(path);
    if (index >= 0) ordered.splice(index, 1);
  }
  ordered.unshift(...injectedPaths);

  const compiled = new Map<string, CompiledModule>();
  // Every nominal the program has resolved, dependencies first. `ordered` is a
  // topological order and imports are acyclic (Modules §8), so a declaration is
  // in here before anything that could name it — and, because a type reference
  // can only follow an import, no cross-module strongly-connected component can
  // form behind the analysis's back. Only the variance analysis reads it; see
  // `Declarations` in `passes/checker/variance.ts` for why one module's own view
  // is the wrong source.
  const programNominals: { unions: Resolved.Union[]; records: Resolved.RecordDeclaration[] } = {
    unions: [],
    records: [],
  };
  // Method Syntax §4.2's companion operation set for every nominal the program
  // has declared, dependencies first, each contributed by the type's own home
  // module (#585, `homeCompanionOperations`). The section's "the set is
  // import-insensitive… by construction" is this table: a checker reads a
  // receiver's operations from here, so no import of the *call site's* can add
  // one or take one away. Ordering carries the completeness claim — a type
  // nameable in a module had its home module compiled before it, because
  // imports are acyclic and a type reference can only follow one — which is what
  // makes the transitive case work: a nominal reached through a re-export or
  // through an imported function's result arrives with its whole set, having
  // never been imported here at all.
  const programOperations = new Map<string, Map<string, ProgramOperation>>();
  let symbolBase = 0;
  let unionBase = 0;
  let recordBase = 0;
  let externTypeBase = 0;
  let preludeSymbolBase = PRELUDE_ID_BASE;
  let preludeUnionBase = PRELUDE_ID_BASE;
  let preludeRecordBase = PRELUDE_ID_BASE;
  let preludeExternTypeBase = PRELUDE_ID_BASE;
  for (const path of ordered) {
    const isPrelude = preludeSet.has(path);
    const isRuntimeModule = runtimeModuleSet.has(path);
    // Both injected sets take their identities from the reserved range, so a
    // project's own ids are what a compilation with neither would have given it.
    const isInjected = isPrelude || isRuntimeModule;
    const source = sources.get(path)!;
    const parsedModule = parsed.get(path)!;
    const imports = new Map<string, ReturnType<typeof moduleInterface>>();
    const importedSchemes = new Map<Resolved.SymbolId, Typed.Scheme>();
    for (const item of parsedModule.items) {
      if (item.kind !== "Import") continue;
      const dependency = compiled.get(resolveSpecifier(path, item.specifier));
      if (dependency === undefined) continue;
      imports.set(item.specifier, moduleInterface(dependency.resolved));
      for (const symbol of dependency.typed.symbols) {
        importedSchemes.set(symbol.id, symbol.scheme);
      }
    }
    // Consumers see every prelude module; an *injected* module sees the members
    // before its own seat, and only those (Modules §5.5). Ordering the set this
    // way is what makes cycles impossible by construction, and it is why the
    // list order is normative rather than incidental. An injected module never
    // sees itself or anything later, so the first member sees nothing — and a
    // runtime module is bound by the same rule, which is what keeps
    // `VectorTrie.hex` from naming the `Vector` its own emission serves.
    const seat = injectedSeats.get(path);
    const preludeVisible = seat === undefined
      ? preludePaths
      : preludePaths.filter((preludePath) => injectedSeats.get(preludePath)! < seat);
    const preludeImports: PreludeImport[] = preludeVisible.flatMap((preludePath) => {
      const preludeCompiled = compiled.get(preludePath);
      if (preludeCompiled === undefined) return [];
      for (const symbol of preludeCompiled.typed.symbols) {
        importedSchemes.set(symbol.id, symbol.scheme);
      }
      return [{
        interface: moduleInterface(preludeCompiled.resolved),
        specifier: relativeSpecifier(path, preludePath),
      }];
    });
    const resolved = resolve(parsedModule, {
      // Where this module lives, project-root-normalized. It is the only source
      // of `Resolved.Module.path` and of the `declaringPath` every nominal
      // declared here is stamped with, which together let the checker name
      // another module's *file* in Collections Part 5 §3.3's diagnostic.
      path,
      // The same fact read the other way round: what this module *is*, for
      // Exceptions §7.1's brand (#488). Root-relative and extensionless, except
      // that an injected module brands its canonical injected name wherever its
      // file sits — a project supplying its own `stdlib/Vector.hex` is still
      // `Vector`, which is what keeps the brand a property of the module rather
      // than of the directory a host happened to unpack the stdlib into.
      identity: moduleBrandIdentity(path, root, isInjected),
      imports,
      symbolBase: isInjected ? preludeSymbolBase : symbolBase,
      unionBase: isInjected ? preludeUnionBase : unionBase,
      recordBase: isInjected ? preludeRecordBase : recordBase,
      externTypeBase: isInjected ? preludeExternTypeBase : externTypeBase,
      // Standard-library privilege — the intrinsic door's gate
      // (`spec/intrinsics.md` §5.2). It follows the *path*, so a project
      // supplying its own file at an injection path is privileged in it: the
      // stdlib-developing-itself path, carrying the same trust model as the
      // `Node` runtime flag precedent.
      //
      // Two seats hold it. Prelude membership is the first. The **runtime
      // module set** is the second (§5.2's runtime bullet, #365) — by either
      // route it arrives by, injection at the basename or the host's
      // `runtimePaths` grant, which is the same disjunction the `runtime` flag
      // below is computed from and for the same reason. A runtime module is
      // already trusted enough to spell `Node`; the door lets its new operations
      // arrive as declared, key-verified rows instead of as growth in the
      // non-declared guard family.
      //
      // The two privileges stay **separate flags**, not one merged notion:
      // `runtime` puts a name in scope and `privileged` opens a declaration
      // form, and a prelude member holds the second without the first.
      privileged: isPrelude || runtimePaths.has(path) || isRuntimeModule,
      // A primitive's home module is its fixed prelude companion (Constraints
      // §5.3), and nothing in the module's text can say so — a primitive has no
      // declaration. Like the privilege above, the fact follows the *path*.
      ...(isPrelude && PRIMITIVE_COMPANION_BASENAMES.has(path.slice(path.lastIndexOf("/") + 1))
        ? {
          companionPrimitive: PRIMITIVE_COMPANION_BASENAMES.get(
            path.slice(path.lastIndexOf("/") + 1),
          )! as Resolved.PrimitiveName,
        }
        : {}),
      // The `Node(a)` privilege is the other one, and a runtime module holds it
      // by being one. A host may still grant it by path (`hexagon.json`), which
      // is how `runtime/VectorTrie.hex` compiles under its own repository path
      // rather than at the injection basename.
      ...(runtimePaths.has(path) || isRuntimeModule ? { runtime: true } : {}),
      ...(preludeImports.length === 0 ? {} : { prelude: preludeImports }),
    });
    if (isInjected) {
      preludeSymbolBase = nextId(resolved.symbols.map(({ id }) => Number(id)), preludeSymbolBase);
      preludeUnionBase = nextId(resolved.unions.map(({ id }) => Number(id)), preludeUnionBase);
      preludeRecordBase = nextId(resolved.records.map(({ id }) => Number(id)), preludeRecordBase);
      preludeExternTypeBase = nextId(
        resolved.externTypes.map(({ externType }) => Number(externType)),
        preludeExternTypeBase,
      );
    } else {
      // Prelude identities are reserved above PRELUDE_ID_BASE; excluding them keeps
      // each consumer's own id range identical to a prelude-free compilation.
      const local = (id: number): boolean => id < PRELUDE_ID_BASE;
      symbolBase = nextId(resolved.symbols.map(({ id }) => Number(id)).filter(local), symbolBase);
      unionBase = nextId(resolved.unions.map(({ id }) => Number(id)).filter(local), unionBase);
      recordBase = nextId(resolved.records.map(({ id }) => Number(id)).filter(local), recordBase);
      externTypeBase = nextId(
        resolved.externTypes.map(({ externType }) => Number(externType)).filter(local),
        externTypeBase,
      );
    }
    const typed = check(resolved, { importedSchemes, programNominals, programOperations });
    programNominals.unions.push(...resolved.unions);
    programNominals.records.push(...resolved.records);
    // The schemes are this module's published ones, taken beside the symbols
    // rather than left for a consumer to look up: the operations that need the
    // table most are the ones no consumer imported, so no consumer holds their
    // schemes either.
    const publishedSchemes = new Map(typed.symbols.map(({ id, scheme }) => [id, scheme]));
    const ownOperations = homeCompanionOperations(resolved);
    // Computed once, and only where there is something to name: §8.2's added
    // import is written from the exporter's own spellings, and this is the
    // enumeration every written import already travels with.
    const ownInternalNames = ownOperations.size === 0
      ? { members: [], terms: [] }
      : internalNameInputs(moduleInterface(resolved));
    for (const [subject, operations] of ownOperations) {
      let seats = programOperations.get(subject);
      if (seats === undefined) {
        seats = new Map();
        programOperations.set(subject, seats);
      }
      for (const [name, symbol] of operations) {
        const scheme = publishedSchemes.get(symbol.id);
        if (scheme === undefined) continue;
        seats.set(name, { symbol, scheme, path, internalNames: ownInternalNames });
      }
    }
    // The source travels with the tree so the post-elaboration judgments can
    // quote what was written (Exceptions §5.4's cannot-throw message).
    const core = elaborate(typed, source);
    const runtimes = runtimesFor(path, runtimeModulePathsByBasename);
    const result: CompiledModule = {
      source,
      parsed: parsedModule,
      resolved,
      typed,
      core,
      runtimes,
      javascript: emitJavaScript(core, {
        exportInstanceEvidence: true,
        runtimes,
      }),
      declarations: emitDeclarations(core, {
        runtimeSpecifier: emittedModuleSpecifier(
          relativeSpecifier(path, `${root}/${runtimeBasename}.hex`),
        ),
      }),
    };
    compiled.set(path, result);
  }

  // Surface every module's own diagnostics on the project. `typed` accumulates
  // the lexing, layout, parsing, resolution, and checking stages; emission adds
  // its own. Without this a module that fails to compile reports success and
  // its broken JavaScript is handed back silently.
  // Each emission stage seeds its own bag with the diagnostics it was handed, so
  // `javascript` and `declarations` both re-carry everything `typed` produced and
  // a naive fold reports each one three times. The stages share diagnostic
  // *identity*, so a seen-set collapses the repeats without suppressing genuinely
  // distinct diagnostics that happen to read alike.
  const surfaced = new Set<Diagnostics.Diagnostic>();
  for (const path of ordered) {
    const module = compiled.get(path);
    if (module === undefined) continue;
    for (const stage of [module.typed, module.javascript, module.declarations]) {
      for (const diagnostic of stage.diagnostics) {
        if (surfaced.has(diagnostic)) continue;
        surfaced.add(diagnostic);
        diagnostics.add(diagnostic);
      }
    }
  }

  // Emit a prelude module only when something emitted imports it, so a project
  // that never touches its nominals is unchanged by the prelude's existence.
  // Since §5.5 lets prelude modules import each other, this is reachability
  // rather than a single hop: a module imported *only* by another prelude module
  // must still be emitted, or the emitted JavaScript carries an import of a file
  // that was never written — and that failure is silent, because the project
  // compiles clean.
  // `Import` items are not the whole answer since #153: a module that names only
  // a prelude *type* synthesizes no import item at all, yet its emission may
  // still import a dictionary from the prelude module that declares it. Those
  // edges are decided during emission, so they are read back from what emission
  // reported rather than inferred from the tree — the same shape as
  // `Declarations.importsRuntimeTypes`. Missing them is defect 8 exactly: an
  // emitted `import … from "./Prelude.js"` next to no `Prelude.js`, on a project
  // that reported no diagnostic.
  // A *synthesized* prelude import item is not an edge either, for the same
  // reason and since #263: its names are the resolver's over-approximation of
  // what companion dispatch might reach, and emission filters them to what the
  // body references — so the item can survive resolution with every name
  // dropped, and reading it as an edge would emit a prelude module nothing
  // imports. What emission reported is the answer for both channels.
  const importsOf = (path: string): readonly string[] => {
    const module = compiled.get(path);
    return [
      ...(module?.resolved.items ?? []).flatMap((item) =>
        item.kind === "Import" && !item.synthesized
          ? [resolveSpecifier(path, item.specifier)]
          : []
      ),
      ...[
        ...(module?.javascript.preludeInstanceImports ?? []),
        ...(module?.javascript.preludeTermImports ?? []),
        // The fundamental editions a known-concrete call site reaches (#440).
        // A fifth channel on the same footing, and the one that can be a
        // module's *only* edge: specializing every call to a prelude term
        // spends the synthesized import's whole name list, so the term channel
        // reports nothing while the emitted file still imports `logString`.
        ...(module?.javascript.specializationImports ?? []),
        // The member seats a concrete constraint-member call reaches (#444).
        // A sixth channel, and the one that can name a module no `Import` item
        // in this file mentions: an instance travels a re-export chain, but its
        // seats are only ever reached at the module that declared it.
        ...(module?.javascript.memberSeatImports ?? []),
        // The companion operations a dot call reached with no import to name
        // them by (#585, Method Syntax §8.2). A seventh channel on the same
        // footing as the sixth, and it can be a module's only edge to the
        // operation's home: §4.2's set is import-insensitive, so a type that
        // arrived through a re-export or a function's result carries its whole
        // companion, whose module nothing in this file mentions.
        ...(module?.javascript.companionOperationImports ?? []),
        // The `.d.ts` channel (#227, FFI Part 7 §2.4) is an edge on the same
        // footing, and the only one with no JavaScript counterpart: a face
        // naming `Option` while touching no `Option` term imports the type and
        // nothing else. Its target must still be emitted, or the declarations
        // import from a file that was never written.
        ...(module?.declarations.preludeTypeImports ?? []),
        // The runtime modules (Collections Part 3 §4, Part 4 §2.1) are the
        // fourth such channel and the one with no `Import` item anywhere in the
        // program to fall back on: a runtime module exports nothing at the
        // Hexagon level, so emission's report is not merely the better answer,
        // it is the only one. A program that touches no `Vector(a)` reports no
        // `VectorTrie.js` and one that touches no `Map(k, v)` reports no
        // `HashTrie.js`.
        ...(module?.javascript.runtimeImports ?? []),
      ].map((specifier) => resolveSpecifier(path, specifier)),
    ];
  };
  const emitted = new Set(
    ordered.filter((path) => !preludeSet.has(path) && !runtimeModuleSet.has(path)),
  );
  const pending = [...emitted];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    for (const target of importsOf(path)) {
      if (emitted.has(target)) continue;
      emitted.add(target);
      pending.push(target);
    }
  }

  const modules = ordered.flatMap((path) => {
    if (!emitted.has(path)) return [];
    const module = compiled.get(path);
    return module === undefined ? [] : [module];
  });

  return {
    modules,
    // Present exactly when some emitted `.d.ts` imports it (FFI Part 1 §8.3
    // obligation 3). A module that was compiled but not emitted writes no file,
    // so its faces are not an importer — which is why this reads the emitted
    // list rather than every module compiled.
    runtimeDeclarations: modules.some(({ declarations }) => declarations.importsRuntimeTypes)
      ? {
          kind: "RuntimeDeclarations",
          path: `${root}/${runtimeBasename}.d.ts`,
          text: runtimeDeclarationsText(),
        }
      : undefined,
    diagnostics: diagnostics.toArray(),
  };
}

/**
 * The basename the runtime declaration module claims at the source common root:
 * the first free of `hex`, `hex1`, `hex2`, … (FFI Part 1 §8.3).
 *
 * §10's probing discipline, lifted from identifiers to filenames: a user module
 * whose own emission claims `hex.js`/`hex.d.ts` **at that root** keeps its name
 * and the generated file moves. The comparison is case-insensitive because
 * case-colliding filesystems exist, and a program that compiled here and
 * overwrote a file there would be the worst possible way to find that out.
 *
 * Only files directly at the root can collide — a deeper module emits into its
 * own directory. The probe runs over every source there, which is a superset of
 * the emitted ones, and the superset is the safe direction: over-claiming only
 * ever moves the generated file, which nothing outside this compile names,
 * while under-claiming would silently overwrite a user's. It costs nothing
 * today, because a source goes unemitted only by being an unreached *injected*
 * module, and those basenames are fixed to `Bool`, `Prelude`, `Option`, `Seq`,
 * `Result`, `Vector`, and `VectorTrie` — never `hex`. Nothing else drops out:
 * `emitted` is seeded with every non-injected path in `ordered`, and `ordered`
 * holds every source, including the members of an import cycle (`visit` returns
 * early only from the re-entrant frame, so the outer one still pushes).
 */
function runtimeDeclarationsBasename(paths: Iterable<string>, root: string): string {
  const claimed = new Set<string>();
  for (const path of paths) {
    const directory = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    if (directory !== root) continue;
    claimed.add(path.slice(path.lastIndexOf("/") + 1).replace(/\.hex$/, "").toLowerCase());
  }
  if (!claimed.has(RUNTIME_DECLARATIONS_STEM)) return RUNTIME_DECLARATIONS_STEM;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${RUNTIME_DECLARATIONS_STEM}${suffix}`;
    if (!claimed.has(candidate)) return candidate;
  }
}

/** Reserved id floor for prelude identities, above any realistic per-project count. */
const PRELUDE_ID_BASE = 1_000_000;

function nextId(ids: readonly number[], fallback: number): number {
  return ids.length === 0 ? fallback : Math.max(fallback, ...ids.map((id) => id + 1));
}

/** One member of the injected list, and which of the two kinds it is. */
interface InjectedModule {
  readonly basename: string;
  readonly source: string;
  readonly runtime: boolean;
}

/**
 * The prelude and runtime module sets as one ordered list, each runtime member
 * taking the seat its `precedes` names.
 *
 * A `precedes` naming no prelude member would silently put the module last,
 * which is the one placement its seat exists to forbid, so it lands at the end
 * only when that is what the list already says. There is no such member today
 * and the conformance test pins the resulting order.
 */
function weaveInjected(
  prelude: readonly { readonly basename: string; readonly source: string }[],
  runtime: readonly {
    readonly basename: string;
    readonly source: string;
    readonly precedes: string;
  }[],
): readonly InjectedModule[] {
  const woven: InjectedModule[] = [];
  for (const member of prelude) {
    for (const module of runtime) {
      if (module.precedes === member.basename) {
        woven.push({ basename: module.basename, source: module.source, runtime: true });
      }
    }
    woven.push({ basename: member.basename, source: member.source, runtime: false });
  }
  const seated = new Set(woven.map(({ basename }) => basename));
  for (const module of runtime) {
    if (seated.has(module.basename)) continue;
    woven.push({ basename: module.basename, source: module.source, runtime: true });
  }
  return woven;
}

/**
 * Where a module finds each runtime module: it *is* one of them, or the
 * specifier that reaches each from here.
 *
 * A project with no path for a runtime module is one with no sources at all,
 * and its (empty) module list needs no runtime; the basename is simply left out
 * and the emitter's same-directory default stands in, so neither side has to
 * hold an extra case.
 */
function runtimesFor(
  path: string,
  pathsByBasename: ReadonlyMap<string, string>,
): RuntimeLocations {
  return new Map(
    [...pathsByBasename].map(([basename, runtimePath]) => [
      basename,
      path === runtimePath
        ? "self" as const
        : { specifier: relativeSpecifier(path, runtimePath) },
    ]),
  );
}

/**
 * Injects each implicit prelude or runtime module at the common root of the
 * project's sources, unless the project already supplies a file there (e.g.
 * compiling the stdlib itself, where the on-disk copy wins). Returns the
 * normalized paths in compilation order; empty for an empty project.
 *
 * `root` is the caller's, not recomputed here: the runtime declaration module
 * is placed at the same root (FFI Part 1 §8.3) and the two must not be able to
 * disagree about where that is.
 *
 * Called once per injected set, in compilation order, so that each set's ids
 * continue from the one before: `maxId` is read from the sources map, which the
 * earlier call has already grown.
 */
function injectEmbedded(
  sources: Map<string, Source.File>,
  root: string,
  modules: readonly { readonly basename: string; readonly source: string }[],
): readonly string[] {
  const paths = [...sources.keys()];
  if (paths.length === 0) return [];
  // Prefer a project file that already provides a prelude module (by basename,
  // wherever it lives — e.g. /stdlib/Option.hex), so the embedded fallback never
  // creates a duplicate that would collide with the project's own declarations.
  const existingByBasename = new Map<string, string>();
  for (const path of paths) {
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (!existingByBasename.has(basename)) existingByBasename.set(basename, path);
  }
  let maxId = Math.max(-1, ...[...sources.values()].map((file) => Number(file.id)));
  return modules.map((module) => {
    const existing = existingByBasename.get(module.basename);
    if (existing !== undefined) return existing;
    const path = normalizePath(`${root}/${module.basename}`);
    maxId += 1;
    sources.set(path, new Source.File(Source.fileId(maxId), path, module.source));
    return path;
  });
}

/**
 * A module's **brand identity** — the string its exceptions carry as `$hex`
 * (`spec/exceptions.md` §7.1, #488).
 *
 * Two rules, and which one applies is settled by how the module is compiled,
 * never by its text:
 *
 * - An **injected** module brands its canonical injected name: its basename with
 *   the extension dropped. `injectEmbedded` seats an injected module at whichever
 *   project file already carries its basename, so the directory is the host's
 *   business and the name is the language's — `stdlib/Vector.hex` and an embedded
 *   `Vector.hex` are one module, `Vector`, and one brand.
 * - Every other module brands its path **relative to the project root**, with
 *   the extension dropped and no leading separator: one module per path, so the
 *   brand is unique by construction and needs no naming rule.
 *
 * **The rendering is canonical, not the host's path text.** Backslashes become
 * forward slashes here as well as in `normalizePath`, so a Windows build and a
 * POSIX build of one project brand identically — the brand is compiled into
 * emitted JavaScript and into `.d.ts` literals a consumer copies, so a
 * separator that varied by build machine would be a real incompatibility, not a
 * cosmetic one. Written at the rendering rather than relied on upstream because
 * this is the rule; `normalizePath` merely happens to agree.
 *
 * The result never begins with `/` or `../`: `root` is `commonRoot`, a prefix of
 * every source path in the program, so the relativization is a plain suffix and
 * has no ascent to express. The non-prefix branch is defensive only.
 *
 * Exported because the identity rule is a *rule* — the same reason
 * `resolveSpecifier` is — and because pinning the canonical rendering means
 * handing it a separator the test platform never produces.
 */
export function moduleBrandIdentity(
  path: string,
  root: string,
  injected: boolean,
): string {
  const canonical = path.replaceAll("\\", "/");
  if (injected) {
    return canonical.slice(canonical.lastIndexOf("/") + 1).replace(/\.hex$/u, "");
  }
  const canonicalRoot = root.replaceAll("\\", "/");
  const relative = canonicalRoot !== "" && canonical.startsWith(`${canonicalRoot}/`)
    ? canonical.slice(canonicalRoot.length + 1)
    : canonical;
  return relative.replace(/^\//u, "").replace(/\.hex$/u, "");
}

/** Longest shared directory prefix of the given file paths. */
function commonRoot(paths: readonly string[]): string {
  const directories = paths.map((path) => path.split("/").slice(0, -1));
  let common = directories[0] ?? [];
  for (const parts of directories.slice(1)) {
    let index = 0;
    while (index < common.length && index < parts.length && common[index] === parts[index]) {
      index += 1;
    }
    common = common.slice(0, index);
  }
  return common.join("/");
}

/**
 * The path an import specifier names, from the module that wrote it.
 *
 * Exported because it is a rule about the module graph rather than a detail of
 * compiling one: an editor asking which module a name was imported from has to
 * answer it the same way the compiler did, and a second copy that drifted would
 * be wrong only for the imports it disagreed about.
 */
export function resolveSpecifier(importer: string, specifier: string): string {
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const candidate = normalizePath(`${directory}/${specifier}`);
  return candidate.endsWith(".hex") ? candidate : `${candidate}.hex`;
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
