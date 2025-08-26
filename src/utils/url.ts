export function fixLogoUrl(u?: string) {
    if (!u) return undefined;
    let s = u.trim();
    if (s.startsWith("//")) return "https:" + s;        // protocol-less -> https
    if (s.startsWith("http://")) return "https://" + s.slice(7); // force https
    return s;
  }
  