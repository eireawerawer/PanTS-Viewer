// Trigger typecheck using the latest AI assistant files.
export type AIAction =
  | { type: "isolate_organs"; organs: string[] }
  | { type: "show_organs"; organs: string[] }
  | { type: "hide_organs"; organs: string[] }
  | { type: "focus_organ"; organ: string }
  | { type: "get_organ_metric"; organ: string; metric: "volume_cm3" | "mean_hu" | "all" }
  | { type: "set_opacity"; value: number }
  | { type: "set_window"; width: number; center: number }
  | { type: "set_window_preset"; preset: "soft_tissue" | "bone" | "lung" | "liver" }
  | { type: "set_zoom"; value: number }
  | { type: "zoom_to_fit" }
  | { type: "set_view"; view: "mpr" | "axial" | "sagittal" | "coronal" | "3d" }
  | { type: "activate_measurement_tool"; tool: "distance" | "probe" | "roi" }
  | { type: "clear_measurements" }
  | { type: "list_structures" }
  | { type: "get_structure_count" }
  | { type: "get_largest_structure" }
  | { type: "get_smallest_structure" };

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  meta?: string;
}

export interface ViewerStateSnapshot {
  view: string;
  opacity: number;
  windowWidth: number;
  windowCenter: number;
  zoomLevel: number;
}

export interface OrganMetricSnapshot {
  organ_name: string;
  volume_cm3: number | null;
  mean_hu?: number | null;
  voxel_count?: number | null;
  touches_volume_boundary?: boolean;
}

export interface OrganReferenceSnapshot {
  organ_name: string;
  percentile: number;
  basis?: string | null;
  n?: number | null;
}

export interface DemographicsSnapshot {
  sex?: string | null;
  age?: number | null;
  bmi?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
}

export interface AIModelInfo {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface ViewerActions {
  isolateOrgans: (organKeys: string[]) => void;
  showOrgans: (organKeys: string[]) => void;
  hideOrgans: (organKeys: string[]) => void;
  focusOrgan: (organKey: string) => void;
  setOpacity: (value: number) => void;
  setWindow: (width: number, center: number) => void;
  setWindowPreset: (preset: "soft_tissue" | "bone" | "lung" | "liver") => void;
  setZoom: (value: number) => void;
  zoomToFit: () => void;
  setViewMode: (view: "mpr" | "axial" | "sagittal" | "coronal" | "3d") => void;
  activateMeasurementTool: (tool: "distance" | "probe" | "roi") => void;
  clearMeasurements: () => void;
  getOrganMetric: (organ: string, metric: "volume_cm3" | "mean_hu" | "all") => Promise<string>;
  listStructures: () => Promise<string>;
  getStructureCount: () => Promise<string>;
  getLargestStructure: () => Promise<string>;
  getSmallestStructure: () => Promise<string>;
}

export interface AISidebarProps {
  open: boolean;
  onClose: () => void;
  caseId: string;
  sessionId?: string;
  availableOrgans: string[];
  viewerState: ViewerStateSnapshot;
  organMetrics?: OrganMetricSnapshot[];
  organReferences?: OrganReferenceSnapshot[];
  demographics?: DemographicsSnapshot | null;
  actions: ViewerActions;
}
