/**
 * Realm takeover layer (extension point). A "realm" is a full alternate stage (StageBuild) that a fighter's
 * Soul Realm ultimate swaps in for a few seconds. Content lives elsewhere: register a builder per realm id,
 * the renderer pre-builds it (prewarmRealm, e.g. during the VS screen) and cross-dissolves stage ↔ realm.
 *
 *   registerRealm('sun_forge', (half, q) => buildSunForge(half, q));
 *   renderer.prewarmRealm('sun_forge');      // optional: build + compile shaders ahead of time
 *   renderer.setRealm('sun_forge');          // or the sim sets state.realm = { id } (read automatically)
 *   renderer.setRealm(null);                 // dissolve back to the stage
 *
 * A builder may implement StageBuild.setDissolve(k) (k: 0 = hidden … 1 = fully shown) for a custom dissolve
 * shader; otherwise the renderer just swaps visibility at the midpoint and blends fog / sky / light colours.
 */
import type { StageBuild } from './common';

export type RealmBuilder = (halfMetres: number, quality: 'low' | 'medium' | 'high') => StageBuild;

const realms = new Map<string, RealmBuilder>();

export function registerRealm(id: string, builder: RealmBuilder): void { realms.set(id, builder); }
export function unregisterRealm(id: string): void { realms.delete(id); }
export function getRealmBuilder(id: string): RealmBuilder | undefined { return realms.get(id); }
export function registeredRealms(): string[] { return [...realms.keys()]; }
