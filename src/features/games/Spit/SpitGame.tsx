import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Card, GameProps } from '../types';
import { makeDeck, shuffle } from '../deck';
import {
  applyMove,
  applySpit,
  applySlap,
  applyEndgameSetup,
  applyEndgameSlap,
  applyFillEmpty,
  canProductiveFill,
  deadlockWinner,
  isDeadlock,
  canSpit,
  canAnySpit,
  dealInitial,
  gameWinner,
  isTotallyStuck,
  legalMovesFor,
  needsEndgameRound,
  pickFillSource,
  roundEnded,
  stockpilesEmpty,
  topOf,
  type SpitState,
  type SideState,
  type Move,
  type Side,
} from './spitLogic';
import { CardBack, CardFace } from './CardView';
import { newCardBackSession } from '../watercolorEngine';
import styles from './SpitGame.module.scss';
import { DEV_AUTOPLAY } from '../devAutoplay';

// Navi's move cadence (ms). Randomised within this range each tick to feel
// human. Tuned deliberately slow — the computer has perfect information about
// every legal move, so reaction time is the only real handicap. Real play-
// testing: at 900–1500ms navi was near-unbeatable; this slower range gives
// the human a fighting chance while still applying pressure.
// Slower than before so the player has a real chance to find moves first.
// Previous 1800-2800 still felt rushed on tight boards.
const NAVI_MIN_DELAY = 1800;
const NAVI_MAX_DELAY = 2800;

// Burst mode — navi occasionally goes on a tear, playing cards at BURST_DELAY
// speed for BURST_DURATION ms. Every BURST_CHECK_INTERVAL ms the AI rolls:
// 30% chance normally, 60% if the player has no legal moves (pressure!).
const BURST_CHECK_INTERVAL = 4000;
const BURST_CHANCE_NORMAL  = 0.30;
const BURST_CHANCE_PRESSED = 0.60;
const BURST_DELAY          = 400;
const BURST_DURATION       = 4000; // ms the burst window stays open

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
  const [message, setMessage] = useState<string>('click a spit deck to deal');
  // Whoever just cleared their stockpiles — ONLY they may claim a centre pile
  // during 'slap'. Null outside slap phase.
  const [slapperSide, setSlapperSide] = useState<'player' | 'navi' | null>(null);
  // Endgame: the side whose spit reserve ran out after dealing. They
  // borrow 1 face-down card from the opponent as their spit card.
  const [endgameWinner, setEndgameWinner] = useState<Side | null>(null);
  // The borrowed face-down card — sits visually in the centre at the
  // winner's spit position but is NOT in state.center (so nobody can
  // play onto it). Added back to the pile during the slap.
  const [facedownCard, setFacedownCard] = useState<Card | null>(null);
  // DEV_AUTOPLAY — remove this line and the effect + button below to strip sim
  const [autoSim, setAutoSim] = useState(false);
  void setAutoSim;

  // Refs mirror state for the navi timer so it sees live data each tick
  // without re-scheduling on every React render.
  const stateRef = useRef<SpitState>(initial);
  const phaseRef = useRef<GamePhase>('idle');
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { dragRef.current = drag; }, [drag]);

  // Start the game by flipping the first spit card — triggered by clicking
  // either spit deck or the spit button while idle.
  const handleStart = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    setState((s) => applySpit(s));
    setPhase('playing');
    setMessage('');
  }, []);

  // Fresh watercolor back for every new game session.
  useEffect(() => { newCardBackSession(); }, []);

  // Finish detection — possible transitions from 'playing':
  //   • A side reaches 0 total cards (played their last card)     → 'gameover'
  //   • One side cleared stockpiles (round end)                   → 'slap'
  //   • Unresolvable deadlock                                     → 'gameover'
  //
  // In endgame rounds both sides still have stockpile cards — the winner
  // just has no spit reserve. The same checks apply; if the winner clears
  // their stockpiles they hit 0 total → gameWinner fires → they win.
  // If the loser clears → roundEnded → endgame slap.
  useEffect(() => {
    if (phase !== 'playing') return;

    const gw = gameWinner(state);
    if (gw) {
      setPhase('gameover');
      setMessage(gw === 'player' ? 'you played your last card — you win!' : 'navi played her last card — you lose.');
      onEnd(gw === 'navi' ? 'win' : 'lose');
      return;
    }

    if (roundEnded(state)) {
      const playerCleared = stockpilesEmpty(state.player);
      const clearer: 'player' | 'navi' = playerCleared ? 'player' : 'navi';
      setSlapperSide(clearer);
      setPhase('slap');
      if (endgameWinner) {
        setMessage(
          clearer === 'player'
            ? 'you cleared — slap to take the pile'
            : 'navi cleared — reversing…',
        );
      } else {
        setMessage(
          playerCleared
            ? 'you cleared — pick a centre pile to take'
            : 'navi cleared — she\'s choosing a pile…',
        );
      }
      return;
    }

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
  }, [state, phase, endgameWinner, onEnd]);

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
    // Hit-test under the release point. Two valid drop kinds:
    //   'pile'   — own empty stockpile (fill-empty rearrange gesture)
    //   'center' — a centre pile (play the card if legal for this source)
    // Anything else is a silent no-op.
    let node: HTMLElement | null = document.elementFromPoint(x, y) as HTMLElement | null;
    while (node) {
      const kind = node.getAttribute('data-drop-kind');
      if (kind === 'pile') {
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
      if (kind === 'center') {
        const centerIdx = Number(node.getAttribute('data-drop-idx')) as 0 | 1;
        if (centerIdx === 0 || centerIdx === 1) {
          const legal = legalMovesFor(s.player, s.center)
            .find((m) => m.pileIdx === d.pileIdx && m.centerIdx === centerIdx);
          if (legal) {
            const { side: nextPlayer, center: nextCenter } = applyMove(s.player, s.center, legal);
            setState({ ...s, player: nextPlayer, center: nextCenter });
            setMessage('');
          } else {
            flashPile(d.pileIdx);
          }
        }
        return;
      }
      node = node.parentElement;
    }
  }, [flashPile]);

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

  // Manual spit — available when idle (first flip) or when the board is
  // totally stuck. Clicking either spit deck or the spit button triggers it.
  const handleSpit = useCallback(() => {
    if (phaseRef.current === 'idle') { handleStart(); return; }
    if (phaseRef.current !== 'playing') return;
    const s = stateRef.current;
    if (!isTotallyStuck(s) || !canAnySpit(s)) return;
    setState(applySpit(s));
    setMessage('');
  }, [handleStart]);

  // Shared post-slap transition: checks for endgame setup, game over, or
  // continues to the next round.
  const resolveSlap = useCallback((
    nextState: SpitState,
    slapper: 'player' | 'navi',
    claimedSize: number,
    otherSize: number,
  ) => {
    const got = claimedSize <= otherSize ? 'smaller' : 'larger';

    // After redistribution, if one side has no spit reserve → endgame.
    const egw = needsEndgameRound(nextState);
    if (egw) {
      const { state: egState, facedownCard: fd } = applyEndgameSetup(nextState, egw);
      setState(egState);
      setFacedownCard(fd);
      setSlapperSide(null);
      setEndgameWinner(egw);
      setPhase('idle');
      setMessage(
        egw === 'player'
          ? 'endgame — click spit to deal!'
          : 'endgame — click spit to deal!',
      );
      return;
    }

    setState(nextState);
    setSlapperSide(null);
    setEndgameWinner(null);
    setFacedownCard(null);
    setPhase('idle');
    const sizeNote = slapper === 'player'
      ? `you took the ${got} pile (+${claimedSize} cards). click spit to deal!`
      : `navi took the ${got} pile (+${claimedSize} cards for navi). click spit to deal!`;
    setMessage(sizeNote);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: run the endgame slap — loser gets 1 card (the face-down card),
  // winner takes everything else. The face-down card must be included in
  // the total pool since it's not in state.center.
  const doEndgameSlap = useCallback((s: SpitState, egWinner: Side) => {
    // Add the face-down card back into the pool before redistribution.
    const withFacedown: SpitState = facedownCard
      ? {
          ...s,
          center: egWinner === 'player'
            ? [[...s.center[0], facedownCard], s.center[1]]
            : [s.center[0], [...s.center[1], facedownCard]],
        }
      : s;
    const nextState = applyEndgameSlap(withFacedown, egWinner, shuffle);
    // The result goes through resolveSlap which may trigger another endgame.
    resolveSlap(nextState, egWinner === 'player' ? 'navi' : 'player', 1, 0);
  }, [facedownCard, resolveSlap]);

  // Player's slap — only fires when PLAYER is the clearer.
  const handlePlayerSlap = useCallback((centerIdx: 0 | 1) => {
    if (phaseRef.current !== 'slap') return;
    if (slapperSide !== 'player') return;
    const s = stateRef.current;
    if (endgameWinner) {
      doEndgameSlap(s, endgameWinner);
      return;
    }
    const nextState = applySlap(s, 'player', centerIdx, shuffle);
    const pSize = s.center[centerIdx].length;
    const nSize = s.center[centerIdx === 0 ? 1 : 0].length;
    resolveSlap(nextState, 'player', pSize, nSize);
  }, [slapperSide, endgameWinner, resolveSlap, doEndgameSlap]);

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
      if (endgameWinner) {
        doEndgameSlap(s, endgameWinner);
        return;
      }
      const choice: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
      const nextState = applySlap(s, 'navi', choice, shuffle);
      const nSize = s.center[choice].length;
      const pSize = s.center[choice === 0 ? 1 : 0].length;
      resolveSlap(nextState, 'navi', nSize, pSize);
    }, delay);
    return () => clearTimeout(t);
  }, [phase, slapperSide, endgameWinner, resolveSlap, doEndgameSlap]);

  // Navi AI — one move per tick when it has a legal option. Uses refs so the
  // scheduler never goes stale across renders.
  // Burst mode: every BURST_CHECK_INTERVAL ms navi rolls to enter a burst —
  // a flurry of BURST_LENGTH moves at BURST_DELAY speed. The roll chance is
  // higher (60%) when the player has no legal plays (pressure!).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let burstUntil = 0;          // timestamp when current burst expires (0 = no burst)
    let msSinceLastBurstCheck = 0;
    let lastTickTime = Date.now();

    const inBurst = () => Date.now() < burstUntil;

    const schedule = () => {
      // If mid-burst, use the fast delay.
      if (inBurst()) {
        timer = setTimeout(tick, BURST_DELAY);
        return;
      }
      const delay = NAVI_MIN_DELAY + Math.random() * (NAVI_MAX_DELAY - NAVI_MIN_DELAY);

      // Check whether enough time has elapsed to roll for a burst.
      const now = Date.now();
      msSinceLastBurstCheck += now - lastTickTime;
      lastTickTime = now;
      if (msSinceLastBurstCheck >= BURST_CHECK_INTERVAL) {
        msSinceLastBurstCheck = 0;
        const s = stateRef.current;
        const playerHasMoves = legalMovesFor(s.player, s.center).length > 0;
        const chance = playerHasMoves ? BURST_CHANCE_NORMAL : BURST_CHANCE_PRESSED;
        if (Math.random() < chance) {
          burstUntil = Date.now() + BURST_DURATION;
          timer = setTimeout(tick, BURST_DELAY);
          return;
        }
      }

      timer = setTimeout(tick, delay);
    };
    const tick = () => {
      if (cancelled) return;
      if (phaseRef.current !== 'playing') { schedule(); return; }
      const s = stateRef.current;

      // Priority 1: fill any empty slots before playing to centre. More exposed
      // tops means more legal plays available on the next tick.
      // Guarded by canProductiveFill (source pile has >1 cards) — a source of
      // size 1 just relocates the empty slot and would ping-pong forever.
      const emptyIdx = s.navi.stockpiles.findIndex((p) => p.length === 0);
      if (emptyIdx >= 0 && canProductiveFill(s.navi)) {
        const sourceIdx = pickFillSource(s.navi, emptyIdx);
        if (sourceIdx != null) {
          const nextNavi = applyFillEmpty(s.navi, sourceIdx, emptyIdx);
          setState({ ...s, navi: nextNavi });
          schedule();
          return;
        }
      }

      // Priority 2: play a card to a centre pile.
      const moves = legalMovesFor(s.navi, s.center);
      if (moves.length === 0) {
        burstUntil = 0; // nothing to play — end burst early
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
        setMessage('press SPIT to deal a new card');
      } else if (canAnySpit(state)) {
        setMessage(`press SPIT to deal a new card`);
      } else {
        setMessage('Deadlock');
      }
      return;
    }
    setMessage((m) => (m.startsWith('fully stuck') || m.startsWith('deadlock') ? '' : m));
  }, [state, phase]);

  // DEV_AUTOPLAY: simulates player moves automatically.
  // Remove this effect + the autoSim state + the sim button to strip it out.
  useEffect(() => {
    if (!DEV_AUTOPLAY || !autoSim || phase === 'gameover') return;
    const t = window.setTimeout(() => {
      if (phase === 'idle') { handleStart(); return; }
      if (phase === 'slap' && slapperSide === 'player') {
        handlePlayerSlap(Math.random() < 0.5 ? 0 : 1);
        return;
      }
      if (phase === 'playing') {
        const s = stateRef.current;
        const moves = legalMovesFor(s.player, s.center);
        if (moves.length > 0) {
          playTopToCenter(moves[0].pileIdx);
        } else if (isTotallyStuck(s) && canAnySpit(s)) {
          handleSpit();
        }
      }
    }, 500);
    return () => clearTimeout(t);
  }, [autoSim, phase, state, slapperSide, handleStart, handlePlayerSlap, playTopToCenter, handleSpit]);

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
  const spitAvailable = phase === 'idle' || (phase === 'playing' && isTotallyStuck(state) && canAnySpit(state));

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
          <div
            className={styles['spit__spit']}
            aria-label="navi spit reserve"
            data-owner="navi"
            data-clickable={spitAvailable ? 'true' : 'false'}
            onClick={spitAvailable ? handleSpit : undefined}
            style={spitAvailable ? { cursor: 'pointer' } : undefined}
          >
            {state.navi.spit.length > 0 ? <CardBack /> : <EmptySlot label="—" />}
            <div className={styles['spit__spit-count']} data-owner="navi">
              spit
              <span className={styles['spit__spit-count-num']}>{state.navi.spit.length}</span>
            </div>
          </div>
          {/* Centre pile 0: player's spit position. During endgame where
              player is the winner, show the face-down card here instead. */}
          {endgameWinner === 'player' && facedownCard ? (
            <div className={styles['spit__center-pile']}>
              <div className={styles['spit__top']} style={{ zIndex: 1 }}>
                <CardBack />
              </div>
            </div>
          ) : (
            <CenterPile
              pile={state.center[0]}
              centerIdx={0}
              highlight={naviHighlight?.centerIdx === 0}
              slappable={phase === 'slap' && slapperSide === 'player'}
              onSlap={phase === 'slap' && slapperSide === 'player' ? () => handlePlayerSlap(0) : undefined}
            />
          )}
          {/* Centre pile 1: navi's spit position. During endgame where
              navi is the winner, show the face-down card here instead. */}
          {endgameWinner === 'navi' && facedownCard ? (
            <div className={styles['spit__center-pile']}>
              <div className={styles['spit__top']} style={{ zIndex: 1 }}>
                <CardBack />
              </div>
            </div>
          ) : (
            <CenterPile
              pile={state.center[1]}
              centerIdx={1}
              highlight={naviHighlight?.centerIdx === 1}
              slappable={phase === 'slap' && slapperSide === 'player'}
              onSlap={phase === 'slap' && slapperSide === 'player' ? () => handlePlayerSlap(1) : undefined}
            />
          )}
          <div
            className={styles['spit__spit']}
            aria-label="player spit reserve"
            data-owner="player"
            data-clickable={spitAvailable ? 'true' : 'false'}
            onClick={spitAvailable ? handleSpit : undefined}
            style={spitAvailable ? { cursor: 'pointer' } : undefined}
          >
            {state.player.spit.length > 0 ? <CardBack /> : <EmptySlot label="—" />}
            <div className={styles['spit__spit-count']} data-owner="player">
              spit
              <span className={styles['spit__spit-count-num']}>{state.player.spit.length}</span>
            </div>
          </div>
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
          {/* DEV sim button — uncomment for autoplay debugging.
          {DEV_AUTOPLAY && (
            <button
              type="button"
              className={`${styles['spit__action']} ${styles['spit__action--sim']}`}
              onClick={() => setAutoSim((v) => !v)}
            >
              {autoSim ? 'sim ■' : 'sim ▶'}
            </button>
          )}
          */}
          <button
            type="button"
            className={`${styles['spit__action']}${phase === 'idle' ? ` ${styles['spit__action--primary']}` : ''}`}
            onClick={handleSpit}
            disabled={!spitAvailable}
          >
            spit!
          </button>
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
  const totalCards = side.stockpiles.reduce((sum, p) => sum + p.length, 0) + side.spit.length;
  return (
    <div className={styles[`spit__row`]} data-owner={owner}>
      <div
        className={styles['spit__label']}
        {...(owner === 'navi' ? { 'data-navi-anchor': 'navi' } : {})}
      >
        {owner === 'player' ? 'you' : 'navi'}
        <span className={styles['spit__label-count']}>{totalCards}</span>
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
    </div>
  );
}

function CenterPile({
  pile,
  centerIdx,
  highlight,
  slappable = false,
  onSlap,
}: {
  pile: Card[];
  centerIdx: 0 | 1;
  highlight: boolean;
  slappable?: boolean;
  onSlap?: () => void;
}) {
  const top = pile.length ? pile[pile.length - 1] : null;
  const understack = pile.slice(0, -1);
  const visibleUnder = understack.slice(-15);
  const inner = (
    <>
      {visibleUnder.map((_, i) => {
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
        style={{ zIndex: visibleUnder.length + 1 }}
      >
        {top ? <CardFace card={top} /> : <EmptySlot label="—" />}
      </div>
    </>
  );
  const common = {
    className: styles['spit__center-pile'],
    'data-highlight': highlight ? 'true' : 'false',
    'data-slappable': slappable ? 'true' : 'false',
    'data-drop-kind': 'center',
    'data-drop-idx': String(centerIdx),
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
