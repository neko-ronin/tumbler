/** The web client's version. One place, bumped in the commit that ships it.
 *
 * The manifest records the commit the *world data* came from (`viewer.json`'s
 * `commit`); this records the client itself, which changes without the world
 * changing. `scene.html` shows it beside the title and the Field notes repeat
 * it with the generation, so a visitor can say which release they are at.
 */
export const VERSION = '0.5.0';
