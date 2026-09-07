// GENERATED FILE — do not edit by hand.
//
//   node scripts/gen_fbs_conferences.mjs          # regenerate
//   node scripts/check_edge_rules.mjs             # fails on drift
//
// Source: src/assets/team_info.csv (CFBD's team table, the same file the
// Results / CLV / BestBets pages parse). Only the 138 FBS rows are kept, and
// only the one column the week-2 decision rules need — the conference, which
// decides whether a school is P4/independent (src/lib/edgeRules.ts).
//
// Keys are `cfbNameKey` (server/cfbNames.ts), the site's ONE team-name
// normalizer, so a slate spelling and CFBD's spelling land on the same entry
// without a second alias table ("Massachusetts" / "UMass" is the live case).
// The generator refuses to emit a file where two different FBS schools share
// a key, so a lookup here can never quietly answer for the wrong team.

/** cfbNameKey(school) -> CFBD conference name, FBS only. */
export const FBS_CONFERENCE: Readonly<Record<string, string>> = {
  "airforce": "Mountain West", // Air Force
  "akron": "Mid-American", // Akron
  "alabama": "SEC", // Alabama
  "appstate": "Sun Belt", // App State
  "arizona": "Big 12", // Arizona
  "arizonastate": "Big 12", // Arizona State
  "arkansas": "SEC", // Arkansas
  "arkansasstate": "Sun Belt", // Arkansas State
  "army": "American Athletic", // Army
  "auburn": "SEC", // Auburn
  "ballstate": "Mid-American", // Ball State
  "baylor": "Big 12", // Baylor
  "boisestate": "Mountain West", // Boise State
  "bostoncollege": "ACC", // Boston College
  "bowlinggreen": "Mid-American", // Bowling Green
  "buffalo": "Mid-American", // Buffalo
  "byu": "Big 12", // BYU
  "california": "ACC", // California
  "centralmichigan": "Mid-American", // Central Michigan
  "charlotte": "American Athletic", // Charlotte
  "cincinnati": "Big 12", // Cincinnati
  "clemson": "ACC", // Clemson
  "coastalcarolina": "Sun Belt", // Coastal Carolina
  "colorado": "Big 12", // Colorado
  "coloradostate": "Mountain West", // Colorado State
  "delaware": "Conference USA", // Delaware
  "duke": "ACC", // Duke
  "eastcarolina": "American Athletic", // East Carolina
  "easternmichigan": "Mid-American", // Eastern Michigan
  "florida": "SEC", // Florida
  "floridaatlantic": "American Athletic", // Florida Atlantic
  "floridainternational": "Conference USA", // Florida International
  "floridastate": "ACC", // Florida State
  "fresnostate": "Mountain West", // Fresno State
  "georgia": "SEC", // Georgia
  "georgiasouthern": "Sun Belt", // Georgia Southern
  "georgiastate": "Sun Belt", // Georgia State
  "georgiatech": "ACC", // Georgia Tech
  "hawaii": "Mountain West", // Hawai'i
  "houston": "Big 12", // Houston
  "illinois": "Big Ten", // Illinois
  "indiana": "Big Ten", // Indiana
  "iowa": "Big Ten", // Iowa
  "iowastate": "Big 12", // Iowa State
  "jacksonvillestate": "Conference USA", // Jacksonville State
  "jamesmadison": "Sun Belt", // James Madison
  "kansas": "Big 12", // Kansas
  "kansasstate": "Big 12", // Kansas State
  "kennesawstate": "Conference USA", // Kennesaw State
  "kentstate": "Mid-American", // Kent State
  "kentucky": "SEC", // Kentucky
  "liberty": "Conference USA", // Liberty
  "louisiana": "Sun Belt", // Louisiana
  "louisianatech": "Conference USA", // Louisiana Tech
  "louisville": "ACC", // Louisville
  "lsu": "SEC", // LSU
  "marshall": "Sun Belt", // Marshall
  "maryland": "Big Ten", // Maryland
  "massachusetts": "Mid-American", // UMass
  "memphis": "American Athletic", // Memphis
  "miami": "ACC", // Miami
  "miamioh": "Mid-American", // Miami (OH)
  "michigan": "Big Ten", // Michigan
  "michiganstate": "Big Ten", // Michigan State
  "middletennessee": "Conference USA", // Middle Tennessee
  "minnesota": "Big Ten", // Minnesota
  "mississippistate": "SEC", // Mississippi State
  "missouri": "SEC", // Missouri
  "missouristate": "Conference USA", // Missouri State
  "navy": "American Athletic", // Navy
  "nebraska": "Big Ten", // Nebraska
  "nevada": "Mountain West", // Nevada
  "newmexico": "Mountain West", // New Mexico
  "newmexicostate": "Conference USA", // New Mexico State
  "northcarolina": "ACC", // North Carolina
  "northcarolinastate": "ACC", // NC State
  "northdakotastate": "Missouri Valley", // North Dakota State
  "northernillinois": "Mid-American", // Northern Illinois
  "northtexas": "American Athletic", // North Texas
  "northwestern": "Big Ten", // Northwestern
  "notredame": "FBS Independents", // Notre Dame
  "ohio": "Mid-American", // Ohio
  "ohiostate": "Big Ten", // Ohio State
  "oklahoma": "SEC", // Oklahoma
  "oklahomastate": "Big 12", // Oklahoma State
  "olddominion": "Sun Belt", // Old Dominion
  "olemiss": "SEC", // Ole Miss
  "oregon": "Big Ten", // Oregon
  "oregonstate": "Pac-12", // Oregon State
  "pennstate": "Big Ten", // Penn State
  "pittsburgh": "ACC", // Pittsburgh
  "purdue": "Big Ten", // Purdue
  "rice": "American Athletic", // Rice
  "rutgers": "Big Ten", // Rutgers
  "sacramentostate": "Big Sky", // Sacramento State
  "samhouston": "Conference USA", // Sam Houston
  "sandiegostate": "Mountain West", // San Diego State
  "sanjosestate": "Mountain West", // San José State
  "smu": "ACC", // SMU
  "southalabama": "Sun Belt", // South Alabama
  "southcarolina": "SEC", // South Carolina
  "southernmiss": "Sun Belt", // Southern Miss
  "southflorida": "American Athletic", // South Florida
  "stanford": "ACC", // Stanford
  "syracuse": "ACC", // Syracuse
  "tcu": "Big 12", // TCU
  "temple": "American Athletic", // Temple
  "tennessee": "SEC", // Tennessee
  "texas": "SEC", // Texas
  "texasaandm": "SEC", // Texas A&M
  "texasstate": "Sun Belt", // Texas State
  "texastech": "Big 12", // Texas Tech
  "toledo": "Mid-American", // Toledo
  "troy": "Sun Belt", // Troy
  "tulane": "American Athletic", // Tulane
  "tulsa": "American Athletic", // Tulsa
  "uab": "American Athletic", // UAB
  "ucf": "Big 12", // UCF
  "ucla": "Big Ten", // UCLA
  "uconn": "FBS Independents", // UConn
  "ulmonroe": "Sun Belt", // UL Monroe
  "unlv": "Mountain West", // UNLV
  "usc": "Big Ten", // USC
  "utah": "Big 12", // Utah
  "utahstate": "Mountain West", // Utah State
  "utep": "Conference USA", // UTEP
  "utsa": "American Athletic", // UTSA
  "vanderbilt": "SEC", // Vanderbilt
  "virginia": "ACC", // Virginia
  "virginiatech": "ACC", // Virginia Tech
  "wakeforest": "ACC", // Wake Forest
  "washington": "Big Ten", // Washington
  "washingtonstate": "Pac-12", // Washington State
  "westernkentucky": "Conference USA", // Western Kentucky
  "westernmichigan": "Mid-American", // Western Michigan
  "westvirginia": "Big 12", // West Virginia
  "wisconsin": "Big Ten", // Wisconsin
  "wyoming": "Mountain West", // Wyoming
};

/** CFBD's own spellings, in the same order — the offline fixture
 *  scripts/check_edge_rules.mjs asserts every one of them still places. */
export const FBS_SCHOOLS: readonly string[] = [
  "Air Force",
  "Akron",
  "Alabama",
  "App State",
  "Arizona",
  "Arizona State",
  "Arkansas",
  "Arkansas State",
  "Army",
  "Auburn",
  "Ball State",
  "Baylor",
  "Boise State",
  "Boston College",
  "Bowling Green",
  "Buffalo",
  "BYU",
  "California",
  "Central Michigan",
  "Charlotte",
  "Cincinnati",
  "Clemson",
  "Coastal Carolina",
  "Colorado",
  "Colorado State",
  "Delaware",
  "Duke",
  "East Carolina",
  "Eastern Michigan",
  "Florida",
  "Florida Atlantic",
  "Florida International",
  "Florida State",
  "Fresno State",
  "Georgia",
  "Georgia Southern",
  "Georgia State",
  "Georgia Tech",
  "Hawai'i",
  "Houston",
  "Illinois",
  "Indiana",
  "Iowa",
  "Iowa State",
  "Jacksonville State",
  "James Madison",
  "Kansas",
  "Kansas State",
  "Kennesaw State",
  "Kent State",
  "Kentucky",
  "Liberty",
  "Louisiana",
  "Louisiana Tech",
  "Louisville",
  "LSU",
  "Marshall",
  "Maryland",
  "UMass",
  "Memphis",
  "Miami",
  "Miami (OH)",
  "Michigan",
  "Michigan State",
  "Middle Tennessee",
  "Minnesota",
  "Mississippi State",
  "Missouri",
  "Missouri State",
  "Navy",
  "Nebraska",
  "Nevada",
  "New Mexico",
  "New Mexico State",
  "North Carolina",
  "NC State",
  "North Dakota State",
  "Northern Illinois",
  "North Texas",
  "Northwestern",
  "Notre Dame",
  "Ohio",
  "Ohio State",
  "Oklahoma",
  "Oklahoma State",
  "Old Dominion",
  "Ole Miss",
  "Oregon",
  "Oregon State",
  "Penn State",
  "Pittsburgh",
  "Purdue",
  "Rice",
  "Rutgers",
  "Sacramento State",
  "Sam Houston",
  "San Diego State",
  "San José State",
  "SMU",
  "South Alabama",
  "South Carolina",
  "Southern Miss",
  "South Florida",
  "Stanford",
  "Syracuse",
  "TCU",
  "Temple",
  "Tennessee",
  "Texas",
  "Texas A&M",
  "Texas State",
  "Texas Tech",
  "Toledo",
  "Troy",
  "Tulane",
  "Tulsa",
  "UAB",
  "UCF",
  "UCLA",
  "UConn",
  "UL Monroe",
  "UNLV",
  "USC",
  "Utah",
  "Utah State",
  "UTEP",
  "UTSA",
  "Vanderbilt",
  "Virginia",
  "Virginia Tech",
  "Wake Forest",
  "Washington",
  "Washington State",
  "Western Kentucky",
  "Western Michigan",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
];
