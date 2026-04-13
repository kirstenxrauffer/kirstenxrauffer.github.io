// Ambient type shim for p5.brush v2.1.4-beta.
// The package ships no types. We only declare the subset we actually call.
// Internal representation is opaque — callers treat Brush results as void.

declare module 'p5.brush' {
  import type p5 from 'p5';

  // Canonical param shape for brush.add(). Accepts both canonical and
  // legacy keys; p5.brush normalizes internally.
  export type BrushParams = {
    type?: 'marker' | 'custom' | 'image' | 'spray';
    weight?: number;
    scatter?: number;
    vibration?: number; // legacy alias for scatter
    sharpness?: number | null;
    definition?: number; // legacy alias for sharpness
    grain?: number | null;
    quality?: number; // legacy alias for grain
    opacity?: number;
    spacing?: number;
    noise?: number;
    markerTip?: boolean;
    rotate?: 'natural' | 'random' | number;
    tip?: unknown;
    pressure?: {
      type?: 'custom' | 'gaussian';
      mode?: 'custom' | 'gaussian'; // legacy alias for type
      curve?: [number, number] | [number, number, number] | ((t: number) => number);
      min_max?: [number, number];
    };
    image?: unknown;
  };

  // Register a p5 instance (instance-mode). Must be called BEFORE setup().
  export function instance(p: p5): void;

  // Register a custom brush.
  export function add(name: string, params: BrushParams): void;

  // Seed p5.brush's internal RNG. Critical: this is SEPARATE from p5's
  // own Math.random, so calling p.randomSeed won't pin brush stamps.
  export function seed(value: number | string): void;
  export function noiseSeed(value: number | string): void;

  // Brush / color setters.
  export function set(name: string, color: string | [number, number, number, number?], weight?: number): void;
  export function stroke(color: string | [number, number, number, number?]): void;
  export function strokeWeight(w: number): void;
  export function noStroke(): void;

  // Fills. Alpha is on 0-255 scale; default when omitted is 150.
  // Four overloads matching p5.brush's internal argument sniffing.
  export function fill(
    r: number,
    g: number,
    b: number,
    a?: number,
  ): void;
  export function fill(color: string, alpha?: number): void;
  export function noFill(): void;

  // Wash — flat single-layer fill with exact opacity (no watercolor layering).
  export function wash(color: string, alpha?: number): void;
  export function wash(r: number, g: number, b: number, a?: number): void;
  export function noWash(): void;
  export function fillBleed(strength: number, direction?: 'in' | 'out'): void;
  export function fillTexture(strength: number, frequency?: number, scatter?: boolean): void;

  // Primitives.
  export function line(x1: number, y1: number, x2: number, y2: number): void;
  export function rect(x: number, y: number, w: number, h: number): void;
  export function circle(x: number, y: number, d: number, r?: boolean): void;
  export function arc(x: number, y: number, w: number, h: number, start: number, stop: number): void;
  export function polygon(points: Array<[number, number]>): void;
  export function spline(points: Array<[number, number]>, curvature?: number): void;
  export function flowLine(x: number, y: number, length: number, dir: number): void;

  // Shape API (the preferred way to stroke/fill closed paths).
  export function beginShape(curvature?: number): void;
  export function vertex(x: number, y: number, pressure?: number): void;
  export function endShape(close?: boolean): void;

  // Global brush transforms.
  export function scaleBrushes(factor: number): void;
}
