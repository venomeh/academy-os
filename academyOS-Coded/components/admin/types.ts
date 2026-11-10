/** Real aging-bucket keys from convex/model/ledger.ts — distinct from their display labels. */
export type AgingBucketKey = "current" | "7d_gentle" | "14d_firm" | "30d_final";

export const BUCKET_LABEL: Record<AgingBucketKey, string> = {
  current: "Current",
  "7d_gentle": "7+ days",
  "14d_firm": "14+ days",
  "30d_final": "30+ days",
};

export const BUCKET_COLOR: Record<AgingBucketKey, string> = {
  current: "#0D0D0D",
  "7d_gentle": "#C99A2E",
  "14d_firm": "#D9791F",
  "30d_final": "#B4231F",
};
