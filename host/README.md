# The Hexagon host

What a program is **on disk**: the project directory, the files beneath it, and
the directories its dependencies are found in. One package, shared by every
Node-hosted tool — the language server today, the command-line compiler when
there is one — rather than each tool answering for itself.

The compiler core is platform-neutral and stays so: it receives packages as
**records** and never spells `node_modules`
(`compiler/architecture/environment.md` §4, Packages §4.1). Everything that
touches a filesystem on the language's behalf is here.

## What a program is

**One program per project directory.** A project directory is the nearest
directory at or above a root that holds a `hexagon.json`. A manifest nested
beneath one is a package of its own (Packages §2.2) and so a program of its own; its
files belong to it alone, which is what keeps a file from having two full names.
A directory with no manifest at it or above it is a project under an **implicit
empty manifest** (Packages §2.5) — no name, no dependencies, `Hex` implicit.

An editor folder opened **inside** a package belongs to that package's project:
the nearest manifest at or above the folder decides. So a root never splits an
owned package and never creates a second project inside one, and two open
folders see each other only through an installed dependency. Ownership is
settled before the implicit manifest is read, so the default never displaces a
manifest that owns the directory.

**Identity is the canonical path.** Two links to one directory are one package;
two names for one file are one file. That is what makes a file two programs hold
one file, its open buffer's text reaching both, while each program keeps its own
analysis and its own failures.

## How a package is found

`lookup.ts` is npm's layout, and it is the walk Node itself makes for a
requested name — from the **asking package's own directory**, not the project's.
Its `node_modules`, then each ancestor's, outward, an ancestor named
`node_modules` skipped as Node skips it. At each level the package roots are its
entries, and the entries of any `@scope` entry, that hold a `hexagon.json`;
their manifests are read for the `name` they declare, because npm names a
directory and Hexagon names a manifest. The **nearest** level declaring the
requested name answers.

Three consequences worth stating, because each is a rule and not an accident:

- A copy at a farther level is **shadowed for that walk** and is never read. It
  enters the program only where some other package's own lookup answers with it
  — which is how a program comes to hold two, and why the one-copy rule is read
  over the closure rather than over everything installed.
- A package nobody lists is **never sought**, and no directory without a
  `hexagon.json` is read at all. There is no index of what is installed.
- A manifest the walk cannot use supplies no candidate and stops nothing. One
  that does not parse is named only inside the unresolvable-name report of a
  lookup that scanned it; one that parses and declares no name this spec accepts
  is named nowhere, because nothing about it is broken.

A level scan reads one field. Which root declares the name being sought is the
only question a level answers, so each root's `hexagon.json` is read for its
`name` and nothing else; the rest of a manifest — its `dependencies`, its
`exclude`, its sibling `package.json`'s version — is read for "a package the
lookup answers with", which is validated in full (Packages §4.1), and for no
other root. A real `node_modules` level holds hundreds of packages a walk will
never resolve to, and validating each of them would make every lookup pay for
the whole directory.

The one scan wider than a single name is *installed*, which decides one
diagnostic — the not-a-dependency report's "is there such a package at all"
(Packages §3.3) — and enters no closure and draws no refusal of its own.

## Who decides what

Discovery is here; **judgement is the compiler's**. `packages.ts` assembles the
closure outward from the project, resolving each package's entries from that
package's directory, and hands the edges to `validatePackageSet`, which decides
what the set *is*: one copy per name, acyclic, the project's name unclaimed, no
entry unresolvable. A second mechanism for finding directories — a registry that
is not npm's — replaces `lookup.ts` and changes no rule.

Reports are seated at the manifest that carries the entry, dependency manifests
under `node_modules` included, so a dependency's own unresolvable entry reports
against the dependency's `hexagon.json` and not against the project's.

**Only the project's manifest is read in full.** A package that enters the set
is checked for its own `dependencies` (Packages §4.1) and for nothing else:
§2.1 makes every other field the host's, and a package's author is not that
file's reader. So a dependency's `exclude` is honoured — by the walk and by
every door that seats a file the walk did not, which is the fourth bound below —
and never reported on;
a key this reader does not know is read past in silence — `node_modules` is
not a place anyone edits, and `exclude: ["dist"]` naming a directory the
published tarball does not carry is the ordinary shape of a published package.
A manifest the scan merely read is checked for nothing at all, which is
enforced by never reading its problems rather than by filtering them afterwards.

## Layout

| File | What it answers |
|---|---|
| `manifest.ts` | `hexagon.json`: `name`, `dependencies`, `exclude`, and the sibling `package.json`'s version |
| `projects.ts` | which directories are programs, and which project owns an editor root |
| `files.ts` | which `.hex` files a project or package holds, and where the nested boundaries are |
| `lookup.ts` | where a `dependencies` entry's package directory is, under npm's layout |
| `packages.ts` | the closure loop, and the problems to publish |
| `paths.ts` | one spelling of a path, and one notion of identity |

A path's **root** is not a component. `/`, a drive letter, and a UNC share are
each one, and `paths.ts` is where a climb stops at one: a level list that
rebuilt every root as `/` asked for `/C:/proj/node_modules`, which is nowhere,
and "a level that is not there is not an error" turned that into every
dependency on Windows resolving to nothing, silently.

Beside `node_modules`, the walk skips a short list of **tooling directories** —
`.git`, `.claude`, `.vscode`, `dist`, `coverage`. Only `node_modules` is a rule
of the language (Packages §2.2); the rest are this host's convenience, and a
`.hex` file under one of them is not in the project and says so nowhere.

The bound leaves this package as a **question** — `crossesSkippedDirectory` —
rather than as the list. A host seats files the walk never handed it (a watcher
event on a new `.hex`, an editor opening one), and every such door has to apply
the same bound or the walk's answer is only advisory: a `.hex` under a project's
`node_modules` would otherwise join the project as its *own* source, compiling a
dependency's module under the project's package name.

§2.2's third exclusion travels the same way. A directory holding a
`hexagon.json` of its own ends the package there, and only the walk knows where
those boundaries are — so it says so, as `Walked.nested` and then as
`Program.nested` and `DiscoveredPackage.nested`, and a door refuses a file
beneath one rather than hunting for manifests of its own and disagreeing about
where a package stops. With all three exclusions asked at every door, what is
left of "no file ever has two full names" is the second way a file can get two:
two packages of one closure containing it, which is npm's ordinary nested
install, and which the **deepest** containing package answers.

**`exclude` is the fourth bound, and it is per package.** §2.1's field belongs
to a *manifest*, so the walk reads each package of the closure with that
package's own entries and nobody else's (`filesOf`), and a door has to ask the
manifest of the package the file would join. Both directions of getting that
wrong are ordinary and a merged set gets both: a project's
`exclude: ["node_modules"]` is the shape of every `.gitignore`, and matching it
against a dependency's files empties every dependency of source with no report
anywhere; a dependency's `exclude: ["generated"]` is the shape of a published
package, and *not* matching it adds a module the package excluded the moment
someone opens one file inside it — changing a report in the consumer's own
source. This bound is a question about a **name a manifest wrote** rather than
about the shape of the tree, which is why it is `exclusionsOf` and `excludes`
asked by the caller rather than another `crossesSkippedDirectory`.

## Tests

`vitest`, against **real directories**: real `node_modules` trees, real
symlinks, real unparseable manifests. The rules here are about what npm actually
lays down, and a stubbed filesystem would only let these tests agree with their
author's idea of npm.

`npm test` runs the suite **twice**, and the second run reaches every root
through a symlink it makes itself (`vitest.linked.config.ts`,
`src/test-roots.ts`). A project directory settles by its canonical path while a
client keeps sending the folder it was given, so where the two differ every file
has two names — and whether a plain temporary directory is canonical is a
property of the machine (`/var/folders/…` on macOS, `/tmp` on a Linux runner).
A single run silently covers one of the two, and which one is nobody's choice.
The language server imports the same helper, and its suite doubles the same way.

`src/sources.test.ts` is not about the host at all: it is a repository rule —
no source file in the toolchain carries a literal NUL byte, which makes a file
binary to `grep` and `rg` and silently hides every symbol in it. It lives here
because this suite is the quick one.
