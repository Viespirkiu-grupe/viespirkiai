/**
 * File-type icon theme constants.
 *
 * Maps a file's extension to a renderer key (`type`) plus the two colours
 * used by the SVG icon in `<FileCard>`.
 */

export interface FileIconTheme {
  type: 'pdf' | 'doc' | 'xls' | 'ppt' | 'img' | 'zip' | 'tedeu' | 'tedlt' | 'generic';
  base: string;
  fold2: string;
}

const SHADE_THEME: FileIconTheme['base'] | string = 'var(--shade-5)';
const SHADE_THEME_2: FileIconTheme['fold2'] | string = 'var(--shade-6)';

const EXTENSION_THEMES: Array<{ exts: string[] | string; theme: FileIconTheme }> = [
  { exts: 'pdf', theme: { type: 'pdf', base: SHADE_THEME, fold2: SHADE_THEME_2 } },
  { exts: ['doc', 'docx', 'odt', 'rtf', 'dot', 'dotx', 'docm'], theme: { type: 'doc', base: '#1a2a4a', fold2: '#2e5fa3' } },
  { exts: ['xls', 'xlsx', 'xlsb', 'ods', 'xlt'], theme: { type: 'xls', base: '#1a3020', fold2: '#2e7a3e' } },
  { exts: ['ppt', 'pptx', 'ppsx', 'odp'], theme: { type: 'ppt', base: '#3a2414', fold2: '#d35400' } },
  { exts: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'tif', 'tiff', 'webp', 'svg', 'heic'], theme: { type: 'img', base: SHADE_THEME, fold2: SHADE_THEME_2 } },
  { exts: ['zip', '7z', 'rar'], theme: { type: 'zip', base: '#2e2010', fold2: '#8a6020' } },
  { exts: 'tedeu', theme: { type: 'tedeu', base: '#1a3a8c', fold2: '#0d2260' } },
  { exts: 'tedlt', theme: { type: 'tedlt', base: '#f5cb35', fold2: '#c9a820' } },
];

const GENERIC_THEME: FileIconTheme = { type: 'generic', base: SHADE_THEME, fold2: SHADE_THEME_2 };

export function getFileIconTheme(extension: string): FileIconTheme {
  const ext = extension.toLowerCase();
  for (const { exts, theme } of EXTENSION_THEMES) {
    if (typeof exts === 'string' ? exts === ext : exts.includes(ext)) return theme;
  }
  return GENERIC_THEME;
}
