export type ImageAnalysisStatus = 'pending' | 'analyzing' | 'complete' | 'error';

export interface PatchBox {
  x: number; // 0.0 - 1.0 (relative to image width)
  y: number; // 0.0 - 1.0 (relative to image height)
  width: number; // 0.0 - 1.0 (relative to image width)
  height: number; // 0.0 - 1.0 (relative to image height)
}

export type PatchPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface PatchResult {
  patchIndex: number;
  position: PatchPosition;
  aiScore: number;
  box?: PatchBox;
}

export interface MetadataResult {
  exifPresent: boolean;
  cameraModel?: string;
  c2paPresent: boolean;
  estimatedCompressionGenerations?: number;
  qualityScore: number;
}

export interface GridDimensions {
  cols: number;
  rows: number;
  total: number;
}

export interface AnalysisResult {
  imageUrl: string;
  status: ImageAnalysisStatus;
  aiScore: number; // 0.0 (Real) - 1.0 (AI generated)
  patchScores: PatchResult[];
  metadata: MetadataResult;
  timestamp: number;
  supportsDeepSampling?: boolean;
  deepGrid?: GridDimensions;
  currentGrid?: GridDimensions;
  sampleMode?: 'standard' | 'deep';
  imageWidth?: number;
  imageHeight?: number;
  error?: string;
}

export interface ImageSummary {
  imageUrl: string;
  aiScore: number;
  status: ImageAnalysisStatus;
  timestamp: number;
  cameraModel?: string;
  c2paPresent?: boolean;
}

export interface TabScanStats {
  tabId: number;
  totalScanned: number;
  aiDetected: number; // score >= 0.70
  suspectedAi: number; // 0.30 <= score < 0.70
  likelyReal: number; // score < 0.30
  isScanning: boolean;
  images: ImageSummary[];
}

// Message passing types
export type ExtensionMessage =
  | {
      type: 'ANALYZE_IMAGE';
      imageUrl: string;
      priority?: 'high' | 'normal';
      isModal?: boolean;
      sampleMode?: 'standard' | 'deep';
      forceRescan?: boolean;
    }
  | { type: 'IMAGE_ANALYSIS_RESULT'; result: AnalysisResult }
  | { type: 'CANCEL_BACKGROUND_ANALYSIS' }
  | {
      type: 'PROCESS_IMAGE_BUFFER';
      imageUrl: string;
      buffer: number[];
      contentType: string;
      priority?: 'high' | 'normal';
      isModal?: boolean;
      sampleMode?: 'standard' | 'deep';
    }
  | { type: 'GET_PAGE_STATS' }
  | { type: 'PAGE_STATS_RESULT'; stats: { total: number; analyzed: number; aiDetected: number } }
  | { type: 'GET_TAB_STATS'; tabId?: number }
  | { type: 'TAB_STATS_RESULT'; stats: TabScanStats }
  | { type: 'TAB_STATS_UPDATED'; stats: TabScanStats }
  | { type: 'HIGHLIGHT_IMAGE_ON_PAGE'; imageUrl: string }
  | { type: 'OFFSCREEN_READY' };
