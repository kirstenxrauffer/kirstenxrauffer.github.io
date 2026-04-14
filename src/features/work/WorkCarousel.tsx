import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import type { CompanyWork, ProjectAssets } from './workManifest';
import './WorkCarousel.css';
import { StickyNote } from '../../components/StickyNote';
import { StickyDoodles } from '../../components/StickyDoodles';
import { TitleFrames, NUM_TITLE_STYLES } from '../../components/TitleFrames';
import { ASCII_DOODLES } from '../../constants/asciidoodles';
import { STICKY_NOTE_PALETTES } from '../../constants/stickyNoteColors';
import type { StickyNotePalette } from '../../constants/stickyNoteColors';
import { useDragScroll } from './useDragScroll';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVideo(url: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(url);
}

// For every .gif we pre-extract a ~50KB first-frame JPG poster (see build step).
// posterFor() returns that path so GIF thumbnails can show an instant static
// preview and defer the multi-MB animated GIF fetch until they scroll into view.
function posterFor(url: string): string | null {
  return /\.gif$/i.test(url) ? url.replace(/\.gif$/i, '.poster.jpg') : null;
}

// ── ImagePreview ──────────────────────────────────────────────────────────────
// Click-triggered modal: starts visually aligned with the source thumbnail's
// rect (FLIP-style initial transform), then transitions to a centered viewport
// modal sized to the image's natural aspect ratio. A dim backdrop fades in
// behind it; clicking either the backdrop or the image dismisses.

interface NaturalDims { w: number; h: number }

interface ImagePreviewProps {
  url: string;
  rect: DOMRect;
  naturalDims?: NaturalDims;
  onDismiss: () => void;
}

function ImagePreview({ url, rect, naturalDims, onDismiss }: ImagePreviewProps) {
  // Self-managed mount-then-rAF state drives the FLIP entry. Owning this here
  // (instead of letting the parent toggle a `visible` prop) lets the modal
  // re-animate on each click via key={url} without the parent ever flipping
  // the overlay's dim backdrop off — which would otherwise show the scene
  // through for one frame on consecutive clicks.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const margin = 32;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Final modal size: aspect-correct, fits viewport with margin on both axes.
  // Falls back to the thumbnail's aspect when natural dims aren't loaded yet.
  const aspect = naturalDims
    ? naturalDims.w / naturalDims.h
    : rect.width / rect.height;
  const maxW = vw - margin * 2;
  const maxH = vh - margin * 2;
  // Cap at the image's natural pixel size so small images render at 1:1 rather
  // than being upscaled to fill the viewport. Videos/unknown dims fall back to
  // the viewport bounds.
  const natW = naturalDims?.w ?? Infinity;
  const natH = naturalDims?.h ?? Infinity;
  const boundW = Math.min(maxW, natW);
  const boundH = Math.min(maxH, natH);
  const modalW = Math.min(boundW, boundH * aspect);
  const modalH = modalW / aspect;
  const modalLeft = (vw - modalW) / 2;
  const modalTop  = (vh - modalH) / 2;

  // FLIP initial transform: places the modal box visually over the source
  // thumbnail. transform-origin is top-left so translate + non-uniform scale
  // exactly maps the modal's top-left corner and dimensions onto rect.
  const initSx = rect.width  / modalW;
  const initSy = rect.height / modalH;
  const initTx = rect.left - modalLeft;
  const initTy = rect.top  - modalTop;

  return (
    <div
      className="wc-image-preview-overlay wc-image-preview-overlay--visible"
      onClick={onDismiss}
    >
      <div
        className={`wc-image-preview${mounted ? ' wc-image-preview--mounted' : ''}`}
        style={{
          '--mw':       `${modalW}px`,
          '--mh':       `${modalH}px`,
          '--ml':       `${modalLeft}px`,
          '--mt':       `${modalTop}px`,
          '--init-tx':  `${initTx}px`,
          '--init-ty':  `${initTy}px`,
          '--init-sx':  initSx,
          '--init-sy':  initSy,
        } as React.CSSProperties}
      >
        {isVideo(url)
          ? <video src={url} autoPlay muted loop playsInline />
          : <img src={url} alt="" />
        }
      </div>
    </div>
  );
}

// ── AssetThumb ────────────────────────────────────────────────────────────────

interface AssetThumbProps {
  url: string;
  index: number;
  label?: string;
  active?: boolean;
  /** Show the resting highlight when nothing else is hovered */
  firstLit?: boolean;
  /** Click handler — receives the thumbnail's current bounding rect */
  onClick?: (rect: DOMRect) => void;
  /** Hover in */
  onHoverIn?: () => void;
  /** Hover out */
  onHoverOut?: () => void;
  brandColor?: string;
  /** Called once when the underlying image's natural dimensions are known */
  onDimLoad?: (url: string, w: number, h: number) => void;
  /** Inline magnifying glass that follows the cursor while hovering the media */
  enableMagnifier?: boolean;
}

const MAG_GLASS_SIZE = 210; // diameter px
const MAG_ZOOM       = 3;

function AssetThumb({
  url, index, label, active, firstLit,
  onClick, onHoverIn, onHoverOut,
  brandColor, onDimLoad, enableMagnifier,
}: AssetThumbProps) {
  // Magnifier glass state — only used when enableMagnifier is true
  const [magGlass, setMagGlass] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Natural pixel dimensions — needed both to replicate object-fit:cover in the
  // magnifier background and to drive the portrait classifier below.
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  // Portrait orientation → show full image (contain) on dark background instead of cropping
  const [isPortrait, setIsPortrait] = useState(false);

  // rAF-throttle mousemove so magnifier state updates at most once per frame —
  // avoids a React re-render per pointer event on fast mice.
  const magRafRef = useRef<number | null>(null);
  const magPendingRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const handleMagMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    magPendingRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
    if (magRafRef.current !== null) return;
    magRafRef.current = requestAnimationFrame(() => {
      magRafRef.current = null;
      if (magPendingRef.current) setMagGlass(magPendingRef.current);
    });
  }, []);

  const handleMagLeave = useCallback(() => {
    if (magRafRef.current !== null) { cancelAnimationFrame(magRafRef.current); magRafRef.current = null; }
    magPendingRef.current = null;
    setMagGlass(null);
  }, []);

  useEffect(() => () => {
    if (magRafRef.current !== null) cancelAnimationFrame(magRafRef.current);
  }, []);

  // Poster-first lazy load for GIFs: show the static first-frame JPG immediately,
  // swap to the animated GIF only once the thumbnail is near the viewport. The
  // magnifier always points at `url` (the real GIF) — by the time a user hovers,
  // the thumbnail is definitionally visible, so IO has already fired the swap.
  const poster = posterFor(url);
  const [imgSrc, setImgSrc] = useState<string>(poster ?? url);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!poster) return;
    const el = imgRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setImgSrc(url);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [poster, url]);

  const isMag = enableMagnifier && !isVideo(url);

  return (
    <button
      className={[
        'wc-thumb',
        active    ? 'wc-thumb--active'     : '',
        firstLit  ? 'wc-thumb--first-lit'  : '',
        onClick   ? 'wc-thumb--clickable'  : '',
        label     ? 'wc-thumb--labeled'    : '',
        isPortrait ? 'wc-thumb--portrait'  : '',
        (isMag && magGlass) ? 'wc-thumb--magnifying' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--i': index,
        ...(brandColor ? { '--brand-color': brandColor } : {}),
      } as React.CSSProperties}
      onMouseEnter={() => onHoverIn?.()}
      onMouseLeave={() => onHoverOut?.()}
      onClick={(e) => onClick?.((e.currentTarget as HTMLElement).getBoundingClientRect())}
      aria-pressed={active}
    >
      <div
        className="wc-thumb__media"
        onMouseMove={isMag ? handleMagMove : undefined}
        onMouseLeave={isMag ? handleMagLeave : undefined}
        style={isMag && magGlass ? { cursor: 'none' } : undefined}
      >
        {isVideo(url) ? (
          <video src={url} muted loop playsInline autoPlay aria-hidden="true" />
        ) : (
          <img
            ref={imgRef}
            src={imgSrc} alt=""
            loading="lazy"
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                onDimLoad?.(url, img.naturalWidth, img.naturalHeight);
                setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
                setIsPortrait(img.naturalHeight > img.naturalWidth);
              }
            }}
          />
        )}
        {isMag && magGlass && (() => {
          const r   = MAG_GLASS_SIZE / 2;
          const cw  = magGlass.w;
          const ch  = magGlass.h;

          // Match the rendered image box: portrait cells use object-fit:contain
          // (Math.min) and are letterboxed; landscape cells use object-fit:cover
          // (Math.max) and overflow. offX/offY locate the image's top-left
          // relative to the cell's top-left (positive for contain, negative for
          // cover), so the lens math below is identical in both modes.
          let bgW  = cw * MAG_ZOOM;
          let bgH  = ch * MAG_ZOOM;
          let rW   = cw;
          let rH   = ch;
          let offX = 0;
          let offY = 0;
          if (naturalDims) {
            const fit = isPortrait ? Math.min : Math.max;
            const scale = fit(cw / naturalDims.w, ch / naturalDims.h);
            rW   = naturalDims.w * scale;
            rH   = naturalDims.h * scale;
            bgW  = rW * MAG_ZOOM;
            bgH  = rH * MAG_ZOOM;
            offX = (cw - rW) / 2;
            offY = (ch - rH) / 2;
          }

          // Clamp the lens centre to (a) keep the lens visually inside the cell
          // and (b) keep its sample point inside the rendered image — important
          // for contain, where mousing over letterbox would otherwise sample
          // empty space outside the background image.
          const minX = Math.max(r / MAG_ZOOM, offX);
          const maxX = Math.min(cw - r / MAG_ZOOM, offX + rW);
          const minY = Math.max(r / MAG_ZOOM, offY);
          const maxY = Math.min(ch - r / MAG_ZOOM, offY + rH);
          const gx = Math.max(minX, Math.min(maxX, magGlass.x));
          const gy = Math.max(minY, Math.min(maxY, magGlass.y));
          const bpX = r - (gx - offX) * MAG_ZOOM;
          const bpY = r - (gy - offY) * MAG_ZOOM;

          return (
            <div
              className="wc-mag-glass"
              style={{
                left:               gx - r,
                top:                gy - r,
                backgroundImage:    `url('${url}')`,
                backgroundSize:     `${bgW}px ${bgH}px`,
                backgroundPosition: `${bpX}px ${bpY}px`,
              }}
            />
          );
        })()}
      </div>
      {label && <span className="wc-thumb__label">{label}</span>}
    </button>
  );
}

// ── TitleThumb ────────────────────────────────────────────────────────────────
// Top-row cell that shows the project name as a Pixar-style title card.
// Each project gets a deterministic font from the pool based on a label hash.

const TITLE_FONTS = [
  "'Bitcount Grid Double', monospace",              // pixel/grid display
  "'Bebas Neue', 'Arial Narrow', sans-serif",       // clean modern all-caps
  "'Erica One', sans-serif",                        // bold impact display
  "'Fredoka', 'Arial Rounded MT Bold', sans-serif", // rounded friendly
];

interface TitleThumbProps {
  index: number;
  label: string;
  active?: boolean;
  /** Show resting brightness even when no cell is hovered/selected — used for the first cell */
  firstLit?: boolean;
  /** Parent-assigned font index — lets the parent guarantee no two adjacent cells share a font */
  fontIndex: number;
  /** Parent-assigned frame-style index — same non-repeating guarantee */
  styleIndex: number;
  onClick?: () => void;
  brandColor?: string;
}

function TitleThumb({ index, label, active, firstLit, fontIndex, styleIndex, onClick, brandColor }: TitleThumbProps) {
  // Word count drives a font-size step-down so longer titles still fit the cell.
  const wordCount = label.trim().split(/\s+/).length;
  const sizeClass =
    wordCount >= 4 ? 'wc-thumb--title-xs' :
    wordCount === 3 ? 'wc-thumb--title-sm' :
    wordCount === 2 ? 'wc-thumb--title-md' :
    'wc-thumb--title-lg';

  // Font comes from the parent-assigned fontIndex (which guarantees non-repeat
  // between neighbors). labelHash is still random-per-mount — it seeds the
  // small organic displacement filter inside TitleFrames, so every open of the
  // carousel still gives a slightly different look within the picked style.
  const titleFont = TITLE_FONTS[fontIndex % TITLE_FONTS.length];
  const labelHash = useMemo(() => Math.floor(Math.random() * 0x7fffffff), []);

  return (
    <button
      className={[
        'wc-thumb',
        'wc-thumb--clickable',
        'wc-thumb--title',
        sizeClass,
        active ? 'wc-thumb--active' : '',
        firstLit ? 'wc-thumb--first-lit' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--i': index,
        '--title-font': titleFont,
        ...(brandColor ? { '--brand-color': brandColor } : {}),
      } as React.CSSProperties}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className="wc-thumb__media wc-thumb__media--title">
        <div className="wc-thumb__title-doodles" aria-hidden="true">
          <TitleFrames
            fieldWidth={320}
            fieldHeight={190}
            color={brandColor ?? '#f0b030'}
            wordCount={wordCount}
            labelHash={labelHash}
            styleIndex={styleIndex}
            strokeWidth={1.8}
          />
        </div>
        <span className="wc-thumb__title-text">{label}</span>
      </div>
    </button>
  );
}

// ── FillerThumb ───────────────────────────────────────────────────────────────
// Decorative empty film cell — counts as a scroll item, completely inert.

function FillerThumb({ index }: { index: number }) {
  return (
    <div
      className="wc-thumb wc-thumb--filler"
      style={{ '--i': index } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className="wc-thumb__media" />
    </div>
  );
}

const FILLERS_START = 2;
const FILLERS_END   = 15; // enough to fill any viewport width

// ── WorkCarousel ──────────────────────────────────────────────────────────────

export default function WorkCarousel({ company, onClose, exiting }: {
  company: CompanyWork;
  onClose: () => void;
  exiting?: boolean;
}) {
  const [selectedProject, setSelectedProject] = useState<ProjectAssets | null>(null);
  const [detailKey,        setDetailKey]       = useState(0);
  const [closing,          setClosing]         = useState(false);

  const handleMobileClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    // Match the rotate transition duration in WorkCarousel.css (.wc-mobile-close)
    setTimeout(onClose, 110);
  }, [closing, onClose]);

  // Track scroll containers — used to snap to the first interactive cell on mount
  const topTrackRef    = useRef<HTMLDivElement>(null);
  const detailTrackRef = useRef<HTMLDivElement>(null);

  useDragScroll(topTrackRef);
  useDragScroll(detailTrackRef);

  // Track whether any detail-row cell is hovered, so the first cell stays
  // lit (wc-thumb--first-lit) when nothing else is being hovered.
  const [anyDetailHovered, setAnyDetailHovered] = useState(false);

  // Project index whose cell is currently in the leftmost "first position" of
  // the top track. Updated on scroll so the lit (un-dimmed) title tracks the
  // cell the user has scrolled/dragged into that slot.
  const [topFirstIdx, setTopFirstIdx] = useState(0);

  // ── Click-triggered image preview ─────────────────────────────────────────
  // Cache of natural pixel dimensions per asset URL — populated as detail-row
  // images load and (eagerly) when the company changes. Reads as a ref so the
  // preview opener always sees the latest value with no stale-closure risk.
  const naturalDimsRef = useRef<Record<string, NaturalDims>>({});
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null);
  const [previewRect, setPreviewRect] = useState<DOMRect | null>(null);
  const [previewDims, setPreviewDims] = useState<NaturalDims | null>(null);

  const hidePreview = useCallback(() => {
    setPreviewUrl(null);
    setPreviewRect(null);
    setPreviewDims(null);
  }, []);

  const togglePreview = useCallback((url: string, rect: DOMRect) => {
    // Same thumb → close. Different thumb → swap url/rect/dims in place; the
    // ImagePreview re-mounts via key={url} and replays its FLIP entry while
    // the overlay's dim backdrop stays solid (no flicker between previews).
    if (previewUrl === url) {
      hidePreview();
    } else {
      setPreviewUrl(url);
      setPreviewRect(rect);
      setPreviewDims(naturalDimsRef.current[url] ?? null);
    }
  }, [previewUrl, hidePreview]);

  const handleDimLoad = useCallback((url: string, w: number, h: number) => {
    if (!naturalDimsRef.current[url]) {
      naturalDimsRef.current[url] = { w, h };
    }
  }, []);

  // Preload natural dims for just the selected project's images so preview
  // click can size the popup without waiting. Scoped to the active project
  // (not the whole company) to avoid an N×projects prefetch storm on open.
  useEffect(() => {
    if (!selectedProject) return;
    const urls = selectedProject.assets.filter(u => !isVideo(u));
    urls.forEach(url => {
      if (naturalDimsRef.current[url]) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          naturalDimsRef.current[url] = { w: img.naturalWidth, h: img.naturalHeight };
        }
      };
      img.src = url;
    });
  }, [selectedProject]);

  useEffect(() => {
    setSelectedProject(null);
    setAnyDetailHovered(false);
    hidePreview();
  }, [company.slug, hidePreview]);

  // ── Scroll a track so the first interactive cell is the leftmost item ──────
  // getBoundingClientRect is unreliable here: the panel and row both start their
  // slide-in animations at translateX(-100%), so the scroll container is fully
  // off-screen when useLayoutEffect fires and browsers clamp scrollLeft to 0.
  // Compute the target from the known CSS constants instead — the write succeeds
  // regardless of the container's on-screen position.
  // The rAF is a belt-and-suspenders: if the synchronous write is still clamped
  // (container not yet in viewport), the rAF fires on the very next frame when
  // it has entered and the write is accepted.
  const scrollToFirst = useCallback((track: HTMLDivElement) => {
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    const cellWidth = isMobile ? 240 : 320;
    const gap       = 6;
    track.scrollLeft = FILLERS_START * (cellWidth + gap);
  }, []);

  useLayoutEffect(() => {
    const track = topTrackRef.current;
    if (!track) return;
    scrollToFirst(track);
    const raf = requestAnimationFrame(() => scrollToFirst(track));
    return () => cancelAnimationFrame(raf);
  }, [company.slug, scrollToFirst]);

  useLayoutEffect(() => {
    const track = detailTrackRef.current;
    if (!track) return;
    scrollToFirst(track);
    const raf = requestAnimationFrame(() => scrollToFirst(track));
    return () => cancelAnimationFrame(raf);
  }, [detailKey, scrollToFirst]);

  const handleProjectClick = useCallback((project: ProjectAssets) => {
    hidePreview();
    setSelectedProject(prev => {
      if (prev?.slug === project.slug) return null;
      setDetailKey(k => k + 1);
      setAnyDetailHovered(false);
      return project;
    });
  }, [hidePreview]);

  const availableProjects = company.projects.filter(p => p.assets.length > 0 || !!p.description);

  // Assign each project a font and frame-style index such that no two adjacent
  // cells share either. Re-rolled whenever the company changes, so each load
  // of the panel shows a fresh combo without ever putting two matching cells
  // next to each other.
  const [fontIndices, styleIndices] = useMemo(() => {
    const pickNonAdjacent = (count: number, n: number, prev: number[]) => {
      for (let i = 0; i < count; i++) {
        let pick = Math.floor(Math.random() * n);
        if (n > 1 && i > 0 && pick === prev[i - 1]) {
          pick = (pick + 1 + Math.floor(Math.random() * (n - 1))) % n;
        }
        prev.push(pick);
      }
      return prev;
    };
    const fonts: number[] = [];
    const styles: number[] = [];
    pickNonAdjacent(availableProjects.length, 4, fonts);          // TITLE_FONTS.length
    pickNonAdjacent(availableProjects.length, NUM_TITLE_STYLES, styles);
    return [fonts, styles];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.slug, availableProjects.length]);

  // Watch the top track's scroll position and compute which interactive cell
  // currently sits in the leftmost "first" slot (directly after the leading
  // decorative fillers). Rounded so a cell "wins" once it's scrolled past the
  // halfway point, matching the user's visual sense of which cell is foremost.
  useEffect(() => {
    const track = topTrackRef.current;
    if (!track) return;
    const n = availableProjects.length;
    if (n === 0) return;

    let raf: number | null = null;
    const update = () => {
      raf = null;
      const isMobile = window.matchMedia('(max-width: 640px)').matches;
      const step = (isMobile ? 240 : 320) + 6;
      const offset = track.scrollLeft - FILLERS_START * step;
      const idx = Math.max(0, Math.min(n - 1, Math.round(offset / step)));
      setTopFirstIdx(idx);
    };
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(update);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      track.removeEventListener('scroll', onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [availableProjects.length, company.slug]);

  // ── Sticky notes: random palettes, rotations, ASCII doodles — re-rolled per project ──
  const [notePalettes, noteRotations, noteDoodles] = useMemo<
    [StickyNotePalette[], number[], Array<{ text: string; x: number; y: number }>]
  >(() => {
    // Fisher-Yates shuffle of the 4 palettes; take the first 3
    const pool = [...STICKY_NOTE_PALETTES];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const palettes = pool.slice(0, 3);

    // Three non-zero rotations in [-7, 7]deg
    const rotations = Array.from({ length: 3 }, () => {
      const r = (Math.random() * 14 - 7);
      return r === 0 ? 3 : r;
    });

    // 3–7 ASCII doodles, scattered around the note without overlap. Live
    // alongside the hand-drawn SVG doodles (StickyDoodles) — the SVG layer
    // sits behind, ASCII spans absolute-positioned on top.
    const FIELD_W = 155;
    const FIELD_H = 160;
    const CHAR_W  = 7.6; // px @ 0.8rem font-size
    const LINE_H  = 19;
    const GAP     = 4;

    const count    = 5 + Math.floor(Math.random() * 5);
    const doodlePool = [...ASCII_DOODLES] as string[];
    for (let i = doodlePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [doodlePool[i], doodlePool[j]] = [doodlePool[j], doodlePool[i]];
    }
    const candidates = doodlePool.slice(0, count);

    const placed: Array<{ text: string; x: number; y: number; w: number; h: number }> = [];
    for (const text of candidates) {
      const w = Math.min(FIELD_W, Math.max(32, Math.ceil(text.length * CHAR_W)));
      const h = LINE_H;
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = Math.random() * Math.max(0, FIELD_W - w);
        const y = Math.random() * Math.max(0, FIELD_H - h);
        const clash = placed.some(p =>
          x < p.x + p.w + GAP &&
          x + w + GAP > p.x &&
          y < p.y + p.h + GAP &&
          y + h + GAP > p.y
        );
        if (!clash) {
          placed.push({ text, x, y, w, h });
          break;
        }
      }
    }
    const doodles = placed.map(({ text, x, y }) => ({ text, x, y }));

    return [palettes, rotations, doodles];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.slug]);

  return (
    <div
      className={`wc-container${exiting ? ' wc-container--exiting' : ''}`}
      aria-label={`${company.label} work gallery`}
    >
      {/* Mobile-only close button: white circle, black X, rotates 90deg on press */}
      <button
        type="button"
        className={`wc-mobile-close${closing ? ' wc-mobile-close--closing' : ''}`}
        onClick={handleMobileClose}
        aria-label="Close gallery"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6 L18 18 M18 6 L6 18" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>
      <div className="wc-panel-wrap">
      <div
        className={exiting ? 'wc-panel wc-panel--exiting' : 'wc-panel'}
        style={{ '--brand-color': company.color } as React.CSSProperties}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="wc-header">
          <span className="wc-header__label">{company.label}</span>
          <button className="wc-header__close" onClick={onClose} aria-label="Close gallery">
            ×
          </button>
        </div>

        {/* ── Top carousel: one representative per project ─────────────── */}
        {availableProjects.length > 0 ? (
          <div className="wc-row wc-row--top">
            <div className="wc-row__track" ref={topTrackRef}>
              {/* Leading decorative filler cells */}
              {Array.from({ length: FILLERS_START }, (_, fi) => (
                <FillerThumb key={`top-filler-start-${fi}`} index={fi} />
              ))}

              {availableProjects.map((project, i) => (
                <TitleThumb
                  key={project.slug}
                  index={FILLERS_START + i}
                  label={project.label}
                  active={selectedProject?.slug === project.slug}
                  firstLit={!selectedProject && i === topFirstIdx}
                  fontIndex={fontIndices[i] ?? 0}
                  styleIndex={styleIndices[i] ?? 0}
                  onClick={() => handleProjectClick(project)}
                  brandColor={company.color}
                />
              ))}

              {/* Trailing decorative filler cells */}
              {Array.from({ length: FILLERS_END }, (_, fi) => (
                <FillerThumb key={`top-filler-end-${fi}`} index={FILLERS_START + availableProjects.length + fi} />
              ))}
            </div>
          </div>
        ) : (
          <div className="wc-empty"><span>coming soon</span></div>
        )}

        {/* ── Detail carousel: all assets ──────────────────────────────── */}
        {selectedProject && selectedProject.assets.length > 0 && (
          <div className="wc-row wc-row--detail" key={`detail-${detailKey}`}>
            <div className="wc-row__track" ref={detailTrackRef}>
              {/* Leading decorative filler cells */}
              {Array.from({ length: FILLERS_START }, (_, fi) => (
                <FillerThumb key={`detail-filler-start-${fi}`} index={fi} />
              ))}

              {selectedProject.assets.map((asset, i) => {
                const cellIndex = FILLERS_START + i;
                const isFirst   = i === 0;
                return (
                  <AssetThumb
                    key={asset}
                    url={asset}
                    index={cellIndex}
                    firstLit={isFirst && !anyDetailHovered}
                    enableMagnifier
                    onHoverIn={() => { setAnyDetailHovered(true); }}
                    onHoverOut={() => { setAnyDetailHovered(false); }}
                    onClick={(rect) => togglePreview(asset, rect)}
                    onDimLoad={handleDimLoad}
                    brandColor={company.color}
                  />
                );
              })}

              {/* Trailing decorative filler cells */}
              {Array.from({ length: FILLERS_END }, (_, fi) => (
                <FillerThumb
                  key={`detail-filler-end-${fi}`}
                  index={FILLERS_START + selectedProject.assets.length + fi}
                />
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ── Sticky notes: SIBLING of .wc-panel so gaps between notes are
          click-through. pointer-events:none on container, :auto on each note.
          Each note is wrapped in a .wc-note-anchor that positions it
          absolutely relative to .wc-panel-wrap. */}
      {selectedProject && (
        <div className="wc-sticky-notes" key={`notes-${selectedProject.slug}`}>
            {selectedProject.description && (
              <div className="wc-note-anchor wc-note-anchor--detail-mid">
                <StickyNote
                  key={`${selectedProject.slug}-desc`}
                  title={selectedProject.label}
                  palette={notePalettes[0]}
                  rotation={noteRotations[0]}
                >
                  <p dangerouslySetInnerHTML={{ __html: selectedProject.description }} />
                </StickyNote>
              </div>
            )}
            {((selectedProject.skills?.length ?? 0) > 0 || (selectedProject.leadership?.length ?? 0) > 0) && (
              <div className="wc-note-anchor wc-note-anchor--top-selected">
                <StickyNote
                  key={`${selectedProject.slug}-skills`}
                  title="skills"
                  palette={notePalettes[1]}
                  rotation={noteRotations[1]}
                >
                  <ul>
                    {selectedProject.skills?.map(s => <li key={s}>{s}</li>)}
                    {selectedProject.leadership?.map(l => <li key={l}>{l}</li>)}
                  </ul>
                </StickyNote>
              </div>
            )}
            <div className="wc-note-anchor wc-note-anchor--detail-br">
              <StickyNote
                key={`${selectedProject.slug}-doodle`}
                palette={notePalettes[2]}
                rotation={noteRotations[2]}
              >
                <div className="sn-doodle-field">
                  {/* SVG hand-drawn squiggles/spirals/etc — sits behind ASCII */}
                  <StickyDoodles
                    fieldWidth={155}
                    fieldHeight={160}
                    color={notePalettes[2].divider}
                  />
                  {noteDoodles.map((d, i) => (
                    <span
                      key={i}
                      className="sn-doodle"
                      style={{ left: `${d.x}px`, top: `${d.y}px` }}
                    >
                      {d.text}
                    </span>
                  ))}
                </div>
              </StickyNote>
            </div>
        </div>
      )}
      </div>

      {/* Click-triggered image preview — fixed position, escapes carousel clipping */}
      {previewUrl && previewRect && (
        <ImagePreview
          key={previewUrl}
          url={previewUrl}
          rect={previewRect}
          naturalDims={previewDims ?? undefined}
          onDismiss={hidePreview}
        />
      )}
    </div>
  );
}
