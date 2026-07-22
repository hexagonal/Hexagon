import ratSource from "../../stdlib/Rat.hex?raw";

/**
 * The small, deliberately provisional stdlib foundation supplied by the
 * Playground host. Membership can grow as the full stdlib inventory settles;
 * each entry always points at the canonical Hexagon source module.
 */
export interface FundamentalStdlibModule {
  readonly companion: string;
  readonly path: string;
  readonly source: string;
}

export const fundamentalStdlibModules: readonly FundamentalStdlibModule[] = [
  {
    companion: "Rat",
    path: "/stdlib/Rat.hex",
    source: ratSource,
  },
];
