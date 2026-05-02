import { createFileImpactLedger, type ImpactLedger } from '@yagr/impact-ledger';
import { getYagrHomeDir } from '../config/yagr-home.js';

let ledger: ImpactLedger | undefined;

export function getGatewayImpactLedger(): ImpactLedger {
  ledger ??= createFileImpactLedger(getYagrHomeDir());
  return ledger;
}
