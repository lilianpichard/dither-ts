export type MethodFamily = "none" | "ordered" | "diffusion";
export type DitherOutput = "bw" | "color";

export interface MethodDefinition {
  readonly family: MethodFamily;
  readonly supports: Readonly<Record<DitherOutput, boolean>>;
}

interface RegisteredMethodDefinition<F extends MethodFamily, C extends boolean> {
  readonly family: F;
  readonly supports: Readonly<{ bw: true; color: C }>;
}

function definition<F extends MethodFamily>(family: F): RegisteredMethodDefinition<F, true>;
function definition<F extends MethodFamily, C extends boolean>(
  family: F,
  color: C,
): RegisteredMethodDefinition<F, C>;
function definition<F extends MethodFamily>(
  family: F,
  color = true,
): RegisteredMethodDefinition<F, boolean> {
  return Object.freeze({
    family,
    supports: Object.freeze({ bw: true, color }),
  });
}

export const METHOD_REGISTRY = Object.freeze({
  None: definition("none"),
  "Bayer 2x2": definition("ordered"),
  "Bayer 4x4": definition("ordered"),
  "Bayer 8x8": definition("ordered"),
  "Clustered-Dot": definition("ordered"),
  Halftone: definition("ordered"),
  "Blue-Noise": definition("ordered"),
  "Void-and-Cluster": definition("ordered"),
  Pattern: definition("ordered"),
  Crosshatch: definition("ordered"),
  "Floyd-Steinberg": definition("diffusion"),
  Atkinson: definition("diffusion"),
  Sierra: definition("diffusion"),
  "Sierra-Lite": definition("diffusion"),
  "Jarvis-Judice-Ninke": definition("diffusion"),
  Stucki: definition("diffusion"),
  Nakano: definition("diffusion"),
  Burkes: definition("diffusion"),
  "Stevenson-Arce": definition("diffusion"),
  Ostromoukhov: definition("diffusion", false),
  "Variable-Error": definition("diffusion", false),
  "Dot-Diffusion": definition("diffusion", false),
  Riemersma: definition("diffusion", false),
  "Blue-Noise Mask": definition("ordered"),
});

export type DitherMethod = keyof typeof METHOD_REGISTRY;

type MethodsInFamily<F extends MethodFamily> = {
  [M in DitherMethod]: (typeof METHOD_REGISTRY)[M]["family"] extends F ? M : never;
}[DitherMethod];

type ColorMethods = {
  [M in DitherMethod]: (typeof METHOD_REGISTRY)[M]["supports"]["color"] extends true ? M : never;
}[DitherMethod];

export type OrderedMethod = MethodsInFamily<"ordered">;
export type DiffusionMethod = MethodsInFamily<"diffusion">;
export type ColorDiffusionMethod = Extract<DiffusionMethod, ColorMethods>;
export type DiffusionTableMethod = ColorDiffusionMethod;
export type SpecialDiffusionMethod = Exclude<DiffusionMethod, ColorDiffusionMethod>;

export function getMethod(name: string): MethodDefinition | undefined {
  return Object.hasOwn(METHOD_REGISTRY, name) ? METHOD_REGISTRY[name as DitherMethod] : undefined;
}

/**
 * Whether a method can produce a colour image at all
 */
export function supportsColor(name: DitherMethod): boolean {
  return METHOD_REGISTRY[name].supports.color;
}

/** The methods with no colour form: they can only run greyscale. */
export function greyscaleOnlyMethods(): DitherMethod[] {
  return (Object.keys(METHOD_REGISTRY) as DitherMethod[]).filter((name) => !supportsColor(name));
}

export function isOrderedMethod(name: DitherMethod): name is OrderedMethod {
  return getMethod(name)?.family === "ordered";
}

export function isDiffusionTableMethod(name: DitherMethod): name is DiffusionTableMethod {
  const method = getMethod(name);
  return method?.family === "diffusion" && method.supports.color;
}

export function isSpecialDiffusionMethod(name: DitherMethod): name is SpecialDiffusionMethod {
  const method = getMethod(name);
  return method?.family === "diffusion" && !method.supports.color;
}
