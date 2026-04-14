import { getCardBackDataURL, useCardBackSeed } from './watercolorEngine';

// Renders the current session's watercolor design. All card backs in a
// session share one seed (and one cached data URL), so they all look the same;
// calling `newCardBackSession()` elsewhere triggers every back to repaint.
export function WatercolorBack({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const seed = useCardBackSeed();
  const url = getCardBackDataURL(seed);
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...style,
      }}
    />
  );
}
