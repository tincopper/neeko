declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.ico" {
  const src: string;
  export default src;
}

declare module "plantuml-encoder" {
  export function encode(text: string): string;
  export function decode(encoded: string): string;
}
