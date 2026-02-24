import { Context, Scenes } from 'telegraf';
import { BotSceneSessionData, BotSession } from './session';

export interface BotContext extends Context {
  session: BotSession;
  scene: Scenes.SceneContextScene<BotContext, BotSceneSessionData>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}
