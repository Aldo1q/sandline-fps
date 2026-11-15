// SANDLINE look plan: a late-afternoon desert yard. Warm sand and rust against
// dark steel, one teal accent for the player's team and the HUD. Every colour
// the game uses is named here; index.html's CSS uses the same six base names.
export const PALETTE = {
  canvas: '#1a1712', // sky / fog / page background
  surface: '#3a332a', // walls, ground shadow
  hairline: '#4c4436', // trim, crates
  ink: '#efe7d6', // text, light metal
  muted: '#9a8f7a', // secondary text, dust
  accent: '#2fb3a3', // Vanguard teal: HUD, team colour, site A
  sand: '#c9a86a', // ground, sandbags
  sandDark: '#a98a52', // ground variation
  rust: '#b0542f', // Raiders red: enemy colour, site B
  rustDark: '#7e3a20',
  steel: '#2a2e33', // containers, dark metal
  steelLight: '#3d444c',
  containerBlue: '#33566b',
  containerGreen: '#4a5d3a',
  wood: '#6b4e2e', // crates
  sun: '#ffd9a0', // warm key light
  sky: '#d8c49a', // horizon
};

export function color(name) {
  return PALETTE[name];
}
