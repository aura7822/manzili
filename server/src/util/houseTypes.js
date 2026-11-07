export const HOUSE_TYPES = ['single', 'bedsitter', 'studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_bedroom'];

export const houseTypeLabel = (t) =>
  ({ single: 'Single', bedsitter: 'Bedsitter', studio: 'Studio', '1_bedroom': '1 bedroom', '2_bedroom': '2 bedroom', '3_bedroom': '3 bedroom', '4_bedroom': '4 bedroom' })[t] ?? 'Not set';
