// picocolors is CommonJS; import the default export and destructure (named ESM
// imports fail at runtime). tsup keeps it external, so this resolves to the CJS module.
import pc from "picocolors";

const { createColors, isColorSupported } = pc;

type Colors = ReturnType<typeof createColors>;

// picocolors already honors NO_COLOR / FORCE_COLOR / TTY. configureColor lets the
// CLI override that with --color/--no-color.
let active: Colors = createColors(isColorSupported);

export function configureColor(mode: "auto" | "always" | "never"): void {
  active = createColors(mode === "always" || (mode === "auto" && isColorSupported));
}

/** Current color functions. Renderers call this so --no-color takes effect. */
export function colors(): Colors {
  return active;
}
