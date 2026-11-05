// src/ui/css-modules.d.ts
// Lets tsc accept the CSS side-effect imports in the UI (main.ts imports
// tokens.css and theme.css for Vite to bundle). tsc does not understand a .css
// import on its own; this ambient module declaration makes the import a typed
// no-op so `npm run typecheck` passes. Vite handles the real bundling.

declare module "*.css" {
  const content: string;
  export default content;
}
