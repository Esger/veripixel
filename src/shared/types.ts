export type ImageAnalysisStatus = 'pending' | 'analyzing' | 'complete' | 'error';

export interface PatchResult {
  patchIndex: number;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  aiScore: number;
}

export interface MetadataResult {
  exifPresent: boolean;
  cameraModel?: string;
  c2paPresent: boolean;
  estimatedCompressionGenerations?: number;
  qualityScore: number;
}

export interface AnalysisResult {
  imageUrl: string;
  status: ImageAnalysisStatus;
  aiScore: number; // 0.0 (Real) - 1.0 (AI generated)
  patchScores: PatchResult[];
  metadata: MetadataResult;
  timestamp: number;
  error?: string;
}

// Message passing types
export type ExtensionMessage =
  | { type: 'ANALYZE_IMAGE'; imageUrl: string; priority?: 'high' | 'normal'; isModal?: boolean }
  | { type: 'IMAGE_ANALYSIS_RESULT'; result: AnalysisResult }
  | { type: 'CANCEL_BACKGROUND_ANALYSIS' }
  | {
      type: 'PROCESS_IMAGE_BUFFER';
      imageUrl: string;
      buffer: number[];
      contentType: string;
      priority?: 'high' | 'normal';
      isModal?: boolean;
    }
  | { type: 'GET_PAGE_STATS' }
  | { type: 'PAGE_STATS_RESULT'; stats: { total: number; analyzed: number; aiDetected: number } }
  | { type: 'OFFSCREEN_READY' };
