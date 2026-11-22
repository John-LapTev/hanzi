import { svgEl } from '../core/strokes.js';

/* ——— Рисунок учителя на карточке программы ———
   Старый учитель-китаец: соломенная шляпа доули, халат с запáхом «как буква y» (левая пола
   поверх правой — так носят ханьфу), красный кушак, длинная белая борода, указка из бамбука
   в поднятой руке и свиток в другой. Иван (22.10.2026) попросил «более детальным, более
   проработанным» — рисунок собран из списка фигур, чтобы правка не трогала код.
   Слои идут снизу вверх: что ниже в списке, то ближе к зрителю. */

const STRAW = '#d9b36c';
const STRAW_DARK = '#a9823c';
const ROBE = 'var(--accent)';            // халат — акцентом приложения, обе темы
const ROBE_DARK = '#5d63d8';
const TRIM = '#f2e3b8';                  // кайма ворота и рукавов
const GOLD = '#d9ad48';
const SASH = '#c7463d';
const SKIN = '#efcba6';
const SKIN_SHADE = '#d6a581';
const BLUSH = '#ee9a8c';
const BEARD = '#f4f4f7';
const BEARD_SHADE = '#c5c8d4';
const INK = '#3a3f52';
const BAMBOO = '#9a6a35';
const PAPER = '#f6eedb';

const LINE = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const stroke = (color, width, extra) => Object.assign({}, LINE, { stroke: color, 'stroke-width': width }, extra);

export const TEACHER_SHAPES = [
  // тень на полу
  ['ellipse', { cx: 60, cy: 143.5, rx: 32, ry: 3.2, fill: INK, opacity: '.13' }],

  // туфли выглядывают из-под подола
  ['ellipse', { cx: 50, cy: 139.5, rx: 7.5, ry: 3.4, fill: INK }],
  ['ellipse', { cx: 70, cy: 139.5, rx: 7.5, ry: 3.4, fill: INK }],

  // халат до пола, расширяется книзу; подол чуть скруглён
  ['path', { d: 'M44 68 C50 65 70 65 76 68 L80 72 L91 134 Q60 140 29 134 L40 72 Z', fill: ROBE }],
  // складки
  ['path', { d: 'M47 106 Q45 120 42 132M73 106 Q75 120 78 132M60 108 L60 136', ...stroke(ROBE_DARK, 1.2, { opacity: '.55' }) }],
  // кайма подола и золотая нить
  ['path', { d: 'M31 126 Q60 132 89 126 L91 134 Q60 140 29 134 Z', fill: ROBE_DARK }],
  ['path', { d: 'M31 126 Q60 132 89 126', ...stroke(GOLD, 1.3) }],

  // ворот запáхом: нижний край короткий, верхний — через всю грудь к поясу
  ['path', { d: 'M52 66 L60 78 L68 66 Z', fill: '#ffffff' }],
  ['path', { d: 'M52.5 66 L60 77', ...stroke(TRIM, 4) }],
  ['path', { d: 'M68 66 L46 98', ...stroke(TRIM, 5) }],
  ['path', { d: 'M68 66 L46 98', ...stroke(GOLD, 1, { opacity: '.8', transform: 'translate(2.3 1.4)' }) }],

  // кушак с узлом и концами
  ['path', { d: 'M35 95 L85 95 L86 103 L34 103 Z', fill: SASH }],
  ['path', { d: 'M57 103 L53 121M63 103 L67 119', ...stroke(SASH, 3) }],
  ['circle', { cx: 53, cy: 122, r: 1.8, fill: GOLD }],
  ['circle', { cx: 67, cy: 120, r: 1.8, fill: GOLD }],
  ['ellipse', { cx: 60, cy: 99, rx: 4.5, ry: 3.8, fill: '#a8352e' }],

  // левый (от нас) рукав висит широким колоколом, из него — рука со свитком
  ['path', { d: 'M43 69 C33 73 27 88 24 104 Q33 111 45 106 L49 86 Z', fill: ROBE }],
  ['path', { d: 'M40 76 C35 86 32 96 31 104', ...stroke(ROBE_DARK, 1.2, { opacity: '.55' }) }],
  ['path', { d: 'M25.5 105 Q33 110.4 44.6 106', ...stroke(TRIM, 3, { 'stroke-linecap': 'butt' }) }],
  ['rect', { x: -13, y: -3.6, width: 26, height: 7.2, rx: 3, fill: PAPER, transform: 'translate(40 108) rotate(-28)' }],
  ['path', { d: 'M-9 0 L9 0', ...stroke(SASH, 1, { opacity: '.7', transform: 'translate(40 108) rotate(-28)' }) }],
  ['rect', { x: -15.5, y: -4.6, width: 3.2, height: 9.2, rx: 1.4, fill: BAMBOO, transform: 'translate(40 108) rotate(-28)' }],
  ['rect', { x: 12.3, y: -4.6, width: 3.2, height: 9.2, rx: 1.4, fill: BAMBOO, transform: 'translate(40 108) rotate(-28)' }],
  ['ellipse', { cx: 37, cy: 108, rx: 4.6, ry: 4, fill: SKIN }],

  // правый рукав: рука поднята, ткань свисает под ней
  ['path', { d: 'M75 69 C84 70 92 64 98 55 L105 61 C101 72 93 83 82 87 L78 80 Z', fill: ROBE }],
  ['path', { d: 'M84 75 C90 72 95 67 99 62', ...stroke(ROBE_DARK, 1.2, { opacity: '.55' }) }],
  ['path', { d: 'M98 55 L105 61', ...stroke(TRIM, 3) }],
  ['circle', { cx: 104, cy: 55, r: 4.6, fill: SKIN }],
  // бамбуковая указка с коленцами
  ['path', { d: 'M104 53 L116 20', ...stroke(BAMBOO, 2.8) }],
  ['path', { d: 'M107.4 46 L110 46.9M110.6 37.2 L113.2 38.1M113.6 28.6 L116.2 29.5', ...stroke('#6f4a22', 1.1) }],
  ['circle', { cx: 116.2, cy: 19.6, r: 1.6, fill: '#6f4a22' }],

  // уши, лицо, румянец
  ['circle', { cx: 46.8, cy: 53, r: 3.2, fill: SKIN_SHADE }],
  ['circle', { cx: 73.2, cy: 53, r: 3.2, fill: SKIN_SHADE }],
  ['ellipse', { cx: 60, cy: 52, rx: 13, ry: 14, fill: SKIN }],
  ['path', { d: 'M47.5 43 C46 47 46.3 51 47.6 54M72.5 43 C74 47 73.7 51 72.4 54', ...stroke(BEARD_SHADE, 2.6) }],
  ['ellipse', { cx: 51.5, cy: 57, rx: 3, ry: 1.9, fill: BLUSH, opacity: '.55' }],
  ['ellipse', { cx: 68.5, cy: 57, rx: 3, ry: 1.9, fill: BLUSH, opacity: '.55' }],
  ['path', { d: 'M54 43.6 Q60 42.4 66 43.6', ...stroke(SKIN_SHADE, 0.9, { opacity: '.8' }) }],
  // лохматые белые брови и прищур улыбки
  ['path', { d: 'M49.5 48 Q53 45.6 57 47.2M63 47.2 Q67 45.6 70.5 48', ...stroke(BEARD, 2.6) }],
  ['path', { d: 'M49.5 48 Q53 45.6 57 47.2M63 47.2 Q67 45.6 70.5 48', ...stroke(BEARD_SHADE, 0.8) }],
  ['path', { d: 'M51.5 52 Q54 49.6 56.5 52M63.5 52 Q66 49.6 68.5 52', ...stroke(INK, 1.7) }],
  ['path', { d: 'M60 52.5 Q61.8 55.6 59.4 56.6', ...stroke(SKIN_SHADE, 1.4) }],

  // шнурок шляпы вдоль щёк к подбородку
  ['path', { d: 'M45 42 C46 52 50 61 56 65M75 42 C74 52 70 61 64 65', ...stroke(STRAW_DARK, 1.2) }],

  // длинная борода клином и усы поверх неё
  ['path', { d: 'M50 59 C49.5 70 54 82 60 94 C66 82 70.5 70 70 59 C66 63.5 54 63.5 50 59 Z', fill: BEARD }],
  ['path', { d: 'M55 67 Q57.5 78 60 89M65 67 Q62.5 78 60.6 86M60 64 L60 80', ...stroke(BEARD_SHADE, 0.9) }],
  ['path', { d: 'M60 58 C56 56.6 50.5 58.6 47.5 64.5 C51.5 62 56 61 60 60.6 C64 61 68.5 62 72.5 64.5 C69.5 58.6 64 56.6 60 58 Z', fill: BEARD }],
  ['path', { d: 'M60 58 C56 56.6 50.5 58.6 47.5 64.5M60 58 C64 56.6 69.5 58.6 72.5 64.5', ...stroke(BEARD_SHADE, 0.8) }],

  // шляпа доули: широкий пологий конус, плетение, тень справа, кромка
  ['path', { d: 'M60 4 L97 37 Q60 45 23 37 Z', fill: STRAW }],
  ['path', { d: 'M60 4 L97 37 Q82 41.5 64 42.6 Z', fill: STRAW_DARK, opacity: '.28' }],
  ['path', { d: 'M60 5 L33 39M60 5 L46 41.2M60 5 L60 42M60 5 L74 41.2M60 5 L87 39', ...stroke(STRAW_DARK, 0.9, { opacity: '.55' }) }],
  ['path', { d: 'M48.5 15 Q60 18 71.5 15M37 26 Q60 31.5 83 26', ...stroke(STRAW_DARK, 1, { opacity: '.6' }) }],
  ['path', { d: 'M23 37 Q60 45 97 37', ...stroke(STRAW_DARK, 1.8) }],
  ['circle', { cx: 60, cy: 4.5, r: 2.2, fill: STRAW_DARK }],
];

/** Учитель для карточки программы. Единственная крупная картинка в приложении — по ней
    сразу видно, что это программа, а не очередной режим. */
export function teacherFigure() {
  const svg = svgEl('svg', { viewBox: '0 0 120 148', width: 74, height: 91,
    'aria-hidden': 'true', class: 'teacher-figure' });
  TEACHER_SHAPES.forEach(([tag, attributes]) => svg.append(svgEl(tag, attributes)));
  return svg;
}
