import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Card, GameProps } from '../types';
import { makeDeck, shuffle } from '../deck';
import {
  applyMove,
  applySpit,
  applySlap,
  applyFillEmpty,
  canFillEmpty,
  deadlockWinner,
  isDeadlock,
  canSpit,
  canAnySpit,
  dealInitial,
  gameWinner,
  isTotallyStuck,
  legalMovesFor,
  pickFillSource,
  roundEnded,
  stockpilesEmpty,
  topOf,
  type SpitState,
  type SideState,
  type Move,
} from './spitLogic';
import { CardBack, CardFace } from './CardView';
import { newCardBackSession } from '../watercolorEngine';
import styles from './SpitGame.module.scss';

// Navi's move cadence (ms). Randomised within this range each tick to feel
// human. Tuned deliberately slow — the computer has perfect information about
// every legal move, so reaction time is the only real handicap. Real play-
// testing: at 900–1500ms navi was near-unbeatable; this slower range gives
// the human a fighting chance while still applying pressure.
// Slower than before so the player has a real chance to find moves first.
// Previous 1800-2800 still felt rushed on tight boards.
const NAVI_MIN_DELAY = 2600;
const NAVI_MAX_DELAY = 4000;

// Feedback flash duration when the player drops on an illegal target.
const FLASH_MS = 260;

// Pixels the pointer must travel before a pointerdown is treated as a drag
// (vs a stray click). Keeps tiny hand tremors from triggering the ghost.
const DRAG_THRESHOLD_PX = 3;

type DragState = {
  pointerId: number;
  pileIdx: number;
  card: Card;
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number; // grab offset so the ghost lifts in place, not snapping to the cursor
  offsetY: number;
  moved: boolean;
};

// 'idle'    — board dealt but waiting for the player to click START so navi
//             doesn't start racing the moment the modal opens.
// 'playing' — active game; navi AI is allowed to move.
// 'slap'    — one side just cleared their stockpiles. The CLEARING side is
//             the only one allowed to slap — no time pressure, no race.
//             (Earlier iteration made this a competitive race, which didn't
//             leave enough time to read the centre-pile sizes.)
// 'gameover'— terminal; winner decided (one side has 0 total cards).
type GamePhase = 'idle' | 'playing' | 'slap' | 'gameover';

// Navi's reaction when SHE is the clearer — she picks a centre pile after a
// brief pause. Still 50/50 per the earlier direction (ignores pile size).
const NAVI_SLAP_MIN = 700;
const NAVI_SLAP_MAX = 1600;

export default function SpitGame({ onEnd, onClose }: GameProps) {
  const initial = useMemo<SpitState>(() => dealInitial(shuffle(makeDeck())), []);
  const [state, setState] = useState<SpitState>(initial);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  const [naviHighlight, setNaviHighlight] = useState<Move | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [message, setMessage] = useState<string>('click start when you\'re ready');
  // Whoever just cleared their stockpiles — ONLY they may claim a centre pile
  // during 'slap'. Null outside slap phase.
  const [slapperSide, setSlapperSide] = useState<'player' | 'navi' | null>(null);

  // Refs mirror state for the navi timer so it sees live data each tick
  // without re-scheduling on every React render.
  const stateRef = useRef<SpitState>(initial);
  const phaseRef = useRef<GamePhase>('idle');
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { dragRef.current = drag; }, [drag]);

  const handleStart = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    setPhase('playing');
    setMessage('');
  }, []);

  // Fresh watercolor back for every new game session.
  useEffect(() => { newCardBackSession(); }, []);

  // Finish detection — three possible transitions from 'playing':
  //   • Overall game over (one side has ZERO cards anywhere)   → 'gameover'
  //   • One side cleared their stockpiles (round ends)         → 'slap'
  //   • Otherwise: keep playing.
  useEffect(() => {
    if (phase !== 'playing') return;
    const gw = gameWinner(state);
    if (gw) {
      setPhase('gameover');
      setMessage(gw === 'player' ? 'you ran navi out of cards — you win!' : 'navi ran you out of cards — you lose.');
      onEnd(gw === 'navi' ? 'win' : 'lose');
      return;
    }
    if (roundEnded(state)) {
      // The side whose stockpiles are empty gets to claim. No race — the
      // clearer takes whichever pile they want (smaller is usually better,
      // but it's their choice and their own time).
      const playerCleared = stockpilesEmpty(state.player);
      const clearer: 'player' | 'navi' = playerCleared ? 'player' : 'navi';
      setSlapperSide(clearer);
      setPhase('slap');
      setMessage(
        playerCleared
          ? 'you cleared — pick a centre pile to take'
          : 'navi cleared — she\'s choosing a pile…',
      );
      return;
    }
    // Unresolvable deadlock — totally stuck AND no spit cards. Nobody
    // cleared so slap doesn't apply; fall back to a card-count tiebreak.
    // Fewer cards wins (closer to clearing the deck). Ties favour the human.
    if (isDeadlock(state)) {
      const winnerSide = deadlockWinner(state);
      setPhase('gameover');
      setMessage(
        winnerSide === 'player'
          ? 'deadlock — you had fewer cards, you win!'
          : 'deadlock — navi had fewer cards, you lose.',
      );
      onEnd(winnerSide === 'navi' ? 'win' : 'lose');
      return;
    }
  }, [state, phase, onEnd]);

  // ─── Interaction: click to play, drag to rearrange ────────────────────────
  // Two separate gestures, resolved on pointerup:
  //   • pointerdown → pointerup with NO movement (<= DRAG_THRESHOLD_PX) →
  //     CLICK: play the pile's top to a legal centre pile (prefers the first
  //     legal centre; flashes the pile if no legal play exists).
  //   • pointerdown → pointermove past threshold → pointerup over an EMPTY
  //     player stockpile → DRAG: fill-empty the target with this card.
  //     Drags released anywhere else (centre piles, same pile, off-board)
  //     are silent no-ops — drag is specifically the rearrange gesture.
  const flashPile = useCallback((idx: number) => {
    setFlashIdx(idx);
    window.setTimeout(() => setFlashIdx((f) => (f === idx ? null : f)), FLASH_MS);
  }, []);

  const playTopToCenter = useCallback((pileIdx: number) => {
    const s = stateRef.current;
    const legal = legalMovesFor(s.player, s.center).filter((m) => m.pileIdx === pileIdx);
    if (legal.length === 0) {
      flashPile(pileIdx);
      return;
    }
    const pick = legal[0];
    const { side: nextPlayer, center: nextCenter } = applyMove(s.player, s.center, pick);
    setState({ ...s, player: nextPlayer, center: nextCenter });
    setMessage('');
  }, [flashPile]);

  const beginDrag = useCallback((pileIdx: number, ev: React.PointerEvent<HTMLElement>) => {
    if (phaseRef.current !== 'playing') return;
    const s = stateRef.current;
    const card = topOf(s.player.stockpiles[pileIdx]);
    if (!card) return;
    // Anchor the ghost to the top card's rect so it lifts from exactly where
    // the visible card sits, not from the oversized pile container.
    const topEl = ev.currentTarget.querySelector<HTMLElement>(`.${styles['spit__top']}`);
    const rect = (topEl ?? ev.currentTarget).getBoundingClientRect();
    const offsetX = ev.clientX - (rect.left + rect.width / 2);
    const offsetY = ev.clientY - (rect.top + rect.height / 2);
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* capture can fail on some touch stacks — we fall back to window listeners via React synthetic events */ }
    setDrag({
      pointerId: ev.pointerId,
      pileIdx,
      card,
      startX: ev.clientX,
      startY: ev.clientY,
      x: ev.clientX,
      y: ev.clientY,
      offsetX,
      offsetY,
      moved: false,
    });
  }, []);

  const resolveDrop = useCallback((x: number, y: number, d: DragState) => {
    const s = stateRef.current;
    // Hit-test for an empty player stockpile under the release point. Drag
    // is only the rearrange gesture now, so centre piles and non-empty own
    // piles are not drop targets — those releases are silent no-ops.
    let node: HTMLElement | null = document.elementFromPoint(x, y) as HTMLElement | null;
    while (node) {
      if (node.getAttribute('data-drop-kind') === 'pile') {
        const targetIdx = Number(node.getAttribute('data-drop-idx'));
        if (Number.isFinite(targetIdx)
          && targetIdx !== d.pileIdx
          && s.player.stockpiles[targetIdx].length === 0) {
          const nextPlayer = applyFillEmpty(s.player, d.pileIdx, targetIdx);
          setState({ ...s, player: nextPlayer });
          setMessage('');
        }
        return;
      }
      node = node.parentElement;
    }
  }, []);

  const handlePointerMove = useCallback((ev: React.PointerEvent<HTMLElement>) => {
    setDrag((d) => {
      if (!d || d.pointerId !== ev.pointerId) return d;
      const moved = d.moved
        || Math.abs(ev.clientX - d.startX) > DRAG_THRESHOLD_PX
        || Math.abs(ev.clientY - d.startY) > DRAG_THRESHOLD_PX;
      return { ...d, x: ev.clientX, y: ev.clientY, moved };
    });
  }, []);

  const handlePointerUp = useCallback((ev: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== ev.pointerId) return;
    if (d.moved) {
      resolveDrop(ev.clientX, ev.clientY, d);
    } else {
      // Treat as a click — play the top to the first legal centre pile.
      playTopToCenter(d.pileIdx);
    }
    setDrag(null);
  }, [resolveDrop, playTopToCenter]);

  const handlePointerCancel = useCallback((ev: React.PointerEvent<HTMLElement>) => {
    setDrag((d) => (d && d.pointerId === ev.pointerId ? null : d));
  }, []);

  // Manual spit — available ONLY when the board is totally stuck (no centre
  // moves AND no fill-empty moves on either side). The button is the single
  // trigger; there's no auto-spit timer.
  const handleSpit = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    const s = stateRef.current;
    if (!isTotallyStuck(s) || !canAnySpit(s)) return;
    setState(applySpit(s));
    setMessage('');
  }, []);

  // Player's slap — only fires when PLAYER is the clearer. No timer, no
  // race: the clearer picks whichever centre pile they want at their own
  // pace. Clicks while navi is the clearer are ignored (her own effect
  // handles that case).
  const handlePlayerSlap = useCallback((centerIdx: 0 | 1) => {
    if (phaseRef.current !== 'slap') return;
    if (slapperSide !== 'player') return;
    const s = stateRef.current;
    const nextState = applySlap(s, 'player', centerIdx, shuffle);
    const pSize = s.center[centerIdx].length;
    const nSize = s.center[centerIdx === 0 ? 1 : 0].length;
    const got   = pSize <= nSize ? 'smaller' : 'larger';
    setState(nextState);
    setSlapperSide(null);
    const gw = gameWinner(nextState);
    if (gw) {
      setPhase('gameover');
      setMessage(gw === 'player' ? 'you ran navi out of cards — you win!' : 'navi ran you out of cards — you lose.');
      onEnd(gw === 'navi' ? 'win' : 'lose');
      return;
    }
    setPhase('playing');
    setMessage(`you took the ${got} pile (+${pSize} cards). new round!`);
  }, [onEnd, slapperSide]);

  // Navi's slap — only fires when NAVI is the clearer. She picks a pile as
  // a 50/50 coin flip (per user direction: she doesn't exploit knowing
  // which is smaller). If the PLAYER cleared this effect no-ops, and the
  // player has unlimited time to decide.
  useEffect(() => {
    if (phase !== 'slap') return;
    if (slapperSide !== 'navi') return;
    const delay = NAVI_SLAP_MIN + Math.random() * (NAVI_SLAP_MAX - NAVI_SLAP_MIN);
    const t = window.setTimeout(() => {
      if (phaseRef.current !== 'slap') return;
      const s = stateRef.current;
      const choice: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
      const nextState = applySlap(s, 'navi', choice, shuffle);
      const nSize = s.center[choice].length;
      const pSize = s.center[choice === 0 ? 1 : 0].length;
      const got   = nSize <= pSize ? 'smaller' : 'larger';
      setState(nextState);
      setSlapperSide(null);
      const gw = gameWinner(nextState);
      if (gw) {
        setPhase('gameover');
        setMessage(gw === 'player' ? 'you ran navi out of cards — you win!' : 'navi ran you out of cards — you lose.');
        onEnd(gw === 'navi' ? 'win' : 'lose');
        return;
      }
      setPhase('playing');
      setMessage(`navi took the ${got} pile (+${nSize} cards for navi). new round!`);
    }, delay);
    return () => clearTimeout(t);
  }, [phase, slapperSide, onEnd]);

  // Navi AI — one move per tick when it has a legal option. Uses refs so the
  // scheduler never goes stale across renders.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const delay = NAVI_MIN_DELAY + Math.random() * (NAVI_MAX_DELAY - NAVI_MIN_DELAY);
      timer = setTimeout(tick, delay);
    };
    const tick = () => {
      if (cancelled) return;
      if (phaseRef.current !== 'playing') { schedule(); return; }
      const s = stateRef.current;
      const moves = legalMovesFor(s.navi, s.center);

      if (moves.length === 0) {
        // No centre play — if any of navi's stockpiles are empty, slide a
        // card from her largest pile into the vacant slot. This mirrors the
        // rule the human can trigger by clicking an empty slot, and prevents
        // navi from stalling when she's got room to re-organise.
        const emptyIdx = s.navi.stockpiles.findIndex((p) => p.length === 0);
        if (emptyIdx >= 0 && canFillEmpty(s.navi)) {
          const sourceIdx = pickFillSource(s.navi, emptyIdx);
          if (sourceIdx != null) {
            const nextNavi = applyFillEmpty(s.navi, sourceIdx, emptyIdx);
            setState({ ...s, navi: nextNavi });
          }
        }
        schedule();
        return;
      }

      // Prefer pile #0..4 in descending size so navi tends to open up taller
      // piles first — more strategic, and mirrors how humans play.
      moves.sort((a, b) =>
        s.navi.stockpiles[b.pileIdx].length - s.navi.stockpiles[a.pileIdx].length,
      );
      // Add a dash of randomness: shuffle the top third so navi isn't fully
      // deterministic.
      if (moves.length > 1 && Math.random() < 0.35) {
        const i = Math.floor(Math.random() * moves.length);
        [moves[0], moves[i]] = [moves[i], moves[0]];
      }
      const pick = moves[0];
      setNaviHighlight(pick);
      window.setTimeout(() => setNaviHighlight(null), 280);
      const { side: nextNavi, center: nextCenter } = applyMove(s.navi, s.center, pick);
      setState({ ...s, navi: nextNavi, center: nextCenter });
      schedule();
    };
    schedule();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  // Drive the status line. SPIT is now manual-only (no auto-timer): it lights
  // up only when the whole board is genuinely locked — no centre plays AND
  // no fill-empty moves for either side. Anything less and the player is
  // expected to find the remaining move themselves.
  useEffect(() => {
    if (phase !== 'playing') return;
    if (roundEnded(state) || gameWinner(state) != null) return; // another effect owns the message
    if (isTotallyStuck(state)) {
      if (canSpit(state)) {
        setMessage('fully stuck — click SPIT to flip new cards');
      } else if (canAnySpit(state)) {
        const whose = state.player.spit.length > 0 ? 'your' : 'navi\'s';
        setMessage(`fully stuck — click SPIT to flip from ${whose} reserve`);
      } else {
        setMessage('deadlock — no cards left to flip');
      }
      return;
    }
    setMessage((m) => (m.startsWith('fully stuck') || m.startsWith('deadlock') ? '' : m));
  }, [state, phase]);

  const playerLegal = useMemo(
    () => new Set(legalMovesFor(state.player, state.center).map((m) => m.pileIdx)),
    [state],
  );
  // Also compute navi's legal moves so her tops can be shown with a subtle
  // indicator — lets the human see what navi's likely to grab.
  const naviLegal = useMemo(
    () => new Set(legalMovesFor(state.navi, state.center).map((m) => m.pileIdx)),
    [state],
  );

  // SPIT only lights up when the board is fully locked — no centre moves AND
  // no fill-empty moves on either side — and both reserves have a card.
  const spitAvailable = phase === 'playing' && isTotallyStuck(state) && canAnySpit(state);

  // While a drag is active, light up empty player slots — drag is only for
  // rearranging, so those are the sole drop targets.
  const emptyDropTargets = useMemo(() => {
    const out = new Set<number>();
    if (!drag) return out;
    state.player.stockpiles.forEach((p, i) => {
      if (p.length === 0 && i !== drag.pileIdx) out.add(i);
    });
    return out;
  }, [drag, state]);

  // Idle glow: empty player slots that can be productively filled right now.
  // "Productive" means there's a source pile with ≥2 cards — moving a lone
  // card from one pile to an empty slot just relocates the hole (same empty
  // count afterwards), so we don't cue that case.
  const fillableEmptyIdx = useMemo(() => {
    const out = new Set<number>();
    if (phase !== 'playing') return out;
    const hasUsefulSource = state.player.stockpiles.some((p) => p.length >= 2);
    if (!hasUsefulSource) return out;
    state.player.stockpiles.forEach((p, i) => {
      if (p.length === 0) out.add(i);
    });
    return out;
  }, [state, phase]);

  return (
    <div
      className={styles['spit']}
      role="dialog"
      aria-label="Spit card game"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles['spit__header']}>
        <div className={styles['spit__title']}>Spit</div>
        <button
          type="button"
          className={styles['spit__close']}
          onClick={onClose}
          aria-label="Close"
        >×</button>
      </div>

      <div className={styles['spit__board']}>
        <SideRow
          side={state.navi}
          owner="navi"
          // Navi's top cards are face-up now — the human needs to see what
          // navi is holding so the race feels skill-based rather than blind.
          // Under-stack cards stay face-down (nobody's turned them yet).
          legalSet={naviLegal}
          highlightPileIdx={naviHighlight?.pileIdx ?? null}
          interactive={false}
        />

        <div
          className={styles['spit__center']}
          data-slap={phase === 'slap' && slapperSide === 'player' ? 'true' : 'false'}
        >
          <CenterPile
            pile={state.center[0]}
            highlight={naviHighlight?.centerIdx === 0}
            // Only the player-slapper sees the glowing invite + click target;
            // when navi is the clearer the piles stay passive as she picks.
            slappable={phase === 'slap' && slapperSide === 'player'}
            onSlap={phase === 'slap' && slapperSide === 'player' ? () => handlePlayerSlap(0) : undefined}
          />
          <CenterPile
            pile={state.center[1]}
            highlight={naviHighlight?.centerIdx === 1}
            slappable={phase === 'slap' && slapperSide === 'player'}
            onSlap={phase === 'slap' && slapperSide === 'player' ? () => handlePlayerSlap(1) : undefined}
          />
        </div>

        <SideRow
          side={state.player}
          owner="player"
          legalSet={playerLegal}
          flashIdx={flashIdx}
          interactive={phase === 'playing'}
          drag={drag}
          dropEmptyIdx={emptyDropTargets}
          fillableEmptyIdx={fillableEmptyIdx}
          onPointerDownPile={beginDrag}
          onPointerMovePile={handlePointerMove}
          onPointerUpPile={handlePointerUp}
          onPointerCancelPile={handlePointerCancel}
        />
      </div>

      <div className={styles['spit__footer']}>
        <div className={styles['spit__message']}>{message || '\u00a0'}</div>
        <div className={styles['spit__actions']}>
          {phase === 'idle' && (
            <button
              type="button"
              className={`${styles['spit__action']} ${styles['spit__action--primary']}`}
              onClick={handleStart}
              autoFocus
            >
              start
            </button>
          )}
          {phase !== 'idle' && (
            <button
              type="button"
              className={styles['spit__action']}
              onClick={handleSpit}
              disabled={!spitAvailable}
            >
              spit!
            </button>
          )}
        </div>
      </div>

      {drag && drag.moved && createPortal(
        <div
          className={styles['spit__ghost']}
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY }}
        >
          <CardFace card={drag.card} />
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SideRow({
  side,
  owner,
  legalSet,
  flashIdx,
  highlightPileIdx,
  interactive,
  drag,
  dropEmptyIdx,
  fillableEmptyIdx,
  onPointerDownPile,
  onPointerMovePile,
  onPointerUpPile,
  onPointerCancelPile,
}: {
  side: SideState;
  owner: 'player' | 'navi';
  legalSet?: Set<number>;
  flashIdx?: number | null;
  highlightPileIdx?: number | null;
  interactive: boolean;
  drag?: DragState | null;
  dropEmptyIdx?: Set<number>;
  fillableEmptyIdx?: Set<number>;
  onPointerDownPile?: (i: number, ev: React.PointerEvent<HTMLElement>) => void;
  onPointerMovePile?: (ev: React.PointerEvent<HTMLElement>) => void;
  onPointerUpPile?: (ev: React.PointerEvent<HTMLElement>) => void;
  onPointerCancelPile?: (ev: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <div className={styles[`spit__row`]} data-owner={owner}>
      <div
        className={styles['spit__label']}
        {...(owner === 'navi' ? { 'data-navi-anchor': 'navi' } : {})}
      >
        {owner === 'player' ? 'you' : 'navi'}
      </div>
      <div className={styles['spit__piles']}>
        {side.stockpiles.map((pile, i) => (
          <Stockpile
            key={i}
            pile={pile}
            legal={legalSet?.has(i) ?? false}
            flashing={flashIdx === i}
            highlight={highlightPileIdx === i}
            // Tops visible for both sides so the race reads clearly. Only the
            // under-stack (history) stays face-down — nobody has seen those
            // cards yet.
            facedown={false}
            owner={owner}
            pileIdx={i}
            interactive={interactive}
            isDragSource={drag?.pileIdx === i}
            dropActive={dropEmptyIdx?.has(i) ?? false}
            fillable={fillableEmptyIdx?.has(i) ?? false}
            onPointerDown={onPointerDownPile}
            onPointerMove={onPointerMovePile}
            onPointerUp={onPointerUpPile}
            onPointerCancel={onPointerCancelPile}
          />
        ))}
      </div>
      <div className={styles['spit__spit']} aria-label={`${owner} spit reserve`}>
        {side.spit.length > 0 ? <CardBack /> : <EmptySlot label="spit" />}
      </div>
    </div>
  );
}

function Stockpile({
  pile,
  legal,
  flashing,
  highlight,
  facedown,
  owner,
  pileIdx,
  interactive,
  isDragSource,
  dropActive,
  fillable,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  pile: Card[];
  legal: boolean;
  flashing: boolean;
  highlight: boolean;
  facedown: boolean;
  owner: 'player' | 'navi';
  pileIdx: number;
  interactive: boolean;
  isDragSource: boolean;
  dropActive: boolean;
  fillable: boolean;
  onPointerDown?: (i: number, ev: React.PointerEvent<HTMLElement>) => void;
  onPointerMove?: (ev: React.PointerEvent<HTMLElement>) => void;
  onPointerUp?: (ev: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (ev: React.PointerEvent<HTMLElement>) => void;
}) {
  const top = pile.length ? pile[pile.length - 1] : null;
  const isPlayer = owner === 'player';
  // Only the top card is grabbable — empty slots participate only as drop
  // targets (fill-empty), never as drag sources.
  const draggable = isPlayer && interactive && !!top;
  const understack = pile.slice(0, -1);
  return (
    <div
      className={styles['spit__pile']}
      data-legal={legal ? 'true' : 'false'}
      data-flashing={flashing ? 'true' : 'false'}
      data-highlight={highlight ? 'true' : 'false'}
      data-owner={owner}
      data-drop-kind={isPlayer ? 'pile' : undefined}
      data-drop-idx={isPlayer ? String(pileIdx) : undefined}
      data-drop-active={dropActive ? 'true' : undefined}
      data-fillable={fillable ? 'true' : undefined}
      data-drag-source={isDragSource ? 'true' : undefined}
      data-draggable={draggable ? 'true' : undefined}
      onPointerDown={draggable
        ? (ev) => {
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            ev.preventDefault();
            onPointerDown?.(pileIdx, ev);
          }
        : undefined}
      onPointerMove={draggable ? onPointerMove : undefined}
      onPointerUp={draggable ? onPointerUp : undefined}
      onPointerCancel={draggable ? onPointerCancel : undefined}
    >
      {understack.map((_c, i) => {
        const j = pileJitter(i);
        return (
          <div
            key={i}
            className={styles['spit__understack']}
            style={{
              transform: `translate(${i * 0.5 + j.dx}px, ${-i * 0.9 + j.dy}px) rotate(${j.rot}deg)`,
              zIndex: i,
            }}
          >
            <CardBack />
          </div>
        );
      })}
      <div
        className={styles['spit__top']}
        style={{ zIndex: understack.length + 1 }}
      >
        {top ? (
          facedown ? <CardBack /> : <CardFace card={top} />
        ) : (
          <EmptySlot label="—" />
        )}
      </div>
      <span className={styles['spit__pile-count']}>{pile.length}</span>
    </div>
  );
}

function CenterPile({
  pile,
  highlight,
  slappable = false,
  onSlap,
}: {
  pile: Card[];
  highlight: boolean;
  slappable?: boolean;
  onSlap?: () => void;
}) {
  const top = pile.length ? pile[pile.length - 1] : null;
  const inner = (
    <>
      {top ? <CardFace card={top} /> : <EmptySlot label="—" />}
      <span className={styles['spit__pile-count']}>{pile.length}</span>
    </>
  );
  const common = {
    className: styles['spit__center-pile'],
    'data-highlight': highlight ? 'true' : 'false',
    'data-slappable': slappable ? 'true' : 'false',
  };
  if (slappable && onSlap) {
    return (
      <button type="button" {...common} onClick={onSlap} aria-label={`slap ${pile.length}-card pile`}>
        {inner}
      </button>
    );
  }
  return <div {...common}>{inner}</div>;
}

function EmptySlot({ label }: { label: string }) {
  return <div className={styles['spit__empty']}>{label}</div>;
}

/**
 * Deterministic per-index jitter for the understack card backs — mirrors the
 * messy pile effect in the War game so pile sizes are visible at a glance.
 * Same index always produces the same offset/rotation, so React re-renders
 * don't flicker the pile shape mid-play.
 */
function pileJitter(i: number): { dx: number; dy: number; rot: number } {
  const h1 = Math.sin(i * 12.9898) * 43758.5453;
  const h2 = Math.sin(i * 78.233)  * 43758.5453;
  const h3 = Math.sin(i * 31.416)  * 43758.5453;
  const dx  = ((h1 - Math.floor(h1)) - 0.5) * 7;   // ±3.5 px
  const dy  = ((h2 - Math.floor(h2)) - 0.5) * 5;   // ±2.5 px
  const rot = ((h3 - Math.floor(h3)) - 0.5) * 12;  // ±6°
  return { dx, dy, rot };
}
