import { localizeLogoUrl } from "./espnLogos";

// Kept for existing callers: rewrites ESPN CDN logo URLs to our self-hosted
// copies and forces https on anything else.
export function fixLogoUrl(u?: string) {
  return localizeLogoUrl(u);
}
