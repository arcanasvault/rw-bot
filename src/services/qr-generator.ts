import QRCodeStyling from 'qr-code-styling';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
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

function normalizeLogoPath(rawPath: string): string {
  const expanded = rawPath
    .replace(/\$\{PWD\}/g, process.cwd())
    .replace(/^\$PWD/, process.cwd());

  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return path.resolve(process.cwd(), expanded);
}

async function loadLogoBuffer(
  telegramId: number,
  logoPath: string,
): Promise<{ buffer: Buffer; resolvedPath: string } | null> {
  const resolvedPath = normalizeLogoPath(logoPath);

  try {
    const raw = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();

    if (ext === '.svg') {
      return {
        buffer: await sharp(raw).png().toBuffer(),
        resolvedPath,
      };
    }

    return {
      buffer: raw,
      resolvedPath,
    };
  } catch (error) {
    logger.error(
      `Failed to load logo for user ${telegramId}: ${String(error)} | path=${resolvedPath}`,
    );
    return null;
  }
}

async function applyCenteredLogo(input: {
  qrPng: Buffer;
  logoBuffer: Buffer;
  telegramId: number;
  logoPath: string;
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
      `Failed to composite logo for user ${input.telegramId}: ${String(error)} | path=${input.logoPath}`,
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

  const tryGenerate = async (): Promise<Buffer> => {
    const options = buildQrOptions(source);
    const qr = new QRCodeStyling(options);
    const svgRaw = ensureBuffer(await qr.getRawData('svg'));
    return sharp(svgRaw).png().toBuffer();
  };

  try {
    const baseQr = await tryGenerate();
    const logoPath = process.env.LOGO_PATH?.trim();
    if (!logoPath) {
      return baseQr;
    }

    const logo = await loadLogoBuffer(input.telegramId, logoPath);
    if (!logo) {
      return baseQr;
    }

    return await applyCenteredLogo({
      qrPng: baseQr,
      logoBuffer: logo.buffer,
      telegramId: input.telegramId,
      logoPath: logo.resolvedPath,
    });
  } catch (error) {
    logger.error(
      `Failed to generate QR for user ${input.telegramId}: ${String(error)} | path=${process.env.LOGO_PATH ?? 'none'}`,
    );
    throw error;
  }
}
