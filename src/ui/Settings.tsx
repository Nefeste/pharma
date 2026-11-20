// Окно «Настройки» (Б13, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»; геймдизайн, §23):
// вместо меню «Звук» (Б11, шаг 1). Разделы: «Экран» — масштаб интерфейса, «Меньше движения», графика; «Звук» — громкость и
// подписи; «Язык». Всё хранится в окне, а не в сохранении: это настройки игрока, а не завода.
import { T } from '../i18n';
import { QUALITIES } from '../render/view';
import { fitScales, SCALES } from '../app/scale';
import type { Actions, Hud } from './store';

const LANGS = ['ru', 'en'] as const;

export function Settings({ hud, actions }: { hud: Hud; actions: Actions }) {
  const pct = Math.round(hud.sound.volume * 100);
  // ступени, что помещают панели на этот экран (src/app/scale.ts, `MIN_VIEW`)
  const fit = fitScales(window.innerWidth, window.innerHeight);
  return (
    <div className="pauses panel" id="settings" role="dialog" aria-labelledby="settings-title" data-test="settings">
      <div className="phead">
        <b id="settings-title">{T.settings.title}</b>
        <button type="button" className="close" onClick={() => actions.toggleSettings()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <div className="msec">{T.settings.screen}</div>
      <span className="group" title={T.settings.scaleHint} data-test="scales">
        <span className="label">{T.settings.scale}</span>
        {SCALES.map(k => (
          <button key={k} type="button" className={hud.settings.scale === k ? 'on' : ''} aria-pressed={hud.settings.scale === k} disabled={!fit.includes(k)} title={fit.includes(k) ? undefined : T.settings.scaleBig} onClick={() => actions.setScale(k)} data-test="scale" data-scale={k}>
            {T.settings.pct(Math.round(k * 100))}
          </button>
        ))}
      </span>
      <span className="group" title={T.settings.qualityHint}>
        <span className="label">{T.settings.quality}</span>
        {QUALITIES.map(q => (
          <button key={q} type="button" className={hud.quality === q ? 'on' : ''} aria-pressed={hud.quality === q} onClick={() => actions.pickQuality(q)} data-test="preset" data-q={q}>
            {T.debug.qualities[q]}
          </button>
        ))}
      </span>
      <label title={T.view.lessHint}>
        <input type="checkbox" checked={hud.less} onChange={e => actions.setLess(e.currentTarget.checked)} data-test="less-motion" /> {T.view.less}
      </label>
      <div className="msec">{T.sound.title}</div>
      <div className="col" data-test="sound">
        <label>
          {T.sound.volume}{' '}
          <input type="range" min={0} max={100} step={10} value={pct} onChange={e => actions.setVolume(Number(e.currentTarget.value) / 100)} data-test="volume" />{' '}
          <span data-test="volume-value">{T.sound.value(pct)}</span>
        </label>
        <label title={T.sound.captionsHint}>
          <input type="checkbox" checked={hud.sound.captions} onChange={e => actions.setCaptions(e.currentTarget.checked)} data-test="captions" /> {T.sound.captions}
        </label>
      </div>
      {/* язык окна (Б12, шаг 1): на ходу, запоминается в окне */}
      <div className="msec">{T.sound.lang}</div>
      <span className="group" title={T.sound.langHint}>
        {LANGS.map(l => (
          <button key={l} type="button" className={hud.lang === l ? 'on' : ''} aria-pressed={hud.lang === l} onClick={() => actions.setLang(l)} data-test="lang" data-lang={l}>
            {T.sound.langs[l]}
          </button>
        ))}
      </span>
    </div>
  );
}
