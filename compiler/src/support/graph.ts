/**
 * Tarjan's strongly-connected components, in **reverse topological order** — a
 * component is emitted only after every component it depends on. Two passes
 * lean on that guarantee: the checker orders function definitions by it
 * (functions.md §4.1/§4.2, issue #66), and the variance analysis solves each
 * declaration cycle only once its dependencies are final (closure doc
 * `decisions-ml-dialect-generalization-2026-08.md` §6.3).
 *
 * Successors outside `nodes` are ignored, so a caller may hand in a subgraph
 * without first filtering its own edge function.
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
