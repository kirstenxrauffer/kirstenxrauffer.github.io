import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameProps, Card } from '../types';
import { makeDeck, shuffle, dealHalves } from '../deck';
import { playRound, isGameOver, winner } from './warLogic';
import { CardFace, CardBack } from './CardView';
import { newCardBackSession } from '../watercolorEngine';
import styles from './WarGame.module.scss';

// UI state machine:
//   'idle'     — waiting for the user to click their deck to play
//   'reveal'   — showing the two cards face-up after a play
//   'war'      — showing burned face-down cards before the tiebreaker
//   'travel'   — pot cards flying to the winner's pile
//   'gameover' — final screen; onEnd has been called
type Phase = 'idle' | 'reveal' | 'war' | 'travel' | 'gameover';

// Pre-travel pause — lets the user read the reveal before cards fly.
const REVEAL_HOLD_MS = 900;
// Duration of the travel animation itself (matches CSS transition length).
const TRAVEL_MS = 650;
// War phase: how long the burned face-down pile sits before the final flip.
const WAR_BURN_MS = 700;

// A card in flight between a source position and the winner's deck.
type Traveler = {
  id: string;
  card: Card | null;      // null → render face-down (war burns)
  srcX: number;           // viewport px of top-left at spawn
  srcY: number;
  rotSrc: number;         // initial rotation (deg)
  dstX: number;           // viewport px of top-left at landing
  dstY: number;
  rotDst: number;         // final rotation (deg)
  delay: number;          // per-card stagger (ms)
  moving: boolean;        // flipped to true after one rAF to trigger transition
};

export default function WarGame({ onEnd, onClose }: GameProps) {
  const initialHands = useMemo(() => {
    const deck = shuffle(makeDeck());
    return dealHalves(deck);
  }, []);

  const [player, setPlayer] = useState<Card[]>(initialHands[0]);
  const [navi,   setNavi]   = useState<Card[]>(initialHands[1]);
  const [phase, setPhase]   = useState<Phase>('idle');
  const [shownPlayer, setShownPlayer] = useState<Card | null>(null);
  const [shownNavi,   setShownNavi]   = useState<Card | null>(null);
  const [warPile, setWarPile] = useState<Card[]>([]);
  const [message, setMessage] = useState<string>('');
  const [showStartHint, setShowStartHint] = useState(true);
  const [shuffleTick, setShuffleTick] = useState(0);
  // Gate for the shuffle keyframe — only true during an intentional shuffle
  // (initial mount + shuffle button). Cards appended to a pile between rounds
  // mount with this false, so they settle in silently.
  const [isShuffling, setIsShuffling] = useState(true);
  const shuffleEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [travelers, setTravelers] = useState<Traveler[]>([]);

  // Fresh watercolor back for every new game session.
  useEffect(() => { newCardBackSession(); }, []);

  // Refs used as source/destination anchors for the travel animation.
  const naviDeckRef     = useRef<HTMLDivElement>(null);
  const playerDeckRef   = useRef<HTMLButtonElement>(null);
  const naviPlayedRef   = useRef<HTMLDivElement>(null);
  const playerPlayedRef = useRef<HTMLDivElement>(null);
  const warPileRef      = useRef<HTMLDivElement>(null);

  /**
   * Kick off a travel animation from the currently-visible play/war slots to
   * the winner's deck. All animation inputs are passed in explicitly — this
   * function holds NO state in closure so it stays stable across renders and
   * is safe to invoke from a setTimeout scheduled in a prior render.
   *
   * Source positions come from refs (which always point at the current DOM);
   * source cards come from arguments (so we animate the cards the caller
   * actually intended, not whatever happened to be in state at render time).
   */
  const startTravel = useCallback((
    winnerSide: 'player' | 'navi',
    playerCard: Card | null,
    naviCard: Card | null,
    onDone: () => void,
  ) => {
    const deckEl = winnerSide === 'navi' ? naviDeckRef.current : playerDeckRef.current;
    if (!deckEl) { onDone(); return; }
    // Target the top card of the messy pile rather than the deck wrapper's
    // geometric center. The stack applies a cumulative upward offset per card
    // (sy = -i * 0.9), so on a tall pile the visible top sits well above the
    // wrapper's center — landing on center looks like the traveler dropped
    // below the pile.
    const topCard = deckEl.querySelectorAll<HTMLElement>(`.${styles['war__stack-card']}`);
    const anchorRect = topCard.length > 0
      ? topCard[topCard.length - 1].getBoundingClientRect()
      : deckEl.getBoundingClientRect();
    const dstX = anchorRect.left + anchorRect.width / 2 - 75 / 2;
    const dstY = anchorRect.top  + anchorRect.height / 2 - 100 / 2;

    const spawns: Traveler[] = [];
    let spawnIdx = 0;

    const pushPlayed = (
      card: Card | null,
      ref: React.RefObject<HTMLDivElement>,
      who: string,
    ) => {
      if (!card || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      spawns.push({
        id: `${who}-${card.id}`,
        card,
        srcX: r.left,
        srcY: r.top,
        rotSrc: 0,
        dstX, dstY,
        rotDst: (Math.random() - 0.5) * 14,
        delay: spawnIdx * 40,
        moving: false,
      });
      spawnIdx++;
    };
    pushPlayed(playerCard, playerPlayedRef, 'p');
    pushPlayed(naviCard,   naviPlayedRef,   'n');

    // War burns are read straight from the DOM — each rendered `.war__warcard`
    // element has already inherited the messy offset/rotation we want to
    // preserve. The warPile React state isn't used here, which keeps this
    // function closure-free.
    if (warPileRef.current) {
      const cards = warPileRef.current.querySelectorAll<HTMLElement>(`.${styles['war__warcard']}`);
      cards.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        spawns.push({
          id: `b-${spawnIdx}-${i}`,
          card: null, // burns stay face-down
          srcX: r.left,
          srcY: r.top,
          rotSrc: readRotation(el),
          dstX, dstY,
          rotDst: (Math.random() - 0.5) * 14,
          delay: spawnIdx * 40,
          moving: false,
        });
        spawnIdx++;
      });
    }

    if (spawns.length === 0) { onDone(); return; }

    setShownPlayer(null);
    setShownNavi(null);
    setWarPile([]);
    setPhase('travel');
    setTravelers(spawns);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTravelers((ts) => ts.map((t) => ({ ...t, moving: true })));
      });
    });

    window.setTimeout(() => {
      setTravelers([]);
      onDone();
    }, TRAVEL_MS + spawns.length * 40 + 80);
    // No shuffle tick bump here — per-round animations would re-fling the
    // whole pile on every win. The pile just re-renders with the new count
    // and the existing cards stay put.
  }, []);

  const handlePlay = useCallback(() => {
    if (phase !== 'idle') return;
    if (isGameOver(player, navi)) return;
    if (showStartHint) setShowStartHint(false);
    // Clear the prior turn's winner message now that a new turn is starting.
    setMessage('');

    const result = playRound(player, navi);
    const top = result.outcome;
    setShownPlayer(top.playerCard);
    setShownNavi(top.naviCard);

    const finalize = () => {
      setPlayer(result.nextPlayer);
      setNavi(result.nextNavi);
      if (isGameOver(result.nextPlayer, result.nextNavi)) {
        const w = winner(result.nextPlayer, result.nextNavi);
        setPhase('gameover');
        onEnd(w === 'navi' ? 'win' : 'lose');
      } else {
        setPhase('idle');
      }
    };

    if (top.kind === 'win') {
      setPhase('reveal');
      setMessage(
        top.winner === 'player' ? 'you won the round' : 'navi won this one',
      );
      window.setTimeout(() => {
        startTravel(top.winner, top.playerCard, top.naviCard, finalize);
      }, REVEAL_HOLD_MS);
    } else {
      setPhase('war');
      setMessage('this means WAR!');
      setWarPile(top.burned);
      window.setTimeout(() => {
        const finalWinner = flattenWinner(top);
        const fp = topPlayerCard(top);
        const fn = topNaviCard(top);
        setShownPlayer(fp);
        setShownNavi(fn);
        setPhase('reveal');
        setMessage(
          finalWinner === 'player'
            ? 'you take the whole pile!'
            : 'navi snags the whole pile!',
        );
        window.setTimeout(() => {
          startTravel(finalWinner, fp, fn, finalize);
        }, REVEAL_HOLD_MS);
      }, WAR_BURN_MS * 2);
    }
  }, [phase, player, navi, onEnd, showStartHint, startTravel]);

  // Full shuffle-keyframe duration (ms) — slightly longer than the CSS
  // animation so the gate stays open until the last card settles.
  const SHUFFLE_WINDOW_MS = 3200;

  const triggerShuffle = useCallback(() => {
    setIsShuffling(true);
    setShuffleTick((t) => t + 1);
    if (shuffleEndTimer.current) clearTimeout(shuffleEndTimer.current);
    shuffleEndTimer.current = setTimeout(() => setIsShuffling(false), SHUFFLE_WINDOW_MS);
  }, []);

  const handleShuffle = useCallback(() => {
    if (phase !== 'idle') return;
    setPlayer((p) => shuffle([...p]));
    setNavi((n)  => shuffle([...n]));
    triggerShuffle();
  }, [phase, triggerShuffle]);

  // Initial shuffle on mount — plays the keyframe once, then gates off so
  // subsequent pile additions (from winning rounds) mount silently.
  useEffect(() => {
    const t = window.setTimeout(() => triggerShuffle(), 150);
    return () => {
      clearTimeout(t);
      if (shuffleEndTimer.current) clearTimeout(shuffleEndTimer.current);
    };
  }, [triggerShuffle]);

  return (
    <div
      className={styles['war']}
      role="dialog"
      aria-label="War card game"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles['war__header']}>
        <div className={styles['war__title']}>War</div>
        <button type="button" className={styles['war__close']} onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className={styles['war__board']}>
        <div className={styles['war__side']}>
          <div className={styles['war__label']}>navi</div>
          <div className={styles['war__count']}>{navi.length}</div>
          <div className={styles['war__deck-wrap']}>
            <div className={styles['war__deck']} ref={naviDeckRef}>
              <CardStack count={navi.length} shuffleKey={shuffleTick} shuffling={isShuffling} />
            </div>
            <div className={styles['war__played']} ref={naviPlayedRef}>
              {shownNavi && <CardFace card={shownNavi} />}
            </div>
          </div>
        </div>

        <div className={styles['war__middle']}>
          <div className={styles['war__message']}>{message}</div>
          {warPile.length > 0 && (
            <div className={styles['war__warpile']} ref={warPileRef}>
              {warPile.map((c, i) => (
                <div
                  key={c.id}
                  className={styles['war__warcard']}
                  style={{ transform: `translate(${i * 6}px, ${i * 4}px) rotate(${(i - warPile.length / 2) * 4}deg)` }}
                >
                  <CardBack />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles['war__side']}>
          {showStartHint && (
            <div className={styles['war__hint']} aria-hidden="true">
              <div className={styles['war__hint-text']}>click your deck to start playing</div>
              <div className={styles['war__hint-arrow']} />
            </div>
          )}
          <div className={styles['war__label']} data-navi-anchor="you">you</div>
          <div className={styles['war__count']}>{player.length}</div>
          <div className={styles['war__deck-wrap']}>
            <button
              type="button"
              className={styles['war__deck-btn']}
              onClick={handlePlay}
              disabled={phase !== 'idle' || isGameOver(player, navi)}
              aria-label="Play top card"
              ref={playerDeckRef}
            >
              <CardStack count={player.length} shuffleKey={shuffleTick} shuffling={isShuffling} />
            </button>
            <div className={styles['war__played']} ref={playerPlayedRef}>
              {shownPlayer && <CardFace card={shownPlayer} />}
            </div>
          </div>
        </div>
      </div>

      <div className={styles['war__footer']}>
        <button
          type="button"
          className={styles['war__action']}
          onClick={handleShuffle}
          disabled={phase !== 'idle'}
        >
          shuffle
        </button>
      </div>

      {/* Traveler layer — cards in flight to the winner's deck. Fixed so they
          fly freely across the viewport regardless of board layout. */}
      {travelers.map((t) => (
        <div
          key={t.id}
          className={styles['war__traveler']}
          style={{
            left: `${t.srcX}px`,
            top:  `${t.srcY}px`,
            transform: t.moving
              ? `translate(${t.dstX - t.srcX}px, ${t.dstY - t.srcY}px) rotate(${t.rotDst}deg) scale(0.92)`
              : `rotate(${t.rotSrc}deg)`,
            transitionDelay: `${t.delay}ms`,
          }}
        >
          {t.card ? <CardFace card={t.card} /> : <CardBack />}
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TopOutcome = ReturnType<typeof playRound>['outcome'];

function flattenWinner(o: TopOutcome): 'player' | 'navi' {
  let cur = o;
  while (cur.kind === 'war') cur = cur.resolution;
  return cur.winner;
}

function topPlayerCard(o: TopOutcome): Card {
  let cur = o;
  while (cur.kind === 'war') cur = cur.resolution;
  return cur.playerCard;
}

function topNaviCard(o: TopOutcome): Card {
  let cur = o;
  while (cur.kind === 'war') cur = cur.resolution;
  return cur.naviCard;
}

/**
 * Extract the Z-axis rotation (degrees) from a DOM element's computed
 * transform matrix. Returns 0 if the matrix can't be parsed — travelers still
 * animate, just without inheriting the exact messy angle.
 */
function readRotation(el: HTMLElement): number {
  const cs = window.getComputedStyle(el);
  const m = cs.transform;
  if (!m || m === 'none') return 0;
  // matrix(a, b, c, d, tx, ty)  →  angle = atan2(b, a)
  const match = m.match(/matrix\(([^)]+)\)/);
  if (!match) return 0;
  const parts = match[1].split(',').map((s) => parseFloat(s));
  if (parts.length < 4) return 0;
  const [a, b] = parts;
  return Math.atan2(b, a) * 180 / Math.PI;
}

// Messy pile of face-down cards — one stacked element per card in the hand so
// the pile visibly grows/shrinks as cards change sides. Each card gets a
// deterministic jitter (offset + rotation) from its index so the pile looks
// hand-dealt without re-shuffling positions every render.
function CardStack({
  count,
  shuffleKey,
  shuffling,
}: {
  count: number;
  shuffleKey: number;
  shuffling: boolean;
}) {
  const visible = Math.min(count, 30);
  return (
    <div
      className={styles['war__stack']}
      data-shuffle-key={shuffleKey}
      data-shuffling={shuffling ? 'true' : 'false'}
    >
      {Array.from({ length: visible }).map((_, i) => {
        const j = jitter(i);
        const sx = i * 0.45 + j.dx;
        const sy = -i * 0.9 + j.dy;
        // CSS custom props let the shuffle keyframe land on this same messy
        // position, so the cards don't snap when `data-shuffling` flips off.
        const styleVars = {
          '--stack-x': `${sx}px`,
          '--stack-y': `${sy}px`,
          '--stack-rot': `${j.rot}deg`,
          transform: `translate(${sx}px, ${sy}px) rotate(${j.rot}deg)`,
          zIndex: i,
          animationDelay: `${Math.min(i * 70, 1800)}ms`,
        } as CSSProperties;
        return (
          <div
            key={`${shuffleKey}-${i}`}
            className={styles['war__stack-card']}
            style={styleVars}
          >
            <CardBack />
          </div>
        );
      })}
      {count === 0 && <div className={styles['war__stack-empty']}>empty</div>}
    </div>
  );
}

function jitter(i: number): { dx: number; dy: number; rot: number } {
  const h1 = Math.sin(i * 12.9898) * 43758.5453;
  const h2 = Math.sin(i * 78.233)  * 43758.5453;
  const h3 = Math.sin(i * 31.416)  * 43758.5453;
  const dx  = ((h1 - Math.floor(h1)) - 0.5) * 8;
  const dy  = ((h2 - Math.floor(h2)) - 0.5) * 6;
  const rot = ((h3 - Math.floor(h3)) - 0.5) * 14;
  return { dx, dy, rot };
}
