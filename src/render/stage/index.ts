import type { StageId } from '../../sim/types';
import type { StageBuild } from './common';
import { buildRooftop } from './rooftop';
import { buildShrine } from './shrine';
import { buildTraining } from './training';

export type { StageBuild } from './common';
export { registerRealm, unregisterRealm, getRealmBuilder, registeredRealms, type RealmBuilder } from './realm';

export function buildStage(id: StageId, halfMetres: number, quality: 'low' | 'medium' | 'high'): StageBuild {
  switch (id) {
    case 'rooftop': return buildRooftop(halfMetres, quality);
    case 'shrine': return buildShrine(halfMetres, quality);
    default: return buildTraining(halfMetres);
  }
}
