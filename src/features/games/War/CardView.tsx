import type { Card } from '../types';
import { WatercolorBack } from '../WatercolorBack';
import styles from './WarGame.module.scss';

export function CardFace({ card }: { card: Card }) {
  return (
    <div className={`${styles['card']} ${styles[`card--${card.color}`]}`}>
      <span className={`${styles['card__suit']} ${styles['card__suit--top']}`}>{card.suit}</span>
      <span className={styles['card__number']}>{card.rank}</span>
      <span className={`${styles['card__suit']} ${styles['card__suit--bottom']}`}>{card.suit}</span>
    </div>
  );
}

export function CardBack() {
  return (
    <div className={`${styles['card']} ${styles['card--back']}`}>
      <WatercolorBack />
    </div>
  );
}
