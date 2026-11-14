export type RegionId = 'africa' | 'asia' | 'europe' | 'north_america' | 'south_america' | 'oceania' | 'antarctica';

export const REGIONS: Record<RegionId, string> = {
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  north_america: 'North America',
  south_america: 'South America',
  oceania: 'Oceania',
  antarctica: 'Antarctica',
};

// ISO codes are used instead of display names so Natural Earth naming changes do not
// change the meaning of a saved filter.
const regionCodes: Record<RegionId, string> = {
  africa: 'DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW EH SH',
  asia: 'AF AM AZ BH BD BT BN KH CN CY GE IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TJ TH TL TR TM AE UZ VN YE RU TW HK MO',
  europe: 'AL AD AT BY BE BA BG HR CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO SM RS SK SI ES SE CH UA GB VA FO GL AX IM JE GG',
  north_america: 'CA US MX GT BZ SV HN NI CR PA CU JM HT DO DM GD AG KN LC VC BB TT BS BM GL PR VI VG AI MS KY TC AW CW SX BQ MQ GP MF BL PM PM',
  south_america: 'AR BO BR CL CO EC FK GF GY PY PE SR UY VE',
  oceania: 'AU NZ PG FJ SB VU NC FM KI MH NR PW WS TO TV TL CK NU PF AS GU MP UM',
  antarctica: 'AQ TF GS',
};

const isoToRegion = new Map<string, RegionId>();
for (const [region, codes] of Object.entries(regionCodes) as [RegionId, string][]) {
  for (const code of codes.split(' ')) if (code && !isoToRegion.has(code)) isoToRegion.set(code, region);
}

export function regionForIso(iso: string): RegionId | null {
  return isoToRegion.get(iso.toUpperCase()) ?? null;
}

export function validRegion(id: string): id is RegionId {
  return id in REGIONS;
}

export function matchesGeography(iso: string, countries: string[], regions: RegionId[]): boolean {
  const countryMatch = countries.length === 0 || countries.includes(iso);
  const region = regionForIso(iso);
  const regionMatch = regions.length === 0 || (region !== null && regions.includes(region));
  return countryMatch && regionMatch;
}
