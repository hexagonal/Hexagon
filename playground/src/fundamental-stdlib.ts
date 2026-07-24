import ratSource from "../../stdlib/Rat.hex?raw";
import optionSource from "../../stdlib/Option.hex?raw";
import vectorSource from "../../stdlib/Vector.hex?raw";

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
    companion: "Option",
    path: "/stdlib/Option.hex",
    source: optionSource,
  },
  {
    companion: "Vector",
    path: "/stdlib/Vector.hex",
    source: vectorSource,
  },
  {
    companion: "Rat",
    path: "/stdlib/Rat.hex",
    source: ratSource,
  },
];
