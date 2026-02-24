import axios from 'axios';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';

const tetraApi = axios.create({
  baseURL: 'https://tetra98.ir',
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

interface CreateOrderResponse {
  status?: number;
  Status?: number;
  authority?: string;
  Authority?: string;
  [key: string]: unknown;
}

interface VerifyResponse {
  status?: number;
  Status?: number;
  RefID?: string;
  ref_id?: string;
  [key: string]: unknown;
}

export class Tetra98Service {
  async createOrder(input: {
    hashId: string;
    amountRials: number;
    callbackUrl: string;
  }): Promise<{ authority: string; raw: CreateOrderResponse }> {
    const { data } = await tetraApi.post<CreateOrderResponse>('/api/create_order', {
      ApiKey: env.TETRA98_API_KEY,
      Hash_id: input.hashId,
      Amount: input.amountRials,
      CallbackURL: input.callbackUrl,
    });

    const status = data.status ?? data.Status;
    const authority = (data.authority ?? data.Authority ?? '').toString();

    if (status !== 100 || !authority) {
      throw new AppError('خطا در ایجاد سفارش پرداخت', 'TETRA98_CREATE_FAILED', 400);
    }

    return { authority, raw: data };
  }

  async verify(authority: string): Promise<{ ok: boolean; raw: VerifyResponse }> {
    const { data } = await tetraApi.post<VerifyResponse>('/api/verify', {
      ApiKey: env.TETRA98_API_KEY,
      authority,
    });

    const status = data.status ?? data.Status;

    return { ok: status === 100, raw: data };
  }

  getPaymentLink(authority: string): string {
    return `https://t.me/Tetra98_bot?start=pay_${authority}`;
  }
}

export const tetra98Service = new Tetra98Service();
