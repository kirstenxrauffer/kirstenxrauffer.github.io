import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameProps, Card } from '../types';
import { makeDeck, shuffle } from '../deck';
import {
  dealInitial,
  draw,
  discard,
  knock,
  bestMelding,
  ginRankOrder,
  naviChooseDraw,
  naviChooseDiscard,
  naviChooseKnock,
  naviChooseKnockMatch,
  type RummyState,
  type Meld,
} from './rummyLogic';
import { CardFace, CardBack } from './CardView';
import { newCardBackSession } from '../watercolorEngine';
import styles from './RummyGame.module.scss';
import { DEV_AUTOPLAY } from '../devAutoplay';

// Navi's think-time between actions so her moves feel deliberate.
const NAVI_DRAW_DELAY = 900;
const NAVI_DISCARD_DELAY = 1100;

// First player to reach this cumulative score across rounds wins the match.
const TARGET_SCORE = 75;

export default function RummyGame({ onEnd, onClose }: GameProps) {
  const initial = useMemo<RummyState>(() => dealInitial(shuffle(makeDeck())), []);
  const [state, setState] = useState<RummyState>(initial);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');
  const [showStartHint, setShowStartHint] = useState(true);
  // naviFlash: the id navi just picked up / discarded, for a brief highlight.
  const [naviFlashId, setNaviFlashId] = useState<number | null>(null);
  // DEV_AUTOPLAY — remove this line and the effect + button below to strip sim
  const [autoSim, setAutoSim] = useState(false);
  void setAutoSim;

  // Cumulative points across rounds; first to TARGET_SCORE wins the match.
  const [score, setScore] = useState({ player: 0, navi: 0 });
  const matchOver = score.player >= TARGET_SCORE || score.navi >= TARGET_SCORE;

  const stateRef = useRef<RummyState>(initial);
  useEffect(() => { stateRef.current = state; }, [state]);
  const scoreRef = useRef(score);
  useEffect(() => { scoreRef.current = score; }, [score]);
  // Guards the round-over effect so we only tally the score + notify onEnd
  // once per outcome (the effect re-runs whenever score changes).
  const processedOutcomeRef = useRef<RummyState['outcome']>(null);

  // Fresh watercolor back for every new game session.
  useEffect(() => { newCardBackSession(); }, []);

  // Sort the player's hand for readability — by suit, then by rank-order.
  // During the discard phase (hand has 11 cards), the last element is the
  // just-drawn card and is held out of the sort so it sits at the far right
  // of the row — this mirrors how humans play on a physical table, giving a
  // visual cue for "this is new — decide whether to keep it."
  const { sortedMain, newlyDrawn } = useMemo(() => {
    if (state.player.length === 11 && state.turn === 'player' && state.phase === 'discard') {
      const last = state.player[state.player.length - 1];
      const rest = state.player.slice(0, -1);
      return { sortedMain: sortHand(rest), newlyDrawn: last };
    }
    return { sortedMain: sortHand(state.player), newlyDrawn: null as Card | null };
  }, [state.player, state.turn, state.phase]);

  // Player's current meld analysis — drives which cards get highlighted and
  // whether knock/gin buttons are live.
  const playerMelding = useMemo(() => {
    if (state.player.length === 10) return bestMelding(state.player);
    // 11-card hand: show the best possible post-discard melding for the
    // currently selected discard card (or the best across all possibilities).
    if (selectedId != null) {
      const rest = state.player.filter((c) => c.id !== selectedId);
      return bestMelding(rest);
    }
    // No selection yet — show melds on full 11 to hint at what's available.
    return bestMelding(state.player);
  }, [state.player, selectedId]);

  const canKnock = state.player.length === 11 && selectedId != null &&
    bestMelding(state.player.filter((c) => c.id !== selectedId)).deadwoodValue <= 10;
  const isGin = state.player.length === 11 && selectedId != null &&
    bestMelding(state.player.filter((c) => c.id !== selectedId)).deadwoodValue === 0;

  // ── Finish detection ────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== 'gameover' || !state.outcome) return;
    if (processedOutcomeRef.current === state.outcome) return;
    processedOutcomeRef.current = state.outcome;

    const o = state.outcome;
    const roundMsg =
      o.winner === 'player'
        ? (o.knocker === 'player'
            ? (o.wasGin ? `gin! +${o.points}` : `you knocked for ${o.points}`)
            : `undercut! +${o.points}`)
        : o.winner === 'navi'
        ? (o.knocker === 'navi'
            ? (o.wasGin ? `navi got gin — +${o.points}` : `navi knocked — +${o.points}`)
            : `undercut! navi +${o.points}`)
        : 'stock empty — round drawn';

    const nextScore = {
      player: scoreRef.current.player + (o.winner === 'player' ? o.points : 0),
      navi:   scoreRef.current.navi   + (o.winner === 'navi'   ? o.points : 0),
    };
    setScore(nextScore);

    const matchEnded = nextScore.player >= TARGET_SCORE || nextScore.navi >= TARGET_SCORE;
    if (matchEnded) {
      const winnerLabel = nextScore.player > nextScore.navi ? 'you win' : 'navi wins';
      setMessage(`${roundMsg} · match: ${winnerLabel} ${nextScore.player}–${nextScore.navi}`);
      onEnd(nextScore.navi > nextScore.player ? 'win' : 'lose'); // navi's perspective
    } else {
      setMessage(`${roundMsg} · score: you ${nextScore.player}, navi ${nextScore.navi}`);
    }
  }, [state.phase, state.outcome, onEnd]);

  const handleNextRound = useCallback(() => {
    processedOutcomeRef.current = null;
    setState(dealInitial(shuffle(makeDeck())));
    setSelectedId(null);
    setNaviFlashId(null);
    setMessage('');
    setShowStartHint(true);
  }, []);

  // ── Navi's automated turn ──────────────────────────────────────────────────
  useEffect(() => {
    if (state.turn !== 'navi' || state.phase === 'gameover') return;
    const timer = window.setTimeout(() => {
      const s = stateRef.current;
      if (s.turn !== 'navi' || s.phase === 'gameover') return;

      if (s.phase === 'draw') {
        const source = naviChooseDraw(s);
        const picked = source === 'discard'
          ? s.discard[s.discard.length - 1]
          : s.stock[0];
        setNaviFlashId(picked?.id ?? null);
        setMessage(`navi draws from the ${source}`);
        try {
          setState(draw(s, 'navi', source));
        } catch {
          // Stock exhausted etc — state already updated for draw-source 'stock'
        }
      } else if (s.phase === 'discard') {
        const knockId = naviChooseKnockMatch(
          s,
          scoreRef.current.navi,
          scoreRef.current.player,
          TARGET_SCORE,
        );
        if (knockId != null) {
          setNaviFlashId(knockId);
          setMessage('navi is knocking…');
          setState(knock(s, 'navi', knockId));
        } else {
          const discardId = naviChooseDiscard(s);
          setNaviFlashId(discardId);
          const card = s.navi.find((c) => c.id === discardId);
          setMessage(card ? `navi discards ${card.rank}${card.suit}` : 'navi discards');
          setState(discard(s, 'navi', discardId));
        }
      }
    }, state.phase === 'draw' ? NAVI_DRAW_DELAY : NAVI_DISCARD_DELAY);
    return () => clearTimeout(timer);
  }, [state.turn, state.phase]);

  // DEV_AUTOPLAY: simulates player turns using the same logic as navi.
  // Remove this effect + the autoSim state + the sim button to strip it out.
  useEffect(() => {
    if (!DEV_AUTOPLAY || !autoSim) return;
    if (state.turn !== 'player' || state.phase === 'gameover') return;
    const timer = window.setTimeout(() => {
      const s = stateRef.current;
      if (s.turn !== 'player' || s.phase === 'gameover') return;
      if (s.phase === 'draw') {
        const source = naviChooseDraw({ ...s, navi: s.player });
        try {
          setState(draw(s, 'player', source));
        } catch { /* stock exhausted */ }
        setMessage(`auto: drew from ${source}`);
      } else if (s.phase === 'discard') {
        const proxyState = { ...s, navi: s.player };
        const knockId = naviChooseKnock(proxyState);
        if (knockId != null) {
          setState(knock(s, 'player', knockId));
          setMessage('auto: knocking');
        } else {
          const discardId = naviChooseDiscard(proxyState);
          setState(discard(s, 'player', discardId));
          setSelectedId(null);
          const card = s.player.find((c) => c.id === discardId);
          setMessage(card ? `auto: discards ${card.rank}${card.suit}` : 'auto: discards');
        }
      }
    }, state.phase === 'draw' ? NAVI_DRAW_DELAY : NAVI_DISCARD_DELAY);
    return () => clearTimeout(timer);
  }, [autoSim, state.turn, state.phase]);

  // Clear the navi-flash after a moment so it doesn't linger across turns.
  useEffect(() => {
    if (naviFlashId == null) return;
    const t = window.setTimeout(() => setNaviFlashId(null), 1100);
    return () => clearTimeout(t);
  }, [naviFlashId]);

  // ── Player actions ─────────────────────────────────────────────────────────
  const handleDrawStock = useCallback(() => {
    if (state.turn !== 'player' || state.phase !== 'draw') return;
    setState(draw(state, 'player', 'stock'));
    setMessage('now pick a card to discard');
    setShowStartHint(false);
  }, [state]);

  const handleDrawDiscard = useCallback(() => {
    if (state.turn !== 'player' || state.phase !== 'draw') return;
    if (state.discard.length === 0) return;
    setState(draw(state, 'player', 'discard'));
    setMessage('now pick a card to discard');
    setShowStartHint(false);
  }, [state]);

  const handleSelectCard = useCallback((id: number) => {
    if (state.turn !== 'player' || state.phase !== 'discard') return;
    setSelectedId((prev) => (prev === id ? null : id));
  }, [state.turn, state.phase]);

  const handleDiscard = useCallback(() => {
    if (state.turn !== 'player' || state.phase !== 'discard') return;
    if (selectedId == null) return;
    setState(discard(state, 'player', selectedId));
    setSelectedId(null);
    setMessage('navi is thinking…');
  }, [state, selectedId]);

  const handleKnock = useCallback(() => {
    if (state.turn !== 'player' || state.phase !== 'discard') return;
    if (selectedId == null) return;
    try {
      setState(knock(state, 'player', selectedId));
      setSelectedId(null);
    } catch (e) {
      setMessage(`can't knock: ${(e as Error).message}`);
    }
  }, [state, selectedId]);

  // Set of card ids that are part of a meld, for visual grouping in the hand.
  const meldedIds = useMemo(() => {
    const s = new Set<number>();
    playerMelding.melds.forEach((m) => m.forEach((c) => s.add(c.id)));
    return s;
  }, [playerMelding]);

  const topDiscard = state.discard[state.discard.length - 1] ?? null;
  const gameOver = state.phase === 'gameover';

  return (
    <div
      className={styles['rummy']}
      role="dialog"
      aria-label="Gin Rummy"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles['rummy__header']}>
        <div className={styles['rummy__heading']}>
          <div className={styles['rummy__title']}>Gin Rummy</div>
          <div className={styles['rummy__score']} aria-label="match score">
            you <strong>{score.player}</strong> · navi <strong>{score.navi}</strong>
            <span className={styles['rummy__score-target']}> · first to {TARGET_SCORE}</span>
          </div>
        </div>
        <button type="button" className={styles['rummy__close']} onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* Navi's hand — face-down with the newly-drawn/discarded card flashed. */}
      <div className={styles['rummy__navi']}>
        <div className={styles['rummy__side-label']} data-navi-anchor="navi">
          navi · {state.navi.length} card{state.navi.length === 1 ? '' : 's'}
        </div>
        <div className={styles['rummy__navi-hand']}>
          {state.navi.map((c) => (
            <div
              key={c.id}
              className={`${styles['rummy__navi-card']} ${naviFlashId === c.id ? styles['rummy__navi-card--flash'] : ''}`}
            >
              <CardBack small />
            </div>
          ))}
        </div>
      </div>

      {/* Middle: stock + discard pile. */}
      <div className={styles['rummy__middle']}>
        <div className={styles['rummy__message']}>{message}</div>
        <div className={styles['rummy__piles']}>
          {showStartHint && state.turn === 'player' && state.phase === 'draw' && !gameOver && (
            <div className={styles['rummy__hint']} aria-hidden="true">
              <div className={styles['rummy__hint-text']}>
                draw from the stock or the discard pile
              </div>
              <div className={styles['rummy__hint-arrow']} />
            </div>
          )}
          <button
            type="button"
            className={styles['rummy__pile-btn']}
            onClick={handleDrawStock}
            disabled={state.turn !== 'player' || state.phase !== 'draw' || state.stock.length === 0 || gameOver}
            aria-label="Draw from stock"
          >
            <div className={styles['rummy__pile-label']}>stock ({state.stock.length})</div>
            {state.stock.length > 0 ? <CardBack /> : <div className={styles['rummy__pile-empty']}>empty</div>}
          </button>

          <button
            type="button"
            className={styles['rummy__pile-btn']}
            onClick={handleDrawDiscard}
            disabled={state.turn !== 'player' || state.phase !== 'draw' || state.discard.length === 0 || gameOver}
            aria-label="Draw top of discard"
          >
            <div className={styles['rummy__pile-label']}>discard</div>
            {topDiscard ? <CardFace card={topDiscard} /> : <div className={styles['rummy__pile-empty']}>empty</div>}
          </button>
        </div>

        <div className={styles['rummy__deadwood']}>
          your deadwood: <strong>{playerMelding.deadwoodValue}</strong>
          {state.player.length === 11 && (
            <span className={styles['rummy__deadwood-hint']}>
              {' '}(after selecting a discard)
            </span>
          )}
        </div>
      </div>

      {/* Player's hand — sorted, with meld highlights. */}
      <div className={styles['rummy__player']}>
        <div className={styles['rummy__side-label']}>you</div>
        <div className={styles['rummy__player-hand']}>
          {sortedMain.map((c) => (
            <button
              key={c.id}
              type="button"
              className={[
                styles['rummy__card-btn'],
                selectedId === c.id  ? styles['rummy__card-btn--selected'] : '',
                meldedIds.has(c.id)  ? styles['rummy__card-btn--melded']   : '',
                state.phase !== 'discard' || state.turn !== 'player' ? styles['rummy__card-btn--idle'] : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelectCard(c.id)}
              disabled={gameOver}
            >
              <CardFace card={c} />
            </button>
          ))}
          {newlyDrawn && (
            <button
              key={newlyDrawn.id}
              type="button"
              className={[
                styles['rummy__card-btn'],
                styles['rummy__card-btn--new'],
                selectedId === newlyDrawn.id ? styles['rummy__card-btn--selected'] : '',
                meldedIds.has(newlyDrawn.id) ? styles['rummy__card-btn--melded']   : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelectCard(newlyDrawn.id)}
              disabled={gameOver}
              aria-label="newly drawn card"
            >
              <CardFace card={newlyDrawn} />
            </button>
          )}
        </div>

        <div className={styles['rummy__actions']}>
          {/* DEV sim button — uncomment for autoplay debugging.
          {DEV_AUTOPLAY && (
            <button
              type="button"
              className={`${styles['rummy__action']} ${styles['rummy__action--sim']}`}
              onClick={() => setAutoSim((v) => !v)}
            >
              {autoSim ? 'sim ■' : 'sim ▶'}
            </button>
          )}
          */}
          <button
            type="button"
            className={styles['rummy__action']}
            onClick={handleDiscard}
            disabled={state.turn !== 'player' || state.phase !== 'discard' || selectedId == null || gameOver}
          >
            discard
          </button>
          <button
            type="button"
            className={`${styles['rummy__action']} ${styles['rummy__action--knock']}`}
            onClick={handleKnock}
            disabled={!canKnock || gameOver}
          >
            {isGin ? 'gin!' : 'knock'}
          </button>
        </div>
      </div>

      {/* End-of-game reveal — shows both hands' meld decompositions. */}
      {gameOver && state.outcome && (
        <div className={styles['rummy__reveal']} onClick={(e) => e.stopPropagation()}>
          <div className={styles['rummy__reveal-title']}>
            {matchOver
              ? (score.player > score.navi ? 'you win the match!' : 'navi wins the match')
              : state.outcome.wasGin
              ? (state.outcome.knocker === 'player' ? 'gin!' : 'navi got gin')
              : state.outcome.winner === 'draw'
              ? 'round drawn'
              : state.outcome.knocker === 'player' ? 'knock' : 'navi knocked'}
          </div>
          <MeldingView label="your melds"  melding={state.outcome.playerMelding} />
          <MeldingView label="navi's melds" melding={state.outcome.naviMelding} />
          <div className={styles['rummy__reveal-score']}>{message}</div>
          {matchOver ? (
            <button type="button" className={styles['rummy__action']} onClick={onClose}>
              close
            </button>
          ) : (
            <button
              type="button"
              className={`${styles['rummy__action']} ${styles['rummy__action--knock']}`}
              onClick={handleNextRound}
              autoFocus
            >
              next round
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Supporting components ────────────────────────────────────────────────────

function MeldingView({ label, melding }: { label: string; melding: { melds: Meld[]; deadwood: Card[]; deadwoodValue: number } }) {
  return (
    <div className={styles['rummy__melding']}>
      <div className={styles['rummy__melding-label']}>
        {label} — deadwood {melding.deadwoodValue}
      </div>
      <div className={styles['rummy__melding-rows']}>
        {melding.melds.map((m, i) => (
          <div key={i} className={styles['rummy__melding-row']}>
            {m.map((c) => (
              <div key={c.id} className={styles['rummy__melding-card']}>
                <CardFace card={c} small />
              </div>
            ))}
          </div>
        ))}
        {melding.deadwood.length > 0 && (
          <div className={`${styles['rummy__melding-row']} ${styles['rummy__melding-row--deadwood']}`}>
            {melding.deadwood.map((c) => (
              <div key={c.id} className={styles['rummy__melding-card']}>
                <CardFace card={c} small />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortHand(hand: Card[]): Card[] {
  // Group by suit (♥ ♦ ♠ ♣ in that order), then by rank-order within each suit.
  const suitOrder: Record<string, number> = { '♥': 0, '♦': 1, '♠': 2, '♣': 3 };
  return [...hand].sort((a, b) => {
    const sDiff = suitOrder[a.suit] - suitOrder[b.suit];
    if (sDiff !== 0) return sDiff;
    return ginRankOrder(a.rank) - ginRankOrder(b.rank);
  });
}
