import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import {
  faceOnlyEditionInstances,
  planFundamentalSpecializations,
  sourceInstanceDictionary,
  specializeItem,
  type FundamentalSpecialization,
  type FundamentalType,
  type SpecializableItem,
} from "../passes/emitter/specializations.js";
import type * as Core from "../syntax/core/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import type * as Typed from "../syntax/typed/index.js";

/**
 * Conformance for what an edition's substituted dictionary parameter *becomes*
 * (issue #679, leg 1).
 *
 * `specializeBody` used to answer that question from the assignment alone: the
 * five primitive fundamentals got `Primitive` evidence, `Bool` and `Unit` got
 * `Structural` evidence, unconditionally. Both answers are the compiler's own
 * wiring — `Primitive` resolves to a *companion module's* exported dictionary
 * (#344), and `Structural` renders one of the four walks the compiler derives —
 * so both are right for a pre-registered constraint and wrong for every
 * constraint a module declares. Measured, with the planner's support table
 * experimentally taught to admit a `Describe` at `Int`/`String` and a `Mark` at
 * `Bool`:
 *
 * - at a primitive, an ICE per edition — "compiler defect: `Describe<Int>` is a
 *   source instance of a migrated primitive companion, but no dictionary for it
 *   reached this module" — with `undefined.describe(x)` in the emitted body and
 *   the correct `__Describe_Int` sitting unused at the top of the same file;
 * - at `Bool`, **silence**: zero diagnostics, `const __Mark_Bool_1 = ({})`, and
 *   the edition calling `.mark` on that empty literal while the real
 *   `__Mark_Bool` went unread. The #675 failure shape from a different cause.
 *
 * The repair reads the *constraint* as well as the type. A pre-registered
 * identity keeps both wired answers exactly; anything else is a constraint some
 * module declared, and its evidence is the ordinary instance row — the
 * dictionary a source `honor` at that fundamental exports, found by identity
 * across the three channels an instance reaches a module by.
 *
 * Zero-Cost Fundamental Exports §3.2's judgment at `Unit` and `Bool` is what
 * makes the split normative rather than convenient: `Bool` is an ordinary
 * instance head for a declared constraint, honored in the constraint's own
 * module like every non-`Unit` fundamental, while `Unit` is never among a
 * declared constraint's candidates at all.
 *
 * ## Why this file is unit-shaped
 *
 * `fundamentalSupports` is **untouched** by leg 1: it admits pre-registered
 * names only, so no program can reach the repaired arm end to end yet — leg 2
 * replaces the table with the derived judgment and is what makes it reachable.
 * The last `describe` block pins that untouchedness rather than assuming it, and
 * everything above drives `specializeItem` and `sourceInstanceDictionary`
 * directly, over Core trees a real compile produced.
 */

/** The compiled `/main.hex` of a project asserted to have reported nothing. */
function core(files: readonly (readonly [string, string])[]): Core.Module {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === "/main.hex")!.core;
}

function boolUnion(module: Core.Module): Resolved.UnionId | undefined {
  return module.preludeUnions.get("Bool");
}

/** The named exported `fun`, and the constrained variable its editions assign. */
function constrainedItem(
  module: Core.Module,
  name: string,
): {
  readonly item: SpecializableItem;
  readonly variable: Typed.TypeVariableId;
  readonly constraint: Typed.Constraint;
} {
  const item = module.items.find(
    (candidate): candidate is Core.FunItem =>
      candidate.kind === "Fun" && candidate.binding.name === name,
  );
  expect(item, `no \`fun ${name}\` in the module`).toBeDefined();
  const constraint = item!.binding.scheme.constraints[0];
  expect(constraint?.type.kind).toBe("Variable");
  return {
    item: item!,
    variable: (constraint!.type as Typed.VariableType).id,
    constraint: constraint!,
  };
}

/**
 * One edition of that item, assembled here rather than planned.
 *
 * The shipping table admits no declared constraint, so `planFundamentalSpecializations`
 * yields nothing for the programs below and cannot supply the subject. Only the
 * assignment reaches `specializeBody`; the scheme rides along for the face,
 * which nothing here reads.
 */
function edition(
  item: SpecializableItem,
  variable: Typed.TypeVariableId,
  type: FundamentalType,
): FundamentalSpecialization {
  return {
    sourceSymbol: item.binding.symbol,
    sourceName: item.binding.name,
    sourceExported: true,
    name: `${item.binding.name}${type}`,
    assignment: [{ variable, type }],
    scheme: item.binding.scheme,
  };
}

/** Every evidence node in a specialized body, by the field each kind requires. */
function evidenceNodes(value: unknown): readonly Core.Evidence[] {
  const found: Core.Evidence[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const element of node) visit(element);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const candidate = node as Record<string, unknown>;
    // Keyed on a required field as well as the tag, because `Typed.Type` shares
    // two of these tags: a primitive *type* is `{ kind: "Primitive", name }` and
    // a primitive *dictionary* is `{ kind: "Primitive", instance }`.
    if (
      (candidate.kind === "Primitive" && "instance" in candidate) ||
      (candidate.kind === "Instance" && "dictionary" in candidate) ||
      (candidate.kind === "Structural" && "components" in candidate) ||
      (candidate.kind === "Dictionary" && "variable" in candidate)
    ) {
      found.push(node as Core.Evidence);
    }
    for (const nested of Object.values(candidate)) visit(nested);
  };
  visit(value);
  return found;
}

/** A resolver over one module's real instances, plus a log of what it was asked. */
function resolver(module: Core.Module): {
  readonly instances: (identity: string, type: FundamentalType) => string | undefined;
  readonly asked: { identity: string; type: FundamentalType }[];
} {
  const asked: { identity: string; type: FundamentalType }[] = [];
  return {
    asked,
    instances: (identity, type) => {
      asked.push({ identity, type });
      return sourceInstanceDictionary(module, identity, type, boolUnion(module));
    },
  };
}

/** A module declaring two constraints and honoring them at `Int` and at `Bool`. */
const declaredConstraints = [
  "constraint Describe<a> =",
  "    describe(subject: a): String",
  "",
  "honor Describe<Int> =",
  "    describe(n) = \"int ${n}\"",
  "",
  "constraint Mark<a> =",
  "    mark(subject: a): String",
  "",
  "honor Mark<Bool> =",
  "    mark(b) = if b then \"yes\" else \"no\"",
  "",
  "export fun tell<a: Describe>(x: a): String = describe(x)",
  "export fun tag<a: Mark>(x: a): String = mark(x)",
  "export fun render<a: Show>(x: a): String = \"${x}\"",
  "",
].join("\n");

describe("a declared constraint's edition names its instance's dictionary", () => {
  test("at a primitive, where `Primitive` evidence used to ICE", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { item, variable, constraint } = constrainedItem(module, "tell");
    const { instances, asked } = resolver(module);

    const specialized = specializeItem(
      item,
      edition(item, variable, "Int"),
      boolUnion(module),
      instances,
    );

    expect(asked).toEqual([{ identity: constraint.identity, type: "Int" }]);
    expect(evidenceNodes(specialized.value)).toEqual([
      {
        kind: "Instance",
        dictionary: "__Describe_Int",
        arguments: [],
        // The tag a ground site's evidence carries at a primitive head, so an
        // edition calling another specializable function routes to *its* edition.
        primitive: "Int",
      },
    ]);
  });

  test("at `Bool`, where `Structural` evidence used to fail silently", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { item, variable, constraint } = constrainedItem(module, "tag");
    const { instances, asked } = resolver(module);

    const specialized = specializeItem(
      item,
      edition(item, variable, "Bool"),
      boolUnion(module),
      instances,
    );

    expect(asked).toEqual([{ identity: constraint.identity, type: "Bool" }]);
    // No `primitive` tag: `Bool` is a prelude union and names no primitive to
    // stamp, exactly as a ground site's `Instance` evidence for it carries none.
    expect(evidenceNodes(specialized.value)).toEqual([
      { kind: "Instance", dictionary: "__Mark_Bool", arguments: [] },
    ]);
  });

  test("nothing is invented where the instance is missing", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { item, variable } = constrainedItem(module, "tell");
    // `Nat` is the case leg 2's derived judgment will never offer and a
    // hand-written table could: no `Describe<Nat>` is declared anywhere.
    const specialized = specializeItem(
      item,
      edition(item, variable, "Nat"),
      boolUnion(module),
      () => undefined,
    );

    // The dictionary parameter is gone — an edition takes none — and no
    // instance was conjured to stand in for the one that does not exist. The
    // emitter's own resolver reports a compiler defect before answering this
    // way; `Error` evidence is what elaboration already writes for a
    // requirement someone else has reported.
    expect(evidenceNodes(specialized.value)).toEqual([]);
  });
});

describe("a pre-registered constraint's edition is unmoved", () => {
  test("`Show` at a primitive stays `Primitive` evidence, and asks nothing", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { item, variable } = constrainedItem(module, "render");
    const { instances, asked } = resolver(module);

    const specialized = specializeItem(
      item,
      edition(item, variable, "String"),
      boolUnion(module),
      instances,
    );

    expect(asked).toEqual([]);
    expect(evidenceNodes(specialized.value)).toEqual([
      { kind: "Primitive", instance: "String" },
    ]);
  });

  test("`Show` at `Bool` stays the derived walk over the prelude union", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { item, variable } = constrainedItem(module, "render");
    const { instances, asked } = resolver(module);

    const specialized = specializeItem(
      item,
      edition(item, variable, "Bool"),
      boolUnion(module),
      instances,
    );

    expect(asked).toEqual([]);
    expect(evidenceNodes(specialized.value)).toEqual([
      {
        kind: "Structural",
        type: { kind: "Union", union: boolUnion(module), name: "Bool", arguments: [] },
        components: [],
      },
    ]);
  });

  test("`Show` at `Unit` stays the automatic tuple instance at arity 0", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { item, variable } = constrainedItem(module, "render");
    const { instances, asked } = resolver(module);

    const specialized = specializeItem(
      item,
      edition(item, variable, "Unit"),
      boolUnion(module),
      instances,
    );

    expect(asked).toEqual([]);
    expect(evidenceNodes(specialized.value)).toEqual([
      { kind: "Structural", type: { kind: "Tuple", elements: [] }, components: [] },
    ]);
  });

  test("the face emitters resolve nothing, and their bodies are dead anyway", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { item, variable } = constrainedItem(module, "tell");

    const specialized = specializeItem(
      item,
      edition(item, variable, "Int"),
      boolUnion(module),
      faceOnlyEditionInstances,
    );

    // What the `.d.ts` and preview emitters read: the substituted scheme and the
    // lambda's parameters. Nothing under them is rendered, so nothing under them
    // is resolved.
    expect(specialized.binding.name).toBe("tellInt");
    expect(evidenceNodes(specialized.value)).toEqual([]);
  });
});

/** A module whose exported constraint is honored at `Int` and at `String`. */
const describeModule = [
  "export constraint Describe<a> =",
  "    describe(subject: a): String",
  "",
  "honor Describe<Int> =",
  "    describe(n) = \"int ${n}\"",
  "",
  "honor Describe<String> =",
  "    describe(s) = \"string ${s}\"",
  "",
].join("\n");

describe("the lookup walks all three channels, keyed on identity", () => {
  test("this module's own `honor` items", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { constraint } = constrainedItem(module, "tell");

    expect(sourceInstanceDictionary(module, constraint.identity, "Int", boolUnion(module)))
      .toBe("__Describe_Int");
  });

  test("`Bool` matches on the union's identity, never its name", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { constraint } = constrainedItem(module, "tag");

    expect(sourceInstanceDictionary(module, constraint.identity, "Bool", boolUnion(module)))
      .toBe("__Mark_Bool");
    // With no pin to compare against, the union subject answers nothing rather
    // than answering by spelling — the discipline `#groundFundamental` follows.
    expect(sourceInstanceDictionary(module, constraint.identity, "Bool", undefined))
      .toBeUndefined();
  });

  test("the prelude's, for a pre-registered constraint at a companion", () => {
    const module = core([["/main.hex", declaredConstraints]]);

    expect(sourceInstanceDictionary(module, "hex:Show", "Int", boolUnion(module)))
      .toBe("__Show_Int");
  });

  test.each([
    ["a bare-spelling named import", [
      "import { Describe } from \"./describe\"",
      "",
      "export fun tell<a: Describe>(x: a): String = describe(x)",
      "",
    ]],
    ["a qualified `import module`", [
      "import module Describe from \"./describe\"",
      "",
      "export fun tell<a: Describe.Describe>(x: a): String = Describe.describe(x)",
      "",
    ]],
    ["an aliased named import", [
      "import { Describe as Portray } from \"./describe\"",
      "",
      "export fun tell<a: Portray>(x: a): String = describe(x)",
      "",
    ]],
  ])("an import's instances: %s", (_label, lines) => {
    const module = core([
      ["/describe.hex", describeModule],
      ["/main.hex", lines.join("\n")],
    ]);
    const { constraint } = constrainedItem(module, "tell");

    // The spelling the consumer wrote is not the key and cannot be: all three
    // reach one declaration, and the third does not spell its name at all.
    expect(constraint.identity).toBe("0:Describe");
    expect(sourceInstanceDictionary(module, constraint.identity, "Int", boolUnion(module)))
      .toBe("__Describe_Int");
    expect(sourceInstanceDictionary(module, constraint.identity, "String", boolUnion(module)))
      .toBe("__Describe_String");
  });

  test("two same-named constraints answer separately (§5.1.1)", () => {
    const module = core([
      ["/describe.hex", describeModule],
      ["/portray.hex", [
        "export constraint Describe<a> =",
        "    portray(value: a): String",
        "",
        "honor Describe<Int> =",
        "    portray(count) = \"counted ${count}\"",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Describe } from \"./describe\"",
        "import module Portray from \"./portray\"",
        "",
        "export fun tell<a: Describe>(x: a): String = describe(x)",
        "export fun other<a: Portray.Describe>(x: a): String = Portray.portray(x)",
        "",
      ].join("\n")],
    ]);
    const described = constrainedItem(module, "tell").constraint;
    const portrayed = constrainedItem(module, "other").constraint;

    // One name, two declarations, two dictionaries. A name-keyed lookup answers
    // whichever it met first for both, which is one dictionary standing in for
    // two unrelated constraints. The spellings themselves are the resolver's,
    // separated by #425's collision-only suffix and not pinned here; that they
    // are two is the property.
    expect(described.name).toBe(portrayed.name);
    expect(described.identity).not.toBe(portrayed.identity);
    const bool = boolUnion(module);
    const first = sourceInstanceDictionary(module, described.identity, "Int", bool);
    const second = sourceInstanceDictionary(module, portrayed.identity, "Int", bool);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  test("`Unit` answers nothing: no `honor` at the empty tuple is writable", () => {
    const module = core([["/main.hex", declaredConstraints]]);
    const { constraint } = constrainedItem(module, "tell");

    // Zero-Cost Fundamental Exports §3.2's judgment at `Unit`: instances key on
    // type constructors and the empty tuple has neither a constructor name nor
    // a home module, so a declared constraint never has `Unit` among its
    // candidates and its lawful instances are the automatic structural ones.
    expect(sourceInstanceDictionary(module, constraint.identity, "Unit", boolUnion(module)))
      .toBeUndefined();
    expect(sourceInstanceDictionary(module, "hex:Show", "Unit", boolUnion(module)))
      .toBeUndefined();
  });
});

describe("leg 1 leaves the planner's support table where it was", () => {
  test("a declared constraint's binder still mints no editions", () => {
    const module = core([["/main.hex", declaredConstraints]]);

    const planned = planFundamentalSpecializations(module).specializations;

    // The repair above is unreachable end to end until leg 2 replaces
    // `fundamentalSupports` with §3.2's instance judgment. `render`'s `Show`
    // binder mints its seven; `tell` and `tag` mint none, because the table
    // holds no row a declared constraint's name could match.
    expect(planned.map(({ name }) => name).sort()).toEqual([
      "renderBigInt",
      "renderBool",
      "renderFloat",
      "renderInt",
      "renderNat",
      "renderString",
      "renderUnit",
    ]);
  });
});
