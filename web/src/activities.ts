import type { ActivityId, FeatureMeta } from './types';

export interface Activity {
  id: ActivityId;
  name: string;
  description: string;
  featureIds: string[];
  enabled: boolean;
  limitations: string[];
}

export const ACTIVITIES: Activity[] = [
  { id: 'rover-mobility', name: 'Rover mobility and navigation', description: 'Terrain geometry and surface conditions for traversability experiments.', featureIds: ['slope_mean', 'slope_p90', 'tri', 'relief'], enabled: true, limitations: ['Global cells are about 11 km; local obstacles need the terrain drill-down.'] },
  { id: 'geological-sampling', name: 'Geological sampling', description: 'Lithology, volcanic indicators and soil context for sampling plans.', featureIds: ['basalt', 'sand', 'soc'], enabled: true, limitations: ['Global geology is a coarse classification, not a site-scale outcrop map.'] },
  { id: 'habitat-construction', name: 'Habitat construction and site preparation', description: 'Terrain, material and environmental constraints relevant to preparing a site.', featureIds: ['elevation', 'relief', 'basalt', 'sand'], enabled: true, limitations: ['No verified construction cost, legal access or engineering survey is included.'] },
  { id: 'dust-materials', name: 'Dust and surface-material experiments', description: 'Surface texture and atmospheric aerosol context, kept scientifically separate.', featureIds: ['sand', 'soc', 'aod', 'wind'], enabled: true, limitations: ['Aerosol optical depth is not a direct measurement of surface dust availability.'] },
  { id: 'ice-exploration', name: 'Ice-related exploration', description: 'Terrestrial snow, ice and cold-environment indicators.', featureIds: ['ice', 'temp_mean', 'temp_min', 'basalt'], enabled: true, limitations: ['Terrestrial ice is not equivalent to accessible lunar or Martian subsurface ice.'] },
  { id: 'human-operations', name: 'Human field operations', description: 'Climate and terrain context for field activity planning.', featureIds: ['temp_mean', 'precip', 'humidity', 'relief'], enabled: true, limitations: ['Roads, permissions, security and operating costs are not inferred.'] },
  { id: 'solar-power', name: 'Solar power experiments', description: 'Surface irradiance and environmental context for power experiments.', featureIds: ['solar', 'aod', 'slope_mean'], enabled: true, limitations: ['Terrestrial irradiance is not a direct equivalent of lunar or Martian surface conditions.'] },
  { id: 'thermal-experiments', name: 'Thermal experiments', description: 'Surface and atmospheric temperature context for thermal testing.', featureIds: ['temp_mean', 'temp_range', 'temp_min', 'solar'], enabled: true, limitations: ['Temperature sources may be land-surface or 2 m air measurements; the distinction is disclosed in metadata.'] },
  { id: 'cave-exploration', name: 'Cave exploration', description: 'Verified cave locations and karst context.', featureIds: ['basalt'], enabled: false, limitations: ['No sufficiently reliable global verified-cave dataset is integrated; karst is not proof of a cave.'] },
];

export function activityFor(id: ActivityId): Activity {
  return ACTIVITIES.find((activity) => activity.id === id) ?? ACTIVITIES[0];
}

export function activityFeatures(activity: Activity, features: FeatureMeta[]): FeatureMeta[] {
  return activity.featureIds.map((id) => features.find((feature) => feature.id === id)).filter((feature): feature is FeatureMeta => !!feature);
}
