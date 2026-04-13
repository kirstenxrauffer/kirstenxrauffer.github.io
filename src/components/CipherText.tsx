import { useState, useEffect, ElementType } from 'react';
import styles from './CipherText.module.scss';

interface CipherTextProps {
  from: string;
  to: string;
  as?: ElementType;
  className?: string;
  /** Seconds before the morph begins. Default: 0 */
  delay?: number;
  /** Seconds between each character swap. Default: 0.045 */
  stagger?: number;
}

type CharSlot = {
  char: string;
  /** Incremented on each change — drives inner-span remount to replay animation. */
  id: number;
  /** true = no CSS animation (initial foreign text just shown) */
  initial: boolean;
  /** true = char is animating out (no English equivalent at this position) */
  exiting: boolean;
};

export function CipherText({
  from,
  to,
  as: Tag = 'span',
  className,
  delay = 0,
  stagger = 0.045,
}: CipherTextProps) {
  const [slots, setSlots] = useState<CharSlot[]>(() =>
    [...from].map((char, i) => ({ char, id: i * 100, initial: true, exiting: false }))
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const fromChars = [...from];
    const toChars = [...to];
    const maxLen = Math.max(fromChars.length, toChars.length);

    for (let i = 0; i < maxLen; i++) {
      const ms = (delay + i * stagger) * 1000;

      if (i < toChars.length) {
        timers.push(
          setTimeout(() => {
            setSlots(prev => {
              const next = [...prev];
              if (i < next.length) {
                // Morph existing slot to the target char (skip if already correct)
                if (next[i].char !== toChars[i] || next[i].exiting) {
                  next[i] = { char: toChars[i], id: next[i].id + 1, initial: false, exiting: false };
                } else if (next[i].initial) {
                  // Same char but was initial — just mark non-initial so it won't re-animate
                  next[i] = { ...next[i], initial: false };
                }
              } else {
                // Append new slot (to is longer than from)
                next.push({ char: toChars[i], id: i * 100 + 1, initial: false, exiting: false });
              }
              return next;
            });
          }, ms),
        );
      } else {
        // Position only exists in from — animate it out
        timers.push(
          setTimeout(() => {
            setSlots(prev => {
              const next = [...prev];
              if (i < next.length && !next[i].exiting) {
                next[i] = { ...next[i], exiting: true, id: next[i].id + 1, initial: false };
              }
              return next;
            });
          }, ms),
        );
      }
    }

    // Remove exiting slots after their fade-out animation completes
    if (fromChars.length > toChars.length) {
      const trimMs = (delay + maxLen * stagger + 0.35) * 1000;
      timers.push(
        setTimeout(() => {
          setSlots(prev => prev.slice(0, toChars.length));
        }, trimMs),
      );
    }

    return () => timers.forEach(clearTimeout);
  }, [from, to, delay, stagger]);

  return (
    <Tag
      className={[styles.root, className].filter(Boolean).join(' ')}
      aria-label={to}
    >
      {slots.map((slot, i) => {
        const charClass = slot.exiting
          ? styles.letterOut
          : slot.initial
          ? styles.letterStatic
          : styles.letterIn;

        return (
          <span key={i} className={styles.slot}>
            <span
              key={slot.id}
              className={charClass}
            >
              {slot.char === ' ' ? '\u00a0' : slot.char}
            </span>
          </span>
        );
      })}
    </Tag>
  );
}
