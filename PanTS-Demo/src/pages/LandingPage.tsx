import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { segmentation_categories } from "../helpers/constants";
import styles from "./LandingPage.module.css";
import Header from "../components/Header";

/* ── counter targets ── */
// organClasses is derived from the viewer's actual label set (not hardcoded) so the
// landing page can't drift out of sync with what the platform actually segments.
const TARGETS = {
  ctVol: 36390,
  medCenters: 145,
  structures: 993000,
  organClasses: segmentation_categories.length,
};

function formatStructures(v: number): string {
  if (v >= 993000) return "993K+";
  if (v >= 1000) return `${Math.floor(v / 1000)}K+`;
  return String(v);
}

type TabType = "overview" | "dataset" | "upload" | "team";

export default function LandingPage() {
  const navigate = useNavigate();

  /* ── animated counters ── */
  const [ctVol, setCtVol] = useState(0);
  const [medCenters, setMedCenters] = useState(0);
  const [structures, setStructures] = useState(0);
  const [organClasses, setOrganClasses] = useState(0);

  /* ── tab navigation handler ── */
  const handleTabClick = (tab: TabType) => {
    if (tab === "dataset") {
      navigate("/dashboard");
    } else if (tab === "upload") {
      navigate("/upload");
    } else if (tab === "team") {
      navigate("/team");
    }
    // "overview" stays on the landing page — no navigation needed
  };

  /* ── counter animation ── */
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

  const stats = [
    { value: ctVol.toLocaleString(), label: "CT Volumes" },
    { value: String(medCenters), label: "Medical Centers" },
    { value: formatStructures(structures), label: "Annotated Structures" },
    { value: String(organClasses), label: "Organ Classes" },
  ];

  return (
    <div className={styles.root}>
      <Header />

      {/* ═══════ CENTERED HERO ═══════ */}
      <main className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Body<span className={styles.heroTitleAlt}>Maps</span>
        </h1>
        <p className={styles.heroSubtitle}>
          The open library of labeled body CT scans
        </p>

        <div className={styles.heroStats}>
          {stats.map((s, i) => (
            <div key={s.label} className={styles.statGroup}>
              <div className={styles.heroStatItem}>
                <div className={styles.heroStatValue}>{s.value}</div>
                <div className={styles.heroStatLabel}>{s.label}</div>
              </div>
              {i < stats.length - 1 && (
                <div className={styles.heroStatDivider} />
              )}
            </div>
          ))}
        </div>

        <div className={styles.heroActions}>
          <button
            className={styles.btnPrimary}
            onClick={() => handleTabClick("dataset")}
          >
            Browse Dataset
          </button>
          <button
            className={styles.btnSecondary}
            onClick={() => handleTabClick("upload")}
          >
            Upload Dataset
          </button>
        </div>
      </main>
    </div>
  );
}
