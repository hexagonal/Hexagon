/**
 * The playground's stand-ins for `node:fs` and `node:process`
 * (`spec/program-io.md` §6).
 *
 * `Hex.File`, `Hex.Stdio` and `Hex.Process` call Node through ordinary
 * `extern` blocks, so the playground links these two small modules beneath
 * them and runs the same emitted bytes Node runs. A program sees a terminal
 * with no arguments, in an empty directory on a file system that can't be
 * written to, with the input box as its standard input:
 *
 * - every read of a path answers `ENOENT`, and every write `EROFS`, with
 *   Node's own message for each, whatever the path;
 * - `readSync` from descriptor 0 answers the input box's text, as UTF-8 bytes,
 *   from its start, and 0 once all of it has been read, as a file given as
 *   `< input.txt` would;
 * - `writeSync` to descriptor 1 or 2 sends its text to the output pane, in
 *   order with `Debug.log`'s lines, and descriptor 2's is marked;
 * - `process.argv` holds Node's executable and a script and nothing after
 *   them, `process.execArgv` is empty, and `process.exitCode` is kept for the
 *   pane to show when the run finishes.
 *
 * Each stand-in answers only what the three modules call (§9). They reach the
 * run through one object the worker installs on the global object before it
 * imports the program, since a module made from a Blob can close over nothing
 * of the worker's.
 */

/** Where a stand-in's text goes: the program's stdout or its stderr. */
export type OutputStream = "stdout" | "stderr";

/** What the stand-ins share with the worker for one run. */
export interface PlaygroundHost {
  /** Sends text a program wrote to the pane. */
  readonly write: (stream: OutputStream, text: string) => void;
  /** The status the program set, `undefined` until it sets one. */
  exitCode: number | undefined;
  /** The status `process.exit` was called with, once it has been. */
  exited: number | undefined;
  /** The input box's text as the run's standard input, encoded as UTF-8. */
  readonly input: Uint8Array;
  /** How many of `input`'s bytes `readSync` has answered so far. */
  inputRead: number;
}

/** The global key the stand-ins find their run's host under. */
export const HOST_KEY = "hexagon.playground.host";

/**
 * The stand-in modules' source text, by the specifier the emitted modules
 * import them under.
 *
 * The bytes a `writeSync` call is handed are decoded during the call and
 * nothing of them is kept: the writer reuses its array for the next write.
 * Each write is decoded on its own and keeps a leading U+FEFF, as Node writes
 * it. A write is always whole, since the pane never pushes back. A read copies
 * the next of the input's bytes into the array it is handed, so the reader
 * never meets `EAGAIN`.
 */
export const NODE_STAND_INS: ReadonlyMap<string, string> = new Map([
  ["node:fs", `const host = globalThis[Symbol.for(${JSON.stringify(HOST_KEY)})];
const failure = (code, errno, message, path) =>
  Object.assign(new Error(message), { errno, code, syscall: "open", path });
export function readFileSync(path) {
  throw failure("ENOENT", -2, "ENOENT: no such file or directory, open '" + path + "'", path);
}
export function writeFileSync(path) {
  throw failure("EROFS", -30, "EROFS: read-only file system, open '" + path + "'", path);
}
export function readSync(descriptor, bytes, offset, length) {
  const next = host.input.subarray(host.inputRead, host.inputRead + length);
  bytes.set(next, offset);
  host.inputRead += next.length;
  return next.length;
}
export function writeSync(descriptor, bytes, offset, length) {
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(offset, offset + length));
  host.write(descriptor === 2 ? "stderr" : "stdout", text);
  return length;
}
`],
  ["node:process", `const host = globalThis[Symbol.for(${JSON.stringify(HOST_KEY)})];
const ended = Symbol("process.exit");
const process = {
  get argv() { return ["/usr/local/bin/node", "/main.js"]; },
  get execArgv() { return []; },
  get exitCode() { return host.exitCode; },
  set exitCode(status) { host.exitCode = status; },
  exit(status) { host.exited = status; throw ended; },
};
export default process;
`],
]);

/** Installs `host` where the stand-ins look for it, for the run about to start. */
export function installHost(host: PlaygroundHost): void {
  (globalThis as Record<symbol, unknown>)[Symbol.for(HOST_KEY)] = host;
}
