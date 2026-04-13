import { useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './NavMenu.css';

// ── Data ─────────────────────────────────────────────────────────────────────

const WORK_ITEMS = [
  { label: 'grainger',  color: '#CC0000' },
  { label: 'ulta',      color: '#E50695' },
  { label: 'discord',   color: '#5865F2' },
  { label: 'linkedin',  color: '#0077B5' },
  { label: 'microsoft', color: '#00BCF2' },
  { label: 'roche',     color: '#0065BD' },
  { label: 'tum',       color: '#3070B3' },
] as const;

const SERVICES_ITEMS = [
  { label: 'web development' },
  { label: 'mobile development' },
] as const;

type TopItem = { id: string; label: string; href?: string; hasSub?: boolean };

const BASE_NAV_ITEMS: TopItem[] = [
  // { id: 'services', label: 'services', hasSub: true },
  { id: 'work',     label: 'work',     hasSub: true },
  { id: 'about',    label: 'about',    href: '/about' },
  { id: 'contact',  label: 'contact',  href: '/contact' },
];

const HOME_ITEM: TopItem = { id: 'home', label: 'home', href: '/' };

const PATH_TO_ID: Record<string, string> = {
  '/about':   'about',
  '/contact': 'contact',
};

// ── Types ─────────────────────────────────────────────────────────────────────
type Side = 'right' | 'left' | 'bottom' | 'top';

/** Which side of a sub-menu button has the most space — used when nav is top/bottom. */
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
export default function NavMenu({
  open: menuOpen,
  ready = false,
  onClose,
  onCompanySelect,
  palette = [],
}: {
  open: boolean;
  ready?: boolean;
  onClose: () => void;
  onCompanySelect?: (slug: string) => void;
  palette?: string[];
}) {
  const [openSub, setOpenSub]     = useState<string | null>(null);
  const [side, setSide]           = useState<Side>('right');
  const [subKey, setSubKey]       = useState(0);
  const [navHovered, setNavHovered] = useState(false);
  const btnRefs               = useRef<Record<string, HTMLButtonElement | null>>({});
  const { pathname }          = useLocation();

  const currentId = PATH_TO_ID[pathname] ?? null;
  const navItems: TopItem[] = currentId
    ? BASE_NAV_ITEMS.map(item => item.id === currentId ? HOME_ITEM : item)
    : BASE_NAV_ITEMS;

  const toggle = useCallback((id: string) => {
    setOpenSub(prev => {
      if (prev === id) return null;
      const el = btnRefs.current[id];
      if (el) setSide(bestSide(el.getBoundingClientRect()));
      setSubKey(k => k + 1);
      return id;
    });
  }, []);

  const closeAll = useCallback(() => {
    setOpenSub(null);
    onClose();
  }, [onClose]);

  const subItems = (id: string) => {
    if (id === 'services') return SERVICES_ITEMS;
    if (id === 'work')     return WORK_ITEMS;
    return null;
  };

  return (
    <>
      {/* Dim overlay — sits above canvas, below nav, closes menu on click */}
      <div
        className={[
          'nav-overlay',
          (menuOpen || openSub) ? 'nav-overlay--visible' : '',
          navHovered ? 'nav-overlay--dim' : '',
        ].filter(Boolean).join(' ')}
        onClick={(e) => { e.nativeEvent.stopPropagation(); closeAll(); }}
        aria-hidden="true"
      />

      {/* Nav buttons — rendered after watercolor reveal, or immediately when opened */}
      {(ready || menuOpen) && <nav
          className={`nav-menu${(menuOpen || openSub) ? ' nav-menu--open' : ''}`}
          aria-label="Primary navigation"
          onClick={(e) => e.nativeEvent.stopPropagation()}
          onMouseEnter={() => setNavHovered(true)}
          onMouseLeave={() => setNavHovered(false)}
        >
          {navItems.map((item, i) => {
            const items = subItems(item.id);
            const isOpen = openSub === item.id;

            return (
              <div key={item.id} className="nav-menu__item">
                {item.hasSub ? (
                  <button
                    ref={el => { btnRefs.current[item.id] = el; }}
                    className={`nav-menu__btn${isOpen ? ' nav-menu__btn--active' : ''}`}
                    style={{ '--i': i, ...(palette[i] ? { '--nav-color': palette[i] } : {}) } as React.CSSProperties}
                    onClick={() => toggle(item.id)}
                    aria-expanded={isOpen}
                  >
                    {item.label}
                    <span className={`nav-menu__arrow${isOpen ? ' nav-menu__arrow--open' : ''}`}>{isOpen ? '×' : '+'}</span>
                  </button>
                ) : (
                  <Link
                    to={item.href!}
                    className="nav-menu__btn"
                    style={{ '--i': i, ...(palette[i] ? { '--nav-color': palette[i] } : {}) } as React.CSSProperties}
                    onClick={closeAll}
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
                            if (item.id === 'work' && onCompanySelect) {
                              onCompanySelect(sub.label);
                            } else {
                              closeAll();
                            }
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
        </nav>}
    </>
  );
}
