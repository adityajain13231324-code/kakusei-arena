/** Registers the Soul Realms with the realm takeover layer (ids = RealmState.kind). */
import { registerRealm } from '../realm';
import { buildInfiniteVoid } from './infiniteVoid';
import { buildTailedBeastBomb } from './tailedBeastBomb';
import { buildKingOfHell } from './kingOfHell';
import { buildGearFifth } from './gearFifth';
import { buildPaths } from './paths';
import { buildSunForge } from './sunForge';
import { buildMoonlessVoid } from './moonlessVoid';
import { buildPetalStorm } from './petalStorm';
import { buildMountainTemple } from './mountainTemple';

registerRealm('infinite_void', buildInfiniteVoid);
registerRealm('tailed_beast_bomb', buildTailedBeastBomb);
registerRealm('king_of_hell', buildKingOfHell);
registerRealm('gear_fifth', buildGearFifth);
registerRealm('paths', buildPaths);
// the original four
registerRealm('sun_forge', buildSunForge);
registerRealm('moonless_void', buildMoonlessVoid);
registerRealm('petal_storm', buildPetalStorm);
registerRealm('mountain_temple', buildMountainTemple);

export const CROSSOVER_REALMS = ['infinite_void', 'tailed_beast_bomb', 'king_of_hell', 'gear_fifth', 'paths'];
export const ORIGINAL_REALMS = ['sun_forge', 'moonless_void', 'petal_storm', 'mountain_temple'];
