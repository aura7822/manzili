export const HOUSE_TYPES = [
  { value: 'single', label: 'Single' },
  { value: 'bedsitter', label: 'Bedsitter' },
  { value: 'studio', label: 'Studio' },
  { value: '1_bedroom', label: '1 bedroom' },
  { value: '2_bedroom', label: '2 bedroom' },
  { value: '3_bedroom', label: '3 bedroom' },
  { value: '4_bedroom', label: '4 bedroom' },
];

export const typeLabel = (value) => HOUSE_TYPES.find((t) => t.value === value)?.label ?? 'Not set';

/** Price that applies to property + type + floor: a floor price wins over the "all floors" price. */
export function findPrice(rules, propertyId, type, floor) {
  const mine = rules.filter((r) => r.property_id === propertyId && r.unit_type === type);
  const exact = mine.find((r) => r.floor_number !== null && Number(r.floor_number) === Number(floor));
  return (exact ?? mine.find((r) => r.floor_number === null))?.monthly_rent ?? null;
}
