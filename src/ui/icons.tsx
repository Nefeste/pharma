// Значки статусов партии (docs/13-art.md, §11: одной толщины линии, одного размера в сетке, со словом рядом): карантин —
// песочные часы, пробы и испытания — пробирка, разрешено — галочка, отклонено — крест, заблокировано — замок. Цвет — как
// у ярлыка на паллете (src/render/loads.ts, `TAG_COLOR`; ярлык статуса приходит в виде): статус читается и цветом, и
// формой, и словом.
import type { LotStatus, Tag } from '../engine/types';
import { TAG_COLOR } from '../render/loads';
import { ICON_FILL, ICON_LINE, ICON_OF, ICON_PATH } from '../render/taskicons';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Значок статуса 14 × 14 точек: тёмная линия 1,5 на кружке цвета ярлыка. */
export function StatusIcon({ status, tag }: { status: LotStatus; tag: Tag }) {
  const color = hex(TAG_COLOR[tag]);
  const path =
    status === 'quarantine'
      ? 'M4.5 3.5h5M4.5 10.5h5M5 4l4 6M9 4l-4 6'
      : status === 'sampled' || status === 'testing'
        ? 'M5.5 3.5v5a1.5 1.5 0 0 0 3 0v-5M5 3.5h4M5.5 7h3'
        : status === 'released'
          ? 'M4 7.2l2 2 4-4.4'
          : status === 'rejected'
            ? 'M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8'
            : 'M4.5 6.5h5v4h-5zM5.5 6.5v-1.5a1.5 1.5 0 0 1 3 0v1.5';
  return (
    <svg className="sicon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" fill={color} />
      <path d={path} fill="none" stroke="#10181b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Значок работы 14 × 14 (src/render/taskicons.ts): тот же, что над головой человека на крупных планах. */
export function TaskIcon({ kind }: { kind: keyof typeof ICON_OF }) {
  return (
    <svg className="sicon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" data-icon={ICON_OF[kind]}>
      <circle cx="7" cy="7" r="6.5" fill={ICON_FILL} />
      <path d={ICON_PATH[ICON_OF[kind]]} fill="none" stroke={ICON_LINE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
