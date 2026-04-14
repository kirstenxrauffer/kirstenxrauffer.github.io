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
// Width eases during the exit phase so the reflow finishes just before the
// next nickname scatters in at its new position.
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

  // Measure each word's rendered width in the hidden sibling so the container
  // can transition smoothly between them when the nickname changes length.
  const measureRef = useRef<HTMLSpanElement>(null);
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

    // Re-measure once web fonts finish loading, since fallback-font widths
    // can differ meaningfully from the final rendered widths.
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

  const baseDelay = firstRun.current ? delay : 0;

  // During the exit phase, target the NEXT word's width so the container
  // reflows in sync with the letters fading out.
  const targetWidth = widths
    ? showing
      ? widths[index]
      : widths[(index + 1) % words.length]
    : undefined;

  // Match the total exit time (out-scatter window + fade duration) so the
  // reflow finishes exactly as the next nickname begins scattering in.
  const widthDurationMs = Math.round((outScatter + EXIT_DURATION) * 1000);
  const containerStyle: CSSProperties = {
    display: 'inline-block',
    whiteSpace: 'pre',
    width: targetWidth != null ? `${targetWidth}px` : undefined,
    transition: widths ? `width ${widthDurationMs}ms ${WIDTH_EASE}` : 'none',
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
          <span key={i} style={{ whiteSpace: 'pre' }}>
            {w}
          </span>
        ))}
      </span>
      <span className={className} style={containerStyle} aria-label={word}>
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
