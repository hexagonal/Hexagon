/**
 * Runs a compiled program's modules in Node, as the execution worker runs them
 * in the browser, answering what the program printed and whether it threw, and
 * what. A program may throw `undefined`, so `threw` says whether it did. For
 * tests only.
 *
 * The modules are written to a fresh directory at their own addresses and the
 * entry is imported from there, so the compiler's relative specifiers resolve
 * as written. A fresh directory is a fresh module graph: the emitted prelude is
 * identical for every program, and sharing one instance of `Debug.js` across
 * runs would share the sink it captured at initialization, so every run after
 * the first would print into the previous run's collector. The worker gets the
 * same from a fresh `Blob` URL per module per run, which Node cannot import. A
 * `data:` URL per module, the stand-in the harnesses used before, copies every
 * dependency's text into each importer's URL, so its length grows with the
 * number of paths through the graph: it passed what a string can hold once
 * `Vector.js` imported the `Ord` dictionaries its sorts take, and a program
 * using `Rat` took seconds to link once `Seq.js` imported the numeric
 * companions its editions take.
 *
 * `vite.config.ts` hands the `hex-example-` directories to Node's own loader,
 * which refuses a graph whose modules disagree on a name when it links, as the
 * browser does; Vite's module runner would load it. Node is reached through
 * non-literal specifiers because the playground carries no Node type
 * definitions.
 */
export async function runModules(
  label: string,
  modules: readonly { readonly path: string; readonly javascript: string }[],
  entryPath: string,
): Promise<{ readonly printed: readonly string[]; readonly threw: boolean; readonly failure: unknown }> {
  const fsName = "node:fs";
  const osName = "node:os";
  const pathName = "node:path";
  const urlName = "node:url";
  const fs = await import(/* @vite-ignore */ fsName) as {
    mkdtempSync: (prefix: string) => string;
    mkdirSync: (path: string, options: { recursive: boolean }) => void;
    writeFileSync: (path: string, data: string) => void;
    rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  };
  const os = await import(/* @vite-ignore */ osName) as { tmpdir: () => string };
  const paths = await import(/* @vite-ignore */ pathName) as {
    join: (...parts: string[]) => string;
    dirname: (of: string) => string;
  };
  const url = await import(/* @vite-ignore */ urlName) as {
    pathToFileURL: (of: string) => { readonly href: string };
  };

  const root = fs.mkdtempSync(paths.join(os.tmpdir(), `hex-example-${label}-`));
  const log = console.log;
  const printed: string[] = [];
  try {
    fs.writeFileSync(paths.join(root, "package.json"), '{ "type": "module" }\n');
    const fileOf = (path: string): string =>
      paths.join(root, path.replace(/^\//u, "").replace(/\.hex$/u, ".js"));
    for (const module of modules) {
      const target = fileOf(module.path);
      fs.mkdirSync(paths.dirname(target), { recursive: true });
      fs.writeFileSync(target, module.javascript);
    }
    console.log = (...values: readonly unknown[]) => {
      printed.push(values.map((value) => String(value)).join(" "));
    };
    try {
      await import(/* @vite-ignore */ url.pathToFileURL(fileOf(entryPath)).href);
    } catch (failure: unknown) {
      return { printed, threw: true, failure };
    }
    return { printed, threw: false, failure: undefined };
  } finally {
    console.log = log;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
