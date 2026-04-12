// Public surface of the fairies feature. Only FairyCanvas is exported.
// Internals (sketch, FSM, fairy.draw, etc.) are deliberately not re-exported
// so consumers can't reach into the feature and so tree-shaking stays
// clean when the canvas isn't mounted.

export { default as FairyCanvas } from './FairyCanvas';
