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
  entrance:   { label: "Entrance",                 color: 0xe2a39e },
  royal:      { label: "Aba Jifar II",             color: 0xd9cca0 },
  history:    { label: "Founding History",         color: 0xb89f74 },
  religion:   { label: "Religion in the Kingdom",  color: 0xc88a6e },
  kingdom:    { label: "Gibe Kingdom",             color: 0x7d4e34 },
  governance: { label: "Governance",               color: 0x5e6537 },
  economy:    { label: "Economy",                  color: 0x6e4a2c },
  culture:    { label: "Wrestling & Sport",        color: 0x9d9888 },
  ceremonial: { label: "Ceremonial Halls",         color: 0xd1b25c },
  womens:     { label: "Women in the Kingdom",     color: 0xc97784 },
  family:     { label: "Family Rooms",             color: 0xb29a72 },
};

const ABA_FLOORS = [
  { id: 1, label: "Ground Floor", y: 0, height: 4.5, fbx: null },
  { id: 2, label: "First Floor",  y: 6, height: 4.5, fbx: null },
];

const aj = (id, name, category, x, z, w, d, floor, extra = {}) => ({
  id, name, category, floor, footprint: { x, z, w, d }, ...extra,
});

const ABA_ROOMS = [
  // ---- Ground Floor (1) ----

  // Palace block (south-west). Outer footprint roughly x[3,9] × z[5,11].
  aj("2",  "Geda System",                              "history",    3,   5,   6,   1.5, 1),
  aj("4",  "Aba Jifar II",                             "royal",      3,   6.5, 3.5, 4.5, 1),
  aj("3",  "State Formation",                          "history",    6.5, 6.5, 2.5, 2,   1),
  aj("1",  "Entrance",                                 "entrance",   6.5, 8.5, 2.5, 2.5, 1, { entrance: true }),

  // Religion pavilion (free-standing, south of palace)
  aj("5",  "Role of Islam in State Formation",         "religion",   4,   13.5,5,   4.5, 1),

  // Larger building (centre-north). Outer footprint x[16,24] × z[2.5,11].
  aj("18", "Courtyard",                                "ceremonial", 16,  2.5, 8,   2.5, 1),
  aj("16", "Aba Jifar II Palace Construction Method", "history",    16,  5,   2,   2.5, 1),
  aj("17", "Wrestling",                                "culture",    18,  5,   4,   3.5, 1),
  aj("15", "Gibe Kingdom",                             "kingdom",    16,  8.5, 8,   2.5, 1),

  // Women's pavilion (free-standing, north-east)
  aj("19", "Women's Role in the Kingdom",              "womens",     27,  2,   5.5, 5.5, 1),

  // Banquet Hall (free-standing, south-east)
  aj("20", "Banquet Hall",                             "ceremonial", 29,  14,  7,   4,   1),

  // ---- First Floor (2) — same footprints as the multi-storey buildings above ----

  // Palace block upstairs
  aj("8",  "Administration and Diplomacy", "governance", 3,   5,   6,   1.5, 2),
  aj("7",  "Military and Defense",         "governance", 3,   6.5, 3,   4.5, 2),
  aj("6",  "Justice Dispensation",         "governance", 6,   6.5, 3,   4.5, 2),

  // Larger building upstairs
  aj("10", "Industry",                     "economy",    17,  2.5, 6,   2.5, 2),
  aj("9",  "Agriculture",                  "economy",    16,  5,   2,   2,   2),
  aj("11", "Trade",                        "economy",    22,  5,   2,   2.5, 2),
  aj("14", "Aba Jifar Family Room 3",      "family",     17,  7.5, 2,   2,   2),
  aj("13", "Aba Jifar Family Room 2",      "family",     19,  7.5, 2,   2,   2),
  aj("12", "Aba Jifar Family Room 1",      "family",     21,  7.5, 2,   2,   2),
];

const ABA_PLAN_BOUNDS = { minX: 0, maxX: 36, minZ: 0, maxZ: 22 };

// Roads / paved courts visible in the site plan — extruded slightly above
// the slab so they read as cobbled pavement. Color is a dark warm grey
// matching the hatched road areas in the PDF.
const ABA_ROADS = [
  // Main south plaza — large paved court along the bottom of the plan
  { x: 0,  z: 17.5, w: 36, d: 4.5, color: 0x4a443c, label: "South plaza" },
  // Connector between palace block and larger building
  { x: 9,  z: 6,    w: 7,  d: 5,   color: 0x4a443c, label: "Central path" },
  // Path leading to the Banquet Hall
  { x: 23, z: 14.5, w: 6,  d: 3,   color: 0x4a443c, label: "Banquet path" },
  // Approach in front of the larger building's east veranda
  { x: 24, z: 7,    w: 3,  d: 5,   color: 0x4a443c, label: "East approach" },
];

// =============================================================
//  Building registry + active-building selector
// =============================================================
const BUILDING_LIST = [
  {
    id:         "cam",
    name:       "Cincinnati Art Museum",
    subtitle:   "3D Visitor Guide",
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
    subtitle:   "Historic site • Jimma, Ethiopia",
    icon:       "◈",
    accent:     "#c9714f",
    categories: ABA_CATEGORIES,
    floors:     ABA_FLOORS,
    rooms:      ABA_ROOMS,
    planBounds: ABA_PLAN_BOUNDS,
    roads:      ABA_ROADS,
  },
];

function resolveActiveBuilding() {
  // No window in non-browser env (build tools) — default to first.
  if (typeof window === "undefined") return BUILDING_LIST[0];
  const id = new URLSearchParams(window.location.search).get("building");
  return BUILDING_LIST.find((b) => b.id === id) ?? BUILDING_LIST[0];
}

const ACTIVE = resolveActiveBuilding();

// Existing app code imports these names directly — they now resolve
// to whichever building was selected via ?building=...
export const CATEGORIES  = ACTIVE.categories;
export const FLOORS      = ACTIVE.floors;
export const ROOMS       = ACTIVE.rooms;
export const PLAN_BOUNDS = ACTIVE.planBounds;
export const ROADS       = ACTIVE.roads ?? [];

// New: lets the UI render the building selector and current branding.
export const BUILDINGS         = BUILDING_LIST;
export const ACTIVE_BUILDING   = ACTIVE;
