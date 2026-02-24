import { Scenes } from 'telegraf';

export interface BotSession extends Scenes.WizardSessionData {
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
}

export interface RenewWizardState {
  serviceId?: string;
  planId?: string;
  planPriceTomans?: number;
  promoCode?: string;
  finalAmountTomans?: number;
}

export interface WalletWizardState {
  amountTomans?: number;
}

export type BotSceneContext = Scenes.WizardContext<BotSession>;
