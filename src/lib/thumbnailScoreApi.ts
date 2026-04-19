export type ThumbnailScoreBreakdown = {
  typicalityVsDataset: number
  textBandVsDataset: number
  textBandProxy: number
  yoloWorldTextAreaRatio?: number
  yoloWorldTextBoxCountNorm?: number
  yoloWorldTextCenterY?: number
  yoloWorldTextBottomZoneFrac?: number
  yoloPersonsApprox: number
  yoloMaxBoxAreaRatio: number
  colorSaturationMean: number
  edgeDensityBottomThird: number
  heuristicTextBandBottom?: number
  /** Subtracted from score when detected text area is very small (Model 4). */
  textVisibilityPenalty?: number
}

export type ThumbnailScoreResponse = {
  score: number
  model: string
  trainedOnDataset: boolean
  nCalibrationSamples: number
  breakdown: ThumbnailScoreBreakdown
}

export async function scoreThumbnailApi(
  thumbnailDataUrl: string,
): Promise<ThumbnailScoreResponse> {
  const res = await fetch('/api/score-thumbnail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thumbnailDataUrl }),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: string; hint?: string }
      msg = [j.error, j.hint].filter(Boolean).join(' — ') || text
    } catch {
      /* raw */
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return JSON.parse(text) as ThumbnailScoreResponse
}
