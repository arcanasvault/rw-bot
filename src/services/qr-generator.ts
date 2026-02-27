import QRCodeStyling from 'qr-code-styling';
import sharp from 'sharp';
import axios from 'axios';
import { env } from '../config/env';
import { buildQrOptions } from '../config/qr';
import { logger } from '../lib/logger';

function ensureBuffer(data: Buffer | Blob | null): Buffer {
  if (!data) {
    throw new Error('QR raw data is empty');
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  throw new Error('QR raw data is not a buffer');
}

function toContentType(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
    return value[0].trim();
  }
  return 'image/png';
}

async function loadLogoBuffer(telegramId: number, logoUrl: string): Promise<Buffer | null> {
  try {
    const response = await axios.get<ArrayBuffer>(logoUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const contentType = toContentType(response.headers['content-type']);
    const raw = Buffer.from(response.data);
    if (contentType.includes('svg')) {
      return sharp(raw).png().toBuffer();
    }
    return raw;
  } catch (error) {
    logger.error(
      `Failed to load logo for user ${telegramId}: ${String(error)} | path=${logoUrl}`,
    );
    return null;
  }
}

async function applyCenteredLogo(input: {
  qrPng: Buffer;
  logoBuffer: Buffer;
  telegramId: number;
  logoUrl: string;
}): Promise<Buffer> {
  try {
    const qrMeta = await sharp(input.qrPng).metadata();
    const qrWidth = qrMeta.width ?? 820;
    const qrHeight = qrMeta.height ?? 820;
    const logoSize = Math.max(64, Math.floor(Math.min(qrWidth, qrHeight) * 0.24));
    const logoPng = await sharp(input.logoBuffer)
      .resize(logoSize, logoSize, { fit: 'contain' })
      .png()
      .toBuffer();

    return sharp(input.qrPng)
      .composite([{ input: logoPng, gravity: 'center' }])
      .png()
      .toBuffer();
  } catch (error) {
    logger.error(
      `Failed to composite logo for user ${input.telegramId}: ${String(error)} | path=${input.logoUrl}`,
    );
    throw error;
  }
}

export async function generateQrPngBuffer(input: {
  data: string;
  telegramId: number;
}): Promise<Buffer> {
  const source = input.data.trim();
  if (!source) {
    throw new Error('QR source data is empty');
  }

  const tryGenerate = async (logoImage?: string): Promise<Buffer> => {
    const options = buildQrOptions(source, logoImage);
    const qr = new QRCodeStyling(options);
    const svgRaw = ensureBuffer(await qr.getRawData('svg'));
    return sharp(svgRaw).png().toBuffer();
  };

  try {
    const baseQr = await tryGenerate();
    if (!env.LOGO_URL) {
      return baseQr;
    }

    const logo = await loadLogoBuffer(input.telegramId, env.LOGO_URL);
    if (!logo) {
      return baseQr;
    }

    return await applyCenteredLogo({
      qrPng: baseQr,
      logoBuffer: logo,
      telegramId: input.telegramId,
      logoUrl: env.LOGO_URL,
    });
  } catch (error) {
    logger.error(
      `Failed to generate QR for user ${input.telegramId}: ${String(error)} | path=${env.LOGO_URL ?? 'none'}`,
    );
    throw error;
  }
}
