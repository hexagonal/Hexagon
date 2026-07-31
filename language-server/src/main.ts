/**
 * Process entry point.
 *
 * The transport is stdio, which is what an editor extension launching a child
 * process expects and what makes the server testable by spawning it. Everything
 * else lives in `server.ts`, so the protocol wiring can be exercised over a pipe
 * pair without a process at all.
 *
 * Nothing may be written to stdout except protocol messages — a stray `console.log`
 * corrupts the JSON-RPC stream and the client disconnects with no useful error.
 * `connection.console` sends log messages to the client over the protocol
 * instead, which is why the server logs through it and never through `console`.
 */

import { ProposedFeatures, createConnection } from "vscode-languageserver/node.js";
import { startServer } from "./server.js";

/**
 * A client that names a transport gets what it asked for; one that names none
 * gets stdio rather than a startup error. Launching the binary by hand is the
 * first thing anyone does when a language server misbehaves, and failing that
 * with a usage message teaches nothing about the server.
 */
const TRANSPORT_FLAGS = ["--stdio", "--node-ipc", "--socket"];
const chosen = process.argv.some((argument) =>
  TRANSPORT_FLAGS.some((flag) => argument === flag || argument.startsWith(`${flag}=`))
);
if (!chosen) process.argv.push("--stdio");

const connection = createConnection(ProposedFeatures.all);

// A crash after this point would otherwise die silently inside the pipe; the
// client can at least show the reason if it arrives as a log message first.
process.on("uncaughtException", (error: unknown) => {
  connection.console.error(
    `[hexagon] unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
});

startServer(connection);
