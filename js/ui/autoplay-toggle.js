import { setSetting } from '../core/db.js';
import { speech } from '../core/speech.js';
import { el, toast } from './dom.js';

/* ——— Переключатель «Автовоспроизведение» ———
   Иван (22.10.2026): «везде, где есть аудио, наверху, где „Выйти“, „Заново“, — переключатель:
   автовоспроизведение и галочка». Выбор один на всё приложение: переключатели на разных
   экранах — копии одного, и переключение в одном месте меняет все. Что именно звучит само,
   решают экраны через speech.speakAuto().                                                 */

const TOGGLE_TITLE = 'Слово или фраза звучат сами, как только появляются. Выключено — только по кнопке со звуком.';

export function autoplayToggle() {
  const input = el('input', { type: 'checkbox', role: 'switch', class: 'switch-input' });
  input.checked = speech.isAutoplay;
  input.addEventListener('change', async () => {
    speech.isAutoplay = input.checked;
    document.querySelectorAll('.autoplay-toggle input').forEach((other) => { other.checked = speech.isAutoplay; });
    try {
      await setSetting('isAutoplay', speech.isAutoplay);
    } catch (error) {
      toast('Не удалось запомнить выбор — после перезапуска вернётся прежний.', true);
    }
  });
  return el('label', { class: 'autoplay-toggle', title: TOGGLE_TITLE }, [input, el('span', { text: 'Автовоспроизведение' })]);
}
