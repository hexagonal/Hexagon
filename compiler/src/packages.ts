/**
 * Packages, and the resolution of a written module name in one (`spec/packages.md`).
 *
 * A package is a named set of modules (§1); the project is the root package and
 * may have no name (§2.5); the standard library is `Hex` (§2.4). This file holds
 * the parts of that design the *language* needs — full names, the visible set,
 * and what `import Geometry` means — and none of the parts the *host* owns:
 * nothing here reads a manifest, a `node_modules` directory, or a file. The
 * package set arrives assembled (Packages §4.1) and this module answers over it.
 *
 * That split is what keeps `project.ts` filesystem-free while leaving the host
 * layer additive: widening the set from `{project, Hex}` to a real dependency
 * closure changes the *input* to these functions and none of their rules.
 */

import type * as Source from "./support/source.js";

/** The standard library's package name (Packages §2.4). */
export const STANDARD_LIBRARY = "Hex";

/**
 * A package in the program (Packages §3.1) — the project, `Hex`, or a member of
 * the transitive `dependencies` closure.
 *
 * `name` is absent for an **unnamed project** (§2.5), the one package whose
 * modules' full names carry no package segment.
 */
export interface ProgramPackage {
  readonly name: string | undefined;
  /** The packages this one's imports may name, by name (Packages §3.1). */
  readonly dependencies: readonly string[];
}

/** A module of some package in the program, addressed by its declared name. */
export interface ProgramModule {
  /** The declaring package's name, absent for an unnamed project's module. */
  readonly packageName: string | undefined;
  /** The name the header declared — `Option`, `Render.Geometry` (Modules §2.1). */
  readonly declaredName: string;
  /** The package's name, a dot, and the declared name (Packages §2.3). */
  readonly fullName: string;
}

/**
 * A module's **full name** (Packages §2.3): the package's name, a dot, and the
 * declared name. A module of a project with no `name` has its declared name as
 * its full name — the one case with no package segment.
 */
export function fullModuleName(
  packageName: string | undefined,
  declaredName: string,
): string {
  return packageName === undefined ? declaredName : `${packageName}.${declaredName}`;
}

/**
 * The **canonical layout path** of a module — its full name as a path (Packages
 * §6): the project's modules at the output root by their declared names, dotted
 * segments as directories, every other package's under a directory named by the
 * package.
 *
 * This is the compiler's internal address for a module, and deliberately so.
 * Modules §11's emitted layout *is* the full name as a path, so the specifier
 * arithmetic every emission already does — `relativeSpecifier` from one module
 * to another — computes exactly the specifier §11.2 demands, with no second
 * rule beside it. Nothing reads a **source** path to answer a question about a
 * module; a source file's own name and place appear nowhere in the output.
 *
 * `projectName` is the **resolving project's** name, where it declared one, and
 * its package segment is elided from the layout — "*with the project's package
 * segment elided because a project may have none*" (§6). The full name (§2.3)
 * is untouched by that: `Acme.Main` is still the module's identity and still
 * its brand, and only the address it emits under drops the segment, so a
 * project that gains a `name` moves no file and changes no specifier.
 */
export function moduleLayoutPath(fullName: string, projectName?: string): string {
  const laid = projectName !== undefined && fullName.startsWith(`${projectName}.`)
    ? fullName.slice(projectName.length + 1)
    : fullName;
  return `/${laid.replaceAll(".", "/")}.hex`;
}

/** The full name a layout path spells, `moduleLayoutPath` read backwards. */
export function moduleNameOfLayoutPath(path: string): string {
  return path.replace(/^\//u, "").replace(/\.hex$/u, "").replaceAll("/", ".");
}

/**
 * A module's name **as a reader knows it** — the full name, with `Hex.`
 * dropped: Modules §7.6 names a prelude home "by its bare name as the reader
 * knows it (`Ord`, not `Hex.Ord`)", and the prelude is in scope under exactly
 * that spelling (Packages §2.4).
 */
export function displayModuleName(fullName: string): string {
  return fullName.startsWith(`${STANDARD_LIBRARY}.`)
    ? fullName.slice(STANDARD_LIBRARY.length + 1)
    : fullName;
}

/** The `import` line that binds `fullName` under the alias `alias`. */
export function moduleImportLine(fullName: string, alias?: string): string {
  const name = displayModuleName(fullName);
  return alias === undefined || alias === name.split(".").at(-1)
    ? `import ${name}`
    : `import ${name} as ${alias}`;
}

/** How a written module name failed to resolve (Packages §3.3, §7). */
export type ModuleResolution =
  | { readonly kind: "Resolved"; readonly module: ProgramModule }
  | {
    /** Two or more visible packages provide the written name (Packages §3.3). */
    readonly kind: "Contested";
    readonly providers: readonly ProgramModule[];
  }
  | {
    /** A package qualifying its own module (Packages §3.3, §2.5). */
    readonly kind: "SelfQualified";
    readonly declaredName: string;
  }
  | {
    /**
     * The first segment names a package the resolving one does not list
     * (Packages §7) — deferred in the first host slice, where no installed
     * package set exists to check the name against.
     */
    readonly kind: "NotADependency";
    readonly packageName: string;
  }
  | { readonly kind: "Unknown"; readonly nearMisses: readonly string[] };

/** The modules of the program, indexed the two ways resolution reads them. */
export interface ModuleIndex {
  /** Every module of every package in the program, by full name. */
  readonly byFullName: ReadonlyMap<string, ProgramModule>;
  /** Every package in the program, by name; the project is keyed by `undefined`. */
  readonly packages: readonly ProgramPackage[];
}

/**
 * Which packages a module of `resolving` may name (Packages §3.1): its own,
 * `Hex`, and every package its manifest lists. Nothing else — a dependency's
 * own dependencies are invisible even though their modules may be in the
 * program.
 */
export function visiblePackages(resolving: ProgramPackage): readonly (string | undefined)[] {
  return [resolving.name, STANDARD_LIBRARY, ...resolving.dependencies].filter(
    (name, index, all) => all.indexOf(name) === index,
  );
}

/**
 * Resolves one written module name for a module of `resolving` (Packages §3.4;
 * Modules §2.3).
 *
 * The order is the spec's, and each step is a refusal or an answer, never a
 * rank: the resolving package's own module wins silently (§3.2); a dotted
 * spelling whose first segment names a *visible other* package is that
 * package's module by its full name, the one reading of the spelling (§3.3);
 * otherwise exactly one visible package must provide the declared name, two
 * being the contest refusal and none the unknown-module report.
 */
export function resolveModuleName(
  written: string,
  resolving: ProgramPackage,
  index: ModuleIndex,
  installedPackages: ReadonlySet<string> = new Set(),
): ModuleResolution {
  const visible = visiblePackages(resolving);
  // §3.2: the resolving package's own module wins, silently.
  const own = index.byFullName.get(fullModuleName(resolving.name, written));
  if (own !== undefined) return { kind: "Resolved", module: own };

  const segments = written.split(".");
  if (segments.length > 1) {
    const head = segments[0]!;
    // §3.3: a package never qualifies its own modules.
    if (head === resolving.name) {
      return { kind: "SelfQualified", declaredName: segments.slice(1).join(".") };
    }
    if (visible.includes(head)) {
      const qualified = index.byFullName.get(written);
      if (qualified !== undefined) return { kind: "Resolved", module: qualified };
    }
  }
  // Otherwise the spelling is a *declared* name, sought in every visible package.
  const providers = visible.flatMap((packageName) => {
    const module = index.byFullName.get(fullModuleName(packageName, written));
    return module === undefined ? [] : [module];
  });
  if (providers.length === 1) return { kind: "Resolved", module: providers[0]! };
  if (providers.length > 1) return { kind: "Contested", providers };
  if (segments.length > 1) {
    const head = segments[0]!;
    // §3.3's proviso: the manifest edit is withheld where a module of any
    // package in the program — imported or not — is declared under that
    // segment, because applying it would refuse that module (Modules §2.2).
    const shadowed = [...index.byFullName.values()].some(
      ({ declaredName }) => declaredName.split(".")[0] === head,
    );
    if (installedPackages.has(head) && !visible.includes(head) && !shadowed) {
      return { kind: "NotADependency", packageName: head };
    }
  }
  return { kind: "Unknown", nearMisses: nearMisses(written, resolving, index) };
}

/**
 * The near misses an unknown module name draws (Modules §2.3, §10): the visible
 * modules whose declared name **ends in** the written one included, "since that
 * is the miss this rule invites".
 */
function nearMisses(
  written: string,
  resolving: ProgramPackage,
  index: ModuleIndex,
): readonly string[] {
  const visible = new Set(visiblePackages(resolving));
  const candidates = [...index.byFullName.values()].filter(({ packageName }) =>
    visible.has(packageName)
  );
  const suffix = candidates
    .filter(({ declaredName }) => declaredName.endsWith(`.${written}`))
    .map(({ declaredName }) => declaredName);
  if (suffix.length > 0) return suffix;
  const lowered = written.toLowerCase();
  return candidates
    .filter(({ declaredName }) =>
      declaredName !== written && declaredName.toLowerCase() === lowered
    )
    .map(({ declaredName }) => declaredName);
}

/**
 * Modules §2.2's **first-segment rule**, at the header seat: a dotted module's
 * first segment never names a package in the program.
 *
 * Read as a function of the package **set**, which is what makes the two seats
 * one rule and the host layer additive: widening the set from `{project, Hex}`
 * to a dependency closure widens what this refuses and changes nothing else.
 * Answers the offending package name, or `undefined` where the name is lawful.
 */
export function firstSegmentPackage(
  declaredName: string,
  packageNames: ReadonlySet<string>,
): string | undefined {
  const segments = declaredName.split(".");
  if (segments.length < 2) return undefined;
  return packageNames.has(segments[0]!) ? segments[0]! : undefined;
}

/** Packages §2.1: one uppercase-start identifier, and no dots. */
const PACKAGE_NAME = /^[A-Z][A-Za-z0-9_]*$/u;

/**
 * Packages §2.1's shape refusal, with §7's dotted clause where the spelling is
 * dotted: dots are the *module* name's, and a reader who wrote `"Acme.Tools"`
 * meant a namespace, so the sentence names the form that has one rather than
 * leaving them to read the shape rule twice.
 */
function packageNameShapeRefusal(name: string): string {
  return "a package name is one uppercase-start identifier: write `\"Acme\"`" +
    (name.includes(".") ? " — a module's name is where dots belong" : "");
}

/**
 * Packages §2.1's manifest `name` rule: one uppercase-start identifier, not
 * dotted, and never `Hex`. Answers the refusal, or `undefined` where lawful.
 */
export function packageNameRefusal(name: string): string | undefined {
  if (name === STANDARD_LIBRARY) return "`Hex` is the standard library's package name";
  if (!PACKAGE_NAME.test(name)) return packageNameShapeRefusal(name);
  return undefined;
}

/**
 * Packages §2.4: `Hex` is every package's dependency and is never listed; §4.4:
 * an npm package with no manifest is a JavaScript package, bound with `extern`.
 *
 * The two refusals are told apart by the *shape* of the entry, not by one test
 * standing in for both: an uppercase-start spelling is a package name written
 * wrong (§2.1) — `"Acme.Tools"` is the module-name form in a package-name seat
 * — and sending its author to `extern from "Acme.Tools"` would name a
 * JavaScript module that cannot exist. Only a spelling no package name could
 * ever take is read as npm's.
 */
export function dependencyRefusal(name: string): string | undefined {
  if (name === STANDARD_LIBRARY) return "`Hex` is every package's dependency; remove the entry";
  if (PACKAGE_NAME.test(name)) return undefined;
  if (/^[A-Z]/u.test(name)) return packageNameShapeRefusal(name);
  return `\`${name}\` is not a Hexagon package: bind it with \`extern from "${name}"\``;
}

/** Where a module's text is, for the reports that must send a reader to it. */
export interface ModuleSite {
  readonly path: string;
  readonly span: Source.Span;
}
