import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../contexts/authContext";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The CT viewer relies on WebGL (Niivue + Cornerstone) and a three.js loader,
// none of which run under jsdom/CI (no GPU). Mock those modules so we can verify
// the page component itself mounts and wires up without crashing.
vi.mock("@niivue/niivue", () => ({
	Niivue: class {
		attachToCanvas() {}
		loadVolumes() {
			return Promise.resolve();
		}
		setSliceType() {}
		setInterpolation() {}
		drawScene() {}
	},
}));

vi.mock("../helpers/CornerstoneNifti2", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../helpers/CornerstoneNifti2")>();
	return {
		...actual,
		getOrganLabelOnClick: vi.fn(),
		getOrganLabelAtPoint: vi.fn(() => undefined),
		moveCornerstoneCrosshairToMm: vi.fn(),
		renderVisualization: vi.fn().mockResolvedValue({
			renderingEngine: {},
			viewportIds: [],
			volumeId: "test-volume",
		}),
		setFillOpacity: vi.fn(),
		setPaneSliceIndex: vi.fn(),
		subscribeToSliceChanges: vi.fn(() => () => {}),
		setOutlineOpacity: vi.fn(),
		setVisibilities: vi.fn(),
		subscribeToCrosshairChanges: vi.fn(),
		subscribeToVolumeProgress: vi.fn(() => () => {}),
		toggleCrosshairTool: vi.fn(),
		setActiveMeasurementTool: vi.fn(),
		clearMeasurements: vi.fn(),
		getCrosshairMm: vi.fn(() => null),
		getOrganCentroids: vi.fn(() => null),
		// Measurement inventory + reading-session capture APIs
		getMeasurementSummaries: vi.fn(() => []),
		subscribeToMeasurementChanges: vi.fn(() => () => {}),
		captureViewportImages: vi.fn(async () => []),
		renameMeasurement: vi.fn(),
		removeMeasurement: vi.fn(),
		jumpToMeasurement: vi.fn(() => null),
		// Zoom controls now live in the top toolbar (previously ZoomHandle)
		setZoom: vi.fn(),
		centerOnCursor: vi.fn(),
		zoomToFit: vi.fn(),
		zoomToCursor: vi.fn(),
		// Progressive full-res upgrade + shaded volume rendering (3D pane)
		upgradeCtVolume: vi.fn(async () => null),
		enableVolume3D: vi.fn(async () => false),
		disableVolume3D: vi.fn(),
		applyVolume3DPreset: vi.fn(),
		getCurrentVolumeModality: () => undefined,
		// Mask editing (brush/eraser + labelmap export)
		setActiveMaskEditTool: vi.fn(),
		setActiveEditSegment: vi.fn(),
		setMaskBrushSize: vi.fn(),
		undoMaskEdit: vi.fn(),
		redoMaskEdit: vi.fn(),
		getMaskEditHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false })),
		subscribeToSegmentationEdits: vi.fn(() => () => {}),
		getEditedSegments: vi.fn(() => new Set()),
		getSegmentationExport: vi.fn(() => null),
		hasSegmentation: vi.fn(() => false),
		hasSegmentationVolume: vi.fn(() => false),
		buildMaskFilter: vi.fn(() => () => true),
		setBrushMaskingScope: vi.fn(),
		// Cine playback + oblique-MPR reset
		startCine: vi.fn(() => false),
		stopCine: vi.fn(),
		setReferenceLinesEnabled: vi.fn(),
		flipPaneHorizontal: vi.fn(),
		rotatePane90Clockwise: vi.fn(),
		resetMprOrientation: vi.fn(),
	};
});

vi.mock("../helpers/NiiVueNifti", () => ({
	create3DVolume: vi.fn().mockResolvedValue(undefined),
	moveNiiVueCrosshairToMm: vi.fn(),
	updateVisibilities: vi.fn(),
}));

import { renderVisualization } from "../helpers/CornerstoneNifti2";
import VisualizationPage from "../routes/VisualizationPage";
import type { QuizPracticeController } from "../education/types";

function quizController(maskUrl: string | null = null): QuizPracticeController {
	return {
		pack: {
			pack_id: "radworld-case-35-v1",
			version: 1,
			case_id: "35",
			title: "Case 35",
			difficulty: "easy",
			provenance: {},
			generator_version: "test",
			validator_version: "test",
			questions: [{ id: "organ", prompt: "Which organ?", choices: [] }],
		},
		questionIndex: 0,
		answers: {},
		result: null,
		maskUrl,
		submitting: false,
		error: null,
		dockOpen: false,
		setDockOpen: vi.fn(),
		selectAnswer: vi.fn(),
		previous: vi.fn(),
		next: vi.fn(),
		reportContent: vi.fn(async () => {}),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	global.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		arrayBuffer: async () => new ArrayBuffer(0),
		blob: async () => new Blob(),
		json: async () => ({}),
		text: async () => "",
		headers: { get: () => "application/json" },
	})) as unknown as typeof fetch;
});

describe("viewer smoke test", () => {
	it("VisualizationPage mounts for a dataset case without crashing", async () => {
		const { container } = render(
			<AuthProvider>
				<MemoryRouter initialEntries={["/case/1"]}>
					<Routes>
						<Route path="/case/:caseId" element={<VisualizationPage />} />
					</Routes>
				</MemoryRouter>
			</AuthProvider>
		);
		expect(container.firstChild).toBeTruthy();
		await waitFor(() => expect(renderVisualization).toHaveBeenCalled());
	});

	it("loads quiz-practice CT before reveal mask is available", async () => {
		const controller = quizController();

		render(
			<AuthProvider>
				<MemoryRouter initialEntries={["/learn/quiz/radworld-case-35-v1"]}>
					<VisualizationPage quizPractice={controller} />
				</MemoryRouter>
			</AuthProvider>
		);

		await waitFor(() => expect(renderVisualization).toHaveBeenCalled());
		expect(vi.mocked(renderVisualization).mock.calls.at(-1)?.[5]).toBeUndefined();
	});

	it("applies windowing to CT actor after reveal labelmap becomes default", async () => {
		const ctUpdateRange = vi.fn();
		const segmentationUpdateRange = vi.fn();
		const actor = (referencedId: string, updateRange: () => void) => ({
			referencedId,
			actor: {
				getProperty: () => ({
					getRGBTransferFunction: () => ({
						setMappingRange: vi.fn(),
						updateRange,
					}),
				}),
			},
		});
		const segmentationActor = actor("mySegmentation", segmentationUpdateRange);
		const ctActor = actor("ct-volume", ctUpdateRange);
		const viewport = {
			getActors: () => [segmentationActor, ctActor],
			getDefaultActor: () => segmentationActor,
			render: vi.fn(),
		};
		vi.mocked(renderVisualization).mockResolvedValueOnce({
			renderingEngine: { getViewport: () => viewport },
			viewportIds: ["viewport-1"],
			volumeId: "ct-volume",
		} as never);

		render(
			<AuthProvider>
				<MemoryRouter initialEntries={["/learn/quiz/radworld-case-35-v1"]}>
					<VisualizationPage quizPractice={quizController("blob:reveal-mask")} />
				</MemoryRouter>
			</AuthProvider>
		);

		await waitFor(() => expect(ctUpdateRange).toHaveBeenCalled());
		expect(segmentationUpdateRange).not.toHaveBeenCalled();
	});
});
