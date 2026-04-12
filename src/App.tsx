import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAppSelector } from './app/hooks';
import { FairyCanvas } from './features/fairies';
import { WatercolorCanvas } from './features/watercolor';
import { HERO_IMAGES, REVEAL_DURATION } from './features/watercolor/constants';
import NavMenu from './components/NavMenu';
import Home from './pages/Home';
import Work from './pages/Work';
import About from './pages/About';
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
}: {
  currentImage: string;
  fadingOut: boolean;
  onRevealStart: () => void;
}) {
  return (
    <div style={{ opacity: fadingOut ? 0 : 1, transition: 'opacity 0.5s ease' }}>
      <WatercolorCanvas
        key={currentImage}
        image={currentImage}
        onRevealStart={onRevealStart}
      />
    </div>
  );
});

function App() {
  const mode = useAppSelector((s) => s.theme.mode);

  const [sceneQueue, setSceneQueue] = useState<string[]>(() => shuffle(HERO_IMAGES));
  const [fadingOut, setFadingOut] = useState(false);

  // revealStarted: fires immediately on canvas mount → enables section entrance animation
  const [revealStarted, setRevealStarted] = useState(false);
  // revealComplete: set by a timer after the full reveal plays out →
  //   shows NavMenu + locks sections to final state so nav clicks don't replay animations
  const [revealComplete, setRevealComplete] = useState(false);

  const transitioningRef = useRef(false);

  const handleRevealStart = useCallback(() => setRevealStarted(true), []);

  // Timer-based reveal completion — independent of GSAP / canvas lifecycle / StrictMode.
  // Fires (REVEAL_DURATION + 1.5s tween delay + 1s buffer) after revealStarted.
  // StrictMode double-fire is safe: cleanup cancels the first timer, second is canonical.
  useEffect(() => {
    if (!revealStarted) return;
    const id = window.setTimeout(
      () => setRevealComplete(true),
      (REVEAL_DURATION + 1.5 + 1) * 1000,
    );
    return () => clearTimeout(id);
  }, [revealStarted]);

  const handleFairyClick = useCallback(() => {
    if (transitioningRef.current || sceneQueue.length <= 1) return;
    transitioningRef.current = true;
    setFadingOut(true);
    setTimeout(() => {
      setSceneQueue(q => q.slice(1));
      setRevealStarted(false);
      setRevealComplete(false);
      setFadingOut(false);
      transitioningRef.current = false;
    }, 600);
  }, [sceneQueue.length]);

  const currentImage = sceneQueue[0];

  const mainClass = [
    'app__main',
    revealStarted  ? 'app__main--revealed' : '',
    revealComplete ? 'app__main--stable'   : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`app app--${mode}`}>
      <SceneBackground
        currentImage={currentImage}
        fadingOut={fadingOut}
        onRevealStart={handleRevealStart}
      />
      <FairyCanvas onFairyClick={handleFairyClick} />
      {revealComplete && <NavMenu />}

      <main className={mainClass}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/work" element={<Work />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
