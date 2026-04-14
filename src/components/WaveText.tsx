import { ElementType, CSSProperties, useMemo } from 'react';
import styles from './WaveText.module.scss';

interface WaveTextProps {
  text: string;
  /** Which HTML element to render the container as. Defaults to 'span'. */
  as?: ElementType;
  className?: string;
  /** Seconds before the first letter begins animating. Default: 0 */
  delay?: number;
  /**
   * 'wave'    (default) — letters slide up sequentially with a springy ease,
   *                       staggered left-to-right.
   * 'scatter'           — letters fade in at random offsets (no transform).
   *                       Good for display headings.
   * 'drift'             — letters float up with a soft blur-clear and no
   *                       overshoot. Dreamy/ethereal feel for body copy.
   */
  variant?: 'wave' | 'scatter' | 'drift';
  /** Seconds between each letter's start (wave/drift variant only). Default: 0.04 */
  stagger?: number;
}

export function WaveText({
  text,
  as: Tag = 'span',
  className,
  delay = 0,
  variant = 'wave',
  stagger = 0.04,
}: WaveTextProps) {
  const chars = useMemo(() => [...text], [text]);

  // Scatter: random offset within [0, 0.7s]. Animation is 1.1s so total
  // completion stays ~1.8s — faster/snappier than the original.
  const scatterOffsets = useMemo(
    () => chars.map(c => (c === ' ' ? 0 : Math.random() * 0.7)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text],
  );

  if (variant === 'scatter') {
    return (
      <Tag className={[styles.root, className].filter(Boolean).join(' ')}>
        <span className={styles.srMirror}>{text}</span>
        {chars.map((char, i) => {
          if (char === ' ') {
            return (
              <span key={i} className={styles.space} aria-hidden="true">
                {' '}
              </span>
            );
          }
          return (
            <span
              key={i}
              className={styles['scatter-letter']}
              style={{ '--d': `${delay + scatterOffsets[i]}s` } as CSSProperties}
              aria-hidden="true"
            >
              {char}
            </span>
          );
        })}
      </Tag>
    );
  }

  if (variant === 'drift') {
    // Sequential stagger like wave, but no mask — letters float up from
    // a small offset with blur clearing. Soft, weightless feel.
    let idx = 0;
    return (
      <Tag className={[styles.root, className].filter(Boolean).join(' ')}>
        <span className={styles.srMirror}>{text}</span>
        {chars.map((char, i) => {
          if (char === ' ') {
            return (
              <span key={i} className={styles.space} aria-hidden="true">
                {' '}
              </span>
            );
          }
          const d = delay + idx++ * stagger;
          return (
            <span
              key={i}
              className={styles['drift-letter']}
              style={{ '--d': `${d}s` } as CSSProperties}
              aria-hidden="true"
            >
              {char}
            </span>
          );
        })}
      </Tag>
    );
  }

  // wave (default): sequential stagger, mask + slide-up.
  let idx = 0;
  return (
    <Tag className={[styles.root, className].filter(Boolean).join(' ')}>
      <span className={styles.srMirror}>{text}</span>
      {chars.map((char, i) => {
        if (char === ' ') {
          return (
            <span key={i} className={styles.space} aria-hidden="true">
              {' '}
            </span>
          );
        }
        const d = delay + idx++ * stagger;
        return (
          <span key={i} className={styles.mask} aria-hidden="true">
            <span
              className={styles.letter}
              style={{ '--d': `${d}s` } as CSSProperties}
            >
              {char}
            </span>
          </span>
        );
      })}
    </Tag>
  );
}
