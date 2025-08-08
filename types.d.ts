// Minimal ambient declarations to satisfy TypeScript in this workspace.
// In a real setup, prefer @figma/plugin-typings and tsconfig types.
// This file intentionally relaxes typing to avoid noisy errors here.
declare const figma: any;
declare const __html__: string;

type TextNode = any;
type SceneNode = any;
type FontName = any;
