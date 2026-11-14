export interface Capability {
  id: 'radiation' | 'verified-caves' | 'earth-operations';
  name: string;
  status: 'available' | 'unavailable' | 'context-only';
  explanation: string;
  sources: string[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: 'radiation',
    name: 'Terrestrial ionizing radiation',
    status: 'unavailable',
    explanation: 'No validated global terrestrial ionizing-radiation layer is published in this build. Solar irradiance and aerosol optical depth are not substitutes for radiation dose.',
    sources: [],
  },
  {
    id: 'verified-caves',
    name: 'Verified cave locations',
    status: 'unavailable',
    explanation: 'No sufficiently complete, consistently verified global cave-location dataset is integrated. Karst or basalt indicators must not be presented as confirmed caves.',
    sources: [],
  },
  {
    id: 'earth-operations',
    name: 'Earth operational complications',
    status: 'context-only',
    explanation: 'The application can disclose missing access, safety, legal, infrastructure, and local-survey information, but does not infer those facts from environmental similarity.',
    sources: ['Existing Earth observation layers and published feature provenance'],
  },
];

export function capability(id: Capability['id']): Capability {
  return CAPABILITIES.find((item) => item.id === id)!;
}
