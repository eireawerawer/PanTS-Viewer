import { cache, init as coreInit, utilities as csCoreUtils, Enums, eventTarget, getRenderingEngine, imageLoader, metaData, RenderingEngine, setVolumesForViewports, volumeLoader } from "@cornerstonejs/core";
import type { ColorLUT, Point2, Point3, Color } from "@cornerstonejs/core/types";
import { cornerstoneNiftiImageLoader, createNiftiImageIdsAndCacheMetadata, init as niftiImageLoaderInit } from "@cornerstonejs/nifti-volume-loader";
import * as cornerstoneTools from '@cornerstonejs/tools';
import { init as cornerstoneToolsInit } from '@cornerstonejs/tools';
import { SegmentationRepresentations } from "@cornerstonejs/tools/enums";
import { NEW_CLASS_PALETTE } from "./constants";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkImageMarchingCubes from "@kitware/vtk.js/Filters/General/ImageMarchingCubes";

type viewportIdTypes = 'CT_NIFTI_AXIAL' | 'CT_NIFTI_SAGITTAL' | 'CT_NIFTI_CORONAL';

const {
    ToolGroupManager,
    Enums: csToolsEnums,
    segmentation,
    annotation,
    PanTool,
    ZoomTool,
    StackScrollTool,
    CrosshairsTool,
    LengthTool,
    ProbeTool,
    RectangleROITool,
    AngleTool,
    EllipticalROITool,
    PlanarFreehandROITool,
    BidirectionalTool,
    ArrowAnnotateTool,
    AdvancedMagnifyTool,
    BrushTool,
    TrackballRotateTool,
    ReferenceLinesTool,
} = cornerstoneTools;

// Measurement tools the toolbar can switch the primary mouse button to. Length =
// distance in mm, Bidirectional = long + short axis (RECIST), Probe = HU readout
// at a point, RectangleROI/EllipticalROI/FreehandROI = area + mean/max/min HU (the
// freehand one traces an arbitrary closed outline instead of a fixed rect/ellipse
// shape), Angle = angle in degrees between two segments, Arrow = labeled pointer at
// a finding.
export const LENGTH_TOOL = LengthTool.toolName;
export const BIDIRECTIONAL_TOOL = BidirectionalTool.toolName;
export const PROBE_TOOL = ProbeTool.toolName;
export const ROI_TOOL = RectangleROITool.toolName;
export const ANGLE_TOOL = AngleTool.toolName;
export const ELLIPSE_TOOL = EllipticalROITool.toolName;
export const FREEHAND_ROI_TOOL = PlanarFreehandROITool.toolName;
export const ARROW_TOOL = ArrowAnnotateTool.toolName;
export const MEASUREMENT_TOOL_NAMES = [LENGTH_TOOL, BIDIRECTIONAL_TOOL, ANGLE_TOOL, PROBE_TOOL, ROI_TOOL, ELLIPSE_TOOL, FREEHAND_ROI_TOOL, ARROW_TOOL] as const;
export type MeasurementToolName = (typeof MEASUREMENT_TOOL_NAMES)[number];

// Magnify is a viewing aid, not a measurement: it shares the activation path (one
// owner of the primary button) but its loupe annotations are excluded from the
// measurement inventory/report, and are removed when the tool is put down.
// AdvancedMagnifyTool is required — plain MagnifyTool throws on volume viewports.
// (Annotated: its d.ts declares `static toolName: any`, which would poison the union.)
export const MAGNIFY_TOOL: string = AdvancedMagnifyTool.toolName;
export type PrimaryMouseToolName = MeasurementToolName | typeof MAGNIFY_TOOL;

// Mask-editing tools: two instances of BrushTool, one painting the active segment,
// one erasing (strategy ERASE writes segment 0). Registered passive; the toolbar's
// Edit panel activates one of them on the primary button.
export const EDIT_BRUSH = "MaskBrush";
export const EDIT_ERASER = "MaskEraser";
export const EDIT_TOOL_NAMES = [EDIT_BRUSH, EDIT_ERASER] as const;
export type MaskEditToolName = (typeof EDIT_TOOL_NAMES)[number];

// Cornerstone's defaults draw measurements in yellow (resting) / green (selected) — the
// standard radiology-viewer convention for a plain grayscale background. BodyMaps overlays
// colored organ masks (reds/pinks/purples/teal), so yellow/green collide with them. Cyan
// gives the strongest contrast over the warm masks while still reading on grayscale CT;
// selected annotations go white for clear edit feedback. The dashed leader line that
// tethers each label to its measurement is recolored to match.
const MEASURE_COLOR = "#22d3ee"; // cyan — resting
const MEASURE_COLOR_HI = "#67e8f9"; // lighter cyan — hover
const MEASUREMENT_ANNOTATION_STYLE = {
    color: MEASURE_COLOR,
    colorHighlighted: MEASURE_COLOR_HI,
    colorSelected: "#ffffff",
    colorLocked: MEASURE_COLOR,
    lineWidth: "2",
    textBoxColor: MEASURE_COLOR,
    textBoxColorHighlighted: MEASURE_COLOR_HI,
    textBoxColorSelected: "#ffffff",
    textBoxLinkLineColor: MEASURE_COLOR,
    // Pin the font/shadow too: if a prior (partial) style ever persisted in module state,
    // the merge base could be missing these and the value labels wouldn't render.
    textBoxFontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
    textBoxFontSize: "14px",
    shadow: true,
};

const renderingEngineId = "rendering_engine";
const toolGroupId = "myToolGroup";
const DEFAULT_SEGMENTATION_CONFIG = {
    fillAlpha: 0.6,
    fillAlphaInactive: 0.6,
    outlineOpacity: 1,
    outlineWidth: 1,
    renderOutline: false,
    outlineOpacityInactive: 0
};


const volumeId = "myVolume";
const segmentationId = "mySegmentation";
// const volumeId = `${volumeLoaderScheme}:${mainNiftiURL}`;
// const segmentationId = `${volumeLoaderScheme}:${segmentationURL}`;

const viewportId1 = "CT_NIFTI_AXIAL";
const viewportId2 = "CT_NIFTI_SAGITTAL";
const viewportId3 = "CT_NIFTI_CORONAL";
const MPR_VIEWPORT_IDS = [viewportId1, viewportId2, viewportId3];

// Shaded volume rendering (3D pane "Volume" mode) — its OWN rendering engine,
// viewport and tool group. A separate engine is essential: sharing the MPR
// engine means enabling/disabling this viewport (or its resize) repacks the
// shared offscreen canvas and corrupts the axial/sagittal/coronal viewports.
const volume3DViewportId = "CT_VOLUME_3D";
const volume3DEngineId = "volume3d_engine";
const volume3DToolGroupId = "volume3DToolGroup";

function _getVolume3DEngine(): RenderingEngine {
  return (getRenderingEngine(volume3DEngineId) as RenderingEngine | undefined) ?? new RenderingEngine(volume3DEngineId);
}

let currentRenderingEngine: RenderingEngine | null = null;
// The CT volume currently on the MPR viewports (changes when the progressive
// full-res upgrade swaps it) and the color LUT used for the labelmap, kept so
// the segmentation representation can be rebuilt after a volume swap.
let _currentCtVolumeId: string | null = null;
let _lastColorLUT: ColorLUT | null = null;
// User-created segment labels, reset on each case load.
let _customSegmentLabels: Record<number, string> = {};

let _crosshairChangeCallbacks = new Set<(mm: number[]) => void>();
let _isSyncing = false;
let _crosshairListenerRegistered = false;

function _handleCrosshairCenterChanged(evt: Event) {
    if (_isSyncing) return;

    const toolCenter = (evt as CustomEvent).detail?.toolCenter as number[] | undefined;

    if (!toolCenter || toolCenter.length < 3) return;

    for (const cb of _crosshairChangeCallbacks) {
        cb(toolCenter);
    }
}

export function registerCrosshairListener(eventTarget: EventTarget, cornerstoneTools: any) {
    if (!_crosshairListenerRegistered) {
        eventTarget.addEventListener(
            cornerstoneTools.Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED,
            _handleCrosshairCenterChanged
        );

        _crosshairListenerRegistered = true;
    }
}

export function subscribeToCrosshairChanges(cb: (mm: number[]) => void) {
    _crosshairChangeCallbacks.add(cb);

    return () => {
        _crosshairChangeCallbacks.delete(cb);
    };
}

export function setCrosshairSyncing(value: boolean) {
    _isSyncing = value;
}

export function moveCornerstoneCrosshairToMm(mm: [number, number, number]) {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;
    const tool = toolGroup.getToolInstance(CrosshairsTool.toolName) as {
        setToolCenter?: (mm: number[], suppressEvents?: boolean) => void;
    };
    if (!tool?.setToolCenter) return;
    _isSyncing = true;
    try {
        tool.setToolCenter(mm, true); // suppressEvents=true prevents re-triggering
    } finally {
        _isSyncing = false;
    }
}

// Current crosshair world position (mm), or null if the tool isn't ready. Used to capture
// the focal point for a shareable link without waiting on a crosshair-change event.
export function getCrosshairMm(): [number, number, number] | null {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    const tool = toolGroup?.getToolInstance(CrosshairsTool.toolName) as
        | { toolCenter?: number[] }
        | undefined;
    const c = tool?.toolCenter;
    if (!c || c.length < 3 || !c.every((n: number) => Number.isFinite(n))) return null;
    return [c[0], c[1], c[2]];
}
const viewportColors: Record<viewportIdTypes, string> = {
    [viewportId1]: 'rgb(200, 0, 0)',
    [viewportId2]: 'rgb(200, 200, 0)',
    [viewportId3]: 'rgb(0, 200, 0)',
};
function getReferenceLineColor(viewportId: viewportIdTypes) {
    return viewportColors[viewportId];
}


function getReferenceLineControllable(viewportId: viewportIdTypes) {
    const index = [viewportId1, viewportId2, viewportId3].indexOf(viewportId);
    return index !== -1;
}

function getReferenceLineDraggableRotatable(viewportId: viewportIdTypes) {
    const index = [viewportId1, viewportId2, viewportId3].indexOf(viewportId);
    return index !== -1;
}

function getReferenceLineSlabThicknessControlsOn(viewportId: viewportIdTypes) {
    const index =
        [viewportId1, viewportId2, viewportId3].indexOf(viewportId);
    return index !== -1;
}

// ---------------------------------------------------------------------------
// Reference lines (OHIF-style) — a passive overlay showing where the pane the
// user is actively scrolling through cuts the OTHER two, independent of
// whatever tool currently owns the primary mouse button. Deliberately separate
// from CrosshairsTool: that tool ALSO draws intersection lines, but only while
// it's the active navigation tool — they vanish the instant you switch to Pan,
// a measurement tool, or mask editing. Reference lines should keep showing then.
//
// Only ONE source is ever active at a time (the pane most recently scrolled),
// matching how OHIF drives its "active viewport" reference lines rather than
// showing all three planes' lines simultaneously, which gets noisy fast.
// Cornerstone's ReferenceLinesTool tracks one `sourceViewportId` per instance
// and draws that source plane into every OTHER viewport with the instance
// enabled — so three named instances are registered (one per possible source)
// and exactly one is enabled at a time; the other two stay disabled.
// ---------------------------------------------------------------------------
const REFERENCE_LINES_INSTANCE_BY_SOURCE: Record<viewportIdTypes, string> = {
    [viewportId1]: "ReferenceLines_Axial",
    [viewportId2]: "ReferenceLines_Sagittal",
    [viewportId3]: "ReferenceLines_Coronal",
};
const REFERENCE_LINES_INSTANCE_NAMES = Object.values(REFERENCE_LINES_INSTANCE_BY_SOURCE);
// SVG stroke-dasharray — a fine dotted line reads as a passive reference, distinct from
// the crosshair's solid navigation lines.
const REFERENCE_LINE_DASH = "1,5";

function _referenceLinesSourceViewportId(pane: CinePane): viewportIdTypes {
    return pane === "axial" ? viewportId1 : pane === "sagittal" ? viewportId2 : viewportId3;
}

// enabled=false disables all three instances. enabled=true enables only the instance
// sourced from `sourcePane` (defaulting to axial) and disables the other two — call this
// again with a different pane whenever the user scrolls a different one.
export function setReferenceLinesEnabled(enabled: boolean, sourcePane: CinePane = "axial") {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;
    const activeInstance = enabled ? REFERENCE_LINES_INSTANCE_BY_SOURCE[_referenceLinesSourceViewportId(sourcePane)] : null;
    for (const instanceName of REFERENCE_LINES_INSTANCE_NAMES) {
        if (instanceName === activeInstance) {
            toolGroup.setToolEnabled(instanceName);
        } else {
            toolGroup.setToolDisabled(instanceName);
        }
    }
    if (currentRenderingEngine) {
        currentRenderingEngine.renderViewports([viewportId1, viewportId2, viewportId3]);
        currentRenderingEngine.render();
    }
}
// Subscribe to the nifti loader's real download progress (bytes loaded / total) so
// the UI can show an accurate, measured ETA. Returns an unsubscribe fn.
export function subscribeToVolumeProgress(
	cb: (loaded: number, total: number, volumeId: string) => void
): () => void {
	const handler = (evt: Event) => {
		const detail = (evt as CustomEvent).detail;
		const data = detail?.data ?? detail;
		if (data && typeof data.loaded === "number" && typeof data.total === "number") {
			cb(data.loaded, data.total, String(data.volumeId ?? ""));
		}
	};
	// Event name from @cornerstonejs/nifti-volume-loader (Events.NIFTI_VOLUME_PROGRESS).
	eventTarget.addEventListener("CORNERSTONE_NIFTI_VOLUME_PROGRESS", handler as EventListener);
	return () =>
		eventTarget.removeEventListener("CORNERSTONE_NIFTI_VOLUME_PROGRESS", handler as EventListener);
}

// Cornerstone core/loader/tools only need initializing once per page load;
// re-running them on every case load (HD toggle, navigation) risks duplicate
// tool registration. Mirrors the guard in compareViewer.ts.
let _cornerstoneInited = false;

export async function renderVisualization(ref1: HTMLDivElement, ref2: HTMLDivElement, ref3: HTMLDivElement, convertedColorLUT: ColorLUT, ctUrl: string, segUrl: string | undefined, setLoading: React.Dispatch<React.SetStateAction<boolean>>, opts?: { ctImageIds?: string[] }) {
    if (!_cornerstoneInited) {
        coreInit();
        niftiImageLoaderInit();
        cornerstoneToolsInit();
        _cornerstoneInited = true;
    }
    _organCentroids = null; // recomputed lazily for the new case's segmentation
    _customSegmentLabels = {};

    const mainNiftiURL = ctUrl;
    const segmentationURL = segUrl;
    ToolGroupManager.destroyToolGroup(toolGroupId);
    disableVolume3D(); // tear down any prior case's 3D engine/tool group
    const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
    if (!toolGroup) {
        throw new Error("Failed to create tool group");
    }

    
    cornerstoneTools.addTool(PanTool);
    cornerstoneTools.addTool(ZoomTool);
    cornerstoneTools.addTool(StackScrollTool);
    cornerstoneTools.addTool(CrosshairsTool);
    cornerstoneTools.addTool(LengthTool);
    cornerstoneTools.addTool(ProbeTool);
    cornerstoneTools.addTool(RectangleROITool);
    cornerstoneTools.addTool(AngleTool);
    cornerstoneTools.addTool(EllipticalROITool);
    cornerstoneTools.addTool(PlanarFreehandROITool);
    cornerstoneTools.addTool(BidirectionalTool);
    cornerstoneTools.addTool(ArrowAnnotateTool);
    cornerstoneTools.addTool(AdvancedMagnifyTool);
    cornerstoneTools.addTool(BrushTool);
    cornerstoneTools.addTool(ReferenceLinesTool);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(StackScrollTool.toolName);
    toolGroup.addTool(LengthTool.toolName);
    toolGroup.addTool(ProbeTool.toolName);
    toolGroup.addTool(RectangleROITool.toolName);
    toolGroup.addTool(AngleTool.toolName);
    toolGroup.addTool(EllipticalROITool.toolName);
    // allowOpenContours: false — always auto-close into a polygon so it behaves like
    // the other ROI tools (area + mean/min/max HU), not an open freehand line.
    toolGroup.addTool(PlanarFreehandROITool.toolName, {
        calculateStats: true,
        allowOpenContours: false,
    });
    toolGroup.addTool(BidirectionalTool.toolName);
    toolGroup.addTool(ArrowAnnotateTool.toolName);
    toolGroup.addTool(AdvancedMagnifyTool.toolName);
    // Mask editing: paint fills the active segment, the eraser writes segment 0.
    toolGroup.addToolInstance(EDIT_BRUSH, BrushTool.toolName, {
        activeStrategy: "FILL_INSIDE_CIRCLE",
    });
    toolGroup.addToolInstance(EDIT_ERASER, BrushTool.toolName, {
        activeStrategy: "ERASE_INSIDE_CIRCLE",
    });
    // Merge our color overrides onto the existing defaults — replacing wholesale would
    // drop font/background/shadow defaults and the value labels would stop rendering.
    const defaultStyles = annotation.config.style.getDefaultToolStyles();
    annotation.config.style.setDefaultToolStyles({
        ...defaultStyles,
        global: { ...(defaultStyles.global ?? {}), ...MEASUREMENT_ANNOTATION_STYLE },
    });
    toolGroup.addTool(CrosshairsTool.toolName, {
        getReferenceLineColor,
        getReferenceLineControllable,
        getReferenceLineDraggableRotatable,
        getReferenceLineSlabThicknessControlsOn,
        // viewportIndicators: true,
        mobile: {
            enabled: false,
            opacity: 0.8,
            handleRadius: 16,
        },
        handleRadius:8
    })
    // Reference lines: one instance per pane as the "source", each showing that pane's
    // slice position as a colored line in the OTHER two — starts disabled (opt-in tool).
    for (const sourceViewportId of [viewportId1, viewportId2, viewportId3] as viewportIdTypes[]) {
        const instanceName = REFERENCE_LINES_INSTANCE_BY_SOURCE[sourceViewportId];
        toolGroup.addToolInstance(instanceName, ReferenceLinesTool.toolName, {
            sourceViewportId,
            enforceSameFrameOfReference: true,
            showFullDimension: false,
        });
        annotation.config.style.setToolGroupToolStyles(toolGroupId, {
            ...annotation.config.style.getToolGroupToolStyles(toolGroupId),
            [instanceName]: {
                color: getReferenceLineColor(sourceViewportId),
                lineWidth: 1.5,
                lineDash: REFERENCE_LINE_DASH,
            },
        });
        toolGroup.setToolDisabled(instanceName);
    }
    if (!_crosshairListenerRegistered) {
        eventTarget.addEventListener(cornerstoneTools.Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, _handleCrosshairCenterChanged);
        _crosshairListenerRegistered = true;
    }

    if (currentRenderingEngine) {
        currentRenderingEngine.destroy();
        currentRenderingEngine = null;
    }
    
    const renderingEngine = new RenderingEngine(renderingEngineId);
    currentRenderingEngine = renderingEngine;
    
    imageLoader.registerImageLoader("nifti", cornerstoneNiftiImageLoader);
    // The CT stack either streams from a NIfTI URL (dataset cases / sessions) or is a
    // set of already-registered DICOM imageIds (local "open DICOM folder" flow).
    const imageIds = opts?.ctImageIds ?? (await createNiftiImageIdsAndCacheMetadata({ url: mainNiftiURL }));
    const segmentationImageIds = segmentationURL
    ? await createNiftiImageIdsAndCacheMetadata({ url: segmentationURL })
    : [];
    // Dataset navigations are full page reloads, so the fixed volumeId never collides.
    // Local DICOM opens happen within one SPA session (upload → view → back → open
    // another folder), so each load needs a fresh id or the cache serves the old scan.
    const ctVolumeId = opts?.ctImageIds ? `dicomVolume-${Date.now()}` : volumeId;
    _currentCtVolumeId = ctVolumeId;
    _lastColorLUT = convertedColorLUT;
    
    const viewportInputArray = [
        {
            viewportId: viewportId1,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: ref1,
            defaultOptions: {
                orientation: Enums.OrientationAxis.AXIAL
            }
        },
        {
            viewportId: viewportId2,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: ref2,
            defaultOptions: {
                orientation: Enums.OrientationAxis.SAGITTAL
            }
        },
        {
            viewportId: viewportId3,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: ref3,
            defaultOptions: {
                orientation: Enums.OrientationAxis.CORONAL
            }
        }
    ];

    // viewportInputArray.forEach((viewport) => toolGroup)
    viewportInputArray.forEach((viewport) => toolGroup.addViewport(viewport.viewportId, renderingEngineId));
    toolGroup.setToolActive(CrosshairsTool.toolName, {
        bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }]
    })
    toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }]
    })
    // Measurement tools start passive: their annotations stay selectable/editable, but
    // the primary button keeps driving the crosshair until the user picks a measure tool.
    for (const toolName of MEASUREMENT_TOOL_NAMES) {
        toolGroup.setToolPassive(toolName);
    }
    toolGroup.setToolPassive(MAGNIFY_TOOL);
    // Brush/eraser start disabled — they only own the mouse while Edit mode is on.
    for (const toolName of EDIT_TOOL_NAMES) {
        toolGroup.setToolDisabled(toolName);
    }

    renderingEngine.setViewports(viewportInputArray);

    const volume = await volumeLoader.createAndCacheVolume(ctVolumeId, { imageIds });
    await volume.load();
    await setVolumesForViewports(
        renderingEngine,
        [{ volumeId: ctVolumeId }],
        viewportInputArray.map((viewport) => viewport.viewportId)
    );

    renderingEngine.renderViewports(viewportInputArray.map((viewport) => viewport.viewportId));

    if (segmentationURL && segmentationImageIds.length > 0 && segmentation) {
        const segmentationVolume = await volumeLoader.createAndCacheVolume(segmentationId, {
            imageIds: segmentationImageIds
        });

        await segmentationVolume.load();

        segmentation.segmentationStyle.setStyle({ type: SegmentationRepresentations.Labelmap, segmentationId: segmentationId }, DEFAULT_SEGMENTATION_CONFIG);
        segmentation.removeAllSegmentations();
        segmentation.addSegmentations([
            {
                segmentationId,
                representation: {
                    type: SegmentationRepresentations.Labelmap,
                    data: {
                        imageIds: segmentationImageIds,
                        volumeId: segmentationId
                    },
                },
            },
        ]);

        viewportInputArray.forEach(async (viewport) => {
            await segmentation.addSegmentationRepresentations(viewport.viewportId, [
                {
                    segmentationId,
                    type: csToolsEnums.SegmentationRepresentations.Labelmap,
                    config: {
                        colorLUTOrIndex: convertedColorLUT
                    }
                }
            ]);
            segmentation.activeSegmentation.setActiveSegmentation(viewport.viewportId, segmentationId);
        });
    }

    renderingEngine.renderViewports(viewportInputArray.map((viewport) => viewport.viewportId));
    setLoading(false);

    // Local DICOM can be any modality (MR, PET, …), so the CT window presets are
    // meaningless — seed the viewer with the scan's *own* VOI from the DICOM header
    // (WindowCenter/WindowWidth). Without this the default CT soft-tissue window
    // clips non-CT data flat (uniform grey). NIfTI dataset scans are CT, so they
    // keep the preset-driven default (no VOI here).
    let initialVoi: { windowCenter: number; windowWidth: number } | undefined;
    if (opts?.ctImageIds && imageIds.length) {
        const voi = metaData.get("voiLutModule", imageIds[0]) as
            | { windowCenter?: number | number[]; windowWidth?: number | number[] }
            | undefined;
        const firstNum = (v: number | number[] | undefined) =>
            Array.isArray(v) ? v[0] : v;
        const wc = firstNum(voi?.windowCenter);
        const ww = firstNum(voi?.windowWidth);
        if (typeof wc === "number" && typeof ww === "number" && ww > 0) {
            initialVoi = { windowCenter: wc, windowWidth: ww };
        }
    }

    return {
        viewportIds: viewportInputArray.map((viewport) => viewport.viewportId),
        renderingEngine: renderingEngine,
        volumeId: ctVolumeId,
        initialVoi,
    }
}


export function setVisibilities(checkState: boolean[]) {
    for (let i = 1; i < checkState.length; i++) {
        if (!segmentation.getActiveSegmentation(viewportId1)) return;
        segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, i);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId1, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId2, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId3, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
    }
    // The loop above walks setActiveSegmentIndex through every id — restore the one the
    // brush is targeting, or edits would silently land on the last organ in the list.
    // Guarded: this effect also fires on mount, before the segmentation exists, and
    // setActiveSegmentIndex throws on a missing segmentation (blanks the whole page).
    try {
        if (segmentation.getActiveSegmentation(viewportId1)) {
            segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, _activeEditSegment);
        }
    } catch {
        /* segmentation not loaded yet */
    }
    if (currentRenderingEngine) {
        currentRenderingEngine.renderViewports([viewportId1, viewportId2, viewportId3]);
        currentRenderingEngine.render();
    }

};


// Fill (the solid organ color wash) and outline (the border traced around each segment)
// are independently controllable — both 0–1. Previously a single "opacity" divided
// whatever value it was given by 2.4 before applying it, so even 100% only ever reached
// ~42% actual alpha; that division is gone. renderOutline defaults to false in
// DEFAULT_SEGMENTATION_CONFIG (no border at all, regardless of outlineOpacity), so this
// also flips it on/off based on whether the outline slider is above zero.
// SegmentationStyle.setStyle merges onto the existing style by default (its `merge`
// param defaults to true), so fill and outline can each be set independently without
// either call needing to know the other's current value.
function _setSegmentationStyle(style: Record<string, unknown>) {
    segmentation.config.style.setStyle(
        { type: csToolsEnums.SegmentationRepresentations.Labelmap, segmentationId },
        style as Parameters<typeof segmentation.config.style.setStyle>[1]
    );
    if (currentRenderingEngine) {
        currentRenderingEngine.renderViewports([viewportId1, viewportId2, viewportId3]);
        currentRenderingEngine.render();
    }
}

export function setFillOpacity(fillOpacity: number) {
    _setSegmentationStyle({
        renderFill: fillOpacity > 0,
        fillAlpha: fillOpacity,
        fillAlphaInactive: fillOpacity,
    });
}

// renderOutline defaults to false in DEFAULT_SEGMENTATION_CONFIG (no border at all,
// regardless of outlineOpacity), so this flips it on/off based on whether the slider
// is above zero.
export function setOutlineOpacity(outlineOpacity: number) {
    _setSegmentationStyle({
        renderOutline: outlineOpacity > 0,
        outlineOpacity: outlineOpacity,
        outlineOpacityInactive: outlineOpacity,
        outlineWidth: DEFAULT_SEGMENTATION_CONFIG.outlineWidth,
    });
}

export function toggleCrosshairTool(enable: boolean) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  if (enable) {
    toolGroup.setToolActive(CrosshairsTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
    toolGroup.setToolDisabled(PanTool.toolName);
  } else {
    toolGroup.setToolDisabled(CrosshairsTool.toolName);
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
  }
}

// The magnify loupes only make sense while the tool is in hand — remove them when
// it's put down (AdvancedMagnify cleans up its magnify viewport on ANNOTATION_REMOVED).
function _removeMagnifyAnnotations() {
  try {
    const all = annotation.state.getAllAnnotations() ?? [];
    for (const a of [...all]) {
      if (a?.metadata?.toolName === MAGNIFY_TOOL && a.annotationUID) {
        annotation.state.removeAnnotation(a.annotationUID);
      }
    }
  } catch {
    /* annotation state not ready */
  }
}

// Activate a measurement tool (or the magnify loupe) on the primary mouse button, or
// pass `null` to hand the primary button back to navigation (the caller restores
// crosshair/pan afterwards). While one is active we disable crosshair + pan so clicks
// draw, not navigate.
export function setActiveMeasurementTool(toolName: PrimaryMouseToolName | null) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  // Reset every measure tool to passive first (keeps existing annotations editable).
  for (const name of [...MEASUREMENT_TOOL_NAMES, MAGNIFY_TOOL]) toolGroup.setToolPassive(name);
  if (toolName !== MAGNIFY_TOOL) _removeMagnifyAnnotations();
  if (!toolName) return;
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  toolGroup.setToolDisabled(PanTool.toolName);
  for (const name of EDIT_TOOL_NAMES) toolGroup.setToolDisabled(name);
  toolGroup.setToolActive(toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
  });
}

// ---------------------------------------------------------------------------
// Mask editing — brush/eraser over the segmentation labelmap, undo/redo via
// Cornerstone's history, and export of the edited labelmap for download.
// ---------------------------------------------------------------------------

// The segment the brush paints. Module-level so setVisibilities can restore it
// (its loop clobbers the active segment index).
let _activeEditSegment = 1;

export function hasSegmentation(): boolean {
  return !!cache.getVolume(segmentationId);
}

// Hand the primary button to the brush or eraser, or pass null to release it
// (the caller then restores measurement/navigation ownership).
export function setActiveMaskEditTool(toolName: MaskEditToolName | null) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  for (const name of EDIT_TOOL_NAMES) toolGroup.setToolDisabled(name);
  if (!toolName) return;
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  toolGroup.setToolDisabled(PanTool.toolName);
  for (const name of MEASUREMENT_TOOL_NAMES) toolGroup.setToolPassive(name);
  toolGroup.setToolActive(toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
  });
}

export function setActiveEditSegment(segmentIndex: number) {
  _activeEditSegment = segmentIndex;
  try {
    segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, segmentIndex);
  } catch {
    /* segmentation not loaded yet */
  }
}
// Picks a color for a brand-new segment index by cycling through the NEW_CLASS_PALETTE.
export function colorForNewClass(segmentIndex: number): Color {
  return NEW_CLASS_PALETTE[(segmentIndex - 1) % NEW_CLASS_PALETTE.length];
}

export function getCustomSegmentLabels(): Readonly<Record<number, string>> {
  return _customSegmentLabels;
}

export type CustomLabelEntry = { name: string; color: Color };

// Snapshot of every custom class's name + color, keyed by segment index.
export function getCustomSegmentLabelsForExport(): Record<number, CustomLabelEntry> {
  const out: Record<number, CustomLabelEntry> = {};
  for (const [idxStr, name] of Object.entries(_customSegmentLabels)) {
    const idx = Number(idxStr);
    const color = _lastColorLUT?.[idx];
    if (color) out[idx] = { name, color: [...color] as Color };
  }
  return out;
}


function _ensureColorLutSlot(segmentIndex: number, color: Color) {
  if (!_lastColorLUT) return;
  while (_lastColorLUT.length <= segmentIndex) {
    _lastColorLUT.push([0, 0, 0, 0]);
  }
  _lastColorLUT[segmentIndex] = [...color] as Color;
}

// Register a colour for a segment index on every MPR viewport and keep the cached LUT
// in sync so exports / rebuilds pick it up.
export function registerNewSegmentColor(segmentIndex: number, color: Color) {
  _ensureColorLutSlot(segmentIndex, color);
  for (const viewportId of MPR_VIEWPORT_IDS) {
    try {
      segmentation.config.color.setSegmentIndexColor(
        viewportId,
        segmentationId,
        segmentIndex,
        color
      );
    } catch {
      // viewport not yet initialised 
    }
  }
  if (currentRenderingEngine) {
    currentRenderingEngine.renderViewports([...MPR_VIEWPORT_IDS]);
    currentRenderingEngine.render();
  }
}

function _getNextAvailableSegmentIndex(): number {
  let max = 0;
  for (const idx of Object.keys(_customSegmentLabels)) {
    max = Math.max(max, Number(idx));
  }
  if (_lastColorLUT) {
    max = Math.max(max, _lastColorLUT.length - 1);
  }
  const volume = cache.getVolume(segmentationId);
  const data = volume?.voxelManager?.getCompleteScalarDataArray?.();
  if (data) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (typeof v === "number") max = Math.max(max, v);
    }
  }
  return max + 1;
}

// Create a new labelmap class the brush can paint. Returns null if no segmentation is loaded.
export function createNewAnnotationClass(
  name: string,
  color?: Color
): { segmentIndex: number; color: Color } | null {
  if (!hasSegmentation()) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  const segmentIndex = _getNextAvailableSegmentIndex();
  const assignedColor = color ?? colorForNewClass(segmentIndex);

  registerNewSegmentColor(segmentIndex, assignedColor);
  _customSegmentLabels[segmentIndex] = trimmed;

  for (const viewportId of MPR_VIEWPORT_IDS) {
    try {
      segmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
        true
      );
    } catch {
      //viewport not yet initialised
    }
  }

  setActiveEditSegment(segmentIndex);
  return { segmentIndex, color: assignedColor };
}


// Brush radius in world mm (applies to both the brush and eraser instances).
export function setMaskBrushSize(mm: number) {
  try {
    cornerstoneTools.utilities.segmentation.setBrushSizeForToolGroup(toolGroupId, mm);
  } catch {
    /* tool group not ready */
  }
}

// ---------------------------------------------------------------------------
// Single global undo/redo. Brush/eraser strokes are recorded by Cornerstone's
// own HistoryMemo; every other edit (smart fill, morphology, boolean ops,
// interpolation, copy-across-slices, lasso, CPR paint, box prompt formerly)
// is recorded on our own _fillHistory stack (see below). The two don't
// interleave with each other, so we just prefer whichever stack actually has
// something to undo/redo — in practice the user's most recent action is
// always on top of ONE of the two, so this behaves as a single button.
// ---------------------------------------------------------------------------
export function undoMaskEdit() {
  if (canUndoSmartFill()) {
    undoSmartFill();
    return;
  }
  csCoreUtils.HistoryMemo.DefaultHistoryMemo.undo();
  currentRenderingEngine?.render();
}

export function redoMaskEdit() {
  if (canRedoSmartFill()) {
    redoSmartFill();
    return;
  }
  csCoreUtils.HistoryMemo.DefaultHistoryMemo.redo();
  currentRenderingEngine?.render();
}

export function getMaskEditHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const h = csCoreUtils.HistoryMemo.DefaultHistoryMemo;
  return {
    canUndo: canUndoSmartFill() || h.canUndo,
    canRedo: canRedoSmartFill() || h.canRedo,
  };
}

// Fires whenever any stroke (or undo/redo of one) changes the labelmap.
export function subscribeToSegmentationEdits(cb: () => void): () => void {
  const handler = () => {
    // Any edit (brush/eraser strokes fire this natively; every other edit path
    // routes through _notifySegmentationChanged, which fires the same event) —
    // mark whichever segment is currently targeted so the 3D pane knows to
    // extract a live mesh for it instead of trusting the stale server GLB.
    markSegmentEdited(_activeEditSegment);
    cb();
  };
  eventTarget.addEventListener(
    csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
    handler as EventListener
  );
  return () =>
    eventTarget.removeEventListener(
      csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
      handler as EventListener
    );
}
// Segment indices touched by ANY edit since the case loaded — lets the 3D
// pane know which organs need a live marching-cubes mesh instead of the
// stale server-generated GLB.
const _editedSegmentIndices = new Set<number>();

export function getEditedSegments(): ReadonlySet<number> {
  return _editedSegmentIndices;
}

export function markSegmentEdited(segmentIndex: number) {
  _editedSegmentIndices.add(segmentIndex);
}

export function clearEditedSegments() {
  _editedSegmentIndices.clear();
}

export type LabelmapExport = {
  dimensions: number[];
  spacing: number[];
  origin: number[];
  /** Nine values, LPS world axes: i-axis [0..2], j-axis [3..5], k-axis [6..8]. */
  direction: number[];
  data: ArrayLike<number>;
};

// Current (possibly edited) labelmap + geometry, for the NIfTI download.
export function getSegmentationExport(): LabelmapExport | null {
  const volume = cache.getVolume(segmentationId);
  const vm = volume?.voxelManager;
  if (!volume || !vm) return null;
  let data: ArrayLike<number> | undefined;
  try {
    data = vm.getCompleteScalarDataArray?.();
  } catch {
    return null;
  }
  if (!data || !data.length) return null;
  return {
    dimensions: [...volume.dimensions],
    spacing: [...volume.spacing],
    origin: [...volume.origin],
    direction: [...volume.direction],
    data,
  };
}

// Remove only measurement annotations (and any magnify loupes), leaving the crosshair intact.
export function clearMeasurements() {
  try {
    const all = annotation.state.getAllAnnotations() ?? [];
    const names = [...MEASUREMENT_TOOL_NAMES, MAGNIFY_TOOL] as readonly string[];
    for (const a of [...all]) {
      const toolName = a?.metadata?.toolName;
      if (toolName && names.includes(toolName) && a.annotationUID) {
        annotation.state.removeAnnotation(a.annotationUID);
      }
    }
  } catch {
    /* annotation state may not be ready (e.g. before first render) — no-op */
  }
  currentRenderingEngine?.render();
}

// ---------------------------------------------------------------------------
// Measurement inventory — a UI-friendly view over Cornerstone's annotation
// state, powering the Measurements panel and the reading-session report.
// ---------------------------------------------------------------------------

export type MeasurementSummary = {
  uid: string;
  tool: string;
  /** User-assigned name (e.g. "lesion"); empty until renamed. */
  label: string;
  /** Formatted value, e.g. "42.3 mm", "37.5°", "512 mm² · mean 45 HU". */
  value: string;
  /** World-mm center of the annotation's handles (jump target), if known. */
  center: [number, number, number] | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- annotation payloads are untyped */
function formatNum(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "?";
}

// Each tool caches different stats keys; scan for the ones we know how to show.
function formatAnnotationValue(a: any): string {
  // ArrowAnnotate stores its note as free text, not cached stats.
  const text = a?.data?.text;
  if (typeof text === "string" && text.trim()) return text.trim();
  const statsByTarget = a?.data?.cachedStats ?? {};
  for (const stats of Object.values(statsByTarget) as any[]) {
    if (!stats || typeof stats !== "object") continue;
    // Bidirectional: long × short axis (RECIST-style).
    if (typeof stats.length === "number" && typeof stats.width === "number") {
      return `${formatNum(stats.length)} × ${formatNum(stats.width)} ${stats.unit ?? "mm"}`;
    }
    if (typeof stats.length === "number") return `${formatNum(stats.length)} ${stats.unit ?? "mm"}`;
    if (typeof stats.angle === "number") return `${formatNum(stats.angle)}°`;
    if (typeof stats.area === "number") {
      const area = `${formatNum(stats.area, 0)} ${stats.areaUnit ?? "mm²"}`;
      return typeof stats.mean === "number" ? `${area} · mean ${formatNum(stats.mean, 0)} HU` : area;
    }
    if (typeof stats.value === "number") return `${formatNum(stats.value, 0)} HU`;
    if (typeof stats.mean === "number") return `mean ${formatNum(stats.mean, 0)} HU`;
  }
  return "…";
}

function annotationCenter(a: any): [number, number, number] | null {
  // Most tools keep their corner/endpoint handles in data.handles.points. The
  // freehand ROI's outline lives in data.contour.polyline instead (handles.points
  // stays empty for it) — fall back to averaging that when handles are empty.
  const pts = (a?.data?.handles?.points?.length
    ? a.data.handles.points
    : a?.data?.contour?.polyline) as number[][] | undefined;
  if (!pts?.length) return null;
  const c: [number, number, number] = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
}

function toSummary(a: any): MeasurementSummary {
  return {
    uid: String(a.annotationUID),
    tool: String(a?.metadata?.toolName ?? ""),
    label: String(a?.data?.label ?? ""),
    value: formatAnnotationValue(a),
    center: annotationCenter(a),
  };
}

export function getMeasurementSummaries(): MeasurementSummary[] {
  try {
    const all = annotation.state.getAllAnnotations() ?? [];
    const names = MEASUREMENT_TOOL_NAMES as readonly string[];
    return (all as any[])
      .filter((a) => a?.annotationUID && names.includes(a?.metadata?.toolName))
      .map(toSummary);
  } catch {
    return [];
  }
}

export function renameMeasurement(uid: string, label: string) {
  const a = annotation.state.getAnnotation(uid) as any;
  if (!a?.data) return;
  a.data.label = label;
  currentRenderingEngine?.render();
}

export function removeMeasurement(uid: string) {
  try { annotation.state.removeAnnotation(uid); } catch { /* already gone */ }
  currentRenderingEngine?.render();
}

// Moves the crosshair to the annotation and returns the target (so the caller
// can also sync its own crosshair state / the 3D view).
export function jumpToMeasurement(uid: string): [number, number, number] | null {
  const a = annotation.state.getAnnotation(uid) as any;
  const c = annotationCenter(a);
  if (!c) return null;
  moveCornerstoneCrosshairToMm(c);
  currentRenderingEngine?.render();
  return c;
}

// ---------------------------------------------------------------------------
// Cine playback — auto-scroll one MPR pane through its slices at a fixed frame
// rate. Hand-rolled with a plain setInterval + viewport.scroll(), NOT
// cornerstoneTools.utilities.cine.playClip: that utility resolves which
// volume to scroll via an internal "smallest spacing" heuristic across every
// actor on the viewport when no volumeId is given, and its own volume-viewport
// play path never passes one — with both the CT volume AND the segmentation
// labelmap attached to each pane, that heuristic can pick the wrong actor (or
// one with a degenerate slice range), so nothing visibly moves.
// viewport.scroll(delta) sidesteps this entirely: it resolves the volume via
// viewport.getVolumeId() (the same thing StackScrollTool does for wheel-driven
// scrolling), so it's guaranteed to move the actual displayed CT.
// ---------------------------------------------------------------------------

export type CinePane = "axial" | "sagittal" | "coronal";
export const CINE_VIEWPORT_BY_PANE: Record<CinePane, string> = {
  axial: viewportId1,
  sagittal: viewportId2,
  coronal: viewportId3,
};

// Every per-pane MPR operation (cine, flip, rotate, slice tracking) needs the same cast:
// IViewport (what getViewport() is typed to return) only exposes the narrower base
// Viewport surface, but the concrete object is a BaseVolumeViewport where all of this is
// genuinely present at runtime — same rationale as getCrosshairMm's toolCenter cast
// elsewhere in this file.
type MprViewport = {
  element: HTMLDivElement;
  scroll(delta?: number): void;
  getNumberOfSlices(): number;
  getSliceIndex(): number;
  flip(flipDirection: { flipHorizontal?: boolean; flipVertical?: boolean }): void;
  getRotation(): number;
  setRotation(rotation: number): void;
  render(): void;
};

function _getMprViewport(pane: CinePane): MprViewport | undefined {
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return undefined;
  return engine.getViewport(CINE_VIEWPORT_BY_PANE[pane]) as unknown as MprViewport | undefined;
}

let _cineIntervalId: number | null = null;

export function startCine(pane: CinePane, fps = 12): boolean {
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return false;
  stopCine(); // one clip at a time
  try {
    const viewport = _getMprViewport(pane);
    if (!viewport) return false;
    const numSlices = viewport.getNumberOfSlices();
    if (!numSlices || numSlices < 2) return false;
    const clampedFps = Math.max(1, Math.min(100, fps));
    _cineIntervalId = window.setInterval(() => {
      // Loop back to the first slice once past the last — viewport.scroll clamps
      // rather than wraps, so a step past the end needs an explicit jump to 0.
      const current = viewport.getSliceIndex();
      viewport.scroll(current >= numSlices - 1 ? -current : 1);
    }, 1000 / clampedFps);
    return true;
  } catch (e) {
    console.warn("Cine playback unavailable:", e);
    return false;
  }
}

export function stopCine() {
  if (_cineIntervalId === null) return;
  window.clearInterval(_cineIntervalId);
  _cineIntervalId = null;
}

// ---------------------------------------------------------------------------
// Per-pane flip / rotate — like Cine, these act on whichever pane is currently
// "in focus" (VisualizationPage tracks that via scroll/click and passes it in).
// ---------------------------------------------------------------------------

// Mirrors the pane left-right. flip() toggles internally (this.flipHorizontal =
// !this.flipHorizontal), so calling it again on the same pane un-flips it — the
// toggle behavior lives in Cornerstone itself, nothing to track on our side.
// It also self-renders, unlike setRotation below.
export function flipPaneHorizontal(pane: CinePane): void {
  const viewport = _getMprViewport(pane);
  if (!viewport) return;
  try {
    viewport.flip({ flipHorizontal: true });
  } catch (e) {
    console.warn(`Flip failed for pane "${pane}":`, e);
  }
}

// Rotates 90° clockwise from wherever the pane currently sits (cumulative — four
// clicks return to the start). NOTE: cornerstone's rotation-angle sign convention
// relative to "on-screen clockwise" isn't independently confirmed here — if a
// case turns out to visibly rotate counter-clockwise instead, flip the `+ 90`
// below to `- 90` (mod still needs the `+ 360` to stay positive in that case).
export function rotatePane90Clockwise(pane: CinePane): void {
  const viewport = _getMprViewport(pane);
  if (!viewport) return;
  try {
    const next = (viewport.getRotation() + 90) % 360;
    viewport.setRotation(next);
    // Unlike flip(), setRotation() only triggers a CAMERA_MODIFIED event — it
    // never calls render() itself, so without this the rotation wouldn't show
    // until some unrelated interaction happened to re-render the pane.
    viewport.render();
  } catch (e) {
    console.warn(`Rotate failed for pane "${pane}":`, e);
  }
}

// ---------------------------------------------------------------------------
// Slice tracking — drives the per-pane "245/519" caption + drag scrollbar.
// ---------------------------------------------------------------------------

export type SliceInfo = { current: number; total: number };

// Jumps a pane directly to an arbitrary slice (the scrollbar drag target), rather than
// the +1/-1 steps cine/wheel-scroll use. scroll(delta) clamps to the valid range, so an
// out-of-range index (e.g. from a stale `total`) is harmless.
export function setPaneSliceIndex(pane: CinePane, index: number): void {
  const viewport = _getMprViewport(pane);
  if (!viewport) return;
  const delta = index - viewport.getSliceIndex();
  if (delta !== 0) viewport.scroll(delta);
}

// Live slice index read directly from the viewport — use this instead of the
// (possibly one-render-stale) React `sliceInfo` state whenever you need the
// EXACT slice the user is looking at right now (e.g. marking an endpoint).
export function getCurrentSliceIndexLive(pane: CinePane): number {
  const viewport = _getMprViewport(pane);
  return viewport ? viewport.getSliceIndex() : 0;
}
// Returns the REAL volume-space through-plane index for whatever slice the pane
// is currently showing, derived from the viewport's camera focal point (world mm)
// rather than trusting viewport.getSliceIndex() to equal the raw IJK k-index —
// that assumption breaks for any volume whose direction matrix isn't identity.
export function getVolumeSliceIndexForPane(pane: CinePane): number | null {
  const engine = getRenderingEngine(renderingEngineId);
  const volume = _currentCtVolumeId ? cache.getVolume(_currentCtVolumeId) : undefined;
  if (!engine || !volume?.imageData) return null;
  const viewport = engine.getViewport(CINE_VIEWPORT_BY_PANE[pane]) as any;
  if (!viewport) return null;
  try {
    const camera = viewport.getCamera();
    const focal = camera.focalPoint as number[];
    const ijk = volume.imageData.worldToIndex(focal).map((v: number) => Math.round(v));
    const axis = _sliceAxisForPane(pane);
    return ijk[axis];
  } catch {
    return null;
  }
}
// Fires `cb` once immediately per pane (so the caller has an initial reading) and again
// on every CAMERA_MODIFIED where the slice index actually changed — pan/zoom/rotate also
// fire that event, so each pane's last-seen index is compared to avoid spamming the
// caller (and the React state it likely feeds) on every unrelated camera tweak. Returns
// an unsubscribe function; call it before the volume/tool group is torn down (case
// switch, HD reload) since the viewport elements go with it.
export function subscribeToSliceChanges(cb: (pane: CinePane, info: SliceInfo) => void): () => void {
  const panes = Object.keys(CINE_VIEWPORT_BY_PANE) as CinePane[];
  const cleanups: (() => void)[] = [];
  for (const pane of panes) {
    const viewport = _getMprViewport(pane);
    if (!viewport) continue;
    let lastIndex = viewport.getSliceIndex();
    cb(pane, { current: lastIndex, total: viewport.getNumberOfSlices() });
    const handler = () => {
      const current = viewport.getSliceIndex();
      if (current === lastIndex) return;
      lastIndex = current;
      cb(pane, { current, total: viewport.getNumberOfSlices() });
    };
    viewport.element.addEventListener(Enums.Events.CAMERA_MODIFIED, handler);
    cleanups.push(() => viewport.element.removeEventListener(Enums.Events.CAMERA_MODIFIED, handler));
  }
  return () => cleanups.forEach((fn) => fn());
}

// Undo any oblique-plane rotation / slab thickness back to standard orthogonal
// axial/sagittal/coronal (the crosshair's rotation handles create oblique planes;
// this is the way back). Also recenters and resets zoom/pan on all three panes.
export function resetMprOrientation() {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  const tool = toolGroup?.getToolInstance(CrosshairsTool.toolName) as
    | { resetCrosshairs?: () => void }
    | undefined;
  try {
    tool?.resetCrosshairs?.();
  } catch {
    /* crosshair tool not active/ready */
  }
  currentRenderingEngine?.render();
}

export type MeasurementChangeKind = "completed" | "modified" | "removed";

// Fires for measurement annotations only (crosshair events are filtered out).
export function subscribeToMeasurementChanges(
  cb: (kind: MeasurementChangeKind, summary: MeasurementSummary) => void
): () => void {
  const names = MEASUREMENT_TOOL_NAMES as readonly string[];
  const make = (kind: MeasurementChangeKind) => (evt: Event) => {
    const a = (evt as CustomEvent).detail?.annotation;
    if (!a?.annotationUID || !names.includes(a?.metadata?.toolName)) return;
    cb(kind, toSummary(a));
  };
  const pairs: [string, EventListener][] = [
    [cornerstoneTools.Enums.Events.ANNOTATION_COMPLETED, make("completed") as EventListener],
    [cornerstoneTools.Enums.Events.ANNOTATION_MODIFIED, make("modified") as EventListener],
    [cornerstoneTools.Enums.Events.ANNOTATION_REMOVED, make("removed") as EventListener],
  ];
  for (const [name, handler] of pairs) eventTarget.addEventListener(name, handler);
  return () => {
    for (const [name, handler] of pairs) eventTarget.removeEventListener(name, handler);
  };
}

// ---------------------------------------------------------------------------
// Viewport screenshots — used by the reading session (auto key images) and the
// toolbar snapshot button. Annotations/reference lines live on an SVG overlay,
// not the WebGL-backed canvas, so each shot composites canvas + rasterized SVG.
// ---------------------------------------------------------------------------

export type ViewportImage = { name: string; dataUrl: string };

export async function captureViewportImages(): Promise<ViewportImage[]> {
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return [];
  const names: Record<string, string> = {
    [viewportId1]: "axial",
    [viewportId2]: "sagittal",
    [viewportId3]: "coronal",
  };
  const out: ViewportImage[] = [];
  for (const viewportId of [viewportId1, viewportId2, viewportId3]) {
    try {
      const viewport = engine.getViewport(viewportId) as any;
      const canvas: HTMLCanvasElement | undefined = viewport?.canvas;
      const element: HTMLElement | undefined = viewport?.element;
      // offsetParent is null for display:none panes (single-view modes) — skip them.
      if (!canvas || !canvas.width || !element || element.offsetParent === null) continue;
      const composite = document.createElement("canvas");
      composite.width = canvas.width;
      composite.height = canvas.height;
      const ctx = composite.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, composite.width, composite.height);
      ctx.drawImage(canvas, 0, 0);
      const svg = element.querySelector("svg");
      if (svg) {
        const clone = svg.cloneNode(true) as SVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        // The overlay is sized in CSS pixels; give the clone explicit dimensions so
        // the rasterizer knows them, then scale to the canvas's device pixels.
        clone.setAttribute("width", String(canvas.clientWidth || canvas.width));
        clone.setAttribute("height", String(canvas.clientHeight || canvas.height));
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // shot is still useful without the overlay
          img.src =
            "data:image/svg+xml;charset=utf-8," +
            encodeURIComponent(new XMLSerializer().serializeToString(clone));
        });
        if (img.width) ctx.drawImage(img, 0, 0, composite.width, composite.height);
      }
      out.push({ name: names[viewportId], dataUrl: composite.toDataURL("image/png") });
    } catch {
      /* viewport not ready — skip this pane */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Progressive resolution upgrade — stream the full-res CT in the background
// and hot-swap it into the MPR viewports without a page reload. Cameras are
// preserved; the labelmap representation must be rebuilt because setVolumes
// replaces every volume actor on the viewport.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- optional cornerstone APIs probed at runtime */
async function _rebuildSegmentationRepresentations() {
  if (!_lastColorLUT || !cache.getVolume(segmentationId)) return;
  for (const viewportId of MPR_VIEWPORT_IDS) {
    try {
      // Drop the (now actor-less) representation entry first so re-adding isn't a no-op.
      (segmentation as any).removeSegmentationRepresentations?.(viewportId, {
        segmentationId,
        type: csToolsEnums.SegmentationRepresentations.Labelmap,
      });
    } catch {
      /* nothing to remove */
    }
    await segmentation.addSegmentationRepresentations(viewportId, [
      {
        segmentationId,
        type: csToolsEnums.SegmentationRepresentations.Labelmap,
        config: { colorLUTOrIndex: _lastColorLUT },
      },
    ]);
    segmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
  }
}

/**
 * Load the given full-res CT and swap it into every viewport in place.
 * Returns the new volumeId, or null on failure (caller keeps the current
 * volume — nothing is torn down until the new one is fully loaded).
 */
export async function upgradeCtVolume(fullResCtUrl: string): Promise<string | null> {
  const engine = currentRenderingEngine;
  if (!engine) return null;
  try {
    const imageIds = await createNiftiImageIdsAndCacheMetadata({ url: fullResCtUrl });
    const newVolumeId = `ctVolume-hd-${Date.now()}`;
    const volume = await volumeLoader.createAndCacheVolume(newVolumeId, { imageIds });
    await volume.load();

    // Preserve each pane's camera so the swap is visually seamless.
    const cameras = new Map<string, unknown>();
    for (const viewportId of MPR_VIEWPORT_IDS) {
      try {
        cameras.set(viewportId, engine.getViewport(viewportId).getCamera());
      } catch {
        /* viewport gone — skip */
      }
    }
    await setVolumesForViewports(engine, [{ volumeId: newVolumeId }], MPR_VIEWPORT_IDS);
    for (const viewportId of MPR_VIEWPORT_IDS) {
      const camera = cameras.get(viewportId);
      if (!camera) continue;
      try {
        engine.getViewport(viewportId).setCamera(camera as never);
      } catch {
        /* keep the reset camera */
      }
    }
    await _rebuildSegmentationRepresentations();

    // The shaded 3D volume view renders its own private copy of the CT (never the
    // shared volume — see _volume3DCopyId), so there is nothing to re-target here.
    // If it's open it keeps its current copy; the next open copies the new volume.

    _currentCtVolumeId = newVolumeId;
    engine.renderViewports([...MPR_VIEWPORT_IDS]);
    return newVolumeId;
  } catch (e) {
    console.warn("Full-res upgrade failed; keeping the current volume.", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shaded GPU volume rendering ("Volume" mode in the 3D pane): ray-cast VTK.js
// rendering of the CT itself with clinical transfer-function presets, driven
// by a trackball camera. Works with or without a segmentation (local DICOM).
// ---------------------------------------------------------------------------

// Curated subset of Cornerstone's VTK presets that read well on CT.
export const VOLUME_3D_PRESETS = [
  { name: "CT-Bone", label: "Bone" },
  { name: "CT-AAA", label: "Angio" },
  { name: "CT-Chest-Contrast-Enhanced", label: "Chest" },
  { name: "CT-Lung", label: "Lung" },
  { name: "CT-Soft-Tissue", label: "Soft tissue" },
  { name: "CT-MIP", label: "MIP" },
] as const;

// MR intensities aren't Hounsfield units, so the CT transfer functions above
// render MR as an opaque slab. Cornerstone ships MR presets — the viewer offers
// these instead when the loaded volume is MR (local DICOM can be any modality).
export const VOLUME_3D_PRESETS_MR = [
  { name: "MR-Default", label: "Default" },
  { name: "MR-Angio", label: "Angio" },
  { name: "MR-MIP", label: "MIP" },
  { name: "MR-T2-Brain", label: "T2 Brain" },
] as const;

// Modality of the volume the viewer is showing (DICOM metadata; NIfTI dataset
// cases have no Modality and return undefined — they're CT by construction).
export function getCurrentVolumeModality(): string | undefined {
  if (!_currentCtVolumeId) return undefined;
  return (cache.getVolume(_currentCtVolumeId) as any)?.metadata?.Modality;
}

let _lastVolume3DPreset: string = VOLUME_3D_PRESETS[0].name;

// The 3D pane's private copy of the CT volume. A cached volume owns exactly ONE
// vtkStreamingOpenGLTexture, which stores a single GL context + texture handle —
// so a volume can only ever be rendered by ONE engine. Sharing the MPR volumeId
// with the 3D engine makes the two contexts fight over that texture: the 3D pane
// stays black (its frames were "already uploaded" — into the MPR context) and the
// next MPR render draws the CT through a foreign handle (black CT, labelmap only).
let _volume3DCopyId: string | null = null;

async function _getOrCreateVolume3DCopy(sourceVolumeId: string): Promise<string | null> {
  const copyId = `${sourceVolumeId}-vr3d`;
  if (cache.getVolume(copyId)) return copyId;
  try {
    const source = cache.getVolume(sourceVolumeId) as any;
    let scalarData = source?.voxelManager?.getCompleteScalarDataArray?.();
    if (!scalarData?.length && Array.isArray(source?.imageIds) && source.imageIds.length) {
      // DICOM (wadouri) volumes stream frames straight onto the GPU texture and can
      // drop their per-slice images from the IMAGE cache — getCompleteScalarDataArray
      // then finds no images and silently returns an EMPTY array ("Number of
      // components 0 must be 1, 3 or 4" downstream). Re-decode the slices through the
      // image loader (the parsed datasets are still cached) and assemble the buffer.
      // Sequential on purpose: don't flood the decode workers on big series.
      const [w, h] = source.dimensions;
      const sliceLen = w * h;
      const slices: any[] = [];
      for (const imageId of source.imageIds) {
        slices.push(await imageLoader.loadAndCacheImage(imageId));
      }
      const pixelsOf = (img: any) =>
        img?.voxelManager?.getScalarData?.() ?? img?.getPixelData?.();
      const first = pixelsOf(slices[0]);
      if (first?.length) {
        const Ctor = first.constructor as new (n: number) => typeof first;
        scalarData = new Ctor(sliceLen * source.dimensions[2]);
        slices.forEach((img, i) => {
          const px = pixelsOf(img);
          if (px?.length) scalarData.set(px.subarray(0, sliceLen), i * sliceLen);
        });
      }
    }
    if (!scalarData?.length) return null;
    (volumeLoader.createLocalVolume as any)(copyId, {
      metadata: source.metadata,
      dimensions: source.dimensions,
      spacing: source.spacing,
      origin: source.origin,
      direction: source.direction,
      scalarData,
    });
    return copyId;
  } catch (e) {
    console.warn("Volume rendering: could not create the 3D volume copy.", e);
    return null;
  }
}

export function applyVolume3DPreset(presetName: string) {
  _lastVolume3DPreset = presetName;
  const engine = getRenderingEngine(volume3DEngineId) as RenderingEngine | undefined;
  if (!engine) return;
  try {
    const viewport = engine.getViewport(volume3DViewportId) as any;
    viewport?.setProperties?.({ preset: presetName });
    viewport?.render?.();
  } catch {
    /* 3D view not enabled */
  }
}

// Resolve once the element has a non-zero layout size (up to ~500ms), so the
// on-screen canvas Cornerstone allocates isn't 0×0 (a classic "black 3D pane").
function _waitForLayout(element: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    let tries = 0;
    const check = () => {
      if (element.offsetWidth > 0 && element.offsetHeight > 0) return resolve(true);
      if (tries++ > 30) return resolve(element.offsetWidth > 0);
      requestAnimationFrame(check);
    };
    check();
  });
}

export async function enableVolume3D(
  element: HTMLDivElement,
  presetName: string = _lastVolume3DPreset
): Promise<boolean> {
  if (!_currentCtVolumeId || !cache.getVolume(_currentCtVolumeId)) return false;
  try {
    try {
      cornerstoneTools.addTool(TrackballRotateTool);
    } catch {
      /* already registered */
    }
    await _waitForLayout(element);

    // Never hand the MPR volume to this engine — render a private copy with its
    // own GL texture (see the note by _volume3DCopyId).
    const copyId = await _getOrCreateVolume3DCopy(_currentCtVolumeId);
    if (!copyId) return false;
    _volume3DCopyId = copyId;

    // Dedicated engine — never share the MPR engine (see the note by its id).
    const engine = _getVolume3DEngine();
    engine.enableElement({
      viewportId: volume3DViewportId,
      type: Enums.ViewportType.VOLUME_3D,
      element,
      defaultOptions: {
        orientation: Enums.OrientationAxis.CORONAL,
        background: [0.03, 0.035, 0.043],
      },
    });
    const viewport = engine.getViewport(volume3DViewportId) as any;
    // Canonical VOLUME_3D recipe: attach the volume, THEN the preset (setPreset
    // no-ops if the volume actor isn't present yet), then frame + render.
    await viewport.setVolumes([{ volumeId: copyId }]);
    viewport.setProperties({ preset: presetName });
    _lastVolume3DPreset = presetName;
    // Match the on-screen canvas to the (now laid-out) element before framing.
    engine.resize(true, false);
    viewport.resetCamera();
    viewport.render();

    // If no volume actor attached, ray casting will just show black — report
    // failure so the UI can fall back to a message instead of a blank pane.
    const actorCount = viewport.getActors?.().length ?? 0;
    if (actorCount === 0) {
      console.warn("Volume rendering: no volume actor attached.");
      return false;
    }

    ToolGroupManager.destroyToolGroup(volume3DToolGroupId); // stale viewport ref from a prior open
    const toolGroup = ToolGroupManager.createToolGroup(volume3DToolGroupId);
    if (!toolGroup) return false;
    toolGroup.addTool(TrackballRotateTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.setToolActive(TrackballRotateTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
    toolGroup.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],
    });
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Auxiliary }],
    });
    toolGroup.addViewport(volume3DViewportId, volume3DEngineId);
    viewport.render();
    return true;
  } catch (e) {
    console.warn("Volume rendering unavailable:", e);
    return false;
  }
}

export function disableVolume3D() {
  try {
    ToolGroupManager.destroyToolGroup(volume3DToolGroupId);
  } catch {
    /* tool group already gone */
  }
  // Destroy the whole dedicated engine so its canvas/GL context is released and
  // the next open starts clean. This can't touch the MPR engine.
  try {
    (getRenderingEngine(volume3DEngineId) as RenderingEngine | undefined)?.destroy();
  } catch {
    /* engine already gone */
  }
  // Free the private CT copy (CPU + GPU); reopening the pane rebuilds it.
  // createLocalVolume backs the copy with PER-SLICE images in the IMAGE cache
  // (`<copyId>_slice_<i>`), and removeVolumeLoadObject only deletes the volume
  // entry — it leaves those slice images allocated. Without freeing them too,
  // every Meshes→Volume round trip leaks a full CT copy until the next
  // createLocalVolume fails its cache-size check and the pane reports "volume
  // rendering isn't available" even though the GPU is fine.
  try {
    if (_volume3DCopyId) {
      const copyVolume = cache.getVolume(_volume3DCopyId);
      const sliceImageIds: string[] = copyVolume?.imageIds ?? [];
      cache.removeVolumeLoadObject(_volume3DCopyId);
      for (const imageId of sliceImageIds) {
        try {
          cache.removeImageLoadObject(imageId, { force: true });
        } catch {
          /* slice already evicted */
        }
      }
    }
  } catch {
    /* already evicted */
  }
  _volume3DCopyId = null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function setZoom(zoomValue: number){
  const engine = getRenderingEngine(renderingEngineId);
  [viewportId1, viewportId2, viewportId3].forEach((viewportId) => {
      if (engine){
        const viewport = engine.getViewport(viewportId);
        viewport.setZoom(zoomValue);
        viewport.render();
      }
    })
}
export function zoomToCursor(
  viewportId: string,
  canvasPos: [number, number],
  zoomFactor: number
) {
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return;
  const viewport = engine.getViewport(viewportId) as any;
  if (!viewport) return;

  const worldPosBefore = viewport.canvasToWorld(canvasPos);

  const currentZoom = viewport.getZoom();
  viewport.setZoom(currentZoom * zoomFactor);

  const worldPosAfter = viewport.canvasToWorld(canvasPos);

  const delta = [
    worldPosBefore[0] - worldPosAfter[0],
    worldPosBefore[1] - worldPosAfter[1],
    worldPosBefore[2] - worldPosAfter[2],
  ];

  const camera = viewport.getCamera();
  viewport.setCamera({
    ...camera,
    focalPoint: [
      camera.focalPoint[0] + delta[0],
      camera.focalPoint[1] + delta[1],
      camera.focalPoint[2] + delta[2],
    ],
    position: [
      camera.position[0] + delta[0],
      camera.position[1] + delta[1],
      camera.position[2] + delta[2],
    ],
  });

  viewport.render();
}
export function zoomToFit() {
  const engine = getRenderingEngine(renderingEngineId);
  [viewportId1, viewportId2, viewportId3].forEach((viewportId) => {
      if (engine){
        const viewport = engine.getViewport(viewportId);
        viewport.resetCamera({
            resetPan: true,
            resetZoom: true
        });
        viewport.render();
      }
    })
}

export function centerOnCursor(){
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return;
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  const toolCenter = toolGroup.getToolInstance(CrosshairsTool.toolName).toolCenter;
  [viewportId1, viewportId2, viewportId3].forEach((viewportId) => {
    const viewport = engine.getViewport(viewportId);
    viewport.setViewReference({
    FrameOfReferenceUID: "1.2.840.10008.1.4",
    cameraFocalPoint: toolCenter
    })
    // if (viewportId == "CT_NIFTI_CORONAL"){
    //   viewport.setPan([-toolCenter[1], toolCenter[2]]);
    // }
    // if (viewportId == "CT_NIFTI_SAGITTAL"){
    //   viewport.setPan([toolCenter[2], toolCenter[0]]);
    // }
    viewport.render();
    })
}

export function getOrganLabelOnClick() {
    const engine = getRenderingEngine(renderingEngineId);
    if (!engine) return;
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;
    const toolActive = toolGroup.getToolInstance(CrosshairsTool.toolName).mode;
    if (toolActive !== csToolsEnums.ToolModes.Active) return;
    const volume = cache.getVolume(segmentationId);
    if (!volume || !volume.voxelManager) return;
    const indices = [viewportId2, viewportId3, viewportId1].map((viewportId) => {
      const viewport = engine.getViewport(viewportId);
      const idx = viewport.getSliceIndex();
    //   if (viewportId === viewportId1) {
    //       return volume.voxelManager.dimensions[2] - idx;
    //   }
      return idx;
    })

    // volume.voxelManager.forEach(({value, index, pointIJK}) => {
    //     if (value === 14) {
    //         console.log(pointIJK);
    //     }
    // })
    const idx = volume.voxelManager.getAtIJK(indices[0], indices[1], indices[2]);
    return idx;
}

// Hover variant of getOrganLabelOnClick: resolves the segment label under an arbitrary
// screen point in one pane, via canvasToWorld → worldToIndex on that pane's own volume
// geometry. Unlike the click path, this never touches the crosshair (no repositioning
// side effect), which is what makes it safe to call on every mousemove for the
// "hover to identify" tool.
export function getOrganLabelAtPoint(pane: CinePane, clientX: number, clientY: number): number | undefined {
    const engine = getRenderingEngine(renderingEngineId);
    if (!engine) return undefined;
    const viewport = engine.getViewport(CINE_VIEWPORT_BY_PANE[pane]) as unknown as
        | { getCanvas(): HTMLCanvasElement; canvasToWorld(canvasPos: Point2): Point3 }
        | undefined;
    if (!viewport) return undefined;
    const volume = cache.getVolume(segmentationId);
    if (!volume || !volume.voxelManager || !volume.imageData) return undefined;

    let canvas: HTMLCanvasElement;
    try {
        canvas = viewport.getCanvas();
    } catch {
        return undefined;
    }
    const rect = canvas.getBoundingClientRect();
    const canvasPos: Point2 = [clientX - rect.left, clientY - rect.top];
    if (canvasPos[0] < 0 || canvasPos[1] < 0 || canvasPos[0] > rect.width || canvasPos[1] > rect.height) {
        return undefined;
    }

    let world: Point3;
    try {
        world = viewport.canvasToWorld(canvasPos);
    } catch {
        return undefined;
    }

    const [i, j, k] = volume.imageData.worldToIndex(world).map((v: number) => Math.round(v));
    const [dimX, dimY, dimZ] = volume.voxelManager.dimensions;
    if (i < 0 || j < 0 || k < 0 || i >= dimX || j >= dimY || k >= dimZ) return undefined;
    const res = volume.voxelManager.getAtIJK(i, j, k);
    // make sure res is not RGB
    if (typeof res === "number") return res;
}

// Centroid (world mm) of every segment label, from one pass over the labelmap. Cached for
// the loaded case (reset in renderVisualization). Lets the UI jump the crosshair to an
// organ. Returns null until the segmentation volume is available.
let _organCentroids: Record<number, [number, number, number]> | null = null;

export function getOrganCentroids(): Record<number, [number, number, number]> | null {
    if (_organCentroids) return _organCentroids;
    const volume = cache.getVolume(segmentationId);
    const vm = volume?.voxelManager;
    if (!volume || !vm) return null;

    const [dimX, dimY] = vm.dimensions;
    const sliceSize = dimX * dimY;
    // Sum voxel indices (and count) per label, so we can take the mean = centroid.
    const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
    const add = (label: number, i: number, j: number, k: number) => {
        if (!label) return; // skip background (0)
        let s = sums.get(label);
        if (!s) { s = { x: 0, y: 0, z: 0, n: 0 }; sums.set(label, s); }
        s.x += i; s.y += j; s.z += k; s.n++;
    };

    // The segmentation is image-backed, so getScalarData() may not hold one contiguous
    // array. Prefer getCompleteScalarDataArray() (assembles the full volume), and fall back
    // to forEach (which hands us IJK per voxel) if it isn't available.
    let data: ArrayLike<number> | undefined;
    try { data = vm.getCompleteScalarDataArray?.(); } catch { /* fall through */ }
    if (data && data.length) {
        for (let idx = 0; idx < data.length; idx++) {
            const label = data[idx];
            if (!label) continue;
            const k = (idx / sliceSize) | 0;
            const rem = idx - k * sliceSize;
            const j = (rem / dimX) | 0;
            add(label, rem - j * dimX, j, k);
        }
    } else {
        vm.forEach((voxel) =>
            add(Number(voxel.value), voxel.pointIJK[0], voxel.pointIJK[1], voxel.pointIJK[2])
        );
    }

    const out: Record<number, [number, number, number]> = {};
    for (const [label, s] of sums) {
        // Mean voxel index → world mm via the volume's geometry (handles spacing/affine).
        // indexToWorld returns the point (it doesn't reliably fill an out-param).
        const w = volume.imageData?.indexToWorld([s.x / s.n, s.y / s.n, s.z / s.n]);
        if (w) out[label] = [w[0], w[1], w[2]];
    }
    _organCentroids = out;
    return out;
}



// Live client side mesh extraction for custom classes created during annotation
// Marching cube runs directly on the in-memory label map (no server involvement)

export type LiveMeshResult = {
  positions: Float32Array; 
  indices: Uint32Array;
};

function _buildBinaryMask(segmentIndex: number): { mask: Uint8Array; dims: [number, number, number] } | null {
  const volume = cache.getVolume(segmentationId);
  const vm = volume?.voxelManager;
  if (!volume || !vm) return null;
  let data: ArrayLike<number> | undefined;
  try {
    data = vm.getCompleteScalarDataArray?.();
  } catch {
    return null;
  }
  if (!data || !data.length) return null;
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = data[i] === segmentIndex ? 1 : 0;
  return { mask, dims: vm.dimensions as [number, number, number] };
}

function _padVolume(mask: Uint8Array, dims: [number, number, number]) {
  const [nx, ny, nz] = dims;
  const pnx = nx + 2, pny = ny + 2, pnz = nz + 2;
  const padded = new Uint8Array(pnx * pny * pnz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const src = i + j * nx + k * nx * ny;
        if (!mask[src]) continue;
        const dst = (i + 1) + (j + 1) * pnx + (k + 1) * pnx * pny;
        padded[dst] = 1;
      }
    }
  }
  return { padded, pdims: [pnx, pny, pnz] as [number, number, number] };
}

function _runMarchingCubes(padded: Uint8Array, pdims: [number, number, number]) {
  const imageData = vtkImageData.newInstance();
  imageData.setDimensions(pdims as unknown as [number, number, number]);
  imageData.setSpacing([1, 1, 1]);
  imageData.setOrigin([0, 0, 0]);
  const scalars = vtkDataArray.newInstance({
    name: "scalars",
    values: padded,
    numberOfComponents: 1,
  });
  imageData.getPointData().setScalars(scalars);

  const mc = vtkImageMarchingCubes.newInstance({ contourValue: 0.5, computeNormals: false, mergePoints: false });
  mc.setInputData(imageData);
  const output = mc.getOutputData();
  const points = output.getPoints().getData() as Float32Array;
  const polys = output.getPolys().getData() as Uint32Array;
  return { points, polys };
}

function _vtkPolysToIndices(polys: Uint32Array): Uint32Array {
  const indices: number[] = [];
  let p = 0;
  while (p < polys.length) {
    const n = polys[p++];
    for (let c = 0; c < n; c++) indices.push(polys[p++]);
  }
  return new Uint32Array(indices);
}


function _transformVertices(
  points: Float32Array,
  origin: number[],
  spacing: number[],
  direction: number[],
  manifestCenter: [number, number, number]
): Float32Array {
  const out = new Float32Array(points.length);
  const flip = [-1, -1, 1];

  for (let v = 0; v < points.length; v += 3) {
    const i = points[v] - 1;
    const j = points[v + 1] - 1;
    const k = points[v + 2] - 1;

    const lpsX = direction[0] * i * spacing[0] + direction[3] * j * spacing[1] + direction[6] * k * spacing[2] + origin[0];
    const lpsY = direction[1] * i * spacing[0] + direction[4] * j * spacing[1] + direction[7] * k * spacing[2] + origin[1];
    const lpsZ = direction[2] * i * spacing[0] + direction[5] * j * spacing[1] + direction[8] * k * spacing[2] + origin[2];

    const rasX = lpsX * flip[0];
    const rasY = lpsY * flip[1];
    const rasZ = lpsZ * flip[2];

    const threeX = rasX;
    const threeY = rasZ;
    const threeZ = -rasY;

    out[v] = threeX - manifestCenter[0];
    out[v + 1] = threeY - manifestCenter[1];
    out[v + 2] = threeZ - manifestCenter[2];
  }
  return out;
}
// ============================================================================
// SECTION: Threshold Fill (Dual-Scribble)
// ============================================================================

// ---------------------------------------------------------------------------
// Dual-scribble threshold fill: mark a point (or short stroke) inside the
// target structure ("foreground") and one outside it in whatever you want
// excluded ("background"). Computes a separating HU threshold from the two,
// then flood-fills in 3D from the foreground seeds, stopping at that
// threshold, the seeds' bounding box, and any other segment's voxels.
// ---------------------------------------------------------------------------

export type DualFillOptions = {
  connectivity?: 6 | 26;
  maxVoxels?: number;
  boundingBoxMargin?: number;
  respectOtherLabels?: boolean;
  sliceLock?: { pane: CinePane } | null; // restrict the fill to the seeds' own slice
};

export function runDualScribbleFill(
  foregroundSeeds: Array<[number, number, number]>,
  backgroundSeeds: Array<[number, number, number]>,
  options: DualFillOptions = {}
): { filledVoxels: number } | null {
  const {
    connectivity = 6,
    maxVoxels = 2_000_000,
    boundingBoxMargin = 30,
    respectOtherLabels = false, // was true — smart fill now overwrites like the brush does
    sliceLock = null,
  } = options;

  if (!foregroundSeeds.length || !backgroundSeeds.length) {
    console.warn("Smart fill needs both an inside and an outside scribble.");
    return null;
  }

  const ctVolume = _currentCtVolumeId ? cache.getVolume(_currentCtVolumeId) : undefined;
  const segVolume = cache.getVolume(segmentationId);
  if (!ctVolume || !segVolume) return null;

  const ctVm = ctVolume.voxelManager as any;
  const segVm = segVolume.voxelManager as any;
  if (!ctVm || !segVm) return null;

  const [dimX, dimY, dimZ] = ctVm.dimensions;
  let ctData: ArrayLike<number> | undefined;
  try { ctData = ctVm.getCompleteScalarDataArray?.(); } catch { /* fall through */ }
  if (!ctData || !ctData.length) return null;

  const sliceSize = dimX * dimY;
  const idxOf = (i: number, j: number, k: number) => i + j * dimX + k * sliceSize;
  const inBounds = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < dimX && j < dimY && k < dimZ;

  const fgValid = foregroundSeeds.filter(([i, j, k]) => inBounds(i, j, k));
  const bgValid = backgroundSeeds.filter(([i, j, k]) => inBounds(i, j, k));
  if (!fgValid.length || !bgValid.length) return null;

  const fgStats = _huStats(ctData, idxOf, fgValid);
  const bgStats = _huStats(ctData, idxOf, bgValid);
  const fgIsBrighter = fgStats.mean >= bgStats.mean;
  const threshold = (fgStats.mean + bgStats.mean) / 2;
  const passes = (hu: number) => (fgIsBrighter ? hu >= threshold : hu <= threshold);

  let bi0 = dimX, bi1 = -1, bj0 = dimY, bj1 = -1, bk0 = dimZ, bk1 = -1;
  for (const [i, j, k] of [...fgValid, ...bgValid]) {
    bi0 = Math.min(bi0, i); bi1 = Math.max(bi1, i);
    bj0 = Math.min(bj0, j); bj1 = Math.max(bj1, j);
    bk0 = Math.min(bk0, k); bk1 = Math.max(bk1, k);
  }
  bi0 = Math.max(0, bi0 - boundingBoxMargin);
  bj0 = Math.max(0, bj0 - boundingBoxMargin);
  bk0 = Math.max(0, bk0 - boundingBoxMargin);
  bi1 = Math.min(dimX - 1, bi1 + boundingBoxMargin);
  bj1 = Math.min(dimY - 1, bj1 + boundingBoxMargin);
  bk1 = Math.min(dimZ - 1, bk1 + boundingBoxMargin);

  let lockAxis: 0 | 1 | 2 | null = null;
  if (sliceLock) {
    lockAxis = _sliceAxisForPane(sliceLock.pane);
    const sliceVal = lockAxis === 0 ? fgValid[0][0] : lockAxis === 1 ? fgValid[0][1] : fgValid[0][2];
    if (lockAxis === 0) { bi0 = bi1 = sliceVal; }
    else if (lockAxis === 1) { bj0 = bj1 = sliceVal; }
    else { bk0 = bk1 = sliceVal; }
  }

  const activeSegment = _activeEditSegment;
  const offsets6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const offsets26: number[][] = [];
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++)
      for (let dk = -1; dk <= 1; dk++)
        if (di || dj || dk) offsets26.push([di, dj, dk]);
  const baseOffsets = connectivity === 6 ? offsets6 : offsets26;
  const offsets = lockAxis !== null ? _filterOffsetsAxis(baseOffsets, lockAxis) : baseOffsets;

  const visited = new Set<number>();
  const stack: number[] = [];
  for (const [i, j, k] of fgValid) {
    if (i < bi0 || i > bi1 || j < bj0 || j > bj1 || k < bk0 || k > bk1) continue;
    const lin = idxOf(i, j, k);
    if (!visited.has(lin)) { visited.add(lin); stack.push(lin); }
  }

  const touched: Array<{ i: number; j: number; k: number; prev: number }> = [];

  while (stack.length) {
    const lin = stack.pop()!;
    const k = Math.floor(lin / sliceSize);
    const rem = lin - k * sliceSize;
    const j = Math.floor(rem / dimX);
    const i = rem - j * dimX;

    if (!passes(ctData[lin])) continue;

    const existing: number = segVm.getAtIJK(i, j, k);
    if (respectOtherLabels && existing !== 0 && existing !== activeSegment) continue;
    if (existing !== activeSegment) {
      touched.push({ i, j, k, prev: existing });
      segVm.setAtIJK(i, j, k, activeSegment);
    }

    if (touched.length > maxVoxels) {
      console.warn("Smart fill: hit voxel safety cap, stopping early.");
      break;
    }

    for (const [di, dj, dk] of offsets) {
      const ni = i + di, nj = j + dj, nk = k + dk;
      if (ni < bi0 || ni > bi1 || nj < bj0 || nj > bj1 || nk < bk0 || nk > bk1) continue;
      const nlin = idxOf(ni, nj, nk);
      if (!visited.has(nlin)) { visited.add(nlin); stack.push(nlin); }
    }
  }

  if (!touched.length) return { filledVoxels: 0 };

  _pushFillHistory({
    undo: () => { for (const { i, j, k, prev } of touched) segVm.setAtIJK(i, j, k, prev); _notifySegmentationChanged(); },
    redo: () => { for (const { i, j, k } of touched) segVm.setAtIJK(i, j, k, activeSegment); _notifySegmentationChanged(); },
  });

  _notifySegmentationChanged();
  return { filledVoxels: touched.length };
}

function _huStats(ctData: ArrayLike<number>, idxOf: (i: number, j: number, k: number) => number, seeds: [number, number, number][]) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const [i, j, k] of seeds) {
    const v = ctData[idxOf(i, j, k)];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / seeds.length };
}

function _notifySegmentationChanged() {
  try {
    // This is what BrushTool's own strategies call after painting — it invalidates the
    // labelmap's cached GPU texture so the 2D volume viewports actually repaint the new
    // voxels. Direct voxelManager writes (smart fill, box prompt, live-wire, morphology,
    // boolean ops, copy-across-slices, CPR paint, etc.) bypass the brush pipeline entirely,
    // so without this call, edits land in the raw array — visible to a fresh marching-cubes
    // pass (3D) — but never make it to the 2D panes' GPU texture.
    (cornerstoneTools as any).utilities?.segmentation?.triggerSegmentationDataModified?.(segmentationId);
  } catch {
    /* fall through to the plain event dispatch below */
  }
  eventTarget.dispatchEvent(
    new CustomEvent(csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED, { detail: { segmentationId } })
  );
  currentRenderingEngine?.renderViewports([...MPR_VIEWPORT_IDS]);
  currentRenderingEngine?.render();
}

// ============================================================================
// SECTION: Undo / Redo History 
// ============================================================================


type FillHistoryEntry = { undo: () => void; redo: () => void };
let _fillHistory: FillHistoryEntry[] = [];
let _fillHistoryIndex = -1;

function _pushFillHistory(entry: FillHistoryEntry) {
  _fillHistory = _fillHistory.slice(0, _fillHistoryIndex + 1);
  _fillHistory.push(entry);
  _fillHistoryIndex = _fillHistory.length - 1;
}

export function undoSmartFill(): boolean {
  if (_fillHistoryIndex < 0) return false;
  _fillHistory[_fillHistoryIndex].undo();
  _fillHistoryIndex--;
  return true;
}

export function redoSmartFill(): boolean {
  if (_fillHistoryIndex + 1 >= _fillHistory.length) return false;
  _fillHistoryIndex++;
  _fillHistory[_fillHistoryIndex].redo();
  return true;
}

export function canUndoSmartFill(): boolean { return _fillHistoryIndex >= 0; }
export function canRedoSmartFill(): boolean { return _fillHistoryIndex + 1 < _fillHistory.length; }

// ============================================================================
// SECTION: Canvas / Voxel Coordinate Helpers
// ============================================================================

export function canvasPointToVoxel(pane: CinePane, canvasPos: Point2): [number, number, number] | null {
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return null;
  const viewport = engine.getViewport(CINE_VIEWPORT_BY_PANE[pane]) as any;
  const volume = _currentCtVolumeId ? cache.getVolume(_currentCtVolumeId) : undefined;
  if (!viewport || !volume?.imageData) return null;
  try {
    const world = viewport.canvasToWorld(canvasPos);
    const [i, j, k] = volume.imageData.worldToIndex(world).map((v: number) => Math.round(v));
    return [i, j, k];
  } catch {
    return null;
  }
}
function _sliceAxisForPane(pane: CinePane): 0 | 1 | 2 {
  return pane === "sagittal" ? 0 : pane === "coronal" ? 1 : 2;
}

// ============================================================================
// SECTION: Morphology (Erode / Dilate)
// ============================================================================

function _segBBox(vm: any, segmentIndex: number, margin: number) {
  const [dimX, dimY, dimZ] = vm.dimensions;
  let data: ArrayLike<number> | undefined;
  try { data = vm.getCompleteScalarDataArray?.(); } catch { /* fall through */ }
  if (!data || !data.length) return null;
  const sliceSize = dimX * dimY;
  let i0 = dimX, i1 = -1, j0 = dimY, j1 = -1, k0 = dimZ, k1 = -1;
  for (let idx = 0; idx < data.length; idx++) {
    if (data[idx] !== segmentIndex) continue;
    const k = (idx / sliceSize) | 0;
    const rem = idx - k * sliceSize;
    const j = (rem / dimX) | 0;
    const i = rem - j * dimX;
    if (i < i0) i0 = i; if (i > i1) i1 = i;
    if (j < j0) j0 = j; if (j > j1) j1 = j;
    if (k < k0) k0 = k; if (k > k1) k1 = k;
  }
  if (i1 < 0) return null; // segment is empty
  return {
    i0: Math.max(0, i0 - margin), i1: Math.min(dimX - 1, i1 + margin),
    j0: Math.max(0, j0 - margin), j1: Math.min(dimY - 1, j1 + margin),
    k0: Math.max(0, k0 - margin), k1: Math.min(dimZ - 1, k1 + margin),
  };
}

function _tightExtentAxis(i0:number,i1:number,j0:number,j1:number,k0:number,k1:number): number | null {
  const extI = i1 - i0 + 1, extJ = j1 - j0 + 1, extK = k1 - k0 + 1;
  const min = Math.min(extI, extJ, extK);
  if (min > 2) return null;
  if (extI === min) return 0;
  if (extJ === min) return 1;
  return 2;
}

function _filterOffsetsAxis(offsets: number[][], axis: number | null): number[][] {
  if (axis === null) return offsets;
  return offsets.filter((o) => o[axis] === 0);
}
const _OFFSETS6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const _OFFSETS26: number[][] = (() => {
  const out: number[][] = [];
  for (let di=-1; di<=1; di++) for (let dj=-1; dj<=1; dj++) for (let dk=-1; dk<=1; dk++)
    if (di || dj || dk) out.push([di, dj, dk]);
  return out;
})();

function _morphPass(arr: Uint8Array, w: number, h: number, d: number, offsets: number[][], mode: "dilate" | "erode"): Uint8Array {
  const idx = (i: number, j: number, k: number) => i + j * w + k * w * h;
  const next = new Uint8Array(arr.length);
  for (let k = 0; k < d; k++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const li = idx(i, j, k);
    if (mode === "dilate") {
      if (arr[li]) { next[li] = 1; continue; }
      let found = false;
      for (const [di, dj, dk] of offsets) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni < 0 || ni >= w || nj < 0 || nj >= h || nk < 0 || nk >= d) continue;
        if (arr[idx(ni, nj, nk)]) { found = true; break; }
      }
      next[li] = found ? 1 : 0;
    } else {
      if (!arr[li]) { next[li] = 0; continue; }
      let allFg = true;
      for (const [di, dj, dk] of offsets) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni < 0 || ni >= w || nj < 0 || nj >= h || nk < 0 || nk >= d) { allFg = false; break; } // volume edge = background
        if (!arr[idx(ni, nj, nk)]) { allFg = false; break; }
      }
      next[li] = allFg ? 1 : 0;
    }
  }
  return next;
}

function _applyMorphSequence(
  passes: Array<"dilate" | "erode">,
  iterationsEach: number,
  connectivity: 6 | 26,
  seedVoxel?: [number, number, number]
): { changedVoxels: number } | null {
  const segVolume = cache.getVolume(segmentationId);
  const vmGlobal = segVolume?.voxelManager as any;
  if (!segVolume || !vmGlobal) return null;
  const activeSegment = _activeEditSegment;
  const margin = iterationsEach * passes.length + 1;

  let vm: any, i0: number, i1: number, j0: number, j1: number, k0: number, k1: number, w: number, h: number, d: number;
  let otherMask: Uint8Array | null = null;
  let thinAxis: number | null;

  if (seedVoxel) {
    const tight = _isolateComponentAt(seedVoxel, connectivity, 0);
    thinAxis = tight ? _tightExtentAxis(tight.i0, tight.i1, tight.j0, tight.j1, tight.k0, tight.k1) : null;
    const iso = _isolateComponentAt(seedVoxel, connectivity, margin);
    if (!iso) return null;
    ({ vm, i0, i1, j0, j1, k0, k1, w, h, d, otherMask } = iso);
  } else {
    const tight = _segBBox(vmGlobal, activeSegment, 0);
    thinAxis = tight ? _tightExtentAxis(tight.i0, tight.i1, tight.j0, tight.j1, tight.k0, tight.k1) : null;
    const bbox = _segBBox(vmGlobal, activeSegment, margin);
    if (!bbox) return null;
    vm = vmGlobal;
    ({ i0, i1, j0, j1, k0, k1 } = bbox);
    w = i1 - i0 + 1; h = j1 - j0 + 1; d = k1 - k0 + 1;
  }

  const offsets = _filterOffsetsAxis(connectivity === 6 ? _OFFSETS6 : _OFFSETS26, thinAxis);
  const idxLocal = (i: number, j: number, k: number) => (i - i0) + (j - j0) * w + (k - k0) * w * h;

  let cur = new Uint8Array(w * h * d);
  if (seedVoxel) {
    const iso = _isolateComponentAt(seedVoxel, connectivity, margin)!;
    cur.set(iso.selfMask);
  } else {
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++)
      if (vm.getAtIJK(i, j, k) === activeSegment) cur[idxLocal(i, j, k)] = 1;
  }

  for (const mode of passes) {
    for (let it = 0; it < iterationsEach; it++) cur = _morphPass(cur, w, h, d, offsets, mode);
  }

  const changes: Array<{ i: number; j: number; k: number; prev: number; next: number }> = [];
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const li = idxLocal(i, j, k);
    if (otherMask && otherMask[li]) continue; // never touch a different island of the same label
    const wantFg = cur[li] === 1;
    const existing = vm.getAtIJK(i, j, k);
    if (wantFg && existing !== activeSegment) {
      if (existing !== 0) continue;
      changes.push({ i, j, k, prev: existing, next: activeSegment });
    } else if (!wantFg && existing === activeSegment) {
      changes.push({ i, j, k, prev: existing, next: 0 });
    }
  }
  if (!changes.length) return { changedVoxels: 0 };
  for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, c.next);
  _pushFillHistory({
    undo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, c.prev); _notifySegmentationChanged(); },
    redo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, c.next); _notifySegmentationChanged(); },
  });
  _notifySegmentationChanged();
  return { changedVoxels: changes.length };
}

export function erodeActiveSegment(iterations = 1, connectivity: 6 | 26 = 6, seedVoxel?: [number, number, number]) {
  return _applyMorphSequence(["erode"], iterations, connectivity, seedVoxel);
}
export function dilateActiveSegment(iterations = 1, connectivity: 6 | 26 = 6, seedVoxel?: [number, number, number]) {
  return _applyMorphSequence(["dilate"], iterations, connectivity, seedVoxel);
}


function _activeSegmentComponents(connectivity: 6 | 26): { vm: any; bbox: NonNullable<ReturnType<typeof _segBBox>>; w: number; h: number; d: number; labels: Int32Array; sizes: number[] } | null {
  const segVolume = cache.getVolume(segmentationId);
  const vm = segVolume?.voxelManager as any;
  if (!segVolume || !vm) return null;
  const activeSegment = _activeEditSegment;
  const bbox = _segBBox(vm, activeSegment, 1);
  if (!bbox) return null;
  const { i0, i1, j0, j1, k0, k1 } = bbox;
  const w = i1 - i0 + 1, h = j1 - j0 + 1, d = k1 - k0 + 1;
  const idxLocal = (i: number, j: number, k: number) => (i - i0) + (j - j0) * w + (k - k0) * w * h;
  const isFg = new Uint8Array(w * h * d);
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (vm.getAtIJK(i, j, k) === activeSegment) isFg[idxLocal(i, j, k)] = 1;
  }
  const offsets = connectivity === 6 ? _OFFSETS6 : _OFFSETS26;
  const labels = new Int32Array(w * h * d).fill(-1);
  const sizes: number[] = [];
  let nextLabel = 0;
  for (let start = 0; start < isFg.length; start++) {
    if (!isFg[start] || labels[start] !== -1) continue;
    const label = nextLabel++;
    let size = 0;
    const stack = [start];
    labels[start] = label;
    while (stack.length) {
      const lin = stack.pop()!;
      size++;
      const k = Math.floor(lin / (w * h));
      const rem = lin - k * w * h;
      const j = Math.floor(rem / w);
      const i = rem - j * w;
      for (const [di, dj, dk] of offsets) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni < 0 || ni >= w || nj < 0 || nj >= h || nk < 0 || nk >= d) continue;
        const nli = ni + nj * w + nk * w * h;
        if (isFg[nli] && labels[nli] === -1) { labels[nli] = label; stack.push(nli); }
      }
    }
    sizes.push(size);
  }
  return { vm, bbox, w, h, d, labels, sizes };
}
function _isolateComponentAt(
  seed: [number, number, number],
  connectivity: 6 | 26,
  marginVoxels: number
): {
  vm: any;
  i0: number; i1: number; j0: number; j1: number; k0: number; k1: number;
  w: number; h: number; d: number;
  selfMask: Uint8Array;
  otherMask: Uint8Array;
} | null {
  const comp = _activeSegmentComponents(connectivity);
  if (!comp) return null;
  const { vm, bbox, w: compW, h: compH, labels } = comp;
  const { i0: cbi0, j0: cbj0, k0: cbk0 } = bbox;
  const [si, sj, sk] = seed;
  const li = si - cbi0, lj = sj - cbj0, lk = sk - cbk0;
  if (li < 0 || lj < 0 || lk < 0 || li >= compW || lj >= compH) return null;
  const targetLabel = labels[li + lj * compW + lk * compW * compH];
  if (targetLabel === undefined || targetLabel === -1) return null; // clicked voxel isn't this segment

  // Tight bbox around just the clicked component (not the whole segment).
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity, k0 = Infinity, k1 = -Infinity;
  for (let idx = 0; idx < labels.length; idx++) {
    if (labels[idx] !== targetLabel) continue;
    const k = Math.floor(idx / (compW * compH));
    const rem = idx - k * compW * compH;
    const j = Math.floor(rem / compW);
    const i = rem - j * compW;
    const gi = i + cbi0, gj = j + cbj0, gk = k + cbk0;
    if (gi < i0) i0 = gi; if (gi > i1) i1 = gi;
    if (gj < j0) j0 = gj; if (gj > j1) j1 = gj;
    if (gk < k0) k0 = gk; if (gk > k1) k1 = gk;
  }
  if (i1 < i0) return null;

  const [dimX, dimY, dimZ] = vm.dimensions;
  i0 = Math.max(0, i0 - marginVoxels); j0 = Math.max(0, j0 - marginVoxels); k0 = Math.max(0, k0 - marginVoxels);
  i1 = Math.min(dimX - 1, i1 + marginVoxels); j1 = Math.min(dimY - 1, j1 + marginVoxels); k1 = Math.min(dimZ - 1, k1 + marginVoxels);
  const w = i1 - i0 + 1, h = j1 - j0 + 1, d = k1 - k0 + 1;
  const idxLocal = (i: number, j: number, k: number) => (i - i0) + (j - j0) * w + (k - k0) * w * h;
  const selfMask = new Uint8Array(w * h * d);
  const otherMask = new Uint8Array(w * h * d);
  const activeSegment = _activeEditSegment;

  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (vm.getAtIJK(i, j, k) !== activeSegment) continue;
    const ci = i - cbi0, cj = j - cbj0, ck = k - cbk0;
    const inCompBox = ci >= 0 && cj >= 0 && ck >= 0 && ci < compW && cj < compH;
    const lbl = inCompBox ? labels[ci + cj * compW + ck * compW * compH] : -2;
    if (lbl === targetLabel) selfMask[idxLocal(i, j, k)] = 1;
    else otherMask[idxLocal(i, j, k)] = 1;
  }
  return { vm, i0, i1, j0, j1, k0, k1, w, h, d, selfMask, otherMask };
}


// ============================================================================
// SECTION: Slice Copy & Shape Interpolation (SDT)
// ============================================================================

// ---------------------------------------------------------------------------
// Copy/paste a segment's 2D footprint from the current slice to another
// slice along the same pane's through-plane axis
// ---------------------------------------------------------------------------

export function copySegmentToAdjacentSlice(
  pane: CinePane,
  sliceOffset = 1,
  activeSegment = _activeEditSegment
): { changedVoxels: number } | null {
  const viewport = _getMprViewport(pane);
  const segVolume = cache.getVolume(segmentationId);
  const vm = segVolume?.voxelManager as any;
  if (!viewport || !segVolume || !vm) return null;

  const [dimX, dimY, dimZ] = vm.dimensions;
  const dims = [dimX, dimY, dimZ];
  const axis = _sliceAxisForPane(pane);
  const srcIndex = viewport.getSliceIndex();
  const dstIndex = srcIndex + sliceOffset;
  if (dstIndex < 0 || dstIndex >= dims[axis]) {
    console.warn("Copy to adjacent slice: destination is out of range.");
    return null;
  }

  const changes: Array<{ i: number; j: number; k: number; prev: number }> = [];
  const setIJK = (a: number, b: number, c: number, atSrc: boolean): [number, number, number] => {
    // Map a 2D (a,b) footprint coordinate + fixed slice index c back to IJK,
    // depending on which axis is the through-plane one.
    if (axis === 2) return [a, b, atSrc ? srcIndex : dstIndex]; // axial: slices along k
    if (axis === 0) return [atSrc ? srcIndex : dstIndex, a, b]; // sagittal: slices along i
    return [a, atSrc ? srcIndex : dstIndex, b]; // coronal: slices along j
  };

  // Iterate the two in-plane axes only
  const [dimA, dimB] =
    axis === 2 ? [dimX, dimY] : axis === 0 ? [dimY, dimZ] : [dimX, dimZ];

  for (let b = 0; b < dimB; b++) {
    for (let a = 0; a < dimA; a++) {
      const [si, sj, sk] = setIJK(a, b, 0, true);
      if (vm.getAtIJK(si, sj, sk) !== activeSegment) continue;
      const [di, dj, dk] = setIJK(a, b, 0, false);
      const existing = vm.getAtIJK(di, dj, dk);
      if (existing !== 0 && existing !== activeSegment) continue; // don't steal another organ's voxel
      if (existing === activeSegment) continue; // already set
      changes.push({ i: di, j: dj, k: dk, prev: existing });
    }
  }

  if (!changes.length) return { changedVoxels: 0 };
  for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, activeSegment);
  _pushFillHistory({
    undo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, c.prev); _notifySegmentationChanged(); },
    redo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, activeSegment); _notifySegmentationChanged(); },
  });
  _notifySegmentationChanged();
  return { changedVoxels: changes.length };
}

// ---------------------------------------------------------------------------
// Shape-based (SDT) interpolation between two annotated slices of the same
// segment, along one pane's axis. For each slice in between: interpolate the
// two slices' signed distance transforms and threshold at 0. Much better
// than nearest-neighbor copy for slices that differ noticeably in shape.
// ---------------------------------------------------------------------------

// 2D chamfer-style approximate Euclidean SDT (two-pass, sub-pixel accurate
// enough for interpolation purposes
function _signedDistanceTransform2D(mask: Uint8Array, w: number, h: number, clampDist = 40): Float32Array {
  const INF = 1e6;
  const dist = new Float32Array(w * h);
  const idx = (x: number, y: number) => x + y * w;

  const chamfer = (fg: Uint8Array): Float32Array => {
    const d = new Float32Array(w * h).fill(INF);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!fg[idx(x, y)]) d[idx(x, y)] = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (x > 0) d[i] = Math.min(d[i], d[idx(x - 1, y)] + 1);
      if (y > 0) d[i] = Math.min(d[i], d[idx(x, y - 1)] + 1);
      if (x > 0 && y > 0) d[i] = Math.min(d[i], d[idx(x - 1, y - 1)] + 1.4142);
      if (x < w - 1 && y > 0) d[i] = Math.min(d[i], d[idx(x + 1, y - 1)] + 1.4142);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = idx(x, y);
      if (x < w - 1) d[i] = Math.min(d[i], d[idx(x + 1, y)] + 1);
      if (y < h - 1) d[i] = Math.min(d[i], d[idx(x, y + 1)] + 1);
      if (x < w - 1 && y < h - 1) d[i] = Math.min(d[i], d[idx(x + 1, y + 1)] + 1.4142);
      if (x > 0 && y < h - 1) d[i] = Math.min(d[i], d[idx(x - 1, y + 1)] + 1.4142);
    }
    return d;
  };

  const distOutside = chamfer(mask);
  const inverted = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inverted[i] = mask[i] ? 0 : 1;
  const distInside = chamfer(inverted);

  // Clamp both fields to a narrow band. Without this, a background pixel far from
  // the shape on ONE slice gets an unbounded negative value that swamps a modest
  // positive "depth inside" value from the OTHER slice when blended — collapsing
  // the interpolated interior down to just the overlapping boundary ring instead
  // of a solid fill.
  for (let i = 0; i < w * h; i++) {
    dist[i] = mask[i] ? Math.min(distOutside[i], clampDist) : -Math.min(distInside[i], clampDist);
  }
  return dist;
}

function _extractSliceMask(vm: any, pane: CinePane, sliceIndex: number, segmentIndex: number): { mask: Uint8Array; dimA: number; dimB: number } {
  const [dimX, dimY, dimZ] = vm.dimensions;
  const axis = _sliceAxisForPane(pane);
  const [dimA, dimB] = axis === 2 ? [dimX, dimY] : axis === 0 ? [dimY, dimZ] : [dimX, dimZ];
  const mask = new Uint8Array(dimA * dimB);
  const at = (a: number, b: number): [number, number, number] =>
    axis === 2 ? [a, b, sliceIndex] : axis === 0 ? [sliceIndex, a, b] : [a, sliceIndex, b];
  for (let b = 0; b < dimB; b++) for (let a = 0; a < dimA; a++) {
    const [i, j, k] = at(a, b);
    if (vm.getAtIJK(i, j, k) === segmentIndex) mask[a + b * dimA] = 1;
  }
  return { mask, dimA, dimB };
}

// Flood-fills from the border of a dimA x dimB slice grid and returns which
// background cells were unreachable - i.e., truly enclosed holes, not the
// exterior. Used to patch the annulus artifact that SDT blending can produce
// between two anchor slices whose shapes have shifted position.
function _fillEnclosedHoles(mask: Uint8Array, dimA: number, dimB: number): Uint8Array {
  const reached = new Uint8Array(dimA * dimB);
  const stack: number[] = [];
  const idx = (a: number, b: number) => a + b * dimA;
  const pushIfBg = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= dimA || b >= dimB) return;
    const li = idx(a, b);
    if (!mask[li] && !reached[li]) { reached[li] = 1; stack.push(li); }
  };
  for (let a = 0; a < dimA; a++) { pushIfBg(a, 0); pushIfBg(a, dimB - 1); }
  for (let b = 0; b < dimB; b++) { pushIfBg(0, b); pushIfBg(dimA - 1, b); }
  while (stack.length) {
    const li = stack.pop()!;
    const a = li % dimA, b = Math.floor(li / dimA);
    pushIfBg(a + 1, b); pushIfBg(a - 1, b); pushIfBg(a, b + 1); pushIfBg(a, b - 1);
  }
  const out = new Uint8Array(dimA * dimB);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] || !reached[i] ? 1 : 0;
  return out;
}

export function interpolateSegmentBetweenSlices(
  pane: CinePane,
  sliceA: number,
  sliceB: number,
  segmentIndex = _activeEditSegment
): { changedVoxels: number; slicesWritten: number } | null {
  const segVolume = cache.getVolume(segmentationId);
  const vm = segVolume?.voxelManager as any;
  if (!segVolume || !vm) {
    console.warn("Interpolate: no segmentation loaded.");
    return null;
  }
  if (sliceA === sliceB) {
    console.warn("Interpolate: pick two different slices.");
    return null;
  }
  const lo = Math.min(sliceA, sliceB);
  const hi = Math.max(sliceA, sliceB);
  if (hi - lo < 2) {
    console.warn("Interpolate: slices are adjacent, nothing in between to fill.");
    return { changedVoxels: 0, slicesWritten: 0 };
  }

  const { mask: maskA, dimA, dimB } = _extractSliceMask(vm, pane, lo, segmentIndex);
  const { mask: maskB } = _extractSliceMask(vm, pane, hi, segmentIndex);
  const countA = maskA.reduce((s, v) => s + v, 0);
  const countB = maskB.reduce((s, v) => s + v, 0);
  if (!countA || !countB) {
    console.warn(
      `Interpolate: segment ${segmentIndex} not found on slice ${!countA ? lo + 1 : hi + 1} of pane "${pane}". ` +
      "Draw it fully on BOTH marked slices with the SAME organ selected before interpolating."
    );
    return null;
  }

  const sdtA = _signedDistanceTransform2D(maskA, dimA, dimB);
  const sdtB = _signedDistanceTransform2D(maskB, dimA, dimB);
  const axis = _sliceAxisForPane(pane);
  const at = (a: number, b: number, slice: number): [number, number, number] =>
    axis === 2 ? [a, b, slice] : axis === 0 ? [slice, a, b] : [a, slice, b];

  const changes: Array<{ i: number; j: number; k: number; prev: number }> = [];
  const totalSteps = hi - lo;
  for (let slice = lo + 1; slice < hi; slice++) {
    const t = (slice - lo) / totalSteps;
    const sliceMask = new Uint8Array(dimA * dimB);
    for (let b = 0; b < dimB; b++) {
      for (let a = 0; a < dimA; a++) {
        const li = a + b * dimA;
        if (sdtA[li] * (1 - t) + sdtB[li] * t >= 0) sliceMask[li] = 1;
      }
    }
    const healed = _fillEnclosedHoles(sliceMask, dimA, dimB);
    for (let b = 0; b < dimB; b++) {
      for (let a = 0; a < dimA; a++) {
        const li = a + b * dimA;
        if (!healed[li]) continue;
        const [i, j, k] = at(a, b, slice);
        const existing = vm.getAtIJK(i, j, k);
        if (existing === segmentIndex) continue; // already this class — nothing to change
        changes.push({ i, j, k, prev: existing }); // overwrite anything else, same as brush/smart-fill
      }
    }
  }

  if (!changes.length) {
    console.warn("Interpolate: computed shapes but every target voxel was already occupied by another segment.");
    return { changedVoxels: 0, slicesWritten: 0 };
  }
  for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, segmentIndex);
  _pushFillHistory({
    undo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, c.prev); _notifySegmentationChanged(); },
    redo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, segmentIndex); _notifySegmentationChanged(); },
  });
  _notifySegmentationChanged();
  return { changedVoxels: changes.length, slicesWritten: hi - lo - 1 };
}

export function copySegmentAcrossSlices(
  pane: CinePane,
  fromSlice: number,
  toSlice: number,
  segmentIndex = _activeEditSegment
): { changedVoxels: number; slicesWritten: number } | null {
  const segVolume = cache.getVolume(segmentationId);
  const vm = segVolume?.voxelManager as any;
  if (!segVolume || !vm) {
    console.warn("Copy across slices: no segmentation loaded.");
    return null;
  }
  const lo = Math.min(fromSlice, toSlice);
  const hi = Math.max(fromSlice, toSlice);
  if (lo === hi) {
    console.warn("Copy across slices: pick two different slices.");
    return { changedVoxels: 0, slicesWritten: 0 };
  }

  const { mask: srcMask, dimA, dimB } = _extractSliceMask(vm, pane, fromSlice, segmentIndex);
  const count = srcMask.reduce((s, v) => s + v, 0);
  if (!count) {
    console.warn(
      `Copy across slices: segment ${segmentIndex} not found on the source slice (${fromSlice + 1}) of pane "${pane}". ` +
      "Draw it fully there first, with that organ selected in the dropdown."
    );
    return null;
  }

  const axis = _sliceAxisForPane(pane);
  const at = (a: number, b: number, slice: number): [number, number, number] =>
    axis === 2 ? [a, b, slice] : axis === 0 ? [slice, a, b] : [a, slice, b];

  const changes: Array<{ i: number; j: number; k: number; prev: number }> = [];
  for (let slice = lo; slice <= hi; slice++) {
    if (slice === fromSlice) continue;
    for (let b = 0; b < dimB; b++) {
      for (let a = 0; a < dimA; a++) {
        if (!srcMask[a + b * dimA]) continue;
        const [i, j, k] = at(a, b, slice);
        const existing = vm.getAtIJK(i, j, k);
        if (existing === segmentIndex) continue;
        changes.push({ i, j, k, prev: existing });
      }
    }
  }

  if (!changes.length) {
    console.warn("Copy across slices: nothing written — every target voxel was already occupied.");
    return { changedVoxels: 0, slicesWritten: 0 };
  }
  for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, segmentIndex);
  _pushFillHistory({
    undo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, c.prev); _notifySegmentationChanged(); },
    redo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, segmentIndex); _notifySegmentationChanged(); },
  });
  _notifySegmentationChanged();
  return { changedVoxels: changes.length, slicesWritten: hi - lo };
}

const _interpEndpoints: Record<CinePane, number | null> = { axial: null, sagittal: null, coronal: null };

export function setInterpolationEndpoint(pane: CinePane, sliceIndex: number) {
  _interpEndpoints[pane] = sliceIndex;
}
export function getInterpolationEndpoint(pane: CinePane): number | null {
  return _interpEndpoints[pane];
}
export function clearInterpolationEndpoints(pane: CinePane) {
  _interpEndpoints[pane] = null;
}

// ============================================================================
// SECTION: Lasso (Straight-Edge Polygon Fill)
// ============================================================================

// ---------------------------------------------------------------------------
// Rasterizes a closed polygon (in one slice's 2D pixel space) into the active
// segment on that single slice, via scanline-style flood fill from the
// polygon boundary. Shared by lassoCommitPolygon below.
// ---------------------------------------------------------------------------

function _rasterizeClosedPolygon(
  pane: CinePane,
  sliceIndex: number,
  polygonAB: Array<[number, number]>,
  segmentIndex = _activeEditSegment
): { filledVoxels: number } | null {
  const segVolume = cache.getVolume(segmentationId);
  const vm = segVolume?.voxelManager as any;
  if (!segVolume || !vm || polygonAB.length < 3) return null;

  const [dimX, dimY, dimZ] = vm.dimensions;
  const axis = _sliceAxisForPane(pane);
  const [dimA, dimB] = axis === 2 ? [dimX, dimY] : axis === 0 ? [dimY, dimZ] : [dimX, dimZ];
  const at = (a: number, b: number): [number, number, number] =>
    axis === 2 ? [a, b, sliceIndex] : axis === 0 ? [sliceIndex, a, b] : [a, sliceIndex, b];

  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const [a, b] of polygonAB) {
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minB = Math.min(minB, b); maxB = Math.max(maxB, b);
  }
  const boxA0 = Math.max(0, Math.floor(minA) - 1);
  const boxA1 = Math.min(dimA - 1, Math.ceil(maxA) + 1);
  const boxB0 = Math.max(0, Math.floor(minB) - 1);
  const boxB1 = Math.min(dimB - 1, Math.ceil(maxB) + 1);
  const w = boxA1 - boxA0 + 1;
  const h = boxB1 - boxB0 + 1;
  if (w < 2 || h < 2) return { filledVoxels: 0 };

  const idxLocal = (a: number, b: number) => (a - boxA0) + (b - boxB0) * w;

  const boundary = new Uint8Array(w * h);
  const drawLine = (a0: number, b0: number, a1: number, b1: number) => {
    let x0 = Math.round(a0), y0 = Math.round(b0);
    const x1 = Math.round(a1), y1 = Math.round(b1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x0 >= boxA0 && x0 <= boxA1 && y0 >= boxB0 && y0 <= boxB1) {
        boundary[idxLocal(x0, y0)] = 1;
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  for (let i = 0; i < polygonAB.length; i++) {
    const [a0, b0] = polygonAB[i];
    const [a1, b1] = polygonAB[(i + 1) % polygonAB.length];
    drawLine(a0, b0, a1, b1);
  }

  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const li = x + y * w;
    if (boundary[li] || outside[li]) return;
    outside[li] = 1;
    stack.push(li);
  };
  for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1); }
  for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y); }
  while (stack.length) {
    const li = stack.pop()!;
    const x = li % w, y = Math.floor(li / w);
    tryPush(x + 1, y); tryPush(x - 1, y); tryPush(x, y + 1); tryPush(x, y - 1);
  }

  const changes: Array<{ i: number; j: number; k: number; prev: number }> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const li = x + y * w;
      if (outside[li]) continue;
      const a = x + boxA0, b = y + boxB0;
      const [i, j, k] = at(a, b);
      if (i < 0 || j < 0 || k < 0 || i >= dimX || j >= dimY || k >= dimZ) continue;
      const existing = vm.getAtIJK(i, j, k);
      if (existing === segmentIndex) continue; // already this class — nothing to change
      changes.push({ i, j, k, prev: existing }); // overwrite anything else, same as the brush
    }
  }

  if (!changes.length) return { filledVoxels: 0 };
  for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, segmentIndex);
  _pushFillHistory({
    undo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, c.prev); _notifySegmentationChanged(); },
    redo: () => { for (const c of changes) vm.setAtIJK(c.i, c.j, c.k, segmentIndex); _notifySegmentationChanged(); },
  });
  _notifySegmentationChanged();
  return { filledVoxels: changes.length };
}

// Plain (straight-edge) lasso — every clicked canvas point is converted to a
// voxel directly, and the resulting polygon is rasterized in one pass. No
// edge-snapping: the outline is exactly what the user drew.
export function lassoCommitPolygon(
  pane: CinePane,
  canvasPoints: Array<[number, number]>,
  segmentIndex = _activeEditSegment
): { filledVoxels: number } | null {
  const voxelPts = canvasPoints.map((cp) => canvasPointToVoxel(pane, cp));
  if (voxelPts.some((v) => !v)) {
    console.warn("Lasso: one or more points landed outside the volume.");
    return null;
  }
  const pts = voxelPts as Array<[number, number, number]>;

  const axis = _sliceAxisForPane(pane);
  // Median through-plane index across all clicked points — robust to any single
  // point rounding to a neighboring slice.
  const throughVals = pts
    .map((p) => (axis === 2 ? p[2] : axis === 0 ? p[0] : p[1]))
    .sort((a, b) => a - b);
  const sliceIndex = throughVals[Math.floor(throughVals.length / 2)];

  const polygonAB: Array<[number, number]> = pts.map((p) =>
    axis === 2 ? [p[0], p[1]] : axis === 0 ? [p[1], p[2]] : [p[0], p[2]]
  );

  return _rasterizeClosedPolygon(pane, sliceIndex, polygonAB, segmentIndex);
}

// ============================================================================
// SECTION: Mouse Tool Release Helper
// ============================================================================

export function releasePrimaryMouseTools() {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  toolGroup.setToolDisabled(PanTool.toolName);
  for (const name of EDIT_TOOL_NAMES) toolGroup.setToolDisabled(name);
  for (const name of MEASUREMENT_TOOL_NAMES) toolGroup.setToolPassive(name);
}

// ============================================================================
// SECTION: Live Mesh Extraction (Marching Cubes)
// ============================================================================


export function extractSegmentSurface(
  segmentIndex: number,
  manifestCenter: [number, number, number]
): LiveMeshResult | null {
  const volume = cache.getVolume(segmentationId);
  if (!volume) return null;

  const built = _buildBinaryMask(segmentIndex);
  if (!built) return null;
  const { mask, dims } = built;

  // Nothing painted yet for this class.
  let any = false;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { any = true; break; }
  if (!any) return null;

  const { padded, pdims } = _padVolume(mask, dims);
  const { points, polys } = _runMarchingCubes(padded, pdims);
  if (!points.length) return null;

  const positions = _transformVertices(
    points,
    volume.origin as number[],
    volume.spacing as number[],
    volume.direction as number[],
    manifestCenter
  );
  const indices = _vtkPolysToIndices(polys);

  return { positions, indices };
}