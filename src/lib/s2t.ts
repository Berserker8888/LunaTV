/* eslint-disable @typescript-eslint/no-require-imports */
const OpenCC_cn2t = require('opencc-js/cn2t') as {
  Converter(options: { from: 'cn'; to: 'tw' }): (text: string) => string;
};
const OpenCC_t2cn = require('opencc-js/t2cn') as {
  Converter(options: { from: 'tw'; to: 'cn' }): (text: string) => string;
};

const s2twConverter = OpenCC_cn2t.Converter({ from: 'cn', to: 'tw' });
const tw2cnConverter = OpenCC_t2cn.Converter({ from: 'tw', to: 'cn' });

export function convertS2T(text: string): string {
  if (!text) return '';
  return s2twConverter(text);
}

export function convertT2S(text: string): string {
  if (!text) return '';
  return tw2cnConverter(text);
}
