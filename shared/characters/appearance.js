/** Engine-neutral character appearance recipe. Tints multiply the source colours;
 * proportions are bounded visual changes, without changing movement or colliders.
 */
const freeze = value => {for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item); return Object.freeze(value);};
export const DEFAULT_APPEARANCE = freeze({
  version: 1, base: 'cat-ronin', name: 'Cat Ronin',
  palette: {coat: '#ffffff', beanie: '#ffffff', outfit: '#ffffff', eyes: '#ffffff', accent: '#ffffff'},
  features: {earSize: 1, headSize: 1, tailLength: 1},
  equipment: {eyepatch: 'hex', hat: true, katana: true},
});
/** The characters a recipe can be built on: the model each loads (under
 * shared/geometry/) and the face its fur is fitted to. The game plays the
 * first; the original Cat Ronin stays selectable in the studio and lab. */
export const CHARACTER_BASES = freeze({
  'cat-ronin': {label: 'Cat Ronin', asset: 'cat-ronin/ronin.glb', face: 'ronin', anatomy: 'felid-biped-v1'},
  'cat-ronin-original': {label: 'Cat Ronin (original)', asset: 'cat-ronin/original/ronin.glb', face: 'original', anatomy: 'felid-biped-v1'},
});
export const FEATURE_RANGES = freeze({earSize: [.75, 1.25], headSize: [.9, 1.1], tailLength: [.75, 1.25]});
export const EYEPATCHES = Object.freeze(['none', 'hex', 'round', 'almond', 'shield']);

function shape(value, template, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== Object.keys(template).length || Object.keys(template).some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} must contain exactly the character appearance fields.`);
  }
}
/** Refuse unknown versions/fields and invalid values; return a detached recipe. */
export function validateAppearance(input) {
  shape(input, DEFAULT_APPEARANCE, 'Appearance');
  if (input.version !== 1 || !Object.hasOwn(CHARACTER_BASES, input.base)) throw new Error('Unsupported character appearance version or base.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new Error('Character name must be 1–80 characters.');
  for (const section of ['palette', 'features', 'equipment']) shape(input[section], DEFAULT_APPEARANCE[section], section);
  const palette = {};
  for (const key of Object.keys(DEFAULT_APPEARANCE.palette)) {
    if (typeof input.palette[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.palette[key])) throw new Error(`Invalid ${key} tint; use #rrggbb.`);
    palette[key] = input.palette[key].toLowerCase();
  }
  for (const [key, [min, max]] of Object.entries(FEATURE_RANGES)) {
    const value = input.features[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  if (!EYEPATCHES.includes(input.equipment.eyepatch)) throw new Error('Unknown eyepatch shape.');
  for (const key of ['hat', 'katana']) if (typeof input.equipment[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
  return {version: 1, base: input.base, name: input.name.trim(), palette, features: {...input.features}, equipment: {...input.equipment}};
}
const preset = (id, label, changes = {}) => ({id, label, recipe: {...DEFAULT_APPEARANCE, ...changes,
  palette: {...DEFAULT_APPEARANCE.palette, ...changes.palette}, features: {...DEFAULT_APPEARANCE.features, ...changes.features},
  equipment: {...DEFAULT_APPEARANCE.equipment, ...changes.equipment}}});
export const APPEARANCE_PRESETS = freeze([
  preset('original', 'Ronin'),
  preset('moss', 'Moss', {name: 'Moss', palette: {coat: '#c9d9c5', beanie: '#96c6b2', outfit: '#a9c4ae', eyes: '#b5f0d3', accent: '#a6e8ca'}, features: {earSize: 1.1}, equipment: {eyepatch: 'round'}}),
  preset('ember', 'Ember', {name: 'Ember', palette: {coat: '#f4c6a0', beanie: '#f2b2a8', outfit: '#dbafa0', eyes: '#ffd48a', accent: '#ffb690'}, features: {headSize: 1.04, tailLength: 1.12}, equipment: {eyepatch: 'shield'}}),
  preset('moon', 'Moon', {name: 'Moon', palette: {coat: '#c8d8f5', beanie: '#bfbee8', outfit: '#b8c9e5', eyes: '#a2dcff', accent: '#b8cfff'}, features: {earSize: 1.16, tailLength: 1.18}, equipment: {eyepatch: 'almond'}}),
]);
