/// <reference types="vite/client" />

// vite-plugin-glsl transforms .vert / .frag / .glsl files into string exports
declare module '*.vert' { const src: string; export default src; }
declare module '*.frag' { const src: string; export default src; }
declare module '*.glsl' { const src: string; export default src; }
