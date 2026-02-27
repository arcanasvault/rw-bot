import { Options } from 'qr-code-styling';
import { JSDOM } from 'jsdom';

export const qrOptions: Options = {
  jsdom: JSDOM,
  width: 700,
  height: 700,
  margin: 20,
  type: 'svg',
  image: './qr.svg',
  dotsOptions: {
    type: 'extra-rounded',
    color: '#6a1a4c',
    roundSize: true,
    gradient: {
      type: 'radial',
      rotation: 0,
      colorStops: [
        { offset: 0, color: '#40138f' },
        { offset: 1, color: '#120d36' },
      ],
    },
  },
  cornersSquareOptions: {
    type: 'dot',
    color: '#000000',
    gradient: {
      type: 'linear',
      rotation: 0,
      colorStops: [
        { offset: 0, color: '#120d36' },
        { offset: 1, color: '#2d0f63' },
      ],
    },
  },
  backgroundOptions: {
    color: '#fefefe',
  },
  imageOptions: {
    crossOrigin: 'anonymous',
    margin: 10,
    imageSize: 0.5,
  },
};
