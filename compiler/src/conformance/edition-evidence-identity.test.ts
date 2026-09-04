import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import {
  faceOnlyEditionInstances,
  fundamentalInstancesOf,
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
 * ## Two legs, one file
 *
 * Leg 1 landed the repair while `fundamentalSupports` — the hand table deciding
 * which fundamentals honor which constraint — still admitted pre-registered
 * names only, so no program could reach the repaired arm and the rows below are
 * unit-shaped: they drive `specializeItem` and `sourceInstanceDictionary`
 * directly, over Core trees a real compile produced.
 *
 * Leg 2 retired that table for §3.2's own judgment, and the last two blocks are
 * what that added: the repaired arm reached end to end by an ordinary program,
 * and the defect report that guards the judgment's one obligation.
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
 * Assembled because the rows below ask what `specializeBody` does at an
 * assignment, including assignments the plan would never offer — `Describe` at
 * `Nat`, where the point is that nothing is invented. Only the assignment
 * reaches the walk; the scheme rides along for the face, which nothing here
 * reads.
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

/**
 * What now stands where each dictionary parameter over `variable` stood.
 *
 * Read by walking the generic and the specialized body in step rather than by
 * collecting nodes out of the specialized one, because the answer under test is
 * sometimes `{ kind: "Error" }` and that shape is unrecognizable on its own: a
 * `Typed.ErrorType` is spelled identically, so a collector keyed on the tag
 * would either miss the seat or claim seats that are not evidence. The two
 * bodies agree in shape everywhere except the seats this substitutes, so the
 * position *is* the discriminator.
 */
function replacedDictionaries(
  generic: unknown,
  specialized: unknown,
  variable: Typed.TypeVariableId,
): readonly unknown[] {
  const found: unknown[] = [];
  const visit = (left: unknown, right: unknown): void => {
    if (Array.isArray(left)) {
      if (!Array.isArray(right)) return;
      left.forEach((element, index) => visit(element, right[index]));
      return;
    }
    if (left === null || typeof left !== "object") return;
    const node = left as Record<string, unknown>;
    if (node.kind === "Dictionary" && node.variable === variable) {
      found.push(right);
      return;
    }
    if (right === null || typeof right !== "object") return;
    const other = right as Record<string, unknown>;
    for (const [key, nested] of Object.entries(node)) visit(nested, other[key]);
  };
  visit(generic, specialized);
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
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
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
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
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
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
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
    expect(replacedDictionaries(item.value, specialized.value, variable))
      .toEqual([{ kind: "Error" }]);
    expect(evidenceNodes(specialized.value)).toEqual([]);
  });
});

describe("the face emitters resolve nothing", () => {
  test("`faceOnlyEditionInstances` answers as a declining resolver does", () => {
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
    const { item, variable } = constrainedItem(module, "tell");

    const specialized = specializeItem(
      item,
      edition(item, variable, "Int"),
      boolUnion(module),
      faceOnlyEditionInstances,
    );

    // What the `.d.ts` and preview emitters read is the substituted scheme and
    // the lambda's parameters; nothing under them is rendered, so nothing under
    // them is resolved — and nothing is invented in place of what was not.
    expect(replacedDictionaries(item.value, specialized.value, variable))
      .toEqual([{ kind: "Error" }]);
    expect(evidenceNodes(specialized.value)).toEqual([]);
  });
});

describe("a pre-registered constraint's edition is unmoved", () => {
  test("`Show` at a primitive stays `Primitive` evidence, and asks nothing", () => {
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
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
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
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
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
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
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
    const { constraint } = constrainedItem(module, "tell");

    expect(sourceInstanceDictionary(module, constraint.identity, "Int", boolUnion(module)))
      .toBe("__Describe_Int");
  });

  test("`Bool` matches on the union's identity, never its name", () => {
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);
    const { constraint } = constrainedItem(module, "tag");

    expect(sourceInstanceDictionary(module, constraint.identity, "Bool", boolUnion(module)))
      .toBe("__Mark_Bool");
    // With no pin to compare against, the union subject answers nothing rather
    // than answering by spelling — the discipline `#groundFundamental` follows.
    expect(sourceInstanceDictionary(module, constraint.identity, "Bool", undefined))
      .toBeUndefined();
  });

  test("the prelude's, for a pre-registered constraint at a companion", () => {
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);

    expect(sourceInstanceDictionary(module, "hex:Show", "Int", boolUnion(module)))
      .toBe("__Show_Int");
  });

  // #762 leaves exactly one import *form* — a module alias, and nothing
  // smaller — so the three spellings this table used to compare (a bare named
  // import, the module import, and a renamed named import) are down to one route
  // for reaching a name at all: through the alias. What the property below
  // still has to say is that *which alias, and whether the constraint is
  // written through the fallback or spelled out* is not the key either, so the
  // three rows now vary that instead: the bare companion fallback (§5.1 rule
  // 2, open because the alias is spelled `Describe`, the same word the module
  // exports), the same alias qualified explicitly, and a renamed alias with no
  // fallback available at all.
  test.each([
    ["the bare companion fallback", [
      "import Describe",
      "",
      "export fun tell<a: Describe>(x: a): String = Describe.describe(x)",
      "",
    ]],
    ["the same alias, qualified explicitly", [
      "import Describe",
      "",
      "export fun tell<a: Describe.Describe>(x: a): String = Describe.describe(x)",
      "",
    ]],
    ["a renamed alias, qualified", [
      "import Describe as Portray",
      "",
      "export fun tell<a: Portray.Describe>(x: a): String = Portray.describe(x)",
      "",
    ]],
  ])("an import's instances: %s", (_label, lines) => {
    const module = core([
      ["/describe.hex", "module Describe\n\n" + describeModule],
      ["/main.hex", "module Main\n\n" + lines.join("\n")],
    ]);
    const { constraint } = constrainedItem(module, "tell");

    // The spelling the consumer wrote is not the key and cannot be: all three
    // reach one declaration, and the third does not even reuse the module's own
    // word for its alias.
    expect(constraint.identity).toBe("0:Describe");
    expect(sourceInstanceDictionary(module, constraint.identity, "Int", boolUnion(module)))
      .toBe("__Describe_Int");
    expect(sourceInstanceDictionary(module, constraint.identity, "String", boolUnion(module)))
      .toBe("__Describe_String");
  });

  test("two same-named constraints answer separately (§5.1.1)", () => {
    const module = core([
      ["/describe.hex", "module Describe\n\n" + describeModule],
      ["/portray.hex", "module Portray\n\n" + [
        "export constraint Describe<a> =",
        "    portray(value: a): String",
        "",
        "honor Describe<Int> =",
        "    portray(count) = \"counted ${count}\"",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Describe",
        "import Portray",
        "",
        "export fun tell<a: Describe>(x: a): String = Describe.describe(x)",
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

  test("an import's instances, at the `Bool` union", () => {
    const module = core([
      ["/mark.hex", "module Mark\n\n" + [
        "export constraint Mark<a> =",
        "    mark(subject: a): String",
        "",
        "honor Mark<Bool> =",
        "    mark(b) = if b then \"yes\" else \"no\"",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Mark",
        "",
        "export fun tag<a: Mark>(x: a): String = Mark.mark(x)",
        "",
      ].join("\n")],
    ]);
    const { constraint } = constrainedItem(module, "tag");

    // The channel and the head are independent, and the pairing needs its own
    // row: an imported instance's subject is a `Resolved.TypeAnnotation` while
    // this module's own is a `Typed.Type`, and `Bool` is the one head where the
    // two spellings are read for something other than a primitive's name.
    expect(sourceInstanceDictionary(module, constraint.identity, "Bool", boolUnion(module)))
      .toBe("__Mark_Bool");
  });

  test("`Unit` answers nothing, even where a refused `honor` names it", () => {
    // The refusal is the instance-head rule's (Constraints §5.4, §9.3), and the
    // refused declaration still reaches Core: a `Honor` item at
    // `{ kind: "Tuple", elements: [] }` with a dictionary name of its own. So
    // the lookup is asked the question for real here rather than being handed a
    // module where nothing could have matched anyway.
    const project = compileFiles([["/main.hex", "module Main\n\n" + [
      "constraint Describe<a> =",
      "    describe(subject: a): String",
      "",
      "honor Describe<Unit> =",
      "    describe(u) = \"unit\"",
      "",
      "export fun tell<a: Describe>(x: a): String = describe(x)",
      "",
    ].join("\n")]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "instances are keyed on type constructors; tuples and structural records " +
        "have compiler-derived instances only — declare a nominal `record` or " +
        "`union` for a type you control",
    ]);
    const module = project.modules.find(({ source }) => source.path === "/main.hex")!.core;
    const honor = module.items.find((item) => item.kind === "Honor");
    expect(honor).toMatchObject({
      constraintIdentity: "0:Describe",
      subject: { kind: "Tuple", elements: [] },
    });

    // Zero-Cost Fundamental Exports §3.2's judgment at `Unit`: a declared
    // constraint never has `Unit` among its candidates, and its lawful
    // instances are exactly the automatic structural ones. Giving `honoredAt` a
    // tuple branch — reading the refused item as though it stood — reddens
    // this.
    expect(sourceInstanceDictionary(module, "0:Describe", "Unit", boolUnion(module)))
      .toBeUndefined();
    expect(sourceInstanceDictionary(module, "hex:Show", "Unit", boolUnion(module)))
      .toBeUndefined();
  });
});

describe("a declared constraint's binder mints the editions its instances back", () => {
  test("one per fundamental it is honored at, and no other", () => {
    const module = core([["/main.hex", "module Main\n\n" + declaredConstraints]]);

    const planned = planFundamentalSpecializations(
      module,
      fundamentalInstancesOf([module], boolUnion(module)),
    ).specializations;

    // `Describe` is honored at `Int` alone and `Mark` at `Bool` alone, so each
    // binder mints exactly one edition — the judgment reading the instances
    // rather than a table reading names. `render`'s pre-registered `Show` mints
    // all seven.
    expect(planned.map(({ name }) => name).sort()).toEqual([
      "renderBigInt",
      "renderBool",
      "renderFloat",
      "renderInt",
      "renderNat",
      "renderString",
      "renderUnit",
      "tagBool",
      "tellInt",
    ]);
  });

  test("the emitted editions call the instance, end to end", async () => {
    const source = [
      "constraint Describe<a> =",
      "    describe(subject: a): String",
      "",
      "honor Describe<Int> =",
      "    describe(n) = \"int ${n}\"",
      "",
      "honor Describe<String> =",
      "    describe(s) = \"string ${s}\"",
      "",
      "constraint Mark<a> =",
      "    mark(subject: a): String",
      "",
      "honor Mark<Bool> =",
      "    mark(b) = if b then \"marked\" else \"plain\"",
      "",
      "export fun tell<a: Describe>(x: a): String = describe(x)",
      "export fun tag<a: Mark>(x: a): String = mark(x)",
      "",
    ].join("\n");
    const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);

    // Leg 1's repair, now on a reachable program: the primitive editions name
    // the instance rather than reporting a defect, and the `Bool` one names it
    // rather than building an empty dictionary literal and calling a member on
    // it.
    const emitted = project.modules
      .find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
    expect(emitted).not.toContain("undefined.");
    expect(emitted).not.toContain("({})");

    const exports = await runProject([["/main.hex", "module Main\n\n" + source]]);
    expect((exports.tellInt as (x: number) => string)(3)).toBe("int 3");
    expect((exports.tellString as (x: string) => string)("x")).toBe("string x");
    expect((exports.tagBool as (x: boolean) => string)(true)).toBe("marked");
  });
});
