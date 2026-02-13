// Deterministic ESPN CDN URL from a known team ID
export function espnLogoUrl(espnId: string | number | null | undefined): string | undefined {
  if (espnId == null || espnId === "") return undefined;
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
}

export function espnLogoDarkUrl(espnId: string | number | null | undefined): string | undefined {
  if (espnId == null || espnId === "") return undefined;
  return `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${espnId}.png`;
}

// Cached ESPN teams lookup — fetched once, shared across components
type EspnTeamEntry = { id: string; logo: string; darkLogo?: string };
let teamsByName: Map<string, EspnTeamEntry> | null = null;
let fetchPromise: Promise<Map<string, EspnTeamEntry>> | null = null;

// Keep parentheticals — they disambiguate Miami (OH) vs Miami (FLA.) etc.
// Just lowercase, collapse non-alphanumeric to single spaces, strip quotes.
function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Explicit alias map. Both sides are already in normalized form.
// We register both directions during map construction.
const ALIASES: [string, string][] = [
  // Common abbreviations
  ["nc state", "north carolina state"],
  ["nc state wolfpack", "north carolina state wolfpack"],
  ["ncsu", "north carolina state"],
  ["ucf", "central florida"],
  ["ucf knights", "central florida knights"],
  ["uconn", "connecticut"],
  ["uconn huskies", "connecticut huskies"],
  ["umass", "massachusetts"],
  ["unlv", "nevada las vegas"],
  ["utep", "texas el paso"],
  ["utsa", "texas san antonio"],
  ["unc", "north carolina"],
  ["unc greensboro", "north carolina greensboro"],
  ["unc wilmington", "north carolina wilmington"],
  ["unc asheville", "north carolina asheville"],
  ["uncg", "north carolina greensboro"],
  ["uncw", "north carolina wilmington"],
  ["smu", "southern methodist"],
  ["smu mustangs", "southern methodist mustangs"],
  ["vcu", "virginia commonwealth"],
  ["lsu", "louisiana state"],
  ["lsu tigers", "louisiana state tigers"],
  ["ole miss", "mississippi"],
  ["ole miss rebels", "mississippi rebels"],
  ["pitt", "pittsburgh"],
  ["pitt panthers", "pittsburgh panthers"],
  ["usc", "southern california"],
  ["byu", "brigham young"],
  ["byu cougars", "brigham young cougars"],
  ["tcu", "texas christian"],
  ["tcu horned frogs", "texas christian horned frogs"],
  ["etsu", "east tennessee state"],
  ["siu edwardsville", "southern illinois edwardsville"],
  ["siue", "southern illinois edwardsville"],
  ["liu", "long island university"],
  ["fiu", "florida international"],
  ["fdu", "fairleigh dickinson"],
  ["csu fullerton", "cal state fullerton"],
  ["csu northridge", "cal state northridge"],
  ["csu bakersfield", "cal state bakersfield"],
  ["csun", "cal state northridge"],
  ["lmu", "loyola marymount"],
  ["uab", "alabama birmingham"],
  ["uab blazers", "uab blazers"],
  ["ualr", "little rock"],
  ["ut martin", "tennessee martin"],
  ["ut arlington", "texas arlington"],
  ["ut rio grande valley", "texas rio grande valley"],
  ["utrgv", "texas rio grande valley"],
  ["umkc", "kansas city"],
  ["iupui", "indiana university purdue university indianapolis"],
  ["ipfw", "purdue fort wayne"],
  ["umbc", "maryland baltimore county"],
  ["uic", "illinois chicago"],
  ["niu", "northern illinois"],
  ["wku", "western kentucky"],
  ["sfa", "stephen f austin"],
  ["tamu", "texas a m"],

  // Hawaii special character — ESPN uses "hawai i" after normalize
  ["hawaii", "hawai i"],

  // Saint / St variations
  ["st marys", "saint marys"],
  ["st mary s", "saint marys"],
  ["st mary s ca", "saint marys"],
  ["st marys ca", "saint marys"],
  ["saint mary s ca", "saint marys"],
  ["saint marys ca", "saint marys"],
  ["st johns", "saint johns"],
  ["st john s", "saint johns"],
  ["st josephs", "saint josephs"],
  ["st joseph s", "saint josephs"],
  ["st peters", "saint peters"],
  ["st peter s", "saint peters"],
  ["st louis", "saint louis"],
  ["st bonaventure", "saint bonaventure"],
  ["st thomas", "saint thomas"],
  ["st thomas mn", "saint thomas"],
  ["st francis", "saint francis"],
  ["st francis pa", "saint francis"],
  ["st francis bkn", "st francis brooklyn"],

  // Miami — data files use parenthetical qualifiers
  ["miami fla", "miami hurricanes"],
  ["miami florida", "miami hurricanes"],
  ["miami fl", "miami hurricanes"],
  ["miami oh", "miami oh redhawks"],
  ["miami ohio", "miami oh redhawks"],

  // Omaha / Southern Indiana / Lindenwood
  ["omaha", "nebraska omaha"],
  ["omaha mavericks", "nebraska omaha mavericks"],
  ["southern indiana", "southern indiana screaming eagles"],
  ["lindenwood", "lindenwood lions"],

  // Schools that go by location vs full name
  ["army", "army black knights"],
  ["navy", "navy midshipmen"],
  ["usc upstate", "south carolina upstate"],
  ["loyola chicago", "loyola chicago ramblers"],
  ["loyola md", "loyola maryland"],
  ["queens", "queens university"],
  ["grambling", "grambling state"],
  ["tarleton", "tarleton state"],
  ["texas a m commerce", "east texas a m"],
  ["a m corpus christi", "texas a m corpus christi"],
  ["corpus christi", "texas a m corpus christi"],
  ["green bay", "wisconsin green bay"],
  ["milwaukee", "wisconsin milwaukee"],
  ["penn", "pennsylvania"],
  ["abil christian", "abilene christian"],
  ["col of charleston", "charleston"],
  ["college of charleston", "charleston"],
  ["central florida", "ucf knights"],
  ["central florida knights", "ucf knights"],
  ["north carolina state", "nc state wolfpack"],
  ["north carolina state wolfpack", "nc state wolfpack"],
];

export async function getEspnTeamsMap(): Promise<Map<string, EspnTeamEntry>> {
  if (teamsByName) return teamsByName;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const map = new Map<string, EspnTeamEntry>();
    try {
      const url = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500";
      const res = await fetch(url);
      if (!res.ok) return map;
      const json = await res.json();
      const teams = json?.sports?.[0]?.leagues?.[0]?.teams ?? json?.teams ?? [];
      for (const entry of teams) {
        const t = entry?.team ?? entry;
        const id = String(t?.id ?? "");
        const logo = t?.logos?.[0]?.href ?? espnLogoUrl(id) ?? "";
        const darkLogo = t?.logos?.[1]?.href ?? espnLogoDarkUrl(id);
        const item: EspnTeamEntry = { id, logo, darkLogo };

        // Index by every name variant ESPN provides
        const rawNames = [
          t?.displayName,
          t?.shortDisplayName,
          t?.name,
          t?.abbreviation,
          t?.location,
          t?.nickname,
        ];
        for (const name of rawNames) {
          if (name) {
            const key = normalize(name);
            // Don't overwrite with a shorter/less-specific key if it already
            // points to a different team (avoids "miami" clobbering)
            if (!map.has(key)) map.set(key, item);
          }
        }

        // Also index "{location} {nickname}" combo if both exist
        if (t?.location && t?.nickname) {
          map.set(normalize(`${t.location} ${t.nickname}`), item);
        }
      }

      // Register alias entries: for each alias pair, if one side is
      // already in the map, register the other side pointing to the same entry.
      // Run two passes so bi-directional links settle.
      for (let pass = 0; pass < 2; pass++) {
        for (const [a, b] of ALIASES) {
          const na = normalize(a);
          const nb = normalize(b);
          if (map.has(na) && !map.has(nb)) map.set(nb, map.get(na)!);
          if (map.has(nb) && !map.has(na)) map.set(na, map.get(nb)!);
        }
      }
    } catch (e) {
      console.warn("Failed to load ESPN teams list:", e);
    }
    teamsByName = map;
    return map;
  })();

  return fetchPromise;
}

export function lookupEspnLogo(
  teamsMap: Map<string, EspnTeamEntry>,
  teamName: string
): EspnTeamEntry | undefined {
  if (!teamName) return undefined;
  const key = normalize(teamName);

  // 1. Direct match
  const direct = teamsMap.get(key);
  if (direct) return direct;

  // 2. Try stripping leading "university of"
  const noUniv = key.replace(/^university of /, "");
  if (noUniv !== key) {
    const m = teamsMap.get(noUniv);
    if (m) return m;
  }

  // 3. If name has "st " prefix, try "saint "
  if (key.startsWith("st ")) {
    const m = teamsMap.get("saint" + key.slice(2));
    if (m) return m;
  }
  // And vice-versa
  if (key.startsWith("saint ")) {
    const m = teamsMap.get("st" + key.slice(5));
    if (m) return m;
  }

  return undefined;
}
