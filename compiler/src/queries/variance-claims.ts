/**
 * The editor's side of declared variance (closure doc
 * `decisions-ml-dialect-generalization-2026-08.md` §8.2, §11.3).
 *
 * Hexagon has no warning tier (Preamble §1.1), and an under-claim is not wrong —
 * it is the empty claim, chosen or not. So the affordance lives here rather than
 * in the checker: an offer on the declaration when the representation supports a
 * claim the author has not made, and a hover that shows both facts at once.
 *
 * Both read the same computed variance §6.3's verification uses; nothing
 * downstream of the checker recomputes it.
 */

import type * as Source from "../support/source.js";
import type * as Typed from "../syntax/typed/index.js";

export interface ParameterSite {
  /** The declaration's name, for the message. */
  readonly declaration: string;
  readonly parameter: Typed.ParameterVariance;
  readonly span: Source.Span;
  /** The whole parameter list as it would read with the claim written. */
  readonly claimed: string;
}

/**
 * Every parameterized `export opaque` declaration *written in this file* whose
 * parameters have spans. Imported declarations are excluded by the file check:
 * their heads live in a stranger's source, and neither an edit nor a hover here
 * may be about a span in another file.
 *
 * Exported because a host that opens the hover by itself has to know where the
 * hover would answer before the caret is there; `siteAt` answers one offset, and
 * this is the set it searches.
 */
export function parameterSites(
  typed: Typed.Module,
  fileId: Source.FileId,
): readonly ParameterSite[] {
  const found: ParameterSite[] = [];
  const declarations: readonly {
    readonly name: string;
    readonly opaque: boolean;
    readonly variance: readonly Typed.ParameterVariance[];
  }[] = [...typed.unions, ...typed.records];
  for (const declaration of declarations) {
    if (!declaration.opaque) continue;
    for (const parameter of declaration.variance) {
      const span = parameter.span;
      if (span === undefined || span.fileId !== fileId) continue;
      found.push({
        declaration: declaration.name,
        parameter,
        span,
        claimed: declaration.variance
          .map((other) =>
            other.name === parameter.name
              ? `${parameter.computed === "co" ? "+" : "-"}${other.name}`
              : claimText(other)
          )
          .join(", "),
      });
    }
  }
  return found;
}

function claimText(parameter: Typed.ParameterVariance): string {
  if (parameter.declared === "co") return `+${parameter.name}`;
  if (parameter.declared === "contra") return `-${parameter.name}`;
  return parameter.name;
}

/**
 * The declarations this file could claim variance on and has not.
 *
 * Offered only when the representation actually supports a claim — a parameter
 * whose computed variance is invariant has nothing to declare, and one that is
 * *unused* has nothing worth declaring either, since no client behaviour turns
 * on it.
 */
export function underClaims(
  typed: Typed.Module,
  fileId: Source.FileId,
  touches: (span: Source.Span) => boolean,
): readonly ParameterSite[] {
  return parameterSites(typed, fileId).filter((site) =>
    site.parameter.declared === undefined &&
    (site.parameter.computed === "co" || site.parameter.computed === "contra") &&
    touches(site.span)
  );
}

/** The site a cursor is on, for hover. */
export function siteAt(
  typed: Typed.Module,
  fileId: Source.FileId,
  offset: number,
): ParameterSite | undefined {
  return parameterSites(typed, fileId).find(
    ({ span }) => offset >= span.start.offset && offset <= span.end.offset,
  );
}

/**
 * §8.2's offer, phrased in consequences rather than lattice vocabulary: what the
 * author gets is client code that stays polymorphic, and that is what the title
 * says.
 */
export function underClaimTitle(site: ParameterSite): string {
  const direction = site.parameter.computed === "co" ? "produces" : "consumes";
  return `Declare \`${site.declaration}(${site.claimed})\` — \`${site.declaration}\` only ` +
    `${direction} \`${site.parameter.name}\`, so a client binding can stay polymorphic`;
}

/** The two facts hover shows about a parameterized opaque type's parameter. */
export function varianceHover(site: ParameterSite): string {
  const declared = site.parameter.declared === undefined
    ? "no claim (bare, so invariant outside this module)"
    : site.parameter.declared === "co"
      ? "covariant (`+`)"
      : "contravariant (`-`)";
  const computed = {
    unused: "unused — the representation never mentions it",
    co: "covariant",
    contra: "contravariant",
    inv: "invariant",
  }[site.parameter.computed];
  return `Type parameter \`${site.parameter.name}\` of \`${site.declaration}\`\n\n` +
    `- **Declared:** ${declared}\n` +
    `- **Representation:** ${computed}`;
}
