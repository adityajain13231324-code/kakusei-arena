/** Registers the Crossover Pack Soul Realms with the realm takeover layer (ids = RealmState.kind). */
import { registerRealm } from '../realm';
import { buildInfiniteVoid } from './infiniteVoid';
import { buildTailedBeastBomb } from './tailedBeastBomb';
import { buildKingOfHell } from './kingOfHell';
import { buildGearFifth } from './gearFifth';
import { buildPaths } from './paths';

registerRealm('infinite_void', buildInfiniteVoid);
registerRealm('tailed_beast_bomb', buildTailedBeastBomb);
registerRealm('king_of_hell', buildKingOfHell);
registerRealm('gear_fifth', buildGearFifth);
registerRealm('paths', buildPaths);

export const CROSSOVER_REALMS = ['infinite_void', 'tailed_beast_bomb', 'king_of_hell', 'gear_fifth', 'paths'];
