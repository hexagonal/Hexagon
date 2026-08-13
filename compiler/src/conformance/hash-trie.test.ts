import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import { PRELUDE_MODULES } from "../prelude.js";
import trieSource from "../../../runtime/HashTrie.hex?raw";

/**
 * Conformance for the `.hex` hash array mapped trie backing `Map(k, v)` and
 * `Set(a)` (Collections Part 4 §2.1) — the bitmap-compressed HAMT ruled in #365,
 * built over the hidden `Node` intrinsic and the `hashTrie*` door rows.
 *
 * The three shapes a node can take are all reachable from source and all
 * exercised here. `Entry` is the common case; `Branch` appears the moment two
 * keys disagree on a digit, and its *packed* children are what the bit family
 * addresses; `Collision` appears only when two unequal keys share a full 32-bit
 * mixed hash, which is the one thing the digit walk cannot break. Deletion runs
 * the same three in reverse, compacting a branch back to a lone `Entry` and a
 * two-entry `Collision` back to an `Entry`.
 *
 * The runtime module (`runtime/HashTrie.hex`, loaded via `?raw`) has only
 * internal declarations; each test appends `export let` probes to its source and
 * compiles the whole as one privileged runtime module, so `HashTrie`/`Tree`/
 * `Node` never cross a boundary and every export is a scalar.
 *
 * ## Why the probe copy sits at a different path
 *
 * `HashTrie.hex` is an *injected* basename (`src/runtime-modules.ts`): the
 * compiler places its own copy at every project's root. A probe copy in that
 * seat would be measured as the program's runtime rather than as the module
 * under test. The basename was never the subject; the source is, and this
 * compiles the same text under its own path beside the injected copy —
 * `vector-trie.test.ts`'s arrangement, for its reasons.
 *
 * ## What is deliberately not asserted
 *
 * **No traversal order.** Placement is `mix(hash(key))` and `mix` reads a
 * per-process seed (`spec/effects.md` §6.2 species (b)), so the order `entries`
 * yields is stable within one execution and arbitrary across them. Every
 * `entries` assertion below is an order-independent aggregate or a comparison of
 * one trie value against *itself*.
 */
const PROBE_PATH = "/HashProbe.hex";

async function runTrie(probes: string): Promise<Record<string, unknown>> {
  return runProject(
    [[PROBE_PATH, `${trieSource}\n${probes}`]],
    { runtimePaths: [PROBE_PATH], entry: PROBE_PATH },
  );
}

/**
 * The same, with extra JavaScript appended to the *emitted* probe module.
 *
 * One promise this trie makes is not expressible in Hexagon: that `remove` of an
 * absent key hands back the **same value**, not an equal rebuild. Hexagon has no
 * reference-identity predicate — deliberately, `==` being structural — so the
 * only place the question can be asked is the emitted JavaScript, where a
 * module-level Hexagon `let` is a `const` of the same name. The lines here are
 * `===` comparisons over those bindings, exported as ordinary booleans.
 */
async function runTrieWithIdentity(
  probes: string,
  identities: readonly string[],
): Promise<Record<string, unknown>> {
  return runProject(
    [[PROBE_PATH, `${trieSource}\n${probes}`]],
    {
      runtimePaths: [PROBE_PATH],
      entry: PROBE_PATH,
      transform: (path, javascript) =>
        path === PROBE_PATH ? `${javascript}\n${identities.join("\n")}\n` : javascript,
    },
  );
}

/** Small readers the probes share; nothing here is under test. */
const READERS =
  "let intOr(option: Option(Int), fallback: Int): Int =\n" +
  "    match option\n" +
  "        None => fallback\n" +
  "        Some(value) => value\n" +
  "let isPresent(option: Option(Int)): Bool =\n" +
  "    match option\n" +
  "        None => False\n" +
  "        Some(_) => True\n";

/** `buildTo(n)` binds 1..n to 10..10n; `dropRange` unbinds an inclusive run. */
const BUILD =
  READERS +
  "let buildTo(n: Int): HashTrie(Int, Int) =\n" +
  "    var acc: HashTrie(Int, Int) = empty\n" +
  "    for i in 1..n\n" +
  "        acc := set(acc, i, i * 10)\n" +
  "    acc\n" +
  "let dropRange(trie: HashTrie(Int, Int), lo: Int, hi: Int): HashTrie(Int, Int) =\n" +
  "    var acc: HashTrie(Int, Int) = trie\n" +
  "    for i in lo..hi\n" +
  "        acc := remove(acc, i)\n" +
  "    acc\n";

describe("HashTrie basic algebra", () => {
  test("§2 an empty trie has no size, no entries, and answers every lookup with None", async () => {
    const m = await runTrie(
      BUILD +
        "export let sizeOfEmpty: Int = size(buildTo(0))\n" +
        "export let emptyIsEmpty: Bool = isEmpty(buildTo(0))\n" +
        "export let threeIsNotEmpty: Bool = isEmpty(buildTo(3))\n" +
        "export let missOnEmpty: Bool = isPresent(get(buildTo(0), 1))\n" +
        "export let containsOnEmpty: Bool = containsKey(buildTo(0), 1)\n" +
        "export let entriesOfEmpty: Int = Seq.length(entries(buildTo(0)))\n",
    );
    expect(m.sizeOfEmpty).toBe(0);
    expect(m.emptyIsEmpty).toBe(true);
    expect(m.threeIsNotEmpty).toBe(false);
    expect(m.missOnEmpty).toBe(false);
    expect(m.containsOnEmpty).toBe(false);
    expect(m.entriesOfEmpty).toBe(0);
  });

  test("§5.1 set/get/containsKey round-trip over Int keys", async () => {
    const m = await runTrie(
      BUILD +
        "export let sizeThree: Int = size(buildTo(3))\n" +
        "export let firstValue: Int = intOr(get(buildTo(3), 1), -1)\n" +
        "export let lastValue: Int = intOr(get(buildTo(3), 3), -1)\n" +
        "export let hasTwo: Bool = containsKey(buildTo(3), 2)\n" +
        "export let hasFour: Bool = containsKey(buildTo(3), 4)\n" +
        "export let missingValue: Bool = isPresent(get(buildTo(3), 4))\n",
    );
    expect(m.sizeThree).toBe(3);
    expect(m.firstValue).toBe(10);
    expect(m.lastValue).toBe(30);
    expect(m.hasTwo).toBe(true);
    expect(m.hasFour).toBe(false);
    expect(m.missingValue).toBe(false);
  });

  test("§5.1 set is upsert: an existing key swaps its value and does not grow the trie", async () => {
    const m = await runTrie(
      BUILD +
        "let overwritten: HashTrie(Int, Int) = set(buildTo(5), 3, 999)\n" +
        "export let overwrittenSize: Int = size(overwritten)\n" +
        "export let overwrittenValue: Int = intOr(get(overwritten, 3), -1)\n" +
        "export let neighbourUntouched: Int = intOr(get(overwritten, 2), -1)\n" +
        "let twiceOver: HashTrie(Int, Int) = set(set(buildTo(5), 3, 111), 3, 222)\n" +
        "export let twiceOverSize: Int = size(twiceOver)\n" +
        "export let twiceOverValue: Int = intOr(get(twiceOver, 3), -1)\n",
    );
    expect(m.overwrittenSize).toBe(5);
    expect(m.overwrittenValue).toBe(999);
    expect(m.neighbourUntouched).toBe(20);
    expect(m.twiceOverSize).toBe(5);
    expect(m.twiceOverValue).toBe(222);
  });

  test("§5.1 String keys round-trip through the same operations", async () => {
    const m = await runTrie(
      READERS +
        "let words: HashTrie(String, Int) =\n" +
        "    set(set(set(empty, \"alpha\", 1), \"beta\", 2), \"gamma\", 3)\n" +
        "export let wordCount: Int = size(words)\n" +
        "export let beta: Int = intOr(get(words, \"beta\"), -1)\n" +
        "export let hasGamma: Bool = containsKey(words, \"gamma\")\n" +
        "export let hasDelta: Bool = containsKey(words, \"delta\")\n" +
        "let withoutBeta: HashTrie(String, Int) = remove(words, \"beta\")\n" +
        "export let withoutBetaCount: Int = size(withoutBeta)\n" +
        "export let betaGone: Bool = containsKey(withoutBeta, \"beta\")\n" +
        "export let alphaStays: Int = intOr(get(withoutBeta, \"alpha\"), -1)\n",
    );
    expect(m.wordCount).toBe(3);
    expect(m.beta).toBe(2);
    expect(m.hasGamma).toBe(true);
    expect(m.hasDelta).toBe(false);
    expect(m.withoutBetaCount).toBe(2);
    expect(m.betaGone).toBe(false);
    expect(m.alphaStays).toBe(1);
  });
});

describe("HashTrie removal", () => {
  /**
   * "Unchanged" is the strong reading: the *same* value, not an equal rebuild.
   * `discard` threads a not-found indicator back up so no node on the path is
   * copied, and reference identity is what proves it — an equal-but-rebuilt trie
   * would pass a size check and fail this.
   */
  test("§5.1 removing an absent key returns the very trie it was given", async () => {
    const m = await runTrieWithIdentity(
      BUILD +
        "let five: HashTrie(Int, Int) = buildTo(5)\n" +
        "let untouched: HashTrie(Int, Int) = remove(five, 99)\n" +
        "export let untouchedSize: Int = size(untouched)\n" +
        "export let stillHasThree: Bool = containsKey(untouched, 3)\n" +
        // A deep miss: 200 keys is several branch levels, and the walk has to
        // come all the way back up without having copied a node.
        "let deep: HashTrie(Int, Int) = buildTo(200)\n" +
        "let deepMiss: HashTrie(Int, Int) = remove(deep, 5000)\n" +
        "export let deepMissSize: Int = size(deepMiss)\n" +
        "export let emptyRemove: Int = size(remove(buildTo(0), 1))\n",
      [
        "export const sameValue = five === untouched;",
        "export const deepSameValue = deep === deepMiss;",
      ],
    );
    expect(m.untouchedSize).toBe(5);
    expect(m.stillHasThree).toBe(true);
    expect(m.deepMissSize).toBe(200);
    expect(m.emptyRemove).toBe(0);
    // Not merely equal — the same object, so nothing on the path was copied.
    expect(m.sameValue).toBe(true);
    expect(m.deepSameValue).toBe(true);
  });

  test("§5.1 removing every key empties the trie back to the shared empty", async () => {
    const m = await runTrieWithIdentity(
      BUILD +
        "let drained: HashTrie(Int, Int) = dropRange(buildTo(40), 1, 40)\n" +
        "export let drainedSize: Int = size(drained)\n" +
        "export let drainedIsEmpty: Bool = isEmpty(drained)\n" +
        "export let drainedLookup: Bool = isPresent(get(drained, 7))\n" +
        "export let drainedEntries: Int = Seq.length(entries(drained))\n" +
        "let refilled: HashTrie(Int, Int) = set(drained, 7, 70)\n" +
        "export let refilledSize: Int = size(refilled)\n" +
        "export let refilledValue: Int = intOr(get(refilled, 7), -1)\n",
      ["export const drainedIsTheSharedEmpty = drained === empty;"],
    );
    expect(m.drainedSize).toBe(0);
    expect(m.drainedIsEmpty).toBe(true);
    expect(m.drainedLookup).toBe(false);
    expect(m.drainedEntries).toBe(0);
    expect(m.drainedIsTheSharedEmpty).toBe(true);
    expect(m.refilledSize).toBe(1);
    expect(m.refilledValue).toBe(70);
  });

  /**
   * Compaction is behavioural here rather than structural: a branch that failed
   * to collapse would still answer every lookup correctly. What it *would* break
   * is `entries`, which walks the packed children by popcount — a stale bitmap
   * bit or an unlifted lone child shows up as a missing or duplicated pair. So
   * the count and the key sum after a heavy drain are the compaction assertion.
   */
  test("§5.1 draining a wide trie down to one key leaves exactly that key", async () => {
    const m = await runTrie(
      BUILD +
        "let thinned: HashTrie(Int, Int) = dropRange(dropRange(buildTo(300), 1, 149), 151, 300)\n" +
        "export let thinnedSize: Int = size(thinned)\n" +
        "export let survivorValue: Int = intOr(get(thinned, 150), -1)\n" +
        "export let survivorNeighbour: Bool = containsKey(thinned, 149)\n" +
        "export let thinnedEntries: Int = Seq.length(entries(thinned))\n" +
        "let survivorKey(total: Int, pair: (Int, Int)): Int =\n" +
        "    let (key, _) = pair\n" +
        "    total + key\n" +
        "export let thinnedKeySum: Int = Seq.fold(entries(thinned), 0, survivorKey)\n",
    );
    expect(m.thinnedSize).toBe(1);
    expect(m.survivorValue).toBe(1500);
    expect(m.survivorNeighbour).toBe(false);
    expect(m.thinnedEntries).toBe(1);
    expect(m.thinnedKeySum).toBe(150);
  });
});

describe("HashTrie at scale (branch growth and compaction)", () => {
  /**
   * A thousand distinct keys forces real fan-out: 32 slots at the root, so the
   * trie is at least three levels deep, and every packed insert
   * (`nodeInsertAt` at a computed popcount slot) runs hundreds of times. A
   * mis-ordered packed array or an off-by-one in `bitCountBelow` cannot survive
   * a thousand round-trips.
   */
  test("§2.1 a thousand keys insert, read back, and count", async () => {
    const m = await runTrie(
      BUILD +
        "let big: HashTrie(Int, Int) = buildTo(1000)\n" +
        "export let bigSize: Int = size(big)\n" +
        "export let bigFirst: Int = intOr(get(big, 1), -1)\n" +
        "export let bigMiddle: Int = intOr(get(big, 500), -1)\n" +
        "export let bigLast: Int = intOr(get(big, 1000), -1)\n" +
        "export let bigPastEnd: Bool = containsKey(big, 1001)\n" +
        "export let bigZero: Bool = containsKey(big, 0)\n" +
        "let readBack(): Int =\n" +
        "    var found = 0\n" +
        "    for i in 1..1000\n" +
        "        if intOr(get(big, i), -1) == i * 10 then\n" +
        "            found := found + 1\n" +
        "    found\n" +
        "export let bigReadBack: Int = readBack()\n" +
        "export let bigEntries: Int = Seq.length(entries(big))\n",
    );
    expect(m.bigSize).toBe(1000);
    expect(m.bigFirst).toBe(10);
    expect(m.bigMiddle).toBe(5000);
    expect(m.bigLast).toBe(10000);
    expect(m.bigPastEnd).toBe(false);
    expect(m.bigZero).toBe(false);
    expect(m.bigReadBack).toBe(1000);
    expect(m.bigEntries).toBe(1000);
  });

  test("§2.1 removing 999 of a thousand keys leaves the survivor findable", async () => {
    const m = await runTrie(
      BUILD +
        "let survivor: HashTrie(Int, Int) = dropRange(dropRange(buildTo(1000), 1, 776), 778, 1000)\n" +
        "export let survivorSize: Int = size(survivor)\n" +
        "export let survivorValue: Int = intOr(get(survivor, 777), -1)\n" +
        "export let survivorEntries: Int = Seq.length(entries(survivor))\n" +
        "let stillThere(): Int =\n" +
        "    var found = 0\n" +
        "    for i in 1..1000\n" +
        "        if containsKey(survivor, i) then\n" +
        "            found := found + 1\n" +
        "    found\n" +
        "export let survivorScan: Int = stillThere()\n" +
        "let halved: HashTrie(Int, Int) = dropRange(buildTo(1000), 1, 500)\n" +
        "export let halvedSize: Int = size(halved)\n" +
        "export let halvedEntries: Int = Seq.length(entries(halved))\n" +
        "export let halvedLow: Bool = containsKey(halved, 250)\n" +
        "export let halvedHigh: Int = intOr(get(halved, 750), -1)\n",
    );
    expect(m.survivorSize).toBe(1);
    expect(m.survivorValue).toBe(7770);
    expect(m.survivorEntries).toBe(1);
    expect(m.survivorScan).toBe(1);
    expect(m.halvedSize).toBe(500);
    expect(m.halvedEntries).toBe(500);
    expect(m.halvedLow).toBe(false);
    expect(m.halvedHigh).toBe(7500);
  });
});

/**
 * `Hash<String>` lowers to the deterministic, unseeded `stableHash` — a Java-31
 * fold over char codes — so genuine public-hash collisions are computable here
 * rather than hoped for. The pairs are verified against a transcription of that
 * algorithm *in this file* before they are used, so a change to the lowering
 * fails the guard rather than silently turning these into ordinary inserts.
 *
 * A public-hash tie is a mixed-hash tie (`mix` is a function), so these keys
 * reach `Collision` however the per-process seed falls.
 */
describe("HashTrie collisions", () => {
  /** The `stableHash` string arm, transcribed from `emitter.ts`. */
  function stableHash(text: string): number {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
    }
    return hash;
  }

  const COLLIDING = ["AaAa", "AaBB", "BBAa", "BBBB"];

  test("the chosen keys really do collide under Hash<String>", () => {
    expect(new Set(COLLIDING.map(stableHash)).size).toBe(1);
    expect(new Set(COLLIDING).size).toBe(COLLIDING.length);
    // The guard's own negative control: an unrelated key must not join them.
    expect(stableHash("Aa")).not.toBe(stableHash("AaAa"));
  });

  test("§5.1 colliding keys store and retrieve independently", async () => {
    const m = await runTrie(
      READERS +
        "let colliding: HashTrie(String, Int) =\n" +
        "    set(set(set(set(empty, \"AaAa\", 1), \"AaBB\", 2), \"BBAa\", 3), \"BBBB\", 4)\n" +
        "export let collidingSize: Int = size(colliding)\n" +
        "export let one: Int = intOr(get(colliding, \"AaAa\"), -1)\n" +
        "export let two: Int = intOr(get(colliding, \"AaBB\"), -1)\n" +
        "export let three: Int = intOr(get(colliding, \"BBAa\"), -1)\n" +
        "export let four: Int = intOr(get(colliding, \"BBBB\"), -1)\n" +
        "export let collidingEntries: Int = Seq.length(entries(colliding))\n" +
        "let overwritten: HashTrie(String, Int) = set(colliding, \"BBAa\", 30)\n" +
        "export let overwrittenSize: Int = size(overwritten)\n" +
        "export let overwrittenValue: Int = intOr(get(overwritten, \"BBAa\"), -1)\n" +
        "export let overwrittenNeighbour: Int = intOr(get(overwritten, \"AaBB\"), -1)\n",
    );
    expect(m.collidingSize).toBe(4);
    expect(m.one).toBe(1);
    expect(m.two).toBe(2);
    expect(m.three).toBe(3);
    expect(m.four).toBe(4);
    expect(m.collidingEntries).toBe(4);
    expect(m.overwrittenSize).toBe(4);
    expect(m.overwrittenValue).toBe(30);
    expect(m.overwrittenNeighbour).toBe(2);
  });

  test("§5.1 removing from a collision leaves the others, and the last one becomes an Entry", async () => {
    const m = await runTrie(
      READERS +
        "let colliding: HashTrie(String, Int) =\n" +
        "    set(set(set(set(empty, \"AaAa\", 1), \"AaBB\", 2), \"BBAa\", 3), \"BBBB\", 4)\n" +
        "let three: HashTrie(String, Int) = remove(colliding, \"AaBB\")\n" +
        "export let threeSize: Int = size(three)\n" +
        "export let goneFromThree: Bool = containsKey(three, \"AaBB\")\n" +
        "export let survivorOfThree: Int = intOr(get(three, \"BBBB\"), -1)\n" +
        "let one: HashTrie(String, Int) = remove(remove(three, \"AaAa\"), \"BBAa\")\n" +
        "export let oneSize: Int = size(one)\n" +
        "export let oneValue: Int = intOr(get(one, \"BBBB\"), -1)\n" +
        "export let oneEntries: Int = Seq.length(entries(one))\n" +
        // The collapsed single survivor must still accept its own overwrite and
        // its own removal, which is what proves it became a real `Entry` rather
        // than a one-element `Collision` wearing an `Entry`'s answers.
        "export let oneOverwritten: Int = intOr(get(set(one, \"BBBB\", 44), \"BBBB\"), -1)\n" +
        "export let oneDrained: Bool = isEmpty(remove(one, \"BBBB\"))\n" +
        "export let absentFromCollision: Int = size(remove(colliding, \"BBAB\"))\n",
    );
    expect(m.threeSize).toBe(3);
    expect(m.goneFromThree).toBe(false);
    expect(m.survivorOfThree).toBe(4);
    expect(m.oneSize).toBe(1);
    expect(m.oneValue).toBe(4);
    expect(m.oneEntries).toBe(1);
    expect(m.oneOverwritten).toBe(44);
    expect(m.oneDrained).toBe(true);
    expect(m.absentFromCollision).toBe(4);
  });

  /**
   * Colliding keys mixed in with a thousand non-colliding ones: the collision
   * node has to survive being pushed down by branch growth, and the branch walk
   * has to keep finding it.
   */
  test("§5.1 a collision node survives inside a large trie", async () => {
    const m = await runTrie(
      READERS +
        "let mixed(): HashTrie(String, Int) =\n" +
        "    var acc: HashTrie(String, Int) = empty\n" +
        "    for i in 1..500\n" +
        "        acc := set(acc, \"k${i}\", i)\n" +
        "    set(set(acc, \"AaAa\", 7001), \"BBBB\", 7002)\n" +
        "let big: HashTrie(String, Int) = mixed()\n" +
        "export let bigSize: Int = size(big)\n" +
        "export let bigCollisionOne: Int = intOr(get(big, \"AaAa\"), -1)\n" +
        "export let bigCollisionTwo: Int = intOr(get(big, \"BBBB\"), -1)\n" +
        "export let bigOrdinary: Int = intOr(get(big, \"k250\"), -1)\n" +
        "export let bigEntries: Int = Seq.length(entries(big))\n" +
        "let withoutOne: HashTrie(String, Int) = remove(big, \"AaAa\")\n" +
        "export let withoutOneSize: Int = size(withoutOne)\n" +
        "export let withoutOneOther: Int = intOr(get(withoutOne, \"BBBB\"), -1)\n",
    );
    expect(m.bigSize).toBe(502);
    expect(m.bigCollisionOne).toBe(7001);
    expect(m.bigCollisionTwo).toBe(7002);
    expect(m.bigOrdinary).toBe(250);
    expect(m.bigEntries).toBe(502);
    expect(m.withoutOneSize).toBe(501);
    expect(m.withoutOneOther).toBe(7002);
  });
});

/**
 * Collections Part 4 §5.4: two `equals`-equal keys are one key, and the trie
 * keeps the representative it already holds while the *value* is replaced.
 *
 * ## Why retention is asserted the way it is
 *
 * Distinguishing *which* of two equal keys the trie kept needs a key type whose
 * `equals` is coarser than its own identity. Hexagon offers exactly one today,
 * and only one pair of it: `Float`, at `0.0` and `-0.0`. A probe cannot invent a
 * second, because `Hash` instances cannot be hand-written outside a primitive's
 * own companion (checker: "use `derives Hash` on the declaration of the subject
 * type") and every derived `Hash` is structural, agreeing with a derived `Eq` by
 * construction. So the ±0 pair is not a convenient illustration of retention —
 * it is the whole of what retention is observable through.
 *
 * So these tests assert the half every key type shows — replacement never grows
 * the trie, the last value wins, and the key stays findable afterwards, through
 * the `Entry` path and through the `Collision` path — and then the ±0 test
 * asserts the half only `Float` can show: that the representative kept is the
 * *first*, not the last.
 */
describe("HashTrie representative retention (Part 4 §5.4)", () => {
  test("replacement is idempotent in size and last-value-wins, on the Entry path", async () => {
    const m = await runTrie(
      READERS +
        "let repeated(): HashTrie(Int, Int) =\n" +
        "    var acc: HashTrie(Int, Int) = empty\n" +
        "    for i in 1..20\n" +
        "        acc := set(acc, 7, i)\n" +
        "    acc\n" +
        "let once: HashTrie(Int, Int) = repeated()\n" +
        "export let onceSize: Int = size(once)\n" +
        "export let onceValue: Int = intOr(get(once, 7), -1)\n" +
        "export let onceEntries: Int = Seq.length(entries(once))\n" +
        "export let onceFindable: Bool = containsKey(once, 7)\n" +
        "export let onceDrains: Bool = isEmpty(remove(once, 7))\n",
    );
    expect(m.onceSize).toBe(1);
    expect(m.onceValue).toBe(20);
    expect(m.onceEntries).toBe(1);
    expect(m.onceFindable).toBe(true);
    expect(m.onceDrains).toBe(true);
  });

  test("replacement is idempotent in size and last-value-wins, on the Collision path", async () => {
    const m = await runTrie(
      READERS +
        // "AaAa"/"BBBB" collide under `Hash<String>` (verified in the collisions
        // describe), so this replaces inside a `Collision` node rather than an
        // `Entry`.
        "let repeated(): HashTrie(String, Int) =\n" +
        "    var acc: HashTrie(String, Int) = set(empty, \"AaAa\", 1)\n" +
        "    for i in 1..20\n" +
        "        acc := set(acc, \"BBBB\", i)\n" +
        "    acc\n" +
        "let both: HashTrie(String, Int) = repeated()\n" +
        "export let bothSize: Int = size(both)\n" +
        "export let replacedValue: Int = intOr(get(both, \"BBBB\"), -1)\n" +
        "export let neighbourValue: Int = intOr(get(both, \"AaAa\"), -1)\n" +
        "export let bothEntries: Int = Seq.length(entries(both))\n" +
        "export let bothFindable: Bool = containsKey(both, \"BBBB\")\n",
    );
    expect(m.bothSize).toBe(2);
    expect(m.replacedValue).toBe(20);
    expect(m.neighbourValue).toBe(1);
    expect(m.bothEntries).toBe(2);
    expect(m.bothFindable).toBe(true);
  });

  /**
   * The `Float` ±0 case Part 4 §5.4 is usually stated with, and the one probe
   * that can see *which* representative was kept.
   *
   * `0.0 == -0.0` is `True` and the two now hash alike, so they are one key:
   * inserting `-0.0` and then `0.0` leaves one entry carrying the later value,
   * while the key stays the `-0.0` that arrived first. `show` renders `-0` as
   * "0", so the retained key's sign has to be read arithmetically — hence the
   * `1.0 / key < 0.0` probe.
   */
  test("±0 Float keys are one key: the first representative is kept, the last value wins", async () => {
    const m = await runTrie(
      "let zeroes: HashTrie(Float, Int) = set(set(empty, -0.0, 1), 0.0, 2)\n" +
        "export let zeroesSize: Int = size(zeroes)\n" +
        "export let equatedAsFloats: Bool = -0.0 == 0.0\n" +
        "export let negativeZeroValue: Int =\n" +
        "    match get(zeroes, -0.0)\n" +
        "        None => -1\n" +
        "        Some(value) => value\n" +
        "let signSum(total: Int, pair: (Float, Int)): Int =\n" +
        "    let (key, _) = pair\n" +
        "    if 1.0 / key < 0.0 then total + 1 else total\n" +
        "export let negativeZeroesSeen: Int = Seq.fold(entries(zeroes), 0, signSum)\n",
    );
    // The equality the law is stated over holds, and so now does the hash.
    expect(m.equatedAsFloats).toBe(true);
    expect(m.zeroesSize).toBe(1);
    expect(m.negativeZeroValue).toBe(2);
    // The single stored key is the negative zero — the representative that was
    // already held, not the one that replaced its value.
    expect(m.negativeZeroesSeen).toBe(1);
  });
});

/**
 * The unplaced singleton (#370): `Root`'s third arm, and the whole reason the
 * root stopped being an `Option(Tree)`.
 *
 * Collections Part 4 §12.4 makes `Map.singleton` **permanently unconstrained**,
 * so a one-entry trie has to exist at a key type that has no `Hash` at all. That
 * is what `Sole` is: the pair held raw, no hash computed and none computable.
 * Two properties are under test and they pull in opposite directions —
 * *unplacedness*, which is what the signature buys, and *confinement*, which is
 * what keeps the rest of the trie from having to know about it.
 *
 * ## Why a JavaScript probe appears here
 *
 * "No placement happened" is not a Hexagon-observable fact: every keyed
 * operation answers the same whether the entry was placed or not, which is
 * precisely the point. The only place the question can be asked is the emitted
 * root's constructor tag, read through the same identity channel the
 * forgiving-`remove` tests use. It pins the union's emitted shape, which is a
 * price worth paying once: without it these tests pass against an
 * implementation that hashes the key on the first opportunity and keeps every
 * observable answer identical, which is the exact regression the arm exists to
 * prevent.
 */
describe("HashTrie unplaced singleton (§12.4, #370)", () => {
  /**
   * The signature, tested by compiling it at a key type that has no `Hash`
   * instance and could not be given one here. A `<k: Hash>` on `singleton`
   * would make this a hard error, which is the whole assertion; `size` and
   * `entries` join in because they are the two other unconstrained rows.
   */
  test("singleton takes a key type with no Hash instance at all", async () => {
    const m = await runTrie(
      "record Unhashable = {\n" +
        "    label: String,\n" +
        "}\n" +
        "let odd: HashTrie(Unhashable, Int) = singleton(Unhashable({label = \"k\"}), 7)\n" +
        "export let oddSize: Int = size(odd)\n" +
        "export let oddIsEmpty: Bool = isEmpty(odd)\n" +
        "export let oddEntries: Int = Seq.length(entries(odd))\n" +
        "let onlyValue(total: Int, pair: (Unhashable, Int)): Int =\n" +
        "    let (_, value) = pair\n" +
        "    total + value\n" +
        "export let oddValueSum: Int = Seq.fold(entries(odd), 0, onlyValue)\n",
    );
    expect(m.oddSize).toBe(1);
    expect(m.oddIsEmpty).toBe(false);
    expect(m.oddEntries).toBe(1);
    expect(m.oddValueSum).toBe(7);
  });

  test("get and containsKey answer over an unplaced root, without placing it", async () => {
    const m = await runTrieWithIdentity(
      READERS +
        "let one: HashTrie(Int, Int) = singleton(4, 40)\n" +
        "export let oneSize: Int = size(one)\n" +
        "export let hit: Int = intOr(get(one, 4), -1)\n" +
        "export let miss: Bool = isPresent(get(one, 5))\n" +
        "export let hasKey: Bool = containsKey(one, 4)\n" +
        "export let lacksKey: Bool = containsKey(one, 5)\n" +
        // Reading the key must not settle the root either: `get` answers by
        // comparison, so the value it was handed is unchanged afterwards.
        "let after: HashTrie(Int, Int) = one\n" +
        "export let afterHit: Int = intOr(get(after, 4), -1)\n",
      ["export const rootTag = one.root.tag;"],
    );
    expect(m.oneSize).toBe(1);
    expect(m.hit).toBe(40);
    expect(m.miss).toBe(false);
    expect(m.hasKey).toBe(true);
    expect(m.lacksKey).toBe(false);
    expect(m.afterHit).toBe(40);
    expect(m.rootTag).toBe("Sole");
  });

  test("entries yields the one pair, and the root is still unplaced after", async () => {
    const m = await runTrieWithIdentity(
      "let one: HashTrie(String, Int) = singleton(\"only\", 3)\n" +
        "export let count: Int = Seq.length(entries(one))\n" +
        "let sumValues(total: Int, pair: (String, Int)): Int =\n" +
        "    let (_, value) = pair\n" +
        "    total + value\n" +
        "let namedOnly(total: Int, pair: (String, Int)): Int =\n" +
        "    let (key, _) = pair\n" +
        "    if key == \"only\" then total + 1 else total\n" +
        "export let valueSum: Int = Seq.fold(entries(one), 0, sumValues)\n" +
        "export let keysNamedOnly: Int = Seq.fold(entries(one), 0, namedOnly)\n",
      ["export const rootTag = one.root.tag;"],
    );
    expect(m.count).toBe(1);
    expect(m.valueSum).toBe(3);
    expect(m.keysNamedOnly).toBe(1);
    expect(m.rootTag).toBe("Sole");
  });

  /**
   * §5.4's first-representative rule at the one place it can be tested without
   * a `Float`: replacing an unplaced entry's value keeps the *stored* key and
   * leaves the root unplaced, because nothing about a replacement needs a hash.
   */
  test("set at the same key replaces the value and stays unplaced", async () => {
    const m = await runTrieWithIdentity(
      READERS +
        "let one: HashTrie(Int, Int) = singleton(4, 40)\n" +
        "let replaced: HashTrie(Int, Int) = set(one, 4, 41)\n" +
        "export let replacedSize: Int = size(replaced)\n" +
        "export let replacedValue: Int = intOr(get(replaced, 4), -1)\n" +
        "export let originalValue: Int = intOr(get(one, 4), -1)\n" +
        "export let replacedEntries: Int = Seq.length(entries(replaced))\n",
      [
        "export const replacedTag = replaced.root.tag;",
        // The slot is a named field of the emitted constructor, so this reads
        // the singleton's own stored value — not the replacement's.
        "export const originalUntouched = one.root.value === 40;",
      ],
    );
    expect(m.replacedSize).toBe(1);
    expect(m.replacedValue).toBe(41);
    expect(m.replacedEntries).toBe(1);
    // Persistent: the original still reads its own value.
    expect(m.originalValue).toBe(40);
    expect(m.originalUntouched).toBe(true);
    expect(m.replacedTag).toBe("Sole");
  });

  /**
   * The settle transition — the file's one placement site for an unplaced root,
   * and the only operation that both carries `Hash` evidence and needs two
   * entries to sit apart. Afterwards the trie is an ordinary placed one and
   * every later operation runs the walkers, which is why the assertions below go
   * past the second insert.
   */
  test("set at a differing key settles both entries into a placed tree", async () => {
    const m = await runTrieWithIdentity(
      READERS +
        "let one: HashTrie(Int, Int) = singleton(4, 40)\n" +
        "let two: HashTrie(Int, Int) = set(one, 9, 90)\n" +
        "export let twoSize: Int = size(two)\n" +
        "export let keptFirst: Int = intOr(get(two, 4), -1)\n" +
        "export let keptSecond: Int = intOr(get(two, 9), -1)\n" +
        "export let twoEntries: Int = Seq.length(entries(two))\n" +
        // The settled trie behaves like any other from here: it grows, replaces,
        // and shrinks through the ordinary walkers.
        "let hundred(): HashTrie(Int, Int) =\n" +
        "    var acc: HashTrie(Int, Int) = two\n" +
        "    for i in 10..100\n" +
        "        acc := set(acc, i, i * 10)\n" +
        "    acc\n" +
        "let big: HashTrie(Int, Int) = hundred()\n" +
        "export let bigSize: Int = size(big)\n" +
        "export let bigEntries: Int = Seq.length(entries(big))\n" +
        "export let bigKeepsFirst: Int = intOr(get(big, 4), -1)\n" +
        "export let shrunk: Int = size(remove(big, 50))\n" +
        // And the singleton it grew out of is untouched.
        "export let oneStillOne: Int = size(one)\n" +
        "export let oneLacksNine: Bool = containsKey(one, 9)\n",
      [
        "export const oneTag = one.root.tag;",
        "export const twoTag = two.root.tag;",
      ],
    );
    expect(m.twoSize).toBe(2);
    expect(m.keptFirst).toBe(40);
    expect(m.keptSecond).toBe(90);
    expect(m.twoEntries).toBe(2);
    expect(m.bigSize).toBe(93);
    expect(m.bigEntries).toBe(93);
    expect(m.bigKeepsFirst).toBe(40);
    expect(m.shrunk).toBe(92);
    expect(m.oneStillOne).toBe(1);
    expect(m.oneLacksNine).toBe(false);
    // Persistence at the arm boundary: settling built a new root and left the
    // singleton's own unplaced.
    expect(m.oneTag).toBe("Sole");
    expect(m.twoTag).toBe("Rooted");
  });

  /**
   * The settle path has to survive a full-hash tie as much as the ordinary
   * insert does: "AaAa" and "BBBB" share a mixed hash (pinned in the collisions
   * describe above), so settling them builds a `Collision` rather than a split.
   */
  test("settling two keys that share a hash builds a collision, not a split", async () => {
    const m = await runTrie(
      READERS +
        "let one: HashTrie(String, Int) = singleton(\"AaAa\", 1)\n" +
        "let two: HashTrie(String, Int) = set(one, \"BBBB\", 2)\n" +
        "export let twoSize: Int = size(two)\n" +
        "export let firstValue: Int = intOr(get(two, \"AaAa\"), -1)\n" +
        "export let secondValue: Int = intOr(get(two, \"BBBB\"), -1)\n" +
        "export let twoEntries: Int = Seq.length(entries(two))\n" +
        "export let afterRemoval: Int = size(remove(two, \"AaAa\"))\n" +
        "export let survivorValue: Int = intOr(get(remove(two, \"AaAa\"), \"BBBB\"), -1)\n",
    );
    expect(m.twoSize).toBe(2);
    expect(m.firstValue).toBe(1);
    expect(m.secondValue).toBe(2);
    expect(m.twoEntries).toBe(2);
    expect(m.afterRemoval).toBe(1);
    expect(m.survivorValue).toBe(2);
  });

  test("remove over an unplaced root: the key empties it, anything else is forgiving", async () => {
    const m = await runTrieWithIdentity(
      READERS +
        "let one: HashTrie(Int, Int) = singleton(4, 40)\n" +
        "let drained: HashTrie(Int, Int) = remove(one, 4)\n" +
        "let untouched: HashTrie(Int, Int) = remove(one, 5)\n" +
        "export let drainedSize: Int = size(drained)\n" +
        "export let drainedIsEmpty: Bool = isEmpty(drained)\n" +
        "export let drainedLookup: Bool = isPresent(get(drained, 4))\n" +
        "export let drainedEntries: Int = Seq.length(entries(drained))\n" +
        "export let untouchedSize: Int = size(untouched)\n" +
        "export let untouchedValue: Int = intOr(get(untouched, 4), -1)\n",
      [
        "export const drainedIsTheSharedEmpty = drained === empty;",
        "export const forgivingIsTheSameValue = untouched === one;",
      ],
    );
    expect(m.drainedSize).toBe(0);
    expect(m.drainedIsEmpty).toBe(true);
    expect(m.drainedLookup).toBe(false);
    expect(m.drainedEntries).toBe(0);
    expect(m.untouchedSize).toBe(1);
    expect(m.untouchedValue).toBe(40);
    // Removing the only key yields the one shared `empty`, and removing an
    // absent one yields the very trie it was handed — not an equal rebuild.
    expect(m.drainedIsTheSharedEmpty).toBe(true);
    expect(m.forgivingIsTheSameValue).toBe(true);
  });

  /**
   * Size is a maintained field, so every arm transition is a place it can drift:
   * unplaced → replaced (no growth), unplaced → settled (grows by one), settled
   * → placed growth, and back down to the shared empty.
   */
  test("size is maintained across every root transition", async () => {
    const m = await runTrie(
      BUILD +
        "let one: HashTrie(Int, Int) = singleton(1, 10)\n" +
        "export let atOne: Int = size(one)\n" +
        "export let afterReplace: Int = size(set(one, 1, 11))\n" +
        "export let afterSettle: Int = size(set(one, 2, 20))\n" +
        "export let afterThird: Int = size(set(set(one, 2, 20), 3, 30))\n" +
        "export let afterSettleThenReplace: Int = size(set(set(one, 2, 20), 1, 11))\n" +
        "export let afterDrop: Int = size(remove(set(one, 2, 20), 2))\n" +
        "export let afterDropBoth: Int = size(dropRange(set(one, 2, 20), 1, 2))\n" +
        // And `entries` agrees with the field at every one of them, which is the
        // check that would catch a size maintained independently of the shape.
        "export let settledEntries: Int = Seq.length(entries(set(one, 2, 20)))\n" +
        "export let droppedEntries: Int = Seq.length(entries(remove(set(one, 2, 20), 2)))\n",
    );
    expect(m.atOne).toBe(1);
    expect(m.afterReplace).toBe(1);
    expect(m.afterSettle).toBe(2);
    expect(m.afterThird).toBe(3);
    expect(m.afterSettleThenReplace).toBe(2);
    expect(m.afterDrop).toBe(1);
    expect(m.afterDropBoth).toBe(0);
    expect(m.settledEntries).toBe(2);
    expect(m.droppedEntries).toBe(1);
  });

  /**
   * Confinement, stated as the negative: no walker ever meets a `Sole`. The
   * three functions that take a `Tree` are reached only from the `Rooted` arm,
   * so a settled trie's root is a `Tree` constructor and never `Root`'s middle
   * arm — including after the deletion path has compacted it back to one entry,
   * which is the shape most likely to tempt a re-`Sole`.
   */
  test("a placed trie never returns to the unplaced arm, even at size one", async () => {
    const m = await runTrieWithIdentity(
      BUILD +
        "let settled: HashTrie(Int, Int) = set(singleton(1, 10), 2, 20)\n" +
        "let backToOne: HashTrie(Int, Int) = remove(settled, 2)\n" +
        "export let backSize: Int = size(backToOne)\n" +
        "export let backValue: Int = intOr(get(backToOne, 1), -1)\n" +
        "let wideThenNarrow: HashTrie(Int, Int) = dropRange(buildTo(60), 2, 60)\n" +
        "export let narrowSize: Int = size(wideThenNarrow)\n",
      [
        "export const backTag = backToOne.root.tag;",
        "export const narrowTag = wideThenNarrow.root.tag;",
      ],
    );
    expect(m.backSize).toBe(1);
    expect(m.backValue).toBe(10);
    expect(m.narrowSize).toBe(1);
    expect(m.backTag).toBe("Rooted");
    expect(m.narrowTag).toBe("Rooted");
  });
});

describe("HashTrie entries", () => {
  test("§7.1 yields exactly the pairs that were inserted", async () => {
    const m = await runTrie(
      BUILD +
        "let addKey(total: Int, pair: (Int, Int)): Int =\n" +
        "    let (key, _) = pair\n" +
        "    total + key\n" +
        "let addValue(total: Int, pair: (Int, Int)): Int =\n" +
        "    let (_, value) = pair\n" +
        "    total + value\n" +
        "let addProduct(total: Int, pair: (Int, Int)): Int =\n" +
        "    let (key, value) = pair\n" +
        "    total + key * value\n" +
        "let hundred: HashTrie(Int, Int) = buildTo(100)\n" +
        "export let count: Int = Seq.length(entries(hundred))\n" +
        "export let keySum: Int = Seq.fold(entries(hundred), 0, addKey)\n" +
        "export let valueSum: Int = Seq.fold(entries(hundred), 0, addValue)\n" +
        "export let productSum: Int = Seq.fold(entries(hundred), 0, addProduct)\n" +
        // The pairing itself: every value must be ten times its own key, which a
        // traversal that crossed two entries' halves would break while leaving
        // both sums intact.
        "let paired(pair: (Int, Int)): Bool =\n" +
        "    let (key, value) = pair\n" +
        "    value == key * 10\n" +
        "export let everyPairMatches: Bool = Seq.all(entries(hundred), paired)\n" +
        "let overwritten: HashTrie(Int, Int) = set(buildTo(100), 50, 5)\n" +
        "export let overwrittenValueSum: Int = Seq.fold(entries(overwritten), 0, addValue)\n",
    );
    expect(m.count).toBe(100);
    expect(m.keySum).toBe(5050);
    expect(m.valueSum).toBe(50500);
    // sum of k * 10k for k in 1..100 = 10 * 338350.
    expect(m.productSum).toBe(3383500);
    expect(m.everyPairMatches).toBe(true);
    // 50500 - 500 + 5.
    expect(m.overwrittenValueSum).toBe(50005);
  });

  /**
   * Two traversals of **one trie value** agree position for position. This is a
   * claim about determinism within an execution, and deliberately not a claim
   * about any two tries: placement is seeded, so nothing here may compare the
   * order of two separately built tries, however equal their entries.
   */
  test("§7.1 two traversals of one trie agree position for position", async () => {
    const m = await runTrie(
      BUILD +
        "let samePair(left: (Int, Int), right: (Int, Int)): Bool =\n" +
        "    let (leftKey, leftValue) = left\n" +
        "    let (rightKey, rightValue) = right\n" +
        "    leftKey == rightKey and leftValue == rightValue\n" +
        "let itself(value: Bool): Bool = value\n" +
        "let subject: HashTrie(Int, Int) = buildTo(300)\n" +
        "export let agree: Bool = Seq.all(Seq.zipWith(entries(subject), entries(subject), samePair), itself)\n" +
        // `zipWith` stops at the shorter side, so the length travels with the
        // agreement — otherwise two empty traversals would agree vacuously.
        "export let zippedLength: Int = Seq.length(Seq.zipWith(entries(subject), entries(subject), samePair))\n",
    );
    expect(m.agree).toBe(true);
    expect(m.zippedLength).toBe(300);
  });

  /**
   * `entries` is `Seq.unfold` over an explicit frame stack, so pulling one cell
   * descends one path and no more. That the *whole* trie is not walked is a
   * structural property of `unfold` rather than something a probe can count from
   * source — there is no instrumentation hook in the trie — so what is asserted
   * here is the observable half: a prefix is takeable, and taking it yields the
   * same first cells the full traversal starts with.
   */
  test("§7.1 a prefix of a large traversal is takeable", async () => {
    const m = await runTrie(
      BUILD +
        "let addKey(total: Int, pair: (Int, Int)): Int =\n" +
        "    let (key, _) = pair\n" +
        "    total + key\n" +
        "let subject: HashTrie(Int, Int) = buildTo(1000)\n" +
        "export let prefixLength: Int = Seq.length(Seq.take(entries(subject), 5))\n" +
        "export let prefixSum: Int = Seq.fold(Seq.take(entries(subject), 5), 0, addKey)\n" +
        "export let prefixAgain: Int = Seq.fold(Seq.take(entries(subject), 5), 0, addKey)\n" +
        "export let overTake: Int = Seq.length(Seq.take(entries(buildTo(3)), 99))\n",
    );
    expect(m.prefixLength).toBe(5);
    expect(m.prefixSum).toBe(m.prefixAgain);
    expect(typeof m.prefixSum).toBe("number");
    expect(m.overTake).toBe(3);
  });
});

describe("HashTrie bit intrinsics", () => {
  test("popcount over the boundary words", async () => {
    const m = await runTrie(
      "export let allBits: Int = bitCount(-1)\n" +
        "export let noBits: Int = bitCount(0)\n" +
        "export let oneBit: Int = bitCount(1)\n" +
        "export let topBit: Int = bitCount(bitSet(0, 31))\n" +
        "export let lowHalf: Int = bitCount(65535)\n" +
        "export let alternating: Int = bitCount(1431655765)\n" +
        "export let dense: Int = bitCount(bitClear(-1, 7))\n",
    );
    expect(m.allBits).toBe(32);
    expect(m.noBits).toBe(0);
    expect(m.oneBit).toBe(1);
    expect(m.topBit).toBe(1);
    expect(m.lowHalf).toBe(16);
    // 0x55555555 — every even bit.
    expect(m.alternating).toBe(16);
    expect(m.dense).toBe(31);
  });

  /**
   * `bitCountBelow` is the packed-slot index, and index 31 is where its mask
   * arithmetic is least obvious: `(1 << 31) - 1` is `-2147483649` as a Number,
   * and it is only `&`'s ToInt32 that turns it into `0x7fffffff`. Getting that
   * wrong would misplace exactly the highest child of every branch.
   */
  test("bitCountBelow at 0, at 31, and over dense bitmaps", async () => {
    const m = await runTrie(
      "export let belowZero: Int = bitCountBelow(-1, 0)\n" +
        "export let belowOne: Int = bitCountBelow(-1, 1)\n" +
        "export let belowSixteen: Int = bitCountBelow(-1, 16)\n" +
        "export let belowThirtyOne: Int = bitCountBelow(-1, 31)\n" +
        "export let emptyBelowThirtyOne: Int = bitCountBelow(0, 31)\n" +
        "let sparse: Int = bitSet(bitSet(bitSet(0, 0), 5), 31)\n" +
        "export let sparseBelowFive: Int = bitCountBelow(sparse, 5)\n" +
        "export let sparseBelowSix: Int = bitCountBelow(sparse, 6)\n" +
        "export let sparseBelowThirtyOne: Int = bitCountBelow(sparse, 31)\n" +
        "export let sparseCount: Int = bitCount(sparse)\n",
    );
    expect(m.belowZero).toBe(0);
    expect(m.belowOne).toBe(1);
    expect(m.belowSixteen).toBe(16);
    expect(m.belowThirtyOne).toBe(31);
    expect(m.emptyBelowThirtyOne).toBe(0);
    expect(m.sparseBelowFive).toBe(1);
    expect(m.sparseBelowSix).toBe(2);
    expect(m.sparseBelowThirtyOne).toBe(2);
    expect(m.sparseCount).toBe(3);
  });

  /**
   * A mixed hash is a signed 32-bit `Int`, so half of them have the high bit
   * set. `digit` must shift *unsigned*: with an arithmetic shift, `digit(-1, 30)`
   * would answer 31 instead of 3 and every negative hash would pile into the
   * root's last slot.
   */
  test("digit reads unsigned digits out of negative hashes", async () => {
    const m = await runTrie(
      "export let lowDigitOfMinusOne: Int = digit(-1, 0)\n" +
        "export let topDigitOfMinusOne: Int = digit(-1, 30)\n" +
        "export let midDigitOfMinusOne: Int = digit(-1, 25)\n" +
        "export let topDigitOfMinInt: Int = digit(-2147483648, 30)\n" +
        "export let lowDigitOfMinInt: Int = digit(-2147483648, 0)\n" +
        "export let topDigitOfMaxInt: Int = digit(2147483647, 30)\n" +
        "export let digitOfThirtyThree: Int = digit(33, 0)\n" +
        "export let shiftedDigitOfThirtyThree: Int = digit(33, 5)\n",
    );
    expect(m.lowDigitOfMinusOne).toBe(31);
    expect(m.topDigitOfMinusOne).toBe(3);
    expect(m.midDigitOfMinusOne).toBe(31);
    expect(m.topDigitOfMinInt).toBe(2);
    expect(m.lowDigitOfMinInt).toBe(0);
    expect(m.topDigitOfMaxInt).toBe(1);
    expect(m.digitOfThirtyThree).toBe(1);
    expect(m.shiftedDigitOfThirtyThree).toBe(1);
  });

  test("bitTest/bitSet/bitClear round-trip, including at bit 31", async () => {
    const m = await runTrie(
      "export let setThenTest: Bool = bitTest(bitSet(0, 31), 31)\n" +
        "export let setThenClear: Bool = bitTest(bitClear(bitSet(0, 31), 31), 31)\n" +
        "export let untouchedNeighbour: Bool = bitTest(bitClear(bitSet(bitSet(0, 30), 31), 31), 30)\n" +
        "export let testEmpty: Bool = bitTest(0, 0)\n" +
        "export let setIsIdempotent: Bool = bitSet(bitSet(0, 4), 4) == bitSet(0, 4)\n" +
        "export let clearIsIdempotent: Bool = bitClear(bitClear(-1, 4), 4) == bitClear(-1, 4)\n" +
        "export let clearOfAbsent: Bool = bitClear(0, 9) == 0\n" +
        "let full: Int = -1\n" +
        "let holed(): Int =\n" +
        "    var acc = full\n" +
        "    for i in 0..31\n" +
        "        acc := bitClear(acc, i)\n" +
        "    acc\n" +
        "export let clearedEverything: Int = holed()\n",
    );
    expect(m.setThenTest).toBe(true);
    expect(m.setThenClear).toBe(false);
    expect(m.untouchedNeighbour).toBe(true);
    expect(m.testEmpty).toBe(false);
    expect(m.setIsIdempotent).toBe(true);
    expect(m.clearIsIdempotent).toBe(true);
    expect(m.clearOfAbsent).toBe(true);
    expect(m.clearedEverything).toBe(0);
  });

  test("the packed-storage rows insert and remove at every position", async () => {
    const m = await runTrie(
      "let three: Node(Int) = nodeInsertAt(nodeInsertAt(nodeSingleton(10), 1, 20), 2, 30)\n" +
        "export let singletonHead: Int = Node.get(nodeSingleton(7), 0)\n" +
        "export let threeFirst: Int = Node.get(three, 0)\n" +
        "export let threeLast: Int = Node.get(three, 2)\n" +
        "let front: Node(Int) = nodeInsertAt(three, 0, 5)\n" +
        "export let frontHead: Int = Node.get(front, 0)\n" +
        "export let frontShifted: Int = Node.get(front, 1)\n" +
        "let middleGone: Node(Int) = nodeRemoveAt(three, 1)\n" +
        "export let middleGoneFirst: Int = Node.get(middleGone, 0)\n" +
        "export let middleGoneSecond: Int = Node.get(middleGone, 1)\n" +
        "let headGone: Node(Int) = nodeRemoveAt(three, 0)\n" +
        "export let headGoneFirst: Int = Node.get(headGone, 0)\n" +
        // Persistence: neither operation may disturb its argument.
        "export let originalIntact: Int = Node.get(three, 1)\n" +
        "export let overwritten: Int = Node.get(Node.set(three, 1, 99), 1)\n" +
        "export let overwrittenOriginal: Int = Node.get(three, 1)\n",
    );
    expect(m.singletonHead).toBe(7);
    expect(m.threeFirst).toBe(10);
    expect(m.threeLast).toBe(30);
    expect(m.frontHead).toBe(5);
    expect(m.frontShifted).toBe(10);
    expect(m.middleGoneFirst).toBe(10);
    expect(m.middleGoneSecond).toBe(30);
    expect(m.headGoneFirst).toBe(20);
    expect(m.originalIntact).toBe(20);
    expect(m.overwritten).toBe(99);
    expect(m.overwrittenOriginal).toBe(20);
  });
});

describe("HashTrie placement mix (Effects §6.2 species (b))", () => {
  test("mix is a function of its argument within one execution", async () => {
    const m = await runTrie(
      "export let stable: Bool = mix(12345) == mix(12345)\n" +
        "export let stableAcrossCalls: Bool = mix(0) == mix(0)\n" +
        "export let negativeStable: Bool = mix(-7) == mix(-7)\n" +
        "let distinct(): Int =\n" +
        "    var seen = 0\n" +
        "    for i in 1..64\n" +
        "        if mix(i) != mix(i + 1) then\n" +
        "            seen := seen + 1\n" +
        "    seen\n" +
        "export let neighboursDiffer: Int = distinct()\n" +
        // The result has to be a 32-bit `Int`, because `digit` reads it as one.
        "let inRange(): Int =\n" +
        "    var count = 0\n" +
        "    for i in 0..200\n" +
        "        if mix(i) >= -2147483648 and mix(i) <= 2147483647 then\n" +
        "            count := count + 1\n" +
        "    count\n" +
        "export let ranged: Int = inRange()\n" +
        // Placement spreads the low bits: consecutive keys must not all land in
        // one root slot, which is the whole reason the mix exists.
        "let rootSlots(): Int =\n" +
        "    var bitmap = 0\n" +
        "    for i in 0..31\n" +
        "        bitmap := bitSet(bitmap, digit(mix(i), 0))\n" +
        "    bitCount(bitmap)\n" +
        "export let occupiedRootSlots: Int = rootSlots()\n",
    );
    expect(m.stable).toBe(true);
    expect(m.stableAcrossCalls).toBe(true);
    expect(m.negativeStable).toBe(true);
    expect(m.neighboursDiffer).toBe(64);
    expect(m.ranged).toBe(201);
    // 32 keys over 32 slots: collisions are expected, a single slot is not.
    expect(m.occupiedRootSlots).toBeGreaterThan(10);
  });

  /**
   * A shape pin, kept loose on purpose: the mixer constant is latitude, but
   * *that a seed is created once at module scope and closed over* is the species
   * (b) claim itself, and a lowering that re-read the world per call would break
   * it silently.
   */
  test("the emitted module creates the seed once, outside the mixing function", () => {
    const project = compileFiles(
      [[PROBE_PATH, `${trieSource}\nexport let mixed: Int = mix(1)\n`]],
      { runtimePaths: [PROBE_PATH] },
    );
    expect(project.diagnostics).toEqual([]);
    const emitted = project.modules.find(({ source }) => source.path === PROBE_PATH);
    expect(emitted).toBeDefined();
    const javascript = emitted!.javascript.text;
    // One seed, created once, at helper scope.
    expect(javascript.match(/Math\.random\(\)/gu)?.length).toBe(1);
    const seed = javascript.match(/const (__seed) = \(Math\.random\(\) \* 0x100000000\) \| 0;/u);
    expect(seed).not.toBeNull();
    // The mixing arrow reads that binding rather than the world.
    expect(javascript).toMatch(/__value \^ __seed/u);
    expect(javascript).toMatch(/Math\.imul/u);
    // And the SWAR popcount is there rather than a loop.
    expect(javascript).toMatch(/0x55555555/u);
  });
});

/**
 * The seat rule, made checkable — `vector-trie-wiring.test.ts`'s pin for the
 * other runtime module, applied to this one.
 *
 * `HashTrie.hex` sits before `Vector.hex` and must never reach it: a vector
 * literal, bracket, pattern or `Vector.` call written in it would make the
 * emitted `HashTrie.js` import `Vector.js`, and `Vector.js` already imports
 * `VectorTrie.js` — coupling this trie to a runtime it has no use for, through
 * an edge created at emission that no `Import` item records and no acyclicity
 * check can see.
 */
describe("the emitted module's import surface", () => {
  test("imports only prelude members seated before Vector.hex, and never Vector itself", () => {
    const project = compileFiles(
      [[
        PROBE_PATH,
        `${trieSource}\n` +
        "let sample: HashTrie(Int, Int) = set(empty, 1, 2)\n" +
        "export let probe: Int = size(sample) + Seq.length(entries(sample))\n",
      ]],
      { runtimePaths: [PROBE_PATH] },
    );
    expect(project.diagnostics).toEqual([]);
    const emitted = project.modules.find(({ source }) => source.path === PROBE_PATH);
    expect(emitted).toBeDefined();
    const specifiers = [
      ...emitted!.javascript.text.matchAll(/^\s*import\b[^;\n]*?from\s+"([^"]+)";/gmu),
    ].map((match) => match[1]!);

    expect(specifiers).not.toContain("./Vector.js");
    expect(specifiers).not.toContain("./VectorTrie.js");
    const seatedBefore = PRELUDE_MODULES
      .map(({ basename }) => `./${basename.replace(/\.hex$/u, ".js")}`)
      .slice(0, PRELUDE_MODULES.findIndex(({ basename }) => basename === "Vector.hex"));
    for (const specifier of specifiers) expect(seatedBefore).toContain(specifier);
    // And it really does import — an empty list would pass the loop vacuously.
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers).toContain("./Seq.js");
  });
});

/**
 * The privilege widening #365 took: a module compiled as a runtime module holds
 * the intrinsic door as well as the `Node` fallback (`spec/intrinsics.md` §5.2's
 * runtime bullet). Both routes to that role are pinned, and so is the refusal
 * that still stands for everyone else — the widening is a grant to a compilation
 * role, not a hole in the gate.
 */
describe("runtime modules hold the intrinsic door (§5.2)", () => {
  const DOOR =
    'extern from "hex:intrinsic"\n' +
    "    fun hashTrieBitCount as popcount(bitmap: Int): Int\n" +
    "    fun hashTrieNodeSingleton as one(value: a): Node(a)\n" +
    "let counted: Int = popcount(-1)\n" +
    "let held: Node(Int) = one(counted)\n" +
    "export let answer: Int = Node.get(held, 0)\n";

  test("a runtimePaths-granted module may declare a door block", () => {
    const project = compileFiles([["/Granted.hex", DOOR]], {
      runtimePaths: ["/Granted.hex"],
    });
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("the grant reaches emission, not only checking", async () => {
    const m = await runProject([["/Granted.hex", DOOR]], {
      runtimePaths: ["/Granted.hex"],
      entry: "/Granted.hex",
    });
    expect(m.answer).toBe(32);
  });

  test("an ungranted module is still refused, and `Node` with it", () => {
    const project = compileFiles([["/Ordinary.hex", DOOR]]);
    const messages = project.diagnostics.map(({ message }) => message);
    expect(messages).toContain(
      "the `hex:` specifier scheme is reserved to standard-library source; " +
        "to bind your own JavaScript implementation, use an ordinary `extern from` " +
        "block naming your module",
    );
    // The door never resolved, so nothing below it can have typechecked either.
    expect(messages.length).toBeGreaterThan(1);
  });

  /**
   * The widening's **other** consequence, recorded because it was found by
   * auditing every `#privileged` consumer rather than by wanting it.
   *
   * `privileged` gates two things in the resolver, not one. The door is the
   * intended half. The other is the pre-registered-constraint seed
   * (`resolver.ts`, `NON_REDECLARABLE_CONSTRAINTS`): privileged source may
   * declare a pre-registered constraint name, because there such a declaration
   * is the standard library *supplying* the declaration the compiler holds by
   * name (#335), not an unreachable twin. A runtime module now inherits that.
   *
   * It is inert where it landed — a runtime module exports nothing, so a
   * constraint declared in one is reachable from no module — but it is a real
   * behavioural difference from an ordinary module, and this pins it so the next
   * reader finds it audited rather than accidental.
   */
  test("a granted module also inherits the pre-registered-constraint carve-out", () => {
    const declaration = "constraint Integral<a: (Num, Ord)> =\n" +
      "    div(left: a, right: a): a\n" +
      "    mod(left: a, right: a): a\n" +
      "    quot(left: a, right: a): a\n" +
      "    rem(left: a, right: a): a\n";
    expect(
      compileFiles([["/Ordinary.hex", declaration]]).diagnostics.map(({ message }) => message),
    ).toEqual(["constraint `Integral` is pre-registered and cannot be redeclared"]);
    expect(
      compileFiles([["/Granted.hex", declaration]], { runtimePaths: ["/Granted.hex"] })
        .diagnostics.map(({ message }) => message),
    ).toEqual([]);
  });

  /**
   * The `Node`-cannot-cross-the-boundary rule is unchanged for *foreign* externs;
   * only the intrinsic door is exempt (#365). A granted module that points the
   * same declaration at a real JavaScript module is still refused.
   */
  test("a foreign extern still cannot name Node, grant or no grant", () => {
    const project = compileFiles(
      [["/Granted.hex", 'extern from "./host.js"\n    fun one(value: Int): Node(Int)\n']],
      { runtimePaths: ["/Granted.hex"] },
    );
    expect(project.diagnostics.map(({ message }) => message)).toContain(
      "extern declaration `one` names the hidden `Node` intrinsic, " +
        "which cannot cross the foreign boundary",
    );
  });
});
