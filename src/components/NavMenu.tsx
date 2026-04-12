import { useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './NavMenu.css';

// ── Data ─────────────────────────────────────────────────────────────────────

const WORK_ITEMS = [
  { label: 'grainger',  color: '#CC0000' },
  { label: 'ulta',      color: '#E50695' },
  { label: 'discord',   color: '#5865F2' },
  { label: 'linkedin',  color: '#0077B5' },
  { label: 'microsoft', color: '#00BCF2' },
  { label: 'roche',     color: '#0065BD' },
  { label: 'pseg',      color: '#F7941D' },
] as const;

const SERVICES_ITEMS = [
  { label: 'web development' },
  { label: 'mobile app development' },
  { label: 'one-stop-shop' },
] as const;

type TopItem = { id: string; label: string; href?: string; hasSub?: boolean };

const NAV_ITEMS: TopItem[] = [
  { id: 'services', label: 'services', hasSub: true },
  { id: 'work',     label: 'work',     hasSub: true },
  { id: 'about',    label: 'about',    href: '/about' },
  { id: 'contact',  label: 'contact',  href: '/contact' },
];

// ── Types ─────────────────────────────────────────────────────────────────────
type Side = 'right' | 'left' | 'bottom' | 'top';

function bestSide(rect: DOMRect): Side {
  const spaces: Record<Side, number> = {
    right:  window.innerWidth  - rect.right,
    left:   rect.left,
    bottom: window.innerHeight - rect.bottom,
    top:    rect.top,
  };
  return (Object.keys(spaces) as Side[]).reduce((a, b) => spaces[a] >= spaces[b] ? a : b);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function NavMenu() {
  const [open, setOpen]       = useState<string | null>(null);
  const [side, setSide]       = useState<Side>('right');
  const [subKey, setSubKey]   = useState(0);
  const btnRefs               = useRef<Record<string, HTMLButtonElement | null>>({});
  const navigate              = useNavigate();

  const toggle = useCallback((id: string) => {
    setOpen(prev => {
      if (prev === id) return null;           // close
      const el = btnRefs.current[id];
      if (el) setSide(bestSide(el.getBoundingClientRect()));
      setSubKey(k => k + 1);
      return id;
    });
  }, []);

  const close = useCallback(() => setOpen(null), []);

  const subItems = (id: string) => {
    if (id === 'services') return SERVICES_ITEMS;
    if (id === 'work')     return WORK_ITEMS;
    return null;
  };

  return (
    <>
      {/* Dim overlay — sits above canvas, below nav, closes menu on click */}
      <div
        className={`nav-overlay${open ? ' nav-overlay--visible' : ''}`}
        onClick={close}
        aria-hidden="true"
      />

      <nav className="nav-menu" aria-label="Primary navigation">
        {NAV_ITEMS.map((item, i) => {
          const items = subItems(item.id);
          const isOpen = open === item.id;

          return (
            <div key={item.id} className="nav-menu__item">
              {item.hasSub ? (
                <button
                  ref={el => { btnRefs.current[item.id] = el; }}
                  className={`nav-menu__btn${isOpen ? ' nav-menu__btn--active' : ''}`}
                  style={{ '--i': i } as React.CSSProperties}
                  onClick={() => toggle(item.id)}
                  aria-expanded={isOpen}
                >
                  {item.label}
                  <span className={`nav-menu__arrow${isOpen ? ' nav-menu__arrow--open' : ''}`}>›</span>
                </button>
              ) : (
                <Link
                  to={item.href!}
                  className="nav-menu__btn"
                  style={{ '--i': i } as React.CSSProperties}
                  onClick={close}
                >
                  {item.label}
                </Link>
              )}

              {/* Sub-menu — floats to the side with most screen space */}
              {isOpen && items && (
                <div
                  className={`nav-menu__sub nav-menu__sub--${side}`}
                  key={`${item.id}-${subKey}`}
                >
                  {items.map((sub, j) => {
                    const color = 'color' in sub ? sub.color : undefined;
                    return (
                      <button
                        key={sub.label}
                        className={`nav-menu__sub-btn${color ? ' nav-menu__sub-btn--branded' : ''}`}
                        style={{
                          '--i': j,
                          ...(color ? { '--brand-color': color } : {}),
                        } as React.CSSProperties}
                        onClick={() => {
                          close();
                          if (item.id === 'work') navigate('/work');
                        }}
                      >
                        {color && <span className="nav-menu__brand-dot" />}
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}
