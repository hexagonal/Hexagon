// Lets tests load `.hex` fixtures as strings via Vite/vitest's `?raw` transform
// without pulling in Node filesystem types. Compiler tests run under vitest (Vite).
declare module "*.hex?raw" {
  const content: string;
  export default content;
}

// The same transform, ranged over a directory rather than one named file: it
// lets a test enumerate `.hex` fixtures instead of listing them, which is what
// keeps the prelude drift guard correct as members join the set. Declared to
// exactly the call shape in use, for the same reason as above — no Vite client
// types, no Node filesystem types.
interface ImportMeta {
  glob(
    pattern: string,
    options: { readonly eager: true; readonly query: "?raw"; readonly import: "default" },
  ): Record<string, string>;
}
