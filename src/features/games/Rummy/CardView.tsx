import type { Card } from '../types';
import { WatercolorBack } from '../WatercolorBack';
import styles from './RummyGame.module.scss';

export function CardFace({ card, small = false }: { card: Card; small?: boolean }) {
  return (
    <div
      className={`${styles['card']} ${styles[`card--${card.color}`]} ${small ? styles['card--small'] : ''}`}
    >
      <span className={`${styles['card__suit']} ${styles['card__suit--top']}`}>{card.suit}</span>
      <span className={styles['card__number']}>{card.rank}</span>
      <span className={`${styles['card__suit']} ${styles['card__suit--bottom']}`}>{card.suit}</span>
    </div>
  );
}

export function CardBack({ small = false }: { small?: boolean }) {
  return (
    <div className={`${styles['card']} ${styles['card--back']} ${small ? styles['card--small'] : ''}`}>
      <WatercolorBack />
    </div>
  );
}
