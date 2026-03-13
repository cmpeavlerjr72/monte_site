// src/utils/nascarData.ts
// Driver car number color schemes and manufacturer logos for NASCAR Cup Series

/** Primary fill + secondary outline/accent for each car number's livery */
export const CAR_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  // Hendrick Motorsports
  "5":  { bg: "#002d72", text: "#ffffff", border: "#cfd4dc" },   // Larson – blue/white HendrickCars
  "9":  { bg: "#ffc423", text: "#003366", border: "#003366" },   // Elliott – NAPA yellow/blue
  "24": { bg: "#1c3f94", text: "#ffcf00", border: "#ffcf00" },   // Byron – Axalta blue/yellow
  "48": { bg: "#d69a2a", text: "#1a1a2e", border: "#1a1a2e" },   // Bowman – Ally gold/purple

  // Team Penske
  "2":  { bg: "#ffd100", text: "#002a5c", border: "#002a5c" },   // Cindric – Discount Tire yellow/blue
  "12": { bg: "#ffd200", text: "#003572", border: "#003572" },   // Blaney – Menards yellow/blue
  "22": { bg: "#ffe01b", text: "#c8102e", border: "#c8102e" },   // Logano – Shell yellow/red

  // Joe Gibbs Racing
  "11": { bg: "#4d148c", text: "#ff6200", border: "#ff6200" },   // Hamlin – FedEx purple/orange
  "19": { bg: "#c8102e", text: "#ffffff", border: "#1a3c34" },   // Briscoe – Bass Pro red/white
  "20": { bg: "#c8102e", text: "#ffffff", border: "#333333" },   // Bell – Rheem red/white
  "54": { bg: "#ffffff", text: "#c8102e", border: "#c8102e" },   // Gibbs – Monster white/red

  // 23XI Racing
  "23": { bg: "#c8102e", text: "#ffffff", border: "#1a1a1a" },   // Wallace – DoorDash red/white
  "45": { bg: "#c8102e", text: "#ffffff", border: "#1a1a1a" },   // Reddick – 23XI red/white

  // Trackhouse Racing
  "1":  { bg: "#002855", text: "#ff8200", border: "#ff8200" },   // Chastain – Advent Health blue/orange
  "7":  { bg: "#00b4d8", text: "#1a1a1a", border: "#e63946" },   // Suarez – Trackhouse teal

  // RFK Racing
  "6":  { bg: "#002a5c", text: "#ff6900", border: "#ff6900" },   // Keselowski – RFK blue/orange
  "17": { bg: "#002a5c", text: "#ff6900", border: "#ff6900" },   // Buescher – RFK blue/orange

  // Richard Childress Racing
  "3":  { bg: "#1a1a1a", text: "#c0c0c0", border: "#c0c0c0" },   // Dillon – RCR black/silver
  "8":  { bg: "#3d8b37", text: "#ffffff", border: "#1a1a1a" },   // Busch – Oakley green/white

  // Spire Motorsports
  "7s": { bg: "#00b4d8", text: "#1a1a1a", border: "#1a1a1a" },   // alt
  "71": { bg: "#ff6900", text: "#002855", border: "#002855" },   // McDowell – orange/blue
  "77": { bg: "#d4a50a", text: "#1a1a1a", border: "#1a1a1a" },   // Hocevar – gold/black

  // Wood Brothers Racing
  "21": { bg: "#8b1a1a", text: "#d4a50a", border: "#d4a50a" },   // Berry – Wood Brothers maroon/gold

  // Front Row Motorsports
  "34": { bg: "#00843d", text: "#ffffff", border: "#ffffff" },   // Gilliland – green/white
  "38": { bg: "#002a5c", text: "#ff6900", border: "#ff6900" },   // Z. Smith – blue/orange

  // Haas Factory Team
  "41": { bg: "#1a1a1a", text: "#c8102e", border: "#c8102e" },   // Custer – black/red

  // JTG Daugherty / Other
  "47": { bg: "#ffd100", text: "#002a5c", border: "#002a5c" },   // Stenhouse – yellow/blue
  "43": { bg: "#002a5c", text: "#c8102e", border: "#c8102e" },   // Jones – Petty blue/red
  "42": { bg: "#c8102e", text: "#ffffff", border: "#1a1a1a" },   // Nemechek – red/white
  "10": { bg: "#1a1a1a", text: "#c8102e", border: "#c8102e" },   // Ty Dillon – black/red
  "16": { bg: "#8b6914", text: "#ffffff", border: "#1a1a1a" },   // Allmendinger – brown/gold

  // Misc / Part-time
  "4":  { bg: "#c8102e", text: "#002a5c", border: "#002a5c" },   // Gragson – red/blue
  "51": { bg: "#4a4a4a", text: "#ffffff", border: "#ffffff" },   // Ware – gray
  "33": { bg: "#003572", text: "#ffffff", border: "#ffffff" },   // Love – blue/white
  "60": { bg: "#002a5c", text: "#ffffff", border: "#ffffff" },   // Preece – blue/white
  "35": { bg: "#c8102e", text: "#ffffff", border: "#ffffff" },   // Herbst – red/white
  "88": { bg: "#002d72", text: "#ffffff", border: "#d4a50a" },   // Zilisch – blue/gold
  "97": { bg: "#d4a50a", text: "#1a1a1a", border: "#1a1a1a" },   // SVG – gold/black
  "40": { bg: "#002a5c", text: "#ffffff", border: "#d4a50a" },   // Allgaier – blue/gold
};

/** Fallback colors by manufacturer when driver-specific colors aren't available */
export const MFR_FALLBACK: Record<string, { bg: string; text: string; border: string }> = {
  Chevrolet: { bg: "#d4a50a", text: "#1a1a1a", border: "#1a1a1a" },
  Ford:      { bg: "#002a5c", text: "#ffffff", border: "#ffffff" },
  Toyota:    { bg: "#c8102e", text: "#ffffff", border: "#ffffff" },
};

export function getCarColors(carNumber: string, manufacturer: string) {
  return CAR_COLORS[carNumber] ?? MFR_FALLBACK[manufacturer] ?? { bg: "#555", text: "#fff", border: "#333" };
}

/** Inline SVG strings for manufacturer logos (small, ~20px tall) */
export const MFR_LOGOS: Record<string, string> = {
  // Chevrolet bowtie
  Chevrolet: `<svg viewBox="0 0 60 20" xmlns="http://www.w3.org/2000/svg">
    <polygon points="0,4 20,4 24,0 36,0 40,4 60,4 60,16 40,16 36,20 24,20 20,16 0,16" fill="#d4a50a"/>
  </svg>`,

  // Ford oval
  Ford: `<svg viewBox="0 0 60 24" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="30" cy="12" rx="28" ry="11" fill="#003478" stroke="#c0c0c0" stroke-width="1.5"/>
    <text x="30" y="16.5" text-anchor="middle" font-size="14" font-family="serif" font-style="italic" font-weight="bold" fill="#ffffff">Ford</text>
  </svg>`,

  // Toyota
  Toyota: `<svg viewBox="0 0 60 24" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="30" cy="12" rx="28" ry="11" fill="#c8102e" stroke="#c8102e" stroke-width="0.5"/>
    <text x="30" y="16.5" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="bold" fill="#ffffff" letter-spacing="1.5">TOYOTA</text>
  </svg>`,
};
