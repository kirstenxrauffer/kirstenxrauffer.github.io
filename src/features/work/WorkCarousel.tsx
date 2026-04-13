import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import type { CompanyWork, ProjectAssets } from './workManifest';
import './WorkCarousel.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVideo(url: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(url);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

// ── In-place hover preview ─────────────────────────────────────────────────────
//
// Renders position:fixed exactly over the hovered thumbnail, then CSS-transitions
// to a larger scale. On leave it scales back to 1 and fades, then unmounts.
// Using fixed-position sidesteps the overflow:auto clipping of the scroll track.
// Works for both media (url) and text-only thumbs (textContent).

interface NaturalDims { w: number; h: number }

interface HoverPreviewProps {
  url?: string;
  textContent?: { label: string; description: string; skills?: string[]; leadership?: string[] };
  rect: DOMRect;
  /** Set to true one frame after mount to trigger the transition in */
  visible: boolean;
  onClose: () => void;
  /** Called when mouse enters the preview — cancels the pending hide */
  onKeepAlive: () => void;
  /** Called when mouse leaves the preview — triggers hide */
  onLeave: () => void;
  /** Natural pixel dimensions of the media — used to size the preview without cropping */
  naturalDims?: NaturalDims;
  brandColor?: string;
}

function HoverPreview({ url, textContent, rect, visible, onClose, onKeepAlive, onLeave, naturalDims, brandColor }: HoverPreviewProps) {
  const maxZoom    = textContent ? 2.3 : 4.0;
  const vw         = window.innerWidth;
  const vh         = window.innerHeight;
  const margin     = 16; // px clearance from viewport edges
  const leftMargin = textContent ? 72 : margin; // extra left buffer for text previews
  const pw         = rect.width;
  const px         = rect.left - (textContent ? 16 : 0);

  // Natural-ratio height for media; content-aware height for text.
  // Text height: estimate lines from description length, clamped to [thumb height, 1.6× width].
  // ~38 chars/line at 220px wide (0.4rem font, 0.7rem padding each side).
  const ph = naturalDims
    ? Math.min(pw * naturalDims.h / naturalDims.w, pw * 3)
    : textContent
    ? (() => {
        const charsPerLine = Math.floor((pw - 22) / 4.0);
        const lineHeight   = 10.6; // px: 0.4rem * 16 * 1.65
        const paddingV     = 17;   // px: top (0.65rem) + bottom (0.4rem) padding
        const pillCount    = (textContent.skills?.length ?? 0) + (textContent.leadership?.length ?? 0);
        const pillsHeight  = pillCount > 0 ? 20 : 0; // px: one row of pills + gap
        const lines        = Math.ceil(stripHtml(textContent.description).length / charsPerLine);
        const estimated    = lines * lineHeight + pillsHeight + paddingV;
        return Math.min(Math.max(estimated, rect.height), pw * 1.6);
      })()
    : rect.height;

  // Cap zoom so the fully-scaled preview never exceeds the viewport in either axis.
  const zoom = Math.min(
    maxZoom,
    (vw - margin * 2) / pw,
    (vh - margin * 2) / ph,
  );

  // The scaled preview's top edge is:  py - originY*(zoom-1)
  // The scaled preview's bottom edge is: py + ph*zoom - originY*(zoom-1)
  // With originY = thumbCenterY - py, solving those two inequalities for py gives:
  //   py ≥ (margin  + thumbCenterY*(zoom-1)) / zoom   [top stays in viewport]
  //   py ≤ (vh - margin - ph*zoom + thumbCenterY*(zoom-1)) / zoom   [bottom stays]
  // Center first, then clamp to the valid range so both edges are inside.
  const thumbCenterY = rect.top + rect.height / 2;
  const pyMin = (margin  + thumbCenterY * (zoom - 1)) / zoom;
  const pyMax = (vh - margin - ph * zoom + thumbCenterY * (zoom - 1)) / zoom;
  const pyCentered = thumbCenterY - ph / 2;
  const py = Math.max(pyMin, Math.min(pyMax, pyCentered));

  // Y transform origin: distance from preview top to thumbnail centre.
  // Scaling about this point keeps the zoom visually anchored to the thumbnail.
  const originY = thumbCenterY - py;

  // X origin: clamp so the zoomed preview never clips outside the viewport.
  let originX = pw / 2;
  // Left constraint: px + originX*(1 - zoom) >= leftMargin  →  originX <= (px - leftMargin)/(zoom-1)
  const maxOriginX = zoom > 1 ? (px - leftMargin) / (zoom - 1) : pw;
  // Right constraint: px + originX*(1 - zoom) + pw*zoom <= vw  →  originX >= (px + pw*zoom - vw)/(zoom-1)
  const minOriginX = zoom > 1 ? (px + pw * zoom - vw) / (zoom - 1) : 0;
  originX = Math.max(-pw, Math.min(pw, Math.max(minOriginX, Math.min(originX, maxOriginX))));

  return (
    <div
      className={`wc-hover-preview${visible ? ' wc-hover-preview--visible' : ''}`}
      style={{
        '--py':   `${py}px`,
        '--px':   `${px}px`,
        '--pw':   `${pw}px`,
        '--ph':   `${ph}px`,
        '--pox':  `${originX}px`,
        '--poy':  `${originY}px`,
        '--pzoom': zoom,
        ...(brandColor ? { '--brand-color': brandColor } : {}),
      } as React.CSSProperties}
      onMouseEnter={onKeepAlive}
      onMouseLeave={onLeave}
      // Clicking the enlarged preview on mobile acts as a tap-out dismiss
      onClick={onClose}
    >
      {url ? (
        isVideo(url) ? (
          <video src={url} autoPlay muted loop playsInline />
        ) : (
          <img src={url} alt="" />
        )
      ) : textContent ? (
        <div className="wc-hover-preview__text">
          <span className="wc-hover-preview__text-excerpt" dangerouslySetInnerHTML={{ __html: textContent.description }} />
          {((textContent.skills?.length ?? 0) > 0 || (textContent.leadership?.length ?? 0) > 0) && (
            <div className="wc-pills">
              {textContent.skills?.map(s => (
                <span key={s} className="wc-pill wc-pill--skill">{s}</span>
              ))}
              {textContent.leadership?.map(l => (
                <span key={l} className="wc-pill wc-pill--leadership">{l}</span>
              ))}
            </div>
          )}
        </div>
      ) : null}
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
  /** Opens the detail row (top-row only) */
  onClick?: () => void;
  /** Hover in — detail-row only */
  onHoverIn?: (url: string, rect: DOMRect) => void;
  /** Hover out — detail-row only */
  onHoverOut?: () => void;
  brandColor?: string;
  /** Called once when the media's natural dimensions are known */
  onDimLoad?: (url: string, w: number, h: number) => void;
}

function AssetThumb({
  url, index, label, active, firstLit,
  onClick, onHoverIn, onHoverOut,
  brandColor, onDimLoad,
}: AssetThumbProps) {
  return (
    <button
      className={[
        'wc-thumb',
        active    ? 'wc-thumb--active'     : '',
        firstLit  ? 'wc-thumb--first-lit'  : '',
        onClick   ? 'wc-thumb--clickable'  : '',
        label     ? 'wc-thumb--labeled'    : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--i': index,
        ...(brandColor ? { '--brand-color': brandColor } : {}),
      } as React.CSSProperties}
      onMouseEnter={(e) =>
        onHoverIn?.(url, (e.currentTarget as HTMLElement).getBoundingClientRect())
      }
      onMouseLeave={() => onHoverOut?.()}
      onClick={(e) => {
        // On touch devices, tap opens the hover preview (mirrors desktop hover)
        if (window.matchMedia('(hover: none)').matches) {
          onHoverIn?.(url, (e.currentTarget as HTMLElement).getBoundingClientRect());
        }
        onClick?.();
      }}
      aria-pressed={active}
    >
      <div className="wc-thumb__media">
        {isVideo(url) ? (
          <video
            src={url} muted loop playsInline autoPlay aria-hidden="true"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) onDimLoad?.(url, v.videoWidth, v.videoHeight);
            }}
          />
        ) : (
          <img
            src={url} alt=""
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) onDimLoad?.(url, img.naturalWidth, img.naturalHeight);
            }}
          />
        )}
      </div>
      {label && <span className="wc-thumb__label">{label}</span>}
    </button>
  );
}

// ── DescriptionThumb ──────────────────────────────────────────────────────────
// Renders as the first frame in the detail carousel row.

interface DescriptionThumbProps {
  index: number;
  label: string;
  description: string;
  skills?: string[];
  leadership?: string[];
  firstLit?: boolean;
  onHoverIn?: (label: string, description: string, rect: DOMRect, skills?: string[], leadership?: string[]) => void;
  onHoverOut?: () => void;
}

function DescriptionThumb({ index, label, description, skills, leadership, firstLit, onHoverIn, onHoverOut }: DescriptionThumbProps) {
  const hasPills = (skills?.length ?? 0) > 0 || (leadership?.length ?? 0) > 0;
  return (
    <div
      className={['wc-thumb', 'wc-thumb--labeled', 'wc-thumb--text', firstLit ? 'wc-thumb--first-lit' : ''].filter(Boolean).join(' ')}
      style={{ '--i': index } as React.CSSProperties}
      onMouseEnter={(e) =>
        onHoverIn?.(label, description, (e.currentTarget as HTMLElement).getBoundingClientRect(), skills, leadership)
      }
      onMouseLeave={() => onHoverOut?.()}
      onClick={(e) => {
        // On touch devices, tap opens the hover preview (mirrors desktop hover)
        if (window.matchMedia('(hover: none)').matches) {
          onHoverIn?.(label, description, (e.currentTarget as HTMLElement).getBoundingClientRect(), skills, leadership);
        }
      }}
    >
      <div className="wc-thumb__media wc-thumb__media--text wc-thumb__media--desc">
        <span className="wc-thumb__text-excerpt" dangerouslySetInnerHTML={{ __html: description }} />
        {hasPills && (
          <div className="wc-pills">
            {skills?.map(s => (
              <span key={s} className="wc-pill wc-pill--skill">{s}</span>
            ))}
            {leadership?.map(l => (
              <span key={l} className="wc-pill wc-pill--leadership">{l}</span>
            ))}
          </div>
        )}
      </div>
      <span className="wc-thumb__label">{label}</span>
    </div>
  );
}

// ── TextThumb ─────────────────────────────────────────────────────────────────
// Renders in the top carousel row for projects with no visual assets.

interface TextThumbProps {
  index: number;
  label: string;
  description: string;
  skills?: string[];
  leadership?: string[];
  active?: boolean;
  firstLit?: boolean;
  onClick?: () => void;
  onHoverIn?: (label: string, description: string, rect: DOMRect, skills?: string[], leadership?: string[]) => void;
  onHoverOut?: () => void;
}

function TextThumb({ index, label, description, skills, leadership, active, firstLit, onClick, onHoverIn, onHoverOut }: TextThumbProps) {
  return (
    <button
      className={[
        'wc-thumb',
        'wc-thumb--clickable',
        'wc-thumb--labeled',
        'wc-thumb--text',
        active    ? 'wc-thumb--active'    : '',
        firstLit  ? 'wc-thumb--first-lit' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--i': index } as React.CSSProperties}
      onMouseEnter={(e) =>
        onHoverIn?.(label, description, (e.currentTarget as HTMLElement).getBoundingClientRect(), skills, leadership)
      }
      onMouseLeave={() => onHoverOut?.()}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className="wc-thumb__media wc-thumb__media--text">
        <span className="wc-thumb__text-excerpt" dangerouslySetInnerHTML={{ __html: description }} />
      </div>
      <span className="wc-thumb__label">{label}</span>
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

  // Natural dimensions cache — a ref so handleHoverIn always reads the latest
  // value without stale-closure issues (no dep array needed, no re-render cost).
  const naturalDimsRef = useRef<Record<string, NaturalDims>>({});

  // Hover-preview state
  const [hoverUrl,         setHoverUrl]        = useState<string | null>(null);
  const [hoverText,        setHoverText]       = useState<{ label: string; description: string; skills?: string[]; leadership?: string[] } | null>(null);
  const [hoverRect,        setHoverRect]       = useState<DOMRect | null>(null);
  const [hoverNaturalDims, setHoverNaturalDims] = useState<NaturalDims | null>(null);
  // `hoverVisible` lags one frame behind mounting so the CSS transition fires
  const [hoverVisible, setHoverVisible] = useState(false);

  // Timers
  const showTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleTimer = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  // Track scroll containers — used to snap to the first interactive cell on mount
  const topTrackRef    = useRef<HTMLDivElement>(null);
  const detailTrackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedProject(null);
    setHoverUrl(null);
    setHoverText(null);
    setHoverRect(null);
    setHoverNaturalDims(null);
    setHoverVisible(false);
    setAnyTopHovered(false);
    setAnyDetailHovered(false);
    naturalDimsRef.current = {};
  }, [company.slug]);

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
    const cellWidth = isMobile ? 160 : 220; // matches .wc-thumb__media width in CSS
    const gap       = 6;                    // matches gap: 6px on .wc-row__track
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

  // ── Eager dim preload — fires as soon as the carousel opens for a company ──
  // Kicks off new Image() loads for every image asset in the company so dims are
  // cached before the user can hover. Images already in the browser cache resolve
  // synchronously; slow connections still get dims before the first hover.
  useEffect(() => {
    const imageUrls = company.projects
      .flatMap(p => p.assets)
      .filter(url => !isVideo(url));

    imageUrls.forEach(url => {
      if (naturalDimsRef.current[url]) return;
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          naturalDimsRef.current[url] = { w: img.naturalWidth, h: img.naturalHeight };
        }
      };
      img.src = url;
    });
  }, [company]);

  useEffect(() => () => {
    if (showTimer.current)   clearTimeout(showTimer.current);
    if (hideTimer.current)   clearTimeout(hideTimer.current);
    if (visibleTimer.current) cancelAnimationFrame(visibleTimer.current);
  }, []);

  // ── Detail-row toggle ────────────────────────────────────────────────────
  const handleProjectClick = useCallback((project: ProjectAssets) => {
    setSelectedProject(prev => {
      if (prev?.slug === project.slug) return null;
      setDetailKey(k => k + 1);
      setAnyDetailHovered(false);
      return project;
    });
  }, []);

  // ── Dim-load callback — stores natural dimensions from loaded thumbnails ──
  // Writes directly to the ref; no state update needed (handleHoverIn reads the ref).
  const handleDimLoad = useCallback((url: string, w: number, h: number) => {
    if (!naturalDimsRef.current[url]) {
      naturalDimsRef.current[url] = { w, h };
    }
  }, []);

  // ── Hover preview — enter (media) ───────────────────────────────────────
  const handleHoverIn = useCallback((url: string, rect: DOMRect) => {
    // Cancel any in-progress hide
    if (hideTimer.current)   clearTimeout(hideTimer.current);
    if (showTimer.current)   clearTimeout(showTimer.current);
    if (visibleTimer.current) cancelAnimationFrame(visibleTimer.current);

    setHoverUrl(url);
    setHoverText(null);
    setHoverRect(rect);
    // Reads from ref — always current, no stale-closure risk
    setHoverNaturalDims(naturalDimsRef.current[url] ?? null);
    setHoverVisible(false); // mount at scale(1)

    // One rAF lets the browser paint the initial state before the transition fires
    visibleTimer.current = requestAnimationFrame(() => {
      setHoverVisible(true); // transitions to scale(ZOOM)
    });
  }, []); // no deps — ref reads are always live

  // ── Hover preview — enter (text thumb) ──────────────────────────────────
  const handleTextHoverIn = useCallback((label: string, description: string, rect: DOMRect, skills?: string[], leadership?: string[]) => {
    if (hideTimer.current)   clearTimeout(hideTimer.current);
    if (showTimer.current)   clearTimeout(showTimer.current);
    if (visibleTimer.current) cancelAnimationFrame(visibleTimer.current);

    setHoverUrl(null);
    setHoverText({ label, description, skills, leadership });
    setHoverRect(rect);
    setHoverNaturalDims(null); // clear any stale dims from a previously hovered image
    setHoverVisible(false);

    visibleTimer.current = requestAnimationFrame(() => {
      setHoverVisible(true);
    });
  }, []);

  // ── Shared: schedule unmount of hover preview after transition (260ms) ────
  const scheduleHoverDismiss = useCallback(() => {
    hideTimer.current = setTimeout(() => {
      setHoverUrl(null);
      setHoverText(null);
      setHoverRect(null);
      setHoverNaturalDims(null);
    }, 260);
  }, []);

  // ── Hover preview — leave ────────────────────────────────────────────────
  const handleHoverOut = useCallback(() => {
    if (showTimer.current)   clearTimeout(showTimer.current);
    if (visibleTimer.current) cancelAnimationFrame(visibleTimer.current);
    setHoverVisible(false); // transitions back to scale(1) + opacity 0
    scheduleHoverDismiss();
  }, [scheduleHoverDismiss]);

  // ── Keep hover preview alive when mouse moves onto it ───────────────────
  // mouseLeave on the thumbnail fires before mouseEnter on the preview, so
  // handleHoverOut has already called setHoverVisible(false) and started the
  // 260ms hide timer by the time this runs. We cancel both and re-show.
  const handlePreviewKeepAlive = useCallback(() => {
    if (hideTimer.current)   clearTimeout(hideTimer.current);
    if (showTimer.current)   clearTimeout(showTimer.current);
    if (visibleTimer.current) cancelAnimationFrame(visibleTimer.current);
    setHoverVisible(true);
  }, []);

  // ── Dismiss hover preview (click) ───────────────────────────────────────
  const dismissHover = useCallback(() => {
    setHoverVisible(false);
    scheduleHoverDismiss();
  }, [scheduleHoverDismiss]);

  const availableProjects = company.projects.filter(p => p.assets.length > 0 || !!p.description);

  // Track whether any interactive cell is hovered in each row so the first
  // cell stays lit (wc-thumb--first-lit) when nothing else is being hovered.
  const [anyTopHovered,    setAnyTopHovered]    = useState(false);
  const [anyDetailHovered, setAnyDetailHovered] = useState(false);

  return (
    <>
      <div className="wc-container" aria-label={`${company.label} work gallery`}>
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

                {availableProjects.map((project, i) => {
                  const cellIndex = FILLERS_START + i;
                  const isFirst   = i === 0;
                  const isActive  = selectedProject?.slug === project.slug;
                  const firstLit  = isFirst && !anyTopHovered && !isActive;
                  return project.assets.length > 0 ? (
                    <AssetThumb
                      key={project.slug}
                      url={project.assets[0]}
                      index={cellIndex}
                      label={project.label}
                      active={isActive}
                      firstLit={firstLit}
                      onClick={() => handleProjectClick(project)}
                      onHoverIn={() => { setAnyTopHovered(true); }}
                      onHoverOut={() => { setAnyTopHovered(false); }}
                      brandColor={company.color}
                      onDimLoad={handleDimLoad}
                    />
                  ) : (
                    <TextThumb
                      key={project.slug}
                      index={cellIndex}
                      label={project.label}
                      description={project.description ?? ''}
                      skills={project.skills}
                      leadership={project.leadership}
                      active={isActive}
                      firstLit={firstLit}
                      onClick={() => handleProjectClick(project)}
                      onHoverIn={() => { setAnyTopHovered(true); }}
                      onHoverOut={() => { setAnyTopHovered(false); }}
                    />
                  );
                })}

                {/* Trailing decorative filler cells */}
                {Array.from({ length: FILLERS_END }, (_, fi) => (
                  <FillerThumb key={`top-filler-end-${fi}`} index={FILLERS_START + availableProjects.length + fi} />
                ))}
              </div>
            </div>
          ) : (
            <div className="wc-empty"><span>coming soon</span></div>
          )}

          {/* ── Detail carousel: description card first, then all assets ── */}
          {selectedProject && (selectedProject.assets.length > 0 || !!selectedProject.description) && (
            <div className="wc-row wc-row--detail" key={`detail-${detailKey}`}>
              <div className="wc-row__track" ref={detailTrackRef}>
                {/* Leading decorative filler cells */}
                {Array.from({ length: FILLERS_START }, (_, fi) => (
                  <FillerThumb key={`detail-filler-start-${fi}`} index={fi} />
                ))}

                {selectedProject.description && (
                  <DescriptionThumb
                    index={FILLERS_START + 0}
                    label={selectedProject.label}
                    description={selectedProject.description}
                    skills={selectedProject.skills}
                    leadership={selectedProject.leadership}
                    firstLit={!anyDetailHovered}
                    onHoverIn={(label, description, rect, skills, leadership) => {
                      setAnyDetailHovered(true);
                      handleTextHoverIn(label, description, rect, skills, leadership);
                    }}
                    onHoverOut={() => { setAnyDetailHovered(false); handleHoverOut(); }}
                  />
                )}

                {selectedProject.assets.map((asset, i) => {
                  const baseOffset = selectedProject.description ? 1 : 0;
                  const cellIndex  = FILLERS_START + baseOffset + i;
                  const isFirst    = i === 0 && !selectedProject.description;
                  return (
                    <AssetThumb
                      key={asset}
                      url={asset}
                      index={cellIndex}
                      firstLit={isFirst && !anyDetailHovered}
                      onHoverIn={(url, rect) => {
                        setAnyDetailHovered(true);
                        handleHoverIn(url, rect);
                      }}
                      onHoverOut={() => { setAnyDetailHovered(false); handleHoverOut(); }}
                      brandColor={company.color}
                      onDimLoad={handleDimLoad}
                    />
                  );
                })}

                {/* Trailing decorative filler cells */}
                {Array.from({ length: FILLERS_END }, (_, fi) => {
                  const contentCount = (selectedProject.description ? 1 : 0) + selectedProject.assets.length;
                  return (
                    <FillerThumb key={`detail-filler-end-${fi}`} index={FILLERS_START + contentCount + fi} />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* In-place hover preview — outside wc-container (pointer-events:none) */}
      {(hoverUrl || hoverText) && hoverRect && (
        <HoverPreview
          url={hoverUrl ?? undefined}
          textContent={hoverText ?? undefined}
          rect={hoverRect}
          visible={hoverVisible}
          onClose={dismissHover}
          onKeepAlive={handlePreviewKeepAlive}
          onLeave={handleHoverOut}
          naturalDims={hoverNaturalDims ?? undefined}
          brandColor={company.color}
        />
      )}
    </>
  );
}
