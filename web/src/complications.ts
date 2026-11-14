import type { FeatureMeta, Target } from './types';

export interface ComplicationEvidence {
  id: string;
  title: string;
  status: 'available' | 'partial' | 'unavailable';
  summary: string;
  evidence: string[];
  limitation: string;
}

export interface ComplicationRow {
  feature: FeatureMeta;
  measurement: number;
  percentile: number;
}

const row = (rows: ComplicationRow[], id: string) => rows.find((item) => item.feature.id === id);
const display = (item: ComplicationRow | undefined) => item ? `${item.measurement.toFixed(1)} ${item.feature.unit}` : 'not available';

export function complicationEvidence(target: Target, rows: ComplicationRow[]): ComplicationEvidence[] {
  const pressure = target.body === 'Moon'
    ? 'Earth surface pressure is about 101 kPa; the Moon has no substantial atmosphere.'
    : 'Earth surface pressure is about 101 kPa; Mars has a thin atmosphere of roughly 0.6 kPa at the surface.';
  const gravity = target.body === 'Moon'
    ? 'Earth gravity is 9.81 m/s²; lunar surface gravity is 1.62 m/s².'
    : 'Earth gravity is 9.81 m/s²; Martian surface gravity is 3.71 m/s².';
  const weather = [row(rows, 'temp_mean'), row(rows, 'precip'), row(rows, 'humidity')].filter(Boolean);
  const vegetation = row(rows, 'ndvi');
  const surface = [row(rows, 'sand'), row(rows, 'soc'), row(rows, 'basalt')].filter(Boolean);
  const dust = row(rows, 'aod');
  const access = [row(rows, 'slope_mean'), row(rows, 'slope_p90'), row(rows, 'elevation')].filter(Boolean);

  return [
    {
      id: 'atmosphere',
      title: 'Atmosphere and pressure',
      status: 'available',
      summary: pressure,
      evidence: ['Pressure is contextual planetary information, not an Earth-site score.'],
      limitation: 'The application does not measure local pressure or simulate atmospheric composition.',
    },
    {
      id: 'gravity',
      title: 'Gravity',
      status: 'available',
      summary: gravity,
      evidence: ['Earth locations cannot reproduce lunar or Martian gravity; this difference is not included in similarity scoring.'],
      limitation: 'No gravity compensation or reduced-gravity test capability is inferred.',
    },
    {
      id: 'weather',
      title: 'Weather and moisture',
      status: weather.length ? 'partial' : 'unavailable',
      summary: weather.length
        ? `Available Earth context: temperature ${display(row(rows, 'temp_mean'))}, precipitation ${display(row(rows, 'precip'))}, humidity ${display(row(rows, 'humidity'))}.`
        : 'No weather measurements are available for this location.',
      evidence: weather.map((item) => `${item!.feature.name}: ${display(item)}`),
      limitation: 'Wind is not part of the current feature schema; climatology is not a forecast or site-day observation.',
    },
    {
      id: 'vegetation',
      title: 'Vegetation and biological activity',
      status: vegetation ? 'partial' : 'unavailable',
      summary: vegetation ? `NDVI at this location is ${display(vegetation)}.` : 'Vegetation evidence is not available.',
      evidence: vegetation ? [`Vegetation (NDVI) percentile: ${Math.round(vegetation.percentile * 100)}.`] : [],
      limitation: 'NDVI is a vegetation-index proxy, not a complete biodiversity or biological-activity measurement.',
    },
    {
      id: 'surface',
      title: 'Surface materials',
      status: surface.length ? 'partial' : 'unavailable',
      summary: surface.length ? `Available Earth surface context includes ${surface.map((item) => item!.feature.name.toLowerCase()).join(', ')}.` : 'Surface-material evidence is not available.',
      evidence: surface.map((item) => `${item!.feature.name}: ${display(item)}`),
      limitation: 'Soil and mapped lithology are terrestrial context; they do not prove lunar regolith or Martian regolith equivalence.',
    },
    {
      id: 'dust',
      title: 'Dust and erosion',
      status: dust ? 'partial' : 'unavailable',
      summary: dust ? `Aerosol optical depth context is ${display(dust)}.` : 'Dust-related evidence is not available.',
      evidence: dust ? [`AOD percentile: ${Math.round(dust.percentile * 100)}.`] : [],
      limitation: 'AOD is a column proxy. Local dust flux, particle size, saltation, and erosion rates are not measured.',
    },
    {
      id: 'accessibility',
      title: 'Accessibility',
      status: access.length ? 'partial' : 'unavailable',
      summary: access.length ? `Terrain context includes ${access.map((item) => item!.feature.name.toLowerCase()).join(', ')}.` : 'Accessibility evidence is not available.',
      evidence: access.map((item) => `${item!.feature.name}: ${display(item)}`),
      limitation: 'No road, trail, communications, hazard, or route-connectivity layer is integrated; terrain is not an operational feasibility score.',
    },
  ];
}
