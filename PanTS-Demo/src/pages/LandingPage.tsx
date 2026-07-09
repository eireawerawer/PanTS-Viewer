import { IconArrowUpRight, IconChevronLeft, IconChevronRight, IconUpload } from "@tabler/icons-react";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { segmentation_categories } from "../helpers/constants";
import styles from "./LandingPage.module.css";

type HeroSlice = {
  src: string;
  label: string;
  sliceNumber: number;
};

type HeroStat = {
  value: string;
  label: string;
};

const HERO_CT_TOTAL_SLICES = 71;
const HERO_CT_FRAME_INDICES = [66, 62, 56, 52, 48, 44, 40, 30, 26, 22, 18, 14, 10, 6];
const HERO_CT_SOURCES: HeroSlice[] = HERO_CT_FRAME_INDICES.map((sliceIndex) => ({
  src: `/hero-ct/bdmap-00000338-z${String(sliceIndex).padStart(3, "0")}.png`,
  label: "BDMAP_00000338",
  sliceNumber: sliceIndex + 1,
}));

const FRAME_COUNT = HERO_CT_SOURCES.length;
const NAV_TABS = [
  { id: "overview", label: "OVERVIEW", path: "/" },
  { id: "dataset", label: "DATASET", path: "/dashboard" },
  { id: "upload", label: "UPLOAD", path: "/upload" },
  { id: "team", label: "TEAM", path: "/team" },
] as const;

// organClasses is derived from the viewer's actual label set (not hardcoded) so the
// landing page can't drift out of sync with what the platform actually segments.
const TARGETS = { ctVol: 36390, medCenters: 145, structures: 993000, organClasses: segmentation_categories.length };

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function formatStructures(v: number): string {
  if (v >= 993000) return "993K+";
  if (v >= 1000) return `${Math.floor(v / 1000)}K+`;
  return String(v);
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reducedMotion;
}

function useScrollProgress(containerRef: RefObject<HTMLElement | null>, freezeAtMiddle: boolean): number {
  const [progress, setProgress] = useState(freezeAtMiddle ? 0.5 : 0);

  useEffect(() => {
    if (freezeAtMiddle) {
      setProgress(0.5);
      return;
    }

    let raf = 0;
    let fallbackTimer = 0;

    const update = () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      raf = 0;
      fallbackTimer = 0;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const scrollRange = Math.max(container.offsetHeight - window.innerHeight, 1);
      setProgress(clamp(-rect.top / scrollRange));
    };

    const requestUpdate = () => {
      if (raf || fallbackTimer) return;
      raf = window.requestAnimationFrame(update);
      fallbackTimer = window.setTimeout(update, 80);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (raf) window.cancelAnimationFrame(raf);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
  }, [containerRef, freezeAtMiddle]);

  return progress;
}

export default function LandingPage() {
  const navigate = useNavigate();
  const heroRef = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const scrollProgress = useScrollProgress(heroRef, reducedMotion);

  const [ctVol, setCtVol] = useState(0);
  const [medCenters, setMedCenters] = useState(0);
  const [structures, setStructures] = useState(0);
  const [organClasses, setOrganClasses] = useState(0);

  useEffect(() => {
    const dur = 2200;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf: number;
    const tick = () => {
      const p = ease(Math.min((performance.now() - t0) / dur, 1));
      setCtVol(Math.round(p * TARGETS.ctVol));
      setMedCenters(Math.round(p * TARGETS.medCenters));
      setStructures(Math.round(p * TARGETS.structures));
      setOrganClasses(Math.round(p * TARGETS.organClasses));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const stats: HeroStat[] = [
    { value: ctVol.toLocaleString(), label: "CT Volumes" },
    { value: String(medCenters), label: "Medical Centers" },
    { value: formatStructures(structures), label: "Annotated Structures" },
    { value: String(organClasses), label: "Organ Classes" },
  ];

  const frameIndex = Math.round(scrollProgress * (FRAME_COUNT - 1));
  const sourceProgress = scrollProgress * (HERO_CT_SOURCES.length - 1);
  const activeSlice = HERO_CT_SOURCES[Math.round(sourceProgress)] ?? HERO_CT_SOURCES[0];

  const heroStyle = {
    "--scan-y": `${18 + scrollProgress * 64}%`,
    "--depth-progress": `${scrollProgress * 100}%`,
  } as CSSProperties;

  const scrollToProgress = useCallback(
    (targetProgress: number) => {
      const container = heroRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const scrollRange = Math.max(container.offsetHeight - window.innerHeight, 1);
      const top = window.scrollY + rect.top + clamp(targetProgress) * scrollRange;
      window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
    },
    [reducedMotion],
  );

  const handleSliceStep = (direction: -1 | 1) => {
    const nextFrame = clamp((frameIndex + direction) / (FRAME_COUNT - 1));
    scrollToProgress(nextFrame);
  };

  return (
    <section ref={heroRef} className={styles.root} style={heroStyle}>
      <div className={styles.heroStage}>
        <nav className={`${styles.nav} ${styles.landingNav}`}>
          <button type="button" className={styles.logoPill} onClick={() => scrollToProgress(0)}>
            <img
              src="/favicon/favicon.svg"
              alt="BodyMaps logo"
              className={styles.logoImg}
            />
            <div className={styles.logoTitle}>BodyMaps</div>
          </button>

          <div className={styles.tabBar}>
            {NAV_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`${styles.tabPill} ${tab.id === "overview" ? styles.tabPillActive : ""}`}
                onClick={() => {
                  if (tab.id === "overview") {
                    scrollToProgress(0);
                    return;
                  }
                  navigate(tab.path);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.navSpacer} />
        </nav>

        <main className={styles.hero}>
          <section className={styles.heroCopy}>
            <p className={styles.heroKicker}>OPEN ABDOMINAL CT ATLAS</p>
            <h1 className={styles.heroTitle}>
              BODY
              <br />
              MAPS
            </h1>
            <p className={styles.heroSubtitle}>The open library of labeled body CT scans</p>

            <div className={styles.heroActions}>
              <button type="button" className={styles.btnPrimary} onClick={() => navigate("/dashboard")}>
                <span>Explore Dataset</span>
                <IconArrowUpRight size={19} stroke={2} />
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => navigate("/upload")}>
                <IconUpload size={18} stroke={2} />
                <span>Upload Dataset</span>
              </button>
            </div>
          </section>

          <section className={styles.visualPanel} aria-label="Axial CT scroll preview">
            <div className={styles.topoField} aria-hidden="true" />
            <div className={styles.ctScene}>
              <div className={styles.ctPlane}>
                <div className={styles.ctImageStack} aria-hidden="true">
                  {HERO_CT_SOURCES.map((slice, index) => (
                    <img
                      key={slice.src}
                      src={slice.src}
                      alt=""
                      className={styles.ctSlice}
                      style={{ opacity: clamp(1 - Math.abs(sourceProgress - index)) }}
                      onError={(event) => {
                        if (slice.src !== HERO_CT_SOURCES[0].src) {
                          event.currentTarget.style.display = "none";
                        }
                      }}
                    />
                  ))}
                </div>
                <div className={styles.scanLine} aria-hidden="true" />
                <div className={styles.ctPlaneLabel}>
                  <span>{activeSlice.label}</span>
                  <span>
                    Z {activeSlice.sliceNumber} / {HERO_CT_TOTAL_SLICES}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              className={`${styles.sliceButton} ${styles.sliceButtonPrev}`}
              aria-label="Previous axial slice"
              onClick={() => handleSliceStep(-1)}
            >
              <IconChevronLeft size={23} stroke={2.1} />
            </button>
            <button
              type="button"
              className={`${styles.sliceButton} ${styles.sliceButtonNext}`}
              aria-label="Next axial slice"
              onClick={() => handleSliceStep(1)}
            >
              <IconChevronRight size={23} stroke={2.1} />
            </button>
          </section>
        </main>

        <footer className={styles.heroFooter}>
          <div className={styles.heroStats}>
            {stats.map((s, i) => (
              <div key={s.label} className={styles.statGroup}>
                <div className={styles.heroStatItem}>
                  <div className={styles.heroStatValue}>{s.value}</div>
                  <div className={styles.heroStatLabel}>{s.label}</div>
                </div>
                {i < stats.length - 1 && <div className={styles.heroStatDivider} />}
              </div>
            ))}
          </div>

          <button type="button" className={styles.depthCta} onClick={() => scrollToProgress(1)}>
            <span>Explore Depth</span>
            <IconChevronRight size={20} stroke={2.2} />
          </button>
        </footer>

        <div className={styles.depthRail} aria-hidden="true">
          <div className={styles.depthRailFill} />
        </div>
        <div className={styles.grainOverlay} aria-hidden="true" />
      </div>
    </section>
  );
}
