import { useEffect, useState } from "react";
import { segmentation_categories } from "../../helpers/constants";
import Header from "../../components/Header";
import SiteFooter from "../../components/SiteFooter";
import styles from "./LandingPage.module.css";

const TARGETS = {
  ctVolumes: 36_390,
  medicalCenters: 145,
  annotatedStructures: 993_000,
  organClasses: segmentation_categories.length,
} as const;

const ANIMATION_DURATION = 2_200;

const formatStructures = (value: number): string => {
  if (value >= TARGETS.annotatedStructures) {
    return `${Math.floor(TARGETS.annotatedStructures / 1_000)}K+`;
  }

  if (value >= 1_000) {
    return `${Math.floor(value / 1_000)}K+`;
  }

  return String(value);
};

const easeOutCubic = (progress: number): number => {
  return 1 - Math.pow(1 - progress, 3);
};

export default function LandingPage() {
  const [animationProgress, setAnimationProgress] = useState(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReducedMotion) {
      setAnimationProgress(1);
      return;
    }

    const startTime = performance.now();
    let animationFrameId: number;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

      setAnimationProgress(easeOutCubic(progress));

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const getAnimatedValue = (target: number) =>
    Math.round(animationProgress * target);

  const stats = [
    {
      value: getAnimatedValue(TARGETS.ctVolumes).toLocaleString("en-US"),
      label: "CT Volumes",
    },
    {
      value: String(getAnimatedValue(TARGETS.medicalCenters)),
      label: "Medical Centers",
    },
    {
      value: formatStructures(getAnimatedValue(TARGETS.annotatedStructures)),
      label: "Annotated Structures",
    },
    {
      value: String(getAnimatedValue(TARGETS.organClasses)),
      label: "Organ Classes",
    },
  ];

  return (
    <div className={styles.root}>
      <Header />
      <main className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Body<span className={styles.heroTitleAlt}>Maps</span>
        </h1>
        <p className={styles.heroSubtitle}>
          The open library of labeled body CT scans
        </p>
        <div className={styles.heroStats}>
          {stats.map((stat, index) => (
            <div key={stat.label} className={styles.statGroup}>
              <div className={styles.heroStatItem}>
                <div className={styles.heroStatValue}>{stat.value}</div>
                <div className={styles.heroStatLabel}>{stat.label}</div>
              </div>

              {index < stats.length - 1 && (
                <div className={styles.heroStatDivider} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
