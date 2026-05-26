// =============================================================
//  3D Map Data — multiple buildings, selected via ?building= URL param.
//
//  Two buildings registered:
//    - cam        : Cincinnati Art Museum (default)
//    - aba-jifar  : Aba Jifar Palace (Jimma, Ethiopia)
//
//  All the existing exports (CATEGORIES, FLOORS, ROOMS, PLAN_BOUNDS)
//  resolve to whichever building is active so the rest of the app
//  doesn't have to change.
// =============================================================

const CAM_CATEGORIES = {
  african:      { label: "African Art",                   color: 0xE5277B },
  american:     { label: "American Art",                   color: 0xE63946 },
  ancient:      { label: "Ancient Art",                    color: 0xF0A92B },
  asian:        { label: "Asian & Islamic Art",            color: 0x2E7D5B },
  european:     { label: "European Art",                   color: 0x3F4C9C },
  modern:       { label: "Modern & Contemporary Art",      color: 0xF39C2E },
  exhibition:   { label: "Exhibition & Special Spaces",    color: 0xB7BCC4 },
  library:      { label: "Mary R. Schiff Library",         color: 0x5E6470 },
  amenity:      { label: "Amenity",                        color: 0x8A93A0 },
  circulation:  { label: "Circulation / Hall",             color: 0xD8D6CF },
  courtyard:    { label: "Courtyard",                      color: 0xC8D7C2 },
};

// Floor metadata
const CAM_FLOORS = [
  { id: 1, label: "First Floor",  y: 0,  height: 4.2, fbx: null },
  { id: 2, label: "Second Floor", y: 6,  height: 4.0, fbx: null },
  { id: 3, label: "Third Floor",  y: 12, height: 3.8, fbx: null },
];

// Helper to build a rectangular room.
const r = (id, name, category, x, z, w, d, floor, extra = {}) => ({
  id, name, category, floor,
  footprint: { x, z, w, d },
  ...extra,
});

// =============================================================
//  FIRST FLOOR — galleries 101-147 + amenities
// =============================================================
const floor1 = [
  // Top corridor of galleries
  r("105", "Gallery 105", "african",    8,  0, 4, 3, 1),
  r("107", "Gallery 107", "exhibition", 12, 0, 4, 3, 1),
  r("108", "Gallery 108", "exhibition", 16, 0, 4, 3, 1),
  r("110", "Gallery 110", "american",   20, 0, 4, 3, 1),
  r("111", "Gallery 111", "american",   24, 0, 4, 3, 1),
  r("112", "Gallery 112", "american",   28, 0, 4, 3, 1),
  r("114", "Gallery 114 — Special Feature", "exhibition", 32, 0, 4, 3, 1, { feature: true }),
  r("116", "Gallery 116", "american",   36, 0, 4, 3, 1),

  // Second row
  r("103", "Gallery 103", "african",     0, 3, 4, 4, 1),
  r("104", "Gallery 104", "african",     4, 3, 4, 4, 1),
  r("117", "Gallery 117", "american",    8, 3, 4, 4, 1),
  r("118", "Gallery 118", "american",   12, 3, 4, 4, 1),
  r("119", "Gallery 119", "american",   16, 3, 4, 4, 1),
  r("120", "Gallery 120", "american",   20, 3, 4, 4, 1),
  r("121", "Gallery 121", "american",   24, 3, 4, 4, 1),
  r("122", "Gallery 122", "american",   28, 3, 8, 4, 1),
  r("131", "Gallery 131", "amenity",    36, 3, 4, 4, 1),

  // Great Hall + side galleries
  r("greatHall", "Great Hall", "circulation", 8, 7, 12, 8, 1, { tall: true }),
  r("102", "Gallery 102", "asian",       4, 7, 4, 4, 1),
  r("101", "Gallery 101", "asian",       0, 7, 4, 8, 1),
  r("123", "Gallery 123", "ancient",    20, 7, 4, 4, 1),
  r("124", "Gallery 124", "ancient",    24, 7, 4, 4, 1),
  r("125", "Gallery 125", "ancient",    20, 11, 4, 4, 1),
  r("126", "Gallery 126", "ancient",    28, 7, 8, 8, 1),

  // Education / courtyard band
  r("rec",   "Rosenthal Education Center", "amenity",      8, 15, 8, 4, 1),
  r("130",   "Gallery 130", "asian",                      16, 15, 4, 4, 1),
  r("courtyard", "Alice Bimel Courtyard", "courtyard",    20, 15, 12, 8, 1, { open: true }),
  r("137", "Gallery 137", "asian",                        32, 15, 4, 4, 1),
  r("138", "Gallery 138", "asian",                        36, 15, 4, 4, 1),

  // Bottom band
  r("140", "Gallery 140", "asian",                        32, 19, 4, 4, 1),
  r("141", "Gallery 141", "asian",                        36, 19, 4, 4, 1),
  r("143", "Gallery 143 — South Asian Art", "asian",      40, 15, 4, 4, 1),
  r("146", "Gallery 146", "asian",                        40, 19, 4, 4, 1),
  r("147", "Gallery 147 — Ancient Middle Eastern", "ancient", 32, 23, 4, 4, 1),
  r("145", "Gallery 145", "asian",                        36, 23, 4, 4, 1),

  // Amenities
  r("elevA", "Elevator A — Floors G-2", "amenity",  4, 0, 2, 2, 1, { icon: "A" }),
  r("elevB", "Elevator B — Floors 1-3", "amenity", 20, 19, 2, 2, 1, { icon: "B" }),
  r("elevC", "Elevator C — Floors 1-2", "amenity", 40, 11, 2, 2, 1, { icon: "C" }),
  r("info",  "Information", "amenity",             14, 28, 4, 2, 1),
  r("shop",  "Museum Shop", "amenity",             20, 28, 6, 2, 1),
  r("cafe",  "Terrace Café", "amenity",            28, 28, 6, 2, 1),
  r("mycam", "MyCAM", "amenity",                   36, 28, 4, 2, 1),
  r("entrance", "Main Entrance", "amenity",        10, 31, 6, 1.5, 1, { entrance: true }),
];

// =============================================================
//  SECOND FLOOR — galleries 201-235 + amenities
// =============================================================
const floor2 = [
  // Top band
  r("233", "Gallery 233", "exhibition",  4,  0, 24, 3, 2),
  r("230", "Gallery 230", "modern",      4,  3, 4, 3, 2),
  r("231", "Gallery 231", "modern",      8,  3, 4, 3, 2),
  r("210", "Gallery 210", "european",   12,  3, 4, 3, 2),
  r("211", "Gallery 211", "european",   16,  3, 4, 3, 2),
  r("212", "Gallery 212", "american",   20,  3, 4, 3, 2),
  r("213", "Gallery 213", "american",   24,  3, 4, 3, 2),

  // Mid band — European galleries cluster
  r("229", "Gallery 229", "modern",      0, 6, 4, 4, 2),
  r("228", "Gallery 228", "modern",      4, 6, 4, 4, 2),
  r("224", "Gallery 224", "european",    8, 6, 4, 4, 2),
  r("214", "Gallery 214", "european",   12, 6, 4, 4, 2),
  r("215", "Gallery 215", "european",   16, 6, 4, 4, 2),
  r("216", "Gallery 216 — Special",     "exhibition", 20, 6, 4, 4, 2, { feature: true }),
  r("221", "Gallery 221", "european",   24, 6, 4, 4, 2),

  // Lower mid
  r("227", "Gallery 227", "modern",      0, 10, 4, 4, 2),
  r("226", "Gallery 226", "modern",      4, 10, 4, 4, 2),
  r("225", "Gallery 225", "modern",      8, 10, 4, 4, 2),
  r("222", "Gallery 222", "european",   12, 10, 8, 4, 2),
  r("217", "Gallery 217", "european",   20, 10, 4, 4, 2),
  r("218", "Gallery 218", "european",   24, 10, 4, 4, 2),
  r("219", "Gallery 219", "european",   28, 10, 4, 4, 2),

  // South wing
  r("220", "Gallery 220", "european",   12, 14, 4, 4, 2),
  r("232", "Gallery 232", "exhibition",  4, 14, 8, 6, 2),
  r("208", "Gallery 208", "european",   28, 14, 4, 4, 2),
  r("209", "Gallery 209", "european",   28, 18, 4, 4, 2),
  // Gallery 207 was previously 8 wide and overlapped Gallery 206 at (20,18) —
  // two rooms sharing the same footprint caused z-fighting on transparent
  // walls/floor tiles. Shrunk to 4 wide so 207 sits left of 206.
  r("207", "Gallery 207 (Mezzanine)", "european", 16, 18, 4, 4, 2),

  // Library wing (south-east)
  r("201", "Gallery 201", "european",   16, 22, 4, 4, 2),
  r("202", "Gallery 202", "european",   20, 22, 4, 4, 2),
  r("203", "Gallery 203", "european",   24, 22, 4, 4, 2),
  r("204", "Gallery 204", "european",   28, 22, 4, 4, 2),
  r("205", "Gallery 205", "european",   24, 18, 4, 4, 2),
  r("206", "Gallery 206", "european",   20, 18, 4, 4, 2),

  // Library (round amenity)
  r("library", "Mary R. Schiff Library", "library", 32, 22, 8, 6, 2, { round: true }),

  // Amenities
  r("elevA-2", "Elevator A", "amenity",  4, 3, 2, 2, 2, { icon: "A" }),
  r("elevB-2", "Elevator B", "amenity",  8, 10, 2, 2, 2, { icon: "B" }),
  r("elevC-2", "Elevator C", "amenity", 28, 14, 2, 2, 2, { icon: "C" }),
  r("elevD-2", "Elevator D — Library access", "amenity", 30, 22, 2, 2, 2, { icon: "D" }),
];

// =============================================================
//  THIRD FLOOR — Modern & Contemporary
// =============================================================
const floor3 = [
  r("303", "Gallery 303", "modern",   8, 4, 8, 6, 3),
  r("302", "Gallery 302", "modern",  16, 4, 4, 6, 3),
  r("301", "Gallery 301", "modern",  20, 4, 4, 6, 3),
  r("301-feature", "Modern & Contemporary Feature", "exhibition", 12, 2, 4, 2, 3, { feature: true }),
  r("elevB-3", "Elevator B", "amenity", 22, 10, 2, 2, 3, { icon: "B" }),
];

const CAM_ROOMS = [...floor1, ...floor2, ...floor3];

// Plan bounds (used for camera framing)
const CAM_PLAN_BOUNDS = { minX: 0, maxX: 44, minZ: 0, maxZ: 33 };

// =============================================================
//  ABA JIFAR PALACE — Jimma, Ethiopia
//  Historic palace complex of King Aba Jifar II of Jimma Kingdom.
//  Approximate room footprints derived from the architectural
//  site plan. Single ground-floor level. Two main building
//  clusters: the palace itself (Justice / Military / Admin) and
//  the family compound (3 Aba Jifar family rooms) with adjacent
//  Industry and Trade pavilions.
// =============================================================

const ABA_CATEGORIES = {
  entrance:   { label: "Entrance",                 labelAm: "መግቢያ",                   color: 0xe2a39e },
  royal:      { label: "Aba Jifar II",             labelAm: "አባ ጂፋር II",               color: 0xd9cca0 },
  history:    { label: "Founding History",         labelAm: "የመቋቋም ታሪክ",              color: 0xb89f74 },
  religion:   { label: "Religion in the Kingdom",  labelAm: "ሃይማኖት በመንግሥቱ",          color: 0xc88a6e },
  kingdom:    { label: "Gibe Kingdom",             labelAm: "የጊቤ መንግሥት",              color: 0x7d4e34 },
  governance: { label: "Governance",               labelAm: "አስተዳደር",                color: 0x5e6537 },
  economy:    { label: "Economy",                  labelAm: "ኢኮኖሚ",                   color: 0x6e4a2c },
  culture:    { label: "Wrestling & Sport",        labelAm: "ትግል እና ስፖርት",           color: 0x9d9888 },
  ceremonial: { label: "Ceremonial Halls",         labelAm: "ሥነ ሥርዓት አዳራሾች",        color: 0xd1b25c },
  womens:     { label: "Women in the Kingdom",     labelAm: "ሴቶች በመንግሥቱ",            color: 0xc97784 },
  family:     { label: "Family Rooms",             labelAm: "የቤተሰብ ክፍሎች",            color: 0xb29a72 },
};

const ABA_FLOORS = [
  { id: 1, label: "Ground Floor", y: 0, height: 4.5, fbx: null,
    mapTexture: "assets/aba-jifar-ground.svg" },
  // First floor — no underlying SVG plan; only the extruded room
  // blocks are rendered, floating at floor.y over the void.
  { id: 2, label: "First Floor",  y: 6, height: 4.5, fbx: null },
];

const aj = (id, name, category, x, z, w, d, floor, extra = {}) => ({
  id, name, category, floor, footprint: { x, z, w, d }, ...extra,
});

// Aba Jifar room polygons extracted from the official SVG floor plans by
// tools/build-aba-jifar-rooms.js. Each entry has both the axis-aligned
// bbox (used for camera framing, search, etc.) and the EXACT polygon
// vertices in world coords, which floors.js extrudes via THREE.Shape so
// the 3D block matches the rotated SVG polygon shape exactly.
import abaJifarRoomData from "./aba-jifar-rooms.json" with { type: "json" };

// Build a quick lookup of polygon vertices by room id so we can attach
// them as `room.polygon` when assembling ABA_ROOMS below.
const abaPolygons = new Map(abaJifarRoomData.rooms.map((r) => [r.id, r.points]));

const ABA_ROOMS = [
  // ============ Ground Floor (1) ============

  // Palace block (mid-west)
  aj("4",  "Aba Jifar II",                             "royal",      11.10, 15.54, 4.32, 5.88, 1),
  aj("2",  "Geda System",                              "history",    15.78, 15.72, 2.46, 1.56, 1),
  aj("3",  "State Formation",                          "history",    15.42, 17.46, 2.58, 1.98, 1),
  aj("1",  "Entrance",                                 "entrance",   15.24, 19.68, 2.70, 1.92, 1, { entrance: true }),

  // Religion pavilion (free-standing, south of palace)
  aj("5",  "Role of Islam in State Formation",         "religion",   13.86, 24.48, 3.84, 2.94, 1),

  // Larger building (centre, square plan). Ground floor solid.
  aj("16", "Aba Jifar II Palace Construction Method", "history",    21.84,  4.74, 2.40, 5.10, 1),
  aj("18", "Courtyard",                                "ceremonial", 23.76,  4.92, 8.58, 7.62, 1),
  aj("17", "Wrestling",                                "culture",    24.72,  8.04, 4.08, 3.84, 1, { open: true }),
  aj("15", "Gibe Kingdom",                             "kingdom",    22.38, 13.44, 7.20, 3.54, 1),

  // Free-standing pavilions
  aj("19", "Women's Role in the Kingdom",              "womens",     35.10,  4.50, 4.86, 4.02, 1),
  // Banquet Hall (room 20) removed — was off in the south plaza far
  // from the rest of the compound.

  // ============ First Floor (2) ============

  // Palace block upstairs
  aj("8",  "Administration and Diplomacy", "governance", 11.10, 15.60, 6.90, 1.50, 2),
  aj("7",  "Military and Defense",         "governance", 11.10, 16.98, 3.96, 4.32, 2),
  aj("6",  "Justice Dispensation",         "governance", 15.06, 17.28, 2.88, 4.08, 2),

  // Larger building upstairs — U-shape (Industry top, Agriculture left,
  // Trade right). Quadrilaterals that share corners with the top bar;
  // footprint bboxes match aba-jifar-rooms.json so search/camera framing
  // land on the actual extruded polygon, not the old bbox synthesis.
  aj("10", "Industry",                     "economy",    22.39,  4.33, 10.10, 3.04, 2),
  aj("9",  "Agriculture",                  "economy",    21.29,  4.33,  2.81, 7.47, 2),
  aj("11", "Trade",                        "economy",    29.75,  5.70,  2.74, 7.19, 2),

  // Family rooms — three detached small buildings in the south courtyard
  aj("14", "Aba Jifar Family Room 3",      "family",     22.32, 13.26, 1.98, 3.06, 2),
  aj("13", "Aba Jifar Family Room 2",      "family",     24.24, 13.50, 3.66, 3.30, 2),
  aj("12", "Aba Jifar Family Room 1",      "family",     27.84, 13.98, 1.86, 3.06, 2),
];

// Attach polygon vertices (from the SVG) to each room so floors.js can
// extrude the actual rotated shape instead of an axis-aligned box.
for (const r of ABA_ROOMS) {
  const poly = abaPolygons.get(r.id);
  if (poly) r.polygon = poly;
}

// Trilingual room content (English / Amharic / Afaan Oromo) ported from
// the museum's interactive guide prototype. Used by main.js to populate
// the info panel narrative and the search index. Each entry has:
//   subtype     → short type / category label per language
//   description → 1-2 sentence narrative shown under the room title
// Room 20 (Banquet Hall) is intentionally left out — the room block
// was removed from this build.
const ABA_ROOM_CONTENT = {
  1: {
    subtype: { en: "Visitor Start", am: "የጎብኚ መጀመሪያ", or: "Jalqaba Daawwattootaa" },
    description: {
      en: "Start the museum journey here. Visitors can choose a language, view room information, and follow the museum route.",
      am: "የሙዚየሙን ጉብኝት ከዚህ ይጀምሩ። ቋንቋ ይምረጡ፣ የክፍሎቹን መረጃ ይመልከቱ፣ እና የመንገዱን ምልክቶች ይከተሉ።",
      or: "Daawwannaa muuziyeemii as irraa jalqabi. Afaan filadhu, odeeffannoo kutaa ilaali, daandii tuqaa hordofi.",
    },
  },
  2: {
    subtype: { en: "History Gallery", am: "የታሪክ ክፍል", or: "Kutaa Seenaa" },
    description: {
      en: "This section introduces the Geda system as an important social, political, and cultural institution.",
      am: "ይህ ክፍል የገዳ ስርዓትን እንደ ማህበራዊ፣ ፖለቲካዊ እና ባህላዊ ተቋም ያቀርባል።",
      or: "Kutaan kun Sirna Gadaa akka dhaabbata hawaasaa, siyaasaa fi aadaa barbaachisaa tahetti ibsa.",
    },
  },
  3: {
    subtype: { en: "History Gallery", am: "የታሪክ ክፍል", or: "Kutaa Seenaa" },
    description: {
      en: "Learn how local political structures developed into organized state systems.",
      am: "የአካባቢ ፖለቲካዊ መዋቅሮች ወደ የተደራጀ መንግስት እንዴት እንደተለወጡ ይመልከቱ።",
      or: "Caasaaleen siyaasaa naannoo gara mootummaa qindaaʼetti akkamitti akka guddatan ilaali.",
    },
  },
  4: {
    subtype: { en: "Biography Gallery", am: "የሕይወት ታሪክ ክፍል", or: "Kutaa Seenaa Jireenyaa" },
    description: {
      en: "This gallery presents Aba Jifar II, his leadership, palace history, diplomacy, trade, and legacy.",
      am: "ይህ ክፍል ስለ አባ ጅፋር ሁለተኛ፣ መሪነቱ፣ ቤተመንግስት፣ ዲፕሎማሲ፣ ንግድ እና ቅርሱ ያቀርባል።",
      or: "Kutaan kun waaʼee Abbaa Jifaar II, hooggansa isaa, seenaa masaraa, dippiloomaasii, daldalaa fi hambaa isaa dhiheessa.",
    },
  },
  5: {
    subtype: { en: "Religion and State", am: "ሃይማኖትና መንግስት", or: "Amantii fi Mootummaa" },
    description: {
      en: "Explore the role of Islam in education, culture, trade networks, political authority, and state development.",
      am: "እስልምና በትምህርት፣ ባህል፣ ንግድ መስመሮች እና ፖለቲካዊ ሥርዓት ያለውን ሚና ይመልከቱ።",
      or: "Gahee Islaamaa barnoota, aadaa, daldala, aangoo siyaasaa fi guddina mootummaa keessatti ilaali.",
    },
  },
  6: {
    subtype: { en: "First Floor Gallery", am: "የመጀመሪያ ወለል ክፍል", or: "Kutaa Darbii Jalqabaa" },
    description: {
      en: "This first-floor stop explains traditional justice, decision making, and systems of conflict resolution.",
      am: "ይህ ክፍል ስለ ባህላዊ ፍትሕ፣ ውሳኔ አሰጣጥ እና ግጭት መፍትሔ ያብራራል።",
      or: "Buufanni kun haqaa aadaa, murtii kennuu fi mala walitti buʼiinsa hiikuu ibsa.",
    },
  },
  7: {
    subtype: { en: "First Floor Gallery", am: "የመጀመሪያ ወለል ክፍል", or: "Kutaa Darbii Jalqabaa" },
    description: {
      en: "This room introduces defense organization, military objects, protection systems, and historical security practices.",
      am: "ይህ ክፍል የመከላከያ አደረጃጀት፣ የጦር እቃዎች እና የደህንነት ልምዶችን ያሳያል።",
      or: "Kutaan kun qindaaʼina ittisaa, meeshaalee waraanaa fi muuxannoo nageenyaa agarsiisa.",
    },
  },
  8: {
    subtype: { en: "First Floor Gallery", am: "የመጀመሪያ ወለል ክፍል", or: "Kutaa Darbii Jalqabaa" },
    description: {
      en: "This gallery explains administration, leadership communication, diplomacy, and relations with neighboring powers.",
      am: "ይህ ክፍል አስተዳደር፣ የመሪነት ግንኙነት፣ ዲፕሎማሲ እና ጎረቤት ኃይሎች ጋር ግንኙነት ያብራራል።",
      or: "Kutaan kun bulchiinsa, qunnamtii hoggansa, dippiloomaasii fi walitti dhufeenya humnoota ollaa ibsa.",
    },
  },
  9: {
    subtype: { en: "First Floor Gallery", am: "የመጀመሪያ ወለል ክፍል", or: "Kutaa Darbii Jalqabaa" },
    description: {
      en: "This section presents farming systems, tools, food production, land use, and agricultural knowledge.",
      am: "ይህ ክፍል የግብርና ስርዓት፣ መሳሪያዎች፣ የምግብ ምርት እና የመሬት አጠቃቀምን ያቀርባል።",
      or: "Kutaan kun sirna qonnaa, meeshaalee, oomisha nyaataa, itti fayyadama lafaa fi beekumsa qonnaa dhiheessa.",
    },
  },
  10: {
    subtype: { en: "First Floor Gallery", am: "የመጀመሪያ ወለል ክፍል", or: "Kutaa Darbii Jalqabaa" },
    description: {
      en: "This stop highlights local industry, production, materials, technology, and craft practices.",
      am: "ይህ ክፍል የአካባቢ ምርት፣ ቁሳቁሶች፣ ቴክኖሎጂ እና የእጅ ሙያ ልምዶችን ያሳያል።",
      or: "Buufanni kun oomisha naannoo, meeshaalee, teeknooloojii fi hojii harkaa agarsiisa.",
    },
  },
  11: {
    subtype: { en: "First Floor Gallery", am: "የመጀመሪያ ወለል ክፍል", or: "Kutaa Darbii Jalqabaa" },
    description: {
      en: "This gallery explains markets, trade routes, exchange goods, merchants, and economic connections.",
      am: "ይህ ክፍል ገበያዎች፣ የንግድ መስመሮች፣ የልውውጥ እቃዎች እና ኢኮኖሚያዊ ግንኙነቶችን ያብራራል።",
      or: "Kutaan kun gabaa, daandii daldalaa, meeshaalee waljijjiirraa, daldaltoota fi walitti hidhaminsa dinagdee ibsa.",
    },
  },
  12: {
    subtype: { en: "Family Room", am: "የቤተሰብ ክፍል", or: "Kutaa Maatii" },
    description: {
      en: "A family-room exhibit presenting household history, family memory, and personal objects connected to Aba Jifar.",
      am: "ይህ የቤተሰብ ክፍል የቤተሰብ ታሪክ፣ ትውስታ እና የግል እቃዎችን ያቀርባል።",
      or: "Kutaan kun seenaa maatii, yaadannoo maatii fi meeshaalee dhuunfaa Abbaa Jifaar waliin walqabatan agarsiisa.",
    },
  },
  13: {
    subtype: { en: "Family Room", am: "የቤተሰብ ክፍል", or: "Kutaa Maatii" },
    description: {
      en: "A second family-room exhibit for domestic life, family stories, photographs, and cultural objects.",
      am: "ይህ ክፍል የቤት ሕይወት፣ የቤተሰብ ታሪኮች፣ ፎቶዎች እና ባህላዊ እቃዎችን ያሳያል።",
      or: "Kutaan kun jireenya mana keessaa, seenaa maatii, suuraalee fi meeshaalee aadaa dhiheessa.",
    },
  },
  14: {
    subtype: { en: "Family Room", am: "የቤተሰብ ክፍል", or: "Kutaa Maatii" },
    description: {
      en: "A third family-room exhibit presenting family heritage, private space, and continuity of tradition.",
      am: "ይህ ክፍል የቤተሰብ ቅርስ፣ የግል ቦታ እና የባህል ቀጣይነትን ያቀርባል።",
      or: "Kutaan kun hambaa maatii, iddoo dhuunfaa fi itti fufiinsa aadaa dhiheessa.",
    },
  },
  15: {
    subtype: { en: "Kingdom Gallery", am: "የመንግስት ክፍል", or: "Kutaa Mootummaa" },
    description: {
      en: "Explore the Gibe Kingdom context, neighboring kingdoms, trade, alliances, conflict, and cultural exchange.",
      am: "የጊቤ መንግስትን፣ ጎረቤት መንግስታትን፣ ንግድን እና ባህላዊ ልውውጥን ይመልከቱ።",
      or: "Haala Mootummaa Gibe, mootummoota ollaa, daldala, waliigaltee, walitti buʼiinsa fi waljijjiirraa aadaa qoradhu.",
    },
  },
  16: {
    subtype: { en: "Architecture", am: "ሥነ ሕንፃ", or: "Ijaarsa" },
    description: {
      en: "This stop explains construction methods, local materials, craftsmanship, structure, and conservation ideas.",
      am: "ይህ ክፍል የግንባታ ዘዴዎችን፣ የአካባቢ ቁሳቁስን፣ የሙያ ስራን እና ጥበቃን ያብራራል።",
      or: "Buufanni kun mala ijaarsa, meeshaalee naannoo, ogummaa, caasaa fi kunuunsa hambaa ibsa.",
    },
  },
  17: {
    subtype: { en: "Culture and Performance", am: "ባህልና ትርኢት", or: "Aadaa fi Agarsiisa" },
    description: {
      en: "This area presents traditional wrestling as sport, performance, social event, and cultural memory.",
      am: "ይህ ክፍል ባህላዊ ትግልን እንደ ስፖርት፣ ትርኢት እና ማህበራዊ ክስተት ያቀርባል።",
      or: "Kutaan kun waldhaansoo aadaa akka tapha, agarsiisa, taatee hawaasaa fi yaadannoo aadaatti dhiheessa.",
    },
  },
  18: {
    subtype: { en: "Open Space", am: "ክፍት ቦታ", or: "Iddoo Bana" },
    description: {
      en: "The courtyard works as a spatial orientation point and a gathering area inside the visitor route.",
      am: "አደባባዩ የአቀማመጥ መለያ እና የስብሰባ ቦታ ነው።",
      or: "Mooraan iddoo kallattii itti hubatan fi walitti qabama daawwattootaa dha.",
    },
  },
  19: {
    subtype: { en: "Social History", am: "ማህበራዊ ታሪክ", or: "Seenaa Hawaasaa" },
    description: {
      en: "This gallery highlights women's roles in leadership, household economy, craft, ceremony, and cultural knowledge.",
      am: "ይህ ክፍል የሴቶችን ሚና በመሪነት፣ ቤተሰብ ኢኮኖሚ፣ ሙያ እና ባህል ያሳያል።",
      or: "Kutaan kun gahee dubartootaa hooggansa, diinagdee mana, hojii harkaa, sirna aadaa fi beekumsa keessatti ibsa.",
    },
  },
};
for (const r of ABA_ROOMS) {
  const c = ABA_ROOM_CONTENT[r.id];
  if (c) { r.subtype = c.subtype; r.description = c.description; }
}

// Match the SVG viewBox (1190.65 × 830.28) at scale 0.06.
const ABA_PLAN_BOUNDS = { minX: 0, maxX: 71.44, minZ: 0, maxZ: 49.82 };

// Roads / paved courts — extracted from the ground SVG's hatching by
// tools/build-aba-jifar-rooms.js (bottom-band clusters only). Format
// matches what floors.js + pathfinding.js consume:
//   { id, x, z, w, d, color, label }
// label is human-friendly for direction steps.
const ABA_ROAD_LABELS = {
  "road-1": "South plaza",
  "road-3": "Central path",
  "road-5": "East gate",
};
// Roads leading to the now-removed Banquet Hall (south + east spurs)
// are filtered out — they're orphaned without that destination.
const ABA_DROPPED_ROADS = new Set(["road-2", "road-4"]);
const ABA_ROADS = abaJifarRoomData.roads
  .filter((r) => !ABA_DROPPED_ROADS.has(r.id))
  .map((r) => ({
    id:     r.id,
    x:      r.bbox[0],
    z:      r.bbox[1],
    w:      r.bbox[2],
    d:      r.bbox[3],
    points: r.points,
    color:  0x4a443c,
    label:  ABA_ROAD_LABELS[r.id] ?? r.id,
  }));

// Doors extracted from the SVG's door-swing arcs (see build script).
// Each door has a world position and a list of attached room ids (1-2).
// Filter out doors whose only attached rooms have been removed from
// ABA_ROOMS (otherwise they'd render as orphaned gold pins floating in
// the grass where the removed building used to be).
const ABA_ROOM_IDS = new Set(ABA_ROOMS.map((r) => r.id));
const ABA_DOORS = (abaJifarRoomData.doors || [])
  .filter((d) => d.rooms && d.rooms.some((rid) => ABA_ROOM_IDS.has(rid)))
  .map((d) => ({
    id:    d.id,
    x:     d.pos[0],
    z:     d.pos[1],
    floor: 1,
    rooms: d.rooms,
  }));

// =============================================================
//  Outdoor waypoint network — hand-coded from the user's sketch of
//  "Possible Navigation Routes" on the ground floor. These are the
//  junction points along the painted paved walkways; doors connect
//  to the nearest waypoint, waypoints connect to adjacent waypoints,
//  and the path-finder routes ROOM → door → waypoint → … → waypoint
//  → door → ROOM. Cross-building line-of-sight is disabled so all
//  inter-building paths must go through this network.
// =============================================================
const ABA_WAYPOINTS = [
  // ============ Major numbered stops ============
  // ① Main Entrance — south spine origin
  { id: "wp-main-entrance", x: 14.5, z: 33.0, floor: 1, label: "Main Entrance", major: true, stop: 1 },
  // ② Central Hub — decision point between palace, mosque, and big building
  { id: "wp-central-hub",   x: 19.5, z: 19.5, floor: 1, label: "Central Hub",   major: true, stop: 2 },

  // ============ Primary spine bend corners (axis-aligned) ============
  // Every edge in the network is now either horizontal or vertical;
  // these are the L-corners that make that possible.
  // Corner just east of Main Entrance — spine turns north here.
  { id: "wp-spine-1",       x: 19.5, z: 33.0, floor: 1, label: "Spine SE corner" },
  // Corner east of Palace, south of Central Hub.
  { id: "wp-spine-2",       x: 19.5, z: 23.0, floor: 1, label: "Spine N bend" },
  // Bend corner where the spine turns east out of Central Hub.
  { id: "wp-cluster-sw-bend", x: 19.5, z: 18.0, floor: 1, label: "Cluster SW bend" },

  // ============ Religion pavilion loop ============
  // Corners of the corridor that wraps Religion (room 5, bbox
  // x:13.86-17.70 z:24.48-27.42) on its S / W / N / E sides.
  { id: "wp-religion-sw",   x: 12.8, z: 33.0, floor: 1, label: "Religion SW corner" },
  { id: "wp-religion-w",    x: 12.8, z: 27.5, floor: 1, label: "Religion W" },
  { id: "wp-religion-nw",   x: 12.8, z: 23.5, floor: 1, label: "Religion NW corner" },
  { id: "wp-religion-ne",   x: 18.5, z: 23.5, floor: 1, label: "Religion NE corner" },
  { id: "wp-religion-se",   x: 18.5, z: 27.5, floor: 1, label: "Religion SE corner" },
  { id: "wp-mosque",        x: 19.5, z: 27.5, floor: 1, label: "Mosque" },

  // ============ Palace approach ============
  // Palace south-side approach (side spur off the main spine).
  { id: "wp-palace-front",  x: 17.0, z: 23.0, floor: 1, label: "Palace front" },

  // ============ Central cluster perimeter ============
  // West / NW dog-leg around room 16 (Construction Method,
  // z:4.74-9.84) so the line stays north of room 16.
  { id: "wp-hub-east",      x: 19.5, z: 12.5, floor: 1, label: "Hub-east corridor" },
  { id: "wp-geda",          x: 21.5, z: 12.5, floor: 1, label: "Geda System Exhibit" },
  { id: "wp-cluster-w",     x: 21.0, z: 12.5, floor: 1, label: "Cluster west" },
  { id: "wp-cluster-nw",    x: 21.0, z:  4.0, floor: 1, label: "Cluster NW corner" },
  { id: "wp-cluster-n",     x: 28.0, z:  4.0, floor: 1, label: "Cluster north" },
  // NE / E corner — sit on the east corridor (x=33) so every edge on
  // that corridor is purely vertical.
  { id: "wp-cluster-ne",    x: 33.0, z:  4.0, floor: 1, label: "Cluster NE corner" },
  { id: "wp-cluster-e",     x: 33.0, z:  8.5, floor: 1, label: "Cluster east" },
  // SW corner — south of Gibe Kingdom (z:13.44-16.98).
  { id: "wp-cluster-sw",    x: 21.5, z: 18.0, floor: 1, label: "Cluster SW corner" },

  // ============ Spine landmark waypoints (east side) ============
  { id: "wp-courtyard",     x: 33.0, z: 18.0, floor: 1, label: "Courtyard Open Space" },
  { id: "wp-exhibit",       x: 33.0, z: 13.0, floor: 1, label: "Exhibit Building 2" },
  { id: "wp-exhibit-east",  x: 33.0, z: 11.5, floor: 1, label: "Exhibit east junction" },
  // Corner where the east corridor turns east toward State Formation.
  { id: "wp-state-form-w",  x: 33.0, z: 10.0, floor: 1, label: "State Formation bend" },
  { id: "wp-state-formation", x: 37.5, z: 10.0, floor: 1, label: "State Formation Gallery" },

  // Banquet Hall route + waypoints removed along with room 20.
];

// Edges. Third element classifies the line:
//   "primary"   — thick orange spine
//   "secondary" — thinner connector
//   "return"    — dashed recommended-return loop
//
// EVERY edge below is purely horizontal (constant z) or vertical
// (constant x) — no diagonals — so the rendered path strips dog-leg
// at every corner instead of cutting across paved corridors.
const ABA_WAYPOINT_EDGES = [
  // ============ Primary spine (right-angle path) ============
  // 1→2: east to spine-1, then north past the mosque + palace-front
  //      bend up to central-hub, then bend east to cluster-sw and
  //      run along z=18 over to the courtyard, then north up the
  //      east corridor at x=33 to state-formation.
  ["wp-main-entrance",   "wp-spine-1",          "primary"],   // east
  ["wp-spine-1",         "wp-mosque",           "primary"],   // north
  ["wp-mosque",          "wp-spine-2",          "primary"],   // north
  ["wp-spine-2",         "wp-central-hub",      "primary"],   // north
  ["wp-central-hub",     "wp-cluster-sw-bend",  "primary"],   // north
  ["wp-cluster-sw-bend", "wp-cluster-sw",       "primary"],   // east
  ["wp-cluster-sw",      "wp-courtyard",        "primary"],   // east
  ["wp-courtyard",       "wp-exhibit",          "primary"],   // north
  ["wp-exhibit",         "wp-exhibit-east",     "primary"],   // north
  ["wp-exhibit-east",    "wp-state-form-w",     "primary"],   // north
  ["wp-state-form-w",    "wp-state-formation",  "primary"],   // east

  // ============ Religion loop (secondary) ============
  ["wp-main-entrance",   "wp-religion-sw",      "secondary"], // west
  ["wp-religion-sw",     "wp-religion-w",       "secondary"], // north
  ["wp-religion-w",      "wp-religion-nw",      "secondary"], // north
  ["wp-religion-nw",     "wp-religion-ne",      "secondary"], // east
  ["wp-religion-ne",     "wp-religion-se",      "secondary"], // south
  ["wp-religion-se",     "wp-mosque",           "secondary"], // east

  // ============ Palace-front spur (secondary) ============
  ["wp-spine-2",         "wp-palace-front",     "secondary"], // west
  ["wp-religion-nw",     "wp-palace-front",     "secondary"], // east (nearly horizontal)

  // ============ Central cluster perimeter (secondary) ============
  // Hub → east-of-palace corridor → geda → west corner → NW dog-leg
  // → north corridor → NE → east corridor → joins primary.
  ["wp-central-hub",     "wp-hub-east",         "secondary"], // north
  ["wp-hub-east",        "wp-geda",             "secondary"], // east
  ["wp-geda",            "wp-cluster-w",        "secondary"], // west (short)
  ["wp-cluster-w",       "wp-cluster-nw",       "secondary"], // north
  ["wp-cluster-nw",      "wp-cluster-n",        "secondary"], // east
  ["wp-cluster-n",       "wp-cluster-ne",       "secondary"], // east
  ["wp-cluster-ne",      "wp-cluster-e",        "secondary"], // south
  ["wp-cluster-e",       "wp-state-form-w",     "secondary"], // south (joins spine)
];

// =============================================================
//  Building registry + active-building selector
// =============================================================
const BUILDING_LIST = [
  {
    id:         "cam",
    name:       "Cincinnati Art Museum",
    nameAm:     "የሲንሲናቲ ጥበብ ሙዚየም",
    subtitle:   "3D Visitor Guide",
    subtitleAm: "3D ጎብኚ መመሪያ",
    icon:       "✻",
    accent:     "#ff4d6a",
    categories: CAM_CATEGORIES,
    floors:     CAM_FLOORS,
    rooms:      CAM_ROOMS,
    planBounds: CAM_PLAN_BOUNDS,
    roads:      [],
  },
  {
    id:         "aba-jifar",
    name:       "Aba Jifar Palace",
    nameAm:     "የአባ ጂፋር ቤተ መንግሥት",
    subtitle:   "Historic site • Jimma, Ethiopia",
    subtitleAm: "ታሪካዊ ቦታ • ጅማ፣ ኢትዮጵያ",
    icon:       "◈",
    accent:     "#c9714f",
    style:      "situm",             // SVG-as-floor + extruded room blocks
    categories: ABA_CATEGORIES,
    floors:     ABA_FLOORS,
    rooms:      ABA_ROOMS,
    planBounds: ABA_PLAN_BOUNDS,
    roads:      [],                  // road slabs replaced by visibility paths between doors
    doors:      ABA_DOORS,           // door positions extracted from SVG arc symbols
    waypoints:  ABA_WAYPOINTS,       // outdoor walking-network junction nodes
    waypointEdges: ABA_WAYPOINT_EDGES,
  },
];

const DEFAULT_BUILDING_ID = "aba-jifar";

function resolveActiveBuilding() {
  const fallback =
    BUILDING_LIST.find((b) => b.id === DEFAULT_BUILDING_ID) ?? BUILDING_LIST[0];
  // No window in non-browser env (build tools) — default to fallback.
  if (typeof window === "undefined") return fallback;
  const id = new URLSearchParams(window.location.search).get("building");
  return BUILDING_LIST.find((b) => b.id === id) ?? fallback;
}

const ACTIVE = resolveActiveBuilding();

// Existing app code imports these names directly — they now resolve
// to whichever building was selected via ?building=...
export const CATEGORIES  = ACTIVE.categories;
export const FLOORS      = ACTIVE.floors;
export const ROOMS       = ACTIVE.rooms;
export const PLAN_BOUNDS = ACTIVE.planBounds;
export const ROADS       = ACTIVE.roads ?? [];
export const DOORS       = ACTIVE.doors ?? [];
export const WAYPOINTS   = ACTIVE.waypoints ?? [];
export const WAYPOINT_EDGES = ACTIVE.waypointEdges ?? [];

// New: lets the UI render the building selector and current branding.
export const BUILDINGS         = BUILDING_LIST;
export const ACTIVE_BUILDING   = ACTIVE;
export const BUILDING_STYLE    = ACTIVE.style ?? "procedural";
