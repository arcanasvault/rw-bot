import { Scenes } from 'telegraf';

export interface BotSceneSessionData extends Scenes.WizardSessionData {
  cursor: number;
}

export interface BotSession extends Scenes.WizardSession<BotSceneSessionData> {
  captcha?: {
    answer: string;
    verified: boolean;
  };
  pendingManualPaymentId?: string;
}

export interface BuyWizardState {
  planId?: string;
  planPriceTomans?: number;
  serviceName?: string;
  promoCode?: string;
  finalAmountTomans?: number;
  manualPaymentId?: string;
}

export interface RenewWizardState {
  serviceId?: string;
  planId?: string;
  planPriceTomans?: number;
  promoCode?: string;
  finalAmountTomans?: number;
  manualPaymentId?: string;
}

export interface WalletWizardState {
  amountTomans?: number;
  manualPaymentId?: string;
}

export interface AdminAddPlanWizardState {
  name?: string;
  displayName?: string;
  trafficGb?: number;
  durationDays?: number;
  priceTomans?: number;
  internalSquadId?: string;
}

export interface AdminEditPlanWizardState extends AdminAddPlanWizardState {
  planId?: string;
}

export interface AdminAddPromoWizardState {
  code?: string;
  type?: 'PERCENT' | 'FIXED';
  value?: number;
  maxUses?: number;
  expiresAt?: Date | null;
}
