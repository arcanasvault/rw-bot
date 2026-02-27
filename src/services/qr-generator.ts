import QRCodeStyling from 'qr-code-styling';
import sharp from 'sharp';
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

export async function generateQrPngBuffer(input: {
  data: string;
  telegramId: number;
}): Promise<Buffer> {
  const source = input.data.trim();
  if (!source) {
    throw new Error('QR source data is empty');
  }

  const tryGenerate = async (withLogo: boolean): Promise<Buffer> => {
    const options = buildQrOptions(source, withLogo ? env.LOGO_URL : undefined);
    const qr = new QRCodeStyling(options);
    const svgRaw = ensureBuffer(await qr.getRawData('svg'));
    return sharp(svgRaw).png().toBuffer();
  };

  try {
    return await tryGenerate(Boolean(env.LOGO_URL));
  } catch (error) {
    if (env.LOGO_URL) {
      logger.warn(
        `QR with logo failed for user ${input.telegramId}, retrying without logo: ${String(error)}`,
      );
      try {
        return await tryGenerate(false);
      } catch (secondError) {
        logger.error(`Failed to generate QR for user ${input.telegramId}: ${String(secondError)}`);
        throw secondError;
      }
    }
    logger.error(`Failed to generate QR for user ${input.telegramId}: ${String(error)}`);
    throw error;
  }
}
