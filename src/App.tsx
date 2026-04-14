import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { FairyCanvas } from './features/fairies';
import { WatercolorCanvas } from './features/watercolor';
import { HERO_IMAGES } from './features/watercolor/constants';
import NavMenu from './components/NavMenu';
import { WORK_MANIFEST } from './features/work/workManifest';
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';
import './App.css';

// Page routes are eager — each is ~1KB gzipped, and lazy-loading them caused
// a one-frame Suspense flash on first navigation (even with chunk preloading,
// React.lazy throws on first mount). WorkCarousel stays lazy: it's much
// larger and only mounts behind an explicit nav click.
const WorkCarousel = lazy(() => import('./features/work/WorkCarousel'));
// Game components are loaded on demand from the registry.
import { findGame } from './features/games/gameRegistry';
import { setBackgroundPalette } from './features/games/watercolorEngine';
import { navArea } from './features/fairies/navArea';
import type { GameResult, GameProps } from './features/games/types';

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Isolated so route-driven re-renders never reach the canvas.
const SceneBackground = React.memo(function SceneBackground({
  currentImage,
  fadingOut,
  onRevealStart,
  onPalette,
}: {
  currentImage: string;
  fadingOut: boolean;
  onRevealStart: () => void;
  onPalette: (palette: string[]) => void;
}) {
  return (
    <div style={{ opacity: fadingOut ? 0 : 1, transition: 'opacity 0.5s ease' }}>
      <WatercolorCanvas
        key={currentImage}
        image={currentImage}
        onRevealStart={onRevealStart}
        onPalette={onPalette}
      />
    </div>
  );
});

function App() {
  const [sceneQueue] = useState<string[]>(() => shuffle(HERO_IMAGES));

  // revealStarted: fires immediately on canvas mount → enables section entrance animation
  const [revealStarted, setRevealStarted] = useState(false);
  // revealComplete: set by a timer after the full reveal plays out →
  //   shows NavMenu + locks sections to final state so nav clicks don't replay animations
  const [revealComplete, setRevealComplete] = useState(false);

  const routesRef       = useRef<HTMLDivElement>(null);
  const routesInnerRef  = useRef<HTMLDivElement>(null);
  const location        = useLocation();

  // Measure the routed content height and push it to --section-h on the outer
  // wrapper so the nav can position itself via a transitioned translateY.
  // Using `top: calc(100% + 8px)` doesn't transition — 100% resolves against
  // the parent's computed height which jumps instantly on route swap. Driving
  // a transform off a CSS variable lets the transition on .nav-menu interpolate
  // the new offset smoothly.
  // Apply --section-h = measured content height (in px). Ignores 0-height
  // frames so the lazy-route Suspense fallback never drags the nav through 0.
  const applySectionHeight = useCallback(() => {
    const inner = routesInnerRef.current;
    const outer = routesRef.current;
    if (!inner || !outer) return;
    const h = inner.offsetHeight;
    if (h === 0) return;
    outer.style.setProperty('--section-h', `${h}px`);
  }, []);

  // Initial measurement + ResizeObserver for ambient height changes (window
  // resize, font swap, etc). Transition is gated until after the first
  // measurement commits so the page-load paint doesn't animate 0 → measured.
  useLayoutEffect(() => {
    const inner = routesInnerRef.current;
    const outer = routesRef.current;
    if (!inner || !outer) return;
    applySectionHeight();
    const raf = requestAnimationFrame(() => {
      outer.dataset.navReady = 'true';
    });
    const ro = new ResizeObserver(applySectionHeight);
    ro.observe(inner);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [applySectionHeight]);

  // Re-measure synchronously on every route change, BEFORE the browser
  // paints. ResizeObserver is async and fires after one paint frame — that
  // frame briefly shows the new route's content with the old route's
  // --section-h, which is the "nav appears too low/high then snaps" flash.
  useLayoutEffect(() => {
    applySectionHeight();
  }, [location.pathname, applySectionHeight]);

  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);
  const [activeCompany,  setActiveCompany]  = useState<string | null>(null);
  const [exitingCompany, setExitingCompany] = useState<string | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRevealStart = useCallback(() => setRevealStarted(true), []);
  const handlePalette     = useCallback((p: string[]) => {
    setPalette(p);
    // Feed the scene palette into the card-back generator so game decks
    // visually belong to whichever hero image is showing.
    setBackgroundPalette(p);
  }, []);

  // Surface the nav right after the hero title finishes scattering in
  // (scatter variant: max 0.7s random offset + 1.1s animation ≈ 1.8s). Tied
  // to title settle rather than the full watercolor reveal so nav appears early.
  useEffect(() => {
    if (!revealStarted) return;
    const id = window.setTimeout(
      () => setRevealComplete(true),
      1250,
    );
    return () => clearTimeout(id);
  }, [revealStarted]);

  const CAROUSEL_EXIT_MS = 380;

  const handleClose = useCallback(() => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (activeCompany !== null) {
      setExitingCompany(activeCompany);
      setActiveCompany(null);
      exitTimerRef.current = setTimeout(() => {
        setExitingCompany(null);
        setNavOpen(false);
      }, CAROUSEL_EXIT_MS);
    } else {
      setNavOpen(false);
      setExitingCompany(null);
    }
  }, [activeCompany]);

  const handleCompanySelect = useCallback((slug: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (activeCompany === slug) return;
    if (activeCompany !== null) {
      setExitingCompany(activeCompany);
      setActiveCompany(null);
      exitTimerRef.current = setTimeout(() => {
        setExitingCompany(null);
        setActiveCompany(slug);
      }, CAROUSEL_EXIT_MS);
    } else {
      setActiveCompany(slug);
    }
  }, [activeCompany]);

  const handleFairyClick = useCallback(() => {
    setNavOpen(prev => !prev);
  }, []);

  // ── Game overlay state ──────────────────────────────────────────────────────
  // activeGameId drives which entry from GAME_REGISTRY is rendered. The lazy
  // component is resolved on demand and cached per game id.
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [LoadedGame, setLoadedGame] = useState<ComponentType<GameProps> | null>(null);
  const gameCacheRef = useRef<Map<string, ComponentType<GameProps>>>(new Map());
  // lingerResult keeps the celebrate/angry mood on navi for a few seconds
  // after the modal closes so the user sees the reaction animation play out.
  const moodResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGameStart = useCallback(async (id: string) => {
    const entry = findGame(id);
    if (!entry || !entry.available) return;
    // Clear any lingering mood from the previous round.
    if (moodResetTimer.current) clearTimeout(moodResetTimer.current);
    navArea.currentMood = 'normal';

    const cached = gameCacheRef.current.get(id);
    if (cached) {
      setLoadedGame(() => cached);
      setActiveGameId(id);
      return;
    }
    const mod = await entry.component();
    gameCacheRef.current.set(id, mod.default);
    setLoadedGame(() => mod.default);
    setActiveGameId(id);
  }, []);

  const handleGameClose = useCallback(() => {
    setActiveGameId(null);
    setLoadedGame(null);
    // Give navi a moment to finish the reaction animation, then reset mood.
    if (moodResetTimer.current) clearTimeout(moodResetTimer.current);
    moodResetTimer.current = setTimeout(() => {
      navArea.currentMood = 'normal';
    }, 5000);
  }, []);

  const handleGameEnd = useCallback((result: GameResult) => {
    if (result === 'win') navArea.currentMood = 'celebrate';
    else if (result === 'lose') navArea.currentMood = 'angry';
    // Modal stays open so user can read the result + close manually.
  }, []);

  useEffect(() => {
    return () => {
      if (moodResetTimer.current) clearTimeout(moodResetTimer.current);
    };
  }, []);

  const currentImage = sceneQueue[0];

  const mainClass = [
    'app__main',
    revealStarted  ? 'app__main--revealed' : '',
    revealComplete ? 'app__main--stable'   : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="app">
      <SceneBackground
        currentImage={currentImage}
        fadingOut={false}
        onRevealStart={handleRevealStart}
        onPalette={handlePalette}
      />
      <FairyCanvas
        onFairyClick={handleFairyClick}
        navOpen={navOpen}
        onGameStart={handleGameStart}
        gameActive={activeGameId !== null}
      />
      <main className={mainClass}>
        <div className="app__routes" ref={routesRef}>
          <div className="app__routes-inner" ref={routesInnerRef}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
            </Routes>
          </div>
          <NavMenu
            open={navOpen}
            ready={revealComplete}
            onClose={handleClose}
            onCompanySelect={handleCompanySelect}
            palette={palette}
          />
        </div>
      </main>

      {/* Two separate keyed instances so exit plays on the outgoing instance
          while the new one mounts fresh and runs its enter animation. */}
      <Suspense fallback={null}>
        {exitingCompany && (() => {
          const co = WORK_MANIFEST.find(c => c.slug === exitingCompany || c.label === exitingCompany);
          return co ? <WorkCarousel key={'exit-' + exitingCompany} company={co} onClose={handleClose} exiting /> : null;
        })()}
        {activeCompany && (() => {
          const co = WORK_MANIFEST.find(c => c.slug === activeCompany || c.label === activeCompany);
          return co ? <WorkCarousel key={activeCompany} company={co} onClose={handleClose} /> : null;
        })()}
      </Suspense>

      {/* Game overlay — renders whichever game the user picked from the prompt. */}
      {activeGameId && LoadedGame && (
        <LoadedGame onEnd={handleGameEnd} onClose={handleGameClose} />
      )}
    </div>
  );
}

export default App;
