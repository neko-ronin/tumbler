/** First-load composition, authored in world metres (east, north, up). */
export const openingShot = {
  ronin: {x: -709.62296, y: 493.78108, heading: 1.614},
  target: [-712.77774, 470.91657, 91.43685],
  fov: 62,
  seconds: 9,
  // Swing counterclockwise around the outside of the northeast corner tree.
  // Descend on its west side and approach Ronin from the north. Navigation
  // replaces the last point with the live chase-camera position.
  waypoints: [
    [-661.37356, 500.6909, 99.86885],
    [-665, 518, 101],
    [-676, 532, 100],
    [-692, 540, 96],
    [-708, 538, 90],
    [-720, 528, 83],
    [-717, 514, 77],
    [-713, 505, 73.5],
    [-710, 499, 70.2],
  ],
};
