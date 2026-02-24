import { Context, Scenes } from 'telegraf';
import { BotSession } from './session';

export type BotContext = Context &
  Scenes.WizardContext<BotSession> & {
    session: BotSession;
  };
