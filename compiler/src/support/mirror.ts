/**
 * Test-only: the **mirror check** of Phase 3 step 8a (`HEX_MIRROR`).
 *
 * Until the fail colour has spellings of its own (`->^`, `->~`, the marks `^`
 * and `~`) and a source of its own (`throw`), `->!` gives an arrow both colours
 * and `->` neither, so every arrow's fail colour is the image of its world
 * colour: the same constant, or the twin of the same callback's colour, or the
 * join of the twins of the same parts (Effects §1). The checker solves the two
 * colours apart, by the same machinery; where a published type's fail colour is
 * not that image, a step of the machinery was not run on the fail colour as it
 * was on the world colour. This walk finds it.
 *
 * One pairing for the whole module: a world colour variable is twinned with one
 * fail colour variable wherever either appears, and no variable is on both
 * sides, so a fail colour that is the world colour itself is a divergence.
 */

import type * as Typed from "../syntax/typed/index.js";

type Effect = Typed.Effect | undefined;

/** The first place a compiled module's fail colours stop mirroring its world colours, or nothing. */
export function mirrorDivergence(root: unknown): string | undefined {
  const worldToFail = new Map<string, string>();
  const failToWorld = new Map<string, string>();
  let conflict: string | undefined;
  const pair = (world: unknown, fail: unknown): boolean => {
    const left = String(world);
    const right = String(fail);
    const known = worldToFail.get(left);
    if (known !== undefined) {
      if (known === right) return true;
      conflict = `world v${left} is already twinned with fail v${known}`;
      return false;
    }
    if (left === right || worldToFail.has(right) || failToWorld.has(left)) {
      conflict = `v${left === right ? left : worldToFail.has(right) ? right : left} stands on both colours`;
      return false;
    }
    const partner = failToWorld.get(right);
    if (partner !== undefined) {
      conflict = `fail v${right} is already the twin of world v${partner}`;
      return false;
    }
    worldToFail.set(left, right);
    failToWorld.set(right, left);
    return true;
  };
  const same = (world: Effect, fail: Effect): boolean => {
    if (world === undefined || fail === undefined) return world === fail;
    if (typeof world === "string" || typeof fail === "string") return world === fail;
    if ("join" in world) {
      if (!("join" in fail) || world.join.length !== fail.join.length) return false;
      // Parts already twinned first, then the rest in order of creation.
      const order = (ids: readonly unknown[]) => [...ids].map(String).sort((a, b) => Number(a) - Number(b));
      const free = order(fail.join);
      const later: string[] = [];
      for (const part of order(world.join)) {
        const twin = worldToFail.get(part);
        if (twin === undefined) {
          later.push(part);
          continue;
        }
        const at = free.indexOf(twin);
        if (at < 0) {
          conflict = `world v${part} is twinned with fail v${twin}, which the fail join lacks`;
          return false;
        }
        free.splice(at, 1);
      }
      return later.every((part, index) => pair(part, free[index]));
    }
    return "variable" in fail && pair(world.variable, fail.variable);
  };
  const seen = new Set<object>();
  let found: string | undefined;
  const walk = (node: unknown, path: string): void => {
    if (found !== undefined || node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record["kind"] === "Function" && "parameters" in record && "result" in record) {
      const world = record["effect"] as Effect;
      const fail = record["fail"] as Effect;
      // A parsed or resolved arrow carries "linked"/"constant": only a typed one is compared.
      const typed = (effect: Effect) =>
        effect === undefined || effect === "impure" || effect === "error" || typeof effect === "object";
      conflict = undefined;
      if (typed(world) && typed(fail) && !same(world, fail)) {
        found = `${path}: world ${JSON.stringify(world)}, fail ${JSON.stringify(fail)}` +
          (conflict === undefined ? "" : ` (${conflict})`);
        return;
      }
    }
    if (node instanceof Map) {
      for (const [key, value] of node) walk(value, `${path}[${String(key)}]`);
      return;
    }
    if (node instanceof Set) {
      for (const value of node) walk(value, `${path}{}`);
      return;
    }
    for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
  };
  walk(root, "module");
  return found;
}
