import { useEffect, useRef, useState } from "react";
import { renderVisualization } from "../helpers/CornerstoneNifti2";
import { SegmentationMeshViewer } from "../components/MeshViewer";
import { segmentation_categories, segmentation_category_colors } from "../helpers/constants";
import { APP_CONSTANTS } from "../helpers/constants";
import type { ColorLUT } from "@cornerstonejs/core/types";

const API_BASE = APP_CONSTANTS.API_ORIGIN;
const ORGANS = ["Aorta", "Bladder", "Celiac artery", "Colon", "Kidney left", "Liver", "Spleen", "Stomach"];
const PANCREAS_PARTS = ["pancreas_body", "pancreas_head", "pancreas_tail"];
const PANCREAS_INDICES = PANCREAS_PARTS.map((part) => segmentation_categories.findIndex((c) => c === part) + 1);
const EASE = "cubic-bezier(0.22,1,0.36,1)";

function allTrueState() {
  return new Array(segmentation_categories.length + 1).fill(true);
}
function pancreasOnlyState() {
  const next = new Array(segmentation_categories.length + 1).fill(false);
  next[0] = true;
  PANCREAS_INDICES.forEach((idx) => { next[idx] = true; });
  return next;
}
function typeText(el: HTMLElement | null, text: string, speed = 32, onDone?: () => void) {
  if (!el) return;
  el.textContent = "";
  let i = 0;
  const interval = setInterval(() => {
    el.textContent = text.slice(0, i + 1);
    i++;
    if (i >= text.length) { clearInterval(interval); onDone?.(); }
  }, speed);
}

/**
 * Compute a translate+scale that moves `el`'s center to the center of
 * `container` and scales it to fill the container. Uses viewport rects only,
 * so it is immune to offsetParent quirks. Requires transformOrigin to be
 * the element's own center ("50% 50%").
 */
function zoomToFill(el: HTMLElement, container: HTMLElement, maxScale?: number) {
  const rect = el.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  let scaleX = cRect.width / rect.width;
  let scaleY = cRect.height / rect.height;
  if (maxScale != null) {
    const s = Math.min(maxScale, scaleX, scaleY);
    scaleX = s;
    scaleY = s;
  }
  const dx = (cRect.left + cRect.width / 2) - (rect.left + rect.width / 2);
  const dy = (cRect.top + cRect.height / 2) - (rect.top + rect.height / 2);
  return { dx, dy, scaleX, scaleY };
}

const CAPTIONS = {
  mesh: "A full 3D reconstruction of your scan",
  role: "Choose your view",
  healthy: "Every organ has been checked",
  pancreas: "One finding needs a closer look",
  finding: "What we found",
  doctor: "The complete clinical picture",
  final: "Final impressions",
};

/**
 * Readers pinned to the REAL get-report-data payload for this backend:
 *   comments        — full RadGPT text (pancreas stats + lesion details live here)
 *   impression      — ["A hypoattenuating pancreas (tail) mass (1.0 x 0.5 cm)."]
 *   lesions.pancreas          — { volume, voxels }
 *   organ_volumes.pancreas    — { mean_hu, volume, status, dimensions, centroid_mm }
 * Size / location / enhancement / image number only exist inside the comments
 * text, so they're parsed out of it (still the real report — just text-encoded).
 */
function getPancreasOrgan(report: any): any {
  const ov = report?.organ_volumes;
  if (!ov || typeof ov !== "object") return null;
  const key = Object.keys(ov).find((k) => /^pancreas/i.test(k));
  return key ? ov[key] : null;
}
function getPancreasLesion(report: any): any {
  const l = report?.lesions;
  if (!l || typeof l !== "object") return null;
  const key = Object.keys(l).find((k) => /pancreas/i.test(k));
  return key ? l[key] : null;
}
function parseLesionDetails(comments: string | undefined) {
  const c = comments ?? "";
  const size = c.match(/Size:\s*([\d.]+\s*x\s*[\d.]+\s*cm)/i)?.[1] ?? null;
  const image = c.match(/\(image\s*(\d+)\)/i)?.[1] ?? null;
  const location = c.match(/Location:\s*([^.\n]+)/i)?.[1]?.trim() ?? null;
  const enhancement = c.match(/Enhancement[^:]*:\s*(\w+)/i)?.[1] ?? null;
  const lesionHu = c.match(/HU value is\s*(-?[\d.]+\s*\+\/-\s*[\d.]+)/i)?.[1] ?? null;
  const count = (c.match(/Pancreas lesion \d+:/gi) ?? []).length || null;
  return { size, image, location, enhancement, lesionHu, count };
}
function hasPancreasData(report: any): boolean {
  return !!(getPancreasOrgan(report) || getPancreasLesion(report) || /pancreas/i.test(report?.comments ?? ""));
}
function fmt(v: any, suffix = ""): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "number" ? `${Math.round(v * 10) / 10}${suffix}` : `${v}${suffix}`;
}

export default function ShowcasePage() {
  const [checkState, setCheckState] = useState<boolean[]>(allTrueState());
  const [ctReady, setCtReady] = useState(false);
  const [showMpr, setShowMpr] = useState(true);
  // Real report data from the backend — no hardcoded values.
  const [report, setReport] = useState<any>(null);
  const reportRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadReport(attempt = 0) {
      try {
        const r = await fetch(`${API_BASE}/api/get-report-data/36`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        console.log("[Showcase] get-report-data/36 payload:", data);
        // Accept only when real pancreas data is present.
        if (!hasPancreasData(data)) throw new Error("payload has no pancreas data");
        if (!cancelled) { reportRef.current = data; setReport(data); }
      } catch (e) {
        console.error(`[Showcase] report load failed (attempt ${attempt + 1}):`, e);
        if (!cancelled && attempt < 10) setTimeout(() => loadReport(attempt + 1), 1500);
      }
    }
    loadReport();
    return () => { cancelled = true; };
  }, []);

  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const panel3dRef = useRef<HTMLDivElement>(null);
  const reportBtnRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const mprWrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const meshWrapRef = useRef<HTMLDivElement>(null);
  const glowRingRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const ovWalkRef = useRef<HTMLDivElement>(null);
  const wpRef = useRef<HTMLSpanElement>(null);
  const wdRef = useRef<HTMLSpanElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const healthyBoxRef = useRef<HTMLDivElement>(null);
  const findingCardRef = useRef<HTMLDivElement>(null);
  const measureCardRef = useRef<HTMLDivElement>(null);
  const patientCardRef = useRef<HTMLDivElement>(null);
  const patientMeasureRef = useRef<HTMLDivElement>(null);
  const finalCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!axialRef.current || !sagittalRef.current || !coronalRef.current) return;
      const labelColorMap: Record<number, [number, number, number, number]> = {};
      segmentation_categories.forEach((_, i) => {
        labelColorMap[i + 1] = segmentation_category_colors[i + 1] ?? [255, 255, 255, 255];
      });
      const max = Math.max(...Object.keys(labelColorMap).map((k) => parseInt(k)));
      const cmap: ColorLUT = Array.from({ length: max + 1 }, () => [0, 0, 0, 0]);
      for (const key in labelColorMap) cmap[parseInt(key)] = labelColorMap[parseInt(key)];
      const ctUrl = `${API_BASE}/api/get-main-nifti/36.nii.gz`;
      const segUrl = `${API_BASE}/api/get-segmentations/36.nii.gz`;
      try {
        await renderVisualization(axialRef.current, sagittalRef.current, coronalRef.current, cmap, ctUrl, segUrl, () => {});
        if (!cancelled) setCtReady(true);
      } catch (e) {
        console.error("Showcase CT load failed:", e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Blur-focus-pull reveal: starts soft and slightly blurred, sharpens in.
    const fade = (el: HTMLElement | null, show: boolean) => {
      if (!el) return;
      el.style.transition = `opacity 0.85s ${EASE}, transform 0.85s ${EASE}, filter 0.85s ${EASE}`;
      el.style.opacity = show ? "1" : "0";
      el.style.transform = show ? "scale(1)" : "scale(0.96)";
      el.style.filter = show ? "blur(0px)" : "blur(6px)";
    };
    // Caption reveal animates only opacity/blur/vertical rise — never anything
    // width-dependent — so typewriter growth can't fight the centering.
    const caption = (el: HTMLElement | null, text: string | null) => {
      if (!el) return;
      el.style.transition = `opacity 0.7s ${EASE}, filter 0.7s ${EASE}, translate 0.7s ${EASE}`;
      if (text === null) {
        el.style.opacity = "0";
        el.style.filter = "blur(6px)";
        el.style.translate = "0 10px";
      } else {
        el.style.opacity = "1";
        el.style.filter = "blur(0px)";
        el.style.translate = "0 0";
        typeText(el, text);
      }
    };
    let cancelled = false;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => { if (!cancelled) fn(); }, ms));

    function run() {
      // Wait for BOTH the CT and the real report before starting the show —
      // never animate over empty/loading cards.
      if (!ctReady || !reportRef.current) { at(500, run); return; }
      const cursor = cursorRef.current;
      const reportBtn = reportBtnRef.current;
      const mprWrap = mprWrapRef.current;
      const content = contentRef.current;
      const meshWrap = meshWrapRef.current;
      const glowRing = glowRingRef.current;
      const intro = introRef.current;
      const ovWalk = ovWalkRef.current;
      const wp = wpRef.current;
      const wd = wdRef.current;
      const toggle = toggleRef.current;
      const healthyBox = healthyBoxRef.current;
      const findingCard = findingCardRef.current;
      const measureCard = measureCardRef.current;
      const patientCard = patientCardRef.current;
      const patientMeasure = patientMeasureRef.current;
      const finalCard = finalCardRef.current;
      const cap = captionRef.current;
      const panel3d = panel3dRef.current;
      if (!cursor || !reportBtn || !mprWrap || !content || !meshWrap || !glowRing || !intro || !ovWalk || !wp || !wd || !toggle || !healthyBox || !findingCard || !measureCard || !patientCard || !patientMeasure || !finalCard || !cap || !panel3d) return;

      cursor.style.transition = "none";
      cursor.style.opacity = "1";
      cursor.style.left = "50%";
      cursor.style.top = "70%";
      reportBtn.style.transition = "none";
      reportBtn.style.transform = "scale(1)";
      reportBtn.style.background = "rgba(255,255,255,0.06)";
      reportBtn.style.boxShadow = "none";
      void cursor.offsetWidth;
      cursor.style.transition = `left 1.1s ${EASE}, top 1.1s ${EASE}`;
      reportBtn.style.transition = `transform 0.3s ${EASE}, background 0.3s ${EASE}`;

      at(700, () => {
        // Viewport-rect math (no offsetParent). The button sits in the toolbar
        // just above the content area, so clamp the tip to stay visible and
        // point up at the button from the content's top edge.
        const rect = reportBtn.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        cursor.style.left = `${rect.left - contentRect.left + rect.width / 2}px`;
        cursor.style.top = `${Math.max(2, rect.top - contentRect.top + rect.height / 2)}px`;
      });
      // Hover: button lights up and grows while the cursor rests on it.
      at(1800, () => {
        reportBtn.style.transition = `transform 0.3s ${EASE}, background 0.3s ${EASE}, box-shadow 0.3s ${EASE}`;
        reportBtn.style.background = "rgba(255,255,255,0.16)";
        reportBtn.style.transform = "scale(1.35)";
        reportBtn.style.boxShadow = "0 0 0 3px rgba(255,255,255,0.25)";
      });
      // The click: hard press-down + double ripple burst — unmistakable.
      at(2500, () => {
        reportBtn.style.transition = "transform 0.09s ease";
        reportBtn.style.transform = "scale(0.8)";
        const ripple = rippleRef.current;
        if (ripple) {
          ripple.style.transition = "none";
          ripple.style.opacity = "1";
          ripple.style.transform = "translate(-50%,-50%) scale(0.4)";
          void ripple.offsetWidth;
          ripple.style.transition = "opacity 0.55s ease, transform 0.55s ease";
          ripple.style.opacity = "0";
          ripple.style.transform = "translate(-50%,-50%) scale(4.5)";
        }
      });
      // Release: button snaps to a large, clearly-active state with a glow ring.
      at(2680, () => {
        reportBtn.style.transition = `transform 0.4s ${EASE}, background 0.4s ${EASE}, box-shadow 0.4s ${EASE}`;
        reportBtn.style.transform = "scale(1.5)";
        reportBtn.style.background = "rgba(255,255,255,0.24)";
        reportBtn.style.boxShadow = "0 0 0 3px rgba(255,255,255,0.45), 0 0 24px rgba(255,255,255,0.35)";
      });
      at(2900, () => fade(cursor, false));
      // Button settles back to its normal resting state once the action fires.
      at(3050, () => {
        reportBtn.style.transition = `transform 0.5s ${EASE}, background 0.5s ${EASE}, box-shadow 0.5s ${EASE}`;
        reportBtn.style.transform = "scale(1)";
        reportBtn.style.background = "rgba(255,255,255,0.06)";
        reportBtn.style.boxShadow = "none";
      });
      at(2900, () => {
        // FIX 1: center-origin zoom. Translate moves the panel's center to the
        // content area's center; scale then grows it around its own center to
        // fill the area exactly. All math is done in viewport coordinates.
        const { dx, dy, scaleX, scaleY } = zoomToFill(panel3d, content);
        panel3d.style.transformOrigin = "50% 50%";
        panel3d.style.transition = `transform 1.8s ${EASE}`;
        panel3d.style.zIndex = "20";
        panel3d.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
      });
      at(3100, () => fade(intro, true));
      at(5300, () => {
        fade(intro, false);
        panel3d.style.transition = "none";
        panel3d.style.transform = "translate(0px, 0px) scale(1, 1)";
        panel3d.style.zIndex = "1";
      });
      at(5600, () => { mprWrap.style.opacity = "0"; setShowMpr(false); });
      at(5900, () => { setCheckState(allTrueState()); fade(meshWrap, true); fade(ovWalk, true); });

      // Beat 1 — mesh takeover
      at(6400, () => caption(cap, CAPTIONS.mesh));
      at(8600, () => caption(cap, null));

      // Beat 2 — role toggle zooms to center
      at(9200, () => {
        meshWrap.style.transition = `opacity 0.9s ease, transform 0.9s ${EASE}`;
        meshWrap.style.opacity = "0.35";
        caption(cap, CAPTIONS.role);
        // FIX 2: zoom the Patient/Doctor toggle from its corner position to
        // center-screen, same viewport-rect approach as the 3D panel zoom.
        // Capped uniform scale so the pill grows without filling the screen.
        const { dx, dy, scaleX, scaleY } = zoomToFill(toggle, content, 2.4);
        toggle.style.transformOrigin = "50% 50%";
        toggle.style.transition = `transform 1.1s ${EASE}`;
        toggle.style.zIndex = "30";
        toggle.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
      });
      at(11300, () => { wd.style.background = "#fff"; wd.style.color = "#111"; wp.style.background = "transparent"; wp.style.color = "rgba(255,255,255,0.55)"; });
      at(12300, () => { wp.style.background = "#fff"; wp.style.color = "#111"; wd.style.background = "transparent"; wd.style.color = "rgba(255,255,255,0.55)"; });
      at(13100, () => {
        caption(cap, null);
        meshWrap.style.opacity = "1";
        // Return the toggle to its corner.
        toggle.style.transition = `transform 0.9s ${EASE}`;
        toggle.style.transform = "translate(0px, 0px) scale(1)";
      });
      at(14000, () => { toggle.style.zIndex = "auto"; });

      // Beat 3 — healthy organs
      at(14000, () => { fade(healthyBox, true); caption(cap, CAPTIONS.healthy); });
      at(17200, () => { fade(healthyBox, false); caption(cap, null); });

      // Beat 4 — pancreas focus pull
      at(17800, () => {
        glowRing.style.transition = `opacity 0.4s ease, transform 1.2s ${EASE}`;
        glowRing.style.opacity = "1";
        glowRing.style.transform = "scale(1.3)";
        meshWrap.style.transition = `opacity 0.5s ease, transform 1.2s ${EASE}`;
        meshWrap.style.opacity = "0.25";
        // no page-level zoom on pancreas isolation — the viewer's own camera does enough
        caption(cap, CAPTIONS.pancreas);
      });
      at(18000, () => setCheckState(pancreasOnlyState()));
      at(18400, () => { meshWrap.style.opacity = "1"; });
      at(19000, () => { glowRing.style.opacity = "0"; });

      // Beat 5a — Patient view: real finding + measurement, styled like the app
      at(20200, () => { caption(cap, null); });
      at(20700, () => { fade(patientCard, true); caption(cap, CAPTIONS.finding); });
      at(21000, () => fade(patientMeasure, true));

      // Beat 5b — flip to Doctor view: full clinical stats
      at(24600, () => {
        fade(patientCard, false);
        fade(patientMeasure, false);
        caption(cap, null);
      });
      at(25200, () => {
        wd.style.background = "#fff"; wd.style.color = "#111";
        wp.style.background = "transparent"; wp.style.color = "rgba(255,255,255,0.55)";
        caption(cap, CAPTIONS.doctor);
        fade(findingCard, true);
      });
      at(25500, () => fade(measureCard, true));

      at(29200, () => {
        fade(findingCard, false);
        fade(measureCard, false);
        caption(cap, null);
      });

      // Beat 6 — Final Impressions (back to patient framing, like the app's end screen)
      at(29900, () => {
        wp.style.background = "#fff"; wp.style.color = "#111";
        wd.style.background = "transparent"; wd.style.color = "rgba(255,255,255,0.55)";
        setCheckState(allTrueState());
        meshWrap.style.transform = "scale(1)";
        meshWrap.style.opacity = "0.3";
        fade(finalCard, true);
        caption(cap, CAPTIONS.final);
      });
      at(33900, () => {
        fade(finalCard, false);
        caption(cap, null);
        meshWrap.style.opacity = "1";
      });
      at(34600, () => {
        fade(ovWalk, false);
        fade(meshWrap, false);
        setShowMpr(true);
        fade(mprWrap, true);
        wp.style.transition = "none"; wp.style.background = "#fff"; wp.style.color = "#111";
        wd.style.transition = "none"; wd.style.background = "transparent"; wd.style.color = "rgba(255,255,255,0.55)";
        toggle.style.transition = "none";
        toggle.style.transform = "translate(0px, 0px) scale(1)";
        toggle.style.zIndex = "auto";
      });

      at(35400, run);
    }
    run();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [ctReady]);

  // Derive everything the cards show from the real fetched report.
  const pancreasOrgan = getPancreasOrgan(report);       // { mean_hu, volume, status, … }
  const pancreasLesion = getPancreasLesion(report);     // { volume, voxels }
  const details = parseLesionDetails(report?.comments); // size/image/location/enhancement/HU/count from real text
  const impressionText = Array.isArray(report?.impression) ? report.impression.join(" ") : null;
  // Patient-friendly line built from the same real report values, in plain words.
  const patientLine = details.size && details.location
    ? `The scan found a small spot (${details.size}) in the ${details.location.replace(/^pancreas\s*/i, "")} of your pancreas.`
    : impressionText;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#050506", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: "min(96vw, 1440px)", height: "min(90vh, 880px)", background: "#0a0a0d", borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 50px 140px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.03)", overflow: "hidden" }}>

        <div style={{ height: 32, background: "#131317", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>

        <div style={{ height: 50, background: "#0f0f13", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10, padding: "0 18px" }}>
          <i className="ti ti-settings" style={{ fontSize: 16, color: "rgba(255,255,255,0.45)" }} />
          <i className="ti ti-home" style={{ fontSize: 16, color: "rgba(255,255,255,0.45)" }} />
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Case</span>
          <span style={{ fontSize: 13, color: "#fff", fontWeight: 700 }}>36</span>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.05)", padding: "5px 10px", borderRadius: 7 }}>MPR</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.05)", padding: "5px 10px", borderRadius: 7 }}>Soft Tissue</span>
          <div style={{ flex: 1 }} />
          <i className="ti ti-pointer" style={{ fontSize: 15, color: "#111", background: "#fff", borderRadius: 7, padding: 6 }} />
          <i className="ti ti-ruler-2" style={{ fontSize: 15, color: "rgba(255,255,255,0.45)" }} />
          <i className="ti ti-eye" style={{ fontSize: 15, color: "rgba(255,255,255,0.45)" }} />
          <i className="ti ti-player-play" style={{ fontSize: 15, color: "rgba(255,255,255,0.45)" }} />
          <div ref={reportBtnRef} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)" }}>
            {/* Clipboard-with-clock (Tabler "report") drawn inline so it matches
                the BodyMaps toolbar exactly, independent of icon-font version */}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 5H6a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h5.5" />
              <path d="M18 14v4h4" />
              <circle cx="18" cy="18" r="4" />
              <path d="M8 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" />
              <path d="M8 11h4" />
              <path d="M8 15h3" />
            </svg>
          </div>
          <i className="ti ti-camera" style={{ fontSize: 15, color: "rgba(255,255,255,0.45)" }} />
          <i className="ti ti-download" style={{ fontSize: 15, color: "rgba(255,255,255,0.45)" }} />
        </div>

        <div ref={contentRef} style={{ position: "relative", width: "100%", height: "calc(100% - 82px)", overflow: "hidden" }}>

          {/* Arrow cursor (macOS-style pointer) with a click ripple ring */}
          <div ref={cursorRef} style={{ position: "absolute", zIndex: 50, opacity: 0, pointerEvents: "none", transform: "translate(-4px,-3px)" }}>
            <div ref={rippleRef} style={{ position: "absolute", left: 4, top: 3, width: 10, height: 10, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.8)", opacity: 0, transform: "translate(-50%,-50%) scale(0.4)" }} />
            <svg width="30" height="30" viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.6))" }}>
              <path d="M5.5 3.2 L5.5 17.5 L9.2 14.2 L11.5 19.6 L14 18.5 L11.7 13.2 L16.6 12.9 Z" fill="#fff" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
            </svg>
          </div>

          <div ref={mprWrapRef} style={{ position: "absolute", inset: 0, opacity: showMpr ? 1 : 0, transform: "scale(1)" }}>
            {/* FIX 1: position:relative on the grid so panel3d's stacking/coords are anchored here */}
            <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 1, background: "rgba(255,255,255,0.06)" }}>
              <div ref={axialRef} style={{ background: "#000" }} />
              <div ref={sagittalRef} style={{ background: "#000" }} />
              <div ref={coronalRef} style={{ background: "#000" }} />
              <div ref={panel3dRef} style={{ background: "#000", position: "relative", overflow: "hidden", zIndex: 1 }}>
                <SegmentationMeshViewer caseId="36" checkState={checkState} loading={false} opacity={APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY * 100} crosshairMm={null} autoRotate />
              </div>
            </div>
          </div>

          <div ref={introRef} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transform: "scale(0.96)", zIndex: 25 }}>
            <div style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 24, padding: "30px 36px", textAlign: "center", maxWidth: 340 }}>
              <p style={{ fontSize: 28, fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>Reviewing your CT scan.</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: "0 0 18px" }}>20 organs look healthy. 1 finding needs your attention.</p>
              <span style={{ display: "inline-block", padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.11)", border: "1px solid rgba(255,255,255,0.16)", color: "#fff", fontSize: 14, fontWeight: 700 }}>Start walkthrough</span>
            </div>
          </div>

          <div ref={glowRingRef} style={{ position: "absolute", top: "50%", left: "50%", width: 140, height: 140, marginLeft: -70, marginTop: -70, borderRadius: "50%", background: "radial-gradient(circle, rgba(240,180,41,0.35), transparent 70%)", opacity: 0, pointerEvents: "none" }} />

          <div ref={meshWrapRef} style={{ position: "absolute", inset: 0, opacity: 0, transform: "scale(0.96)" }}>
            <SegmentationMeshViewer caseId="36" checkState={checkState} loading={false} opacity={APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY * 100} crosshairMm={null} autoRotate />
          </div>

          <div ref={ovWalkRef} style={{ position: "absolute", inset: 0, opacity: 0, transform: "scale(0.96)", pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 56, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
              <p style={{ fontSize: 17, fontWeight: 700, color: "#fff", margin: 0 }}>Understanding your CT scan</p>
              {/* FIX 2: outer div keeps the toggle vertically centered in the bar;
                  inner ref'd div is the animated element (transform-based zoom) */}
              <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)" }}>
                <div ref={toggleRef} style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.08)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: 4, willChange: "transform", boxShadow: "0 8px 26px rgba(0,0,0,0.35)" }}>
                  <span ref={wpRef} style={{ padding: "7px 16px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "#fff", color: "#111" }}>Patient</span>
                  <span ref={wdRef} style={{ padding: "7px 16px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>Doctor</span>
                </div>
              </div>
            </div>

            {/* Static wrapper handles horizontal centering (flex, no transition),
                so typewriter width growth can never lag behind an animated
                translateX. The <p> only animates opacity / blur / translate-Y. */}
            <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
              <p ref={captionRef} style={{ fontSize: 38, fontWeight: 800, color: "#fff", margin: 0, opacity: 0, filter: "blur(6px)", minHeight: "1.2em", whiteSpace: "nowrap", textAlign: "center" }}></p>
            </div>

            <div ref={healthyBoxRef} style={{ position: "absolute", left: 20, top: 76, width: 230, background: "rgba(10,10,13,0.85)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: 18, opacity: 0 }}>
              <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "#6ee7b7", textTransform: "uppercase", margin: "0 0 6px" }}>Healthy organs</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: "#6ee7b7", margin: "0 0 12px" }}>20 organs look healthy.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {ORGANS.map((n) => (
                  <div key={n} style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: "6px 9px" }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: "rgba(110,231,183,0.18)", color: "#6ee7b7", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.8)" }}>{n}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Patient view — styled to match the real app: finding card + measurements card */}
            <div ref={patientCardRef} style={{ position: "absolute", left: 24, top: 100, width: 300, background: "rgba(14,14,17,0.92)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 22, padding: 26, opacity: 0, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
              <p style={{ fontSize: 10, letterSpacing: "0.14em", color: "#f0b429", textTransform: "uppercase", fontWeight: 700, margin: "0 0 12px" }}>Finding 1 of 1</p>
              <p style={{ fontSize: 34, fontWeight: 800, color: "#f0b429", margin: "0 0 14px" }}>Pancreas</p>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.9)", margin: "0 0 14px", lineHeight: 1.5 }}>{patientLine ?? "—"}</p>
              <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", margin: "0 0 20px", lineHeight: 1.55 }}>Your doctor can explain what this means with your symptoms and medical history.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <span style={{ padding: "10px 18px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600 }}>← Back</span>
                <span style={{ padding: "10px 20px", borderRadius: 999, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 13, fontWeight: 700 }}>Finish →</span>
              </div>
            </div>

            <div ref={patientMeasureRef} style={{ position: "absolute", right: 24, top: 100, width: 250, background: "rgba(14,14,17,0.92)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 22, padding: 24, opacity: 0, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
              <p style={{ fontSize: 10, letterSpacing: "0.14em", color: "#f0b429", textTransform: "uppercase", fontWeight: 700, margin: "0 0 16px" }}>Measurements</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: "0 0 4px" }}>Organ</p>
              <p style={{ fontSize: 19, fontWeight: 800, color: "#f0b429", margin: "0 0 14px" }}>Pancreas</p>
              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "0 0 14px" }} />
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: "0 0 4px" }}>Lesion size</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: "#f0b429", margin: "0 0 4px" }}>{fmt(details.size)}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "0 0 14px" }}>From the report text.</p>
              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "0 0 14px" }} />
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.55 }}>This panel shows the key measurement from the report. Your doctor can explain what it means for you.</p>
            </div>

            {/* Doctor view — real structured values from get-report-data/36 */}
            <div ref={findingCardRef} style={{ position: "absolute", left: 20, top: 76, width: 290, background: "rgba(18,18,22,0.94)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(240,180,41,0.25)", borderRadius: 20, padding: 20, opacity: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <p style={{ fontSize: 9, letterSpacing: "0.08em", color: "#f0b429", textTransform: "uppercase", margin: 0 }}>Finding 1 of 1</p>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: "rgba(240,180,41,0.15)", color: "#f0b429", padding: "3px 8px", borderRadius: 6 }}>Needs review</span>
              </div>
              <p style={{ fontSize: 22, fontWeight: 700, color: "#f0b429", margin: "0 0 2px" }}>Pancreas</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", margin: "0 0 14px" }}>Lesion 1 · {fmt(details.location)}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <p style={{ fontSize: 9, letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", margin: "0 0 3px" }}>Size</p>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>{fmt(details.size)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 9, letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", margin: "0 0 3px" }}>Volume</p>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>{fmt(pancreasLesion?.volume, " cc")}</p>
                </div>
                <div>
                  <p style={{ fontSize: 9, letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", margin: "0 0 3px" }}>Image</p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: 0 }}>{fmt(details.image)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 9, letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", margin: "0 0 3px" }}>Enhancement</p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#f0b429", margin: 0 }}>{fmt(details.enhancement)}</p>
                </div>
              </div>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.5 }}>{details.enhancement && details.lesionHu ? `${details.enhancement} relative to pancreas (HU ${details.lesionHu}).` : ""}</p>
            </div>

            <div ref={measureCardRef} style={{ position: "absolute", right: 20, top: 76, width: 235, background: "rgba(18,18,22,0.94)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: 20, opacity: 0 }}>
              <p style={{ fontSize: 9, letterSpacing: "0.08em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", margin: "0 0 10px" }}>Organ metrics</p>
              <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 12px" }}>Pancreas</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Mean attenuation</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{fmt(pancreasOrgan?.mean_hu, " HU")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Organ volume</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{fmt(pancreasOrgan?.volume, " cc")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Lesion volume</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{fmt(pancreasLesion?.volume, " cc")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Lesion count</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{fmt(details.count)}</span>
                </div>
              </div>
            </div>

            {/* Final Impressions — glassy center panel, matching the real app's end screen */}
            <div ref={finalCardRef} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0 }}>
              <div style={{ width: 480, background: "rgba(20,18,24,0.55)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 26, padding: "34px 38px", textAlign: "center", boxShadow: "0 40px 100px rgba(0,0,0,0.55)" }}>
                <p style={{ fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", fontWeight: 700, margin: "0 0 10px" }}>Final Impressions</p>
                <p style={{ fontSize: 40, fontWeight: 800, color: "#fff", margin: "0 0 22px" }}>Final Impressions:</p>
                <div style={{ background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.25)", borderRadius: 16, padding: "18px 22px", textAlign: "left", margin: "0 0 20px" }}>
                  <p style={{ fontSize: 10, letterSpacing: "0.14em", color: "#f0b429", textTransform: "uppercase", fontWeight: 700, margin: "0 0 8px" }}>Report impression</p>
                  <p style={{ fontSize: 19, fontWeight: 700, color: "#fff", margin: 0 }}>{impressionText ?? "—"}</p>
                </div>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: "0 0 22px", lineHeight: 1.55 }}>Final note: discuss this report with your doctor so they can interpret it with your symptoms, history, and other tests.</p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <span style={{ padding: "11px 20px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600 }}>← Back</span>
                  <span style={{ padding: "11px 22px", borderRadius: 999, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 13, fontWeight: 700 }}>Start over</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}