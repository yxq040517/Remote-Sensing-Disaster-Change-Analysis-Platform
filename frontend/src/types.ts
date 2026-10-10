export const classes = [
  { id: 1, name: "未见损伤", color: "#28b9ad" },
  { id: 2, name: "轻度损伤", color: "#f6c45d" },
  { id: 3, name: "重度损伤", color: "#f48b53" },
  { id: 4, name: "毁坏", color: "#e65a70" },
];
export interface Region {
  id: number;
  class_id: number;
  pixels: number;
  bbox: number[];
  confidence: number | null;
}
export interface Review {
  id?: string;
  kind: "region" | "polygon";
  region_id?: number;
  class_id: number;
  points?: number[][];
  status: "confirmed" | "needs_review";
  note: string;
  created_at?: string;
  active?: boolean;
}
export interface Stats {
  candidate_count: number;
  building_pixels: number;
  damaged_pixels: number;
  total_pixels: number;
  class_counts: number[];
  class_shares: number[];
  area_m2: number | null;
  regions?: Region[];
}
export interface Task {
  id: string;
  name: string;
  source: string;
  case_id?: string;
  event?: string;
  created_at: string;
  updated_at?: string;
  state: string;
  stage: string;
  progress: number;
  error?: string;
  stats?: Stats;
  review_stats?: Stats;
  reviews?: Review[];
  has_truth?: boolean;
  width: number;
  height: number;
  geo?: { crs: string; transform: number[]; pixel_area_m2: number | null };
  inference?: {
    seconds: number;
    device: string;
    peak_vram_mb: number;
    tile: number;
    tiles: number;
    model_id: string;
  };
}
export interface Case {
  id: string;
  name: string;
  event: string;
  event_name: string;
  type: string;
  image_name: string;
  split: string;
  width: number;
  height: number;
  truth_counts: number[];
}
export interface Metrics {
  overall_f1: number;
  localization_f1: number;
  damage_f1: number;
  class_f1: number[];
}
export interface Evaluation extends Metrics {
  samples: number;
  total: number;
  manifest_sha256: string;
  seconds: number;
  mean_seconds: number;
  protocol: string;
  state: string;
  failures?: number;
  error?: string;
  failure_examples?: {
    id: string;
    event: string;
    metrics: Metrics & {
      present_class_mean_f1: number | null;
      class_support: number[];
    };
  }[];
}
export interface Status {
  model: {
    name: string;
    model_id: string;
    downloaded: boolean;
    loaded: boolean;
    device: string | null;
    error?: string;
    source_metrics: Metrics;
    source_protocol: string;
  };
  cases: number;
  queue: number;
  evaluation: Evaluation | null;
}
export const states: Record<string, string> = {
  queued: "等待分析",
  running: "分析中",
  completed: "已完成",
  failed: "分析失败",
  interrupted: "已中断",
};
export const format = (value: number) => value.toLocaleString("zh-CN");
export const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
