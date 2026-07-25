// Lets tests load `.hex` fixtures as strings via Vite/vitest's `?raw` transform
// without pulling in Node filesystem types. Compiler tests run under vitest (Vite).
declare module "*.hex?raw" {
  const content: string;
  export default content;
}
