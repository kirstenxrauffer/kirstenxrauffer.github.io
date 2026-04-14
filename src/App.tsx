import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Route, Routes } from 'react-router-dom';
import { FairyCanvas } from './features/fairies';
import { WatercolorCanvas } from './features/watercolor';
import { HERO_IMAGES } from './features/watercolor/constants';
import NavMenu from './components/NavMenu';
import WorkCarousel from './features/work/WorkCarousel';
import { WORK_MANIFEST } from './features/work/workManifest';
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';
import './App.css';

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

  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);
  const [activeCompany,  setActiveCompany]  = useState<string | null>(null);
  const [exitingCompany, setExitingCompany] = useState<string | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRevealStart = useCallback(() => setRevealStarted(true), []);
  const handlePalette     = useCallback((p: string[]) => setPalette(p), []);

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
      <FairyCanvas onFairyClick={handleFairyClick} navOpen={navOpen} />
      <main className={mainClass}>
        <div className="app__routes">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
          </Routes>
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
      {exitingCompany && (() => {
        const co = WORK_MANIFEST.find(c => c.slug === exitingCompany || c.label === exitingCompany);
        return co ? <WorkCarousel key={'exit-' + exitingCompany} company={co} onClose={handleClose} exiting /> : null;
      })()}
      {activeCompany && (() => {
        const co = WORK_MANIFEST.find(c => c.slug === activeCompany || c.label === activeCompany);
        return co ? <WorkCarousel key={activeCompany} company={co} onClose={handleClose} /> : null;
      })()}
    </div>
  );
}

export default App;
