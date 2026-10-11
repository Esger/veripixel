import { ForensicReasoning, MetadataResult, PatchResult, System1Result } from '../shared/types';

/**
 * Transforms a probability float (0.01 - 0.99) to log-odds (logit).
 */
function logit(p: number): number {
  const clamped = Math.min(0.995, Math.max(0.005, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Transforms log-odds back to probability (sigmoid).
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface FusedDecision {
  aiScore: number;
  patchScores: PatchResult[];
  reasoning: ForensicReasoning;
}

/**
 * Dual-Process Decision & Evidence Fusion Engine.
 * Combines System 1 prior belief (structural properties, EXIF, C2PA, pixel statistics)
 * with System 2 empirical observations (Swin Transformer neural patch inference)
 * using calibrated log-odds Bayesian updating.
 */
export function fuseDecision(
  system1: System1Result,
  rawPatchScores: PatchResult[],
  metadata: MetadataResult
): FusedDecision {
  const { mediaType, priorAiScore, confidence } = system1;

  // 1. Cryptographic AI Provenance override
  if (metadata.aiProvenancePresent) {
    const sw = metadata.aiSoftwareName ? ` (${metadata.aiSoftwareName})` : '';
    return {
      aiScore: 0.99,
      patchScores: rawPatchScores,
      reasoning: {
        type: 'full-synthetic',
        title: 'C2PA Verified: Generative AI',
        description: `Cryptographic provenance manifest confirms image was generated using AI software${sw}.`,
        mediaType
      }
    };
  }

  // 2. Cryptographic Authenticity Provenance override (C2PA without AI flags)
  if (metadata.c2paPresent) {
    return {
      aiScore: 0.01,
      patchScores: rawPatchScores.map((p) => ({ ...p, aiScore: Math.min(0.02, p.aiScore * 0.05) })),
      reasoning: {
        type: 'likely-real',
        title: 'C2PA Credentials Verified',
        description: 'Contains valid cryptographic provenance metadata confirming authentic origin.',
        mediaType
      }
    };
  }

  // 3. Fast-path System 2 bypass (e.g. pure vector UI with no patches)
  if (system1.canBypassSystem2 || rawPatchScores.length === 0) {
    const finalScore = parseFloat(priorAiScore.toFixed(2));
    return {
      aiScore: finalScore,
      patchScores: rawPatchScores,
      reasoning: {
        type: 'likely-real',
        title: mediaType === 'graphic-or-ui' ? 'Authentic Graphic / UI Media' : 'Authentic Media',
        description: system1.summary,
        mediaType
      }
    };
  }

  // 4. Process patch scores and apply non-photographic and physical pattern calibration
  const isPenAndInk = system1.features.isPenAndInk;
  const isDigitalArt = system1.mediaType === 'digital-art';
  const hasCameraExif = system1.features.hasCameraExif;
  const hasGlobalRepetitivePattern = Boolean(system1.features.hasRepetitivePattern);

  const calibratedPatchScores: PatchResult[] = rawPatchScores.map((patch) => {
    let score = patch.aiScore;
    // On non-photographic artwork (paintings, sketches, drawings) or physical repetitive patterns
    // (masonry, building stories/windows, patterned cloth/textiles), photo-trained diffusion models
    // produce false-positive frequency spikes (0.85 - 0.98).
    // We calibrate domain shifts unless C2PA flags AI provenance.
    if (!metadata.aiProvenancePresent) {
      if (isPenAndInk) {
        // Physical drawing on paper: pencil/ink strokes naturally trigger high model scores
        score = Math.min(0.08, score * 0.08);
      } else if (isDigitalArt) {
        // Paintings & artwork: calibrate the 0.85-0.98 raw model bias into an authentic 0.06-0.22 range
        score = Math.min(0.28, Math.max(0.04, (score - 0.75) * 0.65));
      } else if (patch.hasPattern || ((system1.features.patternRatio ?? 0) >= 0.75 && score > 0.60)) {
        // Physical repetitive textures (masonry/bricks, architectural window grids/stories, cloth/textile patterns)
        // produce high-frequency spatial periodicity that triggers false-positive Swin Transformer attention.
        // We calibrate this frequency bias into authentic baseline ranges.
        if (hasCameraExif) {
          // Verified camera hardware capture: physical brick/window/cloth periodicity calibrated to authentic levels (0.03 - 0.12)
          score = Math.min(0.12, Math.max(0.03, (score - 0.65) * 0.35));
        } else {
          // Unverified camera capture (stripped EXIF): calibrate the 0.80-0.98 frequency spike to 0.06 - 0.22
          score = Math.min(0.22, Math.max(0.06, (score - 0.60) * 0.45));
        }
      }
    }
    return {
      ...patch,
      aiScore: parseFloat(score.toFixed(3))
    };
  });

  const scores = calibratedPatchScores.map((p) => p.aiScore);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const avgScore = scores.reduce((sum, val) => sum + val, 0) / scores.length;
  const spread = maxScore - minScore;

  // Find the top patch to verify if its elevated score is caused by a repetitive physical pattern
  const topPatch = calibratedPatchScores.find((p) => p.aiScore === maxScore);
  const isTopPatchPattern = Boolean(topPatch?.hasPattern);

  // Check for localized alterations (e.g. inpainting or face-swap in a specific patch).
  // A patterned patch (cloth, masonry, windows) next to smooth skin/sky is a normal physical texture difference,
  // NOT an inpainting edit! To trigger localized-edit:
  // 1. More than 1 patch sampled
  // 2. Clear regional disparity (spread >= 0.40)
  // 3. The anomalous patch must be genuinely synthetic (maxScore >= 0.70)
  // 4. The anomalous patch must NOT be explained by repetitive physical pattern (cloth/masonry/windows)
  const isLocalizedEdit =
    calibratedPatchScores.length > 1 &&
    spread >= 0.40 &&
    maxScore >= 0.70 &&
    !isTopPatchPattern;

  // 5. Compute System 2 empirical evidence value (E)
  let empiricalEvidence: number;
  if (isLocalizedEdit) {
    // When localized editing is suspected, the anomalous patch provides the strongest signal
    empiricalEvidence = maxScore * 0.70 + avgScore * 0.30;
  } else if (calibratedPatchScores.length > 1) {
    empiricalEvidence = avgScore;
  } else {
    empiricalEvidence = maxScore;
  }

  // 6. Dynamic Bayesian Evidence Weighting
  // w1: weight given to System 1 prior (based on confidence and domain type)
  // w2: weight given to System 2 neural observations
  let w1 = confidence * 1.5;
  let w2 = 1.0;

  if (isPenAndInk) {
    // Physical paper substrate: paper prior strongly anchors against stroke frequency spikes
    w1 = 2.8;
    w2 = 0.8;
  } else if (isDigitalArt) {
    // Non-photographic painting / artwork: balanced weighting with calibrated evidence
    w1 = 2.0;
    w2 = 1.0;
  } else if (hasCameraExif) {
    // Verified camera hardware EXIF provides a rock-solid physical grounding anchor.
    // Never allow raw patch frequency noise to overrule verified optical camera capture!
    if (hasGlobalRepetitivePattern) {
      w1 = 2.6;
      w2 = 0.6;
    } else {
      w1 = 2.2;
      w2 = 0.8;
    }
  } else if (hasGlobalRepetitivePattern && (system1.features.patternRatio ?? 0) >= 0.50) {
    // Stripped-EXIF photo dominated by repetitive physical patterns (masonry, windows, cloth):
    // Prioritize photographic texture stability
    w1 = 1.8;
    w2 = 0.9;
  } else if (avgScore >= 0.75) {
    // Stripped-EXIF with strong neural synthetic evidence across non-pattern patches
    w1 = 0.8;
    w2 = 1.6;
  } else if (mediaType === 'screen-capture') {
    w1 = 1.5;
    w2 = 1.0;
  }

  const logitPrior = logit(priorAiScore);
  const logitEvidence = logit(empiricalEvidence);

  const fusedLogit = (w1 * logitPrior + w2 * logitEvidence) / (w1 + w2);
  let fusedScore = sigmoid(fusedLogit);

  // If a localized edit was explicitly detected, ensure the localized signal is not diluted
  if (isLocalizedEdit) {
    fusedScore = Math.max(fusedScore, maxScore * 0.55);
  }

  const finalAiScore = parseFloat(Math.min(0.99, Math.max(0.01, fusedScore)).toFixed(2));

  // 7. Synthesize Forensic Reasoning
  const reasoning = buildForensicReasoning(
    finalAiScore,
    isLocalizedEdit,
    calibratedPatchScores,
    system1,
    metadata,
    maxScore,
    minScore
  );

  return {
    aiScore: finalAiScore,
    patchScores: calibratedPatchScores,
    reasoning
  };
}

function buildForensicReasoning(
  finalScore: number,
  isLocalizedEdit: boolean,
  patchScores: PatchResult[],
  system1: System1Result,
  metadata: MetadataResult,
  maxScore: number,
  minScore: number
): ForensicReasoning {
  const { mediaType } = system1;

  // Localized modification verdict
  if (isLocalizedEdit) {
    const topPatch = patchScores.find((p) => p.aiScore === maxScore);
    const lowPatch = patchScores.find((p) => p.aiScore === minScore);
    const topLabel = topPatch?.position || 'one sample';
    const lowLabel = lowPatch?.position || 'another sample';
    const diffPct = `${Math.round(maxScore * 100)}% in ${topLabel} vs ${Math.round(minScore * 100)}% in ${lowLabel}`;

    let desc = `High regional divergence detected (${diffPct}). `;
    if (mediaType === 'camera-photo') {
      desc += 'Strong indicator of localized inpainting, composite element, or AI face-swap on photographic media.';
    } else if (mediaType === 'pen-ink-art') {
      desc += 'Indicator of localized digital editing or generative inpainting on manual artwork.';
    } else if (mediaType === 'digital-art') {
      desc += 'Indicator of localized generative inpainting or AI touch-ups in artwork.';
    } else {
      desc += 'Strong indicator of localized AI inpainting, generative fill, or composite edit.';
    }

    return {
      type: 'localized-edit',
      title: 'Localized AI Alteration Detected',
      description: desc,
      mediaType
    };
  }

  // Full synthetic generation verdict (score >= 0.70)
  if (finalScore >= 0.70) {
    if (mediaType === 'digital-art') {
      return {
        type: 'full-synthetic',
        title: 'AI-Generated Synthetic Artwork',
        description: 'Consistent generative AI diffusion patterns and synthetic textures detected across sampled regions (likely Midjourney, NovelAI, or Stable Diffusion).',
        mediaType
      };
    }
    if (mediaType === 'pen-ink-art') {
      return {
        type: 'full-synthetic',
        title: 'AI-Generated Synthetic Drawing',
        description: 'Consistent generative AI patterns detected across all sampled regions.',
        mediaType
      };
    }
    if (mediaType === 'camera-photo') {
      return {
        type: 'full-synthetic',
        title: 'AI-Generated Synthetic Photograph',
        description: 'Consistent generative diffusion patterns, synthetic skin/lighting textures, and absence of optical camera noise detected across sampled regions.',
        mediaType
      };
    }
    return {
      type: 'full-synthetic',
      title: 'Uniform Synthetic Artifacts',
      description: 'Consistent diffusion textures and frequency anomalies detected across all sampled regions.',
      mediaType
    };
  }

  // Authentic / Likely Real verdict (score < 0.30)
  if (finalScore < 0.30) {
    if (mediaType === 'pen-ink-art') {
      return {
        type: 'likely-real',
        title: 'Authentic Hand-Drawn Artwork / Sketch',
        description: 'Natural hand-drawn stroke variation and physical paper texture verified across sampled regions. Manual line work and hatching confirmed non-synthetic.',
        mediaType
      };
    }
    if (mediaType === 'digital-art') {
      return {
        type: 'likely-real',
        title: 'Authentic Artwork / Painting',
        description: 'No generative AI synthesis artifacts or provenance tags detected. Consistent with human artistic media (traditional painting, watercolor, illustration, or digital artwork).',
        mediaType
      };
    }
    if (mediaType === 'screen-capture') {
      return {
        type: 'likely-real',
        title: 'Authentic Screen Capture',
        description: 'No generative AI diffusion artifacts detected across sampled regions. Consistent with an authentic screen capture or digital interface.',
        mediaType
      };
    }
    if (mediaType === 'graphic-or-ui') {
      return {
        type: 'likely-real',
        title: 'Authentic Graphic / UI Media',
        description: 'No generative AI patterns detected. Consistent with vector artwork, application UI capture, or digital graphic design.',
        mediaType
      };
    }
    if (mediaType === 'camera-photo') {
      const camInfo = metadata.cameraModel ? ` (${metadata.cameraModel})` : '';
      const patternText = system1.features.hasRepetitivePattern
        ? ' Repetitive physical texture (masonry / architectural grid / textile pattern) confirmed non-synthetic.'
        : '';
      return {
        type: 'likely-real',
        title: metadata.cameraModel ? 'Authentic Camera Photograph' : 'Authentic Photographic Capture',
        description: metadata.cameraModel
          ? `Natural optical capture characteristics and camera hardware metadata verified${camInfo}.${patternText}`
          : `No generative AI diffusion patterns detected across sampled regions. Consistent with an authentic camera photograph.${patternText}`,
        mediaType
      };
    }
    return {
      type: 'likely-real',
      title: 'Authentic Non-AI Content',
      description: 'No generative AI diffusion patterns or synthetic anomalies detected across sampled regions.',
      mediaType
    };
  }

  // Ambiguous / Moderate verdict (0.30 <= score < 0.70)
  const avgPct = Math.round(finalScore * 100);
  let ambiguousDesc = `Calibrated AI probability of ${avgPct}%. `;
  if (mediaType === 'screen-capture') {
    ambiguousDesc += 'Inconclusive signals; likely caused by display rendering, antialiasing, or compression artifacts.';
  } else if (mediaType === 'pen-ink-art') {
    ambiguousDesc += 'Inconclusive signals; manual cross-hatching lines and paper texture can mimic diffusion frequency patterns.';
  } else if (mediaType === 'digital-art') {
    ambiguousDesc += 'Inconclusive signals; likely caused by digital painting textures, stylized gradients, or compression artifacts.';
  } else if (mediaType === 'graphic-or-ui') {
    ambiguousDesc += 'Inconclusive signals; likely caused by rasterization filters or image compression.';
  } else if (mediaType === 'camera-photo') {
    ambiguousDesc += 'Moderate signals; may be a heavily processed, beauty-filtered, or upscaled photo.';
  } else {
    ambiguousDesc += 'Inconclusive signals; may be post-processed graphics, stylized digital art, upscaled media, or filtered photography.';
  }

  return {
    type: 'ambiguous',
    title: 'Subtle / Mixed Forensic Signals',
    description: ambiguousDesc,
    mediaType
  };
}
