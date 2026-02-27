import { JSDOM } from 'jsdom';
import type { Options } from 'qr-code-styling';
import nodeCanvas from 'canvas';

export function buildQrOptions(data: string, logoUrl?: string): Options {
  return {
    jsdom: JSDOM,
    nodeCanvas,
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
      color: '#6a1a4c',
      gradient: {
        type: 'linear',
        rotation: Math.PI / 4,
        colorStops: [
          { offset: 0, color: '#40138f' },
          { offset: 1, color: '#120d36' },
        ],
      },
    },
    cornersSquareOptions: {
      type: 'extra-rounded',
      gradient: {
        type: 'linear',
        rotation: Math.PI / 8,
        colorStops: [
          { offset: 0, color: '#120d36' },
          { offset: 1, color: '#2d0f63' },
        ],
      },
    },
    cornersDotOptions: {
      type: 'dot',
      color: '#0f172a',
    },
    backgroundOptions: {
      color: '#fefefe',
    },
    imageOptions: {
      // crossOrigin: 'anonymous',
      margin: 8,
      imageSize: 0.4,
      saveAsBlob: true,
    },
  };
}
