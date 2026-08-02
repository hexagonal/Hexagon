/**
 * Tarjan's strongly-connected components, in **reverse topological order** — a
 * component is emitted only after every component it depends on. Two passes
 * lean on that guarantee: the checker orders function definitions by it
 * (functions.md §4.1/§4.2, issue #66), and the variance analysis solves each
 * declaration cycle only once its dependencies are final (closure doc
 * `decisions-ml-dialect-generalization-2026-08.md` §6.3).
 *
 * A **self-referencing node comes back as a one-member component**, exactly like
 * a node with no edges at all — Tarjan does not distinguish the two, and callers
 * that read a component as "solve these together" get the self-reference inside
 * the set rather than outside it. The variance analysis depends on that and would
 * be wrong without it: `Chain(+a) = { pull: () -> Option((a, Chain(a))) }` must
 * read its own inner `Chain` through the fixpoint's running estimate, and reading
 * it as an outsider would consult the bare parameter it is in the middle of
 * verifying — the claim would be refused by the declaration it is being computed
 * for (closure doc §6.3).
 *
 * Successors outside `nodes` are ignored, so a caller may hand in a subgraph
 * without first filtering its own edge function. Deterministic given the node and
 * successor order supplied by the caller.
 */
export function stronglyConnectedComponents<T>(
  nodes: readonly T[],
  successors: (node: T) => readonly T[],
): T[][] {
  const nodeSet = new Set(nodes);
  const index = new Map<T, number>();
  const lowlink = new Map<T, number>();
  const onStack = new Set<T>();
  const stack: T[] = [];
  const components: T[][] = [];
  let counter = 0;
  const connect = (v: T): void => {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of successors(v)) {
      if (!nodeSet.has(w)) continue;
      if (!index.has(w)) {
        connect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const component: T[] = [];
      let w: T;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  };
  for (const node of nodes) {
    if (!index.has(node)) connect(node);
  }
  return components;
}
