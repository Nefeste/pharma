// Ограда панели: исключение в отрисовке панели или в её эффектах не снимает с экрана всё окно. Без ограды React 19
// снимает всё дерево (src/app/main.tsx), и пропадают все панели — так было в 0.0.36: доска расследования при закрытии
// роняла окно (README, 0.0.37). Ограда стоит и тогда, когда панель закрыта: ошибку уборки эффекта при снятии панели React
// отдаёт ограде, которая осталась на экране. На месте панели — строка с ошибкой и «Закрыть»: панель закрывается, ограда
// снова пускает её отрисовку.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { T } from '../i18n';

interface Props {
  /** название панели для игрока */
  name: string;
  /** закрыть панель; нет — панель уже закрыта */
  close?: () => void;
  children?: ReactNode;
}

interface State {
  error?: string;
}

export class Guard extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: Error, info: ErrorInfo) {
    // окно Electron печатает ошибки страницы (electron/main.cjs): по ним видно, что упало
    console.error(`[ui] ${this.props.name}: ${e.stack ?? e.message}${info.componentStack ?? ''}`);
  }

  render() {
    if (this.state.error === undefined) return this.props.children;
    return (
      <div className="guard panel" role="alert" data-test="guard">
        <span className="bad">{T.app.panelError(this.props.name, this.state.error)}</span>
        <button
          type="button"
          onClick={() => {
            this.props.close?.();
            this.setState({ error: undefined });
          }}
          data-test="guard-close"
        >
          {T.card.close}
        </button>
      </div>
    );
  }
}
