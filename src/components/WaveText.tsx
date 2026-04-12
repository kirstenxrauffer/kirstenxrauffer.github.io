import { ElementType, CSSProperties } from 'react';
import styles from './WaveText.module.scss';

interface WaveTextProps {
  text: string;
  /** Which HTML element to render the container as. Defaults to 'span'. */
  as?: ElementType;
  className?: string;
  /** Seconds between each letter's animation start. Default: 0.04 */
  stagger?: number;
  /** Seconds before the first letter begins animating. Default: 0 */
  delay?: number;
}

/**
 * Splits `text` into individually animated letter spans that fly up
 * with a springy overshoot, staggered left-to-right.
 *
 * Usage:
 *   <WaveText as="h1" text="hello world" />
 *   <WaveText as="p"  text="subtitle" stagger={0.025} delay={0.3} />
 */
export function WaveText({
  text,
  as: Tag = 'span',
  className,
  stagger = 0.04,
  delay = 0,
}: WaveTextProps) {
  let idx = 0;

  return (
    <Tag
      className={[styles.root, className].filter(Boolean).join(' ')}
      // Single aria-label so screen readers read the whole word, not
      // letter-by-letter.
      aria-label={text}
    >
      {text.split('').map((char, i) => {
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
