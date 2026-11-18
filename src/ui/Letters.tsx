// Письма сценария (Б9; геймдизайн, §17, §26.3): панель — письма новыми сверху, открытое письмо с текстом, «Показать»,
// «Пропустить» и «Пропустить обучение». Текст — шаблон `src/i18n/` по идентификатору письма; что подставить — записи
// завода из потока (src/sim/letters.ts), словами здесь.
import { momentOf } from '../engine/core/calendar';
import { dateText, named, qtyText, T, whenText } from '../i18n';
import type { LetterWords } from '../i18n/ru';
import type { LetterFacts, LetterRow } from '../sim/letters';
import { db } from './db';
import type { Actions, Hud } from './store';

const key = (id: string) => id.replace(/^let\./, '');

/** Записи завода — словами для шаблона письма. */
function words(hud: Hud, f: LetterFacts): LetterWords {
  const mat = f.material ? db?.materials[f.material] : undefined;
  return {
    supplier: f.supplier ? named(db?.suppliers[f.supplier]?.name, f.supplier) : '',
    material: f.material ? named(mat?.name, f.material) : '',
    qty: f.qty !== undefined && mat ? qtyText(f.qty, mat.unit, 0) : '',
    lot: f.lot ? T.lotCode(...f.lot) : '',
    batch: f.batch ?? (f.order !== undefined ? T.letters.order(f.order) : ''),
    product: f.product ? named(db?.products[f.product]?.name, f.product) : '',
    customer: f.customer ? named(db?.customers[f.customer]?.name, f.customer) : '',
    due: f.due !== undefined ? dateText(momentOf(hud.start, f.due)) : '',
    dev: f.dev ?? '',
  };
}

const state = (r: LetterRow) => (r.end ? (r.end.how === 'skip' ? T.letters.skipped : T.letters.done) : T.letters.open);

export function Letters({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.letters.view;
  if (!v) return null;
  const at = v.rows.find(r => r.id === hud.letters.at) ?? v.rows[0];
  const body = at ? T.letters.body[key(at.id)] : undefined;
  return (
    <div className="letters panel" role="dialog" aria-labelledby="letters-title" data-test="letters">
      <div className="phead">
        <b id="letters-title">{T.letters.title}</b>
        {v.mentor > 0 ? <span className="muted">{T.letters.mentorLeft(v.mentor)}</span> : null}
        <button type="button" className="close" onClick={() => actions.toggleLetters()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {v.rows.length === 0 ? <p className="muted">{T.letters.none}</p> : null}
      <ul className="lrows">
        {v.rows.map(r => (
          <li key={r.id}>
            <button
              type="button"
              className={`lrow${r.id === at?.id ? ' on' : ''}${r.read === undefined ? ' new' : ''}`}
              onClick={() => actions.readLetter(r.id)}
              data-test="letter-row"
              data-letter={r.id}
              data-state={r.end?.how ?? 'open'}
            >
              <span>{T.letters.subject[key(r.id)] ?? r.id}</span>
              <span className="muted">
                {T.letters.from[r.from] ?? r.from} · {whenText(hud.start, r.at)} · {state(r)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {at ? (
        <div className="letter" data-test="letter" data-letter={at.id}>
          <b>{T.letters.subject[key(at.id)] ?? at.id}</b>
          <p>{body ? body(words(hud, at.facts)) : ''}</p>
          <div className="lacts">
            {at.go ? (
              <button type="button" className="take" onClick={() => actions.showLetter(at.go!)} title={T.letters.showHint} data-test="letter-show">
                {T.letters.show}
              </button>
            ) : null}
            {at.skip ? (
              <button type="button" onClick={() => actions.skipLetter(at.id)} title={T.letters.skipHint} data-test="letter-skip">
                {T.letters.skip}
              </button>
            ) : null}
            {v.mentor > 0 ? (
              <button type="button" onClick={() => actions.skipTutorial()} title={T.letters.skipAllHint} data-test="letter-skip-all">
                {T.letters.skipAll}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
