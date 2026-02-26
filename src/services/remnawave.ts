import axios, { AxiosError, Method } from 'axios';
import {
  CreateUserCommand,
  DeleteUserCommand,
  GetSubscriptionByUuidCommand,
  GetUserByUsernameCommand,
  ResetUserTrafficCommand,
  RESET_PERIODS,
  UpdateUserCommand,
  USERS_STATUS,
} from '@remnawave/backend-contract';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const normalizedBaseUrl = env.REMNAWAVE_URL.replace(/\/+$/, '').replace(/\/api$/i, '');

const api = axios.create({
  baseURL: normalizedBaseUrl,
  timeout: 20000,
  headers: {
    Authorization: `Bearer ${env.REMNAWAVE_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryable(err: AxiosError<unknown>): boolean {
  if (!err.response) {
    return true;
  }

  return RETRYABLE_STATUS_CODES.has(err.response.status);
}

async function execCommand<TResponse>(args: {
  method: Method;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  schema?: z.ZodTypeAny;
}): Promise<TResponse> {
  let lastError: AxiosError<unknown> | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await api.request<TResponse>({
        method: args.method,
        url: args.url,
        params: args.params,
        data: args.data,
      });

      const parsed = args.schema ? args.schema.parse(res.data) : res.data;
      return parsed as TResponse;
    } catch (error) {
      const err = error as AxiosError<unknown>;
      lastError = err;

      const retryable = isRetryable(err);
      logger.error(
        `Remnawave request failed status=${err.response?.status ?? 'unknown'} url=${args.url} attempt=${attempt}/${MAX_RETRIES}`,
      );

      if (!retryable || attempt === MAX_RETRIES) {
        break;
      }

      await sleep(attempt * 400);
    }
  }

  throw lastError ?? new Error('Unknown Remnawave error');
}

export interface CreateRemnaUserInput {
  username: string;
  trafficLimitBytes: number;
  expireAt: Date;
  telegramId: number;
  activeInternalSquads?: string[];
}

export interface UpdateRemnaUserInput {
  uuid: string;
  trafficLimitBytes: number;
  expireAt: Date;
  enabled?: boolean;
}

export class RemnawaveService {
  async createUser(input: CreateRemnaUserInput) {
    const requestPayload = {
      username: input.username,
      trafficLimitBytes: input.trafficLimitBytes,
      expireAt: input.expireAt,
      telegramId: input.telegramId,
      status: USERS_STATUS.ACTIVE,
      trafficLimitStrategy: RESET_PERIODS.NO_RESET,
      activeInternalSquads: input.activeInternalSquads,
    } as CreateUserCommand.Request & { activeInternalSquads?: number[] };

    const response = await execCommand<CreateUserCommand.Response>({
      method: CreateUserCommand.endpointDetails.REQUEST_METHOD,
      url: CreateUserCommand.url,
      data: requestPayload,
      schema: CreateUserCommand.ResponseSchema,
    });

    return response.response;
  }

  async updateUser(input: UpdateRemnaUserInput) {
    const response = await execCommand<UpdateUserCommand.Response>({
      method: UpdateUserCommand.endpointDetails.REQUEST_METHOD,
      url: UpdateUserCommand.url,
      data: {
        uuid: input.uuid,
        trafficLimitBytes: input.trafficLimitBytes,
        expireAt: input.expireAt,
        status: input.enabled === false ? USERS_STATUS.DISABLED : USERS_STATUS.ACTIVE,
      } satisfies UpdateUserCommand.Request,
      schema: UpdateUserCommand.ResponseSchema,
    });

    return response.response;
  }

  async getUserByUsername(username: string) {
    const response = await execCommand<GetUserByUsernameCommand.Response>({
      method: GetUserByUsernameCommand.endpointDetails.REQUEST_METHOD,
      url: GetUserByUsernameCommand.url(username),
      schema: GetUserByUsernameCommand.ResponseSchema,
    });

    return response.response;
  }

  async deleteUser(uuid: string): Promise<void> {
    await execCommand<DeleteUserCommand.Response>({
      method: DeleteUserCommand.endpointDetails.REQUEST_METHOD,
      url: DeleteUserCommand.url(uuid),
      schema: DeleteUserCommand.ResponseSchema,
    });
  }

  async getSubscriptionByUuid(uuid: string) {
    const response = await execCommand<GetSubscriptionByUuidCommand.Response>({
      method: GetSubscriptionByUuidCommand.endpointDetails.REQUEST_METHOD,
      url: GetSubscriptionByUuidCommand.url(uuid),
      schema: GetSubscriptionByUuidCommand.ResponseSchema,
    });

    return response.response;
  }

  async resetTraffic(uuid: string): Promise<void> {
    await execCommand<ResetUserTrafficCommand.Response>({
      method: ResetUserTrafficCommand.endpointDetails.REQUEST_METHOD,
      url: ResetUserTrafficCommand.url(uuid),
      schema: ResetUserTrafficCommand.ResponseSchema,
    });
  }
}

export const remnawaveService = new RemnawaveService();
