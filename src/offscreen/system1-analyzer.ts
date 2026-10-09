import { MediaType, MetadataResult, System1Result, System1Features } from '../shared/types';
import { ExtractedPatch } from './patch-extractor';
import { analyzeCanvasPixels, detectMediaType } from './media-detector';

/**
 * Ultra-fast (<5ms), 100% on-device System 1 Triage Engine.
 * Evaluates immediately available surface properties:
 * - Image dimensions and screen aspect ratios
 * - Hardware EXIF and cryptographic C2PA provenance
 * - Lightweight canvas pixel statistics (palette entropy, flat fills, paper substrate, edge density)
 *
 * Produces a typed classification, calibrated prior probability P(AI), and initial confidence.
 */
export function analyzeSystem1(
  width: number,
  height: number,
  metadata: MetadataResult,
  patches: ExtractedPatch[]
): System1Result {
  const pixelStats = analyzeCanvasPixels(patches);
  const mediaType: MediaType = detectMediaType(width, height, metadata, patches);

  const features: System1Features = {
    textureRatio: pixelStats.textureRatio,
    flatRatio: pixelStats.exactFlatRatio,
    subtleFlatRatio: pixelStats.subtleFlatRatio,
    sharpEdgeRatio: pixelStats.sharpEdgeRatio,
    uniqueColorCount: pixelStats.uniqueColorCount,
    uniqueColorRatio: pixelStats.uniqueColorRatio,
    highSaturationRatio: pixelStats.highSaturationRatio,
    lowSaturationRatio: pixelStats.lowSaturationRatio,
    paperRatio: pixelStats.paperRatio,
    inkRatio: pixelStats.inkRatio,
    isPenAndInk: pixelStats.isPenAndInk,
    hasCameraExif: Boolean(metadata.cameraModel || (metadata.exifPresent && !metadata.aiProvenancePresent)),
    hasC2pa: Boolean(metadata.c2paPresent),
    hasRepetitivePattern: pixelStats.hasRepetitivePattern,
    patternRatio: pixelStats.patternPatchRatio
  };

  // Case 1: Provenance-flagged AI generation
  if (metadata.aiProvenancePresent) {
    const swName = metadata.aiSoftwareName ? ` (${metadata.aiSoftwareName})` : '';
    return {
      mediaType,
      priorAiScore: 0.99,
      confidence: 0.99,
      summary: `Generative AI provenance manifest detected${swName}.`,
      canBypassSystem2: true,
      features
    };
  }

  // Case 2: Cryptographic authentic provenance (C2PA)
  if (metadata.c2paPresent) {
    return {
      mediaType,
      priorAiScore: 0.02,
      confidence: 0.96,
      summary: 'Cryptographically signed provenance manifest (C2PA) confirms authentic origin.',
      canBypassSystem2: true,
      features
    };
  }

  // Case 3: Verified camera hardware EXIF
  if (features.hasCameraExif) {
    const camInfo = metadata.cameraModel ? ` (${metadata.cameraModel})` : '';
    const patternNote = pixelStats.hasRepetitivePattern ? ' [physical repetitive texture]' : '';
    return {
      mediaType: 'camera-photo',
      priorAiScore: 0.03,
      confidence: 0.94,
      summary: `Authentic camera optical capture verified${camInfo}${patternNote}.`,
      canBypassSystem2: false,
      features
    };
  }

  // Case 4: Physical hand-drawn sketch / pen & ink on paper
  if (pixelStats.isPenAndInk) {
    return {
      mediaType: 'pen-ink-art',
      priorAiScore: 0.03,
      confidence: 0.88,
      summary: 'Physical hand-drawn artwork / sketch on paper substrate detected.',
      canBypassSystem2: false,
      features
    };
  }

  // Case 5: Graphic design / UI
  if (mediaType === 'graphic-or-ui') {
    const isTrivialVector = pixelStats.exactFlatRatio > 0.80 && pixelStats.uniqueColorCount < 40;
    return {
      mediaType: 'graphic-or-ui',
      priorAiScore: isTrivialVector ? 0.01 : 0.05,
      confidence: isTrivialVector ? 0.94 : 0.85,
      summary: isTrivialVector
        ? 'Vector UI element or digital graphic interface.'
        : 'Graphic design or digital UI layout detected.',
      canBypassSystem2: isTrivialVector,
      features
    };
  }

  // Case 6: Screen capture / screenshot
  if (mediaType === 'screen-capture') {
    return {
      mediaType: 'screen-capture',
      priorAiScore: 0.03,
      confidence: 0.85,
      summary: 'Screen capture / desktop display rendering detected.',
      canBypassSystem2: false,
      features
    };
  }

  // Case 7: Artwork / Traditional or Digital Painting / Illustration
  if (mediaType === 'digital-art') {
    return {
      mediaType: 'digital-art',
      priorAiScore: 0.12,
      confidence: 0.85,
      summary: 'Artwork / Painting / Illustration detected.',
      canBypassSystem2: false,
      features
    };
  }

  // Case 8: Photographic capture with stripped EXIF
  if (mediaType === 'camera-photo') {
    const patternNote = pixelStats.hasRepetitivePattern ? ' (physical repetitive texture detected)' : '';
    return {
      mediaType: 'camera-photo',
      priorAiScore: pixelStats.hasRepetitivePattern ? 0.15 : 0.20,
      confidence: 0.75,
      summary: `Photographic capture (unverified camera metadata)${patternNote}.`,
      canBypassSystem2: false,
      features
    };
  }

  // Case 9: General / continuous tone fallback
  return {
    mediaType: 'general-media',
    priorAiScore: 0.25,
    confidence: 0.50,
    summary: 'Continuous tone digital media.',
    canBypassSystem2: false,
    features
  };
}
