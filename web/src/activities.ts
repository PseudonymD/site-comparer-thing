export type ActivityId =
  | 'rover-mobility'
  | 'geological-sampling'
  | 'habitat-construction'
  | 'dust-experiments'
  | 'ice-exploration'
  | 'human-field-operations'
  | 'solar-power'
  | 'thermal-experiments'
  | 'cave-exploration';

export type ActivityAvailability = 'supported' | 'partial' | 'disabled';

export interface Activity {
  id: ActivityId;
  name: string;
  description: string;
  availability: ActivityAvailability;
  featureIds: string[];
  measurements: string[];
  datasets: string[];
  limitations: string[];
  recommendation: string;
  candidateNote: string;
}

export const ACTIVITIES: readonly Activity[] = [
  {
    id: 'rover-mobility',
    name: 'Rover mobility and navigation',
    description: 'Prioritize terrain geometry that affects traversability and route planning.',
    availability: 'supported',
    featureIds: ['elevation', 'slope_mean', 'slope_p90', 'tri', 'relief'],
    measurements: ['Elevation', 'mean and p90 slope', 'terrain ruggedness', 'local relief'],
    datasets: ['DEM-derived terrain layers'],
    limitations: ['Cell scores are not route-cost maps and do not model wheel performance, obstacles, or connectivity.'],
    recommendation: 'Use the map to compare terrain context, then verify routes against higher-resolution local DEM data.',
    candidateNote: 'terrain evidence highlighted; not a route guarantee',
  },
  {
    id: 'geological-sampling',
    name: 'Geological sampling',
    description: 'Use mapped rock and surface-property context to plan sampling candidates.',
    availability: 'partial',
    featureIds: ['basalt', 'sand', 'soc', 'relief'],
    measurements: ['Mapped basaltic/volcanic fraction', 'sand fraction', 'soil organic carbon', 'relief'],
    datasets: ['GLiM/Macrostrat geology', 'ISRIC SoilGrids'],
    limitations: ['Mapped lithology and soil properties are regional context, not proof of an exposed sample at a specific point.'],
    recommendation: 'Treat candidates as reconnaissance targets and confirm outcrops with field or higher-resolution geological data.',
    candidateNote: 'geology and surface context highlighted; confirm exposures',
  },
  {
    id: 'habitat-construction',
    name: 'Habitat construction and site preparation',
    description: 'Compare terrain, substrate, and environmental constraints relevant to preparing a site.',
    availability: 'partial',
    featureIds: ['elevation', 'slope_mean', 'slope_p90', 'relief', 'soc', 'sand', 'temp_mean', 'precip'],
    measurements: ['Terrain geometry', 'soil carbon and sand fraction', 'temperature', 'precipitation'],
    datasets: ['DEM-derived terrain layers', 'ISRIC SoilGrids', 'NASA POWER'],
    limitations: ['No bearing capacity, subsurface structure, flood model, construction material strength, or logistics layer is integrated.'],
    recommendation: 'Use this as environmental screening only; engineering surveys are required before site preparation.',
    candidateNote: 'terrain, soil, and climate context highlighted; not an engineering assessment',
  },
  {
    id: 'dust-experiments',
    name: 'Dust and surface-material experiments',
    description: 'Find locations with comparable surface material and atmospheric aerosol context.',
    availability: 'partial',
    featureIds: ['sand', 'soc', 'aod', 'humidity'],
    measurements: ['Sand fraction', 'soil organic carbon', 'aerosol optical depth', 'relative humidity'],
    datasets: ['ISRIC SoilGrids', 'MERRA-2 aerosol optical depth', 'NASA POWER'],
    limitations: ['AOD is an atmospheric column proxy; wind, particle-size distributions, and saltation rates are not integrated.'],
    recommendation: 'Use the result to plan material sampling, not to infer local dust flux or particle hazards.',
    candidateNote: 'surface and aerosol context highlighted; dust flux is not measured',
  },
  {
    id: 'ice-exploration',
    name: 'Ice-related exploration',
    description: 'Compare persistent ice/snow and cold-environment context.',
    availability: 'partial',
    featureIds: ['ice', 'temp_mean', 'temp_min', 'temp_range'],
    measurements: ['Permanent ice/snow fraction', 'mean and minimum temperature', 'temperature range'],
    datasets: ['MODIS/NSIDC snow and ice products', 'MODIS land surface temperature', 'NASA POWER'],
    limitations: ['The current ice layer is not a subsurface-ice, glacier-thickness, or permafrost probability product.'],
    recommendation: 'Use candidates for cold-surface reconnaissance and confirm ice depth and persistence with dedicated products.',
    candidateNote: 'surface-ice and cold-climate context highlighted; subsurface ice unconfirmed',
  },
  {
    id: 'human-field-operations',
    name: 'Human field operations',
    description: 'Compare environmental burden and terrain context for field crews.',
    availability: 'partial',
    featureIds: ['temp_mean', 'temp_min', 'precip', 'slope_mean', 'elevation'],
    measurements: ['Temperature', 'precipitation', 'slope', 'elevation'],
    datasets: ['NASA POWER', 'DEM-derived terrain layers'],
    limitations: ['Wind, accessibility, roads, hazards, communications, and seasonal operational windows are not integrated.'],
    recommendation: 'Use this for broad environmental screening, then add local weather, access, and safety assessments.',
    candidateNote: 'climate and terrain context highlighted; logistics are not scored',
  },
  {
    id: 'solar-power',
    name: 'Solar power experiments',
    description: 'Compare available surface solar energy while keeping terrain context visible.',
    availability: 'partial',
    featureIds: ['solar', 'elevation', 'slope_mean'],
    measurements: ['All-sky surface shortwave irradiance', 'elevation', 'slope'],
    datasets: ['NASA POWER solar irradiance'],
    limitations: ['The current layer does not calculate local horizon shading, panel orientation, dust deposition, or storage needs.'],
    recommendation: 'Use irradiance for regional comparison and verify shading and panel geometry at the experiment site.',
    candidateNote: 'solar and terrain context highlighted; local shading is not modeled',
  },
  {
    id: 'thermal-experiments',
    name: 'Thermal experiments',
    description: 'Compare surface and air-temperature regimes relevant to thermal testing.',
    availability: 'supported',
    featureIds: ['temp_mean', 'temp_range', 'temp_min', 'solar'],
    measurements: ['Mean temperature', 'diurnal temperature range', 'annual minimum temperature', 'solar irradiance'],
    datasets: ['MODIS land surface temperature', 'NASA POWER'],
    limitations: ['The layers are climatological summaries; they do not represent a specific day, shade condition, or instrument thermal response.'],
    recommendation: 'Use candidates for climate-regime selection and obtain local time-series data for experiment design.',
    candidateNote: 'thermal-regime evidence highlighted; local microclimate still required',
  },
  {
    id: 'cave-exploration',
    name: 'Cave exploration',
    description: 'Verified cave-location evidence is not available in the current integrated dataset.',
    availability: 'disabled',
    featureIds: [],
    measurements: [],
    datasets: ['No verified cave-location layer integrated'],
    limitations: ['Karst or volcanic context would not prove a cave exists; no cave evidence is shown.'],
    recommendation: 'Disabled until a documented, georeferenced cave or skylight dataset is integrated and validated.',
    candidateNote: 'disabled: no verified cave evidence layer',
  },
];

export function activityById(id: ActivityId): Activity {
  return ACTIVITIES.find((activity) => activity.id === id) ?? ACTIVITIES[0];
}
