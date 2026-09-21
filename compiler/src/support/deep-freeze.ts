/**
 * Recursive immutability, including the two containers `Object.freeze` does not
 * reach.
 *
 * `Object.freeze` seals a `Map`'s or a `Set`'s *properties* and leaves its
 * contents wide open: `.set`, `.add`, `.delete` and `.clear` all still work, and
 * the compiler's trees are full of both. A freeze that stopped at plain objects
 * would report a shared structure safe on exactly the writes that matter most,
 * so the mutators are replaced, on the instance, with ones that throw.
 *
 * Used by the standard-library cache's pin (`architecture/testing.md` §11): the
 * cached prefix is handed to every later compile, so nothing downstream may
 * write to it, and the way to know that is to make a write throw while the suite
 * runs.
 */

const MAP_MUTATORS = ["set", "delete", "clear"] as const;
const SET_MUTATORS = ["add", "delete", "clear"] as const;

/**
 * Freezes `value` and everything reachable from it, and answers it.
 *
 * Functions are left alone — a closure's properties are not state anyone
 * shares — and a value already seen is skipped, which is what makes the walk
 * terminate on the compiler's trees, where a subtree is reachable by many
 * paths.
 *
 * `seen` is the caller's, so one walk over a structure that shares subtrees
 * visits each of them once. A caller that hands the same set to every call
 * keeps the whole process's frozen set alive, which on a suite that freezes
 * millions of nodes costs more than the freeze does; a caller that keeps one
 * set per unit of work pays only for that unit.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as unknown as object;
  if (seen.has(object)) return value;
  seen.add(object);

  if (object instanceof Map) {
    for (const [key, entry] of object) {
      deepFreeze(key, seen);
      deepFreeze(entry, seen);
    }
    refuseMutation(object, MAP_MUTATORS);
  } else if (object instanceof Set) {
    for (const entry of object) deepFreeze(entry, seen);
    refuseMutation(object, SET_MUTATORS);
  } else {
    for (const entry of Object.values(object)) deepFreeze(entry, seen);
  }

  Object.freeze(object);
  return value;
}

/**
 * Replaces the named methods on this instance alone, so the shared prototype
 * keeps working for every other `Map` and `Set` in the process.
 *
 * Idempotent: a structure reached by a second walk — with a second `seen` set —
 * is already refusing, and redefining a method it made non-configurable would
 * throw a `TypeError` of the probe's own making.
 */
function refuseMutation(object: object, methods: readonly string[]): void {
  for (const method of methods) {
    if (Object.getOwnPropertyDescriptor(object, method) !== undefined) continue;
    Object.defineProperty(object, method, {
      value: () => {
        throw new TypeError(`cannot ${method} on a frozen ${object.constructor.name}`);
      },
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
}
