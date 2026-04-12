import { useState, useRef, useCallback } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from './app/hooks';
import { toggleTheme } from './features/theme/themeSlice';
import { FairyCanvas } from './features/fairies';
import { WatercolorCanvas } from './features/watercolor';
import { HERO_IMAGES } from './features/watercolor/constants';
import Home from './pages/Home';
import Work from './pages/Work';
import About from './pages/About';
import './App.css';

// Fisher-Yates shuffle — runs once at app init to randomise scene order.
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function App() {
  const mode = useAppSelector((s) => s.theme.mode);
  const dispatch = useAppDispatch();
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\//, '');

  // Scene queue: shuffled once on mount, consumed front-to-back. Clicking the
  // fairy advances to the next image; when the queue has one entry left there
  // are no more unique scenes and clicks do nothing.
  const [sceneQueue, setSceneQueue] = useState<string[]>(() => shuffle(HERO_IMAGES));
  const [fadingOut, setFadingOut] = useState(false);
  const transitioningRef = useRef(false);

  const handleFairyClick = useCallback(() => {
    if (transitioningRef.current || sceneQueue.length <= 1) return;
    transitioningRef.current = true;
    setFadingOut(true);
    // Swap after the CSS fade-out completes (500 ms), with a 100 ms buffer.
    setTimeout(() => {
      setSceneQueue(q => q.slice(1));
      setFadingOut(false);
      transitioningRef.current = false;
    }, 600);
  }, [sceneQueue.length]);

  const currentImage = sceneQueue[0];

  return (
    <div className={`app app--${mode}`}>
      {/* Opacity wrapper drives the fade-out/fade-in transition. The inner
          WatercolorCanvas is position:fixed so it covers the viewport;
          parent opacity still applies to fixed descendants via compositing. */}
      <div style={{ opacity: fadingOut ? 0 : 1, transition: 'opacity 0.5s ease' }}>
        <WatercolorCanvas key={currentImage} slug={slug} image={currentImage} />
      </div>
      <FairyCanvas onFairyClick={handleFairyClick} />
      <header className="app__header">
        <Link to="/" className="app__brand">
          kirsten rauffer
        </Link>
        <nav className="app__nav">
          <Link to="/">home</Link>
          <Link to="/work">work</Link>
          <Link to="/about">about</Link>
          <button
            type="button"
            className="app__theme-toggle"
            onClick={() => dispatch(toggleTheme())}
            aria-label="toggle theme"
          >
            {mode === 'dark' ? '☀' : '☾'}
          </button>
        </nav>
      </header>

      <main className="app__main">
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
