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

const api = axios.create({
  baseURL: env.REMNAWAVE_URL,
  timeout: 20000,
  headers: {
    Authorization: `Bearer ${env.REMNAWAVE_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function execCommand<TResponse>(args: {
  method: Method;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  schema?: z.ZodType<TResponse>;
}): Promise<TResponse> {
  try {
    const res = await api.request<TResponse>({
      method: args.method,
      url: args.url,
      params: args.params,
      data: args.data,
    });

    return args.schema ? args.schema.parse(res.data) : res.data;
  } catch (error) {
    const err = error as AxiosError<unknown>;
    logger.error(
      `Remnawave request failed status=${err.response?.status ?? 'unknown'} url=${args.url}`,
    );
    throw error;
  }
}

export interface CreateRemnaUserInput {
  username: string;
  trafficLimitBytes: number;
  expireAt: Date;
  telegramId: number;
}

export interface UpdateRemnaUserInput {
  uuid: string;
  trafficLimitBytes: number;
  expireAt: Date;
  enabled?: boolean;
}

export class RemnawaveService {
  async createUser(input: CreateRemnaUserInput) {
    const response = await execCommand<CreateUserCommand.Response>({
      method: CreateUserCommand.endpointDetails.REQUEST_METHOD,
      url: CreateUserCommand.url,
      data: {
        username: input.username,
        trafficLimitBytes: input.trafficLimitBytes,
        expireAt: input.expireAt.toISOString(),
        telegramId: input.telegramId,
        status: USERS_STATUS.ACTIVE,
        trafficLimitStrategy: RESET_PERIODS.NO_RESET,
      } satisfies CreateUserCommand.Request,
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
        expireAt: input.expireAt.toISOString(),
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
