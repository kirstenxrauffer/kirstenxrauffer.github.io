import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import styles from './WaveText.module.scss';

interface ScatterCycleProps {
  /** Words/nicknames to cycle through, in order. Loops indefinitely. */
  words: string[];
  /** Seconds before the first word begins its reveal. */
  delay?: number;
  /** Seconds to hold a word fully on-screen after it finishes revealing. */
  hold?: number;
  /** Max random per-letter offset for the reveal (seconds). */
  inScatter?: number;
  /** Max random per-letter offset for the exit (seconds). */
  outScatter?: number;
  className?: string;
}

const REVEAL_DURATION = 1.1;
const EXIT_DURATION = 0.6;

export function ScatterCycle({
  words,
  delay = 0,
  hold = 2.2,
  inScatter = 0.7,
  outScatter = 0.5,
  className,
}: ScatterCycleProps) {
  const [index, setIndex] = useState(0);
  const [showing, setShowing] = useState(true);
  const firstRun = useRef(true);

  const word = words[index];
  const chars = useMemo(() => [...word], [word]);

  const inOffsets = useMemo(
    () => chars.map(c => (c === ' ' ? 0 : Math.random() * inScatter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index],
  );
  const outOffsets = useMemo(
    () => chars.map(c => (c === ' ' ? 0 : Math.random() * outScatter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index],
  );

  useEffect(() => {
    if (showing) {
      const startDelay = firstRun.current ? delay : 0;
      firstRun.current = false;
      const revealMs = (startDelay + inScatter + REVEAL_DURATION + hold) * 1000;
      const t = setTimeout(() => setShowing(false), revealMs);
      return () => clearTimeout(t);
    }
    const exitMs = (outScatter + EXIT_DURATION) * 1000;
    const t = setTimeout(() => {
      setIndex(v => (v + 1) % words.length);
      setShowing(true);
    }, exitMs);
    return () => clearTimeout(t);
  }, [showing, index, words.length, delay, hold, inScatter, outScatter]);

  const baseDelay = firstRun.current ? delay : 0;

  return (
    <span className={className} aria-label={word}>
      {chars.map((char, i) => {
        if (char === ' ') {
          return (
            <span key={i} className={styles.space} aria-hidden="true">
              {' '}
            </span>
          );
        }
        const d = showing
          ? baseDelay + inOffsets[i]
          : outOffsets[i];
        return (
          <span
            key={`${index}-${showing ? 'in' : 'out'}-${i}`}
            className={
              showing ? styles['scatter-letter'] : styles['scatter-letter-out']
            }
            style={{ '--d': `${d}s` } as CSSProperties}
            aria-hidden="true"
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}
