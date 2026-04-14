import {
  CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
const WIDTH_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function ScatterCycle({
  words,
  delay = 0,
  hold = 4.2,
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

  // Measure each word's rendered width in a hidden sibling so the exit-phase
  // reflow can animate to the next nickname's width.
  const measureRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [widths, setWidths] = useState<number[] | null>(null);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;

    const measure = () => {
      const ws = Array.from(el.children).map(
        c => (c as HTMLElement).getBoundingClientRect().width,
      );
      setWidths(ws);
    };

    measure();

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      fonts.ready.then(measure).catch(() => {});
    }
  }, [words]);

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

  // During showing: container is natural auto width — font-load reflows
  // happen silently, without triggering a visible width transition.
  // During exit: snap to current rendered width (no transition), then next
  // frame animate to the next word's width.
  const [explicitWidth, setExplicitWidth] = useState<number | null>(null);
  const [transitionOn, setTransitionOn] = useState(false);

  useLayoutEffect(() => {
    if (showing) {
      setExplicitWidth(null);
      setTransitionOn(false);
      return;
    }
    if (!widths || !containerRef.current) return;
    const current = containerRef.current.getBoundingClientRect().width;
    setExplicitWidth(current);
    setTransitionOn(false);
    const id = requestAnimationFrame(() => {
      setTransitionOn(true);
      setExplicitWidth(widths[(index + 1) % words.length]);
    });
    return () => cancelAnimationFrame(id);
  }, [showing, index, widths, words.length]);

  const baseDelay = firstRun.current ? delay : 0;
  const widthDurationMs = Math.round((outScatter + EXIT_DURATION) * 1000);

  const containerStyle: CSSProperties = {
    display: 'inline-block',
    whiteSpace: 'pre',
    width: explicitWidth != null ? `${explicitWidth}px` : undefined,
    transition: transitionOn
      ? `width ${widthDurationMs}ms ${WIDTH_EASE}`
      : 'none',
  };

  return (
    <>
      <span
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre',
          left: -9999,
          top: 0,
        }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            style={{ display: 'inline-block', whiteSpace: 'pre' }}
          >
            {[...w].map((ch, j) =>
              ch === ' ' ? (
                <span key={j} className={styles.space}>
                  {' '}
                </span>
              ) : (
                <span
                  key={j}
                  className={styles['scatter-letter']}
                  style={{ animation: 'none' }}
                >
                  {ch}
                </span>
              ),
            )}
          </span>
        ))}
      </span>
      <span
        ref={containerRef}
        className={className}
        style={containerStyle}
        aria-label={word}
      >
        {chars.map((char, i) => {
          if (char === ' ') {
            return (
              <span key={i} className={styles.space} aria-hidden="true">
                {' '}
              </span>
            );
          }
          const d = showing ? baseDelay + inOffsets[i] : outOffsets[i];
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
    </>
  );
}
