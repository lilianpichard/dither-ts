import { floydSteinberg } from "../src/kernels.js";
const out = floydSteinberg(
  { width: 3, height: 1, data: new Float32Array([0, 128, 255]) },
  128
);
console.log("smoke fs:", Array.from(out).join(","));
