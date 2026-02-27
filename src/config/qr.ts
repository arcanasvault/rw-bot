import { JSDOM } from 'jsdom';
import type { Options } from 'qr-code-styling';

export function buildQrOptions(data: string, logoUrl?: string): Options {
  return {
    jsdom: JSDOM,
    width: 820,
    height: 820,
    margin: 18,
    type: 'svg',
    data,
    image: logoUrl || undefined,
    qrOptions: {
      errorCorrectionLevel: 'Q',
    },
    dotsOptions: {
      type: 'extra-rounded',
      gradient: {
        type: 'linear',
        rotation: Math.PI / 4,
        colorStops: [
          { offset: 0, color: '#1d4ed8' },
          { offset: 1, color: '#0f172a' },
        ],
      },
    },
    cornersSquareOptions: {
      type: 'extra-rounded',
      gradient: {
        type: 'linear',
        rotation: Math.PI / 8,
        colorStops: [
          { offset: 0, color: '#0891b2' },
          { offset: 1, color: '#1e3a8a' },
        ],
      },
    },
    cornersDotOptions: {
      type: 'dot',
      color: '#0f172a',
    },
    backgroundOptions: {
      color: '#ffffff',
    },
    imageOptions: {
      crossOrigin: 'anonymous',
      margin: 8,
      imageSize: 0.32,
      saveAsBlob: true,
    },
  };
}
