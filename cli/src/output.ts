import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const RECORD_NAME = ".hexc-output.json";
const LOCK_NAME = ".hexc-output.lock";
const INTERRUPTED_NAME = ".hexc-output-interrupted";
const TRANSACTION_PREFIX = ".hexc-output-transaction-";
const RECORD_VERSION = 1;

interface OwnedFile {
  path: string;
  sha256: string;
}

interface OwnershipRecord {
  formatVersion: 1;
  projectDirectory: string;
  compilerVersion: string;
  roots: string[];
  files: OwnedFile[];
}

export class OutputError extends Error {
  public override readonly name = "OutputError";
}

export interface WriteOutputOptions {
  projectDirectory: string;
  outputDirectory: string;
  artifacts: ReadonlyMap<string, string>;
  roots: readonly string[];
  version: string;
  protectedPaths: readonly string[];
  dependencyDirectories: readonly string[];
}

export async function writeOutput(options: WriteOutputOptions): Promise<void> {
  validateAbsoluteInputs(options);

  const projectDirectory = await canonicalExistingDirectory(
    options.projectDirectory,
    "project directory",
  );
  const outputDirectory = await canonicalProspectiveOutputPath(options.outputDirectory);
  const dependencyDirectories = await Promise.all(
    options.dependencyDirectories.map((path) => canonicalPath(path)),
  );
  const protectedPaths = await Promise.all(
    options.protectedPaths.map((path) => canonicalPath(path)),
  );

  if (sameCanonicalPath(outputDirectory, projectDirectory)) {
    throw new OutputError("The output directory cannot be the project root.");
  }
  for (const dependencyDirectory of dependencyDirectories) {
    if (isWithin(outputDirectory, dependencyDirectory)) {
      throw new OutputError(
        `The output directory is inside dependency directory ${dependencyDirectory}.`,
      );
    }
  }
  for (const protectedPath of protectedPaths) {
    if (isWithin(protectedPath, outputDirectory)) {
      throw new OutputError(
        `The output directory would contain protected input ${protectedPath}.`,
      );
    }
  }

  const desired = validateArtifacts(options.artifacts);
  await createAndValidateOutputDirectory(outputDirectory);

  const lockPath = join(outputDirectory, LOCK_NAME);
  await rejectSymlink(lockPath, "output lock");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    throw new OutputError(
      `Cannot acquire the output lock ${lockPath}; another build may be writing this directory.`,
      { cause: error },
    );
  }

  let completed = false;
  try {
    try {
      await runLocked({
        ...options,
        projectDirectory,
        outputDirectory,
        protectedPaths,
        desired,
      });
    } catch (error) {
      if (error instanceof OutputError) throw error;
      throw new OutputError(`Could not write build output: ${message(error)}`, { cause: error });
    }
    completed = true;
  } finally {
    const cleanupErrors: string[] = [];
    let lockClosed = true;
    await lock.close().catch((error: unknown) => {
      lockClosed = false;
      cleanupErrors.push(`close lock: ${message(error)}`);
    });
    if (lockClosed) {
      await unlink(lockPath).catch((error: unknown) =>
        cleanupErrors.push(`remove lock: ${message(error)}`),
      );
    }
    if (completed && cleanupErrors.length > 0) {
      throw new OutputError(
        `Build output was committed, but output-lock cleanup failed: ${cleanupErrors.join("; ")}. Remove ${lockPath} after confirming no build is running.`,
      );
    }
  }
}

interface LockedOptions extends WriteOutputOptions {
  projectDirectory: string;
  outputDirectory: string;
  protectedPaths: string[];
  desired: Map<string, string>;
}

async function runLocked(options: LockedOptions): Promise<void> {
  const recordPath = join(options.outputDirectory, RECORD_NAME);
  const interruptedPath = join(options.outputDirectory, INTERRUPTED_NAME);
  await rejectSymlink(recordPath, "ownership record");
  await rejectSymlink(interruptedPath, "interrupted-transaction marker");
  if (await exists(interruptedPath)) {
    throw new OutputError(
      `Output contains ${INTERRUPTED_NAME} from an interrupted build. Preserve the directory and inspect the recovery location recorded there before rebuilding.`,
    );
  }

  const previous = await readOwnershipRecord(recordPath);
  if (previous !== undefined) {
    const previousOwner = await canonicalExistingDirectory(
      previous.projectDirectory,
      "project directory in the output ownership record",
    );
    if (previousOwner !== previous.projectDirectory) {
      throw new OutputError(
        `Output ownership record contains a non-canonical project directory: ${previous.projectDirectory}.`,
      );
    }
    if (!sameCanonicalPath(previousOwner, options.projectDirectory)) {
      throw new OutputError(
        `Output is owned by another project: ${previous.projectDirectory}.`,
      );
    }
  }

  const previousFiles = new Map(
    previous?.files.map((file) => [file.path, file.sha256]) ?? [],
  );
  const caseRenameDirectories = await preflightPaths(options, previousFiles);

  const transactionDirectory = join(
    options.outputDirectory,
    `${TRANSACTION_PREFIX}${randomUUID()}`,
  );
  const stagedDirectory = join(transactionDirectory, "staged");
  const backupDirectory = join(transactionDirectory, "backup");
  try {
    await mkdir(stagedDirectory, { recursive: true });
    for (const [path, contents] of options.desired) {
      const stagedPath = join(stagedDirectory, path);
      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, contents, { encoding: "utf8", flag: "wx" });
    }
  } catch (error) {
    await rm(transactionDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw new OutputError(
      `Could not stage build output; previous output was left unchanged: ${message(error)}`,
      { cause: error },
    );
  }

  const nextRecord: OwnershipRecord = {
    formatVersion: RECORD_VERSION,
    projectDirectory: options.projectDirectory,
    compilerVersion: options.version,
    roots: [...options.roots],
    files: [...options.desired]
      .map(([path, contents]) => ({ path, sha256: hash(contents) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const recordTemporaryPath = join(transactionDirectory, RECORD_NAME);
  try {
    await writeFile(
      recordTemporaryPath,
      `${JSON.stringify(nextRecord, undefined, 2)}\n`,
      "utf8",
    );
    await writeFile(
      interruptedPath,
      `${JSON.stringify({ recoveryDirectory: transactionDirectory })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    await rm(transactionDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw new OutputError(
      `Could not prepare the output transaction; previous output was left unchanged: ${message(error)}`,
      { cause: error },
    );
  }

  const backedUp: string[] = [];
  const installed: string[] = [];
  const createdDirectories: string[] = [];
  let recordBackedUp = false;
  let committed = false;

  try {
    for (const path of [...previousFiles.keys()].sort()) {
      const destination = join(options.outputDirectory, path);
      if (!(await exists(destination))) continue;
      const backup = join(backupDirectory, path);
      await mkdir(dirname(backup), { recursive: true });
      await rename(destination, backup);
      backedUp.push(path);
    }

    for (const directory of [...caseRenameDirectories].sort((left, right) => right.length - left.length)) {
      await rmdir(join(options.outputDirectory, directory));
    }

    for (const path of [...options.desired.keys()].sort()) {
      const destination = join(options.outputDirectory, path);
      await createOutputParents(
        dirname(destination),
        options.outputDirectory,
        createdDirectories,
      );
      await rename(join(stagedDirectory, path), destination);
      installed.push(path);
    }

    if (await exists(recordPath)) {
      await mkdir(backupDirectory, { recursive: true });
      await rename(recordPath, join(backupDirectory, RECORD_NAME));
      recordBackedUp = true;
    }
    await rename(recordTemporaryPath, recordPath);
    committed = true;
  } catch (error) {
    const recoveryErrors = await rollback({
      options,
      recordPath,
      backupDirectory,
      backedUp,
      installed,
      createdDirectories,
      recordBackedUp,
    });
    if (recoveryErrors.length === 0) {
      await unlink(interruptedPath).catch(() => undefined);
      await rm(transactionDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw new OutputError(
        `Writing build output failed; previous output was restored: ${message(error)}`,
        { cause: error },
      );
    }
    throw new OutputError(
      `Writing build output failed and recovery was incomplete. Inspect ${transactionDirectory}. Affected files: ${[
        ...new Set([...installed, ...backedUp]),
      ].join(", ") || "none"}. Recovery errors: ${recoveryErrors.join("; ")}`,
      { cause: error },
    );
  }

  if (committed) {
    try {
      await unlink(interruptedPath);
    } catch (error) {
      throw new OutputError(
        `Build output was committed, but its interrupted-transaction marker could not be removed. Inspect ${transactionDirectory}: ${message(error)}`,
        { cause: error },
      );
    }
    try {
      await rm(transactionDirectory, { recursive: true, force: true });
    } catch (error) {
      throw new OutputError(
        `Build output was committed, but transaction cleanup failed. Inspect ${transactionDirectory}: ${message(error)}`,
        { cause: error },
      );
    }
    await removeEmptyOwnedDirectories(
      options.outputDirectory,
      [...previousFiles.keys()].filter((path) => !options.desired.has(path)),
    );
  }
}

async function rollback(args: {
  options: LockedOptions;
  recordPath: string;
  backupDirectory: string;
  backedUp: string[];
  installed: string[];
  createdDirectories: string[];
  recordBackedUp: boolean;
}): Promise<string[]> {
  const errors: string[] = [];
  for (const path of [...args.installed].reverse()) {
    try {
      await unlink(join(args.options.outputDirectory, path));
    } catch (error) {
      errors.push(`remove ${path}: ${message(error)}`);
    }
  }
  for (const directory of [...new Set(args.createdDirectories)].sort(
    (left, right) => right.length - left.length,
  )) {
    await rmdir(directory).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") {
        errors.push(`remove created directory ${directory}: ${message(error)}`);
      }
    });
  }
  for (const path of [...args.backedUp].reverse()) {
    try {
      const destination = join(args.options.outputDirectory, path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(args.backupDirectory, path), destination);
    } catch (error) {
      errors.push(`restore ${path}: ${message(error)}`);
    }
  }
  if (args.recordBackedUp) {
    try {
      if (await exists(args.recordPath)) await unlink(args.recordPath);
      await rename(join(args.backupDirectory, RECORD_NAME), args.recordPath);
    } catch (error) {
      errors.push(`restore ${RECORD_NAME}: ${message(error)}`);
    }
  }
  return errors;
}

async function preflightPaths(
  options: LockedOptions,
  previousFiles: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  validateRelativePaths(previousFiles.keys(), "ownership record");
  rejectCaseCollisions([...previousFiles.keys()], "ownership record");
  const allPaths = [...previousFiles.keys(), ...options.desired.keys()];
  rejectParentChildCollisions(allPaths, "combined output set");

  const caseRenameDirectories = new Set<string>();
  for (const path of new Set([...previousFiles.keys(), ...options.desired.keys()])) {
    await validateOutputPath(
      options.outputDirectory,
      path,
      previousFiles,
      caseRenameDirectories,
    );
    const absolute = join(options.outputDirectory, path);
    for (const protectedPath of options.protectedPaths) {
      if (sameCanonicalPath(absolute, protectedPath)) {
        throw new OutputError(`Generated output would overwrite protected input ${protectedPath}.`);
      }
    }
  }

  for (const [path, savedHash] of previousFiles) {
    const absolute = join(options.outputDirectory, path);
    const status = await optionalLstat(absolute);
    if (status === undefined) continue;
    if (!status.isFile()) {
      throw new OutputError(`Owned output ${path} is no longer a regular file; refusing to replace it.`);
    }
    const actualHash = hash(await readFile(absolute));
    if (actualHash !== savedHash) {
      throw new OutputError(`Owned output ${path} was modified; preserve it before rebuilding.`);
    }
  }

  for (const path of options.desired.keys()) {
    if (previousFiles.has(path)) continue;
    const desiredAbsolute = join(options.outputDirectory, path);
    if (!(await exists(desiredAbsolute))) continue;
    const previousVariant = [...previousFiles.keys()].find(
      (previousPath) => foldPath(previousPath) === foldPath(path),
    );
    if (
      previousVariant === undefined ||
      !(await samePhysicalEntry(desiredAbsolute, join(options.outputDirectory, previousVariant)))
    ) {
      throw new OutputError(`Generated output ${path} would overwrite an unowned file.`);
    }
  }
  return caseRenameDirectories;
}

function validateArtifacts(artifacts: ReadonlyMap<string, string>): Map<string, string> {
  validateRelativePaths(artifacts.keys(), "artifact set");
  const paths = [...artifacts.keys()];
  rejectCaseCollisions(paths, "artifact set");
  rejectParentChildCollisions(paths, "artifact set");
  return new Map([...artifacts].sort(([left], [right]) => left.localeCompare(right)));
}

function validateRelativePaths(paths: Iterable<string>, source: string): void {
  for (const path of paths) {
    const pieces = path.split("/");
    if (
      path.length === 0 ||
      isAbsolute(path) ||
      path.includes("\\") ||
      path.includes(":") ||
      pieces.some((piece) => piece === "" || piece === "." || piece === "..") ||
      path.includes("\0")
    ) {
      throw new OutputError(`Invalid relative output path ${JSON.stringify(path)} in ${source}.`);
    }
    const first = pieces[0]?.toLocaleLowerCase("en-US");
    if (
      first === RECORD_NAME ||
      first === LOCK_NAME ||
      first === INTERRUPTED_NAME ||
      first?.startsWith(TRANSACTION_PREFIX)
    ) {
      throw new OutputError(`Output path ${path} uses a reserved Hexagon metadata name.`);
    }
  }
}

function rejectCaseCollisions(paths: readonly string[], source: string): void {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const folded = foldPath(path);
    const prior = seen.get(folded);
    if (prior !== undefined && prior !== path) {
      throw new OutputError(`Case-colliding output paths ${prior} and ${path} in ${source}.`);
    }
    seen.set(folded, path);
  }
}

function rejectParentChildCollisions(paths: readonly string[], source: string): void {
  const folded = new Set(paths.map(foldPath));
  for (const path of paths) {
    const pieces = path.split("/");
    for (let length = 1; length < pieces.length; length += 1) {
      const parent = foldPath(pieces.slice(0, length).join(sep));
      if (folded.has(parent)) {
        throw new OutputError(`Output path ${path} is nested beneath a file in ${source}.`);
      }
    }
  }
}

async function validateOutputPath(
  outputDirectory: string,
  relativePath: string,
  previousFiles: ReadonlyMap<string, string>,
  caseRenameDirectories: Set<string>,
): Promise<void> {
  let current = outputDirectory;
  const pieces = relativePath.split("/");
  const actualPieces: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    const entries = await readdir(current).catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    });
    const differentCase = entries.find(
      (entry) => entry !== piece && fold(entry) === fold(piece),
    );
    if (differentCase !== undefined) {
      const existingRelative = [
        ...actualPieces,
        differentCase,
        ...pieces.slice(index + 1),
      ].join("/");
      const isOwnedFileCaseRename =
        index === pieces.length - 1 && previousFiles.has(existingRelative);
      const existingDirectory = [...actualPieces, differentCase].join("/");
      const matchesOwnedPath = [...previousFiles.keys()].some(
        (previousPath) =>
          foldPath(previousPath) === foldPath(relativePath) &&
          previousPath.startsWith(`${existingDirectory}/`),
      );
      const ownedDirectoryTree =
        index < pieces.length - 1 && matchesOwnedPath
          ? await collectWhollyOwnedDirectories(
              outputDirectory,
              existingDirectory,
              previousFiles,
            )
          : undefined;
      const isOwnedDirectoryCaseRename = ownedDirectoryTree !== undefined;
      if (!isOwnedFileCaseRename && !isOwnedDirectoryCaseRename) {
        throw new OutputError(
          `Output path ${relativePath} case-collides with existing ${join(relative(outputDirectory, current), differentCase)}.`,
        );
      }
      if (ownedDirectoryTree !== undefined) {
        for (const directory of ownedDirectoryTree) caseRenameDirectories.add(directory);
      }
      actualPieces.push(differentCase);
    } else {
      actualPieces.push(piece);
    }
    current = join(current, piece);
    const status = await optionalLstat(current);
    if (status?.isSymbolicLink()) {
      throw new OutputError(`Output path ${relativePath} traverses symbolic link ${current}.`);
    }
    if (status !== undefined && current !== join(outputDirectory, relativePath) && !status.isDirectory()) {
      throw new OutputError(`Output path ${relativePath} has non-directory parent ${current}.`);
    }
    if (status === undefined) break;
  }
}

async function collectWhollyOwnedDirectories(
  outputDirectory: string,
  relativeDirectory: string,
  previousFiles: ReadonlyMap<string, string>,
): Promise<Set<string> | undefined> {
  const pending = [relativeDirectory];
  const directories = new Set<string>();
  while (pending.length > 0) {
    const directory = pending.pop()!;
    directories.add(directory);
    for (const entry of await readdir(join(outputDirectory, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new OutputError(`Owned output directory ${relativeDirectory} contains symbolic link ${path}.`);
      }
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (!entry.isFile() || !previousFiles.has(path)) {
        return undefined;
      }
    }
  }
  return directories;
}

async function createOutputParents(
  directory: string,
  outputDirectory: string,
  createdDirectories: string[],
): Promise<void> {
  const missing: string[] = [];
  let current = directory;
  while (current !== outputDirectory && !(await exists(current))) {
    missing.unshift(current);
    current = dirname(current);
  }
  for (const path of missing) {
    await mkdir(path);
    createdDirectories.push(path);
  }
}

async function samePhysicalEntry(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function readOwnershipRecord(path: string): Promise<OwnershipRecord | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new OutputError(`Cannot read output ownership record ${path}: ${message(error)}`, {
      cause: error,
    });
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OutputError(`Output ownership record ${path} is malformed JSON.`, { cause: error });
  }
  if (!isOwnershipRecord(value)) {
    throw new OutputError(`Output ownership record ${path} is malformed or unsupported.`);
  }
  const recordPaths = value.files.map((file) => file.path);
  if (new Set(recordPaths).size !== recordPaths.length) {
    throw new OutputError(`Output ownership record ${path} contains duplicate file paths.`);
  }
  validateRelativePaths(value.files.map((file) => file.path), "ownership record");
  return value;
}

function isOwnershipRecord(value: unknown): value is OwnershipRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.formatVersion === RECORD_VERSION &&
    typeof record.projectDirectory === "string" &&
    isAbsolute(record.projectDirectory) &&
    resolve(record.projectDirectory) === record.projectDirectory &&
    typeof record.compilerVersion === "string" &&
    Array.isArray(record.roots) &&
    record.roots.every((root) => typeof root === "string" && isAbsolute(root)) &&
    Array.isArray(record.files) &&
    record.files.every(
      (file) =>
        typeof file === "object" &&
        file !== null &&
        typeof (file as Record<string, unknown>).path === "string" &&
        typeof (file as Record<string, unknown>).sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test((file as Record<string, unknown>).sha256 as string),
    )
  );
}

async function createAndValidateOutputDirectory(path: string): Promise<void> {
  const status = await optionalLstat(path);
  if (status?.isSymbolicLink()) {
    throw new OutputError(`The output directory cannot be a symbolic link: ${path}.`);
  }
  if (status !== undefined && !status.isDirectory()) {
    throw new OutputError(`The output path is not a directory: ${path}.`);
  }
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    throw new OutputError(`Cannot create output directory ${path}: ${message(error)}`, {
      cause: error,
    });
  }
}

async function rejectSymlink(path: string, label: string): Promise<void> {
  const status = await optionalLstat(path);
  if (status?.isSymbolicLink()) {
    throw new OutputError(`The reserved ${label} path is a symbolic link: ${path}.`);
  }
}

async function removeEmptyOwnedDirectories(
  outputDirectory: string,
  stalePaths: readonly string[],
): Promise<void> {
  const directories = new Set<string>();
  for (const path of stalePaths) {
    let directory = dirname(join(outputDirectory, path));
    while (directory !== outputDirectory && isWithin(directory, outputDirectory)) {
      directories.add(directory);
      directory = dirname(directory);
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    await rmdir(directory).catch(() => undefined);
  }
}

function validateAbsoluteInputs(options: WriteOutputOptions): void {
  const namedPaths: [string, string][] = [
    ["projectDirectory", options.projectDirectory],
    ["outputDirectory", options.outputDirectory],
    ...options.roots.map((path): [string, string] => ["root", path]),
    ...options.protectedPaths.map((path): [string, string] => ["protected path", path]),
    ...options.dependencyDirectories.map(
      (path): [string, string] => ["dependency directory", path],
    ),
  ];
  for (const [name, path] of namedPaths) {
    if (!isAbsolute(path)) throw new OutputError(`${name} must be an absolute path: ${path}.`);
  }
}

async function canonicalExistingDirectory(path: string, label: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    const status = await lstat(canonical);
    if (!status.isDirectory()) throw new OutputError(`${label} is not a directory: ${path}.`);
    return canonical;
  } catch (error) {
    if (error instanceof OutputError) throw error;
    throw new OutputError(`Cannot resolve ${label} ${path}: ${message(error)}`, { cause: error });
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    return resolve(path);
  }
}

async function canonicalProspectiveOutputPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const directStatus = await optionalLstat(absolute);
  if (directStatus?.isSymbolicLink()) {
    throw new OutputError(`The output directory cannot be a symbolic link: ${absolute}.`);
  }
  if (directStatus !== undefined) return await realpath(absolute);

  const missing: string[] = [];
  let existing = absolute;
  while ((await optionalLstat(existing)) === undefined) {
    const parent = dirname(existing);
    if (parent === existing) {
      throw new OutputError(`Cannot resolve an existing parent for output directory ${absolute}.`);
    }
    missing.unshift(relative(parent, existing));
    existing = parent;
  }
  return join(await realpath(existing), ...missing);
}

function isWithin(path: string, parent: string): boolean {
  const difference = relative(parent, path);
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference));
}

function sameCanonicalPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function foldPath(path: string): string {
  return path.replaceAll("\\", "/").split("/").map(fold).join("/");
}

function fold(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function hash(contents: string | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return (await optionalLstat(path)) !== undefined;
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
