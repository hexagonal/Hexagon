# Hexagon for Node: compiler alpha

`hexc` checks Hexagon source and writes JavaScript that Node can run. This is an
experimental local package; it has not been published to npm. Language and
generated interfaces may change between alpha releases.

Use Node 24 LTS. The initial package targets Node 24.18.0 or later in the Node 24
family. Cross-platform release support requires the installation matrix to pass;
the repository's `spec/node-compiler-alpha.md` records validation results.

## Install a local alpha package

From this repository's `cli` directory:

```sh
npm ci
npm run check
npm test
npm pack
```

`npm pack` builds the tool and prints the tarball filename. In a separate folder
for your own project, install that tarball using its absolute path:

```sh
npm init -y
npm install --save-dev /absolute/path/to/hexagon-cli-workspace-0.1.0-alpha.0.tgz
npx --no-install hexc --version
```

The installed package contains the compiled tool and its standard library.
It needs no TypeScript build or Hexagon checkout at runtime. The temporary npm
package name will be replaced before public release.

## Your first program

Create `Main.hex`:

```hexagon
module Main
import Hex.Experimental.Stdio as Stdio

Stdio.writeLine!("Hello from Hexagon")
```

Then run:

```sh
npx --no-install hexc check Main.hex
npx --no-install hexc build Main.hex
node dist/Main.js
```

`check` reports errors without writing files. `build` checks the program and writes
its JavaScript, declarations and support files into the project's `dist` directory.
It prints the emitted entry paths. Neither command runs your program; Node runs
the generated module's top-level code. There is no automatically invoked `main`
function. Stdio remains an experimental API.

Output paths follow declared module names: a source declaring `module App.Main`
produces `dist/App/Main.js`, regardless of its source filename.

## Projects and dependencies

A small project needs no `hexagon.json`: the first root file's directory is its
implicit project directory. A manifest establishes an explicit project boundary:

```json
{
  "exclude": ["unfinished"]
}
```

The excluded directory must exist. A nested `hexagon.json` starts another project.
The compiler discovers modules in the owning project and resolves imports by
declared module name. It checks bodies needed by your starting files. Syntax and
module-name errors elsewhere in the discovered project can still stop the build;
unreferenced body type errors do not.

Multiple starting files must belong to the same project:

```sh
npx --no-install hexc build Main.hex Tools.hex
npx --no-install hexc build Main.hex --out-dir generated
```

Source arguments and an explicit relative output path are relative to your shell's
working directory. The default output is always the owning project's `dist`.
Selecting a file with several module declarations selects all of them.

Install Hexagon source packages with npm and list their declared Hexagon package
names in `hexagon.json`'s `dependencies` array. A package's npm name and declared
Hexagon name are separate. JavaScript packages are installed through npm but do
not belong in that Hexagon dependency array.

## A local JavaScript helper

Create `dist/helper.js` before building:

```javascript
export function greeting() {
  return "Hello from JavaScript";
}
```

Use this `Main.hex`:

```hexagon
module Main
import Hex.Experimental.Stdio as Stdio
extern from "./helper.js"
    fun greeting() -> String

Stdio.writeLine!(greeting())
```

Build and run as before. Relative foreign imports resolve from the generated
JavaScript file. The compiler does not copy the helper; it preserves that
user-provided file during rebuilds.

## A JavaScript npm package

For a self-contained example, create a small package in `vendor/hello-js` with
this `package.json`:

```json
{"name":"hello-js","version":"1.0.0","type":"module","exports":"./index.js"}
```

Put the helper's `greeting` function above in `vendor/hello-js/index.js`, then run
`npm install ./vendor/hello-js`. Change the extern line to:

```hexagon
extern from "hello-js"
    fun greeting() -> String
```

Build and run again. Node resolves the installed JavaScript dependency from the
output's location. Moving output elsewhere requires making its foreign files and
npm dependencies available there too. Compilation checks the declared Hexagon
boundary; it does not verify the JavaScript implementation's runtime behaviour.

## Rebuilding and errors

The output directory contains `.hexc-output.json`, a record of generated files.
A successful rebuild replaces those files and removes obsolete generated output.
Unrelated files are preserved; collisions and manual changes to generated files
stop the build before output replacement. Keep edits in source files or separate
foreign helpers. Each build replaces the previous selection in that output
directory, so build entry points together or give them separate output directories.

Compilation errors leave the previous output untouched. Do not mistake an old
successful build for a new one after a reported failure. Interrupted writes may
leave recovery information; follow the reported paths rather than deleting
ownership or recovery records blindly.

Diagnostics go to stderr. Exit codes are `0` for success, `1` for source/project
or filesystem errors, `2` for incorrect command arguments, and `3` for internal
compiler errors.

## Package validation

Run `npm run test:package` to build and pack the tool, install it in a fresh
temporary project and exercise the installed executable. This does not publish
anything. Public release will use an alpha version and the npm `alpha` tag after
the package name, support matrix and publication are approved.
