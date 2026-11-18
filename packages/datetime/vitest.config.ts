// Relative import: Vite bundles it, whereas the package specifier resolves to an
// unbundled .ts file in node_modules that Node 20 cannot load.
import preset from "../config/vitest.preset";

export default preset;
