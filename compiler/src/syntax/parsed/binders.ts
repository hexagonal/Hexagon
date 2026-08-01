/**
 * The names a parsed pattern binds, in source order.
 *
 * Two passes need this and neither owns it: the resolver, to declare a
 * destructuring `let`'s binders, and the parser, to say which names a doc block
 * over one documents (`spec/doc-comments.md` §4.2). A second copy is the kind
 * that falls behind — a pattern form added to the tree and handled in one of
 * them — so the walk lives with the tree it walks.
 */

import type { Name, Pattern } from "./tree.js";

export function patternNames(pattern: Pattern): readonly Name[] {
  switch (pattern.kind) {
    case "Binding":
      return [pattern.name];
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return [];
    case "As":
      return [...patternNames(pattern.pattern), pattern.name];
    case "Or":
      // Every alternative binds the same names, so the first one answers for
      // all of them; taking the union would report each name once per arm.
      return pattern.alternatives[0] === undefined
        ? []
        : patternNames(pattern.alternatives[0]);
    case "Tuple":
    case "Vector":
      return [
        ...pattern.elements.flatMap(patternNames),
        ...(pattern.kind === "Vector" && pattern.rest?.pattern !== undefined
          ? patternNames(pattern.rest.pattern)
          : []),
      ];
    case "Record":
      return pattern.fields.flatMap((field) => patternNames(field.pattern));
    case "Constructor":
      return pattern.arguments.flatMap(patternNames);
  }
}
