// Parent map and normalized bounds from Blizzard UiMap and UiMapAssignment (1.60.1.69893).
// https://wago.tools/db2/UiMapAssignment?build=1.60.1.69893
export const AZEROTH = "947";
export const mapRegions = new Map([
  ["947", {"name":"Azeroth","parent":null}],
  ["1411", {"name":"Durotar","parent":"1414","bounds":[0.517098,0.448028,0.660781,0.591711]}],
  ["1412", {"name":"Mulgore","parent":"1414","bounds":[0.3964,0.510868,0.563633,0.678074]}],
  ["1413", {"name":"The Barrens","parent":"1414","bounds":[0.392493,0.456011,0.667857,0.731403]}],
  ["1414", {"name":"Kalimdor","parent":"947","bounds":[-0.185893,0.067677,0.634091,0.887744]}],
  ["1415", {"name":"Royaumes de l’Est","parent":"947","bounds":[0.371483,0.081501,1.159155,0.8691]}],
  ["1416", {"name":"Alterac Mountains","parent":"1415","bounds":[0.432293,0.254259,0.511839,0.333805]}],
  ["1417", {"name":"Arathi Highlands","parent":"1415","bounds":[0.479168,0.323862,0.581441,0.426135]}],
  ["1418", {"name":"Badlands","parent":"1415","bounds":[0.513614,0.569157,0.584282,0.639825]}],
  ["1419", {"name":"Blasted Lands","parent":"1415","bounds":[0.489821,0.768465,0.584992,0.863636]}],
  ["1420", {"name":"Clairières de Tirisfal","parent":"1415","bounds":[0.368372,0.15465,0.496746,0.283024]}],
  ["1421", {"name":"Silverpine Forest","parent":"1415","bounds":[0.356535,0.247157,0.475854,0.366475]}],
  ["1422", {"name":"Western Plaguelands","parent":"1415","bounds":[0.44271,0.174714,0.564869,0.296873]}],
  ["1423", {"name":"Eastern Plaguelands","parent":"1415","bounds":[0.518645,0.160864,0.640864,0.283024]}],
  ["1424", {"name":"Hillsbrad Foothills","parent":"1415","bounds":[0.424244,0.301134,0.515153,0.392044]}],
  ["1425", {"name":"The Hinterlands","parent":"1415","bounds":[0.499291,0.25568,0.608666,0.365055]}],
  ["1426", {"name":"Dun Morogh","parent":"1415","bounds":[0.403351,0.483397,0.543266,0.623312]}],
  ["1427", {"name":"Searing Gorge","parent":"1415","bounds":[0.463721,0.578124,0.527108,0.641512]}],
  ["1428", {"name":"Burning Steppes","parent":"1415","bounds":[0.462123,0.617808,0.545338,0.700993]}],
  ["1429", {"name":"Elwynn Forest","parent":"1415","bounds":[0.410927,0.656515,0.50953,0.755148]}],
  ["1430", {"name":"Deadwind Pass","parent":"1415","bounds":[0.478221,0.738636,0.549244,0.809659]}],
  ["1431", {"name":"Duskwood","parent":"1415","bounds":[0.430872,0.732244,0.507577,0.808948]}],
  ["1432", {"name":"Loch Modan","parent":"1415","bounds":[0.511188,0.509409,0.589549,0.587801]}],
  ["1433", {"name":"Redridge Mountains","parent":"1415","bounds":[0.50231,0.683593,0.563981,0.745294]}],
  ["1434", {"name":"Stranglethorn Vale","parent":"1415","bounds":[0.391455,0.794122,0.572741,0.975408]}],
  ["1435", {"name":"Swamp of Sorrows","parent":"1415","bounds":[0.517698,0.72816,0.582861,0.793323]}],
  ["1436", {"name":"Westfall","parent":"1415","bounds":[0.368846,0.718749,0.468278,0.818181]}],
  ["1437", {"name":"Wetlands","parent":"1415","bounds":[0.465614,0.409711,0.583098,0.527165]}],
  ["1438", {"name":"Teldrassil","parent":"1414","bounds":[0.360111,0.039483,0.498472,0.177816]}],
  ["1439", {"name":"Darkshore","parent":"1414","bounds":[0.383832,0.182062,0.561822,0.360052]}],
  ["1440", {"name":"Ashenvale","parent":"1414","bounds":[0.417573,0.331265,0.574276,0.48794]}],
  ["1441", {"name":"Thousand Needles","parent":"1414","bounds":[0.475544,0.683424,0.59511,0.802989]}],
  ["1442", {"name":"Stonetalon Mountains","parent":"1414","bounds":[0.375566,0.402851,0.508266,0.53558]}],
  ["1443", {"name":"Desolace","parent":"1414","bounds":[0.348732,0.50331,0.470902,0.625509]}],
  ["1444", {"name":"Feralas","parent":"1414","bounds":[0.315897,0.618206,0.504756,0.807066]}],
  ["1445", {"name":"Dustwallow Marsh","parent":"1414","bounds":[0.490263,0.604619,0.632927,0.747283]}],
  ["1446", {"name":"Tanaris","parent":"1414","bounds":[0.469713,0.761209,0.657214,0.94871]}],
  ["1447", {"name":"Azshara","parent":"1414","bounds":[0.55282,0.304006,0.690615,0.441829]}],
  ["1448", {"name":"Felwood","parent":"1414","bounds":[0.419158,0.230975,0.575409,0.387226]}],
  ["1449", {"name":"Un'Goro Crater","parent":"1414","bounds":[0.449276,0.764946,0.54982,0.86549]}],
  ["1450", {"name":"Moonglade","parent":"1414","bounds":[0.501303,0.175608,0.56403,0.238363]}],
  ["1451", {"name":"Silithus","parent":"1414","bounds":[0.394815,0.764606,0.489471,0.859291]}],
  ["1452", {"name":"Winterspring","parent":"1414","bounds":[0.472374,0.17391,0.66531,0.366846]}],
  ["1453", {"name":"Stormwind City","parent":"1415","bounds":[0.4056,0.658912,0.454961,0.708273]}],
  ["1454", {"name":"Orgrimmar","parent":"1414","bounds":[0.563786,0.429052,0.6019,0.467181]}],
  ["1455", {"name":"Ironforge","parent":"1415","bounds":[0.474819,0.512892,0.49728,0.535376]}],
  ["1456", {"name":"Thunder Bluff","parent":"1414","bounds":[0.449729,0.556385,0.478092,0.584748]}],
  ["1457", {"name":"Darnassus","parent":"1414","bounds":[0.383921,0.104413,0.412681,0.133179]}],
  ["1458", {"name":"Undercity","parent":"1415","bounds":[0.42974,0.238154,0.456995,0.265431]}],
  ["2482", {"name":"Mount Hyjal","parent":"1414","bounds":[0.488848,0.264773,0.583221,0.359118]}],
  ["2521", {"name":"Zephras Isle","parent":"947"}],
  ["2524", {"name":"Darkspear Islands","parent":"947"}],
  ["2548", {"name":"Riverglades","parent":"1415","bounds":[0.508287,0.593749,0.646072,0.731533]}],
  ["2652", {"name":"Shen'dralas","parent":"1414","bounds":[0.408741,0.599184,0.464448,0.654891]}],
]);

export function mapContains(viewId, mapId) {
  for (let id = mapId; id != null; id = mapRegions.get(id)?.parent) {
    if (id === viewId) return true;
  }
  return false;
}

export function projectPosition(location, viewId) {
  let { x, y } = location;
  let mapId = String(location.mapId);
  while (mapId !== viewId) {
    const region = mapRegions.get(mapId);
    if (!region?.bounds) return null;
    const [left, top, right, bottom] = region.bounds;
    x = left + x * (right - left);
    y = top + y * (bottom - top);
    mapId = region.parent;
  }
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
